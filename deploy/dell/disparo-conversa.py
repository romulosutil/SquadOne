#!/usr/bin/env python3
"""Disparo das retomadas aprovadas pelo PM (decisão delegada pelo Rômulo em 28/10/2026).

Entrada: um JSON com {"lido_ate": ISO, "mensagens": [{"lead_id", "texto"}...]} sem telefone; o número sai do
CRM da Central (links.whatsapp), como no frente-comercial. Antes de cada envio confere de novo: Central fresca,
expediente seg–sex 8h–17h30 de SP, Evolution `open` e observador de pé, e a conversa do lead: nada novo DELE
depois de `lido_ate` (o contexto mudou: o texto aprovado pode não servir mais) e nenhuma saída nossa hoje
(nunca duas no mesmo dia). Espaça os envios. Depois do recibo, anota na Ficha no formato que o Escritório lê.
Uso: disparo-conversa aprovadas.json [--enviar]   (sem --enviar só simula)
     disparo-conversa --do-dia [--enviar]            (a lista do dia, em LISTAS/AAAA-MM-DD.json de SP)

O --do-dia é o do disparo-conversa.timer (29/10/2026). Até então o disparo era um timer temporário do
systemd-run, que some se a Mel reiniciar e não roda depois se ela estiver desligada na hora. A unit é
versionada (deploy/dell/disparo-conversa.{service,timer}, Persistent=true) e lê um caminho fixo: sem a
lista do dia, não envia nada e sai com 0. Um dia só lê a própria lista; a de ontem nunca vira a de hoje.
Envio incerto (a Evolution não confirmou) sai com 1, para o OnFailure avisar pelo Telegram.
Nada aqui passa pela trava de ritmo nem pela pausa dos primeiros contatos: retomada é conversa, não
primeiro contato, e cada lista é aprovada antes de entrar em LISTAS.
"""
import datetime as dt, json, random, re, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

H = Path.home()
SP = ZoneInfo('America/Sao_Paulo')
CENTRAL = 'http://127.0.0.1:9120'
ORIGEM = {'Origin': CENTRAL}
EVOLUTION = 'http://127.0.0.1:8081'
LOG = H / '.local/share/disparo-conversa'
LISTAS = LOG / 'listas'
INICIO, FIM = 9 * 60, 11 * 60  # o bloco 1 do PM (09h00–10h30) com folga, dentro do expediente de venda
ESPACO = (300, 360)  # com os 2/h do time automático, fica abaixo de 12 saídas por hora

def http(url, body=None, headers=None, timeout=25):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)

def instante(v):
    try: return dt.datetime.fromisoformat(str(v).replace('Z', '+00:00')).timestamp()
    except ValueError: return None

def numero(lead):
    u = urllib.parse.urlparse((lead.get('links') or {}).get('whatsapp', ''))
    n = u.path.strip('/')
    return n if u.scheme == 'https' and u.netloc == 'wa.me' and re.fullmatch(r'55\d{10,11}', n) else None

def chave(n): return n[2:4] + n[-8:]

def no_expediente():
    a = dt.datetime.now(SP)
    return a.weekday() < 5 and INICIO <= a.hour * 60 + a.minute < FIM

def apikey():
    for linha in (H / 'workspace/evolution/.env').read_text().splitlines():
        if linha.startswith('EVOLUTION_APIKEY='): return linha.partition('=')[2].strip().strip('"\'')
    raise RuntimeError('sem credencial da Evolution')

def conexao():
    auth = {'apikey': apikey()}
    estado = http(EVOLUTION + '/instance/connectionState/prumo', headers=auth).get('instance', {}).get('state')
    if estado != 'open': raise RuntimeError(f'WhatsApp do PRUMO não está open ({estado})')
    r = subprocess.run(['systemctl', '--user', 'is-active', 'evolution-adaptador', 'whatsapp-observador-prumo'],
                       capture_output=True, text=True, timeout=10)
    if r.returncode != 0: raise RuntimeError('observador das conversas fora do ar')
    return auth

def ler_crm():
    c = http(CENTRAL + '/api/operations/crm', timeout=60)
    t = instante(c.get('geradoEm'))
    if c.get('estado') != 'ok' or not t or time.time() - t > 1800: raise RuntimeError('CRM desatualizado')
    return {l['id']: l for l in c.get('leads', [])}

def motivo_para_nao_enviar(lead, lido_ate):
    conv = http(CENTRAL + '/api/operations/crm/conversa?id=' + urllib.parse.quote(lead['chave']), timeout=20)
    hoje = dt.datetime.now(SP).date()
    for m in conv.get('mensagens', []):
        em = instante(m.get('em'))
        if em is None: continue
        if m.get('direcao') == 'entrada' and em > lido_ate: return 'o lead escreveu depois da leitura do PM'
        if m.get('direcao') == 'saida' and dt.datetime.fromtimestamp(em, SP).date() == hoje: return 'já recebeu mensagem nossa hoje'
    return None

def enviar(n, texto, auth):
    from mensagem_inicial import configuracao
    if configuracao('aquisicao-comercial.json').get('respostasAutomaticas') is not True:
        raise RuntimeError('Retomadas automáticas aposentadas; Rômulo conduz a conversa')
    r = http(EVOLUTION + '/message/sendText/prumo', {'number': n, 'text': texto, 'linkPreview': False}, auth, timeout=40)
    k = r.get('key', {})
    if k.get('fromMe') is not True or not k.get('id') or chave(k.get('remoteJid', '').split('@')[0]) != chave(n):
        raise RuntimeError('a Evolution não confirmou destinatário e id')
    return k['id']

def anotar(lead, texto):
    data = dt.datetime.now(SP).date().isoformat()
    nota = (f'[Envio confirmado pelo operador · {data}]\nRetomada aprovada pelo PM (decisão delegada pelo Rômulo em 28/10/2026), '
            f'enviada pela integração do WhatsApp: {texto}')
    produto, _, id_ = lead['id'].partition(':')
    http(CENTRAL + '/api/operations/crm/registro', {'produto': produto, 'id': id_, 'tipo': 'nota', 'data': '', 'texto': nota}, ORIGEM, timeout=20)

def registrar(linha):
    LOG.mkdir(parents=True, exist_ok=True, mode=0o700)
    p = LOG / (dt.datetime.now(SP).date().isoformat() + '.jsonl')
    with p.open('a') as f: f.write(json.dumps({'em': dt.datetime.now(dt.timezone.utc).isoformat(), **linha}, ensure_ascii=False) + '\n')
    p.chmod(0o600)

def lista_do_dia(hoje=None):
    return LISTAS / ((hoje or dt.datetime.now(SP).date()).isoformat() + '.json')

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if '--do-dia' in sys.argv:
        caminho = lista_do_dia()
        if not caminho.exists():
            print(f'Sem lista do dia em {caminho}: nada enviado.'); registrar({'resultado': 'sem-lista', 'lista': caminho.name}); return 0
    elif len(args) == 1:
        caminho = Path(args[0])
    else:
        print(__doc__); return 2
    entrada = json.loads(caminho.read_text())
    de_verdade = '--enviar' in sys.argv
    lido_ate = instante(entrada['lido_ate'])
    leads = ler_crm()
    auth = conexao()
    primeiro = True
    for item in entrada['mensagens']:
        lid, texto = item['lead_id'], item['texto'].strip()
        lead = leads.get(lid)
        n = numero(lead) if lead else None
        motivo = ('lead fora do CRM' if not lead else 'sem WhatsApp no CRM' if not n else
                  'mensagem com R$' if 'R$' in texto else motivo_para_nao_enviar(lead, lido_ate))
        if not motivo and not no_expediente(): motivo = 'fora do expediente'
        if motivo:
            print(f'PULADO  {lid}  {motivo}'); registrar({'lead_id': lid, 'resultado': 'pulado', 'motivo': motivo}); continue
        if not de_verdade:
            print(f'SIMULA  {lid}  {len(texto)} caracteres'); continue
        if not primeiro: time.sleep(random.randint(*ESPACO))
        primeiro = False
        auth = conexao()
        if motivo_para_nao_enviar(lead, lido_ate) or not no_expediente():
            print(f'PULADO  {lid}  mudou durante a espera'); continue
        try: mid = enviar(n, texto, auth)
        except Exception as e:
            print(f'FALHOU  {lid}  {type(e).__name__}'); registrar({'lead_id': lid, 'resultado': 'incerto', 'erro': type(e).__name__})
            return 1  # resultado ambíguo: parar, não arriscar repetição, e avisar (OnFailure)
        try: anotar(lead, texto); anotado = True
        except Exception as e: anotado = False; print(f'  nota não gravada: {type(e).__name__}')
        print(f'ENVIADO {lid}  anotado={anotado}')
        registrar({'lead_id': lid, 'resultado': 'enviado', 'id': mid, 'anotado': anotado, 'texto': texto})
    return 0

if __name__ == '__main__':
    sys.exit(main())
