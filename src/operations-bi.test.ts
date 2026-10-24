import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analisarOperacao, auditarEscolhas, enviadosBi, linhasBi, planoDoLead } from './operations/bi-operacao.ts'
import { classificarResposta } from './operations/classificacao-resposta.ts'
import { baseDaRevisaoRetomada, notaDaRevisaoRetomada } from './operations/revisao-retomadas.ts'
import type { CrmLead, CrmVisao } from './operations/types.ts'
const agora = Date.parse('2026-10-23T15:00:00Z')
function lead(extra: Partial<CrmLead> = {}): CrmLead {
  return { id:'site:ficticio',produto:'site',chave:'ficticio',empresa:'Empresa fictícia',nicho:'Serviços',cidade:'Vitória',etapa:'contato',sinal:'enviado',subEtapa:'',estadoNaPlanilha:'enviado',leitura:'desconhecida',marcos:{ enviado:'2026-10-19T12:00:00Z' },followupHoje:false,respostaNova:false,acervo:false,notas:0,eventos:[],links:{},divergencias:[], ...extra }
}
test('BI: só considera primeiro envio válido até a captura e a janela escolhida', () => {
  const casos = [lead(),lead({ id:'futuro',marcos:{ enviado:'2026-10-24T12:00:00Z' } }),lead({ id:'invalido',marcos:{ enviado:'sem-data' } }),lead({ id:'antigo',marcos:{ enviado:'2026-09-01T12:00:00Z' } })]
  assert.equal(enviadosBi(casos,'7',agora).length,1)
  assert.equal(enviadosBi(casos,'tudo',agora).length,2)
})
test('BI: classes exclusivas somam o denominador e ausência de classificação é pendência', () => {
  const leads = [lead(),lead({ id:'outro' })]; leads[1].classificacaoResposta = classificarResposta(leads[1],[],agora)
  const bi = analisarOperacao({ leads } as CrmVisao,'30',agora)
  assert.equal(bi.classes.reduce((s,c) => s+c.quantidade,0),2)
  assert.equal(bi.classes.find(c => c.classe === 'pendente')?.quantidade,1)
  assert.equal(bi.interesse,0)
  assert.equal(bi.semArquivo,2)
})
test('BI: taxa exclui envios recentes e não mistura letras de ofertas/regimes diferentes', () => {
  const casos = Array.from({ length:10 },(_,i) => lead({ id:`a${i}`,abordagem:{ mensagem:'A',regime:'duas_mensagens' } }))
  casos.push(lead({ id:'recente',marcos:{ enviado:'2026-10-23T10:00:00Z' },abordagem:{ mensagem:'A',regime:'duas_mensagens' } }))
  casos.push(lead({ id:'iris',produto:'iris',abordagem:{ mensagem:'A' } }))
  const r = linhasBi(casos,'mensagem',agora)
  assert.equal(r.length,2); assert.equal(r[0].maduros,10); assert.equal(r[0].recentes,1); assert.equal(r[0].taxa,0); assert.equal(r[1].taxa,null)
})
test('ação: recusa, exclusão e espera são protegidas, inclusive com classificação contextual', () => {
  const l = lead({ resposta:{ tipo:'negativa',trecho:'Não quero',em:'2026-10-22T12:00:00Z' } })
  assert.equal(planoDoLead(l,agora).tipo,'encerrado')
  l.resposta = { tipo:'neutra',trecho:'Não quero' }; l.classificacaoResposta = { ...classificarResposta(l,[],agora),classe:'recusa' }
  assert.equal(planoDoLead(l,agora).tipo,'encerrado')
  const espera = lead({ proximoPasso:{ texto:'Aguardar resposta, sem novo contato',data:'2026-10-20',registradoEm:'2026-10-19T12:00:00Z' } })
  assert.equal(planoDoLead(espera,agora).tipo,'aguardar')
})
test('ação: revisão antiga perde validade; revisão atual explica ação e condição', () => {
  const l = lead(); const texto = notaDaRevisaoRetomada({ grupo:'retomar',fato:'Pedido de conversa observado',proximo:'Conferir o pedido e propor horário',condicao:'Horário aceito pelo responsável',base:baseDaRevisaoRetomada(l) })
  l.eventos.push({ tipo:'nota',origem:'manual',fonte:'CRM',rotulo:'Revisão',em:'2026-10-22T12:00:00Z',texto })
  const p = planoDoLead(l,agora); assert.equal(p.tipo,'agir'); assert.match(p.condicao!,/Horário aceito/); assert.match(p.resultado,/esclarecidos/)
  l.proximoPasso = { texto:'Conferir nova mensagem',data:'2026-10-23',registradoEm:'2026-10-23T12:00:00Z' }
  assert.equal(planoDoLead(l,agora).tipo,'conferir')
})
test('ação: sem transcrição ou com robô não propõe oferta para envio imediato', () => {
  assert.equal(planoDoLead(lead(),agora).tipo,'conferir')
  const l = lead({ resposta:{ tipo:'bot',trecho:'Atendimento automático' } }); l.classificacaoResposta = classificarResposta(l,[],agora)
  assert.equal(planoDoLead(l,agora).tipo,'conferir')
})
test('auditoria: score alto com lacuna e divergência pedem revisão; não inventa resultado', () => {
  const fila = [{ id:'nao-encontrado',empresa:'Fictícia',produto:'iris',estado:'pronto',nota:80,motivo:'Falta confirmação de equipe',avaliacoes:[{ agente:'Diego',nota:80,motivo:'Prioridade da fonte' },{ agente:'Elisa',nota:50,motivo:'Sem evidência suficiente' },{ agente:'Carla',nota:80,motivo:'Falta confirmar' }] }]
  const r = auditarEscolhas({ estado:'pronto',atualizadoEm:null,fila },[],agora)[0]
  assert.equal(r.alertas.length,3); assert.equal(r.resultado,'Sem correspondência em Vendas')
})
