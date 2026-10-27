import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lerTrabalhoRegistrado, trabalhosRegistrados } from './trabalho-registrado.ts'
import { lerEventoCiclo } from '../operations/ciclo-comercial.ts'
import type { CrmLead } from '../operations/types.ts'
const agora = Date.parse('2026-10-26T18:00:00Z')
const trabalho = {v:1,id:'tarefa-1',tipo:'trabalho',data:'2026-10-26',humano:true,referencia:'Cliente de teste',fila:'time',responsavel:'Elisa',tarefa:'Preparar material',resultado:'Material conferido',condicao:'Conferir antes da entrega'}
const texto = (e: unknown) => '[ciclo-comercial-v1] '+JSON.stringify(e)
const nota = (e: unknown, extra = {}) => ({tipo:'nota',origem:'manual',em:'2026-10-26T17:00:00Z',rotulo:'Trabalho',fonte:'CRM',texto:texto(e),...extra}) as CrmLead['eventos'][number]
test('compatibilidade lê trabalho sem promover a evento financeiro nem alterar a fonte', () => {
  const lead={eventos:[nota(trabalho)]}; const antes=JSON.stringify(lead)
  assert.equal(trabalhosRegistrados(lead,agora)[0].responsavel,'Elisa')
  assert.equal(lerEventoCiclo(texto(trabalho),agora),null)
  assert.equal(JSON.stringify(lead),antes)
})
test('rejeita formato inválido, campos extras, calendário impossível e trabalho futuro', () => {
  for (const e of [{...trabalho,humano:false},{...trabalho,data:'2026-02-30'},{...trabalho,data:'2026-10-27'},{...trabalho,fila:'automatico'},{...trabalho,autorizaEnvio:true},{...trabalho,tarefa:''}]) assert.equal(lerTrabalhoRegistrado(texto(e),agora),null)
  assert.equal(lerTrabalhoRegistrado('[ciclo-comercial-v1] {',agora),null)
})
test('nota automática ou registrada no futuro não vira trabalho confirmado', () => {
  assert.deepEqual(trabalhosRegistrados({eventos:[nota(trabalho,{origem:'automático'}),nota(trabalho,{em:'2026-10-27T17:00:00Z'})]},agora),[])
})
test('deduplica registros iguais e descarta identidade reutilizada com conteúdo divergente', () => {
  assert.equal(trabalhosRegistrados({eventos:[nota(trabalho),nota(trabalho)]},agora).length,1)
  assert.deepEqual(trabalhosRegistrados({eventos:[nota(trabalho),nota({...trabalho,tarefa:'Outra tarefa'})]},agora),[])
})
