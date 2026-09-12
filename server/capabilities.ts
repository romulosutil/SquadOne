import { Type, type FunctionDeclaration } from "@google/genai";
import {
  acharDominio,
  acharPessoa,
  idsDePessoas,
  MAX_DOMINIOS,
  novoIdDeDominio,
  proximoSlot,
  type Dominio,
  type Pessoa,
  type Roster,
  type Squad,
} from "./squad.ts";
import { marcasDoEvento, PREFIXO_DEADLINE, urlDeEventos } from "./calendar.ts";

/**
 * Toggle da CommandBar. `auto` deixa o modelo escolher o tipo de cada
 * compromisso; `foco` e `prazo` são o usuário dizendo o tipo de antemão.
 */
export type Modo = "auto" | "foco" | "prazo";

export function ehModo(valor: unknown): valor is Modo {
  return valor === "auto" || valor === "foco" || valor === "prazo";
}

/**
 * O que cada modo forçado impõe. Mora aqui, no handler, e não só no prompt:
 * a instrução ao modelo é pedido, não garantia — se ele divergir, o servidor
 * ainda grava o tipo que o usuário escolheu.
 */
const TIPO_FORCADO: Record<Modo, "time_blocking" | "deadline" | null> = {
  auto: null,
  foco: "time_blocking",
  prazo: "deadline",
};

export interface CapabilityContext {
  /**
   * Access token OAuth do usuário, obtido e renovado pelo servidor
   * (auth-store) — o browser nunca o vê. `null` quando não há credencial: o
   * turno roda assim mesmo e só as capacidades que tocam o Google falham.
   */
  token: string | null;
  /** O roster inteiro: unicidade de id é global. */
  roster: Roster;
  /** A squad ATIVA do turno. Capacidades só leem e agem dentro dela. */
  squad: Squad;
  agora: Date;
  modo: Modo;
  /** Texto original da demanda — vai na proposta de troca para "Trocar e reenviar". */
  demanda: string;
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
  /** Squad em que o turno rodou: a aprovação aplica nela, não na que a tela mostra. */
  squad_id: string;
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
  /** Squad em que o turno rodou: a aprovação aplica nela, não na que a tela mostra. */
  squad_id: string;
  dominio_id: string;
  dominio_nome: string;
  papel: string;
  justificativa: string;
  escopo: string;
}

/** Proposta de levar a demanda para OUTRA squad. Só propõe: trocar é gesto do usuário. */
export interface PropostaTrocaSquad {
  kind: "troca_squad";
  /** Squad em que o turno rodou (origem), como nas outras propostas. */
  squad_id: string;
  destino_id: string;
  destino_nome: string;
  justificativa: string;
  demanda: string;
}

/**
 * Proposta como sai do turno. O `id` é carimbado no orchestrator, não no
 * handler: é identidade do card na tela (aprovar/descartar/`:key`), não dado
 * da proposta — por índice, remover um card fazia o seguinte herdar o nome
 * digitado e a aprovação em curso.
 */
export type Sugestao = (PropostaDominio | PropostaIntegrante | PropostaTrocaSquad) & { id: string };
export type CapabilityResult = EventoCriado | PropostaDominio | PropostaIntegrante | PropostaTrocaSquad;

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
      `responsavel_id '${String(id)}' não está na squad '${squad.nome}'. ` +
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
    const forcado = TIPO_FORCADO[ctx.modo];
    const tipo = forcado ?? (args.tipo === "deadline" ? "deadline" : "time_blocking");
    const titulo = String(args.titulo ?? "").trim();
    if (!titulo) throw new Error("Campo 'titulo' vazio.");

    // Com o tipo forçado, o modelo pode ter preenchido o campo de horário do
    // OUTRO tipo (pensou em bloco, mandou só `inicio`). O horário que ele deu
    // continua sendo a melhor referência de quando, e falhar perderia um
    // compromisso bem descrito. Regra: deadline sem `prazo_final` tem como
    // limite o FIM do bloco que o modelo descreveu (`inicio` + `duracao_min`;
    // "estudar 2h amanhã 14h" termina 16h, não 14h) e, sem `duracao_min`, o
    // próprio `inicio`; bloco sem `inicio` TERMINA no `prazo_final` (o trabalho
    // vem antes do limite, não depois). Só com modo forçado: no auto a
    // incoerência é do próprio modelo e o erro volta nomeado.
    const preenchido = (v: unknown) => v != null && String(v).trim() !== "";

    // Cada branch calcula seu próprio par início/fim. O bug antigo declarava
    // endTime dentro do branch time_blocking e lia no branch deadline.
    let inicio: Date;
    let fim: Date;
    let summary: string;

    if (tipo === "time_blocking") {
      const duracao = Number(args.duracao_min) > 0 ? Number(args.duracao_min) : 60;
      if (forcado && !preenchido(args.inicio) && preenchido(args.prazo_final)) {
        fim = exigirData(args.prazo_final, "prazo_final");
        inicio = new Date(fim.getTime() - duracao * 60_000);
      } else {
        inicio = exigirData(args.inicio, "inicio");
        fim = new Date(inicio.getTime() + duracao * 60_000);
      }
      summary = `[${pessoa.papel}] ${titulo}`;
    } else {
      const usarInicio = forcado && !preenchido(args.prazo_final) && preenchido(args.inicio);
      if (usarInicio) {
        const duracao = Number(args.duracao_min) > 0 ? Number(args.duracao_min) : 0;
        fim = new Date(exigirData(args.inicio, "inicio").getTime() + duracao * 60_000);
      } else {
        fim = exigirData(args.prazo_final, "prazo_final");
      }
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
      // Quatro marcas (contrato da Fase 1, ver server/calendar.ts): squad
      // informa, domínio filtra o events.list, membro atribui e tipo dá a
      // semântica — o prefixo do título é só rótulo, e o usuário pode apagá-lo
      // no Google sem trocar o tipo da quest.
      extendedProperties: {
        private: marcasDoEvento({
          squadId: ctx.squad.id,
          dominioId: dominio.id,
          pessoaId: pessoa.id,
          tipo,
        }),
      },
    };

    const resp = await fetch(urlDeEventos(ctx.squad.calendarId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

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
      "de um tema que nenhum domínio atual cobre (ex: surge 'Financeiro' numa " +
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

    const slot = proximoSlot(ctx.squad);
    if (!slot) {
      throw new Error(
        `A squad '${ctx.squad.nome}' já tem ${MAX_DOMINIOS} domínios — não há sala livre para um novo.`,
      );
    }
    // Proposta só vale se for executável: a mesma regra de id que a aprovação
    // vai aplicar (nome repetido na squad, id já usado em qualquer squad). O id
    // é a chave de filtro do calendário: dois domínios com o mesmo id
    // misturariam os eventos dos dois.
    try {
      novoIdDeDominio(ctx.roster, ctx.squad, dominio);
    } catch (err: any) {
      throw new Error(`${err.message} Para reforçar um domínio existente, use contratar_integrante.`);
    }

    return {
      kind: "dominio",
      squad_id: ctx.squad.id,
      dominio,
      papel_po: String(args.papel_po ?? "PO").trim() || "PO",
      justificativa: String(args.justificativa ?? ""),
      escopo: String(args.escopo ?? ""),
      slot,
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
        `dominio_id '${String(args.dominio_id)}' não existe na squad '${ctx.squad.nome}'. Domínios: ${ids}. ` +
          `Se o tema não tem dono, use criar_po_dominio.`,
      );
    }
    const papel = String(args.papel ?? "").trim();
    if (!papel) throw new Error("Campo 'papel' vazio.");

    return {
      kind: "integrante",
      squad_id: ctx.squad.id,
      dominio_id: dominio.id,
      dominio_nome: dominio.nome,
      papel,
      justificativa: String(args.justificativa ?? ""),
      escopo: String(args.escopo ?? ""),
    };
  },
};

/**
 * A demanda é de OUTRA squad. O modelo não troca de squad nem agenda lá — ele
 * não vê os domínios e pessoas das outras. Só devolve um card; trocar (e
 * reenviar) é gesto do usuário.
 */
const sugerirTrocaSquad: Capability = {
  declaration: {
    name: "sugerir_troca_squad",
    description:
      "Propõe levar a demanda para OUTRA squad do usuário quando ela pertence " +
      "claramente ao escopo de uma das outras squads listadas no prompt. Não " +
      "agenda nada e não troca de squad: devolve uma proposta para o usuário aprovar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        squad_id: {
          type: Type.STRING,
          description: "id de uma das OUTRAS squads, exatamente como listado no prompt.",
        },
        justificativa: {
          type: Type.STRING,
          description: "Por que a demanda pertence ao escopo daquela squad e não desta.",
        },
      },
      required: ["squad_id", "justificativa"],
    },
  },

  async handler(args, ctx): Promise<PropostaTrocaSquad> {
    const destino = ctx.roster.squads.find((s) => s.id === args.squad_id);
    if (!destino) {
      const outras = ctx.roster.squads.filter((s) => s.id !== ctx.squad.id).map((s) => s.id);
      throw new Error(
        `squad_id '${String(args.squad_id)}' não existe. Outras squads: ${outras.join(", ") || "(nenhuma)"}.`,
      );
    }
    if (destino.id === ctx.squad.id) {
      throw new Error(`A demanda já está na squad '${destino.nome}': não há troca a sugerir.`);
    }
    return {
      kind: "troca_squad",
      squad_id: ctx.squad.id,
      destino_id: destino.id,
      destino_nome: destino.nome,
      justificativa: String(args.justificativa ?? ""),
      demanda: ctx.demanda,
    };
  },
};

/** Registry: adicionar uma capacidade é adicionar uma entrada aqui. */
export const CAPABILITIES: Record<string, Capability> = {
  agendar_evento: agendarEvento,
  criar_po_dominio: criarPoDominio,
  contratar_integrante: contratarIntegrante,
  sugerir_troca_squad: sugerirTrocaSquad,
};

export function declarations(): FunctionDeclaration[] {
  return Object.values(CAPABILITIES).map((c) => c.declaration);
}
