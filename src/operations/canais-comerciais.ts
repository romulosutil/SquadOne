export interface PedidoComercial {
  versao: 1
  workflowId: string
  execucaoId: string
  criadoEm: string
}

export interface FonteComercial {
  estado: 'atual' | 'desatualizada' | 'indisponivel'
  em?: string
}

export interface EventoWhatsApp {
  estado: 'enviado' | 'incerto' | 'sem_confirmacao' | 'sem_whatsapp'
  em: string
  recibo?: string
}

export interface ContatoLinkedIn {
  id: string
  perfil: string
  nome: string
  empresa: string
  mensagem: string
  estado: 'enviado' | 'incerto' | 'bloqueado'
  reservadoEm: string
  confirmadoEm: string | null
  conversa: string | null
  evidencia: string | null
  bloqueio: string | null
}

export interface CanalComercial {
  agenda: FonteComercial
  executor: FonteComercial
  pedido: PedidoComercial | null
  situacao: string | null
  envios: number | null
  incertos: number | null
}

export interface CanaisComerciais {
  dia: string
  whatsapp: CanalComercial & { porFicha: Record<string, EventoWhatsApp>; recibosEmConflito: number }
  linkedin: CanalComercial & {
    contatos: ContatoLinkedIn[]
    ultimaBuscaSemCandidato: { execucaoId: string; slot: string; envios: 0 } | null
  }
}
