/**
 * Contrato do Assistente da Central (RULES 28, 17/10/2026): só tipos, dividido pelo servidor
 * (server/assistente*.ts) e pelo painel (src/casca/Assistente*.vue). Fixado antes de os dois
 * lados serem escritos em paralelo; mudar aqui é mudar os dois.
 *
 * Rotas (todas sob /api/operations, só no perfil operations; os POST passam pela guarda de
 * mesma origem):
 *   GET  /assistente                         -> EstadoDoAssistente; desligado também é 200, com
 *                                            { ligado: false, hermes: false, tetoDia: 0, usadosHoje: 0 } (nunca 503:
 *                                            é o que o painel lê para dizer "desligado nesta Central")
 *   POST /assistente/mensagens               PedidoDeMensagem -> 202 RecebidoDoAssistente
 *                                            400 { error } · 400 { error, pendente: true } (a conversa já espera
 *                                            resposta: o painel retoma o acompanhamento) · 429 { error, teto: true } ·
 *                                            503 { error, desligado: true }. `conversaId` que o servidor não tem abre
 *                                            outra conversa: o `conversaId` do 202 é o que vale (o painel zera a lista)
 *   GET  /assistente/conversas/:id?desde=n   -> ConversaDoAssistente (Cache-Control: no-store); sem `desde`, a
 *                                            conversa inteira. 400 id torto · 404 conversa inexistente (o painel
 *                                            para de perguntar; sem mensagens na tela, começa outra)
 *   POST /assistente/avaliacao               { respostaId, nota: 1 | -1, motivo? } -> 204 · 400 · 404 resposta inexistente
 *   POST /assistente/cartoes/:id             { desfecho: 'confirmado' | 'descartado' } -> 204 (só mede: quem
 *                                            escreve é a rota de sempre, chamada pelo painel depois do toque)
 *                                            · 404 cartão inexistente · 409 já decidido com o outro desfecho (o
 *                                            mesmo desfecho de novo é 204). O painel não espera esta rota: falha aqui
 *                                            só vai ao console, o toque já valeu na tela.
 *   Com o Assistente desligado, toda rota menos o GET /assistente responde 503 { error, desligado: true }.
 *
 * O gasto falado (fase 2, 17/10/2026) NÃO passa por estas rotas: "gastei 30 no mercado" é lido no
 * painel por regra fixa (lerGastoFalado, a mesma do Telegram) e vira um cartão só da aba; o toque
 * grava por POST /api/financas/gasto { texto, origem } -> { ok, categoria, novo, texto }, com a guarda
 * de mesma origem e a de identidade das finanças. Nem o texto nem o valor chegam ao Assistente, ao
 * modelo ou ao JSONL dele (RULES 24 e 28).
 *
 * Formatos que os dois lados dividem com o CRM:
 *   - `ContextoDaPagina.pagina` é o id curto do painel (hoje, agenda, vendas, triagem, funil, numeros,
 *     ficha, financas, escritorio, mais, design-system, outra). Em `financas` o servidor não lê nada e
 *     não chama modelo: responde por regra fixa (RULES 28).
 *   - `lead.id` e o `dados.id` dos cartões são o id inteiro do CRM (`site:ChIJ…`, CrmLead.id); o
 *     servidor também acha o lead pela chave sozinha. O POST /crm/registro quer a chave (CrmLead.chave,
 *     sem o prefixo): o painel tira o prefixo na hora (chaveParaRegistro).
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
  | {
      id: string
      tipo: 'sugestao_do_copiloto'
      estado: EstadoDoCartao
      /**
       * Fase 2 (17/10/2026): nasce do SERVIDOR quando a leitura `ler_sugestao_do_copiloto` acha a
       * sugestão guardada, nunca de uma chamada do modelo. Leva só a referência: o painel relê a
       * sugestão de agora no GET /api/operations/crm/copiloto/sugestao e monta os itens com o preço do
       * cardápio (textoDaProposta). Assim nem o texto da sugestão nem R$ de proposta chegam ao
       * histórico do Assistente (RULES 28). Só "Copiar", como a mensagem ao lead.
       */
      dados: { produto: string; id: string; empresa: string; hashDoDossie: string }
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
