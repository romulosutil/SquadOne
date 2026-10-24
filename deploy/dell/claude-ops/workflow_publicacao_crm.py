"""Transformação pura do 08: candidato fechado + recibo SHA256, sem mudar append/ACK."""
import copy
import json

ID = 'AsjxktRCqRJSmj9P'
NOME = '08 · CRM: retrato e registros (Site antes da venda + PRUMO)'
PREPARAR = 'Preparar publicação CRM'
RECIBO = 'Preparar recibo de publicação CRM'
PRONTO = 'Sinalizar publicação CRM'
RAIZ = '/home/node/.n8n-files/estado/crm-publicacao/'
# Mesmo algoritmo inteiro usado pelo classificador existente; Code não permite require('crypto').
SHA256_JS = """const sha256 = entrada => {
 const primos=[];for(let n=2;primos.length<64;n++)if(primos.every(p=>n%p))primos.push(n);
 const frac=x=>((x-Math.floor(x))*4294967296)>>>0,K=primos.map(p=>frac(Math.cbrt(p))),H=primos.slice(0,8).map(p=>frac(Math.sqrt(p)));
 const b=Array.from(entrada),bits=b.length*8;b.push(128);while(b.length%64!==56)b.push(0);
 const alto=Math.floor(bits/4294967296),baixo=bits>>>0;
 b.push(alto>>>24&255,alto>>>16&255,alto>>>8&255,alto&255,baixo>>>24&255,baixo>>>16&255,baixo>>>8&255,baixo&255);
 const rot=(v,n)=>(v>>>n)|(v<<(32-n)),W=new Array(64);
 for(let i=0;i<b.length;i+=64){
  for(let t=0;t<16;t++)W[t]=(b[i+4*t]<<24|b[i+4*t+1]<<16|b[i+4*t+2]<<8|b[i+4*t+3])>>>0;
  for(let t=16;t<64;t++){const s0=rot(W[t-15],7)^rot(W[t-15],18)^(W[t-15]>>>3),s1=rot(W[t-2],17)^rot(W[t-2],19)^(W[t-2]>>>10);W[t]=(W[t-16]+s0+W[t-7]+s1)>>>0;}
  let[a,bb,c,d,e,f,g,h]=H;
  for(let t=0;t<64;t++){const t1=(h+(rot(e,6)^rot(e,11)^rot(e,25))+((e&f)^(~e&g))+K[t]+W[t])>>>0,t2=((rot(a,2)^rot(a,13)^rot(a,22))+((a&bb)^(a&c)^(bb&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=bb;bb=a;a=(t1+t2)>>>0;}
  [a,bb,c,d,e,f,g,h].forEach((v,k)=>{H[k]=(H[k]+v)>>>0});
 }
 return H.map(x=>x.toString(16).padStart(8,'0')).join('');
};"""
PREPARAR_JS = SHA256_JS + """
const itens=$input.all();
if(itens.length!==1)throw new Error('Publicação CRM exige um retrato.');
const item=itens[0],execucaoId=String($execution.id??''),arquivo=item.json?.arquivo;
if(!/^[1-9][0-9]{0,29}$/.test(execucaoId)||!['crm.json','crm-falha.json'].includes(arquivo)||typeof item.binary?.data?.data!=='string')throw new Error('Candidato CRM inválido.');
const original=Buffer.from(item.binary.data.data,'base64');
if(original.length>32*1024*1024)throw new Error('Retrato CRM excede limite.');
const dados=JSON.parse(original.toString('utf8')),geradoEm=dados.geradoEm??dados.falhouEm;
if(typeof geradoEm!=='string'||!Number.isFinite(Date.parse(geradoEm)))throw new Error('Data original CRM inválida.');
const bytes=Buffer.from(JSON.stringify({v:1,execucaoId,arquivo,geradoEm,dados}),'utf8'),nome='crm-'+execucaoId+'.json';
return [{json:{...item.json,execucaoId,candidatoNome:nome,conteudoHash:sha256(bytes)},binary:{data:{data:bytes.toString('base64'),mimeType:'application/json',fileName:nome}}}];
"""
RECIBO_JS = """
const saidas=$input.all();
if(saidas.length!==1||saidas.some(i=>i.json?.error))throw new Error('Candidato CRM não confirmado.');
const p=$('Preparar publicação CRM').first().json;
if(!/^[1-9][0-9]{0,29}$/.test(p.execucaoId)||p.candidatoNome!=='crm-'+p.execucaoId+'.json'||!/^[a-f0-9]{64}$/.test(p.conteudoHash))throw new Error('Recibo CRM inválido.');
const dados={v:1,execucaoId:p.execucaoId,conteudoHash:p.conteudoHash};
return [{json:{...p},binary:{data:{data:Buffer.from(JSON.stringify(dados),'utf8').toString('base64'),mimeType:'application/json',fileName:p.candidatoNome}}}];
"""
CANDIDATO_PATH = "={{ '"+RAIZ+"candidatos/' + $json.candidatoNome }}"
PRONTO_PATH = "={{ '"+RAIZ+"prontos/' + $json.candidatoNome }}"

def _node(wf,nome):
    encontrados=[n for n in wf.get('nodes',[]) if n.get('name')==nome]
    if len(encontrados)!=1:raise ValueError('Nó CRM ausente ou repetido: '+nome)
    return encontrados[0]

def _edge(nome):
    return {'node':nome,'type':'main','index':0}

def _safe(node):
    if node.get('disabled') or node.get('continueOnFail') or node.get('onError') not in (None,'stopWorkflow'):
        raise ValueError('Publicação CRM não tolera erros ou nós desabilitados.')

def _incoming(wf,destino,esperado):
    entradas=[]
    for origem,tipos in wf.get('connections',{}).items():
        for saidas in tipos.values():
            for destinos in saidas:
                for d in destinos:
                    if d.get('node')==destino:entradas.append(origem)
    if entradas!=[esperado]:raise ValueError('Entrada de publicação CRM inesperada.')

def preparar(workflow):
    if workflow.get('name')!=NOME:return copy.deepcopy(workflow)
    if workflow.get('id') not in (None,ID):raise ValueError('ID de CRM inesperado.')
    wf=copy.deepcopy(workflow)
    montar,gravar=_node(wf,'Montar retrato'),_node(wf,'Gravar retrato')
    for n in (montar,gravar):_safe(n)
    if montar.get('type')!='n8n-nodes-base.code' or gravar.get('type')!='n8n-nodes-base.readWriteFile' or gravar.get('parameters',{}).get('operation')!='write' or gravar['parameters'].get('dataPropertyName')!='data':
        raise ValueError('Contrato do retrato CRM mudou.')
    nomes={n.get('name') for n in wf['nodes']}
    novos={PREPARAR,RECIBO,PRONTO}
    if nomes & novos:
        if not novos<=nomes:raise ValueError('Publicação CRM parcial.')
        for n in (_node(wf,PREPARAR),_node(wf,RECIBO),_node(wf,PRONTO)):_safe(n)
        if any(_node(wf,n).get('type')!='n8n-nodes-base.code' or _node(wf,n)['parameters'].get('mode')!='runOnceForAllItems' for n in (PREPARAR,RECIBO)) or _node(wf,PRONTO).get('type')!='n8n-nodes-base.readWriteFile':raise ValueError('Tipo de publicação alterado.')
        esperado={ 'Montar retrato':PREPARAR,PREPARAR:'Gravar retrato','Gravar retrato':RECIBO,RECIBO:PRONTO}
        for a,b in esperado.items():_incoming(wf,b,a)
        if any(wf['connections'].get(a)!={'main':[[_edge(b)]]} for a,b in esperado.items()) or wf['connections'].get(PRONTO):
            raise ValueError('Grafo de publicação CRM mudou.')
        if gravar['parameters'].get('fileName')!=CANDIDATO_PATH or _node(wf,PRONTO)['parameters']!={'operation':'write','dataPropertyName':'data','fileName':PRONTO_PATH} or _node(wf,PREPARAR)['parameters'].get('jsCode')!=PREPARAR_JS or _node(wf,RECIBO)['parameters'].get('jsCode')!=RECIBO_JS:
            raise ValueError('Publicação CRM adulterada.')
        return wf
    _incoming(wf,'Gravar retrato','Montar retrato')
    if wf['connections'].get('Montar retrato')!={'main':[[_edge('Gravar retrato')]]} or wf['connections'].get('Gravar retrato'):
        raise ValueError('Cadeia original do retrato mudou.')
    if any(n.get('id') in {'crm-publicacao-preparar','crm-publicacao-recibo','crm-publicacao-pronto'} for n in wf['nodes']):
        raise ValueError('ID de publicação ocupado.')
    def code(id_,nome,codigo,x):
        return {'id':id_,'name':nome,'type':'n8n-nodes-base.code','typeVersion':2,'position':[x,0],'parameters':{'mode':'runOnceForAllItems','jsCode':codigo}}
    wf['nodes'] += [code('crm-publicacao-preparar',PREPARAR,PREPARAR_JS,2750),code('crm-publicacao-recibo',RECIBO,RECIBO_JS,3080),
        {'id':'crm-publicacao-pronto','name':PRONTO,'type':'n8n-nodes-base.readWriteFile','typeVersion':1.1,'position':[3300,0],
         'parameters':{'operation':'write','dataPropertyName':'data','fileName':PRONTO_PATH}}]
    gravar['parameters']['fileName']=CANDIDATO_PATH
    for a,b in [('Montar retrato',PREPARAR),(PREPARAR,'Gravar retrato'),('Gravar retrato',RECIBO),(RECIBO,PRONTO)]:
        wf['connections'][a]={'main':[[_edge(b)]]}
    return wf
