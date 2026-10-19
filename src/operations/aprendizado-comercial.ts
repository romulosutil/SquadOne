import type { CrmLead } from './types'

// Nota da aba CRM: não cria outra fonte de verdade nem altera o funil.
const PREFIXO = '[aprendizado-v1] '
export const RESULTADOS_DO_TESTE = ['em-teste', 'avancou', 'nao-avancou', 'inconclusivo'] as const
export type ResultadoDoTeste = typeof RESULTADOS_DO_TESTE[number]
export interface AprendizadoComercial {
  fato: string
  hipotese: string
  teste: string
  resultado: ResultadoDoTeste
  pausarAteResposta?: boolean
}
export const ROTULO_DO_TESTE: Record<ResultadoDoTeste, string> = {
  'em-teste': 'Em teste', avancou: 'Avançou', 'nao-avancou': 'Não avançou', inconclusivo: 'Inconclusivo',
}

function validar(valor: unknown): AprendizadoComercial | null {
  if (!valor || typeof valor !== 'object') return null
  const v = valor as Record<string, unknown>
  if (!['fato', 'hipotese', 'teste'].every((k) => typeof v[k] === 'string' && (v[k] as string).trim().length > 0 && (v[k] as string).length <= 220)) return null
  if (!RESULTADOS_DO_TESTE.includes(v.resultado as ResultadoDoTeste)) return null
  if (v.pausarAteResposta !== undefined && typeof v.pausarAteResposta !== 'boolean') return null
  return { fato: (v.fato as string).trim(), hipotese: (v.hipotese as string).trim(), teste: (v.teste as string).trim(), resultado: v.resultado as ResultadoDoTeste, ...(v.pausarAteResposta === true ? { pausarAteResposta: true } : {}) }
}

export function notaDoAprendizado(valor: AprendizadoComercial): string {
  const v = validar(valor)
  if (!v) throw new Error('Preencha fato, hipótese e próximo teste (até 220 caracteres cada), com o resultado observado.')
  const texto = PREFIXO + JSON.stringify(v)
  if (texto.length > 1000) throw new Error('Encurte o aprendizado para caber nos 1000 caracteres da nota.')
  return texto
}

/** A última revisão humana válida vence; data inválida ou nota comum não vira aprendizado. */
export function aprendizadoDoLead(lead: Pick<CrmLead, 'eventos'>): (AprendizadoComercial & { em: string }) | null {
  const eventos = (lead.eventos ?? []).filter((e) => e.tipo === 'nota' && e.origem === 'manual' && e.texto?.startsWith(PREFIXO) && Number.isFinite(Date.parse(e.em ?? '')))
    .sort((a, b) => Date.parse(b.em!) - Date.parse(a.em!))
  for (const e of eventos) {
    try {
      const v = validar(JSON.parse(e.texto!.slice(PREFIXO.length)))
      if (v) return { ...v, em: e.em! }
    } catch { /* nota ilegível não substitui uma revisão válida */ }
  }
  return null
}

export function aprendizadosDosLeads(leads: readonly CrmLead[]) {
  return leads.flatMap((lead) => {
    const aprendizado = aprendizadoDoLead(lead)
    return aprendizado ? [{ leadId: lead.id, empresa: lead.empresa, produto: lead.produto, ...aprendizado }] : []
  }).sort((a, b) => Date.parse(b.em) - Date.parse(a.em))
}

/** Pausa por gesto humano. Recibo de leitura e mensagem nossa não destravam contato. */
export function contatoPausado(lead: Pick<CrmLead, 'eventos' | 'conversa'>): boolean {
  const a = aprendizadoDoLead(lead)
  if (!a?.pausarAteResposta) return false
  const resposta = Date.parse(lead.conversa?.ultimaEntrada ?? '')
  return !Number.isFinite(resposta) || resposta <= Date.parse(a.em)
}

/** Silêncio é ausência de decisão, nunca evidência de que o preço ou a oferta falhou. */
export function direcaoDoLead(lead: Pick<CrmLead, 'etapa' | 'resposta' | 'conversa'>): string {
  if (lead.etapa === 'ganho') return 'Confira o pagamento e o custo de entregar antes de repetir a oferta.'
  if (lead.resposta?.tipo === 'negativa' || lead.resposta?.tipo === 'exclusao') return 'Respeite a recusa. Registre o motivo literal; o próximo teste é com outro lead.'
  if (lead.conversa?.ultima.direcao === 'saida') return 'Você já escreveu. Confira a conversa e o retorno combinado antes de mandar outra mensagem. Silêncio não confirma a causa.'
  return 'Separe permissão para ver de intenção de comprar. Confirme quem decide, a necessidade e o próximo compromisso.'
}
