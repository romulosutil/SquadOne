import { comToken, type ObterToken } from "./calendar.ts";

/**
 * Transporte do Google Tasks, no estilo de calendar.ts e só com o que a V1 usa:
 * criar e conferir uma lista, criar tarefa. Nenhuma regra de negócio — ordem,
 * vínculo e avisos moram em passos-no-google.ts.
 */

const BASE = "https://tasks.googleapis.com/tasks/v1";

/**
 * Teto de UMA chamada ao Tasks. Os passos rodam dentro da série de
 * agendar_evento do turno: um Tasks travado seguraria os compromissos
 * seguintes e o spinner do usuário.
 */
export const TIMEOUT_TASKS_MS = 10_000;

export function urlDeListas(): string {
  return `${BASE}/users/@me/lists`;
}

export function urlDaLista(listaId: string): string {
  return `${urlDeListas()}/${encodeURIComponent(listaId)}`;
}

export function urlDeTarefas(listaId: string): string {
  return `${BASE}/lists/${encodeURIComponent(listaId)}/tasks`;
}

/**
 * Erro do Google Tasks com o que separa os gestos. Três 403 diferentes pedem
 * três coisas: escopo insuficiente pede AMPLIAR o acesso (o Calendar segue
 * funcionando, então não é "Conectar"); API desligada no projeto não melhora
 * com clique nenhum do usuário; o resto é só mensagem.
 */
export class ErroTasks extends Error {
  readonly status: number;
  /** `reason` do primeiro item de `error.errors`; "" quando não vem. */
  readonly motivo: string;
  /** `reason` de cada item de `error.details` (formato google.rpc.ErrorInfo). */
  readonly detalhes: string[];

  constructor(status: number, corpo: string) {
    let motivo = "";
    let detalhes: string[] = [];
    let texto = corpo.slice(0, 300);
    try {
      const json = JSON.parse(corpo) as {
        error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] };
      };
      motivo = json.error?.errors?.[0]?.reason ?? "";
      detalhes = (json.error?.details ?? []).map((d) => d.reason ?? "").filter(Boolean);
      texto = json.error?.message ?? texto;
    } catch {
      // Corpo não-JSON (HTML de proxy, vazio): fica o recorte cru.
    }
    super(`Google Tasks respondeu ${status}: ${texto}`);
    this.name = "ErroTasks";
    this.status = status;
    this.motivo = motivo;
    this.detalhes = detalhes;
  }

  /**
   * Só 401. Diferente de `ErroCalendario.ehCredencial`, 403 de permissão NÃO
   * entra: com o Calendar funcionando, mandar reconectar seria mentira.
   */
  get ehCredencial(): boolean {
    return this.status === 401;
  }

  /** O token não carrega o escopo do Tasks: o gesto é "Autorizar Google Tasks". */
  get escopoInsuficiente(): boolean {
    return (
      this.status === 403 &&
      (this.motivo === "insufficientPermissions" || this.detalhes.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
    );
  }

  /** API do Tasks desligada no projeto Google: ambiente, a mensagem do Google diz o que fazer. */
  get apiDesligada(): boolean {
    return (
      this.status === 403 &&
      (this.motivo === "accessNotConfigured" || this.detalhes.includes("SERVICE_DISABLED"))
    );
  }
}

/** A lista gravada no roster foi apagada no Google (404/410). Quem chama cria outra. */
export class ListaSumiu extends Error {
  readonly listaId: string;
  constructor(listaId: string) {
    super(`A lista '${listaId}' não existe mais no Google Tasks.`);
    this.name = "ListaSumiu";
    this.listaId = listaId;
  }
}

/** O Tasks não respondeu dentro de TIMEOUT_TASKS_MS. */
export class TasksSemResposta extends Error {
  constructor() {
    super(`O Google Tasks não respondeu em ${TIMEOUT_TASKS_MS / 1000} s.`);
    this.name = "TasksSemResposta";
  }
}

export interface CorpoDeTarefa {
  title: string;
  notes?: string;
  /** RFC 3339; o Tasks guarda só a data. Ver `dueDaTarefa` em passos.ts. */
  due?: string;
}

async function chamar<T>(
  token: string,
  url: string,
  opcoes: { method?: string; corpo?: unknown } = {},
): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: opcoes.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opcoes.corpo !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_TASKS_MS),
    });
  } catch (err: any) {
    // Classificado: o aviso ao usuário diz "não respondeu", não "operation aborted".
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new TasksSemResposta();
    throw err;
  }
  if (!resp.ok) throw new ErroTasks(resp.status, await resp.text().catch(() => ""));
  return (await resp.json()) as T;
}

export async function inserirLista(token: string, titulo: string): Promise<{ id: string; title?: string }> {
  return chamar(token, urlDeListas(), { method: "POST", corpo: { title: titulo } });
}

/**
 * Confere se a lista gravada ainda existe. Existe porque o usuário apaga listas
 * no celular, e procurar por título para "achar de novo" criaria duplicatas
 * quando ele renomeia.
 */
export async function lerLista(token: string, listaId: string): Promise<{ id: string; title?: string }> {
  try {
    return await chamar(token, urlDaLista(listaId));
  } catch (err) {
    if (err instanceof ErroTasks && (err.status === 404 || err.status === 410)) throw new ListaSumiu(listaId);
    throw err;
  }
}

/**
 * `previous` ausente põe a tarefa no TOPO das irmãs (doc do tasks.insert):
 * quem cria uma série em ordem passa o id da anterior.
 */
export async function inserirTarefa(
  token: string,
  listaId: string,
  corpo: CorpoDeTarefa,
  posicao: { parent?: string; previous?: string } = {},
): Promise<{ id: string }> {
  const busca = new URLSearchParams();
  if (posicao.parent) busca.set("parent", posicao.parent);
  if (posicao.previous) busca.set("previous", posicao.previous);
  const query = busca.toString();
  return chamar(token, `${urlDeTarefas(listaId)}${query ? `?${query}` : ""}`, { method: "POST", corpo });
}

/** O retry de credencial do Calendar, com o critério do Tasks (só 401). */
export function comTokenTasks<T>(obter: ObterToken, fn: (token: string) => Promise<T>): Promise<T> {
  return comToken(obter, fn, (err) => err instanceof ErroTasks && err.ehCredencial);
}
