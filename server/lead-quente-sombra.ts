/**
 * A cola do agente que mantém o lead quente, EM SOMBRA (17/10/2026; a decisão pura mora em
 * server/lead-quente.ts). A cada minuto relê o CRM; para cada mensagem nova de lead que o gate deixa
 * passar (ou manda escalar), grava a decisão num JSONL 600 e avisa o Rômulo no Telegram: "Eu teria
 * respondido a X: <texto>" ou "Eu teria escalado X (pediu preço): assuma", com 👍/👎 para ele dizer se
 * concorda. NADA é enviado ao lead: este módulo não importa transporte de WhatsApp nenhum, e o teste
 * confere o código-fonte. O único envio é o aviso ao chat do próprio Rômulo.
 *
 * Mesma forma do jev-sombra e do vendedor: o topo (config, registros) é puro ou lê arquivo; `criar...` é a
 * cola com tudo injetado (CRM, conversa, copiloto, Telegram, relógio); `preparar...` é o boot, que devolve
 * null fora do operations, sem o bot do Telegram ou sem o copiloto (o texto de uma resposta é SEMPRE o do
 * copiloto, que já conferiu ids do cardápio, preços e números do dossiê).
 *
 * O que a sombra mede (resumoDoLeadQuente, GET /api/operations/crm/lead-quente): quantas decisões de cada
 * tipo, os falsos positivos do classificador de `interesse` (o voto 👎 num "responder") e quanto o lead
 * esperou, de fato, pela resposta humana.
 */
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CrmLead, CrmVisao } from "../src/operations/types.ts";
import type { MensagemDaConversa } from "./conversa-do-lead.ts";
import {
  CALAR_SEM_REGISTRO,
  chaveDoLeadQuente,
  decidirLeadQuente,
  esperaDaRespostaHumana,
  HORAS_DE_CALAR_PADRAO,
  IDADE_MAXIMA_DA_MENSAGEM_MS,
  textoDoAvisoLeadQuente,
  type DecisaoDoLeadQuente,
  type RegistroDeDecisao,
  type RegistroDeHumano,
  type RegistroDeVoto,
  type RegistroDoLeadQuente,
  type SugestaoParaOLeadQuente,
  type ToqueDoAgente,
} from "./lead-quente.ts";
import { FUSO } from "./alocador.ts";
import { arquivoDoMes, diaLocal, type Logger } from "./luna-sombra.ts";
import type { Botao } from "./telegram.ts";
import { dadosDoLeadQuente } from "./telegram-entrada.ts";

export const INTERVALO_DO_LEAD_QUENTE_MS = 60_000;
/** Quantos avisos por dia, no máximo. Passado isto a decisão continua gravada, só não vai ao Telegram. */
export const TETO_DIA_PADRAO = 30;
/** A resposta humana é conferida a cada tanto, não a cada minuto: lê o arquivo de cada conversa. */
export const INTERVALO_DA_CONFERENCIA_MS = 10 * 60_000;
/** Até quando se confere se o Rômulo respondeu a uma decisão. */
export const JANELA_DA_CONFERENCIA_MS = 3 * 86_400_000;

export class LeadQuenteMalConfigurado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "LeadQuenteMalConfigurado";
  }
}

export interface ConfigDoLeadQuente {
  ligada: boolean;
  tetoDia: number;
  horasDeCalar: number;
}

/**
 * PURO. `SQUADONE_LEAD_QUENTE_SOMBRA=true` liga; teto e janela têm padrão. Número ilegível derruba só
 * a sombra (LeadQuenteMalConfigurado, log no boot), nunca o processo.
 */
export function lerConfigDoLeadQuente(env: Record<string, string | undefined>): ConfigDoLeadQuente {
  const ligada = (env.SQUADONE_LEAD_QUENTE_SOMBRA ?? "").trim() === "true";
  const numero = (nome: string, padrao: number, minimo: number): number => {
    const bruto = (env[nome] ?? "").trim();
    if (!bruto) return padrao;
    const n = Number(bruto);
    if (!Number.isFinite(n) || n < minimo) throw new LeadQuenteMalConfigurado(`${nome} inválida: "${bruto}" (mínimo ${minimo}).`);
    return n;
  };
  if (!ligada) return { ligada, tetoDia: TETO_DIA_PADRAO, horasDeCalar: HORAS_DE_CALAR_PADRAO };
  return {
    ligada,
    tetoDia: Math.floor(numero("SQUADONE_LEAD_QUENTE_TETO_DIA", TETO_DIA_PADRAO, 1)),
    horasDeCalar: numero("SQUADONE_LEAD_QUENTE_CALAR_HORAS", HORAS_DE_CALAR_PADRAO, 0),
  };
}

// ---------------------------------------------------------------- o registro

/** As linhas do mês do instante e do mês anterior (30 dias podem cruzar a virada). Linha torta é pulada. */
export async function lerRegistrosDoLeadQuente(dir: string, agora: number): Promise<RegistroDoLeadQuente[]> {
  const d = new Date(agora);
  const anterior = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15));
  const arquivos = [...new Set([arquivoDoMes(dir, anterior), arquivoDoMes(dir, d)])];
  const registros: RegistroDoLeadQuente[] = [];
  for (const arquivo of arquivos) {
    let texto: string;
    try {
      texto = await fs.readFile(arquivo, "utf8");
    } catch {
      continue;
    }
    for (const linha of texto.split("\n")) {
      if (!linha.trim()) continue;
      try {
        const r = JSON.parse(linha) as RegistroDoLeadQuente;
        if (r && (r.tipo === "decisao" || r.tipo === "voto" || r.tipo === "humano") && typeof r.chave === "string" && typeof r.quando === "string") registros.push(r);
      } catch {
        // linha cortada não derruba a medida
      }
    }
  }
  return registros;
}

/** Hora cheia de São Paulo (0–23): o aviso das 22h às 7h chega sem som, como os lembretes. */
export function horaLocal(ms: number, fuso: string = FUSO): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: fuso, hour: "2-digit", hour12: false }).format(new Date(ms))) % 24;
}

export const ehMadrugada = (ms: number): boolean => {
  const h = horaLocal(ms);
  return h < 7 || h >= 22;
};

// ---------------------------------------------------------------- a cola

export interface DepsDoLeadQuente {
  /** `<dados da Central>/lead-quente-sombra`. */
  dir: string;
  lerVisao(): Promise<Pick<CrmVisao, "estado" | "leads">>;
  /** A conversa guardada do lead (pelo número); null = sem arquivo. */
  lerConversa(lead: CrmLead): Promise<MensagemDaConversa[] | null>;
  /** leadId -> a sugestão do copiloto que vale para a conversa de agora (sem gerar nada). */
  sugestoes(leads: readonly CrmLead[]): Promise<ReadonlyMap<string, SugestaoParaOLeadQuente>>;
  /** O aviso ao chat do Rômulo. É o ÚNICO envio deste módulo. */
  avisar(texto: string, botoes: Botao[][], opcoes: { silencioso: boolean }): Promise<void>;
  tetoDia: number;
  horasDeCalar: number;
  agora?: () => number;
  log?: Logger;
}

export interface ResumoDaVolta {
  /** Leads avaliados (com mensagem nova sem resposta nossa). */
  avaliados: number;
  gravadas: number;
  avisadas: number;
  aguardando: number;
}

export interface LeadQuenteSombra {
  iniciar(): void;
  parar(): void;
  /** Uma volta (o laço chama; o teste também). */
  volta(): Promise<ResumoDaVolta>;
  /** 👍/👎 num aviso. */
  votar(token: string, concorda: boolean): Promise<{ curto: string; texto?: string }>;
}

/** Tem mensagem de gente dele depois da última nossa, recente: vale pagar a leitura do arquivo da conversa. */
function candidato(lead: CrmLead, agora: number): boolean {
  const c = lead.conversa;
  if (!c?.ultimaEntrada) return false;
  const entrada = Date.parse(c.ultimaEntrada);
  if (!Number.isFinite(entrada) || agora - entrada > IDADE_MAXIMA_DA_MENSAGEM_MS) return false;
  const saida = Date.parse(c.ultimaSaida ?? "");
  return !Number.isFinite(saida) || entrada > saida;
}

export function criarLeadQuenteSombra(deps: DepsDoLeadQuente): LeadQuenteSombra {
  const log = deps.log ?? console;
  const agoraMs = deps.agora ?? (() => Date.now());
  let relogio: ReturnType<typeof setInterval> | null = null;
  let ultimaConferencia = 0;
  // Uma volta ou um voto por vez: os dois leem e gravam o mesmo arquivo.
  let fila: Promise<unknown> = Promise.resolve();
  const emSerie = <T>(f: () => Promise<T>): Promise<T> => {
    const p = fila.then(f, f);
    fila = p.catch(() => undefined);
    return p;
  };

  async function gravar(registro: RegistroDoLeadQuente): Promise<void> {
    await fs.mkdir(deps.dir, { recursive: true, mode: 0o700 });
    // O mode de mkdir/open só vale na criação, inclusive após uma restauração.
    await fs.chmod(deps.dir, 0o700);
    const arquivo = await fs.open(arquivoDoMes(deps.dir, new Date(registro.quando)), "a", 0o600);
    try {
      await arquivo.chmod(0o600);
      await arquivo.writeFile(`${JSON.stringify(registro)}\n`, "utf8");
    } finally {
      await arquivo.close();
    }
  }

  const botoesDoAviso = (token: string): Botao[][] => [[
    { texto: "👍 Concordo", dados: dadosDoLeadQuente(token, true) },
    { texto: "👎 Discordo", dados: dadosDoLeadQuente(token, false) },
  ]];

  async function conferirRespostasHumanas(registros: RegistroDoLeadQuente[], leads: ReadonlyMap<string, CrmLead>, agora: number): Promise<number> {
    if (agora - ultimaConferencia < INTERVALO_DA_CONFERENCIA_MS) return 0;
    ultimaConferencia = agora;
    const comHumano = new Set(registros.filter((r) => r.tipo === "humano").map((r) => r.chave));
    let achadas = 0;
    for (const r of registros) {
      if (r.tipo !== "decisao" || r.acao === "calar" || comHumano.has(r.chave)) continue;
      if (agora - Date.parse(r.quando) > JANELA_DA_CONFERENCIA_MS) continue;
      const lead = leads.get(r.lead);
      if (!lead) continue;
      const espera = esperaDaRespostaHumana(await deps.lerConversa(lead).catch(() => null), r.ultimaEntrada);
      if (!espera) continue;
      const humano: RegistroDeHumano = { tipo: "humano", quando: new Date(agora).toISOString(), chave: r.chave, ...espera };
      await gravar(humano);
      comHumano.add(r.chave);
      achadas++;
    }
    return achadas;
  }

  async function voltaSemFila(): Promise<ResumoDaVolta> {
    const agora = agoraMs();
    const resumo: ResumoDaVolta = { avaliados: 0, gravadas: 0, avisadas: 0, aguardando: 0 };
    const visao = await deps.lerVisao();
    if (visao.estado !== "ok") return resumo;
    const registros = await lerRegistrosDoLeadQuente(deps.dir, agora);
    const decisoes = registros.filter((r): r is RegistroDeDecisao => r.tipo === "decisao");
    const jaDecididas = new Set(decisoes.map((d) => d.chave));
    const toques = new Map<string, ToqueDoAgente[]>();
    for (const d of decisoes) {
      if (d.acao !== "responder") continue;
      toques.set(d.lead, [...(toques.get(d.lead) ?? []), { em: Date.parse(d.quando), tipo: "resposta" }]);
    }
    const hoje = diaLocal(new Date(agora));
    let avisadasHoje = decisoes.filter((d) => d.avisado && diaLocal(new Date(d.quando)) === hoje).length;

    const quentes = visao.leads.filter((l) => candidato(l, agora) && !jaDecididas.has(chaveDoLeadQuente(l.id, l.conversa!.ultimaEntrada!)));
    // O copiloto só importa a quem passaria do gate de `interesse`; os outros nem pedem a sugestão.
    const sugestoes = await deps.sugestoes(quentes.filter((l) => l.resposta?.tipo === "interesse")).catch((err) => {
      log.warn(`[lead-quente] sugestões do copiloto indisponíveis: ${err instanceof Error ? err.message : String(err)}`);
      return new Map<string, SugestaoParaOLeadQuente>();
    });

    for (const lead of quentes) {
      const mensagens = await deps.lerConversa(lead).catch(() => null);
      const decisao: DecisaoDoLeadQuente = decidirLeadQuente({
        lead,
        mensagens,
        sugestao: sugestoes.get(lead.id) ?? null,
        agora,
        jaDecididas,
        toques: toques.get(lead.id) ?? [],
        horasDeCalar: deps.horasDeCalar,
      });
      resumo.avaliados++;
      if (decisao.acao === "aguardar") {
        resumo.aguardando++;
        continue;
      }
      if (decisao.acao === "calar" && CALAR_SEM_REGISTRO.has(decisao.motivo)) continue;
      const chave = decisao.chave as string;
      const token = randomBytes(6).toString("hex");
      const aviso = decisao.acao === "calar" ? null : textoDoAvisoLeadQuente(lead.empresa, decisao);
      let avisado = false;
      let semAviso: RegistroDeDecisao["semAviso"];
      if (aviso) {
        if (avisadasHoje >= deps.tetoDia) {
          semAviso = "teto";
        } else {
          try {
            await deps.avisar(aviso, botoesDoAviso(token), { silencioso: ehMadrugada(agora) });
            avisado = true;
            avisadasHoje++;
            resumo.avisadas++;
          } catch (err) {
            semAviso = "falhou";
            log.warn(`[lead-quente] aviso não enviado: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      const registro: RegistroDeDecisao = {
        tipo: "decisao",
        quando: new Date(agora).toISOString(),
        lead: lead.id,
        empresa: lead.empresa,
        chave,
        token,
        acao: decisao.acao,
        ...(decisao.acao !== "responder" ? { motivo: decisao.motivo } : {}),
        ...(decisao.acao === "responder" ? { texto: decisao.texto } : {}),
        ...(lead.resposta?.tipo ? { classificacao: lead.resposta.tipo } : {}),
        ultimaEntrada: lead.conversa!.ultimaEntrada!,
        avisado,
        ...(semAviso ? { semAviso } : {}),
      };
      await gravar(registro);
      jaDecididas.add(chave);
      if (decisao.acao === "responder") toques.set(lead.id, [...(toques.get(lead.id) ?? []), { em: agora, tipo: "resposta" }]);
      resumo.gravadas++;
      log.log(`[lead-quente] ${lead.id}: ${decisao.acao}${registro.motivo ? ` (${registro.motivo})` : ""}${avisado ? " · avisado" : semAviso ? ` · sem aviso (${semAviso})` : ""}`);
    }

    await conferirRespostasHumanas([...registros], new Map(visao.leads.map((l) => [l.id, l])), agora);
    return resumo;
  }

  async function votarSemFila(token: string, concorda: boolean): Promise<{ curto: string; texto?: string }> {
    const agora = agoraMs();
    const registros = await lerRegistrosDoLeadQuente(deps.dir, agora);
    const decisao = registros.find((r): r is RegistroDeDecisao => r.tipo === "decisao" && r.token === token);
    if (!decisao || decisao.acao === "calar") return { curto: "Este aviso não existe mais." };
    const aviso = textoDoAvisoLeadQuente(decisao.empresa, decisao.acao === "responder"
      ? { acao: "responder", chave: decisao.chave, texto: decisao.texto ?? "", avisos: [] }
      : { acao: "escalar", chave: decisao.chave, motivo: decisao.motivo as never });
    // O último voto vale; o aviso fecha (sem botões) no primeiro, e um toque atrasado só repete o rodapé.
    const voto: RegistroDeVoto = { tipo: "voto", quando: new Date(agora).toISOString(), chave: decisao.chave, concorda };
    await gravar(voto);
    return { curto: concorda ? "Anotado: concordou." : "Anotado: discordou.", texto: `${aviso}\n\n${concorda ? "👍 Você concordou." : "👎 Você discordou."}` };
  }

  const registrarFalha = (err: unknown) => log.error(`[lead-quente] volta falhou: ${err instanceof Error ? err.message : String(err)}`);

  return {
    iniciar() {
      if (relogio) return;
      relogio = setInterval(() => { void emSerie(voltaSemFila).catch(registrarFalha); }, INTERVALO_DO_LEAD_QUENTE_MS);
      void emSerie(voltaSemFila).catch(registrarFalha);
    },
    parar() {
      if (relogio) clearInterval(relogio);
      relogio = null;
    },
    volta: () => emSerie(voltaSemFila),
    votar: (token, concorda) => emSerie(() => votarSemFila(token, concorda)),
  };
}

// ---------------------------------------------------------------- o boot

/**
 * Lê a env e devolve a sombra pronta, ou null com o motivo no log. Só no perfil operations, com o bot do
 * Telegram (o aviso é o único canal) e com o copiloto (o texto é dele): fora disso a env é ignorada e
 * dita. Nunca no Easypanel.
 */
export function prepararLeadQuenteSombra(
  env: Record<string, string | undefined>,
  contexto: { dataDir: string; operations: boolean; telegramLigado: boolean; copilotoLigado: boolean },
  fontes: Pick<DepsDoLeadQuente, "lerVisao" | "lerConversa" | "sugestoes" | "avisar">,
  opcoes: { log?: Logger } = {},
): LeadQuenteSombra | null {
  const log = opcoes.log ?? console;
  let config: ConfigDoLeadQuente;
  try {
    config = lerConfigDoLeadQuente(env);
  } catch (err: any) {
    log.error(`[lead-quente] sombra desligada: ${err?.message ?? err}`);
    return null;
  }
  if (!config.ligada) return null;
  if (!contexto.operations) {
    log.log("[lead-quente] SQUADONE_LEAD_QUENTE_SOMBRA ignorada: só no perfil operations");
    return null;
  }
  if (!contexto.telegramLigado) {
    log.error("[lead-quente] SQUADONE_LEAD_QUENTE_SOMBRA=true sem o bot do Telegram: desligada.");
    return null;
  }
  if (!contexto.copilotoLigado) {
    log.error("[lead-quente] SQUADONE_LEAD_QUENTE_SOMBRA=true sem o copiloto (SQUADONE_COPILOTO=true): o texto da resposta é dele. Desligada.");
    return null;
  }
  const dir = path.join(contexto.dataDir, "lead-quente-sombra");
  log.log(`[lead-quente] sombra ligada: até ${config.tetoDia} avisos/dia, cala ${config.horasDeCalar} h depois de você escrever, registro em ${dir}; nunca envia ao lead.`);
  return criarLeadQuenteSombra({ ...fontes, dir, tetoDia: config.tetoDia, horasDeCalar: config.horasDeCalar, log });
}
