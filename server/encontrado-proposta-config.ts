import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {hashCanonicoComercial} from './registro-comercial-duravel.ts'
import {comGuardaConversa} from './guarda-conversa.ts'
import {CATALOGO_ENCONTRADO} from '../src/operations/encontrado-politica.ts'
import {Autentique,linkAssinaturaAutentique} from './autentique.ts'
import {CONDICOES_SUGERIDAS_ENCONTRADO,VERSAO_PROPOSTA_ENCONTRADO,validarParteEncontrado,validarCondicoesEncontrado,htmlPropostaEncontrado,type ParteEncontrado,type CondicoesEncontrado,type PropostaEncontrado} from '../src/operations/encontrado-proposta.ts'

export const HASH_POLITICA_PROPOSTA_ENCONTRADO=hashCanonicoComercial({versao:VERSAO_PROPOSTA_ENCONTRADO,protocolo:'autentique-create-link-consulta-original-v1'})
export type ClienteAutentique=Pick<Autentique,'conta'|'criar'|'documento'|'localizar'|'original'>
export interface ConfigPropostaEncontrado {
  v:1;prumo:ParteEncontrado;condicoes:CondicoesEncontrado
  autentique?:{token:string;conta:Awaited<ReturnType<Autentique['conta']>>;conferidaEm:string}
  aprovacao?:{modeloHash:string;em:string;operador:string;autorizaDadosAutentique:true}
}
export async function jsonPrivadoEncontrado(arquivo:string):Promise<any|null>{
  let h:Awaited<ReturnType<typeof fs.open>>
  try{h=await fs.open(arquivo,'r')}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e}
  try{if((await h.stat()).size>2*1024*1024)throw new Error('Registro excede o limite.');return JSON.parse(await h.readFile('utf8'))}finally{await h.close()}
}
export async function gravarPrivadoEncontrado(arquivo:string,valor:unknown,exclusivo=false):Promise<boolean>{
  const dir=path.dirname(arquivo);await fs.mkdir(dir,{recursive:true,mode:0o700})
  const temp=arquivo+'.'+randomUUID()+'.tmp',h=await fs.open(temp,'wx',0o600)
  try{await h.writeFile(JSON.stringify(valor));await h.sync()}finally{await h.close()}
  try{if(exclusivo)await fs.link(temp,arquivo);else await fs.rename(temp,arquivo)}catch(e){if(exclusivo&&(e as NodeJS.ErrnoException).code==='EEXIST')return false;throw e}
  finally{await fs.unlink(temp).catch(()=>undefined)}
  if(process.platform!=='win32'){const d=await fs.open(dir,'r');try{await d.sync()}finally{await d.close()}}
  return true
}
export class ConfiguracaoPropostaEncontrado {
  readonly arquivo:string
  constructor(readonly pasta:string,readonly cliente:(token:string)=>ClienteAutentique=token=>new Autentique(token),private agora:()=>number=Date.now){this.arquivo=path.join(pasta,'encontrado-proposta-config.json')}
  hashModelo(prumo:ParteEncontrado,condicoes:CondicoesEncontrado):string{
    // Vincula implementação do termo, catálogo e cadastro; um padrão alterado pede nova aprovação.
    const p=this.exemplo(prumo,condicoes,'0'.repeat(64))
    return hashCanonicoComercial({html:htmlPropostaEncontrado(p),protocolo:HASH_POLITICA_PROPOSTA_ENCONTRADO})
  }
  private exemplo(prumo:ParteEncontrado,condicoes:CondicoesEncontrado,modeloHash:string):Omit<PropostaEncontrado,'htmlHash'>{
    return {v:1,id:'EXEMPLO-SEM-ENVIO',leadId:'exemplo',conversa:'1000000000',entradaChave:'0'.repeat(64),criadaEm:'2026-01-01T12:00:00.000Z',validaAte:new Date(Date.parse('2026-01-01T12:00:00.000Z')+condicoes.validadeDias*86400_000).toISOString(),versao:VERSAO_PROPOSTA_ENCONTRADO,modeloHash,catalogoHash:hashCanonicoComercial(CATALOGO_ENCONTRADO),prumo,cliente:{razaoSocial:'Empresa de exemplo — não enviar',cnpj:'12ABC34501DE35',representante:'Representante de exemplo',email:'exemplo@example.com'},condicoes,catalogo:{...CATALOGO_ENCONTRADO},pedido:{id:'exemplo',em:'2026-01-01T12:00:00.000Z',hash:'0'.repeat(64),trecho:'Exemplo sem pedido real'},cadastro:{}}
  }
  previa(prumo:ParteEncontrado,condicoes:CondicoesEncontrado){const hash=this.hashModelo(prumo,condicoes);return {modeloHash:hash,html:htmlPropostaEncontrado(this.exemplo(prumo,condicoes,hash),true)}}
  async ler():Promise<ConfigPropostaEncontrado|null>{
    const c=await jsonPrivadoEncontrado(this.arquivo) as ConfigPropostaEncontrado|null
    if(!c)return null
    if(c.v!==1)throw new Error('Configuração de proposta inválida.')
    validarParteEncontrado(c.prumo);validarCondicoesEncontrado(c.condicoes)
    if(c.autentique&&(!c.autentique.token||!c.autentique.conta?.id||!Number.isFinite(Date.parse(c.autentique.conferidaEm))))throw new Error('Credencial da assinatura exige conferência.')
    return c
  }
  async aprovada(modeloHash?:string):Promise<ConfigPropostaEncontrado|null>{
    const c=await this.ler();if(!c?.aprovacao||!c.autentique)return null
    const hash=this.hashModelo(c.prumo,c.condicoes)
    return c.autentique.conta.gratuita===true&&(await this.homologacao(c)).estado==='aprovada'&&c.aprovacao.modeloHash===hash&&c.aprovacao.autorizaDadosAutentique===true&&(!modeloHash||modeloHash===hash)?c:null
  }
  private chaveTeste(c:ConfigPropostaEncontrado){return hashCanonicoComercial({conta:c.autentique?.conta.id,organizacao:c.autentique?.conta.organizacao?.id??null,tokenHash:hashCanonicoComercial(c.autentique?.token??''),protocolo:HASH_POLITICA_PROPOSTA_ENCONTRADO})}
  async homologacao(c?:ConfigPropostaEncontrado|null):Promise<{estado:'aguardando-conta'|'pendente'|'aprovada'|'falha'}>{
    c??=await this.ler();if(!c?.autentique)return {estado:'aguardando-conta'}
    const h=await jsonPrivadoEncontrado(path.join(this.pasta,'encontrado-autentique-homologacao',this.chaveTeste(c)+'.json'))
    return {estado:h?.estado==='aprovada'?'aprovada':h?.estado==='falha'?'falha':'pendente'}
  }
  /** Só após o operador conectar o token. Sandbox contém exclusivamente dados fictícios fixos. */
  async homologar():Promise<void>{
    const c=await this.ler();if(!c?.autentique)return
    const chave=this.chaveTeste(c),arquivo=path.join(this.pasta,'encontrado-autentique-homologacao',chave+'.json')
    await comGuardaConversa(path.join(this.pasta,'encontrado-teste-locks'),'1000000002',async()=>{
      let e=await jsonPrivadoEncontrado(arquivo)
      if(e?.estado==='aprovada'||e?.estado==='falha'||e?.proximaEm&&Date.parse(e.proximaEm)>this.agora())return
      const api=this.cliente(c.autentique!.token),nome='SquadOne TESTE FICTICIO '+chave,cliente:ParteEncontrado={razaoSocial:'Empresa fictícia — teste sem valor comercial',cnpj:'12ABC34501DE35',representante:'Pessoa fictícia de teste',email:'teste@example.com'}
      try{
        const conta=await api.conta();if(!conta.gratuita||conta.id!==c.autentique!.conta.id||conta.organizacao?.id!==c.autentique!.conta.organizacao?.id)throw new Error('Conta exige conferência.')
        let d
        if(!e){
          e={v:1,chave,estado:'pendente',tentativaEm:new Date(this.agora()).toISOString()};await gravarPrivadoEncontrado(arquivo,e)
          // Não usar cadastro da Prumo, conversas ou material real no sandbox.
          d=await api.criar(nome,'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Teste fictício</title><body><h1>TESTE TÉCNICO FICTÍCIO — NÃO ASSINAR</h1><p>Verificação automática da integração SquadOne com Autentique. Não é proposta, contratação, aceite ou cobrança. Nenhum dado de cliente real.</p><p>Referência técnica: '+chave+'</p></body></html>',cliente,new Date(this.agora()+86400_000).toISOString(),true)
        }else d=e.documentoId?await api.documento(e.documentoId):await api.localizar(nome,true)
        if(!d)throw new Error('Aguardar consulta do documento de teste.')
        e.documentoId=d.id;await gravarPrivadoEncontrado(arquivo,e)
        if(d.name!==nome||d.sandbox!==true&&d.sandbox!==1||d.deleted_at||d.signatures.length!==1||d.signatures[0].email?.toLowerCase()!==cliente.email||d.signatures[0].signed)throw new Error('Teste não corresponde ao sandbox previsto.')
        linkAssinaturaAutentique(d.signatures[0].link?.short_link)
        const original=await api.original(d)
        await gravarPrivadoEncontrado(arquivo,{...e,estado:'aprovada',originalHash:original.hash,conferidaEm:new Date(this.agora()).toISOString()})
      }catch{
        e??={v:1,chave,estado:'pendente',tentativaEm:new Date(this.agora()).toISOString()}
        const expirou=this.agora()-Date.parse(e.tentativaEm)>30*60000
        await gravarPrivadoEncontrado(arquivo,{...e,estado:expirou?'falha':'pendente',proximaEm:new Date(this.agora()+2*60000).toISOString()})
      }
    })
  }
  async salvar(v:unknown):Promise<void>{
    const p=v as {prumo:ParteEncontrado;condicoes:CondicoesEncontrado;token?:string}
    if(!p||Object.keys(p).some(k=>!['prumo','condicoes','token'].includes(k)))throw new Error('Configuração inválida.')
    const prumo=validarParteEncontrado(p.prumo),condicoes=validarCondicoesEncontrado(p.condicoes)
    await comGuardaConversa(path.join(this.pasta,'encontrado-config-locks'),'1000000000',async()=>{
      const antiga=await this.ler(),token=p.token===undefined||p.token===''?antiga?.autentique?.token:p.token
      if(token!==undefined&&(typeof token!=='string'||token.length<10||token.length>4096||/\s/.test(token)))throw new Error('Token inválido; use o campo privado da integração.')
      const c:ConfigPropostaEncontrado={v:1,prumo,condicoes}
      if(token){const conta=await this.cliente(token).conta();c.autentique={token,conta,conferidaEm:new Date(this.agora()).toISOString()}}
      if(antiga?.aprovacao?.modeloHash===this.hashModelo(prumo,condicoes)&&antiga.autentique?.conta.id===c.autentique?.conta.id&&antiga.autentique?.conta.organizacao?.id===c.autentique?.conta.organizacao?.id)c.aprovacao=antiga.aprovacao
      await gravarPrivadoEncontrado(this.arquivo,c)
    })
  }
  async aprovar(modeloHash:string,operador:string):Promise<ConfigPropostaEncontrado>{
    return comGuardaConversa(path.join(this.pasta,'encontrado-config-locks'),'1000000000',async()=>{
      const c=await this.ler();if(!c?.autentique||this.hashModelo(c.prumo,c.condicoes)!==modeloHash||(await this.homologacao(c)).estado!=='aprovada')throw new Error('Reabra o modelo atual e aguarde a conferência técnica da Autentique antes de aprovar.')
      const conta=await this.cliente(c.autentique.token).conta()
      if(!conta.gratuita||conta.id!==c.autentique.conta.id||conta.organizacao?.id!==c.autentique.conta.organizacao?.id)throw new Error('Conferir a conta e o plano gratuito antes de ativar.')
      c.aprovacao={modeloHash,em:new Date(this.agora()).toISOString(),operador,autorizaDadosAutentique:true}
      await gravarPrivadoEncontrado(this.arquivo,c);return c
    })
  }
  async visao(){
    const c=await this.ler(),prumo=c?.prumo??{razaoSocial:'',cnpj:'',representante:'Rômulo Sutil Corrêa',email:'contato@prumo.services'},condicoes=c?.condicoes??{...CONDICOES_SUGERIDAS_ENCONTRADO}
    const previa=this.previa(prumo,condicoes)
    const homologacao=await this.homologacao(c)
    return {prumo,condicoes,...previa,homologacao:homologacao.estado,conta:c?.autentique?{nome:c.autentique.conta.nome,email:c.autentique.conta.email,gratuita:c.autentique.conta.gratuita}:null,credencialConfigurada:!!c?.autentique,aprovado:!!await this.aprovada(),pendencias:[!c&&'Cadastrar a pessoa jurídica da Prumo',!c?.autentique&&'Criar a conta Autentique e conectar o token',c?.autentique&&homologacao.estado==='pendente'&&'Aguardar conferência técnica automática com documento fictício',homologacao.estado==='falha'&&'Conferir a integração: o teste técnico ainda não foi comprovado',c?.autentique&&!c.autentique.conta.gratuita&&'Conferir o plano: este lote está limitado à conta gratuita',!await this.aprovada()&&'Conferir e aprovar este modelo uma vez'].filter(Boolean)}
  }
}
