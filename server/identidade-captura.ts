import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { hashCanonicoComercial } from './registro-comercial-duravel.ts'

export interface ConfigIdentidadeCaptura { v:1; identidadePrumoHash:string; desde:string }
export interface MensagemIdentidadeCaptura { idOriginal:string; direcao:'entrada'|'saida'; ocorridoEm:string; conteudoHash:string }
export interface ProvaIdentidadeCaptura {
  v:1; coletor:'hermes'|'evolution'; contaHash:string; garantia:'socket-hermes'|'webhook-evolution'
  sessaoHash:string|null; instancia:'prumo'|null; capturadoEm:string; mensagem:MensagemIdentidadeCaptura
}
/** Assinatura é invalidação de contexto, não assinatura criptográfica da captura. */
export interface FonteIdentidadeCaptura { ativa:boolean; assinatura:string; config?:ConfigIdentidadeCaptura; jsonl:string; erro?:string }
export type ConferenciaIdentidadeCaptura = { estado:'legado'|'verificada'|'ausente'|'conflito'; assinatura:string; motivo:string }
export type LeitorIdentidadeCaptura = (conversa?:string)=>Promise<FonteIdentidadeCaptura>
const objeto=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const exato=(v:Record<string,unknown>,ks:string[])=>Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k))
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const instante=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19)
export function validarConfigIdentidadeCaptura(v:unknown):ConfigIdentidadeCaptura {
  if(!objeto(v)||!exato(v,['v','identidadePrumoHash','desde'])||v.v!==1||!sha(v.identidadePrumoHash)||!instante(v.desde))throw new Error('Configuração de identidade inválida.')
  return {v:1,identidadePrumoHash:v.identidadePrumoHash,desde:v.desde}
}
export function validarProvaIdentidadeCaptura(v:unknown):ProvaIdentidadeCaptura {
  if(!objeto(v)||!exato(v,['v','coletor','contaHash','garantia','sessaoHash','instancia','capturadoEm','mensagem'])||v.v!==1||!sha(v.contaHash)||!instante(v.capturadoEm)
    ||!objeto(v.mensagem)||!exato(v.mensagem,['idOriginal','direcao','ocorridoEm','conteudoHash']))throw new Error('Prova de captura inválida.')
  const m=v.mensagem
  if(typeof m.idOriginal!=='string'||!m.idOriginal||m.idOriginal.length>200||/\s|[\u0000-\u001f\u007f]/.test(m.idOriginal)||!['entrada','saida'].includes(String(m.direcao))||!instante(m.ocorridoEm)||!sha(m.conteudoHash))throw new Error('Mensagem da prova inválida.')
  if(!(v.coletor==='hermes'&&v.garantia==='socket-hermes'&&sha(v.sessaoHash)&&v.instancia===null
    ||v.coletor==='evolution'&&v.garantia==='webhook-evolution'&&v.sessaoHash===null&&v.instancia==='prumo'))throw new Error('Garantia de captura incompatível.')
  return structuredClone(v) as unknown as ProvaIdentidadeCaptura
}
/** Conjunto sem ordem/repetição: retries não mudam contexto, sessões e conflitos mudam. */
export function assinaturaProvasCaptura(config:ConfigIdentidadeCaptura,jsonl:string,agora=Date.now(),erro:string|null=null):string {
  const entradas=new Set<string>()
  for(const linha of jsonl.split('\n')){
    if(!linha.trim())continue
    try{
      const p=validarProvaIdentidadeCaptura(JSON.parse(linha)),{capturadoEm,...prova}=p
      const estado=Date.parse(capturadoEm)<Date.parse(config.desde)?'anterior':Date.parse(capturadoEm)>agora?'futura':'vigente'
      entradas.add(hashCanonicoComercial({...prova,estado,...(estado!=='vigente'?{capturadoEm}:{})}))
    }catch{entradas.add(hashCanonicoComercial({invalida:createHash('sha256').update(linha,'utf8').digest('hex')}))}
  }
  return hashCanonicoComercial({config,provas:[...entradas].sort(),erro})
}
/** Sem config conserva o leitor legado. Arquivo inválido ou inacessível não desativa a proteção. */
export function criarLeitorIdentidadeCaptura(pasta=path.join(os.homedir(),'.local/share/whatsapp-identidades'),agora:()=>number=Date.now):LeitorIdentidadeCaptura {
  const raiz=path.resolve(pasta),limite=8*1024*1024
  const ler=async(nome:string)=>{
    const h=await fs.open(path.join(raiz,nome),'r')
    try{const s=await h.stat();if(!s.isFile()||s.size>limite)throw new Error('Limite da prova.');const b=Buffer.alloc(limite+1),r=await h.read(b,0,b.length,0);if(r.bytesRead>limite)throw new Error('Limite da prova.');return b.subarray(0,r.bytesRead).toString('utf8')}finally{await h.close()}
  }
  const ausente=async(nome:string)=>{try{await fs.lstat(path.join(raiz,nome));return false}catch(e){return (e as NodeJS.ErrnoException).code==='ENOENT'}}
  return async conversa=>{
    if(conversa!==undefined&&!/^[1-9][0-9]{9}$/.test(conversa))throw new Error('Conversa de captura inválida.')
    // Marcador persistente criado pelo deploy ANTES da config. Nunca é criado pelo leitor.
    let obrigatoria=false,marcadorTexto:string
    try{
      marcadorTexto=await ler('obrigatoria.json');obrigatoria=true
      let marcador:unknown
      try{marcador=JSON.parse(marcadorTexto)}catch{return {ativa:true,assinatura:hashCanonicoComercial({marcadorTexto}),jsonl:'',erro:'Marcador de identidade obrigatório inválido; confira a configuração.'}}
      if(!objeto(marcador)||!exato(marcador,['v'])||marcador.v!==1)return {ativa:true,assinatura:hashCanonicoComercial({marcadorTexto}),jsonl:'',erro:'Marcador de identidade obrigatório inválido; confira a configuração.'}
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT'||!await ausente('obrigatoria.json'))return {ativa:true,assinatura:hashCanonicoComercial('marcador-indisponivel'),jsonl:'',erro:'Marcador de identidade obrigatório indisponível; confira a configuração.'}}
    let configTexto:string
    try{configTexto=await ler('config.json')}catch(e){
      if((e as NodeJS.ErrnoException).code==='ENOENT'&&!obrigatoria&&await ausente('config.json'))return {ativa:false,assinatura:hashCanonicoComercial('identidade-legada'),jsonl:''}
      return {ativa:true,assinatura:hashCanonicoComercial({obrigatoria,config:'indisponivel'}),jsonl:'',erro:'Configuração de identidade indisponível; confira a captura.'}
    }
    let config:ConfigIdentidadeCaptura
    try{config=validarConfigIdentidadeCaptura(JSON.parse(configTexto))}catch{return {ativa:true,assinatura:hashCanonicoComercial({configTexto}),jsonl:'',erro:'Configuração de identidade inválida; confira a captura.'}}
    let jsonl='',erro:string|undefined
    if(conversa)try{jsonl=await ler(conversa+'.jsonl')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')erro='Provas da captura indisponíveis; confira a fonte privada.'}
    return {ativa:true,config,jsonl,assinatura:assinaturaProvasCaptura(config,jsonl,agora(),erro??null),...(erro?{erro}:{})}
  }
}
/** Confere a tuple exata. Origem do coletor gravada no JSONL não identifica a conta. */
export function conferirIdentidadeCaptura(mensagem:MensagemIdentidadeCaptura,fonte:FonteIdentidadeCaptura,agora=Date.now()):ConferenciaIdentidadeCaptura {
  const base={assinatura:fonte.assinatura}
  if(!fonte.ativa)return {...base,estado:'legado',motivo:'Conferência legada sem configuração de identidade.'}
  if(fonte.erro||!fonte.config||Date.parse(fonte.config.desde)>agora)return {...base,estado:'conflito',motivo:fonte.erro??'Configuração de identidade exige revisão.'}
  const provas:ProvaIdentidadeCaptura[]=[]
  for(const linha of fonte.jsonl.split('\n')){
    if(!linha.trim())continue
    let p:ProvaIdentidadeCaptura
    try{p=validarProvaIdentidadeCaptura(JSON.parse(linha))}catch{return {...base,estado:'conflito',motivo:'Há prova de captura inválida; confira a fonte privada.'}}
    if(p.mensagem.idOriginal!==mensagem.idOriginal||p.mensagem.direcao!==mensagem.direcao)continue
    if(Date.parse(p.capturadoEm)>agora)return {...base,estado:'conflito',motivo:'Há prova de captura com horário futuro; confira a fonte privada.'}
    if(Date.parse(p.capturadoEm)<Date.parse(fonte.config.desde))continue
    if(p.mensagem.ocorridoEm!==mensagem.ocorridoEm||p.mensagem.conteudoHash!==mensagem.conteudoHash)return {...base,estado:'conflito',motivo:'A prova diverge do registro original; confira a captura.'}
    provas.push(p)
  }
  if(!provas.length)return {...base,estado:'ausente',motivo:'Conta da captura ainda sem prova verificável; revisão interna necessária.'}
  if(provas.some(p=>p.contaHash!==fonte.config!.identidadePrumoHash))return {...base,estado:'conflito',motivo:'A captura não comprova a mesma conta configurada; revisão interna necessária.'}
  // Duplicatas, coletores e sessões diferentes da MESMA conta não criam novas mensagens.
  return {...base,estado:'verificada',motivo:'Conta conferida com a prova e o registro original.'}
}
export function mensagemDaCaptura(v:unknown):MensagemIdentidadeCaptura|null {
  if(!objeto(v)||typeof v.id!=='string'||!v.id||!['entrada','saida'].includes(String(v.direcao))||!instante(v.em)||typeof v.texto!=='string')return null
  return {idOriginal:v.id,direcao:v.direcao as 'entrada'|'saida',ocorridoEm:v.em,conteudoHash:createHash('sha256').update(v.texto,'utf8').digest('hex')}
}