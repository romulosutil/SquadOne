#!/usr/bin/env python3
"""Testes do dell-status para o que não depende de serviço vivo: o avaliador
de cron, as rotinas do Hermes, o gerador de sites, o rascunho do Mapa, os fluxos do n8n (pela
agenda de cada um), as filas, o backup, os arquivos instalados, os timers, as units que caíram, os religamentos do
healthwatch, a ausência do Syncthing, as rotinas caladas, o tamanho do cache, o "o que fazer" de cada alerta
o canal das falhas (Telegram, WhatsApp de reserva), os prazos do monitor, a internet, as units paradas e a Central atualizada. Tudo em pasta temporária, com relógio fixo; nada é gravado no Dell
nem enviado pelo Hermes ou pelo bot: o operations.env de verdade nunca é lido (aponta para um arquivo que não
existe e as variáveis do bot saem do ambiente), então o Telegram fica "desligado" fora da classe que o testa.

  python3 deploy/dell/dell-status.test.py
"""
import contextlib
import importlib.util
import inspect
import io
import json
import os
import shutil
import subprocess
import tempfile
import types
import unittest
from unittest import mock
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
BR = timezone(timedelta(hours=-3))
spec = importlib.util.spec_from_file_location("dell_status", AQUI / "dell-status.py")
ds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ds)
ds.OPERATIONS_ENV = Path(tempfile.gettempdir()) / "dell-status-teste" / "sem-operations.env"
for _v in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_IDS", "SQUADONE_LEMBRETES_PELO_TELEGRAM"):
    os.environ.pop(_v, None)


def br(texto: str) -> datetime:
    return datetime.fromisoformat(texto).replace(tzinfo=BR)


class Cron(unittest.TestCase):
    def test_diario(self):
        self.assertEqual(ds.ultimo_disparo("0 9 * * *", br("2026-09-29T19:40")), br("2026-09-29T09:00"))
        self.assertEqual(ds.ultimo_disparo("0 9 * * *", br("2026-09-29T08:59")), br("2026-09-28T09:00"))
        self.assertEqual(ds.ultimo_disparo("0 9 * * *", br("2026-09-29T09:00")), br("2026-09-29T09:00"))

    def test_dia_da_semana(self):
        # 29/09/2026 é terça; "1" = segunda, "0" e "7" = domingo.
        self.assertEqual(ds.ultimo_disparo("30 8 * * 1", br("2026-09-29T12:00")), br("2026-09-28T08:30"))
        self.assertEqual(ds.ultimo_disparo("0 9 * * 1-5", br("2026-10-04T12:00")), br("2026-10-02T09:00"))
        self.assertEqual(ds.ultimo_disparo("0 9 * * 7", br("2026-09-29T12:00")), br("2026-09-27T09:00"))

    def test_passos_listas_e_macros(self):
        self.assertEqual(ds.ultimo_disparo("*/15 * * * *", br("2026-09-29T10:44")), br("2026-09-29T10:30"))
        self.assertEqual(ds.ultimo_disparo("0 8,20 * * *", br("2026-09-29T19:00")), br("2026-09-29T08:00"))
        self.assertEqual(ds.ultimo_disparo("@daily", br("2026-09-29T10:00")), br("2026-09-29T00:00"))

    def test_dia_do_mes_ou_da_semana(self):
        # Os dois restritos: vale qualquer um (dia 1 OU segunda).
        self.assertEqual(ds.ultimo_disparo("0 0 1 * 1", br("2026-09-30T12:00")), br("2026-09-28T00:00"))
        self.assertEqual(ds.ultimo_disparo("0 0 1 * 1", br("2026-10-01T12:00")), br("2026-10-01T00:00"))

    def test_expressao_nao_suportada(self):
        with self.assertRaises(ValueError):
            ds.ultimo_disparo("0 9 * * MON", br("2026-09-29T12:00"))
        with self.assertRaises(ValueError):
            ds.ultimo_disparo("0 25 * * *", br("2026-09-29T12:00"))


def job(id_, expr=None, minutos=None, last_run=None, **extra):
    agenda = {"kind": "cron", "expr": expr} if expr else {"kind": "interval", "minutes": minutos}
    return {"id": id_, "name": id_, "schedule": agenda, "enabled": True, "state": "scheduled",
            "created_at": "2026-09-17T00:00:00-03:00", "last_run_at": last_run, "last_status": "ok", **extra}


class Rotinas(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="dell-status-teste-"))
        self.addCleanup(shutil.rmtree, self.dir)
        ds.CRON_JOBS = self.dir / "jobs.json"
        ds.AGENDAS = self.dir / "agendas.json"
        ds.ligado_desde = lambda: None  # o Dell ligado o tempo todo
        self.agora(br("2026-09-29T19:40"))

    def agora(self, t):
        ds.agora = lambda: t.astimezone(timezone.utc)

    def rodar(self, *jobs):
        ds.CRON_JOBS.write_text(json.dumps({"jobs": list(jobs)}))
        return {c["id"]: c for c in ds.crons_hermes()}

    def test_briefing_que_nao_rodou_vira_falha(self):
        r = self.rodar(job("asmr", "0 9 * * *", last_run="2026-09-28T09:07:09-03:00",
                           last_dispatch={"scheduled_at": "2026-09-29T09:00:00-03:00"}),
                       job("radar", "0 8 * * *", last_run="2026-09-29T08:00:55-03:00"))
        self.assertEqual(r["cron:asmr"]["estado"], "falha")
        self.assertIn("09:00 de 29/09", r["cron:asmr"]["detalhe"])
        self.assertEqual(r["cron:radar"]["estado"], "ok")

    def test_folga_de_30_min(self):
        self.agora(br("2026-09-29T09:20"))
        r = self.rodar(job("asmr", "0 9 * * *", last_run="2026-09-28T09:07:09-03:00"))
        self.assertEqual(r["cron:asmr"]["estado"], "ok")

    def test_pausada_fica_de_fora(self):
        r = self.rodar(job("velha", "0 9 * * 1-5", last_run="2026-09-23T09:04:25-03:00",
                           enabled=False, state="paused"))
        self.assertEqual(r, {})

    def test_horario_mudado_antes_da_primeira_leitura(self):
        # Briefing movido de 08:00 para 10:00 hoje: não cobra o 10:00 de hoje.
        r = self.rodar(job("site", "0 10 * * *", last_run="2026-09-29T08:00:42-03:00",
                           last_dispatch={"scheduled_at": "2026-09-29T08:00:00-03:00"}))
        self.assertEqual(r["cron:site"]["estado"], "ok")

    def test_horario_mudado_depois(self):
        self.agora(br("2026-09-29T09:00"))
        self.rodar(job("site", "0 8 * * *", last_run="2026-09-29T08:00:42-03:00"))
        ds.AGENDAS.write_text(json.dumps(ds.agendas_vistas))
        self.agora(br("2026-09-29T19:40"))
        r = self.rodar(job("site", "0 10 * * *", last_run="2026-09-29T08:00:42-03:00"))
        self.assertEqual(r["cron:site"]["estado"], "ok")
        # No dia seguinte o horário novo já é cobrado.
        ds.AGENDAS.write_text(json.dumps(ds.agendas_vistas))
        self.agora(br("2026-09-30T11:00"))
        r = self.rodar(job("site", "0 10 * * *", last_run="2026-09-29T08:00:42-03:00"))
        self.assertEqual(r["cron:site"]["estado"], "falha")

    def test_rotina_nova(self):
        r = self.rodar(job("digest", "0 21 * * *", created_at="2026-09-29T19:00:00-03:00"))
        self.assertEqual(r["cron:digest"]["estado"], "ok")

    def test_intervalo(self):
        r = self.rodar(job("coleta", minutos=60, last_run="2026-09-29T18:58:28-03:00"),
                       job("parada", minutos=60, last_run="2026-09-29T15:00:00-03:00"))
        self.assertEqual(r["cron:coleta"]["estado"], "ok")
        self.assertEqual(r["cron:parada"]["estado"], "falha")

    def test_erro_na_ultima_rodada(self):
        r = self.rodar(job("x", "0 8 * * *", last_run="2026-09-29T08:00:00-03:00",
                           last_status="error", last_error="boom"))
        self.assertEqual(r["cron:x"]["estado"], "falha")
        self.assertIn("boom", r["cron:x"]["detalhe"])

    def test_dell_desligado_no_horario_resolve_sozinho(self):
        # 30/09/2026: o Dell desligou às 22:23 e ligou às 08:30; o briefing das 08:00 caiu com ele.
        ds.ligado_desde = lambda: br("2026-09-30T08:30")
        self.agora(br("2026-09-30T10:50"))
        r = self.rodar(job("radar", "0 8 * * *", last_run="2026-09-29T08:00:55-03:00"),
                       job("coleta", minutos=60, last_run="2026-09-29T22:00:00-03:00"))
        self.assertEqual(r["cron:radar"]["estado"], "atencao")
        self.assertTrue(r["cron:radar"]["sozinho"])
        self.assertIn("desligado", r["cron:radar"]["detalhe"])
        # O intervalo conta desde que o Dell ligou: 2 h 20 min < 3 intervalos.
        self.assertEqual(r["cron:coleta"]["estado"], "ok")


class Gerador(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="dell-status-gerador-"))
        self.addCleanup(shutil.rmtree, self.dir)
        ds.GERADOR_LOGS = self.dir
        ds._unit_resultado = lambda unit: ("success", None)

    def estado(self, st: dict) -> dict:
        (self.dir / "status.json").write_text(json.dumps(st))
        (c,) = ds.gerador()
        return c

    def resumo(self, **r):
        return {"estado": "ocioso", "ultimo_resumo": {"concluidos": [], "falhas": [], "pendentes": 20,
                                                      "fim": "2026-09-29T08:05:35-03:00", **r}}

    def test_dia_normal(self):
        c = self.estado(self.resumo(concluidos=["a", "b", "c", "d"], tentativas=4))
        self.assertEqual(c["estado"], "ok")

    def test_29_09_sem_nenhum_site(self):
        c = self.estado(self.resumo(falhas=["pousada: index.html não foi gerado"], pendentes=29))
        self.assertEqual(c["estado"], "falha")

    def test_descarte_nao_e_falha(self):
        c = self.estado(self.resumo(descartados=["pousada → _descartados"], concluidos=["a"], tentativas=2))
        self.assertEqual(c["estado"], "ok")

    def test_parcial_e_atencao(self):
        c = self.estado(self.resumo(concluidos=["a"], falhas=["b: x"]))
        self.assertEqual(c["estado"], "atencao")

    def test_erro_do_runner(self):
        c = self.estado(self.resumo(erro="Claude sem login no Dell"))
        self.assertEqual(c["estado"], "falha")

    def test_processando(self):
        st = {"estado": "processando", "lead": "x", "inicio": "2026-09-29T08:02:09-03:00"}
        (self.dir / "gerador.lock").write_text(json.dumps({"host": os.uname().nodename, "pid": os.getpid()}))
        self.assertEqual(self.estado(st)["estado"], "ok")
        (self.dir / "gerador.lock").unlink()  # runner morto: status parado em "processando"
        self.assertEqual(self.estado(st)["estado"], "falha")

    def test_systemd_falhou_depois_do_resumo(self):
        ds._unit_resultado = lambda unit: ("exit-code", br("2026-09-30T08:02:00"))
        c = self.estado(self.resumo(concluidos=["a"]))
        self.assertEqual(c["estado"], "falha")
        ds._unit_resultado = lambda unit: ("exit-code", br("2026-09-29T08:05:35"))
        c = self.estado(self.resumo(concluidos=["a"]))
        self.assertEqual(c["estado"], "ok")


class FunilAprendizado(unittest.TestCase):
    T = br("2026-10-08T10:00")

    def avaliar(self, st, resultado="success", saiu=None):
        return ds.avaliar_funil_aprendizado(st, resultado, saiu, self.T)

    def st(self, **k):
        return {"inicio": "2026-10-08T06:41:00-03:00", "fim": "2026-10-08T06:52:00-03:00", "licoes_novas": 2,
                "pendentes": 0, "invalidas": 0, "desistidas": 0, "limite": False, "erro": None, **k}

    def test_tabela(self):
        casos = [
            (self.st(), "ok", "2 lição(ões) nova(s)"),
            (self.st(limite=True, pendentes=3), "ok", "limite de uso"),
            (self.st(erro="retrato do CRM velho (2026-10-07T20:00:00Z)"), "falha", "retrato do CRM velho"),
            (self.st(fim="2026-10-06T06:52:00-03:00"), "atencao", "não roda desde"),
            (None, "atencao", "Ainda não rodou"),
        ]
        for st, estado, trecho in casos:
            c = self.avaliar(st)
            self.assertEqual(c["estado"], estado, st)
            self.assertIn(trecho, c["detalhe"])

    def test_systemd_caiu_depois_do_status(self):
        self.assertEqual(self.avaliar(self.st(), "exit-code", br("2026-10-08T07:30"))["estado"], "falha")
        self.assertEqual(self.avaliar(self.st(), "exit-code", br("2026-10-08T06:52"))["estado"], "ok")

    def test_sem_timer_instalado_nao_ha_verificacao(self):
        antes = ds.FUNIL_APRENDIZADO_TIMER
        ds.FUNIL_APRENDIZADO_TIMER = Path(tempfile.gettempdir()) / "nao-existe-funil.timer"
        self.addCleanup(setattr, ds, "FUNIL_APRENDIZADO_TIMER", antes)
        self.assertEqual(ds.funil_aprendizado(), [])

    def test_o_que_fazer(self):
        c = ds.explicar(self.avaliar(self.st(erro="claude falhou (código 1)")))
        self.assertIn("journalctl --user -u funil-aprendizado", c["o_que_fazer"])


class PrumoMapa(unittest.TestCase):
    T = br("2026-10-07T10:00")

    def avaliar(self, gatilho=True, fila=(), erros=(), entregas=(), resultado="success", saiu=None):
        return ds.avaliar_prumo_mapa(gatilho, list(fila), list(erros), list(entregas), resultado, saiu, self.T)

    def test_fila_vazia_e_ok(self):
        c = self.avaliar()
        self.assertEqual(c["estado"], "ok")
        self.assertIn("nenhum rascunho", c["detalhe"])
        c = self.avaliar(entregas=[date(2026, 10, 1), date(2026, 10, 5)])
        self.assertEqual(c["estado"], "ok")
        self.assertIn("2 rascunho(s)", c["detalhe"])
        self.assertIn("05/10", c["detalhe"])

    def test_pacote_recente_esta_sendo_gerado(self):
        c = self.avaliar(fila=[self.T - timedelta(minutes=29)])
        self.assertEqual(c["estado"], "ok")
        self.assertIn("Gerando", c["detalhe"])

    def test_pacote_esquecido_na_fila_e_falha(self):
        velho = self.T - timedelta(minutes=31)
        c = self.avaliar(fila=[velho, self.T - timedelta(minutes=2)], resultado="exit-code",
                         saiu=self.T - timedelta(minutes=25))
        self.assertEqual(c["estado"], "falha")
        self.assertIn("1 pacote(s) na fila", c["detalhe"])
        self.assertIn("systemd: exit-code", c["detalhe"])
        self.assertIn("travou", c["o_que_fazer"])
        self.assertNotIn("caiu", self.avaliar(fila=[velho])["detalhe"])

    def test_gatilho_parado_e_falha_mesmo_sem_pacote(self):
        self.assertEqual(self.avaliar(gatilho=False)["estado"], "falha")
        c = self.avaliar(gatilho=False, fila=[self.T - timedelta(minutes=1)])
        self.assertIn("1 pacote(s) esperando", c["detalhe"])
        self.assertIn("prumo-mapa.path", c["o_que_fazer"])

    def test_pacote_com_erro_e_atencao_porque_o_prumo_mapa_ja_avisou(self):
        c = self.avaliar(erros=[self.T - timedelta(days=2)], entregas=[date(2026, 10, 1)])
        self.assertEqual(c["estado"], "atencao")
        self.assertIn("1 pacote(s) com erro", c["detalhe"])
        self.assertIn("devolve o pacote à fila", c["o_que_fazer"])
        # Fila travada vence: é ela que impede o próximo Mapa.
        c = self.avaliar(erros=[self.T - timedelta(days=2)], fila=[self.T - timedelta(hours=1)])
        self.assertEqual(c["estado"], "falha")

    def test_le_o_rastro_em_disco_sem_contar_teste_nem_por_nome_de_empresa(self):
        raiz = Path(tempfile.mkdtemp(prefix="dell-status-mapa-"))
        self.addCleanup(shutil.rmtree, raiz)
        for nome in ("MAPA_FILA", "MAPA_ERRO", "MAPA_ENTREGAS", "unit_ativa", "_unit_resultado"):
            self.addCleanup(setattr, ds, nome, getattr(ds, nome))
        ds.MAPA_FILA, ds.MAPA_ERRO, ds.MAPA_ENTREGAS = raiz / "fila", raiz / "erro", raiz / "entregas"
        ds.unit_ativa = lambda unit: unit == "prumo-mapa.path"
        ds._unit_resultado = lambda unit: ("success", None)
        for pasta in ("2026-10-05-padaria-do-ze", "2026-09-29-teste-vale-norte", "sem-data"):
            (ds.MAPA_ENTREGAS / pasta).mkdir(parents=True)
            (ds.MAPA_ENTREGAS / pasta / "dados.json").write_text("{}")
        (ds.MAPA_ENTREGAS / "LEIA-ME.txt").write_text("x")
        ds.MAPA_FILA.mkdir()
        pacote = ds.MAPA_FILA / "resp-1.json"
        pacote.write_text("{}")
        uma_hora = ds.agora().timestamp() - 3600
        os.utime(pacote, (uma_hora, uma_hora))
        (c,) = ds.prumo_mapa()
        self.assertEqual(c["estado"], "falha")
        pacote.unlink()
        (c,) = ds.prumo_mapa()
        self.assertEqual((c["id"], c["estado"]), ("prumo-mapa", "ok"))
        self.assertIn("1 rascunho(s)", c["detalhe"])
        self.assertIn("05/10", c["detalhe"])
        self.assertNotIn("padaria", json.dumps(c))


def fluxo(id_="w1", nome="01 · Caçador", gatilho=None, salva_boas=True, criado="2026-09-23T15:13:29.465Z",
          atualizado=None):
    nos = [gatilho or {"type": "n8n-nodes-base.scheduleTrigger",
                       "parameters": {"rule": {"interval": [{"field": "days", "triggerAtHour": 6}]}}},
           {"type": "n8n-nodes-base.manualTrigger", "name": "Manual"}]
    return {"id": id_, "name": nome, "nodes": nos, "createdAt": criado, "updatedAt": atualizado or criado,
            "settings": {} if salva_boas else {"saveDataSuccessExecution": "none"}}


WEBHOOK = {"type": "n8n-nodes-base.webhook", "parameters": {"path": "enviar"}}


def ex(id_, status, quando):
    return {"id": id_, "status": status, "startedAt": quando}


class Fluxos(unittest.TestCase):
    T = br("2026-09-30T10:50").astimezone(timezone.utc)

    def avaliar(self, w, execucoes=(), mem=None, ligado=None, t=None, primeira=True):
        return ds.avaliar_fluxo(w, list(execucoes), mem or {}, t or self.T, ligado, None, primeira_leitura=primeira)

    def test_regras_do_schedule_trigger(self):
        self.assertEqual(ds.regra_para_cron({"field": "days", "triggerAtHour": 9}), "0 9 * * *")
        self.assertEqual(ds.regra_para_cron({"triggerAtHour": 9}), "0 9 * * *")
        self.assertEqual(ds.regra_para_cron({"field": "hours", "hoursInterval": 1, "triggerAtMinute": 10}), "10 */1 * * *")
        self.assertEqual(ds.regra_para_cron({"field": "minutes", "minutesInterval": 10}), "*/10 * * * *")
        self.assertEqual(ds.regra_para_cron({"field": "weeks", "triggerAtDay": [1], "triggerAtHour": 8}), "0 8 * * 1")
        self.assertEqual(ds.regra_para_cron({"field": "cronExpression", "expression": "30 7 * * *"}), "30 7 * * *")
        self.assertEqual(ds.regra_para_cron({"field": "cronExpression", "expression": "0 30 7 * * *"}), "30 7 * * *")
        self.assertIsNone(ds.regra_para_cron({"field": "weeks", "weeksInterval": 2}))

    def test_so_webhook_sem_execucao_e_ok(self):
        c, _ = self.avaliar(fluxo(nome="04 · Clique no wa_link", gatilho=WEBHOOK))
        self.assertEqual(c["estado"], "ok")
        self.assertIn("Espera", c["detalhe"])

    def test_semanal_novo_espera_a_primeira_rodada(self):
        semanal = {"type": "n8n-nodes-base.scheduleTrigger", "parameters": {"rule": {"interval": [
            {"field": "weeks", "weeksInterval": 1, "triggerAtDay": [1], "triggerAtHour": 8}]}}}
        c, _ = self.avaliar(fluxo(nome="06 · Funil", gatilho=semanal, criado="2026-09-29T23:07:25.817Z"))
        self.assertEqual(c["estado"], "ok")
        self.assertIn("05/10", c["detalhe"])

    def test_nao_rodou_com_o_dell_desligado_resolve_sozinho(self):
        c, _ = self.avaliar(fluxo(), ligado=br("2026-09-30T08:30"))
        self.assertEqual(c["estado"], "atencao")
        self.assertTrue(c["sozinho"])
        self.assertIn("desligado", c["detalhe"])
        self.assertIn("próxima", c["o_que_fazer"])

    def test_nao_rodou_com_o_dell_ligado_e_falha(self):
        c, _ = self.avaliar(fluxo(), ligado=br("2026-09-28T13:29"))
        self.assertEqual(c["estado"], "falha")

    def test_memoria_guarda_a_rodada_que_o_n8n_apagou(self):
        # 06:00 rodou e o monitor viu; às 20:00 o n8n já apagou a execução (retenção de 14 h).
        _, mem = self.avaliar(fluxo(), [ex(10, "success", "2026-09-30T09:00:05Z")])
        c, _ = self.avaliar(fluxo(), [], mem, t=br("2026-09-30T20:30").astimezone(timezone.utc))
        self.assertEqual(c["estado"], "ok")
        self.assertIn("06:00", c["detalhe"])

    def test_fluxo_ativado_agora_nao_e_cobrado_pelo_passado(self):
        c, mem = self.avaliar(fluxo(), primeira=False, ligado=br("2026-09-28T13:29"))
        self.assertEqual(c["estado"], "ok")
        self.assertEqual(mem["visto_desde"], ds.iso(self.T))

    def test_ultima_falhou_com_credencial_diz_o_que_fazer(self):
        balcao = {"type": "n8n-nodes-base.scheduleTrigger", "parameters": {"rule": {"interval": [
            {"field": "hours", "hoursInterval": 1, "triggerAtMinute": 10}]}}}
        causa = {"id": 2414, **ds.classificar_erro('The credential "Google Sheets account" needs to be reconnected.',
                                                   "", "Ler a planilha")}
        c, _ = self.avaliar(fluxo(nome="03 · Balcão", gatilho=balcao),
                            [ex(2414, "error", "2026-09-30T13:10:53Z"), ex(2324, "success", "2026-09-30T12:10:53Z")],
                            {"causa": causa})
        self.assertEqual(c["estado"], "falha")
        self.assertIn("reconectada", c["detalhe"])
        self.assertIn("Google Sheets account", c["o_que_fazer"])
        self.assertIn("11:10", c["o_que_fazer"])
        self.assertTrue(c["link"].endswith("/executions/2414"))

    def test_quem_nao_guarda_as_boas_para_de_ser_falha_em_30_min(self):
        w = fluxo(nome="WhatsApp — números dos leads", gatilho=WEBHOOK, salva_boas=False)
        erros = [ex(2394, "error", "2026-09-30T13:04:48Z"), ex(2391, "error", "2026-09-30T12:51:00Z")]
        c, _ = self.avaliar(w, erros, t=br("2026-09-30T10:20").astimezone(timezone.utc))
        self.assertEqual(c["estado"], "falha")
        c, _ = self.avaliar(w, erros)
        self.assertEqual(c["estado"], "atencao")
        self.assertTrue(c["sozinho"])
        self.assertIn("nenhuma desde então", c["detalhe"])
        c, _ = self.avaliar(w, erros, t=br("2026-10-01T11:00").astimezone(timezone.utc))
        self.assertEqual(c["estado"], "ok")

    def test_falhou_e_voltou(self):
        c, _ = self.avaliar(fluxo(), [ex(3, "success", "2026-09-30T13:30:00Z"), ex(2, "error", "2026-09-30T09:00:00Z")])
        self.assertEqual(c["estado"], "atencao")
        self.assertTrue(c["sozinho"])

    def test_erro_sem_numero_longo(self):
        causa = ds.classificar_erro("Linha 5527999998888 não encontrada")
        self.assertNotIn("5527999998888", causa["texto"])
        self.assertEqual(ds.classificar_erro("Unable to sign without access token")["tipo"], "credencial")


class OQueFazer(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="dell-status-oqf-"))
        self.addCleanup(shutil.rmtree, self.dir)
        # Sem isto o Radar lia a marca de pausa de verdade do Dell (~/.local/state/dell-status/pausa-pncp,
        # gravada em 11/10/2026) e a coleta velha dava "ok": o teste passava ou falhava conforme a máquina.
        # Os testes daqui também trocam o relógio e os caminhos do módulo; devolve tudo no fim.
        antes = {k: getattr(ds, k) for k in ("agora", "PNCP_RUN", "PNCP_PAUSA")}
        self.addCleanup(lambda: [setattr(ds, k, v) for k, v in antes.items()])
        ds.PNCP_RUN = self.dir / "latest-run.json"
        ds.PNCP_PAUSA = self.dir / "pausa-pncp"

    def test_todo_alerta_diz_o_que_fazer(self):
        for cid in ("hermes", "n8n", "disco", "dns", "container:x", "gerador", "monitor", "erro:fluxos", "novo"):
            for estado in ("atencao", "falha"):
                c = ds.explicar(ds.check(cid, "servicos", cid, estado, "detalhe"))
                self.assertTrue(c["o_que_fazer"], (cid, estado))
        self.assertNotIn("o_que_fazer", ds.explicar(ds.check("n8n", "servicos", "n8n", "ok", "Respondendo")))
        self.assertTrue(ds.explicar(ds.check("dns", "maquina", "DNS", "atencao", "1/3"))["sozinho"])

    def test_filas_levam_ao_crm(self):
        ds.AUTO = self.dir / "auto"
        ds.ESTADO_N8N = self.dir / "estado"
        ds.ESTADO_N8N.mkdir()
        (ds.ESTADO_N8N / "site.json").write_text(json.dumps({"geradoEm": ds.iso(ds.agora()), "itens": [
            {"id": "site-enviar", "nome": "Sites prontos para enviar", "quantidade": 53, "detalhe": "Clique"},
            {"id": "site-resposta", "nome": "Enviados esperando resposta", "quantidade": 12, "detalhe": "x"},
            {"id": "prumo-diagnostico", "nome": "Diagnósticos", "quantidade": 0, "detalhe": "x"}]}))
        r = {c["id"]: c for c in ds.pendencias()}
        self.assertEqual(r["pend:site-enviar"]["acao"]["url"], "/crm?ver=triagem&produto=site")
        self.assertNotIn("fila=envio", r["pend:site-enviar"]["o_que_fazer"])
        self.assertNotIn("Enviar um por um", r["pend:site-enviar"]["o_que_fazer"])
        self.assertIn("o observador do WhatsApp", r["pend:site-enviar"]["o_que_fazer"])
        self.assertNotIn("09:00", r["pend:site-resposta"]["o_que_fazer"])
        self.assertIn("7 dias", r["pend:site-resposta"]["o_que_fazer"])
        self.assertNotIn("sozinho", r["pend:site-enviar"])
        self.assertTrue(r["pend:site-resposta"]["sozinho"])
        self.assertEqual(r["pend:prumo-diagnostico"]["estado"], "ok")
        self.assertNotIn("o_que_fazer", r["pend:prumo-diagnostico"])

    def test_backup_com_token_recusado_e_falha(self):
        ds.BACKUP_STATUS = self.dir / "backup.json"
        agora_ = ds.iso(ds.agora())
        ds.BACKUP_STATUS.write_text(json.dumps({"fontes": {
            "sites": {"nome": "Sites", "estado": "falha", "ultimo_sucesso": agora_, "atencao_h": 3, "falha_h": 24,
                      "detalhe": "couldn't fetch token: invalid_grant: maybe token expired?"},
            "entregas": {"nome": "Entregas", "estado": "adiado", "ultimo_sucesso": agora_, "detalhe": "Adiado"}}}))
        r = {c["id"]: c for c in ds.backup()}
        self.assertEqual(r["backup:sites"]["estado"], "falha")
        self.assertIn("rclone config reconnect gdrive:", r["backup:sites"]["o_que_fazer"])
        self.assertEqual(r["backup:entregas"]["estado"], "ok")
        self.assertNotIn("o_que_fazer", r["backup:entregas"])

    def test_pncp_de_madrugada_ainda_vale_a_de_ontem(self):
        ds.PNCP_RUN = self.dir / "latest-run.json"
        ds.PNCP_RUN.write_text(json.dumps({"run_at": "2026-09-29T10:31:00Z", "status": "completed",
                                           "counts": {"fetched": 1000, "qualified": 0}}))
        ds.agora = lambda: br("2026-09-30T06:00").astimezone(timezone.utc)
        self.assertEqual(ds.pncp()["estado"], "ok")
        ds.agora = lambda: br("2026-09-30T11:00").astimezone(timezone.utc)
        self.assertEqual(ds.pncp()["estado"], "atencao")

    def test_pncp_pausado_de_proposito_nao_acende(self):
        ds.PNCP_RUN = self.dir / "latest-run.json"
        ds.PNCP_RUN.write_text(json.dumps({"run_at": "2026-09-29T10:31:00Z", "status": "completed",
                                           "counts": {"fetched": 1000, "qualified": 0}}))
        ds.agora = lambda: br("2026-10-20T11:00").astimezone(timezone.utc)
        self.assertEqual(ds.pncp()["estado"], "atencao")  # sem a marca, coleta velha é amarelo
        ds.PNCP_PAUSA.write_text("11/10/2026")
        r = ds.pncp()
        self.assertEqual(r["estado"], "ok")
        self.assertIn("Pausado", r["detalhe"])
        self.assertIn("11/10/2026", r["detalhe"])
        ds.PNCP_PAUSA.unlink()  # voltou: a coleta velha volta a ser cobrada
        self.assertEqual(ds.pncp()["estado"], "atencao")


def aviso(**extra) -> dict:
    return {"titulo": "🌐 Sites", "texto": "2 sites prontos", "origem": "teste", **extra}


class FilaDeAvisos(unittest.TestCase):
    """A fila de ~/.local/share/avisos/fila: formato, teto, silêncio, chave, flock."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="dell-status-fila-"))
        self.addCleanup(shutil.rmtree, self.dir)
        self.antes = {k: getattr(ds, k) for k in ("FILA", "FILA_TRAVA", "FILA_ESTADO", "FILA_RECUSADOS",
                                                  "FRESCOR_S", "enviar", "enviar_telegram")}
        self.addCleanup(lambda: [setattr(ds, k, v) for k, v in self.antes.items()])
        ds.FILA = self.dir / "fila"
        ds.FILA.mkdir()
        ds.FILA_TRAVA = self.dir / "estado" / "fila.lock"
        ds.FILA_ESTADO = self.dir / "estado" / "fila.json"
        ds.FILA_RECUSADOS = self.dir / "estado" / "recusados"
        ds.FRESCOR_S = 0
        self.enviadas: list[str] = []
        self.hermes_no_ar = True
        self.telegram = []
        ds.enviar_telegram = lambda msg, silencioso=False: (self.telegram.append(msg) or True)

        def enviar(msg):
            if self.hermes_no_ar:
                self.enviadas.append(msg)
            return self.hermes_no_ar
        ds.enviar = enviar
        self.n = 0

    def gravar(self, conteudo, nome: str | None = None) -> Path:
        self.n += 1
        f = ds.FILA / (nome or f"{self.n:04d}.json")
        f.write_text(conteudo if isinstance(conteudo, str) else json.dumps(conteudo), encoding="utf-8")
        return f

    def test_formato(self):
        self.assertEqual(ds.validar_aviso(aviso())["prioridade"], 2)
        self.assertIsNone(ds.validar_aviso(aviso(chave=None, link=None))["chave"])
        self.assertEqual(ds.validar_aviso(aviso(expira_em="2026-10-06T22:00"))["expira_em"], br("2026-10-06T22:00"))
        for ruim, motivo in (
            ({"titulo": "x", "texto": "y"}, "origem"),
            (aviso(origem="  "), "origem"),
            (aviso(extra=1), "fora do formato"),
            (aviso(prioridade=4), "prioridade"),
            (aviso(prioridade=True), "prioridade"),
            (aviso(prioridade="0"), "prioridade"),
            (aviso(texto="x" * 4001), "4000"),
            (aviso(titulo="a\nb"), "quebra de linha"),
            (aviso(link="ftp://x"), "link"),
            (aviso(expira_em="amanhã"), "expira_em"),
            (aviso(chave=3), "chave"),
            ([aviso()], "objeto"),
        ):
            with self.assertRaisesRegex(ValueError, motivo):
                ds.validar_aviso(ruim)

    def test_envia_valido_e_recusa_o_resto_com_motivo(self):
        ok = self.gravar(aviso(link="https://exemplo.com/x"))
        self.gravar("{nem json")
        self.gravar({"titulo": "Antigo", "texto": "sem origem"})
        self.gravar(aviso(texto="x" * 20_000))
        r = ds.drenar_fila(br("2026-10-06T10:00"))
        self.assertEqual((r["enviados"], r["recusados"]), (1, 3))
        self.assertEqual(self.enviadas, ["🌐 Sites\n2 sites prontos\nhttps://exemplo.com/x"])
        self.assertFalse(ok.exists())
        self.assertEqual(list(ds.FILA.glob("*.json")), [])
        recusados = sorted(ds.FILA_RECUSADOS.glob("*.json"))
        self.assertEqual(len(recusados), 3)
        self.assertTrue(all(f.with_name(f.name + ".motivo.txt").exists() for f in recusados))
        c = ds.fila_de_avisos()[0]
        self.assertEqual(c["estado"], "falha")
        self.assertIn("avisos-recusados", c["o_que_fazer"])
        for f in ds.FILA_RECUSADOS.iterdir():
            f.unlink()
        self.assertEqual(ds.fila_de_avisos()[0]["estado"], "ok")

    def recusar_dois(self) -> list[str]:
        self.gravar({"titulo": "A", "texto": "sem origem"}, nome="a.json")
        self.gravar({"titulo": "B", "texto": "sem origem"}, nome="b.json")
        self.assertEqual(ds.drenar_fila(br("2026-10-06T10:00"))["recusados"], 2)
        self.assertEqual(ds.fila_de_avisos()[0]["estado"], "falha")
        return sorted(f.name for f in ds.FILA_RECUSADOS.glob("*.json"))

    def test_visto_em_todos_apaga_o_vermelho_e_guarda_a_prova(self):
        nomes = self.recusar_dois()
        r = ds.visto_recusados(["todos"])
        self.assertEqual((r["vistos"], r["inexistentes"]), (nomes, []))
        c = ds.fila_de_avisos()[0]
        self.assertEqual(c["estado"], "ok")
        self.assertIn("2 recusado(s) já visto(s)", c["detalhe"])
        vistos = ds.FILA_RECUSADOS / "vistos"
        self.assertEqual(sorted(f.name for f in vistos.glob("*.json")), nomes)
        # O motivo viaja junto com o arquivo.
        for n in nomes:
            self.assertIn("origem", (vistos / (n + ".motivo.txt")).read_text(encoding="utf-8"))
        self.assertEqual(list(ds.FILA_RECUSADOS.glob("*.json")), [])
        # Visto não reacende, e repetir o comando é inofensivo.
        self.assertEqual(ds.visto_recusados(["todos"]), {"vistos": [], "inexistentes": []})
        self.assertEqual(ds.fila_de_avisos()[0]["estado"], "ok")

    def test_visto_por_nome_deixa_o_resto_vermelho_e_recusa_caminho_de_fora(self):
        a, b = self.recusar_dois()
        fora = self.dir / "fora.json"
        fora.write_text("{}", encoding="utf-8")
        r = ds.visto_recusados([a, "nao-existe.json", "../../fora.json", str(fora)])
        self.assertEqual(r["vistos"], [a])
        self.assertEqual(r["inexistentes"], ["nao-existe.json", "../../fora.json", str(fora)])
        self.assertTrue(fora.exists())  # nada fora da pasta de recusados é tocado
        c = ds.fila_de_avisos()[0]
        self.assertEqual(c["estado"], "falha")
        self.assertIn(b, c["detalhe"])
        self.assertNotIn(a, c["detalhe"])
        self.assertIn("--visto-recusados", c["o_que_fazer"])

    def test_novo_recusado_depois_do_visto_volta_a_acender(self):
        self.recusar_dois()
        ds.visto_recusados(["todos"])
        self.gravar({"titulo": "C", "texto": "sem origem"}, nome="c.json")
        self.assertEqual(ds.drenar_fila(br("2026-10-06T10:05"))["recusados"], 1)
        self.assertEqual(ds.fila_de_avisos()[0]["estado"], "falha")

    def test_visto_com_o_mesmo_nome_nao_sobrescreve_o_anterior(self):
        self.recusar_dois()
        ds.visto_recusados(["todos"])
        vistos = ds.FILA_RECUSADOS / "vistos"
        antigo = next(vistos.glob("*.json"))
        antigo_txt = antigo.read_text(encoding="utf-8")
        # Um recusado novo com exatamente o mesmo nome de arquivo.
        (ds.FILA_RECUSADOS / antigo.name).write_text('{"novo": 1}', encoding="utf-8")
        ds.visto_recusados([antigo.name])
        self.assertEqual(antigo.read_text(encoding="utf-8"), antigo_txt)
        self.assertEqual((vistos / (antigo.name + ".1")).read_text(encoding="utf-8"), '{"novo": 1}')
        self.assertEqual(ds.fila_de_avisos()[0]["estado"], "ok")

    def test_expirado_e_descartado_sem_enviar(self):
        velho = self.gravar(aviso(expira_em="2026-10-06T09:00:00-03:00"))
        self.gravar(aviso(titulo="Vale", expira_em="2026-10-06T11:00:00-03:00"))
        r = ds.drenar_fila(br("2026-10-06T10:00"))
        self.assertEqual((r["enviados"], r["descartados"]), (1, 1))
        self.assertFalse(velho.exists())
        self.assertTrue(self.enviadas[0].startswith("Vale"))

    def test_chave_repetida_em_24h_e_descartada(self):
        self.gravar(aviso(chave="gerador:2026-10-06"))
        self.gravar(aviso(chave="gerador:2026-10-06"))  # mesma rodada: só um sai
        ds.drenar_fila(br("2026-10-06T10:00"))
        self.assertEqual(len(self.enviadas), 1)
        self.gravar(aviso(chave="gerador:2026-10-06"))
        r = ds.drenar_fila(br("2026-10-07T09:59"))
        self.assertEqual((r["enviados"], r["descartados"]), (0, 1))
        self.gravar(aviso(chave="gerador:2026-10-06"))
        self.assertEqual(ds.drenar_fila(br("2026-10-07T10:01"))["enviados"], 1)

    def test_silencio_das_22h_as_7h_so_p0(self):
        normal = self.gravar(aviso(titulo="Normal"))
        self.gravar(aviso(titulo="Urgente", prioridade=0))
        r = ds.drenar_fila(br("2026-10-06T23:30"))
        self.assertEqual((r["enviados"], r["esperando"], r['pelo_telegram']), (0, 1, 1))
        self.assertTrue(self.telegram[0].startswith("Urgente"))
        self.assertEqual(self.enviadas, [])
        self.assertTrue(normal.exists())
        self.assertEqual(ds.drenar_fila(br("2026-10-07T06:59"))["enviados"], 0)
        self.assertEqual(ds.drenar_fila(br("2026-10-07T07:00"))["enviados"], 1)
        self.assertFalse(normal.exists())

    def test_teto_por_hora_dobra_o_excedente_num_resumo(self):
        for i in range(25):
            self.gravar(aviso(titulo=f"Aviso {i:02d}"))
        self.gravar(aviso(titulo="Urgente", prioridade=0), nome="9999.json")
        r = ds.drenar_fila(br("2026-10-06T10:00"))
        self.assertEqual((r["enviados"], r["agrupados"], r['pelo_telegram']), (19, 6, 1))
        self.assertEqual(len(self.enviadas), 20)
        self.assertTrue(self.telegram[0].startswith("Urgente"))
        self.assertIn("6 avisos agrupados", self.enviadas[-1])
        self.assertEqual(list(ds.FILA.glob("*.json")), [])
        # Teto cheio e resumo recente: o que chega espera; passada a hora, sai.
        self.gravar(aviso(titulo="Depois"))
        r = ds.drenar_fila(br("2026-10-06T10:30"))
        self.assertEqual((r["enviados"], r["agrupados"], r["esperando"]), (0, 0, 1))
        self.assertEqual(ds.drenar_fila(br("2026-10-06T11:01"))["enviados"], 1)

    def test_hermes_fora_mantem_na_fila(self):
        f = self.gravar(aviso(chave="k"))
        self.hermes_no_ar = False
        self.assertEqual(ds.drenar_fila(br("2026-10-06T10:00"))["enviados"], 0)
        self.assertTrue(f.exists())
        self.hermes_no_ar = True
        self.assertEqual(ds.drenar_fila(br("2026-10-06T10:01"))["enviados"], 1)

    def test_flock_impede_drenagem_dupla(self):
        import fcntl
        self.gravar(aviso())
        ds.FILA_TRAVA.parent.mkdir(parents=True)
        with open(ds.FILA_TRAVA, "a") as outra:
            fcntl.flock(outra, fcntl.LOCK_EX)
            self.assertEqual(ds.drenar_fila(br("2026-10-06T10:00")), {"ocupada": True})
        self.assertEqual(self.enviadas, [])
        self.assertEqual(ds.drenar_fila(br("2026-10-06T10:00"))["enviados"], 1)

    def test_arquivo_recem_gravado_espera(self):
        ds.FRESCOR_S = 3600
        f = self.gravar(aviso())
        self.assertEqual(ds.drenar_fila(br("2026-10-06T10:00"))["esperando"], 1)
        self.assertTrue(f.exists())


class WhatsApp(unittest.TestCase):
    def test_sessao(self):
        # A bridge do Hermes responde "connected" (visto no Dell em 07/10/2026); "open" é o do Baileys.
        self.assertEqual(ds.avaliar_whatsapp({"status": "connected", "queueLength": 0})["estado"], "ok")
        self.assertEqual(ds.avaliar_whatsapp({"status": "open", "queueLength": 0})["estado"], "ok")
        self.assertEqual(ds.avaliar_whatsapp({"status": "disconnected"})["estado"], "falha")
        fechada = ds.avaliar_whatsapp({"status": "close"})
        self.assertEqual(fechada["estado"], "falha")
        self.assertIn("'close'", fechada["detalhe"])
        sem_resposta = ds.avaliar_whatsapp(None, "Connection refused")
        self.assertEqual(sem_resposta["estado"], "falha")
        self.assertIn("pareamento", sem_resposta["o_que_fazer"])


class SemSyncthing(unittest.TestCase):
    """O Syncthing foi aposentado em 12/10/2026 (sem aparelho pareado desde 04/10): desligá-lo
    não pode acender 'falha' no monitor, e a saída das verificações não ganha item no lugar."""

    def test_servicos_nao_olha_o_syncthing_e_nao_inventa_item(self):
        urls = []
        originais = (ds.http_ok, ds.http_json, ds.unit_ativa)
        ds.http_ok = lambda url, *a, **k: (urls.append(url), (True, "ok"))[1]
        ds.http_json = lambda url, *a, **k: (urls.append(url), {"status": "connected"})[1]
        ds.unit_ativa = lambda unit: True
        try:
            itens = ds.servicos()
        finally:
            ds.http_ok, ds.http_json, ds.unit_ativa = originais
        self.assertEqual([c["id"] for c in itens],
                         ["hermes", "hermes-navegador", "n8n", "terminal", "central", "whatsapp-sessao"])
        self.assertTrue(all(c["estado"] == "ok" for c in itens))
        self.assertNotIn("syncthing", json.dumps(itens, ensure_ascii=False).lower())
        self.assertFalse([u for u in urls if ":8384" in u], urls)

    def test_nao_sobra_funcao_nem_texto(self):
        self.assertFalse(hasattr(ds, "syncthing"))
        self.assertNotIn("syncthing", ds.O_QUE_FAZER)


def linha_do_journal(quando: str, msg, desde_o_boot_s: float = 3600) -> str:
    return json.dumps({"MESSAGE": msg, "__REALTIME_TIMESTAMP": str(int(br(quando).timestamp() * 1e6)),
                       "__MONOTONIC_TIMESTAMP": str(int(desde_o_boot_s * 1e6))})


class Religamentos(unittest.TestCase):
    """O journal do dell-worker-healthwatch nos 7 dias até 11/10/2026, como estava na Mel."""

    def journal(self) -> str:
        linhas = [linha_do_journal("2026-10-06T23:02:07", "healthwatch: restarting Hermes", 4),
                  linha_do_journal("2026-10-06T23:02:11", "healthwatch: restarting licitacoes n8n", 8),
                  linha_do_journal("2026-10-06T23:02:12", "curl: (7) Failed to connect to 127.0.0.1 port 5679", 9)]
        for i in range(13):  # 00:00:32 a 00:06:33, de 30 em 30 s
            linhas.append(linha_do_journal(f"2026-10-07T00:{(32 + 30 * i) // 60:02d}:{(32 + 30 * i) % 60:02d}",
                                           "healthwatch: restarting Hermes gateway", 3500 + 30 * i))
        linhas += [linha_do_journal("2026-10-07T08:16:15", "healthwatch: restarting Hermes", 4),
                   linha_do_journal("2026-10-07T08:16:18", "healthwatch: restarting licitacoes n8n", 7),
                   linha_do_journal("2026-10-09T16:06:50", "healthwatch: restarting Hermes gateway", 200_000),
                   linha_do_journal("2026-10-09T16:07:20", "healthwatch: restarting Hermes gateway", 200_030),
                   linha_do_journal("2026-10-09T16:07:50", "healthwatch: restarting Hermes gateway", 200_060),
                   "linha que não é json"]
        return "\n".join(linhas)

    def avaliar(self, quando: str) -> dict:
        return ds.avaliar_religamentos(ds.religamentos_do_journal(self.journal()), br(quando).astimezone(timezone.utc))

    def test_le_o_journal_e_separa_o_boot(self):
        ev = ds.religamentos_do_journal(self.journal())
        self.assertEqual(len(ev), 20)
        self.assertEqual(sum(e["no_boot"] for e in ev), 4)
        self.assertEqual({e["servico"] for e in ev}, {"Hermes", "licitacoes n8n", "Hermes gateway"})
        bytes_ = ds.religamentos_do_journal(linha_do_journal("2026-10-07T00:00:00", list(b"healthwatch: restarting n8n\xff")))
        self.assertEqual(bytes_[0]["servico"], "n8n�")

    def test_hoje_na_mel_e_ok(self):
        c = self.avaliar("2026-10-11T21:45")
        self.assertEqual(c["estado"], "ok")
        self.assertEqual(c["detalhe"], "Nenhum serviço religado nas últimas 24 h; 16 em 7 dias "
                                       "(mais 4 logo depois de o Dell ligar)")

    def test_o_boot_nao_acende(self):
        c = self.avaliar("2026-10-06T23:30")
        self.assertEqual(c["estado"], "ok")

    def test_gateway_em_laco_a_meia_noite(self):
        c = self.avaliar("2026-10-07T09:00")
        self.assertEqual(c["estado"], "atencao")
        self.assertNotIn("sozinho", c)
        self.assertIn("gateway do Hermes 13x (00:00 a 00:06)", c["detalhe"])
        self.assertIn("de novo e de novo", c["o_que_fazer"])
        self.assertEqual(self.avaliar("2026-10-08T00:07")["estado"], "ok")  # passadas 24 h, apaga

    def test_um_episodio_curto_resolve_sozinho(self):
        c = self.avaliar("2026-10-09T17:00")
        self.assertEqual(c["estado"], "atencao")
        self.assertTrue(c["sozinho"])
        self.assertIn("gateway do Hermes 3x (16:06 a 16:07)", c["detalhe"])

    def test_tres_episodios_em_24h_pedem_olhar(self):
        ev = [{"em": br(f"2026-10-09T{h:02d}:00").astimezone(timezone.utc), "servico": "licitacoes n8n",
               "no_boot": False} for h in (2, 9, 15)]
        c = ds.avaliar_religamentos(ev, br("2026-10-09T16:00").astimezone(timezone.utc))
        self.assertEqual(c["estado"], "atencao")
        self.assertNotIn("sozinho", c)
        self.assertIn("3 vezes em 24 h", c["o_que_fazer"])
        self.assertIn("n8n 3x", c["detalhe"])


def resposta(texto: str) -> str:
    return f"# Cron Job: x\n\n## Prompt\n\nSe não houver nada, responda exatamente `[SILENT]`.\n\n## Response\n\n{texto}\n"


class RotinasCaladas(unittest.TestCase):
    """A revisão diária do ASMR (b1fc67504adb): 4 respostas, depois [SILENT] todo dia."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="dell-status-caladas-"))
        self.addCleanup(shutil.rmtree, self.dir)
        self.antes = {k: getattr(ds, k) for k in ("CRON_JOBS", "HERMES_SAIDAS", "SILENCIO_ESPERADO", "agora")}
        self.addCleanup(lambda: [setattr(ds, k, v) for k, v in self.antes.items()])
        ds.CRON_JOBS = self.dir / "jobs.json"
        ds.HERMES_SAIDAS = self.dir / "output"
        ds.SILENCIO_ESPERADO = self.dir / "silencio-esperado"
        ds.agora = lambda: br("2026-10-11T21:45").astimezone(timezone.utc)
        inicio = br("2026-09-22T09:31")
        for i in range(20):  # 22/09 a 11/10: 4 boas, 10 [SILENT], 1 erro de cota, 5 [SILENT]
            texto = (resposta("*ASMR — revisão*\n*Decisão:* manter") if i < 4 else
                     "# Cron Job: x\n\n## Prompt\n\n[SILENT]\n\n## Error\n\nquota" if i == 14 else resposta("[SILENT]"))
            self.saida("b1fc67504adb", inicio + timedelta(days=i), texto)
        for i in range(30):  # script do Entrada, a cada 5 min: sempre "silent (empty output)"
            self.saida("cbb21e966fce", br("2026-10-11T19:00") + timedelta(minutes=5 * i),
                       "# Cron Job: Entrada\n\n**Mode:** no_agent (script)\n**Status:** silent (empty output)\n")

    def saida(self, jid: str, em: datetime, texto: str) -> None:
        p = ds.HERMES_SAIDAS / jid / f"{em:%Y-%m-%d_%H-%M-%S}.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(texto)
        os.utime(p, (em.timestamp(),) * 2)

    def rodar(self, *jobs) -> dict:
        ds.CRON_JOBS.write_text(json.dumps({"jobs": list(jobs)}))
        [c] = ds.rotinas_caladas()
        return c

    def revisao(self, **extra) -> dict:
        return job("b1fc67504adb", "30 9 * * *", name="ASMR FULLBRINGER — revisão diária 24/48h", **extra)

    def test_classificar(self):
        self.assertEqual(ds.classificar_saida(resposta("[SILENT]")), "silencio")
        self.assertEqual(ds.classificar_saida(resposta("*Sites* 3 prontos")), "util")
        self.assertIsNone(ds.classificar_saida("Script gate returned `wakeAgent=false` — agent skipped."))
        self.assertIsNone(ds.classificar_saida("**Status:** silent (empty output)"))
        self.assertIsNone(ds.classificar_saida("## Prompt\n\n[SILENT]\n\n## Error\n\nquota"))

    def test_revisao_calada_acende(self):
        c = self.rodar(self.revisao(), job("cbb21e966fce", minutos=5, no_agent=True))
        self.assertEqual(c["estado"], "atencao")
        self.assertEqual(c["detalhe"], "ASMR FULLBRINGER — revisão diária 24/48h: 15 [SILENT] seguidos desde 26/09")
        self.assertIn("hermes cron pause b1fc67504adb", c["o_que_fazer"])

    def test_pausada_de_proposito_e_ok_como_hoje_na_mel(self):
        pausados = [job(i, "0 9 * * *", enabled=False, state="paused")
                    for i in ("d12b6431a2e6", "79a04dbf2d81", "f6e7da0f8558", "eb9282f96df6")]
        c = self.rodar(self.revisao(enabled=False, state="paused"), *pausados,
                       job("e77d281ae687", "30 8 * * 1"), job("cbb21e966fce", minutos=5, no_agent=True))
        self.assertEqual((c["estado"], c["detalhe"]), ("ok", "Nenhuma calada (1 rotina(s) com modelo conferida(s))"))

    def test_silencio_esperado(self):
        ds.SILENCIO_ESPERADO.write_text("# vigias\nb1fc67504adb  # a revisão só fala com snapshot novo\n")
        c = self.rodar(self.revisao())
        self.assertEqual(c["estado"], "ok")
        self.assertIn("1 com silêncio esperado", c["detalhe"])

    def test_poucos_ou_recentes_nao_acendem(self):
        for d in range(4):  # 4 [SILENT] em 4 dias: ainda não
            self.saida("bbbb", br("2026-10-08T09:00") + timedelta(days=d), resposta("[SILENT]"))
        self.assertEqual(self.rodar(job("bbbb", "0 9 * * *"))["estado"], "ok")
        for h in range(6):  # 6 [SILENT] de hora em hora: menos de 3 dias, ainda não
            self.saida("aaaa", br("2026-10-11T10:00") + timedelta(hours=h), resposta("[SILENT]"))
        self.assertEqual(self.rodar(job("aaaa", minutos=60))["estado"], "ok")
        self.saida("bbbb", br("2026-10-12T09:00"), resposta("[SILENT]"))  # o 5º, 4 dias depois do 1º
        ds.agora = lambda: br("2026-10-12T10:00").astimezone(timezone.utc)
        self.assertEqual(self.rodar(job("bbbb", "0 9 * * *"))["estado"], "atencao")


class PastasQueCrescem(unittest.TestCase):
    """~/.cache e ~/.local: 12.2 GB e 2.7 GB na Mel em 11/10/2026, depois de apagar 34 GB de
    perfis temporários do Chrome headless."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="dell-status-pastas-"))
        self.addCleanup(shutil.rmtree, self.dir)
        self.antes = {k: getattr(ds, k) for k in ("TAMANHOS", "PASTAS_VIGIADAS", "medir_pasta", "agora")}
        self.addCleanup(lambda: [setattr(ds, k, v) for k, v in self.antes.items()])
        self.addCleanup(ds.tamanhos_medidos.clear)
        ds.TAMANHOS = self.dir / "tamanhos.json"
        ds.PASTAS_VIGIADAS = {"~/.cache": (self.dir / "cache", 25 * ds.GB), "~/.local": (self.dir / "local", 15 * ds.GB)}
        self.tamanho = {"~/.cache": 12.2 * ds.GB, "~/.local": 2.7 * ds.GB}
        self.medicoes = 0

        def medir(pasta):
            self.medicoes += 1
            rotulo = "~/.cache" if pasta.name == "cache" else "~/.local"
            if self.tamanho[rotulo] is None:
                raise ds.subprocess.TimeoutExpired("du", 60)
            maior = ["google-chrome-headless", self.tamanho[rotulo] - 9 * ds.GB] if self.tamanho[rotulo] > 20 * ds.GB \
                else ["huggingface", 3.7 * ds.GB]
            return {"total": int(self.tamanho[rotulo]), "maiores": [[maior[0], int(maior[1])]]}
        ds.medir_pasta = medir

    def rodar(self, quando: str) -> dict:
        ds.agora = lambda: br(quando).astimezone(timezone.utc)
        [c] = ds.pastas_que_crescem()
        ds.gravar(ds.TAMANHOS, ds.tamanhos_medidos)  # o que main() faz fora do --stdout
        return c

    def test_hoje_na_mel_e_ok_e_mede_uma_vez_por_hora(self):
        c = self.rodar("2026-10-11T21:45")
        self.assertEqual((c["estado"], c["detalhe"]),
                         ("ok", "~/.cache 12.2 GB · ~/.local 2.7 GB · crescimento: medindo (precisa de um dia)"))
        self.assertEqual(self.medicoes, 2)
        self.rodar("2026-10-11T22:30")
        self.assertEqual(self.medicoes, 2)  # menos de uma hora: usa a medida guardada
        self.rodar("2026-10-11T22:46")
        self.assertEqual(self.medicoes, 4)

    def test_cresce_mais_de_2_gb_por_dia(self):
        self.rodar("2026-10-11T10:00")
        self.tamanho["~/.cache"] = 13.0 * ds.GB
        c = self.rodar("2026-10-12T10:00")
        self.assertEqual(c["estado"], "ok")
        self.assertIn("~/.cache 13.0 GB (+0.8 GB/dia)", c["detalhe"])
        self.tamanho["~/.cache"] = 16.0 * ds.GB
        c = self.rodar("2026-10-13T10:00")
        self.assertEqual(c["estado"], "atencao")
        self.assertTrue(c["detalhe"].startswith("~/.cache cresce 3.0 GB por dia, o maior é huggingface com 3.7 GB"))
        self.assertIn("scoped_dir", c["o_que_fazer"])

    def test_acima_do_limite_como_antes_da_limpeza(self):
        self.tamanho["~/.cache"] = 46.2 * ds.GB
        c = self.rodar("2026-10-11T10:00")
        self.assertEqual(c["estado"], "atencao")
        self.assertTrue(c["detalhe"].startswith("~/.cache passou de 25.0 GB, o maior é google-chrome-headless com 37.2 GB"))

    def test_guarda_8_dias_e_compara_com_24_h_atras(self):
        for d in range(12):
            self.rodar(f"2026-10-{1 + d:02d}T10:00")
        medidas = json.loads(ds.TAMANHOS.read_text())["medidas"]
        self.assertEqual([m["em"][:10] for m in medidas][0], "2026-10-04")
        self.assertEqual(len(medidas), 9)
        t = br("2026-10-12T10:00").astimezone(timezone.utc)
        self.assertEqual(ds.medida_de_um_dia_atras(medidas, t)["em"][:10], "2026-10-11")
        self.assertIsNone(ds.medida_de_um_dia_atras(medidas[-1:], t))

    def test_du_que_falha_espera_uma_hora(self):
        self.tamanho["~/.cache"] = None
        c = self.rodar("2026-10-11T10:00")
        self.assertEqual(c["estado"], "atencao")
        self.assertIn("não consegui medir ~/.cache", c["detalhe"])
        self.assertIn("tenta de novo em uma hora", c["o_que_fazer"])
        self.rodar("2026-10-11T10:01")
        self.assertEqual(self.medicoes, 2)

    def test_medir_pasta_de_verdade(self):
        ds.medir_pasta = self.antes["medir_pasta"]
        raiz = self.dir / "pasta"
        for nome, kb in (("grande", 300), ("pequena", 10)):
            (raiz / nome).mkdir(parents=True)
            (raiz / nome / "f").write_bytes(b"x" * kb * 1024)
        m = ds.medir_pasta(raiz)
        self.assertGreaterEqual(m["total"], 310 * 1024)
        self.assertEqual([n for n, _ in m["maiores"]], ["grande", "pequena"])


class Instalados(unittest.TestCase):
    """O caso de 07/10/2026: o fix do observador estava no repo, a cópia em
    ~/.local/bin era de antes, e os avisos foram recusados o dia todo."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repo, self.home = self.tmp / "SquadOne", self.tmp / "home"
        self.addCleanup(shutil.rmtree, self.tmp)

    def escrever(self, base: Path, rel: str, texto: str, mtime: float | None = None) -> Path:
        p = base / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(texto)
        if mtime is not None:
            os.utime(p, (mtime, mtime))
        return p

    def test_tudo_igual(self):
        self.escrever(self.repo, "deploy/dell/dell-status.py", "v2")
        self.escrever(self.home, ".local/bin/dell-status", "v2")
        itens = ds.comparar_instalados([{"repo": "deploy/dell/dell-status.py", "instalado": "~/.local/bin/dell-status"}],
                                       self.repo, self.home)
        c = ds.avaliar_instalados(itens)
        self.assertEqual((c["estado"], c["detalhe"]), ("ok", "1 arquivo(s) iguais ao repositório"))

    def test_copia_velha_e_o_comando_que_reinstala(self):
        self.escrever(self.repo, "deploy/dell/whatsapp-observador/observador.py", "com origem", mtime=2_000)
        self.escrever(self.home, ".local/bin/whatsapp-observador", "sem origem", mtime=1_000)
        entrada = {"repo": "deploy/dell/whatsapp-observador/observador.py",
                   "instalado": "~/.local/bin/whatsapp-observador", "reiniciar": "whatsapp-observador"}
        [item] = ds.comparar_instalados([entrada], self.repo, self.home)
        self.assertEqual((item["estado"], item["mais_novo"]), ("diferente", False))
        self.assertEqual(ds.comando_instalar(item),
                         "install -D -m 755 ~/SquadOne/deploy/dell/whatsapp-observador/observador.py "
                         "~/.local/bin/whatsapp-observador && systemctl --user restart whatsapp-observador")
        c = ds.avaliar_instalados([item])
        self.assertEqual(c["estado"], "atencao")
        self.assertEqual(c["detalhe"], "1 de 1 diferente(s) do repositório: whatsapp-observador")
        self.assertIn("dell-status --instalados", c["o_que_fazer"])
        self.assertNotIn("Cuidado", c["o_que_fazer"])

    def test_copia_mais_nova_pede_comparacao(self):
        self.escrever(self.repo, "deploy/dell/site-pastas.py", "repo", mtime=1_000)
        self.escrever(self.home, ".local/bin/site-pastas", "mexido no Dell", mtime=2_000)
        itens = ds.comparar_instalados([{"repo": "deploy/dell/site-pastas.py", "instalado": "~/.local/bin/site-pastas"}],
                                       self.repo, self.home)
        self.assertTrue(itens[0]["mais_novo"])
        self.assertIn("Cuidado: site-pastas foi gravado no Dell depois", ds.avaliar_instalados(itens)["o_que_fazer"])

    def test_curinga_so_cobre_o_que_esta_instalado(self):
        for nome in ("crm.py", "aviso-origem.py", "n8n.test.py"):
            self.escrever(self.repo, f"deploy/dell/claude-ops/{nome}", "x")
        self.escrever(self.home, ".local/share/claude-ops/crm.py", "x")
        self.escrever(self.repo, "deploy/dell/backup/backup-dell-cofre.timer", "t")
        self.escrever(self.home, ".config/systemd/user/backup-dell-cofre.timer", "t velho")
        itens = ds.comparar_instalados([
            {"repo": "deploy/dell/claude-ops/*.py", "instalado": "~/.local/share/claude-ops/"},
            {"repo": "deploy/dell/**/*.timer", "instalado": "~/.config/systemd/user/"},
        ], self.repo, self.home)
        self.assertEqual([(i["instalado"], i["estado"]) for i in itens],
                         [("~/.local/share/claude-ops/crm.py", "igual"),
                          ("~/.config/systemd/user/backup-dell-cofre.timer", "diferente")])
        self.assertEqual(ds.comando_instalar(itens[1]),
                         "install -D -m 644 ~/SquadOne/deploy/dell/backup/backup-dell-cofre.timer "
                         "~/.config/systemd/user/backup-dell-cofre.timer && systemctl --user daemon-reload")

    def test_faltando_sem_origem_e_hermes(self):
        self.escrever(self.repo, "deploy/dell/backup/fontes.toml", "f")
        self.escrever(self.repo, "deploy/hermes/SOUL.md", "alma nova")
        self.escrever(self.home, ".hermes/SOUL.md", "alma velha")
        itens = ds.comparar_instalados([
            {"repo": "deploy/dell/backup/fontes.toml", "instalado": "~/.config/backup-dell/fontes.toml", "modo": "600"},
            {"repo": "deploy/dell/sumiu.py", "instalado": "~/.local/bin/sumiu"},
            {"repo": "deploy/hermes/SOUL.md", "instalado": "~/.hermes/SOUL.md", "via": "aplicar-hermes"},
        ], self.repo, self.home)
        self.assertEqual([i["estado"] for i in itens], ["faltando", "sem origem", "diferente"])
        self.assertEqual(ds.comando_instalar(itens[0]),
                         "install -D -m 600 ~/SquadOne/deploy/dell/backup/fontes.toml ~/.config/backup-dell/fontes.toml")
        self.assertIsNone(ds.comando_instalar(itens[1]))
        self.assertEqual(ds.comando_instalar(itens[2]), ds.APLICAR_HERMES)
        c = ds.avaliar_instalados(itens)
        self.assertEqual(c["detalhe"], "3 de 3 diferente(s) do repositório: fontes.toml, sumiu, SOUL.md")
        self.assertIn("(deploy/dell/sumiu.py): tire de lá", c["o_que_fazer"])

    def test_como_fazer_o_site_versionado_com_outro_nome_e_444(self):
        """08/10/2026: o ~/auto-site/CLAUDE.md vem de deploy/dell/auto-site/auto-site-CLAUDE.md
        (nome diferente: um CLAUDE.md dentro do repo viraria instrução de toda sessão no SquadOne)."""
        entrada = {"repo": "deploy/dell/auto-site/auto-site-CLAUDE.md", "instalado": "~/auto-site/CLAUDE.md", "modo": "444"}
        self.escrever(self.repo, entrada["repo"], "regras v2")
        [faltando] = ds.comparar_instalados([entrada], self.repo, self.home)
        self.assertEqual((faltando["instalado"], faltando["estado"]), ("~/auto-site/CLAUDE.md", "faltando"))
        self.assertEqual(ds.comando_instalar(faltando),
                         "install -D -m 444 ~/SquadOne/deploy/dell/auto-site/auto-site-CLAUDE.md ~/auto-site/CLAUDE.md")
        self.escrever(self.home, "auto-site/CLAUDE.md", "regras v1")
        [diferente] = ds.comparar_instalados([entrada], self.repo, self.home)
        self.assertEqual(diferente["estado"], "diferente")
        self.escrever(self.home, "auto-site/CLAUDE.md", "regras v2")
        [igual] = ds.comparar_instalados([entrada], self.repo, self.home)
        self.assertEqual(igual["estado"], "igual")

    def test_timers_desligados(self):
        """11/10/2026: o pncp-catchup.timer desligado (pausa do Radar) e, em 10/10, o gerador-de-sites."""
        antes = {k: getattr(ds, k) for k in ("REPO", "INSTALADOS", "HOME", "ESTADO_DIR", "PNCP_PAUSA",
                                             "PAUSA_DO_TIMER", "_estado_das_units")}
        self.addCleanup(lambda: [setattr(ds, k, v) for k, v in antes.items()])
        ds.REPO, ds.HOME = self.repo, self.home
        ds.INSTALADOS = self.escrever(self.repo, "deploy/dell/instalados.json", json.dumps({"arquivos": [
            {"repo": "deploy/dell/**/*.timer", "instalado": "~/.config/systemd/user/"},
            {"repo": "deploy/dell/**/*.service", "instalado": "~/.config/systemd/user/"}]}))
        for n in ("gerador-de-sites", "pncp-catchup", "dell-status", "nunca-instalado"):
            self.escrever(self.repo, f"deploy/dell/{n}.timer", n)
            self.escrever(self.repo, f"deploy/dell/{n}.service", n)
            if n != "nunca-instalado":
                self.escrever(self.home, f".config/systemd/user/{n}.timer", n)
        ds.ESTADO_DIR = self.home / ".local/state/dell-status"
        ds.PNCP_PAUSA = ds.ESTADO_DIR / "pausa-pncp"
        ds.PAUSA_DO_TIMER = {"pncp-catchup.timer": ds.PNCP_PAUSA}
        ligados = {"dell-status.timer", "gerador-de-sites.timer"}
        pedidos = []

        def estado(units):
            pedidos.append(units)
            return {u: {"Id": u, "ActiveState": "active" if u in ligados else "inactive",
                        "UnitFileState": "enabled" if u in ligados else "disabled"} for u in units}
        ds._estado_das_units = estado

        [c] = ds.timers_desligados()  # como na Mel em 11/10/2026, antes da marca do Radar
        self.assertEqual(pedidos, [["dell-status.timer", "gerador-de-sites.timer", "pncp-catchup.timer"]])
        self.assertEqual((c["estado"], c["detalhe"]), ("atencao", "Desligado(s) sem marca de pausa: pncp-catchup (disabled)"))
        self.assertIn("pausa-pncp-catchup", c["o_que_fazer"])
        self.assertIn("systemctl --user enable --now pncp-catchup.timer", c["o_que_fazer"])
        # A marca antiga do Radar (pausa-pncp) vale para o timer da repescagem.
        self.escrever(self.home, ".local/state/dell-status/pausa-pncp", "11/10/2026\n")
        [c] = ds.timers_desligados()
        self.assertEqual((c["estado"], c["detalhe"]), ("ok", "2 de 3 ligado(s); pausado(s) de propósito: "
                                                             "pncp-catchup (11/10/2026)"))
        # 10/10: o gerador desligado sem marca acende; com a marca, não; religado, a marca sobra.
        ligados.discard("gerador-de-sites.timer")
        self.assertIn("gerador-de-sites (disabled)", ds.timers_desligados()[0]["detalhe"])
        self.escrever(self.home, ".local/state/dell-status/pausa-gerador-de-sites", "")
        self.assertEqual(ds.timers_desligados()[0]["estado"], "ok")
        ligados.add("gerador-de-sites.timer")
        self.assertIn("marca de pausa sobrando (o timer está ligado): gerador-de-sites",
                      ds.timers_desligados()[0]["detalhe"])

    def test_manifesto_do_repo_e_valido(self):
        """O instalados.json de verdade: lê, e cada entrada sem curinga existe no repo."""
        manifesto = json.loads((AQUI / "instalados.json").read_text())
        raiz = AQUI.parent.parent
        for e in manifesto["arquivos"]:
            self.assertTrue(e["instalado"].startswith("~/"), e)
            if not any(c in e["repo"] for c in "*?["):
                self.assertTrue((raiz / e["repo"]).is_file(), e["repo"])
            else:
                self.assertTrue(list(raiz.glob(e["repo"])), e["repo"])


def unit(id_="graphify-projetos.service", carga="loaded", ativo="inactive", sub="dead", tipo="oneshot",
         resultado="success", codigo="1", status="0", religou="0", quando="@1791784892") -> dict:
    """Um bloco do `systemctl --user show` como o Dell devolve (12/10/2026)."""
    return {"Id": id_, "LoadState": carga, "ActiveState": ativo, "SubState": sub, "Type": tipo, "Result": resultado,
            "ExecMainCode": codigo, "ExecMainStatus": status, "NRestarts": religou, "StateChangeTimestamp": quando}


class Units(unittest.TestCase):
    """12/10/2026: os jobs que saíram do cron do Hermes para timers do systemd
    avisam pela fila quando falham, mas morto por SIGKILL ou OOM não grava nada."""

    T = br("2026-10-12T10:00")

    def test_tabela_de_casos(self):
        casos = [
            # (campos, estado, trecho do motivo)
            (unit(), "ok", None),  # oneshot de timer entre rodadas
            (unit(codigo="0", quando=""), "ok", None),  # instalada e nunca rodou
            (unit(id_="entrada.service", ativo="active", sub="running", tipo="simple", codigo="0"), "ok", None),
            (unit(ativo="activating", sub="start"), "ok", None),  # rodando agora
            (unit(ativo="failed", sub="failed", resultado="signal", codigo="2", status="9"), "atencao",
             "morta por SIGKILL (costuma ser falta de memória)"),
            (unit(ativo="failed", sub="failed", resultado="signal", codigo="2", status="15"), "atencao",
             "morta por SIGTERM"),
            (unit(ativo="failed", sub="failed", resultado="oom-kill", codigo="2", status="9"), "atencao",
             "morta por falta de memória (OOM)"),
            (unit(ativo="failed", sub="failed", resultado="timeout", codigo="2", status="15"), "atencao",
             "passou do tempo limite"),
            (unit(ativo="failed", sub="failed", resultado="exit-code", codigo="1", status="2"), "atencao",
             "saiu com código 2"),
            (unit(ativo="failed", sub="failed", resultado="core-dump", codigo="3", status="11"), "atencao",
             "quebrou com SIGSEGV (core dump)"),
            (unit(ativo="failed", sub="failed", resultado="start-limit-hit"), "atencao", "religou vezes demais"),
            (unit(id_="entrada.service", ativo="activating", sub="auto-restart", tipo="simple", resultado="exit-code",
                  codigo="1", status="1"), "atencao", "saiu com código 1; o systemd está religando"),
            (unit(ativo="failed", sub="failed", resultado="algo-novo"), "atencao", "falhou (algo-novo)"),
            (unit(carga="bad-setting"), "atencao", "o arquivo da unit não carrega (bad-setting)"),
        ]
        for campos, estado, motivo in casos:
            with self.subTest(campos=campos):
                a = ds.avaliar_unit(campos)
                self.assertEqual(a["estado"], estado)
                if motivo:
                    self.assertIn(motivo, a["motivo"])

    def test_nao_instalada_ou_mascarada_nao_acende(self):
        for carga in ("not-found", "masked", ""):
            self.assertIsNone(ds.avaliar_unit(unit(carga=carga, ativo="inactive", resultado="")), carga)

    def test_tudo_bem_e_religadas(self):
        us = [ds.avaliar_unit(unit()), ds.avaliar_unit(unit(id_="hermes-google-browser.service", ativo="active",
                                                             sub="running", tipo="simple", religou="5"))]
        c = ds.avaliar_units(us, self.T)
        self.assertEqual((c["id"], c["estado"]), ("units", "ok"))
        self.assertEqual(c["detalhe"], "2 unit(s) sem queda registrada; religada(s) pelo systemd desde o último "
                                       "start: hermes-google-browser (5x)")

    def test_sigkill_no_graphify(self):
        morto = br("2026-10-12T03:12").timestamp()
        us = [ds.avaliar_unit(unit(ativo="failed", sub="failed", resultado="signal", codigo="2", status="9",
                                   quando=f"@{morto:.0f}")),
              ds.avaliar_unit(unit(id_="sites-e-pendencias.service"))]
        c = ds.avaliar_units(us, self.T)
        self.assertEqual(c["estado"], "atencao")
        self.assertNotIn("sozinho", c)
        self.assertEqual(c["detalhe"], "Caiu/caíram: graphify-projetos (morta por SIGKILL (costuma ser falta de "
                                       "memória), às 03:12)")
        self.assertIn("journalctl --user -u graphify-projetos.service -n 50", c["o_que_fazer"])
        self.assertIn("journalctl -k -g oom", c["o_que_fazer"])
        self.assertIn("systemctl --user reset-failed graphify-projetos.service", c["o_que_fazer"])
        self.assertIs(ds.explicar(c), c)  # o texto próprio não é trocado pelo genérico

    def test_servico_que_fica_rodando_pede_restart_e_data_de_outro_dia(self):
        ontem = br("2026-10-11T22:05").timestamp()
        c = ds.avaliar_units([ds.avaliar_unit(unit(id_="entrada.service", ativo="failed", sub="failed", tipo="simple",
                                                   resultado="oom-kill", codigo="2", status="9",
                                                   quando=f"@{ontem:.0f}"))], self.T)
        self.assertIn("(morta por falta de memória (OOM), às 22:05 de 11/10)", c["detalhe"])
        self.assertIn("systemctl --user restart entrada.service", c["o_que_fazer"])
        self.assertNotIn("reset-failed", c["o_que_fazer"])

    def test_quais_units_entram(self):
        """Só .service que o repo instala e está instalado; sem as que têm verificação própria."""
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        repo, home = tmp / "SquadOne", tmp / "home"
        antes = {k: getattr(ds, k) for k in ("REPO", "INSTALADOS", "HOME", "_campos_das_units")}
        self.addCleanup(lambda: [setattr(ds, k, v) for k, v in antes.items()])
        ds.REPO, ds.HOME = repo, home
        ds.INSTALADOS = repo / "deploy/dell/instalados.json"
        ds.INSTALADOS.parent.mkdir(parents=True)
        ds.INSTALADOS.write_text(json.dumps({"arquivos": [
            {"repo": "deploy/dell/**/*.service", "instalado": "~/.config/systemd/user/"},
            {"repo": "deploy/dell/**/*.timer", "instalado": "~/.config/systemd/user/"},
            {"repo": "deploy/hermes/units/hermes-gateway.service", "instalado": "~/.config/systemd/user/"}]}))
        for n in ("graphify-projetos.service", "graphify-projetos.timer", "gerador-de-sites.service",
                  "nunca-instalada.service", "../hermes/units/hermes-gateway.service"):
            p = repo / "deploy/dell" / n
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(n)
            if not n.startswith("nunca"):
                q = home / ".config/systemd/user" / Path(n).name
                q.parent.mkdir(parents=True, exist_ok=True)
                q.write_text(n)
        pedidos = []

        def campos(units):
            pedidos.append(units)
            return {u: unit(id_=u) for u in units}
        ds._campos_das_units = campos
        [c] = ds.units_que_cairam()
        self.assertEqual(pedidos, [["graphify-projetos.service", "hermes-gateway.service"]])
        self.assertEqual(c["detalhe"], "2 unit(s) sem queda registrada")
        # O systemd não conhece nenhuma (sem daemon-reload): nada a mostrar, sem amarelo.
        ds._campos_das_units = lambda units: {u: unit(id_=u, carga="not-found") for u in units}
        self.assertEqual(ds.units_que_cairam(), [])


SEGREDO_FALSO = "segredo-falso-do-teste-0123456789"


def pilha(**mudancas) -> dict:
    """Tudo no ar e o número já conectado; cada caso muda só o que o interessa."""
    base = {"containers": {n: "running" for n in ds.EVOLUTION_CONTAINERS},
            "units": {ds.EVOLUTION_ADAPTADOR: True, ds.EVOLUTION_OBSERVADOR: True},
            "saude": {"ok": True, "desconectado": False, "lista_de_leads": True, "ultimo_evento": 1760000000,
                      "eventos": 4, "ignorados": 1, "recibos": {}},
            "conectou": True}
    base.update(mudancas)
    return base


def variar(**mudancas) -> dict:
    d = pilha()
    d["containers"] = {**d["containers"], **mudancas.get("containers", {})}
    d["units"] = {**d["units"], **mudancas.get("units", {})}
    d["saude"] = mudancas["saude"] if "saude" in mudancas else {**d["saude"], **mudancas.get("campos", {})}
    d["conectou"] = mudancas.get("conectou", True)
    return d


class WhatsAppPrumo(unittest.TestCase):
    """A pilha da Evolution para o número só do PRUMO (16/10/2026). A função de avaliação é pura;
    o coletor lê Docker, systemd e o /saude do adaptador, e aqui tudo isso é dublê."""

    def test_tabela_de_casos(self):
        casos = [
            ("tudo certo", variar(), "ok", "3 containers, adaptador e observador no ar, número conectado"),
            ("o número caiu", variar(campos={"desconectado": True}), "falha", "O número do PRUMO caiu"),
            ("caiu mesmo com o resto fora do ar", variar(campos={"desconectado": True},
                                                      units={ds.EVOLUTION_OBSERVADOR: False}), "falha",
             "O número do PRUMO caiu"),
            ("nunca pareou, observador desligado de propósito",
             variar(conectou=False, units={ds.EVOLUTION_OBSERVADOR: False}, campos={"lista_de_leads": False}),
             "atencao", "ainda não foi pareado (QR não lido)"),
            ("nunca pareou e o close do QR vira desconectado", variar(conectou=False, campos={"desconectado": True}),
             "atencao", "ainda não foi pareado"),
            ("container parado depois de conectar", variar(containers={"evolution-redis-1": "exited"}), "falha",
             "evolution-redis-1"),
            ("container ausente depois de conectar", variar(containers={"evolution-postgres-1": None}), "falha",
             "evolution-postgres-1"),
            ("container parado antes do QR é só amarelo", variar(conectou=False, containers={"evolution-api-1": "exited"}),
             "atencao", "evolution-api-1"),
            ("Docker sem resposta", {**variar(), "containers": {}}, "falha", "evolution-api-1"),
            ("adaptador parado", variar(units={ds.EVOLUTION_ADAPTADOR: False}), "falha", "evolution-adaptador"),
            ("observador parado depois de conectar", variar(units={ds.EVOLUTION_OBSERVADOR: False}), "falha",
             "whatsapp-observador-prumo"),
            ("adaptador parado antes do QR", variar(conectou=False, units={ds.EVOLUTION_ADAPTADOR: False}),
             "atencao", "evolution-adaptador"),
            ("systemd sem resposta", {**variar(), "units": {}}, "falha", "unit(s) fora do ar"),
            ("/saude sem resposta", variar(saude=None), "falha", "/saude"),
            ("/saude sem resposta antes do QR", variar(conectou=False, saude=None), "atencao", "/saude"),
            ("/saude que não é objeto", {**variar(), "saude": ["x"]}, "falha", "/saude"),
            ("sem a lista de leads", variar(campos={"lista_de_leads": False}), "atencao", "sem a lista de leads"),
            ("lista de leads ausente da resposta", variar(saude={"ok": True, "desconectado": False}), "atencao",
             "sem a lista de leads"),
        ]
        for nome, dados, estado, trecho in casos:
            with self.subTest(nome):
                c = ds.avaliar_whatsapp_prumo(dados)
                self.assertEqual((c["id"], c["grupo"], c["nome"]), ("whatsapp-prumo", "servicos", "WhatsApp do PRUMO (Evolution)"))
                self.assertEqual(c["estado"], estado, c["detalhe"])
                self.assertIn(trecho, c["detalhe"])
                if estado == "ok":
                    self.assertNotIn("o_que_fazer", c)
                else:
                    self.assertTrue(c["o_que_fazer"])
                    self.assertLess(len(c["o_que_fazer"]), 600)

    def test_numero_caido_diz_como_pedir_o_qr(self):
        c = ds.avaliar_whatsapp_prumo(variar(campos={"desconectado": True}))
        self.assertIn("reconectar lendo o QR", c["o_que_fazer"])
        self.assertIn("deploy/dell/README.md", c["o_que_fazer"])
        self.assertIn("Observador do número do PRUMO", c["o_que_fazer"])

    def test_antes_do_qr_nunca_e_falha(self):
        """Todas as combinações de peça fora, sem a marca `conectou`: no máximo atenção."""
        for fora in ({"containers": {}}, {"units": {}}, {"saude": None}, {"containers": {}, "units": {}, "saude": None}):
            with self.subTest(fora):
                c = ds.avaliar_whatsapp_prumo({**variar(conectou=False), **fora})
                self.assertEqual(c["estado"], "atencao")

    def test_o_que_fazer_nomeia_o_conserto(self):
        c = ds.avaliar_whatsapp_prumo(variar(containers={"evolution-api-1": "exited"}))
        self.assertIn("docker compose up -d", c["o_que_fazer"])
        c = ds.avaliar_whatsapp_prumo(variar(units={ds.EVOLUTION_ADAPTADOR: False}))
        self.assertIn("systemctl --user restart evolution-adaptador", c["o_que_fazer"])
        c = ds.avaliar_whatsapp_prumo(variar(campos={"lista_de_leads": False}))
        self.assertIn("whatsapp-observador-prumo", c["o_que_fazer"])

    def test_nada_do_que_a_saude_traz_vai_para_o_status(self):
        """Mesmo que o /saude venha com segredo, chave ou telefone de brinde, só o veredito sai."""
        veneno = {"segredo": SEGREDO_FALSO, "apikey": "chave-falsa-da-api", "telefone": "5511999990000"}
        for campos in ({}, {"desconectado": True}, {"lista_de_leads": False}):
            for conectou in (True, False):
                with self.subTest(campos=campos, conectou=conectou):
                    texto = json.dumps(ds.avaliar_whatsapp_prumo(variar(conectou=conectou, campos={**veneno, **campos})))
                    for x in (*veneno.values(), "551199999"):
                        self.assertNotIn(x, texto)

    def test_o_que_fazer_do_monitor_nao_sobrescreve_o_da_verificacao(self):
        c = ds.explicar(ds.avaliar_whatsapp_prumo(variar(campos={"desconectado": True})))
        self.assertIn("reconectar lendo o QR", c["o_que_fazer"])

    # ---- o coletor, com dublês

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        for nome, valor in (("EVOLUTION_COMPOSE", self.tmp / "workspace/evolution/docker-compose.yml"),
                            ("EVOLUTION_CONECTOU", self.tmp / "estado/conectou"),
                            ("EVOLUTION_SEGREDO", self.tmp / "config/segredo")):
            p = mock.patch.object(ds, nome, valor)
            p.start()
            self.addCleanup(p.stop)

    def instalar_pilha(self):
        ds.EVOLUTION_COMPOSE.parent.mkdir(parents=True)
        ds.EVOLUTION_COMPOSE.write_text("services: {}\n")

    def dubles(self, containers=None, units=None, saude=None):
        for nome, valor in (("_evolution_containers", containers), ("_evolution_units", units),
                            ("_evolution_saude", saude)):
            p = mock.patch.object(ds, nome, return_value=valor)
            p.start()
            self.addCleanup(p.stop)

    def test_sem_o_compose_a_verificacao_nao_aparece_e_nada_e_lido(self):
        explode = mock.Mock(side_effect=AssertionError("não devia ler nada"))
        with mock.patch.object(ds, "_evolution_containers", explode), mock.patch.object(ds, "_evolution_units", explode), \
                mock.patch.object(ds, "_evolution_saude", explode):
            self.assertEqual(ds.whatsapp_prumo(), [])
        explode.assert_not_called()

    def test_com_o_compose_junta_as_tres_leituras(self):
        self.instalar_pilha()
        d = pilha()
        self.dubles(d["containers"], d["units"], d["saude"])
        [c] = ds.whatsapp_prumo()
        self.assertEqual(c["estado"], "atencao")  # a marca `conectou` ainda não existe
        self.assertIn("QR não lido", c["detalhe"])
        ds.EVOLUTION_CONECTOU.parent.mkdir(parents=True)
        ds.EVOLUTION_CONECTOU.write_text("")
        [c] = ds.whatsapp_prumo()
        self.assertEqual((c["estado"], c["detalhe"]),
                         ("ok", "3 containers, adaptador e observador no ar, número conectado"))

    def test_leitura_que_levanta_vira_atencao_generica(self):
        self.instalar_pilha()
        self.dubles({}, {}, None)
        with mock.patch.object(ds, "_evolution_units", side_effect=RuntimeError(f"X-Adaptador: {SEGREDO_FALSO} 5511999990000")):
            [c] = ds.whatsapp_prumo()
        self.assertEqual(c["estado"], "atencao")
        self.assertEqual(c["detalhe"], "Não consegui conferir a pilha do WhatsApp do PRUMO agora")
        texto = json.dumps(c)
        self.assertNotIn(SEGREDO_FALSO, texto)
        self.assertNotIn("5511999990000", texto)

    def test_saude_manda_o_segredo_no_cabecalho_e_com_timeout_curto(self):
        ds.EVOLUTION_SEGREDO.parent.mkdir(parents=True)
        ds.EVOLUTION_SEGREDO.write_text(SEGREDO_FALSO + "\n")
        with mock.patch.object(ds, "http_json", return_value={"ok": True, "desconectado": False}) as http:
            self.assertEqual(ds._evolution_saude(), {"ok": True, "desconectado": False})
        (url,), kw = http.call_args
        self.assertEqual(url, "http://172.28.77.1:9131/saude")
        self.assertEqual(kw["headers"], {"X-Adaptador": SEGREDO_FALSO})
        self.assertLessEqual(kw["timeout"], 3)

    def test_saude_nunca_levanta_nem_repassa_o_erro(self):
        ds.EVOLUTION_SEGREDO.parent.mkdir(parents=True)
        ds.EVOLUTION_SEGREDO.write_text(SEGREDO_FALSO)
        for erro in (OSError(f"recusado {SEGREDO_FALSO}"), TimeoutError("lento"), ValueError("json ruim")):
            with self.subTest(type(erro).__name__), mock.patch.object(ds, "http_json", side_effect=erro):
                self.assertIsNone(ds._evolution_saude())
        with mock.patch.object(ds, "http_json", return_value=["não é objeto"]):
            self.assertIsNone(ds._evolution_saude())

    def test_saude_sem_segredo_nem_tenta_a_rede(self):
        with mock.patch.object(ds, "http_json") as http:
            self.assertIsNone(ds._evolution_saude())  # arquivo ausente
            ds.EVOLUTION_SEGREDO.parent.mkdir(parents=True)
            ds.EVOLUTION_SEGREDO.write_text("  \n")
            self.assertIsNone(ds._evolution_saude())  # arquivo vazio
        http.assert_not_called()

    def test_docker_ps(self):
        saida = types.SimpleNamespace(returncode=0, stdout="evolution-api-1\trunning\nevolution-redis-1\texited\noutro\tx\n")
        with mock.patch.object(ds.subprocess, "run", return_value=saida) as run:
            self.assertEqual(ds._evolution_containers(), {"evolution-api-1": "running", "evolution-postgres-1": None,
                                                          "evolution-redis-1": "exited"})
        self.assertLessEqual(run.call_args.kwargs["timeout"], 3)
        self.assertEqual(run.call_args.args[0][:3], ["docker", "ps", "-a"])
        for erro in (subprocess.TimeoutExpired("docker", 3), FileNotFoundError("docker")):
            with self.subTest(type(erro).__name__), mock.patch.object(ds.subprocess, "run", side_effect=erro):
                self.assertEqual(ds._evolution_containers(), {})
        with mock.patch.object(ds.subprocess, "run", return_value=types.SimpleNamespace(returncode=1, stdout="")):
            self.assertEqual(ds._evolution_containers(), {})

    def test_systemctl_is_active(self):
        def roda(stdout):
            return mock.patch.object(ds.subprocess, "run", return_value=types.SimpleNamespace(returncode=3, stdout=stdout))
        with roda("active\ninactive\n") as run:
            self.assertEqual(ds._evolution_units(), {"evolution-adaptador": True, "whatsapp-observador-prumo": False})
        self.assertLessEqual(run.call_args.kwargs["timeout"], 3)
        with roda("failed\nactive\n"):
            self.assertEqual(ds._evolution_units(), {"evolution-adaptador": False, "whatsapp-observador-prumo": True})
        with roda(""):  # systemd mudo: nenhuma conta como ativa
            self.assertEqual(ds._evolution_units(), {"evolution-adaptador": False, "whatsapp-observador-prumo": False})
        with mock.patch.object(ds.subprocess, "run", side_effect=subprocess.TimeoutExpired("systemctl", 2)):
            self.assertEqual(ds._evolution_units(), {})

    def test_esta_na_lista_de_verificacoes_do_main(self):
        self.assertIn("whatsapp_prumo", [f.__name__ for f in ds.VERIFICACOES])


class Socorro(unittest.TestCase):
    """16/10/2026: falha NOVA grava um pedido para o socorro (outro processo) e o "Quebrou" ganha uma linha.
    Pasta temporária no lugar de ~/.local; o envio pelo Hermes é dublê."""

    T = datetime(2026, 10, 16, 15, 0, tzinfo=timezone.utc)

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="ds-socorro-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.bin = self.dir / "bin/socorro"
        self.bin.parent.mkdir()
        self.bin.write_text("#!/bin/sh\n")
        for nome, valor in (("SOCORRO", self.bin), ("SOCORRO_PEDIDOS", self.dir / "estado/pedidos"),
                            ("SOCORRO_DESLIGADO", self.dir / "config/desligado")):
            p = mock.patch.object(ds, nome, valor)
            p.start()
            self.addCleanup(p.stop)
        env = mock.patch.dict(os.environ, {"SOCORRO_DESLIGADO": ""})
        env.start()
        self.addCleanup(env.stop)
        self.enviadas = []
        p = mock.patch.object(ds, "enfileirar_alerta_do_dell", side_effect=lambda titulo, texto, chave, prioridade=ds.PRIORIDADE_PADRAO: self.enviadas.append(titulo + '\n' + texto) or True)
        p.start()
        self.addCleanup(p.stop)
        p = mock.patch.object(ds, "unit_ativa", lambda u: u == "socorro.path")  # o socorro.path está de pé
        p.start()
        self.addCleanup(p.stop)

    def checks(self, estado="falha"):
        return [ds.check("n8n", "servicos", "n8n", estado, "Sem resposta: timed out", o_que_fazer="Peça ao Claude."),
                ds.check("disco", "maquina", "Disco", "ok", "40% usado")]

    def pedidos(self):
        return [json.loads(f.read_text()) for f in sorted((self.dir / "estado/pedidos").glob("*.json"))]

    def test_falha_nova_grava_um_pedido_e_o_quebrou_diz(self):
        ids = ds.pedir_socorro(self.checks(), {"n8n": {"estado": "ok"}}, self.T)
        self.assertEqual(ids, {"n8n"})
        (p,) = self.pedidos()
        self.assertEqual(p["checks"], [{"id": "n8n", "grupo": "servicos", "nome": "n8n", "detalhe": "Sem resposta: timed out",
                                        "o_que_fazer": "Peça ao Claude."}])
        self.assertEqual(list((self.dir / "estado").glob(".*.tmp")), [])
        ds.avisar_transicoes(self.checks(), {"n8n": {"estado": "ok"}}, self.T, ids)
        self.assertIn("Quebrou:", self.enviadas[0])
        self.assertIn(ds.LINHA_DO_SOCORRO, self.enviadas[0])

    def test_falha_que_continua_nao_pede_de_novo(self):
        self.assertEqual(ds.pedir_socorro(self.checks(), {"n8n": {"estado": "falha"}}, self.T), set())
        self.assertEqual(self.pedidos(), [])

    def test_ok_e_atencao_nao_pedem(self):
        self.assertEqual(ds.pedir_socorro(self.checks("atencao"), {}, self.T), set())

    def test_desligado_pela_marca_ou_pelo_ambiente_nao_pede_e_o_quebrou_fica_igual(self):
        (self.dir / "config").mkdir()
        (self.dir / "config/desligado").write_text("")
        self.assertEqual(ds.pedir_socorro(self.checks(), {}, self.T), set())
        (self.dir / "config/desligado").unlink()
        with mock.patch.dict(os.environ, {"SOCORRO_DESLIGADO": "1"}):
            self.assertEqual(ds.pedir_socorro(self.checks(), {}, self.T), set())
        self.assertEqual(self.pedidos(), [])
        ds.avisar_transicoes(self.checks(), {}, self.T, set())
        self.assertIn("Quebrou:", self.enviadas[0])
        self.assertNotIn("Socorro", self.enviadas[0])

    def test_sem_o_socorro_instalado_nao_pede(self):
        self.bin.unlink()
        self.assertEqual(ds.pedir_socorro(self.checks(), {}, self.T), set())

    def test_erro_ao_gravar_nao_derruba(self):
        (self.dir / "estado").write_text("é um arquivo")
        with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(ds.pedir_socorro(self.checks(), {}, self.T), set())

    def test_avisar_transicoes_sem_socorro_e_o_de_antes(self):
        ds.avisar_transicoes(self.checks(), {}, self.T)
        self.assertNotIn("Socorro", self.enviadas[0])

    def test_main_pede_o_socorro_antes_de_avisar(self):
        fonte = inspect.getsource(ds.main)
        self.assertLess(fonte.index("pedir_socorro"), fonte.index("avisar_transicoes"))


TOKEN = "123456:" + "A" * 35


class _RespostaDoBot(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FalhasPeloTelegram(unittest.TestCase):
    """16/10/2026 (OT-14): o "Quebrou" e o aviso do socorro vão pelo bot do Telegram, sem som das 22h às 7h
    (salvo P0); o WhatsApp do número de vendas só recebe se o bot falhar. A Bot API é dublê (urlopen);
    o operations.env é um temporário."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="ds-telegram-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.env = self.dir / "operations.env"
        self.env.write_text(f'SQUADONE_MODE=operations\nTELEGRAM_BOT_TOKEN="{TOKEN}"\nTELEGRAM_CHAT_IDS=111\n')
        p = mock.patch.object(ds, "OPERATIONS_ENV", self.env)
        p.start()
        self.addCleanup(p.stop)
        self.pedidos: list[dict] = []
        self.bot_no_ar = True

        def urlopen(req, timeout=None):
            self.assertEqual(req.full_url, f"https://api.telegram.org/bot{TOKEN}/sendMessage")
            self.pedidos.append(json.loads(req.data))
            if not self.bot_no_ar:
                raise ds.urllib.error.URLError("rede fora")
            return _RespostaDoBot(b'{"ok": true, "result": {}}')
        p = mock.patch.object(ds.urllib.request, "urlopen", side_effect=urlopen)
        p.start()
        self.addCleanup(p.stop)
        self.whatsapp: list[str] = []
        self.hermes_no_ar = True
        p = mock.patch.object(ds, "enviar", side_effect=lambda m: self.hermes_no_ar and (self.whatsapp.append(m) or True))
        p.start()
        self.addCleanup(p.stop)
        self.fila()

    def transicoes(self, checks, anterior, t):
        novo = ds.avisar_transicoes(checks, anterior, t)
        ds.drenar_fila(t)
        return novo

    # --- a configuração: do operations.env, sem copiar o segredo

    def test_config_vem_do_operations_env_e_o_ambiente_manda(self):
        self.assertEqual(ds.config_do_telegram(), (TOKEN, [111]))
        with mock.patch.dict(os.environ, {"TELEGRAM_CHAT_IDS": " 222, 333 "}):
            self.assertEqual(ds.config_do_telegram(), (TOKEN, [222, 333]))

    def test_sem_bot_ou_mal_configurado_e_none(self):
        for conteudo in ("SQUADONE_MODE=operations\n",                                   # sem bot
                         f"TELEGRAM_BOT_TOKEN={TOKEN}\n",                                 # sem chat: não abre
                         f"TELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_IDS=-100123\n",       # grupo
                         f"TELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_IDS=111,abc\n",
                         "TELEGRAM_BOT_TOKEN=abc\nTELEGRAM_CHAT_IDS=111\n"):
            self.env.write_text(conteudo)
            self.assertIsNone(ds.config_do_telegram(), conteudo)
        self.env.unlink()
        self.assertIsNone(ds.config_do_telegram())

    # --- o transporte

    def test_envia_texto_puro_e_silencioso_vira_disable_notification(self):
        self.assertTrue(ds.enviar_telegram("⚠️ Dell worker\nQuebrou", silencioso=False))
        self.assertTrue(ds.enviar_telegram("noite", silencioso=True))
        self.assertEqual(self.pedidos, [{"chat_id": 111, "text": "⚠️ Dell worker\nQuebrou"},
                                        {"chat_id": 111, "text": "noite", "disable_notification": True}])

    def test_falha_do_bot_e_false_e_o_log_nao_leva_o_token(self):
        def http_401(req, timeout=None):
            raise ds.urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)
        for erro in (http_401, ds.urllib.error.URLError("x"), TimeoutError()):
            with mock.patch.object(ds.urllib.request, "urlopen", side_effect=erro), \
                    contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertFalse(ds.enviar_telegram("x", silencioso=False))
            self.assertIn("telegram", err.getvalue())
            self.assertNotIn(TOKEN.split(":")[1], err.getvalue())
        with mock.patch.object(ds.urllib.request, "urlopen", return_value=_RespostaDoBot(b'{"ok": false}')), \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertFalse(ds.enviar_telegram("x", silencioso=False))

    def test_mensagem_longa_e_cortada_no_limite_da_bot_api(self):
        ds.enviar_telegram("x" * 5000, silencioso=False)
        texto = self.pedidos[0]["text"]
        self.assertEqual(len(texto), ds.MAX_TELEGRAM)
        self.assertTrue(texto.endswith("o resto está na Central)"))

    # --- o "Quebrou" do dell-status

    def checks(self):
        return [ds.check("n8n", "servicos", "n8n", "falha", "Sem resposta", o_que_fazer="Peça ao Claude.")]

    def test_quebrou_vai_pelo_telegram_e_nao_pelo_whatsapp(self):
        novo = self.transicoes(self.checks(), {}, br("2026-10-16T15:00"))
        self.assertEqual(len(self.pedidos), 1)
        self.assertIn("Quebrou:", self.pedidos[0]["text"])
        self.assertNotIn("disable_notification", self.pedidos[0])  # de dia, com som
        self.assertEqual(self.whatsapp, [])
        self.assertIn("avisado", novo["n8n"])

    def test_de_noite_chega_sem_som(self):
        self.transicoes(self.checks(), {}, br("2026-10-16T23:30"))
        self.assertTrue(self.pedidos[0]["disable_notification"])
        self.assertEqual(self.whatsapp, [])
        self.pedidos.clear()
        self.transicoes([], {"n8n": {"estado": "falha"}}, br("2026-10-17T06:59"))
        self.assertEqual(self.pedidos, [])  # sumiu: não avisa
        self.transicoes([ds.check("n8n", "servicos", "n8n", "ok", "ok")], {"n8n": {"estado": "falha"}},
                             br("2026-10-17T07:00"))
        self.assertIn("Voltou ao normal", self.pedidos[0]["text"])
        self.assertNotIn("disable_notification", self.pedidos[0])

    def test_bot_fora_fica_na_outbox_sem_whatsapp(self):
        self.bot_no_ar = False
        with contextlib.redirect_stderr(io.StringIO()):
            novo = self.transicoes(self.checks(), {}, br("2026-10-16T15:00"))
        self.assertEqual(self.whatsapp, [])
        self.assertEqual(len(list(ds.FILA.glob('*.json'))), 1)
        self.assertIn("avisado", novo["n8n"])

    def test_sem_bot_configurado_continua_pendente_sem_whatsapp(self):
        self.env.write_text("SQUADONE_MODE=operations\n")
        self.transicoes(self.checks(), {}, br("2026-10-16T15:00"))
        self.assertEqual(self.pedidos, [])
        self.assertEqual(self.whatsapp, [])
        self.assertEqual(len(list(ds.FILA.glob('*.json'))), 1)

    def test_reinicio_reenvia_outbox_e_cursor_nao_duplica_aviso(self):
        self.bot_no_ar, self.hermes_no_ar = False, False
        with contextlib.redirect_stderr(io.StringIO()):
            novo = self.transicoes(self.checks(), {}, br("2026-10-16T15:00"))
        self.assertIn('avisado', novo['n8n'])  # publicado, ainda não entregue
        ds.gravar_privado(self.dir / 'cursor.json', novo)
        self.bot_no_ar = True
        self.transicoes(self.checks(), json.loads((self.dir / 'cursor.json').read_text()), br('2026-10-16T15:01'))
        self.assertEqual(len(self.pedidos), 2)  # falhou + entregou
        self.assertEqual(list(ds.FILA.glob('*.json')), [])
        self.assertEqual(self.whatsapp, [])

    # --- o aviso do socorro, pela fila

    def fila(self):
        for nome, valor in (("FILA", self.dir / "fila"), ("FILA_TRAVA", self.dir / "estado/fila.lock"),
                            ("FILA_ESTADO", self.dir / "estado/fila.json"),
                            ("FILA_RECUSADOS", self.dir / "estado/recusados"), ("FRESCOR_S", 0)):
            p = mock.patch.object(ds, nome, valor)
            p.start()
            self.addCleanup(p.stop)
        ds.FILA.mkdir(exist_ok=True)

    def gravar(self, nome: str, **extra) -> Path:
        f = ds.FILA / nome
        f.write_text(json.dumps(aviso(**extra)), encoding="utf-8")
        return f

    def test_socorro_sai_pelo_telegram_e_o_resto_da_fila_pelo_whatsapp(self):
        self.fila()
        s = self.gravar("socorro.json", titulo="🛟 Socorro do Dell", origem="socorro", prioridade=1, chave="s:1")
        self.gravar("lembrete.json", titulo="Lembrete", origem="squadone-lembretes")
        r = ds.drenar_fila(br("2026-10-16T15:00"))
        self.assertEqual((r["pelo_telegram"], r["enviados"]), (1, 1))
        self.assertEqual([p["text"].split("\n")[0] for p in self.pedidos], ["🛟 Socorro do Dell"])
        self.assertEqual([m.split("\n")[0] for m in self.whatsapp], ["Lembrete"])
        self.assertFalse(s.exists())
        # Não conta no teto do WhatsApp, mas a chave vale: o mesmo aviso não sai de novo em 24 h.
        self.assertEqual(len(json.loads(ds.FILA_ESTADO.read_text())["envios"]), 1)
        self.gravar("de-novo.json", titulo="🛟 Socorro do Dell", origem="socorro", chave="s:1")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(ds.drenar_fila(br("2026-10-16T15:05"))["descartados"], 1)
        self.assertEqual(len(self.pedidos), 1)

    def test_socorro_de_noite_sai_na_hora_sem_som(self):
        self.fila()
        self.gravar("socorro.json", titulo="🛟 Socorro do Dell", origem="socorro", prioridade=1)
        espera = self.gravar("outro.json", titulo="Outro")
        r = ds.drenar_fila(br("2026-10-16T23:30"))
        self.assertEqual((r["pelo_telegram"], r["enviados"], r["esperando"]), (1, 0, 1))
        self.assertTrue(self.pedidos[0]["disable_notification"])
        self.assertTrue(espera.exists())

    def test_bot_fora_o_socorro_aguarda_sem_expirar_nem_whatsapp(self):
        self.fila()
        self.bot_no_ar = False
        s = self.gravar("a.json", titulo="🛟 Socorro A", origem="socorro", prioridade=1)
        self.gravar("b.json", titulo="🛟 Socorro B", origem="socorro", prioridade=1)
        with contextlib.redirect_stderr(io.StringIO()):
            r = ds.drenar_fila(br("2026-10-16T23:30"))  # de noite: espera, não vai ao WhatsApp
            self.assertEqual((r["pelo_telegram"], r["enviados"], r["esperando"]), (0, 0, 2))
            self.assertEqual(len(self.pedidos), 1)  # uma tentativa só por drenagem
            self.assertTrue(s.exists())
            r = ds.drenar_fila(br("2026-10-17T07:00"))
        self.assertEqual((r["pelo_telegram"], r["enviados"], r['esperando']), (0, 0, 2))
        self.assertEqual(self.whatsapp, [])
        self.bot_no_ar = True
        self.assertEqual(ds.drenar_fila(br('2026-10-18T07:00'))['pelo_telegram'], 2)


def falso_run(saidas: dict, vistos: list):
    """subprocess.run falso: `saidas` mapeia o começo do comando à resposta; registra os kwargs de cada chamada."""
    def run(cmd, **kw):
        vistos.append((cmd, kw))
        for inicio, resposta in saidas.items():
            if list(cmd[:len(inicio)]) == list(inicio):
                if isinstance(resposta, Exception):
                    raise resposta
                return types.SimpleNamespace(returncode=0, stdout=resposta, stderr="")
        raise AssertionError(f"comando inesperado: {cmd}")
    return run


class PrazosDoMonitor(unittest.TestCase):
    """HC-2: o monitor não pode estourar o TimeoutStartSec antes de gravar o status.json."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="ds-prazos-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        for nome, valor in (("ESTADO_DIR", self.dir / "estado"), ("FLUXOS_VISTOS", self.dir / "fluxos.json")):
            p = mock.patch.object(ds, nome, valor)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(ds.fluxos_vistos.clear)

    def test_com_prazo_devolve_levanta_e_desiste(self):
        self.assertEqual(ds.com_prazo(lambda: 7, 1), 7)
        with self.assertRaises(ValueError):
            ds.com_prazo(lambda: int("x"), 1)
        with self.assertRaises(TimeoutError):
            ds.com_prazo(lambda: threading_sleep(2), 0.05)

    def test_verificacao_lenta_ou_quebrada_vira_erro_e_as_outras_rodam(self):
        def lenta():
            threading_sleep(2)
            return []

        def quebrada():
            raise RuntimeError("boom")

        def boa():
            return [ds.check("a", "maquina", "A", "ok", "ok")]
        with mock.patch.object(ds, "PRAZO_POR_VERIFICACAO_S", 0.05):
            r = {c["id"]: c for c in ds.executar_verificacoes((lenta, quebrada, boa))}
        self.assertEqual(r["erro:lenta"]["estado"], "atencao")
        self.assertIn("passou de", r["erro:lenta"]["detalhe"])
        self.assertEqual(r["erro:quebrada"]["detalhe"], "boom")
        self.assertEqual(r["a"]["estado"], "ok")

    def test_teto_global_pula_o_resto_e_diz_quais(self):
        relogio = iter([0, 0, 200, 200, 200])  # início, 1ª (dentro), 2ª e 3ª (já passou do teto)

        def a():
            return [ds.check("a", "maquina", "A", "ok", "ok")]

        def b():
            return []

        def c():
            return []
        r = {x["id"]: x for x in ds.executar_verificacoes((a, b, c), relogio=lambda: next(relogio))}
        self.assertIn("a", r)
        self.assertEqual(r["erro:prazo"]["estado"], "atencao")
        self.assertIn("b, c", r["erro:prazo"]["detalhe"])

    def test_fluxos_acima_do_teto_viram_nao_verificados_e_guardam_a_memoria(self):
        ds.FLUXOS_VISTOS.write_text(json.dumps({"a": {"visto_desde": "2026-10-01T00:00:00Z"}}))

        def http(url, headers=None, timeout=8):
            return {"data": [{"id": "a", "name": "01 · Caçador", "nodes": []}, {"id": "b", "name": "X", "nodes": []}]}
        with mock.patch.object(ds, "ler_env", return_value="chave"), mock.patch.object(ds, "http_json", http), \
                mock.patch.object(ds, "ligado_desde", return_value=None), \
                mock.patch.object(ds, "n8n_no_ar_desde", return_value=None), \
                mock.patch.object(ds, "TETO_DOS_FLUXOS_S", -1):
            out = ds.fluxos()
        self.assertEqual([(c["id"], c["estado"], c.get("nao_verificado")) for c in out],
                         [("fluxo:a", "atencao", True), ("fluxo:b", "atencao", True)])
        self.assertEqual(ds.fluxos_vistos["a"], {"visto_desde": "2026-10-01T00:00:00Z"})
        self.assertEqual(ds.fluxos_vistos["b"], {})

    def test_nao_verificado_mantem_o_estado_de_antes_e_nao_avisa(self):
        avisos = []
        c = ds.check("fluxo:a", "fluxos", "01", "atencao", "Não verificado")
        c["nao_verificado"] = True
        ant = {"fluxo:a": {"estado": "falha", "desde": "2026-10-19T10:00:00Z", "avisado": "2026-10-19T10:00:00Z"}}
        with mock.patch.object(ds, "enfileirar_alerta_do_dell", side_effect=lambda *a: avisos.append(a) or True):
            novo = ds.avisar_transicoes([c], ant, br("2026-10-19T11:00"))
        self.assertEqual(novo["fluxo:a"], ant["fluxo:a"])
        self.assertEqual(avisos, [])

    def test_subprocess_do_docker_tem_prazo(self):
        vistos: list = []
        ps = json.dumps({"Names": "x", "State": "exited", "Status": "Exited (1)"})
        run = falso_run({("docker", "ps"): ps + "\n", ("docker", "inspect"): "always\n"}, vistos)
        with mock.patch.object(ds.subprocess, "run", run):
            ds.containers()
        self.assertEqual(len(vistos), 2)
        self.assertTrue(all(kw.get("timeout") for _, kw in vistos), vistos)

    def test_docker_travado_e_inspect_travado(self):
        with mock.patch.object(ds.subprocess, "run", side_effect=subprocess.TimeoutExpired("docker", 10)):
            [c] = ds.containers()
        self.assertEqual((c["id"], c["estado"]), ("docker", "falha"))
        ps = json.dumps({"Names": "x", "State": "exited", "Status": "Exited (1)"})
        run = falso_run({("docker", "ps"): ps + "\n", ("docker", "inspect"): subprocess.TimeoutExpired("docker", 5)}, [])
        with mock.patch.object(ds.subprocess, "run", run):
            r = {c["id"]: c for c in ds.containers()}
        self.assertEqual(r["container:x"]["estado"], "falha")  # sem saber a política, não conta como de propósito

    def test_unit_ativa_com_systemctl_travado_ou_ausente(self):
        for erro in (subprocess.TimeoutExpired("systemctl", 5), FileNotFoundError("systemctl")):
            with mock.patch.object(ds.subprocess, "run", side_effect=erro):
                self.assertFalse(ds.unit_ativa("x.service"))
        vistos: list = []
        with mock.patch.object(ds.subprocess, "run", falso_run({("systemctl",): "active\n"}, vistos)):
            self.assertTrue(ds.unit_ativa("x.service"))
        self.assertTrue(vistos[0][1]["timeout"])

    def test_todo_subprocess_do_arquivo_tem_timeout(self):
        """Quem chama subprocess.run sem timeout= reabre o HC-2."""
        import re as _re
        fonte = (AQUI / "dell-status.py").read_text(encoding="utf-8")
        for m in _re.finditer(r"subprocess\.run\(", fonte):
            chamada = fonte[m.start():m.start() + 400]
            fim = chamada.index("timeout=") if "timeout=" in chamada else -1
            proxima = chamada.find("subprocess.run(", 5)
            self.assertTrue(fim != -1 and (proxima == -1 or fim < proxima), chamada[:120])

    def test_main_grava_o_retrato_antes_de_avisar(self):
        ordem = []

        def falha():
            return [ds.check("disco", "maquina", "Disco", "falha", "96% usado")]
        saida, estado = self.dir / "status.json", self.dir / "estado.json"

        def avisa(titulo, texto, chave, prioridade=2):
            ordem.append(("aviso", saida.exists(), prioridade))
            return True
        with contextlib.ExitStack() as pilha:
            for nome, valor in (("SAIDA", saida), ("ESTADO", estado), ("AGENDAS", self.dir / "ag.json"),
                                ("TAMANHOS", self.dir / "tam.json"), ("CENTRAL_VISTA", self.dir / "cv.json"),
                                ("SOCORRO", self.dir / "sem-socorro"), ("VERIFICACOES", (falha,))):
                pilha.enter_context(mock.patch.object(ds, nome, valor))
            pilha.enter_context(mock.patch.object(ds, "enfileirar_alerta_do_dell", avisa))
            pilha.enter_context(mock.patch.object(ds, "drenar_fila", lambda: ordem.append("drenou")))
            pilha.enter_context(mock.patch.object(ds.sys, "argv", ["dell-status"]))
            ds.main()
        self.assertEqual(ordem, [("aviso", True, 0), "drenou"])  # retrato já gravado; disco ≥95% sai com prioridade 0
        self.assertEqual(json.loads(saida.read_text())["verificacoes"][0]["id"], "disco")
        self.assertIn("desde", json.loads(saida.read_text())["verificacoes"][0])
        self.assertEqual(json.loads(estado.read_text())["disco"]["estado"], "falha")

    def test_main_aviso_que_quebra_nao_deixa_a_central_sem_retrato(self):
        def falha():
            return [ds.check("disco", "maquina", "Disco", "falha", "96% usado")]
        saida = self.dir / "status.json"
        with contextlib.ExitStack() as pilha:
            for nome, valor in (("SAIDA", saida), ("ESTADO", self.dir / "estado.json"), ("AGENDAS", self.dir / "ag.json"),
                                ("TAMANHOS", self.dir / "tam.json"), ("CENTRAL_VISTA", self.dir / "cv.json"),
                                ("SOCORRO", self.dir / "sem-socorro"), ("VERIFICACOES", (falha,))):
                pilha.enter_context(mock.patch.object(ds, nome, valor))
            pilha.enter_context(mock.patch.object(ds, "enfileirar_alerta_do_dell", side_effect=RuntimeError("travou")))
            pilha.enter_context(mock.patch.object(ds, "drenar_fila", lambda: None))
            pilha.enter_context(mock.patch.object(ds.sys, "argv", ["dell-status"]))
            pilha.enter_context(contextlib.redirect_stderr(io.StringIO()))
            ds.main()
        self.assertTrue(saida.exists())
        self.assertFalse((self.dir / "estado.json").exists())  # sem estado novo: o próximo minuto tenta avisar de novo


def threading_sleep(s: float) -> None:
    import time as _t
    _t.sleep(s)


class InternetEDns(unittest.TestCase):
    """HC-21: o check de internet fala com o canal do alerta, não só resolve nome."""

    def test_dns_que_trava_vira_falso_no_prazo(self):
        def trava(*a, **k):
            threading_sleep(2)
        with mock.patch.object(ds.socket, "getaddrinfo", trava):
            self.assertFalse(ds.conectar_ao_canal(prazo=0.05))

    def test_resolve_mas_nao_conecta_e_falso(self):
        info = [(ds.socket.AF_INET, ds.socket.SOCK_STREAM, 6, "", ("203.0.113.9", 443))]

        class Soquete:
            def __init__(self, *a): pass
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def settimeout(self, s): self.prazo = s
            def connect(self, end): raise OSError("sem rota")
        with mock.patch.object(ds.socket, "getaddrinfo", return_value=info), mock.patch.object(ds.socket, "socket", Soquete):
            self.assertFalse(ds.conectar_ao_canal())

    def test_conecta_e_faz_o_handshake(self):
        info = [(ds.socket.AF_INET6, ds.socket.SOCK_STREAM, 6, "", ("::1", 443, 0, 0)),
                (ds.socket.AF_INET, ds.socket.SOCK_STREAM, 6, "", ("203.0.113.9", 443))]
        tentados = []

        class Soquete:
            def __init__(self, familia, *a): self.familia = familia
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def settimeout(self, s): assert s <= 3
            def connect(self, end): tentados.append(end)

        class Contexto:
            def wrap_socket(self, s, server_hostname=None):
                assert server_hostname == "api.telegram.org"
                return Soquete(0)
        with mock.patch.object(ds.socket, "getaddrinfo", return_value=info), mock.patch.object(ds.socket, "socket", Soquete), \
                mock.patch.object(ds.ssl, "create_default_context", return_value=Contexto()):
            self.assertTrue(ds.conectar_ao_canal())
        self.assertEqual(tentados[0], ("203.0.113.9", 443))  # IPv4 primeiro

    def test_maquina_nao_usa_so_o_dns(self):
        fonte = inspect.getsource(ds.maquina)
        self.assertIn("conectar_ao_canal", fonte)
        self.assertNotIn("getaddrinfo", fonte)


class ServicosHttpEUnitsParadas(unittest.TestCase):
    """HC-11 (duas rodadas), HC-5 (daemon parado, Central), HC-6 (.path), HC-14, HC-24, VIVO-4."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="ds-units-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        p = mock.patch.object(ds, "ESTADO_DIR", self.dir)
        p.start()
        self.addCleanup(p.stop)

    # --- HC-11

    def test_primeira_falha_http_vira_atencao_e_a_segunda_vira_falha(self):
        c = ds.explicar(ds.check("n8n", "servicos", "n8n", "falha", "Sem resposta: timed out"))
        ds.confirmar_servicos_http([c], {"n8n": {"estado": "ok"}})
        self.assertEqual(c["estado"], "atencao")
        self.assertIn("1ª tentativa", c["detalhe"])
        self.assertTrue(c["sozinho"])
        avisos = []
        with mock.patch.object(ds, "enfileirar_alerta_do_dell", side_effect=lambda *a: avisos.append(a) or True):
            ant = ds.avisar_transicoes([c], {"n8n": {"estado": "ok"}}, br("2026-10-19T10:00"))
            self.assertEqual(avisos, [])  # atenção não avisa
            c2 = ds.check("n8n", "servicos", "n8n", "falha", "Sem resposta: timed out")
            ds.confirmar_servicos_http([c2], ant)
            self.assertEqual(c2["estado"], "falha")
            ds.avisar_transicoes([c2], ant, br("2026-10-19T10:01"))
        self.assertEqual(len(avisos), 1)

    def test_sem_estado_anterior_tambem_espera_e_o_que_nao_e_http_nao(self):
        a = ds.check("central", "servicos", "Central", "falha", "x")
        b = ds.check("disco", "maquina", "Disco", "falha", "96%")
        ds.confirmar_servicos_http([a, b], {})
        self.assertEqual((a["estado"], b["estado"]), ("atencao", "falha"))

    def test_central_esta_nos_servicos_http(self):
        self.assertIn("central", ds.SERVICOS_HTTP)
        self.assertEqual(ds.CENTRAL_RUNTIME, "http://127.0.0.1:9120/api/runtime")

    # --- HC-5 / HC-6

    def daemon(self, **extra):
        return {**unit(id_="luna-workflows.service", ativo="inactive", sub="dead", tipo="simple"),
                "Restart": "on-failure", "TriggeredBy": "", **extra}

    def test_daemon_parado_limpo_e_atencao_e_a_marca_de_pausa_apaga(self):
        a = ds.avaliar_unit(self.daemon())
        self.assertEqual(a["estado"], "atencao")
        self.assertIn("Restart=on-failure", a["motivo"])
        self.assertEqual(ds.avaliar_unit(self.daemon(), pausada=True)["estado"], "ok")
        self.assertEqual(ds.avaliar_unit(self.daemon(ActiveState="active", SubState="running"))["estado"], "ok")

    def test_oneshot_de_timer_e_service_com_restart_e_timer_nao_sao_daemon(self):
        self.assertEqual(ds.avaliar_unit(unit())["estado"], "ok")  # sem Restart=
        self.assertEqual(ds.avaliar_unit(self.daemon(TriggeredBy="pncp-catchup.timer"))["estado"], "ok")
        # timer desabilitado (Radar pausado): TriggeredBy vem vazio, mas o .timer instalado diz que não é daemon
        self.assertEqual(ds.avaliar_unit(self.daemon(), tem_gatilho=True)["estado"], "ok")

    def test_path_parado_e_atencao(self):
        path = {"Id": "socorro.path", "LoadState": "loaded", "ActiveState": "inactive", "SubState": "dead",
                "Result": "success", "Type": ""}
        self.assertEqual(ds.avaliar_unit(path)["estado"], "atencao")
        self.assertEqual(ds.avaliar_unit(path, pausada=True)["estado"], "ok")
        self.assertEqual(ds.avaliar_unit({**path, "ActiveState": "active", "SubState": "waiting"})["estado"], "ok")

    def test_texto_da_unit_parada_ensina_a_ligar_e_a_pausar(self):
        c = ds.avaliar_units([ds.avaliar_unit(self.daemon()),
                              ds.avaliar_unit({"Id": "auto-entrada.path", "LoadState": "loaded", "ActiveState": "inactive"})],
                             br("2026-10-19T10:00"))
        self.assertTrue(c["detalhe"].startswith("Parada(s): "))
        self.assertIn("systemctl --user start luna-workflows.service", c["o_que_fazer"])
        self.assertIn("pausa-luna-workflows", c["o_que_fazer"])
        self.assertNotIn("reset-failed", c["o_que_fazer"])
        p = ds.avaliar_units([ds.avaliar_unit({"Id": "auto-entrada.path", "LoadState": "loaded", "ActiveState": "inactive"})],
                             br("2026-10-19T10:00"))
        self.assertIn("enable --now auto-entrada.path", p["o_que_fazer"])
        self.assertIn("pausa-auto-entrada.path", p["o_que_fazer"])

    def test_units_que_cairam_olha_os_path_e_a_pausa(self):
        repo, home = self.dir / "SquadOne", self.dir / "home"
        ds_antes = {k: getattr(ds, k) for k in ("REPO", "INSTALADOS", "HOME", "_campos_das_units")}
        self.addCleanup(lambda: [setattr(ds, k, v) for k, v in ds_antes.items()])
        ds.REPO, ds.HOME = repo, home
        ds.INSTALADOS = repo / "deploy/dell/instalados.json"
        ds.INSTALADOS.parent.mkdir(parents=True)
        ds.INSTALADOS.write_text(json.dumps({"arquivos": [{"repo": "deploy/dell/**/*.service", "instalado": "~/.config/systemd/user/"},
                                                           {"repo": "deploy/dell/*.path", "instalado": "~/.config/systemd/user/"}]}))
        for n in ("luna-workflows.service", "socorro.path", "prumo-mapa.path", "backup-dell-cofre.service"):
            for raiz in (repo / "deploy/dell", home / ".config/systemd/user"):
                raiz.mkdir(parents=True, exist_ok=True)
                (raiz / n).write_text(n)
        pedidos = []

        def campos(units):
            pedidos.append(units)
            return {u: ({"Id": u, "LoadState": "loaded", "ActiveState": "inactive", "Result": "success"} if u.endswith(".path")
                        else self.daemon(Id=u)) for u in units}
        ds._campos_das_units = campos
        (self.dir / "pausa-socorro.path").write_text("")
        [c] = ds.units_que_cairam()
        self.assertEqual(pedidos, [["luna-workflows.service", "socorro.path"]])  # sem as de verificação própria
        self.assertIn("luna-workflows", c["detalhe"])
        self.assertNotIn("socorro.path", c["detalhe"])  # tem marca de pausa

    def test_verificacoes_proprias_nao_aparecem_duas_vezes(self):
        for u in ("prumo-mapa.service", "prumo-mapa.path", "backup-dell-cofre.service", "backup-dell-espelho.service",
                  "atualizar-central.service"):
            self.assertIn(u, ds.UNITS_COM_VERIFICACAO_PROPRIA)

    # --- VIVO-4

    def test_unit_em_falha_fora_das_verificadas(self):
        self.assertEqual(ds.avaliar_units_falhas(["a.service"], {"a.service"})["estado"], "ok")
        c = ds.avaliar_units_falhas(["run-u123.service", "a.service"], {"a.service"})
        self.assertEqual(c["estado"], "atencao")
        self.assertIn("run-u123.service", c["detalhe"])
        self.assertIn("reset-failed run-u123.service", c["o_que_fazer"])

    def test_central_atualizada(self):
        t = br("2026-10-19T12:00").astimezone(timezone.utc)
        ha = lambda m: t - timedelta(minutes=m)  # noqa: E731
        casos = [
            (("aaa1111", "aaa1111", ha(300), "success", None), "ok"),
            (("bbb2222", "aaa1111", ha(10), "success", None), "ok"),          # build em andamento
            (("bbb2222", "aaa1111", ha(45), "success", None), "atencao"),      # main parada há 45 min
            (("aaa1111", "aaa1111", ha(5), "exit-code", ha(2)), "atencao"),    # a rodada falhou
            ((None, None, None, "", None), "ok"),                              # sem git: nada a dizer
        ]
        for args, estado in casos:
            with self.subTest(args=args):
                self.assertEqual(ds.avaliar_central_atualizada(*args, t)["estado"], estado)
        c = ds.avaliar_central_atualizada("bbb2222", "aaa1111", ha(45), "success", None, t)
        self.assertIn("bbb2222", c["detalhe"])
        self.assertIn("aaa1111", c["detalhe"])  # o sha não pode ser "capitalizado" para minúsculas
        self.assertIn("45 min", c["detalhe"])

    def test_atualizar_central_esta_nas_verificacoes(self):
        nomes = [f.__name__ for f in ds.VERIFICACOES]
        for n in ("central_atualizada", "units_falhas", "telegram"):
            self.assertIn(n, nomes)

    # --- HC-24

    def test_containers_um_nivel_so_e_a_pausa_vale(self):
        linhas = [{"Names": "n8n", "State": "exited", "Status": "Exited (1)"},
                  {"Names": "velho", "State": "exited", "Status": "Exited (0)"},
                  {"Names": "ok", "State": "running", "Status": "Up 3 hours"}]
        run = falso_run({("docker", "ps"): "\n".join(json.dumps(x) for x in linhas) + "\n",
                         ("docker", "inspect"): "always\n"}, [])
        with mock.patch.object(ds.subprocess, "run", run):
            r = {c["id"]: c for c in ds.containers()}
            self.assertEqual((r["container:n8n"]["estado"], r["containers"]["estado"]), ("falha", "falha"))
            (self.dir / "pausa-velho").write_text("19/10")
            (self.dir / "pausa-n8n").write_text("19/10")
            r = {c["id"]: c for c in ds.containers()}
        self.assertEqual(list(r), ["containers"])
        self.assertEqual(r["containers"]["estado"], "ok")
        self.assertIn("2 pausado(s) de propósito", r["containers"]["detalhe"])

    def test_resumo_de_containers_nao_avisa_nem_pede_socorro_sozinho(self):
        avisos = []
        cs = [ds.check("container:x", "containers", "x", "falha", "Exited"),
              ds.check("containers", "containers", "Containers", "falha", "1 com problema")]
        with mock.patch.object(ds, "enfileirar_alerta_do_dell", side_effect=lambda titulo, texto, *a: avisos.append(titulo + "\n" + texto) or True):
            ds.avisar_transicoes(cs, {}, br("2026-10-19T10:00"))
        self.assertEqual(len(avisos), 1)
        self.assertIn("• x:", avisos[0])
        self.assertNotIn("• Containers:", avisos[0])


class BackupEFilas(unittest.TestCase):
    def test_ensaio_com_ultima_rodada_falha_e_atencao_mesmo_com_sucesso_recente(self):
        t = br("2026-10-19T12:00").astimezone(timezone.utc)
        recente = ds.iso(t - timedelta(days=10))
        f = {"nome": "Ensaio de restauração", "tipo": "ensaio", "estado": "falha", "ultimo_sucesso": recente,
             "detalhe": "restic restore: arquivo sumiu"}
        c = ds._fonte_do_backup("ensaio", f, t)
        self.assertEqual(c["estado"], "atencao")
        self.assertEqual(c["detalhe"], "restic restore: arquivo sumiu")
        self.assertFalse(c.get("sozinho"))
        self.assertIn("falhou", c["o_que_fazer"])
        self.assertEqual(ds._fonte_do_backup("ensaio", {**f, "estado": "ok"}, t)["estado"], "ok")

    def test_remote_do_rclone_vem_do_fontes_toml(self):
        d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        toml = d / "fontes.toml"
        toml.write_text('[geral]\nremoto = "gdrive"\n[[espelho]]\nid = "sites"\n[[espelho]]\nid = "estrutura"\n'
                        'remoto = "gdrive-estrutura"\n[cofre]\nrepositorio = "rclone:gdrive-cofre:Backups/restic"\n')
        self.assertEqual(ds.remoto_do_backup("estrutura", toml), "gdrive-estrutura")
        self.assertEqual(ds.remoto_do_backup("sites", toml), "gdrive")
        self.assertEqual(ds.remoto_do_backup("cofre", toml), "gdrive-cofre")
        self.assertEqual(ds.remoto_do_backup("estrutura", d / "nao-existe.toml"), "gdrive")

    def test_token_recusado_manda_reconectar_o_remote_certo(self):
        d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        (d / "fontes.toml").write_text('[[espelho]]\nid = "estrutura"\nremoto = "gdrive-estrutura"\n')
        t = br("2026-10-19T12:00").astimezone(timezone.utc)
        f = {"nome": "Estrutura", "estado": "falha", "ultimo_sucesso": ds.iso(t), "atencao_h": 3, "falha_h": 24,
             "detalhe": "couldn't fetch token: invalid_grant"}
        with mock.patch.object(ds, "BACKUP_FONTES", d / "fontes.toml"):
            c = ds._fonte_do_backup("estrutura", f, t)
        self.assertIn("rclone config reconnect gdrive-estrutura:", c["o_que_fazer"])

    def test_textos_das_filas_nao_falam_do_que_saiu(self):
        todo = " ".join(o for o, _, _ in ds.FILAS.values()) + " ".join(a[1] for _, a, _ in ds.FILAS.values())
        for velho in ("Enviar um por um", "fila=envio", "Hoje › Prospects", "Enviar convite", "(09:00)", "expira no 10º",
                      "o toque abre o WhatsApp e marca"):
            self.assertNotIn(velho, todo)
        for v in ds.FILAS.values():
            self.assertTrue(v[1][1].startswith("/crm"), v[1][1])
        self.assertIn("/crm?ver=triagem", ds.FILAS["prumo-revisar"][1][1])

    def test_fila_de_leads_esperando_o_raio_x_tem_texto_proprio(self):
        d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        (d / "lead").mkdir()
        (d / "lead/content.md").write_text("x")
        (d / ".demo-sob-pedido").write_text("")
        with mock.patch.object(ds, "AUTO", d), mock.patch.object(ds, "ESTADO_N8N", d / "sem"):
            [c] = ds.pendencias()
        self.assertIn("raio-x.timer", c["o_que_fazer"])
        self.assertIn("Gerar demo", c["o_que_fazer"])
        self.assertNotIn("4 sites por dia", c["o_que_fazer"])
        (d / ".demo-sob-pedido").unlink()
        with mock.patch.object(ds, "AUTO", d), mock.patch.object(ds, "ESTADO_N8N", d / "sem"):
            [c] = ds.pendencias()
        self.assertIn("4 sites por dia", c["o_que_fazer"])


class SocorroSoQuandoHaOQueFazer(unittest.TestCase):
    """HC-8 / HC-6: o "Quebrou" só promete socorro que roda."""

    T = datetime(2026, 10, 19, 15, 0, tzinfo=timezone.utc)

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="ds-socorro2-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        (self.dir / "bin").mkdir()
        (self.dir / "bin/socorro").write_text("#!/bin/sh\n")
        for nome, valor in (("SOCORRO", self.dir / "bin/socorro"), ("SOCORRO_PEDIDOS", self.dir / "estado/pedidos"),
                            ("SOCORRO_DESLIGADO", self.dir / "desligado")):
            p = mock.patch.object(ds, nome, valor)
            p.start()
            self.addCleanup(p.stop)
        e = mock.patch.dict(os.environ, {"SOCORRO_DESLIGADO": ""})
        e.start()
        self.addCleanup(e.stop)
        self.path_ativo = True
        p = mock.patch.object(ds, "unit_ativa", lambda u: u == "socorro.path" and self.path_ativo)
        p.start()
        self.addCleanup(p.stop)
        for nome, valor in (("FILA", self.dir / "fila"), ("FILA_ESTADO", self.dir / "fila-estado.json"),
                            ("FILA_TRAVA", self.dir / "fila.lock"), ("FILA_RECUSADOS", self.dir / "recusados"), ("FRESCOR_S", 0)):
            p = mock.patch.object(ds, nome, valor); p.start(); self.addCleanup(p.stop)
        ds.FILA.mkdir()
        self.enviadas = []
        p = mock.patch.object(ds, "enviar_telegram", side_effect=lambda m, silencioso: self.enviadas.append(m) or True)
        p.start()
        self.addCleanup(p.stop)

    def falha(self, cid, detalhe="x"):
        return ds.check(cid, "servicos", cid, "falha", detalhe)

    def pedidos(self):
        return sorted((self.dir / "estado/pedidos").glob("*.json")) if (self.dir / "estado/pedidos").is_dir() else []

    def test_falha_sem_remedio_nem_leitura_nao_pede_nem_promete(self):
        cs = [self.falha("fluxo:abc"), self.falha("cron:xyz"), self.falha("pncp"), self.falha("idade:x")]
        self.assertEqual(ds.pedir_socorro(cs, {}, self.T), set())
        self.assertEqual(self.pedidos(), [])
        ds.avisar_transicoes(cs, {}, self.T, {"fluxo:abc"})  # mesmo que alguém passasse o id, não há linha a dizer
        self.assertEqual(self.enviadas, [])  # publicar ainda não entrega
        ds.drenar_fila(self.T)
        self.assertIn("Quebrou:", self.enviadas[0])
        ds.drenar_fila(self.T)
        self.assertNotIn("Socorro", self.enviadas[0])

    def test_so_leitura_diz_diagnostico_e_com_remedio_diz_religar(self):
        cs = [self.falha("backup:cofre"), self.falha("n8n")]
        ids = ds.pedir_socorro(cs, {}, self.T)
        self.assertEqual(ids, {"backup:cofre", "n8n"})
        ds.avisar_transicoes(cs, {}, self.T, ids)
        ds.drenar_fila(self.T)
        msg = self.enviadas[0]
        self.assertEqual(msg.count(ds.LINHA_DO_DIAGNOSTICO), 1)
        self.assertEqual(msg.count(ds.LINHA_DO_SOCORRO), 1)

    def test_whatsapp_desconectado_e_container_qualquer(self):
        self.assertTrue(ds.socorro_religa(self.falha("whatsapp-sessao", "Bridge do WhatsApp sem resposta em :3000")))
        self.assertFalse(ds.socorro_religa(self.falha("whatsapp-sessao", "a sessão está 'disconnected'")))
        self.assertFalse(ds.socorro_religa(self.falha("whatsapp-prumo", "O número do PRUMO caiu")))
        self.assertTrue(ds.socorro_religa(self.falha("container:evolution-api-1")))
        self.assertFalse(ds.socorro_religa(self.falha("container:outro")))
        self.assertTrue(ds.socorro_le(self.falha("container:outro")))

    def test_sem_o_socorro_path_ativo_nao_pede_e_nao_promete(self):
        self.path_ativo = False
        cs = [self.falha("n8n")]
        self.assertEqual(ds.pedir_socorro(cs, {}, self.T), set())
        self.assertEqual(self.pedidos(), [])
        ds.avisar_transicoes(cs, {}, self.T, set())
        ds.drenar_fila(self.T)
        self.assertNotIn("Socorro", self.enviadas[0])

    def test_resumo_de_containers_nao_pede(self):
        self.assertEqual(ds.pedir_socorro([self.falha("containers")], {}, self.T), set())


class TelegramComoCanal(unittest.TestCase):
    """HC-23 (sentinela), HC-17 (prioridade 0), OT-14 (mais origens pelo Telegram) e HC-10 (chave por fluxo)."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="ds-canal-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        env = self.dir / "operations.env"
        env.write_text(f'TELEGRAM_BOT_TOKEN="{TOKEN}"\nTELEGRAM_CHAT_IDS=111\n')
        for nome, valor in (("OPERATIONS_ENV", env), ("TELEGRAM_ESTADO", self.dir / "telegram.json"),
                            ("FILA", self.dir / "fila"), ("FILA_TRAVA", self.dir / "fila.lock"),
                            ("FILA_ESTADO", self.dir / "fila-estado.json"), ("FILA_RECUSADOS", self.dir / "recusados"),
                            ("FRESCOR_S", 0)):
            p = mock.patch.object(ds, nome, valor)
            p.start()
            self.addCleanup(p.stop)
        ds.FILA.mkdir()
        self.pedidos = []
        self.bot_no_ar = True

        def urlopen(req, timeout=None):
            self.pedidos.append(json.loads(req.data))
            if not self.bot_no_ar:
                raise ds.urllib.error.URLError("fora")
            return _RespostaDoBot(b'{"ok": true, "result": {}}')
        for alvo, valor in ((ds.urllib.request, mock.patch.object(ds.urllib.request, "urlopen", side_effect=urlopen)),):
            valor.start()
            self.addCleanup(valor.stop)
        self.whatsapp = []
        p = mock.patch.object(ds, "enviar", side_effect=lambda m: self.whatsapp.append(m) or True)
        p.start()
        self.addCleanup(p.stop)

    def estado(self):
        return json.loads(ds.TELEGRAM_ESTADO.read_text())

    def test_envio_registra_ok_e_conta_as_falhas_seguidas(self):
        ds.enviar_telegram("a", silencioso=False)
        self.assertEqual(self.estado()["falhas_seguidas"], 0)
        self.assertIn("ok_em", self.estado())
        self.bot_no_ar = False
        with contextlib.redirect_stderr(io.StringIO()):
            for _ in range(3):
                ds.enviar_telegram("a", silencioso=False)
        self.assertEqual(self.estado()["falhas_seguidas"], 3)
        self.assertIn("falhando_desde", self.estado())
        self.bot_no_ar = True
        ds.enviar_telegram("a", silencioso=False)
        self.assertEqual(self.estado()["falhas_seguidas"], 0)
        self.assertNotIn("falhando_desde", self.estado())

    def test_sem_bot_configurado_nada_e_registrado(self):
        ds.OPERATIONS_ENV.write_text("")
        self.assertFalse(ds.enviar_telegram("a", silencioso=False))
        self.assertFalse(ds.TELEGRAM_ESTADO.exists())
        self.assertEqual(ds.telegram(), [])

    def test_tres_falhas_seguidas_viram_falha_e_a_sonda_apaga(self):
        t = br("2026-10-19T12:00")
        self.assertEqual(ds.avaliar_telegram({"falhas_seguidas": 2}, t)["estado"], "ok")
        c = ds.avaliar_telegram({"falhas_seguidas": 3, "falhando_desde": "2026-10-19T14:00:00Z",
                                 "ok_em": "2026-10-18T10:00:00Z"}, t)
        self.assertEqual(c["estado"], "falha")
        self.assertIn("3 envios seguidos", c["detalhe"])
        self.assertIn("operations.env", c["o_que_fazer"])
        ds.TELEGRAM_ESTADO.write_text(json.dumps({"falhas_seguidas": 3}))
        with mock.patch.object(ds, "_sondar_telegram", return_value=False):
            self.assertEqual(ds.telegram()[0]["estado"], "falha")
        with mock.patch.object(ds, "_sondar_telegram", return_value=True):
            self.assertEqual(ds.telegram()[0]["estado"], "ok")
        self.assertEqual(self.estado()["falhas_seguidas"], 0)

    def test_falha_critica_de_noite_chega_com_som_e_a_comum_sem(self):
        noite = br("2026-10-19T23:30")
        for cid, silencioso in (("disco", False), ("dns", False), ("backup:cofre", False), ("container:x", False),
                                ("fluxo:a", True), ("pncp", True)):
            with self.subTest(cid):
                self.pedidos.clear()
                ds.avisar_transicoes([ds.check(cid, "maquina", cid, "falha", "x")], {}, noite)
                self.assertEqual(self.pedidos, [])  # somente outbox até a drenagem
                ds.drenar_fila(noite)
                self.assertEqual("disable_notification" in self.pedidos[0], silencioso)
                self.assertEqual(self.whatsapp, [])

    def test_origens_que_saem_pelo_telegram(self):
        for origem in ("socorro", "backup-dell", "atualizar-central", "silmer-drive-sync", "frente-comercial", "n8n:03 · Balcão"):
            self.assertTrue(ds.sai_pelo_telegram(origem), origem)
        for origem in ("teste", "squadone-lembretes", "n8nfake"):
            self.assertFalse(ds.sai_pelo_telegram(origem), origem)

    def gravar(self, nome, **extra):
        (ds.FILA / nome).write_text(json.dumps(aviso(**extra)), encoding="utf-8")

    def test_origem_exclusiva_com_o_bot_fora_espera_e_nunca_vai_ao_whatsapp(self):
        # Fase 5.3 (19/10): as 5 origens e todo P0 só saem pelo Telegram, mesmo com o bot caído.
        self.bot_no_ar = False
        for i, origem in enumerate(sorted(ds.ORIGENS_PELO_TELEGRAM)):
            self.gravar(f"o{i}.json", titulo=origem, origem=origem)
        self.gravar("p0.json", titulo="urgente", origem="qualquer", prioridade=0)
        with contextlib.redirect_stderr(io.StringIO()):
            r = ds.drenar_fila(br("2026-10-19T15:00"))
        self.assertEqual(self.whatsapp, [])
        self.assertEqual(r["pelo_telegram"], 0)
        self.assertEqual(len(list(ds.FILA.glob("*.json"))), len(ds.ORIGENS_PELO_TELEGRAM) + 1)

    def test_falha_de_fluxo_do_n8n_hoje_cai_no_whatsapp_se_o_telegram_falha(self):
        # FIXA O COMPORTAMENTO ATUAL, não o desejado. O prefixo `n8n:` prefere o Telegram (sai_pelo_telegram) mas NÃO é
        # exclusivo (telegram_exclusivo só olha ORIGENS_PELO_TELEGRAM e P0): com o bot fora o aviso segue para o
        # WhatsApp de vendas e expira como aviso comum. Torná-lo exclusivo é decisão de produto do Rômulo: se mudar,
        # mude este teste junto e a seção "Falha de fluxo do n8n" do deploy/dell/README.md.
        origem = "n8n:07 · Lead"
        self.assertTrue(ds.sai_pelo_telegram(origem))
        self.assertFalse(ds.telegram_exclusivo(aviso(origem=origem, prioridade=2)))
        self.bot_no_ar = False
        self.gravar("n.json", titulo="Fluxo", origem=origem)
        with contextlib.redirect_stderr(io.StringIO()):
            r = ds.drenar_fila(br("2026-10-19T15:00"))
        self.assertEqual((r["pelo_telegram"], r["enviados"]), (0, 1))
        self.assertEqual([m.split("\n")[0] for m in self.whatsapp], ["Fluxo"])
        # Com o bot no ar o mesmo aviso sai só pelo Telegram.
        self.bot_no_ar = True
        self.whatsapp.clear()
        self.gravar("n2.json", titulo="Fluxo 2", origem=origem, chave="outra")
        r = ds.drenar_fila(br("2026-10-19T15:05"))
        self.assertEqual((r["pelo_telegram"], r["enviados"]), (1, 0))
        self.assertEqual(self.whatsapp, [])

    def test_drenar_manda_pelo_telegram_as_origens_novas(self):
        self.gravar("a.json", titulo="Backup", origem="backup-dell")
        self.gravar("b.json", titulo="Central não atualizou", origem="atualizar-central")
        self.gravar("c.json", titulo="Drive", origem="silmer-drive-sync")
        self.gravar("d.json", titulo="Fluxo", origem="n8n:07 · Lead")
        self.gravar("e.json", titulo="Lembrete", origem="squadone-lembretes")
        r = ds.drenar_fila(br("2026-10-19T15:00"))
        self.assertEqual((r["pelo_telegram"], r["enviados"]), (4, 1))
        self.assertEqual([m.split("\n")[0] for m in self.whatsapp], ["Lembrete"])

    def test_aviso_de_falha_do_fluxo_00_ganha_chave_por_fluxo(self):
        origem = "n8n:00 · Avisar falha pelo Hermes"
        self.gravar("a.json", titulo="⚠️ n8n do Dell", origem=origem, texto='Fluxo "01 · Caçador" falhou no nó X: erro 1')
        self.gravar("b.json", titulo="⚠️ n8n do Dell", origem=origem, texto='Fluxo "01 · Caçador" falhou no nó Y: erro 2')
        self.gravar("c.json", titulo="⚠️ n8n do Dell", origem=origem, texto='Fluxo "08 · CRM" falhou no nó Z: erro 3')
        with contextlib.redirect_stderr(io.StringIO()):
            r = ds.drenar_fila(br("2026-10-19T15:00"))
        self.assertEqual((r["pelo_telegram"], r["descartados"]), (2, 1))
        self.assertEqual(sorted(json.loads(ds.FILA_ESTADO.read_text())["chaves"]),
                         ["n8n-falha:01 · Caçador", "n8n-falha:08 · CRM"])

    def test_aviso_com_chave_propria_ou_de_outra_origem_nao_e_mexido(self):
        self.gravar("a.json", origem="n8n:00 · Avisar falha pelo Hermes", chave="minha", texto='Fluxo "X" falhou')
        self.gravar("b.json", origem="n8n:Outro", texto='Fluxo "X" falhou')
        ds.drenar_fila(br("2026-10-19T15:00"))
        self.assertEqual(sorted(json.loads(ds.FILA_ESTADO.read_text())["chaves"]), ["minha"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
