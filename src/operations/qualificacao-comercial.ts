/** Qualificação comercial confirmada em nota da aba CRM; nenhuma inferência ou envio. */
export const PREFIXO_QUALIFICACAO_COMERCIAL = '[qualificacao-comercial-v1] '
export const LIMITE_NOTA_QUALIFICACAO = 1000
export const OFERTAS_QUALIFICACAO = ['raio-x', 'mapa', 'encontrado', 'respondido', 'anuncios', 'anuncios-duas', 'redes', 'fonte', 'fonte-em-dia', 'iris', 'estampa', 'pacote'] as const
export type OfertaQualificacao = typeof OFERTAS_QUALIFICACAO[number]
export interface QualificacaoComercial {
  v: 1
  id: string
  em: string
  humano: true
  necessidade: string
  adequacao: { estado: 'pendente' | 'confirmada' | 'inadequada'; oferta: OfertaQualificacao | ''; motivo: string }
  intencao: 'desconhecida' | 'permissao' | 'avaliar' | 'contratar' | 'sem-interesse'
  /** Participantes e como decidem; não exige um único decisor. */
  decisao: string
  proximoPasso: { descricao: string; aceito: boolean }
  /** Referência legível (canal/data/mensagem), sem exigir URL privada. */
  fonte: string
  evidencia: string
}
export interface EventoQualificacao {
  tipo: string; origem: string; em: string; texto?: string; registroTexto?: string
}
export interface EntradaQualificacaoComercial {
  qualificacaoComercial?: unknown
  eventos?: readonly EventoQualificacao[]
  resposta?: { tipo: string }
  etapa?: string
}
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const esquema = (v: Record<string, unknown>, campos: string[]) => Object.keys(v).length === campos.length && campos.every(k => Object.hasOwn(v, k))
const texto = (v: unknown, limite = 160): v is string => typeof v === 'string' && v.length <= limite && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v)
const preenchido = (v?: string) => Boolean(v?.trim())
function instanteValido(em: unknown, agora: number): em is string {
  if (typeof em !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(em)) return false
  const t = Date.parse(em)
  return Number.isFinite(t) && t <= agora && new Date(t).toISOString().slice(0,19) === em.slice(0,19)
}

/** Cria apenas um rascunho; id, fonte e evidência precisam ser conferidos antes de registrar. */
export function qualificacaoComercialVazia(agora = Date.now()): QualificacaoComercial {
  return { v: 1, id: '', em: new Date(agora).toISOString(), humano: true, necessidade: '',
    adequacao: { estado: 'pendente', oferta: '', motivo: '' }, intencao: 'desconhecida', decisao: '',
    proximoPasso: { descricao: '', aceito: false }, fonte: '', evidencia: '' }
}

/** Rejeita em vez de truncar, inclusive fonte/trecho; preenchimento parcial não libera proposta. */
export function validarQualificacaoComercial(valor: unknown, agora = Date.now()): QualificacaoComercial {
  if (!objeto(valor) || !esquema(valor, ['v','id','em','humano','necessidade','adequacao','intencao','decisao','proximoPasso','fonte','evidencia'])
    || valor.v !== 1 || valor.humano !== true || typeof valor.id !== 'string' || !/^[A-Za-z0-9_-]{3,80}$/.test(valor.id)
    || !instanteValido(valor.em,agora)) throw new Error('Confira versão, identificador, data real e confirmação humana da qualificação.')
  const a = valor.adequacao, p = valor.proximoPasso
  if (!objeto(a) || !esquema(a,['estado','oferta','motivo']) || !['pendente','confirmada','inadequada'].includes(String(a.estado))
    || !(a.oferta === '' || OFERTAS_QUALIFICACAO.includes(a.oferta as OfertaQualificacao)) || !texto(a.motivo)
    || !objeto(p) || !esquema(p,['descricao','aceito']) || !texto(p.descricao) || typeof p.aceito !== 'boolean'
    || !texto(valor.necessidade) || !texto(valor.decisao) || !texto(valor.fonte,120) || !texto(valor.evidencia,180)
    || !['desconhecida','permissao','avaliar','contratar','sem-interesse'].includes(String(valor.intencao))) throw new Error('Confira os campos e as opções da qualificação, sem abreviar evidência para caber.')
  if (!preenchido(valor.fonte) || !preenchido(valor.evidencia)) throw new Error('Informe fonte e trecho real que sustentam esta revisão.')
  const q: QualificacaoComercial = { v: 1, id: valor.id, em: valor.em, humano: true, necessidade: valor.necessidade,
    adequacao: { estado: a.estado as QualificacaoComercial['adequacao']['estado'], oferta: a.oferta as QualificacaoComercial['adequacao']['oferta'], motivo: a.motivo },
    intencao: valor.intencao as QualificacaoComercial['intencao'], decisao: valor.decisao,
    proximoPasso: { descricao: p.descricao, aceito: p.aceito }, fonte: valor.fonte, evidencia: valor.evidencia }
  if ((PREFIXO_QUALIFICACAO_COMERCIAL + JSON.stringify(q)).length > LIMITE_NOTA_QUALIFICACAO) throw new Error('A nota excede 1000 caracteres. Resuma os fatos sem truncar a fonte ou a evidência.')
  return q
}
export function textoDaQualificacaoComercial(q: unknown, agora = Date.now()): string {
  return PREFIXO_QUALIFICACAO_COMERCIAL + JSON.stringify(validarQualificacaoComercial(q,agora))
}
export function lerNotaQualificacaoComercial(texto: unknown, agora = Date.now()): QualificacaoComercial | null {
  if (typeof texto !== 'string' || !texto.startsWith(PREFIXO_QUALIFICACAO_COMERCIAL) || texto.length > LIMITE_NOTA_QUALIFICACAO) return null
  try { return validarQualificacaoComercial(JSON.parse(texto.slice(PREFIXO_QUALIFICACAO_COMERCIAL.length)),agora) } catch { return null }
}
const nota = (e: EventoQualificacao) => e.registroTexto ?? e.texto ?? ''
const eventoHumano = (e: EventoQualificacao, agora: number) => e.tipo === 'nota' && e.origem === 'manual' && Number.isFinite(Date.parse(e.em)) && Date.parse(e.em) <= agora
/** O último marcador explícito governa, mesmo se seu conteúdo estiver inválido. */
function ultimaNotaQualificacao(lead: Pick<EntradaQualificacaoComercial,'eventos'>, agora: number): EventoQualificacao | undefined {
  return (lead.eventos ?? []).map((e,i) => ({e,i}))
    .filter(({e}) => eventoHumano(e,agora) && nota(e).startsWith(PREFIXO_QUALIFICACAO_COMERCIAL))
    .sort((a,b) => Date.parse(b.e.em)-Date.parse(a.e.em) || b.i-a.i)[0]?.e
}
export function projetarQualificacaoComercial(lead: Pick<EntradaQualificacaoComercial,'eventos'>, agora = Date.now()): QualificacaoComercial | undefined {
  const ultima = ultimaNotaQualificacao(lead,agora)
  return ultima ? lerNotaQualificacaoComercial(nota(ultima),agora) ?? undefined : undefined
}
/** Presença de nota nova inválida não autoriza voltar silenciosamente à regra antiga. */
export function temQualificacaoComercial(lead: EntradaQualificacaoComercial, agora = Date.now()): boolean {
  return lead.qualificacaoComercial !== undefined || (lead.eventos ?? []).some(e => eventoHumano(e,agora) && nota(e).startsWith(PREFIXO_QUALIFICACAO_COMERCIAL))
}
export function qualificacaoComercialAtual(lead: EntradaQualificacaoComercial, agora = Date.now()): QualificacaoComercial | null {
  const ultima = ultimaNotaQualificacao(lead,agora)
  if (ultima) return lerNotaQualificacaoComercial(nota(ultima),agora)
  try { return validarQualificacaoComercial(lead.qualificacaoComercial,agora) } catch { return null }
}
export type CampoQualificacao = 'necessidade' | 'adequacao' | 'intencao' | 'decisao' | 'proximoPasso' | 'evidencia'
export const ROTULOS_QUALIFICACAO: Record<CampoQualificacao,string> = {
  necessidade: 'necessidade', adequacao: 'adequação da oferta', intencao: 'intenção de avaliar ou contratar',
  decisao: 'participantes e processo de decisão', proximoPasso: 'próximo passo aceito', evidencia: 'fonte, evidência e confirmação humana',
}
export function camposFaltantesQualificacao(q: QualificacaoComercial | null): CampoQualificacao[] {
  return [!preenchido(q?.necessidade) && 'necessidade',
    !(q?.adequacao.estado === 'confirmada' && q.adequacao.oferta && preenchido(q.adequacao.motivo)) && 'adequacao',
    !(q?.intencao === 'avaliar' || q?.intencao === 'contratar') && 'intencao', !preenchido(q?.decisao) && 'decisao',
    !(q?.proximoPasso.aceito && preenchido(q.proximoPasso.descricao)) && 'proximoPasso',
    !(q?.humano && preenchido(q.fonte) && preenchido(q.evidencia)) && 'evidencia'].filter((v): v is CampoQualificacao => Boolean(v))
}
export function lacunasDaQualificacaoComercial(lead: EntradaQualificacaoComercial, agora = Date.now()): string[] {
  return camposFaltantesQualificacao(qualificacaoComercialAtual(lead,agora)).map(c => ROTULOS_QUALIFICACAO[c])
}
/** Gate da nota nova; o wrapper em spiced.ts mantém o fallback legado quando não há nota nova. */
export function qualificadoComercialmenteParaProposta(lead: EntradaQualificacaoComercial, agora = Date.now()): boolean {
  return !['ganho','perdido'].includes(lead.etapa ?? '') && !['negativa','exclusao'].includes(lead.resposta?.tipo ?? '')
    && lacunasDaQualificacaoComercial(lead,agora).length === 0
}
export interface PerguntaQualificacao { campo: CampoQualificacao; alvo: 'cliente' | 'operador'; texto: string }
export function proximaPerguntaQualificacao(lead: EntradaQualificacaoComercial, agora = Date.now()): PerguntaQualificacao | null {
  if (['ganho','perdido'].includes(lead.etapa ?? '') || ['negativa','exclusao'].includes(lead.resposta?.tipo ?? '')) return null
  const q = qualificacaoComercialAtual(lead,agora)
  if (q?.intencao === 'sem-interesse' || q?.adequacao.estado === 'inadequada') return null
  const campo = camposFaltantesQualificacao(q)[0]
  if (!campo) return null
  const perguntas: Record<CampoQualificacao,{alvo: 'cliente'|'operador'; texto: string}> = {
    necessidade: { alvo: 'cliente', texto: 'O que você precisa resolver ou melhorar hoje?' },
    adequacao: { alvo: 'operador', texto: 'Qual oferta atende à necessidade e quais limites ou dependências precisam ser conferidos?' },
    intencao: { alvo: 'cliente', texto: 'Você quer avaliar essa solução para contratar ou está conhecendo as opções?' },
    decisao: { alvo: 'cliente', texto: 'Quem participa dessa decisão e o que vocês precisam comparar?' },
    proximoPasso: { alvo: 'cliente', texto: q?.proximoPasso.descricao.trim() ? `Faz sentido seguirmos com: ${q.proximoPasso.descricao}?` : 'Qual próximo passo faz sentido combinarmos?' },
    evidencia: { alvo: 'operador', texto: 'Qual fonte e trecho real sustentam esta qualificação revisada por você?' },
  }
  return { campo, ...perguntas[campo] }
}
export type SinalPassagemComercial = 'preco' | 'proposta' | 'contratar' | 'negociar' | 'pagamento'
/** O chamador fornece o sinal recebido e contextualizado; não há novo classificador de mensagens. */
export function devePassarAoRomulo(lead: EntradaQualificacaoComercial, sinal?: SinalPassagemComercial, agora = Date.now()): boolean {
  if (['ganho','perdido'].includes(lead.etapa ?? '') || ['negativa','exclusao'].includes(lead.resposta?.tipo ?? '')) return false
  const q = qualificacaoComercialAtual(lead,agora)
  if (q?.intencao === 'sem-interesse') return false
  return sinal !== undefined || q?.intencao === 'contratar'
}
