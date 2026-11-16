import datetime as dt
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import types
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

# Nenhum teste grava na fila de avisos de verdade: a variável aponta para uma pasta que não existe (a lib não a cria)
# e os testes que precisam de fila criam a deles. Definida ANTES de carregar o módulo.
os.environ['SQUADONE_AVISOS_FILA']=str(Path(tempfile.gettempdir())/'frente-comercial-teste-sem-fila')
spec=importlib.util.spec_from_file_location('frente',Path(__file__).with_name('frente-comercial.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
AVISAR_REAL=f.avisar_time
OBSERVADOR_REAL=f.observador_ativo

MSG='Oi! No perfil da empresa que consultei, não encontrei um link para site próprio. Vocês já têm um site para apresentar os serviços?'

def lead(id_='site:teste',n='5511998887766'):
    # Desde a curadoria da Marina (26/10/2026) o Site só é elegível com achado verificável do Raio-X.
    return {'id':id_,'produto':'site','empresa':'Empresa de teste','etapa':'novo','sinal':'pronto','marcos':{},'mensagemPronta':MSG,
            'achados':[{'id':'sem-site'}], 'abordagem':{'mensagem':'E'},
            'links':{'whatsapp':'https://wa.me/'+n,'enviar':'https://dell.test/webhook/enviar?place_id='+id_.partition(':')[2]}}

MODELO_NEUTRO={'hash':'modelo-neutro-teste','padroes':[],'semWhatsapp':[]}

# Estamparia só entra com necessidade, impacto e decisor confirmados no CRM (curadoria de 26/10/2026).
SPICED_CONFIRMADO={'dor':'pedidos espalhados no WhatsApp','impacto':'atraso na produção',
                   'decisao':{'decisor_confirmado':'sim','quem':'dono da estamparia'}}

def outro_produto(produto,n='5511998887766'):
    l=lead(f'{produto}:teste',n)|{'produto':produto}
    if produto=='plus':
        l['plus']={'fixo':False};l['links']['enviar']='https://wa.me/'+n+'?text='+urllib.parse.quote(MSG)
    else:
        l['sinal']='revisar';l['triagem']={'origemWhatsapp':'cadastro confirmado','sinais':'ABA · TEA' if produto=='iris' else 'camisetas · silk'}
        l['links']['convite']='https://wa.me/'+n+'?text='+urllib.parse.quote(MSG)
        if produto=='estampa':l['spiced']=json.loads(json.dumps(SPICED_CONFIRMADO))
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
        # A campanha de verdade do Dell (~/.local/share/squadone-operations) não entra no teste: sem o arquivo,
        # o campanha_site preserva a operação de antes. Com ele, os leads de teste não estavam autorizados.
        import campanha_site
        duble=patch.object(campanha_site,'ARQUIVO',Path(self.tmp.name)/'sem-campanha.json');duble.start();self.addCleanup(duble.stop)
        # Avisos e observador dublados: o teste nunca toca a fila, o systemd nem o Telegram.
        self.avisos=[]
        def aviso(titulo,texto,chave_,prioridade=2):self.avisos.append({'titulo':titulo,'texto':texto,'chave':chave_,'prioridade':prioridade});return True
        for duble in (patch.object(f,'avisar_time',side_effect=aviso),patch.object(f,'observador_ativo',return_value=True),patch.object(f,'protecao_permite_envio',return_value=True)):
            duble.start();self.addCleanup(duble.stop)
        self.observador=f.observador_ativo  # o dublê: .return_value=False tira o observador do ar
        # Regressões do executor histórico: simular autorização só nesta instância
        # de teste. aquisicao-comercial.test.py carrega outro módulo e prova que a
        # política real impede transporte mesmo após reserva e configuração inválida.
        historico=patch.object(f,'bloqueio_aquisicao',return_value={'bloqueado':False,'motivo':'fixture-historica'})
        historico.start();self.addCleanup(historico.stop)
        # Sem a régua recente da Marina a rodada para antes da inferência (falha fechada, 26/10/2026; coberto em
        # frente-comercial-curadoria.test.py). Aqui a régua é neutra: sem padrões nem destinos mortos. O hash dela
        # entra no fingerprint, então o teste já começa com a mesma régua que a rodada vai carregar.
        regua=patch.object(f.lib_curadoria(),'carregar_modelo',return_value=MODELO_NEUTRO)
        regua.start();self.addCleanup(regua.stop)
        f._MODELO_CURADORIA=MODELO_NEUTRO;self.addCleanup(setattr,f,'_MODELO_CURADORIA',None)
        # O cenário desta suíte já tem fonte e autorização aprovadas. Campanha e
        # descoberta têm suítes próprias; nunca consultar o manifesto real do host.
        fonte={'fontePublicaIdentificavel':True,'identidadeDoNomeConfere':True,
               'contatoCorrespondeAoPublicadoNaFicha':True,
               'conferenciaTecnicaDoSite':{'dominio':'empresa.test','http':503,'em':self.now.isoformat()},
               'conferenciaAtualDoPerfil':{'contatoAtualCorrespondeAFicha':True,
                   'campoSiteDoPerfilDaPropriaEmpresa':'sem-link-de-site-no-perfil','em':self.now.isoformat()}}
        for duble in (patch('campanha_site.ler',return_value=None),
                      patch('campanha_site.evidencia_site',return_value=fonte),
                      patch.object(f,'iso',side_effect=lambda now=None:(now or f.agora()).isoformat())):
            duble.start();self.addCleanup(duble.stop)

    def test_pausa_entre_reserva_e_envio_nao_envia(self):
        f.protecao_permite_envio.return_value=False
        r=self.rodar({'leads':[lead()]},lambda l:{'reservado':True,'texto':MSG})
        self.assertEqual(r.envio.call_count,0);self.assertEqual(r.estados[-1]['estado'],'pausado')

    def rodar(self,crm,reserva,primeiros=None,marcar=None,vezes=1,existe=None,envia=None,publicar=None):
        """Uma rodada com tudo de fora dublado; nunca o disco, a Central, o n8n ou o WhatsApp de verdade."""
        estados=[]
        with patch.object(f,'BASE',Path(self.tmp.name)/'base'),patch.object(f,'H',Path(self.tmp.name)),patch.object(f,'DATA',self.data),\
             patch.object(f,'ler_crm',return_value=crm),patch.object(f,'agora',return_value=self.now),patch.object(f,'ler_config',return_value={'ativo':True}),\
             patch.object(f,'inferir',side_effect=avaliar) as ai,patch.object(f,'http',return_value={'primeiros':primeiros or {}}),\
             patch.object(f,'conexao',return_value={'apikey':'fake'}),patch.object(f,'reservar_na_central',side_effect=reserva) as reservar,\
             patch.object(f,'marcar_no_crm',side_effect=marcar) as clique,patch.object(f,'anotar_na_central',return_value=True) as nota,\
             patch.object(f,'enviar',side_effect=envia or (lambda *a:'id-real-da-integracao')) as envio,\
             patch.object(f,'existe_no_whatsapp',side_effect=existe or (lambda l,auth:True)) as consulta,\
             patch.object(f,'revalidar_antes_do_envio',return_value=True),patch.object(f,'gravar',side_effect=lambda s:(estados.append(json.loads(json.dumps(s))),publicar(s) if publicar else None)):
            resultados=[f.rodada() for _ in range(vezes)]
        return types.SimpleNamespace(estados=estados,ai=ai,reservar=reservar,clique=clique,nota=nota,envio=envio,consulta=consulta,resultados=resultados)

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
            l=outro_produto('iris',f'55119988877{i:02}')|{'etapa':'contato','nicho':'terapia','marcos':{'enviado':f.iso(self.now-dt.timedelta(days=3))}}
            if i<3:l['conversa']={'ultimaEntrada':f.iso(self.now)};l['classificacaoResposta']={'houveRespostaHumana':True,'classe':'acesso'}
            ls.append(l)
        taxas=f.taxas_por_setor({'leads':ls})
        novo=outro_produto('iris')|{'nicho':'terapia','triagem':{'prioridade':70,'origemWhatsapp':'confirmado','sinais':'ABA · TEA'}}
        self.assertEqual(taxas[('iris','terapia')],0.3)
        # Desde 26/10/2026 a taxa do setor é só descritiva: não dá bônus de seleção (o ajuste é o da régua da Marina).
        self.assertEqual(f.prioridade_do_candidato(novo,taxas),70)
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
        atual=lead()|{'triagem':{'prioridade':85},'achados':[{'id':'site-fora-do-ar','titulo':'Site indisponível'}]}
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
        # Parada técnica não pode parecer 'pronto': o aviso de "parado há 10 min" só olha o que está 'bloqueado'.
        self.assertEqual(x.estados[-1]['estado'],'bloqueado')
        self.assertEqual(x.estados[-1]['falha'],'http-503')

    def test_recusa_de_ritmo_da_central_continua_pronto(self):
        for motivo in ('fora-do-expediente','pausa','dia','hora','intervalo'):
            x=self.rodar({'estado':'ok','leads':[lead()]},lambda l,m=motivo:{'reservado':False,'motivo':m})
            self.assertEqual(x.estados[-1]['estado'],'pronto',motivo)

    def test_recusa_do_lead_passa_ao_proximo(self):
        crm={'estado':'ok','leads':[lead(),lead('site:outro','5511998887700')]}
        x=self.rodar(crm,lambda l:{'reservado':False,'motivo':'mensagem-barrada'} if l['id']=='site:outro' else {'reservado':True,'texto':MSG})
        self.assertEqual(x.reservar.call_count,2);self.assertEqual(x.envio.call_count,1)
        self.assertEqual(x.envio.call_args.args[0]['id'],'site:teste')

    def test_nao_antecipa_expediente_ou_final_de_semana(self):
        for now in [dt.datetime(2026,10,18,20,tzinfo=dt.timezone.utc),dt.datetime(2026,10,19,10,tzinfo=dt.timezone.utc)]:
            self.assertEqual(f.proximo_expediente(now).isoformat(),'2026-10-19T08:00:00-03:00')
        self.assertEqual(f.proximo_expediente(self.now),self.now)

    def test_todas_as_mensagens_barradas_mostram_bloqueio_e_motivo(self):
        crm={'estado':'ok','leads':[lead(),lead('site:outro','5511998887700')]}
        x=self.rodar(crm,lambda l:{'reservado':False,'motivo':'mensagem-barrada','detalhe':'o nome da empresa tem lixo'})
        final=x.estados[-1]
        self.assertEqual(final['estado'],'bloqueado')
        self.assertIn('2 contato(s)',final['detalhe'])
        self.assertIn('o nome da empresa tem lixo',final['detalhe'])
        self.assertIn('fichas',final['detalhe'])
        self.assertIsNone(final['proximoEnvioEm'])
        self.assertLessEqual(len(final['detalhe']),400)
        x.envio.assert_not_called();x.clique.assert_not_called()

    def test_mensagem_barrada_sem_detalhe_da_central_tambem_nao_vira_concluido(self):
        x=self.rodar({'estado':'ok','leads':[lead()]},lambda l:{'reservado':False,'motivo':'mensagem-barrada'})
        self.assertEqual(x.estados[-1]['estado'],'bloqueado')
        self.assertIn('validação de envio',x.estados[-1]['detalhe'])
        x.envio.assert_not_called()

    def test_correcao_da_mensagem_revalida_e_retoma_no_ciclo_seguinte(self):
        tentativas=[]
        def reserva(l):
            tentativas.append(l['id'])
            return {'reservado':False,'motivo':'mensagem-barrada'} if len(tentativas)==1 else {'reservado':True,'texto':MSG}
        x=self.rodar({'estado':'ok','leads':[lead()]},reserva,vezes=2)
        self.assertTrue(any(s['estado']=='bloqueado' for s in x.estados))
        self.assertEqual(x.estados[-1]['estado'],'pronto')
        self.assertEqual(x.envio.call_count,1)
        self.assertEqual(x.estados[-1]['enviados'],1)

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
                         patch.object(f,'enviar',return_value='recibo') as envio,patch.object(f,'existe_no_whatsapp',return_value=True),patch.object(f,'gravar'):
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

    # 5. Número sem WhatsApp (20/10/2026): descarte definitivo, nunca um `incerto` que bloqueia o time inteiro.
    def contato(self,n='5511998887766'):
        r=f.Registro(Path(self.tmp.name)/'base'/'registro.sqlite');self.addCleanup(r.db.close)
        return r,r.contato(f.chave(n))

    def test_consulta_sem_whatsapp_descarta_antes_da_reserva_e_tenta_o_proximo(self):
        crm={'estado':'ok','leads':[lead('site:a','5511998887700'),lead()]}
        x=self.rodar(crm,lambda l:{'reservado':True,'texto':MSG},existe=lambda l,auth:l['id']!='site:a')
        self.assertEqual([c.args[0]['id'] for c in x.consulta.call_args_list],['site:a','site:teste'])
        self.assertEqual([c.args[0]['id'] for c in x.reservar.call_args_list],['site:teste'])
        self.assertEqual([c.args[0]['id'] for c in x.envio.call_args_list],['site:teste'])
        r,morto=self.contato('5511998887700')
        self.assertEqual(morto['estado'],'sem_whatsapp');self.assertEqual(morto['mensagem'],'');self.assertEqual(morto['recibo'],'')
        self.assertEqual(r.incertos(),[])
        final=x.estados[-1]
        self.assertNotEqual(final['estado'],'bloqueado');self.assertIsNot(x.resultados[0],False)
        self.assertEqual((final['enviados'],final['semWhatsapp']),(1,1))
        self.assertEqual([c['id'] for c in final['fila']],['site:teste'])
        self.assertNotIn('5511998887700',json.dumps(final))

    def test_consulta_que_falha_nao_envia_nao_marca_e_nao_bloqueia(self):
        crm={'estado':'ok','leads':[lead('site:a','5511998887700'),lead()]}
        x=self.rodar(crm,lambda l:{'reservado':True,'texto':MSG},existe=lambda l,auth:None)
        x.reservar.assert_not_called();x.envio.assert_not_called();x.clique.assert_not_called()
        self.assertEqual(x.consulta.call_count,2)
        self.assertNotEqual(x.estados[-1]['estado'],'bloqueado');self.assertIsNot(x.resultados[0],False)
        r,_=self.contato();self.assertEqual(r.db.execute('SELECT COUNT(*) FROM contatos').fetchone()[0],0)
        self.assertEqual(x.estados[-1]['semWhatsapp'],0)

    def test_consulta_whatsapp_numbers_so_aceita_resposta_legivel(self):
        l=lead();auth={'apikey':'fake'}
        casos=[([{'exists':True,'number':'5511998887766','jid':'x@s.whatsapp.net'}],True),([{'exists':False,'number':'5511998887766'}],False),
               ([{'exists':False}],False),([{'exists':False,'number':'5521998887766'}],None),
               ([{'exists':'false'}],None),([{'jid':'x'}],None),([],None),({'exists':False},None),('erro',None),
               ([{'exists':True,'number':'5521900000000'},{'exists':False,'number':'5511998887766'}],False)]
        for resposta,esperado in casos:
            with patch.object(f,'http',return_value=resposta) as h:self.assertIs(f.existe_no_whatsapp(l,auth),esperado,resposta)
        url,corpo,headers=h.call_args.args[:3]
        self.assertEqual(url,'http://127.0.0.1:8081/chat/whatsappNumbers/prumo');self.assertEqual(corpo,{'numbers':['5511998887766']});self.assertEqual(headers,auth)
        erro=urllib.error.HTTPError('u',500,'x',{},io.BytesIO(b'{}'));self.addCleanup(erro.close)
        for falha in (erro,TimeoutError(),urllib.error.URLError('fora'),ValueError('json ilegível')):
            with patch.object(f,'http',side_effect=falha):self.assertIsNone(f.existe_no_whatsapp(l,auth))

    def test_sendtext_400_com_exists_false_vira_sem_whatsapp_e_nao_bloqueia(self):
        def recusa(l,texto,auth):raise f.NumeroSemWhatsapp()
        crm={'estado':'ok','leads':[lead('site:a','5511998887700'),lead()]}
        x=self.rodar(crm,lambda l:{'reservado':True,'texto':MSG},
            envia=lambda l,texto,auth:recusa(l,texto,auth) if l['id']=='site:a' else 'id-real')
        self.assertEqual([c.args[0]['id'] for c in x.envio.call_args_list],['site:a','site:teste'])
        r,morto=self.contato('5511998887700')
        self.assertEqual(morto['estado'],'sem_whatsapp');self.assertEqual(r.incertos(),[])
        self.assertEqual([c.args[0]['id'] for c in x.reservar.call_args_list],['site:a','site:teste'])
        self.assertIsNot(x.resultados[0],False)
        self.assertNotEqual(x.estados[-1]['estado'],'bloqueado')
        self.assertEqual([x.estados[-1]['enviados'],x.estados[-1]['semWhatsapp']],[1,1])

    def test_sem_whatsapp_depois_do_sendtext_nao_volta_a_ser_escolhido(self):
        def recusa(l,texto,auth):raise f.NumeroSemWhatsapp()
        x=self.rodar({'estado':'ok','leads':[lead()]},lambda l:{'reservado':True,'texto':MSG},vezes=3,envia=recusa)
        self.assertEqual(x.envio.call_count,1);self.assertEqual(x.reservar.call_count,1);self.assertEqual(x.consulta.call_count,1)
        self.assertEqual(x.resultados,[None,None,None]);self.assertNotIn('bloqueado',[e['estado'] for e in x.estados])
        _,morto=self.contato();self.assertEqual(morto['estado'],'sem_whatsapp')
        self.assertEqual(x.estados[-1]['fila'],[])

    def test_sendtext_timeout_ou_500_continua_incerto_e_bloqueia(self):
        for nome,falha in (('timeout',TimeoutError('lento')),('http500',urllib.error.HTTPError('u',500,'x',{},io.BytesIO(b'{"response":{"message":[{"exists":false}]}}'))),
                           ('sem-id',RuntimeError('A integração não confirmou o destinatário e o id do envio'))):
            with self.subTest(falha=nome):
                with tempfile.TemporaryDirectory() as pasta:
                    antes=(self.tmp,self.data)
                    self.tmp=types.SimpleNamespace(name=pasta);self.data=Path(pasta)/'data';self.data.mkdir()
                    try:
                        x=self.rodar({'estado':'ok','leads':[lead()]},lambda l:{'reservado':True,'texto':MSG},envia=falha)
                        self.assertIs(x.resultados[0],False);self.assertEqual(x.estados[-1]['estado'],'bloqueado')
                        r=f.Registro(Path(pasta)/'base'/'registro.sqlite')
                        try:
                            self.assertEqual(r.contato(f.chave('5511998887766'))['estado'],'incerto');self.assertEqual(len(r.incertos()),1)
                        finally:r.db.close()
                    finally:self.tmp,self.data=antes

    def test_enviar_so_levanta_sem_whatsapp_no_400_com_exists_false_deste_numero(self):
        def erro(corpo,code=400):
            return urllib.error.HTTPError('u',code,'x',{},io.BytesIO(corpo if isinstance(corpo,bytes) else json.dumps(corpo).encode()))
        morto={'status':400,'error':'Bad Request','response':{'message':[{'jid':'5511998887766@s.whatsapp.net','exists':False,'number':'5511998887766'}]}}
        with patch.object(f,'http',side_effect=erro(morto)) as h:
            with self.assertRaises(f.NumeroSemWhatsapp):f.enviar(lead(),'Olá',{'apikey':'fake'})
            self.assertEqual(h.call_count,1)
        for e in (erro(morto,500),erro(morto,404),erro(b'<html>'),erro({'response':{'message':'texto'}}),
                  erro({'response':{'message':[{'exists':True,'number':'5511998887766'}]}}),
                  erro({'response':{'message':[{'exists':False,'number':'5521998887766'}]}}),erro({'response':{'message':[{}]}})):
            with self.subTest(code=e.code):
                with patch.object(f,'http',side_effect=e):
                    with self.assertRaises(urllib.error.HTTPError) as c:f.enviar(lead(),'Olá',{'apikey':'fake'})
                    self.assertNotIsInstance(c.exception,f.NumeroSemWhatsapp)
        with patch.object(f,'http',side_effect=TimeoutError()):
            with self.assertRaises(TimeoutError):f.enviar(lead(),'Olá',{'apikey':'fake'})

    def test_sem_whatsapp_nao_conta_como_enviado_nem_como_pendencia_nem_como_incerto(self):
        l=lead();self.r.marcar_sem_whatsapp(l,self.now)
        self.assertEqual(self.r.contato(f.chave('5511998887766'))['estado'],'sem_whatsapp')
        self.assertEqual(self.r.incertos(),[]);self.assertEqual(self.r.sem_whatsapp_do_dia('2026-10-19'),1)
        self.assertEqual(self.r.sem_whatsapp_do_dia('2026-10-18'),0)
        self.assertEqual(self.r.conferir_pendencias({'leads':[outro_produto('iris')]}),0)
        with patch.object(f,'H',Path(self.tmp.name)):self.r.reconciliar()
        self.assertEqual(self.r.contato(f.chave('5511998887766'))['estado'],'sem_whatsapp')
        self.assertEqual(f.metricas_dos_setores([l],[],{'leads':[l]},self.r,self.now),[])
        # só troca um `incerto`; nunca rebaixa um envio de verdade
        b=lead('site:b','5511998887711');self.assertTrue(self.r.reservar(b,'Olá',self.now))
        self.r.marcar_sem_whatsapp(b,self.now)
        self.assertEqual(self.r.contato(f.chave('5511998887711'))['estado'],'sem_whatsapp')
        c=lead('site:c','5511998887722');self.assertTrue(self.r.reservar(c,'Olá',self.now));self.r.confirmar(f.chave('5511998887722'),'id')
        self.r.marcar_sem_whatsapp(c,self.now)
        self.assertEqual(self.r.contato(f.chave('5511998887722'))['estado'],'enviado')

    def test_sem_whatsapp_nao_entra_em_enviados_nem_gasta_a_reserva_da_central(self):
        crm={'estado':'ok','leads':[lead()]}
        x=self.rodar(crm,lambda l:{'reservado':True,'texto':MSG},existe=lambda l,auth:False)
        final=x.estados[-1]
        self.assertEqual((final['enviados'],final['semWhatsapp']),(0,1))
        x.reservar.assert_not_called();x.envio.assert_not_called();x.clique.assert_not_called();x.nota.assert_not_called()
        self.assertEqual(sum(s['enviados'] for s in final['setores']),0)
        # a rodada seguinte lê o contador do registro, e o lead não é mais candidato
        y=self.rodar(crm,lambda l:{'reservado':True,'texto':MSG},existe=lambda l,auth:False)
        self.assertEqual((y.estados[-1]['enviados'],y.estados[-1]['semWhatsapp']),(0,1))
        y.consulta.assert_not_called();y.reservar.assert_not_called()
        self.assertNotIn('5511998887766',json.dumps(x.estados+y.estados))

    def test_pausa_preserva_o_contador_de_sem_whatsapp(self):
        (self.data/'frente-comercial.json').write_text(json.dumps({'dia':'2026-10-19','semWhatsapp':3,'fila':[]}))
        self.assertEqual(self.rodar_parado({'ativo':False}).estados[-1]['semWhatsapp'],3)

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
        self.assertEqual(final['avaliados'],10)
        self.assertEqual(sum(s['avaliados'] for s in final['setores']),10)
        primeiro=final['fila'][0]
        primeiro.update(estado='enviado')
        (self.data/'frente-comercial.json').write_text(json.dumps(final,ensure_ascii=False))
        atual=[l|{'etapa':'contato','marcos':{'enviado':f.iso(self.now)}} if l['id']==primeiro['id'] else l for l in leads]
        # Dois lotes novos de cinco por rodada: completar a carteira em rodadas sucessivas,
        # preservando o recibo anterior e sem contar candidatos ainda nao avaliados.
        for _ in range(7):
            y=self.rodar({'estado':'ok','leads':atual},lambda l:{'reservado':False,'motivo':'intervalo'})
            seguinte=y.estados[-1]
            (self.data/'frente-comercial.json').write_text(json.dumps(seguinte,ensure_ascii=False))
            if seguinte['avaliados']==61: break
        self.assertEqual(seguinte['avaliados'],61)
        self.assertEqual(sum(s['avaliados'] for s in seguinte['setores']),61)
        self.assertIn(primeiro['id'],[c['id'] for c in seguinte['fila'] if c['estado']=='enviado'])

    def test_lote_novo_preserva_aprovado_de_rodada_anterior(self):
        leads=[lead(f'site:{i}',f'5511998{i:06}') for i in range(61)]
        ultimo=leads[-1]
        anterior={'dia':'2026-10-19','fila':[{'id':ultimo['id'],'empresa':ultimo['empresa'],'produto':'site',
            'setor':f.setor(ultimo),'nota':80,'estado':'pronto','hash':f.fingerprint(ultimo),'avaliacaoVersao':f.VERSAO_AVALIACAO}]}
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
        # Desde 26/10/2026 o Site é a oferta principal e vem primeiro; as demais entram no plano e se alternam entre si.
        self.assertEqual(len(plano),44)
        self.assertEqual({l['produto'] for l in plano[:40]},{'site'})
        self.assertEqual({l['produto'] for l in plano[40:]},{'prumo','iris','estampa','plus'})

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
        # seg–sex também no relógio do .py: sexta às 18h de SP já fechou, e a fila volta na segunda às 8h.
        self.assertTrue(f.no_expediente(dt.datetime(2026,10,23,20,30,tzinfo=dt.timezone.utc)))
        self.assertTrue(f.no_expediente(dt.datetime(2026,10,23,20,59,59,tzinfo=dt.timezone.utc)))
        sexta_fechou=dt.datetime(2026,10,23,21,0,tzinfo=dt.timezone.utc)
        self.assertFalse(f.no_expediente(sexta_fechou))
        self.assertEqual(f.proximo_expediente(sexta_fechou).isoformat(),'2026-10-26T08:00:00-03:00')
        contato=(raiz/'src/operations/primeiro-contato.ts').read_text(encoding='utf-8')
        tipo=re.search(r'export type RecusaDoTime\s*=([^\n]+)',contato).group(1)
        ritmo=re.search(r'MotivoDoRitmo\s*=\s*([^\n]+)',(raiz/'src/operations/trava-de-ritmo.ts').read_text(encoding='utf-8')).group(1)
        literais=lambda t:set(re.findall(r"'([a-z-]+)'",t))
        todas=literais(tipo)|literais(ritmo)
        gerais=literais(re.search(r'RECUSAS_GERAIS[^=]*=\s*new Set\(\[([^\]]+)\]\)',contato).group(1))
        self.assertEqual(set(f.RECUSAS_DO_LEAD)|gerais,todas,'a Central ganhou ou perdeu uma recusa: decida se é do lead ou geral')
        self.assertFalse(set(f.RECUSAS_DO_LEAD)&gerais)

    # 6. Envio `incerto` (20/10/2026): não bloqueia o time para sempre, e ninguém fica sem saber que ele parou.
    CHAVE='11'+'98887766'

    def semear_incerto(self,minutos,l=None):
        """Um envio ambíguo reservado `minutos` antes de self.now, com o plano do dia (de onde vem o nome da empresa)."""
        l=l or lead()
        r=f.Registro(Path(self.tmp.name)/'base'/'registro.sqlite')
        try:
            r.plano('2026-10-19',[l]);self.assertTrue(r.reservar(l,MSG,self.now-dt.timedelta(minutes=minutos)))
        finally:r.db.close()

    def conversa(self,*linhas,bruto=None):
        p=Path(self.tmp.name)/'.local/share/whatsapp-conversas'/f'{self.CHAVE}.jsonl';p.parent.mkdir(parents=True,exist_ok=True)
        p.write_bytes(bruto if bruto is not None else ('\n'.join(json.dumps(x) if isinstance(x,dict) else x for x in linhas)+'\n').encode())

    def saida(self,minutos,texto=MSG,id_='3EB0REAL'):
        return {'direcao':'saida','texto':texto,'id':id_,'em':f.iso(self.now-dt.timedelta(minutes=minutos))}

    def estado_do_contato(self):
        # Abre e fecha na hora: no Windows um registro aberto impede apagar a pasta temporária do subteste.
        r=f.Registro(Path(self.tmp.name)/'base'/'registro.sqlite')
        try:return r.contato(self.CHAVE)['estado']
        finally:r.db.close()

    def rodar_incerto(self,vezes=1):
        return self.rodar({'estado':'ok','leads':[lead()]},lambda l:{'reservado':True,'texto':MSG},vezes=vezes)

    def test_incerto_recente_bloqueia_e_avisa_uma_vez(self):
        self.semear_incerto(5)
        x=self.rodar_incerto(vezes=3)
        self.assertEqual(x.estados[-1]['estado'],'bloqueado');self.assertIn('até 15 min',x.estados[-1]['detalhe'])
        self.assertEqual(self.estado_do_contato(),'incerto')
        x.reservar.assert_not_called();x.envio.assert_not_called()
        self.assertEqual(len(self.avisos),1)
        a=self.avisos[0]
        self.assertIn('Empresa de teste',a['texto']);self.assertIn('15 min',a['texto']);self.assertEqual(a['prioridade'],2)
        self.assertTrue(a['chave'].startswith('frente-comercial:incerto:'))
        # sem telefone, sem número parcial, sem valor
        for dado in ('5511998887766','98887766','R$'):self.assertNotIn(dado,json.dumps(self.avisos,ensure_ascii=False))
        # a rodada seguinte, noutro processo (o estado vem do arquivo de alertas), não repete
        self.rodar_incerto();self.assertEqual(len(self.avisos),1)

    def test_incerto_de_mais_de_15_min_com_observador_vivo_e_sem_saida_vira_sem_confirmacao(self):
        self.semear_incerto(16)
        x=self.rodar_incerto(vezes=2)
        final=x.estados[-1]
        self.assertNotEqual(final['estado'],'bloqueado');self.assertIsNot(x.resultados[0],False)
        r,c=self.contato();self.assertEqual(c['estado'],'sem_confirmacao');self.assertEqual(r.incertos(),[])
        self.assertEqual(c['mensagem'],MSG);self.assertEqual(c['recibo'],'')
        # nunca reenvia, nunca pede reserva, o lead sai da fila e não conta como enviado
        x.envio.assert_not_called();x.reservar.assert_not_called();x.consulta.assert_not_called();x.clique.assert_not_called()
        self.assertEqual((final['enviados'],final['semWhatsapp'],final['semConfirmacao']),(0,0,1))
        self.assertEqual(final['fila'],[]);self.assertEqual(sum(s['enviados'] for s in final['setores']),0)
        confira=[a for a in self.avisos if 'Confira no WhatsApp' in a['titulo']]
        self.assertEqual(len(confira),1,self.avisos)
        self.assertIn('Empresa de teste',confira[0]['texto']);self.assertIn('NÃO vai reenviar',confira[0]['texto']);self.assertEqual(confira[0]['prioridade'],1)
        for dado in ('5511998887766','98887766','R$'):self.assertNotIn(dado,json.dumps(self.avisos,ensure_ascii=False))

    def test_incerto_de_mais_de_15_min_com_observador_fora_continua_incerto_e_bloqueado(self):
        self.semear_incerto(16);self.observador.return_value=False
        x=self.rodar_incerto()
        self.assertEqual(x.estados[-1]['estado'],'bloqueado');self.assertIn('mais de 15 min',x.estados[-1]['detalhe'])
        self.assertEqual(self.estado_do_contato(),'incerto')
        x.envio.assert_not_called();self.assertEqual([a for a in self.avisos if 'Confira' in a['titulo']],[])
        # sem evidência não resolve nem horas depois
        self.now+=dt.timedelta(hours=3);y=self.rodar_incerto()
        self.assertEqual(self.estado_do_contato(),'incerto');self.assertEqual(y.estados[-1]['estado'],'bloqueado')

    def test_incerto_com_saida_exata_na_conversa_vira_enviado_como_antes(self):
        self.semear_incerto(16);self.conversa(self.saida(15))
        x=self.rodar_incerto()
        _,c=self.contato();self.assertEqual((c['estado'],c['recibo']),('enviado','3EB0REAL'))
        x.envio.assert_not_called();self.assertEqual([a for a in self.avisos if 'Confira' in a['titulo']],[])
        self.assertEqual(x.estados[-1]['semConfirmacao'],0)

    def test_conversa_ilegivel_ou_duvidosa_nao_resolve(self):
        casos={'linha torta':dict(linhas=('{não é json',)),'bytes inválidos':dict(bruto=b'\xff\xfe\x00{"a":1}\n'),
               'saída exata sem id':dict(linhas=(self.saida(15,id_=None),)),
               'saída exata fora da janela':dict(linhas=(self.saida(-5),)),   # 5 min DEPOIS do instante atual, além da janela de 900 s
               'arquivo grande demais':dict(bruto=b'x'*5_000_001)}
        for nome,caso in casos.items():
            with self.subTest(nome):
                with tempfile.TemporaryDirectory() as pasta:
                    antes=(self.tmp,self.data)
                    self.tmp=types.SimpleNamespace(name=pasta);self.data=Path(pasta)/'data';self.data.mkdir()
                    try:
                        self.semear_incerto(16)
                        self.conversa(*caso.get('linhas',()),bruto=caso.get('bruto'))
                        x=self.rodar_incerto()
                        self.assertEqual(self.estado_do_contato(),'incerto');self.assertEqual(x.estados[-1]['estado'],'bloqueado')
                        x.envio.assert_not_called()
                    finally:self.tmp,self.data=antes

    def test_conversa_legivel_sem_a_mensagem_conta_como_sem_saida(self):
        # a conversa existe (ele escreveu, ou o Rômulo disse outra coisa), mas a mensagem do time não está lá
        self.semear_incerto(16);self.conversa(self.saida(14,texto='Outra coisa'),{'direcao':'entrada','texto':MSG,'id':'x','em':f.iso(self.now)})
        self.rodar_incerto()
        self.assertEqual(self.estado_do_contato(),'sem_confirmacao')

    def test_sem_confirmacao_so_troca_incerto_e_nao_conta_como_enviado_nem_pendencia(self):
        l=lead();self.assertTrue(self.r.reservar(l,MSG,self.now))
        self.assertTrue(self.r.marcar_sem_confirmacao(f.chave('5511998887766'),self.now))
        self.assertEqual(self.r.contato(f.chave('5511998887766'))['estado'],'sem_confirmacao')
        self.assertEqual(self.r.incertos(),[]);self.assertEqual(self.r.sem_confirmacao_do_dia('2026-10-19'),1)
        self.assertEqual(self.r.sem_confirmacao_do_dia('2026-10-18'),0);self.assertEqual(self.r.sem_whatsapp_do_dia('2026-10-19'),0)
        self.assertEqual(self.r.conferir_pendencias({'leads':[outro_produto('iris')]}),0)
        with patch.object(f,'H',Path(self.tmp.name)):self.r.reconciliar()
        self.assertEqual(self.r.contato(f.chave('5511998887766'))['estado'],'sem_confirmacao')
        self.assertEqual(f.metricas_dos_setores([l],[],{'leads':[l]},self.r,self.now),[])
        # a chave nunca é apagada: o lead não volta a ser reservado
        self.assertFalse(self.r.reservar(l,MSG,self.now))
        # nunca rebaixa um envio de verdade nem muda o que já não é `incerto`
        c=lead('site:c','5511998887722');self.assertTrue(self.r.reservar(c,MSG,self.now));self.r.confirmar(f.chave('5511998887722'),'id')
        self.assertFalse(self.r.marcar_sem_confirmacao(f.chave('5511998887722'),self.now))
        self.assertEqual(self.r.contato(f.chave('5511998887722'))['estado'],'enviado')
        b=lead('site:b','5511998887711');self.r.marcar_sem_whatsapp(b,self.now)
        self.assertFalse(self.r.marcar_sem_confirmacao(f.chave('5511998887711'),self.now))
        self.assertEqual(self.r.contato(f.chave('5511998887711'))['estado'],'sem_whatsapp')

    def test_time_segue_para_o_proximo_depois_de_encerrar_o_incerto(self):
        outro=lead('site:outro','5511998887700')
        self.semear_incerto(16)
        x=self.rodar({'estado':'ok','leads':[lead(),outro]},lambda l:{'reservado':True,'texto':MSG})
        self.assertEqual([c.args[0]['id'] for c in x.envio.call_args_list],['site:outro'])
        self.assertEqual(self.estado_do_contato(),'sem_confirmacao')
        self.assertEqual(x.estados[-1]['enviados'],1);self.assertEqual(x.estados[-1]['semConfirmacao'],1)

    def test_pausa_preserva_o_contador_de_sem_confirmacao(self):
        (self.data/'frente-comercial.json').write_text(json.dumps({'dia':'2026-10-19','semConfirmacao':2,'fila':[]}))
        self.assertEqual(self.rodar_parado({'ativo':False}).estados[-1]['semConfirmacao'],2)

    # 7. Aviso de "parado": mais de 10 min seguidos no expediente, no máximo a cada 60 min, e "voltou".
    def bloqueado(self,detalhe='Envio confirmado, mas o registro no CRM não foi confirmado.',**extra):
        return {'estado':'bloqueado','detalhe':detalhe,**extra}

    def acompanhar(self,estado,minutos=0,base=None):
        agora_=(base or self.now)+dt.timedelta(minutes=minutos)
        with patch.object(f,'DATA',self.data):f.acompanhar_bloqueio(estado,agora_)
        return agora_

    def parados(self):return [a for a in self.avisos if 'parado' in a['titulo']]

    def voltou(self):return [a for a in self.avisos if 'voltou' in a['titulo']]

    def test_bloqueio_so_avisa_depois_de_10_min_seguidos_e_repete_a_cada_60(self):
        self.acompanhar(self.bloqueado(),0);self.acompanhar(self.bloqueado(),9);self.assertEqual(self.avisos,[])
        self.acompanhar(self.bloqueado(),10)
        self.assertEqual(len(self.parados()),1)
        a=self.parados()[0];self.assertIn('parado há 10 min',a['texto']);self.assertIn('registro no CRM',a['texto']);self.assertEqual(a['prioridade'],1)
        for m in (11,40,69):self.acompanhar(self.bloqueado(),m)
        self.assertEqual(len(self.parados()),1)
        self.acompanhar(self.bloqueado(),70)
        self.assertEqual(len(self.parados()),2);self.assertIn('parado há 70 min',self.parados()[1]['texto'])
        self.assertNotEqual(self.parados()[0]['chave'],self.parados()[1]['chave'])   # a chave de 24 h do dell-status não engole a repetição
        self.acompanhar(self.bloqueado(),129);self.assertEqual(len(self.parados()),2)
        self.acompanhar(self.bloqueado(),130);self.assertEqual(len(self.parados()),3)

    def test_bloqueio_sobrevive_a_reinicio_e_o_detalhe_leva_o_nome_do_erro(self):
        self.acompanhar(self.bloqueado(),0)
        self.assertTrue((self.data/'frente-comercial-alertas.json').exists())
        # outro processo: o relógio vem do arquivo, não da memória
        self.acompanhar(self.bloqueado('O time interrompeu novos contatos.',falha='TimeoutError'),12)
        self.assertIn('(erro: TimeoutError)',self.parados()[0]['texto']);self.assertIn('parado há 12 min',self.parados()[0]['texto'])

    def test_bloqueio_que_acaba_avisa_que_voltou_e_zera_o_relogio(self):
        self.acompanhar(self.bloqueado(),0);self.acompanhar(self.bloqueado(),10)
        self.acompanhar({'estado':'pronto','detalhe':'ok'},12)
        self.assertEqual(len(self.voltou()),1);self.assertIn('Time comercial voltou',self.voltou()[0]['texto'])
        self.acompanhar({'estado':'pronto'},13);self.assertEqual(len(self.voltou()),1)
        # um novo bloqueio começa do zero
        self.acompanhar(self.bloqueado(),14);self.acompanhar(self.bloqueado(),20);self.assertEqual(len(self.parados()),1)
        self.acompanhar(self.bloqueado(),24);self.assertEqual(len(self.parados()),2)

    def test_bloqueio_curto_que_acaba_antes_dos_10_min_nao_avisa_nada(self):
        self.acompanhar(self.bloqueado(),0);self.acompanhar({'estado':'pronto'},5);self.acompanhar({'estado':'pronto'},30)
        self.assertEqual(self.avisos,[])
        self.assertNotIn('desde',json.loads((self.data/'frente-comercial-alertas.json').read_text()))

    def test_pausa_do_operador_encerra_o_bloqueio_sem_dizer_que_voltou(self):
        self.acompanhar(self.bloqueado(),0);self.acompanhar(self.bloqueado(),10)
        self.acompanhar({'estado':'pausado','detalhe':'pausado'},11)
        self.assertEqual(self.voltou(),[])
        self.acompanhar(self.bloqueado(),12);self.acompanhar(self.bloqueado(),15);self.assertEqual(len(self.parados()),1)

    def test_fora_do_expediente_nao_avisa_parado_e_o_relogio_conta_da_abertura(self):
        noite=dt.datetime(2026,10,19,22,tzinfo=dt.timezone.utc)   # 19h em SP
        self.acompanhar(self.bloqueado(),0,base=noite);self.acompanhar(self.bloqueado(),180,base=noite);self.assertEqual(self.avisos,[])
        # 8h00 de SP do dia seguinte: o bloqueio da véspera não vira "parado há 13 h"
        abertura=dt.datetime(2026,10,20,11,tzinfo=dt.timezone.utc)
        self.acompanhar(self.bloqueado(),0,base=abertura);self.acompanhar(self.bloqueado(),9,base=abertura);self.assertEqual(self.avisos,[])
        self.acompanhar(self.bloqueado(),11,base=abertura)
        self.assertEqual(len(self.parados()),1);self.assertIn('parado há 11 min',self.parados()[0]['texto'])
        # sábado também é fora do expediente
        sab=dt.datetime(2026,10,24,15,tzinfo=dt.timezone.utc)
        self.acompanhar(self.bloqueado(),0,base=sab);self.acompanhar(self.bloqueado(),600,base=sab);self.assertEqual(len(self.parados()),1)

    def test_voltou_fora_do_expediente_espera_a_abertura(self):
        self.acompanhar(self.bloqueado(),0);self.acompanhar(self.bloqueado(),10)
        noite=dt.datetime(2026,10,19,22,tzinfo=dt.timezone.utc)
        self.acompanhar({'estado':'fora-do-horario'},0,base=noite)
        self.assertEqual(self.voltou(),[])
        manha=dt.datetime(2026,10,20,11,5,tzinfo=dt.timezone.utc)
        self.acompanhar({'estado':'avaliando'},0,base=manha);self.assertEqual(len(self.voltou()),1)
        self.acompanhar({'estado':'avaliando'},1,base=manha);self.assertEqual(len(self.voltou()),1)

    def test_aviso_que_nao_entra_na_fila_tenta_de_novo_so_depois_de_5_min(self):
        chamadas=[]
        with patch.object(f,'avisar_time',side_effect=lambda *a,**k:chamadas.append(1) or False):
            self.acompanhar(self.bloqueado(),0)
            for m in (10,11,14):self.acompanhar(self.bloqueado(),m)
            self.assertEqual(len(chamadas),1)
            self.acompanhar(self.bloqueado(),15);self.assertEqual(len(chamadas),2)

    def test_bloqueio_de_ponta_a_ponta_pela_rodada(self):
        def marcar(l,texto):raise RuntimeError('n8n fora')
        base=self.now
        for minutos in (0,5,11,30,71):
            self.now=base+dt.timedelta(minutes=minutos)
            x=self.rodar({'estado':'ok','leads':[lead()]},lambda l:{'reservado':True,'texto':MSG},marcar=marcar)
            self.assertEqual(x.estados[-1]['estado'],'bloqueado');self.assertEqual(x.estados[-1]['falha'],'RuntimeError')
        self.assertEqual(len(self.parados()),2)
        self.assertIn('parado há 11 min',self.parados()[0]['texto']);self.assertIn('parado há 71 min',self.parados()[1]['texto'])
        self.assertIn('(erro: RuntimeError)',self.parados()[0]['texto'])
        self.now+=dt.timedelta(minutes=1)
        x=self.rodar({'estado':'ok','leads':[lead()]},lambda l:{'reservado':True,'texto':MSG})
        self.assertEqual(x.envio.call_count,1);self.assertEqual(len(self.voltou()),1)

    def test_falha_do_aviso_nunca_derruba_a_rodada_nem_muda_o_estado(self):
        self.semear_incerto(5)
        com=self.rodar_incerto()
        for nome,duble in (('aviso que levanta',patch.object(f,'avisar_time',side_effect=OSError('disco cheio'))),
                           ('alertas que não gravam',patch.object(f,'gravar_alertas',side_effect=OSError('somente leitura'))),
                           ('observador que não responde',patch.object(self.observador,'side_effect',OSError('systemctl sumiu')))):
            with self.subTest(nome),duble:
                x=self.rodar_incerto()
                self.assertEqual(x.estados[-1]['estado'],'bloqueado');self.assertEqual(x.estados[-1]['detalhe'],com.estados[-1]['detalhe'])
                self.assertIsNot(x.resultados[0],False);self.assertEqual(self.estado_do_contato(),'incerto')
        # e o mesmo para o acompanhamento do bloqueio (o aviso de "parado")
        with patch.object(f,'avisar_time',side_effect=RuntimeError('fila')):
            for m in (0,11,80):self.acompanhar(self.bloqueado(),m)

    def test_avisar_time_grava_na_fila_com_a_origem_exclusiva_e_nunca_levanta(self):
        with tempfile.TemporaryDirectory() as pasta:
            fila=Path(pasta)/'fila';fila.mkdir()
            with patch.dict(os.environ,{'SQUADONE_AVISOS_FILA':str(fila)}):
                self.assertTrue(AVISAR_REAL('⏸️ Time comercial parado','Time comercial parado há 11 min: x','frente-comercial:parado:abc:0',prioridade=1))
                arquivos=list(fila.glob('*.json'));self.assertEqual(len(arquivos),1)
                d=json.loads(arquivos[0].read_text(encoding='utf-8'))
                self.assertEqual((d['origem'],d['chave'],d['prioridade']),('frente-comercial','frente-comercial:parado:abc:0',1))
                self.assertNotIn('expira_em',d)   # origem exclusiva do Telegram: a lib tira a expiração
                # "R$" a lib recusa: devolve False em vez de levantar
                self.assertFalse(AVISAR_REAL('t','custa R$ 10','c'))
            with patch.dict(os.environ,{'SQUADONE_AVISOS_FILA':str(Path(pasta)/'nao-existe')}):
                self.assertFalse(AVISAR_REAL('t','x','c'))
            with patch.object(f,'lib_de_aviso',side_effect=RuntimeError('lib quebrada')):self.assertFalse(AVISAR_REAL('t','x','c'))
            with patch.object(f,'lib_de_aviso',return_value=None):self.assertFalse(AVISAR_REAL('t','x','c'))

    def test_empresa_do_aviso_nao_leva_telefone_nem_valor(self):
        r=f.Registro(Path(self.tmp.name)/'x.sqlite');self.addCleanup(r.db.close)
        r.plano('2026-10-19',[lead()|{'empresa':'Oficina R$ 5 11998887766 Ltda'},lead('site:b','5511998887700')])
        self.assertEqual(r.empresa_do('site:teste'),'Oficina 5 Ltda')
        self.assertEqual(r.empresa_do('site:b'),'Empresa de teste');self.assertEqual(r.empresa_do('site:nao-existe'),'um lead')

    def test_origem_do_aviso_esta_nas_tres_listas_de_origens_exclusivas_do_telegram(self):
        raiz=Path(__file__).resolve().parents[2]
        for arquivo,constante in (('deploy/dell/dell-status.py','ORIGENS_PELO_TELEGRAM'),('deploy/dell/lib/aviso.py','ORIGENS_TELEGRAM_EXCLUSIVO')):
            texto=(raiz/arquivo).read_text(encoding='utf-8')
            lista=re.search(rf'^{constante}\s*=\s*\{{([^}}]*)\}}',texto,re.MULTILINE).group(1)
            self.assertIn(f.ORIGEM_DO_AVISO,re.findall(r'"([^"]+)"',lista),arquivo)
        self.assertIn(f"'{f.ORIGEM_DO_AVISO}'",(raiz/'server/avisos.ts').read_text(encoding='utf-8'))

    def test_observador_ativo_pergunta_ao_systemd_e_na_duvida_diz_que_nao(self):
        for retorno,esperado in ((0,True),(3,False)):
            with patch.object(f.subprocess,'run',return_value=types.SimpleNamespace(returncode=retorno)) as run:
                self.assertIs(OBSERVADOR_REAL(),esperado)
            self.assertEqual(run.call_args.args[0][:3],['systemctl','--user','is-active']);self.assertIn('whatsapp-observador-prumo',run.call_args.args[0])
        for falha in (FileNotFoundError(),f.subprocess.TimeoutExpired('systemctl',10)):
            with patch.object(f.subprocess,'run',side_effect=falha):self.assertIs(OBSERVADOR_REAL(),False)

class ProtecaoDaConta(unittest.TestCase):
    def test_previsao_do_proximo_contato_usa_o_intervalo_confirmado_pela_central(self):
        estado={}
        with patch.object(f,'http',return_value={'ativo':True,'pausaAutomatica':None,'intervaloMinutos':30}):
            self.assertTrue(f.protecao_permite_envio(estado))
        self.assertEqual(estado['intervaloMinutos'],30)
        for invalido in (None,True,0,-1,'30',float('inf')):
            with patch.object(f,'http',return_value={'ativo':True,'pausaAutomatica':None,'intervaloMinutos':invalido}):
                self.assertTrue(f.protecao_permite_envio(estado))
            self.assertEqual(estado['intervaloMinutos'],30)

    def test_conferencia_final_falha_fechada(self):
        for resposta in ({},{'ativo':True},{'ativo':False,'pausaAutomatica':None},{'ativo':True,'pausaAutomatica':{'motivo':'recusa'}}):
            with patch.object(f,'http',return_value=resposta):self.assertFalse(f.protecao_permite_envio())
        with patch.object(f,'http',return_value={'ativo':True,'pausaAutomatica':None}):self.assertTrue(f.protecao_permite_envio())

    def test_sinais_explicitos_e_recusas_sem_confundir_destinatario(self):
        self.assertEqual(f.sinal_da_recusa(500,{'message':'account is restricted'}),'restricao')
        self.assertEqual(f.sinal_da_recusa(403,{'message':'Forbidden'}),'recusa')
        self.assertEqual(f.sinal_da_recusa(429,{'message':'Too many requests'}),'recusa')
        self.assertIsNone(f.sinal_da_recusa(400,{'message':'recipient blocked'}))
        self.assertIsNone(f.sinal_da_recusa(500,{'message':'temporary service error'}))

    def test_sinal_persiste_antes_do_http_e_sem_payload_privado(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(f,'DATA',Path(tmp)):
            def sem_central(*args,**kwargs):
                dado=json.loads((Path(tmp)/'prospeccao-sinal.json').read_text())
                self.assertEqual(set(dado),{'sinal','em'});self.assertEqual(dado['sinal'],'restricao')
                raise TimeoutError()
            with patch.object(f,'http',side_effect=sem_central):f.relatar_sinal('restricao')
            self.assertTrue((Path(tmp)/'prospeccao-sinal.json').exists())

    def test_erro_de_envio_pausa_sem_reenviar(self):
        for code,corpo,sinal in ((403,{'message':'Forbidden'},'recusa'),(429,{},'recusa'),(500,{'message':'account banned'},'restricao')):
            erro=urllib.error.HTTPError('u',code,'x',{},io.BytesIO(json.dumps(corpo).encode()))
            with patch.object(f,'http',side_effect=erro) as envio,patch.object(f,'relatar_sinal') as relatar:
                with self.assertRaises(urllib.error.HTTPError):f.enviar(lead(),'Olá',{'apikey':'fake'})
                self.assertEqual(envio.call_count,1);relatar.assert_called_once_with(sinal)

if __name__=='__main__':unittest.main()
