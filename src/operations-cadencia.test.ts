import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TOQUES_DA_PROPOSTA, VALIDADE_DA_PROPOSTA_DIAS, cadenciaDoLead, degrauDaProposta, diasUteisDaCadencia, lerRegistroCadencia, textoDaCadenciaConfirmada, textoDoRegistroCadencia, validadeDaProposta } from './operations/cadencia.ts'
import { textoEventoCiclo, type EventoCiclo } from './operations/ciclo-comercial.ts'
import { notaDoAprendizado } from './operations/aprendizado-comercial.ts'
import { acaoDoLead, filaDeVenda } from './operations/proxima-venda.ts'
import type { CrmLead } from './operations/types.ts'

const sp = (dia: string, hora = '12:00') => Date.parse(`${dia}T${hora}:00-03:00`)
const iso = (dia: string) => new Date(sp(dia)).toISOString()
const proposta = (extra: Partial<CrmLead> = {}): CrmLead => ({ id: 'site:exemplo', produto: 'site', empresa: 'Empresa', etapa: 'proposta', sinal: 'proposta',
  proposta: { em: iso('2026-10-15'), data: '2026-10-15' }, marcos: {}, eventos: [], links: { whatsapp: 'https://wa.me/5511999990000' }, ...extra,
} as CrmLead)
const evento = (texto: string, em = iso('2026-10-16')) => ({ tipo: 'cadencia_enviada', origem: 'manual' as const, em, texto, rotulo: '', fonte: '' })

describe('cadência de proposta (28/10/2026): D+1 útil, D+4 úteis, D+8 e D+10 corridos', () => {
  // Proposta na quinta 15/10/2026: o fim de semana 17–18 não conta dia útil, mas conta dia corrido.
  for (const [dia, estado, degrau] of [
    ['2026-10-15', 'aguardar', undefined], ['2026-10-16', 'tocar', 'dia-1'], ['2026-10-17', 'tocar', 'dia-1'],
    ['2026-10-18', 'tocar', 'dia-1'], ['2026-10-19', 'tocar', 'dia-1'], ['2026-10-20', 'tocar', 'dia-1'],
    ['2026-10-21', 'tocar', 'dia-4'], ['2026-10-22', 'tocar', 'dia-4'], ['2026-10-23', 'tocar', 'dia-8'],
    ['2026-10-24', 'tocar', 'dia-8'], ['2026-10-25', 'expirar', undefined], ['2026-10-30', 'expirar', undefined],
  ] as const) it(`proposta de quinta, ${dia}: ${estado} ${degrau ?? ''}`, () => {
    const r = cadenciaDoLead(proposta(), sp(dia))!
    assert.equal(r.estado, estado)
    assert.equal(r.registro?.degrau, degrau)
  })
  // Proposta na sexta 16/10: o fim de semana logo depois empurra os degraus úteis; o 8º corrido cai no sábado.
  for (const [dia, esperado] of [
    ['2026-10-17', null], ['2026-10-18', null], ['2026-10-19', 'dia-1'], ['2026-10-21', 'dia-1'],
    ['2026-10-22', 'dia-4'], ['2026-10-23', 'dia-4'], ['2026-10-24', 'dia-8'], ['2026-10-25', 'dia-8'], ['2026-10-26', 'expirar'],
  ] as const) it(`degrauDaProposta, sexta → ${dia}: ${esperado ?? 'nenhum'}`, () => assert.equal(degrauDaProposta(sp('2026-10-16'), sp(dia)), esperado))
  it('fim de semana não acrescenta dias úteis', () => assert.equal(diasUteisDaCadencia(sp('2026-10-16'), sp('2026-10-19')), 1))
  it('a validade é de 10 dias corridos contando o envio: vale até o D+9', () => {
    assert.equal(VALIDADE_DA_PROPOSTA_DIAS, 10)
    assert.equal(validadeDaProposta(sp('2026-10-15')), '24/10')
    assert.equal(validadeDaProposta(sp('2026-12-28')), '06/01')
  })
  it('cada toque tem o seu objetivo, sem preço, sem "R$" e sem link', () => {
    for (const [degrau, objetivo] of [['dia-1', /dúvida.*decide junto/], ['dia-4', /10 minutos.*quem decide junto/], ['dia-8', /vale até 24\/10.*encerro/]] as const) {
      const texto = TOQUES_DA_PROPOSTA[degrau].mensagem('24/10')
      assert.match(texto, objetivo, degrau)
      assert.doesNotMatch(texto, /R\$|https?:|preço|promo/i, degrau)
      assert.match(TOQUES_DA_PROPOSTA[degrau].tatica, /Sem (reenviar )?preço nem link/, degrau)
    }
  })
  it('Enviei de um degrau persiste até o próximo; cada degrau toca uma vez', () => {
    const l = proposta()
    const primeiro = cadenciaDoLead(l, sp('2026-10-16'))!.registro!
    l.eventos.push(evento(textoDoRegistroCadencia(primeiro)))
    for (const dia of ['2026-10-19', '2026-10-20']) assert.equal(cadenciaDoLead(l, sp(dia))!.estado, 'aguardar', dia)
    const quarto = cadenciaDoLead(l, sp('2026-10-21'))!.registro!
    assert.equal(quarto.degrau, 'dia-4')
    l.eventos.push(evento(textoDoRegistroCadencia(quarto), iso('2026-10-21')))
    assert.equal(cadenciaDoLead(l, sp('2026-10-22'))!.estado, 'aguardar')
    const oitavo = cadenciaDoLead(l, sp('2026-10-23'))!.registro!
    assert.equal(oitavo.degrau, 'dia-8')
    l.eventos.push(evento(textoDoRegistroCadencia(oitavo), iso('2026-10-23')))
    assert.equal(cadenciaDoLead(l, sp('2026-10-24'))!.estado, 'aguardar')
    assert.equal(cadenciaDoLead(l, sp('2026-10-25'))!.estado, 'expirar')
  })
  it('o "dia-3" confirmado na cadência antiga vale como o toque do 4º dia útil e continua legível', () => {
    const antigo = JSON.stringify({ versao: 1, tipo: 'proposta', origem: iso('2026-10-15'), degrau: 'dia-3' })
    assert.equal(lerRegistroCadencia(antigo)?.degrau, 'dia-3')
    assert.equal(textoDaCadenciaConfirmada(lerRegistroCadencia(antigo)), 'Último retorno da proposta confirmado.')
    const l = proposta({ eventos: [evento(antigo, iso('2026-10-20'))] })
    assert.equal(cadenciaDoLead(l, sp('2026-10-21'))!.estado, 'aguardar')
    assert.equal(cadenciaDoLead(l, sp('2026-10-23'))!.registro!.degrau, 'dia-8')
  })
  it('os dias contam do envio real e não da anotação posterior', () => {
    const l = proposta({ proposta: { em: iso('2026-10-21'), data: '2026-10-15' } })
    const c = cadenciaDoLead(l, sp('2026-10-21'))!
    assert.equal(c.registro!.degrau, 'dia-4')
    assert.equal(c.origem, iso('2026-10-21'))
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

describe('cadência da proposta do ciclo comercial (proposta versionada, 28/10/2026)', () => {
  const fato = (tipo: EventoCiclo['tipo'], id: string, data: string, extra: Partial<EventoCiclo> = {}): EventoCiclo => ({ v: 1, id, tipo, data, humano: true, referencia: id, ...extra })
  // Valores sintéticos da fixture; não são preços de clientes.
  const versao = fato('proposta', 'prop-01', '2026-10-15', { referencia: 'P-TESTE', ofertaId: 'encontrado', versao: 1, escopo: 'Escopo fictício', prazo: 'Prazo fictício',
    condicoes: 'Condições fictícias', responsavel: 'Operador', valor: 10000, mensalidade: 1000 })
  const nota = (e: EventoCiclo, dia: string) => ({ tipo: 'nota', origem: 'manual' as const, em: iso(dia), texto: textoEventoCiclo(e, sp(dia)), rotulo: '', fonte: '' })
  const doCiclo = (...extra: ReturnType<typeof nota>[]): CrmLead => proposta({ proposta: undefined, etapa: 'proposta',
    eventos: [nota(versao, '2026-10-15'), nota(fato('proposta_enviada', 'env-01', '2026-10-15', { vinculo: 'prop-01', evidencia: 'Print da conversa' }), '2026-10-15'), ...extra] })
  it('conta da última versão enviada e chega ao vencimento no D+10', () => {
    const l = doCiclo()
    for (const [dia, estado, degrau] of [['2026-10-16', 'tocar', 'dia-1'], ['2026-10-21', 'tocar', 'dia-4'], ['2026-10-23', 'tocar', 'dia-8'], ['2026-10-25', 'expirar', undefined]] as const) {
      const c = cadenciaDoLead(l, sp(dia))!
      assert.equal(c.estado, estado, dia)
      assert.equal(c.registro?.degrau, degrau, dia)
      assert.equal(c.origem, iso('2026-10-15'))
    }
  })
  it('com aceite registrado a decisão saiu: sem cadência', () => {
    const l = doCiclo(nota(fato('aceite', 'aceite-01', '2026-10-16', { vinculo: 'prop-01', evidencia: 'Mensagem do cliente', documento: 'Documento fictício' }), '2026-10-16'))
    assert.equal(cadenciaDoLead(l, sp('2026-10-21')), null)
  })
  it('proposta só em rascunho (sem envio) não tem cadência nenhuma', () => {
    const l = proposta({ proposta: undefined, etapa: 'proposta', eventos: [nota(versao, '2026-10-15')] })
    assert.equal(cadenciaDoLead(l, sp('2026-10-21')), null)
  })
  it('na fila o toque do degrau substitui o cartão de acompanhar a decisão, com o texto do degrau', () => {
    const l = { ...doCiclo(), proposta: { em: iso('2026-10-15'), data: '2026-10-15' } }
    const visao = { leads: [l], hoje: [] }
    const fila = filaDeVenda(visao, { primeiroLiberado: false, agora: sp('2026-10-21') })
    assert.deepEqual(fila.map(a => a.chave), [`${l.id}|cadencia|proposta|${iso('2026-10-15')}|dia-4`])
    assert.equal(fila[0]!.rascunho, TOQUES_DA_PROPOSTA['dia-4'].mensagem('24/10'))
    assert.equal(fila[0]!.titulo, 'Convide Empresa para 10 minutos com quem decide')
    assert.equal(JSON.parse(fila[0]!.textoDoRegistro!).degrau, 'dia-4')
    // Com o toque confirmado, o cartão do ciclo comercial volta a guiar até o próximo degrau.
    l.eventos.push(evento(fila[0]!.textoDoRegistro!, iso('2026-10-21')))
    assert.deepEqual(filaDeVenda(visao, { primeiroLiberado: false, agora: sp('2026-10-22') }).map(a => a.chave), [`${l.id}|ciclo-comercial`])
    assert.equal(acaoDoLead(visao, l.id, sp('2026-10-23'))?.contexto, 'Proposta: 8º dia, vale até 24/10')
  })
})
