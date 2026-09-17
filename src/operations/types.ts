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

export interface OperationsOverview {
  displayName: string
  checkedAt: string
  tools: OperationTool[]
  agenda: AgendaOverview
}

export interface LocalProject {
  id: string
  name: string
  target: string
  kind: 'url' | 'linux_path'
  createdAt: string
  updatedAt: string
}

export interface ProjectInput {
  name: string
  target: string
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
  clients: AutoClient[]
}
