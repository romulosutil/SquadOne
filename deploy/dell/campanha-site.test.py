import datetime as dt
import importlib.util
from pathlib import Path
import unittest
import json
import tempfile

s = importlib.util.spec_from_file_location('campanha', Path(__file__).with_name('campanha_site.py'))
m = importlib.util.module_from_spec(s);s.loader.exec_module(m)


class Campanha(unittest.TestCase):
    def setUp(self):
        self.c = {'versao': 1, 'ativo': True, 'produto': 'site', 'inicioPreparacao': '2026-11-01',
                  'inicioEnvios': '2026-11-03', 'fimEnvios': '2026-11-06', 'leadsAutorizados': ['site:a']}
        self.l = {'id': 'site:a', 'produto': 'site'}

    def test_prepara_no_domingo_mas_envia_somente_no_periodo_aprovado(self):
        for dia, esperado in [(1, False), (2, False), (3, True), (6, True), (7, False)]:
            agora = dt.datetime(2026, 11, dia, 12, tzinfo=dt.timezone.utc)
            self.assertEqual(m.autorizar(self.l, self.c, agora, envio=True), esperado)
        self.assertTrue(m.autorizar(self.l, self.c, dt.datetime(2026, 11, 1, 12, tzinfo=dt.timezone.utc)))

    def test_outra_oferta_ou_candidato_nao_autorizado_nao_entram(self):
        agora = dt.datetime(2026, 11, 3, 12, tzinfo=dt.timezone.utc)
        self.assertFalse(m.autorizar({'id': 'iris:a', 'produto': 'iris'}, self.c, agora))
        self.assertFalse(m.autorizar({'id': 'site:b', 'produto': 'site'}, self.c, agora))
        self.assertFalse(m.autorizar(self.l, {}, agora))
        self.assertFalse(m.autorizar(self.l, self.c, agora.replace(tzinfo=None)))

    def test_fuso_local_conta_e_fora_da_campanha_preserva_operacao_sem_config(self):
        self.assertFalse(m.autorizar(self.l, self.c, dt.datetime(2026, 11, 3, 1, tzinfo=dt.timezone.utc), envio=True))
        self.assertTrue(m.autorizar(self.l, None))

    def test_indicadores_preservam_data_da_fonte_sem_expor_url_ou_telefone(self):
        agora = dt.datetime(2026, 11, 1, 12, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp:
            pasta = Path(tmp) / 'empresa'; pasta.mkdir()
            (pasta/'content.md').write_text('- **Telefone:** +55 11 99999-1111', encoding='utf-8')
            cache = {'place_id': 'a', 'lido_em': '2026-10-20T12:00:00+00:00', 'detalhes':
                     {'maps': 'https://maps.google.com/?cid=123', 'nome': 'Empresa', 'status': 'OPERATIONAL'}}
            arquivo = pasta/'raio-x-places.json'; arquivo.write_text(json.dumps(cache), encoding='utf-8')
            lead = {'id': 'site:a', 'produto': 'site', 'empresa': 'Empresa', 'pasta': {'slug': 'empresa'},
                    'links': {'whatsapp': 'https://wa.me/5511999991111'}}
            e = m.evidencia_site(lead, Path(tmp), agora)
            self.assertTrue(e['identidadeDoNomeConfere'])
            self.assertTrue(e['contatoCorrespondeAoPublicadoNaFicha'])
            self.assertEqual(e['coletadoEm'], cache['lido_em'])
            self.assertNotIn('5511999991111', json.dumps(e))
            self.assertNotIn('https://', json.dumps(e))
            cache['lido_em'] = '2026-09-01T12:00:00+00:00'; arquivo.write_text(json.dumps(cache), encoding='utf-8')
            self.assertIsNone(m.evidencia_site(lead, Path(tmp), agora))

    def test_reserva_aguarda_principais_e_entra_quando_eles_nao_estao_disponiveis(self):
        config = {'principais': ['site:a', 'site:b'], 'reservas': ['site:r']}
        fila = [{'id': 'site:r'}, {'id': 'site:b'}, {'id': 'site:a'}]
        self.assertEqual([x['id'] for x in m.priorizar_fila(fila, config)], ['site:b', 'site:a', 'site:r'])
        self.assertEqual(m.priorizar_fila([fila[0]], config), [fila[0]])
        self.assertEqual(m.priorizar_fila(fila, None), fila)

    def test_candidato_em_pesquisa_nao_ganha_envio_sem_entrar_no_manifesto(self):
        agora = dt.datetime(2026, 11, 3, 12, tzinfo=dt.timezone.utc)
        self.c.update(principais=['site:b'], reservas=[])
        self.assertTrue(m.autorizar(self.l, self.c, agora))
        self.assertFalse(m.autorizar(self.l, self.c, agora, envio=True))
        self.c['reservas'] = ['site:a']
        self.assertTrue(m.autorizar(self.l, self.c, agora, envio=True))

    def test_complemento_preserva_origem_e_rejeita_fonte_vencida_ou_identidade_errada(self):
        agora = dt.datetime(2026, 11, 1, 12, tzinfo=dt.timezone.utc)
        d = {'versao': 1, 'place_id': 'a', 'conferidoEm': agora.isoformat(),
             'fontes': [{'url': 'https://minhareceita.org/12345678000100',
                         'coletadoEm': agora.isoformat(), 'tipo': 'cadastro publico'}],
             'observacoes': ['Atividade e municipio conferidos; necessidade comercial desconhecida.']}
        resultado = m.complemento_publico(d, 'a', agora)
        self.assertEqual(resultado['fontes'][0]['dominio'], 'minhareceita.org')
        self.assertNotIn('12345678000100', json.dumps(resultado))
        self.assertNotIn('https://', json.dumps(resultado))
        self.assertIsNone(m.complemento_publico(d, 'outro', agora))
        self.assertIsNone(m.complemento_publico(d, 'a', agora + dt.timedelta(days=8)))
        d['fontes'][0]['coletadoEm'] = (agora - dt.timedelta(days=31)).isoformat()
        self.assertIsNone(m.complemento_publico(d, 'a', agora))


if __name__ == '__main__':
    unittest.main()
