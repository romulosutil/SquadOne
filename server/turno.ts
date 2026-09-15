import type { GoogleGenAI } from "@google/genai";
import { readRoster, resolverSquad } from "./squad.ts";
import { executarTurno, type TurnoResult } from "./orchestrator.ts";
import { lerJanela } from "./alocador.ts";
import { escoposConcedidos, tokenValido } from "./auth-store.ts";
import type { Modo } from "./capabilities.ts";

/**
 * Um turno a partir de uma demanda já validada. Mora fora da rota porque há
 * duas portas de entrada — a CommandBar (`POST /api/orquestrar`) e o bot do
 * Telegram — e as duas precisam da MESMA ordem: squad e janela antes do token e
 * do Gemini, para config quebrada ou squadId velho não custarem chamada ao modelo.
 */
export interface PedidoDeDemanda {
  demanda: string;
  modo: Modo;
  /** Ausente = primeira squad ativa (`resolverSquad`). O bot não tem aba. */
  squadId?: unknown;
}

export async function rodarDemanda(ai: GoogleGenAI, pedido: PedidoDeDemanda): Promise<TurnoResult> {
  const roster = await readRoster();
  const squad = resolverSquad(roster, pedido.squadId);
  const janela = lerJanela(process.env);

  // Sem credencial o turno ainda roda: nem toda demanda toca o calendário. O
  // MOTIVO vai junto para agendar_evento devolver o erro classificado certo.
  let token: string | null = null;
  let falhaDoToken: unknown = null;
  try {
    token = await tokenValido();
  } catch (err) {
    falhaDoToken = err;
  }
  // O scope gravado é lido UMA vez por turno, antes do Gemini.
  const { tasks: tasksLiberado } = await escoposConcedidos();
  return executarTurno(ai, {
    demanda: pedido.demanda,
    token,
    falhaDoToken,
    modo: pedido.modo,
    roster,
    squad,
    janela,
    tasksLiberado,
    obterToken: tokenValido,
  });
}
