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
import { filaDeVenda, noExpedienteDeVenda, resumoDaFila, type AcaoDeVenda } from "../src/operations/proxima-venda.ts";
import { instantesDePrimeiroContato, ritmoDoEnvio } from "../src/operations/trava-de-ritmo.ts";
import type { CrmVisao } from "../src/operations/types.ts";
import type { Botao } from "./telegram.ts";
import { dadosDaVenda } from "./telegram-entrada.ts";

export const ESPERA_DO_AVISO_MS = 30 * 60_000;
export const MAX_AVISOS_POR_DIA = 40;
export const INTERVALO_DO_VENDEDOR_MS = 60_000;

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
  | { tipo: "nada"; motivo: "fora-do-expediente" | "esperando-toque" | "fila-vazia" | "teto-do-dia" }
  | { tipo: "avisar"; acao: AcaoDeVenda; depois: AcaoDeVenda[] };

/**
 * O que fazer agora. Também limpa o estado: aviso aberto cuja ação saiu da fila (o retrato
 * confirmou) fecha; aberto há mais de 30 min sem toque vira pulado.
 */
export function decidir(visao: Pick<CrmVisao, "hoje" | "leads"> | null, estadoLido: EstadoDoVendedor, agora: number): { decisao: Decisao; estado: EstadoDoVendedor } {
  const estado: EstadoDoVendedor = { ...estadoLido, abertos: [...estadoLido.abertos], pulados: [...estadoLido.pulados] };
  if (!noExpedienteDeVenda(agora)) return { decisao: { tipo: "nada", motivo: "fora-do-expediente" }, estado };
  const ritmo = ritmoDoEnvio(instantesDePrimeiroContato(visao?.leads ?? [], estado.primeiros), agora);
  const fila = filaDeVenda(visao, { primeiroLiberado: ritmo.motivo === null, agora }, new Set(estado.pulados));
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

// ---------------------------------------------------------------- o texto do Telegram

const MAX_RASCUNHO = 2500;

/** Texto puro (sem parse_mode), como todo o bot. */
export function textoDoAviso(acao: AcaoDeVenda, depois: readonly AcaoDeVenda[]): string {
  const linhas = [
    `${acao.quente ? "🔥" : "📨"} ${acao.titulo}`,
    acao.contexto,
    "",
    acao.porque,
    "",
    `Como: ${acao.tatica}`,
  ];
  if (acao.rascunho) {
    const r = acao.rascunho.length > MAX_RASCUNHO ? `${acao.rascunho.slice(0, MAX_RASCUNHO)}…` : acao.rascunho;
    linhas.push("", "Mensagem pronta (revise antes de enviar):", "――――", r, "――――");
  } else {
    linhas.push("", "Sem texto pronto: escreva à mão (a colinha da ficha ajuda).");
  }
  const resto = resumoDaFila(depois);
  if (resto) linhas.push("", `Depois desta: ${resto}`);
  return linhas.join("\n");
}

export function botoesDoAviso(acao: AcaoDeVenda, token: string, origemCentral?: string): Botao[][] {
  const linhas: Botao[][] = [];
  if (acao.link) linhas.push([{ texto: acao.rascunho ? "Abrir no WhatsApp com a mensagem" : "Abrir a conversa no WhatsApp", url: acao.link.url }]);
  linhas.push([{ texto: "✓ Enviei", dados: dadosDaVenda(token, "enviei") }, { texto: "Pular", dados: dadosDaVenda(token, "pular") }]);
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
  origemCentral?: string;
  agora(): number;
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
    const { decisao, estado } = decidir(visao, lido, agora);
    if (decisao.tipo === "avisar") {
      const token = randomBytes(6).toString("hex");
      const texto = textoDoAviso(decisao.acao, decisao.depois);
      await deps.enviar(texto, botoesDoAviso(decisao.acao, token, deps.origemCentral));
      estado.avisados.push(decisao.acao.chave);
      estado.abertos.push({
        chave: decisao.acao.chave, token, em: agora, leadId: decisao.acao.leadId, primeiroContato: decisao.acao.primeiroContato,
        produto: decisao.acao.produto, texto, ...(decisao.acao.anota ? { anota: decisao.acao.anota } : {}),
      });
    }
    await gravarEstado(estado);
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
