import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { CrmStore, montarCrm, validarRetrato, validarRegistro } from './crm'
import { textoEventoCiclo, type EventoCiclo } from '../src/operations/ciclo-comercial'
import { qualificacaoComercialVazia, textoDaQualificacaoComercial } from '../src/operations/qualificacao-comercial'
import { leituraAarr, textoDoRegistroReceita, opcoesDeterministicasDeReceita } from '../src/operations/aarr'
const AGORA = new Date('2026-10-23T21:00:00Z')
const qual = () => textoDaQualificacaoComercial({ ...qualificacaoComercialVazia(AGORA.getTime()), id:'q-teste', necessidade:'Aumentar pedidos', adequacao:{estado:'confirmada',oferta:'anuncios',motivo:'Gestão de campanhas'}, intencao:'avaliar', decisao:'Dona e sócio avaliam', proximoPasso:{descricao:'Receber proposta de gestão',aceito:true}, fonte:'WhatsApp 23/10', evidencia:'Queremos proposta para avaliar.' }, AGORA.getTime())
const evento = (tipo: EventoCiclo['tipo'], id: string, campos: Partial<EventoCiclo> = {}): EventoCiclo => ({v:1,id,tipo,data:'2026-10-23',humano:true,referencia:id,...campos})
const proposta = evento('proposta','prop-001',{ofertaId:'anuncios',versao:1,escopo:'Gestão de uma plataforma, verba à parte',prazo:'Início após acessos',condicoes:'Mensal, verba dos anúncios paga pelo cliente',responsavel:'Rômulo',valor:0,mensalidade:50000})
const enviado = evento('proposta_enviada','env-001',{vinculo:proposta.id,evidencia:'Mensagem enviada, conferida pelo operador'})
const aceite = evento('aceite','ace-001',{vinculo:proposta.id,evidencia:'Aceite da versão 1',documento:'DOC-TESTE-v1'})
const condicao = evento('condicao_cobranca','cond-001',{vinculo:aceite.id,evidencia:'Condição no documento aceito',componente:'mensal',valor:50000,gatilho:'aceite',condicao:'Mensalidade da gestão',vigenciaInicio:'2026-10-23'})
const cobranca = evento('cobranca','cob-001',{vinculo:condicao.id,evidencia:'Cobrança emitida à mão',componente:'mensal',valor:50000,competencia:'2026-10',forma:'Pix verificado pelo operador',vencimento:'2026-10-25'})
const pagamento = (id:string,valor:number) => evento('pagamento',id,{vinculo:cobranca.id,evidencia:'Recebimento conferido',componente:'mensal',competencia:'2026-10',valor})
const nota = (texto:string) => ({produto:'site',id:'LEAD-TESTE',tipo:'nota',texto,data:''})
const linha = (texto:string) => ({...nota(texto),em:AGORA.toISOString()})
const retrato = (linhas: Record<string,string>[] = []) => ({versao:1,geradoEm:AGORA.toISOString(),fontes:{site:{linhas:[{place_id:'LEAD-TESTE',nome:'Empresa fixture',status:'enviado',enviado_em:'2026-10-22T15:00:00Z'}]},prumo:{linhas:[]},iris:{linhas:[]},estampa:{linhas:[]},registros:{linhas}}})
const texto = (e:EventoCiclo) => textoEventoCiclo(e,AGORA.getTime())
function ler(linhas:Record<string,string>[]) { return montarCrm(validarRetrato(retrato(linhas)),{agora:AGORA}) }
async function fixture(run:(f:{store:CrmStore;linhas:Record<string,string>[];salvar:()=>Promise<void>;escritas:()=>number;novo:()=>CrmStore})=>Promise<void>, atrasar = false) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crm-ciclo-'))
  try {
    const linhas:Record<string,string>[]=[];let n=0
    const arquivo=path.join(dir,'crm.json'), segredo=path.join(dir,'segredo')
    await fs.writeFile(segredo,'somente-fixture')
    const salvar=()=>fs.writeFile(arquivo,JSON.stringify(retrato(linhas)))
    await salvar()
    const novo=()=>new CrmStore({retrato:arquivo,segredoArquivo:segredo,registroUrl:'http://127.0.0.1:5679/fixture'},async (_url,init)=>{
      n++; if(!atrasar){linhas.push({...JSON.parse(String(init!.body)),em:AGORA.toISOString()});await salvar()}
      return new Response(JSON.stringify({ok:true,em:AGORA.toISOString()}),{status:200})
    })
    await run({store:novo(),linhas,salvar,escritas:()=>n,novo})
  }finally{await fs.rm(dir,{recursive:true,force:true})}
}
test('fronteira não trunca nem limpa notas estruturadas inválidas',()=>{
  const t=texto(proposta)
  assert.equal(validarRegistro(nota(t),AGORA).texto,t)
  for(const invalido of [t+' '.repeat(1000),t.replace('"humano":true','"humano":false'),t.replace('2026-10-23','2026-10-24'),' '+t]) assert.throws(()=>validarRegistro(nota(invalido),AGORA))
})
test('projeção une qualificação, proposta exata e recebimento parcial sem receita de rascunho/aceite',()=>{
  const linhas=[linha(qual()),... [proposta,enviado,aceite,condicao,cobranca].map(e=>linha(texto(e)))]
  let v=ler(linhas),l=v.leads[0]!
  assert.equal(l.qualificacaoComercial!.adequacao.oferta,'anuncios');assert.equal(l.etapa,'proposta')
  assert.equal(l.aarr!.pagamentos.length,0);assert.equal(l.aarr!.propostas.find(p=>p.componente==='mensalidade')!.valor_centavos,50000)
  linhas.push(linha(texto(pagamento('pag-001',20000))))
  l=ler(linhas).leads[0]!
  assert.equal(l.aarr!.pagamentos[0]!.valor_centavos,20000)
  assert.equal(leituraAarr([l],AGORA.getTime()).receita.valorCentavos,20000)
  linhas.push(linha(texto(pagamento('pag-002',30000))))
  l=ler(linhas).leads[0]!;assert.equal(leituraAarr([l],AGORA.getTime()).receita.valorCentavos,50000)
  linhas.push(linha(texto(evento('correcao','corr-001',{vinculo:'pag-002',evidencia:'Valor registrado por engano'}))))
  assert.equal(ler(linhas).leads[0]!.aarr!.pagamentos.reduce((n,p)=>n+p.valor_centavos,0),20000)
})
test('último marcador inválido não recupera qualificação antiga truncada nem vaza JSON ao resumo',()=>{
  const linhas=[linha(qual()),{...linha(qual()+' '.repeat(1000)),em:'2026-10-23T21:00:00.001Z'}]
  const l=montarCrm(validarRetrato(retrato(linhas)),{agora:new Date(AGORA.getTime()+10)}).leads[0]!
  assert.equal(l.qualificacaoComercial,undefined)
  assert.ok(l.eventos.every(e=>!e.texto?.includes('"adequacao"')))
})
test('CRM exige qualificação e oferta coerente antes do envio, preserva rascunho incompleto',async()=>fixture(async f=>{
  await f.store.registrar(nota(texto(proposta)),AGORA)
  await assert.rejects(f.store.registrar(nota(texto(enviado)),AGORA),/qualificação/)
  await f.store.registrar(nota(qual()),AGORA)
  await f.store.registrar(nota(texto(enviado)),AGORA)
  await f.store.registrar(nota(texto(aceite)),AGORA)
  assert.equal(f.escritas(),4)
}))
test('caminho completo aceita valor negociado e bloqueia legado e excesso de saldo',async()=>fixture(async f=>{
  await f.store.registrar(nota(qual()),AGORA)
  for(const e of [proposta,enviado,aceite,condicao,cobranca,pagamento('pag-001',20000)]) await f.store.registrar(nota(texto(e)),AGORA)
  await assert.rejects(f.store.registrar(nota(texto(pagamento('pag-excesso',30001))),AGORA),/saldo/)
  const legado=textoDoRegistroReceita('pagamento_confirmado',opcoesDeterministicasDeReceita({produto:'site'})[0]!,'REC-LEGADO','2026-10-23')
  await assert.rejects(f.store.registrar({...nota(legado),tipo:'pagamento_confirmado'},AGORA),/ciclo comercial/)
  assert.equal(f.escritas(),7)
}))
test('ACK atrasado não vira fonte nem autoriza repetir ou outro fato após reinício',async()=>fixture(async f=>{
  const t=texto(proposta)
  const ack=await f.store.registrar(nota(t),AGORA)
  assert.equal(ack.estado,'aguardando_projecao')
  assert.equal((await f.store.visao(AGORA)).leads[0]!.eventos.some(e=>e.registroTexto===t),false)
  await f.novo().registrar(nota(t),AGORA);assert.equal(f.escritas(),1)
  await assert.rejects(f.novo().registrar(nota(qual()),AGORA),/projeção|confirmação|aguardando/i)
  f.linhas.push(linha(t));await f.salvar()
  await f.novo().registrar(nota(qual()),AGORA);assert.equal(f.escritas(),2)
},true))

test('operação concorrente e replay com ordem JSON diferente não duplicam pagamento',async()=>fixture(async f=>{
  await f.store.registrar(nota(qual()),AGORA)
  for(const e of [proposta,enviado,aceite,condicao,cobranca]) await f.store.registrar(nota(texto(e)),AGORA)
  const p=pagamento('pag-concorrente',50000)
  const invertido='[ciclo-comercial-v1] '+JSON.stringify(Object.fromEntries(Object.entries(p).reverse()))
  const respostas=await Promise.all([f.store.registrar(nota(texto(p)),AGORA),f.store.registrar(nota(invertido),AGORA)])
  assert.equal(respostas.filter(r=>r.repetido).length,1);assert.equal(f.escritas(),7)
  assert.equal((await f.store.visao(AGORA)).leads[0]!.aarr!.pagamentos.length,1)
}))
test('ACK sem data não recebe data sintética nem libera outra tentativa após reinício',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crm-ack-invalido-'))
  try {
    const arquivo=path.join(dir,'crm.json'),segredo=path.join(dir,'segredo');await fs.writeFile(arquivo,JSON.stringify(retrato()));await fs.writeFile(segredo,'fixture')
    let posts=0;const novo=()=>new CrmStore({retrato:arquivo,segredoArquivo:segredo,registroUrl:'http://127.0.0.1:5679/fixture'},async()=>{posts++;return new Response(JSON.stringify({ok:true}),{status:200})})
    await assert.rejects(novo().registrar(nota(texto(proposta)),AGORA),/datada/)
    await assert.rejects(novo().registrar(nota(texto(proposta)),AGORA),/confirmação|projeção/)
    assert.equal(posts,1)
  }finally{await fs.rm(dir,{recursive:true,force:true})}
})
