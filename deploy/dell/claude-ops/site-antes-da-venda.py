"""Migra a esteira Site antes da venda (Caçador e Balcão) do n8n do Easypanel
para o n8n do Dell. Idempotente: recria pelo nome.

- Sheets: credencial Google do Dell (lê a mesma planilha de leads).
- Places: chave do Dell. Gemini: credencial criada a partir de GOOGLE_API_KEY
  do Hermes, sem passar a chave por nenhum outro lugar.
- Drive saiu: o Caçador grava pacotes em /home/node/.n8n-files/auto-entrada e
  o auto-entrada do Dell cria as pastas em ~/auto-site (o espelho em G:\\Meu
  Drive\\auto, pelo PC, parou em 25/09/2026). O Balcão lê os publicado.json
  direto de ~/auto-site.
- Error Workflow: o aviso único pelo Hermes.

Estado em 23/09/2026: Caçador (oow8TkxrAf4fVvTj) e Balcão (wjuoIknp2qlWo0QI)
ativos no Dell; as versões do Easypanel e o "00 · Alerta" de lá foram
despublicados. A credencial "Google Gemini (Dell)" precisa de chave com cota
para busca no Google (grounding); a do Hermes não tem.

29/09/2026: o Balcão também grava `estado/site-pastas.json`, a lista de pastas
que o `site-pastas` do Dell move (respondeu -> _em-conversa, expirado ->
_concluidos), e conta como "esperando resposta" só quem ainda está na raiz.

07/10/2026: o Balcão grava duas colunas para o funil aprender (acrescentadas no fim
da aba Leads, nunca reordenando): `mensagem_variante`, a letra do texto que o
wa_link leva (A/B/C de site-mensagem.js, EN nos EUA; a letra sai do place_id, então
um lead "pronto" não troca de variação entre rodadas), escrita enquanto o lead está
"pronto" — depois do envio fica o que ele recebeu, ou "manual", que o observador do
WhatsApp grava quando a mensagem saiu sem o clique no wa_link; e `site_versao`
("padrão", "personalizado-v1", "personalizado-v2"...), lida do `personalizado.json`
da pasta do lead (gerador-de-sites.py). As cópias `<slug>/_v1/` do modo
personalizado têm publicado.json com o mesmo place_id e não são o lead.

08/10/2026: o Balcão marca "descartado" o lead "novo" cuja pasta o gerador moveu para
`_descartados/` (DESCARTAR.md: já tem site, rede, duplicado). O runner não escreve na
planilha, e esses leads ficavam "novo" para sempre (14 naquele dia): o CRM apontava
divergência e o funil semanal os contava como lead. O place_id sai do content.md da
pasta; recibo de dentro de `_descartados/` não vira "pronto", e uma cópia antiga
descartada não derruba o lead que tem recibo vivo. Reabrir um descartado é voltar a
pasta para a raiz e pôr "novo" na planilha.

Também em 08/10/2026: `site_versao` reconhece o modo personalizado pelo DOSSIE.md (só a
etapa A dele o cria) quando falta o personalizado.json — os refeitos de 07/10 à tarde (v1)
não têm a marca, que veio depois, e 11 deles saíam "padrão". A marca, quando existe, vence.

Uso: python3 site-antes-da-venda.py cacador-easypanel.json [--ativar]
     python3 site-antes-da-venda.py --balcao     (colunas que faltam + só o Balcão, sem mexer no Caçador)
     python3 site-antes-da-venda.py --colunas    (só as colunas mensagem_variante e site_versao)
     python3 site-antes-da-venda.py --testar     (código do cruzamento no node, planilha de mentira, sem n8n)
     python3 site-antes-da-venda.py --testar-n8n (cópia do Balcão no n8n: recibos reais, planilha de
                                                  mentira, nada gravado; apaga a cópia no fim)
"""
import copy
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

from n8n import api, put

PLANILHA = "1ObvUtTTefAA9PoQocPWmiSMMkxJgoiG_TCR7tNEYu0o"
SHEETS = {"googleSheetsOAuth2Api": {"id": "5Dy1tDUiFtAq7PHj", "name": "Google Sheets account"}}
PLACES = {"httpHeaderAuth": {"id": "v7aU1q4PRbTSOYZu", "name": "Google Maps API Key — PRUMO"}}
ENTRADA = "/home/node/.n8n-files/auto-entrada/"
AQUI = Path(__file__).resolve().parent
# Follow-up, expiração e mudança automática de pasta valem para quem foi enviado
# (ou respondeu) a partir daqui; o que veio antes é acervo e fica à mão.
CORTE = "2026-09-29T00:00:00-03:00"
LEADS_GID = "396728619"
# Colunas que o Balcão grava desde 07/10/2026 (no fim da aba Leads; os fluxos escrevem pelo nome).
COLUNAS_NOVAS = ["mensagem_variante", "site_versao"]

# Onde mora o lead hoje: place_id -> "slug" (raiz) ou "_recusados/slug" etc.
# Vem do diretório de cada publicado.json lido por "Ler recibos da pasta auto".
# 07/10/2026: <slug>/_v1/ (site anterior guardado pelo modo personalizado) e
# _tentativa-falha/ têm publicado.json com o mesmo place_id; sem o filtro, o lead
# "morava" em "slug/_v1" (fora da raiz) no retrato e nas contas do Balcão.
PASTA_DO_LEAD_JS = """const AUTO = '/home/node/.n8n-files/auto/';
const arquivosDosRecibos = $('Ler recibos da pasta auto').all();
const pasta = {};
$('Ler o JSON do recibo').all().forEach((r, i) => {
  const pid = r.json.recibo?.place_id;
  const dir = String(arquivosDosRecibos[r.pairedItem?.item ?? i]?.binary?.data?.directory ?? '');
  if (pid && dir.startsWith(AUTO) && !dir.split('/').pop().startsWith('_')) pasta[pid] = dir.slice(AUTO.length);
});
const naRaiz = (pid) => Boolean(pasta[pid]) && !pasta[pid].includes('/');"""


def codigo_js(*arquivos):
    """Junta arquivos .js desta pasta num só código de nó (site-mensagem.js vai na frente)."""
    return "\n".join((AQUI / a).read_text(encoding="utf-8") for a in arquivos)


def erro_wf():
    return next(w["id"] for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == "00 · Avisar falha pelo Hermes")


def credencial_gemini():
    nome = "Google Gemini (Dell)"
    existentes = [c for c in api("GET", "/credentials?limit=100").get("data", []) if c["name"] == nome]
    if existentes:
        return {"googlePalmApi": {"id": existentes[0]["id"], "name": nome}}
    env = (Path.home() / ".hermes/.env").read_text().splitlines()
    chave = next(l.split("=", 1)[1].strip().strip('"') for l in env if l.startswith("GOOGLE_API_KEY="))
    c = api("POST", "/credentials", {"name": nome, "type": "googlePalmApi",
                                      "data": {"host": "https://generativelanguage.googleapis.com", "apiKey": chave}})
    return {"googlePalmApi": {"id": c["id"], "name": nome}}


def criar_ou_trocar(wf):
    existentes = [w for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == wf["name"]]
    if existentes:
        wf["id"] = existentes[0]["id"]
        put(wf)
        return wf["id"]
    return api("POST", "/workflows", wf)["id"]


def pacote_code(expr_caminho, expr_base64, extra=""):
    return "\n".join([
        "const saida = [];",
        "const itens = $input.all();",
        "for (let i = 0; i < itens.length; i++) {",
        "  const item = itens[i];",
        extra,
        f"  const pacote = {{ caminho: {expr_caminho}, base64: {expr_base64} }};",
        "  if (item.json.pastas) pacote.pastas = item.json.pastas;",
        "  const nome = String(pacote.caminho).replace(/[^a-zA-Z0-9._-]+/g, '_') + '.json';",
        "  saida.push({ json: { caminho: pacote.caminho, nome }, binary: { data: { data: Buffer.from(JSON.stringify(pacote), 'utf8').toString('base64'), mimeType: 'application/json', fileName: nome } } });",
        "}",
        "return saida;",
    ])


def gravar_na_entrada(nome, pos):
    return {"id": nome.lower().replace(" ", "-"), "name": nome, "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
            "position": pos, "parameters": {"operation": "write", "dataPropertyName": "data",
                                            "fileName": "={{ '" + ENTRADA + "' + $execution.id + '-' + $json.nome }}"}}


def cacador(fonte, gemini, erro):
    wf = json.loads(Path(fonte).read_text())["workflow"]
    sai = {"Criar pasta do lead", "ID da pasta", "Lead + pasta", "Criar subpasta Fotos", "ID de Fotos",
           "Criar subpasta Logotipo", "ID de Logotipo", "Lead + subpastas", "Escrever content.md", "Fila de fotos",
           "Uma foto por item", "Loop fotos", "Foto + destino", "Enviar foto para o Drive", "Pausa 1s"}
    nos = [copy.deepcopy(n) for n in wf["nodes"] if n["name"] not in sai]
    for n in nos:
        if n["type"] == "n8n-nodes-base.googleSheets":
            n["credentials"] = SHEETS
        elif n["type"].endswith(".googleGemini"):  # @n8n/n8n-nodes-langchain.googleGemini
            n["credentials"] = gemini
        elif (n.get("credentials") or {}).get("httpHeaderAuth"):
            n["credentials"] = PLACES
    baixar = next(n for n in nos if n["name"] == "Baixar foto (Places Media)")
    baixar["parameters"].setdefault("options", {})["batching"] = {"batch": {"batchSize": 1, "batchInterval": 1000}}
    baixar["onError"] = "continueRegularOutput"

    x, y = next(n for n in nos if n["name"] == "Lead salvo")["position"]
    content = {"id": "pacote-content", "name": "Pacote content.md", "type": "n8n-nodes-base.code", "typeVersion": 2,
               "position": [x + 240, y - 120], "parameters": {"mode": "runOnceForAllItems", "jsCode": pacote_code(
                   "item.json.slug + '/content.md'", "Buffer.from(String(item.json.content_md ?? ''), 'utf8').toString('base64')",
                   "  item.json.pastas = ['Fotos', 'Logotipo'];")}}
    fila = {"id": "fila-fotos", "name": "Fila de fotos", "type": "n8n-nodes-base.code", "typeVersion": 2,
            "position": [x + 240, y + 120], "parameters": {"mode": "runOnceForAllItems", "jsCode": "\n".join([
                "// Até 5 fotos do Google Places em Fotos/ e a primeira de novo como capa em Logotipo/.",
                "return $input.all().flatMap(item => {",
                "  const l = item.json;",
                "  const fotos = (l.fotos_places ?? []).filter(Boolean);",
                "  return fotos.map((foto, i) => ({ json: { foto, caminho: l.slug + '/Fotos/' + l.slug + '-foto-' + (i + 1) + '.jpg' } }))",
                "    .concat(fotos.slice(0, 1).map(foto => ({ json: { foto, caminho: l.slug + '/Logotipo/' + l.slug + '-capa.jpg' } })));",
                "});"])}}
    baixar["position"] = [x + 480, y + 120]
    foto = {"id": "pacote-foto", "name": "Pacote foto", "type": "n8n-nodes-base.code", "typeVersion": 2,
            "position": [x + 720, y + 120], "parameters": {"mode": "runOnceForAllItems", "jsCode": "\n".join([
                "// Foto que não baixou (onError contínuo) fica de fora; o resto segue.",
                "const fila = $('Fila de fotos').all();",
                "const saida = [];",
                "const itens = $input.all();",
                "for (let i = 0; i < itens.length; i++) {",
                "  if (!itens[i].binary?.data) continue;",
                "  const origem = fila[itens[i].pairedItem?.item ?? i]?.json ?? {};",
                "  const buf = await this.helpers.getBinaryDataBuffer(i, 'data');",
                "  const pacote = { caminho: origem.caminho, base64: buf.toString('base64') };",
                "  const nome = String(pacote.caminho).replace(/[^a-zA-Z0-9._-]+/g, '_') + '.json';",
                "  saida.push({ json: { caminho: pacote.caminho, nome }, binary: { data: { data: Buffer.from(JSON.stringify(pacote), 'utf8').toString('base64'), mimeType: 'application/json', fileName: nome } } });",
                "}",
                "return saida;"])}}
    g1 = gravar_na_entrada("Entregar content.md", [x + 480, y - 120])
    g2 = gravar_na_entrada("Entregar foto", [x + 960, y + 120])
    nos += [content, fila, foto, g1, g2]

    nomes = {n["name"] for n in nos}
    con = {}
    for de, tipos in wf["connections"].items():
        if de not in nomes:
            continue
        for tipo, saidas in tipos.items():
            con.setdefault(de, {})[tipo] = [[d for d in (s or []) if d["node"] in nomes] for s in saidas]
    ligar = lambda a, b: con.setdefault(a, {}).setdefault("main", [[]])[0].append({"node": b, "type": "main", "index": 0})
    con["Lead salvo"] = {"main": [[]]}
    ligar("Lead salvo", "Pacote content.md")
    ligar("Pacote content.md", "Entregar content.md")
    ligar("Lead salvo", "Fila de fotos")
    ligar("Fila de fotos", "Baixar foto (Places Media)")
    con["Baixar foto (Places Media)"] = {"main": [[]]}
    ligar("Baixar foto (Places Media)", "Pacote foto")
    ligar("Pacote foto", "Entregar foto")

    return {"name": "01 · Caçador", "nodes": nos, "connections": con,
            "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro}}


def balcao(erro):
    ler_planilha = {"resource": "sheet", "operation": "read",
                    "documentId": {"__rl": True, "mode": "id", "value": PLANILHA, "cachedResultName": "Leads — Site antes da venda"},
                    "sheetName": {"__rl": True, "mode": "id", "value": "396728619", "cachedResultName": "Leads"}}
    colunas = [{"id": c, "displayName": c, "required": False, "defaultMatch": c == "place_id", "display": True,
                "type": "string", "canBeUsedToMatch": c == "place_id"}
               for c in ("place_id", "status", "site_url", "vercel_project", "wa_me", "wa_link", *COLUNAS_NOVAS)]
    pendencias = "\n".join([
        "// O que depende do Rômulo nesta esteira. A Central lê este arquivo via dell-status.",
        PASTA_DO_LEAD_JS,
        "const linhas = $input.all().map(i => i.json);",
        "const planilha = 'https://docs.google.com/spreadsheets/d/" + PLANILHA + "/edit#gid=396728619';",
        "const conta = (f) => linhas.filter(f).length;",
        "const estado = { geradoEm: new Date().toISOString(), itens: [",
        "  { id: 'site-enviar', nome: 'Sites prontos para enviar', quantidade: conta(l => String(l.status).trim() === 'pronto'),",
        "    detalhe: 'Clique no wa_link do lead: abre o WhatsApp com a mensagem e marca como enviado.', link: planilha },",
        "  // Pasta fora da raiz (_recusados, _em-conversa) já tem destino: não espera mais nada.",
        "  { id: 'site-resposta', nome: 'Enviados esperando resposta',",
        "    quantidade: conta(l => String(l.status).trim() === 'enviado' && !l.respondeu_em && naRaiz(l.place_id)),",
        "    detalhe: 'A resposta no WhatsApp preenche respondeu_em sozinha. Sem resposta, o follow-up chega em 3 dias e o lead expira em 10.', link: planilha },",
        "] };",
        "return [{ json: estado, binary: { data: { data: Buffer.from(JSON.stringify(estado), 'utf8').toString('base64'), mimeType: 'application/json', fileName: 'site-antes-da-venda.json' } } }];",
    ])
    pastas = "\n".join([
        "// Pastas que o site-pastas do Dell move (o n8n não move diretórios). Sem 'itens':",
        "// o dell-status e o Hermes leem estado/*.json e ignoram este arquivo.",
        "// Só resposta a partir de 29/09/2026 move: o que já estava enviado antes fica onde está.",
        PASTA_DO_LEAD_JS,
        "const CORTE = Date.parse('" + CORTE + "');",
        "const mover = [];",
        "for (const l of $input.all().map(i => i.json)) {",
        "  const atual = pasta[l.place_id];",
        "  if (!atual) continue;",
        "  const partes = atual.split('/');",
        "  const topo = partes.length > 1 ? partes[0] : '';",
        "  const slug = partes[partes.length - 1];",
        "  const status = String(l.status ?? '').trim();",
        "  const respondeu = String(l.respondeu_em ?? '').trim();",
        "  const base = { place_id: l.place_id, nome: l.nome, de: atual };",
        "  if (['enviado', 'expirado'].includes(status) && respondeu && Date.parse(respondeu) >= CORTE && (topo === '' || topo === '_concluidos')) {",
        "    mover.push({ ...base, para: '_em-conversa/' + slug, motivo: 'respondeu em ' + respondeu });",
        "  } else if (status === 'expirado' && !respondeu && topo === '') {",
        "    mover.push({ ...base, para: '_concluidos/' + slug, motivo: '10 dias sem resposta' });",
        "  }",
        "}",
        "const estado = { geradoEm: new Date().toISOString(), mover };",
        "return [{ json: estado, binary: { data: { data: Buffer.from(JSON.stringify(estado), 'utf8').toString('base64'), mimeType: 'application/json', fileName: 'site-pastas.json' } } }];",
    ])
    nos = [
        {"id": "hora", "name": "A cada hora", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
         "parameters": {"rule": {"interval": [{"field": "hours", "hoursInterval": 1, "triggerAtMinute": 10}]}}},
        {"id": "ler", "name": "Ler recibos da pasta auto", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1, "position": [220, 0],
         "parameters": {"operation": "read", "fileSelector": "/home/node/.n8n-files/auto/**/publicado.json", "options": {}}},
        {"id": "json", "name": "Ler o JSON do recibo", "type": "n8n-nodes-base.extractFromFile", "typeVersion": 1.1, "position": [440, 0],
         "parameters": {"operation": "fromJson", "destinationKey": "recibo"}},
        # site_versao (07/10/2026). Uma leitura só (executeOnce: a entrada são os recibos), e
        # nenhum personalizado.json ou um ilegível não param o Balcão: o lead fica "padrão".
        {"id": "marcas", "name": "Ler marcas do modo personalizado", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [660, 0], "executeOnce": True, "alwaysOutputData": True,
         "parameters": {"operation": "read", "fileSelector": "/home/node/.n8n-files/auto/**/personalizado.json", "options": {}}},
        {"id": "marca-json", "name": "Ler o JSON da marca", "type": "n8n-nodes-base.extractFromFile", "typeVersion": 1.1,
         "position": [880, 0], "alwaysOutputData": True, "onError": "continueRegularOutput",
         "parameters": {"operation": "fromJson", "destinationKey": "marca"}},
        # Dossiês (08/10/2026): o DOSSIE.md só nasce no modo personalizado (etapa A). Os leads
        # refeitos em 07/10 à tarde (v1) não têm personalizado.json, que veio depois: sem esta
        # leitura, 11 deles saíam "padrão". Só o diretório importa; nenhum dossiê não para o Balcão.
        {"id": "dossies", "name": "Ler dossiês do modo personalizado", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [1100, 0], "executeOnce": True, "alwaysOutputData": True,
         "parameters": {"operation": "read", "fileSelector": "/home/node/.n8n-files/auto/**/DOSSIE.md", "options": {}}},
        # Descartes do gerador (08/10/2026): o runner move para _descartados/ o lead em que o Claude
        # gravou DESCARTAR.md, mas não escreve na planilha, e o lead ficava "novo" para sempre (14 em
        # 08/10). O place_id vem do content.md. Uma leitura só; nenhum descarte não para o Balcão.
        {"id": "descartes", "name": "Ler descartes do gerador", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [1320, 0], "executeOnce": True, "alwaysOutputData": True,
         "parameters": {"operation": "read", "fileSelector": "/home/node/.n8n-files/auto/_descartados/*/content.md", "options": {}}},
        {"id": "descarte-texto", "name": "Ler o texto do descarte", "type": "n8n-nodes-base.extractFromFile", "typeVersion": 1.1,
         "position": [1540, 0], "alwaysOutputData": True, "onError": "continueRegularOutput",
         "parameters": {"operation": "text", "destinationKey": "conteudo"}},
        {"id": "planilha", "name": "Ler a planilha", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [1760, 0],
         "parameters": ler_planilha, "credentials": SHEETS, "executeOnce": True, "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000},
        {"id": "cruzar", "name": "Cruzar recibos e montar abordagem", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [1980, 0],
         "parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": codigo_js("site-mensagem.js", "balcao-cruzar.js")}},
        {"id": "atualizar", "name": "Atualizar lead na planilha", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [2200, 0],
         "parameters": {**{k: v for k, v in ler_planilha.items() if k != "operation"}, "operation": "update",
                        "columns": {"mappingMode": "autoMapInputData", "matchingColumns": ["place_id"], "value": {}, "schema": colunas},
                        "options": {"cellFormat": "RAW", "handlingExtraData": "insertInNewColumn"}},
         "credentials": SHEETS, "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000},
    ]
    ordem = [n["name"] for n in nos]
    con = {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(ordem, ordem[1:])}
    nos += [
        {"id": "pendencias", "name": "Pendências da esteira", "type": "n8n-nodes-base.code", "typeVersion": 2,
         "position": [1980, 220], "parameters": {"mode": "runOnceForAllItems", "jsCode": pendencias}},
        {"id": "gravar-pendencias", "name": "Gravar pendências", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [2200, 220], "parameters": {"operation": "write", "dataPropertyName": "data",
                                                 "fileName": "/home/node/.n8n-files/estado/site-antes-da-venda.json"}},
        {"id": "pastas", "name": "Pastas a mover", "type": "n8n-nodes-base.code", "typeVersion": 2,
         "position": [1980, 440], "parameters": {"mode": "runOnceForAllItems", "jsCode": pastas}},
        {"id": "gravar-pastas", "name": "Gravar pastas a mover", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [2200, 440], "parameters": {"operation": "write", "dataPropertyName": "data",
                                                 "fileName": "/home/node/.n8n-files/estado/site-pastas.json"}},
    ]
    con["Ler a planilha"]["main"][0].append({"node": "Pendências da esteira", "type": "main", "index": 0})
    con["Ler a planilha"]["main"][0].append({"node": "Pastas a mover", "type": "main", "index": 0})
    con["Pendências da esteira"] = {"main": [[{"node": "Gravar pendências", "type": "main", "index": 0}]]}
    con["Pastas a mover"] = {"main": [[{"node": "Gravar pastas a mover", "type": "main", "index": 0}]]}
    return {"name": "03 · Balcão (Site antes da venda)", "nodes": nos, "connections": con,
            "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro}}


def acrescentar_colunas(planilha, gid, aba, novas):
    """Acrescenta no fim do cabeçalho da aba as colunas que faltam, sem reordenar nada
    (todo fluxo lê e escreve pelo nome)."""
    from sheets_proxy import SheetsProxy
    with SheetsProxy([planilha]) as s:
        meta = s.get(f"/v4/spreadsheets/{planilha}?fields=sheets.properties")
        props = next(x["properties"] for x in meta["sheets"] if str(x["properties"]["sheetId"]) == str(gid))
        cab = (s.get(f"/v4/spreadsheets/{planilha}/values/" + quote(f"{aba}!1:1")).get("values") or [[]])[0]
        faltam = [c for c in novas if c not in cab]
        if not faltam:
            print(f"{aba}: colunas já existem:", ", ".join(novas))
            return
        grade = props["gridProperties"]["columnCount"]
        if len(cab) + len(faltam) > grade:
            s.post(f"/v4/spreadsheets/{planilha}:batchUpdate", {"requests": [{"appendDimension": {
                "sheetId": int(gid), "dimension": "COLUMNS", "length": len(cab) + len(faltam) - grade}}]})
        letra = lambda n: (letra(n // 26 - 1) if n >= 26 else "") + chr(ord("A") + n % 26)
        faixa = f"{aba}!{letra(len(cab))}1:{letra(len(cab) + len(faltam) - 1)}1"
        s.post(f"/v4/spreadsheets/{planilha}/values:batchUpdate",
               {"valueInputOption": "RAW", "data": [{"range": faixa, "values": [faltam]}]})
        print(f"{aba}: colunas novas em {faixa}:", ", ".join(faltam))


# ---------------------------------------------------------------- testes

AUTO_NO_N8N = "/home/node/.n8n-files/auto/"


def rodar_js(codigo, nos, entrada=()):
    """Roda o código de um nó Code no node: `$('Nó').all()` devolve os itens de `nos[Nó]`
    (com binary e pairedItem, como no n8n) e `$input.all()` os de `entrada`."""
    exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
    if not exe:
        raise SystemExit("node não encontrado")
    prog = ("const nos = " + json.dumps(nos, ensure_ascii=False) + ";\n"
            "const $ = (n) => { if (!(n in nos)) throw new Error('nó desconhecido: ' + n);"
            " return { all: () => nos[n], first: () => nos[n][0] }; };\n"
            "const $input = { all: () => " + json.dumps(list(entrada), ensure_ascii=False) + " };\n"
            "const saida = (() => {\n" + codigo + "\n})();\n"
            "console.log(JSON.stringify(saida));\n")
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "no.js"
        arq.write_text(prog, encoding="utf-8")
        r = subprocess.run([str(exe), str(arq)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


def nos_de_arquivos(leitura, extracao, chave, arquivos):
    """Itens de um par readWriteFile -> extractFromFile: [(pasta relativa, conteúdo | None ilegível)]."""
    lidos, extraidos = [], []
    for i, (pasta, conteudo) in enumerate(arquivos):
        lidos.append({"json": {}, "binary": {"data": {"directory": AUTO_NO_N8N + pasta}}})
        extraidos.append({"json": {chave: conteudo} if conteudo is not None else {"error": "Unexpected token"},
                          "pairedItem": {"item": i}})
    return {leitura: lidos, extracao: extraidos}


def testar() -> int:
    import unittest
    from urllib.parse import unquote

    TEL = "+55 27 99988-7766"  # número de mentira

    def recibo(pid, slug):
        return {"place_id": pid, "nome": slug, "site_url": f"https://demo-{slug}.vercel.app", "vercel_project": f"demo-{slug}"}

    RECIBOS = [
        ("padaria-a", recibo("pid-a", "padaria-a")),
        # O site anterior guardado pelo modo personalizado: mesmo place_id, outra URL.
        ("padaria-a/_v1", {**recibo("pid-a", "padaria-a"), "site_url": "https://copia-antiga.vercel.app"}),
        ("oficina-b", recibo("pid-b", "oficina-b")),
        ("_em-conversa/clinica-c", recibo("pid-c", "clinica-c")),
        ("loja-d", recibo("pid-d", "loja-d")),
        ("dental-e", recibo("pid-e", "dental-e")),
        ("casa-f", recibo("pid-f", "casa-f")),
        ("bar-g", recibo("pid-g", "bar-g")),
        ("_recusados/escola-h", recibo("pid-h", "escola-h")),
        # Pasta movida à mão para _descartados/ com recibo: não vira "pronto".
        ("_descartados/bar-z", recibo("pid-z", "bar-z")),
    ]
    # content.md das pastas em _descartados/ (o place_id no formato do Caçador).
    DESCARTES = [
        ("_descartados/pousada-x", "# Pousada X\n\n- **place_id:** pid-x\n- **Status na planilha:** novo\n"),
        ("_descartados/academia-y", "# Academia Y\n- **place_id:** pid-y\n"),
        # Cópia antiga descartada de um lead que tem recibo na raiz: o lead está vivo.
        ("_descartados/padaria-a--20261005", "# Padaria A\n- **place_id:** pid-a\n"),
        ("_descartados/sem-id", "# Sem place_id aqui\n"),
    ]
    MARCAS = [("padaria-a", {"versao": 2, "modelo": "x"}), ("padaria-a/_v1", {"versao": 1}),
              ("_recusados/escola-h", {"versao": 1}), ("loja-d", None)]  # loja-d: arquivo ilegível

    def linha(pid, status, **k):
        return {"json": {"place_id": pid, "nome": "Padaria " + pid, "telefone": TEL, "status": status, "site_url": "",
                         "wa_me": "", "wa_link": "", "briefing": "", "site_versao": "", "mensagem_variante": "", **k}}

    PLANILHA_FALSA = [
        linha("pid-a", "pronto", briefing="**Elogiam:** o pão de queijo, o café coado."),
        linha("pid-b", "novo"),
        linha("pid-c", "enviado", site_url="https://demo-clinica-c.vercel.app", mensagem_variante="manual"),
        linha("pid-d", "enviado", site_url="https://demo-loja-d.vercel.app", site_versao="padrão"),
        linha("pid-e", "pronto", telefone="+1 305-642-0504"),
        linha("pid-f", "pronto", telefone=""),
        linha("pid-g", "enviado"),
        linha("pid-h", "recusado", site_url="https://demo-escola-h.vercel.app"),
        linha("pid-x", "novo"),
        linha("pid-y", "pronto", site_url="https://demo-academia-y.vercel.app"),
        linha("pid-z", "novo"),
    ]

    # Pastas com DOSSIE.md: casa-f sem marca (v1 por inferência); padaria-a com a marca v2, que vence.
    DOSSIES = ["casa-f", "padaria-a", "padaria-a/_v1"]

    def cruzar(recibos=RECIBOS, marcas=MARCAS, planilha=PLANILHA_FALSA, troca=None, descartes=DESCARTES, dossies=DOSSIES):
        nos = {**nos_de_arquivos("Ler recibos da pasta auto", "Ler o JSON do recibo", "recibo", recibos),
               **nos_de_arquivos("Ler marcas do modo personalizado", "Ler o JSON da marca", "marca", marcas),
               **nos_de_arquivos("Ler descartes do gerador", "Ler o texto do descarte", "conteudo", descartes),
               # Só o readWriteFile (o diretório basta); sem dossiê, o n8n entrega um item sem binário.
               "Ler dossiês do modo personalizado": [{"json": {}, "binary": {"data": {"directory": AUTO_NO_N8N + p}}} for p in dossies]
               or [{"json": {}}]}
        codigo = codigo_js("site-mensagem.js", "balcao-cruzar.js")
        for de, para in (troca or {}).items():
            codigo = codigo.replace(de, para)
        saida = [i["json"] for i in rodar_js(codigo, nos, planilha)]
        por = {}
        for item in saida:
            por.setdefault(item["place_id"], []).append(item)
        return por

    class Cruzar(unittest.TestCase):
        def test_pronto_personalizado_leva_a_versao_e_a_letra(self):
            a = cruzar()["pid-a"]
            self.assertEqual(len(a), 1, "a cópia _v1 não pode virar um segundo item")
            a = a[0]
            self.assertEqual((a["status"], a["site_versao"], a["mensagem_variante"], a["site_url"]),
                             ("pronto", "personalizado-v2", "A", "https://demo-padaria-a.vercel.app"))
            self.assertTrue(a["wa_link"].endswith("/enviar?place_id=pid-a"))
            self.assertIn("pão de queijo", unquote(a["wa_me"]))

        def test_novo_vira_pronto_em_padrao(self):
            b = cruzar()["pid-b"][0]
            self.assertEqual((b["status"], b["site_versao"], b["mensagem_variante"]), ("pronto", "padrão", "A"))

        def test_enviado_so_ganha_a_versao_e_uma_vez(self):
            por = cruzar()
            self.assertEqual(por["pid-c"], [{"place_id": "pid-c", "site_versao": "padrão"}])
            self.assertNotIn("pid-d", por)  # já dizia "padrão"; a marca ilegível não muda isso
            self.assertEqual(por["pid-h"], [{"place_id": "pid-h", "site_versao": "personalizado-v1"}])

        def test_eua_e_sem_telefone(self):
            por = cruzar()
            e = por["pid-e"][0]
            self.assertEqual(e["mensagem_variante"], "EN")
            self.assertIn("Hi! This is", unquote(e["wa_me"]))
            f = por["pid-f"][0]
            self.assertEqual((f["mensagem_variante"], f["wa_link"]), ("", ""))

        def test_enviado_sem_site_nao_ganha_letra(self):
            g = cruzar()["pid-g"][0]
            self.assertEqual((g["status"], g["site_versao"]), ("enviado", "padrão"))
            self.assertNotIn("mensagem_variante", g)

        def test_sem_nenhuma_marca(self):
            # O n8n entrega um item vazio (alwaysOutputData) e a extração dele falha: tudo é padrão.
            por = cruzar(marcas=[("", None)], dossies=[])
            self.assertEqual(por["pid-a"][0]["site_versao"], "padrão")
            # Sem marca, mas com dossiê: o refeito de 07/10 sai v1.
            self.assertEqual(cruzar(marcas=[("", None)])["pid-a"][0]["site_versao"], "personalizado-v1")

        def test_dossie_sem_marca_e_personalizado_v1_e_a_marca_vence(self):
            por = cruzar()
            self.assertEqual(por["pid-f"][0]["site_versao"], "personalizado-v1")
            self.assertEqual(por["pid-a"][0]["site_versao"], "personalizado-v2")
            self.assertEqual(cruzar(dossies=[])["pid-f"][0]["site_versao"], "padrão")

        def test_descarte_do_gerador_vira_descartado_so_quando_novo(self):
            por = cruzar()
            self.assertEqual(por["pid-x"], [{"place_id": "pid-x", "status": "descartado"}])
            self.assertNotIn("pid-y", por, "pronto não volta atrás por uma pasta em _descartados/")

        def test_copia_antiga_descartada_nao_derruba_o_lead_vivo(self):
            a = cruzar()["pid-a"]
            self.assertEqual([i.get("status") for i in a], ["pronto"])

        def test_recibo_em_descartados_nao_vira_pronto(self):
            self.assertNotIn("pid-z", cruzar())

        def test_sem_nenhum_descarte(self):
            # Glob sem arquivo: o n8n entrega um item vazio e a extração falha; nada muda.
            por = cruzar(descartes=[("", None)])
            self.assertNotIn("pid-x", por)
            self.assertEqual(por["pid-b"][0]["status"], "pronto")

    class Variante(unittest.TestCase):
        def letras(self, troca=None):
            codigo = codigo_js("site-mensagem.js")
            for de, para in (troca or {}).items():
                codigo = codigo.replace(de, para)
            pids = [f"ChIJ{i:04d}x" for i in range(300)]
            return rodar_js(codigo + "\nreturn " + json.dumps(pids) + ".map(p => [varianteDe(p, false).letra, varianteDe(p, false).letra]);", {})

        def test_hoje_so_a(self):
            self.assertEqual({a for a, _ in self.letras()}, {"A"})

        def test_com_b_e_c_divide_e_nao_muda_de_uma_rodada_para_outra(self):
            res = self.letras({"null, null];": "'texto B {NOME}', 'texto C {NOME}'];"})
            self.assertEqual({a for a, _ in res}, {"A", "B", "C"})
            self.assertTrue(all(a == b for a, b in res))
            self.assertTrue(min(sum(1 for a, _ in res if a == x) for x in "ABC") > 60)  # ~100 cada

        def test_o_texto_casa_com_a_letra(self):
            troca = {"null, null];": "'texto B {NOME}', 'texto C {NOME}'];"}
            por = cruzar(troca=troca, planilha=[linha(f"pid-{i}", "pronto") for i in range(40)],
                         recibos=[(f"lead-{i}", recibo(f"pid-{i}", f"lead-{i}")) for i in range(40)], marcas=[])
            for itens in por.values():
                texto, letra = unquote(itens[0]["wa_me"]), itens[0]["mensagem_variante"]
                self.assertEqual(texto.split("?text=")[1].startswith("texto "), letra in "BC", (letra, texto))
                if letra != "A":
                    self.assertTrue(texto.split("?text=")[1].startswith("texto " + letra))

    class PastaDoLead(unittest.TestCase):
        def test_copia_do_modo_personalizado_nao_e_a_pasta(self):
            nos = nos_de_arquivos("Ler recibos da pasta auto", "Ler o JSON do recibo", "recibo", RECIBOS)
            r = rodar_js(PASTA_DO_LEAD_JS + "\nreturn [{ json: { pasta, a: naRaiz('pid-a'), c: naRaiz('pid-c') } }];", nos)[0]["json"]
            self.assertEqual(r["pasta"]["pid-a"], "padaria-a")
            self.assertEqual(r["pasta"]["pid-c"], "_em-conversa/clinica-c")
            self.assertEqual((r["a"], r["c"]), (True, False))

    carga = unittest.TestLoader()
    suite = unittest.TestSuite(carga.loadTestsFromTestCase(c) for c in (Cruzar, Variante, PastaDoLead))
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


def testar_n8n() -> int:
    """Cópia do Balcão no n8n disparada por webhook: lê os recibos e as marcas REAIS da pasta auto
    (só leitura), com a planilha de mentira (um nó Code) e toda gravação trocada por NoOp. Confere a
    fiação nova (marcas lidas uma vez, sem marca nenhuma o Balcão segue) e o que o cruzamento
    gravaria. Apaga a cópia no fim."""
    import time
    import urllib.request
    import uuid
    auto = Path.home() / "auto-site"
    recibos = {}
    for p in sorted(auto.glob("**/publicado.json")):
        rel = p.parent.relative_to(auto)
        if rel.name.startswith("_"):
            continue
        try:
            pid = json.loads(p.read_text(encoding="utf-8")).get("place_id")
        except (OSError, ValueError):
            continue
        if pid:
            recibos[pid] = rel
    personalizado = next((pid for pid, rel in recibos.items() if (auto / rel / "personalizado.json").is_file()), None)
    # "Padrão" de verdade não tem dossiê; e um refeito em 07/10 (dossiê sem marca) tem de sair v1.
    padrao = next((pid for pid, rel in recibos.items()
                   if not (auto / rel / "personalizado.json").is_file() and not (auto / rel / "DOSSIE.md").is_file()), None)
    if not personalizado or not padrao:
        print("faltam leads para o teste (um com personalizado.json e um sem marca nem dossiê)")
        return 1
    versao = json.loads((auto / recibos[personalizado] / "personalizado.json").read_text(encoding="utf-8"))["versao"]
    com_dossie = next((pid for pid, rel in recibos.items()
                       if (auto / rel / "DOSSIE.md").is_file() and not (auto / rel / "personalizado.json").is_file()), None)
    # Um descarte real do gerador (pasta em _descartados/ com o place_id no content.md e sem recibo vivo).
    descartado = None
    for c in sorted(auto.glob("_descartados/*/content.md")):
        m = re.search(r"(?i)place_id[:* \t]+([a-zA-Z0-9_-]+)", c.read_text(encoding="utf-8", errors="replace"))
        if m and m.group(1) not in recibos:
            descartado = m.group(1)
            break
    falsa = [{"place_id": personalizado, "nome": "Teste personalizado", "telefone": "+55 27 99988-7766", "status": "pronto",
              "site_url": "", "wa_me": "", "wa_link": "", "briefing": "", "site_versao": "", "mensagem_variante": ""},
             {"place_id": padrao, "nome": "Teste padrão", "telefone": "+55 27 99988-7700", "status": "enviado",
              "site_url": "https://x.vercel.app", "site_versao": "", "mensagem_variante": "manual"}]
    if descartado:
        falsa.append({"place_id": descartado, "nome": "Teste descartado", "telefone": "", "status": "novo", "site_url": ""})
    if com_dossie:
        falsa.append({"place_id": com_dossie, "nome": "Teste dossiê", "telefone": "+55 27 99988-7711", "status": "pronto",
                      "site_url": "", "wa_me": "", "wa_link": "", "briefing": "", "site_versao": "", "mensagem_variante": ""})
    caminho = f"zz-teste-balcao-{int(time.time())}"
    wf = balcao(None)
    nos = []
    for n in wf["nodes"]:
        if n["name"] == "A cada hora":
            n = {"id": n["id"], "name": n["name"], "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": n["position"],
                 "webhookId": str(uuid.uuid4()), "parameters": {"httpMethod": "POST", "path": caminho, "responseMode": "onReceived"}}
        elif n["name"] == "Ler a planilha":
            n = {"id": n["id"], "name": n["name"], "type": "n8n-nodes-base.code", "typeVersion": 2, "position": n["position"],
                 "executeOnce": True, "parameters": {"mode": "runOnceForAllItems",
                                                     "jsCode": "return " + json.dumps(falsa, ensure_ascii=False) + ".map(json => ({ json }));"}}
        elif n["type"] == "n8n-nodes-base.googleSheets" or n["name"].startswith("Gravar"):
            n = {"id": n["id"], "name": n["name"], "type": "n8n-nodes-base.noOp", "typeVersion": 1, "position": n["position"], "parameters": {}}
        nos.append(n)
    t = api("POST", "/workflows", {"name": "ZZ testar Balcão (apagar)", "nodes": nos, "connections": wf["connections"],
                                   "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo"}})
    ok = False
    try:
        api("POST", f"/workflows/{t['id']}/activate")
        time.sleep(2)
        urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:5679/webhook/{caminho}", data=b"{}", method="POST",
                                                      headers={"Content-Type": "application/json"}), timeout=30).read()
        ex = []
        for _ in range(60):
            ex = api("GET", f"/executions?workflowId={t['id']}&limit=1")["data"]
            if ex and ex[0]["status"] not in ("running", "new", "waiting"):
                break
            time.sleep(3)
        e = api("GET", f"/executions/{ex[0]['id']}?includeData=true")
        rd = e["data"]["resultData"]["runData"]
        saida = [i["json"] for i in rd["Cruzar recibos e montar abordagem"][0]["data"]["main"][0]]
        por = {}
        for item in saida:
            por.setdefault(item["place_id"], []).append(item)
        a, b = por.get(personalizado, []), por.get(padrao, [])
        marcas = len(rd["Ler marcas do modo personalizado"])
        checagens = [
            ("execução sem erro", e["status"] == "success"),
            ("marcas lidas uma vez", marcas == 1),
            ("pronto personalizado: um item", len(a) == 1),
            (f"pronto personalizado: personalizado-v{versao} e A",
             bool(a) and (a[0].get("site_versao"), a[0].get("mensagem_variante")) == (f"personalizado-v{versao}", "A")),
            ("enviado padrão: só a versão", b == [{"place_id": padrao, "site_versao": "padrão"}]),
            ("descartes lidos uma vez", len(rd["Ler descartes do gerador"]) == 1),
        ]
        checagens.append(("dossiês lidos uma vez", len(rd["Ler dossiês do modo personalizado"]) == 1))
        if descartado:
            checagens.append(("descarte do gerador: novo vira descartado",
                              por.get(descartado, []) == [{"place_id": descartado, "status": "descartado"}]))
        if com_dossie:
            d = por.get(com_dossie, [])
            checagens.append(("dossiê sem marca: personalizado-v1", bool(d) and d[0].get("site_versao") == "personalizado-v1"))
        ok = True
        for nome, certo in checagens:
            ok &= certo
            print("ok  " if certo else "ERRO", nome)
        print(f"cruzamento: {len(saida)} item(ns) para gravar; pendências e pastas rodaram:",
              "Pendências da esteira" in rd and "Pastas a mover" in rd)
    finally:
        api("POST", f"/workflows/{t['id']}/deactivate")
        api("DELETE", f"/workflows/{t['id']}")
    print("tudo certo" if ok else "HÁ ERROS")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--testar" in sys.argv:
        sys.exit(testar())
    if "--testar-n8n" in sys.argv:
        sys.exit(testar_n8n())
    if "--colunas" in sys.argv:
        acrescentar_colunas(PLANILHA, LEADS_GID, "Leads", COLUNAS_NOVAS)
        sys.exit(0)
    erro = erro_wf()
    if sys.argv[1:2] == ["--balcao"]:
        try:
            acrescentar_colunas(PLANILHA, LEADS_GID, "Leads", COLUNAS_NOVAS)
        except Exception as e:  # noqa: BLE001 — o Balcão cria a coluna sozinho (insertInNewColumn); o observador espera por ela
            print(f"colunas não criadas ({e}); rode de novo com --colunas quando a credencial Google estiver ok")
        wf = balcao(erro)
        wid = criar_ou_trocar(wf)
        api("POST", f"/workflows/{wid}/activate")  # o PUT guarda; ativar publica a versão nova
        print(wf["name"], "->", wid, f"({len(wf['nodes'])} nós, ativo)")
        sys.exit(0)
    gemini = credencial_gemini()
    ids = {}
    for wf in (cacador(sys.argv[1], gemini, erro), balcao(erro)):
        ids[wf["name"]] = criar_ou_trocar(wf)
        print(wf["name"], "->", ids[wf["name"]], f"({len(wf['nodes'])} nós)")
    Path(AQUI / "site-antes-da-venda.ids.json").write_text(json.dumps(ids, ensure_ascii=False))
    if "--ativar" in sys.argv:
        for nome, i in ids.items():
            api("POST", f"/workflows/{i}/activate")
            print("ativo:", nome)
