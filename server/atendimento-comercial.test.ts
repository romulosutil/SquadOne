import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import type { CrmLead } from '../src/operations/types.ts'
import { PREFIXO_RESPONSAVEL, type ResponsavelConversa } from '../src/operations/responsavel-conversa.ts'
import { textoEventoCiclo, type EventoCiclo } from '../src/operations/ciclo-comercial.ts'
import { qualificacaoComercialVazia, textoDaQualificacaoComercial } from '../src/operations/qualificacao-comercial.ts'
import { EntradaAtendimentoComercialDuravel, type EventoAtendimentoComercial } from './entrada-atendimento-comercial.ts'
import { AtendimentoComercial, conferirFonteAtendimento, criarLeitorFonteAtendimento, type FonteAtendimentoComercial } from './atendimento-comercial.ts'
const agora=Date.parse('2026-10-23T18:00:00Z'), em='2026-10-23T17:00:00Z'
const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex')
function mensagem(texto='Preciso organizar meus contatos',extra:Partial<EventoAtendimentoComercial>={}) {
  const evento:EventoAtendimentoComercial={idOriginal:'msg-ficticia-001',origem:'whatsapp',conta:'prumo',canal:'whatsapp',conversa:'2799991234',tipo:'resposta',direcao:'entrada',ocorridoEm:em,recebidoEm:'2026-10-23T17:00:01Z',conteudoHash:hash(texto),fonteId:'msg-ficticia-001',...extra}
  return {evento,fonte:{conversa:evento.conversa,jsonl:JSON.stringify({id:evento.idOriginal,origem:'prumo',em:evento.ocorridoEm,direcao:evento.direcao,texto})}}
}
function lead(extra:Partial<CrmLead>={}):CrmLead {
  return {id:'prumo:ficticio',produto:'prumo',empresa:'Empresa de teste',etapa:'contato',links:{whatsapp:'https://wa.me/552799991234'},eventos:[],marcos:{},notas:0,
    conversa:{desde:em,mensagens:1,ultima:{direcao:'entrada',em,trecho:'Preciso organizar meus contatos'},ultimaEntrada:em},...extra} as CrmLead
}
async function fixture(t:{after:(fn:()=>Promise<unknown>)=>void},texto?:string) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'controlador-atendimento-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  const {evento,fonte:original}=mensagem(texto)
  let fonte:FonteAtendimentoComercial|null=original,leads=[lead()],leituras=0
  const inbox=new EntradaAtendimentoComercialDuravel(path.join(dir,'inbox.json'))
  const controlador=new AtendimentoComercial({inbox,lerFonte:async()=>fonte,visao:async()=>{leituras++;return {estado:'ok',geradoEm:new Date(agora).toISOString(),leads}},agora:()=>agora})
  return {dir,inbox,controlador,evento,original,setFonte:(f:FonteAtendimentoComercial|null)=>{fonte=f},setLeads:(l:CrmLead[])=>{leads=l},leituras:()=>leituras}
}
test('fonte exata usa SHA256 UTF8 sem trim ou normalização e origem prumo',()=>{
  const {evento,fonte}=mensagem('Olá çã 😀 ')
  assert.equal(conferirFonteAtendimento(evento,fonte).estado,'ok')
  for(const f of [{...fonte,conversa:'1199991234'},{...fonte,jsonl:fonte.jsonl.replace('prumo','pessoal')},{...fonte,jsonl:fonte.jsonl.replace('😀 ','😀')},{...fonte,jsonl:fonte.jsonl+'\n'+fonte.jsonl},{...fonte,jsonl:fonte.jsonl+'\n{ilegivel'}])assert.equal(conferirFonteAtendimento(evento,f).estado,'invalida')
  assert.equal(conferirFonteAtendimento({...evento,fonteId:'outra-fonte'},fonte).estado,'invalida')
  assert.equal(conferirFonteAtendimento({...evento,idOriginal:'msg-ausente',fonteId:'msg-ausente'},fonte).estado,'ausente')
})
test('receber confirma só persistência e fonte ausente mantém pendente sem reserva',async t=>{
  const f=await fixture(t);await f.controlador.receber(f.evento);assert.equal(f.leituras(),0)
  f.setFonte(null);assert.deepEqual(await f.controlador.atualizar(),{verificados:1,concluidos:0,aguardandoFonte:1})
  const [r]=await f.inbox.listar();assert.equal(r.estado,'pendente');assert.equal(r.tentativa,undefined)
  assert.equal((await f.controlador.listarPendencias())[0].tipo,'aguardando-fonte')
  f.setFonte(f.original);assert.equal((await f.controlador.atualizar()).concluidos,1)
})
test('piloto prepara uma pergunta determinística; inbox não guarda texto e leitura não grava',async t=>{
  const f=await fixture(t);await f.controlador.receber(f.evento);await f.controlador.atualizar()
  const antes=await fs.readFile(f.inbox.arquivo,'utf8'),[p]=await f.controlador.listarPendencias()
  assert.equal(p.tipo,'rascunho');assert.equal(p.texto,'O que você precisa resolver ou melhorar hoje?');assert.equal(p.alvo,'cliente');assert.equal(p.leadId,'prumo:ficticio')
  assert.equal(antes.includes('Preciso organizar'),false);assert.equal(antes.includes('resolver ou melhorar'),false)
  assert.equal(await fs.readFile(f.inbox.arquivo,'utf8'),antes)
  assert.equal((await f.controlador.atualizar()).concluidos,0)
})
test('visão já lida evita reentrada na fonte CRM e ainda permite pergunta',async t=>{
  const f=await fixture(t);await f.controlador.receber(f.evento)
  const [p]=await f.controlador.listarPendencias({leads:[lead()]})
  assert.equal(f.leituras(),0);assert.equal(p.tipo,'rascunho')
})
test('sinais financeiros verificados em cenários isolados não sugerem pergunta ao cliente',async t=>{
  for(const texto of ['Qual é o preço?','Quero a assinatura','Quanto custa?','Consegue desconto?','Quero negociar','Aceito a proposta','Preciso do contrato','Paguei','Não tenho interesse','Pare de me mandar mensagem']) {
    const f=await fixture(t,texto);await f.controlador.receber(f.evento);await f.controlador.atualizar()
    const [p]=await f.controlador.listarPendencias();assert.equal(p.tipo,'handoff',texto);assert.equal(p.texto,undefined,texto)
  }
})
test('integridade divergente conclui diagnóstico seguro sem reproduzir mensagem privada',async t=>{
  const f=await fixture(t,'SEGREDO_FICTICIO_QUE_NAO_PODE_VOLTAR');await f.controlador.receber(f.evento)
  f.setFonte({...f.original,jsonl:f.original.jsonl.replace('SEGREDO_FICTICIO','ALTERADO_FICTICIO')})
  assert.equal((await f.controlador.atualizar()).concluidos,1)
  const [p]=await f.controlador.listarPendencias();assert.equal(p.tipo,'handoff');assert.match(p.motivo,/Integridade/)
  assert.equal(JSON.stringify(p).includes('SEGREDO_FICTICIO'),false)
})
test('troca de responsável para Rômulo bloqueia pergunta sem esconder histórico',async t=>{
  const f=await fixture(t)
  const r:ResponsavelConversa={v:2,id:'dono-ficticio-001',conta:'prumo',canal:'whatsapp',conversa:'2799991234',responsavel:'romulo',data:em,motivo:'Assumido pelo operador',humano:true,anterior:null}
  f.setLeads([lead({eventos:[{tipo:'nota',origem:'manual',em,registroTexto:PREFIXO_RESPONSAVEL+JSON.stringify(r),rotulo:'Nota',fonte:'CRM'}]})])
  await f.controlador.receber(f.evento);const [p]=await f.controlador.listarPendencias()
  assert.equal(p.tipo,'handoff');assert.equal(p.texto,undefined);assert.match(p.motivo,/assumiu/)
})
test('recusa, encerramento, pause e nova saída no CRM preservam somente revisão interna',async t=>{
  const f=await fixture(t);await f.controlador.receber(f.evento)
  for(const l of [lead({resposta:{tipo:'negativa',trecho:'Não',em}}),lead({etapa:'ganho'}),lead({revisaoComercial:'Conferir fonte'}),lead({conversa:{desde:em,mensagens:2,ultima:{direcao:'saida',em:'2026-10-23T17:05:00Z',trecho:'Já respondi'},ultimaEntrada:em}})]) {
    f.setLeads([l]);const [p]=await f.controlador.listarPendencias();assert.equal(p.tipo,'handoff');assert.equal(p.texto,undefined)
  }
})
test('múltiplas oportunidades preservam IDs e pedem escolha humana, sem fundir qualificação',async t=>{
  const f=await fixture(t);f.setLeads([lead(),lead({id:'site:ficticio',produto:'site'})]);await f.controlador.receber(f.evento)
  const [p]=await f.controlador.listarPendencias();assert.equal(p.tipo,'handoff');assert.equal(p.leadId,undefined);assert.deepEqual(p.leadIds,['prumo:ficticio','site:ficticio'])
})
test('mudança posterior na qualificação recalcula contexto e invalida rascunho antigo',async t=>{
  const f=await fixture(t);await f.controlador.receber(f.evento);await f.controlador.atualizar()
  const q={...qualificacaoComercialVazia(agora),id:'qual-ficticia-001',necessidade:'Organizar contatos',fonte:'WhatsApp',evidencia:'Conferido pelo operador'}
  f.setLeads([lead({eventos:[{tipo:'nota',origem:'manual',em:new Date(agora).toISOString(),rotulo:'Nota',fonte:'CRM',registroTexto:textoDaQualificacaoComercial(q,agora)}]})])
  const [p]=await f.controlador.listarPendencias();assert.equal(p.tipo,'handoff');assert.equal(p.texto,undefined);assert.match(p.motivo,/contexto mudou/)
})
test('recebimento/leitura/saída não são compra nem geram nova pergunta',async t=>{
  const f=await fixture(t)
  for(const e of [{...f.evento,tipo:'leitura' as const,direcao:'saida' as const},{...f.evento,tipo:'entrega' as const,direcao:'saida' as const},{...f.evento,tipo:'mensagem' as const,direcao:'saida' as const}])await f.controlador.receber(e)
  assert.equal((await f.controlador.atualizar()).verificados,0);assert.deepEqual(await f.controlador.listarPendencias(),[])
})
test('leitor abre somente conversa canônica e limita arquivo a 8 MiB',async t=>{
  const f=await fixture(t),ler=criarLeitorFonteAtendimento(f.dir)
  assert.equal(await ler(f.evento),null)
  await fs.writeFile(path.join(f.dir,f.evento.conversa+'.jsonl'),f.original.jsonl)
  assert.deepEqual(await ler(f.evento),f.original)
  await assert.rejects(()=>ler({...f.evento,conversa:'../segredo'}),/inválida/)
  const h=await fs.open(path.join(f.dir,f.evento.conversa+'.jsonl'),'w');await h.truncate(8*1024*1024+1);await h.close()
  await assert.rejects(()=>ler(f.evento),/limite/)
})
test('pausa humana posterior à entrada e qualificação negativa impedem pergunta',async t=>{
  const f=await fixture(t);await f.controlador.receber(f.evento)
  const q={...qualificacaoComercialVazia(agora),id:'qual-negativa-001',intencao:'sem-interesse' as const,fonte:'WhatsApp',evidencia:'Conferido pelo operador'}
  const pausado=lead({eventos:[{tipo:'nota',origem:'manual',em:'2026-10-23T17:30:00Z',rotulo:'Nota',fonte:'CRM',texto:'[aprendizado-v1] '+JSON.stringify({fato:'Pediu tempo',hipotese:'Em avaliação',teste:'Esperar resposta',resultado:'inconclusivo',pausarAteResposta:true})}]})
  const negativo=lead({eventos:[{tipo:'nota',origem:'manual',em:new Date(agora).toISOString(),rotulo:'Nota',fonte:'CRM',registroTexto:textoDaQualificacaoComercial(q,agora)}]})
  for(const l of [pausado,negativo]){f.setLeads([l]);const [p]=await f.controlador.listarPendencias();assert.equal(p.tipo,'handoff');assert.equal(p.texto,undefined)}
})
test('pergunta para operador não vira mensagem pronta para cliente',async t=>{
  const f=await fixture(t),q={...qualificacaoComercialVazia(agora),id:'qual-parcial-001',necessidade:'Organizar contatos',fonte:'WhatsApp',evidencia:'Conferido pelo operador'}
  f.setLeads([lead({eventos:[{tipo:'nota',origem:'manual',em:new Date(agora).toISOString(),rotulo:'Nota',fonte:'CRM',registroTexto:textoDaQualificacaoComercial(q,agora)}]})])
  await f.controlador.receber(f.evento);const [p]=await f.controlador.listarPendencias()
  assert.equal(p.tipo,'rascunho');assert.equal(p.alvo,'operador');assert.equal(p.texto,undefined);assert.match(p.orientacao,/Qual oferta/)
})
test('CRM desatualizado ou inválido pede revisão, sem usar cópia antiga',async t=>{
  const f=await fixture(t);await f.controlador.receber(f.evento)
  for(const v of [{leads:[lead()],estado:'retrato-invalido' as const},{leads:[lead()],geradoEm:'2026-10-23T10:00:00Z'},{leads:[lead()],geradoEm:'invalido'}]){
    const [p]=await f.controlador.listarPendencias(v);assert.equal(p.tipo,'handoff');assert.equal(p.texto,undefined)
  }
})
test('reserva ambígua permanece passagem interna e entradas da mesma conversa não se duplicam na fila',async t=>{
  const f=await fixture(t);const r=await f.controlador.receber(f.evento),res=await f.inbox.reservar(r.registro.chave);assert.ok(res)
  await f.inbox.marcarAmbiguo(r.registro.chave,res.token)
  const m=mensagem('Novo contexto',{idOriginal:'msg-posterior-002',fonteId:'msg-posterior-002',ocorridoEm:'2026-10-23T17:01:00Z',recebidoEm:'2026-10-23T17:01:01Z'})
  await f.controlador.receber(m.evento)
  const fila=await f.controlador.listarPendencias();assert.equal(fila.length,1);assert.equal(fila[0].tipo,'handoff');assert.equal(fila[0].texto,undefined)
})
test('proposta preparada no ciclo bloqueia pergunta mesmo sem campo proposta legado',async t=>{
  const f=await fixture(t)
  const proposta:EventoCiclo={v:1,id:'prop-ficticia-001',tipo:'proposta',data:'2026-10-23',humano:true,referencia:'P-FICTICIA',ofertaId:'anuncios',versao:1,escopo:'Escopo fictício',prazo:'A combinar',condicoes:'Revisar',responsavel:'Operador',valor:10000,mensalidade:0}
  f.setLeads([lead({eventos:[{tipo:'nota',origem:'manual',em,rotulo:'Nota',fonte:'CRM',registroTexto:textoEventoCiclo(proposta,agora)}]})])
  await f.controlador.receber(f.evento);const [p]=await f.controlador.listarPendencias()
  assert.equal(p.tipo,'handoff');assert.equal(p.texto,undefined);assert.match(p.motivo,/histórico do ciclo/)
})
test('saída posterior exata na fonte e CRM retira somente derivado concluído, mantendo inbox',async t=>{
  const f=await fixture(t);await f.controlador.receber(f.evento);await f.controlador.atualizar()
  const saida='2026-10-23T17:05:00Z',linha=JSON.stringify({id:'saida-ficticia-001',origem:'prumo',em:saida,direcao:'saida',texto:'Respondido pelo operador'})
  f.setFonte({...f.original,jsonl:f.original.jsonl+'\n'+linha})
  f.setLeads([lead({conversa:{desde:em,mensagens:2,ultimaEntrada:em,ultimaSaida:saida,ultima:{direcao:'saida',em:saida,trecho:'Respondido'}}})])
  assert.deepEqual(await f.controlador.listarPendencias(),[])
  assert.equal((await f.inbox.listar())[0].estado,'concluido')
  f.setFonte(f.original)
  assert.equal((await f.controlador.listarPendencias()).length,1,'CRM sozinho não prova saída na fonte')
})
test('entrada posterior sem envelope exige revisão atual sem ressuscitar pergunta antiga',async t=>{
  const f=await fixture(t);await f.controlador.receber(f.evento);await f.controlador.atualizar()
  f.setFonte({...f.original,jsonl:f.original.jsonl+'\n'+JSON.stringify({id:'entrada-sem-envelope',origem:'prumo',em:'2026-10-23T17:05:00Z',direcao:'entrada',texto:'Nova informação ainda não projetada'})})
  const [p]=await f.controlador.listarPendencias();assert.equal(p.tipo,'handoff');assert.equal(p.texto,undefined);assert.match(p.motivo,/entrada original posterior/)
})
test('saída posterior não esconde reserva ambígua',async t=>{
  const f=await fixture(t),r=await f.controlador.receber(f.evento),res=await f.inbox.reservar(r.registro.chave);assert.ok(res);await f.inbox.marcarAmbiguo(r.registro.chave,res.token)
  const saida='2026-10-23T17:05:00Z'
  f.setFonte({...f.original,jsonl:f.original.jsonl+'\n'+JSON.stringify({id:'saida-apos-ambiguidade',origem:'prumo',em:saida,direcao:'saida',texto:'Respondido'})})
  f.setLeads([lead({conversa:{desde:em,mensagens:2,ultimaEntrada:em,ultimaSaida:saida,ultima:{direcao:'saida',em:saida,trecho:'Respondido'}}})])
  const [p]=await f.controlador.listarPendencias();assert.equal(p.estado,'ambiguo');assert.equal(p.tipo,'handoff');assert.equal(p.texto,undefined)
})