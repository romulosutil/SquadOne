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

// O template de agora não reconstrói o preço de uma mensagem enviada no passado.
const SEGUNDA_COM_PRECO = `https://wa.me/5511999990000?text=${encodeURIComponent('Aqui está a demonstração. O site sai por R$ 690 e R$ 39 por mês.')}`
const SEGUNDA_SEM_PRECO = `https://wa.me/5511999990000?text=${encodeURIComponent('Here is the demo: https://demo.example.com')}`

it('material enviado com preço não comprova proposta nem venda', () => {
  const lead = { marcos: { segundaEnviada: '2026-10-16T16:37:26Z' }, etapa: 'contato', links: { segunda: SEGUNDA_SEM_PRECO },
    conversa: { ultima: { direcao: 'saida', em: '2026-10-16T13:37:26-03:00', trecho: 'Aqui está a demonstração. O site sai por R$ 690 e R$ 39 por mês.' } },
  } as unknown as CrmLead
  const proposta = marcosDaMissao(lead).find(x => x.id === 'proposta')
  assert.equal(proposta?.observado, false)
  assert.equal(proposta?.detalhe, undefined)
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

it('template com preço não cria proposta para material enviado sem texto preservado', () => {
  for (const material of [{ marcos: { segundaEnviada: '2026-10-16T16:37:26Z' } },
    { marcos: {}, conversa: { linkEm: '2026-10-16T16:37:26Z' } }]) {
    const lead = { ...material, etapa: 'contato', links: { segunda: SEGUNDA_COM_PRECO } } as unknown as CrmLead
    assert.equal(marcosDaMissao(lead).find(x => x.id === 'material')?.observado, true)
    assert.equal(marcosDaMissao(lead).find(x => x.id === 'proposta')?.observado, false)
  }
})

it('material observado sem preço não herda o preço do rascunho atual', () => {
  const lead = { marcos: {}, etapa: 'contato', links: { segunda: SEGUNDA_COM_PRECO }, conversa: {
    linkEm: '2026-10-16T16:37:26Z', ultima: { direcao: 'saida', em: '2026-10-16T16:37:26Z', trecho: 'Aqui está o Raio-X que você pediu: https://example.com/raio-x' },
  } } as unknown as CrmLead
  assert.equal(marcosDaMissao(lead).find(x => x.id === 'proposta')?.observado, false)
})

it('preço no material histórico não vira proposta após a resposta do cliente', () => {
  const lead = { marcos: {}, etapa: 'contato', conversa: {
    linkEm: '2026-10-16T16:37:26Z', recentes: [
      { direcao: 'saida', em: '2026-10-16T16:37:26Z', trecho: 'O site sai por R$ 690 e R$ 39 por mês: https://example.com' },
      { direcao: 'entrada', em: '2026-10-16T16:40:00Z', trecho: 'Vou avaliar com meu sócio.' },
    ], ultima: { direcao: 'entrada', em: '2026-10-16T16:40:00Z', trecho: 'Vou avaliar com meu sócio.' },
  } } as unknown as CrmLead
  const proposta = marcosDaMissao(lead).find(x => x.id === 'proposta')
  assert.equal(proposta?.observado, false)
  assert.equal(proposta?.detalhe, undefined)
})

it('preço recebido, outra saída e timestamp inválido não comprovam preço na 2ª mensagem', () => {
  for (const mensagem of [
    { direcao: 'entrada', em: '2026-10-16T16:37:26Z', trecho: 'O concorrente cobra R$ 90 por mês.' },
    { direcao: 'saida', em: '2026-10-16T17:00:00Z', trecho: 'O concorrente cobra R$ 90 por mês?' },
    { direcao: 'saida', em: 'inválido', trecho: 'O site sai por R$ 690.' },
    { direcao: 'saida', em: '2026-10-16T16:37:26Z', trecho: 'O valor em R$ será confirmado depois.' },
  ]) {
    const lead = { marcos: { segundaEnviada: '2026-10-16T16:37:26Z' }, etapa: 'contato',
      links: { segunda: SEGUNDA_COM_PRECO }, conversa: { ultima: mensagem },
    } as unknown as CrmLead
    assert.equal(marcosDaMissao(lead).find(x => x.id === 'proposta')?.observado, false, mensagem.trecho)
  }
})

it('registro explícito mantém proposta observada sem trecho, material ou template', () => {
  for (const registro of [{ etapa: 'contato', proposta: { em: '2026-10-16T16:37:26Z', data: '2026-10-16' } },
    { etapa: 'proposta' }, { etapa: 'ganho' }]) {
    const lead = { marcos: {}, ...registro } as unknown as CrmLead
    const proposta = marcosDaMissao(lead).find(x => x.id === 'proposta')
    assert.equal(proposta?.observado, true)
    assert.equal(proposta?.detalhe, undefined)
  }
})

it('preço de concorrente, reembolso e rascunho nunca substituem o registro da proposta', () => {
  for (const trecho of [
    'Aqui está o diagnóstico: https://example.com. O concorrente cobra R$ 90 por mês; nossa proposta ainda será definida.',
    'O reembolso de R$ 90 foi solicitado. Segue o documento: https://example.com.',
    'Rascunho para avaliar: site por R$ 690 e R$ 39 por mês. Ainda não é nossa proposta.',
  ]) {
    const em = '2026-10-16T16:37:26Z'
    const lead = { marcos: { segundaEnviada: em }, etapa: 'contato', links: { segunda: SEGUNDA_COM_PRECO },
      conversa: { linkEm: em, ultima: { direcao: 'saida', em, trecho } },
    } as unknown as CrmLead
    assert.equal(marcosDaMissao(lead).find(x => x.id === 'proposta')?.observado, false, trecho)
    assert.equal(marcosDaMissao({ ...lead, proposta: { em, data: '2026-10-16' } }).find(x => x.id === 'proposta')?.observado, true)
  }
})
