import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {ConfiguracaoPropostaEncontrado,type ClienteAutentique} from './encontrado-proposta-config.ts'
import {ContratacaoEncontrado,lerSolicitacaoPropostaEncontrado,nomeDocumentoEncontrado,shaProposta,type ContextoPropostaEncontrado} from './encontrado-contratacao.ts'
import {CONDICOES_SUGERIDAS_ENCONTRADO,cnpjEncontradoValido,htmlPropostaEncontrado,validarParteEncontrado,type ParteEncontrado} from '../src/operations/encontrado-proposta.ts'
import {ErroAutentique,type DocumentoAutentique} from './autentique.ts'
import type {MensagemQualificacao} from './encontrado-qualificacao.ts'

const AGORA=Date.parse('2026-10-25T14:00:00.000Z'),DESDE='2026-10-25T13:00:00.000Z'
export const PRUMO_FICTICIA:ParteEncontrado={razaoSocial:'Prestadora fictícia LTDA',cnpj:'12ABC34501DE35',representante:'Pessoa da prestadora',email:'prestadora@example.com'}
export const CLIENTE_FICTICIO:ParteEncontrado={razaoSocial:'Empresa fictícia LTDA',cnpj:'11222333000181',representante:'Pessoa do cliente',email:'cliente@example.com'}
export const CONTA_FICTICIA={id:'conta-ficticia-001',nome:'Operador fictício',email:'operador@example.com',gratuita:true,organizacao:{id:'org-fixture',nome:'Prumo fictícia',cnpj:PRUMO_FICTICIA.cnpj}}
const mensagem=(texto:string,i=0):MensagemQualificacao=>({id:'msg-ficticia-'+i,em:new Date(AGORA-60000+i*1000).toISOString(),hash:shaProposta(texto),direcao:'entrada',texto})
const dadosCliente=()=>`Razão social: ${CLIENTE_FICTICIO.razaoSocial}\nCNPJ: ${CLIENTE_FICTICIO.cnpj}\nRepresentante: ${CLIENTE_FICTICIO.representante}\nE-mail: ${CLIENTE_FICTICIO.email}`
export function documentoFicticio(nome:string,cliente=CLIENTE_FICTICIO):DocumentoAutentique{return {id:'documento-ficticio-001',name:nome,created_at:new Date(AGORA).toISOString(),sandbox:false,deleted_at:null,files:{original:'https://storage.googleapis.com/ficticio/original.pdf',signed:null},signatures:[{public_id:'assinatura-ficticia-001',name:cliente.representante,email:cliente.email,action:{name:'SIGN'},link:{short_link:'https://assina.ae/linkficticio001'},signed:null,rejected:null,signed_unapproved:null,biometric_rejected:null}]}}
async function fixture(t:{after:(f:()=>Promise<unknown>)=>void}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'encontrado-proposta-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
 let agora=AGORA,criacoes=0,docs:DocumentoAutentique[]=[],teste:DocumentoAutentique|null=null,falhar=false,pdf=Buffer.from('%PDF-1.4 fixture sem documento real'),conta={...CONTA_FICTICIA}
 const api:ClienteAutentique={conta:async()=>conta,criar:async(nome,_html,cliente,_validade,sandbox)=>{const d=documentoFicticio(nome,cliente);d.created_at=new Date(agora).toISOString();if(sandbox){d.id='sandbox-ficticio-001';d.sandbox=true;teste=d;return d}criacoes++;d.id='documento-ficticio-'+String(criacoes).padStart(3,'0');docs.push(d);if(falhar)throw new ErroAutentique('indisponivel');return d},documento:async id=>{const d=teste?.id===id?teste:docs.find(d=>d.id===id);if(!d)throw new Error('ausente');return d},localizar:async(nome,sandbox)=>sandbox?teste:docs.find(d=>d.name===nome)??null,original:async()=>({hash:shaProposta(pdf),bytes:pdf})}
 const config=new ConfiguracaoPropostaEncontrado(dir,()=>api,()=>agora),servico=new ContratacaoEncontrado(path.join(dir,'propostas'),config,()=>agora)
 await config.salvar({prumo:PRUMO_FICTICIA,condicoes:CONDICOES_SUGERIDAS_ENCONTRADO,token:'token-ficticio-sem-rede'})
 const modeloHash=config.hashModelo(PRUMO_FICTICIA,CONDICOES_SUGERIDAS_ENCONTRADO)
 const contexto:ContextoPropostaEncontrado={leadId:'site:fixture',conversa:'2799991234',entradaChave:'a'.repeat(64),desde:DESDE,modeloHash,mensagens:[mensagem('Quero uma proposta do Encontrado'),mensagem(dadosCliente(),1)]}
 const aprovar=async()=>{await config.homologar();return config.aprovar(modeloHash,'operador-ficticio')}
 const autorizar=async(_id:string,reservar?:()=>Promise<void>)=>{const c=await config.aprovada(modeloHash);if(c&&reservar)await reservar();return c}
 return {dir,api,config,servico,contexto,modeloHash,aprovar,autorizar,criacoes:()=>criacoes,docs:()=>docs,setFalhar:()=>{falhar=true},setPdf:(v:Buffer)=>{pdf=v},setAgora:(v:number)=>{agora=v},setConta:(v:typeof conta)=>{conta=v}}
}
test('CNPJ numérico e alfanumérico seguem os DVs; formato não comprova cadastro oficial',()=>{
 assert.ok(cnpjEncontradoValido('11.222.333/0001-81'));assert.ok(cnpjEncontradoValido('12.ABC.345/01DE-35'));assert.ok(cnpjEncontradoValido('00.000.000/E08G-12'))
 for(const v of ['11111111111111','11222333000182','12ABC34501DE36','12ABC34501DE3A','../../empresa'])assert.equal(cnpjEncontradoValido(v),false,v)
})
test('cadastro só é observado após pedido explícito e corte, com cada referência original',()=>{
 assert.equal(lerSolicitacaoPropostaEncontrado([mensagem('Pode mandar'),mensagem(dadosCliente(),1)],DESDE).pedido,null)
 const ms=[mensagem('Quero uma proposta'),mensagem(dadosCliente(),1)],r=lerSolicitacaoPropostaEncontrado(ms,DESDE)
 assert.equal(r.cadastro.email?.valor,CLIENTE_FICTICIO.email);assert.equal(r.cadastro.cnpj?.evidencia.id,ms[1].id);assert.equal(r.pedido?.id,ms[0].id)
 assert.equal(lerSolicitacaoPropostaEncontrado(ms,'2026-10-25T15:00:00.000Z').pedido,null)
 assert.equal(lerSolicitacaoPropostaEncontrado([...ms,mensagem('Quero assinar',2)],DESDE).pedido?.id,ms[0].id)
})
test('correção inválida e duplicidade de um campo não usam silenciosamente valor anterior',()=>{
 const ms=[mensagem('Quero uma proposta'),mensagem(dadosCliente(),1)]
 assert.equal(lerSolicitacaoPropostaEncontrado([...ms,mensagem('CNPJ: 11222333000182',2)],DESDE).cadastro.cnpj,undefined)
 assert.equal(lerSolicitacaoPropostaEncontrado([...ms,mensagem('E-mail: um@example.com\nE-mail: outro@example.com',2)],DESDE).cadastro.email,undefined)
 assert.equal(lerSolicitacaoPropostaEncontrado([...ms,mensagem('Não quero mais',2)],DESDE).pedido,null)
})
test('configuração sem aprovação não emite documento; GET não consulta provedor nem mostra token',async t=>{
 const f=await fixture(t);assert.equal(await f.config.aprovada(),null)
 const v=await f.config.visao();assert.equal(JSON.stringify(v).includes('token-ficticio'),false)
 assert.equal((await f.servico.avaliar(f.contexto)).acao,'humano');await f.servico.executar(f.autorizar);assert.equal(f.criacoes(),0)
 assert.equal((await f.servico.listar()).length,0)
})
test('modelo aprovado vincula as condições e o cadastro; alteração invalida aprovação',async t=>{
 const f=await fixture(t);await f.aprovar();assert.ok(await f.config.aprovada(f.modeloHash))
 await f.config.salvar({prumo:PRUMO_FICTICIA,condicoes:{...CONDICOES_SUGERIDAS_ENCONTRADO,prazoDiasUteis:8}})
 assert.equal(await f.config.aprovada(f.modeloHash),null);await assert.rejects(()=>f.aprovar())
})
test('conta paga não recebe autorização de criação ou consultas de documentos',async t=>{
 const f=await fixture(t);f.setConta({...CONTA_FICTICIA,gratuita:false});await assert.rejects(()=>f.aprovar());assert.equal(await f.config.aprovada(),null)
})
test('dados faltantes são perguntados ao cliente sem forjar fatos humanos',async t=>{
 const f=await fixture(t);await f.aprovar()
 const p=await f.servico.avaliar({...f.contexto,mensagens:[mensagem('Quero uma proposta')]})
 assert.equal(p.acao,'responder');if(p.acao==='responder'){assert.match(p.texto,/CNPJ:/);assert.match(p.texto,/Autentique/);assert.match(p.modelo,/cadastro/)}
 assert.equal(f.criacoes(),0)
})
test('proposta é imutável, escapa HTML e leva preço padrão e gatilho corretos',async t=>{
 const f=await fixture(t);await f.aprovar();await f.servico.preparar(f.contexto);await f.servico.preparar(f.contexto)
 const ps=await f.servico.listar();assert.equal(ps.length,1);const html=htmlPropostaEncontrado(ps[0]);assert.equal(shaProposta(html),ps[0].htmlHash)
 assert.match(html,/R\$ 690/);assert.match(html,/R\$ 39\/mês/);assert.match(html,/assinatura deste documento, isoladamente, não libera cobrança/i)
 assert.equal(html.includes('<script'),false);assert.equal(html.includes('fonts.googleapis'),false)
 const escapado=htmlPropostaEncontrado({...ps[0],cliente:{...CLIENTE_FICTICIO,razaoSocial:'Empresa & Companhia "Especial"'}})
 assert.match(escapado,/Empresa &amp; Companhia &quot;Especial&quot;/)
 assert.throws(()=>validarParteEncontrado({...CLIENTE_FICTICIO,representante:'<script>alert(1)</script>'}))
})
test('dois executores compartilham reserva e só criam um documento',async t=>{
 const f=await fixture(t);await f.aprovar();await f.servico.preparar(f.contexto)
 const outro=new ContratacaoEncontrado(f.servico.pasta,f.config,()=>AGORA)
 await Promise.all([f.servico.executar(f.autorizar),outro.executar(f.autorizar)]);assert.equal(f.criacoes(),1)
 const p=await f.servico.avaliar(f.contexto);assert.equal(p.acao,'responder');if(p.acao==='responder')assert.match(p.texto,/https:\/\/assina.ae\//)
 assert.equal((await f.servico.visoes()).get(f.contexto.leadId)?.estado,'aguardando-assinatura')
})
test('revogação após a saúde e antes da reserva impede a criação',async t=>{
 const f=await fixture(t);await f.aprovar();await f.servico.preparar(f.contexto);let n=0
 await f.servico.executar(async(_id,reservar)=>{if(++n>=2)return null;return f.autorizar(_id,reservar)})
 assert.equal(f.criacoes(),0)
})
test('timeout de criação nunca recria; recuperação sem recibo pede conferir o original exato',async t=>{
 const f=await fixture(t);await f.aprovar();await f.servico.preparar(f.contexto);f.setFalhar();await f.servico.executar(f.autorizar)
 assert.equal(f.criacoes(),1);f.setAgora(AGORA+6*60000);await f.servico.executar(f.autorizar);assert.equal(f.criacoes(),1)
 const v=(await f.servico.visoes()).get(f.contexto.leadId)!;assert.equal(v.estado,'conferencia');assert.equal(v.recuperacaoPendente,true)
 await assert.rejects(()=>f.servico.confirmarRecuperacao(v.referencia,'0'.repeat(64)))
 await f.servico.confirmarRecuperacao(v.referencia,v.originalHash!);assert.equal((await f.servico.visoes()).get(f.contexto.leadId)?.estado,'aguardando-assinatura')
})
test('documento criado e link aberto não são aceite; assinatura comprovada também não é pagamento',async t=>{
 const f=await fixture(t);await f.aprovar();await f.servico.preparar(f.contexto);await f.servico.executar(f.autorizar)
 const d=f.docs()[0];assert.equal((await f.servico.visoes()).get(f.contexto.leadId)?.aceiteEm,undefined)
 f.setAgora(AGORA+11*60000);d.signatures[0].signed={created_at:new Date(AGORA+10*60000).toISOString()};d.files!.signed='https://painel.autentique.com.br/documentos/documento-ficticio-001/assinado.pdf'
 await f.servico.executar(f.autorizar);const v=(await f.servico.visoes()).get(f.contexto.leadId)!;assert.equal(v.estado,'assinada');assert.ok(v.aceiteEm);assert.match(v.motivo,/site visto no ar/)
 assert.equal(JSON.stringify(v).includes('humano'),false);assert.equal(JSON.stringify(v).includes('pagamento'),false)
})
test('mudança dos bytes originais, do signatário ou do documento nunca confirma aceite',async t=>{
 const f=await fixture(t);await f.aprovar();await f.servico.preparar(f.contexto);await f.servico.executar(f.autorizar)
 const [p]=await f.servico.listar();assert.equal(await f.servico.conferirEntrega(p.id),true)
 f.setPdf(Buffer.from('%PDF-1.4 outra versão'));assert.equal(await f.servico.conferirEntrega(p.id),false)
 f.setAgora(AGORA+11*60000);f.docs()[0].signatures[0].signed={created_at:new Date(AGORA+10*60000).toISOString()};f.docs()[0].files!.signed='https://painel.autentique.com.br/ficticio/assinado.pdf'
 await f.servico.executar(f.autorizar);assert.equal((await f.servico.visoes()).get(f.contexto.leadId)?.estado,'conferencia')
})
test('biometria pendente ou documento sandbox não vira assinatura real',async t=>{
 const f=await fixture(t);await f.aprovar();await f.servico.preparar(f.contexto);await f.servico.executar(f.autorizar)
 const d=f.docs()[0];f.setAgora(AGORA+11*60000);d.signatures[0].signed={created_at:new Date(AGORA+10*60000).toISOString()};d.signatures[0].signed_unapproved={created_at:new Date(AGORA+9*60000).toISOString()};d.files!.signed='https://painel.autentique.com.br/ficticio/assinado.pdf'
 await f.servico.executar(f.autorizar);assert.notEqual((await f.servico.visoes()).get(f.contexto.leadId)?.estado,'assinada')
 f.setAgora(AGORA+22*60000);d.sandbox=true;await f.servico.executar(f.autorizar);assert.equal((await f.servico.visoes()).get(f.contexto.leadId)?.estado,'conferencia')
})
test('cliente que recusa a versão interrompe o fluxo; dados novos após emissão pedem decisão',async t=>{
 const f=await fixture(t);await f.aprovar();await f.servico.preparar(f.contexto);await f.servico.executar(f.autorizar)
 const alterado=await f.servico.avaliar({...f.contexto,mensagens:[...f.contexto.mensagens,mensagem('E-mail: outro@example.com',2)]});assert.equal(alterado.acao,'humano')
 f.setAgora(AGORA+11*60000);f.docs()[0].signatures[0].rejected={created_at:new Date(AGORA+10*60000).toISOString()};await f.servico.executar(f.autorizar)
 assert.equal((await f.servico.visoes()).get(f.contexto.leadId)?.estado,'recusada')
})
test('limite gratuito de dez emissões reserva a cota antes do efeito e não cria a décima primeira',async t=>{
 const f=await fixture(t);await f.aprovar()
 for(let i=0;i<11;i++)await f.servico.preparar({...f.contexto,leadId:'site:fixture-'+i,conversa:String(2799991200+i)})
 for(let i=0;i<70;i++){f.setAgora(AGORA+i*120000);await f.servico.executar(f.autorizar)}
 assert.equal(f.criacoes(),10)
 const visoes=await f.servico.visoes();assert.equal([...visoes.values()].filter(v=>v.estado==='conferencia').length,1);assert.ok([...visoes.values()].some(v=>v.motivo.includes('Franquia gratuita')))
})
test('conversão do HTML e preparação do link podem terminar depois da resposta da criação',async t=>{
 const f=await fixture(t);await f.aprovar();await f.servico.preparar(f.contexto)
 const original=f.api.original;let pronto=false;f.api.original=async d=>{if(!pronto)throw new ErroAutentique('indisponivel');return original(d)}
 await f.servico.executar(f.autorizar);assert.equal(f.criacoes(),1);assert.notEqual((await f.servico.visoes()).get(f.contexto.leadId)?.estado,'aguardando-assinatura')
 pronto=true;f.setAgora(AGORA+6*60000);await f.servico.executar(f.autorizar);assert.equal(f.criacoes(),1);assert.equal((await f.servico.visoes()).get(f.contexto.leadId)?.estado,'aguardando-assinatura')
})
