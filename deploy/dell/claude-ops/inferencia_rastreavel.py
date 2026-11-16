"""Cache reconstruível e medidas da inferência existente. Nenhum prompt é salvo.

SQLite confirma cada escrita antes do retorno e sobrevive ao reinício do serviço.
O cache é privado e contém a saída pública da prospecção por prazo limitado;
não é fonte comercial. Falhas nunca entram no cache.
"""
import hashlib
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import time

VERSAO = 'prumo-inferencia-2026-10-23-v1'
TTL = {'classificar': 900, 'resumir': 86400}


def chave(modelo, dado):
    pacote = json.dumps([VERSAO, modelo, dado['tarefa'], dado['prompt']], ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(pacote.encode()).hexdigest()


class Registro:
    def __init__(self, arquivo):
        self.arquivo = Path(arquivo)
        self.arquivo.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.conectar() as db:
            db.execute('CREATE TABLE IF NOT EXISTS cache (chave TEXT PRIMARY KEY, expira REAL NOT NULL, resposta TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS chamadas (id INTEGER PRIMARY KEY, em REAL NOT NULL, chave TEXT NOT NULL, tarefa TEXT NOT NULL, modelo TEXT NOT NULL, duracao_ms INTEGER NOT NULL, cache INTEGER NOT NULL, resultado TEXT NOT NULL, chamadas_modelo INTEGER NOT NULL)')
        self.arquivo.chmod(0o600)

    @contextmanager
    def conectar(self):
        db = sqlite3.connect(self.arquivo, timeout=15)
        try:
            with db:
                yield db
        finally:
            db.close()

    def consultar(self, hash_pedido, agora=None):
        agora = time.time() if agora is None else agora
        with self.conectar() as db:
            linha = db.execute('SELECT resposta FROM cache WHERE chave=? AND expira>?', (hash_pedido, agora)).fetchone()
        return json.loads(linha[0]) if linha else None

    def guardar(self, hash_pedido, tarefa, resposta, agora=None):
        agora = time.time() if agora is None else agora
        with self.conectar() as db:
            db.execute('DELETE FROM cache WHERE expira<=?', (agora,))
            db.execute('INSERT OR REPLACE INTO cache VALUES (?,?,?)', (hash_pedido, agora + TTL[tarefa], json.dumps(resposta, ensure_ascii=False)))
            db.execute('DELETE FROM cache WHERE chave IN (SELECT chave FROM cache ORDER BY expira DESC LIMIT -1 OFFSET 5000)')

    def medir(self, hash_pedido, tarefa, modelo, duracao_ms, cache, resultado, chamadas_modelo=0):
        if resultado not in ('sucesso', 'falha', 'teto'):
            raise ValueError('Resultado de medição inválido')
        with self.conectar() as db:
            db.execute('INSERT INTO chamadas (em,chave,tarefa,modelo,duracao_ms,cache,resultado,chamadas_modelo) VALUES (?,?,?,?,?,?,?,?)',
                       (time.time(), hash_pedido, tarefa, modelo, max(0, int(duracao_ms)), int(cache), resultado, int(chamadas_modelo)))
            db.execute('DELETE FROM chamadas WHERE id NOT IN (SELECT id FROM chamadas ORDER BY id DESC LIMIT 100000)')

    def resumo(self):
        with self.conectar() as db:
            linhas = db.execute('SELECT tarefa,modelo,cache,resultado,COUNT(*),SUM(duracao_ms),SUM(chamadas_modelo) FROM chamadas GROUP BY tarefa,modelo,cache,resultado').fetchall()
        return [{'tarefa': t, 'modelo': m, 'cache': bool(c), 'resultado': r, 'solicitacoes': n,
                 'chamadas_modelo': chamadas, 'duracao_total_ms': ms,
                 'custo': None} for t, m, c, r, n, ms, chamadas in linhas]
