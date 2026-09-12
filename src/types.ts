/**
 * Espelho dos tipos do servidor. O roster é uma ÁRVORE (spec §3.1):
 * domínio -> { po, integrantes }. Uma sala do escritório = um domínio.
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
}

export interface SquadResponse {
  version: number;
  unlockOrder: [number, number][];
  dominios: Dominio[];
  unlockedSlots: [number, number][];
}

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
  dominio: string;
  papel_po: string;
  justificativa: string;
  escopo: string;
  slot: [number, number] | null;
}

/** Proposta de contratar dentro de um domínio existente — mesma sala. */
export interface PropostaIntegrante {
  kind: "integrante";
  dominio_id: string;
  dominio_nome: string;
  papel: string;
  justificativa: string;
  escopo: string;
}

export type Sugestao = PropostaDominio | PropostaIntegrante;

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
  htmlLink?: string;
}

export interface MochilaResponse {
  quests: QuestCalendario[];
  erros: { dominio: string; erro: string }[];
}
