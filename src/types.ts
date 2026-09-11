export interface Task {
  titulo: string;
  agente_responsavel: "TechLead" | "ProfissionalMaker" | "PessoalFamiliar";
  tipo_agendamento: "time_blocking" | "deadline";
  tempo_estimado_minutos?: number;
  data_inicio_sugerida?: string;
  data_limite?: string;
}

export interface OrchestrationResponse {
  tarefas: Task[];
}
