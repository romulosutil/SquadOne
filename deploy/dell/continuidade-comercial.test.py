import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent))
import continuidade_comercial as m
import campanha_site as c


class Continuidade(unittest.TestCase):
    def test_ultimo_da_fila_enviado_nao_promete_outro_sem_aprovacao(self):
        now = dt.datetime.now(dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp, patch.object(c, 'ler', return_value={'modo': 'continuo-dias-uteis', 'metaContatos': 20}):
            recibo = {'estado': 'enviado', 'enviadoEm': now.isoformat()}
            estado = {'estado': 'pronto', 'enviados': 4, 'fila': [recibo],
                      'proximoEnvioEm': (now+dt.timedelta(minutes=10)).isoformat()}
            m.mostrar_reposicao(estado, {'ativo': True}, tmp, now)
            self.assertEqual(estado['estado'], 'avaliando')
            self.assertIsNone(estado['proximoEnvioEm'])
            self.assertEqual(estado['fila'], [recibo])
            self.assertEqual(estado['enviados'], 4)
            # Um próximo contato aprovado conserva o horário calculado pelo ritmo.
            estado = {'estado': 'pronto', 'fila': [recibo, {'estado': 'pronto'}], 'proximoEnvioEm': 'horario'}
            m.mostrar_reposicao(estado, {'ativo': True}, tmp, now)
            self.assertEqual(estado['estado'], 'pronto')
            self.assertEqual(estado['proximoEnvioEm'], 'horario')

    def test_fila_consumida_continua_em_reposicao_sem_declarar_fim_do_dia(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(c, 'ler', return_value={'modo': 'continuo-dias-uteis', 'metaContatos': 20}):
            estado = {'estado': 'concluido', 'enviados': 3, 'fila': [{'estado': 'enviado'}]}
            m.mostrar_reposicao(estado, {'ativo': True}, tmp, dt.datetime.now(dt.timezone.utc))
        self.assertEqual(estado['estado'], 'avaliando')
        self.assertIn('reposição', estado['detalhe'])
        self.assertIsNone(estado['proximoEnvioEm'])
        self.assertEqual(estado['enviados'], 3)

    def test_meta_cumprida_e_pausa_nao_se_transformam_em_reposicao(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(c, 'ler', return_value={'modo': 'continuo-dias-uteis', 'metaContatos': 20}):
            for config, extra in [({'ativo': True}, {'enviados': 20}), ({'ativo': False}, {'enviados': 3})]:
                estado = {'estado': 'concluido', 'fila': [], **extra}
                m.mostrar_reposicao(estado, config, tmp, dt.datetime.now(dt.timezone.utc))
                self.assertEqual(estado['estado'], 'concluido')

    def test_reposicao_sem_atualizacao_nao_parece_um_dia_concluido(self):
        now = dt.datetime.now(dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp, patch.object(c, 'ler', return_value={'modo': 'continuo-dias-uteis', 'metaContatos': 20}):
            (Path(tmp)/'prospeccao-diaria.json').write_text(json.dumps({'estado': 'repondo-fila', 'atualizadoEm': (now-dt.timedelta(minutes=16)).isoformat()}))
            estado = {'estado': 'concluido', 'enviados': 3, 'fila': []}
            m.mostrar_reposicao(estado, {'ativo': True}, tmp, now)
            self.assertEqual(estado['estado'], 'bloqueado')

    def setUp(self):
        # Estes casos exercitam as regras da campanha com limites legados habilitados.
        for modulo in (m, c):
            politica = patch.object(modulo, 'LIMITES_OPERACIONAIS', True)
            politica.start()
            self.addCleanup(politica.stop)
        self.agora = dt.datetime.fromisoformat('2026-11-12T12:00:00-03:00')
        self.campanha = {'versao': 1, 'ativo': True, 'produto': 'site',
                         'inicioEnvios': '2026-11-10', 'fimEnvios': '2026-11-10',
                         'leadsAutorizados': ['site:a', 'site:b'],
                         'principais': ['site:a', 'site:b'], 'reservas': [], 'metaContatos': 2}
        self.config = {'ativo': True}
        self.linhas = [('a', 'site:a', 'enviado', '2026-11-10T11:00:00Z', 'recibo-a'),
                       ('b', 'site:b', 'enviado', '2026-11-10T11:30:00Z', 'recibo-b')]

    def test_caso_real_lote_concluido_nao_parece_fila_vazia_nem_reenvia(self):
        antes = json.dumps([self.campanha, self.linhas], sort_keys=True)
        d = m.diagnosticar(self.config, self.campanha, self.linhas, self.agora)
        self.assertEqual(d['codigo'], 'campanha-concluida')
        self.assertIn('2 de 2', d['detalhe'])
        self.assertEqual(json.dumps([self.campanha, self.linhas], sort_keys=True), antes)
        self.assertFalse(c.autorizar({'id': 'site:a', 'produto': 'site'}, self.campanha, self.agora, True))

    def test_prazo_vencido_incompleto_pede_nova_campanha(self):
        d = m.diagnosticar(self.config, self.campanha, self.linhas[:1], self.agora)
        self.assertEqual(d['codigo'], 'campanha-vencida')
        self.assertIn('10/11/2026', d['detalhe'])

    def test_tentativa_incerteza_duplicata_e_outro_periodo_nao_completam(self):
        for row in [('b', 'site:b', 'incerto', '2026-11-10T11:30:00Z', ''),
                    ('b', 'site:b', 'enviado', '2026-11-10T11:30:00Z', ''),
                    self.linhas[0], ('b', 'site:b', 'enviado', '2026-11-11T11:30:00Z', 'r')]:
            self.assertEqual(m.diagnosticar(self.config, self.campanha, [self.linhas[0], row], self.agora)['codigo'], 'campanha-vencida')

    def test_fim_da_campanha_usa_meia_noite_de_sao_paulo(self):
        for stamp, vencida in [('2026-11-11T02:59:59+00:00', False), ('2026-11-11T03:00:00+00:00', True)]:
            d = m.diagnosticar(self.config, self.campanha, [], dt.datetime.fromisoformat(stamp))
            self.assertEqual(d is not None, vencida)

    def test_pausa_automatica_preserva_causa_e_data_sem_reativar(self):
        config = {'ativo': False, 'pausadoPor': 'protecao', 'pausadoEm': '2026-11-11T03:02:12Z',
                  'motivoDaPausa': 'WhatsApp desconectado; confira a conta.'}
        d = m.diagnosticar(config, self.campanha, self.linhas, self.agora)
        self.assertEqual(d['codigo'], 'pausa-de-protecao')
        self.assertEqual(d['detalhe'], config['motivoDaPausa'])
        self.assertEqual(d['desde'], config['pausadoEm'])
        self.assertFalse(config['ativo'])

    def test_pausa_manual_e_operacao_sem_manifesto_nao_geram_alarme(self):
        self.assertIsNone(m.diagnosticar({'ativo': False, 'pausadoPor': 'central'}, self.campanha, self.linhas, self.agora))
        self.assertIsNone(m.diagnosticar(self.config, None, [], self.agora))

    def test_manifesto_e_recibo_invalidos_fecham_sem_fabricar_conclusao(self):
        for extra in [{'metaContatos': True}, {'fimEnvios': 'inválido'}, {'ativo': False}, {'produto': 'iris'}]:
            self.assertEqual(m.diagnosticar(self.config, self.campanha | extra, [], self.agora)['codigo'], 'campanha-invalida')
        linhas = [('a', 'site:a', 'enviado', 'sem-data', 'r')]
        self.assertEqual(m.diagnosticar(self.config, self.campanha, linhas, self.agora)['codigo'], 'campanha-invalida')

    def test_registro_ausente_e_json_invalido_bloqueiam(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(c, 'REGISTRO', Path(tmp)/'ausente.sqlite'):
            with patch.object(c, 'ler', return_value=self.campanha):
                self.assertEqual(m.conferir(self.config, self.agora)['codigo'], 'campanha-ilegivel')
                self.assertFalse((Path(tmp)/'ausente.sqlite').exists())
            with patch.object(c, 'ler', side_effect=ValueError):
                self.assertEqual(m.conferir(self.config, self.agora)['codigo'], 'campanha-ilegivel')

    def test_pausa_nao_depende_de_crm_registro_ou_manifesto(self):
        with patch.object(c, 'ler', side_effect=AssertionError('não ler')):
            d = m.conferir({'ativo': False, 'pausadoPor': 'protecao'}, self.agora)
        self.assertEqual(d['codigo'], 'pausa-de-protecao')

    def test_aviso_sobrevive_reinicio_e_nova_causa_avisa(self):
        d = m.diagnosticar(self.config, self.campanha, self.linhas, self.agora)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)/'alertas.json'; avisar = Mock(return_value=True)
            m.avisar_pendencia(d, p, self.agora, avisar)
            m.avisar_pendencia(d, p, self.agora + dt.timedelta(days=1), avisar)
            self.assertEqual(avisar.call_count, 1)
            novo = d | {'desde': '2026-11-12'}
            m.avisar_pendencia(novo, p, self.agora, avisar)
            self.assertEqual(avisar.call_count, 2)

    def test_falha_de_aviso_tenta_de_novo_sem_perder_pendencia(self):
        d = m.diagnosticar(self.config, self.campanha, [], self.agora)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)/'alertas.json'; avisar = Mock(side_effect=[False, True])
            m.avisar_pendencia(d, p, self.agora, avisar)
            m.avisar_pendencia(d, p, self.agora + dt.timedelta(seconds=299), avisar)
            self.assertEqual(avisar.call_count, 1)
            m.avisar_pendencia(d, p, self.agora + dt.timedelta(minutes=5), avisar)
            self.assertTrue(json.loads(p.read_text())['avisado'])
            self.assertEqual(avisar.call_count, 2)

    def test_interrompe_antes_de_crm_e_preserva_metricas_do_dia(self):
        config = {'ativo': False, 'pausadoPor': 'protecao', 'motivoDaPausa': 'Conta em conferência'}
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p/'frente-comercial.json').write_text(json.dumps({'dia': '2026-11-12', 'enviados': 3}))
            gravar = Mock(); avisar = Mock(return_value=True)
            estado = {'dia': '2026-11-12', 'enviados': 0}
            self.assertTrue(m.interromper(estado, config, self.agora, p, gravar, avisar))
            self.assertEqual(estado['enviados'], 3)
            self.assertEqual(estado['detalhe'], 'Conta em conferência')
            self.assertIsNone(estado['proximoEnvioEm'])
            gravar.assert_called_once_with(estado)

    def test_dias_diferentes_nao_reaproveitam_contagem(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp)/'frente-comercial.json').write_text(json.dumps({'dia': '2026-11-10', 'enviados': 4}))
            estado = {'dia': '2026-11-12', 'enviados': 0}
            m.interromper(estado, {'ativo': False, 'pausadoPor': 'protecao'}, self.agora, tmp, Mock(), Mock(return_value=True))
            self.assertEqual(estado['enviados'], 0)

    def test_campanha_continua_renova_dia_sem_reusar_recibo(self):
        config = self.campanha | {'modo': 'continuo-dias-uteis', 'escopo': 'novos-site',
                                  'inicioPreparacao': '2026-11-10'}
        lead = {'id': 'site:nova', 'produto': 'site', 'etapa': 'novo'}
        self.assertTrue(c.autorizar(lead, config, self.agora, True))
        self.assertFalse(c.autorizar(lead | {'produto': 'iris'}, config, self.agora, True))
        self.assertIsNone(m.diagnosticar(self.config, config, self.linhas, self.agora))
        self.assertEqual(c.quantidade_confirmados(config, self.linhas, self.agora), 0)
        linhas = [(k, i, s, stamp.replace('11-10', '11-12'), r) for k, i, s, stamp, r in self.linhas]
        self.assertEqual(m.diagnosticar(self.config, config, linhas, self.agora)['codigo'], 'campanha-concluida')
        self.assertIsNone(m.diagnosticar(self.config, config, linhas, self.agora + dt.timedelta(days=1)))

    def test_continua_exige_opt_in_inicio_e_dia_util(self):
        config = self.campanha | {'modo': 'continuo-dias-uteis', 'escopo': 'novos-site',
                                  'inicioPreparacao': '2026-11-12', 'inicioEnvios': '2026-11-12'}
        lead = {'id': 'site:nova', 'produto': 'site', 'etapa': 'novo'}
        self.assertFalse(c.autorizar(lead, config, self.agora - dt.timedelta(days=1), True))
        self.assertFalse(c.autorizar(lead, config, dt.datetime.fromisoformat('2026-11-14T12:00:00-03:00'), True))
        self.assertFalse(c.autorizar(lead, config | {'escopo': 'qualquer'}, self.agora, True))
        self.assertFalse(c.autorizar(lead, config | {'ativo': False}, self.agora, True))
        self.assertFalse(c.autorizar(lead | {'etapa': 'perdido'}, config, self.agora, True))
        # Manifestos antigos continuam com o prazo original, sem conversão implícita.
        self.assertFalse(c.autorizar(lead, self.campanha, self.agora, True))

    def test_leitura_de_recibos_fecha_conexao_na_protecao_e_em_cada_candidato(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as temp:
            db = Path(temp)/'r.sqlite'
            con = sqlite3.connect(db)
            con.execute('CREATE TABLE contatos(chave,id,estado,em,recibo)'); con.commit(); con.close()
            config = self.campanha | {'inicioPreparacao': '2026-11-10', 'fimEnvios': '2026-11-12'}
            fabrica = sqlite3.connect; abertas = []
            def conectar(*args, **kw):
                connection = fabrica(*args, **kw); abertas.append(connection); return connection
            with patch.object(c, 'ler', return_value=config), patch.object(c, 'REGISTRO', db), \
                 patch.object(sqlite3, 'connect', side_effect=conectar):
                for _ in range(150):
                    self.assertTrue(c.permite({'id': 'site:a', 'produto': 'site'}, self.agora, True))
                    self.assertIsNone(m.conferir(self.config, self.agora))
            self.assertEqual(len(abertas), 300)
            for connection in abertas:
                with self.assertRaises(sqlite3.ProgrammingError): connection.execute('SELECT 1')


class ContinuidadePrimeiroContato(unittest.TestCase):
    def test_campanha_legada_nao_impoe_prazo_ou_dia_util_ao_primeiro_contato(self):
        sabado = dt.datetime.fromisoformat('2026-11-21T12:00:00-03:00')
        campanha = {'ativo': True, 'fimEnvios': '2026-11-10'}
        novo = {'produto': 'site', 'etapa': 'novo'}
        with patch.object(m, 'LIMITES_OPERACIONAIS', False), patch.object(c, 'LIMITES_OPERACIONAIS', False):
            self.assertIsNone(m.diagnosticar({'ativo': True}, campanha, [], sabado))
            self.assertTrue(c.autorizar(novo, campanha, sabado, envio=True))
            self.assertFalse(c.autorizar(novo, {'ativo': False}, sabado, envio=True))
            self.assertFalse(c.autorizar(novo | {'etapa': 'perdido'}, campanha, sabado, envio=True))


if __name__ == '__main__':
    unittest.main()
