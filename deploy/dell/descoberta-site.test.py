import unittest,importlib.util,pathlib,sys,datetime as dt
from unittest.mock import patch
from importlib.machinery import SourceFileLoader
root=pathlib.Path(__file__).parent;sys.path.insert(0,str(root))
loader=SourceFileLoader('frente_descoberta_teste',str(root/'frente-comercial.py'));spec=importlib.util.spec_from_loader(loader.name,loader);e=importlib.util.module_from_spec(spec);loader.exec_module(e)
import campanha_site
def fonte():return {'fontePublicaIdentificavel':True,'identidadeDoNomeConfere':True,'contatoCorrespondeAoPublicadoNaFicha':True,'conferenciaAtualDoPerfil':{'em':'2026-11-06T22:00:00Z','contatoAtualCorrespondeAFicha':True,'campoSiteDoPerfilDaPropriaEmpresa':'sem-link-de-site-no-perfil'}}
class Descoberta(unittest.TestCase):
 def conferir(self,f,ids=('sem-site',)):
  with patch.object(campanha_site,'evidencia_site',return_value=f):return e.criterio_descoberta_site({'produto':'site','achados':[{'id':i} for i in ids]})
 def test_falta_fonte_adia(self):self.assertFalse(self.conferir(None)['apto'])
 def test_fonte_sem_identidade_ou_destino_adia(self):
  for k in ['identidadeDoNomeConfere','contatoCorrespondeAoPublicadoNaFicha']:
   f=fonte();f[k]=False;self.assertFalse(self.conferir(f)['apto'])
 def test_perfil_sem_link_e_hipotese_nao_compra(self):
  r=self.conferir(fonte());self.assertTrue(r['apto']);self.assertIn('não prova',r['motivo']);self.assertEqual(r['prioridade'],1)
 def test_fechamento_permanente_adia(self):
  f=fonte();f['conferenciaAtualDoPerfil']['avisoFechamentoPermanente']=True;self.assertFalse(self.conferir(f)['apto'])
 def test_achado_desatualizado_ou_divergente_adia(self):
  f=fonte();f['conferenciaAtualDoPerfil']={};self.assertFalse(self.conferir(f)['apto']);self.assertFalse(self.conferir(fonte(),('poucas-avaliacoes',))['apto'])
 def test_falha_concreta_prioriza_sem_promessa(self):
  f=fonte();f['conferenciaTecnicaDoSite']={'dominio':'empresa.example','http':500,'em':'2026-11-06T22:00:00Z'};r=self.conferir(f,('site-fora-do-ar',));self.assertTrue(r['apto']);self.assertEqual(r['prioridade'],2)
 def test_site_no_ar_nao_herda_falha_antiga(self):
  f=fonte();f['conferenciaTecnicaDoSite']={'dominio':'empresa.example','http':200};self.assertFalse(self.conferir(f,('site-fora-do-ar',))['apto'])
 def test_outros_produtos_nao_mudam(self):self.assertTrue(e.criterio_descoberta_site({'produto':'iris'})['apto'])
class ContratosDaPreparacao(unittest.TestCase):
 def test_tres_pareceres_sem_notas_inventadas(self):
  vs=[{'agente':a,'nota':70,'decisao':'contatar'} for a,_ in e.ROLES]
  self.assertEqual(e.nota_da_selecao(vs),70)
  self.assertIsNone(e.nota_da_selecao(vs[:2]))
  vs[2]['nota']=64;self.assertIsNone(e.nota_da_selecao(vs))
 def test_abertura_antiga_nao_passa_no_novo_executor(self):
  l={'produto':'site','sinal':'pronto','etapa':'novo','empresa':'Empresa teste','marcos':{}}
  with patch.object(campanha_site,'permite',return_value=True),patch.object(e,'parecer_curadoria',return_value={'decisao':'apto'}),patch.object(e,'justificativa_comercial',return_value={'elegivel':True}),patch.object(e,'numero',return_value='5511999998888'),patch.object(e,'destino_do_lead',return_value=True),patch.object(e,'texto_do_lead',return_value='Uma pergunta sobre o perfil.'),patch.object(e,'perfil_do_lead',return_value={'aderente':True}):
   self.assertFalse(e.elegivel(l));l['abordagem']={'mensagem':'E'};self.assertTrue(e.elegivel(l))
if __name__=='__main__':unittest.main()
