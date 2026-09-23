"""Ajustes de 23/09/2026 nos fluxos PRUMO do n8n do Dell (idempotente).

Pontuação do Diagnóstico:
- roda de hora em hora (era a cada 5 min, sem nenhuma resposta no Form);
- lê a fila antes e só grava quando chegou resposta nova: não reescreve a
  linha a cada execução nem desfaz a Etapa que o Rômulo já moveu;
- resposta de empresa fora da fila vira aviso, não linha órfã;
- avisa pelo Hermes quando chega resposta nova e quando o diagnóstico fecha.

Lead Scout:
- sincronização de aceites de hora em hora (era a cada 5 min);
- a rodada diária sempre avisa quantas empresas novas achou, e diz quando a
  busca esgotou (hoje ela repete os mesmos 20 resultados).
"""
import copy

from n8n import api, aviso_nodes, put

PONTUACAO = "b091d18b-106b-4f4d-ad4e-f77cdeaa7a5f"
LEAD_SCOUT = "e02c6f43-17ce-430b-9238-0b997a7656ce"


def no(wf, nome):
    return next(n for n in wf["nodes"] if n["name"] == nome)


def trocar(texto, antigo, novo):
    if novo in texto:
        return texto  # já aplicado
    assert antigo in texto, f"trecho não encontrado: {antigo[:60]!r}"
    return texto.replace(antigo, novo, 1)


def liga(con, de, para, saida=0):
    main = con.setdefault(de, {}).setdefault("main", [])
    while len(main) <= saida:
        main.append([])
    main[saida] = [{"node": para, "type": "main", "index": 0}]


def acrescentar(wf, *nos):
    nomes = {n["name"] for n in wf["nodes"]}
    wf["nodes"] += [n for n in nos if n["name"] not in nomes]


def pontuacao():
    wf = api("GET", f"/workflows/{PONTUACAO}")
    con = wf["connections"]

    no(wf, "Verificar respostas do Form — 5 min")["parameters"]["rule"] = {"interval": [{"field": "hours", "hoursInterval": 1}]}
    sessoes = no(wf, "Ler todas as sessões da empresa")
    sessoes.update({"retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000})

    devolver = no(wf, "Devolver briefing ao lead")
    fila = {
        "id": "ler-fila-atual", "name": "Ler fila atual", "type": devolver["type"], "typeVersion": devolver["typeVersion"],
        "position": [sessoes["position"][0] + 220, sessoes["position"][1] + 200],
        "parameters": {"documentId": devolver["parameters"]["documentId"], "sheetName": devolver["parameters"]["sheetName"],
                       "filtersUI": {"values": []}, "options": {}},
        "credentials": devolver["credentials"], "executeOnce": True, "alwaysOutputData": True,
        "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
    }

    agrupar = no(wf, "Agrupar e calcular Índice Prumo")
    c = agrupar["parameters"]["jsCode"]
    c = trocar(c, "const allRows = $input.all().map(item => item.json);",
               "const allRows = $('Ler todas as sessões da empresa').all().map(item => item.json);\n"
               "// Linha atual de cada empresa na fila: decide se há algo novo a gravar.\n"
               "const filaPorId = new Map($input.all().map(item => [String(item.json['ID da empresa'] ?? '').trim().toLocaleLowerCase('pt-BR'), item.json]).filter(([id]) => id));")
    c = trocar(c, "  output.push({ json: {\n    company_id: companyId,",
               "  const lead = filaPorId.get(norm(companyId));\n"
               "  // Resposta de empresa fora da fila: avisa em vez de criar linha órfã.\n"
               "  if (!lead) { output.push({ json: { naFila: false, company_id: companyId, company } }); continue; }\n"
               "  // Nada novo desde a última gravação: não reescreve a linha nem desfaz edição humana.\n"
               "  if (String(lead['Sessões recebidas'] ?? '') === String(sessions.length) && String(lead['Respostas válidas'] ?? '') === String(allScores.length)) continue;\n"
               "  const mudarEtapa = ['', 'Contato aceito', 'Convite pronto', 'Convite enviado', 'Diagnóstico em andamento'].includes(String(lead['Etapa'] ?? '').trim());\n"
               "  output.push({ json: {\n    naFila: true,\n    mudarEtapa,\n    company_id: companyId,")
    agrupar["parameters"]["jsCode"] = c

    b = no(wf, "Briefing do relatório — revisão humana")
    b["parameters"]["jsCode"] = trocar(b["parameters"]["jsCode"], "  'Etapa': 'Diagnóstico para revisar',\n",
                                       "  ...(input.mudarEtapa ? { 'Etapa': 'Diagnóstico para revisar' } : {}),\n")
    a = no(wf, "Aguardar sessões faltantes")
    a["parameters"]["jsCode"] = trocar(a["parameters"]["jsCode"], "  'Etapa': 'Diagnóstico em andamento',\n",
                                       "  ...($json.mudarEtapa ? { 'Etapa': 'Diagnóstico em andamento' } : {}),\n")

    cinco = no(wf, "Cinco sessões completas?")
    na_fila = copy.deepcopy(cinco)
    na_fila.update({"id": "empresa-na-fila", "name": "Empresa está na fila?",
                    "position": [cinco["position"][0] - 220, cinco["position"][1]]})
    na_fila["parameters"]["conditions"]["conditions"] = [{
        "id": "na-fila", "leftValue": "={{ $json.naFila }}", "rightValue": "",
        "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]

    x, y = no(wf, "Devolver briefing ao lead")["position"]
    om, og = aviso_nodes("Resposta fora da fila", x, y + 420,
                         "'Diagnóstico PRUMO recebeu resposta de uma empresa que não está na fila: ' + item.json.company"
                         " + ' (ID ' + item.json.company_id + '). Confira o link usado no formulário.'", "📊 PRUMO")
    cm, cg = aviso_nodes("Diagnóstico completo", x + 240, y,
                         "(() => { const b = $('Briefing do relatório — revisão humana').all()[i]?.json ?? {};"
                         " const nome = String(b['Briefing interno'] ?? '').split(NL)[0].replace('Empresa: ', '');"
                         " return 'Diagnóstico completo: ' + nome + ' · Índice PRUMO ' + b['Índice PRUMO'] + '/100.' + NL"
                         " + 'O briefing para revisão está na planilha PRUMO — Fila de revisão.'; })()", "📊 PRUMO")
    xa, ya = no(wf, "Atualizar pendência no lead")["position"]
    pm, pg = aviso_nodes("Nova resposta", xa + 240, ya,
                         "(() => { const a = $('Aguardar sessões faltantes').all()[i]?.json ?? {};"
                         " const g = $('Agrupar e calcular Índice Prumo').all().find(x => x.json.company_id === a['ID da empresa'])?.json ?? {};"
                         " return 'Diagnóstico: nova resposta de ' + (g.company ?? a['ID da empresa']) + ' (' + a['Sessões recebidas']"
                         " + ' de 5 perspectivas). Falta: ' + (a['Quem falta responder'] || 'ninguém') + '.'; })()", "📊 PRUMO")
    acrescentar(wf, fila, na_fila, om, og, cm, cg, pm, pg)

    liga(con, "Ler todas as sessões da empresa", "Ler fila atual")
    liga(con, "Ler fila atual", "Agrupar e calcular Índice Prumo")
    liga(con, "Agrupar e calcular Índice Prumo", "Empresa está na fila?")
    liga(con, "Empresa está na fila?", "Cinco sessões completas?", 0)
    liga(con, "Empresa está na fila?", om["name"], 1)
    liga(con, om["name"], og["name"])
    liga(con, "Devolver briefing ao lead", cm["name"])
    liga(con, cm["name"], cg["name"])
    liga(con, "Atualizar pendência no lead", pm["name"])
    liga(con, pm["name"], pg["name"])

    put(wf)
    api("POST", f"/workflows/{PONTUACAO}/activate")
    print("Pontuação ajustada:", len(wf["nodes"]), "nós")


def lead_scout():
    wf = api("GET", f"/workflows/{LEAD_SCOUT}")
    con = wf["connections"]
    no(wf, "Sincronizar aceites — 5 min")["parameters"]["rule"] = {"interval": [{"field": "hours", "hoursInterval": 1}]}
    x, y = no(wf, "Google Places — busca pública")["position"]
    rm, rg = aviso_nodes(
        "Resumo da busca", x + 240, y - 300,
        "(() => { const places = itens[0]?.json.places ?? [];"
        " const conhecidos = new Set(($('Preparar descoberta sem repetidos').first().json.existingCompanyIds ?? []).map(v => String(v).toLowerCase()));"
        " const novos = places.filter(p => !conhecidos.has(String(p.id ?? '').toLowerCase())).length;"
        " const q = $('Config — mercado-alvo').first().json.query;"
        " return novos"
        " ? 'Lead Scout: ' + novos + ' empresa(s) nova(s) em \"' + q + '\" (de ' + places.length + ' encontradas). As que publicam WhatsApp no site entram como \"Revisar\" na fila.'"
        " : 'Lead Scout: nenhuma empresa nova em \"' + q + '\" (' + places.length + ' encontradas, todas já na fila). A busca esgotou: troque cidade ou segmento no nó \"Config — mercado-alvo\".'; })()",
        "📊 PRUMO", agregado=True)
    acrescentar(wf, rm, rg)
    saida = con["Google Places — busca pública"]["main"][0]
    if not any(d["node"] == rm["name"] for d in saida):
        saida.append({"node": rm["name"], "type": "main", "index": 0})
    liga(con, rm["name"], rg["name"])
    put(wf)
    api("POST", f"/workflows/{LEAD_SCOUT}/activate")
    print("Lead Scout ajustado:", len(wf["nodes"]), "nós")


if __name__ == "__main__":
    pontuacao()
    lead_scout()
