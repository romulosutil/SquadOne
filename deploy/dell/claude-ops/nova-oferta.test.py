"""nova-oferta.py em diretório temporário: nunca toca o prumo-ofertas.json real, a rede ou o n8n."""
import contextlib
import copy
import importlib.util
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("nova_oferta", AQUI / "nova-oferta.py")
no = importlib.util.module_from_spec(spec)
spec.loader.exec_module(no)
REAL = AQUI / "prumo-ofertas.json"


def preenchida(bloco):
    """O bloco criado com os TODO trocados por um negócio fictício que passa no lint."""
    b = copy.deepcopy(bloco)
    b.update(rotulo="Prisma PDV", sigla="PDV", aba="Lojas", empresa="loja", plural="lojas",
             segmento="loja|varejo|mercearia", fora="atacadista|distribuidora", perfil="caixa|\\bpdv\\b|balc[aã]o",
             perfil_motivo="Fora do perfil (sem caixa no nome nem no site)", fora_sem_perfil="deposito",
             fora_sem_perfil_motivo="Fora do perfil (depósito)", cacador_rotulo="Encontrado pelo Caçador de lojas",
             fonte="PRUMO — Lojas (Prisma PDV)", fluxo="PRUMO · Prisma PDV — Caçador de lojas",
             clique="PRUMO · Prisma PDV — Clique em Enviar convite",
             nichos=["loja de bairro"], cidades=["Vitória ES"], sinais=[["um caixa", "caixa"]],
             mensagem="{OLA}! Sou o Rômulo, do Prumo. Trabalho com um sistema de caixa para lojas.\n\nPosso te mostrar um exemplo com dados fictícios para a equipe da {NOME}?",
             proxima_enviado="Aguarde a resposta.",
             conversa={"o_que_foi": "Oferece um exemplo do Prisma PDV com dados fictícios.", "interesse": "Combine a demonstração."})
    return b


class NovaOferta(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.arquivo = Path(self.tmp.name) / "prumo-ofertas.json"
        shutil.copyfile(REAL, self.arquivo)
        self.real_antes = REAL.read_bytes()

    def tearDown(self):
        self.tmp.cleanup()
        self.assertEqual(REAL.read_bytes(), self.real_antes, "o JSON real não pode mudar")

    def silencioso(self, f, *a, **k):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            r = f(*a, **k)
        return r, out.getvalue()

    def test_cria_o_bloco_com_os_nomes_derivados_sem_mexer_no_resto(self):
        texto_antes = self.arquivo.read_text(encoding="utf-8")
        antes = json.loads(texto_antes)
        bloco = no.criar(self.arquivo, "pdv", "iris", rotulo="Prisma PDV", plural="lojas", aba="Lojas")
        texto = self.arquivo.read_text(encoding="utf-8")
        depois = json.loads(texto)
        # Só entrou o bloco: as ofertas e o nível de cima são os mesmos, e o texto até a inserção é o mesmo.
        self.assertEqual({k: v for k, v in depois["ofertas"].items() if k != "pdv"}, antes["ofertas"])
        self.assertEqual({k: v for k, v in depois.items() if k != "ofertas"}, {k: v for k, v in antes.items() if k != "ofertas"})
        corte = texto_antes.rstrip().rfind("\n    }")
        self.assertEqual(texto[:corte], texto_antes[:corte])
        self.assertTrue(texto.endswith("\n    }\n  }\n}\n"))
        o = depois["ofertas"]["pdv"]
        self.assertEqual(list(depois["ofertas"])[-1], "pdv")
        self.assertEqual((o["convite"], o["sala"], o["link_retrato"], o["tipo"], o["teto_por_rodada"]),
                         ("convite-pdv", "prumo--pdv", "planilhaPdv", "propria", 15))
        self.assertEqual(o["fluxo"], "PRUMO · Prisma PDV — Caçador de lojas")
        self.assertEqual(o["clique"], "PRUMO · Prisma PDV — Clique em Enviar convite")
        self.assertEqual(o["cacador_rotulo"], "Encontrado pelo Caçador de lojas")
        self.assertEqual(o["fonte"], "PRUMO — Lojas (Prisma PDV)")
        self.assertNotIn(o["webhook_id"], {v["webhook_id"] for k, v in antes["ofertas"].items()})
        self.assertRegex(o["webhook_id"], r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        # Negócio em TODO, opcionais do modelo desligados, notas do modelo fora.
        for k in ("segmento", "perfil", "mensagem", "sigla", "empresa"):
            self.assertIn("TODO", o[k], k)
        self.assertIn("TODO", o["nichos"][0]); self.assertIn("TODO", o["cidades"][0])
        self.assertIn("TODO", o["conversa"]["o_que_foi"]); self.assertIn("TODO", o["sinais"][0][1])
        for k in ("solo", "fora_entidade", "site_diretorio", "fora_entidade_motivo"):
            self.assertEqual(o[k], "", k)
        self.assertFalse([k for k in o if k.startswith("_") and k != "_nova"])
        self.assertEqual([k for k in o if not k.startswith("_")], [k for k in antes["ofertas"]["iris"] if not k.startswith("_")])

    def test_nunca_sobrescreve_nem_aceita_id_ou_modelo_ruim(self):
        original = self.arquivo.read_bytes()
        for id_, como in (("iris", "iris"), ("estampa", "iris"), ("site", "iris"), ("plus", "iris"), ("registros", "iris"),
                          ("const", "iris"), ("PDV", "iris"), ("ab", "iris"), ("oferta_nova", "iris"), ("pdv", "inventada")):
            with self.subTest(id_=id_, como=como), self.assertRaises(SystemExit):
                no.criar(self.arquivo, id_, como)
            self.assertEqual(self.arquivo.read_bytes(), original)

    def test_conferir_aponta_os_todo_e_passa_quando_preenchida(self):
        no.criar(self.arquivo, "pdv", "iris")
        cfg = json.loads(self.arquivo.read_text(encoding="utf-8"))
        p = no.problemas_da_oferta(cfg, "pdv")
        self.assertTrue(any("TODO" in x for x in p), p)
        cfg["ofertas"]["pdv"] = preenchida(cfg["ofertas"]["pdv"])
        self.assertEqual(no.problemas_da_oferta(cfg, "pdv"), [])
        for k in cfg["ofertas"]:
            self.assertEqual(no.problemas_da_oferta(cfg, k), [], k)  # as ofertas reais seguem limpas

    def test_lint_do_texto_regex_teto_e_glossario(self):
        no.criar(self.arquivo, "pdv", "iris")
        cfg = json.loads(self.arquivo.read_text(encoding="utf-8"))
        base = preenchida(cfg["ofertas"]["pdv"])
        casos = {
            "R$": {"mensagem": base["mensagem"].replace("um sistema", "um sistema de R$ 50")},
            "uma pergunta só": {"mensagem": base["mensagem"] + " Tudo bem?"},
            "{NOME}": {"mensagem": base["mensagem"].replace("{NOME}", "loja")},
            "link": {"mensagem": base["mensagem"].replace("lojas.", "lojas: https://x.invalid.")},
            "fundador": {"mensagem": base["mensagem"].replace("lojas.", "lojas, preço de fundador.")},
            "desconto": {"mensagem": base["mensagem"].replace("lojas.", "lojas com desconto.")},
            "começa por": {"mensagem": "Oi! " + base["mensagem"]},
            "teto_por_rodada": {"teto_por_rodada": 16},
            "regex segmento": {"segmento": "loja("},
            "regex sinais[0]": {"sinais": [["x", "[caixa"]]},
            "backspace": {"perfil": "caixa|\bpdv"},
            "CRM": {"rotulo": "CRM de lojas", "fluxo": "PRUMO · CRM de lojas — Caçador de lojas",
                    "clique": "PRUMO · CRM de lojas — Clique em Enviar convite"},
            "contrato": {"aba": "Prospects"},
            "nichos": {"nichos": []},
        }
        for esperado, mudar in casos.items():
            with self.subTest(esperado):
                c = copy.deepcopy(cfg)
                c["ofertas"]["pdv"] = {**base, **mudar}
                p = no.problemas_da_oferta(c, "pdv")
                self.assertTrue(any(esperado in x for x in p), p)

    def test_codigo_de_todas_as_ofertas_e_montado_sem_rede(self):
        no.criar(self.arquivo, "pdv", "iris")
        cfg = json.loads(self.arquivo.read_text(encoding="utf-8"))
        cfg["ofertas"]["pdv"] = preenchida(cfg["ofertas"]["pdv"])
        codigos = no.codigo_gerado(cfg)
        for k in cfg["ofertas"]:
            for nome in ("Triar e checar sites", "Escolher a busca", "Decidir"):
                self.assertIn(f"{k} · {nome}", codigos)
        self.assertIn("const pdv = ler('Ler Lojas', 'ID');", codigos["08 · CRM · Montar retrato"])
        self.assertIn("'pdv'", codigos["08 · CRM · Validar registro"])
        erros = no.node_check(codigos)
        if erros is not None:
            self.assertEqual(erros, [])

    def test_cli_cria_confere_e_nunca_publica(self):
        r, out = self.silencioso(no.main, ["pdv", "--como", "iris", "--arquivo", str(self.arquivo)])
        self.assertEqual(r, 0); self.assertIn("TODO", out)
        r, out = self.silencioso(no.main, ["--conferir", "pdv", "--arquivo", str(self.arquivo), "--sem-testes"])
        self.assertEqual(r, 1)
        for trecho in ("campos ainda com TODO", "npx tsx scripts/ofertas-gerar.ts", "npx vue-tsc --noEmit", "npm test",
                       "python3 prumo-ofertas.py`", "python3 crm.py", "python3 whatsapp-conversa.py", "prumo--pdv",
                       "--estado", "Nada foi publicado nem ligado", "deploy/dell/publicador-crm.py: FONTES"):
            self.assertIn(trecho, out)
        # A ordem na Mel: JSON reinstalado, ofertas, CRM, WhatsApp, roster, estado.
        posicoes = [out.index(t) for t in ("dell-status --instalados", "python3 prumo-ofertas.py`", "python3 crm.py",
                                          "python3 whatsapp-conversa.py", "prumo--pdv com PO", "--estado`")]
        self.assertEqual(posicoes, sorted(posicoes))
        self.assertNotIn("--ativar pdv`:", out.split("Ligar o caçador")[0])

    def test_conferir_das_ofertas_atuais_passa_sem_testes(self):
        r, out = self.silencioso(no.main, ["--conferir", "--arquivo", str(self.arquivo), "--sem-testes"])
        self.assertEqual(r, 0, out)


if __name__ == "__main__":
    unittest.main()
