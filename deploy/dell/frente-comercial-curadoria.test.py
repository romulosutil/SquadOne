"""Integração da régua da Marina com o executor; todas as saídas são dubladas."""
import datetime as dt
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('frente_curadoria', Path(__file__).with_name('frente-comercial.py'))
f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)


def lead():
    return {'id': 'site:teste', 'produto': 'site', 'empresa': 'Empresa teste', 'nicho': 'dedetizadora',
            'etapa': 'novo', 'sinal': 'pronto', 'marcos': {}, 'achados': [{'id': 'sem-site'}],
            'mensagemPronta': 'Posso preparar uma demonstração para vocês?',
            'links': {'whatsapp': 'https://wa.me/5511998887766', 'enviar': 'https://example.org/enviar'}}


class IntegracaoCuradoria(unittest.TestCase):
    def setUp(self):
        f._MODELO_CURADORIA = None
        self.addCleanup(setattr, f, '_MODELO_CURADORIA', None)

    def test_site_descoberta_sem_demo_continua_elegivel(self):
        self.assertTrue(f.elegivel(lead()))

    def test_mensagem_afirmando_demo_sem_prova_e_adiada(self):
        l = lead(); l['mensagemPronta'] = 'Montei uma demonstração de site para vocês.'
        self.assertFalse(f.elegivel(l))
        l['links']['site'] = 'https://example.org/demo'
        self.assertTrue(f.elegivel(l))

    def test_restricao_recente_bloqueia_mesmo_com_classe_neutra(self):
        l = lead(); l['classificacaoResposta'] = {'classe': 'neutra'}
        # Restrição é evidência mesmo que um retrato inconsistente não traga a conversa inteira.
        l['conversa'] = {'sinaisComerciais': {'restricao': {'tipo': 'recusa'}}}
        self.assertFalse(f.elegivel(l))

    def test_mudanca_do_modelo_invalida_pareceres(self):
        l = lead(); a = f.hash_avaliacao(l)
        f._MODELO_CURADORIA = {'hash': 'outro-modelo', 'padroes': [], 'semWhatsapp': []}
        self.assertNotEqual(a, f.hash_avaliacao(l))

    def test_destino_morto_em_outra_oferta_bloqueia(self):
        l = lead(); m = f.lib_curadoria()
        f._MODELO_CURADORIA = {'hash': 'modelo', 'padroes': [], 'semWhatsapp': [m.identidade(l)]}
        self.assertFalse(f.elegivel(l))

    def test_modelo_ausente_para_antes_de_inferencia_e_envio(self):
        with tempfile.TemporaryDirectory() as d:
            estados = []
            with patch.object(f, 'H', Path(d)), patch.object(f, 'BASE', Path(d)/'base'), patch.object(f, 'DATA', Path(d)/'data'), \
                 patch.object(f, 'ler_config', return_value={'ativo': True}), \
                 patch.object(f, 'acompanhar_bloqueio', create=True), patch.object(f, 'tratar_incertos', create=True), \
                 patch.object(f, 'ler_crm', return_value={'leads': [lead()]}), \
                 patch.object(f, 'gravar', side_effect=lambda e: estados.append(dict(e))), \
                 patch.object(f, 'inferir') as inferir, patch.object(f, 'enviar') as enviar:
                self.assertFalse(f.rodada())
                inferir.assert_not_called(); enviar.assert_not_called()
            self.assertEqual(estados[-1]['estado'], 'bloqueado')

    def test_modelo_carregado_realmente_orienta_o_executor(self):
        with tempfile.TemporaryDirectory() as d:
            modelo = {'hash': 'modelo-novo', 'padroes': [], 'semWhatsapp': []}
            lib = f.lib_curadoria()
            with patch.object(f, 'H', Path(d)), patch.object(f, 'BASE', Path(d)/'base'), patch.object(f, 'DATA', Path(d)/'data'), \
                 patch.object(f, 'ler_config', return_value={'ativo': True}), \
                 patch.object(f, 'acompanhar_bloqueio', create=True), patch.object(f, 'tratar_incertos', create=True), \
                 patch.object(f, 'ler_crm', return_value={'leads': [lead()]}), patch.object(f, 'gravar'), \
                 patch.object(lib, 'carregar_modelo', return_value=modelo), \
                 patch.object(f, 'metricas_do_funil', side_effect=ValueError('parar teste antes de transporte')):
                self.assertFalse(f.rodada())
                self.assertEqual(f._MODELO_CURADORIA['hash'], 'modelo-novo')

    def test_notas_comerciais_nao_sao_compensadas_por_aprendizado(self):
        avaliacoes = [{'agente': a, 'nota': n, 'decisao': 'contatar'} for (a, _), n in zip(f.ROLES, [100, 100, 64])]
        self.assertIsNone(f.nota_da_selecao(avaliacoes))

    def test_parecer_invalido_adia_lote_sem_aprovar_ou_derrubar_a_rodada(self):
        with tempfile.TemporaryDirectory() as d:
            modelo = {'hash': 'modelo', 'padroes': [], 'semWhatsapp': []}
            lib = f.lib_curadoria(); estados = []
            with patch.object(f, 'H', Path(d)), patch.object(f, 'BASE', Path(d)/'base'), patch.object(f, 'DATA', Path(d)/'data'), \
                 patch.object(f, 'agora', return_value=dt.datetime(2026, 10, 26, 23, tzinfo=dt.timezone.utc)), \
                 patch.object(f, 'ler_config', return_value={'ativo': True}), \
                 patch.object(f, 'acompanhar_bloqueio', create=True), patch.object(f, 'tratar_incertos', create=True), \
                 patch.object(f, 'ler_crm', return_value={'leads': [lead()]}), \
                 patch.object(f, 'gravar', side_effect=lambda e: estados.append(dict(e))), \
                 patch.object(lib, 'carregar_modelo', return_value=modelo), \
                 patch.object(f, 'inferir', side_effect=ValueError('Contrato de avaliação inválido')), \
                 patch.object(f, 'enviar') as enviar:
                self.assertIsNot(f.rodada(), False)
                enviar.assert_not_called()
            self.assertEqual(estados[-1]['lotesEmRevisao'], 1)
            self.assertEqual(estados[-1]['fila'], [])
            self.assertEqual(estados[-1]['estado'], 'fora-do-horario')


if __name__ == '__main__': unittest.main()
