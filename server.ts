import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route simulating the requested Python endpoint
  app.post("/api/orquestrar", async (req, res) => {
    try {
      const { demanda, tipo_agendamento = "time_blocking" } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
      
      if (!demanda) {
        return res.status(400).json({ error: "Campo 'demanda' é obrigatório" });
      }

      const agora = new Date().toISOString();

      const systemPrompt = `O usuário enviou uma demanda do tipo: ${tipo_agendamento}.
Atue como o 'Roteador Central' e delegue para 'TechLead', 'ProfissionalMaker' ou 'PessoalFamiliar'.

Se o tipo for 'time_blocking':
Gere um bloco de tempo para execução HOJE, considerando o horário atual (${agora}).
Retorne ESTRITAMENTE um JSON no seguinte formato:
{
  "tarefas": [
    {
      "titulo": "Nome da Tarefa",
      "agente_responsavel": "ID_DO_AGENTE",
      "tipo_agendamento": "time_blocking",
      "tempo_estimado_minutos": 60,
      "data_inicio_sugerida": "YYYY-MM-DDTHH:MM:00-03:00"
    }
  ]
}

Se o tipo for 'deadline':
Gere apenas o limite final de entrega.
Retorne ESTRITAMENTE um JSON no seguinte formato:
{
  "tarefas": [
    {
      "titulo": "Nome da Tarefa",
      "agente_responsavel": "ID_DO_AGENTE",
      "tipo_agendamento": "deadline",
      "data_limite": "YYYY-MM-DDTHH:MM:00-03:00"
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: demanda,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
        },
      });

      const textResponse = response.text;
      
      if (token && textResponse) {
        try {
          const dados = JSON.parse(textResponse);
          if (dados.tarefas) {
            for (const tarefa of dados.tarefas) {
              const event: any = {
                summary: `[${tarefa.agente_responsavel}] ${tarefa.titulo}`,
                description: 'Gerado automaticamente pelo Roteador Central.',
              };
              
              let colorId = '1';
              if (tarefa.agente_responsavel === 'TechLead') colorId = '9';
              else if (tarefa.agente_responsavel === 'ProfissionalMaker') colorId = '3';
              else if (tarefa.agente_responsavel === 'PessoalFamiliar') colorId = '2';
              
              event.colorId = colorId;
              
              if (tarefa.tipo_agendamento === 'time_blocking' && tarefa.data_inicio_sugerida) {
                const startTime = new Date(tarefa.data_inicio_sugerida);
                const endTime = new Date(startTime.getTime() + (tarefa.tempo_estimado_minutos || 60) * 60000);
                event.start = { dateTime: startTime.toISOString() };
                event.end = { dateTime: endTime.toISOString() };
              } else if (tarefa.tipo_agendamento === 'deadline' && tarefa.data_limite) {
                const deadlineTime = new Date(tarefa.data_limite);
                const startTime = new Date(deadlineTime.getTime() - 15 * 60000);
                event.summary = `⏰ DEADLINE: ${event.summary}`;
                event.start = { dateTime: startTime.toISOString() };
                event.end = { dateTime: endTime.toISOString() };
              }

              if (event.start && event.end) {
                  await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${token}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(event)
                  });
              }
            }
          }
        } catch (e) {
          console.error("Error creating calendar events:", e);
        }
      }
      
      res.type('application/json').send(textResponse);
    } catch (error: any) {
      console.error("Erro no roteamento:", error);
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
