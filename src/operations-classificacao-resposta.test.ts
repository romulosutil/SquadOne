import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classificarResposta, respostaParaAcompanhamento, resumoDasRespostas, type ClasseDaResposta } from './operations/classificacao-resposta'
import type { CrmLead, CrmResposta } from './operations/types'

const ENVIO = '2026-10-21T11:00:00Z', RESPOSTA = '2026-10-21T11:02:00Z', AGORA = Date.parse('2026-10-22T18:00:00Z')
const resposta = (trecho: string, tipo: CrmResposta['tipo'] = 'interesse'): CrmResposta => ({ tipo, trecho, em: RESPOSTA })
const lead = (r?: CrmResposta, extra: Partial<CrmLead> = {}) => ({ marcos: { enviado: ENVIO }, ...(r ? { resposta: r } : {}), ...extra })
const conversa = (q: string, t: string, papel?: string) => [
  { em: ENVIO, direcao: 'saida' as const, texto: q },
  { em: RESPOSTA, direcao: 'entrada' as const, texto: t, ...(papel ? { papel } : {}) },
]

describe('classificação comercial contextual', () => {
  const casos: Array<[string,string,string,ClasseDaResposta,CrmResposta['tipo']?]> = [
    ['sim ao responsável', 'Consigo falar com o responsável?', 'Sim', 'acesso'],
    ['identidade explícita', '', 'Eu mesmo', 'acesso'],
    ['pode falar não autoriza material', '', 'sou eu, pode falar', 'acesso'],
    ['encaminhamento', '', 'Vou passar para o responsável', 'acesso','neutra'],
    ['sim ao vídeo', 'Posso te mandar o vídeo?', 'Sim', 'permissao'],
    ['pode sim com antecedente', 'Posso te mandar o link?', 'pode sim', 'permissao'],
    ['pode sim sem antecedente', '', 'pode sim', 'pendente'],
    ['permissão explícita', '', 'Pode enviar sim.', 'permissao'],
    ['licença histórica', '', 'Claro, pode enviar sim.', 'permissao','licenca'],
    ['sim sem contexto', '', 'Sim', 'pendente'],
    ['curiosidade', '', 'Interessante, me manda um vídeo desse sistema', 'curiosidade'],
    ['elogio', '', 'Gostei', 'curiosidade'],
    ['pergunta de preço', '', 'Quanto custa?', 'interesse'],
    ['pergunta sobre funcionamento', '', 'Como funciona o sistema?', 'interesse'],
    ['identidade com pergunta comercial', 'Consigo falar com o responsável?', 'Sou eu. Quanto custa?', 'interesse'],
    ['intenção de compra', '', 'Quero contratar', 'interesse'],
    ['negação vence palavra interesse', '', 'Não tenho interesse, obrigado', 'recusa'],
    ['negativa registrada', '', 'Não, obrigado', 'recusa','negativa'],
    ['restrição de exclusão', '', 'Pode excluir o conteúdo', 'exclusao','exclusao'],
    ['timing merece revisão', '', 'Estou no trânsito agora', 'pendente','negativa'],
    ['timing com recusa explícita', '', 'Estou ocupado e não tenho interesse', 'recusa','negativa'],
    ['áudio não ouvido', '', '[áudio 27s]', 'pendente','neutra'],
    ['áudio legado não transcrito', '', '[áudio não transcrito]', 'pendente','neutra'],
    ['saudação humana', '', 'Olá, bom dia', 'neutra','neutra'],
    ['pedido expresso de conversa não é compra', '', '[áudio 19s] Pode montar e agende aí comigo um, um bate-papo, tá?', 'conversa','neutra'],
    ['convite nosso não é pedido do cliente', 'Podemos marcar uma reunião?', 'Vou avaliar com a equipe', 'neutra','neutra'],
    ['recusa prevalece sobre menção de agenda', '', 'Não tenho interesse, não quero marcar uma conversa', 'recusa','neutra'],
  ]
  for (const [nome,q,t,classe,tipo] of casos) it(nome, () => {
    const l = lead(resposta(t,tipo)); const antes = JSON.stringify(l)
    const c = classificarResposta(l,conversa(q,t),AGORA)
    assert.equal(c.classe,classe); assert.equal(JSON.stringify(l),antes,'não altera o histórico')
    assert.equal(c.evidencia?.trecho,t)
  })

  it('saídas e conteúdo anterior ao envio não viram respostas', () => {
    const ms = [...conversa('Quanto custa?', 'Quero contratar')]
    ms[1].em = '2026-10-20T10:00:00Z'
    assert.equal(classificarResposta(lead(),ms,AGORA).classe,'silencio')
    assert.equal(classificarResposta(lead(),[ms[0]],AGORA).classe,'silencio')
  })
  it('ausência de papel não comprova humanidade', () => {
    const c = classificarResposta(lead(),conversa('Oi','Quanto custa?'),AGORA)
    assert.equal(c.classe,'pendente'); assert.equal(c.houveRespostaHumana,false)
  })
  it('papel explícito de robô corrige positivo falso sem alterar fonte', () => {
    const l = lead(resposta('Quanto custa?'))
    const c = classificarResposta(l,conversa('Oi','Quanto custa?','robo'),AGORA)
    assert.equal(c.classe,'robo'); assert.equal(c.houveRespostaHumana,false); assert.equal(l.resposta.tipo,'interesse')
  })
  it('bot posterior não apaga a indicação humana anterior', () => {
    const l = lead(resposta('Quanto custa?'))
    const ms = [...conversa('Oi','Quanto custa?'), { em:'2026-10-22T12:00:00Z', direcao:'entrada' as const, texto:'Mensagem automática', papel:'robo' }]
    const c = classificarResposta(l,ms,AGORA)
    assert.equal(c.classe,'interesse'); assert.equal(c.houveRespostaHumana,true)
  })
  it('entrada posterior ao bot requer revisão, sem presumir humanidade', () => {
    const l = lead(resposta('', 'bot'))
    const ms = [...conversa('Oi','Mensagem automática','robo'), { em:'2026-10-22T12:00:00Z', direcao:'entrada' as const, texto:'Vou encaminhar o responsável' }]
    const c = classificarResposta(l,ms,AGORA)
    assert.equal(c.classe,'pendente'); assert.equal(c.revisar,true); assert.equal(c.houveRespostaHumana,false)
  })
  it('recibo só divide o silêncio, nunca prova intenção', () => {
    const sem = classificarResposta(lead(),undefined,AGORA)
    const com = classificarResposta(lead(undefined,{ marcos:{ enviado:ENVIO,visto:RESPOSTA } }),undefined,AGORA)
    assert.equal(sem.classe,'silencio'); assert.equal(com.classe,'silencio')
    assert.equal(sem.leituraConfirmada,false); assert.equal(com.leituraConfirmada,true)
  })
  it('saudação automática com horário e preço não vira pergunta comercial', () => {
    const ms = [{em:'2026-10-21T11:02:04Z',direcao:'entrada' as const,texto:'AF ADVOCACIA agradece seu contato. Como podemos ajudar? Horário de atendimento das 9 às 18h. Valor da consulta R$ 100,00'}]
    const c = classificarResposta(lead(resposta('', 'bot')),ms,AGORA)
    assert.equal(c.classe,'robo'); assert.equal(c.houveRespostaHumana,false)
  })
  it('cartão complementa encaminhamento recente, sem apagar a fala', () => {
    const ms = [...conversa('Consigo falar com quem coordena?','Claro irei te encaminhar o contato do responsavel.'),{em:'2026-10-21T11:02:13Z',direcao:'entrada' as const,texto:'[contato]'}]
    const c = classificarResposta(lead(resposta('Claro irei te encaminhar o contato do responsavel.','neutra')),ms,AGORA)
    assert.equal(c.classe,'acesso'); assert.match(c.evidencia!.trecho,/encaminhar/)
    ms[2]!.em = '2026-10-22T11:00:00Z'
    assert.equal(classificarResposta(lead(resposta('Claro irei te encaminhar o contato do responsavel.','neutra')),ms,AGORA).classe,'neutra','cartão de outro dia não reutiliza encaminhamento antigo')
  })
  it('marco incompatível e ausência de envio ficam explícitos', () => {
    assert.equal(classificarResposta({marcos:{}},undefined,AGORA).classe,'nao-contatado')
    assert.equal(classificarResposta({marcos:{enviado:ENVIO,respondeu:'2026-10-20T10:00:00Z'}},undefined,AGORA).classe,'pendente')
  })
  it('a última pergunta é a anterior à entrada, não a nossa cobrança posterior', () => {
    const ms = [...conversa('Consigo falar com o responsável?','Sim'), {em:'2026-10-22T12:00:00Z',direcao:'saida' as const,texto:'Posso enviar o vídeo?'}]
    assert.equal(classificarResposta(lead(resposta('Sim')),ms,AGORA).classe,'acesso')
  })
  it('releitura usa a fonte preservada e não o tipo operacional rebaixado', () => {
    const l = lead(resposta('Sim'));const ms=conversa('Posso enviar o vídeo?','Sim')
    const c=classificarResposta(l,ms,AGORA)
    const efetiva=respostaParaAcompanhamento(l.resposta,c)
    assert.equal(efetiva?.tipo,'licenca');assert.equal(l.resposta.tipo,'interesse')
    assert.deepEqual(classificarResposta({...l,resposta:efetiva,respostaFonte:l.resposta},ms,AGORA),c)
    const negativa=resposta('Não, obrigado','negativa')
    assert.equal(respostaParaAcompanhamento(negativa,{...c,classe:'permissao'}),negativa,'nunca reabre a recusa')
  })
  it('resumo particiona só enviados, ignora futuros e separa leituras', () => {
    const ls=[lead(),lead(undefined,{marcos:{enviado:ENVIO,visto:RESPOSTA}}),lead(resposta('Quanto custa?')),lead(resposta('Pode mandar','licenca')),lead(resposta('','bot')),lead(undefined,{marcos:{}}),lead(undefined,{marcos:{enviado:'2027-01-01T12:00:00Z'}})]
    const r=resumoDasRespostas(ls,AGORA)
    assert.equal(r.enviados,5);assert.equal(Object.values(r.classes).reduce((a,b)=>a+b,0),5)
    assert.equal(r.classes.interesse,1);assert.equal(r.classes.permissao,1);assert.equal(r.classes.robo,1)
    assert.equal(r.leituraSemResposta,1);assert.equal(r.semLeituraSemResposta,1)
  })
})
