"""Pesquisa empresarial determinística; projeção reconstruível, nunca CRM ou transporte.

Consultas públicas têm limites, identidade e origem. Indisponibilidade é pendência,
não evidência negativa. Conteúdo do Places só passa em memória; persistimos Place ID
e evidências obtidas diretamente do site institucional. Não há chamada a modelo.
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures
import datetime as dt
import fcntl
import gzip
import hashlib
import html
from html.parser import HTMLParser
import http.client
import ipaddress
import io
import json
import os
from pathlib import Path
import re
import socket
import ssl
import time
import unicodedata
import urllib.parse
import urllib.request
import uuid
from zoneinfo import ZoneInfo

VERSAO = 'pesquisa-e-identidade-v1-20261101'
SP = ZoneInfo('America/Sao_Paulo')
BASE = Path.home() / '.local/share/pesquisa-leads'
CENTRAL = 'http://127.0.0.1:9120'
MAX_BYTES = 1_500_000
SOCIAIS = ('instagram.com', 'facebook.com', 'linktr.ee', 'wa.me', 'whatsapp.com', 'google.com', 'business.site', 'tiktok.com', 'youtube.com')
STOP = set('de da do das dos e em clinica instituto centro espaco escola colegio empresa servicos ltda saude advocacia advogados loja'.split())


def normalizar(v):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(v or '').lower()) if not unicodedata.combining(c))


def tokens(v):
    return set(re.findall(r'[a-z0-9]{3,}', normalizar(v))) - STOP


def timestamp(v):
    try:
        t = dt.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        return t.timestamp() if t.tzinfo else None
    except (TypeError, ValueError):
        return None


def agora():
    return dt.datetime.now(dt.timezone.utc)


def salvar(p, d):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = p.with_name(p.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=2); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, p)
    finally:
        tmp.unlink(missing_ok=True)


def ler(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding='utf-8-sig'))
    except FileNotFoundError:
        return default


def host(url):
    return (urllib.parse.urlsplit(url).hostname or '').lower().removeprefix('www.')


def social(url):
    h = host(url)
    return any(h == s or h.endswith('.' + s) for s in SOCIAIS)


def url_publica(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme not in ('http', 'https') or p.username or p.password or not p.hostname:
        raise ValueError('url-invalida')
    h = p.hostname.lower().rstrip('.')
    if any(h == d or h.endswith('.'+d) for d in ('googleapis.com','apify.com','enrichlayer.com','nubela.co','api.openai.com','api.anthropic.com','openrouter.ai')):
        raise ValueError('fonte-paga-proibida-custo-zero')
    if '.' not in h or h.endswith(('.local', '.internal', '.ts.net', '.localhost')) or p.port not in (None, 80 if p.scheme == 'http' else 443):
        raise ValueError('url-privada')
    ips = sorted({a[4][0] for a in socket.getaddrinfo(h, p.port or (443 if p.scheme == 'https' else 80), type=socket.SOCK_STREAM)})
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise ValueError('ip-privado')
    return p, ips[0]


class HTTPSPublico(http.client.HTTPSConnection):
    def __init__(self, hostname, ip):
        super().__init__(hostname, timeout=7, context=ssl.create_default_context()); self.ip = ip

    def connect(self):
        # DNS não é consultado de novo: conexão e SNI usam IP validado e host original.
        sock = socket.create_connection((self.ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def pagina_publica(url):
    for _ in range(3):
        p, ip = url_publica(url)
        conn = HTTPSPublico(p.hostname, ip) if p.scheme == 'https' else http.client.HTTPConnection(ip, 80, timeout=7)
        try:
            conn.request('GET', urllib.parse.urlunsplit(('', '', p.path or '/', p.query, '')),
                         headers={'Host': p.hostname, 'User-Agent': 'Prumo-pesquisa/1.0 (pesquisa de canais empresariais publicos)', 'Accept': 'text/html', 'Accept-Encoding': 'identity'})
            r = conn.getresponse()
            if r.status in (301, 302, 303, 307, 308):
                location = r.getheader('Location')
                if not location: raise ValueError('redirect-sem-destino')
                url = urllib.parse.urljoin(url, location); continue
            content_type = r.getheader('Content-Type', '')
            if r.status != 200 or 'html' not in content_type.lower():
                return {'url': url, 'http': r.status, 'lida': False}
            raw = r.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES: raise ValueError('pagina-grande')
            charset = re.search(r'charset=([\w-]+)', content_type)
            return {'url': url, 'http': 200, 'lida': True, 'html': raw.decode(charset.group(1) if charset else 'utf-8', errors='replace')}
        finally:
            conn.close()
    raise ValueError('redirecionamentos-excedidos')


class TextoHTML(HTMLParser):
    def __init__(self):
        super().__init__(); self.textos = []; self.titulo = []; self.links = []; self.ignorar = 0; self.no_titulo = False

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'): self.ignorar += 1
        if tag == 'title': self.no_titulo = True
        if tag == 'a':
            href = dict(attrs).get('href', '')
            if href: self.links.append(href)

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'): self.ignorar = max(0, self.ignorar - 1)
        if tag == 'title': self.no_titulo = False

    def handle_data(self, text):
        if not self.ignorar:
            self.textos.append(text)
            if self.no_titulo: self.titulo.append(text)


def cnpj_valido(v):
    c = re.sub(r'[^A-Za-z0-9]', '', v).upper()
    if not re.fullmatch('[A-Z0-9]{12}[0-9]{2}', c) or len(set(c)) == 1: return False
    # CNPJ alfanumérico: valor de cada caractere é ASCII - 48, inclusive letras.
    for length, weights in [(12, [5,4,3,2,9,8,7,6,5,4,3,2]), (13, [6,5,4,3,2,9,8,7,6,5,4,3,2])]:
        rem = sum((ord(a)-48)*b for a,b in zip(c[:length], weights)) % 11
        if int(c[length]) != (0 if rem < 2 else 11-rem): return False
    return True


def identidade_pagina(lead, title, text):
    marca = tokens(lead.get('empresa'))
    cidade = normalizar(str(lead.get('cidade') or '').split('/')[0]).strip()
    # Nome genérico ou só cidade não confirma identidade. Uma marca no título e
    # a cidade no conteúdo, ou duas palavras distintivas da marca, são necessárias.
    titulo = tokens(title)
    hits = marca & titulo
    return bool(marca and ((hits and cidade and cidade in normalizar(text)) or len(hits) >= 2 or (len(marca) == 1 and marca <= titulo)))


def analisar_pagina(lead, page):
    if not page.get('lida'): return {'estado': 'inconclusivo', 'http': page.get('http'), 'url': page.get('url')}
    parser = TextoHTML(); parser.feed(page['html'])
    text = ' '.join(' '.join(parser.textos).split()); title = ' '.join(parser.titulo)
    ident = identidade_pagina(lead, title, text)
    nums = sorted({re.sub(r'[^A-Za-z0-9]', '', x).upper() for x in re.findall(r'\b[A-Za-z0-9]{2}\.[A-Za-z0-9]{3}\.[A-Za-z0-9]{3}/[A-Za-z0-9]{4}-\d{2}\b|\b\d{14}\b', text) if cnpj_valido(x)})
    links = [urllib.parse.urljoin(page['url'], x) for x in parser.links]
    wa = []
    for url in links:
        p = urllib.parse.urlsplit(url)
        if p.hostname == 'wa.me': number = p.path.strip('/')
        elif p.hostname in ('api.whatsapp.com', 'web.whatsapp.com'): number = urllib.parse.parse_qs(p.query).get('phone', [''])[0]
        else: continue
        number = re.sub(r'\D', '', number)
        if re.fullmatch(r'55\d{10,11}', number): wa.append(number)
    n = normalizar(text)
    termos = sorted(set(re.findall(r'\b(?:autismo|infantil|infantojuvenil|pediatria|terapia aba|analise do comportamento aplicada)\b', n)))
    return {'estado': 'identidade-confirmada' if ident else 'identidade-a-conferir', 'url': page['url'],
            'titulo': title[:220], 'identidadeConfirmada': ident, 'cnpjsPublicados': nums if ident else [],
            'whatsappsPublicados': sorted(set(wa)) if ident else [], 'publicoInfantilTea': bool(ident and termos),
            'evidenciaPublico': termos if ident else [],
            'linkedin': sorted({u.split('?')[0] for u in links if host(u) == 'linkedin.com' and urllib.parse.urlsplit(u).path.startswith('/company/')})[:2] if ident else []}


def json_http(url, headers=None, body=None, timeout=12, max_bytes=MAX_BYTES):
    p = urllib.parse.urlsplit(url)
    gratuito = p.scheme == 'https' and p.hostname in {'minhareceita.org', 'brasilapi.com.br', 'servicodados.ibge.gov.br'} and not p.username and not p.password and p.port in (None, 443)
    local = p.scheme == 'http' and p.hostname == '127.0.0.1' and p.port == 9120
    if not (gratuito or local) or body is not None or any(k.lower() in ('authorization','x-api-key','x-goog-api-key') for k in (headers or {})):
        raise ValueError('provedor-ou-autenticacao-proibidos-custo-zero')
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
        headers={'Accept': 'application/json', 'Accept-Encoding':'identity', 'User-Agent': 'Prumo-pesquisa/1.0', **({'Content-Type':'application/json'} if body is not None else {}), **(headers or {})})
    class SemRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_): return None
    with urllib.request.build_opener(SemRedirect()).open(req, timeout=timeout) as r:
        raw = r.read(max_bytes + 1)
        if len(raw) > max_bytes: raise ValueError('resposta-grande')
        return decodificar_json(raw,max_bytes)


def decodificar_json(raw,max_bytes=MAX_BYTES):
    if raw.startswith(b'\x1f\x8b'):
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as f:raw=f.read(max_bytes+1)
    if len(raw)>max_bytes:raise ValueError('resposta-descomprimida-grande')
    return json.loads(raw)


def ambientes(arquivo):
    p = Path(arquivo)
    if not p.exists(): return {}
    if os.name == 'posix' and p.stat().st_mode & 0o077: raise ValueError('permissao-do-segredo')
    out = {}
    for line in p.read_text().splitlines():
        m = re.match(r'^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$', line)
        if m: out[m[1]] = m[2].strip('"\'')
    return out


def consultar_cnpj(cnpj):
    if not cnpj_valido(cnpj): raise ValueError('cnpj-invalido')
    try:
        d = json_http('https://minhareceita.org/' + cnpj)
        provedor = 'Minha Receita'
    except Exception:
        # Mesma fonte primária: alternativa de transporte, não dupla confirmação.
        d = json_http('https://brasilapi.com.br/api/cnpj/v1/' + cnpj); provedor = 'BrasilAPI (Minha Receita)'
    if str(d.get('cnpj', '')).upper() != cnpj: raise ValueError('cnpj-divergente')
    out = {k: d.get(k) for k in ['cnpj', 'razao_social', 'nome_fantasia', 'municipio', 'uf', 'codigo_municipio_ibge', 'situacao_cadastral', 'descricao_situacao_cadastral', 'cnae_fiscal', 'cnae_fiscal_descricao', 'porte', 'data_inicio_atividade']} | {'provedor': provedor}
    codigo = str(out.get('codigo_municipio_ibge') or '')
    if re.fullmatch(r'\d{7}', codigo):
        try:
            out['localidadeIbge'] = consultar_localidade(codigo)
        except Exception:
            out['localidadeIbge'] = {'estado':'a-conferir'}
    return out


def consultar_localidade(codigo):
    if not re.fullmatch(r'\d{7}', str(codigo)): raise ValueError('codigo-ibge-invalido')
    d = json_http('https://servicodados.ibge.gov.br/api/v1/localidades/municipios/' + str(codigo))
    if str(d.get('id')) != str(codigo): raise ValueError('municipio-ibge-divergente')
    return {'codigo': d['id'], 'nome': d.get('nome'), 'fonte':'IBGE', 'em':agora().isoformat()}


def linkedin_apify(dossiers):
    """Bloqueio absoluto: a política vigente proíbe serviços com cobrança."""
    return {'estado':'desabilitado-custo-zero','empresasConfirmadas':0,'chamadas':0}


def vinculo_cnpj(lead, data):
    cidade = normalizar(str(lead.get('cidade') or '').split('/')[0]).strip()
    nomes = tokens(str(data.get('razao_social') or '') + ' ' + str(data.get('nome_fantasia') or ''))
    return bool(cidade and cidade == normalizar(data.get('municipio')) and nomes & tokens(lead.get('empresa')))


def protegido(lead):
    return bool(lead.get('etapa') != 'novo' or lead.get('conversa') or lead.get('resposta') or lead.get('proximoPasso')
                or any((lead.get('marcos') or {}).values()) or lead.get('responsavelConversa', {}).get('responsavel') == 'romulo'
                or lead.get('classificacaoResposta', {}).get('classe') in ('recusa', 'exclusao'))


def numero(lead):
    p = urllib.parse.urlsplit(lead.get('links', {}).get('whatsapp') or '')
    n = p.path.strip('/')
    return n if p.hostname == 'wa.me' and re.fullmatch(r'55\d{10,11}', n) else None


def destino(n):
    return n[2:4] + n[-8:] if n else None


def assinatura(lead):
    d = {k: lead.get(k) for k in ('id', 'produto', 'empresa', 'cidade', 'nicho')}
    d['whatsapp'] = numero(lead)
    d['site'] = lead.get('links', {}).get('site') if lead.get('produto') != 'site' else None
    return hashlib.sha256(json.dumps(d, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def bloqueios_pesquisa(lead, dossier, now=None):
    if not dossier: return []
    now = now or agora()
    if dossier.get('assinatura') != assinatura(lead): return ['pesquisa-contexto-alterado']
    em = timestamp(dossier.get('em'))
    if em is None or not -60 <= now.timestamp()-em <= 7*86400: return ['pesquisa-vencida']
    out = []
    page = dossier.get('pagina') or {}
    # Bloqueia somente contradição observada, não ausência de uma resposta HTTP.
    if lead.get('produto') == 'site' and page.get('identidadeConfirmada') and not social(page.get('url', '')):
        achados = {a.get('id') for a in lead.get('achados', [])}
        if achados & {'sem-site', 'site-fora-do-ar', 'site-e-rede-social'} and not achados & {'site-sem-nome', 'site-sem-celular-ou-whatsapp'}:
            out.append('site-proprio-ativo-contradiz-abordagem')
    c = dossier.get('cnpj') or {}
    if c.get('vinculoConfirmado') and c.get('situacao_cadastral') not in (None, 2, '2'): out.append('cnpj-inativo-confirmado')
    return out


def higienizar(crm, dossiers, now=None):
    now = now or agora(); leads = crm['leads']; protegidos = {destino(numero(l)) for l in leads if numero(l) and protegido(l)}
    vistos = {}; rows = []
    # Uma única preferência por destino; Site primeiro, depois prioridade da fonte.
    def prioridade(l):
        v=(l.get('triagem') or {}).get('prioridade')
        return v if type(v) in (int,float) else 0
    ordem = sorted(leads, key=lambda l: (l.get('produto') != 'site', -prioridade(l), l['id']))
    for l in ordem:
        reasons = []; state = 'pendente-de-evidencia'; key = destino(numero(l)); d = dossiers.get(l['id'])
        if protegido(l): state = 'historico-protegido'
        elif l.get('produto') == 'plus': state = 'canal-humano'
        elif key and key in protegidos: state = 'fora-da-fila'; reasons.append('destino-com-historico-em-outra-ficha')
        elif key and key in vistos: state = 'fora-da-fila'; reasons.append('destino-duplicado')
        else:
            if key: vistos[key] = l['id']
            if not key: reasons.append('canal-a-confirmar')
            reasons += bloqueios_pesquisa(l, d, now)
            if l.get('produto') == 'site' and not {a.get('id') for a in l.get('achados', [])} & {'sem-site','site-fora-do-ar','site-sem-nome','site-e-rede-social','site-sem-celular-ou-whatsapp'}: reasons.append('falta-evidencia-especifica-de-site')
            if l.get('produto') == 'iris':
                text = normalizar(str(l.get('empresa',''))+' '+str(l.get('nicho',''))+' '+str(l.get('triagem',{}).get('sinais','')))
                if not re.search(r'\btea\b|\baba\b|autis|infantil|infanto|crianc|pediatr', text) and not (d or {}).get('pagina',{}).get('publicoInfantilTea'): reasons.append('publico-infantil-tea-a-confirmar')
            if l.get('produto') == 'estampa':
                s=l.get('spiced') or {};dec=s.get('decisao') or {}
                if not (s.get('dor') and s.get('impacto') and dec.get('decisor_confirmado')=='sim' and dec.get('quem')):reasons.append('necessidade-impacto-decisor-a-confirmar')
            state = 'revisar' if reasons else 'candidato-a-avaliacao'
        rows.append({'id': l['id'], 'produto': l['produto'], 'empresa': l.get('empresa'), 'estado': state, 'motivos': reasons,
                     'assinatura': assinatura(l), 'pesquisaEm': (d or {}).get('em'), 'naoAutorizaEnvio': True})
    return rows


def validar_crm(crm, now):
    em = timestamp(crm.get('geradoEm'))
    if crm.get('estado') != 'ok' or not crm.get('leads') or em is None or not -60 <= now.timestamp()-em < 1800 or any(f.get('erro') for f in crm.get('fontes', [])):
        raise ValueError('fonte-incompleta-ou-antiga')


def enriquecer(lead, places_key=None):
    start=time.monotonic(); result={'id':lead['id'], 'produto':lead['produto'], 'em':agora().isoformat(), 'assinatura':assinatura(lead), 'fontes':[], 'pendencias':[], 'consultas':collections.Counter()}
    site=lead.get('links',{}).get('site') if lead.get('produto')!='site' else lead.get('siteInstitucional')
    # places_key é aceito só para compatibilidade. Não é lido nem utilizado.
    # Sem cartão, créditos, franquia ou risco de cobrança posterior.
    if site and not social(site):
        try:
            result['consultas']['site']+=1
            page=pagina_publica(site)
            result['pagina']=analisar_pagina(lead,page)
            if page.get('lida'):
                result['fontes'].append({'tipo':'site-institucional','url':page['url'],'em':result['em']})
            if not result['pagina'].get('identidadeConfirmada'):result['pendencias'].append('identidade-site-a-conferir')
            # Um único contato adicional do mesmo domínio; sem rastrear o site inteiro.
            if page.get('lida') and result['pagina'].get('identidadeConfirmada') and not result['pagina'].get('cnpjsPublicados'):
                parser=TextoHTML();parser.feed(page['html'])
                extra=next((urllib.parse.urljoin(page['url'],x) for x in parser.links if re.search('contato|quem-somos|sobre',x,re.I) and host(urllib.parse.urljoin(page['url'],x))==host(page['url'])),None)
                if extra and extra!=page['url']:
                    try:
                        result['consultas']['site']+=1
                        extra_page=pagina_publica(extra);info=analisar_pagina(lead,extra_page)
                        if info.get('identidadeConfirmada'):
                            result['fontes'].append({'tipo':'site-institucional','url':info['url'],'em':result['em']})
                            for k in ['cnpjsPublicados','whatsappsPublicados','linkedin','evidenciaPublico']:result['pagina'][k]=sorted(set(result['pagina'].get(k,[])+info.get(k,[])))
                            result['pagina']['publicoInfantilTea'] |= info.get('publicoInfantilTea',False)
                    except Exception:result['pendencias'].append('pagina-complementar-inconclusiva')
        except Exception:result['pendencias'].append('site-inconclusivo')
    else:result['pendencias'].append('site-institucional-a-localizar')
    cnpjs=(result.get('pagina') or {}).get('cnpjsPublicados',[])
    if len(cnpjs)==1:
        result['cnpjTentadoEm']=result['em']
        try:
            result['consultas']['cnpj']+=1;data=consultar_cnpj(cnpjs[0]);data['vinculoConfirmado']=vinculo_cnpj(lead,data);result['cnpj']=data
            result['fontes'].append({'tipo':'cadastro-empresarial','url':'https://minhareceita.org/'+cnpjs[0],'em':result['em']})
            if not data['vinculoConfirmado']:result['pendencias'].append('vinculo-cnpj-a-conferir')
        except Exception:result['pendencias'].append('cnpj-indisponivel')
    else:result['pendencias'].append('cnpj-a-conferir' if cnpjs else 'cnpj-nao-localizado')
    result['duracaoMs']=round((time.monotonic()-start)*1000);result['consultas']=dict(result['consultas'])
    result['bloqueios']=bloqueios_pesquisa(lead,result)
    return result


def selecionar(crm, dossiers, novos, limite, campanha=None):
    byid={l['id']:l for l in crm['leads']};fila=ler(Path.home()/'.local/share/squadone-operations/frente-comercial.json',{})
    if campanha is not None:
        from campanha_site import autorizar
        alvos=[]
        for ident in dict.fromkeys(campanha.get('leadsAutorizados', [])):
            l=byid.get(ident);old=dossiers.get(ident)
            if not l or protegido(l) or not autorizar(l,campanha,agora()):continue
            if old and old.get('assinatura')==assinatura(l) and timestamp(old.get('em')) and agora().timestamp()-timestamp(old['em'])<7*86400:continue
            alvos.append(l)
        return alvos[:limite]

    initial=ler(BASE/'amostra.json',[])
    all_leads=byid | {l['id']:l for l in novos}
    initial_pending=[all_leads[i] for i in initial if i in all_leads and i not in dossiers]
    if initial_pending:return initial_pending[:limite]
    ids=[x['id'] for x in fila.get('fila',[]) if x.get('estado')=='pronto']
    ids += [l['id'] for l in sorted(crm['leads'],key=lambda l:l['id']) if l.get('produto') in ('site','iris') and not protegido(l)]
    ids += [l['id'] for l in novos]
    byid.update({l['id']:l for l in novos});unique=list(dict.fromkeys(ids))
    # Alterna ofertas, sem deixar o estoque de Íris impedir pesquisa dos novos produtos.
    grupos=collections.defaultdict(list)
    for ident in unique:
        l=byid.get(ident);old=dossiers.get(ident)
        if not l:continue
        if old and old.get('assinatura')==assinatura(l) and timestamp(old.get('em')) and agora().timestamp()-timestamp(old['em'])<7*86400:continue
        grupos[l['produto']].append(l)
    out=[]
    for i in range(limite):
        for prod in ['site','iris','sgp','prisma','fiscal']:
            if grupos[prod]:out.append(grupos[prod].pop(0))
            if len(out)>=limite:return out
    return out


def executar(limite=5):
    if type(limite)!=int or not 0<=limite<=55:raise ValueError('limite-invalido')
    BASE.mkdir(mode=0o700,parents=True,exist_ok=True)
    with (BASE/'pesquisa.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return {'ok':True,'estado':'pesquisa-em-andamento'}
        now=agora();crm=json_http(CENTRAL+'/api/operations/crm',timeout=90,max_bytes=32_000_000);validar_crm(crm,now)
        old=ler(BASE/'evidencias.json',{});dossiers=old.get('leads',{})
        novos=ler(BASE/'descoberta-45.json',[])
        uso=ler(BASE/'uso.json',{});dia=now.astimezone(SP).date().isoformat()
        if uso.get('dia')!=dia:uso={'dia':dia,'reservados':0,'consultas':{}}
        limite=min(limite,max(0,60-uso['reservados']))
        campanha=ler(Path.home()/'.local/share/squadone-operations/campanha-site-2026-11-02.json',None)
        targets=selecionar(crm,dossiers,novos,limite,campanha)
        # Reserva antes das chamadas; crash não libera orçamento nem repete automaticamente.
        uso['reservados']+=len(targets);salvar(BASE/'uso.json',uso)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            for result in pool.map(enriquecer,targets):
                dossiers[result['id']]=result
                for k,v in result['consultas'].items():uso['consultas'][k]=uso['consultas'].get(k,0)+v
                salvar(BASE/'evidencias.json',{'versao':VERSAO,'geradoEm':agora().isoformat(),'leads':dossiers})
                salvar(BASE/'uso.json',uso)
        # Complementa CNPJs públicos já coletados sem repetir Places ou páginas.
        # Falha é reavaliada após seis horas; jamais vira situação cadastral negativa.
        byid={l['id']:l for l in crm['leads']} | {l['id']:l for l in novos}
        pendentes=[r for r in dossiers.values() if not r.get('cnpj') and len(r.get('pagina',{}).get('cnpjsPublicados',[]))==1
                   and agora().timestamp()-(timestamp(r.get('cnpjTentadoEm')) or 0)>=6*3600][:5]
        for r in pendentes:
            l=byid.get(r['id'])
            if not l or r.get('assinatura')!=assinatura(l):continue
            r['cnpjTentadoEm']=agora().isoformat();uso['consultas']['cnpj']=uso['consultas'].get('cnpj',0)+1
            salvar(BASE/'evidencias.json',{'versao':VERSAO,'geradoEm':agora().isoformat(),'leads':dossiers});salvar(BASE/'uso.json',uso)
            try:
                data=consultar_cnpj(r['pagina']['cnpjsPublicados'][0]);data['vinculoConfirmado']=vinculo_cnpj(l,data);r['cnpj']=data
                r['pendencias']=[x for x in r['pendencias'] if x!='cnpj-indisponivel']
                if not data['vinculoConfirmado'] and 'vinculo-cnpj-a-conferir' not in r['pendencias']:r['pendencias'].append('vinculo-cnpj-a-conferir')
                r['fontes'].append({'tipo':'cadastro-empresarial','url':'https://minhareceita.org/'+data['cnpj'],'em':r['cnpjTentadoEm']})
            except Exception:pass
        # Política vigente de custo zero: não existe caminho de execução paga,
        # inclusive se uma credencial comercial estiver configurada no host.
        linkedin_status=linkedin_apify(dossiers)
        salvar(BASE/'evidencias.json',{'versao':VERSAO,'geradoEm':agora().isoformat(),'leads':dossiers})
        rows=higienizar(crm,dossiers,now)
        # Projeção nova só é publicada quando a fonte completa foi validada.
        snapshot={'versao':VERSAO,'geradoEm':agora().isoformat(),'fonteGeradaEm':crm['geradoEm'],'leads':rows,
                  'evidencias':dossiers,'descoberta':[{'id':l['id'],'empresa':l['empresa'],'produto':l['produto'],'pesquisa':dossiers.get(l['id']), 'hipotese':l.get('hipotese'),'pergunta':l.get('pergunta'),'proximaAcao':l.get('proxima_acao'),'canal':l.get('canal'),'status':'descoberta-sem-qualificacao'} for l in novos]}
        salvar(BASE/'higiene.json',snapshot)
        # O gate usa somente decisões privadas derivadas; nunca altera funil, recusa ou SPICED.
        gate={'versao':VERSAO,'geradoEm':snapshot['geradoEm'],'leads':{r['id']:{'assinatura':r['assinatura'],'estado':r['estado'],'motivos':r['motivos'],'pesquisa':dossiers.get(r['id'])} for r in rows if r['estado']!='historico-protegido'}}
        salvar(BASE/'gate.json',gate)
        summary={'ok':True,'versao':VERSAO,'geradoEm':snapshot['geradoEm'],'fonteGeradaEm':crm['geradoEm'],'total':len(rows),
                 'estados':dict(collections.Counter(r['estado'] for r in rows)),
                 'motivos':dict(collections.Counter(m for r in rows for m in r['motivos'])),
                 'pesquisados':len(dossiers),'pesquisadosNestaRodada':len(targets),'novosPreparados':len(novos),
                 'sitesComIdentidadeConfirmada':sum(bool(r.get('pagina',{}).get('identidadeConfirmada')) for r in dossiers.values()),
                 'cnpjsConsultadosComSucesso':sum(bool(r.get('cnpj')) for r in dossiers.values()),
                 'cnpjsComVinculoConfirmado':sum(bool(r.get('cnpj',{}).get('vinculoConfirmado')) for r in dossiers.values()),
                 'consultasHoje':uso['consultas'],'limitePesquisasDia':60,'custoRealUsd':None,
                 'politicaCusto':'zero','provedoresPagosHabilitados':[],
                 'custoPermitidoNovasConsultasUsd':0,
                 'observacaoCusto':'Consultas Places anteriores à ordem de custo zero permanecem apenas no histórico; não há novas consultas pagas.',
                 'linkedin':linkedin_status,'trends':'pesquisa-de-mercado-sem-veto-individual',
                 'mensagensEnviadas':0,'registrosComerciaisAlterados':0}
        semana=ler(BASE/'semana-2026-11-02.json',{})
        summary['trabalhoDoDia']=next((d for d in semana.get('dias',[]) if d['data']==dia),None)
        salvar(BASE/'resumo.json',summary);salvar(Path.home()/'.local/share/squadone-operations/pesquisa-leads.json',summary)
        # Leitura interna na Central; não envia aviso, e-mail ou mensagem externa.
        arquivo=Path.home()/'.local/share/squadone-operations/hermes-readings.json'
        readings=ler(arquivo,[])
        if isinstance(readings,list):
            ident='pesquisa-prumo-'+dia
            leitura={'id':ident,'projectId':'26693ac6-5798-494d-b416-5a14658149cd','projectName':'SquadOne',
                     'title':'Prumo · Pesquisa e fila revisadas',
                     'summary':f"{summary['total']} fichas revisadas; {summary['pesquisados']} pesquisas públicas; {summary['cnpjsComVinculoConfirmado']} CNPJs associados. "+str((summary['trabalhoDoDia'] or {}).get('entrega') or 'Semana de 2 a 6/11 preparada. Histórico e restrições preservados.'),
                     'severity':'info','occurredAt':summary['geradoEm'],'evidence':str(BASE/'higiene.json'),'source':'Pesquisa empresarial determinística'}
            salvar(arquivo,[leitura]+[r for r in readings if r.get('id')!=ident])
        return summary


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--limite',type=int,default=5);a=parser.parse_args()
    print(json.dumps(executar(a.limite),ensure_ascii=False))


if __name__=='__main__':main()
