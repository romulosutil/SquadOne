import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { hashCanonicoComercial } from './registro-comercial-duravel.ts'
import { normalizar } from '../src/operations/colinha.ts'
import { VERSAO_QUALIFICACAO_ENCONTRADO, PERGUNTAS_ENCONTRADO, type QualificacaoEncontrado, type EvidenciaEncontrado } from '../src/operations/encontrado-qualificacao.ts'

export interface MensagemQualificacao { id:string;em:string;hash:string;direcao:'entrada'|'saida';texto:string }
export const HASH_QUALIFICACAO_ENCONTRADO=hashCanonicoComercial({versao:VERSAO_QUALIFICACAO_ENCONTRADO,esquema:1,perguntas:PERGUNTAS_ENCONTRADO})
const simples=(s:string)=>normalizar(s).trim()
const ciente=(s:string)=>/^(?:ok|certo|entendi|obrigad[oa]|valeu|beleza|sim|nao)[!.,\s]*$/.test(s)
export function recusaMaterial(s:string){return /\b(?:nao (?:quero|queremos|precis\w*|(?:me )?(?:envie|mande|manda|envia|mostre)|agora|pode)|depois|mais tarde|pare|cancele|cancelar|esqueca)\b|^nao[!.,\s]*$/.test(simples(s))}
/** Leitura local, sem modelo, rede ou instruções interpretadas como comandos. */
export function extrairQualificacaoEncontrado(ms:readonly MensagemQualificacao[],desde:string):QualificacaoEncontrado {
  const q:QualificacaoEncontrado={materiais:[]}
  for(let i=0;i<ms.length;i++){
    const m=ms[i];if(m.direcao!=='entrada'||Date.parse(m.em)<Date.parse(desde)||m.texto.length>1000)continue
    const s=simples(m.texto),a=ms[i-1],anterior=a?.direcao==='saida'?a.texto:''
    const e:EvidenciaEncontrado={id:m.id,em:m.em,hash:m.hash,trecho:m.texto.slice(0,500)}
    if(recusaMaterial(s)){q.materiais=[];if(/\b(?:so|apenas|somente) pesquis|pesquisando|pesquisa por enquanto/.test(s))q.intencao={tipo:'pesquisando',evidencia:e};continue}
    const pergunta=/\?/.test(s)
    // Permissão genérica só vale quando o material é único na oferta imediatamente anterior.
    const demo=/\b(?:demo|previa|exemplo|modelo)\b/.test(s),raio=/raio[ -]?x|diagnostico/.test(s)
    const permissao=/^(?:(?:sim|claro|pode|ok|quero)[!, .]*)?(?:pode (?:mandar|enviar|mostrar|preparar)|mande|manda|envie|envia|sim,? pode)[!.,\s]*$|^(?:sim|claro|pode|ok)[!.,\s]*$/.test(s)
    const oferta=simples(anterior),ofereceuDemo=/\b(?:demo|previa|exemplo|modelo)\b/.test(oferta),ofereceuRaio=/raio[ -]?x|diagnostico/.test(oferta)
    const incerto=/\b(?:talvez|nao sei|se eu|quando eu|queria saber|gostaria de saber)\b/.test(s)
    const direto=/(?:^|[.!;,]\s*)(?:eu )?(?:quero|gostaria de) (?:ver|receber|avaliar|(?:um |uma |a |o )?(?:demo|previa|exemplo|modelo|raio[ -]?x|diagnostico))\b|^(?:(?:voce|voces) )?(?:pode|poderia) (?:me )?(?:mandar|enviar|mostrar|preparar|fazer|gerar)\b|^(?:manda|mande|envia|envie|mostre|prepare)\b/.test(s)
    const pediu=!incerto&&(direto||permissao||anterior===PERGUNTAS_ENCONTRADO.material&&/^(?:a |o )?(?:demo|previa|raio[ -]?x|diagnostico)[!.,\s]*$/.test(s))
    const tipos:Array<'demo'|'raio-x'>=[]
    if(pediu&&demo||permissao&&ofereceuDemo&&!ofereceuRaio)tipos.push('demo')
    if(pediu&&raio||permissao&&ofereceuRaio&&!ofereceuDemo)tipos.push('raio-x')
    for(const tipo of tipos)q.materiais=[...q.materiais.filter(r=>r.tipo!==tipo),{tipo,evidencia:e}]
    if(/\b(?:so|apenas|somente) pesquis|pesquisando|pesquisa por enquanto/.test(s))q.intencao={tipo:'pesquisando',evidencia:e}
    else if(!pergunta&&/\b(?:quero|preciso|gostaria de|estou (?:avaliando|procurando))\b.{0,45}\bsite\b/.test(s))q.intencao={tipo:'avaliando',evidencia:e}
    if(pergunta||ciente(s)||tipos.length)continue
    if(anterior===PERGUNTAS_ENCONTRADO.necessidade||anterior===PERGUNTAS_ENCONTRADO.esclarecer
      ||/\b(?:preciso|quero|gostaria)\b.{0,80}\b(?:mostrar|divulgar|servicos|endereco|whatsapp|catalogo|contato|aparecer|encontrar)\b/.test(s))q.necessidade=e
    if(anterior===PERGUNTAS_ENCONTRADO.decisao||/\b(?:eu (?:mesm[oa]|decido|aprovo)|sou (?:o dono|a dona|responsavel)|meu soci[oa]|minha soci[oa]|(?:eu e|com) (?:o |a |meu |minha )?soci[oa])\b/.test(s))q.decisao=e
  }
  return q
}
interface Cache {v:1;chave:string;em:string;resultado:QualificacaoEncontrado}
export class QualificadorEncontrado {
  constructor(readonly pasta:string,private agora:()=>number=Date.now){}
  chave(ms:readonly MensagemQualificacao[],desde:string){return hashCanonicoComercial({ms,desde,versao:HASH_QUALIFICACAO_ENCONTRADO})}
  async ler(ms:readonly MensagemQualificacao[],desde:string):Promise<Cache|null>{
    const chave=this.chave(ms,desde)
    try{const c=JSON.parse(await fs.readFile(path.join(this.pasta,chave+'.json'),'utf8')) as Cache
      if(c.v!==1||c.chave!==chave||!Number.isFinite(Date.parse(c.em))||hashCanonicoComercial(c.resultado)!==hashCanonicoComercial(extrairQualificacaoEncontrado(ms,desde)))throw new Error('Observação inválida.')
      return c
    }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e}
  }
  /** Persistência só no executor; GET não interpreta nem grava conversas. */
  async executar(ms:readonly MensagemQualificacao[],desde:string):Promise<void>{
    if(await this.ler(ms,desde))return
    const chave=this.chave(ms,desde),c:Cache={v:1,chave,em:new Date(this.agora()).toISOString(),resultado:extrairQualificacaoEncontrado(ms,desde)}
    await fs.mkdir(this.pasta,{recursive:true,mode:0o700});const a=path.join(this.pasta,chave+'.json'),t=a+'.'+randomUUID()+'.tmp'
    const h=await fs.open(t,'wx',0o600);try{await h.writeFile(JSON.stringify(c));await h.sync()}finally{await h.close()}
    await fs.rename(t,a)
    if(process.platform!=='win32'){const d=await fs.open(this.pasta,'r');try{await d.sync()}finally{await d.close()}}
  }
}
