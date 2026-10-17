/**
 * O "Liberar fora do expediente", um só para a Central (17/10/2026, AC-21).
 *
 * Eram três estados de tela, cada um em memória: a Próxima venda (o cartão da Hoje e da aba A fazer),
 * a Triagem e a Ficha (as duas pelo CrmPanel). Liberar um lead no cartão não destravava a Ficha dele,
 * e recarregar a página travava de novo o que já se tinha decidido. A fonte agora é o servidor
 * (venda-do-dia.json, `liberados`, zera à meia-noite de SP) e este módulo é o espelho único dele no
 * navegador: um estado reativo de módulo, o mesmo objeto para todo componente que o importa.
 *
 * Quem já lê GET /api/operations/crm/venda (o cartão, a cada 30 s; o CrmPanel, a cada leitura do CRM)
 * passa o corpo para `absorverDia`: nenhum GET a mais. O toque em "Liberar" marca na hora (otimista)
 * e manda o POST. Se o POST falha, a marca segue só nesta aba (como era antes de AC-21): a trava
 * existe para a decisão ser explícita, e ela foi.
 *
 * O vendedor do Telegram não lê daqui: fora do expediente ele não avisa ninguém.
 */
import { computed, ref } from 'vue'
import type { EnviosLiberados } from './trava-de-horario'

/** O que o servidor disse por último: leadId -> instante do "Liberar". */
const doServidor = ref<Record<string, number>>({})
/** O dia (AAAA-MM-DD de SP) do último corpo lido: outro dia descarta as marcas otimistas. */
let diaLido = ''
/**
 * Liberados nesta aba. Ficam até o dia virar, mesmo depois de o servidor confirmar: um GET que saiu
 * antes do POST e chega depois dele não pode travar de novo o lead que acabou de ser liberado.
 */
const otimistas = ref<ReadonlySet<string>>(new Set())

/** Os leads liberados hoje, na forma que as travas da tela recebem. */
export const liberadosDoDia = computed<EnviosLiberados>(() => new Set([...Object.keys(doServidor.value), ...otimistas.value]))

/** PURO: os liberados de um corpo do servidor; o que não for leadId -> número some (formato antigo = vazio). */
export function liberadosDoCorpo(corpo: unknown): Record<string, number> | null {
  if (!corpo || typeof corpo !== 'object') return null
  const l = (corpo as { liberados?: unknown }).liberados
  if (l === undefined) return {}
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null
  return Object.fromEntries(Object.entries(l).filter(([id, em]) => id.length > 0 && typeof em === 'number' && Number.isFinite(em)))
}

/** O dia como o servidor devolve (GET e todo POST de /crm/venda): fica o que ele diz dos liberados. */
export function absorverDia(corpo: unknown): void {
  const lidos = liberadosDoCorpo(corpo)
  if (!lidos) return
  const dia = typeof (corpo as { dia?: unknown }).dia === 'string' ? (corpo as { dia: string }).dia : ''
  // Virou o dia no servidor: o que se liberou ontem nesta aba também vale como ontem.
  if (dia && diaLido && dia !== diaLido) otimistas.value = new Set()
  if (dia) diaLido = dia
  doServidor.value = lidos
}

/**
 * O toque em "Liberar": marca na hora e grava no servidor. Devolve se o servidor guardou (falhou =
 * vale só nesta aba até recarregar, e a tela pode dizer isso).
 */
export async function liberarLead(leadId: string): Promise<boolean> {
  otimistas.value = new Set([...otimistas.value, leadId])
  try {
    const r = await fetch('/api/operations/crm/venda/liberar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId }),
    })
    if (!r.ok) return false
    absorverDia(await r.json())
    return true
  } catch {
    return false
  }
}
