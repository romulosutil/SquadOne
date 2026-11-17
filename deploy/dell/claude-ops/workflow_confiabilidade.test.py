"""Regressões da auditoria de 18/10: sem API, planilha, mensagens ou credenciais."""
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

BASE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), BASE / (name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def js(code, nodes=None, rows=None, more=''):
    source = ('const nodes=' + json.dumps(nodes or {}, ensure_ascii=False) + ';'
              'const rows=' + json.dumps(rows or [], ensure_ascii=False) + ';'
              "const $=name=>({all:()=>nodes[name]??[],first:()=>nodes[name]?.[0]??{json:{}}});"
              "const $input={all:()=>rows,first:()=>rows[0]};const $workflow={name:'Teste'};" + more +
              '\n(async()=>{const result=await(async()=>{\n' + code + '\n})();console.log(JSON.stringify(result));})().catch(e=>{console.error(e);process.exit(1)});')
    p = subprocess.run([shutil.which('node') or 'node', '-e', source], capture_output=True, text=True, encoding='utf-8', timeout=15)
    if p.returncode:
        raise AssertionError(p.stderr)
    return json.loads(p.stdout)


def code_node(name, code='return $input.all();'):
    return {'id': name, 'name': name, 'type': 'n8n-nodes-base.code', 'parameters': {'jsCode': code}}


class Confiabilidade(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = load('workflow_confiabilidade')

    def test_confirmacao_so_depois_de_todas_as_gravacoes(self):
        names = ['Decidir', 'Responder ao observador', 'Qual planilha?', 'Marcar no PRUMO', 'Marcar no Site antes da venda']
        nodes = [code_node(n) for n in names]
        nodes[1]['parameters'] = {'responseBody': '={{ {marcados:$input.all()} }}'}
        wf = {'name':'WhatsApp — conversa com lead (marca sozinho)', 'nodes':nodes, 'connections':{
            'Decidir':{'main':[[self.h.destino('Responder ao observador')]]},
            'Responder ao observador':{'main':[[self.h.destino('Qual planilha?')]]},
            'Qual planilha?':{'main':[[self.h.destino(names[3])],[self.h.destino(names[4])]]}}}
        out = self.h.confirmar_persistencia(wf)
        sub = next(n for n in out['nodes'] if n['type']=='n8n-nodes-base.executeWorkflow')
        self.assertTrue(sub['parameters']['options']['waitForSubWorkflow'])
        self.assertTrue(sub['alwaysOutputData'])
        child = json.loads(sub['parameters']['workflowJson'])
        self.assertEqual({n['name'] for n in child['nodes']}, {'Receber dados', *names[2:]})
        self.assertNotIn('Responder ao observador', out['connections'])
        self.assertEqual(out['connections']['Decidir']['main'][0][0]['node'], sub['name'])
        responder = next(n for n in out['nodes'] if n['name']=='Responder ao observador')
        self.assertIn("$('Decidir').all()", responder['parameters']['responseBody'])
        self.assertEqual(self.h.confirmar_persistencia(out), out)

    def test_checkpoint_so_depois_do_subfluxo_inclusive_sem_resultados(self):
        names=['Escolher a busca','Montar área da busca','Buscar no Google Places','Registrar ultima_rodada','Salvar lead']
        nodes=[code_node(n) for n in names]
        nodes[3]['parameters']={'columns':{'value':{'row_number':"={{ $('Montar área da busca').first().json.row_number }}"}}}
        wf={'name':'01 · Caçador','nodes':nodes,'connections':{
            names[0]:{'main':[[self.h.destino(names[1])]]},names[1]:{'main':[[self.h.destino(names[2])]]},
            names[2]:{'main':[[self.h.destino(names[3]),self.h.destino(names[4])]]}}}
        out=self.h.concluir_cacador(wf)
        self.assertEqual(out['connections']['Concluir processamento da busca']['main'][0][0]['node'], names[3])
        sub=next(n for n in out['nodes'] if n['type']=='n8n-nodes-base.executeWorkflow')
        self.assertTrue(sub['alwaysOutputData'])
        self.assertNotIn(names[3], {n['name'] for n in json.loads(sub['parameters']['workflowJson'])['nodes']})
        self.assertIn(names[4], {n['name'] for n in self.h.desembrulhar(out)['nodes']})
        self.assertEqual(self.h.concluir_cacador(out),out)

    def test_abrir_convite_nunca_marca_envio(self):
        wf={'name':'Convite','nodes':[code_node('Decidir','return [{json:{marcar:true,destino:"https://wa.me/5511999999999"}}];'),code_node('Marcar como enviado')],'connections':{}}
        out=self.h.preparar(wf)
        self.assertFalse(js(out['nodes'][0]['parameters']['jsCode'])[0]['json']['marcar'])

    def test_rastro_do_clique_do_site_nao_e_embrulhado(self):
        marcar=code_node('Marcar como enviado');marcar['parameters']={'columns':{'matchingColumns':['place_id'],'value':{'place_id':'={{ $json.chave }}','clique_em':'={{ $json.agora }}'}}}
        wf={'name':'04','nodes':[code_node('Decidir','return [{json:{marcar:true}}];'),marcar],'connections':{}}
        out=self.h.preparar(wf)
        self.assertTrue(js(out['nodes'][0]['parameters']['jsCode'])[0]['json']['marcar'])
        # Quem grava status ou enviado_em continua sem poder marcar no clique.
        marcar['parameters']['columns']['value']['status']='enviado'
        out=self.h.preparar(wf)
        self.assertFalse(js(out['nodes'][0]['parameters']['jsCode'])[0]['json']['marcar'])

    def acao(self):
        wf={'name':'07 · Lead: página e ações (Site antes da venda)','nodes':[
            {'id':'get','name':'Botão da página','webhookId':'get','type':'n8n-nodes-base.webhook','parameters':{'httpMethod':'GET','path':'lead-acao'}},
            code_node('Botão: ler a linha'),code_node('Decidir a ação',"const q=$('Botão da página').first().json.query;return [{json:{planilha:true,pasta:false,acao:q.acao}}];"),
            {'id':'show','name':'Mostrar a página','type':'n8n-nodes-base.respondToWebhook','parameters':{'responseBody':'={{ $json.html }}'}},code_node('Grava na planilha?')],
            'connections':{'Botão da página':{'main':[[self.h.destino('Botão: ler a linha')]]},'Decidir a ação':{'main':[[self.h.destino('Grava na planilha?')]]}}}
        return self.h.confirmar_acao(wf)

    def test_get_nao_escreve_e_post_exige_origem_e_contexto(self):
        wf=self.acao(); code=next(n['parameters']['jsCode'] for n in wf['nodes'] if n['name']=='Decidir a ação')
        row={'place_id':'a','nome':'Empresa','status':'enviado'}
        def run(req):return js(code,{'Entrada da ação':[{'json':req}]},[{'json':row}])[0]['json']
        get=run({'query':{'id':'a','acao':'fechou'}})
        self.assertFalse(get['autorizado']);self.assertIn('<form method="post"',get['html'])
        post={'_confirmado':True,'query':{'id':'a','acao':'fechou','contexto':'enviado|||||'},'headers':{'origin':'https://evil.example'}}
        self.assertEqual(run(post)['codigo'],403)
        post['headers']['origin']='https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net'
        post['query']['contexto']='velho'
        self.assertEqual(run(post)['codigo'],409)
        post['query']['contexto']='enviado|||||'
        self.assertTrue(run(post)['autorizado'])

    def test_cacador_site_preserva_criterios_e_endurece_dedupe_e_persistencia(self):
        fixture=BASE.parents[2]/'ops/n8n/workflows/01-Cacador.sanitizado.json'
        documento=json.loads(fixture.read_text(encoding='utf-8'))
        origem=documento[0] if isinstance(documento,list) else documento
        antes=json.dumps(origem,ensure_ascii=False,sort_keys=True)
        saida=self.h.preparar(origem)
        self.assertEqual(saida.get('active'),origem.get('active'))
        def todos(wf):
            for n in wf.get('nodes',[]):
                yield n
                filho=n.get('parameters',{}).get('workflowJson')
                if isinstance(filho,str):yield from todos(json.loads(filho))
        orig={n.get('name'):n for n in todos(origem)}
        novos={n.get('name'):n for n in todos(saida)}
        self.assertEqual(orig['Normalizar campos'],novos['Normalizar campos'])
        self.assertEqual(orig['Dentro do raio'],novos['Dentro do raio'])
        self.assertEqual(orig['5+ avaliações'],novos['5+ avaliações'])
        self.assertNotIn('onError',novos['Ler leads existentes'])
        self.assertFalse(novos['Ler leads existentes'].get('continueOnFail'))
        for nome in ('Salvar lead na planilha','Salvar descartado na planilha'):
            no=novos[nome]
            self.assertEqual(no['parameters']['operation'],'appendOrUpdate')
            self.assertEqual(no['parameters']['columns']['matchingColumns'],['place_id'])
            self.assertFalse(no.get('retryOnFail'))
        self.assertEqual(json.dumps(origem,ensure_ascii=False,sort_keys=True),antes)
        self.assertEqual(self.h.preparar(saida),saida)


class RespostasDoMapa(unittest.TestCase):
    def test_processa_cada_resposta_completa_uma_vez(self):
        fake=types.ModuleType('n8n');fake.api=lambda *args:None;fake.put=lambda *args:None
        with patch.dict(sys.modules,{'n8n':fake}):m=load('prumo-mapa-n8n')
        qs=[{'id':'AR1','prefix':'Pergunta','choices':['a','b','c','d']}]
        code=next(n['parameters']['jsCode'] for n in m.nos(json.dumps(qs)) if n['name']=='Mapa: montar pacote')
        rows=[{'json':{'Empresa':'a::Empresa','Carimbo de data/hora':t,'Pergunta':'a'}} for t in ['18/10/2026 10:00','18/10/2026 10:30']]
        rows += [rows[0],{'json':{'Empresa':'a::Empresa','Carimbo de data/hora':'18/10/2026 10:40','Pergunta':''}}]
        nodes={'Ler prospects':[{'json':{'ID':'a'}}],'Ler respostas do formulário':rows,'Mapa: extrair feitos':[{'json':{'data':{}}}],
               'Mapa: extrair leads do site':[{'json':{'data':{'leads':[]}}}]}
        out=js(code,nodes)
        self.assertEqual(len(out),2)
        nodes['Mapa: extrair feitos'][0]['json']['data']={o['json']['chave']:'feito' for o in out}
        self.assertEqual(js(code,nodes),[])


class DiagnosticoDoDono(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Mesmo questionário do export, sem consultar o Google ou o n8n.
        fixture=json.loads((BASE/'testes/prumo-diagnostico.fixture.json').read_text(encoding='utf-8'))[0]
        fake=types.ModuleType('n8n')
        fake.api=lambda method,*args:fixture if method=='GET' else {}
        captured=[];fake.put=captured.append
        fake.aviso_nodes=lambda prefix,*args,**kwargs:(code_node(prefix+': montar aviso'),code_node(prefix+': avisar pelo Hermes'))
        proxy=types.ModuleType('sheets_proxy');proxy.SheetsProxy=object
        with patch.dict(sys.modules,{'n8n':fake,'sheets_proxy':proxy}):
            m=load('prumo-simples')
            with patch.object(Path,'write_text',return_value=0):m.pontuacao(1838781376)
        cls.code=next(n['parameters']['jsCode'] for n in captured[0]['nodes'] if n['name']=='Calcular diagnóstico')
        cls.questions=js(cls.code.split('const prospects =')[0]+'\nreturn QUESTIONS;')

    def test_resposta_nova_com_mesma_nota_atualiza_e_repeticao_nao(self):
        qs=self.questions
        row={'Empresa':'a::Empresa','Carimbo de data/hora':'18/10/2026 10:00:00',**{q['prefix']:q['choices'][0] for q in qs}}
        row[qs[0]['prefix']]=qs[0]['choices'][1]
        lead={'ID':'a','Empresa':'Empresa','Etapa':'Convite enviado','Diagnóstico em':'2026-10-17','Índice PRUMO':26.6,'Briefing':'versão anterior'}
        nodes={'Ler prospects':[{'json':lead}],'Extrair avisados':[{'json':{'data':{}}}],
               'Mapa: extrair leads do site':[{'json':{'data':{'leads':[]}}}]}
        out=js(self.code,nodes,[{'json':row}])
        self.assertEqual(len(out),1)
        lead.update(out[0]['json'])
        self.assertEqual(js(self.code,nodes,[{'json':row}]),[])
        # Uma pergunta sobe e outra desce: mesma soma, evidência diferente.
        row[qs[0]['prefix']]=qs[0]['choices'][0];row[qs[1]['prefix']]=qs[1]['choices'][1]
        self.assertEqual(len(js(self.code,nodes,[{'json':row}])),1)

    def test_lead_do_site_nao_vira_aviso_fora_dos_prospects(self):
        row={'Empresa':'site-id::Empresa','Carimbo de data/hora':'18/10/2026',**{q['prefix']:q['choices'][0] for q in self.questions}}
        nodes={'Ler prospects':[],'Extrair avisados':[{'json':{'data':{}}}],
               'Mapa: extrair leads do site':[{'json':{'data':{'leads':[{'place_id':'site-id'}]}}}]}
        self.assertEqual(js(self.code,nodes,[{'json':row}]),[])


class NomesQueNaoMentem(unittest.TestCase):
    """19/10/2026: o 04 do Site grava só o clique e se chama assim; o convite do PRUMO ainda tem o nó antigo."""

    @classmethod
    def setUpClass(cls):
        cls.h=load('workflow_confiabilidade')
        fake=types.ModuleType('n8n');fake.api=lambda *a:None;fake.put=lambda *a:None;fake.DESLIGADOS={'abc':'Fluxo parado'}
        cls.fake=fake
        with patch.dict(sys.modules,{'n8n':fake}):
            cls.fc=load('fecha-ciclos')
            cls.ra=load('rodar-agora')

    def marcar(self,nome,colunas):
        no=code_node(nome);no['parameters']={'columns':{'matchingColumns':['place_id'],'value':{'place_id':'={{ $json.chave }}',**colunas}}}
        return no

    def test_os_dois_nomes_valem_para_o_rastro_do_clique(self):
        for nome in ('Marcar como enviado','Gravar clique_em'):
            wf={'name':'04','nodes':[code_node('Decidir','return [{json:{marcar:true}}];'),self.marcar(nome,{'clique_em':'x'})],'connections':{}}
            self.assertTrue(js(self.h.preparar(wf)['nodes'][0]['parameters']['jsCode'])[0]['json']['marcar'],nome)

    def test_convite_com_o_no_novo_ou_antigo_continua_sem_marcar_envio(self):
        for nome in ('Marcar como enviado','Gravar clique_em'):
            wf={'name':'Convite','nodes':[code_node('Decidir','return [{json:{marcar:true}}];'),self.marcar(nome,{'status':'enviado'})],'connections':{}}
            self.assertFalse(js(self.h.preparar(wf)['nodes'][0]['parameters']['jsCode'])[0]['json']['marcar'],nome)

    def test_fluxo_antigo_e_achado_pelo_nome_velho_e_o_novo_tem_prioridade(self):
        todos=[{'id':'1','name':self.fc.NOME_ANTIGO_DO_04},{'id':'2','name':'outro'}]
        achados=self.fc.achar_fluxo(todos,self.fc.NOME_DO_04,(self.fc.NOME_ANTIGO_DO_04,))
        self.assertEqual([w['id'] for w in achados],['1'])
        todos.append({'id':'3','name':self.fc.NOME_DO_04})
        self.assertEqual([w['id'] for w in self.fc.achar_fluxo(todos,self.fc.NOME_DO_04,(self.fc.NOME_ANTIGO_DO_04,))],['3','1'])
        self.assertEqual(self.fc.achar_fluxo(todos,'Convite do PRUMO'),[])

    def test_publicar_o_04_renomeia_pelo_id_e_nomeia_o_no(self):
        chamadas=[]
        def api(metodo,caminho,corpo=None):
            chamadas.append((metodo,caminho,corpo))
            if metodo=='GET':return {'data':[{'id':'erro1','name':'00 · Avisar falha pelo Hermes'},{'id':'velho1','name':self.fc.NOME_ANTIGO_DO_04}]}
            return {'id':'novo'}
        puts=[]
        with patch.object(self.fc,'api',api),patch.object(self.fc,'put',puts.append):
            self.fc.webhook_workflow(self.fc.NOME_DO_04,'enviar','wid','planilha','1','Leads','place_id','place_id','return [];',{'clique_em':'x'},
                                     nome_do_no_marcar='Gravar clique_em',nomes_antigos=(self.fc.NOME_ANTIGO_DO_04,))
        self.assertEqual(len(puts),1)
        self.assertEqual((puts[0]['id'],puts[0]['name']),('velho1',self.fc.NOME_DO_04))
        self.assertFalse([c for c in chamadas if c[0]=='POST' and c[1]=='/workflows'],'não pode nascer um 2º fluxo com o mesmo path')
        nomes={n['name'] for n in puts[0]['nodes']}
        self.assertIn('Gravar clique_em',nomes);self.assertNotIn('Marcar como enviado',nomes)
        self.assertEqual(puts[0]['connections']['Primeiro clique?']['main'][0][0]['node'],'Gravar clique_em')
        self.assertIn('Gravar clique_em',puts[0]['connections'])

    def test_convite_do_prumo_segue_com_o_no_antigo_por_padrao(self):
        criados=[]
        def api(m,c,b=None):
            if m=='GET':return {'data':[{'id':'e','name':'00 · Avisar falha pelo Hermes'}]}
            if m=='POST' and c=='/workflows':criados.append(b)
            return {'id':'n'}
        with patch.object(self.fc,'api',api):
            self.fc.webhook_workflow('PRUMO — convite','convite','wid','p','1','Leads','ID','id','return [];',{'status':'x'})
        self.assertEqual(len(criados),1)
        self.assertIn('Marcar como enviado',{n['name'] for n in criados[0]['nodes']})
        self.assertEqual(criados[0]['connections']['Primeiro clique?']['main'][0][0]['node'],'Marcar como enviado')

    def test_o_04_do_site_tem_o_nome_e_a_base_certos(self):
        self.assertEqual(self.fc.NOME_DO_04,'04 · Clique no wa_link (registra o clique)')
        self.assertTrue(self.fc.LINKS.endswith('.ts.net/webhook'))
        self.assertIn('edit#gid='+self.fc.LEADS_GID,self.fc.DECIDIR_SITE)

    def test_erro_de_execucao_sempre_salvo(self):
        with tempfile.TemporaryDirectory() as home:
            (Path(home)/'.config/claude-ops').mkdir(parents=True)
            (Path(home)/'.config/claude-ops/n8n-api-key').write_text('k',encoding='utf-8')
            with patch.object(Path,'home',return_value=Path(home)):
                n8n=load('n8n')
        for settings in (None,{},{'saveDataErrorExecution':'none','executionOrder':'v1'}):
            corpo={'name':'x','nodes':[],'connections':{}}
            if settings is not None:corpo['settings']=settings
            out=n8n.garantir_erro_salvo(corpo)
            self.assertEqual(out['settings']['saveDataErrorExecution'],'all')
            if settings:self.assertEqual(out['settings']['executionOrder'],'v1')
            self.assertEqual(corpo.get('settings'),settings,'o dict do chamador não muda')

    def test_rodar_agora_recusa_fluxo_desligado_sem_forcar(self):
        self.assertIn('Fluxo parado',self.ra.recusa_desligado('abc',False))
        self.assertEqual(self.ra.recusa_desligado('abc',True),'')
        self.assertEqual(self.ra.recusa_desligado('outro',False),'')


if __name__=='__main__':unittest.main()
