import type { Modo } from "./capabilities.ts";

/**
 * PURO: o que um update do Telegram significa para o SquadOne. Sem fetch, env
 * nem Express, e o relógio chega por parâmetro — dá para fixar em tabela de casos.
 */

export type Entrada =
  | { tipo: "demanda"; updateId: number; chatId: number; mensagemId: number; demanda: string; modo: Modo }
  | { tipo: "atrasada"; updateId: number; chatId: number; mensagemId: number; atrasoMin: number }
  | { tipo: "ajuda"; updateId: number; chatId: number; mensagemId: number }
  | { tipo: "semTexto"; updateId: number; chatId: number; mensagemId: number }
  | { tipo: "naoAutorizado"; updateId: number; chatId: number }
  | { tipo: "ignorar"; updateId: number | null };

export const TEXTO_DE_AJUDA = [
  "Mande a demanda em texto, começando pelo assunto — a squad certa é escolhida pelo conteúdo.",
  "",
  "/foco <demanda> — primeiro horário livre a partir de agora",
  "/baixa <demanda> — encaixa até o 7º dia útil, depois dos outros",
  "Sem comando = o modelo escolhe o tipo (como o Auto do app).",
].join("\n");

export const TEXTO_SEM_TEXTO = "Só texto por enquanto.";

/**
 * Demanda mais velha que isto não roda. Enquanto a rota não existe (rollback,
 * config inválida, servidor fora) o Telegram guarda os updates por até ~24h e
 * reentrega tudo quando ela volta — com a memória de update_id vazia. Sem esta
 * guarda, um "/foco" das 9h viraria compromisso "a partir de agora" às 15h, ou
 * duplicado se o usuário já tivesse reenviado pelo app. 10 min cobre a
 * reentrega de um redeploy normal e ainda deixa "agora" perto do que o usuário quis.
 */
export const IDADE_MAXIMA_DEMANDA_MIN = 10;

export function textoDeDemandaAtrasada(atrasoMin: number): string {
  return `⌛ Não processei: esta mensagem chegou com ${atrasoMin} min de atraso (o SquadOne estava fora do ar). Reenvie se ainda valer.`;
}

/** Comandos que mudam o modo; o resto do texto é a demanda. Espelha o toggle da CommandBar. */
const MODOS: Record<string, Modo> = { foco: "foco", baixa: "baixa_prioridade" };

const COMANDO = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/;

export function interpretarUpdate(update: unknown, chatsPermitidos: ReadonlySet<number>, agora: Date): Entrada {
  const u = update as any;
  const updateId = typeof u?.update_id === "number" ? u.update_id : null;
  const m = u?.message;
  // Só `message`: editar uma mensagem já enviada rodaria o turno de novo e
  // duplicaria o compromisso.
  if (updateId === null || !m || typeof m !== "object") return { tipo: "ignorar", updateId };
  const chatId = m.chat?.id;
  if (typeof chatId !== "number" || m.chat?.type !== "private" || typeof m.message_id !== "number") {
    return { tipo: "ignorar", updateId };
  }
  // Autorização antes de qualquer interpretação: quem não está na lista não
  // recebe nem a ajuda.
  if (!chatsPermitidos.has(chatId)) return { tipo: "naoAutorizado", updateId, chatId };
  const base = { updateId, chatId, mensagemId: m.message_id as number };

  if (typeof m.text !== "string") return { tipo: "semTexto", ...base };
  const texto = m.text.trim();
  if (!texto) return { tipo: "semTexto", ...base };

  const cmd = COMANDO.exec(texto);
  const modo = cmd ? MODOS[cmd[1].toLowerCase()] : "auto";
  const demanda = cmd ? (cmd[2] ?? "").trim() : texto;
  if (!modo || !demanda) return { tipo: "ajuda", ...base };

  // Só a demanda envelhece: ajuda antiga não cria compromisso, responder não faz mal.
  // `date` ausente ou no futuro (relógio adiantado) não bloqueia — na dúvida, roda.
  if (typeof m.date === "number") {
    const idadeS = agora.getTime() / 1000 - m.date;
    if (idadeS > IDADE_MAXIMA_DEMANDA_MIN * 60) {
      return { tipo: "atrasada", ...base, atrasoMin: Math.floor(idadeS / 60) };
    }
  }
  return { tipo: "demanda", ...base, demanda, modo };
}

/**
 * O webhook responde 200 antes do turno; se o ACK se perder, o Telegram
 * reentrega o MESMO update_id e o compromisso nasceria duas vezes. Só memória:
 * redeploy zera, e reentrega atravessando um redeploy é custo aceito.
 */
export function criarMemoriaDeUpdates(capacidade = 500): { jaVisto(updateId: number): boolean } {
  const vistos = new Set<number>();
  const ordem: number[] = [];
  return {
    jaVisto(updateId) {
      if (vistos.has(updateId)) return true;
      vistos.add(updateId);
      ordem.push(updateId);
      if (ordem.length > capacidade) vistos.delete(ordem.shift()!);
      return false;
    },
  };
}
