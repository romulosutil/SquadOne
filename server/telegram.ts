import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Transporte do bot do Telegram: lê a config do ambiente e fala com a Bot API.
 * Só sabe mandar; quem decide o que uma mensagem significa é
 * `telegram-entrada.ts`, o que responder é `telegram-resposta.ts`, e quem cola
 * os dois ao turno é `telegram-bot.ts` (mesma divisão de push/lembretes/vigia).
 *
 * O token vai na URL da Bot API. Por isso nenhuma mensagem de erro deste módulo
 * repete a URL nem o `err.message` cru do fetch.
 *
 * Dois transportes de entrada (TELEGRAM_TRANSPORTE):
 * - `webhook` (padrão, Easypanel): o Telegram faz POST numa URL pública;
 * - `polling` (Dell): o processo busca com `getUpdates`. Webhook exigiria URL
 *   pública, e Funnel é proibido (regra 7); o polling só abre conexão de saída.
 *   Sem rota de webhook, a trava do segredo vira a do token, que só existe no
 *   Dell. Polling nunca chama setWebhook: o Telegram recusa `getUpdates`
 *   enquanto houver webhook, e quem o tira é o runbook (deleteWebhook SEM drop).
 */

export const ROTA_WEBHOOK_TELEGRAM = "/api/telegram/webhook";

/** Turno de 3 min já é da fila; uma chamada à Bot API que passa disto não vai voltar. */
export const TIMEOUT_TELEGRAM_MS = 10_000;

/** Segundos que o `getUpdates` segura a conexão esperando mensagem (long polling). */
export const TIMEOUT_POLLING_S = 50;
/** Mensagens e toques de botão: os mesmos do setWebhook. */
export const ATUALIZACOES_DO_BOT = ["message", "callback_query"] as const;

export type TransporteDoTelegram = "webhook" | "polling";

interface ConfigComum {
  token: string;
  chatsPermitidos: ReadonlySet<number>;
}

export type ConfigDeTelegram =
  | (ConfigComum & {
      transporte: "webhook";
      /** Valor do header `X-Telegram-Bot-Api-Secret-Token`; o mesmo passado ao setWebhook. */
      segredo: string;
    })
  | (ConfigComum & { transporte: "polling" });

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
 * Token ausente/vazio = bot desligado. Token presente exige allowlist válida —
 * e allowlist VAZIA É ERRO, ao contrário de IPS_PERMITIDOS: o username do bot é
 * público, e um bot aberto deixaria qualquer um criar eventos na sua agenda. O
 * segredo do webhook só é exigido (e só é lido) no transporte webhook. As
 * mensagens nunca repetem o valor lido.
 */
export function lerConfigDeTelegram(env: Record<string, string | undefined>): ConfigDeTelegram | null {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) return null;
  if (!FORMATO_TOKEN.test(token)) {
    throw new TelegramMalConfigurado("TELEGRAM_BOT_TOKEN fora do formato do BotFather (<número>:<chave>).");
  }
  const transporte = (env.TELEGRAM_TRANSPORTE ?? "").trim() || "webhook";
  if (transporte !== "webhook" && transporte !== "polling") {
    throw new TelegramMalConfigurado("TELEGRAM_TRANSPORTE deve ser 'webhook' ou 'polling'.");
  }
  let segredo = "";
  if (transporte === "webhook") {
    segredo = (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
    if (!FORMATO_SEGREDO.test(segredo)) {
      throw new TelegramMalConfigurado(
        "TELEGRAM_WEBHOOK_SECRET obrigatória com o bot em webhook: 32 a 256 caracteres entre letras, dígitos, '_' e '-'.",
      );
    }
  }
  const ids = (env.TELEGRAM_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new TelegramMalConfigurado("TELEGRAM_CHAT_IDS vazia: allowlist vazia não abre o bot. Informe o seu chat_id.");
  }
  if (!ids.every((id) => FORMATO_CHAT.test(id))) {
    throw new TelegramMalConfigurado("TELEGRAM_CHAT_IDS aceita só chat_id de conversa privada: inteiros positivos separados por vírgula.");
  }
  const chatsPermitidos = new Set(ids.map(Number));
  return transporte === "webhook"
    ? { transporte, token, segredo, chatsPermitidos }
    : { transporte, token, chatsPermitidos };
}

/** Para o log do boot: nunca token nem segredo. */
export function descreverTelegram(c: ConfigDeTelegram): string {
  const como = c.transporte === "webhook" ? `webhook em ${ROTA_WEBHOOK_TELEGRAM}` : "polling (getUpdates)";
  return `${como}, ${c.chatsPermitidos.size} chat(s) permitido(s)`;
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

async function chamar<T = unknown>(
  c: ConfigDeTelegram,
  metodo: string,
  corpo: Record<string, unknown>,
  timeoutMs = TIMEOUT_TELEGRAM_MS,
): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`https://api.telegram.org/bot${c.token}/${metodo}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
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
  botoes?: Botao[] | Botao[][],
  /** `silencioso`: chega sem som (o lembrete das 22h às 7h, OT-14). */
  opcoes?: { silencioso?: boolean },
): Promise<number | null> {
  // Uma fila de botões (o formato antigo) ou várias linhas (o aviso de venda, 16/10/2026).
  const linhas: Botao[][] = !botoes?.length ? [] : Array.isArray(botoes[0]) ? (botoes as Botao[][]) : [botoes as Botao[]];
  // O id volta para quem precisa editar depois sem um toque (o aviso de venda resolvido na Central, AC-06).
  const enviada = await chamar<{ message_id?: unknown }>(c, "sendMessage", {
    chat_id: chatId,
    text: texto,
    ...(opcoes?.silencioso ? { disable_notification: true } : {}),
    ...(responderA ? { reply_parameters: { message_id: responderA, allow_sending_without_reply: true } } : {}),
    ...(linhas.length
      ? { reply_markup: { inline_keyboard: linhas.map((l) => l.map((b) => ("url" in b ? { text: b.texto, url: b.url } : { text: b.texto, callback_data: b.dados }))) } }
      : {}),
  });
  return typeof enviada?.message_id === "number" ? enviada.message_id : null;
}

/**
 * Um botão inline: `dados` volta no `callback_query` (máx. 64 bytes); `url` abre o link
 * (o WhatsApp com a mensagem pronta, a ficha na tailnet) sem passar pelo bot.
 */
export type BotaoDeDados = { texto: string; dados: string };
export type Botao = BotaoDeDados | { texto: string; url: string };

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
 * já basta. `callback_query` = os botões Aprovar/Descartar das propostas. Só
 * existe no transporte webhook: o tipo não deixa o polling chamar.
 */
export async function registrarWebhook(c: Extract<ConfigDeTelegram, { transporte: "webhook" }>, url: string): Promise<void> {
  await chamar(c, "setWebhook", { url, secret_token: c.segredo, allowed_updates: [...ATUALIZACOES_DO_BOT] });
}

/**
 * Long polling: segura a conexão até `TIMEOUT_POLLING_S` esperando mensagem.
 * `offset` confirma ao Telegram tudo abaixo dele (o update some de lá). O
 * timeout do fetch fica 15 s acima do do Telegram: quem encerra a espera vazia
 * é ele, e um fetch que corta antes trataria a espera normal como falha.
 */
export async function buscarAtualizacoes(c: ConfigDeTelegram, offset: number | null): Promise<unknown[]> {
  const lido = await chamar<unknown>(
    c,
    "getUpdates",
    { ...(offset !== null ? { offset } : {}), timeout: TIMEOUT_POLLING_S, allowed_updates: [...ATUALIZACOES_DO_BOT] },
    (TIMEOUT_POLLING_S + 15) * 1000,
  );
  return Array.isArray(lido) ? lido : [];
}
