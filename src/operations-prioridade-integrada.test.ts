import assert from 'node:assert/strict'
import {test} from 'node:test'
import {computed,ref,shallowRef} from 'vue'
import express from 'express'
import type {AddressInfo} from 'node:net'
import type {CrmLead,CrmVisao} from './operations/types.ts'
import {planoComercialDoLead,destaquesComerciais} from './operations/prioridade-comercial.ts'
import {resumirSinaisComerciais} from './operations/sinais-comerciais.ts'
import {filaDeVenda} from './operations/proxima-venda.ts'
import {decisoesDoEscritorio,proximaDecisaoPorPrioridade} from './office/decisoes.ts'
import {procedimentoDaDecisao} from './office/procedimento-da-decisao.ts'
import {montarLeituraComercial,ROTA_LEITURA_COMERCIAL} from '../server/leitura-comercial.ts'
import {montarMensagemDaDecisao} from '../server/mensagem-da-decisao.ts'
import {hashDoContexto} from './operations/revisao-resposta.ts'
import {notaDoAprendizado} from './operations/aprendizado-comercial.ts'
import {VERSAO_CLASSIFICACAO_RESPOSTA} from './operations/classificacao-resposta.ts'
const AGORA=Date.parse('2026-10-24T15:00:00Z'),EM='2026-10-24T14:59:00.000Z',VELHA='2026-10-22T20:03:00.000Z',SAIDA='2026-10-23T15:09:00.000Z'
function lead(id:string,extra:Partial<CrmLead>={}):CrmLead{return {id:`site:${id}`,chave:id,produto:'site',empresa:`Empresa fixture ${id}`,nicho:'Serviços',cidade:'Vitória',etapa:'contato',sinal:'em-conversa',subEtapa:'Conversa',estadoNaPlanilha:'contato',leitura:'pela-resposta',followupHoje:false,respostaNova:true,acervo:false,notas:0,divergencias:[],marcos:{enviado:'2026-10-20T14:00:00.000Z'},eventos:[],links:{whatsapp:'https://wa.me/5511999991234'},...extra}}
const classificacao=(classe:'interesse'|'permissao'|'neutra'|'robo',em=EM):CrmLead['classificacaoResposta']=>({versao:VERSAO_CLASSIFICACAO_RESPOSTA,classe,motivo:'Leitura da fixture',evidencia:{em,trecho:'Evidência sintética'},houveRespostaHumana:classe!=='robo',materialSolicitado:classe==='permissao',revisar:false,leituraConfirmada:classe!=='robo'})
function casos(){
 const atual=lead('atual',{resposta:{tipo:'neutra',trecho:'Quanto fica?',em:EM},classificacaoResposta:classificacao('interesse'),conversa:{desde:EM,mensagens:1,ultimaEntrada:EM,ultima:{em:EM,direcao:'entrada',trecho:'Quanto fica?'},sinaisComerciais:resumirSinaisComerciais([{em:EM,direcao:'entrada',texto:'Quanto fica?'}],AGORA)},atendimentoComercial:{id:'tarefa-atual',tipo:'handoff',titulo:'Conferir escopo do pedido com os sócios',motivo:'Pedido de condição específica',alvo:'operador',estado:'concluido',identidade:'confirmada',ocorridoEm:EM}})
 const historico=lead('historico',{resposta:{tipo:'neutra',trecho:'ok',em:VELHA},classificacaoResposta:classificacao('neutra',VELHA),conversa:{desde:VELHA,mensagens:3,ultimaEntrada:VELHA,ultimaSaida:SAIDA,ultima:{em:SAIDA,direcao:'saida',trecho:'Resposta enviada'},sinaisComerciais:resumirSinaisComerciais([{em:VELHA,direcao:'entrada',texto:'Qual o valor?'},{em:SAIDA,direcao:'saida',texto:'Resposta enviada'}],AGORA)}})
 const material=lead('material',{resposta:{tipo:'licenca',trecho:'Pode mandar vídeo',em:EM},classificacaoResposta:classificacao('permissao'),conversa:{desde:EM,mensagens:1,ultimaEntrada:EM,ultima:{em:EM,direcao:'entrada',trecho:'Pode mandar vídeo'},sinaisComerciais:resumirSinaisComerciais([{em:EM,direcao:'entrada',texto:'Pode mandar vídeo'}],AGORA)}})
 const espera=lead('espera',{...historico,id:'site:espera',chave:'espera',empresa:'Empresa fixture espera',atendimentoComercial:{...atual.atendimentoComercial!,id:'tarefa-espera',identidade:'sem-prova',ocorridoEm:VELHA,titulo:'Revisar a espera já combinada'},proximoPasso:{texto:'Esperar retorno; sem novo contato',data:'2026-10-25',registradoEm:SAIDA}})
 return {atual,historico,material,espera}
}
function visao(leads:CrmLead[]):CrmVisao{return {estado:'ok',geradoEm:new Date(AGORA-60000).toISOString(),fontes:[],leads,hoje:[{id:'resposta',titulo:'Respostas',explicacao:'',itens:leads.map((l,i)=>({leadId:l.id,acao:'Responder',detalhe:'',ordem:i,links:[]}))}]} as CrmVisao}
function fila(leads:CrmLead[]){return filaDeVenda(visao(leads),{primeiroLiberado:false,agora:AGORA})}
test('decisão atual, preparação histórica e material seguem a mesma ordem no helper, fila e escritório',()=>{
 const {atual,historico,material,espera}=casos(),leads=[material,espera,historico,atual],ordemEsperada=[atual.id,historico.id,material.id,espera.id]
 const acoes=fila(leads);assert.deepEqual(acoes.map(a=>a.leadId),ordemEsperada)
 const decisoes=decisoesDoEscritorio(leads,acoes,AGORA);assert.deepEqual(decisoes.filter(d=>d.estado==='agora').map(d=>d.lead.id),ordemEsperada)
 assert.equal(proximaDecisaoPorPrioridade(decisoes)?.lead.id,atual.id);assert.equal(proximaDecisaoPorPrioridade(decisoes,atual.id)?.lead.id,historico.id)
 assert.deepEqual(destaquesComerciais(leads,AGORA).map(x=>x.leadId),[atual.id,historico.id])
})
test('API preserva a mesma prioridade que a fila e o escritório, sem texto privado adicional',async()=>{
 const {atual,historico,material,espera}=casos(),leads=[espera,material,historico,atual],v=visao(leads),app=express()
 montarLeituraComercial(app,{visao:async()=>v,bloqueioConversa:async()=>null,agora:()=>AGORA});const srv=app.listen(0,'127.0.0.1');await new Promise<void>(r=>srv.once('listening',r))
 try{const r=await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ROTA_LEITURA_COMERCIAL}`),p=await r.json();assert.equal(r.status,200);assert.deepEqual(p.oportunidades.map((o:{empresa:string})=>o.empresa),fila(leads).map(a=>a.empresa));for(const l of leads){const o=p.oportunidades.find((o:{empresa:string})=>o.empresa===l.empresa);assert.deepEqual(o.prioridadeTrabalho,planoComercialDoLead(l,AGORA))}}finally{await new Promise<void>(r=>srv.close(()=>r()))}
})
test('título manual permanece na fila, decisão e procedimento; instrução compartilhada continua disponível',()=>{
 const {atual}=casos(),a=fila([atual])[0]!,d=decisoesDoEscritorio([atual],[a],AGORA)[0]!,p=procedimentoDaDecisao(atual,new Date(AGORA)),plano=planoComercialDoLead(atual,AGORA)
 assert.equal(a.titulo,atual.atendimentoComercial!.titulo);assert.equal(d.motivo,a.titulo);assert.equal(p.titulo,a.titulo);assert.ok(a.tatica.includes(plano.acao));assert.ok(p.passos.includes(plano.acao));assert.equal(p.resultadoEsperado,plano.resultado)
})
test('histórico sem tarefa derivada recebe somente ação interna, sem rascunho/link/modelo no preparo',async()=>{
 const {historico}=casos(),a=fila([historico])[0]!,p=procedimentoDaDecisao(historico,new Date(AGORA)),d=decisoesDoEscritorio([historico],[a],AGORA)[0]!
 assert.equal(a.interna,true);assert.equal(a.rascunho,undefined);assert.equal(a.link,undefined);assert.equal(a.anota,undefined);assert.equal(a.quente,false);assert.equal(p.tipo,'interno');assert.equal(p.mensagem,undefined);assert.equal(d.estado,'agora')
 const app=express();app.use(express.json());let chamadas=0
 montarMensagemDaDecisao(app,{crm:{visao:async()=>visao([historico])},copiloto:{ler:async()=>{chamadas++;return null},sugerir:async()=>{chamadas++;throw Error('Modelo não deveria ser chamado')}}})
 const srv=app.listen(0,'127.0.0.1');await new Promise<void>(r=>srv.once('listening',r))
 try{const r=await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/crm/decisao/mensagem`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({produto:historico.produto,id:historico.id,contextoHash:await hashDoContexto(historico)})}),resp=await r.json();assert.equal(r.status,200);assert.equal(resp.mensagem,null);assert.equal(resp.origem,null);assert.equal(resp.podeAbrir,false);assert.equal(chamadas,0)}finally{await new Promise<void>(r=>srv.close(()=>r()))}
})
test('urgência pertence só ao evento atual confirmado, nunca ao backfill histórico ou à espera',()=>{
 const {atual,historico,espera}=casos(),acoes=fila([atual,historico,espera]);assert.equal(acoes.find(a=>a.leadId===atual.id)?.quente,true)
 for(const l of [historico,espera])assert.equal(acoes.find(a=>a.leadId===l.id)?.quente,false)
 const depois=filaDeVenda(visao([atual]),{primeiroLiberado:false,agora:AGORA+16*60000});assert.equal(depois[0]?.quente,false);assert.equal(depois[0]?.titulo,atual.atendimentoComercial!.titulo)
})
test('pausa com tarefa continua visível internamente sem competir como preparação ou urgência',()=>{
 const {atual}=casos(),pausado={...atual,eventos:[{tipo:'nota',origem:'manual' as const,em:EM,rotulo:'Pausa',fonte:'CRM',texto:notaDoAprendizado({fato:'Aguardar',hipotese:'Responderá quando puder',teste:'Esperar',resultado:'em-teste',pausarAteResposta:true})}]}
 const a=fila([pausado])[0]!,d=decisoesDoEscritorio([pausado],[a],AGORA)[0]!,p=procedimentoDaDecisao(pausado,new Date(AGORA));assert.equal(d.estado,'agora');assert.equal(a.interna,true);assert.equal(a.quente,false);assert.equal(a.link,undefined);assert.equal(p.tipo,'interno');assert.match(p.passos.join(' '),/Aguardar/);assert.deepEqual(destaquesComerciais([pausado],AGORA),[])
})


test('retrato congelado preserva ordem, títulos e restrições em fila e decisões',()=>{
 const congelar=<T>(valor:T):T=>{if(valor&&typeof valor==='object'){for(const filho of Object.values(valor))congelar(filho);Object.freeze(valor)}return valor}
 const {atual,historico,material,espera}=casos(),v=congelar(visao([material,espera,historico,atual])),antes=JSON.stringify(v)
 const a=filaDeVenda(v,{primeiroLiberado:false,agora:AGORA}),d=decisoesDoEscritorio(v.leads,a,AGORA)
 assert.deepEqual(a.map(x=>x.leadId),[atual.id,historico.id,material.id,espera.id])
 assert.deepEqual(d.filter(x=>x.estado==='agora').map(x=>x.lead.id),a.map(x=>x.leadId))
 assert.equal(a[0].titulo,atual.atendimentoComercial!.titulo);assert.equal(a.find(x=>x.leadId===espera.id)?.quente,false)
 assert.equal(JSON.stringify(v),antes)
})

test('troca integral do retrato e relógio recalculam tarefa, identidade e urgência sem cache de permissão',()=>{
 const {atual,historico}=casos(),fonte=shallowRef(visao([historico,atual])),agora=ref(AGORA)
 const acoes=computed(()=>filaDeVenda(fonte.value,{primeiroLiberado:false,agora:agora.value}))
 const decisoes=computed(()=>decisoesDoEscritorio(fonte.value.leads,acoes.value,agora.value))
 assert.equal(acoes.value[0].leadId,atual.id);assert.equal(acoes.value[0].quente,true)
 agora.value+=16*60000;assert.equal(acoes.value.find(a=>a.leadId===atual.id)?.quente,false)
 const em=new Date(agora.value-60000).toISOString(),novo={...atual,resposta:{...atual.resposta!,em},conversa:{...atual.conversa!,ultimaEntrada:em,ultima:{...atual.conversa!.ultima,em},sinaisComerciais:resumirSinaisComerciais([{em,direcao:'entrada',texto:'Quanto fica?'}],agora.value)},atendimentoComercial:{...atual.atendimentoComercial!,id:'tarefa-renovada',titulo:'Conferir nova condição',identidade:'sem-prova' as const,ocorridoEm:em}}
 fonte.value=visao([historico,novo]);assert.equal(acoes.value.find(a=>a.leadId===atual.id)?.quente,false)
 assert.match(acoes.value.find(a=>a.leadId===atual.id)!.chave,/tarefa-renovada/);assert.equal(decisoes.value.find(d=>d.lead.id===atual.id)?.motivo,'Conferir nova condição')
 fonte.value=visao([historico,{...novo,atendimentoComercial:{...novo.atendimentoComercial,identidade:'confirmada'}}])
 assert.equal(acoes.value[0].leadId,atual.id);assert.equal(acoes.value[0].quente,true)
 assert.equal(acoes.value[0].link,undefined);assert.equal(acoes.value[0].rascunho,undefined)
})
