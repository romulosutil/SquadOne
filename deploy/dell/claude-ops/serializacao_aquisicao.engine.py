"""Gera apenas fixtures para homologar na imagem n8n isolada, sem credenciais.

Uso: python3 serializacao_aquisicao.engine.py PASTA_FIXTURE
O runner.js é executado num container --network none, sem mounts de produção.
"""
import copy
import hashlib
import json
from pathlib import Path
import sys
import serializacao_aquisicao as s

CFG={'v':1,'enabled':True,'url':'http://172.23.0.1:8791','credentialId':'fixture','credentialName':'fixture'}

def node(id,name,type_,params,pos):return {'id':id,'name':name,'type':'n8n-nodes-base.'+type_,'typeVersion':2 if type_=='code' else 4.2 if type_=='httpRequest' else 1,'parameters':params,'position':pos}
def fixture(scenario):
    # Prepara primeiro o mesmo wrapper de produção. Só depois substitui a
    # leitura/escrita por nós fixture locais, sem referencia a credential.
    read=node('read','Leitura fixture','googleSheets',{'operation':'read'},[200,0])
    choose=node('choose','Separar fixture','if',{'conditions':{'options':{'caseSensitive':True,'leftValue':'','typeValidation':'strict','version':2},'combinator':'and','conditions':[{'id':'branch','leftValue':'={{ $json.branch }}','rightValue':'a','operator':{'type':'string','operation':'equals'}}]},'options':{}},[400,0]);choose['typeVersion']=2.2
    def write(branch):return node('write-'+branch,'Persistir fixture '+branch,'httpRequest',{'method':'POST','url':'http://127.0.0.1:8878/event/'+branch,'options':{'timeout':5000}},[620,-100 if branch=='a' else 100])
    w={'name':'01 · Caçador','nodes':[node('trigger','Executar manualmente','manualTrigger',{},[0,0]),read,choose,write('a'),write('b')],
       'connections':{'Executar manualmente':s.destinos('Leitura fixture'),'Leitura fixture':s.destinos('Separar fixture'),'Separar fixture':{'main':[[{'node':'Persistir fixture a','type':'main','index':0}],[{'node':'Persistir fixture b','type':'main','index':0}]]}},'settings':{'executionOrder':'v1','timezone':'America/Sao_Paulo'},'active':False}
    out=s.preparar(w,CFG)
    out['id']=hashlib.sha256(('aquisicao-fixture-'+scenario).encode()).hexdigest()[:16]
    for n in out['nodes']:
        if n['name'] in (s.CLAIM,s.RELEASE):
            n.pop('credentials',None);n['parameters'].pop('authentication',None);n['parameters'].pop('genericAuthType',None);n['parameters']['url']=n['parameters']['url'].replace(CFG['url'],'http://127.0.0.1:8878')
        if n['name']==s.CORE:
            child=json.loads(n['parameters']['workflowJson'])
            r=next(x for x in child['nodes'] if x['name']=='Leitura fixture');r['type']='n8n-nodes-base.code';r['typeVersion']=2;r['parameters']={'jsCode':"return [];" if scenario=='empty' else "return [{json:{branch:'a'}},{json:{branch:'b'}}];"}
            if scenario=='error':
                b=next(x for x in child['nodes'] if x['name']=='Persistir fixture b');b['parameters']['url']='http://127.0.0.1:8878/event/error'
            n['parameters']['workflowJson']=json.dumps(child,ensure_ascii=False)
    return out

RUNNER=r"""
const http=require('http'),fs=require('fs'),{spawn}=require('child_process');
let active=null;const results=[];let scenario='';let events=[];let held=false;let pending=0;let released=0;let premature=false;
const server=http.createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{
 const send=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
 if(req.url==='/claim'){if(held)return send(200,{acquired:false,reason:'busy'});held=true;events.push({event:'claim',at:Date.now()});return send(200,{acquired:true,token:'fixture-token-no-production'});}
 if(req.url==='/release'){released++;if(pending>0)premature=true;held=false;events.push({event:'release',at:Date.now()});return send(200,{released:true});}
 if(req.url.startsWith('/event/')){const branch=req.url.split('/').at(-1);pending++;events.push({event:'start-'+branch,at:Date.now()});return setTimeout(()=>{pending--;events.push({event:'finish-'+branch,at:Date.now()});send(branch==='error'?500:200,branch==='error'?{error:'fixture-failure'}:{ok:true,branch});},branch==='a'?80:350);}
 send(404,{error:'fixture-route'});
});});
function execute(args,folder){return new Promise(resolve=>{const p=spawn('n8n',args,{env:{...process.env,N8N_USER_FOLDER:folder,N8N_DIAGNOSTICS_ENABLED:'false',N8N_VERSION_NOTIFICATIONS_ENABLED:'false',N8N_TEMPLATES_ENABLED:'false',N8N_ENCRYPTION_KEY:'fixture-only-not-a-production-secret',N8N_SKIP_AUTH_ON_OAUTH_CALLBACK:'false',N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS:'true'},stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',x=>output=(output+x).slice(-30000));p.stderr.on('data',x=>output=(output+x).slice(-30000));const timer=setTimeout(()=>p.kill('SIGKILL'),90000);p.on('exit',code=>{clearTimeout(timer);resolve({code,output});});});}
server.listen(8878,'127.0.0.1',async()=>{try{
 for(const name of ['branches','empty','error']){scenario=name;events=[];held=false;pending=0;released=0;premature=false;const folder='/tmp/n8n-'+name;const file='/fixtures/'+name+'.json';const imp=await execute(['import:workflow','--input='+file],folder);const id=JSON.parse(fs.readFileSync(file)).id;const r=imp.code===0?await execute(['execute','--id='+id,'--rawOutput'],folder):imp;const ends=events.filter(x=>x.event.startsWith('finish-'));const releaseEvent=events.find(x=>x.event==='release');const pass=name==='error'?r.code!==0&&released===0&&held: r.code===0&&released===1&&!held&&!premature&&(name==='empty'?ends.length===0:ends.length===2&&releaseEvent.at>=Math.max(...ends.map(x=>x.at)));results.push({scenario:name,pass,exit:r.code,events,released,held,premature,...(!pass?{diagnostic:r.output.slice(-5000)}:{})});}
 console.log('ENGINE_PROOF '+JSON.stringify(results));process.exitCode=results.every(x=>x.pass)?0:1;
 }catch(e){console.log('ENGINE_PROOF_ERROR '+String(e));process.exitCode=1;}finally{server.close();}});
"""
if __name__=='__main__':
    folder=Path(sys.argv[1]);folder.mkdir(parents=True,exist_ok=True)
    for scenario in ('branches','empty','error'):(folder/(scenario+'.json')).write_text(json.dumps(fixture(scenario),ensure_ascii=False),encoding='utf-8')
    (folder/'runner.js').write_text(RUNNER,encoding='utf-8');print('Fixtures geradas: branches, empty, error e runner.js; nenhuma execução realizada.')