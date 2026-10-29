import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ehMadrugada } from "./tempo.ts";
import { EstadoOperacionalDuravel, sincronizarPasta } from "./estado-operacional-duravel.ts";
import { ErroDeTelegram } from "./telegram.ts";

/**
 * Saída proativa do SquadOne (regra 20). Hoje há dois caminhos, e o Telegram vem primeiro:
 *
 * - Avisos pessoais (lembrete da agenda, alerta de finanças, "Google desconectado"; OT-14,
 *   16/10/2026): vão ao chat do dono pelo bot do Telegram (Bot API oficial), sem som das 22h às 7h.
 *   A fila do WhatsApp é só RESERVA quando o bot está desligado ou todos os destinos recusaram explicitamente. Motivo: o número do
 *   WhatsApp é o mesmo que fala com os leads e já levou restrição por volume.
 * - A fila de avisos do Dell (`~/.local/share/avisos/fila`), que o `dell-status` drena para o
 *   WhatsApp do Hermes com teto, silêncio das 22h às 7h (aí sim, o aviso espera e sai às 7h) e chave
 *   de 24 h. Ninguém chama `hermes send` direto: só um ponto único deixa o teto valer para todos.
 *
 * O SquadOne decide QUANDO e O QUÊ; o transporte só entrega. O formato da fila é o da fase 1
 * (`deploy/dell/README.md`, "Fila de avisos"): campo fora dele é recusado pelo `dell-status` e deixa
 * a verificação vermelha, por isso a validação daqui espelha a de lá e recusa ANTES de gravar.
 *
 * P0 é exclusivamente Telegram. A fila é sua outbox durável: só o dell-status
 * envia, sob a trava e a deduplicação existentes. Indisponibilidade não expira
 * o P0 nem o transfere ao WhatsApp. A latência é a rodada do monitor (até 1 min).
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
    ...(!avisoExigeTelegram(a) ? { expira_em: a.expiraEm } : {}),
    ...(a.link ? { link: a.link } : {}),
  };
}

/**
 * Origens cujo aviso sai SÓ pelo Telegram (outbox exclusiva, sem expirar, sem fallback para o WhatsApp de vendas).
 * É a mesma lista de `ORIGENS_PELO_TELEGRAM` (deploy/dell/dell-status.py) e de `ORIGENS_TELEGRAM_EXCLUSIVO`
 * (deploy/dell/lib/aviso.py): três cópias, porque TS e Python não se importam. Eram três listas diferentes (5, 2 e 2):
 * um aviso de backup gravado por um lado era exclusivo e, pelo outro, ganhava `expira_em` e um caminho para o WhatsApp.
 * server/avisos.test.ts lê o texto das duas constantes do .py e falha se alguma divergir desta.
 * O prefixo `n8n:` NÃO está aqui de propósito: ver "Falha de fluxo do n8n" em deploy/dell/README.md.
 */
export const ORIGENS_QUE_EXIGEM_TELEGRAM: readonly string[] = [
  'socorro',
  'dell-status',
  'backup-dell',
  'atualizar-central',
  'silmer-drive-sync',
  'frente-comercial',
  'rotina-comercial',
];

export function avisoExigeTelegram(a: Pick<Aviso, 'prioridade' | 'origem'>): boolean {
  return a.prioridade === 0 || ORIGENS_QUE_EXIGEM_TELEGRAM.includes(a.origem);
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
class FilaDeAvisosAusente extends Error {}

export async function gravarAvisoNaFila(fila: string, aviso: Aviso, agora = new Date()): Promise<string> {
  validarAviso(aviso);
  const nome = `${agora.toISOString().replace(/[-:.]/g, "")}-squadone-${randomBytes(4).toString("hex")}.json`;
  const destino = path.join(fila, nome);
  const tmp = path.join(fila, `.${nome}.tmp`);
  let tentouPublicar = false;
  try {
    const h = await fs.open(tmp, "wx", 0o660);
    tentouPublicar = true;
    try { await h.writeFile(JSON.stringify(avisoParaArquivo(aviso)) + "\n", "utf8"); await h.sync(); } finally { await h.close(); }
    await fs.rename(tmp, destino);
    await sincronizarPasta(fila);
  } catch (err: any) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    if (err?.code === "ENOENT" && !tentouPublicar) throw new FilaDeAvisosAusente(`fila de avisos não existe em ${fila} (instale o dell-status)`);
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

export type EstadoDoDestinoPessoal = "naoTentado" | "tentando" | "entregue" | "recusado" | "incerto";
export interface DestinoDoAvisoPessoal { destinoHash: string; estado: EstadoDoDestinoPessoal }
export interface EntregaDoAvisoPessoal { destinos: DestinoDoAvisoPessoal[] }
type EstadoDaTentativaPessoal = "reservado" | "telegram" | "fila" | "incerto" | "naoEnviado";
interface TentativaPessoal {
  id: string; chaveHash: string; estado: EstadoDaTentativaPessoal; em: number; atualizadoEm: number;
  destinos: DestinoDoAvisoPessoal[]; dedupeEncerrado?: boolean;
}
interface JournalPessoal { versao: 1; tentativas: TentativaPessoal[] }
type ReservaPessoal = { estado: "reservado"; token: string } | { estado: "repetido" | "incerto" };
const hashPessoal = (chave: string) => createHash("sha256").update(chave).digest("hex");
const HASH_PESSOAL = /^[a-f0-9]{64}$/;
const ESTADOS_DESTINO = new Set(["naoTentado", "tentando", "entregue", "recusado", "incerto"]);
function validarJournalPessoal(v: unknown): JournalPessoal {
  const j = v as JournalPessoal;
  if (!j || j.versao !== 1 || !Array.isArray(j.tentativas)) throw new Error("Journal pessoal invalido.");
  const ids = new Set<string>();
  for (const t of j.tentativas) {
    if (!t || typeof t.id !== "string" || ids.has(t.id) || !HASH_PESSOAL.test(t.chaveHash) ||
      !["reservado", "telegram", "fila", "incerto", "naoEnviado"].includes(t.estado) ||
      !Number.isFinite(t.em) || !Number.isFinite(t.atualizadoEm) || !Array.isArray(t.destinos) ||
      (t.dedupeEncerrado !== undefined && typeof t.dedupeEncerrado !== "boolean")) throw new Error("Tentativa pessoal invalida.");
    ids.add(t.id);
    const destinos = new Set<string>();
    for (const d of t.destinos) {
      if (!d || !HASH_PESSOAL.test(d.destinoHash) || !ESTADOS_DESTINO.has(d.estado) || destinos.has(d.destinoHash)) throw new Error("Destino pessoal invalido.");
      destinos.add(d.destinoHash);
    }
  }
  return j;
}

/** Captura TODOS os resultados. Uma recusa nao oculta timeout de outro chat. */
export async function enviarAvisoPessoalAosDestinos(
  destinos: ReadonlyArray<{ identidade: string | number; enviar: () => Promise<unknown> }>,
  registrar?: (destinos: DestinoDoAvisoPessoal[]) => Promise<void>,
): Promise<EntregaDoAvisoPessoal> {
  const estados = destinos.map(d => ({ destinoHash: hashPessoal(String(d.identidade)), estado: "naoTentado" as EstadoDoDestinoPessoal }));
  if (new Set(estados.map(d => d.destinoHash)).size !== estados.length) throw new Error("Destino pessoal repetido.");
  const salvar = async () => registrar?.(estados.map(d => ({ ...d })));
  await salvar();
  // Serial: reserva persistida antes da chamada e resultado antes do proximo destino.
  for (let i = 0; i < destinos.length; i++) {
    estados[i].estado = "tentando";
    await salvar();
    try {
      const recibo = await destinos[i].enviar();
      estados[i].estado = recibo === null ? "incerto" : "entregue";
    } catch (err) {
      estados[i].estado = err instanceof ErroDeTelegram && [400, 401, 403, 404, 429].includes(err.status ?? 0) ? "recusado" : "incerto";
    }
    await salvar();
  }
  return { destinos: estados };
}

export interface RegistroDeEnviados {
  jaEnviado(chave: string, agora: Date): Promise<boolean>;
  /** Compatibilidade: marca somente entrega confirmada; nunca falha depois do transporte. */
  marcar(chave: string, agora: Date): Promise<void>;
  /** Encerra dedupe confirmado; reserva/incerteza nunca e liberada automaticamente. */
  esquecer(chave: string): Promise<void>;
  reservar(chave: string, agora: Date): Promise<ReservaPessoal>;
  registrarDestinos(token: string, destinos: DestinoDoAvisoPessoal[]): Promise<void>;
  concluir(token: string, estado: Exclude<EstadoDaTentativaPessoal, "reservado">, agora: Date): Promise<void>;
}

/** Sidecar privado e fonte da reserva; mapa numerico legado continua legivel por versoes antigas. */
export function criarRegistroDeEnviados(
  arquivo: string,
  opcoes: { log?: { error: (...a: unknown[]) => void }; retencaoMs?: number } = {},
): RegistroDeEnviados {
  const log = opcoes.log ?? console;
  const retencao = opcoes.retencaoMs ?? RETENCAO_DOS_ENVIADOS_MS;
  const journal = new EstadoOperacionalDuravel<JournalPessoal>(arquivo + ".tentativas.json", () => ({ versao: 1, tentativas: [] }), validarJournalPessoal);
  async function lerLegado(): Promise<Record<string, number>> {
    try {
      const bruto: unknown = JSON.parse(await fs.readFile(arquivo, "utf8"));
      if (!bruto || typeof bruto !== "object" || Array.isArray(bruto) || Object.values(bruto).some(v => typeof v !== "number" || !Number.isFinite(v))) throw new Error();
      return Object.assign(Object.create(null) as Record<string, number>, bruto);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("Registro legado ilegivel; preserve os arquivos e confira antes de repetir.");
    }
  }
  const usar = <R>(fn: (j: JournalPessoal, salvar: () => Promise<void>, legado: Record<string, number>) => Promise<R>) =>
    journal.usar(async (j, salvar) => fn(j, salvar, await lerLegado()));
  const confirmado = (t: TentativaPessoal, agora: Date) => !t.dedupeEncerrado && ["telegram", "fila"].includes(t.estado) && agora.getTime() - t.atualizadoEm < retencao;
  async function espelhar(legado: Record<string, number>): Promise<void> {
    const tmp = arquivo + "." + randomUUID() + ".tmp";
    try { await fs.writeFile(tmp, JSON.stringify(legado) + "\n", { mode: 0o600, flag: "wx" }); await fs.rename(tmp, arquivo); }
    catch { await fs.rm(tmp, { force: true }).catch(() => undefined); log.error("[avisos] espelho legado nao gravado; a reserva privada permanece. Confira antes de voltar versao."); }
  }
  return {
    async jaEnviado(chave, agora) {
      return usar(async (j, _salvar, legado) => j.tentativas.some(t => t.chaveHash === hashPessoal(chave) && confirmado(t, agora)) ||
        (legado[chave] !== undefined && agora.getTime() - legado[chave] < retencao));
    },
    async reservar(chave, agora) {
      return usar(async (j, salvar, legado) => {
        const hash = hashPessoal(chave);
        // Nunca expira reserva interrompida ou resultado incerto, mesmo alem de 24 h.
        if (j.tentativas.some(t => t.chaveHash === hash && ["reservado", "incerto"].includes(t.estado))) return { estado: "incerto" };
        if (j.tentativas.some(t => t.chaveHash === hash && confirmado(t, agora)) || (legado[chave] !== undefined && agora.getTime() - legado[chave] < retencao)) return { estado: "repetido" };
        const token = randomUUID();
        j.tentativas.push({ id: token, chaveHash: hash, estado: "reservado", em: agora.getTime(), atualizadoEm: agora.getTime(), destinos: [] });
        await salvar();
        return { estado: "reservado", token };
      });
    },
    async registrarDestinos(token, destinos) {
      await usar(async (j, salvar) => {
        const t = j.tentativas.find(t => t.id === token);
        if (!t || t.estado !== "reservado") throw new Error("Reserva pessoal indisponivel.");
        t.destinos = destinos.map(d => ({ destinoHash: d.destinoHash, estado: d.estado })); await salvar();
      });
    },
    async concluir(token, estado, agora) {
      await usar(async (j, salvar) => {
        const t = j.tentativas.find(t => t.id === token);
        if (!t || t.estado !== "reservado") throw new Error("Reserva pessoal indisponivel.");
        t.estado = estado; t.atualizadoEm = agora.getTime(); await salvar();
      });
    },
    async marcar(chave, agora) {
      try {
        await usar(async (j, salvar, legado) => {
          const hash = hashPessoal(chave);
          if (!j.tentativas.some(t => t.chaveHash === hash && confirmado(t, agora))) {
            j.tentativas.push({ id: randomUUID(), chaveHash: hash, estado: "telegram", em: agora.getTime(), atualizadoEm: agora.getTime(), destinos: [] }); await salvar();
          }
          legado[chave] = agora.getTime();
          await espelhar(legado);
        });
      } catch { log.error("[avisos] confirmacao pessoal nao persistida; preservar reserva e conferir antes de repetir."); }
    },
    async esquecer(chave) {
      await usar(async (j, salvar, legado) => {
        let mudou = false;
        for (const t of j.tentativas) if (t.chaveHash === hashPessoal(chave) && ["telegram", "fila"].includes(t.estado) && !t.dedupeEncerrado) { t.dedupeEncerrado = true; mudou = true; }
        if (mudou) await salvar();
        if (Object.hasOwn(legado, chave)) { delete legado[chave]; await espelhar(legado); }
      });
    },
  };
}

export interface DepsDePublicacao {
  /** Pasta da fila (`~/.local/share/avisos/fila`). */
  fila: string;
  /**
   * sendMessage do bot ao chat do dono para avisos pessoais. P0 usa a outbox e o dell-status. `silencioso` chega
   * sem som (o `disable_notification` da Bot API).
   * Retorno por destino distingue recusa de incerteza. Excecao apos tentativa nunca autoriza fallback.
   */
  telegram?: (texto: string, opcoes?: { silencioso?: boolean }, registrar?: (destinos: DestinoDoAvisoPessoal[]) => Promise<void>) => Promise<void | EntregaDoAvisoPessoal>;
  /** Só o caminho pessoal consulta e grava (`publicarAvisoPessoal`). Ausente = somente fila, sem iniciar Telegram direto. */
  enviados?: RegistroDeEnviados;
  agora?: () => Date;
  log?: { error: (...a: unknown[]) => void };
}

export interface ResultadoDaPublicacao {
  arquivo: string | null;
  telegram: "enviado" | "falhou" | "naoSeAplica" | "pendente";
}

/**
 * Publicação durável. P0 aguarda o único emissor (dell-status) e nunca aciona
 * outro transporte daqui. Falha de persistência lança: o produtor não confirma
 * a publicação e tenta novamente. Avisos normais conservam seu roteamento.
 */
export async function publicarAviso(aviso: Aviso, deps: DepsDePublicacao): Promise<ResultadoDaPublicacao> {
  validarAviso(aviso);
  const arquivo = await gravarAvisoNaFila(deps.fila, aviso, deps.agora?.() ?? new Date());
  return { arquivo, telegram: avisoExigeTelegram(aviso) ? 'pendente' : 'naoSeAplica' };
}

/**
 * Aviso pessoal pelo Telegram (16/10/2026, OT-14 do blueprint; exceção da regra 20 escolhida pelo
 * Rômulo): o lembrete da agenda e o alerta de finanças saíam pelo WhatsApp do Hermes, que é o mesmo
 * número que fala com os leads e levou restrição de 24 h em 15/10. Cada aviso pessoal era uma
 * mensagem a mais na conta desse número. Agora:
 * - vai pelo bot do Telegram (Bot API oficial, sem risco para o número de vendas);
 * - das 22h às 7h de São Paulo chega sem som (o silêncio que a fila já fazia);
 * - Telegram desligado ou todos os destinos recusados explicitamente: usa a fila pessoal;
 * - timeout, erro ambiguo ou entrega parcial: conserva reserva revisavel sem fallback/repeticao;
 * - a mesma chave não sai duas vezes em 24 h, mesmo depois de reinício (`deps.enviados`);
 * - a validação é a mesma da fila (schema e nenhum R$, regra 24).
 * O P0 segue por `publicarAviso` (outbox exclusiva do Telegram).
 */
export function noSilencio(agora: Date): boolean {
  return ehMadrugada(agora);
}

export interface ResultadoDoPessoal {
  /** Repetido: dedupe confirmado. Incerto: reserva bloqueada para conferencia, sem declarar envio. */
  canal: "telegram" | "fila" | "repetido" | "incerto";
  arquivo: string | null;
}

export async function publicarAvisoPessoal(aviso: Aviso, deps: DepsDePublicacao): Promise<ResultadoDoPessoal> {
  validarAviso(aviso);
  const agora = deps.agora?.() ?? new Date();
  if (avisoExigeTelegram(aviso)) {
    const r = await publicarAviso(aviso, deps);
    return { canal: "fila", arquivo: r.arquivo };
  }
  // Sem reserva duravel, nao iniciar Telegram: a fila existente continua sendo o emissor unico.
  if (!deps.enviados) return { canal: "fila", arquivo: await gravarAvisoNaFila(deps.fila, aviso, agora) };
  const registro = deps.enviados;
  const reserva = await registro.reservar(aviso.chave, agora);
  if (reserva.estado !== "reservado") return { canal: reserva.estado, arquivo: null };
  const token = reserva.token, log = deps.log ?? console;
  const incerto = async (): Promise<ResultadoDoPessoal> => {
    await registro.concluir(token, "incerto", agora).catch(() => undefined); // Reserva anterior ja bloqueia repeticao.
    log.error("[avisos] entrega pessoal incerta; preservada para conferencia, sem fallback ou repeticao automatica.");
    return { canal: "incerto", arquivo: null };
  };
  if (deps.telegram) {
    let entrega: void | EntregaDoAvisoPessoal;
    try {
      entrega = await deps.telegram(textoDoAviso(aviso), { silencioso: noSilencio(agora) }, d => registro.registrarDestinos(token, d));
      if (entrega) await registro.registrarDestinos(token, entrega.destinos);
    } catch { return incerto(); }
    if (entrega && entrega.destinos.some(d => ["incerto", "tentando", "naoTentado"].includes(d.estado))) return incerto();
    if (!entrega || (entrega.destinos.length > 0 && entrega.destinos.every(d => d.estado === "entregue"))) {
      try { await registro.concluir(token, "telegram", agora); } catch { return incerto(); }
      await registro.marcar(aviso.chave, agora);
      return { canal: "telegram", arquivo: null };
    }
    // Entrega parcial nao dispara outro canal e nao repete os chats ja entregues.
    if (entrega.destinos.some(d => d.estado === "entregue")) return incerto();
    // Todos recusados explicitamente, ou nenhum destino/tentativa: fila pessoal pode assumir.
  }
  let arquivo: string;
  try { arquivo = await gravarAvisoNaFila(deps.fila, aviso, agora); }
  catch (e) {
    // A ausencia comprovada da pasta nao publicou arquivo. Outros erros permanecem revisaveis.
    if (e instanceof FilaDeAvisosAusente) await registro.concluir(token, "naoEnviado", agora);
    else await incerto();
    throw e;
  }
  try { await registro.concluir(token, "fila", agora); } catch { return incerto(); }
  await registro.marcar(aviso.chave, agora);
  return { canal: "fila", arquivo };
}

/** `SQUADONE_LEMBRETES_PELO_TELEGRAM=false` volta lembretes e alertas de finanças à fila do WhatsApp. */
export function avisosPessoaisPeloTelegram(env: NodeJS.ProcessEnv): boolean {
  return (env.SQUADONE_LEMBRETES_PELO_TELEGRAM ?? "").trim().toLowerCase() !== "false";
}
