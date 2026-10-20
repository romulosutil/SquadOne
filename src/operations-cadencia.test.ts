import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cadenciaDoLead, diasUteisDaCadencia, lerRegistroCadencia, textoDoRegistroCadencia } from './operations/cadencia.ts'
import { notaDoAprendizado } from './operations/aprendizado-comercial.ts'
import { filaDeVenda } from './operations/proxima-venda.ts'
import type { CrmLead } from './operations/types.ts'

const sp = (dia: string, hora = '12:00') => Date.parse(`${dia}T${hora}:00-03:00`)
const iso = (dia: string) => new Date(sp(dia)).toISOString()
const proposta = (extra: Partial<CrmLead> = {}): CrmLead => ({ id: 'site:exemplo', produto: 'site', empresa: 'Empresa', etapa: 'proposta', sinal: 'proposta',
  proposta: { em: iso('2026-10-15'), data: '2026-10-15' }, marcos: {}, eventos: [], links: { whatsapp: 'https://wa.me/5511999990000' }, ...extra,
} as CrmLead)
const evento = (texto: string, em = iso('2026-10-16')) => ({ tipo: 'cadencia_enviada', origem: 'manual' as const, em, texto, rotulo: '', fonte: '' })

describe('cadência de proposta: degraus úteis e confirmação durável', () => {
  for (const [dia, estado, degrau] of [
    ['2026-10-15', 'aguardar', undefined], ['2026-10-16', 'tocar', 'dia-1'], ['2026-10-17', 'tocar', 'dia-1'],
    ['2026-10-19', 'tocar', 'dia-1'], ['2026-10-20', 'tocar', 'dia-3'], ['2026-10-25', 'expirar', undefined],
  ] as const) it(`${dia}: ${estado} ${degrau ?? ''}`, () => {
    const r = cadenciaDoLead(proposta(), sp(dia))!
    assert.equal(r.estado, estado)
    assert.equal(r.registro?.degrau, degrau)
  })
  it('fim de semana não acrescenta dias úteis', () => assert.equal(diasUteisDaCadencia(sp('2026-10-16'), sp('2026-10-19')), 1))
  it('Enviei do primeiro degrau persiste na segunda-feira; só o terceiro libera novo toque', () => {
    const l = proposta()
    const primeiro = cadenciaDoLead(l, sp('2026-10-16'))!.registro!
    l.eventos.push(evento(textoDoRegistroCadencia(primeiro)))
    assert.equal(cadenciaDoLead(l, sp('2026-10-19'))!.estado, 'aguardar')
    assert.equal(cadenciaDoLead(l, sp('2026-10-20'))!.registro!.degrau, 'dia-3')
    l.eventos.push(evento(textoDoRegistroCadencia(cadenciaDoLead(l, sp('2026-10-20'))!.registro!)))
    assert.equal(cadenciaDoLead(l, sp('2026-10-21'))!.estado, 'aguardar')
  })
  it('os dias contam do envio real e não da anotação posterior', () => {
    const l = proposta({ proposta: { em: iso('2026-10-19'), data: '2026-10-15' } })
    const c = cadenciaDoLead(l, sp('2026-10-20'))!
    assert.equal(c.registro!.degrau, 'dia-3')
    assert.equal(c.origem, iso('2026-10-19'))
  })
  it('proposta nova não herda confirmação da proposta anterior', () => {
    const antigo = cadenciaDoLead(proposta(), sp('2026-10-16'))!.registro!
    const l = proposta({ proposta: { em: iso('2026-10-19'), data: '2026-10-19' }, eventos: [evento(textoDoRegistroCadencia(antigo))] })
    assert.equal(cadenciaDoLead(l, sp('2026-10-20'))!.estado, 'tocar')
  })
  it('resposta humana posterior e compromisso futuro preservam cobrança e expiração', () => {
    for (const extra of [
      { resposta: { tipo: 'neutra', trecho: 'vou conferir', em: iso('2026-10-16') } },
      { proximoPasso: { texto: 'retomar no mês que vem', data: '2026-11-01', registradoEm: iso('2026-10-16') } },
    ] as Partial<CrmLead>[]) assert.equal(cadenciaDoLead(proposta(extra), sp('2026-10-26'))!.estado, 'preservar')
  })
  it('pausa explícita não é ignorada no décimo dia', () => {
    const texto = notaDoAprendizado({ fato: 'pediu tempo', hipotese: 'retorna depois', teste: 'esperar resposta', resultado: 'em-teste', pausarAteResposta: true })
    const l = proposta({ eventos: [{ ...evento(texto), tipo: 'nota' }] })
    assert.equal(cadenciaDoLead(l, sp('2026-10-26'))!.estado, 'preservar')
  })
})

describe('cadência de conversa: só um toque e revisão no sétimo dia', () => {
  const conversa = (): CrmLead => proposta({ etapa: 'contato', proposta: undefined,
    conversa: { desde: iso('2026-10-15'), mensagens: 2, ultimaEntrada: iso('2026-10-15'), ultimaSaida: iso('2026-10-16'), ultima: { direcao: 'saida', em: iso('2026-10-16'), trecho: 'resposta' } },
  })
  it('toque no segundo útil, sem rearmar depois de uma nova saída nossa', () => {
    const l = conversa()
    assert.equal(cadenciaDoLead(l, sp('2026-10-19'))!.estado, 'aguardar')
    const c = cadenciaDoLead(l, sp('2026-10-20'))!
    assert.equal(c.estado, 'tocar')
    l.eventos.push(evento(textoDoRegistroCadencia(c.registro!), iso('2026-10-20')))
    l.conversa!.ultimaSaida = iso('2026-10-20')
    assert.equal(cadenciaDoLead(l, sp('2026-10-22'))!.estado, 'aguardar')
    assert.equal(cadenciaDoLead(l, sp('2026-10-23'))!.estado, 'revisar')
    l.conversa!.ultimaEntrada = iso('2026-10-23')
    assert.equal(cadenciaDoLead(l, sp('2026-10-23')), null, 'resposta nova é para responder, não cobrar')
  })
  it('dia zero não entra na fila como cobrança de proposta', () => {
    const l = proposta()
    assert.deepEqual(filaDeVenda({ leads: [l], hoje: [{ id: 'proposta', titulo: '', explicacao: '', itens: [{ leadId: l.id, acao: 'Cobrar legado', detalhe: '', ordem: 1, links: [] }] }] }, { primeiroLiberado: false, agora: sp('2026-10-15') }), [])
  })
  it('registros incompletos, sem origem ou com degrau de outra cadência não valem', () => {
    for (const v of ['{', '{}', JSON.stringify({ versao: 1, tipo: 'proposta', origem: iso('2026-10-15'), degrau: 'dia-2' })]) assert.equal(lerRegistroCadencia(v), null)
  })
  for (const etapa of ['contato', 'proposta'] as const) for (const tipo of ['negativa', 'exclusao'] as const) it(`${etapa}/${tipo}: recusa prevalece sobre cadência e combinado antigo`, () => {
    const l = conversa()
    Object.assign(l, { etapa, proposta: etapa === 'proposta' ? proposta().proposta : undefined,
      resposta: { tipo, trecho: 'não quero receber', em: iso('2026-10-15') },
      proximoPasso: { texto: 'retomar o assunto', data: '2026-10-14', registradoEm: iso('2026-10-14') } })
    assert.equal(cadenciaDoLead(l, sp('2026-10-26')), null)
    const fila = filaDeVenda({ leads: [l], hoje: [{ id: 'proximo', titulo: '', explicacao: '', itens: [{ leadId: l.id, acao: 'Retomar', detalhe: '', ordem: 1, links: [{ rotulo: 'WhatsApp', url: l.links.whatsapp! }] }] }] }, { primeiroLiberado: false, agora: sp('2026-10-26') })
    assert.equal(fila.length, 1)
    assert.equal(fila[0]!.tipo, 'desfecho')
    assert.equal(fila[0]!.anota, 'recusou')
    if (tipo === 'exclusao') assert.equal(fila[0]!.link, undefined)
    else assert.match(fila[0]!.rascunho!, /^Obrigado pelo retorno/)
  })
})
