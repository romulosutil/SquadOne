import type { Pessoa, SquadView } from '../../src/types'
import type { EstacaoDaProducao } from '../../src/office/linha-de-producao'
import type { FaseDoEscritorio } from '../../src/office/jornada-do-escritorio'

const nomes = ['Carla', 'Diego', 'Elisa', 'Marina', 'Ana', 'Bruno']
const setores = ['Atendimento', 'Prospecção', 'Produção', 'Curadoria', 'Negociação', 'Operação']
const ids = ['prumo--geral', 'prumo--prospeccao', 'prumo--site-antes-da-venda', 'prumo--curadoria', 'prumo--negociacao', 'prumo--operacao']
const pessoa = (i: number, j: number): Pessoa => ({
  id: `agente-${i}-${j}`, nome: j ? `${nomes[i]} ${j + 1}` : nomes[i], papel: setores[i], escopo: 'Demonstração local',
  sprite: `wraith_0${(i + j) % 3 + 1}`, hue: 0, hiredAt: '2026-10-26T12:00:00Z',
})

export function equipe(quantidade = 18): SquadView {
  return {
    id: 'comparacao', nome: 'Comparação local', escopo: 'Dados fictícios', calendarId: '', unlockOrder: [],
    unlockedSlots: [], proximoSlot: null, arquivo: { dominios: [], integrantes: [] },
    dominios: setores.map((nome, i) => ({
      id: ids[i], nome, escopo: 'Demonstração local', slot: [i % 2, Math.floor(i / 2)],
      room: 'ROOM_EMPTY', criadoEm: '2026-10-26T12:00:00Z', po: pessoa(i, 0),
      integrantes: Array.from({ length: Math.max(0, Math.floor(quantidade / 6) - 1) }, (_, j) => pessoa(i, j + 1)),
    })),
  }
}

export const estacoes: EstacaoDaProducao[] = ['Preparação', 'Contato', 'Conversa', 'Material', 'Proposta', 'Desfecho'].map((nome, i) => ({
  id: i + 1 as FaseDoEscritorio, nome, setor: setores[i], comVoce: i === 2 ? 1 : 0,
  fichas: [{ id: `cliente-${i}`, empresa: `Empresa exemplo ${i + 1}`, responsavel: nomes[i], acao: 'Conferir próximo passo', situacao: 'aguardando', rotulo: 'Aguardando' }],
}))
