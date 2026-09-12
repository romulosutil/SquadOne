import { GoogleGenAI, FunctionCallingConfigMode, type FunctionCall } from "@google/genai";
import { CAPABILITIES, declarations, type CapabilityContext, type CapabilityResult, type EventoCriado, type Sugestao } from "./capabilities.ts";
import { readSquad, rosterTree } from "./squad.ts";

export const MODEL = "gemini-3.7-flash";
const TIMEZONE = "America/Sao_Paulo";

export interface ErroTarefa {
  capacidade: string;
  args: Record<string, any>;
  erro: string;
}

export interface TurnoResult {
  eventos_criados: EventoCriado[];
  /** Propostas de crescimento: de domínio (sala nova) ou de integrante (mesma sala). */
  sugestoes: Sugestao[];
  erros: ErroTarefa[];
}

/** Data/hora local com offset, no formato que o modelo deve devolver. */
function agoraLocalISO(agora: Date): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  const partes = Object.fromEntries(
    fmt.formatToParts(agora).map((p) => [p.type, p.value]),
  );
  // longOffset vem como "GMT-03:00"; "GMT" puro significa +00:00.
  const offset = (partes.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}${offset}`;
}

/**
 * §6: o roster é a fonte do prompt, e o roster é uma ÁRVORE.
 *
 * A árvore entra literalmente no prompt porque as três capacidades dependem
 * dela para escolher entre si: `agendar_evento` precisa saber quais pessoas
 * existem e sob qual domínio, `contratar_integrante` precisa dos ids de
 * domínio, e `criar_po_dominio` só se justifica quando NENHUM ramo da árvore
 * cobre o tema. Uma lista plana de pessoas apagaria exatamente a distinção
 * entre "falta um papel aqui dentro" e "falta um domínio inteiro".
 */
export function buildSystemInstruction(arvore: string, agoraISO: string): string {
  return `Você é o PO raiz de um squad pessoal. Recebe demandas em português e as
transforma em compromissos no calendário do usuário.

O squad é uma ÁRVORE: cada DOMÍNIO é um tema, tem um PO dono e ocupa uma sala do
escritório; dentro do domínio o PO contrata INTEGRANTES (designer, tech lead,
QA...) que dividem a sala com ele.

Squad atual:
${arvore}

Agora são ${agoraISO} (fuso ${TIMEZONE}). Toda data que você produzir deve ser
ISO 8601 com offset, no mesmo formato.

Regras:
- Quebre a demanda em quantos compromissos forem necessários e chame
  agendar_evento uma vez por compromisso.
- Em responsavel_id use o id de uma PESSOA da árvore — PO ou integrante. Escolha
  primeiro o domínio pelo tema, depois a pessoa dentro dele pelo papel. Nunca
  invente um id.
- Use tipo='time_blocking' (com inicio e duracao_min) quando o usuário precisa
  reservar tempo para executar; tipo='deadline' (com prazo_final) quando ele só
  precisa marcar o limite de entrega.
- Crescimento tem dois níveis, e escolher o errado é erro:
  - criar_po_dominio quando o TEMA não pertence a nenhum domínio existente.
  - contratar_integrante quando o tema já tem domínio mas falta um PAPEL dentro
    dele; passe o dominio_id exato.
  Se o squad atual dá conta, não chame nenhuma das duas.
- Não responda em texto: sua resposta são as chamadas de função.`;
}

/**
 * gemini-3.7-flash devolve 503 UNAVAILABLE com alguma frequência ("high
 * demand"). Observado 3x em testes manuais em 2026-09-11. Sem retry, o turno
 * inteiro morre num erro que some sozinho em segundos.
 */
async function gerarComRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
  tentativas = 3,
) {
  let ultimo: any;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      const transitorio = /(429|503)|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(msg);
      if (!transitorio || i === tentativas - 1) throw err;
      ultimo = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw ultimo;
}

export async function executarTurno(
  ai: GoogleGenAI,
  demanda: string,
  token: string | null,
): Promise<TurnoResult> {
  const squad = await readSquad();
  const agora = new Date();

  const response = await gerarComRetry(ai, {
    model: MODEL,
    contents: demanda,
    config: {
      systemInstruction: buildSystemInstruction(rosterTree(squad), agoraLocalISO(agora)),
      tools: [{ functionDeclarations: declarations() }],
      toolConfig: {
        // AUTO, nunca ANY: ANY forçaria uma proposta de contratação espúria em
        // toda demanda.
        functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
      },
      // Sem responseMimeType. Medido em 2026-09-11: com tools ele não dá 400,
      // mas em gemini-3.5-flash faz o modelo devolver as chamadas como texto
      // JSON (zero functionCall parts). Não traz ganho nenhum aqui — a resposta
      // útil são as functionCalls — e é um campo minado na troca de modelo.
    },
  });

  const calls: FunctionCall[] = response.functionCalls ?? [];
  const ctx: CapabilityContext = { token, squad, agora };

  // One-shot: executa as calls e acaba. Sem realimentar o modelo.
  // Um try POR TAREFA: uma tarefa quebrada não pode matar o lote.
  const resultados = await Promise.all(
    calls.map(async (call): Promise<CapabilityResult | ErroTarefa> => {
      const nome = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, any>;
      const capacidade = CAPABILITIES[nome];
      if (!capacidade) {
        return { capacidade: nome, args, erro: `Capacidade desconhecida: '${nome}'` };
      }
      try {
        return await capacidade.handler(args, ctx);
      } catch (err: any) {
        return { capacidade: nome, args, erro: err?.message ?? String(err) };
      }
    }),
  );

  const turno: TurnoResult = { eventos_criados: [], sugestoes: [], erros: [] };
  for (const r of resultados) {
    if ("erro" in r) turno.erros.push(r);
    else if (r.kind === "evento") turno.eventos_criados.push(r);
    else turno.sugestoes.push(r);
  }

  if (calls.length === 0) {
    turno.erros.push({
      capacidade: "-",
      args: {},
      erro: "O modelo não chamou nenhuma capacidade para esta demanda.",
    });
  }

  return turno;
}
