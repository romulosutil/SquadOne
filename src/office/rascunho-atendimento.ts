import type { CrmLead } from '../operations/types'

// Só memória desta aba. A mensagem volta a passar pelo preparo e pelos gates do servidor.
const textos = new Map<string, { contexto: string; texto: string }>()
const chave = (lead: Pick<CrmLead, 'id'|'produto'>) => JSON.stringify([lead.produto, lead.id])
export function textoDoAtendimento(lead: Pick<CrmLead,'id'|'produto'>, contexto: string): string | undefined {
  const rascunho = textos.get(chave(lead))
  return rascunho?.contexto === contexto ? rascunho.texto : undefined
}
export function guardarTextoDoAtendimento(lead: Pick<CrmLead,'id'|'produto'>, contexto: string, texto: string): void {
  const id = chave(lead)
  textos.delete(id)
  textos.set(id, { contexto, texto })
  if (textos.size > 16) textos.delete(textos.keys().next().value!)
}
