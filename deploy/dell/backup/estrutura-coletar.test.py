#!/usr/bin/env python3
"""Testes do estrutura-coletar: o filtro de segredos (com casos positivos E
negativos), a prova contra vazamento e a montagem da área de preparo. Todo
"segredo" aqui é FALSO e montado em tempo de execução, para o repositório nunca
conter nada com cara de segredo. Tudo numa home temporária e com `rodar` falso.

  python3 deploy/dell/backup/estrutura-coletar.test.py
"""
import importlib.util
import json
import secrets
import shutil
import stat
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("estrutura_coletar", AQUI / "estrutura-coletar.py")
ec = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ec)

# Falsos, montados por pedaços.
GHP = "gh" + "p_" + "A1b2C3d4" * 5
AKIA = "AK" + "IA" + "ABCDEFGHIJKLMNOP"
JWT = "ey" + "J" + "a" * 12 + "." + "b" * 12 + "." + "c" * 8
CHAVE_PRIVADA = "-----BEGIN " + "OPENSSH PRIVATE" + " KEY-----\nbase64\n-----END OPENSSH PRIVATE KEY-----"
AGE = "AGE-SECRET" + "-KEY-1" + "Q" * 40
SENHA_DB = "s3nh4-Forte-9X"
ID_CHAT_FALSO = "999888777666555@lid"


class Filtro(unittest.TestCase):
    def r(self, texto, modo="estrito"):
        novo, regras, excluir = ec.redigir(texto, modo)
        return novo, dict(regras), excluir

    # ---- o que tem de ser escondido
    def test_chave_valor_nos_formatos_do_compose(self):
        t = f"environment:\n  POSTGRES_PASSWORD: {SENHA_DB}\n  - MYSQL_ROOT_PASSWORD=outra-Senha-1\n  REDIS_PASSWORD: \"{SENHA_DB}\"\n"
        novo, regras, _ = self.r(t)
        self.assertNotIn(SENHA_DB, novo)
        self.assertNotIn("outra-Senha-1", novo)
        self.assertEqual(regras["chave-valor"], 3)
        self.assertIn("POSTGRES_PASSWORD: <oculto>", novo)        # o nome da chave fica: é o que ajuda a restaurar
        self.assertIn("MYSQL_ROOT_PASSWORD=<oculto>", novo)

    def test_json_e_toml(self):
        novo, _, _ = self.r('{"password": "abc12345", "apiKey": "zzz999"}\nclient_secret = "valor-secreto-1"\n')
        for v in ("abc12345", "zzz999", "valor-secreto-1"):
            self.assertNotIn(v, novo)

    def test_padrao_literal_do_compose(self):
        novo, regras, _ = self.r("password: ${DB_PASS:-hunter2x}\nfoo: ${OUTRA:-/caminho/ok}\n")
        self.assertNotIn("hunter2x", novo)
        self.assertIn("${OUTRA:-/caminho/ok}", novo)

    def test_url_com_senha_mantem_usuario_e_host(self):
        novo, regras, _ = self.r("postgres://app:segredo123@db.interno:5432/n8n")
        self.assertEqual(novo, "postgres://app:<oculto>@db.interno:5432/n8n")

    def test_authorization_bearer_e_prefixos_conhecidos(self):
        novo, _, _ = self.r(f"Authorization: Bearer abcdef1234567890xyz\nx={GHP}\ny={AKIA}\nz={JWT}\n")
        for v in ("abcdef1234567890xyz", GHP, AKIA, JWT):
            self.assertNotIn(v, novo)

    def test_flag_de_linha_de_comando(self):
        novo, _, _ = self.r("command: redis-server --requirepass minhaSenha77 --appendonly yes")
        self.assertNotIn("minhaSenha77", novo)
        self.assertIn("--appendonly yes", novo)

    def test_chave_privada_exclui_o_arquivo(self):
        for conteudo in (CHAVE_PRIVADA, "id: " + AGE):
            novo, regras, excluir = self.r(conteudo)
            self.assertTrue(excluir)
            self.assertIsNone(novo)

    def test_alta_entropia_no_modo_estrito(self):
        aleatoria = secrets.token_urlsafe(40)
        novo, regras, _ = self.r(f"valor {aleatoria} fim")
        self.assertNotIn(aleatoria, novo)
        self.assertEqual(regras, {"alta-entropia": 1})

    # ---- o que NÃO pode ser mutilado (falsos positivos que já me custaram caro)
    def test_referencias_e_caminhos_ficam(self):
        t = ("POSTGRES_PASSWORD: ${DB_PASSWORD}\n- TOKEN=$TOKEN\npassword_file: /run/secrets/db\n"
             'senha = "~/.config/backup-dell/restic-senha"\nTOKEN_FILE=/home/x/.token\nsecret: true\n')
        novo, regras, _ = self.r(t)
        self.assertEqual(novo, t)
        self.assertEqual(regras, {})

    def test_nomes_que_so_parecem_segredo(self):
        t = '"credentials": {"id": "1"}\n"maxOutputTokens": 8192\n"passo": "primeiro"\n"tokenUrl": "https://x/token"\n"nodeCredentialType": "googleOAuth"\n'
        novo, regras, _ = self.r(t)
        self.assertEqual(novo, t)
        self.assertEqual(regras, {})

    def test_expressao_do_n8n_e_template_js(self):
        t = '{"accessToken": "={{ $env.TOKEN }}", "code": "const x = `${i-1}`;"}'
        novo, regras, _ = self.r(t, "n8n")
        self.assertEqual(novo, t)

    def test_hash_uuid_e_caminho_nao_sao_entropia(self):
        t = ("image: sha256:" + "a1b2c3d4" * 8 + "\nid: 123e4567-e89b-12d3-a456-426614174000\n"
             "/home/romulo-sutil-corr-a/licitacoes-automation/docker-compose.yml\n"
             "Environment=RCLONE_CONFIG=/home/romulo-sutil-corr-a/.config/rclone/rclone.conf\n")
        novo, regras, _ = self.r(t)
        self.assertEqual(novo, t)

    def test_modo_docs_nao_mutila_prosa(self):
        t = "PasswordAuthentication no\nO token do gh fica no chaveiro.\nsenha: nunca no Git\n"
        novo, regras, _ = self.r(t, "docs")
        self.assertEqual(novo, t)
        # mas o inequívoco vale também na prosa:
        novo2, _, _ = self.r(f"colei {GHP} sem querer", "docs")
        self.assertNotIn(GHP, novo2)

    def test_prosa_que_cita_o_nome_do_padrao_nao_e_excluida(self):
        t = "Se começar com `-----BEGIN`, é chave privada. Padrões: AGE-SECRET-KEY-, ghp_, sk-, AKIA."
        novo, regras, excluir = self.r(t, "docs")
        self.assertFalse(excluir)
        self.assertEqual(novo, t)

    def test_n8n_nao_usa_entropia(self):
        id_planilha = "1" + secrets.token_urlsafe(32)[:43]
        novo, regras, _ = self.r(f'{{"value": "{id_planilha}"}}', "n8n")
        self.assertIn(id_planilha, novo)

    def test_oculto_nao_e_redigido_de_novo(self):
        t = "POSTGRES_PASSWORD: <oculto>\n"
        self.assertEqual(self.r(t), (t, {}, False))


class Montagem(unittest.TestCase):
    def setUp(self):
        self.h = Path(tempfile.mkdtemp())
        h = self.h
        (h / "PRUMO").mkdir()
        for n in ("MANIFESTO", "LEIA-ME", "PROJETOS", "SILMER", "PC-COMECAR", "PROMPT-MEL"):
            (h / f"PRUMO/{n}.md").write_text(f"# {n}\nPasswordAuthentication no\n")
        (h / "AGENTS.md").write_text("# regras\n")
        (h / "Arquivo/2026-10-04").mkdir(parents=True)
        (h / "Arquivo/2026-10-04/mel-progresso.md").write_text("# progresso\n")
        (h / ".config/systemd/user").mkdir(parents=True)
        (h / ".config/systemd/user/a.service").write_text("[Service]\nExecStart=/usr/bin/true\n")
        (h / ".config/systemd/user/a.service.bak-2026-10-04").write_text("velho\n")
        (h / ".config/backup-dell").mkdir(parents=True)
        (h / ".config/backup-dell/fontes.toml").write_text('[geral]\nremoto = "gdrive"\n')
        (h / "workspace/infra-docker/aladdin").mkdir(parents=True)
        (h / "workspace/infra-docker/aladdin/docker-compose.yml").write_text(f"environment:\n  POSTGRES_PASSWORD: {SENHA_DB}\n")
        (h / "workspace/infra-docker/aladdin/.env").write_text(f"POSTGRES_PASSWORD={SENHA_DB}\n")
        (h / ".hermes/cron").mkdir(parents=True)
        (h / ".hermes/cron/jobs.json").write_text(json.dumps({"jobs": [
            {"name": "Graphify", "schedule_display": "0 3 * * *", "script": "g.py", "enabled": True, "deliver": "whatsapp",
             "prompt": "NUNCA-DEVE-APARECER"},
            {"name": "Aprender", "schedule_display": "weekdays at 9am", "enabled": False,
             "deliver": f"whatsapp:{ID_CHAT_FALSO}"}]}))
        (h / "SquadOne/deploy/hermes").mkdir(parents=True)
        (h / "SquadOne/deploy/hermes/projetos.toml").write_text(
            '[[projeto]]\nnome="SquadOne"\ncaminho="~/SquadOne"\nrepositorio="o/SquadOne"\ntipo="clone-vivo"\n'
            '[[projeto]]\nnome="area"\ncaminho="~/Mel/Repos"\nrepositorio="o/*"\ntipo="espelho"\n')
        self.raiz = h / ".local/share/mel/estrutura"
        self.raiz.mkdir(parents=True)
        self.n8n = [{"id": "w1", "name": "Fluxo bom", "nodes": []},
                    {"id": "w2", "name": "Fluxo com token", "nodes": [{"parameters": {"headers": "Authorization: Bearer " + "x" * 24}}]}]
        self.comandos = []
        self.ctx = ec.Contexto(home=h, raiz=self.raiz, registro=h / "SquadOne/deploy/hermes/projetos.toml",
                               rodar=self.falso, agora=lambda: datetime(2026, 10, 4, 4, 0))

    def tearDown(self):
        shutil.rmtree(self.h, ignore_errors=True)

    def falso(self, cmd, timeout=0, cwd=None):
        self.comandos.append(list(cmd))
        if cmd[:2] == ["gh", "repo"]:
            return 0, json.dumps([{"name": "a", "visibility": "PRIVATE", "isArchived": False, "isFork": False, "pushedAt": "2026-10-04T10:00:00Z", "diskUsage": 2048}]), ""
        if "export:workflow" in cmd:
            return 0, "Acquiring database migration lock...\n" + json.dumps(self.n8n), ""
        if cmd[0] == "git":
            return (0, "main\n", "") if "rev-parse" in cmd else (0, "origin\thttps://github.com/o/SquadOne.git (fetch)\n", "")
        return 0, f"saída de {cmd[0]}\n", ""

    def coletar(self, **kw):
        return ec.coletar(self.ctx, **kw)

    def texto_de_tudo(self):
        return "\n".join(p.read_text() for p in self.raiz.rglob("*") if p.is_file())

    def test_monta_a_area_de_preparo(self):
        rel, destinos = self.coletar()
        for d in ("dell/MANIFESTO.md", "dell/AGENTS.md", "dell/PROJETOS.md", "dell/SILMER.md", "dell/PC-COMECAR.md",
                  "dell/arquivo/2026-10-04/mel-progresso.md", "dell/systemd-user/a.service", "dell/backup-dell/fontes.toml",
                  "dell/compose/aladdin.yml", "dell/repos.md", "dell/hermes-cron.md", "dell/COLETA.md",
                  "dell/estado/tailscale-status.txt", "dell/estado/ufw.txt", "dell/n8n/fluxo-bom-w1.json"):
            self.assertTrue((self.raiz / d).is_file(), d)
        self.assertFalse((self.raiz / "dell/systemd-user/a.service.bak-2026-10-04").exists())   # .bak fica de fora
        self.assertFalse((self.raiz / ".novo").exists())

    def test_senha_do_compose_nao_aparece_em_lugar_nenhum(self):
        self.coletar()
        self.assertNotIn(SENHA_DB, self.texto_de_tudo())
        self.assertIn("POSTGRES_PASSWORD: <oculto>", (self.raiz / "dell/compose/aladdin.yml").read_text())

    def test_env_nunca_entra(self):
        self.coletar()
        nomes = [p.name for p in self.raiz.rglob("*") if p.is_file()]
        self.assertFalse([n for n in nomes if n.startswith(".env")])

    def test_prompts_do_hermes_ficam_de_fora(self):
        self.coletar()
        self.assertNotIn("NUNCA-DEVE-APARECER", self.texto_de_tudo())
        self.assertIn("Graphify", (self.raiz / "dell/hermes-cron.md").read_text())

    def test_entrega_do_cron_mostra_so_a_plataforma_nao_o_id_do_chat(self):
        self.coletar()
        tabela = (self.raiz / "dell/hermes-cron.md").read_text()
        self.assertNotIn(ID_CHAT_FALSO, self.texto_de_tudo())
        linha = next(l for l in tabela.splitlines() if "Aprender" in l)
        self.assertTrue(linha.rstrip().endswith("| não | whatsapp |"), linha)

    def test_fluxo_do_n8n_com_segredo_e_excluido_e_listado(self):
        rel, _ = self.coletar()
        self.assertTrue((self.raiz / "dell/n8n/fluxo-bom-w1.json").exists())
        self.assertFalse(list((self.raiz / "dell/n8n").glob("*w2.json")))
        self.assertIn("dell/n8n/fluxo-com-token-w2.json", rel.excluidos)
        self.assertIn("fluxo-com-token-w2.json", (self.raiz / "dell/COLETA.md").read_text())
        self.assertNotIn("x" * 24, self.texto_de_tudo())

    def test_relatorio_lista_arquivos_e_regras_nunca_valores(self):
        self.coletar()
        coleta = (self.raiz / "dell/COLETA.md").read_text()
        self.assertIn("dell/compose/aladdin.yml", coleta)
        self.assertIn("chave-valor", coleta)
        self.assertNotIn(SENHA_DB, coleta)

    def test_permissoes(self):
        self.coletar()
        for p in (self.raiz / "dell").rglob("*"):
            modo = stat.S_IMODE(p.stat().st_mode)
            self.assertEqual(modo, 0o700 if p.is_dir() else 0o600, p)

    def test_prova_final_pega_valor_conhecido_que_o_filtro_nao_pegou(self):
        # Um segredo curto-e-comum que NENHUMA regra reconhece, colado numa doc: só a prova com o .env acusa.
        (self.h / ".hermes/.env").write_text("OUTRA_API_KEY=valor-longo-do-env-9\n")
        (self.h / "PRUMO/MANIFESTO.md").write_text("# m\nlembrete: valor-longo-do-env-9 serve para tudo\n")
        with self.assertRaises(ec.Vazamento) as e:
            self.coletar()
        self.assertIn("dell/MANIFESTO.md", str(e.exception))
        self.assertNotIn("valor-longo-do-env-9", str(e.exception))     # a mensagem diz onde, nunca o quê

    def test_prova_final_confere_tambem_valor_de_chave_sem_cara_de_segredo(self):
        # WHATSAPP_HOME_CHANNEL não tem "token/senha" no nome, mas é do .env: não pode ir ao Drive.
        (self.h / ".hermes/.env").write_text("WHATSAPP_HOME_CHANNEL=555444333222111@lid\n")
        (self.h / "PRUMO/MANIFESTO.md").write_text("# m\ncanal de entrega: 555444333222111@lid\n")
        with self.assertRaises(ec.Vazamento) as e:
            self.coletar()
        self.assertIn("dell/MANIFESTO.md", str(e.exception))
        self.assertNotIn("555444333222111", str(e.exception))

    def test_url_pura_de_um_env_nao_derruba_a_coleta(self):
        # URL sem credencial é informação que os documentos citam de propósito; só URL com @ é segredo.
        (self.h / ".hermes/.env").write_text("PUBLIC_URL=https://mel.exemplo.ts.net:8443\n")
        (self.h / "PRUMO/MANIFESTO.md").write_text("# m\nabra https://mel.exemplo.ts.net:8443\n")
        self.coletar()
        self.assertIn("mel.exemplo.ts.net", (self.raiz / "dell/MANIFESTO.md").read_text())

    def test_falha_nao_toca_na_area_anterior(self):
        self.coletar()
        antes = (self.raiz / "dell/MANIFESTO.md").read_text()
        (self.h / ".hermes/.env").write_text("X_TOKEN=valor-longo-do-env-9\n")
        (self.h / "PRUMO/MANIFESTO.md").write_text("vazou valor-longo-do-env-9\n")
        with self.assertRaises(ec.Vazamento):
            self.coletar()
        self.assertEqual((self.raiz / "dell/MANIFESTO.md").read_text(), antes)
        self.assertFalse((self.raiz / ".novo").exists() and any((self.raiz / ".novo").rglob("*")))

    def test_sem_manifesto_nao_ha_coleta(self):
        (self.h / "PRUMO/MANIFESTO.md").unlink()
        with self.assertRaises(RuntimeError):
            self.coletar()

    def test_valor_redigido_em_um_arquivo_nao_pode_sobrar_em_outro(self):
        (self.h / "PRUMO/PROJETOS.md").write_text(f"# p\nusa a senha {SENHA_DB} do banco\n")
        with self.assertRaises(ec.Vazamento):      # a senha foi redigida no compose; no doc ela é achada pela prova
            self.coletar()

    def test_pc_so_o_que_e_texto_e_nunca_chave_privada(self):
        base = self.raiz / "pc-incoming/latest"
        base.mkdir(parents=True)
        (base / "ssh-config").write_text("Host mel\n  HostName x\n")
        (base / "id_ed25519").write_text("coisa")
        (base / "known_hosts").write_text("x")
        (base / "perfil.ps1").write_text(f"$x = '{CHAVE_PRIVADA}'\n")
        (base / "binario.bin").write_bytes(b"\xff\xfe\x00\x01")
        rel, _ = self.coletar()
        self.assertTrue((self.raiz / "pc/ssh-config").exists())
        for sumiu in ("id_ed25519", "known_hosts", "perfil.ps1", "binario.bin"):
            self.assertFalse((self.raiz / "pc" / sumiu).exists(), sumiu)
            self.assertIn(f"pc/{sumiu}", rel.excluidos)

    def test_pc_anterior_fica_se_o_pc_nao_mandou_nada(self):
        base = self.raiz / "pc-incoming/latest"
        base.mkdir(parents=True)
        (base / "a.txt").write_text("1")
        self.coletar()
        shutil.rmtree(self.raiz / "pc-incoming/latest")
        self.coletar()
        self.assertTrue((self.raiz / "pc/a.txt").exists())

    def test_seco_nao_escreve_nada(self):
        self.coletar(escrever=False)
        self.assertFalse((self.raiz / "dell").exists())

    def test_comando_que_falha_vira_aviso_e_nao_derruba(self):
        original = self.falso
        self.ctx.rodar = lambda cmd, timeout=0, cwd=None: (1, "", "sem sudo") if cmd[0] == "sudo" else original(cmd, timeout, cwd)
        rel, destinos = self.coletar()
        self.assertTrue(any("ufw.txt" in a for a in rel.avisos))
        self.assertNotIn("dell/estado/ufw.txt", destinos)


if __name__ == "__main__":
    unittest.main()
