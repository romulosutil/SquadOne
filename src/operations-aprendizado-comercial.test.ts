import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { aprendizadoDoLead, aprendizadosDosLeads, contatoPausado, direcaoDoLead, notaDoAprendizado } from './operations/aprendizado-comercial.ts'
import { filaDeVenda } from './operations/proxima-venda.ts'
import type { CrmEvento, CrmLead } from './operations/types.ts'

const dado = { fato: 'Autorizou o link; depois não respondeu.', hipotese: 'Não confirmamos a necessidade.', teste: 'Perguntar se quer colocar no ar; sucesso = decisão explícita.', resultado: 'em-teste' as const }
const evento = (texto: string, em = '2026-10-17T12:00:00Z'): CrmEvento => ({ tipo: 'nota', texto, em, origem: 'manual', rotulo: 'Nota', fonte: 'CRM' })

describe('aprendizado comercial: evidência humana, sem inventar causa nem vencedor', () => {
  it('sobrevive à nota do CRM e preserva fato, hipótese, teste e resultado separados', () => {
    const nota = notaDoAprendizado(dado)
    assert.ok(nota.length <= 1000)
    assert.deepEqual(aprendizadoDoLead({ eventos: [evento(nota)] }), { ...dado, em: '2026-10-17T12:00:00Z' })
  })
  it('mantém a última revisão válida, mesmo com notas comuns, inválidas ou ordem invertida', () => {
    const antigo = evento(notaDoAprendizado(dado))
    const novo = evento(notaDoAprendizado({ ...dado, fato: 'Disse que não é prioridade.', resultado: 'nao-avancou' }), '2026-10-18T12:00:00Z')
    const ilegivel = evento('[aprendizado-v1] {', '2026-10-19T12:00:00Z')
    const semData = evento(notaDoAprendizado(dado), 'inválido')
    assert.equal(aprendizadoDoLead({ eventos: [novo, antigo, evento('nota comum'), ilegivel, semData] })?.resultado, 'nao-avancou')
  })
  it('não transforma anotação automática ou metadado inválido em aprendizado humano', () => {
    assert.equal(aprendizadoDoLead({ eventos: [{ ...evento(notaDoAprendizado(dado)), origem: 'automático' }] }), null)
    assert.equal(aprendizadoDoLead({ eventos: [evento('[aprendizado-v1] {"resultado":"ganhou"}')] }), null)
  })
  it('recusa campos vazios, resultado desconhecido e conteúdo que o servidor truncaria', () => {
    assert.throws(() => notaDoAprendizado({ ...dado, fato: ' ' }))
    assert.throws(() => notaDoAprendizado({ ...dado, teste: 'x'.repeat(221) }))
    assert.throws(() => notaDoAprendizado({ ...dado, resultado: 'ganhou' as never }))
    assert.throws(() => notaDoAprendizado({ ...dado, fato: '"'.repeat(220), hipotese: '"'.repeat(220), teste: '"'.repeat(220) }), /1000/)
  })
  it('conta uma revisão por lead sem converter avanço em venda', () => {
    const lead = { id: 'site:a', empresa: 'Empresa A', produto: 'site', eventos: [evento(notaDoAprendizado(dado)), evento(notaDoAprendizado({ ...dado, resultado: 'avancou' }), '2026-10-18T12:00:00Z')] } as CrmLead
    const lista = aprendizadosDosLeads([lead, { ...lead, id: 'b', eventos: [] }])
    assert.equal(lista.length, 1)
    assert.equal(lista[0].resultado, 'avancou')
    assert.equal('ganho' in lista[0], false)
  })
  it('silêncio não autoriza insistência nem prova defeito no preço; recusa encerra', () => {
    const lead = { etapa: 'contato', conversa: { ultima: { direcao: 'saida' } } } as CrmLead
    assert.match(direcaoDoLead(lead), /Silêncio não confirma a causa/)
    assert.match(direcaoDoLead({ ...lead, resposta: { tipo: 'negativa' } as CrmLead['resposta'] }), /outro lead/)
  })
  it('pausa humana remove o contato da fila; só entrada posterior ou liberação humana destrava', () => {
    const nota = evento(notaDoAprendizado({ ...dado, pausarAteResposta: true }))
    const lead = { id: 'site:a', chave: 'a', empresa: 'A', produto: 'site', etapa: 'contato', marcos: {}, links: {}, eventos: [nota] } as CrmLead
    assert.equal(contatoPausado(lead), true)
    const visao = { leads: [lead], hoje: [{ id: 'proximo', itens: [{ leadId: lead.id, acao: 'Retornar', detalhe: '', links: [], ordem: 1 }] }] } as never
    assert.equal(filaDeVenda(visao, { primeiroLiberado: true }).length, 0)
    assert.equal(contatoPausado({ ...lead, conversa: { ultimaEntrada: '2026-10-17T11:00:00Z' } as CrmLead['conversa'] }), true)
    assert.equal(contatoPausado({ ...lead, conversa: { ultimaSaida: '2026-10-18T12:00:00Z' } as CrmLead['conversa'] }), true)
    assert.equal(contatoPausado({ ...lead, conversa: { ultimaEntrada: '2026-10-18T12:00:00Z' } as CrmLead['conversa'] }), false)
    assert.equal(contatoPausado({ ...lead, eventos: [nota, evento(notaDoAprendizado({ ...dado, pausarAteResposta: false }), '2026-10-18T12:00:00Z')] }), false)
  })
})
