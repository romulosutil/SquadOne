#!/usr/bin/env python3
"""Conferência finita dos 19 históricos autorizados, pela sessão existente. Não envia mensagens."""
import concurrent.futures,json,os,re,sys,time,urllib.request,urllib.error
from pathlib import Path
from urllib.parse import urlparse

estado=Path.home()/'.local/share/squadone-operations'
arquivo=estado/'estamparia-conferencia-antigas.json'
segredo=(Path.home()/'.config/claude-ops/whatsapp-observador-segredo').read_text().strip()
modo=sys.argv[1] if len(sys.argv)>1 else 'acompanhar'

def salvar(valor):
    tmp=arquivo.with_suffix('.novo')
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as f:json.dump(valor,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
    tmp.replace(arquivo)

def consultar(alvo,somente):
    req=urllib.request.Request('http://127.0.0.1:3000/squadone/historico',data=json.dumps({'chave':alvo['chave'],'numero':alvo['numero'],'somenteConsultar':somente}).encode(),headers={'X-Observador':segredo,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=20) as r:return {'http':r.status,'consulta':json.load(r)}
    except urllib.error.HTTPError as e:return {'http':e.code,'erro':'Consulta recusada pelo leitor de histórico.'}
    except Exception as e:return {'erro':type(e).__name__}

if modo=='iniciar':
    if arquivo.exists():raise SystemExit('Conferência já iniciada; use acompanhar antes de repetir pedidos.')
    with urllib.request.urlopen('http://127.0.0.1:9120/api/operations/crm',timeout=90) as r:v=json.load(r)
    if v['estado']!='ok':raise SystemExit('CRM indisponível.')
    alvos=[]
    for l in v['leads']:
        a=l.get('atendimentoComercial')or{}
        if l['produto']!='estampa' or not a.get('id','').startswith('estampa-') or a.get('estado')!='humano':continue
        numero=urlparse(l.get('links',{}).get('whatsapp','')).path.strip('/')
        if not re.fullmatch(r'55\d{10,11}',numero):raise SystemExit('Telefone sem identidade canônica; preservar conferência.')
        d=numero[2:];alvos.append({'id':l['id'],'empresa':l['empresa'],'chave':d[:2]+d[-8:],'numero':numero})
    if len(alvos)!=19 or len({a['chave'] for a in alvos})!=19:raise SystemExit('A lista de 19 pendências mudou; conferir o escopo antes de continuar.')
    # A autorização de leitura é finita, restrita aos alvos já presentes no CRM.
    escopo=estado/'historico-leads.json'
    if escopo.exists():
        backup=estado/'historico-leads.antes-estampa.json'
        with open(backup,'x',encoding='utf-8') as f:f.write(escopo.read_text())
        backup.chmod(0o600)
    fd=os.open(escopo.with_suffix('.estampa-novo'),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:json.dump({'geradoEm':time.time()*1000,'chaves':[a['chave'] for a in alvos]},f);f.flush();os.fsync(f.fileno())
    escopo.with_suffix('.estampa-novo').replace(escopo)
    plano={'v':1,'iniciadoEm':time.time(),'alvos':alvos};salvar(plano)
elif modo=='acompanhar':
    plano=json.loads(arquivo.read_text());alvos=plano['alvos']
else:raise SystemExit('Use iniciar ou acompanhar.')

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    futuros={pool.submit(consultar,a,modo!='iniciar'):a for a in alvos}
    resultados=[]
    for futuro in concurrent.futures.as_completed(futuros):
        a=futuros[futuro];r=futuro.result();a['ultimaConsulta']=r;resultados.append(a)
        if len(resultados)%5==0:print(json.dumps({'conferidos':len(resultados),'total':len(alvos)}),flush=True)
plano['consultadoEm']=time.time();salvar(plano)
print(json.dumps({'total':len(alvos),'retornos':sum((a.get('ultimaConsulta',{}).get('consulta')or{}).get('recebidas',0)>0 for a in alvos),
    'comProva':sum((a.get('ultimaConsulta',{}).get('consulta')or{}).get('comprovadas',0)>0 for a in alvos),
    'resultados':[{'empresa':a['empresa'],'http':a['ultimaConsulta'].get('http'),'recebidas':(a['ultimaConsulta'].get('consulta')or{}).get('recebidas',0),'comprovadas':(a['ultimaConsulta'].get('consulta')or{}).get('comprovadas',0),'semProva':(a['ultimaConsulta'].get('consulta')or{}).get('semProva',0),'erro':a['ultimaConsulta'].get('erro')} for a in alvos]},ensure_ascii=False),flush=True)
