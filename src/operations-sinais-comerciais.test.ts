import assert from 'node:assert/strict'
import {test} from 'node:test'
import {resumirSinaisComerciais,type MensagemParaSinalComercial} from './operations/sinais-comerciais.ts'
const AGORA=Date.parse('2026-10-24T15:00:00Z')
const em=(n:number)=>new Date(AGORA-n*60000).toISOString()
const m=(texto:string,n=10,extra:Partial<MensagemParaSinalComercial>={}):MensagemParaSinalComercial=>({em:em(n),direcao:'entrada',texto,...extra})
test('preço recebido continua identificável após ok e saídas posteriores, com a data original',()=>{
 const r=resumirSinaisComerciais([m('Quanto fica?',20),m('Ok',19),m('Nosso serviço custa R$ 500',18,{direcao:'saida'})],AGORA)
 assert.deepEqual(r.sinais,[{tipo:'preco',em:em(20),autoria:'nao-confirmada'}]);assert.equal(r.ultimaEntradaEm,em(19));assert.equal(r.ultimaSaidaEm,em(18))
})
test('material, elogio e permissão não equivalem a preço, proposta ou contratação',()=>{
 const r=resumirSinaisComerciais([m('Interessante. Me manda um vídeo de apresentação desse sistema',20),m('Pode mandar',19),m('Gostei, achei bem legal',18)],AGORA)
 assert.ok(r.sinais.every(s=>s.tipo==='material'));assert.ok(!r.sinais.some(s=>['preco','proposta','contratar'].includes(s.tipo)))
})
test('saída, robô, recepção e menu automático não produzem sinal comercial',()=>{
 const r=resumirSinaisComerciais([m('Quanto fica?',20,{direcao:'saida'}),m('Qual o valor?',19,{papel:'robo'}),m('Quero contratar',18,{papel:'recepcao'}),m('[Atendimento automático] Quanto custa o serviço?',17)],AGORA)
 assert.deepEqual(r.sinais,[]);assert.equal(r.ultimaEntradaEm,null)
})
test('menção monetária em recibo/reembolso/rascunho não é consulta de preço',()=>{
 for(const texto of ['O concorrente tinha R$ 90 no rascunho','Solicito reembolso de R$ 500','R$ 600'])assert.deepEqual(resumirSinaisComerciais([m(texto)],AGORA).sinais,[],texto)
})
test('pedido de proposta e expressão de contratação são indícios, nunca atestado humano',()=>{
 for(const [texto,tipo]of [['Quero uma proposta','proposta'],['Vamos fechar','contratar'],['Quero contratar','contratar']]as const){
  const r=resumirSinaisComerciais([m(texto)],AGORA);assert.equal(r.sinais[0]?.tipo,tipo);assert.equal(r.sinais[0]?.autoria,'nao-confirmada')
 }
 const r=resumirSinaisComerciais([m('Quanto fica?',10,{papel:'gente'})],AGORA);assert.equal(r.sinais[0]?.autoria,'gente')
})
test('última recusa vence sinal anterior; ok posterior não reabre a restrição',()=>{
 const r=resumirSinaisComerciais([m('Quanto fica?',20),m('Não tenho interesse',19),m('ok',18)],AGORA)
 assert.deepEqual(r.restricao,{tipo:'recusa',em:em(19)});assert.equal(r.sinais[0]?.tipo,'preco')
})
test('conversa comercial posterior pode sinalizar revisão de outra oferta sem apagar recusa registrada no CRM',()=>{
 const r=resumirSinaisComerciais([m('Não quero esse serviço',20),m('Qual o valor do outro serviço?',19)],AGORA)
 assert.equal(r.restricao,null);assert.equal(r.sinais.at(-1)?.tipo,'preco')
})
test('ordem, duplicata, horário futuro e limite de60 preservam deterministicidade',()=>{
 const a=m('Quanto fica?',30),b=m('ok',20),f=m('Quero contratar',-1),invalido={...a,em:'inválida'}
 assert.deepEqual(resumirSinaisComerciais([b,a,a,f,invalido],AGORA),resumirSinaisComerciais([a,b],AGORA))
 assert.equal(resumirSinaisComerciais([m('Quanto fica?',70),...Array.from({length:60},(_,i)=>m('ok',60-i))],AGORA).sinais.length,0)
})
test('resumo só devolve tipos, datas e metadados, sem conteúdo/telefone/preço',()=>{
 const texto='Qual o valor? Meu telefone é (11) 99999-1234, contrato privado ABC, recibo XYZ'
 const r=resumirSinaisComerciais([m(texto)],AGORA),s=JSON.stringify(r)
 for(const v of ['99999','contrato privado','ABC','recibo','XYZ','Qual o valor','texto'])assert.ok(!s.includes(v),v)
 assert.equal(Object.hasOwn(r.sinais[0]!,'valor'),false)
})
test('áudio sem conteúdo gera pendência, nunca sinal de intenção',()=>{
 const r=resumirSinaisComerciais([m('[áudio 27s]')],AGORA);assert.equal(r.conteudoPendente,true);assert.deepEqual(r.sinais,[])
})

test('permissão posterior não resolve áudio cujo conteúdo continua desconhecido',()=>{
 const r=resumirSinaisComerciais([m('[áudio 27s]',20),m('Pode mandar',19)],AGORA);assert.equal(r.conteudoPendente,true);assert.ok(r.sinais.every(s=>s.tipo==='material'))
})
