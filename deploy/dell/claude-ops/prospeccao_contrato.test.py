"""Oferta inteiramente fictícia na fábrica real; sem ativação/HTTP/Sheets/modelos."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import prospeccao_contrato as c


class Prospeccao(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        home = Path(cls.tmp.name); key = home/'.config/claude-ops/n8n-api-key'
        key.parent.mkdir(parents=True); key.write_text('fixture-sem-acesso')
        with patch.object(Path, 'home', return_value=home):
            spec = importlib.util.spec_from_file_location('ofertas_fase5_fixture', Path(__file__).with_name('prumo-ofertas.py'))
            cls.factory = importlib.util.module_from_spec(spec); spec.loader.exec_module(cls.factory)
        cls.config_original = copy.deepcopy(cls.factory.CONFIG)

    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()

    def tearDown(self): self.factory.CONFIG = copy.deepcopy(self.config_original)

    def terceira(self):
        cfg = copy.deepcopy(self.config_original)
        oferta = copy.deepcopy(cfg['ofertas']['iris'])
        oferta.update(rotulo='Oferta sintética',aba='Sintéticos',fluxo='HOMOLOGAÇÃO · Oferta sintética',
                      convite='fixture-sem-publicacao',clique='HOMOLOGAÇÃO · Convite sintético',
                      segmento='clinica',perfil='comprovacao-sintetica',sinais=[['teste','comprovacao-sintetica']],
                      nichos=['clínica de teste'],cidades=['Cidade Sintética'],teto_por_rodada=2,
                      mensagem='{OLA}! Aqui é do Prumo. Consigo falar com quem coordena a {NOME}?')
        cfg['ofertas']['fixture'] = oferta
        self.factory.CONFIG = cfg
        return cfg

    def test_terceira_oferta_usa_mesma_fabrica_criterios_leitores_e_persistencia_sem_workflow_copiado(self):
        cfg = self.terceira(); antes = copy.deepcopy(cfg)
        gids={'iris':101,'estampa':102,'fixture':103}
        assinatura=None
        for oferta in cfg['ofertas']:
            contract=c.contrato_oferta(cfg,oferta)
            wf=self.factory.cacador(oferta,gids,104,'erro-fixture')
            out=c.auditar_adaptador(wf,contract)
            self.assertTrue(out['componentesPresentes']); self.assertTrue(out['geracaoCompleta'])
            self.assertFalse(out['ativacaoAutorizada']); self.assertNotIn('active',wf)
            por={n['name']:n for n in wf['nodes']}
            for nome in contract['leiturasDedupe']:
                self.assertIn(nome,por); self.assertEqual(por[nome]['parameters']['operation'],'read')
            self.assertEqual(por[f"Gravar na aba {cfg['ofertas'][oferta]['aba']}"]['parameters']['sheetName']['value'],str(gids[oferta]))
            self.assertEqual(por['Gravar em Descartados']['parameters']['sheetName']['value'],'104')
            self.assertEqual(por['Buscar no Google Places']['parameters']['options']['pagination']['pagination']['maxRequests'],3)
            js=por['Triar e checar sites']['parameters']['jsCode']
            constante=next(line for line in js.splitlines() if line.startswith('const CONFIG = '))
            configuracao=json.loads(constante[len('const CONFIG = '):-1])
            self.assertEqual(configuracao['perfil'],cfg['ofertas'][oferta]['perfil'])
            self.assertEqual(configuracao['leitores'],contract['leiturasDedupe'])
            comum=js.replace(constante,'const CONFIG = __CONFIG__;')
            if assinatura is None: assinatura=comum
            else: self.assertEqual(comum,assinatura)
            self.assertIn('leitura-dedupe-tolerante',out['riscosLegados'])
            self.assertIn('persistencia-com-retry-requer-recibo',out['riscosLegados'])
        self.assertEqual(cfg,antes)
        on_disk=json.loads(Path(__file__).with_name('prumo-ofertas.json').read_text(encoding='utf-8'))
        self.assertEqual(on_disk,self.config_original)
        self.assertNotIn('fixture',on_disk['ofertas'])

    def test_triagem_real_terceira_oferta_identifica_deduplica_e_preserva_descartes_sem_http(self):
        cfg=self.terceira(); o=cfg['ofertas']['fixture']; contrato=c.contrato_oferta(cfg,'fixture')
        codigo=self.factory.triar_js('fixture',o,contrato['leiturasDedupe'])
        codigo=codigo.replace('const agora = new Date().toISOString();','const agora = "2026-10-24T12:00:00Z";')
        def place(id_,phone):
            return {'id':id_,'displayName':{'text':'Clínica comprovacao-sintetica'},
                    'primaryTypeDisplayName':{'text':'Clínica de teste'},'nationalPhoneNumber':phone}
        nodes={n:[{'json':{}}] for n in contrato['leiturasDedupe']}
        nodes['Ler Clínicas']=[{'json':{'ID':'existente-sintetico','Empresa':'Fixture'}}]
        nodes['Ler Estamparias']=[{'json':{'WhatsApp':'(11) 90000-0002','Empresa':'Fixture contato'}}]
        nodes['Escolher a busca']=[{'json':{'query':'clínica de teste em Cidade Sintética','cidade':'Cidade Sintética','nicho':'clínica de teste'}}]
        nodes['Buscar no Google Places']=[{'json':{'places':[place('existente-sintetico','11900000001'),place('novo-sintetico','11900000000')]}},
                                         {'json':{'places':[place('novo-sintetico','11900000000'),place('unidade-sintetica','11900000000'),place('contato-existente','11900000002')]}}]
        source='const nodes='+json.dumps(nodes,ensure_ascii=False)+';const $=n=>({all:()=>nodes[n],first:()=>nodes[n][0]});let http=0;'+(
            'const result=await(async function(){'+codigo+'}).call({helpers:{httpRequest:async()=>{http++;throw Error("HTTP proibido")}}});'
            'console.log(JSON.stringify({http,result}));')
        r=subprocess.run([shutil.which('node') or 'node','--input-type=module'],input=source,capture_output=True,text=True,encoding='utf-8',timeout=15)
        self.assertEqual(r.returncode,0,r.stderr)
        out=json.loads(r.stdout);self.assertEqual(out['http'],0)
        prospects=[i['json'] for i in out['result'] if i['json']['_tipo']=='prospect']
        descartes=[i['json'] for i in out['result'] if i['json']['_tipo']=='descarte']
        self.assertEqual([p['ID'] for p in prospects],['novo-sintetico'])
        self.assertEqual({p['ID'] for p in descartes},{'unidade-sintetica','contato-existente'})
        self.assertEqual(prospects[0]['Etapa'],'Revisar')
        self.assertIn('não confirmado',prospects[0]['Origem do WhatsApp'])
        self.assertTrue(all(p['Motivo'].startswith('Oferta sintética:') for p in descartes))

    def test_config_incompleta_duplicada_ou_sem_limite_falha_sem_alterar_origem(self):
        for change in [lambda x:x['ofertas']['iris'].pop('perfil'),lambda x:x['ofertas']['iris'].update(teto_por_rodada=True),
                       lambda x:x['ofertas']['iris'].update(cidades=[]),lambda x:x['ofertas']['iris'].update(aba=x['ofertas']['estampa']['aba']),
                       lambda x:x['colunas'].remove('ID')]:
            cfg=copy.deepcopy(self.config_original);change(cfg);antes=copy.deepcopy(cfg)
            with self.assertRaises(ValueError):c.contrato_oferta(cfg,'iris')
            self.assertEqual(cfg,antes)

    def test_site_e_adaptador_legado_explicito_e_nunca_fabrica_inventada(self):
        contract=c.contrato_site_legado();self.assertFalse(contract['geracaoCompleta'])
        nodes=[]
        nomes={n for ns in contract['etapas'].values() for n in ns}|set(contract['leiturasDedupe'])
        for nome in sorted(nomes):
            n={'id':nome,'name':nome,'type':'n8n-nodes-base.code','parameters':{}}
            if nome in contract['leiturasDedupe']:n.update(type='n8n-nodes-base.googleSheets',parameters={'operation':'read'})
            elif nome in contract['etapas']['persistencia']:
                arquivo=nome.startswith('Entregar ')
                n.update(type='n8n-nodes-base.readWriteFile' if arquivo else 'n8n-nodes-base.googleSheets',parameters={'operation':'write' if arquivo else 'append'})
            elif nome=='Buscar no Google Places':n.update(type='n8n-nodes-base.httpRequest',parameters={'url':'https://places.googleapis.com/v1/places:searchText'})
            nodes.append(n)
        # Contrato atravessa inline; não reescreve nem perde o export legado.
        wf={'name':'01 · Caçador','active':False,'nodes':[{'name':'Concluir processamento da busca','parameters':{'workflowJson':json.dumps({'nodes':nodes})}}]}
        before=copy.deepcopy(wf);r=c.auditar_adaptador(wf,contract)
        self.assertEqual(wf,before);self.assertFalse(r['geracaoCompleta']);self.assertFalse(r['ativacaoAutorizada'])
        nodes=[n for n in nodes if n['name']!='Checar site próprio']
        wf['nodes'][0]['parameters']['workflowJson']=json.dumps({'nodes':nodes})
        with self.assertRaises(ValueError):c.auditar_adaptador(wf,contract)

    def test_fonte_dedupe_ou_persistencia_trocada_nao_passa_auditoria(self):
        cfg=self.config_original;contract=c.contrato_oferta(cfg,'iris')
        for name in ['Ler Clínicas','Gravar na aba Clínicas']:
            wf=self.factory.cacador('iris',{'iris':101,'estampa':102},104,'erro-fixture')
            next(n for n in wf['nodes'] if n['name']==name)['parameters']['operation']='update'
            with self.assertRaises(ValueError):c.auditar_adaptador(wf,contract)


if __name__=='__main__':unittest.main()
