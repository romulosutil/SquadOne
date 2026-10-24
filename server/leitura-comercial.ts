import type {Router} from 'express'
import {createHash} from 'node:crypto'
import type {CrmLead,CrmVisao} from '../src/operations/types.ts'
import {mascarar,resumoComercialParaContexto} from '../src/operations/copiloto.ts'
import {prepararTexto,semValores} from '../src/operations/assistente.ts'
import {projetarResponsavelConversa} from '../src/operations/responsavel-conversa.ts'
import {contatoPausado} from '../src/operations/aprendizado-comercial.ts'
import {procedimentoDaDecisao} from '../src/office/procedimento-da-decisao.ts'
import {revisaoRetomadaDoLead} from '../src/operations/revisao-retomadas.ts'
import {filaDeVenda} from '../src/operations/proxima-venda.ts'
import {acaoInternaComercial} from '../src/operations/acao-interna-comercial.ts'

export const ROTA_LEITURA_COMERCIAL='/api/operations/crm/leitura-comercial'
export const MAX_IDADE_LEITURA_COMERCIAL_MS=15*60_000
const MAX_RESULTADOS=20
export type FonteLeituraComercial=Pick<CrmVisao,'leads'|'hoje'|'estado'|'geradoEm'> & Partial<Pick<CrmVisao,'ultimaFalha'|'fontes'>>
export interface DependenciasLeituraComercial {
  visao:()=>Promise<FonteLeituraComercial>
  bloqueioConversa:(lead:CrmLead,leads:readonly CrmLead[])=>Promise<string|null>
  origemCentral?:string
  agora?:()=>number
}
export type MotivoLeituraComercial='encerramento'|'recusa-ou-exclusao'|'pausa'|'espera'|'revisao-pendente'|'qualificacao-invalida'|'qualificacao-negativa'|'ciclo-comercial'|'responsabilidade-humana'|'responsabilidade-indefinida'|'identidade-ou-registro-pendente'|'atendimento-interno'|'conteudo-ou-autoria-pendente'|'decisao-comercial-humana'
export interface OportunidadeLeituraComercial {
  referencia:string;empresa:string;produto:CrmLead['produto'];etapa:CrmLead['etapa']
  autoridade:ReturnType<typeof resumoComercialParaContexto>['autoridade']
  qualificacao:Omit<ReturnType<typeof resumoComercialParaContexto>['qualificacao'],'proximaPergunta'>
  ciclo:ReturnType<typeof resumoComercialParaContexto>['ciclo']
  responsavel:{estado:'definido'|'ausente'|'bloqueado';quem:'romulo'|'time'|null}
  atendimento:{presente:boolean;tipo:'rascunho'|'handoff'|'aguardando-fonte'|null;alvo:'operador'|'cliente'|null}
  bloqueios:MotivoLeituraComercial[]
  proximaAcao:'preservar-desfecho'|'aguardar'|'conferir-com-romulo'|'conferir-qualificacao-na-ficha'
  contatoAutorizado:false;somenteLeitura:true;revisaoContexto:string;ficha:string|null
}
const normalizar=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase()
/** Referência de leitura; não comprova identidade, autorização ou fato comercial. */
export const referenciaLeituraComercial=(lead:Pick<CrmLead,'id'|'produto'>)=>createHash('sha256').update(JSON.stringify([lead.produto,lead.id])).digest('hex')
function empresaSegura(s:string){return semValores(mascarar(prepararTexto(s))).replace(/https?:\/\/\S+/gi,'[link]').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,160)}
/** A Central fornece a ficha de um lead encontrado usando somente sua origem configurada. */
export function fichaDaFonteComercial(lead:CrmLead,origem?:string):string|null {
  if(!origem)return null
  try{
    const base=new URL(origem)
    if(base.protocol!=='https:'||base.port!=='8443'||!base.hostname.endsWith('.ts.net')||base.username||base.password||base.search||base.hash||base.pathname!=='/')return null
    return `${base.origin}/crm?lead=${encodeURIComponent(lead.id)}`
  }catch{return null}
}
export async function projetarLeituraComercial(lead:CrmLead,visao:FonteLeituraComercial,deps:Pick<DependenciasLeituraComercial,'bloqueioConversa'|'origemCentral'>,agora=Date.now()):Promise<OportunidadeLeituraComercial> {
  const resumo=resumoComercialParaContexto(lead),{proximaPergunta:_pergunta,...qualificacao}=resumo.qualificacao
  const dono=projetarResponsavelConversa(lead,visao.leads,agora),bloqueios=new Set<MotivoLeituraComercial>()
  const procedimento=procedimentoDaDecisao({...lead,atendimentoComercial:undefined},new Date(agora)),retomada=revisaoRetomadaDoLead(lead,agora)
  if(['ganho','perdido'].includes(lead.etapa))bloqueios.add('encerramento')
  if(['negativa','exclusao'].includes(lead.resposta?.tipo??'')||['recusa','exclusao'].includes(lead.classificacaoResposta?.classe??''))bloqueios.add('recusa-ou-exclusao')
  if(contatoPausado(lead))bloqueios.add('pausa')
  if(procedimento.tipo==='espera'||retomada?.atual&&['aguardar','nao-priorizar'].includes(retomada.grupo))bloqueios.add('espera')
  if(lead.revisaoComercial||retomada&&!retomada.atual)bloqueios.add('revisao-pendente')
  if(qualificacao.estado==='invalida')bloqueios.add('qualificacao-invalida')
  if(['sem-interesse','inadequada'].includes(qualificacao.estado))bloqueios.add('qualificacao-negativa')
  if(resumo.ciclo.exigeHumano)bloqueios.add('ciclo-comercial')
  if(dono.registro?.responsavel==='romulo')bloqueios.add('responsabilidade-humana')
  if(dono.estado==='ausente')bloqueios.add('responsabilidade-indefinida')
  if(dono.estado==='bloqueado')bloqueios.add('identidade-ou-registro-pendente')
  try{if(await deps.bloqueioConversa(lead,visao.leads))bloqueios.add('identidade-ou-registro-pendente')}catch{bloqueios.add('identidade-ou-registro-pendente')}
  if(['audio','robo','recepcao'].includes(procedimento.tipo))bloqueios.add('conteudo-ou-autoria-pendente')
  const att=lead.atendimentoComercial
  if(att)bloqueios.add('atendimento-interno')
  const acao=filaDeVenda(visao,{primeiroLiberado:false,agora,soDoLead:lead.id})[0]
  if(lead.proposta||qualificacao.intencao==='contratar'||acaoInternaComercial(acao))bloqueios.add('decisao-comercial-humana')
  const proximaAcao=bloqueios.has('encerramento')||bloqueios.has('recusa-ou-exclusao')?'preservar-desfecho':bloqueios.has('pausa')||bloqueios.has('espera')?'aguardar':bloqueios.size?'conferir-com-romulo':'conferir-qualificacao-na-ficha'
  return {referencia:referenciaLeituraComercial(lead),empresa:empresaSegura(lead.empresa),produto:lead.produto,etapa:lead.etapa,
    autoridade:resumo.autoridade,qualificacao,ciclo:resumo.ciclo,responsavel:{estado:dono.estado,quem:dono.registro?.responsavel??null},
    atendimento:{presente:!!att,tipo:att?['rascunho','handoff','aguardando-fonte'].includes(att.tipo)?att.tipo as 'rascunho'|'handoff'|'aguardando-fonte':'handoff':null,alvo:att?.alvo==='cliente'?'cliente':att?'operador':null},
    bloqueios:[...bloqueios].sort(),proximaAcao,contatoAutorizado:false,somenteLeitura:true,
    revisaoContexto:createHash('sha256').update(JSON.stringify([resumo.revisaoContexto,dono.estado,dono.registro?.id??null,att?.contextoHash??null,[...bloqueios].sort()])).digest('hex'),ficha:fichaDaFonteComercial(lead,deps.origemCentral)}
}
export function montarLeituraComercial(router:Pick<Router,'get'>,deps:DependenciasLeituraComercial){
  router.get(ROTA_LEITURA_COMERCIAL,async(req,res)=>{
    res.set('Cache-Control','no-store')
    const {nome,referencia}=req.query
    if(Object.keys(req.query).some(k=>!['nome','referencia'].includes(k))||nome!==undefined&&(typeof nome!=='string'||nome.trim().length<2||nome.length>100||/[\u0000-\u001f\u007f]/.test(nome))||referencia!==undefined&&(typeof referencia!=='string'||!/^[a-f0-9]{64}$/.test(referencia))||nome!==undefined&&referencia!==undefined)return void res.status(400).json({v:1,erro:'Selecione nome ou referência válida, sem outros parâmetros.',somenteLeitura:true,contatoAutorizado:false})
    const nomeValidado=typeof nome==='string'?nome.trim():undefined,referenciaValidada=typeof referencia==='string'?referencia:undefined
    const agora=deps.agora?.()??Date.now(),base={v:1,somenteLeitura:true,contatoAutorizado:false,consultadoEm:new Date(agora).toISOString()}
    try{
      const v=await deps.visao(),gerado=Date.parse(v.geradoEm??''),idade=agora-gerado
      const fonte={geradoEm:Number.isFinite(gerado)?new Date(gerado).toISOString():null,idadeMs:Number.isFinite(idade)?idade:null,limiteMs:MAX_IDADE_LEITURA_COMERCIAL_MS}
      if(v.estado!=='ok'||!Number.isFinite(gerado)||idade<0||idade>MAX_IDADE_LEITURA_COMERCIAL_MS||v.ultimaFalha&&Date.parse(v.ultimaFalha.em)>gerado||v.fontes?.some(f=>!!f.erro))return void res.status(503).json({...base,resultado:'indisponivel',fonte:{...fonte,atual:false},oportunidades:[]})
      const filtrados=v.leads.filter(l=>referenciaValidada?referenciaLeituraComercial(l)===referenciaValidada:nomeValidado?normalizar(l.empresa).includes(normalizar(nomeValidado)):!!l.atendimentoComercial||['contato','proposta'].includes(l.etapa))
        .sort((a,b)=>Number(!!b.atendimentoComercial)-Number(!!a.atendimentoComercial)||a.empresa.localeCompare(b.empresa,'pt-BR'))
      const oportunidades=await Promise.all(filtrados.slice(0,MAX_RESULTADOS).map(l=>projetarLeituraComercial(l,v,deps,agora)))
      res.json({...base,resultado:!filtrados.length?'nao-encontrado':(referencia||nome)&&filtrados.length===1?'individual':referencia||nome?'ambiguo':'lista',fonte:{...fonte,atual:true},total:filtrados.length,truncado:filtrados.length>MAX_RESULTADOS,oportunidades})
    }catch{res.status(503).json({...base,resultado:'indisponivel',fonte:{atual:false},oportunidades:[]})}
  })
}