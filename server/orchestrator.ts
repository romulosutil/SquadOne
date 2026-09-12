import { randomUUID } from "node:crypto";
import { GoogleGenAI, FunctionCallingConfigMode, type FunctionCall } from "@google/genai";
import { CAPABILITIES, declarations, type CapabilityContext, type CapabilityResult, type EventoCriado, type Modo, type Sugestao } from "./capabilities.ts";
import { outrasSquads, rosterTree, type Roster, type Squad } from "./squad.ts";

export const MODEL = "gemini-3.7-flash";
const TIMEZONE = "America/Sao_Paulo";

export interface ErroTarefa {
  capacidade: string;
  args: Record<string, any>;
  erro: string;
  /**
   * A chamada nem rodou: o turno sugeriu trocar de squad (ver
   * `descartarPorTroca`). Separa "falhou" de "foi descartada de propósito".
   */
  descartado?: true;
}

const TROCA_DE_SQUAD = "sugerir_troca_squad";

/**
 * Turno com `sugerir_troca_squad` descarta TODAS as outras chamadas, antes de
 * executar. O prompt pede exclusividade, mas prompt é pedido, não garantia: se
 * o modelo agendasse junto, o evento nasceria na squad de origem e "Trocar e
 * reenviar" criaria o mesmo compromisso de novo na destino. Contratação também
 * sai: a demanda foi julgada de outra squad, então crescer esta não se sustenta.
 * Vale mesmo se a troca falhar (squad_id inválido): a intenção do modelo era
 * tirar a demanda daqui, e agir nela aqui seria adivinhar.
 */
function descartarPorTroca(nome: string, args: Record<string, any>): ErroTarefa {
  const porque =
    nome === "agendar_evento"
      ? "agendar aqui duplicaria o compromisso ao reenviar na outra squad"
      : "a demanda foi julgada de outra squad, então esta chamada não se aplica aqui";
  return {
    capacidade: nome,
    args,
    erro: `descartado: turno sugeriu trocar de squad (${porque}).`,
    descartado: true,
  };
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
 *
 * Só a squad ATIVA entra inteira. As outras aparecem por id, nome e escopo:
 * o modelo precisa saber que existem para sugerir troca, mas se visse as
 * pessoas delas poderia agendar fora da squad que o usuário escolheu.
 */
export interface ContextoDoPrompt {
  squadNome: string;
  squadEscopo: string;
  /** rosterTree da squad ativa. */
  arvore: string;
  /** outrasSquads(roster, ativa.id). */
  outrasSquads: string;
}

export function buildSystemInstruction(
  contexto: ContextoDoPrompt,
  agoraISO: string,
  modo: Modo = "auto",
): string {
  // Só entra quando o usuário forçou: em `auto` a regra do tipo abaixo já diz
  // como escolher, e uma linha a mais seria ruído no prompt. O handler de
  // agendar_evento impõe o tipo de qualquer jeito; isto só evita que o modelo
  // preencha o campo de horário errado.
  const regraModo =
    modo === "foco"
      ? `\n- O usuário forçou tipo='time_blocking' para TODOS os compromissos desta
  demanda: use-o em toda chamada de agendar_evento, com inicio e duracao_min.`
      : modo === "prazo"
        ? `\n- O usuário forçou tipo='deadline' para TODOS os compromissos desta
  demanda: use-o em toda chamada de agendar_evento, com prazo_final.`
        : "";

  return `Você é o PO raiz da squad '${contexto.squadNome}' (escopo: ${contexto.squadEscopo}). Recebe demandas em português e as
transforma em compromissos no calendário do usuário.

A squad é uma ÁRVORE: cada DOMÍNIO é um tema, tem um PO dono e ocupa uma sala do
escritório; dentro do domínio o PO contrata INTEGRANTES (designer, tech lead,
QA...) que dividem a sala com ele.

Squad atual:
${contexto.arvore}

Outras squads do usuário (você NÃO vê os domínios nem as pessoas delas e NÃO agenda nelas):
${contexto.outrasSquads}

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
  precisa marcar o limite de entrega.${regraModo}
- Crescimento tem dois níveis, e escolher o errado é erro:
  - criar_po_dominio quando o TEMA não pertence a nenhum domínio existente.
  - contratar_integrante quando o tema já tem domínio mas falta um PAPEL dentro
    dele; passe o dominio_id exato.
  Se a squad atual dá conta, não chame nenhuma das duas.
- Se a demanda pertence claramente ao escopo de uma das OUTRAS squads listadas,
  chame APENAS sugerir_troca_squad com o squad_id dela e não agende nada nesta
  squad. Na dúvida, trate a demanda na squad atual. Se não há outras squads,
  nunca chame sugerir_troca_squad.
- Não responda em texto: sua resposta são as chamadas de função.`;
}

/**
 * `gemini-3.7-flash` devolve 503 UNAVAILABLE com alguma frequencia ("high
 * demand"). Observado 3x em testes manuais em 2026-09-11 e de novo em
 * 2026-09-12, aí sobrevivendo às 3 retentativas do modelo principal.
 */
export class ModeloOcupado extends Error {}

/**
 * 503 é falta de capacidade DAQUELE modelo, não da conta. Quando o principal
 * insiste em recusar, um modelo mais antigo costuma atender — pior qualidade
 * de raciocínio vale mais que um turno perdido. A ordem importa: só se chega
 * no segundo depois do primeiro esgotar as retentativas.
 */
const MODELOS_RESERVA = ["gemini-3.5-flash"];

const TRANSITORIO = /(429|503)|UNAVAILABLE|RESOURCE_EXHAUSTED/;

/**
 * Duas tentativas POR MODELO, não mais: uma chamada em hora de pico já demora
 * ~15s antes de falhar, e o usuario esta olhando um spinner. 2 modelos x 2
 * tentativas e o teto que ainda cabe num clique.
 */
async function gerarComRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
  tentativas = 2,
) {
  let ultimo: any;
  for (const model of [params.model, ...MODELOS_RESERVA]) {
    for (let i = 0; i < tentativas; i++) {
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (!TRANSITORIO.test(msg)) throw err;
        ultimo = err;
        if (i < tentativas - 1) {
          // Jitter junto do backoff: sem ele duas abas retentando batem no
          // mesmo instante e colhem o mesmo 503.
          const espera = 800 * 2 ** i + Math.random() * 400;
          await new Promise((r) => setTimeout(r, espera));
        }
      }
    }
  }
  // Classificado, nao so mensagem: a UI precisa saber que isto passa sozinho e
  // que o gesto certo e tentar de novo, nao reconectar nem mexer em config.
  throw new ModeloOcupado(
    "Os modelos do Gemini estão sobrecarregados agora. Tente a demanda de novo em alguns segundos.",
    { cause: ultimo },
  );
}

/** Tudo que um turno precisa, já resolvido pela rota antes de tocar Google e Gemini. */
export interface PedidoDeTurno {
  demanda: string;
  token: string | null;
  modo: Modo;
  roster: Roster;
  /** A squad ativa: o prompt e as capacidades agem só dentro dela. */
  squad: Squad;
}

export async function executarTurno(ai: GoogleGenAI, pedido: PedidoDeTurno): Promise<TurnoResult> {
  const { demanda, token, modo, roster, squad } = pedido;
  const agora = new Date();

  const response = await gerarComRetry(ai, {
    model: MODEL,
    contents: demanda,
    config: {
      systemInstruction: buildSystemInstruction(
        {
          squadNome: squad.nome,
          squadEscopo: squad.escopo,
          arvore: rosterTree(squad),
          outrasSquads: outrasSquads(roster, squad.id),
        },
        agoraLocalISO(agora),
        modo,
      ),
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
  const ctx: CapabilityContext = { token, roster, squad, agora, modo, demanda };

  // Decidido ANTES do Promise.all: as chamadas rodam em paralelo, então olhar
  // o resultado da troca chegaria tarde demais para impedir o evento.
  const temTroca = calls.some((c) => c.name === TROCA_DE_SQUAD);

  // One-shot: executa as calls e acaba. Sem realimentar o modelo.
  // Um try POR TAREFA: uma tarefa quebrada não pode matar o lote.
  const resultados = await Promise.all(
    calls.map(async (call): Promise<CapabilityResult | ErroTarefa> => {
      const nome = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, any>;
      if (temTroca && nome !== TROCA_DE_SQUAD) return descartarPorTroca(nome, args);
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
    else turno.sugestoes.push({ ...r, id: randomUUID() });
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
