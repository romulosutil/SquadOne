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
import { comHistoricoConferido } from "../src/operations/historico-comercial.ts";
import type { Botao } from "./telegram.ts";
import { dadosDaVenda } from "./telegram-entrada.ts";
import type { MemoriaDaVenda, Resolvida, VendaDoDia } from "./venda-do-dia.ts";
import { conferirMensagem, resumoDosProblemas, type ResultadoDoGate, type TipoDeMensagem } from "./gate-de-envio.ts";
import { criarEmSerie } from "./em-serie.ts";

export const ESPERA_DO_AVISO_MS = 30 * 60_000;
/**
 * Teto de avisos que de fato saíram no Telegram no dia (`avisosHoje`). Não conta o que a Central resolveu
 * nem o aviso barrado pelo gate, e o "quero ver" quente passa por cima dele: o teto existe para o volume
 * de rotina não afogar o Rômulo, não para calar quem acabou de pedir o material.
 */
export const MAX_AVISOS_POR_DIA = 40;
/** Quantas gravações seguidas do estado podem falhar antes de o laço parar (avisar sem gravar reenvia a cada minuto). */
export const MAX_FALHAS_DE_GRAVACAO = 3;
export const INTERVALO_DO_VENDEDOR_MS = 60_000;
/**
 * Quanto o aviso espera a mensagem do copiloto (que leu a conversa) antes de sair com o texto pronto
 * da esteira: uma geração do codex leva de 30 s a 2 min; mais que isso, a pressa do "quero ver" vence.
 */
export const ESPERA_DO_COPILOTO_MS = 4 * 60_000;

export interface AvisoAberto {
  conferirHistorico?: boolean;
  chave: string;
  token: string;
  em: number;
  leadId: string;
  primeiroContato: boolean;
  anota?: AcaoDeVenda["anota"];
  textoDoRegistro?: string;
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
  enviadosHoje: number;
  /** Avisos que de fato saíram no Telegram hoje: o teto (MAX_AVISOS_POR_DIA) conta este, não `avisados`. */
  avisosHoje: number;
}

export const silencioDoVendedor = (ms: number) => { const h = new Date(ms - 3 * 3600_000).getUTCHours(); return h >= 22 || h < 7; };

export const diaDeSP = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);

export function estadoNovo(agora: number): EstadoDoVendedor {
  return { dia: diaDeSP(agora), avisados: [], pulados: [], abertos: [], enviadosHoje: 0, avisosHoje: 0 };
}

/** O estado lido, ou um novo se é de outro dia ou ilegível. */
export function estadoDoDia(lido: unknown, agora: number): EstadoDoVendedor {
  const e = lido as Partial<EstadoDoVendedor> | null;
  if (!e || e.dia !== diaDeSP(agora) || !Array.isArray(e.avisados) || !Array.isArray(e.abertos)) return estadoNovo(agora);
  const avisados = e.avisados.filter((c) => typeof c === "string");
  return {
    dia: e.dia,
    avisados,
    pulados: Array.isArray(e.pulados) ? e.pulados.filter((c) => typeof c === "string") : [],
    abertos: e.abertos.filter((a) => a && typeof a.chave === "string" && typeof a.token === "string" && Number.isFinite(a.em)),
    enviadosHoje: Number.isFinite(e.enviadosHoje) ? Number(e.enviadosHoje) : 0,
    // Estado de antes do campo: `avisados` é o teto mais conservador (soma o que a Central resolveu) até o dia virar.
    avisosHoje: Number.isFinite(e.avisosHoje) ? Number(e.avisosHoje) : avisados.length,
  };
}

export type Decisao =
  | { tipo: "nada"; motivo: "fora-do-expediente" | "esperando-toque" | "fila-vazia" | "teto-do-dia" | "esperando-copiloto" | "mensagem-barrada" | "dia-ilegivel" }
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
 * de ritmo conta o retrato mais esses, sem repetir o lead). `doTime` (19/10/2026): os leads cujo
 * primeiro contato é do time comercial (primeiro-contato.ts); o aviso não oferece o primeiro contato deles.
 * É a única regra de quem faz o primeiro contato, a mesma da Central: o time desligado ou pausado, sem
 * fila, não tira nada do operador.
 */
export function decidir(visao: Pick<CrmVisao, "hoje" | "leads"> | null, estadoLido: EstadoDoVendedor, agora: number,
  sugestoes?: ReadonlyMap<string, SugestaoDeVenda>, doDia?: DoDia | null, doTime?: ReadonlySet<string>, pausaPrimeiros = false): { decisao: Decisao; estado: EstadoDoVendedor; fechados: Fechados } {
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
  if (silencioDoVendedor(agora)) return { decisao: { tipo: "nada", motivo: "fora-do-expediente" }, estado, fechados: nada };
  const toques = somarPrimeiros(doDia?.primeiros);
  const ritmo = ritmoDoEnvio(instantesDePrimeiroContato(visao?.leads ?? [], toques), agora);
  const porId = new Map((visao?.leads ?? []).map((l) => [l.id, l]));
  const fila = filaDeVenda(visao, {
    primeiroLiberado: !pausaPrimeiros && noExpedienteDeVenda(agora) && ritmo.motivo === null, agora, ...(sugestoes ? { sugestoes } : {}), ...(doTime ? { primeirosDoTime: doTime } : {}),
  }, new Set(estado.pulados))
    .map((a) => comHistoricoConferido(a, porId.get(a.leadId)));
  const { ficam, fechados } = limparAbertos(estado.abertos, new Set(fila.map((a) => a.chave)), resolvidas, agora);
  estado.abertos = ficam;
  for (const a of fechados.expirados) if (!estado.pulados.includes(a.chave)) estado.pulados.push(a.chave);
  const avisados = new Set(estado.avisados);
  // Passado o teto só o "quero ver" quente ainda avisa (ver MAX_AVISOS_POR_DIA).
  const noTeto = estado.avisosHoje >= MAX_AVISOS_POR_DIA;
  const novas = fila.filter((a) => !avisados.has(a.chave) && (!noTeto || (a.tipo === "responder" && a.quente)));
  if (!novas.length) return { decisao: { tipo: "nada", motivo: noTeto ? "teto-do-dia" : "fila-vazia" }, estado, fechados };
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
  evento: "avisado" | "enviei" | "pulou" | "expirou" | "saiu" | "central" | "barrado";
  /** "barrado": o gate de envio (gate-de-envio.ts) recusou a mensagem; só os códigos, nunca o texto. */
  motivos?: string[];
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

/**
 * PURO (17/10/2026): o gate de envio sobre o rascunho do aviso. A mensagem do copiloto (modelo) é
 * conferida em "bloquear": se reprova, o aviso não sai. O texto da esteira (modelo estático) em
 * "avisar": o aviso sai com a linha "Confira", e o botão fica. O número do link contra o do registro
 * do lead bloqueia nos dois (mandar para a pessoa errada não é questão de estilo). Sem rascunho, nada a conferir.
 */
export function conferirDoAviso(acao: AcaoDeVenda, whatsappDoRegistro?: string): ResultadoDoGate | null {
  if (!acao.rascunho) return null;
  const tipo: TipoDeMensagem = acao.tipo === "primeiro" ? "primeiro"
    : acao.tipo === "followup" ? (acao.primeiroContato ? "reenvio" : "followup")
    : acao.tipo === "mandar-proposta" ? "proposta"
    : "conversa";
  return conferirMensagem(acao.rascunho, {
    modo: acao.copiloto ? "bloquear" : "avisar",
    tipo,
    nome: acao.empresa,
    destino: { ...(acao.link?.url ? { link: acao.link.url } : {}), ...(whatsappDoRegistro ? { registro: whatsappDoRegistro } : {}) },
  });
}

/** Texto puro (sem parse_mode), como todo o bot. `confira`: o que o gate achou num texto da esteira (aviso, não bloqueio). */
export function textoDoAviso(acao: AcaoDeVenda, depois: readonly AcaoDeVenda[], confira?: string): string {
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
    if (confira) linhas.push(`⚠ Confira antes de enviar: ${confira}.`);
  } else if (!acao.conferirHistorico) {
    linhas.push("", "Sem texto pronto: escreva à mão (a colinha da ficha ajuda).");
  }
  const resto = resumoDaFila(depois);
  if (resto) linhas.push("", `Depois desta: ${resto}`);
  return linhas.join("\n");
}

export function botoesDoAviso(acao: AcaoDeVenda, token: string, origemCentral?: string): Botao[][] {
  const linhas: Botao[][] = [];
  if (acao.conferirHistorico) return origemCentral ? [[{ texto: 'Conferir histórico e decidir', url: `${origemCentral.replace(/\/$/, '')}/crm?lead=${encodeURIComponent(acao.leadId)}` }]] : [];
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
  registrar(corpo: { produto: string; id: string; tipo: string; texto: string; data: "" }): Promise<void>;
  arquivoDeEstado: string;
  /** O histórico de avisos e toques (OT-09). Ausente: não mede. */
  arquivoDeHistorico?: string;
  /**
   * O dia dividido com a Próxima venda da Central (OT-01 e AC-06, server/venda-do-dia.ts): o que se
   * resolveu, as anotações e os primeiros contatos. Obrigatório desde 19/10/2026: é a única fonte dos
   * primeiros contatos do dia (o vendedor.json não os guarda mais).
   */
  vendaDoDia: MemoriaDaVenda;
  /** Os leads cujo primeiro contato é do time comercial (server/frente-comercial.ts). Ausente: nenhum. */
  primeirosDoTime?(): Promise<ReadonlySet<string>>;
  pausaPrimeiros?(): Promise<boolean>;
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
  const emSerie = criarEmSerie();

  // O que já foi ao Telegram mas ainda não está no arquivo. Se a gravação falha depois do envio, a volta
  // seguinte reenviaria o mesmo aviso a cada minuto (o teto não segura: ele também mora no arquivo) e o
  // toque nele não acharia o token. Só em memória; sai quando uma gravação passa.
  const pendentes: { dia: string; avisados: Set<string>; abertos: AvisoAberto[]; avisos: number } = { dia: "", avisados: new Set(), abertos: [], avisos: 0 };
  let falhasDeGravacao = 0;

  /** O estado do arquivo; só o arquivo que ainda não existe é "dia novo". Outro erro sobe: a volta é pulada com log. */
  async function lerEstado(): Promise<EstadoDoVendedor> {
    let e: EstadoDoVendedor;
    try {
      e = estadoDoDia(JSON.parse(await fs.readFile(deps.arquivoDeEstado, "utf8")), deps.agora());
    } catch (erro: any) {
      // Engolir tudo daria um estado vazio, e a gravação seguinte apagava o que já se avisou hoje
      // (a fila inteira voltava ao Telegram).
      if (erro?.code !== "ENOENT") throw erro;
      e = estadoNovo(deps.agora());
    }
    if (pendentes.dia === e.dia) {
      for (const a of pendentes.abertos) if (!e.abertos.some((x) => x.chave === a.chave)) e.abertos.push(a);
      for (const c of pendentes.avisados) if (!e.avisados.includes(c)) e.avisados.push(c);
      e.avisosHoje += pendentes.avisos;
    }
    return e;
  }
  async function gravarEstado(e: EstadoDoVendedor): Promise<void> {
    try {
      await fs.mkdir(path.dirname(deps.arquivoDeEstado), { recursive: true });
      const tmp = `${deps.arquivoDeEstado}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(e), { mode: 0o600 });
      await fs.rename(tmp, deps.arquivoDeEstado);
    } catch (err) {
      falhasDeGravacao++;
      if (falhasDeGravacao >= MAX_FALHAS_DE_GRAVACAO) {
        console.error(`[vendedor] ${falhasDeGravacao} gravações seguidas do estado falharam: laço parado até reiniciar a Central.`);
        pararLaco();
      }
      throw err;
    }
    falhasDeGravacao = 0;
    pendentes.avisados.clear();
    pendentes.abertos.length = 0;
    pendentes.avisos = 0;
  }
  function pararLaco() {
    if (relogio) clearInterval(relogio);
    if (proximaJa) clearTimeout(proximaJa);
    relogio = null;
    proximaJa = null;
  }

  /**
   * O dia do servidor. Falhou a leitura, quem chama pula a volta (ou o toque): sem ele não se sabe o
   * que a Central já resolveu nem quantos primeiros contatos já saíram, e seguir só com o estado próprio
   * deixaria passar da trava de ritmo.
   */
  const lerDoDia = (): Promise<VendaDoDia> => deps.vendaDoDia.ler();

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
    const corpo = { produto: aberto.produto, id: aberto.leadId.slice(aberto.leadId.indexOf(":") + 1), tipo: aberto.anota, texto: aberto.textoDoRegistro ?? "", data: "" as const };
    const r = await deps.vendaDoDia.anotarUmaVez(aberto.chave, aberto.anota, "telegram", () => deps.registrar(corpo));
    return r.anotou ? "anotou" : "ja-estava";
  }

  async function voltaSemFila(): Promise<Decisao> {
    const agora = deps.agora();
    const lido = await lerEstado();
    if (silencioDoVendedor(agora)) {
      if (lido.dia !== estadoNovo(agora).dia) await gravarEstado(estadoNovo(agora));
      return { tipo: "nada", motivo: "fora-do-expediente" };
    }
    const visao = await deps.lerVisao();
    if (visao.estado !== "ok") return { tipo: "nada", motivo: "fila-vazia" };
    const sugestoes = deps.copiloto ? await deps.copiloto.prontas(visao).catch(() => undefined) : undefined;
    let doDia: VendaDoDia;
    try {
      doDia = await lerDoDia();
    } catch (err) {
      console.warn(`[vendedor] volta pulada: o dia do servidor não foi lido (${err instanceof Error ? err.message : String(err)})`);
      return { tipo: "nada", motivo: "dia-ilegivel" };
    }
    // Quem faz o primeiro contato é só o primeirosDoTime (a regra da Central, src/operations/primeiro-contato.ts):
    // o arquivo de config do time existir não tira o lead novo do operador, ligado ou não. lerPrimeirosDoTime nunca rejeita.
    const doTime = deps.primeirosDoTime ? await deps.primeirosDoTime() : undefined;
    let pausaPrimeiros = true;
    try { pausaPrimeiros = deps.pausaPrimeiros ? await deps.pausaPrimeiros() : false; } catch { /* Sem leitura da proteção: primeiros contatos continuam barrados. */ }
    const { decisao, estado, fechados } = decidir(visao, lido, agora, sugestoes, doDia, doTime, pausaPrimeiros);
    const historico = fechadosNaVolta(fechados, agora);
    // O que a Central resolveu fecha aqui também; o que expirou vale como pular lá (AC-06).
    for (const { aberto, resolvida } of fechados.fora) await fecharMensagens(aberto, rodapeDeFora(resolvida));
    for (const aberto of fechados.expirados) {
      await fecharMensagens(aberto, RODAPE_DO_EXPIRADO);
      await deps.vendaDoDia.resolver(aberto.chave, "pulada", "expirou").catch((err) => {
        console.warn(`[vendedor] a Central não soube do aviso expirado: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    // O copiloto só gera quando a última mensagem da conversa guardada é do lead (conversaDaVez, copiloto.ts):
    // nos outros passos (depois do link, follow-up, proposta) ele nunca responde, e segurar o aviso por 4 min
    // seria esperar à toa.
    if (decisao.tipo === "avisar" && deps.copiloto && esperaOCopiloto(decisao.acao)
      && visao.leads.find((l) => l.id === decisao.acao.leadId)?.conversa?.ultima.direcao === "entrada") {
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
      // O gate de envio (17/10/2026): mensagem do copiloto quebrada, ou link para outro número que o do
      // registro, não vira aviso; o texto da esteira com problema sai com a linha "Confira".
      const lead = visao.leads.find((l) => l.id === decisao.acao.leadId);
      const gate = conferirDoAviso(decisao.acao, lead?.links.whatsapp);
      if (gate && !gate.ok) {
        const motivos = resumoDosProblemas(gate.problemas);
        console.warn(`[vendedor] ${gate.bloqueia ? "aviso barrado" : "confira"} (${decisao.acao.chave}): ${motivos}`);
        if (gate.bloqueia) {
          // Não repete hoje (senão a volta de 1 min pegaria o mesmo); a Central segue mostrando o lead.
          estado.avisados.push(decisao.acao.chave);
          historico.push({ em: agora, evento: "barrado", chave: decisao.acao.chave, tipo: decisao.acao.tipo, motivos: [...new Set(gate.problemas.map((p) => p.codigo))] });
          await deps.enviar(`⛔ Não mandei o aviso de ${decisao.acao.empresa}: ${motivos}. Confira a ficha na Central.`, []).catch((err) => {
            console.warn(`[vendedor] o motivo do aviso barrado não foi enviado: ${err instanceof Error ? err.message : String(err)}`);
          });
          pendentes.dia = estado.dia;
          pendentes.avisados.add(decisao.acao.chave);
          await gravarEstado(estado);
          await anotarNoHistorico(deps.arquivoDeHistorico, historico, agora);
          return { tipo: "nada", motivo: "mensagem-barrada" };
        }
      }
      const token = randomBytes(6).toString("hex");
      const texto = textoDoAviso(decisao.acao, decisao.depois, gate && !gate.ok ? resumoDosProblemas(gate.problemas) : undefined);
      const mensagens = await deps.enviar(texto, botoesDoAviso(decisao.acao, token, deps.origemCentral));
      const novoAberto: AvisoAberto = {
        chave: decisao.acao.chave, token, em: agora, leadId: decisao.acao.leadId, primeiroContato: decisao.acao.primeiroContato,
        produto: decisao.acao.produto, texto, ...(decisao.acao.anota ? { anota: decisao.acao.anota } : {}), ...(decisao.acao.textoDoRegistro ? { textoDoRegistro: decisao.acao.textoDoRegistro } : {}),
        tipo: decisao.acao.tipo, ...(decisao.acao.quente ? { quente: true } : {}),
        ...(decisao.acao.conferirHistorico ? { conferirHistorico: true } : {}),
        ...(Array.isArray(mensagens) && mensagens.length ? { mensagens } : {}),
      };
      // Lembrado na hora, antes de gravar: se a gravação falhar, a volta seguinte não reenvia (ver `pendentes`).
      pendentes.dia = estado.dia;
      pendentes.avisados.add(decisao.acao.chave);
      pendentes.abertos.push(novoAberto);
      pendentes.avisos++;
      estado.avisados.push(decisao.acao.chave);
      estado.abertos.push(novoAberto);
      estado.avisosHoje++;
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
    if (aberto.conferirHistorico && acao === 'enviei') return { curto: 'Confira o histórico na Ficha antes de escolher a retomada.' };
    let doDia: VendaDoDia;
    try {
      doDia = await lerDoDia();
    } catch (err) {
      console.warn(`[vendedor] toque adiado: o dia do servidor não foi lido (${err instanceof Error ? err.message : String(err)})`);
      return { curto: "Não consegui ler o dia agora. Toque de novo em instantes." };
    }
    estado.abertos = estado.abertos.filter((a) => a.token !== token);
    const toque = toqueNoAviso(aberto, acao, doDia);
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
        // Quem as duas superfícies leem é o servidor do dia (o vendedor.json não guarda mais os primeiros).
        await deps.vendaDoDia.primeiroContato(aberto.leadId, "telegram").catch((err) => {
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
    await deps.vendaDoDia.resolver(aberto.chave, toque.como, "telegram").catch((err) => {
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
    parar: pararLaco,
    volta: () => emSerie(voltaSemFila),
    tocar: (token, acao) => emSerie(() => tocarSemFila(token, acao)),
  };
}
