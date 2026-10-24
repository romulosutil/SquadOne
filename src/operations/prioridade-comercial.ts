/** Prioridade de trabalho interno, nunca chance de venda ou permissão de contato. Sem I/O. */
import type {CrmLead} from './types.ts'
import type {ResumoSinaisComerciais,SinalComercialRecebido} from './sinais-comerciais.ts'
import {contatoPausado} from './aprendizado-comercial.ts'
import {classificarResposta} from './classificacao-resposta.ts'
import {qualificacaoComercialAtual,temQualificacaoComercial,camposFaltantesQualificacao} from './qualificacao-comercial.ts'
import {cicloDoLead,PREFIXO_CICLO} from './ciclo-comercial.ts'
import {revisaoRetomadaDoLead} from './revisao-retomadas.ts'
import {diaEmSP,intencaoDoPasso} from './retomadas.ts'
import {audioDaMensagem,papelDaMensagem} from './marcadores-da-conversa.ts'
import {objecoesNoTexto} from './colinha.ts'
import {sinalNoTexto} from '../../server/lead-quente.ts'
export type IdentidadeAtendimentoComercial='confirmada'|'sem-prova'|'conflito'|'indisponivel'
export type LeadParaPrioridadeComercial=Omit<CrmLead,'conversa'|'atendimentoComercial'> & {
 conversa?:CrmLead['conversa'] & {sinaisComerciais?:ResumoSinaisComerciais}
 atendimentoComercial?:CrmLead['atendimentoComercial'] & {identidade?:IdentidadeAtendimentoComercial;ocorridoEm?:string}
}
export interface PlanoPrioridadeComercial {
 grupo:'decidir'|'qualificar'|'conferir'|'aguardar'|'encerrado'
 nivel:1|2|3|4|5;ordem:number;acao:string;resultado:string
 evidencia:{fonte:'qualificacao-humana'|'ciclo-humano'|'classificacao-atual'|'sinal-recebido'|'atendimento'|'restricao'|'sem-evidencia';tipo:string;estado:'atual'|'historica'|'pendente'}
 em:string|null;destaque:boolean;urgente:boolean;contatoAutorizado:false
}
const instante=(em:string|undefined|null,agora:number):number=>{const t=Date.parse(em??'');return Number.isFinite(t)&&t<=agora?t:0}
const emValido=(em:string|undefined|null,agora:number)=>instante(em,agora)?new Date(em!).toISOString():null
const sinalForte=(s:SinalComercialRecebido)=>['preco','proposta','contratar'].includes(s.tipo)
/** O resultado não contém rascunho, link, condição financeira ou texto da evidência. */
export function planoComercialDoLead(lead:LeadParaPrioridadeComercial,agora:number):PlanoPrioridadeComercial {
 lead={...lead,eventos:lead.eventos??[]}
 const resumo=lead.conversa?.sinaisComerciais?.v===1?lead.conversa.sinaisComerciais:undefined
 const entradas=[resumo?.ultimaEntradaEm,lead.conversa?.ultimaEntrada,lead.conversa?.ultima.direcao==='entrada'?lead.conversa.ultima.em:null,lead.resposta?.em]
 const entrada=Math.max(0,...entradas.map(e=>instante(e,agora))),saida=Math.max(instante(resumo?.ultimaSaidaEm,agora),instante(lead.conversa?.ultimaSaida,agora),lead.conversa?.ultima.direcao==='saida'?instante(lead.conversa.ultima.em,agora):0)
 const emEntrada=entrada?new Date(entrada).toISOString():null
 const atual=lead.classificacaoResposta??classificarResposta(lead,undefined,agora)
 const att=lead.atendimentoComercial,passo=lead.proximoPasso
 const devolver=(grupo:PlanoPrioridadeComercial['grupo'],ordem:number,acao:string,resultado:string,fonte:PlanoPrioridadeComercial['evidencia']['fonte'],tipo:string,em:string|null,estado:PlanoPrioridadeComercial['evidencia']['estado']='atual',destaque=false):PlanoPrioridadeComercial=>({grupo,nivel:ordem<20?1:ordem<30?2:ordem<50?3:ordem<80?4:5,ordem,acao,resultado,evidencia:{fonte,tipo,estado},em:emValido(em,agora),destaque:destaque&&!!emValido(em,agora),urgente:false,contatoAutorizado:false})
 const restricao=resumo?.restricao&&instante(resumo.restricao.em,agora)?resumo.restricao:null
 if(['ganho','perdido'].includes(lead.etapa)||['negativa','exclusao'].includes(lead.resposta?.tipo??'')||['recusa','exclusao'].includes(atual.classe)||restricao)
  return devolver('encerrado',90,'Preservar o desfecho e a restrição de contato','Histórico e restrição preservados; nenhuma nova abordagem.','restricao',restricao?.tipo??atual.classe,restricao?.em??emEntrada)
 const retomada=revisaoRetomadaDoLead(lead,agora)
 const registrado=instante(passo?.registradoEm,agora),passoVigente=!!passo?.texto&&(!registrado||registrado>=entrada)
 const futuro=passoVigente&&/^\d{4}-\d{2}-\d{2}$/.test(passo!.data)&&passo!.data>diaEmSP(new Date(agora))
 if(contatoPausado(lead)||futuro||passoVigente&&intencaoDoPasso(passo!.texto)==='espera'||retomada?.atual&&['aguardar','nao-priorizar'].includes(retomada.grupo))
  return devolver('aguardar',80,'Aguardar a resposta ou a condição combinada','Espera preservada; revisão interna não autoriza retomada.','restricao','espera',passo?.registradoEm??retomada?.em??emEntrada)
 const q=qualificacaoComercialAtual(lead,agora)
 if(q?.intencao==='sem-interesse'||q?.adequacao.estado==='inadequada')
  return devolver('conferir',65,'Conferir a restrição comercial registrada','Revisão humana negativa preservada, sem rascunho de contato.','qualificacao-humana',q.intencao==='sem-interesse'?'sem-interesse':'inadequada',q.em)
 const fortes=(resumo?.sinais??[]).filter(s=>sinalForte(s)&&instante(s.em,agora)).sort((a,b)=>Date.parse(b.em)-Date.parse(a.em))
 // O trecho legado pode gerar um indício, nunca qualificação humana. Robô/recusa não participa.
 const sinalAtual=!['robo','recusa','exclusao','permissao'].includes(atual.classe)&&!atual.materialSolicitado&&!['bot','licenca'].includes(lead.resposta?.tipo??'')?sinalNoTexto(lead.resposta?.trecho??''):null
 const precoContextual=sinalAtual==='preco'&&(atual.classe==='interesse'||objecoesNoTexto(lead.resposta?.trecho).some(o=>o.id==='quanto-custa'))
 const emSinalAtual=emValido(lead.resposta?.em,agora)
 const forte=fortes[0]??((precoContextual||sinalAtual==='proposta'||sinalAtual==='fechar')&&emSinalAtual?{tipo:sinalAtual==='fechar'?'contratar':sinalAtual as 'preco'|'proposta',em:emSinalAtual,autoria:'nao-confirmada' as const}:undefined)
 const ultima=lead.conversa?.ultima,papel=ultima?.direcao==='entrada'?papelDaMensagem(ultima.trecho,ultima.papel):undefined,audio=ultima?.direcao==='entrada'?audioDaMensagem(ultima.trecho):null
 const roboAtual=atual.classe==='robo'||papel==='robo'
 const nova=temQualificacaoComercial(lead,agora)
 const contextoPendente=!!forte&&!q||!!att&&att.identidade!=='confirmada'||nova&&!q||!!lead.revisaoComercial||!!retomada&&!retomada.atual||resumo?.conteudoPendente||!!audio&&!audio.transcricao||papel==='recepcao'
 if(roboAtual)return devolver('conferir',70,'Conferir o canal e a autoria da resposta','Resposta automática não tratada como intenção de compra.','classificacao-atual','robo',emEntrada,'pendente')
 // Só a data original do mesmo evento confirmado sustenta urgência; receber backfill não conta.
 const forteEm=instante(forte?.em,agora),ocorrido=instante(att?.ocorridoEm,agora)
 if(forte&&att?.identidade==='confirmada'&&forteEm&&forteEm===ocorrido&&forteEm===entrada&&saida<entrada){
  const plano=devolver('decidir',10,'Conferir o pedido comercial atual com Rômulo','Preço, proposta ou contratação revisados pelo humano; nenhuma resposta ou contratação automática.','atendimento',forte.tipo,forte.em,'atual',true)
  return {...plano,urgente:agora-forteEm<=15*60000}
 }
 if(contextoPendente){
  if(forte)return devolver('conferir',20,'Conferir condições já discutidas e preparar decisão, sem novo envio','Condições e contexto conferidos por Rômulo; nenhuma retomada presumida.','sinal-recebido',forte.tipo,forte.em,'historica',true)
  return devolver('conferir',60,'Resolver contexto antes de preparar qualquer contato','Identidade, fonte e pendência conferidas na ficha.','atendimento',nova&&!q?'qualificacao-invalida':att?.identidade??'contexto-pendente',att?.ocorridoEm??emEntrada,'pendente')
 }
 const ciclo=cicloDoLead(lead,agora)
 const notasCiclo=lead.eventos.filter(e=>e.tipo==='nota'&&e.origem==='manual'&&(e.registroTexto??e.texto??'').startsWith(PREFIXO_CICLO)&&instante(e.em,agora)).sort((a,b)=>Date.parse(b.em)-Date.parse(a.em))
 if(ciclo.historico.length||ciclo.problemas.length||notasCiclo.length){
  const temFatos=!!ciclo.eventos.length,em=notasCiclo[0]?.em??emEntrada
  return devolver(ciclo.problemas.length?'conferir':'decidir',ciclo.problemas.length?25:10,'Conferir o ciclo comercial e decidir o próximo marco com Rômulo','Versão, evidência e condição de proposta, contratação ou recebimento conferidas; sem confirmação automática.','ciclo-humano',ciclo.problemas.length?'revisao-pendente':ciclo.eventos.at(-1)?.tipo??'revisao',em,ciclo.problemas.length?'pendente':'atual',temFatos)
 }
 if(entrada&&saida>=entrada)return devolver('aguardar',81,'Aguardar retorno após a última resposta enviada','Não repetir apresentação, proposta ou pergunta já respondida.','classificacao-atual','saida-posterior',emEntrada)
 if(q){
  const faltantes=camposFaltantesQualificacao(q),ativa=q.intencao==='avaliar'||q.intencao==='contratar'
  if(!faltantes.length)return devolver('decidir',11,'Preparar a decisão comercial com Rômulo','Escopo, condições e versão da proposta conferidos antes de apresentação.','qualificacao-humana','qualificacao-suficiente',q.em,'atual',true)
  return devolver('qualificar',30,'Conferir uma lacuna da qualificação por vez','Próxima pergunta ou conferência interna escolhida sem repetir o que já foi confirmado.','qualificacao-humana',faltantes[0]!,q.em,'atual',ativa)
 }
 if(forte)return devolver('conferir',21,'Conferir condições já discutidas e preparar decisão, sem novo envio','Indício comercial separado de qualificação e condição humana confirmadas.','sinal-recebido',forte.tipo,forte.em,forte.autoria==='gente'?'atual':'pendente',true)
 if(atual.classe==='interesse'&&atual.houveRespostaHumana&&emEntrada)
  return devolver('qualificar',31,'Conferir necessidade e a próxima lacuna comercial','Uma lacuna pertinente identificada, sem reunião ou proposta presumida.','classificacao-atual','interesse',emEntrada,'atual',true)
 if(entrada)return devolver('qualificar',45,'Conferir o pedido recebido antes de escolher a próxima ação','Permissão, encaminhamento e curiosidade separados de intenção de contratar.','classificacao-atual',atual.materialSolicitado?'material':atual.classe,emEntrada,'pendente')
 return devolver('conferir',75,'Conferir se há uma conversa comercial e evidência disponível','Nenhuma oportunidade pronta presumida pela ausência de dados.','sem-evidencia','sem-contexto',null,'pendente')
}
/** O contrato derivado novo convive com prioridade/pulo de listas legadas. */
export function temContextoPrioridadeComercial(lead:LeadParaPrioridadeComercial,agora:number):boolean {
 return !!lead.atendimentoComercial||!!lead.conversa?.sinaisComerciais||temQualificacaoComercial(lead,agora)
  ||(lead.eventos??[]).some(e=>e.tipo==='nota'&&e.origem==='manual'&&(e.registroTexto??e.texto??'').startsWith(PREFIXO_CICLO))
}
/** Indício histórico/pendente destacado exige apenas preparação interna, mesmo sem tarefa derivada. */
export function conferenciaComercialInterna(lead:LeadParaPrioridadeComercial,agora:number):boolean {
 return planoPedeConferenciaInterna(planoComercialDoLead(lead,agora))
}
/** Reutiliza o plano da MESMA execução; não guarda permissão ou urgência entre leituras. */
export function planoPedeConferenciaInterna(p:PlanoPrioridadeComercial):boolean {
 return p.destaque&&p.grupo==='conferir'&&p.evidencia.fonte==='sinal-recebido'
}
/** A mesma ordem em API, fila e escritório; desempate nunca usa recebidoEm do backfill. */
export function compararPlanosComerciais(a:PlanoPrioridadeComercial,b:PlanoPrioridadeComercial,chaveA='',chaveB=''):number {
 return a.ordem-b.ordem||(Date.parse(b.em??'')||0)-(Date.parse(a.em??'')||0)||chaveA.localeCompare(chaveB)
}
/** Até cinco prioridades internas; nunca completa a quantidade com espera, recusa ou silêncio. */
export function destaquesComerciais(leads:readonly LeadParaPrioridadeComercial[],agora:number){
 return leads.map(lead=>({leadId:lead.id,produto:lead.produto,plano:planoComercialDoLead(lead,agora)})).filter(i=>i.plano.destaque)
  .sort((a,b)=>compararPlanosComerciais(a.plano,b.plano,`${a.produto}:${a.leadId}`,`${b.produto}:${b.leadId}`)).slice(0,5)
}
