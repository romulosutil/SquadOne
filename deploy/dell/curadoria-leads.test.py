import datetime as dt
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('curadoria_servico', Path(__file__).with_name('curadoria-leads.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
NOW = dt.datetime(2026, 10, 26, 22, tzinfo=dt.timezone.utc)


class ServicoCuradoria(unittest.TestCase):
    def test_memoria_e_historico_atomicos_e_privados(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'privado/modelo.json'
            m.atomico(p, {'versao': 'primeira'})
            m.atomico(p, {'versao': 'segunda'})
            self.assertEqual(json.loads(p.read_text())['versao'], 'segunda')
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600)
            self.assertFalse(p.with_name(p.name+'.tmp').exists())

    def test_fonte_antiga_ou_incompleta_nao_renova_modelo(self):
        crm = {'estado': 'ok', 'geradoEm': (NOW-dt.timedelta(hours=1)).isoformat(), 'leads': [{'id': 'site:1'}]}
        with self.assertRaises(ValueError): m.revisar(crm, [], NOW)
        crm['geradoEm'] = NOW.isoformat(); crm['fontes'] = [{'erro': 'indisponível'}]
        with self.assertRaises(ValueError): m.revisar(crm, [], NOW)

    def test_relatorio_separa_envio_de_destino_sem_whatsapp(self):
        l = {'id': 'site:1', 'empresa': 'Empresa', 'produto': 'site', 'etapa': 'contato', 'marcos': {'enviado': NOW.isoformat()},
             'links': {'whatsapp': 'https://wa.me/5511998887766'}, 'classificacaoResposta': {'classe': 'robo'}}
        crm = {'estado': 'ok', 'geradoEm': NOW.isoformat(), 'leads': [l]}
        _, _, r, _ = m.revisar(crm, [{'estado': 'sem_whatsapp', 'em': NOW.isoformat(), 'chave': '1199887766'}], NOW)
        self.assertEqual(r['contatadosHoje'], 1)
        self.assertEqual(r['resultadosHoje'], {'robo': 1})
        self.assertEqual(r['tentativasSemWhatsappHoje'], 1)


if __name__ == '__main__': unittest.main()
