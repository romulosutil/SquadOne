import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {AtendimentoComercial,criarLeitorFonteAtendimento} from '../../server/atendimento-comercial.ts'
import {criarLeitorIdentidadeCaptura,mensagemDaCaptura,conferirIdentidadeCaptura} from '../../server/identidade-captura.ts'
import {EntradaAtendimentoComercialDuravel} from '../../server/entrada-atendimento-comercial.ts'
import {identidadeDaConversa,projetarResponsavelConversa} from '../../src/operations/responsavel-conversa.ts'
import {EstampariaAutomatico,validarPoliticaEstamparia} from '../../server/estamparia-automatico.ts'
import {SaidasEncontrado} from '../../server/encontrado-saidas.ts'
const modo=process.argv[2],h=os.homedir(),estado=path.join(h,'.local/share/squadone-operations'),arquivo=path.join(estado,'estamparia-automacao.json'),planoArquivo=path.join(estado,'estamparia-conferencia-final.json')
const sha=s=>createHash('sha256').update(s).digest('hex')
const get=async rota=>{const r=await fetch('http://127.0.0.1:9120'+rota);if(!r.ok)throw new Error('Leitura indisponível.');return r.json()}
const gravar=async(f,v)=>{const fd=await fs.open(f,'wx',0o600);try{await fd.writeFile(JSON.stringify(v));await fd.sync()}finally{await fd.close()}}
const original=await fs.readFile(arquivo,'utf8'),p=validarPoliticaEstamparia(JSON.parse(original))
if(p.modo!=='pausado')throw new Error('Conferência exige a pausa temporária existente.')
if(modo==='conferir') {
  const v=await get('/api/operations/crm'),alvos=JSON.parse(await fs.readFile(path.join(estado,'estamparia-conferencia-antigas.json'),'utf8')).alvos
  if(v.estado!=='ok'||v.colunasAusentes.length||v.fontes.some(f=>f.erro))throw new Error('Aguardar fonte válida.')
  const stamp=v.leads.find(l=>l.produto==='estampa'&&l.empresa.toLowerCase().includes('stamp fast'))
  const ids=[...alvos.map(a=>a.id),stamp?.id]
  if(ids.some(id=>!id)||new Set(ids).size!==20)throw new Error('Escopo de acompanhamento mudou.')
  const inbox=new EntradaAtendimentoComercialDuravel(path.join(estado,'atendimento-comercial-inbox.json')),entradas=await inbox.listar(),chaves=[]
  for(const id of ids) {
    const lead=v.leads.find(l=>l.id===id),conversa=lead&&identidadeDaConversa(lead)?.conversa
    const r=entradas.filter(r=>r.evento.conta==='prumo'&&r.evento.conversa===conversa&&r.evento.tipo==='resposta'&&r.evento.direcao==='entrada').sort((a,b)=>Date.parse(b.evento.ocorridoEm)-Date.parse(a.evento.ocorridoEm))[0]
    if(!r||Date.parse(r.evento.ocorridoEm)>=Date.parse(p.desde))throw new Error('Chegou uma entrada nova; conferir antes de substituir a retomada.')
    chaves.push(r.chave)
  }
  const candidata=validarPoliticaEstamparia({...p,modo:'respostas',retomada:{autorizadaEm:new Date().toISOString(),chaves:chaves.sort()}})
  const ler=criarLeitorIdentidadeCaptura(),atendimento=new AtendimentoComercial({inbox,lerFonte:criarLeitorFonteAtendimento(path.join(h,'.local/share/whatsapp-conversas'),ler),visao:async()=>v})
  const engine=new EstampariaAutomatico({atendimento,politica:async()=>candidata,saidas:new SaidasEncontrado(path.join(estado,'estamparia-saidas')),
    transporte:{conferir:async()=>{throw new Error('Conferência não envia.')},enviar:async()=>{throw new Error('Conferência não envia.')}},comConversa:async()=>{throw new Error('Conferência não executa.')},
    identidadeLead:l=>identidadeDaConversa(l)?.conversa??null,bloqueio:async(l,ls)=>{const d=projetarResponsavelConversa(l,ls);return d.estado==='bloqueado'||d.registro?.responsavel==='romulo'?d.motivo:null},
    verificarMensagem:(m,f,agora)=>{const t=mensagemDaCaptura(m);return t&&conferirIdentidadeCaptura(t,f,agora).estado==='verificada'?t:null}})
  const estados=await engine.estados(),relatorio=ids.map(id=>({id,empresa:v.leads.find(l=>l.id===id).empresa,...estados.get(id)}))
  if(relatorio.some(r=>!r.estado))throw new Error('Falta próximo passo em uma conversa.')
  if(relatorio.some(r=>r.estado==='responder'))throw new Error('A conferência encontrou resposta a enviar; revisar o contexto antes da ativação.')
  if(relatorio.some(r=>r.acao==='humano'&&r.identidade!=='confirmada'))throw new Error('Resta bloqueio técnico sem próximo passo resolvido.')
  await gravar(planoArquivo,{v:1,em:new Date().toISOString(),antesHash:sha(original),politica:candidata,relatorio})
  console.log(JSON.stringify({conversas:relatorio.length,confirmadas:relatorio.filter(r=>r.identidade==='confirmada').length,legadoSomenteEspera:relatorio.filter(r=>r.identidade==='sem-prova'&&r.estado==='aguardando-cliente').length,resultados:relatorio.map(({empresa,estado,proximoPasso})=>({empresa,estado,proximoPasso}))}))
} else if(modo==='ativar') {
  const plano=JSON.parse(await fs.readFile(planoArquivo,'utf8'))
  if(plano.antesHash!==sha(original)||Date.now()-Date.parse(plano.em)>30*60_000)throw new Error('Política mudou ou plano expirou; conferir novamente.')
  const nova=validarPoliticaEstamparia(plano.politica)
  if(nova.desde!==p.desde||nova.catalogoHash!==p.catalogoHash)throw new Error('Preservar ativação e catálogo.')
  await gravar(arquivo+'.antes-final',p);await gravar(arquivo+'.final-novo',nova)
  if(sha(await fs.readFile(arquivo,'utf8'))!==plano.antesHash)throw new Error('Política mudou durante a gravação.')
  await fs.rename(arquivo+'.final-novo',arquivo)
  const d=await fs.open(estado,'r');try{await d.sync()}finally{await d.close()}
  const atual=await get('/api/operations/crm/estamparia/automacao')
  if(atual.modo!=='respostas'||atual.retomada?.entradas!==20)throw new Error('Conferir confirmação da retomada antes de repetir ações.')
  console.log(JSON.stringify({reativada:true,...atual}))
} else throw new Error('Use conferir ou ativar.')
