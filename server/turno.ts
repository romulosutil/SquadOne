import path from 'node:path';
import { GarantiasAgenda, DemandasAgendaDuraveis } from './garantias-agenda.ts';
import { diretorioDeDados } from './dados.ts';
import { randomUUID } from 'node:crypto';
import type { GoogleGenAI } from "@google/genai";
import { readRoster, resolverSquad } from "./squad.ts";
import { executarTurno, type TurnoResult } from "./orchestrator.ts";
import { lerJanela } from "./alocador.ts";
import { escoposConcedidos, tokenValido } from "./auth-store.ts";
import type { Modo } from "./capabilities.ts";
import type { ObservacaoDeTurno } from "./luna-sombra.ts";
import type { ChamadaCrua, ObservacaoDeDemanda } from "./jev-sombra.ts";

/**
 * Um turno a partir de uma demanda já validada. Mora fora da rota porque há
 * duas portas de entrada — a CommandBar (`POST /api/orquestrar`) e o bot do
 * Telegram — e as duas precisam da MESMA ordem: squad e janela antes do token e
 * do Gemini, para config quebrada ou squadId velho não custarem chamada ao modelo.
 */
export interface PedidoDeDemanda {
  demanda: string;
  requestId?: string;
  modo: Modo;
  /** Ausente = primeira squad ativa (`resolverSquad`). O bot não tem aba. */
  squadId?: unknown;
}

/**
 * Quem observa o turno de fora (a Luna em sombra, `server/luna-sombra.ts`).
 * Recebe o que o Gemini viu e respondeu; nunca participa, nunca é esperado.
 */
export interface SombraDoTurno {
  observar(obs: ObservacaoDeTurno): void;
}

/**
 * O Jev em sombra (`server/jev-sombra.ts`): uma observação por DEMANDA, com o
 * que o último turno do Gemini fez. Mesma regra da Luna: nunca participa,
 * nunca é esperado, nunca lança para dentro do turno.
 */
export interface JevDoTurno {
  observarDemanda(obs: ObservacaoDeDemanda): void;
}

/** Quem observa a demanda de fora. Ausentes = ninguém (o padrão). */
export interface ObservadoresDoTurno {
  luna?: SombraDoTurno | null;
  jev?: JevDoTurno | null;
}

/**
 * Turnos rodando agora, das duas portas. `/api/runtime` expõe isso como
 * `ocupado` para o atualizar-central do Dell não reiniciar o processo no meio
 * de um turno: o turno pode já ter criado eventos no Google e a resposta se
 * perderia, levando o usuário a reenviar e duplicar. A sombra NÃO conta aqui:
 * reiniciar no meio dela perde uma medição, não um turno.
 */
let turnosEmAndamento = 0;

export function haTurnoEmAndamento(): boolean {
  return turnosEmAndamento > 0;
}

export async function rodarDemanda(
  ai: GoogleGenAI,
  pedido: PedidoDeDemanda,
  observadores: ObservadoresDoTurno = {},
): Promise<TurnoResult> {
  turnosEmAndamento++;
  try {
    const requestId=pedido.requestId??'interno:'+randomUUID();
    const demandas=new DemandasAgendaDuraveis(path.join(diretorioDeDados(),'agenda-demandas'));
    return await demandas.executar(requestId,{demanda:pedido.demanda,modo:pedido.modo,squadId:pedido.squadId??null},()=>rodarDemandaContada(ai,{...pedido,requestId},observadores.luna??null,observadores.jev??null));
  } finally {
    turnosEmAndamento--;
  }
}

async function rodarDemandaContada(
  ai: GoogleGenAI,
  pedido: PedidoDeDemanda,
  sombra: SombraDoTurno | null,
  jev: JevDoTurno | null,
): Promise<TurnoResult> {
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

  // Cada turno do Gemini (dois, com redirecionamento) vira uma observação; elas
  // só saem para a sombra DEPOIS do resultado, sem await: a sombra mede, não
  // participa, e uma falha dela não pode tocar no TurnoResult.
  const observacoes: ObservacaoDeTurno[] = [];
  // Para o Jev: as chamadas do ÚLTIMO turno do Gemini (o de destino, com
  // redirecionamento), que é o que de fato valeu para a demanda.
  let chamadasDoUltimoTurno: ChamadaCrua[] = [];
  const observando = Boolean(sombra || jev);
  const resultado = await executarTurno(ai, {
    demanda: pedido.demanda,
    requestId: pedido.requestId ?? "interno:"+randomUUID(),
    garantiasAgenda: new GarantiasAgenda(path.join(diretorioDeDados(),"agenda-reservas")),
    token,
    falhaDoToken,
    modo: pedido.modo,
    roster,
    squad,
    janela,
    tasksLiberado,
    obterToken: tokenValido,
    ...(observando
      ? {
          aoTerminarTurno: (t) => {
            chamadasDoUltimoTurno = t.chamadas.map((c) => ({ name: c.name, args: (c.args ?? {}) as Record<string, unknown> }));
            if (sombra) {
              observacoes.push({
                systemInstruction: t.systemInstruction,
                demanda: pedido.demanda,
                chamadasDoGemini: t.chamadas,
                squadId: t.squad.id,
                modo: pedido.modo,
              });
            }
          },
        }
      : {}),
  });
  for (const obs of observacoes) {
    try {
      sombra!.observar(obs);
    } catch (err) {
      console.warn("[luna] observar falhou:", err instanceof Error ? err.message : err);
    }
  }
  // Uma observação por demanda, sem await: o Jev mede, não participa.
  if (jev) {
    try {
      jev.observarDemanda({
        demanda: pedido.demanda,
        modo: pedido.modo,
        roster,
        squadInicial: squad,
        squadExplicita: pedido.squadId !== undefined,
        redirecionadoPara: resultado.redirecionado?.para_id ?? null,
        chamadas: chamadasDoUltimoTurno,
      });
    } catch (err) {
      console.warn("[jev] observar falhou:", err instanceof Error ? err.message : err);
    }
  }
  return resultado;
}
