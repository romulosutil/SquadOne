#!/usr/bin/env python3
"""Testes do socorro: a lista branca, os tetos (2 remédios e 1 Hermes por verificação a cada 6 h, 6 Hermes
por dia), a chave de desligar, a leitura da resposta do Hermes e o atendimento inteiro com dublês.
Nada roda systemctl, docker nem o Hermes; o relógio é fixo e o sono não dorme. As pastas de estado,
pedidos e a marca de desligado apontam para um temporário ANTES do import.

  python3 deploy/dell/socorro.test.py
"""
import atexit
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

_RAIZ = tempfile.mkdtemp(prefix="socorro-teste-")
atexit.register(shutil.rmtree, _RAIZ, True)
os.environ["SOCORRO_ESTADO"] = str(Path(_RAIZ) / "estado")
os.environ["SOCORRO_MARCA"] = str(Path(_RAIZ) / "config/desligado")
os.environ.pop("SOCORRO_DESLIGADO", None)

AQUI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("socorro", AQUI / "socorro.py")
so = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(so)

T0 = 1792170000.0  # 16/10/2026


def falha(cid, detalhe="x", nome=None):
    return {"id": cid, "estado": "falha", "nome": nome or cid, "detalhe": detalhe, "o_que_fazer": "Peça ao Claude."}


class ListaBranca(unittest.TestCase):
    def test_tabela_de_casos(self):
        casos = [
            (falha("hermes", "Gateway parado"), ["reiniciar:hermes-gateway"]),
            (falha("hermes", "Painel sem resposta: timed out"), ["reiniciar:hermes-dashboard"]),
            (falha("hermes-navegador", "CDP 9222 sem resposta"), ["reiniciar:hermes-google-browser"]),
            (falha("terminal", "Sem resposta"), ["reiniciar:code-server"]),
            (falha("n8n", "Sem resposta"), ["docker-reiniciar:n8n"]),
            (falha("container:licitacoes-automation-n8n-1", "Exited (1)"), ["docker-reiniciar:n8n"]),
            (falha("container:evolution-api-1", "Exited (137)"), ["docker-iniciar:evolution"]),
            (falha("whatsapp-sessao", "Bridge do WhatsApp sem resposta em :3000 (refused)"), ["reiniciar:hermes-gateway"]),
            (falha("whatsapp-sessao", "Bridge responde, mas a sessão está 'disconnected'"), []),  # QR, não remédio
            (falha("whatsapp-prumo", "O número do PRUMO caiu: a Evolution perdeu a conexão"), []),
            (falha("whatsapp-prumo", "unit(s) fora do ar: evolution-adaptador"), ["reiniciar:evolution-adaptador"]),
            (falha("whatsapp-prumo", "container(s) parado(s) ou ausente(s): evolution-redis-1; unit(s) fora do ar: "
                                     "evolution-adaptador, whatsapp-observador-prumo; o /saude do adaptador não respondeu"),
             ["docker-iniciar:evolution", "reiniciar:evolution-adaptador", "reiniciar:whatsapp-observador-prumo"]),
            (falha("container:outro-projeto-1", "Exited (1)"), []),  # projeto qualquer: só o Hermes olha
            (falha("fluxo:abc", "Falhou no nó X"), []),
            (falha("disco", "96% usado"), []),
            (falha("gerador", "sem login"), []),
            (falha("pncp", "Fonte do governo indisponível"), []),
            (falha("fila-avisos", "1 aviso recusado"), []),
        ]
        for c, esperado in casos:
            self.assertEqual(so.remedios_para(c), esperado, c)

    def test_todo_remedio_e_restart_ou_start_e_nada_mais(self):
        for nome, (cmd, descricao) in so.REMEDIOS.items():
            self.assertTrue(descricao)
            permitido = (cmd[:3] == ["systemctl", "--user", "restart"] and len(cmd) == 4
                         or cmd[:2] == ["docker", "restart"] and cmd[2:] == [so.N8N_CONTAINER]
                         or cmd[:2] == ["docker", "start"] and cmd[2:] == so.EVOLUTION_CONTAINERS)
            self.assertTrue(permitido, (nome, cmd))
        for c in [falha(i) for i in ("hermes", "n8n", "whatsapp-prumo", "terminal")]:
            for r in so.remedios_para(c):
                self.assertIn(r, so.REMEDIOS)

    def test_leitura_e_so_leitura(self):
        for cid in ("hermes", "n8n", "whatsapp-prumo", "container:evolution-api-1", "disco", "gerador", "fluxo:x",
                    "container:x;rm -rf ~"):
            for cmd in so.comandos_de_leitura({"id": cid}):
                self.assertIn(cmd[0], ("systemctl", "journalctl", "docker", "df"), cmd)
                if cmd[0] == "systemctl":
                    self.assertIn(cmd[2], ("status", "--failed"), cmd)
                if cmd[0] == "docker":
                    self.assertIn(cmd[1], ("ps", "logs"), cmd)
                self.assertFalse(any(";" in p for p in cmd), cmd)


class Tetos(unittest.TestCase):
    def test_dois_remedios_por_verificacao_a_cada_6h(self):
        e = {}
        self.assertTrue(so.pode_remediar(e, "n8n", T0))
        so.registrar(e, "remedios", "n8n", T0)
        so.registrar(e, "remedios", "n8n", T0 + 60)
        self.assertFalse(so.pode_remediar(e, "n8n", T0 + 120))
        self.assertTrue(so.pode_remediar(e, "terminal", T0 + 120))  # cada verificação tem o seu
        self.assertTrue(so.pode_remediar(e, "n8n", T0 + 6 * 3600 + 1))

    def test_um_hermes_por_verificacao_a_cada_6h_e_seis_por_dia(self):
        e = {}
        so.registrar(e, "hermes", "n8n", T0)
        so.registrar(e, "hermes_dia", None, T0)
        self.assertEqual(so.pode_hermes(e, "n8n", T0 + 60)[0], False)
        self.assertTrue(so.pode_hermes(e, "terminal", T0 + 60)[0])
        self.assertTrue(so.pode_hermes(e, "n8n", T0 + 6 * 3600 + 1)[0])
        for k in range(5):
            so.registrar(e, "hermes_dia", None, T0 + 100 + k)
        pode, motivo = so.pode_hermes(e, "terminal", T0 + 200)
        self.assertFalse(pode)
        self.assertIn("6", motivo)
        self.assertTrue(so.pode_hermes(e, "terminal", T0 + 86400 + 200)[0])

    def test_podar_guarda_so_as_ultimas_24h(self):
        e = {}
        so.registrar(e, "remedios", "n8n", T0 - 2 * 86400)
        so.registrar(e, "remedios", "terminal", T0 - 60)
        so.registrar(e, "hermes_dia", None, T0 - 2 * 86400)
        p = so.podar(e, T0)
        self.assertEqual(p, {"hermes_dia": [], "remedios": {"terminal": [T0 - 60]}, "hermes": {}})

    def test_chave_de_desligar(self):
        marca = Path(_RAIZ) / "marca-de-teste"
        self.assertFalse(so.desligado({}, marca))
        self.assertTrue(so.desligado({"SOCORRO_DESLIGADO": "1"}, marca))
        self.assertFalse(so.desligado({"SOCORRO_DESLIGADO": "0"}, marca))
        marca.write_text("")
        self.addCleanup(marca.unlink)
        self.assertTrue(so.desligado({}, marca))


class RespostaDoHermes(unittest.TestCase):
    def test_json_com_remedio_da_lista(self):
        texto = 'Segue:\n{"checks": [{"id": "n8n", "diagnostico": "Container travado.", "remedio": "docker-reiniciar:n8n", ' \
                '"pedido_para_o_claude": ""}]}\n'
        self.assertEqual(so.ler_resposta(texto, ["n8n"]),
                         {"n8n": {"diagnostico": "Container travado.", "remedio": "docker-reiniciar:n8n", "pedido": ""}})

    def test_remedio_fora_da_lista_nunca_vale(self):
        for rem in ("rm -rf ~", "systemctl --user stop n8n", "reiniciar:qualquer", "nenhum", ""):
            r = so.ler_resposta(json.dumps({"checks": [{"id": "n8n", "diagnostico": "d", "remedio": rem}]}), ["n8n"])
            self.assertIsNone(r["n8n"]["remedio"], rem)

    def test_id_que_nao_foi_pedido_e_ignorado_e_texto_solto_vira_diagnostico(self):
        r = so.ler_resposta(json.dumps({"checks": [{"id": "outro", "remedio": "reiniciar:code-server"}]}), ["n8n"])
        self.assertEqual(r, {})  # JSON sem a verificação pedida: nada (e nunca o remédio do outro id)
        solto = so.ler_resposta("O n8n caiu por falta de memória.", ["n8n"])
        self.assertEqual(solto, {"n8n": {"diagnostico": "O n8n caiu por falta de memória.", "remedio": None, "pedido": ""}})
        self.assertEqual(so.ler_resposta(None, ["n8n"]), {})

    def test_mascara_telefone_e_token_mas_nao_data(self):
        t = so.mascarar("2026-10-16T12:00:01 lead 5527999887766 e (27) 99976-2786; apikey=abc123 "
                        "token ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789; em 16/10/2026 às 12:00; ip 172.28.77.1")
        for vazou in ("5527999887766", "99976-2786", "abc123", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"):
            self.assertNotIn(vazou, t)
        for fica in ("2026-10-16T12:00:01", "16/10/2026", "172.28.77.1"):
            self.assertIn(fica, t)

    def test_o_prompt_traz_a_lista_branca_e_as_regras(self):
        p = so.montar_prompt([{"check": falha("n8n", "Sem resposta"), "tentou": [("docker-reiniciar:n8n", True)], "pulou": ""}],
                             "leitura")
        for trecho in ("docker-reiniciar:n8n", "Você NÃO executa nada", "Claude Code", "Responda SÓ com um objeto JSON",
                       "Nunca mande mensagem"):
            self.assertIn(trecho, p)


class Atendimento(unittest.TestCase):
    """O atendimento inteiro com dublês: rodar, reconferir, Hermes e aviso."""

    def setUp(self):
        self.agora = T0
        self.comandos, self.avisos, self.prompts, self.dormidas = [], [], [], []
        self.retratos = []  # o que cada reconferência devolve, em ordem
        self.resposta_do_hermes = None
        self.desligar = False

    def rodar(self, cmd, tempo):
        self.comandos.append(cmd)
        return 0, "ok"

    def reconferir(self):
        r = self.retratos.pop(0) if self.retratos else {}
        return r

    def hermes(self, prompt):
        self.prompts.append(prompt)
        return self.resposta_do_hermes

    def novo(self, estado=None):
        return so.Socorro(rodar=self.rodar, reconferir=self.reconferir, hermes=self.hermes,
                          avisar=lambda *a: self.avisos.append(a), relogio=lambda: self.agora,
                          dormir=self.dormidas.append, estado=estado if estado is not None else {},
                          esta_desligado=lambda: self.desligar)

    def remedios_rodados(self):
        return [c for c in self.comandos if c[0] in ("systemctl", "docker") and c[1] in ("--user", "restart", "start")
                and ("restart" in c or "start" in c)]

    def test_voltou_sozinho_na_espera_nao_faz_nada(self):
        self.retratos = [{"n8n": {"id": "n8n", "estado": "ok"}}]
        r = self.novo().atender([falha("n8n", "Sem resposta")])
        self.assertEqual((self.comandos, self.avisos, self.prompts), ([], [], []))
        self.assertEqual(self.dormidas, [so.ESPERA_INICIAL_S])
        self.assertIsNone(r["aviso"])

    def test_remedio_resolve_e_avisa_resolvido_sem_hermes(self):
        self.retratos = [{"n8n": falha("n8n", "Sem resposta")}, {"n8n": {"id": "n8n", "estado": "ok"}}]
        estado = {}
        self.novo(estado).atender([falha("n8n", "Sem resposta")])
        self.assertEqual(self.remedios_rodados(), [["docker", "restart", so.N8N_CONTAINER]])
        self.assertEqual(self.prompts, [])
        (titulo, texto, prioridade), = self.avisos
        self.assertIn("resolvido sozinho, reiniciei o container do n8n", texto)
        self.assertEqual(prioridade, 2)
        self.assertEqual(len(estado["remedios"]["n8n"]), 1)

    def test_remedio_nao_resolve_e_o_hermes_diagnostica(self):
        f = falha("terminal", "Sem resposta")
        self.retratos = [{"terminal": f}, {"terminal": f}]
        self.resposta_do_hermes = json.dumps({"checks": [{"id": "terminal", "diagnostico": "Porta 8080 ocupada.",
                                                          "remedio": "reiniciar:code-server",  # já tentado: não repete
                                                          "pedido_para_o_claude": "o code-server não sobe: porta 8080"}]})
        estado = {}
        self.novo(estado).atender([f])
        self.assertEqual(self.remedios_rodados(), [["systemctl", "--user", "restart", "code-server.service"]])
        self.assertEqual(len(self.prompts), 1)
        self.assertIn("journalctl", self.prompts[0])  # a leitura foi junto
        (_, texto, prioridade), = self.avisos
        self.assertIn("continua fora", texto)
        self.assertIn("Tentei: religuei o code-server, sem efeito", texto)
        self.assertIn("Hermes: Porta 8080 ocupada.", texto)
        self.assertIn('Peça ao Claude: "o code-server não sobe: porta 8080"', texto)
        self.assertEqual(prioridade, 1)
        self.assertEqual(len(estado["hermes"]["terminal"]), 1)
        self.assertEqual(len(estado["hermes_dia"]), 1)

    def test_sem_remedio_o_hermes_pode_escolher_um_da_lista_e_ele_resolve(self):
        f = falha("units", "Caiu: whatsapp-observador.service")
        self.retratos = [{"units": f}, {"units": {"id": "units", "estado": "ok"}}]
        self.resposta_do_hermes = json.dumps({"checks": [{"id": "units", "diagnostico": "O observador morreu.",
                                                          "remedio": "reiniciar:whatsapp-observador"}]})
        self.novo().atender([f])
        self.assertEqual(self.remedios_rodados(), [["systemctl", "--user", "restart", "whatsapp-observador.service"]])
        (_, texto, _), = self.avisos
        self.assertIn("resolvido sozinho, religuei o observador do WhatsApp (remédio escolhido pelo Hermes)", texto)

    def test_hermes_pede_comando_fora_da_lista_e_nada_roda(self):
        f = falha("fluxo:abc", "Falhou no nó Planilha", nome="08 · CRM")
        self.retratos = [{"fluxo:abc": f}]
        self.resposta_do_hermes = json.dumps({"checks": [{"id": "fluxo:abc", "diagnostico": "Credencial do Google expirou.",
                                                          "remedio": "docker compose down", "pedido_para_o_claude": "reconectar"}]})
        self.novo().atender([f])
        self.assertEqual(self.remedios_rodados(), [])
        (_, texto, _), = self.avisos
        self.assertIn("08 · CRM: continua fora", texto)
        self.assertIn('Peça ao Claude: "reconectar"', texto)

    def test_tetos_seguram_remedio_e_hermes(self):
        f = falha("n8n", "Sem resposta")
        estado = {}
        for k in range(2):
            so.registrar(estado, "remedios", "n8n", T0 - 100 - k)
        so.registrar(estado, "hermes", "n8n", T0 - 100)
        self.retratos = [{"n8n": f}]
        self.novo(estado).atender([f])
        self.assertEqual(self.remedios_rodados(), [])
        self.assertEqual(self.prompts, [])
        (_, texto, _), = self.avisos
        self.assertIn("Remédio já usado 2 vezes nas últimas 6 h", texto)
        self.assertIn("Sem diagnóstico do Hermes (o Hermes já olhou esta falha nas últimas 6 h)", texto)
        self.assertIn("O que fazer: Peça ao Claude.", texto)

    def test_seis_hermes_por_dia_no_total(self):
        estado = {"hermes_dia": [T0 - 1000 - k for k in range(6)]}
        f = falha("gerador", "sem login")
        self.retratos = [{"gerador": f}]
        self.novo(estado).atender([f])
        self.assertEqual(self.prompts, [])
        self.assertIn("teto de 6 diagnósticos", self.avisos[0][1])

    def test_varias_falhas_viram_uma_chamada_so_ao_hermes(self):
        a, b = falha("gerador", "sem login"), falha("pncp", "fora")
        self.retratos = [{"gerador": a, "pncp": b}]
        self.resposta_do_hermes = "{}"
        estado = {}
        self.novo(estado).atender([a, b, dict(a)])  # repetido no pedido conta uma vez
        self.assertEqual(len(self.prompts), 1)
        self.assertEqual(len(estado["hermes_dia"]), 1)
        self.assertEqual(set(estado["hermes"]), {"gerador", "pncp"})
        self.assertEqual(self.avisos[0][1].count("continua fora"), 2)

    def test_hermes_sem_resposta_ainda_avisa(self):
        f = falha("gerador", "sem login")
        self.retratos = [{"gerador": f}]
        self.resposta_do_hermes = None
        self.novo().atender([f])
        self.assertIn("o Hermes não respondeu a tempo", self.avisos[0][1])

    def test_reconferencia_que_falha_conta_como_ainda_fora(self):
        f = falha("terminal", "Sem resposta")
        s = self.novo()
        s.reconferir = lambda: None
        self.resposta_do_hermes = None
        s.atender([f])
        self.assertEqual(self.remedios_rodados(), [["systemctl", "--user", "restart", "code-server.service"]])
        self.assertIn("continua fora", self.avisos[0][1])

    def test_desligado_nao_faz_nada(self):
        self.desligar = True
        r = self.novo().atender([falha("n8n", "Sem resposta")])
        self.assertEqual((self.comandos, self.avisos, self.prompts, self.dormidas), ([], [], [], []))
        self.assertEqual(r["itens"], [])

    def test_aviso_nao_leva_telefone(self):
        f = falha("whatsapp-prumo", "O número do PRUMO caiu")
        self.retratos = [{"whatsapp-prumo": f}]
        self.resposta_do_hermes = json.dumps({"checks": [{"id": "whatsapp-prumo",
                                                          "diagnostico": "O chip 5527999762786 deslogou.",
                                                          "pedido_para_o_claude": "parear de novo o 27 99976-2786"}]})
        self.novo().atender([f])
        texto = self.avisos[0][1]
        self.assertNotIn("5527999762786", texto)
        self.assertNotIn("99976-2786", texto)
        self.assertEqual(self.remedios_rodados(), [])  # número caído: QR, nunca remédio


class Pedidos(unittest.TestCase):
    """A pasta de pedidos que o dell-status grava e o socorro.service esvazia."""

    def setUp(self):
        shutil.rmtree(so.PEDIDOS, ignore_errors=True)
        so.PEDIDOS.mkdir(parents=True)

    def test_le_apaga_e_junta(self):
        (so.PEDIDOS / "pedido-1.json").write_text(json.dumps({"checks": [falha("n8n")]}))
        (so.PEDIDOS / "pedido-2.json").write_text(json.dumps({"checks": [falha("terminal")]}))
        (so.PEDIDOS / "lixo.json").write_text("não é json")
        (so.PEDIDOS / "sobra.tmp").write_text("x")
        checks = so.tirar_pedidos()
        self.assertEqual([c["id"] for c in checks], ["n8n", "terminal"])
        self.assertEqual(list(so.PEDIDOS.iterdir()), [])  # vazia: o path unit não sobe de novo

    def test_desligado_descarta_sem_agir(self):
        (so.PEDIDOS / "pedido-1.json").write_text(json.dumps({"checks": [falha("n8n")]}))
        marca = so.MARCA_DESLIGADO
        marca.parent.mkdir(parents=True, exist_ok=True)
        marca.write_text("")
        self.addCleanup(marca.unlink)
        chamou = []
        antes = so.Socorro
        so.Socorro = lambda *a, **k: chamou.append(1)
        self.addCleanup(setattr, so, "Socorro", antes)
        self.assertEqual(so.processar(), 0)
        self.assertEqual(chamou, [])
        self.assertEqual(list(so.PEDIDOS.iterdir()), [])

    def test_o_estado_e_o_temporario_do_teste(self):
        self.assertTrue(str(so.ESTADO).startswith(_RAIZ))
        self.assertTrue(str(so.MARCA_DESLIGADO).startswith(_RAIZ))


@unittest.skipIf(so.fcntl is None, "o dell-status só importa no Linux (fcntl)")
class AvisoPeloTelegram(unittest.TestCase):
    """16/10/2026 (OT-14): o aviso do socorro sai pelo bot do Telegram, não pelo WhatsApp de vendas. Ponta a
    ponta: `avisar_pela_fila` grava com a lib de verdade numa fila temporária e o dell-status do repo a drena,
    com o bot e o Hermes como dublês (nada sai da máquina)."""

    def setUp(self):
        from unittest import mock
        self.mock = mock
        self.fila = Path(_RAIZ) / "fila-telegram"
        shutil.rmtree(self.fila, ignore_errors=True)
        self.fila.mkdir(parents=True)
        p = mock.patch.object(so, "FILA_DE_AVISOS", self.fila)
        p.start()
        self.addCleanup(p.stop)
        spec = importlib.util.spec_from_file_location("dell_status_do_socorro", AQUI / "dell-status.py")
        ds = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ds)
        estado = Path(_RAIZ) / "fila-telegram-estado"
        shutil.rmtree(estado, ignore_errors=True)
        ds.FILA, ds.FILA_TRAVA, ds.FILA_ESTADO = self.fila, estado / "fila.lock", estado / "fila.json"
        ds.FILA_RECUSADOS, ds.FRESCOR_S = estado / "recusados", 0
        self.ds = ds
        self.telegram, self.whatsapp = [], []
        self.bot_no_ar = True
        ds.enviar_telegram = lambda m, silencioso: self.bot_no_ar and (self.telegram.append((m, silencioso)) or True)
        ds.enviar = lambda m: self.whatsapp.append(m) or True

    def aviso_de_falha(self):
        itens = [{"check": falha("n8n", "Sem resposta", "n8n"), "tentou": [("docker-reiniciar:n8n", True)],
                  "resolvido": False, "pulou": "", "hermes": None, "sem_hermes": "o Hermes não respondeu a tempo"}]
        titulo, texto, prioridade = so.montar_aviso(itens, T0)
        self.assertTrue(so.avisar_pela_fila(titulo, texto, prioridade))
        self.assertEqual(len(list(self.fila.glob("socorro-*.json"))), 1)

    def test_vai_pelo_telegram_e_nao_pelo_whatsapp(self):
        self.aviso_de_falha()
        quando = self.ds.datetime(2026, 10, 16, 15, 0, tzinfo=self.ds.FUSO_BR)
        r = self.ds.drenar_fila(quando)
        self.assertEqual((r["pelo_telegram"], r["enviados"]), (1, 0))
        ((texto, silencioso),) = self.telegram
        self.assertTrue(texto.startswith("🛟 Socorro do Dell\n• n8n: continua fora"))
        self.assertFalse(silencioso)
        self.assertEqual(self.whatsapp, [])
        self.assertEqual(list(self.fila.glob("*.json")), [])

    def test_de_noite_sem_som(self):
        self.aviso_de_falha()
        self.ds.drenar_fila(self.ds.datetime(2026, 10, 16, 23, 30, tzinfo=self.ds.FUSO_BR))
        self.assertTrue(self.telegram[0][1])
        self.assertEqual(self.whatsapp, [])

    def test_bot_fora_cai_no_whatsapp(self):
        self.aviso_de_falha()
        self.bot_no_ar = False
        r = self.ds.drenar_fila(self.ds.datetime(2026, 10, 16, 15, 0, tzinfo=self.ds.FUSO_BR))
        self.assertEqual((r["pelo_telegram"], r["enviados"]), (0, 1))
        self.assertTrue(self.whatsapp[0].startswith("🛟 Socorro do Dell"))

    def test_a_origem_e_a_que_o_dell_status_manda_pelo_telegram(self):
        self.assertIn(so.ORIGEM_DO_AVISO, self.ds.ORIGENS_PELO_TELEGRAM)


if __name__ == "__main__":
    unittest.main(verbosity=2)
