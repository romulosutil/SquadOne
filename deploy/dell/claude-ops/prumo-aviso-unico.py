"""Diagnóstico do dono: resposta fora dos prospects avisa uma vez só (idempotente).

A pontuação relê o formulário inteiro de hora em hora, e a resposta sem
prospect (link sem o ID, empresa digitada à mão) virava o mesmo WhatsApp a
cada execução: "Índio do Brasil" chegou de hora em hora desde 23/09/2026.

A memória fica em estado/prumo-avisados.json ({"empresa|carimbo": avisado em}),
não na memória do fluxo ($getWorkflowStaticData): o n8n só grava essa memória
quando o id do fluxo tem até 21 caracteres (isWorkflowIdValid), e o deste é um
UUID de 36. Resposta nova da mesma empresa avisa de novo. A chave só é gravada
depois de o aviso estar na fila: aviso que falhou volta na próxima execução.
Arquivo ausente ou ilegível = memória vazia, e cada resposta avisa mais uma vez.

prumo-simples.py monta o mesmo fluxo ao recriar, com os trechos daqui.
"""
from n8n import api, put

PONTUACAO = "b091d18b-106b-4f4d-ad4e-f77cdeaa7a5f"
ESTADO = "/home/node/.n8n-files/estado/prumo-avisados.json"
AVISO_GRAVADO = "Resposta fora da lista: avisar pelo Hermes"

MEMORIA = """// Respostas fora dos prospects já avisadas (empresa + carimbo), lidas de
// estado/prumo-avisados.json: sem isso o mesmo aviso voltava a cada hora.
const avisados = (() => {
  try {
    const d = $('Extrair avisados').first().json.data;
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }  // arquivo ausente ou ilegível: memória vazia
})();
"""

FORA_ANTES = "  if (!p) { saida.push({ json: { naFila: false, id: id || ref, empresa } }); continue; }\n"
FORA_DEPOIS = """  if (!p) {
    const chave = ref.toLowerCase() + '|' + String(r['Carimbo de data/hora'] ?? r.row_number ?? '');
    if (!(chave in avisados)) saida.push({ json: { naFila: false, id: id || ref, empresa, chave } });
    continue;
  }
"""

LEMBRAR = """// Roda depois de os avisos estarem na fila: aviso que falhou não é marcado
// e volta na próxima execução.
let avisados = {};
try {
  const d = $('Extrair avisados').first().json.data;
  if (d && typeof d === 'object' && !Array.isArray(d)) avisados = { ...d };
} catch {}
const agora = new Date().toISOString();
for (const x of $('Calcular diagnóstico').all()) {
  if (!x.json.naFila && x.json.chave) avisados[x.json.chave] = agora;
}
return [{ json: { avisados: Object.keys(avisados).length }, binary: { data: {
  data: Buffer.from(JSON.stringify(avisados, null, 1), 'utf8').toString('base64'),
  mimeType: 'application/json', fileName: 'prumo-avisados.json' } } }];"""


def nos_memoria(caminho=ESTADO):
    """Ler/Extrair antes do formulário; Lembrar/Gravar depois do aviso."""
    tolerante = {"executeOnce": True, "alwaysOutputData": True, "onError": "continueRegularOutput"}
    return [
        {"id": "ler-avisados", "name": "Ler avisados", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [330, -100], **tolerante,
         "parameters": {"operation": "read", "fileSelector": caminho, "options": {}}},
        {"id": "extrair-avisados", "name": "Extrair avisados", "type": "n8n-nodes-base.extractFromFile", "typeVersion": 1,
         "position": [550, -100], **tolerante,
         "parameters": {"operation": "fromJson", "binaryPropertyName": "data", "options": {}}},
        {"id": "lembrar-avisados", "name": "Lembrar avisados", "type": "n8n-nodes-base.code", "typeVersion": 2,
         "position": [1580, 250], "parameters": {"mode": "runOnceForAllItems", "jsCode": LEMBRAR}},
        {"id": "gravar-avisados", "name": "Gravar avisados", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [1820, 250], "parameters": {"operation": "write", "dataPropertyName": "data", "fileName": caminho}},
    ]


def ligar_memoria(con, antes_do_formulario="Ler prospects", formulario="Ler respostas do formulário",
                  aviso_gravado=AVISO_GRAVADO):
    """Troca antes -> formulário por antes -> Ler -> Extrair -> formulário; aviso -> Lembrar -> Gravar."""
    def para(n):
        return [{"node": n, "type": "main", "index": 0}]
    saidas = con[antes_do_formulario]["main"][0]
    saidas[:] = [d for d in saidas if d["node"] != formulario]
    if not any(d["node"] == "Ler avisados" for d in saidas):
        saidas.append(para("Ler avisados")[0])
    con["Ler avisados"] = {"main": [para("Extrair avisados")]}
    con["Extrair avisados"] = {"main": [para(formulario)]}
    con[aviso_gravado] = {"main": [para("Lembrar avisados")]}
    con["Lembrar avisados"] = {"main": [para("Gravar avisados")]}


def main():
    wf = api("GET", f"/workflows/{PONTUACAO}")
    nomes = {n["name"] for n in wf["nodes"]}
    if "Extrair avisados" in nomes:
        print("Diagnóstico do dono: aviso fora da lista já é único")
        return
    no = next(n for n in wf["nodes"] if n["name"] == "Calcular diagnóstico")
    codigo = no["parameters"]["jsCode"]
    for trecho in (FORA_ANTES, "const saida = [];\n"):
        if codigo.count(trecho) != 1:
            raise SystemExit(f"Código de 'Calcular diagnóstico' mudou; trecho não achado uma vez só: {trecho!r}")
    codigo = codigo.replace("const saida = [];\n", MEMORIA + "const saida = [];\n")
    no["parameters"]["jsCode"] = codigo.replace(FORA_ANTES, FORA_DEPOIS)
    wf["nodes"] += nos_memoria()
    ligar_memoria(wf["connections"])
    put(wf)
    api("POST", f"/workflows/{PONTUACAO}/activate")
    print("Diagnóstico do dono: resposta fora da lista avisa uma vez só")


if __name__ == "__main__":
    main()
