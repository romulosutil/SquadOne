import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aarrDoLead, contratosMensais, leituraAarr } from './operations/aarr'
import { cicloDoLead, textoEventoCiclo, validarTransicaoCiclo, type EventoCiclo } from './operations/ciclo-comercial'
import type { CrmLead } from './operations/types'

const agora = Date.parse('2027-01-20T18:00:00Z')
// Valores sintéticos para invariantes do ciclo; não são preços de clientes.
const proposta: EventoCiclo = { v: 1, id: 'prop-01', tipo: 'proposta', data: '2026-10-20', humano: true,
  referencia: 'P-TESTE', ofertaId: 'anuncios', versao: 1, escopo: 'Escopo fictício', prazo: 'Prazo confirmado',
  condicoes: 'Condições confirmadas na fixture', responsavel: 'Operador', valor: 10000, mensalidade: 2500 }
function lead(): CrmLead { return { id: 'prumo:ficticio', produto: 'prumo', etapa: 'contato', marcos: { enviado: '2026-10-19T12:00:00Z' }, eventos: [], links: {} } as CrmLead }
function fato(tipo: EventoCiclo['tipo'], id: string, vinculo: string, extra: Partial<EventoCiclo> = {}): EventoCiclo {
  return { v: 1, id, tipo, data: '2026-10-20', humano: true, referencia: id, vinculo, evidencia: 'Referência da fixture conferida', ...extra }
}
function anexar(l: CrmLead, e: EventoCiclo) {
  validarTransicaoCiclo(l, e, agora)
  l.eventos.push({ tipo: 'nota', origem: 'manual', fonte: 'aba CRM', rotulo: 'Nota', em: new Date(agora - 60000 + l.eventos.length * 100).toISOString(), texto: textoEventoCiclo(e, agora) })
}
function contratado(p: EventoCiclo = proposta) {
  const l = lead(); anexar(l, p); anexar(l, fato('proposta_enviada', 'env-01', p.id)); anexar(l, fato('aceite', 'aceite-01', p.id, { documento: 'Documento fictício v1' })); return l
}
function mensal() {
  const l = contratado()
  anexar(l, fato('condicao_cobranca', 'cond-mensal', 'aceite-01', { componente: 'mensal', valor: 2500, gatilho: 'aceite', condicao: 'Mensalidade contratada', vigenciaInicio: '2026-10-20' }))
  anexar(l, fato('cobranca', 'cob-mensal', 'cond-mensal', { componente: 'mensal', competencia: '2026-10', valor: 2500, vencimento: '2026-10-25', forma: 'Forma combinada' }))
  return l
}
function pagar(l: CrmLead, id: string, valor: number, referencia = id) {
  anexar(l, fato('pagamento', id, 'cob-mensal', { componente: 'mensal', competencia: '2026-10', valor, referencia }))
}
function legado(l: CrmLead, referencia: string) {
  l.eventos.push({ tipo: 'pagamento_confirmado', origem: 'manual', fonte: 'aba CRM', rotulo: 'Pagamento', em: new Date(agora - 1000 + l.eventos.length).toISOString(),
    texto: JSON.stringify({ versao: 1, oferta: 'anuncios', componente: 'mensalidade', valor_centavos: 59000, referencia, data: '2026-10-20' }) })
}

test('AARR considera somente última versão enviada da série, com referência NFKC e caixa equivalente', () => {
  const l = lead(); anexar(l, proposta); anexar(l, fato('proposta_enviada', 'env-01', proposta.id))
  const nova = { ...proposta, id: 'prop-02', versao: 2, referencia: 'ｐ-ｔｅｓｔｅ', valor: 12000 }
  anexar(l, nova); anexar(l, fato('proposta_enviada', 'env-02', nova.id))
  anexar(l, { ...nova, id: 'prop-03', versao: 3, referencia: 'p-teste', valor: 18000 })
  const r = aarrDoLead(l, agora)
  assert.equal(r.propostas.length, 2)
  assert.equal(r.propostas.find(p => p.componente === 'implantacao')?.valor_centavos, 12000)
  assert.equal(r.propostas.find(p => p.componente === 'mensalidade')?.valor_centavos, 2500)
  assert.equal(r.pagamentos.length, 0)
})

test('preparar proposta, enviar e aceitar têm marcos próprios e nenhum confirma receita', () => {
  const l = lead(); anexar(l, proposta)
  assert.equal(aarrDoLead(l, agora).propostas.length, 0)
  anexar(l, fato('proposta_enviada', 'env-01', proposta.id))
  assert.equal(aarrDoLead(l, agora).propostas.length, 2)
  anexar(l, fato('aceite', 'aceite-01', proposta.id, { documento: 'Documento fictício' }))
  const leitura = leituraAarr([l], agora)
  assert.equal(leitura.receita.pagamentos, 0)
  assert.equal(leitura.receita.valorCentavos, 0)
  assert.equal(leitura.receita.mrrCentavos, 0)
  assert.equal(cicloDoLead(l, agora).recebido, 0)
})

test('pagamento parcial entra pelo valor recebido; MRR usa mensalidade contratada e atividade confirmada', () => {
  const l = mensal(); pagar(l, 'pag-01', 1000)
  let r = leituraAarr([l], agora)
  assert.equal(r.receita.valorCentavos, 1000)
  assert.equal(r.receita.mensalidadeCentavos, 1000)
  assert.equal(r.receita.mrrCentavos, 0)
  assert.equal(contratosMensais(l, agora)[0].valorCentavos, 2500)
  assert.equal(cicloDoLead(l, agora).cobrancas[0].saldo, 1500)
  l.eventos.push({ tipo: 'retencao_3m', origem: 'manual', fonte: 'aba CRM', rotulo: 'Atividade confirmada', em: new Date(agora - 500).toISOString(),
    texto: JSON.stringify({ versao: 1, referencia: 'anuncios', inicio: '2026-10-20', data: '2027-01-20', ativa: true }) })
  r = leituraAarr([l], agora)
  assert.equal(r.receita.mrrCentavos, 2500, 'a parcela recebida não redefine o preço do contrato')
})

test('correção humana de pagamento reconstrói agregado sem apagar evidência nem contar replay em dobro', () => {
  const l = mensal(); pagar(l, 'pag-01', 1000); pagar(l, 'pag-02', 1500)
  assert.equal(leituraAarr([l], agora).receita.valorCentavos, 2500)
  l.eventos.push({ ...l.eventos.find(e => e.texto?.includes('"id":"pag-02"'))! })
  assert.equal(leituraAarr([l], agora).receita.valorCentavos, 2500)
  anexar(l, fato('correcao', 'corr-01', 'pag-01'))
  assert.equal(leituraAarr([l], agora).receita.valorCentavos, 1500)
  assert.equal(cicloDoLead(l, agora).cobrancas[0].saldo, 1000)
  assert.ok(cicloDoLead(l, agora).historico.some(e => e.id === 'pag-01'))
  assert.throws(() => anexar(l, fato('pagamento', 'pag-01', 'cob-mensal', { componente: 'mensal', competencia: '2026-10', valor: 2000 })), /Identificador/)
})

test('referência legada ativa impede recebimento de ciclo equivalente e não cria dinheiro duplicado', () => {
  const l = mensal(); legado(l, 'REC-UNICO')
  assert.throws(() => pagar(l, 'pag-01', 1000, ' ｒｅｃ-ｕｎｉｃｏ '), /histórico legado/)
  const r = leituraAarr([l], agora)
  assert.equal(r.receita.valorCentavos, 59000)
  assert.equal(r.receita.pagamentos, 1)
  assert.equal(cicloDoLead(l, agora).recebido, 0)
})

test('colisão tardia vinda da fonte é sinalizada e projeção não soma ciclo mais legado da mesma referência', () => {
  const l = mensal(); pagar(l, 'pag-01', 1000, 'REC-UNICO'); legado(l, 'rec-unico')
  assert.match(cicloDoLead(l, agora).problemas.join(), /histórico legado/)
  assert.equal(leituraAarr([l], agora).receita.valorCentavos, 59000)
  assert.equal(leituraAarr([l], agora).receita.pagamentos, 1)
})
