#!/usr/bin/env python3
"""Falhas/reinícios só com HOME temporário, webhooks sintéticos e transporte dublado."""
import importlib.util
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

_HOME = tempfile.TemporaryDirectory(prefix='entrada-duravel-home-')
os.environ['HOME'] = os.environ['USERPROFILE'] = _HOME.name
os.environ['OBSERVADOR_TRANSCREVER'] = '0'
AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('fixtures_entrada', AQUI / 'evolution-adaptador.test.py')
fx = importlib.util.module_from_spec(spec); spec.loader.exec_module(fx)
ev, ob = fx.ev, fx.ob


class EntradaDuravel(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='entrada-duravel-')
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.agora = fx.T0
        self.g = ev.Gravador(self.dir, relogio=lambda: self.agora)
        self.lista()
        self.a = self.adaptador()
        self.logs = []
        self.addCleanup(patch.stopall)
        patch.object(ev, 'log', lambda *a: self.logs.append(' '.join(str(x) for x in a))).start()
        patch.object(ob, 'log', lambda *a: None).start()

    def lista(self, velha=False, chaves=None):
        p = self.dir / 'leads.json'
        p.write_text(json.dumps(sorted(fx.LEADS if chaves is None else chaves)))
        t = self.agora - ev.LEADS_VELHOS_S - 1 if velha else self.agora
        os.utime(p, (t, t))

    def adaptador(self, instancia='prumo'):
        return ev.Adaptador(ev.Gravador(self.dir, relogio=lambda: self.agora), relogio=lambda: self.agora, avisar=lambda _: None, instancia=instancia)

    def linhas(self, nome):
        campo = {'evolution.log':'linhas','respostas.jsonl':'respostas','enviadas.jsonl':'enviadas'}[nome]
        arquivos = list((self.dir/'capturas-adaptador').glob('*.json'))
        return sorted([r for p in arquivos for r in json.loads(p.read_text())[campo]], key=lambda r:r.get('ts',0))

    def pendentes(self):
        return json.loads(self.a.spool.read_text())['pendentes']

    def observador(self, chamar=None, simultaneo=False):
        if not simultaneo and getattr(self, '_obs_anterior', None): self._obs_anterior.liberar_entrada()
        obs = ob.Observador(set(fx.LEADS), chamar=chamar or (lambda *a: {'ok': True, 'marcados': []}), avisar=lambda _: None,
            relogio=lambda: self.agora, pasta=self.dir, bridge_js=self.dir/'ausente', conversas=ob.Conversas(self.dir/'conversas', 'prumo', lambda: self.agora))
        self.addCleanup(obs.liberar_entrada)
        self._obs_anterior = obs
        return obs

    def test_velho_refresh_e_reinicio_entregam_uma_vez_com_hora_original(self):
        self.lista(velha=True)
        msg = fx.upsert(fx.LEAD, 'resposta protegida', id_='STALE', ts=self.agora-1900)
        self.a.receber(msg)
        self.assertEqual(len(self.pendentes()), 1)
        self.assertEqual(self.linhas('respostas.jsonl'), [])
        novo = self.adaptador()
        self.lista()
        novo.drenar(); novo.drenar(); novo.receber(msg)
        self.assertEqual(self.pendentes(), {})
        self.assertEqual(len(self.linhas('respostas.jsonl')), 1)
        self.assertEqual(self.linhas('respostas.jsonl')[0]['ts'], int(self.agora-1900))
        self.assertEqual(self.linhas('evolution.log'), [], 'atrasada não se fabrica como uma resposta de agora')

    def test_outra_instancia_nunca_recebe_ou_drena_pendencia(self):
        self.lista(velha=True)
        self.a.receber(fx.upsert(fx.LEAD, id_='ROTA'))
        self.lista()
        outro = self.adaptador('site')
        outro.drenar()
        self.assertEqual(len(self.pendentes()), 1)
        self.assertEqual(outro.receber(fx.upsert(fx.LEAD, id_='OUTRA')).linhas, [])
        self.a.drenar()
        self.assertEqual(len(self.linhas('respostas.jsonl')), 1)

    def test_duas_instancias_concorrentes_mesma_rota_deduplicam(self):
        outro = self.adaptador()
        msg = fx.upsert(fx.LEAD, id_='DUP')
        with ThreadPoolExecutor(max_workers=8) as pool:
            resultados = list(pool.map(lambda i: (self.a if i % 2 else outro).receber(msg), range(12)))
        self.assertEqual(sum(len(r.respostas) for r in resultados), 1)
        self.assertEqual(len(self.linhas('respostas.jsonl')), 1)

    def test_mesmo_id_direcoes_e_recibo_separados_replays_zero(self):
        entrada = fx.upsert(fx.LEAD, id_='MESMO')
        saida = fx.upsert(fx.LEAD, de_mim=True, id_='MESMO')
        entregue = fx.atualizacao(fx.LEAD, 'DELIVERY_ACK', via_key=True); entregue['data']['key']['id'] = 'MESMO'
        lido = fx.atualizacao(fx.LEAD, 'READ', via_key=True); lido['data']['key']['id'] = 'MESMO'
        for msg in [entrada, saida, entregue, lido]: self.a.receber(msg)
        for msg in [entrada, saida, entregue, lido]: self.adaptador().receber(msg)
        self.assertCountEqual([l['event'] for l in self.linhas('evolution.log')], ['ignored','owner_sent','owner_receipt'])
        self.assertEqual(len(self.linhas('respostas.jsonl')), 1)
        self.assertEqual(len(self.linhas('enviadas.jsonl')), 1)
        obs = self.observador(); obs.ler_capturas_adaptador()
        self.assertEqual(sorted(e['direcao'] for e in obs.conversa.linhas_de(fx.CHAVE)), ['entrada','saida'])

    def test_lid_pendente_aprende_hint_posterior_e_entrega_em_ordem(self):
        antigo = fx.upsert(fx.LID, 'primeira', id_='LID-1', dominio='lid', ts=self.agora-20)
        self.a.receber(antigo)
        self.assertEqual(len(self.pendentes()), 1)
        novo = fx.upsert(fx.LID, 'segunda', id_='LID-2', dominio='lid', remoteJidAlt=f'{fx.LEAD}@s.whatsapp.net', ts=self.agora-5)
        self.a.receber(novo)
        self.assertEqual([r['texto'] for r in self.linhas('respostas.jsonl')], ['primeira','segunda'])
        self.assertEqual(self.adaptador().mapas.lid[fx.LID], f'{fx.LEAD}@s.whatsapp.net')
        self.a.drenar()
        self.assertEqual(len(self.linhas('respostas.jsonl')), 2)

    def test_reentrega_mesmo_id_lid_agora_com_pn_nao_duplica(self):
        self.a.receber(fx.upsert(fx.LID, 'uma', id_='LID-MESMO', dominio='lid'))
        self.a.receber(fx.upsert(fx.LEAD, 'uma', id_='LID-MESMO'))
        self.assertEqual(len(self.linhas('respostas.jsonl')), 1)

    def test_grupos_ruido_e_desconhecido_fresco_nao_guardam_conteudo(self):
        grupo = fx.upsert(fx.LEAD, 'pessoal', dominio='g.us', remoteJidAlt=f'{fx.LEAD}@s.whatsapp.net')
        ruido = fx.upsert(fx.LEAD); ruido['data']['message'] = {'reactionMessage': {'text':'segredo'}}
        for m in [grupo, ruido, fx.upsert(fx.OUTRO, 'pessoal')]: self.a.receber(m)
        self.assertEqual(self.pendentes(), {})
        self.assertEqual(self.linhas('respostas.jsonl'), [])
        self.assertNotIn('pessoal', self.a.spool.read_text())
        for segredo in [fx.LEAD,fx.LID,'pessoal']: self.assertNotIn(segredo, '\n'.join(self.logs))

    def test_payload_spool_minimo_sem_nome_token_corpo_inteiro(self):
        self.lista(velha=True)
        msg = fx.upsert(fx.LEAD, 'útil', id_='MINIMO'); msg['apikey']='segredo'; msg['data']['token']='token'; msg['data']['extra']='binario'
        self.a.receber(msg)
        estado = self.a.spool.read_text()
        for extra in ['pushName','Fulana','apikey','token','binario']: self.assertNotIn(extra, estado)

    def test_mapa_invalido_nao_inventa_numero(self):
        p = self.dir/'lid-telefone.json'
        ev.salvar_privado(p, {'versao':1,'lid':{fx.LID:f'{fx.LEAD}@s.whatsapp.net','../x':f'{fx.LEAD}@s.whatsapp.net','123456':'abc5511999990000@s.whatsapp.net','123457':'120363@g.us'}})
        self.assertEqual(self.adaptador().mapas.lid, {fx.LID:f'{fx.LEAD}@s.whatsapp.net'})

    def test_falha_salvar_ou_rename_nao_ack_e_reentrega_funciona(self):
        msg = fx.upsert(fx.LEAD, id_='RETRY')
        with patch.object(ev.os, 'replace', side_effect=OSError('número e conteúdo não devem vazar')):
            with self.assertRaises(OSError): self.a.receber(msg)
        self.assertEqual(self.linhas('respostas.jsonl'), [])
        self.a.receber(msg)
        self.assertEqual(len(self.linhas('respostas.jsonl')), 1)

    def test_falha_apos_traducao_antes_append_repeticao_mesmo_processo(self):
        msg = fx.upsert(fx.LEAD, id_='APPEND')
        with patch.object(self.a.gravador, 'escrever', side_effect=OSError('disco')):
            with self.assertRaises(OSError): self.a.receber(msg)
        self.assertEqual(len(self.pendentes()), 1)
        self.a.receber(msg)
        self.assertEqual(len(self.linhas('respostas.jsonl')), 1)

    def test_publicacao_atomica_nao_expoe_arquivo_antes_write_nem_toca_bridge(self):
        obs = self.observador()
        publicar = ev.os.replace
        vistos = []
        def antes_publicar(a, b):
            if Path(b).parent.name == 'capturas-adaptador':
                obs.ler_capturas_adaptador()
                vistos.append(list(obs.conversa.linhas_de(fx.CHAVE)))
            return publicar(a,b)
        with patch.object(ev.os, 'replace', side_effect=antes_publicar):
            self.a.receber(fx.upsert(fx.LEAD, id_='ATOMICO'))
        self.assertEqual(vistos, [[]])
        self.assertFalse((self.dir/'respostas.jsonl').exists())
        obs.ler_capturas_adaptador()
        self.assertEqual(len(obs.conversa.linhas_de(fx.CHAVE)), 1)

    def test_sessao_exclusiva_recarrega_fila_ao_assumir_sem_perder_anterior(self):
        falhar = lambda *a: (_ for _ in ()).throw(TimeoutError('offline sintético'))
        primeiro = self.observador(falhar)
        segundo = self.observador(falhar, simultaneo=True)  # ambos nasceram sem snapshot
        self.a.receber(fx.upsert(fx.LEAD, 'X', id_='EXCLUSIVO-X'))
        primeiro.ler_capturas_adaptador()
        self.a.receber(fx.upsert(fx.LEAD, 'Y', id_='EXCLUSIVO-Y'))
        with self.assertRaises(BlockingIOError): segundo.ler_capturas_adaptador()
        self.assertEqual(len(list((self.dir/'capturas-adaptador').glob('*.json'))), 1)
        primeiro.liberar_entrada()
        segundo.ler_capturas_adaptador()  # relê X da fonte antes de acrescentar Y
        segundo.liberar_entrada()
        final = self.observador(falhar)
        self.assertEqual([m['texto'] for m in final.conversas[fx.CHAVE]['mensagens']], ['X','Y'])
        self.assertTrue(final.pendentes)
        self.assertFalse(list((self.dir/'capturas-adaptador').glob('*.json')))

    def test_id_opaco_e_msgmap_sobrevivem_reinicio(self):
        self.a.receber(fx.upsert(fx.LEAD, de_mim=True, id_='legacy/id'))
        novo = self.adaptador()
        lido = fx.atualizacao(fx.LID, 'READ', via_key=True)
        lido['data']['key']['remoteJid'] = fx.LID+'@lid'
        lido['data']['key']['id'] = 'legacy/id'
        novo.receber(lido)
        self.assertFalse(self.pendentes())
        self.assertEqual([x['event'] for x in self.linhas('evolution.log')], ['owner_sent','owner_receipt'])
        self.assertEqual(novo.mapas.msg['legacy/id'], fx.LEAD+'@s.whatsapp.net')
        self.assertFalse(list(self.dir.glob('legacy*')))

    def test_append_consumido_ledger_falha_restart_nao_reclassifica(self):
        original = self.a._salvar
        def falhar(s):
            if s['concluidos']: raise OSError('commit')
            return original(s)
        with patch.object(self.a, '_salvar', side_effect=falhar):
            with self.assertRaises(OSError): self.a.receber(fx.upsert(fx.LEAD, 'uma', id_='COMMIT'))
        chamadas = []
        def transporte(m, c, b):
            chamadas.append((c,b)); return {'ok':True,'marcados':[]}
        obs = self.observador(transporte)
        for l in self.linhas('evolution.log'): obs.linha(json.dumps(l))
        obs.ler_capturas_adaptador(); obs.fechar_conversas(todas=True); obs.mandar_conversas()
        self.adaptador().drenar()
        obs = self.observador(transporte)
        for l in self.linhas('evolution.log'): obs.linha(json.dumps(l))
        obs.ler_capturas_adaptador(); obs.fechar_conversas(todas=True); obs.mandar_conversas()
        self.assertEqual([c for c,_ in chamadas], ['whatsapp-conversa','whatsapp-resposta'])
        self.assertEqual(len(obs.conversa.linhas_de(fx.CHAVE)), 1)
        self.assertNotIn('_adaptador_id', json.dumps(chamadas))

    def test_timeout_n8n_reinicia_com_fila_e_so_confirma_apos_sucesso(self):
        self.a.receber(fx.upsert(fx.LEAD, id_='N8N'))
        obs = self.observador(lambda *a: (_ for _ in ()).throw(TimeoutError('ambíguo')))
        for l in self.linhas('evolution.log'): obs.linha(json.dumps(l))
        obs.ler_capturas_adaptador(); obs.fechar_conversas(todas=True); obs.mandar_conversas()
        novo = self.observador()
        self.assertEqual(len(novo.pendentes), 1)
        self.assertEqual(len(novo.conversas_prontas), 1)
        novo.esvaziar(); novo.mandar_conversas()
        self.assertFalse(novo.pendentes); self.assertFalse(novo.conversas_prontas)
        final = self.observador()
        self.assertFalse(final.pendentes); self.assertFalse(final.conversas_prontas)

    def test_falha_conversa_nao_apaga_captura(self):
        self.a.receber(fx.upsert(fx.LEAD, id_='CONVERSA'))
        obs = self.observador()
        with patch.object(obs.conversa, '_anexar', side_effect=OSError('disco sintético')):
            with self.assertRaises(OSError): obs.ler_capturas_adaptador()
        self.assertTrue(list((self.dir/'capturas-adaptador').glob('*.json')))
        obs.ler_capturas_adaptador(); obs.fechar_conversas(todas=True); obs.mandar_conversas()
        self.assertFalse(list((self.dir/'capturas-adaptador').glob('*.json')))

    def test_rename_estado_observador_falha_preserva_lendo_reinicio_uma_vez(self):
        self.a.receber(fx.upsert(fx.LEAD, 'persistir', id_='ESTADO'))
        obs = self.observador()
        substituir = ob.os.replace
        def falhar_estado(a, b):
            if Path(a).name.startswith('.entrada-observador-'): raise OSError('rename')
            return substituir(a, b)
        with patch.object(ob.os, 'replace', side_effect=falhar_estado):
            with self.assertRaises(OSError): obs.ler_capturas_adaptador()
        self.assertTrue(list((self.dir/'capturas-adaptador').glob('*.json')))
        novo = self.observador(); novo.ler_capturas_adaptador(); novo.fechar_conversas(todas=True)
        self.assertEqual(len(novo.conversas_prontas), 1)
        self.assertEqual(len(novo.conversas_prontas[0]['mensagens']), 1)
        self.assertEqual(len(novo.conversa.linhas_de(fx.CHAVE)), 1)

    def test_ok_false_nao_consume_fila_do_observador(self):
        self.a.receber(fx.upsert(fx.LEAD, id_='SEMACK'))
        obs = self.observador(lambda *a: {'ok':False})
        for linha in self.linhas('evolution.log'): obs.linha(json.dumps(linha))
        obs.ler_capturas_adaptador(); obs.fechar_conversas(todas=True); obs.mandar_conversas()
        novo = self.observador()
        self.assertEqual(len(novo.pendentes), 1)
        self.assertEqual(len(novo.conversas_prontas), 1)

    def test_lid_correlacionado_com_nao_lead_fresco_limpa_so_pendencia_sem_captura(self):
        self.a.receber(fx.upsert(fx.LID, 'privado', id_='NAOLEAD', dominio='lid'))
        self.a.receber(fx.upsert(fx.OUTRO, 'privado', id_='NAOLEAD'))
        self.assertFalse(self.pendentes())
        self.assertFalse(self.linhas('respostas.jsonl'))
        self.assertNotIn('privado', self.a.spool.read_text())

    def test_captura_cheia_nao_descarta_resposta_do_spool(self):
        self.a.gravador.limite_respostas = 1
        pasta = self.dir/'capturas-adaptador'; pasta.mkdir(exist_ok=True)
        (pasta/('a'*64+'.json')).write_text('xx')
        with self.assertRaises(OSError): self.a.receber(fx.upsert(fx.LEAD, id_='CHEIA'))
        self.assertEqual(len(self.pendentes()), 1)
        (pasta/('a'*64+'.json')).unlink()
        self.a.gravador.limite_respostas = ev.LIMITE_RESPOSTAS
        self.a.drenar()
        self.assertEqual(len(self.linhas('respostas.jsonl')), 1)

    @unittest.skipIf(os.name == 'nt', 'flock entre processos validado no Linux')
    def test_dois_processos_travam_mesmo_spool(self):
        import multiprocessing
        ctx = multiprocessing.get_context('fork')
        inicio = ctx.Event()
        def receber():
            inicio.wait(5)
            self.adaptador().receber(fx.upsert(fx.LEAD, id_='PROCESSOS'))
        processos = [ctx.Process(target=receber) for _ in range(2)]
        for p in processos: p.start()
        inicio.set()
        for p in processos: p.join(10); self.assertEqual(p.exitcode, 0)
        self.assertEqual(len(self.linhas('respostas.jsonl')), 1)

    def test_limite_quantidade_bytes_nao_descarta_antigo(self):
        self.lista(velha=True)
        self.a.receber(fx.upsert(fx.LEAD, id_='ANTIGO'))
        with patch.object(ev, 'PENDENTES_MAX', 1):
            with self.assertRaises(OSError): self.a.receber(fx.upsert(fx.LEAD2, id_='NOVO'))
        self.assertEqual(len(self.pendentes()), 1)
        with patch.object(ev, 'SPOOL_MAX', 2):
            with self.assertRaises(OSError): self.a.receber(fx.upsert(fx.LEAD2, id_='BYTE'))
        self.assertEqual(len(self.pendentes()), 1)

    def test_http_falha_persistencia_retorna503_sem_detalhes_e_retry200(self):
        servidor = ev.criar_servidor(self.a, 'segredo-fixture', porta=0)
        self.addCleanup(servidor.server_close); self.addCleanup(servidor.shutdown)
        threading.Thread(target=servidor.serve_forever, daemon=True).start()
        def chamar():
            req = urllib.request.Request(f'http://127.0.0.1:{servidor.server_address[1]}/evolution', data=json.dumps(fx.upsert(fx.LEAD,'privado',id_='HTTP')).encode(), headers={'X-Adaptador':'segredo-fixture','Content-Type':'application/json'})
            try:
                with urllib.request.urlopen(req, timeout=5) as r: return r.status,json.loads(r.read())
            except urllib.error.HTTPError as e:
                with e: return e.code,json.loads(e.read())
        with patch.object(ev, 'salvar_privado', side_effect=OSError(f'{fx.LEAD} privado segredo-fixture')):
            status, corpo = chamar()
        self.assertEqual(status, 503)
        self.assertEqual(corpo, {'ok':False,'erro':'persistencia_indisponivel'})
        self.assertEqual(chamar()[0], 200)
        self.assertEqual(len(self.linhas('respostas.jsonl')), 1)
        for v in [fx.LEAD,'privado','segredo-fixture']: self.assertNotIn(v, '\n'.join(self.logs))

    @unittest.skipIf(os.name == 'nt', 'permissões POSIX validadas no Linux')
    def test_arquivos_privados_600_e_pasta700(self):
        self.a.receber(fx.upsert(fx.LID, id_='MODO', dominio='lid', remoteJidAlt=f'{fx.LEAD}@s.whatsapp.net'))
        obs = self.observador(); obs.ler_capturas_adaptador()
        for nome in ['entrada-pendente.json','lid-telefone.json','entrada-observador.json','respostas.lendo.jsonl']:
            p = self.dir/nome
            if p.exists(): self.assertEqual(p.stat().st_mode & 0o777, 0o600, nome)
        self.assertEqual(self.dir.stat().st_mode & 0o777, 0o700)

    def test_sessao_impede_aviso_pessoal_de_entrar_no_historico_do_lead(self):
        sessao = self.dir / 'sessao'
        sessao.mkdir()
        (sessao / f'lid-mapping-{fx.LID}_reverse.json').write_text(json.dumps(fx.OUTRO))
        self.a.mapas.sessao_hermes = sessao
        self.a.mapas.guardar(fx.LID, 'AVISO-0', fx.LEAD + '@s.whatsapp.net')
        for i in range(4):
            msg = fx.upsert_lid(fx.LEAD, f'AVISO-{i}', texto='Aviso de encerramento', alt=False)
            msg['data']['senderPn'] = fx.LEAD + '@s.whatsapp.net'
            self.a.receber(msg)
        self.assertEqual(self.pendentes(), {})
        self.assertEqual(self.linhas('enviadas.jsonl'), [])
        self.assertEqual(self.linhas('evolution.log'), [])
        obs = self.observador()
        obs.ler_capturas_adaptador()
        self.assertEqual(obs.conversa.linhas_de(fx.CHAVE), [])

    def test_sender_sozinho_permanece_pendente_sem_contaminar_mapa_apos_reinicio(self):
        msg = fx.upsert_lid(fx.LEAD, 'REMETENTE', alt=False)
        msg['data']['key']['senderPn'] = fx.LEAD + '@s.whatsapp.net'
        msg['data']['participantAlt'] = fx.LEAD2 + '@s.whatsapp.net'
        self.a.receber(msg)
        self.assertEqual(len(self.pendentes()), 1)
        self.assertEqual(self.linhas('enviadas.jsonl'), [])
        self.assertFalse(self.a.mapas.lid)
        self.assertNotIn('senderPn', self.a.spool.read_text())
        self.assertNotIn('participantAlt', self.a.spool.read_text())
        self.adaptador().drenar()
        self.assertEqual(self.linhas('enviadas.jsonl'), [])
        self.assertFalse(self.adaptador().mapas.lid)


if __name__ == '__main__': unittest.main(verbosity=2)
