import type { CrmLead } from './types'
import { contatoPausado } from './aprendizado-comercial'
import { cicloDoLead } from './ciclo-comercial'
import { textoDeMensagemAutomatica } from './mensagem-automatica'

/** Fonte: Prumo/00-contexto/produtos.md, CRM de estamparia. Sem condições comerciais aprovadas. */
export const VERSAO_ATENDIMENTO_ESTAMPARIA = 'estamparia-respostas-v1'
export const PERGUNTAS_ESTAMPARIA = {
  rotina: 'Hoje vocês organizam os pedidos pelo WhatsApp, em planilha ou já usam algum sistema?',
  gargalo: 'Em que parte vocês mais perdem informação: arte, tamanhos, aprovação ou prazo?',
  equipe: 'Quantas pessoas precisam acompanhar os pedidos e repassar as informações para a produção?',
  decisor: 'Além de você, quem participa da decisão sobre a organização dos pedidos?',
} as const
export const CATALOGO_ATENDIMENTO_ESTAMPARIA = {
  versao: VERSAO_ATENDIMENTO_ESTAMPARIA,
  perguntas: PERGUNTAS_ESTAMPARIA,
  funcionamento: 'A proposta é reunir conversas, clientes e pedidos em uma caixa de entrada, com uma ficha de pedido para a produção. A adaptação e a conexão do WhatsApp precisam ser conferidas para cada operação.',
  assistente: 'A proposta inclui um assistente para coletar informações do pedido e encaminhar para uma pessoa. A conexão no WhatsApp principal depende da homologação para cada operação.',
  'preco-handoff': 'As condições desta oferta precisam ser confirmadas pelo Rômulo. Vou encaminhar sua pergunta a ele.',
  'recurso-handoff': 'Vou conferir essa função específica com o Rômulo para te responder com o escopo certo.',
  'demo-handoff': 'Vou encaminhar seu pedido de demonstração para o Rômulo conferir o material adequado para sua operação.',
  'conversa-handoff': 'Vou encaminhar seu pedido de conversa para o Rômulo combinar o próximo passo com você.',
  'contratacao-handoff': 'Vou encaminhar para o Rômulo confirmar o escopo e as condições desta oferta com você.',
  'descoberta-handoff': 'Obrigado pelas informações. Vou encaminhar esse fluxo para o Rômulo conferir a adaptação e combinar o próximo passo com você.',
} as const
export interface PoliticaAtendimentoEstamparia { v:1; modo:'pausado'|'respostas'; desde:string; catalogoHash:string; retomada?:{autorizadaEm:string;chaves:string[]} }
export interface ResumoAtendimentoEstamparia { modo:'respostas'|'pausado'|'indisponivel'|'aguarda-ativacao';desde:string|null;responsavel:string;enviadas:number;incertas:number;retomada?:{autorizadaEm:string;entradas:number} }
export interface MensagemEstamparia { id:string; em:string; hash:string; direcao:'entrada'|'saida'; texto:string }
export type DecisaoAtendimentoEstamparia =
  | {acao:'ignorar'|'aguardar'|'humano'; motivo:string; restricao?:'recusa'}
  | {acao:'responder'; motivo:string; modelo:string; texto:string; depois:'cliente'|'humano'; proximo:string}
export interface ContextoAtendimentoEstamparia {
  politica:PoliticaAtendimentoEstamparia; catalogoHash:string; agora:number; ocorridoEm:string
  texto:string; identidade:string; fonteAtual:boolean; respondida:boolean; papel?:string
  lead:CrmLead; historico:readonly MensagemEstamparia[]; bloqueio:string|null; entradaChave?:string; historicoJaRespondido?:boolean
}
/** A retomada vale para entradas existentes explicitamente incluídas, sem retroagir a ativação. */
export function entradaEstampariaAutorizada(p:PoliticaAtendimentoEstamparia,em:string,agora:number,chave?:string):boolean {
  const instante=Date.parse(em)
  return Number.isFinite(instante)&&instante<=agora&&(instante>=Date.parse(p.desde)
    ||!!chave&&!!p.retomada&&Date.parse(p.retomada.autorizadaEm)<=agora&&p.retomada.chaves.includes(chave))
}
const normalizar=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim()
const simples=(s:string)=>/^(?:ok|certo|entendi|obrigad[oa]|valeu|beleza|combinado|tudo bem|legal|show|top|otimo|perfeito)[!.,\s]*$/.test(s)
const recusa=(s:string)=>/\b(?:nao (?:tenho|temos) interesse|nao (?:estou|estamos|estao) interessad[oa]s?|sem interesse|nao (?:quero|queremos|preciso|precisamos|autorizo) (?:receber|conversar|contratar|continuar|ver|testar|material|demo|video)|pare de|nao (?:me |nos )?(?:mande|envie)|exclua|apague meu|retire meu|remova meu|nao entre em contato)\b/.test(s)
export function mensagemAutomaticaEstamparia(lead:CrmLead,texto:string,em:string,papel?:string):boolean {
  return lead.resposta?.tipo==='bot'&&Date.parse(lead.resposta.em)===Date.parse(em)
    ||textoDeMensagemAutomatica(texto,papel)
}

export function proximaPerguntaEstamparia(ms:readonly MensagemEstamparia[]): keyof typeof PERGUNTAS_ESTAMPARIA | null {
  const respondidas=new Set<string>()
  for(let i=0;i<ms.length;i++) {
    const m=ms[i], anterior=ms[i-1]
    if(m.direcao!=='entrada'||textoDeMensagemAutomatica(m.texto))continue
    const s=normalizar(m.texto)
    if(simples(s)||s.length<3||!/[\p{L}\p{N}]/u.test(s)||/^(?:sim|nao|pode|talvez|nao sei)[!.,\s]*$/.test(s)||s.includes('?'))continue
    if(anterior?.direcao==='saida')for(const [id,pergunta] of Object.entries(PERGUNTAS_ESTAMPARIA))
      if(anterior.texto.trim().endsWith(pergunta))respondidas.add(id)
    if(/\b(?:usamos|utilizamos|anotamos|controlamos|organizamos|recebemos|fica tudo|tudo (?:pelo|no)|so (?:pelo|no))\b.{0,90}\b(?:whats|planilha|caderno|sistema|papel|excel|conversa)/.test(s))respondidas.add('rotina')
    if(/\b(?:perdemos|perde|atraso|atrasamos|esquecemos|mistura|desorganiza|retrabalho)\b/.test(s))respondidas.add('gargalo')
    if(/\b(?:sou (?:o dono|a dona|responsavel)|eu (?:mesm[oa]|decido|aprovo)|meu soci[oa]|minha soci[oa])\b/.test(s))respondidas.add('decisor')
  }
  return (Object.keys(PERGUNTAS_ESTAMPARIA) as Array<keyof typeof PERGUNTAS_ESTAMPARIA>).find(id=>!respondidas.has(id)) ?? null
}
export function motivoDoEncaminhamentoEstamparia(modelo:string):string|null {
  if(modelo==='estampa-preco-handoff')return 'Rômulo precisa confirmar as condições comerciais de Estamparia antes de informar valor.'
  if(modelo==='estampa-recurso-handoff')return 'Rômulo precisa conferir a função ou integração pedida antes de confirmar o escopo.'
  if(modelo==='estampa-demo-handoff')return 'Rômulo precisa conferir e preparar o material específico da demonstração solicitada.'
  if(modelo==='estampa-conversa-handoff')return 'Rômulo precisa combinar o horário e a forma da conversa solicitada.'
  if(modelo==='estampa-contratacao-handoff')return 'Rômulo precisa confirmar escopo e condições antes da contratação.'
  if(modelo==='estampa-descoberta-handoff')return 'Rômulo precisa conferir o fluxo observado e definir o próximo compromisso; a conversa não confirma qualificação ou venda.'
  return null
}
export function decidirAtendimentoEstamparia(c:ContextoAtendimentoEstamparia):DecisaoAtendimentoEstamparia {
  const {politica:p,lead,agora}=c, instante=Date.parse(c.ocorridoEm)
  if(p.modo!=='respostas'||lead.produto!=='estampa'||!entradaEstampariaAutorizada(p,c.ocorridoEm,agora,c.entradaChave))
    return {acao:'ignorar',motivo:'Fora da oferta ou da janela de atendimento autorizada.'}
  if(p.catalogoHash!==c.catalogoHash)return {acao:'humano',motivo:'O catálogo de atendimento mudou; conferir a política antes de responder.'}
  const s=normalizar(c.texto)
  if(lead.etapa==='ganho'||lead.etapa==='perdido'||contatoPausado(lead)||recusa(s)||['negativa','exclusao'].includes(lead.resposta?.tipo ?? ''))
    return {acao:'aguardar',motivo:'Preservar o desfecho, a pausa ou a recusa; aguardar uma revisão humana.',restricao:'recusa'}
  if(c.historico.some(m=>m.direcao==='entrada'&&recusa(normalizar(m.texto))))return {acao:'aguardar',motivo:'Há recusa observada no histórico conferido. Não enviar novas mensagens; uma eventual retomada precisa de revisão com Rômulo.',restricao:'recusa'}
  if(c.bloqueio)return {acao:'humano',motivo:c.bloqueio}
  // Conserva tanto a projeção instalada (historico) quanto a projeção da UI (eventos).
  const ciclo=cicloDoLead(lead,agora) as unknown as {historico?:unknown[];eventos?:unknown[];problemas?:unknown[]}
  if(ciclo.historico?.length||ciclo.eventos?.length||ciclo.problemas?.length)return {acao:'humano',motivo:'Conferir o trabalho ou compromisso comercial já registrado antes de continuar automaticamente.'}
  if(lead.proposta||lead.etapa==='proposta'||lead.proximoPasso?.texto.trim())return {acao:'humano',motivo:'Preservar a proposta ou o próximo passo já combinado; conferir com Rômulo.'}
  if(c.historicoJaRespondido&&c.identidade==='sem-prova'&&!!c.entradaChave&&p.retomada?.chaves.includes(c.entradaChave))return {acao:'aguardar',motivo:'O histórico já registra uma resposta enviada. Aguardar o cliente; Carla confere a nova mensagem antes de continuar.'}
  if(c.identidade!=='confirmada')return {acao:'humano',motivo:'Conferir a identidade original da conversa antes de responder.'}
  if(mensagemAutomaticaEstamparia(lead,c.texto,c.ocorridoEm,c.papel))
    return {acao:'aguardar',motivo:'Aguardar uma pessoa; a mensagem automática não confirma acesso ao responsável.'}
  if(c.respondida)return {acao:'aguardar',motivo:'A última resposta do cliente já foi atendida. Aguardar novo retorno; Carla continua a conversa quando ele chegar.'}
  if(!c.fonteAtual)return {acao:'aguardar',motivo:'Aguardar a captura e o retrato atualizados antes de responder.'}
  if(!s||s.length>2000||/\[(?:audio|imagem|video|documento)(?:\s|\])/.test(s)||/\b(?:ignore (?:as |suas )?instrucoes|system prompt|api.?key|senha|token de acesso)\b/.test(s))
    return {acao:'humano',motivo:'Conferir o conteúdo original da entrada antes de escolher uma resposta.'}
  if(agora-instante<12_000)return {acao:'aguardar',motivo:'Agrupar as mensagens recentes deste cliente antes de responder.'}
  if(simples(s))return {acao:'aguardar',motivo:'Cliente confirmou o recebimento; aguardar uma nova pergunta ou compromisso.'}
  const indicouContato=/\b(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]\d{4}\b/.test(s)
    &&(/\b(?:terreo|piso|loja \d)\b/.test(s)||c.historico.some(m=>m.direcao==='entrada'&&/\bshopping\b/.test(normalizar(m.texto))))
  if(indicouContato)return {acao:'humano',motivo:'O retorno indica um contato para a estamparia. Rômulo precisa confirmar o contato direto antes de iniciar outra conversa; nenhum novo número foi contatado.'}
  const responder=(modelo:string,texto:string,depois:'cliente'|'humano'='cliente'):DecisaoAtendimentoEstamparia=>({acao:'responder',modelo:`estampa-${modelo}`,texto,motivo:'Dar continuidade ao pedido observado nesta conversa.',depois,
    proximo:depois==='humano'?motivoDoEncaminhamentoEstamparia(`estampa-${modelo}`)!:'Aguardar a resposta do cliente à mensagem enviada.'})
  const encaminhar=(id:'preco-handoff'|'recurso-handoff'|'demo-handoff'|'conversa-handoff'|'contratacao-handoff'|'descoberta-handoff')=>responder(id,CATALOGO_ATENDIMENTO_ESTAMPARIA[id],'humano')
  if(/\b(?:precos?|valor(?:es)?|custa|quanto (?:e|fica)|mensalidades?|desconto|parcel\w*|paguei|pagamento|pix|boleto|dinheiro|cobranca|estorno)\b|r\$/.test(s))return encaminhar('preco-handoff')
  if(/\b(?:contratar|contrato|proposta|comprar|fechar negocio|quero fechar|aceito)\b/.test(s))return encaminhar('contratacao-handoff')
  // Links e assinaturas não são pedidos de integração. Exige uma pergunta ou solicitação no texto.
  const pedidoDeRecurso=s.replace(/\b(?:https?:\/\/|www\.)\S+|\binstagram\.com(?:\/\S*)?/g,'')
  if(/\b(?:nota fiscal|notas fiscais|nf.?e|fiscal|financeiro|instagram|erp|integr\w*|prazo de entrega|fica pronto|personalizar|customizar)\b/.test(pedidoDeRecurso)
    &&(/\?/.test(pedidoDeRecurso)||/\b(?:quero|queremos|preciso|precisamos|gostaria|gostariamos|pode|podem|consegue|conseguem|da para|e possivel|emite|emitem|tem|possui|integra|integrar|conecta|conectar|personaliza|personalizar|customiza|customizar)\b/.test(pedidoDeRecurso)))return encaminhar('recurso-handoff')
  if(/\b(?:demo|demonstracao|video|material|apresentacao|ver funcionando|quero ver|mostrar|teste gratuito|testar)\b/.test(s))return encaminhar('demo-handoff')
  if(/\b(?:agendar|conversar por|reuniao|ligar|ligacao|amanha|hoje as|horario|bate papo|bate-papo)\b/.test(s))return encaminhar('conversa-handoff')
  const pergunta=proximaPerguntaEstamparia(c.historico)
  const proxima=pergunta?PERGUNTAS_ESTAMPARIA[pergunta]:null
  if(/\b(?:como funciona|o que (?:e|faz|inclui)|como (?:ajuda|voces)|explic\w*|sobre (?:o )?(?:sistema|crm)|qual (?:o )?sistema)\b/.test(s))
    return proxima?responder(`funcionamento+${pergunta}`,`${CATALOGO_ATENDIMENTO_ESTAMPARIA.funcionamento}\n\n${proxima}`):encaminhar('descoberta-handoff')
  if(/\b(?:assistente|inteligencia artificial|agente|robo|bot|ia)\b/.test(s))
    return proxima?responder(`assistente+${pergunta}`,`${CATALOGO_ATENDIMENTO_ESTAMPARIA.assistente}\n\n${proxima}`):encaminhar('descoberta-handoff')
  const acesso=/^(?:ola|oi|bom dia|boa tarde|boa noite)[!.,\s]*$|\b(?:pode falar|podemos conversar|sou (?:eu|o responsavel|a responsavel)|consigo falar|tenho interesse|estou interessado|quero saber)\b/.test(s)
  const anterior=c.historico.filter(m=>m.direcao==='saida').at(-1)?.texto ?? ''
  const confirmouAcesso=/^(?:sim|claro|pode|sou eu)[!.,\s]*$/.test(s)&&/\b(?:responsavel|(?:consigo|posso|podemos).{0,25}falar)\b/.test(normalizar(anterior))
  const permitiuMaterial=/^(?:sim|claro|pode|pode (?:mandar|enviar)|manda|mande)[!.,\s]*$/.test(s)&&/\b(?:video|demo|demonstracao|material|apresentacao)\b/.test(normalizar(anterior))
  if(permitiuMaterial)return encaminhar('demo-handoff')
  const emDescoberta=Object.values(PERGUNTAS_ESTAMPARIA).some(q=>anterior.trim().endsWith(q))
  const informouRotina=/\b(?:usamos|utilizamos|anotamos|controlamos|organizamos|recebemos|fica tudo|tudo pelo|perdemos|retrabalho|somos|sou (?:o dono|a dona))\b/.test(s)
  if(acesso||confirmouAcesso||emDescoberta||informouRotina) {
    if(!proxima)return encaminhar('descoberta-handoff')
    if(emDescoberta&&anterior.trim().endsWith(proxima))return {acao:'humano',motivo:'A resposta não esclareceu a pergunta anterior; conferir o contexto com Rômulo.'}
    return responder(pergunta!,`${(acesso||confirmouAcesso) && pergunta==='rotina'?'Sou a Carla, assistente virtual da Prumo. ':''}${proxima}`)
  }
  return {acao:'humano',motivo:'Conferir a pergunta específica com Rômulo; ela não está coberta pelo atendimento autorizado de Estamparia.'}
}
