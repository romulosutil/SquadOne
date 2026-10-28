#!/usr/bin/env python3
"""Publicação local do retrato CRM. Só derivados privados; sem rede ou inferência.

Pronto contém SHA256 dos bytes do candidato fechado pelo n8n. Arquivo parcial
permanece pendente; .path não usa DirectoryNotEmpty, evitando repetição ocupada.
Execução é sequência local do n8n, não transação/versão das cinco abas Sheets.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import threading
try:
    import fcntl
except ImportError:
    fcntl = None

MAX_BYTES = 32 * 1024 * 1024
# As fontes do crm.json (crm.py): site, prumo, uma por oferta de prumo-ofertas.json e registros. Escrito aqui
# porque este arquivo roda de ~/.local/bin, sem o JSON ao lado; deploy/dell/claude-ops/ofertas.test.py falha
# se divergir. Sem a oferta nova, TODO retrato vira 'fontes-incompletas' e nada é publicado (falha alta).
FONTES = {'site', 'prumo', 'iris', 'estampa', 'registros'}
NOME = re.compile(r'crm-([1-9][0-9]{0,29})\.json')
HASH = re.compile(r'[a-f0-9]{64}')
TRAVA = threading.RLock()

def iso(agora):
    return datetime.fromtimestamp(agora, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def instante(v):
    if not isinstance(v, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z', v):
        raise ValueError('data-invalida')
    d = datetime.fromisoformat(v.replace('Z', '+00:00'))
    return d.timestamp()

def sequencia(v):
    if not isinstance(v, str) or not re.fullmatch(r'[1-9][0-9]{0,29}', v):
        raise ValueError('execucao-invalida')
    return int(v)

def carregar(bytes_):
    def unico(pares):
        d = {}
        for k, v in pares:
            if k in d: raise ValueError('chave-repetida')
            d[k] = v
        return d
    return json.loads(bytes_, object_pairs_hook=unico, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('numero-invalido')))

def privado(p):
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    if p.is_symlink(): raise OSError('diretorio-invalido')
    os.chmod(p, 0o700)

def sync_dir(p):
    if os.name != 'nt':
        fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)

def ler(p, limite=MAX_BYTES):
    fd = os.open(p, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_size > limite: raise ValueError('arquivo-invalido')
        with os.fdopen(fd, 'rb', closefd=False) as f: b = f.read(limite + 1)
        if len(b) > limite: raise ValueError('arquivo-grande')
        return b
    finally: os.close(fd)

def atomico(p, dado):
    b = json.dumps(dado, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    fd, nome = tempfile.mkstemp(prefix='.' + p.name + '-', dir=p.parent)
    try:
        if hasattr(os, 'fchmod'): os.fchmod(fd, 0o600)
        else: os.chmod(nome, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(b); f.flush(); os.fsync(f.fileno())
        os.replace(nome, p)
        sync_dir(p.parent)
    finally:
        try: os.unlink(nome)
        except FileNotFoundError: pass

@contextmanager
def exclusivo(raiz):
    with TRAVA:
        fd = os.open(raiz / '.publicacao-crm.lock', os.O_CREAT | os.O_WRONLY, 0o600)
        try:
            if fcntl: fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally: os.close(fd)

def validar_envelope(e, execucao, agora):
    if not isinstance(e, dict) or set(e) != {'v','execucaoId','arquivo','geradoEm','dados'} or type(e['v']) is not int or e['v'] != 1 or e['execucaoId'] != execucao:
        raise ValueError('envelope-invalido')
    sequencia(e['execucaoId'])
    if instante(e['geradoEm']) > agora: raise ValueError('data-futura')
    d = e['dados']
    if not isinstance(d, dict): raise ValueError('dados-invalidos')
    if e['arquivo'] == 'crm-falha.json':
        if d.get('falhouEm') != e['geradoEm'] or not isinstance(d.get('erro'), str) or not d['erro'].strip():
            raise ValueError('falha-invalida')
        return 'falha-fonte'
    if e['arquivo'] != 'crm.json' or type(d.get('versao')) is not int or d['versao'] != 1 or d.get('geradoEm') != e['geradoEm'] or not isinstance(d.get('origem'), str) or not isinstance(d.get('links'), dict):
        raise ValueError('retrato-invalido')
    if 'publicacao' in d or any(not isinstance(k,str) or not isinstance(v,str) for k,v in d['links'].items()):
        raise ValueError('retrato-invalido')
    fontes = d.get('fontes')
    if not isinstance(fontes, dict) or set(fontes) != FONTES: raise ValueError('fontes-incompletas')
    erro = False
    for k, f in fontes.items():
        if not isinstance(f, dict) or not isinstance(f.get('colunas'), list) or not isinstance(f.get('linhas'), list):
            raise ValueError('fonte-invalida')
        if any(not isinstance(c,str) for c in f['colunas']): raise ValueError('colunas-invalidas')
        if f.get('erro'): erro = True
        for row in f['linhas']:
            if not isinstance(row,dict) or any(not isinstance(c,str) or not isinstance(v,str) for c,v in row.items()):
                raise ValueError('linha-invalida')
            chave = 'place_id' if k == 'site' else 'id' if k == 'registros' else 'ID'
            if not row.get(chave,'').strip(): raise ValueError('linha-sem-id')
    return 'fonte-incompleta' if erro else 'retrato'

def versao_atual(estado):
    """Sem metadado aceita baseline legado válido; corrupção não apaga watermark."""
    atuais = []
    for nome in ('crm.json','crm-falha.json'):
        try: d = carregar(ler(estado / nome))
        except FileNotFoundError: continue
        if not isinstance(d,dict): raise ValueError('estado-atual-invalido')
        p = d.get('publicacao')
        if p is None:
            # Não confundir arquivo arbitrário com baseline compatível.
            if nome == 'crm.json' and (d.get('versao') != 1 or not isinstance(d.get('fontes'),dict)): raise ValueError('baseline-invalida')
            instante(d.get('geradoEm') if nome == 'crm.json' else d.get('falhouEm'))
            continue
        if not isinstance(p,dict) or set(p) != {'v','execucaoId','conteudoHash','publicadoEm'} or p.get('v') != 1 or not isinstance(p.get('conteudoHash'),str) or not HASH.fullmatch(p['conteudoHash']):
            raise ValueError('watermark-invalido')
        instante(p.get('publicadoEm'))
        atuais.append((sequencia(p.get('execucaoId')),p['conteudoHash']))
    if not atuais: return (0,None)
    n = max(i[0] for i in atuais)
    hashes = {h for i,h in atuais if i == n}
    if len(hashes) != 1: raise ValueError('watermark-conflitante')
    return n, hashes.pop()


def limpar_falha_superada(estado):
    """Só retira status derivado comprovadamente anterior ao snapshot publicado."""
    try:
        bom = carregar(ler(estado/'crm.json'))
        falha = carregar(ler(estado/'crm-falha.json'))
    except FileNotFoundError:
        return
    if bom.get('publicacao') and falha.get('publicacao') and sequencia(falha['publicacao']['execucaoId']) < sequencia(bom['publicacao']['execucaoId']):
        (estado/'crm-falha.json').unlink()
        sync_dir(estado)

def publicar(estado, *, agora=None):
    import time
    relogio = time.time if agora is None else lambda: agora
    estado = Path(estado)
    spool = estado / 'crm-publicacao'
    candidatos, prontos = spool / 'candidatos', spool / 'prontos'
    for p in (estado,spool,candidatos,prontos): privado(p)
    c = {k:0 for k in ('publicados','falhasFonte','antigos','repetidos','conflitos','aguardando','invalidos','orfaos')}
    with exclusivo(estado):
        atual, hash_atual = versao_atual(estado)
        limpar_falha_superada(estado)
        nomes = sorted((p for p in prontos.iterdir() if NOME.fullmatch(p.name)), key=lambda p:int(NOME.fullmatch(p.name)[1]))
        for pronto in nomes:
            execucao = NOME.fullmatch(pronto.name)[1]
            candidato = candidatos / pronto.name
            try:
                m = carregar(ler(pronto,4096))
                if not isinstance(m,dict) or set(m) != {'v','execucaoId','conteudoHash'} or type(m['v']) is not int or m['v'] != 1 or m['execucaoId'] != execucao or not isinstance(m['conteudoHash'],str) or not HASH.fullmatch(m['conteudoHash']):
                    c['invalidos'] += 1; continue
                b = ler(candidato)
                h = hashlib.sha256(b).hexdigest()
                if h != m['conteudoHash']: c['aguardando'] += 1; continue
                e = carregar(b)
            except (FileNotFoundError,ValueError,UnicodeError):
                # Pode estar aberto: só o hash exato e JSON integral autorizam publicar.
                c['aguardando'] += 1; continue
            n = sequencia(execucao)
            if n < atual: c['antigos'] += 1
            elif n == atual:
                if h != hash_atual: c['conflitos'] += 1; continue
                c['repetidos'] += 1
            else:
                try: tipo = validar_envelope(e,execucao,relogio())
                except (ValueError,TypeError,OverflowError):
                    tipo = 'candidato-invalido'; c['invalidos'] += 1
                meta = {'v':1,'execucaoId':execucao,'conteudoHash':h,'publicadoEm':iso(relogio())}
                if tipo == 'retrato':
                    dado = {**e['dados'],'publicacao':meta}
                    atomico(estado/'crm.json',dado); c['publicados'] += 1
                    limpar_falha_superada(estado)
                else:
                    # Nunca copia o erro livre das fontes ou o conteúdo de candidato rejeitado.
                    falhou_em = e['geradoEm'] if tipo in ('falha-fonte','fonte-incompleta') else meta['publicadoEm']
                    atomico(estado/'crm-falha.json',{'falhouEm':falhou_em,'erro':'Publicação CRM pendente: '+tipo+'.','publicacao':meta})
                    c['falhasFonte'] += 1
                atual,hash_atual = n,h
            # A publicação já está fsyncada. Um crash antes de retirar é replay idempotente.
            pronto.unlink();sync_dir(prontos)
            candidato.unlink();sync_dir(candidatos)
        c['orfaos'] = sum(1 for p in candidatos.iterdir() if NOME.fullmatch(p.name) and not (prontos/p.name).exists())
        atomico(spool/'status.json',{'v':1,'conferidoEm':iso(relogio()),'execucaoPublicada':str(atual) if atual else None,'contagens':c})
    return c

def main():
    import time
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--estado',type=Path,default=Path.home()/'.local/share/n8n-estado')
    args = parser.parse_args()
    try:
        resultado = publicar(args.estado)
        print(json.dumps(resultado,sort_keys=True));return 0
    except (OSError,ValueError,TypeError):
        print('Publicação CRM indisponível; último retrato preservado.');return 1

if __name__ == '__main__':
    raise SystemExit(main())
