/** Autoridade humana na aba CRM. O campo humano é atestado, nunca autenticação de uma API. */
export const PREFIXO_RESPONSAVEL = '[responsavel-conversa-v2] '
export interface IdentidadeConversa { conta: 'prumo'; canal: 'whatsapp'; conversa: string }
export interface ResponsavelConversa extends IdentidadeConversa {
  v: 2; id: string; responsavel: 'romulo' | 'time'; data: string; motivo: string; humano: true; anterior: string | null
}
export interface LeadComResponsavel {
  id: string
  links: { whatsapp?: string }
  eventos: readonly { tipo: string; origem: string; em: string; registroTexto?: string; texto?: string }[]
}
export interface ProjecaoResponsavel {
  identidade: IdentidadeConversa | null
  estado: 'definido' | 'ausente' | 'bloqueado'
  motivo: string
  registro?: ResponsavelConversa
}
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const idValido = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{3,80}$/.test(v)
const instante = (v: unknown, agora: number): v is string => typeof v === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && Date.parse(v) <= agora
  && new Date(v).toISOString().slice(0,19) === v.slice(0,19)

/** Mesma equivalência DDD+8 de chaveDoNumero; DDI explícito não brasileiro é recusado. */
export function chaveDaConversaBrasil(bruto: unknown): string | null {
  if (typeof bruto !== 'string' || !bruto.trim()) return null
  let s = bruto.trim(), internacional = s.startsWith('+')
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      if (u.protocol !== 'https:' || !['wa.me','www.wa.me'].includes(u.hostname) || u.username || u.password || !/^\/\d{12,13}\/?$/.test(u.pathname)) return null
      s = u.pathname.slice(1).replace(/\/$/,''); internacional = true
    } catch { return null }
  }
  if (!/^\+?[\d ()-]+$/.test(s)) return null
  let d = s.replace(/\D/g,'')
  if (internacional || d.length > 11) {
    if (!d.startsWith('55') || ![12,13].includes(d.length)) return null
    d = d.slice(2)
  }
  if (!/^([1-9]\d)\d{8,9}$/.test(d) || d.length === 11 && d[2] !== '9') return null
  return d.slice(0,2) + d.slice(-8)
}
export function identidadeDaConversa(lead: Pick<LeadComResponsavel,'links'>): IdentidadeConversa | null {
  const conversa = chaveDaConversaBrasil(lead.links.whatsapp)
  return conversa ? { conta: 'prumo', canal: 'whatsapp', conversa } : null
}
export function validarResponsavelConversa(v: unknown, agora = Date.now()): ResponsavelConversa {
  const campos = ['v','id','conta','canal','conversa','responsavel','data','motivo','humano','anterior']
  if (!objeto(v) || Object.keys(v).length !== campos.length || !campos.every(k => Object.hasOwn(v,k))
    || v.v !== 2 || !idValido(v.id) || v.conta !== 'prumo' || v.canal !== 'whatsapp'
    || typeof v.conversa !== 'string' || !/^\d{10}$/.test(v.conversa) || chaveDaConversaBrasil(v.conversa) !== v.conversa
    || !['romulo','time'].includes(String(v.responsavel)) || !instante(v.data,agora) || v.humano !== true
    || typeof v.motivo !== 'string' || !v.motivo.trim() || v.motivo.length > 180 || /[\u0000-\u001f\u007f]/.test(v.motivo)
    || !(v.anterior === null || idValido(v.anterior)) || v.anterior === v.id) throw new Error('Confira identidade brasileira, data, motivo, confirmação humana e revisão anterior do responsável.')
  const r = v as unknown as ResponsavelConversa
  if ((PREFIXO_RESPONSAVEL + JSON.stringify(r)).length > 1000) throw new Error('Nota do responsável excede 1000 caracteres; nada foi truncado.')
  return { v: 2, id: r.id, conta: r.conta, canal: r.canal, conversa: r.conversa, responsavel: r.responsavel, data: r.data, motivo: r.motivo, humano: true, anterior: r.anterior }
}
export function textoResponsavelConversa(v: unknown, agora = Date.now()): string {
  return PREFIXO_RESPONSAVEL + JSON.stringify(validarResponsavelConversa(v,agora))
}
export function lerResponsavelConversa(v: unknown, agora = Date.now()): ResponsavelConversa | null {
  if (typeof v !== 'string' || !v.startsWith(PREFIXO_RESPONSAVEL) || v.length > 1000) return null
  try { return validarResponsavelConversa(JSON.parse(v.slice(PREFIXO_RESPONSAVEL.length)),agora) } catch { return null }
}
const igual = (a: IdentidadeConversa,b: IdentidadeConversa) => a.conta === b.conta && a.canal === b.canal && a.conversa === b.conversa
/** Projeta só a autoridade: oportunidades continuam distintas e nenhum fato comercial é fundido. */
export function projetarResponsavelConversa(lead: LeadComResponsavel, leads: readonly LeadComResponsavel[], agora = Date.now()): ProjecaoResponsavel {
  const identidade = identidadeDaConversa(lead)
  const bloqueio = (motivo: string): ProjecaoResponsavel => ({ identidade, estado: 'bloqueado', motivo })
  if (!identidade) return bloqueio('Conversa sem identidade brasileira suportada. Confira o destino.')
  const candidatos: { em: number; texto: string; registro: ResponsavelConversa | null }[] = []
  for (const outro of [lead,...leads.filter(l => l !== lead)]) {
    const doLead = identidadeDaConversa(outro)
    for (const e of outro.eventos) {
      const texto = e.registroTexto ?? e.texto ?? ''
      if (e.tipo !== 'nota' || e.origem !== 'manual' || !texto.startsWith(PREFIXO_RESPONSAVEL)) continue
      let bruto: unknown
      try { bruto = JSON.parse(texto.slice(PREFIXO_RESPONSAVEL.length)) } catch { bruto = null }
      // Uma nota de outra conta/canal não pode assumir esta conta.
      if (objeto(bruto) && (typeof bruto.conta === 'string' && bruto.conta !== identidade.conta || typeof bruto.canal === 'string' && bruto.canal !== identidade.canal)) continue
      const daNota = objeto(bruto) ? chaveDaConversaBrasil(bruto.conversa) : null
      if (!(doLead && igual(doLead,identidade)) && daNota !== identidade.conversa) continue
      if (!instante(e.em,agora)) return bloqueio('Nota de responsabilidade com horário inválido ou futuro. Confira a fonte.')
      const registro = lerResponsavelConversa(texto,agora)
      candidatos.push({ em: Date.parse(e.em), texto, registro: registro && igual(registro,identidade) && Date.parse(registro.data) <= Date.parse(e.em) ? registro : null })
    }
  }
  if (!candidatos.length) return { identidade, estado: 'ausente', motivo: 'Responsável ainda não confirmado por uma pessoa.' }
  candidatos.sort((a,b) => a.em-b.em)
  const vistos = new Map<string,string>()
  let atual: ResponsavelConversa | undefined, emAnterior: number | undefined
  for (const c of candidatos) {
    const r = c.registro
    if (!r) return bloqueio('Nota de responsabilidade inválida. Confira a fonte antes de liberar agentes.')
    const conteudo = JSON.stringify(r), anterior = vistos.get(r.id)
    if (anterior) { if (anterior !== conteudo) return bloqueio('Identificador de responsável reutilizado com conteúdo diferente.'); continue }
    if (emAnterior === c.em) return bloqueio('Há trocas de responsável no mesmo instante. Uma pessoa precisa conferir a ordem.')
    if (r.anterior !== (atual?.id ?? null) || atual && Date.parse(r.data) < Date.parse(atual.data)) return bloqueio('Revisão anterior do responsável divergente. Confira a concorrência na fonte.')
    vistos.set(r.id,conteudo); atual = r; emAnterior = c.em
  }
  return { identidade, estado: 'definido', registro: atual, motivo: atual!.responsavel === 'romulo' ? 'Rômulo assumiu esta conversa.' : 'Time autorizado para esta conversa, sujeito às regras comerciais.' }
}
/** Aplicar sob a mesma reserva/serialização da conversa antes do append. Não autentica o operador. */
export function validarSucessaoResponsavel(nota: unknown, atual: ProjecaoResponsavel, agora = Date.now()): ResponsavelConversa {
  const r = validarResponsavelConversa(nota,agora)
  if (!atual.identidade || !igual(r,atual.identidade) || atual.estado === 'bloqueado' || r.anterior !== (atual.registro?.id ?? null)) throw new Error('Responsável mudou ou fonte está bloqueada; releia antes de confirmar.')
  if (atual.registro && Date.parse(r.data) <= Date.parse(atual.registro.data)) throw new Error('Troca de responsável exige horário posterior à revisão atual.')
  return r
}
export interface ContextoAutoridade { pausado: boolean; recusado: boolean; contextoAtual: boolean; envioAmbiguo: boolean; bloqueioOperacional: boolean }
export function autoridadeDaConversa(atual: ProjecaoResponsavel, contexto: ContextoAutoridade): { permitido: boolean; motivo: string; revisao?: string } {
  const motivo = contexto.bloqueioOperacional ? 'Troca de responsável ou operação pendente de reconciliação.'
    : contexto.envioAmbiguo ? 'Envio anterior ambíguo: confira a conversa antes de qualquer repetição.'
    : contexto.pausado ? 'Atendimento pausado.' : contexto.recusado ? 'Recusa ou exclusão impede novo contato.'
    : !contexto.contextoAtual ? 'Contexto mudou: revise o rascunho.'
    : atual.estado !== 'definido' || atual.registro?.responsavel !== 'time' ? atual.motivo : ''
  return { permitido: !motivo, motivo: motivo || 'Autoridade confirmada; ainda exige os demais gates de ação.', ...(atual.registro ? { revisao: atual.registro.id } : {}) }
}