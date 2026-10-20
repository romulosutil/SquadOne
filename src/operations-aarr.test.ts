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
