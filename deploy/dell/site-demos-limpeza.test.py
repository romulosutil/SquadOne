#!/usr/bin/env python3
"""Testes do site-demos-limpeza: as regras puras `escolher` e `escolher_exclusao` e o `main`
com dublês no lugar da Central, do disco e da Vercel (nada aqui toca ~/auto-site nem a rede).

  python3 deploy/dell/site-demos-limpeza.test.py
"""
import importlib.util
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("limpeza", AQUI / "site-demos-limpeza.py")
limpeza = importlib.util.module_from_spec(spec)
spec.loader.exec_module(limpeza)


def perdido(**kw):
    """Um lead como o GET /api/operations/crm devolve (só os campos que o script lê)."""
    base = {"produto": "site", "chave": "ChIJfulano", "empresa": "Fulano", "etapa": "perdido", "motivoPerda": "expirou",
            "desde": "2026-10-01T15:00:00.000Z", "diasNaEtapa": 3, "pasta": {"lugar": "raiz", "slug": "fulano"}}
    base.update(kw)
    return base


DEMOS = {"fulano": "demo-fulano", "_recusados/fulano": "demo-fulano", "_concluidos/fulano": "demo-fulano",
         "_em-conversa/fulano": "demo-fulano", "_descartados/fulano": "demo-fulano", "_fechados/fulano": "demo-fulano"}


def entra(projetos=DEMOS, **kw):
    eleitos, guardados = limpeza.escolher([perdido(**kw)], projetos.get)
    return bool(eleitos), (guardados[0][1] if guardados else "")


class Escolher(unittest.TestCase):
    def test_perdido_com_demo_no_ar_entra_com_a_pasta_certa(self):
        eleitos, _ = limpeza.escolher([perdido()], DEMOS.get)
        self.assertEqual([(e["projeto"], e["pasta"], e["motivo"]) for e in eleitos], [("demo-fulano", "fulano", "expirou")])

    def test_todo_motivo_de_perda_entra(self):
        for motivo in ("recusou", "expirou", "esfriou", "sem-contato", "descartado"):
            self.assertTrue(entra(motivoPerda=motivo)[0], motivo)

    def test_so_perdido_do_site(self):
        for kw in ({"etapa": "contato"}, {"etapa": "proposta"}, {"etapa": "ganho"}, {"produto": "prumo"}):
            ok, motivo = entra(**kw)
            self.assertFalse(ok, kw)
            self.assertEqual(motivo, "", "o que não está perdido nem aparece entre os guardados")

    def test_folga_de_dois_dias_em_perdido(self):
        ok, motivo = entra(diasNaEtapa=1)
        self.assertFalse(ok)
        self.assertIn("entra em 1", motivo)
        self.assertTrue(entra(diasNaEtapa=2)[0])
        self.assertTrue(entra(diasNaEtapa=None)[0], "sem data (acervo recusado à mão) é antigo")

    def test_lugares_de_quem_perdeu_entram_e_fechados_nunca(self):
        for lugar in ("raiz", "_recusados/", "_concluidos/", "_em-conversa/", "_descartados/"):
            self.assertTrue(entra(pasta={"lugar": lugar, "slug": "fulano"})[0], lugar)
        ok, motivo = entra(pasta={"lugar": "_fechados/", "slug": "fulano"})
        self.assertFalse(ok)
        self.assertIn("_fechados/", motivo)

    def test_sem_pasta_sem_demo_ou_ja_apagado_nao_entra_nem_aparece(self):
        for kw in ({"pasta": None}, {"pasta": {"lugar": "raiz", "slug": "../fulano"}}, {"demoApagadoEm": "2026-10-07T10:00:00Z"}):
            self.assertEqual(entra(**kw), (False, ""), kw)
        self.assertEqual(entra(projetos={}), (False, ""), "nunca publicado (ou o publicado.json já tem apagado_em)")
        self.assertEqual(entra(projetos={"fulano": "squadone-app"}), (False, ""), "só projeto demo-*")

    def test_mais_antigo_em_perdido_primeiro_e_sem_data_antes_de_todos(self):
        leads = [perdido(empresa="Novo", desde="2026-10-05T12:00:00Z", pasta={"lugar": "raiz", "slug": "novo"}),
                 perdido(empresa="Velho", desde="2026-09-30T12:00:00Z", pasta={"lugar": "raiz", "slug": "velho"}),
                 perdido(empresa="Acervo", desde=None, diasNaEtapa=None, pasta={"lugar": "_recusados/", "slug": "acervo"})]
        eleitos, _ = limpeza.escolher(leads, lambda p: "demo-" + p.rsplit("/", 1)[-1])
        self.assertEqual([e["nome"] for e in eleitos], ["Acervo", "Velho", "Novo"])


class ComandoApagar(unittest.TestCase):
    """main(['--apagar', ...]) com a Central, o disco e a Vercel dublados."""

    def setUp(self):
        self.originais = {n: getattr(limpeza, n) for n in ("ler_crm", "projeto_da_pasta", "apagar", "MAX_POR_RODADA")}
        self.apagou = []
        self.leads = [perdido(empresa=f"L{i}", desde=f"2026-09-{10 + i:02d}T12:00:00Z", pasta={"lugar": "raiz", "slug": f"l{i}"})
                      for i in range(5)]
        limpeza.ler_crm = lambda: self.leads
        limpeza.projeto_da_pasta = lambda pasta: f"demo-{pasta}"
        limpeza.apagar = lambda alvos, a_pedido=False: self.apagou.append([a["projeto"] for a in alvos]) or 0

    def tearDown(self):
        for n, f in self.originais.items():
            setattr(limpeza, n, f)

    def test_apaga_todos_os_que_entram(self):
        self.assertEqual(limpeza.main(["--apagar"]), 0)
        self.assertEqual(self.apagou, [[f"demo-l{i}" for i in range(5)]])

    def test_teto_por_rodada_leva_os_mais_antigos(self):
        limpeza.MAX_POR_RODADA = 2
        limpeza.main(["--apagar"])
        self.assertEqual(self.apagou, [["demo-l0", "demo-l1"]])

    def test_so_os_nomeados_e_nada_se_um_nao_entra(self):
        limpeza.main(["--apagar", "demo-l3"])
        self.assertEqual(self.apagou, [["demo-l3"]])
        self.assertEqual(limpeza.main(["--apagar", "demo-l3", "demo-outro"]), 2)
        self.assertEqual(len(self.apagou), 1)

    def test_simular_e_listar_nao_apagam(self):
        limpeza.main(["--simular"])
        self.assertEqual(limpeza.main(["--simular", "--apagar"]), 2)
        self.assertEqual(limpeza.main(["demo-l1"]), 2)
        self.assertEqual(self.apagou, [])

    def test_central_fora_do_ar_nao_apaga(self):
        def fora():
            raise RuntimeError("não consegui ler o CRM da Central")
        limpeza.ler_crm = fora
        with self.assertRaises(RuntimeError):
            limpeza.main(["--apagar"])
        self.assertEqual(self.apagou, [])


def lead(**kw):
    """Uma linha do retrato da planilha (site-leads.json): é o que o --exclusao lê."""
    base = {"nome": "Fulano", "status": "enviado", "pasta": "fulano", "vercel_project": "demo-fulano",
            "enviado_em": "2026-09-25T16:15:53.000Z", "respondeu_em": "", "fechado_em": "", "recusado_em": ""}
    base.update(kw)
    return base


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
