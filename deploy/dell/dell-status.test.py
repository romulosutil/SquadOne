#!/usr/bin/env python3
"""Testes do dell-status para o que não depende de serviço vivo: o avaliador
de cron, as rotinas do Hermes, o gerador de sites, o rascunho do Mapa, os fluxos do n8n (pela
agenda de cada um), as filas, o backup, os arquivos instalados e o "o que fazer" de cada alerta. Tudo
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
from datetime import date, datetime, timedelta, timezone
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
        self.assertEqual(r["pend:site-enviar"]["acao"]["url"], "/crm?produto=site&fila=envio")
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


def aviso(**extra) -> dict:
    return {"titulo": "🌐 Sites", "texto": "2 sites prontos", "origem": "teste", **extra}


class FilaDeAvisos(unittest.TestCase):
    """A fila de ~/.local/share/avisos/fila: formato, teto, silêncio, chave, flock."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="dell-status-fila-"))
        self.addCleanup(shutil.rmtree, self.dir)
        self.antes = {k: getattr(ds, k) for k in ("FILA", "FILA_TRAVA", "FILA_ESTADO", "FILA_RECUSADOS",
                                                  "FRESCOR_S", "enviar")}
        self.addCleanup(lambda: [setattr(ds, k, v) for k, v in self.antes.items()])
        ds.FILA = self.dir / "fila"
        ds.FILA.mkdir()
        ds.FILA_TRAVA = self.dir / "estado" / "fila.lock"
        ds.FILA_ESTADO = self.dir / "estado" / "fila.json"
        ds.FILA_RECUSADOS = self.dir / "estado" / "recusados"
        ds.FRESCOR_S = 0
        self.enviadas: list[str] = []
        self.hermes_no_ar = True

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
        self.assertEqual((r["enviados"], r["esperando"]), (1, 1))
        self.assertTrue(self.enviadas[0].startswith("Urgente"))
        self.assertTrue(normal.exists())
        self.assertEqual(ds.drenar_fila(br("2026-10-07T06:59"))["enviados"], 0)
        self.assertEqual(ds.drenar_fila(br("2026-10-07T07:00"))["enviados"], 1)
        self.assertFalse(normal.exists())

    def test_teto_por_hora_dobra_o_excedente_num_resumo(self):
        for i in range(25):
            self.gravar(aviso(titulo=f"Aviso {i:02d}"))
        self.gravar(aviso(titulo="Urgente", prioridade=0), nome="9999.json")
        r = ds.drenar_fila(br("2026-10-06T10:00"))
        self.assertEqual((r["enviados"], r["agrupados"]), (19, 7))
        self.assertEqual(len(self.enviadas), 20)
        self.assertTrue(self.enviadas[0].startswith("Urgente"))  # P0 vai primeiro, mesmo gravado por último
        self.assertIn("7 avisos agrupados", self.enviadas[-1])
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
