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

import { CARDAPIO, objecoesNoTexto, type IdDoServico, type ServicoDoCardapio } from './colinha'
import type { CrmLead, CrmProduto } from './types'

// ------------------------------------------------------------------ etapas

export type IdDoPasso =
  | 'achado' | 'raio-x' | 'primeiro-contato' | 'resposta' | 'segunda'
  | 'conversa' | 'mapa-convite' | 'mapa' | 'devolutiva'
  | 'proposta' | 'ganho' | 'perdido'

/** Por onde o passo anda: o tronco comum, os dois trilhos (combináveis) e o fecho. */
export type Trilho = 'tronco' | 'fora' | 'dentro' | 'fecho'

export const ROTULO_DO_TRILHO: Record<Trilho, string> = {
  tronco: 'Todo lead',
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
}

// A ordem do array é a da jornada (a Ficha e o guia mostram nesta ordem).
export const PASSOS: PassoDaJornada[] = [
  {
    id: 'achado',
    nome: 'Achado',
    trilho: 'tronco',
    quem: 'robô',
    como: 'Caçador (n8n 01, 06:00: Google Places + nota do Gemini); Iris e estamparias pelos caçadores próprios (rodados à mão); Plus pelo Catálogo de Negócios Maçônicos',
    entra: 'O caçador gravou a empresa na planilha (ou, no Plus, no leads.json).',
    sai: 'O Raio-X (ou o site) publicado vai para "Raio-X pronto".',
  },
  {
    id: 'raio-x',
    nome: 'Raio-X pronto',
    trilho: 'tronco',
    quem: 'robô',
    como: 'raio-x.py (11:15 e 17:15) e o Balcão (n8n 03, de hora em hora) marcam "pronto" e sorteiam a mensagem; no PRUMO, o Raio-X à mão (projeto prumo-raio-x)',
    entra: 'Raio-X publicado e o lead marcado "pronto", ainda sem a primeira mensagem.',
    sai: 'A primeira mensagem enviada leva para "Primeira mensagem".',
    servico: 'raio-x',
  },
  {
    id: 'primeiro-contato',
    nome: 'Primeira mensagem',
    trilho: 'tronco',
    quem: 'você',
    como: 'Enviar um por um no CRM, pelo WhatsApp (trava de ritmo: 1 a cada 4 min, 8 por hora, teto do dia); o observador marca envio e leitura sozinho',
    entra: 'Enviada (ou convite enviado), sem resposta de gente.',
    sai: 'Resposta de gente leva para "Respondeu". Sem resposta: follow-up no 3º dia (só para quem leu, no mesmo dia) e Perdido em 7 dias.',
    prazo: 'follow-up no 3º dia; Perdido no 7º sem mensagem do lead',
  },
  {
    id: 'resposta',
    paradoApos: 1,
    nome: 'Respondeu',
    trilho: 'tronco',
    quem: 'você',
    como: 'O observador lê a resposta e o Gemini classifica (interesse, neutra, negativa, robô, exclusão); você responde com a colinha',
    entra: 'Respondeu e a 2ª mensagem ainda não saiu.',
    sai: 'Interesse: a 2ª mensagem (o Raio-X ou o demo, com o preço do Encontrado). Negativa: a resposta da objeção. Exclusão: agradecer e apagar no mesmo dia.',
    prazo: 'interesse respondido em até 2 h',
  },
  {
    id: 'segunda',
    paradoApos: 2,
    nome: 'Viu o Raio-X',
    trilho: 'tronco',
    quem: 'você',
    como: 'A 2ª mensagem do CRM (anotada sozinha ao tocar); "Gerar demo" quando ele quer ver o site (20 a 40 min, até 4 por dia)',
    entra: 'A 2ª mensagem saiu (Raio-X, demo ou os dois, com o preço do Encontrado).',
    sai: 'Abre um trilho, ou os dois: por fora, a conversa sobre os produtos; por dentro, o convite para o Mapa (só empresa com equipe).',
    prazo: 'proposta em até 24 h depois de cada "gostei"',
  },
  {
    id: 'conversa',
    paradoApos: 2,
    nome: 'Conversa',
    trilho: 'fora',
    quem: 'você',
    como: 'Conversa de 20 a 45 min (roteiro em prumo/04-venda/roteiro-conversa-45min.md); marque no Calendar e salve o próximo passo na Ficha',
    entra: 'Quer o site, ou o Raio-X mostrou um trecho do caminho que ele quer arrumar.',
    sai: 'Proposta por escrito em até 24 h.',
    prazo: 'proposta em até 24 h depois da conversa',
  },
  {
    id: 'mapa-convite',
    nome: 'Convite para o Mapa',
    trilho: 'dentro',
    quem: 'você',
    como: 'Convite da colinha ("Mapa grátis: 16 perguntas, uns 10 minutos"); só empresa com umas 8 pessoas ou mais',
    entra: 'Viu o Raio-X, a empresa tem equipe e o Mapa ainda não foi respondido.',
    sai: 'O dono responde as 16 perguntas no formulário: "Mapa respondido".',
    servico: 'mapa',
  },
  {
    id: 'mapa',
    paradoApos: 2,
    nome: 'Mapa respondido',
    trilho: 'dentro',
    quem: 'você',
    como: 'O formulário dispara o fluxo "PRUMO — Diagnóstico do dono" e o prumo-mapa gera o rascunho em PDF em ~/prumo-entregas; você completa os [PREENCHER]',
    entra: 'O dono respondeu as 16 perguntas (sinal "diagnóstico" no CRM).',
    sai: 'Documento completo e a devolutiva de 45 min marcada.',
    servico: 'mapa',
  },
  {
    id: 'devolutiva',
    paradoApos: 2,
    nome: 'Devolutiva do Mapa',
    trilho: 'dentro',
    quem: 'você',
    como: 'Conversa de 45 min sobre o documento (o documento é do dono, contrate ou não)',
    entra: 'Devolutiva marcada como próximo passo na Ficha.',
    sai: 'Proposta da Fonte (e dos produtos que o Mapa apontou) em até 24 h.',
    prazo: 'proposta em até 24 h depois da devolutiva',
    servico: 'fonte',
  },
  {
    id: 'proposta',
    paradoApos: 3,
    nome: 'Proposta enviada',
    trilho: 'fecho',
    quem: 'você',
    como: 'proposta-modelo do prumo (04-venda) com o cardápio; marque "Proposta enviada" na Ficha',
    entra: 'Proposta marcada na Ficha.',
    sai: 'Fechou (página do lead) ou recusou; sem decisão, cobre com data no próximo passo.',
  },
  {
    id: 'ganho',
    nome: 'Fechou',
    trilho: 'fecho',
    quem: 'você',
    como: 'Encontrado: no ar e pago depois de ver; Fonte: 2 semanas, 50/50; depois, as mensalidades',
    entra: 'Fechou (ou Concluído na planilha).',
    sai: 'Entrega feita e a mensalidade correndo.',
  },
  {
    id: 'perdido',
    nome: 'Perdido',
    trilho: 'fecho',
    quem: 'robô',
    como: 'Recusou, pediu para apagar, 7 dias sem mensagem do lead ou sem contato fácil',
    entra: 'Saiu do funil.',
    sai: 'Volta sozinho se ele escrever; um próximo passo ou a proposta o trazem de volta.',
  },
]

export const passoDaJornada = (id: IdDoPasso): PassoDaJornada => PASSOS.find((p) => p.id === id)!

// ------------------------------------------------------------------ ofertas fora do cardápio

/** Iris e o CRM de estamparia não estão no cardápio do PRUMO (são produtos próprios, sem preço aqui). */
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
    entrega: 'Sistema para clínicas de terapia (agenda, fichas e prontuário), já em produção; cadastro grátis e 7 dias de teste.',
    paraQuem: 'Psicologia e terapias (aba Clínicas). A conversa segue à mão: não há 2ª mensagem aprovada.',
  },
  {
    id: 'crm-estamparia',
    nome: 'CRM de estamparia',
    entrega: 'O CRM da Silmer adaptado para outra estamparia. Fase B0: só valida se há demanda, ainda sem preço nem instalação.',
    paraQuem: 'Estamparias e confecções (aba Estamparias). Nada de prometer prazo ou preço antes da fase B1.',
  },
]

export type IdDaOferta = IdDoServico | IdDaOfertaPropria

export function nomeDaOferta(id: IdDaOferta): string {
  return CARDAPIO.find((s) => s.id === id)?.nome ?? OFERTAS_PROPRIAS.find((o) => o.id === id)!.nome
}

export const servicoDoCardapio = (id: IdDoServico): ServicoDoCardapio => CARDAPIO.find((s) => s.id === id)!

// ------------------------------------------------------------------ o lead na jornada

/** O pedaço do CrmLead que a jornada lê (o teste monta à mão). */
export type LeadDaJornada = Pick<CrmLead, 'produto' | 'etapa' | 'sinal' | 'marcos' | 'links' | 'followupHoje'>
  & Partial<Pick<CrmLead, 'resposta' | 'proposta' | 'proximoPasso' | 'plus' | 'diasParaSair' | 'interesseParado'>>
  & {
    /**
     * A empresa tem equipe (umas 8 pessoas ou mais)? Decide o trilho de dentro. O CRM ainda não sabe
     * (a planilha não tem porte): ausente, o Mapa aparece "a confirmar"; `false` o tira.
     */
    equipe?: boolean
  }

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
  if (funil === 'iris' || funil === 'estampa') return ['achado', 'primeiro-contato', 'resposta', 'conversa', 'proposta', 'ganho']
  return [...tronco, 'conversa', ...(trilhoDeDentro(lead) ? ['mapa-convite', 'mapa', 'devolutiva'] as IdDoPasso[] : []), 'proposta', 'ganho']
}

/**
 * O trilho de dentro (Mapa → Fonte) vale para o PRUMO com equipe, ou com o porte ainda a confirmar.
 * O Site antes da venda é empresa pequena demais para o Mapa (colinha.ts), a não ser que o Mapa já
 * tenha sido respondido.
 */
function trilhoDeDentro(lead: LeadDaJornada): boolean {
  if (lead.sinal === 'diagnostico') return true
  return funilDoLead(lead) === 'prumo' && lead.equipe !== false
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
        return funil === 'iris' || funil === 'estampa' ? 'conversa' : 'resposta'
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
  if (lead.proximoPasso?.texto && lead.etapa !== 'ganho' && lead.etapa !== 'perdido') {
    return { acao: lead.proximoPasso.texto, quem: 'você', quando: lead.proximoPasso.data, marcadoAMao: true }
  }
  const funil = funilDoLead(lead)
  const tipo = lead.resposta?.tipo
  const dentro = trilhoDeDentro(lead)
  switch (passoAtual(lead)) {
    case 'achado':
      return funil === 'prumo' || funil === 'iris' || funil === 'estampa'
        ? { acao: 'Revisar o lead na planilha e mandar o convite quando ele estiver bom', quem: 'você' }
        : { acao: 'Esperar o Raio-X: o raio-x.py publica às 11:15 e às 17:15', quem: 'robô' }
    case 'raio-x':
      return lead.sinal === 'publicado'
        ? { acao: 'Esperar o Balcão marcar "pronto" (de hora em hora)', quem: 'robô' }
        : { acao: 'Mandar a primeira mensagem (Enviar um por um)', quem: 'você', quando: 'no expediente, no ritmo da trava' }
    case 'primeiro-contato':
      if (lead.followupHoje) return { acao: 'Mandar o follow-up de hoje', quem: 'você', quando: 'hoje' }
      return {
        acao: 'Esperar a resposta; o follow-up aparece na Hoje no 3º dia',
        quem: 'o dono',
        ...(lead.diasParaSair !== undefined ? { quando: lead.diasParaSair <= 1 ? 'vai para Perdido amanhã' : `vai para Perdido em ${lead.diasParaSair} dias` } : {}),
      }
    case 'resposta':
      if (tipo === 'exclusao') return { acao: 'Agradecer e apagar o lead', quem: 'você', quando: 'hoje' }
      if (tipo === 'negativa') return { acao: 'Responder a objeção com a colinha (sem insistir depois de um "não")', quem: 'você' }
      if (tipo === 'interesse' || lead.interesseParado) {
        return {
          acao: funil === 'prumo' ? 'Mandar o Raio-X (2ª mensagem)' : 'Mandar a 2ª mensagem: o Raio-X ou o demo, com o preço do Encontrado (sem demo, toque "Gerar demo")',
          quem: 'você',
          quando: 'em até 2 h',
        }
      }
      return { acao: 'Seguir a conversa com a colinha', quem: 'você' }
    case 'segunda':
      return dentro
        ? { acao: 'Convidar para o Mapa (16 perguntas) e, se ele quiser o site ou o WhatsApp, marcar a conversa', quem: 'você', quando: 'proposta em até 24 h depois do "gostei"' }
        : { acao: 'Marcar a conversa (ou fechar o Encontrado, se ele pediu para pôr no ar)', quem: 'você', quando: 'proposta em até 24 h depois do "gostei"' }
    case 'conversa':
      return { acao: 'Marcar a conversa e mandar a proposta', quem: 'você', quando: 'proposta em até 24 h depois da conversa' }
    case 'mapa':
      return { acao: 'Completar o rascunho do Mapa e marcar a devolutiva de 45 min', quem: 'você' }
    case 'mapa-convite':
    case 'devolutiva':
      return { acao: 'Mandar a proposta da Fonte (e dos produtos que o Mapa apontou)', quem: 'você', quando: 'em até 24 h' }
    case 'proposta':
      return { acao: 'Cobrar a decisão e salvar a data no próximo passo', quem: 'você' }
    case 'ganho':
      return { acao: 'Entregar e começar a mensalidade', quem: 'você' }
    case 'perdido':
      return { acao: 'Nada a mandar, a não ser que ele volte a escrever', quem: 'o dono' }
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
export const REGRAS_DA_OFERTA: string[] = [
  'O Raio-X (grátis) é a porta de todo lead, com ou sem site. Até ele ver o Raio-X, não se oferece mais nada.',
  'Depois do Raio-X há dois trilhos, e eles se somam: por fora (Encontrado, Respondido e Acompanhado, Anúncios, Redes) e por dentro (Mapa → Fonte → Manutenção). Um lead com equipe pode fazer o Mapa e, ao mesmo tempo, querer o site.',
  'Sem site (Site antes da venda, Plus com oferta "site"): o Encontrado vem logo depois do Raio-X; é o que o demo e a 2ª mensagem vendem, e paga só depois de ver no ar.',
  'Com site (serviços PRUMO, Plus com oferta "prumo"): Respondido e Acompanhado, Anúncios ou Redes, conforme o que o Raio-X mostrou. O Encontrado só se o site atual não aparece no Google ou ele pedir um novo.',
  'O Mapa (grátis) só para empresa com umas 8 pessoas ou mais, depois do Raio-X (ou direto pela CDL). Sem saber o porte, confirme antes de convidar.',
  'A Fonte só existe depois do Mapa; a Manutenção, só depois da Fonte e dos 30 dias de ajustes.',
  'Respondido e Acompanhado, Fonte e Manutenção não têm preço no frio: saem por escrito na proposta, em até 24 h.',
  'Disse "já temos site": não insista no Encontrado; o Raio-X mostra o resto do caminho (WhatsApp, avaliações).',
  'Iris e CRM de estamparia são ofertas próprias, fora do cardápio: não se misturam com Raio-X nem Mapa.',
]

/** O que oferecer a este lead agora, depois e não oferecer, com o motivo de cada um. */
export function ofertaDoLead(lead: LeadDaJornada): OfertaDoLead {
  const funil = funilDoLead(lead)
  const r: OfertaDoLead = { agora: [], depois: [], naoAgora: [], aConfirmar: [] }
  if (lead.etapa === 'perdido') {
    r.naoAgora.push({ id: 'raio-x', porque: 'Lead encerrado: nada a oferecer, a não ser que ele volte a escrever.' })
    return r
  }
  if (funil === 'iris' || funil === 'estampa') {
    const id: IdDaOfertaPropria = funil === 'iris' ? 'iris' : 'crm-estamparia'
    r.agora.push({ id, porque: funil === 'iris' ? 'Clínica de terapia: o Iris, com o teste de 7 dias.' : 'Estamparia: só validar se ele quer o CRM (fase B0, sem preço).' })
    r.naoAgora.push({ id: 'raio-x', porque: 'Iris e estamparias não passam pelo Raio-X nem pelo Mapa.' })
    return r
  }

  // Viu o Raio-X = a 2ª mensagem saiu (é ela que o leva) ou o lead já passou dela.
  const antesDoRaioX: IdDoPasso[] = ['achado', 'raio-x', 'primeiro-contato', 'resposta']
  const viuRaioX = Boolean(lead.marcos.segundaEnviada) || !antesDoRaioX.includes(passoAtual(lead))
  const comSite = funil === 'prumo'
  const disseQueTemSite = objecoesNoTexto(lead.resposta?.trecho).some((o) => o.id === 'ja-tem-site')
  const mapaRespondido = lead.sinal === 'diagnostico'

  // 1. A porta.
  if (!viuRaioX) r.agora.push({ id: 'raio-x', porque: 'Ainda não viu o Raio-X: é a porta de todo lead, grátis.' })

  // 2. Por fora.
  const fora: OfertaSugerida[] = []
  if (!comSite && !disseQueTemSite) {
    fora.push({ id: 'encontrado', porque: 'Não tem site: o demo e a 2ª mensagem vendem o Encontrado (paga só depois de ver no ar).' })
  } else {
    fora.push({ id: 'respondido', porque: disseQueTemSite ? 'Disse que já tem site: o resto do caminho é o WhatsApp.' : 'Já tem site: o próximo trecho é quem chama no WhatsApp ser respondido.' })
  }
  ;(viuRaioX ? r.agora : r.depois).push(...fora.map((o) => (viuRaioX ? o : { ...o, porque: `Depois do Raio-X. ${o.porque}` })))
  if (!comSite && !disseQueTemSite) r.depois.push({ id: 'respondido', porque: 'Com o site no ar, se ele perde cliente no WhatsApp (demora, fora do horário, orçamento que some).' })
  if (comSite || disseQueTemSite) r.depois.push({ id: 'encontrado', porque: 'Só se o site atual não aparece no Google ou ele pedir um novo.' })
  r.depois.push({ id: 'anuncios', porque: 'Com site e perfil do Google em dia, se o Raio-X mostra pouca gente chegando.' })
  r.depois.push({ id: 'redes', porque: 'Se o Raio-X mostra rede social parada.' })

  // 3. Por dentro.
  if (mapaRespondido) {
    r.agora.push({ id: 'fonte', porque: 'Respondeu o Mapa: depois da devolutiva, a proposta da Fonte.' })
    r.depois.push({ id: 'fonte-em-dia', porque: 'Depois da Fonte e dos 30 dias de ajustes (opcional).' })
  } else if (funil === 'prumo' && lead.equipe !== false) {
    const mapa: OfertaSugerida = { id: 'mapa', porque: 'Empresa com equipe: o Mapa (grátis) mostra por dentro o que o Raio-X mostrou por fora.' }
    ;(viuRaioX && lead.equipe === true ? r.agora : r.depois).push(viuRaioX ? mapa : { ...mapa, porque: `Depois do Raio-X. ${mapa.porque}` })
    if (lead.equipe === undefined) r.aConfirmar.push('Porte: a empresa tem umas 8 pessoas ou mais? Decide o convite para o Mapa.')
    r.depois.push({ id: 'fonte', porque: 'Só depois do Mapa.' })
  } else {
    r.naoAgora.push({ id: 'mapa', porque: funil === 'site' ? 'Site antes da venda: empresa pequena, o Mapa não tem para onde levar.' : 'Empresa sem equipe: a Fonte não se paga.' })
  }
  if (comSite && !disseQueTemSite) r.aConfirmar.push('O site atual aparece no Google? Se não, o Encontrado entra.')
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
}

export interface PainelDaJornada<L> {
  passos: PassoDoPainel<L>[]
  /** Quantos leads abertos estão esperando cada um. */
  porQuem: Record<QuemFaz, number>
  parados: number
}

/**
 * Os leads por passo, na ordem da jornada: os parados primeiro, depois os há mais tempo no
 * passo. Ganho e Perdido entram só na contagem (a lista deles é o Funil).
 */
export function painelDaJornada<L extends LeadDaJornada & Pick<CrmLead, 'diasNaEtapa'>>(leads: L[]): PainelDaJornada<L> {
  const porQuem: Record<QuemFaz, number> = { robô: 0, você: 0, 'o dono': 0 }
  const passos = PASSOS.map<PassoDoPainel<L>>((passo) => ({ passo, leads: [], parados: 0 }))
  for (const lead of leads) {
    const id = passoAtual(lead)
    const alvo = passos.find((p) => p.passo.id === id)!
    const proximo = proximoDaJornada(lead)
    const parado = proximo.quem === 'você' && alvo.passo.paradoApos !== undefined && (lead.diasNaEtapa ?? 0) >= alvo.passo.paradoApos
    alvo.leads.push({ lead, proximo, parado })
    if (parado) alvo.parados += 1
    if (id !== 'ganho' && id !== 'perdido') porQuem[proximo.quem] += 1
  }
  for (const p of passos) p.leads.sort((a, b) => Number(b.parado) - Number(a.parado) || (b.lead.diasNaEtapa ?? 0) - (a.lead.diasNaEtapa ?? 0))
  return { passos, porQuem, parados: passos.reduce((n, p) => n + p.parados, 0) }
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
  l.push('acontecem, quem faz cada passo e o que oferecer a quem. No CRM (`/crm`), a Ficha de cada lead mostra o passo em que ele está,')
  l.push('o próximo passo e o que oferecer, com estas mesmas regras.')
  l.push('')
  l.push('## O desenho')
  l.push('')
  l.push('```')
  l.push(' TODO LEAD     Achado → Raio-X pronto → Primeira mensagem → Respondeu → Viu o Raio-X')
  l.push('                                                                           │')
  l.push('                     ┌─────────────────────────────────────────────────────┤  (um, outro ou os dois)')
  l.push('                     ▼                                                     ▼')
  l.push(' POR FORA      Conversa (Encontrado, Respondido,           POR DENTRO   Convite para o Mapa → Mapa respondido')
  l.push('               Anúncios, Redes)                            (só equipe)  → Devolutiva de 45 min (→ Fonte)')
  l.push('                     │                                                     │')
  l.push('                     └──────────────────────────┬──────────────────────────┘')
  l.push('                                                ▼')
  l.push(' FECHO                       Proposta (em até 24 h) → Fechou → mensalidades')
  l.push('```')
  l.push('')
  l.push('Iris e estamparias andam num caminho curto: Achado → Primeira mensagem (convite) → Respondeu → Conversa → Proposta → Fechou.')
  l.push('')
  l.push('## Os passos')
  l.push('')
  l.push('| # | Passo | Trilho | Quem | Como | Quando o lead está aqui | O que o tira daqui | Prazo |')
  l.push('|---|---|---|---|---|---|---|---|')
  PASSOS.forEach((p, i) => {
    const parado = p.paradoApos === undefined ? '' : `parado com ${p.paradoApos} dia${p.paradoApos === 1 ? '' : 's'} no passo`
    const prazo = [p.prazo, parado].filter(Boolean).join('; ')
    l.push(`| ${i + 1} | **${p.nome}** | ${ROTULO_DO_TRILHO[p.trilho]} | ${p.quem} | ${celula(p.como)} | ${celula(p.entra)} | ${celula(p.sai)} | ${celula(prazo)} |`)
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
  l.push('- **Em que passo está um lead:** a Ficha no CRM (`/crm`, bloco "Jornada"). A etapa vem do retrato das planilhas (`server/crm.ts`, a cada 10 min).')
  l.push('- **O funil inteiro por passo** (quem espera quem, quem está parado): a vista Jornada (`/crm?ver=jornada`).')
  l.push('- **O texto de cada momento** (mensagens, objeções, roteiro da conversa): a Colinha (`/crm?ver=colinha`, `src/operations/colinha.ts`).')
  l.push('- **Mudou a ordem, um passo ou uma regra de oferta:** `src/operations/jornada.ts`, depois `npx tsx scripts/jornada-guia.ts`.')
  l.push('- **Mudou um preço ou um serviço:** `prumo/04-venda/piloto-cdl/precos.json` e o caminho descrito no `CLAUDE.md` do prumo (inclui `colinha.ts`).')
  l.push('')
  return l.join('\n')
}
