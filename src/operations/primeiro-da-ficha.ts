/**
 * PURO (17/10/2026, AC-22): o primeiro contato de um lead Novo, enviado da própria Ficha.
 *
 * A Ficha de um lead Novo dizia "Mandar a primeira mensagem pela Próxima venda" e tinha o botão ali
 * mesmo; fora do expediente ou com o ritmo segurando, o botão sumia e o primário caía em "Abrir a
 * conversa no WhatsApp", que abria o WhatsApp sem trava nenhuma. Agora o primário de um Novo é sempre
 * o link de primeiro contato (o envio do Site/Plus, ou o convite do PRUMO, Iris e estamparias), com as
 * mesmas travas da Próxima venda: o horário (o "Liberar" do dia, liberados.ts) e o ritmo
 * (trava-de-ritmo.ts, contado no servidor por /crm/venda/primeiro). Travado, o botão continua à vista,
 * desabilitado, com o motivo em poucas palavras: sumir escondia que havia uma ação e por que esperar.
 *
 * O reenvio do só-robô também é primeiro contato, mas o lead já está Em contato e o passo é o
 * follow-up: continua como era (some com a trava e o aviso diz por quê).
 */
import { acaoDoLead, type AcaoDeVenda } from './proxima-venda'
import { motivoCurtoDoRitmo, type EstadoDoRitmo } from './trava-de-ritmo'
import type { CrmGrupoHoje, CrmItemHoje, CrmLead, CrmVisao } from './types'

export interface PrimeiroDaFicha {
  /** A chave da ação na Ficha (CrmFicha.vue): o envio ou o convite. */
  chave: 'enviar' | 'convite'
  href: string
  rotulo: string
  /** Dá para tocar agora. */
  pode: boolean
  /** Por que não, em poucas palavras, ao lado do botão desabilitado; vazio quando pode. */
  motivo: string
  /** Só o horário segura: o "Liberar" fica ao lado do botão (o ritmo não tem "Liberar"). */
  pedeLiberar: boolean
}

export interface TravasDoPrimeiro {
  /** O aviso de horário está de pé (avisoDeHorario não é null): fora do expediente de venda. */
  foraDoExpediente: boolean
  /** O "Liberar" de hoje para este lead (liberados.ts). */
  liberado: boolean
  ritmo: Pick<EstadoDoRitmo, 'motivo' | 'ate' | 'enviadosHoje' | 'teto'>
}

/**
 * PURO. A Ficha oferece o primeiro contato? Só a um lead Novo com o link de envio ou de convite. O ritmo
 * vem antes do horário: ele não se libera, e oferecer o "Liberar" com o ritmo segurando seria pedir um
 * toque que não destrava nada.
 */
export function primeiroContatoDaFicha(lead: Pick<CrmLead, 'etapa' | 'links'>, travas: TravasDoPrimeiro): PrimeiroDaFicha | null {
  if (lead.etapa !== 'novo') return null
  const base = lead.links.enviar ? { chave: 'enviar' as const, href: lead.links.enviar, rotulo: 'Enviar a primeira mensagem' }
    : lead.links.convite ? { chave: 'convite' as const, href: lead.links.convite, rotulo: 'Enviar o convite' }
    : null
  if (!base) return null
  if (travas.ritmo.motivo) return { ...base, pode: false, motivo: motivoCurtoDoRitmo(travas.ritmo), pedeLiberar: false }
  if (travas.foraDoExpediente && !travas.liberado) return { ...base, pode: false, motivo: 'Fora do expediente de venda', pedeLiberar: true }
  return { ...base, pode: true, motivo: '', pedeLiberar: false }
}

/**
 * PURO. A ação da fila para o "Agora" da Ficha. Um Novo que não está no grupo de envio da Hoje (o Plus
 * depois dos 10 primeiros, LIMITE_DO_PLUS_NA_HOJE) não tinha ação, e a Ficha dizia "Nada para fazer";
 * com o link de primeiro contato, ganha a mesma ação que a fila daria (fraseDaAcao, a tática do
 * primeiro contato), montada como um item do grupo "enviar".
 */
export function acaoDaFicha(
  visao: Pick<CrmVisao, 'hoje' | 'leads'> | null | undefined, lead: CrmLead, agora: number, primeiro: PrimeiroDaFicha | null,
  sugestao?: Parameters<typeof acaoDoLead>[3],
): AcaoDeVenda | null {
  const daFila = acaoDoLead(visao, lead.id, agora, sugestao)
  if (daFila || !primeiro) return daFila
  const item: CrmItemHoje = { leadId: lead.id, acao: '', detalhe: '', ordem: 0, links: [{ rotulo: primeiro.rotulo, url: primeiro.href }] }
  const grupo: CrmGrupoHoje = { id: 'enviar', titulo: '', explicacao: '', itens: [item] }
  return acaoDoLead({ leads: [lead], hoje: [grupo] }, lead.id, agora)
}
