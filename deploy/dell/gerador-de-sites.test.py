#!/usr/bin/env python3
"""Testes do gerador-de-sites sem Claude, Vercel nem rede: numa pasta
temporária, com `rodar_claude` e `validar` trocados por falsos.

  python3 deploy/dell/gerador-de-sites.test.py
"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_gerador", AQUI / "dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — o dell-status não carrega fora do Dell (fcntl)
    ds = None


def carregar(auto: Path, avisar_real: bool = False):
    os.environ["AUTO_DIR"] = str(auto)
    os.environ["SITE_FUNIL"] = str(auto / ".funil.json")  # nunca o retrato real do n8n
    os.environ["SITE_LEADS"] = str(auto / ".leads.json")  # nem a planilha real
    os.environ["RAIO_X_BIN"] = str(auto / ".sem-raio-x")  # nem o raio-x instalado (faria deploy)
    os.environ["CHROME_HEADLESS_CACHE"] = str(auto / ".sem-chrome")  # nem o cache real do Chrome da Mel
    # Nem as cópias instaladas da folha e do gate: cada teste diz se elas existem.
    os.environ["FOLHA_DE_CONTATO_BIN"] = str(auto / ".sem-folha")
    os.environ["QA_NUMERICO_BIN"] = str(auto / ".sem-qa")
    os.environ["DRIBBBLE_BIN"] = str(auto / ".sem-dribbble")
    os.environ["SEO_DO_SITE_BIN"] = str(auto / ".sem-seo")  # nem o seo-do-site instalado (pediria o Places)
    spec = importlib.util.spec_from_file_location("gerador", AQUI / "gerador-de-sites.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.shutil.which = lambda _: "/bin/true"
    if avisar_real:
        # Só a classe AvisoPelaLib: o avisar() de verdade, mas numa fila temporária (nunca a real).
        m.FILA_AVISOS = auto / ".fila-de-avisos"
    else:
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

    def test_raio_x_sai_depois_do_demo_validado_e_falha_nao_derruba_o_lead(self):
        raio_x = self.auto / ".sem-raio-x"
        raio_x.write_text("import os, sys\n"
                          "open(os.path.join(os.environ['AUTO_DIR'], 'chamado-' + sys.argv[1]), 'w').close()\n"
                          "sys.exit(1 if sys.argv[1] == 'd-bom' else 0)\n")
        codigo, resumo = self.rodar(self.claude_padrao)
        self.assertEqual(sorted(resumo["concluidos"]), ["b-bom", "d-bom"])  # o raio-x de d-bom falhou e o lead não
        self.assertTrue((self.auto / "chamado-b-bom").exists())
        self.assertTrue((self.auto / "chamado-d-bom").exists())
        self.assertFalse((self.auto / "chamado-c-quebra").exists())
        self.assertIn("Raio-X de d-bom não saiu", (self.auto / ".logs/execucao-d-bom.log").read_text())

    def test_raio_x_que_explode_nao_vira_falha_do_lead(self):
        self.m.subprocess.run, original = (lambda *a, **k: 1 / 0), self.m.subprocess.run
        self.addCleanup(setattr, self.m.subprocess, "run", original)
        (self.auto / ".sem-raio-x").write_text("")
        codigo, resumo = self.rodar(self.claude_padrao)
        self.assertEqual(sorted(resumo["concluidos"]), ["b-bom", "d-bom"])
        self.assertIn("ZeroDivisionError", (self.auto / ".logs/execucao-b-bom.log").read_text())

    def test_sem_raio_x_instalado_o_lead_conclui(self):
        codigo, resumo = self.rodar(self.claude_padrao)
        self.assertEqual(sorted(resumo["concluidos"]), ["b-bom", "d-bom"])


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
        (pasta / "index.html").write_text("<html><body>Prévia</body></html>")
        (pasta / "og.jpg").write_bytes(b"\xff\xd8jpg")
        (pasta / "Fotos").mkdir()
        vistos = []

        class Saida:
            # Formato da Vercel CLI 59: sem os dois-pontos depois de "Aliased".
            stdout, stderr = "▲ Aliased         https://demo-b-bom.vercel.app\n\n✓ Ready in 7s\n", ""

        def run(cmd, cwd=None, **k):
            vistos.append(sorted(os.listdir(cwd)))
            return Saida()
        # O módulo subprocess é o mesmo objeto aqui e no gerador: guardar o original ANTES de trocar
        # (ler depois devolvia o falso e vazava para os testes seguintes).
        original = self.m.subprocess.run
        self.m.subprocess.run = run
        self.addCleanup(setattr, self.m.subprocess, "run", original)
        self.m.LOGS.mkdir(exist_ok=True)
        self.m.publicar_na_vercel = self.publicar_de_verdade  # com o subprocess falso
        self.assertTrue(self.m.publicar_na_vercel(pasta, self.auto / ".logs/x.log"))
        self.assertEqual(vistos[-1], ["index.html", "og.jpg"])  # nada de content.md nem Fotos/
        recibo = json.loads((pasta / "publicado.json").read_text())
        self.assertEqual((recibo["site_url"], recibo["place_id"]), ("https://demo-b-bom.vercel.app", "pid-b-bom"))
        self.assertFalse(recibo["qualidade"]["profissional"])
        self.assertIn('data-prumo-homologacao="1"', (pasta / "index.html").read_text())

    def test_profissional_pendente_nao_chama_vercel(self):
        from unittest.mock import patch
        from qualidade_prumo import motor, arquivos_site
        raiz, q, motor_publicacao = motor()
        pasta = self.auto / "b-bom"
        (pasta / "index.html").write_text("<html><body>Entrega</body></html>")
        ref = motor_publicacao.referencia("pid-b-bom")
        cfg = motor_publicacao.preparar(q.ler(raiz / "06-qualidade/catalogo.json"), "site", ref, arquivos_site(pasta))
        privado = self.auto / "_avaliacoes-test"
        alvo = privado / ref.replace(":", "-") / "site.json"
        alvo.parent.mkdir(parents=True)
        alvo.write_text(json.dumps(cfg))
        self.m.LOGS.mkdir(exist_ok=True)
        with patch.dict(os.environ, {"PRUMO_QUALIDADE_AVALIACOES_DIR": str(privado)}), patch.object(self.m.subprocess, "run") as publicar:
            self.assertIsNone(self.m.deploy_do_palco(pasta, self.auto / ".logs/x.log"))
            publicar.assert_not_called()

    def test_instrucoes_pedem_a_previa_do_link(self):
        texto = self.m.instrucoes_da_execucao("b-bom", Path("/tmp/gerador-x"))
        self.assertIn(f"cp {self.auto}/b-bom/og.jpg /tmp/gerador-x/esteira-deploy/demo-b-bom/", texto)
        self.assertIn("og:image https://demo-b-bom.vercel.app/og.jpg", texto)

    def test_instrucoes_mandam_gravar_o_sinal(self):
        texto = self.m.instrucoes_da_execucao("b-bom", Path("/tmp/gerador-x"))
        self.assertIn(f"{self.auto}/b-bom/DESCARTAR.md", texto)
        self.assertIn("não mova a pasta", texto)

    def test_clareza_e_referencias_em_todos_os_modos(self):
        """13/10/2026: as cinco perguntas valem para a fila comum e o personalizado; a metáfora e os Atos
        (08/10) e o Refero saíram dos prompts. 14/10/2026: a referência é um shot do Dribbble por lead,
        no lugar da biblioteca fixa (REFERENCIAS.md), e o desktop entra na folha ao lado dele."""
        comum = self.m.comando_do_claude("b-bom", Path("/tmp/gerador-x"))
        for trecho in ("cinco perguntas do passo 1.5.1", "título de uma frase", "Cara de IA", "Dribbble",
                       "UM shot", "1440 px"):
            self.assertIn(trecho, comum[2])
        self.assertNotIn("refero", comum[2].lower())
        self.assertNotIn("REFERENCIAS.md", comum[2])
        sistema = comum[comum.index("--append-system-prompt") + 1]
        for trecho in (f"{self.auto}/b-bom/CONCEITO.md", "fim do Ato I", "--force-prefers-reduced-motion",
                       "--blink-settings=scriptEnabled=false", "#qa-resultado", "Dribbble",
                       f"{self.auto}/_exemplos/", "Desktop de verdade"):
            self.assertIn(trecho, sistema)
        self.assertNotIn("REFERENCIAS.md", sistema)
        self.assertNotIn("MODO PERSONALIZADO", sistema)
        self.assertNotIn("Refero", sistema)
        pers = self.m.comando_do_claude("b-bom", Path("/tmp/gerador-x"), True)
        self.assertIn("cinco perguntas do passo 1.5.1", pers[2])
        self.assertIn("Dribbble", pers[2])
        self.assertNotIn("refero", pers[2].lower())
        sistema_pers = pers[pers.index("--append-system-prompt") + 1]
        for trecho in ("O QUE SÓ ESTE NEGÓCIO TEM", "cinco perguntas do passo 1.5.1", "MOVIMENTO SÓBRIO",
                       "UMA frase com o ofício", "\"Cara de IA\"", "a metáfora, se houver, fica só no visual"):
            self.assertIn(trecho, sistema_pers)
        for velho in ("INSTÂNCIA da metáfora", "MOVIMENTO DE NÍVEL ESPECIALISTA", "PELO MENOS DUAS INTERAÇÕES",
                      "window.onerror` temporário", "O hero abre com a ideia do conceito"):
            self.assertNotIn(velho, sistema_pers)


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
                      "Bash(rm -rf b-bom/*)"):
            self.assertIn(regra, p["allow"])
        # nada de escrever na pasta inteira, de rm livre nem de vercel livre
        for regra in (f"Edit({a}/**)", f"Write({a}/**)", "Bash(rm *)", "Bash(vercel *)", "Bash(git *)", "Bash"):
            self.assertNotIn(regra, p["allow"])
        self.assertFalse(any("vercel deploy" in x or "vercel link" in x for x in p["allow"]))
        for regra in ("Bash(git *)", "Bash(sudo *)", "Bash(wget *)", "Bash(npx *)", "Bash(curl * -d*)",
                      "Bash(rm *registro.md*)", f"Edit({a}/CLAUDE.md)", f"Write({a}/.claude/**)",
                      f"Read(/{Path.home()}/.ssh/**)", f"Read(/{Path.home()}/.config/**)", "mcp__*"):
            self.assertIn(regra, p["deny"])
        self.assertEqual(p["additionalDirectories"], ["/tmp/gerador-x"])
        instrucoes = cmd[cmd.index("--append-system-prompt") + 1]
        self.assertIn("Não execute vercel link/deploy", instrucoes)
        self.assertNotIn("vercel deploy --cwd", instrucoes)

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

    def test_refazer_leva_o_conceito_anterior_para_o_v1(self):
        """08/10/2026: deixado na pasta, o CONCEITO.md (metáfora e Atos) ancoraria o refazer na ideia velha."""
        self.publicado("lead-r")
        (self.auto / "lead-r/CONCEITO.md").write_text("metáfora v1")
        visto = {}

        def claude(slug, log_lead, timeout_min, personalizado=False):
            visto["na_pasta"] = (self.auto / slug / "CONCEITO.md").exists()
            return self.novo_site(slug, "v2")

        self.refazer(claude, "lead-r")
        self.assertFalse(visto["na_pasta"])
        self.assertEqual((self.auto / "lead-r/_v1/CONCEITO.md").read_text(), "metáfora v1")

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

    def test_o_modo_premium_foi_apagado(self):
        """19/10/2026: --premium e --nota saíram (desligados desde 13/10); o personalizado grava a versão atual."""
        self.assertFalse(hasattr(self.m, "MODO_PREMIUM"))
        self.assertFalse(hasattr(self.m, "instrucoes_premium"))
        sistema = self.m.comando_do_claude("lead-p", Path("/tmp/gerador-x"), True)
        self.assertNotIn("MODO PREMIUM", sistema[sistema.index("--append-system-prompt") + 1])
        self.publicado("lead-p")
        self.m.rodar_claude = lambda *a, **k: self.fail("não podia rodar o Claude")
        for opcao in (["--premium"], ["--nota", "x"]):
            sys.argv = ["gerador-de-sites", "--refazer", "lead-p", *opcao]
            with contextlib.redirect_stderr(io.StringIO()) as erro, self.assertRaises(SystemExit) as saida:
                self.m.main()
            self.assertEqual(saida.exception.code, 2)
            self.assertIn("unrecognized arguments", erro.getvalue())
        self.assertFalse((self.auto / "lead-p/_v1").exists())

    def test_refazer_grava_a_versao_atual_do_personalizado(self):
        self.publicado("lead-p")
        vistos = []

        def claude(slug, log_lead, timeout_min, personalizado=False):
            vistos.append(personalizado)
            return self.novo_site(slug, "v2")

        self.m.rodar_claude = claude
        sys.argv = ["gerador-de-sites", "--timeout-min", "1", "--refazer", "lead-p"]
        self.m.main()
        self.assertEqual(vistos, [True])
        self.assertEqual(json.loads((self.auto / "lead-p/personalizado.json").read_text())["versao"], self.m.VERSAO_PERSONALIZADO)

    def test_comando_personalizado_traz_o_roteiro_e_o_prompt_proprio(self):
        self.m.BACKUP_EM_CURSO["lead-r"] = "_v1"
        cmd = self.m.comando_do_claude("lead-r", Path("/tmp/x"), True)
        self.assertIn("MODO PERSONALIZADO", cmd[2])
        sistema = cmd[cmd.index("--append-system-prompt") + 1]
        for trecho in ("DOSSIE.md", "REVISAO.md", "_v1/", "REFAZER", "excelência", "Provimento 205/2021",
                       "MOVIMENTO SÓBRIO", "reduced-motion", "(6) \"Cara de IA\""):
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

    def test_cache_do_chrome_so_perde_perfil_parado_e_so_scoped_dir(self):
        """11/10/2026: 34 GB de scoped_dir* em ~/.cache; a limpeza não toca em Chrome vivo nem em outro nome."""
        cache = self.auto / ".sem-chrome"
        for nome in ("scoped_dirVelho", "scoped_dirOutro", "scoped_dirNovo", "Default"):
            (cache / nome / "Default").mkdir(parents=True)
            (cache / nome / "Default" / "Cookies").write_text("x")
        (cache / "scoped_dirSolto").write_text("arquivo, não pasta")
        agora = 1_000_000.0
        for nome, idade in (("scoped_dirVelho", 3600), ("scoped_dirOutro", 601), ("scoped_dirNovo", 30), ("Default", 99999)):
            os.utime(cache / nome, (agora - idade, agora - idade))
        self.assertEqual(self.m.limpar_cache_chrome(cache, agora), 2)
        self.assertEqual(sorted(p.name for p in cache.iterdir()), ["Default", "scoped_dirNovo", "scoped_dirSolto"])

    def test_cache_do_chrome_ausente_nao_levanta(self):
        self.assertEqual(self.m.limpar_cache_chrome(self.auto / "nao-existe"), 0)

    def test_rodar_claude_limpa_o_cache_do_chrome_ao_fim(self):
        cache = self.auto / ".sem-chrome"
        (cache / "scoped_dirAntigo").mkdir(parents=True)
        os.utime(cache / "scoped_dirAntigo", (1.0, 1.0))
        r, _, _ = self.rodar_claude_falso("limite")
        self.assertFalse((cache / "scoped_dirAntigo").exists())

    def test_saida_que_nao_e_json_vai_crua_e_limite_e_detectado(self):
        r, _, log = self.rodar_claude_falso("limite")
        self.assertEqual((r["codigo"], r["negadas"], r["limite"]), (1, 0, True))
        self.assertIn("usage limit reached", log)


def modulo(nome: str):
    spec = importlib.util.spec_from_file_location(nome.replace("-", "_"), AQUI / f"{nome}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


try:
    import PIL  # noqa: F401 — a Mel tem (é o do og.jpg); o PC de controle pode não ter
    TEM_PIL = True
except ImportError:
    TEM_PIL = False


def png_listrado(caminho: Path, largura: int = 390, altura: int = 844, liso: bool = False) -> None:
    """PNG sem Pillow: listras (conteúdo) ou cor única (tela vazia)."""
    import struct
    import zlib
    linhas = b""
    for y in range(altura):
        cor = b"\xf4\xef\xe6" if liso or (y // 40) % 2 else b"\x20\x20\x20"
        linhas += b"\x00" + cor * largura
    def bloco(tipo, dados):
        return struct.pack(">I", len(dados)) + tipo + dados + struct.pack(">I", zlib.crc32(tipo + dados) & 0xFFFFFFFF)
    caminho.write_bytes(b"\x89PNG\r\n\x1a\n" + bloco(b"IHDR", struct.pack(">IIBBBBB", largura, altura, 8, 2, 0, 0, 0))
                        + bloco(b"IDAT", zlib.compress(linhas)) + bloco(b"IEND", b""))


class QaComFolhaNasInstrucoes(unittest.TestCase):
    """11/10/2026: capturas lidas numa folha só e gate numérico antes do deploy, só com as cópias instaladas."""

    def setUp(self):
        self.auto = Path(tempfile.mkdtemp(prefix="gerador-teste-"))
        self.addCleanup(shutil.rmtree, self.auto)
        self.m = carregar(self.auto)
        self.rascunho = Path("/tmp/gerador-x")

    def instalar(self):
        for nome in (".sem-folha", ".sem-qa", ".sem-dribbble"):
            (self.auto / nome).write_text("# cópia instalada\n")

    def sistema(self, personalizado=False):
        cmd = self.m.comando_do_claude("b-bom", self.rascunho, personalizado)
        return cmd[cmd.index("--append-system-prompt") + 1]

    def test_sem_as_copias_o_qa_e_o_de_antes(self):
        """O gerador novo instalado antes dos dois scripts não pode mandar o Claude chamar o que não existe."""
        for texto in (self.sistema(), self.sistema(True)):
            self.assertNotIn("folha-de-contato", texto)
            self.assertNotIn("qa-numerico", texto)
            self.assertIn("grave no rascunho um script python3", texto)
            self.assertIn("--blink-settings=scriptEnabled=false", texto)

    def test_dribbble_so_quando_instalado(self):
        """14/10/2026: com o coletor instalado, os comandos de busca e de shot; sem ele, o exemplo aprovado
        e nenhuma chamada ao que não existe. O desktop entra nos dois casos."""
        sem = self.sistema()
        self.assertNotIn(".sem-dribbble", sem)
        self.assertIn(f"{self.auto}/_exemplos/", sem)
        self.assertIn("Desktop de verdade", sem)
        self.instalar()
        com = self.sistema()
        dr = self.auto / ".sem-dribbble"
        r = self.rascunho
        for trecho in (f"python3 {dr} buscar --saida {r}/dribbble/busca --consulta",
                       f"python3 {dr} shot <link> --saida {r}/dribbble/shot",
                       f"--refs {r}/dribbble/shot/quadro-01.jpg", "Desktop de verdade", "UM shot"):
            self.assertIn(trecho, com)

    def test_com_as_copias_uma_imagem_por_rodada_e_gate(self):
        self.instalar()
        folha, qa = self.auto / ".sem-folha", self.auto / ".sem-qa"
        comum = self.sistema()
        for trecho in (f"python3 {folha} --saida /tmp/gerador-x/qa/folha-N.jpg --pasta /tmp/gerador-x/qa",
                       f"python3 {qa} {self.auto}/b-bom/index.html --capturas /tmp/gerador-x/qa",
                       f"python3 {qa} --celular \"file://{self.auto}/b-bom/index.html#<id da seção>\"",
                       "o WhatsApp contra o content.md",
                       "UMA imagem por rodada", "primeira `<section>` dentro de `<main>`", "fim do Ato I",
                       # 13/10/2026: o reduced-motion é o `--rm` do qa-numerico, não mais a flag do Chrome.
                       "`--rm` para reduced-motion", "--blink-settings=scriptEnabled=false", "não tente",
                       "Código 1 = falhou", "Se o próprio gate quebrar", f"{self.auto}/b-bom/CONCEITO.md"):
            self.assertIn(trecho, comum)
        self.assertNotIn("grave no rascunho um script python3", comum)
        self.assertIn("folha de contato só", self.sistema(True))

    def test_lista_de_permissao_deixa_chamar_os_dois_por_caminho(self):
        """O Claude chama `python3 <caminho instalado>` (como o refero-aprender): uma regra allow casa e nenhuma deny."""
        import fnmatch
        self.instalar()
        p = self.m.permissoes_do_claude("b-bom", self.rascunho)["permissions"]
        regras = lambda lista: [r[5:-1] for r in lista if r.startswith("Bash(")]
        for cmd in (f"python3 {self.auto}/.sem-qa {self.auto}/b-bom/index.html --capturas /tmp/gerador-x/qa",
                    f"python3 {self.auto}/.sem-folha --saida /tmp/gerador-x/qa/folha-1.jpg --pasta /tmp/gerador-x/qa"):
            self.assertTrue(any(fnmatch.fnmatchcase(cmd, r) for r in regras(p["allow"])), cmd)
            self.assertFalse(any(fnmatch.fnmatchcase(cmd, r) for r in regras(p["deny"])), cmd)


class FolhaDeContato(unittest.TestCase):
    def setUp(self):
        self.f = modulo("folha-de-contato")
        self.pasta = Path(tempfile.mkdtemp(prefix="folha-teste-"))
        self.addCleanup(shutil.rmtree, self.pasta)

    def test_rotulo_sai_do_nome(self):
        d = self.f.descrever
        self.assertEqual(d("m-ato1-rm.png", 390, 844), ("celular", "Ato I · celular 390×844 · reduced-motion"))
        self.assertEqual(d("d-ato3-p0.3.png", 1440, 900), ("desktop", "Ato III · desktop 1440×900 · p=0.3"))
        self.assertEqual(d("m-ato1-sem-js.png", 390, 844), ("celular", "Ato I · celular 390×844 · sem JS"))
        self.assertEqual(d("captura.png", 390, 844), ("celular", "celular 390×844 · captura"))  # viewport pelo tamanho
        self.assertEqual(d("01-linear.jpg", 800, 500, ref=True), ("ref", "REF · 01-linear"))

    def test_folha_cabe_no_limite_e_celular_tem_o_dobro_da_escala(self):
        itens = [("desktop", 1440, 900)] * 6 + [("celular", 390, 844)] * 8 + [("ref", 800, 520)] * 4
        s, largura, altura, caixas = self.f.planejar(itens)
        self.assertLessEqual(max(largura, altura), self.f.MAX_LADO)
        self.assertLessEqual(largura * altura, self.f.MAX_PIXELS)
        self.assertGreater(s, 0.15)
        cel, desk = caixas[6], caixas[0]
        self.assertAlmostEqual(cel[2] / 390, 2 * desk[2] / 1440, delta=0.02)
        for i, (x, y, w, h) in enumerate(caixas):  # nada sai da folha e nada se sobrepõe
            self.assertTrue(0 <= x and x + w <= largura and y + h <= altura)
            for x2, y2, w2, h2 in caixas[i + 1:]:
                self.assertTrue(x + w <= x2 or x2 + w2 <= x or y + h <= y2 or y2 + h2 <= y)

    def test_poucas_capturas_saem_em_tamanho_real(self):
        s, _, _, caixas = self.f.planejar([("celular", 390, 844), ("celular", 390, 844)])
        self.assertEqual(caixas[0][2:], (390, 844))
        self.assertEqual(self.f.planejar([("desktop", 1440, 900)])[0], 1.0)

    def test_pasta_ignora_folhas_e_temporarios_em_ordem_natural(self):
        for nome in ("m-ato10.png", "m-ato2.png", "folha-1.jpg", ".nova-m-ato1-rm.png", "_sem-js.html", "d-ato1.png"):
            (self.pasta / nome).write_bytes(b"x")
        self.assertEqual([p.name for p in self.f.capturas_da_pasta(self.pasta)], ["d-ato1.png", "m-ato2.png", "m-ato10.png"])

    def test_sem_captura_e_codigo_2(self):
        self.assertEqual(self.f.main(["--saida", str(self.pasta / "folha.jpg"), "--pasta", str(self.pasta)]), 2)
        self.assertEqual(self.f.main(["--saida", str(self.pasta / "folha.jpg"), "--pasta", str(self.pasta / "nao")]), 2)

    @unittest.skipUnless(TEM_PIL, "sem Pillow")
    def test_monta_a_folha(self):
        from PIL import Image
        for nome in ("m-ato1.png", "m-ato1-rm.png", "m-ato3-p0.3.png"):
            png_listrado(self.pasta / nome)
        png_listrado(self.pasta / "d-ato1.png", 1440, 900)
        ref = self.pasta / "refs"
        ref.mkdir()
        png_listrado(ref / "01-site.png", 800, 500)
        saida = self.pasta / "folha-1.jpg"
        self.assertEqual(self.f.main(["--saida", str(saida), "--pasta", str(self.pasta), "--refs", str(ref / "01-site.png")]), 0)
        with Image.open(saida) as im:
            self.assertLessEqual(max(im.size), self.f.MAX_LADO)
        self.assertNotIn(saida, self.f.capturas_da_pasta(self.pasta))  # a próxima rodada não junta a folha


HTML_BOM = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
:root{--papel:#f4efe6;--tinta:#1d1b18;--wa:#0b6b3a}
body{background:var(--papel);color:var(--tinta)}
.cta{background:var(--wa);color:#fff}
.veu{background:rgba(255,255,255,.08);color:#f0f0f0}
@font-face{font-family:"Fraunces";src:url(data:font/woff2;base64,AAAA) format("woff2")}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style></head><body><main>
<section id="ato-1"><h1>Desentupidora</h1><img src="data:image/webp;base64,QUJD" alt="Fachada azul" width="800" height="600"></section>
<section id="ato-2"><img src="data:image/webp;base64,QUJD" alt="Caminhão" width="400" height="300"></section>
</main><script>
const rm = matchMedia('(prefers-reduced-motion: reduce)'); requestAnimationFrame(() => {});
</script></body></html>"""


class QaNumerico(unittest.TestCase):
    def setUp(self):
        self.q = modulo("qa-numerico")
        self.pasta = Path(tempfile.mkdtemp(prefix="qa-teste-"))
        self.addCleanup(shutil.rmtree, self.pasta)

    def estados(self, html, **k):
        return {i.nome: (i.estado, i.texto) for i in self.q.avaliar(html, **k)}

    def test_pagina_dentro_das_regras_passa(self):
        r = self.estados(HTML_BOM)
        self.assertEqual([n for n, (e, _) in r.items() if e != "OK"], [], r)
        # body e .cta medidos; o véu translúcido (fundo desconhecido) fica sem medir
        self.assertIn("2 par(es) conferido(s), 1 sem medir", r["Contraste AA (cor/fundo do CSS)"][1])

    def test_ato1_e_a_primeira_section_do_main_com_aninhamento(self):
        html = "<html><body><section>fora</section><main><section>a<section>b</section>c</section><section>d</section></main></body></html>"
        inicio, fim = self.q.fim_do_ato1(html)
        self.assertEqual(html[inicio:fim], "<section>a<section>b</section>c</section>")
        com_comentario = "<html><body><main><!-- <section> --><script>'<section>'</script><section>x</section></main></body></html>"
        i, f = self.q.fim_do_ato1(com_comentario)
        self.assertEqual(com_comentario[i:f], "<section>x</section>")
        self.assertIsNone(self.q.fim_do_ato1("<html><body><main><div>sem section</div></main></body></html>"))

    def test_orcamento_de_bytes_diz_o_que_cortar(self):
        foto = "A" * 230_000
        html = HTML_BOM.replace('base64,QUJD" alt="Fachada', f'base64,{foto}" alt="Fachada')
        r = self.estados(html)
        estado, texto = r["Bytes até o fim do Ato I"]
        self.assertEqual(estado, "FALHA")
        self.assertIn("Corte antes do fim do Ato I: image/webp em base64 de 230.0 KB", texto)
        self.assertEqual(r["Fotos embutidas"][0], "FALHA")  # hero > 80 KB
        self.assertIn("foto do hero (Fachada azul)", r["Fotos embutidas"][1])
        grande = HTML_BOM.replace("</main>", f'<section><img src="data:image/webp;base64,{"B" * 470_000}" alt="x" width="1" height="1"></section></main>')
        self.assertEqual(self.estados(grande)["Arquivo inteiro"][0], "FALHA")
        self.assertEqual(self.estados(grande)["Bytes até o fim do Ato I"][0], "OK")

    def test_css_e_js_contam_sem_base64(self):
        fonte_grande = HTML_BOM.replace("base64,AAAA", "base64," + "A" * 60_000)
        r = self.estados(fonte_grande)
        self.assertEqual(r["CSS sem base64"][0], "OK")  # a fonte embutida não conta como CSS
        self.assertEqual(r["Fontes"][0], "OK")
        css = HTML_BOM.replace("</style>", ".x{color:red}" * 3000 + "</style>")
        self.assertEqual(self.estados(css)["CSS sem base64"][0], "FALHA")
        js = HTML_BOM.replace("</script>", "// comentário longo\n" * 1500 + "</script>")
        self.assertEqual(self.estados(js)["JS sem base64"][0], "FALHA")
        ld = HTML_BOM.replace("</body>", '<script type="application/ld+json">' + "{}" * 20_000 + "</script></body>")
        self.assertEqual(self.estados(ld)["JS sem base64"][0], "OK")  # dado estruturado não é JS

    def test_fontes_familias_e_peso(self):
        tres = HTML_BOM.replace("</style>", '@font-face{font-family:"A";src:url(data:font/woff2;base64,AA)}'
                                '@font-face{font-family:B;src:url(data:font/woff2;base64,AA)}</style>')
        self.assertIn("3 famílias", self.estados(tres)["Fontes"][1])
        pesada = HTML_BOM.replace("base64,AAAA", "base64," + "A" * 90_000)
        self.assertIn("pyftsubset", self.estados(pesada)["Fontes"][1])
        externa = HTML_BOM.replace("</style>", '@font-face{font-family:"Fraunces";src:url(https://x/f.woff2)}</style>')
        self.assertIn("fora do arquivo", self.estados(externa)["Fontes"][1])

    def test_imagens_sem_dimensao_ou_sem_alt(self):
        html = HTML_BOM.replace('alt="Caminhão" width="400" height="300"', 'alt="foto com width e height"')
        r = self.estados(html)
        self.assertEqual(r["Imagens com width e height"][0], "FALHA")  # texto do alt não vale como atributo
        self.assertEqual(r["Alt das imagens"][0], "OK")
        sem_alt = HTML_BOM.replace('alt="Caminhão" ', "")
        self.assertEqual(self.estados(sem_alt)["Alt das imagens"][0], "FALHA")
        vazio = HTML_BOM.replace('alt="Caminhão"', 'alt=""')
        self.assertEqual(self.estados(vazio)["Alt das imagens"][0], "AVISO")
        seis = HTML_BOM.replace("</main>", "".join(f'<img src="data:image/jpeg;base64,QQ" alt="f{i}" width="1" height="1">'
                                                   for i in range(6)) + "</main>")
        self.assertIn("fotos de conteúdo (máximo 5)", self.estados(seis)["Fotos embutidas"][1])

    def test_reduced_motion_no_css_e_no_js_que_anima(self):
        sem_css = HTML_BOM.replace("@media (prefers-reduced-motion: reduce){*{animation:none!important}}", "")
        self.assertIn("nenhum @media", self.estados(sem_css)["prefers-reduced-motion"][1])
        sem_js = HTML_BOM.replace("matchMedia('(prefers-reduced-motion: reduce)');", "1;")
        self.assertIn("o JS anima", self.estados(sem_js)["prefers-reduced-motion"][1])

    def test_contraste_aa(self):
        q = self.q
        self.assertAlmostEqual(q.contraste(q.cor("#fff"), q.cor("#000")), 21.0, places=1)
        self.assertAlmostEqual(q.contraste(q.cor("#ffffff"), q.cor("#25D366")), 1.98, places=2)
        self.assertEqual(q.cor("rgb(255 0 0 / 50%)"), (255, 0, 0, 0.5))
        self.assertEqual(q.cor("hsl(0, 0%, 100%)"), (255, 255, 255, 1.0))
        self.assertIsNone(q.cor("oklch(70% 0.1 200)"))
        verde = HTML_BOM.replace("--wa:#0b6b3a", "--wa:#25D366")
        estado, texto = self.estados(verde)["Contraste AA (cor/fundo do CSS)"]
        self.assertEqual(estado, "FALHA")
        self.assertIn(".cta #ffffff sobre #25d366 = 1.98:1", texto)
        grande = verde.replace(".cta{background:var(--wa);color:#fff}", ".cta{background:var(--wa);color:#fff;font-size:28px}")
        self.assertIn("mínimo 3:1", self.estados(grande)["Contraste AA (cor/fundo do CSS)"][1])
        # véu translúcido (fundo desconhecido) e tema escuro ficam de fora
        escuro = HTML_BOM.replace("</style>", "@media (prefers-color-scheme: dark){.x{color:#111;background:#000}}</style>")
        self.assertEqual(self.estados(escuro)["Contraste AA (cor/fundo do CSS)"][0], "OK")
        local = HTML_BOM.replace("</style>", ".tinta{--fg:#777;color:var(--fg);background:#888}</style>")
        self.assertEqual(self.estados(local)["Contraste AA (cor/fundo do CSS)"][0], "FALHA")
        aninhado = HTML_BOM.replace("</style>", ".card{padding:1rem; &:hover{color:#eee;background:#fff}}</style>")
        self.assertIn(".card:hover", self.estados(aninhado)["Contraste AA (cor/fundo do CSS)"][1])

    def test_visibilidade_por_histograma(self):
        liso = [0] * 256
        liso[240] = 1000
        self.assertEqual(self.q.visibilidade(liso), (0.0, 0.0))
        com_conteudo = [0] * 256
        com_conteudo[240], com_conteudo[30] = 700, 300
        desvio, parcela = self.q.visibilidade(com_conteudo)
        self.assertGreater(desvio, self.q.DESVIO_MIN)
        self.assertAlmostEqual(parcela, 0.3)
        r = self.estados(HTML_BOM, capturas={}, histogramas={"sem_js": liso, "reduzido": com_conteudo})
        self.assertEqual(r["Ato I visível sem JS"][0], "FALHA")
        self.assertIn("html.js", r["Ato I visível sem JS"][1])
        self.assertEqual(r["Ato I visível com reduced-motion"][0], "OK")
        aviso = self.estados(HTML_BOM, capturas={"erro_sem_js": "Chrome não encontrado", "erro_reduzido": "x"})
        self.assertEqual(aviso["Ato I visível sem JS"][0], "AVISO")  # o gate sem Chrome não reprova o site

    def test_acha_so_as_capturas_do_ato1(self):
        for nome in ("m-ato3-rm.png", "m-ato1-rm.png", "m-ato1-semjs.png", "folha-1-semjs.jpg", "m-ato10-semjs.png"):
            (self.pasta / nome).write_bytes(b"x")
        achadas = self.q.achar_capturas(self.pasta)
        self.assertEqual({k: v.name for k, v in achadas.items()}, {"reduzido": "m-ato1-rm.png", "sem_js": "m-ato1-semjs.png"})

    def test_copia_sem_js(self):
        html = '<html><head><script>document.documentElement.classList.add("js")</script></head><body><noscript><p>oi</p></noscript></body></html>'
        self.assertEqual(self.q.html_sem_js(html), "<html><head></head><body><p>oi</p></body></html>")

    def test_codigos_de_saida(self):
        bom, ruim = self.pasta / "bom.html", self.pasta / "ruim.html"
        bom.write_text(HTML_BOM, encoding="utf-8")
        ruim.write_text(HTML_BOM.replace('width="800" height="600"', ""), encoding="utf-8")
        self.assertEqual(self.q.main([str(bom)]), 0)
        self.assertEqual(self.q.main([str(ruim)]), 1)
        self.assertEqual(self.q.main([str(self.pasta / "nao-existe.html")]), 2)

    def chrome_falso(self, grava=True):
        falso = self.pasta / "chrome-falso"
        falso.write_text(f"""#!/usr/bin/env python3
import json, os, sys
sys.path.insert(0, {str(AQUI)!r})
args = sys.argv[1:]
with open({str(self.pasta / 'chamadas.jsonl')!r}, "a") as f:
    f.write(json.dumps(args) + "\\n")
perfil = next(a.split("=", 1)[1] for a in args if a.startswith("--user-data-dir="))
os.makedirs(os.path.join(perfil, "Default"), exist_ok=True)  # o Chrome de verdade suja o perfil
if "--dump-dom" in args:  # a medida da página (moldura) e a sonda da largura da janela
    print('<html><body><pre id="qa-medidas">{{"largura": 390, "altura": 4200, "rolagem": 390, "alvos": [], '
          '"miudos": 0}}</pre><pre id="qa-largura">500</pre></body></html>')
    sys.exit(0)
saida = next(a.split("=", 1)[1] for a in args if a.startswith("--screenshot="))
if {grava!r}:
    import importlib.util
    spec = importlib.util.spec_from_file_location("t", {str(AQUI / 'gerador-de-sites.test.py')!r})
    t = importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
    from pathlib import Path
    t.png_listrado(Path(saida), liso="semjs" in saida)
""", encoding="utf-8")
        falso.chmod(0o755)
        self.q.CHROMES = (str(falso),)
        tmp = self.pasta / "tmp"
        tmp.mkdir()
        antes = os.environ.get("TMPDIR")
        os.environ["TMPDIR"] = str(tmp)
        self.q.tempfile.tempdir = None
        self.addCleanup(lambda: (os.environ.pop("TMPDIR") if antes is None else os.environ.__setitem__("TMPDIR", antes),
                                 setattr(self.q.tempfile, "tempdir", None)))
        return tmp

    @unittest.skipUnless(TEM_PIL and os.name == "posix", "sem Pillow ou fora do Linux")
    def test_gate_tira_as_capturas_do_ato1_com_perfil_proprio(self):
        tmp = self.chrome_falso()
        index, qa = self.pasta / "index.html", self.pasta / "qa"
        index.write_text(HTML_BOM, encoding="utf-8")
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            codigo = self.q.main([str(index), "--capturas", str(qa)])
        chamadas = [json.loads(l) for l in (self.pasta / "chamadas.jsonl").read_text().splitlines()]
        self.assertEqual(len(chamadas), 4)  # duas capturas do Ato I, a medida e a sonda da largura
        sem_js, rm, medida, sonda = chamadas
        # 13/10/2026: a captura é de uma moldura com a página num iframe de 390x844, não da janela.
        self.assertTrue(sem_js[-1].endswith("/qa/.moldura-m-ato1-semjs.html"))
        self.assertNotIn("<script", (qa / "_sem-js.html").read_text())
        self.assertNotIn("--force-prefers-reduced-motion", sem_js)
        self.assertIn("--force-prefers-reduced-motion", rm)
        self.assertIn("--window-size=600,844", rm)
        self.assertTrue(medida[-1].endswith("/qa/_medida-moldura.html"))
        self.assertIn("--dump-dom", medida)
        self.assertIn("--window-size=390,844", sonda)
        self.assertEqual(list(tmp.iterdir()), [])  # o perfil temporário do Chrome não sobra
        self.assertEqual(sorted(p.name for p in qa.iterdir()),  # e a moldura das capturas também não
                         ["_largura.html", "_medida-moldura.html", "_medida.html", "_sem-js.html",
                          "m-ato1-rm.png", "m-ato1-semjs.png"])
        self.assertIn("<iframe", (qa / "_medida-moldura.html").read_text())
        texto = saida.getvalue()
        self.assertIn("OK     Altura no celular: 4200 px = 5.0 telas", texto)
        self.assertIn("AVISO  Largura das capturas: o Chrome com --window-size=390,844 abre com 500 px", texto)
        self.assertEqual(codigo, 1)  # o falso grava a sem JS lisa: Ato I invisível sem JS

    @unittest.skipUnless(TEM_PIL and os.name == "posix", "sem Pillow ou fora do Linux")
    def test_chrome_que_nao_grava_usa_a_captura_antiga_ou_avisa(self):
        self.chrome_falso(grava=False)
        index, qa = self.pasta / "index.html", self.pasta / "qa"
        index.write_text(HTML_BOM, encoding="utf-8")
        qa.mkdir()
        png_listrado(qa / "m-ato1-rm.png")  # de uma rodada anterior
        capturas = self.q.capturas_do_gate(index, HTML_BOM, qa)
        self.assertEqual(capturas["reduzido"], qa / "m-ato1-rm.png")
        self.assertIn("não gravou", capturas["erro_sem_js"])
        self.assertEqual(self.q.main([str(index), "--capturas", str(qa)]), 0)  # AVISO não reprova


CONTENT_QA = """# Romitec Desentupidora

- **Vertical:** desentupidora
- **Cidade:** Votorantim
- **País:** Brasil
- **Telefone:** +55 15 99623-7873
- **WhatsApp achado na busca do Caçador:** +5515991438550 (confirmar à mão antes de publicar)
- **place_id:** ChIJx
"""


def pagina(h1="Desentupidora 24 horas em Votorantim", menu="", corpo="", wa="5515996237873", css=""):
    links = f'<a href="https://wa.me/{wa}?text=Ol%C3%A1">Chamar no WhatsApp</a>' if wa else ""
    return HTML_BOM.replace("</style>", css + "</style>").replace(
        "<body><main>", f"<body><header><nav>{menu}</nav></header><main>").replace(
        "<h1>Desentupidora</h1>", f"<h1>{h1}</h1><p>Jardim Tatiana, Votorantim.</p>{links}{corpo}")


class QaCaraDeIa(unittest.TestCase):
    """13/10/2026: o que a auditoria dos 54 demos no ar achou de "cara de IA" e de configuração."""

    def setUp(self):
        self.q = modulo("qa-numerico")
        self.content = self.q.ler_content(CONTENT_QA)

    def estados(self, html, content="padrão", medidas=None):
        content = self.content if content == "padrão" else content
        return {i.nome: (i.estado, i.texto) for i in self.q.avaliar(html, content=content, medidas=medidas)}

    def test_ler_content(self):
        c = self.content
        self.assertEqual((c["nome"], c["vertical"], c["cidade"], c["pais"]),
                         ("Romitec Desentupidora", "desentupidora", "Votorantim", "Brasil"))
        self.assertEqual(self.q.digitos(c["telefone"]), "5515996237873")
        self.assertFalse(c["whatsapp_confirmado"])

    def test_pagina_clara_passa(self):
        r = self.estados(pagina(menu='<a href="#servicos">Serviços</a><a href="#onde">Onde fica</a>'))
        self.assertEqual([n for n, (e, _) in r.items() if e != "OK"], [], r)

    def test_titulo_em_duas_frases_entre_aspas_ou_sem_oficio(self):
        self.assertIn("duas frases de efeito", self.estados(pagina("A água desce. Depois, a gente confere."))["Título (h1)"][1])
        self.assertIn("entre aspas", self.estados(pagina("“Sei o valor de cada dia.”"))["Título (h1)"][1])
        estado, texto = self.estados(pagina("Uma vida inteira não cabe numa folha só"))["Título (h1)"]
        self.assertEqual(estado, "FALHA")
        self.assertIn("não diz o ofício nem a cidade", texto)
        self.assertEqual(self.estados(pagina("Desentupidora 24 horas"))["Título (h1)"][0], "OK")  # o ofício basta
        self.assertEqual(self.estados(pagina("Atendemos em Votorantim"))["Título (h1)"][0], "OK")  # a cidade também
        self.assertEqual(self.estados(pagina("Uma vida inteira"), content=None)["Título (h1)"][0], "OK")  # sem content.md
        sem = self.estados(HTML_BOM.replace("<h1>Desentupidora</h1>", "<p>x</p>"), content=None)
        self.assertEqual(sem["Título (h1)"][0], "FALHA")

    def test_cidade_no_ato1(self):
        html = pagina("Desentupidora 24 horas").replace("<p>Jardim Tatiana, Votorantim.</p>", "")
        self.assertEqual(self.estados(html)["Cidade no Ato I"][0], "FALHA")
        self.assertEqual(self.estados(pagina("Desentupidora 24 horas"))["Cidade no Ato I"][0], "OK")

    def test_menu_numerado_reprova_e_metafora_avisa(self):
        r = self.estados(pagina(menu='<a href="#a">I Sentar</a><a href="#b">II</a><a href="#c">III</a>'))
        self.assertEqual(r["Menu"][0], "FALHA")
        self.assertIn("I Sentar", r["Menu"][1])
        r = self.estados(pagina(menu='<a href="#a">Ralo</a><a href="#b">Conferida</a><a href="#c">Onde fica</a>'))
        self.assertEqual(r["Menu"][0], "AVISO")
        self.assertIn("Conferida", r["Menu"][1])
        self.assertNotIn("Onde fica", r["Menu"][1])
        # palavra do ofício e o nome da empresa são rótulos claros
        r = self.estados(pagina(menu='<a href="#a">Romitec</a><a href="#b">Esgoto e caixa de gordura</a>'))
        self.assertEqual(r["Menu"][0], "OK", r["Menu"])

    def test_frases_de_gaveta(self):
        r = self.estados(pagina(corpo="<p>Atendimento humanizado, explicado com clareza.</p>"))
        self.assertEqual(r["Frases de gaveta"][0], "FALHA")
        self.assertIn("atendimento humanizado", r["Frases de gaveta"][1])
        self.assertIn("explicado com clareza", r["Frases de gaveta"][1])
        # frase escondida em script ou comentário não conta
        r = self.estados(pagina(corpo="<!-- sem complicação --><script>'jornada'</script>"))
        self.assertEqual(r["Frases de gaveta"][0], "OK")

    def test_campo_de_texto_reprova_e_caixas_demais_avisam(self):
        r = self.estados(pagina(corpo="<textarea></textarea>"))
        self.assertEqual(r["Campos para o visitante"][0], "FALHA")
        r = self.estados(pagina(corpo='<input type="text" name="rua">'))
        self.assertEqual(r["Campos para o visitante"][0], "FALHA")
        caixas = "".join(f'<input type="checkbox" id="c{i}">' for i in range(9))
        self.assertEqual(self.estados(pagina(corpo=caixas))["Campos para o visitante"][0], "AVISO")
        self.assertEqual(self.estados(pagina(corpo='<input type="hidden" value="x">'))["Campos para o visitante"][0], "OK")

    def test_codigo_de_teste_publicado(self):
        r = self.estados(pagina(corpo='<pre id="qa-resultado"></pre>', css="html.qa *{transition:none}"))
        self.assertEqual(r["Código de teste publicado"][0], "FALHA")
        self.assertIn("#qa-resultado", r["Código de teste publicado"][1])
        self.assertIn("html.qa", r["Código de teste publicado"][1])

    def test_vidro_fosco_avisa(self):
        self.assertEqual(self.estados(pagina(css=".topo{backdrop-filter:blur(8px)}"))["Vidro fosco"][0], "AVISO")

    def test_whatsapp_confere_com_o_content(self):
        self.assertEqual(self.estados(pagina())["WhatsApp"], ("OK", "5515996237873"))
        estado, texto = self.estados(pagina(wa="5511999990000"))["WhatsApp"]
        self.assertEqual(estado, "FALHA")
        self.assertIn("não está no content.md", texto)
        self.assertEqual(self.estados(pagina(wa="5515991438550"))["WhatsApp"][0], "AVISO")  # só o achado na busca
        dois = pagina(corpo='<a href="https://wa.me/5515991438550">outro</a>')
        self.assertIn("2 números diferentes", self.estados(dois)["WhatsApp"][1])
        self.assertEqual(self.estados(pagina(wa=""))["WhatsApp"][0], "FALHA")
        fora = self.q.ler_content(CONTENT_QA.replace("Brasil", "Estados Unidos"))
        self.assertNotIn("WhatsApp", self.estados(pagina(wa=""), content=fora))

    def test_mesmo_numero(self):
        self.assertTrue(self.q.mesmo_numero("+55 (15) 99623-7873", "15996237873"))
        self.assertTrue(self.q.mesmo_numero("5515996237873", "551596237873"))  # celular antigo, sem o nono dígito
        self.assertFalse(self.q.mesmo_numero("5515996237873", "5515991438550"))
        self.assertFalse(self.q.mesmo_numero("", "5515991438550"))

    def test_checagens_renderizadas(self):
        boas = {"largura": 390, "altura": 5000, "rolagem": 390, "alvos": [], "miudos": 2, "janela": 390}
        r = self.estados(pagina(), medidas=boas)
        for nome in ("Altura no celular", "Rolagem lateral", "Alvos de toque", "Texto miúdo"):
            self.assertEqual(r[nome][0], "OK", (nome, r[nome]))
        self.assertNotIn("Largura das capturas", r)
        ruins = {"largura": 390, "altura": 9300, "rolagem": 420, "alvos": ["Voltar ao topo 91x22"], "miudos": 7,
                 "janela": 500}
        r = self.estados(pagina(), medidas=ruins)
        self.assertEqual(r["Altura no celular"][0], "FALHA")
        self.assertIn("11.0 telas (teto 8)", r["Altura no celular"][1])
        self.assertEqual(self.estados(pagina(), medidas={**boas, "altura": 6500})["Altura no celular"][0], "AVISO")
        self.assertEqual(r["Rolagem lateral"][0], "FALHA")
        self.assertIn("Voltar ao topo 91x22", r["Alvos de toque"][1])
        self.assertEqual(r["Texto miúdo"][0], "FALHA")
        self.assertEqual(r["Largura das capturas"][0], "AVISO")
        self.assertEqual(self.estados(pagina(), medidas={**boas, "altura": 5500})["Altura no celular"][0], "AVISO")
        erro = self.estados(pagina(), medidas={"erro": "Chrome não encontrado"})
        self.assertEqual(erro["Página no celular"][0], "AVISO")

    def test_copia_de_medida_e_leitura(self):
        copia = self.q.html_para_medir(HTML_BOM)
        self.assertIn("parent.postMessage('qa-medidas:'", copia)
        self.assertLess(copia.index("postMessage"), copia.index("</body>"))
        self.assertIn("< 40", copia)  # ALVO_MIN no lugar do marcador
        dom = '<pre id="qa-medidas">{"largura":390,"altura":4000,"rolagem":390,"alvos":["a &amp; b 30x20"],"miudos":0}</pre>'
        self.assertEqual(self.q.ler_medidas(dom)["alvos"], ["a & b 30x20"])
        self.assertIsNone(self.q.ler_medidas("<html></html>"))
        moldura = self.q.moldura_celular('file:///x/index.html?qa=1&p=0.3"')
        self.assertIn('width="390" height="844"', moldura)
        self.assertIn("&amp;p=0.3&quot;", moldura)


class AvisoPelaLib(unittest.TestCase):
    """O avisar() pela lib de aviso (11/10/2026): o dell-status aceita o que ela
    grava; sem a lib nada vai à fila (uma linha no stderr); e a fila ausente ou
    estragada nunca derruba a execução.
    O avisar() é o de verdade, mas a fila é uma pasta temporária e o HOME também."""

    TEXTOS = [
        "O gerador de sites não rodou: o Claude não está logado no Dell. Grave o token em "
        "~/.config/claude-ops/gerador.env (CLAUDE_CODE_OAUTH_TOKEN=...) e ele volta amanhã às 08h.",
        "aspas \"duplas\", barra \\ e acento: ação, coração",
        "duas\nlinhas e emoji 🌐",
    ]

    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="gerador-teste-"))
        self.addCleanup(shutil.rmtree, self.raiz, True)
        self.auto = self.raiz / "auto-site"
        self.auto.mkdir()
        # Sem login e com o HOME de teste: o main() olha ~/.claude/.credentials.json.
        for chave in ("HOME", "USERPROFILE", "CLAUDE_CODE_OAUTH_TOKEN"):
            self.addCleanup(lambda c=chave, v=os.environ.get(chave): os.environ.pop(c, None) if v is None else os.environ.__setitem__(c, v))
        os.environ["HOME"] = os.environ["USERPROFILE"] = str(self.raiz / "home")
        os.environ.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
        self.m = carregar(self.auto, avisar_real=True)
        self.m.FILA_AVISOS = self.raiz / "fila"
        self.lib_do_repo = list(self.m.PASTAS_DA_LIB)

    def fila(self):
        return sorted(self.m.FILA_AVISOS.glob("*.json")) if self.m.FILA_AVISOS.is_dir() else []

    def avisar(self, texto):
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(saida):
            self.m.avisar(texto)
        return saida.getvalue()

    def gravado_pela_lib(self, texto):
        shutil.rmtree(self.m.FILA_AVISOS, ignore_errors=True)
        self.m.FILA_AVISOS.mkdir()
        self.m.PASTAS_DA_LIB = self.lib_do_repo
        self.avisar(texto)
        arquivos = self.fila()
        self.assertEqual(len(arquivos), 1, arquivos)
        return arquivos[0].read_bytes()

    def sem_login(self):
        """O main() que avisa: sem token, sem credencial e com o HOME vazio."""
        sys.argv = ["gerador-de-sites"]
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(saida):
            return self.m.main()

    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(self.m.lib_de_aviso().__file__).resolve(), (AQUI / "lib/aviso.py").resolve())

    def test_aviso_gravado_le_de_volta_igual(self):
        for texto in self.TEXTOS:
            with self.subTest(texto=texto[:30]):
                d = json.loads(self.gravado_pela_lib(texto).decode("utf-8"))
                self.assertEqual(d, {"titulo": "🌐 Gerador de sites", "texto": texto, "origem": "gerador-de-sites"})

    def test_conteudo_fixado(self):
        esperado = '{"titulo": "🌐 Gerador de sites", "texto": "duas\\nlinhas", "origem": "gerador-de-sites"}'
        self.assertEqual(self.gravado_pela_lib("duas\nlinhas"), esperado.encode("utf-8"))

    def test_nome_atomico_e_sem_colisao_no_mesmo_segundo(self):
        self.m.FILA_AVISOS.mkdir()
        for i in range(5):
            self.avisar(f"aviso {i}")  # o nome leva nanossegundos: o 2º nunca sobrescreve o 1º
        self.assertEqual(len(self.fila()), 5)
        self.assertRegex(self.fila()[0].name, r"^gerador-\d+-[0-9a-f]{6}\.json$")
        self.assertEqual([p for p in self.m.FILA_AVISOS.iterdir() if not p.name.endswith(".json")], [])

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        self.m.FILA_AVISOS.mkdir()
        for texto in self.TEXTOS:
            self.avisar(texto)
        self.assertEqual(len(self.fila()), len(self.TEXTOS))
        for arq in self.fila():
            ds.validar_aviso(json.loads(arq.read_text(encoding="utf-8")))

    def test_com_a_lib_a_fila_ausente_nao_e_criada_e_nao_levanta(self):
        saida = self.avisar("x")
        self.assertFalse(self.m.FILA_AVISOS.exists())
        self.assertIn("Aviso não gravado (fila_ausente", saida)

    def test_valor_em_reais_nao_perde_o_aviso(self):
        self.m.FILA_AVISOS.mkdir()
        self.avisar("custa R$ 12,50 por mês")
        d = json.loads(self.fila()[0].read_text(encoding="utf-8"))
        self.assertNotRegex(d["texto"], r"R\s*\$")
        self.assertIn("[valor]", d["texto"])

    def sem_gravar(self, saida):
        self.assertIn("lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: 🌐 Gerador de sites", saida)
        self.assertFalse(self.m.FILA_AVISOS.exists(), "sem a lib nada é criado nem gravado na fila")

    def test_sem_copia_registra_no_stderr_e_nao_grava(self):
        self.m.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        self.assertIsNone(self.m.lib_de_aviso())
        self.sem_gravar(self.avisar("x"))

    def test_copia_quebrada_nao_grava_e_cai_na_seguinte(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("def x(:\n", encoding="utf-8")
        self.m.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(self.m.lib_de_aviso())
        self.sem_gravar(self.avisar("x"))
        self.m.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(self.m.lib_de_aviso().__file__).resolve(), (AQUI / "lib/aviso.py").resolve())

    # --- o caminho real: o main() sem login do Claude, antes de qualquer lead ----

    def test_main_sem_login_avisa_e_sai_com_2(self):
        self.m.FILA_AVISOS.mkdir()
        self.assertEqual(self.sem_login(), 2)
        avisos = [json.loads(p.read_text(encoding="utf-8")) for p in self.fila()]
        self.assertEqual(len(avisos), 1)
        self.assertEqual((avisos[0]["titulo"], avisos[0]["origem"]), ("🌐 Gerador de sites", "gerador-de-sites"))
        self.assertIn("o Claude não está logado no Dell", avisos[0]["texto"])
        status = json.loads((self.auto / ".logs/status.json").read_text(encoding="utf-8"))
        self.assertEqual(status["ultimo_resumo"]["erro"], "Claude sem login no Dell")

    def test_main_sem_login_com_a_fila_ausente_ou_estragada_continua_2(self):
        for estrago in ("ausente", "arquivo"):
            for jeito in ("lib", "sem-lib"):
                with self.subTest(fila=estrago, jeito=jeito):
                    shutil.rmtree(self.m.FILA_AVISOS, ignore_errors=True)
                    if self.m.FILA_AVISOS.is_file():
                        self.m.FILA_AVISOS.unlink()
                    if estrago == "arquivo":
                        self.m.FILA_AVISOS.write_text("não sou pasta", encoding="utf-8")
                    self.m.PASTAS_DA_LIB = self.lib_do_repo if jeito == "lib" else [self.raiz / "sem-lib"]
                    self.assertEqual(self.sem_login(), 2)
                    self.assertTrue((self.auto / ".logs/status.json").is_file())
                    if estrago == "ausente" and jeito == "lib":
                        self.assertFalse(self.m.FILA_AVISOS.exists())

    def test_lib_que_levanta_nao_derruba_o_gerador(self):
        class LibRuim:
            VALOR_EM_REAIS = __import__("re").compile("R[$]")

            @staticmethod
            def gravar(*a, **k):
                raise OSError("disco cheio")

        self.m.lib_de_aviso = lambda: LibRuim
        self.assertEqual(self.sem_login(), 2)


class DemoSobPedido(unittest.TestCase):
    """14/10/2026: com ~/auto-site/.demo-sob-pedido a fila não gera lead novo do Brasil; o demo sai quando o
    botão "Gerar demo" grava PEDIDO-DEMO.json na pasta (que pode estar em _em-conversa/)."""

    RAIO_X = {"place_id": "pid-c", "slug": "c-respondeu", "nome": "C Respondeu",
              "raio_x_url": "https://raio-x-prumo.vercel.app/c-respondeu", "raio_x_pontos": 3, "raio_x_projeto": "prumo-raio-x"}

    def setUp(self):
        self.auto = Path(tempfile.mkdtemp(prefix="gerador-teste-"))
        self.addCleanup(shutil.rmtree, self.auto)
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = "teste"
        self.m = carregar(self.auto)
        self.avisos = []
        self.m.avisar = self.avisos.append
        (self.auto / ".demo-sob-pedido").write_text("")
        for i, (slug, pais) in enumerate([("a-novo-br", "Brasil"), ("b-novo-eua", "Estados Unidos")]):
            (self.auto / slug).mkdir()
            (self.auto / slug / "content.md").write_text(f"# {slug}\n- **País:** {pais}\n- **place_id:** pid-{slug}\n")
            os.utime(self.auto / slug / "content.md", (1000 + i, 1000 + i))
        self.pedido = self.auto / "_em-conversa" / "c-respondeu"
        self.pedido.mkdir(parents=True)
        (self.pedido / "content.md").write_text("# C Respondeu\n- **País:** Brasil\n- **place_id:** pid-c\n")
        (self.pedido / "publicado.json").write_text(json.dumps(self.RAIO_X))
        (self.pedido / "PEDIDO-DEMO.json").write_text('{"place_id": "pid-c"}')
        self.vistos = []

    def rodar(self, claude, *args):
        self.m.rodar_claude = claude
        sys.argv = ["gerador-de-sites", "--timeout-min", "1", *args]
        codigo = self.m.main()
        return codigo, json.loads((self.auto / ".logs/status.json").read_text())["ultimo_resumo"]

    def claude(self, slug, log_lead, timeout_min, personalizado=False):
        pasta = self.m.pasta_do_lead(slug)
        # O Claude do pedido não vê o recibo do Raio-X (veria um lead "já publicado").
        self.vistos.append((slug, personalizado, (pasta / "publicado.json").exists(), self.m.comando_do_claude(slug, Path("/tmp/r"), personalizado)))
        (pasta / "index.html").write_text("<html></html>")
        (pasta / "publicado.json").write_text(json.dumps({"place_id": f"pid-{slug}", "site_url": "https://demo-x.vercel.app",
                                                          "vercel_project": "demo-x", "slug": slug}))
        return {"codigo": 0, "estourou": False, "limite": False, "minutos": 0}

    def test_fila_sob_pedido_so_tem_o_pedido_e_o_de_fora_do_brasil(self):
        self.assertEqual([p.relative_to(self.auto).as_posix() for p in self.m.fila()], ["_em-conversa/c-respondeu", "b-novo-eua"])
        (self.auto / ".demo-sob-pedido").unlink()
        self.assertEqual([p.name for p in self.m.fila()], ["c-respondeu", "a-novo-br", "b-novo-eua"])

    def test_pedido_gera_em_em_conversa_e_mescla_o_recibo(self):
        codigo, r = self.rodar(self.claude, "--pedidos")
        self.assertEqual(codigo, 0)
        self.assertEqual(r["concluidos"], ["c-respondeu"])
        slug, personalizado, via_recibo, cmd = self.vistos[0]
        self.assertEqual((slug, personalizado, via_recibo), ("c-respondeu", True, False))
        self.assertIn("/lead-novo _em-conversa/c-respondeu ", cmd[2])
        self.assertIn("DEMO PEDIDO", cmd[cmd.index("--append-system-prompt") + 1])
        recibo = json.loads((self.pedido / "publicado.json").read_text())
        self.assertEqual((recibo["site_url"], recibo["raio_x_url"], recibo["raio_x_pontos"], recibo["place_id"]),
                         ("https://demo-x.vercel.app", self.RAIO_X["raio_x_url"], 3, "pid-c-respondeu"))
        self.assertFalse((self.pedido / "PEDIDO-DEMO.json").exists())
        self.assertFalse((self.pedido / ".publicado-raio-x.json").exists())
        self.assertTrue((self.pedido / "personalizado.json").is_file())
        self.assertIn("no ar: https://demo-x.vercel.app", self.avisos[0])
        self.assertEqual(len(self.vistos), 1)  # --pedidos não toca na fila de sempre (nem no lead dos EUA)

    def test_permissoes_do_pedido_nao_negam_o_proprio_caminho(self):
        self.m.pedidos()
        deny = self.m.permissoes_do_claude("c-respondeu", Path("/tmp/r"))["permissions"]["deny"]
        self.assertNotIn("Bash(rm *_em-conversa*)", deny)
        self.assertIn("Bash(mv *_recusados*)", deny)
        self.assertIn("Bash(rm *publicado.json*)", deny)

    def test_regras_valem_com_o_prefixo_do_rtk(self):
        """O gancho do rtk no Dell reescreve `curl` para `rtk curl` antes da permissão (03/11/2026)."""
        import fnmatch
        p = self.m.permissoes_do_claude("c-respondeu", Path("/tmp/r"))["permissions"]
        casa = lambda cmd, lista: any(fnmatch.fnmatchcase(cmd, r[5:-1]) for r in lista if r.startswith("Bash("))
        baixar = "rtk curl -s -o /tmp/r/fontes/archivo.css https://fonts.googleapis.com/css2?family=Archivo"
        self.assertTrue(casa(baixar, p["allow"]) and not casa(baixar, p["deny"]))
        for negado in ("rtk curl -s -d a=1 https://x", "rtk git status", "rtk wget https://x"):
            self.assertTrue(casa(negado, p["deny"]), negado)
        self.assertNotIn("Bash(rtk rtk curl *)", p["allow"])

    def test_pedido_que_falha_devolve_o_recibo_e_sai(self):
        def falha(slug, log_lead, timeout_min, personalizado=False):
            return {"codigo": 1, "estourou": False, "limite": False, "minutos": 0}
        codigo, r = self.rodar(falha, "--pedidos")
        self.assertEqual(len(r["falhas"]), 1)
        self.assertEqual(json.loads((self.pedido / "publicado.json").read_text()), self.RAIO_X)
        self.assertFalse((self.pedido / "PEDIDO-DEMO.json").exists())  # uma tentativa por toque
        self.assertFalse((self.pedido / "falha.log").exists())
        self.assertIn("Gerar demo", self.avisos[0])

    def test_limite_no_meio_nao_publica_a_pagina_pela_metade(self):
        """03/11/2026 (av-servicos): o limite cortou o Claude com o HTML pronto e sem revisão nem og.jpg."""
        publicados = []
        self.m.publicar_na_vercel = lambda pasta, log_lead: publicados.append(pasta.name)
        def cortado(slug, log_lead, timeout_min, personalizado=False):
            (self.m.pasta_do_lead(slug) / "index.html").write_text("<html></html>")
            return {"codigo": 1, "estourou": False, "limite": True, "minutos": 10}
        codigo, r = self.rodar(cortado, "--pedidos")
        self.assertEqual(publicados, [])
        self.assertEqual(r["falhas"], ["c-respondeu: limite de uso do Claude atingido"])
        self.assertFalse((self.pedido / "index.html").exists())  # o checkpoint não a publica na próxima
        self.assertTrue((self.pedido / "index.limite.html").is_file())
        self.assertEqual(json.loads((self.pedido / "publicado.json").read_text()), self.RAIO_X)

    def test_limite_de_sessao_e_reconhecido(self):
        for texto in ("You've hit your session limit · resets 1:10pm (America/Sao_Paulo)",
                      "Claude AI usage limit reached|1760000000", "API Error: 429"):
            self.assertTrue(self.m.LIMITE_DE_USO.search(texto), texto)
        self.assertFalse(self.m.LIMITE_DE_USO.search("limite de 8 telas no celular"))

    def test_descartar_do_claude_e_ignorado_no_pedido(self):
        def quer_descartar(slug, log_lead, timeout_min, personalizado=False):
            (self.m.pasta_do_lead(slug) / "DESCARTAR.md").write_text("Já tem site no ar\n")
            return self.claude(slug, log_lead, timeout_min, personalizado)
        codigo, r = self.rodar(quer_descartar, "--pedidos")
        self.assertEqual(r["concluidos"], ["c-respondeu"])
        self.assertTrue(self.pedido.is_dir())
        self.assertTrue((self.pedido / "DESCARTAR.ignorado.md").is_file())

    def test_sem_pedido_o_pedidos_nao_faz_nada(self):
        (self.pedido / "PEDIDO-DEMO.json").unlink()
        self.m.rodar_claude = lambda *a, **k: self.fail("rodou o Claude sem pedido")
        sys.argv = ["gerador-de-sites", "--pedidos"]
        self.assertEqual(self.m.main(), 0)


CONTENT_SEO = """# Linotec - Desentupidora em Maceió

- **Vertical:** desentupidora
- **Cidade:** Maceió
- **País:** Brasil
- **Endereço:** Av. Luiz Avelino Pereira, 07 - Tabuleiro do Martins, Maceió - AL, 57081-131, Brasil
- **Telefone:** +55 82 98722-3239
- **Instagram:** @linotecdesentupidora (achado na busca do Caçador, não no Google Maps — confirmar à mão)
- **Nota Google:** 4.7 (46 avaliações)
- **Google Maps:** https://maps.google.com/?cid=4172888250304675344&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA
- **place_id:** ChIJCTNjiSBIAQcREL7PNsET6Tk
- **Slug:** linotec

## Por que este lead

- +5 nota 4.7
"""

# A resposta real do Places (New) para este lead em 15/10/2026, com os campos que o seo-do-site pede.
PLACES_SEO = {
    "id": "ChIJCTNjiSBIAQcREL7PNsET6Tk",
    "formattedAddress": "Av. Luiz Avelino Pereira, 07 - Tabuleiro do Martins, Maceió - AL, 57081-131",
    "location": {"latitude": -9.5664423, "longitude": -35.75553},
    "googleMapsUri": "https://maps.google.com/?cid=4172888250304675344&g_mp=CiVnb29nbGUubWFwcy5wbGFj",
    "regularOpeningHours": {"periods": [{"open": {"day": 0, "hour": 0, "minute": 0}}],
                            "weekdayDescriptions": [f"{d}: Atendimento 24 horas" for d in (
                                "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira",
                                "sábado", "domingo")]},
    "postalAddress": {"regionCode": "BR", "languageCode": "pt-BR", "postalCode": "57081-131",
                      "administrativeArea": "Alagoas", "locality": "Maceió", "sublocality": "Tabuleiro do Martins",
                      "addressLines": ["Av. Luiz Avelino Pereira, 07"]},
}

PERGUNTAS_SEO = """<section id="perguntas"><h2>Perguntas frequentes</h2>
<details data-fonte="google"><summary>Vocês atendem de madrugada?</summary><p>Sim. O horário no Google é 24 horas, todos os dias.</p></details>
<details data-fonte="avaliacoes"><summary>O serviço deixa sujeira?</summary><p>As avaliações contam que a equipe entrega o lugar limpo e organizado.</p></details>
<details data-fonte="google"><summary>Onde fica a base?</summary><p>Na Av. Luiz Avelino Pereira, 07, no Tabuleiro do Martins, em Maceió.</p></details>
</section>"""


def pagina_seo(perguntas=PERGUNTAS_SEO, prova="Nota 4,7 no Google, em 46 avaliações.", cabeca=""):
    return (f"<!doctype html><html lang=\"pt-BR\"><head><title>Linotec</title>{cabeca}</head><body><main>"
            f"<section><h1>Desentupidora 24 horas no Tabuleiro do Martins, em Maceió</h1><p>{prova}</p></section>"
            f"{perguntas}</main></body></html>")


class SeoDoSite(unittest.TestCase):
    """O JSON-LD, a seção de perguntas e os três arquivos do seo-do-site.py (15/10/2026). Sem rede: o
    Places é um dublê com a resposta real gravada acima."""

    def setUp(self):
        self.s = modulo("seo-do-site")
        self.s.PLACES_ENV = Path(tempfile.gettempdir()) / "seo-sem-chave.env"  # nunca a chave real
        self.raiz = Path(tempfile.mkdtemp(prefix="seo-teste-"))
        self.addCleanup(shutil.rmtree, self.raiz)
        self.pasta = self.raiz / "linotec"
        self.pasta.mkdir()
        (self.pasta / "content.md").write_text(CONTENT_SEO, encoding="utf-8")
        (self.pasta / "index.html").write_text(pagina_seo(), encoding="utf-8")
        (self.pasta / "og.jpg").write_bytes(b"\xff\xd8og")
        self.url = "https://demo-linotec.vercel.app"
        self.pedidos = []

    def pedir(self, resposta=PLACES_SEO):
        def f(place_id, chave):
            self.pedidos.append(place_id)
            return resposta
        return f

    def aplicar(self, **k):
        k.setdefault("pedir", self.pedir())
        return self.s.aplicar(self.pasta, self.url, agora=k.pop("agora", None), **k)

    def json_ld(self):
        blocos = self.s.blocos_json_ld((self.pasta / "index.html").read_text(encoding="utf-8"))
        self.assertEqual(len(blocos), 1)
        return json.loads(blocos[0].replace("<\\/", "</"))

    def conferir(self):
        dados = self.s.ler_content(CONTENT_SEO)
        places = self.s.ler_cache(self.pasta, dados["campos"]["place_id"], self.s.dt.datetime.now().astimezone())
        return self.s.conferir((self.pasta / "index.html").read_text(encoding="utf-8"), dados, places, self.url, True)

    def test_json_ld_le_tem_os_campos_obrigatorios_e_so_dado_com_fonte(self):
        self.assertEqual(self.aplicar(exigir_faq=True), [])
        ld = self.json_ld()
        self.assertEqual(ld["@context"], "https://schema.org")
        negocio, faq = ld["@graph"]
        self.assertEqual(negocio["@type"], "Plumber")
        self.assertEqual(negocio["name"], "Linotec - Desentupidora em Maceió")  # o nome do Google, não o h1
        self.assertEqual(negocio["telephone"], "+55 82 98722-3239")
        self.assertEqual(negocio["url"], "https://demo-linotec.vercel.app/")
        self.assertEqual(negocio["image"], "https://demo-linotec.vercel.app/og.jpg")
        self.assertEqual(negocio["address"], {
            "@type": "PostalAddress", "streetAddress": "Av. Luiz Avelino Pereira, 07", "addressLocality": "Maceió",
            "addressRegion": "Alagoas", "postalCode": "57081-131", "addressCountry": "BR"})
        self.assertEqual(negocio["geo"], {"@type": "GeoCoordinates", "latitude": -9.5664423, "longitude": -35.75553})
        self.assertEqual(negocio["openingHoursSpecification"], [{
            "@type": "OpeningHoursSpecification", "opens": "00:00", "closes": "23:59",
            "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]}])
        # A nota exata do Google (a mesma que a página mostra), sem bestRating nem número arredondado.
        self.assertEqual(negocio["aggregateRating"], {"@type": "AggregateRating", "ratingValue": 4.7, "reviewCount": 46})
        # O perfil do Google pelo cid, sem o rastreio; o Instagram "achado na busca" não entra.
        self.assertEqual(negocio["sameAs"], ["https://maps.google.com/?cid=4172888250304675344"])
        self.assertEqual(faq["@type"], "FAQPage")
        self.assertEqual([q["name"] for q in faq["mainEntity"]],
                         ["Vocês atendem de madrugada?", "O serviço deixa sujeira?", "Onde fica a base?"])
        self.assertEqual(faq["mainEntity"][0]["acceptedAnswer"]["text"], "Sim. O horário no Google é 24 horas, todos os dias.")
        self.assertEqual(self.conferir(), [])
        self.assertEqual(self.pedidos, ["ChIJCTNjiSBIAQcREL7PNsET6Tk"])

    def test_dado_sem_fonte_ou_diferente_da_fonte_reprova(self):
        self.aplicar()
        pagina = (self.pasta / "index.html").read_text(encoding="utf-8")
        for antes, depois, esperado in (
                ('"reviewCount": 46', '"reviewCount": 46,\n      "bestRating": 5', "sem fonte: $.@graph[0].aggregateRating.bestRating"),
                ('"ratingValue": 4.7', '"ratingValue": 4.9', "diverge da fonte: $.@graph[0].aggregateRating.ratingValue"),
                ('"@type": "Plumber",', '"@type": "Plumber",\n      "foundingDate": "2010",', "sem fonte: $.@graph[0].foundingDate"),
                ('"telephone": "+55 82 98722-3239",', "", "falta: $.@graph[0].telephone"),
                ("O serviço deixa sujeira?", "Vocês dão garantia?", "diverge da fonte: $.@graph[1].mainEntity[1].name")):
            self.assertIn(antes, pagina)
            problemas = self.s.conferir(pagina.replace(antes, depois, 1), self.s.ler_content(CONTENT_SEO),
                                        self.s.ler_cache(self.pasta, "ChIJCTNjiSBIAQcREL7PNsET6Tk",
                                                         self.s.dt.datetime.now().astimezone()), self.url, True)
            self.assertTrue(any(p.startswith(esperado) for p in problemas), (esperado, problemas))
        self.assertEqual(self.s.conferir(pagina.replace("application/ld+json", "text/plain"), self.s.ler_content(CONTENT_SEO),
                                         None, self.url, True)[0][:1], "0")
        self.assertIn("ilegível", self.s.conferir(pagina.replace('"@graph": [', '"@graph": [[', 1),
                                                   self.s.ler_content(CONTENT_SEO), None, self.url, True)[0])

    def test_nota_so_quando_a_pagina_mostra_os_numeros_exatos(self):
        (self.pasta / "index.html").write_text(pagina_seo(prova="Clientes elogiam a rapidez."), encoding="utf-8")
        self.aplicar()
        self.assertNotIn("aggregateRating", self.json_ld()["@graph"][0])
        (self.pasta / "index.html").write_text(pagina_seo(prova="Nota 4,8 no Google, em 46 avaliações."), encoding="utf-8")
        self.aplicar()
        self.assertNotIn("aggregateRating", self.json_ld()["@graph"][0])
        self.assertEqual(self.conferir(), [])

    def test_advocacia_sem_nota_e_sem_resposta_tirada_das_avaliacoes(self):
        (self.pasta / "content.md").write_text(CONTENT_SEO.replace("desentupidora\n", "advocacia\n", 1), encoding="utf-8")
        self.assertIn("advocacia e saúde não respondem com as avaliações", self.aplicar(exigir_faq=True)[0])
        self.assertNotIn(self.s.ID_DO_BLOCO, (self.pasta / "index.html").read_text(encoding="utf-8"))  # nada gravado
        perguntas = PERGUNTAS_SEO.replace('data-fonte="avaliacoes"', 'data-fonte="google"').replace(
            "As avaliações contam que a equipe entrega o lugar limpo e organizado.", "O atendimento é com hora marcada.")
        (self.pasta / "index.html").write_text(pagina_seo(perguntas), encoding="utf-8")
        self.assertEqual(self.aplicar(exigir_faq=True), [])
        negocio = self.json_ld()["@graph"][0]
        self.assertEqual(negocio["@type"], "LegalService")
        self.assertNotIn("aggregateRating", negocio)  # mesmo com a nota na página (Provimento 205/2021)
        self.assertNotIn("Nota no Google", (self.pasta / "llms.txt").read_text(encoding="utf-8"))

    def test_pergunta_fora_do_contrato_nao_grava_nada(self):
        original = (self.pasta / "index.html").read_text(encoding="utf-8")
        for perguntas, trecho in ((PERGUNTAS_SEO.replace(' data-fonte="google"', "", 1), "sem data-fonte"),
                                  (PERGUNTAS_SEO.replace('data-fonte="google"', 'data-fonte="achismo"', 1), "fora da lista"),
                                  (PERGUNTAS_SEO.replace("madrugada?", "madrugada", 1), 'terminada em "?"'),
                                  ("", 'sem <section id="perguntas">')):
            (self.pasta / "index.html").write_text(pagina_seo(perguntas), encoding="utf-8")
            problemas = self.aplicar(exigir_faq=True)
            self.assertTrue(any(trecho in p for p in problemas), (trecho, problemas))
            self.assertNotIn(self.s.ID_DO_BLOCO, (self.pasta / "index.html").read_text(encoding="utf-8"))
        self.assertFalse((self.pasta / "llms.txt").exists())
        # Sem exigir (o runner num demo antigo): a pergunta sem fonte fica fora do FAQPage, e a conferência avisa.
        (self.pasta / "index.html").write_text(original.replace(' data-fonte="google"', "", 1), encoding="utf-8")
        problemas = self.aplicar()
        self.assertTrue(any(p.startswith("FAQ: pergunta 1") for p in problemas), problemas)
        self.assertEqual(len(self.json_ld()["@graph"][1]["mainEntity"]), 2)

    def test_sem_places_sai_sem_geo_e_sem_horario_e_endereco_do_content(self):
        self.assertEqual(self.aplicar(pedir=self.pedir(None)), [])
        negocio = self.json_ld()["@graph"][0]
        self.assertNotIn("geo", negocio)
        self.assertNotIn("openingHoursSpecification", negocio)
        self.assertEqual(negocio["address"], {
            "@type": "PostalAddress", "streetAddress": "Av. Luiz Avelino Pereira, 07", "addressLocality": "Maceió",
            "addressRegion": "AL", "postalCode": "57081-131", "addressCountry": "BR"})
        self.assertFalse((self.pasta / self.s.CACHE).exists())

    def test_cache_do_places_vale_30_dias(self):
        agora = self.s.dt.datetime(2026, 10, 15, 10, tzinfo=self.s.dt.timezone.utc)
        self.aplicar(agora=agora)
        self.aplicar(agora=agora + self.s.dt.timedelta(days=29))
        self.assertEqual(len(self.pedidos), 1)
        self.aplicar(agora=agora + self.s.dt.timedelta(days=31))
        self.assertEqual(len(self.pedidos), 2)

    def test_horario_com_dias_diferentes_e_almoco(self):
        def p(dia, a, f):
            return {"open": {"day": dia, "hour": a[0], "minute": a[1]}, "close": {"day": dia, "hour": f[0], "minute": f[1]}}
        periodos = [p(d, (8, 0), (12, 0)) for d in range(1, 6)] + [p(d, (13, 30), (18, 0)) for d in range(1, 6)]
        periodos.append(p(6, (8, 0), (12, 0)))
        self.assertEqual(self.s.horario(periodos), [
            {"@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                                                                 "Saturday"], "opens": "08:00", "closes": "12:00"},
            {"@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
             "opens": "13:30", "closes": "18:00"}])
        self.assertIsNone(self.s.horario([{"open": {"day": 1, "hour": 8, "minute": 0}}, p(2, (8, 0), (18, 0))]))
        self.assertIsNone(self.s.horario(None))

    def test_json_ld_feito_a_mao_e_trocado_e_aplicar_de_novo_nao_muda_nada(self):
        inventado = '<script type="application/ld+json">{"@type": "Plumber", "foundingDate": "1990"}</script>'
        (self.pasta / "index.html").write_text(pagina_seo(cabeca=inventado), encoding="utf-8")
        self.aplicar()
        primeira = (self.pasta / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("foundingDate", primeira)
        self.assertEqual(primeira.count('<link rel="canonical"'), 1)
        self.aplicar()
        self.assertEqual((self.pasta / "index.html").read_text(encoding="utf-8"), primeira)

    def test_robots_sitemap_e_llms(self):
        import xml.etree.ElementTree as ET
        self.aplicar(agora=self.s.dt.datetime(2026, 10, 15, 10, tzinfo=self.s.dt.timezone.utc))
        robots = (self.pasta / "robots.txt").read_text(encoding="utf-8")
        self.assertIn("User-agent: *\nAllow: /\nDisallow: /raio-x\n", robots)
        self.assertIn("Sitemap: https://demo-linotec.vercel.app/sitemap.xml", robots)
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        raiz = ET.fromstring((self.pasta / "sitemap.xml").read_bytes())
        self.assertEqual([u.find("s:loc", ns).text for u in raiz.findall("s:url", ns)], ["https://demo-linotec.vercel.app/"])
        self.assertEqual(raiz.find("s:url/s:lastmod", ns).text, "2026-10-15")
        llms = (self.pasta / "llms.txt").read_text(encoding="utf-8")
        self.assertTrue(llms.startswith("# Linotec - Desentupidora em Maceió\n\n> Desentupidora 24 horas no Tabuleiro"))
        for trecho in ("- Telefone: +55 82 98722-3239", "- Nota no Google: 4,7 (46 avaliações)",
                       "segunda-feira: Atendimento 24 horas", "### Vocês atendem de madrugada?",
                       "- [Linotec - Desentupidora em Maceió](https://demo-linotec.vercel.app/)"):
            self.assertIn(trecho, llms)

    def test_linha_de_comando_conferir(self):
        self.aplicar()
        with contextlib.redirect_stdout(io.StringIO()) as saida:
            self.assertEqual(self.s.main([str(self.pasta), "--conferir", "--url", self.url]), 0)
        self.assertIn("OK", saida.getvalue())
        (self.pasta / "index.html").write_text(
            (self.pasta / "index.html").read_text(encoding="utf-8").replace('"reviewCount": 46', '"reviewCount": 460'),
            encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()) as saida:
            self.assertEqual(self.s.main([str(self.pasta), "--conferir", "--url", self.url]), 1)
        self.assertIn("FALHA: diverge da fonte: $.@graph[0].aggregateRating.reviewCount", saida.getvalue())


class SeoNoGerador(unittest.TestCase):
    """O gerador com o seo-do-site instalado: instruções, palco do deploy e o runner que aplica quando o
    Claude publica sem ele."""

    def setUp(self):
        self.auto = Path(tempfile.mkdtemp(prefix="gerador-teste-"))
        self.addCleanup(shutil.rmtree, self.auto)
        self.m = carregar(self.auto)
        self.pasta = self.auto / "linotec"
        self.pasta.mkdir()
        (self.pasta / "content.md").write_text(CONTENT_SEO, encoding="utf-8")
        (self.pasta / "index.html").write_text(pagina_seo(), encoding="utf-8")
        self.m.LOGS.mkdir(exist_ok=True)
        self.log = self.m.LOGS / "x.log"
        self.palcos = []
        self.original = self.m.subprocess.run
        self.addCleanup(setattr, self.m.subprocess, "run", self.original)

        self.alias = "https://demo-linotec.vercel.app"

        class Saida:
            def __init__(self, alias):
                self.stdout, self.stderr, self.returncode = f"▲ Aliased         {alias}\n", "", 0

        def run(cmd, cwd=None, **k):
            if cmd[0] == sys.executable:  # o seo-do-site de verdade, sem rede (sem chave nem cache: sem Places)
                return self.original(cmd + ["--sem-rede"], cwd=cwd, **k)
            if "deploy" in cmd:
                self.palcos.append({n: Path(cwd, n).read_bytes() for n in sorted(os.listdir(cwd))})
            return Saida(self.alias)
        self.m.subprocess.run = run

    def instalar(self):
        self.m.SEO_DO_SITE = AQUI / "seo-do-site.py"

    def test_instrucoes_so_citam_o_seo_instalado(self):
        texto = self.m.instrucoes_da_execucao("linotec", Path("/tmp/gerador-x"))
        self.assertNotIn("seo-do-site", texto)
        self.assertNotIn("robots.txt /tmp", texto)
        self.instalar()
        texto = self.m.instrucoes_da_execucao("linotec", Path("/tmp/gerador-x"))
        self.assertIn(f"python3 {AQUI / 'seo-do-site.py'} {self.pasta} --url https://demo-linotec.vercel.app --exigir-faq", texto)
        for nome in ("robots.txt", "sitemap.xml", "llms.txt"):
            self.assertIn(f"cp {self.pasta}/{nome} {self.m.palco_do_deploy('linotec', Path('/tmp/gerador-x'))}/", texto)
        self.assertIn('data-fonte', texto)

    def test_deploy_do_runner_aplica_o_seo_e_leva_os_tres_arquivos(self):
        self.instalar()
        self.assertTrue(self.m.publicar_na_vercel(self.pasta, self.log))
        self.assertEqual(sorted(self.palcos[-1]), ["index.html", "llms.txt", "robots.txt", "sitemap.xml"])
        self.assertIn(b'id="dados-estruturados"', self.palcos[-1]["index.html"])

    def test_claude_publicou_sem_seo_o_runner_aplica_e_republica(self):
        self.instalar()
        (self.pasta / "publicado.json").write_text(json.dumps({"site_url": "https://demo-linotec.vercel.app"}))
        self.m.garantir_seo(self.pasta, self.log)
        self.assertEqual(len(self.palcos), 1)
        self.assertIn(b'id="dados-estruturados"', self.palcos[0]["index.html"])
        self.m.garantir_seo(self.pasta, self.log)  # já tem: nada de outro deploy
        self.assertEqual(len(self.palcos), 1)

    def test_vercel_corta_o_nome_canonical_e_og_image_seguem_o_endereco_real(self):
        """Bruno Gouveia, 29/10/2026: o projeto demo-<slug longo> ganhou o endereço curto, mas o canonical e o
        og:image escritos à mão ficaram no previsto (404) e o cartão do WhatsApp saiu sem imagem."""
        previsto, real = "https://demo-linotec.vercel.app", "https://demo-linotec-desentupidora.vercel.app"
        self.alias = real
        cabeca = (f'<link rel="canonical" href="{previsto}/">'
                  f'<meta property="og:url" content="{previsto}/">'
                  f'<meta property="og:image" content="{previsto}/og.jpg">'
                  f'<meta name="twitter:image" content="{previsto}/og.jpg">'
                  '<meta property="og:site_name" content="Linotec">')
        (self.pasta / "index.html").write_text(pagina_seo(cabeca=cabeca), encoding="utf-8")
        self.instalar()
        self.assertTrue(self.m.publicar_na_vercel(self.pasta, self.log))
        self.assertGreaterEqual(len(self.palcos), 2)  # o primeiro deploy e o que corrige
        html = self.palcos[-1]["index.html"].decode("utf-8")
        self.assertNotIn(previsto, html)
        for trecho in (f'<link rel="canonical" href="{real}/">', f'content="{real}/og.jpg"'):
            self.assertIn(trecho, html)
        self.assertEqual(html.count('<link rel="canonical"'), 1)
        self.assertIn('property="og:site_name" content="Linotec"', html)  # o resto do <head> fica como estava
        recibo = json.loads((self.pasta / "publicado.json").read_text(encoding="utf-8"))
        self.assertEqual(recibo["site_url"], real)

    def test_vercel_corta_o_nome_sem_seo_instalado_o_endereco_tambem_e_trocado(self):
        previsto, real = "https://demo-linotec.vercel.app", "https://demo-linotec-desentupidora.vercel.app"
        self.alias = real
        (self.pasta / "index.html").write_text(
            pagina_seo(cabeca=f'<meta property="og:image" content="{previsto}/og.jpg">'), encoding="utf-8")
        self.assertTrue(self.m.publicar_na_vercel(self.pasta, self.log))
        self.assertIn(f'content="{real}/og.jpg"'.encode(), self.palcos[-1]["index.html"])
        self.assertNotIn(previsto.encode(), self.palcos[-1]["index.html"])

    def test_endereco_previsto_mantido_nao_republica(self):
        self.instalar()
        self.assertTrue(self.m.publicar_na_vercel(self.pasta, self.log))
        self.assertEqual(len(self.palcos), 1)

    def test_sem_o_seo_instalado_nada_muda(self):
        self.assertTrue(self.m.publicar_na_vercel(self.pasta, self.log))
        self.assertEqual(sorted(self.palcos[-1]), ["index.html"])
        (self.pasta / "publicado.json").write_text(json.dumps({"site_url": "https://demo-linotec.vercel.app"}))
        self.m.garantir_seo(self.pasta, self.log)
        self.assertEqual(len(self.palcos), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
