import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cicloDoLead, eventosDoCiclo, lerEventoCiclo, textoEventoCiclo, validarEventoCiclo, validarTransicaoCiclo, PREFIXO_CICLO, type EventoCiclo } from '../src/operations/ciclo-comercial'
import { validarNotaDoCicloComercial, validarTransicaoDoCicloComercial } from './ciclo-comercial'
import type { CrmLead } from '../src/operations/types'

const agora = Date.parse('2026-12-05T18:00:00Z')
// Valores exclusivamente fictícios para testar invariantes; nenhum preço de cliente é semeado.
const proposta: EventoCiclo = { v: 1, id: 'prop-01', tipo: 'proposta', data: '2026-10-20', humano: true, referencia: 'P-TESTE', ofertaId: 'anuncios', versao: 1, escopo: 'Gestão; mídia paga fora do escopo', prazo: 'Conforme documento aprovado', condicoes: 'Condições específicas no documento', responsavel: 'Operador', valor: 10000, mensalidade: 2500 }
function lead(): CrmLead { return { produto: 'site', eventos: [] } as unknown as CrmLead }
function fato(tipo: EventoCiclo['tipo'], id: string, vinculo: string, extra: Partial<EventoCiclo> = {}): EventoCiclo {
  return { v: 1, id, tipo, vinculo, data: '2026-10-20', referencia: id, humano: true, evidencia: 'Referência interna conferida', ...extra }
}
function anexar(l: CrmLead, e: EventoCiclo, extra: Partial<CrmLead['eventos'][number]> = {}) {
  const status = validarTransicaoDoCicloComercial(l, e, new Date(agora))
  l.eventos.push({ tipo: 'nota', em: new Date(agora).toISOString(), origem: 'manual', fonte: 'aba CRM', rotulo: 'Nota', texto: textoEventoCiclo(e, agora), ...extra })
  return status
}
function contratado(p: EventoCiclo = proposta): CrmLead {
  const l = lead(); anexar(l, p); anexar(l, fato('proposta_enviada', 'env-01', p.id)); anexar(l, fato('aceite', 'aceite-01', p.id, { documento: 'Documento P-TESTE v1 aceito' })); return l
}
function condicao(l: CrmLead, componente: 'inicial' | 'mensal' = 'inicial', extra: Partial<EventoCiclo> = {}) {
  const e = fato('condicao_cobranca', `cond-${componente}`, 'aceite-01', { componente, valor: componente === 'inicial' ? 10000 : 2500, gatilho: 'aceite', condicao: 'Obrigação combinada no documento', vigenciaInicio: '2026-10-20', ...extra }); anexar(l, e); return e
}
function cobrar(l: CrmLead, c = 'cond-inicial', extra: Partial<EventoCiclo> = {}) {
  const e = fato('cobranca', 'cob-01', c, { componente: 'inicial', valor: 10000, vencimento: '2026-10-25', forma: 'Forma combinada', ...extra }); anexar(l, e); return e
}
function cobrado() { const l = contratado(); condicao(l); cobrar(l); return l }
function pagar(l: CrmLead, id: string, valor: number, extra: Partial<EventoCiclo> = {}) { return anexar(l, fato('pagamento', id, 'cob-01', { componente: 'inicial', valor, ...extra })) }
function aditar(l: CrmLead, extra: Partial<EventoCiclo> = {}) {
  const p = { ...proposta, id: 'prop-02', versao: 2, referencia: ' ｐ-ｔｅｓｔｅ ', ...extra }
  anexar(l, p); anexar(l, fato('proposta_enviada', 'env-02', p.id)); anexar(l, fato('aceite', 'aceite-02', p.id, { documento: 'Documento aditivo aceito' })); return p
}
function condicaoAditada(l: CrmLead, extra: Partial<EventoCiclo> = {}) {
  return anexar(l, fato('condicao_cobranca', 'cond-aditivo', 'aceite-02', { componente: 'mensal', valor: 2500, gatilho: 'aceite', condicao: 'Condição do aditivo', vigenciaInicio: '2026-11-01', ...extra }))
}

describe('contrato humano e valores desconhecidos', () => {
  it('proposta preparada incompleta não vira enviada/contratada e desconhecido não vira zero', () => {
    const l = lead(), incompleta = { ...proposta }; delete incompleta.valor; delete incompleta.mensalidade
    anexar(l, incompleta)
    const p = cicloDoLead(l, agora).propostas[0]!
    assert.deepEqual(p.pendencias, ['valor', 'mensalidade']); assert.equal(p.valor, undefined); assert.equal(p.mensalidade, undefined)
    assert.throws(() => anexar(l, fato('proposta_enviada', 'env-01', p.id)), /incompleta.*valor.*mensalidade/)
    assert.throws(() => anexar(l, fato('aceite', 'aceite-01', p.id, { documento: 'Contrato real' })), /incompleta/)
  })
  it('mensalidade desconhecida permanece pendente mesmo com valor inicial informado', () => {
    const l = lead(), p = { ...proposta, ofertaId: 'anuncios' as const }; delete p.mensalidade
    anexar(l, p); assert.throws(() => anexar(l, fato('proposta_enviada', 'env-01', p.id)), /mensalidade/)
  })
  it('zero explícito pode ser combinado, mas nunca origina pagamento ou cobrança de zero', () => {
    const l = contratado({ ...proposta, valor: 0, mensalidade: 0 })
    condicao(l, 'inicial', { valor: 0 })
    assert.throws(() => cobrar(l, 'cond-inicial', { valor: 0 }), /positivo/)
    assert.throws(() => cobrar(l, 'cond-inicial', { valor: 1 }), /excede/)
    assert.equal(cicloDoLead(l, agora).recebido, 0)
  })
  it('rejeita valor omitido em obrigação/pagamento, número fracionado, campos extras e origem não humana', () => {
    const c = fato('condicao_cobranca', 'cond-01', 'aceite-01', { componente: 'inicial', gatilho: 'aceite', condicao: 'Combinado', vigenciaInicio: '2026-10-20' })
    assert.throws(() => validarEventoCiclo(c, agora), /valor/)
    for (const valor of [-1, 0.5, NaN, Infinity, 100_000_001]) assert.throws(() => validarEventoCiclo({ ...proposta, valor }, agora), /centavos/)
    assert.throws(() => validarEventoCiclo({ ...proposta, humano: false }, agora), /humana/)
    assert.throws(() => validarEventoCiclo({ ...proposta, desconto: 1 }, agora), /Campo/)
    assert.throws(() => validarEventoCiclo({ ...proposta, ofertas: ['encontrado'] }, agora), /somente a pacote/)
  })
  it('rejeita datas inválidas/futuras, controles em texto e notas grandes sem truncar', () => {
    for (const data of ['2026-02-30', '2026-13-01', '2026-12-06']) assert.throws(() => validarEventoCiclo({ ...proposta, data }, agora), /data real/)
    assert.throws(() => validarEventoCiclo({ ...proposta, escopo: 'x\ntexto' }, agora), /texto preenchido/)
    const longa = { ...proposta, escopo: 'a'.repeat(180), prazo: 'b'.repeat(180), condicoes: 'c'.repeat(180), responsavel: 'd'.repeat(180), oferta: 'e'.repeat(180) }
    assert.throws(() => textoEventoCiclo(longa, agora), /1000 caracteres/)
    assert.equal(lerEventoCiclo(PREFIXO_CICLO + '{}', agora), null)
    assert.throws(() => validarNotaDoCicloComercial('nota comum', new Date(agora)), /inválido/)
    assert.deepEqual(validarNotaDoCicloComercial(textoEventoCiclo(proposta, agora), new Date(agora)), proposta)
  })
})

describe('versão, aceite e condição da cobrança', () => {
  it('aditivo da mesma série normaliza NFKC/caixa e rejeita sobreposição inclusiva sem fechar a vigência antiga', () => {
    const l = contratado(); condicao(l, 'mensal', { vigenciaFim: '2026-11-01' }); aditar(l)
    assert.throws(() => condicaoAditada(l), /Vigência sobreposta.*substitutivas/)
    assert.equal(cicloDoLead(l, agora).condicoes[0]!.vigenciaFim, '2026-11-01')
    condicaoAditada(l, { vigenciaInicio: '2026-11-02' })
    assert.equal(cicloDoLead(l, agora).condicoes.length, 2)
    const aberta = contratado(); condicao(aberta, 'mensal'); aditar(aberta)
    assert.throws(() => condicaoAditada(aberta, { vigenciaInicio: '2026-12-01' }), /Vigência sobreposta/)
  })
  it('vigências disjuntas no mesmo mês não autorizam cobrar mensalidade em duas versões', () => {
    const l = contratado(); condicao(l, 'mensal', { vigenciaFim: '2026-10-24' }); aditar(l)
    condicaoAditada(l, { vigenciaInicio: '2026-10-25' })
    cobrar(l, 'cond-mensal', { componente: 'mensal', competencia: '2026-10', valor: 2500 })
    assert.throws(() => cobrar(l, 'cond-aditivo', { id: 'cob-aditivo', referencia: 'FAT-ADITIVO', componente: 'mensal', competencia: '2026-10', valor: 2500, data: '2026-10-25', vencimento: '2026-10-30' }), /Outra versão.*competência/)
    cobrar(l, 'cond-aditivo', { id: 'cob-nov', referencia: 'FAT-NOV', componente: 'mensal', competencia: '2026-11', valor: 2500, data: '2026-11-01', vencimento: '2026-11-05' })
    assert.equal(cicloDoLead(l, agora).cobrancas.length, 2)
  })
  it('valor inicial não pode ser cobrado novamente por um aditivo mesmo com vigências disjuntas', () => {
    const l = contratado(); condicao(l, 'inicial', { vigenciaFim: '2026-10-24' }); cobrar(l); aditar(l)
    condicaoAditada(l, { componente: 'inicial', valor: 10000, vigenciaInicio: '2026-10-25' })
    assert.throws(() => cobrar(l, 'cond-aditivo', { id: 'cob-aditivo', referencia: 'FAT-ADITIVO', data: '2026-10-25' }), /Outra versão.*competência/)
    assert.equal(cicloDoLead(l, agora).cobrancas.length, 1)
  })
  it('outra referência permite contrato cumulativo e componente distinto não conflita com a versão anterior', () => {
    const l = contratado(); condicao(l, 'mensal'); cobrar(l, 'cond-mensal', { componente: 'mensal', competencia: '2026-10', valor: 2500 })
    aditar(l, { referencia: 'P-OUTRO-CONTRATO', versao: 1 })
    condicaoAditada(l, { vigenciaInicio: '2026-10-20' })
    cobrar(l, 'cond-aditivo', { id: 'cob-outro', referencia: 'FAT-OUTRO', componente: 'mensal', competencia: '2026-10', valor: 2500 })
    assert.equal(cicloDoLead(l, agora).cobrancas.length, 2)
    const componentes = contratado(); condicao(componentes, 'inicial'); aditar(componentes)
    condicaoAditada(componentes, { vigenciaInicio: '2026-10-20' })
    assert.equal(cicloDoLead(componentes, agora).condicoes.length, 2)
  })
  it('separa proposta preparada, enviada, contratação, condição e cobrança', () => {
    const l = lead(); anexar(l, proposta)
    assert.throws(() => anexar(l, fato('aceite', 'aceite-01', proposta.id, { documento: 'P-TESTE v1' })), /conteúdo enviado/)
    anexar(l, fato('proposta_enviada', 'env-01', proposta.id))
    assert.throws(() => anexar(l, fato('aceite', 'aceite-01', proposta.id)), /documento/)
    anexar(l, fato('aceite', 'aceite-01', proposta.id, { documento: 'P-TESTE v1' }))
    assert.throws(() => cobrar(l, 'aceite-01'), /condição de cobrança/)
    condicao(l); cobrar(l)
    const c = cicloDoLead(l, agora); assert.equal(c.propostas.length, 1); assert.equal(c.envios.length, 1); assert.equal(c.aceites.length, 1); assert.equal(c.recebido, 0)
  })
  it('preserva versões antigas e não altera contrato por preparar outra proposta', () => {
    const l = contratado(); anexar(l, { ...proposta, id: 'prop-02', versao: 2, valor: 20000 })
    condicao(l); cobrar(l)
    assert.equal(cicloDoLead(l, agora).cobrancas[0]!.valor, 10000)
    assert.throws(() => anexar(l, { ...proposta, id: 'prop-03', versao: 2 }), /nova versão/)
    assert.throws(() => anexar(l, { ...proposta, id: 'prop-04', versao: 3, ofertaId: 'encontrado' }), /oferta estável/)
    assert.throws(() => anexar(l, fato('aceite', 'aceite-02', proposta.id, { documento: 'Outro documento' })), /já está registrado/)
  })
  it('contratação não pode anteceder envio e versão não pode voltar no tempo', () => {
    const l = lead(); anexar(l, proposta); anexar(l, fato('proposta_enviada', 'env-01', proposta.id, { data: '2026-10-22' }))
    assert.throws(() => anexar(l, fato('aceite', 'aceite-01', proposta.id, { data: '2026-10-21', documento: 'P-TESTE' })), /data compatível/)
    assert.throws(() => anexar(l, { ...proposta, id: 'prop-02', versao: 2, data: '2026-10-19' }), /anteceder/)
  })
  it('usa oferta estável para site mesmo com nome livre e impede contorno por gatilho', () => {
    const l = contratado({ ...proposta, ofertaId: 'encontrado', oferta: 'Outro nome exibido' })
    assert.throws(() => condicao(l), /Site exige pagamento/)
    condicao(l, 'inicial', { gatilho: 'site_visto_no_ar' })
    assert.throws(() => cobrar(l), /cliente viu o site/)
    anexar(l, fato('entrega_vista', 'vista-01', proposta.id)); cobrar(l)
    assert.equal(cicloDoLead(l, agora).cobrancas.length, 1)
  })
  it('pacote exige composição explícita e preserva gate de site', () => {
    assert.throws(() => validarEventoCiclo({ ...proposta, ofertaId: 'pacote' }, agora), /Pacote exige/)
    const l = contratado({ ...proposta, ofertaId: 'pacote', ofertas: ['encontrado', 'anuncios'] })
    assert.throws(() => condicao(l), /Site exige pagamento/)
    const semSite = contratado({ ...proposta, ofertaId: 'pacote', ofertas: ['anuncios', 'redes'] }); condicao(semSite); cobrar(semSite)
    assert.equal(cicloDoLead(semSite, agora).cobrancas.length, 1)
  })
  it('origem do lead site e alias Encontrado não impõem regra à proposta só de anúncios', () => {
    const l = contratado({ ...proposta, ofertaId: 'anuncios', oferta: 'Encontrado', mensalidade: 0 })
    assert.equal(l.produto, 'site'); condicao(l); cobrar(l)
    assert.equal(cicloDoLead(l, agora).cobrancas.length, 1)
  })
  it('obrigações divididas não excedem o componente aceito e não pressupõem entrada', () => {
    const l = contratado(); condicao(l, 'inicial', { valor: 4000, gatilho: 'marco_confirmado' })
    anexar(l, fato('condicao_cobranca', 'cond-final', 'aceite-01', { componente: 'inicial', valor: 6000, gatilho: 'data_combinada', condicao: 'Após marco e data acordados', vigenciaInicio: '2026-10-20', liberadaEm: '2026-11-01' }))
    assert.throws(() => anexar(l, fato('condicao_cobranca', 'cond-extra', 'aceite-01', { componente: 'inicial', valor: 1, gatilho: 'aceite', condicao: 'Extra', vigenciaInicio: '2026-10-20' })), /excedem/)
    assert.throws(() => cobrar(l, 'cond-final', { valor: 6000 }), /anterior.*liberação/)
    cobrar(l, 'cond-final', { valor: 6000, data: '2026-11-01', vencimento: '2026-11-05' })
  })
})

describe('saldo, recorrência, recebimento e correção', () => {
  it('pagamento parcial/integral exige saldo, referência única e expõe oferta exata', () => {
    const l = cobrado(); pagar(l, 'pag-01', 4000, { referencia: 'REC-01' })
    let c = cicloDoLead(l, agora); assert.equal(c.cobrancas[0]!.situacao, 'parcial'); assert.equal(c.cobrancas[0]!.saldo, 6000)
    assert.throws(() => pagar(l, 'pag-dup', 1000, { referencia: ' rec-01 ' }), /já registrada/)
    assert.throws(() => pagar(l, 'pag-alto', 6001), /excede o saldo/)
    pagar(l, 'pag-02', 6000)
    c = cicloDoLead(l, agora); assert.equal(c.recebido, 10000); assert.equal(c.cobrancas[0]!.situacao, 'integral'); assert.equal(c.primeiroRecebimento, '2026-10-20')
    assert.equal(c.pagamentos[0]!.ofertaId, 'anuncios'); assert.equal(c.pagamentos[0]!.propostaId, 'prop-01'); assert.equal(c.pagamentos[0]!.componente, 'inicial')
  })
  it('competência separa obrigações mensais e não limita o contrato ao primeiro mês', () => {
    const l = contratado(); condicao(l, 'mensal', { vigenciaFim: '2026-12-31' })
    assert.throws(() => cobrar(l, 'cond-mensal', { componente: 'mensal', valor: 2500 }), /competência/)
    cobrar(l, 'cond-mensal', { componente: 'mensal', competencia: '2026-10', valor: 2500 })
    assert.throws(() => cobrar(l, 'cond-mensal', { id: 'cob-dup', referencia: 'OUTRA', componente: 'mensal', competencia: '2026-10', valor: 1 }), /excede a obrigação/)
    cobrar(l, 'cond-mensal', { id: 'cob-02', referencia: 'FAT-NOV', componente: 'mensal', competencia: '2026-11', data: '2026-11-01', vencimento: '2026-11-05', valor: 2500 })
    assert.throws(() => pagar(l, 'pag-01', 2500), /Componente\/competência/)
    pagar(l, 'pag-01', 2500, { componente: 'mensal', competencia: '2026-10' })
    pagar(l, 'pag-02', 2500, { vinculo: 'cob-02', componente: 'mensal', competencia: '2026-11', data: '2026-11-05' })
    const c = cicloDoLead(l, agora); assert.equal(c.recebido, 5000); assert.deepEqual(c.pagamentos.map(p => p.competencia), ['2026-10', '2026-11'])
    assert.throws(() => cobrar(l, 'cond-mensal', { id: 'cob-fora', referencia: 'FAT-FORA', componente: 'mensal', competencia: '2027-01', valor: 2500 }), /Competência fora/)
  })
  it('replay ignora ordem de chaves JSON e ofertas de pacote, mas rejeita colisão', () => {
    const l = cobrado(), p = fato('pagamento', 'pag-01', 'cob-01', { componente: 'inicial', valor: 1000 })
    assert.equal(anexar(l, p), 'novo')
    const reordenado = Object.fromEntries(Object.entries(p).reverse()) as unknown as EventoCiclo
    assert.equal(anexar(l, reordenado), 'duplicado'); assert.equal(cicloDoLead(l, agora).recebido, 1000)
    assert.throws(() => anexar(l, { ...p, valor: 2000 }), /Identificador já usado/)
    const pacote = { ...proposta, ofertaId: 'pacote' as const, ofertas: ['anuncios', 'redes'] as const }
    const outro = lead(); anexar(outro, { ...pacote, ofertas: [...pacote.ofertas] })
    assert.equal(anexar(outro, { ...pacote, ofertas: ['redes', 'anuncios'] }), 'duplicado')
  })
  it('correções preservam o original, liberam saldo e nunca permitem reutilizar ID corrigido', () => {
    const l = cobrado(); pagar(l, 'pag-01', 4000)
    assert.throws(() => anexar(l, fato('correcao', 'corr-cob', 'cob-01')), /dependentes/)
    anexar(l, fato('correcao', 'corr-pag', 'pag-01'))
    assert.equal(cicloDoLead(l, agora).recebido, 0); assert.ok(cicloDoLead(l, agora).historico.some(e => e.id === 'pag-01'))
    assert.throws(() => pagar(l, 'pag-01', 3000), /Identificador já usado/)
    pagar(l, 'pag-02', 3000, { referencia: 'pag-01' }); assert.equal(cicloDoLead(l, agora).recebido, 3000)
  })
  it('não remove comprovação de envio ou site visto quando há fatos dependentes', () => {
    const l = contratado({ ...proposta, ofertaId: 'encontrado' }); anexar(l, fato('entrega_vista', 'vista-01', proposta.id)); condicao(l, 'inicial', { gatilho: 'site_visto_no_ar' }); cobrar(l)
    for (const alvo of ['env-01', 'vista-01', 'aceite-01', 'cond-inicial', proposta.id]) assert.throws(() => anexar(l, fato('correcao', 'corr-01', alvo)), /dependentes/)
  })
  it('detecta duplicidade com pagamento legado e não soma notas automáticas', () => {
    const l = cobrado()
    l.eventos.push({ tipo: 'pagamento_confirmado', em: '2026-11-01T12:00:00Z', origem: 'manual', fonte: 'CRM', rotulo: 'Pagamento', texto: JSON.stringify({ versao: 1, oferta: 'anuncios', componente: 'mensalidade', referencia: 'REC-LEGADO', data: '2026-11-01', valor_centavos: 999 }) })
    assert.throws(() => pagar(l, 'pag-01', 1000, { referencia: ' rec-legado ' }), /histórico legado/)
    const automatico = fato('pagamento', 'pag-auto', 'cob-01', { componente: 'inicial', valor: 1000 })
    l.eventos.push({ tipo: 'nota', em: new Date(agora).toISOString(), origem: 'automático', fonte: 'Integração', rotulo: 'Nota', texto: textoEventoCiclo(automatico, agora) })
    assert.equal(cicloDoLead(l, agora).recebido, 0)
  })
  it('fonte com colisão/elo inválido é sinalizada e não pode originar dinheiro ou novas transições', () => {
    const l = cobrado(); pagar(l, 'pag-01', 1000)
    const diferente = fato('pagamento', 'pag-01', 'cob-01', { componente: 'inicial', valor: 2000 })
    l.eventos.push({ tipo: 'nota', em: new Date(agora).toISOString(), origem: 'manual', fonte: 'CRM', rotulo: 'Nota', texto: textoEventoCiclo(diferente, agora) })
    assert.match(cicloDoLead(l, agora).problemas.join(), /Colisão/)
    assert.throws(() => pagar(l, 'pag-02', 1), /Histórico comercial incoerente/)
    const orfao = lead(); orfao.eventos.push({ tipo: 'nota', em: new Date(agora).toISOString(), origem: 'manual', fonte: 'CRM', rotulo: 'Nota', texto: textoEventoCiclo(fato('pagamento', 'pag-solto', 'nao-existe', { componente: 'inicial', valor: 1000 }), agora) })
    assert.equal(cicloDoLead(orfao, agora).recebido, 0); assert.ok(cicloDoLead(orfao, agora).problemas.length)
  })
  it('não aceita pagamento anterior à cobrança nem fato futuro no instante em que foi registrado', () => {
    const l = cobrado(); assert.throws(() => pagar(l, 'pag-antes', 1000, { data: '2026-10-19' }), /anteceder/)
    const outro = lead(); outro.eventos.push({ tipo: 'nota', em: '2026-10-19T12:00:00Z', origem: 'manual', fonte: 'CRM', rotulo: 'Nota', texto: textoEventoCiclo(proposta, agora) })
    assert.equal(eventosDoCiclo(outro, agora).length, 0); assert.match(cicloDoLead(outro, agora).problemas.join(), /posterior/)
  })
})
