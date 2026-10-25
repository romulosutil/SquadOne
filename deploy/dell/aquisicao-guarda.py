#!/usr/bin/env python3
"""Posse durável exclusiva da aquisição Site/Iris/Estampa; não executa aquisição.

Sem TTL ou retomada automática. A falha do processo/HTTP preserva a posse. Apenas
uma execução com o token retornado pode concluir; reconciliação é CLI explícita.
O banco guarda metadados técnicos, nunca contatos, conteúdo ou preços.
"""
import argparse
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from contextlib import closing
import urllib.request

WORKFLOWS = frozenset(('01 · Caçador', 'PRUMO · Iris — Caçador de clínicas',
                      'PRUMO · CRM de estamparia — Caçador de estamparias'))
MAX_BODY = 2048
MAX_CLAIMS = 100000


def identidade(workflow, execution):
    if workflow not in WORKFLOWS or not isinstance(execution, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', execution):
        raise ValueError('identidade-invalida')
    return hashlib.sha256((workflow + '\0' + execution).encode()).hexdigest()


class Guarda:
    def __init__(self, arquivo):
        self.arquivo = Path(arquivo)
        self.arquivo.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.arquivo.is_symlink():
            raise ValueError('estado-invalido')
        try:
            fd = os.open(self.arquivo, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
            os.close(fd)
        except FileExistsError:
            pass
        self.arquivo.chmod(0o600)
        with closing(self.conexao()) as c:
            c.execute('CREATE TABLE IF NOT EXISTS claims (chave TEXT PRIMARY KEY, workflow TEXT NOT NULL, execucao TEXT NOT NULL, token_hash TEXT NOT NULL, estado TEXT NOT NULL CHECK (estado IN (\'ativa\',\'concluida\',\'reconciliada\')), criada REAL NOT NULL, encerrada REAL, referencia TEXT)')
            c.execute('CREATE TABLE IF NOT EXISTS posse (id INTEGER PRIMARY KEY CHECK(id=1), chave TEXT NOT NULL REFERENCES claims(chave))')

    def conexao(self):
        c = sqlite3.connect(self.arquivo, timeout=10, isolation_level=None)
        try:
            c.row_factory = sqlite3.Row
            c.execute('PRAGMA synchronous=FULL')
            c.execute('PRAGMA foreign_keys=ON')
            c.execute('PRAGMA busy_timeout=10000')
            return c
        except BaseException:
            c.close()
            raise

    def claim(self, workflow, execution):
        chave = identidade(workflow, execution)
        c = self.conexao()
        try:
            c.execute('BEGIN IMMEDIATE')
            anterior = c.execute('SELECT estado FROM claims WHERE chave=?', (chave,)).fetchone()
            if anterior:
                c.commit()
                return {'acquired': False, 'reason': 'execucao-ja-reservada'}
            if c.execute('SELECT 1 FROM posse').fetchone():
                c.commit()
                return {'acquired': False, 'reason': 'aquisicao-em-andamento'}
            if c.execute('SELECT count(*) FROM claims').fetchone()[0] >= MAX_CLAIMS:
                raise ValueError('limite-de-journal')
            token = secrets.token_urlsafe(32)
            c.execute('INSERT INTO claims (chave,workflow,execucao,token_hash,estado,criada) VALUES (?,?,?,?,\'ativa\',?)',
                      (chave, workflow, execution, hashlib.sha256(token.encode()).hexdigest(), time.time()))
            c.execute('INSERT INTO posse (id,chave) VALUES (1,?)', (chave,))
            c.commit()
            return {'acquired': True, 'token': token}
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

    def release(self, workflow, execution, token):
        chave = identidade(workflow, execution)
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{32,100}', token):
            raise ValueError('token-invalido')
        c = self.conexao()
        try:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT token_hash,estado FROM claims WHERE chave=?', (chave,)).fetchone()
            if not row or not hmac.compare_digest(row['token_hash'], hashlib.sha256(token.encode()).hexdigest()):
                raise ValueError('posse-divergente')
            if row['estado'] == 'concluida':
                c.commit()
                return {'released': True, 'alreadyCompleted': True}
            if row['estado'] != 'ativa' or not c.execute('SELECT 1 FROM posse WHERE chave=?', (chave,)).fetchone():
                raise ValueError('posse-divergente')
            c.execute('UPDATE claims SET estado=\'concluida\',encerrada=? WHERE chave=?', (time.time(), chave))
            c.execute('DELETE FROM posse WHERE chave=?', (chave,))
            c.commit()
            return {'released': True, 'alreadyCompleted': False}
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

    def status(self):
        with closing(self.conexao()) as c:
            row = c.execute('SELECT workflow,execucao,criada FROM claims JOIN posse USING(chave)').fetchone()
            return {'v': 1, 'held': row is not None, 'active': dict(row) if row else None,
                    'claims': c.execute('SELECT count(*) FROM claims').fetchone()[0], 'automaticExpiry': False}

    def reconciliar(self, workflow, execution, referencia, *, execucao_encerrada=False, persistencia_conferida=False):
        """Somente CLI humano, após verificar término no n8n e todas as persistências.

        Não reabre a mesma execução. Nem erro nem fim de prazo bastam para este ato.
        """
        chave = identidade(workflow, execution)
        if execucao_encerrada is not True or persistencia_conferida is not True:
            raise ValueError('reconciliacao-nao-confirmada')
        if not isinstance(referencia, str) or not re.fullmatch(r'[A-Za-z0-9_./:-]{3,160}', referencia):
            raise ValueError('referencia-invalida')
        c = self.conexao()
        try:
            c.execute('BEGIN IMMEDIATE')
            if not c.execute('SELECT 1 FROM posse WHERE chave=?', (chave,)).fetchone():
                raise ValueError('posse-divergente')
            c.execute('UPDATE claims SET estado=\'reconciliada\',encerrada=?,referencia=? WHERE chave=?', (time.time(), referencia, chave))
            c.execute('DELETE FROM posse WHERE chave=?', (chave,))
            c.commit()
            return {'reconciled': True, 'sameExecutionMayRunAgain': False}
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()


def servidor(guarda, token, endereco=('127.0.0.1', 8791), rede='172.23.0.0/16'):
    network = ipaddress.ip_network(rede)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def responder(self, code, data):
            body = json.dumps(data).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        def permitido(self):
            ip = ipaddress.ip_address(self.client_address[0])
            return ip.is_loopback or ip in network
        def autorizado(self):
            return self.permitido() and hmac.compare_digest(self.headers.get('X-Aquisicao-Token', ''), token)
        def do_GET(self):
            if not self.permitido(): return self.responder(403, {'error': 'nao-autorizado'})
            if self.path == '/health': return self.responder(200, {'ok': True})
            if self.path != '/status': return self.responder(404, {'error': 'rota-invalida'})
            if not self.autorizado(): return self.responder(403, {'error': 'nao-autorizado'})
            try: self.responder(200, guarda.status())
            except Exception: self.responder(503, {'error': 'estado-indisponivel'})
        def do_POST(self):
            if not self.autorizado(): return self.responder(403, {'error': 'nao-autorizado'})
            if self.path not in ('/claim', '/release'): return self.responder(404, {'error': 'rota-invalida'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= MAX_BODY: raise ValueError()
                body = json.loads(self.rfile.read(length))
                campos = {'workflow', 'execution'} | ({'token'} if self.path == '/release' else set())
                if not isinstance(body, dict) or set(body) != campos: raise ValueError()
                result = (guarda.claim(body['workflow'], body['execution']) if self.path == '/claim'
                          else guarda.release(body['workflow'], body['execution'], body['token']))
                self.responder(200, result)
            except (ValueError, TypeError, KeyError): self.responder(400, {'error': 'pedido-invalido'})
            except Exception: self.responder(503, {'error': 'estado-indisponivel'})
    return ThreadingHTTPServer(endereco, Handler)


def main():
    parser = argparse.ArgumentParser(description='Guarda de aquisição; não executa workflows.')
    parser.add_argument('--status', action='store_true')
    parser.add_argument('--reconciliar', action='store_true')
    parser.add_argument('--workflow')
    parser.add_argument('--execution')
    parser.add_argument('--referencia')
    parser.add_argument('--persistencia-conferida', action='store_true')
    args = parser.parse_args()
    home = Path.home()
    guarda = Guarda(os.environ.get('AQUISICAO_DB', home / '.local/state/prumo-aquisicao/guarda.db'))
    if args.status: print(json.dumps(guarda.status(), ensure_ascii=False)); return
    if args.reconciliar:
        identidade(args.workflow, args.execution)
        # Término é consultado no motor; espera/running nunca são liberados.
        key = (home / '.config/claude-ops/n8n-api-key').read_text().strip()
        req = urllib.request.Request('http://127.0.0.1:5679/api/v1/executions/' + args.execution + '?includeData=true',
                                     headers={'X-N8N-API-KEY': key})
        with urllib.request.urlopen(req, timeout=10) as response: execution = json.load(response)
        encerrada = execution.get('status') in ('success', 'error', 'canceled', 'crashed') and execution.get('stoppedAt') is not None
        if not encerrada or execution.get('workflowData', {}).get('name') != args.workflow: raise ValueError('execucao-nao-encerrada-ou-divergente')
        print(json.dumps(guarda.reconciliar(args.workflow, args.execution, args.referencia,
              execucao_encerrada=encerrada, persistencia_conferida=args.persistencia_conferida))); return
    token_file = Path(os.environ.get('AQUISICAO_TOKEN_FILE', home / '.config/claude-ops/aquisicao-token'))
    if os.name == 'posix' and token_file.stat().st_mode & 0o077: raise ValueError('permissao-do-token-invalida')
    token = token_file.read_text().strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', token): raise ValueError('token-invalido')
    servidor(guarda, token, (os.environ.get('AQUISICAO_BIND', '172.23.0.1'),
             int(os.environ.get('AQUISICAO_PORT', '8791'))), os.environ.get('AQUISICAO_REDE', '172.23.0.0/16')).serve_forever()


if __name__ == '__main__':
    try: main()
    except Exception:
        raise SystemExit('Guarda indisponível; estado preservado. Conferir a fonte privada.')