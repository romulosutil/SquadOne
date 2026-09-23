export type OperationalState = 'healthy' | 'syncing' | 'unavailable' | 'unknown'
export type ToolId = 'hermes' | 'ide' | 'syncthing' | 'n8n' | 'remote'

export interface OperationTool {
  id: ToolId
  label: string
  description: string
  launchUrl: string
  state: OperationalState
  detail: string
}

export interface AgendaEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  htmlLink?: string
  location?: string
}

export type AgendaOverview =
  | { state: 'connected'; events: AgendaEvent[] }
  | { state: 'disconnected'; events: [] }
  | { state: 'unavailable'; events: []; message: string }

export type DellCheckState = 'ok' | 'atencao' | 'falha'

export interface DellCheck {
  id: string
  grupo: 'servicos' | 'fluxos' | 'dados' | 'containers' | 'maquina' | 'pendencias'
  nome: string
  estado: DellCheckState
  detalhe: string
  desde?: string
  link?: string
}

// Retrato gravado a cada minuto no Dell por deploy/dell/dell-status.py.
export interface DellStatus {
  geradoEm: string | null
  verificacoes: DellCheck[]
}

export interface OperationsOverview {
  displayName: string
  checkedAt: string
  tools: OperationTool[]
  agenda: AgendaOverview
  dell: DellStatus
}

export type AutoStage = 'preparation' | 'generated' | 'ready' | 'sent' | 'confirmed'
export type AutoEventType = 'ready' | 'sent' | 'confirmed'

export interface AutoOperationalEvent {
  type: AutoEventType
  at: string
  recordedAt: string
  origin: 'Hermes via WhatsApp' | 'registro manual'
  manual: true
  channel?: string
  recipient?: string
}

export interface AutoClient {
  id: string
  name: string
  stage: AutoStage
  stageLabel: string
  artifacts: {
    content: boolean
    photos: number
    cover: boolean
    generated: boolean
    publishedRecord: boolean
    failure: boolean
  }
  lastModified: string
  thumbnailUrl?: string
  alerts: string[]
  failureMessage?: string
  fileHistory: Array<{ name: string; changedAt: string; origin: 'leitura local' }>
  operationalHistory: AutoOperationalEvent[]
  hermesNotified: boolean
  readyAt?: string
  sentAt?: string
  confirmedAt?: string
}

export interface AutoProductionOverview {
  checkedAt: string
  source: 'leitura local'
  summary: {
    active: number
    preparing: number
    ready: number
    awaitingSend: number
    awaitingConfirmation: number
    confirmed: number
    attention: number
    discarded: number
  }
  funnel: {
    materialReceived: number
    contentAndImages: number
    generated: number
    ready: number
    sent: number
    confirmed: number
  }
  automation: {
    folder: AutoConnectionEvidence
    runner: AutoConnectionEvidence
    hermes: AutoConnectionEvidence
    whatsapp: AutoConnectionEvidence
    notifier: AutoConnectionEvidence & { notifiedCount: number }
    syncthing?: AutoConnectionEvidence
  }
  page: { number: number; size: number; total: number; pages: number }
  actionClients: AutoClient[]
  attentionClients: AutoClient[]
  clients: AutoClient[]
}

export type AutoConnectionState = 'connected' | 'running' | 'idle' | 'attention' | 'unknown' | 'unavailable'

export interface AutoConnectionEvidence {
  state: AutoConnectionState
  detail: string
  evidence: string
  updatedAt?: string
}
