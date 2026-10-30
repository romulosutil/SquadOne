import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { it } from 'node:test'
import express from 'express'
import { CrmStore, montarCrm, validarRetrato, validarRegistro, RegistroInvalido } from './crm'
import { createOperationsRouter, OperationsProjectStore, HermesReadingsStore, type OperationsConfig } from './operations'
import { aarrDoLead, chaveDoPagamento, leituraAarr, opcoesDeterministicasDeReceita, textoDoRegistroAarr, textoDoRegistroReceita, type RegistroReceita } from '../src/operations/aarr'

const AGORA = new Date('2026-10-19T15:00:00Z')
const condicao = opcoesDeterministicasDeReceita({ produto: 'site' })[0]!
const entrada = (texto = textoDoRegistroReceita('pagamento_confirmado', condicao, 'REC-001', '2026-10-19')) => ({ produto: 'site', id: 'AAR-001', tipo: 'pagamento_confirmado', texto, data: '' })
const retrato = (linhas: Record<string, string>[]) => ({ versao: 1, geradoEm: AGORA.toISOString(), fontes: {
  site: { linhas: [{ place_id: 'AAR-001', nome: 'Empresa', status: 'enviado', enviado_em: '2026-10-15T12:00:00Z' }] },
  prumo: { linhas: [] }, iris: { linhas: [] }, estampa: { linhas: [] }, registros: { linhas },
} })

it('CRM lê confirmações válidas na fonte e mostra resumo legível, preserva90histórico e ignora futuro', () => {
  const registros = [
    { ...entrada(), em: '2026-10-19T14:00:00Z' },
    { ...entrada(), tipo: 'proposta', texto: '90/mês histórico', data: '2026-10-18', em: '2026-10-18T14:00:00Z' },
    { ...entrada(), texto: '{}', em: '2026-10-19T14:01:00Z' },
    { ...entrada(), texto: textoDoRegistroReceita('pagamento_confirmado', condicao, 'FUTURO', '2026-10-19'), em: '2026-10-20T14:00:00Z' },
  ]
  const l = montarCrm(validarRetrato(retrato(registros)), { agora: AGORA }).leads[0]!
  assert.equal(l.aarr!.pagamentos.length, 1)
  assert.equal(l.proposta!.data, '2026-10-18')
  const e = l.eventos.find(e => e.tipo === 'pagamento_confirmado')!
  assert.match(e.texto!, /Pagamento confirmado/)
  assert.doesNotMatch(e.texto!, /valor_centavos|versao/)
  assert.match(e.registroTexto!, /valor_centavos/)
  assert.equal(leituraAarr([l], AGORA.getTime()).receita.valorCentavos, 69000)
})

it('pagamento confirmado pela Receita encerra a cadência da proposta: quem pagou não vira Perdido no D+10 (29/10/2026)', () => {
  // Proposta registrada em 19/10 (o "Proposta enviada" da Ficha) e, no dia seguinte, a implantação paga.
  const proposta = { ...entrada(), tipo: 'proposta', texto: '', data: '2026-10-19', em: '2026-10-19T14:00:00Z' }
  const pago = { ...entrada(textoDoRegistroReceita('pagamento_confirmado', condicao, 'PIX-TESTE-001', '2026-10-20')), em: '2026-10-20T14:00:00Z' }
  const depois = new Date('2026-10-29T15:00:00Z')
  const semPagamento = montarCrm(validarRetrato(retrato([proposta])), { agora: depois }).leads[0]!
  assert.equal(semPagamento.etapa, 'perdido', 'controle: a proposta sem retorno vence no D+10')
  assert.equal(semPagamento.motivoPerda, 'proposta-sem-retorno')
  const comPagamento = montarCrm(validarRetrato(retrato([proposta, pago])), { agora: depois }).leads[0]!
  assert.equal(comPagamento.etapa, 'proposta')
  assert.equal(comPagamento.motivoPerda, undefined)
  assert.equal(leituraAarr([comPagamento], depois.getTime()).perdas.perdidos, 0)
  assert.equal(leituraAarr([comPagamento], depois.getTime()).receita.valorCentavos, 69000)
  // Desfeito o pagamento, a proposta volta a vencer como qualquer outra.
  const desfeito = { ...entrada(textoDoRegistroAarr('receita_desfeita', { tipo: 'pagamento_confirmado', referencia: chaveDoPagamento(JSON.parse(pago.texto)), data: '2026-10-21' })),
    tipo: 'receita_desfeita', em: '2026-10-21T14:00:00Z' }
  assert.equal(montarCrm(validarRetrato(retrato([proposta, pago, desfeito])), { agora: depois }).leads[0]!.etapa, 'perdido')
})

it('fronteira exige catálogo, oferta correta, datas reais/passadas e não truncaJSON', () => {
  const ok = entrada()
  assert.equal(validarRegistro(ok, AGORA).data, '2026-10-19')
  for (const produto of ['estampa','iris']) assert.throws(() => validarRegistro({ ...ok, produto }, AGORA), RegistroInvalido)
  for (const extra of [{ valor_centavos: 9000 }, { data: '2026-02-30' }, { data: '2026-10-20' }]) assert.throws(() => validarRegistro(entrada(JSON.stringify({ ...JSON.parse(ok.texto), ...extra })), AGORA), RegistroInvalido)
  assert.throws(() => validarRegistro(entrada(ok.texto+' '.repeat(1000)), AGORA), RegistroInvalido)
})

it('rota real+CrmStore+n8n falso: dedup, reversão, correção e vínculos; nenhuma escrita externa', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aarr-rota-'))
  const servidor = http.createServer()
  try {
    const arquivo = path.join(dir, 'crm.json'), segredo = path.join(dir, 'segredo')
    await fs.writeFile(segredo, 'segredo-somente-fixture')
    const linhas: Record<string, string>[] = []
    const salvar = () => fs.writeFile(arquivo, JSON.stringify(retrato(linhas)))
    await salvar()
    let escritas = 0
    const store = new CrmStore({ retrato: arquivo, registroUrl: 'http://127.0.0.1:5679/webhook/crm-registro', segredoArquivo: segredo, entregasPrumo: path.join(dir, 'entregas'), conversas: path.join(dir, 'conversas') }, async (url, init) => {
      assert.equal(String(url), 'http://127.0.0.1:5679/webhook/crm-registro')
      escritas++
      const corpo = JSON.parse(String(init!.body)), em = new Date(AGORA.getTime()-10000+escritas).toISOString()
      linhas.push({ ...corpo, em, origem: 'Central' }); await salvar()
      return new Response(JSON.stringify({ ok: true, em }), { status: 200 })
    })
    const registrar = store.registrar.bind(store)
    store.registrar = (r) => registrar(r, AGORA)
    const app = express(); app.use(express.json())
    app.use('/api/operations', createOperationsRouter({ config: { tools: {} } as OperationsConfig, store: new OperationsProjectStore(dir), readings: new HermesReadingsStore(dir), dataDir: dir, readAgenda: async () => ({ state: 'disconnected', events: [] }), crm: store }))
    servidor.on('request', app)
    await new Promise<void>(resolve => servidor.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/operations/crm/registro`
    const enviar = (r: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) })
    const pagamento = entrada()
    const respostas = await Promise.all([enviar(pagamento), enviar(pagamento)])
    assert.ok(respostas.every(r => r.status === 201))
    assert.equal(escritas, 1)
    assert.equal((await enviar(entrada(JSON.stringify({ ...JSON.parse(pagamento.texto), valor_centavos: 9000 })))).status, 400)
    const meta = JSON.parse(pagamento.texto) as RegistroReceita
    assert.equal((await enviar({ ...pagamento, tipo: 'receita_desfeita', texto: textoDoRegistroAarr('receita_desfeita', { tipo: 'pagamento_confirmado', referencia: chaveDoPagamento(meta), data: '2026-10-19' }) })).status, 201)
    assert.equal(aarrDoLead((await store.visao(AGORA)).leads[0]!, AGORA.getTime()).pagamentos.length, 0)
    assert.equal((await enviar(pagamento)).status, 201)
    assert.equal(escritas, 3)
    assert.equal(aarrDoLead((await store.visao(AGORA)).leads[0]!, AGORA.getTime()).pagamentos.length, 1)
    const retencao = { ...pagamento, tipo: 'retencao_3m', texto: textoDoRegistroAarr('retencao_3m', { referencia: 'encontrado', inicio: '2026-01-01', data: '2026-10-19', ativa: true }) }
    assert.equal((await enviar(retencao)).status, 400, 'implantação não cria mensalidade/assinatura')
    assert.equal((await enviar({ ...pagamento, tipo: 'indicacao_pedida', texto: textoDoRegistroAarr('indicacao_pedida', { referencia: 'recibo-inexistente', data: '2026-10-19' }) })).status, 400)
    assert.equal(escritas, 3)
    const longo = { ...pagamento, texto: textoDoRegistroReceita('pagamento_confirmado', condicao, 'R'.repeat(200), '2026-09-19') }
    assert.equal((await enviar(longo)).status, 201)
    const chaveLonga = chaveDoPagamento(JSON.parse(longo.texto))
    assert.ok(chaveLonga.length > 200)
    assert.equal((await enviar({ ...pagamento, tipo: 'indicacao_pedida', texto: textoDoRegistroAarr('indicacao_pedida', { referencia: chaveLonga, data: '2026-10-19' }) })).status, 201)
    assert.equal(aarrDoLead((await store.visao(AGORA)).leads[0]!, AGORA.getTime()).indicacoes.pedidas[0]!.referencia, chaveLonga)
    assert.equal(escritas, 5)
  } finally {
    await new Promise<void>(resolve => servidor.close(() => resolve()))
    await fs.rm(dir, { recursive: true, force: true })
  }
})

it('recusa explícita do n8n libera a reserva comercial; resposta ambígua continua bloqueando (29/10/2026)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aarr-recusa-'))
  try {
    const arquivo = path.join(dir, 'crm.json'), segredo = path.join(dir, 'segredo')
    await fs.writeFile(segredo, 'segredo-somente-fixture')
    const linhas: Record<string, string>[] = []
    const salvar = () => fs.writeFile(arquivo, JSON.stringify(retrato(linhas)))
    await salvar()
    const respostas: Array<'recusa' | 'falha' | 'ok'> = []
    let chamadas = 0
    const store = new CrmStore({ retrato: arquivo, registroUrl: 'http://127.0.0.1:5679/webhook/crm-registro', segredoArquivo: segredo, entregasPrumo: path.join(dir, 'entregas'), conversas: path.join(dir, 'conversas'), journalComercial: path.join(dir, 'privado', 'journal.json') }, async (_url, init) => {
      chamadas++
      const vez = respostas.shift() ?? 'ok'
      if (vez === 'recusa') return new Response(JSON.stringify({ ok: false, erro: 'Categoria comercial inválida.' }), { status: 400 })
      if (vez === 'falha') return new Response(JSON.stringify({ ok: false, erro: 'A planilha não gravou: tempo esgotado' }), { status: 502 })
      const corpo = JSON.parse(String(init!.body)), em = new Date(AGORA.getTime() - 5000).toISOString()
      linhas.push({ ...corpo, em, origem: 'Central' }); await salvar()
      return new Response(JSON.stringify({ ok: true, em }), { status: 200 })
    })
    const pagamento = entrada()
    // Recusa da validação do 08 · CRM: o erro chega ao Rômulo e a mesma operação pode ser repetida.
    respostas.push('recusa')
    await assert.rejects(store.registrar(pagamento, AGORA), (e: Error) => e.name === 'RegistroFalhou' && /Categoria comercial inválida/.test(e.message))
    const ok = await store.registrar(pagamento, AGORA)
    assert.equal(ok.ok, true)
    assert.equal(chamadas, 2)
    assert.equal(linhas.length, 1)
    // 502 (a planilha pode ter gravado antes do erro): ambíguo, sem segundo POST.
    const outro = entrada(textoDoRegistroReceita('pagamento_confirmado', condicao, 'REC-002', '2026-10-19'))
    respostas.push('falha')
    await assert.rejects(store.registrar(outro, AGORA), (e: Error) => e.name === 'RegistroFalhou')
    await assert.rejects(store.registrar(outro, AGORA), RegistroInvalido)
    assert.equal(chamadas, 3)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
