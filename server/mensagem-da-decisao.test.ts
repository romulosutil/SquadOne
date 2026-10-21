import assert from 'node:assert/strict'
import { test } from 'node:test'
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { CrmLead, CrmVisao } from '../src/operations/types.ts'
import type { Copiloto, SugestaoNaFicha } from './copiloto.ts'
import { montarMensagemDaDecisao } from './mensagem-da-decisao.ts'
import { hashDoContexto } from '../src/operations/revisao-resposta.ts'
import { procedimentoDaDecisao } from '../src/office/procedimento-da-decisao.ts'
import { acaoDoLead } from '../src/operations/proxima-venda.ts'
import { resumirConversa } from './conversa-do-lead.ts'

const lead = (extra: Partial<CrmLead> = {}) => ({ id: 'site:qa', chave: 'qa', produto: 'site', empresa: 'Cliente QA', nicho: 'clínica', cidade: 'Vitória', etapa: 'contato', sinal: 'em-conversa', subEtapa: 'Respondeu', marcos: {}, eventos: [], links: { whatsapp: 'https://wa.me/5511999999999' }, notas: 0, conversa: { mensagens: 2, ultimaEntrada: new Date().toISOString(), ultima: { direcao: 'entrada', em: new Date().toISOString(), trecho: 'Como funciona?', papel: undefined } }, resposta: { tipo: 'neutra', trecho: 'Como funciona?' }, ...extra }) as CrmLead
const hojeDoCliente = (cliente: CrmLead): CrmVisao['hoje'] => [{ id: 'resposta', titulo: 'Responder', explicacao: '', itens: [{ leadId: cliente.id, acao: 'Responder no WhatsApp', detalhe: '', ordem: 1, links: cliente.links.segunda ? [{ rotulo: 'Mensagem', url: cliente.links.segunda }] : [] }] }]
async function servidor(cliente: CrmLead, copiloto?: Pick<Copiloto, 'ler' | 'sugerir'>, reler?: () => CrmLead) {
  const app = express(); app.use(express.json())
  montarMensagemDaDecisao(app, { crm: { visao: async () => ({ estado: 'ok', leads: [reler ? reler() : cliente], hoje: hojeDoCliente(cliente) }) as unknown as CrmVisao }, copiloto })
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/crm/decisao/mensagem`
  return { pedir: async (campos = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produto: cliente.produto, id: cliente.id, contextoHash: await hashDoContexto(cliente), ...campos }) }), fechar: () => new Promise<void>(r => server.close(() => r())) }
}

test('robô recebe procedimento e pedido de encaminhamento sem modelo, link liberado ou avanço presumido', async () => {
  const cliente = lead(); cliente.conversa!.ultima.papel = 'robo'; cliente.resposta = { tipo: 'bot', trecho: 'Digite 3 para atendimento' }
  let chamadas = 0
  const api = await servidor(cliente, { ler: async () => { chamadas++; return null }, sugerir: async () => { throw new Error('não deve gerar') } })
  try { const r = await api.pedir(); assert.equal(r.status, 200); const p = await r.json(); assert.equal(p.procedimento.tipo, 'robo'); assert.match(p.mensagem, /responsável pela empresa/); assert.equal(p.podeAbrir, false); assert.equal(chamadas, 0); assert.ok(p.procedimento.passos.some((s: string) => s.includes('não adivinhe'))); assert.equal(cliente.etapa, 'contato') } finally { await api.fechar() }
})

test('resposta humana usa mensagem do copiloto e recusa contexto trocado durante a geração', async () => {
  const cliente = lead()
  const sugestao = { quando: new Date().toISOString(), sugestao: { mensagem: 'Olá! Qual parte do atendimento você gostaria de organizar primeiro?', porque: 'Perguntou como funciona', ofertas: [], proposta: { itens: [] }, faltaSaber: [] } } as unknown as SugestaoNaFicha
  let geracoes = 0, mudou = false
  const cp = { ler: async () => null, sugerir: async () => { geracoes++; return sugestao } }
  const api = await servidor(cliente, cp)
  try { const r = await api.pedir(); assert.equal(r.status, 200); const p = await r.json(); assert.equal(p.mensagem, sugestao.sugestao.mensagem); assert.equal(p.podeAbrir, true); assert.equal(geracoes, 1) } finally { await api.fechar() }
  const segunda = await servidor(cliente, { ler: async () => null, sugerir: async () => { mudou = true; return sugestao } }, () => mudou ? { ...cliente, notas: 1 } : cliente)
  try { assert.equal((await segunda.pedir()).status, 409) } finally { await segunda.fechar() }
})

test('hash antigo e oferta diferente não produzem mensagem', async () => {
  const api = await servidor(lead())
  try { assert.equal((await api.pedir({ contextoHash: '0'.repeat(64) })).status, 409); assert.equal((await api.pedir({ produto: 'iris' })).status, 503); assert.equal((await api.pedir({ contextoHash: 'invalido' })).status, 400) } finally { await api.fechar() }
})

test('espera, recusa, áudio sem transcrição e recepção têm procedimentos próprios', () => {
  assert.equal(procedimentoDaDecisao(lead({ proximoPasso: { texto: 'Esperar sem nova cobrança', data: '2099-01-01', registradoEm: '' } })).tipo, 'espera')
  assert.equal(procedimentoDaDecisao(lead({ resposta: { tipo: 'exclusao', trecho: 'Remova meu número' } })).tipo, 'encerrado')
  const audio = lead(); audio.conversa!.ultima.trecho = '[áudio 27s]'
  assert.equal(procedimentoDaDecisao(audio).tipo, 'audio')
  const recepcao = lead(); recepcao.conversa!.ultima.papel = 'recepcao'
  assert.equal(procedimentoDaDecisao(recepcao).tipo, 'recepcao')
  const humano = lead({ resposta: { tipo: 'bot', trecho: 'Antigo' } })
  assert.equal(procedimentoDaDecisao(humano).tipo, 'humano', 'uma resposta humana posterior supera o robô anterior')
})

test('material pendente e modelo indisponível não liberam mensagem incompleta', async () => {
  const cliente = lead()
  const cp = { ler: async () => null, sugerir: async () => ({ sugestao: { mensagem: 'Veja [link]', porque: 'Material pedido' } }) as SugestaoNaFicha }
  const api = await servidor(cliente, cp)
  try { const p = await (await api.pedir()).json(); assert.equal(p.mensagem, null); assert.equal(p.podeAbrir, false) } finally { await api.fechar() }
})

test('um rascunho padrão já preenchido não evita gerar a resposta contextual', async () => {
  const cliente = lead({ resposta: { tipo: 'interesse', trecho: 'Quero ver' }, interesseParado: { desde: new Date().toISOString() }, links: { whatsapp: 'https://wa.me/5511999999999', site: 'https://demo.example.com', segunda: 'https://wa.me/5511999999999?text=Mensagem%20padr%C3%A3o' } })
  assert.ok(acaoDoLead({ leads: [cliente], hoje: hojeDoCliente(cliente) }, cliente.id, Date.now())?.rascunho)
  let geracoes = 0
  const sugestao = { quando: new Date().toISOString(), sugestao: { mensagem: 'Sim, posso mostrar como os agendamentos funcionam. Qual dúvida você quer esclarecer?', porque: 'Perguntou sobre os agendamentos', momento: { quem: 'decisor', leitura: 'A pessoa pediu detalhes dos agendamentos.', passo: 'Esclarecer a dúvida sobre agendamentos' } } } as SugestaoNaFicha
  const api = await servidor(cliente, { ler: async () => null, sugerir: async () => { geracoes++; return sugestao } })
  try {
    const r = await api.pedir(); assert.equal(r.status, 200); const p = await r.json()
    assert.equal(geracoes, 1); assert.equal(p.origem, 'copiloto'); assert.equal(p.mensagem, sugestao.sugestao.mensagem)
    assert.equal(p.leitura, sugestao.sugestao.momento!.leitura); assert.equal(p.acao?.anota, undefined)
  } finally { await api.fechar() }
})

test('trechos recentes preservam autores, ordem e limite; recepção supera classificação antiga de robô', () => {
  const conversa = resumirConversa([
    { direcao: 'entrada', em: '2026-10-20T12:00:00Z', texto: '[Bot] Aguarde' },
    { direcao: 'entrada', em: '2026-10-20T12:01:00Z', texto: '*[Ana]* Em que posso ajudar?' },
    { direcao: 'saida', em: '2026-10-20T12:02:00Z', texto: 'Gostaria de falar sobre o atendimento.' },
  ])!
  assert.deepEqual(conversa.recentes?.map(m => [m.direcao, m.papel]), [['entrada', 'robo'], ['entrada', 'recepcao'], ['saida', undefined]])
  assert.equal(procedimentoDaDecisao(lead({ conversa, resposta: { tipo: 'bot', trecho: '[Bot] Aguarde' } })).tipo, 'recepcao')
  const longa = resumirConversa(Array.from({ length: 9 }, (_, i) => ({ direcao: 'entrada' as const, em: `2026-10-20T12:0${i}:00Z`, texto: 'x'.repeat(500) })))!
  assert.equal(longa.recentes?.length, 6); assert.equal(longa.recentes?.[0].trecho.length, 280)
})
