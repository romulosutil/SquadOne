"""nova-oferta.py em diretório temporário: nunca toca o prumo-ofertas.json real, o catálogo real da Prumo,
a rede ou o n8n. O catálogo é sintético (--prumo numa pasta temporária, sem git)."""
import contextlib
import copy
import importlib.util
import io
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("nova_oferta", AQUI / "nova-oferta.py")
no = importlib.util.module_from_spec(spec)
spec.loader.exec_module(no)
REAL = AQUI / "prumo-ofertas.json"
# Catálogo fictício no formato da Prumo de 28/10/2026 (receita e funil em cada produto).
CATALOGO = {"versao": 1, "familias": [], "produtos": [
    {"id": "iris", "nome": "Iris", "receita": "assinatura", "funil": True},
    {"id": "crm", "nome": "CRM de estamparia", "receita": "assinatura", "funil": True},
    {"id": "otica", "nome": "Agenda de ótica (fictício)", "receita": "projeto", "funil": True},
    {"id": "fora", "nome": "Fora do funil (fictício)", "receita": "assinatura", "funil": False},
    {"id": "ovo", "nome": "Em incubação (fictício)", "receita": "incubacao", "funil": True},
    {"id": "velho", "nome": "Sem os campos novos (fictício)"}]}


def preenchida(bloco):
    """O bloco criado com os TODO trocados por um negócio fictício que passa no lint."""
    b = copy.deepcopy(bloco)
    b.update(rotulo="Ótica", sigla="Ótica", aba="Óticas", empresa="ótica", plural="óticas",
             segmento="otica|optica|oculos", fora="atacadista|distribuidora", perfil="exame de vista|optometr|\\blentes\\b",
             perfil_motivo="Fora do perfil (sem exame de vista no nome nem no site)", fora_sem_perfil="deposito",
             fora_sem_perfil_motivo="Fora do perfil (depósito)", cacador_rotulo="Encontrado pelo Caçador de óticas",
             fonte="PRUMO — Óticas (Ótica)", fluxo="PRUMO · Ótica — Caçador de óticas",
             clique="PRUMO · Ótica — Clique em Enviar convite", catalogo_prumo="otica",
             nichos=["ótica de bairro"], cidades=["Vitória ES"], sinais=[["exame de vista", "exame de vista"]],
             mensagem="{OLA}! Sou o Rômulo, do Prumo. Trabalho com uma agenda de exames para óticas.\n\nPosso te mostrar um exemplo com dados fictícios para a equipe da {NOME}?",
             proxima_enviado="Aguarde a resposta.",
             conversa={"o_que_foi": "Oferece um exemplo da agenda com dados fictícios.", "interesse": "Combine a demonstração."})
    return b


class NovaOferta(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.arquivo = Path(self.tmp.name) / "prumo-ofertas.json"
        shutil.copyfile(REAL, self.arquivo)
        self.real_antes = REAL.read_bytes()
        self.prumo = Path(self.tmp.name) / "prumo"
        self.escrever_catalogo(CATALOGO)
        self.catalogo = no.achar_catalogo(self.prumo)
        # Nada pode cair no catálogo real: sem --prumo, os caminhos padrão apontam para o vazio.
        self.env = patch.dict(os.environ, {"PRUMO_REPO": str(Path(self.tmp.name) / "sem-prumo")})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()
        self.assertEqual(REAL.read_bytes(), self.real_antes, "o JSON real não pode mudar")

    def escrever_catalogo(self, catalogo):
        (self.prumo / "06-qualidade").mkdir(parents=True, exist_ok=True)
        (self.prumo / "06-qualidade/catalogo.json").write_text(json.dumps(catalogo, ensure_ascii=False), encoding="utf-8")

    def silencioso(self, f, *a, **k):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            r = f(*a, **k)
        return r, out.getvalue()

    def test_cria_o_bloco_com_os_nomes_derivados_sem_mexer_no_resto(self):
        texto_antes = self.arquivo.read_text(encoding="utf-8")
        antes = json.loads(texto_antes)
        bloco = no.criar(self.arquivo, "otica", "iris", rotulo="Ótica", plural="óticas", aba="Óticas")
        texto = self.arquivo.read_text(encoding="utf-8")
        depois = json.loads(texto)
        # Só entrou o bloco: as ofertas e o nível de cima são os mesmos, e o texto até a inserção é o mesmo.
        self.assertEqual({k: v for k, v in depois["ofertas"].items() if k != "otica"}, antes["ofertas"])
        self.assertEqual({k: v for k, v in depois.items() if k != "ofertas"}, {k: v for k, v in antes.items() if k != "ofertas"})
        corte = texto_antes.rstrip().rfind("\n    }")
        self.assertEqual(texto[:corte], texto_antes[:corte])
        self.assertTrue(texto.endswith("\n    }\n  }\n}\n"))
        o = depois["ofertas"]["otica"]
        self.assertEqual(o, bloco)
        self.assertEqual(list(depois["ofertas"])[-1], "otica")
        self.assertEqual((o["convite"], o["sala"], o["link_retrato"], o["tipo"], o["teto_por_rodada"]),
                         ("convite-otica", "prumo--otica", "planilhaOtica", "propria", 15))
        self.assertEqual(o["fluxo"], "PRUMO · Ótica — Caçador de óticas")
        self.assertEqual(o["clique"], "PRUMO · Ótica — Clique em Enviar convite")
        self.assertEqual(o["cacador_rotulo"], "Encontrado pelo Caçador de óticas")
        self.assertEqual(o["fonte"], "PRUMO — Óticas (Ótica)")
        self.assertNotIn(o["webhook_id"], {v["webhook_id"] for k, v in antes["ofertas"].items()})
        self.assertRegex(o["webhook_id"], r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        # Negócio em TODO (o produto da Prumo também: nunca copiado do modelo), opcionais desligados, notas fora.
        for k in ("segmento", "perfil", "mensagem", "sigla", "empresa", "catalogo_prumo"):
            self.assertIn("TODO", o[k], k)
        self.assertIn("TODO", o["nichos"][0]); self.assertIn("TODO", o["cidades"][0])
        self.assertIn("TODO", o["conversa"]["o_que_foi"]); self.assertIn("TODO", o["sinais"][0][1])
        for k in ("solo", "fora_entidade", "site_diretorio", "fora_entidade_motivo"):
            self.assertEqual(o[k], "", k)
        self.assertFalse([k for k in o if k.startswith("_") and k != "_nova"])
        self.assertEqual([k for k in o if not k.startswith("_")], [k for k in antes["ofertas"]["iris"] if not k.startswith("_")])

    def test_catalogo_prumo_pela_linha_de_comando(self):
        self.silencioso(no.main, ["otica", "--como", "estampa", "--arquivo", str(self.arquivo), "--catalogo-prumo", "otica"])
        self.assertEqual(json.loads(self.arquivo.read_text(encoding="utf-8"))["ofertas"]["otica"]["catalogo_prumo"], "otica")

    def test_nunca_sobrescreve_nem_aceita_id_ou_modelo_ruim(self):
        original = self.arquivo.read_bytes()
        for id_, como in (("iris", "iris"), ("estampa", "iris"), ("site", "iris"), ("plus", "iris"), ("registros", "iris"),
                          ("const", "iris"), ("OTICA", "iris"), ("ab", "iris"), ("oferta_nova", "iris"), ("otica", "inventada")):
            with self.subTest(id_=id_, como=como), self.assertRaises(SystemExit):
                no.criar(self.arquivo, id_, como)
            self.assertEqual(self.arquivo.read_bytes(), original)

    def test_conferir_aponta_os_todo_e_passa_quando_preenchida(self):
        no.criar(self.arquivo, "otica", "iris")
        cfg = json.loads(self.arquivo.read_text(encoding="utf-8"))
        p = no.problemas_da_oferta(cfg, "otica", self.catalogo)
        self.assertTrue(any("TODO" in x and "catalogo_prumo" in x for x in p), p)
        cfg["ofertas"]["otica"] = preenchida(cfg["ofertas"]["otica"])
        self.assertEqual(no.problemas_da_oferta(cfg, "otica", self.catalogo), [])
        for k in cfg["ofertas"]:
            self.assertEqual(no.problemas_da_oferta(cfg, k, self.catalogo), [], k)  # as ofertas reais seguem limpas

    def test_trava_do_portfolio(self):
        """28/10/2026: produto em incubação, fora do funil ou fora do catálogo não vira oferta."""
        no.criar(self.arquivo, "otica", "iris")
        cfg = json.loads(self.arquivo.read_text(encoding="utf-8"))
        base = preenchida(cfg["ofertas"]["otica"])
        sem_campo = {k: v for k, v in base.items() if k != "catalogo_prumo"}
        casos = {
            "em incubação": ({**base, "catalogo_prumo": "ovo"}, self.catalogo),
            "funil false": ({**base, "catalogo_prumo": "fora"}, self.catalogo),
            "não está em prumo/06-qualidade/catalogo.json": ({**base, "catalogo_prumo": "inexistente"}, self.catalogo),
            "rode a versão nova do catálogo": ({**base, "catalogo_prumo": "velho"}, self.catalogo),
            "catalogo_prumo: obrigatório": (sem_campo, self.catalogo),
            "vazio": ({**base, "catalogo_prumo": " "}, self.catalogo),
            "catálogo da Prumo não encontrado": (base, no.achar_catalogo(Path(self.tmp.name) / "nao-existe")),
        }
        for esperado, (oferta, catalogo) in casos.items():
            with self.subTest(esperado):
                c = copy.deepcopy(cfg)
                c["ofertas"]["otica"] = oferta
                p = no.problemas_da_oferta(c, "otica", catalogo)
                self.assertTrue(p, esperado)
                if esperado != "vazio":
                    self.assertTrue(any(esperado in x for x in p), p)

    def test_catalogo_ausente_e_explicito_e_nao_cai_em_outro(self):
        self.assertEqual(no.raizes_da_prumo(self.prumo), [self.prumo])
        r = no.achar_catalogo(Path(self.tmp.name) / "nao-existe")
        self.assertIsNone(r["produtos"]); self.assertIn("--prumo", r["erro"])
        with patch.dict(os.environ, {"PRUMO_REPO": str(self.prumo)}):
            self.assertEqual(no.raizes_da_prumo()[0], self.prumo)
            self.assertEqual(set(no.achar_catalogo()["produtos"]), {p["id"] for p in CATALOGO["produtos"]})
        (self.prumo / "06-qualidade/catalogo.json").write_text("{ruim", encoding="utf-8")
        self.assertIn("ilegível", no.achar_catalogo(self.prumo)["erro"])

    def test_lint_do_texto_regex_teto_e_glossario(self):
        no.criar(self.arquivo, "otica", "iris")
        cfg = json.loads(self.arquivo.read_text(encoding="utf-8"))
        base = preenchida(cfg["ofertas"]["otica"])
        casos = {
            "R$": {"mensagem": base["mensagem"].replace("uma agenda", "uma agenda de R$ 50")},
            "uma pergunta só": {"mensagem": base["mensagem"] + " Tudo bem?"},
            "{NOME}": {"mensagem": base["mensagem"].replace("{NOME}", "ótica")},
            "link": {"mensagem": base["mensagem"].replace("óticas.", "óticas: https://x.invalid.")},
            "fundador": {"mensagem": base["mensagem"].replace("óticas.", "óticas, preço de fundador.")},
            "desconto": {"mensagem": base["mensagem"].replace("óticas.", "óticas com desconto.")},
            "começa por": {"mensagem": "Oi! " + base["mensagem"]},
            "teto_por_rodada": {"teto_por_rodada": 16},
            "regex segmento": {"segmento": "otica("},
            "regex sinais[0]": {"sinais": [["x", "[exame"]]},
            "backspace": {"perfil": "exame|\bvista"},
            "CRM": {"rotulo": "CRM de óticas", "fluxo": "PRUMO · CRM de óticas — Caçador de óticas",
                    "clique": "PRUMO · CRM de óticas — Clique em Enviar convite"},
            "contrato": {"aba": "Prospects"},
            "nichos": {"nichos": []},
        }
        for esperado, mudar in casos.items():
            with self.subTest(esperado):
                c = copy.deepcopy(cfg)
                c["ofertas"]["otica"] = {**base, **mudar}
                p = no.problemas_da_oferta(c, "otica", self.catalogo)
                self.assertTrue(any(esperado in x for x in p), p)

    def test_codigo_de_todas_as_ofertas_e_montado_sem_rede(self):
        no.criar(self.arquivo, "otica", "iris")
        cfg = json.loads(self.arquivo.read_text(encoding="utf-8"))
        cfg["ofertas"]["otica"] = preenchida(cfg["ofertas"]["otica"])
        codigos = no.codigo_gerado(cfg)
        for k in cfg["ofertas"]:
            for nome in ("Triar e checar sites", "Escolher a busca", "Decidir"):
                self.assertIn(f"{k} · {nome}", codigos)
        self.assertIn("const otica = ler('Ler Óticas', 'ID');", codigos["08 · CRM · Montar retrato"])
        self.assertIn("'otica'", codigos["08 · CRM · Validar registro"])
        erros = no.node_check(codigos)
        if erros is not None:
            self.assertEqual(erros, [])

    def test_cli_cria_confere_e_nunca_publica(self):
        r, out = self.silencioso(no.main, ["otica", "--como", "iris", "--arquivo", str(self.arquivo)])
        self.assertEqual(r, 0); self.assertIn("TODO", out)
        r, out = self.silencioso(no.main, ["--conferir", "otica", "--arquivo", str(self.arquivo), "--sem-testes",
                                           "--prumo", str(self.prumo)])
        self.assertEqual(r, 1)
        for trecho in ("campos ainda com TODO", "npx tsx scripts/ofertas-gerar.ts", "npx vue-tsc --noEmit", "npm test",
                       "python3 prumo-ofertas.py`", "python3 crm.py", "python3 whatsapp-conversa.py", "prumo--otica",
                       "--estado", "Nada foi publicado nem ligado", "deploy/dell/publicador-crm.py: FONTES",
                       f"catálogo da Prumo: {self.prumo} (disco)"):
            self.assertIn(trecho, out)
        # A ordem na Mel: JSON reinstalado, ofertas, CRM, WhatsApp, roster, estado.
        posicoes = [out.index(t) for t in ("dell-status --instalados", "python3 prumo-ofertas.py`", "python3 crm.py",
                                          "python3 whatsapp-conversa.py", "prumo--otica com PO", "--estado`")]
        self.assertEqual(posicoes, sorted(posicoes))
        self.assertNotIn("--ativar otica`:", out.split("Ligar o caçador")[0])

    def test_conferir_das_ofertas_atuais_passa_sem_testes(self):
        r, out = self.silencioso(no.main, ["--conferir", "--arquivo", str(self.arquivo), "--sem-testes", "--prumo", str(self.prumo)])
        self.assertEqual(r, 0, out)

    def test_conferir_sem_catalogo_falha_com_o_motivo(self):
        r, out = self.silencioso(no.main, ["--conferir", "iris", "--arquivo", str(self.arquivo), "--sem-testes",
                                           "--prumo", str(Path(self.tmp.name) / "nao-existe")])
        self.assertEqual(r, 1)
        self.assertIn("catálogo da Prumo não encontrado", out)
        self.escrever_catalogo({"produtos": [{"id": "iris", "nome": "Iris"}, {"id": "crm", "nome": "CRM"}]})
        r, out = self.silencioso(no.main, ["--conferir", "--arquivo", str(self.arquivo), "--sem-testes", "--prumo", str(self.prumo)])
        self.assertEqual(r, 1)
        self.assertIn("rode a versão nova do catálogo", out)


if __name__ == "__main__":
    unittest.main()
