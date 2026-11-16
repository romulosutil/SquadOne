import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LEAD_DE_EXEMPLO } from '../blueprint/exemplo.ts'
import { textoEventoCiclo } from '../operations/ciclo-comercial.ts'
import { toScreen } from './rooms.ts'
import { estacoesDaProducao, passagensConfirmadas, pontoDaEsteiraNoMundo, PONTOS_DA_ESTEIRA, trajetoDaEsteira } from './linha-de-producao.ts'
import type { CrmLead } from '../operations/types.ts'
import { pendenciasDaJornada } from './jornada-do-escritorio.ts'
import { motivoDoEncaminhamentoEstamparia } from '../operations/estamparia-atendimento.ts'
const agora = Date.parse('2026-10-26T18:00:00Z')
const lead = (id='site:exemplo'): CrmLead => ({...structuredClone(LEAD_DE_EXEMPLO),id,empresa:id,etapa:'novo',sinal:'pronto',marcos:{},resposta:undefined,conversa:undefined,eventos:[]})
const em = '2026-10-26T17:59:00Z'
describe('esteira e movimento com intenção', () => {
  it('encaminhamento automático de preço da Estamparia vira próximo passo do Rômulo', () => {
    const a=lead('estampa:teste');a.produto='estampa';a.etapa='contato';a.marcos.enviado=em
    a.links.whatsapp='https://wa.me/5511999990001' // Identidade sintética válida; nenhuma rede neste teste.
    a.conversa={desde:em,mensagens:1,ultimaEntrada:em,ultima:{direcao:'entrada',em,trecho:'Quanto custa?'}}
    const motivo=motivoDoEncaminhamentoEstamparia('estampa-preco-handoff')!
    a.atendimentoComercial={id:'estampa',tipo:'handoff',titulo:'Conferir condições',motivo,texto:motivo,alvo:'operador',estado:'humano',identidade:'confirmada',ocorridoEm:em}
    const ficha=estacoesDaProducao([a],[],null,agora)[2].fichas[0]
    assert.equal(ficha.situacao,'sua-vez');assert.equal(ficha.responsavel,'Rômulo');assert.equal(ficha.acao,motivo)
  })
  it('cada ficha ocupa uma única estação; seleções não equivalem a envio', () => {
    const a=lead(),b=lead('site:enviado'); b.etapa='contato';b.marcos.enviado=em
    const estacoes=estacoesDaProducao([a,b],[],{ativo:true,estado:'pronto',atualizadoEm:em,fila:[{id:a.id,empresa:a.empresa,estado:'pronto'}]},agora)
    assert.deepEqual(estacoes.map(e => e.fichas.length),[1,1,0,0,0,0])
    assert.equal(new Set(estacoes.flatMap(e => e.fichas.map(f => f.id))).size,2)
    assert.equal(estacoes[0].fichas[0].situacao,'time')
  })
  it('o encaminhamento registrado mantém Elisa e a condição do trabalho', () => {
    const a=lead();a.etapa='contato';a.marcos.enviado=em
    a.links.whatsapp='https://wa.me/5511999990002'
    a.eventos=[{tipo:'nota',rotulo:'Trabalho',em,origem:'manual',fonte:'CRM',texto:textoEventoCiclo({v:1,id:'trabalho-elisa',tipo:'trabalho',data:'2026-10-26',humano:true,referencia:'exemplo',fila:'time',responsavel:'Elisa',tarefa:'Preparar demonstração',resultado:'Material conferido',condicao:'Conferir antes da entrega'},agora)}]
    const ficha=estacoesDaProducao([a],[a.id],null,agora)[1].fichas[0]
    assert.equal(ficha.responsavel,'Elisa');assert.equal(ficha.situacao,'time');assert.equal(ficha.acao,'Preparar demonstração')
  })
  it('a prioridade humana vem primeiro e um envio incerto pede conferência', () => {
    const a=lead('site:a'),b=lead('site:b');for(const l of [a,b]) {l.etapa='contato';l.marcos.enviado=em}
    const estacoes=estacoesDaProducao([a,b],[b.id],{ativo:false,estado:'pausado',atualizadoEm:em,fila:[{id:a.id,empresa:a.empresa,estado:'incerto'}]},agora)
    assert.equal(estacoes[1].fichas[0].id,b.id);assert.equal(estacoes[1].comVoce,1)
    assert.equal(estacoes[1].fichas[1].situacao,'conferencia')
  })
  it('a primeira carga e a releitura não fazem os minions repetir a jornada', () => {
    const a=lead();a.marcos.enviado=em;a.etapa='contato'
    assert.deepEqual(passagensConfirmadas(null,[a],agora),[])
    assert.deepEqual(passagensConfirmadas([a],[structuredClone(a)],agora),[])
    assert.deepEqual(passagensConfirmadas([],[a],agora),[])
  })
  it('um novo envio leva a ficha de Preparação para Contato pela Prospecção', () => {
    const a=lead(),b=structuredClone(a);b.marcos.enviado=em;b.etapa='contato'
    const [passagem]=passagensConfirmadas([a],[b],agora)
    assert.equal(passagem.de,1);assert.equal(passagem.para,2);assert.equal(passagem.salaPortadora,'prumo--prospeccao')
    assert.match(passagem.motivo,/confirmado/)
  })
  it('o material confirmado usa a produção; não presume as fases intermediárias', () => {
    const a=lead(),b=structuredClone(a);b.etapa='contato';b.marcos.segundaEnviada=em
    const [passagem]=passagensConfirmadas([a],[b],agora)
    assert.equal(passagem.de,1);assert.equal(passagem.para,4);assert.equal(passagem.salaPortadora,'prumo--site-antes-da-venda')
  })
  it('mudança de etapa sem marco, data futura e recuo não geram transporte', () => {
    const a=lead(),b=structuredClone(a);b.etapa='proposta'
    assert.deepEqual(passagensConfirmadas([a],[b],agora),[])
    b.proposta={em:'2026-10-27T12:00:00Z',data:'2026-10-27'}
    assert.deepEqual(passagensConfirmadas([a],[b],agora),[])
    b.proposta={em,data:'2026-10-26'}
    assert.deepEqual(passagensConfirmadas([b],[a],agora),[])
  })
  it('ganho sem data não anima um pagamento ou resultado inventado', () => {
    const a=lead(),b=structuredClone(a);b.etapa='ganho'
    assert.deepEqual(passagensConfirmadas([a],[b],agora),[])
  })
  it('o trajeto dos minions chega às mesmas bandejas desenhadas nas mesas', () => {
    for(const fase of [1,2,3,4,5,6] as const) {
      const ponto=pontoDaEsteiraNoMundo(fase)
      assert.deepEqual(toScreen(...ponto),PONTOS_DA_ESTEIRA[fase])
      assert.ok(ponto[0]>=0 && ponto[0]<=480 && ponto[1]>=0 && ponto[1]<=512)
    }
  })
  it('o corredor Contato → Conversa não atravessa Material e é o mesmo nos dois sentidos', () => {
    const caminho=trajetoDaEsteira(2,3)
    assert.deepEqual(caminho[0],PONTOS_DA_ESTEIRA[2])
    assert.deepEqual(caminho.at(-1),PONTOS_DA_ESTEIRA[3])
    assert.ok(!caminho.some(p=>p[0]===PONTOS_DA_ESTEIRA[4][0] && p[1]===PONTOS_DA_ESTEIRA[4][1]))
    assert.deepEqual(trajetoDaEsteira(3,2),[...caminho].reverse())
    for(const [x,y] of trajetoDaEsteira(1,6)) {assert.ok(y+x/2>=0);assert.ok(y-x/2>=0)}
  })
  it('mostra o estado real do executor e distingue espera, trabalho e decisão humana', () => {
    const a=lead();a.etapa='contato';a.marcos.enviado=em
    a.links.whatsapp='https://wa.me/5511999990003'
    const auto={id:'auto',tipo:'automatico',titulo:'Atendimento',motivo:'Preparar somente o material pedido',alvo:'time',estado:'preparar',ocorridoEm:em}
    a.atendimentoComercial=auto
    let ficha=estacoesDaProducao([a],[a.id],null,agora)[1].fichas[0]
    assert.equal(ficha.situacao,'time');assert.equal(ficha.acao,auto.motivo)
    assert.equal(pendenciasDaJornada([a],[],agora).length,0)
    a.atendimentoComercial={...auto,estado:'enviada'}
    ficha=estacoesDaProducao([a],[],null,agora)[1].fichas[0]
    assert.equal(ficha.situacao,'aguardando');assert.equal(ficha.responsavel,'Cliente / condição de espera')
    a.produto='estampa';a.atendimentoComercial={...auto,estado:'aguardando-cliente',texto:'Aguardar novo retorno; Carla continua a conversa quando ele chegar.'}
    ficha=estacoesDaProducao([a],[],null,agora)[1].fichas[0]
    assert.equal(ficha.situacao,'aguardando');assert.match(ficha.acao,/Carla continua/)
    assert.equal(pendenciasDaJornada([a],[],agora).length,0)
    a.atendimentoComercial={...auto,tipo:'handoff',alvo:'operador',estado:'humano',motivo:'Conferir a identidade antes de responder'}
    ficha=estacoesDaProducao([a],[],null,agora)[1].fichas[0]
    assert.equal(ficha.situacao,'conferencia');assert.equal(ficha.responsavel,'Time · conferência')
    assert.equal(pendenciasDaJornada([a],[],agora).length,0)
  })
  it('uma tarefa do time na mesma fase gera encaminhamento uma única vez', () => {
    const a=lead(),b=structuredClone(a);a.etapa=b.etapa='contato';a.marcos.enviado=b.marcos.enviado=em
    b.eventos=[{tipo:'nota',rotulo:'Trabalho',em,origem:'manual',fonte:'CRM',texto:textoEventoCiclo({v:1,id:'nova-tarefa',tipo:'trabalho',data:'2026-10-26',humano:true,referencia:'exemplo',fila:'time',responsavel:'Elisa',tarefa:'Preparar demonstração',resultado:'Material conferido',condicao:'Conferir antes da entrega'},agora)}]
    const [p]=passagensConfirmadas([a],[b],agora)
    assert.equal(p.tipo,'trabalho');assert.equal(p.de,p.para);assert.equal(p.responsavel,'Elisa')
    assert.deepEqual(passagensConfirmadas([b],[structuredClone(b)],agora),[])
  })
  it('uma carteira grande conserva todas as fichas sem apresentar toda a preparação como execução', () => {
    const carteira=Array.from({length:3500},(_,i)=>lead(`site:${i}`))
    const estacoes=estacoesDaProducao(carteira,[],null,agora)
    assert.equal(estacoes.flatMap(e=>e.fichas).length,3500)
    assert.equal(estacoes[0].fichas.filter(f=>f.situacao==='time').length,0)
  })
  it('uma nova resposta depois do material chega ao atendimento sem inventar avanço de fase', () => {
    const a=lead(),b=structuredClone(a)
    a.etapa=b.etapa='contato';a.marcos.segundaEnviada=b.marcos.segundaEnviada='2026-10-26T15:00:00Z'
    b.conversa={desde:em,mensagens:1,ultimaEntrada:em,ultima:{direcao:'entrada',em,trecho:'Tenho uma pergunta'}}
    const [p]=passagensConfirmadas([a],[b],agora)
    assert.equal(p.de,4);assert.equal(p.para,4);assert.match(p.motivo,/Nova resposta/)
    assert.deepEqual(passagensConfirmadas([b],[structuredClone(b)],agora),[])
  })
})
