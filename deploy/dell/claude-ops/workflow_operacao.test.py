"""Pausa por política: funções puras e cliente HTTP dublado; nenhuma API real."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

BASE = Path(__file__).resolve().parent


def carregar(nome, arquivo):
    spec = importlib.util.spec_from_file_location(nome, BASE / arquivo)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


m = carregar('workflow_operacao_fixture', 'workflow_operacao.py')
ID = 'workflow05-fixture'
NOME = '05 · Acompanhamento (Site antes da venda)'
MOTIVO = 'Piloto assistido: cadência decidida pela Central; preservar histórico.'
CONFIG = {'v': 1, 'pausados': [{'id': ID, 'nome': NOME, 'motivo': MOTIVO}]}


class PoliticaPura(unittest.TestCase):
    def test_06_acrescentado_preserva_05_grafo_historico_e_demais_workflows(self):
        id06='workflow06-fixture'; nome06='06 · Funil semanal (Site antes da venda)'
        cfg=copy.deepcopy(CONFIG)
        cfg['pausados'].append({'id':id06,'nome':nome06,'motivo':'Piloto: seleção e espera pertencem à Central; conservar Buscas e retrato.'})
        antes=copy.deepcopy(cfg);self.assertEqual(m.validar_config(cfg),cfg)
        for id_ in [ID,id06]:
            self.assertTrue(m.conferir_pedido('POST','/workflows/'+id_+'/activate',config=cfg)['desligado'])
            with self.assertRaises(ValueError):m.conferir_pedido('DELETE','/workflows/'+id_,config=cfg)
        body={'name':nome06,'nodes':[{'name':'Funil','parameters':{'jsCode':'legado preservado'}}],
              'connections':{'Funil':{'main':[[]]}},'settings':{'timezone':'America/Sao_Paulo'}}
        before_body=copy.deepcopy(body)
        self.assertIsNone(m.conferir_pedido('PUT','/workflows/'+id06,body,config=cfg))
        self.assertEqual(body,before_body);self.assertEqual(cfg,antes)
        for name in [nome06,'ZZ rodar agora: '+nome06+' (apagar)']:
            with self.assertRaises(ValueError):m.conferir_pedido('POST','/workflows',{'name':name},config=cfg)
        self.assertIsNone(m.conferir_pedido('POST','/workflows/'+id06+'/deactivate',config=cfg))
        self.assertIsNone(m.conferir_pedido('POST','/workflows/outro/activate',config=cfg))

    def test_schema_estrito_tipos_campos_unicos_nomes_equivalentes_sem_mutar_config(self):
        antes = copy.deepcopy(CONFIG)
        self.assertEqual(m.validar_config(CONFIG), CONFIG)
        self.assertEqual(CONFIG, antes)
        invalidas = [None, [], {}, {'v': True, 'pausados': []}, {'v': 2, 'pausados': []},
            {'v': 1, 'pausados': {}}, {**CONFIG, 'extra': True},
            {'v': 1, 'pausados': [{**CONFIG['pausados'][0], 'extra': True}]},
            {'v': 1, 'pausados': [{**CONFIG['pausados'][0], 'motivo': ''}]},
            {'v': 1, 'pausados': [{**CONFIG['pausados'][0], 'nome': NOME+'\n'}]},
            {'v': 1, 'pausados': [{**CONFIG['pausados'][0], 'id': '../escape'}]},
            {'v': 1, 'pausados': CONFIG['pausados'] * 2},
            {'v': 1, 'pausados': [CONFIG['pausados'][0], {**CONFIG['pausados'][0], 'id': 'outro', 'nome': NOME.upper()}]}]
        for invalida in invalidas:
            with self.subTest(config=invalida):
                with self.assertRaises(ValueError):m.validar_config(invalida)
        self.assertEqual(m.validar_config({'v': 1, 'pausados': []}), {'v': 1, 'pausados': []})

    def test_activate_bloqueado_inclui_query_percentencoding_trailing_slash_e_lowercase(self):
        for metodo, path in [('POST', '/workflows/'+ID+'/activate'), ('post', '/workflows/'+ID+'/activate/'),
                             ('POST', '/workflows/'+ID+'/activate?versionId=fixture'), ('POST', '/workflows/%77orkflow05-fixture/activate')]:
            self.assertEqual(m.conferir_pedido(metodo, path, config=CONFIG),
                {'active': False, 'desligado': True, 'operacao': True, 'motivo': MOTIVO})

    def test_reserva_nome_id_impede_recriacao_renomear_outro_id_e_clone_executor_manual(self):
        for metodo, path, body in [
            ('POST', '/workflows', {'name': NOME}),
            ('POST', '/workflows', {'name': NOME.upper()}),
            ('POST', '/workflows', {'name': 'outro', 'id': ID}),
            ('POST', '/workflows', {'name': 'ZZ rodar agora: '+NOME+' (apagar)'}),
            ('PUT', '/workflows/outro', {'name': NOME}),
            ('PATCH', '/workflows/outro', {'name': NOME}),
            ('PUT', '/workflows/'+ID, {'name': 'outro'}),
            ('PUT', '/workflows/'+ID, {'name': NOME, 'id': 'outro'}),
            ('PUT', '/workflows/'+ID, {'name': NOME, 'active': True})]:
            with self.subTest(metodo=metodo,path=path,body=body):
                with self.assertRaises(ValueError):m.conferir_pedido(metodo,path,body,config=CONFIG)

    def test_put_correto_preserva_grafo_credenciais_settings_e_bloqueio(self):
        body = {'name': NOME, 'nodes': [{'name': 'Decidir', 'parameters': {'jsCode': 'fonte original'}, 'credentials': {'fixture': {'id': 'fixture'}}}],
                'connections': {'Decidir': {'main': [[]]}}, 'settings': {'executionOrder': 'v1'}}
        antes = copy.deepcopy(body)
        self.assertIsNone(m.conferir_pedido('PUT', '/workflows/'+ID, body, config=CONFIG))
        self.assertEqual(body, antes)
        self.assertTrue(m.conferir_pedido('POST', '/workflows/'+ID+'/activate', config=CONFIG)['desligado'])

    def test_delete_pausado_recusado_sem_bloquear_read_deactivate_ou_outros(self):
        with self.assertRaisesRegex(ValueError, 'histórico'):
            m.conferir_pedido('DELETE', '/workflows/'+ID, config=CONFIG)
        for metodo,path,body in [('GET','/workflows/'+ID,None), ('POST','/workflows/'+ID+'/deactivate',None),
                                ('POST','/workflows/outro/activate',None),('DELETE','/workflows/outro',None),
                                ('POST','/workflows',{'name':'Outro fluxo'})]:
            self.assertIsNone(m.conferir_pedido(metodo,path,body,config=CONFIG))

    def test_ausencia_config_e_lista_vazia_mantem_legado(self):
        for cfg in [None, {'v': 1, 'pausados': []}]:
            self.assertIsNone(m.conferir_pedido('POST','/workflows/'+ID+'/activate',config=cfg))


class RespostaHTTP:
    def __init__(self, body):self.body = body
    def __enter__(self):return self
    def __exit__(self, *_):return None
    def read(self):return json.dumps(self.body).encode()


class ClienteN8n(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='workflow-operacao-')
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.cfg = self.home/'.config/claude-ops';self.cfg.mkdir(parents=True)
        (self.cfg/'n8n-api-key').write_text('credencial-fixture-sem-rede')
        self.home_patch = patch.object(Path, 'home', return_value=self.home)
        self.home_patch.start();self.addCleanup(self.home_patch.stop)
        self.preparar = Mock(side_effect=lambda b:copy.deepcopy(b))
        self.modulos = patch.dict(sys.modules, {'workflow_operacao': m,
            'workflow_confiabilidade': types.SimpleNamespace(preparar=self.preparar),
            'prumo_contexto': types.SimpleNamespace(do_escopo=lambda _:False, preparar=lambda b,c:b, carregar=lambda:None)})
        self.modulos.start();self.addCleanup(self.modulos.stop)
        self.cli = carregar('n8n_operacao_fixture','n8n.py')
        self.pedidos = []
        def abrir(req, **kwargs):
            self.pedidos.append((req.method, req.full_url, json.loads(req.data) if req.data else None))
            return RespostaHTTP({'active': True, 'id': 'resposta-fixture'})
        self.rede = patch.object(self.cli.urllib.request, 'urlopen', side_effect=abrir)
        self.rede.start();self.addCleanup(self.rede.stop)
        self.stdout = io.StringIO()
        self.output = contextlib.redirect_stdout(self.stdout)
        self.output.__enter__();self.addCleanup(lambda:self.output.__exit__(None,None,None))

    def configurar(self, config=CONFIG):
        (self.cfg/'workflow-operacao.json').write_text(json.dumps(config),encoding='utf-8')

    def test_06_bloqueado_no_cliente_antes_da_rede_e_pausa_nao_reescreve_outros(self):
        id06='workflow06-fixture';nome06='06 · Funil semanal (Site antes da venda)'
        cfg=copy.deepcopy(CONFIG);cfg['pausados'].append({'id':id06,'nome':nome06,'motivo':'Preservar ciclo e dono na Central.'})
        self.configurar(cfg)
        for id_ in [ID,id06]:
            self.assertTrue(self.cli.api('post','/workflows/'+id_+'/activate')['desligado'])
        with self.assertRaises(ValueError):self.cli.api('DELETE','/workflows/'+id06)
        with self.assertRaises(ValueError):self.cli.api('POST','/workflows',{'name':nome06,'nodes':[]})
        self.assertFalse(self.pedidos);self.preparar.assert_not_called()
        # Desativação é explícita: configurar a guarda não executa API ou altera grafo/dados.
        self.cli.api('POST','/workflows/'+id06+'/deactivate')
        self.assertEqual(len(self.pedidos),1)
        self.assertEqual(self.pedidos[0][0],'POST')
        self.assertTrue(self.pedidos[0][1].endswith('/'+id06+'/deactivate'))

    def test_ausente_e_removido_apos_optin_preservam_comportamento_sem_autoativar(self):
        self.assertTrue(self.cli.api('post','/workflows/'+ID+'/activate')['active'])
        self.assertEqual(self.pedidos[0][0], 'POST')
        self.configurar()
        self.assertTrue(self.cli.api('POST','/workflows/'+ID+'/activate')['desligado'])
        self.assertEqual(len(self.pedidos),1)
        (self.cfg/'workflow-operacao.json').unlink()
        self.assertTrue(self.cli.api('POST','/workflows/'+ID+'/activate')['active'])
        self.assertEqual(len(self.pedidos),2)
        self.assertFalse(any(p[1].endswith('deactivate') for p in self.pedidos))

    def test_config_invalida_nao_toca_hook_ou_rede_e_get_funciona_para_diagnostico(self):
        for config in [None, {'v':True,'pausados':[]}, {'v':1,'pausados':[{'id':ID,'nome':NOME}]}]:
            self.configurar(config)
            for metodo,path,body in [('POST','/workflows/'+ID+'/activate',None),
                ('PUT','/workflows/'+ID,{'name':NOME,'nodes':[]}),('DELETE','/workflows/outro',None)]:
                with self.assertRaises(ValueError):self.cli.api(metodo,path,body)
        (self.cfg/'workflow-operacao.json').write_text('{ilegiveis')
        with self.assertRaises(ValueError):self.cli.api('POST','/workflows/'+ID+'/activate')
        self.preparar.assert_not_called();self.assertFalse(self.pedidos)
        self.cli.api('GET','/workflows/'+ID)
        self.assertEqual(len(self.pedidos),1)

    def test_bloqueio_antes_hook_para_create_put_errado_activate_e_delete(self):
        self.configurar()
        self.assertFalse(self.cli.api('post','/workflows/'+ID+'/activate')['active'])
        for method,path,body in [('POST','/workflows',{'name':NOME,'nodes':[]}),
                                ('PUT','/workflows/outro',{'name':NOME,'nodes':[]}),
                                ('DELETE','/workflows/'+ID,None)]:
            with self.assertRaises(ValueError):self.cli.api(method,path,body)
        self.preparar.assert_not_called();self.assertFalse(self.pedidos)

    def test_put_correto_passa_hooks_sem_mudar_grafo_e_sem_ativacao(self):
        self.configurar()
        body={'name':NOME,'nodes':[{'name':'Decidir','parameters':{'fixture':True}}],
              'connections':{'Decidir':{'main':[[]]}},'settings':{'executionOrder':'v1'}}
        antes=copy.deepcopy(body)
        self.cli.api('put','/workflows/'+ID,body)
        self.preparar.assert_called_once();self.assertEqual(body,antes)
        method,_,enviado=self.pedidos[0]
        self.assertEqual(method,'PUT');self.assertEqual(enviado['nodes'],body['nodes']);self.assertEqual(enviado['connections'],body['connections'])
        self.assertEqual(len(self.pedidos),1)
        self.assertTrue(self.cli.api('POST','/workflows/'+ID+'/activate')['desligado'])
        self.assertEqual(len(self.pedidos),1)

    def test_outro_workflow_inalterado_desativacao_explicita_permitida_e_pausa_legada_mantida(self):
        self.configurar()
        self.cli.api('POST','/workflows/outro/activate')
        self.cli.api('POST','/workflows/'+ID+'/deactivate')
        self.assertEqual(len(self.pedidos),2)
        legado=next(iter(self.cli.DESLIGADOS))
        self.assertTrue(self.cli.api('POST','/workflows/'+legado+'/activate')['desligado'])
        self.assertEqual(len(self.pedidos),2)

    def test_publicador_mostra_pausa_e_nao_afirma_ativo_sem_confirmacao(self):
        with patch.dict(sys.modules, {'n8n': self.cli}):
            sa=carregar('site_acompanhamento_operacao_fixture','site-acompanhamento.py')
        wf={'name':NOME,'nodes':[]}
        for resposta,rotulo in [({'active':False,'desligado':True},'pausado pela política operacional'),
                                ({'active':True},'ativo'),({},'ativação sem confirmação')]:
            output=io.StringIO()
            with patch.object(sa.sv,'criar_ou_trocar',return_value=ID),patch.object(sa,'api',return_value=resposta) as chamada,contextlib.redirect_stdout(output):
                self.assertEqual(sa.publicar(wf),ID)
            self.assertIn(rotulo,output.getvalue())
            if resposta.get('active') is not True:self.assertNotIn(', ativo)',output.getvalue())
            chamada.assert_called_once_with('POST','/workflows/'+ID+'/activate')


if __name__=='__main__':unittest.main()
