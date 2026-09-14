/**
 * Transporte dos lembretes: servidor ntfy PRÓPRIO (nunca ntfy.sh — o título do
 * compromisso é dado pessoal). Só sabe publicar; quem decide o que e quando
 * avisar é `lembretes.ts`, e quem varre é `vigia.ts`.
 */

export interface MensagemDePush {
  titulo: string;
  corpo: string;
  /** Escala do ntfy: 3 = padrão, 4 = alta (vibra/soa mais insistente). */
  prioridade: 1 | 2 | 3 | 4 | 5;
  /** Nomes de emoji do ntfy (viram ícone no início do título). */
  tags: string[];
  /** URL aberta ao tocar na notificação: o evento no Google Calendar. */
  clique?: string;
}

export interface ConfigDePush {
  /** Origem, sem barra final: `https://ntfy.exemplo.com`. */
  servidor: string;
  topico: string;
  /** Access token do ntfy (`tk_...`); null = servidor sem auth (dev local). */
  token: string | null;
}

/** LEMBRETES_NTFY_URL presente e ilegível. Ambiente: nenhum clique conserta. */
export class PushMalConfigurado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PushMalConfigurado";
  }
}

export class ErroDePush extends Error {
  /** Status HTTP do ntfy; null quando nem houve resposta (rede, timeout). */
  readonly status: number | null;
  constructor(mensagem: string, status: number | null) {
    super(mensagem);
    this.name = "ErroDePush";
    this.status = status;
  }

  /** 401/403: token errado ou sem escrita no tópico. Repetir não resolve. */
  get credencial(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/**
 * Lembrete que demora mais que isto já não serve, e a varredura seguinte tenta
 * de novo: esperar mais só atrasaria os outros avisos da mesma varredura.
 */
export const TIMEOUT_NTFY_MS = 5000;

/** Regra de nome de tópico do ntfy. */
const TOPICO = /^[-_A-Za-z0-9]{1,64}$/;

/**
 * Uma env só: `https://:TOKEN@host/topico`. Ausente/vazia = push desligado.
 * Presente e ilegível = erro — nunca liga calado num tópico errado. As mensagens
 * NUNCA repetem o valor: ele carrega o token.
 */
export function lerConfigDePush(env: Record<string, string | undefined>): ConfigDePush | null {
  const bruto = (env.LEMBRETES_NTFY_URL ?? "").trim();
  if (!bruto) return null;
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new PushMalConfigurado("LEMBRETES_NTFY_URL não é uma URL (formato: https://:TOKEN@host/topico).");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PushMalConfigurado("LEMBRETES_NTFY_URL precisa começar com https:// (ou http:// só em dev).");
  }
  if (url.search || url.hash) {
    throw new PushMalConfigurado("LEMBRETES_NTFY_URL não aceita query nem fragmento: só https://:TOKEN@host/topico.");
  }
  const topico = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!TOPICO.test(topico)) {
    throw new PushMalConfigurado(
      "LEMBRETES_NTFY_URL precisa de um tópico no caminho: letras, dígitos, '-' e '_', até 64, sem barra.",
    );
  }
  // Token como senha com usuário vazio (`https://:tk@host`) ou no lugar do usuário.
  const token = decodeURIComponent(url.password || url.username) || null;
  return { servidor: url.origin, topico, token };
}

/** Para o log do boot: nunca o token. */
export function descreverPush(c: ConfigDePush): string {
  return `${c.servidor}/${c.topico} (${c.token ? "com token" : "sem token"})`;
}

/**
 * Publicação JSON na raiz do servidor (`POST /` com `topic` no corpo): é o
 * formato do ntfy que aceita UTF-8 no título. Por cabeçalho (`Title:`) acento e
 * emoji exigiriam codificação à parte.
 */
export async function enviarPush(c: ConfigDePush, m: MensagemDePush): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`${c.servidor}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}),
      },
      body: JSON.stringify({
        topic: c.topico,
        title: m.titulo,
        message: m.corpo,
        priority: m.prioridade,
        tags: m.tags,
        ...(m.clique ? { click: m.clique } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_NTFY_MS),
    });
  } catch (err: any) {
    throw new ErroDePush(`ntfy inacessível: ${err?.message ?? String(err)}`, null);
  }
  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    throw new ErroDePush(`ntfy respondeu ${resp.status}: ${texto.slice(0, 200)}`, resp.status);
  }
}
