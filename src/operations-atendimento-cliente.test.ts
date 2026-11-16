import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orientacaoDoAtendimento } from './operations/atendimento-cliente'
import { classificarResposta } from './operations/classificacao-resposta'
import { itemDaFilaComercial } from './operations/fila-comercial'
import { textoEventoCiclo } from './operations/ciclo-comercial'
import { orientaContato } from './office/orientacao-da-conversa'
import { LEAD_DE_EXEMPLO } from './blueprint/exemplo'
import { enderecoDeVendas, lerEnderecoDeVendas } from './operations/vendas-abas'
import type { CrmLead } from './operations/types'

const agora = Date.parse('2026-10-25T15:00:00Z')
function cliente(): CrmLead {
  const l = { ...structuredClone(LEAD_DE_EXEMPLO), eventos: [], links: { whatsapp: 'https://wa.me/5511999990001' }, marcos: { enviado: '2026-10-25T14:00:00Z' },
    resposta: { tipo: 'interesse', trecho: 'Pode mandar o link.', em: '2026-10-25T14:05:00Z' },
    conversa: { desde:'2026-10-25T14:00:00Z',mensagens:2,ultimaEntrada:'2026-10-25T14:05:00Z',ultima:{direcao:'entrada',trecho:'Pode mandar o link.',em:'2026-10-25T14:05:00Z'},recentes:[{direcao:'saida',trecho:'Posso enviar a demonstração?',em:'2026-10-25T14:00:00Z'},{direcao:'entrada',trecho:'Pode mandar o link.',em:'2026-10-25T14:05:00Z'}] },
  } as CrmLead
  l.classificacaoResposta = classificarResposta(l)
  return l
}
test('a orientação mantém ação, responsável e resultado da fila comercial', () => {
  const l=cliente(), item=itemDaFilaComercial(l,[l],agora)!, a=orientacaoDoAtendimento(l,[l],agora)
  assert.equal(a.plano.acao,item.acao)
  assert.equal(a.plano.responsavel,item.responsavel)
  assert.equal(a.plano.resultado,item.resultado)
  assert.equal(a.estado,'agora')
  assert.equal(orientaContato(l,a.plano),true)
})
for(const fila of ['time','voce'] as const) test(`trabalho registrado para ${fila} preserva tarefa e não vira mensagem ao cliente`,()=>{
  const l=cliente()
  l.eventos=[{tipo:'nota',rotulo:'Trabalho',em:'2026-10-25T14:10:00Z',origem:'manual',fonte:'teste',texto:textoEventoCiclo({v:1,id:'tarefa-teste',tipo:'trabalho',data:'2026-10-25',humano:true,referencia:'tarefa',fila,responsavel:fila==='time'?'Elisa':'Rômulo',tarefa:'Conferir a demonstração prometida',condicao:'Material aprovado',resultado:'Entrega conferida'},agora)}]
  const a=orientacaoDoAtendimento(l,[l],agora)
  assert.equal(a.plano.acao,'Conferir a demonstração prometida')
  assert.equal(a.procedimento.tipo,'interno')
  assert.equal(a.plano.tipo,fila==='time'?'aguardar':'conferir')
  assert.equal(orientaContato(l,a.plano),false)
})
test('espera e desfecho não são reabertos por uma orientação de atendimento',()=>{
  const l=cliente(); l.proximoPasso={texto:'Aguardar a avaliação na data combinada',data:'2026-10-26',registradoEm:'2026-10-25T14:10:00Z'}
  assert.equal(orientacaoDoAtendimento(l,[l],agora).estado,'acompanhando')
  l.etapa='perdido'
  const encerrado=orientacaoDoAtendimento(l,[l],agora)
  assert.equal(encerrado.estado,'encerrada')
  assert.equal(orientaContato(l,encerrado.plano),false)
})
test('endereço conserva cliente, oferta, recorte e modo ao trocar entre ficha e orientação',()=>{
  for(const detalhe of ['ficha','orientacao'] as const) {
    const url=enderecoDeVendas({vista:'funil',produto:'site',passo:'conversa',lead:'site:exemplo com espaço',detalhe})
    const e=lerEnderecoDeVendas(new URL(url,'https://example.com').search)
    assert.equal(e.tipo,'vendas')
    if(e.tipo==='vendas') { assert.equal(e.lead,'site:exemplo com espaço'); assert.equal(e.detalhe,detalhe); assert.equal(e.produto,'site');assert.equal(e.passo,'conversa') }
  }
  assert.equal(enderecoDeVendas({vista:'afazer',detalhe:'ficha'}),'/crm')
  const semCliente=lerEnderecoDeVendas('?detalhe=ficha')
  assert.equal(semCliente.tipo==='vendas'&&semCliente.detalhe,undefined)
})
