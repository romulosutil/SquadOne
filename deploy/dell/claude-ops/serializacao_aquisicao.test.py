"""Grafo aguardado/geradores, sem rede, modelo ou workflows reais."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import io
import os
import unittest
from unittest.mock import patch
import serializacao_aquisicao as s
import workflow_confiabilidade as reliable
import prumo_contexto as pc

BASE=Path(__file__).resolve().parent
def fixture_utf8(value):
    if isinstance(value,dict):return {fixture_utf8(k):fixture_utf8(v) for k,v in value.items()}
    if isinstance(value,list):return [fixture_utf8(v) for v in value]
    if isinstance(value,str):
        try:
            child=json.loads(value)
            if isinstance(child,dict) and 'nodes' in child:return json.dumps(fixture_utf8(child),ensure_ascii=False)
        except (ValueError,TypeError):pass
        try:return value.encode('latin1').decode('utf-8')
        except (UnicodeError,ValueError):return value
    return value

CFG={'v':1,'enabled':True,'url':'http://172.23.0.1:8791','credentialId':'fixture-only','credentialName':'Guarda fixture'}
CTX={'versao':1,'organizacao_sha256':'fixture-hash','origem':'fixture-only','organizacao':'Fixture sem cliente'}


def normalized(wf):
    v=copy.deepcopy(wf);v['nodes']=sorted(v['nodes'],key=lambda n:n['name'])
    return v


class Transformacao(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();home=Path(cls.tmp.name);f=home/'.config/claude-ops/n8n-api-key';f.parent.mkdir(parents=True);f.write_text('fixture-no-network')
        with patch.object(Path,'home',return_value=home):
            spec=importlib.util.spec_from_file_location('aquisicao_factory_fixture',BASE/'prumo-ofertas.py');cls.factory=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.factory)
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def workflows(self):
        raw=json.loads((BASE.parents[2]/'ops/n8n/workflows/01-Cacador.sanitizado.json').read_text());site=fixture_utf8(raw[0] if isinstance(raw,list) else raw)
        site=reliable.preparar(site);site['active']=True
        # Um caçador por oferta do JSON (28/10/2026: a guarda vale para todas, não só Iris e estampa).
        ids=list(self.factory.CONFIG['ofertas']);gids={k:101+i for i,k in enumerate(ids)}
        ofertas=[self.factory.cacador(k,gids,101+len(ids),'fixture-error') for k in ids]
        for w in ofertas:w['active']=False
        for w in [site,*ofertas]:
            w['settings']['callerPolicy']='workflowsFromAList';w['settings']['callerIds']='fixture-caller'
        return [site,*ofertas]
    def test_tres_grafos_preservam_criterios_gatilhos_settings_estados_e_idempotencia(self):
        for wf in self.workflows():
            with self.subTest(wf=wf['name']):
                raw=pc.preparar(wf,CTX);before=copy.deepcopy(raw);out=s.preparar(raw,CFG)
                self.assertEqual(raw,before);self.assertEqual(normalized(s.desembrulhar(out)),normalized(raw))
                self.assertEqual(out['active'],raw['active']);self.assertEqual(out['settings'],raw['settings'])
                self.assertEqual(s.preparar(out,CFG),out)
                self.assertTrue(s.protegido(out));own={n['name']:n for n in out['nodes'] if n['id'].startswith(s.PREFIXO)}
                self.assertEqual(set(own),{s.CLAIM,s.IF,s.CORE,s.RELEASE})
                self.assertTrue(own[s.CORE]['parameters']['options']['waitForSubWorkflow']);self.assertTrue(own[s.CORE]['alwaysOutputData'])
                self.assertEqual(out['connections'][s.IF]['main'][1],[])
                self.assertEqual(out['connections'][s.CORE],s.destinos(s.RELEASE))
                self.assertFalse(own[s.CLAIM]['retryOnFail']);self.assertFalse(own[s.RELEASE]['retryOnFail'])
                self.assertNotIn('onError',own[s.CORE])
    def test_contexto_prumo_permanece_atualizavel_sem_contextos_duplicados(self):
        for w in self.workflows():
            raw=pc.preparar(w,CTX);out=s.preparar(raw,CFG);nextctx={**CTX,'organizacao_sha256':'new-fixture-hash'}
            updated=pc.preparar(out,nextctx)
            self.assertEqual(normalized(s.desembrulhar(updated)),normalized(pc.preparar(raw,nextctx)))
            # O sincronizador reconhece o contexto do trigger inline pelo ID padrão.
            child=json.loads(next(n for n in updated['nodes'] if n['name']==s.CORE)['parameters']['workflowJson'])
            self.assertEqual(sum(n['name']==s.CONTEXTO for n in child['nodes']),1)
            self.assertEqual(s.preparar(updated,CFG),s.preparar(s.desembrulhar(updated),CFG))
    def test_gatilho_sem_configuracao_ou_payload_invalido_nao_remove_guarda(self):
        w=self.workflows()[1];out=s.preparar(w,CFG)
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'missing.json'
            with self.assertRaises(ValueError):s.preparar_se_configurado(out,arquivo=p)
            with self.assertRaises(ValueError):s.preparar_se_configurado(w,obrigatoria=True,arquivo=p)
            p.write_text('{bad')
            with self.assertRaises(ValueError):s.preparar_se_configurado(w,arquivo=p)
        for key,value in [('enabled',False),('url','http://example.invalid'),('credentialId','../bad')]:
            with self.assertRaises(ValueError):s.preparar(w,{**CFG,key:value})
    def test_outros_dominios_nao_leem_configuracao_nem_recebem_nos(self):
        other={'name':'Agenda','nodes':[],'connections':{},'active':True}
        self.assertEqual(s.preparar(other,{}),other)
        self.assertIs(s.preparar_se_configurado(other,arquivo=Path('/missing')),other)
    def test_editor_site_consegue_desembrulhar_os_dois_niveis(self):
        site=self.workflows()[0];out=s.preparar(site,CFG);edit=reliable.desembrulhar(out)
        self.assertIn('Dentro do raio',{n['name'] for n in edit['nodes']})
        self.assertNotIn(s.CORE,{n['name'] for n in edit['nodes']})
        rebuilt=s.preparar(reliable.preparar(edit),CFG)
        self.assertTrue(s.protegido(rebuilt));self.assertEqual(rebuilt['active'],site['active'])
    def test_publicador_reaplica_guarda_depois_dos_hooks_e_recusa_remocao(self):
        import n8n
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);config=home/'.config/claude-ops';config.mkdir(parents=True)
            (config/'workflow-aquisicao.json').write_text(json.dumps(CFG))
            (home/'prumo/00-contexto').mkdir(parents=True);(home/'prumo/06-qualidade').mkdir(parents=True)
            (home/'prumo/00-contexto/organizacao.md').write_text('Fixture')
            (home/'prumo/06-qualidade/catalogo.json').write_text(json.dumps({'familias':{},'produtos':[]}))
            sent=[]
            def transport(req,**kwargs):
                sent.append(json.loads(req.data));return io.BytesIO(b'{}')
            with patch.object(Path,'home',return_value=home),patch.dict(os.environ,{'PRUMO_REPO':str(home/'prumo')}),patch.object(n8n.urllib.request,'urlopen',side_effect=transport):
                for wf in self.workflows():
                    n8n.api('PUT','/workflows/fixture',wf)
                    self.assertTrue(s.protegido(sent[-1]));self.assertEqual(sent[-1]['active'],wf['active'])
                    self.assertEqual(sent[-1]['settings']['callerIds'],'fixture-caller')
                guarded=sent[-1]
                (config/'workflow-aquisicao.json').unlink();before=len(sent)
                with self.assertRaises(ValueError):n8n.api('PUT','/workflows/fixture',guarded)
                self.assertEqual(len(sent),before)

    def test_clones_manuais_nao_contornam_guarda_pela_troca_de_nome(self):
        for w in self.workflows():
            clone=copy.deepcopy(w);clone['name']='ZZ busca escolhida: '+w['name']+' (apagar)'
            with self.assertRaises(ValueError):s.preparar_se_configurado(clone,arquivo='/missing')
            wrapped=s.preparar(w,CFG);wrapped['name']='ZZ rodar agora: '+w['name']
            with self.assertRaises(ValueError):s.desembrulhar(wrapped)
    def test_espera_assincrona_ou_persistencia_tolerante_sao_recusadas(self):
        w=self.workflows()[1]
        for extra in [
            {'id':'wait','name':'Wait fixture','type':'n8n-nodes-base.wait','parameters':{}},
            {'id':'async','name':'Async fixture','type':'n8n-nodes-base.executeWorkflow','parameters':{'options':{'waitForSubWorkflow':False}}},
            {'id':'write','name':'Write fixture','type':'n8n-nodes-base.googleSheets','onError':'continueRegularOutput','parameters':{'operation':'appendOrUpdate'}}]:
            candidate=copy.deepcopy(w);candidate['nodes'].append(extra)
            with self.assertRaises(ValueError):s.preparar(candidate,CFG)
    def test_ramos_e_ausencia_de_itens_ficam_dentro_da_chamada_aguardada(self):
        # A liberação não é ligada a um ramo Sheets: fica exclusivamente fora do
        # subworkflow completo. A saída vazia do filho também produz o recibo.
        for w in self.workflows():
            out=s.preparar(w,CFG);caller=next(n for n in out['nodes'] if n['name']==s.CORE)
            child=json.loads(caller['parameters']['workflowJson']);names={n['name'] for n in child['nodes']}
            if w['name']!='01 · Caçador':
                self.assertIn('Gravar em Descartados',names)
                self.assertIn('É prospect?',names)
            self.assertNotIn(s.RELEASE,names)
            incoming=[source for source,v in out['connections'].items() for outtype in v.values() for branch in outtype for d in branch if d['node']==s.RELEASE]
            self.assertEqual(incoming,[s.CORE]);self.assertTrue(caller['alwaysOutputData'])


if __name__=='__main__':unittest.main()