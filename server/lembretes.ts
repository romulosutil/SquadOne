/**
 * Lembretes: QUAIS eventos avisar e O QUE dizer. Sem fetch, relógio, env ou
 * estado — quem varre (`vigia.ts`) passa o `agora`, a janela e o que já foi
 * enviado. É isso que deixa testar o disparo sem esperar o horário real. O que
 * sai daqui é um `Aviso` (`avisos.ts`): o transporte é de quem publica.
 */
import { instanteLocal, lerInstante, type Janela } from "./alocador.ts";
import { LIMITES_DO_AVISO, semValores, umaLinha, type Aviso } from "./avisos.ts";
import { PREFIXO_DEADLINE, type QuestCalendario } from "./calendar.ts";
import { dominiosAtivos, squadsAtivas, type Roster } from "./squad.ts";

const MIN_MS = 60_000;

/**
 * Minutos de antecedência. Constante e não env: virar env é trocar isto por um
 * leitor como lerJanela.
 */
export const ANTECEDENCIA_LEMBRETE_MIN = 10;

/**
 * Intervalo entre varreduras. O aviso sai com até 1 min de atraso — irrelevante
 * frente a 10 de antecedência — e custa 1 events.list por calendário por minuto.
 */
export const VARREDURA_MS = 60_000;

export interface AlvosDaVarredura {
  /** Calendários distintos das squads ativas: um events.list por calendário. */
  calendarios: string[];
  /** id → nome dos domínios ativos. Evento de domínio fora daqui não avisa (mesmo critério da Mochila). */
  dominios: Map<string, string>;
}

export function alvosDoRoster(roster: Roster): AlvosDaVarredura {
  const squads = squadsAtivas(roster);
  const dominios = new Map<string, string>();
  for (const squad of squads) {
    for (const d of dominiosAtivos(squad)) dominios.set(d.id, d.nome);
  }
  return { calendarios: [...new Set(squads.map((s) => s.calendarId))], dominios };
}

export interface Disparo {
  /**
   * `eventId@referencia`. Com o instante na chave, um evento movido (Ajuste ou
   * edição no Google) depois do aviso volta a ser avisado no horário novo.
   */
  chave: string;
  eventId: string;
  tipo: "time_blocking" | "deadline";
  /** Título sem o prefixo de deadline: a mensagem já diz que é prazo. */
  titulo: string;
  dominio: string;
  /** Instante contra o qual a antecedência conta. */
  referencia: number;
  /** Fim do bloco, para o intervalo no texto; null em marco. */
  fim: number | null;
  diaInteiro: boolean;
  htmlLink?: string;
}

/**
 * Contra que instante a antecedência conta. null = não avisa.
 * - bloco com horário: o início;
 * - bloco de dia inteiro: sem hora, sem aviso (mesmo caso sem alvo do Ajuste);
 * - marco com horário: o FIM — o marco é gravado de prazo − 15 min até o prazo,
 *   e o início é só a folga para ele aparecer na grade do Google;
 * - marco de dia inteiro: início da janela de trabalho do dia ("vence hoje"
 *   às 08:50, não meia-noite menos 10).
 */
export function referenciaDoEvento(q: QuestCalendario, janela: Janela): number | null {
  const { fuso } = janela;
  if (q.tipo === "time_blocking") {
    if (q.diaInteiro) return null;
    return lerInstante(q.inicio, fuso)?.instante ?? null;
  }
  if (q.diaInteiro) {
    const dia = lerInstante(q.inicio, fuso);
    return dia?.data ? instanteLocal(dia.data, janela.inicioMin, fuso) : null;
  }
  return lerInstante(q.fim, fuso)?.instante ?? null;
}

/**
 * Eventos cujo momento de avisar já chegou e cujo horário ainda não. A janela é
 * [referência − antecedência, referência): um aviso atrasado (servidor que
 * voltou no meio dela) ainda serve; depois do horário, não.
 */
export function disparosDevidos(
  quests: QuestCalendario[],
  agora: number,
  janela: Janela,
  dominiosAtivos: { has(id: string): boolean },
  jaEnviados: { has(chave: string): boolean },
  antecedenciaMin = ANTECEDENCIA_LEMBRETE_MIN,
): Disparo[] {
  const disparos: Disparo[] = [];
  for (const q of quests) {
    if (!q.dominio || !dominiosAtivos.has(q.dominio)) continue;
    const referencia = referenciaDoEvento(q, janela);
    if (referencia === null) continue;
    if (agora < referencia - antecedenciaMin * MIN_MS || agora >= referencia) continue;
    const chave = `${q.eventId}@${referencia}`;
    if (jaEnviados.has(chave)) continue;
    disparos.push({
      chave,
      eventId: q.eventId,
      tipo: q.tipo,
      titulo: q.titulo.startsWith(PREFIXO_DEADLINE) ? q.titulo.slice(PREFIXO_DEADLINE.length).trim() : q.titulo,
      dominio: q.dominio,
      referencia,
      fim: q.tipo === "time_blocking" ? (lerInstante(q.fim, janela.fuso)?.instante ?? null) : null,
      diaInteiro: q.diaInteiro,
      ...(q.htmlLink ? { htmlLink: q.htmlLink } : {}),
    });
  }
  return disparos.sort((a, b) => a.referencia - b.referencia);
}

/** Quem grava na fila: aparece no resumo do dell-status e nos recusados. */
export const ORIGEM_DOS_LEMBRETES = "squadone:vigia";

/**
 * Texto do aviso. Minutos contados do `agora` real, não da antecedência
 * nominal: um aviso atrasado diz quanto falta de verdade.
 *
 * - `chave` = `lembrete:<eventId>@<referência>`: o registro de 24 h de
 *   `publicarAvisoPessoal` (em disco) descarta a mesma chave, então um redeploy
 *   dentro dos 10 min não manda o lembrete de novo (a memória da vigia some no
 *   reinício; a fila do WhatsApp só dedupa o que cai nela, de reserva);
 * - `expiraEm` = o próprio horário: lembrete preso no teto por hora ou com o
 *   Hermes fora não serve depois. Marco de dia inteiro (avisa no início da
 *   janela) vale até o fim do dia;
 * - marco é P1 e bloco P2; nenhum é P0 (P0 fura o silêncio e vai aos dois canais);
 * - o título do compromisso vem do usuário: uma linha, cortado e sem valor em
 *   R$ (regra 24).
 * - `expiraEm` só vale na fila de reserva (o dell-status descarta o vencido); pelo
 *   Telegram o aviso sai na hora.
 */
export function mensagemDoDisparo(d: Disparo, agora: number, fuso: string, nomeDoDominio: string): Aviso {
  const formato = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const hora = (instante: number) => formato.format(instante);
  const faltam = Math.max(1, Math.ceil((d.referencia - agora) / MIN_MS));
  const titulo = (prefixo: string) => umaLinha(`${prefixo}${semValores(d.titulo)}`, LIMITES_DO_AVISO.titulo);
  const dominio = umaLinha(semValores(nomeDoDominio), 200);
  const comum = {
    origem: ORIGEM_DOS_LEMBRETES,
    chave: `lembrete:${d.chave}`,
    expiraEm: new Date(d.referencia).toISOString(),
    ...(d.htmlLink && d.htmlLink.length <= LIMITES_DO_AVISO.link ? { link: d.htmlLink } : {}),
  };

  if (d.tipo === "time_blocking") {
    const intervalo = d.fim === null ? hora(d.referencia) : `${hora(d.referencia)}–${hora(d.fim)}`;
    return { ...comum, titulo: titulo(`⏳ Em ${faltam} min: `), texto: `${intervalo} · ${dominio}`, prioridade: 2 };
  }
  if (d.diaInteiro) {
    return {
      ...comum,
      titulo: titulo("⏰ Prazo hoje: "),
      texto: `Vence hoje · ${dominio}`,
      prioridade: 1,
      expiraEm: new Date(d.referencia + 12 * 60 * MIN_MS).toISOString(),
    };
  }
  return { ...comum, titulo: titulo(`⏰ Prazo em ${faltam} min: `), texto: `Vence às ${hora(d.referencia)} · ${dominio}`, prioridade: 1 };
}
