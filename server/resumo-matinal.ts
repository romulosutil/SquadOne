/**
 * Resumo matinal (17/10/2026): UM aviso por dia com a agenda de hoje, pelo mesmo
 * caminho dos lembretes (Telegram, com a fila do WhatsApp de reserva). PURO: sem
 * fetch, relógio, env ou estado; quem varre (`vigia.ts`) passa o `agora`, a
 * janela e o último dia enviado.
 *
 * Só agenda, de propósito: finanças e CRM têm regra própria de valor/telefone no
 * canal (regra 24) e entram aqui só quando alguém decidir o texto exato.
 * Dia sem compromisso não manda nada: um "nada hoje" diário vira ruído e o
 * silêncio já diz o mesmo.
 */
import { dataLocal, instanteLocal, lerInstante, proximoDia, type DataLocal, type Janela } from "./alocador.ts";
import { LIMITES_DO_AVISO, semValores, umaLinha, type Aviso } from "./avisos.ts";
import { PREFIXO_DEADLINE, type QuestCalendario } from "./calendar.ts";
import { ORIGEM_DOS_LEMBRETES, referenciaDoEvento } from "./lembretes.ts";

const MIN_MS = 60_000;

/** A partir daqui o resumo sai (07:30 local, o sono do silêncio da fila acaba às 7h). */
export const RESUMO_A_PARTIR_DE_MIN = 7 * 60 + 30;
/** Depois daqui não sai mais: um servidor que volta às 15h não manda o "bom dia". */
export const RESUMO_ATE_MIN = 11 * 60;

/** Nasce ligado, como os lembretes; `SQUADONE_RESUMO_MATINAL=false` desliga. */
export function resumoMatinalLigado(env: NodeJS.ProcessEnv): boolean {
  return (env.SQUADONE_RESUMO_MATINAL ?? "").trim().toLowerCase() !== "false";
}

/** Linhas de agenda no texto; o resto vira "…e mais N". Longe do teto de 4000 caracteres do aviso. */
const MAX_LINHAS = 30;

/** `AAAA-MM-DD` do dia local de `d`. */
export function textoDaData(d: DataLocal): string {
  return `${d.ano}-${String(d.mes).padStart(2, "0")}-${String(d.dia).padStart(2, "0")}`;
}

/** Instantes [início, fim) do dia local, para a leitura do Google. Fim = meia-noite seguinte, sem somar 24 h. */
export function limitesDoDia(agora: number, fuso: string): { de: Date; ate: Date; data: DataLocal } {
  const hoje = dataLocal(agora, fuso);
  const data = { ano: hoje.ano, mes: hoje.mes, dia: hoje.dia };
  return { de: new Date(instanteLocal(data, 0, fuso)), ate: new Date(instanteLocal(proximoDia(data), 0, fuso)), data };
}

/**
 * O dia (`AAAA-MM-DD`) do resumo que está devido agora, ou null. Devido = dentro
 * de [07:30, 11:00) e ainda não enviado nesse dia. O dia entra na chave de quem
 * deduplica: virou a meia-noite, o resumo de ontem não bloqueia o de hoje.
 */
export function resumoDevido(agora: number, fuso: string, ultimoEnviado: string | null): string | null {
  const { data } = limitesDoDia(agora, fuso);
  const minutos = Math.floor((agora - instanteLocal(data, 0, fuso)) / MIN_MS);
  if (minutos < RESUMO_A_PARTIR_DE_MIN || minutos >= RESUMO_ATE_MIN) return null;
  const dia = textoDaData(data);
  return ultimoEnviado === dia ? null : dia;
}

interface Linha {
  quando: number;
  texto: string;
}

/**
 * O aviso do dia ou null (dia sem nada). Só eventos de domínio ativo (mesmo
 * critério da Mochila e dos lembretes); o mesmo evento lido de dois calendários
 * conta uma vez. Marco com horário aparece na hora do prazo (o fim), não no
 * início de folga em que o Google o grava.
 */
export function montarResumo(
  quests: QuestCalendario[],
  agora: number,
  janela: Janela,
  dominiosAtivos: Map<string, string>,
): Aviso | null {
  const { fuso } = janela;
  const { data, ate } = limitesDoDia(agora, fuso);
  const hoje = textoDaData(data);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const h = (instante: number) => hora.format(instante);

  const prazos: Linha[] = [];
  const blocos: Linha[] = [];
  const diaTodo: Linha[] = [];
  let focoMin = 0;

  for (const q of new Map(quests.map((x) => [x.eventId, x])).values()) {
    const nomeDoDominio = q.dominio ? dominiosAtivos.get(q.dominio) : undefined;
    if (nomeDoDominio === undefined) continue;
    const titulo = semValores(q.titulo.startsWith(PREFIXO_DEADLINE) ? q.titulo.slice(PREFIXO_DEADLINE.length) : q.titulo);
    const rotulo = `${umaLinha(titulo, 100)} · ${umaLinha(semValores(nomeDoDominio), 40)}`;

    const ref = referenciaDoEvento(q, janela);
    // Bloco de dia inteiro não tem referência: o dia vem da data do início.
    const inicio = lerInstante(q.inicio, fuso);
    const dia = ref !== null ? dataLocal(ref, fuso) : inicio ? (inicio.data ?? dataLocal(inicio.instante, fuso)) : null;
    if (!dia || textoDaData(dia) !== hoje) continue;

    if (q.tipo === "deadline") {
      const quando = ref ?? instanteLocal(data, 0, fuso);
      prazos.push({ quando, texto: `⏰ ${q.diaInteiro ? "vence hoje" : `até ${h(quando)}`} · ${rotulo}` });
    } else if (ref === null) {
      diaTodo.push({ quando: 0, texto: `📌 ${rotulo}` });
    } else {
      const fim = lerInstante(q.fim, fuso)?.instante ?? null;
      if (fim !== null && fim > ref) focoMin += Math.round((fim - ref) / MIN_MS);
      blocos.push({ quando: ref, texto: `${fim === null ? h(ref) : `${h(ref)}–${h(fim)}`} · ${rotulo}` });
    }
  }

  const total = prazos.length + blocos.length + diaTodo.length;
  if (total === 0) return null;

  const porHora = (a: Linha, b: Linha) => a.quando - b.quando;
  const secoes: string[][] = [];
  if (prazos.length) secoes.push(["Prazos", ...prazos.sort(porHora).map((l) => l.texto)]);
  if (blocos.length) {
    const horas = Math.floor(focoMin / 60);
    const min = focoMin % 60;
    const foco = focoMin > 0 ? ` (${horas > 0 ? `${horas}h${min ? String(min).padStart(2, "0") : ""}` : `${min} min`})` : "";
    secoes.push([`Blocos${foco}`, ...blocos.sort(porHora).map((l) => l.texto)]);
  }
  if (diaTodo.length) secoes.push(["O dia todo", ...diaTodo.map((l) => l.texto)]);

  // O corte é por linha de agenda, não de cabeçalho: o resto do dia fica no Google.
  let restante = MAX_LINHAS;
  const linhas: string[] = [];
  let cortadas = 0;
  for (const secao of secoes) {
    const [cabecalho, ...itens] = secao;
    const cabem = itens.slice(0, Math.max(0, restante));
    cortadas += itens.length - cabem.length;
    restante -= cabem.length;
    if (cabem.length) linhas.push("", cabecalho, ...cabem);
  }
  if (cortadas > 0) linhas.push("", `…e mais ${cortadas} no Google Agenda`);

  const diaPorExtenso = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, weekday: "long", day: "2-digit", month: "2-digit" }).format(
    instanteLocal(data, 12 * 60, fuso),
  );
  const resumo = `${total} ${total === 1 ? "compromisso" : "compromissos"}${prazos.length ? ` · ${prazos.length} ${prazos.length === 1 ? "prazo" : "prazos"}` : ""}`;
  const texto = [diaPorExtenso, ...linhas].join("\n").slice(0, LIMITES_DO_AVISO.texto);

  return {
    titulo: umaLinha(`☀️ Seu dia: ${resumo}`, LIMITES_DO_AVISO.titulo),
    texto,
    origem: ORIGEM_DOS_LEMBRETES,
    chave: `resumo-matinal:${hoje}`,
    // Como o bloco (P2): sem som das 22h às 7h e nada que fure o silêncio; o resumo sai depois das 7h30.
    prioridade: 2,
    // Vale o dia inteiro: preso na fila do WhatsApp (teto, Hermes fora) ainda serve de manhã.
    expiraEm: ate.toISOString(),
  };
}
