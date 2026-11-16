"""Composição pura da operação mínima. Fontes privadas preservam os contratos vivos.

Não publica, ativa, lê credenciais ou executa nodes. IDs e webhooks são preservados.
"""
import copy
import json
import re

MARCA = 'operacao-minima-v1-20261116'
CRM = 'AsjxktRCqRJSmj9P'
ENTRADA = 'fd8gz4uDQkJtEd9W'
PESQUISA = 'pwNiZI1rBGzMJ2dP'
FALHAS = '5FlXnne7lTMihLic'
RESPOSTA = 'IiuekGDVnjFaZpD1'
NUMEROS = 'AGqVS4KoeqGqdey5'
PAGINA = 'Kf5IWNdEFFnuSOy2'
CLIQUE = '9zeyrR1hNZJNFTqx'
DIAGNOSTICO = 'b091d18b-106b-4f4d-ad4e-f77cdeaa7a5f'
BALCAO = 'wjuoIknp2qlWo0QI'
CONVITES = ('GkgYmWZJ65a2e9XF', 'mfyO1YAhBrXxe5Mb', 'rNp1Upq53IFIuRwT')
CORE = {CRM, ENTRADA, PESQUISA, FALHAS}
APOIO = {'qA5R9UXZj4UgIjFi', '9wCjxg7rcPRLONDe'}
CENTRAL = 'https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net:8443/crm'

def no(w, nome):
    xs = [n for n in w['nodes'] if n['name'] == nome]
    if len(xs) != 1: raise ValueError('Contrato de nó divergiu: ' + nome)
    return xs[0]

def edge(nome): return {'node': nome, 'type': 'main', 'index': 0}

def subset(w, nomes):
    nomes = set(nomes)
    result = copy.deepcopy(w)
    result['nodes'] = [n for n in result['nodes'] if n['name'] in nomes]
    result['connections'] = {k: {t: [[d for d in links if d['node'] in nomes] for links in outputs]
        for t, outputs in tipos.items()} for k, tipos in result['connections'].items() if k in nomes}
    return result

def renomear(w, prefixo):
    w = copy.deepcopy(w)
    nomes = {n['name']: prefixo + n['name'] for n in w['nodes']}
    def refs(v, key=None):
        if key == 'workflowJson': return v  # subworkflow tem escopo próprio
        if isinstance(v, dict): return {k: refs(x, k) for k, x in v.items()}
        if isinstance(v, list): return [refs(x) for x in v]
        if not isinstance(v, str): return v
        for old in sorted(nomes, key=len, reverse=True):
            for q in ("'", '"'):
                for head, tail in [('$(', ')'), ('$items(', ','), ('$node[', ']')]:
                    v = v.replace(head + q + old + q + tail, head + q + nomes[old] + q + tail)
        return v
    for n in w['nodes']:
        n['name'] = nomes[n['name']]
        n['id'] = prefixo.replace(' · ', '-') + n['id']
        n['parameters'] = refs(n.get('parameters', {}))
    w['connections'] = {nomes[k]: {t: [[{**d, 'node': nomes[d['node']]} for d in links] for links in outputs]
        for t, outputs in tipos.items()} for k, tipos in w['connections'].items()}
    return w

def anexar(dest, source, prefixo):
    source = renomear(source, prefixo)
    dest['nodes'] += source['nodes']
    dest['connections'].update(source['connections'])

def codigo(id_, nome, js, y=0):
    return {'id': id_, 'name': nome, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
            'position': [1000, y], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': js}}

def empacotar(obj):
    return "const estado=" + json.dumps(obj, ensure_ascii=False) + ";estado.geradoEm=new Date().toISOString();return [{json:estado,binary:{data:{data:Buffer.from(JSON.stringify(estado)).toString('base64'),mimeType:'application/json',fileName:'estado.json'}}}];"

def marcar(w):
    w['nodes'] = [n for n in w['nodes'] if n.get('id') != MARCA]
    w['nodes'].append(codigo(MARCA, 'Operação mínima · contrato', 'return $input.all();', -900))
    w.setdefault('settings', {}).update(saveDataSuccessExecution='none', saveDataErrorExecution='all')
    return w

def compor(fontes, mensagem):
    fontes = copy.deepcopy(fontes)
    entrada = fontes[ENTRADA]
    entrada['name'] = 'WhatsApp — entrada e passagem para Rômulo'
    entrada = renomear(entrada, 'Conversa · ')
    resposta = fontes[RESPOSTA]
    decidir = no(resposta, 'Decidir pela resposta')
    decidir['parameters']['jsCode'] = ('return (await (async()=>{\n' + decidir['parameters']['jsCode'] +
        "\n})()).map(i=>({...i,json:{...i.json,aviso:undefined,...(i.json.planilha && i.json.planilha!=='nenhuma'?{'Próxima ação':'Rômulo assume a resposta; nenhum envio automático.'}:{})}}));")
    recibo = no(resposta, 'Responder ao observador')
    recibo['parameters']['responseBody'] = "={{ {ok:true,marcados:$('Decidir pela resposta').all().filter(i=>i.json.planilha && i.json.planilha!=='nenhuma').map(i=>({planilha:i.json.planilha,nome:i.json.nome,tipo:i.json.tipo}))} }}"
    anexar(entrada, resposta, 'Resposta · ')
    anexar(entrada, fontes[NUMEROS], 'Números · ')

    crm = fontes[CRM]
    # A página/ações antigas permanecem por demanda humana, sem sua própria agenda.
    pagina = fontes[PAGINA]
    remover = {n['name'] for n in pagina['nodes'] if n['type'].endswith('scheduleTrigger') or
        n['name'] in ['Links que faltam', 'Gravar acoes_link', 'Retrato: ler a planilha'] or
        n['name'].startswith('Prumo · organização · A cada hora')}
    pagina = subset(pagina, {n['name'] for n in pagina['nodes']} - remover)
    retrato = no(pagina, 'Retrato')
    old = 'const linhas = $input.all().map(i => i.json)'
    if old not in retrato['parameters']['jsCode']: raise ValueError('Contrato do retrato mudou')
    retrato['parameters']['jsCode'] = retrato['parameters']['jsCode'].replace(old, "const linhas = $('Ler Leads').all().map(i => i.json)")
    # O CRM entrega milhares de linhas; ler os mesmos recibos uma vez, não por linha.
    no(pagina, 'Retrato: recibos da pasta auto')['executeOnce'] = True
    # Referência ao nó do CRM não é local à página e não é renomeada.
    pagina['connections']['Retrato: JSON dos recibos'] = {'main': [[edge('Retrato')]]}
    anexar(crm, pagina, 'Site · ')
    crm['connections']['Ler Leads']['main'][0].append(edge('Site · Retrato: recibos da pasta auto'))

    # Compatibilidade dos links de primeiro contato. Sem escrita de clique ou envio.
    clique = subset(fontes[CLIQUE], {'Clique (enviar)', 'Ler a linha', 'Decidir', 'Abrir o canal'})
    decidir = no(clique, 'Decidir')
    decidir['parameters']['jsCode'] = """const q=$('Clique (enviar)').first().json.query??{};
const l=$input.first()?.json??{};const pid=String(q.place_id??'');
const anterior=String(l.wa_me||'');let destino=""" + json.dumps(CENTRAL) + ";\n" + """if(pid && l.place_id===pid){try{const u=new URL(anterior);if(u.protocol==='https:' && u.hostname==='wa.me' && /^55\\d{10,11}$/.test(u.pathname.slice(1))){
const novo=['novo','pronto',''].includes(String(l.status??'')) && !['enviado_em','respondeu_em','resposta_em','ultima_entrada_em','ultima_saida_em','recusado_em','fechado_em'].some(k=>String(l[k]??'').trim());
if(novo && Date.parse(String(l.criado_em??''))>=Date.parse(""" + json.dumps(mensagem['desde']) + "))u.searchParams.set('text'," + json.dumps(mensagem['texto'], ensure_ascii=False) + ");\n" + """destino=u.toString();}}catch{}}return [{json:{destino}}];"""
    clique['connections']['Decidir'] = {'main': [[edge('Abrir o canal')]]}
    anexar(crm, clique, 'Abrir · ')

    # Convites aposentados levam à Central, sem formar novas campanhas ou textos.
    for index, wid in enumerate(CONVITES):
        gatilho = next(copy.deepcopy(n) for n in fontes[wid]['nodes'] if n['type'].endswith('webhook'))
        gatilho.update(id='convite-compat-'+str(index), name='Convite antigo '+str(index))
        nome = 'Abrir Central '+str(index)
        responder = {'id': 'convite-resposta-'+str(index), 'name': nome,
            'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.1, 'position': [500,index*200],
            'parameters': {'respondWith': 'redirect', 'redirectURL': CENTRAL, 'options': {'responseCode': 303}}}
        crm['nodes'] += [gatilho, responder]
        crm['connections'][gatilho['name']] = {'main': [[edge(nome)]]}
    # Pendências antigas eram derivadas. O CRM guarda os registros reais; não sugerir convite/diagnóstico.
    for wid, writername, nome in [(DIAGNOSTICO,'Gravar pendências do PRUMO','Pendências legadas Prumo'),
                                 (BALCAO,'Gravar pendências','Pendências legadas Site')]:
        writer = copy.deepcopy(no(fontes[wid], writername))
        writer.update(id=MARCA+'-'+wid, name=nome+' · salvar')
        code = codigo(MARCA+'-estado-'+wid, nome, empacotar({'itens':[], 'operacao':MARCA}))
        crm['nodes'] += [code, writer]
        crm['connections']['Ler Leads']['main'][0].append(edge(nome))
        crm['connections'][nome] = {'main': [[edge(writer['name'])]]}

    pesquisa = fontes[PESQUISA]
    pesquisa['name'] = 'PRUMO · Pesquisa de empresas'
    no(pesquisa, 'Conferir semana autorizada')['parameters']['jsCode'] = 'return [{json:{limite:5}}];'
    pesquisa.setdefault('settings', {})['errorWorkflow'] = FALHAS
    falhas = fontes[FALHAS]
    no(falhas,'Falha: montar aviso')['parameters']['jsCode'] = """return $input.all().map(item=>{
const id=String(item.json.workflow?.id??'desconhecido').replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);
const aviso={titulo:'Falha no n8n',texto:'Fluxo '+id+' falhou. Consulte a execução no painel privado.',origem:('n8n:'+$workflow.name).slice(0,80)};
return {json:{},binary:{data:{data:Buffer.from(JSON.stringify(aviso)).toString('base64'),mimeType:'application/json',fileName:'aviso.json'}}};
});"""
    result = {CRM: marcar(crm), ENTRADA: marcar(entrada), PESQUISA: marcar(pesquisa), FALHAS: marcar(falhas)}
    for w in result.values(): validar(w)
    return result

def validar(w):
    nomes = [n['name'] for n in w['nodes']]
    ids = [n['id'] for n in w['nodes']]
    if len(set(nomes)) != len(nomes) or len(set(ids)) != len(ids): raise ValueError('Nós ambíguos')
    for origem, tipos in w['connections'].items():
        if origem not in nomes: raise ValueError('Origem ausente: '+origem)
        for outputs in tipos.values():
            for links in outputs:
                if any(d['node'] not in nomes for d in links): raise ValueError('Destino ausente')
    for n in w['nodes']:
        if n.get('disabled'): continue
        p=n.get('parameters',{});t=n.get('type','').lower()
        if any(x in t for x in ('googlegemini','lmchat','openai','anthropic')): raise ValueError('Inferência não pertence à entrada mínima')
        if n['type'].endswith('httpRequest') and re.search('/message/|/inferir|/fonte',str(p.get('url',''))): raise ValueError('Emissor/modelo dentro do n8n mínimo')
        if isinstance(p.get('workflowJson'),str): validar(json.loads(p['workflowJson']))
        if n['type'].endswith('executeWorkflow') and p.get('options',{}).get('waitForSubWorkflow') is False:
            raise ValueError('Persistência não aguardada')
    return True

def conferir_mutacao(method, path, body, config):
    """Guard do publicador: regeneração antiga não desfaz a migração."""
    if config.get('versao') != 1 or config.get('estado') != 'preparado-pausado': raise ValueError('Política mínima inválida')
    parts=path.strip('/').split('/')
    if not parts or parts[0]!='workflows': return
    if len(parts)>=2 and parts[1] in config['retirados'] and method in ('PUT','PATCH','DELETE'):
        raise ValueError('Workflow aposentado: usar o publicador da operação mínima')
    if method in ('PUT','POST') and isinstance(body,dict) and 'nodes' in body:
        if any(n.get('id')==MARCA for n in body['nodes']): validar(body)
        elif (len(parts)==2 and parts[1] in CORE) or body.get('name') in config['nomesReservados']:
            raise ValueError('Gerador legado não substitui o núcleo mínimo')
