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
  /** O que isso quer dizer e o que o Rômulo faz (escrito pelo dell-status). */
  oQueFazer?: string
  /** O link que resolve: URL http(s) ou rota da Central (ex.: /crm?produto=site). */
  acao?: { rotulo: string; url: string }
  /** Resolve sozinho: aparece só para ele saber. */
  sozinho?: boolean
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

// CRM (Site antes da venda + PRUMO). Espelha server/crm.ts; a Central só lê.
export type CrmEtapa = 'novo' | 'contato' | 'proposta' | 'ganho' | 'perdido'
export type CrmProduto = 'site' | 'prumo'
export type CrmSinal =
  | 'na-fila' | 'publicado' | 'pronto' | 'enviado' | 'viu' | 'respondeu' | 'em-conversa'
  | 'revisar' | 'sem-etapa' | 'convite' | 'convite-visto' | 'respondeu-prumo' | 'diagnostico'
  | 'proposta' | 'fechou' | 'concluido' | 'recusou' | 'recusou-pasta' | 'expirou' | 'esfriou' | 'descartado' | 'sem-interesse' | 'sem-contato'
  | 'so-robo'

export type CrmTipoDeResposta = 'negativa' | 'exclusao' | 'interesse' | 'neutra' | 'bot'

export interface CrmResposta {
  tipo: CrmTipoDeResposta
  trecho: string
  em?: string
}

export interface CrmEvento {
  tipo: string
  rotulo: string
  em: string
  origem: 'automático' | 'manual'
  fonte: string
  texto?: string
  estimado?: boolean
}

export interface CrmLink {
  rotulo: string
  url: string
}

export interface CrmLead {
  id: string
  produto: CrmProduto
  chave: string
  empresa: string
  nicho: string
  cidade: string
  etapa: CrmEtapa
  sinal: CrmSinal
  subEtapa: string
  motivoPerda?: 'recusou' | 'expirou' | 'esfriou' | 'descartado' | 'sem-interesse' | 'sem-contato'
  /** Em contato sem próximo passo: em quantos dias vai para Perdido se o lead não escrever (1 = amanhã). */
  diasParaSair?: number
  estadoNaPlanilha: string
  desde?: string
  diasNaEtapa?: number
  ultimoEvento?: string
  diasDesdeUltimoEvento?: number
  leitura: 'viu' | 'pela-resposta' | 'desconhecida' | 'nao-se-aplica'
  marcos: { enviado?: string; visto?: string; respondeu?: string }
  followupHoje: boolean
  respostaNova: boolean
  acervo: boolean
  proximoPasso?: { texto: string; data: string; registradoEm: string }
  proposta?: { em: string; data: string }
  /** Site: o `site-demos-limpeza` apagou o demo na Vercel; sem link de demo nem segunda mensagem até republicar. */
  demoApagadoEm?: string
  notas: number
  resposta?: CrmResposta
  /** Site antes da venda: variação da primeira mensagem (A/B/C, EN, manual) e versão do site. */
  abordagem?: { mensagem?: string; site?: string }
  /** Só em `pronto` com link de envio: a primeira mensagem, como vai sair no WhatsApp. */
  mensagemPronta?: string
  eventos: CrmEvento[]
  links: { site?: string; enviar?: string; whatsapp?: string; acoes?: string; convite?: string; segunda?: string; followup?: string; planilha?: string }
  pasta?: {
    lugar: string
    slug: string
    artefatos?: { conteudo: boolean; fotos: number; capa: boolean; gerado: boolean; publicado: boolean; falha: boolean }
    falha?: string
  }
  divergencias: string[]
}

export type CrmGrupoHojeId = 'proximo' | 'followup' | 'resposta' | 'revisar' | 'proposta' | 'enviar'

export interface CrmItemHoje {
  leadId: string
  acao: string
  detalhe: string
  links: CrmLink[]
  ordem: number
}

export interface CrmGrupoHoje {
  id: CrmGrupoHojeId
  titulo: string
  explicacao: string
  itens: CrmItemHoje[]
}

export interface CrmContagem {
  total: number
  site: number
  prumo: number
}

export interface CrmVisao {
  estado: 'ok' | 'sem-retrato' | 'retrato-invalido'
  mensagem?: string
  geradoEm?: string
  minutosAteVelho: number
  fontes: Array<{ id: 'site' | 'prumo' | 'registros'; nome: string; linhas: number; erro?: string }>
  colunasAusentes: string[]
  contagens: Record<CrmEtapa, CrmContagem>
  perdas: { recusou: number; expirou: number; esfriou: number; descartado: number; semInteresse: number }
  hoje: CrmGrupoHoje[]
  leads: CrmLead[]
  divergencias: number
  pastasSemLinha: string[]
  pastasLidas: boolean
  gerador?: { estado: 'processando' | 'ocioso' | 'atencao' | 'desconhecido'; detalhe: string; atualizadoEm?: string; pendentes?: number }
  registro: { disponivel: boolean; motivo?: string }
  links: { webhook?: string; planilhaSite?: string; planilhaPrumo?: string; planilhaCrm?: string }
  ultimaFalha?: { em: string; erro: string }
}

export type CrmTipoDeRegistro = 'nota' | 'proximo_passo' | 'proposta' | 'proposta_desfeita' | 'sem_contato' | 'sem_contato_desfeito'
