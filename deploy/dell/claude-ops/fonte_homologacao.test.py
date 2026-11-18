"""Regressao da homologacao: sem API, segredos, mensagens ou inferencia real."""
import ast
import importlib.util
from pathlib import Path
import tempfile
import unittest

PASTA = Path(__file__).parent

def modulo(nome, arquivo):
    spec = importlib.util.spec_from_file_location(nome, PASTA/arquivo)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

publico = modulo('prumo_publico','prumo-publico.py')
cliente = modulo('prumo_fonte_cliente','prumo-fonte-cliente.py')

class Homologacao(unittest.TestCase):
    def test_instalador_atualiza_so_medicao_e_preserva_alerta(self):
        import sys
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        medicao = {'id': 'medicao', 'name': 'PRUMO · Medição de eventos',
                   'settings': {'errorWorkflow': 'falhas'}}
        fonte = {'id': 'fonte', 'name': publico.fonte('x', 'y')['name'], 'active': False}
        falha = {'id': 'fonte-falha', 'name': publico.falha_fonte()['name'], 'isArchived': True}
        api = Mock(side_effect=[{'data': [fonte, falha, medicao]}, medicao, {'active': True}])
        put = Mock(return_value=medicao)
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            pasta = home / '.config/claude-ops'
            pasta.mkdir(parents=True)
            (pasta / 'prumo-publico-cred').write_text('fixture')
            with patch.object(publico.Path, 'home', return_value=home), patch.dict(sys.modules, {'n8n': SimpleNamespace(api=api, put=put)}):
                publico.instalar()
        put.assert_called_once()
        workflow = put.call_args.args[0]
        self.assertEqual(workflow['id'], 'medicao')
        self.assertEqual(workflow['settings']['errorWorkflow'], 'falhas')
        self.assertEqual([call.args for call in api.call_args_list], [
            ('GET', '/workflows?limit=250'),
            ('GET', '/workflows/medicao'),
            ('POST', '/workflows/medicao/activate'),
        ])

    def test_privacidade_aplica_tambem_a_execucao_com_erro(self):
        arvore = ast.parse((PASTA/'n8n.py').read_text())
        fn = next(n for n in arvore.body if isinstance(n,ast.FunctionDef) and n.name=='garantir_erro_salvo')
        ns={}; exec(compile(ast.Module(body=[fn],type_ignores=[]),'n8n.py','exec'),ns)
        for nome in [publico.fonte('x','y')['name'], publico.falha_fonte()['name']]:
            w={'name':nome,'settings':{'saveDataErrorExecution':'all','saveManualExecutions':True}}
            novo=ns['garantir_erro_salvo'](w)
            self.assertEqual(novo['settings']['saveDataErrorExecution'],'none')
            self.assertFalse(novo['settings']['saveManualExecutions'])
            self.assertEqual(w['settings']['saveDataErrorExecution'],'all')
        self.assertEqual(ns['garantir_erro_salvo']({'name':'Outro'})['settings']['saveDataErrorExecution'],'all')

    def test_workflow_correlaciona_item_e_aponta_alerta_sem_payload(self):
        w=publico.fonte('cred-publico','cred-luna','falha-123')
        self.assertEqual(w['settings']['errorWorkflow'],'falha-123')
        nos={n['name']:n for n in w['nodes']}
        self.assertIn(".item.json.id",nos['Confirmar resposta salva']['parameters']['jsonBody'])
        self.assertIn('pairedItem',nos['Separar pergunta']['parameters']['jsCode'])
        falha=publico.falha_fonte()
        self.assertEqual(falha['settings']['saveDataErrorExecution'],'none')
        self.assertNotIn('execution.error',publico.FALHA_JS)
        self.assertNotIn('JSON.stringify($input',publico.FALHA_JS)

    def test_gravacao_atomica_privada_e_recuperacao_de_base(self):
        import json,stat
        with tempfile.TemporaryDirectory() as tmp:
            arquivo=Path(tmp)/'base.json'
            base=json.loads((PASTA.parent/'prumo-fonte/bases/vale-norte-demo.json').read_text())
            cliente.gravar_privado(arquivo,json.dumps(base))
            self.assertEqual(stat.S_IMODE(arquivo.stat().st_mode),0o600)
            self.assertEqual(cliente.validar_base(arquivo),base)
            copia=arquivo.read_bytes()
            arquivo.write_text('corrompida')
            with self.assertRaises(ValueError): cliente.validar_base(arquivo)
            cliente.gravar_privado(arquivo,copia.decode())
            self.assertEqual(cliente.validar_base(arquivo),base)
            self.assertEqual([p.name for p in Path(tmp).iterdir()],['base.json'])

    def test_cli_revoga_sem_expor_codigo_ou_imprimir_segredo(self):
        from unittest.mock import patch
        import hashlib,io,contextlib
        with tempfile.TemporaryDirectory() as tmp:
            arquivo=Path(tmp)/'codigo.txt'; arquivo.write_text('segredo-ficticio')
            with patch.object(cliente,'operacao',return_value={'revogado':True}) as operacao, patch('sys.argv',['cliente','--revogar',str(arquivo)]), contextlib.redirect_stdout(io.StringIO()) as saida:
                cliente.main()
            operacao.assert_called_once_with('/operacao/acessos/revogar',{'hash':hashlib.sha256(b'segredo-ficticio').hexdigest()})
            self.assertNotIn('segredo-ficticio',saida.getvalue())

if __name__=='__main__': unittest.main()
