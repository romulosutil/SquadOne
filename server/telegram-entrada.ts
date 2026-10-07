import type { Modo } from "./capabilities.ts";

/**
 * PURO: o que um update do Telegram significa para o SquadOne. Sem fetch, env
 * nem Express, e o relógio chega por parâmetro — dá para fixar em tabela de casos.
 */

/**
 * `squadId` só existe com um prefixo de squad (`/p`); ausente = a primeira
 * squad ativa e o redirecionamento automático, como sempre.
 */
export type Entrada =
  | { tipo: "demanda"; updateId: number; chatId: number; mensagemId: number; demanda: string; modo: Modo; squadId?: string }
  /** Mensagem de voz/áudio: vira demanda depois de transcrita (`telegram-bot.ts`). */
  | { tipo: "audio"; updateId: number; chatId: number; mensagemId: number; fileId: string; mime: string; modo: Modo; squadId?: string }
  | { tipo: "audioLongo"; updateId: number; chatId: number; mensagemId: number }
  /** Toque num botão Aprovar/Descartar de uma proposta de contratação. */
  | { tipo: "botao"; updateId: number; chatId: number; mensagemId: number; callbackId: string; acao: "aprovar" | "descartar"; propostaId: string }
  | { tipo: "atrasada"; updateId: number; chatId: number; mensagemId: number; atrasoMin: number }
  | { tipo: "ajuda"; updateId: number; chatId: number; mensagemId: number }
  | { tipo: "semTexto"; updateId: number; chatId: number; mensagemId: number }
  | { tipo: "naoAutorizado"; updateId: number; chatId: number }
  | { tipo: "ignorar"; updateId: number | null };

export const TEXTO_DE_AJUDA = [
  "Mande a demanda em texto ou áudio (até 2 min), começando pelo assunto — a squad certa é escolhida pelo conteúdo.",
  "",
  "/foco <demanda> — primeiro horário livre a partir de agora",
  "/baixa <demanda> — encaixa até o 7º dia útil, depois dos outros",
  "/p <demanda> — direto na squad PRUMO, sem a escolha pelo conteúdo",
  "Dá para juntar: /p /foco <demanda>. No áudio, o comando vai na legenda.",
  "Sem comando = o modelo escolhe o tipo (como o Auto do app).",
].join("\n");

export const TEXTO_SEM_TEXTO = "Só texto ou áudio por enquanto.";

/**
 * Teto do áudio: a transcrição é uma chamada paga ao Gemini com o arquivo
 * inteiro inline, e uma demanda de verdade cabe em 2 min. 5 MB sobra para 2 min
 * de voz em OGG/Opus (~16 kbit/s) e fica bem abaixo do limite inline do Gemini.
 */
export const MAX_DURACAO_AUDIO_S = 120;
export const MAX_BYTES_AUDIO = 5 * 1024 * 1024;

export function textoDeAudioLongo(): string {
  return `🎙️ Áudio longo demais: mande até ${MAX_DURACAO_AUDIO_S / 60} min, ou escreva a demanda.`;
}

/** callback_data dos botões: `h:<id>:a|d`. O Telegram limita a 64 bytes. */
const BOTAO = /^h:([A-Za-z0-9_-]{1,40}):([ad])$/;

export function dadosDoBotao(propostaId: string, acao: "aprovar" | "descartar"): string {
  return `h:${propostaId}:${acao === "aprovar" ? "a" : "d"}`;
}

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

/**
 * Prefixos que fixam a squad do turno, sem estado: `/p ...` roda direto na
 * squad `prumo`, com a mesma ordem de sempre (squad antes do token e do
 * Gemini) e nenhuma chamada a mais ao modelo. Sem prefixo, nada muda: primeira
 * squad ativa e o redirecionamento automático. O redirecionamento continua
 * valendo DEPOIS do prefixo, como rede, se a demanda for de outra squad.
 *
 * Aponta para o ID, que nunca muda (renomear a squad não quebra o prefixo).
 * Squad arquivada ou inexistente: o turno falha com `SquadInexistente` antes
 * do Gemini, em vez de rodar calado em outra squad. Fixo no código, e não em
 * env ou no roster: é um atalho de digitação, e uma tabela que o usuário
 * edita seria estado novo para algo que o redirecionamento já resolve.
 */
export const PREFIXOS_DE_SQUAD: Readonly<Record<string, string>> = { p: "prumo" };

const COMANDO = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/;

interface Comandos {
  modo: Modo;
  squadId?: string;
  /** O texto depois dos comandos: a demanda. */
  resto: string;
}

/**
 * Os comandos do INÍCIO do texto: no máximo um de modo e um de squad, em
 * qualquer ordem (`/p /foco x` = `/foco /p x`). Barra no meio da demanda é
 * texto. null = comando desconhecido ou repetido, que vira ajuda. `hasOwn` e
 * não `MODOS[nome]`: `/constructor` acharia o protótipo do objeto.
 */
function lerComandos(texto: string): Comandos | null {
  let modo: Modo | undefined;
  let squadId: string | undefined;
  let resto = texto;
  for (let cmd = COMANDO.exec(resto); cmd; cmd = COMANDO.exec(resto)) {
    const nome = cmd[1].toLowerCase();
    if (Object.hasOwn(MODOS, nome) && !modo) modo = MODOS[nome];
    else if (Object.hasOwn(PREFIXOS_DE_SQUAD, nome) && !squadId) squadId = PREFIXOS_DE_SQUAD[nome];
    else return null;
    resto = (cmd[2] ?? "").trim();
  }
  return { modo: modo ?? "auto", ...(squadId ? { squadId } : {}), resto };
}

export function interpretarUpdate(update: unknown, chatsPermitidos: ReadonlySet<number>, agora: Date): Entrada {
  const u = update as any;
  const updateId = typeof u?.update_id === "number" ? u.update_id : null;
  if (updateId !== null && u?.callback_query) return interpretarBotao(updateId, u.callback_query, chatsPermitidos);
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

  // Só a demanda envelhece: ajuda antiga não cria compromisso, responder não faz mal.
  // `date` ausente ou no futuro (relógio adiantado) não bloqueia — na dúvida, roda.
  const atrasoMin = (): number | null => {
    if (typeof m.date !== "number") return null;
    const idadeS = agora.getTime() / 1000 - m.date;
    return idadeS > IDADE_MAXIMA_DEMANDA_MIN * 60 ? Math.floor(idadeS / 60) : null;
  };

  // Voz (nota do microfone) ou arquivo de áudio. A legenda pode trazer /foco,
  // /baixa e /p, como o texto; o resto da legenda é ignorado. Sem legenda, ou
  // com uma que não se lê, é auto na squad padrão.
  const audio = m.voice ?? (typeof m.audio?.mime_type === "string" && m.audio.mime_type.startsWith("audio/") ? m.audio : null);
  if (audio && typeof audio.file_id === "string") {
    const legenda = typeof m.caption === "string" ? lerComandos(m.caption.trim()) : null;
    if ((audio.duration ?? 0) > MAX_DURACAO_AUDIO_S || (audio.file_size ?? 0) > MAX_BYTES_AUDIO) {
      return { tipo: "audioLongo", ...base };
    }
    const atraso = atrasoMin();
    if (atraso !== null) return { tipo: "atrasada", ...base, atrasoMin: atraso };
    return {
      tipo: "audio",
      ...base,
      fileId: audio.file_id,
      mime: audio.mime_type ?? "audio/ogg",
      modo: legenda?.modo ?? "auto",
      ...(legenda?.squadId ? { squadId: legenda.squadId } : {}),
    };
  }

  if (typeof m.text !== "string") return { tipo: "semTexto", ...base };
  const texto = m.text.trim();
  if (!texto) return { tipo: "semTexto", ...base };

  const comandos = lerComandos(texto);
  if (!comandos || !comandos.resto) return { tipo: "ajuda", ...base };

  const atraso = atrasoMin();
  if (atraso !== null) return { tipo: "atrasada", ...base, atrasoMin: atraso };
  const { modo, squadId, resto: demanda } = comandos;
  return { tipo: "demanda", ...base, demanda, modo, ...(squadId ? { squadId } : {}) };
}

/**
 * Botão de proposta. Mesma trava da mensagem: só chat privado da allowlist —
 * a mensagem com os botões só foi mandada para lá, mas o update é que decide.
 * Sem guarda de idade: aprovar tarde não marca horário, e a proposta expira
 * sozinha na memória do bot.
 */
function interpretarBotao(updateId: number, q: any, chatsPermitidos: ReadonlySet<number>): Entrada {
  const chatId = q?.message?.chat?.id;
  if (typeof q?.id !== "string" || typeof chatId !== "number" || q.message?.chat?.type !== "private") {
    return { tipo: "ignorar", updateId };
  }
  if (!chatsPermitidos.has(chatId)) return { tipo: "naoAutorizado", updateId, chatId };
  const b = typeof q.data === "string" ? BOTAO.exec(q.data) : null;
  if (!b || typeof q.message?.message_id !== "number") return { tipo: "ignorar", updateId };
  return {
    tipo: "botao",
    updateId,
    chatId,
    mensagemId: q.message.message_id,
    callbackId: q.id,
    acao: b[2] === "a" ? "aprovar" : "descartar",
    propostaId: b[1],
  };
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
