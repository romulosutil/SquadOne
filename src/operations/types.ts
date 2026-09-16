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
