"""Regressões de condições comerciais ausentes; sem rede, PDF ou dados reais."""
import importlib.util
import sys
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
spec = importlib.util.spec_from_file_location("modelo_mapa_testado", AQUI / "modelo_mapa.py")
modelo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(modelo)


class CondicoesDaFonte(unittest.TestCase):
    def recomendar(self, formato="ia", **condicoes):
        depois = {"formato": formato, "titulo": "Título", "texto": "Motivo", **condicoes}
        doc = modelo.Documento({"empresa": "Fixture", "recomendacao": {
            "primeiro": [{"acao": "Ação", "quem": "Pessoa", "efeito": "Efeito"}],
            "depois": depois}}, {})
        return doc, doc.recomendacao()

    def test_formato_nao_preenche_preco_ou_prazo_antigos(self):
        for formato in ("ia", "simplificada"):
            with self.subTest(formato=formato):
                doc, html = self.recomendar(formato)
                self.assertNotIn("R$ 6.500", html)
                self.assertNotIn("4 a 8 semanas", html)
                self.assertIn('[PREENCHER: investimento da Fonte confirmado]', html)
                self.assertIn('[PREENCHER: prazo da Fonte confirmado]', html)

    def test_condicao_explicita_e_preservada_sem_acrescentar_fatos(self):
        doc, html = self.recomendar(prazo="2 semanas após os materiais", investimento="R$ 1.500")
        self.assertIn("2 semanas após os materiais", html)
        self.assertIn("R$ 1.500", html)
        self.assertNotIn("Fonte confirmado]", html)

    def test_cada_lacuna_incrementa_a_contagem_do_rascunho(self):
        completo, _ = self.recomendar(prazo="2 semanas", investimento="R$ 1.500")
        parcial, _ = self.recomendar(prazo="2 semanas")
        vazio, _ = self.recomendar()
        self.assertEqual(parcial.preencher, completo.preencher + 1)
        self.assertEqual(vazio.preencher, completo.preencher + 2)

    def test_condicoes_em_branco_sao_pendentes_e_texto_explicito_e_escapado(self):
        _, html = self.recomendar(prazo=" \t ", investimento="")
        self.assertIn('[PREENCHER: prazo da Fonte confirmado]', html)
        self.assertIn('[PREENCHER: investimento da Fonte confirmado]', html)
        _, html = self.recomendar(prazo="<script>fixture</script>", investimento="A & B")
        self.assertNotIn("<script>fixture", html)
        self.assertIn("&lt;script&gt;fixture&lt;/script&gt;", html)
        self.assertIn("A &amp; B", html)


if __name__ == "__main__":
    unittest.main()
