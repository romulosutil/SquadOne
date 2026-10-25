import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { CATALOGO_ENCONTRADO, decidirEncontrado, type PoliticaEncontrado, type DecisaoEncontrado } from '../src/operations/encontrado-politica.ts'
import { identidadeDaConversa } from '../src/operations/responsavel-conversa.ts'
import type { CrmLead, CrmVisao } from '../src/operations/types.ts'
import { hashDoContexto } from '../src/operations/revisao-resposta.ts'
import { conferirMensagem } from './gate-de-envio.ts'
import { conferirIdentidadeCaptura, mensagemDaCaptura } from './identidade-captura.ts'
import { hashCanonicoComercial } from './registro-comercial-duravel.ts'
import type { AtendimentoComercial } from './atendimento-comercial.ts'
import type { TransporteEncontrado } from './encontrado-evolution.ts'
import { SaidasEncontrado, type SaidaEncontrado } from './encontrado-saidas.ts'

export const HASH_CATALOGO_ENCONTRADO=hashCanonicoComercial(CATALOGO_ENCONTRADO)
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex')
export function validarPoliticaEncontrado(v:unknown,agora=Date.now()):PoliticaEncontrado {
  const p=v as PoliticaEncontrado
  if(!p||Object.keys(p).sort().join(',')!=='catalogoHash,desde,modo,v'||p.v!==1||!['pausado','respostas'].includes(p.modo)
    ||typeof p.desde!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.desde)||!Number.isFinite(Date.parse(p.desde))||new Date(p.desde).toISOString()!==p.desde||Date.parse(p.desde)>agora
    ||typeof p.catalogoHash!=='string'||!/^[a-f0-9]{64}$/.test(p.catalogoHash))throw new Error('Política do Encontrado inválida.')
  return {...p}
}
export function leitorPoliticaEncontrado(arquivo:string):()=>Promise<PoliticaEncontrado|null> {
  return async()=>{
    try {const h=await fs.open(arquivo,'r');try{if((await h.stat()).size>4096)throw new Error('Política excede limite.');return validarPoliticaEncontrado(JSON.parse(await h.readFile('utf8')))}finally{await h.close()}}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('Política indisponível; preservar atendimento assistido.')}
  }
}
export interface EstadoAutomaticoEncontrado {acao:'time'|'humano';estado:string;motivo:string;ocorridoEm:string;identidade:'confirmada'|'sem-prova'|'conflito'|'indisponivel'}
interface Deps {
  atendimento:AtendimentoComercial; saidas:SaidasEncontrado; politica:()=>Promise<PoliticaEncontrado|null>
  transporte:TransporteEncontrado; agora?:()=>number
  comConversa:<T>(conversa:string,acao:()=>Promise<T>)=>Promise<T>
  bloqueio:(lead:CrmLead,leads:readonly CrmLead[])=>Promise<string|null>
}
/** Responde só entradas naturais posteriores à ativação. Não cria fatos humanos na aba CRM. */
export class EncontradoAutomatico {
  private agora:()=>number
  constructor(private deps:Deps){this.agora=deps.agora??Date.now}
  private async plano(chave:string) {
    const p=await this.deps.politica()
    if(!p||p.modo==='pausado')return null
    const c=await this.deps.atendimento.contextoDaEntrada(chave)
    if(!c||c.registro.evento.conta!=='prumo')return null
    const e=c.registro.evento,ligados=c.visao.leads.filter(l=>identidadeDaConversa(l)?.conversa===e.conversa)
    if(ligados.length!==1||ligados[0].produto!=='site'||Date.parse(e.ocorridoEm)<Date.parse(p.desde))return null
    const lead=ligados[0],now=this.agora(),fonte=c.conferencia
    const gerado=Date.parse(c.visao.geradoEm??'')
    let historico:Array<{direcao:string;texto:string;em:string;id?:string}>=[]
    if(fonte.estado==='ok')historico=(c.fonte?.jsonl??'').split('\n').filter(Boolean).map(l=>JSON.parse(l))
      .filter(m=>typeof m.texto==='string'&&typeof m.em==='string'&&['entrada','saida'].includes(m.direcao))
    const fonteDisponivel=c.visao.estado==='ok'&&c.visao.colunasAusentes?.length===0&&c.visao.fontes?.every(f=>!f.erro)===true&&gerado<=now&&now-gerado<=15*60000&&fonte.estado==='ok'
    const fresca=fonteDisponivel&&fonte.estado==='ok'
      &&lead.conversa?.ultima.direcao==='entrada'&&lead.conversa.ultima.em===e.ocorridoEm
      &&!(fonte.ultimaEntradaEm&&Date.parse(fonte.ultimaEntradaEm)>Date.parse(e.ocorridoEm))
      &&!fonte.saidasEm.some(s=>Date.parse(s)>=Date.parse(e.ocorridoEm))
    const respondida=fonteDisponivel&&fonte.estado==='ok'&&fonte.saidasEm.some(s=>Date.parse(s)>Date.parse(e.ocorridoEm))&&!(fonte.ultimaEntradaEm&&Date.parse(fonte.ultimaEntradaEm)>Date.parse(e.ocorridoEm))
    let decisao=decidirEncontrado({politica:p,catalogoHash:HASH_CATALOGO_ENCONTRADO,agora:now,ocorridoEm:e.ocorridoEm,
      texto:fonte.estado==='ok'?fonte.texto:'',identidade:fonte.identidade??'indisponivel',fonteAtual:fresca,respondida,
      papel:fonte.estado==='ok'?fonte.papel:undefined,lead,leads:c.visao.leads,historico,
      bloqueio:await this.deps.bloqueio(lead,c.visao.leads)})
    if(['ambiguo','processando'].includes(c.registro.estado))decisao={acao:'humano',motivo:'A entrada possui processamento sem conclusão; reconciliar antes de executar outra ação.'}
    return {p,c,e,lead,decisao,historico,contextoHash:await hashDoContexto(lead)}
  }
  private async reconciliar(r:SaidaEncontrado) {
    const c=await this.deps.atendimento.contextoDaEntrada(r.chave)
    if(!c?.fonte?.identidade||c.conferencia.estado!=='ok')return
    for(const linha of c.fonte.jsonl.split('\n').filter(Boolean)) {
      const m=JSON.parse(linha),tuple=mensagemDaCaptura(m)
      if(!tuple||tuple.direcao!=='saida'||tuple.conteudoHash!==r.textoHash||Date.parse(tuple.ocorridoEm)<Date.parse(r.em)-1000||Date.parse(tuple.ocorridoEm)>Date.parse(r.em)+120000)continue
      if(conferirIdentidadeCaptura(tuple,c.fonte.identidade,this.agora()).estado==='verificada') {
        await this.deps.saidas.concluir(r.chave,'enviada',tuple.idOriginal);return
      }
    }
  }
  async executar():Promise<void> {
    const politica=await this.deps.politica();if(!politica||politica.modo!=='respostas')return
    for(const r of await this.deps.saidas.listar())if(['reservada','incerta'].includes(r.estado))
      await this.deps.comConversa(r.conversa,()=>this.reconciliar(r))
    const entradas=await this.deps.atendimento.entradasParaAutomacao()
    const ultimas=new Map<string,typeof entradas[number]>()
    for(const r of entradas)if(!ultimas.has(r.evento.conversa)||Date.parse(r.evento.ocorridoEm)>Date.parse(ultimas.get(r.evento.conversa)!.evento.ocorridoEm))ultimas.set(r.evento.conversa,r)
    for(const r of ultimas.values()) {
      if(Date.parse(r.evento.ocorridoEm)<Date.parse(politica.desde))continue
      await this.deps.comConversa(r.evento.conversa,async()=>{
        const anteriores=await this.deps.saidas.listar()
        if(anteriores.some(s=>s.chave===r.chave||s.conversa===r.evento.conversa&&['reservada','incerta'].includes(s.estado)))return
        const plano=await this.plano(r.chave)
        if(!plano||plano.decisao.acao!=='responder')return
        const {texto,modelo}=plano.decisao
        const gate=conferirMensagem(texto,{modo:'bloquear',tipo:'conversa',nome:plano.lead.empresa,houveConversa:true})
        if(gate.bloqueia)return
        // Duas entradas distintas no mesmo instante não têm uma ordem demonstrada.
        if(entradas.some(o=>o.chave!==r.chave&&o.evento.conversa===r.evento.conversa&&o.evento.ocorridoEm===r.evento.ocorridoEm))return
        if(anteriores.some(s=>s.conversa===r.evento.conversa&&s.modelo===modelo&&s.estado==='enviada'&&this.agora()-Date.parse(s.em)<24*3600_000))return
        try {await this.deps.transporte.conferir()}catch{await this.deps.saidas.falhaTecnica(r.chave,new Date(this.agora()).toISOString());return}
        // Releitura após a chamada de saúde e antes da reserva; nenhuma autorização fica em cache.
        const atual=await this.plano(r.chave)
        if(!atual||atual.decisao.acao!=='responder'||atual.contextoHash!==plano.contextoHash||atual.decisao.texto!==texto||hashCanonicoComercial(atual.p)!==hashCanonicoComercial(plano.p))return
        const numero=new URL(plano.lead.links.whatsapp!).pathname.replace(/\D/g,'')
        const reserva:SaidaEncontrado={v:1,chave:r.chave,conversa:r.evento.conversa,leadId:plano.lead.id,entradaEm:r.evento.ocorridoEm,
          em:new Date(this.agora()).toISOString(),politicaHash:hashCanonicoComercial(plano.p),contextoHash:plano.contextoHash,textoHash:sha(texto),modelo,estado:'reservada'}
        if(!await this.deps.saidas.reservar(reserva))return
        // A reserva sobrevive a crash/timeout. Qualquer erro posterior é ambíguo e não libera reenvio.
        try {
          const ultima=await this.plano(r.chave)
          if(!ultima||ultima.decisao.acao!=='responder'||ultima.contextoHash!==plano.contextoHash||hashCanonicoComercial(ultima.p)!==hashCanonicoComercial(plano.p)) {await this.deps.saidas.concluir(r.chave,'cancelada');return}
          const recibo=await this.deps.transporte.enviar(numero,texto)
          await this.deps.saidas.concluir(r.chave,'enviada',recibo)
        } catch {await this.deps.saidas.concluir(r.chave,'incerta')}
      })
    }
  }
  async estados():Promise<Map<string,EstadoAutomaticoEncontrado>> {
    const mapa=new Map<string,EstadoAutomaticoEncontrado>(),politica=await this.deps.politica()
    if(!politica||politica.modo!=='respostas')return mapa
    const saidas=await this.deps.saidas.listar(),entradas=(await this.deps.atendimento.entradasParaAutomacao()).filter(r=>Date.parse(r.evento.ocorridoEm)>=Date.parse(politica.desde))
    const ultimas=new Map<string,typeof entradas[number]>()
    for(const r of entradas.sort((a,b)=>Date.parse(a.evento.ocorridoEm)-Date.parse(b.evento.ocorridoEm)))ultimas.set(r.evento.conversa,r)
    for(const r of ultimas.values()) {
      const plano=await this.plano(r.chave);if(!plano)continue
      let d:DecisaoEncontrado=plano.decisao
      const reserva=saidas.find(s=>s.conversa===r.evento.conversa&&['reservada','incerta'].includes(s.estado))??saidas.find(s=>s.chave===r.chave)
      const falha=await this.deps.saidas.primeiraFalha(r.chave)
      if(entradas.some(o=>o.chave!==r.chave&&o.evento.conversa===r.evento.conversa&&o.evento.ocorridoEm===r.evento.ocorridoEm))d={acao:'humano',motivo:'Há entradas distintas no mesmo instante; conferir a ordem original antes de responder.'}
      if(reserva&&['reservada','incerta'].includes(reserva.estado))d=this.agora()-Date.parse(reserva.em)<5*60000
        ?{acao:'aguardar',motivo:'O time está conciliando o recibo da resposta; nenhuma mensagem será repetida.'}
        :{acao:'humano',motivo:'Envio permanece sem prova após reconciliação. Conferir a conversa antes de qualquer nova ação.'}
      else if(reserva?.estado==='enviada'&&d.acao!=='humano')d={acao:'aguardar',motivo:'Resposta padrão enviada com recibo; aguardar o cliente e a projeção da captura.'}
      else if(d.acao==='responder'&&falha&&this.agora()-Date.parse(falha)>5*60000)d={acao:'humano',motivo:'O transporte segue indisponível após novas conferências; verificar a conta e a integração.'}
      else if(d.acao==='responder'&&saidas.some(s=>s.conversa===r.evento.conversa&&s.modelo===(plano.decisao as Extract<DecisaoEncontrado,{acao:'responder'}>).modelo&&s.estado==='enviada'&&this.agora()-Date.parse(s.em)<24*3600_000))d={acao:'humano',motivo:'O cliente repetiu a dúvida já respondida; conferir o que ainda precisa ser esclarecido.'}
      else if(d.acao==='responder'&&conferirMensagem(d.texto,{modo:'bloquear',tipo:'conversa',nome:plano.lead.empresa,houveConversa:true}).bloqueia)d={acao:'humano',motivo:'A mensagem não passou pela conferência de envio.'}
      if(d.acao==='ignorar')continue
      mapa.set(plano.lead.id,{acao:d.acao==='humano'?'humano':'time',estado:reserva?.estado??d.acao,motivo:d.motivo,ocorridoEm:r.evento.ocorridoEm,identidade:plano.c.conferencia.identidade??'indisponivel'})
    }
    return mapa
  }
  async resumo(){const p=await this.deps.politica(),r=await this.deps.saidas.listar();return {oferta:'encontrado',modo:p?.modo??'pausado',desde:p?.desde??null,catalogoHash:HASH_CATALOGO_ENCONTRADO,
    enviadas:r.filter(s=>s.estado==='enviada').length,incertas:r.filter(s=>['reservada','incerta'].includes(s.estado)).length}}
}
