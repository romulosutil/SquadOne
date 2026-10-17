import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FunctionCallingConfigMode, type Content, type FunctionCall, type GenerateContentParameters, type GoogleGenAI, type Part } from "@google/genai";
import {
  acharLead,
  fontesDaResposta,
  historicoParaOPrompt,
  ID_DE_LEAD,
  lerCartaoProposto,
  MAX_TEXTO_DA_MENSAGEM,
  mesesParaPodar,
  NOMES_DAS_PROPOSTAS,
  prepararTexto,
  promptDoRoteador,
  rotearLocal,
  semValores,
  type LeadDoContexto,
} from "../src/operations/assistente.ts";
import type {
  CartaoDoAssistente,
  CerebroDaResposta,
  ContextoDaPagina,
  ConversaDoAssistente,
  EstadoDoAssistente,
  EtapaPendente,
  MensagemDoAssistente,
  PedidoDeMensagem,
  RecebidoDoAssistente,
} from "../src/operations/assistente-contrato.ts";
import { passoAtual, passoDaJornada } from "../src/operations/jornada.ts";
import type { CrmProduto } from "../src/operations/types.ts";
import { CONSULTAR_HERMES, consultarOHermes, declaracoesDoAssistente, LEITURAS, LeiturasDaMensagem, type FontesDoAssistente, type ResultadoDoHermes } from "./assistente-ferramentas.ts";
import { TETO_DIA_DO_HERMES, type ConsultaAoHermes } from "./hermes-consulta.ts";
import { FUSO } from "./alocador.ts";
import { arquivoDoMes, diaLocal, type Logger } from "./luna-sombra.ts";
import { gerarComRetry, MODEL, ModeloOcupado } from "./orchestrator.ts";

/**
 * O Assistente da Central (RULES 28), a cola: a fila de uma geração por vez, a conversa em
 * memória com o JSONL 600 do mês, os tetos do dia e o laço do Gemini com as ferramentas de
 * server/assistente-ferramentas.ts. As regras (o que nem vai ao modelo, a máscara, o prompt, o que
 * um cartão pode ser) são PURAS, em src/operations/assistente.ts.
 *
 * Propõe, nunca faz: o modelo só lê e propõe cartões; quem escreve é o toque do Rômulo pela rota
 * de sempre (/api/orquestrar, /api/operations/crm/registro). Este módulo não importa o CrmStore
 * nem as capacidades do turno (o teste confere). Desligado por padrão (`SQUADONE_ASSISTENTE=true`
 * liga), só no perfil operations: nunca no Easypanel.
 */

// --- Configuração -----------------------------------------------------------------

export class AssistenteMalConfigurado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "AssistenteMalConfigurado";
  }
}

export const TETO_DIA_DO_ASSISTENTE = 60;
// O padrão do teto do Hermes é o do módulo dele (que conta as consultas no arquivo do dia): um número só.
export { TETO_DIA_DO_HERMES };
/** Gerações por mensagem: a 3ª já sai sem ferramentas, para sempre haver texto. */
export const MAX_RODADAS = 3;
const MAX_CARTOES_POR_RESPOSTA = 3;
const MAX_TEXTO_DA_RESPOSTA = 4000;
const MAX_MOTIVO_DA_AVALIACAO = 300;
const MAX_PAGINA = 120;

export interface ConfigDoAssistente {
  ligado: boolean;
  /** A consulta ao Hermes (SQUADONE_ASSISTENTE_HERMES=true). */
  hermes: boolean;
  tetoDia: number;
  /** Repassado a quem monta a consulta ao Hermes: o teto é aplicado por lá. */
  hermesTetoDia: number;
}

function lerTeto(env: NodeJS.ProcessEnv, nome: string, padrao: number): number {
  const bruto = (env[nome] ?? "").trim();
  if (!bruto) return padrao;
  if (!/^\d+$/.test(bruto) || Number(bruto) <= 0) throw new AssistenteMalConfigurado(`${nome}='${bruto}' não é um inteiro maior que zero.`);
  return Number(bruto);
}

/** Valor ilegível lança: melhor dizer no boot que cair calado no padrão. */
export function lerConfigDoAssistente(env: NodeJS.ProcessEnv = process.env): ConfigDoAssistente {
  return {
    ligado: (env.SQUADONE_ASSISTENTE ?? "").trim() === "true",
    hermes: (env.SQUADONE_ASSISTENTE_HERMES ?? "").trim() === "true",
    tetoDia: lerTeto(env, "SQUADONE_ASSISTENTE_TETO_DIA", TETO_DIA_DO_ASSISTENTE),
    hermesTetoDia: lerTeto(env, "SQUADONE_ASSISTENTE_HERMES_TETO_DIA", TETO_DIA_DO_HERMES),
  };
}

// --- Erros classificados (a rota decide o status pelo tipo) -------------------------

export class PedidoDoAssistenteInvalido extends Error {
  /** A conversa já tem resposta em preparo: a rota diz `pendente: true` junto do 400. */
  readonly pendente: boolean;
  constructor(mensagem: string, opcoes: { pendente?: boolean } = {}) {
    super(mensagem);
    this.name = "PedidoDoAssistenteInvalido";
    this.pendente = opcoes.pendente === true;
  }
}

export class TetoDoAssistente extends Error {
  constructor(readonly teto: number) {
    super(`O Assistente já respondeu ${teto} mensagens hoje (teto do dia). Volta amanhã.`);
    this.name = "TetoDoAssistente";
  }
}

// --- O corpo do pedido -----------------------------------------------------------

const PRODUTOS: readonly CrmProduto[] = ["site", "prumo", "iris", "estampa", "plus"];
const ID_DA_CONVERSA = /^[A-Za-z0-9-]{8,64}$/;
const CONTROLE = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** Valida o corpo do POST /assistente/mensagens. O lead é só produto + id: o resto sai da visão do CRM. */
export function lerPedidoDeMensagem(corpo: unknown): PedidoDeMensagem {
  const c = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  const texto = typeof c.texto === "string" ? c.texto.replace(/\r\n?/g, "\n").trim() : "";
  if (!texto) throw new PedidoDoAssistenteInvalido("Escreva a mensagem.");
  if (texto.length > MAX_TEXTO_DA_MENSAGEM) throw new PedidoDoAssistenteInvalido(`A mensagem passa de ${MAX_TEXTO_DA_MENSAGEM} caracteres.`);
  if (c.conversaId !== undefined && c.conversaId !== null && (typeof c.conversaId !== "string" || !ID_DA_CONVERSA.test(c.conversaId))) {
    throw new PedidoDoAssistenteInvalido("Conversa inválida.");
  }
  const ctx = (c.contexto && typeof c.contexto === "object" ? c.contexto : null) as Record<string, unknown> | null;
  if (!ctx || typeof ctx.pagina !== "string" || ctx.pagina.length > MAX_PAGINA || CONTROLE.test(ctx.pagina)) {
    throw new PedidoDoAssistenteInvalido("Diga a página de onde vem a mensagem.");
  }
  const contexto: ContextoDaPagina = { pagina: ctx.pagina.trim() };
  if (ctx.lead !== undefined && ctx.lead !== null) {
    const l = (typeof ctx.lead === "object" ? ctx.lead : {}) as Record<string, unknown>;
    const produto = typeof l.produto === "string" ? l.produto : "";
    const id = typeof l.id === "string" ? l.id.trim() : "";
    if (!PRODUTOS.includes(produto as CrmProduto) || !ID_DE_LEAD.test(id)) throw new PedidoDoAssistenteInvalido("Lead inválido.");
    contexto.lead = { produto, id };
  }
  return { ...(typeof c.conversaId === "string" ? { conversaId: c.conversaId } : {}), texto, contexto };
}

// --- O registro (JSONL 600) ---------------------------------------------------------

export type LinhaDoAssistente =
  | { tipo: "mensagem"; quando: string; conversaId: string; mensagem: MensagemDoAssistente; /** Contou no teto do dia. */ conta?: true }
  | { tipo: "avaliacao"; quando: string; conversaId: string; respostaId: string; nota: 1 | -1; motivo?: string }
  | { tipo: "cartao"; quando: string; conversaId: string; cartaoId: string; desfecho: "confirmado" | "descartado" };

async function lerLinhas(arquivo: string): Promise<LinhaDoAssistente[]> {
  let texto: string;
  try {
    texto = await fs.readFile(arquivo, "utf8");
  } catch {
    return [];
  }
  const saida: LinhaDoAssistente[] = [];
  for (const linha of texto.split("\n")) {
    if (!linha.trim()) continue;
    try {
      const r = JSON.parse(linha) as LinhaDoAssistente;
      if (!r || typeof r.quando !== "string" || typeof r.conversaId !== "string") continue;
      if (r.tipo === "mensagem" && r.mensagem && typeof r.mensagem.id === "string" && typeof r.mensagem.texto === "string") saida.push(r);
      else if (r.tipo === "cartao" || r.tipo === "avaliacao") saida.push(r);
    } catch {
      // linha torta não conta: o histórico é medição, não fonte da verdade
    }
  }
  return saida;
}

// --- O Gemini ----------------------------------------------------------------------

/** O pedaço da resposta do SDK que o laço usa; o dublê dos testes devolve só isto. */
export interface RespostaDoGemini {
  functionCalls?: FunctionCall[];
  text?: string;
  candidates?: Array<{ content?: Content }>;
}

export type GerarNoGemini = (params: GenerateContentParameters) => Promise<RespostaDoGemini>;

/** O texto da resposta, sem os pensamentos e sem o aviso do SDK quando também há functionCall. */
function textoDaResposta(r: RespostaDoGemini): string {
  const partes = r.candidates?.[0]?.content?.parts;
  if (partes) return partes.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  return r.text ?? "";
}

/**
 * A vez do modelo, para a próxima rodada. O conteúdo do candidato vai como veio: o Gemini 3 exige de
 * volta a assinatura do pensamento junto de cada functionCall, e remontar as partes a perderia.
 */
function vezDoModelo(r: RespostaDoGemini, chamadas: FunctionCall[]): Content {
  return r.candidates?.[0]?.content ?? { role: "model", parts: chamadas.map((functionCall) => ({ functionCall })) };
}

function agoraLegivel(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(d);
}

const TEXTO_DO_HERMES_FORA = "O Hermes não respondeu; isto é só o que li.";
const TEXTO_SEM_CRM = "Não li Vendas agora: o que depende de lá ficou de fora.";
const TEXTO_OCUPADO = "O Gemini está ocupado agora. Tente de novo em alguns segundos.";
const TEXTO_OUTRO = "Não consegui responder agora. Tente de novo daqui a pouco.";

function textoDoHermesFora(motivo: Exclude<ResultadoDoHermes, { ok: true }>["motivo"]): string {
  if (motivo === "teto") return "O Hermes já atendeu o teto de hoje; isto é só o que li.";
  if (motivo === "financas") return "Finanças não vão ao Hermes; isto é só o que li.";
  return TEXTO_DO_HERMES_FORA;
}

// --- A cola ------------------------------------------------------------------------

interface Conversa {
  id: string;
  mensagens: MensagemDoAssistente[];
  pendente: ConversaDoAssistente["pendente"];
}

export interface DepsDoAssistente {
  /** `<SQUADONE_OPERATIONS_DATA_DIR>/assistente`: os JSONL do mês. */
  dir: string;
  tetoDia: number;
  gerar: GerarNoGemini;
  fontes: FontesDoAssistente;
  /** A consulta ao Hermes (server/hermes-consulta.ts), por injeção; null = desligada. */
  hermes?: ConsultaAoHermes | null;
  agora?: () => Date;
  log?: Logger;
  novoId?: () => string;
}

export interface Assistente {
  estado(): Promise<EstadoDoAssistente>;
  /** Guarda a mensagem e põe a resposta na fila (ou responde na hora, por regra). Lança TetoDoAssistente e PedidoDoAssistenteInvalido. */
  receber(pedido: PedidoDeMensagem): Promise<RecebidoDoAssistente>;
  /** A conversa a partir da mensagem `desde` (exclusive); null = não existe. */
  conversa(id: string, desde?: number): ConversaDoAssistente | null;
  /** false = resposta não encontrada. */
  avaliar(respostaId: string, nota: 1 | -1, motivo?: string): Promise<boolean>;
  /** Só mede: quem escreve é a rota de sempre, chamada pelo painel depois do toque. */
  decidirCartao(cartaoId: string, desfecho: "confirmado" | "descartado"): Promise<"ok" | "naoAchou" | "jaDecidido">;
  /** Há resposta em preparo ou na fila (o atualizar-central espera). */
  ocupado(): boolean;
  /** Espera a fila esvaziar. */
  ocioso(): Promise<void>;
}

export async function criarAssistente(deps: DepsDoAssistente): Promise<Assistente> {
  const log = deps.log ?? console;
  const agora = deps.agora ?? (() => new Date());
  const novoId = deps.novoId ?? (() => randomUUID());
  const hermes = deps.hermes ?? null;

  const conversas = new Map<string, Conversa>();
  /** respostaId -> conversa (para a avaliação) e cartaoId -> cartão. */
  const respostas = new Map<string, Conversa>();
  const cartoes = new Map<string, { conversa: Conversa; cartao: CartaoDoAssistente }>();
  /** dia (AAAA-MM-DD em SP) -> mensagens que foram ao modelo: o teto sobrevive a reinício. */
  const usados = new Map<string, number>();

  const indexar = (c: Conversa, m: MensagemDoAssistente) => {
    if (m.autor === "assistente") respostas.set(m.id, c);
    for (const cartao of m.cartoes ?? []) cartoes.set(cartao.id, { conversa: c, cartao });
  };

  // Subir: poda de 90 dias e releitura das conversas que sobraram (a Central reinicia a cada
  // atualização, atualizar-central.timer, e a conversa não pode sumir no meio).
  await fs.mkdir(deps.dir, { recursive: true, mode: 0o700 });
  const nomes = (await fs.readdir(deps.dir)).filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort();
  const podar = new Set(mesesParaPodar(nomes, agora()));
  for (const nome of podar) {
    await fs.rm(path.join(deps.dir, nome), { force: true });
    log.log(`[assistente] histórico de ${nome.slice(0, 7)} podado (mais de 90 dias)`);
  }
  for (const nome of nomes.filter((n) => !podar.has(n))) {
    for (const linha of await lerLinhas(path.join(deps.dir, nome))) {
      if (linha.tipo === "mensagem") {
        let c = conversas.get(linha.conversaId);
        if (!c) conversas.set(linha.conversaId, (c = { id: linha.conversaId, mensagens: [], pendente: null }));
        const m = { ...linha.mensagem, fontes: linha.mensagem.fontes ?? [], cartoes: linha.mensagem.cartoes ?? [] };
        c.mensagens.push(m);
        indexar(c, m);
        if (linha.conta) {
          const dia = diaLocal(new Date(linha.quando));
          usados.set(dia, (usados.get(dia) ?? 0) + 1);
        }
      } else if (linha.tipo === "cartao") {
        const achado = cartoes.get(linha.cartaoId);
        if (achado) achado.cartao.estado = linha.desfecho;
      }
    }
  }

  async function gravar(linha: LinhaDoAssistente): Promise<void> {
    try {
      await fs.mkdir(deps.dir, { recursive: true, mode: 0o700 });
      const arquivo = await fs.open(arquivoDoMes(deps.dir, new Date(linha.quando)), "a", 0o600);
      try {
        await arquivo.writeFile(`${JSON.stringify(linha)}\n`, "utf8");
      } finally {
        await arquivo.close();
      }
    } catch (error) {
      // O histórico é medição: sem disco a conversa segue em memória, e o log diz.
      log.error(`[assistente] não gravou o histórico: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function adicionar(c: Conversa, m: Omit<MensagemDoAssistente, "n">, conta = false): Promise<MensagemDoAssistente> {
    const mensagem: MensagemDoAssistente = { ...m, n: c.mensagens.length + 1 };
    c.mensagens.push(mensagem);
    indexar(c, mensagem);
    await gravar({ tipo: "mensagem", quando: mensagem.quando, conversaId: c.id, mensagem, ...(conta ? { conta: true as const } : {}) });
    return mensagem;
  }

  const nova = (): Conversa => {
    const c: Conversa = { id: novoId(), mensagens: [], pendente: null };
    conversas.set(c.id, c);
    return c;
  };

  // Uma geração por vez na Central: o Gemini é o mesmo do turno, e duas abas juntas não podem
  // virar duas chamadas em paralelo competindo com o Pedir e o Telegram.
  let fila: Promise<void> = Promise.resolve();
  let naFila = 0;
  function enfileirar(trabalho: () => Promise<void>) {
    naFila++;
    fila = fila.then(trabalho).catch((error) => {
      log.error(`[assistente] resposta perdida: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => { naFila--; });
  }

  /** Uma resposta inteira: o laço do Gemini com as ferramentas, no máximo MAX_RODADAS gerações. */
  async function gerarResposta(
    c: Conversa, anteriores: MensagemDoAssistente[], textoDoRomulo: string, contexto: ContextoDaPagina, respostaId: string,
  ): Promise<Omit<MensagemDoAssistente, "n">> {
    const etapa = (e: EtapaPendente) => {
      if (c.pendente?.respostaId === respostaId) c.pendente = { ...c.pendente, etapa: e };
    };
    const leituras = new LeiturasDaMensagem(deps.fontes, agora, log);
    const propostos: CartaoDoAssistente[] = [];
    let hermesTexto: string | null = null;
    let hermesFora: Exclude<ResultadoDoHermes, { ok: true }>["motivo"] | null = null;
    let cerebro: CerebroDaResposta = "gemini";
    let texto = "";
    const resposta = (campos: Partial<MensagemDoAssistente>): Omit<MensagemDoAssistente, "n"> => ({
      id: respostaId, autor: "assistente", texto: "", quando: agora().toISOString(), fontes: [], cartoes: [], ...campos,
    });

    try {
      // O lead da Ficha sai da visão do CRM, nunca do navegador. O painel manda o id inteiro
      // (`?lead=site:…`); a chave sozinha também acha.
      let lead: LeadDoContexto | null = null;
      if (contexto.lead) {
        const v = await leituras.visao();
        const l = v ? acharLead(v.leads, contexto.lead.produto, contexto.lead.id) : undefined;
        if (l) lead = { produto: l.produto, id: l.id, empresa: l.empresa, etapa: l.subEtapa || l.etapa, passo: passoDaJornada(passoAtual(l)).nome };
      }
      const systemInstruction = promptDoRoteador({ pagina: contexto.pagina, lead, agoraLocal: agoraLegivel(agora()), hermes: hermes !== null });
      const contents: Content[] = [...historicoParaOPrompt(anteriores), { role: "user", parts: [{ text: textoDoRomulo }] }];
      const functionDeclarations = declaracoesDoAssistente({ hermes: hermes !== null });

      for (let rodada = 1; rodada <= MAX_RODADAS; rodada++) {
        etapa("pensando");
        const ultima = rodada === MAX_RODADAS;
        const r = await deps.gerar({
          model: MODEL,
          contents,
          config: {
            systemInstruction,
            temperature: 0.3,
            tools: [{ functionDeclarations }],
            // AUTO: conversa comum não chama ferramenta nenhuma. A última rodada sai sem ferramentas,
            // para a resposta sempre terminar em texto.
            toolConfig: { functionCallingConfig: { mode: ultima ? FunctionCallingConfigMode.NONE : FunctionCallingConfigMode.AUTO } },
          },
        });
        texto = textoDaResposta(r);
        const chamadas = ultima ? [] : (r.functionCalls ?? []);
        if (!chamadas.length) break;
        contents.push(vezDoModelo(r, chamadas));

        // As leituras e propostas rodam primeiro; o Hermes por último, para o pacote dele levar o que
        // esta rodada leu.
        const partes: Part[] = new Array(chamadas.length);
        const ordem = chamadas.map((ch, i) => ({ ch, i })).sort((a, b) => Number(a.ch.name === CONSULTAR_HERMES) - Number(b.ch.name === CONSULTAR_HERMES));
        for (const { ch, i } of ordem) {
          const nome = ch.name ?? "";
          const args = (ch.args ?? {}) as Record<string, unknown>;
          let saida: Record<string, unknown>;
          if ((NOMES_DAS_PROPOSTAS as readonly string[]).includes(nome)) {
            const visao = nome === "propor_pedido_ao_time" ? null : await leituras.visao();
            const lido = lerCartaoProposto(nome, args, visao, novoId());
            if (lido.ok === false) saida = { recusado: lido.motivo };
            else if (propostos.length >= MAX_CARTOES_POR_RESPOSTA) saida = { recusado: `no máximo ${MAX_CARTOES_POR_RESPOSTA} cartões por resposta` };
            else {
              propostos.push(lido.cartao);
              saida = { proposto: true, aviso: "Cartão criado para o Rômulo conferir; nada foi feito. Diga que deixou o cartão, nunca que fez." };
            }
          } else if (nome === CONSULTAR_HERMES && hermes) {
            if (hermesTexto !== null || hermesFora !== null) saida = { erro: "Uma consulta ao Hermes por mensagem." };
            else {
              etapa("hermes");
              const h = await consultarOHermes(hermes, args.pergunta, leituras);
              if (h.ok === true) {
                hermesTexto = h.texto;
                leituras.feitas.push({ tipo: "hermes", ms: h.ms });
                saida = { entregue: true };
              } else {
                hermesFora = h.motivo;
                log.warn(`[assistente] Hermes fora: ${h.motivo}`);
                saida = { erro: "O Hermes não respondeu. Responda só com o que você já leu." };
              }
            }
          } else if ((LEITURAS as readonly string[]).includes(nome)) {
            etapa("lendo");
            saida = await leituras.executar(nome, args);
          } else {
            saida = { erro: "Ferramenta desconhecida." };
          }
          partes[i] = { functionResponse: { ...(ch.id ? { id: ch.id } : {}), name: nome, response: saida } };
        }
        contents.push({ role: "user", parts: partes });
        // O texto do Hermes é dado (exceção da RULES 20): volta ao Rômulo como texto e nunca passa
        // pelo Gemini, que poderia transformá-lo em cartão ou em outra chamada.
        if (hermesTexto !== null) break;
      }
    } catch (error) {
      if (error instanceof ModeloOcupado) {
        log.warn("[assistente] Gemini ocupado");
        return resposta({ texto: TEXTO_OCUPADO, falha: { tipo: "modeloOcupado", texto: TEXTO_OCUPADO } });
      }
      log.error(`[assistente] erro: ${error instanceof Error ? error.message : String(error)}`);
      return resposta({ texto: TEXTO_OUTRO, falha: { tipo: "outro", texto: TEXTO_OUTRO } });
    }

    let corpo = semValores(prepararTexto(texto)).trim();
    if (hermesTexto !== null) {
      cerebro = "hermes";
      corpo = [corpo, hermesTexto].filter(Boolean).join("\n\n");
    }
    let falha: MensagemDoAssistente["falha"];
    if (hermesFora !== null) {
      const aviso = textoDoHermesFora(hermesFora);
      falha = { tipo: "hermes", texto: aviso };
      corpo = [aviso, corpo].filter(Boolean).join("\n\n");
    } else if (leituras.crmSemSinal) {
      falha = { tipo: "semCrm", texto: TEXTO_SEM_CRM };
    }
    if (!corpo) corpo = propostos.length ? "Deixei um cartão para você conferir." : "Não tenho o que dizer sobre isso agora.";
    if (corpo.length > MAX_TEXTO_DA_RESPOSTA) corpo = `${corpo.slice(0, MAX_TEXTO_DA_RESPOSTA - 1)}…`;
    return resposta({ texto: corpo, cerebro, fontes: fontesDaResposta(leituras.feitas, FUSO), cartoes: propostos, ...(falha ? { falha } : {}) });
  }

  return {
    async estado() {
      return { ligado: true, hermes: hermes !== null, tetoDia: deps.tetoDia, usadosHoje: usados.get(diaLocal(agora())) ?? 0 };
    },

    async receber(pedido) {
      // Sem strictNullChecks no projeto, `{ regra: null }` não estreita a união: o tipo vai explícito.
      // A página entra na regra: da tela de Finanças nada é lido nem vai a modelo (RULES 28).
      const rota = rotearLocal(pedido.texto, pedido.contexto.pagina);
      if (rota.regra === "recusa") throw new PedidoDoAssistenteInvalido((rota as { resposta: string }).resposta);
      let c = pedido.conversaId ? conversas.get(pedido.conversaId) : undefined;
      // `pendente`: o painel retoma o acompanhamento em vez de só mostrar o erro (outra aba mandou antes).
      if (c?.pendente) throw new PedidoDoAssistenteInvalido("Espere a resposta anterior chegar.", { pendente: true });

      if (rota.regra === "financas") {
        const financas = rota as { resposta: string; guardado: string };
        // Sem modelo nenhum e sem o texto no arquivo (RULES 24 e 28); não conta no teto.
        c ??= nova();
        const quando = agora().toISOString();
        const minha = await adicionar(c, { id: novoId(), autor: "romulo", texto: financas.guardado, quando, fontes: [], cartoes: [] });
        const dela = await adicionar(c, { id: novoId(), autor: "assistente", texto: financas.resposta, quando, cerebro: "regra", fontes: [], cartoes: [] });
        log.log("[assistente] finanças: respondido por regra, nada foi ao modelo");
        return { conversaId: c.id, mensagemId: minha.id, respostaId: dela.id };
      }

      const dia = diaLocal(agora());
      const hoje = usados.get(dia) ?? 0;
      if (hoje >= deps.tetoDia) throw new TetoDoAssistente(deps.tetoDia);
      // Conta a tentativa, não o sucesso: timeout em série não pode virar gasto infinito.
      usados.set(dia, hoje + 1);

      c ??= nova();
      const conversa = c;
      const anteriores = [...conversa.mensagens];
      const textoDoRomulo = prepararTexto(pedido.texto.trim());
      const minha = await adicionar(conversa, { id: novoId(), autor: "romulo", texto: textoDoRomulo, quando: agora().toISOString(), fontes: [], cartoes: [] }, true);
      const respostaId = novoId();
      conversa.pendente = { respostaId, etapa: "pensando", desde: agora().toISOString() };
      enfileirar(async () => {
        const inicio = agora().getTime();
        let pronta: Omit<MensagemDoAssistente, "n">;
        try {
          pronta = await gerarResposta(conversa, anteriores, textoDoRomulo, pedido.contexto, respostaId);
        } catch (error) {
          log.error(`[assistente] erro: ${error instanceof Error ? error.message : String(error)}`);
          pronta = { id: respostaId, autor: "assistente", texto: TEXTO_OUTRO, quando: agora().toISOString(), fontes: [], cartoes: [], falha: { tipo: "outro", texto: TEXTO_OUTRO } };
        }
        conversa.pendente = null;
        await adicionar(conversa, pronta);
        log.log(`[assistente] resposta ${pronta.falha ? `com falha (${pronta.falha.tipo})` : "pronta"} · ${pronta.cerebro ?? "-"} · ${pronta.cartoes.length} cartão(ões) · ${Math.round((agora().getTime() - inicio) / 1000)} s · ${usados.get(dia) ?? 0}/${deps.tetoDia} hoje`);
      });
      return { conversaId: conversa.id, mensagemId: minha.id, respostaId };
    },

    conversa(id, desde = 0) {
      const c = conversas.get(id);
      if (!c) return null;
      return { conversaId: c.id, mensagens: c.mensagens.filter((m) => m.n > desde), pendente: c.pendente };
    },

    async avaliar(respostaId, nota, motivo) {
      const c = respostas.get(respostaId);
      if (!c) return false;
      const limpo = motivo ? semValores(prepararTexto(motivo.trim())).slice(0, MAX_MOTIVO_DA_AVALIACAO) : "";
      await gravar({ tipo: "avaliacao", quando: agora().toISOString(), conversaId: c.id, respostaId, nota, ...(limpo ? { motivo: limpo } : {}) });
      return true;
    },

    async decidirCartao(cartaoId, desfecho) {
      const achado = cartoes.get(cartaoId);
      if (!achado) return "naoAchou";
      if (achado.cartao.estado !== "proposto") return achado.cartao.estado === desfecho ? "ok" : "jaDecidido";
      achado.cartao.estado = desfecho;
      await gravar({ tipo: "cartao", quando: agora().toISOString(), conversaId: achado.conversa.id, cartaoId, desfecho });
      return "ok";
    },

    ocupado: () => naFila > 0,
    ocioso: async () => {
      // A fila pode crescer enquanto se espera: espera até ela parar de mudar.
      let atual: Promise<void>;
      do {
        atual = fila;
        await atual;
      } while (atual !== fila);
    },
  };
}

// --- O boot ---------------------------------------------------------------------

export interface ContextoDoBoot {
  dataDir: string;
  operations: boolean;
  ai?: Pick<GoogleGenAI, "models">;
  fontes: FontesDoAssistente;
  /** Monta a consulta ao Hermes (server/hermes-consulta.ts) com o teto do dia dela; ausente = sem Hermes. */
  criarHermes?: (opcoes: { tetoDia: number }) => ConsultaAoHermes | null;
}

/**
 * Lê a env e devolve o Assistente pronto, ou null com o motivo no log. Só no perfil operations: fora
 * dele a env é ignorada e dita (o Easypanel não lê o CRM nem o Dell).
 */
export async function prepararAssistente(
  env: NodeJS.ProcessEnv,
  contexto: ContextoDoBoot,
  opcoes: { log?: Logger; agora?: () => Date; gerar?: GerarNoGemini } = {},
): Promise<Assistente | null> {
  const log = opcoes.log ?? console;
  let config: ConfigDoAssistente;
  try {
    config = lerConfigDoAssistente(env);
  } catch (err: any) {
    log.error(`[assistente] desligado: ${err?.message ?? err}`);
    return null;
  }
  if (!config.ligado) return null;
  if (!contexto.operations) {
    log.log("[assistente] SQUADONE_ASSISTENTE ignorada: só no perfil operations");
    return null;
  }
  let gerar = opcoes.gerar;
  if (!gerar) {
    const ai = contexto.ai;
    if (!ai || !(env.GEMINI_API_KEY ?? "").trim()) {
      log.error("[assistente] desligado: sem GEMINI_API_KEY");
      return null;
    }
    gerar = (params) => gerarComRetry(ai as GoogleGenAI, params);
  }
  let hermes: ConsultaAoHermes | null = null;
  if (config.hermes) {
    hermes = contexto.criarHermes?.({ tetoDia: config.hermesTetoDia }) ?? null;
    if (!hermes) log.error("[assistente] SQUADONE_ASSISTENTE_HERMES=true, mas a consulta ao Hermes não está disponível nesta Central: segue sem ela");
  }
  const dir = path.join(contexto.dataDir, "assistente");
  try {
    const assistente = await criarAssistente({ dir, tetoDia: config.tetoDia, gerar, fontes: contexto.fontes, hermes, log, ...(opcoes.agora ? { agora: opcoes.agora } : {}) });
    log.log(`[assistente] ligado: ${MODEL}, teto ${config.tetoDia}/dia${hermes ? `, Hermes com teto ${config.hermesTetoDia}/dia` : ", sem Hermes"}; histórico em ${dir}`);
    return assistente;
  } catch (error) {
    log.error(`[assistente] desligado: pasta do histórico indisponível (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}
