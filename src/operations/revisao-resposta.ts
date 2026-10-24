import type { CrmLead } from './types'

export const PEDIDO_DE_RESPOSTA_REVISADA = 'Prepare uma resposta curta e útil para este lead e sugira o próximo passo para avançar a decisão de compra. Use a última evidência disponível, deixe claro o que preciso conferir no WhatsApp e o avanço esperado. Entregue um cartão de mensagem (ou a sugestão guardada do copiloto) e um cartão do próximo passo para eu revisar. Não invente interesse nem data; sem compromisso datado, proponha uma nota com a condição do próximo passo. Não execute nenhuma ação.'

/** Recência comercial, sem incluir contadores de tempo que mudam a cada leitura. */
export async function hashDoContexto(lead: CrmLead): Promise<string> {
  const texto = JSON.stringify([lead.id, lead.produto, lead.etapa, lead.subEtapa, lead.resposta,
    lead.conversa, lead.eventos, lead.proximoPasso, lead.proposta, lead.atendimentoComercial ?? null, lead.links.whatsapp,
    lead.links.raioX, lead.links.site, lead.notas, lead.achados, lead.equipe, lead.porte])
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')
}

export function impedimentoDaMensagem(texto: string): string {
  if (!texto.trim()) return 'Escreva a mensagem antes de abrir o WhatsApp.'
  if (texto.length > 2000) return 'Reduza a mensagem para até 2.000 caracteres.'
  if (/\[(?:telefone|e-mail|DOC|URL|link(?: do WhatsApp| do Raio-X)?|PREENCHER)\]|\{[^}]+\}/i.test(texto)) return 'Complete os campos ocultos ou pendentes antes de enviar ao cliente.'
  return ''
}

/** Só o destino de conversa; nunca o link rastreado que registra envio. */
export function whatsappParaRevisao(destino: string | undefined, texto: string): string {
  if (impedimentoDaMensagem(texto)) return ''
  try {
    const u = new URL(destino ?? '')
    if (u.protocol !== 'https:' || !['wa.me', 'www.wa.me'].includes(u.hostname) || u.username || u.password || !/^\/\d{10,15}\/?$/.test(u.pathname)) return ''
    return `https://wa.me/${u.pathname.replace(/\D/g, '')}?text=${encodeURIComponent(texto.trim())}`
  } catch { return '' }
}

/** Material do próprio lead, sem links de ação, credenciais ou endereço local. */
export function linkDoRaioXParaMensagem(destino: string | undefined): string {
  try {
    const u = new URL(destino ?? '')
    if (u.protocol !== 'https:' || u.username || u.password || /^(?:localhost|127\.|10\.|169\.254\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(u.hostname) || !/\/raio-x\/?$/.test(u.pathname) || u.search || u.hash) return ''
    return u.href
  } catch { return '' }
}
