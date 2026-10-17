/**
 * O vendedor (16/10/2026, pedido do Rômulo: "podia ser mais proativo, um aviso 'Envie mensagem para
 * xpto' com tudo já organizado, só pra eu revisar"). De segunda a sexta, das 08:00 às 17:30, ele
 * olha a fila de venda (src/operations/proxima-venda.ts) a cada minuto e manda no Telegram UMA
 * próxima ação por vez: quem é, por quê, como vender nesse momento e a mensagem pronta, com
 * "Abrir no WhatsApp" (o texto já preenchido), "Enviei" e "Pular".
 *
 * Semi-automático por decisão de 16/10/2026: nada sai para o lead sem o toque dele no WhatsApp. A
 * API não oficial (Evolution) ficou de fora porque o número é o mesmo do Hermes e acabou de levar
 * restrição; o vendedor só tira o trabalho de achar, ordenar e escrever.
 *
 * Telegram e não a fila de avisos do Hermes (RULES 20, exceção de 16/10/2026): o aviso de venda
 * precisa de botões (abrir o WhatsApp, anotar o envio) e sai até dezenas de vezes por dia; pela
 * fila ele iria pelo mesmo número que fala com os leads.
 *
 * Ritmo: um aviso aberto por vez. O próximo só sai depois de "Enviei"/"Pular", de a ação sumir da
 * fila (o retrato confirmou) ou de 30 min sem toque (vale como pular). Exceção: alguém que acabou
 * de dizer "quero ver" fura a espera. Primeiro contato passa pela trava de ritmo
 * (trava-de-ritmo.ts), contando também os "Enviei" que o retrato ainda não viu.
 *
 * O servidor é a fonte única do dia (17/10/2026, AC-06, server/venda-do-dia.ts): o que a Central
 * resolve fecha o aviso aberto aqui na volta seguinte (a mensagem perde os botões e diz "Feito na
 * Central"), o aviso que expira vira pulado também lá, a anotação no CRM sai uma vez por ação (o
 * "Enviei" atrasado responde "Já estava feito.") e a trava de ritmo soma os primeiros contatos das
 * duas superfícies. Diferença que fica: aqui o primeiro contato conta no "Enviei" (o botão de link do
 * Telegram abre o WhatsApp sem passar pelo bot); na Central, no toque do link.
 *
 * `decidir` é PURO (estado + fila + relógio -> o que fazer); o resto é a cola com o CRM, o
 * Telegram e o arquivo de estado.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { esperaOCopiloto, filaDeVenda, noExpedienteDeVenda, resumoDaFila, type AcaoDeVenda, type SugestaoDeVenda } from "../src/operations/proxima-venda.ts";
import { instantesDePrimeiroContato, ritmoDoEnvio, somarPrimeiros } from "../src/operations/trava-de-ritmo.ts";
import type { CrmVisao } from "../src/operations/types.ts";
import type { Botao } from "./telegram.ts";
import { dadosDaVenda } from "./telegram-entrada.ts";
import type { MemoriaDaVenda, Resolvida, VendaDoDia } from "./venda-do-dia.ts";

export const ESPERA_DO_AVISO_MS = 30 * 60_000;
export const MAX_AVISOS_POR_DIA = 40;
export const INTERVALO_DO_VENDEDOR_MS = 60_000;
/**
 * Quanto o aviso espera a mensagem do copiloto (que leu a conversa) antes de sair com o texto pronto
 * da esteira: uma geração do codex leva de 30 s a 2 min; mais que isso, a pressa do "quero ver" vence.
 */
export const ESPERA_DO_COPILOTO_MS = 4 * 60_000;

export interface AvisoAberto {
  chave: string;
  token: string;
  em: number;
  leadId: string;
  primeiroContato: boolean;
  anota?: AcaoDeVenda["anota"];
  produto: AcaoDeVenda["produto"];
  /** O texto da mensagem do Telegram, para o toque editar sem reler a fila. */
  texto: string;
  /** Para o histórico (OT-09): que passo era e se era um "quero ver". Ausente em estado antigo. */
  tipo?: AcaoDeVenda["tipo"];
  quente?: boolean;
  /**
   * Onde a mensagem caiu (17/10/2026, AC-06): para a volta tirar os botões quando a Central resolve
   * ou o aviso expira. Ausente em estado antigo: aí só o toque edita (como antes).
   */
  mensagens?: MensagemDoAviso[];
}

export interface MensagemDoAviso {
  chatId: number;
  mensagemId: number;
}

export interface EstadoDoVendedor {
  /** AAAA-MM-DD de São Paulo: virou o dia, zera. */
  dia: string;
  /** Chaves já avisadas hoje (não repetem). */
  avisados: string[];
  pulados: string[];
  abertos: AvisoAberto[];
  /**
   * leadId -> instante (ms) do "Enviei" de um primeiro contato. Desde 17/10/2026 (AC-06) a fonte é o
   * venda-do-dia.json (os das duas superfícies); este fica para ler o vendedor.json de antes e para
   * quando o servidor do dia falha, e a trava soma os dois sem repetir o lead (somarPrimeiros).
   */
  primeiros: Record<string, number>;
  enviadosHoje: number;
}

export const diaDeSP = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);

export function estadoNovo(agora: number): EstadoDoVendedor {
  return { dia: diaDeSP(agora), avisados: [], pulados: [], abertos: [], primeiros: {}, enviadosHoje: 0 };
}

/** O estado lido, ou um novo se é de outro dia ou ilegível. */
export function estadoDoDia(lido: unknown, agora: number): EstadoDoVendedor {
  const e = lido as Partial<EstadoDoVendedor> | null;
  if (!e || e.dia !== diaDeSP(agora) || !Array.isArray(e.avisados) || !Array.isArray(e.abertos)) return estadoNovo(agora);
  return {
    dia: e.dia,
    avisados: e.avisados.filter((c) => typeof c === "string"),
    pulados: Array.isArray(e.pulados) ? e.pulados.filter((c) => typeof c === "string") : [],
    abertos: e.abertos.filter((a) => a && typeof a.chave === "string" && typeof a.token === "string" && Number.isFinite(a.em)),
    primeiros: e.primeiros && typeof e.primeiros === "object" ? e.primeiros : {},
    enviadosHoje: Number.isFinite(e.enviadosHoje) ? Number(e.enviadosHoje) : 0,
  };
}

export type Decisao =
  | { tipo: "nada"; motivo: "fora-do-expediente" | "esperando-toque" | "fila-vazia" | "teto-do-dia" | "esperando-copiloto" }
  | { tipo: "avisar"; acao: AcaoDeVenda; depois: AcaoDeVenda[] };

/** O que o servidor lembra do dia (server/venda-do-dia.ts): o vendedor lê só isto. */
export type DoDia = Pick<VendaDoDia, "resolvidas" | "primeiros"> & Partial<Pick<VendaDoDia, "anotadas">>;

/** Os avisos que fecharam numa volta sem toque no Telegram, cada um pelo seu motivo. */
export interface Fechados {
  /** Resolvidos por fora (a Central) depois de o aviso sair: a mensagem perde os botões e diz onde. */
  fora: Array<{ aberto: AvisoAberto; resolvida: Resolvida }>;
  /** 30 min sem toque: vale como pular, também para a Central (resolver ... "expirou"). */
  expirados: AvisoAberto[];
  /** A ação saiu da fila (o retrato confirmou, ou deixou de valer). */
  sairam: AvisoAberto[];
}

/**
 * PURO (17/10/2026, AC-06): quem dos avisos abertos fecha agora, e por quê. A ordem importa: o que a
 * Central resolveu depois de o aviso sair vem antes de "saiu da fila" e de "expirou", para a mensagem
 * do Telegram dizer "Feito na Central" em vez de ficar com botões até os 30 min (e um "Enviei"
 * atrasado anotar de novo). Resolvida ANTES do aviso não fecha: foi um "Pular" na Central, e a ação
 * voltou do fim da fila depois.
 */
export function limparAbertos(abertos: readonly AvisoAberto[], naFila: ReadonlySet<string>,
  resolvidas: Readonly<Record<string, Resolvida>>, agora: number): { ficam: AvisoAberto[]; fechados: Fechados } {
  const fechados: Fechados = { fora: [], expirados: [], sairam: [] };
  const ficam: AvisoAberto[] = [];
  for (const a of abertos) {
    const r = resolvidas[a.chave];
    if (r && r.em >= a.em && r.por !== "expirou") fechados.fora.push({ aberto: a, resolvida: r });
    else if (!naFila.has(a.chave)) fechados.sairam.push(a);
    else if (agora - a.em >= ESPERA_DO_AVISO_MS) fechados.expirados.push(a);
    else ficam.push(a);
  }
  return { ficam, fechados };
}

/** PURO: o rodapé da mensagem que fechou por fora, sem botões. */
export function rodapeDeFora(r: Pick<Resolvida, "como" | "por">): string {
  const onde = r.por === "telegram" ? "" : " na Central";
  if (r.como === "pulada") return `⏭ Pulado${onde}.`;
  if (r.como === "recusa") return `✅ Recusa marcada${onde}.`;
  return `✅ Feito${onde}.`;
}

export const RODAPE_DO_EXPIRADO = "⌛ 30 min sem toque: fica para o fim da fila.";

/**
 * O que fazer agora. Também limpa o estado (limparAbertos): o que a Central resolveu fecha, o que
 * saiu da fila fecha, o aberto há mais de 30 min sem toque vira pulado. `sugestoes`: as do copiloto
 * que valem para a conversa de agora (leadId -> mensagem); entram no lugar do texto pronto. `doDia`:
 * o que a Central e o Telegram resolveram hoje e os primeiros contatos das duas superfícies (a trava
 * de ritmo conta o retrato mais esses, sem repetir o lead).
 */
export function decidir(visao: Pick<CrmVisao, "hoje" | "leads"> | null, estadoLido: EstadoDoVendedor, agora: number,
  sugestoes?: ReadonlyMap<string, SugestaoDeVenda>, doDia?: DoDia | null): { decisao: Decisao; estado: EstadoDoVendedor; fechados: Fechados } {
  const resolvidas = doDia?.resolvidas ?? {};
  const entradas = Object.entries(resolvidas);
  // O que se resolveu hoje conta aqui: enviado ou recusa marcada é como avisado; pulado vai para o fim.
  const estado: EstadoDoVendedor = {
    ...estadoLido,
    abertos: [...estadoLido.abertos],
    avisados: [...new Set([...estadoLido.avisados, ...entradas.filter(([, r]) => r.como !== "pulada").map(([c]) => c)])],
    pulados: [...new Set([...estadoLido.pulados, ...entradas.filter(([, r]) => r.como === "pulada").map(([c]) => c)])],
  };
  const nada: Fechados = { fora: [], expirados: [], sairam: [] };
  if (!noExpedienteDeVenda(agora)) return { decisao: { tipo: "nada", motivo: "fora-do-expediente" }, estado, fechados: nada };
  const toques = somarPrimeiros(doDia?.primeiros, estado.primeiros);
  const ritmo = ritmoDoEnvio(instantesDePrimeiroContato(visao?.leads ?? [], toques), agora);
  const fila = filaDeVenda(visao, { primeiroLiberado: ritmo.motivo === null, agora, ...(sugestoes ? { sugestoes } : {}) }, new Set(estado.pulados));
  const { ficam, fechados } = limparAbertos(estado.abertos, new Set(fila.map((a) => a.chave)), resolvidas, agora);
  estado.abertos = ficam;
  for (const a of fechados.expirados) if (!estado.pulados.includes(a.chave)) estado.pulados.push(a.chave);
  if (estado.avisados.length >= MAX_AVISOS_POR_DIA) return { decisao: { tipo: "nada", motivo: "teto-do-dia" }, estado, fechados };
  const avisados = new Set(estado.avisados);
  const novas = fila.filter((a) => !avisados.has(a.chave));
  if (!novas.length) return { decisao: { tipo: "nada", motivo: "fila-vazia" }, estado, fechados };
  // Um aviso aberto por vez, menos o "quero ver" que acabou de chegar: `quente` vem da fila (proxima-venda.ts)
  // e vale para o interesse E para a licença (pedeMaterial), que até 17/10 era gravada como interesse.
  const proxima = estado.abertos.length ? novas.find((a) => a.tipo === "responder" && a.quente) : novas[0];
  if (!proxima) return { decisao: { tipo: "nada", motivo: "esperando-toque" }, estado, fechados };
  return { decisao: { tipo: "avisar", acao: proxima, depois: fila.filter((a) => a.chave !== proxima.chave) }, estado, fechados };
}

export type Toque =
  | { tipo: "ja-feito"; curto: string; rodape: string }
  | { tipo: "seguir"; como: "enviada" | "pulada" | "recusa"; anotar: boolean };

/**
 * PURO (17/10/2026, AC-06): o toque em "Enviei"/"Pular" de um aviso ainda aberto, contra o que o
 * servidor sabe do dia. A Central pode ter resolvido entre o aviso e o toque (a volta que fecharia a
 * mensagem ainda não passou): enviado ou recusa marcada lá = "Já estava feito.", sem anotar de novo.
 * Pulado lá e "Enviei" aqui: ele mandou mesmo, vale o Enviei (a última decisão vale). A anotação é
 * uma por chave + tipo no dia: já saiu pela Central no toque do link, o "Enviei" não a repete.
 */
export function toqueNoAviso(aberto: Pick<AvisoAberto, "chave" | "em" | "anota" | "tipo">, acao: "enviei" | "pular", doDia?: DoDia | null): Toque {
  const r = doDia?.resolvidas[aberto.chave];
  const porFora = r && r.em >= aberto.em && r.por !== "telegram" && r.por !== "expirou" ? r : undefined;
  if (porFora && (porFora.como !== "pulada" || acao === "pular")) {
    return { tipo: "ja-feito", curto: porFora.como === "pulada" ? "Já estava pulado." : "Já estava feito.", rodape: rodapeDeFora(porFora) };
  }
  if (acao === "pular") return { tipo: "seguir", como: "pulada", anotar: false };
  const anotada = Boolean(aberto.anota && (doDia?.anotadas?.[aberto.chave] ?? []).some((a) => a.tipo === aberto.anota));
  return { tipo: "seguir", como: aberto.tipo === "desfecho" ? "recusa" : "enviada", anotar: Boolean(aberto.anota) && !anotada };
}

// ---------------------------------------------------------------- o histórico (OT-09)

/**
 * Medir o vendedor (16/10/2026, OT-09 do blueprint): o estado do dia some à meia-noite, então "a
 * proatividade acelerou a resposta?" não tinha número. Cada aviso e o que aconteceu com ele vira uma
 * linha em `vendedor-historico.jsonl` (600, ao lado do vendedor.json): sem texto, sem telefone, só
 * a chave da ação, o passo e os instantes. Poda em 180 dias, na gravação.
 */
export type EventoDoVendedor = {
  em: number;
  /** "central": a Próxima venda resolveu a ação com o aviso aberto (17/10/2026, AC-06). */
  evento: "avisado" | "enviei" | "pulou" | "expirou" | "saiu" | "central";
  chave: string;
  tipo?: AcaoDeVenda["tipo"];
  quente?: boolean;
  /** Do aviso ao toque (enviei/pulou) ou ao fim (expirou/saiu), em ms. */
  esperaMs?: number;
};

export const DIAS_DO_HISTORICO = 180;

export interface ResumoDoVendedor {
  dias: number;
  avisos: number;
  enviei: number;
  pulou: number;
  /** 30 min sem toque: vale como pular. */
  expirou: number;
  /** Saiu da fila antes do toque (o retrato confirmou o envio, a ação deixou de valer, ou a Central a resolveu). */
  saiu: number;
  /** Do aviso ao "Enviei", em minutos (mediana). */
  medianaAteEnvieiMin: number | null;
  /** Só os "quero ver" (quente: interesse ou licença, pedeMaterial): quantos e a mediana até o "Enviei". */
  quentes: { avisos: number; enviei: number; medianaAteEnvieiMin: number | null };
}

const medianaDe = (v: number[]): number | null => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/** PURO: o resumo dos últimos `dias`. */
export function resumoDoVendedor(eventos: readonly EventoDoVendedor[], agora: number, dias = 30): ResumoDoVendedor {
  const recentes = eventos.filter((e) => e.em >= agora - dias * 86_400_000 && e.em <= agora);
  const de = (t: EventoDoVendedor["evento"]) => recentes.filter((e) => e.evento === t);
  const minutos = (es: EventoDoVendedor[]) => medianaDe(es.flatMap((e) => (Number.isFinite(e.esperaMs) ? [Number(e.esperaMs) / 60_000] : [])));
  const enviei = de("enviei");
  return {
    dias,
    avisos: de("avisado").length,
    enviei: enviei.length,
    pulou: de("pulou").length,
    expirou: de("expirou").length,
    // A Central resolveu com o aviso aberto: também é "resolvido por fora" na tela dos Resultados.
    saiu: de("saiu").length + de("central").length,
    medianaAteEnvieiMin: minutos(enviei),
    quentes: {
      avisos: de("avisado").filter((e) => e.quente).length,
      enviei: enviei.filter((e) => e.quente).length,
      medianaAteEnvieiMin: minutos(enviei.filter((e) => e.quente)),
    },
  };
}

/** PURO: os avisos que fecharam numa volta sem toque (a Central resolveu, o retrato confirmou, ou 30 min sem toque). */
export function fechadosNaVolta(fechados: Fechados, agora: number): EventoDoVendedor[] {
  const evento = (a: AvisoAberto, e: EventoDoVendedor["evento"]): EventoDoVendedor => ({
    em: agora,
    evento: e,
    chave: a.chave,
    ...(a.tipo ? { tipo: a.tipo } : {}),
    ...(a.quente ? { quente: true } : {}),
    esperaMs: agora - a.em,
  });
  return [
    ...fechados.fora.map((f) => evento(f.aberto, "central")),
    ...fechados.expirados.map((a) => evento(a, "expirou")),
    ...fechados.sairam.map((a) => evento(a, "saiu")),
  ];
}

/** Lê o histórico; linha ilegível é pulada (um arquivo cortado não zera a medida). */
export async function lerHistoricoDoVendedor(arquivo: string): Promise<EventoDoVendedor[]> {
  let bruto: string;
  try {
    bruto = await fs.readFile(arquivo, "utf8");
  } catch {
    return [];
  }
  const eventos: EventoDoVendedor[] = [];
  for (const linha of bruto.split("\n")) {
    if (!linha.trim()) continue;
    try {
      const e = JSON.parse(linha);
      if (e && Number.isFinite(e.em) && typeof e.evento === "string" && typeof e.chave === "string") eventos.push(e);
    } catch { /* linha cortada */ }
  }
  return eventos;
}

async function anotarNoHistorico(arquivo: string | undefined, eventos: EventoDoVendedor[], agora: number): Promise<void> {
  if (!arquivo || !eventos.length) return;
  try {
    await fs.mkdir(path.dirname(arquivo), { recursive: true });
    const antigos = await lerHistoricoDoVendedor(arquivo);
    const limite = agora - DIAS_DO_HISTORICO * 86_400_000;
    const podar = antigos.length > 0 && antigos[0].em < limite;
    if (podar) {
      const tmp = `${arquivo}.tmp`;
      const ficam = [...antigos.filter((e) => e.em >= limite), ...eventos];
      await fs.writeFile(tmp, ficam.map((e) => JSON.stringify(e)).join("\n") + "\n", { mode: 0o600 });
      await fs.rename(tmp, arquivo);
    } else {
      await fs.appendFile(arquivo, eventos.map((e) => JSON.stringify(e)).join("\n") + "\n", { mode: 0o600 });
    }
  } catch (err) {
    // Medir nunca derruba o vendedor.
    console.warn(`[vendedor] histórico não gravado: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------- o texto do Telegram

const MAX_RASCUNHO = 2500;

/** Texto puro (sem parse_mode), como todo o bot. */
export function textoDoAviso(acao: AcaoDeVenda, depois: readonly AcaoDeVenda[]): string {
  const linhas = [
    `${acao.quente ? "🔥" : "📨"} ${acao.titulo}`,
    acao.contexto,
    "",
    acao.porque,
    ...(acao.conversa ? ["", `💬 ${acao.conversa}`] : []),
    ...(acao.copiloto?.momento ? ["", `🧭 Leitura do copiloto: ${acao.copiloto.momento.leitura}`] : []),
    "",
    `${acao.copiloto?.momento?.passo ? "Agora" : "Como"}: ${acao.tatica}`,
  ];
  if (acao.rascunho) {
    const r = acao.rascunho.length > MAX_RASCUNHO ? `${acao.rascunho.slice(0, MAX_RASCUNHO)}…` : acao.rascunho;
    const titulo = acao.copiloto
      ? `Sugestão do copiloto, que leu a conversa (revise antes de enviar):${acao.copiloto.porque ? `\n${acao.copiloto.porque}` : ""}`
      : "Mensagem pronta (revise antes de enviar):";
    linhas.push("", titulo, "――――", r, "――――");
  } else {
    linhas.push("", "Sem texto pronto: escreva à mão (a colinha da ficha ajuda).");
  }
  const resto = resumoDaFila(depois);
  if (resto) linhas.push("", `Depois desta: ${resto}`);
  return linhas.join("\n");
}

export function botoesDoAviso(acao: AcaoDeVenda, token: string, origemCentral?: string): Botao[][] {
  const linhas: Botao[][] = [];
  // O desfecho (OT-06): o toque principal é marcar a recusa; o agradecimento no WhatsApp é opcional.
  const desfecho = acao.tipo === "desfecho";
  if (acao.link) linhas.push([{ texto: desfecho ? acao.link.rotulo : acao.rascunho ? "Abrir no WhatsApp com a mensagem" : "Abrir a conversa no WhatsApp", url: acao.link.url }]);
  linhas.push([{ texto: desfecho ? "✓ Marcar a recusa" : "✓ Enviei", dados: dadosDaVenda(token, "enviei") }, { texto: "Pular", dados: dadosDaVenda(token, "pular") }]);
  if (origemCentral) linhas.push([{ texto: "Ver a ficha", url: `${origemCentral.replace(/\/$/, "")}/crm?lead=${encodeURIComponent(acao.leadId)}` }]);
  return linhas;
}

// ---------------------------------------------------------------- a cola

export interface DepsDoVendedor {
  lerVisao(): Promise<CrmVisao>;
  /** Devolve onde cada mensagem caiu, para a volta editar depois; sem isso, só o toque edita. */
  enviar(texto: string, botoes: Botao[][]): Promise<MensagemDoAviso[] | void>;
  /** Troca o texto e tira os botões (editMessageText sem reply_markup). Ausente: não fecha por fora. */
  editar?(chatId: number, mensagemId: number, texto: string): Promise<void>;
  /** POST do registro na aba CRM (o mesmo da Ficha): só para o que o link não marca sozinho. */
  registrar(corpo: { produto: string; id: string; tipo: string; texto: ""; data: "" }): Promise<void>;
  arquivoDeEstado: string;
  /** O histórico de avisos e toques (OT-09). Ausente: não mede. */
  arquivoDeHistorico?: string;
  /**
   * O dia dividido com a Próxima venda da Central (OT-01 e AC-06, server/venda-do-dia.ts): o que se
   * resolveu, as anotações e os primeiros contatos. Ausente: só o estado próprio (como antes).
   */
  vendaDoDia?: MemoriaDaVenda;
  origemCentral?: string;
  agora(): number;
  /**
   * O copiloto (opcional, 16/10/2026): as sugestões que valem para a conversa de agora e o pedido de
   * uma, em segundo plano, para o lead do próximo aviso. `pedir` = true: está gerando (vale esperar).
   */
  copiloto?: {
    prontas(visao: CrmVisao): Promise<ReadonlyMap<string, SugestaoDeVenda>>;
    pedir(leadId: string, visao: CrmVisao): Promise<boolean>;
  };
}

export interface Vendedor {
  iniciar(): void;
  parar(): void;
  /** Uma volta (o laço chama; o teste também). */
  volta(): Promise<Decisao>;
  tocar(token: string, acao: "enviei" | "pular"): Promise<{ curto: string; texto?: string }>;
}

export function criarVendedor(deps: DepsDoVendedor): Vendedor {
  let relogio: ReturnType<typeof setInterval> | null = null;
  // A volta logo depois de um toque (a próxima vem já); `parar` também a cancela.
  let proximaJa: ReturnType<typeof setTimeout> | null = null;
  const mandarAProximaJa = () => {
    if (proximaJa) clearTimeout(proximaJa);
    proximaJa = setTimeout(() => { proximaJa = null; void emSerie(voltaSemFila).catch(registrarFalha); }, 1500);
  };
  // chave da ação -> desde quando o aviso espera a sugestão do copiloto (só em memória: reiniciar zera).
  const esperandoCopiloto = new Map<string, number>();
  // Uma volta ou um toque por vez: os dois leem e gravam o mesmo estado.
  let fila: Promise<unknown> = Promise.resolve();
  const emSerie = <T>(f: () => Promise<T>): Promise<T> => {
    const p = fila.then(f, f);
    fila = p.catch(() => undefined);
    return p;
  };

  async function lerEstado(): Promise<EstadoDoVendedor> {
    try {
      return estadoDoDia(JSON.parse(await fs.readFile(deps.arquivoDeEstado, "utf8")), deps.agora());
    } catch {
      return estadoNovo(deps.agora());
    }
  }
  async function gravarEstado(e: EstadoDoVendedor): Promise<void> {
    await fs.mkdir(path.dirname(deps.arquivoDeEstado), { recursive: true });
    const tmp = `${deps.arquivoDeEstado}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(e), { mode: 0o600 });
    await fs.rename(tmp, deps.arquivoDeEstado);
  }

  /** O dia do servidor; falhou a leitura, segue com o estado próprio (null), como antes do AC-06. */
  async function lerDoDia(): Promise<VendaDoDia | null> {
    if (!deps.vendaDoDia) return null;
    return deps.vendaDoDia.ler().catch((err) => {
      console.warn(`[vendedor] o dia do servidor não foi lido: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
  }

  /** Tira os botões das mensagens de um aviso que fechou sem toque. Falhar não segura a volta. */
  async function fecharMensagens(aberto: AvisoAberto, rodape: string): Promise<void> {
    if (!deps.editar || !Array.isArray(aberto.mensagens)) return;
    for (const m of aberto.mensagens) {
      if (!Number.isFinite(m?.chatId) || !Number.isFinite(m?.mensagemId)) continue;
      await deps.editar(m.chatId, m.mensagemId, `${aberto.texto}\n\n${rodape}`).catch((err) => {
        console.warn(`[vendedor] não tirei os botões do aviso: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  /** A anotação do "Enviei": uma vez por chave + tipo no dia, pela memória do servidor quando há. */
  async function anotarDoToque(aberto: AvisoAberto & { anota: NonNullable<AvisoAberto["anota"]> }): Promise<"anotou" | "ja-estava"> {
    const corpo = { produto: aberto.produto, id: aberto.leadId.slice(aberto.leadId.indexOf(":") + 1), tipo: aberto.anota, texto: "" as const, data: "" as const };
    if (!deps.vendaDoDia) {
      await deps.registrar(corpo);
      return "anotou";
    }
    const r = await deps.vendaDoDia.anotarUmaVez(aberto.chave, aberto.anota, "telegram", () => deps.registrar(corpo));
    return r.anotou ? "anotou" : "ja-estava";
  }

  async function voltaSemFila(): Promise<Decisao> {
    const agora = deps.agora();
    const lido = await lerEstado();
    if (!noExpedienteDeVenda(agora)) {
      if (lido.dia !== estadoNovo(agora).dia) await gravarEstado(estadoNovo(agora));
      return { tipo: "nada", motivo: "fora-do-expediente" };
    }
    const visao = await deps.lerVisao();
    if (visao.estado !== "ok") return { tipo: "nada", motivo: "fila-vazia" };
    const sugestoes = deps.copiloto ? await deps.copiloto.prontas(visao).catch(() => undefined) : undefined;
    const doDia = await lerDoDia();
    const { decisao, estado, fechados } = decidir(visao, lido, agora, sugestoes, doDia);
    const historico = fechadosNaVolta(fechados, agora);
    // O que a Central resolveu fecha aqui também; o que expirou vale como pular lá (AC-06).
    for (const { aberto, resolvida } of fechados.fora) await fecharMensagens(aberto, rodapeDeFora(resolvida));
    for (const aberto of fechados.expirados) {
      await fecharMensagens(aberto, RODAPE_DO_EXPIRADO);
      await deps.vendaDoDia?.resolver(aberto.chave, "pulada", "expirou").catch((err) => {
        console.warn(`[vendedor] a Central não soube do aviso expirado: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    if (decisao.tipo === "avisar" && deps.copiloto && esperaOCopiloto(decisao.acao)) {
      // A mensagem certa vem de quem leu a conversa: pede ao copiloto e segura o aviso uns minutos.
      const gerando = await deps.copiloto.pedir(decisao.acao.leadId, visao).catch(() => false);
      const desde = esperandoCopiloto.get(decisao.acao.chave) ?? agora;
      if (gerando && agora - desde < ESPERA_DO_COPILOTO_MS) {
        esperandoCopiloto.set(decisao.acao.chave, desde);
        await gravarEstado(estado);
        await anotarNoHistorico(deps.arquivoDeHistorico, historico, agora);
        return { tipo: "nada", motivo: "esperando-copiloto" };
      }
    }
    if (decisao.tipo === "avisar") {
      esperandoCopiloto.delete(decisao.acao.chave);
      const token = randomBytes(6).toString("hex");
      const texto = textoDoAviso(decisao.acao, decisao.depois);
      const mensagens = await deps.enviar(texto, botoesDoAviso(decisao.acao, token, deps.origemCentral));
      estado.avisados.push(decisao.acao.chave);
      estado.abertos.push({
        chave: decisao.acao.chave, token, em: agora, leadId: decisao.acao.leadId, primeiroContato: decisao.acao.primeiroContato,
        produto: decisao.acao.produto, texto, ...(decisao.acao.anota ? { anota: decisao.acao.anota } : {}),
        tipo: decisao.acao.tipo, ...(decisao.acao.quente ? { quente: true } : {}),
        ...(Array.isArray(mensagens) && mensagens.length ? { mensagens } : {}),
      });
      historico.push({ em: agora, evento: "avisado", chave: decisao.acao.chave, tipo: decisao.acao.tipo, ...(decisao.acao.quente ? { quente: true } : {}) });
    }
    await gravarEstado(estado);
    await anotarNoHistorico(deps.arquivoDeHistorico, historico, agora);
    return decisao;
  }

  async function tocarSemFila(token: string, acao: "enviei" | "pular"): Promise<{ curto: string; texto?: string }> {
    const agora = deps.agora();
    const estado = await lerEstado();
    const aberto = estado.abertos.find((a) => a.token === token);
    if (!aberto) return { curto: "Este aviso já fechou." };
    estado.abertos = estado.abertos.filter((a) => a.token !== token);
    const toque = toqueNoAviso(aberto, acao, await lerDoDia());
    if (toque.tipo === "ja-feito") {
      // A Central resolveu antes deste toque: fecha a mensagem, sem anotar nem resolver de novo.
      await gravarEstado(estado);
      await anotarNoHistorico(deps.arquivoDeHistorico, [{
        em: agora, evento: "central", chave: aberto.chave, esperaMs: agora - aberto.em,
        ...(aberto.tipo ? { tipo: aberto.tipo } : {}), ...(aberto.quente ? { quente: true } : {}),
      }], agora);
      mandarAProximaJa();
      return { curto: toque.curto, texto: `${aberto.texto}\n\n${toque.rodape}` };
    }
    let rodape: string;
    if (toque.como === "pulada") {
      if (!estado.pulados.includes(aberto.chave)) estado.pulados.push(aberto.chave);
      rodape = "⏭ Pulado por hoje.";
    } else {
      estado.enviadosHoje++;
      if (aberto.primeiroContato) {
        // vendedor.json fica de reserva; quem as duas superfícies leem é o servidor do dia.
        estado.primeiros[aberto.leadId] = agora;
        await deps.vendaDoDia?.primeiroContato(aberto.leadId, "telegram").catch((err) => {
          console.warn(`[vendedor] a Central não soube do primeiro contato: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
      rodape = "✅ Enviado.";
      if (aberto.anota && toque.anotar) {
        try {
          rodape = (await anotarDoToque({ ...aberto, anota: aberto.anota })) === "anotou"
            ? "✅ Enviado e anotado no CRM." : "✅ Enviado (já estava anotado no CRM).";
        } catch (err) {
          console.warn(`[vendedor] anotação falhou: ${err instanceof Error ? err.message : String(err)}`);
          rodape = "✅ Enviado. ⚠️ Não consegui anotar no CRM: anote na ficha.";
        }
      } else if (aberto.anota) {
        rodape = "✅ Enviado (já estava anotado no CRM).";
      }
    }
    await gravarEstado(estado);
    await deps.vendaDoDia?.resolver(aberto.chave, toque.como, "telegram").catch((err) => {
      console.warn(`[vendedor] a Central não soube do toque: ${err instanceof Error ? err.message : String(err)}`);
    });
    await anotarNoHistorico(deps.arquivoDeHistorico, [{
      em: agora, evento: acao === "pular" ? "pulou" : "enviei", chave: aberto.chave, esperaMs: agora - aberto.em,
      ...(aberto.tipo ? { tipo: aberto.tipo } : {}), ...(aberto.quente ? { quente: true } : {}),
    }], agora);
    // A próxima vem já, sem esperar o minuto do laço.
    mandarAProximaJa();
    return { curto: acao === "pular" ? "Pulado. Mandando a próxima." : "Anotado. Mandando a próxima.", texto: `${aberto.texto}\n\n${rodape}` };
  }

  const registrarFalha = (err: unknown) => console.error(`[vendedor] volta falhou: ${err instanceof Error ? err.message : String(err)}`);

  return {
    iniciar() {
      if (relogio) return;
      relogio = setInterval(() => { void emSerie(voltaSemFila).catch(registrarFalha); }, INTERVALO_DO_VENDEDOR_MS);
      void emSerie(voltaSemFila).catch(registrarFalha);
    },
    parar() {
      if (relogio) clearInterval(relogio);
      if (proximaJa) clearTimeout(proximaJa);
      relogio = null;
      proximaJa = null;
    },
    volta: () => emSerie(voltaSemFila),
    tocar: (token, acao) => emSerie(() => tocarSemFila(token, acao)),
  };
}
