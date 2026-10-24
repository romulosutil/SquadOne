import type { CrmLead, CrmVisao } from './types'
import { type ClasseDaResposta, ROTULOS_DA_CLASSIFICACAO } from './classificacao-resposta'
import { revisaoRetomadaDoLead } from './revisao-retomadas'
import { procedimentoDaDecisao } from '../office/procedimento-da-decisao'
import { lacunasDoSpiced } from './spiced'
import { diaEmSP } from './retomadas'

const DIA = 86_400_000
const instante = (v?: string) => Date.parse(v ?? '')
export type PeriodoBi = '7' | '30' | 'tudo'
export interface PlanoBi {
  lead: CrmLead; tipo: 'agir' | 'conferir' | 'aguardar' | 'encerrado'; prioridade: number
  acao: string; evidencia: string; resultado: string; responsavel: string; prazo: string
  condicao?: string
}
/** Uma orientação rastreável por cliente. Não autoriza contato nem substitui o gate de envio. */
export function planoDoLead(lead: CrmLead, agora = Date.now()): PlanoBi {
  const p = procedimentoDaDecisao(lead, new Date(agora))
  const r = revisaoRetomadaDoLead(lead, agora)
  const c = lead.classificacaoResposta
  const base = { lead, responsavel: 'Rômulo', prazo: 'Na próxima revisão', evidencia: c?.evidencia?.trecho || lead.conversa?.ultima.trecho || c?.motivo || 'Sem trecho de conversa preservado.' }
  const plano = (tipo: PlanoBi['tipo'], prioridade: number, acao: string, resultado: string, extra: Partial<PlanoBi> = {}): PlanoBi => ({ ...base, tipo, prioridade, acao, resultado, ...extra })
  if (p.tipo === 'encerrado' || c?.classe === 'recusa' || c?.classe === 'exclusao') return plano('encerrado', 99, 'Preservar o desfecho e conferir o motivo registrado', 'Histórico correto; sem nova abordagem.')
  if (p.tipo === 'espera') return plano('aguardar', 90, lead.proximoPasso?.texto || p.titulo, 'Aguardar a condição ou nova abertura; revisar antes de contato.', { prazo: lead.proximoPasso?.data || 'Até nova resposta' })
  if (r && !r.atual) return plano('conferir', 2, 'Atualizar a revisão com as mensagens e registros posteriores', 'Novo próximo passo baseado no contexto atual.', { evidencia: `A revisão de ${r.em.slice(0,10)} perdeu validade após mudança de contexto.`, prazo: 'Antes de retomar' })
  if (r?.atual) {
    const tipo = r.grupo === 'aguardar' || r.grupo === 'nao-priorizar' ? 'aguardar' : r.grupo === 'retomar' ? 'agir' : 'conferir'
    const resultado = r.grupo === 'retomar' ? 'Necessidade e próximo compromisso esclarecidos pelo cliente.' : r.grupo === 'encaminhamento' ? 'Destino e responsável confirmados.' : tipo === 'aguardar' ? 'Nova abertura ou condição de espera confirmada.' : 'Histórico suficiente para escolher o próximo passo.'
    return plano(tipo, tipo === 'aguardar' ? 90 : 1, r.proximo, resultado, { evidencia: r.fato, condicao:r.condicao, prazo: tipo === 'aguardar' ? 'Até a condição registrada' : 'Antes do próximo contato' })
  }
  if (p.tipo === 'audio') return plano('conferir', 2, 'Ouvir o áudio e recuperar o conteúdo antes de responder', 'Conteúdo conhecido e leitura contextual atualizada.')
  if (p.tipo === 'interno') return plano('agir', 1, lead.proximoPasso!.texto, p.resultadoEsperado, { prazo: lead.proximoPasso!.data, responsavel: 'Rômulo + time' })
  if (c?.revisar || c?.classe === 'pendente' || !lead.conversa && !!lead.marcos.enviado) return plano('conferir', 3, 'Conferir o histórico disponível e identificar a última pergunta', 'Contexto suficiente para escolher a resposta; sem contato por suposição.', { prazo: 'Antes de responder' })
  if (p.tipo === 'robo' || c?.classe === 'robo') return plano('conferir', 5, 'Conferir o canal e o caminho de acesso a uma pessoa', 'Responsável ou encaminhamento identificado; menu não conta como comprador.')
  if (!Number.isFinite(instante(lead.marcos.enviado))) return plano('aguardar', 95, 'Aguardar a seleção e a validação do primeiro contato pelo time', 'Aderência, destino e mensagem conferidos.', { responsavel: lead.produto === 'plus' ? 'Rômulo' : 'Diego · Elisa · Carla' })
  const entrada = instante(lead.conversa?.ultimaEntrada)
  const saida = instante(lead.conversa?.ultimaSaida)
  const respondeuDepois = Number.isFinite(saida) && Number.isFinite(entrada) && saida >= entrada
  const material = Math.max(instante(lead.conversa?.linkEm) || 0, instante(lead.marcos.segundaEnviada) || 0)
  const permissao = instante(c?.evidencia?.em)
  if (c?.materialSolicitado && Number.isFinite(permissao) && material < permissao && !respondeuDepois) return plano('agir', 0, 'Conferir o pedido e preparar somente o material autorizado', 'Entrega do material específico observada na conversa.', { prazo: 'Agora, após conferir o contexto' })
  const hoje = diaEmSP(new Date(agora))
  const data = lead.proximoPasso?.data
  const devido = !!data && /^\d{4}-\d{2}-\d{2}$/.test(data) && Number.isFinite(instante(`${data}T12:00:00Z`)) && new Date(`${data}T12:00:00Z`).toISOString().slice(0,10) === data && data <= hoje
  if (devido) return plano('agir', 1, lead.proximoPasso!.texto, 'Compromisso resolvido ou próximo passo revisto com data.', { prazo: data! })
  if (lead.etapa === 'proposta') return plano('conferir', 4, 'Revisar a proposta, a qualificação e o próximo compromisso', 'Decisor, pendência e data de retorno confirmados; seguir a cadência existente.')
  if (respondeuDepois || c?.classe === 'silencio') return plano('aguardar', 80, 'Acompanhar a resposta; conferir o contexto antes de qualquer retomada', 'Nova entrada ou compromisso confirmado.', { prazo: 'Até resposta ou compromisso', evidencia: lead.conversa?.ultima.trecho || base.evidencia })
  if (c?.houveRespostaHumana) {
    const acao = c.classe === 'acesso' ? 'Validar quem decide e fazer uma pergunta sobre a rotina atual'
      : c.classe === 'conversa' ? 'Conferir o pedido de conversa e combinar um horário'
      : c.classe === 'permissao' || c.classe === 'curiosidade' ? 'Responder ao pedido específico e perguntar onde isso ajudaria na rotina'
      : 'Responder à última pergunta e confirmar a necessidade antes da proposta'
    return plano('agir', 0, acao, lacunasDoSpiced(lead).length ? `Próxima descoberta: ${lacunasDoSpiced(lead).join(', ')}.` : 'Próximo compromisso aceito pelo cliente.', { prazo: 'Agora, após conferir o contexto' })
  }
  return plano('conferir', 6, 'Recuperar a última troca antes de escolher a mensagem', 'Pergunta, interlocutor e próximo passo conhecidos.')
}

export interface LinhaBi {
  chave: string; leads: CrmLead[]; enviados: number; maduros: number; recentes: number
  humanos: number; interesse: number; robos: number; recusas: number; semArquivo: number; taxa: number | null
}
export interface EscolhaBi {
  id: string; empresa: string; produto: string; estado: string; nota: number; motivo?: string; mensagem?: string
  enviadoEm?: string; avaliacoes?: { agente: string; nota: number; motivo: string }[]
}
export interface FrenteBi {
  estado: string; atualizadoEm: string | null; limite?: number; intervaloMinutos?: number; porHora?: number
  avaliados?: number; selecionados?: number; enviados?: number; fila: EscolhaBi[]
  rodada?: { inicio: string | null; limite: number; pendentes: number; bloqueado: boolean; motivo: string; clientes: { leadId: string; reservadoEm: string }[] } | null
  rodadaIndisponivel?: boolean
}
export function classeBi(lead: CrmLead): ClasseDaResposta {
  return lead.classificacaoResposta?.classe ?? 'pendente'
}
/** Apenas envios com data válida, até a captura; janela por primeiro envio, não por última atividade. */
export function enviadosBi(leads: readonly CrmLead[], periodo: PeriodoBi, agora: number) {
  return leads.filter(l => { const em = instante(l.marcos.enviado); return em <= agora && (periodo === 'tudo' || em >= agora - Number(periodo) * DIA) })
}
export function linhasBi(leads: readonly CrmLead[], por: 'produto' | 'nicho' | 'mensagem', agora: number): LinhaBi[] {
  const grupos = new Map<string, CrmLead[]>()
  for (const lead of leads) {
    // Mensagens são comparadas dentro da oferta e do regime; a letra isolada não identifica um texto.
    const chave = por === 'mensagem' ? `${lead.produto} · ${lead.abordagem?.regime || 'regime desconhecido'} · ${lead.abordagem?.mensagem || 'sem variante'}` : lead[por]?.trim() || 'Não informado'
    grupos.set(chave, [...(grupos.get(chave) ?? []), lead])
  }
  return [...grupos].map(([chave, todos]) => {
    const maduros = todos.filter(l => agora - instante(l.marcos.enviado) >= 2 * DIA)
    const humanos = maduros.filter(l => l.classificacaoResposta?.houveRespostaHumana).length
    return { chave, leads: todos, enviados: todos.length, maduros: maduros.length, recentes: todos.length - maduros.length, humanos,
      interesse: maduros.filter(l => classeBi(l) === 'interesse').length, robos: maduros.filter(l => classeBi(l) === 'robo').length,
      recusas: maduros.filter(l => ['recusa','exclusao'].includes(classeBi(l))).length, semArquivo: todos.filter(l => !l.conversa).length,
      taxa: maduros.length >= 10 ? humanos / maduros.length : null }
  }).sort((a,b) => b.enviados - a.enviados || a.chave.localeCompare(b.chave))
}
export function auditarEscolhas(frente: FrenteBi | null, leads: readonly CrmLead[], agora: number) {
  const porId = new Map(leads.map(l => [l.id,l]))
  return (frente?.fila ?? []).map(escolha => {
    const lead = porId.get(escolha.id)
    const avaliacoes = escolha.avaliacoes ?? []
    const notas = avaliacoes.map(a => a.nota).filter(Number.isFinite)
    const alertas: string[] = []
    if (new Set(avaliacoes.map(a => a.agente)).size < 3) alertas.push('Avaliação incompleta no retrato')
    if (notas.length > 1 && Math.max(...notas)-Math.min(...notas) >= 20) alertas.push('Divergência de 20 pontos ou mais')
    if (escolha.nota >= 70 && /falt|sem (?:confirm|evid[eê]ncia)|n[aã]o confirm/i.test([escolha.motivo, ...avaliacoes.map(a => a.motivo)].join(' '))) alertas.push('Nota alta com lacuna declarada no motivo')
    if (!lead) alertas.push('Cliente ausente da leitura de Vendas')
    const maduro = !!lead && instante(lead.marcos.enviado) <= agora - 2 * DIA
    return { escolha, lead, alertas, resultado: !lead ? 'Sem correspondência em Vendas' : !Number.isFinite(instante(lead.marcos.enviado)) ? 'Sem envio registrado' : !maduro ? 'Menos de 48 h de observação' : ROTULOS_DA_CLASSIFICACAO[classeBi(lead)] }
  })
}
export function analisarOperacao(visao: CrmVisao, periodo: PeriodoBi, agora: number) {
  const leads = enviadosBi(visao.leads, periodo, agora)
  const planos = leads.map(l => planoDoLead(l, agora)).sort((a,b) => a.prioridade-b.prioridade || a.lead.empresa.localeCompare(b.lead.empresa))
  const classes = (Object.keys(ROTULOS_DA_CLASSIFICACAO) as ClasseDaResposta[]).map(classe => ({ classe, rotulo: ROTULOS_DA_CLASSIFICACAO[classe], quantidade: leads.filter(l => classeBi(l) === classe).length })).filter(c => c.quantidade)
  const contagem = (f: (l: CrmLead) => boolean) => leads.filter(f).length
  const fluxos = leads.flatMap(lead => {
    const mensagens = (lead.conversa?.recentes ?? []).filter(m => instante(m.em) <= agora).sort((a,b) => instante(a.em)-instante(b.em))
    const indice = mensagens.findIndex((m,i) => m.direcao === 'entrada' && m.papel === 'robo'
      && mensagens[i+1]?.direcao === 'saida' && /trabalhamos|apresent|v[ií]deo|demonstra|sistema|oferec/i.test(mensagens[i+1].trecho))
    return indice < 0 ? [] : [{ lead, titulo:'Apresentação após resposta automática', evidencia:mensagens.slice(indice,indice+2), proximo:'Conferir se houve acesso humano antes de repetir a oferta. O recorte preservado pode ser parcial.' }]
  })
  const quebras = [
    { id: 'contexto', titulo: 'Contexto antes da decisão', responsavel: 'Rômulo + observador', acao: 'Recuperar ou conferir o histórico; distinguir informação ausente de falta de interesse.', itens: planos.filter(p => p.tipo === 'conferir' && p.prioridade <= 3) },
    { id: 'acesso', titulo: 'Acesso a quem decide', responsavel: 'Diego + Rômulo', acao: 'Validar empresa, finalidade do número e interlocutor antes da apresentação.', itens: planos.filter(p => !['encerrado','aguardar'].includes(p.tipo) && ['robo','acesso'].includes(classeBi(p.lead))) },
    { id: 'qualificacao', titulo: 'Descoberta antes da proposta', responsavel: 'Carla + Rômulo', acao: 'Confirmar dor, impacto e decisor; permissão ou elogio não qualificam a oportunidade.', itens: planos.filter(p => p.tipo === 'agir' && p.lead.classificacaoResposta?.houveRespostaHumana && lacunasDoSpiced(p.lead).length > 0) },
    { id: 'proposta', titulo: 'Proposta e próximo compromisso', responsavel: 'Rômulo', acao: 'Revisar qualificação, pendência e data; não repetir cobranças por ausência de retorno.', itens: planos.filter(p => p.lead.etapa === 'proposta') },
  ]
  return { leads, planos, classes, quebras, fluxos, enviados: leads.length, semArquivo: contagem(l => !l.conversa), humanos: contagem(l => l.classificacaoResposta?.houveRespostaHumana === true),
    interesse: contagem(l => classeBi(l) === 'interesse'), qualificados: contagem(l => lacunasDoSpiced(l).length === 0),
    propostas: contagem(l => !!l.proposta || l.eventos.some(e => e.tipo === 'proposta')), ganhos: contagem(l => l.etapa === 'ganho'),
    clientesPagantes: contagem(l => !!l.aarr?.pagamentos.length), recentes: contagem(l => agora - instante(l.marcos.enviado) < 2*DIA),
    porOferta: linhasBi(leads, 'produto', agora), porPublico: linhasBi(leads, 'nicho', agora), porMensagem: linhasBi(leads, 'mensagem', agora) }
}
