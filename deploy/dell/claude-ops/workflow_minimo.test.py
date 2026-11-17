import copy
import json
import unittest
from workflow_minimo import renomear, validar, conferir_mutacao, MARCA, CRM

class Minimo(unittest.TestCase):
    def test_colisoes_e_referencias_explicitas_sao_migradas_sem_alterar_escopo_do_subworkflow(self):
        filho={'name':'filho','nodes':[{'id':'f','name':'Origem','type':'n8n-nodes-base.code','parameters':{'jsCode':"return $('Origem').all();"}}],'connections':{}}
        wf={'name':'pai','nodes':[
            {'id':'a','name':'Origem','type':'n8n-nodes-base.webhook','parameters':{'path':'original'}},
            {'id':'b','name':'Destino','type':'n8n-nodes-base.executeWorkflow','parameters':{'workflowJson':json.dumps(filho),'workflowInputs':{'value':"={{ $('Origem').first().json }}"}}}],
            'connections':{'Origem':{'main':[[{'node':'Destino','type':'main','index':0}]]}}}
        before=copy.deepcopy(wf);out=renomear(wf,'Conversa · ')
        self.assertEqual(wf,before)
        self.assertEqual(out['nodes'][0]['parameters']['path'],'original')
        self.assertIn("$('Conversa · Origem')",out['nodes'][1]['parameters']['workflowInputs']['value'])
        self.assertEqual(json.loads(out['nodes'][1]['parameters']['workflowJson']),filho)
        self.assertTrue(validar(out))

    def test_emissor_inferencia_e_destino_ausente_sao_rejeitados(self):
        for tipo,url in [('n8n-nodes-base.httpRequest','http://host/message/sendText/prumo'),
                         ('n8n-nodes-base.httpRequest','http://host/inferir'),
                         ('@n8n/n8n-nodes-langchain.googleGemini','')]:
            with self.assertRaises(ValueError):validar({'nodes':[{'id':'x','name':'x','type':tipo,'parameters':{'url':url}}],'connections':{}})
        with self.assertRaises(ValueError):validar({'nodes':[],'connections':{'ausente':{'main':[]}}})

    def test_publicador_antigo_nao_recria_nucleo_ou_edita_aposentado(self):
        c={'versao':1,'estado':'preparado-pausado','retirados':['antigo'],'nomesReservados':['Nome antigo']}
        for method,path,body in [('PUT','/workflows/antigo',{}),('PUT','/workflows/'+CRM,{'nodes':[]}),('POST','/workflows',{'name':'Nome antigo','nodes':[]})]:
            with self.assertRaises(ValueError):conferir_mutacao(method,path,body,c)
        conferir_mutacao('PUT','/workflows/'+CRM,{'nodes':[{'id':MARCA,'name':'Contrato','type':'n8n-nodes-base.code','parameters':{}}],'connections':{}},c)

if __name__=='__main__':unittest.main()
