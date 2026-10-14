/**
 * PURO (o storage entra por parâmetro): o toque em "Mandar o link" ou "Mandar o follow-up"
 * anota o envio na aba CRM (14/10/2026; `segunda_enviada`/`followup_enviado` em server/crm.ts).
 *
 * O link abre o WhatsApp normalmente; a anotação vai em segundo plano. O n8n refaz o retrato
 * logo depois de gravar, mas, se ele demorar, o retrato só muda no próximo ciclo do `08 · CRM`
 * (até 10 min). Até lá a tela lembra o toque, como a fila de envio (fila-de-envio.ts) lembra o
 * dela: o item mostra "anotado às HH:MM" e vai para o fim do grupo. É conveniência de quem
 * envia, nunca estado do funil: a planilha continua sendo a verdade (RULES 11), e a marca
 * some quando o retrato confirma ou quando vence.
 *
 * `localStorage` pode lançar (modo privado, storage bloqueado): sem ele a marca só não
 * sobrevive ao reload.
 */
import type { CrmItemHoje, CrmLead, CrmProduto } from './types'

export type TipoDeEnvioAnotado = 'segunda_enviada' | 'followup_enviado'

export const CHAVE_DAS_ANOTACOES = 'squadone:crm:envios-anotados'
/** O ciclo do retrato é de 10 min: passado isto, quem diz se o envio foi anotado é a planilha. */
export const VALIDADE_DA_ANOTACAO_MS = 10 * 60_000
/** O servidor trata o mesmo envio em 2 min como o mesmo toque (JANELA_DE_REPETICAO_MS): a confirmação aceita essa folga. */
const FOLGA_DA_CONFIRMACAO_MS = 2 * 60_000

/** O que a tela diz quando a anotação falha: o WhatsApp abriu do mesmo jeito. */
export const AVISO_DE_FALHA_DA_ANOTACAO = 'Não consegui anotar o envio — anote à mão.'

/** `leadId|tipo` -> instante (ms) do toque. */
export type EnviosAnotados = Record<string, number>

export interface Guardador {
  getItem(chave: string): string | null
  setItem(chave: string, valor: string): void
}

export const chaveDaAnotacao = (leadId: string, tipo: TipoDeEnvioAnotado) => `${leadId}|${tipo}`

const TIPOS: readonly TipoDeEnvioAnotado[] = ['segunda_enviada', 'followup_enviado']

function validas(anotados: EnviosAnotados, agora: number): EnviosAnotados {
  return Object.fromEntries(Object.entries(anotados).filter(([chave, t]) =>
    TIPOS.some((tipo) => chave.endsWith(`|${tipo}`)) && Number.isFinite(t) && t <= agora + 60_000 && agora - t < VALIDADE_DA_ANOTACAO_MS))
}

export function lerAnotados(storage: Guardador | null | undefined, agora: number): EnviosAnotados {
  try {
    const bruto = JSON.parse(storage?.getItem(CHAVE_DAS_ANOTACOES) ?? '{}')
    return bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? validas(bruto as EnviosAnotados, agora) : {}
  } catch {
    return {}
  }
}

export function gravarAnotados(storage: Guardador | null | undefined, anotados: EnviosAnotados): void {
  try {
    storage?.setItem(CHAVE_DAS_ANOTACOES, JSON.stringify(anotados))
  } catch {
    // Sem storage: a marca vale até o próximo reload.
  }
}

/** Qual envio este link faz, pelo lead: a 2ª mensagem, o follow-up, ou nenhum (conversa, demo...). */
export function tipoDoLink(lead: Pick<CrmLead, 'links'> | undefined, url: string): TipoDeEnvioAnotado | null {
  if (!lead || !url) return null
  if (url === lead.links.segunda) return 'segunda_enviada'
  if (url === lead.links.followup) return 'followup_enviado'
  return null
}

/** Repetir o toque não renova: vale a primeira vez que o WhatsApp abriu (o servidor também ignora). */
export function anotar(anotados: EnviosAnotados, leadId: string, tipo: TipoDeEnvioAnotado, agora: number): EnviosAnotados {
  const atuais = validas(anotados, agora)
  const chave = chaveDaAnotacao(leadId, tipo)
  return chave in atuais ? atuais : { ...atuais, [chave]: agora }
}

/** A anotação falhou: a marca sai, para a tela não dizer "anotado" sobre o que não foi. */
export function desanotar(anotados: EnviosAnotados, leadId: string, tipo: TipoDeEnvioAnotado): EnviosAnotados {
  const chave = chaveDaAnotacao(leadId, tipo)
  return Object.fromEntries(Object.entries(anotados).filter(([k]) => k !== chave))
}

export function anotadoEm(anotados: EnviosAnotados, leadId: string, tipo: TipoDeEnvioAnotado): number | undefined {
  return anotados[chaveDaAnotacao(leadId, tipo)]
}

/**
 * Tira o que venceu e o que o retrato já confirma (o marco do tipo chegou). Só com um retrato
 * legível: sem ele, quem chama não poda. Lead que sumiu do retrato leva a marca junto.
 */
export function podarAnotados(anotados: EnviosAnotados, leads: ReadonlyMap<string, Pick<CrmLead, 'marcos'>>, agora: number): EnviosAnotados {
  return Object.fromEntries(Object.entries(validas(anotados, agora)).filter(([chave, t]) => {
    const [leadId, tipo] = chave.split('|') as [string, TipoDeEnvioAnotado]
    const lead = leads.get(leadId)
    if (!lead) return false
    const marco = Date.parse((tipo === 'segunda_enviada' ? lead.marcos.segundaEnviada : lead.marcos.followupEnviado) ?? '')
    return !(Number.isFinite(marco) && marco >= t - FOLGA_DA_CONFIRMACAO_MS)
  }))
}

/** O envio que o item da Hoje resolve, pelo grupo: resposta = 2ª mensagem; follow-up = o follow-up. */
export function tipoDoGrupo(grupo: string): TipoDeEnvioAnotado | null {
  return grupo === 'resposta' ? 'segunda_enviada' : grupo === 'followup' ? 'followup_enviado' : null
}

/** Os itens do grupo com os já anotados nesta tela no fim, cada parte na ordem do servidor. */
export function ordenarComAnotados(itens: CrmItemHoje[], grupo: string, anotados: EnviosAnotados): CrmItemHoje[] {
  const tipo = tipoDoGrupo(grupo)
  if (!tipo) return itens
  const anotado = (i: CrmItemHoje) => chaveDaAnotacao(i.leadId, tipo) in anotados
  return [...itens.filter((i) => !anotado(i)), ...itens.filter(anotado)]
}

/** O corpo de POST /api/operations/crm/registro: o id é a chave da planilha, não o id do CRM. */
export function corpoDaAnotacao(lead: Pick<CrmLead, 'produto' | 'chave'>, tipo: TipoDeEnvioAnotado): { produto: CrmProduto; id: string; tipo: TipoDeEnvioAnotado; texto: ''; data: '' } {
  return { produto: lead.produto, id: lead.chave, tipo, texto: '', data: '' }
}

/** "2ª mensagem anotada às 14:02" / "Follow-up anotado às 14:02", com a hora já formatada por quem chama. */
export function textoDaAnotacao(tipo: TipoDeEnvioAnotado, hora: string): string {
  return tipo === 'segunda_enviada' ? `2ª mensagem anotada às ${hora}` : `Follow-up anotado às ${hora}`
}
