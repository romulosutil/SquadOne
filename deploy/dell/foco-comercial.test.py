import unittest
from foco_comercial import ler_foco, perfil_no_foco


class FocoComercial(unittest.TestCase):
    def setUp(self):
        self.foco = ler_foco()

    def avaliar(self, nome, categoria, segmento=0):
        return perfil_no_foco({'nome': nome, 'categoria': categoria}, self.foco['segmentos'][segmento]['consulta'], self.foco)

    def test_especialidade_publica_sustenta_hipotese_sem_inventar_interesse(self):
        r = self.avaliar('Esquadrias Exemplo', 'Fornecedor de esquadrias de alumínio')
        self.assertEqual(r['segmento'], 'esquadrias')
        self.assertIs(r['necessidadeConfirmada'], False)

    def test_categoria_generica_e_busca_sozinhas_nao_confirmam_perfil(self):
        self.assertIsNone(self.avaliar('Comercial Exemplo', 'Loja'))
        self.assertIsNone(self.avaliar('Exemplo', 'Loja de móveis', 1))

    def test_reparos_automotivos_e_franquias_nao_voltam_com_busca_nova(self):
        self.assertIsNone(self.avaliar('Clima Auto', 'Ar condicionado automotivo', 2))
        self.assertIsNone(self.avaliar('Planejados Exemplo Franquia', 'Móveis planejados', 1))

    def test_site_bom_nao_torna_necessidade_de_ia_confirmada(self):
        r = self.avaliar('Projetos Exemplo', 'Empresa de energia solar', 3)
        self.assertFalse(r['necessidadeConfirmada'])
        self.assertFalse(next(o for o in self.foco['ofertasPrincipais'] if o['id']=='automacao-ia')['prospeccaoAutomatica'])


if __name__ == '__main__':
    unittest.main()
