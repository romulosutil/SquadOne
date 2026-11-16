import assert from 'node:assert/strict'
import { it } from 'node:test'
import { cicloDoLead, textoEventoCiclo, validarEventoCiclo, validarTransicaoCiclo, type EventoCiclo } from '../src/operations/ciclo-comercial'
import { aarrDoLead } from '../src/operations/aarr'
import { responsavelDaConversa, textoResponsavelConversa } from '../src/operations/responsavel-conversa'
import { validarConversaDoResponsavel } from './ciclo-comercial'
import type { CrmLead } from '../src/operations/types'
const agora = Date.parse('2026-10-24T00:30:00Z')
const proposta: EventoCiclo = {v:1,id:'proposta-01',tipo:'proposta',data:'2026-10-23',humano:true,referencia:'P-01',ofertaId:'encontrado',oferta:'Encontrado',versao:1,escopo:'Site institucional',prazo:'Após conteúdo aprovado; combinar data',condicoes:'Pagamento após ver funcionando; suporte conforme documento',valor:69000,mensalidade:3900,responsavel:'Rômulo'}
function lead(): CrmLead { return {id:'site:ABC',chave:'ABC',produto:'site',links:{whatsapp:'https://wa.me/5511999999999'},eventos:[]} as CrmLead }
function adicionar(l: CrmLead, e: EventoCiclo) { validarTransicaoCiclo(l,e,agora); l.eventos.push({tipo:'nota',em:'2026-10-24T00:00:00Z',origem:'manual',fonte:'aba CRM',rotulo:'Nota',texto:textoEventoCiclo(e,agora)}) }
function fato(tipo: EventoCiclo['tipo'], id: string, vinculo: string, extra: Partial<EventoCiclo> = {}): EventoCiclo { return {v:1,id,tipo,vinculo,...(['cobranca','pagamento'].includes(tipo)?{componente:'inicial' as const}:{}),data:'2026-10-23',referencia:id,humano:true,evidencia:`evidencia-${id}`,...extra} }
function contratado() { const l=lead();adicionar(l,proposta);adicionar(l,fato('proposta_enviada','envio-01',proposta.id));adicionar(l,fato('aceite','aceite-01',proposta.id,{documento:'Documento P-01 v1 aceito'}));return l }
function cobrado() { const l=contratado();adicionar(l,fato('entrega_vista','vista-01',proposta.id));adicionar(l,fato('condicao_cobranca','cond-01','aceite-01',{componente:'inicial',valor:69000,gatilho:'site_visto_no_ar',condicao:'Após cliente ver no ar',vigenciaInicio:'2026-10-23'}));adicionar(l,fato('cobranca','cob-01','cond-01',{componente:'inicial',valor:69000,vencimento:'2026-10-25',forma:'Forma informada por Rômulo'}));return l }
it('separa proposta preparada, enviada, aceite e cobrança; Encontrado exige cliente ver funcionando',()=>{
  const l=lead();adicionar(l,proposta)
  assert.equal(cicloDoLead(l,agora).aceites.length,0)
  assert.throws(()=>adicionar(l,fato('aceite','aceite-01',proposta.id,{documento:'P-01 v1'})),/conteúdo enviado/)
  adicionar(l,fato('proposta_enviada','envio-01',proposta.id));adicionar(l,fato('aceite','aceite-01',proposta.id,{documento:'P-01 v1'}))
  adicionar(l,fato('condicao_cobranca','cond-01','aceite-01',{componente:'inicial',valor:69000,gatilho:'site_visto_no_ar',condicao:'Após ver no ar',vigenciaInicio:'2026-10-23'}))
  assert.throws(()=>adicionar(l,fato('cobranca','cob-01','cond-01',{valor:69000,vencimento:'2026-10-25',forma:'Manual'})),/viu o site funcionando/)
  assert.equal(cicloDoLead(l,agora).recebido,0)
})
it('pagamento parcial, integral e primeiro recebimento exigem confirmação e saldo consistente',()=>{
  const l=cobrado();adicionar(l,fato('pagamento','pag-01','cob-01',{valor:20000,referencia:'REC-01'}))
  assert.equal(cicloDoLead(l,agora).cobrancas[0]!.situacao,'parcial');assert.equal(cicloDoLead(l,agora).cobrancas[0]!.saldo,49000)
  assert.throws(()=>adicionar(l,fato('pagamento','pag-dup','cob-01',{valor:20000,referencia:' rec-01 '})),/já registrada/)
  assert.throws(()=>adicionar(l,fato('pagamento','pag-alto','cob-01',{valor:50000})),/excede o saldo/)
  adicionar(l,fato('pagamento','pag-02','cob-01',{valor:49000}))
  assert.equal(cicloDoLead(l,agora).cobrancas[0]!.situacao,'integral');assert.equal(cicloDoLead(l,agora).primeiroRecebimento,'2026-10-23')
  assert.equal(aarrDoLead(l,agora).pagamentos.reduce((n,p)=>n+p.valor_centavos,0),69000)
})
it('replay é idempotente e colisão de evento não altera fato anterior',()=>{
  const l=cobrado(),p=fato('pagamento','pag-01','cob-01',{valor:10000});adicionar(l,p);adicionar(l,p)
  assert.equal(cicloDoLead(l,agora).recebido,10000)
  assert.throws(()=>adicionar(l,{...p,valor:20000}),/já usado/)
})
it('correção conserva evento original e exige corrigir dependências primeiro',()=>{
  const l=cobrado();adicionar(l,fato('pagamento','pag-01','cob-01',{valor:10000}))
  assert.throws(()=>adicionar(l,fato('correcao','corr-cob','cob-01')),/dependentes/)
  adicionar(l,fato('correcao','corr-pag','pag-01'))
  assert.equal(l.eventos.length,8);assert.equal(cicloDoLead(l,agora).recebido,0)
  assert.equal(aarrDoLead(l,agora).pagamentos.length,0)
})
it('datas inválidas/futuras, proposta antecipada, nota longa e pagamento automático são rejeitados',()=>{
  for (const extra of [{data:'2026-02-30'},{data:'2026-10-24'},{humano:false},{valor:-1}]) assert.throws(()=>validarEventoCiclo({...proposta,...extra},agora))
  assert.throws(()=>textoEventoCiclo({...proposta,escopo:'a'.repeat(181)},agora))
  const l=lead();adicionar(l,proposta);assert.throws(()=>adicionar(l,{...proposta,id:'prop-nova'}),/nova versão/)
})
it('assumir conversa atravessa ofertas e liberação exige outro evento humano',()=>{
  const l=lead(),outro={...lead(),id:'prumo:XYZ'}
  const r={v:2 as const,id:'owner-01',conta:'prumo' as const,canal:'whatsapp' as const,anterior:null,conversa:'1199999999',responsavel:'romulo' as const,data:'2026-10-24T00:00:00Z',motivo:'Negociação humana',humano:true as const}
  l.eventos.push({tipo:'nota',em:r.data,origem:'manual',fonte:'CRM',rotulo:'Nota',texto:textoResponsavelConversa(r)})
  assert.equal(responsavelDaConversa(outro,[l,outro],agora)?.responsavel,'romulo')
  assert.throws(()=>validarConversaDoResponsavel({...l,links:{whatsapp:'https://wa.me/5511888888888'}},textoResponsavelConversa(r),new Date(agora)),/não corresponde/)
  outro.eventos.push({tipo:'nota',em:'2026-10-24T00:20:00Z',origem:'manual',fonte:'CRM',rotulo:'Nota',texto:textoResponsavelConversa({...r,id:'owner-02',anterior:'owner-01',responsavel:'time',data:'2026-10-24T00:20:00Z',motivo:'Liberado explicitamente'})})
  assert.equal(responsavelDaConversa(l,[l,outro],agora)?.responsavel,'time')
})
