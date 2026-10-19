#!/usr/bin/env python3
"""Testes do que o backup-dell ganhou para o bloco da Estrutura: remote e
lixeira por bloco, `incluir`, `janela` e `preparo`. E, o mais importante, que o
bloco ANTIGO (sem nada disso) se comporta como antes. Tudo com `rodar` falso e
numa pasta de estado temporária: não chama rclone e não toca o status.json do Dell.

  python3 deploy/dell/backup/backup-dell.test.py
"""
import argparse
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("backup_dell", AQUI / "backup-dell.py")
bd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bd)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_backup_dell", AQUI.parent / "dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — o dell-status não carrega fora do Dell
    ds = None

GERAL = {"remoto": "gdrive", "lixeira": "PRUMO/_lixeira", "lixeira_dias": 30, "banda": "off"}


def ok(out="", err=""):
    return SimpleNamespace(returncode=0, stdout=out, stderr=err)


def falha(rc=1, err="deu ruim"):
    return SimpleNamespace(returncode=rc, stdout="", stderr=err)


class Helpers(unittest.TestCase):
    def test_no_remoto(self):
        self.assertEqual(bd.no_remoto("gdrive", "PRUMO/Sites antes da venda"), "gdrive:PRUMO/Sites antes da venda")
        self.assertEqual(bd.no_remoto("gdrive-estrutura", ""), "gdrive-estrutura:")          # raiz do remote
        self.assertEqual(bd.no_remoto("gdrive-estrutura", "", "LEIA-ME.txt"), "gdrive-estrutura:LEIA-ME.txt")
        self.assertEqual(bd.no_remoto("r", "/_lixeira/", "estrutura", "2026-10-04T04"), "r:_lixeira/estrutura/2026-10-04T04")

    def test_remoto_e_lixeira_do_bloco_com_padrao_do_geral(self):
        antigo = {"id": "sites", "destino": "PRUMO/Sites"}
        novo = {"id": "estrutura", "destino": "", "remoto": "gdrive-estrutura", "lixeira": "_lixeira"}
        self.assertEqual((bd.remoto_do(GERAL, antigo), bd.lixeira_do(GERAL, antigo)), ("gdrive", "PRUMO/_lixeira"))
        self.assertEqual((bd.remoto_do(GERAL, novo), bd.lixeira_do(GERAL, novo)), ("gdrive-estrutura", "_lixeira"))

    def test_filtros_sem_incluir_ficam_como_antes(self):
        self.assertEqual(bd.filtros({"excluir": ["/.logs/**"]}), ["--exclude", "/LEIA-ME.txt", "--exclude", "/.logs/**"])

    def test_filtros_com_incluir_usam_filter_ordenado(self):
        f = bd.filtros({"incluir": ["/dell/**", "/pc/**"], "excluir": ["*.parcial"]})
        regras = [f[i + 1] for i, x in enumerate(f) if x == "--filter"]
        # o LEIA-ME vem primeiro (o que o rclone escreve fica fora do sync, nem copiado nem apagado),
        # depois os excluir, depois os incluir, e por fim "tudo o mais fora"
        self.assertEqual(regras, ["- /LEIA-ME.txt", "- *.parcial", "+ /dell/**", "+ /pc/**", "- **"])
        self.assertNotIn("--include", f)      # misturar --include e --exclude tem ordem indefinida no rclone
        self.assertNotIn("--exclude", f)

    def test_janela(self):
        h = lambda x: dt.datetime(2026, 10, 4, int(x[:2]), int(x[3:]))
        self.assertTrue(bd.dentro_da_janela(None, h("15:00")))
        self.assertTrue(bd.dentro_da_janela(["04:00", "06:00"], h("04:05")))
        self.assertFalse(bd.dentro_da_janela(["04:00", "06:00"], h("15:05")))
        self.assertTrue(bd.dentro_da_janela(["23:00", "02:00"], h("23:30")))   # atravessa a meia-noite
        self.assertTrue(bd.dentro_da_janela(["23:00", "02:00"], h("01:00")))
        self.assertFalse(bd.dentro_da_janela(["23:00", "02:00"], h("12:00")))


class Espelho(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        self.estado, self.estado_antigo, self.status_antigo = self.d / "estado", bd.ESTADO, bd.STATUS
        bd.ESTADO, bd.STATUS = self.estado, self.estado / "status.json"
        self.rodar_antigo = bd.rodar
        self.cmds = []
        self.respostas = {}        # prefixo do comando -> resposta
        bd.rodar = self.falso
        self.origem = self.d / "origem"
        (self.origem / "dell").mkdir(parents=True)
        (self.origem / "dell/MANIFESTO.md").write_text("manifesto")
        self.a = argparse.Namespace(forcar=False, dry_run=False, sem_limite=False)

    def tearDown(self):
        bd.rodar, bd.ESTADO, bd.STATUS = self.rodar_antigo, self.estado_antigo, self.status_antigo
        shutil.rmtree(self.d, ignore_errors=True)

    def falso(self, cmd, env=None, timeout=None, **kw):
        self.cmds.append(list(cmd))
        for prefixo, r in self.respostas.items():
            if " ".join(cmd).startswith(prefixo):
                return r
        return ok("2026/10/04 NOTICE: Transferred: 3 / 3, 100%")

    def sync(self):
        return [c for c in self.cmds if c[:2] == ["rclone", "sync"]]

    def bloco_estrutura(self, **extra):
        f = {"id": "estrutura", "nome": "Estrutura", "origem": str(self.origem), "destino": "",
             "remoto": "gdrive-estrutura", "lixeira": "_lixeira", "incluir": ["/dell/**", "/pc/**"],
             "intervalo_h": 24, "atencao_h": 30, "falha_h": 72, "sentinela": "dell/MANIFESTO.md", "max_apagar": 40}
        f.update(extra)
        return f

    def estado_de(self, fid):
        return json.loads((self.estado / "status.json").read_text())["fontes"][fid]

    def test_bloco_novo_sincroniza_no_remote_dele_com_lixeira_propria(self):
        self.assertTrue(bd.espelho_uma(GERAL, self.bloco_estrutura(), self.a))
        cmd = self.sync()[0]
        self.assertEqual(cmd[3], "gdrive-estrutura:")
        i = cmd.index("--backup-dir")
        self.assertRegex(cmd[i + 1], r"^gdrive-estrutura:_lixeira/estrutura/\d{4}-\d\d-\d\dT\d\d$")
        self.assertEqual(cmd[cmd.index("--max-delete") + 1], "40")
        regras = [cmd[i + 1] for i, x in enumerate(cmd) if x == "--filter"]
        self.assertEqual(regras, ["- /LEIA-ME.txt", "+ /dell/**", "+ /pc/**", "- **"])
        self.assertEqual(self.estado_de("estrutura")["estado"], "ok")
        self.assertEqual(self.estado_de("estrutura")["destino"], "(raiz)")

    def test_bloco_antigo_continua_igual(self):
        antigo = {"id": "sites", "nome": "Sites", "origem": str(self.origem), "destino": "PRUMO/Sites antes da venda",
                  "sentinela": "dell/MANIFESTO.md", "intervalo_h": 1, "max_apagar": 500}
        self.assertTrue(bd.espelho_uma(GERAL, antigo, self.a))
        cmd = self.sync()[0]
        self.assertEqual(cmd[3], "gdrive:PRUMO/Sites antes da venda")
        self.assertRegex(cmd[cmd.index("--backup-dir") + 1], r"^gdrive:PRUMO/_lixeira/sites/")
        self.assertNotIn("--include", cmd)
        self.assertNotIn("--filter", cmd)     # o bloco antigo segue com --exclude, igual a antes
        self.assertEqual(cmd[cmd.index("--max-delete") + 1], "500")

    def test_fora_da_janela_nao_roda_e_no_forcar_roda(self):
        f = self.bloco_estrutura(janela=["04:00", "06:00"])
        agora_antigo = bd.agora
        bd.agora = lambda: dt.datetime(2026, 10, 4, 15, 5).astimezone()
        try:
            self.assertTrue(bd.espelho_uma(GERAL, f, self.a))
            self.assertEqual(self.sync(), [])
            self.a.forcar = True
            self.assertTrue(bd.espelho_uma(GERAL, f, self.a))
            self.assertEqual(len(self.sync()), 1)
        finally:
            bd.agora = agora_antigo

    def test_preparo_roda_antes_do_sync(self):
        f = self.bloco_estrutura(preparo=["systemctl --user start estrutura-coletar.service"])
        self.assertTrue(bd.espelho_uma(GERAL, f, self.a))
        nomes = [c[0] for c in self.cmds]
        self.assertLess(nomes.index("systemctl"), nomes.index("rclone"))
        self.assertEqual(self.cmds[0], ["systemctl", "--user", "start", "estrutura-coletar.service"])

    def test_preparo_que_falha_nao_sincroniza_e_vira_falha(self):
        self.respostas["systemctl"] = falha(1, "FALHOU: valor conhecido ou padrão de segredo em: dell/x")
        f = self.bloco_estrutura(preparo=["systemctl --user start estrutura-coletar.service"])
        self.assertFalse(bd.espelho_uma(GERAL, f, self.a))
        self.assertEqual(self.sync(), [])
        st = self.estado_de("estrutura")
        self.assertEqual(st["estado"], "falha")
        self.assertIn("Preparo falhou", st["detalhe"])
        self.assertIn("FALHOU", st["detalhe"])

    def test_sentinela_ausente_para_antes_do_sync(self):
        (self.origem / "dell/MANIFESTO.md").unlink()
        self.assertFalse(bd.espelho_uma(GERAL, self.bloco_estrutura(), self.a))
        self.assertEqual(self.sync(), [])
        self.assertIn("não sincronizei", self.estado_de("estrutura")["detalhe"])

    def test_intervalo_ainda_nao_venceu(self):
        bd.registrar("estrutura", ultimo_sucesso=bd.iso(bd.agora()))
        self.assertTrue(bd.espelho_uma(GERAL, self.bloco_estrutura(), self.a))
        self.assertEqual(self.cmds, [])

    def test_leia_me_e_lixeira_usam_o_remote_do_bloco(self):
        f = self.bloco_estrutura(leia_me="Espelho da Estrutura.")
        bd.espelho_uma(GERAL, f, self.a)
        rcat = [c for c in self.cmds if c[:2] == ["rclone", "rcat"]][0]
        self.assertEqual(rcat[2], "gdrive-estrutura:LEIA-ME.txt")           # sem barra sobrando na raiz
        lsf = [c for c in self.cmds if c[:2] == ["rclone", "lsf"]][0]
        self.assertEqual(lsf[-1], "gdrive-estrutura:_lixeira/estrutura")

    def test_verificar_espelho_usa_filtros_e_remote_do_bloco(self):
        bd.verificar_espelho(GERAL, self.bloco_estrutura())
        chk = [c for c in self.cmds if c[:2] == ["rclone", "check"]][0]
        self.assertEqual(chk[3], "gdrive-estrutura:")
        self.assertIn("--filter", chk)


class AvisoPelaLib(unittest.TestCase):
    """O avisar() pela lib de aviso (11/10/2026): o dell-status aceita o que ela grava;
    sem a lib nada vai à fila (uma linha no stderr); e a fila ausente ou estragada
    nunca muda o resultado do ensaio nem o código de saída. Nada aqui toca a fila, o estado ou o HOME reais."""

    TITULO = "🗄️ Backup do Dell"
    TEXTOS = [
        "Ensaio de restauração ok: 2 banco(s) com tabelas, 9 tabelas e 120 linhas; n8n sobe e decifra as credenciais.",
        "O ensaio de restauração falhou: restore: Fatal: unable to open repo. O cofre existe, mas não provei que ele refaz o Dell.",
        "aspas \"duplas\", barra \\ e acento: ação, coração",
        "duas\nlinhas e emoji 🌐",
    ]

    def setUp(self):
        self.d = Path(tempfile.mkdtemp(prefix="backup-dell-teste-"))
        self.addCleanup(shutil.rmtree, self.d, ignore_errors=True)
        nomes = ("FILA_AVISOS", "PASTAS_DA_LIB", "ESTADO", "STATUS", "TRAVA", "_ensaio", "lib_de_aviso")
        antes = {k: getattr(bd, k) for k in nomes}
        self.addCleanup(lambda: [setattr(bd, k, v) for k, v in antes.items()])
        bd.FILA_AVISOS = self.d / "fila"
        bd.ESTADO, bd.STATUS, bd.TRAVA = self.d / "estado", self.d / "estado" / "status.json", self.d / "estado" / "trava"
        self.lib_do_repo = list(antes["PASTAS_DA_LIB"])
        self.sem_aviso = os.environ.pop("BACKUP_DELL_SEM_AVISO", None)
        self.addCleanup(lambda: os.environ.__setitem__("BACKUP_DELL_SEM_AVISO", self.sem_aviso) if self.sem_aviso else None)

    def fila(self):
        return sorted(bd.FILA_AVISOS.glob("*.json")) if bd.FILA_AVISOS.is_dir() else []

    def avisar(self, titulo, texto):
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(saida):
            bd.avisar(titulo, texto)
        return saida.getvalue()

    def gravado_pela_lib(self, titulo, texto):
        shutil.rmtree(bd.FILA_AVISOS, ignore_errors=True)
        bd.FILA_AVISOS.mkdir()
        bd.PASTAS_DA_LIB = self.lib_do_repo
        self.avisar(titulo, texto)
        arquivos = self.fila()
        self.assertEqual(len(arquivos), 1, arquivos)
        return arquivos[0].read_bytes()

    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(bd.lib_de_aviso().__file__).resolve(), (AQUI.parent / "lib/aviso.py").resolve())

    def test_aviso_gravado_le_de_volta_igual(self):
        for titulo in (self.TITULO, "outro título"):
            for texto in self.TEXTOS:
                with self.subTest(titulo=titulo, texto=texto[:30]):
                    d = json.loads(self.gravado_pela_lib(titulo, texto).decode("utf-8"))
                    self.assertEqual(d, {"titulo": titulo, "texto": texto, "origem": "backup-dell"})

    def test_conteudo_fixado(self):
        esperado = '{"titulo": "🗄️ Backup do Dell", "texto": "Ensaio de restauração ok: x.", "origem": "backup-dell"}'
        self.assertEqual(self.gravado_pela_lib(self.TITULO, "Ensaio de restauração ok: x."), esperado.encode("utf-8"))

    def test_aviso_de_ensaio_que_falhou_leva_chave_e_validade(self):
        # A chave (24 h) impede um aviso por dia enquanto o ensaio falhar; o dell-status tem de aceitar o formato.
        bd.FILA_AVISOS.mkdir()
        bd.PASTAS_DA_LIB = self.lib_do_repo
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(saida):
            bd.avisar(self.TITULO, "O ensaio de restauração falhou: x.", chave="backup-dell:ensaio-falhou",
                      expira_em=bd.iso(bd.agora() + bd.dt.timedelta(hours=20)))
        dados = json.loads(self.fila()[0].read_text(encoding="utf-8"))
        self.assertEqual(dados["chave"], "backup-dell:ensaio-falhou")
        self.assertIn("expira_em", dados)
        self.assertEqual(set(dados), {"titulo", "texto", "origem", "chave", "expira_em"})

    def test_nome_e_atomicidade(self):
        bd.FILA_AVISOS.mkdir()
        self.avisar(self.TITULO, "x")
        self.assertRegex(self.fila()[0].name, r"^backup-dell-\d+-[0-9a-f]{6}\.json$")
        self.assertEqual([p for p in bd.FILA_AVISOS.iterdir() if not p.name.endswith(".json")], [])

    def test_dois_avisos_seguidos_nao_se_sobrescrevem(self):
        bd.FILA_AVISOS.mkdir()
        for i in range(5):
            self.avisar(self.TITULO, f"aviso {i}")
        self.assertEqual(len(self.fila()), 5)

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        bd.FILA_AVISOS.mkdir()
        for texto in self.TEXTOS:
            self.avisar(self.TITULO, texto)
        self.assertEqual(len(self.fila()), len(self.TEXTOS))
        for arq in self.fila():
            ds.validar_aviso(json.loads(arq.read_text(encoding="utf-8")))

    def test_com_a_lib_a_fila_ausente_nao_e_criada_e_nao_levanta(self):
        saida = self.avisar(self.TITULO, "x")
        self.assertFalse(bd.FILA_AVISOS.exists())
        self.assertIn("fila_ausente", saida)

    def test_backup_dell_sem_aviso_nao_grava(self):
        bd.FILA_AVISOS.mkdir()
        for jeito in ("lib", "sem-lib"):  # a trava vem antes de qualquer gravação, com ou sem a lib
            bd.PASTAS_DA_LIB = self.lib_do_repo if jeito == "lib" else [self.d / "sem-lib"]
            os.environ["BACKUP_DELL_SEM_AVISO"] = "1"
            try:
                saida = self.avisar(self.TITULO, "Ensaio ok")
            finally:
                os.environ.pop("BACKUP_DELL_SEM_AVISO", None)
            with self.subTest(jeito=jeito):
                self.assertEqual(self.fila(), [])
                self.assertIn("(aviso suprimido)", saida)

    def test_valor_em_reais_na_excecao_nao_perde_o_aviso(self):
        bd.FILA_AVISOS.mkdir()
        self.avisar(self.TITULO, "O ensaio de restauração falhou: custo de R$ 12,50 estourou. O cofre existe.")
        d = json.loads(self.fila()[0].read_text(encoding="utf-8"))
        self.assertNotRegex(d["texto"], r"R\s*\$")
        self.assertIn("[valor]", d["texto"])
        self.assertIn("O cofre existe.", d["texto"])

    def test_texto_sem_valor_nao_e_mexido(self):
        bd.FILA_AVISOS.mkdir()
        self.avisar(self.TITULO, "  dois  espaços  ")
        self.assertEqual(json.loads(self.fila()[0].read_text(encoding="utf-8"))["texto"], "  dois  espaços  ")

    def sem_gravar(self, saida):
        self.assertIn("lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: " + self.TITULO, saida)
        self.assertFalse(bd.FILA_AVISOS.exists(), "sem a lib nada é criado nem gravado na fila")

    def test_sem_copia_registra_no_stderr_e_nao_grava(self):
        bd.PASTAS_DA_LIB = [self.d / "sem-lib"]
        self.assertIsNone(bd.lib_de_aviso())
        self.sem_gravar(self.avisar(self.TITULO, "x"))

    def test_copia_quebrada_nao_grava_e_cai_na_seguinte(self):
        quebrada = self.d / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("def x(:\n", encoding="utf-8")
        bd.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(bd.lib_de_aviso())
        self.sem_gravar(self.avisar(self.TITULO, "x"))
        bd.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(bd.lib_de_aviso().__file__).resolve(), (AQUI.parent / "lib/aviso.py").resolve())

    # --- o aviso nunca muda o resultado do ensaio nem o código de saída -------

    def ensaio(self, resultado):
        """Roda ensaio() com o _ensaio dublê (devolve texto ou levanta)."""
        def falso(c):
            if isinstance(resultado, Exception):
                raise resultado
            return resultado
        bd._ensaio = falso
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(saida):
            return bd.ensaio({"cofre": {}}, argparse.Namespace())

    def estado_do_ensaio(self):
        return json.loads(bd.STATUS.read_text(encoding="utf-8"))["fontes"]["ensaio"]["estado"]

    def test_ensaio_ok_com_a_fila_ausente_continua_0(self):
        self.assertEqual(self.ensaio("det"), 0)
        self.assertEqual(self.estado_do_ensaio(), "ok")
        self.assertFalse(bd.FILA_AVISOS.exists())

    def test_ensaio_que_falha_com_a_fila_ausente_continua_1(self):
        self.assertEqual(self.ensaio(RuntimeError("restore: Fatal")), 1)
        self.assertEqual(self.estado_do_ensaio(), "falha")

    def test_ensaio_com_a_fila_estragada_nao_muda_o_codigo_de_saida(self):
        # A "fila" é um arquivo: a lib não consegue gravar (e sem a lib nada é gravado).
        bd.FILA_AVISOS.write_text("não sou pasta", encoding="utf-8")
        for jeito in ("lib", "sem-lib"):
            bd.PASTAS_DA_LIB = self.lib_do_repo if jeito == "lib" else [self.d / "sem-lib"]
            with self.subTest(jeito=jeito):
                self.assertEqual(self.ensaio("det"), 0)
                self.assertEqual(self.estado_do_ensaio(), "ok")
                self.assertEqual(self.ensaio(RuntimeError("x")), 1)
                self.assertEqual(self.estado_do_ensaio(), "falha")

    def test_ensaio_com_a_lib_que_levanta_nao_muda_o_codigo_de_saida(self):
        class LibRuim:
            VALOR_EM_REAIS = re.compile("R[$]")

            @staticmethod
            def gravar(*a, **k):
                raise OSError("disco cheio")

        bd.lib_de_aviso = lambda: LibRuim
        self.assertEqual(self.ensaio("det"), 0)
        self.assertEqual(self.ensaio(RuntimeError("x")), 1)

    def test_ensaio_grava_os_dois_avisos_pela_lib(self):
        bd.FILA_AVISOS.mkdir()
        self.assertEqual(self.ensaio("det"), 0)
        self.assertEqual(self.ensaio(RuntimeError("restore: Fatal")), 1)
        textos = [json.loads(p.read_text(encoding="utf-8"))["texto"] for p in self.fila()]
        self.assertEqual(len(textos), 2)
        self.assertIn("Ensaio de restauração ok: det.", textos)
        self.assertTrue(any(t.startswith("O ensaio de restauração falhou: restore: Fatal.") for t in textos))


class Preparo(unittest.TestCase):
    """Os dumps dos bancos Docker (06/10/2026) e o do n8n como era."""

    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d, ignore_errors=True)
        self.rodar_antigo = bd.rodar
        self.addCleanup(setattr, bd, "rodar", self.rodar_antigo)

    def test_n8n_continua_pg_dump_de_um_banco_com_usuario_do_env(self):
        env = self.d / ".env"
        env.write_text("POSTGRES_USER=n8nuser\nPOSTGRES_PASSWORD=segredo\n")
        cmd, fim = bd.comando_do_dump({"tipo": "postgres", "nome": "n8n", "compose": "/c.yml", "servico": "db",
                                       "banco": "n8n", "env": str(env)})
        self.assertEqual(cmd[-7:], ["pg_dump", "-U", "n8nuser", "-d", "n8n", "--no-owner", "--no-privileges"])
        self.assertEqual(fim, "PostgreSQL database dump complete")
        self.assertNotIn("segredo", " ".join(cmd))

    def test_postgres_sem_banco_e_o_cluster_inteiro(self):
        cmd, fim = bd.comando_do_dump({"tipo": "postgres", "nome": "iris-pg", "compose": "/i.yml", "servico": "postgres"})
        self.assertEqual(cmd[:7], ["docker", "compose", "-f", "/i.yml", "exec", "-T", "postgres"])
        self.assertIn("pg_dumpall", cmd[-1])
        self.assertEqual(fim, "PostgreSQL database cluster dump complete")

    def test_mysql_sem_bancos_de_sistema_e_senha_so_dentro_do_container(self):
        cmd, fim = bd.comando_do_dump({"tipo": "mysql", "nome": "espectro-mysql", "compose": "/e.yml", "servico": "mysql"})
        script = cmd[-1]
        self.assertIn('MYSQL_PWD="$MYSQL_ROOT_PASSWORD"', script)
        self.assertIn("grep -Ev \"^(mysql|sys|information_schema|performance_schema)$\"", script)
        self.assertIn("--single-transaction", script)
        self.assertEqual(fim, "-- Dump completed")

    def test_todo_banco_e_critico_e_pasta_so_quando_pedido(self):
        self.assertTrue(bd.eh_critico({"tipo": "postgres"}))
        self.assertTrue(bd.eh_critico({"tipo": "mysql"}))
        self.assertFalse(bd.eh_critico({"tipo": "pasta-do-container"}))
        self.assertTrue(bd.eh_critico({"tipo": "pasta-do-container", "critico": True}))
        self.assertFalse(bd.eh_critico({"tipo": "sqlite"}))

    def test_pasta_com_imagem_roda_tar_num_container_descartavel_so_leitura(self):
        bd.rodar = lambda cmd, **kw: ok("abc123\n") if cmd[-3:] == ["ps", "-q", "minio"] else falha()
        cmd = bd.comando_da_pasta({"tipo": "pasta-do-container", "compose": "/i.yml", "servico": "minio",
                                   "pasta": "/data", "imagem": "postgres:17-alpine"})
        self.assertEqual(cmd[:8], ["docker", "run", "--rm", "--network", "none", "--volumes-from", "abc123:ro",
                                   "--entrypoint"])
        self.assertEqual(cmd[8:], ["tar", "postgres:17-alpine", "-C", "/data", "-cf", "-", "."])
        sem = bd.comando_da_pasta({"compose": "/c.yml", "servico": "n8n", "pasta": "/home/node/.n8n",
                                   "excluir": ["crash.journal"]})
        self.assertEqual(sem[-8:], ["tar", "-C", "/home/node/.n8n", "--exclude", "crash.journal", "-cf", "-", "."])

    def test_pasta_com_imagem_e_servico_parado_falha(self):
        bd.rodar = lambda cmd, **kw: ok("")
        with self.assertRaisesRegex(RuntimeError, "não está rodando"):
            bd.comando_da_pasta({"compose": "/i.yml", "servico": "minio", "pasta": "/data", "imagem": "x"})

    def test_fim_do_arquivo_aceita_bytes_que_nao_sao_utf8(self):
        f = self.d / "dump.sql"
        f.write_bytes(b"\xff\xfe" * 1000 + b"\n-- Dump completed on 2026-10-06\n")
        self.assertIn("-- Dump completed", bd.fim_do_arquivo(f))

    def test_carga_do_dumpall_aceita_so_o_papel_e_o_banco_que_ja_existem(self):
        stderr = ('psql:/ensaio/dump.sql:9: ERROR:  role "iris" already exists\n'
                  'psql:/ensaio/dump.sql:80: ERROR:  database "postgres" already exists\n')
        self.assertEqual(bd.erros_da_carga(stderr), [])
        ruim = stderr + 'psql:/ensaio/dump.sql:62: ERROR:  permission denied to grant privileges as role "iris"\n'
        self.assertEqual(len(bd.erros_da_carga(ruim)), 1)
        self.assertIn("permission denied", bd.erros_da_carga(ruim)[0])

    def test_comparar_contagens(self):
        vivo = {"iris:public.a": 3, "iris_542:public.b": 0}
        self.assertIn("2 banco(s) com tabelas, 2 tabelas e 3 linhas", bd.comparar_contagens(vivo, dict(vivo)))
        with self.assertRaisesRegex(RuntimeError, "1 tabela"):
            bd.comparar_contagens(vivo, {"iris:public.a": 2, "iris_542:public.b": 0})
        with self.assertRaisesRegex(RuntimeError, "nenhuma tabela"):
            bd.comparar_contagens({}, {})

    def test_manifesto_versionado_tem_um_dump_por_banco_docker(self):
        m = bd.ler_manifesto(AQUI / "fontes.toml")
        preparo = {p["nome"]: p for p in m["cofre"]["preparo"]}
        # aladdin-pg, iris-minio e espectro-mysql saíram em 11/10/2026: os containers
        # foram parados por ociosos (dumps finais em ~/Arquivo/2026-10-11-containers-parados).
        for nome in ("n8n", "crm-silmer-pg", "p4f-db", "iris-pg"):
            self.assertIn(nome, preparo)
            self.assertTrue(bd.eh_critico(preparo[nome]) or nome == "n8n-home", nome)
        for nome in ("aladdin-pg", "iris-minio", "espectro-mysql"):
            self.assertNotIn(nome, preparo, nome)
        # O ensaio mensal acha o dump do n8n pelo banco, não "o primeiro postgres".
        n8n = [p for p in preparo.values() if p["tipo"] == "postgres" and p.get("banco") == "n8n"]
        self.assertEqual([p["nome"] for p in n8n], ["n8n"])


if __name__ == "__main__":
    unittest.main()
