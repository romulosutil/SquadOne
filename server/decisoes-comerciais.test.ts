import assert from 'node:assert/strict'
import { test } from 'node:test'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { montarCrm, validarRetrato, type CrmRetrato } from './crm.ts'
import { montarDecisoesComerciais } from './decisoes-comerciais.ts'
import { hashDoContexto } from '../src/operations/revisao-resposta.ts'
import { baseDaClassificacao, PREFIXO_CLASSIFICACAO, PREFIXO_CONVITE } from '../src/operations/decisoes-comerciais.ts'
import { mensagemDoConvite } from './convite-mensagem.ts'
import { readFileSync } from 'node:fs'

const agora = new Date()
const antes = new Date(agora.getTime() - 86400_000).toISOString()
function retrato(): CrmRetrato {
  const fonte = (linhas: Record<string, string>[]) => ({ aba: 'QA', colunas: [...new Set(linhas.flatMap(Object.keys))], linhas })
  return validarRetrato({ versao: 1, geradoEm: agora.toISOString(), links: { webhook: 'https://nao-chamar.example/webhook' }, fontes: {
    site: fonte([{ place_id: 'cliente', nome: 'Cliente QA', status: 'recusado', enviado_em: antes, recusado_em: antes, resposta_tipo: 'neutra', resposta_trecho: 'Pode explicar?', resposta_em: antes, wa_me: 'https://wa.me/5511999999999' }]),
    prumo: fonte([{ ID: 'prospect', Empresa: 'Empresa QA', Etapa: 'Revisar', WhatsApp: '(11) 99999-9999', 'Encontrado em': antes }]),
    registros: fonte([]),
  } })
}
function anotar(r: CrmRetrato, id: string, texto: string) {
  r.fontes.registros.linhas.push({ produto: id.split(':')[0], id: id.split(':')[1], tipo: 'nota', em: agora.toISOString(), texto, data: '' })
}
test('revisão reabre a classificação da fonte sem apagar histórico; nova decisão da fonte invalida a revisão', () => {
  const r = retrato()
  const original = montarCrm(r, { agora }).leads.find(l => l.id === 'site:cliente')!
  assert.equal(original.etapa, 'perdido')
  assert.ok(original.revisaoComercial)
  anotar(r, original.id, PREFIXO_CLASSIFICACAO + JSON.stringify({ base: baseDaClassificacao(original), decisao: 'reabrir', motivo: 'Conferi: recusou apenas o link.' }))
  const revisto = montarCrm(r, { agora }).leads.find(l => l.id === original.id)!
  assert.equal(revisto.etapa, 'contato'); assert.equal(revisto.revisaoComercial, undefined)
  assert.equal(revisto.estadoNaPlanilha, original.estadoNaPlanilha)
  assert.ok(revisto.eventos.some(e => e.texto?.includes('recusou apenas o link')))
  r.fontes.site.linhas[0].status = 'fechado'
  assert.equal(montarCrm(r, { agora }).leads.find(l => l.id === original.id)!.etapa, 'ganho')
})
test('manter a classificação registra conferência sem reabrir nem provocar mensagem', () => {
  const r = retrato(); const l = montarCrm(r, { agora }).leads[0]
  anotar(r, l.id, PREFIXO_CLASSIFICACAO + JSON.stringify({ base: baseDaClassificacao(l), decisao: 'manter', motivo: 'Recusa confirmada no WhatsApp.' }))
  const atual = montarCrm(r, { agora }).leads[0]
  assert.equal(atual.etapa, 'perdido'); assert.equal(atual.revisaoComercial, undefined)
})
test('convite usa destino direto, permanece na triagem até confirmação e usa a hora real confirmada', () => {
  const r = retrato(); const l = montarCrm(r, { agora }).leads.find(l => l.id === 'prumo:prospect')!
  assert.equal(new URL(l.links.convite!).hostname, 'wa.me')
  assert.ok(new URL(l.links.convite!).searchParams.get('text'))
  assert.equal(l.sinal, 'revisar'); assert.equal(l.marcos.enviado, undefined)
  const enviadoEm = new Date(agora.getTime() - 60_000).toISOString()
  anotar(r, l.id, PREFIXO_CONVITE + JSON.stringify({ enviadoEm, mensagem: 'Convite realmente enviado' }))
  const atual = montarCrm(r, { agora }).leads.find(atual => atual.id === l.id)!
  assert.equal(atual.etapa, 'contato'); assert.equal(atual.marcos.enviado, enviadoEm)
  assert.equal(atual.eventos.find(e => e.tipo === 'convite')?.origem, 'manual')
  assert.equal(atual.links.convite, undefined)
})
test('textos das ofertas preservam os modelos aprovados', () => {
  const cfg = JSON.parse(readFileSync(new URL('../deploy/dell/claude-ops/prumo-ofertas.json', import.meta.url), 'utf8'))
  for (const produto of ['iris', 'estampa']) assert.equal(mensagemDoConvite(produto, 'Empresa', '', new Date('2026-10-18T15:00:00Z')), cfg.ofertas[produto].mensagem.replace('{OLA}', 'Boa tarde').replace('{NOME}', 'Empresa'))
})
test('confirmações validam contexto, impedem duplicidade e não repetem resultado ambíguo', async () => {
  const r = retrato(); let chamadas = 0; let falha = false
  const app = express(); app.use(express.json())
  montarDecisoesComerciais(app, { visao: async () => montarCrm(r, { agora }), registrar: async () => { chamadas++; if (falha) throw new Error('timeout'); return { ok: true } } })
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/crm/decisao/confirmar`
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const l = montarCrm(r, { agora }).leads[0]
    const body = { tipo: 'classificacao', leadId: l.id, contextoHash: await hashDoContexto(l), decisao: 'reabrir', motivo: 'Conferido pelo operador.' }
    assert.equal((await post({ ...body, contextoHash: '0'.repeat(64) })).status, 409)
    assert.equal((await post({ ...body, motivo: '' })).status, 400)
    assert.equal((await post(body)).status, 201)
    assert.equal((await post(body)).status, 409); assert.equal(chamadas, 1)
    const p = montarCrm(r, { agora }).leads.find(l => l.produto === 'prumo')!
    const convite = { tipo: 'convite', leadId: p.id, contextoHash: await hashDoContexto(p), mensagem: 'Olá, mensagem enviada.', enviadoEm: agora.toISOString() }
    assert.equal((await post({ ...convite, enviadoEm: new Date(Date.now() + 86400000).toISOString() })).status, 400)
    falha = true
    const resposta = await post(convite)
    assert.equal(resposta.status, 503); assert.equal((await resposta.json()).incerto, true)
    assert.equal((await post(convite)).status, 409); assert.equal(chamadas, 2)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
