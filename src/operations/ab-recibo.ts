/**
 * PURO: o teste do follow-up para quem não manda recibo de leitura (16/10/2026, OT-10 do blueprint).
 *
 * Desde 15/10/2026 o follow-up do 3º dia só vai a quem LEU a primeira mensagem (server/crm.ts):
 * insistir com quem nem abriu é o que mais vira denúncia de spam, e o número já levou restrição.
 * Mas só 25 % dos enviados mostram leitura (a referência é ~60 %): muita gente desliga o recibo, e
 * os outros 75 % nunca têm segunda chance. O Rômulo escolheu testar antes de mudar a regra:
 *  - só o Site, só quem foi enviado a partir de INICIO_DO_TESTE_DO_RECIBO e não tem recibo;
 *  - metade por sorteio fixo pela chave do lead (o mesmo hash do A/B do vídeo, com outro sal): o
 *    braço `teste` recebe o follow-up do 3º dia como quem leu; o `controle` segue sem;
 *  - a leitura compara quem respondeu depois do 3º dia em cada braço (Fisher exato) e conta quem
 *    pediu para não receber mais: se a exclusão subir no teste, a regra fica como estava.
 * Nada aqui envia: o follow-up continua saindo pelo toque do Rômulo, dentro da trava de ritmo.
 */
import { fisherExato, hashDoLead } from './ab-video'
import type { CrmLead } from './types'

export const SAL_DO_TESTE_DO_RECIBO = 'squadone-recibo-1'
/** 17/10/2026, 00:00 em São Paulo: quem foi enviado antes segue a regra antiga. */
export const INICIO_DO_TESTE_DO_RECIBO = Date.parse('2026-10-17T03:00:00Z')
/** A cadência de 19/10 passa a incluir todos; o experimento anterior fica como histórico. */
export const FIM_DO_TESTE_DO_RECIBO = Date.parse('2026-10-19T03:00:00Z')
export const DIAS_ATE_O_FOLLOWUP_DO_TESTE = 3
/** Sem isto em cada braço, não há taxa (a mesma régua dos outros A/B da Central). */
export const MINIMO_POR_BRACO_DO_RECIBO = 30

export type BracoDoRecibo = 'teste' | 'controle'

/** Hash par = teste (recebe o follow-up sem recibo). */
export function bracoDoRecibo(chave: string): BracoDoRecibo {
  return hashDoLead(chave, SAL_DO_TESTE_DO_RECIBO) % 2 === 0 ? 'teste' : 'controle'
}

/** O lead entra no teste? Só Site, enviado desde o início e sem recibo de leitura. */
export function entraNoTesteDoRecibo(p: { produto: string; enviado?: number; visto?: number }): boolean {
  return p.produto === 'site' && p.enviado !== undefined && p.enviado >= INICIO_DO_TESTE_DO_RECIBO && p.enviado < FIM_DO_TESTE_DO_RECIBO && p.visto === undefined
}

export interface LinhaDoRecibo { n: number; responderam: number; pediramParaParar: number }
export interface LeituraDoRecibo {
  teste: LinhaDoRecibo
  controle: LinhaDoRecibo
  /** Fisher exato bilateral de respondeu × não respondeu; null antes do mínimo por braço. */
  p: number | null
}

type LeadDoRecibo = Pick<CrmLead, 'testeDoRecibo' | 'marcos' | 'resposta'>

/**
 * Só conta quem já passou do 3º dia (antes disso o braço teste nem recebeu o follow-up) e a resposta
 * depois dele: o que respondeu antes do follow-up não mede o follow-up.
 */
export function leituraDoTesteDoRecibo(leads: readonly LeadDoRecibo[], agora: number): LeituraDoRecibo | null {
  const linha = (): LinhaDoRecibo => ({ n: 0, responderam: 0, pediramParaParar: 0 })
  const r = { teste: linha(), controle: linha() }
  for (const l of leads) {
    if (!l.testeDoRecibo) continue
    const enviado = Date.parse(l.marcos.enviado ?? '')
    if (!Number.isFinite(enviado)) continue
    const terceiroDia = enviado + DIAS_ATE_O_FOLLOWUP_DO_TESTE * 86_400_000
    if (agora < terceiroDia) continue
    const b = r[l.testeDoRecibo]
    b.n++
    const respondeu = Date.parse(l.marcos.respondeu ?? '')
    if (Number.isFinite(respondeu) && respondeu >= terceiroDia) {
      b.responderam++
      if (l.resposta?.tipo === 'exclusao') b.pediramParaParar++
    }
  }
  if (!r.teste.n && !r.controle.n) return null
  const chega = r.teste.n >= MINIMO_POR_BRACO_DO_RECIBO && r.controle.n >= MINIMO_POR_BRACO_DO_RECIBO
  const p = chega ? fisherExato(r.teste.responderam, r.teste.n - r.teste.responderam, r.controle.responderam, r.controle.n - r.controle.responderam) : null
  return { ...r, p }
}
