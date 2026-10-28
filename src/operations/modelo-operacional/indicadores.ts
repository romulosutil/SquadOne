/** Leitura operacional pura. Não altera CRM, não envia e não declara primeira venda. */
import type { CrmLead, CrmVisao } from '../types.ts'
import { planoComercialDoLead } from '../prioridade-comercial.ts'
import { cicloDoLead } from '../ciclo-comercial.ts'
import { temQualificacaoComercial } from '../qualificacao-comercial.ts'
import { leituraAarr, INICIO_AARR } from '../aarr.ts'

export interface IndicadorOperacional {
  id: string
  rotulo: string
  valor: number | null
  unidade: string
  detalhe: string
}
const BASE = [
  { id: 'conferir', rotulo: 'Conferências internas', unidade: 'oportunidades', detalhe: 'Grupo conferir da prioridade canônica, no recorte acompanhado. Não autoriza contato.' },
  { id: 'qualificar', rotulo: 'Próxima lacuna de qualificação', unidade: 'oportunidades', detalhe: 'Grupo qualificar da prioridade canônica; não equivale a cliente qualificado.' },
  { id: 'aguardar', rotulo: 'Em espera', unidade: 'oportunidades', detalhe: 'Grupo aguardar. Preservar resposta, compromisso ou condição combinada; não é atraso de atendimento.' },
  { id: 'decidir', rotulo: 'Decisões comerciais', unidade: 'oportunidades', detalhe: 'Grupo decidir: revisão humana do próximo marco, sem promessa de venda.' },
  { id: 'identidade', rotulo: 'Passagens sem identidade confirmada', unidade: 'passagens', detalhe: 'Atendimento interno presente com identidade ausente, sem prova, em conflito ou indisponível; encerrados e esperas não viram nova cobrança.' },
  { id: 'propostas-enviadas', rotulo: 'Versões de proposta enviadas', unidade: 'versões', detalhe: 'Somente proposta_enviada válida e ativa no ciclo versionado. Proposta preparada ou marcador legado isolado não confirma esse marco.' },
  { id: 'aceites', rotulo: 'Aceites registrados', unidade: 'aceites', detalhe: 'Somente aceite válido e ativo vinculado à versão exata enviada. Não confirma recebimento.' },
  { id: 'recebimentos', rotulo: 'Recebimentos registrados', unidade: 'recebimentos', detalhe: `Contagem canônica AARRR desde ${INICIO_AARR.slice(0, 10)}; inclui fatos válidos legados e do ciclo. Não distingue receita nova de existente e não comprova primeira venda nova.` },
] as const

function problemaDaFonte(visao: CrmVisao | null, agora: number): string | null {
  if (!visao || visao.estado !== 'ok' || !Array.isArray(visao.leads)) return 'Fonte comercial ausente ou inválida.'
  const gerado = Date.parse(visao.geradoEm ?? '')
  const limite = visao.minutosAteVelho * 60_000
  if (!Number.isFinite(agora) || !Number.isFinite(gerado) || !Number.isFinite(limite) || limite <= 0 || gerado > agora || agora - gerado > limite) return 'Fonte comercial antiga ou sem data verificável.'
  const fontes = Array.isArray(visao.fontes) ? visao.fontes : []
  if (!['site', 'prumo', 'iris', 'estampa', 'registros'].every(id => fontes.some(f => f.id === id)) || fontes.some(f => !!f.erro) || !Array.isArray(visao.colunasAusentes) || visao.colunasAusentes.length || visao.ultimaFalha) return 'Fonte comercial incompleta ou com publicação pendente de conferência.'
  return null
}

/**
 * O recorte acompanhado exclui aquisição nova sem contexto. Espera e encerramento
 * continuam no plano canônico e nunca são somados como demanda de contato.
 * Retorna somente contagens e explicações fixas; nenhum texto ou valor de cliente.
 */
export function calcularIndicadoresOperacionais(visao: CrmVisao | null, agora = Date.now()): IndicadorOperacional[] {
  const problema = problemaDaFonte(visao, agora)
  if (problema || !visao) return BASE.map(m => ({ ...m, valor: null, detalhe: `${problema} Sem dados verificáveis; não interpretar como zero.` }))
  const leituras = visao.leads.map(lead => ({ lead, ciclo: cicloDoLead(lead, agora) }))
  const acompanhadas = leituras.filter(({ lead, ciclo }) => ['contato', 'proposta'].includes(lead.etapa) || !!lead.atendimentoComercial || temQualificacaoComercial(lead, agora) || ciclo.historico.length > 0 || ciclo.problemas.length > 0)
  const planos = acompanhadas.map(({ lead }) => ({ lead, plano: planoComercialDoLead(lead, agora) }))
  const grupo = (nome: string) => planos.filter(p => p.plano.grupo === nome).length
  const valores: Record<string, number> = {
    conferir: grupo('conferir'), qualificar: grupo('qualificar'), aguardar: grupo('aguardar'), decidir: grupo('decidir'),
    identidade: planos.filter(({ lead }) => !!lead.atendimentoComercial && lead.atendimentoComercial.identidade !== 'confirmada').length,
    'propostas-enviadas': leituras.reduce((n, l) => n + l.ciclo.envios.length, 0),
    aceites: leituras.reduce((n, l) => n + l.ciclo.aceites.length, 0),
    recebimentos: leituraAarr(visao.leads, agora).receita.pagamentos,
  }
  return BASE.map(m => ({ ...m, valor: valores[m.id] }))
}