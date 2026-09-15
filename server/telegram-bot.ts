import type { RequestHandler } from "express";
import type { Modo } from "./capabilities.ts";
import type { TurnoResult } from "./orchestrator.ts";
import type { FormatoDeData } from "../src/contribuicao.ts";
import { segredoConfere } from "./telegram.ts";
import { criarMemoriaDeUpdates, interpretarUpdate, TEXTO_DE_AJUDA, TEXTO_SEM_TEXTO } from "./telegram-entrada.ts";
import { cortarParaTelegram, textoDaFalha, textoDoTurno } from "./telegram-resposta.ts";

/**
 * A cola do bot: portão próprio (a rota fica FORA do porteiro de IP), 200
 * imediato e uma fila serial de turnos.
 *
 * - 200 antes do turno: um turno leva até ~3 min; segurar a resposta faria o
 *   Telegram desistir e reentregar o update, e o compromisso nasceria duas vezes.
 * - Fila serial: dois turnos em paralelo leriam a agenda antes de o outro
 *   reservar e pegariam o mesmo horário. A CommandBar evita isso com isLoading.
 *   Turno da UI e do bot ao mesmo tempo continua possível (custo aceito).
 * - Tudo por dependência injetada: o teste roda sem Express, Google e Telegram.
 */

export interface DepsDoBot {
  segredo: string;
  chatsPermitidos: ReadonlySet<number>;
  rodar(demanda: string, modo: Modo): Promise<TurnoResult>;
  enviar(chatId: number, texto: string, responderA?: number): Promise<void>;
  digitando(chatId: number): Promise<void>;
  fmt: FormatoDeData;
}

/** "digitando..." some em 5 s no Telegram. */
export const INTERVALO_DIGITANDO_MS = 4000;

export function criarBotDoTelegram(deps: DepsDoBot) {
  const memoria = criarMemoriaDeUpdates();
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

  const portao: RequestHandler = (req, res, next) => {
    if (!segredoConfere(deps.segredo, req.get("X-Telegram-Bot-Api-Secret-Token"))) {
      // Sem detalhe e sem logar o header: quem não tem o segredo não é o Telegram.
      console.warn("[telegram] webhook com segredo inválido");
      res.status(401).end();
      return;
    }
    next();
  };

  const processar: RequestHandler = (req, res) => {
    const entrada = interpretarUpdate(req.body, deps.chatsPermitidos);
    // 200 para tudo que passou do segredo, inclusive o que é ignorado: status
    // diferente faz o Telegram reentregar e segurar os updates seguintes.
    res.sendStatus(200);
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
      case "demanda": {
        const { chatId, mensagemId, demanda, modo } = entrada;
        const antes = enfileirar(async () => {
          deps.digitando(chatId).catch(() => {});
          const relogio = setInterval(() => deps.digitando(chatId).catch(() => {}), INTERVALO_DIGITANDO_MS);
          let resultado: TurnoResult | undefined;
          let texto: string | undefined;
          try {
            resultado = await deps.rodar(demanda, modo);
          } catch (err) {
            console.error("[telegram] erro no turno:", err);
            texto = textoDaFalha(err);
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
          await deps.enviar(chatId, cortarParaTelegram(texto), mensagemId).catch(falhouAoEnviar);
        });
        if (antes > 0) deps.enviar(chatId, `⏳ Na fila (${antes} antes desta).`, mensagemId).catch(falhouAoEnviar);
        return;
      }
    }
  };

  return { portao, processar, ocioso: () => fila };
}
