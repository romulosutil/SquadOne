import {
  alocar,
  BLOCO_MIN,
  BLOCOS_MAX,
  conflitos,
  dentroDaJanela,
  descreverJanela,
  DURACAO_MAX_MIN,
  ESFORCO_MAX_MIN,
  GRADE_MIN,
  HORIZONTE_DIAS,
  instanteLocal,
  lerInstante,
  proximoDia,
  type DataLocal,
  type Intervalo,
  type Janela,
} from "./alocador.ts";
import { ErroCalendario, marcasDoEvento, PREFIXO_DEADLINE, urlDeEventos } from "./calendar.ts";
import type { AgendaDoTurno } from "./agenda.ts";

export type TipoEvento = "time_blocking" | "deadline";

export interface EventoCriado {
  kind: "evento";
  titulo: string;
  responsavel_id: string;
  tipo: TipoEvento;
  dominio: string;
  /** ISO do instante; `AAAA-MM-DD` quando `dia_inteiro`. */
  inicio: string;
  /** ISO do instante; `AAAA-MM-DD` EXCLUSIVO quando `dia_inteiro` (como o Google). */
  fim: string;
  dia_inteiro: boolean;
  /** foco = bloco avulso; marco = o prazo; bloco = trabalho antes de um marco. */
  papel: "foco" | "marco" | "bloco";
  /** eventId do marco, só em `papel: "bloco"`. */
  prazo_ref?: string;
  eventId: string;
  htmlLink?: string;
  /**
   * Quem o PO marcou para contribuir (Fase 4). Só no evento principal do
   * compromisso — foco ou marco —, para o frontend pedir uma contribuição por
   * compromisso e não uma por bloco.
   */
  colaboradores_ids?: string[];
}

/**
 * Algo feito de um jeito diferente do pedido. `motivo` só quando há um gesto
 * certo para a UI: um bloco recusado por credencial pede reconectar, mesmo o
 * compromisso tendo saído em parte.
 */
export interface AvisoDoCompromisso {
  aviso: string;
  motivo?: "precisaConectar";
}

/** Resultado de UMA chamada de agendar_evento: um compromisso, 1..N eventos. */
export interface CompromissoAgendado {
  kind: "compromisso";
  titulo: string;
  responsavel_id: string;
  tipo: TipoEvento;
  dominio: string;
  /** Na ordem de criação: foco = [bloco]; prazo = [marco, ...blocos]. */
  eventos: EventoCriado[];
  /** O que foi feito mas não saiu como pedido (conflito, esforço parcial...). */
  avisos: AvisoDoCompromisso[];
  /** Minutos do esforço sem bloco reservado. 0 para foco. */
  faltou_min: number;
  /** Colaboradores válidos (Fase 4); o handler de agendar_evento preenche. */
  colaboradores_ids?: string[];
}

export interface PedidoDeCompromisso {
  args: Record<string, any>;
  /** Tipo imposto pelo toggle; null = o modelo escolheu. */
  tipoForcado: TipoEvento | null;
  squadId: string;
  calendarId: string;
  dominio: { id: string; nome: string };
  pessoa: { id: string; nome: string; papel: string };
  colorId: string;
  agenda: AgendaDoTurno;
}

const MIN_MS = 60_000;

const preenchido = (v: unknown) => v != null && String(v).trim() !== "";

function positivo(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const arredondar15 = (min: number) => Math.ceil(min / GRADE_MIN) * GRADE_MIN;

const dataTexto = (d: DataLocal) =>
  `${d.ano}-${String(d.mes).padStart(2, "0")}-${String(d.dia).padStart(2, "0")}`;

export function formatarMinutos(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function exigirInstante(valor: unknown, campo: string, fuso: string) {
  const lido = lerInstante(valor, fuso);
  if (!lido) {
    throw new Error(
      `Campo '${campo}' não é data (AAAA-MM-DD) nem data/hora ISO válida: ${String(valor)}`,
    );
  }
  return lido;
}

/**
 * Ordem em que os agendar_evento de um turno são alocados. Horário fixo
 * primeiro (o usuário já decidiu; os outros desviam dele), depois foco (o
 * "agora" é o que mais perde com a espera), depois prazos do mais próximo ao
 * mais distante. Empate: a ordem em que o modelo chamou.
 *
 * "Mais próximo" é pelo LIMITE EFETIVO dos blocos, não pelo texto do prazo:
 * "até hoje" (só data) vale até o fim da janela, então um prazo hoje às 13:00
 * é mais urgente e escolhe horário antes. Com 00:00 a ordem saía invertida.
 */
export function prioridadeDeAgendamento(
  args: Record<string, any>,
  tipoForcado: TipoEvento | null,
  janela: Janela,
): [number, number] {
  const { fuso } = janela;
  const tipo = tipoForcado ?? (args.tipo === "deadline" ? "deadline" : "time_blocking");
  if (tipo === "time_blocking") {
    const fixo = preenchido(args.inicio_fixo) ? lerInstante(args.inicio_fixo, fuso) : null;
    return [fixo && fixo.data === null ? 0 : 1, 0];
  }
  const prazo = lerInstante(args.prazo_final, fuso);
  return [2, prazo ? limiteDoTrabalho(prazo, janela.fimMin, fuso) : Number.MAX_SAFE_INTEGER];
}

async function gravar(
  p: PedidoDeCompromisso,
  corpo: Record<string, unknown>,
): Promise<{ id: string; htmlLink?: string }> {
  const resp = await fetch(urlDeEventos(p.calendarId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.agenda.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok) throw new ErroCalendario(resp.status, await resp.text().catch(() => ""));
  return (await resp.json()) as { id: string; htmlLink?: string };
}

/**
 * Um compromisso do modelo vira eventos no Google, com o horário escolhido
 * AQUI. O modelo só disse a intenção (tipo, duração/esforço, até quando).
 */
export async function agendarCompromisso(p: PedidoDeCompromisso): Promise<CompromissoAgendado> {
  // Antes de tudo: sem agenda não há o que alocar, e o erro já vem classificado.
  const ocupacao = await p.agenda.ocupacao();
  const { janela } = p.agenda;
  const fuso = janela.fuso;
  const agora = p.agenda.agora.getTime();
  const { args, pessoa, dominio } = p;

  const titulo = String(args.titulo ?? "").trim();
  if (!titulo) throw new Error("Campo 'titulo' vazio.");
  const tipo: TipoEvento =
    p.tipoForcado ?? (args.tipo === "deadline" ? "deadline" : "time_blocking");
  const avisos: AvisoDoCompromisso[] = [];
  const avisar = (aviso: string, motivo?: AvisoDoCompromisso["motivo"]) => {
    avisos.push(motivo ? { aviso, motivo } : { aviso });
  };
  const base = {
    titulo,
    responsavel_id: pessoa.id,
    tipo,
    dominio: dominio.id,
  };
  const descricao =
    `Criado pelo SquadOne. Domínio: ${dominio.nome}. ` +
    `Responsável: ${pessoa.nome} (${pessoa.papel}).`;

  const aPartirDe = preenchido(args.a_partir_de)
    ? exigirInstante(args.a_partir_de, "a_partir_de", fuso).instante
    : undefined;

  if (tipo === "time_blocking") {
    // Com o toggle forçando foco, o modelo pode ter pensado em prazo e mandado
    // só esforco_min: é a melhor pista de quanto tempo reservar.
    let duracao = arredondar15(
      positivo(args.duracao_min) ?? (p.tipoForcado ? positivo(args.esforco_min) : null) ?? 60,
    );
    if (duracao > DURACAO_MAX_MIN) {
      avisar(`Duração de ${formatarMinutos(duracao)} reduzida para ${formatarMinutos(DURACAO_MAX_MIN)}.`);
      duracao = DURACAO_MAX_MIN;
    }

    let slot: Intervalo;
    const fixo = preenchido(args.inicio_fixo)
      ? exigirInstante(args.inicio_fixo, "inicio_fixo", fuso)
      : null;
    if (fixo && fixo.data === null) {
      // O usuário disse a hora: respeita. Conflito é informação, não veto.
      slot = { inicio: fixo.instante, fim: fixo.instante + duracao * MIN_MS };
      if (slot.inicio < agora) avisar("O horário fixo pedido já passou.");
      if (slot.fim > agora + HORIZONTE_DIAS * 24 * 3600_000) {
        avisar(`Conflito não verificado: o horário fica além dos ${HORIZONTE_DIAS} dias lidos da agenda.`);
      } else {
        const colisoes = conflitos(ocupacao, slot);
        if (colisoes.length) {
          avisar(`O horário fixo conflita com ${colisoes.length} compromisso(s) já na agenda.`);
        }
      }
      if (!dentroDaJanela(slot, janela)) {
        avisar(`O horário fixo fica fora da janela de trabalho ${descreverJanela(janela)}.`);
      }
    } else {
      if (duracao > janela.fimMin - janela.inicioMin) {
        throw new Error(
          `duracao_min ${duracao} não cabe na janela de trabalho ${descreverJanela(janela)}.`,
        );
      }
      // `inicio_fixo` só com data (sem hora) não fixou horário: vale como a_partir_de.
      const limite =
        p.tipoForcado && preenchido(args.prazo_final)
          ? limiteDoTrabalho(exigirInstante(args.prazo_final, "prazo_final", fuso), janela.fimMin, fuso)
          : undefined;
      const { slots } = alocar(
        ocupacao,
        janela,
        { tipo: "foco", duracaoMin: duracao, aPartirDe: fixo?.instante ?? aPartirDe, limite },
        agora,
      );
      slot = slots[0];
    }

    const criado = await gravar(p, {
      summary: `[${pessoa.papel}] ${titulo}`,
      description: descricao,
      colorId: p.colorId,
      start: { dateTime: new Date(slot.inicio).toISOString() },
      end: { dateTime: new Date(slot.fim).toISOString() },
      extendedProperties: {
        private: marcasDoEvento({ squadId: p.squadId, dominioId: dominio.id, pessoaId: pessoa.id, tipo }),
      },
    });
    p.agenda.reservar(slot);
    return {
      kind: "compromisso",
      ...base,
      eventos: [{
        kind: "evento", ...base, papel: "foco", dia_inteiro: false,
        inicio: new Date(slot.inicio).toISOString(), fim: new Date(slot.fim).toISOString(),
        eventId: criado.id, htmlLink: criado.htmlLink,
      }],
      avisos,
      faltou_min: 0,
    };
  }

  // --- deadline: marco no prazo + blocos antes ---------------------------
  let prazo: { instante: number; data: DataLocal | null };
  if (preenchido(args.prazo_final)) {
    prazo = exigirInstante(args.prazo_final, "prazo_final", fuso);
  } else if (p.tipoForcado && preenchido(args.inicio_fixo)) {
    // Toggle forçou prazo e o modelo descreveu um bloco: o limite é o FIM
    // do bloco descrito (regra da Fase 0).
    const fixo = exigirInstante(args.inicio_fixo, "inicio_fixo", fuso);
    prazo = fixo.data
      ? fixo
      : { instante: fixo.instante + (positivo(args.duracao_min) ?? 0) * MIN_MS, data: null };
  } else {
    throw new Error("Campo 'prazo_final' é obrigatório quando tipo='deadline'.");
  }

  const fimDoMarco = prazo.data
    ? instanteLocal(proximoDia(prazo.data), 0, fuso)
    : prazo.instante;
  if (fimDoMarco <= agora) throw new Error(`prazo_final ${String(args.prazo_final ?? args.inicio_fixo)} já passou.`);

  const esforcoBruto =
    positivo(args.esforco_min) ?? (p.tipoForcado ? positivo(args.duracao_min) : null);
  let slots: Intervalo[] = [];
  let faltou = 0;
  if (esforcoBruto === null) {
    avisar("Sem esforco_min estimado: só o marco do prazo foi criado, nenhum bloco de trabalho.");
  } else {
    let esforco = Math.max(BLOCO_MIN, arredondar15(esforcoBruto));
    if (esforco > ESFORCO_MAX_MIN) {
      avisar(`Esforço de ${formatarMinutos(esforco)} reduzido para ${formatarMinutos(ESFORCO_MAX_MIN)}.`);
      esforco = ESFORCO_MAX_MIN;
    }
    const alocacao = alocar(
      ocupacao,
      janela,
      { tipo: "blocos", esforcoMin: esforco, aPartirDe, limite: limiteDoTrabalho(prazo, janela.fimMin, fuso) },
      agora,
    );
    slots = alocacao.slots;
    faltou = alocacao.faltouMin;
    if (faltou > 0) {
      avisar(
        `Faltaram ${formatarMinutos(faltou)} de trabalho antes do prazo: não coube em horário ` +
          `livre da janela ${descreverJanela(janela)} (até ${BLOCOS_MAX} blocos por prazo).`,
      );
    }
  }

  // Marco primeiro: os blocos apontam para o eventId dele. Se o marco falha,
  // nada foi criado e o compromisso inteiro vira erro.
  const marcoCorpo = {
    summary: `${PREFIXO_DEADLINE} [${pessoa.papel}] ${titulo}`,
    description: `${descricao} Prazo final.`,
    colorId: p.colorId,
    // Marco não é trabalho: não ocupa a agenda.
    transparency: "transparent",
    ...(prazo.data
      ? { start: { date: dataTexto(prazo.data) }, end: { date: dataTexto(proximoDia(prazo.data)) } }
      : {
          start: { dateTime: new Date(prazo.instante - 15 * MIN_MS).toISOString() },
          end: { dateTime: new Date(prazo.instante).toISOString() },
        }),
    extendedProperties: {
      private: marcasDoEvento({ squadId: p.squadId, dominioId: dominio.id, pessoaId: pessoa.id, tipo: "deadline" }),
    },
  };
  const marco = await gravar(p, marcoCorpo);
  const eventos: EventoCriado[] = [{
    kind: "evento", ...base, tipo: "deadline", papel: "marco",
    dia_inteiro: prazo.data !== null,
    inicio: prazo.data ? dataTexto(prazo.data) : new Date(prazo.instante - 15 * MIN_MS).toISOString(),
    fim: prazo.data ? dataTexto(proximoDia(prazo.data)) : new Date(prazo.instante).toISOString(),
    eventId: marco.id, htmlLink: marco.htmlLink,
  }];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const rotulo = `bloco ${i + 1}/${slots.length}`;
    try {
      const bloco = await gravar(p, {
        summary: `[${pessoa.papel}] ${titulo} (${rotulo})`,
        description: `${descricao} Trabalho para o prazo "${titulo}" (${rotulo}).`,
        colorId: p.colorId,
        start: { dateTime: new Date(slot.inicio).toISOString() },
        end: { dateTime: new Date(slot.fim).toISOString() },
        extendedProperties: {
          private: marcasDoEvento({
            squadId: p.squadId, dominioId: dominio.id, pessoaId: pessoa.id,
            tipo: "time_blocking", prazoRef: marco.id,
          }),
        },
      });
      p.agenda.reservar(slot);
      eventos.push({
        kind: "evento", ...base, tipo: "time_blocking", papel: "bloco", dia_inteiro: false,
        inicio: new Date(slot.inicio).toISOString(), fim: new Date(slot.fim).toISOString(),
        prazo_ref: marco.id, eventId: bloco.id, htmlLink: bloco.htmlLink,
      });
    } catch (err: any) {
      // Não desfaz o que já foi gravado: o marco e os blocos anteriores
      // continuam certos. Para aqui para não abrir buracos no meio da série.
      const semReserva = slots.slice(i).reduce((s, x) => s + (x.fim - x.inicio) / MIN_MS, 0);
      faltou += semReserva;
      // Credencial recusada no meio da série é o mesmo gesto dos outros
      // caminhos (reconectar): sem o motivo, a UI seguiria achando que está
      // conectada e o próximo turno falharia igual.
      avisar(
        `O ${rotulo} não foi criado (${err?.message ?? String(err)}); ` +
          `${formatarMinutos(semReserva)} ficaram sem reserva.`,
        err instanceof ErroCalendario && err.ehCredencial ? "precisaConectar" : undefined,
      );
      break;
    }
  }

  return { kind: "compromisso", ...base, eventos, avisos, faltou_min: faltou };
}

/**
 * Até quando pode haver trabalho para um prazo. Com hora: o próprio prazo.
 * Só com data: o fim da janela daquele dia — "até sexta" inclui a sexta.
 */
function limiteDoTrabalho(
  prazo: { instante: number; data: DataLocal | null },
  fimJanelaMin: number,
  fuso: string,
): number {
  return prazo.data ? instanteLocal(prazo.data, fimJanelaMin, fuso) : prazo.instante;
}
