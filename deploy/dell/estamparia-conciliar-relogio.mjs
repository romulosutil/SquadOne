import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
const sha=s=>createHash('sha256').update(s).digest('hex')
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canon(x)])):v
const hash=v=>sha(JSON.stringify(canon(v)))
export function planejarCorrecaoDeSegundo(registro,mensagem,provas,config,agora=Date.now()) {
  const e=registro.evento
  if(registro.estado!=='concluido'||mensagem.id!==e.idOriginal||mensagem.direcao!==e.direcao||mensagem.em!==e.ocorridoEm||sha(mensagem.texto)!==e.conteudoHash)throw new Error('Fonte ou inbox mudou; não conciliar.')
  const {recebidoEm,...original}=e
  if(registro.hash!==hash(original))throw new Error('Hash da inbox diverge.')
  const ps=provas.filter(p=>p.mensagem.idOriginal===e.idOriginal&&p.mensagem.direcao===e.direcao)
  if(!ps.length||ps.some(p=>p.contaHash!==config.identidadePrumoHash||p.mensagem.conteudoHash!==e.conteudoHash||Date.parse(p.capturadoEm)<Date.parse(config.desde)||Date.parse(p.capturadoEm)>agora))throw new Error('Prova não permite corrigir horário.')
  const tempos=new Set(ps.map(p=>p.mensagem.ocorridoEm))
  if(tempos.size!==1)throw new Error('Provas originais discordam sobre o horário.')
  const correto=[...tempos][0]
  if(Math.abs(Date.parse(correto)-Date.parse(e.ocorridoEm))!==1000)throw new Error('Somente divergência comprovada de um segundo pode ser conciliada.')
  const evento={...e,ocorridoEm:correto},{recebidoEm:_r,...novoOriginal}=evento
  return {mensagem:{...mensagem,em:correto},registro:{chave:registro.chave,hash:hash(novoOriginal),evento,estado:'pendente'}}
}

async function main() {
  let ativo=true
  try{ativo=execFileSync('systemctl',['--user','is-active','squadone-operations.service'],{encoding:'utf8'}).trim()==='active'}catch{ativo=false}
  if(ativo)throw new Error('Parar a Central ociosa antes de conciliar a inbox derivada.')
  const h=os.homedir(),estado=path.join(h,'.local/share/squadone-operations'),politica=JSON.parse(await fs.readFile(path.join(estado,'estamparia-automacao.json'),'utf8'))
  if(politica.modo!=='pausado')throw new Error('Preservar pausa durante a conciliação.')
  const {EntradaAtendimentoComercialDuravel}=await import('../../server/entrada-atendimento-comercial.ts')
  const {validarProvaIdentidadeCaptura}=await import('../../server/identidade-captura.ts')
  const arquivo=path.join(estado,'atendimento-comercial-inbox.json'),inboxAntes=await fs.readFile(arquivo,'utf8')
  await new EntradaAtendimentoComercialDuravel(arquivo).listar()
  const inbox=JSON.parse(inboxAntes),config=JSON.parse(await fs.readFile(path.join(h,'.local/share/whatsapp-identidades/config.json'),'utf8'))
  const alvos=JSON.parse(await fs.readFile(path.join(estado,'estamparia-conferencia-antigas.json'),'utf8')).alvos.filter(a=>['Linha & Arte Bordados','Pêki Uniformes'].includes(a.empresa))
  if(alvos.length!==2)throw new Error('Escopo de correção mudou.')
  const backup=path.join(estado,'estamparia-correcao-segundo');await fs.mkdir(backup,{mode:0o700})
  const escrever=async(f,v)=>{const fd=await fs.open(f,'wx',0o600);try{await fd.writeFile(v);await fd.sync()}finally{await fd.close()}}
  await escrever(path.join(backup,'inbox.antes.json'),inboxAntes)
  const planos=[]
  for(const a of alvos) {
    const registros=inbox.registros.filter(r=>r.evento.conversa===a.chave).sort((a,b)=>Date.parse(b.evento.ocorridoEm)-Date.parse(a.evento.ocorridoEm)),r=registros[0]
    for(const pasta of ['estamparia-saidas','encontrado-saidas']) {
      try {for(const n of await fs.readdir(path.join(estado,pasta)))if(n.endsWith('.json')){const s=JSON.parse(await fs.readFile(path.join(estado,pasta,n),'utf8'));if(s.chave===r.chave)throw new Error('Existe reserva ou recibo; não corrigir esta entrada.')}}catch(e){if(e.code!=='ENOENT')throw e}
    }
    const fonte=path.join(h,'.local/share/whatsapp-conversas',a.chave+'.jsonl'),antes=await fs.readFile(fonte,'utf8'),ms=antes.split('\n').filter(Boolean).map(JSON.parse)
    const candidatas=ms.filter(m=>m.id===r.evento.idOriginal&&m.direcao===r.evento.direcao)
    if(candidatas.length!==1)throw new Error('Mensagem ambígua.')
    const provas=(await fs.readFile(path.join(h,'.local/share/whatsapp-identidades',a.chave+'.jsonl'),'utf8')).split('\n').filter(Boolean).map(l=>validarProvaIdentidadeCaptura(JSON.parse(l)))
    const correcao=planejarCorrecaoDeSegundo(r,candidatas[0],provas,config)
    await escrever(path.join(backup,a.chave+'.antes.jsonl'),antes)
    const novo=ms.map(m=>m===candidatas[0]?correcao.mensagem:m).map(m=>JSON.stringify(m)).join('\n')+'\n'
    inbox.registros[inbox.registros.indexOf(r)]=correcao.registro
    planos.push({empresa:a.empresa,fonte,antes,novo,chave:r.chave,horarioAnterior:r.evento.ocorridoEm,horarioCorrigido:correcao.registro.evento.ocorridoEm})
  }
  await escrever(path.join(backup,'auditoria.json'),JSON.stringify({em:new Date().toISOString(),motivo:'Horário original comprovado na releitura da mesma conta; ID, conteúdo, direção e recibos preservados.',correcoes:planos.map(({empresa,chave,horarioAnterior,horarioCorrigido})=>({empresa,chave,horarioAnterior,horarioCorrigido}))}))
  try {
    if(await fs.readFile(arquivo,'utf8')!==inboxAntes)throw new Error('Inbox mudou durante a conferência.')
    for(const p of planos) {
      if(await fs.readFile(p.fonte,'utf8')!==p.antes)throw new Error('Captura mudou; preservar a mensagem nova.')
      await escrever(p.fonte+'.segundo-novo',p.novo);await fs.rename(p.fonte+'.segundo-novo',p.fonte)
    }
    await escrever(arquivo+'.segundo-novo',JSON.stringify(inbox));await fs.rename(arquivo+'.segundo-novo',arquivo)
    await new EntradaAtendimentoComercialDuravel(arquivo).listar()
  }catch(e){await fs.writeFile(arquivo,inboxAntes,{mode:0o600});for(const p of planos)await fs.writeFile(p.fonte,p.antes,{mode:0o600});throw e}
  console.log(JSON.stringify({corrigidas:planos.map(({empresa,horarioAnterior,horarioCorrigido})=>({empresa,horarioAnterior,horarioCorrigido})),identidadesERecibosPreservados:true}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main()
