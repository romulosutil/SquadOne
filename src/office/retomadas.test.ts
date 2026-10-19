import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CrmLead } from '../operations/types.ts'
import { diaEmSP, passosFuturosDaSala, retomadaDoLead, retomadasDaSala, PEDIDO_DE_RETOMADA, rotuloDoPasso } from '../operations/retomadas.ts'
import { rotearLocal } from '../operations/assistente.ts'
const agora = new Date('2026-10-19T01:00:00Z')
test('espera e revisão interna não recebem rótulo de abordagem ao cliente', () => {
  assert.equal(rotuloDoPasso('Esperar comparação, sem nova cobrança; revisar internamente.', true), 'Conferir combinado de espera')
  assert.equal(rotuloDoPasso('Revisão interna da proposta.', true), 'Revisar tarefa interna de amanhã')
  assert.equal(rotuloDoPasso('Ligar conforme combinado'), 'Conferir próximo passo')
  assert.equal(rotuloDoPasso('Conferir entrega do Raio-X; se couber, entregar o link. Não mandar outra cobrança de gostou.'), 'Conferir próximo passo')
})
const lead = { id: 'prumo:qa', empresa: 'Cliente', etapa: 'contato', eventos: [], proximoPasso: { texto: 'Confirmar horário com o responsável', data: '2026-10-18', registradoEm: '2026-10-17T12:00:00Z' } } as unknown as CrmLead
test('hoje usa São Paulo, sem antecipar o dia UTC', () => { assert.equal(diaEmSP(agora), '2026-10-18'); assert.equal(retomadaDoLead(lead, agora)?.quando, 'hoje') })
test('ignora planos futuros, encerrados, vazios e datas inválidas', () => {
  for (const mod of [{ etapa: 'ganho' }, { etapa: 'perdido' }, { proximoPasso: undefined }, { proximoPasso: { ...lead.proximoPasso!, data: '2026-10-19' } }, { proximoPasso: { ...lead.proximoPasso!, data: '2026-02-30' } }, { proximoPasso: { ...lead.proximoPasso!, texto: '' } }]) assert.equal(retomadaDoLead({ ...lead, ...mod } as CrmLead, agora), null)
})
test('ordena atrasados e pede conferência quando houve interação depois do plano', () => {
  const antigo = { ...lead, id: 'prumo:antigo', proximoPasso: { ...lead.proximoPasso!, data: '2026-10-16' }, resposta: { tipo: 'neutra' as const, trecho: 'Já resolvemos', em: '2026-10-18T10:00:00Z' } }
  const fila = retomadasDaSala([lead, antigo], agora)
  assert.equal(fila[0].lead.id, lead.id); assert.equal(fila[0].conferir, false); assert.equal(fila[1].conferir, true); assert.equal(fila[1].quando, 'atrasado')
  assert.equal(rotearLocal(PEDIDO_DE_RETOMADA, 'escritorio').regra, null)
})


test('futuros separam amanhã pelo dia de São Paulo e mantêm todos os dias seguintes ordenados', () => {
  const criar = (id: string, data: string, etapa = 'contato', texto = 'Conferir decisão') => ({ ...lead, id, etapa, proximoPasso: { texto, data, registradoEm: '2026-10-17T12:00:00Z' } }) as CrmLead
  const entradas = [criar('depois', '2026-10-22'), criar('amanha', '2026-10-19'), criar('hoje', '2026-10-18'), criar('antigo', '2026-10-16'), criar('longe', '2027-01-05'), criar('encerrado', '2026-10-20', 'ganho'), criar('sem-texto', '2026-10-19', 'contato', ''), criar('invalido', '2026-02-30')]
  const futuros = passosFuturosDaSala(entradas, agora)
  assert.deepEqual(futuros.map(p => [p.lead.id, p.quando]), [['amanha', 'amanha'], ['depois', 'depois'], ['longe', 'depois']])
  assert.equal(retomadasDaSala(entradas, agora).some(p => futuros.some(f => f.lead.id === p.lead.id)), false)
  const virada = passosFuturosDaSala([criar('ano-novo', '2027-01-01')], new Date('2027-01-01T01:00:00Z'))
  assert.equal(virada[0].quando, 'amanha')
  assert.equal(entradas[1].proximoPasso?.data, '2026-10-19', 'a leitura não antecipa ou altera a data')
})

test('plano futuro avisa sobre interação posterior sem antecipar sua data', () => {
  const futuro = { ...lead, proximoPasso: { ...lead.proximoPasso!, data: '2026-10-20' }, resposta: { tipo: 'neutra' as const, trecho: 'Podemos falar agora?', em: '2026-10-18T12:00:00Z' } }
  const [passo] = passosFuturosDaSala([futuro], agora)
  assert.equal(passo.conferir, true)
  assert.equal(passo.data, '2026-10-20')
  assert.equal(passosFuturosDaSala([{ ...futuro, resposta: undefined }], agora)[0].conferir, false)
})
