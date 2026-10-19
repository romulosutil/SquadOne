import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { encerramentoAtual, protecaoDaDemo, revisaoComercialDoLead } from './protecao-comercial.ts'
import { filaDeVenda, agoraDaFicha, esperaOCopiloto } from '../src/operations/proxima-venda.ts'
import type { CrmLead } from './crm.ts'

const agora = Date.parse('2026-10-18T12:00:00Z')
const lead = (extra: Partial<CrmLead> = {}): CrmLead => ({
  id: 'site:teste', produto: 'site', chave: 'teste', empresa: 'Negócio de teste', nicho: '', cidade: '',
  etapa: 'perdido', sinal: 'recusou', subEtapa: 'Recusou', motivoPerda: 'recusou', estadoNaPlanilha: 'recusado',
  leitura: 'pela-resposta', marcos: { respondeu: '2026-10-14T18:16:44Z' }, followupHoje: false, respostaNova: false,
  acervo: false, notas: 0, eventos: [], links: {}, divergencias: [],
  resposta: { tipo: 'negativa', trecho: 'Não clico em link nenhum', em: '2026-10-14T18:16:44Z' },
  conversa: { desde: '2026-10-14T18:15:00Z', mensagens: 33, ultimaEntrada: '2026-10-15T20:11:00Z', ultima: { direcao: 'saida', em: '2026-10-15T20:11:08Z', trecho: 'Fico no aguardo' } },
  ...extra,
})
const final = { tipo: 'recusou', rotulo: 'Recusou', origem: 'manual' as const, fonte: 'CRM', em: '2026-10-16T12:00:00Z' }

describe('contexto comercial protege oportunidade e muda a próxima ação', () => {
  it('conversa posterior à recusa exige revisão; nunca transforma automaticamente em interesse', () => {
    const l = lead()
    l.revisaoComercial = revisaoComercialDoLead(l, agora)
    assert.match(l.revisaoComercial!, /conversa continuou/)
    assert.ok(protecaoDaDemo(l))
    assert.equal(l.resposta?.tipo, 'negativa', 'a leitura não reescreve a fonte')
    const fila = filaDeVenda({ leads: [l], hoje: [] }, { agora, primeiroLiberado: true })
    assert.equal(fila.length, 1)
    assert.equal(fila[0].conferirHistorico, true)
    assert.equal(esperaOCopiloto(fila[0]), false)
    for (const campo of ['anota', 'link', 'rascunho', 'copiloto']) assert.equal(campo in fila[0], false)
  })
  it('segundos de diferença no registro da mesma resposta não criam conversa nova', () => {
    const l = lead({
      conversa: undefined,
      resposta: { tipo: 'negativa', trecho: 'Sem interesse', em: '2026-10-14T16:49:18Z' },
      marcos: { respondeu: '2026-10-14T16:49:20Z' },
    })
    assert.equal(revisaoComercialDoLead(l, agora), undefined)
    assert.match(revisaoComercialDoLead({ ...l, marcos: { respondeu: '2026-10-14T16:51:20Z' } }, agora)!, /conversa continuou/)
  })
  it('encerramento atual libera; resposta ou proposta posterior e desfazer voltam a proteger', () => {
    assert.equal(encerramentoAtual(lead({ eventos: [final] })), true)
    assert.equal(protecaoDaDemo(lead({ eventos: [final] })), undefined)
    assert.equal(encerramentoAtual(lead({ eventos: [{ ...final, em: '2026-10-15T12:00:00Z' }] })), false)
    assert.equal(encerramentoAtual(lead({ eventos: [final], proposta: { em: '2026-10-17T12:00:00Z', data: '2026-10-17' } })), false)
    assert.equal(encerramentoAtual(lead({ eventos: [final, { ...final, tipo: 'recusou_desfeito', em: '2026-10-17T12:00:00Z' }] })), false)
    assert.ok(protecaoDaDemo(lead({ eventos: [final], proximoPasso: { texto: 'Comparar propostas', data: '2026-10-19', registradoEm: '2026-10-17T12:00:00Z' } })))
  })
  it('silêncio numa conversa pede revisão de compromisso; robô não vira conversa humana', () => {
    const l = lead({ etapa: 'contato', sinal: 'respondeu', marcos: { respondeu: '2026-10-01T12:00:00Z' }, resposta: { tipo: 'neutra', em: '2026-10-01T12:00:00Z', trecho: 'Vou conferir' }, conversa: { ...lead().conversa!, ultimaEntrada: '2026-10-01T12:00:00Z' } })
    assert.match(revisaoComercialDoLead(l, agora)!, /último combinado/)
    assert.equal(revisaoComercialDoLead({ ...l, proximoPasso: { texto: 'Aguardar até segunda', data: '2026-10-19', registradoEm: '2026-10-17T12:00:00Z' } }, agora), undefined)
    assert.ok(protecaoDaDemo(lead({ resposta: { tipo: 'bot', em: '2026-10-14T12:00:00Z', trecho: '' }, marcos: {}, conversa: undefined, motivoPerda: 'expirou' })), 'sem arquivo, não se presume que só o robô respondeu')
    assert.equal(protecaoDaDemo(lead({ resposta: { tipo: 'bot', em: '2026-10-14T12:00:00Z', trecho: '' }, marcos: {}, conversa: { desde: '2026-10-14T12:00:00Z', mensagens: 1, ultima: { direcao: 'entrada', papel: 'robo', em: '2026-10-14T12:00:00Z', trecho: 'Atendimento' } }, motivoPerda: 'expirou' })), undefined)
  })
  it('encerramento posterior resolve o compromisso antigo; compromisso mais novo volta a proteger', () => {
    const l = lead({ eventos: [{ ...final, em: '2026-10-18T12:00:00Z' }], proximoPasso: { texto: 'Aguardar comparação', data: '2026-10-19', registradoEm: '2026-10-17T12:00:00Z' } })
    assert.equal(protecaoDaDemo(l), undefined)
    assert.ok(protecaoDaDemo({ ...l, proximoPasso: { ...l.proximoPasso!, registradoEm: '2026-10-18T12:01:00Z' } }))
  })
  it('pausa conserva o próximo passo literal e tira o contato da fila', () => {
    const l = lead({ proximoPasso: { texto: 'Aguardar a comparação, sem nova cobrança.', data: '2026-10-19', registradoEm: '2026-10-18T12:00:00Z' }, eventos: [{ ...final, tipo: 'nota', em: '2026-10-18T12:00:00Z', texto: '[aprendizado-v1] {"fato":"Comparação pendente","hipotese":"Decisão conjunta","teste":"Aguardar resposta","resultado":"inconclusivo","pausarAteResposta":true}' }] })
    assert.match(agoraDaFicha(l, null).frase, /Aguardar a comparação, sem nova cobrança/)
    assert.deepEqual(filaDeVenda({ leads: [l], hoje: [] }, { agora, primeiroLiberado: true }), [])
  })
})
