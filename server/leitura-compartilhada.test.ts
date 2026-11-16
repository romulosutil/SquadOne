import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compartilharLeitura } from './leitura-compartilhada.ts'
test('clientes simultâneos compartilham uma projeção, sem executar de novo a fonte',async()=>{
  let chamadas=0,concluir!:(valor:number)=>void
  const ler=compartilharLeitura(()=>{chamadas++;return new Promise<number>(r=>{concluir=r})})
  const a=ler(),b=ler();await Promise.resolve();assert.equal(chamadas,1)
  concluir(7);assert.deepEqual(await Promise.all([a,b]),[7,7]);assert.equal(await ler(),7);assert.equal(chamadas,1)
})
test('nova leitura após o prazo não reutiliza a projeção antiga',async()=>{
  let em=0,chamadas=0
  const ler=compartilharLeitura(async()=>++chamadas,5000,()=>em)
  assert.equal(await ler(),1);em=5000;assert.equal(await ler(),2)
})
test('falha não vira cache e a próxima consulta pode se recuperar',async()=>{
  let chamadas=0
  const ler=compartilharLeitura(async()=>{if(++chamadas===1)throw new Error('indisponível');return 'ok'})
  await assert.rejects(ler(),/indisponível/);assert.equal(await ler(),'ok')
})
test('invalidar durante uma leitura impede que a projeção antiga seja guardada',async()=>{
  let chamadas=0,concluir!:(valor:number)=>void
  const ler=compartilharLeitura(()=>{chamadas++;return chamadas===1?new Promise<number>(r=>{concluir=r}):Promise.resolve(2)})
  const a=ler();await Promise.resolve();ler.invalidar();concluir(1);await a
  assert.equal(await ler(),2)
})
