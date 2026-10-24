import assert from 'node:assert/strict'
import {test} from 'node:test'
import express from 'express'
import type {AddressInfo} from 'node:net'
import {readFile} from 'node:fs/promises'
import type {CrmLead,CrmVisao} from '../src/operations/types.ts'
import {fichaDaFonteComercial,montarLeituraComercial,projetarLeituraComercial,referenciaLeituraComercial,ROTA_LEITURA_COMERCIAL,type FonteLeituraComercial} from './leitura-comercial.ts'
import {PREFIXO_QUALIFICACAO_COMERCIAL,qualificacaoComercialVazia} from '../src/operations/qualificacao-comercial.ts'
import {PREFIXO_CICLO} from '../src/operations/ciclo-comercial.ts'
import {textoResponsavelConversa} from '../src/operations/responsavel-conversa.ts'
import {notaDoAprendizado} from '../src/operations/aprendizado-comercial.ts'
import {guardaDeIdentidade} from './acesso.ts'
import {LeiturasDaMensagem} from './assistente-ferramentas.ts'
const AGORA=Date.parse('2026-10-24T15:00:00Z'),EM='2026-10-24T14:00:00Z'
const lead=(extra:Partial<CrmLead>={}):CrmLead=>({id:'site:teste',chave:'teste',produto:'site',empresa:'Empresa teste',nicho:'serviços',cidade:'Vitória',etapa:'contato',sinal:'em-conversa',subEtapa:'Respondeu',marcos:{},eventos:[],notas:0,links:{whatsapp:'https://wa.me/5511999991234'},resposta:{tipo:'neutra',trecho:'Texto privado da conversa'},conversa:{mensagens:1,ultimaEntrada:EM,ultima:{direcao:'entrada',em:EM,trecho:'Texto privado da conversa'}},...extra} as CrmLead)
const visao=(leads:CrmLead[],extra:Partial<FonteLeituraComercial>={}):FonteLeituraComercial=>({estado:'ok',geradoEm:new Date(AGORA-60000).toISOString(),leads,hoje:[],fontes:[],...extra})
const nota=(texto:string,em=EM):CrmLead['eventos'][number]=>({tipo:'nota',origem:'manual',em,rotulo:'Nota',fonte:'CRM fixture',texto})
const deps={bloqueioConversa:async()=>null,origemCentral:'https://central.test.ts.net:8443'}
const projetar=(l:CrmLead)=>projetarLeituraComercial(l,visao([l]),deps,AGORA)
async function servidor(v:FonteLeituraComercial,opts:{falhar?:boolean;guardar?:boolean}={}){
 const app=express();let leituras=0
 if(opts.guardar)app.use(guardaDeIdentidade(new Set(['operador@example.test'])))
 montarLeituraComercial(app,{...deps,agora:()=>AGORA,visao:async()=>{leituras++;if(opts.falhar)throw Error('segredo interno');return v}})
 const srv=app.listen(0,'127.0.0.1');await new Promise<void>(r=>srv.once('listening',r));const url=`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ROTA_LEITURA_COMERCIAL}`
 return {get:(query='',init?:RequestInit)=>fetch(url+query,init),leituras:()=>leituras,fechar:()=>new Promise<void>(r=>srv.close(()=>r()))}
}
test('Central fornece ficha confiável mesmo sem acoes ou com webhook antigo, codificando ID exato',()=>{
 for(const links of [{whatsapp:''},{whatsapp:'',acoes:'https://legacy.test/webhook/lead?id=antigo'}])assert.equal(fichaDaFonteComercial(lead({id:'site:a&b /ç',links}),deps.origemCentral),'https://central.test.ts.net:8443/crm?lead=site%3Aa%26b%20%2F%C3%A7')
 for(const origem of [undefined,'http://central.test.ts.net:8443','https://central.test.ts.net','https://central.test.ts.net:9119','https://evil.test:8443','https://central.test.ts.net:8443/caminho','https://u:p@central.test.ts.net:8443','https://central.test.ts.net:8443/?x=y'])assert.equal(fichaDaFonteComercial(lead(),origem),null)
})
test('resumo não publica conversa, notas, contato, links WhatsApp ou condições financeiras',async()=>{
 const l=lead({empresa:'Empresa (11) 99999-1234 contato@example.test',eventos:[nota('nota privada CPF 123.456.789-00'),nota(PREFIXO_CICLO+JSON.stringify({v:1,id:'proposta-01',tipo:'proposta',data:'2026-10-23',humano:true,referencia:'recibo-sensivel',ofertaId:'encontrado',versao:1,valor:987654,mensalidade:123456,condicoes:'condicao-secreta'}))]})
 const antes=JSON.stringify(l),p=await projetar(l),texto=JSON.stringify(p)
 for(const segredo of ['99999-1234','contato@example.test','nota privada','123.456.789-00','Texto privado','recibo-sensivel','987654','123456','condicao-secreta','wa.me','5511999991234'])assert.ok(!texto.includes(segredo),segredo)
 assert.equal(p.ciclo.estado,'rascunho');assert.ok(p.bloqueios.includes('ciclo-comercial'));assert.equal(p.contatoAutorizado,false);assert.equal(JSON.stringify(l),antes)
})
test('nota nova inválida governa em vez de recuperar qualificação anterior ou SPICED',async()=>{
 const q={...qualificacaoComercialVazia(Date.parse(EM)),id:'q-anterior',fonte:'Fonte privada',evidencia:'Evidência privada',necessidade:'necessidade privada',adequacao:{estado:'confirmada' as const,oferta:'encontrado' as const,motivo:'adequado'},intencao:'avaliar' as const,decisao:'Sócios decidem juntos',proximoPasso:{aceito:true,descricao:'Avaliar escopo'}}
 const l=lead({qualificacaoComercial:q,eventos:[nota(PREFIXO_QUALIFICACAO_COMERCIAL+JSON.stringify(q),'2026-10-23T14:00:00Z'),nota(PREFIXO_QUALIFICACAO_COMERCIAL+'inválida')]})
 const p=await projetar(l);assert.equal(p.autoridade,'qualificacao-nova');assert.equal(p.qualificacao.estado,'invalida');assert.equal(p.qualificacao.confirmacaoHumana,false);assert.ok(p.bloqueios.includes('qualificacao-invalida'));assert.ok(!JSON.stringify(p).includes('Sócios'))
})
test('qualificação suficiente admite decisão com sócios sem texto/fonte privados e negativa bloqueia',async()=>{
 const q={...qualificacaoComercialVazia(Date.parse(EM)),id:'q-valida',fonte:'Fonte privada',evidencia:'Evidência privada',necessidade:'Captar pedidos',adequacao:{estado:'confirmada' as const,oferta:'encontrado' as const,motivo:'Faz sentido'},intencao:'avaliar' as const,decisao:'Dois sócios decidem juntos',proximoPasso:{aceito:true,descricao:'Avaliar escopo'}}
 const p=await projetar(lead({qualificacaoComercial:q}));assert.equal(p.qualificacao.estado,'suficiente');assert.equal(p.qualificacao.camposConfirmados.decisao,true);assert.equal(p.qualificacao.lacunas.length,0);assert.equal(p.contatoAutorizado,false)
 const neg=await projetar(lead({qualificacaoComercial:{...q,intencao:'sem-interesse'}}));assert.ok(neg.bloqueios.includes('qualificacao-negativa'));assert.equal(neg.proximaAcao,'conferir-com-romulo')
})
test('responsável humano é preservado sem identidade de conversa ou motivo particular na saída',async()=>{
 const n=textoResponsavelConversa({v:2,id:'owner-001',conta:'prumo',canal:'whatsapp',conversa:'1199991234',responsavel:'romulo',data:EM,motivo:'negociacao-privada',humano:true,anterior:null},AGORA)
 const p=await projetar(lead({eventos:[nota(n)]}));assert.deepEqual(p.responsavel,{estado:'definido',quem:'romulo'});assert.ok(p.bloqueios.includes('responsabilidade-humana'));assert.ok(!JSON.stringify(p).includes('1199991234'));assert.ok(!JSON.stringify(p).includes('negociacao-privada'))
})
test('pausa, espera e recusa não viram recomendação de retomada',async()=>{
 const pausado=lead({eventos:[nota(notaDoAprendizado({fato:'Aguardando',hipotese:'Sem nova entrada',teste:'Esperar',resultado:'em-teste',pausarAteResposta:true}))]})
 assert.equal((await projetar(pausado)).proximaAcao,'aguardar')
 assert.equal((await projetar(lead({proximoPasso:{texto:'Esperar os sócios',data:'2099-01-01',registradoEm:EM}}))).proximaAcao,'aguardar')
 for(const l of [lead({resposta:{tipo:'exclusao',trecho:'Dado privado'}}),lead({etapa:'ganho'})])assert.equal((await projetar(l)).proximaAcao,'preservar-desfecho')
})
test('handoff e bloqueio de identidade prevalecem sem texto/rascunho; falha na conferência fecha',async()=>{
 const l=lead({atendimentoComercial:{id:'pendencia-1',tipo:'handoff',titulo:'Título privado',motivo:'Motivo privado',alvo:'operador',texto:'Rascunho privado',estado:'pendente',contextoHash:'a'.repeat(64)}})
 const p=await projetarLeituraComercial(l,visao([l]),{bloqueioConversa:async()=>{throw Error('segredo')}},AGORA)
 assert.ok(p.bloqueios.includes('identidade-ou-registro-pendente'));assert.ok(p.bloqueios.includes('atendimento-interno'));assert.equal(p.atendimento.tipo,'handoff');assert.equal(p.proximaAcao,'conferir-com-romulo');assert.ok(!JSON.stringify(p).includes('privado'))
 const outro=await projetar({...l,atendimentoComercial:{...l.atendimentoComercial!,contextoHash:'b'.repeat(64)}});assert.notEqual(p.revisaoContexto,outro.revisaoContexto)
})
test('GET apresenta ambiguidade, seleção por referência e lista limitada, sem escolher comprador',async()=>{
 const leads=Array.from({length:22},(_,i)=>lead({id:`site:${i}`,empresa:`Ótima empresa ${i}`})),api=await servidor(visao(leads))
 try{const r=await api.get('?nome=otima');assert.equal(r.headers.get('cache-control'),'no-store');const p=await r.json();assert.equal(p.resultado,'ambiguo');assert.equal(p.total,22);assert.equal(p.oportunidades.length,20);assert.equal(p.truncado,true)
 const unico=await(await api.get('?referencia='+referenciaLeituraComercial(leads[21]!))).json();assert.equal(unico.resultado,'individual');assert.equal(unico.oportunidades[0].empresa,'Ótima empresa 21');assert.equal(unico.contatoAutorizado,false)
 assert.equal((await(await api.get('?nome=inexistente')).json()).resultado,'nao-encontrado')
 }finally{await api.fechar()}
})
test('consulta rejeita parâmetros arbitrários e não possui POST',async()=>{
 const api=await servidor(visao([lead()]));try{for(const q of ['?url=https://evil.test','?nome=a','?referencia=site:teste','?nome=teste&referencia='+ 'a'.repeat(64),'?nome=a&nome=b'])assert.equal((await api.get(q)).status,400)
 assert.equal(api.leituras(),0);assert.equal((await api.get('',{method:'POST'})).status,404)
 }finally{await api.fechar()}
})
test('retrato ausente, velho, futuro, falha posterior ou fonte parcial não permite estado comercial',async()=>{
 for(const extra of [{estado:'sem-retrato' as const},{geradoEm:new Date(AGORA-900001).toISOString()},{geradoEm:new Date(AGORA+1).toISOString()},{geradoEm:undefined},{ultimaFalha:{em:new Date(AGORA).toISOString(),erro:'segredo'}},{fontes:[{id:'registros' as const,nome:'CRM',linhas:1,erro:'segredo'}]}]){
 const api=await servidor(visao([lead()],extra));try{const r=await api.get();assert.equal(r.status,503);const p=await r.json();assert.equal(p.fonte.atual,false);assert.deepEqual(p.oportunidades,[]);assert.ok(!JSON.stringify(p).includes('segredo'))}finally{await api.fechar()}}
 const api=await servidor(visao([lead()]),{falhar:true});try{assert.equal((await api.get()).status,503)}finally{await api.fechar()}
})
test('mesma guarda da Central recusa pedido Serve sem login e admite leitura loopback',async()=>{
 const api=await servidor(visao([lead()]),{guardar:true});try{assert.equal((await api.get('',{headers:{'X-Forwarded-For':'100.64.0.8'}})).status,403);assert.equal(api.leituras(),0);assert.equal((await api.get()).status,200)}finally{await api.fechar()}
})
test('Assistente lê handoff pela visão atual, sem mensagem ou link do atendimento',async()=>{
 const l=lead({atendimentoComercial:{id:'handoff-001',tipo:'handoff',titulo:'Conferir com Rômulo',motivo:'Confirmar escopo',alvo:'operador',texto:'RASCUHO-NAO-EXPORTAR',estado:'pendente'}})
 const leituras=new LeiturasDaMensagem({visao:async()=>visao([l]) as CrmVisao},()=>new Date(AGORA))
 const p=await leituras.executar('ler_proxima_venda',{});assert.match(JSON.stringify(p),/Conferir com Rômulo/);assert.ok(!JSON.stringify(p).includes('RASCUHO-NAO-EXPORTAR'));assert.ok(!JSON.stringify(p).includes('wa.me'))
 const fonte=await readFile(new URL('../server.ts',import.meta.url),'utf8');assert.match(fonte,/fontes:\s*\{\s*visao: visaoAtendimento,\s*roster:/);assert.ok(fonte.indexOf('app.use(porteiroDeIp())')<fonte.indexOf('montarLeituraComercial(app'))
})

test('referência duplicada continua ambígua, nunca presume unicidade da oportunidade',async()=>{
 const l=lead(),api=await servidor(visao([l,{...l,empresa:'Registro duplicado'}]));try{const p=await(await api.get('?referencia='+referenciaLeituraComercial(l))).json();assert.equal(p.resultado,'ambiguo');assert.equal(p.oportunidades.length,2)}finally{await api.fechar()}
})
