import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { criarRodadaComercial } from './rodada-comercial.ts'
import type { CrmLead } from '../src/operations/types.ts'
function lead(i: number): CrmLead { return { id:`iris:ficticio-${i}`,links:{ whatsapp:`https://wa.me/552799990${String(i).padStart(4,'0')}` },marcos:{},eventos:[] } as CrmLead }
async function montar() { const dir = await fs.mkdtemp(path.join(os.tmpdir(),'rodada-bi-')); const arquivo = path.join(dir,'rodada.json'); const relogio = { agora:Date.parse('2026-10-23T15:00:00Z') }; const r = criarRodadaComercial(arquivo,() => relogio.agora,true); return { dir,arquivo,relogio,r,fechar:() => fs.rm(dir,{ recursive:true,force:true }) } }
test('rodada: fecha sem configuração e só inicia com revisão explícita',async () => {
  const m = await montar(); try { assert.equal((await m.r.status([])).bloqueado,true); assert.equal((await m.r.reservar(lead(1),[],async () => ({ ok:true }))).ok,false); await assert.rejects(m.r.revisar('',null,[])); const s = await m.r.revisar('Público e mensagem conferidos',null,[]); assert.equal(s.bloqueado,false); await assert.rejects(m.r.revisar('Não pode repetir a mesma revisão',null,[])); } finally { await m.fechar() }
})
test('rodada: concorrência reserva dez no máximo; persiste após reinício e virada do dia',async () => {
  const m = await montar(); try { await m.r.revisar('Nova rodada autorizada',null,[]); const resultados = await Promise.all(Array.from({ length:15 },(_,i) => m.r.reservar(lead(i),[],async () => ({ ok:true })))); assert.equal(resultados.filter(r => r.ok).length,10); m.relogio.agora += 3*86400_000; const novo = criarRodadaComercial(m.arquivo,() => m.relogio.agora,true); assert.equal((await novo.status([])).pendentes,10); assert.equal((await novo.status([])).bloqueado,true); } finally { await m.fechar() }
})
test('rodada: robô, leitura e perda por prazo não liberam; humano posterior libera uma vaga',async () => {
  const m = await montar(); try { await m.r.revisar('Nova rodada autorizada',null,[]); const l = lead(1); await m.r.reservar(l,[],async () => ({ ok:true })); l.etapa='perdido'; l.marcos.visto=new Date(m.relogio.agora+500).toISOString(); l.resposta={ tipo:'bot',trecho:'Saudação automática',em:new Date(m.relogio.agora+500).toISOString() }; m.relogio.agora+=1000; assert.equal((await m.r.status([l])).pendentes,1); l.resposta={ tipo:'neutra',trecho:'Sou a responsável',em:new Date(m.relogio.agora).toISOString() }; assert.equal((await m.r.status([l])).pendentes,0); } finally { await m.fechar() }
})

test('rodada: saudação e formulário automáticos não liberam vaga pela ultimaEntrada',async () => {
  const m=await montar();try {
    await m.r.revisar('Nova rodada autorizada',null,[])
    const a=lead(1),b=lead(2)
    for(const l of [a,b])await m.r.reservar(l,[],async()=>({ok:true}))
    m.relogio.agora+=1000
    const em=new Date(m.relogio.agora).toISOString()
    for(const [l,trecho] of [[a,'Seja bem-vindo! Por qual canal você nos conheceu?'],[b,'Qual produto deseja? Qual quantidade? Qual data de entrega?']] as const){
      l.resposta={tipo:'bot',trecho,em}
      l.conversa={ultimaEntrada:em,entradas:{gente:1,recepcao:0,robo:0}} as CrmLead['conversa']
      l.classificacaoResposta={classe:'robo',houveRespostaHumana:false,evidencia:{trecho,em}} as CrmLead['classificacaoResposta']
    }
    assert.equal((await m.r.status([a,b])).pendentes,2)
  }finally{await m.fechar()}
})

test('rodada: entrada sem classificação não prova resposta humana',async () => {
  const m=await montar();try {
    await m.r.revisar('Nova rodada autorizada',null,[]);const l=lead(1)
    await m.r.reservar(l,[],async()=>({ok:true}));m.relogio.agora+=1000
    l.conversa={ultimaEntrada:new Date(m.relogio.agora).toISOString()} as CrmLead['conversa']
    assert.equal((await m.r.status([l])).pendentes,1)
  }finally{await m.fechar()}
})

test('rodada: classificação humana datada libera; classificação negativa de humanidade prevalece',async () => {
  const m=await montar();try {
    await m.r.revisar('Nova rodada autorizada',null,[]);const l=lead(1)
    await m.r.reservar(l,[],async()=>({ok:true}));m.relogio.agora+=1000
    const em=new Date(m.relogio.agora).toISOString()
    l.classificacaoResposta={classe:'acesso',houveRespostaHumana:true,evidencia:{trecho:'Sou a responsável',em}} as CrmLead['classificacaoResposta']
    assert.equal((await m.r.status([l])).pendentes,0)
    l.resposta={tipo:'neutra',trecho:'Seja bem-vindo',em}
    l.classificacaoResposta={classe:'robo',houveRespostaHumana:false,evidencia:{trecho:'Seja bem-vindo',em}} as CrmLead['classificacaoResposta']
    assert.equal((await m.r.status([l])).pendentes,1)
  }finally{await m.fechar()}
})

test('rodada: robô posterior não empresta sua data a resposta humana anterior à reserva',async () => {
  const m=await montar();try {
    await m.r.revisar('Nova rodada autorizada',null,[]);const l=lead(1)
    await m.r.reservar(l,[],async()=>({ok:true}));const anterior=new Date(m.relogio.agora-1000).toISOString();m.relogio.agora+=1000
    const em=new Date(m.relogio.agora).toISOString()
    l.resposta={tipo:'bot',trecho:'Recebemos sua mensagem',em}
    l.respostaFonte={tipo:'neutra',trecho:'Sou a responsável',em:anterior}
    l.classificacaoResposta={classe:'robo',houveRespostaHumana:true,evidencia:{trecho:'Recebemos sua mensagem',em}} as CrmLead['classificacaoResposta']
    assert.equal((await m.r.status([l])).pendentes,1)
  }finally{await m.fechar()}
})
test('rodada: mesmo destino em outra oferta não duplica reserva; erro ambíguo retém vaga',async () => {
  const m = await montar(); try { await m.r.revisar('Nova rodada autorizada',null,[]); const l=lead(1); await assert.rejects(m.r.reservar(l,[],async () => { throw new Error('Persistência diária falhou') })); assert.equal((await m.r.status([])).pendentes,1); const outro={ ...l,id:'estampa:outro' }; const r=await m.r.reservar(outro,[],async () => ({ ok:true })); assert.equal(r.ok,false); assert.equal((await m.r.status([])).pendentes,1); } finally { await m.fechar() }
})
test('rodada: recusa normal da reserva diária libera só a reserva não executada',async () => {
  const m = await montar(); try { await m.r.revisar('Nova rodada autorizada',null,[]); await m.r.reservar(lead(1),[],async () => ({ ok:false,motivo:'intervalo' })); assert.equal((await m.r.status([])).pendentes,0); } finally { await m.fechar() }
})
test('rodada: inclui envios manuais observados desde o início, não o silêncio antigo',async () => {
  const m = await montar(); try { const inicio=m.relogio.agora; await m.r.revisar('Nova rodada autorizada',null,[]); const l=lead(1),antigo=lead(2); l.marcos.enviado=new Date(inicio+100).toISOString(); antigo.marcos.enviado=new Date(inicio-100).toISOString(); m.relogio.agora+=1000; assert.equal((await m.r.status([l,antigo])).pendentes,1); } finally { await m.fechar() }
})
test('rodada: estado corrompido fecha e revisão conserva auditoria das pendências',async () => {
  const m = await montar(); try { const s=await m.r.revisar('Primeira revisão',null,[]); await m.r.reservar(lead(1),[],async () => ({ ok:true })); m.relogio.agora+=1000; const nova=await m.r.revisar('Conferidos os contatos sem resposta',s.inicio,[]); assert.equal(nova.pendentes,0); assert.equal(nova.revisoes.at(-1)?.pendentes,1); await fs.writeFile(m.arquivo,'corrompido'); await assert.rejects(m.r.status([])); } finally { await m.fechar() }
})
test('rodada: número com e sem nono dígito ocupa uma única vaga entre ofertas',async () => {
  const m = await montar();try { await m.r.revisar('Nova rodada autorizada',null,[]); const l=lead(1); l.links.whatsapp='https://wa.me/5527999987766'; await m.r.reservar(l,[],async()=>({ok:true})); const outro={ ...lead(2),links:{whatsapp:'https://wa.me/552799987766'} }; assert.equal((await m.r.reservar(outro,[],async()=>({ok:true}))).ok,false); assert.equal((await m.r.status([l,outro])).pendentes,1) }finally{await m.fechar()}
})
test('rodada: resposta anterior à reserva ou datada no futuro não libera vaga',async () => {
  const m=await montar();try {await m.r.revisar('Nova rodada autorizada',null,[]);const l=lead(1);await m.r.reservar(l,[],async()=>({ok:true}));l.resposta={tipo:'neutra',trecho:'Sou a responsável',em:new Date(m.relogio.agora-1000).toISOString()};assert.equal((await m.r.status([l])).pendentes,1);l.resposta.em=new Date(m.relogio.agora+1000).toISOString();assert.equal((await m.r.status([l])).pendentes,1)}finally{await m.fechar()}
})
