/**
 * PURO (o storage entra por parâmetro): a Triagem em lotes de 10 (17/10/2026, AC-10).
 *
 * Ao vivo, a aba prometia "lotes de 10" e mostrava os 1.423 prospects de uma vez, com o mesmo
 * "Prioridade 100" em todos e sem como tirar um da lista: a única decisão possível era o convite,
 * e fora do expediente nem ele aparecia. Daqui sai a regra que a tela segue:
 *
 *  - O lote é fixo: os 10 primeiros na ordem do servidor que ainda não foram decididos. Decidir
 *    um não puxa o 11º para dentro (o lote encolheria e cresceria a cada toque, e nunca acabaria);
 *    o próximo lote só aparece quando nenhum do lote atual espera decisão.
 *  - Duas decisões por item: convidar (o toque no link rastreado do n8n já marca o envio, RULES 17)
 *    e dispensar (registro `dispensado` na aba CRM, desfeito por `dispensado_desfeito`).
 *  - A marca local é otimista, como a das anotações (anotacao-de-envio.ts): o item sai na hora e
 *    a marca vale até o retrato confirmar (o dispensado com `perdaManual === 'dispensado'`; o
 *    convidado quando sai da Etapa Revisar) ou vencer. A planilha continua sendo a verdade (RULES 11).
 *
 * `localStorage` pode lançar (modo privado, storage bloqueado): sem ele a marca só não
 * sobrevive ao reload.
 */
import { hora } from './crm-formato'
import type { Guardador } from './anotacao-de-envio'
import type { CrmItemHoje, CrmLead, CrmProduto } from './types'
import type { EstadoDoRitmo } from './trava-de-ritmo'

export const TAMANHO_DO_LOTE = 10
export const CHAVE_DAS_DECISOES = 'squadone:crm:triagem-decisoes'
/**
 * O ciclo do retrato é de 10 min (o n8n refaz logo depois de gravar, mas pode atrasar); passado
 * isto com folga, quem diz se a decisão valeu é a planilha, e o item volta se ela não confirmou.
 */
export const VALIDADE_DA_DECISAO_MS = 15 * 60_000
/** Quanto tempo o "Desfazer" fica à vista depois de um Dispensar. */
export const DESFAZER_MS = 8_000

export type DecisaoDaTriagem = 'convidado' | 'dispensado' | 'adiado'
/** Os registros da Triagem no POST /api/operations/crm/registro (o servidor os aceita desde AC-10). */
export type RegistroDaTriagem = 'dispensado' | 'dispensado_desfeito'
/** leadId -> a decisão tomada nesta tela e quando. */
export type DecisoesDaTriagem = Record<string, { tipo: DecisaoDaTriagem; em: number }>

const TIPOS: readonly DecisaoDaTriagem[] = ['convidado', 'dispensado', 'adiado']

function validas(decisoes: DecisoesDaTriagem, agora: number): DecisoesDaTriagem {
  return Object.fromEntries(Object.entries(decisoes).filter(([id, d]) =>
    Boolean(id) && d !== null && typeof d === 'object' && TIPOS.includes(d.tipo)
    && Number.isFinite(d.em) && d.em <= agora + 60_000 && agora - d.em < (d.tipo === 'adiado' ? 24 * 60 * 60_000 : VALIDADE_DA_DECISAO_MS)))
}

export function lerDecisoes(storage: Guardador | null | undefined, agora: number): DecisoesDaTriagem {
  try {
    const bruto = JSON.parse(storage?.getItem(CHAVE_DAS_DECISOES) ?? '{}')
    // Marcas antigas de abertura não comprovam envio e não podem esconder contatos após a migração.
    return bruto && typeof bruto === 'object' && !Array.isArray(bruto)
      ? Object.fromEntries(Object.entries(validas(bruto as DecisoesDaTriagem, agora)).filter(([, d]) => d.tipo !== 'convidado')) : {}
  } catch {
    return {}
  }
}

export function gravarDecisoes(storage: Guardador | null | undefined, decisoes: DecisoesDaTriagem): void {
  try {
    storage?.setItem(CHAVE_DAS_DECISOES, JSON.stringify(decisoes))
  } catch {
    // Sem storage: a marca vale até o próximo reload; o retrato cobre depois.
  }
}

/** Marca a decisão; repetir a mesma não renova (vale o primeiro toque, como nas anotações). */
export function decidir(decisoes: DecisoesDaTriagem, leadId: string, tipo: DecisaoDaTriagem, agora: number): DecisoesDaTriagem {
  const atuais = validas(decisoes, agora)
  return atuais[leadId]?.tipo === tipo ? atuais : { ...atuais, [leadId]: { tipo, em: agora } }
}

/** O POST falhou ou o Rômulo desfez: a marca sai e o item volta. */
export function esquecerDecisao(decisoes: DecisoesDaTriagem, leadId: string): DecisoesDaTriagem {
  return Object.fromEntries(Object.entries(decisoes).filter(([id]) => id !== leadId))
}

type LeadDaPoda = Pick<CrmLead, 'sinal' | 'perdaManual'>

/**
 * Tira o que venceu e o que o retrato já confirma. Só com um retrato legível: sem ele, quem chama
 * não poda. Lead que sumiu do retrato leva a marca junto. Dispensado: confirmado pelo
 * `perdaManual`, ou já fora da Revisar por outro caminho (não há o que esconder). Convidado: fora da
 * Revisar (o clique do link rastreado leva a Convite enviado).
 */
export function podarDecisoes(decisoes: DecisoesDaTriagem, leads: ReadonlyMap<string, LeadDaPoda>, agora: number): DecisoesDaTriagem {
  return Object.fromEntries(Object.entries(validas(decisoes, agora)).filter(([id, d]) => {
    const lead = leads.get(id)
    if (!lead) return false
    if (d.tipo === 'dispensado' && lead.perdaManual === 'dispensado') return false
    return lead.sinal === 'revisar'
  }))
}

/** Fora da Triagem: dispensado nesta tela ou já dispensado no retrato. */
export function dispensado(decisoes: DecisoesDaTriagem, lead: Pick<CrmLead, 'perdaManual'> | undefined, leadId: string): boolean {
  return decisoes[leadId]?.tipo === 'dispensado' || lead?.perdaManual === 'dispensado'
}

export interface LoteDaTriagem {
  /** Os ids do lote, na ordem do servidor do momento em que o lote nasceu. Guarde e devolva como `anterior`. */
  ids: string[]
  /** O que a tela mostra: os do lote ainda no grupo e não dispensados (convidados ficam, com a marca). */
  itens: CrmItemHoje[]
  /** Os do lote que ainda esperam decisão: é o "Dispensar os que sobraram". */
  pendentes: CrmItemHoje[]
  /** Quantos ainda esperam decisão no grupo inteiro (o "N no total"). */
  restantes: number
}

/**
 * O lote atual. `anterior` são os ids do lote da última vez (vazio na primeira): enquanto algum
 * deles espera decisão, o lote continua o mesmo, mesmo que tenha encolhido; senão nasce outro
 * com os `tamanho` primeiros não decididos, na ordem do servidor.
 */
export function loteDaTriagem(
  itens: readonly CrmItemHoje[], leads: ReadonlyMap<string, Pick<CrmLead, 'perdaManual'>>, decisoes: DecisoesDaTriagem,
  anterior: readonly string[], tamanho = TAMANHO_DO_LOTE,
): LoteDaTriagem {
  const presentes = itens.filter((i) => !dispensado(decisoes, leads.get(i.leadId), i.leadId))
  const porId = new Map(presentes.map((i) => [i.leadId, i] as [string, CrmItemHoje]))
  const decidido = (id: string) => id in decisoes
  const aDecidir = presentes.filter((i) => !decidido(i.leadId))
  const continua = anterior.some((id) => porId.has(id) && !decidido(id))
  const ids = continua ? [...anterior] : aDecidir.slice(0, Math.max(0, tamanho)).map((i) => i.leadId)
  const doLote = ids.map((id) => porId.get(id)).filter((i): i is CrmItemHoje => i !== undefined)
  return { ids, itens: doLote.filter(i => decisoes[i.leadId]?.tipo !== 'adiado'), pendentes: doLote.filter((i) => !decidido(i.leadId)), restantes: aDecidir.length }
}

/** Mesmos ids na mesma ordem? (para a tela só trocar o lote guardado quando ele muda de fato) */
export const mesmoLote = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i])

// ------------------------------------------------------------------ prioridade

/**
 * A pontuação do caçador só vale o selo se diferenciar: com o mesmo número em todos (o "Prioridade
 * 100" de 17/10/2026 nos 1.423), ela não diz nada e só ocupa a linha. Sem pontuação, não conta.
 */
export function prioridadesDiferem(itens: readonly CrmItemHoje[], leads: ReadonlyMap<string, Pick<CrmLead, 'triagem'>>): boolean {
  const valores = new Set(itens.map((i) => leads.get(i.leadId)?.triagem?.prioridade).filter((p): p is number => typeof p === 'number' && Number.isFinite(p)))
  return valores.size > 1
}

/** O selo diz o que o número é: pontos de 0 a 100 do caçador, não uma posição na fila. */
export const textoDaPrioridade = (prioridade: number) => `Pontuação ${prioridade} de 100`

/**
 * O detalhe que o servidor monta traz "Prioridade N" no meio; a tela mostra a pontuação no selo
 * (quando diferencia), então o número sai do texto para não aparecer duas vezes, nem quando é igual
 * em todos. O resto do trecho (nota do Google, sinais do site) fica.
 */
export function detalheSemPrioridade(detalhe: string): string {
  return detalhe
    .replace(/\s*Prioridade -?\d+(?:[.,]\d+)? · (\S)/g, (_, letra: string) => ` ${letra.toUpperCase()}`)
    .replace(/\s*Prioridade -?\d+(?:[.,]\d+)?\.(?=\s|$)/g, '')
    .trim()
}

// ------------------------------------------------------------------ convite e registro

/**
 * Por que o Convidar está desligado, em poucas palavras (o aviso no topo explica o resto); null
 * quando dá para convidar. O ritmo vem antes do horário: ele não tem "Liberar", e liberar o
 * horário com o ritmo segurando não destravaria nada.
 */
export function motivoDoConviteTravado(p: { temConvite: boolean; ritmo: EstadoDoRitmo; travadoPeloHorario: boolean }): string | null {
  if (!p.temConvite) return 'Sem link de convite'
  const ate = p.ritmo.ate === null ? '' : hora(new Date(p.ritmo.ate).toISOString())
  switch (p.ritmo.motivo) {
    case 'pausa': return `Pausado até ${ate}`
    case 'dia': return 'Teto de hoje atingido'
    case 'hora': return `Teto da hora: libera às ${ate}`
    case 'intervalo': return `O próximo sai às ${ate}`
    default: break
  }
  return p.travadoPeloHorario ? 'Fora do expediente' : null
}

/** O corpo de POST /api/operations/crm/registro: o id é a chave da planilha, não o id do CRM. */
export function corpoDoRegistro(lead: Pick<CrmLead, 'produto' | 'chave'>, tipo: RegistroDaTriagem): { produto: CrmProduto; id: string; tipo: RegistroDaTriagem; texto: ''; data: '' } {
  return { produto: lead.produto, id: lead.chave, tipo, texto: '', data: '' }
}
