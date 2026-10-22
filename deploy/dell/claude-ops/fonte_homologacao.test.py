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

if __name__=='__main__': unittest.main()
