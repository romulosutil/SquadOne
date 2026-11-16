"""Regressões da política histórica de 13/11; bloqueio vigente é testado separadamente."""
import datetime as dt
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from unittest.mock import Mock
import tempfile
import pesquisa_leads
import campanha_site as campanha
import calendario_comercial as calendario
import continuidade_comercial as continuidade
import prospeccao_diaria as pesquisa
import captura_pronta

spec = importlib.util.spec_from_file_location('fixture_envios', Path(__file__).with_name('frente-comercial.test.py'))
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
f = base.f


class EnviosLivres(unittest.TestCase):
    def setUp(self):
        # Capturador externo dublado: estes testes nunca executam systemctl.
        mock = patch.object(captura_pronta, 'preparar_captura', return_value=True)
        mock.start(); self.addCleanup(mock.stop)

    def test_destinatario_ainda_nao_carregado_nao_reserva_nem_envia(self):
        caso = base.Frente(); caso.setUp()
        try:
            l = base.lead() | {'abordagem': {'mensagem': 'E'}}
            with patch.object(campanha, 'ler', return_value=None), \
                 patch.object(captura_pronta, 'preparar_captura', return_value=False):
                r = caso.rodar({'estado': 'ok', 'leads': [l]}, lambda _: {'reservado': True, 'texto': base.MSG})
            r.reservar.assert_not_called(); r.envio.assert_not_called()
        finally: caso.doCleanups()

    def test_novos_cadastros_atualizam_observador_apos_confirmacao_no_crm(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(pesquisa, 'H', Path(temp)):
            cred = Path(temp)/'.config/claude-ops/crm-segredo'
            cred.parent.mkdir(parents=True);cred.write_text('segredo-falso')
            resposta = Mock(status=200)
            resposta.__enter__ = Mock(return_value=resposta);resposta.__exit__ = Mock(return_value=False)
            opener = Mock();opener.open.return_value = resposta
            with patch.object(pesquisa.urllib.request, 'build_opener', return_value=opener), \
                 patch.object(pesquisa_leads, 'json_http', return_value={'estado': 'ok', 'leads': [{'id': 'site:nova'}]}), \
                 patch.object(pesquisa.subprocess, 'run') as atualizar:
                self.assertTrue(pesquisa.sincronizar_crm(['site:nova'], atualizar_observador=True))
                atualizar.assert_called_once_with(['systemctl', '--user', 'restart', 'whatsapp-observador-prumo.service'],
                                                   check=True, timeout=20, capture_output=True)

    def test_novo_contato_envia_sem_modelo_de_curadoria_nem_inferencia(self):
        caso = base.Frente(); caso.setUp()
        try:
            l = base.lead() | {'abordagem': {'mensagem': 'E'}}
            with patch.object(campanha, 'ler', return_value=None), \
                 patch.object(f, 'lib_curadoria', side_effect=AssertionError('não deve ler modelo')):
                resultado = caso.rodar({'estado': 'ok', 'leads': [l]},
                                       lambda _: {'reservado': True, 'texto': base.MSG})
            resultado.ai.assert_not_called()
            resultado.envio.assert_called_once()
            estado = resultado.estados[-1]
            self.assertEqual(estado['fila'][0]['avaliacoes'], [])
            self.assertIsNone(estado['fila'][0]['nota'])
            self.assertEqual(estado['enviados'], 1)
            self.assertIsNone(estado['proximoEnvioEm'])
        finally: caso.doCleanups()

    def test_recusa_exclusao_historico_e_destino_invalido_continuam_fora(self):
        l = base.lead() | {'abordagem': {'mensagem': 'E'}}
        with patch.object(campanha, 'ler', return_value=None):
            for extra in [{'classificacaoResposta': {'classe': 'recusa'}},
                          {'classificacaoResposta': {'classe': 'exclusao'}},
                          {'marcos': {'enviado': '2026-11-12T12:00:00Z'}},
                          {'conversa': {'mensagens': 1}}, {'etapa': 'perdido'},
                          {'links': {'whatsapp': 'https://wa.me/invalido'}}]:
                self.assertFalse(f.elegivel(l | extra), extra)

    def test_rodada_cota_e_parecer_antigos_nao_impedem_reposicao(self):
        l = base.lead() | {'pasta': {'slug': 'prospeccao-nova'}}
        d = pesquisa.demanda({'estado': 'ok', 'leads': [l]},
                            {'ativo': True, 'enviados': 200, 'limite': None,
                             'rodada': {'bloqueado': True}, 'fila': []}, avaliados=[l['id']])
        self.assertTrue(d['buscar'])
        self.assertEqual(d['emAvaliacao'], 1)

    def test_calendario_e_campanha_concluida_nao_interrompem(self):
        now = dt.datetime.fromisoformat('2026-11-15T03:00:00-03:00')
        self.assertEqual(calendario.proximo_expediente(now), now)
        self.assertIsNone(continuidade.diagnosticar({'ativo': True}, {'metaContatos': 20}, [], now))

    def test_carteira_antiga_nao_ocupa_estoque_da_nova_pesquisa(self):
        config = {'ativo': True, 'pesquisaNovaDesde': '2026-11-13T15:00:00-03:00'}
        antigo = base.lead() | {'eventos': [{'tipo': 'encontrado', 'em': '2026-11-12T12:00:00Z'}]}
        novo = base.lead('site:nova') | {'eventos': [{'tipo': 'encontrado', 'em': '2026-11-13T19:00:00Z'}],
                                      'pasta': {'slug': 'prospeccao-nova'}}
        self.assertFalse(campanha.autorizar(antigo, config))
        self.assertTrue(campanha.autorizar(novo, config))
        d = pesquisa.demanda({'estado': 'ok', 'leads': [antigo, novo]},
                            {'ativo': True, 'fila': [{'id': antigo['id'], 'estado': 'pronto'}]}, config=config)
        self.assertEqual(d['aprovados'], 0)
        self.assertEqual(d['emAvaliacao'], 1)


if __name__ == '__main__': unittest.main()
