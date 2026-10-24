import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decisoesDoEscritorio, novaRespostaEnviada, proximaDecisaoPorPrioridade, respostaJaAtendida } from './decisoes.ts'
import { notaDoAprendizado } from '../operations/aprendizado-comercial.ts'
import type { CrmLead } from '../operations/types.ts'
import type { AcaoDeVenda } from '../operations/proxima-venda.ts'
import { procedimentoDaDecisao } from './procedimento-da-decisao.ts'

const agora = Date.parse('2026-10-21T15:00:00-03:00')
const lead = (id: string, campos: Partial<CrmLead> = {}): CrmLead => ({ id, empresa: id, produto: 'site', etapa: 'contato', marcos: {}, links: {}, eventos: [], ...campos }) as CrmLead
const acao = (leadId: string, chave = leadId): AcaoDeVenda => ({ leadId, chave, titulo: 'Responder cliente', primeiroContato: false }) as AcaoDeVenda
const resposta = { ultima: { direcao: 'entrada', em: '2026-10-21T15:00:00Z', trecho: 'Podemos conversar?' } } as CrmLead['conversa']

test('uma linha por cliente prioriza respostas observadas e preserva a ação de Vendas', () => {
  const a = lead('a', { conversa: resposta }), b = lead('b'), c = lead('c', { conversa: resposta })
  const primeira = acao('b')
  const fila = decisoesDoEscritorio([a, b, c], [primeira, acao('a'), acao('b', 'outra')], agora)
  assert.deepEqual(fila.map(d => d.lead.id), ['a', 'c', 'b'])
  assert.equal(fila[2].acao, primeira)
  assert.equal(fila[0].motivo, 'Resposta recebida')
  assert.equal(fila[1].acao, null)
})

test('cliente respondido volta pela hora da nova resposta, mesmo depois de uma proposta na fila antiga', () => {
  const novo = lead('novo', { conversa: { ...resposta!, ultima: { ...resposta!.ultima, em: '2026-10-21T17:55:00Z' } } })
  const antigo = lead('antigo', { conversa: resposta })
  const proposta = lead('proposta')
  const fila = decisoesDoEscritorio([proposta, antigo, novo], [{ ...acao('proposta'), tipo: 'mandar-proposta' }, { ...acao('antigo'), tipo: 'responder' }], agora)
  assert.deepEqual(fila.map(d => d.lead.id), ['novo', 'antigo', 'proposta'])
  assert.equal(proximaDecisaoPorPrioridade(fila, 'antigo')?.lead.id, 'novo')
  assert.equal(fila.filter(d => d.lead.id === 'novo').length, 1)
})

test('nova resposta permite continuar a conversa mesmo com espera ou tarefa interna anteriores', () => {
  for (const texto of ['Esperar o retorno, sem nova cobrança', 'Revisar internamente o material']) {
    const cliente = lead('retorno', { conversa: { ...resposta!, ultimaEntrada: resposta!.ultima.em }, proximoPasso: { texto, data: '2026-10-23', registradoEm: '2026-10-21T14:00:00Z' } })
    assert.equal(decisoesDoEscritorio([cliente], [], agora)[0].estado, 'agora')
    assert.equal(procedimentoDaDecisao(cliente, new Date(agora)).tipo, 'humano')
    assert.equal(cliente.proximoPasso?.texto, texto, 'o plano continua preservado para revisão')
  }
})

test('prioridade fornecida pela fila compartilhada preserva pulo da mesma resposta', () => {
  const a = lead('a', { conversa: resposta }), b = lead('b', { conversa: resposta })
  const lista = [{ lead: b, rotulo: 'Resposta recebida', prioridade: 0 }, { lead: a, rotulo: 'Resposta recebida', prioridade: 10 }]
  assert.deepEqual(decisoesDoEscritorio([a, b], [acao('a')], agora, lista).map(d => d.lead.id), ['b', 'a'])
})

test('futuro, espera e encerrados têm destinos distintos; estoque novo fica fora das decisões', () => {
  const entradas = [lead('estoque', { etapa: 'novo' }), lead('ganho', { etapa: 'ganho' }), lead('perdido', { etapa: 'perdido' }), lead('futuro', { proximoPasso: { texto: 'Conversar com Ana', data: '2026-10-25', registradoEm: '' } }), lead('espera'), lead('hoje', { proximoPasso: { texto: 'Entregar material', data: '2026-10-21', registradoEm: '' } })]
  const fila = decisoesDoEscritorio(entradas, [], agora)
  assert.deepEqual(fila.map(d => [d.lead.id, d.estado]), [['hoje', 'agora'], ['espera', 'acompanhando'], ['futuro', 'acompanhando'], ['ganho', 'encerrada'], ['perdido', 'encerrada']])
  assert.equal(entradas[3].proximoPasso?.data, '2026-10-25')
})

test('recusa, exclusão e pausa não oferecem retomada mesmo com ação antiga', () => {
  const pausa = notaDoAprendizado({ fato: 'Pediu prazo', hipotese: 'Ainda está avaliando', teste: 'Esperar retorno', resultado: 'em-teste', pausarAteResposta: true })
  const entradas = [lead('recusa', { resposta: { tipo: 'negativa', trecho: 'Não quero' } }), lead('exclusao', { resposta: { tipo: 'exclusao', trecho: 'Remova meu número' } }), lead('pausa', { eventos: [{ tipo: 'nota', origem: 'manual', em: '2026-10-20T10:00:00Z', texto: pausa, rotulo: 'Nota', fonte: 'planilha' }] })]
  const fila = decisoesDoEscritorio(entradas, entradas.map(l => acao(l.id)), agora)
  assert.ok(fila.every(d => d.estado === 'acompanhando' && d.acao === null))
})

test('primeiro contato e ações de cliente inexistente não criam decisões; releitura move só o cliente atualizado', () => {
  const antes = [lead('a'), lead('b')]
  const acoes = [acao('a'), acao('b')]
  assert.equal(decisoesDoEscritorio([lead('novo', { etapa: 'novo' })], [{ ...acao('novo'), primeiroContato: true }, acao('inexistente')], agora).length, 0)
  const depois = decisoesDoEscritorio([{ ...antes[0], etapa: 'ganho' }, antes[1]], acoes, agora)
  assert.deepEqual(depois.map(d => [d.lead.id, d.estado]), [['b', 'agora'], ['a', 'encerrada']])
})

test('envio confirmado atende a resposta antiga; uma nova entrada volta à fila por prioridade', () => {
  const a = lead('a', { conversa: resposta }), b = lead('b', { conversa: resposta })
  const envio = { tipo: 'nota', origem: 'manual', em: '2026-10-21T15:05:00Z', texto: '[Envio confirmado pelo operador · 2026-10-21]\nExpliquei como funciona.', rotulo: 'Nota', fonte: 'planilha' } as const
  const atendido = { ...a, eventos: [envio] }
  const acoes = [{ ...acao('a'), tipo: 'responder' as const }, { ...acao('b'), tipo: 'responder' as const }]
  const fila = decisoesDoEscritorio([atendido, b], acoes, agora)
  assert.equal(fila.find(d => d.lead.id === 'a')?.estado, 'acompanhando')
  assert.equal(proximaDecisaoPorPrioridade(fila, 'a')?.lead.id, 'b')
  const novaEntrada = { ...atendido, conversa: { ...resposta!, ultima: { ...resposta!.ultima, em: '2026-10-21T15:10:00Z' } } }
  assert.equal(decisoesDoEscritorio([novaEntrada, b], acoes, agora)[0].lead.id, 'a')
  assert.equal(a.eventos.length, 0)
})

test('saída observada tira resposta antiga mesmo com fila anterior, mas preserva próximo passo vencido', () => {
  const cliente = lead('a', { conversa: { ...resposta!, ultimaEntrada: resposta!.ultima.em, ultima: { direcao: 'saida', em: '2026-10-21T15:05:00Z', trecho: 'Já respondi.' } } })
  const antiga = [{ lead: cliente, rotulo: 'Resposta recebida' }]
  assert.equal(decisoesDoEscritorio([cliente], [{ ...acao('a'), tipo: 'responder' }], agora, antiga)[0].estado, 'acompanhando')
  const comPlano = { ...cliente, proximoPasso: { texto: 'Revisar internamente o material', data: '2026-10-20', registradoEm: '' } }
  assert.equal(decisoesDoEscritorio([comPlano], [], agora)[0].estado, 'agora')
})

test('próxima decisão escolhe a primeira prioridade global, inclusive antes do item atual e fora do filtro', () => {
  const fila = decisoesDoEscritorio([lead('a'), lead('b'), lead('c')], [acao('a'), acao('b')], agora)
  assert.equal(proximaDecisaoPorPrioridade(fila, 'b')?.lead.id, 'a')
  assert.equal(proximaDecisaoPorPrioridade(fila.filter(d => d.lead.id !== 'a'), 'b'), null)
})

test('responder com texto não esconde material solicitado que ainda falta enviar', () => {
  const cliente = lead('material', { resposta: { tipo: 'licenca', trecho: 'Pode enviar o vídeo' }, links: { segunda: 'https://wa.me/5511999990000?text=Material' }, conversa: { ...resposta!, ultimaEntrada: resposta!.ultima.em, ultima: { direcao: 'saida', em: '2026-10-21T15:05:00Z', trecho: 'Já vou buscar o vídeo.' } } })
  assert.equal(decisoesDoEscritorio([cliente], [{ ...acao('material'), tipo: 'responder' }], agora)[0].estado, 'agora')
})

test('planejar retorno futuro move para acompanhamento; resposta posterior recupera prioridade', () => {
  const cliente = lead('plano', { conversa: resposta, proximoPasso: { texto: 'Conferir retorno na sexta', data: '2026-10-23', registradoEm: '2026-10-21T15:05:00Z' } })
  assert.equal(decisoesDoEscritorio([cliente], [{ ...acao('plano'), tipo: 'responder' }], agora)[0].estado, 'acompanhando')
  const novo = { ...cliente, conversa: { ...resposta!, ultima: { ...resposta!.ultima, em: '2026-10-21T15:10:00Z' } } }
  assert.equal(decisoesDoEscritorio([novo], [{ ...acao('plano'), tipo: 'responder' }], agora)[0].estado, 'agora')
})

test('saída de texto é observada sem presumir conclusão nem trocar automaticamente de cliente', () => {
  const antes = lead('a', { conversa: resposta })
  const depois = { ...antes, conversa: { ...resposta!, ultimaSaida: '2026-10-21T15:05:00Z', ultima: { direcao: 'saida' as const, em: '2026-10-21T15:05:00Z', trecho: 'Expliquei como funciona.' } } }
  assert.equal(respostaJaAtendida(depois), true, 'o envio observado dispensa novo registro manual')
  assert.equal(novaRespostaEnviada(antes, depois), false, 'enviar texto não comprova concluir o trabalho')
  const promessa = { ...depois, conversa: { ...depois.conversa, ultima: { ...depois.conversa.ultima, trecho: 'Vou preparar imagens e enviar depois.' } } }
  assert.equal(novaRespostaEnviada(antes, promessa), false)
  const confirmouMensagem = { ...promessa, eventos: [{ tipo: 'nota', origem: 'manual' as const, em: '2026-10-21T15:05:00Z', texto: '[Envio confirmado pelo operador · 2026-10-21]\nVou preparar imagens e enviar depois.', rotulo: 'Nota', fonte: 'planilha' }] }
  assert.equal(novaRespostaEnviada(antes, confirmouMensagem), false, 'confirmar o envio de texto não comprova entrega de material')
  assert.equal(novaRespostaEnviada(depois, { ...depois }), false, 'releitura do mesmo envio não avança outra vez')
  assert.equal(novaRespostaEnviada(antes, { ...depois, id: 'b' }), false, 'abrir outro cliente com envio antigo não avança')
  assert.equal(novaRespostaEnviada(undefined, depois), false)
})

test('material solicitado mantém decisão aberta mesmo sem link pronto ou ação na fila de Vendas', () => {
  const antes = lead('material', { resposta: { tipo: 'licenca', trecho: 'Pode mandar as imagens' }, conversa: resposta })
  const depois = { ...antes, conversa: { ...resposta!, ultimaEntrada: resposta!.ultima.em, ultimaSaida: '2026-10-21T15:05:00Z', ultima: { direcao: 'saida' as const, em: '2026-10-21T15:05:00Z', trecho: 'Vou preparar imagens e enviar depois.' } } }
  assert.equal(respostaJaAtendida(depois), false)
  assert.equal(novaRespostaEnviada(antes, depois), false)
  const [decisao] = decisoesDoEscritorio([depois], [], agora)
  assert.equal(decisao.estado, 'agora')
  assert.equal(decisao.motivo, 'Material solicitado ainda não enviado')
  assert.equal(decisao.acao, null, 'não inventa mensagem ou ação de contato')
  const confirmado = { ...depois, eventos: [{ tipo: 'nota', origem: 'manual' as const, em: '2026-10-21T15:06:00Z', texto: '[Envio confirmado pelo operador · 2026-10-21]\nAvisei que prepararia o material.', rotulo: 'Nota', fonte: 'planilha' }] }
  assert.equal(respostaJaAtendida(confirmado), false, 'confirmar mensagem não confirma o material solicitado')
})

test('entrega de material observada permite avanço sem exigir confirmação manual do envio', () => {
  const antes = lead('material', { resposta: { tipo: 'licenca', trecho: 'Pode enviar' }, conversa: resposta })
  const em = '2026-10-21T15:05:00Z'
  const depois = { ...antes, conversa: { ...resposta!, ultimaEntrada: resposta!.ultima.em, ultimaSaida: em, linkEm: em, ultima: { direcao: 'saida' as const, em, trecho: '[imagem]' } } }
  assert.equal(respostaJaAtendida(depois), true)
  assert.equal(novaRespostaEnviada(antes, depois), true)
  assert.equal(decisoesDoEscritorio([depois], [{ ...acao('material'), tipo: 'responder' }], agora)[0].estado, 'acompanhando')
  assert.equal(novaRespostaEnviada(depois, { ...depois }), false)
  const semMarcadorDaConversa = { ...depois, marcos: { segundaEnviada: em }, conversa: { ...depois.conversa, linkEm: undefined } }
  assert.equal(novaRespostaEnviada(antes, semMarcadorDaConversa), true, 'marco confirmado da fonte também evidencia entrega')
})

test('envio posterior não conclui compromisso ativo e uma entrega antiga não comprova a nova saída', () => {
  const antes = lead('material', { conversa: resposta })
  const em = '2026-10-21T15:05:00Z'
  const depois = { ...antes, conversa: { ...resposta!, ultimaEntrada: resposta!.ultima.em, ultimaSaida: em, linkEm: em, ultima: { direcao: 'saida' as const, em, trecho: '[imagem]' } } }
  for (const data of ['2026-10-20', '2026-10-21', '2026-10-25']) {
    const comCompromisso = { ...depois, proximoPasso: { texto: 'Revisar internamente condições da proposta', data, registradoEm: '2026-10-21T14:00:00Z' } }
    assert.equal(novaRespostaEnviada(antes, comCompromisso), false, `próximo passo ativo em ${data} não foi concluído pelo envio`)
    if (data <= '2026-10-21') assert.equal(decisoesDoEscritorio([comCompromisso], [], agora)[0].estado, 'agora')
  }
  const antiga = { ...depois, conversa: { ...depois.conversa, linkEm: '2026-10-21T14:00:00Z' } }
  assert.equal(novaRespostaEnviada(antes, antiga), false)
  const novaEntrada = { ...depois, conversa: { ...depois.conversa, ultimaEntrada: '2026-10-21T15:06:00Z', ultima: { direcao: 'entrada' as const, em: '2026-10-21T15:06:00Z', trecho: 'E as condições?' } } }
  assert.equal(novaRespostaEnviada(antes, novaEntrada), false)
})

test('material ainda pendente respeita pausa, recusa e encerramento', () => {
  const pausa = notaDoAprendizado({ fato: 'Pediu prazo', hipotese: 'Está avaliando', teste: 'Esperar retorno', resultado: 'em-teste', pausarAteResposta: true })
  const material = lead('material', { resposta: { tipo: 'licenca', trecho: 'Pode mandar' }, conversa: resposta })
  const pausado = { ...material, eventos: [{ tipo: 'nota', origem: 'manual' as const, em: '2026-10-21T15:05:00Z', texto: pausa, rotulo: 'Nota', fonte: 'planilha' }] }
  assert.equal(decisoesDoEscritorio([pausado], [], agora)[0].estado, 'acompanhando')
  const recusou = { ...material, resposta: { tipo: 'negativa' as const, trecho: 'Não quero mais' } }
  assert.equal(decisoesDoEscritorio([recusou], [], agora)[0].estado, 'acompanhando')
  assert.equal(decisoesDoEscritorio([{ ...material, etapa: 'perdido' }], [], agora)[0].estado, 'encerrada')
})

test('interesse comercial não vira pedido de material por ter um modelo de mensagem disponível', () => {
  const cliente: CrmLead & { classificacaoResposta?: { materialSolicitado: boolean } } = {
    ...lead('preco', { resposta: { tipo: 'interesse', trecho: 'Qual o valor?' }, links: { segunda: 'https://wa.me/5511999990000?text=Modelo' },
      conversa: { ...resposta!, ultimaEntrada: resposta!.ultima.em, ultima: { direcao: 'saida', em: '2026-10-21T15:05:00Z', trecho: 'Expliquei as condições.' } } }),
    classificacaoResposta: { materialSolicitado: false },
  }
  assert.equal(respostaJaAtendida(cliente), true)
  assert.equal(decisoesDoEscritorio([cliente], [], agora)[0].estado, 'acompanhando')
})

test('retorno posterior, mensagem recebida e saída histórica não são uma nova resposta enviada', () => {
  const antes = lead('a', { conversa: resposta })
  const recebeu = { ...antes, conversa: { ...resposta!, ultima: { ...resposta!.ultima, em: '2026-10-21T15:06:00Z' }, ultimaSaida: '2026-10-21T15:05:00Z' } }
  assert.equal(novaRespostaEnviada(antes, recebeu), false, 'uma nova resposta do cliente mantém a decisão aberta')
  const historico = { ...antes, conversa: { ...resposta!, ultimaSaida: '2026-10-21T14:00:00Z' } }
  assert.equal(novaRespostaEnviada(antes, historico), false)
  assert.equal(novaRespostaEnviada(antes, { ...antes, conversa: { ...resposta!, ultimaSaida: 'inválido' } }), false)
})


type LeadComLeitura = CrmLead & { classificacaoResposta?: {
  classe?: string; evidencia?: { em?: string }; revisar?: boolean; houveRespostaHumana?: boolean; materialSolicitado?: boolean
} }
function conversaAutomatica(campos: Partial<CrmLead> = {}): LeadComLeitura {
  const em = '2026-10-21T15:00:00Z'
  return { ...lead('automatico', { resposta: { tipo: 'bot', trecho: 'Mensagem automática: atendimento indisponível', em },
    conversa: { ...resposta!, ultimaEntrada: em, entradas: { gente: 1, recepcao: 0, robo: 0 }, ultima: { direcao: 'entrada', em, trecho: 'Mensagem automática: atendimento indisponível' } }, ...campos }),
    classificacaoResposta: { classe: 'robo', evidencia: { em }, revisar: false, houveRespostaHumana: false, materialSolicitado: false } }
}

test('robô confirmado na entrada atual vai para acompanhamento, preservando histórico e sem ação de contato', () => {
  const cliente = conversaAutomatica()
  const copia = structuredClone(cliente)
  const anterior = [{ lead: cliente, rotulo: 'Resposta recebida', prioridade: 0 }]
  const decisao = decisoesDoEscritorio([cliente], [{ ...acao(cliente.id), tipo: 'responder' }], agora, anterior)[0]
  assert.equal(decisao.estado, 'acompanhando')
  assert.equal(decisao.motivo, 'Resposta automática confirmada · conferir atendimento humano')
  assert.equal(decisao.acao, null)
  assert.equal(decisao.lead, cliente)
  assert.deepEqual(cliente, copia, 'o encaminhamento não reclassifica, perde ou altera o registro')
  assert.equal(proximaDecisaoPorPrioridade([decisao]), null)
})

test('marcador de robô reconhecido pelo procedimento também retira abordagem antiga da fila humana', () => {
  const cliente = conversaAutomatica()
  delete cliente.classificacaoResposta
  cliente.conversa!.ultima = { ...cliente.conversa!.ultima, papel: 'robo', trecho: '[Bot] Digite uma opção' }
  assert.equal(procedimentoDaDecisao(cliente).tipo, 'robo')
  assert.equal(decisoesDoEscritorio([cliente], [{ ...acao(cliente.id), tipo: 'responder' }], agora)[0].estado, 'acompanhando')
})

test('rótulo antigo, evidência sem data ou leitura que pede revisão não escondem uma decisão', () => {
  const base = conversaAutomatica()
  const leituras = [undefined, { ...base.classificacaoResposta!, evidencia: undefined },
    { ...base.classificacaoResposta!, evidencia: { em: '2026-10-20T15:00:00Z' } },
    { ...base.classificacaoResposta!, revisar: true }, { ...base.classificacaoResposta!, houveRespostaHumana: true }]
  for (const classificacaoResposta of leituras) {
    const cliente = { ...base, classificacaoResposta }
    assert.equal(decisoesDoEscritorio([cliente], [{ ...acao(cliente.id), tipo: 'responder' }], agora)[0].estado, 'agora')
  }
})

test('humano ou recepção posteriores superam leitura anterior de robô', () => {
  for (const papel of [undefined, 'recepcao'] as const) {
    const base = conversaAutomatica()
    const em = '2026-10-21T15:05:00Z'
    const cliente = { ...base, conversa: { ...base.conversa!, ultimaEntrada: em, ultima: { direcao: 'entrada' as const, em, trecho: 'Sou a responsável, podemos conversar?', papel } } }
    assert.equal(decisoesDoEscritorio([cliente], [], agora)[0].estado, 'agora')
    assert.equal(decisoesDoEscritorio([cliente], [], agora)[0].motivo, 'Resposta recebida')
  }
  const cliente = conversaAutomatica()
  cliente.conversa!.ultimaEntrada = '2026-10-21T15:05:00Z'
  assert.equal(decisoesDoEscritorio([cliente], [{ ...acao(cliente.id), tipo: 'responder' }], agora)[0].estado, 'agora', 'um resumo de humano posterior também impede o rebaixamento')
})

test('retorno humano informado depois do robô mantém revisão humana', () => {
  const cliente = conversaAutomatica({ eventos: [{ tipo: 'nota', origem: 'manual', em: '2026-10-21T15:05:00Z',
    texto: '[Retorno informado pelo operador · 2026-10-21]\nLigou e pediu condições.', rotulo: 'Nota', fonte: 'planilha' }] })
  assert.equal(decisoesDoEscritorio([cliente], [{ ...acao(cliente.id), tipo: 'responder' }], agora)[0].estado, 'agora')
})

test('robô atual não esconde compromisso interno vencido, material pendente, pausa ou desfecho', () => {
  const tarefa = conversaAutomatica({ proximoPasso: { texto: 'Revisar internamente condição comercial', data: '2026-10-21', registradoEm: '2026-10-21T14:00:00Z' } })
  assert.equal(decisoesDoEscritorio([tarefa], [], agora)[0].estado, 'agora')
  const material = conversaAutomatica({ resposta: { tipo: 'licenca', trecho: 'Pode mandar', em: '2026-10-21T14:00:00Z' } })
  material.classificacaoResposta!.materialSolicitado = true
  assert.equal(decisoesDoEscritorio([material], [], agora)[0].estado, 'agora')
  const pausa = notaDoAprendizado({ fato: 'Aguardar atendimento', hipotese: 'Espera', teste: 'Esperar retorno', resultado: 'em-teste', pausarAteResposta: true })
  const pausado = conversaAutomatica({ eventos: [{ tipo: 'nota', origem: 'manual', em: '2026-10-21T15:05:00Z', texto: pausa, rotulo: 'Nota', fonte: 'planilha' }] })
  assert.equal(decisoesDoEscritorio([pausado], [], agora)[0].motivo, 'Contato em espera')
  for (const etapa of ['ganho', 'perdido'] as const) assert.equal(decisoesDoEscritorio([conversaAutomatica({ etapa })], [], agora)[0].estado, 'encerrada')
  for (const tipo of ['negativa', 'exclusao'] as const) {
    const cliente = conversaAutomatica({ resposta: { tipo, trecho: 'Não contatar', em: '2026-10-21T15:00:00Z' } })
    const [decisao] = decisoesDoEscritorio([cliente], [{ ...acao(cliente.id), tipo: 'desfecho' }], agora)
    assert.equal(decisao.estado, 'agora')
    assert.equal(decisao.acao?.tipo, 'desfecho', 'a conferência explícita do desfecho permanece, sem encerrar automaticamente')
  }
})


test('papel humano explícito na entrada prevalece sobre classificação divergente de robô na mesma data', () => {
  for (const papel of ['gente', 'recepcao']) {
    const cliente = conversaAutomatica()
    // O JSON da integração pode trazer "gente", embora o contrato legado só enumere recepção e robô.
    Object.assign(cliente.conversa!.ultima, { papel, trecho: 'Sou a responsável, como funciona?' })
    const [decisao] = decisoesDoEscritorio([cliente], [{ ...acao(cliente.id), tipo: 'responder' }], agora)
    assert.equal(decisao.estado, 'agora')
    assert.equal(decisao.motivo, 'Resposta recebida')
  }
})


test('resposta automática posterior não remove proposta registrada ou etapa de proposta da cadência', () => {
  for (const campos of [
    { etapa: 'proposta' as const },
    { proposta: { em: '2026-10-20T15:00:00Z', data: '2026-10-20' } },
  ]) {
    const cliente = conversaAutomatica(campos)
    const pendente = { ...acao(cliente.id), tipo: 'proposta' as const, titulo: 'Conferir proposta sem retorno' }
    const [decisao] = decisoesDoEscritorio([cliente], [pendente], agora)
    assert.equal(decisao.estado, 'agora')
    assert.equal(decisao.acao, pendente)
    assert.notEqual(decisao.motivo, 'Resposta automática confirmada · conferir atendimento humano')
    assert.equal(cliente.etapa, campos.etapa ?? 'contato')
  }
})

test('somente a pendência de responder permite encaminhar robô; outras ações comerciais continuam visíveis', () => {
  for (const tipo of ['mandar-proposta', 'proposta', 'combinado', 'depois-do-link', 'followup', 'desfecho'] as const) {
    const cliente = conversaAutomatica()
    const pendente = { ...acao(cliente.id), tipo }
    const [decisao] = decisoesDoEscritorio([cliente], [pendente], agora)
    assert.equal(decisao.estado, 'agora', tipo)
    assert.equal(decisao.acao, pendente, tipo)
  }
})

test('segunda ação comercial pendente impede rebaixar robô mesmo com responder na primeira posição', () => {
  const cliente = conversaAutomatica()
  const respostaPendente = { ...acao(cliente.id), tipo: 'responder' as const }
  const propostaPendente = { ...acao(cliente.id), tipo: 'mandar-proposta' as const, chave: 'segunda-pendencia' }
  const [decisao] = decisoesDoEscritorio([cliente], [respostaPendente, propostaPendente], agora)
  assert.equal(decisao.estado, 'agora')
  assert.equal(decisao.acao, respostaPendente, 'preserva seleção e ordem existentes, sem ocultar o cliente')
})
