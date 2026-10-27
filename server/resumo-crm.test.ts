import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resumirCrmEscritorio } from '../src/office/resumo-crm.ts'
import { decisoesDoEscritorio } from '../src/office/decisoes.ts'
import { conversasParaVoce } from '../src/operations/conversas-para-conduzir.ts'
import { filaDaTela } from '../src/operations/proxima-venda.ts'
import type { CrmVisao, CrmLead } from '../src/operations/types.ts'

test('resumo conserva contadores, ordem e resoluções sem transferir os dossiês', () => {
  const agora = Date.parse('2026-10-26T20:00:00Z')
  const lead: CrmLead = { id: 'site:teste', empresa: 'Cliente', produto: 'site', etapa: 'contato', links: {}, eventos: [], marcos: {}, conversa: { desde: '2026-10-26T19:00:00Z', mensagens: 1, ultima: { direcao: 'entrada', em: '2026-10-26T19:00:00Z', trecho: 'Podemos falar?' } } } as CrmLead
  const visao = { estado: 'ok', geradoEm: '2026-10-26T20:00:00Z', leads: [lead], hoje: [] } as unknown as CrmVisao
  for (const resolvidas of [{}, Object.fromEntries(filaDaTela(visao, { agora }).map(a => [a.chave, { em: agora, pulou: false }]))]) {
    const conversas = conversasParaVoce(visao, agora, resolvidas)
    const decisoes = decisoesDoEscritorio(visao.leads, filaDaTela(visao, { agora }, resolvidas).filter(a => !a.primeiroContato), agora, conversas).filter(d => d.estado === 'agora')
    const resumo = resumirCrmEscritorio(visao, agora, resolvidas)
    assert.equal(resumo.decisoes, decisoes.length); assert.equal(resumo.conversas, conversas.length)
    assert.equal(resumo.primeiraEmpresa, decisoes[0]?.lead.empresa)
    assert.ok(Buffer.byteLength(JSON.stringify(resumo)) < 240)
    assert.equal('leads' in resumo, false)
  }
  assert.equal(resumirCrmEscritorio({ ...visao, estado: 'sem-retrato', leads: [] }, agora).decisoes, 0)
})
