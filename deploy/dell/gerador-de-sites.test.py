#!/usr/bin/env python3
"""Testes do gerador-de-sites sem Claude, Vercel nem rede: numa pasta
temporária, com `rodar_claude` e `validar` trocados por falsos.

  python3 deploy/dell/gerador-de-sites.test.py
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent


def carregar(auto: Path):
    os.environ["AUTO_DIR"] = str(auto)
    os.environ["SITE_FUNIL"] = str(auto / ".funil.json")  # nunca o retrato real do n8n
    os.environ["SITE_LEADS"] = str(auto / ".leads.json")  # nem a planilha real
    spec = importlib.util.spec_from_file_location("gerador", AQUI / "gerador-de-sites.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.shutil.which = lambda _: "/bin/true"
    m.avisar = lambda texto: None  # nunca grava na fila de avisos real (viraria WhatsApp)
    m.validar = lambda pasta, log_lead: (pasta / "publicado.json").is_file()
    return m


class Gerador(unittest.TestCase):
    def setUp(self):
        self.auto = Path(tempfile.mkdtemp(prefix="gerador-teste-"))
        self.addCleanup(shutil.rmtree, self.auto)
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = "teste"
        self.m = carregar(self.auto)
        for i, slug in enumerate(["a-duplicado", "b-bom", "c-quebra", "d-bom"]):
            (self.auto / slug).mkdir()
            (self.auto / slug / "content.md").write_text(f"# {slug}\nplace_id: x{i}\n")
            os.utime(self.auto / slug / "content.md", (1000 + i, 1000 + i))

    def rodar(self, claude, *args):
        self.m.rodar_claude = claude
        sys.argv = ["gerador-de-sites", "--timeout-min", "1", *args]
        codigo = self.m.main()
        return codigo, json.loads((self.auto / ".logs/status.json").read_text())["ultimo_resumo"]

    def claude_padrao(self, slug, log_lead, timeout_min):
        pasta = self.auto / slug
        if slug == "a-duplicado":  # o Claude acha site e move o lead (caso de 29/09/2026)
            (self.auto / "_descartados").mkdir(exist_ok=True)
            pasta.rename(self.auto / "_descartados" / slug)
        elif slug == "c-quebra":
            raise RuntimeError("erro inesperado")
        else:
            (pasta / "index.html").write_text("<html></html>")
            (pasta / "publicado.json").write_text('{"site_url": "https://x"}')
        return {"codigo": 0, "estourou": False, "limite": False, "minutos": 0}

    def test_descartado_nao_derruba_o_lote(self):
        codigo, r = self.rodar(self.claude_padrao)
        self.assertEqual(codigo, 0)
        self.assertEqual(r["descartados"], ["a-duplicado → _descartados"])
        self.assertEqual(r["concluidos"], ["b-bom", "d-bom"])
        # Lead que falha continua o mais antigo da fila: tenta de novo na hora e,
        # com 2 falhas no falha.log, sai da fila (regra de sempre).
        self.assertEqual(len(r["falhas"]), 2)
        self.assertTrue(all(f.startswith("c-quebra: erro no runner") for f in r["falhas"]))
        self.assertEqual(r["tentativas"], 5)
        self.assertNotIn("erro", r)
        self.assertEqual(self.m.falhas_registradas(self.auto / "c-quebra"), 2)
        self.assertNotIn("c-quebra", [p.name for p in self.m.fila()])
        self.assertFalse((self.auto / ".logs/gerador.lock").exists())
        log = (self.auto / ".logs/execucao-fila.log").read_text()
        self.assertIn("a-duplicado foi para _descartados/", log)

    def test_pasta_sumida_segue_e_nao_vira_falha(self):
        def claude(slug, log_lead, timeout_min):
            if slug == "a-duplicado":
                shutil.rmtree(self.auto / slug)
                return {"codigo": 0, "estourou": False, "limite": False, "minutos": 0}
            return self.claude_padrao(slug, log_lead, timeout_min)
        codigo, r = self.rodar(claude, "--quantidade", "2")
        self.assertEqual(codigo, 0)
        self.assertEqual(r["sumidos"], ["a-duplicado"])
        self.assertEqual(r["concluidos"], ["b-bom"])
        self.assertEqual(len(r["falhas"]), 1)  # c-quebra; o sumido não é falha

    def test_duas_falhas_tiram_o_lead_da_fila(self):
        (self.auto / "c-quebra/falha.log").write_text("[x] um\n")
        self.rodar(self.claude_padrao)
        self.assertNotIn("c-quebra", [p.name for p in self.m.fila()])

    def test_registrar_falha_sem_pasta_nao_levanta(self):
        self.m.registrar_falha(self.auto / "nao-existe", "motivo", self.auto / ".logs/x.log")

    def test_so_falhas_viram_codigo_1(self):
        def claude(slug, log_lead, timeout_min):
            return {"codigo": 1, "estourou": False, "limite": False, "minutos": 0}
        codigo, r = self.rodar(claude, "--quantidade", "2")
        self.assertEqual(codigo, 1)
        self.assertEqual(len(r["falhas"]), 2)
        self.assertEqual(r["concluidos"], [])


class Descarte(unittest.TestCase):
    """05/10/2026: o Claude não pode mover a pasta (lista de permissão), grava
    DESCARTAR.md e o runner move. Antes o lead contava 2 falhas e o serviço caía."""

    def setUp(self):
        self.auto = Path(tempfile.mkdtemp(prefix="gerador-teste-"))
        self.addCleanup(shutil.rmtree, self.auto)
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = "teste"
        self.m = carregar(self.auto)
        for i, slug in enumerate(["a-ja-tem-site", "b-bom"]):
            (self.auto / slug).mkdir()
            (self.auto / slug / "content.md").write_text(f"# {slug}\n- **place_id:** pid-{slug}\n")
            os.utime(self.auto / slug / "content.md", (1000 + i, 1000 + i))

        def nao_publica(pasta, log_lead):
            raise AssertionError(f"publicou {pasta.name}, que foi descartado")
        self.publicar_de_verdade = self.m.publicar_na_vercel
        self.m.publicar_na_vercel = nao_publica

    def rodar(self, claude, *args):
        self.m.rodar_claude = claude
        sys.argv = ["gerador-de-sites", "--timeout-min", "1", *args]
        codigo = self.m.main()
        return codigo, json.loads((self.auto / ".logs/status.json").read_text())["ultimo_resumo"]

    def claude(self, slug, log_lead, timeout_min):
        pasta = self.auto / slug
        if slug == "a-ja-tem-site":
            # Mesmo com index.html completo: descarte vence, nada vai para a Vercel.
            (pasta / "index.html").write_text("<html></html>")
            (pasta / "DESCARTAR.md").write_text("\n# Já tem site no ar: https://exemplo.com.br responde 200\n\nDOM com 9 mil caracteres.\n")
        else:
            (pasta / "index.html").write_text("<html></html>")
            (pasta / "publicado.json").write_text('{"site_url": "https://x"}')
        return {"codigo": 0, "estourou": False, "limite": False, "minutos": 0}

    def test_descartar_md_vira_descarte_e_nao_falha(self):
        codigo, r = self.rodar(self.claude)
        self.assertEqual(codigo, 0)
        self.assertEqual(r["descartados"], ["a-ja-tem-site → _descartados"])
        self.assertEqual(r["falhas"], [])
        self.assertEqual(r["concluidos"], ["b-bom"])
        self.assertTrue((self.auto / "_descartados/a-ja-tem-site/DESCARTAR.md").is_file())
        self.assertFalse((self.auto / "_descartados/a-ja-tem-site/falha.log").exists())
        self.assertFalse((self.auto / "a-ja-tem-site").exists())
        log = (self.auto / ".logs/execucao-a-ja-tem-site.log").read_text()
        self.assertIn("Motivo: Já tem site no ar: https://exemplo.com.br responde 200", log)

    def test_nao_sobrescreve_quem_ja_esta_em_descartados(self):
        (self.auto / "_descartados/a-ja-tem-site").mkdir(parents=True)
        (self.auto / "_descartados/a-ja-tem-site/content.md").write_text("antigo")
        codigo, r = self.rodar(self.claude)
        self.assertEqual(codigo, 0)
        self.assertEqual(r["descartados"], ["a-ja-tem-site → _descartados"])
        self.assertEqual((self.auto / "_descartados/a-ja-tem-site/content.md").read_text(), "antigo")
        novos = list((self.auto / "_descartados").glob("a-ja-tem-site--*"))
        self.assertEqual(len(novos), 1)
        self.assertTrue((novos[0] / "DESCARTAR.md").is_file())

    def test_sinal_de_execucao_anterior_e_movido_antes_e_nao_gasta_o_teto(self):
        (self.auto / "a-ja-tem-site/DESCARTAR.md").write_text("Rede com site.\n")
        self.assertEqual([p.name for p in self.m.fila()], ["b-bom"])  # nunca entra na fila
        vistos = []

        def claude(slug, log_lead, timeout_min):
            vistos.append(slug)
            return self.claude(slug, log_lead, timeout_min)
        codigo, r = self.rodar(claude, "--quantidade", "1")
        self.assertEqual(vistos, ["b-bom"])
        self.assertEqual(r["descartados"], ["a-ja-tem-site → _descartados"])
        self.assertEqual(r["concluidos"], ["b-bom"])

    def test_movimento_que_falha_fica_fora_da_fila(self):
        original = self.m.Path.rename
        def rename(p, alvo):
            if p.name == "a-ja-tem-site":
                raise PermissionError("negado")
            return original(p, alvo)
        self.m.Path.rename = rename
        self.addCleanup(setattr, self.m.Path, "rename", original)
        codigo, r = self.rodar(self.claude)
        # Uma tentativa só: com o sinal na pasta, o lead não volta para a fila no mesmo dia.
        self.assertEqual(len(r["falhas"]), 1)
        self.assertIn("DESCARTAR.md gravado", r["falhas"][0])
        self.assertEqual(r["concluidos"], ["b-bom"])
        self.assertNotIn("a-ja-tem-site", [p.name for p in self.m.fila()])

    def test_lead_de_busca_pausada_fica_fora_da_fila(self):
        (self.auto / ".funil.json").write_text(json.dumps({"nao_gerar": [
            {"place_id": "pid-a-ja-tem-site", "nome": "A", "busca": "\"vidraçaria\" em Joinville"}]}))
        self.assertEqual([p.name for p in self.m.fila()], ["b-bom"])
        self.assertEqual(self.m.fora_da_fila(self.auto / "a-ja-tem-site", self.m.nao_gerar()),
                         "busca pausada: \"vidraçaria\" em Joinville")

    def test_funil_ausente_ou_ilegivel_nao_tira_ninguem(self):
        self.assertEqual(len(self.m.fila()), 2)
        (self.auto / ".funil.json").write_text("{quebrado")
        self.assertEqual(len(self.m.fila()), 2)

    def test_deploy_do_runner_leva_so_index_e_imagem_da_previa(self):
        pasta = self.auto / "b-bom"
        (pasta / "index.html").write_text("<html></html>")
        (pasta / "og.jpg").write_bytes(b"\xff\xd8jpg")
        (pasta / "Fotos").mkdir()
        vistos = []

        class Saida:
            stdout, stderr = "Aliased: https://demo-b-bom.vercel.app\n", ""

        def run(cmd, cwd=None, **k):
            vistos.append(sorted(os.listdir(cwd)))
            return Saida()
        self.m.subprocess.run = run
        self.addCleanup(setattr, self.m.subprocess, "run", __import__("subprocess").run)
        self.m.LOGS.mkdir(exist_ok=True)
        self.m.publicar_na_vercel = self.publicar_de_verdade  # com o subprocess falso
        self.assertTrue(self.m.publicar_na_vercel(pasta, self.auto / ".logs/x.log"))
        self.assertEqual(vistos[-1], ["index.html", "og.jpg"])  # nada de content.md nem Fotos/
        recibo = json.loads((pasta / "publicado.json").read_text())
        self.assertEqual((recibo["site_url"], recibo["place_id"]), ("https://demo-b-bom.vercel.app", "pid-b-bom"))

    def test_instrucoes_pedem_a_previa_do_link(self):
        texto = self.m.instrucoes_da_execucao("b-bom", Path("/tmp/gerador-x"))
        self.assertIn(f"cp {self.auto}/b-bom/og.jpg /tmp/gerador-x/esteira-deploy/demo-b-bom/", texto)
        self.assertIn("og:image https://demo-b-bom.vercel.app/og.jpg", texto)

    def test_instrucoes_mandam_gravar_o_sinal(self):
        texto = self.m.instrucoes_da_execucao("b-bom", Path("/tmp/gerador-x"))
        self.assertIn(f"{self.auto}/b-bom/DESCARTAR.md", texto)
        self.assertIn("não mova a pasta", texto)


CLAUDE_FALSO = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
Path(os.environ["CLAUDE_FALSO_REGISTRO"]).write_text(json.dumps(
    {"argv": sys.argv[1:], "tmpdir": os.environ.get("TMPDIR"), "cwd": os.getcwd()}))
Path(os.environ["TMPDIR"], "captura.png").write_text("x")
if os.environ.get("CLAUDE_FALSO_MODO") == "limite":
    print("Claude AI usage limit reached")
    sys.exit(1)
print(json.dumps({"type": "result", "result": "Site publicado.", "session_id": "abc", "num_turns": 3,
                  "permission_denials": [
                      {"tool_name": "Bash", "tool_input": {"command": "git status"}},
                      {"tool_name": "Bash", "tool_input": {"command": "git status"}},
                      {"tool_name": "Write", "tool_input": {"file_path": "/x/CLAUDE.md", "content": "..."}}]}))
'''


class ListaDePermissao(unittest.TestCase):
    """30/09/2026: o Claude sai do --dangerously-skip-permissions para a lista."""

    def setUp(self):
        self.auto = Path(tempfile.mkdtemp(prefix="gerador-teste-"))
        self.addCleanup(shutil.rmtree, self.auto)
        self.m = carregar(self.auto)
        (self.auto / "b-bom").mkdir()

    def test_comando_sem_bypass_e_com_lista(self):
        rascunho = Path("/tmp/gerador-x")
        cmd = self.m.comando_do_claude("b-bom", rascunho)
        self.assertNotIn("--dangerously-skip-permissions", cmd)
        self.assertNotIn("bypassPermissions", " ".join(cmd))
        self.assertEqual(cmd[cmd.index("--permission-mode") + 1], "dontAsk")
        self.assertIn("--strict-mcp-config", cmd)
        self.assertEqual(cmd[cmd.index("--output-format") + 1], "json")
        p = json.loads(cmd[cmd.index("--settings") + 1])["permissions"]
        a = f"/{self.auto}"  # regra de caminho absoluto começa com //
        for regra in ("Bash(python3 *)", "Bash(google-chrome *)", "Bash(chrome *)", "Bash(curl *)", "WebFetch", "Skill",
                      f"Edit({a}/b-bom/**)", f"Write({a}/registro.md)", f"Write(//tmp/gerador-x/**)",
                      "Bash(rm -rf b-bom/*)",
                      "Bash(vercel link --cwd /tmp/gerador-x/esteira-deploy/demo-b-bom --yes --project demo-b-bom "
                      "--scope romulodesigns)",
                      "Bash(vercel deploy --cwd /tmp/gerador-x/esteira-deploy/demo-b-bom --prod --yes "
                      "--scope romulodesigns)"):
            self.assertIn(regra, p["allow"])
        # nada de escrever na pasta inteira, de rm livre nem de vercel livre
        for regra in (f"Edit({a}/**)", f"Write({a}/**)", "Bash(rm *)", "Bash(vercel *)", "Bash(git *)", "Bash"):
            self.assertNotIn(regra, p["allow"])
        for regra in ("Bash(git *)", "Bash(sudo *)", "Bash(wget *)", "Bash(npx *)", "Bash(curl * -d*)",
                      "Bash(rm *registro.md*)", f"Edit({a}/CLAUDE.md)", f"Write({a}/.claude/**)",
                      f"Read(/{Path.home()}/.ssh/**)", f"Read(/{Path.home()}/.config/**)", "mcp__*"):
            self.assertIn(regra, p["deny"])
        self.assertEqual(p["additionalDirectories"], ["/tmp/gerador-x"])
        instrucoes = cmd[cmd.index("--append-system-prompt") + 1]
        self.assertIn("vercel deploy --cwd /tmp/gerador-x/esteira-deploy/demo-b-bom", instrucoes)

    def rodar_claude_falso(self, modo=""):
        bin_falso = self.auto / ".bin"
        bin_falso.mkdir()
        (bin_falso / "claude").write_text(CLAUDE_FALSO)
        (bin_falso / "claude").chmod(0o755)
        registro = self.auto / ".registro-do-falso.json"
        antes = dict(os.environ)
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(antes)))
        os.environ.update(PATH=f"{bin_falso}:{os.environ['PATH']}", CLAUDE_FALSO_REGISTRO=str(registro),
                          CLAUDE_FALSO_MODO=modo)
        log_lead = self.auto / ".logs/execucao-b-bom.log"
        log_lead.parent.mkdir(exist_ok=True)
        r = self.m.rodar_claude("b-bom", log_lead, 1)
        return r, json.loads(registro.read_text()), log_lead.read_text()

    def test_negacoes_vao_para_o_log_do_lead(self):
        r, visto, log = self.rodar_claude_falso()
        self.assertEqual((r["codigo"], r["negadas"], r["limite"]), (0, 3, False))
        self.assertNotIn("--dangerously-skip-permissions", visto["argv"])
        self.assertEqual(Path(visto["cwd"]), self.auto)
        self.assertIn("Site publicado.", log)
        self.assertIn("Sessão do Claude: abc", log)
        self.assertIn("[NEGADO] Bash: git status (x2)", log)
        self.assertIn("[NEGADO] Write: /x/CLAUDE.md", log)
        # rascunho próprio no $TMPDIR, apagado depois do lead
        self.assertTrue(Path(visto["tmpdir"]).name.startswith("gerador-"))
        self.assertFalse(Path(visto["tmpdir"]).exists())

    # ---- modo personalizado (--refazer)

    def publicado(self, slug, status="pronto", pid="x1"):
        """Lead com demo publicado e a linha dele no retrato da planilha."""
        pasta = self.auto / slug
        pasta.mkdir(exist_ok=True)
        (pasta / "content.md").write_text(f"# {slug}\nplace_id: {pid}\n")
        (pasta / "index.html").write_text("<html>v1</html>")
        (pasta / "og.jpg").write_bytes(b"jpg-v1")
        (pasta / "publicado.json").write_text('{"site_url": "https://v1"}')
        agora = self.m.dt.datetime.now(self.m.dt.timezone.utc).isoformat()
        (self.auto / ".leads.json").write_text(json.dumps(
            {"geradoEm": agora, "leads": [{"place_id": pid, "status": status}]}))

    def refazer(self, claude, *slugs):
        self.m.rodar_claude = claude
        sys.argv = ["gerador-de-sites", "--timeout-min", "1", "--refazer", *slugs]
        codigo = self.m.main()
        return codigo, json.loads((self.auto / ".logs/status.json").read_text())["ultimo_resumo"]

    def test_refazer_guarda_o_v1_e_publica_o_novo(self):
        self.publicado("lead-r")
        visto = {}

        def claude(slug, log_lead, timeout_min, personalizado=False):
            pasta = self.auto / slug
            visto["v1"] = sorted(p.name for p in (pasta / "_v1").iterdir())
            visto["sem_site_antes"] = not (pasta / "index.html").exists() and not (pasta / "publicado.json").exists()
            (pasta / "index.html").write_text("<html>v2</html>")
            (pasta / "publicado.json").write_text('{"site_url": "https://v2"}')
            return {"codigo": 0, "estourou": False, "limite": False, "minutos": 0}

        codigo, r = self.refazer(claude, "lead-r")
        self.assertEqual((codigo, r["concluidos"], r["falhas"]), (0, ["lead-r"], []))
        self.assertEqual(visto["v1"], ["index.html", "og.jpg", "publicado.json"])
        self.assertTrue(visto["sem_site_antes"])
        self.assertEqual((self.auto / "lead-r/index.html").read_text(), "<html>v2</html>")
        self.assertEqual((self.auto / "lead-r/_v1/index.html").read_text(), "<html>v1</html>")
        marca = json.loads((self.auto / "lead-r/personalizado.json").read_text())
        self.assertEqual(marca["versao"], self.m.VERSAO_PERSONALIZADO)

    def test_refazer_que_falha_restaura_o_demo_antigo_sem_falha_log(self):
        self.publicado("lead-r")

        def claude(slug, log_lead, timeout_min, personalizado=False):
            (self.auto / slug / "index.html").write_text("<html>meio")  # truncado
            return {"codigo": 1, "estourou": False, "limite": False, "minutos": 0}

        codigo, r = self.refazer(claude, "lead-r")
        self.assertEqual(r["concluidos"], [])
        self.assertEqual(len(r["falhas"]), 1)
        pasta = self.auto / "lead-r"
        self.assertEqual((pasta / "index.html").read_text(), "<html>v1</html>")
        self.assertEqual((pasta / "publicado.json").read_text(), '{"site_url": "https://v1"}')
        self.assertFalse((pasta / "_v1").exists())
        self.assertTrue((pasta / "_tentativa-falha").is_dir())
        self.assertFalse((pasta / "falha.log").exists())  # uma tentativa, sem castigo de fila

    def test_refazer_so_mexe_em_lead_nao_enviado(self):
        for status in ("enviado", "recusado", None):
            with self.subTest(status=status):
                self.publicado("lead-e", status=status or "pronto", pid="y9")
                if status is None:
                    (self.auto / ".leads.json").write_text("{}")  # retrato sem o lead
                chamado = []
                claude = lambda *a, **k: chamado.append(a) or {"codigo": 0, "estourou": False, "limite": False, "minutos": 0}
                codigo, r = self.refazer(claude, "lead-e")
                self.assertEqual(chamado, [])
                self.assertIn("pulado", r["falhas"][0])
                self.assertEqual((self.auto / "lead-e/index.html").read_text(), "<html>v1</html>")
                self.assertFalse((self.auto / "lead-e/_v1").exists())

    def novo_site(self, slug, versao):
        pasta = self.auto / slug
        (pasta / "index.html").write_text(f"<html>{versao}</html>")
        (pasta / "publicado.json").write_text('{"site_url": "https://' + versao + '"}')
        return {"codigo": 0, "estourou": False, "limite": False, "minutos": 0}

    def test_refazer_de_novo_guarda_cada_versao_em_seu_vN(self):
        self.publicado("lead-r")
        self.refazer(lambda slug, l, t, p=False: self.novo_site(slug, "v2"), "lead-r")
        codigo, r = self.refazer(lambda slug, l, t, p=False: self.novo_site(slug, "v3"), "lead-r")
        self.assertEqual(r["concluidos"], ["lead-r"])
        pasta = self.auto / "lead-r"
        self.assertEqual((pasta / "index.html").read_text(), "<html>v3</html>")
        self.assertEqual((pasta / "_v1/index.html").read_text(), "<html>v1</html>")  # a original segue
        self.assertEqual((pasta / "_v2/index.html").read_text(), "<html>v2</html>")

    def test_sigterm_no_meio_do_refazer_devolve_o_demo_antigo(self):
        self.publicado("lead-r")

        def claude(slug, log_lead, timeout_min, personalizado=False):
            (self.auto / slug / "index.html").write_text("<html>meio")
            raise SystemExit(143)

        self.m.rodar_claude = claude
        sys.argv = ["gerador-de-sites", "--refazer", "lead-r"]
        with self.assertRaises(SystemExit):
            self.m.main()
        pasta = self.auto / "lead-r"
        self.assertEqual((pasta / "index.html").read_text(), "<html>v1</html>")
        self.assertTrue((pasta / "publicado.json").is_file())
        self.assertEqual(self.m.backups_do_lead(pasta), [])

    def test_refazer_desfaz_um_refazer_anterior_que_morreu(self):
        self.publicado("lead-r")
        pasta = self.auto / "lead-r"
        (pasta / "_v1").mkdir()
        for nome in ("index.html", "og.jpg", "publicado.json"):  # como se o runner tivesse morrido sem restaurar
            (pasta / nome).replace(pasta / "_v1" / nome)
        codigo, r = self.refazer(lambda slug, l, t, p=False: self.novo_site(slug, "v2"), "lead-r")
        self.assertEqual(r["concluidos"], ["lead-r"])
        self.assertEqual((pasta / "_v1/index.html").read_text(), "<html>v1</html>")

    def test_fila_normal_em_modo_personalizado_recebe_a_flag(self):
        (self.auto / "lead-n").mkdir()
        (self.auto / "lead-n/content.md").write_text("# lead-n\nplace_id: n1\n")
        vistos = []

        def claude(slug, log_lead, timeout_min, personalizado=False):
            vistos.append((slug, personalizado))
            return self.novo_site(slug, "novo")

        for argv, esperado in ((["--personalizado"], True), ([], None)):
            for arquivo in ("publicado.json", "index.html"):  # index.html completo faria o runner pular o Claude
                (self.auto / "lead-n" / arquivo).unlink(missing_ok=True)
            vistos.clear()
            self.m.rodar_claude = claude
            sys.argv = ["gerador-de-sites", "--timeout-min", "1", "--quantidade", "1", *argv]
            self.m.main()
            if esperado:
                self.assertEqual(vistos, [("lead-n", True)])
            else:  # sem a flag, a chamada é a de sempre (sem o 4º argumento)
                self.assertEqual(vistos, [("lead-n", False)])

    def test_refazer_recusa_slug_com_caminho(self):
        sys.argv = ["gerador-de-sites", "--refazer", "../fora"]
        with self.assertRaises(SystemExit):
            self.m.main()

    def test_modo_premium_traz_referencias_imagem_e_laco_visual(self):
        self.m.MODO_PREMIUM = True
        try:
            cmd = self.m.comando_do_claude("lead-p", Path("/tmp/gerador-x"), True)
            sistema = cmd[cmd.index("--append-system-prompt") + 1]
            for trecho in ("MODO PREMIUM", "refero-aprender", "/tmp/gerador-x/refs", "REFERENCIAS.md", "CRITICA-N.md",
                           "?qa=1", "aprendizados-refero.md", "feTurbulence", "bloco cinza liso", "MODO PERSONALIZADO",
                           "CONCEITO.md", "REGRA ZERO: nada inventado", "?qa=teste", "Rua Horácio Santana 342"):
                self.assertIn(trecho, sistema)
            self.assertNotIn("REVISÃO DIRIGIDA", sistema)
            self.m.NOTA_DA_REVISAO = "a seção X é invenção sem base"
            self.m.BACKUP_EM_CURSO["lead-p"] = "_v3"
            com_nota = self.m.comando_do_claude("lead-p", Path("/tmp/gerador-x"), True)
            sistema_nota = com_nota[com_nota.index("--append-system-prompt") + 1]
            self.assertIn("REVISÃO DIRIGIDA", sistema_nota)
            self.assertIn("a seção X é invenção sem base", sistema_nota)
            self.assertIn("lead-p/_v3/", sistema_nota)
            self.assertIn(str(self.auto / "_build/aprendizados-refero.md"), sistema)
        finally:
            self.m.MODO_PREMIUM = False
            self.m.NOTA_DA_REVISAO = None
            self.m.BACKUP_EM_CURSO.clear()
        comum = self.m.comando_do_claude("lead-p", Path("/tmp/gerador-x"), True)
        self.assertNotIn("MODO PREMIUM", comum[comum.index("--append-system-prompt") + 1])

    def test_premium_grava_versao_3_e_liga_o_modo_pelo_argumento(self):
        self.publicado("lead-p")
        vistos = []

        def claude(slug, log_lead, timeout_min, personalizado=False):
            vistos.append((personalizado, self.m.MODO_PREMIUM))
            return self.novo_site(slug, "v2")

        self.m.rodar_claude = claude
        sys.argv = ["gerador-de-sites", "--timeout-min", "1", "--refazer", "lead-p", "--premium"]
        self.m.main()
        self.assertEqual(vistos, [(True, True)])
        self.assertEqual(json.loads((self.auto / "lead-p/personalizado.json").read_text())["versao"], 3)
        self.m.MODO_PREMIUM = False

    def test_comando_personalizado_traz_o_roteiro_e_o_prompt_proprio(self):
        self.m.BACKUP_EM_CURSO["lead-r"] = "_v1"
        cmd = self.m.comando_do_claude("lead-r", Path("/tmp/x"), True)
        self.assertIn("MODO PERSONALIZADO", cmd[2])
        sistema = cmd[cmd.index("--append-system-prompt") + 1]
        for trecho in ("DOSSIE.md", "REVISAO.md", "_v1/", "REFAZER", "excelência", "Provimento 205/2021",
                       "requestAnimationFrame", "MOVIMENTO DE NÍVEL ESPECIALISTA", "reduced-motion"):
            self.assertIn(trecho, sistema)
        self.m.BACKUP_EM_CURSO.clear()
        novo = self.m.comando_do_claude("lead-r", Path("/tmp/x"), True)
        sistema_novo = novo[novo.index("--append-system-prompt") + 1]
        self.assertIn("lead novo", sistema_novo)
        self.assertNotIn("REFAZER", sistema_novo)
        # as instruções comuns (lista de permissão, deploy) continuam valendo
        self.assertIn("Passo 5 (publicar)", sistema)
        comum = self.m.comando_do_claude("lead-r", Path("/tmp/x"))
        self.assertNotIn("MODO PERSONALIZADO", comum[2])
        self.assertNotIn("MODO PERSONALIZADO", comum[comum.index("--append-system-prompt") + 1])

    def test_saida_que_nao_e_json_vai_crua_e_limite_e_detectado(self):
        r, _, log = self.rodar_claude_falso("limite")
        self.assertEqual((r["codigo"], r["negadas"], r["limite"]), (1, 0, True))
        self.assertIn("usage limit reached", log)


if __name__ == "__main__":
    unittest.main(verbosity=2)
