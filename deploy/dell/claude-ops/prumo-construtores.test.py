"""Construtores de fluxo do PRUMO (clique do convite, Medição, proxy do Sheets), de 19/10/2026.

Sem n8n, planilha ou rede: o módulo `n8n` é um dublê e o que seria enviado fica numa lista.
Os nós Code são executados no node quando ele existe (o mesmo helper de workflow_confiabilidade.test.py).
"""
import importlib.util
import json
import shutil
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

BASE = Path(__file__).resolve().parent
ENVIOS = []          # (método, caminho, corpo) de tudo que os construtores mandariam ao n8n
EXISTENTES = []      # o que o GET /workflows devolve


def api(metodo, caminho, corpo=None):
    ENVIOS.append((metodo, caminho, corpo))
    if metodo == 'GET' and caminho.startswith('/workflows?'):
        return {'data': EXISTENTES}
    if metodo == 'POST' and caminho == '/workflows':
        return {'id': 'novo-id'}
    return {}


falso_n8n = types.ModuleType('n8n')
falso_n8n.api = api
falso_n8n.put = lambda wf: ENVIOS.append(('PUT', '/workflows/' + wf['id'], wf)) or {'id': wf['id']}
falso_n8n.aviso_nodes = lambda prefixo, *a, **k: ({'name': prefixo + ': montar aviso'}, {'name': prefixo + ': avisar'})
falso_proxy = types.ModuleType('sheets_proxy')
falso_proxy.SheetsProxy = object


# Fixos no processo do teste: os construtores carregam fecha-ciclos.py na hora de publicar, e ele também importa n8n.
sys.modules['n8n'] = falso_n8n
sys.modules['sheets_proxy'] = falso_proxy


def carregar(arquivo):
    spec = importlib.util.spec_from_file_location(arquivo.replace('-', '_').replace('.py', ''), BASE / arquivo)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def rodar_js(codigo, consulta, linha):
    fonte = ('const $=()=>({first:()=>({json:{query:' + json.dumps(consulta) + '}})});'
             'const $input={first:()=>({json:' + json.dumps(linha, ensure_ascii=False) + '})};'
             '(async()=>{const r=await(async()=>{\n' + codigo + '\n})();console.log(JSON.stringify(r));})().catch(e=>{console.error(e);process.exit(1)});')
    p = subprocess.run([shutil.which('node') or 'node', '-e', fonte], capture_output=True, text=True, encoding='utf-8', timeout=15)
    if p.returncode:
        raise AssertionError(p.stderr)
    return json.loads(p.stdout)


class CliqueDoConvite(unittest.TestCase):
    def setUp(self):
        ENVIOS.clear()
        EXISTENTES[:] = [{'id': 'erro-id', 'name': '00 · Avisar falha pelo Hermes'}]
        self.simples = carregar('prumo-simples.py')
        self.ofertas = carregar('prumo-ofertas.py')

    def publicar(self, nome='PRUMO — Clique em Enviar convite', antigo='PRUMO — Clique em Enviar convite (marca enviado)'):
        return self.simples.clique_workflow(nome, antigo, 'convite', 'wh-1', 'planilha', '1', 'Prospects', "return [{json:{destino:'x'}}];")

    def wf_publicado(self):
        return next(c for m, p, c in ENVIOS if m in ('POST', 'PUT') and isinstance(c, dict) and 'nodes' in c)

    def test_sem_primeiro_clique_nem_marcar_como_enviado(self):
        self.publicar()
        wf = self.wf_publicado()
        self.assertEqual([n['name'] for n in wf['nodes']], ['Clique (convite)', 'Ler a linha', 'Decidir', 'Abrir o canal'])
        self.assertEqual(wf['name'], 'PRUMO — Clique em Enviar convite')
        self.assertNotIn('Marcar como enviado', json.dumps(wf))
        self.assertNotIn('Primeiro clique?', json.dumps(wf))
        self.assertEqual(wf['connections']['Decidir']['main'][0][0]['node'], 'Abrir o canal')

    def test_fluxo_com_o_nome_antigo_e_trocado_pelo_id_sem_duplicar(self):
        EXISTENTES.append({'id': 'antigo-id', 'name': 'PRUMO — Clique em Enviar convite (marca enviado)'})
        self.publicar()
        puts = [(m, p) for m, p, _ in ENVIOS if m in ('PUT', 'POST') and p.startswith('/workflows') and not p.endswith('activate')]
        self.assertEqual(puts, [('PUT', '/workflows/antigo-id')])
        self.assertIn(('POST', '/workflows/antigo-id/activate', None), ENVIOS)

    def test_se_os_dois_nomes_existem_vale_o_novo(self):
        EXISTENTES.extend([{'id': 'antigo-id', 'name': 'PRUMO — Clique em Enviar convite (marca enviado)'},
                           {'id': 'novo-ja', 'name': 'PRUMO — Clique em Enviar convite'}])
        self.publicar()
        self.assertIn(('PUT', '/workflows/novo-ja'), [(m, p) for m, p, _ in ENVIOS])

    def test_sem_fluxo_nenhum_cria_e_ativa(self):
        self.publicar()
        self.assertIn(('POST', '/workflows/novo-id/activate', None), ENVIOS)

    def test_ofertas_chamam_o_mesmo_construtor_com_o_nome_antigo(self):
        visto = {}
        falso = types.SimpleNamespace(clique_workflow=lambda *a: visto.setdefault('args', a))
        with patch.object(self.ofertas, '_modulo', return_value=falso):
            self.ofertas.clique('iris', {'iris': 7})
        nome, antigo, caminho = visto['args'][:3]
        self.assertEqual(nome, self.ofertas.CONFIG['ofertas']['iris']['clique'])
        self.assertFalse(nome.endswith('(marca enviado)'))
        self.assertEqual(antigo, nome + ' (marca enviado)')
        self.assertEqual(caminho, 'convite-iris')

    def test_decidir_so_devolve_o_destino_e_usa_a_regra_unica_do_nome(self):
        if not shutil.which('node'):
            self.skipTest('sem node')
        linha = {'ID': 'p1', 'Empresa': 'roda mais distribuidora ltda', 'WhatsApp': '(27) 99999-2222'}
        for codigo in (self.ofertas.decidir_js(self.ofertas.CONFIG['ofertas']['iris'], 9), None):
            if codigo is None:
                captado = {}
                with patch.object(self.simples, 'clique_workflow', side_effect=lambda *a: captado.setdefault('js', a[-1])):
                    self.simples.convite(1)
                codigo = captado['js']
            saida = rodar_js(codigo, {'id': 'p1'}, linha)[0]['json']
            self.assertEqual(sorted(saida), ['chave', 'destino'])
            self.assertIn('Roda%20Mais%20Distribuidora', saida['destino'])


class Medicao(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.publico = carregar('prumo-publico.py')

    def test_fonte_a_cada_30_s_e_sem_guardar_pergunta_nem_com_erro(self):
        wf = self.publico.fonte('c', 'l')
        gatilho = next(n for n in wf['nodes'] if n['name'] == 'A cada ciclo')
        self.assertEqual(gatilho['parameters']['rule']['interval'], [{'field': 'seconds', 'secondsInterval': 30}])
        self.assertEqual(wf['settings']['saveDataErrorExecution'], 'none')
        self.assertEqual(wf['settings']['saveDataSuccessExecution'], 'none')

    def test_medicao_so_autoriza_origens_quando_mudam_mas_sempre_le_as_contagens(self):
        wf = self.publico.metricas('c')
        self.assertEqual(wf['settings']['saveDataErrorExecution'], 'all')
        con = wf['connections']
        self.assertEqual([[d['node'] for d in s] for s in con['Origens mudaram?']['main']],
                         [['Autorizar páginas publicadas'], ['Ler contagens duráveis']])
        self.assertEqual(con['Lembrar origens enviadas']['main'][0][0]['node'], 'Ler contagens duráveis')
        nomes = {n['name'] for n in wf['nodes']}
        for destino in (d['node'] for saidas in con.values() for s in saidas['main'] for d in s):
            self.assertIn(destino, nomes)
        autorizar = next(n for n in wf['nodes'] if n['name'] == 'Autorizar páginas publicadas')
        self.assertIn('origens:$json.origens', autorizar['parameters']['jsonBody'])


class ProxyDoSheets(unittest.TestCase):
    def setUp(self):
        ENVIOS.clear()
        EXISTENTES[:] = []
        spec = importlib.util.spec_from_file_location('sheets_proxy_real', BASE / 'sheets_proxy.py')
        self.sp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.sp)

    def entrar(self):
        proxy = self.sp.SheetsProxy(['planilha-x'])
        with patch.object(self.sp.time, 'sleep'):
            proxy.__enter__()
        wf = next(c for m, p, c in ENVIOS if m == 'POST' and p == '/workflows')
        return proxy, wf

    def test_path_imprevisivel_e_segredo_exigido_no_webhook(self):
        a, wf_a = self.entrar()
        b, _ = self.entrar()
        self.assertNotEqual(a.caminho, b.caminho)
        self.assertGreaterEqual(len(a.caminho), 30)
        self.assertEqual(wf_a['nodes'][0]['parameters']['path'], a.caminho)
        validar = next(n for n in wf_a['nodes'] if n['name'] == 'Validar')['parameters']['jsCode']
        self.assertIn(json.dumps(a.segredo), validar)
        self.assertIn('x-proxy-segredo', validar)
        self.assertNotIn(b.segredo, validar)

    def test_apaga_proxy_esquecido_mas_nao_o_recente(self):
        from datetime import datetime, timedelta, timezone
        agora = datetime.now(timezone.utc)
        EXISTENTES[:] = [
            {'id': 'velho', 'name': 'ZZ proxy Sheets (apagar)', 'createdAt': (agora - timedelta(hours=3)).isoformat().replace('+00:00', 'Z')},
            {'id': 'recente', 'name': 'ZZ proxy Sheets (apagar)', 'createdAt': (agora - timedelta(minutes=2)).isoformat().replace('+00:00', 'Z')},
            {'id': 'outro', 'name': 'ZZ ensaio prumo-mapa (apagar)', 'createdAt': '2020-01-01T00:00:00.000Z'},
        ]
        self.entrar()
        apagados = [p for m, p, _ in ENVIOS if m == 'DELETE']
        self.assertEqual(apagados, ['/workflows/velho'])

    def test_ativar_que_falha_nao_deixa_proxy_para_tras(self):
        def api_que_falha(metodo, caminho, corpo=None):
            ENVIOS.append((metodo, caminho, corpo))
            if metodo == 'GET':
                return {'data': []}
            if metodo == 'POST' and caminho == '/workflows':
                return {'id': 'p1'}
            if caminho.endswith('/activate'):
                raise SystemExit('activate -> 500')
            return {}
        with patch.object(self.sp, 'api', api_que_falha), patch.object(self.sp.time, 'sleep'):
            with self.assertRaises(SystemExit):
                self.sp.SheetsProxy(['x']).__enter__()
        self.assertIn(('DELETE', '/workflows/p1', None), ENVIOS)


if __name__ == '__main__':
    unittest.main()
