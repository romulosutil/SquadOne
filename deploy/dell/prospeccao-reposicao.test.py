"""Reposição acompanha o consumo; nenhum teste usa rede ou envia mensagem."""
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent))
import prospeccao_diaria as p
import pesquisa_leads as pesquisa
import campanha_site as campanha
import calendario_comercial as calendario

NOW = dt.datetime.fromisoformat('2026-11-12T15:43:00-03:00')
CONFIG = {'versao': 1, 'ativo': True, 'produto': 'site', 'modo': 'continuo-dias-uteis',
          'escopo': 'novos-site', 'leadsAutorizados': [], 'inicioPreparacao': '2026-11-12',
          'inicioEnvios': '2026-11-12', 'metaContatos': 20}


def lead(i=0, **extra):
    return {'id': f'site:{i}', 'produto': 'site', 'empresa': 'Empresa de teste', 'etapa': 'novo',
            'sinal': 'pronto', 'marcos': {}, 'pasta': {'slug': 'prospeccao-'+str(i)}, **extra}


def frente(fila=None, **extra):
    return {'ativo': True, 'enviados': 3, 'limite': 20, 'fila': fila or [], 'rodada': {'bloqueado': False}, **extra}


class Estoque(unittest.TestCase):
    def test_fila_consumida_inicia_reposicao_sem_esperar_duas_horas(self):
        ls = [lead(0, etapa='contato'), lead(1, etapa='contato')]
        d = p.demanda({'estado': 'ok', 'leads': ls}, frente([{'id': l['id'], 'estado': 'enviado'} for l in ls]))
        self.assertTrue(d['buscar']); self.assertEqual(d['aprovados'], 0)

    def test_suficientes_aprovados_e_pendentes_pausam_somente_a_busca(self):
        ls = [lead(i) for i in range(6)]
        f = frente([{'id': x['id'], 'estado': 'pronto'} for x in ls[:3]])
        d = p.demanda({'estado': 'ok', 'leads': ls}, f)
        self.assertFalse(d['buscar']); self.assertEqual((d['aprovados'], d['emAvaliacao']), (3, 3))
        ls[0]['etapa'] = 'contato'
        self.assertTrue(p.demanda({'estado': 'ok', 'leads': ls}, f)['buscar'])

    def test_avaliado_reprovado_ou_sem_whatsapp_nao_e_estoque(self):
        ls = [lead(i) for i in range(6)]
        d = p.demanda({'estado': 'ok', 'leads': ls}, frente(), contatos=['site:0'], avaliados=['site:1'])
        self.assertTrue(d['buscar']); self.assertEqual(d['emAvaliacao'], 4)

    def test_fila_antiga_nao_transforma_recusa_exclusao_ou_conversa_em_estoque(self):
        ls = [lead(i, **extra) for i, extra in enumerate([
            {'etapa': 'perdido'}, {'resposta': {'tipo': 'negativa'}}, {'conversa': {'mensagens': 1}},
            {'responsavelConversa': {'responsavel': 'romulo'}}, {'classificacaoResposta': {'classe': 'exclusao'}},
            {'marcos': {'enviado': NOW.isoformat()}}])]
        d = p.demanda({'estado': 'ok', 'leads': ls}, frente([{'id': x['id'], 'estado': 'pronto'} for x in ls]))
        self.assertEqual((d['aprovados'], d['emAvaliacao']), (0, 0))

    def test_limite_diario_pausa_e_rodada_continuam_obrigatorios(self):
        for f in [frente(ativo=False), frente(enviados=20), frente(rodada={'bloqueado': True})]:
            self.assertFalse(p.demanda({'estado': 'ok', 'leads': []}, f)['buscar'])
        with self.assertRaises(ValueError): p.demanda({'estado': 'sem-retrato'}, frente())

    def test_timer_confere_estoque_antes_de_cada_intervalo_de_envio(self):
        s = (Path(__file__).parent/'prospeccao-diaria.timer').read_text()
        self.assertIn('OnUnitInactiveSec=2min', s)
        self.assertNotIn('08,10,12,14,16', s)


class Ciclo(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name); self.base = self.home/'pesquisa'
        self.base.mkdir(); self.crm = {'estado': 'ok', 'leads': [lead(99, etapa='contato')]}
        self.frente = frente()
        for mock in [patch.object(p, 'H', self.home), patch.object(p, 'BASE', self.base),
                     patch.object(campanha, 'ler', return_value=CONFIG),
                     patch.object(calendario, 'proximo_expediente', return_value=NOW),
                     patch.object(p, 'ler_controle', return_value=(set(), set())),
                     patch.object(pesquisa, 'json_http', side_effect=lambda url, **_: self.frente if url.endswith('/frente') else self.crm)]:
            mock.start(); self.addCleanup(mock.stop)

    def test_o_antigo_corte_de_60_nao_esgota_o_dia_com_apenas_tres_envios(self):
        (self.base/'uso.json').write_text(json.dumps({'dia': '2026-11-12', 'consultas': 60, 'indice': 8, 'cadastrados': 4}))
        with patch.object(p, 'ler_dom', return_value='<html></html>') as dom:
            r = p._executar(NOW)
        self.assertEqual(r['estado'], 'pesquisa-sem-candidato-apto'); dom.assert_called_once()
        self.assertEqual(json.loads((self.base/'uso.json').read_text())['consultas'], 61)

    def test_orcamento_esgotado_nao_abre_rede_e_dia_seguinte_renova_so_pesquisa(self):
        (self.base/'uso.json').write_text(json.dumps({'dia': '2026-11-12', 'consultas': p.MAX_LEITURAS_DIA, 'indice': 8, 'cadastrados': 4}))
        with patch.object(p, 'ler_dom', return_value='<html></html>') as dom:
            self.assertEqual(p._executar(NOW)['estado'], 'limite-de-pesquisa'); dom.assert_not_called()
            p._executar(NOW+dt.timedelta(days=1)); dom.assert_called_once()
        self.assertEqual(json.loads((self.base/'uso.json').read_text())['consultas'], 1)

    def test_estoque_suficiente_nao_consulta_maps(self):
        self.crm['leads'] = [lead(i) for i in range(6)]
        self.frente = frente([{'id': x['id'], 'estado': 'pronto'} for x in self.crm['leads']])
        with patch.object(p, 'ler_dom') as dom:
            self.assertEqual(p._executar(NOW)['estado'], 'estoque-suficiente'); dom.assert_not_called()

    def test_falha_de_sincronizacao_persiste_e_e_retentada_antes_de_nova_busca(self):
        pendente = self.base/'sincronizacao-pendente.json'; pendente.write_text('["site:novo"]')
        with patch.object(p, 'sincronizar_crm', side_effect=TimeoutError('corpo privado')), patch.object(p, 'ler_dom') as dom:
            with self.assertRaises(TimeoutError): p._executar(NOW)
            dom.assert_not_called()
        self.assertEqual(json.loads(pendente.read_text()), ['site:novo'])
        self.crm['leads'] = [lead(i) for i in range(6)]
        self.frente = frente([{'id': x['id'], 'estado': 'pronto'} for x in self.crm['leads']])
        with patch.object(p, 'sincronizar_crm', return_value=True) as sync:
            self.assertEqual(p._executar(NOW)['estado'], 'estoque-suficiente'); sync.assert_called_once_with(['site:novo'])
        self.assertEqual(json.loads(pendente.read_text()), [])

    def test_falha_e_publicada_sem_dados_privados(self):
        with patch.object(p, '_executar', side_effect=RuntimeError('credencial ou conversa privada')):
            r = p.executar()
        publicado = json.loads((self.home/'.local/share/squadone-operations/prospeccao-diaria.json').read_text())
        self.assertEqual(r['estado'], 'bloqueado'); self.assertEqual(publicado['falha'], 'RuntimeError')
        self.assertNotIn('conversa privada', json.dumps(publicado))

    def test_erro_em_um_perfil_nao_descarta_os_demais_da_busca(self):
        ids = [('ChIJtestabcdefghijklmno', 'https://www.google.com/maps/place/teste')]
        with patch.object(p, 'resultados', return_value=ids), patch.object(p, 'ler_dom', side_effect=['busca', TimeoutError()]):
            r = p._executar(NOW)
        self.assertEqual(r['estado'], 'pesquisa-sem-candidato-apto')
        self.assertEqual(r['descartes']['falhaDeLeitura'], 1)


class Sincronizacao(unittest.TestCase):
    def test_ack_do_webhook_so_confirma_quando_o_crm_mostra_o_candidato(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(p, 'H', Path(temp)):
            cred = Path(temp)/'.config/claude-ops/crm-segredo'; cred.parent.mkdir(parents=True); cred.write_text('segredo-de-teste')
            resposta = Mock(status=200); resposta.__enter__ = Mock(return_value=resposta); resposta.__exit__ = Mock(return_value=False)
            opener = Mock(); opener.open.return_value = resposta
            with patch.object(p.urllib.request, 'build_opener', return_value=opener), \
                 patch.object(pesquisa, 'json_http', side_effect=[{'estado': 'ok', 'leads': []}, {'estado': 'ok', 'leads': [{'id': 'site:novo'}]}]), \
                 patch.object(p.time, 'sleep') as sleep:
                self.assertTrue(p.sincronizar_crm(['site:novo']))
                sleep.assert_called_once_with(3)
            req = opener.open.call_args.args[0]
            self.assertEqual(req.full_url, 'http://127.0.0.1:5679/webhook/crm-atualizar')
            self.assertEqual(req.data, b'{}')


if __name__ == '__main__': unittest.main()
