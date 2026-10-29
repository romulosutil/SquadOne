import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MOTIVOS_DE_PERDA, MOTIVO_DA_PERDA_AUTOMATICA, ROTULO_DO_MOTIVO_DE_PERDA, desfechoDoMotivo, lerMotivoDePerda, motivoDaPerdaDoLead,
  motivoRegistrado, resumoDosMotivos,
} from './operations/motivos-de-perda.ts'
import { lerRegistroAarr, textoDoRegistroAarr } from './operations/aarr.ts'
import { desfechosDoLead } from './operations/proxima-venda.ts'
import type { CrmEvento, CrmLead } from './operations/types.ts'

const motivo = (valor: string, em = '2026-10-28T13:00:00Z'): CrmEvento => ({ tipo: 'motivo_perda', origem: 'manual', em, rotulo: '', fonte: '', texto: JSON.stringify({ versao: 1, valor }) })
const desfazer = (tipo: string, em: string): CrmEvento => ({ tipo, origem: 'manual', em, rotulo: '', fonte: '', texto: '' })
// O desfecho de perda marcado à mão (recusou, sem_contato): o mesmo formato de registro, sem texto.
const desfecho = desfazer
const lead = (extra: Partial<CrmLead> = {}) => ({ motivoPerda: undefined, eventos: [], ...extra }) as Pick<CrmLead, 'motivoPerda' | 'eventos'>

describe('motivos de perda: a lista fechada de 28/10/2026', () => {
  it('sete motivos, na ordem da decisão, cada um com rótulo curto', () => {
    assert.deepEqual([...MOTIVOS_DE_PERDA], ['preco', 'timing', 'decisor', 'ja_tem', 'sem_dor', 'sumiu', 'contato_errado'])
    for (const m of MOTIVOS_DE_PERDA) assert.ok(ROTULO_DO_MOTIVO_DE_PERDA[m] && ROTULO_DO_MOTIVO_DE_PERDA[m].length <= 24, m)
  })
  for (const [gravado, lido] of [
    ['preco', 'preco'], ['timing', 'timing'], ['decisor', 'decisor'], ['ja_tem', 'ja_tem'], ['sem_dor', 'sem_dor'], ['sumiu', 'sumiu'], ['contato_errado', 'contato_errado'],
    ['sem-dor', 'sem_dor'], ['concorrente', 'ja_tem'], ['inventado', null], ['', null], [undefined, null], ['__proto__', null],
  ] as const) it(`registro "${gravado}" lido como ${lido}`, () => assert.equal(lerMotivoDePerda(gravado), lido))

  for (const [automatico, traduzido] of [
    ['recusou', 'sem_dor'], ['sem-interesse', 'sem_dor'], ['expirou', 'sumiu'], ['esfriou', 'sumiu'], ['proposta-sem-retorno', 'sumiu'],
    ['sem-contato', 'contato_errado'], ['descartado', null],
  ] as const) it(`motivo automático ${automatico} → ${traduzido ?? 'fora da conta'}`, () => {
    assert.equal(MOTIVO_DA_PERDA_AUTOMATICA[automatico], traduzido)
    assert.equal(motivoDaPerdaDoLead(lead({ motivoPerda: automatico })), traduzido)
  })
  it('todo motivo automático do servidor tem tradução escrita', () =>
    assert.deepEqual(Object.keys(MOTIVO_DA_PERDA_AUTOMATICA).sort(), ['descartado', 'esfriou', 'expirou', 'proposta-sem-retorno', 'recusou', 'sem-contato', 'sem-interesse']))

  for (const [m, desfecho] of [
    ['preco', 'recusou'], ['timing', 'recusou'], ['decisor', 'recusou'], ['ja_tem', 'recusou'], ['sem_dor', 'recusou'], ['sumiu', 'sem_contato'], ['contato_errado', 'sem_contato'],
  ] as const) it(`"Perdeu" com ${m} grava o desfecho ${desfecho}`, () => assert.equal(desfechoDoMotivo(m), desfecho))
})

describe('o motivo do Perdido: registrado manda, automático traduz, registro antigo é lido', () => {
  it('o registrado vence o automático; o último vale', () => {
    assert.equal(motivoDaPerdaDoLead(lead({ motivoPerda: 'recusou', eventos: [motivo('preco'), desfecho('recusou', '2026-10-28T13:00:00Z')] })), 'preco')
    assert.equal(motivoDaPerdaDoLead(lead({ motivoPerda: 'recusou', eventos: [motivo('preco', '2026-10-28T13:00:00Z'), motivo('concorrente', '2026-10-28T14:00:00Z'), desfecho('recusou', '2026-10-28T14:00:00Z')] })), 'ja_tem')
  })
  it('o desfazer da perda apaga o motivo anterior; o lead perdido de novo usa o motivo novo ou o automático', () => {
    const eventos = [motivo('timing', '2026-10-20T12:00:00Z'), desfazer('recusou_desfeito', '2026-10-21T12:00:00Z')]
    assert.equal(motivoRegistrado(lead({ eventos })), null)
    assert.equal(motivoDaPerdaDoLead(lead({ motivoPerda: 'proposta-sem-retorno', eventos })), 'sumiu')
    assert.equal(motivoDaPerdaDoLead(lead({ motivoPerda: 'recusou', eventos: [...eventos, motivo('decisor', '2026-10-25T12:00:00Z'), desfecho('recusou', '2026-10-25T12:00:01Z')] })), 'decisor')
  })
  it('motivo solto (o desfecho do "Perdeu" falhou) não vira o porquê de um vencimento automático meses depois', () => {
    const solto = [motivo('preco', '2026-06-10T12:00:00Z')]
    const vencida = lead({ motivoPerda: 'proposta-sem-retorno', etapa: 'perdido', desde: '2026-10-28T12:00:00Z', eventos: solto } as Partial<CrmLead>)
    assert.equal(motivoRegistrado(vencida), null)
    assert.equal(motivoDaPerdaDoLead(vencida), 'sumiu')
    // A nova tentativa do desfecho (depois ou no mesmo instante) liga o motivo à perda.
    for (const em of ['2026-06-10T12:00:00Z', '2026-06-10T12:05:00Z']) {
      assert.equal(motivoDaPerdaDoLead(lead({ motivoPerda: 'recusou', eventos: [...solto, desfecho('recusou', em)] })), 'preco', em)
    }
    // Desfeito o desfecho, o motivo volta a ficar solto.
    assert.equal(motivoRegistrado(lead({ eventos: [...solto, desfecho('recusou', '2026-06-10T12:05:00Z'), desfazer('recusou_desfeito', '2026-06-11T12:00:00Z')] })), null)
  })
  it('motivo registrado em Receita depois da perda vale: desfecho marcado antes, ou o lead já fora pelo automático', () => {
    assert.equal(motivoDaPerdaDoLead(lead({ motivoPerda: 'sem-contato', eventos: [desfecho('sem_contato', '2026-10-20T12:00:00Z'), motivo('timing', '2026-10-28T13:00:00Z')] })), 'timing')
    const esfriou = (desde: string) => lead({ motivoPerda: 'esfriou', etapa: 'perdido', desde, eventos: [motivo('decisor', '2026-10-28T13:00:00Z')] } as Partial<CrmLead>)
    assert.equal(motivoDaPerdaDoLead(esfriou('2026-10-25T12:00:00Z')), 'decisor')
    assert.equal(motivoDaPerdaDoLead(esfriou('2026-10-29T12:00:00Z')), 'sumiu')
  })
  it('registro futuro, de outra origem ou ilegível não vale', () => {
    const futuro = motivo('preco', '2026-11-30T12:00:00Z')
    assert.equal(motivoDaPerdaDoLead(lead({ motivoPerda: 'expirou', eventos: [futuro] }), Date.parse('2026-10-29T12:00:00Z')), 'sumiu')
    assert.equal(motivoRegistrado(lead({ eventos: [{ ...motivo('preco'), origem: 'automático' as const }] })), null)
    assert.equal(motivoRegistrado(lead({ eventos: [{ ...motivo('preco'), texto: '{' }] })), null)
  })
  it('gravar passa pela lista nova: o valor antigo sai traduzido e o inventado é recusado', () => {
    assert.equal(textoDoRegistroAarr('motivo_perda', 'contato_errado'), JSON.stringify({ versao: 1, valor: 'contato_errado' }))
    assert.equal(textoDoRegistroAarr('motivo_perda', 'sem-dor'), JSON.stringify({ versao: 1, valor: 'sem_dor' }))
    assert.throws(() => textoDoRegistroAarr('motivo_perda', 'caro'))
    assert.deepEqual(lerRegistroAarr('motivo_perda', JSON.stringify({ versao: 1, valor: 'concorrente' })), { versao: 1, valor: 'ja_tem' })
  })
  it('a nota do Funil soma pelo motivo da lista e deixa o descartado à parte', () => {
    const perdidos = [
      lead({ motivoPerda: 'expirou' }), lead({ motivoPerda: 'proposta-sem-retorno' }), lead({ motivoPerda: 'recusou', eventos: [motivo('preco'), desfecho('recusou', '2026-10-28T13:00:00Z')] }),
      lead({ motivoPerda: 'recusou' }), lead({ motivoPerda: 'descartado' }), lead({ motivoPerda: 'descartado' }),
    ]
    assert.equal(resumoDosMotivos(perdidos), 'Preço 1 · Não vê necessidade 1 · Sumiu 2 · Descartado 2')
  })
  it('a Ficha diz a perda marcada pelo motivo, e a proposta vencida é saída pelo prazo', () => {
    const base = { etapa: 'perdido' as const, ganhoManual: undefined, proposta: undefined }
    assert.equal(desfechosDoLead({ ...base, motivoPerda: 'recusou', perdaManual: 'recusou', motivoDaPerda: 'timing' }).marcados[0]!.texto, 'Perdeu: não é a hora.')
    assert.equal(desfechosDoLead({ ...base, motivoPerda: 'sem-contato', perdaManual: 'sem-contato' }).marcados[0]!.texto, 'Perdeu: sem contato fácil.')
    const vencida = desfechosDoLead({ ...base, motivoPerda: 'proposta-sem-retorno', perdaManual: undefined, motivoDaPerda: 'sumiu' })
    assert.deepEqual([vencida.marcados.length, vencida.ganhar, vencida.perder, vencida.proposta], [0, true, false, true])
  })
})
