import unittest,datetime as dt,json,tempfile,sqlite3,sys,importlib.util
from pathlib import Path
from importlib.machinery import SourceFileLoader
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parent))
import campanha_site as m
sp=importlib.util.spec_from_file_location('executor_cache',Path(__file__).parent/'frente-comercial.py');e=importlib.util.module_from_spec(sp);sp.loader.exec_module(e)
class Liberacao(unittest.TestCase):
 def setUp(self):
  self.c={'versao':1,'ativo':True,'produto':'site','leadsAutorizados':['site:a','site:b','site:r'],'principais':['site:a','site:b'],'reservas':['site:r'],'inicioPreparacao':'2026-11-06','inicioEnvios':'2026-11-09','fimEnvios':'2026-11-09','naoEnviarAntesDe':'2026-11-09T08:00:00-03:00','metaContatos':2};self.l={'id':'site:a','produto':'site'}
 def test_nao_envia_antes_de_segunda_08h(self):
  for stamp in ['2026-11-06T23:00:00+00:00','2026-11-08T15:00:00+00:00','2026-11-09T10:59:59+00:00']:
   self.assertFalse(m.autorizar(self.l,self.c,dt.datetime.fromisoformat(stamp),envio=True))
  self.assertTrue(m.autorizar(self.l,self.c,dt.datetime.fromisoformat('2026-11-09T11:00:00+00:00'),envio=True))
 def test_nao_prorroga_para_terca(self):self.assertFalse(m.autorizar(self.l,self.c,dt.datetime.fromisoformat('2026-11-10T11:00:00+00:00'),envio=True))
 def test_recibo_sem_destino_e_tentativa_nao_contam(self):
  rows=[('a','site:a','enviado','2026-11-09T11:00:00Z','id'),('a','site:a','enviado','2026-11-09T11:00:00Z','id'),('b','site:b','incerto','2026-11-09T11:30:00Z',''),('c','site:r','enviado','2026-11-06T11:00:00Z','id')]
  self.assertEqual(m.quantidade_confirmados(self.c,rows),1)
 def test_reserva_nao_acrescenta_contato_apos_teto(self):
  with tempfile.TemporaryDirectory() as t:
   path=Path(t);manifest=path/'ativo.json';manifest.write_text(json.dumps(self.c));db=path/'r.sqlite';c=sqlite3.connect(db);c.execute('create table contatos(chave,id,estado,em,recibo)');c.executemany('insert into contatos values(?,?,?,?,?)',[('a','site:a','enviado','2026-11-09T11:00:00Z','x'),('b','site:b','enviado','2026-11-09T11:30:00Z','y')]);c.commit();c.close()
   with patch.object(m,'ATUAL',manifest),patch.object(m,'REGISTRO',db):self.assertFalse(m.permite({'id':'site:r','produto':'site'},dt.datetime.fromisoformat('2026-11-09T12:00:00+00:00'),True))
 def test_falta_de_registro_nao_libera(self):
  with tempfile.TemporaryDirectory() as t:
   path=Path(t);manifest=path/'ativo.json';manifest.write_text(json.dumps(self.c))
   with patch.object(m,'ATUAL',manifest),patch.object(m,'REGISTRO',path/'ausente.sqlite'):self.assertFalse(m.permite(self.l,dt.datetime.fromisoformat('2026-11-09T12:00:00+00:00'),True))
 def test_cache_de_sexta_nao_vale_como_avaliacao_de_segunda(self):
  with tempfile.TemporaryDirectory() as t,patch.object(e,'hash_avaliacao',return_value='hash'):
   r=e.Registro(Path(t)/'reg.sqlite');vote={'id':'a','nota':75,'decisao':'contatar','motivo':'Fonte e pergunta coerentes.'}
   with patch.object(e,'agora',return_value=dt.datetime.fromisoformat('2026-11-06T23:00:00+00:00')),patch.object(e,'iso',return_value='2026-11-06T23:00:00+00:00'):
    r.guardar('2026-11-09',{'id':'site:a'},'Diego',vote);self.assertEqual(r.avaliar('2026-11-09',{'id':'site:a'},'Diego'),vote)
   with patch.object(e,'agora',return_value=dt.datetime.fromisoformat('2026-11-09T10:40:00+00:00')):self.assertIsNone(r.avaliar('2026-11-09',{'id':'site:a'},'Diego'))
if __name__=='__main__':unittest.main()
