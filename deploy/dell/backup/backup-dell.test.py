#!/usr/bin/env python3
"""Testes do que o backup-dell ganhou para o bloco da Estrutura: remote e
lixeira por bloco, `incluir`, `janela` e `preparo`. E, o mais importante, que o
bloco ANTIGO (sem nada disso) se comporta como antes. Tudo com `rodar` falso e
numa pasta de estado temporária: não chama rclone e não toca o status.json do Dell.

  python3 deploy/dell/backup/backup-dell.test.py
"""
import argparse
import datetime as dt
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("backup_dell", AQUI / "backup-dell.py")
bd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bd)

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
