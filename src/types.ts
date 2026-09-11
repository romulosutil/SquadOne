export interface SquadMember {
  id: string;
  nome: string;
  papel: string;
  escopo: string;
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
