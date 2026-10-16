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
import { arquivoDoMes, COTA_ESGOTADA, conferirCodex, diaLocal, executarCodex, type ExecutorDoCodex, type Logger } from "./luna-sombra.ts";
import { gerarComRetry, MODEL, ModeloOcupado } from "./orchestrator.ts";

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

export interface Copiloto {
  estado(): Promise<EstadoDoCopiloto>;
  /** A sugestão guardada para o dossiê de agora, sem chamar o modelo; null = nenhuma. */
  ler(produto: CrmProduto, id: string): Promise<SugestaoNaFicha | null>;
  /** Guardada se o dossiê não mudou (e `forcar` não veio); senão, uma geração nova. */
  sugerir(produto: CrmProduto, id: string, forcar?: boolean): Promise<SugestaoNaFicha>;
  copiou(produto: CrmProduto, id: string, hashDoDossie: string, oQue: "mensagem" | "proposta"): Promise<void>;
}

const chaveDoLead = (produto: string, id: string) => `${produto}:${id}`;

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
      if (r.tipo === "sugestao" && r.sugestao) mapa.set(r.lead, r);
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

  async function gravar(registro: RegistroDoCopiloto): Promise<void> {
    await fs.mkdir(deps.dir, { recursive: true, mode: 0o700 });
    const arquivo = await fs.open(arquivoDoMes(deps.dir, new Date(registro.quando)), "a", 0o600);
    try {
      await arquivo.writeFile(`${JSON.stringify(registro)}\n`, "utf8");
    } finally {
      await arquivo.close();
    }
  }

  async function dossieDe(produto: CrmProduto, id: string): Promise<{ lead: CrmLead; dossie: DossieDoLead; passo: IdDoPasso }> {
    const { leads } = await deps.fontes.visao();
    const lead = leads.find((l) => l.produto === produto && l.id === id);
    if (!lead) throw new LeadForaDoCrm();
    const passo = passoAtual(lead);
    if (!copilotoServe(lead)) throw new PassoSemCopiloto(passo);
    let html: string | null = null;
    try {
      html = await deps.fontes.raioX(lead);
    } catch (error) {
      log.warn(`[copiloto] Raio-X ilegível para ${chaveDoLead(produto, id)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const dossie = montarDossie(lead as LeadDoCopiloto, html ? { textoDoRaioX: textoDoRaioX(html) } : {});
    return { lead, dossie, passo };
  }

  const naFicha = (r: RegistroDeSugestao, dossie: DossieDoLead, guardada: boolean): SugestaoNaFicha => ({
    hashDoDossie: r.hashDoDossie,
    quando: r.quando,
    provedor: deps.provedor.descricao,
    sugestao: r.sugestao!,
    avisos: r.avisos ?? [],
    guardada,
    raioX: dossie.raioX.situacao,
  });

  async function gerar(produto: CrmProduto, id: string, forcar: boolean): Promise<SugestaoNaFicha> {
    const { dossie, passo } = await dossieDe(produto, id);
    const hash = hashDoDossie(dossie);
    const chave = chaveDoLead(produto, id);
    const anterior = (await carregar()).get(chave);
    if (!forcar && anterior?.hashDoDossie === hash) return naFicha(anterior, dossie, true);

    const c = await contadorDoDia();
    if (c.usados >= deps.tetoDia) throw new TetoDoCopiloto(deps.tetoDia);
    // Conta a tentativa, não o sucesso: timeout em série não pode virar gasto infinito.
    c.usados++;

    const inicio = agora();
    const resposta = await deps.provedor.gerar(promptDoCopiloto(dossie));
    const leitura = resposta.ok === true ? lerSaidaDoCopiloto(resposta.texto, dossie) : null;
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
    return naFicha(registro, dossie, false);
  }

  return {
    async estado() {
      const c = await contadorDoDia();
      return { ligado: true, provedor: deps.provedor.descricao, tetoDia: deps.tetoDia, usadosHoje: c.usados };
    },
    async ler(produto, id) {
      const { dossie } = await dossieDe(produto, id);
      const anterior = (await carregar()).get(chaveDoLead(produto, id));
      return anterior && anterior.hashDoDossie === hashDoDossie(dossie) ? naFicha(anterior, dossie, true) : null;
    },
    sugerir(produto, id, forcar = false) {
      // Clique duplo, ou duas abas: uma geração só por lead.
      const chave = chaveDoLead(produto, id);
      const corrente = emAndamento.get(chave);
      if (corrente) return corrente;
      const p = gerar(produto, id, forcar).finally(() => emAndamento.delete(chave));
      emAndamento.set(chave, p);
      return p;
    },
    async copiou(produto, id, hash, oQue) {
      await gravar({ tipo: "copiou", quando: agora().toISOString(), lead: chaveDoLead(produto, id), hashDoDossie: hash.slice(0, 64), oQue });
    },
  };
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
  if (raizes.autoDirectory && lead.pasta && seguro(lead.pasta.slug) && (lead.pasta.lugar === "" || seguro(lead.pasta.lugar))) {
    caminhos.push(path.join(raizes.autoDirectory, lead.pasta.lugar, lead.pasta.slug, "raio-x.html"));
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
