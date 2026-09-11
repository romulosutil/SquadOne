import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { readSquad, unlockedSlots } from "./server/squad.ts";
import { executarTurno } from "./server/orchestrator.ts";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function bearer(header: string | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

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
