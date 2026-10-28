import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('frente_qualidade',Path(__file__).with_name('frente-comercial.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

def ficha(produto='iris',sinais='ABA · TEA'):
    return {'id':produto+':teste','produto':produto,'empresa':'Instituto Exemplo','nicho':'Saúde',
        'triagem':{'sinais':sinais,'origemWhatsapp':'botão do site','prioridade':100},'links':{},'marcos':{}}

class Qualidade(unittest.TestCase):
    def test_categoria_generica_nao_confirma_perfil(self):
        for produto,sinal in [('iris','multidisciplinar'),('iris','convênio · equipe no site'),('estampa','Loja de Roupa'),('estampa','brindes · canecas · DTF')]:
            l=ficha(produto,sinal)
            self.assertFalse(f.perfil_do_lead(l)['aderente'],(produto,sinal))

    def test_perfil_usa_sinais_publicos_e_nome(self):
        for produto,sinal in [('iris','TEA'),('iris','ABA'),('iris','público infantil'),('estampa','camisetas · DTF'),('estampa','uniformes · bordado')]:
            self.assertTrue(f.perfil_do_lead(ficha(produto,sinal))['aderente'])
        self.assertTrue(f.perfil_do_lead(ficha('iris','')|{'empresa':'Clínica Infantil Exemplo'})['aderente'])

    def test_tea_aba_nao_sao_substrings(self):
        self.assertFalse(f.perfil_do_lead(ficha('iris','teatro · trabalho'))['aderente'])

    def test_demo_sob_demanda_e_sinais_chegam_aos_tres_papeis(self):
        l=ficha('site','site indisponível')|{'mensagemPronta':'Preparei uma demonstração.'}
        for agente,especialidade in f.ROLES:
            p=f.prompt_da_avaliacao(agente,especialidade,[l])
            self.assertIn('10 minutos',p);self.assertIn('site indisponível',p)
            self.assertIn('sem opiniões dos colegas',p)
            self.assertIn('Preparei uma demonstração.',p)
            self.assertNotIn('Avaliações anteriores do time',p)
        d=f.pacote(l)
        self.assertEqual(d['demoSobDemandaMinutos'],10)
        self.assertFalse(d['demoDisponivel'])

    def test_papeis_possuem_criterios_diferentes(self):
        prompts=[f.prompt_da_avaliacao(a,e,[ficha()]) for a,e in f.ROLES]
        self.assertIn('empresa, destino',prompts[0]);self.assertIn('pertinência da entrega',prompts[1]);self.assertIn('mensagem corresponde ao perfil',prompts[2])

    def test_pacote_publico_omite_contato_e_conversa(self):
        l=ficha('iris','TEA · ligue +55 (11) 99999-9999 · https://exemplo.test · pessoa@exemplo.test')
        l['conversa']={'ultima':{'trecho':'CONVERSA PRIVADA'}}
        s=json.dumps(f.pacote(l),ensure_ascii=False)
        for valor in ('99999','https://','pessoa@','CONVERSA PRIVADA'):self.assertNotIn(valor,s)

    def test_menor_nota_governa_e_veto_nao_e_compensado(self):
        a=[{'agente':nome,'nota':nota,'decisao':'contatar'} for (nome,_),nota in zip(f.ROLES,[95,66,85])]
        self.assertEqual(f.nota_da_selecao(a),66)
        a[1]['nota']=64;self.assertIsNone(f.nota_da_selecao(a))
        a[1].update(nota=100,decisao='adiar');self.assertIsNone(f.nota_da_selecao(a))
        self.assertIsNone(f.nota_da_selecao(a[:2]))
        self.assertIsNone(f.nota_da_selecao([a[0],a[0],a[0]]))

    def test_cache_antigo_nao_vale_mas_historico_nao_e_apagado(self):
        l=ficha()
        with tempfile.TemporaryDirectory() as d:
            r=f.Registro(Path(d)/'registro.sqlite')
            try:
                for nome,_ in f.ROLES:
                    with r.db:r.db.execute('INSERT INTO avaliacoes VALUES(?,?,?,?,?)',('2026-10-23',l['id'],f.fingerprint(l),nome,'{}'))
                self.assertIsNone(r.avaliar('2026-10-23',l,'Diego'))
                self.assertEqual(r.ids_avaliados('2026-10-23'),set())
                r.guardar('2026-10-23',l,'Diego',{'nota':70})
                self.assertEqual(r.db.execute('SELECT COUNT(*) FROM avaliacoes').fetchone()[0],4)
            finally:r.db.close()

    def test_mudar_perfil_ou_texto_invalida_avaliacao(self):
        l=ficha('site')|{'mensagemPronta':'Mensagem inicial'}
        for novo in (l|{'nicho':'outro'},l|{'mensagemPronta':'Outro texto'},l|{'triagem':{'sinais':'outros'}}):
            self.assertNotEqual(f.hash_avaliacao(l),f.hash_avaliacao(novo))

    def test_taxa_nao_premia_robo_recusa_ou_coorte_recente(self):
        now=dt.datetime(2026,10,23,18,tzinfo=dt.timezone.utc)
        ls=[]
        for i in range(10):
            ls.append(ficha()|{'marcos':{'enviado':f.iso(now-dt.timedelta(days=3))},
                'classificacaoResposta':{'houveRespostaHumana':True,'classe':'recusa' if i<5 else 'robo'}})
        with patch.object(f,'agora',return_value=now):
            self.assertEqual(list(f.taxas_por_setor({'leads':ls}).values()),[0])
            ls[0]['classificacaoResposta']['classe']='acesso'
            self.assertEqual(list(f.taxas_por_setor({'leads':ls}).values()),[0.1])
            ls[0]['marcos']['enviado']=f.iso(now-dt.timedelta(hours=1))
            self.assertEqual(f.taxas_por_setor({'leads':ls}),{})

if __name__=='__main__':unittest.main()
