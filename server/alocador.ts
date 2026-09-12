/**
 * Alocador de horário: dado o que já ocupa a agenda, a janela de trabalho, um
 * pedido e o instante atual, devolve os slots. PURO de propósito — sem fetch,
 * sem relógio, sem env: a Fase 4 reusa para propor ajustes de duração, e só
 * uma função pura dá para verificar com tabela de casos.
 *
 * Instantes são epoch ms (number). Intervalos são semiabertos [inicio, fim).
 */

export const FUSO = "America/Sao_Paulo";

/** Grade de 15 min: todo slot começa e termina nela. */
export const GRADE_MIN = 15;
/** Menor bloco de trabalho que vale a pena: abaixo disso é troca de contexto. */
export const BLOCO_MIN = 30;
/** Maior bloco de trabalho contínuo antes de exigir outro bloco. */
export const BLOCO_MAX = 120;
/** Teto de blocos por prazo: cada bloco é um POST ao Google, em série, com o usuário esperando. */
export const BLOCOS_MAX = 20;
/** Folga entre dois blocos do MESMO prazo no mesmo dia. */
export const PAUSA_MIN = 15;
/** Focar Agora procura até 14 dias corridos a partir do início da busca. */
export const HORIZONTE_FOCO_DIAS = 14;
/** Nada é alocado além de 60 dias de agora: é o quanto de agenda o turno lê. */
export const HORIZONTE_DIAS = 60;
/** Esforço de um prazo acima de 40h é sinal de compromisso que devia ser quebrado. */
export const ESFORCO_MAX_MIN = 2400;
/** Bloco de foco maior que 12h não é bloco. */
export const DURACAO_MAX_MIN = 720;

const MIN_MS = 60_000;
const DIA_MS = 24 * 60 * MIN_MS;
const GRADE_MS = GRADE_MIN * MIN_MS;

export interface Intervalo {
  inicio: number;
  fim: number;
}

export interface Janela {
  /** Minutos desde 00:00 local. */
  inicioMin: number;
  /** Minutos desde 00:00 local; 1440 = meia-noite do dia seguinte. */
  fimMin: number;
  /** Dias ISO: 1 = segunda ... 7 = domingo. */
  dias: number[];
  fuso: string;
}

export interface DataLocal {
  ano: number;
  mes: number;
  dia: number;
}

export type PedidoDeSlot =
  | { tipo: "foco"; duracaoMin: number; aPartirDe?: number; limite?: number }
  | { tipo: "blocos"; esforcoMin: number; aPartirDe?: number; limite: number };

export interface Alocacao {
  slots: Intervalo[];
  /** Minutos do esforço que não couberam. Sempre 0 para foco. */
  faltouMin: number;
}

/** Não há slot livre para um foco dentro do horizonte. Vira erro da tarefa, não do turno. */
export class SemHorarioLivre extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SemHorarioLivre";
  }
}

/** JANELA_TRABALHO/DIAS_TRABALHO ilegíveis. Ambiente: nenhum clique conserta. */
export class JanelaMalConfigurada extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "JanelaMalConfigurada";
  }
}

// --- Tempo local -------------------------------------------------------

const formatadores = new Map<string, Intl.DateTimeFormat>();
function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

function partes(instante: number, fuso: string): Record<string, string> {
  return Object.fromEntries(formatador(fuso).formatToParts(instante).map((p) => [p.type, p.value]));
}

/** Offset local − UTC, em minutos, naquele instante. */
export function offsetMin(instante: number, fuso: string): number {
  const nome = partes(instante, fuso).timeZoneName ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(nome);
  if (!m) return 0; // "GMT" puro = +00:00
  const valor = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -valor : valor;
}

export function dataLocal(instante: number, fuso: string): DataLocal & { diaSemana: number } {
  const p = partes(instante, fuso);
  const ano = Number(p.year), mes = Number(p.month), dia = Number(p.day);
  const js = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  return { ano, mes, dia, diaSemana: js === 0 ? 7 : js };
}

export function proximoDia(d: DataLocal): DataLocal {
  const t = new Date(Date.UTC(d.ano, d.mes - 1, d.dia + 1));
  return { ano: t.getUTCFullYear(), mes: t.getUTCMonth() + 1, dia: t.getUTCDate() };
}

function diaSemanaDe(d: DataLocal): number {
  const js = new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay();
  return js === 0 ? 7 : js;
}

/**
 * Instante da hora de parede `minutos` do dia `data` no fuso. Nunca soma 24h:
 * dia com mudança de horário tem 23h ou 25h.
 * - Hora que não existe (adiantou o relógio): empurra para frente pelo tamanho
 *   do salto (02:30 num salto 02→03 vira 03:30).
 * - Hora que existe duas vezes (atrasou): a primeira.
 */
export function instanteLocal(data: DataLocal, minutos: number, fuso: string): number {
  const parede = Date.UTC(data.ano, data.mes - 1, data.dia, 0, minutos);
  const offAntes = offsetMin(parede - 12 * 3600_000, fuso);
  const offDepois = offsetMin(parede + 12 * 3600_000, fuso);
  const tAntes = parede - offAntes * MIN_MS;
  if (offAntes === offDepois) return tAntes;
  const tDepois = parede - offDepois * MIN_MS;
  const antesValido = offsetMin(tAntes, fuso) === offAntes;
  const depoisValido = offsetMin(tDepois, fuso) === offDepois;
  if (antesValido && depoisValido) return Math.min(tAntes, tDepois);
  if (antesValido) return tAntes;
  if (depoisValido) return tDepois;
  return tAntes; // lacuna: offset de antes cai depois do salto
}

const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const SEM_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const COM_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T/;

/**
 * O dia existe no calendário? `Date.UTC` e o parser do V8 normalizam calados
 * (30/02 vira 02/03): um dia inventado pelo modelo viraria outro dia.
 */
function dataExiste(ano: number, mes: number, dia: number): boolean {
  const volta = new Date(Date.UTC(ano, mes - 1, dia));
  return volta.getUTCMonth() + 1 === mes && volta.getUTCDate() === dia;
}

/**
 * Lê uma data do modelo. `AAAA-MM-DD` → meia-noite local com `data` preenchida
 * (quem chama decide o que "dia sem hora" significa). ISO com offset/Z → o
 * instante. ISO SEM offset → hora de parede no fuso, não no fuso do container
 * (que em produção é UTC). Qualquer outra coisa, inclusive dia ou hora que não
 * existem → null.
 */
export function lerInstante(
  valor: unknown,
  fuso: string,
): { instante: number; data: DataLocal | null } | null {
  const texto = String(valor ?? "").trim();
  let m = SO_DATA.exec(texto);
  if (m) {
    const data = { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
    if (!dataExiste(data.ano, data.mes, data.dia)) return null;
    return { instante: instanteLocal(data, 0, fuso), data };
  }
  m = SEM_OFFSET.exec(texto);
  if (m) {
    const data = { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
    const h = Number(m[4]), min = Number(m[5]), seg = Number(m[6] ?? 0);
    if (!dataExiste(data.ano, data.mes, data.dia) || h > 23 || min > 59 || seg > 59) return null;
    return { instante: instanteLocal(data, h * 60 + min, fuso) + seg * 1000, data: null };
  }
  m = COM_OFFSET.exec(texto);
  if (!m || !dataExiste(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
  const t = new Date(texto).getTime();
  return Number.isNaN(t) ? null : { instante: t, data: null };
}

// --- Janela -------------------------------------------------------------

const NOMES_DIA = ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function lerHora(texto: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(texto);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/**
 * Janela global de trabalho, do ambiente. Ausente = 09:00-19:00, seg a sex.
 * Presente e ilegível = erro, nunca o padrão calado: agendar fora da janela
 * que o usuário configurou é pior que não agendar.
 */
export function lerJanela(env: Record<string, string | undefined>): Janela {
  const bruto = (env.JANELA_TRABALHO ?? "").trim() || "09:00-19:00";
  const [a, b, ...resto] = bruto.split("-");
  const inicioMin = lerHora(a ?? ""), fimMin = lerHora(b ?? "");
  if (resto.length || inicioMin === null || fimMin === null) {
    throw new JanelaMalConfigurada(`JANELA_TRABALHO='${bruto}' não é HH:MM-HH:MM.`);
  }
  if (fimMin - inicioMin < BLOCO_MIN) {
    throw new JanelaMalConfigurada(
      `JANELA_TRABALHO='${bruto}' precisa terminar pelo menos ${BLOCO_MIN} min depois de começar.`,
    );
  }
  const diasBruto = (env.DIAS_TRABALHO ?? "").trim() || "1,2,3,4,5";
  const dias = diasBruto.split(",").map((s) => s.trim());
  if (!dias.every((d) => /^[1-7]$/.test(d)) || new Set(dias).size !== dias.length) {
    throw new JanelaMalConfigurada(
      `DIAS_TRABALHO='${diasBruto}' deve listar dias ISO 1-7 sem repetir (1 = segunda).`,
    );
  }
  return { inicioMin, fimMin, dias: dias.map(Number).sort((x, y) => x - y), fuso: FUSO };
}

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** "09:00–19:00 (seg, ter, qua, qui, sex)" — para o prompt e para mensagens. */
export function descreverJanela(j: Janela): string {
  return `${hhmm(j.inicioMin)}–${hhmm(j.fimMin)} (${j.dias.map((d) => NOMES_DIA[d]).join(", ")})`;
}

// --- Intervalos ---------------------------------------------------------

const teto = (t: number) => Math.ceil(t / GRADE_MS) * GRADE_MS;
const piso = (t: number) => Math.floor(t / GRADE_MS) * GRADE_MS;

/** Ordena e funde sobrepostos/encostados. Não muta a entrada. */
export function mesclar(intervalos: Intervalo[]): Intervalo[] {
  const ord = intervalos
    .filter((i) => i.fim > i.inicio)
    .map((i) => ({ ...i }))
    .sort((a, b) => a.inicio - b.inicio);
  const saida: Intervalo[] = [];
  for (const i of ord) {
    const ultimo = saida[saida.length - 1];
    if (ultimo && i.inicio <= ultimo.fim) ultimo.fim = Math.max(ultimo.fim, i.fim);
    else saida.push(i);
  }
  return saida;
}

/** Trechos de `[de, ate)` fora de `ocupado` (já mesclado), recortados para a grade. */
function livres(de: number, ate: number, ocupado: Intervalo[]): Intervalo[] {
  const saida: Intervalo[] = [];
  let cursor = de;
  for (const o of ocupado) {
    if (o.fim <= cursor) continue;
    if (o.inicio >= ate) break;
    if (o.inicio > cursor) saida.push({ inicio: cursor, fim: o.inicio });
    cursor = Math.max(cursor, o.fim);
    if (cursor >= ate) break;
  }
  if (cursor < ate) saida.push({ inicio: cursor, fim: ate });
  return saida
    .map((i) => ({ inicio: teto(i.inicio), fim: piso(i.fim) }))
    .filter((i) => i.fim > i.inicio);
}

/** A janela de cada dia de trabalho entre `de` e `ate`, recortada a esse intervalo. */
function janelasDosDias(de: number, ate: number, j: Janela): Intervalo[] {
  const saida: Intervalo[] = [];
  let d: DataLocal = dataLocal(de, j.fuso);
  while (instanteLocal(d, 0, j.fuso) < ate) {
    if (j.dias.includes(diaSemanaDe(d))) {
      const inicio = Math.max(instanteLocal(d, j.inicioMin, j.fuso), de);
      const fim = Math.min(instanteLocal(d, j.fimMin, j.fuso), ate);
      if (fim > inicio) saida.push({ inicio, fim });
    }
    d = proximoDia(d);
  }
  return saida;
}

/** Eventos que colidem com `slot`. Para horário fixo: conflito vira aviso. */
export function conflitos(ocupacao: Intervalo[], slot: Intervalo): Intervalo[] {
  return ocupacao.filter((o) => o.inicio < slot.fim && o.fim > slot.inicio);
}

/** O slot inteiro cabe na janela de um único dia de trabalho? */
export function dentroDaJanela(slot: Intervalo, j: Janela): boolean {
  const d = dataLocal(slot.inicio, j.fuso);
  if (!j.dias.includes(d.diaSemana)) return false;
  return slot.inicio >= instanteLocal(d, j.inicioMin, j.fuso) && slot.fim <= instanteLocal(d, j.fimMin, j.fuso);
}

/**
 * Tamanho do próximo bloco num trecho livre de `livreMin`, faltando `restanteMin`.
 * Nunca deixa um resto menor que BLOCO_MIN quando dá para evitar: 135 min viram
 * 105 + 30, não 120 + 15.
 */
function tamanhoDoBloco(livreMin: number, restanteMin: number): number {
  if (livreMin < BLOCO_MIN || restanteMin < BLOCO_MIN) return 0;
  let t = Math.min(BLOCO_MAX, livreMin, restanteMin);
  const sobra = restanteMin - t;
  if (sobra > 0 && sobra < BLOCO_MIN && restanteMin - BLOCO_MIN >= BLOCO_MIN) {
    t = restanteMin - BLOCO_MIN;
  }
  return t;
}

// --- Alocação -----------------------------------------------------------

export function alocar(
  ocupacao: Intervalo[],
  janela: Janela,
  pedido: PedidoDeSlot,
  agora: number,
): Alocacao {
  const base = teto(Math.max(agora, pedido.aPartirDe ?? agora));
  const tetoAbsoluto = agora + HORIZONTE_DIAS * DIA_MS;
  const ocupado = mesclar(ocupacao);

  if (pedido.tipo === "foco") {
    const fimBusca = Math.min(
      base + HORIZONTE_FOCO_DIAS * DIA_MS,
      pedido.limite ?? Infinity,
      tetoAbsoluto,
    );
    const duracaoMs = pedido.duracaoMin * MIN_MS;
    for (const dia of janelasDosDias(base, fimBusca, janela)) {
      for (const l of livres(dia.inicio, dia.fim, ocupado)) {
        if (l.fim - l.inicio >= duracaoMs) {
          return { slots: [{ inicio: l.inicio, fim: l.inicio + duracaoMs }], faltouMin: 0 };
        }
      }
    }
    throw new SemHorarioLivre(
      `Nenhum horário livre de ${pedido.duracaoMin} min na janela ` +
        `${descreverJanela(janela)} entre ${new Date(base).toISOString()} e ` +
        `${new Date(Math.max(base, fimBusca)).toISOString()}.`,
    );
  }

  const fimBusca = Math.min(pedido.limite, tetoAbsoluto);
  const dias = janelasDosDias(base, fimBusca, janela);
  const slots: Intervalo[] = [];
  let restante = pedido.esforcoMin;

  // Passada 1: no máximo um bloco por dia, do mais cedo para o mais tarde.
  // Prazo distante não deve comer o dia de hoje inteiro.
  for (const dia of dias) {
    if (restante < BLOCO_MIN || slots.length >= BLOCOS_MAX) break;
    for (const l of livres(dia.inicio, dia.fim, ocupado)) {
      const t = tamanhoDoBloco((l.fim - l.inicio) / MIN_MS, restante);
      if (t > 0) {
        slots.push({ inicio: l.inicio, fim: l.inicio + t * MIN_MS });
        restante -= t;
        break;
      }
    }
  }

  // Passada 2: o que sobrou vai onde couber, com pausa em volta dos blocos
  // deste mesmo prazo (senão dois blocos encostados seriam um bloco gigante).
  for (const dia of dias) {
    while (restante >= BLOCO_MIN && slots.length < BLOCOS_MAX) {
      const comPausa = slots.map((s) => ({
        inicio: s.inicio - PAUSA_MIN * MIN_MS,
        fim: s.fim + PAUSA_MIN * MIN_MS,
      }));
      const ocupadoAgora = mesclar([...ocupado, ...comPausa]);
      let achou = false;
      for (const l of livres(dia.inicio, dia.fim, ocupadoAgora)) {
        const t = tamanhoDoBloco((l.fim - l.inicio) / MIN_MS, restante);
        if (t > 0) {
          slots.push({ inicio: l.inicio, fim: l.inicio + t * MIN_MS });
          restante -= t;
          achou = true;
          break;
        }
      }
      if (!achou) break;
    }
  }

  slots.sort((a, b) => a.inicio - b.inicio);
  return { slots, faltouMin: restante };
}
