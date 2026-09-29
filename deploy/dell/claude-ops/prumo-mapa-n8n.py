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

Aditivo: só nós "Mapa: ..." e uma saída nova de "Ler respostas do formulário",
posicionados abaixo do ramo do diagnóstico (a ordem v1 roda aquele ramo
primeiro). Rodar de novo troca os nós "Mapa: ..." pelos atuais. prumo-simples.py
recria o fluxo sem eles: depois dele, rode este script de novo.

Uso:
    python3 prumo-mapa-n8n.py            aplica no fluxo (backup antes)
    python3 prumo-mapa-n8n.py --teste    ensaio numa cópia temporária, sem planilha:
                                         prospects e respostas de exemplo, fila e memória
                                         de teste; roda duas vezes e confere o pacote.
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
ORIGEM = "Ler respostas do formulário"
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

MONTAR = """// Resposta completa de um prospect -> pacote do Mapa (pendência P3 do PRUMO).
// Mesmo critério do 'Calcular diagnóstico' (prospect conhecido, 16 respostas
// válidas), com a resposta inteira. Nota 0 a 3 = posição da opção (roteiro a/b/c/d).
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
const ultima = new Map();
for (const r of $('Ler respostas do formulário').all().map(i => i.json)) {
  const ref = String(r['Empresa'] ?? '').trim();
  if (ref) ultima.set(ref.toLowerCase(), r);  // a planilha do Form está em ordem de chegada
}
const saida = [];
for (const r of ultima.values()) {
  const ref = String(r['Empresa']).trim();
  const sep = ref.indexOf('::');
  const p = sep > 0 ? prospects.get(ref.slice(0, sep).trim().toLowerCase()) : undefined;
  if (!p) continue;  // fora dos prospects: o ramo do diagnóstico já avisa
  const respostas = {};
  let soma = 0;
  for (const q of QUESTIONS) {
    const resposta = texto(r, q.prefix);
    const nota = q.choices.indexOf(resposta);
    if (nota >= 0) { respostas[q.id] = { resposta, nota }; soma += nota + 1; }
  }
  if (Object.keys(respostas).length < QUESTIONS.length) continue;  // incompleta: espera
  const id = String(p['ID']).trim();
  const carimbo = String(r['Carimbo de data/hora'] ?? r.row_number ?? '').trim();
  const chave = (id + '|' + carimbo).toLowerCase();
  if (chave in feitos) continue;
  const aprofundamentos = {};
  for (const [qid, prefixo] of Object.entries(APROFUNDAMENTOS)) {
    const t = texto(r, prefixo);
    if (t) aprofundamentos[qid] = t;
  }
  const pacote = {
    versao: 1, origem: 'n8n · ' + $workflow.name, resposta_id: id + '|' + carimbo, prospect_id: id,
    empresa: ref.slice(sep + 2).trim(), cidade: String(p['Cidade'] ?? '').trim() || null,
    segmento: String(p['Segmento'] ?? '').trim() || null, carimbo,
    indice_100: Math.round(soma / (4 * QUESTIONS.length) * 1000) / 10,  // a escala da planilha
    gerado_em: new Date().toISOString(),
    sessoes: [{ papel: texto(r, 'Sessão / papel') || 'Dono', data: texto(r, 'Data da entrevista') || null,
                respostas, aprofundamentos }],
  };
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


def nos(perguntas_js: str, fila: str = FILA, feitos: str = FEITOS, x: int = 660, y: int = 480) -> list[dict]:
    tolerante = {"executeOnce": True, "alwaysOutputData": True, "onError": "continueRegularOutput"}
    montar = MONTAR.replace("__PERGUNTAS__", perguntas_js).replace(
        "__APROFUNDAMENTOS__", json.dumps(APROFUNDAMENTOS, ensure_ascii=False, indent=1))
    return [
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


def ligar(con: dict, origem: str = ORIGEM) -> None:
    def para(n):
        return {"node": n, "type": "main", "index": 0}
    saidas = con.setdefault(origem, {"main": [[]]})["main"][0]
    if not any(d["node"] == "Mapa: ler feitos" for d in saidas):
        saidas.append(para("Mapa: ler feitos"))
    cadeia = ["Mapa: ler feitos", "Mapa: extrair feitos", "Mapa: montar pacote", "Mapa: gravar pacote",
              "Mapa: lembrar feitos", "Mapa: gravar feitos"]
    for de, ate in zip(cadeia, cadeia[1:]):
        con[de] = {"main": [[para(ate)]]}


def tirar(wf: dict) -> None:
    """Remove os nós "Mapa: ..." e as ligações para eles (para reaplicar)."""
    wf["nodes"] = [n for n in wf["nodes"] if not n["name"].startswith(PREFIXO)]
    con = {k: v for k, v in wf["connections"].items() if not k.startswith(PREFIXO)}
    for v in con.values():
        for saida in v.get("main", []):
            saida[:] = [d for d in saida if not d["node"].startswith(PREFIXO)]
    wf["connections"] = con


def main() -> None:
    wf = api("GET", f"/workflows/{PONTUACAO}")
    pasta = BACKUPS / date.today().isoformat()
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / f"{PONTUACAO}-antes-prumo-mapa-{int(time.time())}.json").write_text(
        json.dumps(wf, ensure_ascii=False, indent=1), encoding="utf-8")
    if ORIGEM not in {n["name"] for n in wf["nodes"]}:
        raise SystemExit(f"Nó '{ORIGEM}' não existe mais no fluxo; nada aplicado")
    tirar(wf)
    wf["nodes"] += nos(perguntas(wf))
    ligar(wf["connections"])
    put(wf)
    api("POST", f"/workflows/{PONTUACAO}/activate")
    print(f"Diagnóstico do dono: resposta completa vira pacote do Mapa em {FILA}")


# ------------------------------------------------------------------ ensaio

def teste() -> None:
    """Cópia temporária só com o ramo do Mapa, com prospects e respostas de exemplo
    (Distribuidora Vale Norte, fictícia). Não lê nem grava planilha."""
    estado = Path.home() / ".local/share/n8n-estado"
    fila_host, feitos_host = estado / "mapa-teste", estado / "prumo-mapa-feitos-teste.json"
    fila_host.mkdir(exist_ok=True)
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
    prospects = [{"ID": exemplo["prospect_id"], "Empresa": exemplo["empresa"], "Cidade": exemplo["cidade"],
                  "Segmento": exemplo["segmento"], "Etapa": "Convite enviado"},
                 {"ID": "outro-id", "Empresa": "Empresa Incompleta", "Cidade": "", "Segmento": "", "Etapa": "Revisar"}]
    stub = lambda nome, itens, pos: {  # noqa: E731
        "id": nome, "name": nome, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos,
        "parameters": {"mode": "runOnceForAllItems",
                       "jsCode": f"return {json.dumps(itens, ensure_ascii=False)}.map(json => ({{ json }}));"}}
    caminho = f"prumo-mapa-teste-{int(time.time())}"
    nos_teste = [
        {"id": "w", "name": "Ensaio", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 480],
         "webhookId": "0d1e2f3a-4b5c-4d6e-8f70-" + str(int(time.time()))[-12:].rjust(12, "0"),
         "parameters": {"httpMethod": "POST", "path": caminho, "responseMode": "onReceived", "options": {}}},
        stub("Ler prospects", prospects, [220, 480]),
        stub(ORIGEM, [linha, incompleta, fora], [440, 480]),
        *nos(perg, NO_CONTAINER + "mapa-teste/", NO_CONTAINER + "prumo-mapa-feitos-teste.json"),
    ]
    con = {"Ensaio": {"main": [[{"node": "Ler prospects", "type": "main", "index": 0}]]},
           "Ler prospects": {"main": [[{"node": ORIGEM, "type": "main", "index": 0}]]}}
    ligar(con)
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
            print(f"rodada {rodada}: status={e['status']} montar={itens.get('Mapa: montar pacote')} "
                  f"gravar={itens.get('Mapa: gravar pacote', 0)} novos={novos}")
            resultados.append({"id": ex["id"], "status": e["status"], "novos": novos})
        ok = (resultados[0]["status"] == "success" and len(resultados[0]["novos"]) == 1
              and resultados[1]["status"] == "success" and not resultados[1]["novos"])
        if resultados[0]["novos"]:
            pacote = json.loads((fila_host / resultados[0]["novos"][0]).read_text(encoding="utf-8"))
            igual = {k: v for k, v in pacote.items() if k not in ("gerado_em", "origem")} == \
                {k: v for k, v in exemplo.items() if k not in ("gerado_em", "origem")}
            print("pacote igual ao exemplo (fora gerado_em/origem):", igual)
            print("memória de teste:", json.loads(feitos_host.read_text(encoding="utf-8")))
            ok = ok and igual
        print("ENSAIO OK" if ok else "ENSAIO FALHOU")
        if not ok:
            raise SystemExit(1)
    finally:
        api("POST", f"/workflows/{t['id']}/deactivate")
        api("DELETE", f"/workflows/{t['id']}")


if __name__ == "__main__":
    teste() if "--teste" in sys.argv[1:] else main()
