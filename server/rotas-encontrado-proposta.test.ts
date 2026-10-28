import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import type {AddressInfo} from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {ConfiguracaoPropostaEncontrado,type ClienteAutentique} from './encontrado-proposta-config.ts'
import {ContratacaoEncontrado} from './encontrado-contratacao.ts'
import {montarRotasPropostaEncontrado,ROTA_CONFIG_PROPOSTA} from './rotas-encontrado-proposta.ts'
import {guardaDeOrigem} from './acesso.ts'
import {CONDICOES_SUGERIDAS_ENCONTRADO} from '../src/operations/encontrado-proposta.ts'
import type {DocumentoAutentique} from './autentique.ts'
async function fixture(t:{after:(f:()=>Promise<unknown>)=>void}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'encontrado-config-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
 let ativacoes=0,chamadas=0
 const jamais=async()=>{throw new Error('Mutação não deve ocorrer nesta fixture')}
 let teste:DocumentoAutentique|null=null
 const api:ClienteAutentique={conta:async()=>{chamadas++;return{id:'conta-ficticia-001',nome:'Pessoa fictícia',email:'fixture@example.com',gratuita:true,organizacao:null}},criar:async(name,_html,cliente,_validade,sandbox)=>{assert.equal(sandbox,true);teste={id:'sandbox-ficticio-001',name,sandbox:true,created_at:new Date().toISOString(),files:{original:'https://storage.googleapis.com/ficticio/original.pdf'},signatures:[{public_id:'assinatura-ficticia-001',name:cliente.representante,email:cliente.email,action:{name:'SIGN'},link:{short_link:'https://assina.ae/linkficticio001'}}]};return teste},documento:async()=>teste!,localizar:async()=>teste,original:async()=>({hash:'a'.repeat(64),bytes:Buffer.from('%PDF-1.4 fixture')})}
 const config=new ConfiguracaoPropostaEncontrado(dir,()=>api),contratacao=new ContratacaoEncontrado(path.join(dir,'propostas'),config),app=express()
 app.use(guardaDeOrigem());app.use(express.json({limit:'12kb'}))
 montarRotasPropostaEncontrado(app,{config,contratacao,operador:req=>req.get('Tailscale-User-Login')==='fixture@example.com'?'fixture@example.com':null,ativar:async()=>{ativacoes++}})
 const s=app.listen(0,'127.0.0.1');await new Promise<void>(r=>s.once('listening',r));t.after(()=>new Promise<void>(r=>s.close(()=>r())))
 const origem=`http://127.0.0.1:${(s.address() as AddressInfo).port}`,url=origem+ROTA_CONFIG_PROPOSTA
 const get=(login=true)=>fetch(url+'/configuracao',{headers:login?{'Tailscale-User-Login':'fixture@example.com'}:{}})
 const post=(rota:string,body:unknown,origin=true)=>fetch(url+rota,{method:'POST',headers:{'Content-Type':'application/json','Tailscale-User-Login':'fixture@example.com',...(origin?{Origin:origem}:{})},body:JSON.stringify(body)})
 return {config,get,post,ativacoes:()=>ativacoes,chamadas:()=>chamadas}
}
const cadastro={prumo:{razaoSocial:'Prestadora fictícia LTDA',cnpj:'12ABC34501DE35',representante:'Pessoa da prestadora',email:'prestadora@example.com'},condicoes:CONDICOES_SUGERIDAS_ENCONTRADO,token:'token-ficticio-sem-rede'}
test('cadastro de assinatura fecha para identidade ausente e escrita sem origem, sem tocar credenciais',async t=>{
 const f=await fixture(t);assert.equal((await f.get(false)).status,403);assert.equal((await f.post('/configuracao',cadastro,false)).status,403);assert.equal(f.chamadas(),0);assert.equal(await f.config.ler(),null)
})
test('GET devolve minuta e pendências sem guardar configuração, chamar provedor ou expor token',async t=>{
 const f=await fixture(t),r=await f.get();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const v=await r.json();assert.equal(v.aprovado,false);assert.match(v.html,/MINUTA PARA APROVAÇÃO/);assert.equal(f.chamadas(),0);assert.equal(await f.config.ler(),null)
 assert.equal((await f.post('/configuracao',cadastro)).status,200);const salvo=await(await f.get()).json();assert.equal(JSON.stringify(salvo).includes(cadastro.token),false)
})
test('aprovação exige confirmação, autorização de dados, conta e hash da versão salva',async t=>{
 const f=await fixture(t);assert.equal((await f.post('/configuracao',cadastro)).status,200);const v=await(await f.get()).json()
 assert.equal((await f.post('/aprovar',{modeloHash:v.modeloHash,confirmar:true,autorizarDadosAutentique:true})).status,409)
 await f.config.homologar()
 for(const body of [{modeloHash:v.modeloHash},{modeloHash:v.modeloHash,confirmar:true,autorizarDadosAutentique:false}])assert.equal((await f.post('/aprovar',body)).status,400)
 assert.equal((await f.post('/aprovar',{modeloHash:'0'.repeat(64),confirmar:true,autorizarDadosAutentique:true})).status,409);assert.equal(f.ativacoes(),0)
 assert.equal((await f.post('/aprovar',{modeloHash:v.modeloHash,confirmar:true,autorizarDadosAutentique:true})).status,200);assert.equal(f.ativacoes(),1)
 assert.equal((await(await f.get()).json()).aprovado,true)
})
test('campos arbitrários, CNPJ inválido e URL de provedor escolhida pelo cliente são recusados',async t=>{
 const f=await fixture(t)
 for(const body of [{...cadastro,apiUrl:'https://outro.example'},{...cadastro,prumo:{...cadastro.prumo,cnpj:'00000000000000'}},{...cadastro,prumo:{...cadastro.prumo,representante:'<script>privado</script>'}}]){
  const r=await f.post('/configuracao',body);assert.equal(r.status,409);assert.equal((await r.text()).includes('privado</script>'),false)
 }
 assert.equal(f.chamadas(),0)
})
