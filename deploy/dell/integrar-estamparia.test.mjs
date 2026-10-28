import assert from 'node:assert/strict'
import { test } from 'node:test'
import { integrarEstamparia } from './integrar-estamparia.mjs'
const host=[
  '// Conteúdo anterior preservado',
  '    autorizarMaterialEncontrado=id=>encontradoAutomatico.autorizarMaterial(id);',
  'await encontradoAutomatico.executar();',
  '      const automaticos = await encontradoAutomatico.estados().catch(()=>new Map());',
  'const auto=automaticos.get(l.id);',
  'id:`encontrado-${l.id}`',
  "titulo:auto.acao==='time'?'Time conduz o atendimento do Encontrado':'Decisão necessária no Encontrado'",
  'motivo:auto.motivo,alvo:auto.acao',
  "    app.get('/api/operations/crm/encontrado/automacao'",
].join('\n')
test('acrescenta Estamparia sem remover executor, materiais ou resumo do Site',()=>{
  const integrado=integrarEstamparia(host)
  for(const s of ['// Conteúdo anterior preservado','encontradoAutomatico.executar()','estampariaAutomatico.executar()','encontradoAutomatico.autorizarMaterial(id)','/crm/encontrado/automacao','/crm/estamparia/automacao','conferirIdentidadeCaptura','comConversaExclusiva'])assert.ok(integrado.includes(s),s)
  assert.equal(integrarEstamparia(integrado),integrado)
})
test('host alterado ou integração parcial exige revisão antes de escrever',()=>{
  assert.throws(()=>integrarEstamparia('servidor antigo'),/host/)
  assert.throws(()=>integrarEstamparia(host+'\n'+host),/host/)
  assert.throws(()=>integrarEstamparia('// atendimento-estamparia-v1'),/parcial/)
})
