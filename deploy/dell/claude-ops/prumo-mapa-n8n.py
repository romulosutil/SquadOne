"""Diagnóstico do dono -> pacote do Mapa na fila do Dell (pendência P3 do PRUMO).

Acrescenta ao fluxo "PRUMO — Diagnóstico do dono" um ramo que, para cada
resposta completa de um prospect (o mesmo critério que fecha o Índice no
'Calcular diagnóstico'), grava um pacote JSON em estado/mapa-fila/. No host,
prumo-mapa.path dispara o prumo-mapa (deploy/dell/prumo-mapa/), que gera o
rascunho do Mapa em ~/prumo-entregas/ e avisa o Rômulo. Nada vai ao cliente.

Um pacote por resposta (ID + carimbo): a memória fica em
estado/prumo-mapa-feitos.json, como em prumo-aviso-unico.py (a memória do
fluxo não serve: o id do fluxo é UUID). A chave só é gravada depois de o
pacote estar na fila; pacote que falhou volta na execução seguinte. Arquivo
ausente = memória vazia: os pacotes voltam, e o prumo-mapa descarta o que já
tem pasta (mesmo resposta_id).

Leads do Raio-X (15/10/2026): o Raio-X do Dell (raio-x.py) convida para o Mapa
com o formulário já preenchido em "Empresa" = "<place_id>::<nome>". Esses leads
não estão na planilha de prospects; o ID é procurado no retrato da planilha do
Balcão (estado/site-leads.json, que o fluxo 07 grava aos :20 de cada hora e que
tem todo lead com Raio-X publicado). Achado, a resposta completa vira pacote como
a de um prospect (cidade do retrato, segmento vazio, `lead_do_site: true`), e o
'Calcular diagnóstico' não manda o aviso de "fora dos prospects" para ela. Por
que o retrato e não acrescentar o lead à planilha de prospects: nada novo escreve
na planilha, nenhuma credencial nova, e a fila de prospects (Etapa, Índice,
briefing) continua só do funil B2B. O ID desconhecido segue no aviso de sempre.

Quase aditivo: nós "Mapa: ...", uma saída nova de "Ler respostas do formulário"
(o ramo do pacote, abaixo do ramo do diagnóstico: a ordem v1 roda aquele ramo
primeiro), dois nós "Mapa: ... leads do site" entre "Extrair avisados" e o
formulário (os dois ramos leem o retrato) e um trecho marcado no 'Calcular
diagnóstico'. Rodar de novo troca tudo pelos atuais. prumo-simples.py (pontuacao)
recria o fluxo JÁ COM o ramo: carrega este arquivo e chama nos(), ligar() e
marcar_diagnostico(), então não é preciso rodar este script depois dele. Rodar
este sozinho serve para aplicar uma mudança daqui sem recriar o resto do fluxo.

Uso:
    python3 prumo-mapa-n8n.py            aplica no fluxo (backup antes)
    python3 prumo-mapa-n8n.py --teste    ensaio numa cópia temporária, sem planilha:
                                         prospects, retrato e respostas de exemplo, fila e
                                         memória de teste; roda duas vezes e confere os
                                         pacotes (o do prospect e o do lead do Raio-X).
"""
import json
import re
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

from n8n import api, put

AQUI = Path(__file__).resolve().parent
PONTUACAO = "b091d18b-106b-4f4d-ad4e-f77cdeaa7a5f"
NO_CONTAINER = "/home/node/.n8n-files/estado/"
FILA, FEITOS = NO_CONTAINER + "mapa-fila/", NO_CONTAINER + "prumo-mapa-feitos.json"
SITE_LEADS = NO_CONTAINER + "site-leads.json"
ORIGEM = "Ler respostas do formulário"
ANTES_DO_FORMULARIO = "Extrair avisados"  # prumo-aviso-unico.py: Ler prospects -> Ler/Extrair avisados -> formulário
LER_LEADS, EXTRAIR_LEADS = "Mapa: ler leads do site", "Mapa: extrair leads do site"
DIAGNOSTICO = "Calcular diagnóstico"
PREFIXO = "Mapa: "
BACKUPS = Path.home() / ".local/share/claude-ops/backups"

# Colunas de aprofundamento do formulário (início do título), por ID do roteiro.
APROFUNDAMENTOS = {
    "AR1": "Quantos pedidos desse tipo chegam até você por semana",
    "AR2": "Quantas decisões de crédito por semana",
    "AD1": "Registrar aqui o resultado do teste direto",
    "BR1": "De cada 10 compras, quantas",
    "CR1": "Quantas decisões desse tipo chegam até você por semana",
    "DR1": "O que exatamente travaria",
    "DM1": "Quantas vezes isso aconteceu nos últimos 3 meses",
}

# Leads do Raio-X: place_id -> linha do retrato (site-leads.json). Usado nos dois ramos.
LEADS_DO_SITE_JS = """const leadsDoSite = (() => {  // leads do Raio-X (retrato da planilha do Balcão, site-leads.json)
  try {
    const d = $('Mapa: extrair leads do site').first().json.data;
    return new Map((d && Array.isArray(d.leads) ? d.leads : [])
      .map(l => [String(l.place_id ?? '').trim(), l]).filter(([k]) => k));
  } catch { return new Map(); }  // retrato ausente: só os prospects
})();
"""

# O trecho do 'Calcular diagnóstico': resposta de lead do Raio-X não é "fora dos prospects".
DIAG_LEADS = "// [mapa-leads-do-site] (prumo-mapa-n8n.py)\n" + LEADS_DO_SITE_JS
DIAG_ANCORA_LEADS = "const saida = [];\n"
DIAG_PULA = ("  if (!p && leadsDoSite.has(id)) continue;  "
             "// [mapa-leads-do-site] lead do Raio-X: o ramo 'Mapa: ...' monta o pacote\n")
DIAG_ANCORA_PULA = "  if (!p) {\n"

MONTAR = """// Resposta completa de um prospect ou de um lead do Raio-X -> pacote do Mapa
// (pendência P3 do PRUMO). Mesmo critério do 'Calcular diagnóstico' (empresa
// conhecida, 16 respostas válidas), com a resposta inteira. Nota 0 a 3 = posição
// da opção (roteiro a/b/c/d). Lead do Raio-X: ID = place_id do retrato da planilha.
// Um pacote por resposta: memória em estado/prumo-mapa-feitos.json.
const QUESTIONS = __PERGUNTAS__;
const APROFUNDAMENTOS = __APROFUNDAMENTOS__;
const feitos = (() => {
  try {
    const d = $('Mapa: extrair feitos').first().json.data;
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }  // arquivo ausente ou ilegível: memória vazia
})();
const coluna = (r, prefixo) => Object.keys(r).find(k => k.startsWith(prefixo));
const texto = (r, prefixo) => { const c = coluna(r, prefixo); return c ? String(r[c] ?? '').trim() : ''; };
const prospects = new Map($('Ler prospects').all()
  .map(i => [String(i.json['ID'] ?? '').trim().toLowerCase(), i.json]).filter(([k]) => k));
__LEADS_DO_SITE__const recebidas = new Set();
const saida = [];
for (const r of $('Ler respostas do formulário').all().map(i => i.json)) {
  if (!String(r['Empresa'] ?? '').trim()) continue;
  const ref = String(r['Empresa']).trim();
  const sep = ref.indexOf('::');
  const idRef = sep > 0 ? ref.slice(0, sep).trim() : '';
  const p = idRef ? prospects.get(idRef.toLowerCase()) : undefined;
  const s = !p && idRef ? leadsDoSite.get(idRef) : undefined;
  if (!p && !s) continue;  // empresa desconhecida: o ramo do diagnóstico já avisa
  const respostas = {};
  let soma = 0;
  for (const q of QUESTIONS) {
    const resposta = texto(r, q.prefix);
    const nota = q.choices.indexOf(resposta);
    if (nota >= 0) { respostas[q.id] = { resposta, nota }; soma += nota + 1; }
  }
  if (Object.keys(respostas).length < QUESTIONS.length) continue;  // incompleta: espera
  const id = p ? String(p['ID']).trim() : idRef;
  const carimbo = String(r['Carimbo de data/hora'] ?? r.row_number ?? '').trim();
  const chave = (id + '|' + carimbo).toLowerCase();
  if (chave in feitos || recebidas.has(chave)) continue;
  recebidas.add(chave);
  const aprofundamentos = {};
  for (const [qid, prefixo] of Object.entries(APROFUNDAMENTOS)) {
    const t = texto(r, prefixo);
    if (t) aprofundamentos[qid] = t;
  }
  const pacote = {
    versao: 1, origem: 'n8n · ' + $workflow.name, resposta_id: id + '|' + carimbo, prospect_id: id,
    empresa: ref.slice(sep + 2).trim(), cidade: String((p ? p['Cidade'] : s.cidade) ?? '').trim() || null,
    segmento: p ? String(p['Segmento'] ?? '').trim() || null : null, carimbo,
    indice_100: Math.round(soma / (4 * QUESTIONS.length) * 1000) / 10,  // a escala da planilha
    gerado_em: new Date().toISOString(),
    sessoes: [{ papel: texto(r, 'Sessão / papel') || 'Dono', data: texto(r, 'Data da entrevista') || null,
                respostas, aprofundamentos }],
  };
  if (s) pacote.lead_do_site = true;  // veio do convite do Raio-X do Dell, não da planilha de prospects
  const arquivo = (id + '-' + carimbo).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.json';
  saida.push({ json: { chave, arquivo, empresa: pacote.empresa }, binary: { data: {
    data: Buffer.from(JSON.stringify(pacote, null, 1), 'utf8').toString('base64'),
    mimeType: 'application/json', fileName: arquivo } } });
}
return saida;"""

LEMBRAR = """// Roda depois de os pacotes estarem na fila: o que falhou não é marcado e
// volta na próxima execução.
let feitos = {};
try {
  const d = $('Mapa: extrair feitos').first().json.data;
  if (d && typeof d === 'object' && !Array.isArray(d)) feitos = { ...d };
} catch {}
const agora = new Date().toISOString();
for (const x of $('Mapa: montar pacote').all()) if (x.json.chave) feitos[x.json.chave] = agora;
return [{ json: { feitos: Object.keys(feitos).length }, binary: { data: {
  data: Buffer.from(JSON.stringify(feitos, null, 1), 'utf8').toString('base64'),
  mimeType: 'application/json', fileName: 'prumo-mapa-feitos.json' } } }];"""


def perguntas(wf) -> str:
    """As 16 perguntas vêm do código em produção (como prumo-simples.py), sem redigitar."""
    for n in wf["nodes"]:
        m = re.search(r"const QUESTIONS = (\[.*?\n\]);", n["parameters"].get("jsCode", ""), re.S)
        if m:
            return m.group(1)
    return (AQUI / "prumo-perguntas.js").read_text(encoding="utf-8")


def nos(perguntas_js: str, fila: str = FILA, feitos: str = FEITOS, x: int = 660, y: int = 480,
        site_leads: str = SITE_LEADS) -> list[dict]:
    tolerante = {"executeOnce": True, "alwaysOutputData": True, "onError": "continueRegularOutput"}
    montar = MONTAR.replace("__PERGUNTAS__", perguntas_js).replace(
        "__APROFUNDAMENTOS__", json.dumps(APROFUNDAMENTOS, ensure_ascii=False, indent=1)).replace(
        "__LEADS_DO_SITE__", LEADS_DO_SITE_JS)
    return [
        {"id": "mapa-ler-leads-do-site", "name": LER_LEADS, "type": "n8n-nodes-base.readWriteFile",
         "typeVersion": 1.1, "position": [770, -100], **tolerante,
         "parameters": {"operation": "read", "fileSelector": site_leads, "options": {}}},
        {"id": "mapa-extrair-leads-do-site", "name": EXTRAIR_LEADS, "type": "n8n-nodes-base.extractFromFile",
         "typeVersion": 1, "position": [990, -100], **tolerante,
         "parameters": {"operation": "fromJson", "binaryPropertyName": "data", "options": {}}},
        {"id": "mapa-ler-feitos", "name": "Mapa: ler feitos", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [x, y], **tolerante, "parameters": {"operation": "read", "fileSelector": feitos, "options": {}}},
        {"id": "mapa-extrair-feitos", "name": "Mapa: extrair feitos", "type": "n8n-nodes-base.extractFromFile",
         "typeVersion": 1, "position": [x + 220, y], **tolerante,
         "parameters": {"operation": "fromJson", "binaryPropertyName": "data", "options": {}}},
        {"id": "mapa-montar", "name": "Mapa: montar pacote", "type": "n8n-nodes-base.code", "typeVersion": 2,
         "position": [x + 440, y], "parameters": {"mode": "runOnceForAllItems", "jsCode": montar}},
        {"id": "mapa-gravar", "name": "Mapa: gravar pacote", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [x + 660, y], "parameters": {
             "operation": "write", "dataPropertyName": "data",
             "fileName": "={{ '" + fila + "' + $json.arquivo }}"}},
        {"id": "mapa-lembrar", "name": "Mapa: lembrar feitos", "type": "n8n-nodes-base.code", "typeVersion": 2,
         "position": [x + 880, y], "executeOnce": True,
         "parameters": {"mode": "runOnceForAllItems", "jsCode": LEMBRAR}},
        {"id": "mapa-gravar-feitos", "name": "Mapa: gravar feitos", "type": "n8n-nodes-base.readWriteFile",
         "typeVersion": 1.1, "position": [x + 1100, y],
         "parameters": {"operation": "write", "dataPropertyName": "data", "fileName": feitos}},
    ]


def ligar(con: dict, origem: str = ORIGEM, antes: str = ANTES_DO_FORMULARIO) -> None:
    def para(n):
        return {"node": n, "type": "main", "index": 0}
    # antes -> ler/extrair leads do site -> formulário (os dois ramos leem o retrato)
    saidas_antes = con.setdefault(antes, {"main": [[]]})["main"][0]
    saidas_antes[:] = [d for d in saidas_antes if d["node"] not in (origem, LER_LEADS)] + [para(LER_LEADS)]
    con[LER_LEADS] = {"main": [[para(EXTRAIR_LEADS)]]}
    con[EXTRAIR_LEADS] = {"main": [[para(origem)]]}
    saidas = con.setdefault(origem, {"main": [[]]})["main"][0]
    if not any(d["node"] == "Mapa: ler feitos" for d in saidas):
        saidas.append(para("Mapa: ler feitos"))
    cadeia = ["Mapa: ler feitos", "Mapa: extrair feitos", "Mapa: montar pacote", "Mapa: gravar pacote",
              "Mapa: lembrar feitos", "Mapa: gravar feitos"]
    for de, ate in zip(cadeia, cadeia[1:]):
        con[de] = {"main": [[para(ate)]]}


def tirar(wf: dict) -> None:
    """Remove os nós "Mapa: ..." e as ligações para eles (para reaplicar); quem apontava para
    o retrato volta a apontar para o formulário, e o trecho do 'Calcular diagnóstico' sai."""
    wf["nodes"] = [n for n in wf["nodes"] if not n["name"].startswith(PREFIXO)]
    con = {k: v for k, v in wf["connections"].items() if not k.startswith(PREFIXO)}
    for v in con.values():
        for saida in v.get("main", []):
            volta = any(d["node"] == LER_LEADS for d in saida) and not any(d["node"] == ORIGEM for d in saida)
            saida[:] = [d for d in saida if not d["node"].startswith(PREFIXO)]
            if volta:
                saida.append({"node": ORIGEM, "type": "main", "index": 0})
    wf["connections"] = con
    for n in wf["nodes"]:
        if n["name"] == DIAGNOSTICO:
            n["parameters"]["jsCode"] = n["parameters"]["jsCode"].replace(DIAG_LEADS, "").replace(DIAG_PULA, "")


def marcar_diagnostico(wf: dict) -> None:
    """No 'Calcular diagnóstico', resposta de lead do Raio-X não vira aviso de "fora dos prospects"."""
    no = next((n for n in wf["nodes"] if n["name"] == DIAGNOSTICO), None)
    if no is None:
        raise SystemExit(f"Nó '{DIAGNOSTICO}' não existe mais no fluxo; nada aplicado")
    codigo = no["parameters"]["jsCode"]
    for trecho in (DIAG_ANCORA_LEADS, DIAG_ANCORA_PULA):
        if codigo.count(trecho) != 1:
            raise SystemExit(f"Código de '{DIAGNOSTICO}' mudou; trecho não achado uma vez só: {trecho!r}")
    codigo = codigo.replace(DIAG_ANCORA_LEADS, DIAG_LEADS + DIAG_ANCORA_LEADS)
    no["parameters"]["jsCode"] = codigo.replace(DIAG_ANCORA_PULA, DIAG_PULA + DIAG_ANCORA_PULA)


def main() -> None:
    wf = api("GET", f"/workflows/{PONTUACAO}")
    pasta = BACKUPS / date.today().isoformat()
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / f"{PONTUACAO}-antes-prumo-mapa-{int(time.time())}.json").write_text(
        json.dumps(wf, ensure_ascii=False, indent=1), encoding="utf-8")
    for no in (ORIGEM, ANTES_DO_FORMULARIO):
        if no not in {n["name"] for n in wf["nodes"]}:
            raise SystemExit(f"Nó '{no}' não existe mais no fluxo (prumo-aviso-unico.py?); nada aplicado")
    tirar(wf)
    marcar_diagnostico(wf)
    wf["nodes"] += nos(perguntas(wf))
    ligar(wf["connections"])
    put(wf)
    api("POST", f"/workflows/{PONTUACAO}/activate")
    print(f"Diagnóstico do dono: resposta completa (prospect ou lead do Raio-X) vira pacote do Mapa em {FILA}")


# ------------------------------------------------------------------ ensaio

def teste() -> None:
    """Cópia temporária com o ramo do Mapa e o 'Calcular diagnóstico' (com o trecho daqui), com
    prospects, retrato e respostas de exemplo (Distribuidora Vale Norte e um lead do Raio-X,
    fictícios). Não lê nem grava planilha; fila, memória e retrato são arquivos de teste."""
    estado = Path.home() / ".local/share/n8n-estado"
    fila_host, feitos_host = estado / "mapa-teste", estado / "prumo-mapa-feitos-teste.json"
    leads_host = estado / "site-leads-teste.json"
    fila_host.mkdir(exist_ok=True)
    for a in fila_host.glob("*.json"):  # os pacotes do ensaio anterior (ficam para conferir até o próximo)
        a.unlink()
    feitos_host.unlink(missing_ok=True)
    wf_real = api("GET", f"/workflows/{PONTUACAO}")
    perg = perguntas(wf_real)
    questoes = [(m.group(1), m.group(2), re.findall(r"'([^']*)'", m.group(3))) for m in re.finditer(
        r"\{ id: '(\w+)', area: '[^']*', prefix: '([^']*)', choices: \[(.*?)\] \}", perg)]
    # No repo: deploy/dell/prumo-mapa/exemplos; instalado: ~/.local/share/prumo-mapa/exemplos.
    arq = AQUI.parent / "prumo-mapa/exemplos/pacote-n8n-vale-norte.json"
    if not arq.is_file():
        raise SystemExit(f"exemplo não encontrado: {arq}")
    exemplo = json.loads(arq.read_text(encoding="utf-8"))
    s = exemplo["sessoes"][0]
    linha = {"row_number": 2, "Carimbo de data/hora": exemplo["carimbo"],
             "Empresa": f"{exemplo['prospect_id']}::{exemplo['empresa']}",
             "Sessão / papel de quem está respondendo": "Dono", "Data da entrevista": s["data"]}
    for id_, prefixo, opcoes in questoes:
        linha[prefixo + " (título completo no formulário)"] = s["respostas"][id_]["resposta"]
    for id_, t in s["aprofundamentos"].items():
        linha[APROFUNDAMENTOS[id_] + "? (aprofundamento)"] = t
    incompleta = {k: v for k, v in linha.items() if not k.startswith(questoes[0][1])}
    incompleta.update({"row_number": 3, "Empresa": "outro-id::Empresa Incompleta"})
    fora = dict(linha, row_number=4, Empresa="sem-prospect::Empresa Fora da Lista")
    # O lead do Raio-X: o link do convite preenche "<place_id>::<nome>" (raio-x.py, mapa_link_do_lead).
    pid_site = "ChIJensaioRaioXPrumo"
    do_site = dict(linha, row_number=5, Empresa=f"{pid_site}::Clínica Ensaio do Raio-X")
    leads_host.write_text(json.dumps({"geradoEm": "2026-10-15T12:20:00.000Z", "leads": [
        {"place_id": pid_site, "nome": "Clínica Ensaio do Raio-X", "cidade": "Vitória", "status": "enviado"}]},
        ensure_ascii=False), encoding="utf-8")
    prospects = [{"ID": exemplo["prospect_id"], "Empresa": exemplo["empresa"], "Cidade": exemplo["cidade"],
                  "Segmento": exemplo["segmento"], "Etapa": "Convite enviado"},
                 {"ID": "outro-id", "Empresa": "Empresa Incompleta", "Cidade": "", "Segmento": "", "Etapa": "Revisar"}]
    stub = lambda nome, itens, pos: {  # noqa: E731
        "id": nome, "name": nome, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos,
        "parameters": {"mode": "runOnceForAllItems",
                       "jsCode": f"return {json.dumps(itens, ensure_ascii=False)}.map(json => ({{ json }}));"}}
    # O 'Calcular diagnóstico' de produção, com o trecho daqui (o de agora, não o que estiver no ar).
    copia = json.loads(json.dumps(wf_real))
    tirar(copia)
    marcar_diagnostico(copia)
    diag = next(n for n in copia["nodes"] if n["name"] == DIAGNOSTICO)
    diag = {"id": "diag", "name": DIAGNOSTICO, "type": diag["type"], "typeVersion": diag["typeVersion"],
            "position": [660, 250], "parameters": diag["parameters"]}
    caminho = f"prumo-mapa-teste-{int(time.time())}"
    nos_teste = [
        {"id": "w", "name": "Ensaio", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 480],
         "webhookId": "0d1e2f3a-4b5c-4d6e-8f70-" + str(int(time.time()))[-12:].rjust(12, "0"),
         "parameters": {"httpMethod": "POST", "path": caminho, "responseMode": "onReceived", "options": {}}},
        stub("Ler prospects", prospects, [220, 480]),
        stub(ORIGEM, [linha, incompleta, fora, do_site], [440, 480]),
        diag,
        *nos(perg, NO_CONTAINER + "mapa-teste/", NO_CONTAINER + "prumo-mapa-feitos-teste.json",
             site_leads=NO_CONTAINER + leads_host.name),
    ]
    con = {"Ensaio": {"main": [[{"node": "Ler prospects", "type": "main", "index": 0}]]},
           "Ler prospects": {"main": [[{"node": ORIGEM, "type": "main", "index": 0}]]},
           ORIGEM: {"main": [[{"node": DIAGNOSTICO, "type": "main", "index": 0}]]}}
    ligar(con, antes="Ler prospects")
    t = api("POST", "/workflows", {"name": "ZZ ensaio prumo-mapa (apagar)", "nodes": nos_teste, "connections": con,
                                   "settings": {"executionOrder": "v1"}})
    try:
        api("POST", f"/workflows/{t['id']}/activate")
        time.sleep(2)
        resultados = []
        for rodada in (1, 2):
            antes = {a.name for a in fila_host.glob("*.json")}
            urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:5679/webhook/{caminho}", data=b"{}", method="POST",
                headers={"Content-Type": "application/json"}), timeout=30).read()
            ex = None
            for _ in range(60):
                lista = api("GET", f"/executions?workflowId={t['id']}&limit=1")["data"]
                if len(lista) and lista[0]["status"] not in ("running", "new", "waiting") and (
                        rodada == 1 or lista[0]["id"] != resultados[0]["id"]):
                    ex = lista[0]
                    break
                time.sleep(2)
            e = api("GET", f"/executions/{ex['id']}?includeData=true")
            rd = e["data"]["resultData"]["runData"]
            itens = {n: sum(len(((r.get("data") or {}).get("main") or [[]])[0] or []) for r in runs) for n, runs in rd.items()}
            novos = sorted({a.name for a in fila_host.glob("*.json")} - antes)
            saida_diag = [i["json"] for r in rd.get(DIAGNOSTICO, [])
                          for i in (((r.get("data") or {}).get("main") or [[]])[0] or [])]
            print(f"rodada {rodada}: status={e['status']} montar={itens.get('Mapa: montar pacote')} "
                  f"gravar={itens.get('Mapa: gravar pacote', 0)} novos={novos}")
            print("  diagnóstico:", [(x.get("naFila"), x.get("ID") or x.get("id")) for x in saida_diag])
            resultados.append({"id": ex["id"], "status": e["status"], "novos": novos, "diag": saida_diag})
        ok = (resultados[0]["status"] == "success" and len(resultados[0]["novos"]) == 2
              and resultados[1]["status"] == "success" and not resultados[1]["novos"])
        # Aviso de "fora dos prospects" só para o ID desconhecido, nunca para o lead do Raio-X.
        fora_avisados = sorted(x.get("id") for x in resultados[0]["diag"] if x.get("naFila") is False)
        print("aviso fora da lista só para sem-prospect:", fora_avisados == ["sem-prospect"])
        ok = ok and fora_avisados == ["sem-prospect"]
        pacotes = {}
        for nome in resultados[0]["novos"]:
            pc = json.loads((fila_host / nome).read_text(encoding="utf-8"))
            pacotes[pc["prospect_id"]] = (nome, pc)
        if exemplo["prospect_id"] in pacotes:
            igual = {k: v for k, v in pacotes[exemplo["prospect_id"]][1].items() if k not in ("gerado_em", "origem")} == \
                {k: v for k, v in exemplo.items() if k not in ("gerado_em", "origem")}
            print("pacote do prospect igual ao exemplo (fora gerado_em/origem):", igual)
            ok = ok and igual
        else:
            ok = False
        nome, pc = pacotes.get(pid_site, ("", None))
        site_ok = bool(pc) and pc["empresa"] == "Clínica Ensaio do Raio-X" and pc["cidade"] == "Vitória" \
            and pc["segmento"] is None and pc.get("lead_do_site") is True \
            and pc["resposta_id"] == f"{pid_site}|{exemplo['carimbo']}" \
            and pc["sessoes"][0]["respostas"] == s["respostas"]
        print("pacote do lead do Raio-X (place_id do retrato):", site_ok, fila_host / nome if nome else "")
        ok = ok and site_ok
        print("memória de teste:", json.loads(feitos_host.read_text(encoding="utf-8")))
        print("ENSAIO OK" if ok else "ENSAIO FALHOU")
        if not ok:
            raise SystemExit(1)
    finally:
        api("POST", f"/workflows/{t['id']}/deactivate")
        api("DELETE", f"/workflows/{t['id']}")
        leads_host.unlink(missing_ok=True)


if __name__ == "__main__":
    teste() if "--teste" in sys.argv[1:] else main()
