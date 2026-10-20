/**
 * PURO (16/10/2026): o "Mandar a proposta" em um toque. O diagnóstico "Por que não está vendendo"
 * mostrou o gargalo: 267 primeiros contatos, 41 respostas, 7 "quero ver", 3 receberam o link e
 * 0 propostas. A proposta era um formulário "Marcar a proposta enviada" no fim da Ficha, separado
 * do envio: ninguém marcava, e o funil não sabia que ela tinha saído. O botão abre o WhatsApp com o
 * texto da proposta. Desde a regra [abrir-nao-envia] (18/10/2026) abrir NÃO anota nada: a proposta só
 * é marcada no "Enviei a proposta", que o Rômulo toca depois de enviar (MissaoDaConversa, ou
 * "Proposta enviada" no Desfecho da Ficha), porque abrir o WhatsApp não prova que a mensagem saiu.
 *
 * Nada é enviado sem o toque do Rômulo: isto só monta o texto e o link do wa.me; o WhatsApp abre
 * com a mensagem para ele revisar e mandar (decisão de 16/10/2026: semi-automático).
 *
 * De onde vem o texto:
 *  1. Do copiloto, quando a sugestão guardada tem itens de proposta: os ITENS vêm do modelo, mas
 *     nome, entrega e preço saem do cardápio (colinha.ts), nunca do modelo.
 *  2. Sem o copiloto (desligado, sem sugestão, ou sugestão sem itens), o texto base da colinha
 *     (o momento "Proposta" do roteiro), preenchido com o nome do lead.
 * Em qualquer caso, um "R$" que não está no cardápio faz o texto não sair (`null`): melhor o
 * botão sumir que mandar um preço inventado.
 */
import { CARDAPIO, PRECOS_DO_CARDAPIO, linkDoWhatsApp, objecoesNoTexto, passo, precosNoTexto, preencher } from './colinha'
import type { SugestaoDoCopiloto } from './copiloto'
import { funilDoLead, passoAtual, type LeadDaJornada } from './jornada'
import { pedeMaterial } from './marcadores-da-conversa'
import type { CrmLead } from './types'
import { qualificadoParaProposta } from './spiced'
import { textoDasFaixasIris, PRECOS_CANONICOS_IRIS } from './precos-iris'

export type LeadDaProposta = LeadDaJornada & Pick<CrmLead, 'empresa'> & Partial<Pick<CrmLead, 'abordagem'>>

/** Instante (ms) da última resposta do lead: a classificada, ou o marco quando a planilha não tem a hora. */
function instanteDaResposta(lead: LeadDaJornada): number {
  return Date.parse(lead.resposta?.em ?? lead.marcos.respondeu ?? '')
}

/**
 * O instante (ms) do material que o lead já recebeu de nós, em qualquer das cinco linhas; NaN = nenhum
 * registrado. É o último de dois marcos reais: `marcos.segundaEnviada` (a 2ª mensagem anotada, ou o link
 * visto na conversa) e `conversa.linkEm` (o link ou a mídia nossa, "[vídeo]", "[documento]", "[imagem]").
 * Iris e estamparias não têm 2ª mensagem (jornada.ts): o material delas é o vídeo ou o documento mandado
 * à mão, que só a conversa guardada enxerga. Antes (19/10/2026, auditoria da Fase 2) o gatilho lia só
 * `segundaEnviada` e o teste fixava esse marco nas cinco linhas: a trava SPICED parecia valer em todas,
 * mas Iris, Estamparia e o Plus dessas ofertas nunca chegavam ao "Marque 10 minutos".
 */
export function instanteDoMaterial(lead: LeadDaJornada): number {
  const marcos = [lead.marcos.segundaEnviada, lead.conversa?.linkEm].map((v) => Date.parse(v ?? '')).filter(Number.isFinite)
  return marcos.length ? Math.max(...marcos) : NaN
}

/** As linhas sem 2ª mensagem: o convite abre a conversa e o material (vídeo, documento) vai à mão. */
const sem2aMensagem = (lead: LeadDaJornada): boolean => {
  const funil = funilDoLead(lead)
  return funil === 'iris' || funil === 'estampa'
}

/**
 * A última resposta é de interesse e veio depois do material (a 2ª mensagem: demo ou Raio-X; em Iris e
 * estamparias, o vídeo ou documento mandado, ver `instanteDoMaterial`). É o "gostei" e o "quanto fica":
 * a proposta exige antes dor, impacto e decisor confirmados. O "quanto fica" o n8n às vezes classifica
 * como neutra; a pergunta de preço reconhecida pela colinha conta igual.
 * As cinco linhas usam a mesma qualificação; Iris e estamparias têm condições comerciais próprias.
 * A licença depois do material ("pode mandar" a "posso te mandar a proposta?") também (pedeMaterial): até
 * 17/10/2026 ela era gravada como interesse e já abria este passo.
 *
 * Escolha conservadora (19/10/2026), só para as linhas sem 2ª mensagem e só quando NENHUM material foi
 * registrado: o "quero ver" e a licença não bastam (são o pedido do material, que ainda não saiu, e o
 * cartão certo é mandá-lo); vale apenas a pergunta de preço depois do convite, que é sinal de compra e
 * não pode ser respondida com número antes de dor, impacto e decisor. Nunca abre proposta sozinha: ela
 * continua atrás de `qualificadoParaProposta`.
 */
export function indicouInteresseDepoisDoLink(lead: LeadDaJornada): boolean {
  if (lead.etapa !== 'contato' || lead.proposta) return false
  if (interlocutorSemDecisao(lead)) return false
  const resposta = instanteDaResposta(lead)
  if (!Number.isFinite(resposta)) return false
  const tipo = lead.resposta?.tipo
  const perguntouPreco = tipo !== 'bot' && tipo !== 'negativa' && tipo !== 'exclusao' && tipo !== 'licenca'
    && objecoesNoTexto(lead.resposta?.trecho).some((o) => o.id === 'quanto-custa')
  const material = instanteDoMaterial(lead)
  if (Number.isFinite(material)) {
    if (resposta <= material) return false
    return pedeMaterial(lead.resposta) || (tipo === 'neutra' && objecoesNoTexto(lead.resposta?.trecho).some((o) => o.id === 'quanto-custa'))
  }
  if (!sem2aMensagem(lead)) return false
  const convite = Date.parse(lead.marcos.enviado ?? '')
  return Number.isFinite(convite) && resposta > convite && perguntouPreco
}

/** A conversa com recepção/robô ainda precisa chegar a quem decide, mesmo com dados confirmados antes. */
export function interlocutorSemDecisao(lead: LeadDaJornada): boolean {
  const ultima = lead.conversa?.ultima
  return lead.resposta?.tipo === 'bot' || Boolean(ultima?.direcao === 'entrada' && (ultima.papel === 'recepcao' || ultima.papel === 'robo'))
}

export function gostouDepoisDoLink(lead: LeadDaJornada): boolean {
  return qualificadoParaProposta(lead) && indicouInteresseDepoisDoLink(lead)
}

/**
 * Entre o "respondeu" e a proposta, sem o "gostei" registrado: depois do link, na conversa ou no
 * Mapa. A Ficha oferece o "Mandar a proposta" ao lado do passo (secundário): a conversa pode ter
 * andado por telefone, e o n8n só vê o WhatsApp.
 */
export function cabeProposta(lead: LeadDaJornada): boolean {
  if (lead.etapa !== 'contato' || lead.proposta || !qualificadoParaProposta(lead) || interlocutorSemDecisao(lead)) return false
  return ['segunda', 'conversa', 'mapa'].includes(passoAtual(lead))
}

// ------------------------------------------------------------------ o texto

/** Os itens que se pagam: o diagnóstico (Raio-X, Mapa) é grátis e não entra numa proposta. */
const PAGOS = new Set<string>(CARDAPIO.filter((s) => s.tipo !== 'diagnostico').map((s) => s.id))

/**
 * O preço como vai na proposta escrita: valor e mensalidade do cardápio, sem a `condicao` (que
 * mistura o que se diz ao cliente com nota interna, como "nunca no WhatsApp frio"). Nos serviços
 * sob proposta o valor da tabela é a base: sai "a partir de", como no roteiro da colinha.
 */
function precoNaProposta(s: (typeof CARDAPIO)[number]): string {
  const valor = [s.preco, s.mensal && `+ ${s.mensal}`].filter(Boolean).join(' ')
  return s.sobProposta ? `a partir de ${valor}` : valor
}

/**
 * PURO. O texto da proposta para o WhatsApp a partir dos itens do copiloto. Só itens pagos do
 * cardápio; sem nenhum, vazio (quem chama cai no texto da colinha).
 */
export function rascunhoDaProposta(empresa: string, sugestao: Pick<SugestaoDoCopiloto, 'proposta'>): string {
  const itens = sugestao.proposta.itens.flatMap((i) => {
    const s = CARDAPIO.find((c) => c.id === i.id)
    return s && PAGOS.has(s.id) ? [s] : []
  })
  if (!itens.length) return ''
  const linhas = [`Como combinamos, segue a proposta para ${empresa.trim()}:`, '']
  for (const s of itens) {
    linhas.push(`■ ${s.nome}`, `→ ${s.entrega}`, `→ Investimento: ${precoNaProposta(s)}`, '')
  }
  linhas.push('O valor fecha por escrito antes de começar. Se fizer sentido, me diga e combinamos a data de início.')
  return linhas.join('\n')
}

/**
 * PURO. O texto base da colinha (o momento "Proposta"): Site, o Encontrado; PRUMO depois do Mapa,
 * a Fonte; o resto do PRUMO, o Respondido. Os colchetes ([dia], [o maior vazamento]) ficam: a
 * Ficha mostra o texto antes do toque e pede para completar.
 */
export function textoBaseDaProposta(lead: LeadDaProposta): string {
  const funil = funilDoLead(lead)
  if (funil === 'iris') return `Como combinamos, segue o rascunho da Iris para ${lead.empresa.trim()}:\n\n${textoDasFaixasIris()}\n\nEscopo e início: [confirmar com a clínica antes de fechar por escrito].`
  if (funil === 'estampa') {
    const produto = 'CRM de estamparia'
    return `Como combinamos, segue o rascunho para ${lead.empresa.trim()}:\n\n${produto}\nEscopo: [confirmar a entrega combinada].\nInvestimento: [preencher com as condições aprovadas do catálogo desta oferta].\nInício: [confirmar dia].\n\nVamos conferir esses pontos antes de fechar por escrito?`
  }
  const id = funil === 'site' ? 'proposta-encontrado' : lead.sinal === 'diagnostico' ? 'proposta-fonte' : 'proposta-respondido'
  const trecho = passo('proposta').trechos.find((t) => t.id === id)
  return trecho ? preencher(trecho.texto, lead) : ''
}

export interface PropostaDeUmToque {
  texto: string
  /** O wa.me do lead com o texto: o toque abre o WhatsApp, nunca envia sozinho. */
  url: string
  origem: 'copiloto' | 'colinha'
  /** O texto tem colchetes para completar antes de enviar. */
  completar: boolean
}

/** Todo "R$" do texto está no cardápio. */
export function soPrecosDoCardapio(texto: string, funil?: string): boolean {
  const permitidos = new Set(funil === 'iris' ? PRECOS_CANONICOS_IRIS : PRECOS_DO_CARDAPIO)
  return precosNoTexto(texto).every((p) => permitidos.has(p.replace(/\s+/, ' ')))
}

/**
 * PURO. A proposta pronta para o toque: o texto do copiloto quando ele tem itens, senão o da
 * colinha. `null` sem qualificação, sem WhatsApp ou com preço fora do cardápio.
 * Iris e estamparias recebem rascunho com condições por completar, sem valores de outro produto.
 */
export function propostaDeUmToque(lead: LeadDaProposta, sugestao?: Pick<SugestaoDoCopiloto, 'proposta'> | null): PropostaDeUmToque | null {
  if (!cabeProposta(lead)) return null
  const funil = funilDoLead(lead)
  const doCopiloto = sugestao && (funil === 'site' || funil === 'prumo') ? rascunhoDaProposta(lead.empresa, sugestao) : ''
  const texto = doCopiloto || textoBaseDaProposta(lead)
  if (!texto || !soPrecosDoCardapio(texto, funil)) return null
  const url = linkDoWhatsApp(lead.links.whatsapp, texto)
  if (!url) return null
  return { texto, url, origem: doCopiloto ? 'copiloto' : 'colinha', completar: /\[[^\]]+\]/.test(texto) }
}
