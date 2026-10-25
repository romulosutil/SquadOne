import {createHash} from 'node:crypto'
import type {ParteEncontrado} from '../src/operations/encontrado-proposta.ts'

export const API_AUTENTIQUE='https://api.autentique.com.br/v2/graphql'
export class ErroAutentique extends Error {constructor(readonly codigo:'indisponivel'|'credencial'|'resposta'|'conferencia'|'franquia'|'plano'){super('Autentique: '+codigo)}}
export interface DocumentoAutentique {
  id:string;name:string;created_at:string;sandbox?:boolean|number;deleted_at?:string|null
  files?:{original?:string|null;signed?:string|null}
  signatures:Array<{public_id:string;name:string|null;email:string|null;action:{name:string};link?:{short_link:string}|null;
    signed?:{created_at:string}|null;rejected?:{created_at:string}|null;signed_unapproved?:{created_at:string}|null;biometric_rejected?:{created_at:string}|null}>
}
const CAMPOS_DOCUMENTO='id name created_at sandbox deleted_at files { original signed } signatures { public_id name email action { name } link { short_link } signed { created_at } rejected { created_at } signed_unapproved { created_at } biometric_rejected { created_at } }'
const idValido=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9-]{10,128}$/.test(v)
const dataValida=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))
export function validarDocumentoAutentique(v:unknown):DocumentoAutentique {
  const d=v as DocumentoAutentique
  if(!d||!idValido(d.id)||typeof d.name!=='string'||!dataValida(d.created_at)||!Array.isArray(d.signatures)||d.signatures.length>20)throw new ErroAutentique('resposta')
  for(const s of d.signatures)if(!idValido(s.public_id)||!s.action||typeof s.action.name!=='string'||s.name!==null&&typeof s.name!=='string'||s.email!==null&&typeof s.email!=='string')throw new ErroAutentique('resposta')
  return d
}
export function linkAssinaturaAutentique(v:unknown):string {
  if(typeof v!=='string')throw new ErroAutentique('conferencia')
  const u=new URL(v)
  if(u.protocol!=='https:'||u.hostname!=='assina.ae'||u.port||u.username||u.password||u.search||u.hash||!/^\/[A-Za-z0-9_-]{8,160}$/.test(u.pathname))throw new ErroAutentique('conferencia')
  return u.href
}
export function arquivoAutentiqueUrl(v:unknown):string{
  if(typeof v!=='string')throw new ErroAutentique('conferencia')
  const u=new URL(v)
  if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||!['storage.googleapis.com','painel.autentique.com.br'].includes(u.hostname)||!u.pathname.toLowerCase().endsWith('.pdf'))throw new ErroAutentique('conferencia')
  return u.href
}
export function conferirSignatarioAutentique(d:DocumentoAutentique,cliente:ParteEncontrado,nomeDocumento:string,agora=Date.now()){
  const n=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR')
  if(d.name!==nomeDocumento||d.deleted_at||d.sandbox!==false&&d.sandbox!==0||Date.parse(d.created_at)>agora||d.signatures.length!==1)throw new ErroAutentique('conferencia')
  const s=d.signatures[0]
  if(n(s.action.name)!=='sign'||n(s.email??'')!==n(cliente.email)||n(s.name??'')!==n(cliente.representante))throw new ErroAutentique('conferencia')
  for(const ev of [s.signed,s.rejected,s.signed_unapproved,s.biometric_rejected])if(ev&&(!dataValida(ev.created_at)||Date.parse(ev.created_at)>agora||Date.parse(ev.created_at)<Date.parse(d.created_at)))throw new ErroAutentique('conferencia')
  return s
}
async function bytesLimitados(r:Response,limite:number):Promise<Uint8Array>{
  if(!r.ok||!r.body)throw new ErroAutentique('indisponivel')
  const leitor=r.body.getReader(),partes:Uint8Array[]=[],limites={n:0}
  try{while(true){const p=await leitor.read();if(p.done)break;limites.n+=p.value.length;if(limites.n>limite)throw new ErroAutentique('resposta');partes.push(p.value)}}finally{await leitor.cancel().catch(()=>undefined)}
  return Buffer.concat(partes)
}
/** Sem retries em mutations, sem assinatura pela conta do operador, sem redirects com token. */
export class Autentique {
  constructor(private token:string,private fetcher:typeof fetch=fetch){if(!token.trim()||token.length>4096||/[\s\u0000-\u001f]/.test(token))throw new ErroAutentique('credencial')}
  private async chamada(query:string,variables:Record<string,unknown>={},upload?:{html:string;nome:string}):Promise<Record<string,any>>{
    let body:BodyInit,headers:Record<string,string>={Authorization:'Bearer '+this.token}
    if(upload){
      const f=new FormData();f.set('operations',JSON.stringify({query,variables}));f.set('map',JSON.stringify({file:['variables.file']}));f.set('file',new Blob([upload.html],{type:'text/html;charset=utf-8'}),upload.nome+'.html');body=f
    }else{headers['Content-Type']='application/json';body=JSON.stringify({query,variables})}
    try{
      const r=await this.fetcher(API_AUTENTIQUE,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(20000)})
      if([401,403].includes(r.status))throw new ErroAutentique('credencial')
      const v=JSON.parse(Buffer.from(await bytesLimitados(r,2*1024*1024)).toString('utf8'))
      if(v.errors||!v.data||typeof v.data!=='object')throw new ErroAutentique('resposta')
      return v.data
    }catch(e){if(e instanceof ErroAutentique)throw e;throw new ErroAutentique('indisponivel')}
  }
  async conta(){
    const v=(await this.chamada('query { me { id name email subscription { has_premium_features } organization { id name cnpj } } }')).me
    if(!v||!idValido(v.id)||typeof v.email!=='string')throw new ErroAutentique('resposta')
    return {id:v.id,nome:String(v.name??''),email:v.email,gratuita:v.subscription?.has_premium_features===false,organizacao:v.organization?{id:String(v.organization.id),nome:String(v.organization.name??''),cnpj:v.organization.cnpj as string|null}:null}
  }
  async criar(nome:string,html:string,cliente:ParteEncontrado,validaAte:string,sandbox=false):Promise<DocumentoAutentique>{
    const query=`mutation CriarEncontrado($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) { createDocument(sandbox: ${sandbox?'true':'false'}, document: $document, signers: $signers, file: $file) { ${CAMPOS_DOCUMENTO} } }`
    const variables={document:{name:nome,refusable:true,stop_on_rejected:true,deadline_at:validaAte,ignore_birthdate:true,locale:{country:'BR',language:'pt-BR',timezone:'America/Sao_Paulo'},configs:{notification_finished:false,notification_signed:false}},signers:[{name:cliente.representante,email:cliente.email,delivery_method:'DELIVERY_METHOD_LINK',action:'SIGN'}],file:null}
    return validarDocumentoAutentique((await this.chamada(query,variables,{html,nome})).createDocument)
  }
  async documento(id:string):Promise<DocumentoAutentique>{
    if(!idValido(id))throw new ErroAutentique('conferencia')
    return validarDocumentoAutentique((await this.chamada(`query { document(id:${JSON.stringify(id)}) { ${CAMPOS_DOCUMENTO} } }`)).document)
  }
  async localizar(nome:string,sandbox=false):Promise<DocumentoAutentique|null>{
    const achados:DocumentoAutentique[]=[]
    for(let page=1;page<=10;page++){
      const v=(await this.chamada(`query { documents(limit:60,page:${page},${sandbox?'onlySandbox:true':'showSandbox:false'}) { total data { ${CAMPOS_DOCUMENTO} } } }`)).documents
      if(!v||!Array.isArray(v.data)||!Number.isInteger(v.total))throw new ErroAutentique('resposta')
      for(const d of v.data)if(d.name===nome)achados.push(validarDocumentoAutentique(d))
      if(achados.length>1)throw new ErroAutentique('conferencia')
      if(page*60>=v.total)return achados[0]??null
    }
    throw new ErroAutentique('conferencia')
  }
  async original(d:DocumentoAutentique):Promise<{hash:string;bytes:Uint8Array}>{
    if(!d.files?.original)throw new ErroAutentique('indisponivel')
    const u=new URL(arquivoAutentiqueUrl(d.files?.original))
    try{
      // Não encaminhar o Bearer para o storage; URL vem da consulta autenticada do documento.
      const r=await this.fetcher(u.href,{redirect:'error',signal:AbortSignal.timeout(20000)})
      const bytes=await bytesLimitados(r,20*1024*1024)
      if(Buffer.from(bytes.subarray(0,5)).toString()!=='%PDF-')throw new ErroAutentique('indisponivel')
      return {hash:createHash('sha256').update(bytes).digest('hex'),bytes}
    }catch(e){if(e instanceof ErroAutentique)throw e;throw new ErroAutentique('indisponivel')}
  }
}
