import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LEAD_DE_EXEMPLO } from '../blueprint/exemplo.ts'
import type { EventoCiclo as EventoFinanceiro } from '../operations/ciclo-comercial.ts'
import type { TrabalhoRegistrado } from './trabalho-registrado'
import { OFERTAS_PROPRIAS } from '../../server/ofertas.ts'
type EventoCiclo = EventoFinanceiro | TrabalhoRegistrado
const textoEventoCiclo = (evento: EventoCiclo, _agora?: number) => '[ciclo-comercial-v1] ' + JSON.stringify(evento)
import { faseDoEscritorio, fasesDoCliente, movimentosDoEscritorio, pendenciasDaJornada } from './jornada-do-escritorio.ts'
const agora = Date.parse('2026-10-26T16:00:00Z')
const lead = () => structuredClone(LEAD_DE_EXEMPLO)
describe('jornada e timeline do escritório', () => {
  it('envio confirmado leva à fase 2; fila, link e demo prontos não equivalem a envio', () => {
    const l = lead(); Object.assign(l, { etapa: 'novo', sinal: 'pronto', marcos: {}, resposta: undefined, conversa: undefined, eventos: [] })
    assert.equal(faseDoEscritorio(l, agora), 1)
    assert.deepEqual(movimentosDoEscritorio([l], agora), [])
    l.marcos.enviado = '2026-10-26T12:00:00Z'
    assert.equal(faseDoEscritorio(l, agora), 2)
    assert.equal(movimentosDoEscritorio([l], agora)[0].titulo, 'Primeiro contato confirmado')
  })
  it('robô não promove para conversa humana e futuros não entram na timeline', () => {
    const l = lead(); l.resposta = { tipo: 'bot', em: '2026-10-26T15:00:00Z', trecho: 'Atendimento automático' }; l.marcos = { enviado: '2026-10-26T12:00:00Z' }
    l.conversa = { desde: l.marcos.enviado!, mensagens: 2, ultima: { direcao: 'entrada', papel: 'robo', em: l.resposta.em!, trecho: 'Atendimento automático' }, ultimaEntradaRobo: l.resposta.em }
    l.demoPedidoEm = '2026-10-27T12:00:00Z'
    assert.equal(faseDoEscritorio(l, agora), 2)
    assert.deepEqual(movimentosDoEscritorio([l], agora).map(m => m.titulo), ['Resposta automática recebida', 'Primeiro contato confirmado'])
  })
  it('proposta e ganho não preenchem os marcos anteriores sem evidência', () => {
    const l = lead(); Object.assign(l, { etapa: 'ganho', marcos: {}, resposta: undefined, conversa: undefined, eventos: [] })
    const fases = fasesDoCliente(l, agora)
    assert.equal(faseDoEscritorio(l, agora), 6)
    assert.equal(fases.find(f => f.id === 2)?.estado, 'sem-registro')
    assert.equal(fases.find(f => f.id === 4)?.estado, 'sem-registro')
    assert.equal(movimentosDoEscritorio([l], agora).length, 0)
  })
  it('ordena os fatos entre clientes e não duplica o marco e o evento da mesma mensagem', () => {
    const a = lead(), b = lead(); b.id = 'site:segundo'; b.marcos.enviado = '2026-10-26T15:59:00Z'
    const movimentos = movimentosDoEscritorio([a,b], agora)
    assert.equal(movimentos[0].leadId, b.id)
    assert.equal(movimentos.filter(m => m.leadId === a.id && m.fase === 2).length, 1)
  })
  it('um encaminhamento mostra o responsável registrado e respeita correções', () => {
    const l = lead(), e: EventoCiclo = { v: 1, id: 'producao-exemplo', tipo: 'trabalho', data: '2026-10-26', humano: true, referencia: 'exemplo', fila: 'time', responsavel: 'Elisa', tarefa: 'Preparar a demonstração', resultado: 'Demo conferida', condicao: 'Conferir antes de enviar' }
    l.eventos = [{ tipo: 'nota', rotulo: 'Trabalho', em: '2026-10-26T15:30:00Z', origem: 'manual', fonte: 'CRM', texto: textoEventoCiclo(e, agora) }]
    assert.equal(movimentosDoEscritorio([l], agora)[0].responsavel, 'Elisa')
    assert.equal(pendenciasDaJornada([l], [], agora).length, 0)
    const correcao: EventoCiclo = { v:1, id:'corrigir-producao', tipo:'correcao', data:'2026-10-26', humano:true, referencia:'correção', vinculo:e.id, evidencia:'Encaminhamento corrigido' }
    l.eventos.push({ tipo:'nota', rotulo:'Correção', em:'2026-10-26T15:40:00Z', origem:'manual', fonte:'CRM', texto:textoEventoCiclo(correcao, agora) })
    assert.equal(movimentosDoEscritorio([l], agora).some(m => m.responsavel === 'Elisa'), false)
    assert.equal(pendenciasDaJornada([l], [], agora).length, 0, 'retirar tarefa do time não cria uma decisão humana por falta de contexto')
  })
  it('Iris e Estamparia não recebem etapa de material obrigatório inexistente', () => {
    for (const produto of OFERTAS_PROPRIAS) { const l = lead(); l.produto = produto; assert.equal(fasesDoCliente(l, agora).some(f => f.id === 4), false) }
  })
  it('um ganho sem data não herda a data de uma recusa anterior', () => {
    const l = lead(); l.etapa = 'ganho'; l.eventos = [{tipo:'recusou',rotulo:'Recusa anterior',origem:'automático',fonte:'CRM',em:'2026-10-25T12:00:00Z'}]
    assert.equal(movimentosDoEscritorio([l], agora).some(m => m.titulo === 'Venda registrada como ganha'), false)
  })
  it('fase atual sem hora não vira um fato datado nem conclui fases anteriores', () => {
    const l = lead(); Object.assign(l,{ etapa:'contato',marcos:{},conversa:undefined,resposta:undefined,eventos:[] })
    assert.equal(faseDoEscritorio(l,agora),2)
    assert.equal(fasesDoCliente(l,agora)[0].estado,'sem-registro')
    assert.deepEqual(movimentosDoEscritorio([l],agora),[])
  })
  it('resposta posterior à proposta não mostra uma volta à fase de conversa', () => {
    const l = lead(); l.etapa = 'proposta'; l.proposta = {em:'2026-10-15T12:00:00Z',data:'2026-10-15'}
    assert.equal(movimentosDoEscritorio([l],agora).find(m => m.titulo === 'Resposta humana recebida')?.fase,5)
  })
})
