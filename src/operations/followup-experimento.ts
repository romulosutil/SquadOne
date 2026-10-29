import type { CrmLead, CrmProduto } from './types'
import { contextoHumanoPreservado, ultimaRespostaHumanaEm } from './resposta-humana'
import { hashDoLead, fisherExato } from './ab-video'
import { respondeuDeGente } from './resultados'
import { eventoCriticoDe } from '../../server/site-mensagem.ts'
import { DESPEDIDA_MACONICA } from '../../server/plus-mensagem.ts'

/**
 * 29/10/2026 (decisão do PM, docs/PRUMO-DECISOES-PM-2026-10-28.md, "Follow-up"): o braço B virou "uma
 * pergunta, sem preço nem link", com uma versão que abre pelo fato verificável do Raio-X e outra sem,
 * por oferta. Texto novo é versão nova: o sorteio usa a versão como sal (os braços se refazem) e a
 * leitura nunca soma uma versão com a outra, porque o B de 19/10 e o de 29/10 são textos diferentes.
 */
export const VERSAO_DO_FOLLOWUP = 'followup-2026-10-29' as const
/** Versões já enviadas: continuam legíveis (a aba CRM guarda o registro), mas só se medem à parte. */
export const VERSOES_ANTERIORES_DO_FOLLOWUP = ['followup-2026-10-19'] as const
export type VersaoDoFollowup = typeof VERSAO_DO_FOLLOWUP | typeof VERSOES_ANTERIORES_DO_FOLLOWUP[number]
const VERSOES_LEGIVEIS: readonly string[] = [VERSAO_DO_FOLLOWUP, ...VERSOES_ANTERIORES_DO_FOLLOWUP]
/**
 * Aprovada pelo Rômulo em 19/10/2026 ("Aprovar os textos para teste"); o texto de 29/10 entra pela decisão do PM a quem
 * ele delegou (docs/PRUMO-DECISOES-PM-2026-10-28.md). Desligar aqui devolve todos ao controle. A flag não vem de um lead nem do modelo.
 */
export const FOLLOWUP_NOVO_APROVADO = true
export const MINIMO_POR_BRACO_DO_FOLLOWUP = 30
/**
 * `fato` (só na versão de 29/10, só no B): o texto que saiu abria pelo fato do Raio-X? Sem ele o registro
 * continua válido; serve para separar, depois das 30 por braço, o B com fato do B sem fato.
 */
export interface MetadataDoFollowup { braco: 'A' | 'B'; versao: VersaoDoFollowup; fato?: boolean }
export function metadataDoFollowup(produto: string, id: string, ofertaPlus?: string, aprovado = FOLLOWUP_NOVO_APROVADO): MetadataDoFollowup {
  const oferta = produto === 'plus' ? ofertaPlus : produto
  // Só quem tem texto aprovado entra no sorteio (era a mesma lista à mão; o Plus vale pela oferta dele).
  const valido = Object.hasOwn(FOLLOWUP_NOVO, oferta ?? '') && Boolean(id.trim())
  return { braco: valido && aprovado && hashDoLead(`${produto}:${id}:${ofertaPlus ?? ''}`, VERSAO_DO_FOLLOWUP) % 2 ? 'B' : 'A', versao: VERSAO_DO_FOLLOWUP }
}

/**
 * O B de 29/10, por oferta. Guia do topo das VARIACOES (site-mensagem.js): "Oi, é o Rômulo de novo."
 * abre o follow-up, sem "do PRUMO" no Site; uma pergunta só, fácil de responder; nada de preço, link,
 * "demo" ou material pronto (quem não respondeu à 1ª não pediu nada); a mesma saída fácil do B de 19/10.
 * `semFato` é uma pergunta sobre a operação (de onde vem o cliente, quem responde, onde fica a anotação).
 * `comFato` abre pelo fato que o próprio dono confere ({FATO}, de eventoCriticoDe, o mesmo da abertura D)
 * e pergunta só se ele já sabia: o fato é o assunto, e a pergunta não pede compromisso.
 * Oferta nova no JSON faz o vue-tsc cobrar os dois textos dela aqui.
 */
export const FOLLOWUP_NOVO: Record<Exclude<CrmProduto, 'plus'>, { semFato: string; comFato: string }> = {
  site: {
    semFato: 'Oi, é o Rômulo de novo. Hoje, a maior parte dos clientes novos chega até vocês pelo Google, pelo Instagram ou por indicação? Se não for prioridade, é só dizer.',
    comFato: 'Oi, é o Rômulo de novo. {FATO} Vocês já sabiam disso? Se não for prioridade, é só dizer.',
  },
  prumo: {
    semFato: 'Oi, é o Rômulo de novo, do PRUMO. Hoje, quem encontra vocês no Google e manda mensagem costuma receber resposta no mesmo dia? Se não for prioridade, é só dizer.',
    comFato: 'Oi, é o Rômulo de novo, do PRUMO. {FATO} Vocês já sabiam disso? Se não for prioridade, é só dizer.',
  },
  iris: {
    semFato: 'Oi, é o Rômulo de novo, do PRUMO. Hoje, na época da reavaliação, quanto tempo a equipe leva para juntar as anotações das sessões? Se não for prioridade, é só dizer.',
    comFato: 'Oi, é o Rômulo de novo, do PRUMO. {FATO} Vocês já sabiam disso? Se não for prioridade, é só dizer.',
  },
  estampa: {
    semFato: 'Oi, é o Rômulo de novo, do PRUMO. Hoje, quando um pedido chega pelo WhatsApp com arte e tamanhos, onde isso fica anotado até a produção? Se não for prioridade, é só dizer.',
    comFato: 'Oi, é o Rômulo de novo, do PRUMO. {FATO} Vocês já sabiam disso? Se não for prioridade, é só dizer.',
  },
}

/** Fato que traria uma segunda pergunta, um molde sem preencher ou um link (http/www) não entra no B. */
const FATO_RECUSADO = /[?{}]|https?:|www\./i
/**
 * PURO. O fato do Raio-X que o follow-up pode citar, ou null. A regra é a da abertura D (eventoCriticoDe,
 * espelho literal do Balcão), com o mesmo mapeamento que server/crm.ts usa para ela (links.raioX e achados).
 * A consulta da busca vem da planilha e pode ter "?": aí sai o texto sem fato, nunca um B com duas perguntas.
 * O domínio do próprio lead ("Ao conferir o site x.com.br…") fica, como na abertura D: é o fato conferível.
 */
export function fatoDoFollowup(lead: { links?: { raioX?: string }; achados?: unknown }): string | null {
  const fato = eventoCriticoDe({ raio_x_url: lead.links?.raioX, raio_x_achados: lead.achados })
  return fato && !FATO_RECUSADO.test(fato) ? fato : null
}

/**
 * A preserva exatamente o texto anterior recebido pelo chamador. B usa o texto com fato só quando `fato`
 * veio (de fatoDoFollowup); sem ele, o texto sem fato. Nunca inventa o fato nem cai num "{FATO}" vazio.
 */
export function textoDoFollowup(produto: CrmProduto, empresa: string, braco: 'A' | 'B', ofertaPlus?: string, controle = '', fato?: string | null): string {
  if (braco === 'A') return controle
  const oferta = produto === 'plus' ? ofertaPlus : produto
  const moldes = Object.hasOwn(FOLLOWUP_NOVO, oferta ?? '') ? FOLLOWUP_NOVO[oferta as keyof typeof FOLLOWUP_NOVO] : undefined
  if (!moldes) return controle
  const fatoValido = fato && !FATO_RECUSADO.test(fato) ? fato.trim() : ''
  const texto = (fatoValido ? moldes.comFato.split('{FATO}').join(fatoValido) : moldes.semFato).split('{EMPRESA}').join(empresa)
  // Plus: a saudação da Ordem no lugar do "Oi," e o T.F.A. no fim, como no FOLLOWUP_PLUS (server/plus-mensagem.ts).
  return produto === 'plus' ? `${texto.replace(/^Oi,/, "Meu Ir.'.,")}\n\n${DESPEDIDA_MACONICA}` : texto
}
export function textoDoRegistroFollowup(meta: MetadataDoFollowup): string {
  // Só a versão vigente se grava: um envio de hoje nunca pode sair etiquetado com o texto de outra data.
  if (!meta || !['A', 'B'].includes(meta.braco) || meta.versao !== VERSAO_DO_FOLLOWUP) throw new Error('Braço do follow-up inválido.')
  const fato = meta.braco === 'B' && typeof meta.fato === 'boolean' ? { fato: meta.fato } : {}
  return `[${VERSAO_DO_FOLLOWUP}] ${JSON.stringify({ braco: meta.braco, versao: meta.versao, ...fato })}`
}
/** Lê o registro de qualquer versão já enviada (a de 19/10 continua sendo um follow-up confirmado). */
export function lerRegistroFollowup(texto: string): MetadataDoFollowup | null {
  const m = /^\[(followup-\d{4}-\d{2}-\d{2})\] /.exec(texto)
  if (!m || !VERSOES_LEGIVEIS.includes(m[1])) return null
  try {
    const j = JSON.parse(texto.slice(m[0].length))
    if (!j || !['A', 'B'].includes(j.braco) || j.versao !== m[1]) return null
    return { braco: j.braco, versao: j.versao, ...(j.braco === 'B' && typeof j.fato === 'boolean' ? { fato: j.fato } : {}) }
  } catch { return null }
}
/**
 * Só fatos de envio confirmado com versão; o passado não recebe braço por hash retroativo. Uma versão por
 * leitura: o lead entra pela primeira confirmação versionada dele, e só se ela for da versão pedida (um
 * B de 19/10 nunca soma com um B de 29/10, e quem já foi medido numa versão não entra na outra).
 */
export function leituraDoFollowup(leads: readonly CrmLead[], versao: VersaoDoFollowup = VERSAO_DO_FOLLOWUP) {
  const bracos = { A: { enviados: 0, responderam: 0 }, B: { enviados: 0, responderam: 0 } }
  for (const lead of leads) {
    const eventos = lead.eventos.filter(e => e.tipo === 'followup_enviado' && e.origem === 'manual' && lerRegistroFollowup(e.registroTexto ?? e.texto ?? ''))
      .sort((a, b) => a.em.localeCompare(b.em))
    const evento = eventos[0]
    if (!evento) continue
    const meta = lerRegistroFollowup(evento.registroTexto ?? evento.texto ?? '')!
    if (meta.versao !== versao) continue
    const envio = Date.parse(evento.em)
    if (!Number.isFinite(envio)) continue
    const b = bracos[meta.braco]; b.enviados++
    const resposta = ultimaRespostaHumanaEm(lead)
    const contextoHumano = contextoHumanoPreservado(lead)
    if (resposta > envio && contextoHumano && respondeuDeGente(contextoHumano)) b.responderam++
  }
  const lido = bracos.A.enviados >= MINIMO_POR_BRACO_DO_FOLLOWUP && bracos.B.enviados >= MINIMO_POR_BRACO_DO_FOLLOWUP
  return { versao, bracos, lido, ...(lido ? { numeros: { taxaA: bracos.A.responderam / bracos.A.enviados, taxaB: bracos.B.responderam / bracos.B.enviados, p: fisherExato(bracos.A.responderam, bracos.A.enviados - bracos.A.responderam, bracos.B.responderam, bracos.B.enviados - bracos.B.responderam) } } : {}) }
}
