#!/usr/bin/env python3
"""Pedidos específicos da Central. Sem prospecção, mensagens ou aprovação de qualidade."""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

HOME = Path.home()
AUTO = HOME / 'auto-site'
ESTADO = Path(os.environ.get('SQUADONE_OPERATIONS_DATA_DIR', str(HOME / '.local/share/squadone-operations')))
FILA = ESTADO / 'encontrado-materiais'
LUGARES = ('', '_em-conversa', '_concluidos', '_recusados', '_fechados', '_descartados')
SLUG = re.compile(r'[a-z0-9][a-z0-9_-]{0,179}')
ID = re.compile(r'[a-f0-9]{64}')


def agora():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def ler(p):
    if p.is_symlink() or not p.is_file() or p.stat().st_size > 65536:
        raise ValueError('Fonte de pedido inválida')
    return json.loads(p.read_text(encoding='utf-8'))


def gravar(p, valor, exclusivo=False):
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = p.with_name(p.name + f'.{os.getpid()}.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as h:
            json.dump(valor, h, ensure_ascii=False)
            h.flush()
            os.fsync(h.fileno())
        if exclusivo:
            os.link(temp, p)
        else:
            os.replace(temp, p)
        d = os.open(p.parent, os.O_RDONLY)
        try:
            os.fsync(d)
        finally:
            os.close(d)
    finally:
        temp.unlink(missing_ok=True)


def pedido(id_):
    if not ID.fullmatch(id_):
        raise ValueError('Pedido inválido')
    p = ler(FILA / (id_ + '.json'))
    if p.get('v') != 1 or p.get('id') != id_ or p.get('tipo') not in ('demo', 'raio-x') or not SLUG.fullmatch(str(p.get('slug', ''))) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', str(p.get('placeId', ''))):
        raise ValueError('Pedido fora do esquema')
    return p


def localizar(p):
    encontrados = []
    # Mesmo place_id em mais de uma pasta, inclusive encerrada, exige conferência.
    for lugar in LUGARES:
        base = AUTO / lugar
        if base.is_symlink():
            raise ValueError('Pasta de leads redirecionada')
        for pasta in base.iterdir() if base.is_dir() else ():
            if not SLUG.fullmatch(pasta.name) or not pasta.is_dir():
                continue
            if pasta.is_symlink() or pasta.resolve() != base.resolve() / pasta.name:
                raise ValueError('Pasta redirecionada')
            recibo = ler(pasta / 'publicado.json') if (pasta / 'publicado.json').exists() else {}
            content = pasta / 'content.md'
            if content.is_symlink():
                raise ValueError('Conteúdo redirecionado')
            texto = content.read_text(encoding='utf-8') if content.is_file() else ''
            m = re.search(r'place_id[:* \t]+([a-zA-Z0-9_-]+)', texto, re.I)
            ids = {x for x in (recibo.get('place_id'), m[1] if m else None) if x}
            if p['placeId'] in ids:
                if len(ids) != 1 or pasta.name != p['slug']:
                    raise ValueError('Identidade da pasta diverge')
                encontrados.append((lugar, pasta, recibo))
    if len(encontrados) != 1 or encontrados[0][0] in ('_recusados', '_fechados', '_descartados', '_concluidos'):
        raise ValueError('Pasta ambígua, encerrada ou ausente')
    return encontrados[0][1:]


class SemRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def baixar(url):
    # Só aliases exatos da publicação conferida abaixo; sem redirects nem cookies.
    with urllib.request.build_opener(SemRedirect).open(urllib.request.Request(url, headers={'User-Agent': 'Prumo-conferencia/1'}), timeout=8) as r:
        if r.status != 200:
            raise ValueError('Material não responde')
        corpo = r.read(8 * 1024 * 1024 + 1)
        if len(corpo) > 8 * 1024 * 1024:
            raise ValueError('Material excede o limite')
        return corpo


def conferir(p, fetch=baixar):
    pasta, r = localizar(p)
    tipo = 'site' if p['tipo'] == 'demo' else 'raio-x'
    url = r.get('site_url' if tipo == 'site' else 'raio_x_url', '')
    u = urllib.parse.urlsplit(url)
    demo_host = f"demo-{p['slug']}.vercel.app"
    if u.scheme != 'https' or u.username or u.password or u.port or u.query or u.fragment:
        raise ValueError('URL fora da publicação')
    if tipo == 'site':
        if u.hostname != demo_host or u.path not in ('', '/') or r.get('vercel_project') != f"demo-{p['slug']}":
            raise ValueError('URL do demo não pertence ao pedido')
        nomes = ('index.html', 'og.jpg', 'robots.txt', 'sitemap.xml', 'llms.txt')
        arquivos = {n: (pasta / n).read_bytes() for n in nomes if (pasta / n).is_file()}
        alvos = ['index.html']
    elif u.hostname == 'raio-x-prumo.vercel.app' and re.fullmatch(r'/[a-z0-9][a-z0-9-]{0,99}', u.path):
        nome = u.path[1:] + '.html'
        arquivos = {nome: (pasta / 'raio-x.html').read_bytes()}
        alvos = [nome]
    elif u.hostname == demo_host and u.path == '/raio-x':
        nomes = ('index.html', 'og.jpg', 'robots.txt', 'sitemap.xml', 'llms.txt')
        arquivos = {n: (pasta / n).read_bytes() for n in nomes if (pasta / n).is_file()}
        arquivos['raio-x/index.html'] = (pasta / 'raio-x.html').read_bytes()
        alvos = ['raio-x/index.html']
    else:
        raise ValueError('URL do Raio-X não pertence à publicação conhecida')
    if any((pasta / n).is_symlink() for n in ('index.html', 'og.jpg', 'robots.txt', 'sitemap.xml', 'llms.txt', 'raio-x.html')):
        raise ValueError('Artefato redirecionado')
    libs = Path(__file__).resolve().parent / 'lib'
    sys.path.insert(0, str(libs))
    from qualidade_prumo import motor
    raiz, q, pub = motor()
    recibo = ler(pasta / f'.prumo-qualidade-{tipo}.json')
    embedded = r.get('qualidade' if tipo == 'site' else 'qualidade_raio_x')
    ref, versao = pub.referencia(p['placeId']), pub.versao(arquivos)
    if embedded != recibo or recibo.get('produto_id') != tipo or recibo.get('referencia') != ref or recibo.get('versao') != versao or recibo.get('organizacao_sha256') != q.digest(raiz / '00-contexto/organizacao.md'):
        raise ValueError('Recibo não corresponde aos bytes e à fonte canônica')
    if recibo.get('profissional') is True and recibo.get('estado') == 'profissional':
        avaliacoes = Path(os.environ.get('PRUMO_QUALIDADE_AVALIACOES_DIR', str(HOME / '.config/prumo-qualidade/entregas')))
        cfg = ler(avaliacoes / ref.replace(':', '-') / f'{tipo}.json')
        if not pub.decidir(q.ler(raiz / '06-qualidade/catalogo.json'), tipo, ref, arquivos, cfg, raiz=raiz, squadone=raiz.parent / 'SquadOne')['profissional']:
            raise ValueError('Aceite profissional não confirmado')
    elif recibo.get('profissional') is False and recibo.get('estado') == 'homologacao':
        if not alvos or any(pub.MARCA.encode() not in arquivos[n] for n in alvos):
            raise ValueError('Prévia sem identificação')
    else:
        raise ValueError('Situação de qualidade inválida')
    for nome, corpo in arquivos.items():
        if tipo == 'site':
            endereco = url.rstrip('/') + '/' + ('' if nome == 'index.html' else nome)
        elif u.hostname == 'raio-x-prumo.vercel.app' or nome == 'raio-x/index.html':
            endereco = url
        else:
            endereco = f'https://{demo_host}/' + ('' if nome == 'index.html' else nome)
        if fetch(endereco) != corpo:
            raise ValueError('Publicação diverge do pacote conferido')
    # Timestamp estável para duas conferências da mesma versão antes de enviar.
    return dict(v=1, id=p['id'], estado='pronto', em=r.get('publicado_em' if tipo == 'site' else 'raio_x_em', p['em']), url=url, versao=versao, referencia=ref, qualidade=recibo['estado'])


def autorizar(p):
    config = ler(Path(os.environ['SQUADONE_OPERATIONS_CONFIG'])) if os.environ.get('SQUADONE_OPERATIONS_CONFIG') else {}
    segredo = Path(config.get('crm', {}).get('segredoArquivo', str(HOME / '.config/claude-ops/crm-segredo'))).expanduser()
    token = segredo.read_text(encoding='utf-8').strip()
    if not token:
        raise ValueError('Credencial técnica indisponível')
    req = urllib.request.Request('http://127.0.0.1:9120/api/operations/crm/encontrado/material/autorizar', data=json.dumps({'id': p['id']}).encode(), headers={'Content-Type': 'application/json', 'X-CRM': token}, method='POST')
    with urllib.request.urlopen(req, timeout=15) as r:
        autorizado = json.load(r)
    return autorizado.get('pedido') == p


def preparar(p, pasta):
    # Somente uma tentativa efetiva. Crash é reconciliado por artefatos; nunca republica por timeout.
    tentativa = FILA / (p['id'] + '.tentativa.json')
    if tentativa.exists():
        return
    if p['tipo'] == 'demo':
        destino = pasta / 'PEDIDO-DEMO.json'
        if not destino.exists():
            gravar(destino, {'place_id': p['placeId'], 'em': p['em'], 'origem': 'Encontrado automático — pedido comprovado do cliente', 'pedido_id': p['id']}, exclusivo=True)
        else:
            existente = ler(destino)
            if existente.get('place_id') != p['placeId']:
                raise ValueError('Pedido existente pertence a outro lead')
        # Um gerador já ativo pode ter enumerado a fila antes deste pedido.
        # Aguardar que termine; reservar a nossa única partida antes do efeito.
        ativo = subprocess.run(['systemctl', '--user', 'is-active', '--quiet', 'gerador-de-sites-pedido.service'], check=False, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if ativo.returncode == 0:
            return
        gravar(tentativa, {'v': 1, 'id': p['id'], 'em': agora()}, exclusivo=True)
        subprocess.run(['systemctl', '--user', 'start', '--no-block', 'gerador-de-sites-pedido.service'], check=True, timeout=15, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        gravar(tentativa, {'v': 1, 'id': p['id'], 'em': agora()}, exclusivo=True)
        subprocess.run([str(HOME / '.local/bin/raio-x'), p['slug']], check=True, timeout=1200, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def rodada():
    FILA.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(FILA / '.worker.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        for arq in sorted(FILA.glob('*.json')):
            if not ID.fullmatch(arq.stem):
                continue
            p = pedido(arq.stem)
            resultado = FILA / (p['id'] + '.resultado.json')
            anterior = ler(resultado) if resultado.exists() else {}
            if anterior.get('estado') in ('pronto', 'falha', 'incerto'):
                continue
            try:
                # Nenhuma geração/rede de material antes de conferir política, fonte e responsabilidade atuais.
                if not autorizar(p):
                    continue
                pasta, recibo = localizar(p)
                try:
                    pronto = conferir(p)
                except (OSError, ValueError, urllib.error.URLError):
                    pronto = None
                if pronto:
                    gravar(resultado, pronto)
                    continue
                ja_publicado = bool(recibo.get('site_url' if p['tipo'] == 'demo' else 'raio_x_url'))
                gravar(resultado, dict(v=1, id=p['id'], estado='preparando', em=anterior.get('em', agora())))
                if not ja_publicado:
                    preparar(p, pasta)
                try:
                    gravar(resultado, conferir(p))
                except (OSError, ValueError, urllib.error.URLError):
                    inicio = dt.datetime.fromisoformat(ler(resultado)['em'].replace('Z', '+00:00'))
                    if (dt.datetime.now(dt.timezone.utc) - inicio).total_seconds() > 6 * 3600:
                        gravar(resultado, dict(v=1, id=p['id'], estado='incerto', em=agora()))
            except (urllib.error.URLError, TimeoutError):
                # Central/consulta temporariamente indisponível: preserva e tenta leitura depois.
                continue
            except Exception:
                # Não imprimir conteúdo, IDs, URLs ou credenciais no journal.
                gravar(resultado, dict(v=1, id=p['id'], estado='falha', em=agora()))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--conferir', metavar='ID')
    args = ap.parse_args()
    if args.conferir:
        try:
            print(json.dumps(conferir(pedido(args.conferir))))
        except Exception:
            sys.exit(2)
    else:
        rodada()
