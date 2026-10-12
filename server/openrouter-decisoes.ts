/**
 * Transporte do Jev (`typesafe/jev-1.13`, o "modelo de decisão" da TypeSafe
 * servido pela OpenRouter). O Jev NÃO gera texto: recebe um `state` (texto) e
 * perguntas, e devolve probabilidades. Endpoint próprio, alpha:
 * `POST https://openrouter.ai/api/alpha/decisions` (não é /chat/completions).
 *
 * Contrato conferido à mão em 11/10/2026 (valores reais):
 * - corpo `{ model, state, questions, provider }`, em que `questions` é um
 *   OBJETO indexado pelo nome da pergunta (array dá HTTP 400);
 * - `noul`: criteria `{ "true": "...", "false": "..." }` → `{ type, noul: 0..1 }`;
 * - `choice`: criteria `{ rótulo: descrição }` → `{ type, choice, probabilities, confidence }`;
 * - `score` existe (criteria em array ordenado) mas NÃO foi testado: fica fora
 *   do tipo de propósito, para nada depender dele;
 * - resposta `{ model: "<id>-AAAAMMDD", answers, usage: { input_tokens,
 *   output_tokens, cost }, id, provider }`.
 *
 * O Jev é MEDIÇÃO (ver `server/jev-sombra.ts`): nunca decide nada do turno,
 * nunca vai ao Easypanel, nunca recebe finanças (RULES 24).
 *
 * A chave (`OPENROUTER_API_KEY`) só existe no ambiente do processo do Dell.
 * NENHUMA mensagem deste módulo repete a chave, os cabeçalhos ou o corpo
 * enviado: o erro diz só o motivo classificado, o status e um trecho curto e
 * limpo do erro da OpenRouter.
 *
 * As funções do topo (pedido, validação, classificação, config) são PURAS;
 * `criarClienteDoJev` é a cola com o `fetch` injetado.
 */

export const URL_DECISOES = "https://openrouter.ai/api/alpha/decisions";
export const MODELO_JEV_PADRAO = "typesafe/jev-1.13";
/** p50 medido ~0,48 s: 5 s é folga larga, e a sombra não espera ninguém. */
export const TIMEOUT_JEV_PADRAO_MS = 5_000;
export const TETO_DIA_JEV_PADRAO = 50;
/** Custo ~US$ 0,00001–0,00003 por chamada: US$ 1 são dezenas de milhares de chamadas. */
export const TETO_USD_JEV_PADRAO = 1;

// --- Pedido ---------------------------------------------------------------------

export interface PerguntaNoul {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

export interface PerguntaChoice {
  type: "choice";
  instructions: string;
  /** Rótulo → descrição. A ordem de inserção é a ordem em que o Jev lê. */
  criteria: Record<string, string>;
}

export type PerguntaDeDecisao = PerguntaNoul | PerguntaChoice;
/** Objeto, nunca array: o endpoint responde 400 a uma lista. */
export type Perguntas = Record<string, PerguntaDeDecisao>;

export interface OpcoesDoPedido {
  /**
   * Exigir endpoint com retenção zero (ZDR). Padrão LIGADO: o
   * `typesafe/jev-1.13` está na lista ZDR da OpenRouter
   * (`/api/v1/endpoints/zdr`, conferida em 11/10/2026). ZDR é a classificação
   * DA OPENROUTER; a TypeSafe não publica prazo de retenção, e o processamento
   * é nos EUA. `false` só para teste (SQUADONE_JEV_ZDR=false).
   */
  zdr?: boolean;
}

export interface PedidoDeDecisao {
  model: string;
  state: string;
  questions: Perguntas;
  provider: { data_collection: "deny"; zdr?: true };
}

const NOME_DE_PERGUNTA = /^[a-z][a-z0-9_]{0,39}$/;

// --- Máscara -------------------------------------------------------------------

/**
 * Dígitos verificadores do CPF: um número de 11 dígitos sem pontuação é CPF
 * ([DOC]) só se fechar a conta; senão segue para a regra do telefone (o
 * celular com DDD também tem 11 dígitos).
 */
function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

/** Na ordem: o que é mais específico sai antes (URL antes de e-mail, documento antes de telefone). */
const MASCARAS: [RegExp, string | ((trecho: string) => string)][] = [
  // URL com caminho, query ou fragmento: o identificador mora aí. Host sozinho fica.
  [/\bhttps?:\/\/[^\s<>"']+/gi, (u) => (/^https?:\/\/[^\/?#]+\/?$/i.test(u) ? u : "[URL]")],
  [/\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[\/?#][^\s<>"']*/gi, "[URL]"],
  // Segredos: chaves com prefixo conhecido, Bearer, JWT, "senha: x", hex e tokens longos.
  [/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi, "[SEGREDO]"],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "[SEGREDO]"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "[SEGREDO]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[SEGREDO]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[SEGREDO]"],
  [/\b(senha|password|passwd|token|api[_-]?key|secret|segredo)(\s*[:=]\s*)\S+/gi, "$1$2[SEGREDO]"],
  [/\b[0-9a-f]{32,}\b/gi, "[SEGREDO]"],
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}\b/g, "[SEGREDO]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL]"],
  // Documentos: formatados sempre; CNPJ cru (14) sempre; CPF cru só com dígito verificador.
  [/(?<!\d)\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?!\d)/g, "[DOC]"],
  [/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g, "[DOC]"],
  [/(?<!\d)\d{14}(?!\d)/g, "[DOC]"],
  [/(?<!\d)\d{11}(?!\d)/g, (d) => (cpfValido(d) ? "[DOC]" : d)],
  // Telefone com DDD (e +55 opcional): 10 a 13 dígitos, com ou sem separadores.
  [/(?<![\w+])(?:\+?55[\s.-]?)?\(?[1-9]\d\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?!\w)/g, "[TEL]"],
  // Sem DDD: celular de 9 dígitos, ou fixo de 8 com hífen (menos "2026-2027", que é faixa de anos).
  [/(?<![\w+-])(?:9\d{4}[\s.-]?\d{4}|[2-5]\d{3}-\d{4})(?![\w-])/g, (t) => (/^(?:19|20)\d{2}-(?:19|20)\d{2}$/.test(t) ? t : "[TEL]")],
];

/**
 * PURO. Troca por rótulos fixos o que identifica alguém ou abre alguma porta,
 * ANTES de qualquer envio ao Jev: telefones BR → [TEL], e-mails → [EMAIL],
 * CPF/CNPJ → [DOC], URLs com identificador → [URL], chaves, tokens e senhas →
 * [SEGREDO]. O Jev decide pela intenção da frase; nenhum desses valores muda a
 * resposta, e todos passariam a existir num terceiro nos EUA.
 */
export function mascararParaJev(texto: string): string {
  let t = texto ?? "";
  for (const [re, troca] of MASCARAS) {
    t = typeof troca === "string" ? t.replace(re, troca) : t.replace(re, troca);
  }
  return t;
}

/**
 * PURO. Monta o corpo. `provider.data_collection: "deny"` vai SEMPRE (sem ele a
 * OpenRouter pode rotear para um provedor que treina com o prompt), e `zdr`
 * vai ligado a não ser que `opcoes.zdr === false`. O `state`, as instruções e
 * as descrições passam por `mascararParaJev` aqui, para nenhum chamador poder
 * esquecer; os rótulos (ids) não mudam. Pergunta malformada lança (erro de
 * programação, não de rede): nunca sai pedido que o schema alpha recusaria.
 */
export function montarPedido(modelo: string, state: string, perguntas: Perguntas, opcoes: OpcoesDoPedido = {}): PedidoDeDecisao {
  if (!modelo.trim()) throw new Error("modelo vazio");
  if (!state.trim()) throw new Error("state vazio");
  if (!perguntas || typeof perguntas !== "object" || Array.isArray(perguntas)) throw new Error("perguntas deve ser um objeto");
  const nomes = Object.keys(perguntas);
  if (nomes.length === 0) throw new Error("nenhuma pergunta");
  for (const nome of nomes) {
    if (!NOME_DE_PERGUNTA.test(nome)) throw new Error(`nome de pergunta inválido: ${nome.slice(0, 40)}`);
    const p = perguntas[nome];
    if (!p.instructions?.trim()) throw new Error(`pergunta ${nome} sem instructions`);
    if (p.type === "noul") {
      if (!p.criteria?.true?.trim() || !p.criteria?.false?.trim()) throw new Error(`pergunta ${nome}: noul precisa de criteria true e false`);
    } else if (p.type === "choice") {
      const rotulos = Object.keys(p.criteria ?? {});
      if (rotulos.length < 2) throw new Error(`pergunta ${nome}: choice precisa de ao menos 2 rótulos`);
      if (rotulos.some((r) => !r.trim() || !String(p.criteria[r] ?? "").trim())) throw new Error(`pergunta ${nome}: rótulo ou descrição vazia`);
    } else {
      throw new Error(`pergunta ${nome}: tipo não suportado`);
    }
  }
  const mascaradas: Perguntas = {};
  for (const [nome, p] of Object.entries(perguntas)) {
    if (p.type === "noul") {
      mascaradas[nome] = {
        type: "noul",
        instructions: mascararParaJev(p.instructions),
        criteria: { true: mascararParaJev(p.criteria.true), false: mascararParaJev(p.criteria.false) },
      };
    } else {
      const criteria: Record<string, string> = {};
      for (const [rotulo, descricao] of Object.entries(p.criteria)) criteria[rotulo] = mascararParaJev(descricao);
      mascaradas[nome] = { type: "choice", instructions: mascararParaJev(p.instructions), criteria };
    }
  }
  return {
    model: modelo,
    state: mascararParaJev(state),
    questions: mascaradas,
    provider: { data_collection: "deny", ...(opcoes.zdr === false ? {} : { zdr: true as const }) },
  };
}

// --- Resposta -------------------------------------------------------------------

export type RespostaDaPergunta =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number | null };

export interface UsoDoJev {
  input_tokens: number;
  output_tokens: number;
  /** US$. É o que o teto de gasto soma. */
  cost: number;
}

export interface RespostaDoJev {
  /** O modelo que de fato respondeu, datado (`typesafe/jev-1.13-20260917`). */
  modelo: string;
  respostas: Record<string, RespostaDaPergunta>;
  usage: UsoDoJev;
  id: string | null;
  provedor: string | null;
}

const MODELO_DATADO = /^[A-Za-z0-9._\/:-]+-\d{8}$/;

function probabilidade(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

function naoNegativo(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * PURO. A resposta é DADO: só passa o que bate com as perguntas ENVIADAS.
 * Toda pergunta precisa de resposta do mesmo tipo; `choice` precisa ser um dos
 * rótulos mandados e cada probabilidade (e o `noul`) entre 0 e 1; `usage.cost`
 * numérico (o teto de gasto depende dele); `model` datado. Qualquer desvio é
 * `ErroDeJev("respostaInvalida")`, cuja mensagem nunca repete o corpo.
 */
export function validarResposta(json: unknown, perguntas: Perguntas): RespostaDoJev {
  const invalida = (porque: string) => new ErroDeJev("respostaInvalida", 200, porque);
  if (!json || typeof json !== "object" || Array.isArray(json)) throw invalida("corpo não é objeto");
  const j = json as Record<string, unknown>;
  if (typeof j.model !== "string" || !MODELO_DATADO.test(j.model)) throw invalida("model ausente ou sem data");
  const u = j.usage as Record<string, unknown> | undefined;
  if (!u || typeof u !== "object") throw invalida("sem usage");
  if (!naoNegativo(u.cost)) throw invalida("usage.cost não numérico");
  for (const campo of ["input_tokens", "output_tokens"] as const) {
    if (u[campo] !== undefined && !naoNegativo(u[campo])) throw invalida(`usage.${campo} não numérico`);
  }
  const answers = j.answers as Record<string, unknown> | undefined;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw invalida("sem answers");

  const respostas: Record<string, RespostaDaPergunta> = {};
  for (const [nome, pergunta] of Object.entries(perguntas)) {
    const a = answers[nome] as Record<string, unknown> | undefined;
    if (!a || typeof a !== "object") throw invalida(`sem resposta para ${nome}`);
    if (a.type !== pergunta.type) throw invalida(`${nome}: tipo diferente do pedido`);
    if (pergunta.type === "noul") {
      if (!probabilidade(a.noul)) throw invalida(`${nome}: noul fora de 0..1`);
      respostas[nome] = { type: "noul", noul: a.noul };
      continue;
    }
    const rotulos = new Set(Object.keys(pergunta.criteria));
    if (typeof a.choice !== "string" || !rotulos.has(a.choice)) throw invalida(`${nome}: escolha fora dos rótulos enviados`);
    const probs = a.probabilities as Record<string, unknown> | undefined;
    if (!probs || typeof probs !== "object" || Array.isArray(probs)) throw invalida(`${nome}: sem probabilities`);
    const limpas: Record<string, number> = {};
    for (const [rotulo, p] of Object.entries(probs)) {
      if (!rotulos.has(rotulo)) throw invalida(`${nome}: probabilidade de rótulo não enviado`);
      if (!probabilidade(p)) throw invalida(`${nome}: probabilidade fora de 0..1`);
      limpas[rotulo] = p;
    }
    if (a.confidence !== undefined && a.confidence !== null && !probabilidade(a.confidence)) throw invalida(`${nome}: confidence fora de 0..1`);
    respostas[nome] = { type: "choice", choice: a.choice, probabilities: limpas, confidence: probabilidade(a.confidence) ? a.confidence : null };
  }
  return {
    modelo: j.model,
    respostas,
    usage: { input_tokens: (u.input_tokens as number) ?? 0, output_tokens: (u.output_tokens as number) ?? 0, cost: u.cost },
    id: typeof j.id === "string" ? j.id : null,
    provedor: typeof j.provider === "string" ? j.provider : null,
  };
}

// --- Erros ----------------------------------------------------------------------

export type MotivoDoErroDeJev =
  /** 401/403: chave errada, revogada ou sem permissão. Desliga até reiniciar. */
  | "credencial"
  /** 402: sem saldo na OpenRouter. Desliga até reiniciar. */
  | "semCredito"
  /** 400/413 e outros 4xx: contrato (schema alpha) ou corpo grande demais. */
  | "pedidoInvalido"
  /** 429. Sem retry: a sombra perde a medição e segue. */
  | "limite"
  /** 5xx, 524, 529, timeout ou rede. */
  | "indisponivel"
  /** 200 com corpo fora do contrato. */
  | "respostaInvalida";

export class ErroDeJev extends Error {
  readonly motivo: MotivoDoErroDeJev;
  /** Status HTTP; null quando nem houve resposta (rede, timeout). */
  readonly status: number | null;
  constructor(motivo: MotivoDoErroDeJev, status: number | null, detalhe: string) {
    super(`Jev ${motivo}${status !== null ? ` (HTTP ${status})` : ""}: ${detalhe}`);
    this.name = "ErroDeJev";
    this.motivo = motivo;
    this.status = status;
  }

  /** Credencial e saldo não se consertam sozinhos: insistir só acumularia erro no log. */
  get desliga(): boolean {
    return this.motivo === "credencial" || this.motivo === "semCredito";
  }
}

/** Tira do texto qualquer coisa com cara de segredo. A chave conhecida sai à parte, em `limpar`. */
function semSegredos(texto: string): string {
  return mascararParaJev(texto.replace(/bearer\s+\S+/gi, "[SEGREDO]"))
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 160);
}

/** A chave conhecida, ou qualquer pedaço de 12 caracteres dela, aparece no texto? */
function vazaChave(texto: string, chave: string): boolean {
  if (!chave) return false;
  if (texto.includes(chave)) return true;
  for (let i = 0; i + 12 <= chave.length; i++) if (texto.includes(chave.slice(i, i + 12))) return true;
  return false;
}

function mensagemDoCorpo(corpo: unknown): string {
  if (typeof corpo === "string") return corpo;
  if (corpo && typeof corpo === "object") {
    const e = (corpo as { error?: unknown }).error;
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const m = (e as { message?: unknown }).message;
      if (typeof m === "string") return m;
    }
  }
  return "";
}

/**
 * PURO. Status HTTP (null = sem resposta) → motivo. O detalhe é um trecho
 * curto da mensagem de erro da OpenRouter, sem nada com cara de chave.
 */
export function classificarErro(status: number | null, corpo: unknown): ErroDeJev {
  const msg = semSegredos(mensagemDoCorpo(corpo));
  let motivo: MotivoDoErroDeJev;
  if (status === null) motivo = "indisponivel";
  else if (status === 401 || status === 403) motivo = "credencial";
  else if (status === 402) motivo = "semCredito";
  else if (status === 429) motivo = "limite";
  else if (status >= 500 || status === 408) motivo = "indisponivel";
  else if (status >= 400) motivo = "pedidoInvalido";
  else motivo = "respostaInvalida";
  return new ErroDeJev(motivo, status, msg || "sem mensagem");
}

// --- Configuração ---------------------------------------------------------------

/** Env presente e ilegível. Ambiente: log de erro no boot e sombra desligada, como o TelegramMalConfigurado. */
export class JevMalConfigurado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "JevMalConfigurado";
  }
}

export interface ConfigDoJev {
  ligada: boolean;
  /** Vazia quando desligada. NUNCA vai a log, erro ou registro. */
  chave: string;
  modelo: string;
  tetoDia: number;
  tetoUsd: number;
  timeoutMs: number;
  guardarDemanda: boolean;
  /** Padrão true; só `SQUADONE_JEV_ZDR=false` desliga (teste). */
  zdr: boolean;
}

const FORMATO_MODELO = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
/** Formato sem fixar o prefixo: a OpenRouter já mudou o dela. Sem espaço, sem aspas. */
const FORMATO_CHAVE = /^[A-Za-z0-9_-]{20,200}$/;

function inteiro(nome: string, bruto: string | undefined, padrao: number, min: number, max: number): number {
  const t = (bruto ?? "").trim();
  if (!t) return padrao;
  if (!/^\d+$/.test(t) || Number(t) < min || Number(t) > max) {
    throw new JevMalConfigurado(`${nome}='${t.slice(0, 20)}' não é um inteiro entre ${min} e ${max}.`);
  }
  return Number(t);
}

/**
 * `SQUADONE_JEV_SOMBRA=true` liga; ausente = desligada. Ligada exige
 * `OPENROUTER_API_KEY`; os outros têm padrão. Valor presente e ilegível lança
 * `JevMalConfigurado` (mesmo desligada: o erro aparece antes de alguém ligar).
 * As mensagens nunca repetem a chave.
 */
export function lerConfigDoJev(env: Record<string, string | undefined>): ConfigDoJev {
  const ligada = (env.SQUADONE_JEV_SOMBRA ?? "").trim() === "true";
  const modelo = (env.SQUADONE_JEV_MODELO ?? "").trim() || MODELO_JEV_PADRAO;
  if (!FORMATO_MODELO.test(modelo)) throw new JevMalConfigurado("SQUADONE_JEV_MODELO fora do formato <provedor>/<modelo>.");
  const tetoDia = inteiro("SQUADONE_JEV_TETO_DIA", env.SQUADONE_JEV_TETO_DIA, TETO_DIA_JEV_PADRAO, 1, 10_000);
  const timeoutMs = inteiro("SQUADONE_JEV_TIMEOUT_MS", env.SQUADONE_JEV_TIMEOUT_MS, TIMEOUT_JEV_PADRAO_MS, 500, 60_000);
  const usdBruto = (env.SQUADONE_JEV_TETO_USD ?? "").trim();
  let tetoUsd = TETO_USD_JEV_PADRAO;
  if (usdBruto) {
    if (!/^\d+(\.\d+)?$/.test(usdBruto) || Number(usdBruto) <= 0 || Number(usdBruto) > 100) {
      throw new JevMalConfigurado(`SQUADONE_JEV_TETO_USD='${usdBruto.slice(0, 20)}' não é um valor em dólares maior que 0 e até 100 (ponto decimal).`);
    }
    tetoUsd = Number(usdBruto);
  }
  const zdrBruto = (env.SQUADONE_JEV_ZDR ?? "").trim();
  if (zdrBruto && zdrBruto !== "true" && zdrBruto !== "false") {
    throw new JevMalConfigurado("SQUADONE_JEV_ZDR aceita só 'true' ou 'false' (ausente = true).");
  }
  let chave = "";
  if (ligada) {
    chave = (env.OPENROUTER_API_KEY ?? "").trim();
    if (!chave) throw new JevMalConfigurado("OPENROUTER_API_KEY ausente com SQUADONE_JEV_SOMBRA=true (fica em ~/.config/squadone/jev.env).");
    if (!FORMATO_CHAVE.test(chave)) throw new JevMalConfigurado("OPENROUTER_API_KEY fora do formato esperado (só letras, dígitos, '_' e '-').");
  }
  return {
    ligada,
    chave,
    modelo,
    tetoDia,
    tetoUsd,
    timeoutMs,
    guardarDemanda: (env.SQUADONE_JEV_GUARDAR_DEMANDA ?? "").trim() === "true",
    zdr: zdrBruto !== "false",
  };
}

/** Para o log do boot: nunca a chave. */
export function descreverJev(c: ConfigDoJev): string {
  return `${c.modelo}, teto ${c.tetoDia}/dia e US$ ${c.tetoUsd} no total, timeout ${c.timeoutMs} ms, ${c.zdr ? "ZDR exigido" : "SEM ZDR (teste)"}`;
}

// --- A chamada ------------------------------------------------------------------

export interface Logger {
  log(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

export interface DepsDoClienteDoJev {
  chave: string;
  modelo: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  log?: Logger;
  url?: string;
  /** Padrão true (ver `OpcoesDoPedido.zdr`). */
  zdr?: boolean;
}

export interface ClienteDoJev {
  /** Uma chamada, sem retry. Lança `ErroDeJev` (nunca outro tipo). */
  decidir(state: string, perguntas: Perguntas): Promise<RespostaDoJev>;
  /** Motivo do desligamento (credencial, semCredito) ou null. Vale até reiniciar o processo. */
  desligado(): MotivoDoErroDeJev | null;
}

export function criarClienteDoJev(deps: DepsDoClienteDoJev): ClienteDoJev {
  const fetchFn = deps.fetch ?? fetch;
  const log = deps.log ?? console;
  const url = deps.url ?? URL_DECISOES;
  let desligadoPor: MotivoDoErroDeJev | null = null;

  /** Rede de segurança: a chave conhecida nunca sai, nem se a OpenRouter a ecoar. */
  const limpar = (e: ErroDeJev): ErroDeJev =>
    vazaChave(e.message, deps.chave) ? new ErroDeJev(e.motivo, e.status, "detalhe omitido") : e;

  function desligar(e: ErroDeJev): void {
    if (desligadoPor) return;
    desligadoPor = e.motivo;
    log.error(`[jev] desligado até reiniciar o processo: ${e.motivo}${e.status !== null ? ` (HTTP ${e.status})` : ""}`);
  }

  async function decidir(state: string, perguntas: Perguntas): Promise<RespostaDoJev> {
    if (desligadoPor) throw new ErroDeJev(desligadoPor, null, "desligado até reiniciar o processo");
    const corpo = JSON.stringify(montarPedido(deps.modelo, state, perguntas, { zdr: deps.zdr }));
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), deps.timeoutMs);
    try {
      let resposta: Response;
      try {
        resposta = await fetchFn(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${deps.chave}`, "Content-Type": "application/json" },
          body: corpo,
          signal: controle.signal,
        });
      } catch {
        // Nunca o err.message cru: em alguns runtimes ele traz a URL ou a causa com cabeçalhos.
        throw new ErroDeJev("indisponivel", null, controle.signal.aborted ? `timeout de ${deps.timeoutMs} ms` : "falha de rede");
      }
      let texto: string;
      try {
        texto = await resposta.text();
      } catch {
        throw new ErroDeJev("indisponivel", resposta.status, controle.signal.aborted ? `timeout de ${deps.timeoutMs} ms lendo a resposta` : "corpo interrompido");
      }
      let json: unknown = null;
      try {
        json = texto ? JSON.parse(texto) : null;
      } catch {
        json = null;
      }
      if (!resposta.ok) {
        const e = limpar(classificarErro(resposta.status, json ?? texto));
        if (e.desliga) desligar(e);
        throw e;
      }
      if (json === null) throw new ErroDeJev("respostaInvalida", resposta.status, "corpo não é JSON");
      return validarResposta(json, perguntas);
    } catch (err) {
      if (err instanceof ErroDeJev) throw limpar(err);
      throw new ErroDeJev("respostaInvalida", null, "erro inesperado no transporte");
    } finally {
      clearTimeout(relogio);
    }
  }

  return { decidir, desligado: () => desligadoPor };
}
