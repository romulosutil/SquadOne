import type { GoogleGenAI } from "@google/genai";
import { gerarComRetry, MODEL } from "./orchestrator.ts";

/**
 * Áudio do Telegram → texto da demanda. Uma chamada ao Gemini com o arquivo
 * inline, SEPARADA do turno: o turno continua recebendo texto (o mesmo prompt,
 * a mesma validação, o mesmo redirecionamento de squad) e a resposta do chat
 * pode mostrar o que foi entendido antes de dizer o que foi marcado. Custo: uma
 * geração a mais por áudio, e o áudio passa pelo Google além do Telegram.
 */

/** Uma demanda falada não passa disto; resposta maior é o modelo divagando. */
export const MAX_TRANSCRICAO = 2000;

const INSTRUCAO =
  "Transcreva este áudio em português do Brasil, literalmente, como texto corrido. " +
  "É um pedido para um assistente de agenda. Não responda ao pedido, não resuma, " +
  "não acrescente nada: devolva só a transcrição. Se não houver fala inteligível, " +
  "devolva exatamente SEM_FALA.";

/** O áudio não tinha fala que desse para transcrever. Não é falha do servidor. */
export class AudioSemFala extends Error {
  constructor() {
    super("Não entendi o áudio.");
    this.name = "AudioSemFala";
  }
}

/** Texto da resposta do modelo, pronto para virar demanda. PURO. */
export function textoTranscrito(bruto: string | undefined | null): string {
  const texto = (bruto ?? "").replace(/\s+/g, " ").trim();
  if (!texto || texto === "SEM_FALA") throw new AudioSemFala();
  return texto.length <= MAX_TRANSCRICAO ? texto : texto.slice(0, MAX_TRANSCRICAO);
}

export async function transcreverAudio(ai: GoogleGenAI, bytes: Buffer, mime: string): Promise<string> {
  const resposta = await gerarComRetry(ai, {
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: mime, data: bytes.toString("base64") } },
          { text: INSTRUCAO },
        ],
      },
    ],
  });
  return textoTranscrito(resposta.text);
}
