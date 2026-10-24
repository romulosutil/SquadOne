/** Indicadores derivados da conversa; não são qualificação, identidade ou autorização. Sem I/O. */
import type {MensagemDaConversa} from '../../server/conversa-do-lead.ts'
import {sinalNoTexto} from '../../server/lead-quente.ts'
import {classificarResposta} from './classificacao-resposta.ts'
import {objecoesNoTexto,normalizar} from './colinha.ts'
import {audioDaMensagem,papelDaMensagem} from './marcadores-da-conversa.ts'
export type TipoSinalComercial='preco'|'proposta'|'contratar'|'interesse'|'material'
export interface SinalComercialRecebido {tipo:TipoSinalComercial;em:string;autoria:'gente'|'nao-confirmada'}
export interface ResumoSinaisComerciais {
  v:1;sinais:SinalComercialRecebido[];ultimaEntradaEm:string|null;ultimaSaidaEm:string|null
  restricao:{tipo:'recusa'|'exclusao';em:string}|null;conteudoPendente:boolean
}
/** O leitor legado não atesta humanidade na ausência de papel; isso continua explícito no resumo. */
export type MensagemParaSinalComercial=Omit<MensagemDaConversa,'papel'> & {papel?:MensagemDaConversa['papel']|'gente'}
export function resumirSinaisComerciais(mensagens:readonly MensagemParaSinalComercial[],agora:number):ResumoSinaisComerciais {
  const linhas=mensagens.map((m,i)=>({m,i})).filter(({m})=>Number.isFinite(Date.parse(m.em))&&Date.parse(m.em)<=agora)
    .sort((a,b)=>Date.parse(a.m.em)-Date.parse(b.m.em)||a.i-b.i).slice(-60).map(({m})=>m)
  const sinais:SinalComercialRecebido[]=[],vistos=new Set<string>()
  let ultimaEntradaEm:string|null=null,ultimaSaidaEm:string|null=null,restricao:ResumoSinaisComerciais['restricao']=null,conteudoPendente=false
  for(let i=0;i<linhas.length;i++){
    const m=linhas[i]!,em=new Date(m.em).toISOString()
    if(m.direcao==='saida'){ultimaSaidaEm=em;continue}
    if(m.direcao!=='entrada'||papelDaMensagem(m.texto,m.papel))continue
    // A fonte local abaixo serve apenas ao classificador contextual. Seu atestado não é exportado.
    const leitura=classificarResposta({marcos:{},resposta:{tipo:'neutra',trecho:m.texto,em}},linhas.slice(0,i+1),agora)
    if(leitura.classe==='robo')continue
    ultimaEntradaEm=em
    const audio=audioDaMensagem(m.texto)
    conteudoPendente=conteudoPendente||!!audio&&!audio.transcricao||leitura.classe==='pendente'
    if(leitura.classe==='recusa'||leitura.classe==='exclusao'){
      restricao={tipo:leitura.classe,em};continue
    }
    // Só uma nova evidência comercial pode substituir a negativa antiga para revisão interna.
    // "ok", saudação e silêncio não desfazem uma restrição.
    const sinal=sinalNoTexto(m.texto)
    if(sinal==='irritacao'||sinal==='sinal-negativo'){restricao={tipo:'recusa',em};continue}
    const material=leitura.materialSolicitado||leitura.classe==='permissao'
    const perguntaPreco=sinal==='preco'&&(leitura.classe==='interesse'||objecoesNoTexto(m.texto).some(o=>o.id==='quanto-custa'))
    const texto=normalizar(m.texto),proposta=sinal==='proposta'&&['proposta','contrato','orcamento'].some(p=>texto.includes(p))
    const tipo:TipoSinalComercial|null=perguntaPreco?'preco':sinal==='fechar'?'contratar':proposta?'proposta':material?'material':leitura.classe==='interesse'?'interesse':null
    if(!tipo||conteudoPendente)continue
    if(['preco','contratar','interesse'].includes(tipo)&&leitura.classe==='interesse')restricao=null
    const autoria=m.papel==='gente'?'gente':'nao-confirmada',chave=JSON.stringify([tipo,em,autoria])
    if(!vistos.has(chave)){sinais.push({tipo,em,autoria});vistos.add(chave)}
  }
  return {v:1,sinais,ultimaEntradaEm,ultimaSaidaEm,restricao,conteudoPendente}
}
