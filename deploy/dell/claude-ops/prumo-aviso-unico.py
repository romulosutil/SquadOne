"""Diagnóstico do dono: resposta fora dos prospects avisa uma vez só (idempotente).

A pontuação relê o formulário inteiro de hora em hora, e a resposta sem
prospect (link sem o ID, empresa digitada à mão) virava o mesmo WhatsApp a
cada execução: "Índio do Brasil" chegou de hora em hora desde 23/09/2026.
Agora a memória do fluxo ($getWorkflowStaticData) guarda cada resposta já
avisada (empresa + carimbo); resposta nova da mesma empresa avisa de novo.

Sem memória ainda, a primeira execução agendada marca as respostas atuais sem
avisar: todas já tinham sido avisadas. O n8n só grava a memória em execução
agendada, não na manual. prumo-simples.py monta o mesmo código ao recriar.
"""
from n8n import api, put

PONTUACAO = "b091d18b-106b-4f4d-ad4e-f77cdeaa7a5f"

MEMORIA = """// Resposta fora dos prospects avisa uma vez só: a memória do fluxo guarda cada
// uma (empresa + carimbo). Sem memória ainda, marca as atuais sem avisar: todas
// já tinham sido avisadas, de hora em hora.
const memoria = $getWorkflowStaticData('global');
const semeando = !memoria.foraDaLista;
const foraDaLista = { ...(memoria.foraDaLista ?? {}) };
let lembrou = semeando;
"""

FORA_ANTES = "  if (!p) { saida.push({ json: { naFila: false, id: id || ref, empresa } }); continue; }\n"
FORA_DEPOIS = """  if (!p) {
    const chave = ref.toLowerCase() + '|' + String(r['Carimbo de data/hora'] ?? r.row_number ?? '');
    if (!(chave in foraDaLista)) {
      foraDaLista[chave] = new Date().toISOString();
      lembrou = true;
      if (!semeando) saida.push({ json: { naFila: false, id: id || ref, empresa } });
    }
    continue;
  }
"""

GRAVAR = """// Reatribuir no nível de cima marca a memória como alterada (o n8n só grava em execução agendada).
if (lembrou) memoria.foraDaLista = foraDaLista;
"""


def main():
    wf = api("GET", f"/workflows/{PONTUACAO}")
    no = next(n for n in wf["nodes"] if n["name"] == "Calcular diagnóstico")
    codigo = no["parameters"]["jsCode"]
    if "$getWorkflowStaticData('global')" in codigo:
        print("Diagnóstico do dono: aviso fora da lista já é único")
        return
    for trecho in (FORA_ANTES, "const saida = [];\n", "\nreturn saida;"):
        if codigo.count(trecho) != 1:
            raise SystemExit(f"Código de 'Calcular diagnóstico' mudou; trecho não achado uma vez só: {trecho!r}")
    codigo = codigo.replace("const saida = [];\n", MEMORIA + "const saida = [];\n")
    codigo = codigo.replace(FORA_ANTES, FORA_DEPOIS)
    codigo = codigo.replace("\nreturn saida;", "\n" + GRAVAR + "return saida;")
    no["parameters"]["jsCode"] = codigo
    put(wf)
    api("POST", f"/workflows/{PONTUACAO}/activate")
    print("Diagnóstico do dono: resposta fora da lista avisa uma vez só")


if __name__ == "__main__":
    main()
