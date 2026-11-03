"""Casos de identidade, isolamento de rede e preservação comercial; sem rede real."""
import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).parent))
import pesquisa_leads as p
import calendario_comercial as cal


def lead(id_='a',produto='site',number='5511999998888'):
    return {'id':produto+':'+id_,'produto':produto,'empresa':'Aurora Teste','cidade':'Campinas','etapa':'novo',
            'marcos':{},'links':{'whatsapp':'https://wa.me/'+number},'achados':[{'id':'sem-site'}]}


class Pesquisa(unittest.TestCase):
    def test_campanha_pesquisa_so_site_autorizado_sem_reciclar_historico(self):
        a=lead('a');b=lead('b');i=lead('c','iris');historico=lead('d')|{'etapa':'contato'}
        c={'versao':1,'ativo':True,'produto':'site','inicioPreparacao':'2026-11-01',
           'inicioEnvios':'2026-11-03','fimEnvios':'2026-11-06',
           'leadsAutorizados':[a['id'],i['id'],historico['id']]}
        with patch.object(p,'agora',return_value=dt.datetime(2026,11,1,15,tzinfo=dt.timezone.utc)):
            self.assertEqual(p.selecionar({'leads':[a,b,i,historico]}, {}, [], 10, c), [a])
        with patch.object(p,'agora',return_value=dt.datetime(2026,11,7,15,tzinfo=dt.timezone.utc)):
            self.assertEqual(p.selecionar({'leads':[a,b,i,historico]}, {}, [], 10, c), [])

    def test_cnpj_verifica_digitos_e_rejeita_repeticao(self):
        self.assertTrue(p.cnpj_valido('33.683.111/0002-80'))
        self.assertFalse(p.cnpj_valido('33683111000281'))
        self.assertFalse(p.cnpj_valido('00000000000000'))

    def test_cnpj_associacao_exige_cidade_e_nome(self):
        d={'nome_fantasia':'Aurora Teste','municipio':'Campinas'}
        self.assertTrue(p.vinculo_cnpj(lead(),d))
        self.assertFalse(p.vinculo_cnpj(lead(),d|{'municipio':'Curitiba'}))

    def test_nao_importa_contatos_de_site_homonimo(self):
        r=p.analisar_pagina(lead(),{'lida':True,'url':'https://outro.example','html':'<title>Outra empresa</title><p>CNPJ 33.683.111/0002-80</p><a href="https://wa.me/5511999998888">Contato</a>'})
        self.assertFalse(r['identidadeConfirmada']);self.assertEqual(r['cnpjsPublicados'],[]);self.assertEqual(r['whatsappsPublicados'],[])

    def test_site_identificado_extrai_somente_links_whatsapp_publicados(self):
        r=p.analisar_pagina(lead(),{'lida':True,'url':'https://aurora.example','html':'<title>Aurora Teste Campinas</title><p>Campinas. Infantil. CNPJ 33.683.111/0002-80. Telefone 11988887777</p><a href="https://wa.me/5511999998888">Contato</a>'})
        self.assertTrue(r['identidadeConfirmada']);self.assertEqual(r['cnpjsPublicados'],['33683111000280']);self.assertEqual(r['whatsappsPublicados'],['5511999998888']);self.assertTrue(r['publicoInfantilTea'])

    def test_telefone_em_texto_nao_vira_whatsapp(self):
        r=p.analisar_pagina(lead(),{'lida':True,'url':'https://aurora.example','html':'<title>Aurora Teste</title><p>Telefone 5511999998888</p>'})
        self.assertEqual(r['whatsappsPublicados'],[])

    def test_script_nao_confirma_publico(self):
        r=p.analisar_pagina(lead(),{'lida':True,'url':'https://aurora.example','html':'<title>Aurora Teste</title><script>infantil autismo</script>'})
        self.assertFalse(r['publicoInfantilTea'])

    def test_cnpj_divergente_na_resposta_nao_e_aceito(self):
        with patch.object(p,'json_http',return_value={'cnpj':'00000000000000'}):
            with self.assertRaises(ValueError):p.consultar_cnpj('33683111000280')

    def test_apis_cnpj_nao_sao_duas_confirmacoes(self):
        with patch.object(p,'json_http',side_effect=[TimeoutError(),{'cnpj':'33683111000280'}]) as f:
            self.assertEqual(p.consultar_cnpj('33683111000280')['provedor'],'BrasilAPI (Minha Receita)')
            self.assertEqual(f.call_count,2)

    def test_rede_recusa_tailnet_loopback_ipv6_e_dns_misto(self):
        for url in ['http://localhost/x','http://empresa.local/x','https://maquina.ts.net','https://user:senha@empresa.example','https://empresa.example:8443']:
            with self.assertRaises(ValueError):p.url_publica(url)
        for ips in [['127.0.0.1'],['100.68.136.88'],['::1'],['8.8.8.8','10.0.0.1']]:
            with patch.object(p.socket,'getaddrinfo',return_value=[(2,1,6,'',(ip,443)) for ip in ips]):
                with self.assertRaises(ValueError):p.url_publica('https://empresa.example')

    def test_ip_publico_e_fixado(self):
        with patch.object(p.socket,'getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))]):
            self.assertEqual(p.url_publica('https://empresa.example')[1],'8.8.8.8')

    def test_conversa_protegida_bloqueia_duplicata_entre_ofertas(self):
        antigo=lead('a','iris')|{'etapa':'contato','conversa':{'ultimaEntrada':'2026-10-30'}}
        novo=lead('b');data={'leads':[antigo,novo]};before=copy.deepcopy(data)
        rows={r['id']:r for r in p.higienizar(data,{})}
        self.assertEqual(rows[antigo['id']]['estado'],'historico-protegido')
        self.assertIn('destino-com-historico-em-outra-ficha',rows[novo['id']]['motivos']);self.assertEqual(data,before)

    def test_destino_duplicado_tem_um_so_candidato(self):
        rows=p.higienizar({'leads':[lead('b'),lead('a')]},{})
        self.assertEqual(sum(r['estado']=='candidato-a-avaliacao' for r in rows),1)
        self.assertEqual(sum('destino-duplicado' in r['motivos'] for r in rows),1)

    def test_qualificacao_desconhecida_nao_vira_descarte(self):
        rows=p.higienizar({'leads':[lead('a','estampa')]},{})
        self.assertEqual(rows[0]['estado'],'revisar')
        self.assertIn('necessidade-impacto-decisor-a-confirmar',rows[0]['motivos'])

    def test_http_erro_nao_comprova_site_ausente(self):
        l=lead();d={'assinatura':p.assinatura(l),'em':p.agora().isoformat(),'pagina':{'estado':'inconclusivo','http':503}}
        self.assertEqual(p.bloqueios_pesquisa(l,d),[])

    def test_site_ativo_contradiz_ausencia_mas_nao_outra_lacuna(self):
        l=lead();d={'assinatura':p.assinatura(l),'em':p.agora().isoformat(),'pagina':{'identidadeConfirmada':True,'url':'https://aurora.example'}}
        self.assertIn('site-proprio-ativo-contradiz-abordagem',p.bloqueios_pesquisa(l,d))
        l['achados'].append({'id':'site-sem-celular-ou-whatsapp'})
        self.assertEqual(p.bloqueios_pesquisa(l,d),[])

    def test_cnpj_inativo_so_bloqueia_quando_vinculo_confirmado(self):
        l=lead();d={'assinatura':p.assinatura(l),'em':p.agora().isoformat(),'cnpj':{'situacao_cadastral':8}}
        self.assertEqual(p.bloqueios_pesquisa(l,d),[])
        d['cnpj']['vinculoConfirmado']=True;self.assertIn('cnpj-inativo-confirmado',p.bloqueios_pesquisa(l,d))

    def test_ficha_alterada_ou_pesquisa_vencida_exige_revisao(self):
        l=lead();d={'assinatura':p.assinatura(l),'em':(p.agora()-dt.timedelta(days=8)).isoformat()}
        self.assertEqual(p.bloqueios_pesquisa(l,d),['pesquisa-vencida'])
        l['empresa']='Outra';self.assertEqual(p.bloqueios_pesquisa(l,d),['pesquisa-contexto-alterado'])

    def test_fonte_parcial_nao_higieniza(self):
        for c in [{'estado':'falha'},{'estado':'ok','leads':[lead()],'geradoEm':p.agora().isoformat(),'fontes':[{'erro':'falha'}]}]:
            with self.assertRaises(ValueError):p.validar_crm(c,p.agora())

    def test_places_nao_persiste_conteudo(self):
        l=lead('ChIJteste123456789')
        with patch.object(p,'json_http') as fetch,patch.object(p,'pagina_publica',return_value={'lida':False,'url':'https://aurora.example','http':503}):
            r=p.enriquecer(l,'segredo-falso')
        fetch.assert_not_called()
        self.assertNotIn('segredo-falso',json.dumps(r));self.assertNotIn('displayName',json.dumps(r));self.assertNotIn('websiteUri',json.dumps(r))

    def test_salvar_atomico_preserva_dados_e_permissoes(self):
        with tempfile.TemporaryDirectory() as t:
            f=Path(t)/'estado.json';p.salvar(f,{'v':1});p.salvar(f,{'v':2});self.assertEqual(p.ler(f),{'v':2});self.assertEqual(list(Path(t).glob('*.tmp')),[])

    def test_apify_sem_chave_nao_chama_terceiro(self):
        with patch.object(p,'ambientes',return_value={}),patch.object(p,'json_http') as fetch:
            self.assertEqual(p.linkedin_apify({})['estado'],'desabilitado-custo-zero');fetch.assert_not_called()

    def test_apify_criacao_incerta_nao_repete_cobranca(self):
        with tempfile.TemporaryDirectory() as t,patch.object(p,'BASE',Path(t)),patch.object(p,'ambientes',return_value={'APIFY_TOKEN':'falso'}),patch.object(p,'json_http',side_effect=TimeoutError()) as fetch:
            data={'fiscal:1':{'produto':'fiscal','pagina':{'linkedin':['https://www.linkedin.com/company/aurora-teste/']}}}
            p.linkedin_apify(data);p.linkedin_apify(data)
            fetch.assert_not_called()
            self.assertFalse((Path(t)/'apify-journal.json').exists())

    def test_apify_nao_aceita_perfil_pessoal_ou_host_parecido(self):
        with tempfile.TemporaryDirectory() as t,patch.object(p,'BASE',Path(t)),patch.object(p,'ambientes',return_value={'APIFY_TOKEN':'falso'}),patch.object(p,'json_http') as fetch:
            for url in ['https://linkedin.com/in/pessoa','https://linkedin.com.evil.example/company/teste']:
                p.linkedin_apify({'fiscal:1':{'produto':'fiscal','pagina':{'linkedin':[url]}}})
            fetch.assert_not_called()

    def test_calendario_finados_e_pesquisa_independente(self):
        sunday=dt.datetime.fromisoformat('2026-11-01T12:00:00-03:00')
        self.assertEqual(cal.proximo_expediente(sunday).isoformat(),'2026-11-03T08:00:00-03:00')
        self.assertEqual(cal.proximo_expediente(dt.datetime.fromisoformat('2026-11-03T10:00:00-03:00')).hour,10)

    def test_n8n_melhoria_recursiva_idempotente_sem_retry_em_escrita(self):
        folder=Path(__file__).parent/'claude-ops'
        sys.path.insert(0,str(folder if folder.exists() else Path(__file__).parent))
        from pesquisa_fluxos import melhorar_cacador
        search={'name':'Busca','type':'n8n-nodes-base.httpRequest','parameters':{'url':'https://places.googleapis.com/v1/places:searchText'}}
        write={'name':'Persistir','type':'n8n-nodes-base.httpRequest','parameters':{'method':'POST','url':'https://sheets.googleapis.com/alguma-escrita'}}
        original={'nodes':[{'type':'n8n-nodes-base.executeWorkflow','parameters':{'workflowJson':json.dumps({'nodes':[search,write]})}}]};before=copy.deepcopy(original)
        new,count=melhorar_cacador(original);self.assertEqual(count,1);self.assertEqual(original,before)
        sub=json.loads(new['nodes'][0]['parameters']['workflowJson']);self.assertEqual(sub['nodes'][0]['type'],'n8n-nodes-base.code');self.assertIn('Custo zero',sub['nodes'][0]['parameters']['jsCode']);self.assertNotIn('retryOnFail',sub['nodes'][1])
        self.assertEqual(melhorar_cacador(new)[1],0)

    def test_json_bloqueia_provedores_pagos_antes_de_abrir_rede(self):
        with patch.object(p.urllib.request,'Request') as request:
            for url in ['https://places.googleapis.com/v1/places/teste','https://api.apify.com/v2/acts/teste/runs','https://api.openai.com/v1/responses','https://brasilapi.com.br.evil.example/api/cnpj/v1/1']:
                with self.assertRaises(ValueError):p.json_http(url)
            with self.assertRaises(ValueError):p.json_http('https://minhareceita.org/33683111000280',{'Authorization':'Bearer falso'})
            request.assert_not_called()

    def test_ibge_confere_codigo_exato_sem_chave(self):
        with patch.object(p,'json_http',return_value={'id':3509502,'nome':'Campinas'}) as fetch:
            self.assertEqual(p.consultar_localidade('3509502')['nome'],'Campinas')
            self.assertEqual(fetch.call_args.args,('https://servicodados.ibge.gov.br/api/v1/localidades/municipios/3509502',))
        with patch.object(p,'json_http',return_value={'id':1}):
            with self.assertRaises(ValueError):p.consultar_localidade('3509502')

    def test_json_gzip_do_ibge_e_lido_sem_dependencia_paga(self):
        import gzip
        data=json.dumps({'id':3509502,'nome':'Campinas'}).encode()
        self.assertEqual(p.decodificar_json(gzip.compress(data))['nome'],'Campinas')

    def test_gzip_respeita_limite_descomprimido(self):
        import gzip
        with self.assertRaises(ValueError):p.decodificar_json(gzip.compress(b'"'+b'x'*1000+b'"'),100)


if __name__=='__main__':unittest.main()
