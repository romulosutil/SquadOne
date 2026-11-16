import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { AtendimentoComercial } from '../../server/atendimento-comercial.ts'
import { conferirIdentidadeCaptura, mensagemDaCaptura } from '../../server/identidade-captura.ts'
import { identidadeDaConversa } from '../../src/operations/responsavel-conversa.ts'
import { EstampariaAutomatico, HASH_ATENDIMENTO_ESTAMPARIA } from '../../server/estamparia-automatico.ts'
import { SaidasEncontrado } from '../../server/encontrado-saidas.ts'
const sha=s=>createHash('sha256').update(s).digest('hex')
const AGORA=Date.parse('2026-10-26T21:00:00.000Z'),EM='2026-10-26T20:59:00.000Z',DESDE='2026-10-26T20:00:00.000Z'
for(const prova of ['correta','ausente','outra-conta'])test(`host real de identidade: prova ${prova}`,async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'estampa-identidade-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  const m={id:'entrada-ficticia',direcao:'entrada',em:EM,texto:'Pode falar por aqui sim!',origem:'prumo'},tuple=mensagemDaCaptura(m)
  const config={v:1,identidadePrumoHash:sha('conta-profissional-ficticia'),desde:DESDE}
  const fonte={conversa:'2799991234',jsonl:JSON.stringify(m),identidade:{ativa:true,assinatura:sha('fonte-ficticia'),config,jsonl:prova==='ausente'?'':JSON.stringify({v:1,coletor:'evolution',garantia:'webhook-evolution',sessaoHash:null,instancia:'prumo',contaHash:prova==='correta'?config.identidadePrumoHash:sha('outra-conta'),capturadoEm:EM,mensagem:tuple})}}
  const evento={origem:'whatsapp',conta:'prumo',canal:'whatsapp',conversa:'2799991234',tipo:'resposta',direcao:'entrada',ocorridoEm:EM,recebidoEm:EM,conteudoHash:sha(m.texto),idOriginal:m.id,fonteId:m.id}
  const registro={chave:sha('entrada-ficticia'),evento,estado:'projetado'}
  const lead={id:'estampa:teste',chave:'teste',produto:'estampa',empresa:'Empresa fictícia',etapa:'contato',sinal:'em-conversa',marcos:{enviado:DESDE},eventos:[],links:{whatsapp:'https://wa.me/5527999991234'},conversa:{desde:EM,mensagens:1,ultimaEntrada:EM,ultima:{direcao:'entrada',em:EM,trecho:m.texto}}}
  const visao={estado:'ok',geradoEm:EM,colunasAusentes:[],fontes:[],leads:[lead]}
  const atendimento=new AtendimentoComercial({inbox:{listar:async()=>[registro]},lerFonte:async()=>fonte,visao:async()=>visao,agora:()=>AGORA})
  let envios=0
  const engine=new EstampariaAutomatico({atendimento,saidas:new SaidasEncontrado(dir),politica:async()=>({v:1,modo:'respostas',desde:DESDE,catalogoHash:HASH_ATENDIMENTO_ESTAMPARIA}),agora:()=>AGORA,
    transporte:{conferir:async()=>{},enviar:async()=>{envios++;return 'recibo-ficticio'}},comConversa:async(_n,fn)=>fn(),identidadeLead:l=>identidadeDaConversa(l)?.conversa??null,bloqueio:async()=>null,
    verificarMensagem:(raw,id,agora)=>{const v=mensagemDaCaptura(raw);return v&&conferirIdentidadeCaptura(v,id,agora).estado==='verificada'?v:null}})
  await engine.executar()
  assert.equal(envios,prova==='correta'?1:0)
  const estado=(await engine.estados()).get(lead.id)
  assert.equal(estado?.acao,prova==='correta'?'time':'humano')
})
