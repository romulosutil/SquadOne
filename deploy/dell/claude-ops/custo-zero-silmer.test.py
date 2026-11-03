import copy
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('czs',Path(__file__).with_name('custo_zero_silmer.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class EscopoSilmer(unittest.TestCase):
 def test_silmer_preserva_ia_transcricao_credenciais_e_conexoes(self):
  for ident in ['0S5ZS1xeDCSoWovs','k7tI6T4RhQPyJkn9']:
   w={'id':ident,'active':True,'nodes':[{'name':'Modelo','type':'@n8n/n8n-nodes-langchain.lmChatOpenAi','credentials':{'ref':'fake'}},{'name':'Áudio','type':'n8n-nodes-base.httpRequest','parameters':{'url':'https://api.openai.com/v1/audio/transcriptions'}}],'connections':{'Modelo':{'ai_languageModel':[[{'node':'Atendente'}]]}}}
   self.assertEqual(m.preparar(w),w)
if __name__=='__main__':unittest.main()
