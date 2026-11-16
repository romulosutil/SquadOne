import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classificarResposta, respostaParaAcompanhamento, resumoDasRespostas, type ClasseDaResposta } from './operations/classificacao-resposta'
import type { CrmLead, CrmResposta } from './operations/types'
import { mensagemDoConvite } from '../server/convite-mensagem.ts'
import { primeiraDoPlus } from '../server/plus-mensagem.ts'

const ENVIO = '2026-10-21T11:00:00Z', RESPOSTA = '2026-10-21T11:02:00Z', AGORA = Date.parse('2026-10-22T18:00:00Z')
const resposta = (trecho: string, tipo: CrmResposta['tipo'] = 'interesse'): CrmResposta => ({ tipo, trecho, em: RESPOSTA })
const lead = (r?: CrmResposta, extra: Partial<CrmLead> = {}) => ({ marcos: { enviado: ENVIO }, ...(r ? { resposta: r } : {}), ...extra })
const conversa = (q: string, t: string, papel?: string) => [
  { em: ENVIO, direcao: 'saida' as const, texto: q },
  { em: RESPOSTA, direcao: 'entrada' as const, texto: t, ...(papel ? { papel } : {}) },
]

describe('classificação comercial contextual', () => {
  it('sim à oferta de exemplo é permissão, sem presumir decisor ou interesse comercial', () => {
    const agora = new Date(ENVIO)
    for (const produto of ['iris', 'estampa'] as const) {
      for (const q of [mensagemDoConvite(produto, 'Empresa Teste', '', agora), primeiraDoPlus({ empresa: 'Empresa Teste', oferta: produto, whatsapp: '5527999990001' }).texto]) {
        const c = classificarResposta(lead(resposta('Sim', 'neutra')), conversa(q, 'Sim'), AGORA)
        assert.equal(c.classe, 'permissao')
        assert.equal(c.materialSolicitado, true)
      }
    }
    for (const oferta of ['site', 'prumo'] as const) {
      const q = primeiraDoPlus({ empresa: 'Empresa Teste', oferta, whatsapp: '5527999990001' }).texto
      const c = classificarResposta(lead(resposta('Sim', 'neutra')), conversa(q, 'Sim'), AGORA)
      assert.equal(c.classe, 'permissao')
      assert.equal(c.materialSolicitado, true)
    }
    const q = mensagemDoConvite('prumo', 'Empresa Teste', '', agora)
    assert.equal(classificarResposta(lead(resposta('Sim', 'neutra')), conversa(q, 'Sim'), AGORA).classe, 'permissao')
  })
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
    ['troca de sistema', '', 'Já tenho um sistema, mas quero contratar outro', 'interesse'],
    ['troca de fornecedor', '', 'Já temos sistema, queremos trocar de fornecedor', 'interesse'],
    ['avaliação de alternativa', '', 'Já tenho uma agência, mas gostaria de mudar', 'interesse'],
    ['pergunta sobre alternativa', '', 'Já tenho um sistema. Quanto custa o de vocês?', 'interesse'],
    ['fornecedor sem abertura', '', 'Já tenho um sistema', 'recusa'],
    ['recusa explícita com troca', '', 'Não quero trocar meu sistema, obrigado', 'recusa'],
    ['negativa incorreta preserva divergência', '', 'Já tenho um sistema, mas quero contratar outro', 'interesse','negativa'],
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
  it('ok posterior preserva evidência do interesse sem confirmar compra nem proposta', () => {
    const ms = [...conversa('Posso ajudar?', 'Tenho interesse em contratar'),
      { em:'2026-10-22T11:00:00Z',direcao:'saida' as const,texto:'Vou esclarecer o escopo com você.' },
      { em:'2026-10-22T11:01:00Z',direcao:'entrada' as const,texto:'Ok' }]
    const c = classificarResposta(lead(resposta('Tenho interesse em contratar')),ms,AGORA)
    assert.equal(c.classe,'neutra')
    assert.equal(c.interesseHistorico?.trecho,'Tenho interesse em contratar')
    assert.equal(c.evidencia?.trecho,'Ok')
    assert.equal(c.materialSolicitado,false)
    ms[3]!.texto = 'Não tenho interesse'
    const recusou = classificarResposta(lead(resposta('Tenho interesse em contratar')),ms,AGORA)
    assert.equal(recusou.classe,'recusa')
    assert.ok(recusou.interesseHistorico)
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
  it('agradecimento posterior não apaga recusa explícita recuperada no histórico', () => {
    const ms=[...conversa('Podemos conversar?','infelizmente não estamos interessado tá'),
      {em:'2026-10-21T11:02:30Z',direcao:'saida' as const,texto:'Obrigado pelo retorno'},
      {em:'2026-10-21T11:02:40Z',direcao:'entrada' as const,texto:'de nadaa'}]
    const l=lead({...resposta('de nadaa','neutra'),em:ms[3].em})
    const c=classificarResposta(l,ms,AGORA)
    assert.equal(c.classe,'recusa');assert.match(c.evidencia?.trecho??'',/não estamos interessado/)
    assert.equal(c.materialSolicitado,false)
    assert.equal(respostaParaAcompanhamento(l.resposta,c)?.tipo,'negativa')
    assert.equal(classificarResposta(lead(resposta('Não','neutra')),conversa('Vocês usam CRM?','Não'),AGORA).classe,'neutra')
  })
  it('contato de loja indicado pelo shopping é encaminhamento, sem presumir interesse',()=>{
    const texto='BORDADOS EXEMPLO\n43 99999-0000 | TÉRREO'
    const ms=[...conversa('Consigo falar com o responsável?','Obrigado por entrar em contato com o Shopping Exemplo'),
      {em:'2026-10-21T11:10:00Z',direcao:'entrada' as const,texto}]
    const c=classificarResposta(lead({...resposta(texto,'neutra'),em:ms[2].em}),ms,AGORA)
    assert.equal(c.classe,'acesso');assert.equal(c.materialSolicitado,false)
  })
  it('saudações do lote não viram resposta humana mesmo com rótulo legado incorreto',()=>{
    for(const texto of [
      'Empresa Exemplo agradece seu contato. Como podemos ajudar?',
      'Olá! Seja bem vindo (a). Qual produto deseja? Qual quantidade? Qual data de entrega?',
      'Olá, seja muito bem vindo à empresa. Trabalhamos com uma diversidade de materiais!',
      'A empresa agradece sua preferência. Nosso horário de funcionamento é de Segunda a sexta. Assim que nossa equipe estiver disponível, retornaremos seu contato.',
      'Entraremos em contato. Horário comercial de: Seg. a Sexta 9 às 18h',
      '*1/3* Olá, seja bem-vindo(a). Escolha uma das opções abaixo: 1 - Quero fazer um orçamento',
    ])for(const tipo of ['interesse','licenca','neutra'] as const) {
      const l=lead(resposta(texto,tipo)),antes=JSON.stringify(l)
      const c=classificarResposta(l,conversa('Consigo falar com o responsável?',texto,'gente'),AGORA)
      assert.equal(c.classe,'robo',texto);assert.equal(c.houveRespostaHumana,false,texto)
      assert.equal(respostaParaAcompanhamento(l.resposta,c)?.tipo,'bot',texto)
      assert.equal(JSON.stringify(l),antes)
    }
  })
  it('robô anterior não apaga o acesso humano posterior da Stamp Fast',()=>{
    const ms=[...conversa('Consigo falar com o responsável?','Olá, seja muito bem vindo à empresa!'),
      {em:'2026-10-21T11:20:00Z',direcao:'entrada' as const,texto:'Pode falar por aqui sim!'}]
    const c=classificarResposta(lead({...resposta(ms[2].texto,'neutra'),em:ms[2].em}),ms,AGORA)
    assert.equal(c.classe,'acesso');assert.equal(c.houveRespostaHumana,true);assert.equal(c.materialSolicitado,false)
  })
  it('agradecimento com resposta específica não vira robô nem apaga a recusa da fonte',()=>{
    for(const texto of [
      '*Atendente Exemplo*\nBom dia! Agradecemos o contato, contudo já possuímos nosso próprio sistema.',
      'Agradecemos o contato, mas não oferecemos atendimento; somos uma instituição educacional de formação profissional.',
      'Olá Rômulo! Agradecemos o contato! Mas utilizamos um sistema criado pelo nosso diretor e desenvolvedor.',
    ]) {
      const c=classificarResposta(lead(resposta(texto,'negativa')),conversa('Posso apresentar o sistema?',texto),AGORA)
      assert.equal(c.classe,'recusa',texto);assert.equal(c.houveRespostaHumana,true,texto)
    }
  })
  it('assinatura de atendente e agradecimento posterior preservam a recusa',()=>{
    const ms=[...conversa('Posso apresentar o serviço?','*Secretária Geral*:\nNão temos interesse no momento'),
      {em:'2026-10-21T11:02:01Z',direcao:'entrada' as const,texto:'*Secretária Geral*:\nObrigada'}]
    const c=classificarResposta(lead({...resposta(ms[2].texto,'neutra'),em:ms[2].em}),ms,AGORA)
    assert.equal(c.classe,'recusa');assert.match(c.evidencia?.trecho??'',/Não temos interesse/)
    assert.equal(respostaParaAcompanhamento(resposta(ms[2].texto,'neutra'),c)?.tipo,'negativa')
  })
  it('por nada após encaminhamento não apaga a indicação nem autoriza abordar outro contato',()=>{
    for(const texto of ['Boa tarde, segue o contato','Contato dele 27 99999-0000','Ele é a pessoa que cuida da divulgação da empresa.']) {
      const ms=[...conversa('Quem cuida da empresa?',texto),{em:'2026-10-21T11:10:00Z',direcao:'entrada' as const,texto:'Por nada'}]
      const c=classificarResposta(lead({...resposta('Por nada','neutra'),em:ms[2].em}),ms,AGORA)
      assert.equal(c.classe,'acesso',texto);assert.equal(c.materialSolicitado,false)
    }
  })
  it('destinatário errado permanece em conferência depois de um ok',()=>{
    const ms=[...conversa('Falo com a empresa?','[áudio 22s] Não tenho nada a ver com essa empresa. Tem alguma coisa errada no número.'),
      {em:'2026-10-21T11:03:00Z',direcao:'entrada' as const,texto:'Ok'}]
    const c=classificarResposta(lead({...resposta('Ok','neutra'),em:ms[2].em}),ms,AGORA)
    assert.equal(c.classe,'pendente');assert.equal(c.revisar,true);assert.match(c.evidencia?.trecho??'',/errada no número/)
    assert.equal(c.materialSolicitado,false)
    assert.equal(classificarResposta(lead(resposta('Não sou o responsável pela empresa','neutra')),conversa('Quem decide?','Não sou o responsável pela empresa'),AGORA).revisar,false)
  })
  it('agradecimento ou telefone encaminhado não confirmam uma negativa antiga contraditória',()=>{
    for(const texto of ['agradecemos o contato.','Centro Exemplo – Fone: (48) 33810000 Ramal 6966']) {
      const r=resposta(texto,'negativa'),c=classificarResposta(lead(r),conversa('Com quem falo?',texto),AGORA)
      assert.equal(c.classe,'pendente',texto);assert.equal(c.revisar,true)
      assert.equal(respostaParaAcompanhamento(r,c),r,'preserva a restrição até revisão, sem reabrir contato')
    }
  })
  it('trecho sem histórico conserva encaminhamento de marketing e pedido de exclusão de conteúdo',()=>{
    const texto='Para fazer parcerias com nosso time de marketing é necessário apresentar seu portfólio enviando para nosso e-mail marketing@example.com'
    const encaminhou=classificarResposta(lead(resposta(texto,'neutra')),undefined,AGORA)
    assert.equal(encaminhou.classe,'acesso');assert.equal(encaminhou.materialSolicitado,false)
    const r=resposta('Já temos uma agência, se puder excluir esse conteúdo por gentileza','negativa')
    const excluir=classificarResposta(lead(r),undefined,AGORA)
    assert.equal(excluir.classe,'exclusao');assert.equal(respostaParaAcompanhamento(r,excluir),r)
  })
  it('resumo particiona só enviados, ignora futuros e separa leituras', () => {
    const ls=[lead(),lead(undefined,{marcos:{enviado:ENVIO,visto:RESPOSTA}}),lead(resposta('Quanto custa?')),lead(resposta('Pode mandar','licenca')),lead(resposta('','bot')),lead(undefined,{marcos:{}}),lead(undefined,{marcos:{enviado:'2027-01-01T12:00:00Z'}})]
    const r=resumoDasRespostas(ls,AGORA)
    assert.equal(r.enviados,5);assert.equal(Object.values(r.classes).reduce((a,b)=>a+b,0),5)
    assert.equal(r.classes.interesse,1);assert.equal(r.classes.permissao,1);assert.equal(r.classes.robo,1)
    assert.equal(r.leituraSemResposta,1);assert.equal(r.semLeituraSemResposta,1)
  })
})
