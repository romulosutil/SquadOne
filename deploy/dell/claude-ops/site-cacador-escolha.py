"""Caçador: a busca do dia prefere as verticais que respondem (idempotente).

Até 05/10/2026 o "01 · Caçador" ordenava as buscas ativas pela `ultima_rodada`
e pegava a mais antiga: toda busca ativa tinha a mesma vez, respondesse o
nicho ou não. Pelo funil de 05/10, pousada (5 respostas em 29 enviados) e
espaço de eventos/buffet (4 em 15) respondem; odontologia, pilates, academia,
vidraçaria e marcenaria somavam 0 em 21. Agora "Escolher a busca" (Code) troca
"Rodada mais antiga primeiro" + "Pegar 1 busca": vence a busca mais atrasada,
com o atraso das verticais que respondem contando em dobro. Nunca rodada
continua primeiro (na ordem da aba), e a escolha segue sendo uma só por
execução: os nós seguintes leem `$('Montar área da busca').first()`.

Ainda em 05/10/2026, na migração de nicho (site-nichos.py), PREFERIDAS virou
advocacia: as respostas de pousada e eventos eram todas "não tenho interesse",
e advogado é o dono que mais procura site no Google Trends.

A pausa de quem não responde é do "06 · Funil semanal" (site-acompanhamento.py),
que desliga `ativa` na aba Buscas; aqui só muda a vez entre as que seguem ativas.

Uso: python3 site-cacador-escolha.py            aplica no Caçador do Dell (guarda o anterior em backups/)
     python3 site-cacador-escolha.py --testar   só a escolha, no node, com buscas de mentira (sem n8n)
"""
import copy
from workflow_confiabilidade import desembrulhar
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CACADOR = "oow8TkxrAf4fVvTj"  # "01 · Caçador" no n8n do Dell
SAI = ("Rodada mais antiga primeiro", "Pegar 1 busca")
ANTES, DEPOIS = "Só buscas ativas", "Montar área da busca"
NOME = "Escolher a busca"
BACKUPS = Path.home() / ".local/share/claude-ops/backups"

ESCOLHER = """// Uma busca por execução (os nós seguintes leem .first()): a mais atrasada,
// com o atraso das PREFERIDAS contando em dobro.
// Para mudar a preferência, edite só PREFERIDAS (trecho do query ou da vertical).
// Migração de nicho de 05/10/2026: saíram pousada, eventos e buffet (as 11
// respostas eram todas "não tenho interesse"). Entrou advocacia, o ramo cujo
// dono mais procura "site para advogado" no Google Trends (site-nichos.py).
// Troque pelos ramos que o funil mostrar com interesse de verdade.
const PREFERIDAS = ['advog', 'advoc'];
const PESO = 2;
const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
const agora = Date.now();
// ultima_rodada é gravada pelo próprio Caçador como yyyy-MM-ddTHH:mm, hora de São Paulo.
// Vazia = nunca rodou (o V8 leria ':00-03:00' sozinho como 01/01/2000).
const atraso = (b) => {
  const s = String(b.ultima_rodada ?? '').trim();
  if (!s) return Infinity;
  const t = Date.parse(s + ':00-03:00');
  return Number.isFinite(t) ? Math.max(agora - t, 0) : Infinity;
};
const peso = (b) => PREFERIDAS.some(p => norm(b.query + ' ' + b.vertical).includes(p)) ? PESO : 1;
const itens = $input.all();
if (!itens.length) return [];
let melhor = 0;
itens.forEach((item, i) => {
  if (atraso(item.json) * peso(item.json) > atraso(itens[melhor].json) * peso(itens[melhor].json)) melhor = i;
});
return [{ json: itens[melhor].json, pairedItem: melhor }];"""


def aplicar(wf: dict) -> dict:
    """Troca a ordenação + limite por "Escolher a busca". Rodar de novo só
    atualiza o código do nó."""
    wf = desembrulhar(wf)
    por = {n["name"]: n for n in wf["nodes"]}
    if NOME in por:
        por[NOME]["parameters"]["jsCode"] = ESCOLHER
        return wf
    x, y = por[SAI[0]]["position"]
    wf["nodes"] = [n for n in wf["nodes"] if n["name"] not in SAI] + [{
        "id": "escolher-busca", "name": NOME, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [x, y],
        "parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": ESCOLHER}}]
    con = {k: v for k, v in wf["connections"].items() if k not in SAI}
    con[ANTES] = {"main": [[{"node": NOME, "type": "main", "index": 0}]]}
    con[NOME] = {"main": [[{"node": DEPOIS, "type": "main", "index": 0}]]}
    wf["connections"] = con
    return wf


def escolher_no_node(buscas: list, agora_iso: str, preferidas=None) -> dict:
    """`preferidas` troca a lista do nó só no teste (a de produção pode estar vazia)."""
    exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
    codigo = ESCOLHER
    if preferidas is not None:
        inicio = codigo.index("const PREFERIDAS = ")
        fim = codigo.index("\n", inicio)
        codigo = codigo[:inicio] + "const PREFERIDAS = " + json.dumps(preferidas) + ";" + codigo[fim:]
    prog = (f"Date.now = () => Date.parse({json.dumps(agora_iso)});\n"
            "const $input = { all: () => " + json.dumps(buscas, ensure_ascii=False) + ".map(json => ({ json })) };\n"
            "const r = (() => {\n" + codigo + "\n})();\nconsole.log(JSON.stringify(r[0] ?? null));\n")
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "escolher.mjs"
        arq.write_text(prog, encoding="utf-8")
        r = subprocess.run([str(exe), str(arq)], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


def testar() -> int:
    import unittest

    def b(query, vertical, rodada):
        return {"query": query, "vertical": vertical, "ultima_rodada": rodada}

    agora = "2026-10-05T06:00:00-03:00"

    class Escolha(unittest.TestCase):
        def escolhida(self, buscas, preferidas=None):
            r = escolher_no_node(buscas, agora, preferidas)
            return r and (r["json"]["query"], r["pairedItem"])

        def test_nunca_rodada_vem_primeiro_na_ordem_da_aba(self):
            self.assertEqual(self.escolhida([b("pousada", "pousada", "2026-09-01T06:00"), b("vidraçaria", "vidracaria", ""),
                                             b("buffet infantil", "eventos", "")]), ("vidraçaria", 1))

        def test_fora_das_preferidas_vence_a_mais_atrasada(self):
            self.assertEqual(self.escolhida([b("desentupidora", "desentupidora", "2026-09-29T06:00"),
                                             b("escritório de contabilidade", "contabilidade", "2026-09-25T06:00")]),
                             ("escritório de contabilidade", 1))

        def test_advocacia_e_preferida(self):
            # contabilidade 8 dias atrasada; advogado 5 dias (= 10 em dobro): vai o advogado.
            self.assertEqual(self.escolhida([b("escritório de contabilidade", "contabilidade", "2026-09-27T06:00"),
                                             b("advogado previdenciário", "advocacia", "2026-09-30T06:00")]),
                             ("advogado previdenciário", 1))

        def test_preferida_conta_em_dobro(self):
            pref = ["desentup"]
            # contabilidade 10 dias atrasada; desentupidora 6 dias (= 12 em dobro): vai a desentupidora.
            self.assertEqual(self.escolhida([b("escritório de contabilidade", "contabilidade", "2026-09-25T06:00"),
                                             b("desentupidora", "desentupidora", "2026-09-29T06:00")], pref), ("desentupidora", 1))
            # desentupidora 4 dias (= 8): a contabilidade, 10 dias parada, ainda tem a vez.
            self.assertEqual(self.escolhida([b("escritório de contabilidade", "contabilidade", "2026-09-25T06:00"),
                                             b("desentupidora", "desentupidora", "2026-10-01T06:00")], pref),
                             ("escritório de contabilidade", 0))

        def test_sem_busca_ativa_nao_escolhe_nada(self):
            self.assertIsNone(escolher_no_node([], agora))

        def test_aplicar_troca_os_nos_e_e_idempotente(self):
            wf = {"nodes": [{"name": n, "position": [1, 2]} for n in (ANTES, *SAI, DEPOIS)],
                  "connections": {ANTES: {"main": [[{"node": SAI[0], "type": "main", "index": 0}]]},
                                  SAI[0]: {"main": [[{"node": SAI[1], "type": "main", "index": 0}]]},
                                  SAI[1]: {"main": [[{"node": DEPOIS, "type": "main", "index": 0}]]}}}
            uma = aplicar(wf)
            self.assertEqual(sorted(n["name"] for n in uma["nodes"]), sorted([ANTES, NOME, DEPOIS]))
            self.assertEqual(uma["connections"][ANTES]["main"][0][0]["node"], NOME)
            self.assertEqual(uma["connections"][NOME]["main"][0][0]["node"], DEPOIS)
            self.assertEqual(aplicar(uma), uma)

    r = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Escolha))
    return 0 if r.wasSuccessful() else 1


def main() -> int:
    from n8n import api, put  # só aqui: o --testar roda sem a chave do n8n
    atual = api("GET", f"/workflows/{CACADOR}")
    BACKUPS.mkdir(parents=True, exist_ok=True)
    copia = BACKUPS / f"cacador-{time.strftime('%Y%m%d-%H%M%S')}.json"
    copia.write_text(json.dumps(atual, ensure_ascii=False), encoding="utf-8")
    novo = aplicar(atual)
    put(novo)
    api("POST", f"/workflows/{CACADOR}/activate")  # o PUT guarda; ativar publica a versão nova
    print(f"Caçador: busca escolhida por atraso, verticais que respondem em dobro (anterior em {copia})")
    return 0


if __name__ == "__main__":
    sys.exit(testar() if "--testar" in sys.argv else main())
