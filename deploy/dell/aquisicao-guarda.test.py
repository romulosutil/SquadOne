"""Concorrência e falhas reais em journal privado de fixtures; sem n8n ou aquisição."""
import concurrent.futures
from contextlib import closing
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error

SPEC = importlib.util.spec_from_file_location('aquisicao_guarda', Path(__file__).with_name('aquisicao-guarda.py'))
m = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(m)
W = '01 · Caçador'
I = 'PRUMO · Iris — Caçador de clínicas'
E = 'PRUMO · CRM de estamparia — Caçador de estamparias'


def concorrer(args):
    file, execution = args
    return m.Guarda(file).claim(W, execution)


def cair_depois_do_commit(file, conn):
    guarda = m.Guarda(file)
    result = guarda.claim(W, 'crash-execution')
    conn.send(result['acquired']); conn.close()
    os._exit(0)


class PosseDuravel(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.file = Path(self.temp.name) / 'private' / 'guarda.db'
        self.g = m.Guarda(self.file)

    def test_processos_simultaneos_admitem_apenas_um_escritor(self):
        ctx = multiprocessing.get_context('spawn')
        with concurrent.futures.ProcessPoolExecutor(max_workers=6, mp_context=ctx) as pool:
            results = list(pool.map(concorrer, [(str(self.file), str(i)) for i in range(18)]))
        self.assertEqual(sum(r['acquired'] for r in results), 1)
        self.assertEqual(self.g.status()['claims'], 1)
        self.assertTrue(self.g.status()['held'])

    def test_exclusao_e_compartilhada_pelos_tres_cacadores(self):
        a = self.g.claim(W, 'site')
        self.assertFalse(self.g.claim(I, 'iris')['acquired'])
        self.assertFalse(self.g.claim(E, 'estampa')['acquired'])
        self.g.release(W, 'site', a['token'])
        self.assertTrue(self.g.claim(I, 'iris')['acquired'])

    def test_crash_apos_commit_e_reinicio_nao_expiram_posse(self):
        ctx = multiprocessing.get_context('spawn'); receiver, sender = ctx.Pipe(duplex=False)
        process = ctx.Process(target=cair_depois_do_commit, args=(str(self.file), sender))
        process.start(); sender.close(); self.assertTrue(receiver.recv()); process.join(10)
        self.assertEqual(process.exitcode, 0); receiver.close()
        # Mesmo um início antigo não cria TTL, heartbeat ou roubo automático.
        with closing(sqlite3.connect(self.file)) as c: c.execute('UPDATE claims SET criada=0');c.commit()
        restarted = m.Guarda(self.file)
        self.assertFalse(restarted.claim(E, 'next')['acquired'])
        self.assertFalse(restarted.status()['automaticExpiry'])

    def test_token_errado_ou_execucao_divergente_nao_liberam(self):
        a = self.g.claim(W, 'one')
        for workflow,execution,token in [(W,'two',a['token']),(I,'one',a['token']),(W,'one','x'*43)]:
            with self.subTest(workflow=workflow,execution=execution):
                with self.assertRaises(ValueError):self.g.release(workflow,execution,token)
                self.assertTrue(self.g.status()['held'])

    def test_replay_de_claim_e_conclusao_nao_reexecutam(self):
        a = self.g.claim(W, 'one')
        self.assertFalse(self.g.claim(W, 'one')['acquired'])
        self.g.release(W, 'one', a['token'])
        self.assertTrue(self.g.release(W, 'one', a['token'])['alreadyCompleted'])
        self.assertFalse(self.g.claim(W, 'one')['acquired'])
        self.assertTrue(self.g.claim(W, 'two')['acquired'])

    def test_reconciliacao_exige_as_duas_provas_e_preserva_registro(self):
        self.g.claim(W,'one')
        for a,b in [(False,True),(True,False),(False,False)]:
            with self.assertRaises(ValueError):self.g.reconciliar(W,'one','audit/ref',execucao_encerrada=a,persistencia_conferida=b)
        self.assertTrue(self.g.status()['held'])
        self.g.reconciliar(W,'one','audit/ref',execucao_encerrada=True,persistencia_conferida=True)
        self.assertFalse(self.g.status()['held']);self.assertEqual(self.g.status()['claims'],1)
        self.assertFalse(self.g.claim(W,'one')['acquired'])

    def test_estado_corrompido_nao_e_apagado(self):
        self.file.write_bytes(b'estado-anterior-invalido')
        with self.assertRaises(sqlite3.DatabaseError):m.Guarda(self.file)
        self.assertEqual(self.file.read_bytes(),b'estado-anterior-invalido')

    def test_journal_nao_guarda_token_em_claro(self):
        a=self.g.claim(W,'one');self.assertNotIn(a['token'].encode(),self.file.read_bytes())
        if os.name=='posix':self.assertEqual(self.file.stat().st_mode & 0o777,0o600)

    def test_workflow_fora_do_escopo_nao_entra(self):
        with self.assertRaises(ValueError):self.g.claim('Agenda','one')
        self.assertFalse(self.g.status()['held'])


class HTTPAutenticado(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.g=m.Guarda(Path(self.tmp.name)/'guarda.db');self.token='fixture-token-'+'x'*40
        self.server=m.servidor(self.g,self.token,('127.0.0.1',0))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.parar);self.url='http://127.0.0.1:'+str(self.server.server_address[1])
    def parar(self):self.server.shutdown();self.server.server_close();self.thread.join(3)
    def req(self,path,data=None,token=True):
        headers={'X-Aquisicao-Token':self.token} if token else {}
        r=urllib.request.Request(self.url+path,data=json.dumps(data).encode() if data is not None else None,headers=headers)
        with urllib.request.urlopen(r) as response:return json.load(response)
    def test_sem_autenticacao_nao_le_status_nem_reserva(self):
        for path,data in [('/status',None),('/claim',{'workflow':W,'execution':'one'})]:
            with self.assertRaises(urllib.error.HTTPError) as e:self.req(path,data,False)
            self.assertEqual(e.exception.code,403);e.exception.close()
        self.assertFalse(self.g.status()['held']);self.assertEqual(self.req('/health',token=False),{'ok':True})
    def test_busy_e_silencioso_e_sem_falso_recibo(self):
        a=self.req('/claim',{'workflow':W,'execution':'one'})
        b=self.req('/claim',{'workflow':I,'execution':'two'})
        self.assertEqual(set(b),{'acquired','reason'});self.assertFalse(b['acquired'])
        self.req('/release',{'workflow':W,'execution':'one','token':a['token']})
        self.assertTrue(self.req('/claim',{'workflow':I,'execution':'two'})['acquired'])
    def test_payload_extra_e_rota_de_reconciliacao_nao_sao_aceitos(self):
        with self.assertRaises(urllib.error.HTTPError) as bad:self.req('/claim',{'workflow':W,'execution':'one','cliente':'nao-guardar'})
        bad.exception.close()
        with self.assertRaises(urllib.error.HTTPError) as e:self.req('/reconciliar',{})
        self.assertEqual(e.exception.code,404);e.exception.close();self.assertFalse(self.g.status()['held'])


if __name__=='__main__':unittest.main()