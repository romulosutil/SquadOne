"""Somente grafo/JS com fixtures. Nenhuma API n8n ou credencial real."""
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import unittest
AQUI=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('workflow_publicacao_crm',AQUI/'workflow_publicacao_crm.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def wf():
 return {'id':m.ID,'name':m.NOME,'active':True,'settings':{'timezone':'America/Sao_Paulo'},'nodes':[
 {'id':'montar','name':'Montar retrato','type':'n8n-nodes-base.code','parameters':{'jsCode':'ORIGINAL'}},
 {'id':'gravar','name':'Gravar retrato','type':'n8n-nodes-base.readWriteFile','typeVersion':1.1,'parameters':{'operation':'write','dataPropertyName':'data','fileName':'LEGADO'}},
 {'id':'append','name':'Gravar na aba CRM','credentials':{'preservar':{'id':'fixture'}},'parameters':{'operation':'append'}},
 {'id':'ack','name':'Responder ok','parameters':{'responseBody':'ACK-ORIGINAL'}}],
 'connections':{'Montar retrato':{'main':[[m._edge('Gravar retrato')]]},'Responder ok':{'main':[[m._edge('Montar retrato')]]}}}
def run(code,items=None,prepared=None,exec_id='123'):
 script='const $execution={id:'+json.dumps(exec_id)+'},$input={all:()=>'+json.dumps(items or [])+'},$=()=>({first:()=>({json:'+json.dumps(prepared or {})+'})});try{console.log(JSON.stringify((()=>{'+code+'})()))}catch(e){process.exit(2)}'
 p=subprocess.run([shutil.which('node') or 'node','-e',script],capture_output=True,text=True,encoding='utf-8',timeout=10)
 if p.returncode:raise ValueError('JS recusou')
 return json.loads(p.stdout)
class WorkflowPublicacaoTests(unittest.TestCase):
 def test_delta_preserva_append_ack_credenciais_ativacao_e_input(self):
  original=wf();antes=copy.deepcopy(original);out=m.preparar(original);self.assertEqual(original,antes)
  self.assertEqual(out['settings'],original['settings']);self.assertEqual(out['active'],True)
  for nome in ['Gravar na aba CRM','Responder ok','Montar retrato']:self.assertEqual(m._node(out,nome),m._node(original,nome))
  self.assertEqual(out['connections']['Responder ok'],original['connections']['Responder ok'])
  self.assertEqual(m._node(out,'Gravar retrato')['parameters']['fileName'],m.CANDIDATO_PATH)
 def test_idempotencia_verifica_grafo_e_nao_aceita_bypass(self):
  out=m.preparar(wf());self.assertEqual(m.preparar(out),out)
  for mudar in [lambda w:w['connections']['Montar retrato'].update(main=[[m._edge('Gravar retrato')]]),lambda w:m._node(w,m.RECIBO).update(disabled=True),lambda w:m._node(w,m.PRONTO)['parameters'].update(fileName='crm.json')]:
   alterado=copy.deepcopy(out);mudar(alterado)
   with self.assertRaises(ValueError):m.preparar(alterado)
 def test_outro_workflow_intacto_e_08_id_trocado_bloqueado(self):
  outro={'name':'Outro','nodes':[]};self.assertEqual(m.preparar(outro),outro)
  alterado=wf();alterado['id']='outro'
  with self.assertRaises(ValueError):m.preparar(alterado)
 def test_recibo_so_depois_write_sucesso_e_hash_exato(self):
  d={'versao':1,'geradoEm':'2026-10-24T15:00:00.000Z','conteudo':'çã 😀'}
  item={'json':{'arquivo':'crm.json'},'binary':{'data':{'data':base64.b64encode(json.dumps(d,ensure_ascii=False).encode()).decode()}}}
  p=run(m.PREPARAR_JS,[item])[0];b=base64.b64decode(p['binary']['data']['data'])
  self.assertEqual(p['json']['conteudoHash'],hashlib.sha256(b).hexdigest());self.assertEqual(json.loads(b)['dados'],d)
  recibo=run(m.RECIBO_JS,[{'json':{}}],p['json'])[0];r=json.loads(base64.b64decode(recibo['binary']['data']['data']))
  self.assertEqual(r,{'v':1,'execucaoId':'123','conteudoHash':hashlib.sha256(b).hexdigest()})
  for itens in [[],[{'json':{'error':'fixture'}}]]:
   with self.assertRaises(ValueError):run(m.RECIBO_JS,itens,p['json'])
 def test_sha256_sem_crypto_cobre_multiblocos_unicode(self):
  for t in ['', 'abc', 'çã 😀'*1000]:
   code=m.SHA256_JS+'return sha256(Buffer.from('+json.dumps(t)+',"utf8"));'
   self.assertEqual(run(code),hashlib.sha256(t.encode()).hexdigest())
 def test_sem_execucao_original_ou_payload_inesperado_nao_fabrica_id(self):
  item={'json':{'arquivo':'crm.json'},'binary':{'data':{'data':base64.b64encode(b'{}').decode()}}}
  for id_ in ['', 'test', '../123', '01', '1e3']:
   with self.assertRaises(ValueError):run(m.PREPARAR_JS,[item],exec_id=id_)
 def test_falha_de_fonte_tambem_vira_candidato_sem_status_fake_sucesso(self):
  d={'falhouEm':'2026-10-24T15:00:00.000Z','erro':'Falha fixture'}
  item={'json':{'arquivo':'crm-falha.json'},'binary':{'data':{'data':base64.b64encode(json.dumps(d).encode()).decode()}}}
  p=run(m.PREPARAR_JS,[item])[0];e=json.loads(base64.b64decode(p['binary']['data']['data']))
  self.assertEqual(e['arquivo'],'crm-falha.json');self.assertEqual(e['dados'],d)
 def test_no_original_tolerante_ou_cadeia_alterada_bloqueiam(self):
  for alterar in [lambda w:m._node(w,'Gravar retrato').update(onError='continueRegularOutput'),lambda w:w['connections'].update({'Gravar retrato':{'main':[[m._edge('Responder ok')]]}})]:
   w=wf();alterar(w)
   with self.assertRaises(ValueError):m.preparar(w)
 def test_bypass_de_entrada_e_tipo_trocado_nao_sao_aceitos(self):
  for alterar in [lambda w:w['connections'].update({'Atalho':{'main':[[m._edge('Gravar retrato')]]}}),lambda w:m._node(w,m.PRONTO).update(type='n8n-nodes-base.httpRequest')]:
   w=m.preparar(wf());alterar(w)
   with self.assertRaises(ValueError):m.preparar(w)
  w=wf();w['connections']['Atalho']={'main':[[m._edge('Gravar retrato')]]}
  with self.assertRaises(ValueError):m.preparar(w)
if __name__=='__main__':unittest.main()
