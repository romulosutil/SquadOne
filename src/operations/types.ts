import type { SinaisDoSite } from '../../server/sinais-do-site.ts'
import type { Spiced } from './spiced'

export type OperationalState = 'healthy' | 'syncing' | 'unavailable' | 'unknown'
// Espelha server/operations.ts. 'syncthing' é opcional (aposentado em
// 12/10/2026): só vem em `tools` se a configuração do Dell ainda tiver a entrada.
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

// CRM do PRUMO (Site antes da venda, serviços PRUMO, Iris, CRM de estamparia). Espelha server/crm.ts; a Central só lê.
export type CrmEtapa = 'novo' | 'contato' | 'proposta' | 'ganho' | 'perdido'
export type CrmProduto = 'site' | 'prumo' | 'iris' | 'estampa' | 'plus'
export type CrmSinal =
  | 'na-fila' | 'publicado' | 'pronto' | 'enviado' | 'viu' | 'respondeu' | 'em-conversa'
  | 'revisar' | 'sem-etapa' | 'convite' | 'convite-visto' | 'respondeu-prumo' | 'diagnostico'
  | 'proposta' | 'fechou' | 'concluido' | 'recusou' | 'recusou-pasta' | 'expirou' | 'esfriou' | 'descartado' | 'sem-interesse' | 'sem-contato'
  | 'so-robo'

/** `licenca` (17/10/2026): o "sim" foi só permissão para mandar o material, não interesse dito. */
export type CrmTipoDeResposta = 'negativa' | 'exclusao' | 'interesse' | 'licenca' | 'neutra' | 'bot'

export interface CrmResposta {
  tipo: CrmTipoDeResposta
  trecho: string
  em?: string
}

export interface CrmEvento {
  /** Conteúdo estruturado da fonte para regras; a interface apresenta apenas texto e rótulo. */
  registroTexto?: string
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

/** Espelha ResumoDaConversa de server/conversa-do-lead.ts. */
export interface CrmResumoDaConversa {
  /** A primeira mensagem guardada: antes dela a Central não sabe o que foi dito. */
  desde: string
  mensagens: number
  ultima: { direcao: 'entrada' | 'saida', em: string, trecho: string, papel?: 'recepcao' | 'robo' }
  /** Trechos recentes em ordem, para conferir o contexto que sustenta uma decisão. */
  recentes?: CrmResumoDaConversa['ultima'][]
  /** A última de gente (o lead ou a recepção); o robô não conta. */
  ultimaEntrada?: string
  ultimaEntradaRobo?: string
  entradas?: { gente: number, recepcao: number, robo: number }
  ultimaSaida?: string
  /** O link do lead ou um material (vídeo, documento, imagem) numa mensagem nossa. */
  linkEm?: string
}

/** Os pontos que o Raio-X calcula (deploy/dell/raio-x.py, `achados`); espelha server/auto-production.ts. */
export type IdDoAchado =
  | 'posicao-na-busca' | 'sem-site' | 'site-fora-do-ar' | 'site-sem-nome' | 'site-e-rede-social'
  | 'site-sem-celular-ou-whatsapp' | 'nota-baixa' | 'poucas-avaliacoes' | 'sem-horario' | 'fotos-de-terceiros'

/** Um ponto do Raio-X com os números que o sustentam. Número que o Raio-X não leu fica ausente, nunca 0. */
export interface AchadoDoRaioX {
  id: IdDoAchado
  /** A busca de onde vêm a posição e a comparação. */
  consulta?: string
  /** posicao-na-busca: o lugar do lead (ausente = fora dos `lidos` primeiros). */
  posicao?: number
  lidos?: number
  nota?: number
  notasDoTopo?: number[]
  avaliacoes?: number
  /** As avaliações no meio da lista dos primeiros da busca. */
  medianaDaBusca?: number
  avaliacoesDoTopo?: number[]
  rede?: string
  dominio?: string
  celular?: boolean
  whatsapp?: boolean
  /** Dos `topoLidos` primeiros da busca, quantos mostram site próprio. */
  topoComSite?: number
  topoLidos?: number
}

export interface CrmLead {
  /** Instrumentação comercial explicitamente confirmada na aba CRM; nunca Finanças ou receita inferida. */
  aarr?: import('./aarr').ReceitaDoLead
  revisaoComercial?: string
  demoProtegida?: string
  id: string
  produto: CrmProduto
  chave: string
  empresa: string
  nicho: string
  cidade: string
  etapa: CrmEtapa
  sinal: CrmSinal
  subEtapa: string
  motivoPerda?: 'recusou' | 'expirou' | 'esfriou' | 'descartado' | 'sem-interesse' | 'sem-contato' | 'proposta-sem-retorno'
  /** A perda marcada na Central (aba CRM), que dá para desfazer de lá (16/10/2026, OT-06). */
  perdaManual?: 'sem-contato' | 'recusou' | 'dispensado'
  /**
   * O ganho marcado na Central (17/10/2026, AC-08): registro `ganhou` na aba CRM, desfeito por
   * `ganhou_desfeito`. Vale para todas as ofertas, inclusive o Plus, que não tem planilha.
   * `dispensado` (acima) é o "Dispensar" da Triagem (AC-10): registro `dispensado`, desfeito por
   * `dispensado_desfeito`; o lead vira Perdido com o motivo Descartado e sai da Triagem.
   */
  ganhoManual?: boolean
  /** Teste do follow-up sem recibo (OT-10, ab-recibo.ts): o braço, só no Site enviado desde 17/10/2026 sem recibo. */
  testeDoRecibo?: 'teste' | 'controle'
  /** Em contato sem próximo passo: em quantos dias vai para Perdido se o lead não escrever (1 = amanhã). */
  diasParaSair?: number
  estadoNaPlanilha: string
  desde?: string
  diasNaEtapa?: number
  ultimoEvento?: string
  diasDesdeUltimoEvento?: number
  leitura: 'viu' | 'pela-resposta' | 'desconhecida' | 'nao-se-aplica'
  /** `segundaEnviada`/`followupEnviado` (14/10/2026): o último envio anotado na aba CRM. */
  marcos: { enviado?: string; visto?: string; respondeu?: string; segundaEnviada?: string; followupEnviado?: string }
  followupHoje: boolean
  /** O follow-up de hoje é o reenvio único do só-robô (14/10/2026): pede o responsável e trava fora do expediente. */
  reenvioDoRobo?: true
  respostaNova: boolean
  /** Disse que quer ver e a 2ª mensagem ainda não saiu: fica na Hoje sem o limite de 48 h. */
  interesseParado?: { desde?: string }
  /**
   * A conversa guardada pelo observador, resumida (16/10/2026, server/conversa-do-lead.ts): quem falou
   * por último, o quê, e quando o link saiu numa mensagem nossa. Ausente = nada guardado deste lead.
   */
  conversa?: CrmResumoDaConversa
  acervo: boolean
  proximoPasso?: { texto: string; data: string; registradoEm: string }
  proposta?: { em: string; data: string }
  /** Apenas o último registro SPICED válido confirmado pelo operador, nunca sugestão do modelo. */
  spiced?: Spiced
  /** Site: o `site-demos-limpeza` apagou o demo na Vercel; sem link de demo nem segunda mensagem até republicar. */
  demoApagadoEm?: string
  /** Site, demo sob pedido (14/10/2026): o botão "Gerar demo" foi tocado e o gerador ainda não publicou. */
  demoPedidoEm?: string
  /** Caçadores do Iris e das estamparias (14/10/2026): Prioridade, sinais do site, nota do Google e de onde veio o WhatsApp. */
  triagem?: { prioridade?: number; sinais?: string; nota?: string; origemWhatsapp?: string }
  /** Os sinais do site do lead (17/10/2026, server/sinais-do-site.ts): cada um true, false ou null (sem fonte). Ausente = site ainda não lido. */
  sinais?: SinaisDoSite
  /** Plus (15/10/2026): os leads do Catálogo de Negócios Maçônicos. A oferta é o fluxo que o lead recebe. */
  plus?: { oferta: 'site' | 'prumo' | 'iris' | 'estampa'; fixo: boolean; descricao: string; instagram?: string; tambem?: string[] }
  /** O que o Raio-X publicado achou (15/10/2026), na ordem de peso da página. Raio-X mais antigo não tem. */
  achados?: AchadoDoRaioX[]
  /** PRUMO: a classe da Receita pelo CNPJ do site (filtro de porte do Lead Scout). Ausente = não conferido. */
  porte?: 'EPP' | 'DEMAIS'
  /** PRUMO: tem equipe (o alvo do Mapa)? `true` só com o porte conferido; nunca `false` por falta de dado. */
  equipe?: boolean
  notas: number
  resposta?: CrmResposta
  /**
   * Site antes da venda: variação da primeira mensagem (A/B/C, EN, manual) e versão do site.
   * `video` (11/10/2026): o braço do A/B do vídeo (coluna `braco_video`; ausente = coluna vazia).
   * `regime` (14/10/2026): o texto da 1ª mensagem pela data do envio, à parte da letra.
   * `elegiveis` (14/10/2026): as letras do sorteio (coluna `ab_elegiveis`: "A", "AB", "AC", "ABC");
   * só os leads com ela entram no A/B estratificado (ab-mensagem.ts).
   */
  abordagem?: { mensagem?: string; site?: string; video?: 'video' | 'sem-video'; regime?: CrmRegimeDaMensagem; elegiveis?: string }
  /** Só em `pronto` com link de envio: a primeira mensagem, como vai sair no WhatsApp. */
  mensagemPronta?: string
  eventos: CrmEvento[]
  /** `gerarDemo`: Site sem demo (demo sob pedido), o toque que pede o demo na página do lead. */
  links: { site?: string; enviar?: string; whatsapp?: string; acoes?: string; convite?: string; segunda?: string; followup?: string; planilha?: string; raioX?: string; gerarDemo?: string; maps?: string }
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
  /** Interesse parado há mais de 2 h: a tela destaca. */
  urgente?: boolean
}

export interface CrmGrupoHoje {
  id: CrmGrupoHojeId
  titulo: string
  explicacao: string
  itens: CrmItemHoje[]
}

export type CrmContagem = { total: number } & Record<CrmProduto, number>

export interface CrmVisao {
  estado: 'ok' | 'sem-retrato' | 'retrato-invalido'
  mensagem?: string
  geradoEm?: string
  minutosAteVelho: number
  fontes: Array<{ id: CrmProduto | 'registros'; nome: string; linhas: number; erro?: string }>
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
  links: { webhook?: string; planilhaSite?: string; planilhaPrumo?: string; planilhaIris?: string; planilhaEstampa?: string; planilhaCrm?: string }
  ultimaFalha?: { em: string; erro: string }
}

export type CrmTipoDeRegistro = 'nota' | 'proximo_passo' | 'proposta' | 'proposta_desfeita' | 'sem_contato' | 'sem_contato_desfeito'
  | import('./aarr').TipoAarr
  | 'spiced'
  | 'cadencia_enviada'
  | 'segunda_enviada' | 'followup_enviado' | 'plus_enviado' | 'plus_respondeu' | 'recusou' | 'recusou_desfeito'
  | 'ganhou' | 'ganhou_desfeito' | 'dispensado' | 'dispensado_desfeito'

/** Espelho de REGIMES_DA_MENSAGEM (server/crm.ts): até 29/09, 30/09–04/10, desde 05/10. */
export type CrmRegimeDaMensagem = 'curta_com_link' | 'prumo_com_link' | 'duas_mensagens'
