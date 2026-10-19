import type { CrmLead } from './types'
import type { AcaoDeVenda } from './proxima-venda'

export const PREFIXO_CONFERENCIA = '[historico-conferido-v1] '
const instante = (s?: string) => Date.parse(s ?? '') || 0

export function ultimaConferencia(lead: Pick<CrmLead, 'eventos'>): string | null {
  return (lead.eventos ?? []).filter((e) => e.tipo === 'nota' && e.origem === 'manual'
    && e.texto === `${PREFIXO_CONFERENCIA}Conferi a conversa deste lead no WhatsApp.` && instante(e.em))
    .sort((a, b) => instante(b.em) - instante(a.em))[0]?.em ?? null
}

export function precisaConferirHistorico(lead: CrmLead): boolean {
  if (lead.etapa === 'novo' && !lead.marcos?.enviado && !lead.resposta && !lead.conversa) return false
  const observada = instante(lead.conversa?.ultima?.em)
  const esperado = Math.max(...[lead.resposta?.em, lead.marcos?.enviado,
    lead.marcos?.segundaEnviada, lead.marcos?.followupEnviado, lead.proposta?.em].map(instante))
  // A própria integração confirma a leitura. Uma declaração manual não é requisito.
  if ((lead.conversa?.mensagens ?? 0) > 0 && observada > 0 && observada >= esperado) return false
  const revista = ultimaConferencia(lead)
  if (!revista) return true
  const ultima = Math.max(...[lead.conversa?.ultima?.em, lead.resposta?.em, lead.marcos?.enviado,
    lead.marcos?.segundaEnviada, lead.marcos?.followupEnviado, lead.proposta?.em].map(instante))
  return instante(revista) < ultima
}

/** Contatos distintos por lead/oferta, usando o mesmo recorte do CRM. Arquivo não significa completo. */
export function coberturaDoHistorico(leads: readonly CrmLead[]) {
  const contatados = leads.filter((l) => Boolean(l.marcos?.enviado))
  const comArquivo = contatados.filter((l) => (l.conversa?.mensagens ?? 0) > 0).length
  const conferidos = contatados.filter((l) => !precisaConferirHistorico(l)).length
  return { contatados: contatados.length, comArquivo, semArquivo: contatados.length - comArquivo, conferidos }
}

export function nomeCurto(empresa: string): string {
  return empresa.length > 64 ? `${empresa.slice(0, 61).trimEnd()}…` : empresa
}

/** Mantém posição e chave da tarefa, mas não oferece texto nem confirmação de envio sem contexto. */
export function comHistoricoConferido(acao: AcaoDeVenda, lead: CrmLead | undefined): AcaoDeVenda {
  if (acao.conferirHistorico) return acao
  if (!lead || acao.primeiroContato || acao.tipo === 'desfecho' || !precisaConferirHistorico(lead)) return acao
  const { rascunho: _r, link: _l, anota: _a, copiloto: _c, ...resto } = acao
  const cobertura = lead.conversa?.mensagens ? 'O arquivo é parcial e ainda não alcançou o último evento conhecido. O time aguarda a integração.' : 'O histórico ainda não chegou pela integração. A conversa continua disponível no WhatsApp.'
  return { ...resto, conferirHistorico: true, quente: false,
    titulo: `Conferir a conversa de ${nomeCurto(lead.empresa)}`,
    porque: lead.proximoPasso?.texto ? `${lead.proximoPasso.texto} ${cobertura}` : cobertura,
    tatica: 'Leia a conversa no WhatsApp, confira o que já foi enviado e o último combinado. Só então escolha a próxima ação.' }
}
