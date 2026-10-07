import { cursorDoProximo } from "./pluggy-mapa.ts";

/**
 * Transporte da API da Pluggy (Meu Pluggy, conector 200). Só leitura: nenhum
 * método aqui altera nada na Pluggy nem no banco.
 *
 * Segredos: `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` vêm do EnvironmentFile
 * `~/.config/squadone/financas.env` (600, fora do repo, do n8n e de `data/`),
 * lido só pelo systemd deste processo. Nunca aparecem em log, erro ou
 * resposta: `ErroPluggy` leva só o status HTTP e o caminho SEM query.
 *
 * Nenhum valor de dinheiro é logado aqui nem em quem chama (RULES 24).
 */

export const API_PLUGGY = "https://api.pluggy.ai";
export const TIMEOUT_PLUGGY_MS = 20_000;
/** A apiKey vale ~2 h; renovar antes evita uma leitura longa morrer no meio. */
const VALIDADE_DA_CHAVE_MS = 90 * 60_000;
/** Teto de páginas por conta: 1 ano de extrato cabe com folga; um cursor em laço não roda para sempre. */
export const MAX_PAGINAS = 200;

export class PluggyMalConfigurado extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluggyMalConfigurado";
  }
}

export class ErroPluggy extends Error {
  constructor(
    readonly status: number | null,
    readonly caminho: string,
  ) {
    super(status === null ? `Pluggy sem resposta em ${caminho}` : `Pluggy respondeu ${status} em ${caminho}`);
    this.name = "ErroPluggy";
  }
}

export interface ConfigDaPluggy {
  clientId: string;
  clientSecret: string;
  itemIds: string[];
}

/** null = finanças sem Pluggy (o app abre com o que estiver no banco). Presente e ilegível = erro. */
export function lerConfigDaPluggy(env: NodeJS.ProcessEnv): ConfigDaPluggy | null {
  const clientId = (env.PLUGGY_CLIENT_ID ?? "").trim();
  const clientSecret = (env.PLUGGY_CLIENT_SECRET ?? "").trim();
  const itens = (env.PLUGGY_ITEM_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!clientId && !clientSecret && itens.length === 0) return null;
  if (!clientId || !clientSecret) throw new PluggyMalConfigurado("PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET vão juntos.");
  if (itens.length === 0) throw new PluggyMalConfigurado("PLUGGY_ITEM_IDS vazia: nenhuma conexão para ler.");
  // Ids da Pluggy são UUID; a regra é frouxa só no formato. Só o formato entra na mensagem, nunca o valor.
  if (!itens.every((i) => /^[A-Za-z0-9-]{8,64}$/.test(i))) throw new PluggyMalConfigurado("PLUGGY_ITEM_IDS: ids da Pluggy separados por vírgula.");
  return { clientId, clientSecret, itemIds: itens };
}

type Json = Record<string, any>;

export function criarClienteDaPluggy(config: ConfigDaPluggy, fetchFn: typeof fetch = fetch) {
  let chave: { valor: string; vence: number } | null = null;

  async function chamar(caminho: string, init: RequestInit = {}): Promise<Json> {
    const url = new URL(caminho, API_PLUGGY);
    let resposta: Response;
    try {
      resposta = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_PLUGGY_MS) });
    } catch {
      throw new ErroPluggy(null, url.pathname);
    }
    if (!resposta.ok) throw new ErroPluggy(resposta.status, url.pathname);
    return (await resposta.json()) as Json;
  }

  async function apiKey(forcar = false): Promise<string> {
    if (!forcar && chave && chave.vence > Date.now()) return chave.valor;
    const corpo = await chamar("/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret }),
    });
    if (typeof corpo.apiKey !== "string") throw new ErroPluggy(200, "/auth");
    chave = { valor: corpo.apiKey, vence: Date.now() + VALIDADE_DA_CHAVE_MS };
    return chave.valor;
  }

  /** GET autenticado; 401/403 renova a apiKey uma vez (venceu antes da hora). */
  async function get(caminho: string): Promise<Json> {
    try {
      return await chamar(caminho, { headers: { "X-API-KEY": await apiKey() } });
    } catch (erro) {
      if (erro instanceof ErroPluggy && (erro.status === 401 || erro.status === 403)) {
        return chamar(caminho, { headers: { "X-API-KEY": await apiKey(true) } });
      }
      throw erro;
    }
  }

  /** Paginação por página (accounts, bills, investments). */
  async function todasAsPaginas(caminho: string): Promise<Json[]> {
    const saida: Json[] = [];
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const sep = caminho.includes("?") ? "&" : "?";
      const corpo = await get(`${caminho}${sep}page=${pagina}`);
      saida.push(...(Array.isArray(corpo.results) ? corpo.results : []));
      if (!corpo.totalPages || pagina >= corpo.totalPages) break;
    }
    return saida;
  }

  const q = encodeURIComponent;
  return {
    item: (itemId: string) => get(`/items/${q(itemId)}`),
    contas: (itemId: string) => todasAsPaginas(`/accounts?itemId=${q(itemId)}`),
    faturas: (accountId: string) => todasAsPaginas(`/bills?accountId=${q(accountId)}`),
    investimentos: (itemId: string) => todasAsPaginas(`/investments?itemId=${q(itemId)}`),
    /** `/v2/transactions` com cursor; o `/transactions` v1 responde 410 desde 2026. */
    async transacoes(accountId: string): Promise<Json[]> {
      const saida: Json[] = [];
      let after: string | null = null;
      for (let i = 0; i < MAX_PAGINAS; i++) {
        const corpo: Json = await get(`/v2/transactions?accountId=${q(accountId)}${after ? `&after=${q(after)}` : ""}`);
        saida.push(...(Array.isArray(corpo.results) ? corpo.results : []));
        const proximo = cursorDoProximo(corpo.next);
        if (!proximo || proximo === after) break;
        after = proximo;
      }
      return saida;
    },
  };
}

export type ClienteDaPluggy = ReturnType<typeof criarClienteDaPluggy>;
