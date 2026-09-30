#!/usr/bin/env python3
"""Testes do dell-status para o que não depende de serviço vivo: o avaliador
de cron, as rotinas do Hermes, o gerador de sites, os fluxos do n8n (pela
agenda de cada um), as filas, o backup e o "o que fazer" de cada alerta. Tudo
em pasta temporária, com relógio fixo; nada é gravado no Dell nem enviado pelo
Hermes.

  python3 deploy/dell/dell-status.test.py
"""
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
BR = timezone(timedelta(hours=-3))
spec = importlib.util.spec_from_file_location("dell_status", AQUI / "dell-status.py")
ds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ds)


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
        self.assertEqual(r["pend:site-enviar"]["acao"]["url"], "/crm?produto=site")
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
        self.assertIn("rclone config reconnect", r["backup:sites"]["o_que_fazer"])
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
