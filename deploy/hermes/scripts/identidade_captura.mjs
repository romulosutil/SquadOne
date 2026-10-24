/** Prova operacional da própria captura: sem envio, texto ou credenciais no sidecar. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const hash = s => createHash('sha256').update(s).digest('hex')
export function jidCanonico(valor) {
  const m = /^(\d{10,15})(?::\d{1,6})?@s\.whatsapp\.net$/.exec(String(valor || ''))
  return m ? m[1] + '@s.whatsapp.net' : null
}
const pyTrim = s => s.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '')
const iso = n => new Date(n).toISOString()
function status(pasta, motivo, agora) {
  try {
    fs.mkdirSync(pasta,{recursive:true,mode:0o700})
    const arquivo=path.join(pasta,'status-hermes.json')
    let anterior={}
    try { anterior=JSON.parse(fs.readFileSync(arquivo,'utf8')) } catch {}
    const contagens={}
    for(const k of ['gravada','repetida','desligado','sem_identidade','config_invalida','metadados_invalidos','falha_gravacao','fora_da_ancora']) contagens[k]=(Number.isSafeInteger(anterior.contagens?.[k])?anterior.contagens[k]:0)+(k===motivo?1:0)
    const tmp=arquivo+'.'+randomUUID()+'.tmp'
    fs.writeFileSync(tmp,JSON.stringify({v:1,atualizadoEm:iso(agora),ultimoMotivo:motivo,contagens}),{mode:0o600})
    fs.renameSync(tmp,arquivo)
  } catch { /* A prova falha fechada; o arquivo bruto continua sendo capturado. */ }
}
export function registrarProvaHermes({home,socket,socketAtual,identidadeMe,identidadePublica,chave,ts,texto,id,direcao,destinatario,destinatarioAlternativo,agora=Date.now()}) {
  const pasta=path.join(home,'.local/share/whatsapp-identidades'),configFile=path.join(pasta,'config.json')
  if(!fs.existsSync(configFile))return {estado:'desligado'}
  const fim=motivo=>{status(pasta,motivo,agora);return {estado:motivo}}
  let config
  try {
    config=JSON.parse(fs.readFileSync(configFile,'utf8'))
    if(Object.keys(config).sort().join(',')!=='desde,identidadePrumoHash,v'||config.v!==1||!/^[a-f0-9]{64}$/.test(config.identidadePrumoHash)||!Number.isFinite(Date.parse(config.desde))||Date.parse(config.desde)>agora) return fim('config_invalida')
  } catch {return fim('config_invalida')}
  const owner=jidCanonico(socket?.user?.id),me=jidCanonico(identidadeMe)
  if(!owner||owner!==me||socketAtual()!==socket||!(identidadePublica instanceof Uint8Array)||identidadePublica.length<16||identidadePublica.length>128)return fim('sem_identidade')
  if(!/^[1-9][0-9]{9}$/.test(String(chave))||typeof id!=='string'||!/^[A-Za-z0-9_-]{3,200}$/.test(id)||!['entrada','saida'].includes(direcao)||typeof texto!=='string'||!Number.isFinite(ts)||ts<=0||Math.trunc(ts)!==ts||ts*1000>agora)return fim('metadados_invalidos')
  const pn=jidCanonico(destinatario)?.split('@')[0]??String(destinatario??'')
  const alternativo=jidCanonico(destinatarioAlternativo)
  if(alternativo&&alternativo.split('@')[0]!==pn)return fim('metadados_invalidos')
  const local=pn.startsWith('55')?pn.slice(2):''
  if(!/^55[0-9]{10,11}$/.test(pn)||local.slice(0,2)+local.slice(-8)!==chave)return fim('metadados_invalidos')
  const contaHash=hash(owner),sessaoHash=hash(identidadePublica)
  const prova={v:1,coletor:'hermes',contaHash,garantia:'socket-hermes',sessaoHash,instancia:null,capturadoEm:iso(agora),mensagem:{idOriginal:id,direcao,ocorridoEm:iso(ts*1000).slice(0,19)+'Z',conteudoHash:hash(Array.from(pyTrim(texto)).slice(0,2000).join(''))}}
  const assinatura=p=>JSON.stringify([p.coletor,p.contaHash,p.sessaoHash,p.instancia,p.mensagem])
  try {
    fs.mkdirSync(pasta,{recursive:true,mode:0o700});fs.chmodSync(pasta,0o700)
    const arquivo=path.join(pasta,chave+'.jsonl')
    let anterior=''
    try {if(fs.statSync(arquivo).size>8*1024*1024)return fim('falha_gravacao');anterior=fs.readFileSync(arquivo,'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
    for(const l of anterior.split('\n').filter(Boolean)){const p=JSON.parse(l);if(Date.parse(p.capturadoEm)>=Date.parse(config.desde)&&Date.parse(p.capturadoEm)<=agora&&assinatura(p)===assinatura(prova))return fim('repetida')}
    // Confere novamente o socket: evento antigo não recebe a identidade de uma nova conexão.
    if(socketAtual()!==socket||jidCanonico(socket.user?.id)!==owner)return fim('sem_identidade')
    const fd=fs.openSync(arquivo,fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_WRONLY,0o600)
    try {
      fs.fchmodSync(fd,0o600)
      const bytes=Buffer.from(JSON.stringify(prova)+'\n','utf8')
      if(fs.writeSync(fd,bytes)!==bytes.length)throw Error('Escrita incompleta')
      fs.fsyncSync(fd)
    } finally {fs.closeSync(fd)}
    if(process.platform!=='win32'){const d=fs.openSync(pasta,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}}
    return fim(contaHash===config.identidadePrumoHash?'gravada':'fora_da_ancora')
  } catch {return fim('falha_gravacao')}
}
