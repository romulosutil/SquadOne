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
 * `decidir` é PURO (estado + fila + relógio -> o que fazer); o resto é a cola com o CRM, o
 * Telegram e o arquivo de estado.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { esperaOCopiloto, filaDeVenda, noExpedienteDeVenda, resumoDaFila, type AcaoDeVenda, type SugestaoDeVenda } from "../src/operations/proxima-venda.ts";
import { instantesDePrimeiroContato, ritmoDoEnvio } from "../src/operations/trava-de-ritmo.ts";
import type { CrmVisao } from "../src/operations/types.ts";
import type { Botao } from "./telegram.ts";
import { dadosDaVenda } from "./telegram-entrada.ts";

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
}

export interface EstadoDoVendedor {
  /** AAAA-MM-DD de São Paulo: virou o dia, zera. */
  dia: string;
  /** Chaves já avisadas hoje (não repetem). */
  avisados: string[];
  pulados: string[];
  abertos: AvisoAberto[];
  /** leadId -> instante (ms) do "Enviei" de um primeiro contato: a trava conta antes do retrato. */
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

/**
 * O que fazer agora. Também limpa o estado: aviso aberto cuja ação saiu da fila (o retrato
 * confirmou) fecha; aberto há mais de 30 min sem toque vira pulado. `sugestoes`: as do copiloto que
 * valem para a conversa de agora (leadId -> mensagem); entram no lugar do texto pronto.
 */
export function decidir(visao: Pick<CrmVisao, "hoje" | "leads"> | null, estadoLido: EstadoDoVendedor, agora: number,
  sugestoes?: ReadonlyMap<string, SugestaoDeVenda>): { decisao: Decisao; estado: EstadoDoVendedor } {
  const estado: EstadoDoVendedor = { ...estadoLido, abertos: [...estadoLido.abertos], pulados: [...estadoLido.pulados] };
  if (!noExpedienteDeVenda(agora)) return { decisao: { tipo: "nada", motivo: "fora-do-expediente" }, estado };
  const ritmo = ritmoDoEnvio(instantesDePrimeiroContato(visao?.leads ?? [], estado.primeiros), agora);
  const fila = filaDeVenda(visao, { primeiroLiberado: ritmo.motivo === null, agora, ...(sugestoes ? { sugestoes } : {}) }, new Set(estado.pulados));
  const naFila = new Set(fila.map((a) => a.chave));
  estado.abertos = estado.abertos.filter((a) => {
    if (!naFila.has(a.chave)) return false;
    if (agora - a.em >= ESPERA_DO_AVISO_MS) {
      if (!estado.pulados.includes(a.chave)) estado.pulados.push(a.chave);
      return false;
    }
    return true;
  });
  if (estado.avisados.length >= MAX_AVISOS_POR_DIA) return { decisao: { tipo: "nada", motivo: "teto-do-dia" }, estado };
  const avisados = new Set(estado.avisados);
  const novas = fila.filter((a) => !avisados.has(a.chave));
  if (!novas.length) return { decisao: { tipo: "nada", motivo: "fila-vazia" }, estado };
  // Um aviso aberto por vez, menos o "quero ver" que acabou de chegar.
  const proxima = estado.abertos.length ? novas.find((a) => a.tipo === "responder" && a.quente) : novas[0];
  if (!proxima) return { decisao: { tipo: "nada", motivo: "esperando-toque" }, estado };
  return { decisao: { tipo: "avisar", acao: proxima, depois: fila.filter((a) => a.chave !== proxima.chave) }, estado };
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
  evento: "avisado" | "enviei" | "pulou" | "expirou" | "saiu";
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
  /** Saiu da fila antes do toque (o retrato confirmou o envio, ou a ação deixou de valer). */
  saiu: number;
  /** Do aviso ao "Enviei", em minutos (mediana). */
  medianaAteEnvieiMin: number | null;
  /** Só os "quero ver" (quente): quantos e a mediana até o "Enviei". */
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
    saiu: de("saiu").length,
    medianaAteEnvieiMin: minutos(enviei),
    quentes: {
      avisos: de("avisado").filter((e) => e.quente).length,
      enviei: enviei.filter((e) => e.quente).length,
      medianaAteEnvieiMin: minutos(enviei.filter((e) => e.quente)),
    },
  };
}

/** PURO: os avisos que fecharam numa volta sem toque (o retrato confirmou, ou 30 min sem toque). */
export function fechadosNaVolta(antes: EstadoDoVendedor, depois: EstadoDoVendedor, agora: number): EventoDoVendedor[] {
  const ficaram = new Set(depois.abertos.map((a) => a.token));
  const jaPulados = new Set(antes.pulados);
  return antes.abertos.filter((a) => !ficaram.has(a.token)).map((a) => ({
    em: agora,
    evento: depois.pulados.includes(a.chave) && !jaPulados.has(a.chave) ? "expirou" as const : "saiu" as const,
    chave: a.chave,
    ...(a.tipo ? { tipo: a.tipo } : {}),
    ...(a.quente ? { quente: true } : {}),
    esperaMs: agora - a.em,
  }));
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
  enviar(texto: string, botoes: Botao[][]): Promise<void>;
  /** POST do registro na aba CRM (o mesmo da Ficha): só para o que o link não marca sozinho. */
  registrar(corpo: { produto: string; id: string; tipo: string; texto: ""; data: "" }): Promise<void>;
  arquivoDeEstado: string;
  /** O histórico de avisos e toques (OT-09). Ausente: não mede. */
  arquivoDeHistorico?: string;
  /**
   * O "Enviei"/"Pular" do dia, dividido com a Próxima venda da Central (OT-01, server/venda-do-dia.ts):
   * o que se resolveu numa tela não volta no Telegram, e vice-versa. Ausente: só o estado próprio.
   */
  vendaDoDia?: { ler(): Promise<{ resolvidas: Record<string, { pulou: boolean }> }>; resolver(chave: string, pulou: boolean): Promise<unknown> };
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
    // O que a Central já resolveu hoje conta aqui: enviado lá é como avisado; pulado lá vai para o fim.
    const daCentral = deps.vendaDoDia ? await deps.vendaDoDia.ler().catch(() => null) : null;
    const resolvidas: Array<[string, { pulou: boolean }]> = daCentral ? Object.entries(daCentral.resolvidas) : [];
    const comCentral: EstadoDoVendedor = !daCentral ? lido : {
      ...lido,
      avisados: [...new Set([...lido.avisados, ...resolvidas.filter(([, r]) => !r.pulou).map(([c]) => c)])],
      pulados: [...new Set([...lido.pulados, ...resolvidas.filter(([, r]) => r.pulou).map(([c]) => c)])],
    };
    const { decisao, estado } = decidir(visao, comCentral, agora, sugestoes);
    const historico = fechadosNaVolta(comCentral, estado, agora);
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
      await deps.enviar(texto, botoesDoAviso(decisao.acao, token, deps.origemCentral));
      estado.avisados.push(decisao.acao.chave);
      estado.abertos.push({
        chave: decisao.acao.chave, token, em: agora, leadId: decisao.acao.leadId, primeiroContato: decisao.acao.primeiroContato,
        produto: decisao.acao.produto, texto, ...(decisao.acao.anota ? { anota: decisao.acao.anota } : {}),
        tipo: decisao.acao.tipo, ...(decisao.acao.quente ? { quente: true } : {}),
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
    let rodape: string;
    if (acao === "pular") {
      if (!estado.pulados.includes(aberto.chave)) estado.pulados.push(aberto.chave);
      rodape = "⏭ Pulado por hoje.";
    } else {
      estado.enviadosHoje++;
      if (aberto.primeiroContato) estado.primeiros[aberto.leadId] = agora;
      rodape = "✅ Enviado.";
      if (aberto.anota) {
        const chave = aberto.leadId.slice(aberto.leadId.indexOf(":") + 1);
        try {
          await deps.registrar({ produto: aberto.produto, id: chave, tipo: aberto.anota, texto: "", data: "" });
          rodape = "✅ Enviado e anotado no CRM.";
        } catch (err) {
          console.warn(`[vendedor] anotação falhou: ${err instanceof Error ? err.message : String(err)}`);
          rodape = "✅ Enviado. ⚠️ Não consegui anotar no CRM: anote na ficha.";
        }
      }
    }
    await gravarEstado(estado);
    await deps.vendaDoDia?.resolver(aberto.chave, acao === "pular").catch((err) => {
      console.warn(`[vendedor] a Central não soube do toque: ${err instanceof Error ? err.message : String(err)}`);
    });
    await anotarNoHistorico(deps.arquivoDeHistorico, [{
      em: agora, evento: acao === "pular" ? "pulou" : "enviei", chave: aberto.chave, esperaMs: agora - aberto.em,
      ...(aberto.tipo ? { tipo: aberto.tipo } : {}), ...(aberto.quente ? { quente: true } : {}),
    }], agora);
    // A próxima vem já, sem esperar o minuto do laço.
    setTimeout(() => { void emSerie(voltaSemFila).catch(registrarFalha); }, 1500);
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
      relogio = null;
    },
    volta: () => emSerie(voltaSemFila),
    tocar: (token, acao) => emSerie(() => tocarSemFila(token, acao)),
  };
}
