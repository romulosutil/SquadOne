import importlib.util
import json
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('cz',Path(__file__).with_name('custo_zero_n8n.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class EscopoCustoZero(unittest.TestCase):
 def test_atendimento_classificacao_e_fonte_fora_do_escopo(self):
  for nome in ['Silmer | Atendimento WhatsApp IA (Evolution Baileys)','WhatsApp — resposta de lead (classifica)','PRUMO · Fonte com IA (Luna do Hermes)']:
   w={'name':nome,'nodes':[{'name':'Modelo','type':'@n8n/n8n-nodes-langchain.lmChatOpenAi','credentials':{'ref':'fake'}},{'name':'Áudio','type':'n8n-nodes-base.httpRequest','parameters':{'url':'https://api.openai.com/v1/audio/transcriptions'}},{'name':'Fonte','type':'n8n-nodes-base.httpRequest','parameters':{'url':'http://luna-workflows:8766/fonte'}}],'connections':{}}
   self.assertEqual(m.preparar(w),w)
 def test_pesquisa_bloqueia_api_comercial_e_modelos(self):
  for nome in m.FLUXOS_PESQUISA:
   for url in ['https://places.googleapis.com/v1/places/x','https://api.apify.com/v2/acts/a','https://api.exemplo.com/pago']:
    w={'name':nome,'nodes':[{'name':'Pesquisa','type':'n8n-nodes-base.httpRequest','parameters':{'url':url},'credentials':{'ref':'fake'}}]};r=m.preparar(w);self.assertEqual(r['nodes'][0]['type'],'n8n-nodes-base.code');self.assertNotIn('credentials',r['nodes'][0]);self.assertEqual(m.preparar(r),r)
 def test_subfluxo_de_pesquisa_tambem_bloqueia(self):
  sub={'nodes':[{'name':'Modelo','type':'@n8n/n8n-nodes-langchain.googleGemini','parameters':{}}]};w={'name':'01 · Caçador','nodes':[{'name':'Filho','type':'n8n-nodes-base.executeWorkflow','parameters':{'workflowJson':json.dumps(sub)}}]};r=m.preparar(w);self.assertEqual(json.loads(r['nodes'][0]['parameters']['workflowJson'])['nodes'][0]['type'],'n8n-nodes-base.code')
 def test_pesquisa_local_e_fontes_gratuitas_preservadas(self):
  for url in ['https://brasilapi.com.br/api/cnpj/v1/123','https://minhareceita.org/123','https://servicodados.ibge.gov.br/api/v1/localidades/municipios/1','http://luna-workflows:8766/pesquisa-leads']:
   w={'name':'PRUMO · Pesquisa e higiene de leads','nodes':[{'name':'Leitura','type':'n8n-nodes-base.httpRequest','parameters':{'url':url}}]};self.assertEqual(m.preparar(w),w)
if __name__=='__main__':unittest.main()
