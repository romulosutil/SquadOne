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

/**
 * Turnos rodando agora, das duas portas. `/api/runtime` expõe isso como
 * `ocupado` para o atualizar-central do Dell não reiniciar o processo no meio
 * de um turno: o turno pode já ter criado eventos no Google e a resposta se
 * perderia, levando o usuário a reenviar e duplicar.
 */
let turnosEmAndamento = 0;

export function haTurnoEmAndamento(): boolean {
  return turnosEmAndamento > 0;
}

export async function rodarDemanda(ai: GoogleGenAI, pedido: PedidoDeDemanda): Promise<TurnoResult> {
  turnosEmAndamento++;
  try {
    return await rodarDemandaContada(ai, pedido);
  } finally {
    turnosEmAndamento--;
  }
}

async function rodarDemandaContada(ai: GoogleGenAI, pedido: PedidoDeDemanda): Promise<TurnoResult> {
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
