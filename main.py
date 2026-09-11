import os
import json
from datetime import datetime, timezone, timedelta
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Literal
from google import genai
from google.genai import types
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

app = FastAPI(title="Orquestrador de Agentes API")

# Inicializa o client do Gemini
client = genai.Client()

class DemandaRequest(BaseModel):
    demanda: str
    tipo_agendamento: Literal["time_blocking", "deadline"] = "time_blocking"

def criar_evento_calendario(tarefa: dict, token: str):
    try:
        credentials = Credentials(token=token)
        service = build('calendar', 'v3', credentials=credentials)
        
        event = {
            'summary': f"[{tarefa.get('agente_responsavel')}] {tarefa.get('titulo')}",
            'description': 'Gerado automaticamente pelo Roteador Central.',
        }
        
        # Color mapping logic based on agent
        color_id = '1' # Default
        agente = tarefa.get('agente_responsavel')
        if agente == 'TechLead':
            color_id = '9' # Blueberry
        elif agente == 'ProfissionalMaker':
            color_id = '3' # Grape
        elif agente == 'PessoalFamiliar':
            color_id = '2' # Sage
            
        event['colorId'] = color_id

        if tarefa.get('tipo_agendamento') == 'time_blocking':
            start_time = datetime.fromisoformat(tarefa.get('data_inicio_sugerida'))
            end_time = start_time + timedelta(minutes=tarefa.get('tempo_estimado_minutos', 60))
            
            event['start'] = {
                'dateTime': start_time.isoformat(),
                'timeZone': 'America/Sao_Paulo',
            }
            event['end'] = {
                'dateTime': end_time.isoformat(),
                'timeZone': 'America/Sao_Paulo',
            }
        elif tarefa.get('tipo_agendamento') == 'deadline':
            deadline_time = datetime.fromisoformat(tarefa.get('data_limite'))
            # Create a 15-minute event as a deadline reminder
            start_time = deadline_time - timedelta(minutes=15)
            
            event['summary'] = f"⏰ DEADLINE: {event['summary']}"
            event['start'] = {
                'dateTime': start_time.isoformat(),
                'timeZone': 'America/Sao_Paulo',
            }
            event['end'] = {
                'dateTime': deadline_time.isoformat(),
                'timeZone': 'America/Sao_Paulo',
            }

        event = service.events().insert(calendarId='primary', body=event).execute()
        print(f"Event created: {event.get('htmlLink')}")
        return True
    except Exception as e:
        print(f"Error creating calendar event: {e}")
        return False

@app.post("/api/orquestrar")
async def orquestrar_tarefa(request: DemandaRequest, http_request: Request):
    try:
        agora = datetime.now(timezone.utc).astimezone().isoformat()
        
        system_prompt = f"""O usuário enviou uma demanda do tipo: {request.tipo_agendamento}.
Atue como o 'Roteador Central' e delegue para 'TechLead', 'ProfissionalMaker' ou 'PessoalFamiliar'.

Se o tipo for 'time_blocking':
Gere um bloco de tempo para execução HOJE, considerando o horário atual ({agora}).
Retorne ESTRITAMENTE um JSON no seguinte formato:
{{
  "tarefas": [
    {{
      "titulo": "Nome da Tarefa",
      "agente_responsavel": "ID_DO_AGENTE",
      "tipo_agendamento": "time_blocking",
      "tempo_estimado_minutos": 60,
      "data_inicio_sugerida": "YYYY-MM-DDTHH:MM:00-03:00"
    }}
  ]
}}

Se o tipo for 'deadline':
Gere apenas o limite final de entrega.
Retorne ESTRITAMENTE um JSON no seguinte formato:
{{
  "tarefas": [
    {{
      "titulo": "Nome da Tarefa",
      "agente_responsavel": "ID_DO_AGENTE",
      "tipo_agendamento": "deadline",
      "data_limite": "YYYY-MM-DDTHH:MM:00-03:00"
    }}
  ]
}}"""

        response = client.models.generate_content(
            model='gemini-3.5-flash',
            contents=request.demanda,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
            ),
        )
        
        # Parse the JSON response
        try:
            dados = json.loads(response.text)
            
            # Retrieve token from headers
            auth_header = http_request.headers.get('Authorization')
            if auth_header and auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
                
                # Iterate and create events
                if 'tarefas' in dados:
                    for tarefa in dados['tarefas']:
                        criar_evento_calendario(tarefa, token)
        except Exception as e:
            print(f"Failed to process calendar events: {e}")
            
        return Response(content=response.text, media_type="application/json")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
