"""Identidade de captura: somente fixtures, diretórios temporários e HTTP loopback."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

AQUI = Path(__file__).resolve().parent


def carregar(nome, arquivo):
    spec = importlib.util.spec_from_file_location(nome, AQUI / arquivo)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


m = carregar('identidade_captura_fixture', 'identidade_captura.py')
ev = carregar('adaptador_identidade_fixture', 'evolution-adaptador.py')
ev._IDENTIDADE_CAPTURA = m
AGORA = 1792843200
CAPTURADO = m.iso_utc(AGORA)
CONTA = '5527999887766@s.whatsapp.net'
OUTRA = '5511988776655@s.whatsapp.net'
LEAD = '5521977776666'
CHAVE = ev.chave_do_numero(LEAD)
HASH = hashlib.sha256(CONTA.encode()).hexdigest()
CONFIG = {'v': 1, 'identidadePrumoHash': HASH, 'desde': m.iso_utc(AGORA - 600)}


def corpo(texto=' conteúdo íntegro ', *, id_='ID-REAL-FIXTURE', sender=CONTA, entrada=True, ts=AGORA-5):
    return {'event': 'messages.upsert', 'instance': 'prumo', 'sender': sender,
            'apikey': 'NAO-PERSISTIR-CREDENCIAL', 'data': {'key': {
                'remoteJid': LEAD + '@s.whatsapp.net', 'fromMe': not entrada, 'id': id_},
                'messageTimestamp': ts, 'message': {'conversation': texto}}}


def contexto(sender=CONTA, **extra):
    c = m.contexto_captura(corpo(sender=sender), CAPTURADO, CONFIG, autenticado=True)
    return {**c, 'horarioOriginalValido': True, 'conversaBR10': CHAVE,
            'idOriginal': 'ID-REAL-FIXTURE', 'direcao': 'entrada', 'ocorridoEm': m.iso_utc(AGORA-5), **extra}


def traducao(texto='conteúdo íntegro', id_='ID-REAL-FIXTURE', ts=AGORA-5):
    return SimpleNamespace(respostas=[{'chave': CHAVE, 'id': id_, 'texto': texto, 'ts': ts}], enviadas=[])


class Puras(unittest.TestCase):
    def test_jid_estrito_canonico_sem_device_sem_prefixo_no_hash(self):
        self.assertEqual(m.jid_canonico(CONTA.replace('@', ':42@')), CONTA)
        for invalido in [None, 4, '', ' '+CONTA, CONTA+' ', '123@lid', CONTA.replace('s.whatsapp.net', 'c.us'), '123456789@s.whatsapp.net', '1234567890123456@s.whatsapp.net', '1203630@g.us']:
            self.assertIsNone(m.jid_canonico(invalido))
        self.assertEqual(contexto()['contaHash'], hashlib.sha256(CONTA.encode('utf-8')).hexdigest())

    def test_schema_exato_hash_das_rows_original_sem_traducao_de_audio(self):
        t = traducao('  [áudio 27s]  ')
        provas, contagens = m.montar_provas(contexto(), t, CONFIG)
        chave, p = provas[0]
        self.assertEqual(chave, CHAVE)
        self.assertEqual(p, {'v': 1, 'coletor': 'evolution', 'contaHash': HASH,
            'garantia': 'webhook-evolution', 'sessaoHash': None, 'instancia': 'prumo',
            'capturadoEm': CAPTURADO, 'mensagem': {'idOriginal': 'ID-REAL-FIXTURE',
                'direcao': 'entrada', 'ocorridoEm': m.iso_utc(AGORA-5),
                'conteudoHash': hashlib.sha256('[áudio 27s]'.encode()).hexdigest()}})
        self.assertEqual(contagens, {'provas': 1})
        self.assertNotIn('texto', json.dumps(p))
        self.assertNotIn(CONTA, json.dumps(p))

    def test_strip_limite2000_unicode_e_saida(self):
        t = traducao('  á😀'*800 + '  ')
        t.enviadas, t.respostas = t.respostas, []
        p = m.montar_provas(contexto(direcao='saida'), t, CONFIG)[0][0][1]
        self.assertEqual(p['mensagem']['direcao'], 'saida')
        self.assertEqual(p['mensagem']['conteudoHash'], hashlib.sha256(t.enviadas[0]['texto'].strip()[:2000].encode()).hexdigest())

    def test_conta_diferente_preservada_para_conflito_nao_virar_prumo(self):
        provas, counts = m.montar_provas(contexto(OUTRA), traducao(), CONFIG)
        self.assertEqual(provas[0][1]['contaHash'], hashlib.sha256(OUTRA.encode()).hexdigest())
        self.assertNotEqual(provas[0][1]['contaHash'], HASH)
        self.assertEqual(counts, {'provas': 1, 'foraDaAncora': 1})

    def test_sem_auth_sender_instancia_config_ou_inicio_nao_atesta(self):
        casos = [(corpo(), CONFIG, False, 'capturaNaoAutenticada'),
                 (corpo(sender=None), CONFIG, True, 'senderAusenteOuInvalido'),
                 ({**corpo(), 'instance': 'outra'}, CONFIG, True, 'instanciaDiferente'),
                 (corpo(), {**CONFIG, 'desde': m.iso_utc(AGORA+1)}, True, 'antesDoInicio'),
                 (corpo(), {'invalida': True}, True, 'configuracaoInvalida')]
        for body, config, auth, motivo in casos:
            c = m.contexto_captura(body, CAPTURADO, config, autenticado=auth)
            self.assertEqual(m.montar_provas(c, traducao(), config), ([], {motivo: 1}))
        self.assertIsNone(m.contexto_captura(corpo(), CAPTURADO, None, autenticado=True))

    def test_metadados_id_ts_chave_e_timestamp_substituto_nao_geram_prova(self):
        for campo, valor in [('id', ''), ('id', '../\nsegredo'), ('id', ' x'), ('texto', ''), ('ts', None), ('ts', True), ('ts', AGORA+999), ('chave', '../escape')]:
            t = traducao(); t.respostas[0][campo] = valor
            self.assertEqual(m.montar_provas(contexto(), t, CONFIG)[0], [])
        self.assertEqual(m.montar_provas(contexto(horarioOriginalValido=False), traducao(), CONFIG)[0], [])
        for invalido in [True, None, 'nan', float('inf'), 0, AGORA+1, AGORA+500]:
            self.assertFalse(m.timestamp_original_valido(invalido, CAPTURADO))
        self.assertTrue(m.timestamp_original_valido(str((AGORA-5)*1000), CAPTURADO))
        self.assertEqual(m.iso_captura(AGORA+.123), CAPTURADO.replace('Z', '.123Z'))

    def test_mesma_tupla_contraditoria_rejeita_ambas_e_repetida_identica_dedup(self):
        t = traducao();t.respostas.append(dict(t.respostas[0]))
        self.assertEqual(len(m.montar_provas(contexto(), t, CONFIG)[0]), 1)
        t.respostas[-1]['texto'] = 'outra versão'
        self.assertEqual(m.montar_provas(contexto(), t, CONFIG)[0], [])
        self.assertEqual(m.montar_provas(contexto(ambigua=True), traducao(), CONFIG)[0], [])

    def test_vinculo_original_e_pn_br_explicito_sem_colisao_estrangeira(self):
        self.assertEqual(m.chave_br10(LEAD+'@s.whatsapp.net'), CHAVE)
        self.assertIsNone(m.chave_br10('21977776666@s.whatsapp.net'))
        self.assertIsNone(m.chave_br10('121977776666@s.whatsapp.net'))
        for extra in [{'conversaBR10': None}, {'conversaBR10': '2799990000'}, {'idOriginal': 'outro'}, {'direcao': 'saida'}, {'ocorridoEm': m.iso_utc(AGORA-9)}]:
            self.assertFalse(m.montar_provas(contexto(**extra), traducao(), CONFIG)[0])


class Persistencia(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='identidade-captura-')
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name) / 'identidades'

    def config(self):
        self.dir.mkdir(mode=0o700)
        (self.dir/'config.json').write_text(json.dumps(CONFIG), encoding='utf-8')

    def test_optin_ausente_nao_cria_nem_altera_diretorio(self):
        self.assertEqual(m.registrar_provas(None, traducao(), pasta=self.dir), {})
        self.assertFalse(self.dir.exists())

    def test_append_uma_write_fsync_repeticao_permitida_status_agregado_sem_dados(self):
        self.config()
        real_write = os.write
        with patch.object(m.os, 'write', wraps=real_write) as escrever, patch.object(m.os, 'fsync', wraps=os.fsync) as sync:
            m.registrar_provas(contexto(), traducao(), pasta=self.dir)
            self.assertEqual(escrever.call_count, 1)
            self.assertGreaterEqual(sync.call_count, 2)
        m.registrar_provas(contexto(OUTRA), traducao(), pasta=self.dir)
        p = self.dir/(CHAVE+'.jsonl')
        self.assertEqual(len(p.read_text(encoding='utf-8').splitlines()), 2)
        status = json.loads((self.dir/'status-evolution.json').read_text())
        self.assertEqual(status['contagens'], {'provas': 2, 'foraDaAncora': 1})
        for dado in ['conteúdo', 'ID-REAL-FIXTURE', CONTA, OUTRA, HASH, 'NAO-PERSISTIR']:
            self.assertNotIn(dado, json.dumps(status))
        if os.name != 'nt':
            self.assertEqual(self.dir.stat().st_mode & 0o777, 0o700)
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
            self.assertEqual((self.dir/'status-evolution.json').stat().st_mode & 0o777, 0o600)

    def test_negativo_privado_sem_prova_e_status_concorrente_sem_perder_contagens(self):
        self.config()
        c = m.contexto_captura(corpo(sender=None), CAPTURADO, CONFIG, autenticado=True)
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: m.registrar_provas(c, traducao(), pasta=self.dir), range(12)))
        self.assertFalse(list(self.dir.glob('[0-9]*.jsonl')))
        self.assertEqual(json.loads((self.dir/'status-evolution.json').read_text())['contagens'], {'senderAusenteOuInvalido': 12})

    def test_falha_write_shortwrite_fsync_status_propaga_sem_sucesso_falso(self):
        self.config()
        for operacao in ['write', 'fsync']:
            with patch.object(m.os, operacao, side_effect=OSError('fixture')):
                with self.assertRaises(OSError):m.registrar_provas(contexto(), traducao(), pasta=self.dir)
        with patch.object(m.os, 'write', return_value=1):
            with self.assertRaises(OSError):m.registrar_provas(contexto(), traducao(), pasta=self.dir)
        with patch.object(m.os, 'replace', side_effect=OSError('fixture')):
            with self.assertRaises(OSError):m.registrar_provas(contexto(), traducao(), pasta=self.dir)


class AdaptadorIntegrado(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='adaptador-identidade-')
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.ident = self.dir/'identidades';self.ident.mkdir(mode=0o700)
        (self.ident/'config.json').write_text(json.dumps(CONFIG), encoding='utf-8')
        self.raw = self.dir/'adaptador'
        self.a = self.novo()
        self.lista()
        self.logs = []
        self.logpatch = patch.object(ev, 'log', lambda *a:self.logs.append(' '.join(map(str,a))))
        self.logpatch.start();self.addCleanup(self.logpatch.stop)

    def novo(self):
        return ev.Adaptador(ev.Gravador(self.raw, relogio=lambda: AGORA), relogio=lambda: AGORA,
                            avisar=lambda _:None, instancia='prumo', pasta_identidades=self.ident)

    def lista(self, velha=False):
        p = self.raw/'leads.json';p.write_text(json.dumps([CHAVE]))
        os.utime(p, (AGORA-ev.LEADS_VELHOS_S-1 if velha else AGORA,)*2)

    def provas(self):
        p = self.ident/(CHAVE+'.jsonl')
        return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []

    def capturas(self):
        return list((self.raw/'capturas-adaptador').glob('*.json'))

    def test_prova_mesmas_rows_de_entrada_saida_e_audio_original(self):
        eventos = [corpo('  á'*900), corpo(' saída ', id_='SAIDA', entrada=False), corpo(id_='AUDIO')]
        eventos[-1]['data']['message'] = {'audioMessage': {'seconds': 27}}
        for c in eventos:self.a.receber(c, autenticado=True)
        proofs = {p['mensagem']['idOriginal']:p for p in self.provas()}
        for p in self.capturas():
            c = json.loads(p.read_text())
            for r in c['respostas']+c['enviadas']:
                self.assertEqual(proofs[r['id']]['mensagem']['conteudoHash'], hashlib.sha256(r['texto'].strip()[:2000].encode()).hexdigest())
        self.assertEqual(proofs['AUDIO']['mensagem']['conteudoHash'], hashlib.sha256('[áudio 27s]'.encode()).hexdigest())
        self.assertEqual(proofs['SAIDA']['mensagem']['direcao'], 'saida')
        self.assertNotIn('NAO-PERSISTIR', self.a.spool.read_text())

    def test_falha_prova_nao_consumiu_spool_e_reinicio_preserva_sender_de_captura(self):
        with patch.object(m, '_append', side_effect=OSError('fixture')):
            with self.assertRaises(OSError):self.a.receber(corpo(), autenticado=True)
        estado = json.loads(self.a.spool.read_text())
        self.assertEqual(len(estado['pendentes']), 1)
        self.assertFalse(estado['concluidos']);self.assertFalse(self.capturas())
        self.novo().drenar()
        self.assertEqual(len(self.provas()), 1);self.assertEqual(len(self.capturas()), 1)
        self.assertEqual(self.provas()[0]['contaHash'], HASH)

    def test_lista_velha_ack_duravel_metadados_sem_sender_e_drena_depois(self):
        self.lista(velha=True)
        self.a.receber(corpo(sender=OUTRA), autenticado=True)
        spool = self.a.spool.read_text()
        self.assertNotIn(OUTRA, spool);self.assertNotIn('NAO-PERSISTIR', spool)
        self.assertFalse(self.provas());self.assertFalse(self.capturas())
        self.lista();self.novo().drenar()
        self.assertEqual(self.provas()[0]['contaHash'], hashlib.sha256(OUTRA.encode()).hexdigest())

    def test_duas_contas_mesmo_id_corpo_preservam_duas_provas_um_raw(self):
        self.a.receber(corpo(), autenticado=True)
        self.a.receber(corpo(sender=OUTRA), autenticado=True)
        self.assertEqual(len(self.capturas()), 1)
        self.assertEqual({p['contaHash'] for p in self.provas()}, {HASH, hashlib.sha256(OUTRA.encode()).hexdigest()})

    def test_duas_contas_pendentes_lista_velha_preservadas_no_spool(self):
        self.lista(velha=True)
        self.a.receber(corpo(), autenticado=True);self.a.receber(corpo(sender=OUTRA), autenticado=True)
        self.lista();self.novo().drenar()
        self.assertEqual({p['contaHash'] for p in self.provas()}, {HASH, hashlib.sha256(OUTRA.encode()).hexdigest()})
        self.assertEqual(len(self.capturas()), 1)

    def test_sem_sender_timestamp_ou_auth_preserva_raw_mas_nao_atesta(self):
        for ordinal, (c, auth) in enumerate([(corpo(sender=None), True), (corpo(ts=None), True), (corpo(), False)]):
            c['data']['key']['id'] = str(ordinal)
            self.a.receber(c, autenticado=auth)
        self.assertEqual(len(self.capturas()), 3);self.assertFalse(self.provas())
        status = json.loads((self.ident/'status-evolution.json').read_text())['contagens']
        self.assertEqual(status, {'senderAusenteOuInvalido': 1, 'horarioOriginalInvalido': 1, 'capturaNaoAutenticada': 1})
        for dado in [CONTA, HASH, 'ID-REAL-FIXTURE', 'conteúdo']:
            self.assertNotIn(dado, '\n'.join(self.logs))

    def test_ambiguidade_no_mesmo_webhook_nao_elege_texto_para_prova(self):
        c = corpo();c['data'] = [c['data'], corpo('versão conflitante')['data']]
        self.a.receber(c, autenticado=True)
        self.assertEqual(len(self.capturas()), 1)
        self.assertFalse(self.provas())

    def test_numero_estrangeiro_colide_chave_legada_mas_nao_prova_br(self):
        c = corpo()
        estrangeiro = '21977776666@s.whatsapp.net'
        self.assertEqual(ev.chave_do_numero(estrangeiro.split('@')[0]), CHAVE)
        c['data']['key']['remoteJid'] = estrangeiro
        self.a.receber(c, autenticado=True)
        self.assertEqual(len(self.capturas()), 1)
        self.assertFalse(self.provas())
        self.assertEqual(json.loads((self.ident/'status-evolution.json').read_text())['contagens'], {'conversaNaoComprovada': 1})

    def test_lid_pendente_mapa_legado_posterior_nao_e_prova_da_conta(self):
        c = corpo();c['data']['key']['remoteJid'] = '999999999999@lid'
        self.a.receber(c, autenticado=True)
        self.assertFalse(self.provas());self.assertFalse(self.capturas())
        self.a.mapas.guardar('999999999999', '', LEAD+'@s.whatsapp.net')
        self.novo().drenar()
        self.assertEqual(len(self.capturas()), 1)
        self.assertFalse(self.provas())

    def test_lid_mapa_preexistente_nao_prova_mas_hint_no_proprio_evento_sim(self):
        self.a.mapas.guardar('999999999999', '', LEAD+'@s.whatsapp.net')
        c = corpo();c['data']['key']['remoteJid'] = '999999999999@lid'
        self.a.receber(c, autenticado=True)
        self.assertFalse(self.provas());self.assertEqual(len(self.capturas()), 1)
        c['data']['key']['remoteJidAlt'] = LEAD+'@s.whatsapp.net'
        self.a.receber(c, autenticado=True)
        self.assertEqual(len(self.provas()), 1)
        self.assertEqual(len(self.capturas()), 1)

    def test_hint_autenticado_com_lista_velha_preserva_novo_vinculo_sem_promover_antigo(self):
        self.lista(velha=True)
        c = corpo();c['data']['key']['remoteJid'] = '999999999999@lid'
        self.a.receber(c, autenticado=True)
        c['data']['key']['remoteJidAlt'] = LEAD+'@s.whatsapp.net'
        self.a.receber(c, autenticado=True)
        self.lista();self.novo().drenar()
        self.assertEqual(len(self.capturas()), 1)
        self.assertEqual(len(self.provas()), 1)

    def test_sem_config_baseline_sem_metadados_adicionais(self):
        (self.ident/'config.json').unlink()
        self.lista(velha=True);self.a.receber(corpo(), autenticado=True)
        estado = json.loads(self.a.spool.read_text())
        self.assertNotIn('_identidade_captura', next(iter(estado['pendentes'].values()))['corpo'])
        self.assertEqual(list(self.ident.iterdir()), [])

    def test_http_auth_antes_de_corpo_e_prova_fsync_antes_200_falha503(self):
        server = ev.criar_servidor(self.a, 'segredo-fixture', porta=0, endereco='127.0.0.1')
        worker = threading.Thread(target=server.serve_forever, daemon=True);worker.start()
        self.addCleanup(lambda:(server.shutdown(), worker.join(), server.server_close()))
        url = f'http://127.0.0.1:{server.server_address[1]}/evolution'
        def req(c, token):
            return urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(c).encode(), headers={'X-Adaptador':token,'Content-Type':'application/json'}), timeout=3)
        with self.assertRaises(urllib.error.HTTPError) as neg:req(corpo(), 'errado')
        self.assertEqual(neg.exception.code, 401);neg.exception.close();self.assertFalse(self.provas());self.assertFalse(self.a.spool.exists())
        with patch.object(m, '_append', side_effect=OSError('fixture')):
            with self.assertRaises(urllib.error.HTTPError) as erro:req(corpo(), 'segredo-fixture')
        self.assertEqual(erro.exception.code, 503);erro.exception.close();self.assertFalse(self.capturas())
        with req(corpo(), 'segredo-fixture') as ok:self.assertEqual(ok.status, 200)
        self.assertTrue(self.provas());self.assertEqual(len(self.capturas()), 1)


if __name__ == '__main__':
    unittest.main()
