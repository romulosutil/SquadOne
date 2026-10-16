import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHAVE_DAS_ANOTACOES, VALIDADE_DA_ANOTACAO_MS, anotadoEm, anotar, corpoDaAnotacao, desanotar, gravarAnotados, lerAnotados,
  ordenarComAnotados, podarAnotados, textoDaAnotacao, tipoDoGrupo, tipoDoLink,
} from './operations/anotacao-de-envio.ts'
import type { CrmItemHoje, CrmLead } from './operations/types.ts'

// Tudo em memória: o storage é um objeto qualquer, nenhum localStorage nem rede.
const AGORA = Date.parse('2026-10-14T15:00:00Z')
const item = (leadId: string): CrmItemHoje => ({ leadId, acao: '', detalhe: '', links: [], ordem: 0 })
const lead = (marcos: CrmLead['marcos'] = {}) => ({ marcos }) as Pick<CrmLead, 'marcos'>

function storage(inicial: Record<string, string> = {}) {
  const dados = { ...inicial }
  return { dados, getItem: (k: string) => dados[k] ?? null, setItem: (k: string, v: string) => { dados[k] = v } }
}

describe('anotação do envio (2ª mensagem e follow-up)', () => {
  it('o link diz qual envio é, pelo lead; conversa e demo não anotam nada', () => {
    const links = { segunda: 'https://wa.me/1?text=link', followup: 'https://wa.me/1?text=fu', whatsapp: 'https://wa.me/1', site: 'https://demo' }
    const produto = 'site' as const
    assert.equal(tipoDoLink({ links, produto }, links.segunda), 'segunda_enviada')
    assert.equal(tipoDoLink({ links, produto }, links.followup), 'followup_enviado')
    assert.equal(tipoDoLink({ links, produto }, links.whatsapp), null)
    assert.equal(tipoDoLink({ links, produto }, links.site), null)
    assert.equal(tipoDoLink(undefined, links.segunda), null)
    assert.equal(tipoDoLink({ links: {}, produto }, ''), null, 'link ausente não casa com url vazia')
  })

  it('Plus: só o toque no link de envio anota a primeira mensagem; no Site o Balcão é quem marca', () => {
    const links = { enviar: 'https://wa.me/5511999999999?text=oi', whatsapp: 'https://wa.me/5511999999999' }
    assert.equal(tipoDoLink({ links, produto: 'plus' }, links.enviar), 'plus_enviado')
    assert.equal(tipoDoLink({ links, produto: 'plus' }, links.whatsapp), null)
    assert.equal(tipoDoLink({ links, produto: 'site' }, links.enviar), null)
    assert.equal(tipoDoGrupo('enviar'), null, 'o envio do Plus tem o próprio aviso na Hoje (fila-de-envio), não o do grupo')
    assert.equal(textoDaAnotacao('plus_enviado', '14:02'), 'Envio anotado às 14:02')
  })

  it('anotar: o primeiro toque vale, repetir não renova, desanotar tira só aquele', () => {
    let a = anotar({}, 'site:x', 'segunda_enviada', AGORA)
    a = anotar(a, 'site:x', 'segunda_enviada', AGORA + 60_000)
    a = anotar(a, 'site:x', 'followup_enviado', AGORA + 1000)
    assert.equal(anotadoEm(a, 'site:x', 'segunda_enviada'), AGORA)
    assert.equal(anotadoEm(a, 'site:x', 'followup_enviado'), AGORA + 1000)
    a = desanotar(a, 'site:x', 'segunda_enviada')
    assert.equal(anotadoEm(a, 'site:x', 'segunda_enviada'), undefined)
    assert.equal(anotadoEm(a, 'site:x', 'followup_enviado'), AGORA + 1000)
  })

  it('storage: lê só o que vale (10 min, tipo conhecido), tolera lixo e storage que lança', () => {
    const s = storage({ [CHAVE_DAS_ANOTACOES]: JSON.stringify({
      'site:a|segunda_enviada': AGORA - 60_000,
      'site:b|followup_enviado': AGORA - VALIDADE_DA_ANOTACAO_MS,
      'site:c|nota': AGORA,
      'site:d|segunda_enviada': 'ontem',
    }) })
    assert.deepEqual(lerAnotados(s, AGORA), { 'site:a|segunda_enviada': AGORA - 60_000 })
    assert.deepEqual(lerAnotados(storage({ [CHAVE_DAS_ANOTACOES]: '{ruim' }), AGORA), {})
    assert.deepEqual(lerAnotados(null, AGORA), {})
    const quebra = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    assert.deepEqual(lerAnotados(quebra, AGORA), {})
    assert.doesNotThrow(() => gravarAnotados(quebra, { 'site:a|segunda_enviada': AGORA }))
    const ok = storage()
    gravarAnotados(ok, { 'site:a|segunda_enviada': AGORA })
    assert.deepEqual(lerAnotados(ok, AGORA), { 'site:a|segunda_enviada': AGORA })
  })

  it('poda: o retrato que confirma tira a marca; marco antigo não confirma; lead que sumiu leva a marca', () => {
    const a = {
      'site:confirmado|segunda_enviada': AGORA,
      'site:velho|followup_enviado': AGORA,
      'site:esperando|segunda_enviada': AGORA,
      'site:sumiu|segunda_enviada': AGORA,
    }
    const leads = new Map([
      ['site:confirmado', lead({ segundaEnviada: new Date(AGORA + 3000).toISOString() })],
      ['site:velho', lead({ followupEnviado: new Date(AGORA - 3 * 864e5).toISOString() })],
      ['site:esperando', lead()],
    ])
    assert.deepEqual(Object.keys(podarAnotados(a, leads, AGORA + 5000)), ['site:velho|followup_enviado', 'site:esperando|segunda_enviada'])
    assert.deepEqual(podarAnotados(a, leads, AGORA + VALIDADE_DA_ANOTACAO_MS), {}, 'venceu')
  })

  it('Hoje: no grupo do envio, os anotados vão para o fim na ordem do servidor; outro grupo não muda', () => {
    const itens = [item('site:a'), item('site:b'), item('site:c')]
    const a = { 'site:a|segunda_enviada': AGORA, 'site:c|followup_enviado': AGORA }
    assert.deepEqual(ordenarComAnotados(itens, 'resposta', a).map((i) => i.leadId), ['site:b', 'site:c', 'site:a'])
    assert.deepEqual(ordenarComAnotados(itens, 'followup', a).map((i) => i.leadId), ['site:a', 'site:b', 'site:c'])
    assert.deepEqual(ordenarComAnotados(itens, 'proposta', a).map((i) => i.leadId), ['site:a', 'site:b', 'site:c'])
    assert.equal(tipoDoGrupo('resposta'), 'segunda_enviada')
    assert.equal(tipoDoGrupo('enviar'), null)
  })

  it('o corpo do registro usa a chave da planilha, sem texto nem data; o texto da marca', () => {
    assert.deepEqual(corpoDaAnotacao({ produto: 'prumo', chave: 'abc-1' }, 'followup_enviado'),
      { produto: 'prumo', id: 'abc-1', tipo: 'followup_enviado', texto: '', data: '' })
    assert.equal(textoDaAnotacao('segunda_enviada', '14:02'), '2ª mensagem anotada às 14:02')
    assert.equal(textoDaAnotacao('followup_enviado', '14:02'), 'Follow-up anotado às 14:02')
  })
})
