import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { montarCrm, validarRetrato } from './crm'
import { chaveDoNumero, type MensagemDaConversa } from './conversa-do-lead'
import { quisVer } from '../src/operations/resultados'
import { resumoDasRespostas } from '../src/operations/classificacao-resposta'

const agora=new Date('2026-10-22T12:00:00Z'), enviado='2026-10-21T11:00:00Z', em='2026-10-21T11:02:00Z'
function montar(pergunta: string, resposta: string, tipo='interesse', etapa='Em conversa') {
  const retrato=validarRetrato({versao:1,geradoEm:agora.toISOString(),links:{},fontes:{
    iris:{aba:'Clínicas',linhas:[{ID:'SINTETICO',Empresa:'Clínica de teste',WhatsApp:'(27) 99999-0001',Etapa:etapa,
      'Convite enviado em':enviado,'Respondeu em':em,'Tipo da resposta':tipo,Resposta:resposta,'Resposta em':em}]},
    registros:{aba:'CRM',linhas:[]},
  }})
  const antes=JSON.stringify(retrato)
  const mensagens: MensagemDaConversa[]=[{em:enviado,direcao:'saida',texto:pergunta},{em,direcao:'entrada',texto:resposta}]
  const v=montarCrm(retrato,{agora,conversas:new Map([[chaveDoNumero('5527999990001'),mensagens]])})
  assert.equal(JSON.stringify(retrato),antes,'a leitura não grava/reclassifica a fonte')
  return {v,l:v.leads.find(l=>l.id==='iris:SINTETICO')!}
}
describe('CRM usa evidência contextual sem reescrever a origem',()=>{
  it('sim ao responsável não mantém pedido de demonstração nem aumenta interesse',()=>{
    const {l,v}=montar('Consigo falar com quem coordena a clínica?','Sim')
    assert.equal(l.classificacaoResposta?.classe,'acesso')
    assert.equal(l.resposta?.tipo,'neutra');assert.equal(l.respostaFonte?.tipo,'interesse')
    assert.equal(l.interesseParado,undefined);assert.equal(quisVer(l as never),false)
    assert.ok(l.eventos.some(e=>e.tipo==='resposta'&&e.texto==='Sim'&&e.fonte?.includes('planilha')))
    const r=resumoDasRespostas(v.leads,agora.getTime())
    assert.equal(r.classes.acesso,1);assert.equal(r.classes.interesse,0)
  })
  it('permissão continua no passo do material, separada do interesse real',()=>{
    const {l}=montar('Posso enviar o vídeo?','Sim')
    assert.equal(l.classificacaoResposta?.classe,'permissao');assert.equal(l.resposta?.tipo,'licenca')
    assert.equal(quisVer(l as never),true)
    assert.equal(resumoDasRespostas([l],agora.getTime()).classes.interesse,0)
  })
  it('pergunta comercial explícita conta separadamente, sem confirmar proposta',()=>{
    const {l}=montar('Consigo falar com o responsável?','Eu mesmo. Quanto custa?')
    assert.equal(l.classificacaoResposta?.classe,'interesse');assert.equal(l.etapa,'contato')
    assert.equal(l.proposta,undefined);assert.equal(l.aarr?.pagamentos.length,0)
  })
  it('leitura não reabre perda nem altera exclusão ou condição de contato',()=>{
    const {l}=montar('Posso enviar o vídeo?','Pode enviar','licenca','Sem interesse')
    assert.equal(l.etapa,'perdido');assert.equal(l.motivoPerda,'sem-interesse')
  })
})
