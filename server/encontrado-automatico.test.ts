import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {decidirEncontrado,type ContextoPoliticaEncontrado,type PoliticaEncontrado} from '../src/operations/encontrado-politica.ts'
import {EncontradoAutomatico,HASH_CATALOGO_ENCONTRADO,validarPoliticaEncontrado,leitorPoliticaEncontrado} from './encontrado-automatico.ts'
import {SaidasEncontrado} from './encontrado-saidas.ts'
import {AtendimentoComercial,type FonteAtendimentoComercial} from './atendimento-comercial.ts'
import {EntradaAtendimentoComercialDuravel,chaveEventoAtendimento,type EventoAtendimentoComercial} from './entrada-atendimento-comercial.ts'
import {mensagemDaCaptura,type ProvaIdentidadeCaptura} from './identidade-captura.ts'
import {comGuardaConversa} from './guarda-conversa.ts'
import {textoResponsavelConversa} from '../src/operations/responsavel-conversa.ts'
import {filaDeVenda} from '../src/operations/proxima-venda.ts'
import {decisoesDoEscritorio} from '../src/office/decisoes.ts'
import {planoComercialDoLead} from '../src/operations/prioridade-comercial.ts'
import {planoDoLead} from '../src/operations/bi-operacao.ts'
import {procedimentoDaDecisao} from '../src/office/procedimento-da-decisao.ts'
import type {CrmLead} from '../src/operations/types.ts'
const AGORA=Date.parse('2026-10-25T14:00:00.000Z'),EM='2026-10-25T13:59:00.000Z',DESDE='2026-10-25T13:00:00.000Z',CONVERSA='2799991234'
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
const politica=():PoliticaEncontrado=>({v:1,modo:'respostas',desde:DESDE,catalogoHash:HASH_CATALOGO_ENCONTRADO})
function lead():CrmLead {return {id:'site:ficticio',chave:'ficticio',produto:'site',empresa:'Empresa fictícia',etapa:'contato',estadoNaPlanilha:'enviado',sinal:'em-conversa',subEtapa:'Conversa',links:{whatsapp:'https://wa.me/552799991234'},eventos:[],marcos:{},notas:0,divergencias:[],conversa:{desde:EM,mensagens:1,ultima:{direcao:'entrada',em:EM,trecho:'Quanto custa?'},ultimaEntrada:EM}} as CrmLead}
function contexto(texto='Quanto custa?'):ContextoPoliticaEncontrado {const l=lead();return {politica:politica(),catalogoHash:HASH_CATALOGO_ENCONTRADO,agora:AGORA,ocorridoEm:EM,texto,identidade:'confirmada',fonteAtual:true,lead:l,leads:[l],historico:[],bloqueio:null}}
test('padrão de preço é informativo, usa catálogo e não exige qualificação ou aprovação por mensagem',()=>{
  const d=decidirEncontrado(contexto());assert.equal(d.acao,'responder')
  if(d.acao==='responder'){assert.match(d.texto,/R\$ 690/);assert.match(d.texto,/R\$ 39\/mês/);assert.match(d.texto,/depois de ver/)}
})
test('dúvidas compostas preservam preço, escopo e ausência de prazo prometido',()=>{
  const d=decidirEncontrado(contexto('Qual preço, o que inclui e qual o prazo?'))
  assert.equal(d.acao,'responder');if(d.acao==='responder'){assert.equal(d.modelo,'preco+escopo+prazo');assert.match(d.texto,/um ajuste por mês/);assert.match(d.texto,/não há prazo geral/)}
})
test('saudações recebem abertura e confirmações simples aguardam sem nova pergunta',()=>{
  assert.equal(decidirEncontrado(contexto('Bom dia!')).acao,'responder')
  for(const s of ['Ok','Obrigado','Entendi'])assert.equal(decidirEncontrado(contexto(s)).acao,'aguardar')
})
test('condições especiais, contratação, dinheiro e escopo customizado são decisões humanas',()=>{
  for(const s of ['Tem desconto?','Quero contratar','Preciso de uma proposta','Paguei','Pode parcelar?','Aceito','Faça um sistema','Preço para 20 páginas','Custa R$ 99?','Valor e blog','Fica pronto amanhã?'])
    assert.equal(decidirEncontrado(contexto(s)).acao,'humano',s)
})
test('prospecção, replay histórico e catálogo alterado nunca são liberados por pergunta de preço',()=>{
  let c=contexto();c.politica.modo='pausado';assert.equal(decidirEncontrado(c).acao,'ignorar')
  c=contexto();c.lead.produto='iris';assert.equal(decidirEncontrado(c).acao,'ignorar')
  c=contexto();c.ocorridoEm='2026-10-24T13:59:00.000Z';assert.equal(decidirEncontrado(c).acao,'ignorar')
  c=contexto();c.politica.catalogoHash=sha('outra');assert.equal(decidirEncontrado(c).acao,'humano')
})
test('condição histórica, proposta e compromisso continuam fora do padrão',()=>{
  let c=contexto();c.historico=[{direcao:'saida',texto:'Sua mensalidade será R$ 90.',em:'2026-10-25T12:00:00.000Z'}];assert.equal(decidirEncontrado(c).acao,'humano')
  c=contexto();c.lead.proposta={em:EM,data:'2026-10-25'};assert.equal(decidirEncontrado(c).acao,'humano')
  c=contexto();c.lead.proximoPasso={texto:'Esperar os sócios',data:'2026-10-30',registradoEm:EM};assert.equal(decidirEncontrado(c).acao,'humano')
})
test('identidade, autoria e fonte não são deduzidas do coletor',()=>{
  for(const identidade of ['sem-prova','conflito','indisponivel']){const c=contexto();c.identidade=identidade;assert.equal(decidirEncontrado(c).acao,'humano')}
  for(const papel of ['robo','recepcao']){const c=contexto();c.papel=papel;assert.equal(decidirEncontrado(c).acao,'humano')}
  const c=contexto();c.fonteAtual=false;assert.equal(decidirEncontrado(c).acao,'aguardar')
  assert.equal(decidirEncontrado(contexto('[áudio]')).acao,'humano')
})
test('recusa e pedido de exclusão não recebem resposta automática',()=>{
  for(const s of ['Não tenho interesse','Pare de me mandar mensagem','Exclua meu número'])assert.equal(decidirEncontrado(contexto(s)).acao,'aguardar',s)
})
test('política exige versão, data real, hash e esquema exatos',()=>{
  assert.deepEqual(validarPoliticaEncontrado(politica(),AGORA),politica())
  for(const p of [{...politica(),v:2},{...politica(),desde:'2026-02-31T13:00:00.000Z'},{...politica(),desde:'2027-01-01T13:00:00.000Z'},{...politica(),ativar:true},{...politica(),catalogoHash:'hash'}])assert.throws(()=>validarPoliticaEncontrado(p,AGORA))
})
async function fixture(t:{after:(f:()=>Promise<unknown>)=>void},texto='Quanto custa?') {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'encontrado-automacao-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  let agora=AGORA,p:PoliticaEncontrado|null=politica(),l=lead(),envios=0,confere:()=>Promise<void>=async()=>{},falhar=false
  const raw:Record<string,unknown>[]=[{id:'entrada-ficticia-001',em:EM,direcao:'entrada',origem:'prumo',texto}]
  const evento:EventoAtendimentoComercial={idOriginal:String(raw[0].id),origem:'whatsapp',conta:'prumo',canal:'whatsapp',conversa:CONVERSA,tipo:'resposta',direcao:'entrada',ocorridoEm:EM,recebidoEm:EM,conteudoHash:sha(texto),fonteId:String(raw[0].id)}
  const config={v:1 as const,identidadePrumoHash:sha('conta-ficticia'),desde:DESDE}
  const fonte=():FonteAtendimentoComercial=>({conversa:CONVERSA,jsonl:raw.map(r=>JSON.stringify(r)).join('\n'),identidade:{ativa:true,assinatura:sha(JSON.stringify(raw)),config,
    jsonl:raw.map(m=>({v:1,coletor:'evolution',garantia:'webhook-evolution',sessaoHash:null,instancia:'prumo',contaHash:config.identidadePrumoHash,capturadoEm:EM,mensagem:mensagemDaCaptura(m)!} satisfies ProvaIdentidadeCaptura)).map(r=>JSON.stringify(r)).join('\n')}})
  const inbox=new EntradaAtendimentoComercialDuravel(path.join(dir,'inbox.json'))
  const atendimento=new AtendimentoComercial({inbox,lerFonte:async()=>fonte(),visao:async()=>({estado:'ok',geradoEm:new Date(agora).toISOString(),leads:[l],colunasAusentes:[],fontes:[]}),agora:()=>agora})
  await atendimento.receber(evento)
  const saidas=new SaidasEncontrado(path.join(dir,'saidas'))
  const criar=()=>new EncontradoAutomatico({atendimento,saidas,politica:async()=>p,agora:()=>agora,bloqueio:async()=>null,
    comConversa:(conversa,acao)=>comGuardaConversa(path.join(dir,'locks'),conversa,acao),
    transporte:{conferir:async()=>confere(),enviar:async()=>{envios++;if(falhar)throw new Error('timeout');return 'saida-ficticia-001'}}})
  return {dir,atendimento,inbox,evento,saidas,criar,raw,envios:()=>envios,lead:()=>l,setLead:(v:CrmLead)=>{l=v},setPolitica:(v:PoliticaEncontrado|null)=>{p=v},setAgora:(v:number)=>{agora=v},setConfere:(v:()=>Promise<void>)=>{confere=v},setFalhar:()=>{falhar=true}}
}
test('entrada real verificada permite uma resposta; reprocessamento e dois executores não duplicam',async t=>{
  const f=await fixture(t),a=f.criar(),b=f.criar();await Promise.all([a.executar(),b.executar()]);await a.executar()
  assert.equal(f.envios(),1);const [s]=await f.saidas.listar();assert.equal(s.estado,'enviada');assert.equal(s.recibo,'saida-ficticia-001')
  assert.equal((await a.estados()).get(f.lead().id)?.acao,'time')
  assert.equal((await fs.readFile(path.join(f.saidas.pasta,s.chave+'.json'),'utf8')).includes('Quanto custa'),false)
})
test('timeout conserva reserva e reinício não repete; saída exata e provada reconcilia',async t=>{
  const f=await fixture(t);f.setFalhar();await f.criar().executar();await f.criar().executar();assert.equal(f.envios(),1)
  const [s]=await f.saidas.listar();assert.equal(s.estado,'incerta')
  f.setAgora(AGORA+6*60000);assert.equal((await f.criar().estados()).get(f.lead().id)?.acao,'humano')
  const d=decidirEncontrado(contexto());assert.equal(d.acao,'responder')
  f.raw.push({id:'saida-provavel-ficticia',direcao:'saida',origem:'prumo',em:new Date(AGORA+1000).toISOString(),texto:d.acao==='responder'?d.texto:''})
  await f.criar().executar();assert.equal(f.envios(),1);assert.equal((await f.saidas.listar())[0].estado,'enviada')
  assert.equal((await f.criar().estados()).get(f.lead().id)?.acao,'time')
  f.setAgora(AGORA+2*86400_000)
  assert.equal((await f.criar().estados()).get(f.lead().id)?.acao,'time')
})
test('falha de saúde é recuperável sem reservar; falha persistente pede decisão e não inventa envio',async t=>{
  const f=await fixture(t);f.setConfere(async()=>{throw new Error('desconectado')})
  await f.criar().executar();assert.equal(f.envios(),0);assert.equal((await f.saidas.listar()).length,0)
  f.setAgora(AGORA+6*60000);assert.equal((await f.criar().estados()).get(f.lead().id)?.acao,'humano')
  f.setConfere(async()=>{});await f.criar().executar();assert.equal(f.envios(),1)
})
test('tomada humana ou pausa durante verificação de saúde veta envio antes da reserva',async t=>{
  const f=await fixture(t)
  f.setConfere(async()=>{f.setPolitica({...politica(),modo:'pausado'})})
  await f.criar().executar();assert.equal(f.envios(),0);assert.equal((await f.saidas.listar()).length,0)
  f.setPolitica(politica())
  f.setConfere(async()=>{const l=f.lead();l.eventos.push({tipo:'nota',origem:'manual',em:EM,rotulo:'Nota',fonte:'CRM',registroTexto:textoResponsavelConversa({v:2,id:'humano-ficticio-001',conta:'prumo',canal:'whatsapp',conversa:CONVERSA,responsavel:'romulo',data:EM,motivo:'Assumir',humano:true,anterior:null},AGORA)})})
  await f.criar().executar();assert.equal(f.envios(),0)
})
test('nova saída durante a conferência invalida a pergunta anterior',async t=>{
  const f=await fixture(t);f.setConfere(async()=>{f.raw.push({id:'saida-humana',direcao:'saida',origem:'prumo',em:new Date(AGORA-1000).toISOString(),texto:'Já respondi'})})
  await f.criar().executar();assert.equal(f.envios(),0)
})
test('sem política, política pausada e backfill anterior não enviam nem reservam',async t=>{
  const f=await fixture(t);f.setPolitica(null);await f.criar().executar()
  f.setPolitica({...politica(),modo:'pausado'});await f.criar().executar()
  f.setPolitica({...politica(),desde:new Date(AGORA).toISOString()});await f.criar().executar()
  assert.equal(f.envios(),0);assert.deepEqual(await f.saidas.listar(),[])
})
test('journal corrompido bloqueia o executor antes do transporte',async t=>{
  const f=await fixture(t);await fs.mkdir(f.saidas.pasta);await fs.writeFile(path.join(f.saidas.pasta,chaveEventoAtendimento(f.evento)+'.json'),'{incompleto')
  await assert.rejects(()=>f.criar().executar());assert.equal(f.envios(),0)
})
test('leitor de política não ativa ausência e recusa arquivo inválido',async t=>{
  const f=await fixture(t),arquivo=path.join(f.dir,'politica.json'),ler=leitorPoliticaEncontrado(arquivo)
  assert.equal(await ler(),null);await fs.writeFile(arquivo,'{}');await assert.rejects(ler)
})
test('execução automática fica fora da fila humana e permanece no acompanhamento',()=>{
  const l=lead();l.atendimentoComercial={id:'auto-ficticio',tipo:'automatico',titulo:'Time atende',motivo:'Respondendo pelo catálogo',alvo:'time',estado:'responder',identidade:'confirmada',ocorridoEm:EM}
  assert.deepEqual(filaDeVenda({hoje:[],leads:[l]},{primeiroLiberado:false,agora:AGORA}),[])
  assert.equal(planoComercialDoLead(l,AGORA).grupo,'aguardar')
  assert.equal(decisoesDoEscritorio([l],[],AGORA)[0].estado,'acompanhando')
  assert.equal(planoDoLead(l,AGORA).responsavel,'Time');assert.equal(planoDoLead(l,AGORA).tipo,'aguardar')
  assert.equal(procedimentoDaDecisao(l,new Date(AGORA)).tipo,'espera')
})
test('reserva e tomada humana compartilham exclusão, sem execução simultânea',async t=>{
  const f=await fixture(t);let liberar!:()=>void;const espera=new Promise<void>(r=>liberar=r),ordem:string[]=[]
  const a=comGuardaConversa(path.join(f.dir,'locks'),CONVERSA,async()=>{ordem.push('envio');await espera;ordem.push('recibo')})
  while(!ordem.length)await new Promise(r=>setTimeout(r,5))
  const b=comGuardaConversa(path.join(f.dir,'locks'),CONVERSA,async()=>{ordem.push('humano')})
  await new Promise(r=>setTimeout(r,30));assert.deepEqual(ordem,['envio']);liberar();await Promise.all([a,b]);assert.deepEqual(ordem,['envio','recibo','humano'])
})
