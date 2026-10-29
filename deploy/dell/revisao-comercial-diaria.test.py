import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('revisao', Path(__file__).with_name('revisao-comercial-diaria.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NOW = dt.datetime.fromisoformat('2026-10-28T13:00:00+00:00')


class RevisaoTest(unittest.TestCase):
    def fixture(self, classe='permissao'):
        lead = {'id': 'site:x', 'produto': 'site', 'empresa': 'Exemplo', 'nicho': 'advocacia',
                'marcos': {'enviado': '2026-10-27T13:00:00Z'},
                'classificacaoResposta': {'classe': classe, 'houveRespostaHumana': classe == 'permissao',
                    'revisar': False, 'evidencia': {'em': '2026-10-27T13:10:00Z'}}}
        crm = {'estado': 'ok', 'geradoEm': NOW.isoformat(), 'leads': [lead]}
        msgs = [{'direcao': 'saida', 'em': '2026-10-27T13:00:00Z', 'texto': 'Posso enviar a análise?'},
                {'direcao': 'entrada', 'em': '2026-10-27T13:10:00Z', 'texto': 'pode sim'},
                {'direcao': 'saida', 'em': '2026-10-27T17:29:00Z', 'texto': 'https://exemplo.test/analise'}]
        return crm, [], {'site:x': {'mensagens': msgs}}

    def test_dia_de_sao_paulo(self):
        self.assertTrue(m.no_dia('2026-10-28T01:00:00Z', '2026-10-27'))
        self.assertFalse(m.no_dia('2026-10-28T03:00:00Z', '2026-10-27'))

    def test_permissao_nao_e_venda_e_atraso(self):
        resumo, casos = m.analisar(*self.fixture(), '2026-10-27', NOW)
        self.assertEqual(resumo['resultadosPrimeiros'], {'permissao': 1})
        self.assertEqual(casos[0]['minutosPermissaoAteLink'], 259)
        self.assertEqual(resumo['entregasAcimaDe30Min'], 1)
        self.assertNotIn('textoEnviado', str(resumo))

    def test_robo_nao_e_permissao(self):
        resumo, casos = m.analisar(*self.fixture('robo'), '2026-10-27', NOW)
        self.assertEqual(resumo['resultadosPrimeiros'], {'robo': 1})
        self.assertIsNone(casos[0]['minutosPermissaoAteLink'])

    def test_fonte_antiga_e_cobertura_incompleta(self):
        crm, registros, conversas = self.fixture()
        with self.assertRaises(ValueError):
            m.analisar(crm, registros, {}, '2026-10-27', NOW)
        crm['geradoEm'] = '2026-10-27T13:00:00Z'
        with self.assertRaises(ValueError):
            m.analisar(crm, registros, conversas, '2026-10-27', NOW)

    def test_sem_link_continua_pendente(self):
        crm, registros, conversas = self.fixture()
        conversas['site:x']['mensagens'].pop()
        resumo, _ = m.analisar(crm, registros, conversas, '2026-10-27', NOW)
        self.assertEqual(resumo['permissoesSemLink'], 1)


if __name__ == '__main__':
    unittest.main()
