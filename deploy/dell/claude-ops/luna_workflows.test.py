import importlib.util
import json
import io
import tempfile
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch


def carregar(nome):
    spec = importlib.util.spec_from_file_location(nome, Path(__file__).with_name(nome + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Contrato(unittest.TestCase):
    def handler_comercial(self, m, corpo=b'{"idOriginal":"fixture"}', cabecalhos=None, ip='172.23.0.2'):
        resultado=[]
        h=SimpleNamespace(path='/comercial/evento',headers={'Content-Length':str(len(corpo)),'X-CRM':'segredo-ficticio',**(cabecalhos or {})},rfile=io.BytesIO(corpo),client_address=(ip,1234),connection=SimpleNamespace(settimeout=lambda _:None),responder=lambda s,b:resultado.append((s,b)))
        h.evento_comercial=lambda:m.Servidor.evento_comercial(h)
        return h,resultado

    def test_ponte_comercial_xcrm_independente_nao_chama_luna_e_preserva_corpo(self):
        m=carregar('luna_workflows');body=b'{"idOriginal":"original","origem":"whatsapp"}'
        h,r=self.handler_comercial(m,body)
        with patch.object(m.Path,'read_text',return_value='segredo-ficticio'),patch.object(m,'inferir',side_effect=AssertionError('modelo proibido')),patch.object(m,'encaminhar_evento_comercial',return_value=(202,{'ok':True,'persistido':True,'estado':'pendente'})) as enviar:
            m.Servidor.do_POST(h)
        enviar.assert_called_once_with(body,'segredo-ficticio');self.assertEqual(r[0][0],202)

    def test_ponte_rejeita_token_luna_rede_errada_unicode_e_tamanho_sem_encaminhar(self):
        m=carregar('luna_workflows')
        for headers,ip,status in [({'X-CRM':'','Authorization':'Bearer segredo-ficticio'},'172.23.0.2',403),({'X-CRM':'á'},'172.23.0.2',403),({},'203.0.113.1',403),({'Content-Length':'8193'},'172.23.0.2',400),({'Transfer-Encoding':'chunked'},'172.23.0.2',400),({'Content-Length':'0'},'172.23.0.2',400)]:
            h,r=self.handler_comercial(m,cabecalhos=headers,ip=ip)
            with patch.object(m.Path,'read_text',return_value='segredo-ficticio'),patch.object(m,'encaminhar_evento_comercial') as enviar:
                m.Servidor.do_POST(h);enviar.assert_not_called()
            self.assertEqual(r[0][0],status)
        for body in [b'[]',b'naoJSON',b'\xff']:
            h,r=self.handler_comercial(m,body)
            with patch.object(m.Path,'read_text',return_value='segredo-ficticio'),patch.object(m,'encaminhar_evento_comercial') as enviar:
                m.Servidor.do_POST(h);enviar.assert_not_called()
            self.assertEqual(r[0][0],400)

    def test_transporte_comercial_destino_fixo_timeout_sem_origin_e_recibo_sanitizado(self):
        m=carregar('luna_workflows');requests=[]
        class Resposta(io.BytesIO):
            code=202
        def abrir(req,timeout):
            requests.append((req,timeout));return Resposta(json.dumps({'ok':True,'persistido':True,'estado':'repetido','chave':'hash-ficticio','texto':'nao-repassar','segredo':'nao-repassar'}).encode())
        status,body=m.encaminhar_evento_comercial(b'{"fixture":true}','fixture-secret',abrir)
        self.assertEqual(status,202);self.assertEqual(body,{'ok':True,'persistido':True,'estado':'repetido','chave':'hash-ficticio'})
        req,prazo=requests[0];self.assertEqual(req.full_url,'http://127.0.0.1:9120/api/operations/crm/atendimento/evento');self.assertEqual(prazo,3)
        self.assertEqual(req.get_method(),'POST');self.assertEqual(req.data,b'{"fixture":true}');self.assertNotIn('Origin',req.headers)
        self.assertIsNone(m._SemRedirectComercial().redirect_request(None,None,302,'',{},'http://nao-permitido.invalid'))

    def test_falha_timeout_corpo_privado_e_ack_sem_persistencia_nao_viram_sucesso(self):
        m=carregar('luna_workflows')
        class Resposta(io.BytesIO):
            def __init__(self,code,body):super().__init__(body);self.code=code
        for code,body,status in [(202,b'{"ok":true}',503),(200,b'privado fixture',502),(409,b'privado fixture',409),(202,b'x'*4097,503),(202,b'[]',503)]:
            s,r=m.encaminhar_evento_comercial(b'{}','fixture',lambda *_a,**_kw:Resposta(code,body));self.assertEqual(s,status);self.assertNotIn('privado',str(r));self.assertFalse(r['persistido'])
        def falhar(*_a,**_kw):raise TimeoutError('segredo fixture nao logar')
        s,r=m.encaminhar_evento_comercial(b'{}','fixture',falhar);self.assertEqual(s,503);self.assertNotIn('segredo',str(r))

    def test_rota_inferencia_conserva_autenticacao_luna_sem_aceitar_xcrm(self):
        m=carregar('luna_workflows');h,r=self.handler_comercial(m,cabecalhos={'Authorization':'Bearer segredo-ficticio'});h.path='/inferir'
        h.rfile=io.BytesIO(b'{"tarefa":"resumir","prompt":"fixture"}');h.headers['Content-Length']=str(len(h.rfile.getvalue()))
        with patch.object(m.Path,'read_text',return_value='segredo-ficticio'),patch.object(m,'inferir',return_value={'fixture':True}) as inferir:
            m.Servidor.do_POST(h);inferir.assert_called_once()
        self.assertEqual(r,[(200,{'fixture':True})])
        h,r=self.handler_comercial(m);h.path='/inferir'
        with patch.object(m.Path,'read_text',return_value='segredo-ficticio'),patch.object(m,'inferir') as inferir:
            m.Servidor.do_POST(h);inferir.assert_not_called()
        self.assertEqual(r[0][0],403)

    def test_rejeita_comando_ferramenta_modelo_e_prompt_excessivo(self):
        m = carregar('luna_workflows')
        for extra in [{'model': 'outro'}, {'tools': ['terminal']}, {'command': 'rm'}]:
            with self.assertRaises(ValueError):
                m.validar_pedido({'tarefa': 'resumir', 'prompt': 'teste', **extra})
        for prompt in ['', 'á' * 30001, None]:
            with self.assertRaises(ValueError):
                m.validar_pedido({'tarefa': 'classificar', 'prompt': prompt})

    def test_classificacao_incompleta_ou_booleano_textual_falha_fechado(self):
        m = carregar('luna_workflows')
        for saida in ['{}', 'não sei', '{"e_estabelecimento":"true"}']:
            with self.assertRaises(ValueError):
                m.validar_saida('classificar', saida)
        self.assertEqual(m.validar_saida('resumir', 'Resumo')['content']['parts'][0]['text'], 'Resumo')

    def test_troca_so_cacador_preserva_prompt_e_nao_leva_segredo(self):
        m = carregar('workflow_luna')
        wf = {'name': '01 · Caçador', 'nodes': [{'name': 'Gemini: resumir avaliações',
            'type': '@n8n/n8n-nodes-langchain.googleGemini', 'parameters': {'messages': {'values': [{'content': '=Dados {{ $json.nome }}'}]}},
            'credentials': {'googlePalmApi': {'id': 'gemini'}}}]}
        saida = m.usar_luna(wf, 'credencial-n8n')
        n = saida['nodes'][0]
        self.assertEqual(n['parameters']['bodyParameters']['parameters'][1]['value'], '=Dados {{ $json.nome }}')
        self.assertNotIn('googlePalmApi', n['credentials'])
        self.assertEqual(m.usar_luna(saida, 'credencial-n8n'), saida)
        self.assertIn('googlePalmApi', wf['nodes'][0]['credentials'])

    def test_renomeia_provedor_conexoes_referencias_e_subfluxo_sem_mudar_prompt(self):
        m=carregar('workflow_luna')
        nome='Gemini: resumir avaliações'
        node={'name':nome,'type':'@n8n/n8n-nodes-langchain.googleGemini','parameters':{'messages':{'values':[{'content':'=Prompt original'}]}}}
        wf={'name':'01 · Caçador','nodes':[node,{'name':'Ler','type':'n8n-nodes-base.code','parameters':{'jsCode':"return $('"+nome+"').all();"}}], 'connections':{nome:{'main':[[{'node':'Ler','type':'main','index':0}]]}}}
        saida=m.usar_luna(wf,'fixture')
        novo='Luna (Hermes): resumir avaliações'
        self.assertEqual(saida['nodes'][0]['name'],novo)
        self.assertIn(novo,saida['connections'])
        self.assertIn(novo,saida['nodes'][1]['parameters']['jsCode'])
        self.assertEqual(saida['nodes'][0]['parameters']['bodyParameters']['parameters'][1]['value'],'=Prompt original')
        self.assertEqual(m.usar_luna(saida,'fixture'),saida)
        inline={'name':'01 · Caçador','nodes':[{'name':'Sub','type':'n8n-nodes-base.executeWorkflow','parameters':{'workflowJson':json.dumps(wf)}}]}
        self.assertEqual(json.loads(m.usar_luna(inline,'fixture')['nodes'][0]['parameters']['workflowJson'])['nodes'][0]['name'],novo)
        estranho={**wf,'name':'Outro fluxo'}
        self.assertEqual(m.usar_luna(estranho,'fixture'),estranho)

    def test_metrica_inferencia_sucesso_e_falha_sem_prompt_resposta_ou_erro(self):
        for falha in (False,True):
            m=carregar('luna_workflows')
            with tempfile.TemporaryDirectory() as tmp:
                base=Path(tmp); pasta=base/'isolada';pasta.mkdir()
                def executar(*_a,**_kw):
                    if falha: raise RuntimeError('segredo fixture nao logar')
                    return 'resposta privada fixture'
                with patch.object(m,'BASE',base),patch.object(m,'PASTA',pasta),patch.object(m,'limpar_sessoes'),patch.object(m,'executar',side_effect=executar):
                    if falha:
                        with self.assertRaises(RuntimeError):m.inferir({'tarefa':'resumir','prompt':'prompt privado fixture'})
                    else:m.inferir({'tarefa':'resumir','prompt':'prompt privado fixture'})
                arquivos=list((base/'metricas').glob('*.jsonl'));self.assertEqual(len(arquivos),1)
                texto=arquivos[0].read_text();r=json.loads(texto)
                self.assertEqual(r['resultado'],'falha' if falha else 'ok')
                self.assertEqual(r['execucoesHermes'],1);self.assertEqual(r['tentativaDoDia'],1)
                self.assertEqual(r['modeloSolicitado'],m.MODELO);self.assertGreaterEqual(r['duracaoMs'],0)
                self.assertIsNone(r['custoUsd']);self.assertIsNone(r['tokens']);self.assertIsNone(r['chamadasModelo']);self.assertIsNone(r['modeloEfetivo']);self.assertIsNone(r['provedorEfetivo'])
                for privado in ['prompt privado','resposta privada','segredo fixture']:self.assertNotIn(privado,texto)
                self.assertEqual(arquivos[0].stat().st_mode & 0o777,0o600)

    def test_falha_pre_modelo_e_metrica_indisponivel_nao_repetem_inferencia(self):
        m=carregar('luna_workflows')
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);pasta=base/'isolada';pasta.mkdir()
            with patch.object(m,'BASE',base),patch.object(m,'PASTA',pasta),patch.object(m,'limpar_sessoes',side_effect=[RuntimeError('falha privada'),None]),patch.object(m,'executar') as executar:
                with self.assertRaises(RuntimeError):m.inferir({'tarefa':'resumir','prompt':'fixture'})
                executar.assert_not_called()
            r=json.loads(next((base/'metricas').glob('*.jsonl')).read_text());self.assertEqual(r['execucoesHermes'],0)
            with patch.object(m,'BASE',base),patch.object(m.os,'open',side_effect=OSError('privado')):
                with self.assertLogs(m.__name__,level='WARNING') as logs:m.registrar_inferencia('resumir','2026-10-24',2,1,'ok',5)
                self.assertNotIn('privado',' '.join(logs.output))

    def test_uso_da_tentativa_atual_sanitizado_custo_estimado_e_sem_ultimo_uso_velho(self):
        m=carregar('luna_workflows')
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);pasta=base/'isolada';pasta.mkdir()
            (base/'ultimo-uso.json').write_text(json.dumps({'model':'velho','api_calls':999}))
            def executar(args,*_a,**_kw):
                arquivo=Path(args[args.index('--usage-file')+1])
                arquivo.write_text(json.dumps({'model':'modelo-fixture','provider':'provedor-fixture','api_calls':3,'total_tokens':123,'estimated_cost_usd':0.001,'partial':False,'session_id':'privado-fixture','prompt':'nao-logar'}))
                return 'resumo'
            with patch.object(m,'BASE',base),patch.object(m,'PASTA',pasta),patch.object(m,'limpar_sessoes'),patch.object(m,'executar',side_effect=executar):
                m.inferir({'tarefa':'resumir','prompt':'fixture'})
            texto=next((base/'metricas').glob('*.jsonl')).read_text();r=json.loads(texto)
            self.assertEqual(r['modeloEfetivo'],'modelo-fixture');self.assertEqual(r['chamadasModelo'],3)
            self.assertEqual(r['tokens'],123);self.assertEqual(r['custoEstimadoUsd'],0.001);self.assertIsNone(r['custoUsd'])
            self.assertNotIn('privado-fixture',texto);self.assertNotIn('nao-logar',texto);self.assertNotIn('velho',texto)
            self.assertEqual(list(base.glob('uso-tentativa-*')),[])
            f=base/'invalido.json';f.write_text(json.dumps({'api_calls':True,'total_tokens':-1,'estimated_cost_usd':float('nan'),'provider':'segredo com espaços'}))
            self.assertEqual(m.ler_uso_inferencia(f),{'fonteUso':'hermes_usage_file'})
            f.write_text(json.dumps({'estimated_cost_usd':10**400}))
            self.assertEqual(m.ler_uso_inferencia(f),{})
            f.write_text('['*2000+']'*2000)
            self.assertEqual(m.ler_uso_inferencia(f),{})


if __name__ == '__main__':
    unittest.main()
