#!/usr/bin/env python3
"""Testes do site-demos-limpeza: só a regra pura `escolher`, sem Vercel nem rede.

  python3 deploy/dell/site-demos-limpeza.test.py
"""
import importlib.util
import unittest
from datetime import date
from pathlib import Path

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("limpeza", AQUI / "site-demos-limpeza.py")
limpeza = importlib.util.module_from_spec(spec)
spec.loader.exec_module(limpeza)

HOJE = date(2026, 10, 7)


def lead(**kw):
    base = {"nome": "Fulano", "status": "enviado", "pasta": "fulano", "vercel_project": "demo-fulano",
            "enviado_em": "2026-09-25T16:15:53.000Z", "respondeu_em": "", "fechado_em": "", "recusado_em": ""}
    base.update(kw)
    return base


def entra(**kw):
    eleitos, guardados = limpeza.escolher([lead(**kw)], HOJE)
    return bool(eleitos), (guardados[0][1] if guardados else "")


class Escolher(unittest.TestCase):
    def test_enviado_sem_interacao_ha_mais_de_10_dias_entra(self):
        self.assertTrue(entra()[0])

    def test_expirado_na_pasta_concluidos_entra(self):
        self.assertTrue(entra(status="expirado", pasta="_concluidos/fulano")[0])

    def test_prazo_e_inclusivo_no_10o_dia(self):
        self.assertTrue(entra(enviado_em="2026-09-27T12:00:00.000Z")[0])
        ok, motivo = entra(enviado_em="2026-09-28T12:00:00.000Z")
        self.assertFalse(ok)
        self.assertIn("entra em 08/10", motivo)

    def test_data_vale_no_fuso_de_sao_paulo(self):
        # 28/09 00:30 UTC ainda é 27/09 em São Paulo: já completa 10 dias em 07/10.
        self.assertTrue(entra(enviado_em="2026-09-28T00:30:00.000Z")[0])

    def test_qualquer_interacao_veta(self):
        for campo in ("respondeu_em", "fechado_em", "recusado_em"):
            ok, motivo = entra(**{campo: "2026-10-01T10:00:00.000Z"})
            self.assertFalse(ok, campo)
            self.assertEqual(motivo, "teve interação")

    def test_pastas_do_jogo_ou_recusadas_nunca_entram(self):
        for pasta in ("_recusados/fulano", "_em-conversa/fulano", "_fechados/fulano", "_descartados/fulano"):
            self.assertFalse(entra(pasta=pasta)[0], pasta)

    def test_status_que_nao_e_enviado_ou_expirado_nao_entra(self):
        for status in ("pronto", "recusado", "fechado", "novo"):
            self.assertFalse(entra(status=status)[0], status)

    def test_so_projeto_demo(self):
        self.assertFalse(entra(vercel_project="squadone-app")[0])
        self.assertFalse(entra(vercel_project="")[0])

    def test_data_ilegivel_nao_entra(self):
        ok, motivo = entra(enviado_em="ontem")
        self.assertFalse(ok)
        self.assertEqual(motivo, "enviado_em ilegível")

    def test_pasta_com_caminho_estranho_nao_entra(self):
        self.assertFalse(entra(pasta="../fulano")[0])
        self.assertFalse(entra(pasta="")[0])


if __name__ == "__main__":
    unittest.main()
