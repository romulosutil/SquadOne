import datetime as dt
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import pesquisa_leads as p
import campanha_site as c


class Continua(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime.fromisoformat('2026-11-12T12:00:00-03:00')
        self.config = {'versao': 1, 'ativo': True, 'produto': 'site', 'modo': 'continuo-dias-uteis',
                       'escopo': 'novos-site', 'inicioEnvios': '2026-11-12', 'inicioPreparacao': '2026-11-12',
                       'leadsAutorizados': [], 'metaContatos': 20}
        self.lead = {'id': 'site:nova', 'produto': 'site', 'empresa': 'Empresa exemplo', 'etapa': 'novo',
                     'links': {'whatsapp': 'https://wa.me/5511999991111'}, 'marcos': {}}

    def selecionar(self, leads, dossiers=None):
        with patch.object(p, 'agora', return_value=self.now), patch.object(p, 'ler', return_value={}):
            return p.selecionar({'leads': leads}, dossiers or {}, [], 10, self.config)

    def test_proximo_dia_pesquisa_novos_cadastros_sem_lista_congelada(self):
        self.assertEqual(self.selecionar([self.lead]), [self.lead])
        self.now += dt.timedelta(days=1)
        novo = self.lead | {'id': 'site:outra'}
        self.assertEqual(self.selecionar([novo]), [novo])

    def test_contato_recusa_exclusao_pausa_e_outro_produto_nao_voltam(self):
        for extra in [{'etapa': 'perdido'}, {'resposta': {'tipo': 'negativa'}},
                      {'marcos': {'enviado': '2026-11-10T12:00:00Z'}}, {'conversa': {'mensagens': 1}},
                      {'proximoPasso': {'texto': 'aguarde'}}, {'produto': 'iris'},
                      {'responsavelConversa': {'responsavel': 'romulo'}},
                      {'classificacaoResposta': {'classe': 'exclusao'}}]:
            self.assertEqual(self.selecionar([self.lead | extra]), [], extra)

    def test_evidencia_atual_nao_refaz_consulta_e_vencida_retoma(self):
        dossier = {'assinatura': p.assinatura(self.lead), 'em': self.now.isoformat()}
        self.assertEqual(self.selecionar([self.lead], {self.lead['id']: dossier}), [])
        dossier['em'] = (self.now - dt.timedelta(days=8)).isoformat()
        self.assertEqual(self.selecionar([self.lead], {self.lead['id']: dossier}), [self.lead])

    def test_workflow_de_pesquisa_nao_expira_em_data_fixa(self):
        arquivo = Path(__file__).parent/'claude-ops/pesquisa-leads-n8n.py'
        spec = importlib.util.spec_from_file_location('pesquisa_workflow', arquivo)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        w = module.workflow('credencial-falsa')
        node = next(n for n in w['nodes'] if n['name'] == 'Conferir semana autorizada')
        self.assertNotIn('2026-11-06', node['parameters']['jsCode'])
        self.assertIn('limite:10', node['parameters']['jsCode'])

    def test_executor_de_pesquisa_usa_manifesto_vigente(self):
        # Exercita a seleção via executar, parando antes de qualquer rede pública.
        import tempfile
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, 'BASE', Path(tmp)), \
             patch.object(p, 'json_http', return_value={'estado': 'ok', 'leads': [self.lead]}), \
             patch.object(p, 'validar_crm'), patch.object(p, 'ler', return_value={}), \
             patch.object(c, 'ler', return_value=self.config) as atual, \
             patch.object(p, 'selecionar', side_effect=RuntimeError('parada antes da pesquisa')) as selecionar:
            with self.assertRaisesRegex(RuntimeError, 'parada antes'):
                p.executar(10)
            atual.assert_called_once()
            self.assertEqual(selecionar.call_args.args[-1], self.config)


if __name__ == '__main__':
    unittest.main()
