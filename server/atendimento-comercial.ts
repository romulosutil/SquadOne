import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { CrmLead, CrmVisao } from '../src/operations/types.ts'
import { cicloDoLead } from '../src/operations/ciclo-comercial.ts'
import { proximaPerguntaQualificacao, qualificacaoComercialAtual, temQualificacaoComercial } from '../src/operations/qualificacao-comercial.ts'
import { contatoPausado } from '../src/operations/aprendizado-comercial.ts'
import { hashDoContexto } from '../src/operations/revisao-resposta.ts'
import { identidadeDaConversa, projetarResponsavelConversa } from '../src/operations/responsavel-conversa.ts'
import { sinalNoTexto } from './lead-quente.ts'
import { hashCanonicoComercial } from './registro-comercial-duravel.ts'
import { EntradaAtendimentoComercialDuravel, type EventoAtendimentoComercial, type RegistroEntradaAtendimento, type RecebimentoAtendimento } from './entrada-atendimento-comercial.ts'

export interface FonteAtendimentoComercial { conversa: string; jsonl: string }
export type VisaoAtendimentoComercial = Pick<CrmVisao,'leads'> & Partial<Pick<CrmVisao,'estado' | 'geradoEm'>>
export function criarLeitorFonteAtendimento(pasta: string): DependenciasAtendimentoComercial['lerFonte'] {
  const raiz=path.resolve(pasta), limite=8*1024*1024
  return async evento => {
    if(!/^[1-9][0-9]{9}$/.test(evento.conversa)) throw new Error('Identidade de arquivo inválida.')
    const arquivo=path.join(raiz,evento.conversa+'.jsonl')
    let h: Awaited<ReturnType<typeof fs.open>>
    try { h=await fs.open(arquivo,'r') } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e }
    try {
      const stat=await h.stat()
      if(!stat.isFile()||stat.size>limite)throw new Error('Fonte privada excede o limite de leitura.')
      const buffer=Buffer.alloc(limite+1), {bytesRead}=await h.read(buffer,0,buffer.length,0)
      if(bytesRead>limite)throw new Error('Fonte privada excede o limite de leitura.')
      return {conversa:evento.conversa,jsonl:buffer.subarray(0,bytesRead).toString('utf8')}
    } finally {await h.close()}
  }
}
export type ConferenciaFonteAtendimento = { estado: 'ok'; texto: string; papel?: string; saidasEm: string[]; ultimaEntradaEm?: string } | { estado: 'ausente'; motivo: string } | { estado: 'invalida'; motivo: string }
/** O leitor recebe a conversa do arquivo realmente aberto, nunca a identidade copiada do envelope. */
export interface DependenciasAtendimentoComercial {
  inbox: EntradaAtendimentoComercialDuravel
  lerFonte: (evento: EventoAtendimentoComercial) => Promise<FonteAtendimentoComercial | null>
  visao: () => Promise<Pick<CrmVisao,'leads' | 'estado' | 'geradoEm'>>
  agora?: () => number
  maxIdadeCrmMs?: number
}
export interface PendenciaAtendimentoComercial {
  id: string; chave: string; conversa: string; leadIds: string[]; leadId?: string; produto?: CrmLead['produto']; empresa?: string
  tipo: 'rascunho' | 'handoff' | 'aguardando-fonte'
  titulo: string; motivo: string; alvo: 'cliente' | 'operador'; orientacao: string; texto?: string
  contextoHash: string; estado: RegistroEntradaAtendimento['estado']; somenteRevisao: true
}
export type ResumoAtendimentoComercial = Pick<PendenciaAtendimentoComercial,'id'|'tipo'|'titulo'|'motivo'|'alvo'|'texto'|'orientacao'|'estado'|'contextoHash'>
const objeto=(v: unknown): v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v)
export function conferirFonteAtendimento(evento: EventoAtendimentoComercial, fonte: FonteAtendimentoComercial | null, agora = Date.now()): ConferenciaFonteAtendimento {
  if (!fonte) return {estado:'ausente',motivo:'Mensagem original ainda não está disponível na fonte privada.'}
  if (fonte.conversa !== evento.conversa || evento.origem !== 'whatsapp' || evento.conta !== 'prumo' || evento.canal !== 'whatsapp'
    || evento.fonteId !== evento.idOriginal || typeof fonte.jsonl !== 'string' || Buffer.byteLength(fonte.jsonl,'utf8') > 8*1024*1024) return {estado:'invalida',motivo:'Identidade da fonte divergente; confira a captura original.'}
  const candidatas: Record<string,unknown>[]=[], saidasEm:string[]=[], entradasEm:string[]=[]
  for (const linha of fonte.jsonl.split('\n')) {
    if (!linha.trim()) continue
    let v: unknown
    try { v=JSON.parse(linha) } catch { return {estado:'invalida',motivo:'Fonte privada contém registro ilegível; confira a captura original.'} }
    if (!objeto(v)) return {estado:'invalida',motivo:'Fonte privada contém registro inválido; confira a captura original.'}
    if(v.origem==='prumo'&&typeof v.id==='string'&&v.id&&typeof v.em==='string'&&Number.isFinite(Date.parse(v.em))&&Date.parse(v.em)<=agora&&typeof v.texto==='string'){
      if(v.direcao==='saida')saidasEm.push(v.em)
      if(v.direcao==='entrada')entradasEm.push(v.em)
    }
    if (v.id === evento.idOriginal && v.direcao === evento.direcao) candidatas.push(v)
  }
  if (!candidatas.length) return {estado:'ausente',motivo:'Mensagem original ainda não está disponível na fonte privada.'}
  if (candidatas.length !== 1) return {estado:'invalida',motivo:'Identidade repetida na fonte privada; confira a captura original.'}
  const m=candidatas[0]
  if (m.origem !== 'prumo' || m.em !== evento.ocorridoEm || typeof m.texto !== 'string'
    || createHash('sha256').update(m.texto,'utf8').digest('hex') !== evento.conteudoHash) return {estado:'invalida',motivo:'Integridade da mensagem original divergente; nenhuma resposta foi preparada.'}
  const ultimaEntradaEm=entradasEm.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]
  return {estado:'ok',texto:m.texto,saidasEm,...(ultimaEntradaEm?{ultimaEntradaEm}:{}),...(typeof m.papel==='string'?{papel:m.papel}:{})}
}
const comercial=(r: RegistroEntradaAtendimento) => r.evento.origem==='whatsapp' && r.evento.direcao==='entrada' && r.evento.tipo==='resposta'
const ids=(leads: readonly CrmLead[])=>leads.map(l=>l.id).sort()
/** Controlador derivado. Não escreve fatos humanos, envia, chama modelo ou altera o JSONL. */
export class AtendimentoComercial {
  private readonly agora: () => number
  private readonly maxIdade: number
  constructor(private readonly deps: DependenciasAtendimentoComercial) { this.agora=deps.agora??Date.now;this.maxIdade=deps.maxIdadeCrmMs??15*60_000 }
  async receber(valor: unknown): Promise<RecebimentoAtendimento> { return this.deps.inbox.receber(valor,this.agora()) }
  private async fonte(e: EventoAtendimentoComercial): Promise<ConferenciaFonteAtendimento> {
    try { return conferirFonteAtendimento(e,await this.deps.lerFonte(e),this.agora()) }
    catch { return {estado:'ausente',motivo:'Fonte privada temporariamente indisponível; aguarde a próxima conferência.'} }
  }
  private async derivar(r: RegistroEntradaAtendimento, fonte: ConferenciaFonteAtendimento, fornecida?: VisaoAtendimentoComercial): Promise<PendenciaAtendimentoComercial> {
    const agora=this.agora(), e=r.evento
    let visao: VisaoAtendimentoComercial | null
    try { visao=fornecida??await this.deps.visao() } catch { visao=null }
    const leads=(visao?.leads??[]).filter(l=>identidadeDaConversa(l)?.conversa===e.conversa).sort((a,b)=>a.id.localeCompare(b.id))
    const hashes=await Promise.all(leads.map(l=>hashDoContexto(l)))
    const dono=leads.length?projetarResponsavelConversa(leads[0],visao!.leads,agora):null
    const contextoHash=hashCanonicoComercial({v:1,evento:r.hash,leads:ids(leads),hashes,dono})
    const unico=leads.length===1?leads[0]:undefined
    const base: PendenciaAtendimentoComercial={id:'atendimento-'+r.chave,chave:r.chave,conversa:e.conversa,leadIds:ids(leads),
      ...(unico?{leadId:unico.id,produto:unico.produto,empresa:unico.empresa}:{}),tipo:'handoff',titulo:'Conferir atendimento com Rômulo',
      motivo:'Contexto exige revisão humana.',alvo:'operador',orientacao:'Confira a conversa e o CRM antes de decidir o próximo passo.',contextoHash,estado:r.estado,somenteRevisao:true}
    const handoff=(motivo:string,orientacao=base.orientacao):PendenciaAtendimentoComercial=>({...base,motivo,orientacao})
    if(fonte.estado==='ausente')return {...handoff(fonte.motivo),tipo:'aguardando-fonte',titulo:'Aguardar mensagem original'}
    if(fonte.estado==='invalida')return handoff(fonte.motivo)
    if(r.estado==='ambiguo'||r.estado==='processando')return handoff('Há processamento interrompido ou em andamento; confira a reserva antes de repetir.')
    const gerado=Date.parse(visao?.geradoEm??'')
    if(!visao || visao.estado!==undefined&&visao.estado!=='ok' || !fornecida&&!Number.isFinite(gerado) || visao.geradoEm!==undefined&&(!Number.isFinite(gerado)||gerado>agora||agora-gerado>this.maxIdade))return handoff('CRM indisponível ou desatualizado; aguarde uma leitura válida antes de preparar resposta.')
    if(!unico)return handoff(leads.length?'Há várias oportunidades nesta conversa; Rômulo precisa escolher qual está sendo tratada.':'Conversa ainda sem oportunidade correspondente no CRM.')
    if(leads.some(l=>['ganho','perdido'].includes(l.etapa)||['negativa','exclusao'].includes(l.resposta?.tipo??'')||contatoPausado(l)))return handoff('Há recusa, encerramento ou pausa nesta conversa. Preserve a restrição e confira o próximo passo internamente.')
    if(unico.revisaoComercial)return handoff('O CRM exige revisão comercial antes de retomar a conversa.')
    if(fonte.papel==='robo'||fonte.papel==='recepcao'||!fonte.texto.trim()||/^\[(?:áudio|audio|imagem|vídeo|video|documento)\b/i.test(fonte.texto))return handoff('A entrada exige conferência de autoria ou conteúdo; não preparar mensagem automática.')
    const ultima=unico.conversa?.ultima, entrada=Date.parse(unico.conversa?.ultimaEntrada??'')
    if(Date.parse(fonte.ultimaEntradaEm??'')>Date.parse(e.ocorridoEm))return handoff('Há entrada original posterior ainda aguardando envelope ou revisão; confira o contexto atual.')
    if(!ultima || ultima.direcao!=='entrada' || Date.parse(ultima.em)!==Date.parse(e.ocorridoEm) || entrada>Date.parse(e.ocorridoEm))return handoff('A conversa mudou ou a entrada ainda não foi projetada no CRM; revise o contexto atual.')
    // Complemento de veto financeiro; não classifica intenção nem registra fato.
    const veto=fonte.texto.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    const sinal=sinalNoTexto(fonte.texto)??(/\b(?:desconto|negoci\w*|abaix\w*|barato|paguei|pagamos|comprovante|transferencia|assin\w*)\b/.test(veto)?'negociacao-ou-contratacao':null)
    if(sinal)return handoff(`Sinal comercial exige Rômulo: ${sinal}.`,'Confira a solicitação original e conduza a decisão, sem registrar aceite ou pagamento por inferência.')
    if(dono?.estado==='bloqueado'||dono?.registro?.responsavel==='romulo')return handoff(dono.motivo)
    const q=qualificacaoComercialAtual(unico,agora)
    if(temQualificacaoComercial(unico,agora)&&(!q||q.intencao==='sem-interesse'||q.adequacao.estado==='inadequada'))return handoff('Qualificação pede revisão ou restringe a continuidade; não retomar automaticamente.')
    const ciclo=cicloDoLead(unico,agora)
    if(ciclo.historico.length||ciclo.problemas.length)return handoff('Há histórico do ciclo comercial; Rômulo precisa conduzir a proposta, contratação ou pagamento.')
    if(q?.intencao==='contratar'||unico.proposta)return handoff('Há intenção de contratar ou proposta registrada; Rômulo conduz a próxima decisão.')
    const pergunta=proximaPerguntaQualificacao(unico,agora)
    if(!pergunta)return handoff('Qualificação já possui os campos necessários; Rômulo precisa revisar a proposta e os próximos marcos.')
    return {...base,tipo:'rascunho',titulo:pergunta.alvo==='cliente'?'Revisar pergunta de qualificação':'Completar qualificação com Rômulo',
      motivo:'Sugestão determinística baseada na fonte conferida e no CRM atual.',alvo:pergunta.alvo,orientacao:pergunta.texto,
      ...(pergunta.alvo==='cliente'?{texto:pergunta.texto}:{})}
  }
  /** Nenhuma fonte ausente obtém reserva. Só metadados do resultado são persistidos. */
  async atualizar(): Promise<{verificados:number;concluidos:number;aguardandoFonte:number}> {
    const registros=await this.deps.inbox.recuperarInterrompidos()
    let verificados=0,concluidos=0,aguardandoFonte=0
    for(const r of registros) {
      if(!comercial(r)||r.estado!=='pendente')continue
      verificados++
      const fonte=await this.fonte(r.evento)
      if(fonte.estado==='ausente'){aguardandoFonte++;continue}
      await this.derivar(r,fonte) // Verifica contexto antes de qualquer reserva; ainda sem efeitos comerciais.
      const reserva=await this.deps.inbox.reservar(r.chave)
      if(!reserva)continue
      try {
        const atual=await this.fonte(r.evento)
        if(atual.estado==='ausente'){await this.deps.inbox.marcarAmbiguo(r.chave,reserva.token);continue}
        // A reserva é nossa; processando não é um impedimento para a própria derivação pura.
        const pendencia=await this.derivar({...reserva.registro,estado:'pendente'},atual)
        await this.deps.inbox.concluir(r.chave,reserva.token,{tipo:pendencia.tipo==='rascunho'?'rascunho':'handoff',id:pendencia.id,contextoHash:pendencia.contextoHash,fonteId:r.evento.fonteId})
        concluidos++
      } catch { await this.deps.inbox.marcarAmbiguo(r.chave,reserva.token) }
    }
    return {verificados,concluidos,aguardandoFonte}
  }
  /** Leitura pura da fila: texto nunca vem da inbox e não confirma fatos ou entrega. */
  async listarPendencias(visaoOpcional?: VisaoAtendimentoComercial): Promise<PendenciaAtendimentoComercial[]> {
    const registros=(await this.deps.inbox.listar()).filter(comercial)
    const visao:VisaoAtendimentoComercial=visaoOpcional??await this.deps.visao().then(v=>v.geradoEm?v:{...v,estado:'retrato-invalido' as const}).catch(()=>({leads:[],estado:'retrato-invalido' as const}))
    const porConversa=new Map<string,RegistroEntradaAtendimento[]>()
    for(const r of registros){const k=[r.evento.conta,r.evento.canal,r.evento.conversa].join(':');porConversa.set(k,[...(porConversa.get(k)??[]),r])}
    const fila:PendenciaAtendimentoComercial[]=[]
    for(const rs of porConversa.values()) {
      rs.sort((a,b)=>Date.parse(b.evento.ocorridoEm)-Date.parse(a.evento.ocorridoEm))
      const r=rs.find(x=>x.estado==='ambiguo'||x.estado==='processando')??rs[0]
      const fonte=await this.fonte(r.evento)
      // Só a saída original com correspondência na projeção atual encerra o cartão derivado.
      if(r.estado==='concluido'&&fonte.estado==='ok'&&(visao.estado===undefined||visao.estado==='ok')){
        const gerado=Date.parse(visao.geradoEm??''), fresco=visao.geradoEm===undefined&&!!visaoOpcional||Number.isFinite(gerado)&&gerado<=this.agora()&&this.agora()-gerado<=this.maxIdade
        const ligados=visao.leads.filter(l=>identidadeDaConversa(l)?.conversa===r.evento.conversa)
        const atendidos=ligados.length>0&&ligados.every(l=>{
          const c=l.conversa, saida=Math.max(Date.parse(c?.ultimaSaida??'')||0,c?.ultima.direcao==='saida'?Date.parse(c.ultima.em)||0:0)
          const entrada=Math.max(Date.parse(c?.ultimaEntrada??'')||0,Date.parse(fonte.ultimaEntradaEm??'')||0)
          return saida>Date.parse(r.evento.ocorridoEm)&&saida>entrada&&fonte.saidasEm.some(em=>Date.parse(em)===saida)
        })
        if(fresco&&atendidos)continue
      }
      let p=await this.derivar(r,fonte,visao)
      if(rs.length>1&&Date.parse(rs[0].evento.ocorridoEm)===Date.parse(rs[1].evento.ocorridoEm)&&rs[0].chave!==rs[1].chave)p={...p,tipo:'handoff',titulo:'Conferir ordem das entradas',motivo:'Há entradas diferentes no mesmo instante; confira a ordem original.',alvo:'operador',orientacao:'Confira a conversa antes de preparar uma resposta.',texto:undefined}
      if(r.resultado&&r.resultado.contextoHash!==p.contextoHash)p={...p,tipo:'handoff',titulo:'Revisar contexto atualizado',motivo:'O contexto mudou desde a conferência anterior; revise a qualificação atual.',alvo:'operador',orientacao:'Confira a última entrada e o CRM antes de usar qualquer rascunho.',texto:undefined}
      fila.push(p)
    }
    return fila
  }
}