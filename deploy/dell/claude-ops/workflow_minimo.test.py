import copy
import json
import unittest
import subprocess
import urllib.parse
from workflow_minimo import renomear, validar, conferir_mutacao, codigo_abertura, CENTRAL, MARCA, CRM
from pesquisa_google import ISOLAR, LER, TRIAR, TRIAGEM, anexar_google
from pesquisa_whatsapp_n8n import MONTAR, workflow as pesquisa_diaria

class Minimo(unittest.TestCase):
    def test_pesquisa_google_preserva_gatilho_ativo_e_le_formato_xml_real(self):
        revisao = {'id': 'webhook', 'name': 'Revisão', 'type': 'n8n-nodes-base.webhook',
                   'credentials': {'httpHeaderAuth': {'id': 'fixture'}}}
        fluxo = {'nodes': [revisao], 'connections': {}}
        anexar_google(fluxo)
        anexado = copy.deepcopy(fluxo)
        anexar_google(fluxo)
        self.assertEqual(fluxo, anexado)
        self.assertNotIn('Revisão', fluxo['connections'])
        self.assertTrue(validar(fluxo))
        xml = next(n for n in fluxo['nodes'] if n['name'] == LER)
        self.assertTrue(xml['alwaysOutputData'])
        self.assertEqual(xml['onError'], 'continueRegularOutput')
        self.assertEqual([out[0]['node'] for out in fluxo['connections'][ISOLAR]['main']], [TRIAR, LER])
        self.assertEqual(fluxo['connections'][LER]['main'][0][0]['node'], ISOLAR)

        script = """const vm = require('node:vm');
const desde = new Date(Date.now() - 86400000).toISOString();
const plano = {nicho:'escritorios', tipo:'mudanca-comercial', consulta:'primeira', busca:'fixture', desde, dias:7};
const planos = [plano, {...plano, nicho:'agencias', consulta:'falha'}, {...plano, consulta:'terceira'}];
const noticia = {
  title:'Alfa Consultores inaugura nova sede - Jornal Local',
  pubDate:desde, link:'https://news.google.com/rss/articles/fixture',
  source:{_:'Jornal Local',url:'https://example.org'},
};
const segundaNoticia = {...noticia, title:'Alfa abre novo escritorio',
  link:'https://news.google.com/rss/articles/segunda', source:undefined};
const respostas = [
  {json:{rss:{channel:{item:[noticia, null]}}}}, {json:{}},
  {json:{rss:{channel:{item:segundaNoticia}}}}
];
const executar = input => vm.runInNewContext('(function(){' + CODE + '})()',
  {$:()=>({all:()=>planos.map(json=>({json}))}),$input:{all:()=>input}})[0].json;
console.log(JSON.stringify([executar(respostas), executar([respostas[0], respostas[2]])]));"""
        resultado, desalinhado = json.loads(subprocess.check_output(
            ['node', '-e', script.replace('CODE', json.dumps(TRIAGEM))], text=True, encoding='utf-8'))
        self.assertEqual(resultado['estado'], 'parcial')
        self.assertEqual([(x['consulta'], x['estado']) for x in resultado['consultas']],
                         [('primeira', 'ok'), ('falha', 'falhou'), ('terceira', 'ok')])
        self.assertEqual(resultado['sinaisEncontrados'], 2)
        por_link = {x['urlGoogleNoticias'].rsplit('/', 1)[1]: x for x in resultado['sinais']}
        self.assertEqual(por_link['fixture']['urlVeiculo'], 'https://example.org')
        self.assertEqual(por_link['segunda']['urlVeiculo'], '')
        self.assertTrue(por_link['fixture']['nichoAMapear'])
        self.assertEqual(por_link['fixture']['intencaoCompra'], 'a-confirmar')
        self.assertEqual(resultado['oportunidadesConfirmadas'], 0)
        self.assertEqual(desalinhado['estado'], 'indisponivel')
        self.assertEqual(desalinhado['sinais'], [])

    def test_pesquisa_diaria_inicia_sem_historico_e_propaga_outros_erros_de_leitura(self):
        fluxo = pesquisa_diaria({}, 'falhas')
        historico = next(n for n in fluxo['nodes'] if n['id'] == 'historico')
        self.assertEqual(historico['onError'], 'continueRegularOutput')
        self.assertTrue(validar(fluxo))
        script = """
const vm = require('node:vm');
const pesquisa = {fonte:'Google Notícias RSS', estado:'parcial', politicaCusto:'zero',
  janelaDias:14, mensagensEnviadas:0, registrosComerciaisAlterados:0,
  sinais:[], consultas:[], buscasComplementares:[]};
const executar = erro => {
  const sandbox = {
    $: nome => nome === 'Ler relatórios recentes'
      ? {all: () => [{json:{error:erro}}]} : {first: () => ({json:pesquisa})},
    $input: {all: () => [{json:{}}]},
    $now: {setZone: () => ({toISODate: () => '2026-11-18'}), toISO: () => '2026-11-18T12:00:00Z'},
    $execution: {id:1}, Buffer
  };
  return vm.runInNewContext('(function(){' + CODE + '})()', sandbox)[0].json;
};
const relatorio = executar('No file(s) found');
let erro;
try { executar('Access to the file is not allowed'); }
catch (e) { erro = e.message; }
console.log(JSON.stringify({relatorio, erro}));"""
        resultado = json.loads(subprocess.check_output(
            ['node', '-e', script.replace('CODE', json.dumps(MONTAR))], text=True, encoding='utf-8'))
        self.assertEqual(resultado['relatorio']['estadoDaFonte'], 'parcial')
        self.assertEqual(resultado['relatorio']['mensagensEnviadas'], 0)
        self.assertEqual(resultado['relatorio']['registrosComerciaisAlterados'], 0)
        self.assertIn('ler o histórico', resultado['erro'])

    def test_abertura_no_sandbox_sem_url_preserva_destino_texto_e_historico(self):
        mensagem={'desde':'2026-11-16T20:00:00Z','texto':'Oi! Uma pergunta?\n\nOrçamento e atendimento.'}
        code=codigo_abertura(mensagem)
        row={'place_id':'fixture','wa_me':'https://wa.me/5511998887766?text=Anterior',
             'status':'pronto','criado_em':'2026-11-17T10:00:00Z'}
        def executar(l, pid='fixture'):
            script="const vm=require('node:vm');const l="+json.dumps(l)+";const q="+json.dumps({'place_id':pid})+";const sandbox={$:()=>({first:()=>({json:{query:q}})}),$input:{first:()=>({json:l})}};console.log(JSON.stringify(vm.runInNewContext('(function(){'+"+json.dumps(code)+"+'})()',sandbox)));"
            return json.loads(subprocess.check_output(['node','-e',script],text=True))[0]['json']['destino']
        destino=executar(row)
        self.assertEqual(urllib.parse.urlsplit(destino).path,'/5511998887766')
        self.assertEqual(urllib.parse.parse_qs(urllib.parse.urlsplit(destino).query)['text'],[mensagem['texto']])
        self.assertEqual(executar(row|{'enviado_em':'2026-11-17'}),row['wa_me'])
        self.assertEqual(executar(row,pid='outro'),CENTRAL)
        self.assertEqual(executar(row|{'wa_me':'https://wa.me.evil.test/5511998887766'}),CENTRAL)

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

    def test_resposta_presente_mas_desconectada_nao_libera_webhook(self):
        w={'nodes':[
            {'id':'w','name':'Entrada','type':'n8n-nodes-base.webhook','parameters':{'responseMode':'responseNode'}},
            {'id':'c','name':'Decidir','type':'n8n-nodes-base.code','parameters':{}},
            {'id':'r','name':'Resposta','type':'n8n-nodes-base.respondToWebhook','parameters':{}}],
            'connections':{'Decidir':{'main':[[{'node':'Resposta'}]]}}}
        with self.assertRaisesRegex(ValueError,'sem resposta alcançável'):validar(w)
        w['connections']['Entrada']={'main':[[{'node':'Decidir'}]]}
        self.assertTrue(validar(w))
        w['nodes'][-1]['disabled']=True
        with self.assertRaisesRegex(ValueError,'sem resposta alcançável'):validar(w)

if __name__=='__main__':unittest.main()
