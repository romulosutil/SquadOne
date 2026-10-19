import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
import urllib.error
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('frente',Path(__file__).with_name('frente-comercial.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

MSG='Olá! Vi que a Empresa de teste ainda não tem site. Fiz uma prévia, posso mandar?'

def lead(id_='site:teste',n='5511998887766'):
    return {'id':id_,'produto':'site','empresa':'Empresa de teste','etapa':'novo','sinal':'pronto','marcos':{},'mensagemPronta':MSG,
            'links':{'whatsapp':'https://wa.me/'+n,'enviar':'https://dell.test/webhook/enviar?place_id='+id_.partition(':')[2]}}

def avaliar(_a,_e,lote,_ant):
    return {f.pacote(l)['id']:{'id':f.pacote(l)['id'],'nota':80,'decisao':'contatar','motivo':'Aderência confirmada ao recorte'} for l in lote}

class Redirecionar:
    """O opener sem redirecionamento: o n8n responde 302 para o wa.me guardado."""
    def __init__(self,location,code=302):self.location,self.code,self.urls=location,code,[]
    def open(self,req,timeout=None):
        self.urls.append(req.full_url)
        raise urllib.error.HTTPError(req.full_url,self.code,'Found',{'Location':self.location},io.BytesIO(b''))

class Frente(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.r=f.Registro(Path(self.tmp.name)/'r.sqlite');self.addCleanup(self.r.db.close)
        self.now=dt.datetime(2026,10,19,14,tzinfo=dt.timezone.utc)
        self.data=Path(self.tmp.name)/'data';self.data.mkdir()

    def rodar(self,crm,reserva,primeiros=None,marcar=None,vezes=1):
        """Uma rodada com tudo de fora dublado; nunca o disco, a Central, o n8n ou o WhatsApp de verdade."""
        estados=[]
        with patch.object(f,'BASE',Path(self.tmp.name)/'base'),patch.object(f,'H',Path(self.tmp.name)),patch.object(f,'DATA',self.data),\
             patch.object(f,'ler_crm',return_value=crm),patch.object(f,'agora',return_value=self.now),patch.object(f,'ler_config',return_value={'ativo':True}),\
             patch.object(f,'inferir',side_effect=avaliar) as ai,patch.object(f,'http',return_value={'primeiros':primeiros or {}}),\
             patch.object(f,'conexao',return_value={'apikey':'fake'}),patch.object(f,'reservar_na_central',side_effect=reserva) as reservar,\
             patch.object(f,'marcar_no_crm',side_effect=marcar) as clique,patch.object(f,'anotar_na_central',return_value=True) as nota,\
             patch.object(f,'enviar',return_value='id-real-da-integracao') as envio,patch.object(f,'gravar',side_effect=lambda s:estados.append(json.loads(json.dumps(s)))):
            resultados=[f.rodada() for _ in range(vezes)]
        return types.SimpleNamespace(estados=estados,ai=ai,reservar=reservar,clique=clique,nota=nota,envio=envio,resultados=resultados)

    # 1. Elegibilidade: só o que a Central já liberou (`pronto` do Site), nunca a Triagem.
    def test_so_lead_pronto_do_site_com_link_rastreado(self):
        self.assertTrue(f.elegivel(lead()))
        for change in [{'sinal':'revisar'},{'sinal':'descartado'},{'produto':'plus'},{'produto':'prumo'},{'produto':'iris'},{'produto':'estampa'},
                       {'mensagemPronta':''},{'links':{'whatsapp':'https://wa.me/5511998887766'}},
                       {'etapa':'perdido'},{'marcos':{'enviado':f.iso()}},{'conversa':{'mensagens':1}},{'resposta':{'tipo':'negativa'}},{'proximoPasso':{'texto':'aguardar'}}]:
            self.assertFalse(f.elegivel(lead()|change),change)

    def test_plano_antigo_com_revisar_nao_vira_fila(self):
        # Um plano do dia gravado antes de 19/10 (com leads da Triagem) é relido no retrato de agora.
        revisar=lead('estampa:1')|{'produto':'estampa','sinal':'revisar'}
        antigo=f.Registro(Path(self.tmp.name)/'base'/'registro.sqlite');antigo.plano('2026-10-19',[revisar]);antigo.db.close()
        x=self.rodar({'estado':'ok','leads':[revisar]},lambda l:{'reservado':True,'texto':MSG})
        x.ai.assert_not_called();x.reservar.assert_not_called();x.envio.assert_not_called()
        self.assertEqual(x.estados[-1]['fila'],[])

    def test_numero_nao_vem_de_outro_host_ou_do_modelo(self):
        for uri in ['http://wa.me/5511998887766','https://evil.test/5511998887766','https://wa.me.evil/5511998887766','https://wa.me/1234']:
            self.assertIsNone(f.numero(lead()|{'links':{'whatsapp':uri}}))

    # 2. Ritmo e expediente: quem decide é a Central, na reserva; o time não tem regra própria.
    def test_sem_ritmo_proprio(self):
        for nome in ['ritmo','MAX_DIA','MAX_HORA','INTERVALO']:self.assertFalse(hasattr(f,nome),nome)

    def test_reserva_recusada_pelo_ritmo_para_a_rodada_sem_enviar(self):
        crm={'estado':'ok','leads':[lead(),lead('site:outro','5511998887700')]}
        x=self.rodar(crm,lambda l:{'reservado':False,'motivo':'intervalo','ate':'2026-10-19T14:04:00+00:00'})
        self.assertEqual(x.reservar.call_count,1);x.clique.assert_not_called();x.envio.assert_not_called()
        self.assertEqual(x.estados[-1]['proximoEnvioEm'],'2026-10-19T14:04:00+00:00');self.assertEqual(x.estados[-1]['estado'],'pronto')
        self.assertEqual(x.estados[-1]['detalhe'],f.DETALHE_DA_RECUSA['intervalo'])

    def test_central_fora_do_ar_nao_envia(self):
        x=self.rodar({'estado':'ok','leads':[lead()]},lambda l:{'reservado':False,'motivo':'http-503'})
        x.clique.assert_not_called();x.envio.assert_not_called()

    def test_recusa_do_lead_passa_ao_proximo(self):
        crm={'estado':'ok','leads':[lead(),lead('site:outro','5511998887700')]}
        x=self.rodar(crm,lambda l:{'reservado':False,'motivo':'mensagem-barrada'} if l['id']=='site:outro' else {'reservado':True,'texto':MSG})
        self.assertEqual(x.reservar.call_count,2);self.assertEqual(x.envio.call_count,1)
        self.assertEqual(x.envio.call_args.args[0]['id'],'site:teste')

    def test_nao_antecipa_expediente_ou_final_de_semana(self):
        for now in [dt.datetime(2026,10,18,20,tzinfo=dt.timezone.utc),dt.datetime(2026,10,19,10,tzinfo=dt.timezone.utc)]:
            self.assertEqual(f.proximo_expediente(now).isoformat(),'2026-10-19T08:00:00-03:00')
        self.assertEqual(f.proximo_expediente(self.now),self.now)

    # 3. Registro: o clique rastreado do n8n (o da Central) antes do envio, com o texto do Balcão.
    def test_rodada_completa_marca_no_crm_antes_de_enviar_o_texto_do_balcao(self):
        ordem=[]
        def reserva(l):ordem.append('reserva');return {'reservado':True,'texto':MSG}
        def marcar(l,texto):ordem.append('clique');self.assertEqual(texto,MSG)
        x=self.rodar({'estado':'ok','leads':[lead()]},reserva,marcar=marcar,vezes=2)
        self.assertEqual(x.ai.call_count,3);self.assertEqual(x.envio.call_count,1);self.assertEqual(ordem,['reserva','clique'])
        self.assertEqual(x.envio.call_args.args[1],MSG);x.nota.assert_called_once()
        self.assertEqual(x.estados[-1]['enviados'],1);self.assertEqual(x.estados[-1]['fila'][0]['estado'],'enviado')
        self.assertEqual(x.estados[-1]['fila'][0]['mensagem'],MSG)

    def test_clique_que_falha_nao_envia_e_libera_o_numero(self):
        def marcar(l,texto):raise RuntimeError('n8n fora')
        x=self.rodar({'estado':'ok','leads':[lead()]},lambda l:{'reservado':True,'texto':MSG},marcar=marcar)
        x.envio.assert_not_called();self.assertIs(x.resultados[0],False);self.assertEqual(x.estados[-1]['estado'],'bloqueado')
        r=f.Registro(Path(self.tmp.name)/'base'/'registro.sqlite');self.addCleanup(r.db.close)
        self.assertIsNone(r.contato(f.chave('5511998887766')));self.assertEqual(r.incertos(),[])

    def test_marcar_no_crm_confere_numero_e_texto_do_redirecionamento(self):
        from urllib.parse import quote
        bom='https://wa.me/5511998887766?text='+quote(MSG)
        opener=Redirecionar(bom)
        with patch.object(f.urllib.request,'build_opener',return_value=opener):f.marcar_no_crm(lead(),MSG)
        self.assertEqual(opener.urls,['http://127.0.0.1:5679/webhook/enviar?place_id=teste'])
        for errado in ['https://wa.me/5521998887700?text='+quote(MSG),'https://wa.me/5511998887766?text=outro','https://docs.google.com/spreadsheets/d/x','https://evil.test/5511998887766?text='+quote(MSG)]:
            with patch.object(f.urllib.request,'build_opener',return_value=Redirecionar(errado)):
                with self.assertRaises(RuntimeError):f.marcar_no_crm(lead(),MSG)
        with patch.object(f.urllib.request,'build_opener',return_value=Redirecionar(bom,code=500)):
            with self.assertRaises(urllib.error.HTTPError):f.marcar_no_crm(lead(),MSG)

    def test_reserva_pede_a_central_com_a_mesma_origem(self):
        with patch.object(f,'http',return_value={'reservado':True,'texto':MSG}) as h:
            self.assertTrue(f.reservar_na_central(lead())['reservado'])
        url,corpo,headers=h.call_args.args[:3]
        self.assertEqual(url,'http://127.0.0.1:9120/api/operations/crm/frente/reservar');self.assertEqual(corpo,{'leadId':'site:teste'})
        self.assertEqual(headers,{'Origin':'http://127.0.0.1:9120'})
        erro=urllib.error.HTTPError('u',503,'x',{},io.BytesIO(b'{"motivo":"sem-retrato"}'))
        self.addCleanup(erro.close)
        with patch.object(f,'http',side_effect=erro):self.assertEqual(f.reservar_na_central(lead()),{'reservado':False,'motivo':'sem-retrato'})

    # 4. Quem faz o 1º contato: lead que o Rômulo já tocou hoje é dele.
    def test_lead_tocado_pelo_operador_hoje_nao_e_pedido(self):
        x=self.rodar({'estado':'ok','leads':[lead()]},lambda l:{'reservado':True,'texto':MSG},primeiros={'site:teste':{'em':1,'por':'central'}})
        x.reservar.assert_not_called();x.envio.assert_not_called()

    def test_fila_nova_so_substitui_a_anterior_quando_termina(self):
        (self.data/'frente-comercial.json').write_text(json.dumps({'dia':'2026-10-19','fila':[{'id':'site:velho','estado':'pronto','hash':'x'}]}))
        x=self.rodar({'estado':'ok','leads':[lead()]},lambda l:{'reservado':False,'motivo':'intervalo','ate':None})
        parciais=[e for e in x.estados if e['estado']=='avaliando']
        self.assertTrue(parciais);self.assertTrue(all(e['fila'][0]['id']=='site:velho' for e in parciais))
        self.assertEqual([c['id'] for c in x.estados[-1]['fila']],['site:teste'])

    # O que já valia antes de 19/10.
    def test_bloqueia_duplicidade_e_resultado_incerto_apos_reinicio(self):
        l=lead();self.assertTrue(self.r.reservar(l,'Olá',self.now));self.assertFalse(self.r.reservar(l,'Olá',self.now))
        novo=f.Registro(Path(self.tmp.name)/'r.sqlite');self.addCleanup(novo.db.close)
        self.assertFalse(novo.reservar(lead('site:outra','551198887766'),'outra',self.now))
        self.assertEqual(len(novo.incertos()),1)
        novo.confirmar(f.chave('5511998887766'),'id');novo.liberar(f.chave('5511998887766'))
        self.assertEqual(novo.contato(f.chave('5511998887766'))['estado'],'enviado')

    def test_hash_ignora_links_de_apresentacao_mas_nao_o_destino(self):
        base=lead();h=f.fingerprint(base)
        for links in [{'convite':'https://wa.me/55?text=a'},{'acoes':'/x'},{'maps':'https://maps.test/1'}]:
            self.assertEqual(f.fingerprint(base|{'links':base['links']|links}),h)
        self.assertNotEqual(f.fingerprint(lead(n='5511998887755')),h)
        self.assertNotEqual(f.fingerprint(base|{'links':base['links']|{'raioX':'https://x.test'}}),h)

    def test_plano_do_dia_nao_troca_depois_de_cada_envio(self):
        self.assertEqual(self.r.plano('2026-10-19',[lead()]),[lead()])
        self.assertEqual(self.r.plano('2026-10-19',[lead('novo')]),[lead()])

    def test_contrato_exige_todos_os_ids_notas_e_decisoes(self):
        a={'id':'a','nota':80,'decisao':'contatar','motivo':'Boa aderência ao recorte'}
        self.assertEqual(f.validar_avaliacoes(json.dumps([a]),{'a'})['a']['nota'],80)
        for change in [{'nota':True},{'nota':101},{'decisao':'enviar para outro número'},{'id':'b'},{'url':'https://evil.test'},{'mensagem':'texto do modelo'}]:
            with self.assertRaises(ValueError):f.validar_avaliacoes(json.dumps([a|change]),{'a'})
        with self.assertRaises(ValueError):f.validar_avaliacoes(json.dumps([a,a]),{'a'})

    def test_modelo_nao_recebe_telefone_url_ou_historico(self):
        s=json.dumps(f.pacote(lead()|{'conversa':{'texto':'privado'},'nicho':'teste 5511998887766'}))
        self.assertNotIn('5511998887766',s);self.assertNotIn('https://',s);self.assertNotIn('privado',s);self.assertNotIn(MSG,s)

    def test_uma_tentativa_de_envio_sem_retry_e_destinatario_confirmado(self):
        with patch.object(f,'http',return_value={'key':{'id':'ok','fromMe':True,'remoteJid':'5511998887766@s.whatsapp.net'}}) as request:
            self.assertEqual(f.enviar(lead(),'Olá',{'apikey':'fake'}),'ok');self.assertEqual(request.call_count,1)
        with patch.object(f,'http',return_value={'key':{'id':'errado','fromMe':True,'remoteJid':'5521998887766@s.whatsapp.net'}}):
            with self.assertRaises(RuntimeError):f.enviar(lead(),'Olá',{'apikey':'fake'})

    def test_limite_de_inferencia_inclui_tentativas_sem_resposta(self):
        for _ in range(f.MAX_IA):self.r.consumir_ia('2026-10-19')
        with self.assertRaises(RuntimeError):self.r.consumir_ia('2026-10-19')

    def test_pausa_nao_avalia_nem_envia(self):
        with patch.object(f,'BASE',Path(self.tmp.name)/'base'),patch.object(f,'H',Path(self.tmp.name)),patch.object(f,'DATA',self.data),patch.object(f,'ler_crm',return_value={'leads':[]}),patch.object(f,'ler_config',return_value={'ativo':False}),patch.object(f,'inferir') as ai,patch.object(f,'enviar') as envio,patch.object(f,'reservar_na_central') as reservar,patch.object(f,'gravar'):
            f.rodada();ai.assert_not_called();envio.assert_not_called();reservar.assert_not_called()

    def test_pausa_preserva_as_avaliacoes_e_a_fila_do_mesmo_dia(self):
        (self.data/'frente-comercial.json').write_text(json.dumps({'dia':'2026-10-19','avaliados':200,'selecionados':100,'fila':[{'id':'site:teste'}]}))
        estados=[]
        with patch.object(f,'BASE',Path(self.tmp.name)/'base'),patch.object(f,'H',Path(self.tmp.name)),patch.object(f,'DATA',self.data),patch.object(f,'ler_crm',return_value={'leads':[]}),patch.object(f,'agora',return_value=self.now),patch.object(f,'ler_config',return_value={'ativo':False}),patch.object(f,'gravar',side_effect=lambda s:estados.append(s.copy())):
            f.rodada()
        self.assertEqual(estados[-1]['estado'],'pausado');self.assertEqual(estados[-1]['avaliados'],200);self.assertEqual(estados[-1]['selecionados'],100);self.assertEqual(len(estados[-1]['fila']),1)

if __name__=='__main__':unittest.main()
