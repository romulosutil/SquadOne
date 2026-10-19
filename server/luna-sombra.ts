import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FunctionCall, FunctionDeclaration } from "@google/genai";
import { declarations, type Modo } from "./capabilities.ts";
import { FUSO } from "./alocador.ts";
import { pareceFinancas } from "./financas/parece-financas.ts";
import { diaDeSP } from "./tempo.ts";

/**
 * Luna em modo SOMBRA (ARCHITECTURE "Luna em modo sombra"): depois de cada
 * turno real do Gemini, a Luna (`gpt-6-luna`, pelo `codex exec` com o login
 * ChatGPT do Dell) recebe o MESMO systemInstruction e a mesma demanda, responde
 * só com as chamadas de capacidade que faria, em JSON, e o servidor compara com
 * as functionCalls do Gemini e grava o veredito. Nada do que ela responde é
 * executado, realimentado ou mostrado: é medição de ~30 dias para saber se ela
 * substituiria o Gemini. O código sobe desligado (`SQUADONE_LUNA_SOMBRA=true`
 * liga, só no perfil operations com a agenda).
 *
 * As funções do topo (prompt, interpretação, comparação, flags do --help) são
 * PURAS; `criarSombra` é a cola (fila, teto, timeout, arquivo) com o executor
 * injetado, para o teste rodar sem o `codex`.
 */

export const MODELO_LUNA = "gpt-6-luna";
/** Teto de UMA execução do codex. A fila é própria: estourar não segura turno nenhum. */
export const TIMEOUT_LUNA_MS = 120_000;
export const TETO_DIA_PADRAO = 10;
/**
 * Flags longas, de propósito: o boot confere cada uma no `codex exec --help`
 * do Dell, que o PC não tem como conferir. A forma curta (`-o`) não daria para
 * procurar com segurança no texto da ajuda.
 */
export const FLAGS_DO_CODEX = ["--model", "--sandbox", "--skip-git-repo-check", "--output-last-message"] as const;
/** Erro de cota do codex: para até o dia seguinte, sem insistir numa conta esgotada. */
export const COTA_ESGOTADA = /quota|usage limit|rate limit|too many requests|\b429\b|insufficient_quota|plan limit/i;

// --- Prompt ------------------------------------------------------------------

/**
 * O prompt da sombra: o MESMO systemInstruction do turno (a árvore da squad
 * ativa, as outras squads, a janela e a data), a declaração das capacidades em
 * JSON Schema e a demanda. A única diferença para o Gemini é que, sem function
 * calling, a Luna descreve as chamadas num JSON em vez de chamá-las.
 */
export function promptDaSombra(systemInstruction: string, demanda: string, decls: FunctionDeclaration[]): string {
  const capacidades = decls.map((d) => ({ nome: d.name, descricao: d.description, parametros: d.parameters }));
  return [
    systemInstruction,
    "",
    "---",
    "MODO SOMBRA. Nada do que você responder será executado: em vez de chamar as",
    "funções, descreva as chamadas que faria, com os mesmos nomes e argumentos que",
    "usaria nelas. Todas as regras acima continuam valendo.",
    "",
    "Capacidades (nome, descrição e parâmetros em JSON Schema):",
    JSON.stringify(capacidades, null, 1),
    "",
    "Demanda do usuário:",
    "<<<",
    demanda,
    ">>>",
    "",
    "Responda SOMENTE com um JSON neste formato, sem texto antes ou depois e sem",
    "cerca de código:",
    '{"chamadas":[{"nome":"<nome da capacidade>","args":{...}}]}',
    'Sem chamada a fazer: {"chamadas":[]}.',
  ].join("\n");
}

// --- Saída da Luna -------------------------------------------------------------

export interface ChamadaDeCapacidade {
  nome: string;
  args: Record<string, unknown>;
}

export type MotivoDaFalha =
  /** A Luna não devolveu nada. */
  | "vazio"
  /** Texto que não é JSON, nem com cerca de código. */
  | "json_invalido"
  /** JSON que não é `{"chamadas":[{nome, args}]}`. */
  | "formato"
  /** Um nome que não está em `declarations()`. */
  | "nome_desconhecido"
  | "timeout"
  | "cota"
  /** O codex saiu com erro (código ≠ 0, binário sumiu no meio...). */
  | "execucao"
  /** O codex saiu bem mas não escreveu a última mensagem. */
  | "sem_mensagem";

export type SaidaDaLuna =
  | { ok: true; chamadas: ChamadaDeCapacidade[] }
  | { ok: false; motivo: MotivoDaFalha; detalhe: string };

export function nomesDasCapacidades(decls: FunctionDeclaration[] = declarations()): string[] {
  return decls.map((d) => d.name ?? "").filter(Boolean);
}

/** JSON do texto: cru, dentro de cerca de código, ou do primeiro `{` ao último `}`. null = nada parseia. */
function extrairJson(texto: string): unknown | null {
  const tentativas = [texto];
  const cerca = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) tentativas.push(cerca[1].trim());
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio >= 0 && fim > inicio) tentativas.push(texto.slice(inicio, fim + 1));
  for (const t of tentativas) {
    try {
      return JSON.parse(t);
    } catch {
      // próxima forma
    }
  }
  return null;
}

/**
 * PURO. A resposta da Luna é DADO, nunca instrução: só vira chamada o que é
 * JSON válido no formato pedido e com nomes de `declarations()`; qualquer outra
 * coisa é `falhou` classificado. O `detalhe` nunca repete o texto dela (que
 * poderia trazer a demanda), só o que classifica a falha.
 */
export function interpretarSaidaDaLuna(texto: string, nomes: Iterable<string> = nomesDasCapacidades()): SaidaDaLuna {
  const validos = new Set(nomes);
  const bruto = (texto ?? "").trim();
  if (!bruto) return { ok: false, motivo: "vazio", detalhe: "a Luna não devolveu nada" };
  const json = extrairJson(bruto);
  if (json === null) return { ok: false, motivo: "json_invalido", detalhe: `não é JSON (${bruto.length} caracteres)` };
  if (!json || typeof json !== "object" || Array.isArray(json) || !Array.isArray((json as any).chamadas)) {
    return { ok: false, motivo: "formato", detalhe: 'esperado {"chamadas":[...]}' };
  }
  const chamadas: ChamadaDeCapacidade[] = [];
  for (const item of (json as { chamadas: unknown[] }).chamadas) {
    if (!item || typeof item !== "object" || typeof (item as any).nome !== "string") {
      return { ok: false, motivo: "formato", detalhe: "item sem 'nome'" };
    }
    const { nome, args } = item as { nome: string; args?: unknown };
    if (!validos.has(nome)) return { ok: false, motivo: "nome_desconhecido", detalhe: nome.slice(0, 80) };
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
      return { ok: false, motivo: "formato", detalhe: `'args' de ${nome} não é objeto` };
    }
    chamadas.push({ nome, args: (args ?? {}) as Record<string, unknown> });
  }
  return { ok: true, chamadas };
}

// --- Comparação -----------------------------------------------------------------

export type Veredito = "igual" | "parcial" | "diferente";

/**
 * Só os campos comparados. Título, nota de execução, notas e justificativa
 * ficam de fora de propósito: repetiriam a demanda em claro no registro, que
 * guarda só o hash dela (a não ser com SQUADONE_LUNA_GUARDAR_DEMANDA).
 */
export interface ResumoDaChamada {
  nome: string;
  responsavel_id?: string;
  tipo?: string;
  a_partir_de?: string;
  prazo_final?: string;
  inicio_fixo?: string;
  data?: string;
  duracao_min?: number;
  esforco_min?: number;
  squad_id?: string;
  dominio_id?: string;
  /** Quantidade, não os itens. */
  passos?: number;
}

export interface DetalheDaComparacao {
  nome: string;
  resultado: "igual" | "divergente" | "so_gemini" | "so_luna";
  gemini?: ResumoDaChamada;
  luna?: ResumoDaChamada;
  divergencias: string[];
}

export interface Comparacao {
  veredito: Veredito;
  detalhes: DetalheDaComparacao[];
}

const CAMPOS_TEXTO = ["responsavel_id", "tipo", "a_partir_de", "prazo_final", "inicio_fixo", "data", "squad_id", "dominio_id"] as const;
const CAMPOS_NUMERO = ["duracao_min", "esforco_min"] as const;
/** Duração/esforço são estimativa: até 25 % de diferença ainda é "a mesma intenção". */
export const TOLERANCIA_DE_MINUTOS = 0.25;

function texto(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  const t = valor.trim();
  return t || undefined;
}

function numero(valor: unknown): number | undefined {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && /^\s*\d+(\.\d+)?\s*$/.test(valor)) return Number(valor);
  return undefined;
}

export function resumirChamada(c: ChamadaDeCapacidade): ResumoDaChamada {
  const r: ResumoDaChamada = { nome: c.nome };
  for (const campo of CAMPOS_TEXTO) {
    const v = texto(c.args[campo]);
    if (v !== undefined) r[campo] = v;
  }
  for (const campo of CAMPOS_NUMERO) {
    const v = numero(c.args[campo]);
    if (v !== undefined) r[campo] = v;
  }
  if (Array.isArray(c.args.passos)) r.passos = c.args.passos.length;
  return r;
}

/** Campos em que a chamada da Luna diverge da do Gemini (mesmo nome já garantido). */
export function divergenciasEntre(gemini: ResumoDaChamada, luna: ResumoDaChamada): string[] {
  const d: string[] = [];
  for (const campo of CAMPOS_TEXTO) {
    const g = gemini[campo];
    const l = luna[campo];
    if (g === l) continue;
    d.push(`${campo}: ${g ?? "—"} → ${l ?? "—"}`);
  }
  for (const campo of CAMPOS_NUMERO) {
    const g = gemini[campo];
    const l = luna[campo];
    if (g === undefined && l === undefined) continue;
    if (g === undefined || l === undefined || Math.abs(l - g) > TOLERANCIA_DE_MINUTOS * g) {
      d.push(`${campo}: ${g ?? "—"} → ${l ?? "—"}`);
    }
  }
  return d;
}

/**
 * PURO. Cada chamada do Gemini procura, entre as da Luna de MESMO nome ainda
 * não pareadas, a que menos diverge. O que sobra de um lado só vira
 * `so_gemini`/`so_luna`. Veredito: `igual` quando tudo pareou sem divergência;
 * `diferente` quando nada pareou (inclusive um lado vazio e o outro não);
 * `parcial` no meio. Dois lados vazios são `igual`: os dois acharam que a
 * demanda não pedia nada.
 */
export function compararChamadas(gemini: ChamadaDeCapacidade[], luna: ChamadaDeCapacidade[]): Comparacao {
  const resumosLuna = luna.map(resumirChamada);
  const usadas = new Set<number>();
  const detalhes: DetalheDaComparacao[] = [];
  let pares = 0;
  for (const g of gemini.map(resumirChamada)) {
    let melhor: { indice: number; divergencias: string[] } | null = null;
    resumosLuna.forEach((l, indice) => {
      if (usadas.has(indice) || l.nome !== g.nome) return;
      const divergencias = divergenciasEntre(g, l);
      if (!melhor || divergencias.length < melhor.divergencias.length) melhor = { indice, divergencias };
    });
    if (!melhor) {
      detalhes.push({ nome: g.nome, resultado: "so_gemini", gemini: g, divergencias: [] });
      continue;
    }
    const { indice, divergencias } = melhor as { indice: number; divergencias: string[] };
    usadas.add(indice);
    pares++;
    detalhes.push({
      nome: g.nome,
      resultado: divergencias.length === 0 ? "igual" : "divergente",
      gemini: g,
      luna: resumosLuna[indice],
      divergencias,
    });
  }
  resumosLuna.forEach((l, indice) => {
    if (!usadas.has(indice)) detalhes.push({ nome: l.nome, resultado: "so_luna", luna: l, divergencias: [] });
  });

  let veredito: Veredito;
  if (gemini.length === 0 && luna.length === 0) veredito = "igual";
  else if (pares === 0) veredito = "diferente";
  else if (detalhes.every((d) => d.resultado === "igual")) veredito = "igual";
  else veredito = "parcial";
  return { veredito, detalhes };
}

// --- Conferência do binário -----------------------------------------------------

/**
 * PURO. Flags de `FLAGS_DO_CODEX` que o texto de `codex exec --help` NÃO lista.
 * Parse tolerante: a flag conta se aparece como palavra inteira em qualquer
 * forma que o clap imprime (`--model <MODEL>`, `-o, --output-last-message
 * <FILE>`, `[--sandbox]`).
 */
export function flagsAusentes(help: string, flags: readonly string[] = FLAGS_DO_CODEX): string[] {
  return flags.filter((flag) => {
    const re = new RegExp(`(^|[\\s,\\[<|(])${flag.replace(/[-]/g, "\\-")}(?=$|[\\s=,\\]>|)])`, "m");
    return !re.test(help);
  });
}

// --- Executor -------------------------------------------------------------------

export interface ProcessoDoCodex {
  stdout: string;
  stderr: string;
  /** Código de saída; null quando não houve (binário não achado, morto por sinal). */
  codigo: number | null;
  estourouTempo: boolean;
  /** `ENOENT` e afins: o processo nem subiu. */
  erro?: string;
}

export type ExecutorDoCodex = (
  bin: string,
  args: string[],
  opcoes: { cwd?: string; stdin?: string; timeoutMs: number },
) => Promise<ProcessoDoCodex>;

/**
 * Só o que o codex precisa para achar o binário, o login (~/.codex) e o
 * terminal. O serviço tem GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, TOKEN_ENC_KEY e a
 * credencial da Pluggy no ambiente, e o codex roda um agente com sandbox que
 * lê: nada disso vai para o filho.
 */
const ENV_DO_CODEX = ["HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "CODEX_HOME"];

export function ambienteDoCodex(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const limpo: NodeJS.ProcessEnv = {};
  for (const k of ENV_DO_CODEX) if (env[k] !== undefined) limpo[k] = env[k];
  return limpo;
}

/**
 * O executor de verdade: `execFile` (nunca shell), prompt pelo stdin (por
 * argumento ele apareceria em `ps` e no journal), timeout com SIGKILL.
 */
export const executarCodex: ExecutorDoCodex = (bin, args, { cwd, stdin, timeoutMs }) =>
  new Promise((resolver) => {
    const filho = execFile(
      bin,
      args,
      { cwd, timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: ambienteDoCodex() },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown; killed?: boolean; signal?: string | null }) | null;
        resolver({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          codigo: e === null ? 0 : typeof e.code === "number" ? e.code : null,
          estourouTempo: Boolean(e?.killed) || e?.signal === "SIGKILL",
          ...(typeof e?.code === "string" ? { erro: e.code } : {}),
        });
      },
    );
    if (filho.stdin) {
      // EPIPE se o codex morrer antes de ler: não pode virar exceção solta.
      filho.stdin.on("error", () => {});
      filho.stdin.end(stdin ?? "");
    }
  });

/** null = o binário serve; senão, o motivo para desligar a sombra, para o log. */
export async function conferirCodex(bin: string, executar: ExecutorDoCodex = executarCodex): Promise<string | null> {
  const p = await executar(bin, ["exec", "--help"], { timeoutMs: 30_000 });
  if (p.erro === "ENOENT") return `binário '${bin}' não encontrado (SQUADONE_CODEX_BIN ou PATH do serviço)`;
  if (p.erro) return `não deu para rodar '${bin}' (${p.erro})`;
  if (p.estourouTempo) return `'${bin} exec --help' não respondeu em 30 s`;
  if (p.codigo !== 0) return `'${bin} exec --help' saiu com código ${p.codigo}`;
  const faltam = flagsAusentes(`${p.stdout}\n${p.stderr}`);
  if (faltam.length > 0) return `codex exec --help não lista ${faltam.join(", ")}: versão do codex diferente da esperada`;
  return null;
}

// --- Configuração ---------------------------------------------------------------

export class SombraMalConfigurada extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SombraMalConfigurada";
  }
}

export interface ConfigDaSombra {
  ligada: boolean;
  tetoDia: number;
  guardarDemanda: boolean;
  bin: string;
}

/** `SQUADONE_LUNA_SOMBRA=true` liga; o resto só é lido ligada. Teto ilegível ou ≤ 0 lança. */
export function lerConfigDaSombra(env: NodeJS.ProcessEnv = process.env): ConfigDaSombra {
  const ligada = (env.SQUADONE_LUNA_SOMBRA ?? "").trim() === "true";
  const tetoBruto = (env.SQUADONE_LUNA_TETO_DIA ?? "").trim();
  let tetoDia = TETO_DIA_PADRAO;
  if (tetoBruto) {
    if (!/^\d+$/.test(tetoBruto) || Number(tetoBruto) <= 0) {
      throw new SombraMalConfigurada(`SQUADONE_LUNA_TETO_DIA='${tetoBruto}' não é um inteiro maior que zero.`);
    }
    tetoDia = Number(tetoBruto);
  }
  return {
    ligada,
    tetoDia,
    guardarDemanda: (env.SQUADONE_LUNA_GUARDAR_DEMANDA ?? "").trim() === "true",
    bin: (env.SQUADONE_CODEX_BIN ?? "").trim() || "codex",
  };
}

// --- A cola -----------------------------------------------------------------------

export interface ObservacaoDeTurno {
  systemInstruction: string;
  demanda: string;
  chamadasDoGemini: FunctionCall[];
  squadId: string;
  modo: Modo;
}

export interface RegistroDaSombra {
  quando: string;
  squad: string;
  modo: Modo;
  hashDaDemanda: string;
  tamanhoDaDemanda: number;
  /** Só com SQUADONE_LUNA_GUARDAR_DEMANDA=true. */
  demanda?: string;
  gemini: ResumoDaChamada[];
  /** null quando a Luna falhou. */
  luna: ResumoDaChamada[] | null;
  veredito: Veredito | "falhou";
  detalhes: DetalheDaComparacao[];
  duracaoMs: number;
  falha?: { motivo: MotivoDaFalha; detalhe: string };
}

export interface Logger {
  log(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

export interface DepsDaSombra {
  /** `SQUADONE_DATA_DIR/luna-sombra`: o JSONL do mês e o `cwd/` do codex. */
  dir: string;
  bin: string;
  tetoDia: number;
  guardarDemanda: boolean;
  executar: ExecutorDoCodex;
  agora?: () => Date;
  log?: Logger;
  declarations?: FunctionDeclaration[];
  timeoutMs?: number;
}

export interface Sombra {
  /** Enfileira e volta na hora. Nunca lança: a sombra observa, não participa. */
  observar(obs: ObservacaoDeTurno): void;
  /** Espera a fila esvaziar (testes e desligamento). */
  aguardar(): Promise<void>;
}

/** `AAAA-MM-DD` em São Paulo: o teto e a cota zeram à meia-noite local, não em UTC. */
export function diaLocal(d: Date, fuso: string = FUSO): string {
  if (fuso === FUSO) return diaDeSP(d);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function arquivoDoMes(dir: string, d: Date): string {
  return path.join(dir, `${diaLocal(d).slice(0, 7)}.jsonl`);
}

/** Quantas linhas do arquivo são do dia: o teto sobrevive a reinício. Arquivo ausente ou torto = 0. */
export async function contarLinhasDoDia(arquivo: string, dia: string): Promise<number> {
  let texto: string;
  try {
    texto = await fs.readFile(arquivo, "utf8");
  } catch {
    return 0;
  }
  let n = 0;
  for (const linha of texto.split("\n")) {
    if (!linha.trim()) continue;
    try {
      const { quando } = JSON.parse(linha) as { quando?: unknown };
      if (typeof quando === "string" && diaLocal(new Date(quando)) === dia) n++;
    } catch {
      // linha torta não conta
    }
  }
  return n;
}

export function hashDaDemanda(demanda: string): string {
  return createHash("sha256").update(demanda, "utf8").digest("hex");
}

export function criarSombra(deps: DepsDaSombra): Sombra {
  const log = deps.log ?? console;
  const agora = deps.agora ?? (() => new Date());
  const decls = deps.declarations ?? declarations();
  const nomes = nomesDasCapacidades(decls);
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_LUNA_MS;
  const cwd = path.join(deps.dir, "cwd");

  let fila: Promise<void> = Promise.resolve();
  let contador: { dia: string; usados: number } | null = null;
  let cotaEsgotadaNoDia: string | null = null;
  let avisouTetoNoDia: string | null = null;

  async function contadorDoDia(hoje: Date): Promise<{ dia: string; usados: number }> {
    const dia = diaLocal(hoje);
    if (!contador || contador.dia !== dia) {
      contador = { dia, usados: await contarLinhasDoDia(arquivoDoMes(deps.dir, hoje), dia) };
    }
    return contador;
  }

  async function gravar(registro: RegistroDaSombra, quando: Date): Promise<void> {
    await fs.mkdir(deps.dir, { recursive: true, mode: 0o700 });
    const arquivo = await fs.open(arquivoDoMes(deps.dir, quando), "a", 0o600);
    try {
      await arquivo.writeFile(`${JSON.stringify(registro)}\n`, "utf8");
    } finally {
      await arquivo.close();
    }
  }

  async function rodarLuna(prompt: string): Promise<{ saida: SaidaDaLuna; cota: boolean }> {
    await fs.mkdir(cwd, { recursive: true, mode: 0o700 });
    // A última mensagem vem de um arquivo dentro do cwd próprio, não do stdout
    // (que traz o progresso do agente). Apagado depois de lido.
    const arquivoDaResposta = path.join(cwd, `resposta-${randomUUID()}.txt`);
    const args = ["exec", "--model", MODELO_LUNA, "--sandbox", "read-only", "--skip-git-repo-check", "--output-last-message", arquivoDaResposta];
    try {
      const p = await deps.executar(deps.bin, args, { cwd, stdin: prompt, timeoutMs });
      let mensagem: string | null = null;
      try {
        mensagem = await fs.readFile(arquivoDaResposta, "utf8");
      } catch {
        mensagem = null;
      }
      if (p.estourouTempo) return { saida: { ok: false, motivo: "timeout", detalhe: `codex não respondeu em ${Math.round(timeoutMs / 1000)} s` }, cota: false };
      if (p.erro || p.codigo !== 0) {
        const texto = `${p.stderr}\n${p.stdout}`;
        if (COTA_ESGOTADA.test(texto)) return { saida: { ok: false, motivo: "cota", detalhe: "codex recusou por cota" }, cota: true };
        const primeiraLinha = p.stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
        return {
          saida: { ok: false, motivo: "execucao", detalhe: `${p.erro ?? `código ${p.codigo}`}${primeiraLinha ? `: ${primeiraLinha.slice(0, 200)}` : ""}` },
          cota: false,
        };
      }
      if (mensagem === null) return { saida: { ok: false, motivo: "sem_mensagem", detalhe: "codex saiu bem sem escrever a última mensagem" }, cota: false };
      return { saida: interpretarSaidaDaLuna(mensagem, nomes), cota: false };
    } finally {
      await fs.rm(arquivoDaResposta, { force: true });
    }
  }

  async function processar(obs: ObservacaoDeTurno): Promise<void> {
    // RULES 24: nada de finanças vai a modelo sem pedido do Rômulo, e o codex é um provedor de fora:
    // demanda que parece finanças não chega à Luna e não conta no teto (o Gemini do turno real já a atendeu).
    if (pareceFinancas(obs.demanda)) return;
    const inicio = agora();
    const { dia } = await contadorDoDia(inicio);
    if (cotaEsgotadaNoDia === dia) return;
    const c = contador!;
    if (c.usados >= deps.tetoDia) {
      if (avisouTetoNoDia !== dia) {
        log.log(`[luna] teto do dia atingido (${deps.tetoDia}): os próximos turnos de hoje não são observados`);
        avisouTetoNoDia = dia;
      }
      return;
    }
    // Conta a tentativa, não o sucesso: timeout em série não pode virar cota infinita.
    c.usados++;

    const gemini = obs.chamadasDoGemini.map((fc) => ({ nome: fc.name ?? "", args: (fc.args ?? {}) as Record<string, unknown> }));
    const { saida, cota } = await rodarLuna(promptDaSombra(obs.systemInstruction, obs.demanda, decls));
    const duracaoMs = agora().getTime() - inicio.getTime();
    if (cota) {
      cotaEsgotadaNoDia = dia;
      log.warn("[luna] codex recusou por cota: sombra parada até o dia seguinte");
    }

    // `=== false`, não `!saida.ok`: o tsconfig não é strict e a verdade/falsidade
    // não estreita a união; a comparação com o literal estreita.
    const falha = saida.ok === false ? { motivo: saida.motivo, detalhe: saida.detalhe } : null;
    const comparacao = saida.ok === true ? compararChamadas(gemini, saida.chamadas) : null;
    const registro: RegistroDaSombra = {
      quando: inicio.toISOString(),
      squad: obs.squadId,
      modo: obs.modo,
      hashDaDemanda: hashDaDemanda(obs.demanda),
      tamanhoDaDemanda: obs.demanda.length,
      ...(deps.guardarDemanda ? { demanda: obs.demanda } : {}),
      gemini: gemini.map(resumirChamada),
      luna: saida.ok === true ? saida.chamadas.map(resumirChamada) : null,
      veredito: comparacao?.veredito ?? "falhou",
      detalhes: comparacao?.detalhes ?? [],
      duracaoMs,
      ...(falha ? { falha } : {}),
    };
    await gravar(registro, inicio);
    log.log(
      `[luna] turno observado: ${registro.veredito}${falha ? ` (${falha.motivo})` : ""} · squad ${obs.squadId} · ${Math.round(duracaoMs / 1000)} s · ${c.usados}/${deps.tetoDia} hoje`,
    );
  }

  return {
    observar(obs) {
      fila = fila
        .then(() => processar(obs))
        .catch((err) => log.warn(`[luna] observação falhou: ${err instanceof Error ? err.message : String(err)}`));
    },
    aguardar: () => fila,
  };
}

/**
 * O boot: lê a env, confere o binário e devolve a sombra pronta, ou null com o
 * motivo no log. Só no perfil operations com a agenda ligada: fora disso a env
 * é ignorada e dita, como a DEADMAN_URL.
 */
export async function prepararSombra(
  env: NodeJS.ProcessEnv,
  contexto: { dataDir: string; operations: boolean; agendaAtiva: boolean },
  opcoes: { executar?: ExecutorDoCodex; log?: Logger } = {},
): Promise<Sombra | null> {
  const log = opcoes.log ?? console;
  let config: ConfigDaSombra;
  try {
    config = lerConfigDaSombra(env);
  } catch (err: any) {
    log.error(`[luna] sombra desligada: ${err?.message ?? err}`);
    return null;
  }
  if (!config.ligada) return null;
  if (!contexto.operations || !contexto.agendaAtiva) {
    log.log("[luna] SQUADONE_LUNA_SOMBRA ignorada: só no perfil operations com a agenda ligada");
    return null;
  }
  const executar = opcoes.executar ?? executarCodex;
  const motivo = await conferirCodex(config.bin, executar);
  if (motivo) {
    log.error(`[luna] sombra desligada: ${motivo}`);
    return null;
  }
  const dir = path.join(contexto.dataDir, "luna-sombra");
  await fs.mkdir(path.join(dir, "cwd"), { recursive: true, mode: 0o700 });
  log.log(`[luna] sombra ligada: ${MODELO_LUNA} pelo '${config.bin}', teto ${config.tetoDia}/dia, registro em ${dir}${config.guardarDemanda ? " (com a demanda em claro)" : ""}`);
  return criarSombra({ dir, bin: config.bin, tetoDia: config.tetoDia, guardarDemanda: config.guardarDemanda, executar, log });
}
