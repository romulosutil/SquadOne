import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { lerCanaisComerciais } from './canais-comerciais.ts'
import { resumirFicha } from '../src/operations/fila-da-carteira.ts'
import type { CrmLead } from '../src/operations/types.ts'

const agora = Date.parse('2026-11-18T22:00:00Z')
const em = '2026-11-18T21:55:00Z'

test('fonte ausente não vira zero, nem cria arquivos ou roda um executor', async t => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'canais-prumo-'))
  t.after(() => fs.rm(raiz, { recursive: true, force: true }))
  const canais = await lerCanaisComerciais({ agenda: raiz, operacao: raiz, registroWhatsApp: path.join(raiz, 'wa.sqlite') }, [], agora)
  assert.equal(canais.whatsapp.envios, null)
  assert.equal(canais.linkedin.envios, null)
  assert.equal(canais.whatsapp.agenda.estado, 'indisponivel')
  assert.deepEqual(await fs.readdir(raiz), [])
})

test('concilia recibos distintos, protege a identidade da ficha e separa agenda, busca, envio e incerteza', async t => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'canais-prumo-'))
  t.after(() => fs.rm(raiz, { recursive: true, force: true }))
  const wa = path.join(raiz, 'whatsapp-prospeccao')
  const li = path.join(raiz, 'linkedin')
  await fs.mkdir(wa)
  await fs.mkdir(li)
  const json = (dir: string, nome: string, valor: object) => fs.writeFile(path.join(dir, nome), JSON.stringify(valor))
  await json(wa, 'ultima-entrega.json', { versao: 1, workflowId: 'wa-1', execucaoId: '700', criadoEm: '2026-11-18T20:00:00Z' })
  await json(li, 'ultima-entrega.json', { versao: 1, workflowId: 'li-1', execucaoId: '900', criadoEm: em })
  await json(li, 'executor-estado.json', { versao: 1, executor: 'dell-n8n', atualizadoEm: em, estado: 'pausado', detalhe: 'Canal pausado.' })

  const registroWhatsApp = path.join(raiz, 'wa.sqlite')
  const whatsapp = new DatabaseSync(registroWhatsApp)
  whatsapp.exec('CREATE TABLE contatos (chave TEXT PRIMARY KEY, id TEXT, estado TEXT, em TEXT, recibo TEXT)')
  const inserir = whatsapp.prepare('INSERT INTO contatos VALUES (?,?,?,?,?)')
  const fichas = Array.from({ length: 10 }, (_, i) => {
    inserir.run('110000000' + i, 'site-' + i, 'enviado', em, 'ficticio-' + i)
    return { id: 'site-' + i, links: { whatsapp: 'https://wa.me/551190000000' + i } }
  })
  inserir.run('1200000001', 'prumo-incerto', 'incerto', em, '')
  inserir.run('1200000002', 'prumo-antigo', 'enviado', '2026-11-18T02:59:00Z', 'dia-anterior-em-sp')
  inserir.run('1200000003', 'prumo-duplicado-1', 'enviado', em, 'repetido-indevido')
  inserir.run('1200000004', 'prumo-duplicado-2', 'enviado', em, 'repetido-indevido')
  whatsapp.close()
  const linkedin = new DatabaseSync(path.join(li, 'linkedin.sqlite'))
  linkedin.exec('CREATE TABLE contatos (id TEXT, perfil TEXT, nome TEXT, empresa TEXT, mensagem TEXT, estado TEXT, reservadoEm TEXT, confirmadoEm TEXT, conversa TEXT, evidencia TEXT); CREATE TABLE eventos (id INTEGER, contato TEXT, tipo TEXT, detalhe TEXT);')
  linkedin.close()
  const rodadas = new DatabaseSync(path.join(li, 'rodadas.sqlite'))
  rodadas.exec(`
    CREATE TABLE rodadas (workflow TEXT, execucao TEXT, slot TEXT, estado TEXT);
    INSERT INTO rodadas VALUES ('li-1','899','2026-11-18T18:45','sem-candidato'),
      ('li-1','900','2026-11-18T18:55','pausado'), ('outra','901','2026-11-18T18:59','sem-candidato');
  `)
  rodadas.close()

  const antes = await fs.readFile(registroWhatsApp)
  const canais = await lerCanaisComerciais({ operacao: raiz, agenda: raiz, registroWhatsApp }, [
    ...fichas, { id: 'prumo-incerto', links: { whatsapp: 'https://wa.me/5512900000001' } },
    { id: 'prumo-antigo', links: { whatsapp: 'https://wa.me/5513900000002' } },
  ], agora)
  assert.deepEqual(await fs.readFile(registroWhatsApp), antes)
  assert.equal(canais.whatsapp.envios, 10)
  assert.equal(canais.whatsapp.agenda.estado, 'desatualizada')
  assert.equal(canais.whatsapp.pedido?.execucaoId, '700')
  assert.equal(canais.whatsapp.recibosEmConflito, 1)
  assert.equal(canais.whatsapp.porFicha['site-4']?.recibo, 'ficticio-4')
  assert.equal(canais.whatsapp.porFicha['prumo-incerto']?.estado, 'incerto')
  assert.equal(canais.whatsapp.porFicha['prumo-antigo'], undefined)
  assert.equal(canais.linkedin.pedido?.execucaoId, '900')
  assert.equal(canais.linkedin.situacao, 'Canal pausado.')
  assert.equal(canais.linkedin.envios, 0)
  assert.deepEqual(canais.linkedin.ultimaBuscaSemCandidato, { execucaoId: '899', slot: '2026-11-18T18:45', envios: 0 })
})

test('passagem exclusiva de uma captura original leva à ficha certa e preserva incerteza e responsabilidade', () => {
  const base = { id: 'site-ficticio', eventos: [], links: {}, etapa: 'contato' } as unknown as CrmLead
  const lead: CrmLead = {
    ...base, atendimentoComercial: { id: 'entrada-1', ocorridoEm: em, fonteConferida: true, vinculoUnico: true, tipo: 'handoff',
      titulo: 'Resposta recebida', motivo: 'Condução humana', alvo: 'operador', estado: 'concluido' },
  }
  const recebida = resumirFicha(lead, agora)
  assert.equal(recebida.ultimo?.rotulo, 'Resposta recebida')
  assert.equal(recebida.dono, 'Rômulo · atendimento')
  assert.equal(recebida.prioridade, 0)
  const ambigua = resumirFicha({ ...lead, atendimentoComercial: { ...lead.atendimentoComercial!, vinculoUnico: false } }, agora)
  assert.equal(ambigua.ultimo, undefined)
  assert.equal(ambigua.revisao, true)
  const incerto = resumirFicha(base, agora, { estado: 'incerto', em })
  assert.equal(incerto.ultimo, undefined)
  assert.equal(incerto.prioridade, 1)
})
