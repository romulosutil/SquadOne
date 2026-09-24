import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Transporte do bot do Telegram: lê a config do ambiente e fala com a Bot API.
 * Só sabe mandar; quem decide o que uma mensagem significa é
 * `telegram-entrada.ts`, o que responder é `telegram-resposta.ts`, e quem cola
 * os dois ao turno é `telegram-bot.ts` (mesma divisão de push/lembretes/vigia).
 *
 * O token vai na URL da Bot API. Por isso nenhuma mensagem de erro deste módulo
 * repete a URL nem o `err.message` cru do fetch.
 */

export const ROTA_WEBHOOK_TELEGRAM = "/api/telegram/webhook";

/** Turno de 3 min já é da fila; uma chamada à Bot API que passa disto não vai voltar. */
export const TIMEOUT_TELEGRAM_MS = 10_000;

export interface ConfigDeTelegram {
  token: string;
  /** Valor do header `X-Telegram-Bot-Api-Secret-Token`; o mesmo passado ao setWebhook. */
  segredo: string;
  chatsPermitidos: ReadonlySet<number>;
}

/** Env presente e ilegível. Ambiente: nenhuma mensagem no chat conserta. */
export class TelegramMalConfigurado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "TelegramMalConfigurado";
  }
}

export class ErroDeTelegram extends Error {
  /** Status HTTP da Bot API; null quando nem houve resposta (rede, timeout). */
  readonly status: number | null;
  constructor(mensagem: string, status: number | null) {
    super(mensagem);
    this.name = "ErroDeTelegram";
    this.status = status;
  }
}

const FORMATO_TOKEN = /^\d+:[A-Za-z0-9_-]{30,}$/;
/** O Telegram aceita 1–256; exigimos 32 porque é a única trava além do chat_id. */
const FORMATO_SEGREDO = /^[A-Za-z0-9_-]{32,256}$/;
/** Só chat privado: id positivo. Grupo (negativo) nunca entra, nem por engano na env. */
const FORMATO_CHAT = /^\d+$/;

/**
 * Token ausente/vazio = bot desligado. Token presente exige segredo e allowlist
 * válidos — e allowlist VAZIA É ERRO, ao contrário de IPS_PERMITIDOS: o username
 * do bot é público, e um bot aberto deixaria qualquer um criar eventos na sua
 * agenda. As mensagens nunca repetem o valor lido.
 */
export function lerConfigDeTelegram(env: Record<string, string | undefined>): ConfigDeTelegram | null {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) return null;
  if (!FORMATO_TOKEN.test(token)) {
    throw new TelegramMalConfigurado("TELEGRAM_BOT_TOKEN fora do formato do BotFather (<número>:<chave>).");
  }
  const segredo = (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!FORMATO_SEGREDO.test(segredo)) {
    throw new TelegramMalConfigurado(
      "TELEGRAM_WEBHOOK_SECRET obrigatória com o bot ligado: 32 a 256 caracteres entre letras, dígitos, '_' e '-'.",
    );
  }
  const ids = (env.TELEGRAM_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new TelegramMalConfigurado("TELEGRAM_CHAT_IDS vazia: allowlist vazia não abre o bot. Informe o seu chat_id.");
  }
  if (!ids.every((id) => FORMATO_CHAT.test(id))) {
    throw new TelegramMalConfigurado("TELEGRAM_CHAT_IDS aceita só chat_id de conversa privada: inteiros positivos separados por vírgula.");
  }
  return { token, segredo, chatsPermitidos: new Set(ids.map(Number)) };
}

/** Para o log do boot: nunca token nem segredo. */
export function descreverTelegram(c: ConfigDeTelegram): string {
  return `webhook em ${ROTA_WEBHOOK_TELEGRAM}, ${c.chatsPermitidos.size} chat(s) permitido(s)`;
}

/**
 * Tempo constante. O hash iguala o tamanho: `timingSafeEqual` lança com buffers
 * de tamanhos diferentes, e um `if` de tamanho antes vazaria o tamanho do segredo.
 */
export function segredoConfere(esperado: string, recebido: unknown): boolean {
  if (typeof recebido !== "string") return false;
  const a = createHash("sha256").update(esperado).digest();
  const b = createHash("sha256").update(recebido).digest();
  return timingSafeEqual(a, b);
}

async function chamar<T = unknown>(c: ConfigDeTelegram, metodo: string, corpo: Record<string, unknown>): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`https://api.telegram.org/bot${c.token}/${metodo}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_TELEGRAM_MS),
    });
  } catch (err: any) {
    // Só o nome/código: a mensagem do fetch pode trazer a URL, e a URL traz o token.
    const causa = err?.cause?.code ?? err?.name ?? "erro de rede";
    throw new ErroDeTelegram(`Telegram inacessível em ${metodo} (${causa}).`, null);
  }
  if (!resp.ok) {
    const lido: any = await resp.json().catch(() => ({}));
    const descricao = typeof lido?.description === "string" ? lido.description.slice(0, 200) : "";
    throw new ErroDeTelegram(`Telegram respondeu ${resp.status} em ${metodo}: ${descricao}`, resp.status);
  }
  const lido: any = await resp.json().catch(() => ({}));
  return lido?.result as T;
}

/**
 * Texto PURO, sem parse_mode: título de compromisso com `_` ou `*` quebraria o
 * Markdown do Telegram e a mensagem inteira seria recusada.
 */
export async function enviarMensagem(
  c: ConfigDeTelegram,
  chatId: number,
  texto: string,
  responderA?: number,
  botoes?: Botao[],
): Promise<void> {
  await chamar(c, "sendMessage", {
    chat_id: chatId,
    text: texto,
    ...(responderA ? { reply_parameters: { message_id: responderA, allow_sending_without_reply: true } } : {}),
    ...(botoes?.length ? { reply_markup: { inline_keyboard: [botoes.map((b) => ({ text: b.texto, callback_data: b.dados }))] } } : {}),
  });
}

/** Um botão inline: `dados` volta no `callback_query` (máx. 64 bytes). */
export interface Botao {
  texto: string;
  dados: string;
}

/** Tira o "carregando" do botão tocado; o texto aparece como aviso curto no topo do chat. */
export async function responderBotao(c: ConfigDeTelegram, callbackId: string, texto: string): Promise<void> {
  await chamar(c, "answerCallbackQuery", { callback_query_id: callbackId, text: texto.slice(0, 200) });
}

/** Troca o texto de uma mensagem do bot; sem `reply_markup`, os botões somem — o toque vale uma vez. */
export async function editarMensagem(c: ConfigDeTelegram, chatId: number, mensagemId: number, texto: string): Promise<void> {
  await chamar(c, "editMessageText", { chat_id: chatId, message_id: mensagemId, text: texto });
}

/**
 * Bytes de um arquivo mandado ao bot (a mensagem de voz). Duas etapas da Bot
 * API: `getFile` dá o caminho, e o download é por outra URL — que também leva
 * o token, então nenhum erro daqui repete a URL.
 */
export async function baixarArquivo(c: ConfigDeTelegram, fileId: string): Promise<Buffer> {
  const arquivo = await chamar<{ file_path?: string }>(c, "getFile", { file_id: fileId });
  if (!arquivo?.file_path) throw new ErroDeTelegram("Telegram não devolveu o caminho do arquivo.", null);
  let resp: Response;
  try {
    resp = await fetch(`https://api.telegram.org/file/bot${c.token}/${arquivo.file_path}`, {
      signal: AbortSignal.timeout(TIMEOUT_TELEGRAM_MS),
    });
  } catch (err: any) {
    const causa = err?.cause?.code ?? err?.name ?? "erro de rede";
    throw new ErroDeTelegram(`Telegram inacessível ao baixar o áudio (${causa}).`, null);
  }
  if (!resp.ok) throw new ErroDeTelegram(`Telegram respondeu ${resp.status} ao baixar o áudio.`, resp.status);
  return Buffer.from(await resp.arrayBuffer());
}

/** "digitando..." dura 5 s no Telegram: quem chama repete enquanto o turno roda. */
export async function avisarDigitando(c: ConfigDeTelegram, chatId: number): Promise<void> {
  await chamar(c, "sendChatAction", { chat_id: chatId, action: "typing" });
}

/**
 * Idempotente: o boot chama a cada deploy, então trocar o segredo e implantar
 * já basta. `callback_query` = os botões Aprovar/Descartar das propostas.
 */
export async function registrarWebhook(c: ConfigDeTelegram, url: string): Promise<void> {
  await chamar(c, "setWebhook", { url, secret_token: c.segredo, allowed_updates: ["message", "callback_query"] });
}
