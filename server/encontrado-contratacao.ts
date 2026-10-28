import path from 'node:path'
import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {comGuardaConversa} from './guarda-conversa.ts'
import {hashCanonicoComercial} from './registro-comercial-duravel.ts'
import {CATALOGO_ENCONTRADO} from '../src/operations/encontrado-politica.ts'
import {normalizar} from '../src/operations/colinha.ts'
import {htmlPropostaEncontrado,validarParteEncontrado,cnpjEncontradoValido,EMAIL_ENCONTRADO,normalizarCnpj,CAMPOS_CLIENTE_ENCONTRADO,perguntasCadastroEncontrado,VERSAO_PROPOSTA_ENCONTRADO,type CadastroClienteEncontrado,type PropostaEncontrado,type ContratacaoEncontradoVisao,type ParteEncontrado} from '../src/operations/encontrado-proposta.ts'
import type {EvidenciaEncontrado} from '../src/operations/encontrado-qualificacao.ts'
import type {MensagemQualificacao} from './encontrado-qualificacao.ts'
import {ConfiguracaoPropostaEncontrado,jsonPrivadoEncontrado,gravarPrivadoEncontrado,type ConfigPropostaEncontrado} from './encontrado-proposta-config.ts'
import {conferirSignatarioAutentique,linkAssinaturaAutentique,arquivoAutentiqueUrl,ErroAutentique,type DocumentoAutentique} from './autentique.ts'

export const shaProposta=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex')
export const nomeDocumentoEncontrado=(id:string)=>'Encontrado | '+id
export const identidadeContaEncontrado=(c:NonNullable<ConfigPropostaEncontrado['autentique']>['conta'])=>c.id+':'+(c.organizacao?.id??'pessoal')
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const mesSP=(em:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date(em))
export interface LeituraPropostaEncontrado {pedido:EvidenciaEncontrado|null;cadastro:CadastroClienteEncontrado}
/** Só dados rotulados nas entradas originais, nunca inferência de CPF, empresa ou poder de representação. */
export function lerSolicitacaoPropostaEncontrado(ms:readonly MensagemQualificacao[],desde:string):LeituraPropostaEncontrado {
  let pedido:EvidenciaEncontrado|null=null
  const cadastro:CadastroClienteEncontrado={}
  for(const m of ms){
    if(m.direcao!=='entrada'||Date.parse(m.em)<Date.parse(desde))continue
    const s=normalizar(m.texto)
    if(/nao (?:quero|tenho interesse|preciso)|pare de|cancele|cancelar|nao me (?:mande|envie)|exclua|apague/.test(s)){pedido=null;continue}
    if(!pedido&&/\b(?:quero|gostaria(?: de)?|preciso de|pode(?:m)? (?:me )?(?:mandar|enviar|preparar)|mande|envie|preparar)\b.{0,55}\b(?:proposta|contrato)\b|^(?:quero |gostaria de )?(?:contratar|assinar|fechar o encontrado)\b/.test(s))pedido={id:m.id,em:m.em,hash:m.hash,trecho:m.texto.slice(0,500)}
    if(!pedido)continue
    const contagem=new Map<keyof ParteEncontrado,number>()
    for(const linha of m.texto.split('\n')){
      const r=linha.match(/^\s*(Raz[aã]o social|Empresa|CNPJ|Representante|E-?mail)\s*:\s*(.*?)\s*$/i)
      if(!r)continue
      const k=({razaoSocial:'razaoSocial',empresa:'razaoSocial',cnpj:'cnpj',representante:'representante',email:'email'} as Record<string,keyof ParteEncontrado>)[normalizar(r[1]).replace(/[ -]/g,'').replace('razaosocial','razaoSocial')]
      if(!k)continue
      contagem.set(k,(contagem.get(k)??0)+1);delete cadastro[k]
      let valor=r[2].trim()
      if(contagem.get(k)!==1||!valor||valor.length>(k==='email'?180:k==='representante'?120:160)||/[\u0000-\u001f<>]/.test(valor))continue
      if(k==='cnpj'){if(!cnpjEncontradoValido(valor))continue;valor=normalizarCnpj(valor)}
      if(k==='email'){if(!EMAIL_ENCONTRADO.test(valor))continue;valor=valor.toLowerCase()}
      cadastro[k]={valor,evidencia:{id:m.id,em:m.em,hash:m.hash,trecho:linha}}
    }
  }
  return {pedido,cadastro}
}
export interface EstadoPropostaEncontrado {
  v:1;id:string;estado:'preparada'|'criando'|'incerta'|'aguardando'|'assinada'|'recusada'|'expirada'|'conferencia'
  tentativaEm?:string;conta?:string;documentoId?:string;assinaturaId?:string;link?:string
  originalHash?:string;aceiteEm?:string;proximaConsultaEm?:string;primeiraFalhaEm?:string
  recuperada?:boolean;recuperadaConfirmadaEm?:string
  motivo?:'franquia'|'plano'
}
export interface ContextoPropostaEncontrado {leadId:string;conversa:string;entradaChave:string;desde:string;modeloHash:string;mensagens:readonly MensagemQualificacao[]}
export type PlanoPropostaEncontrado=
  |{acao:'responder';modelo:string;texto:string;motivo:string;propostaId?:string}
  |{acao:'emitir-proposta';motivo:string;leitura:LeituraPropostaEncontrado;propostaId:string}
  |{acao:'humano'|'aguardar';motivo:string;propostaId?:string}

export class ContratacaoEncontrado {
  constructor(readonly pasta:string,readonly config:ConfiguracaoPropostaEncontrado,private agora:()=>number=Date.now){}
  private arquivo(id:string,nome:string){if(!hash(id)||!['proposta','estado','original'].includes(nome))throw new Error('Proposta inválida.');return path.join(this.pasta,id,nome+(nome==='original'?'.pdf':'.json'))}
  private async estado(id:string):Promise<EstadoPropostaEncontrado>{
    const e=await jsonPrivadoEncontrado(this.arquivo(id,'estado')) as EstadoPropostaEncontrado|null
    if(!e)return {v:1,id,estado:'preparada'}
    if(e.v!==1||e.id!==id||!['preparada','criando','incerta','aguardando','assinada','recusada','expirada','conferencia'].includes(e.estado)||e.originalHash!==undefined&&!hash(e.originalHash))throw new Error('Estado de proposta inválido.')
    if(e.estado==='assinada'&&(!e.documentoId||!e.assinaturaId||!e.originalHash||!Number.isFinite(Date.parse(e.aceiteEm??''))||Date.parse(e.aceiteEm!)>this.agora()))throw new Error('Aceite sem evidência completa.')
    return e
  }
  private gravar(e:EstadoPropostaEncontrado){return gravarPrivadoEncontrado(this.arquivo(e.id,'estado'),e)}
  async listar():Promise<PropostaEncontrado[]>{
    let nomes:string[];try{nomes=await fs.readdir(this.pasta)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}
    const ps:PropostaEncontrado[]=[]
    for(const n of nomes.filter(hash)){const p=await jsonPrivadoEncontrado(this.arquivo(n,'proposta')) as PropostaEncontrado|null;if(!p)continue
      if(p.v!==1||p.id!==n||p.versao!==VERSAO_PROPOSTA_ENCONTRADO||!hash(p.modeloHash)||!hash(p.htmlHash)||!Number.isFinite(Date.parse(p.criadaEm))||!Number.isFinite(Date.parse(p.validaAte))||shaProposta(htmlPropostaEncontrado(p))!==p.htmlHash)throw new Error('Artefato de proposta divergente.')
      validarParteEncontrado(p.prumo);validarParteEncontrado(p.cliente);ps.push(p)
    }return ps
  }
  private id(c:ContextoPropostaEncontrado,l:LeituraPropostaEncontrado){return hashCanonicoComercial({leadId:c.leadId,conversa:c.conversa,pedido:l.pedido,cadastro:l.cadastro,modeloHash:c.modeloHash})}
  async avaliar(c:ContextoPropostaEncontrado):Promise<PlanoPropostaEncontrado>{
    const leitura=lerSolicitacaoPropostaEncontrado(c.mensagens,c.desde)
    if(!leitura.pedido)return {acao:'aguardar',motivo:'Nenhum pedido atual de proposta padrão comprovado.'}
    const cfg=await this.config.aprovada(c.modeloHash)
    if(!cfg)return {acao:'humano',motivo:'A proposta padrão depende do cadastro, da conta Autentique e da aprovação única do modelo.'}
    const anteriores=(await this.listar()).filter(p=>p.leadId===c.leadId).sort((a,b)=>Date.parse(b.criadaEm)-Date.parse(a.criadaEm))
    const id=this.id(c,leitura)
    for(const p of anteriores){const e=await this.estado(p.id)
      if(e.estado==='assinada')return {acao:'aguardar',propostaId:p.id,motivo:'Aceite observado na Autentique. Aguardar a entrega; assinatura não libera cobrança antes do site visto no ar.'}
      if(p.id!==id&&e.tentativaEm)return {acao:'humano',propostaId:p.id,motivo:'Há outra versão em assinatura ou dados alterados após a emissão; conferir a versão antes de criar outro documento.'}
    }
    if(CAMPOS_CLIENTE_ENCONTRADO.some(k=>!leitura.cadastro[k])){
      const texto=perguntasCadastroEncontrado(leitura.cadastro),vezes=c.mensagens.filter(m=>m.direcao==='saida'&&m.texto.includes(texto)).length
      if(vezes>=2)return {acao:'humano',motivo:'Os dados da assinatura seguem ambíguos após esclarecimento; conferir o representante e o cadastro.'}
      return {acao:'responder',modelo:'proposta-cadastro-'+CAMPOS_CLIENTE_ENCONTRADO.filter(k=>!leitura.cadastro[k]).join('-').toLowerCase()+(vezes?'-esclarecer':''),texto:(vezes?'Vamos conferir os dados que ainda não consegui validar.\n\n':'')+texto,motivo:'Pedir somente os dados que faltam ao próprio cliente, para a proposta e a assinatura.'}
    }
    validarParteEncontrado(Object.fromEntries(CAMPOS_CLIENTE_ENCONTRADO.map(k=>[k,leitura.cadastro[k]!.valor])))
    const p=anteriores.find(p=>p.id===id)
    if(!p)return {acao:'emitir-proposta',propostaId:id,leitura,motivo:'Preparar e reservar a versão exata da proposta padrão solicitada.'}
    const e=await this.estado(id)
    if(e.motivo==='franquia')return {acao:'humano',propostaId:id,motivo:'A franquia gratuita desta automação foi atingida. Decidir capacidade ou plano antes de emitir novos documentos.'}
    if(e.motivo==='plano')return {acao:'humano',propostaId:id,motivo:'A conta deixou de estar no plano gratuito. Conferir custos e limites antes de liberar a integração.'}
    if(e.primeiraFalhaEm&&this.agora()-Date.parse(e.primeiraFalhaEm)>30*60000)return {acao:'humano',propostaId:id,motivo:'A integração permanece indisponível após novas conferências; resolver a conta ou o documento antes de prosseguir.'}
    if(e.estado==='assinada')return {acao:'aguardar',propostaId:id,motivo:'Aceite comprovado; entrega e cobrança conservam seus próprios gatilhos.'}
    if(['conferencia','recusada','expirada'].includes(e.estado)||Date.parse(p.validaAte)<=this.agora())return {acao:'humano',propostaId:id,motivo:e.estado==='recusada'?'O cliente recusou o documento; preservar a recusa e decidir a próxima condição.':'Conferir a validade, a versão ou o documento antes de qualquer novo convite.'}
    if(e.estado==='aguardando'&&e.link&&e.originalHash)return {acao:'responder',propostaId:id,modelo:'proposta-assinatura',texto:`Preparei a proposta padrão do Encontrado: ${CATALOGO_ENCONTRADO.preco} de implantação + ${CATALOGO_ENCONTRADO.mensal}. Confira os termos e, se concordar, assine pela Autentique: ${linkAssinaturaAutentique(e.link)}\n\nA implantação só é cobrada depois de você ver o site funcionando no ar. Abrir o link não confirma aceite.`,motivo:'A proposta e o signatário foram conferidos; entregar o link exclusivo pela conversa comprovada.'}
    if(e.estado==='preparada')return {acao:'emitir-proposta',propostaId:id,leitura,motivo:'A proposta padrão está preparada para emissão pela integração.'}
    if(e.tentativaEm&&this.agora()-Date.parse(e.tentativaEm)>30*60000)return {acao:'humano',propostaId:id,motivo:'A criação do documento segue sem comprovação após reconciliação; conferir a Autentique sem criar duplicata.'}
    return {acao:'aguardar',propostaId:id,motivo:'O time está conciliando a criação do documento e seu arquivo original; não repetir a emissão.'}
  }
  async preparar(c:ContextoPropostaEncontrado):Promise<void>{
    const plano=await this.avaliar(c);if(plano.acao!=='emitir-proposta'||!plano.leitura.pedido)return
    const cfg=await this.config.aprovada(c.modeloHash);if(!cfg)return
    const agora=this.agora(),base:Omit<PropostaEncontrado,'htmlHash'>={v:1,id:plano.propostaId,leadId:c.leadId,conversa:c.conversa,entradaChave:c.entradaChave,criadaEm:new Date(agora).toISOString(),validaAte:new Date(agora+cfg.condicoes.validadeDias*86400_000).toISOString(),versao:VERSAO_PROPOSTA_ENCONTRADO,modeloHash:c.modeloHash,catalogoHash:hashCanonicoComercial(CATALOGO_ENCONTRADO),prumo:cfg.prumo,cliente:validarParteEncontrado(Object.fromEntries(CAMPOS_CLIENTE_ENCONTRADO.map(k=>[k,plano.leitura.cadastro[k]!.valor]))),condicoes:cfg.condicoes,catalogo:{...CATALOGO_ENCONTRADO},pedido:plano.leitura.pedido,cadastro:plano.leitura.cadastro}
    await gravarPrivadoEncontrado(this.arquivo(base.id,'proposta'),{...base,htmlHash:shaProposta(htmlPropostaEncontrado(base))},true)
  }
  private async conferirDocumento(p:PropostaEncontrado,e:EstadoPropostaEncontrado,d:DocumentoAutentique,cfg:ConfigPropostaEncontrado):Promise<void>{
    const s=conferirSignatarioAutentique(d,p.cliente,nomeDocumentoEncontrado(p.id),this.agora())
    if(Date.parse(d.created_at)<Date.parse(e.tentativaEm??p.criadaEm)-1000||e.assinaturaId&&e.assinaturaId!==s.public_id||e.documentoId&&e.documentoId!==d.id)throw new ErroAutentique('conferencia')
    e.documentoId=d.id;e.assinaturaId=s.public_id
    // Guardar o ID retornado pela criação antes de qualquer download que possa falhar.
    await this.gravar(e)
    const original=await this.config.cliente(cfg.autentique!.token).original(d)
    if(e.originalHash&&e.originalHash!==original.hash)throw new ErroAutentique('conferencia')
    e.originalHash=original.hash
    const arq=this.arquivo(p.id,'original');await fs.writeFile(arq,original.bytes,{mode:0o600})
    if(e.recuperada&&!e.recuperadaConfirmadaEm){e.estado='conferencia'}
    else if(s.rejected||s.biometric_rejected)e.estado='recusada'
    else if(s.signed&&!s.signed_unapproved&&d.files?.signed){
      arquivoAutentiqueUrl(d.files.signed)
      if(Date.parse(s.signed.created_at)>Date.parse(p.validaAte))throw new ErroAutentique('conferencia')
      e.estado='assinada';e.aceiteEm=s.signed.created_at
    }else if(s.signed&&!s.signed_unapproved&&!d.files?.signed)e.estado='criando'
    else if(Date.parse(p.validaAte)<=this.agora())e.estado='expirada'
    else if(!s.link?.short_link)e.estado='criando'
    else{e.link=linkAssinaturaAutentique(s.link.short_link);e.estado='aguardando'}
    e.proximaConsultaEm=new Date(this.agora()+10*60000).toISOString();delete e.primeiraFalhaEm;await this.gravar(e)
  }
  /** Consulta somente documentos próprios; preparação remota ocorre fora da trava de tomada humana. */
  async executar(autorizar:(id:string,reservar?:()=>Promise<void>)=>Promise<ConfigPropostaEncontrado|null>):Promise<void>{
    await this.config.homologar()
    let consultados=0
    const trabalhos=await this.listar(),estados=new Map(await Promise.all(trabalhos.map(async p=>[p.id,await this.estado(p.id)] as const)))
    trabalhos.sort((a,b)=>Number(estados.get(a.id)!.estado!=='preparada')-Number(estados.get(b.id)!.estado!=='preparada')||Date.parse(a.criadaEm)-Date.parse(b.criadaEm)||a.id.localeCompare(b.id))
    for(const p of trabalhos){
      if(consultados>=1)break
      await comGuardaConversa(path.join(this.pasta,'locks'),p.conversa,async()=>{
        let e=await this.estado(p.id)
        if(['assinada','recusada','expirada','conferencia'].includes(e.estado)||e.proximaConsultaEm&&Date.parse(e.proximaConsultaEm)>this.agora())return
        const cfg=await this.config.ler();if(!cfg?.autentique)return
        const api=this.config.cliente(cfg.autentique.token)
        try{
          if(e.estado==='preparada'){
            let ultimaEmissao=0
            for(const outra of await this.listar()){const oe=await this.estado(outra.id);if(oe.conta===identidadeContaEncontrado(cfg.autentique.conta))ultimaEmissao=Math.max(ultimaEmissao,Date.parse(oe.tentativaEm??'')||0)}
            // Cabe no ritmo da conta gratuita, inclusive as conferências antes do convite.
            if(ultimaEmissao&&this.agora()-ultimaEmissao<120000)return
            if(!await autorizar(p.id))return
            const conta=await api.conta();if(!conta.gratuita)throw new ErroAutentique('plano');if(identidadeContaEncontrado(conta)!==identidadeContaEncontrado(cfg.autentique.conta))throw new ErroAutentique('conferencia')
            const reservado=await comGuardaConversa(path.join(this.pasta,'cota-locks'),'1000000001',async()=>{
              let usados=0,ultima=0;for(const outra of await this.listar()){const oe=await this.estado(outra.id);if(oe.tentativaEm&&oe.conta===identidadeContaEncontrado(conta)){ultima=Math.max(ultima,Date.parse(oe.tentativaEm));if(mesSP(oe.tentativaEm)===mesSP(new Date(this.agora()).toISOString()))usados++}}
              if(ultima&&this.agora()-ultima<120000)return null
              if(usados>=10)throw new ErroAutentique('franquia')
              return autorizar(p.id,async()=>{e={v:1,id:p.id,estado:'criando',tentativaEm:new Date(this.agora()).toISOString(),conta:identidadeContaEncontrado(conta)};await this.gravar(e)})
            })
            if(!reservado)return
            consultados++
            const d=await api.criar(nomeDocumentoEncontrado(p.id),htmlPropostaEncontrado(p),p.cliente,p.validaAte)
            await this.conferirDocumento(p,e,d,cfg)
          }else{
            consultados++
            const conta=await api.conta();if(!conta.gratuita)throw new ErroAutentique('plano');if(e.conta!==identidadeContaEncontrado(conta)||e.conta!==identidadeContaEncontrado(cfg.autentique.conta))throw new ErroAutentique('conferencia')
            const d=e.documentoId?await api.documento(e.documentoId):await api.localizar(nomeDocumentoEncontrado(p.id))
            if(!d){e.proximaConsultaEm=new Date(this.agora()+5*60000).toISOString();await this.gravar(e);return}
            if(!e.documentoId)e.recuperada=true
            await this.conferirDocumento(p,e,d,cfg)
          }
        }catch(error){
          e=await this.estado(p.id)
          if(error instanceof ErroAutentique&&['conferencia','franquia','plano'].includes(error.codigo)){e.estado='conferencia';if(error.codigo==='franquia'||error.codigo==='plano')e.motivo=error.codigo}
          else if(e.estado==='criando')e.estado='incerta'
          e.primeiraFalhaEm??=new Date(this.agora()).toISOString();e.proximaConsultaEm=new Date(this.agora()+5*60000).toISOString();await this.gravar(e)
        }
      })
    }
  }
  async conferirEntrega(id:string):Promise<boolean>{
    const p=(await this.listar()).find(p=>p.id===id),e=p&&await this.estado(id),cfg=await this.config.aprovada(p?.modeloHash)
    if(!p||!e?.documentoId||!e.originalHash||e.estado!=='aguardando'||!cfg?.autentique||Date.parse(p.validaAte)<=this.agora())return false
    try{
      const api=this.config.cliente(cfg.autentique.token),conta=await api.conta();if(!conta.gratuita||e.conta!==identidadeContaEncontrado(conta))return false
      const d=await api.documento(e.documentoId),s=conferirSignatarioAutentique(d,p.cliente,nomeDocumentoEncontrado(id),this.agora())
      if(s.public_id!==e.assinaturaId||s.signed||s.rejected||s.signed_unapproved||s.biometric_rejected||linkAssinaturaAutentique(s.link?.short_link)!==e.link)return false
      return (await api.original(d)).hash===e.originalHash
    }catch{return false}
  }
  async visoes():Promise<Map<string,ContratacaoEncontradoVisao>>{
    const mapa=new Map<string,ContratacaoEncontradoVisao>()
    for(const p of (await this.listar()).sort((a,b)=>Date.parse(a.criadaEm)-Date.parse(b.criadaEm))){const e=await this.estado(p.id)
      const estado=({preparada:'preparada',criando:'criacao-incerta',incerta:'criacao-incerta',aguardando:'aguardando-assinatura',assinada:'assinada',recusada:'recusada',expirada:'expirada',conferencia:'conferencia'} as const)[e.estado]
      mapa.set(p.leadId,{referencia:p.id,estado,criadaEm:p.criadaEm,validaAte:p.validaAte,modeloHash:p.modeloHash,...(e.originalHash?{originalHash:e.originalHash}:{}),...(e.recuperada&&!e.recuperadaConfirmadaEm?{recuperacaoPendente:true}:{}),...(e.documentoId?{documentoId:e.documentoId}:{}),...(e.aceiteEm?{aceiteEm:e.aceiteEm}:{}),origem:'encontrado-autentique',motivo:e.motivo==='franquia'?'Franquia gratuita atingida; decidir capacidade ou plano antes de emitir.':e.motivo==='plano'?'Conferir custos e limites da conta antes de liberar a integração.':estado==='assinada'?'Aceite confirmado pela assinatura da versão vinculada. Cobrança ainda depende do site visto no ar.':estado==='conferencia'?'Conferir o documento e a versão antes de prosseguir.':'O time acompanha a proposta e a assinatura pela Autentique.'})
    }return mapa
  }
  async originalParaConferencia(id:string){const p=(await this.listar()).find(p=>p.id===id),e=p&&await this.estado(id);if(!p||!e?.originalHash)throw new Error('Arquivo ainda indisponível.');const bytes=await fs.readFile(this.arquivo(id,'original'));if(shaProposta(bytes)!==e.originalHash)throw new Error('Arquivo divergente.');return {bytes,hash:e.originalHash}}
  async confirmarRecuperacao(id:string,originalHash:string){
    const p=(await this.listar()).find(p=>p.id===id);if(!p)throw new Error('Proposta ausente.')
    return comGuardaConversa(path.join(this.pasta,'locks'),p.conversa,async()=>{
      const e=await this.estado(id),cfg=await this.config.ler()
      if(e.estado!=='conferencia'||!e.recuperada||!e.documentoId||e.originalHash!==originalHash||!cfg?.autentique)throw new Error('Reabra a conferência do documento atual.')
      await this.originalParaConferencia(id);const api=this.config.cliente(cfg.autentique.token),conta=await api.conta();if(!conta.gratuita||e.conta!==identidadeContaEncontrado(conta))throw new Error('Conferir a conta atual.');const d=await api.documento(e.documentoId)
      e.recuperadaConfirmadaEm=new Date(this.agora()).toISOString();await this.conferirDocumento(p,e,d,cfg)
    })
  }
}
