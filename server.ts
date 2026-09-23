import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import {
  ConflitoDeRoster,
  dominiosDoSquad,
  localizarSquad,
  paraVista,
  PedidoInvalido,
  readRoster,
  resolverSquad,
  SquadInexistente,
  type Squad,
} from "./server/squad.ts";
import { ModeloOcupado } from "./server/orchestrator.ts";
import { rodarDemanda } from "./server/turno.ts";
import { ErroCalendario, LeituraIncompleta, listarAgendaDoDia, listarQuests, listarQuestsDaJanela, MarcasPerdidas, QuestSumiu } from "./server/calendar.ts";
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
import { anexarProgressoDosPassos, renomearListaDaSquad } from "./server/passos-no-google.ts";
import {
  avisarDigitando,
  baixarArquivo,
  descreverTelegram,
  editarMensagem,
  enviarMensagem,
  lerConfigDeTelegram,
  registrarWebhook,
  responderBotao,
  ROTA_WEBHOOK_TELEGRAM,
  TelegramMalConfigurado,
  type ConfigDeTelegram,
} from "./server/telegram.ts";
import { criarBotDoTelegram } from "./server/telegram-bot.ts";
import { textoDaContratacao } from "./server/telegram-resposta.ts";
import { transcreverAudio } from "./server/transcricao.ts";
import {
  AvaliacaoInvalida,
  AvaliacoesDeTurnoStore,
  CacheDeTurnosParaAvaliacao,
  TurnoJaAvaliado,
  avaliacoesHabilitadas,
  interpretarPedidoDeAvaliacao,
  resumirResultadoDoTurno,
} from "./server/avaliacoes-turno.ts";
import {
  createOperationsRouter,
  HermesReadingsStore,
  listenHostForMode,
  OperationsProjectStore,
  readOperationsConfig,
  readSquadOneMode,
  todayWindow,
  type AgendaSummary,
} from "./server/operations.ts";
import { AutoProductionStore } from "./server/auto-production.ts";

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
  const squadOneMode = readSquadOneMode();
  const listenHost = listenHostForMode(squadOneMode);
  const avaliacoesAtivas = avaliacoesHabilitadas(process.env);
  const cacheDeTurnos = new CacheDeTurnosParaAvaliacao();
  const storeDeAvaliacoes = new AvaliacoesDeTurnoStore(path.join(process.cwd(), "data"));

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
      enviar: (chatId, texto, responderA, botoes) => enviarMensagem(c, chatId, texto, responderA, botoes),
      digitando: (chatId) => avisarDigitando(c, chatId),
      transcrever: async (fileId, mime) => transcreverAudio(ai, await baixarArquivo(c, fileId), mime),
      // Mesma função da rota /api/squad/hire: aplica na squad da proposta e
      // revalida tudo contra o roster atual. Sem nome: o servidor escolhe.
      contratar: async (proposta) => textoDaContratacao(await aplicarContratacao(proposta)),
      responderBotao: (callbackId, texto) => responderBotao(c, callbackId, texto),
      editar: (chatId, mensagemId, texto) => editarMensagem(c, chatId, mensagemId, texto),
      // O container roda em UTC: sem o fuso o horário da resposta sairia 3h adiantado.
      fmt: { locale: "pt-BR", timeZone: FUSO },
      agora: () => new Date(),
    });
    app.post(ROTA_WEBHOOK_TELEGRAM, bot.portao, express.json({ limit: "256kb" }), bot.processar);
  }

  // Antes de tudo — inclusive dos estaticos: um 403 aqui custa nada e nao
  // deixa nem o index.html vazar para quem nao e o dono.
  app.use(porteiroDeIp());

  app.use(express.json());

  // Disponível nos dois perfis sem expor configuração local. O frontend usa
  // apenas este discriminador para decidir entre o app e a Central.
  app.get("/api/runtime", (_req, res) => {
    res.json({ mode: squadOneMode, avaliacoes: avaliacoesAtivas });
  });

  if (squadOneMode === "operations") {
    const configPath = process.env.SQUADONE_OPERATIONS_CONFIG;
    if (!configPath) {
      throw new Error("SQUADONE_OPERATIONS_CONFIG é obrigatório no perfil operations.");
    }
    const operationsConfig = await readOperationsConfig(configPath);
    const operationsDataDir = process.env.SQUADONE_OPERATIONS_DATA_DIR ?? path.join(process.cwd(), "data", "operations");
    const operationsStore = new OperationsProjectStore(operationsDataDir);
    const readings = new HermesReadingsStore(operationsDataDir);
    const autoProduction = operationsConfig.autoDirectory
      ? new AutoProductionStore(operationsConfig.autoDirectory, operationsDataDir, {
          notificationStateFile: operationsConfig.autoNotificationStateFile,
          hermesHealthUrl: operationsConfig.tools.hermes.healthUrl,
        })
      : undefined;
    const readAgenda = async (): Promise<AgendaSummary> => {
      if (!(await estaConectado())) return { state: "disconnected", events: [] };
      try {
        const { start, end } = todayWindow(new Date(), FUSO);
        const events = await listarAgendaDoDia(await tokenValido(), start, end);
        return {
          state: "connected",
          events: events.map((event) => ({
            id: event.id,
            title: event.titulo,
            start: event.inicio,
            end: event.fim,
            allDay: event.diaInteiro,
            ...(event.htmlLink ? { htmlLink: event.htmlLink } : {}),
            ...(event.local ? { location: event.local } : {}),
          })),
        };
      } catch (error) {
        if (error instanceof PrecisaConectar) return { state: "disconnected", events: [] };
        throw error;
      }
    };
    app.use("/api/operations", createOperationsRouter({
      config: operationsConfig,
      store: operationsStore,
      readings,
      autoProduction,
      readAgenda,
      dataDir: operationsDataDir,
    }));
  } else {
    // Impede o fallback SPA de responder HTML 200 para uma rota operacional
    // inexistente no EasyPanel. O perfil remoto falha fechado e explicitamente.
    app.use("/api/operations", (_req, res) => {
      res.status(404).json({ error: "Central de Operações indisponível neste perfil." });
    });
  }

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
    // O app público e a Central retornam à própria superfície raiz. No perfil
    // operations, a conexão é iniciada pela Central; mandar para /squadone
    // acrescentaria uma etapa local sem propósito depois do consentimento.
    const appPath = "/";
    if (recusa) return res.redirect(`${appPath}?auth=${encodeURIComponent(String(recusa))}`);
    if (typeof code !== "string" || typeof state !== "string") {
      return res.redirect(`${appPath}?auth=callback_incompleto`);
    }
    try {
      await trocarCodigo(code, state);
      res.redirect(`${appPath}?auth=ok`);
    } catch (error: any) {
      // Calendar desmarcado no consentimento granular: nada foi gravado e a
      // credencial anterior continua. Código fixo para a UI dizer isso com
      // clareza, em vez de repetir a mensagem crua na URL.
      if (error instanceof EscopoNegado) return res.redirect(`${appPath}?auth=escopo_calendar_negado`);
      console.error("Erro no callback do Google:", error);
      res.redirect(`${appPath}?auth=${encodeURIComponent(error.message)}`);
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
  app.patch(
    "/api/squad/squads/:id",
    rotaDoRoster(async (req) => {
      const id = String(req.params.id);
      const antes = localizarSquad(await readRoster(), id);
      const vista = await editarSquad(id, req.body);
      const depois = localizarSquad(await readRoster(), id);
      // Renomear a lista do Tasks junto, sem segurar a resposta nem falhar a
      // edição: o nome já está gravado, e a lista é acessório no celular.
      if (antes && depois && antes.nome !== depois.nome && depois.tasksListaId) {
        void (async () => {
          const { tasks } = await escoposConcedidos();
          const r = await renomearListaDaSquad({
            listaId: depois.tasksListaId,
            nomeAntigo: antes.nome,
            nomeNovo: depois.nome,
            liberado: tasks,
            obterToken: tokenValido,
          });
          if (r !== "renomeada") console.log(`[tasks] lista da squad '${id}' não renomeada: ${r}`);
        })().catch((err) => console.warn(`[tasks] falha ao renomear a lista da squad '${id}':`, err?.message ?? err));
      }
      return vista;
    }),
  );
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

      // Selo de passos: leitura do Tasks que nunca derruba a Mochila (não lança).
      const { tasks: tasksLiberado } = await escoposConcedidos().catch(() => ({ tasks: false }));
      await anexarProgressoDosPassos(quests, { liberado: tasksLiberado, obterToken: tokenValido });
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

      const resultado = await rodarDemanda(ai, { demanda: demanda.trim(), modo, squadId });
      // A avaliação observa um turno já terminado; nunca participa da execução,
      // da agenda ou do resultado principal. Falha posterior não pode induzir
      // retry de uma delegação que talvez já tenha criado eventos no Google.
      if (!avaliacoesAtivas) return res.json(resultado);
      const turnoId = cacheDeTurnos.registrar(resumirResultadoDoTurno(modo, resultado, new Date().toISOString()));
      res.json({ ...resultado, turno_id: turnoId });
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

  // Só aceita sinal do usuário para um resultado que este processo acabou de
  // produzir. Não recebe demanda, prompt, roster, eventos ou argumentos.
  app.post("/api/turnos/:turnoId/avaliacao", async (req, res) => {
    if (!avaliacoesAtivas) {
      return res.status(409).json({ error: "Avaliações de turno estão desligadas.", avaliacaoDesligada: true });
    }
    const turnoId = String(req.params.turnoId);
    const evidencia = cacheDeTurnos.obter(turnoId);
    if (!evidencia) {
      return res.status(410).json({ error: "Turno expirado ou indisponível para avaliação.", turnoExpirado: true });
    }
    try {
      const avaliacao = interpretarPedidoDeAvaliacao(req.body);
      const registro = await storeDeAvaliacoes.registrar({ turnoId, avaliacao, evidencia });
      cacheDeTurnos.remover(turnoId);
      res.status(201).json({
        avaliacao: {
          id: registro.id,
          turno_id: registro.turnoId,
          criada_em: registro.criadaEm,
          nota: registro.avaliacao.nota,
          motivos: registro.avaliacao.motivos,
          ...(registro.avaliacao.comentario ? { comentario: registro.avaliacao.comentario } : {}),
        },
      });
    } catch (error: any) {
      if (error instanceof AvaliacaoInvalida) return res.status(400).json({ error: error.message });
      if (error instanceof TurnoJaAvaliado) return res.status(409).json({ error: error.message, turnoJaAvaliado: true });
      console.error("Erro ao salvar avaliação de turno:", error);
      // O turno já foi entregue. O cache fica para o usuário tentar salvar o
      // feedback sem repetir a delegação nem chamar provedores externos.
      res.status(500).json({ error: "Não foi possível salvar a avaliação local." });
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

  app.listen(PORT, listenHost, () => {
    console.log(`SquadOne (${squadOneMode}) em http://${listenHost}:${PORT}`);
    // Depois do listen: a primeira varredura não disputa o boot do Vite.
    vigia?.iniciar();

    // Só em produção: o APP_URL de dev é http://localhost (o Telegram exige
    // HTTPS) e registrar com o token real roubaria o webhook do servidor no ar.
    if (configDeTelegram && process.env.NODE_ENV === "production") {
      const base = process.env.APP_URL;
      if (!base) {
        console.error("Bot do Telegram: APP_URL vazia, webhook não registrado.");
      } else {
        // `new URL` lança se APP_URL vier sem esquema (ex.: "meu-app.host"). Isto
        // roda dentro do callback de 'listening', fora de qualquer promise: uma
        // excecao aqui sairia sem handler e derrubaria o processo — e falha do
        // Telegram nunca pode derrubar o app.
        let url: string;
        try {
          url = new URL(ROTA_WEBHOOK_TELEGRAM, base).href;
        } catch {
          console.error("Bot do Telegram: APP_URL inválida, webhook não registrado.");
          return;
        }
        registrarWebhook(configDeTelegram, url)
          .then(() => console.log(`Bot do Telegram: webhook registrado em ${url}`))
          .catch((error) => console.error(`Bot do Telegram: falha ao registrar o webhook: ${error.message}`));
      }
    }
  });
}

startServer();
