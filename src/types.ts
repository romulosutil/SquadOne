export interface SquadMember {
  id: string;
  nome: string;
  papel: string;
  escopo: string;
  dominio?: string;
  sprite: string;
  slot: [number, number];
  room: string;
  horario: { inicio: string; fim: string };
  hiredAt: string;
}

export interface SquadResponse {
  version: number;
  unlockOrder: [number, number][];
  members: SquadMember[];
  unlockedSlots: [number, number][];
}

export interface EventoCriado {
  kind: "evento";
  titulo: string;
  po_id: string;
  tipo: "time_blocking" | "deadline";
  dominio: string;
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

export interface ErroTarefa {
  capacidade: string;
  args: Record<string, unknown>;
  erro: string;
}

export interface TurnoResponse {
  eventos_criados: EventoCriado[];
  sugestoes: SugestaoContratacao[];
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
