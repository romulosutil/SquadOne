"""Contexto fresco e estrutural: fixtures e execução JS local, sem rede/modelos."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import unittest

spec = importlib.util.spec_from_file_location('workflow_contexto_whatsapp', Path(__file__).with_name('workflow_contexto_whatsapp.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def wf(id_):
    nome, gatilho, fim = m.ESPECIFICACOES[id_]
    leituras = [{'id': 'ler-'+str(i), 'name': n, 'type': 'n8n-nodes-base.googleSheets', 'typeVersion': 4.7,
                 'position': [240*i, 0], 'alwaysOutputData': True, 'retryOnFail': True, 'maxTries': 3,
                 'onError': 'continueRegularOutput' if i > 1 else 'stopWorkflow',
                 'credentials': {'googleSheetsOAuth2Api': {'id': 'credencial-fixture'}},
                 'parameters': {'resource': 'sheet', 'operation': 'read', 'documentId': {'value': 'planilha-fixture'}, 'sheetName': {'value': n}, 'options': {}}} for i, n in enumerate(m.LEITURAS)]
    codigo = "const body=$('"+gatilho+"').first().json.body;const rows="+json.dumps(m.LEITURAS)+".flatMap(n=>$(n).all().map(i=>i.json));return [{json:{body,rows}}];"
    nos = [{'id': 'hook', 'name': gatilho, 'type': 'n8n-nodes-base.webhook', 'parameters': {'path': 'fixture'}},
           {'id': 'org', 'name': 'Prumo · organização', 'type': 'n8n-nodes-base.code', 'parameters': {'jsCode': 'return $input.all();'}},
           *leituras, {'id': 'consumidor', 'name': fim, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
                       'position': [1500, 0], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': codigo}, 'notes': 'Preservar nota original'},
           {'id': 'depois', 'name': 'Persistir antes de confirmar', 'type': 'n8n-nodes-base.executeWorkflow', 'parameters': {'workflowJson': 'persistencia-original'}},
           {'id': 'sombra', 'name': 'Jev: sombra', 'type': 'n8n-nodes-base.noOp', 'parameters': {}}]
    con = {gatilho: {'main': [[m._destino('Prumo · organização')]]}, 'Prumo · organização': {'main': [[m._destino(m.LEITURAS[0])]]},
           fim: {'main': [[m._destino('Persistir antes de confirmar'), m._destino('Jev: sombra')]]}}
    for a, b in zip([*m.LEITURAS], [*m.LEITURAS[1:], fim]):con[a] = {'main': [[m._destino(b)]]}
    return {'id': id_, 'name': nome, 'active': False, 'settings': {'executionOrder': 'v1', 'errorWorkflow': 'erro-fixture'},
            'staticData': {'preservar': 'fixture'}, 'nodes': nos, 'connections': con}


def executar(codigo, nodes, input_=None):
    source = ('const nodes='+json.dumps(nodes)+';const input='+json.dumps(input_ or [])+';'
              'const $=name=>{if(!(name in nodes))throw Error("No nao executado");return {all:()=>nodes[name],first:()=>nodes[name][0]}};'
              'const $input={all:()=>input};try{console.log(JSON.stringify((()=>{'+codigo+'})()))}catch(e){console.error(e.message);process.exit(2)}')
    p = subprocess.run([shutil.which('node') or 'node', '-e', source], capture_output=True, text=True, encoding='utf-8', timeout=10)
    if p.returncode:raise ValueError(p.stderr)
    return json.loads(p.stdout)


class ContextoWhatsApp(unittest.TestCase):
    def test_tres_targets_mesmos_nomes_shapes_settings_credenciais_e_nenhum_cache(self):
        for id_, (_, gatilho, fim) in m.ESPECIFICACOES.items():
            with self.subTest(id=id_):
                original = wf(id_); antes = copy.deepcopy(original); out = m.preparar(original)
                self.assertEqual(original, antes)
                for k in ['id', 'name', 'active', 'settings', 'staticData']:self.assertEqual(out[k], original[k])
                self.assertEqual(len(out['nodes']), len(original['nodes'])-4)
                chamada = m._no(out, fim); p = chamada['parameters']; self.assertEqual(chamada['id'], m._no(original, fim)['id'])
                self.assertTrue(p['options']['waitForSubWorkflow']); self.assertFalse(chamada['retryOnFail']); self.assertNotIn('alwaysOutputData', chamada)
                filho = json.loads(p['workflowJson'])
                self.assertEqual(m._no(filho, fim)['parameters'], m._no(original, fim)['parameters'])
                self.assertEqual(m._no(filho, gatilho)['type'], 'n8n-nodes-base.executeWorkflowTrigger')
                self.assertEqual(m._no(filho, gatilho)['parameters'], {'inputSource':'passthrough'})
                for n in m.LEITURAS:
                    a, b = m._no(original, n), m._no(filho, n)
                    self.assertEqual(a['parameters'], b['parameters']); self.assertEqual(a['credentials'], b['credentials'])
                    self.assertEqual(a['retryOnFail'], b['retryOnFail']); self.assertEqual(a['maxTries'], b['maxTries'])
                    self.assertNotIn('onError', b); self.assertNotIn('continueOnFail', b)
                for n in ['Persistir antes de confirmar', 'Jev: sombra', 'Prumo · organização']:self.assertEqual(m._no(out,n),m._no(original,n))
                self.assertEqual(out['connections'][fim],original['connections'][fim])
                self.assertEqual(out['connections']['Prumo · organização']['main'][0],[m._destino(fim)])
                self.assertEqual(m.preparar(out),out)

    def test_js_original_recebe_mesmo_body_e_aliases_mesmo_com_varios_matches(self):
        for id_, (_, gatilho, fim) in m.ESPECIFICACOES.items():
            original=wf(id_);child=json.loads(m._no(m.preparar(original),fim)['parameters']['workflowJson'])
            nodes={gatilho:[{'json':{'body':{'chave':'2799990000','mensagens':[{'texto':'fixture'}]}}}]}
            for i,n in enumerate(m.LEITURAS):nodes[n]=[{'json':{'ID':str(i),'fixture':True}}]
            nodes[m.LEITURAS[0]].append({'json':{'ID':'segundo-match','fixture':True}})
            input_=nodes[m.LEITURAS[-1]]
            self.assertEqual(executar(m.GUARDA_JS,nodes,input_),input_)
            antes=executar(m._no(original,fim)['parameters']['jsCode'],nodes,input_)
            depois=executar(m._no(child,fim)['parameters']['jsCode'],nodes,input_)
            self.assertEqual(antes,depois);self.assertEqual(len(depois[0]['json']['rows']),5)

    def test_fonte_com_erro_ausente_ou_item_ilegivel_falha_antes_consumidor(self):
        nodes={n:[{'json':{}}] for n in m.LEITURAS}
        self.assertEqual(executar(m.GUARDA_JS,nodes,[{'json':{}}]),[{'json':{}}])
        for nome in m.LEITURAS:
            for ruim in [[{'json':{'error':{'message':'fixture'}}}],[{'json':[]}],[{}]]:
                alvo=copy.deepcopy(nodes);alvo[nome]=ruim
                with self.assertRaises(ValueError):executar(m.GUARDA_JS,alvo)
            alvo=copy.deepcopy(nodes);del alvo[nome]
            with self.assertRaises(ValueError):executar(m.GUARDA_JS,alvo)

    def test_grafo_alterado_dependencia_externa_e_nos_duplicados_nao_migram_silenciosamente(self):
        id_=next(iter(m.ESPECIFICACOES));_,_,fim=m.ESPECIFICACOES[id_]
        for mudar in [lambda w:w['connections'][m.LEITURAS[0]]['main'][0].append(m._destino('Jev: sombra')),
                      lambda w:w['nodes'].append(copy.deepcopy(m._no(w,m.LEITURAS[0]))),
                      lambda w:m._no(w,m.LEITURAS[0]).update(disabled=True),
                      lambda w:m._no(w,'Jev: sombra')['parameters'].update(value="={{ $('Ler Prospects').all() }}"),
                      lambda w:w['connections']['Prumo · organização']['main'][0].append(m._destino(fim))]:
            w=wf(id_);mudar(w);antes=copy.deepcopy(w)
            with self.assertRaises(ValueError):m.preparar(w)
            self.assertEqual(w,antes)

    def test_marker_nao_mascara_guard_removido_retry_parcial_ou_leitura_tolerante(self):
        id_=next(iter(m.ESPECIFICACOES));fim=m.ESPECIFICACOES[id_][2]
        out=m.preparar(wf(id_));call=m._no(out,fim)
        filho=json.loads(call['parameters']['workflowJson']);m._no(filho,m.LEITURAS[2])['onError']='continueRegularOutput'
        call['parameters']['workflowJson']=json.dumps(filho)
        with self.assertRaises(ValueError):m.preparar(out)

    def test_idempotencia_com_contexto_prumo_antes_depois_e_conexoes_intactas(self):
        spec=importlib.util.spec_from_file_location('prumo_contexto_fixture',Path(__file__).with_name('prumo_contexto.py'))
        prumo=importlib.util.module_from_spec(spec);spec.loader.exec_module(prumo)
        contexto={'versao':1,'organizacao_sha256':'a'*64,'origem':'fixture-canônica','organizacao':'fixture'}
        for id_,(_,gatilho,fim) in m.ESPECIFICACOES.items():
            antes=prumo.preparar(wf(id_),contexto)
            transformado=m.preparar(antes)
            decorado=prumo.preparar(transformado,contexto)
            self.assertEqual(m.preparar(decorado),decorado)
            self.assertEqual(prumo.preparar(decorado,contexto),decorado)
            self.assertEqual(decorado['connections'],transformado['connections'])
            filho=json.loads(m._no(decorado,fim)['parameters']['workflowJson'])
            self.assertTrue(any(n['name']=='Prumo · organização · '+gatilho for n in filho['nodes']))
            self.assertEqual(m._no(filho,fim)['parameters']['jsCode'],m._no(wf(id_),fim)['parameters']['jsCode'])
        out=m.preparar(wf(id_));m._no(out,fim)['alwaysOutputData']=True
        with self.assertRaises(ValueError):m.preparar(out)

    def test_21_demais_pausas_e_id_estranho_nao_mudam(self):
        outro={'id':'outro','name':'01 · Caçador','active':False,'nodes':[],'connections':{},'settings':{'fixture':True}}
        self.assertEqual(m.preparar(outro),outro)
        w=wf(next(iter(m.ESPECIFICACOES)));w['id']='clone-nao-autorizado';self.assertEqual(m.preparar(w),w)
        del w['id'];self.assertEqual(len(m.preparar(w)['nodes']),len(w['nodes'])-4)

    def test_child_com_bypass_modelo_escrita_ou_consumidor_trocado_rejeita(self):
        id_=next(iter(m.ESPECIFICACOES));_,gatilho,fim=m.ESPECIFICACOES[id_]
        for alterar in [lambda f:f['connections'][m.LEITURAS[0]].update(main=[[m._destino(fim)]]),
                        lambda f:f['connections'][m.GUARDA]['main'][0].append(m._destino(m.LEITURAS[0])),
                        lambda f:f['nodes'].append({'id':'modelo','name':'modelo','type':'n8n-nodes-base.httpRequest','parameters':{}}),
                        lambda f:m._no(f,m.LEITURAS[0])['parameters'].update(operation='update'),
                        lambda f:m._no(f,fim)['parameters'].update(jsCode='return [];')]:
            out=m.preparar(wf(id_));call=m._no(out,fim);filho=json.loads(call['parameters']['workflowJson']);alterar(filho);call['parameters']['workflowJson']=json.dumps(filho)
            with self.assertRaises(ValueError):m.preparar(out)

    def test_refs_node_items_e_dolar_no_pai_e_no_filho_sao_conferidas(self):
        id_=next(iter(m.ESPECIFICACOES));fim=m.ESPECIFICACOES[id_][2]
        for expressao in ["$node['Ler Prospects'].json", '$node["Ler Prospects"].json', "$items('Ler Prospects')", '$items("Ler Prospects", 0, 0)', '$("Ler Prospects").all()']:
            w=wf(id_);m._no(w,'Jev: sombra')['parameters']['x']=expressao
            with self.assertRaises(ValueError):m.preparar(w)
        for expressao in ["$node['Fora do filho'].json", "$items('Fora do filho')", "$('Fora do filho').all()"]:
            w=wf(id_);m._no(w,fim)['parameters']['jsCode']+='\n'+expressao
            with self.assertRaises(ValueError):m.preparar(w)
        # A referência ao webhook original é disponível no trigger interno e não deve ser rejeitada.
        self.assertTrue(m.preparar(wf(id_)))

    def test_nao_aceita_folha_guarda_trigger_desabilitados_ou_entrada_filtrada(self):
        id_=next(iter(m.ESPECIFICACOES));_,gatilho,fim=m.ESPECIFICACOES[id_]
        for nome in [fim,m.GUARDA,gatilho]:
            out=m.preparar(wf(id_));call=m._no(out,fim);filho=json.loads(call['parameters']['workflowJson']);m._no(filho,nome)['disabled']=True;call['parameters']['workflowJson']=json.dumps(filho)
            with self.assertRaises(ValueError):m.preparar(out)
        out=m.preparar(wf(id_));call=m._no(out,fim);filho=json.loads(call['parameters']['workflowJson']);m._no(filho,gatilho)['parameters']['inputSource']='jsonExample';call['parameters']['workflowJson']=json.dumps(filho)
        with self.assertRaises(ValueError):m.preparar(out)

    def test_guarda_intacta_nao_toleral_erro_e_ninguem_pode_ser_ignorado(self):
        spec=importlib.util.spec_from_file_location('prumo_contexto_guard_fixture',Path(__file__).with_name('prumo_contexto.py'))
        prumo=importlib.util.module_from_spec(spec);spec.loader.exec_module(prumo)
        contexto={'versao':1,'organizacao_sha256':'a'*64,'origem':'fixture','organizacao':'fixture'}
        id_=next(iter(m.ESPECIFICACOES));_,gatilho,fim=m.ESPECIFICACOES[id_]
        for nome in [fim,m.GUARDA,gatilho,'Prumo · organização · '+gatilho,'CHAMADA']:
            for flag in [{'onError':'continueRegularOutput'},{'onError':'continueErrorOutput'},{'continueOnFail':True},{'disabled':True}]:
                with self.subTest(no=nome,flag=flag):
                    out=prumo.preparar(m.preparar(wf(id_)),contexto);call=m._no(out,fim)
                    filho=json.loads(call['parameters']['workflowJson'])
                    if nome=='CHAMADA':call.update(flag)
                    else:
                        m._no(filho,nome).update(flag);call['parameters']['workflowJson']=json.dumps(filho)
                    with self.assertRaises(ValueError):m.preparar(out)


if __name__=='__main__':unittest.main()
