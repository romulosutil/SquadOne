import type { CATALOGO_ENCONTRADO } from './encontrado-politica.ts'
import type { EvidenciaEncontrado } from './encontrado-qualificacao.ts'

export const VERSAO_PROPOSTA_ENCONTRADO='encontrado-proposta-autentique-v1'
export interface ParteEncontrado {razaoSocial:string;cnpj:string;representante:string;email:string}
export interface CondicoesEncontrado {prazoDiasUteis:number;validadeDias:number;avisoEncerramentoDias:number;mensalidadeInicio:'mes-seguinte'}
export const CONDICOES_SUGERIDAS_ENCONTRADO:CondicoesEncontrado={prazoDiasUteis:5,validadeDias:15,avisoEncerramentoDias:30,mensalidadeInicio:'mes-seguinte'}
export interface DadoClienteEncontrado {valor:string;evidencia:EvidenciaEncontrado}
export type CadastroClienteEncontrado=Partial<Record<keyof ParteEncontrado,DadoClienteEncontrado>>
export interface PropostaEncontrado {
  v:1;id:string;leadId:string;conversa:string;entradaChave:string;criadaEm:string;validaAte:string
  versao:string;modeloHash:string;catalogoHash:string;prumo:ParteEncontrado;cliente:ParteEncontrado
  condicoes:CondicoesEncontrado;catalogo:typeof CATALOGO_ENCONTRADO
  pedido:EvidenciaEncontrado;cadastro:CadastroClienteEncontrado;htmlHash:string
}
export interface ContratacaoEncontradoVisao {
  referencia:string;estado:'preparada'|'criacao-incerta'|'aguardando-assinatura'|'assinada'|'recusada'|'expirada'|'conferencia'
  criadaEm:string;validaAte:string;modeloHash:string;documentoId?:string;aceiteEm?:string
  origem:'encontrado-autentique';motivo:string
  originalHash?:string;recuperacaoPendente?:boolean
}
export const EMAIL_ENCONTRADO=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/
/** RFB: base alfanumérica, ASCII - 48, módulo 11. Não comprova situação cadastral. */
export function normalizarCnpj(v:string):string{return v.replace(/[.\/-]|\s/g,'').toUpperCase()}
export function cnpjEncontradoValido(v:string):boolean {
  const s=normalizarCnpj(v);if(!/^[A-Z0-9]{12}\d{2}$/.test(s)||/^(.)\1+$/.test(s))return false
  const dv=(base:string)=>{let peso=2,soma=0;for(let i=base.length-1;i>=0;i--){soma+=(base.charCodeAt(i)-48)*peso;peso=peso===9?2:peso+1}const resto=soma%11;return String(resto<2?0:11-resto)}
  return s[12]===dv(s.slice(0,12))&&s[13]===dv(s.slice(0,13))
}
const texto=(v:unknown,limite:number)=>typeof v==='string'&&v.trim().length>=3&&v.trim().length<=limite&&!/[\u0000-\u001f\u007f<>]/.test(v)
export function validarParteEncontrado(v:unknown):ParteEncontrado {
  const p=v as ParteEncontrado
  if(!p||Object.keys(p).sort().join(',')!=='cnpj,email,razaoSocial,representante'||!texto(p.razaoSocial,160)||!texto(p.representante,120)||!cnpjEncontradoValido(p.cnpj??'')||typeof p.email!=='string'||p.email.length>180||!EMAIL_ENCONTRADO.test(p.email.trim()))throw new Error('Confira razão social, CNPJ, representante e e-mail da assinatura.')
  return {razaoSocial:p.razaoSocial.trim(),cnpj:normalizarCnpj(p.cnpj),representante:p.representante.trim(),email:p.email.trim().toLowerCase()}
}
export function validarCondicoesEncontrado(v:unknown):CondicoesEncontrado {
  const c=v as CondicoesEncontrado
  if(!c||Object.keys(c).sort().join(',')!=='avisoEncerramentoDias,mensalidadeInicio,prazoDiasUteis,validadeDias'||!Number.isInteger(c.prazoDiasUteis)||c.prazoDiasUteis<1||c.prazoDiasUteis>60||!Number.isInteger(c.validadeDias)||c.validadeDias<1||c.validadeDias>60||!Number.isInteger(c.avisoEncerramentoDias)||c.avisoEncerramentoDias<0||c.avisoEncerramentoDias>60||c.mensalidadeInicio!=='mes-seguinte')throw new Error('Confira prazo, validade, aviso de encerramento e início da mensalidade.')
  return {...c}
}
export const CAMPOS_CLIENTE_ENCONTRADO=['razaoSocial','cnpj','representante','email'] as const
export const ROTULOS_CADASTRO_ENCONTRADO:Record<keyof ParteEncontrado,string>={razaoSocial:'Razão social',cnpj:'CNPJ',representante:'Representante',email:'E-mail'}
export function perguntasCadastroEncontrado(c:CadastroClienteEncontrado):string {
  const faltam=CAMPOS_CLIENTE_ENCONTRADO.filter(k=>!c[k])
  return 'Para preparar a proposta padrão do Encontrado e o link de assinatura pela Autentique, preciso dos dados abaixo. Responda com um campo por linha:\n\n'+faltam.map(k=>ROTULOS_CADASTRO_ENCONTRADO[k]+':').join('\n')+'\n\nO representante deve poder aprovar a contratação pela empresa. Esses dados serão usados no documento e na assinatura pela Autentique.'
}
export function textoSemCadastroEncontrado(texto:string){return texto.split('\n').filter(l=>!/^\s*(?:Raz[aã]o social|Empresa|CNPJ|Representante|E-?mail)\s*:/i.test(l)).join('\n')}
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const data=(v:string)=>new Date(v).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})
/** HTML sem scripts, recursos remotos ou campos soltos. O mesmo pacote segue para assinatura. */
export function htmlPropostaEncontrado(p:Omit<PropostaEncontrado,'htmlHash'>,rascunho=false):string {
  const a=p.prumo,b=p.cliente,c=p.condicoes,o=p.catalogo
  const parte=(x:ParteEncontrado)=>`<strong>${esc(x.razaoSocial)}</strong><br>CNPJ ${esc(x.cnpj)}<br>Representante: ${esc(x.representante)}<br>${esc(x.email)}`
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Encontrado · proposta ${esc(p.id)}</title><style>
@page{size:A4;margin:17mm}*{box-sizing:border-box}body{font:11pt/1.5 Arial,sans-serif;color:#1B1512;background:#fff;max-width:178mm;margin:0 auto}header{border-bottom:3px solid #E0490F;padding-bottom:12px;margin-bottom:20px}h1{font-size:25pt;margin:2px 0}h2{font-size:13pt;margin:20px 0 7px;color:#4A3E36}p{margin:7px 0}.marca{font-size:10pt;letter-spacing:2px;color:#E0490F}.referencia{font-size:8pt;overflow-wrap:anywhere;color:#5E564F}.partes{display:table;width:100%;border-spacing:0 10px}.parte{display:table-cell;width:50%;padding-right:14px}li{margin:4px 0}.preco{padding:14px;background:#F6EEE5;border-left:4px solid #E0490F;font-size:13pt}.aviso{padding:12px;background:#fff3db;border:1px solid #E8A33D}.assinatura{margin-top:25px;padding-top:12px;border-top:1px solid #CFC7BD}footer{margin-top:20px;font-size:8pt;color:#5E564F}h2,.preco,.assinatura{break-inside:avoid}a{color:inherit}</style></head><body>
${rascunho?'<p class="aviso"><strong>MINUTA PARA APROVAÇÃO DO PADRÃO.</strong> Exemplo fictício, não enviado e sem valor de proposta para cliente. Prazos e condições abaixo são sugestões até a aprovação da operação.</p>':''}
<header><div class="marca">PRUMO · SITE</div><h1>Encontrado</h1><p>Proposta comercial e termo de aceite</p><p class="referencia">Referência ${esc(p.id)} · Modelo ${esc(p.versao)}<br>Emitida em ${data(p.criadaEm)} · Válida até ${data(p.validaAte)}<br>Versão do padrão: ${esc(p.modeloHash)}</p></header>
<div class="partes"><div class="parte"><h2>Prestadora</h2>${parte(a)}</div><div class="parte"><h2>Empresa cliente</h2>${parte(b)}</div></div>
<h2>1. O que será entregue</h2><p>${esc(o.escopo)}</p><p>O site apresentará a empresa, seus serviços, endereço e contato pelo WhatsApp. Textos, imagens, endereço de domínio e conteúdo final dependem da conferência e aprovação da empresa cliente. O domínio será registrado em nome da empresa cliente, conforme disponibilidade.</p>
<h2>2. Investimento</h2><p class="preco"><strong>${esc(o.preco)}</strong> de implantação + <strong>${esc(o.mensal)}</strong>.</p><p>A implantação só será cobrada depois que a empresa cliente vir o site funcionando no ar, em seu endereço de domínio. A assinatura deste documento, isoladamente, não libera cobrança nem comprova que o site foi visto.</p><p>A mensalidade começa no mês seguinte à entrega aprovada e à visualização do site funcionando. Inclui domínio, hospedagem e um ajuste de conteúdo por mês. Não há fidelidade mínima. Despesas adicionais ou serviços fora do escopo dependem de novo acordo antes da execução.</p>
<h2>3. Materiais, início e prazo</h2><p>A empresa cliente fornece ou aprova informações, textos, imagens e acessos necessários, com autorização de uso. O prazo padrão é de ${c.prazoDiasUteis} dias úteis, contado após o aceite e a confirmação de que todos os materiais, acessos e aprovações necessários estão disponíveis. Pendências da empresa cliente suspendem a contagem; o novo calendário será comunicado. Aprovação do conteúdo e escolha do domínio precedem a publicação definitiva.</p>
<h2>4. Limites e responsabilidades</h2><p>${esc(o.exclusoes)}</p><p>O ajuste mensal cobre atualização de conteúdo do site; novas funcionalidades ou mudança de escopo exigem proposta própria. A empresa cliente responde pela correção e pelos direitos de uso dos materiais fornecidos. A Prumo usa os dados somente para executar o serviço, atender a empresa e manter a evidência da contratação e assinatura. Domínio e conteúdo da empresa permanecem vinculados a ela.</p>
<h2>5. Encerramento e alterações</h2><p>A mensalidade pode ser encerrada mediante aviso de ${c.avisoEncerramentoDias} dias. O encerramento não transfere o domínio à Prumo. A forma de entrega dos acessos e arquivos da empresa será combinada no encerramento. Alteração de preço, escopo ou prazo deste documento exige nova versão e novo aceite; mensagens genéricas não substituem esse acordo.</p>
<div class="assinatura"><h2>6. Aceite desta versão</h2><p>Ao assinar pela Autentique, o representante da empresa cliente declara ter poderes para representá-la e concorda com os valores, escopo, condições e versão identificados neste documento. O aceite será registrado somente após a confirmação da assinatura pela plataforma. A visualização do link, o envio de um convite ou uma resposta pelo WhatsApp não substituem a assinatura.</p><p><strong>${esc(b.representante)}</strong> · ${esc(b.razaoSocial)}<br>Assinatura eletrônica pela Autentique</p></div>
<footer>${esc(a.razaoSocial)} · ${esc(a.email)}<br>Proposta ${esc(p.id)} · Catálogo ${esc(p.catalogoHash)}</footer></body></html>`
}
