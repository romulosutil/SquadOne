"""Política comercial aprovada em 26/10; dados sintéticos e transportes dublados."""
import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('frente_estrategia',Path(__file__).with_name('frente-comercial.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)


def lead(produto='site',id_='teste',nota=80):
    texto='Bom dia, consigo falar com o responsável?'
    from urllib.parse import quote
    return {'id':produto+':'+id_,'produto':produto,'empresa':'Uniformes de teste','etapa':'novo',
            'nicho':'uniformes personalizados','sinal':'pronto' if produto=='site' else 'revisar',
            'marcos':{},'achados':[{'id':'sem-site'}] if produto=='site' else [],'mensagemPronta':texto,
            'triagem':{'origemWhatsapp':'botão do site','sinais':'uniformes · bordado','prioridade':nota},
            'nota':nota,'links':{'whatsapp':'https://wa.me/5511998887766',
                'enviar':'https://teste.invalid/webhook/enviar','convite':'https://wa.me/5511998887766?text='+quote(texto)}}


def qualificado():
    return {'dor':'Pedidos dispersos no WhatsApp','impacto':'Retrabalho com tamanhos errados',
            'decisao':{'decisor_confirmado':'sim','quem':'Responsável de teste'}}


class EstrategiaComercial(unittest.TestCase):
    def test_carteira_grande_ou_nota_maior_nao_passam_na_frente_do_site_aprovado(self):
        itens=[lead('estampa',str(i),100) for i in range(49)]+[lead('site','s1',65),lead('site','s2',70)]
        fila=f.intercalar_ofertas(itens,lambda l:l['nota'])
        self.assertEqual([l['produto'] for l in fila[:2]],['site','site'])
        self.assertEqual({l['id'] for l in fila},{l['id'] for l in itens})

    def test_site_sem_evidencia_e_adiado_sem_inferir_pelo_link_ausente(self):
        for achados in ([],[{'id':'nota-baixa'}],[{'id':'sem-horario'}],[{'id':'fotos-de-terceiros'}],[{'titulo':'Acho que não tem site'}]):
            l=lead()|{'achados':achados}
            self.assertFalse(f.elegivel(l))
        self.assertTrue(f.elegivel(lead()))

    def test_envios_historicos_nao_aparecem_como_prioridade_atual(self):
        itens=[lead('site','antigo')|{'estado':'enviado'},lead('estampa','antigo')|{'estado':'enviado'},lead('site','novo')|{'estado':'pronto'}]
        self.assertEqual(f.intercalar_ofertas(itens,lambda l:l['nota'])[0]['id'],'site:novo')

    def test_estamparia_sem_dor_impacto_e_decisor_confirmados_nao_e_contatada(self):
        l=lead('estampa')
        self.assertFalse(f.elegivel(l))
        for campo in ('dor','impacto','decisao'):
            s=qualificado();s.pop(campo)
            self.assertFalse(f.elegivel(l|{'spiced':s}),campo)
        self.assertTrue(f.elegivel(l|{'spiced':qualificado()}))

    def test_sinal_publico_ou_sugestao_nao_substitui_qualificacao(self):
        l=lead('estampa')|{'triagem':{'origemWhatsapp':'site','sinais':'uniformes e bordado; perde pedidos no WhatsApp'},
            'qualificacaoObservada':qualificado(),'copiloto':{'spiced':qualificado()}}
        self.assertFalse(f.elegivel(l))

    def test_nao_sei_nao_vira_dor_confirmada(self):
        for valor in ('não sei','A confirmar','não informado',None,False,{'texto':'dor'}):
            s=qualificado();s['dor']=valor
            self.assertFalse(f.elegivel(lead('estampa')|{'spiced':s}))

    def test_qualificacao_ou_tomada_humana_invalida_cache(self):
        l=lead('estampa')|{'spiced':qualificado()}
        novo=copy.deepcopy(l);novo['spiced']['impacto']='Outro impacto confirmado'
        self.assertNotEqual(f.hash_avaliacao(l),f.hash_avaliacao(novo))
        humano=l|{'responsavelConversa':{'responsavel':'romulo'}}
        self.assertNotEqual(f.hash_avaliacao(l),f.hash_avaliacao(humano))
        self.assertFalse(f.elegivel(humano))

    def test_qualificacao_privada_nao_entra_no_prompt(self):
        l=lead('estampa')|{'spiced':qualificado()}
        l['spiced']['dor']='CONVERSA PRIVADA cliente ligou'
        l['spiced']['decisao']['quem']='NOME PRIVADO'
        pacote=f.pacote(l)
        self.assertNotIn('CONVERSA PRIVADA',json.dumps(pacote))
        self.assertNotIn('NOME PRIVADO',json.dumps(pacote))
        self.assertEqual(pacote['qualificacaoComercialConfirmada'],{'necessidade':True,'impacto':True,'decisor':True})

    def test_justificativa_separa_evidencia_hipotese_e_economia_desconhecida(self):
        j=f.justificativa_comercial(lead())
        for campo in ('porQueComprar','porQueOferta','porQueAgora','viabilidade'):
            self.assertTrue(j[campo])
        self.assertIn('Hipótese',j['porQueComprar'])
        self.assertIn('Sem urgência comprovada',j['porQueAgora'])
        self.assertIn('ainda não medidos',j['viabilidade'])
        crm=f.justificativa_comercial(lead('estampa')|{'spiced':qualificado()})
        self.assertIn('Pedidos dispersos',crm['porQueComprar'])
        self.assertIn('precisam ser confirmados',crm['viabilidade'])

    def test_plano_antigo_reordena_sem_novo_id_e_sem_apagar_recibos(self):
        with tempfile.TemporaryDirectory() as d:
            r=f.Registro(Path(d)/'registro.sqlite')
            try:
                ls=[lead('estampa'),lead()]
                with r.db:r.db.execute('INSERT INTO planos VALUES(?,?)',('2026-10-26',json.dumps(ls)))
                r.reservar(ls[0],'Mensagem de teste',dt.datetime(2026,10,26,tzinfo=dt.timezone.utc))
                r.confirmar(f.chave(f.numero(ls[0])),'recibo-de-teste')
                self.assertEqual(r.plano('2026-10-26',ls)[0]['produto'],'site')
                self.assertEqual(r.contato(f.chave(f.numero(ls[0])))['recibo'],'recibo-de-teste')
            finally:r.db.close()

    def test_taxa_de_resposta_nao_e_proxy_de_retorno(self):
        l=lead('estampa',nota=70)
        self.assertEqual(f.prioridade_do_candidato(l,{('estampa',f.setor(l)):1}),70)
        self.assertEqual(f.prioridade_do_candidato(l,{}),70)

    def test_revalidacao_impede_envio_se_qualificacao_desaparece(self):
        l=lead('estampa')|{'spiced':qualificado()}
        atual=lead('estampa')
        with patch.object(f,'ler_config',return_value={'ativo':True}),patch.object(f,'ler_crm',return_value={'leads':[atual]}):
            self.assertFalse(f.revalidar_antes_do_envio(l,f.texto_do_lead(l)))

    def test_oferta_fria_sem_qualificacao_nao_bloqueia_site_para_mesma_empresa(self):
        site=lead();estampa=lead('estampa')
        with tempfile.TemporaryDirectory() as d,patch.object(f,'H',Path(d)),patch.object(f,'ler_config',return_value={'ativo':True}),patch.object(f,'ler_crm',return_value={'leads':[site,estampa]}):
            self.assertTrue(f.revalidar_antes_do_envio(site,f.texto_do_lead(site)))
            for extra in ({'etapa':'contato'},{'responsavelConversa':{'responsavel':'romulo'}},{'proximoPasso':{'texto':'Aguardar'}},{'marcos':{'enviado':'2026-10-25'}}):
                with patch.object(f,'ler_crm',return_value={'leads':[site,estampa|extra]}):
                    self.assertFalse(f.revalidar_antes_do_envio(site,f.texto_do_lead(site)))

    def test_prompt_dos_tres_papeis_exige_justificativa_comercial(self):
        for a,e in f.ROLES:
            p=f.prompt_da_avaliacao(a,e,[lead()])
            self.assertIn('frente principal',p)
            self.assertIn('venda dirigida',p)
            self.assertIn('margem',p)
            self.assertIn('não necessidade de compra confirmada',p)
            self.assertIn('Não exija SPICED',p)


if __name__=='__main__':unittest.main()
