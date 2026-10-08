import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHAVE_DOS_ENVIOS, CONFIRMACAO_ESPERADA_MS, VALIDADE_DO_ENVIO_MS, estadoDoEnvio, filaDeEnvio, gravarEnvios, lerEnvios,
  marcarEnvio, nichosDaFila, ordemComPulados, ordenarComEnvios, podarEnvios, type Guardador,
} from './operations/fila-de-envio.ts'
import type { CrmItemHoje, CrmLead } from './operations/types.ts'

const AGORA = Date.parse('2026-10-08T12:00:00Z')

const item = (leadId: string): CrmItemHoje => ({ leadId, acao: 'Enviar o site pelo WhatsApp', detalhe: '', links: [], ordem: 0 })
const lead = (id: string, nicho: string, enviar: string | null = `https://x/webhook/enviar?place_id=${id}`): CrmLead => ({
  id, produto: 'site', chave: id, empresa: id, nicho, cidade: '', etapa: 'novo', sinal: 'pronto', subEtapa: '',
  estadoNaPlanilha: 'pronto', leitura: 'nao-se-aplica', marcos: {}, followupHoje: false, respostaNova: false, acervo: false,
  notas: 0, eventos: [], links: enviar ? { enviar } : {}, divergencias: [],
})

function memoria(inicial: Record<string, string> = {}): Guardador & { dados: Record<string, string> } {
  const dados = { ...inicial }
  return { dados, getItem: (k) => dados[k] ?? null, setItem: (k, v) => { dados[k] = v } }
}

describe('marcas de envio no navegador', () => {
  it('grava e relê; o que venceu ou está no futuro some', () => {
    const s = memoria()
    gravarEnvios(s, { 'site:a': AGORA - 1000, 'site:velho': AGORA - VALIDADE_DO_ENVIO_MS, 'site:futuro': AGORA + 10 * 60_000 })
    assert.deepEqual(lerEnvios(s, AGORA), { 'site:a': AGORA - 1000 })
  })

  it('storage que lança ou com lixo vira vazio, sem quebrar a tela', () => {
    const quebrado: Guardador = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    assert.deepEqual(lerEnvios(quebrado, AGORA), {})
    assert.doesNotThrow(() => gravarEnvios(quebrado, { 'site:a': AGORA }))
    assert.deepEqual(lerEnvios(memoria({ [CHAVE_DOS_ENVIOS]: '[1,2]' }), AGORA), {})
    assert.deepEqual(lerEnvios(memoria({ [CHAVE_DOS_ENVIOS]: '{nao e json' }), AGORA), {})
    assert.deepEqual(lerEnvios(null, AGORA), {})
  })

  it('repetir o toque mantém a hora do primeiro', () => {
    const uma = marcarEnvio({}, 'site:a', AGORA)
    assert.deepEqual(marcarEnvio(uma, 'site:a', AGORA + 60_000), { 'site:a': AGORA })
  })

  it('podar tira o que a planilha confirmou (saiu dos prontos) e mantém o que ainda espera', () => {
    const envios = { 'site:a': AGORA - 1000, 'site:b': AGORA - 2000 }
    assert.deepEqual(podarEnvios(envios, new Set(['site:b', 'site:c']), AGORA), { 'site:b': AGORA - 2000 })
  })

  it('passado o tempo de um retrato, o toque sem confirmação pede conferência', () => {
    assert.equal(estadoDoEnvio(AGORA - 60_000, AGORA), 'aguardando')
    assert.equal(estadoDoEnvio(AGORA - CONFIRMACAO_ESPERADA_MS, AGORA), 'conferir')
  })
})

describe('fila de envio', () => {
  const itens = ['site:a', 'site:b', 'site:c', 'site:d'].map(item)
  const leads = new Map([
    ['site:a', lead('site:a', 'advocacia')],
    ['site:b', lead('site:b', 'dedetizadora')],
    ['site:c', lead('site:c', 'advocacia')],
    ['site:d', lead('site:d', 'advocacia', null)],
  ])

  it('lista: os abertos vão para o fim, cada parte na ordem do servidor', () => {
    assert.deepEqual(ordenarComEnvios(itens, { 'site:a': AGORA }).map(i => i.leadId), ['site:b', 'site:c', 'site:d', 'site:a'])
  })

  it('fila: só quem tem link de envio e não foi aberto; o nicho filtra', () => {
    assert.deepEqual(filaDeEnvio(itens, leads, { 'site:b': AGORA }).map(f => f.item.leadId), ['site:a', 'site:c'])
    assert.deepEqual(filaDeEnvio(itens, leads, {}, 'dedetizadora').map(f => f.enviar), ['https://x/webhook/enviar?place_id=site:b'])
  })

  it('nichos: do que tem mais esperando para o que tem menos, sem contar o já aberto nem o sem link', () => {
    assert.deepEqual(nichosDaFila(itens, leads, {}), [{ nicho: 'advocacia', quantos: 2 }, { nicho: 'dedetizadora', quantos: 1 }])
    assert.deepEqual(nichosDaFila(itens, leads, { 'site:a': AGORA, 'site:c': AGORA }), [{ nicho: 'dedetizadora', quantos: 1 }])
  })

  it('pular manda para o fim; pular de novo, para depois do último pulado', () => {
    const fila = filaDeEnvio(itens, leads, {})
    assert.deepEqual(ordemComPulados(fila, ['site:a']).map(f => f.item.leadId), ['site:b', 'site:c', 'site:a'])
    assert.deepEqual(ordemComPulados(fila, ['site:a', 'site:b']).map(f => f.item.leadId), ['site:c', 'site:a', 'site:b'])
  })
})
