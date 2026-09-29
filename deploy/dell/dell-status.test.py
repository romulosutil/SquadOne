#!/usr/bin/env python3
"""Testes do dell-status para o que não depende de serviço vivo: o avaliador
de cron, as rotinas do Hermes e o gerador de sites. Tudo em pasta temporária,
com relógio fixo; nada é gravado no Dell nem enviado pelo Hermes.

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
