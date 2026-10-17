/**
 * Contrato do Assistente da Central (RULES 28, 17/10/2026): só tipos, dividido pelo servidor
 * (server/assistente*.ts) e pelo painel (src/casca/Assistente*.vue). Fixado antes de os dois
 * lados serem escritos em paralelo; mudar aqui é mudar os dois.
 *
 * Rotas (todas sob /api/operations, só no perfil operations; os POST passam pela guarda de
 * mesma origem):
 *   GET  /assistente                         -> EstadoDoAssistente
 *   POST /assistente/mensagens               PedidoDeMensagem -> 202 RecebidoDoAssistente
 *                                            400 { error } · 429 { error, teto: true } · 503 { error, desligado: true }
 *   GET  /assistente/conversas/:id?desde=n   -> ConversaDoAssistente (Cache-Control: no-store)
 *   POST /assistente/avaliacao               { respostaId, nota: 1 | -1, motivo? } -> 204
 *   POST /assistente/cartoes/:id             { desfecho: 'confirmado' | 'descartado' } -> 204 (só mede: quem
 *                                            escreve é a rota de sempre, chamada pelo painel depois do toque)
 */

export interface EstadoDoAssistente {
  ligado: boolean
  /** A consulta ao Hermes está liberada (SQUADONE_ASSISTENTE_HERMES). */
  hermes: boolean
  tetoDia: number
  usadosHoje: number
}

/** Onde o Rômulo está: a página e, na Ficha, o lead aberto (o servidor busca o lead na visão do CRM). */
export interface ContextoDaPagina {
  pagina: string
  lead?: { produto: string; id: string }
}

export interface PedidoDeMensagem {
  conversaId?: string
  /** Até 2000 caracteres. */
  texto: string
  contexto: ContextoDaPagina
}

export interface RecebidoDoAssistente {
  conversaId: string
  /** A mensagem do Rômulo. */
  mensagemId: string
  /** A resposta que vai chegar (pendente até lá). */
  respostaId: string
}

export type CerebroDaResposta = 'regra' | 'gemini' | 'hermes'

/** De onde veio a resposta: só as leituras que de fato rodaram (regra 14). */
export interface FonteDaResposta {
  /** "Vendas às 08:14", "conversa até 16:40", "Dell às 08:15", "agenda", "Hermes (24 s)". */
  rotulo: string
}

export type TipoDeFalhaDoAssistente = 'modeloOcupado' | 'teto' | 'hermes' | 'semCrm' | 'desligado' | 'outro'

export type EstadoDoCartao = 'proposto' | 'confirmado' | 'descartado'

export type CartaoDoAssistente =
  | {
      id: string
      tipo: 'pedido_ao_time'
      estado: EstadoDoCartao
      /** Vai ao turno de sempre (/api/orquestrar) só depois do toque; editável no cartão. */
      dados: { demanda: string; modo: 'auto' | 'foco' | 'baixa' }
    }
  | {
      id: string
      tipo: 'anotacao_no_crm'
      estado: EstadoDoCartao
      /** Vai ao POST /api/operations/crm/registro de sempre só depois do toque. */
      dados: { produto: string; id: string; empresa: string; tipo: 'nota' | 'proximo_passo'; texto: string; data?: string }
    }
  | {
      id: string
      tipo: 'mensagem_ao_lead'
      estado: EstadoDoCartao
      /** Só "Copiar" (regras 11 e 17): nunca abre o WhatsApp nem marca envio. */
      dados: { produto: string; id: string; empresa: string; texto: string }
    }

export interface MensagemDoAssistente {
  id: string
  /** Ordem na conversa, para o `?desde=`. */
  n: number
  autor: 'romulo' | 'assistente'
  /** Já mascarado (telefone, e-mail, CPF/CNPJ, wa.me viram rótulos). */
  texto: string
  quando: string
  cerebro?: CerebroDaResposta
  fontes: FonteDaResposta[]
  cartoes: CartaoDoAssistente[]
  falha?: { tipo: TipoDeFalhaDoAssistente; texto: string }
}

export type EtapaPendente = 'pensando' | 'lendo' | 'hermes'

export interface ConversaDoAssistente {
  conversaId: string
  mensagens: MensagemDoAssistente[]
  /** Há resposta em preparo: o painel mostra a etapa e continua perguntando. */
  pendente: null | { respostaId: string; etapa: EtapaPendente; desde: string }
}
