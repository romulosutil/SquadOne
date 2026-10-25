import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orientacaoDoAtendimento } from './operations/atendimento-cliente'
import { classificarResposta } from './operations/classificacao-resposta'
import { planoDoLead } from './operations/bi-operacao'
import { orientaContato } from './office/orientacao-da-conversa'
import { LEAD_DE_EXEMPLO } from './blueprint/exemplo'
import { enderecoDeVendas, lerEnderecoDeVendas } from './operations/vendas-abas'
import type { CrmLead } from './operations/types'

const agora = Date.parse('2026-10-25T15:00:00Z')
function cliente(): CrmLead {
  const l = { ...structuredClone(LEAD_DE_EXEMPLO), eventos: [], marcos: { enviado: '2026-10-25T14:00:00Z' },
    resposta: { tipo: 'interesse', trecho: 'Pode mandar o link.', em: '2026-10-25T14:05:00Z' },
    conversa: { desde:'2026-10-25T14:00:00Z',mensagens:2,ultimaEntrada:'2026-10-25T14:05:00Z',ultima:{direcao:'entrada',trecho:'Pode mandar o link.',em:'2026-10-25T14:05:00Z'},recentes:[{direcao:'saida',trecho:'Posso enviar a demonstração?',em:'2026-10-25T14:00:00Z'},{direcao:'entrada',trecho:'Pode mandar o link.',em:'2026-10-25T14:05:00Z'}] },
  } as CrmLead
  l.classificacaoResposta = classificarResposta(l)
  return l
}
test('a orientação apresenta o plano comercial vigente sem trocar sua tarefa ou responsável', () => {
  const l=cliente(), p=planoDoLead(l,agora), a=orientacaoDoAtendimento(l,[l],agora)
  assert.deepEqual(a.plano,p)
})
test('tarefa comercial interna mantém conferência e não prepara contato com o cliente',()=>{
  const l=cliente()
  l.atendimentoComercial={id:'tarefa-teste',tipo:'conferir',titulo:'Conferir o material combinado',motivo:'Conferência interna pendente',alvo:'material',estado:'pendente'}
  const a=orientacaoDoAtendimento(l,[l],agora)
  assert.equal(a.procedimento.tipo,'interno')
  assert.equal(a.plano.tipo,'conferir')
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
