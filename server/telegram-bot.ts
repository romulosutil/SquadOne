import type { RequestHandler } from "express";
import type { Modo } from "./capabilities.ts";
import type { TurnoResult } from "./orchestrator.ts";
import type { FormatoDeData } from "../src/contribuicao.ts";
import { segredoConfere, type Botao } from "./telegram.ts";
import {
  criarMemoriaDeUpdates,
  dadosDoBotao,
  interpretarUpdate,
  TEXTO_DE_AJUDA,
  TEXTO_SEM_TEXTO,
  textoDeAudioLongo,
  textoDeDemandaAtrasada,
} from "./telegram-entrada.ts";
import {
  cortarParaTelegram,
  propostasDeContratacao,
  textoDaFalha,
  textoDaFalhaDeTranscricao,
  textoDaProposta,
  textoDoTurno,
  type PropostaDeContratacao,
} from "./telegram-resposta.ts";

/**
 * A cola do bot: portão próprio (a rota fica FORA do porteiro de IP), 200
 * imediato e uma fila serial de turnos. Duas portas para o mesmo `receber`:
 * `processar` (webhook, Express) e o polling (`telegram-polling.ts`).
 *
 * - 200 antes do turno: um turno leva até ~6 min no pior caso (redirecionamento
 *   de squad = 2 gerações do Gemini de ~3 min cada, mais o Google); segurar a
 *   resposta faria o Telegram desistir e reentregar o update, e o compromisso
 *   nasceria duas vezes.
 * - Fila serial: dois turnos em paralelo leriam a agenda antes de o outro
 *   reservar e pegariam o mesmo horário. A CommandBar evita isso com isLoading.
 *   Turno da UI e do bot ao mesmo tempo continua possível (custo aceito).
 * - Áudio entra na MESMA fila: a transcrição é só o primeiro passo do turno.
 * - Propostas de contratação vão em mensagens próprias com Aprovar/Descartar.
 *   Ficam só em memória (redeploy esquece: o botão responde "expirada") e valem
 *   UM toque: a proposta sai da memória antes de aplicar, então dois toques
 *   rápidos não contratam duas pessoas.
 * - Tudo por dependência injetada: o teste roda sem Express, Google e Telegram.
 */

export interface DepsDoBot {
  /** Segredo do webhook; null no polling (sem rota, o portão recusa tudo). */
  segredo: string | null;
  chatsPermitidos: ReadonlySet<number>;
  /** `squadId` só com prefixo de squad (`/p`); ausente = primeira squad ativa. */
  rodar(demanda: string, modo: Modo, squadId?: string): Promise<TurnoResult>;
  enviar(chatId: number, texto: string, responderA?: number, botoes?: Botao[]): Promise<void>;
  digitando(chatId: number): Promise<void>;
  /** Baixa o áudio do Telegram e devolve a transcrição (lança `AudioSemFala` sem fala). */
  transcrever(fileId: string, mime: string): Promise<string>;
  /** Aplica a proposta aprovada (`aplicarContratacao`) e devolve o texto do resultado. */
  contratar(proposta: PropostaDeContratacao): Promise<string>;
  /** Tira o "carregando" do botão tocado. */
  responderBotao(callbackId: string, texto: string): Promise<void>;
  /** Troca o texto da mensagem da proposta; os botões somem. */
  editar(chatId: number, mensagemId: number, texto: string): Promise<void>;
  fmt: FormatoDeData;
  /** Relógio injetado: decide se a demanda chegou atrasada demais para rodar. */
  agora(): Date;
}

/** "digitando..." some em 5 s no Telegram. */
export const INTERVALO_DIGITANDO_MS = 4000;

/** Proposta sem toque por mais que isto não vale: o roster pode ter mudado muito desde o turno. */
export const VALIDADE_PROPOSTA_MS = 24 * 3600_000;
/** Teto da memória de propostas: a mais antiga sai primeiro. */
export const MAX_PROPOSTAS_PENDENTES = 50;

export const TEXTO_PROPOSTA_EXPIRADA = "⌛ Proposta expirada (o servidor reiniciou ou passou 24h). Peça de novo.";

interface PropostaPendente {
  proposta: PropostaDeContratacao;
  chatId: number;
  texto: string;
  criadaEm: number;
}

export function criarBotDoTelegram(deps: DepsDoBot) {
  const memoria = criarMemoriaDeUpdates();
  const propostas = new Map<string, PropostaPendente>();
  let fila: Promise<void> = Promise.resolve();
  let pendentes = 0;

  const falhouAoEnviar = (err: unknown) =>
    console.error(`[telegram] falha ao responder: ${err instanceof Error ? err.message : String(err)}`);

  function enfileirar(tarefa: () => Promise<void>): number {
    const antes = pendentes;
    pendentes++;
    fila = fila
      .then(tarefa)
      .catch((err) => console.error("[telegram] tarefa da fila falhou:", err))
      .finally(() => { pendentes--; });
    return antes;
  }

  function guardarProposta(p: PropostaPendente): void {
    propostas.set(p.proposta.id, p);
    // Map itera na ordem de inserção: a primeira chave é a mais antiga.
    while (propostas.size > MAX_PROPOSTAS_PENDENTES) propostas.delete(propostas.keys().next().value!);
  }

  /** Tira da memória (uso único); null se não existe, expirou ou é de outro chat. */
  function tomarProposta(id: string, chatId: number): PropostaPendente | null {
    const p = propostas.get(id);
    propostas.delete(id);
    if (!p || p.chatId !== chatId || deps.agora().getTime() - p.criadaEm > VALIDADE_PROPOSTA_MS) return null;
    return p;
  }

  async function mandarPropostas(chatId: number, turno: TurnoResult): Promise<void> {
    for (const proposta of propostasDeContratacao(turno)) {
      const texto = textoDaProposta(proposta);
      guardarProposta({ proposta, chatId, texto, criadaEm: deps.agora().getTime() });
      try {
        await deps.enviar(chatId, texto, undefined, [
          { texto: "✅ Aprovar", dados: dadosDoBotao(proposta.id, "aprovar") },
          { texto: "🗑️ Descartar", dados: dadosDoBotao(proposta.id, "descartar") },
        ]);
      } catch (err) {
        propostas.delete(proposta.id);
        falhouAoEnviar(err);
      }
    }
  }

  /**
   * Um turno da fila: obtém a demanda (texto direto ou transcrição), roda e
   * responde. `prefixo` é o que foi entendido do áudio, ecoado antes do
   * resultado para o usuário conferir.
   */
  function turnoNaFila(
    chatId: number,
    mensagemId: number,
    modo: Modo,
    squadId: string | undefined,
    obterDemanda: () => Promise<{ demanda: string; prefixo?: string } | { falha: string }>,
  ): number {
    return enfileirar(async () => {
      deps.digitando(chatId).catch(() => {});
      const relogio = setInterval(() => deps.digitando(chatId).catch(() => {}), INTERVALO_DIGITANDO_MS);
      let resultado: TurnoResult | undefined;
      let texto: string | undefined;
      let prefixo = "";
      try {
        const obtida = await obterDemanda();
        if ("falha" in obtida) {
          texto = obtida.falha;
        } else {
          prefixo = obtida.prefixo ?? "";
          try {
            resultado = await deps.rodar(obtida.demanda, modo, squadId);
          } catch (err) {
            console.error("[telegram] erro no turno:", err);
            texto = textoDaFalha(err);
          }
        }
      } finally {
        clearInterval(relogio);
      }
      if (texto === undefined) {
        // rodar() teve sucesso — o compromisso já pode ter nascido no
        // Google. Falha SÓ em formatar o resumo não é "erro ao processar
        // a demanda": esse texto faria o usuário reenviar e duplicar o
        // compromisso. Guarda própria, fora do try acima.
        try {
          texto = textoDoTurno(resultado!, deps.fmt);
        } catch (err) {
          console.error("[telegram] erro ao montar o resumo do turno:", err);
          texto = "✅ Demanda processada, mas não consegui montar o resumo. Confira a agenda antes de reenviar.";
        }
      }
      await deps.enviar(chatId, cortarParaTelegram(prefixo + texto), mensagemId).catch(falhouAoEnviar);
      if (resultado) await mandarPropostas(chatId, resultado);
    });
  }

  async function tocarBotao(chatId: number, mensagemId: number, callbackId: string, acao: "aprovar" | "descartar", id: string) {
    const pendente = tomarProposta(id, chatId);
    if (!pendente) {
      await deps.responderBotao(callbackId, "Proposta expirada.").catch(falhouAoEnviar);
      await deps.editar(chatId, mensagemId, TEXTO_PROPOSTA_EXPIRADA).catch(falhouAoEnviar);
      return;
    }
    if (acao === "descartar") {
      await deps.responderBotao(callbackId, "Descartada.").catch(falhouAoEnviar);
      await deps.editar(chatId, mensagemId, `${pendente.texto}\n\n🗑️ Descartada.`).catch(falhouAoEnviar);
      return;
    }
    await deps.responderBotao(callbackId, "Contratando…").catch(falhouAoEnviar);
    let resultado: string;
    try {
      resultado = await deps.contratar(pendente.proposta);
    } catch (err) {
      // A proposta já saiu da memória: não fica um botão que contrataria de
      // novo depois de uma falha parcial. Pedir de novo gera outra, revalidada.
      console.error("[telegram] contratação falhou:", err);
      resultado = `❌ Não contratei: ${err instanceof Error ? err.message : String(err)} Peça de novo se ainda valer.`;
    }
    await deps.editar(chatId, mensagemId, `${pendente.texto}\n\n${resultado}`).catch(falhouAoEnviar);
  }

  const portao: RequestHandler = (req, res, next) => {
    if (deps.segredo === null || !segredoConfere(deps.segredo, req.get("X-Telegram-Bot-Api-Secret-Token"))) {
      // Sem detalhe e sem logar o header: quem não tem o segredo não é o Telegram.
      console.warn("[telegram] webhook com segredo inválido");
      res.status(401).end();
      return;
    }
    next();
  };

  /**
   * Um update: interpreta, deduplica e enfileira (ou responde na hora). Volta
   * assim que o update está na fila, sem esperar o turno: é o ponto em que o
   * webhook responde 200 e o polling avança o offset.
   */
  function receber(update: unknown): void {
    const entrada = interpretarUpdate(update, deps.chatsPermitidos, deps.agora());
    if (entrada.updateId !== null && memoria.jaVisto(entrada.updateId)) return;

    switch (entrada.tipo) {
      case "ignorar":
        return;
      case "naoAutorizado":
        // Sem resposta no chat. O log é como o dono descobre o próprio chat_id.
        console.warn(`[telegram] chat ${entrada.chatId} não autorizado (TELEGRAM_CHAT_IDS)`);
        return;
      case "ajuda":
        deps.enviar(entrada.chatId, TEXTO_DE_AJUDA, entrada.mensagemId).catch(falhouAoEnviar);
        return;
      case "semTexto":
        deps.enviar(entrada.chatId, TEXTO_SEM_TEXTO, entrada.mensagemId).catch(falhouAoEnviar);
        return;
      case "audioLongo":
        deps.enviar(entrada.chatId, textoDeAudioLongo(), entrada.mensagemId).catch(falhouAoEnviar);
        return;
      case "atrasada":
        // Backlog reentregue depois de o servidor voltar: rodar agora marcaria
        // horário errado ou duplicaria o que o usuário já reenviou pelo app.
        console.warn(`[telegram] demanda com ${entrada.atrasoMin} min de atraso não processada`);
        deps.enviar(entrada.chatId, textoDeDemandaAtrasada(entrada.atrasoMin), entrada.mensagemId).catch(falhouAoEnviar);
        return;
      case "botao":
        // Fora da fila de turnos: contratar não lê a agenda, e a fila do
        // roster (`atualizarRoster`) já serializa a gravação.
        tocarBotao(entrada.chatId, entrada.mensagemId, entrada.callbackId, entrada.acao, entrada.propostaId).catch((err) =>
          console.error("[telegram] botão falhou:", err),
        );
        return;
      case "audio": {
        const { chatId, mensagemId, fileId, mime, modo, squadId } = entrada;
        const antes = turnoNaFila(chatId, mensagemId, modo, squadId, async () => {
          try {
            const demanda = await deps.transcrever(fileId, mime);
            return { demanda, prefixo: `🎙️ “${demanda}”\n\n` };
          } catch (err) {
            console.error("[telegram] transcrição falhou:", err);
            return { falha: textoDaFalhaDeTranscricao(err) };
          }
        });
        if (antes > 0) deps.enviar(chatId, `⏳ Na fila (${antes} antes desta).`, mensagemId).catch(falhouAoEnviar);
        return;
      }
      case "demanda": {
        const { chatId, mensagemId, demanda, modo, squadId } = entrada;
        const antes = turnoNaFila(chatId, mensagemId, modo, squadId, async () => ({ demanda }));
        if (antes > 0) deps.enviar(chatId, `⏳ Na fila (${antes} antes desta).`, mensagemId).catch(falhouAoEnviar);
        return;
      }
    }
  }

  const processar: RequestHandler = (req, res) => {
    // 200 para tudo que passou do segredo, inclusive o que é ignorado: status
    // diferente faz o Telegram reentregar e segurar os updates seguintes.
    res.sendStatus(200);
    receber(req.body);
  };

  // `ocupado` conta também o que espera na fila, não só o turno da vez: a
  // mensagem já recebeu 200 e o Telegram não a reentrega se o processo cair.
  return { portao, processar, receber, ocioso: () => fila, ocupado: () => pendentes > 0 };
}
