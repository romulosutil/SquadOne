import assert from 'node:assert/strict'
import {test} from 'node:test'
import {planoComercialDoLead,destaquesComerciais,type LeadParaPrioridadeComercial} from './operations/prioridade-comercial.ts'
import {planoDoLead} from './operations/bi-operacao.ts'
import {resumirSinaisComerciais} from './operations/sinais-comerciais.ts'
import {qualificacaoComercialVazia,PREFIXO_QUALIFICACAO_COMERCIAL} from './operations/qualificacao-comercial.ts'
import {PREFIXO_CICLO} from './operations/ciclo-comercial.ts'
import {notaDoAprendizado} from './operations/aprendizado-comercial.ts'
import {VERSAO_CLASSIFICACAO_RESPOSTA} from './operations/classificacao-resposta.ts'
const AGORA=Date.parse('2026-10-24T15:00:00Z'),EM='2026-10-23T14:00:00.000Z',SAIDA='2026-10-23T15:00:00.000Z'
const nota=(texto:string,em=EM):LeadParaPrioridadeComercial['eventos'][number]=>({tipo:'nota',origem:'manual',em,rotulo:'Nota',fonte:'CRM',texto})
function lead(extra:Partial<LeadParaPrioridadeComercial>={}):LeadParaPrioridadeComercial{return {id:'site:teste',chave:'teste',produto:'site',empresa:'Empresa teste',nicho:'serviços',cidade:'Vitória',etapa:'contato',sinal:'em-conversa',subEtapa:'Conversa',marcos:{},eventos:[],notas:0,estadoNaPlanilha:'contato',leitura:'pela-resposta',followupHoje:false,respostaNova:false,acervo:false,divergencias:[],links:{whatsapp:'https://wa.me/5511999991234'},...extra} as LeadParaPrioridadeComercial}
const conversa=(texto='ok',direcao:'entrada'|'saida'='entrada')=>({desde:EM,mensagens:2,ultimaEntrada:EM,ultima:{em:direcao==='entrada'?EM:SAIDA,direcao,trecho:texto},...(direcao==='saida'?{ultimaSaida:SAIDA}:{})})
const q=()=>({...qualificacaoComercialVazia(Date.parse(EM)),id:'q-001',necessidade:'Organizar pedidos',adequacao:{estado:'confirmada' as const,oferta:'encontrado' as const,motivo:'Compatível'},intencao:'avaliar' as const,decisao:'Dois sócios decidem em conjunto',proximoPasso:{descricao:'Avaliar escopo',aceito:true},fonte:'Fonte privada',evidencia:'Trecho privado'})
const historicoForte=()=>({...conversa('Respondemos, agora aguardamos','saida'),sinaisComerciais:resumirSinaisComerciais([{em:'2026-10-22T20:03:00Z',direcao:'entrada',texto:'Qual o valor?'},{em:EM,direcao:'entrada',texto:'ok'},{em:SAIDA,direcao:'saida',texto:'Resposta enviada'}],AGORA)})
const att=(identidade:'confirmada'|'sem-prova'|'conflito'|'indisponivel'='sem-prova')=>({id:'atendimento-1',tipo:'handoff',titulo:'Título privado',motivo:'Motivo privado',alvo:'operador',estado:'concluido',texto:'Rascunho privado',identidade,ocorridoEm:EM})
test('sinal forte histórico destaca preparação interna sem prova e com última saída nossa',()=>{
 const l=lead({conversa:historicoForte(),atendimentoComercial:att()}),p=planoComercialDoLead(l,AGORA)
 assert.equal(p.grupo,'conferir');assert.equal(p.destaque,true);assert.equal(p.acao,'Conferir condições já discutidas e preparar decisão, sem novo envio');assert.equal(p.evidencia.fonte,'sinal-recebido');assert.equal(p.evidencia.estado,'historica');assert.equal(p.em,'2026-10-22T20:03:00.000Z');assert.equal(p.contatoAutorizado,false)
})
test('identidade em conflito/indisponível e qualificação inválida seguem conferência sem fingir confirmação',()=>{
 for(const identidade of ['sem-prova','conflito','indisponivel']as const){const p=planoComercialDoLead(lead({conversa:conversa(),atendimentoComercial:att(identidade)}),AGORA);assert.equal(p.grupo,'conferir');assert.equal(p.destaque,false);assert.equal(p.evidencia.estado,'pendente')}
 const l=lead({qualificacaoComercial:q(),eventos:[nota(PREFIXO_QUALIFICACAO_COMERCIAL+'inválida')],conversa:conversa()});const p=planoComercialDoLead(l,AGORA);assert.equal(p.grupo,'conferir');assert.equal(p.evidencia.tipo,'qualificacao-invalida');assert.equal(p.destaque,false)
})
test('pausa e espera futura prevalecem sobre histórico de preço e deixam destaques vazios',()=>{
 const base=lead({conversa:historicoForte(),atendimentoComercial:att()})
 const pausado={...base,eventos:[nota(notaDoAprendizado({fato:'Aguardar',hipotese:'Sem entrada nova',teste:'Esperar',resultado:'em-teste',pausarAteResposta:true}),SAIDA)]}
 const futuro={...base,proximoPasso:{texto:'Avaliação com os sócios',data:'2026-11-01',registradoEm:SAIDA}}
 const espera={...base,proximoPasso:{texto:'Esperar comparação e resposta; sem nova cobrança',data:'2026-10-20',registradoEm:SAIDA}}
 for(const l of [pausado,futuro,espera]){const p=planoComercialDoLead(l,AGORA);assert.equal(p.grupo,'aguardar');assert.equal(p.destaque,false)}
 assert.deepEqual(destaquesComerciais([pausado,futuro,espera],AGORA),[])
})
test('recusa/exclusão/desfecho e nota negativa prevalecem, sem reabrir por preço',()=>{
 const base=lead({conversa:historicoForte(),atendimentoComercial:att()})
 for(const l of [{...base,resposta:{tipo:'negativa' as const,trecho:'Não tenho interesse',em:EM}},{...base,resposta:{tipo:'exclusao' as const,trecho:'Retire',em:EM}},{...base,etapa:'ganho' as const},{...base,etapa:'perdido' as const}]){const p=planoComercialDoLead(l,AGORA);assert.equal(p.grupo,'encerrado');assert.equal(p.destaque,false)}
 const qneg=planoComercialDoLead({...base,qualificacaoComercial:{...q(),intencao:'sem-interesse'}},AGORA);assert.equal(qneg.destaque,false);assert.equal(qneg.evidencia.tipo,'sem-interesse')
})
test('robô atual não se torna comprador por consulta de preço',()=>{
 const p=planoComercialDoLead(lead({resposta:{tipo:'bot',trecho:'Qual o valor?',em:EM},classificacaoResposta:{versao:VERSAO_CLASSIFICACAO_RESPOSTA,classe:'robo',houveRespostaHumana:false,materialSolicitado:false,revisar:false,leituraConfirmada:false,motivo:'Robô'},conversa:historicoForte(),atendimentoComercial:att()}),AGORA)
 assert.equal(p.grupo,'conferir');assert.equal(p.destaque,false);assert.equal(p.evidencia.tipo,'robo')
})
test('material permitido ou elogio sem necessidade/intenção não entram nos destaques de decisão',()=>{
 const l=lead({resposta:{tipo:'licenca',trecho:'Me manda vídeo de apresentação',em:EM},conversa:{...conversa('Me manda vídeo de apresentação'),sinaisComerciais:resumirSinaisComerciais([{em:EM,direcao:'entrada',texto:'Me manda vídeo de apresentação'}],AGORA)}})
 assert.equal(planoComercialDoLead(l,AGORA).destaque,false)
 const respondido={...l,conversa:{...l.conversa!,ultima:{direcao:'saida' as const,em:SAIDA,trecho:'Vídeo enviado'},ultimaSaida:SAIDA}};assert.equal(planoComercialDoLead(respondido,AGORA).grupo,'aguardar');assert.equal(planoComercialDoLead(respondido,AGORA).destaque,false)
})
test('qualificação humana suficiente com sócios pode preparar decisão, sem exigir reunião/impacto',()=>{
 const l=lead({qualificacaoComercial:q(),conversa:conversa('Quero avaliar')});const p=planoComercialDoLead(l,AGORA)
 assert.equal(p.grupo,'decidir');assert.equal(p.destaque,true);assert.equal(p.evidencia.fonte,'qualificacao-humana');assert.equal(p.evidencia.tipo,'qualificacao-suficiente');assert.equal(p.contatoAutorizado,false)
 const parcial=planoComercialDoLead({...l,qualificacaoComercial:{...q(),proximoPasso:{descricao:'',aceito:false}}},AGORA);assert.equal(parcial.grupo,'qualificar');assert.equal(parcial.evidencia.tipo,'proximoPasso')
})
test('qualificação suficiente já respondida aguarda; ciclo registrado exige decisão interna distinta',()=>{
 const base=lead({qualificacaoComercial:q(),conversa:conversa('Já respondemos','saida')});assert.equal(planoComercialDoLead(base,AGORA).grupo,'aguardar')
 const evento={v:1,id:'proposta-1',tipo:'proposta',data:'2026-10-23',humano:true,referencia:'referencia-privada',ofertaId:'encontrado',versao:1,valor:987654}
 const l={...base,eventos:[nota(PREFIXO_CICLO+JSON.stringify(evento))]},p=planoComercialDoLead(l,AGORA);assert.equal(p.grupo,'decidir');assert.equal(p.evidencia.fonte,'ciclo-humano');assert.equal(p.destaque,true)
 assert.ok(!JSON.stringify(p).includes('987654'));assert.ok(!JSON.stringify(p).includes('referencia-privada'))
})
test('palavra/preço no recibo ou rascunho e dados ausentes não fabricam oportunidade',()=>{
 for(const texto of ['R$ 500','Reembolso de R$ 300','Rascunho do concorrente R$ 90']){const p=planoComercialDoLead(lead({conversa:conversa(texto),resposta:{tipo:'neutra',trecho:texto,em:EM}}),AGORA);assert.equal(p.destaque,false,texto)}
 assert.deepEqual(destaquesComerciais([lead({etapa:'novo'}),lead({etapa:'perdido'})],AGORA),[])
})
test('destaques limitam cinco trabalhos, ordenam por fonte sem probabilidade e não mudam leads',()=>{
 const leads=Array.from({length:8},(_,i)=>lead({id:`site:${i}`,qualificacaoComercial:{...q(),em:new Date(Date.parse(EM)+i*1000).toISOString()},conversa:conversa('Quero avaliar')})),antes=JSON.stringify(leads)
 const r=destaquesComerciais(leads,AGORA);assert.equal(r.length,5);assert.equal(r[0]?.leadId,'site:7');assert.equal(JSON.stringify(leads),antes)
 for(const x of r){assert.equal(x.plano.contatoAutorizado,false);for(const k of ['rascunho','link','probabilidade','quente'])assert.equal(Object.hasOwn(x.plano,k),false);assert.ok(x.plano.em);assert.equal(x.plano.urgente,false)}
})
test('restrição recebida mais recente prevalece sobre sinal histórico e saída posterior',()=>{
 const c={...conversa('Resposta enviada','saida'),sinaisComerciais:resumirSinaisComerciais([{em:EM,direcao:'entrada',texto:'Quanto fica?'},{em:'2026-10-23T14:30:00Z',direcao:'entrada',texto:'Não quero contratar'},{em:SAIDA,direcao:'saida',texto:'Entendido'}],AGORA)}
 const p=planoComercialDoLead(lead({conversa:c,atendimentoComercial:att()}),AGORA);assert.equal(p.grupo,'encerrado');assert.equal(p.destaque,false)
})
test('plano só contém orientação interna e metadados canônicos, sem evidência privada',()=>{
 const l=lead({qualificacaoComercial:q(),empresa:'Empresa (11)999991234',conversa:conversa('Trecho privado'),atendimentoComercial:att('confirmada')}),s=JSON.stringify(planoComercialDoLead(l,AGORA))
 for(const termo of ['999991234','Trecho privado','Fonte privada','Rascunho privado','Motivo privado','Título privado'])assert.ok(!s.includes(termo),termo)
})

test('evento atual confirmado e recente destaca decisão humana, usando somente o horário original',()=>{
 const em=new Date(AGORA-60000).toISOString(),c={...conversa('Quanto fica?'),ultimaEntrada:em,ultima:{em,direcao:'entrada' as const,trecho:'Quanto fica?'},sinaisComerciais:resumirSinaisComerciais([{em,direcao:'entrada',texto:'Quanto fica?'}],AGORA)}
 const l=lead({conversa:c,atendimentoComercial:{...att('confirmada'),ocorridoEm:em}}),p=planoComercialDoLead(l,AGORA)
 assert.equal(p.grupo,'decidir');assert.equal(p.ordem,10);assert.equal(p.evidencia.estado,'atual');assert.equal(p.em,em);assert.equal(p.destaque,true);assert.equal(p.urgente,true);assert.equal(p.contatoAutorizado,false)
 for(const identidade of ['sem-prova','conflito','indisponivel']as const){const x=planoComercialDoLead({...l,atendimentoComercial:{...l.atendimentoComercial!,identidade}},AGORA);assert.equal(x.grupo,'conferir');assert.equal(x.urgente,false)}
 const respondido=planoComercialDoLead({...l,conversa:{...c,ultimaSaida:new Date(AGORA-30000).toISOString()}},AGORA);assert.notEqual(respondido.grupo,'decidir');assert.equal(respondido.urgente,false)
})
test('backfill antigo, horário divergente, data ausente e futuro não fabricam urgência',()=>{
 const base=lead({conversa:historicoForte(),atendimentoComercial:{...att('confirmada'),ocorridoEm:'2026-10-22T20:03:00.000Z'}})
 assert.equal(planoComercialDoLead(base,AGORA).urgente,false)
 const em=new Date(AGORA-60000).toISOString(),c={...conversa('Quanto fica?'),ultimaEntrada:em,ultima:{em,direcao:'entrada' as const,trecho:'Quanto fica?'},sinaisComerciais:resumirSinaisComerciais([{em,direcao:'entrada',texto:'Quanto fica?'}],AGORA)}
 for(const ocorridoEm of [EM,undefined,new Date(AGORA+60000).toISOString()]){const p=planoComercialDoLead(lead({conversa:c,atendimentoComercial:{...att('confirmada'),ocorridoEm}}),AGORA);assert.equal(p.urgente,false);assert.notEqual(p.grupo,'decidir')}
 const antigo=new Date(AGORA-16*60000).toISOString(),x=lead({conversa:{...c,ultimaEntrada:antigo,ultima:{...c.ultima,em:antigo},sinaisComerciais:resumirSinaisComerciais([{em:antigo,direcao:'entrada',texto:'Quanto fica?'}],AGORA)},atendimentoComercial:{...att('confirmada'),ocorridoEm:antigo}})
 const p=planoComercialDoLead(x,AGORA);assert.equal(p.grupo,'decidir');assert.equal(p.destaque,true);assert.equal(p.urgente,false)
})

test('trecho legado de preço conserva seu horário, não herda entrada posterior nem recebidoEm',()=>{
 const novo=new Date(AGORA-60000).toISOString(),l=lead({resposta:{tipo:'neutra',trecho:'Quanto fica?',em:EM},conversa:{...conversa('ok'),ultimaEntrada:novo,ultima:{em:novo,direcao:'entrada',trecho:'ok'}},atendimentoComercial:{...att('confirmada'),ocorridoEm:novo}}),p=planoComercialDoLead(l,AGORA)
 assert.equal(p.grupo,'conferir');assert.equal(p.em,EM);assert.equal(p.urgente,false)
 const semData=planoComercialDoLead({...l,resposta:{tipo:'neutra',trecho:'Quanto fica?'}},AGORA);assert.equal(semData.destaque,false);assert.equal(semData.urgente,false)
})

test('histórico comercial sem tarefa derivada também permite preparação interna sem qualificação inventada',()=>{
 const p=planoComercialDoLead(lead({conversa:historicoForte()}),AGORA)
 assert.equal(p.grupo,'conferir');assert.equal(p.destaque,true);assert.equal(p.ordem,20);assert.equal(p.evidencia.estado,'historica');assert.equal(p.urgente,false);assert.equal(p.contatoAutorizado,false)
})

test('BI conserva shape e reproduz próxima ação interna da prioridade sem nova exigência SPICED',()=>{
 for(const l of [lead({conversa:historicoForte()}),lead({qualificacaoComercial:q(),conversa:conversa()}),lead({qualificacaoComercial:{...q(),decisao:''},conversa:conversa()}),lead({qualificacaoComercial:{...q(),intencao:'sem-interesse'},conversa:conversa()})]){
  const p=planoComercialDoLead(l,AGORA),bi=planoDoLead(l,AGORA);assert.equal(bi.acao,p.acao);assert.equal(bi.resultado,p.resultado);assert.equal(bi.tipo,'conferir');assert.ok(!bi.resultado.includes('impacto'));assert.equal(bi.lead,l)
 }
 const pausado=lead({conversa:historicoForte(),atendimentoComercial:att(),eventos:[nota(notaDoAprendizado({fato:'Aguardar',hipotese:'Sem entrada nova',teste:'Esperar',resultado:'em-teste',pausarAteResposta:true}),SAIDA)]}),bi=planoDoLead(pausado,AGORA)
 assert.equal(bi.tipo,'conferir');assert.equal(bi.prioridade,0);assert.match(bi.acao,/Aguardar/);assert.match(bi.condicao!,/não autoriza envio/);assert.equal(planoComercialDoLead(pausado,AGORA).destaque,false)
})
