import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { hashCanonicoComercial } from './registro-comercial-duravel.ts'
import type { CrmLead } from '../src/operations/types.ts'
import type { EvidenciaEncontrado } from '../src/operations/encontrado-qualificacao.ts'

export interface PedidoMaterialEncontrado {
  v:1;id:string;entradaChave:string;conversa:string;leadId:string;placeId:string;slug:string
  tipo:'demo'|'raio-x';evidencia:EvidenciaEncontrado;politicaHash:string;em:string
}
export interface ResultadoMaterialEncontrado {
  v:1;id:string;estado:'preparando'|'pronto'|'falha'|'incerto';em:string
  url?:string;versao?:string;referencia?:string;qualidade?:'homologacao'|'profissional'
}
const hash=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)
const slug=(s:unknown):s is string=>typeof s==='string'&&/^[a-z0-9][a-z0-9_-]{0,179}$/.test(s)
export const idPedidoMaterial=(leadId:string,tipo:PedidoMaterialEncontrado['tipo'],evidencia:EvidenciaEncontrado,politicaHash:string)=>hashCanonicoComercial({leadId,tipo,evidencia,politicaHash})
export const chaveSaidaMaterial=(id:string)=>hashCanonicoComercial({material:id})
export function validarPedidoMaterial(v:unknown):PedidoMaterialEncontrado {
  const r=v as PedidoMaterialEncontrado
  if(!r||r.v!==1||!hash(r.id)||!hash(r.entradaChave)||!hash(r.politicaHash)||!/^\d{10}$/.test(r.conversa)||typeof r.leadId!=='string'||!r.leadId||typeof r.placeId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(r.placeId)||!slug(r.slug)||!['demo','raio-x'].includes(r.tipo)||!Number.isFinite(Date.parse(r.em))||!r.evidencia||!hash(r.evidencia.hash)||typeof r.evidencia.id!=='string'||!Number.isFinite(Date.parse(r.evidencia.em)))throw new Error('Pedido de material inválido.')
  return r
}
export function validarResultadoMaterial(v:unknown,id:string):ResultadoMaterialEncontrado {
  const r=v as ResultadoMaterialEncontrado
  if(!r||r.v!==1||r.id!==id||!['preparando','pronto','falha','incerto'].includes(r.estado)||!Number.isFinite(Date.parse(r.em)))throw new Error('Resultado de material inválido.')
  if(r.estado==='pronto'){
    const u=new URL(r.url??'')
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||!u.hostname.endsWith('.vercel.app')||!/^sha256:[a-f0-9]{64}$/.test(r.versao??'')||!/^lead:[a-f0-9]{24}$/.test(r.referencia??'')||!['homologacao','profissional'].includes(r.qualidade??''))throw new Error('Material não comprovado.')
  }
  return r
}
/** Pedidos imutáveis; resultados técnicos não são qualificação, envio ou aceite. */
export class MateriaisEncontrado {
  constructor(readonly pasta:string,private verificar?:(id:string)=>Promise<unknown>){}
  async pedir(l:CrmLead,chave:string,conversa:string,tipo:PedidoMaterialEncontrado['tipo'],evidencia:EvidenciaEncontrado,politicaHash:string,em:string):Promise<PedidoMaterialEncontrado>{
    const id=idPedidoMaterial(l.id,tipo,evidencia,politicaHash)
    const r=validarPedidoMaterial({v:1,id,entradaChave:chave,conversa,leadId:l.id,placeId:l.chave,slug:l.pasta?.slug,tipo,evidencia,politicaHash,em})
    await fs.mkdir(this.pasta,{recursive:true,mode:0o700})
    // Um arquivo completo passa a existir de uma vez. Link exclusivo protege dois executores.
    const temp=path.join(this.pasta,id+'.'+process.pid+'.tmp'),dest=path.join(this.pasta,id+'.json')
    const h=await fs.open(temp,'wx',0o600)
    try{await h.writeFile(JSON.stringify(r));await h.sync()}finally{await h.close()}
    try{await fs.link(temp,dest)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}finally{await fs.unlink(temp)}
    if(process.platform!=='win32'){const d=await fs.open(this.pasta,'r');try{await d.sync()}finally{await d.close()}}
    return validarPedidoMaterial(JSON.parse(await fs.readFile(dest,'utf8')))
  }
  async listar():Promise<PedidoMaterialEncontrado[]>{
    let ns:string[];try{ns=await fs.readdir(this.pasta)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}
    return Promise.all(ns.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(async n=>validarPedidoMaterial(JSON.parse(await fs.readFile(path.join(this.pasta,n),'utf8')))))
  }
  async resultado(id:string):Promise<ResultadoMaterialEncontrado|null>{
    if(!hash(id))throw new Error('Pedido inválido.')
    try{return validarResultadoMaterial(JSON.parse(await fs.readFile(path.join(this.pasta,id+'.resultado.json'),'utf8')),id)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e}
  }
  async conferir(id:string):Promise<ResultadoMaterialEncontrado|null>{
    if(!hash(id)||!this.verificar)return null
    const r=validarResultadoMaterial(await this.verificar(id),id);return r.estado==='pronto'?r:null
  }
}
export function verificadorMaterialEncontrado(operationsDir:string){return async(id:string):Promise<unknown>=>{
  const {stdout}=await promisify(execFile)('python3',[path.join(os.homedir(),'SquadOne/deploy/dell/encontrado-materiais.py'),'--conferir',id],{timeout:20000,maxBuffer:8192,env:{...process.env,SQUADONE_OPERATIONS_DATA_DIR:operationsDir}})
  return JSON.parse(stdout)
}}
