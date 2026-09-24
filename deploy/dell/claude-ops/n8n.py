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

FILA_NO_CONTAINER = "/home/node/.n8n-files/avisos/"


def api(method, path, body=None):
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
    """
    arquivo = ("const arquivo = (texto) => ({ json: { texto }, binary: { data: { data: Buffer.from(JSON.stringify("
               f"{{ titulo: {json.dumps(titulo, ensure_ascii=False)}, texto }}), 'utf8').toString('base64'),"
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
