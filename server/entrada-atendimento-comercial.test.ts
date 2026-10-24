import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { EntradaAtendimentoComercialDuravel, validarEventoAtendimento, chaveEventoAtendimento, type EventoAtendimentoComercial } from './entrada-atendimento-comercial.ts'
const h='a'.repeat(64)
const evento: EventoAtendimentoComercial={idOriginal:'msg-ficticia-001',origem:'whatsapp',conta:'prumo',canal:'whatsapp',conversa:'2799991234',tipo:'resposta',direcao:'entrada',ocorridoEm:'2026-10-23T12:00:00Z',recebidoEm:'2026-10-23T12:00:01Z',conteudoHash:h,fonteId:'fonte-ficticia-001'}
const resultado={tipo:'rascunho' as const,id:'draft-001',contextoHash:h,fonteId:'derivado-ficticio-001'}
async function pasta(t: {after: (fn:()=>Promise<unknown>)=>void}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'atendimento-teste-'))
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));return path.join(dir,'inbox.json')
}
const modulo=pathToFileURL(path.resolve('server/entrada-atendimento-comercial.ts')).href
function codigoFilho(arquivo: string, acao: string) {
  return `import {EntradaAtendimentoComercialDuravel} from ${JSON.stringify(modulo)};const s=new EntradaAtendimentoComercialDuravel(${JSON.stringify(arquivo)});const e=${JSON.stringify(evento)};const r=await s.receber(e);${acao}`
}
function filho(code: string): Promise<string> {
  return new Promise((resolve,reject)=>{
    const c=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']})
    let out='',err='';c.stdout.on('data',d=>out+=String(d));c.stderr.on('data',d=>err+=String(d));c.on('error',reject);c.on('exit',n=>n===0?resolve(out):reject(new Error(err)))
  })
}
test('ACK só depois do arquivo persistido e restart preserva dedupe sem texto pessoal',async t=>{
  const a=await pasta(t),s=new EntradaAtendimentoComercialDuravel(a)
  const r=await s.receber(evento)
  const bruto=await fs.readFile(a,'utf8')
  assert.equal(JSON.parse(bruto).registros[0].chave,r.registro.chave);assert.equal(r.novo,true)
  assert.equal(bruto.includes('conteudo"'),false);assert.equal(bruto.includes('texto"'),false)
  assert.equal((await new EntradaAtendimentoComercialDuravel(a).receber({...evento,recebidoEm:'2026-10-23T12:01:00Z'})).novo,false)
  if(process.platform!=='win32')assert.equal((await fs.stat(a)).mode&0o777,0o600)
})
test('falha de persistência não produz ACK nem confirmação positiva',async t=>{
  const a=await pasta(t);await fs.mkdir(a)
  await assert.rejects(()=>new EntradaAtendimentoComercialDuravel(a).receber(evento),/ilegível/)
})
test('mesmo evento com hash, horário ou fonte alterados é conflito, não duplicata silenciosa',async t=>{
  const s=new EntradaAtendimentoComercialDuravel(await pasta(t));await s.receber(evento)
  for(const e of [{...evento,conteudoHash:'b'.repeat(64)},{...evento,fonteId:'outro-id-fonte'},{...evento,ocorridoEm:'2026-10-23T11:59:00Z'}])await assert.rejects(()=>s.receber(e),/conteúdo diferente/)
  assert.equal((await s.listar()).length,1)
})
test('resposta, entrega, leitura e saída têm identidades distintas, conversa também',async t=>{
  const s=new EntradaAtendimentoComercialDuravel(await pasta(t))
  for(const e of [evento,{...evento,tipo:'entrega' as const,direcao:'saida' as const},{...evento,tipo:'leitura' as const,direcao:'saida' as const},{...evento,tipo:'mensagem' as const,direcao:'saida' as const},{...evento,conversa:'1199991234'}])assert.equal((await s.receber(e)).novo,true)
  assert.equal((await s.listar()).length,5)
})
test('schema rejeita texto pessoal, extras, recibo de entrada e identidade não canônica',()=>{
  for(const e of [{...evento,conteudo:'não guardar'},{...evento,conversa:'552799991234'},{...evento,conta:'outra'},{...evento,tipo:'entrega'},{...evento,origem:'telegram'},{...evento,recebidoEm:'2026-10-23T11:00:00Z'},{...evento,conteudoHash:'invalido'},{...evento,fonteId:'../../arquivo'},{...evento,ocorridoEm:'2026-02-30T12:00:00Z'}])assert.throws(()=>validarEventoAtendimento(e))
})
test('conclusão durável é somente referência derivada e não permite segunda execução',async t=>{
  const a=await pasta(t),s=new EntradaAtendimentoComercialDuravel(a),r=await s.receber(evento),res=await s.reservar(r.registro.chave)
  assert.ok(res);assert.equal(await s.reservar(r.registro.chave),null)
  await assert.rejects(()=>s.concluir(r.registro.chave,res.token,{...resultado,humano:true}),/Resultado/)
  await assert.rejects(()=>s.concluir(r.registro.chave,res.token,{...resultado,tipo:'pagamento'}),/Resultado/)
  await assert.rejects(()=>s.concluir(r.registro.chave,'token-errado',resultado),/Reserva/)
  assert.equal((await s.concluir(r.registro.chave,res.token,resultado)).estado,'concluido')
  assert.equal((await s.concluir(r.registro.chave,res.token,resultado)).estado,'concluido')
  await assert.rejects(()=>s.concluir(r.registro.chave,res.token,{...resultado,fonteId:'derivado-distinto'}),/conteúdo diferente/)
  assert.equal(await new EntradaAtendimentoComercialDuravel(a).reservar(r.registro.chave),null)
})
test('serializa agentes por conversa inclusive eventos distintos e libera após conclusão',async t=>{
  const s=new EntradaAtendimentoComercialDuravel(await pasta(t)),a=await s.receber(evento),b=await s.receber({...evento,idOriginal:'msg-ficticia-002'})
  const r=await s.reservar(a.registro.chave);assert.ok(r)
  assert.equal(await s.reservar(b.registro.chave),null)
  await s.concluir(a.registro.chave,r.token,resultado)
  assert.ok(await s.reservar(b.registro.chave))
})
test('ambiguidade bloqueia conversa sem expiração e sem repetição após novo processo lógico',async t=>{
  const a=await pasta(t),s=new EntradaAtendimentoComercialDuravel(a),r=await s.receber(evento),res=await s.reservar(r.registro.chave);assert.ok(res)
  await s.marcarAmbiguo(r.registro.chave,res.token)
  const reiniciado=new EntradaAtendimentoComercialDuravel(a),outro=await reiniciado.receber({...evento,idOriginal:'msg-ficticia-002'})
  assert.equal(await reiniciado.reservar(r.registro.chave),null);assert.equal(await reiniciado.reservar(outro.registro.chave),null)
  await assert.rejects(()=>reiniciado.concluir(r.registro.chave,res.token,resultado),/ambígua/)
})
test('dois processos concorrentes persistem uma única entrada e uma única reserva',async t=>{
  const a=await pasta(t),code=codigoFilho(a,'const q=await s.reservar(r.registro.chave);console.log(JSON.stringify({novo:r.novo,reservou:!!q}));')
  const results=(await Promise.all([filho(code),filho(code)])).map(s=>JSON.parse(s))
  assert.equal(results.filter(r=>r.novo).length,1);assert.equal(results.filter(r=>r.reservou).length,1)
  assert.equal((await new EntradaAtendimentoComercialDuravel(a).listar()).length,1)
})
test('interrupção real após reserva vira ambíguo no restart, pendente seguro pode retomar',async t=>{
  const a=await pasta(t),child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',codigoFilho(a,'await s.reservar(r.registro.chave);')],{cwd:process.cwd(),encoding:'utf8'})
  assert.equal(child.status,0,child.stderr)
  const s=new EntradaAtendimentoComercialDuravel(a),r=await s.recuperarInterrompidos()
  assert.equal(r[0].estado,'ambiguo');assert.equal(await s.reservar(r[0].chave),null)
  const b=await s.receber({...evento,idOriginal:'msg-outra-conversa',conversa:'1199991234'})
  assert.ok(await new EntradaAtendimentoComercialDuravel(a).reservar(b.registro.chave))
})
test('arquivo corrompido e trava viva falham fechados',async t=>{
  const a=await pasta(t);await fs.writeFile(a,'{corrompido')
  await assert.rejects(()=>new EntradaAtendimentoComercialDuravel(a).receber(evento),/ilegível/)
  await fs.unlink(a);await fs.writeFile(a+'.lock',JSON.stringify({pid:process.pid,token:'vivo'}))
  await assert.rejects(()=>new EntradaAtendimentoComercialDuravel(a,{tentativas:1,esperaMs:1}).receber(evento),/ocupada/)
})
test('chave independe do transporte coletor; recebidoEm não muda a identidade',()=>{
  assert.equal(chaveEventoAtendimento(evento),chaveEventoAtendimento({...evento,recebidoEm:'2026-10-23T12:02:00Z'}))
})