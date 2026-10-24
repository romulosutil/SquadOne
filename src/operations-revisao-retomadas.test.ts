import assert from 'node:assert/strict'
import { describe,it } from 'node:test'
import type { CrmLead } from './operations/types'
import { baseDaRevisaoRetomada, notaDaRevisaoRetomada, revisaoRetomadaDoLead } from './operations/revisao-retomadas'
const agora=Date.parse('2026-10-22T23:00:00Z')
const lead=() => ({id:'iris:teste',produto:'iris',empresa:'Teste',etapa:'contato',estadoNaPlanilha:'Em conversa',marcos:{enviado:'2026-10-22T11:00:00Z'},eventos:[],links:{},notas:0} as unknown as CrmLead)
function revisar(l:CrmLead) {
  const texto=notaDaRevisaoRetomada({grupo:'aguardar',fato:'Pediu avaliação interna.',proximo:'Aguardar.',condicao:'Só com resposta.',rascunho:'Como posso ajudar?',base:baseDaRevisaoRetomada(l)})
  l.eventos.push({tipo:'nota',origem:'manual',fonte:'teste',rotulo:'Nota',em:'2026-10-22T22:00:00Z',texto})
}
describe('revisão analítica de retomadas',()=>{
  it('notas próprias não alteram a validade e a leitura não muda o lead',()=>{
    const l=lead();revisar(l);const antes=JSON.stringify(l)
    assert.equal(revisaoRetomadaDoLead(l,agora)?.atual,true)
    assert.equal(JSON.stringify(l),antes)
  })
  for (const [nome,mudar] of [
    ['nova entrada',(l:CrmLead)=>{l.conversa={mensagens:1,ultimaEntrada:'2026-10-22T22:01:00Z'} as CrmLead['conversa']}],
    ['envio confirmado',(l:CrmLead)=>{l.eventos.push({tipo:'cadencia_enviada',origem:'manual',fonte:'teste',rotulo:'Envio',em:'2026-10-22T22:01:00Z'})}],
    ['mudança de desfecho',(l:CrmLead)=>{l.etapa='perdido'}],
    ['outro plano',(l:CrmLead)=>{l.proximoPasso={texto:'Aguardar',data:'2026-10-26',registradoEm:'2026-10-22T22:01:00Z'}}],
    ['correção de resposta',(l:CrmLead)=>{l.resposta={tipo:'negativa',trecho:'Não quero',em:'2026-10-22T12:00:00Z'}}],
  ] as const) it(`${nome} torna o rascunho desatualizado`,()=>{
    const l=lead();revisar(l);mudar(l);assert.equal(revisaoRetomadaDoLead(l,agora)?.atual,false)
  })
  it('nota inválida, futura ou automática não se passa por revisão atual',()=>{
    const l=lead();revisar(l)
    l.eventos.push({tipo:'nota',origem:'manual',fonte:'teste',rotulo:'Nota',em:'2026-10-22T22:01:00Z',texto:'[revisao-retomada-v1] {"grupo":"__proto__"}'})
    assert.equal(revisaoRetomadaDoLead(l,agora)?.grupo,'aguardar')
    l.eventos=l.eventos.slice(0,1);l.eventos[0]!.origem='automático';assert.equal(revisaoRetomadaDoLead(l,agora),null)
    l.eventos[0]!.origem='manual';l.eventos[0]!.em='2027-01-01T12:00:00Z';assert.equal(revisaoRetomadaDoLead(l,agora),null)
  })
  it('respeita limite do registro existente',()=>{
    assert.throws(()=>notaDaRevisaoRetomada({grupo:'retomar',fato:'x'.repeat(1000),proximo:'Conferir',condicao:'Conferir',base:'base'}),/1000/)
  })
})
