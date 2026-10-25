import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { chaveDaConversaBrasil } from '../src/operations/responsavel-conversa.ts'
const BASE = 'http://127.0.0.1:8081'
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex')
export interface TransporteEncontrado {
  conferir():Promise<void>
  enviar(numero:string,texto:string):Promise<string>
}
/** Somente a instância já existente; sem criação, QR, reconexão ou fallback de conta. */
export function transporteEncontradoEvolution(fetcher:typeof fetch=fetch,home=os.homedir()):TransporteEncontrado {
  async function credencial() {
    const env=await fs.readFile(path.join(home,'workspace/evolution/.env'),'utf8')
    const key=env.split(/\r?\n/).find(l=>l.startsWith('EVOLUTION_APIKEY='))?.slice('EVOLUTION_APIKEY='.length).trim().replace(/^['"]|['"]$/g,'')
    if(!key)throw new Error('Credencial do transporte indisponível.')
    return key
  }
  async function requisitar(rota:string,body?:unknown) {
    const r=await fetcher(BASE+rota,{method:body===undefined?'GET':'POST',headers:{apikey:await credencial(),...(body!==undefined?{'Content-Type':'application/json'}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)})
    if(!r.ok)throw new Error('Transporte indisponível; conferir o recibo antes de repetir.')
    return r.json()
  }
  return {
    async conferir() {
      const config=JSON.parse(await fs.readFile(path.join(home,'.local/share/whatsapp-identidades/config.json'),'utf8'))
      if(config.v!==1||typeof config.identidadePrumoHash!=='string'||!/^[a-f0-9]{64}$/.test(config.identidadePrumoHash))throw new Error('Âncora da conta inválida.')
      const instancias=await requisitar('/instance/fetchInstances?instanceName=prumo')
      const i=Array.isArray(instancias)&&instancias.length===1?instancias[0]:null
      const jid=typeof i?.ownerJid==='string'?i.ownerJid.replace(/:\d+(?=@s\.whatsapp\.net$)/,''):''
      if(i?.name!=='prumo'||i.connectionStatus!=='open'||!/^\d{10,15}@s\.whatsapp\.net$/.test(jid)||sha(jid)!==config.identidadePrumoHash)
        throw new Error('A conta conectada não confere com a âncora autorizada.')
    },
    async enviar(numero,texto) {
      if(!/^55\d{10,11}$/.test(numero)||!texto.trim()||texto.length>1200)throw new Error('Destino ou mensagem inválidos.')
      const r=await requisitar('/message/sendText/prumo',{number:numero,text:texto,linkPreview:false})
      const k=r?.key,remoto=typeof k?.remoteJid==='string'&&/^\d+@s\.whatsapp\.net$/.test(k.remoteJid)?k.remoteJid.split('@')[0]:null
      if(k?.fromMe!==true||typeof k?.id!=='string'||!k.id||k.id.length>200||!remoto||chaveDaConversaBrasil(remoto)!==chaveDaConversaBrasil(numero))
        throw new Error('Envio sem recibo inequívoco da conversa.')
      return k.id
    },
  }
}
