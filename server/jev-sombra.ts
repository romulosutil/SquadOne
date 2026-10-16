import fs from "node:fs/promises";
import path from "node:path";
import type { Modo } from "./capabilities.ts";
import { lerGastoFalado } from "./financas/gasto-falado.ts";
import { arquivoDoMes, diaLocal, hashDaDemanda } from "./luna-sombra.ts";
import {
  criarClienteDoJev,
  descreverJev,
  ErroDeJev,
  lerConfigDoJev,
  mascararParaJev,
  type ClienteDoJev,
  type ConfigDoJev,
  type Logger,
  type MotivoDoErroDeJev,
  type Perguntas,
  type RespostaDoJev,
} from "./openrouter-decisoes.ts";
import { dominiosAtivos, squadsAtivas, type Roster, type Squad } from "./squad.ts";

/**
 * Jev em modo SOMBRA (perfis-e-experimentos.md, "Jev em sombra"): depois de
 * cada DEMANDA (não de cada turno do Gemini: com redirecionamento são dois
 * turnos e uma observação), o Jev (`typesafe/jev-1.13`, OpenRouter) recebe a
 * demanda e quatro perguntas — qual squad, qual sala, agenda ou tarefa, pede
 * contratação — e devolve probabilidades. Nada disso é executado, mostrado ou
 * realimentado: o servidor compara com o que o Gemini fez e grava. É medição
 * para saber se o Jev roteia demandas tão bem quanto o Gemini; NUNCA decide.
 *
 * Mesma forma da Luna (`server/luna-sombra.ts`): o topo é PURO (perguntas,
 * resumo do Gemini, comparação, filtro de finanças); `criarJevSombra` é a cola
 * (fila serial, teto/dia, teto de gasto, JSONL 600) com o cliente injetado;
 * `prepararJevSombra` é o boot, que devolve null fora do operations com a
 * agenda (nunca roda no Easypanel).
 */

// --- Perguntas ------------------------------------------------------------------

export interface OpcaoDeRoteamento {
  id: string;
  nome: string;
  escopo: string;
}

export type NomeDaPergunta = "squad" | "dominio" | "natureza" | "pede_contratacao";
export const NATUREZAS = ["agenda", "tarefa"] as const;
export type Natureza = (typeof NATUREZAS)[number];

/** A ordem em que cada `choice` foi mandada: mede o viés da primeira opção. */
export type OrdemDasOpcoes = Partial<Record<"squad" | "dominio" | "natureza", string[]>>;

export interface PerguntasDoTurno {
  perguntas: Perguntas;
  ordem: OrdemDasOpcoes;
}

/** Descrição de uma opção. Escopo longo vira só o começo: o Jev decide pela intenção. */
export const MAX_DESCRICAO = 400;
// "Contas" (pessoal--contas: boletos, assinaturas, vencimentos) é finanças para a RULES 27 por decisão do Rômulo
// (15/10/2026). `\bcontas\b` pega o nome "Contas" e o id "pessoal--contas" ("-" é fronteira de palavra).
const PARECE_FINANCAS_NO_NOME = /finan|\bcontas\b/i;

/**
 * PURO. Nome + escopo, SEM texto financeiro: um domínio de finanças entra só
 * pelo nome (o escopo dele fala de cartão e orçamento), e valor em dinheiro
 * some de qualquer escopo. O resto da máscara (telefone, e-mail...) é aplicado
 * de novo no `montarPedido`.
 */
export function descricaoDaOpcao(o: OpcaoDeRoteamento): string {
  const nome = o.nome.trim() || o.id;
  if (PARECE_FINANCAS_NO_NOME.test(nome) || PARECE_FINANCAS_NO_NOME.test(o.id)) return nome;
  const escopo = (o.escopo ?? "")
    .replace(/r\$\s*[\d.,]+/gi, "")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:reais|real|mil reais)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const texto = escopo ? `${nome}: ${escopo}` : nome;
  return texto.length > MAX_DESCRICAO ? `${texto.slice(0, MAX_DESCRICAO - 1)}…` : texto;
}

/** Fisher–Yates com o sorteio injetado (o teste fixa; em produção, Math.random). */
export function embaralhar<T>(itens: readonly T[], aleatorio: () => number): T[] {
  const r = [...itens];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(aleatorio() * (i + 1)));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

const DESCRICAO_NATUREZA: Record<Natureza, string> = {
  agenda: "um compromisso, bloco de foco ou prazo que ocupa horário na agenda (Google Calendar)",
  tarefa: "uma tarefa avulsa, sem horário marcado, para a lista de tarefas (Google Tasks)",
};

/**
 * PURO. As quatro perguntas do turno, com a ordem das opções EMBARALHADA e
 * devolvida: se o Jev preferir a primeira opção, o resumo mostra. `squad` e
 * `dominio` só entram com duas opções ou mais (com uma, não há o que medir).
 * Rótulo = id (é o que se compara com o Gemini); descrição = nome + escopo.
 */
export function perguntasDoTurno(
  squads: readonly OpcaoDeRoteamento[],
  dominiosDaSquad: readonly OpcaoDeRoteamento[],
  aleatorio: () => number = Math.random,
): PerguntasDoTurno {
  const perguntas: Perguntas = {};
  const ordem: OrdemDasOpcoes = {};
  const choice = (lista: readonly OpcaoDeRoteamento[]) => {
    const embaralhadas = embaralhar(lista, aleatorio);
    const criteria: Record<string, string> = {};
    for (const o of embaralhadas) criteria[o.id] = descricaoDaOpcao(o);
    return { criteria, ordem: embaralhadas.map((o) => o.id) };
  };
  if (squads.length >= 2) {
    const c = choice(squads);
    perguntas.squad = {
      type: "choice",
      instructions: "Qual squad deve cuidar desta demanda? Escolha pela descrição de cada squad (o que ela cuida e o que não cuida).",
      criteria: c.criteria,
    };
    ordem.squad = c.ordem;
  }
  if (dominiosDaSquad.length >= 2) {
    const c = choice(dominiosDaSquad);
    perguntas.dominio = {
      type: "choice",
      instructions: "Dentro da squad que cuida desta demanda, qual sala (domínio) é a responsável? Escolha pela descrição de cada sala.",
      criteria: c.criteria,
    };
    ordem.dominio = c.ordem;
  }
  const naturezas = embaralhar(NATUREZAS, aleatorio);
  perguntas.natureza = {
    type: "choice",
    instructions: "A demanda pede algo que ocupa horário na agenda ou uma tarefa sem horário?",
    criteria: Object.fromEntries(naturezas.map((n) => [n, DESCRICAO_NATUREZA[n]])),
  };
  ordem.natureza = naturezas;
  perguntas.pede_contratacao = {
    type: "noul",
    instructions: "A demanda pede para contratar alguém, criar um cargo ou abrir uma sala (domínio) nova no time?",
    criteria: {
      true: "sim: o pedido é aumentar o time ou criar uma área nova",
      false: "não: o pedido é um compromisso, uma tarefa ou outra coisa",
    },
  };
  return { perguntas, ordem };
}

// --- Finanças fora --------------------------------------------------------------

/**
 * PURO. A demanda parece finanças? Então nem sai do processo (RULES 24 e 27).
 * Conservador de propósito: perder uma medição custa nada; mandar "paguei a
 * fatura de 3.200" a um terceiro não tem volta. O gasto falado já não vira
 * turno no Telegram, mas a folha Pedir aceita qualquer texto.
 */
const PALAVRAS_DE_FINANCAS = /\b(?:r\$|reais|fatura|extrato|saldo|or[cç]amento|cart[aã]o de cr[eé]dito|pluggy|investiment\w*|pix|boleto|empr[eé]stimo|parcela\w*|gastei|paguei|gasto|sal[aá]rio\w*|holerite|contracheque|d[ií]vida\w*|impostos?|darf|irpf|iptu|ipva|inss|fgts|dinheiro|juros|financiamento\w*|rendimento\w*|mensalidade\w*|cdb|tesouro direto|selic)\b/i;
// Ampliada em 15/10/2026 (a auditoria achou "salário", "dívida", "imposto" passando). Só palavras que, no uso do Rômulo,
// quase sempre são dinheiro dele; o erro é sempre para o lado de pular (perde uma medição, não vaza nada). Ficaram
// de fora, de propósito, "conta", "cartão" e "transferência" sozinhos (ambíguos demais) e a sala pessoal--contas:
// se "Contas" conta como finanças para a RULES 27 é decisão dele.

export function pareceFinancas(demanda: string): boolean {
  if (lerGastoFalado(demanda)) return true;
  if (/r\$/i.test(demanda)) return true;
  return PALAVRAS_DE_FINANCAS.test(demanda);
}

// --- O que o Gemini fez -----------------------------------------------------------

export interface ChamadaCrua {
  name?: string;
  args?: Record<string, unknown>;
}

export interface ResumoDoGemini {
  /** A squad onde o turno terminou (a de destino, com redirecionamento). */
  squad: string;
  /** Domínio do `responsavel_id` da primeira chamada que agenda ou cria tarefa; null sem ela. */
  dominio: string | null;
  /** agendar_evento → agenda; só criar_tarefa → tarefa; nenhuma → null. */
  natureza: Natureza | null;
  /** `tipo` do primeiro agendar_evento. */
  tipo: string | null;
  /** Propôs contratar ou abrir sala (criar_po_dominio, contratar_integrante). */
  crescimento: boolean;
  /** O último turno ainda sugeriu troca (o empate do teto de um salto). */
  trocaSugerida: boolean;
}

/** PURO. `dominioDaPessoa` resolve o responsável no roster (null = não achou). */
export function resumoDoGemini(
  chamadas: readonly ChamadaCrua[],
  squadFinal: string,
  dominioDaPessoa: (pessoaId: string) => string | null,
): ResumoDoGemini {
  const nomes = chamadas.map((c) => c.name ?? "");
  const agenda = chamadas.find((c) => c.name === "agendar_evento");
  const comResponsavel = chamadas.find((c) => (c.name === "agendar_evento" || c.name === "criar_tarefa") && typeof c.args?.responsavel_id === "string");
  const tipo = agenda && typeof agenda.args?.tipo === "string" ? (agenda.args.tipo as string) : null;
  return {
    squad: squadFinal,
    dominio: comResponsavel ? dominioDaPessoa(comResponsavel.args!.responsavel_id as string) : null,
    natureza: agenda ? "agenda" : nomes.includes("criar_tarefa") ? "tarefa" : null,
    tipo,
    crescimento: nomes.includes("criar_po_dominio") || nomes.includes("contratar_integrante"),
    trocaSugerida: nomes.includes("sugerir_troca_squad"),
  };
}

// --- Respostas e comparação --------------------------------------------------------

export interface RespostaCompacta {
  /** Escolha (choice) ou "true"/"false" (noul, corte em 0,5). */
  c: string;
  /** Probabilidade da escolha (choice) ou o `noul`. */
  p: number;
  conf?: number | null;
  /** Probabilidades por rótulo, 4 casas. */
  probs?: Record<string, number>;
}

const arred = (n: number) => Math.round(n * 10_000) / 10_000;

export function compactarRespostas(r: RespostaDoJev): Partial<Record<NomeDaPergunta, RespostaCompacta>> {
  const out: Partial<Record<NomeDaPergunta, RespostaCompacta>> = {};
  for (const [nome, resp] of Object.entries(r.respostas)) {
    if (resp.type === "noul") {
      out[nome as NomeDaPergunta] = { c: resp.noul >= 0.5 ? "true" : "false", p: arred(resp.noul) };
    } else {
      out[nome as NomeDaPergunta] = {
        c: resp.choice,
        p: arred(resp.probabilities[resp.choice] ?? 0),
        conf: resp.confidence === null ? null : arred(resp.confidence),
        probs: Object.fromEntries(Object.entries(resp.probabilities).map(([k, v]) => [k, arred(v)])),
      };
    }
  }
  return out;
}

export interface ItemDaComparacao {
  jev: string;
  /** Confiança do Jev na própria escolha: o `p` da escolha, ou max(noul, 1 − noul). */
  p: number;
  gemini: string | null;
  /** null quando o Gemini não decidiu isso (sem chamada que diga). */
  concorda: boolean | null;
}

export type ComparacaoComGemini = Partial<Record<NomeDaPergunta, ItemDaComparacao>>;

/**
 * PURO. Cada pergunta respondida contra o que o Gemini fez. Com `trocaSugerida`
 * (o teto de um salto: o Gemini ainda achava que a squad era outra), a squad
 * "final" e o domínio dela são uma escolha que o próprio Gemini descartou:
 * ficam como não comparáveis em vez de contar como acerto ou erro do Jev.
 */
export function compararComGemini(respostas: Partial<Record<NomeDaPergunta, RespostaCompacta>>, gemini: ResumoDoGemini): ComparacaoComGemini {
  const out: ComparacaoComGemini = {};
  const item = (r: RespostaCompacta, g: string | null, p = r.p): ItemDaComparacao => ({ jev: r.c, p, gemini: g, concorda: g === null ? null : r.c === g });
  const semGabarito = (i: ItemDaComparacao): ItemDaComparacao => (gemini.trocaSugerida ? { ...i, concorda: null } : i);
  if (respostas.squad) out.squad = semGabarito(item(respostas.squad, gemini.squad));
  if (respostas.dominio) out.dominio = semGabarito(item(respostas.dominio, gemini.dominio));
  if (respostas.natureza) out.natureza = item(respostas.natureza, gemini.natureza);
  if (respostas.pede_contratacao) {
    const r = respostas.pede_contratacao;
    out.pede_contratacao = item(r, gemini.crescimento ? "true" : "false", arred(Math.max(r.p, 1 - r.p)));
  }
  return out;
}

// --- O registro ---------------------------------------------------------------------

export interface RegistroDoJev {
  quando: string;
  modeloPedido: string;
  /** null quando a chamada falhou. */
  modeloRespondeu: string | null;
  modo: Modo;
  hashDaDemanda: string;
  tamanhoDaDemanda: number;
  /** Só com SQUADONE_JEV_GUARDAR_DEMANDA=true, e já mascarada (é o que saiu). */
  demanda?: string;
  squadExplicita: boolean;
  squadInicial: string;
  squadFinal: string;
  redirecionado: boolean;
  ordem: OrdemDasOpcoes;
  respostas: Partial<Record<NomeDaPergunta, RespostaCompacta>> | null;
  gemini: ResumoDoGemini;
  comparacao: ComparacaoComGemini | null;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  latenciaMs: number;
  falha?: { motivo: MotivoDoErroDeJev; status: number | null };
}

/** Demanda que nem saiu do processo: conta para o resumo, não para os tetos. */
export interface RegistroPulado {
  quando: string;
  pulada: "financas";
}

export type LinhaDoJev = RegistroDoJev | RegistroPulado;

export function ehPulada(l: LinhaDoJev): l is RegistroPulado {
  return (l as RegistroPulado).pulada !== undefined;
}

async function linhasDe(arquivo: string): Promise<LinhaDoJev[]> {
  let texto: string;
  try {
    texto = await fs.readFile(arquivo, "utf8");
  } catch {
    return [];
  }
  const linhas: LinhaDoJev[] = [];
  for (const l of texto.split("\n")) {
    if (!l.trim()) continue;
    try {
      linhas.push(JSON.parse(l));
    } catch {
      // linha torta não conta
    }
  }
  return linhas;
}

/** Chamadas (não puladas) gravadas hoje: o teto do dia sobrevive a reinício. */
export async function contarChamadasDoDia(arquivo: string, dia: string): Promise<number> {
  return (await linhasDe(arquivo)).filter((l) => !ehPulada(l) && typeof l.quando === "string" && diaLocal(new Date(l.quando)) === dia).length;
}

/** Soma de `cost` de TODOS os JSONL do diretório: o teto é do total, como o saldo da conta. */
export async function somarGasto(dir: string): Promise<number> {
  let nomes: string[];
  try {
    nomes = (await fs.readdir(dir)).filter((n) => n.endsWith(".jsonl"));
  } catch {
    return 0;
  }
  let total = 0;
  for (const nome of nomes) {
    for (const l of await linhasDe(path.join(dir, nome))) {
      if (!ehPulada(l) && typeof l.cost === "number" && Number.isFinite(l.cost) && l.cost > 0) total += l.cost;
    }
  }
  return total;
}

// --- A cola -------------------------------------------------------------------------

export interface ObservacaoDeDemanda {
  demanda: string;
  modo: Modo;
  /** O roster lido no começo do turno. */
  roster: Roster;
  squadInicial: Squad;
  /** `pedido.squadId !== undefined`: a aba ou o `/p` escolheram a squad. */
  squadExplicita: boolean;
  /** Id da squad de destino quando o servidor redirecionou; null sem redirecionamento. */
  redirecionadoPara: string | null;
  /** As functionCalls do ÚLTIMO turno do Gemini (o que de fato valeu). */
  chamadas: readonly ChamadaCrua[];
}

export interface DepsDoJevSombra {
  /** `SQUADONE_DATA_DIR/jev-sombra`. */
  dir: string;
  cliente: ClienteDoJev;
  modelo: string;
  tetoDia: number;
  tetoUsd: number;
  guardarDemanda: boolean;
  /** Já somado no boot; ausente = soma na primeira observação. */
  gastoInicial?: number;
  agora?: () => Date;
  /** Relógio de latência (ms). */
  cronometro?: () => number;
  aleatorio?: () => number;
  log?: Logger;
}

export interface JevSombra {
  /** Enfileira e volta na hora. Nunca lança: a sombra mede, não participa. */
  observarDemanda(obs: ObservacaoDeDemanda): void;
  /** Espera a fila esvaziar (testes e desligamento). */
  aguardar(): Promise<void>;
}

const MAX_STATE = 2_000;

interface Preparada {
  quando: Date;
  state: string;
  perguntas: Perguntas;
  registroBase: Omit<RegistroDoJev, "modeloRespondeu" | "respostas" | "comparacao" | "input_tokens" | "output_tokens" | "cost" | "latenciaMs" | "falha">;
}

/**
 * O que é síncrono e puro, fora da fila: assim o turno pode mudar o roster
 * depois (uma contratação aplicada) sem a observação ver o roster novo.
 * Devolve "financas" quando a demanda nem pode sair.
 */
function preparar(obs: ObservacaoDeDemanda, deps: DepsDoJevSombra, quando: Date): Preparada | "financas" {
  if (pareceFinancas(obs.demanda)) return "financas";
  const ativas = squadsAtivas(obs.roster);
  const squadFinalId = obs.redirecionadoPara ?? obs.squadInicial.id;
  const squadFinal = ativas.find((s) => s.id === squadFinalId) ?? obs.squadInicial;
  const dominioDe = new Map<string, { id: string; nome: string }>();
  for (const d of squadFinal.dominios) {
    dominioDe.set(d.po.id, d);
    for (const p of d.integrantes) dominioDe.set(p.id, d);
  }
  const gemini = resumoDoGemini(obs.chamadas, squadFinal.id, (id) => dominioDe.get(id)?.id ?? null);
  // A sala que o Gemini escolheu é a de finanças: a demanda é de finanças, mesmo sem a palavra.
  const salaDoGemini = gemini.dominio ? squadFinal.dominios.find((d) => d.id === gemini.dominio) : null;
  if (salaDoGemini && (PARECE_FINANCAS_NO_NOME.test(salaDoGemini.nome) || PARECE_FINANCAS_NO_NOME.test(salaDoGemini.id))) return "financas";

  const { perguntas, ordem } = perguntasDoTurno(
    ativas.map((s) => ({ id: s.id, nome: s.nome, escopo: s.escopo })),
    dominiosAtivos(squadFinal).map((d) => ({ id: d.id, nome: d.nome, escopo: d.escopo })),
    deps.aleatorio,
  );
  // Máscara ANTES do corte: cortar primeiro podia partir um telefone ou CPF ao meio e deixá-lo sem máscara.
  const state = mascararParaJev(obs.demanda.trim()).slice(0, MAX_STATE);
  return {
    quando,
    state,
    perguntas,
    registroBase: {
      quando: quando.toISOString(),
      modeloPedido: deps.modelo,
      modo: obs.modo,
      hashDaDemanda: hashDaDemanda(obs.demanda),
      tamanhoDaDemanda: obs.demanda.length,
      ...(deps.guardarDemanda ? { demanda: state } : {}),
      squadExplicita: obs.squadExplicita,
      squadInicial: obs.squadInicial.id,
      squadFinal: squadFinal.id,
      redirecionado: obs.redirecionadoPara !== null && obs.redirecionadoPara !== obs.squadInicial.id,
      ordem,
      gemini,
    },
  };
}

export function criarJevSombra(deps: DepsDoJevSombra): JevSombra {
  const log = deps.log ?? console;
  const agora = deps.agora ?? (() => new Date());
  const cronometro = deps.cronometro ?? (() => performance.now());

  let fila: Promise<void> = Promise.resolve();
  let contador: { dia: string; usados: number } | null = null;
  let gasto: number | null = deps.gastoInicial ?? null;
  let avisouTetoNoDia: string | null = null;
  let avisouGasto = false;

  async function gravar(linha: LinhaDoJev, quando: Date): Promise<void> {
    await fs.mkdir(deps.dir, { recursive: true, mode: 0o700 });
    const arquivo = await fs.open(arquivoDoMes(deps.dir, quando), "a", 0o600);
    try {
      await arquivo.writeFile(`${JSON.stringify(linha)}\n`, "utf8");
    } finally {
      await arquivo.close();
    }
  }

  async function processar(p: Preparada): Promise<void> {
    if (deps.cliente.desligado()) return; // o cliente já logou uma vez
    const dia = diaLocal(p.quando);
    if (!contador || contador.dia !== dia) {
      contador = { dia, usados: await contarChamadasDoDia(arquivoDoMes(deps.dir, p.quando), dia) };
    }
    if (gasto === null) gasto = await somarGasto(deps.dir);
    if (gasto >= deps.tetoUsd) {
      if (!avisouGasto) {
        log.warn(`[jev] teto de gasto atingido (US$ ${gasto.toFixed(5)} de ${deps.tetoUsd}): sombra parada até mudar SQUADONE_JEV_TETO_USD e reiniciar`);
        avisouGasto = true;
      }
      return;
    }
    if (contador.usados >= deps.tetoDia) {
      if (avisouTetoNoDia !== dia) {
        log.log(`[jev] teto do dia atingido (${deps.tetoDia}): as próximas demandas de hoje não são observadas`);
        avisouTetoNoDia = dia;
      }
      return;
    }
    // Conta a tentativa, não o sucesso: falha em série não vira chamada infinita.
    contador.usados++;

    const inicio = cronometro();
    let resposta: RespostaDoJev | null = null;
    let falha: RegistroDoJev["falha"] | undefined;
    try {
      resposta = await deps.cliente.decidir(p.state, p.perguntas);
    } catch (err) {
      falha = err instanceof ErroDeJev ? { motivo: err.motivo, status: err.status } : { motivo: "respostaInvalida", status: null };
    }
    const latenciaMs = Math.round(cronometro() - inicio);
    if (resposta) gasto += resposta.usage.cost;

    const respostas = resposta ? compactarRespostas(resposta) : null;
    const registro: RegistroDoJev = {
      ...p.registroBase,
      modeloRespondeu: resposta?.modelo ?? null,
      respostas,
      comparacao: respostas ? compararComGemini(respostas, p.registroBase.gemini) : null,
      input_tokens: resposta?.usage.input_tokens ?? 0,
      output_tokens: resposta?.usage.output_tokens ?? 0,
      cost: resposta?.usage.cost ?? 0,
      latenciaMs,
      ...(falha ? { falha } : {}),
    };
    await gravar(registro, p.quando);
    const resumo = registro.comparacao
      ? Object.entries(registro.comparacao).map(([k, v]) => `${k} ${v!.concorda === null ? "—" : v!.concorda ? "=" : "≠"}`).join(", ")
      : `falhou (${falha?.motivo})`;
    log.log(`[jev] demanda observada: ${resumo} · ${latenciaMs} ms · ${contador.usados}/${deps.tetoDia} hoje`);
  }

  function enfileirar(tarefa: () => Promise<void>): void {
    fila = fila.then(tarefa).catch((err) => log.warn(`[jev] observação falhou: ${err instanceof Error ? err.message : String(err)}`));
  }

  return {
    observarDemanda(obs) {
      try {
        const quando = agora();
        const p = preparar(obs, deps, quando);
        if (p === "financas") {
          enfileirar(() => gravar({ quando: quando.toISOString(), pulada: "financas" }, quando));
          return;
        }
        enfileirar(() => processar(p));
      } catch (err) {
        log.warn(`[jev] observação descartada: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    aguardar: () => fila,
  };
}

/**
 * O boot: lê a env e devolve a sombra pronta, ou null. Só no perfil
 * operations com a agenda ligada: fora disso a env é ignorada e dita (como a
 * Luna). Config ilegível = log de erro e null (JevMalConfigurado). O log nunca
 * leva a chave.
 */
export async function prepararJevSombra(
  env: Record<string, string | undefined>,
  contexto: { dataDir: string; operations: boolean; agendaAtiva: boolean },
  opcoes: { fetch?: typeof fetch; log?: Logger } = {},
): Promise<JevSombra | null> {
  const log = opcoes.log ?? console;
  let config: ConfigDoJev;
  try {
    config = lerConfigDoJev(env);
  } catch (err: any) {
    log.error(`[jev] sombra desligada: ${err?.message ?? err}`);
    return null;
  }
  if (!config.ligada) return null;
  if (!contexto.operations || !contexto.agendaAtiva) {
    log.log("[jev] SQUADONE_JEV_SOMBRA ignorada: só no perfil operations com a agenda ligada");
    return null;
  }
  const dir = path.join(contexto.dataDir, "jev-sombra");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const gastoInicial = await somarGasto(dir);
  log.log(
    `[jev] sombra ligada: ${descreverJev(config)}, US$ ${gastoInicial.toFixed(5)} já gasto, registro em ${dir}${config.guardarDemanda ? " (com a demanda mascarada em claro)" : ""}`,
  );
  const cliente = criarClienteDoJev({ chave: config.chave, modelo: config.modelo, timeoutMs: config.timeoutMs, zdr: config.zdr, fetch: opcoes.fetch, log });
  return criarJevSombra({
    dir,
    cliente,
    modelo: config.modelo,
    tetoDia: config.tetoDia,
    tetoUsd: config.tetoUsd,
    guardarDemanda: config.guardarDemanda,
    gastoInicial,
    log,
  });
}
