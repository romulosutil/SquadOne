import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {decidirEncontrado,type ContextoPoliticaEncontrado,type PoliticaEncontrado} from '../src/operations/encontrado-politica.ts'
import {EncontradoAutomatico,HASH_CATALOGO_ENCONTRADO,validarPoliticaEncontrado,leitorPoliticaEncontrado} from './encontrado-automatico.ts'
import {SaidasEncontrado} from './encontrado-saidas.ts'
import {QualificadorEncontrado,HASH_QUALIFICACAO_ENCONTRADO,extrairQualificacaoEncontrado,type MensagemQualificacao} from './encontrado-qualificacao.ts'
import {MateriaisEncontrado,type ResultadoMaterialEncontrado} from './encontrado-materiais.ts'
import {PERGUNTAS_ENCONTRADO} from '../src/operations/encontrado-qualificacao.ts'
import {ConfiguracaoPropostaEncontrado,HASH_POLITICA_PROPOSTA_ENCONTRADO,type ClienteAutentique} from './encontrado-proposta-config.ts'
import {ContratacaoEncontrado,shaProposta} from './encontrado-contratacao.ts'
import {CONDICOES_SUGERIDAS_ENCONTRADO} from '../src/operations/encontrado-proposta.ts'
import type {DocumentoAutentique} from './autentique.ts'
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
async function fixture(t:{after:(f:()=>Promise<unknown>)=>void},texto='Quanto custa?',lote2=false,lote3=false) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'encontrado-automacao-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  let agora=AGORA,p:PoliticaEncontrado|null=politica(),l=lead(),envios=0,confere:()=>Promise<void>=async()=>{},falhar=false
  if(lote2){p.qualificacao={v:1,desde:DESDE,politicaHash:HASH_QUALIFICACAO_ENCONTRADO};l.pasta={lugar:'_em-conversa',slug:'empresa-ficticia'}}
  let verificar:(id:string)=>Promise<unknown>=async()=>null
  const raw:Record<string,unknown>[]=[{id:'entrada-ficticia-001',em:EM,direcao:'entrada',origem:'prumo',texto}]
  const evento:EventoAtendimentoComercial={idOriginal:String(raw[0].id),origem:'whatsapp',conta:'prumo',canal:'whatsapp',conversa:CONVERSA,tipo:'resposta',direcao:'entrada',ocorridoEm:EM,recebidoEm:EM,conteudoHash:sha(texto),fonteId:String(raw[0].id)}
  const config={v:1 as const,identidadePrumoHash:sha('conta-ficticia'),desde:DESDE}
  const fonte=():FonteAtendimentoComercial=>({conversa:CONVERSA,jsonl:raw.map(r=>JSON.stringify(r)).join('\n'),identidade:{ativa:true,assinatura:sha(JSON.stringify(raw)),config,
    jsonl:raw.filter(m=>mensagemDaCaptura(m)!==null&&m.provaAusente!==true).map(m=>({v:1,coletor:'evolution',garantia:'webhook-evolution',sessaoHash:null,instancia:'prumo',contaHash:config.identidadePrumoHash,capturadoEm:EM,mensagem:mensagemDaCaptura(m)!} satisfies ProvaIdentidadeCaptura)).map(r=>JSON.stringify(r)).join('\n')}})
  const inbox=new EntradaAtendimentoComercialDuravel(path.join(dir,'inbox.json'))
  const atendimento=new AtendimentoComercial({inbox,lerFonte:async()=>fonte(),visao:async()=>({estado:'ok',geradoEm:new Date(agora).toISOString(),leads:[l],colunasAusentes:[],fontes:[]}),agora:()=>agora})
  await atendimento.receber(evento)
  const saidas=new SaidasEncontrado(path.join(dir,'saidas'))
  const qualificador=new QualificadorEncontrado(path.join(dir,'qualificacao'),()=>agora),materiais=new MateriaisEncontrado(path.join(dir,'materiais'),id=>verificar(id))
  let documentosCriados=0,testeAssinatura:DocumentoAutentique|null=null;const documentos:DocumentoAutentique[]=[]
  const apiAssinatura:ClienteAutentique={conta:async()=>({id:'conta-ficticia-001',nome:'Operador fictício',email:'operador@example.com',gratuita:true,organizacao:null}),
    criar:async(name,_html,cliente,_validade,sandbox)=>{const d:DocumentoAutentique={id:sandbox?'sandbox-ficticio-001':'documento-ficticio-001',name,created_at:new Date(agora).toISOString(),sandbox:!!sandbox,deleted_at:null,files:{original:'https://storage.googleapis.com/ficticio/original.pdf',signed:null},signatures:[{public_id:'assinatura-ficticia-001',name:cliente.representante,email:cliente.email,action:{name:'SIGN'},link:{short_link:'https://assina.ae/linkficticio001'},signed:null,rejected:null,signed_unapproved:null,biometric_rejected:null}]};if(sandbox)testeAssinatura=d;else{documentosCriados++;documentos.push(d)}return d},
    documento:async id=>id==='sandbox-ficticio-001'?testeAssinatura!:documentos[0],localizar:async(_nome,sandbox)=>sandbox?testeAssinatura:documentos[0]??null,original:async()=>({hash:shaProposta('%PDF-1.4 fixture'),bytes:Buffer.from('%PDF-1.4 fixture')})}
  const configProposta=new ConfiguracaoPropostaEncontrado(dir,()=>apiAssinatura,()=>agora),contratacao=new ContratacaoEncontrado(path.join(dir,'propostas'),configProposta,()=>agora)
  if(lote3){
    await configProposta.salvar({prumo:{razaoSocial:'Prestadora fictícia LTDA',cnpj:'12ABC34501DE35',representante:'Pessoa da prestadora',email:'prestadora@example.com'},condicoes:CONDICOES_SUGERIDAS_ENCONTRADO,token:'token-ficticio-sem-rede'})
    await configProposta.homologar();const v=await configProposta.visao();await configProposta.aprovar(v.modeloHash,'operador-ficticio')
    p!.proposta={v:1,desde:DESDE,politicaHash:HASH_POLITICA_PROPOSTA_ENCONTRADO,modeloHash:v.modeloHash}
  }
  const criar=()=>new EncontradoAutomatico({atendimento,saidas,politica:async()=>p,agora:()=>agora,bloqueio:async()=>null,
    ...(lote2?{qualificador,materiais}:{}),
    ...(lote3?{contratacao}:{}),
    comConversa:(conversa,acao)=>comGuardaConversa(path.join(dir,'locks'),conversa,acao),
    transporte:{conferir:async()=>confere(),enviar:async()=>{envios++;if(falhar)throw new Error('timeout');return 'saida-ficticia-001'}}})
  return {dir,atendimento,inbox,evento,saidas,criar,raw,qualificador,materiais,contratacao,configProposta,documentos,documentosCriados:()=>documentosCriados,setVerificar:(v:typeof verificar)=>{verificar=v},envios:()=>envios,lead:()=>l,setLead:(v:CrmLead)=>{l=v},setPolitica:(v:PoliticaEncontrado|null)=>{p=v},setAgora:(v:number)=>{agora=v},setConfere:(v:()=>Promise<void>)=>{confere=v},setFalhar:()=>{falhar=true}}
}

const cadastroProposta='Razão social: Empresa fictícia LTDA\nCNPJ: 11222333000181\nRepresentante: Pessoa do cliente\nE-mail: cliente@example.com'
test('pedido natural de proposta coleta dados, cria documento e envia link sem criar fato humano',async t=>{
 const f=await fixture(t,'Quero uma proposta\n'+cadastroProposta,true,true),a=f.criar()
 await a.executar();assert.equal(f.documentosCriados(),1);assert.equal(f.envios(),0)
 await a.executar();await a.executar();assert.equal(f.documentosCriados(),1);assert.equal(f.envios(),1)
 const [s]=await f.saidas.listar();assert.equal(s.modelo,'proposta-assinatura');assert.ok(s.propostaId)
 assert.equal((await a.estados()).get(f.lead().id)?.acao,'time');assert.equal(f.lead().eventos.length,0)
})
test('dados faltantes vêm do cliente em etapas; texto de aceite não vira assinatura',async t=>{
 const f=await fixture(t,'Quero uma proposta',true,true),a=f.criar();await a.executar();assert.equal(f.envios(),1);assert.equal(f.documentosCriados(),0)
 await novaEntrada(f,'Razão social: Empresa fictícia LTDA\nCNPJ: 11222333000181',1);await a.executar();assert.equal(f.envios(),2);assert.equal(f.documentosCriados(),0)
 await novaEntrada(f,'Representante: Pessoa do cliente\nE-mail: cliente@example.com',2);await a.executar();await a.executar();assert.equal(f.documentosCriados(),1);assert.equal(f.envios(),3)
 await novaEntrada(f,'Aceito',3);await a.executar();assert.equal((await f.contratacao.visoes()).get(f.lead().id)?.estado,'aguardando-assinatura');assert.equal(f.envios(),3)
 await novaEntrada(f,'Obrigado',4);await a.executar();assert.equal(f.envios(),3)
 await novaEntrada(f,'Pode reenviar o link para assinar?',5);await a.executar();assert.equal(f.envios(),4);assert.equal(f.documentosCriados(),1)
})
test('tomada humana e pausa antes de emitir ou entregar proposta impedem efeitos',async t=>{
 const f=await fixture(t,'Quero uma proposta\n'+cadastroProposta,true,true),a=f.criar()
 const l=f.lead();l.eventos.push({tipo:'nota',origem:'manual',em:EM,rotulo:'Nota',fonte:'CRM',registroTexto:textoResponsavelConversa({v:2,id:'humano-proposta-fixture',conta:'prumo',canal:'whatsapp',conversa:CONVERSA,responsavel:'romulo',data:EM,motivo:'Assumir',humano:true,anterior:null},AGORA)})
 await a.executar();assert.equal(f.documentosCriados(),0);assert.equal(f.envios(),0)
 const g=await fixture(t,'Quero uma proposta\n'+cadastroProposta,true,true),b=g.criar();await b.executar();g.setConfere(async()=>{g.setPolitica({...politica(),modo:'pausado'})});await b.executar();assert.equal(g.envios(),0)
})
test('terceiro lote não reprocessa pedido anterior e não altera condição individual',async t=>{
 const f=await fixture(t,'Quero uma proposta com desconto\n'+cadastroProposta,true,true);await f.criar().executar();assert.equal(f.documentosCriados(),0);assert.equal((await f.criar().estados()).get(f.lead().id)?.acao,'humano')
 const g=await fixture(t,'Quero uma proposta\n'+cadastroProposta,true,true),v=await g.configProposta.visao();g.setPolitica({...politica(),proposta:{v:1,desde:new Date(AGORA).toISOString(),politicaHash:HASH_POLITICA_PROPOSTA_ENCONTRADO,modeloHash:v.modeloHash}});await g.criar().executar();assert.equal(g.documentosCriados(),0)
})

const ms=(textos:Array<[string,'entrada'|'saida']>):MensagemQualificacao[]=>textos.map(([texto,direcao],i)=>({id:'msg-'+i,em:EM,hash:sha(texto),direcao,texto}))
async function novaEntrada(f:Awaited<ReturnType<typeof fixture>>,texto:string,minuto:number){
 const agora=AGORA+minuto*60000,em=new Date(agora-1000).toISOString(),id='entrada-ficticia-'+minuto
 f.setAgora(agora);f.raw.push({id,em,direcao:'entrada',origem:'prumo',texto})
 const l=f.lead();l.conversa={desde:EM,mensagens:f.raw.length,ultima:{direcao:'entrada',em,trecho:texto},ultimaEntrada:em}
 await f.atendimento.receber({...f.evento,idOriginal:id,fonteId:id,ocorridoEm:em,recebidoEm:em,conteudoHash:sha(texto)})
}
test('conversa em vários turnos avança necessidade, decisão e oferta sem repetir pergunta',async t=>{
 const f=await fixture(t,'Quero um site para minha empresa',true),a=f.criar()
 for(const [i,campo,resposta] of [[0,'necessidade','Divulgar os serviços'],[1,'decisao','Eu e minha sócia'],[2,'material','Raio-X']] as const){
  await a.executar();await a.executar();assert.equal(f.envios(),i+1)
  f.raw.push({id:'saida-ficticia-turno-'+i,em:new Date(AGORA+i*60000).toISOString(),direcao:'saida',origem:'prumo',texto:PERGUNTAS_ENCONTRADO[campo]})
  await novaEntrada(f,resposta,i+1)
 }
 await a.executar();await a.executar();assert.equal(f.envios(),3);assert.equal((await f.materiais.listar())[0]?.tipo,'raio-x')
 const q=(await a.observacoes()).get(f.lead().id)!.qualificacao
 assert.equal(q.necessidade?.trecho,'Divulgar os serviços');assert.equal(q.decisao?.trecho,'Eu e minha sócia');assert.equal(q.intencao?.tipo,'avaliando')
})
test('pedido original continua após agradecimento; cancelamento posterior impede geração',async t=>{
 const f=await fixture(t,'Pode mandar uma prévia de site',true),a=f.criar();await a.executar();await a.executar()
 const [p]=await f.materiais.listar();await novaEntrada(f,'Obrigado',1);await a.executar();await a.executar()
 assert.equal((await f.materiais.listar()).length,1);assert.deepEqual(await a.autorizarMaterial(p.id),p)
 await novaEntrada(f,'Não precisa mandar mais',2);await a.executar();assert.equal(await a.autorizarMaterial(p.id),null);assert.equal(f.envios(),0)
})
test('permissão para material é específica e não confirma intenção nem compra',()=>{
  let q=extrairQualificacaoEncontrado(ms([['Posso falar com o responsável?','saida'],['Sim, pode','entrada']]),DESDE)
  assert.deepEqual(q,{materiais:[]})
  q=extrairQualificacaoEncontrado(ms([['Posso enviar a prévia de site?','saida'],['Pode mandar','entrada']]),DESDE)
  assert.equal(q.materiais[0]?.tipo,'demo');assert.equal(q.intencao,undefined);assert.equal(q.materiais[0].evidencia.trecho,'Pode mandar')
  q=extrairQualificacaoEncontrado(ms([[PERGUNTAS_ENCONTRADO.material,'saida'],['Pode mandar','entrada']]),DESDE)
  assert.deepEqual(q.materiais,[])
  q=extrairQualificacaoEncontrado(ms([[PERGUNTAS_ENCONTRADO.material,'saida'],['Raio-X','entrada']]),DESDE)
  assert.equal(q.materiais[0]?.tipo,'raio-x')
})
test('qualificação observa respostas na pergunta original, sem humano:true',()=>{
  const mensagens=ms([['Quero um site para minha empresa','entrada'],[PERGUNTAS_ENCONTRADO.necessidade,'saida'],['Divulgar meus serviços','entrada'],[PERGUNTAS_ENCONTRADO.decisao,'saida'],['Eu e minha sócia','entrada']])
  const q=extrairQualificacaoEncontrado(mensagens,DESDE)
  assert.equal(q.intencao?.tipo,'avaliando');assert.equal(q.necessidade?.trecho,'Divulgar meus serviços');assert.equal(q.decisao?.trecho,'Eu e minha sócia')
  assert.equal(JSON.stringify(q).includes('humano'),false)
  assert.deepEqual(extrairQualificacaoEncontrado(mensagens,'2026-10-25T14:01:00.000Z'),{materiais:[]})
})
test('recusa retira pedidos antigos; ausência de site não é recusa',()=>{
  assert.deepEqual(extrairQualificacaoEncontrado(ms([['Pode mandar o demo','entrada'],['Não quero mais','entrada']]),DESDE).materiais,[])
  assert.equal(extrairQualificacaoEncontrado(ms([['Não tenho site, quero ver uma prévia','entrada']]),DESDE).materiais[0]?.tipo,'demo')
  for(const s of ['Não precisa enviar demo','Talvez eu queira uma prévia','Gostaria de saber o preço do demo','Quem pediu para enviar uma demo?'])assert.deepEqual(extrairQualificacaoEncontrado(ms([[s,'entrada']]),DESDE).materiais,[],s)
})
test('GETs não criam cache, pedidos, geração ou envio; executor faz a pergunta seguinte',async t=>{
  const f=await fixture(t,'Quero um site para minha empresa',true),a=f.criar()
  assert.equal((await a.estados()).get(f.lead().id)?.acao,'time');await a.observacoes()
  await assert.rejects(()=>fs.stat(f.qualificador.pasta));assert.deepEqual(await f.materiais.listar(),[])
  await a.executar();assert.equal(f.envios(),0);await a.executar();assert.equal(f.envios(),1)
  assert.equal((await f.saidas.listar())[0].modelo,'qualificar-necessidade')
  assert.equal((await a.observacoes()).get(f.lead().id)?.qualificacao.intencao?.tipo,'avaliando')
})
test('capacidade nova tem corte próprio, versão exata e preserva FAQ antigo',async t=>{
  const f=await fixture(t,'Quero um site',true)
  f.setPolitica({...politica(),qualificacao:{v:1,desde:new Date(AGORA).toISOString(),politicaHash:HASH_QUALIFICACAO_ENCONTRADO}})
  await f.criar().executar();assert.equal(f.envios(),0);await assert.rejects(()=>fs.stat(f.qualificador.pasta))
  for(const q of [{v:1,desde:DESDE,politicaHash:sha('outra')},{v:1,desde:'2026-10-25T12:00:00.000Z',politicaHash:HASH_QUALIFICACAO_ENCONTRADO},{v:1,desde:DESDE,politicaHash:HASH_QUALIFICACAO_ENCONTRADO,extra:true}])assert.throws(()=>validarPoliticaEncontrado({...politica(),qualificacao:q},AGORA))
})
test('leitura de observações não percorre fontes de conversas anteriores ao corte novo',async t=>{
 const f=await fixture(t,'Quero um site',true)
 f.setPolitica({...politica(),qualificacao:{v:1,desde:new Date(AGORA).toISOString(),politicaHash:HASH_QUALIFICACAO_ENCONTRADO}})
 f.atendimento.contextoDaEntrada=async()=>{throw new Error('Histórico anterior não deve ser percorrido por GET')}
 assert.deepEqual(await f.criar().observacoes(),new Map())
})
async function pedidoPronto(t:Parameters<typeof fixture>[0]){
  const f=await fixture(t,'Pode mandar uma prévia de site',true),a=f.criar()
  await a.executar();await a.executar();await a.executar()
  const [p]=await f.materiais.listar();assert.ok(p)
  const pronto:ResultadoMaterialEncontrado={v:1,id:p.id,em:EM,estado:'pronto',url:'https://demo-empresa-ficticia.vercel.app',versao:'sha256:'+sha('pacote'),referencia:'lead:'+sha('ficticio').slice(0,24),qualidade:'homologacao'}
  await fs.writeFile(path.join(f.materiais.pasta,p.id+'.resultado.json'),JSON.stringify(pronto))
  f.setVerificar(async()=>pronto)
  return {f,a,p,pronto}
}
test('pedido de material evita questionário, é durável e exige autorização técnica atual',async t=>{
  const f=await fixture(t,'Pode mandar uma prévia de site',true),a=f.criar()
  await a.executar();await a.executar();await a.executar();assert.equal(f.envios(),0)
  const [p]=await f.materiais.listar();assert.equal((await f.materiais.listar()).length,1);assert.deepEqual(await a.autorizarMaterial(p.id),p)
  assert.equal((await a.estados()).get(f.lead().id)?.acao,'time')
  f.setPolitica({...politica(),modo:'pausado'});assert.equal(await a.autorizarMaterial(p.id),null)
})
test('material pronto só é enviado após conferência independente; não repete nem pergunta de novo',async t=>{
  const {f,a,p}=await pedidoPronto(t);await a.executar();await f.criar().executar()
  assert.equal(f.envios(),1);const [s]=await f.saidas.listar();assert.equal(s.modelo,'material-demo');assert.equal(s.entradaChave,chaveEventoAtendimento(f.evento));assert.notEqual(s.chave,p.entradaChave)
  assert.equal((await a.estados()).get(f.lead().id)?.acao,'time')
})
test('ativar proposta não altera a identidade dos materiais pendentes nem repete o que já foi entregue',async t=>{
 const {f,a,p,pronto}=await pedidoPronto(t)
 await fs.unlink(path.join(f.materiais.pasta,p.id+'.resultado.json'))
 f.setPolitica({...politica(),qualificacao:{v:1,desde:DESDE,politicaHash:HASH_QUALIFICACAO_ENCONTRADO},proposta:{v:1,desde:new Date(AGORA).toISOString(),politicaHash:HASH_POLITICA_PROPOSTA_ENCONTRADO,modeloHash:'c'.repeat(64)}})
 assert.equal((await a.autorizarMaterial(p.id))?.id,p.id)
 await fs.writeFile(path.join(f.materiais.pasta,p.id+'.resultado.json'),JSON.stringify(pronto))
 await a.executar();assert.equal(f.envios(),1)
 await novaEntrada(f,'Obrigado',1);await a.executar();await a.executar()
 assert.equal(f.envios(),1);assert.equal((await f.materiais.listar()).length,1)
})
test('qualidade ou bytes sem confirmação não reservam nem enviam; transiente permanece com o time',async t=>{
  const {f,a}=await pedidoPronto(t);f.setVerificar(async()=>{throw new Error('divergência')});await a.executar()
  assert.equal(f.envios(),0);assert.deepEqual(await f.saidas.listar(),[]);assert.equal((await a.estados()).get(f.lead().id)?.acao,'time')
  f.setAgora(AGORA+31*60000);assert.equal((await a.estados()).get(f.lead().id)?.acao,'humano')
})
test('troca de versão entre as duas conferências cancela, sem inventar envio',async t=>{
  const {f,a,pronto}=await pedidoPronto(t);let n=0;f.setVerificar(async()=>++n===1?pronto:{...pronto,versao:'sha256:'+sha('outro pacote')})
  await a.executar();assert.equal(f.envios(),0);assert.equal((await f.saidas.listar())[0].estado,'cancelada')
})
test('cache pronto não pode elevar prévia a profissional nem trocar sua URL',async t=>{
 const {f,a,pronto,p}=await pedidoPronto(t)
 for(const alterado of [{...pronto,qualidade:'profissional'},{...pronto,url:'https://outro.vercel.app/https://demo-empresa-ficticia.vercel.app'}]){
  await fs.writeFile(path.join(f.materiais.pasta,p.id+'.resultado.json'),JSON.stringify(alterado));await a.executar()
  assert.equal(f.envios(),0);assert.deepEqual(await f.saidas.listar(),[])
 }
})
test('nova entrada durante conferência final impede entrega e preserva reserva',async t=>{
  const {f,a,pronto}=await pedidoPronto(t);let n=0;f.setVerificar(async()=>{if(++n===2)f.raw.push({id:'nova',em:'2026-10-25T13:59:30.000Z',direcao:'entrada',texto:'Não quero mais'});return pronto})
  await a.executar();assert.equal(f.envios(),0);assert.equal((await f.saidas.listar())[0].estado,'cancelada')
})
test('tomada humana impede preparação; prova ausente não alimenta qualificação',async t=>{
  const f=await fixture(t,'Quero um site',true);f.raw.unshift({id:'sem-prova',em:'2026-10-25T13:58:00.000Z',direcao:'entrada',texto:'Eu aprovo e quero divulgar serviços',provaAusente:true})
  await f.criar().executar();assert.equal((await f.criar().observacoes()).get(f.lead().id)?.qualificacao.necessidade,undefined)
  const l=f.lead();l.eventos.push({tipo:'nota',origem:'manual',em:EM,rotulo:'Nota',fonte:'CRM',registroTexto:textoResponsavelConversa({v:2,id:'humano-ficticio-001',conta:'prumo',canal:'whatsapp',conversa:CONVERSA,responsavel:'romulo',data:EM,motivo:'Assumir',humano:true,anterior:null},AGORA)})
  await f.criar().executar();assert.equal(f.envios(),0)
})
test('dois materiais solicitados aguardam os dois pacotes e saem em uma única resposta',async t=>{
  const f=await fixture(t,'Quero ver uma prévia e o Raio-X',true),a=f.criar()
  await a.executar();await a.executar();const ps=await f.materiais.listar();assert.equal(ps.length,2)
  const resultados=new Map(ps.map(p=>[p.id,{v:1,id:p.id,em:EM,estado:'pronto',url:p.tipo==='demo'?'https://demo-empresa-ficticia.vercel.app':'https://raio-x-prumo.vercel.app/empresa-ficticia',versao:'sha256:'+sha(p.tipo),referencia:'lead:'+sha('ficticio').slice(0,24),qualidade:'homologacao'} satisfies ResultadoMaterialEncontrado]))
  await fs.writeFile(path.join(f.materiais.pasta,ps[0].id+'.resultado.json'),JSON.stringify(resultados.get(ps[0].id)))
  await a.executar();assert.equal(f.envios(),0);assert.ok(await a.autorizarMaterial(ps[1].id))
  await fs.writeFile(path.join(f.materiais.pasta,ps[1].id+'.resultado.json'),JSON.stringify(resultados.get(ps[1].id)))
  f.setVerificar(async id=>resultados.get(id));await a.executar();await a.executar()
  assert.equal(f.envios(),1);assert.equal((await f.saidas.listar())[0].materiais?.length,2)
})
test('entrada real verificada permite uma resposta; reprocessamento e dois executores não duplicam',async t=>{
  const f=await fixture(t),a=f.criar(),b=f.criar();await Promise.all([a.executar(),b.executar()]);await a.executar()
  assert.equal(f.envios(),1);const [s]=await f.saidas.listar();assert.equal(s.estado,'enviada');assert.equal(s.recibo,'saida-ficticia-001')
  assert.equal((await a.estados()).get(f.lead().id)?.acao,'time')
  assert.equal((await fs.readFile(path.join(f.saidas.pasta,s.chave+'.json'),'utf8')).includes('Quanto custa'),false)
})
test('recibo sem texto no histórico não vira mensagem nem interrompe a leitura das condições',async t=>{
  const f=await fixture(t);f.raw.unshift({tipo:'recibo',em:'2026-10-25T13:58:00.000Z',status:'lido'})
  await f.criar().executar();assert.equal(f.envios(),1)
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
test('saída posterior ainda sem prova de conta também impede outra resposta enquanto o CRM atrasa',async t=>{
  const f=await fixture(t);f.setConfere(async()=>{f.raw.push({id:'saida-sem-prova',direcao:'saida',origem:'prumo',em:'2026-10-25T13:59:30.000Z',texto:'Já respondi',provaAusente:true})})
  await f.criar().executar();assert.equal(f.envios(),0);assert.equal((await f.saidas.listar()).length,0)
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
test('dois recuperadores de trava abandonada não removem a nova reserva um do outro',async t=>{
  const f=await fixture(t),locks=path.join(f.dir,'locks');await fs.mkdir(locks)
  const child=spawn(process.execPath,['-e','process.exit(0)']);await new Promise<void>((r,j)=>{child.once('error',j);child.once('exit',()=>r())})
  assert.ok(child.pid)
  await fs.writeFile(path.join(locks,sha(CONVERSA)+'.lock'),JSON.stringify({pid:child.pid,token:'reserva-abandonada'}))
  let simultaneos=0,maximo=0
  const executar=()=>comGuardaConversa(locks,CONVERSA,async()=>{simultaneos++;maximo=Math.max(maximo,simultaneos);await new Promise(r=>setTimeout(r,15));simultaneos--})
  await Promise.all([executar(),executar(),executar()]);assert.equal(maximo,1)
})
