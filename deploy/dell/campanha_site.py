"""Escopo da campanha autorizada de 3 a 6/11; não envia nem altera CRM."""
import datetime as dt
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

ARQUIVO = Path.home() / '.local/share/squadone-operations/campanha-site-2026-11-02.json'
_cache = None


def ler():
    global _cache
    try:
        st = ARQUIVO.stat()
    except FileNotFoundError:
        return None
    key = (str(ARQUIVO), st.st_mtime_ns, st.st_size)
    if _cache is None or _cache[0] != key:
        _cache = key, json.loads(ARQUIVO.read_text())
    return _cache[1]


def autorizar(lead, config, agora=None, envio=False):
    if config is None:
        return True  # Sem opt-in, preserva a operação anterior.
    if (not isinstance(config, dict) or config.get('versao') != 1
            or config.get('ativo') is not True or config.get('produto') != 'site'
            or not isinstance(config.get('leadsAutorizados'), list)):
        return False
    agora = agora or dt.datetime.now(dt.timezone.utc)
    if agora.tzinfo is None:
        return False
    dia = agora.astimezone(ZoneInfo('America/Sao_Paulo')).date()
    try:
        inicio = dt.date.fromisoformat(config['inicioEnvios'] if envio else config['inicioPreparacao'])
        fim = dt.date.fromisoformat(config['fimEnvios'])
    except (ValueError, KeyError, TypeError):
        return False
    if envio and 'principais' in config:
        principais, reservas = config['principais'], config.get('reservas', [])
        if not isinstance(principais, list) or not isinstance(reservas, list):
            return False
        if lead.get('id') not in principais + reservas:
            return False
    return (inicio <= dia <= fim and lead.get('produto') == 'site'
            and lead.get('id') in config['leadsAutorizados'])


def permite(lead, agora=None, envio=False):
    try:
        return autorizar(lead, ler(), agora, envio)
    except (OSError, ValueError, TypeError):
        return False


def priorizar_fila(itens, config):
    """Reservas aprovadas entram depois dos principais ainda disponíveis."""
    if config is None:
        return list(itens)
    principais = set(config.get('principais', []))
    reservas = set(config.get('reservas', []))
    return sorted(itens, key=lambda x: 0 if x.get('id') in principais else
                  1 if x.get('id') in reservas else 2)


def complemento_publico(dado, place_id, agora):
    """Expõe fatos delimitados e datas; URLs e contatos ficam na prova privada."""
    try:
        if dado.get('versao') != 1 or dado.get('place_id') != place_id:
            return None
        em = dt.datetime.fromisoformat(dado['conferidoEm'].replace('Z', '+00:00'))
        if not em.tzinfo or not -60 <= (agora - em).total_seconds() <= 7 * 86400:
            return None
        fontes = dado['fontes']
        fatos = dado['observacoes']
        if not isinstance(fontes, list) or not 1 <= len(fontes) <= 8:
            return None
        if not isinstance(fatos, list) or not 1 <= len(fatos) <= 8:
            return None
        publicas = []
        for f in fontes:
            url = urlsplit(f['url'])
            coleta = dt.datetime.fromisoformat(f['coletadoEm'].replace('Z', '+00:00'))
            if (url.scheme not in {'http', 'https'} or not url.hostname
                    or url.username or url.password or not coleta.tzinfo
                    or not -60 <= (agora - coleta).total_seconds() <= 30 * 86400):
                return None
            publicas.append({'dominio': url.hostname, 'coletadoEm': f['coletadoEm'],
                             'tipo': str(f.get('tipo', 'fonte publica'))[:80]})
        if any(not isinstance(x, str) or not x.strip() or len(x) > 350 for x in fatos):
            return None
        return {'conferidoEm': dado['conferidoEm'], 'fontes': publicas,
                'observacoes': [re.sub(r'\d{8,}', '[omitido]', x) for x in fatos]}
    except (AttributeError, ValueError, KeyError, TypeError):
        return None


def evidencia_site(lead, raiz=None, agora=None):
    """Indicadores auditáveis para o parecer, sem URL, telefone ou conversa no modelo.

    Data original preservada. Cadastro e contato têm a mesma fonte; não são duas
    confirmações independentes, nem comprovação de atividade atual ou de decisor.
    """
    if lead.get('produto') != 'site':
        return None
    slug = (lead.get('pasta') or {}).get('slug', '')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}', slug):
        return None
    raiz = raiz or Path.home() / 'auto-site'
    agora = agora or dt.datetime.now(dt.timezone.utc)
    try:
        p = Path(raiz) / slug
        cache = json.loads((p / 'raio-x-places.json').read_text())
        detalhes = cache.get('detalhes') or {}
        em = dt.datetime.fromisoformat(cache['lido_em'])
        url = urlsplit(detalhes.get('maps') or '')
        if (cache.get('place_id') != lead['id'].partition(':')[2] or em.tzinfo is None
                or not -60 <= (agora - em).total_seconds() <= 30 * 86400
                or url.scheme != 'https' or url.hostname not in {'maps.google.com', 'www.google.com', 'www.google.com.br'}):
            return None
        fold = lambda x: re.sub(r'[^a-z0-9]', '', ''.join(c for c in unicodedata.normalize('NFKD', str(x)) if not unicodedata.combining(c)).lower())
        conteudo = (p / 'content.md').read_text()
        telefone = re.search(r'^- \*\*Telefone:\*\*\s*(.+)$', conteudo, re.M)
        publicado = re.sub(r'\D', '', telefone.group(1)) if telefone else ''
        destino = urlsplit((lead.get('links') or {}).get('whatsapp') or '').path.strip('/')
        resultado = {'versaoContexto':2, 'fontePublicaIdentificavel': True, 'identidadeDoNomeConfere': fold(detalhes.get('nome')) == fold(lead.get('empresa')),
                'cadastroOperacionalNaDataDaFonte': detalhes.get('status') == 'OPERATIONAL',
                'contatoCorrespondeAoPublicadoNaFicha': bool(publicado and publicado == destino),
                'coletadoEm': em.isoformat(), 'fonteReaproveitada': True,
                'limite': 'Mesma fonte pública já coletada; não confirma atividade atual, propriedade atual do número, necessidade, urgência ou decisor. WhatsApp é conferido antes do envio.'}
        try:
            ui = json.loads((p / 'raio-x-perfil-conferido.json').read_text())
            conferido = dt.datetime.fromisoformat(ui['em'].replace('Z', '+00:00'))
            if (ui.get('place_id') == cache['place_id'] and conferido.tzinfo
                    and -60 <= (agora - conferido).total_seconds() <= 7 * 86400):
                resultado['conferenciaAtualDoPerfil'] = {
                    'em': ui['em'], 'identificadoPeloPlaceId': True,
                    'nomeConferidoNaInterface': ui.get('nomeConferidoNaInterface') is True,
                    'contatoAtualCorrespondeAFicha': ui.get('contatoConfere') is True,
                    'campoSiteDoPerfilDaPropriaEmpresa': ui.get('tipoSite'),
                    'dominioNoCampoSite': ui.get('dominio'),
                    'avisoFechamentoPermanente': ui.get('fechamentoPermanente'),
                    'metodo': 'Interface pública Google Maps conferida hoje, sem API Places e sem cobrança. O campo Site pertence a este perfil, não à busca de concorrentes. Ausência de link no perfil não prova inexistência de site.'}
                revisao = ui.get('revisaoDeIdentidade')
                if (isinstance(revisao, dict) and ui.get('contatoConfere') is True
                        and revisao.get('nomePublico') and revisao.get('criterio')):
                    resultado['conferenciaAtualDoPerfil']['revisaoDeIdentidade'] = {
                        k: str(revisao[k])[:240] for k in ['nomePublico', 'criterio']}
                analise = ui.get('analisePublicaConferida')
                if (isinstance(analise, dict) and analise.get('http') == 200
                        and isinstance(analise.get('pontos'), list)
                        and len(analise['pontos']) == 3):
                    resultado['conferenciaAtualDoPerfil']['analisePublicaConferida'] = {
                        'http': 200, 'pontos': [str(x)[:240] for x in analise['pontos']],
                        'limite': 'Tres observacoes verificaveis, nao prova de perda de clientes ou intencao de compra.'}
        except (OSError, ValueError, KeyError, TypeError):
            pass
        try:
            site = json.loads((p / 'raio-x-site-conferido.json').read_text())
            em_site = dt.datetime.fromisoformat(site['em'].replace('Z', '+00:00'))
            if site.get('place_id') == cache['place_id'] and em_site.tzinfo and -60 <= (agora - em_site).total_seconds() <= 7 * 86400:
                resultado['conferenciaTecnicaDoSite'] = {k:site.get(k) for k in ['em','http','dominio','identidadeConfirmada','celular','whatsapp','erroDns','limite']}
        except (OSError, ValueError, KeyError, TypeError):
            pass
        try:
            arquivo = p / 'raio-x-pesquisa-complementar.json'
            if arquivo.stat().st_size <= 32768:
                complemento = complemento_publico(json.loads(arquivo.read_text()), cache['place_id'], agora)
                if complemento:
                    resultado['pesquisaComplementar'] = complemento
        except (OSError, ValueError, TypeError):
            pass
        return resultado
    except (OSError, ValueError, KeyError, TypeError):
        return None
