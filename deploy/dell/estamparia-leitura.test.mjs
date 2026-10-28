import {test} from 'node:test'
import assert from 'node:assert/strict'
import {integrarLeituraEstamparia} from './estamparia-leitura.mjs'
const servidor='const automaticosEstamparia = await estampariaAutomatico.estados().catch(()=>new Map());'
const atendimento='async contextoDaEntrada(chave: string) {\n    const visao = await this.deps.visao()\n    return { registro, fonte, conferencia, visao }\n}'
test('somente a leitura da tela recebe visão; o contrato padrão continua lendo fonte atual',()=>{const r=integrarLeituraEstamparia(servidor,atendimento);assert.match(r.servidor,/estados\(v\)/);assert.match(r.atendimento,/visaoFornecida \?\? await this.deps.visao\(\)/);assert.deepEqual(integrarLeituraEstamparia(r.servidor,r.atendimento),r)})
test('host diferente ou parcialmente integrado não recebe substituição por aproximação',()=>{assert.throws(()=>integrarLeituraEstamparia('outra leitura',atendimento));assert.throws(()=>integrarLeituraEstamparia(servidor,'atendimento diferente'))})
