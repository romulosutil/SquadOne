import type { CrmLead } from './types'

/** Fatos humanos na aba CRM existente; a projeção não é outra fonte editável. Valores em centavos. */
export const PREFIXO_CICLO = '[ciclo-comercial-v1] '
export const OFERTAS_CICLO = ['encontrado', 'respondido', 'anuncios', 'anuncios-duas', 'redes', 'fonte', 'fonte-em-dia', 'iris', 'estampa', 'pacote'] as const
export type OfertaCiclo = typeof OFERTAS_CICLO[number]
export type ComponenteCiclo = 'inicial' | 'mensal'
export type TipoCiclo = 'proposta' | 'proposta_enviada' | 'aceite' | 'entrega_vista' | 'condicao_cobranca' | 'cobranca' | 'pagamento' | 'correcao'
export type GatilhoCobranca = 'aceite' | 'site_visto_no_ar' | 'data_combinada' | 'marco_confirmado'
export interface EventoCiclo {
  v: 1; id: string; tipo: TipoCiclo; data: string; humano: true; referencia: string
  vinculo?: string
  ofertaId?: OfertaCiclo; ofertas?: Exclude<OfertaCiclo, 'pacote'>[]; oferta?: string; versao?: number
  escopo?: string; prazo?: string; condicoes?: string; responsavel?: string
  /** Ausência é valor desconhecido; zero só existe quando explicitamente confirmado. */
  valor?: number; mensalidade?: number
  evidencia?: string; documento?: string
  componente?: ComponenteCiclo; competencia?: string; vencimento?: string; forma?: string
  gatilho?: GatilhoCobranca; condicao?: string; vigenciaInicio?: string; vigenciaFim?: string; liberadaEm?: string
}
export type LeadCiclo = Pick<CrmLead, 'eventos'>
const TIPOS: TipoCiclo[] = ['proposta', 'proposta_enviada', 'aceite', 'entrega_vista', 'condicao_cobranca', 'cobranca', 'pagamento', 'correcao']
const COMUNS = ['v', 'id', 'tipo', 'data', 'humano', 'referencia']
const CAMPOS: Record<TipoCiclo, string[]> = {
  proposta: ['ofertaId', 'ofertas', 'oferta', 'versao', 'escopo', 'prazo', 'condicoes', 'responsavel', 'valor', 'mensalidade'],
  proposta_enviada: ['vinculo', 'evidencia'], aceite: ['vinculo', 'evidencia', 'documento'], entrega_vista: ['vinculo', 'evidencia'],
  condicao_cobranca: ['vinculo', 'evidencia', 'componente', 'valor', 'gatilho', 'condicao', 'vigenciaInicio', 'vigenciaFim', 'liberadaEm'],
  cobranca: ['vinculo', 'evidencia', 'componente', 'competencia', 'valor', 'vencimento', 'forma'],
  pagamento: ['vinculo', 'evidencia', 'componente', 'competencia', 'valor'], correcao: ['vinculo', 'evidencia'],
}
const TEXTOS = ['referencia', 'vinculo', 'oferta', 'escopo', 'prazo', 'condicoes', 'responsavel', 'evidencia', 'documento', 'forma', 'condicao'] as const
export const referenciaNormalCiclo = (v: string) => v.trim().normalize('NFKC').toLocaleLowerCase('pt-BR')
export function diaCiclo(agora = Date.now()): string { return new Date(agora - 10800_000).toISOString().slice(0, 10) }
function dataValida(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v
}
function competenciaValida(v: unknown): v is string { return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) }
function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)]))
  return v
}
export const assinaturaEventoCiclo = (e: EventoCiclo): string => JSON.stringify(canonico(e))
export function validarEventoCiclo(valor: unknown, agora = Date.now()): EventoCiclo {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Evento comercial inválido.')
  const e = { ...valor } as EventoCiclo
  if (e.v !== 1 || !TIPOS.includes(e.tipo) || e.humano !== true) throw new Error('Evento exige versão válida e confirmação humana.')
  if (Object.keys(e).some(k => ![...COMUNS, ...CAMPOS[e.tipo]].includes(k))) throw new Error('Campo não permitido neste fato comercial.')
  if (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{3,80}$/.test(e.id) || !dataValida(e.data) || e.data > diaCiclo(agora)) throw new Error('Informe identificador único e data real até hoje.')
  for (const k of TEXTOS) if (e[k] !== undefined) {
    if (typeof e[k] !== 'string' || !e[k]!.trim() || e[k]!.length > 180 || /[\u0000-\u001f\u007f]/.test(e[k]!)) throw new Error(`Confira ${k}: texto preenchido, até 180 caracteres.`)
    e[k] = e[k]!.trim()
  }
  if (!e.referencia) throw new Error('Informe referência verificável, sem dados bancários.')
  if (e.vinculo !== undefined && !/^[A-Za-z0-9_-]{3,80}$/.test(e.vinculo)) throw new Error('Vínculo inválido.')
  for (const k of ['valor', 'mensalidade'] as const) if (e[k] !== undefined && (!Number.isSafeInteger(e[k]) || e[k]! < 0 || e[k]! > 100_000_000)) throw new Error('Valor explícito deve ser inteiro não negativo em centavos.')
  for (const k of ['vencimento', 'vigenciaInicio', 'vigenciaFim', 'liberadaEm'] as const) if (e[k] !== undefined && !dataValida(e[k])) throw new Error(`Data inválida: ${k}.`)
  const exigir = (...chaves: (keyof EventoCiclo)[]) => { if (chaves.some(k => e[k] === undefined || e[k] === '')) throw new Error(`Faltam campos: ${chaves.join(', ')}.`) }
  if (e.tipo === 'proposta') {
    exigir('ofertaId', 'versao')
    if (!OFERTAS_CICLO.includes(e.ofertaId!) || !Number.isSafeInteger(e.versao) || e.versao! < 1) throw new Error('Oferta estável ou versão inválida.')
    if (e.ofertaId === 'pacote') {
      if (!Array.isArray(e.ofertas) || !e.ofertas.length || e.ofertas.length > 9 || e.ofertas.some(o => o === ('pacote' as OfertaCiclo) || !OFERTAS_CICLO.includes(o)) || new Set(e.ofertas).size !== e.ofertas.length) throw new Error('Pacote exige ofertas estáveis e distintas.')
      e.ofertas = [...e.ofertas].sort()
    } else if (e.ofertas !== undefined) throw new Error('Lista de ofertas pertence somente a pacote.')
  } else {
    exigir('vinculo', 'evidencia')
    if (e.tipo === 'aceite') exigir('documento')
    if (['condicao_cobranca', 'cobranca', 'pagamento'].includes(e.tipo)) {
      exigir('componente', 'valor')
      if (!['inicial', 'mensal'].includes(e.componente!)) throw new Error('Componente deve ser inicial ou mensal.')
    }
    if (e.tipo === 'condicao_cobranca') {
      exigir('gatilho', 'condicao', 'vigenciaInicio')
      if (!['aceite', 'site_visto_no_ar', 'data_combinada', 'marco_confirmado'].includes(e.gatilho!)) throw new Error('Condição de cobrança inválida.')
      if (e.vigenciaFim && e.vigenciaFim < e.vigenciaInicio!) throw new Error('Fim da vigência anterior ao início.')
      if (e.gatilho === 'data_combinada') exigir('liberadaEm')
      else if (e.liberadaEm !== undefined) throw new Error('Data de liberação pertence ao gatilho data combinada.')
    }
    if (e.tipo === 'cobranca' || e.tipo === 'pagamento') {
      if (e.valor! <= 0) throw new Error('Cobrança e pagamento exigem valor positivo.')
      if (e.componente === 'mensal' && !competenciaValida(e.competencia)) throw new Error('Informe competência mensal YYYY-MM válida.')
      if (e.componente === 'inicial' && e.competencia !== undefined) throw new Error('Cobrança inicial não recebe competência mensal.')
    }
    if (e.tipo === 'cobranca') { exigir('vencimento', 'forma'); if (e.vencimento! < e.data) throw new Error('Vencimento anterior à emissão da cobrança.') }
  }
  if ((PREFIXO_CICLO + assinaturaEventoCiclo(e)).length > 1000) throw new Error('Registro excede 1000 caracteres; referencie o documento completo, sem truncar.')
  return e
}
export function textoEventoCiclo(e: EventoCiclo, agora = Date.now()): string { return PREFIXO_CICLO + assinaturaEventoCiclo(validarEventoCiclo(e, agora)) }
export function lerEventoCiclo(texto: unknown, agora = Date.now()): EventoCiclo | null {
  if (typeof texto !== 'string' || !texto.startsWith(PREFIXO_CICLO) || texto.length > 1000) return null
  try { return validarEventoCiclo(JSON.parse(texto.slice(PREFIXO_CICLO.length)), agora) } catch { return null }
}
export function propostaExigeSiteVisto(e: EventoCiclo): boolean { return e.ofertaId === 'encontrado' || e.ofertaId === 'pacote' && !!e.ofertas?.includes('encontrado') }
export function pendenciasDaProposta(e: EventoCiclo): string[] {
  return (['escopo', 'prazo', 'condicoes', 'responsavel', 'valor', 'mensalidade'] as const).filter(k => e[k] === undefined || e[k] === '')
}
function exigirPropostaCompleta(e: EventoCiclo): void { const p = pendenciasDaProposta(e); if (p.length) throw new Error(`Proposta incompleta: ${p.join(', ')}; desconhecido não é zero.`) }
function propostaVinculada(e: EventoCiclo, eventos: EventoCiclo[]): EventoCiclo | undefined {
  const porId = new Map(eventos.map(v => [v.id, v])); let atual: EventoCiclo | undefined = e
  const vistos = new Set<string>()
  while (atual && !vistos.has(atual.id)) { if (atual.tipo === 'proposta') return atual; vistos.add(atual.id); atual = porId.get(atual.vinculo ?? '') }
  return undefined
}
function dependencias(e: EventoCiclo, eventos: EventoCiclo[]): string[] {
  const deps = e.vinculo ? [e.vinculo] : []
  if (e.tipo === 'aceite') deps.push(...eventos.filter(v => v.tipo === 'proposta_enviada' && v.vinculo === e.vinculo && v.data <= e.data).map(v => v.id))
  if (e.tipo === 'cobranca') {
    const proposta = propostaVinculada(e, eventos)
    const condicao = eventos.find(v => v.id === e.vinculo)
    if (proposta && (propostaExigeSiteVisto(proposta) || condicao?.gatilho === 'site_visto_no_ar')) deps.push(...eventos.filter(v => v.tipo === 'entrega_vista' && v.vinculo === proposta.id && v.data <= e.data).map(v => v.id))
  }
  return deps
}
function referenciasLegadas(lead: LeadCiclo, agora: number): Set<string> {
  const ativos = new Map<string, string>()
  for (const r of [...(lead.eventos ?? [])].filter(r => r.origem === 'manual' && Number.isFinite(Date.parse(r.em)) && Date.parse(r.em) <= agora).sort((a, b) => Date.parse(a.em) - Date.parse(b.em))) {
    if (!['pagamento_confirmado', 'receita_desfeita'].includes(r.tipo)) continue
    try {
      const v = JSON.parse(r.registroTexto ?? r.texto)
      if (v.versao !== 1 || typeof v.referencia !== 'string' || !dataValida(v.data) || v.data > diaCiclo(agora)) continue
      if (r.tipo === 'pagamento_confirmado') {
        if (typeof v.oferta !== 'string' || typeof v.componente !== 'string') continue
        const ref = referenciaNormalCiclo(v.referencia)
        ativos.set(`${ref}|${v.data}|${v.oferta}|${v.componente}`, ref)
      } else if (v.tipo === 'pagamento_confirmado') ativos.delete(v.referencia)
    } catch { /* Nota legada ilegível não produz dinheiro nem referência sintética. */ }
  }
  return new Set(ativos.values())
}
function conferirNovo(lead: LeadCiclo, e: EventoCiclo, historico: EventoCiclo[], ativos: EventoCiclo[], agora: number): void {
  if (e.tipo === 'proposta') {
    const anteriores = historico.filter(v => v.tipo === 'proposta' && referenciaNormalCiclo(v.referencia) === referenciaNormalCiclo(e.referencia))
    if (anteriores.some(v => v.versao! >= e.versao!)) throw new Error('Use uma nova versão da proposta; versões anteriores são imutáveis.')
    if (anteriores.some(v => v.ofertaId !== e.ofertaId || JSON.stringify(v.ofertas) !== JSON.stringify(e.ofertas))) throw new Error('A série da proposta conserva sua oferta estável; use outra referência para outra oferta.')
    if (anteriores.some(v => v.data > e.data)) throw new Error('Nova versão não pode anteceder a versão anterior.')
    return
  }
  const vinculo = ativos.find(v => v.id === e.vinculo)
  if (!vinculo) throw new Error('O vínculo deve estar confirmado e ativo na aba CRM.')
  if (e.data < vinculo.data) throw new Error('O fato não pode anteceder seu vínculo.')
  if (e.tipo === 'correcao') {
    if (vinculo.tipo === 'correcao' || ativos.some(v => v.id !== e.id && dependencias(v, ativos).includes(vinculo.id))) throw new Error('Corrija primeiro os fatos dependentes; correção não apaga o original.')
    return
  }
  if (['proposta_enviada', 'aceite', 'entrega_vista'].includes(e.tipo)) {
    if (vinculo.tipo !== 'proposta') throw new Error('Vincule à versão exata da proposta.')
    if (e.tipo !== 'entrega_vista') exigirPropostaCompleta(vinculo)
    if (ativos.some(v => v.tipo === e.tipo && v.vinculo === e.vinculo)) throw new Error('Este marco da proposta já está registrado; confira o histórico.')
    if (e.tipo === 'aceite' && !ativos.some(v => v.tipo === 'proposta_enviada' && v.vinculo === vinculo.id && v.data <= e.data)) throw new Error('Confirme o conteúdo enviado antes do aceite, com data compatível.')
    return
  }
  const proposta = propostaVinculada(e, ativos)
  if (!proposta) throw new Error('A obrigação deve remeter à versão exata aceita da proposta.')
  // Versões da mesma referência substituem a negociação anterior. Acréscimos
  // cumulativos exigem outra referência, sem reescrever o contrato antigo.
  const outraVersaoDaSerie = (v: EventoCiclo) => {
    const p = propostaVinculada(v, ativos)
    return !!p && p.id !== proposta.id && referenciaNormalCiclo(p.referencia) === referenciaNormalCiclo(proposta.referencia)
  }
  if (e.tipo === 'condicao_cobranca') {
    if (vinculo.tipo !== 'aceite') throw new Error('Condição de cobrança exige aceite com documento.')
    exigirPropostaCompleta(proposta)
    if (e.vigenciaInicio! < vinculo.data || e.liberadaEm && e.liberadaEm < e.vigenciaInicio!) throw new Error('Vigência/liberação não pode anteceder a contratação.')
    if (propostaExigeSiteVisto(proposta) && e.gatilho !== 'site_visto_no_ar') throw new Error('Site exige pagamento após o cliente ver o site funcionando no ar.')
    if (ativos.some(v => v.tipo === 'condicao_cobranca' && v.componente === e.componente && outraVersaoDaSerie(v)
      && e.vigenciaInicio! <= (v.vigenciaFim ?? '9999-12-31') && v.vigenciaInicio! <= (e.vigenciaFim ?? '9999-12-31'))) throw new Error('Vigência sobreposta a outra versão da mesma série/componente, inclusive na data final. Versões são substitutivas; cobrança cumulativa exige outra referência de proposta.')
    const limite = e.componente === 'inicial' ? proposta.valor! : proposta.mensalidade!
    const declarado = ativos.filter(v => v.tipo === 'condicao_cobranca' && v.vinculo === vinculo.id && v.componente === e.componente).reduce((n, v) => n + v.valor!, 0)
    if (declarado + e.valor! > limite) throw new Error('Condições de cobrança excedem o componente explicitamente aceito.')
    return
  }
  if (e.tipo === 'cobranca') {
    if (vinculo.tipo !== 'condicao_cobranca') throw new Error('Cobrança exige condição de cobrança confirmada.')
    if (e.componente !== vinculo.componente) throw new Error('Componente diverge da condição contratada.')
    if (e.data < vinculo.vigenciaInicio! || vinculo.vigenciaFim && e.data > vinculo.vigenciaFim || vinculo.liberadaEm && e.data < vinculo.liberadaEm) throw new Error('Cobrança fora da vigência ou anterior à condição de liberação.')
    if (e.competencia && (e.competencia < vinculo.vigenciaInicio!.slice(0, 7) || vinculo.vigenciaFim && e.competencia > vinculo.vigenciaFim.slice(0, 7))) throw new Error('Competência fora da vigência contratada.')
    if ((propostaExigeSiteVisto(proposta) || vinculo.gatilho === 'site_visto_no_ar') && !ativos.some(v => v.tipo === 'entrega_vista' && v.vinculo === proposta.id && v.data <= e.data)) throw new Error('Confirme que o cliente viu o site funcionando antes da cobrança.')
    if (ativos.some(v => v.tipo === 'cobranca' && referenciaNormalCiclo(v.referencia) === referenciaNormalCiclo(e.referencia))) throw new Error('Referência de cobrança já registrada.')
    if (ativos.some(v => v.tipo === 'cobranca' && v.componente === e.componente && v.competencia === e.competencia && outraVersaoDaSerie(v))) throw new Error('Outra versão da mesma série já possui cobrança deste componente/competência. Versões são substitutivas; cobrança cumulativa exige outra referência de proposta.')
    const comprometido = ativos.filter(v => v.tipo === 'cobranca' && v.vinculo === vinculo.id && v.competencia === e.competencia).reduce((n, v) => n + v.valor!, 0)
    if (comprometido + e.valor! > vinculo.valor!) throw new Error('Cobrança excede a obrigação declarada para este componente/competência.')
    return
  }
  if (e.tipo === 'pagamento') {
    if (vinculo.tipo !== 'cobranca') throw new Error('Pagamento deve apontar à cobrança confirmada.')
    if (e.componente !== vinculo.componente || e.competencia !== vinculo.competencia) throw new Error('Componente/competência diverge da cobrança.')
    if (ativos.some(v => v.tipo === 'pagamento' && referenciaNormalCiclo(v.referencia) === referenciaNormalCiclo(e.referencia)) || referenciasLegadas(lead, agora).has(referenciaNormalCiclo(e.referencia))) throw new Error('Referência de recebimento já registrada, inclusive no histórico legado.')
    const recebido = ativos.filter(v => v.tipo === 'pagamento' && v.vinculo === vinculo.id).reduce((n, v) => n + v.valor!, 0)
    if (recebido + e.valor! > vinculo.valor!) throw new Error('Pagamento excede o saldo da cobrança; corrija os fatos antes de registrar.')
  }
}
interface Reconstrucao { historico: EventoCiclo[]; ativos: EventoCiclo[]; problemas: string[] }
function reconstruir(lead: LeadCiclo, agora: number): Reconstrucao {
  const estado: Reconstrucao = { historico: [], ativos: [], problemas: [] }
  const anulados = new Set<string>(), vistos = new Map<string, EventoCiclo>()
  const linhas = [...(lead.eventos ?? [])].filter(r => r.tipo === 'nota' && r.origem === 'manual' && Number.isFinite(Date.parse(r.em)) && Date.parse(r.em) <= agora).sort((a, b) => Date.parse(a.em) - Date.parse(b.em))
  for (const r of linhas) {
    const texto = r.registroTexto ?? r.texto
    if (!texto.startsWith(PREFIXO_CICLO)) continue
    const e = lerEventoCiclo(texto, Date.parse(r.em))
    if (!e) { estado.problemas.push('Nota do ciclo inválida ou posterior à data do registro.'); continue }
    const visto = vistos.get(e.id)
    if (visto) { if (assinaturaEventoCiclo(visto) !== assinaturaEventoCiclo(e)) estado.problemas.push(`Colisão no evento ${e.id}.`); continue }
    vistos.set(e.id, e)
    try { conferirNovo(lead, e, estado.historico, estado.ativos, agora) } catch (erro) { estado.problemas.push(erro instanceof Error ? erro.message : 'Histórico incoerente.'); continue }
    estado.historico.push(e)
    if (e.tipo === 'correcao') anulados.add(e.vinculo!)
    estado.ativos = estado.historico.filter(v => v.tipo !== 'correcao' && !anulados.has(v.id))
  }
  return estado
}
export function eventosDoCiclo(lead: LeadCiclo, agora = Date.now()): EventoCiclo[] { return reconstruir(lead, agora).ativos }
/** Replay usa o histórico inteiro: um ID corrigido nunca pode ser reutilizado para outro fato. */
export function validarTransicaoCiclo(lead: LeadCiclo, evento: EventoCiclo, agora = Date.now()): 'novo' | 'duplicado' {
  const e = validarEventoCiclo(evento, agora), estado = reconstruir(lead, agora)
  const mesmo = estado.historico.find(v => v.id === e.id)
  if (mesmo && assinaturaEventoCiclo(mesmo) !== assinaturaEventoCiclo(e)) throw new Error('Identificador já usado por outro fato, inclusive se corrigido.')
  if (estado.problemas.length) throw new Error(`Histórico comercial incoerente: ${estado.problemas[0]}`)
  if (mesmo) return 'duplicado'
  conferirNovo(lead, e, estado.historico, estado.ativos, agora)
  return 'novo'
}
export function cicloDoLead(lead: LeadCiclo, agora = Date.now()) {
  const { historico, ativos: eventos, problemas } = reconstruir(lead, agora)
  const pagamentos = eventos.filter(e => e.tipo === 'pagamento').map(p => {
    const proposta = propostaVinculada(p, eventos)!
    return { ...p, valor: p.valor!, componente: p.componente!, ofertaId: proposta.ofertaId!, ofertas: proposta.ofertas, propostaId: proposta.id, versaoProposta: proposta.versao! }
  })
  const cobrancas = eventos.filter(e => e.tipo === 'cobranca').map(c => {
    const recebido = pagamentos.filter(p => p.vinculo === c.id).reduce((n, p) => n + p.valor, 0)
    return { ...c, valor: c.valor!, recebido, saldo: c.valor! - recebido, situacao: recebido === 0 ? 'pendente' as const : recebido < c.valor! ? 'parcial' as const : 'integral' as const }
  })
  return { historico, eventos, problemas, propostas: eventos.filter(e => e.tipo === 'proposta').map(e => ({ ...e, pendencias: pendenciasDaProposta(e) })),
    envios: eventos.filter(e => e.tipo === 'proposta_enviada'), aceites: eventos.filter(e => e.tipo === 'aceite'), condicoes: eventos.filter(e => e.tipo === 'condicao_cobranca'), cobrancas, pagamentos,
    recebido: pagamentos.reduce((n, p) => n + p.valor, 0), primeiroRecebimento: pagamentos.map(e => e.data).sort()[0] }
}
