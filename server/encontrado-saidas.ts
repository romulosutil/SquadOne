import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface SaidaEncontrado {
  v:1; chave:string; conversa:string; leadId:string; em:string; entradaEm:string
  politicaHash:string; contextoHash:string; textoHash:string; modelo:string
  estado:'reservada'|'incerta'|'enviada'|'cancelada'; recibo?:string
  entradaChave?:string
  materiais?:string[]
  propostaId?:string
}
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const instante=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))
function validar(v:unknown):SaidaEncontrado {
  const r=v as SaidaEncontrado
  if(!r||r.v!==1||!sha(r.chave)||!sha(r.politicaHash)||!sha(r.contextoHash)||!sha(r.textoHash)
    ||!/^\d{10}$/.test(r.conversa)||typeof r.leadId!=='string'||!r.leadId||!instante(r.em)||!instante(r.entradaEm)
    ||typeof r.modelo!=='string'||!/^[a-z+-]{1,100}$/.test(r.modelo)||!['reservada','incerta','enviada','cancelada'].includes(r.estado)
    ||r.entradaChave!==undefined&&!sha(r.entradaChave)||r.propostaId!==undefined&&!sha(r.propostaId)||r.materiais!==undefined&&(!Array.isArray(r.materiais)||r.materiais.length<1||r.materiais.length>2||!r.materiais.every(sha))||r.estado==='enviada'&&(typeof r.recibo!=='string'||!r.recibo||r.recibo.length>200))throw new Error('Reserva de resposta inválida.')
  return r
}
/** Journal operacional privado. Nunca é outra fonte de negociação nem apaga reservas por prazo. */
export class SaidasEncontrado {
  constructor(readonly pasta:string){}
  private arquivo(chave:string){if(!sha(chave))throw new Error('Chave inválida.');return path.join(this.pasta,chave+'.json')}
  private async sincronizarDiretorio(){if(process.platform!=='win32'){const h=await fs.open(this.pasta,'r');try{await h.sync()}finally{await h.close()}}}
  async falhaTecnica(chave:string,em:string):Promise<void> {
    this.arquivo(chave)
    if(!instante(em))throw new Error('Data de falha inválida.')
    await fs.mkdir(this.pasta,{recursive:true,mode:0o700})
    let h:Awaited<ReturnType<typeof fs.open>>
    try{h=await fs.open(path.join(this.pasta,chave+'.falha.json'),'wx',0o600)}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return;throw e}
    try{await h.writeFile(JSON.stringify({v:1,chave,em}));await h.sync()}finally{await h.close()}
    await this.sincronizarDiretorio()
  }
  async primeiraFalha(chave:string):Promise<string|null> {
    this.arquivo(chave)
    try{const r=JSON.parse(await fs.readFile(path.join(this.pasta,chave+'.falha.json'),'utf8'));if(r.v!==1||r.chave!==chave||!instante(r.em))throw new Error('Falha ilegível.');return r.em}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e}
  }
  async listar():Promise<SaidaEncontrado[]> {
    let nomes:string[]
    try{nomes=await fs.readdir(this.pasta)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}
    return Promise.all(nomes.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(async n=>validar(JSON.parse(await fs.readFile(path.join(this.pasta,n),'utf8')))))
  }
  async reservar(entrada:SaidaEncontrado):Promise<boolean> {
    const r=validar(entrada)
    if(r.estado!=='reservada')throw new Error('Reserva inicial inválida.')
    await fs.mkdir(this.pasta,{recursive:true,mode:0o700})
    let h:Awaited<ReturnType<typeof fs.open>>
    try{h=await fs.open(this.arquivo(r.chave),'wx',0o600)}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return false;throw e}
    try{await h.writeFile(JSON.stringify(r));await h.sync()}finally{await h.close()}
    await this.sincronizarDiretorio();return true
  }
  /** Chamador conserva a trava compartilhada da conversa até concluir a substituição. */
  async concluir(chave:string,estado:SaidaEncontrado['estado'],recibo?:string):Promise<void> {
    const arquivo=this.arquivo(chave),r=validar(JSON.parse(await fs.readFile(arquivo,'utf8')))
    if(r.estado==='enviada'||r.estado==='cancelada')return
    const novo=validar({...r,estado,...(recibo?{recibo}:{})}),temp=arquivo+'.'+randomUUID()+'.tmp'
    const h=await fs.open(temp,'wx',0o600)
    try{await h.writeFile(JSON.stringify(novo));await h.sync()}finally{await h.close()}
    try{await fs.rename(temp,arquivo);await this.sincronizarDiretorio()}finally{await fs.unlink(temp).catch(()=>undefined)}
  }
}
