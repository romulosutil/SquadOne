import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHAVE_DA_VISTA_DO_FUNIL, gravarVistaDoFunil, lerVistaDoFunil, naEtapa, ordenarLista, sinalMaisForte, textoDoProximoPasso,
  type Guardador,
} from './operations/funil-lista.ts'
import type { CrmLead } from './operations/types.ts'

const lead = (id: string, extra: Partial<CrmLead> = {}): CrmLead => ({
  id, produto: 'site', chave: id, empresa: id, nicho: '', cidade: '', etapa: 'contato', sinal: 'enviado', subEtapa: '',
  estadoNaPlanilha: 'enviado', leitura: 'desconhecida', marcos: {}, followupHoje: false, respostaNova: false, acervo: false,
  notas: 0, eventos: [], links: {}, divergencias: [], ...extra,
})

describe('sinalMaisForte', () => {
  it('Resposta nova > Follow-up hoje > Perdido amanhã > Divergência > o resto', () => {
    const tudo = { respostaNova: true, followupHoje: true, diasParaSair: 1, divergencias: ['x'], resposta: { tipo: 'interesse' as const, trecho: '' } }
    assert.equal(sinalMaisForte(lead('a', tudo))?.texto, 'Resposta nova')
    assert.equal(sinalMaisForte(lead('a', { ...tudo, respostaNova: false }))?.texto, 'Follow-up hoje')
    assert.equal(sinalMaisForte(lead('a', { ...tudo, respostaNova: false, followupHoje: false }))?.texto, 'Perdido amanhã')
    assert.equal(sinalMaisForte(lead('a', { ...tudo, respostaNova: false, followupHoje: false, diasParaSair: 3 }))?.texto, 'Divergência')
    assert.deepEqual(sinalMaisForte(lead('a', { resposta: { tipo: 'interesse', trecho: '' }, diasParaSair: 3 })), { texto: 'Interesse', classe: 'is-interesse' })
  })

  it('Perdido em 3 dias só entra no fim; sem nada, nenhum sinal', () => {
    assert.deepEqual(sinalMaisForte(lead('a', { diasParaSair: 3 })), { texto: 'Perdido em 3 dias', classe: 'is-prazo' })
    assert.equal(sinalMaisForte(lead('a')), null)
  })

  it('follow-up anotado nesta tela deixa de ser "Follow-up hoje"', () => {
    const l = lead('a', { followupHoje: true })
    assert.equal(sinalMaisForte(l, (t) => t === 'followup_enviado')?.texto, 'Follow-up anotado')
    assert.equal(sinalMaisForte(lead('a', { followupHoje: true, reenvioDoRobo: true }))?.texto, 'Reenvio hoje (só robô)')
  })

  it('no Novo, WhatsApp não confirmado antes da prioridade do caçador', () => {
    const triagem = { prioridade: 8, origemWhatsapp: 'não confirmado (site)' }
    assert.equal(sinalMaisForte(lead('a', { etapa: 'novo', triagem }))?.texto, 'WhatsApp não confirmado')
    assert.equal(sinalMaisForte(lead('a', { etapa: 'novo', triagem: { prioridade: 8 } }))?.texto, 'Prioridade 8')
  })
})

describe('ordenarLista', () => {
  const a = lead('a', { ultimoEvento: '2026-10-10T12:00:00Z', proximoPasso: { texto: 'ligar', data: '2026-10-20', registradoEm: '' } })
  const b = lead('b', { ultimoEvento: '2026-10-14T12:00:00Z' })
  const c = lead('c', { proximoPasso: { texto: 'proposta', data: '2026-10-17', registradoEm: '' } })
  const ids = (ls: CrmLead[]) => ls.map((l) => l.id).join('')

  it('pela ação mantém a ordem recebida (a do quadro)', () => {
    assert.equal(ids(ordenarLista([c, a, b], 'acao', 'asc')), 'cab')
  })

  it('sem a data vai para o fim nos dois sentidos', () => {
    assert.equal(ids(ordenarLista([c, a, b], 'ultimo', 'desc')), 'bac')
    assert.equal(ids(ordenarLista([c, a, b], 'ultimo', 'asc')), 'abc')
    assert.equal(ids(ordenarLista([b, a, c], 'proximo', 'asc')), 'cab')
    assert.equal(ids(ordenarLista([b, a, c], 'proximo', 'desc')), 'acb')
  })
})

describe('apoio da Lista', () => {
  it('abertas são Novo, Em contato e Proposta', () => {
    assert.deepEqual((['novo', 'contato', 'proposta', 'ganho', 'perdido'] as const).map((e) => naEtapa('abertas', e)), [true, true, true, false, false])
    assert.equal(naEtapa('perdido', 'perdido'), true)
  })

  it('próximo passo em dd/mm com o texto', () => {
    assert.equal(textoDoProximoPasso(lead('a', { proximoPasso: { texto: 'Ligar', data: '2026-10-02', registradoEm: '' } })), '02/10 · Ligar')
    assert.equal(textoDoProximoPasso(lead('a')), '')
  })

  it('a vista guardada só vale se for "lista"; storage que lança vira quadro', () => {
    const dados: Record<string, string> = {}
    const s: Guardador = { getItem: (k) => dados[k] ?? null, setItem: (k, v) => { dados[k] = v } }
    assert.equal(lerVistaDoFunil(s), 'quadro')
    gravarVistaDoFunil(s, 'lista')
    assert.equal(dados[CHAVE_DA_VISTA_DO_FUNIL], 'lista')
    assert.equal(lerVistaDoFunil(s), 'lista')
    const quebrado: Guardador = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    assert.equal(lerVistaDoFunil(quebrado), 'quadro')
    assert.doesNotThrow(() => gravarVistaDoFunil(quebrado, 'lista'))
  })
})
