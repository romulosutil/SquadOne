/** AARRR comercial: confirmações humanas na aba CRM. Não lê Finanças nem infere receita de “ganhou”. */
import { cicloDoLead, lerEventoCiclo, referenciaNormalCiclo } from './ciclo-comercial'
import { mensalidadeIrisCentavos } from './precos-iris'
import { dataRealDoSpiced, qualificadoParaProposta } from './spiced'
import { pedeMaterial } from './marcadores-da-conversa'
import { AMOSTRA_MINIMA } from './resultados'
import { ultimaRespostaHumanaEm } from './resposta-humana'
import type { CrmLead } from './types'

export const INICIO_AARR = '2026-10-19T00:00:00-03:00'
export const TIPOS_AARR = ['valor_proposta', 'pagamento_confirmado', 'receita_desfeita', 'origem', 'motivo_perda', 'retencao_3m', 'indicacao_pedida', 'indicacao_recebida'] as const
export type TipoAarr = typeof TIPOS_AARR[number]
export const ORIGENS_AARR = ['cacador', 'plus', 'indicacao', 'CDL', 'anuncio'] as const
export type OrigemAarr = typeof ORIGENS_AARR[number]
export const MOTIVOS_PERDA_AARR = ['preco', 'timing', 'sem-dor', 'decisor', 'concorrente', 'sumiu'] as const
export type MotivoPerdaAarr = typeof MOTIVOS_PERDA_AARR[number]
/** `sem-origem` e `sem-motivo`: o registro não traz o dado. Nunca se infere o canal nem a razão da perda. */
export type CanalAarr = OrigemAarr | 'sem-origem'
export type MotivoAgregadoAarr = MotivoPerdaAarr | 'sem-motivo'
export type OfertaReceita = 'encontrado' | 'respondido' | 'anuncios' | 'anuncios-duas' | 'redes' | 'fonte' | 'fonte-em-dia' | 'iris' | 'estampa' | 'pacote'
export type ComponenteReceita = 'implantacao' | 'mensalidade' | 'parcela-1' | 'parcela-2'
export interface OpcaoReceita {
  id: string; rotulo: string; oferta: OfertaReceita; componente: ComponenteReceita
  valorCentavos: number; recorrencia: 'unico' | 'mensal'; quantidade?: number
}
export interface RegistroReceita {
  versao: 1; oferta: OfertaReceita; componente: ComponenteReceita; quantidade?: number
  valor_centavos: number; referencia: string; data: string
}
export interface RegistroRetencao { versao: 1; referencia: string; inicio: string; data: string; ativa: boolean }
export interface RegistroIndicacao { versao: 1; referencia: string; data: string }
export interface ReceitaDesfeita { versao: 1; tipo: 'pagamento_confirmado' | 'valor_proposta'; referencia: string; data: string }
export type RegistroAarr = RegistroReceita | RegistroRetencao | RegistroIndicacao | ReceitaDesfeita | { versao: 1; valor: OrigemAarr | MotivoPerdaAarr }
export interface ReceitaDoLead {
  propostas: Array<RegistroReceita & { em: string }>
  pagamentos: Array<RegistroReceita & { em: string; chave: string }>
  origem?: OrigemAarr; motivoPerda?: MotivoPerdaAarr
  retencoes: Array<RegistroRetencao & { em: string }>
  indicacoes: { pedidas: Array<RegistroIndicacao & { em: string }>; recebidas: Array<RegistroIndicacao & { em: string }> }
}

/** Espelho dos valores de CARDAPIO/condições de 09/10; “Fonte” é só a base canônica, nunca preço livre. */
const TABELA: Array<[OfertaReceita, ComponenteReceita, number, string]> = [
  ['encontrado', 'implantacao', 69000, 'Encontrado · implantação'], ['encontrado', 'mensalidade', 3900, 'Encontrado · mensalidade'],
  ['respondido', 'implantacao', 240000, 'Respondido · implantação'], ['respondido', 'mensalidade', 29000, 'Respondido · mensalidade'],
  ['anuncios', 'mensalidade', 59000, 'Anúncios · uma plataforma/mês'], ['anuncios-duas', 'mensalidade', 98000, 'Anúncios · duas plataformas/mês'],
  ['redes', 'mensalidade', 79000, 'Redes sociais · mensalidade'], ['fonte', 'implantacao', 150000, 'Fonte · base do catálogo integral'],
  ['fonte', 'parcela-1', 75000, 'Fonte · primeira metade da base'], ['fonte', 'parcela-2', 75000, 'Fonte · segunda metade da base'],
  ['fonte-em-dia', 'mensalidade', 19000, 'Fonte em dia · mensalidade'],
]
type LeadReceita = Pick<CrmLead, 'produto'> & Partial<Pick<CrmLead, 'plus'>>
const ofertaDo = (l: LeadReceita) => l.produto === 'plus' ? l.plus?.oferta : l.produto
export function opcoesDeterministicasDeReceita(lead: LeadReceita, quantidade?: number): OpcaoReceita[] {
  const oferta = ofertaDo(lead)
  if (oferta === 'estampa' || !oferta) return []
  if (oferta === 'iris') {
    if (!Number.isSafeInteger(quantidade) || quantidade! <= 0) return []
    try { return [{ id: 'iris:mensalidade', rotulo: `Iris · ${quantidade} fichas ativas/mês`, oferta: 'iris', componente: 'mensalidade',
      valorCentavos: mensalidadeIrisCentavos(quantidade!), recorrencia: 'mensal', quantidade }] } catch { return [] }
  }
  return TABELA.filter(([id]) => oferta === 'prumo' || id === 'encontrado').map(([id, componente, valorCentavos, rotulo]) => ({
    id: `${id}:${componente}`, rotulo, oferta: id, componente, valorCentavos, recorrencia: componente === 'mensalidade' ? 'mensal' : 'unico',
  }))
}
export const ehTipoAarr = (v: string): v is TipoAarr => (TIPOS_AARR as readonly string[]).includes(v)
const texto = (v: unknown, max = 200): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v)
const chaves = (v: Record<string, unknown>, permitidas: string[]) => Object.keys(v).every(k => permitidas.includes(k))
export const diaAarr = (agora: number) => new Date(agora - 3 * 3600_000).toISOString().slice(0, 10)
const data = (v: unknown): v is string => typeof v === 'string' && !!v && dataRealDoSpiced(v)
export function terceiroMes(inicio: string): string {
  if (!data(inicio)) return ''
  const [ano, mes, dia] = inicio.split('-').map(Number)
  // Mês inicial = primeiro; entrar no terceiro mês soma dois meses de calendário.
  const fim = new Date(Date.UTC(ano!, mes! + 1, 1))
  const ultimo = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth() + 1, 0)).getUTCDate()
  fim.setUTCDate(Math.min(dia!, ultimo))
  return fim.toISOString().slice(0, 10)
}
export function lerRegistroAarr(tipo: string, bruto: unknown, agora = Number.POSITIVE_INFINITY): RegistroAarr | null {
  if (!ehTipoAarr(tipo) || typeof bruto !== 'string' || bruto.length > 1000) return null
  try {
    const v = JSON.parse(bruto)
    if (!v || typeof v !== 'object' || Array.isArray(v) || v.versao !== 1) return null
    if (tipo === 'origem' || tipo === 'motivo_perda') {
      if (!chaves(v, ['versao', 'valor']) || !((tipo === 'origem' ? ORIGENS_AARR : MOTIVOS_PERDA_AARR) as readonly string[]).includes(v.valor)) return null
      return { versao: 1, valor: v.valor }
    }
    if (!texto(v.referencia, tipo === 'receita_desfeita' || tipo === 'indicacao_pedida' ? 400 : 200) || !data(v.data) || (Number.isFinite(agora) && v.data > diaAarr(agora))) return null
    if (tipo === 'receita_desfeita') {
      if (!chaves(v, ['versao', 'tipo', 'referencia', 'data']) || !['pagamento_confirmado', 'valor_proposta'].includes(v.tipo)) return null
      return { versao: 1, tipo: v.tipo, referencia: v.referencia.trim(), data: v.data }
    }
    if (tipo === 'valor_proposta' || tipo === 'pagamento_confirmado') {
      if (!chaves(v, ['versao', 'oferta', 'componente', 'quantidade', 'valor_centavos', 'referencia', 'data'])) return null
      const opcoes = opcoesDeterministicasDeReceita({ produto: v.oferta === 'iris' ? 'iris' : 'prumo' }, v.quantidade)
      const opcao = opcoes.find(o => o.oferta === v.oferta && o.componente === v.componente)
      if (!opcao || (v.oferta !== 'iris' && v.quantidade !== undefined) || (v.valor_centavos !== undefined && v.valor_centavos !== opcao.valorCentavos)) return null
      return { versao: 1, oferta: opcao.oferta, componente: opcao.componente, ...(opcao.quantidade !== undefined ? { quantidade: opcao.quantidade } : {}),
        valor_centavos: opcao.valorCentavos, referencia: v.referencia.trim(), data: v.data }
    }
    if (tipo === 'retencao_3m') {
      if (!chaves(v, ['versao', 'referencia', 'inicio', 'data', 'ativa']) || !data(v.inicio) || typeof v.ativa !== 'boolean' || v.data < terceiroMes(v.inicio)) return null
      return { versao: 1, referencia: v.referencia.trim(), inicio: v.inicio, data: v.data, ativa: v.ativa }
    }
    if (!chaves(v, ['versao', 'referencia', 'data'])) return null
    return { versao: 1, referencia: v.referencia.trim(), data: v.data }
  } catch { return null }
}
export function textoDoRegistroAarr(tipo: TipoAarr, valor: unknown): string {
  const candidato = JSON.stringify({ versao: 1, ...(tipo === 'origem' || tipo === 'motivo_perda' ? { valor } : valor as object) })
  const registro = lerRegistroAarr(tipo, candidato)
  if (!registro) throw new Error('Registro comercial inválido: confira catálogo, referência e datas.')
  return JSON.stringify(registro)
}
export function textoDoRegistroReceita(tipo: 'valor_proposta' | 'pagamento_confirmado', opcao: OpcaoReceita, referencia: string, data: string): string {
  return textoDoRegistroAarr(tipo, { oferta: opcao.oferta, componente: opcao.componente, quantidade: opcao.quantidade, valor_centavos: opcao.valorCentavos, referencia, data })
}
const referenciaNormal = (v: string) => v.trim().normalize('NFKC').toLocaleLowerCase('pt-BR')
export function chaveDoPagamento(r: RegistroReceita): string { return `${referenciaNormal(r.referencia)}|${r.data}|${r.oferta}|${r.componente}` }
export function registroCompativelComLead(lead: LeadReceita, r: RegistroAarr): boolean {
  return !('oferta' in r) || opcoesDeterministicasDeReceita(lead, r.quantidade).some(o => o.oferta === r.oferta && o.componente === r.componente && o.valorCentavos === r.valor_centavos)
}
export function aarrDoLead(lead: Pick<CrmLead, 'eventos' | 'produto'> & Partial<Pick<CrmLead, 'plus'>>, agora: number): ReceitaDoLead {
  const r: ReceitaDoLead = { propostas: [], pagamentos: [], retencoes: [], indicacoes: { pedidas: [], recebidas: [] } }
  const pagamentos = new Set<string>(), propostas = new Set<string>()
  for (const e of [...(lead.eventos ?? [])].filter(e => e.origem === 'manual' && Date.parse(e.em) <= agora).sort((a, b) => a.em.localeCompare(b.em))) {
    const v = lerRegistroAarr(e.tipo, e.registroTexto ?? e.texto, agora)
    if (!v || !registroCompativelComLead(lead, v)) continue
    if (e.tipo === 'receita_desfeita') {
      const desfazer = v as ReceitaDesfeita
      if (desfazer.tipo === 'pagamento_confirmado') { r.pagamentos = r.pagamentos.filter(p => p.chave !== desfazer.referencia); pagamentos.delete(desfazer.referencia) }
      else { r.propostas = r.propostas.filter(p => chaveDoPagamento(p) !== desfazer.referencia); propostas.delete(desfazer.referencia) }
    } else if ('oferta' in v) {
      const chave = chaveDoPagamento(v), vistos = e.tipo === 'valor_proposta' ? propostas : pagamentos
      if (vistos.has(chave)) continue
      if (e.tipo === 'pagamento_confirmado' && r.pagamentos.some(p => p.oferta === 'fonte' && v.oferta === 'fonte' && referenciaNormal(p.referencia) === referenciaNormal(v.referencia)
        && (p.componente === 'implantacao') !== (v.componente === 'implantacao'))) continue
      vistos.add(chave)
      if (e.tipo === 'pagamento_confirmado') r.pagamentos.push({ ...v, chave, em: e.em })
      else r.propostas.push({ ...v, em: e.em })
    } else if (e.tipo === 'origem') r.origem = (v as { valor: OrigemAarr }).valor
    else if (e.tipo === 'motivo_perda') r.motivoPerda = (v as { valor: MotivoPerdaAarr }).valor
    else if (e.tipo === 'retencao_3m') {
      const ret = v as RegistroRetencao
      r.retencoes = r.retencoes.filter(p => referenciaNormal(p.referencia) !== referenciaNormal(ret.referencia))
      r.retencoes.push({ ...ret, em: e.em })
    } else {
      const lista = e.tipo === 'indicacao_pedida' ? r.indicacoes.pedidas : r.indicacoes.recebidas
      const indicacao = v as RegistroIndicacao
      if (!lista.some(p => referenciaNormal(p.referencia) === referenciaNormal(indicacao.referencia))) lista.push({ ...indicacao, em: e.em })
    }
  }
  // Valores humanos do ciclo são preservados; não passam pela tabela do legado.
  const ciclo = cicloDoLead(lead, agora)
  for (const p of ciclo.pagamentos) {
    const evento = lead.eventos.find(e => lerEventoCiclo(e.registroTexto ?? e.texto, agora)?.id === p.id)
    r.pagamentos.push({ versao: 1, oferta: p.ofertaId, componente: p.componente === 'mensal' ? 'mensalidade' : 'implantacao',
      valor_centavos: p.valor, referencia: p.referencia, data: p.data, em: evento?.em ?? `${p.data}T12:00:00-03:00`, chave: `ciclo:${p.id}` })
  }
  // Só a versão enviada representa valor de proposta; rascunhos não entram no funil.
  const enviadas = ciclo.propostas.filter(p => ciclo.envios.some(e => e.vinculo === p.id))
    .filter(p => !ciclo.propostas.some(n => referenciaNormalCiclo(n.referencia) === referenciaNormalCiclo(p.referencia) && n.versao! > p.versao! && ciclo.envios.some(e => e.vinculo === n.id)))
  for (const p of enviadas) for (const [componente, valor] of [['implantacao', p.valor], ['mensalidade', p.mensalidade]] as const) {
    if (valor === undefined) continue
    r.propostas.push({ versao: 1, oferta: p.ofertaId!, componente, valor_centavos: valor, referencia: `ciclo:${p.id}`, data: p.data, em: `${p.data}T12:00:00-03:00` })
  }
  return r
}
export function resumoDoRegistroAarr(tipo: TipoAarr, v: RegistroAarr): string {
  if (tipo === 'receita_desfeita') return `Registro de ${(v as ReceitaDesfeita).tipo === 'pagamento_confirmado' ? 'pagamento' : 'valor da proposta'} desfeito · ${(v as ReceitaDesfeita).data}`
  if ('oferta' in v) return `${tipo === 'pagamento_confirmado' ? 'Pagamento confirmado' : 'Valor de proposta registrado'} · ${v.oferta} · ${v.componente} · ${(v.valor_centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · ${v.data}`
  if ('ativa' in v) return `Mensalidade no terceiro mês: ${v.ativa ? 'ativa' : 'inativa'} · ${v.data}`
  if ('valor' in v) return `${tipo === 'origem' ? 'Origem' : 'Motivo da perda'}: ${v.valor}`
  return `Indicação ${tipo === 'indicacao_pedida' ? 'pedida' : 'recebida'} · ${v.data}`
}
export function indicacaoPendente(lead: Pick<CrmLead, 'eventos' | 'produto'> & Partial<Pick<CrmLead, 'plus'>>, agora: number) {
  const r = aarrDoLead(lead, agora)
  if (r.indicacoes.pedidas.length) return undefined
  return [...r.pagamentos].sort((a, b) => a.data.localeCompare(b.data)).find(p => Date.parse(`${p.data}T00:00:00-03:00`) + 30 * 86400_000 <= agora)
}
/** Uma assinatura por lead+oferta; referência do recibo muda todo mês e não cria outra assinatura. */
export function contratosMensais(lead: Pick<CrmLead, 'eventos' | 'produto'> & Partial<Pick<CrmLead, 'plus'>>, agora: number) {
  const r = aarrDoLead(lead, agora)
  const ofertas = [...new Set(r.pagamentos.filter(p => p.componente === 'mensalidade').map(p => p.oferta))]
  return ofertas.map(oferta => {
    const recibos = r.pagamentos.filter(p => p.oferta === oferta && p.componente === 'mensalidade').sort((a, b) => a.data.localeCompare(b.data))
    const inicio = recibos[0]!.data
    const retencao = r.retencoes.find(p => p.referencia === oferta && p.inicio === inicio)
    return { referencia: oferta, oferta, inicio, terceiroMes: terceiroMes(inicio), valorCentavos: (() => { const ciclo = cicloDoLead(lead, agora); const p = ciclo.pagamentos.filter(p => p.ofertaId === oferta && p.componente === 'mensal').at(-1); return p ? ciclo.propostas.find(v => v.id === p.propostaId)!.mensalidade! : recibos.at(-1)!.valor_centavos })(), retencao }
  })
}
export interface LinhaDeCanal {
  canal: CanalAarr
  /** Enviados, respostas de gente e "quero ver" qualificado: a janela de 30 dias da aquisição. */
  enviados: number; respostas: number; ativados: number
  /** Recebimentos únicos desde a instrumentação (19/10/2026), por lead, referência e data. */
  pagamentos: number
  /** Respostas / enviados, só com ao menos AMOSTRA_MINIMA enviados; abaixo disso não há taxa. */
  taxaDeResposta: number | null
}
export interface LinhaDeMotivo { motivo: MotivoAgregadoAarr; quantidade: number }
export interface LeituraDeCanais {
  linhas: LinhaDeCanal[]
  /** Leads com a origem confirmada na Ficha. Zero = nenhum registro: a tela diz "sem registro". */
  comOrigem: number
}
export interface LeituraDePerdas { perdidos: number; comMotivo: number; porMotivo: LinhaDeMotivo[] }
export interface LeituraDePropostas {
  /** Registros de valor, leads distintos e a soma do que foi registrado (implantação e mensalidade separadas, como a receita). */
  registros: number; leads: number; implantacaoCentavos: number; mensalidadeCentavos: number
  /** Leads em Proposta sem nenhum valor registrado: o que falta registrar, não um valor suposto. */
  semValor: number
}
export const CANAIS_AARR: readonly CanalAarr[] = [...ORIGENS_AARR, 'sem-origem']
/** Os nomes na tela (Ficha e Resultados leem daqui); os dois "sem" dizem que o registro não traz o dado. */
export const ROTULO_DA_ORIGEM: Record<CanalAarr, string> = { cacador: 'Caçador', plus: 'Plus', indicacao: 'Indicação', CDL: 'CDL', anuncio: 'Anúncio', 'sem-origem': 'Sem origem' }
export const ROTULO_DO_MOTIVO: Record<MotivoAgregadoAarr, string> = { preco: 'Preço', timing: 'Timing', 'sem-dor': 'Sem dor', decisor: 'Decisor', concorrente: 'Concorrente', sumiu: 'Sumiu', 'sem-motivo': 'Sem motivo registrado' }

export function leituraAarr(leads: readonly CrmLead[], agora: number) {
  const inicio = Date.parse(INICIO_AARR), hoje = diaAarr(agora)
  const dia = Math.floor((agora - 10800_000) / 86400_000), semana = new Date(dia * 86400_000).getUTCDay()
  const inicioSemana = new Date((dia - (semana + 6) % 7) * 86400_000).toISOString().slice(0, 10)
  const existentes = leads.filter(l => Date.parse(l.marcos.enviado ?? '') <= agora)
  const enviados = existentes.filter(l => Date.parse(l.marcos.enviado!) >= agora - 30 * 86400_000)
  const noPeriodo = (v: string | undefined, l: CrmLead) => { const t = Date.parse(v ?? ''); return t >= Date.parse(l.marcos.enviado!) && t <= agora }
  // ultimaEntrada vem só de gente/recepção no observador; robô posterior não apaga essa evidência.
  const respondeu = (l: CrmLead) => { const t = ultimaRespostaHumanaEm(l, agora); return t >= Date.parse(l.marcos.enviado!) && t <= agora }
  const quisVerHumano = (l: CrmLead) => pedeMaterial(l.resposta) && noPeriodo(l.resposta?.em ?? l.marcos.respondeu, l)
  const respostas = enviados.filter(respondeu)
  const leituras = leads.map(l => ({ lead: l, r: aarrDoLead(l, agora) }))
  const todos = leituras.flatMap(l => l.r.pagamentos.map(p => ({ ...p, leadId: l.lead.id })))
  const pagamentos = todos.filter(p => p.data >= INICIO_AARR.slice(0, 10))
  const daSemana = todos.filter(p => p.data >= inicioSemana && p.data <= hoje)
  const recebimentos = (ps: typeof todos) => new Set(ps.map(p => `${p.leadId}|${referenciaNormal(p.referencia)}|${p.data}`)).size
  // Canal (origem registrada), perdas (motivo registrado) e propostas (valor registrado): só o que o Rômulo confirmou na Ficha.
  const canalDe = (l: { r: ReceitaDoLead }): CanalAarr => l.r.origem ?? 'sem-origem'
  const doCanal = (canal: CanalAarr) => leituras.filter(l => canalDe(l) === canal)
  const linhasDeCanal: LinhaDeCanal[] = CANAIS_AARR.map(canal => {
    const dele = new Set(doCanal(canal).map(l => l.lead.id))
    const envios = enviados.filter(l => dele.has(l.id))
    const responderam = envios.filter(respondeu)
    const pagos = new Set(pagamentos.filter(p => dele.has(p.leadId)).map(p => `${p.leadId}|${referenciaNormal(p.referencia)}|${p.data}`)).size
    return { canal, enviados: envios.length, respostas: responderam.length,
      ativados: responderam.filter(l => quisVerHumano(l) && qualificadoParaProposta(l)).length, pagamentos: pagos,
      taxaDeResposta: envios.length >= AMOSTRA_MINIMA ? responderam.length / envios.length : null }
  }).filter(l => l.enviados || l.pagamentos)
  const perdidos = leituras.filter(l => l.lead.etapa === 'perdido')
  const porMotivo: LinhaDeMotivo[] = ([...MOTIVOS_PERDA_AARR, 'sem-motivo'] as MotivoAgregadoAarr[])
    .map(motivo => ({ motivo, quantidade: perdidos.filter(l => (l.r.motivoPerda ?? 'sem-motivo') === motivo).length })).filter(l => l.quantidade)
  const propostas = leituras.flatMap(l => l.r.propostas.filter(p => p.data >= INICIO_AARR.slice(0, 10)).map(p => ({ ...p, leadId: l.lead.id })))
  const comValor = new Set(propostas.map(p => p.leadId))
  const contratos = leads.flatMap(l => contratosMensais(l, agora))
  const elegiveis = contratos.filter(c => c.terceiroMes <= hoje)
  const ativas = elegiveis.filter(c => c.retencao?.ativa)
  return {
    desde: INICIO_AARR, historicoNaoMedido: true as const, janelaAquisicao: '30dias' as const,
    aquisicao: { enviados: enviados.length, respostas: respostas.length },
    ativacao: { respostas: respostas.length, qualificados: respostas.filter(l => quisVerHumano(l) && qualificadoParaProposta(l)).length },
    receita: { pagamentos: recebimentos(pagamentos), componentes: pagamentos.length, valorCentavos: pagamentos.reduce((s, p) => s + p.valor_centavos, 0),
      implantacaoCentavos: pagamentos.filter(p => p.componente !== 'mensalidade').reduce((s, p) => s + p.valor_centavos, 0), mensalidadeCentavos: pagamentos.filter(p => p.componente === 'mensalidade').reduce((s, p) => s + p.valor_centavos, 0),
      mrrCentavos: ativas.reduce((s, c) => s + c.valorCentavos, 0) },
    canais: { linhas: linhasDeCanal, comOrigem: leituras.filter(l => l.r.origem).length } satisfies LeituraDeCanais,
    perdas: { perdidos: perdidos.length, comMotivo: perdidos.filter(l => l.r.motivoPerda).length, porMotivo } satisfies LeituraDePerdas,
    propostas: { registros: propostas.length, leads: comValor.size,
      implantacaoCentavos: propostas.filter(p => p.componente !== 'mensalidade').reduce((s, p) => s + p.valor_centavos, 0),
      mensalidadeCentavos: propostas.filter(p => p.componente === 'mensalidade').reduce((s, p) => s + p.valor_centavos, 0),
      semValor: leads.filter(l => l.etapa === 'proposta' && !comValor.has(l.id)).length } satisfies LeituraDePropostas,
    retencao: { elegiveis: elegiveis.length, ativas: ativas.length },
    indicacao: { pedidas: leituras.reduce((s, l) => s + l.r.indicacoes.pedidas.filter(i => i.data >= INICIO_AARR.slice(0, 10)).length, 0), recebidas: leituras.reduce((s, l) => s + l.r.indicacoes.recebidas.filter(i => i.data >= INICIO_AARR.slice(0, 10)).length, 0) },
    estrelaGuia: { inicioSemana, pagamentos: recebimentos(daSemana), valorCentavos: daSemana.reduce((s, p) => s + p.valor_centavos, 0) },
  }
}
