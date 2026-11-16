/** Projeção de leitura: relacionamentos e oportunidades, sem alterar IDs ou etapas legadas. */
import { aarrDoLead, type OrigemAarr } from './aarr'
import { cicloDoLead, lerEventoCiclo, validarTransicaoCiclo, PREFIXO_CICLO } from './ciclo-comercial'
import { dataRealDoSpiced, lerSpiced, lerRegistroSpiced } from './spiced'
import { identidadeDaConversa, projetarResponsavelConversa } from './responsavel-conversa'
import { projetarQualificacaoComercial, temQualificacaoComercial } from './qualificacao-comercial'
import type { CrmLead, CrmProduto } from './types'

export interface ContaDaCarteira {
  id: string
  nome: string
  identidade: 'place-id' | 'provisoria'
  fontes: CrmProduto[]
  origens: Array<{ leadId: string; fonteLegada: CrmProduto; canal: OrigemAarr | 'nao-informado'; oferta: Exclude<CrmProduto, 'plus'> | null }>
  relacoes: string[]
  conversaIds: string[]
  oportunidadeIds: string[]
  alertas: string[]
}
export interface ConversaDaCarteira {
  id: string
  relacoes: string[]
  contaIds: string[]
  humana: boolean
  responsavel?: 'romulo' | 'time'
  alertas: string[]
}
export interface OportunidadeDaCarteira {
  id: string
  contaId: string
  empresa: string
  fonte: CrmProduto
  canal: OrigemAarr | 'nao-informado'
  oferta: Exclude<CrmProduto, 'plus'> | null
  qualificacao: 'necessidade-e-intencao' | 'evidencia-comercial'
  situacao: 'em-andamento' | 'revisar' | 'encerrada'
  propostaEnviada: boolean
  contratacaoConfirmada: boolean
  recebidoCentavos: number
  proximoPasso?: CrmLead['proximoPasso']
  responsavel?: 'romulo' | 'time'
  evidencias: string[]
  alertas: string[]
}
export interface CarteiraCrm {
  versao: 1
  contagens: {
    cadastros: number; contas: number; contasProvisorias: number; conversas: number; conversasHumanas: number
    oportunidades: number; oportunidadesAtivas: number; oportunidadesEmRevisao: number; oportunidadesEncerradas: number
    propostasEnviadas: number; contratacoesConfirmadas: number; comRecebimento: number
  }
  cobertura: { fonteDisponivel: boolean; comQualificacao: number; comProximoPasso: number; comResponsavel: number; alertas: string[] }
  contas: ContaDaCarteira[]
  conversas: ConversaDaCarteira[]
  oportunidades: OportunidadeDaCarteira[]
}
type LeadDaCarteira = Pick<CrmLead, 'id' | 'chave' | 'produto' | 'empresa' | 'links' | 'eventos' | 'etapa' | 'marcos'>
  & Partial<Pick<CrmLead, 'spiced' | 'classificacaoResposta' | 'conversa' | 'proposta' | 'proximoPasso' | 'qualificacaoComercial' | 'plus' | 'motivoPerda' | 'perdaManual' | 'ganhoManual'>>
const validoAte = (data: string | undefined, agora: number) => Number.isFinite(Date.parse(data ?? '')) && Date.parse(data!) <= agora
const unico = <T>(lista: T[], valor: T) => { if (!lista.includes(valor)) lista.push(valor) }

/** Telefone compartilhado é vínculo de conversa, nunca prova de mesma empresa. */
function identidadeDaConta(lead: LeadDaCarteira): Pick<ContaDaCarteira, 'id' | 'identidade'> {
  // A chave da fonte Site vem da coluna place_id; IDs das outras fontes não têm essa semântica.
  if (lead.produto === 'site' && lead.chave.trim()) return { id: `place:${lead.chave}`, identidade: 'place-id' }
  try {
    const url = new URL(lead.links.maps ?? '')
    const google = /(^|\.)google\.(com|com\.br)$/.test(url.hostname)
    const place = google ? url.searchParams.get('query_place_id') ?? url.searchParams.get('place_id') : null
    if (place && /^[A-Za-z0-9_-]{5,255}$/.test(place)) return { id: `place:${place}`, identidade: 'place-id' }
  } catch { /* Ausência de identidade permanece explícita. */ }
  return { id: `fonte:${lead.id}`, identidade: 'provisoria' }
}
function proximoPassoConfirmado(lead: LeadDaCarteira, agora: number): CrmLead['proximoPasso'] | undefined {
  const p = lead.proximoPasso
  return p?.texto.trim() && p.data && dataRealDoSpiced(p.data) && validoAte(p.registradoEm, agora) ? { ...p } : undefined
}
const telefoneDaConversa = (lead: Pick<CrmLead, 'links'>) => identidadeDaConversa(lead)?.conversa ?? null
function responsavelConfirmado(lead: LeadDaCarteira, leads: readonly LeadDaCarteira[], agora: number): 'romulo' | 'time' | undefined {
  const leitura = projetarResponsavelConversa(lead, leads, agora)
  return leitura.estado === 'definido' ? leitura.registro?.responsavel : undefined
}
function conversaHumanaComprovada(lead: LeadDaCarteira, agora: number): boolean {
  // A leitura contextual explícita prevalece sobre o resumo, inclusive quando é false/pendente.
  if (lead.classificacaoResposta) return lead.classificacaoResposta.houveRespostaHumana === true
  // Resumos antigos chamavam entradas sem papel de gente. Só uma entrada identificada como
  // recepção e temporalmente válida comprova humanidade sem a classificação contextual.
  const mensagens = [...(lead.conversa?.recentes ?? []), ...(lead.conversa?.ultima ? [lead.conversa.ultima] : [])]
  return mensagens.some(m => m.direcao === 'entrada' && m.papel === 'recepcao' && validoAte(m.em, agora))
}
/** Revalida importados em ordem de registro; formato isolado não comprova a cadeia financeira. */
function cicloConferido(lead: LeadDaCarteira, agora: number) {
  const aceitos: CrmLead['eventos'] = [], alertas: string[] = []
  for (const registro of [...lead.eventos].filter(e => e.tipo === 'nota' && e.origem === 'manual' && validoAte(e.em, agora))
    .sort((a, b) => Date.parse(a.em) - Date.parse(b.em))) {
    const texto = registro.registroTexto ?? registro.texto
    if (!texto?.startsWith(PREFIXO_CICLO)) continue
    const evento = lerEventoCiclo(texto, agora)
    if (!evento) { unico(alertas, 'Há registro de ciclo inválido ou futuro; não foi usado como prova comercial.'); continue }
    try { validarTransicaoCiclo({ eventos: aceitos }, evento, agora); aceitos.push(registro) }
    catch { unico(alertas, 'Há registro de ciclo sem cadeia, saldo ou ordem válidos; conferir a fonte antes de reconhecer o fato.') }
  }
  const ciclo = cicloDoLead({ eventos: aceitos }, agora)
  for (const problema of ciclo.problemas) unico(alertas, `Conferir ciclo comercial: ${problema}`)
  return { ciclo, alertas }
}

export function projetarCarteiraCrm(leads: readonly LeadDaCarteira[], agora = Date.now(), fonteDisponivel = true): CarteiraCrm {
  const contas = new Map<string, ContaDaCarteira>(), conversas = new Map<string, ConversaDaCarteira>()
  const oportunidades: OportunidadeDaCarteira[] = []
  const vistos = new Set<string>()
  let comQualificacao = 0, comProximoPasso = 0, comResponsavel = 0
  const porConversa = new Map<string, LeadDaCarteira[]>()
  for (const lead of leads) {
    const telefone = telefoneDaConversa(lead)
    if (telefone) { const grupo = porConversa.get(telefone) ?? []; grupo.push(lead); porConversa.set(telefone, grupo) }
  }
  for (const lead of leads) {
    if (vistos.has(lead.id)) continue
    vistos.add(lead.id)
    const identidade = identidadeDaConta(lead)
    const conta = contas.get(identidade.id) ?? { ...identidade, nome: lead.empresa, fontes: [], origens: [], relacoes: [], conversaIds: [], oportunidadeIds: [], alertas: [] }
    contas.set(conta.id, conta)
    unico(conta.fontes, lead.produto); unico(conta.relacoes, lead.id)
    // O leitor legado também projeta notas de ciclo sem verificar suas dependências. Aqui elas são
    // retiradas dessa leitura e validadas separadamente, sem mudar o contrato AARR compartilhado.
    const legado = { ...lead, eventos: lead.eventos.filter(e => !(e.registroTexto ?? e.texto)?.startsWith(PREFIXO_CICLO)) }
    const receita = aarrDoLead(legado, agora)
    const canal = lead.produto === 'plus' ? 'plus' : receita.origem ?? 'nao-informado'
    const oferta = lead.produto === 'plus' ? lead.plus?.oferta ?? null : lead.produto
    conta.origens.push({ leadId: lead.id, fonteLegada: lead.produto, canal, oferta })
    if (conta.identidade === 'provisoria') unico(conta.alertas, 'Identidade empresarial ainda não vinculada; este cadastro não comprova uma empresa única.')
    if (conta.nome !== lead.empresa) unico(conta.alertas, 'A mesma identidade de lugar possui nomes diferentes nas fontes; conferir o cadastro.')
    const qualificacaoNova = projetarQualificacaoComercial(lead, agora)
    const usaQualificacaoNova = temQualificacaoComercial(lead, agora)
    const responsavel = responsavelConfirmado(lead, porConversa.get(telefoneDaConversa(lead) ?? '') ?? [lead], agora)
    const proximoPasso = proximoPassoConfirmado(lead, agora) ?? (qualificacaoNova?.proximoPasso.aceito && qualificacaoNova.proximoPasso.descricao.trim()
      ? { texto: qualificacaoNova.proximoPasso.descricao, data: '', registradoEm: qualificacaoNova.em } : undefined)
    if (responsavel) comResponsavel++
    if (proximoPasso) comProximoPasso++
    const telefone = telefoneDaConversa(lead)
    if (telefone) {
      const id = `whatsapp:${telefone}`
      const conversa = conversas.get(id) ?? { id, relacoes: [], contaIds: [], humana: false, alertas: [] }
      unico(conversa.relacoes, lead.id); unico(conversa.contaIds, conta.id); unico(conta.conversaIds, id)
      conversa.humana ||= conversaHumanaComprovada(lead, agora)
      if (responsavel) {
        if (conversa.responsavel && conversa.responsavel !== responsavel) {
          delete conversa.responsavel
          unico(conversa.alertas, 'Responsáveis divergentes nas relações desta conversa; conferir antes de agir.')
        } else if (!conversa.alertas.length) conversa.responsavel = responsavel
      }
      conversas.set(id, conversa)
    }
    const spiced = lerSpiced(lead.spiced)
    const ultimoSpiced = [...lead.eventos].filter(e => e.tipo === 'spiced' && e.origem === 'manual' && validoAte(e.em, agora))
      .sort((a, b) => Date.parse(a.em) - Date.parse(b.em)).at(-1)
    const registrado = ultimoSpiced && lerRegistroSpiced(ultimoSpiced.registroTexto ?? ultimoSpiced.texto)
    const necessidadeConfirmada = Boolean(spiced?.dor && registrado?.dor && JSON.stringify(registrado) === JSON.stringify(spiced))
    const leitura = lead.classificacaoResposta
    // Permissão, encaminhamento, saudação e silêncio nunca criam oportunidade por si.
    const intencao = leitura?.classe === 'interesse' && Boolean(leitura.evidencia?.trecho.trim()) && validoAte(leitura.evidencia?.em, agora)
      || Boolean(leitura?.interesseHistorico?.trecho.trim()) && validoAte(leitura?.interesseHistorico?.em, agora)
    // A nota comercial vigente prevalece, inclusive quando limpa a necessidade ou registra recusa.
    // Não voltamos ao SPICED antigo para contornar uma revisão nova incompleta/inválida.
    const necessidadeEIntencao = usaQualificacaoNova
      ? Boolean(qualificacaoNova?.necessidade.trim() && ['avaliar', 'contratar'].includes(qualificacaoNova.intencao))
      : Boolean(necessidadeConfirmada && intencao)
    if (necessidadeEIntencao) comQualificacao++
    const conferido = cicloConferido(lead, agora), ciclo = conferido.ciclo
    const enviadas = ciclo.eventos.filter(e => e.tipo === 'proposta_enviada' && ciclo.propostas.some(p => p.id === e.vinculo && p.data <= e.data))
    const aceites = ciclo.aceites.filter(e => enviadas.some(p => p.vinculo === e.vinculo && p.data <= e.data))
    const propostaLegada = Boolean(lead.proposta && validoAte(lead.proposta.em, agora))
    const propostaEnviada = propostaLegada || enviadas.length > 0
    const contratacaoConfirmada = aceites.length > 0
    // Usa o leitor financeiro existente, que já preserva correções e evita duplicar recibos entre contratos.
    const referenciasLegadas = new Set(receita.pagamentos.map(p => p.referencia.trim().normalize('NFKC').toLocaleLowerCase('pt-BR')))
    const pagamentosCiclo = ciclo.eventos.filter(e => e.tipo === 'pagamento' && !referenciasLegadas.has(e.referencia.trim().normalize('NFKC').toLocaleLowerCase('pt-BR')))
    const recebidoCentavos = receita.pagamentos.reduce((s, p) => s + p.valor_centavos, 0) + pagamentosCiclo.reduce((s, p) => s + p.valor!, 0)
    for (const alerta of conferido.alertas) unico(conta.alertas, alerta)
    if (!necessidadeEIntencao && !propostaEnviada && !contratacaoConfirmada && recebidoCentavos <= 0) continue
    const evidencias: string[] = [], alertas: string[] = [...conferido.alertas]
    if (necessidadeEIntencao) evidencias.push('Necessidade registrada pelo operador e intenção comercial explícita na conversa.')
    if (propostaLegada) { evidencias.push('Proposta enviada registrada no histórico de Vendas.'); alertas.push('Proposta legada: conferir a versão e as condições antes de contratar.') }
    if (enviadas.length) evidencias.push('Envio vinculado à versão da proposta no ciclo comercial.')
    if (contratacaoConfirmada) evidencias.push('Aceite vinculado à versão enviada da proposta.')
    if (recebidoCentavos > 0) evidencias.push('Recebimento explicitamente confirmado na aba CRM; não é inferido do ganho.')
    if (receita.pagamentos.length) alertas.push('Recebimento no contrato AARR legado; preservado como confirmação humana, sem presumir cadeia contratual estruturada.')
    if (!necessidadeEIntencao) alertas.push('Necessidade e intenção ainda não têm cobertura completa; a oportunidade existe por evidência comercial posterior.')
    if (!proximoPasso) alertas.push('Próximo passo não confirmado.')
    if (!responsavel) alertas.push('Responsável da conversa não confirmado.')
    if (lead.ganhoManual && !contratacaoConfirmada) alertas.push('Ganho legado não comprova aceite estruturado nem recebimento.')
    if (recebidoCentavos > 0 && !contratacaoConfirmada) alertas.push('Recebimento não confirma, por si, o aceite contratual desta oportunidade.')
    if (lead.etapa === 'perdido') alertas.push(lead.motivoPerda === 'expirou' || lead.motivoPerda === 'esfriou' || lead.motivoPerda === 'proposta-sem-retorno'
      ? 'Encerramento legado por tempo: revisar, sem presumir recusa.' : 'O cadastro tem encerramento legado; a projeção não o reabre nem autoriza contato.')
    const porTempo = ['expirou', 'esfriou', 'proposta-sem-retorno'].includes(lead.motivoPerda ?? '')
    const encerrada = qualificacaoNova?.intencao === 'sem-interesse' || qualificacaoNova?.adequacao.estado === 'inadequada'
      || ['recusa', 'exclusao'].includes(leitura?.classe ?? '') || Boolean(lead.perdaManual)
      || lead.etapa === 'perdido' && !porTempo
    const situacao: OportunidadeDaCarteira['situacao'] = encerrada ? 'encerrada'
      : porTempo || !necessidadeEIntencao || !proximoPasso || !responsavel || conferido.alertas.length ? 'revisar' : 'em-andamento'
    oportunidades.push({ id: lead.id, contaId: conta.id, empresa: lead.empresa, fonte: lead.produto, canal, oferta,
      qualificacao: necessidadeEIntencao ? 'necessidade-e-intencao' : 'evidencia-comercial', situacao, propostaEnviada, contratacaoConfirmada,
      recebidoCentavos, ...(proximoPasso ? { proximoPasso } : {}), ...(responsavel ? { responsavel } : {}), evidencias, alertas })
    conta.oportunidadeIds.push(lead.id)
  }
  for (const conversa of conversas.values()) if (conversa.contaIds.length > 1) {
    conversa.alertas.push('Mesmo WhatsApp em contas diferentes: associação de conversa, sem fusão de empresas.')
    for (const id of conversa.contaIds) unico(contas.get(id)!.alertas, 'WhatsApp compartilhado com outro cadastro; identidade empresarial não presumida.')
  }
  const listaContas = [...contas.values()], listaConversas = [...conversas.values()]
  return { versao: 1, contagens: { cadastros: vistos.size, contas: contas.size, contasProvisorias: listaContas.filter(c => c.identidade === 'provisoria').length,
    conversas: conversas.size, conversasHumanas: listaConversas.filter(c => c.humana).length, oportunidades: oportunidades.length,
    oportunidadesAtivas: oportunidades.filter(o => o.situacao === 'em-andamento').length,
    oportunidadesEmRevisao: oportunidades.filter(o => o.situacao === 'revisar').length,
    oportunidadesEncerradas: oportunidades.filter(o => o.situacao === 'encerrada').length,
    propostasEnviadas: oportunidades.filter(o => o.propostaEnviada).length, contratacoesConfirmadas: oportunidades.filter(o => o.contratacaoConfirmada).length,
    comRecebimento: oportunidades.filter(o => o.recebidoCentavos > 0).length },
    cobertura: { fonteDisponivel, comQualificacao, comProximoPasso, comResponsavel, alertas: [
      ...(!fonteDisponivel ? ['Fonte de Vendas indisponível: contagens vazias não comprovam ausência de negócio.'] : []),
      'Contas provisórias não são empresas únicas; telefone e nome não autorizam fusão.',
      'Contagens de propostas e recebimentos são fatos registrados por relação, não taxa de conversão nem receita fora de Vendas.',
    ] }, contas: listaContas, conversas: listaConversas, oportunidades }
}
