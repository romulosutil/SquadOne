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

import { REGRAS_DO_RITMO } from './trava-de-ritmo'
import { caminhoDaAba } from './vendas-abas'
import { CARDAPIO, objecoesNoTexto, type IdDoServico, type ServicoDoCardapio } from './colinha'
import type { AchadoDoRaioX, CrmLead, CrmProduto, IdDoAchado } from './types'

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
    como: 'Caçador (n8n 01, 06:00: Google Places + nota do Gemini); Iris e estamparias pelos caçadores próprios (dias úteis, 9h, ligados em 16/10/2026, pausados em 17/10; caem na Triagem de Primeiros contatos); Plus pelo Catálogo de Negócios Maçônicos',
    entra: 'O caçador gravou a empresa na planilha (ou, no Plus, no leads.json).',
    sai: 'O Raio-X (ou o site) publicado vai para "Raio-X pronto".',
    blueprint: ['SITE-1', 'OFERTAS-1'],
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
    blueprint: ['SITE-2'],
  },
  {
    id: 'primeiro-contato',
    nome: 'Primeira mensagem',
    trilho: 'tronco',
    quem: 'você',
    como: `O time comercial (só o Site em pronto), a Ficha do lead ou o "Envie para X" do Telegram, pelo WhatsApp, no expediente e na trava de ritmo (intervalo mínimo de ${Math.round(REGRAS_DO_RITMO.intervaloMs / 60_000)} min, ${REGRAS_DO_RITMO.porHora} por hora móvel; teto diário vigente mostrado na Central); o observador marca envio e leitura sozinho`,
    entra: 'Enviada (ou convite enviado), sem resposta de gente.',
    sai: 'Resposta de gente leva para "Respondeu". Sem resposta: follow-up no 3º dia (só para quem leu, no mesmo dia). Vendas mostra a saída por prazo no 7º dia; a planilha marca expirado no 7º, junto.',
    prazo: 'follow-up no 3º dia; saída por prazo em Vendas em 7 dias; expiração da planilha também em 7 dias',
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
    sai: 'Interesse: a 2ª mensagem (o Raio-X ou o demo, com o preço do Encontrado). Negativa: a resposta da objeção. Exclusão: agradecer e apagar no mesmo dia.',
    prazo: 'interesse respondido em até 2 h',
    blueprint: ['SITE-4', 'OFERTAS-4'],
  },
  {
    id: 'segunda',
    paradoApos: 2,
    nome: 'Recebeu a 2ª mensagem',
    trilho: 'tronco',
    quem: 'você',
    como: 'A 2ª mensagem de Vendas (o observador do WhatsApp a marca quando sai); "Gerar demo" quando ele quer ver o site (20 a 40 min depois do toque)',
    entra: 'A 2ª mensagem saiu (Raio-X, demo ou os dois, com o preço do Encontrado).',
    sai: 'Abre um trilho, ou os dois: por fora, a conversa sobre os produtos; por dentro, o convite para o Mapa (só empresa com equipe).',
    prazo: 'proposta em até 24 h depois de cada "gostei"',
    blueprint: ['SITE-5', 'PRUMO-2'],
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
    blueprint: ['PRUMO-2-P1', 'OFERTAS-5'],
  },
  {
    id: 'mapa-convite',
    nome: 'Convite para o Mapa',
    trilho: 'dentro',
    quem: 'você',
    como: 'Convite do Roteiro ("Mapa grátis: 16 perguntas, uns 10 minutos"); só empresa com umas 8 pessoas ou mais',
    entra: 'Recebeu a 2ª mensagem, a empresa tem equipe e o Mapa ainda não foi respondido.',
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
    sai: 'Proposta da Fonte (e dos produtos que o Mapa apontou) em até 24 h.',
    prazo: 'proposta em até 24 h depois da devolutiva',
    servico: 'fonte',
    blueprint: ['PRUMO-4'],
  },
  {
    id: 'proposta',
    paradoApos: 3,
    nome: 'Proposta enviada',
    trilho: 'fecho',
    quem: 'você',
    como: 'proposta-modelo do prumo (04-venda) com o cardápio; marque "Proposta enviada" na Ficha',
    entra: 'Proposta marcada na Ficha.',
    sai: 'Ganhou (na Ficha ou na página do lead) ou recusou; sem decisão, cobre com data no próximo passo.',
    blueprint: ['SITE-7', 'PRUMO-5'],
  },
  {
    id: 'ganho',
    nome: 'Ganho',
    trilho: 'fecho',
    quem: 'você',
    como: 'Encontrado: no ar e pago depois de ver; Fonte: 2 semanas, 50/50; depois, as mensalidades',
    entra: 'Ganhou (ou Concluído na Etapa da planilha).',
    sai: 'Entrega feita e a mensalidade correndo.',
    blueprint: ['SITE-7-C1', 'PRUMO-5-C1'],
  },
  {
    id: 'perdido',
    nome: 'Perdido',
    trilho: 'fecho',
    quem: 'robô',
    como: 'Recusou, pediu para apagar, 7 dias sem mensagem do lead ou sem contato fácil',
    entra: 'Saiu do funil.',
    sai: 'Volta sozinho se ele escrever; um próximo passo ou a proposta o trazem de volta.',
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
    entrega: 'Sistema para clínicas de terapia (agenda, fichas e prontuário), já em produção; cadastro grátis e 7 dias de teste.',
    paraQuem: 'Psicologia e terapias (aba Clínicas). A conversa segue à mão: não há 2ª mensagem aprovada.',
  },
  {
    id: 'crm-estamparia',
    nome: 'CRM de estamparia',
    entrega: 'O CRM da Silmer adaptado para outra estamparia, produto pronto (decisão de 19/10/2026). Escopo e condições comerciais próprios, sem preço no cardápio do Site/PRUMO.',
    paraQuem: 'Estamparias e confecções (aba Estamparias). Confirmar escopo e condições próprias, sem inventar prazo ou preço.',
  },
]

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
        ? { acao: 'Revisar o lead na Triagem e mandar o convite', quem: 'você' }
        : { acao: 'Esperar o Raio-X, que sai às 11:15 e às 17:15', quem: 'robô' }
    case 'raio-x':
      return lead.sinal === 'publicado'
        ? { acao: 'Esperar o Balcão marcar "pronto", de hora em hora', quem: 'robô' }
        // A Ficha tem o próprio botão (AC-22, 17/10/2026): "pela Próxima venda" mandava para outro lugar.
        : { acao: 'Mandar a primeira mensagem', quem: 'você', quando: 'no expediente, no ritmo da trava' }
    case 'primeiro-contato':
      if (lead.followupHoje) return { acao: 'Mandar o follow-up de hoje', quem: 'você', quando: 'hoje' }
      return {
        acao: `Esperar a resposta; o follow-up aparece em ${caminhoDaAba('afazer')} no 3º dia`,
        quem: 'o dono',
        ...(lead.diasParaSair !== undefined ? { quando: lead.diasParaSair <= 1 ? 'vai para Perdido amanhã' : `vai para Perdido em ${lead.diasParaSair} dias` } : {}),
      }
    case 'resposta':
      if (tipo === 'exclusao') return { acao: 'Agradecer e apagar o lead', quem: 'você', quando: 'hoje' }
      if (tipo === 'negativa') return { acao: 'Responder a objeção com o Roteiro, sem insistir depois de um "não"', quem: 'você' }
      // A licença (17/10/2026) não é "quero ver": só o material autorizado, sem preço.
      if (tipo === 'licenca') return { acao: 'Mandar o material que ele deixou mandar, sem preço, e depois perguntar o que achou', quem: 'você', quando: 'hoje' }
      if (tipo === 'interesse' || lead.interesseParado) {
        return {
          acao: funil === 'prumo' ? 'Mandar o Raio-X na 2ª mensagem' : 'Mandar a 2ª mensagem com o Raio-X ou o demo e o preço do Encontrado',
          quem: 'você',
          quando: 'em até 2 h',
        }
      }
      return { acao: 'Seguir a conversa com o Roteiro', quem: 'você' }
    case 'segunda':
      return dentro
        ? { acao: 'Convidar para o Mapa e, se ele quiser o site ou o WhatsApp, marcar a conversa', quem: 'você', quando: 'proposta em até 24 h depois do "gostei"' }
        : { acao: 'Marcar a conversa, ou fechar o Encontrado se ele pediu para pôr no ar', quem: 'você', quando: 'proposta em até 24 h depois do "gostei"' }
    case 'conversa':
      return { acao: 'Marcar a conversa e mandar a proposta', quem: 'você', quando: 'proposta em até 24 h depois da conversa' }
    case 'mapa':
      return { acao: 'Completar o rascunho do Mapa e marcar a devolutiva de 45 min', quem: 'você' }
    case 'mapa-convite':
    case 'devolutiva':
      return { acao: 'Mandar a proposta da Fonte e dos produtos que o Mapa apontou', quem: 'você', quando: 'em até 24 h' }
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
  'O que o Raio-X achou decide a ordem e o porquê: a oferta que resolve o ponto de mais peso vem primeiro, citando o número ("Raio-X: 12 avaliações contra 60 no meio dos primeiros de “dentista em Anápolis”"). Sem os achados em Vendas (Raio-X anterior a 15/10/2026 ou feito à mão sem eles), vale a ordem de sempre e o Raio-X aberto decide.',
  'Ponto de site ou de perfil (sem site, site fora do ar ou sem o nome deles, botão “Site” levando para rede social, site sem celular ou WhatsApp, horário que não aparece, fotos que não são deles) → Encontrado. Nota baixa ou poucas avaliações → Respondido e Acompanhado (cliente respondido e acompanhado é o que vira avaliação). Fora do topo da busca → Anúncios, só com site e perfil em dia; antes, o Encontrado.',
  'Sem site (Site antes da venda, Plus com oferta "site"): o Encontrado vem logo depois do Raio-X; é o que o demo e a 2ª mensagem vendem, e paga só depois de ver no ar.',
  'Com site (serviços PRUMO, Plus com oferta "prumo"): Respondido e Acompanhado, Anúncios ou Redes, conforme o que o Raio-X mostrou. O Encontrado só se o Raio-X achou um ponto de site ou de perfil, ou ele pedir um novo.',
  'O Mapa (grátis) só para empresa com umas 8 pessoas ou mais, depois do Raio-X (ou direto pela CDL). O porte vem do CNPJ do site (EPP ou DEMAIS, o alvo do filtro de porte do Lead Scout); sem ele, confirme antes de convidar.',
  'A Fonte só existe depois do Mapa; a Manutenção, só depois da Fonte e dos 30 dias de ajustes.',
  'Respondido e Acompanhado, Fonte e Manutenção não têm preço no frio: saem por escrito na proposta, em até 24 h.',
  'Disse "já temos site": não insista no Encontrado; o Raio-X mostra o resto do caminho (WhatsApp, avaliações). Se o Raio-X achou um ponto no site dele, mostre o ponto e deixe o Encontrado para quando ele quiser arrumar.',
  'Iris e CRM de estamparia são ofertas próprias, fora do cardápio: não se misturam com Raio-X nem Mapa.',
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

/** O que cada serviço faz pelo ponto que o Raio-X achou (vai depois do "Raio-X: …"). */
const RESOLVE: Partial<Record<IdDoServico, string>> = {
  encontrado: 'O Encontrado resolve: site no ar com o endereço deles no perfil, perfil do Google revisado e botão de WhatsApp (paga só depois de ver no ar).',
  respondido: 'Cliente respondido na hora e acompanhado depois é o que vira avaliação: Respondido e Acompanhado.',
  anuncios: 'Anúncios põem a empresa no alto da busca enquanto o perfil sobe.',
}

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
    r.agora.push({ id, porque: funil === 'iris' ? 'Clínica de terapia: o Iris, com o teste de 7 dias.' : 'Estamparia: CRM de estamparia pronto; confirmar a necessidade e as condições próprias antes da proposta.' })
    r.naoAgora.push({ id: 'raio-x', porque: 'Iris e estamparias não passam pelo Raio-X nem pelo Mapa.' })
    return r
  }

  // Recebeu a 2ª mensagem = ela saiu (é ela que o leva) ou o lead já passou dela.
  const antesDoRaioX: IdDoPasso[] = ['achado', 'raio-x', 'primeiro-contato', 'resposta']
  const viuRaioX = Boolean(lead.marcos.segundaEnviada) || !antesDoRaioX.includes(passoAtual(lead))
  const comSite = funil === 'prumo'
  const disseQueTemSite = objecoesNoTexto(lead.resposta?.trecho).some((o) => o.id === 'ja-tem-site')
  const semSite = !comSite && !disseQueTemSite
  const mapaRespondido = lead.sinal === 'diagnostico'

  // O que o Raio-X achou, por serviço. A página já vem na ordem de peso: o primeiro achado de cada serviço dá a ordem.
  const achados = lead.achados ?? []
  const doRaioX = (s: IdDoServico) => {
    const deste = achados.filter((a) => OFERTA_DO_ACHADO[a.id] === s)
    return deste.length ? `Raio-X: ${deste.map(fraseDoAchado).join('; ')}.` : ''
  }
  const achou = (s: IdDoServico) => achados.some((a) => OFERTA_DO_ACHADO[a.id] === s)
  const pesoNoRaioX = (id: IdDaOferta) => {
    const i = achados.findIndex((a) => OFERTA_DO_ACHADO[a.id] === id)
    return i < 0 ? achados.length : i
  }

  // 1. A porta.
  if (!viuRaioX) r.agora.push({ id: 'raio-x', porque: 'Ainda não viu o Raio-X: é a porta de todo lead, grátis.' })

  // 2. Por fora. `agora`: entra assim que ele vê o Raio-X.
  const fora: Array<OfertaSugerida & { agora: boolean }> = []
  if (semSite) {
    fora.push({ id: 'encontrado', agora: true, porque: achou('encontrado') ? `${doRaioX('encontrado')} ${RESOLVE.encontrado}` : 'Não tem site: o demo e a 2ª mensagem vendem o Encontrado (paga só depois de ver no ar).' })
    fora.push({ id: 'respondido', agora: false, porque: achou('respondido') ? `Com o site no ar. ${doRaioX('respondido')} ${RESOLVE.respondido}` : 'Com o site no ar, se ele perde cliente no WhatsApp (demora, fora do horário, orçamento que some).' })
  } else {
    fora.push({
      id: 'respondido',
      agora: true,
      porque: achou('respondido') ? `${doRaioX('respondido')} ${RESOLVE.respondido}`
        : disseQueTemSite ? 'Disse que já tem site: o resto do caminho é o WhatsApp.' : 'Já tem site: o próximo trecho é quem chama no WhatsApp ser respondido.',
    })
    if (!achou('encontrado')) fora.push({ id: 'encontrado', agora: false, porque: 'Só se o site atual não aparece no Google ou ele pedir um novo.' })
    else if (disseQueTemSite) fora.push({ id: 'encontrado', agora: false, porque: `Disse que já tem site, mas o Raio-X achou um ponto nele. ${doRaioX('encontrado')} Mostre o ponto; o Encontrado só se ele quiser arrumar.` })
    else fora.push({ id: 'encontrado', agora: true, porque: `${doRaioX('encontrado')} ${RESOLVE.encontrado}` })
  }
  // Anúncios só com site e perfil em dia: com ponto de site ou de perfil, o Encontrado vem antes.
  const sitePorArrumar = semSite || achou('encontrado')
  fora.push(achou('anuncios')
    ? { id: 'anuncios', agora: !sitePorArrumar, porque: `${sitePorArrumar ? 'Depois do site e do perfil em dia. ' : ''}${doRaioX('anuncios')} ${RESOLVE.anuncios}` }
    : { id: 'anuncios', agora: false, porque: 'Com site e perfil do Google em dia, se o Raio-X mostra pouca gente chegando.' })
  fora.push({ id: 'redes', agora: false, porque: 'Se a rede social está parada (o Raio-X automático não confere as redes).' })
  // Os de agora primeiro; em cada grupo, o do ponto de mais peso no Raio-X; empate, a ordem acima.
  const ordenados = fora.map((o, i) => ({ o, i }))
    .sort((a, b) => Number(b.o.agora) - Number(a.o.agora) || pesoNoRaioX(a.o.id) - pesoNoRaioX(b.o.id) || a.i - b.i)
  for (const { o: { agora, ...oferta } } of ordenados) {
    if (agora && viuRaioX) r.agora.push(oferta)
    else r.depois.push(agora ? { ...oferta, porque: `Depois do Raio-X. ${oferta.porque}` } : oferta)
  }

  // 3. Por dentro.
  if (mapaRespondido) {
    r.agora.push({ id: 'fonte', porque: 'Respondeu o Mapa: depois da devolutiva, a proposta da Fonte.' })
    r.depois.push({ id: 'fonte-em-dia', porque: 'Depois da Fonte e dos 30 dias de ajustes (opcional).' })
  } else if (trilhoDeDentro(lead)) {
    const comEquipe = lead.equipe === true
    const mapa: OfertaSugerida = {
      id: 'mapa',
      porque: comEquipe
        ? `Empresa com equipe (${lead.porte ? `porte ${lead.porte} pelo CNPJ, o alvo do Mapa` : 'confirmada'}): o Mapa (grátis) mostra por dentro o que o Raio-X mostrou por fora.`
        : 'Se tiver equipe (umas 8 pessoas ou mais): o Mapa (grátis) mostra por dentro o que o Raio-X mostrou por fora.',
    }
    ;(viuRaioX && comEquipe ? r.agora : r.depois).push(viuRaioX ? mapa : { ...mapa, porque: `Depois do Raio-X. ${mapa.porque}` })
    if (!comEquipe) r.aConfirmar.push('Porte: a empresa tem umas 8 pessoas ou mais? Só com equipe vale o convite para o Mapa.')
    r.depois.push({ id: 'fonte', porque: 'Só depois do Mapa.' })
  } else {
    r.naoAgora.push({ id: 'mapa', porque: funil === 'site' ? 'Site antes da venda: empresa pequena, o Mapa não tem para onde levar.' : 'Empresa sem equipe: a Fonte não se paga.' })
  }

  // 4. O que falta saber.
  if (!achados.length && lead.links.raioX) {
    r.aConfirmar.push('O que o Raio-X achou não chegou a Vendas: abra o Raio-X e ofereça primeiro o que resolve o ponto de mais peso.')
  }
  if (comSite && !disseQueTemSite && !achados.length) r.aConfirmar.push('O site atual aparece no Google? Se não, ofereça o Encontrado.')
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
  l.push('## O desenho')
  l.push('')
  l.push('```')
  l.push(' TODO LEAD     Achado → Raio-X pronto → Primeira mensagem → Respondeu → Recebeu a 2ª mensagem')
  l.push('                                                                           │')
  l.push('                     ┌─────────────────────────────────────────────────────┤  (um, outro ou os dois)')
  l.push('                     ▼                                                     ▼')
  l.push(' POR FORA      Conversa (Encontrado, Respondido,           POR DENTRO   Convite para o Mapa → Mapa respondido')
  l.push('               Anúncios, Redes)                            (só equipe)  → Devolutiva de 45 min (→ Fonte)')
  l.push('                     │                                                     │')
  l.push('                     └──────────────────────────┬──────────────────────────┘')
  l.push('                                                ▼')
  l.push(' FECHO                       Proposta (em até 24 h) → Ganho → mensalidades')
  l.push('```')
  l.push('')
  l.push('Iris e estamparias andam num caminho curto: Achado → Primeira mensagem (convite) → Respondeu → Conversa → Proposta → Ganho.')
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
