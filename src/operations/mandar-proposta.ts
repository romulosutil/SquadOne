/**
 * PURO (16/10/2026): o "Mandar a proposta" em um toque. O diagnóstico "Por que não está vendendo"
 * mostrou o gargalo: 267 primeiros contatos, 41 respostas, 7 "quero ver", 3 receberam o link e
 * 0 propostas. A proposta era um formulário "Marcar a proposta enviada" no fim da Ficha, separado
 * do envio: ninguém marcava, e o funil não sabia que ela tinha saído. Aqui o envio e a marca são
 * o mesmo toque: o botão abre o WhatsApp com o texto da proposta e quem chama anota `proposta`.
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
import type { CrmLead } from './types'

export type LeadDaProposta = LeadDaJornada & Pick<CrmLead, 'empresa'> & Partial<Pick<CrmLead, 'abordagem'>>

/** Instante (ms) da última resposta do lead: a classificada, ou o marco quando a planilha não tem a hora. */
function instanteDaResposta(lead: LeadDaJornada): number {
  return Date.parse(lead.resposta?.em ?? lead.marcos.respondeu ?? '')
}

/**
 * A última resposta é de interesse e veio depois do link (a 2ª mensagem: demo ou Raio-X). É o
 * "gostei" e o "quanto fica": a vez é da proposta, não de mais uma pergunta. O "quanto fica" o
 * n8n às vezes classifica como neutra; a pergunta de preço reconhecida pela colinha conta igual.
 * Só Site e PRUMO (e o Plus pela oferta deles): Iris e estamparias não têm cardápio nem 2ª mensagem.
 */
export function gostouDepoisDoLink(lead: LeadDaJornada): boolean {
  if (lead.etapa !== 'contato' || lead.proposta) return false
  const funil = funilDoLead(lead)
  if (funil !== 'site' && funil !== 'prumo') return false
  const link = Date.parse(lead.marcos.segundaEnviada ?? '')
  const resposta = instanteDaResposta(lead)
  if (!Number.isFinite(link) || !Number.isFinite(resposta) || resposta <= link) return false
  const tipo = lead.resposta?.tipo
  return tipo === 'interesse' || (tipo === 'neutra' && objecoesNoTexto(lead.resposta?.trecho).some((o) => o.id === 'quanto-custa'))
}

/**
 * Entre o "respondeu" e a proposta, sem o "gostei" registrado: depois do link, na conversa ou no
 * Mapa. A Ficha oferece o "Mandar a proposta" ao lado do passo (secundário): a conversa pode ter
 * andado por telefone, e o n8n só vê o WhatsApp.
 */
export function cabeProposta(lead: LeadDaJornada): boolean {
  if (lead.etapa !== 'contato' || lead.proposta) return false
  const funil = funilDoLead(lead)
  if (funil !== 'site' && funil !== 'prumo') return false
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
export function soPrecosDoCardapio(texto: string): boolean {
  const permitidos = new Set(PRECOS_DO_CARDAPIO)
  return precosNoTexto(texto).every((p) => permitidos.has(p.replace(/\s+/, ' ')))
}

/**
 * PURO. A proposta pronta para o toque: o texto do copiloto quando ele tem itens, senão o da
 * colinha. `null` sem WhatsApp do lead, sem texto (Iris, estamparias) ou com preço fora do cardápio.
 */
export function propostaDeUmToque(lead: LeadDaProposta, sugestao?: Pick<SugestaoDoCopiloto, 'proposta'> | null): PropostaDeUmToque | null {
  const funil = funilDoLead(lead)
  if (funil !== 'site' && funil !== 'prumo') return null
  const doCopiloto = sugestao ? rascunhoDaProposta(lead.empresa, sugestao) : ''
  const texto = doCopiloto || textoBaseDaProposta(lead)
  if (!texto || !soPrecosDoCardapio(texto)) return null
  const url = linkDoWhatsApp(lead.links.whatsapp, texto)
  if (!url) return null
  return { texto, url, origem: doCopiloto ? 'copiloto' : 'colinha', completar: /\[[^\]]+\]/.test(texto) }
}
