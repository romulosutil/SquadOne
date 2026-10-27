import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {CrmLead} from '../operations/types.ts'
import {acompanhamentosEstamparia} from './acompanhamento-estamparia.ts'
const lead=(id:string,estado:string,identidade='confirmada')=>({id,empresa:id,produto:'estampa',atendimentoComercial:{id:'estampa-'+id,alvo:estado==='humano'?'operador':'time',tipo:estado==='humano'?'handoff':'automatico',estado,identidade,texto:estado==='aguardar'?'Aguardar uma pessoa; mensagem automática.':'Aguardar o cliente; Carla confere a nova mensagem.'}} as CrmLead)
test('lista cada conversa uma vez com seu responsável e o próximo passo publicado',()=>{
  const ls=[lead('respondido','aguardando-cliente','sem-prova'),lead('bot','aguardar'),lead('decisao','humano')]
  const r=acompanhamentosEstamparia(ls);assert.equal(r.length,3);assert.equal(r[0].id,'decisao');assert.equal(r[0].responsavel,'Rômulo')
  assert.match(r.find(l=>l.id==='bot')!.responsavel,/aguarda uma pessoa/);assert.match(r.find(l=>l.id==='respondido')!.acao,/confere a nova mensagem/)
  assert.equal(r.find(l=>l.id==='respondido')!.identidade,'sem-prova')
})
test('não inclui outras ofertas nem inventa acompanhamento para lead sem estado do executor',()=>{
  const a=lead('outro','aguardando-cliente');a.produto='site';const b=lead('sem-auto','aguardando-cliente');b.atendimentoComercial=undefined
  assert.deepEqual(acompanhamentosEstamparia([a,b]),[])
})
