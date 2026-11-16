import test from 'node:test'
import assert from 'node:assert/strict'
import {textoDeMensagemAutomatica} from './operations/mensagem-automatica.ts'
import {papelDaMensagem} from './operations/marcadores-da-conversa.ts'
import {classificarResposta,respostaParaAcompanhamento,VERSAO_CLASSIFICACAO_RESPOSTA} from './operations/classificacao-resposta.ts'
const envio='2026-11-04T13:00:00Z',entrada='2026-11-04T13:00:02Z',agora=Date.parse('2026-11-06T18:00:00Z')
const recepcao='Olá! Iremos te atender em instantes.'
const ausencia='Agradecemos sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível.'
const expediente='Atendimento de segunda à sexta das 9h às 17h. Ligações em caso urgência.\nInstagram @escritorio.exemplo\nRESPOSTAS POR ORDEM DE CONTATO. 🛑FORA DO HORÁRIO, FERIADOS E FINAIS DE SEMANA, SOMENTE URGÊNCIA.'
const lead=(texto:string)=>({marcos:{enviado:envio,respondeu:entrada},resposta:{tipo:'neutra' as const,trecho:texto,em:entrada}})
const conversa=(texto:string)=>[{direcao:'saida' as const,em:envio,texto:'Posso enviar a análise?'},{direcao:'entrada' as const,em:entrada,texto,papel:'gente'}]
for(const [nome,texto] of [['recepção',recepcao],['ausência',ausencia],['expediente',expediente]]){
 test(nome+' padronizado invalida rótulo humano legado sem alterar origem',()=>{const l=lead(texto),before=JSON.stringify(l);const c=classificarResposta(l,conversa(texto),agora);assert.equal(c.classe,'robo');assert.equal(c.houveRespostaHumana,false);assert.equal(c.revisar,false);assert.equal(c.materialSolicitado,false);assert.equal(c.versao,VERSAO_CLASSIFICACAO_RESPOSTA);assert.equal(papelDaMensagem(texto,'recepcao'),'robo');assert.equal(respostaParaAcompanhamento(l.resposta,c)?.tipo,'bot');assert.equal(JSON.stringify(l),before)})
}
test('repetição de recepção após outra saída não constitui resposta humana',()=>{const ms=[...conversa(recepcao),{direcao:'saida' as const,em:'2026-11-05T13:00:00Z',texto:'Bom dia, também atuamos com automações.'},{direcao:'entrada' as const,em:'2026-11-05T13:00:02Z',texto:recepcao}];const l=lead(recepcao);l.marcos.respondeu='2026-11-05T13:00:02Z';l.resposta.em=l.marcos.respondeu;const c=classificarResposta(l,ms,agora);assert.equal(c.classe,'robo');assert.equal(c.houveRespostaHumana,false)})
test('saudação e ausência no mesmo segundo são robôs em qualquer ordem',()=>{const greeting='Empresa de Serviços agradece seu contato. Como podemos ajudar?';for(const texts of [[greeting,ausencia],[ausencia,greeting]]){const ms=[conversa(texts[0])[0],...texts.map(texto=>({direcao:'entrada' as const,em:entrada,texto}))];const c=classificarResposta(lead(texts[1]),ms,agora);assert.equal(c.classe,'robo');assert.equal(c.houveRespostaHumana,false);assert.equal(c.materialSolicitado,false)}})
test('o aviso de expediente não exige Instagram nem a grafia exata do horário',()=>{assert.equal(textoDeMensagemAutomatica('Atendimento de segunda-feira a sexta-feira das 08:30 às 18:00. Respostas por ordem de contato. Fora do horário, feriados e finais de semana, somente urgência.'),true)})
for(const texto of [recepcao+' Quanto custa o site?',ausencia+' Pode enviar a análise.',expediente+' Não quero receber propostas.',"Você escreveu: 'Iremos te atender em instantes'. Quero saber o valor.",'Atendo de segunda a sexta e tenho interesse no site.','Bom dia, sou a responsável. Pode mandar o material.']){
 test('conteúdo humano adicional permanece fora dos novos moldes: '+texto.slice(0,40),()=>{assert.equal(textoDeMensagemAutomatica(texto),false)})
}
test('pergunta comercial após aviso, com autoria confirmada, continua interesse',()=>{const texto='Olá! Iremos te atender em instantes. Quanto custa o site?';const c=classificarResposta(lead(texto),conversa(texto),agora);assert.equal(c.classe,'interesse');assert.equal(c.houveRespostaHumana,true)})
test('nova entrada humana depois do aviso é classificada pelo contexto atual',()=>{const ms=[...conversa(recepcao),{direcao:'entrada' as const,em:'2026-11-04T13:01:00Z',texto:'Pode mandar a análise.',papel:'recepcao'}];const c=classificarResposta({marcos:{enviado:envio},resposta:{tipo:'bot',trecho:'',em:entrada}},ms,agora);assert.equal(c.classe,'permissao');assert.equal(c.houveRespostaHumana,true);assert.equal(c.materialSolicitado,true)})
test('recusa e exclusão adicionais não são ocultadas pelo aviso',()=>{for(const [texto,classe] of [[recepcao+' Não tenho interesse.','recusa'],[expediente+' Remova meu número.','exclusao']]){const c=classificarResposta(lead(texto),conversa(texto),agora);assert.equal(c.classe,classe);assert.equal(c.houveRespostaHumana,true)}})
