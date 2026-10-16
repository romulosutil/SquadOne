import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Saída proativa do SquadOne (regra 20): todo aviso vira um arquivo na fila de
 * avisos do Dell (`~/.local/share/avisos/fila`), que o `dell-status` drena para
 * o WhatsApp do Hermes com teto, silêncio das 22h às 7h e chave de 24 h. O
 * SquadOne decide QUANDO e O QUÊ; o Hermes só entrega. Ninguém chama `hermes
 * send` direto: o número é o mesmo que fala com leads, e só um ponto único
 * deixa o teto valer para todos.
 *
 * O formato é o da fase 1 (`deploy/dell/README.md`, "Fila de avisos"): campo
 * fora dele é recusado pelo `dell-status` e deixa a verificação vermelha, por
 * isso a validação daqui espelha a de lá e recusa ANTES de gravar.
 *
 * P0 também vai ao Telegram (sendMessage ao chat do dono): a sessão do WhatsApp
 * não é oficial e cai, a Bot API é oficial. Só P0, porque P0 também fura o
 * silêncio e espelhar o resto dobraria o barulho.
 *
 * Nenhum valor em R$ (regra 24): os canais recebem semáforo e %, nunca valor.
 * `semValores` limpa o texto montado a partir de dado do usuário (título de
 * compromisso) e a validação recusa o que sobrar.
 */

export type PrioridadeDoAviso = 0 | 1 | 2 | 3;

export interface Aviso {
  /** Uma linha, até 120. */
  titulo: string;
  /** Até 4000. */
  texto: string;
  /** Quem gravou (`squadone:vigia`...), uma linha, até 80. */
  origem: string;
  /** A mesma chave enviada nas últimas 24 h é descartada pelo dell-status. */
  chave: string;
  /** 0 = urgente (fura o silêncio e vai ao Telegram), 3 = baixa. */
  prioridade: PrioridadeDoAviso;
  /** ISO 8601. Vencido é descartado sem enviar: lembrete atrasado não serve. */
  expiraEm: string;
  /** URL http(s), até 500; vai numa linha no fim da mensagem. */
  link?: string;
}

/** Tetos do schema da fila (dell-status.py, MAX_CARACTERES e MAX_BYTES_AVISO). */
export const LIMITES_DO_AVISO = { titulo: 120, texto: 4000, origem: 80, chave: 200, link: 500 } as const;
export const MAX_BYTES_AVISO = 16 * 1024;

export class AvisoInvalido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "AvisoInvalido";
  }
}

/** Qualquer "R$", com ou sem número: nada de valor nos canais (regra 24). */
const VALOR_EM_REAIS = /R\s*\$/i;
const VALOR_EM_REAIS_COM_NUMERO = /R\s*\$\s*-?[\d.,]*/gi;

/**
 * Troca valor em R$ por "[valor]". Para texto que vem do usuário (o título de
 * um compromisso "Pagar boleto R$ 300"): o lembrete sai, o valor não.
 */
export function semValores(texto: string): string {
  return texto.replace(VALOR_EM_REAIS_COM_NUMERO, "[valor] ").replace(/ {2,}/g, " ").trim();
}

/** Uma linha só e no máximo `teto` caracteres, com reticências. */
export function umaLinha(texto: string, teto: number): string {
  const limpo = texto.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return limpo.length <= teto ? limpo : `${limpo.slice(0, teto - 1).trimEnd()}…`;
}

function ehLinkHttp(v: string): boolean {
  if (/\s/.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** O formato gravado na fila: o do dell-status, com `expira_em` em snake_case. */
export function avisoParaArquivo(a: Aviso): Record<string, unknown> {
  return {
    titulo: a.titulo,
    texto: a.texto,
    origem: a.origem,
    chave: a.chave,
    prioridade: a.prioridade,
    expira_em: a.expiraEm,
    ...(a.link ? { link: a.link } : {}),
  };
}

/** Lança `AvisoInvalido` com o motivo. Mesmas regras do `validar_aviso` do dell-status, mais o R$. */
export function validarAviso(a: Aviso): void {
  for (const campo of ["titulo", "texto", "origem", "chave"] as const) {
    const v = a[campo];
    if (typeof v !== "string" || !v.trim()) throw new AvisoInvalido(`'${campo}' é obrigatório (texto não vazio)`);
    if (v.length > LIMITES_DO_AVISO[campo]) {
      throw new AvisoInvalido(`'${campo}' passa de ${LIMITES_DO_AVISO[campo]} caracteres (${v.length})`);
    }
    if (campo !== "texto" && /[\r\n]/.test(v)) throw new AvisoInvalido(`'${campo}' não pode ter quebra de linha`);
  }
  if (!Number.isInteger(a.prioridade) || a.prioridade < 0 || a.prioridade > 3) {
    throw new AvisoInvalido("'prioridade' deve ser inteiro de 0 a 3");
  }
  if (typeof a.expiraEm !== "string" || Number.isNaN(Date.parse(a.expiraEm))) {
    throw new AvisoInvalido("'expiraEm' deve ser data/hora ISO 8601");
  }
  if (a.link !== undefined) {
    if (typeof a.link !== "string" || a.link.length > LIMITES_DO_AVISO.link || !ehLinkHttp(a.link)) {
      throw new AvisoInvalido("'link' deve ser URL http(s) sem espaços, até 500");
    }
  }
  for (const campo of ["titulo", "texto", "link"] as const) {
    const v = a[campo];
    if (typeof v === "string" && VALOR_EM_REAIS.test(v)) {
      throw new AvisoInvalido(`'${campo}' tem valor em R$: os canais recebem semáforo e %, nunca valor (regra 24)`);
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(avisoParaArquivo(a)), "utf8");
  if (bytes > MAX_BYTES_AVISO) throw new AvisoInvalido(`aviso passa de ${MAX_BYTES_AVISO} bytes (${bytes})`);
}

/**
 * Grava um arquivo na fila. Atômico: `.tmp` oculto (o dell-status só lê
 * `*.json`) e rename por cima, para a drenagem nunca ler pela metade. Não cria
 * a pasta: ela é `2770` com o grupo do n8n, e quem a cria é o instalador do
 * dell-status (criar aqui com outra permissão quebraria o n8n). Devolve o
 * caminho gravado.
 */
export async function gravarAvisoNaFila(fila: string, aviso: Aviso, agora = new Date()): Promise<string> {
  validarAviso(aviso);
  const nome = `${agora.toISOString().replace(/[-:.]/g, "")}-squadone-${randomBytes(4).toString("hex")}.json`;
  const destino = path.join(fila, nome);
  const tmp = path.join(fila, `.${nome}.tmp`);
  try {
    await fs.writeFile(tmp, JSON.stringify(avisoParaArquivo(aviso)) + "\n", { encoding: "utf8", mode: 0o660, flag: "wx" });
    await fs.rename(tmp, destino);
  } catch (err: any) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    if (err?.code === "ENOENT") throw new Error(`fila de avisos não existe em ${fila} (instale o dell-status)`);
    throw err;
  }
  return destino;
}

/** O texto do espelho no Telegram: o mesmo do WhatsApp (título, texto, link). */
export function textoDoAviso(a: Aviso): string {
  return [a.titulo, a.texto, a.link].filter(Boolean).join("\n");
}

export interface DepsDePublicacao {
  /** Pasta da fila (`~/.local/share/avisos/fila`). */
  fila: string;
  /**
   * sendMessage do bot ao chat do dono. Ausente = bot desligado: P0 só na fila. `silencioso` chega
   * sem som (o `disable_notification` da Bot API).
   */
  telegram?: (texto: string, opcoes?: { silencioso?: boolean }) => Promise<void>;
  agora?: () => Date;
  log?: { error: (...a: unknown[]) => void };
}

export interface ResultadoDaPublicacao {
  arquivo: string | null;
  telegram: "enviado" | "falhou" | "naoSeAplica";
}

/**
 * Fila sempre; P0 também no Telegram. O Telegram é tentado mesmo se a fila
 * falhar (é justamente quando o espelho vale), e falha dele não falha o aviso.
 * Fila que falha lança DEPOIS do espelho: quem chama (a vigia) não marca como
 * enviado e tenta de novo na varredura seguinte.
 */
export async function publicarAviso(aviso: Aviso, deps: DepsDePublicacao): Promise<ResultadoDaPublicacao> {
  validarAviso(aviso);
  const log = deps.log ?? console;
  let arquivo: string | null = null;
  let falhaDaFila: unknown = null;
  try {
    arquivo = await gravarAvisoNaFila(deps.fila, aviso, deps.agora?.() ?? new Date());
  } catch (err) {
    falhaDaFila = err;
  }
  let telegram: ResultadoDaPublicacao["telegram"] = "naoSeAplica";
  if (aviso.prioridade === 0 && deps.telegram) {
    try {
      await deps.telegram(textoDoAviso(aviso));
      telegram = "enviado";
    } catch (err) {
      telegram = "falhou";
      log.error(`[avisos] espelho P0 no Telegram falhou: ${(err as Error)?.message ?? err}`);
    }
  }
  if (falhaDaFila) throw falhaDaFila;
  return { arquivo, telegram };
}

/**
 * Aviso pessoal pelo Telegram (16/10/2026, OT-14 do blueprint; exceção da regra 20 escolhida pelo
 * Rômulo): o lembrete da agenda e o alerta de finanças saíam pelo WhatsApp do Hermes, que é o mesmo
 * número que fala com os leads e levou restrição de 24 h em 15/10. Cada aviso pessoal era uma
 * mensagem a mais na conta desse número. Agora:
 * - vai pelo bot do Telegram (Bot API oficial, sem risco para o número de vendas);
 * - das 22h às 7h de São Paulo chega sem som (o silêncio que a fila já fazia);
 * - Telegram desligado ou com falha: cai na fila de sempre, para o lembrete nunca se perder;
 * - a validação é a mesma da fila (schema e nenhum R$, regra 24).
 * O P0 segue por `publicarAviso` (os dois canais).
 */
export function noSilencio(agora: Date): boolean {
  const hora = new Date(agora.getTime() - 3 * 3600_000).getUTCHours();
  return hora >= 22 || hora < 7;
}

export interface ResultadoDoPessoal {
  canal: "telegram" | "fila";
  arquivo: string | null;
}

export async function publicarAvisoPessoal(aviso: Aviso, deps: DepsDePublicacao): Promise<ResultadoDoPessoal> {
  validarAviso(aviso);
  if (aviso.prioridade === 0) {
    const r = await publicarAviso(aviso, deps);
    return { canal: "fila", arquivo: r.arquivo };
  }
  const log = deps.log ?? console;
  if (deps.telegram) {
    try {
      await deps.telegram(textoDoAviso(aviso), { silencioso: noSilencio(deps.agora?.() ?? new Date()) });
      return { canal: "telegram", arquivo: null };
    } catch (err) {
      log.error(`[avisos] Telegram falhou, o aviso vai pela fila: ${(err as Error)?.message ?? err}`);
    }
  }
  const arquivo = await gravarAvisoNaFila(deps.fila, aviso, deps.agora?.() ?? new Date());
  return { canal: "fila", arquivo };
}

/** `SQUADONE_LEMBRETES_PELO_TELEGRAM=false` volta lembretes e alertas de finanças à fila do WhatsApp. */
export function avisosPessoaisPeloTelegram(env: NodeJS.ProcessEnv): boolean {
  return (env.SQUADONE_LEMBRETES_PELO_TELEGRAM ?? "").trim().toLowerCase() !== "false";
}

/**
 * Cartão que pede decisão (regra 10): no WhatsApp vai SÓ o link da tailnet, que
 * abre a tela; a confirmação é um POST da mesma origem lá dentro. Por isso:
 * - o link é a origem da tailnet + um caminho, sem query (um GET com
 *   "?confirmar=1" seria uma decisão tomada por quem abrir o link, inclusive a
 *   prévia de link do próprio WhatsApp);
 * - o texto não leva URL nenhuma: o único lugar clicável é o link;
 * - "responda 1 ou 2" não existe: a resposta cairia na IA do Hermes.
 */
export interface PedidoDeCartao {
  titulo: string;
  texto: string;
  origem: string;
  chave: string;
  prioridade?: PrioridadeDoAviso;
  expiraEm: string;
  /** Caminho da tela que mostra o cartão, ex.: `/cartoes/abc`. */
  caminho: string;
}

export function avisoDeCartao(p: PedidoDeCartao, origemTailnet: string): Aviso {
  let base: URL;
  try {
    base = new URL(origemTailnet);
  } catch {
    throw new AvisoInvalido("origem da tailnet não é uma URL");
  }
  if (base.protocol !== "https:" || !base.hostname.endsWith(".ts.net") || base.pathname !== "/" || base.search) {
    throw new AvisoInvalido("cartão só leva link da tailnet: https://<máquina>.ts.net[:porta], sem caminho");
  }
  if (!p.caminho.startsWith("/") || p.caminho.startsWith("//") || /[?#]/.test(p.caminho)) {
    throw new AvisoInvalido("caminho do cartão começa com '/' e não tem query nem fragmento: abrir não confirma");
  }
  if (/https?:\/\//i.test(p.texto) || /https?:\/\//i.test(p.titulo)) {
    throw new AvisoInvalido("cartão não leva URL no texto: só o link da tailnet");
  }
  const aviso: Aviso = {
    titulo: p.titulo,
    texto: p.texto,
    origem: p.origem,
    chave: p.chave,
    prioridade: p.prioridade ?? 2,
    expiraEm: p.expiraEm,
    link: new URL(p.caminho, base).href,
  };
  validarAviso(aviso);
  return aviso;
}
