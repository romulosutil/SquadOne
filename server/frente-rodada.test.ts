import '../src/testes/politica-historica.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { montarFrenteComercial } from './frente-comercial.ts'
import { criarRodadaComercial } from './rodada-comercial.ts'
import type { MemoriaDaVenda } from './venda-do-dia.ts'
import type { CrmLead } from '../src/operations/types.ts'
test('rota da rodada: revisão explícita preservada e reservas bloqueadas pela aquisição',async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'frente-rodada-'))
  const agora=Date.parse('2026-10-23T15:00:00Z'), mensagem='Olá! Fiz uma prévia para sua empresa. Posso mandar?'
  const leads=Array.from({length:11},(_,i) => ({ id:`site:ficticio-${i}`,produto:'site',etapa:'novo',sinal:'pronto',empresa:`Fictícia ${i}`,marcos:{},eventos:[],mensagemPronta:mensagem,links:{ enviar:'https://ficticio.test/enviar',whatsapp:`https://wa.me/552799990${String(i).padStart(4,'0')}` } }) as CrmLead)
  await fs.writeFile(path.join(dir,'frente-comercial-config.json'),JSON.stringify({ativo:true}))
  await fs.writeFile(path.join(dir,'frente-comercial.json'),JSON.stringify({ estado:'pronto',atualizadoEm:new Date(agora).toISOString(),fila:leads.map(l=>({ id:l.id,estado:'pronto' })) }))
  const app=express(),router=express.Router()
  montarFrenteComercial(router,{ dataDir:dir,agora:()=>agora,visao:async()=>({estado:'ok',leads}),rodada:criarRodadaComercial(path.join(dir,'rodada.json'),()=>agora),memoriaDaVenda:{ reservarPrimeiro:async()=>({ok:true}) } as unknown as MemoriaDaVenda }); app.use(router)
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(r=>server.once('listening',r))
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`
  const post=(rota:string,corpo:unknown,origem=base)=>fetch(base+rota,{method:'POST',headers:{'Content-Type':'application/json',Origin:origem},body:JSON.stringify(corpo)})
  try {
    assert.equal((await post('/crm/frente/rodada/revisar',{ motivo:'Revisão dos contatos',inicioAnterior:null },'https://terceiro.test')).status,403)
    assert.equal((await post('/crm/frente/rodada/revisar',{ motivo:'Revisão dos contatos',inicioAnterior:null })).status,200)
    for (const l of leads) {
      const r=await (await post('/crm/frente/reservar',{leadId:l.id})).json()
      assert.equal(r.reservado,false);assert.equal(r.motivo,'aquisicao-bloqueada')
    }
    const estado=await (await fetch(base+'/crm/frente')).json()
    assert.equal(estado.rodada.pendentes,0);assert.equal(estado.aquisicao.estado,'bloqueada')

  } finally { await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await fs.rm(dir,{recursive:true,force:true}) }
})
