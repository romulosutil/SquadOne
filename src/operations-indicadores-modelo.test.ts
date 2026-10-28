import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calcularIndicadoresOperacionais } from './operations/modelo-operacional/indicadores.ts'
import { textoEventoCiclo, validarTransicaoCiclo, type EventoCiclo } from './operations/ciclo-comercial.ts'
import type { CrmLead, CrmVisao } from './operations/types.ts'
import { PRODUTOS_DE_PROSPECCAO } from '../server/ofertas.ts'
import { VERSAO_CLASSIFICACAO_RESPOSTA } from './operations/classificacao-resposta.ts'
const AGORA = Date.parse('2026-10-25T15:00:00Z')
function lead(id: string, extra: Partial<CrmLead> = {}): CrmLead {
  return { id, produto: 'prumo', chave: id, empresa: 'Fixture interna', etapa: 'contato', marcos: {}, eventos: [], links: {}, notas: 0, divergencias: [], ...extra } as CrmLead
}
function visao(leads: CrmLead[] = []): CrmVisao {
  return { estado: 'ok', geradoEm: new Date(AGORA-60_000).toISOString(), minutosAteVelho: 15,
    fontes: ['site',...PRODUTOS_DE_PROSPECCAO,'registros'].map(id=>({ id, nome:id, linhas:0 })), colunasAusentes: [], leads } as CrmVisao
}
const valores = (v: CrmVisao | null) => Object.fromEntries(calcularIndicadoresOperacionais(v, AGORA).map(x=>[x.id,x.valor]))
function anexar(l: CrmLead, e: EventoCiclo) {
  validarTransicaoCiclo(l,e,AGORA)
  l.eventos.push({ tipo:'nota', origem:'manual', fonte:'fixture', rotulo:'Fato', em:new Date(AGORA-10_000+l.eventos.length*100).toISOString(), texto:textoEventoCiclo(e,AGORA) })
}
function fato(tipo: EventoCiclo['tipo'], id: string, vinculo: string, extra: Partial<EventoCiclo> = {}): EventoCiclo {
  return { v:1, id, tipo, data:'2026-10-25', humano:true, referencia:id, vinculo, evidencia:'Fonte sintética conferida', ...extra }
}
function cicloPago(): CrmLead {
  const l=lead('prumo:ciclo')
  anexar(l,{v:1,id:'prop-fixture',tipo:'proposta',data:'2026-10-25',humano:true,referencia:'Proposta fixture',ofertaId:'anuncios',versao:1,escopo:'Escopo fixture',prazo:'Prazo fixture',condicoes:'Condição fixture',responsavel:'Operador fixture',valor:83047,mensalidade:0})
  anexar(l,fato('proposta_enviada','env-fixture','prop-fixture'))
  anexar(l,fato('aceite','aceite-fixture','prop-fixture',{documento:'Documento fixture'}))
  anexar(l,fato('condicao_cobranca','cond-fixture','aceite-fixture',{componente:'inicial',valor:83047,gatilho:'aceite',condicao:'Aceite documentado',vigenciaInicio:'2026-10-25'}))
  anexar(l,fato('cobranca','cob-fixture','cond-fixture',{componente:'inicial',valor:83047,vencimento:'2026-10-30',forma:'Forma fixture'}))
  anexar(l,fato('pagamento','pag-fixture','cob-fixture',{componente:'inicial',valor:83047}))
  return l
}

test('fonte ausente, antiga, futura ou incompleta é desconhecida, nunca zero',()=>{
  const falha=visao();falha.fontes[0].erro='indisponível'
  const semRegistro=visao();semRegistro.fontes=semRegistro.fontes.filter(f=>f.id!=='registros')
  const colunas=visao();colunas.colunasAusentes=['coluna fixture']
  const ultima=visao();ultima.ultimaFalha={em:new Date(AGORA).toISOString(),erro:'Publicação incompleta'}
  for (const v of [null,{...visao(),estado:'sem-retrato' as const},{...visao(),geradoEm:new Date(AGORA-16*60_000).toISOString()},{...visao(),geradoEm:new Date(AGORA+1).toISOString()},falha,semRegistro,colunas,ultima]) {
    const r=calcularIndicadoresOperacionais(v,AGORA);assert.equal(r.length,8);assert.ok(r.every(i=>i.valor===null));assert.ok(r.every(i=>i.detalhe.includes('não interpretar como zero')))
  }
  assert.ok(calcularIndicadoresOperacionais(visao(),AGORA).every(i=>i.valor===0),'zero é permitido somente para fonte válida sem registros no recorte')
})

test('fila usa a prioridade canônica e preserva espera e recusa sem inflar demanda',()=>{
  const em='2026-10-25T14:00:00Z'
  const ls=[lead('conferir'),lead('qualificar',{resposta:{tipo:'interesse',trecho:'Quero avaliar uma solução para o atendimento',em},classificacaoResposta:{versao:VERSAO_CLASSIFICACAO_RESPOSTA,classe:'interesse',houveRespostaHumana:true,materialSolicitado:false,revisar:false,leituraConfirmada:false,motivo:'fixture'}}),lead('espera',{proximoPasso:{texto:'Aguardar a decisão conjunta',data:'2026-10-28',registradoEm:em}}),lead('recusa',{etapa:'perdido',resposta:{tipo:'negativa',trecho:'Não tenho interesse',em}}),lead('novo-sem-contexto',{etapa:'novo'}),lead('identidade',{atendimentoComercial:{id:'att-fixture',tipo:'handoff',titulo:'Conferência',motivo:'Fixture',alvo:'operador',estado:'pendente',identidade:'sem-prova'}})]
  const r=valores(visao(ls));assert.equal(r.conferir,2);assert.equal(r.qualificar,1);assert.equal(r.aguardar,1);assert.equal(r.decidir,0);assert.equal(r.identidade,1)
})

test('proposta legada e ganho não fabricam envio versionado, aceite ou dinheiro',()=>{
  const ls=[lead('proposta-legada',{etapa:'proposta',proposta:{data:'2026-10-24',em:'2026-10-24T12:00:00Z'},eventos:[{tipo:'proposta',origem:'manual',fonte:'fixture',rotulo:'Proposta',em:'2026-10-24T12:00:00Z'}]}),lead('ganho-sem-recibo',{etapa:'ganho',ganhoManual:true})]
  const r=valores(visao(ls));assert.equal(r['propostas-enviadas'],0);assert.equal(r.aceites,0);assert.equal(r.recebimentos,0)
})

test('ciclo humano preserva marcos e AARRR deduplica recebimentos legados e novos, sem exportar valores',()=>{
  const l=cicloPago();l.empresa='Dado privado fixture';l.eventos.push({...l.eventos.at(-1)!})
  const legado=lead('legado',{eventos:[{tipo:'pagamento_confirmado',origem:'manual',fonte:'fixture',rotulo:'Recebimento',em:'2026-10-25T14:00:00Z',texto:JSON.stringify({versao:1,oferta:'anuncios',componente:'mensalidade',valor_centavos:59000,referencia:'legado-fixture',data:'2026-10-25'})}]})
  const before=JSON.stringify([l,legado]);const r=calcularIndicadoresOperacionais(visao([l,legado]),AGORA);const byId=Object.fromEntries(r.map(i=>[i.id,i.valor]));assert.equal(byId['propostas-enviadas'],1);assert.equal(byId.aceites,1);assert.equal(byId.recebimentos,2)
  assert.equal(JSON.stringify([l,legado]),before,'o cálculo não altera fatos')
  assert.ok(!JSON.stringify(r).includes('83047'));assert.ok(!JSON.stringify(r).includes('59000'));assert.ok(!JSON.stringify(r).includes('Dado privado fixture'));assert.ok(r.find(x=>x.id==='recebimentos')!.detalhe.includes('não comprova primeira venda nova'))
  anexar(l,fato('correcao','corr-fixture','pag-fixture'))
  assert.equal(valores(visao([l])).recebimentos,0,'correção preservada não continua como recebimento ativo')
})