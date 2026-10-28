import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { CrmLead, CrmVisao } from '../src/operations/types.ts'
import { CATALOGO_ATENDIMENTO_ESTAMPARIA, decidirAtendimentoEstamparia, entradaEstampariaAutorizada, mensagemAutomaticaEstamparia, motivoDoEncaminhamentoEstamparia, type PoliticaAtendimentoEstamparia, type MensagemEstamparia } from '../src/operations/estamparia-atendimento.ts'
import { conferirMensagem } from './gate-de-envio.ts'
import { SaidasEncontrado, type SaidaEncontrado } from './encontrado-saidas.ts'

const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex')
const canonico=(v:unknown):unknown=>Array.isArray(v)?v.map(canonico):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonico(x)])):v
const hashCanonicoComercial=(v:unknown)=>sha(JSON.stringify(canonico(v)))
export const HASH_ATENDIMENTO_ESTAMPARIA=hashCanonicoComercial(CATALOGO_ATENDIMENTO_ESTAMPARIA)
export function validarPoliticaEstamparia(v:unknown,agora=Date.now()):PoliticaAtendimentoEstamparia {
  const p=v as PoliticaAtendimentoEstamparia
  if(!p||!['catalogoHash,desde,modo,v','catalogoHash,desde,modo,retomada,v'].includes(Object.keys(p).sort().join(','))||p.v!==1||!['pausado','respostas'].includes(p.modo)
    ||typeof p.desde!=='string'||!Number.isFinite(Date.parse(p.desde))||new Date(p.desde).toISOString()!==p.desde||Date.parse(p.desde)>agora
    ||typeof p.catalogoHash!=='string'||!/^[a-f0-9]{64}$/.test(p.catalogoHash))throw new Error('Política de Estamparia inválida.')
  if('retomada' in p) {
    const r=p.retomada
    if(!r||Object.keys(r).sort().join(',')!=='autorizadaEm,chaves'||typeof r.autorizadaEm!=='string'
      ||!Number.isFinite(Date.parse(r.autorizadaEm))||new Date(r.autorizadaEm).toISOString()!==r.autorizadaEm
      ||Date.parse(r.autorizadaEm)<Date.parse(p.desde)||Date.parse(r.autorizadaEm)>agora
      ||!Array.isArray(r.chaves)||!r.chaves.length||r.chaves.length>256||r.chaves.some(c=>typeof c!=='string'||!/^[a-f0-9]{64}$/.test(c))
      ||new Set(r.chaves).size!==r.chaves.length)throw new Error('Retomada de Estamparia inválida.')
  }
  return structuredClone(p)
}
export function leitorPoliticaEstamparia(arquivo:string) {
  return async():Promise<PoliticaAtendimentoEstamparia|null>=>{
    try {const h=await fs.open(arquivo,'r');try{if((await h.stat()).size>32768)throw new Error();return validarPoliticaEstamparia(JSON.parse(await h.readFile('utf8')))}finally{await h.close()}}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('Conferir a política de Estamparia; preservar o atendimento humano.')}
  }
}
export interface EntradaEstamparia { chave:string;estado:string;evento:{conta:string;conversa:string;ocorridoEm:string;conteudoHash:string;idOriginal:string} }
export interface ContextoEntradaEstamparia {
  registro:EntradaEstamparia;visao:Pick<CrmVisao,'estado'|'leads'|'geradoEm'> & Partial<Pick<CrmVisao,'fontes'|'colunasAusentes'>>
  fonte:{jsonl:string;identidade?:unknown}|null
  conferencia:{estado:string;texto?:string;identidade?:string;papel?:string;saidasEm?:string[];ultimaEntradaEm?:string;motivo?:string}
}
export interface EstadoAutomaticoEstamparia {acao:'time'|'humano';estado:string;motivo:string;proximoPasso:string;ocorridoEm:string;identidade:'confirmada'|'sem-prova'|'conflito'|'indisponivel'}
export interface DepsEstamparia {
  atendimento:{entradasParaAutomacao():Promise<EntradaEstamparia[]>;contextoDaEntrada(chave:string,visao?:ContextoEntradaEstamparia['visao']):Promise<ContextoEntradaEstamparia|null>}
  saidas:SaidasEncontrado;politica:()=>Promise<PoliticaAtendimentoEstamparia|null>;agora?:()=>number
  transporte:{conferir():Promise<void>;enviar(numero:string,texto:string):Promise<string>}
  comConversa:<T>(conversa:string,acao:()=>Promise<T>)=>Promise<T>
  identidadeLead:(lead:CrmLead)=>string|null
  verificarMensagem:(registro:unknown,identidade:unknown,agora:number)=>{idOriginal:string;direcao:'entrada'|'saida';ocorridoEm:string;conteudoHash:string}|null
  bloqueio:(lead:CrmLead,leads:readonly CrmLead[])=>Promise<string|null>
}
/** Entradas naturais novas ou incluídas em retomada explícita; nunca fabrica um evento para reenviar. */
export class EstampariaAutomatico {
  private agora:()=>number
  constructor(private deps:DepsEstamparia){this.agora=deps.agora??Date.now}
  private mensagens(c:ContextoEntradaEstamparia):MensagemEstamparia[] {
    if(!c.fonte?.identidade||c.conferencia.estado!=='ok')return []
    const ms:MensagemEstamparia[]=[]
    for(const linha of c.fonte.jsonl.split('\n').filter(Boolean)) {
      const m=JSON.parse(linha),v=this.deps.verificarMensagem(m,c.fonte.identidade,this.agora())
      if(v&&typeof m.texto==='string'&&sha(m.texto)===v.conteudoHash&&Date.parse(v.ocorridoEm)<=this.agora())ms.push({id:v.idOriginal,em:v.ocorridoEm,hash:v.conteudoHash,direcao:v.direcao,texto:m.texto})
    }
    return ms.sort((a,b)=>Date.parse(a.em)-Date.parse(b.em)).slice(-200)
  }
  /** Só permite esperar. O legado sem prova nunca é convertido em autorização para enviar. */
  private historicoJaRespondido(c:ContextoEntradaEstamparia,p:PoliticaAtendimentoEstamparia):boolean {
    const e=c.registro.evento,now=this.agora(),gerado=Date.parse(c.visao.geradoEm??'')
    if(!p.retomada?.chaves.includes(c.registro.chave)||c.conferencia.identidade!=='sem-prova'||!c.fonte
      ||c.visao.estado!=='ok'||!c.visao.colunasAusentes||c.visao.colunasAusentes.length||!c.visao.fontes||c.visao.fontes.some(f=>f.erro)||!Number.isFinite(gerado)||gerado>now||now-gerado>15*60_000)return false
    try {
      const ms=c.fonte.jsonl.split('\n').filter(Boolean).map(l=>JSON.parse(l))
      if(!ms.some(m=>m.id===e.idOriginal&&m.direcao==='entrada'&&m.em===e.ocorridoEm&&typeof m.texto==='string'&&sha(m.texto)===e.conteudoHash))return false
      if(ms.some(m=>m.direcao==='entrada'&&Date.parse(m.em)>Date.parse(e.ocorridoEm)))return false
      return ms.some(m=>m.direcao==='saida'&&typeof m.id==='string'&&typeof m.texto==='string'&&Date.parse(m.em)>Date.parse(e.ocorridoEm)&&Date.parse(m.em)<=now)
    }catch{return false}
  }
  private async plano(chave:string,visao?:ContextoEntradaEstamparia['visao']) {
    const p=await this.deps.politica()
    if(!p||p.modo!=='respostas')return null
    const c=await this.deps.atendimento.contextoDaEntrada(chave,visao)
    if(!c||c.registro.evento.conta!=='prumo')return null
    const e=c.registro.evento,now=this.agora()
    if(!entradaEstampariaAutorizada(p,e.ocorridoEm,now,chave))return null
    const ligados=c.visao.leads.filter(l=>this.deps.identidadeLead(l)===e.conversa)
    if(ligados.length!==1||ligados[0].produto!=='estampa')return null
    const lead=ligados[0],f=c.conferencia,ms=this.mensagens(c),gerado=Date.parse(c.visao.geradoEm??'')
    const fonteDisponivel=c.visao.estado==='ok'&&c.visao.colunasAusentes?.length===0&&c.visao.fontes?.every(f=>!f.erro)===true
      &&gerado<=now&&now-gerado<=15*60_000&&f.estado==='ok'
    const entrada=ms.find(m=>m.id===e.idOriginal&&m.direcao==='entrada'&&m.em===e.ocorridoEm&&m.hash===e.conteudoHash)
    const posterior=ms.some(m=>m.direcao==='saida'&&Date.parse(m.em)>=Date.parse(e.ocorridoEm))
    const fonteAtual=!!entrada&&fonteDisponivel&&Date.parse(c.visao.leads.find(l=>l.id===lead.id)?.conversa?.ultima.em??'')===Date.parse(e.ocorridoEm)
      &&!ms.some(m=>m.direcao==='entrada'&&Date.parse(m.em)>Date.parse(e.ocorridoEm))
      &&!(f.ultimaEntradaEm&&Date.parse(f.ultimaEntradaEm)>Date.parse(e.ocorridoEm))
    const historicoJaRespondido=this.historicoJaRespondido(c,p)
    let decisao=decidirAtendimentoEstamparia({politica:p,catalogoHash:HASH_ATENDIMENTO_ESTAMPARIA,agora:now,ocorridoEm:e.ocorridoEm,
      texto:f.texto??'',identidade:f.identidade??'indisponivel',fonteAtual,respondida:posterior&&fonteDisponivel,papel:f.papel,lead,historico:ms,bloqueio:await this.deps.bloqueio(lead,c.visao.leads),entradaChave:chave,historicoJaRespondido})
    if(['ambiguo','processando'].includes(c.registro.estado))decisao={acao:'humano',motivo:'A entrada ainda não foi reconciliada; conferir o registro original antes de responder.'}
    if(decisao.acao==='responder'&&ms.some(m=>m.id!==e.idOriginal&&m.direcao==='entrada'&&m.em===e.ocorridoEm))decisao={acao:'humano',motivo:'Há entradas distintas no mesmo instante; conferir a ordem antes de responder.'}
    const anteriores=await this.deps.saidas.listar()
    if(decisao.acao==='responder') {
      const outras=anteriores.filter(s=>s.chave!==chave&&s.conversa===e.conversa&&s.estado==='enviada'&&now-Date.parse(s.em)<24*3600_000)
      const modelo=decisao.modelo
      if(outras.some(s=>s.modelo===modelo))decisao={acao:'humano',motivo:'O cliente retomou um ponto já respondido; Rômulo precisa conferir o que falta esclarecer.'}
      else if(outras.length>=8)decisao={acao:'humano',motivo:'Rômulo precisa revisar a continuidade desta conversa após oito respostas automáticas no dia.'}
      else if(conferirMensagem(decisao.texto,{modo:'bloquear',tipo:'conversa',nome:lead.empresa,houveConversa:true}).bloqueia)decisao={acao:'humano',motivo:'Conferir a mensagem de Estamparia antes de enviar.'}
    }
    return {p,c,e,lead,ms,decisao,anteriores,historicoJaRespondido,contextoHash:hashCanonicoComercial({lead,mensagens:ms,politica:p,decisao})}
  }
  private async reconciliar(r:SaidaEncontrado) {
    const c=await this.deps.atendimento.contextoDaEntrada(r.chave)
    if(!c)return
    for(const m of this.mensagens(c))if(m.direcao==='saida'&&m.hash===r.textoHash&&Date.parse(m.em)>=Date.parse(r.em)-1000&&Date.parse(m.em)<=Date.parse(r.em)+120000) {
      await this.deps.saidas.concluir(r.chave,'enviada',m.id);return
    }
  }
  private async ultimas(p:PoliticaAtendimentoEstamparia) {
    const mapa=new Map<string,EntradaEstamparia>()
    for(const r of await this.deps.atendimento.entradasParaAutomacao()) {
      if(r.evento.conta!=='prumo'||!Number.isFinite(Date.parse(r.evento.ocorridoEm))||Date.parse(r.evento.ocorridoEm)>this.agora())continue
      const antes=mapa.get(r.evento.conversa)
      if(!antes||Date.parse(r.evento.ocorridoEm)>Date.parse(antes.evento.ocorridoEm))mapa.set(r.evento.conversa,r)
    }
    return [...mapa.values()].filter(r=>entradaEstampariaAutorizada(p,r.evento.ocorridoEm,this.agora(),r.chave))
  }
  async executar(visaoDoCiclo?: ContextoEntradaEstamparia['visao']):Promise<void> {
    const politica=await this.deps.politica();if(!politica||politica.modo!=='respostas')return
    for(const r of await this.deps.saidas.listar())if(['reservada','incerta'].includes(r.estado))await this.deps.comConversa(r.conversa,()=>this.reconciliar(r))
    for(const r of await this.ultimas(politica))await this.deps.comConversa(r.evento.conversa,async()=>{
      const anteriores=await this.deps.saidas.listar()
      if(anteriores.some(s=>s.chave===r.chave||s.conversa===r.evento.conversa&&['reservada','incerta'].includes(s.estado)))return
      const falha=await this.deps.saidas.primeiraFalha(r.chave)
      if(falha&&this.agora()-Date.parse(falha)>5*60_000)return
      const triagem=await this.plano(r.chave,visaoDoCiclo);if(!triagem||triagem.decisao.acao!=='responder')return
      const plano=visaoDoCiclo ? await this.plano(r.chave) : triagem;if(!plano||plano.decisao.acao!=='responder')return
      try{await this.deps.transporte.conferir()}catch{await this.deps.saidas.falhaTecnica(r.chave,new Date(this.agora()).toISOString());return}
      const atual=await this.plano(r.chave)
      if(!atual||atual.decisao.acao!=='responder'||atual.contextoHash!==plano.contextoHash)return
      const texto=atual.decisao.texto,numero=new URL(atual.lead.links.whatsapp!).pathname.replace(/\D/g,'')
      const reserva:SaidaEncontrado={v:1,chave:r.chave,conversa:r.evento.conversa,leadId:atual.lead.id,entradaEm:r.evento.ocorridoEm,
        em:new Date(this.agora()).toISOString(),politicaHash:hashCanonicoComercial(atual.p),contextoHash:atual.contextoHash,textoHash:sha(texto),modelo:atual.decisao.modelo,estado:'reservada'}
      if(!await this.deps.saidas.reservar(reserva))return
      try {
        const final=await this.plano(r.chave)
        if(!final||final.decisao.acao!=='responder'||final.contextoHash!==atual.contextoHash){await this.deps.saidas.concluir(r.chave,'cancelada');return}
        const recibo=await this.deps.transporte.enviar(numero,texto)
        await this.deps.saidas.concluir(r.chave,'enviada',recibo)
      }catch{await this.deps.saidas.concluir(r.chave,'incerta')}
    })
  }
  async estados(visao?:ContextoEntradaEstamparia['visao']):Promise<Map<string,EstadoAutomaticoEstamparia>> {
    const mapa=new Map<string,EstadoAutomaticoEstamparia>(),p=await this.deps.politica()
    if(!p||p.modo!=='respostas')return mapa
    for(const r of await this.ultimas(p)) {
      const plano=await this.plano(r.chave,visao);if(!plano||plano.decisao.acao==='ignorar')continue
      let decisao=plano.decisao
      const reserva=plano.anteriores.find(s=>s.conversa===r.evento.conversa&&['reservada','incerta'].includes(s.estado))??plano.anteriores.find(s=>s.chave===r.chave)
      let estado:string=decisao.acao
      if('restricao' in decisao&&decisao.restricao==='recusa')estado='restrito'
      if(reserva&&['reservada','incerta'].includes(reserva.estado)) {
        estado=reserva.estado
        decisao={acao:this.agora()-Date.parse(reserva.em)>5*60_000?'humano':'aguardar',motivo:'Conferir o recibo da resposta; nenhum reenvio foi liberado.'}
      } else if(reserva?.estado==='enviada'&&decisao.acao!=='humano'&&!('restricao' in decisao&&decisao.restricao==='recusa')) {
        const automatica=plano.c.conferencia.identidade==='confirmada'&&mensagemAutomaticaEstamparia(plano.lead,plano.c.conferencia.texto??'',r.evento.ocorridoEm,plano.c.conferencia.papel)
        const handoff=automatica?null:motivoDoEncaminhamentoEstamparia(reserva.modelo)
        const outraSaida=plano.ms.some(m=>m.direcao==='saida'&&m.id!==reserva.recibo&&Date.parse(m.em)>Date.parse(reserva.em))
        estado=handoff&&!outraSaida?'humano':'enviada'
        decisao=handoff&&!outraSaida?{acao:'humano',motivo:handoff}:{acao:'aguardar',motivo:automatica?'Aguardar uma pessoa; a mensagem automática não confirma acesso ao responsável.':'Mensagem enviada com recibo; aguardar a próxima resposta do cliente.'}
      } else if(reserva?.estado==='cancelada') decisao={acao:'humano',motivo:'O contexto mudou antes do envio; Rômulo precisa conferir a conversa.'}
      else {
        const falha=await this.deps.saidas.primeiraFalha(r.chave)
        if(falha)decisao={acao:this.agora()-Date.parse(falha)>5*60_000?'humano':'aguardar',motivo:'O transporte está indisponível; conferir a conta antes de responder.'}
        else if(decisao.acao==='aguardar'&&!('restricao' in decisao&&decisao.restricao==='recusa')&&(plano.historicoJaRespondido||plano.ms.some(m=>m.direcao==='saida'&&Date.parse(m.em)>=Date.parse(r.evento.ocorridoEm))))estado='aguardando-cliente'
      }
      const identidade=plano.c.conferencia.identidade
      mapa.set(plano.lead.id,{acao:decisao.acao==='humano'?'humano':'time',estado:decisao.acao==='humano'?'humano':estado,motivo:decisao.motivo,
        proximoPasso:decisao.acao==='responder'?`Carla vai responder: ${decisao.texto}`:decisao.motivo,ocorridoEm:r.evento.ocorridoEm,
        identidade:identidade==='confirmada'||identidade==='sem-prova'||identidade==='conflito'?identidade:'indisponivel'})
    }
    return mapa
  }
  async resumo() {
    const p=await this.deps.politica(),rs=await this.deps.saidas.listar()
    if(p?.modo==='respostas'&&p.catalogoHash!==HASH_ATENDIMENTO_ESTAMPARIA)throw new Error('Catálogo de Estamparia aguarda revisão.')
    return {oferta:'estampa',modo:p?.modo??'pausado',desde:p?.desde??null,catalogoHash:HASH_ATENDIMENTO_ESTAMPARIA,
      responsavel:'Carla',enviadas:rs.filter(r=>r.estado==='enviada').length,incertas:rs.filter(r=>['reservada','incerta'].includes(r.estado)).length,
      ...(p?.retomada?{retomada:{autorizadaEm:p.retomada.autorizadaEm,entradas:p.retomada.chaves.length}}:{})}
  }
}
