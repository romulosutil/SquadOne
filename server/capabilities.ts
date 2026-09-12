import { Type, type FunctionDeclaration } from "@google/genai";
import {
  acharDominio,
  acharPessoa,
  idsDePessoas,
  MAX_DOMINIOS,
  proximoSlot,
  slug,
  type Dominio,
  type Pessoa,
  type Squad,
} from "./squad.ts";
import { marcasDoMembro, PREFIXO_DEADLINE, PROP_TIPO } from "./calendar.ts";

export interface CapabilityContext {
  /** Access token OAuth do usuário (GIS, em memória no browser). */
  token: string | null;
  squad: Squad;
  agora: Date;
}

export interface EventoCriado {
  kind: "evento";
  titulo: string;
  responsavel_id: string;
  tipo: "time_blocking" | "deadline";
  dominio: string;
  inicio: string;
  fim: string;
  eventId: string;
  htmlLink?: string;
}

/** Proposta de ABRIR UM DOMÍNIO novo: sala nova, PO novo. */
export interface PropostaDominio {
  kind: "dominio";
  dominio: string;
  papel_po: string;
  justificativa: string;
  escopo: string;
  /** Onde a sala nasceria, se aprovada. */
  slot: [number, number] | null;
}

/** Proposta de CONTRATAR DENTRO de um domínio existente: mesma sala. */
export interface PropostaIntegrante {
  kind: "integrante";
  dominio_id: string;
  dominio_nome: string;
  papel: string;
  justificativa: string;
  escopo: string;
}

export type Sugestao = PropostaDominio | PropostaIntegrante;
export type CapabilityResult = EventoCriado | Sugestao;

export interface Capability {
  declaration: FunctionDeclaration;
  handler: (
    args: Record<string, any>,
    ctx: CapabilityContext,
  ) => Promise<CapabilityResult>;
}

/** Uma cor por DOMÍNIO: no calendário a sala é a unidade que se lê de relance. */
const CORES_POR_DOMINIO = ["9", "3", "2", "5", "6", "7", "10", "11", "4"];

function exigirPessoa(squad: Squad, id: unknown): { pessoa: Pessoa; dominio: Dominio } {
  const achada = acharPessoa(squad, id);
  if (!achada) {
    throw new Error(
      `responsavel_id '${String(id)}' não está no squad. ` +
        `Disponíveis: ${idsDePessoas(squad).join(", ")}`,
    );
  }
  return achada;
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
        responsavel_id: {
          type: Type.STRING,
          description:
            "id da pessoa do squad responsável — pode ser o PO de um domínio " +
            "ou um integrante dele. Use exatamente um dos ids da árvore do roster. " +
            "O domínio do evento é derivado dela; não existe campo de domínio.",
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
      required: ["titulo", "responsavel_id", "tipo"],
    },
  },

  async handler(args, ctx): Promise<EventoCriado> {
    if (!ctx.token) {
      throw new Error(
        "Sem access_token do Google: conecte o calendário antes de agendar.",
      );
    }

    const { pessoa, dominio } = exigirPessoa(ctx.squad, args.responsavel_id);
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
      summary = `[${pessoa.papel}] ${titulo}`;
    } else {
      fim = exigirData(args.prazo_final, "prazo_final");
      inicio = new Date(fim.getTime() - 15 * 60_000);
      summary = `${PREFIXO_DEADLINE} [${pessoa.papel}] ${titulo}`;
    }

    const indice = ctx.squad.dominios.indexOf(dominio);
    const event = {
      summary,
      description:
        `Criado pelo SquadOne. Domínio: ${dominio.nome}. ` +
        `Responsável: ${pessoa.nome} (${pessoa.papel}).`,
      colorId: CORES_POR_DOMINIO[indice % CORES_POR_DOMINIO.length],
      start: { dateTime: inicio.toISOString() },
      end: { dateTime: fim.toISOString() },
      // Deadline é um marco, não trabalho: opaco, os 15min dele apareceriam
      // como "ocupado" e bloqueariam a agenda de quem consulta disponibilidade.
      ...(tipo === "deadline" ? { transparency: "transparent" } : {}),
      // Três marcas (ver server/calendar.ts): `squadone_dominio` é o eixo de
      // filtro do events.list, `squadone_membro` o de atribuição e
      // `squadone_tipo` a semântica — o prefixo do título é só rótulo, e o
      // usuário pode apagá-lo no Google sem trocar o tipo da quest.
      extendedProperties: {
        private: { ...marcasDoMembro(pessoa, dominio.id), [PROP_TIPO]: tipo },
      },
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
      responsavel_id: pessoa.id,
      tipo,
      dominio: dominio.id,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      eventId: criado.id,
      htmlLink: criado.htmlLink,
    };
  },
};

/**
 * Eixo de crescimento 1: um TEMA novo que nenhum domínio cobre. Abre sala.
 * Sem efeito colateral — quem contrata é o usuário, no card de aprovação.
 */
const criarPoDominio: Capability = {
  declaration: {
    name: "criar_po_dominio",
    description:
      "Propõe ABRIR UM DOMÍNIO novo, com um PO próprio, quando a demanda trata " +
      "de um tema que nenhum domínio atual cobre (ex: surge 'Financeiro' num " +
      "squad que só tem 'Produto'). Abre uma sala nova no escritório. Não use " +
      "quando o tema já tem domínio e falta apenas um papel dentro dele — nesse " +
      "caso use contratar_integrante. Não cria nada: devolve uma proposta para " +
      "o usuário aprovar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        dominio: {
          type: Type.STRING,
          description: "Nome do domínio proposto, ex: 'Financeiro', 'Saúde'.",
        },
        papel_po: {
          type: Type.STRING,
          description:
            "Papel do PO que assumiria o domínio, ex: 'PO Financeiro'.",
        },
        justificativa: {
          type: Type.STRING,
          description: "Por que nenhum domínio atual cobre este tema.",
        },
        escopo: {
          type: Type.STRING,
          description: "Que tipo de demanda passaria a ser roteada para este domínio.",
        },
      },
      required: ["dominio", "papel_po", "justificativa", "escopo"],
    },
  },

  async handler(args, ctx): Promise<PropostaDominio> {
    const dominio = String(args.dominio ?? "").trim();
    if (!dominio) throw new Error("Campo 'dominio' vazio.");

    // Proposta só vale se for executável. O id de um domínio é o slug do nome
    // e é a chave de filtro do calendário: dois domínios com o mesmo slug
    // misturariam os eventos dos dois.
    const id = slug(dominio);
    const existente = acharDominio(ctx.squad, id);
    if (existente) {
      throw new Error(
        `O domínio '${existente.nome}' (id '${id}') já existe. ` +
          `Para reforçá-lo, use contratar_integrante com dominio_id='${id}'.`,
      );
    }
    if (ctx.squad.dominios.length >= MAX_DOMINIOS) {
      throw new Error(
        `O escritório já tem ${MAX_DOMINIOS} domínios — não há sala livre para um novo.`,
      );
    }

    return {
      kind: "dominio",
      dominio,
      papel_po: String(args.papel_po ?? "PO").trim() || "PO",
      justificativa: String(args.justificativa ?? ""),
      escopo: String(args.escopo ?? ""),
      slot: proximoSlot(ctx.squad),
    };
  },
};

/**
 * Eixo de crescimento 2: o tema já tem domínio, falta um PAPEL dentro dele.
 * Não abre sala: o integrante entra na sala do PO que o contratou.
 */
const contratarIntegrante: Capability = {
  declaration: {
    name: "contratar_integrante",
    description:
      "Propõe CONTRATAR alguém DENTRO de um domínio existente (designer, tech " +
      "lead, QA...) quando o tema já tem dono mas falta um papel para executar. " +
      "O integrante entra na sala do domínio, junto com o PO — não abre sala " +
      "nova. Não contrata ninguém: devolve uma proposta para o usuário aprovar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        dominio_id: {
          type: Type.STRING,
          description:
            "id do domínio que receberia o integrante, exatamente como na árvore do roster.",
        },
        papel: {
          type: Type.STRING,
          description: "Papel proposto, ex: 'Designer', 'Tech Lead', 'QA'.",
        },
        justificativa: {
          type: Type.STRING,
          description: "Por que o domínio não dá conta da demanda com quem já tem.",
        },
        escopo: {
          type: Type.STRING,
          description: "Que tipo de tarefa passaria a ser roteada para este integrante.",
        },
      },
      required: ["dominio_id", "papel", "justificativa", "escopo"],
    },
  },

  async handler(args, ctx): Promise<PropostaIntegrante> {
    const dominio = acharDominio(ctx.squad, args.dominio_id);
    if (!dominio) {
      const ids = ctx.squad.dominios.map((d) => d.id).join(", ");
      throw new Error(
        `dominio_id '${String(args.dominio_id)}' não existe. Domínios: ${ids}. ` +
          `Se o tema não tem dono, use criar_po_dominio.`,
      );
    }
    const papel = String(args.papel ?? "").trim();
    if (!papel) throw new Error("Campo 'papel' vazio.");

    return {
      kind: "integrante",
      dominio_id: dominio.id,
      dominio_nome: dominio.nome,
      papel,
      justificativa: String(args.justificativa ?? ""),
      escopo: String(args.escopo ?? ""),
    };
  },
};

/** Registry: adicionar uma capacidade é adicionar uma entrada aqui. */
export const CAPABILITIES: Record<string, Capability> = {
  agendar_evento: agendarEvento,
  criar_po_dominio: criarPoDominio,
  contratar_integrante: contratarIntegrante,
};

export function declarations(): FunctionDeclaration[] {
  return Object.values(CAPABILITIES).map((c) => c.declaration);
}
