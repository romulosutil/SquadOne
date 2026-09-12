/**
 * Espelho dos tipos do servidor. O roster é uma ÁRVORE (spec Fase 1 §3):
 * roster -> squad -> domínio -> { po, integrantes }. Uma squad = um escritório;
 * uma sala do escritório = um domínio.
 */

export interface Pessoa {
  id: string;
  nome: string;
  papel: string;
  escopo: string;
  sprite: string;
  hue?: number;
  horario?: { inicio: string; fim: string };
  hiredAt: string;
  /** Reservado (Fase 2). */
  arquivado?: boolean;
}

export interface Dominio {
  /** slug estável; é o valor de `squadone_dominio` no Google Calendar. */
  id: string;
  nome: string;
  escopo: string;
  /** O slot é do DOMÍNIO, não das pessoas: todas elas dividem esta sala. */
  slot: [number, number];
  room: string;
  criadoEm: string;
  po: Pessoa;
  integrantes: Pessoa[];
  /** Reservado (Fase 2). */
  arquivado?: boolean;
}

export interface Squad {
  /** valor de `squadone_squad` no Google Calendar. */
  id: string;
  nome: string;
  escopo: string;
  calendarId: string;
  conta?: string;
  unlockOrder: [number, number][];
  /** `dominios[0].po` é o PO raiz do escritório. */
  dominios: Dominio[];
}

export type SquadView = Squad & { unlockedSlots: [number, number][] };

/** `GET /api/squad`: todas as squads. A ativa é escolha da aba. */
export interface RosterView {
  version: 3;
  squads: SquadView[];
  idsAposentados: { pessoas: string[]; dominios: string[] };
}

/** Toggle da CommandBar; espelho de `Modo` em server/capabilities.ts. */
export type Modo = "auto" | "foco" | "prazo";

export interface EventoCriado {
  kind: "evento";
  titulo: string;
  /** id da pessoa (PO ou integrante). O domínio é derivado dela. */
  responsavel_id: string;
  tipo: "time_blocking" | "deadline";
  dominio: string;
  inicio: string;
  fim: string;
  eventId: string;
  htmlLink?: string;
}

/** Proposta de abrir um domínio novo — sala nova no escritório. */
export interface PropostaDominio {
  kind: "dominio";
  /** Squad em que o turno rodou; a aprovação aplica nela. */
  squad_id: string;
  dominio: string;
  papel_po: string;
  justificativa: string;
  escopo: string;
  slot: [number, number] | null;
}

/** Proposta de contratar dentro de um domínio existente — mesma sala. */
export interface PropostaIntegrante {
  kind: "integrante";
  /** Squad em que o turno rodou; a aprovação aplica nela. */
  squad_id: string;
  dominio_id: string;
  dominio_nome: string;
  papel: string;
  justificativa: string;
  escopo: string;
}

/** A demanda parece de outra squad. Só proposta: trocar é clique do usuário. */
export interface PropostaTrocaSquad {
  kind: "troca_squad";
  squad_id: string;
  destino_id: string;
  destino_nome: string;
  justificativa: string;
  demanda: string;
}

/** `id` gerado pelo servidor a cada turno: identidade do card na tela. */
export type Sugestao = (PropostaDominio | PropostaIntegrante | PropostaTrocaSquad) & { id: string };

export interface ErroTarefa {
  capacidade: string;
  args: Record<string, unknown>;
  erro: string;
}

export interface TurnoResponse {
  eventos_criados: EventoCriado[];
  sugestoes: Sugestao[];
  erros: ErroTarefa[];
}

/**
 * Item da Mochila. Vem de `GET /api/mochila`, que lê o Google Calendar — não
 * existe lista local de quests no frontend.
 */
export interface QuestCalendario {
  eventId: string;
  titulo: string;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  tipo: "time_blocking" | "deadline";
  /** `extendedProperties.private.squadone_dominio` — eixo de filtro. */
  dominio: string;
  /** `extendedProperties.private.squadone_membro` — eixo de atribuição. */
  membro: string;
  /** `squadone_squad`; vazio em eventos anteriores à Fase 1. */
  squad: string;
  htmlLink?: string;
}

export interface MochilaResponse {
  quests: QuestCalendario[];
  erros: { dominio: string; erro: string; credencial: boolean }[];
}
