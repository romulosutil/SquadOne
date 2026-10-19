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

14/10/2026: A/B estratificado por nicho. Medido até aqui: 221 envios, A 41 (24% responderam),
B 25 (8%), C 5, Fisher A×B p = 0,11 e confundido (a B só é elegível com nota 4,3+ e 15+
avaliações, a C só com Raio-X no ar, e o hash do place_id não equilibrava nada por nicho). A
letra agora sai de `alocarRodada` (site-mensagem.js): dentro do estrato nicho (coluna
`vertical`) × conjunto de letras elegíveis, a letra com MENOS leads já atribuídos na planilha
(toda linha com letra A/B/C e `ab_elegiveis` válidos; "manual", "EN" e vazio não contam), empate
pelo hash antigo, leads da rodada em ordem de place_id e somados um a um. Coluna nova
`ab_elegiveis` ("A", "AB", "AC", "ABC"), gravada na mesma escrita de `mensagem_variante`.
Congelamento: a letra fica enquanto o `ab_elegiveis` salvo for igual ao de agora e contiver a
letra; mudou o conjunto (Raio-X chegou ou sumiu) ou a linha não tem conjunto (vazia, ou letra do
sorteio antigo): sorteia de novo. Só "pronto" é reescrito, então o que saiu nunca muda. O lead sem
demo (Raio-X avulso, `sem_demo`) tem o conjunto "C", sem sorteio e fora dos pares; sem raio-x ou nos
EUA a alocação devolve null (nenhuma mensagem), como o `varianteDe`. O aviso
do 05 · Acompanhamento (follow-up) e o histórico (150 envios sem letra, mais os sorteados pelo
hash antes disto, sem `ab_elegiveis`) não entram no teste; o CRM o lê em Resultados.

15/10/2026 (decisão do Rômulo): a A vale sem demo. O lead sem demo cabe em A ou C (a C só com raio-x;
a B continua só com demo), e o lead do Brasil sem recibo nenhum ("novo" na fila do gerador, gerador que
falhou, Raio-X sem padrão) também vira "pronto" com a A; se responder, o demo sai pelo "Gerar demo". Fora:
EUA (seguem a fila do gerador), sem telefone, quem tem qualquer recibo (até cópia ou descartado) e os
descartes do gerador. Os textos foram revistos no mesmo dia (guia no site-mensagem.js).

18/10/2026: gate de pré-envio da 1ª mensagem (gate-de-envio.js, cópia do server/gate-de-envio.ts), entre o
site-mensagem.js e o balcao-cruzar.js no nó do Balcão. Modo na constante GATE_DE_ENVIO do balcao-cruzar.js
(`avisar` por padrão: o lead segue "pronto" e a coluna nova `gate_de_envio` diz o motivo; `bloquear`: o
lead não vira "pronto" e sai do sorteio sem gastar a vez de ninguém; `desligado`: a saída de antes). A
variável de ambiente GATE_DE_ENVIO troca a constante ao publicar (codigo_do_balcao). Nunca muda o texto.

Uso: python3 site-antes-da-venda.py cacador-easypanel.json [--ativar]
     python3 site-antes-da-venda.py --balcao     (colunas que faltam + só o Balcão, sem mexer no Caçador)
     python3 site-antes-da-venda.py --colunas    (só as colunas mensagem_variante, site_versao, raio_x_url e ab_elegiveis)
     python3 site-antes-da-venda.py --testar     (código do cruzamento no node, planilha de mentira, sem n8n)
     python3 site-antes-da-venda.py --testar-n8n (cópia do Balcão no n8n: recibos reais, planilha de
                                                  mentira, nada gravado; apaga a cópia no fim)
"""
import copy
import json
import os
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
# raio_x_url (08/10/2026): o link do Raio-X do publicado.json, para a segunda mensagem de quem
# recebeu a variação C (o aviso de interesse e o CRM montam a segunda da linha, não do recibo).
# ab_elegiveis (14/10/2026): as letras que o lead podia receber no sorteio ("A", "AB", "AC", "ABC"),
# gravada junto com mensagem_variante; é ela que diz com quem a letra pode ser comparada no CRM.
# gate_de_envio (18/10/2026): o motivo curto do gate de pré-envio da 1ª mensagem ("aviso: …" ou "barrado: …"),
# vazio quando a mensagem passou; só é escrita com o gate ligado (GATE_DE_ENVIO diferente de "desligado").
COLUNAS_NOVAS = ["mensagem_variante", "site_versao", "raio_x_url", "ab_elegiveis", "gate_de_envio"]
MODOS_DO_GATE = ("desligado", "avisar", "bloquear")

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


def codigo_do_balcao(modo=None):
    """O código do nó do Balcão: site-mensagem.js, gate-de-envio.js e balcao-cruzar.js, nesta ordem.
    `modo` (ou a variável de ambiente GATE_DE_ENVIO) troca a constante GATE_DE_ENVIO do balcao-cruzar.js;
    sem nenhum dos dois, vale o que o arquivo diz (hoje "avisar"). Valor desconhecido para o publicar:
    um modo digitado errado não pode virar outro em silêncio."""
    codigo = codigo_js("site-mensagem.js", "gate-de-envio.js", "balcao-cruzar.js")
    modo = modo or os.environ.get("GATE_DE_ENVIO", "").strip() or None
    if modo is None:
        return codigo
    if modo not in MODOS_DO_GATE:
        raise SystemExit(f"GATE_DE_ENVIO={modo!r} desconhecido; use {', '.join(MODOS_DO_GATE)}")
    trocado, n = re.subn(r"^const GATE_DE_ENVIO = '[a-z]+';", f"const GATE_DE_ENVIO = '{modo}';", codigo, count=1, flags=re.M)
    if n != 1:
        raise SystemExit("não achei a linha const GATE_DE_ENVIO = '...'; no balcao-cruzar.js")
    return trocado


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
        "  { id: 'site-enviar', nome: 'Primeiro contato para enviar', quantidade: conta(l => String(l.status).trim() === 'pronto'),",
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
         "parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": codigo_do_balcao()}},
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

    def cruzar(recibos=RECIBOS, marcas=MARCAS, planilha=PLANILHA_FALSA, troca=None, descartes=DESCARTES, dossies=DOSSIES, modo=None):
        nos = {**nos_de_arquivos("Ler recibos da pasta auto", "Ler o JSON do recibo", "recibo", recibos),
               **nos_de_arquivos("Ler marcas do modo personalizado", "Ler o JSON da marca", "marca", marcas),
               **nos_de_arquivos("Ler descartes do gerador", "Ler o texto do descarte", "conteudo", descartes),
               # Só o readWriteFile (o diretório basta); sem dossiê, o n8n entrega um item sem binário.
               "Ler dossiês do modo personalizado": [{"json": {}, "binary": {"data": {"directory": AUTO_NO_N8N + p}}} for p in dossies]
               or [{"json": {}}]}
        codigo = codigo_do_balcao(modo)
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
            self.assertEqual(a["ab_elegiveis"], "A")  # sem nota boa nem Raio-X: só a A, sem sorteio
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
            self.assertEqual((e["mensagem_variante"], e["ab_elegiveis"]), ("EN", ""))  # EUA fica fora do teste
            self.assertIn("Hi, how are you? This is Rômulo.", unquote(e["wa_me"]))
            f = por["pid-f"][0]
            self.assertEqual((f["mensagem_variante"], f["ab_elegiveis"], f["wa_link"]), ("", "", ""))

        def test_enviado_sem_site_nao_ganha_letra(self):
            g = cruzar()["pid-g"][0]
            self.assertEqual((g["status"], g["site_versao"]), ("enviado", "padrão"))
            self.assertNotIn("mensagem_variante", g)
            self.assertNotIn("ab_elegiveis", g)

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
            self.assertNotIn("descartado", [i["status"] for i in por.get("pid-x", []) if "status" in i])
            self.assertEqual(por["pid-b"][0]["status"], "pronto")

    class Variante(unittest.TestCase):
        # 08/10/2026: a B cita a nota do Google e só entra para lead com nota 4,3+ e 15+ avaliações;
        # a C (Raio-X) só com raio_x_url e raio_x_pontos no recibo (raio-x.py).
        NOTA_BOA = {"nota": "4.9", "avaliacoes": "34"}
        RAIO_X = {"raio_x_url": "https://demo-x.vercel.app/raio-x", "raio_x_pontos": 2}

        def letras(self, troca=None, lead=None):
            codigo = codigo_js("site-mensagem.js")
            for de, para in (troca or {}).items():
                codigo = codigo.replace(de, para)
            pids = [f"ChIJ{i:04d}x" for i in range(300)]
            l = json.dumps(lead)
            return rodar_js(codigo + "\nreturn " + json.dumps(pids)
                            + f".map(p => [varianteDe(p, false, {l}).letra, varianteDe(p, false, {l}).letra]);", {})

        def test_sem_nota_boa_so_a(self):
            for lead in (None, {}, {"nota": "4.2", "avaliacoes": "300"}, {"nota": 5, "avaliacoes": 14}, {"nota": "", "avaliacoes": ""}):
                self.assertEqual({a for a, _ in self.letras(lead=lead)}, {"A"}, lead)

        def test_com_nota_boa_divide_entre_a_e_b(self):
            res = self.letras(lead=self.NOTA_BOA)
            self.assertEqual({a for a, _ in res}, {"A", "B"})
            self.assertTrue(min(sum(1 for a, _ in res if a == x) for x in "AB") > 100)  # ~150 cada

        def test_com_raio_x_divide_e_nao_muda_de_uma_rodada_para_outra(self):
            res = self.letras(lead={**self.NOTA_BOA, **self.RAIO_X})
            self.assertEqual({a for a, _ in res}, {"A", "B", "C"})
            self.assertTrue(all(a == b for a, b in res))
            self.assertTrue(min(sum(1 for a, _ in res if a == x) for x in "ABC") > 60)  # ~100 cada
            self.assertEqual({a for a, _ in self.letras(lead=self.RAIO_X)}, {"A", "C"})  # sem nota: a B fica de fora

        def test_o_texto_casa_com_a_letra(self):
            inicio = {"A": "Oi, tudo bem? Aqui é o Rômulo. Encontrei vocês no Google",
                      "B": "Oi, tudo bem? Aqui é o Rômulo. Vi a Padaria ",
                      "C": "Oi, tudo bem? Aqui é o Rômulo. Dei uma olhada em como a Padaria "}
            # O Raio-X vem do recibo (publicado.json), a nota vem da linha da planilha.
            por = cruzar(planilha=[linha(f"pid-{i}", "pronto", **self.NOTA_BOA) for i in range(40)],
                         recibos=[(f"lead-{i}", {**recibo(f"pid-{i}", f"lead-{i}"), **self.RAIO_X}) for i in range(40)], marcas=[])
            self.assertEqual({i[0]["mensagem_variante"] for i in por.values()}, {"A", "B", "C"})
            self.assertEqual({i[0]["ab_elegiveis"] for i in por.values()}, {"ABC"})
            letras = [i[0]["mensagem_variante"] for i in por.values()]
            self.assertEqual(sorted(letras.count(x) for x in "ABC"), [13, 13, 14])  # 40 no mesmo estrato: alocação, não sorte
            for itens in por.values():
                texto, letra = unquote(itens[0]["wa_me"]).split("?text=")[1], itens[0]["mensagem_variante"]
                self.assertTrue(texto.startswith(inicio[letra]), (letra, texto))
                if letra == "B":
                    self.assertIn("no Google, nota 4,9 com 34 avaliações, muito bom!", texto)
                if letra == "C":
                    self.assertIn("o que já está bom e 2 pontos que fazem o cliente ir para outro lugar", texto)
                    self.assertNotIn("https://", texto)  # o link do raio-x não vai na 1ª
                self.assertNotIn("{", texto)
                self.assertEqual(itens[0]["raio_x_url"], "https://demo-x.vercel.app/raio-x")

        def test_sem_raio_x_no_recibo_a_coluna_fica_vazia_e_nao_sai_c(self):
            por = cruzar(planilha=[linha(f"pid-{i}", "pronto", **self.NOTA_BOA) for i in range(40)],
                         recibos=[(f"lead-{i}", recibo(f"pid-{i}", f"lead-{i}")) for i in range(40)], marcas=[])
            self.assertEqual({i[0]["mensagem_variante"] for i in por.values()}, {"A", "B"})
            self.assertEqual({i[0]["raio_x_url"] for i in por.values()}, {""})
            self.assertEqual({i[0]["ab_elegiveis"] for i in por.values()}, {"AB"})

    class Alocacao(unittest.TestCase):
        # 14/10/2026: A/B estratificado. A letra é a de menos leads no estrato nicho × letras elegíveis.
        ABC = {"nota": "4.9", "avaliacoes": "34", "raio_x_url": "https://demo-x.vercel.app/raio-x", "raio_x_pontos": 2}
        AB = {"nota": "4.9", "avaliacoes": "34"}

        @staticmethod
        def pedido(pid, nicho="advocacia", lead=None, salva=None, eua=False):
            return {"placeId": pid, "nicho": nicho, "eua": eua, "lead": lead or {}, "salva": salva or {}}

        @staticmethod
        def alocar(linhas, pedidos):
            return rodar_js(codigo_js("site-mensagem.js") + "\nreturn alocarRodada("
                            + json.dumps(linhas, ensure_ascii=False) + ", " + json.dumps(pedidos, ensure_ascii=False) + ");", {})

        @staticmethod
        def contagem(res):
            return {x: sum(1 for r in res.values() if r["letra"] == x) for x in "ABC"}

        def test_trinta_leads_num_nicho_dividem_por_igual(self):
            for n in (30, 31, 32):
                res = self.alocar([], [self.pedido(f"ChIJ{i:04d}x", lead=self.ABC) for i in range(n)])
                c = self.contagem(res)
                self.assertLessEqual(max(c.values()) - min(c.values()), 1, (n, c))
                self.assertEqual({r["elegiveis"] for r in res.values()}, {"ABC"})

        def test_dois_nichos_sao_independentes(self):
            # advocacia já tem A, A, B no estrato ABC: o próximo de lá vai para a C; contabilidade começa do zero.
            linhas = [{"place_id": f"old-{i}", "vertical": "advocacia", "mensagem_variante": l, "ab_elegiveis": "ABC"}
                      for i, l in enumerate("AAB")]
            res = self.alocar(linhas, [self.pedido("novo-adv", lead=self.ABC),
                                       self.pedido("novo-cont", nicho="contabilidade", lead=self.ABC)])
            self.assertEqual(res["novo-adv"]["letra"], "C")
            antiga = rodar_js(codigo_js("site-mensagem.js") + "\nreturn varianteDe('novo-cont', false, "
                              + json.dumps(self.ABC) + ").letra;", {})
            self.assertEqual(res["novo-cont"]["letra"], antiga, "estrato vazio: o desempate é o hash de sempre")
            # Trinta em cada nicho, intercalados: cada um equilibrado por conta própria.
            pedidos = [self.pedido(f"p{i:03d}", nicho=("advocacia", "contabilidade")[i % 2], lead=self.AB) for i in range(60)]
            res = self.alocar([], pedidos)
            for nicho in ("advocacia", "contabilidade"):
                letras = [res[p["placeId"]]["letra"] for p in pedidos if p["nicho"] == nicho]
                self.assertEqual((letras.count("A"), letras.count("B")), (15, 15), nicho)

        def test_mesma_entrada_mesma_saida_em_qualquer_ordem(self):
            pedidos = [self.pedido(f"ChIJ{i:04d}x", nicho=("a", "b", "")[i % 3], lead=(self.ABC, self.AB, {})[i % 3]) for i in range(40)]
            linhas = [{"place_id": "x1", "vertical": "a", "mensagem_variante": "B", "ab_elegiveis": "ABC"}]
            um = self.alocar(linhas, pedidos)
            self.assertEqual(um, self.alocar(linhas, pedidos))
            self.assertEqual(um, self.alocar(linhas, list(reversed(pedidos))))

        def test_letra_salva_com_o_mesmo_conjunto_fica(self):
            # O estrato tem 5 B e nenhuma A: um sorteio novo daria A, mas a letra salva continua.
            linhas = [{"place_id": f"b{i}", "vertical": "advocacia", "mensagem_variante": "B", "ab_elegiveis": "AB"} for i in range(5)]
            res = self.alocar(linhas, [self.pedido("ja", lead=self.AB, salva={"letra": "B", "elegiveis": "AB"})])
            self.assertEqual((res["ja"]["letra"], res["ja"]["congelada"], res["ja"]["elegiveis"]), ("B", True, "AB"))
            res = self.alocar(linhas, [self.pedido("novo", lead=self.AB)])
            self.assertEqual((res["novo"]["letra"], res["novo"]["congelada"]), ("A", False))

        def test_mudou_o_conjunto_sorteia_de_novo(self):
            # Perdeu o Raio-X: a C salva não cabe mais, sorteia no estrato AB.
            res = self.alocar([], [self.pedido("perdeu", lead=self.AB, salva={"letra": "C", "elegiveis": "ABC"})])
            self.assertIn(res["perdeu"]["letra"], ("A", "B"))
            self.assertEqual((res["perdeu"]["elegiveis"], res["perdeu"]["congelada"]), ("AB", False))
            # Ganhou o Raio-X depois de "pronto": a A salva no AB vai a novo sorteio no ABC (a troca para C é possível).
            linhas = [{"place_id": "x", "vertical": "advocacia", "mensagem_variante": l, "ab_elegiveis": "ABC"} for l in "AB"]
            res = self.alocar(linhas, [self.pedido("ganhou", lead=self.ABC, salva={"letra": "A", "elegiveis": "AB"})])
            self.assertEqual((res["ganhou"]["letra"], res["ganhou"]["elegiveis"]), ("C", "ABC"))
            # Letra do sorteio antigo, sem ab_elegiveis: entra no sorteio novo.
            res = self.alocar([], [self.pedido("antigo", lead=self.AB, salva={"letra": "B", "elegiveis": ""})])
            self.assertFalse(res["antigo"]["congelada"])

        def test_quem_vai_sortear_de_novo_nao_conta_a_propria_letra(self):
            # A linha do próprio lead (C, ABC) estaria na contagem; ele perdeu o Raio-X e é sorteado de novo.
            linhas = [{"place_id": "eu", "vertical": "advocacia", "mensagem_variante": "C", "ab_elegiveis": "ABC"},
                      {"place_id": "outro", "vertical": "advocacia", "mensagem_variante": "A", "ab_elegiveis": "ABC"}]
            res = self.alocar(linhas, [self.pedido("eu", lead=self.AB, salva={"letra": "C", "elegiveis": "ABC"}),
                                       self.pedido("novo", lead=self.ABC)])
            # No ABC só conta "outro" (A): o novo vai para B ou C, nunca A.
            self.assertIn(res["novo"]["letra"], ("B", "C"))

        def test_so_conta_letra_valida_do_sorteio(self):
            # manual, EN, vazio, letra fora do conjunto e conjunto ilegível não contam; enviado e recusado contam.
            linhas = [{"place_id": "m", "vertical": "advocacia", "mensagem_variante": "manual", "ab_elegiveis": "AB"},
                      {"place_id": "e", "vertical": "advocacia", "mensagem_variante": "EN", "ab_elegiveis": "AB"},
                      {"place_id": "v", "vertical": "advocacia", "mensagem_variante": "", "ab_elegiveis": "AB"},
                      {"place_id": "f", "vertical": "advocacia", "mensagem_variante": "C", "ab_elegiveis": "AB"},
                      {"place_id": "i", "vertical": "advocacia", "mensagem_variante": "A", "ab_elegiveis": "AXB"},
                      {"place_id": "s1", "vertical": "advocacia", "mensagem_variante": "A", "ab_elegiveis": "AB", "status": "enviado"},
                      {"place_id": "s2", "vertical": "advocacia", "mensagem_variante": "A", "ab_elegiveis": "ab", "status": "recusado"}]
            res = self.alocar(linhas, [self.pedido("n1", lead=self.AB), self.pedido("n2", lead=self.AB)])
            self.assertEqual((res["n1"]["letra"], res["n2"]["letra"]), ("B", "B"))  # A 2 × B 0: os dois novos vão para B

        def test_eua_e_so_a(self):
            res = self.alocar([], [self.pedido("us", lead=self.ABC, eua=True), self.pedido("so-a", lead={})])
            self.assertEqual((res["us"]["letra"], res["us"]["elegiveis"]), ("EN", ""))
            self.assertIn("Hi, how are you? This is Rômulo.", res["us"]["molde"])
            self.assertEqual((res["so-a"]["letra"], res["so-a"]["elegiveis"]), ("A", "A"))

        def test_sem_demo_a_ou_c_nunca_b(self):
            # 15/10/2026: sem demo, a A também vale (decisão do Rômulo); a B continua só com demo.
            linhas = [{"place_id": f"c{i}", "vertical": "advocacia", "mensagem_variante": "C", "ab_elegiveis": "AC"} for i in range(3)]
            res = self.alocar(linhas, [self.pedido("com-raio-x", lead={**self.ABC, "sem_demo": True}),
                                       self.pedido("sem-raio-x", lead={**self.AB, "sem_demo": True}),
                                       self.pedido("us", lead={**self.ABC, "sem_demo": True}, eua=True)])
            # O estrato AC já tem 3 C: o novo vai para a A.
            self.assertEqual((res["com-raio-x"]["letra"], res["com-raio-x"]["elegiveis"]), ("A", "AC"))
            self.assertIn("montei, por conta própria, uma demonstração", res["com-raio-x"]["molde"])
            self.assertEqual((res["sem-raio-x"]["letra"], res["sem-raio-x"]["elegiveis"]), ("A", "A"))
            self.assertIsNone(res["us"])  # fora do Brasil, sem demo, segue a fila do gerador
            # O estrato "AC" não mexe no ABC do mesmo nicho: o próximo com demo começa do zero.
            com_demo = self.alocar(linhas, [self.pedido("novo", lead=self.ABC)])["novo"]
            antiga = rodar_js(codigo_js("site-mensagem.js") + "\nreturn varianteDe('novo', false, " + json.dumps(self.ABC) + ").letra;", {})
            self.assertEqual(com_demo["letra"], antiga)

        def test_no_balcao_so_com_raio_x_sorteia_entre_a_e_c(self):
            avulso = {"raio_x_url": "https://raio-x-prumo.vercel.app/lead", "raio_x_pontos": 3}
            por = cruzar(planilha=[linha(f"pid-{i}", "novo", vertical="advocacia", **self.AB) for i in range(4)],
                         recibos=[(f"lead-{i}", {"place_id": f"pid-{i}", "nome": f"lead-{i}", **avulso}) for i in range(4)], marcas=[])
            self.assertEqual(sorted((i[0]["mensagem_variante"], i[0]["ab_elegiveis"]) for i in por.values()),
                             [("A", "AC"), ("A", "AC"), ("C", "AC"), ("C", "AC")])
            # Sem pontos válidos a C não cabe: sai a A, sem demo.
            por = cruzar(planilha=[linha("pid-x", "novo", **self.AB)],
                         recibos=[("lead-x", {"place_id": "pid-x", "nome": "x", "raio_x_url": avulso["raio_x_url"]})], marcas=[])
            self.assertEqual((por["pid-x"][0]["status"], por["pid-x"][0]["mensagem_variante"], por["pid-x"][0]["ab_elegiveis"]),
                             ("pronto", "A", "A"))

        def test_nicho_vazio_e_um_estrato_so_e_grafia_nao_separa(self):
            linhas = [{"place_id": "x1", "vertical": "", "mensagem_variante": "A", "ab_elegiveis": "AB"},
                      {"place_id": "x2", "mensagem_variante": "A", "ab_elegiveis": "AB"},
                      {"place_id": "x3", "vertical": "  ", "mensagem_variante": "A", "ab_elegiveis": "AB"}]
            res = self.alocar(linhas, [self.pedido("n1", nicho=None, lead=self.AB), self.pedido("n2", nicho="", lead=self.AB),
                                       self.pedido("n3", nicho=" ", lead=self.AB)])
            self.assertEqual([res[p]["letra"] for p in ("n1", "n2", "n3")], ["B", "B", "B"])
            linhas = [{"place_id": "y", "vertical": "Clínica Odontológica", "mensagem_variante": "A", "ab_elegiveis": "AB"}]
            self.assertEqual(self.alocar(linhas, [self.pedido("n", nicho="clinica  odontologica ", lead=self.AB)])["n"]["letra"], "B")

        def test_no_balcao_dois_da_mesma_rodada_e_o_enviado_conta(self):
            recibos = [(f"lead-{i}", recibo(f"pid-{i}", f"lead-{i}")) for i in range(2)]
            novos = [linha(f"pid-{i}", "novo", vertical="advocacia", **self.AB) for i in range(2)]
            # Estrato vazio: os dois novos da mesma rodada não caem na mesma letra.
            por = cruzar(planilha=novos, recibos=recibos, marcas=[])
            self.assertEqual(sorted(por[f"pid-{i}"][0]["mensagem_variante"] for i in range(2)), ["A", "B"])
            self.assertEqual({por[f"pid-{i}"][0]["ab_elegiveis"] for i in range(2)}, {"AB"})
            # Dois enviados com A no estrato (sem recibo: nada a gravar para eles) empurram os dois novos para B.
            enviados = [linha(f"env-{i}", "enviado", vertical="advocacia", site_url="https://x", mensagem_variante="A",
                              ab_elegiveis="AB", **self.AB) for i in range(2)]
            por = cruzar(planilha=enviados + novos, recibos=recibos, marcas=[])
            self.assertEqual([por[f"pid-{i}"][0]["mensagem_variante"] for i in range(2)], ["B", "B"])
            self.assertFalse(any(p.startswith("env-") for p in por))

        def test_no_balcao_pronto_com_conjunto_salvo_nao_muda_de_rodada_para_rodada(self):
            planilha = [linha(f"pid-{i}", "novo", vertical="advocacia", **self.AB) for i in range(6)]
            recibos = [(f"lead-{i}", recibo(f"pid-{i}", f"lead-{i}")) for i in range(6)]
            primeira = cruzar(planilha=planilha, recibos=recibos, marcas=[])
            # A planilha depois da escrita: cada um "pronto" com a letra e o conjunto gravados.
            gravada = [linha(f"pid-{i}", "pronto", vertical="advocacia", **self.AB,
                             mensagem_variante=primeira[f"pid-{i}"][0]["mensagem_variante"],
                             ab_elegiveis=primeira[f"pid-{i}"][0]["ab_elegiveis"]) for i in range(6)]
            # Mais um lead novo no mesmo nicho não mexe nos que já estão prontos.
            gravada.append(linha("pid-9", "novo", vertical="advocacia", **self.AB))
            segunda = cruzar(planilha=gravada, recibos=recibos + [("lead-9", recibo("pid-9", "lead-9"))], marcas=[])
            for i in range(6):
                self.assertEqual(segunda[f"pid-{i}"][0]["mensagem_variante"], primeira[f"pid-{i}"][0]["mensagem_variante"])
            letras = [primeira[f"pid-{i}"][0]["mensagem_variante"] for i in range(6)]
            self.assertEqual((letras.count("A"), letras.count("B")), (3, 3))

    class SobPedido(unittest.TestCase):
        """14/10/2026: o recibo do Raio-X avulso (sem site_url) leva o lead a "pronto" só com a C."""
        AVULSO = {"raio_x_url": "https://raio-x-prumo.vercel.app/lead", "raio_x_pontos": 3, "raio_x_projeto": "prumo-raio-x"}

        def so_raio_x(self, pid, slug):
            return {"place_id": pid, "nome": slug, "slug": slug, **self.AVULSO}

        def test_novo_so_com_raio_x_vira_pronto_com_a_ou_c_nunca_b(self):
            por = cruzar(planilha=[linha(f"pid-{i}", "novo", nota="4.9", avaliacoes="34") for i in range(40)],
                         recibos=[(f"lead-{i}", self.so_raio_x(f"pid-{i}", f"lead-{i}")) for i in range(40)], marcas=[])
            self.assertEqual({i[0]["mensagem_variante"] for i in por.values()}, {"A", "C"})
            for itens in por.values():
                item = itens[0]
                self.assertEqual((item["status"], item["site_url"], item["raio_x_url"]), ("pronto", "", self.AVULSO["raio_x_url"]))
                texto = unquote(item["wa_me"]).split("?text=")[1]
                self.assertIn("anotei numa página" if item["mensagem_variante"] == "C" else "montei, por conta própria", texto)

        def test_lead_sem_recibo_vira_pronto_com_a(self):
            # 15/10/2026: na fila do gerador (ou o gerador falhou), sem recibo nenhum: sai a A, sem demo.
            planilha = [linha("pid-n", "novo", briefing="**Elogiam:** a eficiência contra cupins e escorpiões."),
                        linha("pid-p", "pronto", mensagem_variante="A", ab_elegiveis="A"),
                        linha("pid-us", "novo", telefone="+1 305-642-0504"), linha("pid-sem", "novo", telefone=""),
                        linha("pid-env", "enviado"), linha("pid-x", "novo"), linha("TESTE-1", "novo")]
            por = cruzar(planilha=planilha, recibos=[], marcas=[])
            n = por["pid-n"][0]
            self.assertEqual((n["status"], n["site_url"], n["mensagem_variante"], n["ab_elegiveis"], n["site_versao"]),
                             ("pronto", "", "A", "A", ""))
            self.assertTrue(n["wa_link"].endswith("/enviar?place_id=pid-n"))
            self.assertEqual(unquote(n["wa_me"]).split("?text=")[1],
                             "Oi, tudo bem? Aqui é o Rômulo. Encontrei vocês no Google e montei, por conta própria, uma "
                             "demonstração de site da Padaria pid-n, destacando o que os clientes mais elogiam: a eficiência "
                             "contra cupins e escorpiões. Posso te mandar o link para dar uma olhada? É sem compromisso.")
            self.assertEqual((por["pid-p"][0]["status"], por["pid-p"][0]["mensagem_variante"]), ("pronto", "A"))
            # EUA, sem telefone, já enviado, descartado e linha de teste: nada.
            for pid in ("pid-us", "pid-sem", "pid-env", "TESTE-1"):
                self.assertNotIn(pid, por)
            self.assertEqual(por["pid-x"], [{"place_id": "pid-x", "status": "descartado"}])

        def test_recibo_descartado_ou_copia_nao_e_lead_sem_recibo(self):
            por = cruzar(planilha=[linha("pid-z", "novo")], recibos=[("_descartados/bar-z", recibo("pid-z", "bar-z"))],
                         marcas=[], descartes=[("", None)])
            self.assertNotIn("pid-z", por)

        def test_eua_sem_demo_nao_vira_pronto(self):
            por = cruzar(planilha=[linha("pid-e", "novo", telefone="+1 305-642-0504")],
                         recibos=[("dental-e", self.so_raio_x("pid-e", "dental-e"))], marcas=[])
            self.assertNotIn("pid-e", por)

        def test_enviado_so_com_raio_x_nao_e_reescrito_toda_hora(self):
            wa = "https://wa.me/5527999887766?text=Fiz%20um%20raio-x"
            por = cruzar(planilha=[linha("pid-c", "enviado", wa_me=wa, mensagem_variante="C")],
                         recibos=[("_em-conversa/clinica-c", self.so_raio_x("pid-c", "clinica-c"))], marcas=[])
            self.assertNotIn("pid-c", por)

        def test_demo_pedido_depois_ganha_o_site_sem_trocar_a_primeira_mensagem(self):
            wa = "https://wa.me/5527999887766?text=Fiz%20um%20raio-x"
            rec = {**self.so_raio_x("pid-c", "clinica-c"), "site_url": "https://demo-clinica-c.vercel.app", "vercel_project": "demo-clinica-c"}
            c = cruzar(planilha=[linha("pid-c", "enviado", wa_me=wa, mensagem_variante="C")],
                       recibos=[("_em-conversa/clinica-c", rec)], marcas=[])["pid-c"][0]
            self.assertEqual((c["status"], c["site_url"], c["wa_me"], c["raio_x_url"]),
                             ("enviado", "https://demo-clinica-c.vercel.app", wa, self.AVULSO["raio_x_url"]))
            self.assertNotIn("mensagem_variante", c)

        def test_segunda_mensagem_sem_demo_e_depois_do_demo(self):
            l = {"nome": "Clínica C", "wa_me": "https://wa.me/5527999887766?text=x", "mensagem_variante": "C",
                 "raio_x_url": self.AVULSO["raio_x_url"], "site_url": ""}
            com = {**l, "site_url": "https://demo-clinica-c.vercel.app"}
            r = rodar_js(codigo_js("site-mensagem.js") + "\nreturn [segundaDe(" + json.dumps(l) + "), segundaDe("
                         + json.dumps(com) + "), segundaDe(" + json.dumps({**l, "mensagem_variante": "A"}) + ")];", {})
            sem, depois, nada = r
            self.assertTrue(sem["texto"].startswith("Aqui está o raio-x da Clínica C:\nhttps://raio-x-prumo.vercel.app/lead"))
            self.assertIn("também monto uma demonstração de site", sem["texto"])
            self.assertNotIn("R$", sem["texto"])
            self.assertTrue(depois["texto"].startswith("Aqui está a demonstração de site da Clínica C:\nhttps://demo-clinica-c"))
            self.assertIn("R$ 690", depois["texto"])
            self.assertEqual(nada["link"], "")  # sem raio-x da C e sem demo: não há o que mandar

    class PastaDoLead(unittest.TestCase):
        def test_copia_do_modo_personalizado_nao_e_a_pasta(self):
            nos = nos_de_arquivos("Ler recibos da pasta auto", "Ler o JSON do recibo", "recibo", RECIBOS)
            r = rodar_js(PASTA_DO_LEAD_JS + "\nreturn [{ json: { pasta, a: naRaiz('pid-a'), c: naRaiz('pid-c') } }];", nos)[0]["json"]
            self.assertEqual(r["pasta"]["pid-a"], "padaria-a")
            self.assertEqual(r["pasta"]["pid-c"], "_em-conversa/clinica-c")
            self.assertEqual((r["a"], r["c"]), (True, False))

    class GateDeEnvio(unittest.TestCase):
        """18/10/2026: o gate de pré-envio da 1ª mensagem (gate-de-envio.js) no cruzamento do Balcão.
        O lead ruim tem lixo no nome ("Padaria {X}": marca sem preencher), então o texto sai quebrado."""
        RUIM = "pid-03x"  # no meio da ordem de place_id (a alocação sorteia nessa ordem), para o barrado poder gastar a vez de outros

        def rodada(self, modo, n=8, ruim=True, status="novo", **extra):
            pids = [f"pid-{i:02d}" for i in range(n)] + ([self.RUIM] if ruim else [])
            planilha = [linha(p, status, nota="4.9", avaliacoes="34", vertical="advocacia",
                              **({"nome": "Padaria {X}"} if p == self.RUIM else {}), **extra) for p in pids]
            recibos = [(f"lead-{p}", recibo(p, f"lead-{p}")) for p in pids]
            return cruzar(planilha=planilha, recibos=recibos, marcas=[], descartes=[], dossies=[], modo=modo)

        def test_avisar_mantem_pronto_e_grava_o_motivo(self):
            por = self.rodada("avisar")
            ruim = por[self.RUIM][0]
            self.assertEqual(ruim["status"], "pronto")
            self.assertTrue(ruim["wa_link"].endswith("/enviar?place_id=" + self.RUIM))
            self.assertTrue(ruim["gate_de_envio"].startswith("aviso: "), ruim["gate_de_envio"])
            self.assertIn("marca sem preencher", ruim["gate_de_envio"])
            for pid, itens in por.items():
                if pid != self.RUIM:
                    self.assertEqual((itens[0]["status"], itens[0]["gate_de_envio"]), ("pronto", ""), pid)

        def test_desligado_nao_escreve_a_coluna_e_o_resto_e_igual(self):
            desligado, avisar = self.rodada("desligado"), self.rodada("avisar")
            for itens in desligado.values():
                self.assertNotIn("gate_de_envio", itens[0])
            sem_coluna = {p: [{k: v for k, v in i.items() if k != "gate_de_envio"} for i in itens] for p, itens in avisar.items()}
            self.assertEqual(desligado, sem_coluna)

        def test_bloquear_novo_nao_vira_pronto_e_so_ganha_o_motivo(self):
            ruim = self.rodada("bloquear")[self.RUIM]
            self.assertEqual(len(ruim), 1)
            self.assertEqual(set(ruim[0]), {"place_id", "gate_de_envio"})
            self.assertTrue(ruim[0]["gate_de_envio"].startswith("barrado: "), ruim[0])

        def test_bloquear_pronto_que_reprova_volta_a_novo_sem_link(self):
            ruim = self.rodada("bloquear", status="pronto")[self.RUIM][0]
            self.assertEqual((ruim["status"], ruim["wa_me"], ruim["wa_link"], ruim["mensagem_variante"], ruim["ab_elegiveis"]),
                             ("novo", "", "", "", ""))
            self.assertTrue(ruim["gate_de_envio"].startswith("barrado: "))

        def test_barrado_nao_gasta_a_vez_de_ninguem(self):
            # As letras dos bons com o barrado na rodada (bloquear) = as letras deles sem o barrado existir.
            def letras(por):
                return {p: i[0]["mensagem_variante"] for p, i in por.items() if p != self.RUIM}
            com = letras(self.rodada("bloquear"))
            sem = letras(self.rodada("bloquear", ruim=False))
            self.assertEqual(com, sem)
            self.assertEqual(len(com), 8)
            self.assertEqual({com[p] for p in com}, {"A", "B"})  # nota boa, sem Raio-X: A e B

    carga = unittest.TestLoader()
    suite = unittest.TestSuite(carga.loadTestsFromTestCase(c) for c in (Cruzar, Variante, SobPedido, Alocacao, PastaDoLead, GateDeEnvio))
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
            # A linha de mentira não tem nota (a B não entra); a C entra se o recibo REAL do lead tiver
            # Raio-X. Por isso a letra é A ou C (14/10/2026: o teste exigia A e reprovava quando o lead
            # escolhido ganhou Raio-X), e `ab_elegiveis` tem que dizer o mesmo conjunto do sorteio.
            (f"pronto personalizado: personalizado-v{versao}, letra e ab_elegiveis",
             bool(a) and a[0].get("site_versao") == f"personalizado-v{versao}"
             and (a[0].get("mensagem_variante"), a[0].get("ab_elegiveis")) in {("A", "A"), ("A", "AC"), ("C", "AC")}),
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
