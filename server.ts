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
import { executarTurno, ModeloOcupado } from "./server/orchestrator.ts";
import { listarQuests } from "./server/calendar.ts";
import { ehModo } from "./server/capabilities.ts";
import { aplicarContratacao, criarSquad } from "./server/hire.ts";
import { porteiroDeIp } from "./server/acesso.ts";
import {
  desconectar,
  ErroDeConfig,
  estaConectado,
  PrecisaConectar,
  tokenValido,
  trocarCodigo,
  urlDeConsentimento,
} from "./server/auth-store.ts";

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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // O Traefik do Easypanel e o unico caminho ate aqui: sem isto o Express
  // reporta o IP do proxy em req.ip e o porteiro julgaria sempre o mesmo IP.
  app.set("trust proxy", true);
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
      res.json({ conectado: await estaConectado() });
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

  // Aprovacao de crescimento (§4.4): o unico endpoint que ESCREVE no roster.
  // O modelo so propoe; contratar e um gesto do usuario, no card de sugestao.
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
          .json({ error: "Campo 'modo' deve ser 'auto', 'foco' ou 'prazo'" });
      }

      // Squad antes do token e do Gemini: um squadId inexistente nao pode
      // custar uma chamada ao modelo para depois falhar.
      const roster = await readRoster();
      const squad = resolverSquad(roster, squadId);

      // Sem credencial o turno ainda roda: nem toda demanda toca o
      // calendario, e derrubar tudo por causa disso esconderia as capacidades
      // que nao dependem do Google.
      const token = await tokenValido().catch(() => null);
      const turno = await executarTurno(ai, { demanda: demanda.trim(), token, modo, roster, squad });
      res.json(turno);
    } catch (error: any) {
      console.error("Erro no turno:", error);
      if (responderErroDeRoster(res, error)) return;
      // Sobrecarga do Gemini nao e falha nossa: 503 + classificacao para a UI
      // oferecer "tentar de novo" em vez do erro generico de sempre.
      if (error instanceof ModeloOcupado) {
        return res.status(503).json({ error: error.message, modeloOcupado: true });
      }
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
