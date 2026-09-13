import { Type, type FunctionDeclaration } from "@google/genai";
import {
  acharDominio,
  acharPessoa,
  dominiosAtivos,
  idsDePessoas,
  MAX_DOMINIOS,
  novoIdDeDominio,
  proximoSlot,
  squadsAtivas,
  type Dominio,
  type Pessoa,
  type Roster,
  type Squad,
} from "./squad.ts";
import type { AgendaDoTurno } from "./agenda.ts";
import { agendarCompromisso, type CompromissoAgendado, type TipoEvento } from "./agendamento.ts";

export type { CompromissoAgendado, EventoCriado } from "./agendamento.ts";

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
const TIPO_FORCADO: Record<Modo, TipoEvento | null> = {
  auto: null,
  foco: "time_blocking",
  prazo: "deadline",
};

/** Tipo que o toggle impõe ao turno; null em `auto`. O orchestrator ordena por ele. */
export function tipoForcado(modo: Modo): TipoEvento | null {
  return TIPO_FORCADO[modo];
}

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
  /**
   * Ocupação da agenda neste turno: lida uma vez, descontada a cada reserva.
   * É por ela que dois compromissos da mesma demanda não caem no mesmo horário.
   */
  agenda: AgendaDoTurno;
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
export type CapabilityResult = CompromissoAgendado | PropostaDominio | PropostaIntegrante | PropostaTrocaSquad;

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

const agendarEvento: Capability = {
  declaration: {
    name: "agendar_evento",
    description:
      "Registra um compromisso na agenda do usuário. Você decide a INTENÇÃO — o quê, " +
      "quem, quanto tempo e até quando; o servidor escolhe o horário livre. Use uma " +
      "chamada por compromisso: uma demanda com várias entregas vira várias chamadas. " +
      "Um prazo com blocos de trabalho é UMA chamada.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        titulo: {
          type: Type.STRING,
          description: "Título curto e acionável do compromisso.",
        },
        responsavel_id: {
          type: Type.STRING,
          description:
            "id da pessoa da squad atual responsável — pode ser o PO de um domínio " +
            "ou um integrante dele. Use exatamente um dos ids da árvore do roster. " +
            "O domínio do evento é derivado dela; não existe campo de domínio.",
        },
        tipo: {
          type: Type.STRING,
          enum: ["time_blocking", "deadline"],
          description:
            "'time_blocking' reserva UM bloco de execução no próximo horário livre. " +
            "'deadline' marca a data limite e reserva blocos de trabalho antes dela, " +
            "somando esforco_min.",
        },
        duracao_min: {
          type: Type.INTEGER,
          description: "time_blocking: duração do bloco em minutos. Padrão 60.",
        },
        esforco_min: {
          type: Type.INTEGER,
          description:
            "deadline: sua estimativa realista do trabalho TOTAL até o prazo, em " +
            "minutos. O servidor divide em blocos.",
        },
        prazo_final: {
          type: Type.STRING,
          description:
            "Obrigatório quando tipo='deadline'. AAAA-MM-DD se o usuário não disse " +
            "hora (o marco vira dia inteiro); ISO 8601 com offset se disse.",
        },
        a_partir_de: {
          type: Type.STRING,
          description:
            "Opcional. Só quando o usuário disse QUANDO começar sem dizer a hora " +
            "('amanhã', 'segunda'). AAAA-MM-DD ou ISO 8601 com offset. O servidor " +
            "procura horário livre a partir daí.",
        },
        inicio_fixo: {
          type: Type.STRING,
          description:
            "Opcional, só time_blocking. Só quando o usuário disse a HORA exata " +
            "('amanhã às 14h'). ISO 8601 com offset. É respeitado mesmo com conflito.",
        },
      },
      required: ["titulo", "responsavel_id", "tipo"],
    },
  },

  async handler(args, ctx): Promise<CompromissoAgendado> {
    // Pessoa antes da agenda: id inventado pelo modelo não custa leitura do Google.
    const { pessoa, dominio } = exigirPessoa(ctx.squad, args.responsavel_id);
    const indice = ctx.squad.dominios.indexOf(dominio);
    // O horário sai do servidor (server/agendamento.ts): o modelo só disse a
    // intenção. Aqui fica o que é da squad — marcas, calendário, cor.
    return agendarCompromisso({
      args,
      tipoForcado: tipoForcado(ctx.modo),
      squadId: ctx.squad.id,
      calendarId: ctx.squad.calendarId,
      dominio,
      pessoa,
      colorId: CORES_POR_DOMINIO[indice % CORES_POR_DOMINIO.length],
      agenda: ctx.agenda,
    });
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
      "caso use contratar_integrante. Use também sempre que o usuário pedir " +
      "explicitamente para abrir um domínio ou uma sala. Não cria nada: devolve uma proposta para " +
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
      "nova. Use também sempre que o usuário pedir explicitamente para contratar " +
      "ou trazer alguém para um domínio existente. Não contrata ninguém: devolve " +
      "uma proposta para o usuário aprovar.",
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
      // Só ativos na lista: um id arquivado aqui convidaria o modelo a repetir o erro.
      const ids = dominiosAtivos(ctx.squad).map((d) => d.id).join(", ");
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
    // Só ativas: squad arquivada não aparece no prompt e não pode ser destino.
    const ativas = squadsAtivas(ctx.roster);
    const destino = ativas.find((s) => s.id === args.squad_id);
    if (!destino) {
      const outras = ativas.filter((s) => s.id !== ctx.squad.id).map((s) => s.id);
      throw new Error(
        `squad_id '${String(args.squad_id)}' não existe ou está arquivada. Outras squads: ${outras.join(", ") || "(nenhuma)"}.`,
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
