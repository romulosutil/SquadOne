import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ehMadrugada } from "./tempo.ts";

/**
 * Saída proativa do SquadOne (regra 20). Hoje há dois caminhos, e o Telegram vem primeiro:
 *
 * - Avisos pessoais (lembrete da agenda, alerta de finanças, "Google desconectado"; OT-14,
 *   16/10/2026): vão ao chat do dono pelo bot do Telegram (Bot API oficial), sem som das 22h às 7h.
 *   A fila do WhatsApp é só RESERVA, quando o bot está desligado ou falha. Motivo: o número do
 *   WhatsApp é o mesmo que fala com os leads e já levou restrição por volume.
 * - A fila de avisos do Dell (`~/.local/share/avisos/fila`), que o `dell-status` drena para o
 *   WhatsApp do Hermes com teto, silêncio das 22h às 7h (aí sim, o aviso espera e sai às 7h) e chave
 *   de 24 h. Ninguém chama `hermes send` direto: só um ponto único deixa o teto valer para todos.
 *
 * O SquadOne decide QUANDO e O QUÊ; o transporte só entrega. O formato da fila é o da fase 1
 * (`deploy/dell/README.md`, "Fila de avisos"): campo fora dele é recusado pelo `dell-status` e deixa
 * a verificação vermelha, por isso a validação daqui espelha a de lá e recusa ANTES de gravar.
 *
 * P0 vai aos DOIS canais (fila e Telegram): a sessão do WhatsApp não é oficial e cai, a Bot API é
 * oficial. Só P0, porque P0 também fura o silêncio. Capacidade pronta: nenhum chamador produz P0
 * hoje (o cartão de decisão que era P0 foi removido em 19/10/2026).
 *
 * Aviso que NÃO passa pela fila perde a chave de 24 h do dell-status; por isso o caminho pessoal
 * guarda as chaves enviadas em disco (`RegistroDeEnviados`) e sobrevive ao reinício da Central, que
 * acontece a cada merge.
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
  /** A mesma chave enviada nas últimas 24 h é descartada (pelo dell-status e pelo `RegistroDeEnviados`). */
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


/**
 * Chaves de aviso já enviadas pelo caminho pessoal, em disco (`chave → enviadoEm`, ms). Desde a OT-14
 * o lembrete e o alerta de finanças não passam mais pela fila, então perderam a chave de 24 h do
 * dell-status; sobrou a memória da vigia, que some a cada reinício (a Central reinicia a cada merge e
 * a vigia varre no boot): um lembrete na janela de 10 min saía duas vezes e o "Google desconectado"
 * repetia a cada reinício. Este arquivo pequeno devolve a regra de 24 h, para todos os chamadores.
 */
export const RETENCAO_DOS_ENVIADOS_MS = 24 * 3600_000;

export interface RegistroDeEnviados {
  /** A chave foi enviada nas últimas 24 h? */
  jaEnviado(chave: string, agora: Date): Promise<boolean>;
  /** Anota o envio. Nunca lança: a mensagem já saiu, e falhar aqui faria quem chama reenviar. */
  marcar(chave: string, agora: Date): Promise<void>;
  /** Tira a chave (ex.: o Google voltou, a próxima perda é um aviso novo). Só grava se ela existia. */
  esquecer(chave: string): Promise<void>;
}

export function criarRegistroDeEnviados(
  arquivo: string,
  opcoes: { log?: { error: (...a: unknown[]) => void }; retencaoMs?: number } = {},
): RegistroDeEnviados {
  const log = opcoes.log ?? console;
  const retencao = opcoes.retencaoMs ?? RETENCAO_DOS_ENVIADOS_MS;
  let mapa: Map<string, number> | null = null;
  let gravacoes: Promise<void> = Promise.resolve();

  async function carregar(): Promise<Map<string, number>> {
    if (mapa) return mapa;
    const lido = new Map<string, number>();
    try {
      const bruto = JSON.parse(await fs.readFile(arquivo, "utf8"));
      if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
        for (const [chave, em] of Object.entries(bruto)) if (typeof em === "number" && Number.isFinite(em)) lido.set(chave, em);
      }
    } catch (err: any) {
      // Arquivo ausente é o primeiro boot; torto é perda do que já foi dito: começa vazio e reescreve.
      if (err?.code !== "ENOENT") log.error(`[avisos] registro de enviados ilegível, recomeço vazio: ${err?.message ?? err}`);
    }
    return (mapa = lido);
  }

  function podar(m: Map<string, number>, agora: number): boolean {
    let mudou = false;
    for (const [chave, em] of m) {
      if (agora - em >= retencao) {
        m.delete(chave);
        mudou = true;
      }
    }
    return mudou;
  }

  /** Em série e atômico (`.tmp` + rename): duas gravações juntas não se pisam e o arquivo nunca fica pela metade. */
  function gravar(m: Map<string, number>): Promise<void> {
    const instantaneo = JSON.stringify(Object.fromEntries(m));
    gravacoes = gravacoes.then(async () => {
      const tmp = `${arquivo}.tmp`;
      try {
        await fs.mkdir(path.dirname(arquivo), { recursive: true });
        await fs.writeFile(tmp, `${instantaneo}\n`, { encoding: "utf8", mode: 0o600 });
        await fs.rename(tmp, arquivo);
      } catch (err) {
        await fs.rm(tmp, { force: true }).catch(() => {});
        log.error(`[avisos] registro de enviados não gravado (vale só até o próximo reinício): ${(err as Error)?.message ?? err}`);
      }
    });
    return gravacoes;
  }

  return {
    async jaEnviado(chave, agora) {
      const m = await carregar();
      const em = m.get(chave);
      return em !== undefined && agora.getTime() - em < retencao;
    },
    async marcar(chave, agora) {
      const m = await carregar();
      m.set(chave, agora.getTime());
      podar(m, agora.getTime());
      await gravar(m);
    },
    async esquecer(chave) {
      const m = await carregar();
      if (m.delete(chave)) await gravar(m);
    },
  };
}

export interface DepsDePublicacao {
  /** Pasta da fila (`~/.local/share/avisos/fila`). */
  fila: string;
  /**
   * sendMessage do bot ao chat do dono. Ausente = bot desligado: P0 só na fila. `silencioso` chega
   * sem som (o `disable_notification` da Bot API). Deve lançar só se NENHUM chat recebeu: lançar com
   * um chat entregue mandaria o aviso de novo pela fila.
   */
  telegram?: (texto: string, opcoes?: { silencioso?: boolean }) => Promise<void>;
  /** Só o caminho pessoal consulta e grava (`publicarAvisoPessoal`). Ausente = sem dedupe de 24 h. */
  enviados?: RegistroDeEnviados;
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
 * - a mesma chave não sai duas vezes em 24 h, mesmo depois de reinício (`deps.enviados`);
 * - a validação é a mesma da fila (schema e nenhum R$, regra 24).
 * O P0 segue por `publicarAviso` (os dois canais).
 */
export function noSilencio(agora: Date): boolean {
  return ehMadrugada(agora);
}

export interface ResultadoDoPessoal {
  /** `repetido`: a chave já saiu nas últimas 24 h, nada foi enviado agora. */
  canal: "telegram" | "fila" | "repetido";
  arquivo: string | null;
}

export async function publicarAvisoPessoal(aviso: Aviso, deps: DepsDePublicacao): Promise<ResultadoDoPessoal> {
  validarAviso(aviso);
  const agora = deps.agora?.() ?? new Date();
  if (deps.enviados && (await deps.enviados.jaEnviado(aviso.chave, agora))) return { canal: "repetido", arquivo: null };
  const resultado = await enviarPessoal(aviso, deps, agora);
  await deps.enviados?.marcar(aviso.chave, agora);
  return resultado;
}

async function enviarPessoal(aviso: Aviso, deps: DepsDePublicacao, agora: Date): Promise<ResultadoDoPessoal> {
  if (aviso.prioridade === 0) {
    const r = await publicarAviso(aviso, deps);
    return { canal: "fila", arquivo: r.arquivo };
  }
  const log = deps.log ?? console;
  if (deps.telegram) {
    try {
      await deps.telegram(textoDoAviso(aviso), { silencioso: noSilencio(agora) });
      return { canal: "telegram", arquivo: null };
    } catch (err) {
      log.error(`[avisos] Telegram falhou, o aviso vai pela fila: ${(err as Error)?.message ?? err}`);
    }
  }
  const arquivo = await gravarAvisoNaFila(deps.fila, aviso, agora);
  return { canal: "fila", arquivo };
}

/** `SQUADONE_LEMBRETES_PELO_TELEGRAM=false` volta lembretes e alertas de finanças à fila do WhatsApp. */
export function avisosPessoaisPeloTelegram(env: NodeJS.ProcessEnv): boolean {
  return (env.SQUADONE_LEMBRETES_PELO_TELEGRAM ?? "").trim().toLowerCase() !== "false";
}
