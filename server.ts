import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { readSquad, unlockedSlots, dominiosDoSquad } from "./server/squad.ts";
import { executarTurno } from "./server/orchestrator.ts";
import { listarQuests } from "./server/calendar.ts";
import { aplicarContratacao, ConflitoDeRoster } from "./server/hire.ts";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function bearer(header: string | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Roster: fonte de verdade do squad e dos slots desbloqueados.
  app.get("/api/squad", async (_req, res) => {
    try {
      const squad = await readSquad();
      res.json({ ...squad, unlockedSlots: unlockedSlots(squad) });
    } catch (error: any) {
      console.error("Erro ao ler o squad:", error);
      res.status(500).json({ error: error.message });
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
      // escritorio cheio): nao e erro de forma do pedido, e estado que mudou.
      const status = error instanceof ConflitoDeRoster ? 409 : 400;
      console.error("Erro ao contratar:", error);
      res.status(status).json({ error: error.message });
    }
  });

  // Mochila: as quests VEM do Google Calendar, nao de estado local. Editar
  // ou apagar no Google reflete aqui na proxima leitura (§2, verdade unica).
  app.get("/api/mochila", async (req, res) => {
    const token = bearer(req.headers.authorization);
    if (!token) {
      return res
        .status(401)
        .json({ error: "Sem access_token do Google: conecte o calendário." });
    }
    try {
      const squad = await readSquad();
      const { quests, erros } = await listarQuests(
        token,
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
      const { demanda } = req.body ?? {};
      if (typeof demanda !== "string" || !demanda.trim()) {
        return res.status(400).json({ error: "Campo 'demanda' é obrigatório" });
      }

      const turno = await executarTurno(
        ai,
        demanda.trim(),
        bearer(req.headers.authorization),
      );
      res.json(turno);
    } catch (error: any) {
      console.error("Erro no turno:", error);
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
