"""Correções estruturais dos fluxos; funções puras, sem API ou credenciais.

O subfluxo aguarda TODOS os ramos, inclusive quando nenhum item é produzido.
Assim uma confirmação HTTP ou o avanço da busca nunca antecede a persistência.
"""
import copy
import json


def destino(nome, indice=0):
    return {"node": nome, "type": "main", "index": indice}


def encadear(con, origem, fim):
    con[origem] = {"main": [[destino(fim)]]}


def envolver(wf, nomes, entrada, chamada, posicao):
    """Move um conjunto fechado de nós para um subfluxo inline aguardado."""
    nomes = set(nomes)
    filhos = [copy.deepcopy(n) for n in wf["nodes"] if n["name"] in nomes]
    trigger = {"id": "receber-rodada", "name": "Receber dados", "type": "n8n-nodes-base.executeWorkflowTrigger",
               "typeVersion": 1.1, "position": [-300, 0], "parameters": {"inputSource": "passthrough"}}
    conexoes = {k: copy.deepcopy(v) for k, v in wf["connections"].items() if k in nomes}
    for tipos in conexoes.values():
        for saidas in tipos.values():
            for saida in saidas:
                saida[:] = [d for d in saida if d["node"] in nomes]
    encadear(conexoes, trigger["name"], entrada)
    filho = {"name": wf["name"] + " — persistência", "nodes": [trigger, *filhos], "connections": conexoes,
             "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo"}}
    wf["nodes"] = [n for n in wf["nodes"] if n["name"] not in nomes]
    wf["connections"] = {k: v for k, v in wf["connections"].items() if k not in nomes}
    for tipos in wf["connections"].values():
        for saidas in tipos.values():
            for saida in saidas:
                saida[:] = [d for d in saida if d["node"] not in nomes]
    wf["nodes"].append({"id": "aguardar-persistencia", "name": chamada, "type": "n8n-nodes-base.executeWorkflow",
                        "typeVersion": 1.3, "position": posicao, "alwaysOutputData": True,
                        "parameters": {"source": "parameter", "mode": "once", "workflowJson": json.dumps(filho, ensure_ascii=False),
                                       "options": {"waitForSubWorkflow": True}}})
    return wf


def confirmar_persistencia(wf):
    """O observador recebe 200 só depois de todas as planilhas/filas gravarem."""
    wf = copy.deepcopy(wf)
    if any(n["name"] == "Persistir antes de confirmar" for n in wf["nodes"]):
        return wf
    nomes = {n["name"] for n in wf["nodes"]}
    if "Qual planilha?" not in nomes or "Responder ao observador" not in nomes:
        return wf
    origem = "Decidir pela resposta" if "Decidir pela resposta" in nomes else "Decidir"
    persistencia = {"Qual planilha?", "Pacote da pasta (recusou)", "Pedir a mudança de pasta"}
    persistencia.update(n for n in nomes if n.startswith("Marcar no ") or n.startswith("Marcar em "))
    envolver(wf, persistencia & nomes, "Qual planilha?", "Persistir antes de confirmar", [1700, -100])
    encadear(wf["connections"], origem, "Persistir antes de confirmar")
    # A sombra continua depois da confirmação, sem participar da decisão.
    if "Jev: mascarar e montar pedido" in nomes:
        wf["connections"][origem]["main"][0].append(destino("Jev: mascarar e montar pedido"))
    encadear(wf["connections"], "Persistir antes de confirmar", "Responder ao observador")
    wf["connections"].pop("Responder ao observador", None)
    resposta = next(n for n in wf["nodes"] if n["name"] == "Responder ao observador")
    resposta["parameters"]["responseBody"] = resposta["parameters"]["responseBody"].replace("$input.all()", "$('" + origem + "').all()")
    return wf


def concluir_cacador(wf):
    """A rodada só avança quando todo o processamento termina com sucesso."""
    wf = copy.deepcopy(wf)
    if any(n["name"] == "Concluir processamento da busca" for n in wf["nodes"]):
        return wf
    nomes = {n["name"] for n in wf["nodes"]}
    if "Registrar ultima_rodada" not in nomes or "Escolher a busca" not in nomes:
        return wf
    pais = {"Executar manualmente", "Agendamento diário 06:00", "Ler aba Buscas", "Só buscas ativas",
            "Escolher a busca", "Registrar ultima_rodada"}
    envolver(wf, nomes - pais, "Montar área da busca", "Concluir processamento da busca", [1000, 0])
    encadear(wf["connections"], "Escolher a busca", "Concluir processamento da busca")
    encadear(wf["connections"], "Concluir processamento da busca", "Registrar ultima_rodada")
    registro = next(n for n in wf["nodes"] if n["name"] == "Registrar ultima_rodada")
    for c, valor in registro["parameters"]["columns"]["value"].items():
        if isinstance(valor, str):
            registro["parameters"]["columns"]["value"][c] = valor.replace("$('Montar área da busca')", "$('Escolher a busca')")
    return wf


def desembrulhar(wf):
    """Devolve o grafo editável para os scripts que atualizam o Caçador."""
    from serializacao_aquisicao import desembrulhar as desembrulhar_aquisicao
    wf = desembrulhar_aquisicao(wf)
    chamada = next((n for n in wf["nodes"] if n["name"] == "Concluir processamento da busca"), None)
    if chamada is None:
        return wf
    filho = json.loads(chamada["parameters"]["workflowJson"])
    wf["nodes"] = [n for n in wf["nodes"] if n is not chamada]
    wf["nodes"] += [n for n in filho["nodes"] if n["type"] != "n8n-nodes-base.executeWorkflowTrigger"]
    wf["connections"].pop(chamada["name"], None)
    wf["connections"].update({k: v for k, v in filho["connections"].items() if k != "Receber dados"})
    encadear(wf["connections"], "Escolher a busca", "Montar área da busca")
    wf["connections"]["Buscar no Google Places"]["main"][0].append(destino("Registrar ultima_rodada"))
    return wf


def proteger_dedupe_persistencia_cacador(wf):
    """Falha fechado na leitura e usa a identidade existente em regravações do Caçador Site."""
    wf = copy.deepcopy(wf)

    def proteger(nos):
        for no in nos:
            nome = no.get("name")
            if nome == "Ler leads existentes":
                if no.get("type") != "n8n-nodes-base.googleSheets" or no.get("parameters", {}).get("operation") != "read":
                    raise ValueError("Leitura de dedupe do Caçador Site fora do contrato.")
                no.pop("onError", None)
                no.pop("continueOnFail", None)
            if nome in ("Salvar lead na planilha", "Salvar descartado na planilha"):
                params = no.setdefault("parameters", {})
                colunas = params.get("columns", {})
                schema = colunas.get("schema", [])
                identidade = next((c for c in schema if c.get("id") == "place_id"), None)
                if (no.get("type") != "n8n-nodes-base.googleSheets"
                        or params.get("operation") not in ("append", "appendOrUpdate")
                        or not identidade or colunas.get("mappingMode") != "autoMapInputData"):
                    raise ValueError("Persistência do Caçador Site sem chave place_id mapeada.")
                params["operation"] = "appendOrUpdate"
                colunas["matchingColumns"] = ["place_id"]
                identidade["canBeUsedToMatch"] = True
                no["retryOnFail"] = False
                no.pop("maxTries", None)
                no.pop("waitBetweenTries", None)
            filho = no.get("parameters", {}).get("workflowJson")
            if isinstance(filho, str):
                try:
                    sub = json.loads(filho)
                except (ValueError, TypeError) as erro:
                    raise ValueError("Subworkflow do Caçador Site inválido.") from erro
                proteger(sub.get("nodes", []))
                no["parameters"]["workflowJson"] = json.dumps(sub, ensure_ascii=False)

    proteger(wf.get("nodes", []))
    return wf


def preparar(wf):
    if wf.get("name") == "01 · Caçador":
        return proteger_dedupe_persistencia_cacador(concluir_cacador(wf))
    if wf.get("name") in ("WhatsApp — conversa com lead (marca sozinho)", "WhatsApp — resposta de lead (classifica)"):
        return confirmar_persistencia(wf)
    if any(n.get("parameters", {}).get("path") == "lead-acao" for n in wf.get("nodes", [])):
        return confirmar_acao(wf)
    if no_de_marcar(wf) is not None and not so_rastro_do_clique(wf):
        wf = copy.deepcopy(wf)
        no = next(n for n in wf["nodes"] if n["name"] == "Decidir")
        if "[abrir-nao-envia]" not in no["parameters"]["jsCode"]:
            codigo = no["parameters"]["jsCode"]
            no["parameters"]["jsCode"] = ("// [abrir-nao-envia] Envio só pelo observador ou confirmação humana.\n"
                "return (await (async () => {\n" + codigo + "\n})()).map(i => ({...i, json: {...i.json, marcar: false}}));")
    return wf


# O nó que grava na planilha o clique do link rastreado. O 04 do Site o chama "Gravar clique_em" (era "Marcar
# como enviado", nome que mentia: só grava o clique); os convites do PRUMO ainda o têm com o nome antigo até
# o prumo-*.py tirar a marca de lá. Os dois nomes valem aqui.
NOS_DE_MARCAR = ("Marcar como enviado", "Gravar clique_em")


def no_de_marcar(wf):
    return next((n for n in wf.get("nodes", []) if n["name"] in NOS_DE_MARCAR), None)


def so_rastro_do_clique(wf):
    """O nó que grava o clique (NOS_DE_MARCAR) só grava `clique_em` (o 04 do Site desde 19/10/2026)? Então abrir não
    marca envio e o clique pode ficar registrado: é o rastro que o observador usa para manter a letra do Balcão."""
    no = no_de_marcar(wf)
    colunas = (no.get("parameters") or {}).get("columns") or {}
    gravadas = set(colunas.get("value") or {}) - set(colunas.get("matchingColumns") or [])
    return gravadas == {"clique_em"}


def confirmar_acao(wf):
    """GET mostra a revisão. Só POST da mesma origem e contexto atual escreve."""
    wf = copy.deepcopy(wf)
    nomes = {n["name"] for n in wf["nodes"]}
    if "Conferir confirmação" in nomes:
        return wf
    nos = {n["name"]: n for n in wf["nodes"]}
    gatilho = nos["Botão da página"]
    post = copy.deepcopy(gatilho)
    post.update(id="confirmar-acao-post", name="Confirmar ação da página", webhookId="5b1c2d3e-4f50-4a61-8b72-c3d4e5f60108", position=[0, 550])
    post["parameters"]["httpMethod"] = "POST"
    normalizar = {"id": "receber-confirmacao", "name": "Receber confirmação", "type": "n8n-nodes-base.code", "typeVersion": 2,
                  "position": [220, 550], "parameters": {"mode": "runOnceForAllItems", "jsCode":
                      "return $input.all().map(i => ({json: {...i.json, query: i.json.body ?? {}, _confirmado: true}}));"}}
    entrada = {"id": "entrada-acao", "name": "Entrada da ação", "type": "n8n-nodes-base.code", "typeVersion": 2,
               "position": [440, 550], "parameters": {"mode": "runOnceForAllItems", "jsCode": "return $input.all();"}}
    proximo = wf["connections"][gatilho["name"]]["main"][0][0]["node"]
    encadear(wf["connections"], gatilho["name"], entrada["name"])
    encadear(wf["connections"], post["name"], normalizar["name"])
    encadear(wf["connections"], normalizar["name"], entrada["name"])
    encadear(wf["connections"], entrada["name"], proximo)
    # Leitura da linha e decisão passam a usar a mesma entrada para os dois métodos.
    for nome in ("Botão: ler a linha", "Decidir a ação"):
        p = json.dumps(nos[nome]["parameters"], ensure_ascii=False)
        nos[nome]["parameters"] = json.loads(p.replace("$('Botão da página')", "$('Entrada da ação')"))
    codigo = nos["Decidir a ação"]["parameters"]["jsCode"]
    # O guard roda antes do código original e usa a linha recém-lida.
    guard = r'''// [confirmacao-http] Abrir/recarregar/pré-visualizar link nunca escreve.
const req = $('Entrada da ação').first().json;
const q0 = req.query ?? {};
const linhaAtual = $input.all().map(i => i.json).find(l => String(l.place_id ?? '') === String(q0.id ?? ''));
const esc0 = t => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const assinatura = l => ['status','status_anterior','recusado_em','fechado_em','resposta_em','respondeu_em'].map(k => String(l?.[k] ?? '')).join('|');
const origens = new Set(['https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net','http://127.0.0.1:5679','http://localhost:5679']);
let codigo0 = 200, erro0 = '';
if (!linhaAtual) { codigo0 = 404; erro0 = 'Lead não encontrado.'; }
else if (req._confirmado) {
  if (!origens.has(String(req.headers?.origin ?? '')) || (req.headers?.['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
    codigo0 = 403; erro0 = 'Abra a página do lead e confirme a ação por lá.';
  } else if (String(q0.contexto ?? '') !== assinatura(linhaAtual)) {
    codigo0 = 409; erro0 = 'O lead mudou. Reabra a página e confira antes de confirmar.';
  }
}
if (!req._confirmado || erro0) {
  const rotulo = ({recusou:'Registrar recusa',fechou:'Registrar ganho',desfazer:'Desfazer o registro',gerar_demo:'Solicitar a demo'})[q0.acao] ?? 'Ação desconhecida';
  const formulario = !erro0 && ['recusou','fechou','desfazer','gerar_demo'].includes(q0.acao)
    ? '<form method="post" action="lead-acao"><input type="hidden" name="id" value="'+esc0(q0.id)+'"><input type="hidden" name="acao" value="'+esc0(q0.acao)+'"><input type="hidden" name="contexto" value="'+esc0(assinatura(linhaAtual))+'"><button type="submit">Confirmar: '+esc0(rotulo)+'</button></form>' : '';
  const html = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conferir ação</title><style>body{font:18px system-ui;max-width:38rem;margin:3rem auto;padding:1rem;color:#222}button{font:inherit;padding:1rem;margin:1rem 0;cursor:pointer}a{color:#934115}</style><h1>'+esc0(rotulo)+'</h1><p>'+esc0(linhaAtual?.nome ?? '')+'</p><p>'+esc0(erro0 || 'Confira a empresa e a ação antes de registrar. Nada foi alterado ainda.')+'</p>'+formulario+'<p><a href="lead?id='+encodeURIComponent(String(q0.id ?? ''))+'">Voltar ao lead</a></p></html>';
  return [{json:{autorizado:false,codigo:codigo0,html}}];
}
'''
    nos["Decidir a ação"]["parameters"]["jsCode"] = guard + "\nreturn (() => {\n" + codigo + "\n})().map(i => ({...i, json:{...i.json,autorizado:true}}));"
    validar = {"id": "conferir-confirmacao", "name": "Conferir confirmação", "type": "n8n-nodes-base.if", "typeVersion": 2.2,
               "position": [1100, 550], "parameters": {"conditions": {"options": {"typeValidation": "strict", "version": 2},
                   "conditions": [{"leftValue": "={{ $json.autorizado }}", "rightValue": True, "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]}, "options": {}}}
    mostrar = copy.deepcopy(nos["Mostrar a página"])
    mostrar.update(id="mostrar-confirmacao", name="Mostrar confirmação", position=[1320, 700])
    encadear(wf["connections"], "Decidir a ação", validar["name"])
    wf["connections"][validar["name"]] = {"main": [[destino("Grava na planilha?")], [destino(mostrar["name"])]]}
    wf["nodes"] += [post, normalizar, entrada, validar, mostrar]
    return wf
