import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { proximoPassoDoTime, type TrabalhoDoTime } from './operations/proximo-passo-do-time.ts'

const agora = Date.parse('2026-10-26T15:00:00Z')
const frente = (mudancas: Partial<TrabalhoDoTime> = {}): TrabalhoDoTime => ({ ativo: true, estado: 'pronto', atualizadoEm: new Date(agora).toISOString(), fila: [{ id: 'site:1', empresa: 'Loja exemplo', estado: 'pronto' }], ...mudancas })
describe('clareza do próximo passo do time', () => {
  it('mostra contato, responsável e condição sem garantir envio', () => {
    const passo = proximoPassoDoTime(frente({ proximoEnvioEm: '2026-10-27T12:00:00Z' }), '', agora)
    assert.equal(passo.cliente?.id, 'site:1')
    assert.match(passo.responsavel, /Carla/)
    assert.match(passo.quando, /27\/10\/2026.*09:00.*conferência/)
  })
  it('pausa, bloqueio, rodada cheia e envio incerto prevalecem sobre fila pronta', () => {
    for (const mudancas of [{ ativo: false }, { estado: 'pausado' }, { estado: 'bloqueado' }, { rodada: { bloqueado: true, motivo: 'Aguardar resposta humana.' } }, { fila: [{ id: 'site:2', empresa: 'Conferir', estado: 'incerto' }, ...frente().fila] }]) {
      const passo = proximoPassoDoTime(frente(mudancas), '', agora)
      assert.equal(passo.cliente, undefined)
      assert.doesNotMatch(passo.titulo, /Próximo da fila/)
    }
  })
  it('leitura ausente, vencida, inválida ou com erro não anuncia ação atual', () => {
    for (const valor of [null, frente({ atualizadoEm: null }), frente({ atualizadoEm: 'inválido' }), frente({ atualizadoEm: new Date(agora - 600_001).toISOString() }), frente({ estado: 'sem-sinal' })]) {
      const passo = proximoPassoDoTime(valor, '', agora)
      assert.equal(passo.cliente, undefined)
      assert.match(passo.titulo, /Conferindo|não confirmado/)
    }
    assert.equal(proximoPassoDoTime(frente(), 'Falha de rede', agora).cliente, undefined)
  })
  it('envio em andamento não atribui o cliente de uma fila sem correlação', () => {
    const passo = proximoPassoDoTime(frente({ estado: 'enviando' }), '', agora)
    assert.equal(passo.cliente, undefined)
    assert.match(passo.acao, /confirmação/)
  })
  it('não trata orçamento de avaliação encerrado como todos os contatos enviados', () => {
    const passo = proximoPassoDoTime(frente({ estado: 'concluido', detalhe: 'Orçamento diário de avaliação atingido.' }), '', agora)
    assert.match(passo.titulo, /avaliação/)
    assert.match(passo.acao, /Orçamento/)
    assert.equal(passo.cliente, undefined)
  })
  it('exclui enviados e Plus da próxima ação automática e não usa horário passado', () => {
    const passo = proximoPassoDoTime(frente({ proximoEnvioEm: '2026-10-25T15:00:00Z', fila: [
      { id: 'site:0', empresa: 'Enviado', estado: 'enviado' },
      { id: 'plus:1', empresa: 'Rede quente', estado: 'pronto' },
      ...frente().fila,
    ] }), '', agora)
    assert.equal(passo.cliente?.id, 'site:1')
    assert.doesNotMatch(passo.quando, /25\/10/)
    assert.match(passo.quando, /se expediente/)
  })
  it('espera pelo expediente e estado desconhecido não prometem um contato', () => {
    assert.equal(proximoPassoDoTime(frente({ estado: 'fora-do-horario' }), '', agora).cliente, undefined)
    assert.match(proximoPassoDoTime(frente({ estado: 'novo-estado' }), '', agora).titulo, /não informado/)
  })
  it('mantém o motivo de espera da fonte visível mesmo com contatos prontos', () => {
    assert.equal(proximoPassoDoTime(frente({ detalhe: 'Limite compartilhado do dia atingido.' }), '', agora).condicao, 'Limite compartilhado do dia atingido.')
    assert.equal(proximoPassoDoTime(frente({ fila: [] }), '', agora).cliente, undefined)
    assert.match(proximoPassoDoTime(frente({ fila: [] }), '', agora).titulo, /Nenhum contato pronto/)
  })
})
