import datetime as dt
import importlib.util
import io
import json
import math
from pathlib import Path
import re
import sys
import tempfile
import types
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('frente',Path(__file__).with_name('frente-comercial.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

MSG='Olá! Vi que a Empresa de teste ainda não tem site. Fiz uma prévia, posso mandar?'

def lead(id_='site:teste',n='5511998887766'):
    return {'id':id_,'produto':'site','empresa':'Empresa de teste','etapa':'novo','sinal':'pronto','marcos':{},'mensagemPronta':MSG,
            'links':{'whatsapp':'https://wa.me/'+n,'enviar':'https://dell.test/webhook/enviar?place_id='+id_.partition(':')[2]}}

def outro_produto(produto,n='5511998887766'):
    l=lead(f'{produto}:teste',n)|{'produto':produto}
    if produto=='plus':
        l['plus']={'fixo':False};l['links']['enviar']='https://wa.me/'+n+'?text='+urllib.parse.quote(MSG)
    else:
        l['sinal']='revisar';l['triagem']={'origemWhatsapp':'cadastro confirmado'}
        l['links']['convite']='https://wa.me/'+n+'?text='+urllib.parse.quote(MSG)
    return l

def avaliar(_a,_e,lote,_ant,_funil=None,_taxas=None):
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

    # 1. Elegibilidade: cada oferta exige mensagem pronta, destino e nenhuma interação anterior.
    def test_so_lead_pronto_do_site_com_link_rastreado(self):
        self.assertTrue(f.elegivel(lead()))
        for change in [{'sinal':'revisar'},{'sinal':'descartado'},{'produto':'plus'},{'produto':'prumo'},{'produto':'iris'},{'produto':'estampa'},
                       {'mensagemPronta':''},{'links':{'whatsapp':'https://wa.me/5511998887766'}},
                       {'etapa':'perdido'},{'marcos':{'enviado':f.iso()}},{'conversa':{'mensagens':1}},{'resposta':{'tipo':'negativa'}},{'proximoPasso':{'texto':'aguardar'}}]:
            self.assertFalse(f.elegivel(lead()|change),change)

    def test_quatro_ofertas_e_bloqueios_por_origem(self):
        for produto in ('site','prumo','iris','estampa'):
            l=lead() if produto=='site' else outro_produto(produto)
            self.assertTrue(f.elegivel(l),produto)
            self.assertEqual(f.texto_do_lead(l),MSG)
        self.assertFalse(f.elegivel(outro_produto('plus')|{'plus':{'fixo':True}}))
        self.assertFalse(f.elegivel(outro_produto('iris')|{'triagem':{'origemWhatsapp':'não confirmado — número do Google'}}))
        self.assertFalse(f.elegivel(outro_produto('prumo')|{'links':{'whatsapp':'https://wa.me/5511998887766','convite':'https://wa.me/5521998887766?text=oi'}}))

    def test_funil_inclui_todas_as_etapas_e_respostas(self):
        ls=[lead(),outro_produto('plus','5511998887700')|{'etapa':'contato','conversa':{'ultimaEntrada':f.iso(self.now),'ultimaSaida':f.iso(self.now)}},
            outro_produto('iris','5511998887701')|{'etapa':'proposta'},outro_produto('prumo','5511998887702')|{'etapa':'ganho'},
            outro_produto('estampa','5511998887703')|{'etapa':'perdido'}]
        m={x['produto']:x for x in f.metricas_do_funil({'leads':ls})}
        self.assertEqual(m['site']['novo'],1);self.assertEqual(m['site']['elegiveis'],1)
        self.assertEqual(m['plus']['contato'],1);self.assertEqual(m['plus']['respostasWhatsapp'],1)
        self.assertEqual(m['iris']['proposta'],1);self.assertEqual(m['prumo']['ganho'],1);self.assertEqual(m['estampa']['perdido'],1)

    def test_taxa_historica_so_pesa_com_dez_contatos_observados(self):
        ls=[]
        for i in range(10):
            l=outro_produto('iris',f'55119988877{i:02}')|{'etapa':'contato','nicho':'terapia','marcos':{'enviado':f.iso(self.now)}}
            if i<3:l['conversa']={'ultimaEntrada':f.iso(self.now)}
            ls.append(l)
        taxas=f.taxas_por_setor({'leads':ls})
        novo=outro_produto('iris')|{'nicho':'terapia','triagem':{'prioridade':70,'origemWhatsapp':'confirmado'}}
        self.assertEqual(taxas[('iris','terapia')],0.3)
        self.assertEqual(f.prioridade_do_candidato(novo,taxas),76)
        self.assertEqual(f.taxas_por_setor({'leads':ls[:9]}),{})

    def test_plus_avalia_descricao_e_oferta_e_invalida_cache_antigo(self):
        l=outro_produto('plus')|{'plus':{'fixo':False,'oferta':'estampa','descricao':'Faz camisetas para eventos','tambem':['site']}}
        d=f.pacote(l)
        self.assertEqual(d['plus'],{'ofertaIndicada':'estampa','descricaoPublica':'Faz camisetas para eventos','ofertasRelacionadas':['site']})
        self.assertNotEqual(f.hash_avaliacao(l),f.fingerprint(l))
        with self.r.db:
            self.r.db.execute('INSERT INTO avaliacoes VALUES(?,?,?,?,?)',('2026-10-19',l['id'],f.fingerprint(l),'Diego',json.dumps({'nota':0,'decisao':'adiar','motivo':'sem dados'})))
        self.assertIsNone(self.r.avaliar('2026-10-19',l,'Diego'))

    def test_plano_antigo_com_revisar_nao_vira_fila(self):
        # Um plano do dia gravado antes de 19/10 (com leads da Triagem) é relido no retrato de agora.
        revisar=lead('estampa:1')|{'produto':'estampa','sinal':'revisar'}
        antigo=f.Registro(Path(self.tmp.name)/'base'/'registro.sqlite');antigo.plano('2026-10-19',[revisar]);antigo.db.close()
        x=self.rodar({'estado':'ok','leads':[revisar]},lambda l:{'reservado':True,'texto':MSG})
        x.ai.assert_not_called();x.reservar.assert_not_called();x.envio.assert_not_called()
        self.assertEqual(x.estados[-1]['fila'],[])

    def test_plano_fixa_ids_mas_avalia_ficha_atual_do_crm(self):
        antigo=lead()|{'triagem':{'prioridade':70}}
        registro=f.Registro(Path(self.tmp.name)/'base'/'registro.sqlite');registro.plano('2026-10-19',[antigo]);registro.db.close()
        atual=lead()|{'triagem':{'prioridade':85},'achados':[{'titulo':'Site indisponível'}]}
        x=self.rodar({'estado':'ok','leads':[atual]},lambda l:{'reservado':True,'texto':MSG})
        self.assertEqual(x.envio.call_count,1)
        self.assertEqual(x.estados[-1]['fila'][0]['hash'],f.fingerprint(atual))

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

    def test_convites_enviam_sem_clique_site_e_anotam_etapa(self):
        for produto in ('prumo','iris','estampa'):
            with self.subTest(produto=produto):
                with tempfile.TemporaryDirectory() as pasta:
                    l=outro_produto(produto)
                    with patch.object(f,'BASE',Path(pasta)/'base'),patch.object(f,'H',Path(pasta)),patch.object(f,'DATA',Path(pasta)),\
                         patch.object(f,'ler_crm',return_value={'estado':'ok','leads':[l]}),patch.object(f,'agora',return_value=self.now),\
                         patch.object(f,'ler_config',return_value={'ativo':True}),patch.object(f,'inferir',side_effect=avaliar),\
                         patch.object(f,'http',return_value={'primeiros':{}}),patch.object(f,'conexao',return_value={'apikey':'fake'}),\
                         patch.object(f,'reservar_na_central',return_value={'reservado':True,'texto':MSG}),\
                         patch.object(f,'marcar_no_crm') as clique,patch.object(f,'anotar_na_central',return_value=True) as nota,\
                         patch.object(f,'enviar',return_value='recibo') as envio,patch.object(f,'gravar'):
                        f.rodada()
                    clique.assert_not_called();envio.assert_called_once();nota.assert_called_once_with(l,MSG,f.iso(self.now))

    def test_plus_pronto_e_rede_quente_exclusiva_do_romulo(self):
        l=outro_produto('plus')
        self.assertFalse(f.elegivel(l))
        x=self.rodar({'estado':'ok','leads':[l]},lambda l:{'reservado':True,'texto':MSG})
        x.ai.assert_not_called();x.reservar.assert_not_called();x.envio.assert_not_called()

    def test_registro_de_convite_e_plus_tem_tipo_correto(self):
        for produto,tipo in [('prumo','nota'),('iris','nota'),('estampa','nota'),('plus','plus_enviado')]:
            with patch.object(f,'http',return_value={'ok':True}) as h:
                self.assertTrue(f.anotar_na_central(outro_produto(produto),MSG,f.iso(self.now)))
            corpo=h.call_args.args[1]
            self.assertEqual(corpo['tipo'],tipo)
            if tipo=='nota':
                self.assertTrue(corpo['texto'].startswith('[Convite enviado confirmado pela integração do time]\n'))
                self.assertEqual(json.loads(corpo['texto'].split('\n',1)[1])['mensagem'],MSG)

    def test_pendencia_de_registro_bloqueia_ate_o_funil_confirmar(self):
        l=outro_produto('iris')
        self.r.pendencia_registro(l,f.iso(self.now))
        self.assertEqual(self.r.conferir_pendencias({'leads':[l]}),1)
        self.assertEqual(self.r.conferir_pendencias({'leads':[l|{'etapa':'contato'}]}),0)

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

    def test_alterna_setores_aprovados_e_publica_metricas_da_carteira(self):
        leads=[lead(f'site:u{i}',f'55119988877{i:02}')|{'nicho':'dedetizadora' if i%2 else 'desentupidora'} for i in range(4)]
        leads += [lead(f'site:a{i}',f'55119988878{i:02}')|{'nicho':'advocacia'} for i in range(2)]
        x=self.rodar({'estado':'ok','leads':leads},lambda l:{'reservado':False,'motivo':'intervalo','ate':None})
        final=x.estados[-1]
        self.assertEqual([c['setor'] for c in final['fila'][:4]],
            ['Advocacia','Serviços de urgência','Advocacia','Serviços de urgência'])
        self.assertEqual([(s['setor'],s['avaliados'],s['selecionados'],s['enviados']) for s in final['setores']],
            [('Serviços de urgência',4,4,0),('Advocacia',2,2,0)])
        self.assertEqual(final['selecionados'],6)

    def test_metricas_contam_so_avaliacoes_feitas_e_preservam_envio_confirmado(self):
        leads=[lead(f'site:{i}',f'5511998{i:06}')|{'nicho':'advocacia' if i%2 else 'dedetizadora'} for i in range(61)]
        x=self.rodar({'estado':'ok','leads':leads},lambda l:{'reservado':False,'motivo':'intervalo'})
        final=x.estados[-1]
        self.assertEqual(final['avaliados'],40)
        self.assertEqual(sum(s['avaliados'] for s in final['setores']),40)
        primeiro=final['fila'][0]
        primeiro.update(estado='enviado')
        (self.data/'frente-comercial.json').write_text(json.dumps(final,ensure_ascii=False))
        atual=[l|{'etapa':'contato','marcos':{'enviado':f.iso(self.now)}} if l['id']==primeiro['id'] else l for l in leads]
        y=self.rodar({'estado':'ok','leads':atual},lambda l:{'reservado':False,'motivo':'intervalo'})
        seguinte=y.estados[-1]
        self.assertEqual(seguinte['avaliados'],61)
        self.assertEqual(sum(s['avaliados'] for s in seguinte['setores']),61)
        self.assertIn(primeiro['id'],[c['id'] for c in seguinte['fila'] if c['estado']=='enviado'])

    def test_lote_novo_preserva_aprovado_de_rodada_anterior(self):
        leads=[lead(f'site:{i}',f'5511998{i:06}') for i in range(61)]
        ultimo=leads[-1]
        anterior={'dia':'2026-10-19','fila':[{'id':ultimo['id'],'empresa':ultimo['empresa'],'produto':'site',
            'setor':f.setor(ultimo),'nota':80,'estado':'pronto','hash':f.fingerprint(ultimo)}]}
        (self.data/'frente-comercial.json').write_text(json.dumps(anterior))
        x=self.rodar({'estado':'ok','leads':leads},lambda l:{'reservado':False,'motivo':'intervalo'})
        self.assertIn(ultimo['id'],[c['id'] for c in x.estados[-1]['fila']])

    def test_diversifica_o_plano_antes_do_corte_de_200(self):
        leads=[lead(f'site:u{i}',f'5511998{i:06}')|{'nicho':'desentupidora','triagem':{'prioridade':90}} for i in range(205)]
        leads += [lead('site:a','551198877665')|{'nicho':'advocacia','triagem':{'prioridade':70}}]
        ordem=f.intercalar_setores(leads,lambda l:l['triagem']['prioridade'])[:200]
        self.assertIn('site:a',[l['id'] for l in ordem])

    def test_plano_existente_so_de_site_passa_a_intercalar_as_ofertas(self):
        antigos=[lead(f'site:{i}',f'55119988877{i:02}') for i in range(40)]
        self.r.plano('2026-10-19',antigos)
        novos=[outro_produto(p,f'55119988878{i:02}') for i,p in enumerate(('prumo','iris','estampa','plus'))]
        plano=self.r.plano('2026-10-19',antigos+novos)
        self.assertEqual(set(l['produto'] for l in plano[:5]),{'site','prumo','iris','estampa','plus'})

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

    def test_plano_do_dia_acrescenta_candidatos_sem_perder_os_anteriores(self):
        self.assertEqual(self.r.plano('2026-10-19',[lead()]),[lead()])
        self.assertEqual({l['id'] for l in self.r.plano('2026-10-19',[lead('novo')])},{'site:teste','novo'})

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

    # Parado (desligado ou em pausa configurada): não lê o CRM, não abre o SQLite, não chama o modelo (19/10/2026).
    def rodar_parado(self,config):
        estados=[]
        with patch.object(f,'BASE',Path(self.tmp.name)/'base'),patch.object(f,'H',Path(self.tmp.name)),patch.object(f,'DATA',self.data),\
             patch.object(f,'agora',return_value=self.now),patch.object(f,'ler_config',return_value=config),patch.object(f,'ler_crm') as crm,\
             patch.object(f,'Registro') as registro,patch.object(f,'inferir') as ai,patch.object(f,'gravar',side_effect=lambda s:estados.append(s.copy())):
            resultado=f.rodada()
        return types.SimpleNamespace(crm=crm,registro=registro,ai=ai,estados=estados,resultado=resultado)

    def test_desligado_nao_le_crm_nem_sqlite(self):
        (self.data/'frente-comercial.json').write_text(json.dumps({'dia':'2026-10-19','avaliados':7,'selecionados':3,'enviados':2,'respondidos':1,'fila':[{'id':'site:a'}]}))
        x=self.rodar_parado({'ativo':False})
        x.crm.assert_not_called();x.registro.assert_not_called();x.ai.assert_not_called()
        e=x.estados[-1]
        self.assertEqual((e['estado'],e['avaliados'],e['selecionados'],e['enviados'],e['respondidos']),('pausado',7,3,2,1));self.assertEqual(e['fila'],[{'id':'site:a'}])

    def test_pausa_configurada_tambem_para_antes_de_ler(self):
        depois=(self.now+dt.timedelta(hours=2)).isoformat()
        x=self.rodar_parado({'ativo':True,'pausadoAte':depois})
        x.crm.assert_not_called();x.registro.assert_not_called();x.ai.assert_not_called()
        self.assertEqual(x.estados[-1]['estado'],'pausado');self.assertIn('período configurado',x.estados[-1]['detalhe'])

    def test_pausa_vencida_deixa_a_rodada_seguir(self):
        antes=(self.now-dt.timedelta(hours=2)).isoformat()
        self.assertIsNone(f.motivo_da_pausa({'ativo':True,'pausadoAte':antes},self.now))
        self.assertIsNone(f.motivo_da_pausa({'ativo':True},self.now))
        self.assertIsNotNone(f.motivo_da_pausa({},self.now))

    def test_pausa_de_outro_dia_nao_herda_os_numeros(self):
        (self.data/'frente-comercial.json').write_text(json.dumps({'dia':'2026-10-18','avaliados':9,'fila':[{'id':'x'}]}))
        e=self.rodar_parado({'ativo':False}).estados[-1]
        self.assertEqual((e['avaliados'],e['fila']),(0,[]))

    # A cópia da janela e das recusas tem de andar com a Central (a reserva só responde com um lead na mão).
    def test_janela_e_recusas_iguais_as_da_central(self):
        raiz=Path(__file__).resolve().parents[2]
        horario=(raiz/'src/operations/trava-de-horario.ts').read_text(encoding='utf-8')
        m=re.search(r'EXPEDIENTE_DE_VENDA\s*=\s*\{\s*dias:\s*\[([\d,\s]+)\],\s*inicioMin:\s*([\d\s*+]+?),\s*fimMin:\s*([\d\s*+]+?)\s*\}',horario)
        self.assertIsNotNone(m,'EXPEDIENTE_DE_VENDA mudou de forma: ajuste o teste')
        conta=lambda expr:sum(math.prod(int(n) for n in termo.split('*')) for termo in expr.split('+'))
        self.assertEqual([int(d) for d in m.group(1).split(',')],[1,2,3,4,5],'seg–sex (getDay 1 a 5)')
        self.assertEqual((conta(m.group(2)),conta(m.group(3))),(f.EXPEDIENTE_INICIO,f.EXPEDIENTE_FIM))
        # seg–sex também no relógio do .py: sexta às 17h30 de SP já fechou, e a fila volta na segunda às 8h.
        sexta_fechou=dt.datetime(2026,10,23,20,30,tzinfo=dt.timezone.utc)
        self.assertEqual(f.proximo_expediente(sexta_fechou).isoformat(),'2026-10-26T08:00:00-03:00')
        contato=(raiz/'src/operations/primeiro-contato.ts').read_text(encoding='utf-8')
        tipo=re.search(r'export type RecusaDoTime\s*=([^\n]+)',contato).group(1)
        ritmo=re.search(r'MotivoDoRitmo\s*=\s*([^\n]+)',(raiz/'src/operations/trava-de-ritmo.ts').read_text(encoding='utf-8')).group(1)
        literais=lambda t:set(re.findall(r"'([a-z-]+)'",t))
        todas=literais(tipo)|literais(ritmo)
        gerais=literais(re.search(r'RECUSAS_GERAIS[^=]*=\s*new Set\(\[([^\]]+)\]\)',contato).group(1))
        self.assertEqual(set(f.RECUSAS_DO_LEAD)|gerais,todas,'a Central ganhou ou perdeu uma recusa: decida se é do lead ou geral')
        self.assertFalse(set(f.RECUSAS_DO_LEAD)&gerais)

if __name__=='__main__':unittest.main()
