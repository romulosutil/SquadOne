/**
 * PURO (17/10/2026): o que o observador escreve no lugar do que não é texto, e quem está do outro lado.
 * O caso que motivou: a Baobá (Iris) mandou um ÁUDIO, depois "*[Patricia Adriano]* CLaro, pode enviar
 * sim." à pergunta "posso de toda forma mandar o vídeo?". O n8n leu "interesse", a Próxima venda disse
 * "disse sim: combine a demonstração" (o sim era só licença para mandar o vídeo, e quem escreveu era a
 * recepção), e depois do vídeo enviado o cartão seguiu em "responder": vídeo é mídia, não URL.
 *
 * Servidor (server/conversa-do-lead.ts) e tela (Próxima venda, Ficha, dossiê do copiloto e do
 * Assistente) leem daqui, para o mesmo marcador nunca ser lido de dois jeitos.
 */

/** Quem escreveu uma mensagem de entrada que não é o lead falando por si. Ausente = gente (quem decide, até prova em contrário). */
export type PapelDaMensagem = 'recepcao' | 'robo'

/**
 * PURO. O papel de uma mensagem de ENTRADA. O observador passa a gravar `papel` (contrato novo do
 * JSONL); quando não grava (linha antiga, ou ele não soube), o texto decide:
 * - "[Atendimento…" ou "[Bot…" no começo: o menu automático do WhatsApp Business (robô);
 * - "*[Nome]*" no começo: a assinatura de atendente do WhatsApp Business com vários atendentes,
 *   que é quem atende o público (recepção), não quem decide a compra.
 * Valor gravado que não é um dos dois é ignorado (cai na leitura do texto).
 */
export function papelDaMensagem(texto: string | undefined, gravado?: unknown): PapelDaMensagem | undefined {
  if (gravado === 'recepcao' || gravado === 'robo') return gravado
  const t = (texto ?? '').trimStart()
  if (/^\[\s*(atendimento|bot)\b/i.test(t)) return 'robo'
  if (/^\*\[[^\]\n]{1,80}\]\*/.test(t)) return 'recepcao'
  return undefined
}

// ---------------------------------------------------------------- áudio

export interface AudioDaMensagem {
  /** Duração, quando o observador a gravou ("[áudio 27s]"); ausente no marcador antigo "[áudio]". */
  segundos?: number
  /** O que a transcrição ouviu; vazio = ninguém ouviu o áudio. */
  transcricao: string
}

const AUDIO = /^\s*\[\s*[áa]udio(?:\s+(\d{1,5})\s*s)?\s*\]\s*([\s\S]*)$/i

/** PURO. "[áudio 27s] texto" -> { segundos: 27, transcricao: "texto" }; null = não é áudio. */
export function audioDaMensagem(texto: string | undefined): AudioDaMensagem | null {
  const m = AUDIO.exec(texto ?? '')
  if (!m) return null
  const segundos = m[1] ? Number(m[1]) : undefined
  return { ...(segundos !== undefined && Number.isFinite(segundos) ? { segundos } : {}), transcricao: m[2].trim() }
}

/**
 * PURO. O texto de uma mensagem para a tela (cartão, Ficha, Telegram): o áudio sem transcrição vira
 * "áudio não ouvido (27s)" (o marcador cru parecia uma mensagem lida); com transcrição, o texto dela.
 */
export function textoParaATela(texto: string): string {
  const audio = audioDaMensagem(texto)
  if (!audio) return texto
  const duracao = audio.segundos !== undefined ? ` ${audio.segundos}s` : ''
  if (!audio.transcricao) return `áudio não ouvido${audio.segundos !== undefined ? ` (${audio.segundos}s)` : ''}`
  return `(áudio${duracao}) ${audio.transcricao}`
}

/**
 * PURO. O texto de uma mensagem para um modelo (copiloto, Assistente). O áudio que ninguém ouviu é dito
 * com todas as letras: na Baobá o modelo leu o "[áudio]" seguido de "pode enviar sim" como interesse.
 * `mascarar` vale só para o que a pessoa disse (a transcrição), nunca para a duração.
 */
export function textoParaOModelo(texto: string, mascarar: (t: string) => string = (t) => t): string {
  const audio = audioDaMensagem(texto)
  if (!audio) return mascarar(texto)
  const de = audio.segundos !== undefined ? ` de ${audio.segundos}s` : ''
  if (!audio.transcricao) return `[áudio${de} que o sistema não ouviu: o conteúdo é DESCONHECIDO, não suponha que seja interesse]`
  return `[áudio${de}, transcrito pelo sistema] ${mascarar(audio.transcricao)}`
}

// ---------------------------------------------------------------- material mandado por nós

const MATERIAL = /^\s*\[\s*(v[íi]deo|documento|imagem)\b[^\]]*\]/i

/**
 * PURO. Uma mensagem NOSSA que levou material (vídeo, documento, imagem): para o funil é o mesmo que
 * mandar o link (a 2ª mensagem). O vídeo da Baobá saiu como mídia e o cartão seguiu pedindo para mandá-lo.
 */
export function levouMaterial(texto: string | undefined): boolean {
  return MATERIAL.test(texto ?? '')
}
