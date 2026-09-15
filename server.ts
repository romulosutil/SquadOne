import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import {
  ConflitoDeRoster,
  dominiosDoSquad,
  paraVista,
  PedidoInvalido,
  readRoster,
  resolverSquad,
  SquadInexistente,
  type Squad,
} from "./server/squad.ts";
import { ModeloOcupado } from "./server/orchestrator.ts";
import { rodarDemanda } from "./server/turno.ts";
import { ErroCalendario, LeituraIncompleta, listarQuests, listarQuestsDaJanela, MarcasPerdidas, QuestSumiu } from "./server/calendar.ts";
import { aplicarAjuste, interpretarPedidoDeAjuste } from "./server/ajuste.ts";
import { QuestRecusada } from "./server/quest.ts";
import { AgendaIndisponivel } from "./server/agenda.ts";
import { ehModo } from "./server/capabilities.ts";
import { aplicarContratacao, criarSquad, substituirPo } from "./server/hire.ts";
import {
  arquivarDominio,
  arquivarPessoa,
  arquivarSquad,
  editarDominio,
  editarPessoa,
  editarSquad,
  reativarDominio,
  reativarPessoa,
  reativarSquad,
} from "./server/ciclo-de-vida.ts";
import { interpretarPedidoDeRedacao, RedacaoInvalida, redigirTreino } from "./server/redacao.ts";
import { porteiroDeIp } from "./server/acesso.ts";
import { descreverJanela, FUSO, JanelaMalConfigurada, lerInstante, lerJanela, SemHorarioLivre } from "./server/alocador.ts";
import { descreverPush, enviarPush, ErroDePush, lerConfigDePush, PushMalConfigurado, type ConfigDePush } from "./server/push.ts";
import { ANTECEDENCIA_PUSH_MIN } from "./server/lembretes.ts";
import { criarVigia, type Vigia } from "./server/vigia.ts";
import {
  desconectar,
  ErroDeConfig,
  escoposConcedidos,
  EscopoNegado,
  estaConectado,
  PrecisaConectar,
  tokenValido,
  trocarCodigo,
  urlDeConsentimento,
} from "./server/auth-store.ts";
import {
  avisarDigitando,
  descreverTelegram,
  enviarMensagem,
  lerConfigDeTelegram,
  registrarWebhook,
  ROTA_WEBHOOK_TELEGRAM,
  TelegramMalConfigurado,
  type ConfigDeTelegram,
} from "./server/telegram.ts";
import { criarBotDoTelegram } from "./server/telegram-bot.ts";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Traduz as falhas do auth-store em status HTTP. A distincao importa para a
 * interface: `PrecisaConectar` (401) pede o gesto do usuario; `ErroDeConfig`
 * (500) e problema de ambiente e nenhum clique do usuario conserta.
 */
function responderErroDeAuth(res: express.Response, err: unknown): void {
  if (err instanceof PrecisaConectar) {
    res.status(401).json({ error: (err as Error).message, precisaConectar: true });
  } else if (err instanceof ErroDeConfig) {
    res.status(500).json({ error: (err as Error).message, configuracao: true });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

/**
 * Erros do roster em status HTTP. A flag `squadInexistente` separa "a squad
 * desta aba sumiu" (a UI recarrega e cai na primeira) de um conflito comum.
 * Devolve false quando o erro nao e do roster e a rota decide o 500.
 */
function responderErroDeRoster(res: express.Response, err: unknown): boolean {
  if (err instanceof SquadInexistente) {
    res.status(409).json({ error: err.message, squadInexistente: true });
  } else if (err instanceof ConflitoDeRoster) {
    res.status(409).json({ error: err.message });
  } else if (err instanceof PedidoInvalido) {
    res.status(400).json({ error: err.message });
  } else {
    return false;
  }
  return true;
}

/**
 * Erros das rotas de quest. A flag no corpo diz à UI o gesto:
 * `questSumiu` tira o card, `naoCabe` oferece mover, `precisaConectar` pede
 * reconexão, `conflitoDeEdicao` pede tentar de novo, `marcasPerdidas` manda
 * conferir no Google. Devolve false quando não é nenhum e a rota decide o 500.
 */
function responderErroDeQuest(res: express.Response, err: unknown): boolean {
  const error = (err as Error)?.message;
  if (err instanceof PrecisaConectar) {
    // O token é pedido de novo antes de cada chamada ao Google: pode faltar no meio.
    res.status(401).json({ error, precisaConectar: true });
  } else if (err instanceof ErroDeConfig) {
    res.status(500).json({ error, configuracao: true });
  } else if (err instanceof QuestSumiu) {
    res.status(404).json({ error, questSumiu: true });
  } else if (err instanceof QuestRecusada) {
    res.status(409).json({ error, [err.flag]: true });
  } else if (err instanceof SemHorarioLivre) {
    res.status(409).json({ error, semHorarioLivre: true });
  } else if (err instanceof JanelaMalConfigurada) {
    res.status(500).json({ error, configuracao: true });
  } else if (err instanceof MarcasPerdidas) {
    res.status(500).json({ error, marcasPerdidas: true });
  } else if (
    (err instanceof ErroCalendario && err.ehCredencial) ||
    (err instanceof AgendaIndisponivel && err.credencial)
  ) {
    res.status(401).json({ error, precisaConectar: true });
  } else if (
    err instanceof ErroCalendario ||
    err instanceof AgendaIndisponivel ||
    err instanceof LeituraIncompleta
  ) {
    res.status(502).json({ error });
  } else {
    return false;
  }
  return true;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // O Traefik do Easypanel e o unico caminho ate aqui: sem isto o Express
  // reporta o IP do proxy em req.ip e o porteiro julgaria sempre o mesmo IP.
  app.set("trust proxy", true);

  // --- Bot do Telegram ------------------------------------------------
  // ANTES do porteiro de IP, e só esta rota: o Telegram não tem IP fixo. A
  // trava dela é o segredo do webhook + a allowlist de chat_id. Desligado, a
  // rota nem existe e o caminho cai no porteiro como qualquer outro.
  let configDeTelegram: ConfigDeTelegram | null = null;
  let falhaDoTelegram: string | null = null;
  try {
    configDeTelegram = lerConfigDeTelegram(process.env);
  } catch (error: any) {
    falhaDoTelegram = error instanceof TelegramMalConfigurado ? error.message : String(error?.message ?? error);
  }
  if (configDeTelegram) {
    const c = configDeTelegram;
    const bot = criarBotDoTelegram({
      segredo: c.segredo,
      chatsPermitidos: c.chatsPermitidos,
      // Sem squadId: o bot não tem aba. Primeira squad ativa + redirecionamento automático.
      rodar: (demanda, modo) => rodarDemanda(ai, { demanda, modo }),
      enviar: (chatId, texto, responderA) => enviarMensagem(c, chatId, texto, responderA),
      digitando: (chatId) => avisarDigitando(c, chatId),
      // O container roda em UTC: sem o fuso o horário da resposta sairia 3h adiantado.
      fmt: { locale: "pt-BR", timeZone: FUSO },
    });
    app.post(ROTA_WEBHOOK_TELEGRAM, bot.portao, express.json({ limit: "256kb" }), bot.processar);
  }

  // Antes de tudo — inclusive dos estaticos: um 403 aqui custa nada e nao
  // deixa nem o index.html vazar para quem nao e o dono.
  app.use(porteiroDeIp());

  app.use(express.json());

  // --- Conexao com o Google -------------------------------------------
  // O token nunca passa pelo browser: o servidor troca o code, guarda o
  // refresh cifrado no volume e renova sozinho. O frontend so pergunta se
  // esta conectado e manda o usuario para o consentimento.

  app.get("/api/auth/status", async (_req, res) => {
    try {
      const conectado = await estaConectado();
      // `tasks` é estado DEGRADADO, não conexão: credencial só com o Calendar
      // segue conectada e agendando; a UI só oferece "Autorizar Google Tasks".
      const { tasks } = conectado ? await escoposConcedidos() : { tasks: false };
      res.json({ conectado, tasks });
    } catch (error) {
      responderErroDeAuth(res, error);
    }
  });

  app.get("/api/auth/google", (_req, res) => {
    try {
      res.redirect(urlDeConsentimento());
    } catch (error: any) {
      console.error("Erro ao montar o consentimento:", error);
      res.status(500).send(error.message);
    }
  });

  app.get("/api/auth/callback", async (req, res) => {
    const { code, state, error: recusa } = req.query;
    // O usuario pode simplesmente dizer nao na tela do Google.
    if (recusa) return res.redirect(`/?auth=${encodeURIComponent(String(recusa))}`);
    if (typeof code !== "string" || typeof state !== "string") {
      return res.redirect("/?auth=callback_incompleto");
    }
    try {
      await trocarCodigo(code, state);
      res.redirect("/?auth=ok");
    } catch (error: any) {
      // Calendar desmarcado no consentimento granular: nada foi gravado e a
      // credencial anterior continua. Código fixo para a UI dizer isso com
      // clareza, em vez de repetir a mensagem crua na URL.
      if (error instanceof EscopoNegado) return res.redirect("/?auth=escopo_calendar_negado");
      console.error("Erro no callback do Google:", error);
      res.redirect(`/?auth=${encodeURIComponent(error.message)}`);
    }
  });

  app.post("/api/auth/logout", async (_req, res) => {
    await desconectar();
    res.json({ conectado: false });
  });

  // Roster inteiro, todas as squads: o seletor precisa da lista, o arquivo tem
  // poucos KB e a squad ativa e conveniencia da aba, nao estado do servidor.
  app.get("/api/squad", async (_req, res) => {
    try {
      res.json(paraVista(await readRoster()));
    } catch (error: any) {
      console.error("Erro ao ler o roster:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Gesto "Nova squad": nasce com um dominio e o PO dele. Nao toca o Google.
  app.post("/api/squad/nova", async (req, res) => {
    try {
      res.status(201).json(await criarSquad(req.body ?? {}));
    } catch (error: any) {
      console.error("Erro ao criar squad:", error);
      if (!responderErroDeRoster(res, error)) res.status(500).json({ error: error.message });
    }
  });

  // Aprovacao de crescimento (§4.4): contrata a partir de card do modelo OU do
  // formulario da UI (Fase 2). O modelo so propoe; contratar e gesto do usuario.
  // Nao exige Bearer: mexe em data/squad.json, nao no Google Calendar.
  app.post("/api/squad/hire", async (req, res) => {
    try {
      const { sugestao, nome } = req.body ?? {};
      const resultado = await aplicarContratacao(sugestao, nome);
      res.json(resultado);
    } catch (error: any) {
      // Conflito = a proposta nao cabe mais no roster atual (dominio duplicado,
      // escritorio cheio, squad inexistente): e estado que mudou, nao pedido
      // malformado. Erro sem classificacao e nosso (disco, roster ilegivel): 500.
      console.error("Erro ao contratar:", error);
      if (!responderErroDeRoster(res, error)) res.status(500).json({ error: error.message });
    }
  });

  // Redacao do treino (Fase 2 §4.2): uma chamada ao Gemini, NADA gravado.
  // Roster e alvo sao validados antes do modelo; falhar aqui nunca impede
  // contratar a mao, entao cada falha volta classificada para a UI dizer isso.
  app.post("/api/squad/redigir", async (req, res) => {
    try {
      const pedido = interpretarPedidoDeRedacao(await readRoster(), req.body);
      res.json(await redigirTreino(ai, pedido));
    } catch (error: any) {
      if (responderErroDeRoster(res, error)) return;
      if (error instanceof ModeloOcupado) {
        return res.status(503).json({ error: error.message, modeloOcupado: true });
      }
      if (error instanceof RedacaoInvalida) {
        return res.status(502).json({ error: error.message, redacaoFalhou: true });
      }
      console.error("Erro ao redigir:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Ciclo de vida (Fase 2 §4.4-§4.8): todas escrevem so em data/squad.json,
   * nenhuma toca o Google, e todas devolvem o roster inteiro para a UI trocar
   * o dela. Ids de pessoa e dominio sao globais, por isso o caminho nao leva
   * squadId.
   */
  const rotaDoRoster =
    (acao: (req: express.Request) => Promise<unknown>) =>
    async (req: express.Request, res: express.Response) => {
      try {
        res.json(await acao(req));
      } catch (error: any) {
        if (responderErroDeRoster(res, error)) return;
        console.error(`Erro em ${req.method} ${req.path}:`, error);
        res.status(500).json({ error: error.message });
      }
    };

  app.patch("/api/squad/pessoas/:id", rotaDoRoster((req) => editarPessoa(String(req.params.id), req.body)));
  app.post("/api/squad/pessoas/:id/arquivar", rotaDoRoster((req) => arquivarPessoa(String(req.params.id))));
  app.post("/api/squad/pessoas/:id/reativar", rotaDoRoster((req) => reativarPessoa(String(req.params.id))));
  app.patch("/api/squad/dominios/:id", rotaDoRoster((req) => editarDominio(String(req.params.id), req.body)));
  app.post("/api/squad/dominios/:id/arquivar", rotaDoRoster((req) => arquivarDominio(String(req.params.id))));
  app.post("/api/squad/dominios/:id/reativar", rotaDoRoster((req) => reativarDominio(String(req.params.id))));
  // PO nao se arquiva: substitui-se. O anterior vira integrante arquivado.
  app.post("/api/squad/dominios/:id/po", rotaDoRoster((req) => substituirPo(String(req.params.id), req.body)));
  app.patch("/api/squad/squads/:id", rotaDoRoster((req) => editarSquad(String(req.params.id), req.body)));
  app.post("/api/squad/squads/:id/arquivar", rotaDoRoster((req) => arquivarSquad(String(req.params.id))));
  app.post("/api/squad/squads/:id/reativar", rotaDoRoster((req) => reativarSquad(String(req.params.id))));

  // Mochila: as quests VEM do Google Calendar, nao de estado local. Editar
  // ou apagar no Google reflete aqui na proxima leitura (§2, verdade unica).
  app.get("/api/mochila", async (req, res) => {
    // Squad antes do token: um squadId velho se corrige sem gastar chamada
    // ao Google, e o erro volta classificado.
    let squad: Squad;
    try {
      squad = resolverSquad(await readRoster(), req.query.squadId);
    } catch (error: any) {
      if (responderErroDeRoster(res, error)) return;
      console.error("Erro ao ler o roster:", error);
      return res.status(500).json({ error: error.message });
    }
    let token: string;
    try {
      token = await tokenValido();
    } catch (error) {
      return responderErroDeAuth(res, error);
    }
    try {
      const { quests, erros } = await listarQuests(
        token,
        squad.calendarId,
        dominiosDoSquad(squad),
        new Date(),
      );
      // Token expirado ou revogado: todo dominio falha na credencial. Devolver
      // 200 com uma lista vazia faria o frontend mostrar "nenhuma quest"
      // quando o problema e a credencial. 401 manda ele reconectar.
      const todos = dominiosDoSquad(squad).length;
      if (erros.length > 0 && erros.length === todos) {
        if (erros.every((e) => e.credencial)) {
          return res.status(401).json({
            error: "Google recusou o access_token: reconecte o calendário.",
            erros,
          });
        }
        // Falhou em tudo por outro motivo — API desligada no projeto, quota,
        // rede. Reconectar nao conserta nenhum deles, e mandar o usuario
        // reconectar esconde a mensagem do Google que diz o que fazer.
        return res.status(502).json({ error: erros[0].erro, erros });
      }

      res.json({ quests, erros });
    } catch (error: any) {
      console.error("Erro ao ler a Mochila:", error);
      res.status(502).json({ error: error.message });
    }
  });

  // Um turno: demanda -> 1 chamada ao Gemini -> executa as capacidades.
  app.post("/api/orquestrar", async (req, res) => {
    try {
      const { demanda, modo = "auto", squadId } = req.body ?? {};
      if (typeof demanda !== "string" || !demanda.trim()) {
        return res.status(400).json({ error: "Campo 'demanda' é obrigatório" });
      }
      // Ausente vira auto (cliente antigo continua funcionando); valor
      // desconhecido e 400, nao auto: cair calado no auto gravaria o tipo que
      // o usuario acabou de dizer que nao queria.
      if (!ehModo(modo)) {
        return res
          .status(400)
          .json({ error: "Campo 'modo' deve ser 'auto', 'foco' ou 'baixa_prioridade'" });
      }

      res.json(await rodarDemanda(ai, { demanda: demanda.trim(), modo, squadId }));
    } catch (error: any) {
      console.error("Erro no turno:", error);
      if (responderErroDeRoster(res, error)) return;
      // Ambiente, nao pedido: nenhum clique conserta, igual ao ErroDeConfig do auth.
      if (error instanceof JanelaMalConfigurada) {
        return res.status(500).json({ error: error.message, configuracao: true });
      }
      // Sobrecarga do Gemini nao e falha nossa: 503 + classificacao para a UI
      // oferecer "tentar de novo" em vez do erro generico de sempre.
      if (error instanceof ModeloOcupado) {
        return res.status(503).json({ error: error.message, modeloOcupado: true });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // --- Lembretes push ---------------------------------------------------
  // Config ilegível NÃO derruba o boot: push é acessório, o turno e a Mochila
  // seguem. O erro fica guardado para o log e para as rotas /api/push/*.
  let configDePush: ConfigDePush | null = null;
  let falhaDoPush: string | null = null;
  try {
    configDePush = lerConfigDePush(process.env);
  } catch (error: any) {
    falhaDoPush = error instanceof PushMalConfigurado ? error.message : String(error?.message ?? error);
  }
  const vigia: Vigia | null = configDePush
    ? criarVigia({
        lerJanela: () => lerJanela(process.env),
        lerRoster: readRoster,
        obterToken: tokenValido,
        listar: listarQuestsDaJanela,
        enviar: (m) => enviarPush(configDePush!, m),
      })
    : null;

  /** 409 quando desligado, 500 quando mal configurado; false = pode seguir. */
  function pushIndisponivel(res: express.Response): boolean {
    if (falhaDoPush) {
      res.status(500).json({ error: falhaDoPush, configuracao: true });
      return true;
    }
    if (!configDePush || !vigia) {
      res.status(409).json({ error: "Push desligado: LEMBRETES_NTFY_URL vazia.", pushDesligado: true });
      return true;
    }
    return false;
  }

  // Ajuste APROVADO pelo usuário. Janela antes do token (config quebrada não
  // gasta chamada). Horário só muda de lugar com permitirMover.
  app.post("/api/quests/:eventId/ajustar", async (req, res) => {
    let pedido: ReturnType<typeof interpretarPedidoDeAjuste>;
    let janela: ReturnType<typeof lerJanela>;
    try {
      pedido = interpretarPedidoDeAjuste(await readRoster(), req.params.eventId, req.body);
      janela = lerJanela(process.env);
    } catch (error: any) {
      if (responderErroDeRoster(res, error) || responderErroDeQuest(res, error)) return;
      console.error("Erro ao ler o pedido de ajuste:", error);
      return res.status(500).json({ error: error.message });
    }
    try {
      await tokenValido();
    } catch (error) {
      return responderErroDeAuth(res, error);
    }
    try {
      res.json(await aplicarAjuste({ ...pedido, obterToken: tokenValido, janela, agora: new Date() }));
    } catch (error: any) {
      console.error("Erro no ajuste:", error);
      if (responderErroDeQuest(res, error)) return;
      res.status(500).json({ error: error.message });
    }
  });

  // Confere servidor ntfy + celular sem esperar evento nenhum.
  app.post("/api/push/teste", async (_req, res) => {
    if (pushIndisponivel(res)) return;
    try {
      const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" }).format(new Date());
      await enviarPush(configDePush!, {
        titulo: "SquadOne: teste de lembrete",
        corpo: `Push funcionando (${hora}).`,
        prioridade: 3,
        tags: ["white_check_mark"],
      });
      res.json({ enviado: true });
    } catch (error: any) {
      if (error instanceof ErroDePush) {
        return res.status(502).json({ error: error.message, pushFalhou: true, credencial: error.credencial });
      }
      console.error("Erro no push de teste:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Uma varredura REAL contra o Google com relógio simulado: mostra o que
  // sairia (enviar=false, padrão) ou manda de fato (enviar=true). Nunca grava
  // na deduplicação da vigia — o teste não engole o aviso de verdade.
  app.post("/api/push/varrer", async (req, res) => {
    if (pushIndisponivel(res)) return;
    const { agora, enviar = false } = req.body ?? {};
    let relogio = new Date();
    if (agora !== undefined) {
      const lido = lerInstante(agora, FUSO);
      if (!lido || lido.data !== null) {
        return res.status(400).json({ error: "Campo 'agora' deve ser data/hora ISO, ex.: 2026-09-15T13:50:00-03:00" });
      }
      relogio = new Date(lido.instante);
    }
    if (typeof enviar !== "boolean") {
      return res.status(400).json({ error: "Campo 'enviar' deve ser booleano" });
    }
    try {
      res.json(await vigia!.varrer(relogio, { enviar, registrar: false }));
    } catch (error: any) {
      if (error instanceof JanelaMalConfigurada || error instanceof ErroDeConfig) {
        return res.status(500).json({ error: error.message, configuracao: true });
      }
      console.error("Erro na varredura de teste:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // A janela e lida a cada turno; logar no boot mostra no painel do Easypanel
  // o que vale agora, ou o erro, sem esperar alguem delegar uma quest.
  try {
    console.log(`Janela de trabalho: ${descreverJanela(lerJanela(process.env))}`);
  } catch (error: any) {
    console.error(`Janela de trabalho inválida: ${error.message}`);
  }
  if (falhaDoPush) console.error(`Lembretes push inválidos (desligados): ${falhaDoPush}`);
  else if (configDePush) console.log(`Lembretes push: ${descreverPush(configDePush)}, ${ANTECEDENCIA_PUSH_MIN} min antes`);
  else console.log("Lembretes push desligados (LEMBRETES_NTFY_URL vazia)");

  if (falhaDoTelegram) console.error(`Bot do Telegram inválido (desligado): ${falhaDoTelegram}`);
  else if (configDeTelegram) console.log(`Bot do Telegram: ${descreverTelegram(configDeTelegram)}`);
  else console.log("Bot do Telegram desligado (TELEGRAM_BOT_TOKEN vazia)");

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    // Depois do listen: a primeira varredura não disputa o boot do Vite.
    vigia?.iniciar();

    // Só em produção: o APP_URL de dev é http://localhost (o Telegram exige
    // HTTPS) e registrar com o token real roubaria o webhook do servidor no ar.
    if (configDeTelegram && process.env.NODE_ENV === "production") {
      const base = process.env.APP_URL;
      if (!base) {
        console.error("Bot do Telegram: APP_URL vazia, webhook não registrado.");
      } else {
        const url = new URL(ROTA_WEBHOOK_TELEGRAM, base).href;
        registrarWebhook(configDeTelegram, url)
          .then(() => console.log(`Bot do Telegram: webhook registrado em ${url}`))
          .catch((error) => console.error(`Bot do Telegram: falha ao registrar o webhook: ${error.message}`));
      }
    }
  });
}

startServer();
