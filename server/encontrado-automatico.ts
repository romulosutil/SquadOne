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
import { QualificadorEncontrado, HASH_QUALIFICACAO_ENCONTRADO, type MensagemQualificacao } from './encontrado-qualificacao.ts'
import { MateriaisEncontrado, idPedidoMaterial, chaveSaidaMaterial, type ResultadoMaterialEncontrado } from './encontrado-materiais.ts'
import type { ObservacaoEncontrado } from '../src/operations/encontrado-qualificacao.ts'
import {ContratacaoEncontrado,lerSolicitacaoPropostaEncontrado,type ContextoPropostaEncontrado} from './encontrado-contratacao.ts'
import {HASH_POLITICA_PROPOSTA_ENCONTRADO} from './encontrado-proposta-config.ts'

export const HASH_CATALOGO_ENCONTRADO=hashCanonicoComercial(CATALOGO_ENCONTRADO)
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex')
/** Acrescentar assinatura não refaz pedidos de material do lote já ativo. */
const hashPoliticaMateriais=(p:PoliticaEncontrado)=>{const {proposta:_proposta,...material}=p;return hashCanonicoComercial(material)}
export function validarPoliticaEncontrado(v:unknown,agora=Date.now()):PoliticaEncontrado {
  const p=v as PoliticaEncontrado
  if(!p||!['catalogoHash,desde,modo,v','catalogoHash,desde,modo,qualificacao,v','catalogoHash,desde,modo,proposta,v','catalogoHash,desde,modo,proposta,qualificacao,v'].includes(Object.keys(p).sort().join(','))||p.v!==1||!['pausado','respostas'].includes(p.modo)
    ||typeof p.desde!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.desde)||!Number.isFinite(Date.parse(p.desde))||new Date(p.desde).toISOString()!==p.desde||Date.parse(p.desde)>agora
    ||typeof p.catalogoHash!=='string'||!/^[a-f0-9]{64}$/.test(p.catalogoHash))throw new Error('Política do Encontrado inválida.')
  if(p.qualificacao){const q=p.qualificacao;if(Object.keys(q).sort().join(',')!=='desde,politicaHash,v'||q.v!==1||typeof q.desde!=='string'||!Number.isFinite(Date.parse(q.desde))||new Date(q.desde).toISOString()!==q.desde||Date.parse(q.desde)<Date.parse(p.desde)||Date.parse(q.desde)>agora||q.politicaHash!==HASH_QUALIFICACAO_ENCONTRADO)throw new Error('Capacidade de qualificação inválida.')}
  else if(Object.hasOwn(p,'qualificacao'))throw new Error('Capacidade de qualificação inválida.')
  if(p.proposta){const q=p.proposta;if(Object.keys(q).sort().join(',')!=='desde,modeloHash,politicaHash,v'||q.v!==1||typeof q.desde!=='string'||!Number.isFinite(Date.parse(q.desde))||new Date(q.desde).toISOString()!==q.desde||Date.parse(q.desde)<Date.parse(p.desde)||Date.parse(q.desde)>agora||q.politicaHash!==HASH_POLITICA_PROPOSTA_ENCONTRADO||!/^[a-f0-9]{64}$/.test(q.modeloHash))throw new Error('Capacidade de proposta inválida.')}
  else if(Object.hasOwn(p,'proposta'))throw new Error('Capacidade de proposta inválida.')
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
  qualificador?:QualificadorEncontrado;materiais?:MateriaisEncontrado
  contratacao?:ContratacaoEncontrado
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
      &&!historico.some(m=>m.direcao==='saida'&&Date.parse(m.em)>=Date.parse(e.ocorridoEm))
    const respondida=fonteDisponivel&&fonte.estado==='ok'&&fonte.saidasEm.some(s=>Date.parse(s)>Date.parse(e.ocorridoEm))&&!(fonte.ultimaEntradaEm&&Date.parse(fonte.ultimaEntradaEm)>Date.parse(e.ocorridoEm))
    const lote2=p.qualificacao&&p.qualificacao.politicaHash===HASH_QUALIFICACAO_ENCONTRADO&&Date.parse(e.ocorridoEm)>=Date.parse(p.qualificacao.desde)
    const lote3=p.proposta&&p.proposta.politicaHash===HASH_POLITICA_PROPOSTA_ENCONTRADO&&Date.parse(e.ocorridoEm)>=Date.parse(p.proposta.desde)
    const mensagens:MensagemQualificacao[]=[]
    if(lote2||lote3)for(const m of historico){const tuple=mensagemDaCaptura(m);if(tuple&&c.fonte?.identidade&&conferirIdentidadeCaptura(tuple,c.fonte.identidade,now).estado==='verificada')mensagens.push({id:tuple.idOriginal,em:tuple.ocorridoEm,hash:tuple.conteudoHash,direcao:tuple.direcao,texto:m.texto})}
    mensagens.sort((a,b)=>Date.parse(a.em)-Date.parse(b.em))
    const observacao=lote2&&this.deps.qualificador?await this.deps.qualificador.ler(mensagens,p.qualificacao!.desde):null
    const politicaHash=hashPoliticaMateriais(p),saidas=await this.deps.saidas.listar()
    const observada=observacao?{...observacao.resultado,materiais:observacao.resultado.materiais.filter(m=>!saidas.some(s=>(s.materiais?.includes(idPedidoMaterial(lead.id,m.tipo,m.evidencia,politicaHash))||s.chave===chaveSaidaMaterial(idPedidoMaterial(lead.id,m.tipo,m.evidencia,politicaHash)))&&s.estado==='enviada'))}:lote2?null:undefined
    let decisao=decidirEncontrado({politica:p,catalogoHash:HASH_CATALOGO_ENCONTRADO,agora:now,ocorridoEm:e.ocorridoEm,
      texto:fonte.estado==='ok'?fonte.texto:'',identidade:fonte.identidade??'indisponivel',fonteAtual:fresca,respondida,
      papel:fonte.estado==='ok'?fonte.papel:undefined,lead,leads:c.visao.leads,historico,
      observada,propostaSolicitada:!!(lote3&&lerSolicitacaoPropostaEncontrado(mensagens,p.proposta!.desde).pedido),bloqueio:await this.deps.bloqueio(lead,c.visao.leads)})
    if(['ambiguo','processando'].includes(c.registro.estado))decisao={acao:'humano',motivo:'A entrada possui processamento sem conclusão; reconciliar antes de executar outra ação.'}
    let materialId:string|undefined
    const materiaisIds:string[]=[]
    const pacotes:ResultadoMaterialEncontrado[]=[]
    let propostaId:string|undefined,contextoProposta:ContextoPropostaEncontrado|undefined
    if(decisao.acao==='propor'){
      if(!this.deps.contratacao||!p.proposta)decisao={acao:'humano',motivo:'Integração de proposta indisponível; preservar as condições e conferir a configuração.'}
      else{
        contextoProposta={leadId:lead.id,conversa:e.conversa,entradaChave:chave,desde:p.proposta.desde,modeloHash:p.proposta.modeloHash,mensagens}
        const planoProposta=await this.deps.contratacao.avaliar(contextoProposta);propostaId=planoProposta.propostaId;decisao=planoProposta
        if(decisao.acao==='responder'&&propostaId&&saidas.some(s=>s.propostaId===propostaId&&s.estado==='enviada')&&!/proposta|contrat|assin|link|envi|mand/.test(fonte.estado==='ok'?fonte.texto.toLowerCase():''))decisao={acao:'aguardar',motivo:'A proposta já foi enviada; o time acompanha o aceite sem repetir o link a cada confirmação.'}
      }
    }
    if(decisao.acao==='preparar'){
      if(!this.deps.materiais||!lead.pasta?.slug)decisao={acao:'humano',motivo:'O pedido de material exige localizar a pasta e as fontes da empresa antes de gerar.'}
      else {
        const pedidos=await this.deps.materiais.listar()
        const prontos:Array<{id:string;tipo:string;r:ResultadoMaterialEncontrado}>=[]
        const quantidade=decisao.materiais.length
        for(const m of decisao.materiais){
          const id=idPedidoMaterial(lead.id,m.tipo,m.evidencia,politicaHash),pedido=pedidos.find(r=>r.id===id)
          if(!pedido)continue
          const resultado=await this.deps.materiais.resultado(id)
          if(resultado?.estado==='pronto'){
            prontos.push({id,tipo:m.tipo,r:resultado})
          }
          if(resultado&&['falha','incerto'].includes(resultado.estado)){decisao={acao:'humano',motivo:'A preparação não foi comprovada. Conferir as fontes, a qualidade ou a execução antes de repetir.'};break}
        }
        if(decisao.acao==='preparar'&&prontos.length===quantidade){
          materialId=prontos[0].id;materiaisIds.push(...prontos.map(m=>m.id))
          pacotes.push(...prontos.map(m=>m.r))
          const previa=prontos.some(m=>m.r.qualidade==='homologacao')
          decisao={acao:'responder',modelo:'material-'+prontos.map(m=>m.tipo).join('+'),texto:(previa?'Preparei o material para você avaliar. As versões identificadas como prévia ainda estão em homologação e não foram liberadas como entrega Profissional.':'Preparei o material para você avaliar.')+'\n\n'+prontos.map(m=>`${m.tipo==='demo'?'Site':'Raio-X'}: ${m.r.url}`).join('\n'),motivo:'Material solicitado preparado; conferir novamente os bytes e a publicação antes de entregar.'}
        }
      }
    }
    return {p,c,e,lead,decisao,historico,mensagens,observacao,materialId,materiaisIds,pacotes,propostaId,contextoProposta,saidaChave:materialId?chaveSaidaMaterial(materialId):chave,contextoHash:hashCanonicoComercial({lead:await hashDoContexto(lead),mensagens,observada:observada??null,materiaisIds,pacotes,propostaId:propostaId??null})}
  }
  private async reconciliar(r:SaidaEncontrado) {
    const c=await this.deps.atendimento.contextoDaEntrada(r.entradaChave??r.chave)
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
        if(anteriores.some(s=>s.chave===r.chave||s.entradaChave===r.chave&&s.estado==='enviada'||s.conversa===r.evento.conversa&&['reservada','incerta'].includes(s.estado)))return
        const plano=await this.plano(r.chave)
        if(!plano)return
        if(plano.decisao.acao==='qualificar'){if(this.deps.qualificador&&plano.p.qualificacao)await this.deps.qualificador.executar(plano.mensagens,plano.p.qualificacao.desde);return}
        if(plano.decisao.acao==='emitir-proposta'&&plano.contextoProposta){await this.deps.contratacao!.preparar(plano.contextoProposta);return}
        if(plano.decisao.acao==='preparar'){
          for(const m of plano.decisao.materiais)await this.deps.materiais!.pedir(plano.lead,r.chave,r.evento.conversa,m.tipo,m.evidencia,hashPoliticaMateriais(plano.p),new Date(this.agora()).toISOString())
          return
        }
        if(plano.decisao.acao!=='responder'||anteriores.some(s=>s.chave===plano.saidaChave))return
        const {texto,modelo}=plano.decisao
        const gate=conferirMensagem(texto,{modo:'bloquear',tipo:'conversa',nome:plano.lead.empresa,houveConversa:true})
        if(gate.bloqueia)return
        // Duas entradas distintas no mesmo instante não têm uma ordem demonstrada.
        if(entradas.some(o=>o.chave!==r.chave&&o.evento.conversa===r.evento.conversa&&o.evento.ocorridoEm===r.evento.ocorridoEm))return
        if(!plano.materialId&&!plano.propostaId&&anteriores.some(s=>s.conversa===r.evento.conversa&&s.modelo===modelo&&s.estado==='enviada'&&this.agora()-Date.parse(s.em)<24*3600_000))return
        const comprovado=await Promise.all(plano.materiaisIds.map(id=>this.deps.materiais!.conferir(id).catch(()=>null)))
        if(plano.materialId&&hashCanonicoComercial(comprovado)!==hashCanonicoComercial(plano.pacotes)){await this.deps.saidas.falhaTecnica(plano.saidaChave,new Date(this.agora()).toISOString());return}
        if(plano.propostaId&&!await this.deps.contratacao!.conferirEntrega(plano.propostaId)){await this.deps.saidas.falhaTecnica(plano.saidaChave,new Date(this.agora()).toISOString());return}
        try {await this.deps.transporte.conferir()}catch{await this.deps.saidas.falhaTecnica(plano.saidaChave,new Date(this.agora()).toISOString());return}
        // Releitura após a chamada de saúde e antes da reserva; nenhuma autorização fica em cache.
        const atual=await this.plano(r.chave)
        if(!atual||atual.decisao.acao!=='responder'||atual.contextoHash!==plano.contextoHash||atual.decisao.texto!==texto||hashCanonicoComercial(atual.p)!==hashCanonicoComercial(plano.p))return
        const numero=new URL(plano.lead.links.whatsapp!).pathname.replace(/\D/g,'')
        const reserva:SaidaEncontrado={v:1,chave:plano.saidaChave,...(plano.propostaId?{propostaId:plano.propostaId}:{}),...(plano.materialId?{entradaChave:r.chave,materiais:plano.materiaisIds}:{}),conversa:r.evento.conversa,leadId:plano.lead.id,entradaEm:r.evento.ocorridoEm,
          em:new Date(this.agora()).toISOString(),politicaHash:hashCanonicoComercial(plano.p),contextoHash:plano.contextoHash,textoHash:sha(texto),modelo,estado:'reservada'}
        if(!await this.deps.saidas.reservar(reserva))return
        // A reserva sobrevive a crash/timeout. Qualquer erro posterior é ambíguo e não libera reenvio.
        try {
          const final=await Promise.all(plano.materiaisIds.map(id=>this.deps.materiais!.conferir(id)))
          const propostaConfere=!plano.propostaId||await this.deps.contratacao!.conferirEntrega(plano.propostaId)
          const ultima=await this.plano(r.chave)
          if(!ultima||ultima.decisao.acao!=='responder'||ultima.contextoHash!==plano.contextoHash||hashCanonicoComercial(ultima.p)!==hashCanonicoComercial(plano.p)||!propostaConfere||plano.materialId&&hashCanonicoComercial(final)!==hashCanonicoComercial(comprovado)) {await this.deps.saidas.concluir(plano.saidaChave,'cancelada');return}
          const recibo=await this.deps.transporte.enviar(numero,texto)
          await this.deps.saidas.concluir(plano.saidaChave,'enviada',recibo)
        } catch {await this.deps.saidas.concluir(plano.saidaChave,'incerta')}
      })
    }
    await this.deps.contratacao?.executar((id,reservar)=>this.autorizarProposta(id,reservar))
  }
  async autorizarProposta(id:string,reservar?:()=>Promise<void>){
    const p=(await this.deps.contratacao?.listar())?.find(p=>p.id===id);if(!p)return null
    return this.deps.comConversa(p.conversa,async()=>{
      const entradas=(await this.deps.atendimento.entradasParaAutomacao()).filter(r=>r.evento.conversa===p.conversa).sort((a,b)=>Date.parse(b.evento.ocorridoEm)-Date.parse(a.evento.ocorridoEm))
      if(!entradas[0]||entradas[1]?.evento.ocorridoEm===entradas[0].evento.ocorridoEm)return null
      const plano=await this.plano(entradas[0].chave)
      if(plano?.decisao.acao!=='emitir-proposta'||plano.propostaId!==id||plano.lead.id!==p.leadId)return null
      const cfg=await this.deps.contratacao!.config.aprovada(p.modeloHash);if(!cfg)return null
      if(reservar)await reservar();return cfg
    })
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
      const reserva=saidas.find(s=>s.conversa===r.evento.conversa&&['reservada','incerta'].includes(s.estado))??saidas.find(s=>s.chave===plano.saidaChave||s.entradaChave===r.chave&&s.estado==='enviada')
      const falha=await this.deps.saidas.primeiraFalha(plano.saidaChave)
      if(entradas.some(o=>o.chave!==r.chave&&o.evento.conversa===r.evento.conversa&&o.evento.ocorridoEm===r.evento.ocorridoEm))d={acao:'humano',motivo:'Há entradas distintas no mesmo instante; conferir a ordem original antes de responder.'}
      if(reserva&&['reservada','incerta'].includes(reserva.estado))d=this.agora()-Date.parse(reserva.em)<5*60000
        ?{acao:'aguardar',motivo:'O time está conciliando o recibo da resposta; nenhuma mensagem será repetida.'}
        :{acao:'humano',motivo:'Envio permanece sem prova após reconciliação. Conferir a conversa antes de qualquer nova ação.'}
      else if(reserva?.estado==='enviada'&&d.acao!=='humano')d={acao:'aguardar',motivo:'Resposta padrão enviada com recibo; aguardar o cliente e a projeção da captura.'}
      else if(d.acao==='responder'&&reserva?.estado==='cancelada')d={acao:'humano',motivo:'O contexto mudou após a reserva; conferir a versão e o pedido antes de outra entrega.'}
      else if(d.acao==='responder'&&falha&&this.agora()-Date.parse(falha)>(plano.materialId?30:5)*60000)d={acao:'humano',motivo:plano.materialId?'O material não passou nas novas conferências de qualidade e publicação; resolver a divergência antes de entregar.':'O transporte segue indisponível após novas conferências; verificar a conta e a integração.'}
      else if(d.acao==='responder'&&!plano.materialId&&!plano.propostaId&&saidas.some(s=>s.conversa===r.evento.conversa&&s.modelo===(plano.decisao as Extract<DecisaoEncontrado,{acao:'responder'}>).modelo&&s.estado==='enviada'&&this.agora()-Date.parse(s.em)<24*3600_000))d={acao:'humano',motivo:'O cliente repetiu a dúvida já respondida; conferir o que ainda precisa ser esclarecido.'}
      else if(d.acao==='responder'&&conferirMensagem(d.texto,{modo:'bloquear',tipo:'conversa',nome:plano.lead.empresa,houveConversa:true}).bloqueia)d={acao:'humano',motivo:'A mensagem não passou pela conferência de envio.'}
      if(d.acao==='ignorar')continue
      mapa.set(plano.lead.id,{acao:d.acao==='humano'?'humano':'time',estado:reserva?.estado??d.acao,motivo:d.motivo,ocorridoEm:r.evento.ocorridoEm,identidade:plano.c.conferencia.identidade??'indisponivel'})
    }
    return mapa
  }
  /** Autorização técnica atual; não aceita caminho, comando ou tipo vindo do executor. */
  async autorizarMaterial(id:string){
    const pedido=(await this.deps.materiais?.listar())?.find(p=>p.id===id);if(!pedido)return null
    return this.deps.comConversa(pedido.conversa,async()=>{
      const entradas=(await this.deps.atendimento.entradasParaAutomacao()).filter(r=>r.evento.conversa===pedido.conversa).sort((a,b)=>Date.parse(b.evento.ocorridoEm)-Date.parse(a.evento.ocorridoEm))
      if(!entradas[0]||entradas[1]?.evento.ocorridoEm===entradas[0].evento.ocorridoEm)return null
      const plano=await this.plano(entradas[0].chave)
      if(!plano||plano.decisao.acao!=='preparar'||plano.lead.id!==pedido.leadId||plano.lead.pasta?.slug!==pedido.slug||plano.lead.chave!==pedido.placeId||hashPoliticaMateriais(plano.p)!==pedido.politicaHash)return null
      return plano.decisao.materiais.some(m=>idPedidoMaterial(plano.lead.id,m.tipo,m.evidencia,pedido.politicaHash)===pedido.id)?pedido:null
    })
  }
  async observacoes():Promise<Map<string,ObservacaoEncontrado>>{
    const mapa=new Map<string,ObservacaoEncontrado>()
    const politica=await this.deps.politica()
    if(politica?.modo!=='respostas'||!politica.qualificacao)return mapa
    const ultimas=new Map<string,Awaited<ReturnType<AtendimentoComercial['entradasParaAutomacao']>>[number]>()
    for(const r of await this.deps.atendimento.entradasParaAutomacao())if(Date.parse(r.evento.ocorridoEm)>=Date.parse(politica.qualificacao.desde)&&(!ultimas.has(r.evento.conversa)||Date.parse(r.evento.ocorridoEm)>Date.parse(ultimas.get(r.evento.conversa)!.evento.ocorridoEm)))ultimas.set(r.evento.conversa,r)
    for(const r of ultimas.values()){
      const p=await this.plano(r.chave);if(!p?.observacao)continue
      if(!mapa.has(p.lead.id)||Date.parse(mapa.get(p.lead.id)!.em)<Date.parse(p.observacao.em))mapa.set(p.lead.id,{v:1,origem:'conversa-verificada',em:p.observacao.em,qualificacao:p.observacao.resultado})
    }return mapa
  }
  async resumo(){const p=await this.deps.politica(),r=await this.deps.saidas.listar();return {oferta:'encontrado',modo:p?.modo??'pausado',desde:p?.desde??null,catalogoHash:HASH_CATALOGO_ENCONTRADO,
    qualificacao:p?.qualificacao??null,proposta:p?.proposta??null,pedidosMaterial:(await this.deps.materiais?.listar())?.length??0,
    enviadas:r.filter(s=>s.estado==='enviada').length,incertas:r.filter(s=>['reservada','incerta'].includes(s.estado)).length}}
}
