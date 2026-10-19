import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PEDIDO_DE_RESPOSTA_REVISADA, hashDoContexto, impedimentoDaMensagem, whatsappParaRevisao } from '../operations/revisao-resposta.ts'
import { rotearLocal } from '../operations/assistente.ts'
import type { CrmLead } from '../operations/types.ts'

const lead = { id: 'prumo:a', produto: 'prumo', etapa: 'contato', subEtapa: 'Respondeu', links: { whatsapp: 'https://wa.me/5511999999999' }, eventos: [], notas: 0 } as unknown as CrmLead
describe('revisão antes de abrir mensagem para cliente', () => {
  it('atalho comercial chega ao modelo sem acionar o bloqueio de finanças', () => { assert.equal(rotearLocal(PEDIDO_DE_RESPOSTA_REVISADA, 'escritorio').regra, null) })
  it('texto editado vai ao destino exato, sem link rastreado nem confirmação de envio', () => {
    const texto = 'Olá! Quem decide sobre o projeto?\nPosso falar com essa pessoa? & combinado = sim'
    const link = whatsappParaRevisao(lead.links.whatsapp, texto)
    const u = new URL(link)
    assert.equal(u.origin + u.pathname, lead.links.whatsapp)
    assert.equal(u.searchParams.get('text'), texto)
    assert.deepEqual([...u.searchParams.keys()], ['text'])
  })
  it('recusa destino externo, esquemas e textos ainda incompletos', () => {
    for (const destino of ['javascript:alert(1)', 'https://evil.test/?wa.me/5511999999999', 'https://wa.me.evil.test/5511999999999', 'https://wa.me/123', 'https://wa.me/5511999999999/click', 'https://user@wa.me/5511999999999']) assert.equal(whatsappParaRevisao(destino, 'Olá'), '')
    for (const texto of ['', 'Oi [telefone]', 'Veja [URL]', 'Olá {NOME}', 'a'.repeat(2001)]) assert.ok(impedimentoDaMensagem(texto))
    assert.equal(impedimentoDaMensagem('Uma pergunta concreta ao cliente?'), '')
  })
  it('nova mensagem, próximo passo ou destinatário invalida a revisão; passagem do tempo sozinha não', async () => {
    const original = await hashDoContexto(lead)
    assert.match(original, /^[a-f0-9]{64}$/)
    assert.equal(await hashDoContexto({ ...lead, diasNaEtapa: 10 }), original)
    for (const outro of [
      { ...lead, notas: 1 },
      { ...lead, links: { ...lead.links, raioX: 'https://demo.exemplo.com/raio-x' } },
      { ...lead, links: { whatsapp: 'https://wa.me/5511888888888' } },
      { ...lead, proximoPasso: { texto: 'Decisor pediu espera', data: '2026-10-25', registradoEm: '2026-10-18' } },
      { ...lead, resposta: { trecho: 'Não me procure mais' } } as unknown as CrmLead,
    ]) assert.notEqual(await hashDoContexto(outro), original)
  })
})

import { linkDoRaioXParaMensagem } from '../operations/revisao-resposta.ts'
it('material pendente bloqueia abertura; somente o Raio-X público da fonte pode ser inserido', () => {
  assert.ok(impedimentoDaMensagem('Segue o raio-x: [link]'))
  assert.ok(impedimentoDaMensagem('Segue o raio-x: [link do Raio-X]'))
  assert.equal(linkDoRaioXParaMensagem('https://demo.exemplo.com/raio-x'), 'https://demo.exemplo.com/raio-x')
  for (const destino of ['http://demo.exemplo.com/raio-x', 'https://localhost/raio-x', 'https://demo.exemplo.com/enviar', 'https://user:senha@demo.exemplo.com/raio-x', 'https://demo.exemplo.com/raio-x?token=segredo']) assert.equal(linkDoRaioXParaMensagem(destino), '')
})
