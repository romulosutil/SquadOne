"""Contratos com mensagens fictícias, sem rede/modelos/contatos reais."""
import copy
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BASE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('eventos_comerciais',BASE/'eventos_comerciais.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
CHAVE='2799990000';EM='2026-10-23T18:00:00Z';RECEBIDO='2026-10-23T18:01:00Z'
LINHA={'id':'MSG-FICTICIA','origem':'prumo','direcao':'entrada','em':EM,'texto':'  Olá 🧭\nvalor apenas fictício  '}


class EnvelopesComerciais(unittest.TestCase):
    def test_hash_utf8_exato_sem_strip_sem_truncar_e_sem_texto_na_saida(self):
        l=copy.deepcopy(LINHA);l['texto']+='é'*1600
        e=m.envelope_prumo(CHAVE,l,RECEBIDO)
        self.assertEqual(e,{'idOriginal':l['id'],'origem':'whatsapp','conta':'prumo','canal':'whatsapp','conversa':CHAVE,'tipo':'resposta','direcao':'entrada','ocorridoEm':EM,'recebidoEm':RECEBIDO,'conteudoHash':hashlib.sha256(l['texto'].encode('utf-8')).hexdigest(),'fonteId':l['id']})
        self.assertNotIn('texto',e);self.assertNotIn(l['texto'],json.dumps(e))
        self.assertEqual(l['texto'],LINHA['texto']+'é'*1600)

    def test_sem_id_origem_horario_real_ou_conversa_valida_nao_inventa(self):
        for delta in [{'id':None},{'id':123},{'id':''},{'id':' x '},{'origem':'pessoal'},{'em':'2026-02-30T18:00:00Z'},{'em':'2026-10-23T18:00:00'},{'texto':None}]:
            self.assertIsNone(m.envelope_prumo(CHAVE,{**LINHA,**delta},RECEBIDO))
        for chave in ['0000000000','5527999990000','2799990000@s.whatsapp.net','٢٧٩٩٩٩٠٠٠٠']:
            self.assertIsNone(m.envelope_prumo(chave,LINHA,RECEBIDO))
        self.assertIsNone(m.envelope_prumo(CHAVE,LINHA,'2026-10-23T17:59:00Z'))

    def test_tipos_direcao_e_ids_reais_sao_preservados(self):
        for tipo,direcao in [('resposta','entrada'),('mensagem','saida'),('entrega','saida'),('leitura','saida')]:
            e=m.envelope_prumo(CHAVE,{**LINHA,'direcao':direcao},RECEBIDO,tipo=tipo)
            self.assertEqual(e['tipo'],tipo);self.assertEqual(e['idOriginal'],LINHA['id'])
        self.assertIsNone(m.envelope_prumo(CHAVE,LINHA,RECEBIDO,tipo='pagamento'))
        self.assertIsNone(m.envelope_prumo(CHAVE,LINHA,RECEBIDO,tipo='leitura'))

    def test_lista_relata_skip_numerico_sem_id_inventado_e_sem_escolher_colisao(self):
        r=m.envelopes_prumo(CHAVE,[LINHA],['MSG-FICTICIA','AUSENTE',None],RECEBIDO,origem='prumo')
        self.assertEqual(len(r['eventos']),1);self.assertEqual(r['ignorados'],2);self.assertEqual(r['motivo'],'metadados_insuficientes')
        self.assertEqual(m.envelopes_prumo(CHAVE,[LINHA],[],RECEBIDO,origem='prumo')['eventos'],[])
        self.assertEqual(m.envelopes_prumo(CHAVE,[LINHA],['MSG-FICTICIA'],RECEBIDO,origem='pessoal')['eventos'],[])
        self.assertEqual(m.envelopes_prumo(CHAVE,[LINHA,{**LINHA,'texto':'outro'}],['MSG-FICTICIA'],RECEBIDO,origem='prumo')['ignorados'],1)

    def test_observador_hash_da_linha_preservada_fila_e_ack_duravel_com_reinicio(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'HOME':tmp,'USERPROFILE':tmp,'WHATSAPP_CONVERSAS_DIR':tmp,'OBSERVADOR_TRANSCREVER':'0'}):
            spec=importlib.util.spec_from_file_location('observador_comercial_fixture',BASE/'observador.py')
            ob=importlib.util.module_from_spec(spec);spec.loader.exec_module(ob)
            instante=1792778460.0
            pasta=Path(tmp)/'entrada';conversas=ob.Conversas(Path(tmp)/'conversas','prumo',lambda:instante)
            texto='Transcrição fictícia '+('é'*1400)
            conversas.anexar(CHAVE,'entrada',instante-20,texto,'ORIGINAL-FICTICIO')
            chamadas=[]
            def falhar(_metodo,_rota,body):chamadas.append(copy.deepcopy(body));raise TimeoutError('fixture')
            obs=ob.Observador({CHAVE},chamar=falhar,avisar=lambda _:None,relogio=lambda:instante,pasta=pasta,bridge_js=Path(tmp)/'ausente',conversas=conversas)
            try:
                obs.entrega_duravel=True;obs._tomar_entrada()
                obs.conversas[CHAVE]={'mensagens':[{'em':ob.iso(instante-20),'texto':texto[:1000]}],'ids':['ORIGINAL-FICTICIO'],'ultima':instante,'desde':instante-20,'ate':instante-20,'so_audio_sem_ouvinte':False}
                obs.fechar_conversas(todas=True)
                e=obs.conversas_prontas[0]['envelopesComerciais'][0]
                self.assertEqual(e['conteudoHash'],hashlib.sha256(texto.encode()).hexdigest())
                self.assertNotEqual(e['conteudoHash'],hashlib.sha256(texto[:1000].encode()).hexdigest())
                obs.mandar_conversas();self.assertEqual(len(obs.conversas_prontas),1)
                guardado=json.loads((pasta/'entrada-observador.json').read_text())
                self.assertNotIn('texto',guardado['prontas'][0]['envelopesComerciais'][0])
            finally:obs.liberar_entrada()
            novo=ob.Observador({CHAVE},chamar=lambda *_:{'ok':True,'marcados':[]},avisar=lambda _:None,relogio=lambda:instante+3601,pasta=pasta,bridge_js=Path(tmp)/'ausente',conversas=conversas)
            try:
                self.assertEqual(novo.conversas_prontas[0]['envelopesComerciais'][0],e)
                novo.mandar_conversas();self.assertEqual(len(novo.conversas_prontas),0)
                # Fila antiga não ganha ID/hora fictícios nem trava a classificação existente.
                novo.conversas_prontas.append({'chave':CHAVE,'mensagens':[{'texto':'fixture antiga','em':EM}]})
                novo.mandar_conversas();self.assertEqual(len(novo.conversas_prontas),0)
            finally:novo.liberar_entrada()


if __name__=='__main__':unittest.main()
