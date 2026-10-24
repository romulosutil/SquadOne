import test from 'node:test'
import assert from 'node:assert/strict'
import { chaveDoNumero } from '../server/conversa-do-lead.ts'
import { PREFIXO_RESPONSAVEL, chaveDaConversaBrasil, validarResponsavelConversa, textoResponsavelConversa,
  lerResponsavelConversa, projetarResponsavelConversa, validarSucessaoResponsavel, autoridadeDaConversa,
  type ResponsavelConversa, type LeadComResponsavel, type ContextoAutoridade } from './operations/responsavel-conversa.ts'
const agora=Date.parse('2026-10-23T18:00:00Z')
const base: ResponsavelConversa={v:2,id:'dono-001',conta:'prumo',canal:'whatsapp',conversa:'2799991234',responsavel:'time',data:'2026-10-23T12:00:00Z',motivo:'Revisado pelo operador',humano:true,anterior:null}
const nota=(r: ResponsavelConversa, em=r.data) => ({tipo:'nota',origem:'manual',em,registroTexto:PREFIXO_RESPONSAVEL+JSON.stringify(r)})
const lead=(eventos: LeadComResponsavel['eventos']=[], id='site:teste', whatsapp='https://wa.me/552799991234'): LeadComResponsavel => ({id,links:{whatsapp},eventos})
const permitido: ContextoAutoridade={pausado:false,recusado:false,contextoAtual:true,envioAmbiguo:false,bloqueioOperacional:false}
test('equivalência brasileira é compartilhada com observador, sem transformar DDI estrangeiro',()=>{
  for(const s of ['552799991234','5527999991234','(27) 9999-1234','+55 (27) 99999-1234']) assert.equal(chaveDaConversaBrasil(s),chaveDoNumero(s))
  for(const s of ['https://wa.me/14155551234','+14155551234','https://wa.me/351999991234','https://evil.test/552799991234','https://wa.me/552799991234/extra','abc2799991234','https://u:p@wa.me/552799991234']) assert.equal(chaveDaConversaBrasil(s),null)
})
test('schema humano estrito, sem extras, futuro, versão antiga ou truncamento',()=>{
  assert.deepEqual(lerResponsavelConversa(textoResponsavelConversa(base,agora),agora),base)
  for(const r of [{...base,humano:false},{...base,v:1},{...base,extra:true},{...base,anterior:base.id},{...base,data:'2026-10-24T12:00:00Z'},{...base,data:'2026-02-30T12:00:00Z'},{...base,motivo:'x'.repeat(181)},{...base,conta:'outra'},{...base,conversa:'552799991234'}]) assert.throws(()=>validarResponsavelConversa(r,agora))
})
test('dono é da conversa por conta/canal e não mistura fatos das oportunidades',()=>{
  const a=lead([nota(base)]), b=lead([],'iris:outro','https://wa.me/5527999991234'), c=lead([],'site:terceiro','https://wa.me/551199991234')
  const p=projetarResponsavelConversa(b,[a,b,c],agora)
  assert.equal(p.registro?.id,base.id); assert.equal(p.estado,'definido')
  assert.equal(b.eventos.length,0); assert.equal(projetarResponsavelConversa(c,[a,b,c],agora).estado,'ausente')
})
test('agente não pode se tornar humano pelo marcador e ausência não libera resposta autônoma',()=>{
  const l=lead([{...nota(base),origem:'automático'}])
  assert.equal(projetarResponsavelConversa(l,[l],agora).estado,'ausente')
  assert.equal(autoridadeDaConversa(projetarResponsavelConversa(l,[l],agora),permitido).permitido,false)
})
test('sucessão linear posterior com anterior correto governa todas as ofertas',()=>{
  const r={...base,id:'dono-002',responsavel:'romulo' as const,anterior:base.id,data:'2026-10-23T13:00:00Z'}
  const l=lead([nota(base),nota(r)])
  const p=projetarResponsavelConversa(l,[l],agora)
  assert.equal(p.registro?.responsavel,'romulo'); assert.equal(autoridadeDaConversa(p,permitido).permitido,false)
  assert.equal(validarSucessaoResponsavel({...r,id:'dono-003',anterior:r.id,data:'2026-10-23T14:00:00Z'},p,agora).anterior,r.id)
  assert.throws(()=>validarSucessaoResponsavel({...r,id:'dono-004',anterior:base.id},p,agora))
})
test('repetição exata em duas oportunidades não cria conflito',()=>{
  const {id,...resto}=base
  const a=lead([nota(base)]),b=lead([nota({...resto,id})],'iris:outro')
  assert.equal(projetarResponsavelConversa(a,[a,b],agora).estado,'definido')
})
test('mesmo id alterado, concorrência anterior e empate temporal bloqueiam sem UUID vencedor',()=>{
  const conflitantes=[
    {...base,responsavel:'romulo' as const},
    {...base,id:'zzz-002',anterior:base.id,responsavel:'romulo' as const},
    {...base,id:'dono-002',anterior:null,data:'2026-10-23T13:00:00Z'},
  ]
  for(const r of conflitantes){const l=lead([nota(base),nota(r)]);assert.equal(projetarResponsavelConversa(l,[l],agora).estado,'bloqueado')}
})
test('nota mais recente inválida ou futura não ressuscita autorização anterior',()=>{
  for(const e of [
    {...nota(base),em:'2026-10-23T13:00:00Z',registroTexto:PREFIXO_RESPONSAVEL+'{invalid'},
    nota({...base,id:'dono-002',data:'2026-10-24T12:00:00Z',anterior:base.id}),
    {...nota(base),em:'invalido'},
    nota({...base,id:'dono-002',humano:false as unknown as true,anterior:base.id,data:'2026-10-23T13:00:00Z'}),
  ]){const l=lead([nota(base),e]);assert.equal(projetarResponsavelConversa(l,[l],agora).estado,'bloqueado')}
})
test('conta estrangeira explícita não toma autoridade da conta Prumo',()=>{
  const e={...nota(base),registroTexto:PREFIXO_RESPONSAVEL+JSON.stringify({...base,conta:'outra'})}
  const l=lead([e]);assert.equal(projetarResponsavelConversa(l,[l],agora).estado,'ausente')
})
test('gates independentes de pause, recusa, contexto e ambiguidade sempre vencem time',()=>{
  const l=lead([nota(base)]), p=projetarResponsavelConversa(l,[l],agora)
  assert.equal(autoridadeDaConversa(p,permitido).permitido,true)
  for(const c of [{pausado:true},{recusado:true},{contextoAtual:false},{envioAmbiguo:true},{bloqueioOperacional:true}]) assert.equal(autoridadeDaConversa(p,{...permitido,...c}).permitido,false)
})