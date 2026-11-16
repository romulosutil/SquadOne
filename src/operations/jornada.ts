// Jornada do cliente do PRUMO (15/10/2026): a ordem das etapas, quem faz cada
// uma, o que tira o lead dela e o que oferecer a cada lead. PURO (sem Vue, sem
// fetch), como colinha.ts, de onde vem o cardápio (nomes, entregas e preços).
//
// Por que existe: a regra "depois do Raio-X vem o Mapa (empresa com equipe), e
// o site corre em paralelo se ele quiser" estava espalhada entre negocio.md,
// decisoes.md, a colinha e a cabeça do Rômulo, e um agente perdeu tempo sem
// saber dela. Daqui saem a Ficha do CRM (etapa, próximo passo, o que oferecer)
// e o guia que os agentes leem, docs/referencia/jornada-do-cliente.md
// (`npx tsx scripts/jornada-guia.ts`; o teste falha se o guia ficar para trás).
//
// A fonte do negócio continua sendo o repositório prumo (00-contexto/negocio.md,
// "A oferta" e "Jornada do cliente"): mudou lá, mude aqui e refaça o guia.

import { CARDAPIO, type IdDoServico, type ServicoDoCardapio } from './colinha'
import type { AchadoDoRaioX, CrmLead, CrmProduto, IdDoAchado } from './types'
import { ehOfertaPropria, type OfertaPropria as OfertaDoJson } from '../../server/ofertas.ts'

// ------------------------------------------------------------------ etapas

export type IdDoPasso =
  | 'achado' | 'raio-x' | 'primeiro-contato' | 'resposta' | 'segunda'
  | 'conversa' | 'mapa-convite' | 'mapa' | 'devolutiva'
  | 'proposta' | 'ganho' | 'perdido'

/** Por onde o passo anda: o tronco comum, os dois trilhos (combináveis) e o fecho. */
export type Trilho = 'tronco' | 'fora' | 'dentro' | 'fecho'

export const ROTULO_DO_TRILHO: Record<Trilho, string> = {
  tronco: 'Descoberta e conversa',
  fora: 'Por fora (o caminho do cliente)',
  dentro: 'Por dentro (empresa com equipe)',
  fecho: 'Fechamento',
}

export type QuemFaz = 'robô' | 'você' | 'o dono'

export interface PassoDaJornada {
  id: IdDoPasso
  nome: string
  trilho: Trilho
  quem: QuemFaz
  /** Quem trabalha nele, com o nome que aparece no Dell ("Caçador, 06:00"). */
  como: string
  /** Quando o lead está aqui: o que o CRM enxerga. */
  entra: string
  /** O que tira o lead daqui (e para onde). */
  sai: string
  /** O prazo que a operação se dá, quando há. */
  prazo?: string
  /** O serviço do cardápio que este passo entrega ou vende. */
  servico?: IdDoServico
  /**
   * Com você e há este tanto de dias no passo: a vista Jornada o marca como parado. Só nos passos
   * em que a espera é sua (nos do robô e do dono, esperar é o normal).
   */
  paradoApos?: number
  /**
   * Onde este passo mora no service blueprint (docs/blueprint/servico.json): um código de passo
   * (`SITE-3`) ou de cartão (`PRUMO-2-P1`) por serviço em que ele existe (OT-03, 16/10/2026). A
   * jornada fica com a regra do lead; a descrição da esteira é do blueprint, e o teste
   * src/operations-mapa-unico.test.ts falha se um código daqui sumir de lá.
   */
  blueprint?: readonly string[]
}

// A ordem do array é a da jornada (a Ficha e o guia mostram nesta ordem).
export const PASSOS: PassoDaJornada[] = [
  {
    id: 'achado',
    nome: 'Achado',
    trilho: 'tronco',
    quem: 'robô',
    como: 'Caçador (n8n 01, 06:00: Google Places + nota do Gemini); Iris e estamparias pelos caçadores próprios (pausados desde 17/10/2026; não religar nesta rodada; acervo na Triagem); Plus pelo Catálogo de Negócios Maçônicos',
    entra: 'O caçador gravou a empresa na planilha (ou, no Plus, no leads.json).',
    sai: 'Uma conversa elegível confirma a necessidade; Raio-X e demonstração são opcionais quando ajudam a decisão.',
    blueprint: ['SITE-1', 'OFERTAS-1'],
  },
  {
    id: 'raio-x',
    nome: 'Raio-X pronto',
    trilho: 'tronco',
    quem: 'robô',
    como: 'raio-x.py (11:15 e 17:15) e o Balcão (n8n 03, de hora em hora) marcam "pronto" e sorteiam a mensagem; no PRUMO, o Raio-X à mão (projeto prumo-raio-x)',
    entra: 'Raio-X produzido para uma observação útil; não é requisito de toda venda nem autorização de contato.',
    sai: 'Apresentar somente quando pertinente e no canal permitido. Material pronto não comprova interesse ou envio.',
    servico: 'raio-x',
    blueprint: ['SITE-2'],
  },
  {
    id: 'primeiro-contato',
    nome: 'Primeira mensagem',
    trilho: 'tronco',
    quem: 'você',
    como: 'Primeiros contatos automáticos bloqueados após o softban por spam de 13/11/2026. Reconexão, configuração ativa ou passagem do tempo não liberam a fila. Descoberta começa por contato elegível e necessidade, com Rômulo responsável.',
    entra: 'Enviada (ou convite enviado), sem resposta de gente.',
    sai: 'Resposta humana inicia descoberta. Silêncio e robô não confirmam recusa ou necessidade. Estados de expiração do histórico precisam de revisão; não autorizam retomada.',
    prazo: 'Próximo passo conforme o combinado; sem cobrança automática por silêncio.',
    blueprint: ['SITE-3', 'PRUMO-1', 'OFERTAS-3'],
  },
  {
    id: 'resposta',
    paradoApos: 1,
    nome: 'Respondeu',
    trilho: 'tronco',
    quem: 'você',
    como: 'O observador lê a resposta e o Gemini classifica (interesse, neutra, negativa, robô, exclusão); você responde com o Roteiro',
    entra: 'Respondeu e a 2ª mensagem ainda não saiu.',
    sai: 'Atender o pedido recebido e confirmar a necessidade. Permissão para material não é compra. Recusa interrompe a abordagem; exclusão segue o procedimento de proteção dos dados.',
    prazo: 'interesse respondido em até 2 h',
    blueprint: ['SITE-4', 'OFERTAS-4'],
  },
  {
    id: 'segunda',
    paradoApos: 2,
    nome: 'Recebeu a 2ª mensagem',
    trilho: 'tronco',
    quem: 'você',
    como: 'Entregar somente o material pertinente solicitado. Abrir WhatsApp não confirma envio; conferir recibo ou confirmação explícita antes de registrar.',
    entra: 'Material realmente enviado e registrado com evidência.',
    sai: 'Confirmar necessidade, adequação e processo de decisão. Mapa é opcional quando sua investigação ajuda a escolher o escopo.',
    prazo: 'Resposta útil ao pedido; proposta quando houver contexto suficiente, não por um "gostei".',
    blueprint: ['SITE-5', 'PRUMO-2'],
  },
  {
    id: 'conversa',
    paradoApos: 2,
    nome: 'Conversa',
    trilho: 'fora',
    quem: 'você',
    como: 'Rômulo entende um caso real, a solução atual, quem decide e o próximo passo. Use mensagem ou reunião conforme a necessidade; não exigir ligação para uma compra simples.',
    entra: 'A pessoa descreveu o que quer resolver ou pediu condições de uma entrega específica.',
    sai: 'Proposta de uma entrega pertinente com escopo, condições e próximo passo; esclarecer lacunas antes de prometer.',
    prazo: 'Prazo combinado com o cliente e compatível com a capacidade de entrega.',
    blueprint: ['PRUMO-2-P1', 'OFERTAS-5'],
  },
  {
    id: 'mapa-convite',
    nome: 'Convite para o Mapa',
    trilho: 'dentro',
    quem: 'você',
    como: 'Convite do Roteiro: Mapa gratuito e opcional quando a rotina da equipe exige investigação; confirmar utilidade e aceite',
    entra: 'A empresa tem equipe, existe necessidade de investigar regras/processos e o dono aceitou o Mapa. Não é passagem obrigatória de toda oportunidade.',
    sai: 'O dono responde as 16 perguntas no formulário: "Mapa respondido".',
    servico: 'mapa',
    blueprint: ['PRUMO-3-E1'],
  },
  {
    id: 'mapa',
    paradoApos: 2,
    nome: 'Mapa respondido',
    trilho: 'dentro',
    quem: 'você',
    como: 'O formulário dispara o fluxo "PRUMO — Diagnóstico do dono" e o prumo-mapa gera o rascunho em PDF em ~/prumo-entregas; você completa os [PREENCHER]',
    entra: 'O dono respondeu as 16 perguntas (sinal "diagnóstico" em Vendas).',
    sai: 'Documento completo e a devolutiva de 45 min marcada.',
    servico: 'mapa',
    blueprint: ['PRUMO-3'],
  },
  {
    id: 'devolutiva',
    paradoApos: 2,
    nome: 'Devolutiva do Mapa',
    trilho: 'dentro',
    quem: 'você',
    como: 'Conversa de 45 min sobre o documento (o documento é do dono, contrate ou não)',
    entra: 'Devolutiva marcada como próximo passo na Ficha.',
    sai: 'Confirmar necessidade, decisão e escopo; propor a entrega pertinente quando houver contexto suficiente.',
    prazo: 'Próximo passo e prazo combinados, sem obrigação de proposta',
    servico: 'fonte',
    blueprint: ['PRUMO-4'],
  },
  {
    id: 'proposta',
    paradoApos: 3,
    nome: 'Proposta enviada',
    trilho: 'fecho',
    quem: 'você',
    como: 'Proposta de escopo definido, com preço vigente, dependências, entrega e suporte; registrar a versão e a evidência do envio.',
    entra: 'Envio da proposta confirmado. Proposta preparada não é enviada.',
    sai: 'Registrar aceite da versão, cobrança e recebimento como fatos distintos. Acompanhar conforme o compromisso, respeitando espera e recusa.',
    blueprint: ['SITE-7', 'PRUMO-5'],
  },
  {
    id: 'ganho',
    nome: 'Ganho',
    trilho: 'fecho',
    quem: 'você',
    como: 'Encontrado: no ar e pago depois de ver; Fonte: 2 semanas, 50/50; depois, as mensalidades',
    entra: 'Ganho legado ou contratação registrada; conferir o aceite e as condições, sem inferir pagamento.',
    sai: 'Entrega, aceite, cobrança e recebimento verificados separadamente; manutenção apenas nas condições contratadas.',
    blueprint: ['SITE-7-C1', 'PRUMO-5-C1'],
  },
  {
    id: 'perdido',
    nome: 'Perdido',
    trilho: 'fecho',
    quem: 'robô',
    como: 'Conserva recusas, exclusões, dispensas e expirações das fontes legadas. A Carteira distingue encerramento explícito de revisão por tempo.',
    entra: 'Encerramento explícito ou estado legado que exige revisão; silêncio não comprova venda perdida.',
    sai: 'Revisão interna preserva o histórico e não autoriza contato. Nova conversa elegível precisa respeitar recusas e contexto atual.',
    blueprint: ['SITE-7-B1'],
  },
]

export const passoDaJornada = (id: IdDoPasso): PassoDaJornada => PASSOS.find((p) => p.id === id)!

// ------------------------------------------------------------------ ofertas fora do cardápio

/** Iris e o CRM de estamparia são produtos próprios; a Iris usa as faixas versionadas em precos-iris.ts. */
export type IdDaOfertaPropria = 'iris' | 'crm-estamparia'

export interface OfertaPropria {
  id: IdDaOfertaPropria
  nome: string
  entrega: string
  paraQuem: string
}

export const OFERTAS_PROPRIAS: OfertaPropria[] = [
  {
    id: 'iris',
    nome: 'Iris',
    entrega: 'Íris — Em uso. Diário de sessão e dossiê para clínicas de terapia e saúde mental. A IA organiza evidências rastreáveis, o terapeuta revisa e aprova; a IA não pontua protocolos nem toma decisões clínicas. Inclui relatório da família em PDF. O estado de uso não substitui a avaliação de qualidade da versão.',
    paraQuem: 'Clínicas de terapia e saúde mental (aba Clínicas). Conversa própria sobre a rotina, sem exigir Raio-X ou Mapa; condições da assinatura na ficha vigente da Íris.',
  },
  {
    id: 'crm-estamparia',
    nome: 'CRM de estamparia',
    entrega: 'CRM de estamparia — Em implantação. Conversas, clientes e pedidos reunidos para quem vende camisetas e uniformes por conversa. O assistente no WhatsApp depende de liberação e homologação; o estado de implantação não substitui a avaliação de qualidade da versão.',
    paraQuem: 'Estamparias e confecções (aba Estamparias). Confirmar necessidade, impacto, decisor, escopo, titularidade e condições próprias antes de ampliar a venda; sem inventar prazo ou preço e sem exigir Raio-X ou Mapa.',
  },
]

/** Hipótese por oferta própria; o catálogo central exige cobertura quando surgir outra oferta. */
const OFERTA_PROPRIA_NA_JORNADA: Record<OfertaDoJson, { id: IdDaOfertaPropria; porque: string }> = {
  iris: { id: 'iris', porque: 'Hipótese da oferta cadastrada: Íris em uso. Avaliação dirigida da rotina, prontidão, suporte e condições vigentes; sem Raio-X ou Mapa obrigatório.' },
  estampa: { id: 'crm-estamparia', porque: 'Hipótese da oferta cadastrada: CRM de estamparia em implantação. Confirmar necessidade, impacto, decisor, prontidão e homologação; piloto não é produto pronto.' },
}

export type IdDaOferta = IdDoServico | IdDaOfertaPropria

export function nomeDaOferta(id: IdDaOferta): string {
  return CARDAPIO.find((s) => s.id === id)?.nome ?? OFERTAS_PROPRIAS.find((o) => o.id === id)!.nome
}

export const servicoDoCardapio = (id: IdDoServico): ServicoDoCardapio => CARDAPIO.find((s) => s.id === id)!

// ------------------------------------------------------------------ o lead na jornada

/**
 * O pedaço do CrmLead que a jornada lê (o teste monta à mão). `equipe` decide o trilho de dentro:
 * `true` só com o porte conferido pelo CNPJ (EPP ou DEMAIS); ausente, o Mapa aparece "a confirmar";
 * `false` o tira. `achados` (o que o Raio-X achou) ordena e explica a oferta.
 */
export type LeadDaJornada = Pick<CrmLead, 'produto' | 'etapa' | 'sinal' | 'marcos' | 'links' | 'followupHoje'>
  & Partial<Pick<CrmLead, 'resposta' | 'proposta' | 'proximoPasso' | 'plus' | 'diasParaSair' | 'interesseParado' | 'achados' | 'porte' | 'equipe' | 'spiced' | 'conversa'>>

/** O funil em que o lead anda: o Plus segue o da oferta dele. */
export type Funil = Exclude<CrmProduto, 'plus'>

export function funilDoLead(lead: Pick<LeadDaJornada, 'produto' | 'plus'>): Funil {
  return lead.produto === 'plus' ? lead.plus?.oferta ?? 'site' : lead.produto
}

/** Os passos possíveis do lead, na ordem: o tronco, os trilhos que valem para ele e o fecho. */
export function caminhoDoLead(lead: LeadDaJornada): IdDoPasso[] {
  const funil = funilDoLead(lead)
  const tronco: IdDoPasso[] = ['achado', 'raio-x', 'primeiro-contato', 'resposta', 'segunda']
  // Iris e estamparias: convite → conversa → proposta. Sem Raio-X aprovado nem Mapa.
  if (ehOfertaPropria(funil)) return ['achado', 'primeiro-contato', 'resposta', 'conversa', 'proposta', 'ganho']
  return [...tronco, 'conversa', ...(trilhoDeDentro(lead) ? ['mapa-convite', 'mapa', 'devolutiva'] as IdDoPasso[] : []), 'proposta', 'ganho']
}

/**
 * O trilho de dentro (Mapa → Fonte) vale para o PRUMO com equipe, ou com o porte ainda a confirmar.
 * O Site antes da venda é empresa pequena demais para o Mapa (colinha.ts), a não ser que o Mapa já
 * tenha sido respondido.
 */
function trilhoDeDentro(lead: LeadDaJornada): boolean {
  if (lead.sinal === 'diagnostico') return true
  return (funilDoLead(lead) === 'prumo' && lead.equipe !== false) || (funilDoLead(lead) === 'site' && lead.equipe === true)
}

/** Em que passo o lead está agora, pelo que o retrato do CRM mostra. */
export function passoAtual(lead: LeadDaJornada): IdDoPasso {
  const gente = lead.resposta !== undefined && lead.resposta.tipo !== 'bot'
  switch (lead.etapa) {
    case 'perdido': return 'perdido'
    case 'ganho': return 'ganho'
    case 'proposta': return 'proposta'
    case 'novo':
      return lead.sinal === 'pronto' || lead.sinal === 'publicado' ? 'raio-x' : 'achado'
    case 'contato':
      if (lead.sinal === 'diagnostico') return 'mapa'
      if (lead.marcos.segundaEnviada) return 'segunda'
      if (gente || lead.sinal === 'respondeu' || lead.sinal === 'respondeu-prumo' || lead.sinal === 'em-conversa') {
        // Iris e estamparias não têm 2ª mensagem: quem respondeu já está em conversa.
        const funil = funilDoLead(lead)
        return ehOfertaPropria(funil) ? 'conversa' : 'resposta'
      }
      return 'primeiro-contato'
  }
}

/**
 * `sem-registro`: ficou para trás, mas o CRM não tem como saber se aconteceu (a conversa e o Mapa
 * de quem já está na proposta, os passos de um lead perdido). Melhor dizer que não sabe que inventar.
 */
export type EstadoDoPasso = 'feito' | 'agora' | 'depois' | 'sem-registro'

export const ROTULO_DO_ESTADO: Record<EstadoDoPasso, string> = { feito: 'Feito', agora: 'Agora', depois: 'Depois', 'sem-registro': 'Sem registro' }

export interface PassoDoLead {
  passo: PassoDaJornada
  estado: EstadoDoPasso
  /** Quando aconteceu, se o CRM sabe (ISO). */
  em?: string
}

// Quando cada passo aconteceu, pelos marcos do CRM (o que não tem marco fica sem data).
function dataDoPasso(lead: LeadDaJornada, id: IdDoPasso): string | undefined {
  switch (id) {
    case 'primeiro-contato': return lead.marcos.enviado
    case 'resposta': return lead.marcos.respondeu ?? lead.resposta?.em
    case 'segunda': return lead.marcos.segundaEnviada
    case 'proposta': return lead.proposta?.em
    default: return undefined
  }
}

/**
 * Os passos do caminho do lead com o estado de cada um. Os trilhos são combináveis: estando
 * em "Mapa respondido", a conversa (por fora) continua "depois", não "feita". O Perdido não
 * entra no caminho; nele, o que tem data é "feito" e o resto, "sem registro".
 */
export function jornadaDoLead(lead: LeadDaJornada): PassoDoLead[] {
  const caminho = caminhoDoLead(lead)
  const atual = passoAtual(lead)
  const trilhoAtual = passoDaJornada(atual).trilho
  const iAtual = caminho.indexOf(atual)
  return caminho.map((id, i) => {
    const passo = passoDaJornada(id)
    const em = dataDoPasso(lead, id)
    let estado: EstadoDoPasso
    if (atual === 'perdido') estado = em || id === 'achado' ? 'feito' : 'sem-registro'
    else if (i === iAtual) estado = 'agora'
    else if (i > iAtual) estado = 'depois'
    else if (passo.trilho === 'tronco') estado = 'feito'
    // Atrás do atual, num trilho: no outro trilho ainda pode acontecer; no fecho, o CRM não sabe.
    else if (trilhoAtual === 'fecho') estado = 'sem-registro'
    else estado = passo.trilho === trilhoAtual ? 'feito' : 'depois'
    return { passo, estado, ...(em ? { em } : {}) }
  })
}

// ------------------------------------------------------------------ próximo passo

export interface ProximoDaJornada {
  /** O que fazer, numa frase. */
  acao: string
  quem: QuemFaz
  /** "hoje", "em 2 dias", o prazo da operação… */
  quando?: string
  /** O próximo passo foi salvo à mão na Ficha: vale ele, não o sugerido. */
  marcadoAMao?: boolean
}

/** O que fazer agora com o lead: o salvo à mão manda; sem ele, o que a jornada diz. */
export function proximoDaJornada(lead: LeadDaJornada): ProximoDaJornada {
  const tipo = lead.resposta?.tipo
  if (tipo === 'exclusao') return { acao: 'Interromper contato e seguir o procedimento de exclusão e proteção dos dados.', quem: 'você' }
  if (lead.etapa === 'perdido' || tipo === 'negativa' || ['recusou', 'recusou-pasta', 'sem-interesse', 'descartado', 'sem-contato', 'expirou', 'esfriou'].includes(lead.sinal)) {
    return { acao: 'Nada a mandar. Conferir o encerramento no histórico; revisão interna não autoriza nova abordagem.', quem: 'o dono' }
  }
  if (lead.etapa === 'ganho') return { acao: 'Conferir aceite, entrega, cobrança e recebimento separadamente; cumprir somente o suporte contratado.', quem: 'você' }
  if (/preço|preco|valor|quanto (?:custa|fica)/i.test(lead.resposta?.trecho ?? '')) {
    return { acao: 'Responder diretamente ao pedido de preço com as condições vigentes da oferta; esclarecer o escopo sem exigir Raio-X, Mapa ou reunião.', quem: 'você', quando: 'em até 2 h' }
  }
  if (lead.etapa === 'novo') return { acao: 'Conferir a necessidade e o canal elegível. Primeiros contatos automáticos bloqueados; material pronto não autoriza envio.', quem: 'você' }
  if (lead.proximoPasso?.texto) {
    return { acao: lead.proximoPasso.texto, quem: 'você', quando: lead.proximoPasso.data, marcadoAMao: true }
  }
  switch (passoAtual(lead)) {
    case 'achado':
    case 'raio-x':
      return { acao: 'Conferir a necessidade e o canal elegível; primeiros contatos automáticos bloqueados.', quem: 'você' }
    case 'primeiro-contato':
      return { acao: 'Aguardar resposta ou o próximo passo combinado. Silêncio e resposta de robô não comprovam recusa nem autorizam cobrança automática.', quem: 'o dono' }
    case 'resposta':
      if (tipo === 'licenca') return { acao: 'Entregar somente o material solicitado, no canal permitido. Permissão para material não confirma necessidade nem compra.', quem: 'você', quando: 'em até 2 h' }
      return { acao: 'Atender o pedido recebido e entender o que precisa resolver. Interesse e permissão não confirmam compra; propor escopo quando houver contexto suficiente.', quem: 'você', quando: 'em até 2 h' }
    case 'segunda':
    case 'conversa':
      return { acao: 'Confirmar necessidade, processo de decisão e escopo. Proposta quando houver contexto suficiente; não exigir diagnóstico ou reunião para uma compra simples.', quem: 'você' }
    case 'mapa':
      return { acao: 'Conferir o rascunho do Mapa com o dono e combinar a devolutiva. O diagnóstico não obriga a contratar Fonte.', quem: 'você' }
    case 'mapa-convite':
    case 'devolutiva':
      return { acao: 'Conferir o problema e o escopo pertinente; usar o Mapa quando útil. Proposta da Fonte somente se a necessidade justificar.', quem: 'você' }
    case 'proposta':
      return { acao: 'Acompanhar a decisão na data combinada e registrar o próximo passo; aceite, entrega e pagamento são fatos distintos.', quem: 'você' }
    case 'ganho':
      return { acao: 'Conferir entrega e recebimento conforme as condições contratadas.', quem: 'você' }
    case 'perdido':
      return { acao: 'Nada a mandar; revisão interna não autoriza contato.', quem: 'o dono' }
  }
}

// ------------------------------------------------------------------ o que oferecer

export interface OfertaSugerida {
  id: IdDaOferta
  /** Por que esta oferta para este lead (ou quando ela entra). */
  porque: string
}

export interface OfertaDoLead {
  /** O que oferecer agora, em ordem. */
  agora: OfertaSugerida[]
  /** O que vem depois, com a condição. */
  depois: OfertaSugerida[]
  /** O que não oferecer a este lead, e por quê. */
  naoAgora: OfertaSugerida[]
  /** O que falta saber para decidir (porte, se o site dele aparece…). */
  aConfirmar: string[]
}

/**
 * Regras da oferta, na ordem em que são aplicadas. São estas frases que o guia dos agentes
 * mostra; ofertaDoLead é a mesma regra em código (o teste fixa os casos).
 */
// Conceito institucional: espelho para os prompts e o guia. Fonte: prumo/00-contexto/organizacao.md.
export const CONCEITO_PRUMO: readonly string[] = [
  'O Prumo é consultoria digital e produtos digitais. Arruma o caminho do cliente até o caixa. A entrada é pela necessidade concreta, sem uma nova marca ou diagnóstico institucional obrigatório.',
  'A experiência em produto, engenharia e design, com passagens por Caixa, Pay4Fun e Qintess, é de Rômulo Sutil Corrêa. Essas organizações não são clientes atribuídos ao Prumo.',
  'O SquadOne sustenta a operação interna. A Fonte da própria Prumo é piloto em homologação, com conclusão do aceite pendente. Vale Norte é uma demonstração fictícia. Nenhuma dessas provas comprova ganho de vendas ou economia.',
  'Íris: Em uso, diário de sessão e dossiê para clínicas de terapia, com revisão do terapeuta. A IA não pontua protocolos nem toma decisões clínicas. CRM de estamparia: Em implantação, conversas, clientes e pedidos; WhatsApp sujeito à homologação. Esses estados não são liberação de qualidade.',
  'Direção de 16/11/2026: Rômulo confirmou softban por spam após os disparos de 13/11 e autorizou a reconstrução comercial. Primeiros contatos automáticos bloqueados; reconexão não autoriza retomada. Este conceito não atesta deploy dos controles.',
  'Site/Encontrado e implantação delimitada de um fluxo comercial são hipóteses iniciais, não limite eterno do portfólio. SaaS tem avaliação dirigida, fora da aquisição ampla, com prontidão e comprador demonstrados. O fundador conduz descoberta e venda.',
  'Raio-X e Mapa são opcionais quando ajudam uma decisão suficiente. Fonte conserva método, conferência com a equipe e escopo contratado. Preços, contratos e autorizações de suporte permanecem.',
  'Permissão para material, resposta e demonstração não são venda. Separar cadastro, conversa, oportunidade, proposta, contratação e recebimento; avaliar economia com custos e horas observados, sem fundir empresas por telefone.',
]

export const REGRAS_DA_OFERTA: string[] = [
  'Começar pela necessidade e pela oferta pedida. Raio-X e Mapa são instrumentos opcionais; não impedem informar condições ou contratar um serviço simples.',
  'A oferta/canal do cadastro orienta uma hipótese de conversa, não confirma necessidade. Categoria pública, porte, ausência de URL e avaliações não comprovam problema, orçamento ou decisor.',
  'Achados do Raio-X são contexto verificável. Nota baixa ou poucas avaliações não demonstram falha de atendimento; já ter site não implica precisar de automação, anúncios ou redes.',
  'Site/Encontrado e implantação de um fluxo são as hipóteses iniciais. Não ampliar catálogo ou aquisição por inferência; outros produtos podem ganhar foco com prontidão, comprador e economia demonstrados.',
  'Responder perguntas de preço diretamente com a tabela e as condições vigentes; quando houver variação, explicar o escopo. Não exigir diagnóstico, reunião ou preenchimento completo de qualificação para responder.',
  'Interesse, licença e permissão para material não são compra. Preparar proposta quando necessidade, processo de decisão e escopo forem suficientes; não por um gostei isolado.',
  'Mapa só quando uma investigação da rotina da equipe ajudar a decisão e o interessado aceitar. A Fonte não exige Mapa prévio como etapa comercial; mantém método e conferência com a equipe. Manutenção apenas nas condições contratadas, após os ajustes incluídos.',
  'Íris e CRM de estamparia seguem conversa própria e avaliação dirigida, fora da aquisição ampla. Estado de uso/implantação não é prova de produto pronto; preservar dependências, qualidade e condições específicas.',
  'Recusa, exclusão e encerramento não recebem sugestão de abordagem. Revisar expiração histórica internamente não autoriza retomada. Primeiros contatos automáticos permanecem bloqueados.',
]

/** O serviço que resolve cada ponto do Raio-X (a regra 4 acima, em código). */
export const OFERTA_DO_ACHADO: Record<IdDoAchado, IdDoServico> = {
  'sem-site': 'encontrado',
  'site-fora-do-ar': 'encontrado',
  'site-sem-nome': 'encontrado',
  'site-e-rede-social': 'encontrado',
  'site-sem-celular-ou-whatsapp': 'encontrado',
  'sem-horario': 'encontrado',
  'fotos-de-terceiros': 'encontrado',
  'nota-baixa': 'respondido',
  'poucas-avaliacoes': 'respondido',
  'posicao-na-busca': 'anuncios',
}

const numero = (x: number) => String(x).replace('.', ',')
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`)

/** O ponto do Raio-X numa frase curta, com os números que ele traz (o que falta não é dito). */
export function fraseDoAchado(a: AchadoDoRaioX): string {
  const busca = a.consulta ? `“${a.consulta}”` : 'a busca'
  const dominio = a.dominio ? ` (${a.dominio})` : ''
  const topo = a.topoLidos && a.topoComSite
    ? `, e ${a.topoComSite} dos ${a.topoLidos} primeiros de ${busca} mostra${a.topoComSite > 1 ? 'm' : ''} site próprio` : ''
  switch (a.id) {
    case 'posicao-na-busca':
      if (a.posicao) return `${a.posicao}º lugar em ${busca}`
      return a.lidos ? `fora dos ${a.lidos} primeiros em ${busca}` : `fora dos primeiros em ${busca}`
    case 'sem-site': return `o perfil do Google não tem site${topo}`
    case 'site-fora-do-ar': return `o site do perfil${dominio} não abre${topo}`
    case 'site-sem-nome': return `o site do perfil${dominio} não leva a um site deles`
    case 'site-e-rede-social': return `o botão “Site” do Google leva para ${a.rede ?? 'uma rede social'}`
    case 'site-sem-celular-ou-whatsapp': {
      const faltas = [a.celular === false ? 'não está pronto para celular' : '', a.whatsapp === false ? 'não tem botão de WhatsApp' : ''].filter(Boolean)
      return `o site${dominio} ${faltas.length ? lista(faltas) : 'não serve a quem chega pelo celular'}`
    }
    case 'nota-baixa':
      return `nota ${a.nota !== undefined ? numero(a.nota) : 'baixa'} no Google`
        + (a.notasDoTopo ? `, contra ${lista(a.notasDoTopo.map(numero))} dos 3 primeiros de ${busca}` : '')
    case 'poucas-avaliacoes': {
      const n = a.avaliacoes === undefined ? 'poucas avaliações' : a.avaliacoes === 0 ? 'nenhuma avaliação' : `${a.avaliacoes} avaliaç${a.avaliacoes === 1 ? 'ão' : 'ões'}`
      if (a.medianaDaBusca !== undefined) return `${n} contra ${a.medianaDaBusca} no meio dos primeiros de ${busca}`
      if (a.avaliacoesDoTopo) return `${n} contra ${lista(a.avaliacoesDoTopo.map(String))} dos 3 primeiros de ${busca}`
      return `${n} no Google`
    }
    case 'sem-horario': return 'o horário de funcionamento não aparece no Google'
    case 'fotos-de-terceiros': return 'nenhuma das primeiras fotos do perfil é deles'
  }
}

/** O que oferecer a este lead agora, depois e não oferecer, com o motivo de cada um. */
export function ofertaDoLead(lead: LeadDaJornada): OfertaDoLead {
  const r: OfertaDoLead = { agora: [], depois: [], naoAgora: [], aConfirmar: [] }
  if (lead.etapa === 'perdido' || lead.resposta?.tipo === 'negativa' || lead.resposta?.tipo === 'exclusao'
    || ['recusou', 'recusou-pasta', 'sem-interesse', 'descartado', 'sem-contato', 'expirou', 'esfriou'].includes(lead.sinal)) {
    r.naoAgora.push({ id: 'raio-x', porque: 'Encerramento, recusa ou exclusão: nada a oferecer. Revisão interna não autoriza nova abordagem.' })
    return r
  }
  if (lead.etapa === 'ganho') {
    r.aConfirmar.push('Conferir escopo aceito, entrega e recebimento; manter somente o que foi contratado, sem upsell automático.')
    return r
  }
  if (!lead.spiced?.dor?.trim()) r.aConfirmar.push('Necessidade: qual problema ou entrega a empresa quer resolver? Interesse e permissão para material não comprovam compra.')
  if (lead.spiced?.decisao.decisor_confirmado !== 'sim') r.aConfirmar.push('Decisão: quem decide e qual próximo passo foi combinado?')
  r.aConfirmar.push('Escopo: confirmar entrega, dependências e condições pertinentes antes de propor. Responder perguntas de preço diretamente com as condições vigentes.')
  const funil = funilDoLead(lead)
  if (lead.produto === 'plus' && !lead.plus?.oferta) {
    r.aConfirmar.push('Plus é o canal; a oferta ainda não foi confirmada. Não presumir Site.')
  } else if (ehOfertaPropria(funil)) {
    r.depois.push({ ...OFERTA_PROPRIA_NA_JORNADA[funil] })
    r.aConfirmar.push('Qualidade e operação: conferir a versão atual e capacidade de entrega antes de ampliar a venda.')
  } else {
    r.depois.push({ id: funil === 'site' ? 'encontrado' : 'respondido', porque: funil === 'site'
      ? 'Hipótese da oferta cadastrada: Site/Encontrado, se a empresa confirmar necessidade. Não exige Raio-X; pagamento permanece após ver no ar.'
      : 'Hipótese da frente cadastrada: implantação delimitada de um fluxo, se houver problema demonstrado. Já ter site não comprova necessidade de automação.' })
    if (lead.sinal === 'diagnostico') {
      r.depois.push({ id: 'fonte', porque: 'O Mapa respondido ajuda a entender regras e rotina; avaliar Fonte somente se a necessidade justificar, preservando método e conferência com a equipe.' })
      r.depois.push({ id: 'fonte-em-dia', porque: 'Opcional após Fonte contratada e os 30 dias de ajustes, nas condições vigentes.' })
    } else if (lead.equipe === true || funil === 'prumo') {
      r.aConfirmar.push('Mapa opcional: existe problema de regras ou rotina da equipe que exige investigação? Porte sozinho não justifica convite nem Fonte.')
    }
  }
  for (const achado of lead.achados ?? []) {
    r.aConfirmar.push(`Observação pública: ${fraseDoAchado(achado)}. Confirmar relevância com a empresa; não demonstra necessidade de comprar um serviço.`)
  }
  if (!lead.achados?.length && lead.links.raioX) r.aConfirmar.push('Raio-X disponível sem achados estruturados: consultar apenas se ajudar a decisão; não é etapa obrigatória.')
  return r
}

// ------------------------------------------------------------------ a vista Jornada (o funil inteiro)

export interface LeadNoPasso<L> {
  lead: L
  proximo: ProximoDaJornada
  /** Com você e há mais dias que `paradoApos` do passo. */
  parado: boolean
}

export interface PassoDoPainel<L> {
  passo: PassoDaJornada
  leads: LeadNoPasso<L>[]
  parados: number
  /** Estoque antes do primeiro contato: a vista mostra só os primeiros. */
  fila: boolean
}

export interface PainelDaJornada<L> {
  passos: PassoDoPainel<L>[]
  /** Quantos leads em andamento (da primeira mensagem em diante) esperam cada um. */
  porQuem: Record<QuemFaz, number>
  /** Achados e Raio-X prontos: o estoque antes do primeiro contato (são centenas; não é conversa esperando ninguém). */
  naFila: number
  parados: number
}

/** O estoque antes do primeiro contato: conta à parte do "com você". */
const NA_FILA: IdDoPasso[] = ['achado', 'raio-x']

/**
 * Os leads por passo, na ordem da jornada: os parados primeiro, depois os há mais tempo no
 * passo. Ganho e Perdido entram só na contagem (a lista deles é o Funil).
 */
export function painelDaJornada<L extends LeadDaJornada & Pick<CrmLead, 'diasNaEtapa'>>(leads: L[]): PainelDaJornada<L> {
  const porQuem: Record<QuemFaz, number> = { robô: 0, você: 0, 'o dono': 0 }
  let naFila = 0
  const passos = PASSOS.map<PassoDoPainel<L>>((passo) => ({ passo, leads: [], parados: 0, fila: NA_FILA.includes(passo.id) }))
  for (const lead of leads) {
    const id = passoAtual(lead)
    const alvo = passos.find((p) => p.passo.id === id)!
    const proximo = proximoDaJornada(lead)
    const parado = proximo.quem === 'você' && alvo.passo.paradoApos !== undefined && (lead.diasNaEtapa ?? 0) >= alvo.passo.paradoApos
    alvo.leads.push({ lead, proximo, parado })
    if (parado) alvo.parados += 1
    if (NA_FILA.includes(id)) naFila += 1
    else if (id !== 'ganho' && id !== 'perdido') porQuem[proximo.quem] += 1
  }
  for (const p of passos) p.leads.sort((a, b) => Number(b.parado) - Number(a.parado) || (b.lead.diasNaEtapa ?? 0) - (a.lead.diasNaEtapa ?? 0))
  return { passos, porQuem, naFila, parados: passos.reduce((n, p) => n + p.parados, 0) }
}

// ------------------------------------------------------------------ o guia dos agentes

const celula = (t: string) => t.replace(/\|/g, '\|').replace(/\n/g, ' ')

/**
 * O guia que os agentes leem (docs/referencia/jornada-do-cliente.md), gerado daqui para nunca
 * divergir do que a Ficha mostra. Sem data nem relógio: o mesmo código dá o mesmo texto.
 */
export function guiaDaJornada(): string {
  const l: string[] = []
  l.push('# Jornada do cliente do PRUMO')
  l.push('')
  l.push('> Gerado de `src/operations/jornada.ts` e `src/operations/colinha.ts` por `npx tsx scripts/jornada-guia.ts`.')
  l.push('> Não edite à mão: mude o código e refaça (o teste `src/operations-jornada.test.ts` falha se este arquivo ficar para trás).')
  l.push('> A fonte do negócio é o repositório prumo (`00-contexto/negocio.md`); os preços valem os de `04-venda/piloto-cdl/precos.json`.')
  l.push('')
  l.push('**Leia isto antes de atender, escrever para, ou montar qualquer coisa para um lead do PRUMO.** Diz em que ordem as coisas')
  l.push('acontecem, quem faz cada passo e o que oferecer a quem. Em Vendas (`/crm`), a Ficha de cada lead mostra o passo em que ele está,')
  l.push('o próximo passo e o que oferecer, com estas mesmas regras.')
  l.push('')
  l.push('## Conceito institucional do Prumo')
  l.push('')
  CONCEITO_PRUMO.forEach((regra) => l.push(`- ${regra}`))
  l.push('')
  l.push('Fonte canônica: `prumo/00-contexto/organizacao.md`, `negocio.md` e `produtos.md`. Apresentação e provas: `prumo/04-venda/apresentacao/README.md`.')
  l.push('')
  l.push('## O desenho')
  l.push('')
  l.push('```')
  l.push(' NECESSIDADE → Conversa suficiente → Proposta com escopo → Aceite')
  l.push('                                                        ↓')
  l.push(' ENTREGA e conferência → Cobrança e recebimento → Suporte contratado')
  l.push(' Raio-X e Mapa: opcionais quando ajudam a decisão, sem passagem obrigatória.')
  l.push('```')
  l.push('')
  l.push('Íris e estamparia têm avaliação dirigida, fora da aquisição ampla. Os passos abaixo preservam o histórico das fontes; não obrigam cada oportunidade a passar por todos eles.')
  l.push('')
  l.push('## Os passos')
  l.push('')
  l.push('| # | Passo | Trilho | Quem | Como | Quando o lead está aqui | O que o tira daqui | Prazo | Blueprint |')
  l.push('|---|---|---|---|---|---|---|---|---|')
  PASSOS.forEach((p, i) => {
    const parado = p.paradoApos === undefined ? '' : `parado com ${p.paradoApos} dia${p.paradoApos === 1 ? '' : 's'} no passo`
    const prazo = [p.prazo, parado].filter(Boolean).join('; ')
    const blueprint = (p.blueprint ?? []).map((c) => `\`${c}\``).join(', ')
    l.push(`| ${i + 1} | **${p.nome}** | ${ROTULO_DO_TRILHO[p.trilho]} | ${p.quem} | ${celula(p.como)} | ${celula(p.entra)} | ${celula(p.sai)} | ${celula(prazo)} | ${blueprint} |`)
  })
  l.push('')
  l.push('## O que oferecer a quem')
  l.push('')
  REGRAS_DA_OFERTA.forEach((r, i) => l.push(`${i + 1}. ${r}`))
  l.push('')
  l.push('## O cardápio')
  l.push('')
  l.push('| Serviço | Etapa | Tipo | O que o cliente recebe | Preço (tabela) | Para quem |')
  l.push('|---|---|---|---|---|---|')
  for (const s of CARDAPIO) {
    const preco = [s.preco, s.mensal && `+ ${s.mensal}`, s.condicao && `(${s.condicao})`].filter(Boolean).join(' ')
    l.push(`| **${s.nome}** | ${s.etapa} | ${s.tipo} | ${celula(s.entrega)} | ${celula(preco)}${s.sobProposta ? ' · *sob proposta para o cliente*' : ''} | ${celula(s.paraQuem)} |`)
  }
  l.push('')
  l.push('Fora do cardápio, ofertas próprias:')
  l.push('')
  for (const o of OFERTAS_PROPRIAS) l.push(`- **${o.nome}**: ${o.entrega} ${o.paraQuem}`)
  l.push('')
  l.push('## Onde ver e onde mudar')
  l.push('')
  l.push('- **Em que passo está um lead:** a Ficha em Vendas (`/crm`, bloco "Jornada"). A etapa vem do retrato das planilhas (`server/crm.ts`, a cada 10 min).')
  l.push('- **O funil inteiro por passo** (quem espera quem, quem está parado): o filtro Passo do Funil (`/crm?ver=funil&passo=`).')
  l.push('- **O texto de cada momento** (mensagens, objeções, roteiro da conversa): o Roteiro (`/mais?abrir=roteiro`, `src/operations/colinha.ts`).')
  l.push('- **O que roda por trás de cada passo** (robôs, travas, telas, terceiros): o service blueprint, `docs/blueprint/servico.json`; a coluna Blueprint acima dá o código do passo ou do cartão.')
  l.push('- **Mudou a ordem, um passo ou uma regra de oferta:** `src/operations/jornada.ts`, depois `npx tsx scripts/jornada-guia.ts`.')
  l.push('- **Mudou um preço ou um serviço:** `prumo/04-venda/piloto-cdl/precos.json` e o caminho descrito no `CLAUDE.md` do prumo (inclui `colinha.ts`).')
  l.push('')
  return l.join('\n')
}
