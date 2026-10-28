import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { AtendimentoComercial, criarLeitorFonteAtendimento } from '../../server/atendimento-comercial.ts'
import { criarLeitorIdentidadeCaptura, mensagemDaCaptura, conferirIdentidadeCaptura } from '../../server/identidade-captura.ts'
import { EntradaAtendimentoComercialDuravel } from '../../server/entrada-atendimento-comercial.ts'
import { identidadeDaConversa, projetarResponsavelConversa } from '../../src/operations/responsavel-conversa.ts'
import { EstampariaAutomatico, HASH_ATENDIMENTO_ESTAMPARIA, validarPoliticaEstamparia } from '../../server/estamparia-automatico.ts'
import { SaidasEncontrado } from '../../server/encontrado-saidas.ts'

// O modo preparar não envia mensagens nem altera a política em vigor.
const modo=process.argv[2]
if(!['preparar','ativar'].includes(modo))throw new Error('Use preparar ou ativar, após a autorização de retomada no Dell.')
const estado=path.join(os.homedir(),'.local/share/squadone-operations'),arquivo=path.join(estado,'estamparia-automacao.json')
const planoArquivo=path.join(estado,'estamparia-retomada-planejada.json')
const sha=s=>createHash('sha256').update(s).digest('hex')
const get=async rota=>{const r=await fetch('http://127.0.0.1:9120'+rota);if(!r.ok)throw new Error('Leitura indisponível.');return r.json()}
const gravarExclusivo=async(arquivo,v)=>{const h=await fs.open(arquivo,'wx',0o600);try{await h.writeFile(JSON.stringify(v));await h.sync()}finally{await h.close()}}
const original=await fs.readFile(arquivo,'utf8'),p=validarPoliticaEstamparia(JSON.parse(original))
if(p.modo!=='respostas'||p.catalogoHash!==HASH_ATENDIMENTO_ESTAMPARIA)throw new Error('Preservar pausa ou catálogo divergente.')
if(p.retomada)throw new Error('Retomada já configurada; conferir o plano existente antes de ampliar a lista.')

if(modo==='preparar') {
  const v=await get('/api/operations/crm'),agora=Date.now()
  if(v.estado!=='ok'||v.colunasAusentes.length||v.fontes.some(f=>f.erro)||agora-Date.parse(v.geradoEm)>15*60_000)throw new Error('Aguardar CRM atualizado.')
  const inbox=new EntradaAtendimentoComercialDuravel(path.join(estado,'atendimento-comercial-inbox.json'))
  const ultimas=new Map()
  for(const r of await inbox.listar()) {
    const e=r.evento
    if(e.conta!=='prumo'||e.direcao!=='entrada'||e.tipo!=='resposta'||e.origem!=='whatsapp'||Date.parse(e.ocorridoEm)>agora)continue
    const anterior=ultimas.get(e.conversa)
    if(!anterior||Date.parse(e.ocorridoEm)>Date.parse(anterior.evento.ocorridoEm))ultimas.set(e.conversa,r)
  }
  const rs=[...ultimas.values()].filter(r=>{
    const ls=v.leads.filter(l=>identidadeDaConversa(l)?.conversa===r.evento.conversa)
    return ls.length===1&&ls[0].produto==='estampa'&&!['ganho','perdido'].includes(ls[0].etapa)&&Date.parse(r.evento.ocorridoEm)<Date.parse(p.desde)
  })
  if(!rs.length)throw new Error('Nenhuma conversa anterior aberta foi encontrada.')
  const candidata=validarPoliticaEstamparia({...p,retomada:{autorizadaEm:new Date().toISOString(),chaves:rs.map(r=>r.chave).sort()}})
  const lerIdentidade=criarLeitorIdentidadeCaptura()
  const atendimento=new AtendimentoComercial({inbox,lerFonte:criarLeitorFonteAtendimento(path.join(os.homedir(),'.local/share/whatsapp-conversas'),lerIdentidade),visao:async()=>v})
  const engine=new EstampariaAutomatico({atendimento,politica:async()=>candidata,saidas:new SaidasEncontrado(path.join(estado,'estamparia-saidas')),
    transporte:{conferir:async()=>{throw new Error('Prévia não possui transporte.')},enviar:async()=>{throw new Error('Prévia não pode enviar.')}},
    comConversa:async()=>{throw new Error('Prévia não executa.')},identidadeLead:l=>identidadeDaConversa(l)?.conversa??null,
    verificarMensagem:(m,fonte,agora)=>{const t=mensagemDaCaptura(m);return t&&conferirIdentidadeCaptura(t,fonte,agora).estado==='verificada'?t:null},
    bloqueio:async(l,ls)=>{const d=projetarResponsavelConversa(l,ls);return d.estado==='bloqueado'||d.registro?.responsavel==='romulo'?d.motivo:null}})
  const estados=await engine.estados(),contagens={}
  for(const e of estados.values())contagens[e.estado]=(contagens[e.estado]??0)+1
  const stamp=v.leads.find(l=>l.produto==='estampa'&&l.empresa.toLowerCase().includes('stamp fast'))
  const resumo={conversasIncluidas:rs.length,estados:contagens,stampFast:stamp?estados.get(stamp.id):null}
  await gravarExclusivo(planoArquivo,{v:1,politicaAntesHash:sha(original),politica:candidata,resumo})
  console.log(JSON.stringify(resumo))
} else {
  const plano=JSON.parse(await fs.readFile(planoArquivo,'utf8'))
  if(plano.v!==1||plano.politicaAntesHash!==sha(original))throw new Error('A política mudou depois da prévia; revisar antes de ativar.')
  const nova=validarPoliticaEstamparia(plano.politica)
  if(Date.now()-Date.parse(nova.retomada.autorizadaEm)>30*60_000)throw new Error('Prévia de retomada expirou; refazer a conferência.')
  if(nova.desde!==p.desde||nova.catalogoHash!==p.catalogoHash||nova.modo!==p.modo)throw new Error('A retomada não pode mudar ativação, catálogo ou pausa.')
  const capacidade=await get('/api/operations/crm/estamparia/automacao')
  if(capacidade.modo!=='respostas'||capacidade.catalogoHash!==p.catalogoHash)throw new Error('A capacidade ativa não corresponde ao plano.')
  const temporario=arquivo+'.retomada-nova'
  await gravarExclusivo(arquivo+'.antes-retomada',JSON.parse(original))
  await gravarExclusivo(temporario,nova)
  // Reconfere após fsync: nenhuma política intermediária é sobrescrita.
  if(sha(await fs.readFile(arquivo,'utf8'))!==plano.politicaAntesHash)throw new Error('A política mudou durante a gravação.')
  await fs.rename(temporario,arquivo)
  const dir=await fs.open(estado,'r');try{await dir.sync()}finally{await dir.close()}
  const atual=await get('/api/operations/crm/estamparia/automacao')
  if(atual.retomada?.entradas!==nova.retomada.chaves.length||atual.desde!==p.desde)throw new Error('Conferir confirmação da retomada antes de qualquer repetição.')
  console.log(JSON.stringify({ativada:true,...atual}))
}
