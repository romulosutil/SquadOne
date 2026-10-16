#!/usr/bin/env python3
"""Testes do raio-x-ia.py: python3 deploy/dell/raio-x-ia.test.py

Só as funções puras (pergunta, nomes, casar com o lead, leitura das respostas, resumo) e a leitura
de um lead numa raiz temporária. Nada chama o Gemini nem o codex, e o HOME vira um temporário ANTES
do import: um engano de caminho cai no temporário, nunca em ~/auto-site ou ~/prumo-entregas.
"""
import atexit
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_HOME = tempfile.mkdtemp(prefix="raio-x-ia-teste-home-")
os.environ["HOME"] = os.environ["USERPROFILE"] = _HOME
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("SQUADONE_CODEX_BIN", None)
atexit.register(shutil.rmtree, _HOME, True)

_spec = importlib.util.spec_from_file_location("raio_x_ia", Path(__file__).resolve().parent / "raio-x-ia.py")
rx = importlib.util.module_from_spec(_spec)
sys.modules["raio_x_ia"] = rx
_spec.loader.exec_module(rx)


class Pergunta(unittest.TestCase):
    def test_termo_e_cidade_pela_cidade_do_content(self):
        self.assertEqual(rx.termo_e_cidade("empreiteira em Florianópolis", "Florianópolis"), ("empreiteira", "Florianópolis"))

    def test_termo_com_em_no_meio(self):
        # "em" dentro do termo não pode cortar errado quando a cidade é conhecida.
        self.assertEqual(rx.termo_e_cidade("advogado especialista em família em Maringá", "Maringá"),
                         ("advogado especialista em família", "Maringá"))

    def test_sem_cidade_corta_no_ultimo_em(self):
        self.assertEqual(rx.termo_e_cidade("dentista em São José", ""), ("dentista", "São José"))

    def test_sem_consulta_ou_sem_cidade(self):
        self.assertIsNone(rx.termo_e_cidade("", "Recife"))
        self.assertIsNone(rx.termo_e_cidade("dentista", ""))

    def test_pergunta_tem_a_frase_e_a_linha_de_nomes(self):
        p = rx.montar_pergunta("dentista", "Recife")
        self.assertTrue(p.startswith("Qual a melhor opção de dentista em Recife?"))
        self.assertIn("NOMES:", p)


class Nomes(unittest.TestCase):
    def test_linha_nomes_ganha(self):
        texto = "Eu indicaria a **[Otech](https://x)**.\n\nNOMES: Otech Engenharia | Extra Empreiteira | Esplendor Empreiteira"
        self.assertEqual(rx.extrair_nomes(texto), (["Otech Engenharia", "Extra Empreiteira", "Esplendor Empreiteira"], "linha"))

    def test_linha_com_markdown_e_repetido(self):
        texto = "NOMES: **[A Clínica](u)** | 1. B Odonto | a clinica | "
        self.assertEqual(rx.extrair_nomes(texto)[0], ["A Clínica", "B Odonto"])

    def test_usa_a_ultima_linha_nomes(self):
        texto = "NOMES: errado\nmais texto\nNOMES: Certo"
        self.assertEqual(rx.extrair_nomes(texto)[0], ["Certo"])

    def test_sem_linha_usa_negrito_e_pula_cabecalho(self):
        texto = ("Abaixo, por perfil:\n**Para casas:**\n* **UNA Reforma e Construção**: muito bem avaliada.\n"
                 "* **Cavic Engenharia** – tradicional.\n**construção residencial sob encomenda, reformas e gestão de obras completas**")
        self.assertEqual(rx.extrair_nomes(texto), (["UNA Reforma e Construção", "Cavic Engenharia"], "negrito"))

    def test_nada(self):
        self.assertEqual(rx.extrair_nomes("Não sei indicar."), ([], "nenhum"))


class Casar(unittest.TestCase):
    def test_mesmo_nome_com_acento_e_sufixo(self):
        self.assertTrue(rx.casa_com_lead("Alemão Reparos e Serviços", "Alemao reparos", "Florianópolis"))

    def test_oficio_escrito_diferente(self):
        # Visto na medição de 15/10/2026: o Gemini escreveu "Eletricista" onde o Google diz "Elétrica".
        self.assertTrue(rx.casa_com_lead("Hidraluz Encanador e Eletricista", "HIDRALUZ ENCANADOR E ELÉTRICA", "Londrina"))
        self.assertTrue(rx.casa_com_lead("Desentupidora Marco Zero", "Desentupidora Marco Zero", "Recife"))
        self.assertFalse(rx.casa_com_lead("JB Desentupidora", "Desentupidora Marco Zero", "Recife"))
        self.assertFalse(rx.casa_com_lead("Sergio Encanador e Eletricista", "HIDRALUZ ENCANADOR E ELÉTRICA", "Londrina"))

    def test_ordem_trocada_e_generica_diferente(self):
        self.assertTrue(rx.casa_com_lead("Lacerda Advogados", "Advocacia Lacerda"))

    def test_nome_do_google_cheio_de_palavra_chave(self):
        lead = "Advogado em Maringá | Advocacia Beneton | Atendimento Nacional | Busca e Apreensão | Revisões"
        self.assertTrue(rx.casa_com_lead("Beneton Advocacia", lead, "Maringá"))

    def test_so_a_cidade_ou_o_oficio_nao_casa(self):
        self.assertFalse(rx.casa_com_lead("Construtora da Ilha", "Ilha Norte Construções e Reformas", "Florianópolis"))
        self.assertFalse(rx.casa_com_lead("Advocacia Florianópolis", "Advocacia Lacerda", "Florianópolis"))
        self.assertFalse(rx.casa_com_lead("Reformas Florianópolis", "Alemao reparos", "Florianópolis"))

    def test_outra_empresa_nao_casa(self):
        self.assertFalse(rx.casa_com_lead("Otech Engenharia", "Alemao reparos"))
        self.assertFalse(rx.casa_com_lead("Lacerda Silva Advogados", "Advocacia Lacerda Souza"))

    def test_posicao(self):
        self.assertEqual(rx.posicao_do_lead(["X Odonto", "Clínica Sorriso Mare"], "Odonto Sorriso Maré"), 2)
        self.assertIsNone(rx.posicao_do_lead([], "Odonto Sorriso Maré"))

    def test_mencionado_no_texto(self):
        self.assertTrue(rx.mencionado_no_texto("Procure o alemão (Alemão Reparos), que é rápido.", "Alemao reparos"))
        self.assertFalse(rx.mencionado_no_texto("Procure a Otech.", "Alemao reparos"))

    def test_no_places(self):
        top = [{"nome": "Ilha Norte Construções e Reformas"}, {"nome": "Lunari Construtora | Obras e Fundações em Florianópolis"}]
        self.assertEqual(rx.no_places("Lunari Construtora", top, "Florianópolis"), 2)
        self.assertIsNone(rx.no_places("Cavic Engenharia", top, "Florianópolis"))


class Estabilidade(unittest.TestCase):
    def test_jaccard_medio(self):
        self.assertEqual(rx.estabilidade([["A", "B"], ["a", "b"]]), 1.0)
        self.assertEqual(rx.estabilidade([["A", "B"], ["B", "C"], ["A", "B"]]), round((1 / 3 + 1 + 1 / 3) / 3, 3))
        self.assertIsNone(rx.estabilidade([["A"]]))


class Respostas(unittest.TestCase):
    def test_gemini(self):
        r = {"candidates": [{"content": {"parts": [{"text": "oi "}, {"text": "NOMES: A"}]}, "finishReason": "STOP",
                             "groundingMetadata": {"webSearchQueries": ["q1", "q2"], "groundingChunks": [{"web": {"title": "a.com"}}]}}],
             "usageMetadata": {"totalTokenCount": 10}, "modelVersion": "m"}
        s = rx.ler_resposta_gemini(r)
        self.assertEqual((s["texto"], s["buscas"], s["fontes"], s["uso"]["totalTokenCount"]), ("oi NOMES: A", ["q1", "q2"], ["a.com"], 10))

    def test_gemini_sem_candidato(self):
        self.assertEqual(rx.ler_resposta_gemini({})["texto"], "")

    def test_codex(self):
        linhas = [
            {"type": "item.completed", "item": {"type": "agent_message", "text": "Vou pesquisar"}},
            {"type": "item.completed", "item": {"type": "web_search", "query": "q...", "action": {"type": "search", "queries": ["q1", "q2"]}}},
            {"type": "item.completed", "item": {"type": "command_execution"}},
            {"type": "item.completed", "item": {"type": "agent_message", "text": "Final\nNOMES: A"}},
            {"type": "turn.completed", "usage": {"input_tokens": 5, "output_tokens": 2}},
        ]
        s = rx.ler_eventos_codex("\n".join(json.dumps(l) for l in linhas) + "\nlixo")
        self.assertEqual(s["buscas"], ["q1", "q2"])
        self.assertEqual(s["texto"], "Final\nNOMES: A")
        self.assertEqual(s["uso"], {"input_tokens": 5, "output_tokens": 2})
        # Uma ferramenta além da busca aparece no registro: a medição dela não é "só busca".
        self.assertEqual(s["outras_ferramentas"], ["command_execution"])

    def test_args_do_codex_desligam_o_que_nao_e_busca(self):
        a = rx.args_do_codex("/tmp/x")
        self.assertEqual(a[:2], ["--search", "exec"])
        self.assertIn("--ignore-user-config", a)
        for r in ("shell_tool", "plugins", "browser_use"):
            self.assertIn(r, a)
        self.assertEqual(a[-1], "-")


LEAD = {"slug": "alemao-reparos", "nome": "Alemao reparos", "termo": "empreiteira", "cidade": "Florianópolis",
        "vertical": "reformas", "places_top": [{"nome": "Ilha Norte Construções"}, {"nome": "Otech Engenharia"}]}


class Resumo(unittest.TestCase):
    def test_registro_e_resumo(self):
        consultas = [
            rx.registro(LEAD, "gemini", 1, {"ok": True, "texto": "NOMES: Otech Engenharia | Alemão Reparos", "segundos": 10,
                                             "buscas": ["a", "b"], "uso": {"totalTokenCount": 100}}),
            rx.registro(LEAD, "gemini", 2, {"ok": True, "texto": "NOMES: Otech Engenharia", "segundos": 20,
                                             "buscas": ["a"], "uso": {"totalTokenCount": 300}}),
            rx.registro(LEAD, "codex", 1, {"ok": False, "erro": "timeout", "segundos": 180}),
        ]
        self.assertEqual(consultas[0]["posicao_do_lead"], 2)
        self.assertEqual(consultas[0]["no_places"], [2, None])
        self.assertFalse(consultas[2]["ok"])
        res = rx.resumir({"leads": [LEAD], "consultas": consultas})
        g = res["por_assistente"]["gemini"]
        self.assertEqual((g["ok"], g["lead_citado"], g["leads_citados_ao_menos_uma_vez"]), (2, 1, ["alemao-reparos"]))
        self.assertEqual(g["estabilidade_media"], 0.5)
        self.assertEqual((g["segundos_mediana"], g["buscas_por_consulta"], g["tokens_por_consulta"]), (15.0, 1.5, 200))
        self.assertEqual(g["nomes_que_estao_no_top3_do_places"], "2 de 3")
        self.assertEqual(res["por_assistente"]["codex"]["falhas"], ["timeout"])
        pl = res["por_lead"]["alemao-reparos"]
        self.assertEqual(pl["citado"], {"codex": "0/0", "gemini": "1/2"})
        self.assertEqual(pl["mais_citados"][0], "Otech Engenharia (2x)")

    def test_reanalisar_refaz_pelo_texto(self):
        c = rx.registro(LEAD, "gemini", 1, {"ok": True, "texto": "NOMES: Alemão Reparos", "segundos": 1})
        c["posicao_do_lead"], c["nomes"] = None, []  # como se a regra antiga tivesse errado
        nova = rx.reanalisar({"leads": [LEAD], "consultas": [c]})["consultas"][0]
        self.assertEqual((nova["posicao_do_lead"], nova["nomes"], nova["ok"]), (1, ["Alemão Reparos"], True))


class LeituraDoLead(unittest.TestCase):
    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="raio-x-ia-teste-raiz-", dir=_HOME))

    def _lead(self, onde: Path, vertical="reformas", com_places=True):
        onde.mkdir(parents=True)
        (onde / "content.md").write_text(f"# Alemao reparos\n\n- **Vertical:** {vertical}\n- **Cidade:** Florianópolis\n", encoding="utf-8")
        if com_places:
            (onde / "raio-x-places.json").write_text(json.dumps({
                "detalhes": {"nome": "Alemao reparos"},
                "busca": {"consulta": "empreiteira em Florianópolis", "resultados": [{"nome": "Ilha Norte", "nota": 5, "avaliacoes": 50}]}}),
                encoding="utf-8")

    def test_le_da_raiz_e_de_em_conversa(self):
        self._lead(self.raiz / "a")
        self._lead(self.raiz / "_em-conversa" / "b")
        self._lead(self.raiz / "c", com_places=False)
        self.assertEqual(sorted(rx.candidatos(self.raiz)), ["a", "b"])
        lead = rx.carregar_lead(self.raiz, "b")
        self.assertEqual((lead["nome"], lead["termo"], lead["cidade"]), ("Alemao reparos", "empreiteira", "Florianópolis"))
        self.assertEqual(lead["places_top"][0]["nome"], "Ilha Norte")
        self.assertIsNone(rx.carregar_lead(self.raiz, "c"))
        self.assertIsNone(rx.carregar_lead(self.raiz, "nao-existe"))

    def test_escolher_busca(self):
        tres = {"buscas": [{"consulta": "advogado em X"}, {"consulta": "advogado INSS em X"}, {"consulta": "melhor advogado em X"}]}
        self.assertEqual(rx.escolher_busca(tres)["consulta"], "advogado INSS em X")
        duas = {"buscas": [{"consulta": "empreiteira em X"}, {"consulta": "melhor empreiteira em X"}]}
        self.assertEqual(rx.escolher_busca(duas)["consulta"], "empreiteira em X")
        self.assertEqual(rx.escolher_busca({"busca": {"consulta": "v2 em X"}})["consulta"], "v2 em X")
        self.assertEqual(rx.escolher_busca({}), {})

    def test_termo_vago_fica_fora(self):
        places = {"detalhes": {"nome": "AC Advocacia"}, "busca": {"consulta": "consultoria em Ribeirão Preto"}}
        self.assertIsNone(rx.lead_da_pasta("ac", {"Cidade": "Ribeirão Preto"}, places))

    def test_escolher_variados_alterna_ramo(self):
        leads = [{"vertical": "a", "slug": 1}, {"vertical": "a", "slug": 2}, {"vertical": "b", "slug": 3}]
        self.assertEqual([l["slug"] for l in rx.escolher_variados(leads, 2)], [1, 3])

    def test_gravar_e_resumir_pela_linha_de_comando(self):
        arq = self.raiz / "m.json"
        rx.gravar(arq, {"leads": [LEAD], "consultas": []})
        self.assertEqual(json.loads(arq.read_text(encoding="utf-8"))["leads"][0]["slug"], "alemao-reparos")
        self.assertEqual(rx.main(["--resumir", str(arq)]), 0)

    def test_sem_lead_nao_chama_ninguem(self):
        self.assertEqual(rx.main(["--raiz", str(self.raiz), "nao-existe"]), 1)


if __name__ == "__main__":
    unittest.main()
