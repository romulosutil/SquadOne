import { assinaturaDoContextoComercial } from '../src/operations/copiloto.ts';
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { GoogleGenAI } from "@google/genai";
import {
  copilotoServe,
  lerSaidaDoCopiloto,
  montarDossie,
  promptDoCopiloto,
  textoDoRaioX,
  type DossieDoLead,
  type LeadDoCopiloto,
  type MotivoDaRecusa,
  type SugestaoDoCopiloto,
} from "../src/operations/copiloto.ts";
import { passoAtual, type IdDoPasso } from "../src/operations/jornada.ts";
import type { CrmLead, CrmProduto, CrmVisao } from "../src/operations/types.ts";
import type { MensagemParaODossie } from "../src/operations/copiloto.ts";
import { arquivoDoMes, COTA_ESGOTADA, conferirCodex, diaLocal, executarCodex, type ExecutorDoCodex, type Logger } from "./luna-sombra.ts";
import { gerarComRetry, MODEL, ModeloOcupado } from "./orchestrator.ts";
import { conferirMensagem, resumoDosProblemas } from "./gate-de-envio.ts";
import { anexarJsonl } from "./em-serie.ts";

/**
 * O gate de pré-envio (server/gate-de-envio.ts) sobre a mensagem do modelo, em modo "bloquear": marca
 * sem preencher, frase de texto de IA, tamanho, links e "R$" fora dos preços abertos. Devolve os
 * motivos, ou null se a mensagem passa. Não confere nome nem destino: o modelo não escolhe nenhum dos dois.
 */
export function barradaPeloGate(mensagem: string): string | null {
  const r = conferirMensagem(mensagem, { modo: "bloquear", tipo: "conversa" });
  return r.bloqueia ? resumoDosProblemas(r.problemas) : null;
}

/**
 * Copiloto do PRUMO em SOMBRA (perfis-e-experimentos.md, "Copiloto do PRUMO"). Na Ficha de um
 * lead entre o "respondeu" e a proposta, o Rômulo pede uma sugestão: a próxima mensagem, o que
 * oferecer e o rascunho dos itens da proposta. O dossiê e a leitura da saída são PUROS
 * (src/operations/copiloto.ts); aqui fica a cola: o provedor (trocável), o teto/dia, a
 * sugestão guardada pelo hash do dossiê e o JSONL 600 que mede se ele usa o que recebe.
 *
 * Nunca envia nada: a sugestão é texto para copiar. Desligado por padrão
 * (`SQUADONE_COPILOTO=true` liga), só no perfil operations: nunca no Easypanel.
 *
 * Canal × cérebro (15/10/2026): o Hermes segue como secretário e ponte do WhatsApp (só lê e
 * avisa); o cérebro da venda mora aqui, com o provedor atrás de `ProvedorDoCopiloto`, para
 * trocar o ChatGPT (codex) pelo Gemini, ou por outro, sem tocar no resto.
 */

// --- Provedor -------------------------------------------------------------------

export type NomeDoProvedor = "codex" | "gemini";
export const PROVEDORES: readonly NomeDoProvedor[] = ["codex", "gemini"];

export type MotivoDoProvedor = "timeout" | "cota" | "execucao" | "sem_mensagem";

export type RespostaDoProvedor =
  | { ok: true; texto: string }
  | { ok: false; motivo: MotivoDoProvedor; detalhe: string };

/** Um modelo que recebe o prompt e devolve texto. Nunca lança: a falha volta classificada. */
export interface ProvedorDoCopiloto {
  nome: NomeDoProvedor;
  /** Para o registro e a Ficha ("ChatGPT pelo codex", "gemini-3.7-flash"). */
  descricao: string;
  gerar(prompt: string): Promise<RespostaDoProvedor>;
}

/** Teto de UMA geração: a Ficha espera com o botão girando, então não pode ser infinito. */
export const TIMEOUT_DO_COPILOTO_MS = 120_000;

/**
 * ChatGPT pelo login do Codex no Dell, como a Luna: `execFile` (sem shell), prompt pelo stdin,
 * ambiente limpo (o executor de luna-sombra.ts), sandbox read-only, resposta por arquivo num cwd
 * próprio. Sem `modelo`, vale o padrão da conta.
 */
export function provedorCodex(opcoes: { bin: string; dir: string; modelo?: string; executar?: ExecutorDoCodex; timeoutMs?: number }): ProvedorDoCopiloto {
  const executar = opcoes.executar ?? executarCodex;
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_DO_COPILOTO_MS;
  const cwd = path.join(opcoes.dir, "cwd");
  return {
    nome: "codex",
    descricao: `ChatGPT pelo codex${opcoes.modelo ? ` (${opcoes.modelo})` : ""}`,
    async gerar(prompt) {
      await fs.mkdir(cwd, { recursive: true, mode: 0o700 });
      const arquivo = path.join(cwd, `resposta-${randomUUID()}.txt`);
      const args = ["exec", ...(opcoes.modelo ? ["--model", opcoes.modelo] : []), "--sandbox", "read-only", "--skip-git-repo-check", "--output-last-message", arquivo];
      try {
        const p = await executar(opcoes.bin, args, { cwd, stdin: prompt, timeoutMs });
        let mensagem: string | null = null;
        try {
          mensagem = await fs.readFile(arquivo, "utf8");
        } catch {
          mensagem = null;
        }
        if (p.estourouTempo) return { ok: false, motivo: "timeout", detalhe: `codex não respondeu em ${Math.round(timeoutMs / 1000)} s` };
        if (p.erro || p.codigo !== 0) {
          if (COTA_ESGOTADA.test(`${p.stderr}\n${p.stdout}`)) return { ok: false, motivo: "cota", detalhe: "codex recusou por cota" };
          const linha = p.stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
          return { ok: false, motivo: "execucao", detalhe: `${p.erro ?? `código ${p.codigo}`}${linha ? `: ${linha.slice(0, 200)}` : ""}` };
        }
        if (mensagem === null) return { ok: false, motivo: "sem_mensagem", detalhe: "codex saiu bem sem escrever a última mensagem" };
        return { ok: true, texto: mensagem };
      } finally {
        await fs.rm(arquivo, { force: true });
      }
    },
  };
}

/** O Gemini do servidor (o mesmo cliente do turno), com saída JSON pedida na config. */
export function provedorGemini(ai: Pick<GoogleGenAI, "models">, modelo: string = MODEL): ProvedorDoCopiloto {
  return {
    nome: "gemini",
    descricao: modelo,
    async gerar(prompt) {
      try {
        const r = await gerarComRetry(ai as GoogleGenAI, {
          model: modelo,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { responseMimeType: "application/json", temperature: 0.4 },
        });
        const texto = r.text ?? "";
        return texto.trim() ? { ok: true, texto } : { ok: false, motivo: "sem_mensagem", detalhe: "o Gemini não devolveu texto" };
      } catch (error: any) {
        // 429/503 já foram retentados no gerarComRetry (com os modelos reserva): chegar aqui é ocupado de verdade.
        if (error instanceof ModeloOcupado) return { ok: false, motivo: "cota", detalhe: "Gemini ocupado ou sem cota: tente de novo em alguns segundos" };
        return { ok: false, motivo: "execucao", detalhe: String(error?.message ?? error).slice(0, 200) };
      }
    },
  };
}

// --- Configuração -----------------------------------------------------------------

export class CopilotoMalConfigurado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "CopilotoMalConfigurado";
  }
}

export const TETO_DIA_DO_COPILOTO = 20;

export interface ConfigDoCopiloto {
  ligado: boolean;
  provedor: NomeDoProvedor;
  tetoDia: number;
  /** Só no codex: o binário (SQUADONE_CODEX_BIN, o mesmo da Luna) e o modelo (vazio = o padrão da conta). */
  bin: string;
  modelo?: string;
}

/**
 * `SQUADONE_COPILOTO=true` liga. `SQUADONE_COPILOTO_PROVEDOR` = codex (padrão) ou gemini;
 * `SQUADONE_COPILOTO_TETO_DIA` (padrão 20); `SQUADONE_COPILOTO_MODELO` (opcional). Valor
 * ilegível lança: melhor dizer no boot que cair calado no padrão.
 */
export function lerConfigDoCopiloto(env: NodeJS.ProcessEnv = process.env): ConfigDoCopiloto {
  const ligado = (env.SQUADONE_COPILOTO ?? "").trim() === "true";
  const provedorBruto = (env.SQUADONE_COPILOTO_PROVEDOR ?? "").trim() || "codex";
  if (!PROVEDORES.includes(provedorBruto as NomeDoProvedor)) {
    throw new CopilotoMalConfigurado(`SQUADONE_COPILOTO_PROVEDOR='${provedorBruto}' não é ${PROVEDORES.join(" nem ")}.`);
  }
  const tetoBruto = (env.SQUADONE_COPILOTO_TETO_DIA ?? "").trim();
  let tetoDia = TETO_DIA_DO_COPILOTO;
  if (tetoBruto) {
    if (!/^\d+$/.test(tetoBruto) || Number(tetoBruto) <= 0) {
      throw new CopilotoMalConfigurado(`SQUADONE_COPILOTO_TETO_DIA='${tetoBruto}' não é um inteiro maior que zero.`);
    }
    tetoDia = Number(tetoBruto);
  }
  const modelo = (env.SQUADONE_COPILOTO_MODELO ?? "").trim();
  return {
    ligado,
    provedor: provedorBruto as NomeDoProvedor,
    tetoDia,
    bin: (env.SQUADONE_CODEX_BIN ?? "").trim() || "codex",
    ...(modelo ? { modelo } : {}),
  };
}

// --- Erros classificados (a rota decide o status pelo tipo) -------------------------

export class LeadForaDoCrm extends Error {
  constructor() {
    super("Este lead não está no CRM agora.");
    this.name = "LeadForaDoCrm";
  }
}

export class PassoSemCopiloto extends Error {
  constructor(readonly passo: IdDoPasso) {
    super("O copiloto só acompanha do \"respondeu\" até a proposta.");
    this.name = "PassoSemCopiloto";
  }
}

export class TetoDoCopiloto extends Error {
  constructor(readonly teto: number) {
    super(`O copiloto já fez ${teto} sugestões hoje (teto do dia). Volta amanhã.`);
    this.name = "TetoDoCopiloto";
  }
}

export type MotivoDaFalha = MotivoDoProvedor | MotivoDaRecusa;

export class CopilotoFalhou extends Error {
  constructor(readonly motivo: MotivoDaFalha, readonly detalhe: string) {
    super(`O copiloto não conseguiu sugerir agora (${motivo}).`);
    this.name = "CopilotoFalhou";
  }
}

// --- Registro (JSONL 600) ---------------------------------------------------------

export interface RegistroDeSugestao {
  tipo: "sugestao";
  quando: string;
  /** `produto:id`, como a aba CRM. */
  lead: string;
  passo: IdDoPasso;
  provedor: NomeDoProvedor;
  hashDoDossie: string;
  duracaoMs: number;
  sugestao?: SugestaoDoCopiloto;
  avisos?: string[];
  falha?: { motivo: MotivoDaFalha; detalhe: string };
}

export interface RegistroDeCopia {
  tipo: "copiou";
  quando: string;
  lead: string;
  hashDoDossie: string;
  oQue: "mensagem" | "proposta";
}

export type RegistroDoCopiloto = RegistroDeSugestao | RegistroDeCopia;

export function hashDoDossie(dossie: DossieDoLead): string {
  return createHash("sha256").update(JSON.stringify(dossie), "utf8").digest("hex").slice(0, 32);
}

/** Linhas do arquivo do mês: as tortas são puladas (o registro é medição, não fonte da verdade). */
export async function lerRegistros(arquivo: string): Promise<RegistroDoCopiloto[]> {
  let texto: string;
  try {
    texto = await fs.readFile(arquivo, "utf8");
  } catch {
    return [];
  }
  const saida: RegistroDoCopiloto[] = [];
  for (const linha of texto.split("\n")) {
    if (!linha.trim()) continue;
    try {
      const r = JSON.parse(linha) as RegistroDoCopiloto;
      if (r && (r.tipo === "sugestao" || r.tipo === "copiou") && typeof r.lead === "string" && typeof r.quando === "string") saida.push(r);
    } catch {
      // linha torta não conta
    }
  }
  return saida;
}

// --- A cola ---------------------------------------------------------------------

export interface SugestaoNaFicha {
  hashDoDossie: string;
  quando: string;
  provedor: string;
  sugestao: SugestaoDoCopiloto;
  avisos: string[];
  /** Veio guardada (mesmo dossiê), sem chamar o modelo. */
  guardada: boolean;
  /** O que o dossiê levou do Raio-X: a Ficha diz quando ele foi sem os achados. */
  raioX: DossieDoLead["raioX"]["situacao"];
}

export interface EstadoDoCopiloto {
  ligado: true;
  provedor: string;
  tetoDia: number;
  usadosHoje: number;
}

export interface FontesDoCopiloto {
  /** A visão do CRM (CrmStore.visao): o lead sai dela, nunca do navegador. */
  visao: () => Promise<Pick<CrmVisao, "leads">>;
  /** O HTML do Raio-X do lead, se houver no disco; null = sem. */
  raioX: (lead: CrmLead) => Promise<string | null>;
  /** As mensagens guardadas pelo observador (server/conversa-do-lead.ts); null = sem. Opcional nos testes. */
  conversa?: (lead: CrmLead) => Promise<MensagemParaODossie[] | null>;
}

export interface DepsDoCopiloto {
  /** `<dados da Central>/copiloto`: o JSONL do mês e o `cwd/` do codex. */
  dir: string;
  provedor: ProvedorDoCopiloto;
  tetoDia: number;
  fontes: FontesDoCopiloto;
  agora?: () => Date;
  log?: Logger;
}

/** O copiloto sozinho para um lead: a sugestão pronta, gerando, esperando a vez, ou nada a fazer. */
export type EstadoAutomatico =
  | { estado: "pronta"; sugestao: SugestaoNaFicha }
  | { estado: "gerando" }
  | { estado: "na-fila" }
  | { estado: "sem" };

export interface Copiloto {
  estado(): Promise<EstadoDoCopiloto>;
  /** A sugestão guardada para o dossiê de agora, sem chamar o modelo; null = nenhuma. */
  ler(produto: CrmProduto, id: string): Promise<SugestaoNaFicha | null>;
  /** Guardada se o dossiê não mudou (e `forcar` não veio); senão, uma geração nova. */
  sugerir(produto: CrmProduto, id: string, forcar?: boolean): Promise<SugestaoNaFicha>;
  copiou(produto: CrmProduto, id: string, hashDoDossie: string, oQue: "mensagem" | "proposta"): Promise<void>;
  /**
   * Sem ninguém pedir (16/10/2026, "consciente das conversas de forma autônoma"): a sugestão guardada
   * se ainda vale para a conversa de agora; senão começa uma geração em segundo plano (uma por vez na
   * Central) e diz "gerando". Falha ou teto do dia viram "sem" até o dossiê mudar: não tenta em laço.
   */
  automatica(lead: CrmLead): Promise<EstadoAutomatico>;
  /** leadId -> sugestão, dos leads dados que têm uma guardada para o dossiê de agora (sem chamar o modelo). */
  prontas(leads: readonly CrmLead[]): Promise<Map<string, SugestaoNaFicha>>;
}

const chaveDoLead = (produto: string, id: string) => `${produto}:${id}`;

/** Passado isto o dossiê é relido do disco mesmo sem mudança na conversa (o Raio-X pode ter aparecido). */
export const RELEITURA_DO_DOSSIE_MS = 15 * 60_000;
/** A cota do provedor esgotou: o automático espera isto antes de tentar de novo. */
export const PAUSA_POR_COTA_MS = 10 * 60_000;

export function criarCopiloto(deps: DepsDoCopiloto): Copiloto {
  const log = deps.log ?? console;
  const agora = deps.agora ?? (() => new Date());
  // Por lead: a última sugestão boa. Carregada do arquivo do mês na primeira chamada, porque a
  // Central reinicia a cada atualização (atualizar-central.timer) e a sugestão não pode sumir.
  let guardadas: Map<string, RegistroDeSugestao> | null = null;
  let contador: { dia: string; usados: number } | null = null;
  const emAndamento = new Map<string, Promise<SugestaoNaFicha>>();

  async function carregar(): Promise<Map<string, RegistroDeSugestao>> {
    if (guardadas) return guardadas;
    const mapa = new Map<string, RegistroDeSugestao>();
    for (const r of await lerRegistros(arquivoDoMes(deps.dir, agora()))) {
      // Sugestão guardada antes do gate (ou que ele não deixaria passar hoje) não volta para a Ficha nem para a fila.
      if (r.tipo === "sugestao" && r.sugestao && barradaPeloGate(r.sugestao.mensagem) === null) mapa.set(r.lead, r);
    }
    guardadas = mapa;
    return mapa;
  }

  async function contadorDoDia(): Promise<{ dia: string; usados: number }> {
    const hoje = agora();
    const dia = diaLocal(hoje);
    if (!contador || contador.dia !== dia) {
      const registros = await lerRegistros(arquivoDoMes(deps.dir, hoje));
      contador = { dia, usados: registros.filter((r) => r.tipo === "sugestao" && diaLocal(new Date(r.quando)) === dia).length };
    }
    return contador;
  }

  const gravar = (registro: RegistroDoCopiloto): Promise<void> => anexarJsonl(arquivoDoMes(deps.dir, new Date(registro.quando)), registro);

  async function dossieDe(produto: CrmProduto, id: string): Promise<{ lead: CrmLead; dossie: DossieDoLead; passo: IdDoPasso }> {
    const { leads } = await deps.fontes.visao();
    const lead = leads.find((l) => l.produto === produto && l.id === id);
    if (!lead) throw new LeadForaDoCrm();
    return dossieDoLead(lead);
  }

  async function dossieDoLead(lead: CrmLead): Promise<{ lead: CrmLead; dossie: DossieDoLead; passo: IdDoPasso }> {
    const { produto, id } = lead;
    const passo = passoAtual(lead);
    if (!copilotoServe(lead)) throw new PassoSemCopiloto(passo);
    let html: string | null = null;
    try {
      html = await deps.fontes.raioX(lead);
    } catch (error) {
      log.warn(`[copiloto] Raio-X ilegível para ${chaveDoLead(produto, id)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    // A conversa guardada pelo observador (16/10/2026): sem ela, só o trecho da última resposta.
    let conversa: Awaited<ReturnType<NonNullable<FontesDoCopiloto["conversa"]>>> = null;
    try {
      conversa = (await deps.fontes.conversa?.(lead)) ?? null;
    } catch (error) {
      log.warn(`[copiloto] conversa ilegível para ${chaveDoLead(produto, id)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const dossie = montarDossie(lead as LeadDoCopiloto, {
      ...(html ? { textoDoRaioX: textoDoRaioX(html) } : {}),
      ...(conversa?.length ? { conversa } : {}),
    });
    return { lead, dossie, passo };
  }

  const naFicha = (r: RegistroDeSugestao, raioX: DossieDoLead["raioX"]["situacao"], guardada: boolean): SugestaoNaFicha => ({
    hashDoDossie: r.hashDoDossie,
    quando: r.quando,
    provedor: deps.provedor.descricao,
    sugestao: r.sugestao!,
    avisos: r.avisos ?? [],
    guardada,
    raioX,
  });

  async function gerar(produto: CrmProduto, id: string, forcar: boolean, doLead?: CrmLead): Promise<SugestaoNaFicha> {
    const { dossie, passo } = doLead ? await dossieDoLead(doLead) : await dossieDe(produto, id);
    const hash = hashDoDossie(dossie);
    const chave = chaveDoLead(produto, id);
    const anterior = (await carregar()).get(chave);
    if (!forcar && anterior?.hashDoDossie === hash) return naFicha(anterior, dossie.raioX.situacao, true);

    const c = await contadorDoDia();
    if (c.usados >= deps.tetoDia) throw new TetoDoCopiloto(deps.tetoDia);
    // Conta a tentativa, não o sucesso: timeout em série não pode virar gasto infinito.
    c.usados++;

    const inicio = agora();
    const resposta = await deps.provedor.gerar(promptDoCopiloto(dossie));
    const lida = resposta.ok === true ? lerSaidaDoCopiloto(resposta.texto, dossie) : null;
    // O gate de pré-envio: a mensagem quebrada vira falha (com o motivo), e a Ficha não oferece "Copiar".
    const barrada = lida && lida.ok === true ? barradaPeloGate(lida.sugestao.mensagem) : null;
    const leitura = barrada !== null ? { ok: false as const, motivo: "gate_de_envio" as const, detalhe: barrada } : lida;
    const falha = resposta.ok === false
      ? { motivo: resposta.motivo as MotivoDaFalha, detalhe: resposta.detalhe }
      : leitura && leitura.ok === false ? { motivo: leitura.motivo as MotivoDaFalha, detalhe: leitura.detalhe } : null;
    const registro: RegistroDeSugestao = {
      tipo: "sugestao",
      quando: inicio.toISOString(),
      lead: chave,
      passo,
      provedor: deps.provedor.nome,
      hashDoDossie: hash,
      duracaoMs: agora().getTime() - inicio.getTime(),
      ...(leitura && leitura.ok === true ? { sugestao: leitura.sugestao, avisos: leitura.avisos } : {}),
      ...(falha ? { falha } : {}),
    };
    await gravar(registro);
    log.log(`[copiloto] ${chave} (${passo}): ${falha ? `falhou (${falha.motivo})` : "sugestão pronta"} · ${deps.provedor.nome} · ${Math.round(registro.duracaoMs / 1000)} s · ${c.usados}/${deps.tetoDia} hoje`);
    if (falha) throw new CopilotoFalhou(falha.motivo, falha.detalhe);
    (await carregar()).set(chave, registro);
    return naFicha(registro, dossie.raioX.situacao, false);
  }

  function sugerir(produto: CrmProduto, id: string, forcar = false, doLead?: CrmLead): Promise<SugestaoNaFicha> {
    // Clique duplo, ou duas abas, ou a Ficha e o automático juntos: uma geração só por lead.
    const chave = chaveDoLead(produto, id);
    const corrente = emAndamento.get(chave);
    if (corrente) return corrente;
    const p = gerar(produto, id, forcar, doLead).finally(() => emAndamento.delete(chave));
    emAndamento.set(chave, p);
    return p;
  }

  // O automático não tenta de novo, no mesmo dia, o mesmo dossiê que falhou: chave -> hash e dia. Teto do dia e
  // cota não entram aqui (não são culpa do dossiê, e carimbá-lo bloquearia o lead por todos os dias seguintes);
  // a cota segura o laço todo por um tempo (`semAutomaticoAte`).
  const semAutomatico = new Map<string, { hash: string; dia: string }>();
  let semAutomaticoAte = 0;

  // O que a volta anterior já sabe de cada lead (19/10/2026): o dossiê lê o Raio-X e a conversa do disco, e o
  // laço de 1 min o refazia para todo lead cuja vez é do Rômulo. Sem mudança na conversa, na etapa ou nos
  // eventos, vale o hash de antes; a releitura periódica pega o que não deixa rastro (o Raio-X que apareceu).
  const vistos = new Map<string, { assinatura: string; hash: string; raioX: DossieDoLead["raioX"]["situacao"]; em: number }>();
  const assinaturaDoLead = (lead: CrmLead) =>
    [lead.conversa?.ultimaEntrada ?? "", lead.conversa?.ultima?.em ?? "", lead.etapa, lead.subEtapa, lead.eventos.length, assinaturaDoContextoComercial(lead)].join("|");
  async function hashDoLead(lead: CrmLead): Promise<{ hash: string; raioX: DossieDoLead["raioX"]["situacao"] }> {
    const chave = chaveDoLead(lead.produto, lead.id);
    const assinatura = assinaturaDoLead(lead);
    const visto = vistos.get(chave);
    const agoraMs = agora().getTime();
    if (visto && visto.assinatura === assinatura && agoraMs - visto.em < RELEITURA_DO_DOSSIE_MS) return visto;
    const { dossie } = await dossieDoLead(lead);
    const novo = { assinatura, hash: hashDoDossie(dossie), raioX: dossie.raioX.situacao, em: agoraMs };
    vistos.set(chave, novo);
    return novo;
  }
  return {
    async estado() {
      const c = await contadorDoDia();
      return { ligado: true, provedor: deps.provedor.descricao, tetoDia: deps.tetoDia, usadosHoje: c.usados };
    },
    async ler(produto, id) {
      const { dossie } = await dossieDe(produto, id);
      const anterior = (await carregar()).get(chaveDoLead(produto, id));
      return anterior && anterior.hashDoDossie === hashDoDossie(dossie) ? naFicha(anterior, dossie.raioX.situacao, true) : null;
    },
    sugerir: (produto, id, forcar = false) => sugerir(produto, id, forcar),
    async automatica(lead) {
      if (!copilotoServe(lead) || !conversaDaVez(lead)) return { estado: "sem" };
      const chave = chaveDoLead(lead.produto, lead.id);
      if (emAndamento.has(chave)) return { estado: "gerando" };
      const { hash, raioX } = await hashDoLead(lead);
      const anterior = (await carregar()).get(chave);
      if (anterior?.hashDoDossie === hash) return { estado: "pronta", sugestao: naFicha(anterior, raioX, true) };
      const hoje = diaLocal(agora());
      const falhou = semAutomatico.get(chave);
      if (falhou && falhou.hash === hash && falhou.dia === hoje) return { estado: "sem" };
      // Teto do dia e cota: nem tenta (cada tentativa releria o dossiê para bater na mesma porta).
      if (agora().getTime() < semAutomaticoAte || (await contadorDoDia()).usados >= deps.tetoDia) return { estado: "sem" };
      // Uma geração por vez na Central: o codex roda no Dell, e dez de uma vez travariam a máquina.
      if (emAndamento.size) return { estado: "na-fila" };
      void sugerir(lead.produto, lead.id, false, lead).catch((error) => {
        if (error instanceof TetoDoCopiloto) {
          // Não é o dossiê.
        } else if (error instanceof CopilotoFalhou && error.motivo === "cota") {
          semAutomaticoAte = agora().getTime() + PAUSA_POR_COTA_MS;
        } else {
          semAutomatico.set(chave, { hash, dia: hoje });
        }
        log.warn(`[copiloto] automático sem sugestão para ${chave}: ${error instanceof Error ? error.message : String(error)}`);
      });
      return { estado: "gerando" };
    },
    async prontas(leads) {
      const mapa = new Map<string, SugestaoNaFicha>();
      const guardadas = await carregar();
      for (const lead of leads) {
        const anterior = guardadas.get(chaveDoLead(lead.produto, lead.id));
        // Na Próxima venda e no Telegram só a sugestão de quem leu a conversa e responde à última dele.
        if (!anterior?.sugestao || !copilotoServe(lead) || !conversaDaVez(lead)) continue;
        try {
          const { hash, raioX } = await hashDoLead(lead);
          if (anterior.hashDoDossie === hash) mapa.set(lead.id, naFicha(anterior, raioX, true));
        } catch {
          // um lead torto não tira as sugestões dos outros
        }
      }
      return mapa;
    },
    async copiou(produto, id, hash, oQue) {
      await gravar({ tipo: "copiou", quando: agora().toISOString(), lead: chaveDoLead(produto, id), hashDoDossie: hash.slice(0, 64), oQue });
    },
  };
}

// --- O automático -------------------------------------------------------------------

/** A conversa está guardada e quem escreveu por último foi o lead: dá para ler o momento e responder. */
export function conversaDaVez(lead: Pick<CrmLead, "conversa">): boolean {
  return lead.conversa?.ultima.direcao === "entrada";
}

export const INTERVALO_DO_AUTOMATICO_MS = 60_000;

/**
 * Quem o copiloto lê sozinho: os leads em que a vez é do Rômulo (resposta nova, interesse parado ou
 * ele escreveu por último na conversa guardada) e no trecho em que o copiloto vale. PURO.
 */
export function leadsDoAutomatico(leads: readonly CrmLead[]): CrmLead[] {
  // Só com a conversa guardada e a última mensagem DELE (16/10/2026): sem ela o copiloto sugeria às cegas
  // ("Sua última mensagem não apareceu para mim", o Raio-X para quem já o tinha recebido com o demo e o preço).
  const vez = (l: CrmLead) => conversaDaVez(l) && (l.respostaNova || l.etapa === "contato" || l.etapa === "proposta");
  // A mensagem mais nova primeiro: é a conversa que está acontecendo agora.
  const recente = (l: CrmLead) => Date.parse(l.conversa?.ultimaEntrada ?? l.resposta?.em ?? l.marcos.respondeu ?? "") || 0;
  return leads.filter((l) => vez(l) && copilotoServe(l)).sort((a, b) => recente(b) - recente(a));
}

/**
 * O laço do automático (16/10/2026, pedido do Rômulo: "consciente das conversas de forma autônoma e
 * sugira as melhores mensagens imediatamente"). A cada minuto relê o CRM e pede ao copiloto a
 * sugestão do primeiro lead cuja vez é do Rômulo e que ainda não tem uma para a conversa de agora.
 * Uma geração por vez; o teto do dia vale igual. Nada é enviado: a sugestão aparece na Próxima venda
 * e no aviso do vendedor. `SQUADONE_COPILOTO_AUTOMATICO=false` desliga.
 */
export function iniciarCopilotoAutomatico(copiloto: Copiloto, lerVisao: () => Promise<Pick<CrmVisao, "leads">>, log: Logger = console,
  intervaloMs = INTERVALO_DO_AUTOMATICO_MS): () => void {
  let ocupado = false;
  const volta = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      for (const lead of leadsDoAutomatico((await lerVisao()).leads)) {
        const r = await copiloto.automatica(lead);
        // Começou (ou já há uma na Central): a próxima volta segue a fila.
        if (r.estado === "gerando" || r.estado === "na-fila") break;
      }
    } catch (error) {
      log.warn(`[copiloto] automático: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      ocupado = false;
    }
  };
  const relogio = setInterval(() => { void volta(); }, intervaloMs);
  void volta();
  return () => clearInterval(relogio);
}

// --- O Raio-X no disco --------------------------------------------------------------

const MAX_HTML_DO_RAIO_X = 2 * 1024 * 1024;

/**
 * Onde está a página do Raio-X do lead. Site com pasta: `<auto-site>/<lugar>/<slug>/raio-x.html`
 * (o raio-x.py grava ao lado do demo). PRUMO, e o Raio-X avulso do Site: o projeto raio-x-prumo,
 * `<entregas>/prumo-raio-x/<slug>.html`, com o slug do fim do link publicado. PURO.
 */
export function caminhosDoRaioX(
  lead: Pick<CrmLead, "pasta" | "links">,
  raizes: { autoDirectory?: string; entregasPrumo?: string },
): string[] {
  const caminhos: string[] = [];
  // Os lugares começam com "_" (_em-conversa, _concluidos); ".." nunca passa.
  const seguro = (t: string) => /^[a-z0-9_][a-z0-9._-]{0,200}$/i.test(t) && !t.includes("..");
  // A visão do CRM entrega o lugar formatado para a tela (crm.ts: "raiz" ou "_em-conversa/"); sem
  // desfazer isso, nenhum lead em _em-conversa (justo os que responderam) tinha o Raio-X lido (15/10/2026).
  const lugar = lead.pasta ? (lead.pasta.lugar === "raiz" ? "" : lead.pasta.lugar.replace(/\/$/, "")) : "";
  if (raizes.autoDirectory && lead.pasta && seguro(lead.pasta.slug) && (lugar === "" || seguro(lugar))) {
    caminhos.push(path.join(raizes.autoDirectory, lugar, lead.pasta.slug, "raio-x.html"));
  }
  const url = lead.links.raioX?.trim();
  if (raizes.entregasPrumo && url) {
    try {
      const u = new URL(url);
      const slug = u.pathname.split("/").filter(Boolean).pop() ?? "";
      if (/raio-x-prumo/i.test(u.hostname) && seguro(slug)) caminhos.push(path.join(raizes.entregasPrumo, "prumo-raio-x", `${slug.replace(/\.html$/i, "")}.html`));
    } catch {
      // link torto: sem Raio-X no dossiê
    }
  }
  return caminhos;
}

export async function lerRaioXDoDisco(lead: CrmLead, raizes: { autoDirectory?: string; entregasPrumo?: string }): Promise<string | null> {
  for (const caminho of caminhosDoRaioX(lead, raizes)) {
    try {
      const st = await fs.stat(caminho);
      if (!st.isFile() || st.size > MAX_HTML_DO_RAIO_X) continue;
      return await fs.readFile(caminho, "utf8");
    } catch {
      continue;
    }
  }
  return null;
}

// --- O boot ---------------------------------------------------------------------

/**
 * Lê a env, confere o provedor e devolve o copiloto pronto, ou null com o motivo no log. Só no
 * perfil operations: fora dele a env é ignorada e dita (o Easypanel não conversa com lead).
 */
export async function prepararCopiloto(
  env: NodeJS.ProcessEnv,
  contexto: { dataDir: string; operations: boolean; ai?: Pick<GoogleGenAI, "models">; fontes?: FontesDoCopiloto },
  opcoes: { executar?: ExecutorDoCodex; log?: Logger } = {},
): Promise<Copiloto | null> {
  const log = opcoes.log ?? console;
  let config: ConfigDoCopiloto;
  try {
    config = lerConfigDoCopiloto(env);
  } catch (err: any) {
    log.error(`[copiloto] desligado: ${err?.message ?? err}`);
    return null;
  }
  if (!config.ligado) return null;
  if (!contexto.operations) {
    log.log("[copiloto] SQUADONE_COPILOTO ignorada: só no perfil operations");
    return null;
  }
  if (!contexto.fontes) {
    log.error("[copiloto] desligado: o CRM não está configurado nesta Central");
    return null;
  }
  const dir = path.join(contexto.dataDir, "copiloto");
  let provedor: ProvedorDoCopiloto;
  if (config.provedor === "codex") {
    const executar = opcoes.executar ?? executarCodex;
    const motivo = await conferirCodex(config.bin, executar);
    if (motivo) {
      log.error(`[copiloto] desligado: ${motivo}`);
      return null;
    }
    provedor = provedorCodex({ bin: config.bin, dir, ...(config.modelo ? { modelo: config.modelo } : {}), executar });
  } else {
    if (!contexto.ai || !(env.GEMINI_API_KEY ?? "").trim()) {
      log.error("[copiloto] desligado: provedor gemini sem GEMINI_API_KEY");
      return null;
    }
    provedor = provedorGemini(contexto.ai, config.modelo ?? MODEL);
  }
  await fs.mkdir(path.join(dir, "cwd"), { recursive: true, mode: 0o700 });
  log.log(`[copiloto] ligado: ${provedor.descricao}, teto ${config.tetoDia}/dia, registro em ${dir}`);
  return criarCopiloto({ dir, provedor, tetoDia: config.tetoDia, fontes: contexto.fontes, log });
}
