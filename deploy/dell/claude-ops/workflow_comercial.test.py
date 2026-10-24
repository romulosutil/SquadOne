"""Transformação pura e regras JS com fixtures; nenhuma API/credencial real."""
import copy
import importlib.util
import json
import shutil
import subprocess
import unittest
from unittest.mock import patch
from pathlib import Path

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('workflow_comercial', BASE / 'workflow_comercial.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
URL = 'https://central.invalid/api/operations/crm/atendimento/evento'
CRED = {'httpHeaderAuth': {'id': 'fixture', 'name': 'CRM Central fictício'}}


def node(nome, **params):
    return {'id': nome, 'name': nome, 'type': 'n8n-nodes-base.code', 'parameters': params, 'credentials': {'fixture': {'id': 'preservar'}}}


def crm():
    return {'id': m.CRM_ID, 'name': m.CRM_NOME, 'active': True, 'settings': {'saveDataSuccessExecution': 'none'},
        'nodes': [node('Validar registro', jsCode="const b=$('Registro da Central').first().json.body; const txt=(v,n)=>String(v??'').trim().slice(0,n);const recusa=erro=>[{json:{ok:false,erro}}];\nlet texto = txt(b.texto, 1000);\nreturn [{json:{ok:true,texto}}];"),
        {**node('Gravar na aba CRM', operation='append'), 'type': 'n8n-nodes-base.googleSheets', 'retryOnFail': True, 'maxTries': 2}, node('Responder ok'), node('Gravar retrato')],
        'connections': {'Responder ok': {'main': [[m._destino('Gravar retrato')]]}}}


def resposta():
    return {'id': m.RESPOSTA_ID, 'name': m.RESPOSTA_NOME, 'active': False, 'settings': {'errorWorkflow': 'preservar'}, 'staticData': {'fixture': 'preservar'},
        'nodes': [node('Resposta no WhatsApp'), node('Persistir antes de confirmar', options={'waitForSubWorkflow': True}, workflowJson='subfluxo-intacto'),
                  node('Responder ao observador', responseBody="={{ {ok:true,marcados:$('Decidir pela resposta').all()} }}"), node('Decidir pela resposta'), node('Jev: sombra')],
        'connections': {'Decidir pela resposta': {'main': [[m._destino('Persistir antes de confirmar'), m._destino('Jev: sombra')]]},
                        'Persistir antes de confirmar': {'main': [[m._destino('Responder ao observador')]]}}}


def js(codigo, rows=None, body=None):
    p = subprocess.run([shutil.which('node') or 'node', '-e', 'const rows='+json.dumps(rows or [])+';const body='+json.dumps(body or {})+";const $=()=>({first:()=>({json:{body}})});const $input={all:()=>rows,first:()=>rows[0]};try{const r=(()=>{"+codigo+"})();console.log(JSON.stringify(r))}catch(e){console.error(e.message);process.exit(2)}"], text=True, encoding='utf-8', capture_output=True, timeout=10)
    if p.returncode:
        raise ValueError(p.stderr)
    return json.loads(p.stdout)


class WorkflowComercial(unittest.TestCase):
    def test_hook_opt_in_so_consulta_dois_workflows_e_exige_endpoint_explicito(self):
        spec=importlib.util.spec_from_file_location('n8n_comercial_fixture',BASE/'n8n.py');cliente=importlib.util.module_from_spec(spec)
        with patch.object(Path,'read_text',return_value='chave-api-fixture'):
            spec.loader.exec_module(cliente)
        outro={'name':'01 · Caçador','active':False,'nodes':[],'connections':{}}
        with patch.object(Path,'exists',side_effect=AssertionError('Não consultar config de outro fluxo')):
            self.assertIs(cliente.preparar_comercial_se_configurado(outro),outro)
        wf=crm()
        with patch.object(Path,'exists',return_value=False):self.assertIs(cliente.preparar_comercial_se_configurado(wf),wf)
        with patch.object(Path,'exists',return_value=True),patch.object(Path,'read_text',return_value='{}'):
            self.assertIs(cliente.preparar_comercial_se_configurado(wf),wf)
        cfg=json.dumps({'endpoint':URL,'credencial_crm':CRED})
        with patch.object(Path,'exists',return_value=True),patch.object(Path,'read_text',return_value=cfg):
            self.assertFalse(m._no(cliente.preparar_comercial_se_configurado(wf),'Gravar na aba CRM')['retryOnFail'])
            self.assertEqual(m._no(cliente.preparar_comercial_se_configurado(resposta()),m.RECEBER)['parameters']['url'],URL)

    def test_08_so_guard_e_retry_sem_mutar_entrada_ou_grafo(self):
        original = crm(); antes = copy.deepcopy(original); out = m.preparar(original)
        self.assertEqual(original, antes); self.assertEqual(out['connections'], original['connections'])
        self.assertEqual(out['settings'], original['settings']); self.assertTrue(out['active'])
        self.assertFalse(m._no(out, 'Gravar na aba CRM')['retryOnFail'])
        self.assertEqual(m._no(out, 'Gravar na aba CRM')['credentials'], m._no(original, 'Gravar na aba CRM')['credentials'])
        codigo = m._no(out, 'Validar registro')['parameters']['jsCode']
        self.assertFalse(js(codigo, body={'tipo': 'nota', 'texto': 'x'*1001})[0]['json']['ok'])
        self.assertEqual(js(codigo, body={'tipo': 'nota', 'texto': 'é'*1000})[0]['json']['texto'], 'é'*1000)
        for t in [None, 1, []]:self.assertFalse(js(codigo, body={'tipo':'nota','texto':t})[0]['json']['ok'])
        self.assertEqual(m.preparar(out), out)

    def test_08_guard_existente_nao_duplicado_e_layout_desconhecido_bloqueia(self):
        wf = crm(); n=m._no(wf,'Validar registro'); n['parameters']['jsCode']="if (b.tipo === 'nota' && (typeof b.texto !== 'string' || b.texto.length > 1000)) return recusa('não cortar');\n"+n['parameters']['jsCode']
        self.assertEqual(m._no(m.preparar(wf),'Validar registro'),n)
        wf=crm(); m._no(wf,'Validar registro')['parameters']['jsCode']='outro código'
        with self.assertRaises(ValueError):m.preparar(wf)

    def test_classificador_preserva_estado_credenciais_sombra_subfluxo_e_corpo_ack(self):
        wf=resposta(); antes=copy.deepcopy(wf); out=m.preparar(wf,endpoint=URL,credencial_crm=CRED)
        self.assertEqual(wf,antes)
        for k in ['active','settings','staticData']:self.assertEqual(out[k],wf[k])
        for n in wf['nodes']:self.assertEqual(m._no(out,n['name']),n)
        self.assertEqual(out['connections']['Decidir pela resposta'],wf['connections']['Decidir pela resposta'])
        self.assertEqual(out['connections']['Persistir antes de confirmar']['main'][0][0]['node'],m.PREPARAR)
        self.assertEqual(out['connections'][m.TEM]['main'][1],[m._destino('Responder ao observador')])
        http=m._no(out,m.RECEBER);self.assertFalse(http['retryOnFail']);self.assertNotIn('onError',http)
        self.assertEqual(http['credentials'],CRED);self.assertEqual(http['parameters']['jsonBody'],'={{ $json }}')
        self.assertEqual(out['connections'][m.RECEBER]['main'][0],[m._destino(m.CONFERIR)])
        self.assertEqual(out['connections'][m.CONFERIR]['main'][0],[m._destino('Responder ao observador')])
        self.assertEqual(m.preparar(out,endpoint=URL,credencial_crm=CRED),out)

    def test_envelopes_antigos_vazios_bypass_sem_inventar_evento(self):
        self.assertEqual(js(m.PREPARAR_JS),[{'json':{'eventos':[]}}])
        self.assertEqual(js(m.SEPARAR_JS,rows=[{'json':{'eventos':[]}}]),[])
        fixture={'idOriginal':'real-ficticio','conteudoHash':'a'*64}
        prepared=js(m.PREPARAR_JS,body={'envelopesComerciais':[fixture]})
        self.assertEqual(js(m.SEPARAR_JS,rows=prepared),[{'json':fixture}])
        with self.assertRaises(ValueError):js(m.PREPARAR_JS,body={'envelopesComerciais':{}})

    def test_ack_espera_todos_202_persistidos_e_nao_aceita_apenas_http_ok(self):
        r={'json':{'statusCode':202,'body':{'ok':True,'persistido':True,'estado':'pendente'}}}
        repetido=copy.deepcopy(r);repetido['json']['body']['estado']='repetido'
        self.assertEqual(js(m.CONFERIR_JS,rows=[r,repetido]),[{'json':{'recebidos':2}}])
        for ruim in [{'statusCode':200,'body':r['json']['body']},{'statusCode':202,'body':{'ok':True}},{'statusCode':202,'body':{'ok':True,'persistido':False,'estado':'pendente'}}]:
            with self.assertRaises(ValueError):js(m.CONFERIR_JS,rows=[r,{'json':ruim}])
        with self.assertRaises(ValueError):js(m.CONFERIR_JS)

    def test_layout_parcial_sem_persistencia_ou_url_credencial_insegura_recusa(self):
        for url in [None,'http://u:segredo@host/api/operations/crm/atendimento/evento',URL+'?token=x','http://host/outro']:
            with self.assertRaises(ValueError):m.preparar(resposta(),endpoint=url,credencial_crm=CRED)
        with self.assertRaises(ValueError):m.preparar(resposta(),endpoint=URL)
        wf=resposta();m._no(wf,'Persistir antes de confirmar')['parameters']['options']['waitForSubWorkflow']=False
        with self.assertRaises(ValueError):m.preparar(wf,endpoint=URL,credencial_crm=CRED)
        wf=resposta();wf['nodes'].append(node(m.PREPARAR))
        with self.assertRaises(ValueError):m.preparar(wf,endpoint=URL,credencial_crm=CRED)
        wf={'name':'Caçador pausado','active':False,'nodes':[],'connections':{}}
        self.assertEqual(m.preparar(wf),wf)


if __name__ == '__main__':unittest.main()
