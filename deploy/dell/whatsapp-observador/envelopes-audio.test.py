import copy
from datetime import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('envelopes_audio', Path(__file__).with_name('envelopes_audio.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
EM = '2026-11-13T19:00:00Z'
AGORA = datetime.fromisoformat('2026-11-13T20:00:00+00:00')
CFG = {'v': 1, 'identidadePrumoHash': 'a'*64, 'desde': '2026-11-01T00:00:00Z'}
MARCADOR = '[áudio 4s]'
TEXTO = MARCADOR + ' Já temos site, mas muito obrigado.'
sha = lambda x: hashlib.sha256(x.encode()).hexdigest()
EVENTO = {'idOriginal': 'AUDIO-ORIGINAL', 'fonteId': 'AUDIO-ORIGINAL', 'origem': 'whatsapp', 'conta': 'prumo',
          'canal': 'whatsapp', 'conversa': '2799990000', 'tipo': 'resposta', 'direcao': 'entrada',
          'ocorridoEm': EM, 'recebidoEm': '2026-11-13T19:00:20Z', 'conteudoHash': sha(TEXTO)}
LINHA = {'id': 'AUDIO-ORIGINAL', 'origem': 'prumo', 'direcao': 'entrada', 'em': EM, 'texto': TEXTO}
PROVA = {'v': 1, 'coletor': 'evolution', 'contaHash': 'a'*64, 'garantia': 'webhook-evolution',
         'sessaoHash': None, 'instancia': 'prumo', 'capturadoEm': '2026-11-13T19:00:01Z',
         'mensagem': {'idOriginal': 'AUDIO-ORIGINAL', 'direcao': 'entrada', 'ocorridoEm': EM, 'conteudoHash': sha(MARCADOR)}}
REGISTRO = {'estado': 'concluido', 'evento': {**EVENTO, 'conteudoHash': sha(MARCADOR)}}


class AudioComprovado(unittest.TestCase):
    def setUp(self):
        self.lote = {'chave': '2799990000', 'mensagens': [{'texto': TEXTO, 'em': EM}], 'envelopesComerciais': [copy.deepcopy(EVENTO)]}

    def executar(self, provas=None, linhas=None, config=None):
        return m.conciliar_lote(self.lote, [LINHA] if linhas is None else linhas, CFG if config is None else config,
                               [PROVA] if provas is None else provas, AGORA, registros=[REGISTRO])

    def test_audio_comprovado_preserva_transcricao_id_horarios_e_original(self):
        antes = copy.deepcopy(self.lote)
        novo, n = self.executar()
        self.assertEqual(n, 1); self.assertEqual(self.lote, antes)
        self.assertEqual(novo['mensagens'], antes['mensagens'])
        esperado = {**EVENTO, 'conteudoHash': sha(MARCADOR)}
        self.assertEqual(novo['envelopesComerciais'], [esperado])

    def test_repetir_conciliacao_e_idempotente(self):
        novo, _ = self.executar()
        repetido, n = m.conciliar_lote(novo, [LINHA], CFG, [PROVA], AGORA, registros=[REGISTRO])
        self.assertEqual(n, 0); self.assertEqual(repetido, novo)

    def test_texto_que_imita_audio_sem_prova_exata_nao_muda(self):
        for provas in [[], [{**PROVA, 'mensagem': {**PROVA['mensagem'], 'conteudoHash': sha(TEXTO)}}]]:
            novo, n = self.executar(provas=provas)
            self.assertEqual(n, 0); self.assertEqual(novo, self.lote)

    def test_outra_conta_instancia_coletor_ou_garantia_nao_equivalem_a_original(self):
        for delta in [{'contaHash': 'b'*64}, {'instancia': 'outro'}, {'coletor': 'hermes'}, {'garantia': 'socket-hermes'}, {'sessaoHash': 'c'*64}]:
            self.assertEqual(self.executar(provas=[{**PROVA, **delta}])[1], 0)

    def test_id_direcao_data_ou_hash_divergentes_continuam_pendentes(self):
        for delta in [{'idOriginal': 'OUTRO-ID'}, {'direcao': 'saida'}, {'ocorridoEm': '2026-11-13T18:59:59Z'}, {'conteudoHash': 'd'*64}]:
            self.assertEqual(self.executar(provas=[{**PROVA, 'mensagem': {**PROVA['mensagem'], **delta}}])[1], 0)
        for delta in [{'texto': TEXTO+' outra versão'}, {'em': '2026-11-13T18:59:59Z'}, {'origem': 'pessoal'}]:
            self.assertEqual(self.executar(linhas=[{**LINHA, **delta}])[1], 0)
        self.assertEqual(self.executar(linhas=[LINHA, LINHA])[1], 0)

    def test_prova_anterior_a_configuracao_ou_futura_nao_libera(self):
        for em in ['2026-10-31T19:00:01Z', '2026-11-14T19:00:01Z']:
            self.assertEqual(self.executar(provas=[{**PROVA, 'capturadoEm': em}])[1], 0)

    def test_inbox_ausente_ou_ja_registrada_com_mesmo_hash_nao_e_reescrita(self):
        for registros in [[], [{'estado': 'concluido', 'evento': EVENTO}], [REGISTRO, REGISTRO]]:
            novo, n = m.conciliar_lote(self.lote, [LINHA], CFG, [PROVA], AGORA, registros=registros)
            self.assertEqual(n, 0); self.assertEqual(novo, self.lote)

    def test_mensagem_comum_audio_sem_transcricao_e_envelope_ja_canonico_nao_mudam(self):
        self.lote['envelopesComerciais'][0]['conteudoHash'] = sha(MARCADOR)
        self.assertEqual(self.executar()[1], 0)
        self.lote['envelopesComerciais'][0]['conteudoHash'] = sha('Mensagem comum')
        self.assertEqual(self.executar(linhas=[{**LINHA, 'texto': 'Mensagem comum'}])[1], 0)

    def test_observador_persiste_conciliacao_antes_do_http_e_reinicio_so_remove_apos_ack(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'HOME': temp, 'USERPROFILE': temp, 'OBSERVADOR_TRANSCREVER': '0'}):
            home = Path(temp)
            provas = home / '.local/share/whatsapp-identidades'; provas.mkdir(parents=True)
            (provas/'config.json').write_text(json.dumps(CFG))
            (provas/'2799990000.jsonl').write_text(json.dumps(PROVA)+'\n')
            inbox = home/'.local/share/squadone-operations'; inbox.mkdir(parents=True)
            (inbox/'atendimento-comercial-inbox.json').write_text(json.dumps({'v':1,'registros':[REGISTRO]}))
            spec = importlib.util.spec_from_file_location('observador_audio_fixture', Path(__file__).with_name('observador.py'))
            ob = importlib.util.module_from_spec(spec); spec.loader.exec_module(ob)
            pasta = home/'fila'
            conversas = ob.Conversas(home/'conversas', 'prumo', lambda: AGORA.timestamp())
            conversas.anexar('2799990000', 'entrada', datetime.fromisoformat(EM.replace('Z','+00:00')).timestamp(), TEXTO, 'AUDIO-ORIGINAL')
            chamadas = []
            def falhar(_metodo, rota, corpo):
                chamadas.append(copy.deepcopy(corpo))
                # Mesmo antes da requisição, o envelope conciliado já está durável.
                estado = json.loads((pasta/'entrada-observador.json').read_text())
                self.assertEqual(estado['prontas'][0]['envelopesComerciais'][0]['conteudoHash'], sha(MARCADOR))
                self.assertEqual(rota, 'whatsapp-resposta')
                raise TimeoutError('fixture: nenhuma rede utilizada')
            obs = ob.Observador({'2799990000'}, chamar=falhar, avisar=lambda _: None, relogio=lambda: AGORA.timestamp(),
                                pasta=pasta, bridge_js=home/'ausente', conversas=conversas)
            try:
                obs.entrega_duravel=True; obs._tomar_entrada()
                obs.conversas_prontas.append(self.lote); obs._salvar_entrega()
                obs.mandar_conversas()
                self.assertEqual(len(obs.conversas_prontas), 1)
                self.assertEqual(chamadas[0]['mensagens'], self.lote['mensagens'])
            finally:
                obs.liberar_entrada()
            novo = ob.Observador({'2799990000'}, chamar=lambda *_: {'ok': True, 'marcados': []}, avisar=lambda _: None,
                                 relogio=lambda: AGORA.timestamp()+120, pasta=pasta, bridge_js=home/'ausente', conversas=conversas)
            try:
                self.assertEqual(novo.conversas_prontas[0]['envelopesComerciais'][0]['conteudoHash'], sha(MARCADOR))
                novo.mandar_conversas()
                self.assertEqual(list(novo.conversas_prontas), [])
                self.assertEqual(json.loads((pasta/'entrada-observador.json').read_text())['prontas'], [])
            finally:
                novo.liberar_entrada()


if __name__ == '__main__':
    unittest.main()
