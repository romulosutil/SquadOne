import { Type, type FunctionDeclaration } from "@google/genai";
import type { Squad, SquadMember } from "./squad.ts";

export interface CapabilityContext {
  /** Access token OAuth do usuário (GIS, em memória no browser). */
  token: string | null;
  squad: Squad;
  agora: Date;
}

export interface EventoCriado {
  kind: "evento";
  titulo: string;
  po_id: string;
  tipo: "time_blocking" | "deadline";
  inicio: string;
  fim: string;
  eventId: string;
  htmlLink?: string;
}

export interface SugestaoContratacao {
  kind: "sugestao";
  papel: string;
  justificativa: string;
  escopo: string;
}

export type CapabilityResult = EventoCriado | SugestaoContratacao;

export interface Capability {
  declaration: FunctionDeclaration;
  handler: (
    args: Record<string, any>,
    ctx: CapabilityContext,
  ) => Promise<CapabilityResult>;
}

const CORES_POR_INDICE = ["9", "3", "2", "5", "6", "7", "10", "11", "4"];

function exigirMembro(squad: Squad, poId: unknown): SquadMember {
  const membro = squad.members.find((m) => m.id === poId);
  if (!membro) {
    const ids = squad.members.map((m) => m.id).join(", ");
    throw new Error(
      `po_id '${String(poId)}' não está no squad. Disponíveis: ${ids}`,
    );
  }
  return membro;
}

function exigirData(valor: unknown, campo: string): Date {
  const d = new Date(String(valor ?? ""));
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Campo '${campo}' não é uma data ISO válida: ${String(valor)}`);
  }
  return d;
}

const agendarEvento: Capability = {
  declaration: {
    name: "agendar_evento",
    description:
      "Cria um evento no Google Calendar do usuário. Use uma chamada por " +
      "compromisso: uma demanda com várias entregas vira várias chamadas.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        titulo: {
          type: Type.STRING,
          description: "Título curto e acionável do evento.",
        },
        po_id: {
          type: Type.STRING,
          description:
            "id do membro do squad responsável, exatamente como listado no roster.",
        },
        tipo: {
          type: Type.STRING,
          enum: ["time_blocking", "deadline"],
          description:
            "'time_blocking' reserva um bloco de execução; 'deadline' marca só o limite de entrega.",
        },
        inicio: {
          type: Type.STRING,
          description:
            "Obrigatório quando tipo='time_blocking'. Data/hora ISO 8601 com offset, ex: 2026-09-12T09:00:00-03:00.",
        },
        duracao_min: {
          type: Type.INTEGER,
          description:
            "Duração do bloco em minutos quando tipo='time_blocking'. Padrão 60.",
        },
        prazo_final: {
          type: Type.STRING,
          description:
            "Obrigatório quando tipo='deadline'. Data/hora ISO 8601 com offset do limite de entrega.",
        },
      },
      required: ["titulo", "po_id", "tipo"],
    },
  },

  async handler(args, ctx): Promise<EventoCriado> {
    if (!ctx.token) {
      throw new Error(
        "Sem access_token do Google: conecte o calendário antes de agendar.",
      );
    }

    const membro = exigirMembro(ctx.squad, args.po_id);
    const tipo = args.tipo === "deadline" ? "deadline" : "time_blocking";
    const titulo = String(args.titulo ?? "").trim();
    if (!titulo) throw new Error("Campo 'titulo' vazio.");

    // Cada branch calcula seu próprio par início/fim. O bug antigo declarava
    // endTime dentro do branch time_blocking e lia no branch deadline.
    let inicio: Date;
    let fim: Date;
    let summary: string;

    if (tipo === "time_blocking") {
      inicio = exigirData(args.inicio, "inicio");
      const duracao = Number(args.duracao_min) > 0 ? Number(args.duracao_min) : 60;
      fim = new Date(inicio.getTime() + duracao * 60_000);
      summary = `[${membro.papel}] ${titulo}`;
    } else {
      fim = exigirData(args.prazo_final, "prazo_final");
      inicio = new Date(fim.getTime() - 15 * 60_000);
      summary = `⏰ DEADLINE: [${membro.papel}] ${titulo}`;
    }

    const indice = ctx.squad.members.indexOf(membro);
    const event = {
      summary,
      description: `Criado pelo SquadOne. Responsável: ${membro.nome} (${membro.papel}).`,
      colorId: CORES_POR_INDICE[indice % CORES_POR_INDICE.length],
      start: { dateTime: inicio.toISOString() },
      end: { dateTime: fim.toISOString() },
      // Marca de propriedade: a Mochila lê com
      // events.list?privateExtendedProperty=squadone=*
      extendedProperties: { private: { squadone: membro.id } },
    };

    const resp = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      },
    );

    if (!resp.ok) {
      const corpo = await resp.text().catch(() => "");
      throw new Error(
        `Google Calendar respondeu ${resp.status}: ${corpo.slice(0, 300)}`,
      );
    }

    const criado = (await resp.json()) as { id: string; htmlLink?: string };
    return {
      kind: "evento",
      titulo,
      po_id: membro.id,
      tipo,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      eventId: criado.id,
      htmlLink: criado.htmlLink,
    };
  },
};

const sugerirContratacao: Capability = {
  declaration: {
    name: "sugerir_contratacao",
    description:
      "Propõe contratar um novo membro para o squad quando a demanda exige " +
      "um papel que o roster atual não cobre. Não contrata ninguém: devolve " +
      "uma proposta para o usuário aprovar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        papel: {
          type: Type.STRING,
          description: "Papel proposto, ex: 'Designer', 'QA'.",
        },
        justificativa: {
          type: Type.STRING,
          description: "Por que o roster atual não cobre esta demanda.",
        },
        escopo: {
          type: Type.STRING,
          description: "Que tipo de demanda passaria a ser roteada para este papel.",
        },
      },
      required: ["papel", "justificativa", "escopo"],
    },
  },

  // Sem efeito colateral: a contratação é decisão do usuário.
  async handler(args): Promise<SugestaoContratacao> {
    const papel = String(args.papel ?? "").trim();
    if (!papel) throw new Error("Campo 'papel' vazio.");
    return {
      kind: "sugestao",
      papel,
      justificativa: String(args.justificativa ?? ""),
      escopo: String(args.escopo ?? ""),
    };
  },
};

/** Registry: adicionar uma capacidade é adicionar uma entrada aqui. */
export const CAPABILITIES: Record<string, Capability> = {
  agendar_evento: agendarEvento,
  sugerir_contratacao: sugerirContratacao,
};

export function declarations(): FunctionDeclaration[] {
  return Object.values(CAPABILITIES).map((c) => c.declaration);
}
