/** Política executável de atendimento. Sem I/O, geração livre ou confirmação de fatos humanos. */
import { CARDAPIO, normalizar, precosNoTexto } from './colinha.ts'
import { textoDeMensagemAutomatica } from './mensagem-automatica.ts'
import { contatoPausado } from './aprendizado-comercial.ts'
import { cicloDoLead } from './ciclo-comercial.ts'
import { qualificacaoComercialAtual, temQualificacaoComercial } from './qualificacao-comercial.ts'
import { projetarResponsavelConversa } from './responsavel-conversa.ts'
import type { CrmLead } from './types.ts'
import { PERGUNTAS_ENCONTRADO, type QualificacaoEncontrado } from './encontrado-qualificacao.ts'
import {textoSemCadastroEncontrado} from './encontrado-proposta.ts'

export const VERSAO_POLITICA_ENCONTRADO = 'encontrado-respostas-v1'
const oferta = CARDAPIO.find(s => s.id === 'encontrado')!
export const CATALOGO_ENCONTRADO = Object.freeze({
  versao: VERSAO_POLITICA_ENCONTRADO, oferta: 'encontrado', preco: oferta.preco, mensal: oferta.mensal!,
  condicao: oferta.condicao!,
  escopo: 'Site com endereço da empresa e botão de WhatsApp, revisão do perfil Google no escopo acordado, domínio, hospedagem e um ajuste por mês.',
  exclusoes: 'Loja virtual, sistema, aplicativo, integração customizada e anúncios exigem outro escopo. Não há garantia de posição no Google ou de quantidade de clientes.',
  prazo: 'O prazo é combinado depois de conferir conteúdo, imagens, domínio e aprovações; não há prazo geral prometido.',
})
export interface PoliticaEncontrado {
  v: 1; modo: 'pausado' | 'respostas'; desde: string; catalogoHash: string
  qualificacao?: {v:1;desde:string;politicaHash:string}
  proposta?: {v:1;desde:string;politicaHash:string;modeloHash:string}
}
export type DecisaoEncontrado =
  | { acao: 'responder'; motivo: string; modelo: string; texto: string }
  | { acao: 'preparar'; motivo:string; materiais:QualificacaoEncontrado['materiais'] }
  | { acao:'emitir-proposta';motivo:string;propostaId:string }
  | { acao: 'humano' | 'aguardar' | 'ignorar' | 'qualificar' | 'propor'; motivo: string }
export interface ContextoPoliticaEncontrado {
  politica: PoliticaEncontrado; catalogoHash: string; agora: number; ocorridoEm: string
  texto: string; identidade: string; papel?: string; fonteAtual: boolean
  respondida?: boolean
  observada?:QualificacaoEncontrado|null
  propostaSolicitada?:boolean
  lead: CrmLead; leads: readonly CrmLead[]; bloqueio: string | null
  /** Conversa original verificada; não um resumo produzido pelo modelo. */
  historico: readonly { direcao: string; texto: string; em: string }[]
}
const instante = (s?: string) => Date.parse(s ?? '') || 0
export function decidirEncontrado(c: ContextoPoliticaEncontrado): DecisaoEncontrado {
  const { politica:p, lead:l, agora } = c, entrada = instante(c.ocorridoEm)
  const humano = (motivo:string):DecisaoEncontrado => ({acao:'humano',motivo})
  const aguardar = (motivo:string):DecisaoEncontrado => ({acao:'aguardar',motivo})
  if (p.modo !== 'respostas' || l.produto !== 'site' || !entrada || entrada < instante(p.desde))
    return {acao:'ignorar',motivo:'Fora da autorização desta oferta ou anterior à ativação.'}
  if (p.catalogoHash !== c.catalogoHash) return humano('O catálogo mudou; revisar a versão da política antes de usar novas condições.')
  if (entrada > agora) return humano('A data original da entrada exige conferência.')
  if (c.identidade !== 'confirmada') return humano('Resolver identidade da conta e da conversa antes de qualquer resposta.')
  if (['ganho','perdido'].includes(l.etapa) || ['negativa','exclusao'].includes(l.resposta?.tipo ?? '') || contatoPausado(l))
    return aguardar('Preservar encerramento, recusa ou pausa da conversa.')
  if (l.revisaoComercial) return humano(l.revisaoComercial)
  const dono = projetarResponsavelConversa(l,c.leads,agora)
  if (c.bloqueio || dono.estado === 'bloqueado' || dono.registro?.responsavel === 'romulo')
    return humano(c.bloqueio ?? dono.motivo)
  if (c.leads.filter(o=>o.links.whatsapp===l.links.whatsapp).length !== 1)
    return humano('Escolher a oportunidade entre as ofertas da mesma conversa.')
  if (l.proximoPasso?.texto) return humano('Preservar o próximo compromisso já registrado; conferir a ação específica.')
  const q = qualificacaoComercialAtual(l,agora)
  if (temQualificacaoComercial(l,agora) && (!q || q.intencao === 'sem-interesse' || q.adequacao.estado === 'inadequada'))
    return humano('A qualificação exige conferência ou restringe a oferta.')
  const ciclo = cicloDoLead(l,agora)
  if (l.proposta || l.etapa === 'proposta' || ciclo.historico.length || ciclo.problemas.length)
    return humano('Há proposta ou contratação em andamento; preservar a versão e as condições individuais.')
  if (c.respondida) return aguardar('Aguardar o cliente após a resposta observada, sem nova cobrança ou pergunta.')
  if (!c.fonteAtual) return agora-entrada>5*60000
    ?humano('A atualização do contexto não se confirmou; resolver a captura/projeção antes de responder.')
    :aguardar('Aguardar o contexto atualizado antes de responder.')
  if (agora - entrada > 24*3600_000) return humano('A entrada excede a janela de atendimento automático; conferir o contexto atual.')
  if(textoDeMensagemAutomatica(c.texto,c.papel))return aguardar('Aguardar uma pessoa; saudação automática não confirma interesse nem autoriza qualificação.')
  if(l.classificacaoResposta?.revisar)return humano('A classificação requer conferência; preservar a restrição ou identidade antes de continuar.')
  if (c.papel === 'recepcao' || /^\s*\[(?:áudio|audio|imagem|vídeo|video|documento)\b/i.test(c.texto))
    return humano('Conferir interlocutor ou interpretar o conteúdo antes de responder.')
  const s = normalizar(c.texto).trim()
  if (!s || /(?:nao (?:tenho interesse|quero|preciso)|pare de|nao me (?:mande|envie)|remova|exclua|apague)|^(?:nao|dispenso|sem interesse)(?:[,! .]*obrigad[oa])?[!.,\s]*$|\b(?:mais tarde|depois eu|agora nao)\b/.test(s))
    return aguardar('Preservar o pedido de não continuar o contato.')
  // O catálogo não substitui preço/condição individual já oferecidos, mesmo em notas livres.
  const anteriores = [...c.historico.filter(m=>instante(m.em)<entrada).map(m=>m.texto),
    ...l.eventos.filter(e=>e.origem==='manual').map(e=>e.registroTexto??e.texto??'')]
  if (anteriores.some(t=>precosNoTexto(t).some(v=>![oferta.preco,oferta.mensal!.replace('/mês','')].includes(v))
    || /(?:sem (?:custo|mensalidade)|site (?:gratis|gratuito)|site de graca|desconto|condicao especial|pacote|gestao de trafego)/.test(normalizar(t))))
    return humano('Há condição individual ou pacote no histórico; conferir antes de apresentar o padrão.')
  if(p.proposta&&entrada>=instante(p.proposta.desde)&&c.propostaSolicitada){
    const especial=normalizar(textoSemCadastroEncontrado(c.texto))
    if(/(?:desconto|negoci|parcel|barat|caro|paguei|pagamos|comprovante|pix|boleto|cartao|reembols|cancel|reclam|romulo|humano|pessoa de verdade|urgente|amanha|hoje|loja virtual|ecommerce|sistema|aplicativo|integrac|trafego|anunci|google ads|multa|rescis|juridic|clausula|sem mensalidade|sem custo)/.test(especial)
      ||precosNoTexto(c.texto).some(v=>![oferta.preco,oferta.mensal!.replace('/mês','')].includes(v)))return humano('O pedido altera condições, escopo ou exige uma decisão fora da proposta padrão.')
    return {acao:'propor',motivo:'Conduzir o pedido comprovado de proposta padrão, sem confirmar aceite por texto.'}
  }
  if (/(?:desconto|negoci|parcel|barat|caro|contrat|proposta|aceit|assin|paguei|pagamos|comprovante|pix|boleto|cartao|reembols|cancel|reclam|romulo|humano|pessoa de verdade|urgente|amanha|hoje|loja virtual|ecommerce|sistema|aplicativo|integrac|trafego|anunci|google ads)/.test(s))
    return humano('Pedido exige condição, compromisso ou etapa comercial ainda fora da resposta padrão.')
  if (/r\$|\breais\b|\d+\s*paginas|\b(?:blog|portal|login|estoque|agendamento|multilingue|idiomas)\b/.test(s))
    return humano('Conferir valor ou escopo individual solicitado; não substituir pelo pacote padrão.')
  const lote2=!!p.qualificacao&&entrada>=instante(p.qualificacao.desde)
  if(lote2&&c.observada===null)return {acao:'qualificar',motivo:'O time está conferindo as respostas e os materiais pedidos na conversa original.'}
  if(lote2&&c.observada?.materiais.length)return {acao:'preparar',materiais:c.observada.materiais,motivo:'Preparar o material especificamente solicitado; não exigir completar o questionário antes.'}
  const partes:string[] = [], modelos:string[] = []
  if (/(?:quanto|qual|como).*(?:cust|valor|prec|mensal|paga)|(?:prec|valor|mensalidade|custo)(?:\b|\?)/.test(s)) {
    modelos.push('preco')
    partes.push(`O Encontrado custa ${oferta.preco} de implantação + ${oferta.mensal}. Você só paga depois de ver o site funcionando no ar.`)
  }
  if (/(?:inclu|funciona|oferece|servico|o que (?:faz|e)|hosped|dominio|manutenc|ajuste)/.test(s)) {
    modelos.push('escopo'); partes.push(CATALOGO_ENCONTRADO.escopo)
  }
  if (/(?:prazo|demora|quanto tempo|dias|quando fica)/.test(s)) {
    modelos.push('prazo'); partes.push(CATALOGO_ENCONTRADO.prazo)
  }
  if (!partes.length && /^(?:oi|ola|bom dia|boa tarde|boa noite)[!.,\s]*$/.test(s)) {
    modelos.push('abertura'); partes.push('Olá! Posso te ajudar com o Encontrado, o site da Prumo para sua empresa. O que você gostaria de saber?')
  }
  if (!partes.length && /^(?:ok|certo|entendi|obrigad[oa]|valeu|beleza)[!.,\s]*$/.test(s))
    return aguardar('Confirmação simples recebida; aguardar uma nova pergunta, sem insistir.')
  if (!partes.length&&lote2&&c.observada){
    const q=c.observada
    if(q.intencao?.tipo==='pesquisando')return aguardar('O cliente está pesquisando; não insistir nem presumir compra.')
    const campo=!q.necessidade?'necessidade':!q.intencao?'intencao':!q.decisao?'decisao':'material'
    const jaPerguntou=(texto:string)=>c.historico.some(m=>m.direcao==='saida'&&m.texto===texto)
    const escolhido=jaPerguntou(PERGUNTAS_ENCONTRADO[campo])?'esclarecer':campo
    if(jaPerguntou(PERGUNTAS_ENCONTRADO[escolhido]))return humano('A resposta permanece ambígua após esclarecimento; interpretar o pedido e decidir como continuar.')
    return {acao:'responder',modelo:'qualificar-'+escolhido,texto:PERGUNTAS_ENCONTRADO[escolhido],motivo:'Perguntar somente a próxima lacuna observada, sem confirmar qualificação humana.'}
  }
  if (!partes.length) return humano('O pedido precisa de interpretação fora das respostas padrão deste lote.')
  return {acao:'responder',modelo:modelos.join('+'),texto:partes.join('\n\n'),motivo:'Dúvida padrão atendida pela política aprovada do Encontrado.'}
}
