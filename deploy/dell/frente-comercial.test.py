import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('frente',Path(__file__).with_name('frente-comercial.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

def lead(id_='site:teste',n='5511998887766'):
    return {'id':id_,'produto':'site','empresa':'Empresa de teste','etapa':'novo','sinal':'pronto','marcos':{},'links':{'whatsapp':'https://wa.me/'+n}}

class Frente(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.r=f.Registro(Path(self.tmp.name)/'r.sqlite');self.addCleanup(self.r.db.close)
        self.now=dt.datetime(2026,10,19,14,tzinfo=dt.timezone.utc)
    def test_nao_contata_conversas_recusas_ou_compromissos(self):
        self.assertTrue(f.elegivel(lead()))
        for change in [{'etapa':'perdido'},{'marcos':{'enviado':f.iso()}},{'conversa':{'mensagens':1}},{'resposta':{'tipo':'negativa'}},{'proximoPasso':{'texto':'aguardar'}},{'sinal':'descartado'}]:
            self.assertFalse(f.elegivel(lead()|change))
    def test_triagem_continua_com_o_romulo(self):
        # `revisar` é a fila de Convidar/Dispensar (Iris, estamparias, prospects): o time só pega o que a Central já liberou.
        for sinal in ['revisar','enviado','so-robo',None]:
            self.assertFalse(f.elegivel(lead()|{'sinal':sinal}),sinal)
        self.assertTrue(f.elegivel(lead()|{'sinal':'pronto'}))
    def test_expediente_e_o_da_central_seg_a_sex_ate_17h30(self):
        sp=lambda y,m,d,h,mi:dt.datetime(y,m,d,h,mi,tzinfo=f.SP)
        dentro=sp(2026,10,19,17,29)   # segunda
        self.assertEqual(f.proximo_expediente(dentro),dentro.astimezone(f.SP))
        depois=f.proximo_expediente(sp(2026,10,19,17,30))
        self.assertEqual((depois.day,depois.hour,depois.minute),(20,8,0))
        sexta=f.proximo_expediente(sp(2026,10,23,17,45))
        self.assertEqual((sexta.day,sexta.hour,sexta.minute),(26,8,0))  # segunda
        antes=f.proximo_expediente(sp(2026,10,19,7,59))
        self.assertEqual((antes.day,antes.hour,antes.minute),(19,8,0))
        sabado=f.proximo_expediente(sp(2026,10,24,10,0))
        self.assertEqual((sabado.day,sabado.hour),(26,8))
    def test_envio_e_registrado_na_central_com_origem_e_sem_derrubar_o_time(self):
        chamadas=[]
        def falso(url,body=None,headers=None,timeout=25):
            chamadas.append((url,body,headers));return {}
        with patch.object(f,'http',falso):
            self.assertTrue(f.registrar_na_central(lead('site:ChIJabc-1_x')))
        self.assertEqual([c[0] for c in chamadas],['http://127.0.0.1:9120/api/operations/crm/venda/primeiro','http://127.0.0.1:9120/api/operations/crm/registro'])
        self.assertEqual(chamadas[0][1],{'leadId':'site:ChIJabc-1_x'})
        self.assertEqual((chamadas[1][1]['produto'],chamadas[1][1]['id'],chamadas[1][1]['tipo']),('site','ChIJabc-1_x','nota'))
        self.assertTrue(all(c[2]=={'Origin':'http://127.0.0.1:9120'} for c in chamadas))
        def quebra(*a,**k): raise OSError('sem rede')
        with patch.object(f,'http',quebra):
            self.assertFalse(f.registrar_na_central(lead()))  # não levanta: o envio já saiu
    def test_numero_nao_vem_de_outro_host_ou_do_modelo(self):
        for uri in ['http://wa.me/5511998887766','https://evil.test/5511998887766','https://wa.me.evil/5511998887766','https://wa.me/1234']:
            self.assertIsNone(f.numero(lead()|{'links':{'whatsapp':uri}}))
    def test_bloqueia_duplicidade_e_resultado_incerto_apos_reinicio(self):
        l=lead();self.assertTrue(self.r.reservar(l,'Olá',self.now));self.assertFalse(self.r.reservar(l,'Olá',self.now))
        novo=f.Registro(Path(self.tmp.name)/'r.sqlite');self.addCleanup(novo.db.close)
        self.assertFalse(novo.reservar(lead('iris:outra','551198887766'),'outra',self.now))
        self.assertEqual(len(novo.incertos()),1)
    def test_hash_ignora_links_de_apresentacao_mas_nao_o_destino(self):
        base=lead();h=f.fingerprint(base)
        for links in [{'convite':'https://wa.me/55?text=a'},{'acoes':'/x'},{'maps':'https://maps.test/1'}]:
            self.assertEqual(f.fingerprint(base|{'links':base['links']|links}),h)
        self.assertNotEqual(f.fingerprint(lead(n='5511998887755')),h)
        self.assertNotEqual(f.fingerprint(base|{'links':base['links']|{'raioX':'https://x.test'}}),h)
    def test_rodada_inteira_envia_um_por_vez_so_pronto_e_registra_na_central(self):
        base=Path(self.tmp.name)
        enviados=[];central=[]
        crm={'estado':'ok','geradoEm':f.iso(),'leads':[
            lead('site:A','5511998887701')|{'triagem':{'prioridade':90}},
            lead('site:B','5511998887702')|{'triagem':{'prioridade':80}},
            lead('iris:C','5511998887703')|{'produto':'iris','sinal':'revisar','triagem':{'prioridade':99}}]}
        def falso_http(url,body=None,headers=None,timeout=25):
            if body is not None: central.append((url.rsplit('/',1)[1],(body or {}).get('leadId') or body.get('id')))
            return {'primeiros':{}}
        def inferir(agente,especialidade,lote,anteriores):
            return {f.pacote(l)['id']:{'nota':85,'decisao':'contatar','motivo':'Boa aderência ao recorte comercial','abordagem':'permissao'} for l in lote}
        def enviar(l,texto,auth):
            enviados.append(l['id']);return 'wamid-'+l['id']
        hora=[dt.datetime(2026,10,19,14,0,tzinfo=dt.timezone.utc)]  # segunda, 11h em São Paulo
        patches=[patch.object(f,'H',base),patch.object(f,'DATA',base/'dados'),patch.object(f,'BASE',base/'time'),
            patch.object(f,'ler_crm',lambda:crm),patch.object(f,'http',falso_http),patch.object(f,'inferir',inferir),
            patch.object(f,'conexao',lambda:{}),patch.object(f,'enviar',enviar),patch.object(f,'agora',lambda:hora[0]),
            patch.object(f,'ler_config',lambda:{'ativo':True})]
        for p in patches:p.start();self.addCleanup(p.stop)
        (base/'time').mkdir();(base/'dados').mkdir()
        f.rodada();self.assertEqual(enviados,['site:A'])           # a de maior nota, uma só
        f.rodada();self.assertEqual(enviados,['site:A'])           # 5 min de intervalo ainda não passaram
        hora[0]+=dt.timedelta(minutes=6)
        f.rodada();self.assertEqual(enviados,['site:A','site:B'])  # `iris:C` (revisar) nunca sai
        hora[0]+=dt.timedelta(minutes=6)
        f.rodada();self.assertEqual(enviados,['site:A','site:B'])
        self.assertEqual(central,[('primeiro','site:A'),('registro','A'),('primeiro','site:B'),('registro','B')])
        hora[0]=dt.datetime(2026,10,19,20,45,tzinfo=dt.timezone.utc)  # 17h45 em São Paulo
        f.rodada();self.assertEqual(len(enviados),2)
    def test_plano_do_dia_nao_troca_depois_de_cada_envio(self):
        self.assertEqual(self.r.plano('2026-10-19',[lead()]),[lead()])
        self.assertEqual(self.r.plano('2026-10-19',[lead('novo')]),[lead()])
    def test_contrato_exige_todos_os_ids_notas_e_decisoes(self):
        a={'id':'a','nota':80,'decisao':'contatar','motivo':'Boa aderência ao recorte','abordagem':'permissao'}
        self.assertEqual(f.validar_avaliacoes(json.dumps([a]),{'a'})['a']['nota'],80)
        for change in [{'nota':True},{'nota':101},{'decisao':'enviar para outro número'},{'id':'b'},{'url':'https://evil.test'}]:
            with self.assertRaises(ValueError):f.validar_avaliacoes(json.dumps([a|change]),{'a'})
        with self.assertRaises(ValueError):f.validar_avaliacoes(json.dumps([a,a]),{'a'})
    def test_modelo_nao_recebe_telefone_url_ou_historico(self):
        s=json.dumps(f.pacote(lead()|{'conversa':{'texto':'privado'},'nicho':'teste 5511998887766'}))
        self.assertNotIn('5511998887766',s);self.assertNotIn('https://',s);self.assertNotIn('privado',s)
    def test_nao_antecipa_expediente_ou_final_de_semana(self):
        for now in [dt.datetime(2026,10,18,20,tzinfo=dt.timezone.utc),dt.datetime(2026,10,19,10,tzinfo=dt.timezone.utc)]:
            self.assertEqual(f.proximo_expediente(now).isoformat(),'2026-10-19T08:00:00-03:00')
        self.assertEqual(f.proximo_expediente(self.now),self.now)
    def test_ritmo_compartilhado_com_envios_manuais(self):
        crm={'leads':[lead()]}
        self.assertTrue(f.ritmo(crm,self.r,self.now)[0])
        self.assertFalse(f.ritmo(crm,self.r,self.now,{'site:teste':self.now.timestamp()*1000})[0])
        self.r.reservar(lead(),'Olá',self.now)
        self.assertFalse(f.ritmo(crm,self.r,self.now)[0])
        self.assertTrue(f.ritmo(crm,self.r,self.now+dt.timedelta(seconds=300))[0])
    def test_cem_por_dia_inclui_incerto_e_reinicio(self):
        for i in range(100):self.assertTrue(self.r.reservar(lead(str(i),'55119'+str(10000000+i)),'Olá',self.now-dt.timedelta(seconds=i*100)))
        self.assertFalse(f.ritmo({'leads':[]},self.r,self.now)[0])
    def test_teto_por_hora(self):
        for i in range(12):self.r.reservar(lead(str(i),'55119'+str(10000000+i)),'Olá',self.now-dt.timedelta(seconds=301+i*250))
        self.assertFalse(f.ritmo({'leads':[]},self.r,self.now)[0])
    def test_uma_tentativa_de_envio_sem_retry_e_destinatario_confirmado(self):
        with patch.object(f,'http',return_value={'key':{'id':'ok','fromMe':True,'remoteJid':'5511998887766@s.whatsapp.net'}}) as request:
            self.assertEqual(f.enviar(lead(),'Olá',{'apikey':'fake'}),'ok');self.assertEqual(request.call_count,1)
        with patch.object(f,'http',return_value={'key':{'id':'errado','fromMe':True,'remoteJid':'5521998887766@s.whatsapp.net'}}):
            with self.assertRaises(RuntimeError):f.enviar(lead(),'Olá',{'apikey':'fake'})
    def test_texto_sem_link_preco_ou_afirmacao_de_envio(self):
        for produto in ['site','prumo','iris','estampa']:
            text=f.mensagem(lead()|{'produto':produto},'permissao')
            self.assertNotIn('https://',text);self.assertNotIn('R$',text);self.assertIn('Posso falar',text);self.assertIn('sem problema',text)
            self.assertNotIn('Empresa de teste',text);self.assertLess(len(text),300)
    def test_limite_de_inferencia_inclui_tentativas_sem_resposta(self):
        for _ in range(f.MAX_IA):self.r.consumir_ia('2026-10-19')
        with self.assertRaises(RuntimeError):self.r.consumir_ia('2026-10-19')
    def test_rodada_completa_avalia_tres_agentes_envia_uma_vez_e_observa(self):
        states=[];crm={'estado':'ok','leads':[lead()]}
        def avaliar(_a,_e,lote,_ant):
            return {f.pacote(l)['id']:{'id':f.pacote(l)['id'],'nota':80,'decisao':'contatar','motivo':'Aderência confirmada ao recorte','abordagem':'permissao'} for l in lote}
        with patch.object(f,'BASE',Path(self.tmp.name)/'base'),patch.object(f,'H',Path(self.tmp.name)),patch.object(f,'ler_crm',return_value=crm),patch.object(f,'agora',return_value=self.now),patch.object(f,'ler_config',return_value={'ativo':True}),patch.object(f,'inferir',side_effect=avaliar) as ai,patch.object(f,'http',return_value={'primeiros':{}}),patch.object(f,'conexao',return_value={'apikey':'fake'}),patch.object(f,'enviar',return_value='id-real-da-integracao') as envio,patch.object(f,'gravar',side_effect=lambda s:states.append(json.loads(json.dumps(s)))):
            f.rodada();f.rodada()
            self.assertEqual(ai.call_count,3);self.assertEqual(envio.call_count,1)
            self.assertEqual(states[-1]['enviados'],1);self.assertEqual(states[-1]['fila'][0]['estado'],'enviado')
    def test_pausa_nao_avalia_nem_envia(self):
        with patch.object(f,'BASE',Path(self.tmp.name)/'base'),patch.object(f,'H',Path(self.tmp.name)),patch.object(f,'ler_crm',return_value={'leads':[]}),patch.object(f,'ler_config',return_value={'ativo':False}),patch.object(f,'inferir') as ai,patch.object(f,'enviar') as envio,patch.object(f,'gravar'):
            f.rodada();ai.assert_not_called();envio.assert_not_called()
    def test_pausa_preserva_as_avaliacoes_e_a_fila_do_mesmo_dia(self):
        data=Path(self.tmp.name)/'data';data.mkdir()
        (data/'frente-comercial.json').write_text(json.dumps({'dia':'2026-10-19','avaliados':200,'selecionados':100,'fila':[{'id':'site:teste'}]}))
        estados=[]
        with patch.object(f,'BASE',Path(self.tmp.name)/'base'),patch.object(f,'H',Path(self.tmp.name)),patch.object(f,'DATA',data),patch.object(f,'ler_crm',return_value={'leads':[]}),patch.object(f,'agora',return_value=self.now),patch.object(f,'ler_config',return_value={'ativo':False}),patch.object(f,'gravar',side_effect=lambda s:estados.append(s.copy())):
            f.rodada()
        self.assertEqual(estados[-1]['estado'],'pausado');self.assertEqual(estados[-1]['avaliados'],200);self.assertEqual(estados[-1]['selecionados'],100);self.assertEqual(len(estados[-1]['fila']),1)

if __name__=='__main__':unittest.main()
