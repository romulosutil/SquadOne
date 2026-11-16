import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { projetarCarteiraCrm } from './operations/carteira-crm'
import { PREFIXO_CICLO, type EventoCiclo } from './operations/ciclo-comercial'
import type { CrmLead, CrmEvento } from './operations/types'
import { spicedVazio } from './operations/spiced'
import { textoResponsavelConversa, identidadeDaConversa } from './operations/responsavel-conversa'
import { textoDaQualificacaoComercial } from './operations/qualificacao-comercial'
import { montarCrm, validarRetrato, visaoSemRetrato } from '../server/crm'

const agora = Date.parse('2026-11-16T12:00:00Z'), em = '2026-11-13T12:00:00Z'
const telefone = '5527999990001'
function lead(id = 'site:PLACE-01', extra: Partial<CrmLead> = {}): CrmLead {
  return { id, chave: id.split(':').slice(1).join(':'), produto: 'site', empresa: 'Empresa sintética', nicho: 'Serviços', cidade: 'Cidade de teste',
    etapa: 'novo', sinal: 'pronto', subEtapa: 'Pronto', estadoNaPlanilha: 'pronto', leitura: 'desconhecida', marcos: {}, followupHoje: false,
    respostaNova: false, acervo: false, notas: 0, links: { whatsapp: `https://wa.me/${telefone}` }, eventos: [], divergencias: [], ...extra }
}
function classificacao(classe: NonNullable<CrmLead['classificacaoResposta']>['classe'], texto = 'Tenho interesse em contratar'): NonNullable<CrmLead['classificacaoResposta']> {
  return { versao: 'respostas-2026-11-06-contexto', classe, motivo: 'Fala sintética conferida', evidencia: { trecho: texto, em },
    houveRespostaHumana: !['robo', 'silencio', 'nao-contatado'].includes(classe), materialSolicitado: false, revisar: false, leituraConfirmada: false }
}
function qualificado(extra: Partial<CrmLead> = {}) {
  const spiced = { ...spicedVazio(), dor: 'Orçamentos ficam sem acompanhamento' }
  return lead('site:PLACE-01', { spiced, classificacaoResposta: classificacao('interesse'), eventos: [evento('spiced', JSON.stringify(spiced))], ...extra })
}
function evento(tipo: string, texto: string): CrmEvento { return { tipo, texto, registroTexto: texto, em, rotulo: 'Evento sintético', origem: 'manual', fonte: 'CRM sintético' } }
function ciclo(v: Partial<EventoCiclo> & Pick<EventoCiclo, 'id' | 'tipo'>) {
  return evento('nota', PREFIXO_CICLO + JSON.stringify({ v: 1, data: '2026-11-13', humano: true, referencia: `ref-${v.id}`, ...(v.tipo === 'proposta' ? { responsavel: 'Rômulo' } : { evidencia: 'Referência sintética conferida' }), ...v }))
}
const proposta = ciclo({ id: 'proposta-01', tipo: 'proposta', ofertaId: 'encontrado', oferta: 'encontrado', versao: 1, escopo: 'Site de orçamento', prazo: 'Cinco dias úteis', valor: 69000, mensalidade: 3900, condicoes: 'Pagamento depois de ver funcionando' })
const enviada = ciclo({ id: 'envio-01', tipo: 'proposta_enviada', vinculo: 'proposta-01', evidencia: 'Recibo sintético da versão enviada' })
const aceite = ciclo({ id: 'aceite-01', tipo: 'aceite', vinculo: 'proposta-01', evidencia: 'Aceite sintético do responsável', documento: 'doc-01' })
const vista = ciclo({ id: 'vista-01', tipo: 'entrega_vista', vinculo: 'proposta-01', evidencia: 'Cliente conferiu a entrega sintética' })
const condicao = ciclo({ id: 'condicao-01', tipo: 'condicao_cobranca', vinculo: 'aceite-01', componente: 'inicial', valor: 69000, gatilho: 'site_visto_no_ar', condicao: 'Cliente conferiu site sintético no ar', vigenciaInicio: '2026-11-13' })
const cobranca = ciclo({ id: 'cobranca-01', tipo: 'cobranca', vinculo: 'condicao-01', componente: 'inicial', valor: 69000, vencimento: '2026-11-13', forma: 'Pix' })
const pagamento = ciclo({ id: 'pagamento-01', tipo: 'pagamento', vinculo: 'cobranca-01', componente: 'inicial', valor: 69000, evidencia: 'Recebimento sintético conferido', referencia: 'pix-sintetico' })

describe('Carteira CRM separa cadastro, conversa e evidência de negócio', () => {
  it('qualificação comercial vigente prevalece sobre o SPICED e preserva próximo passo aceito sem inventar data', () => {
    const q = { v: 1, id: 'qualificacao-01', em, humano: true, necessidade: 'Organizar pedidos de orçamento',
      adequacao: { estado: 'confirmada', oferta: 'encontrado', motivo: 'Escopo sintético pertinente' }, intencao: 'avaliar',
      decisao: 'Dono e sócia conferem a proposta', proximoPasso: { descricao: 'Conferir o escopo', aceito: true }, fonte: 'Conversa sintética', evidencia: 'Queremos avaliar a implantação' }
    const e = evento('nota', textoDaQualificacaoComercial(q, agora))
    const p = projetarCarteiraCrm([lead('site:NOVA', { eventos: [e] })], agora)
    assert.equal(p.contagens.oportunidades, 1)
    assert.equal(p.oportunidades[0]!.proximoPasso!.texto, 'Conferir o escopo')
    assert.equal(p.oportunidades[0]!.proximoPasso!.data, '')
    const limpa = evento('nota', textoDaQualificacaoComercial({ ...q, id: 'qualificacao-02', necessidade: '', intencao: 'desconhecida' }, agora))
    const l = qualificado(); l.eventos.push(limpa)
    assert.equal(projetarCarteiraCrm([l], agora).contagens.oportunidades, 0)
  })

  it('cadastro, permissão, encaminhamento, robô e ganho legado não fabricam oportunidade', () => {
    const ls = ['permissao', 'acesso', 'robo', 'silencio'].map((c, i) => lead(`iris:FONTE-${i}`, { produto: 'iris', classificacaoResposta: classificacao(c as 'permissao') }))
    ls.push(lead('site:GANHO', { etapa: 'ganho', ganhoManual: true }))
    const p = projetarCarteiraCrm(ls, agora)
    assert.equal(p.contagens.cadastros, 5)
    assert.equal(p.contagens.oportunidades, 0)
    assert.equal(p.contagens.comRecebimento, 0)
  })
  it('necessidade sem intenção e intenção sem necessidade permanecem descoberta', () => {
    assert.equal(projetarCarteiraCrm([qualificado({ classificacaoResposta: classificacao('permissao') })], agora).contagens.oportunidades, 0)
    assert.equal(projetarCarteiraCrm([lead('site:INTERESSE', { classificacaoResposta: classificacao('interesse') })], agora).contagens.oportunidades, 0)
    assert.equal(projetarCarteiraCrm([qualificado({ classificacaoResposta: classificacao('interesse', '') })], agora).contagens.oportunidades, 0)
  })
  it('necessidade e intenção comprovadas criam oportunidade sem impor proposta ou receita', () => {
    const p = projetarCarteiraCrm([qualificado()], agora)
    assert.equal(p.contagens.oportunidades, 1)
    assert.equal(p.oportunidades[0]!.qualificacao, 'necessidade-e-intencao')
    assert.equal(p.contagens.propostasEnviadas, 0)
    assert.equal(p.contagens.contratacoesConfirmadas, 0)
    assert.equal(p.oportunidades[0]!.recebidoCentavos, 0)
  })
  it('a mesma conversa pode vincular contas diferentes sem fundir empresas pelo telefone ou nome', () => {
    const p = projetarCarteiraCrm([lead(), lead('iris:CLINICA-01', { produto: 'iris' })], agora)
    assert.equal(p.contagens.contas, 2)
    assert.equal(p.contagens.contasProvisorias, 1)
    assert.equal(p.contagens.conversas, 1)
    assert.equal(p.conversas[0]!.contaIds.length, 2)
    assert.match(p.conversas[0]!.alertas.join(' '), /sem fusão/)
  })
  it('um Place ID explícito de Maps associa fontes diferentes sem apagar as relações originais', () => {
    const l = lead('prumo:EMPRESA-01', { produto: 'prumo', links: { maps: 'https://www.google.com/maps/search/?api=1&query=Empresa&query_place_id=PLACE-01' } })
    const p = projetarCarteiraCrm([lead(), l], agora)
    assert.equal(p.contagens.contas, 1)
    assert.deepEqual(p.contas[0]!.relacoes, ['site:PLACE-01', 'prumo:EMPRESA-01'])
    assert.deepEqual(p.contas[0]!.fontes, ['site', 'prumo'])
  })
  it('URL de domínio imitador e IDs iguais de outras fontes não são identidade empresarial', () => {
    const p = projetarCarteiraCrm([lead(), lead('prumo:PLACE-01', { produto: 'prumo', links: { maps: 'https://google.com.evil.test/maps?query_place_id=PLACE-01' } })], agora)
    assert.equal(p.contagens.contas, 2)
  })
  it('Plus é canal explícito, conserva a fonte legada e identifica a oferta separadamente', () => {
    const p = projetarCarteiraCrm([qualificado({ id: 'plus:INDICACAO', produto: 'plus', plus: { oferta: 'iris', fixo: true, descricao: 'Indicação sintética' } })], agora)
    assert.equal(p.oportunidades[0]!.fonte, 'plus')
    assert.equal(p.oportunidades[0]!.canal, 'plus')
    assert.equal(p.oportunidades[0]!.oferta, 'iris')
    assert.equal(p.contas[0]!.origens[0]!.fonteLegada, 'plus')
  })
  it('não apresenta número público como conversa humana nem presume a origem de aquisição', () => {
    const p = projetarCarteiraCrm([lead()], agora)
    assert.equal(p.contagens.conversasHumanas, 0)
    assert.equal(p.contas[0]!.origens[0]!.canal, 'nao-informado')
    const q = projetarCarteiraCrm([qualificado()], agora)
    assert.equal(q.contagens.conversasHumanas, 1)
  })
  it('classificação explícita sem humanidade prevalece sobre timestamp e papel do resumo', () => {
    for (const classe of ['pendente', 'robo'] as const) {
      const leitura = { ...classificacao(classe), houveRespostaHumana: false }
      const p = projetarCarteiraCrm([lead('site:CONTEXTO', { classificacaoResposta: leitura, conversa: {
        desde: em, mensagens: 1, ultimaEntrada: em, entradas: { gente: 1, recepcao: 1, robo: 0 },
        ultima: { direcao: 'entrada', em, trecho: 'Entrada sintética', papel: 'recepcao' },
      } })], agora)
      assert.equal(p.contagens.conversasHumanas, 0)
      assert.equal(p.conversas[0]!.humana, false)
    }
  })
  it('sem classificação, somente papel humano explícito com data válida comprova conversa humana', () => {
    const resumo = { desde: em, mensagens: 1, ultimaEntrada: em, entradas: { gente: 1, recepcao: 0, robo: 0 },
      ultima: { direcao: 'entrada' as const, em, trecho: 'Entrada sintética sem papel' } }
    const casos = [
      { resumo, esperado: false },
      { resumo: { ...resumo, ultima: { ...resumo.ultima, papel: 'robo' as const } }, esperado: false },
      { resumo: { ...resumo, ultima: { ...resumo.ultima, papel: 'recepcao' as const, em: '2026-12-01T12:00:00Z' } }, esperado: false },
      { resumo: { ...resumo, ultima: { ...resumo.ultima, papel: 'recepcao' as const, em: 'inválido' } }, esperado: false },
      { resumo: { ...resumo, ultima: { ...resumo.ultima, direcao: 'saida' as const, papel: 'recepcao' as const } }, esperado: false },
      { resumo: { ...resumo, ultima: { ...resumo.ultima, papel: 'recepcao' as const } }, esperado: true },
      { resumo: { ...resumo, recentes: [{ ...resumo.ultima, papel: 'recepcao' as const }] }, esperado: true },
    ]
    for (const { resumo: conversa, esperado } of casos) {
      const p = projetarCarteiraCrm([lead('site:SEM-CLASSIFICACAO', { conversa })], agora)
      assert.equal(p.conversas[0]!.humana, esperado)
      assert.equal(p.contagens.conversasHumanas, esperado ? 1 : 0)
    }
  })
  it('proposta enviada legada é consultável, com cobertura faltante explícita', () => {
    const p = projetarCarteiraCrm([lead('site:PROPOSTA', { proposta: { em, data: '2026-11-13' } })], agora)
    assert.equal(p.contagens.propostasEnviadas, 1)
    assert.equal(p.oportunidades[0]!.qualificacao, 'evidencia-comercial')
    assert.match(p.oportunidades[0]!.alertas.join(' '), /cobertura completa/)
    assert.equal(p.contagens.contratacoesConfirmadas, 0)
  })
  it('proposta preparada e aceite sem vínculo ao envio não comprovam contratação', () => {
    const p = projetarCarteiraCrm([lead('site:PREPARADA', { eventos: [proposta, aceite] })], agora)
    assert.equal(p.contagens.oportunidades, 0)
    assert.equal(p.contagens.propostasEnviadas, 0)
    assert.equal(p.contagens.contratacoesConfirmadas, 0)
  })
  it('ciclo confirmado mantém proposta, contratação e pagamento como fatos independentes', () => {
    const p = projetarCarteiraCrm([lead('site:CICLO', { eventos: [proposta, enviada, aceite, vista, condicao, cobranca, pagamento] })], agora)
    assert.equal(p.contagens.propostasEnviadas, 1)
    assert.equal(p.contagens.contratacoesConfirmadas, 1)
    assert.equal(p.contagens.comRecebimento, 1)
    assert.equal(p.oportunidades[0]!.recebidoCentavos, 69000)
  })
  it('recebimento legado não se transforma em aceite; leitores existentes deduplicam a mesma referência', () => {
    const antigo = evento('pagamento_confirmado', JSON.stringify({ versao: 1, oferta: 'encontrado', componente: 'implantacao', valor_centavos: 69000, referencia: 'pix-sintetico', data: '2026-11-13' }))
    const p = projetarCarteiraCrm([lead('site:PAGO', { eventos: [antigo, pagamento] })], agora)
    assert.equal(p.oportunidades[0]!.recebidoCentavos, 69000)
    assert.equal(p.contagens.contratacoesConfirmadas, 0)
    assert.match(p.oportunidades[0]!.alertas.join(' '), /não confirma, por si/)
  })
  it('pagamento órfão e cobrança acima do valor contratado não viram recebimento comprovado', () => {
    const orfao = projetarCarteiraCrm([lead('site:ORFAO', { eventos: [pagamento] })], agora)
    assert.equal(orfao.contagens.comRecebimento, 0)
    assert.equal(orfao.contagens.oportunidades, 0)
    assert.match(orfao.contas[0]!.alertas.join(' '), /sem cadeia/)
    const maior = ciclo({ id: 'cobranca-01', tipo: 'cobranca', vinculo: 'condicao-01', componente: 'inicial', valor: 999999, vencimento: '2026-11-13', forma: 'Pix' })
    const p = projetarCarteiraCrm([lead('site:SOBRECOBRADO', { eventos: [proposta, enviada, aceite, vista, condicao, maior, pagamento] })], agora)
    assert.equal(p.contagens.comRecebimento, 0)
    assert.equal(p.oportunidades[0]!.recebidoCentavos, 0)
    assert.equal(p.oportunidades[0]!.situacao, 'revisar')
  })
  it('sobrepagamento e correção são revalidados contra a cadeia financeira', () => {
    const aMais = ciclo({ id: 'pagamento-02', tipo: 'pagamento', vinculo: 'cobranca-01', componente: 'inicial', valor: 100, referencia: 'outro-pix' })
    const base = [proposta, enviada, aceite, vista, condicao, cobranca, pagamento]
    assert.equal(projetarCarteiraCrm([lead('site:SOBREPAGO', { eventos: [...base, aMais] })], agora).oportunidades[0]!.recebidoCentavos, 69000)
    const correcao = ciclo({ id: 'correcao-01', tipo: 'correcao', vinculo: 'pagamento-01' })
    const corrigido = projetarCarteiraCrm([lead('site:CORRIGIDO', { eventos: [...base, correcao] })], agora)
    assert.equal(corrigido.contagens.comRecebimento, 0)
    assert.equal(corrigido.oportunidades[0]!.recebidoCentavos, 0)
    assert.equal(corrigido.oportunidades[0]!.contratacaoConfirmada, true)
  })
  it('qualificação e intenção futuras ou sem registro humano não criam oportunidade', () => {
    assert.equal(projetarCarteiraCrm([qualificado({ eventos: [] })], agora).contagens.oportunidades, 0)
    const l = qualificado(); l.eventos[0]!.em = '2026-12-01T12:00:00Z'
    assert.equal(projetarCarteiraCrm([l], agora).contagens.oportunidades, 0)
    const r = classificacao('interesse'); r.evidencia!.em = '2026-12-01T12:00:00Z'
    assert.equal(projetarCarteiraCrm([qualificado({ classificacaoResposta: r })], agora).contagens.oportunidades, 0)
  })
  it('recusa atual conserva proposta histórica, mas não infla a carteira em andamento', () => {
    const r = classificacao('recusa', 'Não tenho interesse agora')
    const p = projetarCarteiraCrm([qualificado({ classificacaoResposta: r, proposta: { em, data: '2026-11-13' } })], agora)
    assert.equal(p.contagens.oportunidades, 1)
    assert.equal(p.contagens.oportunidadesAtivas, 0)
    assert.equal(p.contagens.oportunidadesEmRevisao, 0)
    assert.equal(p.contagens.oportunidadesEncerradas, 1)
    assert.equal(p.oportunidades[0]!.situacao, 'encerrada')
  })
  it('registros futuros não criam proposta, responsável ou próximo passo', () => {
    const futuro = '2026-12-01T12:00:00Z'
    const p = projetarCarteiraCrm([qualificado({ proposta: { em: futuro, data: '2026-12-01' },
      proximoPasso: { texto: 'Telefonar com autorização', data: '2026-12-02', registradoEm: futuro },
      eventos: [...qualificado().eventos, { ...evento('nota', textoResponsavelConversa({ v: 2, id: 'resp-01', conta: 'prumo', canal: 'whatsapp', conversa: identidadeDaConversa(lead())!.conversa, responsavel: 'romulo', data: futuro, motivo: 'Assumir', humano: true, anterior: null }, Date.parse(futuro))), em: futuro }] })], agora)
    assert.equal(p.oportunidades[0]!.propostaEnviada, false)
    assert.equal(p.oportunidades[0]!.proximoPasso, undefined)
    assert.equal(p.oportunidades[0]!.responsavel, undefined)
  })
  it('próximo passo e dono confirmados permanecem visíveis; data futura da tarefa é permitida', () => {
    const p = projetarCarteiraCrm([qualificado({ proximoPasso: { texto: 'Conferir escopo aceito', data: '2026-11-20', registradoEm: em },
      eventos: [...qualificado().eventos, evento('nota', textoResponsavelConversa({ v: 2, id: 'resp-01', conta: 'prumo', canal: 'whatsapp', conversa: identidadeDaConversa(lead())!.conversa, responsavel: 'romulo', data: em, motivo: 'Assumi a conversa', humano: true, anterior: null }, agora))] })], agora)
    assert.equal(p.oportunidades[0]!.responsavel, 'romulo')
    assert.equal(p.oportunidades[0]!.proximoPasso!.data, '2026-11-20')
    assert.equal(p.cobertura.comProximoPasso, 1)
    assert.equal(p.cobertura.comResponsavel, 1)
    assert.equal(p.oportunidades[0]!.situacao, 'em-andamento')
    assert.equal(p.contagens.oportunidadesAtivas, 1)
  })
  it('encerramento por silêncio permanece legado e a projeção não altera nem reabre a fonte', () => {
    const l = qualificado({ etapa: 'perdido', motivoPerda: 'expirou' }), antes = JSON.stringify(l)
    const p = projetarCarteiraCrm([l, l], agora)
    assert.equal(p.contagens.cadastros, 1)
    assert.match(p.oportunidades[0]!.alertas.join(' '), /sem presumir recusa/)
    assert.equal(p.oportunidades[0]!.situacao, 'revisar')
    assert.equal(JSON.stringify(l), antes)
  })
  it('API sem retrato distingue indisponibilidade de ausência de negócio; API válida expõe projeção', () => {
    const sem = visaoSemRetrato(new Date(agora), 'sem-retrato', 'Sem fonte')
    assert.equal(sem.carteira!.cobertura.fonteDisponivel, false)
    assert.match(sem.carteira!.cobertura.alertas.join(' '), /não comprovam ausência/)
    const retrato = validarRetrato({ versao: 1, geradoEm: new Date(agora).toISOString(), fontes: {
      site: { linhas: [{ place_id: 'PLACE-API', nome: 'Empresa sintética', status: 'pronto' }] },
      prumo: { linhas: [] }, iris: { linhas: [] }, estampa: { linhas: [] }, registros: { linhas: [] },
    } })
    const antes = JSON.stringify(retrato)
    const v = montarCrm(retrato, { agora: new Date(agora) })
    assert.equal(v.carteira!.contagens.cadastros, v.leads.length)
    assert.equal(v.carteira!.cobertura.fonteDisponivel, true)
    assert.equal(JSON.stringify(retrato), antes)
  })
  it('fonte com erro ou ausente não vira disponibilidade com zero negócio comprovado', () => {
    for (const fonte of ['site', 'registros'] as const) {
      const fontes = { site: { linhas: [] }, prumo: { linhas: [] }, iris: { linhas: [] }, estampa: { linhas: [] }, registros: { linhas: [] } }
      const comErro = validarRetrato({ versao: 1, geradoEm: new Date(agora).toISOString(), fontes: { ...fontes, [fonte]: { linhas: [], erro: 'Falha sintética de leitura' } } })
      const v = montarCrm(comErro, { agora: new Date(agora) })
      assert.equal(v.carteira!.cobertura.fonteDisponivel, false)
      assert.match(v.carteira!.cobertura.alertas.join(' '), new RegExp(`fonte ${fonte} incompleta`))
      const ausente = { ...fontes } as Partial<typeof fontes>; delete ausente[fonte]
      assert.equal(montarCrm(validarRetrato({ versao: 1, geradoEm: new Date(agora).toISOString(), fontes: ausente }), { agora: new Date(agora) }).carteira!.cobertura.fonteDisponivel, false)
    }
  })
  it('erro em qualquer frente mantém o histórico disponível sem confirmar os totais agregados', () => {
    for (const fonte of ['site', 'prumo', 'iris', 'estampa', 'registros'] as const) {
      const fontes = {
        site: { linhas: [{ place_id: 'PLACE-HISTORICO', nome: 'Empresa sintética', status: 'enviado', enviado_em: em }] },
        prumo: { linhas: [] }, iris: { linhas: [] }, estampa: { linhas: [] }, registros: { linhas: [] },
      }
      const retrato = validarRetrato({ versao: 1, geradoEm: new Date(agora).toISOString(), fontes: {
        ...fontes, [fonte]: { ...fontes[fonte], erro: 'Leitura sintética parcial; linhas anteriores conservadas' },
      } })
      const antes = JSON.stringify(retrato), v = montarCrm(retrato, { agora: new Date(agora) })
      assert.equal(v.leads.length, 1)
      assert.equal(v.leads[0]!.id, 'site:PLACE-HISTORICO')
      assert.equal(v.carteira!.contas[0]!.relacoes[0], 'site:PLACE-HISTORICO')
      assert.equal(v.carteira!.cobertura.fonteDisponivel, false)
      assert.match(v.carteira!.cobertura.alertas.join(' '), new RegExp(`fonte ${fonte} incompleta`))
      assert.equal(JSON.stringify(retrato), antes)
    }
  })
})
