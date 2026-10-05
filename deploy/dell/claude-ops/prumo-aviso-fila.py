"""Aviso do Lead Scout diz quantos prospects entraram em "Revisar" (idempotente).

O aviso das 09:00 conta as empresas "novas" antes dos filtros de WhatsApp no site
e de porte pelo CNPJ: em 05/10/2026 foram "55 empresa(s) nova(s)" e só 8 entraram
em Revisar. Parecia que a fila tinha 55, e na tela Hoje do CRM não havia nada
para revisar (os 8 já tinham convite enviado às 09:42).

Este script:
- troca a última frase do aviso existente: ele continua saindo logo depois da
  busca, mas passa a dizer que o número de prospects vem no aviso seguinte;
- liga um segundo aviso depois de "Gravar prospect" (um WhatsApp só, por
  execução, mesmo com vários prospects): "N prospect(s) em Revisar, de M
  empresa(s) nova(s) em <busca>: nomes". Sem prospect, "Gravar prospect" não
  roda e o segundo aviso não sai: o primeiro já disse que "sem aviso seguinte,
  nenhuma entrou".

Uso: python3 prumo-aviso-fila.py            simula: lê o fluxo vivo (só GET), mostra o que mudaria, não grava
     python3 prumo-aviso-fila.py --aplicar  grava e reativa o Lead Scout (fora de 08:00-11:30)
     python3 prumo-aviso-fila.py --testar   roda o texto do aviso no node com dados de mentira
"""
import base64
import copy
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from n8n import api, aviso_nodes, put

LEAD_SCOUT = "e02c6f43-17ce-430b-9238-0b997a7656ce"
PREFIXO = "Prospects na fila"
PRIMEIRO = "Resumo da busca: montar aviso"
GRAVAR = "Gravar prospect"
MAX_NOMES = 5

# A frase que prumo-porte-cnpj.py deixou no aviso, e a que a substitui.
ANTES = 'As que publicam WhatsApp no site e passam no filtro de porte (CNPJ) entram como "Revisar" na fila.'
DEPOIS = ('Só entram em "Revisar" as que publicam WhatsApp no site e passam no filtro de porte (CNPJ): '
          'o número vem no aviso seguinte (sem ele, nenhuma entrou).')

# Expressão do nó agregado (roda uma vez, com `itens` = o que "Gravar prospect" gravou). Os nomes vêm de
# "Linha de prospect" e o total de empresas novas de "Normalizar empresas", os mesmos nós que o fluxo já usa.
TEXTO = f"""(() => {{
  const curto = (n) => (n.length > 40 ? n.slice(0, 39).trimEnd() + '…' : n);
  const nomes = $('Linha de prospect').all().map(x => curto(String(x.json['Empresa'] ?? '').trim())).filter(Boolean);
  const novas = $('Normalizar empresas').all().length;
  const q = $('Preparar descoberta sem repetidos').first().json.query;
  const lista = nomes.slice(0, {MAX_NOMES}).join(', ') + (nomes.length > {MAX_NOMES} ? ' e mais ' + (nomes.length - {MAX_NOMES}) : '');
  return 'Lead Scout: ' + itens.length + ' prospect(s) em "Revisar", de ' + novas + ' empresa(s) nova(s) em "' + q + '": ' + lista + '. Abra o CRM em Hoje.';
}})()"""


def remendar(wf):
    """Devolve (fluxo novo, o que mudou). Não grava nada."""
    wf = copy.deepcopy(wf)
    nos = {n["name"]: n for n in wf["nodes"]}
    mudou = []

    primeiro = nos[PRIMEIRO]["parameters"]
    if DEPOIS in primeiro["jsCode"]:
        pass
    elif ANTES in primeiro["jsCode"]:
        primeiro["jsCode"] = primeiro["jsCode"].replace(ANTES, DEPOIS)
        mudou.append(f'"{PRIMEIRO}": frase final trocada')
    else:
        raise SystemExit(f'"{PRIMEIRO}" mudou: a frase do filtro de porte não está mais lá; revise ANTES.')

    x, y = nos[GRAVAR]["position"]
    montar, gravar = aviso_nodes(PREFIXO, x + 240, y, TEXTO, titulo="📊 PRUMO", agregado=True)
    if montar["name"] in nos:
        if nos[montar["name"]]["parameters"]["jsCode"] != montar["parameters"]["jsCode"]:
            nos[montar["name"]]["parameters"]["jsCode"] = montar["parameters"]["jsCode"]
            mudou.append(f'"{montar["name"]}": texto atualizado')
    else:
        wf["nodes"] += [montar, gravar]
        mudou.append(f'nós novos: "{montar["name"]}" e "{gravar["name"]}" depois de "{GRAVAR}"')

    con = wf["connections"]
    liga = {"main": [[{"node": montar["name"], "type": "main", "index": 0}]]}
    if con.get(GRAVAR) != liga:
        con[GRAVAR] = liga
        mudou.append(f'ligação "{GRAVAR}" -> "{montar["name"]}"')
    ponte = {"main": [[{"node": gravar["name"], "type": "main", "index": 0}]]}
    if con.get(montar["name"]) != ponte:
        con[montar["name"]] = ponte
        mudou.append(f'ligação "{montar["name"]}" -> "{gravar["name"]}"')
    return wf, mudou


def main(aplicar):
    vivo = api("GET", f"/workflows/{LEAD_SCOUT}")
    novo, mudou = remendar(vivo)
    if not mudou:
        print("Lead Scout já está com o aviso novo: nada a fazer.")
        return
    print("Mudanças no Lead Scout:")
    for m in mudou:
        print("  -", m)
    if not aplicar:
        print("Simulação: nada foi gravado. Rode com --aplicar para gravar.")
        return
    put(novo)
    api("POST", f"/workflows/{LEAD_SCOUT}/activate")
    depois = api("GET", f"/workflows/{LEAD_SCOUT}")
    ok = (depois["active"] and remendar(depois)[1] == []
          and depois["connections"][GRAVAR]["main"][0][0]["node"] == f"{PREFIXO}: montar aviso")
    print(f"Lead Scout com o aviso novo: {'ok' if ok else 'FALHOU'} (ativo={depois['active']})")


# ---------------------------------------------------------------- teste (sem n8n)

def rodar_texto(prospects, novas, consulta="distribuidora de teste em Lugar/SP"):
    """Roda o código do nó "montar aviso" no node; devolve o texto do aviso ou None (sem aviso)."""
    montar, _ = aviso_nodes(PREFIXO, 0, 0, TEXTO, titulo="📊 PRUMO", agregado=True)
    dados = {"Linha de prospect": [{"Empresa": p} for p in prospects],
             "Normalizar empresas": [{} for _ in range(novas)],
             "Preparar descoberta sem repetidos": {"query": consulta}}
    entrada = [{"json": {"Empresa": p}} for p in prospects]
    exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
    prog = ("const dados = " + json.dumps(dados, ensure_ascii=False) + ";\n"
            "const entrada = " + json.dumps(entrada, ensure_ascii=False) + ";\n"
            "const $ = (n) => ({ all: () => (Array.isArray(dados[n]) ? dados[n] : []).map(json => ({ json })), first: () => ({ json: dados[n] }) });\n"
            "const $input = { all: () => entrada };\n"
            "const saida = (() => {\n" + montar["parameters"]["jsCode"] + "\n})();\n"
            "console.log(JSON.stringify(saida.map(s => s.json.texto)));\n")
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "no.mjs"
        arq.write_text(prog, encoding="utf-8")
        r = subprocess.run([str(exe), str(arq)], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    textos = json.loads(r.stdout)
    return textos[0] if textos else None


def testar():
    import unittest

    class Aviso(unittest.TestCase):
        def test_diz_quantos_entraram_e_de_quantas(self):
            t = rodar_texto(["A", "B", "C"], 55)
            self.assertEqual(t, 'Lead Scout: 3 prospect(s) em "Revisar", de 55 empresa(s) nova(s) em '
                                '"distribuidora de teste em Lugar/SP": A, B, C. Abra o CRM em Hoje.')

        def test_nome_comprido_e_cortado(self):
            t = rodar_texto(["Continental Construção e Acabamentos - Loja de Materiais de Construção Guarulhos"], 1)
            self.assertIn("Continental Construção e Acabamentos -…", t)
            self.assertNotIn("Guarulhos,", t)

        def test_lista_so_os_primeiros_nomes(self):
            t = rodar_texto([f"Empresa {i}" for i in range(8)], 55)
            self.assertIn("Empresa 4 e mais 3.", t)
            self.assertNotIn("Empresa 5", t)

    class Remendo(unittest.TestCase):
        def fluxo(self, com_frase=True):
            js = "const t = 'Lead Scout: x. " + (ANTES if com_frase else DEPOIS) + "';"
            return {"nodes": [{"name": PRIMEIRO, "parameters": {"jsCode": js}},
                              {"name": GRAVAR, "position": [100, 200], "parameters": {}}],
                    "connections": {}}

        def test_aplica_uma_vez_e_depois_nao_muda_mais(self):
            wf, mudou = remendar(self.fluxo())
            self.assertEqual(len(mudou), 4)
            self.assertIn(DEPOIS, wf["nodes"][0]["parameters"]["jsCode"])
            self.assertEqual(wf["connections"][GRAVAR]["main"][0][0]["node"], f"{PREFIXO}: montar aviso")
            self.assertEqual(remendar(wf)[1], [])

        def test_nao_altera_o_fluxo_de_entrada(self):
            wf = self.fluxo()
            remendar(wf)
            self.assertEqual(wf, self.fluxo())

        def test_frase_que_sumiu_para_em_vez_de_adivinhar(self):
            wf = self.fluxo()
            wf["nodes"][0]["parameters"]["jsCode"] = "const t = 'outra coisa';"
            with self.assertRaises(SystemExit):
                remendar(wf)

    suite = unittest.TestSuite(unittest.TestLoader().loadTestsFromTestCase(c) for c in (Aviso, Remendo))
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


if __name__ == "__main__":
    if "--testar" in sys.argv:
        raise SystemExit(testar())
    main(aplicar="--aplicar" in sys.argv)
