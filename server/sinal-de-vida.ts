import type { StatusDoDell } from "./dell-status.ts";

/**
 * Sinal de vida para o healthchecks.io (regra 20): quem avisa que o Dell sumiu
 * tem de estar FORA dele, porque o Hermes cai junto. O processo pinga
 * `DEADMAN_URL` a cada minuto; se o ping parar (processo, Dell ou rede fora), o
 * healthchecks avisa por Telegram e e-mail. O sinal leva só o nome do check
 * (a URL), nenhum dado: GET sem corpo.
 *
 * `/fail` em duas situações, as duas em que quem avisaria também parou:
 * - a sessão do WhatsApp fica fora de "aberta" por mais de 15 min: a fila de reserva e os avisos
 *   do dell-status (falhas, P1 de operação) não chegam. Os lembretes e alertas pessoais vão pelo
 *   Telegram e não dependem dela, mas o resto do Dell sim;
 * - a vigia dos lembretes (quando ligada) não completa uma varredura com sucesso há mais de 5 min
 *   (sem credencial do Google, Google fora, leitura presa): os lembretes pararam em silêncio e o
 *   aviso disso depende do mesmo Google.
 * O estado do WhatsApp vem do `status.json` do dell-status (regra 19: o SquadOne não roda
 * verificação); retrato velho ou sem a verificação conta como "não sei", e "não sei" por 15 min
 * também é falha — sem retrato, a fila também não drena.
 */

export const INTERVALO_SINAL_MS = 60_000;
export const LIMITE_WHATSAPP_FORA_MS = 15 * 60_000;
/** Sem varredura completa da vigia por mais que isto, o sinal vira /fail. */
export const LIMITE_VIGIA_PARADA_MS = 5 * 60_000;
export const TIMEOUT_SINAL_MS = 10_000;
export const ID_VERIFICACAO_WHATSAPP = "whatsapp-sessao";

export class SinalMalConfigurado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SinalMalConfigurado";
  }
}

/**
 * Ausente/vazia = desligado. Presente exige https (o healthchecks.io ou um
 * próprio). A mensagem nunca repete a URL: o UUID do check é quem pinga.
 */
export function lerUrlDoSinal(env: NodeJS.ProcessEnv = process.env): string | null {
  const bruto = (env.DEADMAN_URL ?? "").trim();
  if (!bruto) return null;
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new SinalMalConfigurado("DEADMAN_URL não é uma URL (ex.: https://hc-ping.com/<uuid>).");
  }
  if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) {
    throw new SinalMalConfigurado("DEADMAN_URL precisa ser https, sem query, fragmento nem credencial.");
  }
  return url.href.replace(/\/+$/, "");
}

/** PURO: a sessão está aberta segundo o retrato. null = não dá para saber. */
export function whatsappAberto(status: StatusDoDell): boolean | null {
  // `monitor` em falha = retrato velho (o interpretador o põe na frente).
  if (status.verificacoes.some((v) => v.id === "monitor" && v.estado === "falha")) return null;
  if (!status.geradoEm) return null;
  const v = status.verificacoes.find((x) => x.id === ID_VERIFICACAO_WHATSAPP);
  return v ? v.estado === "ok" : null;
}

/**
 * PURO: o próximo estado do relógio de "fora" e para onde pingar. `foraDesde`
 * é o primeiro instante em que a sessão não estava aberta (null = aberta).
 */
export function decidirSinal(
  aberto: boolean | null,
  foraDesde: number | null,
  agora: number,
): { foraDesde: number | null; falha: boolean } {
  if (aberto === true) return { foraDesde: null, falha: false };
  const desde = foraDesde ?? agora;
  return { foraDesde: desde, falha: agora - desde > LIMITE_WHATSAPP_FORA_MS };
}

/**
 * PURO: a vigia está parada? `ultimaOk` é a última varredura completa; null = nenhuma desde o boot,
 * e então a carência conta do `desde` (o início do sinal), para o boot não nascer em /fail.
 */
export function vigiaParada(ultimaOk: number | null, desde: number, agora: number): boolean {
  return agora - (ultimaOk ?? desde) > LIMITE_VIGIA_PARADA_MS;
}

export interface DepsDoSinal {
  url: string;
  lerStatus(agora: Date): Promise<StatusDoDell>;
  /** Instante (ms) da última varredura completa da vigia. Ausente = a vigia não está ligada neste processo. */
  ultimaVarreduraOkEm?: () => number | null;
  /** GET na URL (com `/fail` quando é falha). */
  pingar(url: string): Promise<void>;
  agora?: () => Date;
  log?: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

export function criarSinalDeVida(deps: DepsDoSinal) {
  const log = deps.log ?? console;
  let foraDesde: number | null = null;
  let falhaAntes: boolean | null = null;
  let vigiaAntes: boolean | null = null;
  let erroAntes: string | null = null;
  let comecouEm: number | null = null;

  /** Um sinal. Devolve qual foi mandado. Nunca lança: falha do healthchecks é só log. */
  async function enviar(): Promise<"ok" | "fail"> {
    const agora = deps.agora?.() ?? new Date();
    let aberto: boolean | null = null;
    try {
      aberto = whatsappAberto(await deps.lerStatus(agora));
    } catch {
      aberto = null;
    }
    const decisao = decidirSinal(aberto, foraDesde, agora.getTime());
    foraDesde = decisao.foraDesde;
    comecouEm ??= agora.getTime();
    const vigiaFalha = deps.ultimaVarreduraOkEm ? vigiaParada(deps.ultimaVarreduraOkEm(), comecouEm, agora.getTime()) : false;
    const falha = decisao.falha || vigiaFalha;
    const tipo = falha ? "fail" : "ok";
    if (decisao.falha !== falhaAntes) {
      log.log(decisao.falha ? "[sinal] WhatsApp fora há mais de 15 min: healthchecks recebe /fail" : "[sinal] sinal de vida normal");
      falhaAntes = decisao.falha;
    }
    if (vigiaFalha !== vigiaAntes && (vigiaFalha || vigiaAntes !== null)) {
      log.log(vigiaFalha ? "[sinal] vigia sem varredura completa há mais de 5 min: healthchecks recebe /fail" : "[sinal] vigia varrendo de novo");
    }
    vigiaAntes = vigiaFalha;
    try {
      await deps.pingar(falha ? `${deps.url}/fail` : deps.url);
      if (erroAntes !== null) log.error("[sinal] healthchecks voltou a responder");
      erroAntes = null;
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      if (msg !== erroAntes) log.error(`[sinal] ping falhou: ${msg}`);
      erroAntes = msg;
    }
    return tipo;
  }

  function iniciar(): () => void {
    const id = setInterval(() => void enviar(), INTERVALO_SINAL_MS);
    id.unref?.();
    void enviar();
    return () => clearInterval(id);
  }

  return { enviar, iniciar };
}

/** O ping de verdade: GET sem corpo; o erro nunca repete a URL. */
export async function pingarHealthchecks(url: string): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_SINAL_MS) });
  } catch (err: any) {
    throw new Error(`healthchecks inacessível (${err?.cause?.code ?? err?.name ?? "erro de rede"})`);
  }
  if (!resp.ok) throw new Error(`healthchecks respondeu ${resp.status}`);
}
