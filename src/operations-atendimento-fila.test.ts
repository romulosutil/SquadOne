import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CrmLead, CrmVisao } from './operations/types.ts'
import { filaDeVenda, type ContextoDaVenda } from './operations/proxima-venda.ts'
import { planoDoLead } from './operations/bi-operacao.ts'
import { procedimentoDaDecisao } from './office/procedimento-da-decisao.ts'
import { decisoesDoEscritorio } from './office/decisoes.ts'
import { acaoInternaComercial } from './operations/acao-interna-comercial.ts'
import { contatoPausado, notaDoAprendizado } from './operations/aprendizado-comercial.ts'
import { VERSAO_CLASSIFICACAO_RESPOSTA } from './operations/classificacao-resposta.ts'

// Integração entre regras puras das superfícies reais; nenhum modelo, envio ou escrita de CRM.
const AGORA = Date.parse('2026-10-24T15:00:00Z')
const EM = '2026-10-24T14:00:00Z'
function lead(extra: Partial<CrmLead> = {}): CrmLead {
  return {
    id: 'site:atendimento-fixture', chave: 'atendimento-fixture', empresa: 'Empresa de teste', produto: 'site',
    nicho: 'teste', cidade: 'Vitória', etapa: 'contato', sinal: 'em-conversa', subEtapa: 'Em conversa',
    estadoNaPlanilha: 'contato', leitura: 'pela-resposta', followupHoje: false, respostaNova: true,
    acervo: false, notas: 0, divergencias: [], eventos: [], marcos: { enviado: '2026-10-23T14:00:00Z' },
    links: { whatsapp: 'https://wa.me/5500000000000', segunda: 'https://example.test/material' },
    resposta: { tipo: 'interesse', trecho: 'Quanto fica?', em: EM },
    conversa: { desde: EM, mensagens: 1, ultimaEntrada: EM,
      ultima: { em: EM, direcao: 'entrada', trecho: 'Quanto fica?' } },
    classificacaoResposta: { versao: VERSAO_CLASSIFICACAO_RESPOSTA, classe: 'interesse',
      motivo: 'Pergunta comercial na conversa de teste.', evidencia: { em: EM, trecho: 'Quanto fica?' },
      houveRespostaHumana: true, materialSolicitado: false, revisar: false, leituraConfirmada: true },
    atendimentoComercial: { id: 'tarefa-preco-1', tipo: 'handoff', titulo: 'Rômulo: conferir o pedido de preço',
      motivo: 'Negociação exige revisão humana.', alvo: 'operador', texto: 'Rascunho interno que não autoriza contato.', estado: 'pendente' },
    ...extra,
  }
}
function visao(cliente: CrmLead): Pick<CrmVisao, 'leads' | 'hoje'> {
  return { leads: [cliente], hoje: ['resposta', 'proposta', 'followup'].map(id => ({
    id: id as 'resposta' | 'proposta' | 'followup', titulo: id, explicacao: '',
    itens: [{ leadId: cliente.id, acao: 'Sugestão legada de contato', detalhe: '', ordem: 0, links: [] }],
  })) }
}
function contexto(cliente: CrmLead): ContextoDaVenda {
  return { primeiroLiberado: false, agora: AGORA, sugestoes: new Map([[cliente.id, {
    mensagem: 'Mensagem de modelo que não pode aparecer neste cartão.', porque: 'Fixture do modelo', quando: 'Agora',
    momento: { quem: 'decisor', leitura: 'Sugestão antiga', passo: 'Enviar proposta antiga' },
  }]]) }
}
function pausa(): CrmLead['eventos'] {
  return [{ tipo: 'nota', origem: 'manual', em: '2026-10-24T14:30:00Z', rotulo: 'Pausa confirmada', fonte: 'fixture',
    texto: notaDoAprendizado({ fato: 'Aguardar retorno.', hipotese: 'A pessoa responderá quando puder.',
      teste: 'Revisar internamente.', resultado: 'em-teste', pausarAteResposta: true }) }]
}

function conferirAcaoInterna(cliente: CrmLead) {
  const acoes = filaDeVenda(visao(cliente), contexto(cliente))
  assert.equal(acoes.length, 1, 'a tarefa substitui sugestões antigas de contato do mesmo lead')
  const acao = acoes[0]
  assert.equal(acao.chave, `${cliente.id}|${cliente.atendimentoComercial!.id}|atendimento-comercial`)
  assert.equal(acaoInternaComercial(acao), true)
  assert.equal(acao.interna, true)
  assert.equal(acao.tipo, 'combinado')
  assert.equal(acao.primeiroContato, false)
  assert.equal(acao.rascunho, undefined)
  assert.equal(acao.link, undefined)
  assert.equal(acao.copiloto, undefined)
  assert.equal(acao.anota, undefined)
  return acao
}

describe('atendimento comercial nas superfícies de decisão', () => {
  it('fila mantém atendimento interno sem texto de envio ou link mesmo com sugestão do modelo', () => {
    const cliente = lead()
    const antes = JSON.stringify(cliente)
    const acao = conferirAcaoInterna(cliente)
    assert.equal(acao.titulo, cliente.atendimentoComercial!.titulo)
    assert.equal(acao.quente, true)
    assert.equal(JSON.stringify(cliente), antes, 'a projeção não confirma fatos nem grava fonte')
  })

  it('nova tarefa do mesmo lead muda a chave sem reaproveitar a tarefa anterior', () => {
    const cliente = lead()
    const primeira = conferirAcaoInterna(cliente)
    const segunda = conferirAcaoInterna({ ...cliente,
      atendimentoComercial: { ...cliente.atendimentoComercial!, id: 'tarefa-contrato-2', titulo: 'Conferir o contrato' } })
    assert.notEqual(primeira.chave, segunda.chave)
    assert.equal(segunda.titulo, 'Conferir o contrato')
  })

  for (const [nome, extra] of [
    ['conversa aberta', {}],
    ['contato pausado', { eventos: pausa() }],
    ['venda ganha', { etapa: 'ganho' }],
    ['conversa perdida', { etapa: 'perdido' }],
    ['recusa registrada', { resposta: { tipo: 'negativa', trecho: 'Não tenho interesse.', em: EM },
      classificacaoResposta: { ...lead().classificacaoResposta!, classe: 'recusa' } }],
    ['exclusão registrada', { resposta: { tipo: 'exclusao', trecho: 'Não me contate.', em: EM },
      classificacaoResposta: { ...lead().classificacaoResposta!, classe: 'exclusao' } }],
  ] satisfies Array<[string, Partial<CrmLead>]>) {
    it(`${nome}: tarefa permanece visível para conferência interna sem reabrir contato`, () => {
      const cliente = lead(extra)
      const antes = JSON.stringify(cliente)
      if (nome === 'contato pausado') assert.equal(contatoPausado(cliente), true)
      const acao = conferirAcaoInterna(cliente)
      const plano = planoDoLead(cliente, AGORA)
      assert.equal(plano.tipo, 'conferir')
      assert.equal(plano.prioridade, 0)
      assert.equal(plano.responsavel, 'Rômulo')
      assert.equal(procedimentoDaDecisao(cliente, new Date(AGORA)).tipo, 'interno')
      const decisoes = decisoesDoEscritorio([cliente], [acao], AGORA)
      assert.equal(decisoes.length, 1)
      assert.equal(decisoes[0].estado, 'agora')
      assert.equal(decisoes[0].acao, acao)
      assert.equal(JSON.stringify(cliente), antes, 'desfecho, recusa, pausa e histórico permanecem intactos')
    })
  }

  it('escritório conserva a tarefa agora mesmo sem receber a fila de ações pronta', () => {
    const cliente = lead({ etapa: 'perdido', eventos: pausa() })
    const [decisao] = decisoesDoEscritorio([cliente], [], AGORA)
    assert.equal(decisao.estado, 'agora')
    assert.equal(decisao.motivo, cliente.atendimentoComercial!.titulo)
    assert.equal(decisao.acao?.rascunho, undefined)
    assert.equal(decisao.acao?.link, undefined)
  })
})