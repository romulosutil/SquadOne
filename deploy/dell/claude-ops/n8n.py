"""Cliente mínimo da API pública do n8n do Dell, usado por Claude/Codex via SSH.

A chave de operações fica em ~/.config/claude-ops/n8n-api-key (600). O Hermes
usa outra chave, só de leitura: ele é o secretário, não o operador.
"""
import json
import urllib.error
import urllib.request
from pathlib import Path

URL = "http://127.0.0.1:5679/api/v1"
KEY = (Path.home() / ".config/claude-ops/n8n-api-key").read_text().strip()

# A API pública recusa chaves de settings que ela não conhece.
SETTINGS_OK = {
    "saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution",
    "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "callerPolicy", "callerIds",
    "timeSavedPerExecution", "availableInMCP",
}

# Fluxos desligados de propósito. Todo script prumo-*.py termina em POST /workflows/<id>/activate
# depois de trocar os nós: sem esta trava, ajustar o convite religaria o Lead Scout calado.
# Religar = tirar daqui (PR) e ativar no n8n. O rodar-agora.py também recusa estes ids sem --forcar.
DESLIGADOS = {
    # 08/10/2026, decisão do Rômulo: 57 convites frios a distribuidoras, 21 respostas de robô,
    # nenhum dono interessado. O Organizado agora chega só pela CDL. O fluxo fica no n8n, inativo.
    "e02c6f43-17ce-430b-9238-0b997a7656ce": "PRUMO — Lead Scout (convite frio a distribuidoras)",
}

FILA_NO_CONTAINER = "/home/node/.n8n-files/avisos/"
# Campo `origem` do aviso, em JavaScript, para os nós Code que montam o JSON da fila.
ORIGEM_JS = "origem: ('n8n:' + $workflow.name).slice(0, 80)"


def garantir_erro_salvo(body):
    """Todo fluxo publicado guarda a execução que FALHOU (saveDataErrorExecution "all"). Com "none" o
    "00 · Avisar falha pelo Hermes" dispara, mas não há execução para abrir: o fluxo fica cego (VIVO-9).
    Fonte tem excecao de privacidade e alerta sanitizado, sem salvar payload.
    Sucesso pode ficar como o fluxo quiser. Devolve uma cópia; o dict do chamador não muda."""
    body = dict(body)
    privados = {"PRUMO · Fonte com IA (Luna do Hermes)", "PRUMO · Fonte — falha sem dados"}
    if body.get("name") in privados:
        # Pergunta, resposta e lease nao entram no historico, nem em falhas.
        # O errorWorkflow da Fonte grava somente um aviso operacional sanitizado.
        body["settings"] = {**(body.get("settings") or {}), "saveDataErrorExecution": "none",
                            "saveDataSuccessExecution": "none", "saveManualExecutions": False,
                            "saveExecutionProgress": False}
    else:
        body["settings"] = {**(body.get("settings") or {}), "saveDataErrorExecution": "all"}
    return body


def api(method, path, body=None):
    partes = path.strip("/").split("/")
    if method in ("POST", "PUT") and partes[0] == "workflows" and len(partes) <= 2 and isinstance(body, dict) and "nodes" in body:
        from workflow_confiabilidade import preparar
        body = garantir_erro_salvo(preparar(body))
        cred_luna = Path.home() / '.config/claude-ops/luna-workflows-cred'
        if cred_luna.exists():
            from workflow_luna import usar_luna
            body = usar_luna(body, cred_luna.read_text().strip())
        from prumo_contexto import preparar as preparar_contexto, carregar as carregar_contexto, do_escopo
        if do_escopo(body):
            body = preparar_contexto(body, carregar_contexto())
    if method == "POST" and len(partes) == 3 and partes[0] == "workflows" and partes[2] == "activate" and partes[1] in DESLIGADOS:
        print(f"{DESLIGADOS[partes[1]]} está desligado de propósito (n8n.DESLIGADOS): não ativei.")
        return {"active": False, "desligado": True}
    req = urllib.request.Request(
        URL + path, method=method,
        headers={"X-N8N-API-KEY": KEY, "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            t = r.read()
            return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()[:400]}")


def put(wf):
    body = {
        "name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
        "settings": {k: v for k, v in (wf.get("settings") or {}).items() if k in SETTINGS_OK},
    }
    return api("PUT", f"/workflows/{wf['id']}", body)


def aviso_nodes(prefixo, x, y, texto_expr, titulo="🧭 Operação", agregado=False):
    """Par de nós que grava um aviso na fila lida pelo dell-status (vira WhatsApp).

    `texto_expr` é uma expressão JavaScript. Por item, tem `item`, `i` e `NL`
    (quebra de linha). Com `agregado=True` roda uma vez só, com `itens` (todos
    os itens de entrada) e `NL`, e devolve [] quando o texto for vazio: assim
    um único WhatsApp resume a execução e "nada a dizer" não vira mensagem.

    `origem` (obrigatória no dell-status desde 06/10/2026) é o nome do fluxo,
    lido na execução: renomear o fluxo não exige regerar o nó.
    """
    arquivo = ("const arquivo = (texto) => ({ json: { texto }, binary: { data: { data: Buffer.from(JSON.stringify("
               f"{{ titulo: {json.dumps(titulo, ensure_ascii=False)}, texto, {ORIGEM_JS} }}), 'utf8').toString('base64'),"
               " mimeType: 'application/json', fileName: 'aviso.json' } } });")
    if agregado:
        corpo = ["const itens = $input.all();", f"const texto = {texto_expr};", "return texto ? [arquivo(texto)] : [];"]
    else:
        corpo = ["return $input.all().map((item, i) => arquivo(" + texto_expr + "));"]
    code = "\n".join(["const NL = String.fromCharCode(10);", arquivo, *corpo])
    montar = {
        "id": f"{prefixo}-montar", "name": f"{prefixo}: montar aviso", "type": "n8n-nodes-base.code",
        "typeVersion": 2, "position": [x, y], "parameters": {"mode": "runOnceForAllItems", "jsCode": code},
    }
    gravar = {
        "id": f"{prefixo}-gravar", "name": f"{prefixo}: avisar pelo Hermes", "type": "n8n-nodes-base.readWriteFile",
        "typeVersion": 1.1, "position": [x + 240, y],
        "parameters": {
            "operation": "write",
            "fileName": "={{ '" + FILA_NO_CONTAINER + "' + $workflow.id + '-' + $execution.id + '-' + $itemIndex + '.json' }}",
            "dataPropertyName": "data",
        },
    }
    return montar, gravar
