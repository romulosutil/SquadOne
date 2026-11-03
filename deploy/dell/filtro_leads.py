"""Curadoria da Marina: evidência por lead e aprendizado conservador, sem transporte.

O CRM continua sendo a fonte. Memória guarda apenas projeções derivadas e pode
ser reconstruída. Silêncio, robô, recepção e permissão não rotulam lead como ruim.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo

VERSAO = 'marina-curadoria-v1-20261026'
SP = ZoneInfo('America/Sao_Paulo')
MIN_CASOS = 10
JANELA_DIAS = 90
ACHADOS = {'sem-site', 'site-fora-do-ar', 'site-sem-nome', 'site-e-rede-social', 'site-sem-celular-ou-whatsapp'}


def instante(v):
    try:
        d = dt.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        return d.timestamp() if d.tzinfo else None
    except (ValueError, TypeError):
        return None


def normalizar(v):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(v or '').lower()) if not unicodedata.combining(c))


def chave(l):
    url = (l.get('links') or {}).get('whatsapp', '')
    m = re.fullmatch(r'https://wa\.me/(55\d{10,11})', url)
    return m[1][2:4] + m[1][-8:] if m else None


def identidade(l):
    # Identificadores opacos na memória; nunca telefone ou conversa bruta.
    return hashlib.sha256((chave(l) or l['id']).encode()).hexdigest()


def setor(l):
    nome = normalizar(l.get('nicho'))
    for grupo, partes in [('urgencia', ('dedetiz', 'desentup', 'pragas', 'cacamba')),
                          ('advocacia', ('advog', 'advoc')), ('contabilidade', ('contab', 'contador')),
                          ('industria', ('usinag', 'caldeirar', 'metalurg'))]:
        if any(p in nome for p in partes):
            return grupo
    # Não copiar texto arbitrário para o modelo: só letras e espaços, com limite.
    return re.sub(r'[^a-z -]', '', nome)[:60].strip() or 'nao-informado'


def atributos(l):
    achados = {a.get('id') for a in l.get('achados') or [] if isinstance(a, dict)}
    lacuna = ('indisponivel' if 'site-fora-do-ar' in achados else 'rede-social' if 'site-e-rede-social' in achados
              else 'ausente' if 'sem-site' in achados else 'outra' if achados & ACHADOS else 'sem-evidencia')
    return {'oferta': l.get('produto'), 'setor': setor(l), 'lacuna': lacuna}


def qualificado(l):
    s = l.get('spiced') or {}
    def valido(v):
        t = normalizar(v).strip()
        return isinstance(v, str) and 3 <= len(t) <= 200 and t not in {
            'nao sei', 'a confirmar', 'nao confirmado', 'nao informado', 'desconhecido', 'pendente'}
    d = s.get('decisao') or {}
    return valido(s.get('dor')) and valido(s.get('impacto')) and d.get('decisor_confirmado') == 'sim' and valido(d.get('quem'))


def resultado(l, now):
    """Restrições prevalecem sobre o último agradecimento; sem inferência por texto."""
    c = l.get('classificacaoResposta') or {}
    conversa = l.get('conversa') or {}
    restricao = (conversa.get('sinaisComerciais') or {}).get('restricao') or {}
    if restricao.get('tipo') in ('recusa', 'exclusao') or c.get('classe') in ('recusa', 'exclusao') or (l.get('resposta') or {}).get('tipo') in ('negativa', 'exclusao'):
        return 'recusa'
    if c.get('revisar') or (conversa.get('sinaisComerciais') or {}).get('conteudoPendente'):
        return 'revisar'
    enviado = instante((l.get('marcos') or {}).get('enviado'))
    def posterior(e):
        em = instante(e.get('em'))
        return em is not None and enviado is not None and enviado <= em <= now.timestamp()
    aarr = l.get('aarr') or {}
    if any(posterior(e) for e in aarr.get('pagamentos') or []):
        return 'pagamento'
    if any(posterior(e) for e in aarr.get('propostas') or []):
        return 'proposta'
    if qualificado(l):
        return 'qualificado'
    classe = c.get('classe')
    # Um agradecimento final não apaga encaminhamento humano já observado.
    if classe == 'neutra' and c.get('houveRespostaHumana') is True:
        for msg in conversa.get('recentes') or []:
            em = instante(msg.get('em'))
            t = normalizar(msg.get('trecho') or msg.get('texto'))
            if (msg.get('direcao') == 'entrada' and msg.get('papel') != 'robo' and em is not None
                    and enviado is not None and enviado <= em <= now.timestamp()
                    and re.search(r'pode falar.{0,60}responsavel|pessoa que cuida da divulgacao|vou (?:te )?encaminhar', t)):
                return 'acesso'
    if classe in ('acesso', 'permissao', 'curiosidade', 'interesse', 'conversa', 'neutra', 'robo', 'silencio'):
        return classe
    return 'revisar'


_PESQUISA_CACHE = None


def gate_pesquisa_leads(l):
    """Sem rede e sem escrita; revalida identidade, assinatura e validade por lead."""
    global _PESQUISA_CACHE
    arquivo = Path.home()/'.local/share/pesquisa-leads/gate.json'
    if not arquivo.exists(): return []
    try:
        from pesquisa_leads import assinatura, bloqueios_pesquisa, VERSAO as VP
        stat = arquivo.stat()
        chave = (str(arquivo), stat.st_mtime_ns, stat.st_size)
        if _PESQUISA_CACHE is None or _PESQUISA_CACHE[0] != chave:
            _PESQUISA_CACHE = (chave, json.loads(arquivo.read_text()))
        gate = _PESQUISA_CACHE[1]
        if gate.get('versao') != VP: return ['pesquisa-versao-divergente']
        row = gate.get('leads', {}).get(l['id'])
        if not row: return []
        if row.get('assinatura') != assinatura(l): return ['pesquisa-contexto-alterado']
        em = instante(gate.get('geradoEm'))
        if em is None or not -60 <= dt.datetime.now(dt.timezone.utc).timestamp()-em <= 30*3600:
            return ['higiene-desatualizada']
        motivos = [m for m in row.get('motivos', []) if m in ('destino-com-historico-em-outra-ficha', 'destino-duplicado')]
        motivos += bloqueios_pesquisa(l, row.get('pesquisa'))
        return motivos
    except Exception:
        return ['pesquisa-indisponivel']


def avaliar(l, modelo=None, texto=''):
    """Só adia a fila automática; nunca descarta, escreve no CRM ou manda mensagem."""
    c = l.get('conversa') or {}
    restricao = (c.get('sinaisComerciais') or {}).get('restricao') or {}
    produto = l.get('produto')
    motivos = gate_pesquisa_leads(l)
    if restricao.get('tipo') in ('recusa', 'exclusao') or (l.get('resposta') or {}).get('tipo') in ('negativa', 'exclusao') or (l.get('classificacaoResposta') or {}).get('classe') in ('recusa', 'exclusao'):
        motivos.append('recusa-ou-exclusao')
    # Uma indisponibilidade confirmada do destino em qualquer oferta vale para o número.
    if modelo and identidade(l) in modelo.get('semWhatsapp', []):
        motivos.append('destino-sem-whatsapp-confirmado')
    if produto == 'site':
        achados = {a.get('id') for a in l.get('achados') or [] if isinstance(a, dict)}
        if not achados & ACHADOS:
            motivos.append('falta-achado-de-site')
        t = normalizar(texto)
        if re.search(r'\b(montei|preparei|fiz|criamos|criei)\b.{0,90}\b(demo|demonstracao|site)\b', t) and not (l.get('links') or {}).get('site'):
            motivos.append('texto-afirma-demo-pronta-sem-evidencia')
    if produto == 'iris':
        t = normalizar(' '.join([str(l.get('empresa') or ''), str(l.get('nicho') or ''), str((l.get('triagem') or {}).get('sinais') or '')]))
        if not re.search(r'\btea\b|\baba\b|autis|infantil|infanto|crianc|pediatr', t):
            motivos.append('falta-publico-infantil-ou-tea')
    if produto == 'estampa' and not qualificado(l):
        motivos.append('falta-necessidade-impacto-decisor')
    delta = 0
    a = atributos(l)
    for p in (modelo or {}).get('padroes', []):
        if p.get('oferta') == produto and p.get('dimensao') in ('setor', 'lacuna') and a[p['dimensao']] == p.get('valor'):
            delta += p.get('ajuste', 0)
    delta = max(-5, min(5, delta))
    return {'decisao': 'revisar' if motivos else 'apto', 'motivos': motivos, 'ajuste': delta,
            'versao': VERSAO, 'modelo': (modelo or {}).get('hash', 'sem-modelo')}


def wilson(s, n):
    if not n:
        return (0, 1)
    z = 1.96
    p = s / n
    centro = (p + z*z/(2*n))/(1+z*z/n)
    erro = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n))/(1+z*z/n)
    return centro-erro, centro+erro


def aprender(leads, now, contatos=(), memoria=None):
    """Janela móvel, dedupe por número e resultados explícitos; intervalos de 95%.

    Peso <=5 só se grupo E restante da mesma oferta têm >=10 rótulos explícitos
    maduros e intervalos separados. Silêncio/robô/acesso não são rótulos negativos.
    O sinal serve à ordenação; nunca aprova ou veta sozinho.
    """
    grupos = defaultdict(list)
    for l in leads:
        if chave(l):
            grupos[identidade(l)].append(l)
    casos = []; ambiguos = 0
    for ident, ls in grupos.items():
        ativos = [l for l in ls if instante((l.get('marcos') or {}).get('enviado')) is not None]
        if len({l.get('produto') for l in ativos}) > 1:
            ambiguos += 1
            continue
        if not ativos:
            continue
        l = min(ativos, key=lambda l: instante(l['marcos']['enviado']))
        em = instante(l['marcos']['enviado']); idade = now.timestamp()-em
        if not 0 <= idade <= JANELA_DIAS*86400:
            continue
        # Não somar contagens antigas: a cada dia recalcula e incorpora correções do CRM.
        antigo = (memoria or {}).get('atributos', {}).get(hashlib.sha256(l['id'].encode()).hexdigest())
        a = antigo if isinstance(antigo, dict) and antigo.get('oferta') == l.get('produto') else atributos(l)
        casos.append({'identidade': ident, 'atributos': a, 'maduro': idade >= 48*3600,
                      'resultado': resultado(l, now)})
    positivos = {'qualificado', 'proposta', 'pagamento'}
    rotulados = [c for c in casos if c['maduro'] and c['resultado'] in positivos | {'recusa'}]
    padroes = []; coortes = []
    for oferta in sorted({c['atributos']['oferta'] for c in casos}):
        for dimensao in ('setor', 'lacuna'):
            base = [c for c in rotulados if c['atributos']['oferta'] == oferta]
            valores = sorted({c['atributos'][dimensao] for c in casos if c['atributos']['oferta'] == oferta})
            for valor in valores:
                grupo = [c for c in base if c['atributos'][dimensao] == valor]
                resto = [c for c in base if c['atributos'][dimensao] != valor]
                s = sum(c['resultado'] in positivos for c in grupo); sr = sum(c['resultado'] in positivos for c in resto)
                ajuste = 0
                if len(grupo) >= MIN_CASOS and len(resto) >= MIN_CASOS:
                    lo, hi = wilson(s, len(grupo)); lr, hr = wilson(sr, len(resto))
                    ajuste = 5 if lo > hr else -5 if hi < lr else 0
                resumo = {'oferta': oferta, 'dimensao': dimensao, 'valor': valor, 'casosRotulados': len(grupo),
                          'avancosConfirmados': s, 'recusas': len(grupo)-s, 'comparacaoRotulada': len(resto), 'ajuste': ajuste}
                coortes.append(resumo)
                if ajuste:
                    padroes.append(resumo)
    indisponiveis = set()
    for r in contatos:
        if r.get('estado') == 'sem_whatsapp' and isinstance(r.get('chave'), str):
            indisponiveis.add(hashlib.sha256(r['chave'].encode()).hexdigest())
    modelo = {'versao': VERSAO, 'geradoEm': now.isoformat(), 'dia': now.astimezone(SP).date().isoformat(),
              'janelaDias': JANELA_DIAS, 'maturacaoHoras': 48, 'minimoCasos': MIN_CASOS,
              'casos': len(casos), 'maduros': sum(c['maduro'] for c in casos), 'rotulados': len(rotulados),
              'ambiguosExcluidos': ambiguos, 'resultados': dict(Counter(c['resultado'] for c in casos)),
              'padroes': padroes, 'coortes': coortes, 'semWhatsapp': sorted(indisponiveis)}
    # Timestamp não invalida pareceres se a régua efetiva continua igual.
    modelo['hash'] = hashlib.sha256(json.dumps({'versao': VERSAO, 'padroes': padroes, 'semWhatsapp': modelo['semWhatsapp']}, sort_keys=True).encode()).hexdigest()
    anteriores = (memoria or {}).get('atributos', {})
    memoria = {'atributos': {hashlib.sha256(l['id'].encode()).hexdigest():
                            anteriores.get(hashlib.sha256(l['id'].encode()).hexdigest(), atributos(l)) for l in leads}}
    return modelo, memoria


def carregar_modelo(arquivo, now):
    m = json.loads(Path(arquivo).read_text(encoding='utf-8'))
    em = instante(m.get('geradoEm'))
    if m.get('versao') != VERSAO or em is None or not -300 <= now.timestamp()-em <= 30*3600:
        raise ValueError('Curadoria ausente, vencida ou de outra versão')
    if not isinstance(m.get('hash'), str) or not isinstance(m.get('padroes'), list) or not isinstance(m.get('semWhatsapp'), list):
        raise ValueError('Curadoria inválida')
    return m
