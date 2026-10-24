import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filaDeVenda } from './operations/proxima-venda'
import { propostaDeUmToque } from './operations/mandar-proposta'
import { qualificacaoComercialVazia } from './operations/qualificacao-comercial'
import type { CrmLead } from './operations/types'
const agora=Date.parse('2026-10-23T21:00:00Z')
const lead=():CrmLead=>({id:'site:preco-001',chave:'preco-001',produto:'site',empresa:'Empresa fixture',etapa:'contato',sinal:'em-conversa',subEtapa:'Conversa',eventos:[],links:{},marcos:{enviado:'2026-10-22T15:00:00Z',respondeu:'2026-10-23T20:00:00Z'},resposta:{tipo:'interesse',trecho:'Quanto custa?',em:'2026-10-23T20:00:00Z'},classificacaoResposta:{versao:1,classe:'interesse',motivo:'Pergunta explícita de preço',houveRespostaHumana:true,materialSolicitado:false,revisar:false,leituraConfirmada:false},divergencias:[],desde:'2026-10-22T15:00:00Z'} as unknown as CrmLead)
test('pedido contextual de preço vai ao humano sem reunião e sem exigir qualificação já gravada',()=>{
 const l=lead(),fila=filaDeVenda({leads:[l],hoje:[]},{primeiroLiberado:false,agora})
 const acao=fila.find(a=>a.chave.endsWith('negociacao-humana'))!
 assert.ok(acao);assert.match(acao.titulo,/Rômulo/);assert.equal(acao.link,undefined);assert.equal(acao.anota,undefined)
 assert.doesNotMatch(acao.tatica,/10 minutos|impacto/)
})
test('negociação com qualificação nova não recebe preço legado automático do catálogo',()=>{
 const l=lead();l.qualificacaoComercial={...qualificacaoComercialVazia(agora),id:'q-001',fonte:'WhatsApp 23/10',evidencia:'Quero uma proposta.'}
 assert.equal(propostaDeUmToque(l),null)
})

test('preço neutro sem classificação nova também chega ao humano, robô e negativa não',()=>{
 for(const classe of [undefined,'neutra']) {const l=lead();l.classificacaoResposta=classe ? {...l.classificacaoResposta!,classe:'neutra'} : undefined;l.resposta!.tipo='neutra';assert.ok(filaDeVenda({leads:[l],hoje:[]},{primeiroLiberado:false,agora}).some(a=>a.chave.endsWith('negociacao-humana')))}
 for(const tipo of ['bot','negativa'] as const) {const l=lead();l.resposta!.tipo=tipo;assert.equal(filaDeVenda({leads:[l],hoje:[]},{primeiroLiberado:false,agora}).some(a=>a.chave.endsWith('negociacao-humana')),false)}
})
test('qualificação negativa ou inadequada não vira recomendação de preparar proposta',()=>{
 for(const caso of ['sem-interesse','inadequada']) {const l=lead();l.qualificacaoComercial={...qualificacaoComercialVazia(agora),id:'q-002',fonte:'WhatsApp',evidencia:'Agora não.',intencao:caso==='sem-interesse'?'sem-interesse':'avaliar',adequacao:{estado:caso==='inadequada'?'inadequada':'pendente',oferta:'',motivo:'Não atende'}};assert.equal(filaDeVenda({leads:[l],hoje:[]},{primeiroLiberado:false,agora}).some(a=>/Prepare a proposta|conduza a negociação|pedido de preço/.test(a.titulo)),false)}
})

test('revisão humana negativa bloqueia todos os caminhos legados de retomada, não só proposta',()=>{
 for(const caso of ['sem-interesse','inadequada']) {
  const l=lead();l.qualificacaoComercial={...qualificacaoComercialVazia(agora),id:'q-negativa',fonte:'WhatsApp',evidencia:'Não é para mim.',intencao:caso==='sem-interesse'?'sem-interesse':'avaliar',adequacao:{estado:caso==='inadequada'?'inadequada':'pendente',oferta:'',motivo:'Não atende'}}
  l.proposta={em:'2026-10-21T15:00:00Z',data:'2026-10-21'};l.marcos.segundaEnviada='2026-10-21T14:00:00Z'
  const fila=filaDeVenda({leads:[l],hoje:[{id:'resposta',titulo:'',explicacao:'',itens:[{leadId:l.id,acao:'Responder',detalhe:'',ordem:0,links:[]}]}]},{primeiroLiberado:false,agora})
  assert.equal(fila.length,1);assert.match(fila[0].titulo,/sem retomar contato/);assert.equal(fila[0].revisao,true)
  assert.equal(fila[0].link,undefined);assert.equal(fila[0].rascunho,undefined);assert.equal(fila[0].anota,undefined)
 }
})
