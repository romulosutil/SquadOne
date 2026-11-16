import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { decidirAtendimentoEstamparia, PERGUNTAS_ESTAMPARIA, proximaPerguntaEstamparia, type ContextoAtendimentoEstamparia, type MensagemEstamparia, type PoliticaAtendimentoEstamparia } from '../src/operations/estamparia-atendimento.ts'
import { EstampariaAutomatico, HASH_ATENDIMENTO_ESTAMPARIA, validarPoliticaEstamparia, type ContextoEntradaEstamparia, type DepsEstamparia } from './estamparia-automatico.ts'
import { SaidasEncontrado } from './encontrado-saidas.ts'
import type { CrmLead, CrmVisao } from '../src/operations/types.ts'
const AGORA=Date.parse('2026-10-26T21:00:00.000Z'),EM='2026-10-26T20:59:00.000Z',DESDE='2026-10-26T20:00:00.000Z'
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
const politica=()=>({v:1 as const,modo:'respostas' as const,desde:DESDE,catalogoHash:HASH_ATENDIMENTO_ESTAMPARIA})
function lead():CrmLead{return {id:'estampa:teste',chave:'teste',produto:'estampa',empresa:'Estamparia fictícia',etapa:'contato',sinal:'em-conversa',eventos:[],marcos:{enviado:'2026-10-26T19:50:00.000Z'},links:{whatsapp:'https://wa.me/5527999991234'},conversa:{desde:EM,mensagens:1,ultimaEntrada:EM,ultima:{direcao:'entrada',em:EM,trecho:'Pode falar por aqui sim!'}}} as CrmLead}
function contexto(texto='Pode falar por aqui sim!'):ContextoAtendimentoEstamparia{return {politica:politica(),catalogoHash:HASH_ATENDIMENTO_ESTAMPARIA,agora:AGORA,ocorridoEm:EM,texto,identidade:'confirmada',fonteAtual:true,respondida:false,lead:lead(),historico:[{id:'entrada',em:EM,hash:sha(texto),direcao:'entrada',texto}],bloqueio:null}}

test('permissão para falar inicia descoberta da rotina, sem presumir compra ou mandar material',()=>{
  const d=decidirAtendimentoEstamparia(contexto());assert.equal(d.acao,'responder')
  if(d.acao==='responder'){assert.equal(d.modelo,'estampa-rotina');assert.match(d.texto,/assistente virtual/);assert.match(d.texto,/planilha/);assert.doesNotMatch(d.texto,/https:|R\$/);assert.equal(d.depois,'cliente')}
})
test('descoberta avança com respostas observadas e não confirma SPICED',()=>{
  const ms:MensagemEstamparia[]=[]
  for(const [id,q] of Object.entries(PERGUNTAS_ESTAMPARIA)) {
    assert.equal(proximaPerguntaEstamparia(ms),id)
    ms.push({id:`s-${id}`,em:EM,hash:sha(q),direcao:'saida',texto:q},{id:`e-${id}`,em:EM,hash:sha('Informação específica'),direcao:'entrada',texto:'Informação específica'})
  }
  assert.equal(proximaPerguntaEstamparia(ms),null)
  const c=contexto('Somos três na operação');c.historico=ms
  const d=decidirAtendimentoEstamparia(c);assert.equal(d.acao,'responder');if(d.acao==='responder'){assert.equal(d.modelo,'estampa-descoberta-handoff');assert.equal(d.depois,'humano');assert.match(d.proximo,/não confirma qualificação/)}
})
test('preço, fiscal, demonstração e contratação recebem encaminhamento explícito sem promessas',()=>{
  for(const [texto,modelo] of [['Quanto custa?','preco'],['Emite nota fiscal?','recurso'],['Pode mandar um vídeo?','demo'],['Quero contratar','contratacao'],['Podemos conversar amanhã?','conversa']]) {
    const d=decidirAtendimentoEstamparia(contexto(texto));assert.equal(d.acao,'responder',texto)
    if(d.acao==='responder'){assert.equal(d.modelo,`estampa-${modelo}-handoff`);assert.equal(d.depois,'humano');assert.match(d.texto,/Rômulo/);assert.doesNotMatch(d.texto,/R\$|690|39\/mês|entrego amanhã/)}
  }
})
test('recusa, bot e agradecimento não recebem apresentação nem follow-up',()=>{
  for(const texto of ['Não tenho interesse','Não quero ver vídeo','Exclua meu número','Obrigado!','Seja muito bem vindo! Mensagem automática.'])assert.equal(decidirAtendimentoEstamparia(contexto(texto)).acao,'aguardar',texto)
})
test('resposta curta não é tratada como informação de qualificação',()=>{
  const c=contexto('Sim');c.historico=[{id:'s',em:EM,hash:sha(PERGUNTAS_ESTAMPARIA.rotina),direcao:'saida',texto:PERGUNTAS_ESTAMPARIA.rotina},...c.historico]
  assert.equal(decidirAtendimentoEstamparia(c).acao,'humano')
  c.historico=[{id:'s',em:EM,hash:sha('responsável'),direcao:'saida',texto:'Consigo falar por aqui com o responsável?'},...contexto('Sim').historico]
  assert.equal(decidirAtendimentoEstamparia(c).acao,'responder')
})
test('não mistura Site, histórico anterior à ativação, pausa e identidade sem prova',()=>{
  let c=contexto();c.lead.produto='site';assert.equal(decidirAtendimentoEstamparia(c).acao,'ignorar')
  c=contexto();c.ocorridoEm='2026-10-26T19:59:00.000Z';assert.equal(decidirAtendimentoEstamparia(c).acao,'ignorar')
  for(const identidade of ['sem-prova','conflito','indisponivel']){c=contexto();c.identidade=identidade;assert.equal(decidirAtendimentoEstamparia(c).acao,'humano')}
  c=contexto();c.bloqueio='Rômulo conduz esta conversa';assert.equal(decidirAtendimentoEstamparia(c).acao,'humano')
  c=contexto();c.lead.proximoPasso={texto:'Aguardar o sócio',data:'2026-10-28',registradoEm:EM};assert.equal(decidirAtendimentoEstamparia(c).acao,'humano')
  c=contexto();c.respondida=true;c.fonteAtual=false;assert.equal(decidirAtendimentoEstamparia(c).acao,'aguardar')
})
test('política exige catálogo, versão e janela explícitos',()=>{
  assert.deepEqual(validarPoliticaEstamparia(politica(),AGORA),politica())
  for(const p of [{...politica(),v:2},{...politica(),desde:'2027-01-01T00:00:00.000Z'},{...politica(),desde:'2026-02-31'},{...politica(),primeirosContatos:true},{...politica(),catalogoHash:'invalido'}])assert.throws(()=>validarPoliticaEstamparia(p,AGORA))
})

async function fixture(t:{after:(f:()=>Promise<unknown>)=>void},texto='Pode falar por aqui sim!') {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'estampa-auto-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  const ms=[{id:'entrada',em:EM,direcao:'entrada' as const,texto}],chave=sha('entrada'),l=lead()
  const c:ContextoEntradaEstamparia={registro:{chave,estado:'processado',evento:{conta:'prumo',conversa:'2799991234',ocorridoEm:EM,conteudoHash:sha(texto),idOriginal:'entrada'}},
    visao:{estado:'ok',geradoEm:EM,colunasAusentes:[],fontes:[],leads:[l]} as unknown as CrmVisao,fonte:{jsonl:JSON.stringify(ms[0]),identidade:{}},conferencia:{estado:'ok',texto,identidade:'confirmada',saidasEm:[],ultimaEntradaEm:EM}}
  const saidas=new SaidasEncontrado(dir),envios:string[]=[]
  let p:PoliticaAtendimentoEstamparia=politica(),em=AGORA,saude=0
  const deps:DepsEstamparia={atendimento:{entradasParaAutomacao:async()=>[c.registro],contextoDaEntrada:async()=>{c.fonte!.jsonl=ms.map(m=>JSON.stringify(m)).join('\n');return c}},saidas,politica:async()=>p,agora:()=>em,
    transporte:{conferir:async()=>{saude++},enviar:async(_n,tx)=>{envios.push(tx);return 'recibo-prumo'}},comConversa:async(_n,fn)=>fn(),identidadeLead:()=> '2799991234',bloqueio:async()=>null,
    verificarMensagem:v=>{const m=v as typeof ms[number];return {idOriginal:m.id,direcao:m.direcao,ocorridoEm:m.em,conteudoHash:sha(m.texto)}}}
  return {c,ms,saidas,envios,deps,get saude(){return saude},setPolitica:(novo:typeof p)=>p=novo,setAgora:(novo:number)=>em=novo,novo:()=>new EstampariaAutomatico(deps)}
}
test('GET de estado não envia; execução persiste reserva antes do transporte e não repete após reinício',async t=>{
  const f=await fixture(t),engine=f.novo()
  const estado=(await engine.estados()).get(f.c.visao.leads[0].id)
  assert.equal(estado?.estado,'responder');assert.match(estado?.proximoPasso??'',/Carla/);assert.equal(f.envios.length,0)
  f.deps.transporte.enviar=async(_n,tx)=>{assert.equal((await f.saidas.listar())[0].estado,'reservada');f.envios.push(tx);return 'recibo-prumo'}
  await engine.executar();await f.novo().executar()
  assert.equal(f.envios.length,1);assert.equal((await f.saidas.listar())[0].estado,'enviada')
  assert.equal((await engine.estados()).get(f.c.visao.leads[0].id)?.estado,'enviada')
})
test('envio ambíguo não é repetido; somente uma saída verificada concilia o recibo',async t=>{
  const f=await fixture(t),engine=f.novo()
  f.deps.transporte.enviar=async(_n,tx)=>{f.envios.push(tx);throw new Error('timeout')}
  await engine.executar();await f.novo().executar();assert.equal(f.envios.length,1);assert.equal((await f.saidas.listar())[0].estado,'incerta')
  f.ms.push({id:'recibo-tardio',em:new Date(AGORA+1000).toISOString(),direcao:'saida' as never,texto:f.envios[0]});f.setAgora(AGORA+2000)
  await engine.executar();assert.equal((await f.saidas.listar())[0].estado,'enviada');assert.equal(f.envios.length,1)
})
test('mudança da conversa durante a conferência de saúde impede envio',async t=>{
  const f=await fixture(t)
  f.deps.transporte.conferir=async()=>{f.c.conferencia.ultimaEntradaEm=new Date(AGORA).toISOString()}
  await f.novo().executar();assert.equal(f.envios.length,0);assert.equal((await f.saidas.listar()).length,0)
})
test('política pausada no último instante impede envio e fonte sem prova não é liberada',async t=>{
  const f=await fixture(t)
  f.deps.transporte.conferir=async()=>{f.setPolitica({...politica(),modo:'pausado' as never})}
  await f.novo().executar();assert.equal(f.envios.length,0)
  const g=await fixture(t);g.deps.verificarMensagem=()=>null;await g.novo().executar();assert.equal(g.envios.length,0)
})
test('pedido de preço vira decisão humana no escritório mesmo depois do recibo',async t=>{
  const f=await fixture(t,'Quanto custa?'),engine=f.novo();await engine.executar()
  const estado=(await engine.estados()).get(f.c.visao.leads[0].id)!
  assert.equal(estado.acao,'humano');assert.equal(estado.estado,'humano');assert.match(estado.proximoPasso,/condições comerciais/)
})
test('recibo anterior não esconde bloqueio humano nem perda da prova de identidade',async t=>{
  const f=await fixture(t),engine=f.novo();await engine.executar()
  f.deps.bloqueio=async()=> 'Rômulo assumiu a conversa'
  assert.equal((await engine.estados()).get(f.c.visao.leads[0].id)?.acao,'humano')
  f.deps.bloqueio=async()=>null;f.c.conferencia.identidade='conflito'
  assert.equal((await engine.estados()).get(f.c.visao.leads[0].id)?.acao,'humano')
})
test('resposta encerrada, oferta diferente e captura antiga não enviam',async t=>{
  for(const alteracao of [(f:Awaited<ReturnType<typeof fixture>>)=>f.c.visao.leads[0].produto='site',
    (f:Awaited<ReturnType<typeof fixture>>)=>f.c.visao.leads[0].etapa='perdido',
    (f:Awaited<ReturnType<typeof fixture>>)=>f.c.registro.evento.ocorridoEm='2026-10-26T19:00:00.000Z']) {
    const f=await fixture(t);alteracao(f);await f.novo().executar();assert.equal(f.envios.length,0)
  }
})

test('retomada inclui somente entradas explicitamente autorizadas, preservando o início da ativação',async t=>{
  const f=await fixture(t),desde=new Date(AGORA).toISOString(),retomada={autorizadaEm:desde,chaves:[f.c.registro.chave]}
  f.setPolitica({...politica(),desde});await f.novo().executar();assert.equal(f.envios.length,0)
  f.setPolitica({...politica(),desde,retomada});await f.novo().executar();await f.novo().executar()
  assert.equal(f.envios.length,1);assert.equal((await f.saidas.listar())[0].entradaEm,EM)
  const resumo=await f.novo().resumo();assert.equal(resumo.desde,desde);assert.equal(resumo.retomada?.entradas,1)
})

test('retomada não manda nova apresentação se Rômulo já respondeu, mas mostra o próximo passo',async t=>{
  const f=await fixture(t),desde=new Date(AGORA).toISOString()
  f.setPolitica({...politica(),desde,retomada:{autorizadaEm:desde,chaves:[f.c.registro.chave]}})
  f.ms.push({id:'saida-humana',em:new Date(AGORA-10000).toISOString(),direcao:'saida' as never,texto:'Aqui está a apresentação do nosso sistema.'})
  f.c.visao.leads[0].conversa!.ultima={direcao:'saida',em:f.ms[1].em,trecho:f.ms[1].texto}
  await f.novo().executar();assert.equal(f.envios.length,0)
  const estado=(await f.novo().estados()).get(f.c.visao.leads[0].id)
  assert.equal(estado?.estado,'aguardando-cliente');assert.equal(estado?.acao,'time');assert.match(estado?.proximoPasso??'',/Carla continua/)
})

test('retomada conserva bloqueios de identidade, recusa, oferta e compromisso',async t=>{
  for(const alterar of [
    (f:Awaited<ReturnType<typeof fixture>>)=>f.c.conferencia.identidade='sem-prova',
    (f:Awaited<ReturnType<typeof fixture>>)=>f.c.visao.leads[0].produto='site',
    (f:Awaited<ReturnType<typeof fixture>>)=>f.c.visao.leads[0].etapa='perdido',
    (f:Awaited<ReturnType<typeof fixture>>)=>f.c.visao.leads[0].proximoPasso={texto:'Reunião com Rômulo',data:'2026-10-27',registradoEm:EM},
  ]) {
    const f=await fixture(t),desde=new Date(AGORA).toISOString()
    f.setPolitica({...politica(),desde,retomada:{autorizadaEm:desde,chaves:[f.c.registro.chave]}});alterar(f)
    await f.novo().executar();assert.equal(f.envios.length,0)
  }
})

test('entrada antiga autorizada não ressuscita quando existe uma entrada posterior fora da lista',async t=>{
  const f=await fixture(t),desde=new Date(AGORA).toISOString()
  f.setPolitica({...politica(),desde,retomada:{autorizadaEm:desde,chaves:[f.c.registro.chave]}})
  const posterior={...f.c.registro,chave:sha('outra-entrada'),evento:{...f.c.registro.evento,idOriginal:'outra-entrada',ocorridoEm:new Date(AGORA-20000).toISOString()}}
  f.deps.atendimento.entradasParaAutomacao=async()=>[f.c.registro,posterior]
  await f.novo().executar();assert.equal(f.envios.length,0);assert.equal((await f.novo().estados()).size,0)
})

test('instante equivalente com e sem milissegundos preserva a captura antiga original',async t=>{
  const f=await fixture(t),emSemMs=EM.replace('.000Z','Z')
  f.c.registro.evento.ocorridoEm=emSemMs;f.ms[0].em=emSemMs;f.c.conferencia.ultimaEntradaEm=emSemMs
  await f.novo().executar();assert.equal(f.envios.length,1)
  assert.equal((await f.saidas.listar())[0].entradaEm,emSemMs)
})

test('retomada recusa lista aberta, duplicada, futura ou com chaves inválidas',()=>{
  const desde=new Date(AGORA).toISOString(),r={autorizadaEm:desde,chaves:[sha('entrada')]}
  const p={...politica(),retomada:r};assert.deepEqual(validarPoliticaEstamparia(p,AGORA),p)
  for(const retomada of [undefined,{}, {...r,chaves:[]},{...r,chaves:[...r.chaves,...r.chaves]},{...r,chaves:['todas']},
    {...r,autorizadaEm:new Date(AGORA+1000).toISOString()},{...r,autorizadaEm:'2026-10-25T00:00:00.000Z'},{...r,todas:true},
    {...r,chaves:Array.from({length:257},(_,i)=>sha(String(i)))}])assert.throws(()=>validarPoliticaEstamparia({...p,retomada},AGORA))
})

test('saudação já classificada como bot aguarda pessoa, sem aplicar uma marca antiga a uma nova entrada humana',()=>{
  const c=contexto('Minha Kamiseta, Seja bem vindo (a) Qual produto deseja? Qual quantidade? Qual data de entrega?')
  c.lead.resposta={tipo:'bot',em:EM,trecho:''}
  const d=decidirAtendimentoEstamparia(c);assert.equal(d.acao,'aguardar');assert.match(d.motivo,/Aguardar uma pessoa/)
  const nova=contexto('Pode falar por aqui sim!');nova.lead.resposta={tipo:'bot',em:'2026-10-25T12:00:00Z',trecho:''}
  assert.equal(decidirAtendimentoEstamparia(nova).acao,'responder')
})

test('saída posterior não oculta compromisso comercial já registrado',()=>{
  const c=contexto();c.respondida=true;c.fonteAtual=false;c.lead.proximoPasso={texto:'Revisar demonstração com Rômulo',data:'2026-10-27',registradoEm:EM}
  assert.equal(decidirAtendimentoEstamparia(c).acao,'humano')
})
test('resposta do shopping que indica outro contato vira próximo passo específico, sem abordar o novo número',()=>{
  const c=contexto('Estamparia fictícia\n43 99917-9930 | TÉRREO')
  c.historico=[{id:'shopping',direcao:'entrada',em:EM,hash:sha('Olá, obrigado por entrar em contato com o Norte Shopping'),texto:'Olá, obrigado por entrar em contato com o Norte Shopping'},...c.historico]
  const d=decidirAtendimentoEstamparia(c);assert.equal(d.acao,'humano');assert.match(d.motivo,/confirmar o contato direto/)
})
test('aviso de retorno automático com Instagram não vira pedido de integração',()=>{
  const c=contexto('Olá!! Tudo bem? Obrigado por entrar em contato. Em breve um consultor especialista em mídia Out of Home entrará em contato com você! Agradecemos o seu contato 😉 www.instagram.com/ultra.ooh')
  const d=decidirAtendimentoEstamparia(c);assert.equal(d.acao,'aguardar');assert.match(d.motivo,/Aguardar uma pessoa/)
})

const AUTORESPOSTA_ULTRA='Olá!! Tudo bem?\n\nObrigado por entrar em contato com a Ultra OOH\n\nEm breve um consultor especialista em mídia Out of Home entrará em contato com você!\n\nAgradecemos o seu contato 😉\n\nwww.instagram.com/ultra.ooh'

test('texto integral do incidente Ultra não reserva nem envia, mesmo com classificação humana incorreta',async t=>{
  for(const papel of [undefined,'gente']) {
    const f=await fixture(t,AUTORESPOSTA_ULTRA)
    f.c.conferencia.papel=papel
    f.c.visao.leads[0].resposta={tipo:'interesse',em:EM,trecho:AUTORESPOSTA_ULTRA}
    const engine=f.novo();await engine.executar();await f.novo().executar()
    assert.equal(f.saude,0);assert.deepEqual(f.envios,[]);assert.deepEqual(await f.saidas.listar(),[])
    assert.match((await engine.estados()).get(f.c.visao.leads[0].id)?.proximoPasso??'',/Aguardar uma pessoa/)
  }
})

test('URL ou assinatura de Instagram não bastam para prometer encaminhamento de uma função',()=>{
  for(const texto of ['Nosso portfólio: www.instagram.com/ultra.ooh','Instagram: @empresa','Pode conferir nosso portfólio: https://instagram.com/empresa?integracao=erp']) {
    assert.equal(decidirAtendimentoEstamparia(contexto(texto)).acao,'humano',texto)
  }
  for(const texto of ['Quero integrar o Instagram','Tem integração com ERP?','Emite nota fiscal?']) {
    const d=decidirAtendimentoEstamparia(contexto(texto))
    assert.equal(d.acao,'responder',texto)
    if(d.acao==='responder')assert.equal(d.modelo,'estampa-recurso-handoff',texto)
  }
})

test('ausência com horário comercial não inicia descoberta nem consome perguntas',async t=>{
  const texto='Entraremos em contato. Horário comercial de: Seg. a Sexta 9 às 18h'
  const f=await fixture(t,texto);await f.novo().executar()
  assert.deepEqual(f.envios,[]);assert.deepEqual(await f.saidas.listar(),[])
  const ms:MensagemEstamparia[]=[{id:'s',em:EM,hash:sha(PERGUNTAS_ESTAMPARIA.rotina),direcao:'saida',texto:PERGUNTAS_ESTAMPARIA.rotina},
    {id:'e',em:EM,hash:sha(texto),direcao:'entrada',texto}]
  assert.equal(proximaPerguntaEstamparia(ms),'rotina')
})
test('legado já respondido só permite esperar, sem fabricar prova ou autorização para envio',async t=>{
  const f=await fixture(t),desde=new Date(AGORA).toISOString()
  f.setPolitica({...politica(),desde,retomada:{autorizadaEm:desde,chaves:[f.c.registro.chave]}})
  f.c.conferencia={estado:'invalida',identidade:'sem-prova'}
  f.ms.push({id:'saida-antiga',em:new Date(AGORA-20000).toISOString(),direcao:'saida' as never,texto:'Apresentação já enviada.'})
  f.c.visao.leads[0].conversa!.ultima={direcao:'saida',em:f.ms[1].em,trecho:f.ms[1].texto}
  const engine=f.novo();await engine.executar()
  assert.equal(f.envios.length,0);assert.equal(f.saude,0)
  const estado=(await engine.estados()).get(f.c.visao.leads[0].id)!
  assert.equal(estado.estado,'aguardando-cliente');assert.equal(estado.identidade,'sem-prova');assert.match(estado.proximoPasso,/confere a nova mensagem/)
  f.c.conferencia.identidade='conflito';assert.equal((await engine.estados()).get(f.c.visao.leads[0].id)?.acao,'humano')
})
test('histórico sem prova e sem saída posterior continua sem autorização para responder',async t=>{
  const f=await fixture(t),desde=new Date(AGORA).toISOString()
  f.setPolitica({...politica(),desde,retomada:{autorizadaEm:desde,chaves:[f.c.registro.chave]}});f.c.conferencia={estado:'invalida',identidade:'sem-prova'}
  await f.novo().executar();assert.equal(f.envios.length,0);assert.equal((await f.novo().estados()).get(f.c.visao.leads[0].id)?.acao,'humano')
})
test('corrigir bot conserva o recibo existente e retira encaminhamento comercial indevido',async t=>{
  const f=await fixture(t,'Mensagem automática. Em breve um consultor entrará em contato com você.'),engine=f.novo()
  await f.saidas.reservar({v:1,chave:f.c.registro.chave,conversa:f.c.registro.evento.conversa,leadId:f.c.visao.leads[0].id,entradaEm:EM,em:EM,politicaHash:sha('politica'),contextoHash:sha('contexto'),textoHash:sha('mensagem-anterior'),modelo:'estampa-recurso-handoff',estado:'reservada'})
  await f.saidas.concluir(f.c.registro.chave,'enviada','recibo-existente')
  await engine.executar();assert.equal(f.envios.length,0)
  const estado=(await engine.estados()).get(f.c.visao.leads[0].id)!
  assert.equal(estado.acao,'time');assert.match(estado.proximoPasso,/Aguardar uma pessoa/);assert.equal((await f.saidas.listar())[0].recibo,'recibo-existente')
})
test('recusa recuperada antes de uma saudação posterior suspende contato em vez de recomeçar a qualificação',()=>{
  const c=contexto('Bom dia!');c.historico=[{id:'recusa',direcao:'entrada',em:EM,hash:sha('infelizmente não estamos interessado tá'),texto:'infelizmente não estamos interessado tá'},...c.historico]
  const d=decidirAtendimentoEstamparia(c);assert.equal(d.acao,'aguardar');assert.equal('restricao' in d&&d.restricao,'recusa');assert.match(d.motivo,/Não enviar novas mensagens/)
})
test('leitura da tela compartilha a visão fornecida; execução continua revalidando sem snapshot da tela',async t=>{
  const f=await fixture(t),vistas:Array<ContextoEntradaEstamparia['visao']|undefined>=[],ler=f.deps.atendimento.contextoDaEntrada
  f.deps.atendimento.contextoDaEntrada=async(chave,v)=>{vistas.push(v);return ler(chave)}
  await f.novo().estados(f.c.visao);assert.equal(vistas.length,1);assert.equal(vistas[0],f.c.visao)
  vistas.length=0;await f.novo().executar();assert.equal(f.envios.length,1);assert.ok(vistas.length>=3);assert.ok(vistas.every(v=>v===undefined))
})
