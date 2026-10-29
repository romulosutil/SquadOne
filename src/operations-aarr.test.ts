import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { aarrDoLead, chaveDoPagamento, contratosMensais, indicacaoPendente, leituraAarr, lerRegistroAarr, opcoesDeterministicasDeReceita, terceiroMes, textoDoRegistroAarr, textoDoRegistroReceita, type RegistroReceita } from './operations/aarr'
import { CARDAPIO } from './operations/colinha'
import { spicedVazio } from './operations/spiced'
import { filaDeVenda } from './operations/proxima-venda'
import type { CrmLead, CrmEvento } from './operations/types'

const AGORA = Date.parse('2026-10-19T15:00:00Z')
const lead = (produto: CrmLead['produto'] = 'site', extra: Partial<CrmLead> = {}): CrmLead => ({ id: `${produto}:AAR-001`, produto, empresa: 'Empresa', etapa: 'contato', marcos: {}, eventos: [], links: {}, ...extra } as CrmLead)
const evento = (tipo: string, texto: string, em = '2026-10-19T14:00:00Z'): CrmEvento => ({ tipo, texto, em, origem: 'manual', rotulo: '', fonte: '' })
const opcao = (produto: CrmLead['produto'], id = 'encontrado:mensalidade', qtd?: number) => opcoesDeterministicasDeReceita(lead(produto), qtd).find(o => o.id === id)!
const pagamento = (ref = 'recibo-1', data = '2026-10-19', id = 'encontrado:mensalidade') => evento('pagamento_confirmado', textoDoRegistroReceita('pagamento_confirmado', opcao('prumo', id), ref, data))
const registroDo = (e: CrmEvento) => lerRegistroAarr(e.tipo, e.texto)! as RegistroReceita

describe('catálogo comercial determinístico e separado de histórico livre', () => {
  it('espelho acompanha CARDAPIO, duas plataformas somam590+390, Fonte50/50', () => {
    const tabela = opcoesDeterministicasDeReceita(lead('prumo'))
    const valor = (id: string) => tabela.find(o => o.id === id)!.valorCentavos
    const reais = (s: string) => Number(/R\$ ([\d.]+)/.exec(s)![1]!.replace(/\./g, '')) * 100
    for (const s of CARDAPIO.filter(s => !['raio-x','mapa'].includes(s.id))) {
      const mensal = /\/mês/.test(s.preco)
      assert.equal(valor(`${s.id}:${mensal ? 'mensalidade' : 'implantacao'}`), reais(s.preco), s.id)
      if (s.mensal) assert.equal(valor(`${s.id}:mensalidade`), reais(s.mensal), s.id)
    }
    assert.equal(valor('anuncios-duas:mensalidade'), reais(CARDAPIO.find(s => s.id === 'anuncios')!.preco) + reais(CARDAPIO.find(s => s.id === 'anuncios')!.condicao!))
    assert.match(CARDAPIO.find(s => s.id === 'fonte')!.condicao!, /50\/50/)
    assert.equal(valor('fonte:parcela-1') + valor('fonte:parcela-2'), valor('fonte:implantacao'))
  })
  for (const [qtd, centavos] of [[1,3900],[15,58500],[16,61700],[20,74500],[40,138500],[41,141000]]) it(`Iris ${qtd} fichas marginal`, () => {
    const o = opcao('iris', 'iris:mensalidade', qtd)
    assert.equal(o.valorCentavos, centavos)
    assert.equal(registroDo(evento('pagamento_confirmado', textoDoRegistroReceita('pagamento_confirmado', o, 'IRIS', '2026-10-19'))).valor_centavos, centavos)
  })
  it('Estampa sem preço, Plus por oferta e Iris exige quantidade inteira', () => {
    assert.deepEqual(opcoesDeterministicasDeReceita(lead('estampa')), [])
    for (const q of [undefined,0,-1,1.2,Infinity]) assert.deepEqual(opcoesDeterministicasDeReceita(lead('iris'), q), [])
    assert.equal(opcoesDeterministicasDeReceita(lead('plus', { plus: { oferta: 'iris' } as CrmLead['plus'] }), 20)[0]!.valorCentavos, 74500)
    assert.deepEqual(opcoesDeterministicasDeReceita(lead('plus', { plus: { oferta: 'estampa' } as CrmLead['plus'] })), [])
  })
  it('não transforma90/mês histórico nem preços/datas inventados em receita', () => {
    const base = registroDo(pagamento())
    for (const extra of [{ valor_centavos: 9000 },{ data: '2026-02-30' },{ data: '2026-10-20' },{ referencia: '' },{ quantidade: 2 },{ oferta: 'estampa' }]) assert.equal(lerRegistroAarr('pagamento_confirmado', JSON.stringify({ ...base, ...extra }), AGORA), null)
    assert.equal(leituraAarr([lead('site', { etapa: 'ganho', eventos: [evento('proposta', '90/mês')] })], AGORA).receita.pagamentos, 0)
  })
})

describe('pagamentos deduplicados, reversíveis e sem eventos futuros', () => {
  it('reenvio, releitura e caixa da referência contam uma vez; componentes reais separados', () => {
    const p = pagamento()
    const l = lead('prumo', { eventos: [p, p, pagamento(' RECIBO-1 '), pagamento('recibo-1','2026-10-19','encontrado:implantacao')] })
    const r = leituraAarr([l], AGORA)
    assert.equal(r.receita.pagamentos, 1, 'uma transferência/recibo com dois componentes')
    assert.equal(r.estrelaGuia.pagamentos, 1)
    assert.equal(r.receita.componentes, 2)
    assert.equal(r.receita.valorCentavos, 72900)
    assert.equal(r.receita.implantacaoCentavos, 69000)
    assert.equal(r.receita.mensalidadeCentavos, 3900)
    assert.equal(r.receita.mrrCentavos, 0, 'recebimento não é atividade mensal confirmada')
  })
  it('desfaz referência200+chave longa e permite correção humana depois', () => {
    const p = pagamento('x'.repeat(200)), chave = chaveDoPagamento(registroDo(p))
    assert.ok(chave.length > 200)
    const undo = evento('receita_desfeita', textoDoRegistroAarr('receita_desfeita', { tipo: 'pagamento_confirmado', referencia: chave, data: '2026-10-19' }), '2026-10-19T14:01:00Z')
    const l = lead('site', { eventos: [p, undo] })
    assert.equal(leituraAarr([l], AGORA).receita.pagamentos, 0)
    l.eventos.push({ ...p, em: '2026-10-19T14:02:00Z' })
    assert.equal(leituraAarr([l], AGORA).receita.pagamentos, 1)
  })
  it('não soma totalFonte novamente com parcelas nem recebe futuro', () => {
    const l = lead('prumo', { eventos: [pagamento('fonte','2026-10-19','fonte:parcela-1'), pagamento('fonte','2026-10-19','fonte:implantacao'), pagamento('fonte','2026-10-19','fonte:parcela-2'), { ...pagamento('futuro'), em: '2026-10-20T12:00:00Z' }] })
    assert.equal(leituraAarr([l], AGORA).receita.valorCentavos, 150000)
  })
  it('semana começa segunda00SP, soma todas5linhas e respeita data real do recibo', () => {
    const todos = ['site','prumo','iris','estampa','plus'].map((p, i) => {
      const l = lead(p as CrmLead['produto'], { plus: p === 'plus' ? { oferta: 'site' } as CrmLead['plus'] : undefined })
      const o = opcoesDeterministicasDeReceita(l, 1)[0]
      if (o) l.eventos.push(evento('pagamento_confirmado', textoDoRegistroReceita('pagamento_confirmado', o, `ref${i}`, '2026-10-19')))
      return l
    })
    assert.equal(leituraAarr(todos, AGORA).estrelaGuia.pagamentos, 4)
    assert.equal(leituraAarr(todos, Date.parse('2026-10-19T02:59:59Z')).estrelaGuia.pagamentos, 0)
    assert.equal(leituraAarr(todos, AGORA).estrelaGuia.inicioSemana, '2026-10-19')
    assert.equal(leituraAarr([lead('site', { eventos: [pagamento('historia','2026-10-18')] })], AGORA).estrelaGuia.pagamentos, 0)
  })
})

describe('retenção e indicação explícitas', () => {
  for (const [inicio, fim] of [['2026-01-31','2026-03-31'],['2025-11-30','2026-01-30'],['2026-07-19','2026-09-19'],['2025-12-31','2026-02-28'],['2023-12-31','2024-02-29']]) it(`terceiro mês calendário ${inicio}`, () => assert.equal(terceiroMes(inicio!), fim))
  it('retenção entra no terceiro mês, sem esperar completar três meses', () => {
    const r = { versao: 1, referencia: 'encontrado', inicio: '2026-01-31', data: '2026-03-31', ativa: true }
    assert.ok(lerRegistroAarr('retencao_3m', JSON.stringify(r), AGORA))
    assert.equal(lerRegistroAarr('retencao_3m', JSON.stringify({ ...r, data: '2026-03-30' }), AGORA), null)
  })
  it('3recibos mensais refs diferentes =1contrato,1ativa; sem confirmação não é retido', () => {
    const l = lead('site', { eventos: [pagamento('julho','2026-07-19'), pagamento('agosto','2026-08-19'), pagamento('setembro','2026-09-19')] })
    assert.equal(contratosMensais(l, AGORA).length, 1)
    assert.deepEqual(leituraAarr([l], AGORA).retencao, { elegiveis: 1, ativas: 0 })
    l.eventos.push(evento('retencao_3m', textoDoRegistroAarr('retencao_3m', { referencia: 'encontrado', inicio: '2026-07-19', data: '2026-10-19', ativa: true })))
    assert.deepEqual(leituraAarr([l], AGORA).retencao, { elegiveis: 1, ativas: 1 })
    assert.equal(leituraAarr([l], AGORA).receita.mrrCentavos, 3900)
    const orfa = lead('site', { eventos: [l.eventos.at(-1)!] })
    assert.deepEqual(leituraAarr([orfa], AGORA).retencao, { elegiveis: 0, ativas: 0 })
    l.eventos.push(evento('retencao_3m', textoDoRegistroAarr('retencao_3m', { referencia: 'encontrado', inicio: '2026-07-19', data: '2026-10-19', ativa: false }), '2026-10-19T14:02:00Z'))
    assert.equal(leituraAarr([l], AGORA).receita.mrrCentavos, 0)
  })
  it('indicação uma vez porlead aos30dias, não por recibo mensal; reversão retira ação', () => {
    const l = lead('site', { etapa: 'ganho', eventos: [pagamento('setembro','2026-09-19'), pagamento('outubro','2026-10-19')] })
    assert.equal(indicacaoPendente(l, AGORA - 86400_000), undefined)
    const p = indicacaoPendente(l, AGORA)!
    assert.ok(p)
    assert.equal(filaDeVenda({ leads: [l], hoje: [] }, { primeiroLiberado: false, agora: AGORA })[0]!.anota, 'indicacao_pedida')
    l.eventos.push(evento('indicacao_pedida', textoDoRegistroAarr('indicacao_pedida', { referencia: p.chave, data: '2026-10-19' })))
    assert.equal(indicacaoPendente(l, AGORA + 40 * 86400_000), undefined)
    const outro = lead('site', { eventos: [pagamento('setembro','2026-09-19'), evento('receita_desfeita', textoDoRegistroAarr('receita_desfeita', { tipo: 'pagamento_confirmado', referencia: p.chave, data: '2026-10-19' }), '2026-10-19T14:02:00Z')] })
    assert.equal(indicacaoPendente(outro, AGORA), undefined)
  })
})

it('aquisição30dias preserva quente antigo+SPICEDnovo; bot posterior não apaga humano e proposta isolada não qualifica', () => {
  const qual = { ...spicedVazio(), dor: 'dor', impacto: 'impacto', decisao: { decisor_confirmado: 'sim' as const, quem: '', como_paga: '' } }
  const base = lead('site', { marcos: { enviado: '2026-10-15T12:00:00Z', respondeu: '2026-10-16T12:00:00Z' }, resposta: { tipo: 'interesse', em: '2026-10-16T12:00:00Z', trecho: 'quero ver' }, spiced: qual })
  const botDepois = lead('site', { ...base, id: 'site:botdepois', resposta: { tipo: 'bot', trecho: 'robô', em: '2026-10-19T10:00:00Z' }, conversa: { desde: '2026-10-15T10:00:00Z', mensagens: 3, ultimaEntrada: '2026-10-16T12:00:00Z', ultima: { direcao: 'entrada', em: '2026-10-19T10:00:00Z', trecho: 'robo', papel: 'robo' } } })
  const isolada = lead('site', { ...base, id: 'site:proposta', etapa: 'proposta', resposta: { tipo: 'neutra', trecho: 'oi', em: '2026-10-16T12:00:00Z' } })
  const futuro = lead('site', { ...base, marcos: { enviado: '2026-10-20T12:00:00Z', respondeu: '2026-10-20T13:00:00Z' } })
  const r = leituraAarr([base,botDepois,isolada,futuro], AGORA)
  assert.deepEqual(r.aquisicao, { enviados: 3, respostas: 3 })
  assert.deepEqual(r.ativacao, { respostas: 3, qualificados: 1 })
  assert.equal(r.receita.pagamentos, 0)
  assert.equal(r.historicoNaoMedido, true)
  const respostaFutura = { ...botDepois, resposta: { tipo: 'interesse' as const, trecho: 'futuro', em: '2026-10-20T12:00:00Z' } }
  assert.equal(leituraAarr([respostaFutura], AGORA).aquisicao.respostas, 1, 'futuro é ignorado sem apagar a entrada humana anterior')
})

describe('origem, motivo da perda e valor de proposta na leitura AARRR (Fase 4, 19/10/2026)', () => {
  const envio = '2026-10-10T12:00:00Z'
  const origem = (valor: string, em = '2026-10-19T13:00:00Z') => evento('origem', textoDoRegistroAarr('origem', valor), em)
  const motivo = (valor: string) => evento('motivo_perda', textoDoRegistroAarr('motivo_perda', valor))
  const proposta = (ref: string, id = 'encontrado:implantacao', data = '2026-10-19') => evento('valor_proposta', textoDoRegistroReceita('valor_proposta', opcao('prumo', id), ref, data))
  const respondido = (id: string, eventos: CrmEvento[], extra: Partial<CrmLead> = {}) => lead('site', {
    id: `site:${id}`, marcos: { enviado: envio, respondeu: '2026-10-11T12:00:00Z' }, resposta: { tipo: 'neutra', trecho: 'oi', em: '2026-10-11T12:00:00Z' },
    conversa: { desde: envio, mensagens: 2, ultimaEntrada: '2026-10-11T12:00:00Z', ultima: { direcao: 'entrada', em: '2026-10-11T12:00:00Z', trecho: 'oi' } }, eventos, ...extra,
  } as Partial<CrmLead>)

  it('sem nenhum registro: tudo em "sem-origem", sem motivo, sem proposta, e nenhum zero vira taxa', () => {
    const r = leituraAarr([respondido('a', [])], AGORA)
    assert.deepEqual(r.canais, { linhas: [{ canal: 'sem-origem', enviados: 1, respostas: 1, ativados: 0, pagamentos: 0, taxaDeResposta: null }], comOrigem: 0 })
    assert.deepEqual(r.perdas, { perdidos: 0, comMotivo: 0, porMotivo: [] })
    assert.deepEqual(r.propostas, { registros: 0, leads: 0, implantacaoCentavos: 0, mensalidadeCentavos: 0, semValor: 0 })
    assert.deepEqual(leituraAarr([], AGORA).canais, { linhas: [], comOrigem: 0 })
  })

  it('agrega por origem registrada, mantém "sem origem" à parte e só dá taxa com a amostra mínima', () => {
    const doCacador = Array.from({ length: 10 }, (_, i) => respondido(`c${i}`, [origem('cacador')], i < 4 ? {} : { resposta: undefined, conversa: undefined, marcos: { enviado: envio } }))
    const indicado = respondido('i', [origem('indicacao'), pagamento('rec-i')])
    const semOrigem = respondido('s', [])
    const r = leituraAarr([...doCacador, indicado, semOrigem], AGORA)
    const linha = (c: string) => r.canais.linhas.find(l => l.canal === c)!
    assert.deepEqual(linha('cacador'), { canal: 'cacador', enviados: 10, respostas: 4, ativados: 0, pagamentos: 0, taxaDeResposta: 0.4 })
    assert.equal(linha('indicacao').taxaDeResposta, null, '1 enviado: sem taxa')
    assert.equal(linha('indicacao').pagamentos, 1)
    assert.equal(linha('sem-origem').enviados, 1)
    assert.equal(r.canais.comOrigem, 11)
    assert.deepEqual(r.canais.linhas.map(l => l.canal), ['cacador', 'indicacao', 'sem-origem'], 'ordem fixa; linha sem movimento não aparece')
  })

  it('a última origem registrada vale, e origem de evento futuro ou fora do catálogo é ignorada', () => {
    const l = respondido('o', [origem('cacador'), origem('plus', '2026-10-19T14:30:00Z'), origem('anuncio', '2026-10-20T12:00:00Z'), evento('origem', JSON.stringify({ versao: 1, valor: 'tiktok' }))])
    const r = leituraAarr([l], AGORA)
    assert.deepEqual(r.canais.linhas.map(x => x.canal), ['plus'])
  })

  it('motivo da perda só entre os Perdidos de venda; o registrado manda e o automático entra traduzido (28/10/2026)', () => {
    const perdido = (id: string, eventos: CrmEvento[], motivoPerda = 'expirou') => lead('site', { id: `site:${id}`, etapa: 'perdido', motivoPerda, eventos } as Partial<CrmLead>)
    const antigo = evento('motivo_perda', JSON.stringify({ versao: 1, valor: 'concorrente' }))
    const r = leituraAarr([perdido('1', [motivo('preco')]), perdido('2', [motivo('preco')]), perdido('3', [motivo('timing')]), perdido('4', []), perdido('5', [antigo]),
      perdido('d', [], 'descartado'), lead('site', { id: 'site:aberto', eventos: [motivo('sumiu')] })], AGORA)
    assert.deepEqual(r.perdas, { perdidos: 5, comMotivo: 4, porMotivo: [{ motivo: 'preco', quantidade: 2, registrados: 2 }, { motivo: 'timing', quantidade: 1, registrados: 1 },
      { motivo: 'ja_tem', quantidade: 1, registrados: 1 }, { motivo: 'sumiu', quantidade: 1, registrados: 0 }] })
    assert.deepEqual(leituraAarr([perdido('x', [])], AGORA).perdas, { perdidos: 1, comMotivo: 0, porMotivo: [{ motivo: 'sumiu', quantidade: 1, registrados: 0 }] })
    assert.deepEqual(leituraAarr([lead('site', { id: 'site:y', etapa: 'perdido', eventos: [] } as Partial<CrmLead>)], AGORA).perdas, { perdidos: 1, comMotivo: 0, porMotivo: [{ motivo: 'sem-motivo', quantidade: 1, registrados: 0 }] })
  })

  it('soma só o valor de proposta registrado (cardápio), separa implantação de mensalidade e conta quem está em Proposta sem valor', () => {
    const a = lead('prumo', { id: 'prumo:a', eventos: [proposta('p1'), proposta('p1'), proposta('p2', 'encontrado:mensalidade')] })
    const b = lead('prumo', { id: 'prumo:b', etapa: 'proposta', eventos: [] })
    const c = lead('prumo', { id: 'prumo:c', etapa: 'proposta', eventos: [proposta('p3', 'respondido:implantacao')] })
    const antiga = lead('prumo', { id: 'prumo:d', eventos: [proposta('p4', 'encontrado:implantacao', '2026-10-18')] })
    const r = leituraAarr([a, b, c, antiga], AGORA).propostas
    assert.deepEqual(r, { registros: 3, leads: 2, implantacaoCentavos: 69000 + 240000, mensalidadeCentavos: 3900, semValor: 1 })
  })

  it('desfazer o valor da proposta o tira da soma', () => {
    const p = proposta('p1')
    const chave = chaveDoPagamento(registroDo(p))
    const undo = evento('receita_desfeita', textoDoRegistroAarr('receita_desfeita', { tipo: 'valor_proposta', referencia: chave, data: '2026-10-19' }), '2026-10-19T14:01:00Z')
    assert.equal(leituraAarr([lead('prumo', { eventos: [p, undo] })], AGORA).propostas.registros, 0)
  })

  it('Estamparia não ganha valor de proposta (preço pendente) e nada em Finanças entra', () => {
    const e = lead('estampa', { etapa: 'proposta', eventos: [] })
    assert.deepEqual(leituraAarr([e], AGORA).propostas, { registros: 0, leads: 0, implantacaoCentavos: 0, mensalidadeCentavos: 0, semValor: 1 })
  })
})
