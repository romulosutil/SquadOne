import { randomUUID } from "node:crypto";
import { GoogleGenAI, FunctionCallingConfigMode, type FunctionCall } from "@google/genai";
import { CAPABILITIES, declarations, ehBaixaPrioridade, tipoForcado, type CapabilityContext, type CapabilityResult, type EventoCriado, type Modo, type Sugestao, type TarefaCriada } from "./capabilities.ts";
import { motivoDoErroTasks } from "./passos-no-google.ts";
import { outrasSquads, rosterTree, squadsAtivas, type Roster, type Squad } from "./squad.ts";
import { ErroDeConfig, PrecisaConectar } from "./auth-store.ts";
import { AgendaDoTurno, AgendaIndisponivel } from "./agenda.ts";
import { descreverJanela, FUSO, lerJanela, SemHorarioLivre, type Janela } from "./alocador.ts";
import { prioridadeDeAgendamento } from "./agendamento.ts";
import type { ObterToken } from "./calendar.ts";

export const MODEL = "gemini-3.7-flash";
/** Uma fonte só do fuso: o alocador e o prompt não podem discordar. */
const TIMEZONE = FUSO;

export interface ErroTarefa {
  capacidade: string;
  args: Record<string, any>;
  erro: string;
  /**
   * A chamada nem rodou: o turno sugeriu trocar de squad (ver
   * `descartarPorTroca`). Separa "falhou" de "foi descartada de propósito".
   */
  descartado?: true;
  /** Por que falhou, quando a UI tem um gesto certo para isso. Ausente = sem gesto específico. */
  motivo?: MotivoDeErro;
}

/** Por que uma tarefa falhou, quando a UI tem um gesto certo para isso. */
export type MotivoDeErro =
  | "precisaConectar"
  | "configuracao"
  | "semHorarioLivre"
  | "agendaIndisponivel"
  /** `criar_tarefa` sem o escopo do Google Tasks: ampliar, nunca reconectar. */
  | "ampliarAcesso";

/**
 * Gesto de um AVISO. Mesmo conjunto do erro: nos passos de um compromisso a
 * falta do escopo do Tasks é aviso (o evento saiu), numa tarefa avulsa é erro
 * (não sobrou nada).
 */
export type MotivoDeAviso = MotivoDeErro;

/** Algo que foi feito, mas não exatamente como pedido. Não é falha. */
export interface AvisoTarefa {
  capacidade: string;
  titulo: string;
  aviso: string;
  /** Gesto certo para a UI, como em `ErroTarefa`: bloco recusado por credencial pede reconectar. */
  motivo?: MotivoDeAviso;
}

/**
 * Classificação para a UI decidir o gesto. `AgendaIndisponivel` de credencial
 * é o mesmo gesto que `PrecisaConectar`: reconectar.
 */
export function motivoDoErro(err: unknown): MotivoDeErro | undefined {
  if (err instanceof PrecisaConectar) return "precisaConectar";
  if (err instanceof ErroDeConfig) return "configuracao";
  if (err instanceof SemHorarioLivre) return "semHorarioLivre";
  if (err instanceof AgendaIndisponivel) return err.credencial ? "precisaConectar" : "agendaIndisponivel";
  // Falhas do Google Tasks (criar_tarefa): escopo → ampliar, 401 → reconectar.
  return motivoDoErroTasks(err);
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

/**
 * O turno acabou rodando em OUTRA squad: o modelo disse que a demanda não era
 * desta, o servidor trocou e reprocessou lá. A aba precisa disto para adotar a
 * squad de destino e avisar o usuário — não é proposta, já aconteceu.
 */
export interface Redirecionamento {
  de_id: string;
  de_nome: string;
  para_id: string;
  para_nome: string;
  justificativa: string;
}

export interface TurnoResult {
  eventos_criados: EventoCriado[];
  /** Tarefas avulsas no Google Tasks (`criar_tarefa`), sem evento. */
  tarefas_criadas: TarefaCriada[];
  /** Propostas de crescimento: de domínio (sala nova) ou de integrante (mesma sala). */
  sugestoes: Sugestao[];
  /** Compromissos feitos de um jeito diferente do pedido (conflito, esforço parcial...). */
  avisos: AvisoTarefa[];
  erros: ErroTarefa[];
  /** Ausente quando o turno rodou na squad que o usuário escolheu. */
  redirecionado?: Redirecionamento;
}

/** Data/hora local com offset, no formato que o modelo deve devolver. */
export function agoraLocalISO(agora: Date): string {
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
  // longOffset vem como "GMT-03:00"; "GMT" puro significa +00:00. Em sv-SE o
  // sinal sai como U+2212 (sinal de menos tipográfico), não hífen: o modelo
  // copiaria o formato e lerInstante recusaria o offset. Troca para ASCII.
  const offset =
    (partes.timeZoneName ?? "GMT").replace("GMT", "").replace("−", "-") || "+00:00";
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
  /** Janela de trabalho legível (`descreverJanela`): o modelo precisa saber que o horário não é dele. */
  janela: string;
}

const DIAS_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/**
 * Hoje e os 7 dias seguintes com o nome do dia. Sem isto o modelo fazia a conta
 * do dia da semana sozinho a partir da data ISO e errava: medido em 23/09/2026
 * (quarta), "na sexta" virou 26/09, um sábado. A data vem da parte local de
 * `agoraISO` (já em São Paulo) e a conta é em UTC só para não depender do fuso
 * da máquina.
 */
export function calendarioDaSemana(agoraISO: string): string {
  const [ano, mes, dia] = agoraISO.slice(0, 10).split("-").map(Number);
  const dias: string[] = [];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(Date.UTC(ano, mes - 1, dia + i));
    const data = d.toISOString().slice(0, 10);
    dias.push(`${i === 0 ? "hoje, " : ""}${DIAS_DA_SEMANA[d.getUTCDay()]} ${data}`);
  }
  return `Dias: ${dias.join("; ")}. Use esta lista para "amanhã", "sexta", "semana que vem".`;
}

export function buildSystemInstruction(
  contexto: ContextoDoPrompt,
  agoraISO: string,
  modo: Modo = "auto",
): string {
  // Só entra quando o usuário forçou: em `auto` a regra do tipo abaixo já diz
  // como escolher, e uma linha a mais seria ruído no prompt. O handler de
  // agendar_evento impõe o tipo de qualquer jeito; isto só evita que o modelo
  // preencha o campo de duração/esforço errado.
  const regraModo =
    modo === "foco"
      ? `\n- O usuário forçou tipo='time_blocking' para TODOS os compromissos desta
  demanda: use-o em toda chamada de agendar_evento, com duracao_min. Não use
  criar_tarefa: o usuário pediu tempo na agenda.`
      : modo === "baixa_prioridade"
        ? `\n- O usuário marcou esta demanda como BAIXA PRIORIDADE: use
  tipo='time_blocking' em toda chamada de agendar_evento, com duracao_min. O
  servidor encaixa o bloco em qualquer horário livre dos próximos dias úteis —
  não é para agora, e não é um prazo. Não use criar_tarefa: o usuário pediu
  tempo na agenda.`
        : "";

  // Pedido explícito de contratação SEMPRE vira capacidade: a regra antiga
  // ("se a squad dá conta, não chame") fazia o modelo engolir "contrate um
  // designer" quando já havia alguém parecido. Sem roteamento por regex no
  // servidor — o card continua sendo a decisão do usuário. O SEMPRE é só da
  // squad ativa: pedido para outra squad é troca, e o prompt diz qual vence
  // (descartarPorTroca garante o mesmo no servidor se o modelo chamar as duas).
  return `Você é o PO raiz da squad '${contexto.squadNome}' (escopo: ${contexto.squadEscopo}). Recebe demandas em português e as
transforma em compromissos no calendário do usuário ou em tarefas no Google Tasks.

A squad é uma ÁRVORE: cada DOMÍNIO é um tema, tem um PO dono e ocupa uma sala do
escritório; dentro do domínio o PO contrata INTEGRANTES (designer, tech lead,
QA...) que dividem a sala com ele.

Squad atual:
${contexto.arvore}

Outras squads do usuário (você NÃO vê os domínios nem as pessoas delas e NÃO agenda nelas):
${contexto.outrasSquads}

Agora são ${agoraISO} (fuso ${TIMEZONE}). Datas que você produzir: AAAA-MM-DD
quando o usuário não disse hora; com hora, ISO 8601 com offset no mesmo formato.
${calendarioDaSemana(agoraISO)}

Você NÃO escolhe horário. O servidor lê a agenda do usuário e reserva o próximo
horário livre dentro da janela de trabalho ${contexto.janela}, sem colidir com o
que já está lá. Você diz a intenção: o quê, quem, quanto tempo e até quando.

Regras:
- Quebre a demanda em quantos compromissos forem necessários e chame
  agendar_evento uma vez por compromisso.
- Agenda ou tarefa: agendar_evento só quando a demanda precisa de TEMPO
  reservado — trabalho que ocupa um bloco, reunião, hora marcada, prazo de
  entrega com esforço. O que só precisa não ser esquecido (lembrete, compra,
  pagamento, recado, ligação rápida, "anotar", "lembrar de") é criar_tarefa, sem
  duração nem horário; se o usuário disse um dia, mande em data. Na dúvida entre
  os dois, pense se o usuário precisaria parar o que está fazendo por mais de
  15 minutos: se sim, agenda; se não, tarefa.
- Em responsavel_id use o id de uma PESSOA da árvore — PO ou integrante. Escolha
  primeiro o domínio pelo tema, depois a pessoa dentro dele pelo papel. Nunca
  invente um id.
- tipo='time_blocking' quando o usuário precisa de um bloco para executar: mande
  duracao_min. Se ele disse QUANDO sem hora ("amanhã", "segunda"), mande
  a_partir_de com a data. Só se ele disse a HORA ("amanhã às 14h"), mande
  inicio_fixo com data/hora.
- tipo='deadline' quando há uma data limite de entrega: mande prazo_final e
  esforco_min, sua estimativa realista do trabalho TOTAL até lá, em minutos. O
  servidor cria o marco no prazo e divide o esforço em blocos antes dele. Não
  chame agendar_evento de novo para os blocos.${regraModo}
- nota_de_execucao: escreva no MESMO turno uma dica curta de execução, do ponto
  de vista do responsável e do treino dele — por onde começar, o que checar, o
  risco óbvio. Ela vira a descrição do evento e é escrita uma única vez. Não
  repita o título, não invente fatos, pessoas, documentos ou datas que a demanda
  não sugere. Sem nada útil a dizer, omita.
- passos: mande SÓ quando (a) o usuário pediu explicitamente checklist, passos,
  etapas ou lista para o compromisso, ou (b) o compromisso é um prazo
  (tipo='deadline') cujo entregável tem etapas concretas e distintas que a própria
  demanda sugere. Entre 2 e 8 itens, em ordem de execução, verbo no infinitivo.
  Não invente etapas que a demanda não sugere e não use passos para repetir a
  nota_de_execucao. Bloco simples de foco: omita. Pedido de checklist ou
  lista sem compromisso na agenda: chame criar_tarefa com os itens em passos.
- Crescimento tem dois níveis, e escolher o errado é erro:
  - criar_po_dominio quando o TEMA não pertence a nenhum domínio existente.
  - contratar_integrante quando o tema já tem domínio mas falta um PAPEL dentro
    dele; passe o dominio_id exato.
- Se o usuário PEDE EXPLICITAMENTE para contratar, trazer alguém, abrir um
  domínio ou uma sala NESTA squad (ex.: "contrate um designer", "preciso de
  alguém para finanças", "abra um domínio de Saúde"),
  SEMPRE chame criar_po_dominio ou contratar_integrante, mesmo que a squad atual
  pareça dar conta. Quem decide é o usuário, no card. Se a mesma demanda também
  pede compromissos, agende-os normalmente. Esta regra vale só para a squad
  atual: pedido de contratação ou de domínio que pertence a uma das OUTRAS
  squads segue a regra de troca abaixo, que VENCE esta.
- Sem pedido explícito, só proponha crescimento quando nenhum domínio ou papel
  da squad atual cobre a demanda. Se a squad atual dá conta, não chame nenhuma
  das duas.
- Se a demanda pertence claramente ao escopo de uma das OUTRAS squads listadas,
  chame APENAS sugerir_troca_squad com o squad_id dela e não agende nada nesta
  squad. Vale também para pedido explícito de contratação ou de domínio para
  outra squad: só sugerir_troca_squad, nunca criar_po_dominio nem
  contratar_integrante aqui. Na dúvida, trate a demanda na squad atual. Se não há outras squads,
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

/** Transitório: vale retentar e cair no modelo reserva. TIMEOUT é o do próprio gerarComRetry. */
const TRANSITORIO = /(429|503)|UNAVAILABLE|RESOURCE_EXHAUSTED|TIMEOUT/;

/**
 * Teto de UMA tentativa ao Gemini. Sem ele uma chamada travada prendia o turno
 * para sempre. 45s cobre as respostas lentas medidas em pico (~15s) com folga.
 * Pior caso de uma geração:
 * 2 modelos x 2 tentativas x 45s + backoff (~2,4s) ≈ 3 min.
 */
export const TIMEOUT_GEMINI_MS = 45_000;

/**
 * Duas tentativas POR MODELO, não mais: uma chamada em hora de pico já demora
 * ~15s antes de falhar, e o usuario esta olhando um spinner. 2 modelos x 2
 * tentativas e o teto que ainda cabe num clique. Cada tentativa tem timeout
 * (`timeoutMs`), que conta como transitório.
 *
 * Exportada para server/redacao.ts: sofre o mesmo 503 e merece o mesmo modelo
 * reserva.
 */
export async function gerarComRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
  tentativas = 2,
  timeoutMs = TIMEOUT_GEMINI_MS,
) {
  let ultimo: any;
  for (const model of [params.model, ...MODELOS_RESERVA]) {
    for (let i = 0; i < tentativas; i++) {
      const controle = new AbortController();
      let relogio: ReturnType<typeof setTimeout> | undefined;
      // Race além do abortSignal: o SDK cancela o fetch pelo sinal, mas a
      // tentativa não pode depender de ele honrar o cancelamento para acabar.
      const estouro = new Promise<never>((_, rejeitar) => {
        relogio = setTimeout(() => {
          rejeitar(new Error(`TIMEOUT: ${model} não respondeu em ${Math.round(timeoutMs / 1000)}s.`));
          controle.abort();
        }, timeoutMs);
      });
      try {
        return await Promise.race([
          ai.models.generateContent({ ...params, model, config: { ...params.config, abortSignal: controle.signal } }),
          estouro,
        ]);
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
      } finally {
        clearTimeout(relogio);
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
  /** Por que não há token (a exceção de `tokenValido()`); ausente/null quando há. */
  falhaDoToken?: unknown;
  /**
   * Janela de trabalho já validada pela rota. Ausente = padrão (09:00–19:00,
   * seg–sex): chamadores anteriores à Fase 3 continuam válidos, e a rota sempre
   * passa a lida do ambiente.
   */
  janela?: Janela;
  /** Relógio do turno. A rota não passa; scripts de verificação fixam. */
  agora?: Date;
  /**
   * A credencial tem o escopo do Google Tasks? Resolvido UMA vez pela rota.
   * Ausente = false: chamadores antigos e scripts não criam passos por engano.
   */
  tasksLiberado?: boolean;
  /**
   * Token pedido de novo antes de cada chamada ao Tasks (a rota passa
   * `tokenValido`). Ausente = o `token` do turno, ou `PrecisaConectar` sem ele.
   */
  obterToken?: ObterToken;
  /**
   * Chamado ao fim de CADA turno do Gemini (dois, com redirecionamento) com o
   * systemInstruction usado e as functionCalls cruas. É o gancho da Luna em
   * sombra (`server/luna-sombra.ts`): callback, e não campo do TurnoResult,
   * para o prompt e as chamadas não irem à UI nem ao Telegram. Lança = só log.
   */
  aoTerminarTurno?: (turno: TurnoObservado) => void;
}

/** O que um turno do Gemini mostrou, para quem observa de fora (a sombra). */
export interface TurnoObservado {
  squad: Squad;
  systemInstruction: string;
  chamadas: FunctionCall[];
}

/**
 * UM turno dentro de UMA squad: uma chamada ao Gemini e as capacidades que ela
 * pediu. Quem decide se ele roda de novo em outra squad é `executarTurno` —
 * aqui a squad é dada e não muda no meio.
 */
async function rodarTurno(
  ai: GoogleGenAI,
  pedido: PedidoDeTurno,
  squad: Squad,
  janela: Janela,
  agora: Date,
): Promise<TurnoResult> {
  const { demanda, token, falhaDoToken, modo, roster } = pedido;

  const systemInstruction = buildSystemInstruction(
    {
      squadNome: squad.nome,
      squadEscopo: squad.escopo,
      arvore: rosterTree(squad),
      outrasSquads: outrasSquads(roster, squad.id),
      janela: descreverJanela(janela),
    },
    agoraLocalISO(agora),
    modo,
  );
  const response = await gerarComRetry(ai, {
    model: MODEL,
    contents: demanda,
    config: {
      systemInstruction,
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
  const agenda = new AgendaDoTurno({ token, falhaDoToken, janela, agora });
  const obterToken: ObterToken =
    pedido.obterToken ??
    (async () => {
      if (token) return token;
      throw new PrecisaConectar("Nenhuma credencial do Google guardada.");
    });
  const ctx: CapabilityContext = {
    token, roster, squad, agora, modo, demanda, agenda,
    tasks: { liberado: pedido.tasksLiberado === true, obterToken },
  };

  // Decidido ANTES de executar qualquer chamada (regra da Fase 1): com troca de
  // squad no turno, as outras chamadas são descartadas, inclusive agendamentos,
  // e descartadas nem chegam a ler a agenda.
  const temTroca = calls.some((c) => c.name === TROCA_DE_SQUAD);

  // One-shot: executa as calls e acaba. Sem realimentar o modelo.
  // Um try POR TAREFA: uma tarefa quebrada não pode matar o lote.
  const executar = async (call: FunctionCall): Promise<CapabilityResult | ErroTarefa> => {
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
      const motivo = motivoDoErro(err);
      return { capacidade: nome, args, erro: err?.message ?? String(err), ...(motivo ? { motivo } : {}) };
    }
  };

  // agendar_evento em SÉRIE, por prioridade: cada reserva precisa estar na
  // ocupação antes do próximo compromisso escolher horário. Em paralelo, dois
  // compromissos da mesma demanda liam a mesma agenda e caíam no mesmo slot.
  // O resto (propostas) não disputa agenda e segue em paralelo.
  const resultados: (CapabilityResult | ErroTarefa)[] = new Array(calls.length);
  const forcado = tipoForcado(modo);
  const baixaPrioridade = ehBaixaPrioridade(modo);
  // criar_tarefa num modo forçado vira bloco na agenda (ver o handler), então
  // entra na mesma série; em `auto` não toca a agenda e segue em paralelo.
  const disputaAgenda = (call: FunctionCall) =>
    call.name === "agendar_evento" || (call.name === "criar_tarefa" && forcado !== null);
  const deAgenda = calls
    .map((call, indice) => ({ call, indice }))
    .filter((x) => disputaAgenda(x.call))
    .map((x) => ({
      ...x,
      prioridade: prioridadeDeAgendamento(
        (x.call.args ?? {}) as Record<string, any>,
        forcado,
        janela,
        baixaPrioridade,
      ),
    }))
    .sort((a, b) => a.prioridade[0] - b.prioridade[0] || a.prioridade[1] - b.prioridade[1] || a.indice - b.indice);
  const emParalelo = Promise.all(
    calls.map(async (call, indice) => {
      if (!disputaAgenda(call)) resultados[indice] = await executar(call);
    }),
  );
  for (const { call, indice } of deAgenda) resultados[indice] = await executar(call);
  await emParalelo;

  // Resultados na ordem em que o modelo chamou, não na ordem de alocação.
  const turno: TurnoResult = { eventos_criados: [], tarefas_criadas: [], sugestoes: [], avisos: [], erros: [] };
  for (const r of resultados) {
    if ("erro" in r) turno.erros.push(r);
    else if (r.kind === "compromisso") {
      turno.eventos_criados.push(...r.eventos);
      for (const { aviso, motivo } of r.avisos) {
        turno.avisos.push({ capacidade: "agendar_evento", titulo: r.titulo, aviso, ...(motivo ? { motivo } : {}) });
      }
    } else if (r.kind === "tarefa") {
      turno.tarefas_criadas.push(r);
      for (const { aviso, motivo } of r.avisos) {
        turno.avisos.push({ capacidade: "criar_tarefa", titulo: r.titulo, aviso, ...(motivo ? { motivo } : {}) });
      }
    } else turno.sugestoes.push({ ...r, id: randomUUID() });
  }

  if (calls.length === 0) {
    turno.erros.push({
      capacidade: "-",
      args: {},
      erro: "O modelo não chamou nenhuma capacidade para esta demanda.",
    });
  }

  // Depois de tudo e sem await: quem observa não participa do turno, e um
  // observador quebrado não pode custar um compromisso que já nasceu no Google.
  if (pedido.aoTerminarTurno) {
    try {
      pedido.aoTerminarTurno({ squad, systemInstruction, chamadas: calls });
    } catch (err) {
      console.warn("[turno] observador falhou:", err instanceof Error ? err.message : err);
    }
  }

  return turno;
}

/** A primeira proposta de troca do turno, se houver. Mais de uma é o mesmo veredito repetido. */
function trocaSugerida(turno: TurnoResult) {
  return turno.sugestoes.find(
    (s): s is Extract<Sugestao, { kind: "troca_squad" }> => s.kind === "troca_squad",
  );
}

/**
 * O turno, com redirecionamento automático de squad.
 *
 * Quando o modelo diz que a demanda é de outra squad, o servidor não devolve um
 * card e espera clique: troca a squad e reprocessa a MESMA demanda lá (2ª
 * chamada ao Gemini, só nesse caso), devolvendo o resultado de lá como se fosse
 * o turno original. O turno de origem não deixa rastro porque não deixa efeito:
 * `descartarPorTroca` já descarta todas as outras chamadas ANTES de executar,
 * então nada foi criado no Google e a agenda nem chegou a ser lida.
 *
 * TETO DE UM SALTO. Sem ele, duas squads que apontam uma para a outra rodariam
 * o Gemini até o timeout do proxy, e cada salto é uma chamada paga. Se a squad
 * de destino também sugerir troca, o resultado dela volta com a proposta
 * dentro: o `TrocaSquadCard` continua existindo exatamente para esse empate.
 */
export async function executarTurno(ai: GoogleGenAI, pedido: PedidoDeTurno): Promise<TurnoResult> {
  const janela = pedido.janela ?? lerJanela({});
  // Um relógio só para os dois turnos: o segundo é reprocessamento do mesmo
  // pedido, não um pedido novo — "amanhã" tem que significar o mesmo dia nos dois.
  const agora = pedido.agora ?? new Date();

  const primeiro = await rodarTurno(ai, pedido, pedido.squad, janela, agora);
  const troca = trocaSugerida(primeiro);
  if (!troca) return primeiro;

  // Destino já validado pelo handler (existe, ativa, diferente da origem); esta
  // busca é só para pegar a Squad inteira, que a proposta não carrega.
  const destino = squadsAtivas(pedido.roster).find((s) => s.id === troca.destino_id);
  if (!destino) return primeiro;

  // Mesmo `modo`: o toggle é intenção do usuário sobre o TIPO do compromisso
  // ("bloco agora"), não sobre a squad. Diferente do reenvio manual do card,
  // que é um gesto novo, depois do turno.
  const segundo = await rodarTurno(ai, pedido, destino, janela, agora);
  return {
    ...segundo,
    redirecionado: {
      de_id: pedido.squad.id,
      de_nome: pedido.squad.nome,
      para_id: destino.id,
      para_nome: destino.nome,
      justificativa: troca.justificativa,
    },
  };
}
