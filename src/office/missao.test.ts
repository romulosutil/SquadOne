import { it } from 'node:test'
import assert from 'node:assert/strict'
import { marcosDaMissao } from './missao.ts'
import type { CrmLead } from '../operations/types.ts'

it('resposta humana e material pronto não presumem envio de material nem venda', () => {
  const lead = { marcos: {}, etapa: 'contato', resposta: { tipo: 'interesse' }, links: { segunda: 'https://wa.me/exemplo', site: 'https://example.com' } } as CrmLead
  const m = marcosDaMissao(lead)
  assert.equal(m.find(x => x.id === 'conversa')?.observado, true)
  for (const id of ['material', 'proposta', 'venda']) assert.equal(m.find(x => x.id === id)?.observado, false)
})
it('cada avanço vem do registro correspondente, sem confundir mensagem automática com conversa', () => {
  const lead = { marcos: { enviado: '2026-10-18', segundaEnviada: '2026-10-18' }, etapa: 'proposta', resposta: { tipo: 'bot' } } as CrmLead
  assert.deepEqual(marcosDaMissao(lead).map(x => x.observado), [true, false, true, true, false])
})

it('material observado na conversa avança a jornada sem pedir confirmação manual', () => {
  const lead = { marcos: {}, etapa: 'contato', conversa: { mensagens: 2, linkEm: '2026-10-18T12:00:00Z' } } as CrmLead
  assert.equal(marcosDaMissao(lead).find(x => x.id === 'material')?.observado, true)
})

// 19/10/2026, a Jéssica: a 2ª mensagem do Site (Raio-X + demo) já leva o preço; mandada, a proposta foi junto.
const SEGUNDA_COM_PRECO = `https://wa.me/5511999990000?text=${encodeURIComponent('Aqui está a demonstração. O site sai por R$ 690 e R$ 39 por mês.')}`
const SEGUNDA_SEM_PRECO = `https://wa.me/5511999990000?text=${encodeURIComponent('Here is the demo: https://demo.example.com')}`

it('2ª mensagem enviada com preço conta como proposta, com o detalhe de onde veio', () => {
  const lead = { marcos: { segundaEnviada: '2026-10-16T16:37:26Z' }, etapa: 'contato', links: { segunda: SEGUNDA_COM_PRECO } } as unknown as CrmLead
  const proposta = marcosDaMissao(lead).find(x => x.id === 'proposta')
  assert.equal(proposta?.observado, true)
  assert.equal(proposta?.detalhe, 'Preço na 2ª mensagem')
  assert.equal(marcosDaMissao(lead).find(x => x.id === 'venda')?.observado, false)
})

it('preço na 2ª mensagem não basta sem a 2ª mensagem enviada; sem preço (EN, Raio-X avulso) a proposta segue por avançar', () => {
  const naoEnviada = { marcos: {}, etapa: 'contato', links: { segunda: SEGUNDA_COM_PRECO } } as unknown as CrmLead
  assert.equal(marcosDaMissao(naoEnviada).find(x => x.id === 'proposta')?.observado, false)
  const semPreco = { marcos: { segundaEnviada: '2026-10-16T16:37:26Z' }, etapa: 'contato', links: { segunda: SEGUNDA_SEM_PRECO } } as unknown as CrmLead
  assert.equal(marcosDaMissao(semPreco).find(x => x.id === 'proposta')?.observado, false)
  const linkIlegivel = { marcos: { segundaEnviada: '2026-10-16T16:37:26Z' }, etapa: 'contato', links: { segunda: 'não é url R$' } } as unknown as CrmLead
  assert.equal(marcosDaMissao(linkIlegivel).find(x => x.id === 'proposta')?.observado, false)
})

it('proposta registrada não ganha o detalhe da 2ª mensagem', () => {
  const lead = { marcos: { segundaEnviada: '2026-10-16T16:37:26Z' }, etapa: 'proposta', links: { segunda: SEGUNDA_COM_PRECO } } as unknown as CrmLead
  const proposta = marcosDaMissao(lead).find(x => x.id === 'proposta')
  assert.equal(proposta?.observado, true)
  assert.equal(proposta?.detalhe, undefined)
})
