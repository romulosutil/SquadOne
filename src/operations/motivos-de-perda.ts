/**
 * PURO. Os motivos de perda, uma lista fechada só (decisão de 28/10/2026,
 * docs/PRUMO-DECISOES-PM-2026-10-28.md, "Motivos de perda"). Até então eram duas listas que não se
 * falavam: o `motivoPerda` que o servidor deduz (recusou, expirou, esfriou, descartado, sem-interesse,
 * sem-contato, proposta-sem-retorno), que diz COMO o lead saiu, e o `motivo_perda` do AARRR (preco,
 * timing, sem-dor, decisor, concorrente, sumiu), que diz POR QUÊ e só existia quando alguém lembrava de
 * registrar em Receita. Agora o porquê tem uma lista só, e todo Perdido de venda tem um:
 *  - o registrado à mão (`motivo_perda` na aba CRM, que a Ficha pede no "Perdeu") manda;
 *  - sem ele, o motivo automático antigo se traduz pela tabela MOTIVO_DA_PERDA_AUTOMATICA.
 * `motivoPerda` (o como) continua igual no servidor e na API: o Dell (site-demos-limpeza.py) e o Funil
 * decidem por ele. Nada da aba CRM é reescrito: os registros antigos ("sem-dor", "concorrente") são
 * lidos e traduzidos aqui, na leitura.
 */
import type { CrmLead } from './types'

export const MOTIVOS_DE_PERDA = ['preco', 'timing', 'decisor', 'ja_tem', 'sem_dor', 'sumiu', 'contato_errado'] as const
export type MotivoDePerda = typeof MOTIVOS_DE_PERDA[number]

/** O nome curto na tela (Ficha, Funil e Resultados leem daqui). */
export const ROTULO_DO_MOTIVO_DE_PERDA: Readonly<Record<MotivoDePerda, string>> = {
  preco: 'Preço',
  timing: 'Não é a hora',
  decisor: 'Quem decide não aprovou',
  ja_tem: 'Já tem quem faça',
  sem_dor: 'Não vê necessidade',
  sumiu: 'Sumiu',
  contato_errado: 'Contato errado',
}

/**
 * Os valores do `motivo_perda` gravados antes de 28/10/2026 que mudaram de nome. "sem-dor" é o mesmo
 * motivo com outra grafia; "concorrente" é "já tem quem faça" (outro fornecedor ou alguém da casa: para
 * a venda, o que importa é que a necessidade já está atendida). preco, timing, decisor e sumiu não mudaram.
 */
export const MOTIVO_DO_REGISTRO_ANTIGO: Readonly<Record<string, MotivoDePerda>> = {
  'sem-dor': 'sem_dor',
  concorrente: 'ja_tem',
}

/**
 * O motivo automático (CrmLead.motivoPerda) traduzido para a lista fechada. `null` = não é perda de
 * venda e fica fora da conta dos motivos.
 *  - recusou e sem-interesse → sem_dor: é o "não" sem razão dita (classificado na conversa, a pasta
 *    _recusados/ ou o "Disse não" antigo). Num primeiro contato frio, o não sem razão é o de quem não vê
 *    necessidade; quando ele diz a razão (preço, hora, já tem), o Rômulo registra e o registro manda.
 *  - expirou, esfriou e proposta-sem-retorno → sumiu: silêncio é silêncio. Não há prova de número errado
 *    nem de recusa; a validade da proposta que vence no 10º dia é exatamente o "sumiu" da decisão.
 *  - sem-contato → contato_errado: era o "Sem contato fácil" da Ficha e do Plus, a mensagem que não
 *    chegou a quem decide (robô, recepção, número que não é da empresa). "sumiu" pede alguém que
 *    estava lá e parou de responder, o que esse caso não comprova.
 *  - descartado → null: dispensado na Triagem ou descartado antes de qualquer contato. Nunca houve
 *    venda para perder; contado como sem_dor, os ~1.400 dispensados da Triagem afogariam os motivos reais.
 */
export const MOTIVO_DA_PERDA_AUTOMATICA: Readonly<Record<NonNullable<CrmLead['motivoPerda']>, MotivoDePerda | null>> = {
  recusou: 'sem_dor',
  'sem-interesse': 'sem_dor',
  expirou: 'sumiu',
  esfriou: 'sumiu',
  'proposta-sem-retorno': 'sumiu',
  'sem-contato': 'contato_errado',
  descartado: null,
}

export const ehMotivoDePerda = (v: unknown): v is MotivoDePerda => (MOTIVOS_DE_PERDA as readonly unknown[]).includes(v)

/** O valor gravado, novo ou antigo, já na lista fechada; `null` para o que não é motivo. */
export function lerMotivoDePerda(v: unknown): MotivoDePerda | null {
  if (ehMotivoDePerda(v)) return v
  return typeof v === 'string' && Object.hasOwn(MOTIVO_DO_REGISTRO_ANTIGO, v) ? MOTIVO_DO_REGISTRO_ANTIGO[v]! : null
}

/**
 * O desfecho que acompanha o motivo no "Perdeu" da Ficha: o registro que tira o lead do funil continua
 * sendo `recusou` ("ele disse não") ou `sem_contato`, como antes, para o servidor, o desfazer e o Dell
 * não mudarem. Quem sumiu ou estava no contato errado não disse não.
 */
export function desfechoDoMotivo(m: MotivoDePerda): 'recusou' | 'sem_contato' {
  return m === 'sumiu' || m === 'contato_errado' ? 'sem_contato' : 'recusou'
}

/** Os registros que desfazem uma perda marcada: o motivo registrado antes deles não vale mais. */
const DESFAZ_A_PERDA: ReadonlySet<string> = new Set(['recusou_desfeito', 'sem_contato_desfeito', 'dispensado_desfeito'])

type LeadDoMotivo = Pick<CrmLead, 'motivoPerda' | 'eventos'>

/** O último `motivo_perda` registrado à mão que ainda vale (depois do último desfazer de perda). */
export function motivoRegistrado(lead: Pick<CrmLead, 'eventos'>, agora = Number.POSITIVE_INFINITY): { motivo: MotivoDePerda; em: string } | null {
  const manuais = (lead.eventos ?? []).filter(e => e.origem === 'manual' && Date.parse(e.em) <= agora)
    .sort((a, b) => Date.parse(a.em) - Date.parse(b.em))
  let atual: { motivo: MotivoDePerda; em: string } | null = null
  for (const e of manuais) {
    if (DESFAZ_A_PERDA.has(e.tipo)) { atual = null; continue }
    if (e.tipo !== 'motivo_perda') continue
    try {
      const v = JSON.parse(e.registroTexto ?? e.texto)
      const motivo = v && typeof v === 'object' && v.versao === 1 ? lerMotivoDePerda(v.valor) : null
      if (motivo) atual = { motivo, em: e.em }
    } catch { /* Texto ilegível não vira motivo. */ }
  }
  return atual
}

/** O motivo do Perdido: o registrado manda; sem ele, a tradução do automático. */
export function motivoDaPerdaDoLead(lead: LeadDoMotivo, agora = Number.POSITIVE_INFINITY): MotivoDePerda | null {
  return motivoRegistrado(lead, agora)?.motivo ?? (lead.motivoPerda ? MOTIVO_DA_PERDA_AUTOMATICA[lead.motivoPerda] : null)
}

/**
 * "Sumiu 12 · Não vê necessidade 90 · Descartado 750": a nota da coluna Perdido do Funil, só com os
 * motivos que têm alguém, na ordem da lista. O descartado fica à parte, com o nome dele, porque não é
 * motivo de perda de venda (MOTIVO_DA_PERDA_AUTOMATICA).
 */
export function resumoDosMotivos(perdidos: readonly (LeadDoMotivo & Pick<CrmLead, 'motivoDaPerda'>)[]): string {
  const motivos = perdidos.map(l => l.motivoDaPerda ?? motivoDaPerdaDoLead(l))
  const linhas: Array<[string, number]> = MOTIVOS_DE_PERDA.map(m => [ROTULO_DO_MOTIVO_DE_PERDA[m], motivos.filter(x => x === m).length])
  linhas.push(['Descartado', perdidos.filter(l => l.motivoPerda === 'descartado').length])
  return linhas.filter(([, n]) => n).map(([rotulo, n]) => `${rotulo} ${n}`).join(' · ')
}
