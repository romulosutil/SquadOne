import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lerSaidaDoCopiloto, lerSugestaoSpiced, montarDossie, promptDoCopiloto, type LeadDoCopiloto } from './operations/copiloto.ts'
import { spicedVazio } from './operations/spiced.ts'

const lead: LeadDoCopiloto = { id: 'site:teste', produto: 'site', empresa: 'Empresa de teste', nicho: 'teste', cidade: 'Vitória', subEtapa: 'Em conversa', etapa: 'contato', sinal: 'em-conversa', marcos: {}, links: {}, eventos: [], followupHoje: false }
const fala = 'Perco os pedidos porque não respondemos a tempo. Sou o dono e decido. Deixo de faturar R$ 900.'
const dossie = montarDossie(lead, { conversa: [{ em: '2026-10-19T14:00:00Z', direcao: 'entrada', texto: fala }] })
const decisao = { valor: { decisor_confirmado: 'sim', quem: 'Dono', como_paga: '' }, citacao: 'Sou o dono e decido.' }

it('registros comerciais estruturados não levam valores, quantidades ou referências ao copiloto', () => {
  const dados = { valor_centavos: 69000, quantidade: 27, referencia: 'recibo-comercial-reservado', data: '2026-10-19' }
  const eventos = ['valor_proposta', 'pagamento_confirmado', 'receita_desfeita', 'retencao_3m', 'indicacao_pedida', 'indicacao_recebida'].map(tipo => ({ tipo, em: '2026-10-19T14:00:00Z', origem: 'manual' as const, fonte: 'teste', rotulo: 'Pagamento R$ 690', texto: JSON.stringify(dados), registroTexto: JSON.stringify(dados) }))
  const d = montarDossie({ ...lead, eventos })
  assert.deepEqual(d.historico, [])
  const prompt = JSON.stringify(promptDoCopiloto(d))
  assert.doesNotMatch(prompt, /recibo-comercial-reservado|valor_centavos|quantidade|Pagamento R\$ 690/)
})

describe('SPICED do copiloto continua sugestão citada', () => {
  const casos = [
    { nome: 'ausente', bruto: undefined, campo: undefined },
    { nome: 'sem citação', bruto: { dor: { valor: 'Perde pedidos' } }, campo: undefined },
    { nome: 'citação inventada', bruto: { dor: { valor: 'Perde pedidos', citacao: 'Não consigo vender' } }, campo: undefined },
    { nome: 'dor com trecho literal', bruto: { dor: { valor: 'Perde pedidos', citacao: 'Perco os pedidos' } }, campo: 'dor' },
    { nome: 'impacto monetário dito pelo lead', bruto: { impacto: { valor: 'R$ 900', citacao: 'Deixo de faturar R$ 900.' } }, campo: 'impacto' },
    { nome: 'impacto monetário inventado', bruto: { impacto: { valor: 'R$ 690', citacao: 'Deixo de faturar R$ 900.' } }, campo: undefined },
    { nome: 'decisão comprovada como sugestão', bruto: { decisao }, campo: 'decisao' },
    { nome: 'enum de decisão inválido', bruto: { decisao: { ...decisao, valor: { ...decisao.valor, decisor_confirmado: true } } }, campo: undefined },
  ]
  for (const c of casos) it(c.nome, () => {
    const antes = JSON.stringify(dossie)
    const s = lerSugestaoSpiced(c.bruto, dossie)
    assert.deepEqual(s ? Object.keys(s) : undefined, c.campo ? [c.campo] : undefined)
    assert.equal(JSON.stringify(dossie), antes)
    assert.equal(dossie.spiced, undefined)
  })
  for (const papel of ['robo', 'recepcao'] as const) it(`${papel} não confirma decisor`, () => {
    const d = montarDossie(lead, { conversa: [{ em: '2026-10-19T14:00:00Z', direcao: 'entrada', texto: fala, papel }] })
    assert.equal(lerSugestaoSpiced({ decisao }, d), undefined)
    assert.equal(lerSugestaoSpiced({ decisao }, dossie, { quem: papel, leitura: 'Atendente', passo: 'Pedir responsável' }), undefined)
  })
  it('não usa fala do vendedor como evidência do lead', () => {
    const d = montarDossie(lead, { conversa: [{ em: '2026-10-19T14:00:00Z', direcao: 'saida', texto: fala }] })
    assert.equal(lerSugestaoSpiced({ decisao }, d), undefined)
  })
  it('permite evento do Raio-X com data real e rejeita data inventada', () => {
    const d = montarDossie(lead, { textoDoRaioX: 'Domínio vencido em 2026-08-29.' })
    const candidato = { valor: { fato: 'Domínio vencido', data: '2026-08-29' }, citacao: 'Domínio vencido em 2026-08-29.' }
    assert.ok(lerSugestaoSpiced({ evento_critico: candidato }, d)?.evento_critico)
    assert.equal(lerSugestaoSpiced({ evento_critico: { ...candidato, valor: { ...candidato.valor, data: '2026-02-30' } } }, d), undefined)
  })
  it('sugestão parcial válida sobrevive a outro campo inventado', () => {
    const s = lerSugestaoSpiced({ dor: { valor: 'Perde pedidos', citacao: 'Perco os pedidos' }, impacto: { valor: 'Muito dinheiro', citacao: 'inventado' } }, dossie)
    assert.deepEqual(Object.keys(s ?? {}), ['dor'])
  })
  it('inclui fatos humanos confirmados no dossiê e muda seu conteúdo quando revisados', () => {
    const spiced = { ...spicedVazio(), dor: 'Demora para responder' }
    const a = montarDossie({ ...lead, spiced })
    const b = montarDossie({ ...lead, spiced: { ...spiced, impacto: 'Pedidos perdidos' } })
    assert.deepEqual(a.spiced, spiced)
    assert.notEqual(JSON.stringify(a), JSON.stringify(b))
    a.spiced!.dor = 'Alterado'
    assert.equal(spiced.dor, 'Demora para responder')
  })
  it('retém sugestão verificável, sem confirmar ou liberar proposta automaticamente', () => {
    const r = lerSaidaDoCopiloto(JSON.stringify({ mensagem: 'Podemos conversar por dez minutos?', proposta: { itens: [{ id: 'encontrado' }] }, spiced: { decisao } }), dossie)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.ok(r.sugestao.spiced?.decisao)
    assert.deepEqual(r.sugestao.proposta.itens, [])
    assert.equal(dossie.spiced, undefined)
  })
  it('prompt pede descoberta, citação e confirmação humana antes da proposta', () => {
    const p = promptDoCopiloto(dossie)
    assert.match(p, /dor, impacto e decisor confirmado/)
    assert.match(p, /SUGESTÃO para confirmação humana/)
    assert.match(p, /trecho literal/)
    assert.doesNotMatch(p, /24 h depois de cada/)
  })
})
