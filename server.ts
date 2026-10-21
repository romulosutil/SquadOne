import express from "express";
import path from "path";
import fsp from "fs/promises";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import os from "node:os";
import {
  ConflitoDeRoster,
  dominiosDoSquad,
  localizarSquad,
  paraVista,
  PedidoInvalido,
  readRoster,
  resolverSquad,
  RosterAusente,
  RosterCongelado,
  rosterCongelado,
  SquadInexistente,
  type Squad,
} from "./server/squad.ts";
import { ModeloOcupado } from "./server/orchestrator.ts";
import { haTurnoEmAndamento, rodarDemanda } from "./server/turno.ts";
import { prepararSombra } from "./server/luna-sombra.ts";
import { prepararJevSombra } from "./server/jev-sombra.ts";
import { prepararLeadQuenteSombra, type LeadQuenteSombra } from "./server/lead-quente-sombra.ts";
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
import { guardaDeIdentidade, guardaDeOrigem, lerLoginsPermitidos, porteiroDeIp, veioPeloServe } from "./server/acesso.ts";
import { criarRepasseDaEntrada, ENTRADA_PREFIXO } from "./server/entrada-proxy.ts";
import { descreverJanela, FUSO, JanelaMalConfigurada, lerInstante, lerJanela, SemHorarioLivre } from "./server/alocador.ts";
import { avisosPessoaisPeloTelegram, criarRegistroDeEnviados, publicarAviso, publicarAvisoPessoal, type Aviso } from "./server/avisos.ts";
import { diretorioDeDados, motivoParaAgendaDesligada } from "./server/dados.ts";
import { arquivoDeOffset, criarPollingDoTelegram } from "./server/telegram-polling.ts";
import { criarSinalDeVida, lerUrlDoSinal, pingarHealthchecks } from "./server/sinal-de-vida.ts";
import { lerStatusDoDell } from "./server/dell-status.ts";
import { ANTECEDENCIA_LEMBRETE_MIN } from "./server/lembretes.ts";
import { criarVigia, type Vigia } from "./server/vigia.ts";
import { resumoMatinalLigado } from "./server/resumo-matinal.ts";
import { criarVendedor, type Vendedor } from "./server/vendedor.ts";
import { lerPrimeirosDoTime } from "./server/frente-comercial.ts";
import { lerPausaAutomatica } from "./server/protecao-prospeccao.ts";
import { criarMemoriaDaVenda } from "./server/venda-do-dia.ts";
import { lerConversaDoNumero } from "./server/conversa-do-lead.ts";
import { descreverHistorico } from "./server/roster-historico.ts";
import { criarLeitorDoTime } from "./server/time.ts";
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
  buscarAtualizacoes,
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
import { contarEscritasDaApi, criarContadorDeUso } from "./server/uso.ts";
import { CrmStore, configDoCrm } from "./server/crm.ts";
import { iniciarCopilotoAutomatico, lerRaioXDoDisco, prepararCopiloto } from "./server/copiloto.ts";
import { criarLeitorDeSinais, type LeitorDeSinais } from "./server/sinais-do-site-leitor.ts";
import { prepararAssistente, type Assistente } from "./server/assistente.ts";
import { prepararConsultaAoHermes } from "./server/hermes-consulta.ts";
import { criarRotasDeFinancas, explicacaoIaLigada, iniciarLeituraDiaria, prepararFinancas, type EstadoDasFinancas } from "./server/financas/rotas.ts";
import { FinancasIndisponiveis } from "./server/financas/banco.ts";
import { anotarGasto, depoisDeEscrever } from "./server/financas/servico.ts";

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
  } else if (err instanceof RosterCongelado) {
    res.status(409).json({ error: err.message, rosterCongelado: true });
  } else if (err instanceof RosterAusente) {
    // Dell antes da cópia do roster de produção: ambiente, nenhum clique conserta.
    res.status(503).json({ error: err.message, rosterAusente: true });
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
  const dataDir = diretorioDeDados();
  const storeDeAvaliacoes = new AvaliacoesDeTurnoStore(dataDir);

  // A agenda (roster, turno, Mochila, ajuste, vigia, bot) no perfil operations
  // só com o diretório de dados próprio, fora do clone (regra 7): sem ele o
  // processo do Dell seria montado sobre o retrato de 14/09/2026. No perfil app
  // ela está sempre ligada, como sempre esteve.
  const motivoDaAgendaDesligada = squadOneMode === "operations" ? motivoParaAgendaDesligada() : null;
  const agendaAtiva = motivoDaAgendaDesligada === null;

  // Luna em sombra (ARCHITECTURE "Luna em modo sombra"): mede, não decide. Só
  // com SQUADONE_LUNA_SOMBRA=true, no operations com a agenda, e com o `codex`
  // do Dell conferido no boot; qualquer falta vira log e null — o turno roda
  // igual, com ou sem ela.
  const sombra = await prepararSombra(process.env, { dataDir, operations: squadOneMode === "operations", agendaAtiva });
  // Jev em sombra (RULES 27): mede o roteamento da demanda, nunca decide. Só
  // com SQUADONE_JEV_SOMBRA=true e a chave no jev.env, no operations com a
  // agenda; config ilegível vira log e null, e o turno roda igual.
  const jev = await prepararJevSombra(process.env, { dataDir, operations: squadOneMode === "operations", agendaAtiva });

  // O Traefik do Easypanel e o unico caminho ate aqui: sem isto o Express
  // reporta o IP do proxy em req.ip e o porteiro julgaria sempre o mesmo IP.
  app.set("trust proxy", true);

  // --- Bot do Telegram ------------------------------------------------
  // Webhook (Easypanel): a rota fica ANTES do porteiro de IP, e só ela — o
  // Telegram não tem IP fixo; a trava é o segredo + a allowlist de chat_id.
  // Polling (Dell): sem rota nenhuma; o laço começa depois do listen.
  let configDeTelegram: ConfigDeTelegram | null = null;
  let falhaDoTelegram: string | null = null;
  try {
    // No Dell não há URL pública (Funnel é proibido): webhook lá nunca receberia
    // nada, e o setWebhook do boot roubaria a entrada do polling. Antes de ler o
    // resto, para o erro dizer isso e não "falta o segredo do webhook".
    const comToken = Boolean((process.env.TELEGRAM_BOT_TOKEN ?? "").trim());
    if (comToken && squadOneMode === "operations" && (process.env.TELEGRAM_TRANSPORTE ?? "").trim() !== "polling") {
      throw new TelegramMalConfigurado("No perfil operations o bot é TELEGRAM_TRANSPORTE=polling.");
    }
    configDeTelegram = lerConfigDeTelegram(process.env);
    if (configDeTelegram && !agendaAtiva) {
      throw new TelegramMalConfigurado(`agenda desligada neste processo: ${motivoDaAgendaDesligada}`);
    }
  } catch (error: any) {
    configDeTelegram = null;
    falhaDoTelegram = error instanceof TelegramMalConfigurado ? error.message : String(error?.message ?? error);
  }
  // As finanças abrem mais abaixo, com a Central; o bot (criado antes) as acha
  // por aqui quando chega um "gastei 30 no mercado".
  let financasDoProcesso: EstadoDasFinancas | null = null;
  let vendedorDoProcesso: Vendedor | null = null;
  // O agente do lead quente em sombra (server/lead-quente-sombra.ts): nasce com a Central; o voto o acha por aqui.
  let leadQuenteDoProcesso: LeadQuenteSombra | null = null;
  // Quem para cada laço do boot (vigia, sinal de vida, polling, leitura diária, copiloto automático):
  // o SIGTERM do systemd/Easypanel os chama antes de fechar o servidor, em vez de deixar timer pendurado.
  // O vendedor e a sombra do lead quente ainda não devolvem função de parar (iniciar(): void).
  const paradores: Array<() => void> = [];
  // Fila de avisos do Dell (regra 20): o P0 e a reserva dos avisos pessoais.
  const filaDeAvisos = (process.env.SQUADONE_AVISOS_FILA ?? "").trim() || path.join(os.homedir(), ".local", "share", "avisos", "fila");
  // O bot ao chat do dono: espelho do P0 e, desde 16/10/2026 (OT-14, exceção da regra 20), o canal
  // dos lembretes da agenda e dos alertas de finanças, para tirá-los do número que fala com os leads.
  // Sucesso se AO MENOS UM chat recebeu: lançar com um chat entregue mandaria o aviso de novo pela fila.
  const telegramDoDono = configDeTelegram
    ? async (texto: string, opcoes?: { silencioso?: boolean }) => {
        const chats = [...configDeTelegram!.chatsPermitidos];
        if (chats.length === 0) throw new Error("nenhum chat na allowlist do Telegram");
        const resultados = await Promise.allSettled(chats.map((chat) => enviarMensagem(configDeTelegram!, chat, texto, undefined, undefined, opcoes)));
        const falhas = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        if (falhas.length === chats.length) throw falhas[0].reason;
        if (falhas.length > 0) console.error(`[avisos] Telegram: ${falhas.length} de ${chats.length} chat(s) não receberam o aviso`);
      }
    : undefined;
  const pessoalPeloTelegram = avisosPessoaisPeloTelegram(process.env);
  // Chaves já enviadas pelo caminho pessoal, em disco: a Central reinicia a cada merge e a vigia varre no
  // boot, então a memória sozinha repetia o lembrete da janela de 10 min e o "Google desconectado".
  const enviadosPessoais = criarRegistroDeEnviados(
    path.join(process.env.SQUADONE_OPERATIONS_DATA_DIR ?? path.join(process.cwd(), "data", "operations"), "avisos-enviados.json"),
  );
  const publicarPessoal = (aviso: Aviso) =>
    pessoalPeloTelegram
      ? publicarAvisoPessoal(aviso, { fila: filaDeAvisos, telegram: telegramDoDono, enviados: enviadosPessoais })
      : publicarAviso(aviso, { fila: filaDeAvisos, telegram: telegramDoDono });
  let botDoTelegram: ReturnType<typeof criarBotDoTelegram> | null = null;
  // O Assistente da Central (RULES 28): preparado no bloco da Central, lido pelo /api/runtime.
  let assistenteDoProcesso: Assistente | null = null;
  if (configDeTelegram) {
    const c = configDeTelegram;
    const bot = (botDoTelegram = criarBotDoTelegram({
      segredo: c.transporte === "webhook" ? c.segredo : null,
      chatsPermitidos: c.chatsPermitidos,
      // O bot não tem aba: sem prefixo, squadId ausente = primeira squad ativa +
      // redirecionamento automático; com `/p`, a squad do prefixo (telegram-entrada).
      rodar: (demanda, modo, squadId) => rodarDemanda(ai, { demanda, modo, squadId }, { luna: sombra, jev }),
      enviar: async (chatId, texto, responderA, botoes) => { await enviarMensagem(c, chatId, texto, responderA, botoes); },
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
      // Finanças só no Dell. No Easypanel a frase recebe "não estão neste
      // servidor" e não vira turno: nada de finanças vai ao modelo.
      anotarGasto:
        squadOneMode === "operations"
          ? async (gasto, origem, quando) => {
              const banco = financasDoProcesso?.banco;
              if (!banco) throw new FinancasIndisponiveis(financasDoProcesso?.problema ?? "finanças ainda não abriram");
              const r = anotarGasto(banco, gasto, origem, quando);
              if (r.novo) depoisDeEscrever(banco, financasDoProcesso!.avisador);
              return r.categoria;
            }
          : undefined,
      // O vendedor (server/vendedor.ts) nasce com a Central, mais abaixo; o toque o acha por aqui.
      tocarVenda:
        squadOneMode === "operations"
          ? async (token, acao) => (vendedorDoProcesso ? vendedorDoProcesso.tocar(token, acao) : { curto: "O vendedor está desligado." })
          : undefined,
      votarLeadQuente:
        squadOneMode === "operations"
          ? async (token, concorda) => (leadQuenteDoProcesso ? leadQuenteDoProcesso.votar(token, concorda) : { curto: "A sombra do lead quente está desligada." })
          : undefined,
    }));
    if (c.transporte === "webhook") {
      app.post(ROTA_WEBHOOK_TELEGRAM, bot.portao, express.json({ limit: "256kb" }), bot.processar);
    }
  }

  // A configuração da Central vem antes das travas: config ilegível derruba o
  // boot antes de qualquer rota responder.
  let operationsConfig: Awaited<ReturnType<typeof readOperationsConfig>> | null = null;
  if (squadOneMode === "operations") {
    const configPath = process.env.SQUADONE_OPERATIONS_CONFIG;
    if (!configPath) {
      throw new Error("SQUADONE_OPERATIONS_CONFIG é obrigatório no perfil operations.");
    }
    operationsConfig = await readOperationsConfig(configPath);
  }

  // Antes de tudo — inclusive dos estaticos: um 403 aqui custa nada e nao
  // deixa nem o index.html vazar para quem nao e o dono.
  app.use(porteiroDeIp());

  // Segunda trava da regra 7 no Dell: o login do Tailscale que o Serve põe em
  // cada pedido, contra SQUADONE_LOGINS_TAILSCALE. Ligada sempre que a agenda
  // está aqui (lista vazia então FECHA a tailnet) ou que a lista existe. Sem a
  // agenda e sem lista, a Central segue como antes: só lê o Dell, e travar já
  // derrubaria o celular no merge, antes do runbook. As finanças fecham
  // sozinhas nesse caso (ver criarRotasDeFinancas).
  const loginsDoTailscale = lerLoginsPermitidos();
  const identidadeLigada = squadOneMode === "operations" && (agendaAtiva || loginsDoTailscale.size > 0);
  if (identidadeLigada) {
    app.use(guardaDeIdentidade(loginsDoTailscale));
  }

  const operationsDataDir = process.env.SQUADONE_OPERATIONS_DATA_DIR ?? path.join(process.cwd(), "data", "operations");
  // Contador de uso da Central (AC-28): só no Dell. Falhar ao preparar a pasta não derruba o boot.
  const usoDaCentral = squadOneMode === "operations" ? criarContadorDeUso({ dir: path.join(operationsDataDir, "uso") }) : undefined;
  await usoDaCentral?.iniciar().catch((error) => console.error("[uso] pasta indisponível:", error instanceof Error ? error.message : error));

  // A página da Entrada (menu "Entrada"): só no perfil operations, destino fixo no loopback, e ANTES do
  // express.json(): o corpo de um envio é um arquivo de até 200 MB e passa em fluxo, sem ser lido aqui.
  if (squadOneMode === "operations") {
    app.use(ENTRADA_PREFIXO, criarRepasseDaEntrada());
    // Escrita só da mesma origem (regra 7): o header de identidade acompanha
    // também um POST forjado por outra página aberta no celular.
    app.use("/api", guardaDeOrigem());
    // Depois da guarda: escrita recusada por origem não é uso. Conta só método + modelo da rota.
    if (usoDaCentral) app.use("/api", contarEscritasDaApi(usoDaCentral));
  }

  app.use("/api/operations/crm/conversa/importar", express.json({ limit: "1mb" }));
  app.use(express.json());

  // Disponível nos dois perfis sem expor configuração local. O frontend usa
  // apenas este discriminador para decidir entre o app e a Central. `ocupado`
  // é para o atualizar-central do Dell esperar o turno (ou a fila do bot)
  // terminar antes de reiniciar o processo. `agenda` diz se o app (Pedir,
  // Escritório) mora neste processo: no Dell, só depois do cutover.
  app.get("/api/runtime", (_req, res) => {
    // A vigia no meio de uma volta também conta: reiniciar agora largaria um lembrete a meio caminho.
    const ocupado = haTurnoEmAndamento() || (botDoTelegram?.ocupado() ?? false) || (assistenteDoProcesso?.ocupado() ?? false) || (vigia?.ocupada() ?? false);
    // `assistente`: o painel do Assistente substitui o Pedir só quando ele está ligado aqui.
    res.json({ mode: squadOneMode, avaliacoes: avaliacoesAtivas, ocupado, agenda: agendaAtiva, assistente: assistenteDoProcesso !== null });
  });

  if (operationsConfig) {
    const operationsStore = new OperationsProjectStore(operationsDataDir);
    const readings = new HermesReadingsStore(operationsDataDir);
    // CRM: lê o retrato do n8n (crm.json) e as pastas de ~/auto-site; registra pelo n8n.
    const crm = new CrmStore(configDoCrm(operationsConfig.crm, operationsConfig.autoDirectory));
    // Sinais do site de um lead (17/10/2026): lidos sob demanda pela Ficha (POST /crm/sinais), com cache
    // em disco; a visão do CRM só usa o que já foi lido. SQUADONE_SINAIS_DO_SITE=false desliga.
    let sinaisDoSite: LeitorDeSinais | undefined;
    if ((process.env.SQUADONE_SINAIS_DO_SITE ?? "").trim() !== "false") {
      sinaisDoSite = criarLeitorDeSinais({ dir: path.join(operationsDataDir, "sinais-do-site") });
      await sinaisDoSite.iniciar();
      const leitor = sinaisDoSite;
      crm.sinaisDoSite = () => leitor.doCache();
    }
    // Copiloto do PRUMO (fase 1, em sombra): sugere a próxima mensagem e a proposta na Ficha,
    // nunca envia. Só com SQUADONE_COPILOTO=true; provedor ilegível ou ausente vira log e null.
    const copiloto = await prepararCopiloto(process.env, {
      dataDir: operationsDataDir,
      operations: true,
      ai,
      // A conversa mora pela chave do NÚMERO (até 16/10/2026 ia pela chave da planilha e nunca achava).
      fontes: { visao: () => crm.visao(), raioX: (lead) => lerRaioXDoDisco(lead, crm.config), conversa: (lead) => lerConversaDoNumero(lead.links.whatsapp, crm.config.conversas) },
    });
    // O copiloto sozinho (16/10/2026): quando um lead escreve, a sugestão fica pronta sem ninguém pedir.
    if (copiloto && (process.env.SQUADONE_COPILOTO_AUTOMATICO ?? "").trim() !== "false") {
      paradores.push(iniciarCopilotoAutomatico(copiloto, () => crm.visao()));
      console.log("[copiloto] automático ligado: lê a conversa e sugere quando a vez é sua (SQUADONE_COPILOTO_AUTOMATICO=false desliga).");
    }
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
    // O Assistente da Central (RULES 28): lê o que as telas já mostram e propõe cartões; nunca
    // escreve. Só com SQUADONE_ASSISTENTE=true; a consulta ao Hermes (SQUADONE_ASSISTENTE_HERMES,
    // exceção da regra 20) entra por `criarHermes`, só chamado com as duas flags. O teto do Hermes é
    // lido uma vez, pelo Assistente (SQUADONE_ASSISTENTE_HERMES_TETO_DIA), e contado uma vez, no
    // arquivo do dia de server/hermes-consulta.ts: o Assistente não conta consulta nenhuma.
    assistenteDoProcesso = await prepararAssistente(process.env, {
      dataDir: operationsDataDir,
      operations: squadOneMode === "operations",
      ai,
      criarHermes: ({ tetoDia }) => prepararConsultaAoHermes(process.env, operationsDataDir, { tetoDia }),
      fontes: {
        visao: () => crm.visao(),
        roster: readRoster,
        conversa: (lead) => lerConversaDoNumero(lead.links.whatsapp, crm.config.conversas),
        agenda: readAgenda,
        dell: () => lerStatusDoDell(operationsDataDir),
        // Fase 2 (17/10/2026): a sugestão guardada do copiloto, só LIDA (copiloto.ler nunca chama o
        // modelo). Sem copiloto ligado, a leitura nem é declarada ao Gemini.
        ...(copiloto ? { sugestao: (lead) => copiloto.ler(lead.produto, lead.id) } : {}),
      },
    });
    // Uma instância só para a rota e o vendedor: as escritas no arquivo do dia ficam em fila.
    const memoriaDaVenda = criarMemoriaDaVenda(path.join(operationsDataDir, "venda-do-dia.json"));
    app.use("/api/operations", createOperationsRouter({
      config: operationsConfig,
      store: operationsStore,
      readings,
      crm,
      copiloto,
      readAgenda,
      dataDir: operationsDataDir,
      memoriaDaVenda,
      vigiarProspeccao: true,
      uso: usoDaCentral,
      assistente: assistenteDoProcesso,
      ...(sinaisDoSite ? { sinaisDoSite } : {}),
    }));

    // O vendedor (16/10/2026): "Envie para X" no Telegram, seg–sex 08:00–17:30, um por vez, com a
    // mensagem pronta. Só com SQUADONE_VENDEDOR=true e o bot ligado; nunca envia nada ao lead.
    if ((process.env.SQUADONE_VENDEDOR ?? "").trim() === "true") {
      if (!configDeTelegram) {
        console.error("[vendedor] SQUADONE_VENDEDOR=true sem o bot do Telegram: desligado.");
      } else {
        const c = configDeTelegram;
        const cop = copiloto;
        vendedorDoProcesso = criarVendedor({
          lerVisao: () => crm.visao(),
          // A mensagem do copiloto (que leu a conversa) entra no aviso no lugar do texto pronto.
          ...(cop ? {
            copiloto: {
              prontas: async (v) => new Map([...(await cop.prontas(v.leads))].map(([id, s]) =>
                [id, { mensagem: s.sugestao.mensagem, porque: s.sugestao.porque, quando: s.quando,
                  ...(s.sugestao.momento ? { momento: s.sugestao.momento } : {}) }] as const)),
              pedir: async (leadId, v) => {
                const lead = v.leads.find((l) => l.id === leadId);
                if (!lead) return false;
                const r = await cop.automatica(lead);
                return r.estado === "gerando" || r.estado === "na-fila";
              },
            },
          } : {}),
          // Guarda onde cada aviso caiu: resolvido na Central ou expirado, a volta tira os botões (AC-06).
          enviar: async (texto, botoes) => {
            const mensagens: Array<{ chatId: number; mensagemId: number }> = [];
            for (const chat of c.chatsPermitidos) {
              const id = await enviarMensagem(c, chat, texto, undefined, botoes);
              if (id !== null) mensagens.push({ chatId: chat, mensagemId: id });
            }
            return mensagens;
          },
          editar: (chatId, mensagemId, texto) => editarMensagem(c, chatId, mensagemId, texto),
          registrar: async (corpo) => { await crm.registrar(corpo); },
          arquivoDeEstado: path.join(operationsDataDir, "vendedor.json"),
          // O time comercial faz o primeiro contato dos leads da fila dele: o aviso não os oferece.
          primeirosDoTime: () => lerPrimeirosDoTime(operationsDataDir),
          pausaPrimeiros: async () => Boolean(await lerPausaAutomatica(operationsDataDir)),
          arquivoDeHistorico: path.join(operationsDataDir, "vendedor-historico.jsonl"),
          vendaDoDia: memoriaDaVenda,
          origemCentral: (process.env.SQUADONE_ORIGEM_CENTRAL ?? "").trim() || undefined,
          agora: () => Date.now(),
        });
        console.log("[vendedor] ligado: um aviso por vez no Telegram, seg–sex 08:00–17:30; nunca envia ao lead.");
      }
    }

    // O agente que mantém o lead quente, EM SOMBRA (17/10/2026): decide responder/escalar/calar para cada
    // mensagem nova de lead e só avisa o Rômulo ("eu teria respondido…"). Só com SQUADONE_LEAD_QUENTE_SOMBRA=true,
    // o bot e o copiloto ligados; o único envio é o aviso ao chat dele, nunca ao lead.
    const cop = copiloto;
    const botDoDono = configDeTelegram;
    leadQuenteDoProcesso = prepararLeadQuenteSombra(
      process.env,
      { dataDir: operationsDataDir, operations: true, telegramLigado: botDoDono !== null, copilotoLigado: cop !== null },
      {
        lerVisao: () => crm.visao(),
        lerConversa: (lead) => lerConversaDoNumero(lead.links.whatsapp, crm.config.conversas),
        // Só LÊ a sugestão guardada (prontas nunca chama o modelo): quem gera é o copiloto automático.
        sugestoes: async (leads) => new Map([...(cop ? await cop.prontas(leads) : new Map())].map(([id, s]) =>
          [id, {
            mensagem: s.sugestao.mensagem,
            avisos: s.avisos,
            itensDeProposta: s.sugestao.proposta.itens.length,
            ...(s.sugestao.momento ? { momento: { quem: s.sugestao.momento.quem } } : {}),
          }] as const)),
        avisar: async (texto, botoes, opcoes) => {
          if (!botDoDono) return;
          for (const chat of botDoDono.chatsPermitidos) await enviarMensagem(botDoDono, chat, texto, undefined, botoes, opcoes);
        },
      },
    );

    // Finanças (06/10/2026): banco próprio no diretório de dados, Pluggy por
    // polling diário. Falha ao abrir não derruba a Central: as rotas dizem 503.
    // Os alertas de 70/90/100% (só % e semáforo, RULES 24) são aviso pessoal:
    // vão pelo Telegram, com a fila do WhatsApp de reserva (OT-14, 16/10/2026).
    const financas = await prepararFinancas(operationsDataDir, process.env, {
      publicar: publicarPessoal,
    });
    financasDoProcesso = financas;
    // "Explicar este mês" só com SQUADONE_FINANCAS_IA=true (RULES 24): o
    // cliente do Gemini vai junto, mas sem a flag as rotas nem montam.
    app.use("/api/financas", criarRotasDeFinancas(financas, { logins: loginsDoTailscale, ai }));
    if (explicacaoIaLigada()) console.log("[financas] explicação com IA ligada (só a pedido, com prévia).");
    const pararLeituraDiaria = iniciarLeituraDiaria(financas);
    if (pararLeituraDiaria) paradores.push(pararLeituraDiaria);
  } else {
    // O copiloto nunca roda no Easypanel: com a env ligada, só o log diz que foi ignorada.
    await prepararCopiloto(process.env, { dataDir, operations: false });
    // O Assistente também (RULES 28): o Easypanel não lê o CRM nem o Dell.
    await prepararAssistente(process.env, { dataDir, operations: false, fontes: {} });
    // Impede o fallback SPA de responder HTML 200 para uma rota operacional
    // inexistente no EasyPanel. O perfil remoto falha fechado e explicitamente.
    app.use("/api/operations", (_req, res) => {
      res.status(404).json({ error: "Central de Operações indisponível neste perfil." });
    });
  }

  // Rotas do app (roster, Mochila, turno, ajuste, avisos): no perfil app sempre;
  // no operations só com a agenda ligada (`agendaAtiva`), isto é, com o
  // diretório de dados próprio que recebe o roster de PRODUÇÃO. Antes disso o
  // Dell só tem o retrato de 14/09/2026, e um POST escreveria agentes e eventos
  // a partir dele. A Central sozinha só precisa conectar o Google (abaixo).
  const rotasDoApp = express.Router();

  // --- Conexao com o Google -------------------------------------------
  // O token nunca passa pelo browser: o servidor troca o code, guarda o
  // refresh cifrado no volume e renova sozinho. O frontend so pergunta se
  // esta conectado e manda o usuario para o consentimento. Consentimento e
  // callback valem nos dois perfis: é por eles que a agenda da Central conecta.

  rotasDoApp.get("/api/auth/status", async (_req, res) => {
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

  app.get("/api/auth/google", (req, res) => {
    // Credencial do Dell: o consentimento volta pelo loopback, aberto do PC pelo
    // túnel (Mel-Tuneis). Pela tailnet o redirect iria para 127.0.0.1 do
    // celular; nada de redirect em ts.net (não está no cliente OAuth).
    if (squadOneMode === "operations" && veioPeloServe(req)) {
      return res
        .status(409)
        .type("text/plain")
        .send("Conectar o Google é pelo PC, com o túnel Mel-Tuneis ligado: abra http://127.0.0.1:9120/api/auth/google no navegador do PC.");
    }
    try {
      res.redirect(urlDeConsentimento());
    } catch (error: any) {
      console.error("Erro ao montar o consentimento:", error);
      res.status(500).send(error.message);
    }
  });

  app.get("/api/auth/callback", async (req, res) => {
    if (squadOneMode === "operations" && veioPeloServe(req)) {
      return res.status(409).type("text/plain").send("O callback do Google volta só pelo loopback do Dell.");
    }
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

  rotasDoApp.post("/api/auth/logout", async (_req, res) => {
    await desconectar();
    res.json({ conectado: false });
  });

  // Roster inteiro, todas as squads: o seletor precisa da lista, o arquivo tem
  // poucos KB e a squad ativa e conveniencia da aba, nao estado do servidor.
  rotasDoApp.get("/api/squad", async (_req, res) => {
    try {
      res.json(paraVista(await readRoster()));
    } catch (error: any) {
      console.error("Erro ao ler o roster:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Gesto "Nova squad": nasce com um dominio e o PO dele. Nao toca o Google.
  rotasDoApp.post("/api/squad/nova", async (req, res) => {
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
  rotasDoApp.post("/api/squad/hire", async (req, res) => {
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
  rotasDoApp.post("/api/squad/redigir", async (req, res) => {
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

  rotasDoApp.patch("/api/squad/pessoas/:id", rotaDoRoster((req) => editarPessoa(String(req.params.id), req.body)));
  rotasDoApp.post("/api/squad/pessoas/:id/arquivar", rotaDoRoster((req) => arquivarPessoa(String(req.params.id))));
  rotasDoApp.post("/api/squad/pessoas/:id/reativar", rotaDoRoster((req) => reativarPessoa(String(req.params.id))));
  rotasDoApp.patch("/api/squad/dominios/:id", rotaDoRoster((req) => editarDominio(String(req.params.id), req.body)));
  rotasDoApp.post("/api/squad/dominios/:id/arquivar", rotaDoRoster((req) => arquivarDominio(String(req.params.id))));
  rotasDoApp.post("/api/squad/dominios/:id/reativar", rotaDoRoster((req) => reativarDominio(String(req.params.id))));
  // PO nao se arquiva: substitui-se. O anterior vira integrante arquivado.
  rotasDoApp.post("/api/squad/dominios/:id/po", rotaDoRoster((req) => substituirPo(String(req.params.id), req.body)));
  rotasDoApp.patch(
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
  rotasDoApp.post("/api/squad/squads/:id/arquivar", rotaDoRoster((req) => arquivarSquad(String(req.params.id))));
  rotasDoApp.post("/api/squad/squads/:id/reativar", rotaDoRoster((req) => reativarSquad(String(req.params.id))));

  // Mochila: as quests VEM do Google Calendar, nao de estado local. Editar
  // ou apagar no Google reflete aqui na proxima leitura (§2, verdade unica).
  rotasDoApp.get("/api/mochila", async (req, res) => {
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

  // Time vivo na Hoje: o que cada squad ATIVA tem na agenda agora, de uma vez
  // (um events.list por calendário, não a Mochila de cada squad). Só leitura;
  // cache de 60 s em memória, nada em disco: o Google continua a verdade.
  const lerTime = criarLeitorDoTime({ lerRoster: readRoster, obterToken: tokenValido, listar: listarQuestsDaJanela });
  rotasDoApp.get("/api/time", async (_req, res) => {
    try {
      res.json(await lerTime());
    } catch (error: any) {
      if (responderErroDeRoster(res, error)) return;
      if (error instanceof PrecisaConectar || error instanceof ErroDeConfig) return responderErroDeAuth(res, error);
      console.error("Erro ao ler o time:", error);
      res.status(502).json({ error: error.message });
    }
  });

  // Um turno: demanda -> 1 chamada ao Gemini -> executa as capacidades.
  rotasDoApp.post("/api/orquestrar", async (req, res) => {
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

      const resultado = await rodarDemanda(ai, { demanda: demanda.trim(), modo, squadId }, { luna: sombra, jev });
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
  rotasDoApp.post("/api/turnos/:turnoId/avaliacao", async (req, res) => {
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

  // --- Lembretes: a vigia ------------------------------------------------
  // Só no Dell (operations com a agenda). Desde 16/10/2026 (OT-14) o lembrete
  // vai pelo Telegram e cai na fila do WhatsApp só se o bot falhar; com
  // SQUADONE_LEMBRETES_PELO_TELEGRAM=false volta à fila. O Easypanel (app) não
  // roda vigia (regra 25): dois processos mandariam cada lembrete duas vezes.
  const vigia: Vigia | null =
    squadOneMode === "operations" && agendaAtiva
      ? criarVigia({
          lerJanela: () => lerJanela(process.env),
          lerRoster: readRoster,
          obterToken: tokenValido,
          listar: listarQuestsDaJanela,
          enviar: async (a: Aviso) => {
            await publicarPessoal(a);
          },
          esquecerAviso: (chave: string) => enviadosPessoais.esquecer(chave),
          // Um arquivo de uma linha (o dia do último resumo) em SQUADONE_DATA_DIR; ausente = só memória.
          resumoMatinal: resumoMatinalLigado(process.env)
            ? {
                ler: async () => {
                  const texto = await fsp.readFile(path.join(dataDir, "resumo-matinal.txt"), "utf8").catch((e) => {
                    if (e?.code === "ENOENT") return "";
                    throw e;
                  });
                  return /^\d{4}-\d{2}-\d{2}$/.test(texto.trim()) ? texto.trim() : null;
                },
                gravar: (dia: string) => fsp.writeFile(path.join(dataDir, "resumo-matinal.txt"), `${dia}\n`, { mode: 0o600 }),
              }
            : undefined,
        })
      : null;

  // Ajuste APROVADO pelo usuário. Janela antes do token (config quebrada não
  // gasta chamada). Horário só muda de lugar com permitirMover.
  rotasDoApp.post("/api/quests/:eventId/ajustar", async (req, res) => {
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

  /** `agora` opcional do corpo; null (e o 400 já respondido) quando ilegível. */
  function relogioDoPedido(req: express.Request, res: express.Response): Date | null {
    const { agora } = req.body ?? {};
    if (agora === undefined) return new Date();
    const lido = lerInstante(agora, FUSO);
    if (!lido || lido.data !== null) {
      res.status(400).json({ error: "Campo 'agora' deve ser data/hora ISO, ex.: 2026-09-15T13:50:00-03:00" });
      return null;
    }
    return new Date(lido.instante);
  }

  // Simulação da vigia do Dell (substitui as antigas /api/push/teste e
  // /api/push/varrer do ntfy): uma varredura REAL contra o Google com relógio
  // simulado, que devolve os avisos que sairiam e NÃO grava nada na fila nem na
  // deduplicação. Enviar de verdade não existe aqui: o único caminho para a fila
  // é a própria vigia, com as regras dela.
  if (squadOneMode === "operations") {
    rotasDoApp.post("/api/avisos/varrer", async (req, res) => {
      if (!vigia) return res.status(409).json({ error: "Vigia desligada neste processo.", vigiaDesligada: true });
      const relogio = relogioDoPedido(req, res);
      if (!relogio) return;
      try {
        res.json(await vigia.varrer(relogio, { enviar: false, registrar: false }));
      } catch (error: any) {
        if (error instanceof JanelaMalConfigurada || error instanceof ErroDeConfig) {
          return res.status(500).json({ error: error.message, configuracao: true });
        }
        if (responderErroDeRoster(res, error)) return;
        console.error("Erro na varredura simulada:", error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  if (agendaAtiva) {
    app.use(rotasDoApp);
  }
  // Espelho do 404 de /api/operations no perfil app: sem isto o fallback da SPA
  // responderia HTML 200 a um POST de escrita (rota do app com a agenda
  // desligada, ou rota que não existe), e quem chama acharia que deu certo.
  if (squadOneMode === "operations") {
    app.use("/api", (_req, res) => {
      res.status(404).json({ error: agendaAtiva ? "Rota inexistente." : "Rota do app indisponível no perfil operations." });
    });
  }

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
  if (squadOneMode === "operations") {
    console.log(`Diretório de dados: ${dataDir}`);
    if (!agendaAtiva) console.log(`Agenda desligada neste processo: ${motivoDaAgendaDesligada}`);
    else {
      console.log(
        `Agenda ligada; lembretes ${pessoalPeloTelegram && telegramDoDono ? "pelo Telegram (sem som das 22h às 7h; fila de reserva em " + filaDeAvisos + ")" : "pela fila de avisos (" + filaDeAvisos + ")"}, ${ANTECEDENCIA_LEMBRETE_MIN} min antes`,
      );
      if (!process.env.GEMINI_API_KEY) console.error("GEMINI_API_KEY vazia: turno, redação e transcrição vão falhar.");
      // Só a contagem e a data da mais recente: nada do conteúdo do roster no log.
      void descreverHistorico(dataDir).then((linha) => console.log(linha));
    }
    if (identidadeLigada) {
      if (loginsDoTailscale.size === 0) console.error("[acesso] SQUADONE_LOGINS_TAILSCALE vazia: todo pedido pela tailnet leva 403.");
      else console.log(`[acesso] identidade do Tailscale conferida (${loginsDoTailscale.size} login(s)).`);
    } else {
      console.log("[acesso] identidade do Tailscale não conferida (agenda desligada e SQUADONE_LOGINS_TAILSCALE vazia).");
    }
  }
  if (rosterCongelado()) console.log("Roster CONGELADO (SQUADONE_ROSTER_CONGELADO=true): contratações e edições recusadas.");

  // Sinal de vida (healthchecks.io): só no Dell, que é quem tem o status.json
  // do dell-status para saber da sessão do WhatsApp.
  let sinal: ReturnType<typeof criarSinalDeVida> | null = null;
  try {
    const url = lerUrlDoSinal(process.env);
    if (url && squadOneMode === "operations") {
      sinal = criarSinalDeVida({
        url,
        lerStatus: (agora) => lerStatusDoDell(operationsDataDir, agora),
        pingar: pingarHealthchecks,
        // Vigia ligada e sem varredura completa há 5 min: os lembretes pararam em silêncio.
        ...(vigia ? { ultimaVarreduraOkEm: () => vigia.ultimaVarreduraOkEm() } : {}),
      });
      console.log(`Sinal de vida: healthchecks a cada minuto (/fail com o WhatsApp fora há mais de 15 min${vigia ? " ou a vigia sem varredura há mais de 5 min" : ""})`);
    } else if (url) {
      console.log("Sinal de vida: DEADMAN_URL ignorada fora do perfil operations");
    }
  } catch (error: any) {
    console.error(`Sinal de vida inválido (desligado): ${error.message}`);
  }

  if (falhaDoTelegram) console.error(`Bot do Telegram inválido (desligado): ${falhaDoTelegram}`);
  else if (configDeTelegram) console.log(`Bot do Telegram: ${descreverTelegram(configDeTelegram)}`);
  else console.log("Bot do Telegram desligado (TELEGRAM_BOT_TOKEN vazia)");

  const servidor = app.listen(PORT, listenHost, () => {
    console.log(`SquadOne (${squadOneMode}) em http://${listenHost}:${PORT}`);
    // Depois do listen: a primeira varredura não disputa o boot do Vite.
    if (vigia) paradores.push(vigia.iniciar());
    if (sinal) paradores.push(sinal.iniciar());
    vendedorDoProcesso?.iniciar();
    leadQuenteDoProcesso?.iniciar();

    // Polling (Dell): busca as mensagens; nunca registra webhook.
    if (configDeTelegram?.transporte === "polling" && botDoTelegram) {
      const c = configDeTelegram;
      const offset = arquivoDeOffset(path.join(dataDir, "telegram-offset.json"));
      paradores.push(
        criarPollingDoTelegram({
          buscar: (o) => buscarAtualizacoes(c, o),
          receber: botDoTelegram.receber,
          lerOffset: offset.ler,
          gravarOffset: offset.gravar,
          esperar: (ms) => new Promise((ok) => setTimeout(ok, ms)),
        }).iniciar(),
      );
    }

    // Só em produção: o APP_URL de dev é http://localhost (o Telegram exige
    // HTTPS) e registrar com o token real roubaria o webhook do servidor no ar.
    if (configDeTelegram?.transporte === "webhook" && process.env.NODE_ENV === "production") {
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

  // SIGTERM (systemd, Easypanel) e SIGINT: para os laços ANTES de fechar o servidor, para nenhum tick
  // começar uma volta nova com o processo indo embora. Uma volta já em andamento termina dentro do prazo.
  let encerrando = false;
  const encerrar = (sinalRecebido: string) => {
    if (encerrando) return;
    encerrando = true;
    console.log(`[boot] ${sinalRecebido}: parando os laços e fechando o servidor`);
    for (const parar of paradores) {
      try {
        parar();
      } catch (error) {
        console.error("[boot] um laço não parou:", error instanceof Error ? error.message : error);
      }
    }
    servidor.close(() => process.exit(0));
    servidor.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 15_000).unref();
  };
  process.once("SIGTERM", () => encerrar("SIGTERM"));
  process.once("SIGINT", () => encerrar("SIGINT"));
}

startServer();
