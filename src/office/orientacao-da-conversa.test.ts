import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orientaContato, momentoDaOrientacao } from './orientacao-da-conversa'
import { planoDoLead } from '../operations/bi-operacao'
import { classificarResposta } from '../operations/classificacao-resposta'
import type { CrmLead } from '../operations/types'

function cliente(campos: Partial<CrmLead> = {}): CrmLead {
  const l = { id: 'site:orientacao-exemplo', empresa: 'Empresa fictícia', produto: 'site', etapa: 'contato', eventos: [], links: {},
    marcos: { enviado: '2026-10-25T12:00:00Z' }, resposta: { tipo: 'interesse', em: '2026-10-25T12:02:00Z', trecho: 'Pode mandar o link.' },
    conversa: { ultima: { direcao: 'entrada', papel: 'gente', em: '2026-10-25T12:02:00Z', trecho: 'Pode mandar o link.' }, ultimaEntrada: '2026-10-25T12:02:00Z',
      recentes: [{ direcao: 'saida', em: '2026-10-25T12:00:00Z', trecho: 'Posso mandar a demonstração?' }, { direcao: 'entrada', papel: 'gente', em: '2026-10-25T12:02:00Z', trecho: 'Pode mandar o link.' }] },
    ...campos } as CrmLead
  l.classificacaoResposta = classificarResposta(l)
  return l
}

test('material solicitado permite orientação de contato; contexto a revisar retira a ação', () => {
  const l = cliente()
  assert.equal(orientaContato(l, planoDoLead(l)), true)
  l.classificacaoResposta!.revisar = true
  assert.equal(orientaContato(l, planoDoLead(l)), false)
})

test('tarefa interna não vira mensagem ao cliente mesmo quando o plano é agir', () => {
  const l = cliente({ proximoPasso: { texto: 'Revisão interna: conferir condições', data: '2026-10-25', registradoEm: '2026-10-25T12:03:00Z' } })
  const plano = planoDoLead(l)
  assert.equal(plano.tipo, 'agir')
  assert.equal(orientaContato(l, plano), false)
})

test('desfecho e espera protegem o cliente mesmo diante de um plano de contato anterior', () => {
  const l = cliente(), anterior = planoDoLead(l)
  assert.equal(orientaContato(cliente({ etapa: 'perdido' }), anterior), false)
  assert.equal(orientaContato(cliente({ proximoPasso: { texto: 'Aguardar o combinado', data: '2099-10-26', registradoEm: '2099-10-25T12:00:00Z' } }), anterior), false)
})

test('data sem hora e prazo por condição não inventam um horário para escrever', () => {
  assert.equal(momentoDaOrientacao('2026-10-26').titulo, '26/10/2026')
  assert.match(momentoDaOrientacao('2026-10-26').detalhe, /horário ainda precisa/)
  assert.equal(momentoDaOrientacao('Até nova resposta').titulo, 'Até nova resposta')
  assert.match(momentoDaOrientacao('Até nova resposta').detalhe, /não indica uma hora específica/)
  assert.equal(momentoDaOrientacao('2026-02-30').titulo, '2026-02-30')
})
