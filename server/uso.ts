import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { FUSO } from "./alocador.ts";
import { PRODUTOS } from "./ofertas.ts";

/**
 * Contador de uso da Central (AC-28, 17/10/2026). Até aqui ninguém sabia que tela do Dell era usada:
 * a SPA navega por pushState e o servidor só via as leituras da API, que a Hoje faz sozinha a cada
 * 5 min. Conta, por dia de São Paulo, as telas que a casca abriu (o beacon de `src/casca/rota.ts`) e as
 * escritas da API (método + caminho), para a próxima auditoria decidir o que fica.
 *
 * Privacidade (RULES 24 e a do CRM): a chave nunca leva id de lead, telefone, texto, valor nem query,
 * só `ver`/`produto` do CRM e "(ficha)" quando a ficha está aberta; das finanças, só o caminho. O que
 * não se reconhece vira "(outra)" em vez de ser guardado como veio: um caminho desconhecido pode ter
 * qualquer coisa dentro.
 *
 * Só existe no perfil operations (server.ts monta dentro do bloco do Dell). Não é escrita de domínio
 * (RULES 10): é um contador local, como o `status.json`, e o `GET` só lê.
 */

export interface UsoDoDia {
  /** AAAA-MM-DD de São Paulo. */
  dia: string;
  telas: Record<string, number>;
  escritas: Record<string, number>;
}

export type Evento = { tipo: "tela" | "escrita"; chave: string };

export const RETENCAO_EM_DIAS = 90;
export const ATRASO_DA_GRAVACAO_MS = 30_000;
/** Teto de chaves distintas por dia e por tipo: a chave já é de um conjunto pequeno, isto é só cinto. */
export const MAX_CHAVES_POR_DIA = 200;
export const CHAVE_DE_SOBRA = "(outras)";
export const TELA_DESCONHECIDA = "(outra)";
/** O corpo do beacon é `{"rota":"/crm?ver=funil&lead=1"}`: 1 KB sobra. */
export const MAX_CORPO_DO_BEACON = 1024;

const ARQUIVO_DO_DIA = /^(\d{4}-\d{2}-\d{2})\.json$/;
const METODOS_DE_ESCRITA = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// As vistas do CRM como o CrmPanel as lê (lerEndereco): os apelidos antigos contam na vista de hoje.
const VISTAS_DO_CRM: Record<string, string> = {
  funil: "funil",
  jornada: "jornada",
  triagem: "triagem",
  numeros: "numeros",
  resultados: "numeros",
  roteiro: "roteiro",
  colinha: "roteiro",
};
const PRODUTOS_DO_CRM: ReadonlySet<string> = new Set(PRODUTOS);
const TELAS_SEM_QUERY = new Set(["/", "/mais", "/agenda", "/squadone", "/design-system", "/financas", "/financas/lancamentos", "/financas/organizar"]);

// Depois destas palavras vem um id (pessoa, domínio, squad, lançamento, projeto, evento, turno).
const COLECOES_COM_ID = new Set(["pessoas", "dominios", "squads", "lancamentos", "projects", "quests", "turnos"]);

const formatoDoDia = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });

/** PURO: o dia de São Paulo de um instante (o Intl acerta a virada sem depender do fuso do processo). */
export function diaEmSaoPaulo(ms: number): string {
  return formatoDoDia.format(new Date(ms));
}

/**
 * PURO: a rota da SPA como chave de tela. Aceita o caminho com query (`/crm?ver=funil&lead=abc`) e
 * devolve só o que se pode guardar; o id do lead some e vira "(ficha)".
 */
export function normalizarTela(rota: string): string {
  let url: URL;
  try {
    url = new URL(rota, "http://squadone.invalido");
  } catch {
    return TELA_DESCONHECIDA;
  }
  if (url.origin !== "http://squadone.invalido") return TELA_DESCONHECIDA;
  const caminho = url.pathname.replace(/\/+$/, "") || "/";
  if (caminho === "/crm") {
    const q = url.searchParams;
    const partes: string[] = [];
    const ver = VISTAS_DO_CRM[q.get("ver") ?? ""];
    if (ver) partes.push(`ver=${ver}`);
    const produto = q.get("produto") ?? "";
    if (PRODUTOS_DO_CRM.has(produto)) partes.push(`produto=${produto}`);
    const ficha = (q.get("lead") ?? "") !== "";
    return `/crm${partes.length ? `?${partes.join("&")}` : ""}${ficha ? " (ficha)" : ""}`;
  }
  // O Escritório tem subcaminhos (/squadone/...): contam todos como o Escritório.
  if (caminho.startsWith("/squadone/")) return "/squadone";
  if (TELAS_SEM_QUERY.has(caminho)) return caminho;
  if (caminho.startsWith("/financas/")) return "/financas/(outra)";
  return TELA_DESCONHECIDA;
}

/** PURO: um segmento de caminho que pode ser guardado (palavra de rota, nunca id, número nem telefone). */
function segmentoSeguro(segmento: string): boolean {
  return /^[a-z][a-z-]{0,39}$/.test(segmento);
}

/**
 * PURO: a chave de uma escrita da API, `MÉTODO /api/.../:id`. `modelo` é o caminho da rota do Express
 * (`/api/financas` + `/lancamentos/:id`), que já vem sem id; sem ele, o caminho real passa pela mesma
 * peneira. Leitura e o próprio beacon não contam (null).
 */
export function normalizarChamada(metodo: string, caminho: string, modelo?: string): string | null {
  const m = metodo.toUpperCase();
  if (!METODOS_DE_ESCRITA.has(m)) return null;
  const cru = (modelo ?? caminho).split(/[?#]/)[0];
  if (!cru.startsWith("/api/")) return null;
  const segmentos = cru.split("/").filter(Boolean).slice(0, 8);
  const limpos: string[] = [];
  for (const [i, s] of segmentos.entries()) {
    const anterior = segmentos[i - 1] ?? "";
    if (s.startsWith(":") || COLECOES_COM_ID.has(anterior) || !segmentoSeguro(s)) limpos.push(":id");
    else limpos.push(s);
  }
  const final = `/${limpos.join("/")}`;
  if (final === "/api/operations/uso") return null;
  return `${m} ${final}`;
}

/**
 * PURO: o corpo do beacon (texto, porque o sendBeacon manda `text/plain`, ou objeto, se veio por
 * fetch com JSON) -> a chave da tela, ou null quando não é um pedido de tela.
 */
export function telaDoCorpo(corpo: unknown): string | null {
  let objeto: unknown = corpo;
  if (typeof corpo === "string") {
    if (corpo.length > MAX_CORPO_DO_BEACON) return null;
    try {
      objeto = JSON.parse(corpo);
    } catch {
      return null;
    }
  }
  if (!objeto || typeof objeto !== "object" || Array.isArray(objeto)) return null;
  const rota = (objeto as { rota?: unknown }).rota;
  if (typeof rota !== "string" || !rota.startsWith("/") || rota.length > 300) return null;
  return normalizarTela(rota);
}

/** PURO: soma um evento no agregado do dia, com o teto de chaves (o excedente vai para "(outras)"). */
export function somar(uso: UsoDoDia, evento: Evento, quantos = 1): UsoDoDia {
  const campo = evento.tipo === "tela" ? "telas" : "escritas";
  const atual = { ...uso[campo] };
  const chave = evento.chave in atual || Object.keys(atual).length < MAX_CHAVES_POR_DIA ? evento.chave : CHAVE_DE_SOBRA;
  atual[chave] = (atual[chave] ?? 0) + quantos;
  return { ...uso, [campo]: atual };
}

/** PURO: junta dois agregados do mesmo dia (o arquivo e o que ainda está na memória). */
export function juntar(a: UsoDoDia, b: UsoDoDia): UsoDoDia {
  let r: UsoDoDia = { dia: a.dia, telas: { ...a.telas }, escritas: { ...a.escritas } };
  for (const [chave, n] of Object.entries(b.telas)) r = somar(r, { tipo: "tela", chave }, n);
  for (const [chave, n] of Object.entries(b.escritas)) r = somar(r, { tipo: "escrita", chave }, n);
  return r;
}

/** PURO: o lido do disco, se legível; lixo vira um dia vazio (o contador nunca derruba nada). */
export function usoLido(lido: unknown, dia: string): UsoDoDia {
  const v = lido as Partial<UsoDoDia> | null;
  const limpo = (x: unknown): Record<string, number> => {
    const r: Record<string, number> = {};
    if (!x || typeof x !== "object") return r;
    for (const [k, n] of Object.entries(x)) if (typeof n === "number" && Number.isFinite(n) && n > 0) r[k] = Math.floor(n);
    return r;
  };
  return { dia, telas: limpo(v?.telas), escritas: limpo(v?.escritas) };
}

/** PURO: os arquivos de dia mais velhos que a retenção (90 dias contando hoje), para apagar. */
export function arquivosParaPodar(nomes: string[], hoje: string, retencao = RETENCAO_EM_DIAS): string[] {
  const corte = Date.parse(`${hoje}T00:00:00Z`) - (retencao - 1) * 86_400_000;
  return nomes.filter((nome) => {
    const m = ARQUIVO_DO_DIA.exec(nome);
    if (!m) return false;
    const quando = Date.parse(`${m[1]}T00:00:00Z`);
    return Number.isFinite(quando) && quando < corte;
  });
}

/** PURO: os N dias que terminam hoje, do mais novo ao mais velho. */
export function ultimosDias(hoje: string, n: number): string[] {
  const base = Date.parse(`${hoje}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(base - i * 86_400_000).toISOString().slice(0, 10));
}

// ------------------------------------------------------------------ cola (disco)

export interface ContadorDeUso {
  /** Cria a pasta (0700) e poda os dias velhos. */
  iniciar(): Promise<void>;
  contarTela(chave: string): void;
  contarEscrita(chave: string): void;
  /** Os últimos `dias` (1 a 90), com o que ainda não foi gravado. */
  ler(dias: number): Promise<UsoDoDia[]>;
  /** Grava o pendente já (o laço chama sozinho depois de ~30 s). */
  gravar(): Promise<void>;
}

export function criarContadorDeUso(opcoes: { dir: string; agora?: () => number; atrasoMs?: number }): ContadorDeUso {
  const agora = opcoes.agora ?? Date.now;
  const atraso = opcoes.atrasoMs ?? ATRASO_DA_GRAVACAO_MS;
  // O que ainda não foi para o disco, por dia: a gravação soma no arquivo, então um reinício só perde
  // os últimos ~30 s, nunca o dia.
  const pendente = new Map<string, UsoDoDia>();
  let relogio: ReturnType<typeof setTimeout> | null = null;
  let fila: Promise<unknown> = Promise.resolve();
  const emSerie = <T>(f: () => Promise<T>): Promise<T> => {
    const p = fila.then(f, f);
    fila = p.catch(() => undefined);
    return p;
  };
  const arquivo = (dia: string) => path.join(opcoes.dir, `${dia}.json`);

  async function lerDia(dia: string): Promise<UsoDoDia> {
    try {
      return usoLido(JSON.parse(await fs.readFile(arquivo(dia), "utf8")), dia);
    } catch {
      return usoLido(null, dia);
    }
  }

  function contar(evento: Evento) {
    const dia = diaEmSaoPaulo(agora());
    pendente.set(dia, somar(pendente.get(dia) ?? usoLido(null, dia), evento));
    // Debounce: um clique por vez não vira uma gravação por vez.
    if (!relogio) {
      relogio = setTimeout(() => {
        relogio = null;
        gravar().catch((error) => console.error("[uso] não gravou:", error instanceof Error ? error.message : error));
      }, atraso);
      relogio.unref?.();
    }
  }

  function gravar(): Promise<void> {
    return emSerie(async () => {
      if (!pendente.size) return;
      const lote = [...pendente.values()];
      pendente.clear();
      await fs.mkdir(opcoes.dir, { recursive: true, mode: 0o700 });
      for (const uso of lote) {
        const novo = juntar(await lerDia(uso.dia), uso);
        const tmp = `${arquivo(uso.dia)}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(novo), { mode: 0o600 });
        await fs.rename(tmp, arquivo(uso.dia));
      }
    });
  }

  return {
    async iniciar() {
      await fs.mkdir(opcoes.dir, { recursive: true, mode: 0o700 });
      // mkdir não muda o modo de uma pasta que já existia.
      await fs.chmod(opcoes.dir, 0o700).catch(() => undefined);
      const nomes = await fs.readdir(opcoes.dir).catch(() => [] as string[]);
      for (const nome of arquivosParaPodar(nomes, diaEmSaoPaulo(agora()))) {
        await fs.rm(path.join(opcoes.dir, nome), { force: true });
      }
    },
    contarTela: (chave) => contar({ tipo: "tela", chave }),
    contarEscrita: (chave) => contar({ tipo: "escrita", chave }),
    // Na mesma fila da gravação: no meio de uma, o lote já saiu da memória e ainda não está no disco.
    ler: (dias) => emSerie(async () => {
      const n = Math.min(RETENCAO_EM_DIAS, Math.max(1, Math.floor(dias) || 1));
      return Promise.all(ultimosDias(diaEmSaoPaulo(agora()), n).map(async (dia) => {
        const doDisco = await lerDia(dia);
        const naMemoria = pendente.get(dia);
        return naMemoria ? juntar(doDisco, naMemoria) : doDisco;
      }));
    }),
    gravar,
  };
}

/**
 * Middleware das escritas da API: conta quando a resposta sai e só se o pedido chegou numa rota
 * (`req.route`); o 403 da guarda de origem e o 404 de rota inexistente não são uso. A chave sai do
 * modelo da rota do Express, que não tem id.
 */
export function contarEscritasDaApi(contador: Pick<ContadorDeUso, "contarEscrita">) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (METODOS_DE_ESCRITA.has(req.method)) {
      res.on("finish", () => {
        try {
          const rota = req.route as { path?: unknown } | undefined;
          if (!rota || typeof rota.path !== "string") return;
          const chave = normalizarChamada(req.method, req.originalUrl, `${req.baseUrl}${rota.path}`);
          if (chave) contador.contarEscrita(chave);
        } catch {
          // Contar nunca derruba o pedido.
        }
      });
    }
    next();
  };
}
