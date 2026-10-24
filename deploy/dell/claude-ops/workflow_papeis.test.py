import copy
import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('papeis',Path(__file__).with_name('workflow_papeis.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Papeis(unittest.TestCase):
    def fixture(self):
        return {'name':m.NOME,'id':'IiuekGDVnjFaZpD1','active':True,'nodes':[{'name':n,'parameters':{'fixture':True}} for n in [*m.SOMBRA,'Primário','Persistir','Avisar']], 'connections':{'Primário':{'main':[[{'node':'Persistir'},{'node':m.SOMBRA[0]}]]},m.SOMBRA[0]:{'main':[[{'node':m.SOMBRA[1]}]]}},'settings':{'errorWorkflow':'fixture'}}
    def test_pausa_so_ramo_sem_apagar_dados_e_idempotente(self):
        w=self.fixture();original=copy.deepcopy(w);r=m.pausar_sombra(w)
        self.assertEqual(w,original);self.assertEqual(r['connections']['Primário']['main'],[[{'node':'Persistir'}]])
        self.assertEqual(r['settings'],w['settings']);self.assertTrue(r['active'])
        self.assertTrue(all(n['disabled'] for n in r['nodes'] if n['name'] in m.SOMBRA))
        self.assertEqual(m.pausar_sombra(r),r)
        self.assertEqual(r['connections'][m.SOMBRA[0]],w['connections'][m.SOMBRA[0]])
    def test_fluxo_alheio_ou_ramo_parcial(self):
        w=self.fixture();w['name']='Outro';self.assertEqual(m.pausar_sombra(w),w)
        w=self.fixture();w['nodes']=w['nodes'][1:]
        with self.assertRaises(ValueError):m.pausar_sombra(w)

    def test_optin_estrito_sem_config_nao_muda_fluxo(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);cfg=base/'.config/claude-ops';cfg.mkdir(parents=True)
            (cfg/'n8n-api-key').write_text('fixture-sem-acesso')
            with patch.object(Path,'home',return_value=base):
                spec=importlib.util.spec_from_file_location('n8n_fixture',Path(__file__).with_name('n8n.py'))
                cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)
                body={'name':'Outro','nodes':[]}
                self.assertEqual(cli.preparar_simplificacao_se_configurado(body),body)
                f=cfg/'workflow-contexto-whatsapp.json'
                for c in [{'v':True,'contextoFresco':True,'pausarJev':True},{'v':1,'contextoFresco':'sim','pausarJev':True},{'v':1,'contextoFresco':True,'pausarJev':True,'extra':True}]:
                    f.write_text(json.dumps(c))
                    with self.assertRaises(ValueError):cli.preparar_simplificacao_se_configurado(body)
                f.write_text(json.dumps({'v':1,'contextoFresco':False,'pausarJev':False}))
                self.assertEqual(cli.preparar_simplificacao_se_configurado(body),body)

if __name__=='__main__':unittest.main()
