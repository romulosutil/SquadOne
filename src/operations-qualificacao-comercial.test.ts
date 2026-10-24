import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lacunasDoSpiced, qualificadoParaProposta, spicedVazio } from './operations/spiced.ts'
import { CARDAPIO } from './operations/colinha.ts'
import { OFERTAS_QUALIFICACAO } from './operations/qualificacao-comercial.ts'
import { camposFaltantesQualificacao, devePassarAoRomulo, lacunasDaQualificacaoComercial, lerNotaQualificacaoComercial,
  PREFIXO_QUALIFICACAO_COMERCIAL, projetarQualificacaoComercial, proximaPerguntaQualificacao,
  qualificacaoComercialAtual, qualificacaoComercialVazia, qualificadoComercialmenteParaProposta,
  temQualificacaoComercial, textoDaQualificacaoComercial, validarQualificacaoComercial, type QualificacaoComercial } from './operations/qualificacao-comercial.ts'

const AGORA = Date.parse('2026-10-23T20:00:00Z')
const completa = (): QualificacaoComercial => ({ ...qualificacaoComercialVazia(AGORA), id: 'qual-001', necessidade: 'Apresentar os serviços no Google',
  adequacao: { estado: 'confirmada', oferta: 'encontrado', motivo: 'Site com serviços e botão de contato' }, intencao: 'avaliar',
  decisao: 'Dona e sócio comparam escopo e decidem juntos', proximoPasso: { descricao: 'Receber proposta do site', aceito: true },
  fonte: 'WhatsApp, 23/10 às 16h, mensagens 21 a 24', evidencia: 'Quero avaliar a proposta com meu sócio.' })
const evento = (q: QualificacaoComercial, em = '2026-10-23T20:00:00Z') => ({ tipo: 'nota', origem: 'manual', em, texto: textoDaQualificacaoComercial(q,AGORA) })

test('nota humana faz ida e volta sem exigir link privado nem impacto financeiro', () => {
  const q = completa(), nota = textoDaQualificacaoComercial(q,AGORA)
  assert.ok(nota.length <= 1000)
  assert.deepEqual(lerNotaQualificacaoComercial(nota,AGORA),q)
  assert.equal(qualificadoComercialmenteParaProposta({qualificacaoComercial:q},AGORA),true)
  assert.deepEqual(lacunasDaQualificacaoComercial({qualificacaoComercial:q},AGORA),[])
})
test('cada dado faltante impede proposta final sem transformar licença em intenção de compra', () => {
  const casos: Array<[Partial<QualificacaoComercial>,string]> = [
    [{necessidade:''},'necessidade'], [{adequacao:{estado:'pendente',oferta:'',motivo:''}},'adequação da oferta'],
    [{intencao:'permissao'},'intenção de avaliar ou contratar'], [{decisao:''},'participantes e processo de decisão'],
    [{proximoPasso:{descricao:'Receber proposta',aceito:false}},'próximo passo aceito'],
  ]
  for (const [mudanca,rotulo] of casos) {
    const q={...completa(),...mudanca}
    assert.equal(qualificadoComercialmenteParaProposta({qualificacaoComercial:q},AGORA),false)
    assert.deepEqual(lacunasDaQualificacaoComercial({qualificacaoComercial:q},AGORA),[rotulo])
  }
})
test('processo com sócios é suficiente e não exige único decisor, dinheiro ou reunião', () => {
  const q=completa()
  assert.equal(qualificadoComercialmenteParaProposta({qualificacaoComercial:q},AGORA),true)
  assert.equal(proximaPerguntaQualificacao({qualificacaoComercial:q},AGORA),null)
})
test('preço, proposta e contratação pedem humano mesmo com qualificação incompleta', () => {
  const q={...completa(),necessidade:'',decisao:'',proximoPasso:{descricao:'',aceito:false}}
  for (const sinal of ['preco','proposta','contratar','negociar','pagamento'] as const) {
    assert.equal(devePassarAoRomulo({qualificacaoComercial:q},sinal,AGORA),true)
    assert.equal(qualificadoComercialmenteParaProposta({qualificacaoComercial:q},AGORA),false)
  }
  assert.equal(devePassarAoRomulo({qualificacaoComercial:{...q,intencao:'permissao'}},undefined,AGORA),false)
  assert.equal(devePassarAoRomulo({qualificacaoComercial:{...q,intencao:'contratar'}},undefined,AGORA),true)
})
test('pergunta somente a primeira lacuna e distingue pergunta ao cliente de conferência interna', () => {
  const q={...completa(),necessidade:'',decisao:''}
  assert.equal(proximaPerguntaQualificacao({qualificacaoComercial:q},AGORA)?.campo,'necessidade')
  assert.equal(proximaPerguntaQualificacao({qualificacaoComercial:{...q,necessidade:'Quero apresentar serviços'}},AGORA)?.campo,'decisao')
  assert.equal(proximaPerguntaQualificacao({qualificacaoComercial:{...q,necessidade:'Quero site',adequacao:{estado:'pendente',oferta:'',motivo:''}}},AGORA)?.alvo,'operador')
})
test('não reabre recusas, exclusões, encerrados ou oferta inadequada', () => {
  for (const tipo of ['negativa','exclusao']) {
    const lead={qualificacaoComercial:completa(),resposta:{tipo}}
    assert.equal(qualificadoComercialmenteParaProposta(lead,AGORA),false)
    assert.equal(devePassarAoRomulo(lead,'preco'),false)
    assert.equal(proximaPerguntaQualificacao(lead,AGORA),null)
  }
  assert.equal(proximaPerguntaQualificacao({qualificacaoComercial:{...completa(),adequacao:{estado:'inadequada',oferta:'encontrado',motivo:'Precisa de outro escopo'}}},AGORA),null)
  assert.equal(proximaPerguntaQualificacao({qualificacaoComercial:{...completa(),intencao:'sem-interesse'}},AGORA),null)
})
test('última revisão governa pela gravação, conserva anteriores e ignora nota automática/futura', () => {
  const velha={...completa(),em:'2026-10-22T20:00:00Z'}, nova={...completa(),id:'qual-002',necessidade:'',em:'2026-10-23T19:00:00Z'}
  const eventos=[evento(nova,'2026-10-23T19:30:00Z'),evento(velha,'2026-10-22T20:00:00Z'),
    {...evento(completa()),origem:'automático'},evento(completa(),'2026-10-24T20:00:00Z')]
  const antes=JSON.stringify(eventos)
  assert.deepEqual(projetarQualificacaoComercial({eventos},AGORA),nova)
  assert.equal(qualificadoComercialmenteParaProposta({eventos},AGORA),false)
  assert.equal(JSON.stringify(eventos),antes)
})
test('nota nova negativa ou incompleta prevalece sobre propriedade projetada anterior', () => {
  const nova={...completa(),id:'qual-002',intencao:'sem-interesse' as const}
  const lead={qualificacaoComercial:completa(),eventos:[evento(nova)]}
  assert.equal(qualificacaoComercialAtual(lead,AGORA)?.intencao,'sem-interesse')
  assert.equal(qualificadoComercialmenteParaProposta(lead,AGORA),false)
  assert.equal(temQualificacaoComercial(lead,AGORA),true)
})
test('datas inválidas/futuras, fonte/evidência ausentes e confirmação não humana são rejeitadas', () => {
  for (const extra of [{em:'2026-02-30T12:00:00Z'},{em:'2026-10-24T20:00:00Z'},{humano:false},{fonte:''},{evidencia:''},{v:2},{id:'!'}]) {
    const valor={...completa(),...extra}
    assert.throws(()=>validarQualificacaoComercial(valor,AGORA))
    assert.equal(lerNotaQualificacaoComercial(PREFIXO_QUALIFICACAO_COMERCIAL+JSON.stringify(valor),AGORA),null)
  }
  assert.equal(lerNotaQualificacaoComercial('{',AGORA),null)
  assert.throws(()=>validarQualificacaoComercial({...completa(),adequacao:{estado:'confirmada',oferta:'site',motivo:'alias livre'}},AGORA))
})
test('teto total de 1000 é aplicado sem truncar fonte ou trecho e sem mutar o original', () => {
  const q={...completa(),necessidade:'n'.repeat(160),decisao:'d'.repeat(160),adequacao:{...completa().adequacao,motivo:'a'.repeat(160)},
    proximoPasso:{descricao:'p'.repeat(160),aceito:true},fonte:'f'.repeat(120),evidencia:'e'.repeat(180)}
  const antes=JSON.stringify(q)
  assert.throws(()=>textoDaQualificacaoComercial(q,AGORA),/1000/)
  assert.equal(JSON.stringify(q),antes)
  assert.equal(temQualificacaoComercial({eventos:[{tipo:'nota',origem:'manual',em:new Date(AGORA).toISOString(),texto:PREFIXO_QUALIFICACAO_COMERCIAL+'{'}]},AGORA),true)
})
test('nota inválida não fabrica confirmação; projeção não transforma sugestão em fato', () => {
  assert.equal(projetarQualificacaoComercial({eventos:[{...evento(completa()),texto:'Sugestão de qualificação'}]},AGORA),undefined)
  assert.ok(camposFaltantesQualificacao(null).length>0)
})


test('gate compartilhado usa a nota nova; SPICED só governa quando não existe revisão comercial', () => {
  const spiced={...spicedVazio(),dor:'Precisa de site',impacto:'Equipe repete as informações',decisao:{decisor_confirmado:'sim' as const,quem:'Dona',como_paga:''}}
  assert.equal(qualificadoParaProposta({spiced},AGORA),true)
  assert.deepEqual(lacunasDoSpiced({spiced},AGORA),[])
  const nova={...completa(),decisao:''}
  assert.equal(qualificadoParaProposta({spiced,qualificacaoComercial:nova},AGORA),false)
  assert.deepEqual(lacunasDoSpiced({spiced,qualificacaoComercial:nova},AGORA),['participantes e processo de decisão'])
  assert.equal(qualificadoParaProposta({spiced:spicedVazio(),qualificacaoComercial:completa()},AGORA),true)
  assert.equal(qualificadoParaProposta({spiced,qualificacaoComercial:{...completa(),humano:false}},AGORA),false)
  const eventos=[evento({...completa(),intencao:'sem-interesse'})]
  assert.equal(qualificadoParaProposta({spiced,eventos},AGORA),false)
})

test('IDs de oferta acompanham o cardápio e preservam produtos e pacote próprios', () => {
  for(const servico of CARDAPIO) assert.ok((OFERTAS_QUALIFICACAO as readonly string[]).includes(servico.id))
  for(const id of ['iris','estampa','pacote']) assert.ok((OFERTAS_QUALIFICACAO as readonly string[]).includes(id))
})


test('último marcador inválido bloqueia nota antiga, propriedade projetada e SPICED legados', () => {
  const spiced={...spicedVazio(),dor:'Site',impacto:'Precisa repetir informações',decisao:{decisor_confirmado:'sim' as const,quem:'Dona',como_paga:''}}
  const antiga={...completa(),em:'2026-10-22T20:00:00Z'}
  const eventos=[evento(antiga,'2026-10-22T20:00:00Z'),{tipo:'nota',origem:'manual',em:'2026-10-23T19:00:00Z',texto:PREFIXO_QUALIFICACAO_COMERCIAL+'{invalida'}]
  const lead={eventos,qualificacaoComercial:completa(),spiced}
  assert.equal(projetarQualificacaoComercial(lead,AGORA),undefined)
  assert.equal(qualificacaoComercialAtual(lead,AGORA),null)
  assert.equal(temQualificacaoComercial(lead,AGORA),true)
  assert.equal(qualificadoParaProposta(lead,AGORA),false)
  assert.ok(lacunasDoSpiced(lead,AGORA).length>0)
  const empate=[evento(antiga),{...eventos[1],em:new Date(AGORA).toISOString()}]
  assert.equal(qualificacaoComercialAtual({eventos:empate,qualificacaoComercial:completa()},AGORA),null)
})

test('anuncios-duas mantém ID estável de oferta na qualificação', () => {
  const q={...completa(),adequacao:{estado:'confirmada' as const,oferta:'anuncios-duas' as const,motivo:'Gestão dos dois canais'}}
  assert.equal(lerNotaQualificacaoComercial(textoDaQualificacaoComercial(q,AGORA),AGORA)?.adequacao.oferta,'anuncios-duas')
})
