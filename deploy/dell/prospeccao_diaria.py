"""Reposição gratuita de candidatos de Site. Não envia mensagens nem aprova leads."""
from html.parser import HTMLParser
from contextlib import closing
import datetime as dt
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess
import sqlite3
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from politica_envios import LIMITES_OPERACIONAIS, APROVACOES_COMERCIAIS
from foco_comercial import ler_foco, perfil_no_foco

H = Path.home()
BASE = H / '.local/share/prospeccao-diaria'
MAX_LEITURAS_DIA = 480
ESTOQUE_ALVO = 6
FOCO = ler_foco()
CONSULTAS = [(setor['consulta'], cidade) for cidade in FOCO['cidades'] for setor in FOCO['segmentos']]


class Perfil(HTMLParser):
    def __init__(self):
        super().__init__(); self.titulo = []; self.itens = []; self.h1 = 0; self.links = []
        self.horario = False; self.categoria = []; self._categoria = False

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        acao = d.get('jsaction', '')
        if d.get('data-item-id') == 'oh' or re.search(r'\bpane\.openhours\.', acao):
            self.horario = True
        if tag == 'button' and re.search(r'\bpane\.[\w.]+\.category(?:[;\s]|$)', acao):
            self._categoria = True
        if tag == 'h1': self.h1 += 1
        if 'data-item-id' in d: self.itens.append(d)
        if tag == 'a' and d.get('href'): self.links.append(d['href'])

    def handle_endtag(self, tag):
        if tag == 'h1': self.h1 = max(0, self.h1 - 1)
        if tag == 'button': self._categoria = False

    def handle_data(self, texto):
        if self.h1: self.titulo.append(texto)
        if self._categoria: self.categoria.append(texto)


def resultados(dom):
    parser = Perfil(); parser.feed(dom); saida = {}
    for url in parser.links:
        p = urllib.parse.urlsplit(url)
        if p.scheme != 'https' or p.hostname != 'www.google.com' or not p.path.startswith('/maps/place/'): continue
        ident = re.search(r'!19s(ChIJ[A-Za-z0-9_-]{15,40})(?:[?!&]|$)', url)
        if ident: saida[ident[1]] = url
    return list(saida.items())


def extrair(dom, ident, url):
    """Somente perfil completo do Place ID esperado; ausência de telefone/site inconclusiva adia."""
    if ident not in dom or ident not in url: return None
    parser = Perfil(); parser.feed(dom)
    nome = ' '.join(''.join(parser.titulo).split())
    if not 2 <= len(nome) <= 180 or re.search(r'[<>\n{}\[\]]', nome): return None
    if re.search(r'Fechado permanentemente|Permanentemente fechado', dom, re.I): return None
    telefones = []
    for item in parser.itens:
        if item['data-item-id'].startswith('phone:'):
            n = re.sub(r'\D', '', item.get('aria-label', '').partition(':')[2])
            if len(n) in (10, 11): n = '55' + n
            if re.fullmatch(r'55\d{10,11}', n): telefones.append(n)
    # Um perfil tem de apresentar também endereço e horários: tela parcial não comprova ausência de site.
    if len(set(telefones)) != 1 or not any(i['data-item-id'] == 'address' for i in parser.itens) or not parser.horario: return None
    site = next((i.get('href', '') for i in parser.itens if i['data-item-id'] == 'authority'), '')
    host = (urllib.parse.urlsplit(site).hostname or '').lower()
    if site and host not in ('wa.me', 'api.whatsapp.com', 'instagram.com', 'www.instagram.com', 'facebook.com', 'www.facebook.com'): return None
    tipo = 'sem-link-de-site-no-perfil' if not site else 'link-WhatsApp-no-campo-site' if host in ('wa.me', 'api.whatsapp.com') else 'rede-social-no-campo-site'
    return {'place_id': ident, 'nome': nome, 'telefone': telefones[0], 'maps': url,
            'tipoSite': tipo, 'dominio': host, 'categoria': ' '.join(''.join(parser.categoria).split())[:120],
            'achados': [{'id': 'sem-site' if not site else 'site-e-rede-social'}]}


def ler_dom(url):
    # Nenhuma API, cartão, chave ou inferência. Perfil isolado e removido após a leitura.
    p = urllib.parse.urlsplit(url)
    if p.scheme != 'https' or p.hostname != 'www.google.com' or not p.path.startswith('/maps/'): raise ValueError('URL fora da fonte pública permitida')
    with tempfile.TemporaryDirectory(prefix='prospeccao-publica-') as temp:
        r = subprocess.run(['google-chrome', '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
                            '--lang=pt-BR', '--virtual-time-budget=10000', '--user-data-dir='+temp, '--dump-dom', url],
                           capture_output=True, text=True, timeout=65)
    if r.returncode or len(r.stdout) < 20000 or len(r.stdout) > 5_000_000: raise ValueError('Perfil público indisponível')
    return r.stdout


def mensagem(tipo):
    fato = ('No perfil da empresa que consultei, não encontrei um link para site próprio.' if tipo == 'sem-link-de-site-no-perfil'
            else 'No perfil da empresa que consultei, o campo de site levava ao WhatsApp.' if tipo == 'link-WhatsApp-no-campo-site'
            else 'Na análise do perfil, encontrei um canal de contato no lugar de um site próprio.')
    return 'Oi! Sou o Rômulo, do Prumo, e trabalho com sites para empresas. ' + fato + '\n\nVocês já têm um site para apresentar os serviços e receber pedidos?'


def materializar(perfil, consulta, cidade, now):
    from pesquisa_leads import salvar
    ident = perfil['place_id']; tag = hashlib.sha256(ident.encode()).hexdigest()[:16]
    pasta = H/'auto-site'/('prospeccao-'+tag)
    if pasta.exists():
        anterior = json.loads((pasta/'raio-x-places.json').read_text())
        if anterior.get('place_id') != ident or (pasta/'publicado.json').exists():
            raise ValueError('Pasta existente exige conferência')
    else:
        pasta.mkdir(mode=0o700, parents=True)
    em = now.isoformat(); url = perfil['maps']
    (pasta/'content.md').write_text(f"# {perfil['nome']}\n\n- **place_id:** {ident}\n- **Telefone:** +{perfil['telefone']}\n- **Cidade:** {cidade}\n- **Fonte:** {url}\n- **Consulta:** {consulta}\n\nDescoberta pública; necessidade, impacto e decisor ainda não confirmados. Demo somente sob demanda.\n", encoding='utf-8')
    salvar(pasta/'raio-x-places.json', {'place_id': ident, 'lido_em': em, 'detalhes':
           {'nome': perfil['nome'], 'maps': url, 'status': 'NAO_CONFIRMADO'}})
    salvar(pasta/'raio-x-perfil-conferido.json', {'place_id': ident, 'em': em, 'nomeConferidoNaInterface': True,
           'contatoConfere': True, 'tipoSite': perfil['tipoSite'], 'dominio': perfil['dominio'], 'fechamentoPermanente': False,
           'metodo': 'Perfil público atual por Place ID, com nome, telefone, endereço e horários; sem API paga.'})
    salvar(pasta/'raio-x-pesquisa-gratuita.json', {'versao': 1, 'place_id': ident, 'revisadoEm': em,
           'validoAte': (now+dt.timedelta(days=7)).isoformat(), 'fontes': [{'url': url, 'em': em}], 'achados': perfil['achados']})
    if perfil.get('perfilComercial'):
        salvar(pasta/'raio-x-foco-comercial.json', {'versao': 1, 'em': em, 'fonte': url, **perfil['perfilComercial']})
    if perfil.get('categoria'):
        salvar(pasta/'raio-x-pesquisa-complementar.json', {'versao': 1, 'place_id': ident,
               'conferidoEm': em, 'fontes': [{'url': url, 'coletadoEm': em, 'tipo': 'perfil público Google Maps'}],
               'observacoes': ['Categoria exibida no perfil da própria empresa: '+perfil['categoria']+'.',
                               'Perfil apresenta endereço, telefone e seção de horários. Isso não confirma atividade atual, necessidade ou decisor.']})
    return pasta


def demanda(crm, frente, contatos=(), avaliados=(), config=None):
    """Estoques distintos: aprovações atuais e cadastros próprios ainda em avaliação."""
    from pesquisa_leads import protegido
    from campanha_site import da_nova_pesquisa
    if crm.get('estado') != 'ok' or not isinstance(crm.get('leads'), list):
        raise ValueError('CRM indisponível')
    if frente.get('ativo') is not True:
        return {'estado': 'pausado', 'buscar': False, 'aprovados': 0, 'emAvaliacao': 0}
    if LIMITES_OPERACIONAIS and frente.get('enviados', 0) >= (frente.get('limite') or 20):
        return {'estado': 'limite-de-envio', 'buscar': False, 'aprovados': 0, 'emAvaliacao': 0}
    if LIMITES_OPERACIONAIS and (frente.get('rodada') or {}).get('bloqueado') is True:
        return {'estado': 'rodada-aguarda-revisao', 'buscar': False, 'aprovados': 0, 'emAvaliacao': 0}
    contatos, avaliados = set(contatos), set(avaliados) if APROVACOES_COMERCIAIS else set()
    novos = {l['id']: l for l in crm['leads'] if l.get('produto') == 'site'
             and l.get('sinal') == 'pronto' and not protegido(l) and l['id'] not in contatos
             and da_nova_pesquisa(l, config)}
    prontos = {l['id'] for l in frente.get('fila', []) if l.get('estado') == 'pronto' and l.get('id') in novos}
    aguardando = {ident for ident, l in novos.items() if ident not in prontos and ident not in avaliados
                  and (l.get('pasta') or {}).get('slug', '').startswith('prospeccao-')}
    buscar = len(prontos | aguardando) < ESTOQUE_ALVO
    return {'estado': 'repondo-fila' if buscar else 'estoque-suficiente', 'buscar': buscar,
            'aprovados': len(prontos), 'emAvaliacao': len(aguardando)}


def ler_controle(now):
    from pesquisa_leads import SP
    arquivo = H/'.local/share/frente-comercial/registro.sqlite'
    with closing(sqlite3.connect(arquivo.resolve().as_uri()+'?mode=ro', uri=True)) as db:
        contatos = {r[0] for r in db.execute('SELECT id FROM contatos')}
        avaliados = {r[0] for r in db.execute(
            'SELECT id FROM avaliacoes WHERE dia=? GROUP BY id HAVING COUNT(DISTINCT agente)>=3',
            (now.astimezone(SP).date().isoformat(),))}
    return contatos, avaliados


def sincronizar_crm(ids, timeout=75, atualizar_observador=False):
    """Webhook de leitura existente, com segredo local; confirmar que o CRM viu os IDs."""
    from pesquisa_leads import json_http, CENTRAL
    class SemRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_): return None
    segredo = (H/'.config/claude-ops/crm-segredo').read_text().strip()
    if not segredo: raise ValueError('Atualização do CRM sem credencial')
    req = urllib.request.Request('http://127.0.0.1:5679/webhook/crm-atualizar', data=b'{}',
                                 headers={'Content-Type': 'application/json', 'X-CRM': segredo})
    with urllib.request.build_opener(SemRedirect()).open(req, timeout=20) as resposta:
        if resposta.status != 200: raise ValueError('Atualização não aceita')
        resposta.read(4096)
    limite = time.monotonic()+timeout
    while True:
        crm = json_http(CENTRAL+'/api/operations/crm', timeout=90, max_bytes=32_000_000)
        if crm.get('estado') == 'ok' and set(ids) <= {l['id'] for l in crm.get('leads', [])}:
            if atualizar_observador:
                # A lista em memória era relida a cada dez minutos. Novas fichas
                # precisam estar no capturador antes da próxima saída da fila.
                subprocess.run(['systemctl', '--user', 'restart', 'whatsapp-observador-prumo.service'],
                               check=True, timeout=20, capture_output=True)
            return True
        if time.monotonic() >= limite: raise TimeoutError('Candidatos ainda não visíveis no CRM')
        time.sleep(3)


def executar():
    from pesquisa_leads import salvar
    try:
        resultado = _executar()
    except (Exception, SystemExit) as erro:
        # Nunca publicar corpo de API, credencial, conversa ou telefone no journal.
        resultado = {'estado': 'bloqueado', 'falha': type(erro).__name__}
    resultado.update(atualizadoEm=dt.datetime.now(dt.timezone.utc).isoformat(),
                     estoqueAlvo=ESTOQUE_ALVO, limiteLeiturasDia=MAX_LEITURAS_DIA)
    salvar(H/'.local/share/squadone-operations/prospeccao-diaria.json', resultado)
    return resultado


def _executar(now=None):
    import fcntl
    from campanha_site import ler, autorizar
    from calendario_comercial import proximo_expediente
    from pesquisa_leads import json_http, salvar, protegido, destino, numero, SP, CENTRAL
    now = now or dt.datetime.now(dt.timezone.utc); config = ler()
    if (not config or config.get('modo') != 'continuo-dias-uteis' or config.get('ativo') is not True
            or (LIMITES_OPERACIONAIS and not autorizar({'id': 'site:estoque', 'produto': 'site', 'etapa': 'novo'}, config, now))):
        return {'estado': 'sem-campanha-continua'}
    if proximo_expediente(now) > now: return {'estado': 'fora-do-horario'}
    BASE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (BASE/'rodada.lock').open('a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return {'estado': 'em-andamento'}
        pendencia = BASE/'sincronizacao-pendente.json'
        if pendencia.exists():
            ids_pendentes = json.loads(pendencia.read_text())
            if ids_pendentes:
                sincronizar_crm(ids_pendentes, atualizar_observador=True)
                salvar(pendencia, [])
        crm = json_http(CENTRAL+'/api/operations/crm', timeout=90, max_bytes=32_000_000)
        if crm.get('estado') != 'ok' or not crm.get('leads'): raise ValueError('CRM indisponível')
        frente = json_http(CENTRAL+'/api/operations/crm/frente', timeout=90, max_bytes=2_000_000)
        controle = ler_controle(now)
        necessidade = demanda(crm, frente, *controle, config=config)
        if not necessidade['buscar']: return necessidade
        # Todos os estados e ofertas entram no dedupe, inclusive recusas e exclusões.
        ids = {l['id'].partition(':')[2] for l in crm['leads'] if l.get('produto') == 'site'}
        destinos = {destino(numero(l)) for l in crm['leads'] if numero(l)}
        arquivo = BASE/'uso.json'
        uso = json.loads(arquivo.read_text()) if arquivo.exists() else {}
        dia = now.astimezone(SP).date().isoformat()
        if uso.get('dia') != dia: uso = {'dia': dia, 'consultas': 0, 'indice': uso.get('indice', 0), 'cadastrados': 0}
        if uso['consultas'] >= MAX_LEITURAS_DIA:
            return necessidade | {'estado': 'limite-de-pesquisa', 'cadastrados': uso['cadastrados']}
        setor, cidade = CONSULTAS[uso['indice'] % len(CONSULTAS)]
        uso['indice'] += 1; uso['consultas'] += 1; salvar(arquivo, uso)
        consulta = setor+' em '+cidade
        busca = 'https://www.google.com/maps/search/'+urllib.parse.quote(consulta, safe='')
        dom = ler_dom(busca)
        candidatos = []
        descartes = {'jaCadastrados': 0, 'perfilInaptoOuIncompleto': 0, 'destinoRepetido': 0, 'falhaDeLeitura': 0}
        for ident, url in resultados(dom):
            if ident in ids:
                descartes['jaCadastrados'] += 1; continue
            if uso['consultas'] >= MAX_LEITURAS_DIA: break
            uso['consultas'] += 1; salvar(arquivo, uso)
            try:
                perfil_dom = ler_dom(url); perfil = extrair(perfil_dom, ident, url)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                descartes['falhaDeLeitura'] += 1; continue
            if not perfil:
                descartes['perfilInaptoOuIncompleto'] += 1; continue
            aderencia = perfil_no_foco(perfil, setor, FOCO)
            if not aderencia:
                descartes['perfilInaptoOuIncompleto'] += 1; continue
            perfil['perfilComercial'] = aderencia
            if destino(perfil['telefone']) in destinos:
                descartes['destinoRepetido'] += 1; continue
            candidatos.append(perfil); destinos.add(destino(perfil['telefone']))
            tag = hashlib.sha256(ident.encode()).hexdigest()[:16]
            prova = BASE/(dia+'-'+tag+'.html'); prova.write_text(perfil_dom); prova.chmod(0o600)
            if len(candidatos) >= 5: break
        if not candidatos:
            return necessidade | {'estado': 'pesquisa-sem-candidato-apto', 'consulta': consulta,
                                   'consultas': uso['consultas'], 'descartes': descartes}
        # Mesmo caminho do CRM existente; não extrai tokens de OAuth.
        sys.path.insert(0, str(H/'.local/share/claude-ops'))
        from sheets_proxy import SheetsProxy
        import importlib.util
        spec = importlib.util.spec_from_file_location('site_fonte', H/'.local/share/claude-ops/site-antes-da-venda.py')
        fonte = importlib.util.module_from_spec(spec); spec.loader.exec_module(fonte)
        planilha = fonte.PLANILHA; base = '/v4/spreadsheets/'+planilha
        incluidos = []
        with SheetsProxy([planilha]) as sheets:
            linhas = sheets.get(base+'/values/Leads!A1:ZZ')['values']; cabecalho = linhas[0]
            col = cabecalho.index('place_id'); existentes = {r[col] for r in linhas[1:] if len(r) > col}
            for p in candidatos:
                if p['place_id'] in existentes: continue
                # Releitura do CRM antes de cada inclusão; qualquer histórico na conta mantém o destino fora.
                atual = json_http(CENTRAL+'/api/operations/crm', timeout=90, max_bytes=32_000_000)
                if atual.get('estado') != 'ok': raise ValueError('CRM indisponível na inclusão')
                if any(numero(l) and destino(numero(l)) == destino(p['telefone']) for l in atual['leads']): continue
                wa = 'https://wa.me/'+p['telefone']+'?text='+urllib.parse.quote(mensagem(p['tipoSite']))
                row = {'place_id': p['place_id'], 'nome': p['nome'], 'telefone': p['telefone'], 'cidade': cidade,
                       'maps_url': p['maps'],
                       'vertical': setor, 'status': 'pronto', 'criado_em': now.isoformat(), 'wa_me': wa,
                       'wa_link': fonte.LINKS+'/enviar?place_id='+p['place_id'] if hasattr(fonte, 'LINKS') else
                       'https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook/enviar?place_id='+p['place_id'],
                       'mensagem_variante': 'E', 'ab_elegiveis': 'E'}
                pasta = materializar(p, consulta, cidade, now)
                # Se a resposta do append for ambígua, a próxima rodada relê a fonte em vez de repetir.
                result = sheets.post(base+'/values/Leads!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
                                     {'values': [[row.get(k, '') for k in cabecalho]]})
                if not result.get('updates', {}).get('updatedRows'): raise ValueError('Inclusão sem confirmação; conferir fonte')
                incluidos.append('site:'+p['place_id']); salvar(pendencia, incluidos)
                existentes.add(p['place_id']); uso['cadastrados'] += 1; salvar(arquivo, uso)
        if incluidos:
            sincronizar_crm(incluidos, atualizar_observador=True)
            salvar(pendencia, [])
        return necessidade | {'estado': 'candidatos-cadastrados', 'cadastrados': uso['cadastrados'],
                               'incluidosNestaRodada': len(incluidos), 'crmSincronizado': bool(incluidos),
                               'consultas': uso['consultas'], 'descartes': descartes, 'mensagensEnviadas': 0}


if __name__ == '__main__':
    resultado = executar()
    print(json.dumps(resultado, ensure_ascii=False))
    if resultado.get('falha'): sys.exit(1)
