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
        # Nomes no padrão que o contrato exige desde 28/10/2026 (convite-<id>, PRUMO no começo, UUID próprio).
        oferta.update(rotulo='Oferta sintética',sigla='Sintética',aba='Sintéticos',sala='prumo--fixture',link_retrato='planilhaFixture',
                      cacador_rotulo='Encontrado pelo Caçador sintético',fonte='PRUMO — Sintéticos (fixture)',
                      fluxo='PRUMO · Oferta sintética — Caçador de testes',webhook_id='00000000-0000-4000-8000-00000000f1c7',
                      convite='convite-fixture',clique='PRUMO · Oferta sintética — Clique em Enviar convite',
                      segmento='clinica',perfil='comprovacao-sintetica',sinais=[['teste','comprovacao-sintetica']],
                      nichos=['clínica de teste'],cidades=['Cidade Sintética'],teto_por_rodada=2,
                      mensagem='{OLA}! Aqui é do Prumo. Consigo falar com quem coordena a {NOME}?')
        cfg['ofertas']['fixture'] = oferta
        self.factory.CONFIG = cfg
        return cfg

    @staticmethod
    def gids(cfg):
        """Uma aba por oferta do JSON (101, 102...) e Descartados logo depois: nada de lista escrita."""
        return {k: 101 + i for i, k in enumerate(cfg['ofertas'])}, 101 + len(cfg['ofertas'])

    def test_terceira_oferta_usa_mesma_fabrica_criterios_leitores_e_persistencia_sem_workflow_copiado(self):
        cfg = self.terceira(); antes = copy.deepcopy(cfg)
        gids, descartados = self.gids(cfg)
        assinatura=None
        for oferta in cfg['ofertas']:
            contract=c.contrato_oferta(cfg,oferta)
            wf=self.factory.cacador(oferta,gids,descartados,'erro-fixture')
            out=c.auditar_adaptador(wf,contract)
            self.assertTrue(out['componentesPresentes']); self.assertTrue(out['geracaoCompleta'])
            self.assertFalse(out['ativacaoAutorizada']); self.assertNotIn('active',wf)
            por={n['name']:n for n in wf['nodes']}
            for nome in contract['leiturasDedupe']:
                self.assertIn(nome,por); self.assertEqual(por[nome]['parameters']['operation'],'read')
            self.assertEqual(por[f"Gravar na aba {cfg['ofertas'][oferta]['aba']}"]['parameters']['sheetName']['value'],str(gids[oferta]))
            self.assertEqual(por['Gravar em Descartados']['parameters']['sheetName']['value'],str(descartados))
            self.assertEqual(por['Buscar no Google Places']['parameters']['options']['pagination']['pagination']['maxRequests'],3)
            js=por['Triar e checar sites']['parameters']['jsCode']
            constante=next(line for line in js.splitlines() if line.startswith('const CONFIG = '))
            configuracao=json.loads(constante[len('const CONFIG = '):-1])
            self.assertEqual(configuracao['perfil'],cfg['ofertas'][oferta]['perfil'])
            self.assertEqual(configuracao['leitores'],contract['leiturasDedupe'])
            comum=js.replace(constante,'const CONFIG = __CONFIG__;')
            if assinatura is None: assinatura=comum
            else: self.assertEqual(comum,assinatura)
            # Desde 24/10/2026 (PRUMO-ENCERRAMENTO-TECNICO): leitura de dedupe falha fechada e a
            # gravação é upsert pelo ID, sem repetição automática; sobra só a concorrência do Sheets.
            self.assertNotIn('leitura-dedupe-tolerante',out['riscosLegados'])
            self.assertNotIn('persistencia-com-retry-requer-recibo',out['riscosLegados'])
            self.assertIn('concorrencia-google-sheets-upsert',out['riscosLegados'])
            for nome in contract['leiturasDedupe']:
                self.assertNotIn('onError',por[nome])
            gravar=por[f"Gravar na aba {cfg['ofertas'][oferta]['aba']}"]
            self.assertEqual(gravar['parameters']['operation'],'appendOrUpdate')
            self.assertEqual(gravar['parameters']['columns']['matchingColumns'],['ID'])
            self.assertFalse(gravar.get('retryOnFail'))
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
        # As duas primeiras abas reais do JSON (depois da própria): o dedupe vale contra qualquer oferta.
        outra1,outra2=contrato['leiturasDedupe'][1:3]
        nodes[outra1]=[{'json':{'ID':'existente-sintetico','Empresa':'Fixture'}}]
        nodes[outra2]=[{'json':{'WhatsApp':'(11) 90000-0002','Empresa':'Fixture contato'}}]
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

    def test_contrato_confere_nomes_webhook_e_campos_do_registro(self):
        """28/10/2026: o que prumo-ofertas.py, crm.py, whatsapp-conversa.py e a Central usam de cada oferta."""
        for oferta in self.config_original['ofertas']:
            c.contrato_oferta(self.config_original, oferta)  # as ofertas reais passam
        outra = lambda x: [k for k in x['ofertas'] if k != 'iris'][0]
        mudancas = {
            'webhook repetido': lambda x: x['ofertas']['iris'].update(webhook_id=x['ofertas'][outra(x)]['webhook_id']),
            'webhook fora do formato': lambda x: x['ofertas']['iris'].update(webhook_id='nao-e-uuid'),
            'convite fora do padrão': lambda x: x['ofertas']['iris'].update(convite='convite-clinicas'),
            'clique sem PRUMO': lambda x: x['ofertas']['iris'].update(clique='Iris — Clique em Enviar convite'),
            'fluxo sem PRUMO': lambda x: x['ofertas']['iris'].update(fluxo='Iris — Caçador'),
            'clique repetido': lambda x: x['ofertas']['iris'].update(clique=x['ofertas'][outra(x)]['clique']),
            'clique igual ao fluxo': lambda x: x['ofertas']['iris'].update(clique=x['ofertas']['iris']['fluxo']),
            'sem empresa': lambda x: x['ofertas']['iris'].pop('empresa'),
            'sem sigla': lambda x: x['ofertas']['iris'].update(sigla=' '),
            'tipo desconhecido': lambda x: x['ofertas']['iris'].update(tipo='consultoria'),
            'sala fora do formato': lambda x: x['ofertas']['iris'].update(sala='iris'),
            'sala repetida': lambda x: x['ofertas']['iris'].update(sala=x['ofertas'][outra(x)]['sala']),
            'link do PRUMO': lambda x: x['ofertas']['iris'].update(link_retrato='planilhaPrumo'),
            'link fora do formato': lambda x: x['ofertas']['iris'].update(link_retrato='iris'),
            'sem cacador_rotulo': lambda x: x['ofertas']['iris'].pop('cacador_rotulo'),
            'sem fonte': lambda x: x['ofertas']['iris'].pop('fonte'),
            'sem conversa': lambda x: x['ofertas']['iris'].pop('conversa'),
            'conversa sem interesse': lambda x: x['ofertas']['iris']['conversa'].pop('interesse'),
            'aba do PRUMO': lambda x: x['ofertas']['iris'].update(aba='Prospects'),
            'aba com aspas': lambda x: x['ofertas']['iris'].update(aba="Clínica's"),
        }
        for nome, change in mudancas.items():
            with self.subTest(nome):
                cfg=copy.deepcopy(self.config_original);change(cfg);antes=copy.deepcopy(cfg)
                with self.assertRaises(ValueError):c.contrato_oferta(cfg,'iris')
                self.assertEqual(cfg,antes)
        for oferta_id in ('site', 'plus', 'registros', 'const', 'Iris', 'ab', 'oferta_nova'):
            with self.subTest(oferta_id):
                cfg=copy.deepcopy(self.config_original)
                bloco=copy.deepcopy(cfg['ofertas']['iris']);cfg['ofertas']={oferta_id:bloco}
                bloco['convite']='convite-'+oferta_id
                with self.assertRaises(ValueError):c.contrato_oferta(cfg,oferta_id)

    def test_site_e_adaptador_legado_explicito_e_nunca_fabrica_inventada(self):
        contract=c.contrato_site_legado();self.assertFalse(contract['geracaoCompleta'])
        nodes=[]
        nomes={n for ns in contract['etapas'].values() for n in ns}|set(contract['leiturasDedupe'])
        for nome in sorted(nomes):
            n={'id':nome,'name':nome,'type':'n8n-nodes-base.code','parameters':{}}
            if nome in contract['leiturasDedupe']:n.update(type='n8n-nodes-base.googleSheets',parameters={'operation':'read'})
            elif nome in contract['etapas']['persistencia']:
                arquivo=nome.startswith('Entregar ')
                if arquivo:n.update(type='n8n-nodes-base.readWriteFile',parameters={'operation':'write'})
                else:
                    # Upsert pela identidade durável do Site (place_id), sem retryOnFail.
                    n.update(type='n8n-nodes-base.googleSheets',parameters={'operation':'appendOrUpdate','columns':{
                        'matchingColumns':['place_id'],'schema':[{'id':'place_id','canBeUsedToMatch':True}]}})
            elif nome=='Buscar no Google Places':n.update(type='n8n-nodes-base.httpRequest',parameters={'url':'https://places.googleapis.com/v1/places:searchText'})
            nodes.append(n)
        # Contrato atravessa inline; não reescreve nem perde o export legado.
        wf={'name':'01 · Caçador','active':False,'nodes':[{'name':'Concluir processamento da busca','parameters':{'workflowJson':json.dumps({'nodes':nodes})}}]}
        before=copy.deepcopy(wf);r=c.auditar_adaptador(wf,contract)
        self.assertEqual(wf,before);self.assertFalse(r['geracaoCompleta']);self.assertFalse(r['ativacaoAutorizada'])
        self.assertEqual(r['riscosLegados'],['concorrencia-google-sheets-upsert'])
        nodes=[n for n in nodes if n['name']!='Checar site próprio']
        wf['nodes'][0]['parameters']['workflowJson']=json.dumps({'nodes':nodes})
        with self.assertRaises(ValueError):c.auditar_adaptador(wf,contract)

    def test_fonte_dedupe_ou_persistencia_trocada_nao_passa_auditoria(self):
        cfg=self.config_original;contract=c.contrato_oferta(cfg,'iris')
        for name in ['Ler Clínicas','Gravar na aba Clínicas']:
            wf=self.factory.cacador('iris',*self.gids(cfg),'erro-fixture')
            next(n for n in wf['nodes'] if n['name']==name)['parameters']['operation']='update'
            with self.assertRaises(ValueError):c.auditar_adaptador(wf,contract)


if __name__=='__main__':unittest.main()
