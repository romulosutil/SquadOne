import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { CrmStore, montarCrm, validarRegistro, validarRetrato, RegistroInvalido } from './crm.ts'
import { chaveDoNumero, type MensagemDaConversa } from './conversa-do-lead.ts'
import { PREFIXO_CICLO, textoEventoCiclo, cicloDoLead, lerEventoCiclo, type EventoCiclo } from '../src/operations/ciclo-comercial.ts'
import { textoResponsavelConversa, projetarResponsavelConversa, chaveDaConversaBrasil } from '../src/operations/responsavel-conversa.ts'

import { qualificacaoComercialVazia, textoDaQualificacaoComercial } from '../src/operations/qualificacao-comercial.ts'

const agora = new Date('2026-10-23T15:00:00Z'), envio = '2026-10-21T11:00:00Z', resposta = '2026-10-21T11:02:00Z'
const telefone = '5527999990001'
const conteudo = 'Proposta histórica: site sem implantação, R$ 90/mês, pagamento após ver funcionando.'
function retrato(textoProposta?: string) {
  const linha = { ID: 'SINTETICO', Empresa: 'Empresa de teste', WhatsApp: telefone, Etapa: 'Em conversa', 'Convite enviado em': envio,
    'Respondeu em': resposta, 'Tipo da resposta': 'interesse', Resposta: 'Tenho interesse em contratar', 'Resposta em': resposta }
  return validarRetrato({ versao:1, geradoEm:agora.toISOString(), links:{}, fontes:{
    iris:{aba:'Clínicas',linhas:[linha]}, estampa:{aba:'Estamparias',linhas:[{...linha,ID:'OUTRA-OFERTA'}]},
    registros:{aba:'CRM',linhas:textoProposta === undefined ? [] : [{ produto:'iris', id:'SINTETICO', tipo:'proposta', texto:textoProposta, em:resposta, data:'2026-10-21' }]},
  } })
}

describe('CRM exige fatos sem reconstruir o passado por templates', () => {
  it('proposta vazia continua consultável e exige revisão, sem iniciar cadência de proposta', () => {
    const l = montarCrm(retrato(''),{agora}).leads[0]!
    assert.equal(l.proposta,undefined)
    assert.equal(l.etapa,'contato')
    assert.match(l.revisaoComercial!,/sem conteúdo/)
    assert.ok(l.eventos.some(e => e.tipo === 'proposta' && /sem evidência/.test(e.rotulo)))
  })
  it('condição histórica permanece na proposta quando a resposta atual é ok', () => {
    const ms: MensagemDaConversa[] = [
      {direcao:'saida',em:envio,texto:'Posso explicar a oferta?'},
      {direcao:'entrada',em:resposta,texto:'Tenho interesse em contratar'},
      {direcao:'saida',em:'2026-10-21T11:03:00Z',texto:conteudo},
      {direcao:'entrada',em:'2026-10-21T11:04:00Z',texto:'Ok'},
    ]
    const r = retrato(conteudo), antes = JSON.stringify(r)
    const l = montarCrm(r,{agora,conversas:new Map([[chaveDoNumero(telefone),ms]])}).leads[0]!
    assert.equal(l.etapa,'proposta')
    assert.equal(l.classificacaoResposta?.classe,'neutra')
    assert.equal(l.classificacaoResposta?.interesseHistorico?.trecho,'Tenho interesse em contratar')
    assert.ok(l.eventos.some(e=>e.tipo === 'proposta' && e.texto?.includes('R$ 90/mês')))
    assert.equal(JSON.stringify(r),antes)
  })
  it('registro novo rejeita ausência de conteúdo, declaração genérica e campos por preencher', () => {
    for (const texto of ['', 'Enviei a proposta', 'Proposta enviada', 'Proposta para o site, início em [dia] e escopo aprovado.']) {
      assert.throws(()=>validarRegistro({produto:'iris',id:'SINTETICO',tipo:'proposta',texto},agora),RegistroInvalido)
    }
    assert.equal(validarRegistro({produto:'iris',id:'SINTETICO',tipo:'proposta',texto:conteudo},agora).texto,conteudo)
  })
  it('saída simples não apaga material prometido e não conclui o próximo passo', () => {
    const r = retrato()
    r.fontes.registros.linhas.push({produto:'iris',id:'SINTETICO',tipo:'proximo_passo',texto:'Enviar demonstração solicitada',em:resposta,data:'2026-10-24'})
    const ms: MensagemDaConversa[] = [
      {direcao:'saida',em:envio,texto:'Posso enviar o vídeo?'},
      {direcao:'entrada',em:resposta,texto:'Pode enviar o vídeo'},
      {direcao:'saida',em:'2026-10-21T11:03:00Z',texto:'Vou pedir o vídeo ao time'},
    ]
    const l=montarCrm(r,{agora,conversas:new Map([[chaveDoNumero(telefone),ms]])}).leads[0]!
    assert.ok(l.interesseParado)
    assert.equal(l.marcos.segundaEnviada,undefined)
    assert.equal(l.proximoPasso?.texto,'Enviar demonstração solicitada')
  })
})

describe('notas comerciais têm validação, serialização e leitura confirmada', () => {
  it('duplo clique não duplica; aceite e pagamento revalidam os fatos realmente projetados', async () => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crm-evidencia-'))
    try {
      const arquivo=path.join(dir,'crm.json'), segredo=path.join(dir,'segredo'), fonte=retrato()
      await fs.writeFile(arquivo,JSON.stringify(fonte))
      await fs.writeFile(segredo,'fixture-sem-credencial-real')
      let chamadas=0
      const store=new CrmStore({retrato:arquivo,registroUrl:'http://127.0.0.1:5679/webhook/crm-registro',segredoArquivo:segredo},async(_url,init)=>{
        chamadas++
        fonte.fontes.registros.linhas.push({...JSON.parse(String(init!.body)),em:agora.toISOString()});await fs.writeFile(arquivo,JSON.stringify(fonte))
        return new Response(JSON.stringify({ok:true,em:agora.toISOString()}))
      })
      const enviar=(e:EventoCiclo)=>store.registrar({produto:'iris',id:'SINTETICO',tipo:'nota',texto:textoEventoCiclo(e,agora.getTime())},agora)
      const base={v:1 as const,data:'2026-10-23',humano:true as const}
      const proposta:EventoCiclo={...base,id:'prop-001',tipo:'proposta',referencia:'proposta-test-v1',ofertaId:'iris',oferta:'iris',versao:1,escopo:'Implantação combinada',prazo:'Sete dias',condicoes:'Condição aprovada',valor:10000,mensalidade:0,responsavel:'romulo'}
      const q=textoDaQualificacaoComercial({...qualificacaoComercialVazia(agora.getTime()),id:'qual-001',necessidade:'Organizar atendimento',adequacao:{estado:'confirmada',oferta:'iris',motivo:'Atendimento da clínica'},intencao:'avaliar',decisao:'Dona avalia',proximoPasso:{descricao:'Receber proposta Iris',aceito:true},fonte:'Conversa de teste',evidencia:'Quero avaliar a proposta Iris'},agora.getTime())
      await store.registrar({produto:'iris',id:'SINTETICO',tipo:'nota',texto:q},agora)
      const duplo=await Promise.all([enviar(proposta),enviar(proposta)])
      assert.equal(chamadas,2); assert.equal(duplo.filter(r=>r.repetido).length,1)
      await assert.rejects(enviar({...proposta,valor:11000}),RegistroInvalido)
      const aceite:EventoCiclo={...base,id:'aceite-001',tipo:'aceite',referencia:'aceite-test',vinculo:proposta.id,evidencia:'Cliente aceitou a versão enviada',documento:'contrato-v1'}
      await assert.rejects(enviar(aceite),/conteúdo enviado/)
      await enviar({...base,id:'envio-001',tipo:'proposta_enviada',referencia:'mensagem-test',vinculo:proposta.id,evidencia:'Conteúdo e versão enviados pelo WhatsApp'})
      await enviar(aceite)
      await enviar({...base,id:'condicao-001',tipo:'condicao_cobranca',referencia:'condicao-test',vinculo:aceite.id,evidencia:'Condição aceita',componente:'inicial',valor:10000,gatilho:'aceite',condicao:'Após aceite',vigenciaInicio:'2026-10-23'})
      await enviar({...base,id:'cobranca-001',tipo:'cobranca',referencia:'cobranca-test',vinculo:'condicao-001',evidencia:'Cobrança emitida',componente:'inicial',valor:10000,vencimento:'2026-10-24',forma:'Manual'})
      const pagamentos=await Promise.allSettled([1,2].map(n=>enviar({...base,id:`pago-00${n}`,tipo:'pagamento',referencia:`recibo-test-${n}`,vinculo:'cobranca-001',evidencia:'Recebimento conferido por Rômulo',componente:'inicial',valor:6000})))
      assert.equal(pagamentos.filter(r=>r.status==='fulfilled').length,1)
      assert.equal(chamadas,7)
      assert.equal((await store.visao(agora)).leads[0]!.eventos.filter(e=>e.tipo==='nota' && (e.registroTexto??e.texto)?.startsWith(PREFIXO_CICLO)).length,6)
      await assert.rejects(store.registrar({produto:'iris',id:'SINTETICO',tipo:'nota',texto:PREFIXO_CICLO+'{}'},agora),RegistroInvalido)
    } finally { await fs.rm(dir,{recursive:true,force:true}) }
  })
  it('assumir conversa afeta suas ofertas sem mesclar oportunidades e rejeita telefone divergente', async () => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crm-responsavel-'))
    try {
      const arquivo=path.join(dir,'crm.json'),segredo=path.join(dir,'segredo'),fonte=retrato()
      await fs.writeFile(arquivo,JSON.stringify(fonte)); await fs.writeFile(segredo,'fixture')
      let chamadas=0
      const store=new CrmStore({retrato:arquivo,registroUrl:'http://127.0.0.1:5679/webhook/crm-registro',segredoArquivo:segredo},async(_url,init)=>{
        chamadas++;fonte.fontes.registros.linhas.push({...JSON.parse(String(init!.body)),em:agora.toISOString()});await fs.writeFile(arquivo,JSON.stringify(fonte)); return new Response(JSON.stringify({ok:true,em:agora.toISOString()}))
      })
      const meta={v:2 as const,id:'dono-001',conta:'prumo',canal:'whatsapp',anterior:null,conversa:chaveDaConversaBrasil(telefone),responsavel:'romulo' as const,data:agora.toISOString(),motivo:'Conduzir negociação',humano:true as const}
      const entrada={produto:'iris',id:'SINTETICO',tipo:'nota',texto:textoResponsavelConversa(meta)}
      await store.registrar(entrada,agora)
      const v=await store.visao(agora)
      assert.equal(v.leads.length,2)
      assert.ok(v.leads.every(l=>projetarResponsavelConversa(l,v.leads,agora.getTime()).registro?.responsavel==='romulo'))
      assert.equal(v.leads[0]!.produto,'iris'); assert.equal(v.leads[1]!.produto,'estampa')
      assert.equal((await store.registrar(entrada,agora)).repetido,true)
      await assert.rejects(store.registrar({...entrada,texto:textoResponsavelConversa({...meta,id:'dono-002',conversa:'2799990002'})},agora),/Responsável mudou ou fonte está bloqueada/)
      assert.equal(chamadas,1)
    } finally { await fs.rm(dir,{recursive:true,force:true}) }
  })
})


it('compromisso interno passa pelo journal sem se tornar fato financeiro ou bloquear proposta',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crm-compromisso-'))
  try {
    const arquivo=path.join(dir,'crm.json'),segredo=path.join(dir,'segredo'),fonte=retrato()
    await fs.writeFile(arquivo,JSON.stringify(fonte));await fs.writeFile(segredo,'fixture')
    let chamadas=0
    const store=new CrmStore({retrato:arquivo,registroUrl:'http://127.0.0.1/fixture',segredoArquivo:segredo},async(_url,init)=>{
      chamadas++;fonte.fontes.registros.linhas.push({...JSON.parse(String(init!.body)),em:agora.toISOString()});await fs.writeFile(arquivo,JSON.stringify(fonte))
      return new Response(JSON.stringify({ok:true,em:agora.toISOString()}))
    })
    const trabalho:EventoCiclo={v:1,id:'trabalho-001',tipo:'trabalho',data:'2026-10-23',humano:true,referencia:'Compromisso sintético',fila:'time',responsavel:'Elisa',tarefa:'Conferir material',resultado:'Material conferido',condicao:'Revisão humana antes da entrega'}
    const texto=textoEventoCiclo(trabalho,agora.getTime())
    assert.equal(lerEventoCiclo(texto,agora.getTime()),null,'o leitor financeiro não promove compromisso interno')
    const entrada={produto:'iris',id:'SINTETICO',tipo:'nota',texto}
    await store.registrar(entrada,agora)
    assert.equal((await store.registrar(entrada,agora)).repetido,true)
    let l=(await store.visao(agora)).leads[0]!,c=cicloDoLead(l,agora.getTime())
    assert.equal(c.trabalho?.tarefa,'Conferir material')
    assert.equal(c.eventos.length,0);assert.equal(c.historico.length,0);assert.equal(c.problemas.length,0)
    assert.equal(c.recebido,0);assert.equal(l.aarr!.pagamentos.length,0)
    await assert.rejects(store.registrar({...entrada,texto:textoEventoCiclo({...trabalho,tarefa:'Outra tarefa'},agora.getTime())},agora),/Identificador|outro conteúdo|divergente/)
    const p:EventoCiclo={v:1,id:'proposta-separada',tipo:'proposta',data:'2026-10-23',humano:true,referencia:'Rascunho independente',ofertaId:'iris',versao:1}
    await store.registrar({...entrada,texto:textoEventoCiclo(p,agora.getTime())},agora)
    l=(await store.visao(agora)).leads[0]!;c=cicloDoLead(l,agora.getTime())
    assert.equal(c.propostas.length,1);assert.equal(c.aceites.length,0);assert.equal(c.cobrancas.length,0);assert.equal(c.recebido,0)
    assert.equal(chamadas,2)
  }finally{await fs.rm(dir,{recursive:true,force:true})}
})
