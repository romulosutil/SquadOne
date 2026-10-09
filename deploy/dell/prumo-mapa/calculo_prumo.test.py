#!/usr/bin/env python3
"""Testes do cálculo PRUMO (calculo_prumo.py): escala e faixas, arredondamento, regra do MIN, a Vale
Norte batendo a simulação (5,0/18, R$ 15.232/mês, R$ 182.784/ano), os limiares de cada bloco da
Nota de presença, o "não medido" e a calculadora do Raio-X em Python e no JS da página (o mesmo
JS, rodado no node, numa tabela de casos). Nada aqui toca rede, ~/ ou dado real.

  python3 deploy/dell/prumo-mapa/calculo_prumo.test.py
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
import calculo_prumo as cp  # noqa: E402

VALE_NORTE = json.loads((AQUI / "exemplos/vale-norte-completo.json").read_text(encoding="utf-8"))


def notas(presenca: dict) -> dict:
    return {b["chave"]: b["nota"] for b in presenca["blocos"]}


class EscalaEFaixas(unittest.TestCase):
    def test_escala_tem_os_quatro_niveis_nas_duas_notas(self):
        self.assertEqual(sorted(cp.ESCALA_AUTONOMIA), [0, 1, 2, 3])
        self.assertEqual(sorted(cp.ESCALA_PRESENCA), [0, 1, 2, 3])
        self.assertEqual(cp.NOTA_MAXIMA, 18)

    def test_faixas_nas_bordas(self):
        for nota, chave in ((0, "baixa"), (6.9, "baixa"), (7, "media"), (12.9, "media"), (13, "alta"), (18, "alta")):
            self.assertEqual(cp.faixa(nota, "presenca")["chave"], chave, nota)
            self.assertEqual(cp.faixa(nota, "autonomia")["chave"], chave, nota)
        self.assertEqual(cp.faixa(5.0, "autonomia")["rotulo"], "Na cabeça")
        self.assertEqual(cp.faixa(10.8, "presenca")["rotulo"], "Em construção")
        self.assertIsNone(cp.faixa(None, "presenca"))
        with self.assertRaises(ValueError):
            cp.faixa(5, "outra")

    def test_textos_das_faixas_sem_reais(self):
        for f in cp.FAIXAS:
            for tipo in ("autonomia", "presenca"):
                self.assertNotIn("R$", f[tipo][1])


class Arredondamento(unittest.TestCase):
    def test_meio_sobe_como_no_js(self):
        self.assertEqual(cp.arredondar_real(2.5), 3)  # round() do Python daria 2
        self.assertEqual(cp.arredondar_real(1071.675), 1072)
        self.assertEqual(cp.arredondar_real(2776.6125), 2777)
        self.assertEqual(cp.arredondar_real(816.4999), 816)
        self.assertEqual(cp.arredondar(10.85, 1), 10.9)
        self.assertEqual(cp.arredondar(10.8, 1), 10.8)

    def test_soma_so_de_arredondados_e_anual_do_mensal_arredondado(self):
        self.assertEqual(cp.total_mensal([5886, 4680]), 10566)
        with self.assertRaises(ValueError):
            cp.total_mensal([5886.4, 4680])
        self.assertEqual(cp.anualizar(15232), 182784)
        with self.assertRaises(ValueError):
            cp.anualizar(15232.4)

    def test_brl_e_numeros_do_dono(self):
        self.assertEqual(cp.brl(15232), "R$ 15.232")
        self.assertEqual(cp.brl(112.5), "R$ 112,50")
        self.assertEqual(cp.brl(None), "R$ ?")
        self.assertEqual(cp.num("R$ 1.250,50"), 1250.5)
        self.assertEqual(cp.num("10,9%"), 10.9)
        self.assertIsNone(cp.num(""))


class RegraDoMin(unittest.TestCase):
    def test_vale_a_menor_e_a_divergencia_vira_achado(self):
        final, div = cp.regra_do_min([{"fonte": "dono", "dono": True, "nota": 2},
                                      {"fonte": "vendas", "dono": False, "nota": 0},
                                      {"fonte": "vendas 2", "dono": False, "nota": 1}])
        self.assertEqual(final, 0)
        self.assertEqual([v["fonte"] for v in div["time"]], ["vendas"])

    def test_sem_divergencia(self):
        self.assertEqual(cp.regra_do_min([{"dono": True, "nota": 1}, {"dono": False, "nota": 1}]), (1, None))
        self.assertEqual(cp.regra_do_min([{"dono": True, "nota": 1}]), (1, None))  # sem segunda fonte
        self.assertEqual(cp.regra_do_min([{"dono": False, "nota": 2}, {"dono": False, "nota": 0}]), (0, None))
        self.assertEqual(cp.regra_do_min([{"dono": True, "nota": None}]), (None, None))


class ValeNorte(unittest.TestCase):
    """O exemplo fictício tem de bater a simulacao-mapa-vale-norte.md, número a número."""

    def test_nota_de_autonomia_5_de_18_e_as_divergencias(self):
        c = cp.consolidar(VALE_NORTE["sessoes"])
        blocos, nota = cp.rollup(c["final"])
        self.assertEqual([b["nota"] for b in blocos], [0.5, 1.0, 1.0, 1.0, 1.0, 0.5])
        self.assertEqual(nota, 5.0)
        self.assertEqual(sum(c["final"].values()), 13)  # 13/48 nos 16 IDs
        self.assertEqual([d["id"] for d in c["divergencias"]], ["AR1", "BR2", "CR1"])
        self.assertEqual(cp.faixa(nota, "autonomia")["chave"], "baixa")

    def test_travas_15232_por_mes_e_182784_por_ano(self):
        vh_dono = cp.valor_hora(VALE_NORTE["pro_labore_dono"], VALE_NORTE["valor_hora_dono"])
        self.assertEqual(vh_dono, 112.5)
        valores = sorted((cp.arredondar_real(cp.valor_da_trava(t, vh_dono, VALE_NORTE["valor_hora_time"]))
                          for t in VALE_NORTE["travas"]), reverse=True)
        self.assertEqual(valores, [5886, 4680, 2777, 1072, 817])
        total = cp.total_mensal(valores)
        self.assertEqual((total, cp.anualizar(total)), (15232, 182784))
        # O risco (R$ 388 mil, R$ 143 mil) nunca entra: não é trava, não tem fórmula mensal.
        self.assertNotIn(388000, valores)
        self.assertIsNone(cp.valor_da_trava({"formula": "risco", "valor": 388000}, vh_dono, 70))

    def test_o_mapa_usa_o_modulo(self):
        """prumo_mapa.calcular chega aos mesmos números pelo calculo_prumo (uma implementação só)."""
        spec = importlib.util.spec_from_file_location("prumo_mapa_teste", AQUI / "prumo_mapa.py")
        mapa = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mapa)
        self.assertIs(mapa.consolidar, cp.consolidar)
        self.assertIs(mapa.IDS, cp.IDS_AUTONOMIA)
        c = mapa.calcular(VALE_NORTE)
        self.assertEqual((c["indice"], c["total_mes"]), (5.0, 15232))
        self.assertEqual([t["valor"] for t in c["travas"]], [5886, 4680, 2777, 1072, 817])

    def test_formulas_do_kit(self):
        self.assertAlmostEqual(cp.custo_tempo(38, 9, 112.5), 2776.6125)
        self.assertAlmostEqual(cp.custo_margem(180000, 30, 10.9), 5886)
        self.assertAlmostEqual(cp.custo_retrabalho(None, 50, 3, 70, por_trimestre=14), 816.6667, places=3)
        self.assertEqual(cp.valor_hora(18000, 150), 150)  # o perguntado direto vence
        self.assertIsNone(cp.custo_tempo(38, None, 112.5))  # faltou dado: sem número, nunca inventado
        self.assertIsNone(cp.valor_hora(None, None))


def busca(posicao, lidos=20, consulta="advogado em Vitória", avaliacoes=(40, 50, 60, 80, 90), prefixo="c"):
    return {"consulta": consulta, "posicao": posicao, "lidos": lidos,
            "concorrentes": [{"id": f"{prefixo}{i}", "avaliacoes": a} for i, a in enumerate(avaliacoes)]}


PERFIL_OK = {"horario": "ok", "fotos": "ok", "categoria": "ok", "telefone": "ok", "site": "ok"}
SITE_OK = {"tipo": "proprio", "estado": "no_ar", "celular": True, "whatsapp": True}


class Limiares(unittest.TestCase):
    def test_busca_por_posicao(self):
        for pos, nota in ((1, 3), (3, 3), (4, 2), (10, 2), (11, 1), (20, 1), (None, 0)):
            self.assertEqual(cp.bloco_busca([busca(pos)])["nota"], nota, pos)
        self.assertEqual(cp.bloco_busca([busca(None, lidos=7)])["linha"],
                         "Fora dos 7 primeiros em “advogado em Vitória”.")

    def test_varias_buscas_vale_a_menor(self):
        b = cp.bloco_busca([busca(2, consulta="rodas em SP"), busca(None, consulta="peças em SP"),
                            busca(2, consulta="roda de poliuretano em SP")])
        self.assertEqual(b["nota"], 0)
        self.assertEqual(b["linha"], "Fora dos 20 primeiros em “peças em SP”. Nas outras 2 buscas, 2º lugar.")
        self.assertEqual(b["cenario"], "Se vocês aparecessem entre os 3 primeiros em “peças em SP” "
                                       "(hoje, fora dos 20 primeiros)")
        self.assertEqual(cp.bloco_busca([busca(5), busca(1)])["linha"],
                         "5º lugar em “advogado em Vitória”. Na outra busca, 1º lugar.")

    def test_nota_pelos_degraus_do_filtro_do_maps(self):
        for nota, n, esperado in ((5.0, 30, 3), (4.5, 30, 3), (4.4, 30, 2), (4.0, 30, 2), (3.9, 30, 1),
                                  (1.0, 3, 1), (None, 0, 0)):
            self.assertEqual(cp.bloco_nota(nota, n)["nota"], esperado, nota)
        self.assertFalse(cp.bloco_nota(None, None)["medido"])

    def test_avaliacoes_contra_a_mediana(self):
        conc = [40, 50, 60, 80, 90]  # mediana 60
        for n, esperado in ((60, 3), (200, 3), (59, 2), (30, 2), (29, 1), (1, 1), (0, 0)):
            self.assertEqual(cp.bloco_avaliacoes(n, conc)["nota"], esperado, n)
        par = [10, 20, 41, 41]  # mediana 30,5: a meta sobe para 31, a comparação é com 30,5
        self.assertEqual(cp.bloco_avaliacoes(31, par)["nota"], 3)
        self.assertEqual(cp.bloco_avaliacoes(30, par)["nota"], 2)
        self.assertEqual(cp.bloco_avaliacoes(15, par)["nota"], 1)
        self.assertIn("os concorrentes têm 31", cp.bloco_avaliacoes(30, par)["linha"])
        self.assertEqual(cp.bloco_avaliacoes(0, None)["nota"], 0)  # nenhuma é fato, com ou sem busca
        self.assertFalse(cp.bloco_avaliacoes(18, None)["medido"])

    def test_concorrentes_sem_repetir_e_so_os_cinco_primeiros(self):
        a = busca(1, avaliacoes=(10, 20, 30, 40, 50, 9999), prefixo="x")
        b = busca(1, avaliacoes=(10, 70), prefixo="x")  # x0 e x1 já vistos
        b["concorrentes"].append({"id": "y", "avaliacoes": None})  # sem número: fora, não zero
        self.assertEqual(cp.concorrentes_da_busca([a, b]), [10, 20, 30, 40, 50])

    def test_respostas(self):
        for lidas, resp, esperado in ((5, 5, 3), (5, 3, 2), (4, 2, 2), (5, 2, 1), (5, 1, 1), (5, 0, 0)):
            self.assertEqual(cp.bloco_respostas({"lidas": lidas, "respondidas": resp})["nota"], esperado)
        self.assertFalse(cp.bloco_respostas(None)["medido"])
        self.assertFalse(cp.bloco_respostas({"lidas": 2, "respondidas": 2})["medido"])
        with self.assertRaises(ValueError):
            cp.bloco_respostas({"lidas": 5, "respondidas": 6})

    def test_perfil_piso_de_tres_vezes_a_fracao(self):
        itens = ["horario", "fotos", "categoria", "telefone", "site"]
        for ok, esperado in ((5, 3), (4, 2), (3, 1), (2, 1), (1, 0), (0, 0)):
            p = {k: "ok" if i < ok else "falta" for i, k in enumerate(itens)}
            self.assertEqual(cp.bloco_perfil(p)["nota"], esperado, ok)
        # Não conferido fica fora da conta: 3 de 3 conferidos = 3, nunca "3 de 5".
        p = {"horario": "ok", "telefone": "ok", "site": "ok", "fotos": None}
        b = cp.bloco_perfil(p)
        self.assertEqual((b["nota"], b["linha"]), (3, "3 de 3 itens em dia. 2 não conferidos."))
        self.assertFalse(cp.bloco_perfil({"horario": "ok", "site": "falta"})["medido"])
        self.assertEqual(cp.bloco_perfil({**PERFIL_OK, "fotos": "falta", "categoria": "falta"})["linha"],
                         "Faltam fotos publicadas por vocês e uma categoria que diga o que vocês fazem. 3 de 5 itens em dia.")
        with self.assertRaises(ValueError):
            cp.bloco_perfil({"logo": "ok"})

    def test_site(self):
        casos = (({"tipo": "nenhum"}, 0), ({"tipo": "rede", "onde": "o Instagram"}, 1),
                 ({"tipo": "proprio", "estado": "fora"}, 0), ({"tipo": "proprio", "estado": "sem_nome"}, 0),
                 (SITE_OK, 3), ({**SITE_OK, "celular": False}, 2), ({**SITE_OK, "whatsapp": False}, 2),
                 ({**SITE_OK, "celular": False, "whatsapp": False}, 1),
                 ({**SITE_OK, "whatsapp": None}, 3))  # não conferido não vira falta
        for site, esperado in casos:
            self.assertEqual(cp.bloco_site(site)["nota"], esperado, site)
        self.assertFalse(cp.bloco_site(None)["medido"])
        self.assertFalse(cp.bloco_site({"tipo": "proprio", "estado": None})["medido"])
        self.assertEqual(cp.bloco_site({**SITE_OK, "whatsapp": None})["linha"],
                         "O site de vocês abre e está pronto para celular. Não conferimos o WhatsApp.")
        self.assertEqual(cp.bloco_site({**SITE_OK, "whatsapp": False})["cenario"],
                         "Se o site de vocês tivesse botão de WhatsApp")


class NaoMedido(unittest.TestCase):
    def test_seis_medidos_a_nota_e_a_soma(self):
        p = cp.nota_de_presenca([busca(5)], 4.2, 30, {"lidas": 5, "respondidas": 5}, PERFIL_OK, SITE_OK)
        self.assertEqual(notas(p), {"busca": 2, "nota": 2, "avaliacoes": 2, "respostas": 3, "perfil": 3, "site": 3})
        self.assertEqual((p["soma"], p["medidos"], p["nota"]), (15, 6, 15.0))
        self.assertEqual(p["faixa"]["chave"], "alta")

    def test_bloco_sem_dado_fica_fora_da_conta_e_a_nota_e_proporcional(self):
        p = cp.nota_de_presenca([busca(7)], 5.0, 18, None, PERFIL_OK, {"tipo": "proprio", "estado": "fora"})
        self.assertEqual(notas(p), {"busca": 2, "nota": 3, "avaliacoes": 1, "respostas": None, "perfil": 3, "site": 0})
        self.assertEqual((p["soma"], p["medidos"], p["nota"]), (9, 5, 10.8))  # 9 × 18 ÷ 15
        nm = p["blocos"][3]
        self.assertFalse(nm["medido"])
        self.assertIsNone(nm["nota"])  # nunca zero calado
        self.assertTrue(nm["linha"].startswith("Não medimos"))
        h = cp.bloco_html(p)
        self.assertIn("não medimos", h)
        self.assertIn("Medimos 5 dos 6 pontos. O que não medimos (“Responde às avaliações”) fica fora da conta", h)
        self.assertIn("9 de 15 pontos, que valem 10,8 numa escala de 18", h)

    def test_com_menos_de_quatro_medidos_nao_ha_nota_nem_bloco(self):
        p = cp.nota_de_presenca(None, 5.0, 18, None, PERFIL_OK, None)
        self.assertEqual(p["medidos"], 2)
        self.assertIsNone(p["nota"])
        self.assertIsNone(p["faixa"])
        self.assertEqual(cp.bloco_html(p), "")

    def test_cenarios_os_tres_de_menor_nota_e_nenhum_com_tudo_em_dia(self):
        p = cp.nota_de_presenca([busca(None)], 4.2, 18, None, {**PERFIL_OK, "fotos": "falta"}, {"tipo": "nenhum"})
        self.assertEqual(len(p["cenarios"]), 3)
        self.assertTrue(p["cenarios"][0].startswith("Se vocês aparecessem entre os 3 primeiros"))  # busca 0
        self.assertTrue(p["cenarios"][1].startswith("Se o botão “Site” levasse"))  # site 0
        tudo = cp.nota_de_presenca([busca(1)], 4.8, 90, None, PERFIL_OK, SITE_OK)
        self.assertEqual(tudo["cenarios"], [])
        self.assertNotIn("calculo", cp.bloco_html(tudo))  # sem distância, sem calculadora


# Tabela da calculadora: (o que o dono digita, valor lido, mensal, anual, primeira linha da conta).
CASOS_DA_CALCULADORA = [
    ("1.250,50", 1250.5, 1251, 15012, "1 cliente a mais por mês × R$ 1.250,50 = R$ 1.251 por mês"),
    ("1250,5", 1250.5, 1251, 15012, None),
    ("R$ 800", 800.0, 800, 9600, "1 cliente a mais por mês × R$ 800 = R$ 800 por mês"),
    (" 2.400 ", 2400.0, 2400, 28800, None),
    ("1250.50", 1250.5, 1251, 15012, None),
    ("0,49", 0.49, 0, 0, "1 cliente a mais por mês × R$ 0,49 = R$ 0 por mês"),
    ("12.345.678,99", 12345678.99, 12345679, 148148148, None),
    ("1,005", None, None, None, None),  # três decimais: não é dinheiro
    ("0", None, None, None, None),
    ("-300", None, None, None, None),
    ("abc", None, None, None, None),
    ("", None, None, None, "1 cliente a mais por mês × R$ ___ = R$ ___ por mês"),
    ("12,345.67", None, None, None, None),
]


class Calculadora(unittest.TestCase):
    def test_tabela_em_python(self):
        for texto, valor, mensal, anual, linha in CASOS_DA_CALCULADORA:
            self.assertEqual(cp.ler_valor(texto), valor, texto)
            conta = cp.conta_da_calculadora(texto)
            self.assertEqual(None if conta is None else (conta["mensal"], conta["anual"]),
                             None if mensal is None else (mensal, anual), texto)
            if linha:
                self.assertEqual(cp.frase_da_conta(conta)[0], linha, texto)

    def test_anual_e_o_mensal_arredondado_vezes_doze(self):
        conta = cp.conta_da_calculadora("1.250,50")
        self.assertEqual(conta["anual"], conta["mensal"] * 12)
        self.assertEqual(cp.frase_da_conta(conta)[1], "R$ 1.251 por mês × 12 = R$ 15.012 por ano")
        self.assertEqual(cp.frase_da_conta(None)[1], "R$ ___ por mês × 12 = R$ ___ por ano")

    def test_o_js_faz_a_mesma_conta(self):
        """O JS da página (gerado pelo módulo) roda no node sobre a mesma tabela."""
        node = shutil.which("node")
        if not node:
            self.skipTest("node fora do PATH")
        js = cp.js_calculadora()
        self.assertIn("var N=1,M=12;", js)
        self.assertNotIn("__N__", js)
        textos = [c[0] for c in CASOS_DA_CALCULADORA]
        roteiro = ("var module={exports:{}};\n" + js + "\nvar f=module.exports,saida=[];"
                   f"var textos={json.dumps(textos)};"
                   "textos.forEach(function(t){var v=f.ler(t),k=f.conta(v);"
                   "saida.push({v:v,k:k,linhas:f.frases(k)})});"
                   "process.stdout.write(JSON.stringify(saida));")
        with tempfile.TemporaryDirectory(prefix="calculo-prumo-teste-") as tmp:
            arq = Path(tmp) / "conta.js"
            arq.write_text(roteiro, encoding="utf-8")
            r = subprocess.run([node, str(arq)], capture_output=True, text=True, encoding="utf-8", timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        for (texto, *_), js_ in zip(CASOS_DA_CALCULADORA, json.loads(r.stdout)):
            conta = cp.conta_da_calculadora(texto)
            self.assertEqual(js_["v"], cp.ler_valor(texto), texto)
            self.assertEqual(None if js_["k"] is None else (js_["k"]["mensal"], js_["k"]["anual"]),
                             None if conta is None else (conta["mensal"], conta["anual"]), texto)
            self.assertEqual(js_["linhas"], list(cp.frase_da_conta(conta)), texto)


class BlocoHtml(unittest.TestCase):
    def setUp(self):
        self.p = cp.nota_de_presenca([busca(7, consulta="advogado <b>em</b> Vitória")], 5.0, 18, None, PERFIL_OK,
                                     {"tipo": "rede", "onde": "o Instagram"})
        self.h = cp.bloco_html(self.p, "Fulano")

    def test_visual_do_resumo_do_mapa(self):
        self.assertIn('<section class="presenca"><h2>Nota de presença</h2>', self.h)
        self.assertIn("<small>/18</small>", self.h)
        self.assertEqual(self.h.count('class="trilho"'), 7)  # a nota e um por bloco
        self.assertIn("1 de 3", self.h)

    def test_campo_acessivel_e_conta_em_branco(self):
        self.assertIn('<label for="prumo-valor">Quanto vale, em média, um cliente fechado para vocês?</label>', self.h)
        self.assertIn('id="prumo-valor"', self.h)
        self.assertIn('inputmode="decimal"', self.h)
        self.assertIn('aria-live="polite"', self.h)
        self.assertIn("1 cliente a mais por mês × R$ ___ = R$ ___ por mês", self.h)
        self.assertIn("É um cenário, não uma promessa.", self.h)
        self.assertIn("não se somam", self.h)

    def test_escapa_e_nao_inventa_valor(self):
        self.assertNotIn("<b>em</b>", self.h)
        self.assertIn("&lt;b&gt;em&lt;/b&gt;", self.h)
        sem_script = re.sub(r"<script>.*?</script>", "", self.h, flags=re.S)
        self.assertNotRegex(sem_script, r"R\$ \d")  # nenhum valor em reais sem o dono digitar
        self.assertNotIn("sem custo", self.h)
        self.assertNotRegex((self.h + cp.CSS_PRESENCA).lower(), r"blue|border-radius:\s*[1-9]")

    def test_um_script_so(self):
        self.assertEqual(self.h.count("<script>"), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
