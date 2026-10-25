import test from 'node:test'
import assert from 'node:assert/strict'
import {Autentique,API_AUTENTIQUE,ErroAutentique,linkAssinaturaAutentique,conferirSignatarioAutentique} from './autentique.ts'
import type {DocumentoAutentique} from './autentique.ts'
const CLIENTE={razaoSocial:'Empresa fictícia LTDA',cnpj:'11222333000181',representante:'Pessoa do cliente',email:'cliente@example.com'}
const doc=():DocumentoAutentique=>({id:'documento-ficticio-001',name:'Encontrado | referencia-ficticia',created_at:'2026-10-25T14:00:00.000Z',sandbox:false,deleted_at:null,files:{original:'https://storage.googleapis.com/ficticio/original.pdf'},signatures:[{public_id:'assinatura-ficticia-001',name:CLIENTE.representante,email:CLIENTE.email,action:{name:'Sign'},link:{short_link:'https://assina.ae/linkficticio001'}}]})
test('criação usa endpoint fixo, multipart HTML exato e link vinculado, sem assinatura ou notificação extra',async()=>{
 let chamadas=0
 const api=new Autentique('token-ficticio',async(url,init)=>{
  chamadas++;assert.equal(url,API_AUTENTIQUE);assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer token-ficticio')
  const f=init?.body as FormData,op=JSON.parse(String(f.get('operations')))
  assert.equal(op.variables.signers.length,1);assert.equal(op.variables.signers[0].email,CLIENTE.email);assert.equal(op.variables.signers[0].delivery_method,'DELIVERY_METHOD_LINK');assert.equal(op.variables.signers[0].action,'SIGN')
  assert.equal(op.variables.document.refusable,true);assert.equal(op.variables.document.configs.notification_signed,false);assert.match(op.query,/sandbox: false/);assert.equal(op.query.includes('signDocument'),false)
  assert.equal(await (f.get('file') as Blob).text(),'<html>fixture sem documento real</html>')
  assert.deepEqual(JSON.parse(String(f.get('map'))),{file:['variables.file']})
  return Response.json({data:{createDocument:doc()}})
 })
 await api.criar(doc().name,'<html>fixture sem documento real</html>',CLIENTE,'2026-11-09T14:00:00.000Z');assert.equal(chamadas,1)
})
test('falha GraphQL e erro de rede nunca fazem retry de criação nem expõem payload ou token',async()=>{
 for(const fetcher of [async()=>Response.json({errors:[{message:'segredo-privado',extensions:{token:'privado'}}]}),async()=>{throw new Error('segredo-privado')}]){
  let n=0;const api=new Autentique('token-ficticio',async()=>{n++;return fetcher()})
  await assert.rejects(()=>api.criar(doc().name,'fixture',CLIENTE,'2026-11-09T14:00:00.000Z'),e=>e instanceof ErroAutentique&&!e.message.includes('privado'));assert.equal(n,1)
 }
})
test('PDF só vem dos hosts previstos e não recebe o token de API',async()=>{
 let n=0;const api=new Autentique('token-ficticio',async(url,init)=>{n++;assert.match(String(url),/^https:\/\/storage.googleapis.com\//);assert.equal(new Headers(init?.headers).has('Authorization'),false);assert.equal(init?.redirect,'error');return new Response('%PDF-1.4 fixture')})
 assert.match((await api.original(doc())).hash,/^[a-f0-9]{64}$/)
 for(const url of ['http://127.0.0.1/original.pdf','https://outro.example/original.pdf','https://storage.googleapis.com@localhost/original.pdf'])await assert.rejects(()=>api.original({...doc(),files:{original:url}}))
 assert.equal(n,1)
})
test('link exclusivo rejeita domínio parecido, redirecionamento e credenciais na URL',()=>{
 assert.equal(linkAssinaturaAutentique('https://assina.ae/linkficticio001'),'https://assina.ae/linkficticio001')
 for(const url of ['https://assina.ae.evil.example/linkficticio001','https://evil.example/https://assina.ae/linkficticio001','https://assina.ae/linkficticio001?redirect=x','https://assina.ae@localhost/linkficticio001'])assert.throws(()=>linkAssinaturaAutentique(url))
})
test('aceite exige documento e signatário exatos, sem signatário extra ou sandbox',()=>{
 assert.ok(conferirSignatarioAutentique(doc(),CLIENTE,doc().name,Date.parse('2026-10-25T15:00:00.000Z')))
 for(const d of [{...doc(),name:'outra proposta'},{...doc(),sandbox:true},{...doc(),deleted_at:'2026-10-25T14:01:00.000Z'},{...doc(),signatures:[...doc().signatures,...doc().signatures]},{...doc(),signatures:[{...doc().signatures[0],email:'outro@example.com'}]}])assert.throws(()=>conferirSignatarioAutentique(d,CLIENTE,doc().name,Date.parse('2026-10-25T15:00:00.000Z')))
})
test('busca de emissão ambígua pagina e recusa referências duplicadas',async()=>{
 let n=0;const api=new Autentique('token-ficticio',async()=>{n++;return Response.json({data:{documents:{total:2,data:[doc(),{...doc(),id:'documento-ficticio-002'}]}}})})
 await assert.rejects(()=>api.localizar(doc().name));assert.equal(n,1)
})
