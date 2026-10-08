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

    def test_pedido_de_exclusao_nao_entra_na_regra_de_quem_nao_interagiu(self):
        # Quem pediu exclusão foi marcado recusado: só o --exclusao, pelo nome, apaga esse demo.
        ok, _ = entra(status="recusado", pasta="_recusados/fulano", recusado_em="2026-10-07T10:00:00Z", resposta_tipo="exclusao")
        self.assertFalse(ok)


def pedido(**kw):
    return lead(**{"status": "recusado", "pasta": "_recusados/fulano", "recusado_em": "2026-10-07T10:00:00Z",
                   "respondeu_em": "2026-10-07T10:00:00Z", "resposta_tipo": "exclusao", **kw})


class EscolherExclusao(unittest.TestCase):
    def test_quem_pediu_entra_pelo_nome(self):
        eleitos, recusas = limpeza.escolher_exclusao([pedido(), lead(nome="Outro", vercel_project="demo-outro")], ["demo-fulano"])
        self.assertEqual(recusas, [])
        self.assertEqual([(e["projeto"], e["pasta"]) for e in eleitos], [("demo-fulano", "_recusados/fulano")])

    def test_pasta_na_raiz_tambem_entra(self):
        # O site-pastas ainda não moveu (ou o lead estava pronto): o pedido vale do mesmo jeito.
        eleitos, _ = limpeza.escolher_exclusao([pedido(pasta="fulano", status="recusado")], ["demo-fulano"])
        self.assertEqual(len(eleitos), 1)

    def test_sem_pedido_no_retrato_nao_apaga(self):
        for tipo in ("negativa", "", "interesse"):
            eleitos, recusas = limpeza.escolher_exclusao([pedido(resposta_tipo=tipo)], ["demo-fulano"])
            self.assertEqual(eleitos, [], tipo)
            self.assertIn("não pediu exclusão", recusas[0])

    def test_fechado_nunca(self):
        for kw in ({"status": "fechado"}, {"pasta": "_fechados/fulano"}):
            eleitos, recusas = limpeza.escolher_exclusao([pedido(**kw)], ["demo-fulano"])
            self.assertEqual(eleitos, [])
            self.assertIn("fechado", recusas[0])

    def test_projeto_desconhecido_repetido_ou_nao_demo(self):
        self.assertIn("nenhum lead", limpeza.escolher_exclusao([pedido()], ["demo-outro"])[1][0])
        self.assertIn("mais de um lead", limpeza.escolher_exclusao([pedido(), pedido(nome="Gêmeo")], ["demo-fulano"])[1][0])
        self.assertIn("nenhum lead", limpeza.escolher_exclusao([pedido(vercel_project="squadone-app")], ["squadone-app"])[1][0])

    def test_pasta_estranha(self):
        self.assertEqual(limpeza.escolher_exclusao([pedido(pasta="a/b/fulano")], ["demo-fulano"])[0], [])
        self.assertEqual(limpeza.escolher_exclusao([pedido(pasta="../fulano")], ["demo-fulano"])[0], [])


class ComandoExclusao(unittest.TestCase):
    """main(['--exclusao', ...]) sem disco, Vercel nem aviso: o retrato e o apagar são dublês."""

    def setUp(self):
        from datetime import datetime, timezone
        self.originais = {n: getattr(limpeza, n) for n in ("ler_retrato_com_hora", "ja_apagado", "apagar")}
        self.apagou = []
        self.leads = [pedido(), lead(nome="Outro", vercel_project="demo-outro", pasta="outro")]
        limpeza.ler_retrato_com_hora = lambda: (self.leads, datetime(2026, 10, 7, 15, 20, tzinfo=timezone.utc))
        limpeza.ja_apagado = lambda pasta: pasta == "outro"
        limpeza.apagar = lambda alvos, a_pedido=False: self.apagou.append((alvos, a_pedido)) or 0

    def tearDown(self):
        for n, f in self.originais.items():
            setattr(limpeza, n, f)

    def test_apaga_so_o_pedido_e_marca_a_pedido(self):
        self.assertEqual(limpeza.main(["--exclusao", "demo-fulano"]), 0)
        self.assertEqual([([a["projeto"] for a in alvos], ap) for alvos, ap in self.apagou], [(["demo-fulano"], True)])

    def test_um_nome_que_nao_entra_e_nada_e_apagado(self):
        self.assertEqual(limpeza.main(["--exclusao", "demo-fulano", "demo-outro"]), 2)  # demo-outro já foi apagado
        self.assertEqual(self.apagou, [])

    def test_sem_nomes_so_lista(self):
        self.assertEqual(limpeza.main(["--exclusao"]), 0)
        self.assertEqual(self.apagou, [])

    def test_nao_mistura_com_as_outras_opcoes(self):
        self.assertEqual(limpeza.main(["--exclusao", "--apagar"]), 2)
        self.assertEqual(limpeza.main(["--apagar", "--exclusao", "demo-fulano"]), 2)
        self.assertEqual(self.apagou, [])


if __name__ == "__main__":
    unittest.main()
