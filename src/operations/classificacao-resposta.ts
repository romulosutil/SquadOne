/** Leitura contextual, sem I/O: nunca grava, envia ou altera o desfecho comercial. */
import type { CrmLead, CrmResposta } from './types'
import { textoDeMensagemAutomatica } from './mensagem-automatica'

export const VERSAO_CLASSIFICACAO_RESPOSTA = 'respostas-2026-11-06-contexto' as const
export type ClasseDaResposta = 'interesse' | 'conversa' | 'permissao' | 'acesso' | 'curiosidade' | 'robo' | 'silencio' | 'neutra' | 'recusa' | 'exclusao' | 'pendente' | 'nao-contatado'
export const ROTULOS_DA_CLASSIFICACAO: Record<ClasseDaResposta, string> = {
  interesse: 'Interesse comercial explícito', conversa: 'Pedido de conversa · horário não confirmado', permissao: 'Permissão para material', acesso: 'Acesso ou encaminhamento',
  curiosidade: 'Curiosidade, sem intenção de compra confirmada', robo: 'Resposta automática', silencio: 'Sem resposta registrada',
  neutra: 'Resposta sem interesse explícito', recusa: 'Recusa', exclusao: 'Pedido de exclusão',
  pendente: 'Contexto insuficiente · revisar', 'nao-contatado': 'Sem envio registrado',
}
export interface ClassificacaoDaResposta {
  versao: typeof VERSAO_CLASSIFICACAO_RESPOSTA | 'respostas-2026-11-06-avisos' | 'respostas-2026-10-27-adversarial' | 'respostas-2026-10-22' | 'respostas-2026-10-23' | 'respostas-2026-10-27'
  classe: ClasseDaResposta
  motivo: string
  evidencia?: { trecho: string; em?: string; perguntaAnterior?: string }
  /** Interesse anterior comprovado; a classe continua descrevendo a resposta atual. */
  interesseHistorico?: { trecho: string; em?: string }
  /** Indicação humana da fonte ou papel explícito; ausência de papel não é prova de humanidade. */
  houveRespostaHumana: boolean
  materialSolicitado: boolean
  revisar: boolean
  leituraConfirmada: boolean
}
type Mensagem = { direcao: 'entrada' | 'saida'; em: string; texto?: string; trecho?: string; papel?: string }
type Entrada = Pick<CrmLead, 'marcos'> & Partial<Pick<CrmLead, 'resposta' | 'respostaFonte' | 'conversa' | 'leitura'>>
const normalizar = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const textoDe = (m: Mensagem) => m.texto ?? m.trecho ?? ''
const normalizarResposta=(t:string)=>normalizar(t).replace(/^(?:\*\[[^\]]+\]\*|\*[\p{L}][^*\n]{0,100}\*:?)\s*/u,'')
const ultimoQue = <T>(xs: readonly T[], f: (x: T) => boolean): T | undefined => [...xs].reverse().find(f)
const automatico = (m: Mensagem) => textoDeMensagemAutomatica(textoDe(m),m.papel)
const afirmacao = /^(?:ola[,.! ]*|bom dia[,.! ]*|boa tarde[,.! ]*)?(?:sim|claro|ok|pode(?: sim)?|pode ser|sou eu|eu mesmo|eu mesma|pode falar(?: por aqui)?(?:,? sim)?|sim,? pode falar|sim,? (?:conversa|fala) com o responsavel)[.! ]*$/
const acesso = /(?:sou|eu sou|sou eu|eu mesmo|eu mesma|sim,? (?:conversa|fala) com)\b.{0,30}\b(?:responsavel|coordenador|coordenadora)|^(?:sou eu|eu mesmo|eu mesma)(?:[,.! ]+pode falar)?[.! ]*$|(?:vou|irei) (?:te )?(?:passar|encaminhar)|contato d[oa] responsavel|pode falar por aqui|segue (?:o )?contato|contato dele|(?:ele|ela) e a pessoa que cuida|(?:enviando|enviar|encaminhar) (?:para|pelo) (?:nosso |o )?e-?mail/
const perguntaDeAcesso = /(?:consigo|posso) falar|(?:quem|o|a) (?:responsavel|coordena|coordenador|decide)|(?:quem|voce) (?:cuida|organiza)|com quem falo/
const perguntaDePermissao = /(?:posso|poderia|podemos|quer que eu)\b.{0,100}\b(?:mandar|enviar|mostrar)|(?:posso|poderia) (?:preparar|montar) uma demonstracao|(?:te|lhe) (?:mando|envio)\b.{0,80}\?/
const permissao = /^(?:claro[,! ]*)?(?:pode(?:m)?(?: sim)?(?: me| nos)? (?:mandar|enviar|mostrar)|manda(?: ai| o link| o video)?|envie(?: o link| o video)?)/
const positivo = /quanto (?:custa|fica)|qual (?:e )?o (?:preco|valor)|(?:quais|como sao) (?:os )?(?:precos|valores)|como (?:isso |ele |o sistema |a plataforma )?funciona|tenho interesse|temos interesse|quero (?:contratar|comprar|implantar)|queremos (?:contratar|comprar|implantar)|precisamos (?:disso|de um sistema|organizar)|me explica(?: melhor)? como/
const pedirMaterial = /(?:manda|envia|mande|envie|mandar|enviar|ver|conhecer)\b.{0,50}\b(?:video|link|demonstracao|material|sistema|plataforma)/
// Negação truncada observada na revisão: somente após mas/mais, sem corrigir a fala original.
const negacaoTruncada = /\b(?:mas|mais)\s+['’]ao\s+(?:tenho|temos)\s+interesse\b/
const recusa = /nao (?:tenho|temos) interesse|nao (?:estou|estamos|estao) interessad[oa]s?\b|nao (?:quero|queremos|preciso|precisamos)|nao[, ]+obrigad|sem interesse|nao (?:me )?(?:mande|envie|contate)|nao (?:precisa|precisam) (?:me |nos )?(?:mandar|enviar|mostrar) (?:mais )?nada\b|pare de|vou deixar(?: amigo)?|nao autorizo/
// Só pedidos diretos sobre contato/dados. Não infere exclusão de uma pergunta ou de "não apague".
const exclusaoExplicita = /(?:^|[.!?;]\s*|\b(?:por favor|por gentileza)[,.]?\s+)(?:apague|exclua|remova|retire)\s+(?:(?:o|esse|este|meu|nosso)\s+)*(?:numero|telefone|contato|dados)\b|^(?:por favor[,.]?\s+)?me (?:tire|retire|remova) (?:da|dessa|desta) lista\b/
const cortesia = /^(?:de nada+|por nada|obrigad[oa]+|valeu|ok|certo|tudo bem|bom dia|boa tarde|boa noite|ola|oi)[!.,\s]*$/
const numeroErrado=/\b(?:numero (?:esta |e )?errado|alguma coisa errada no numero|nao tenho nada a ver com)\b/
const fornecedorAtual = /ja (?:tenho|temos) (?:site|agencia|um sistema|sistema)/
const troca = /(?:quero|queremos|preciso|precisamos|pretendo|pretendemos|gostaria de|gostariamos de|estou pensando em|estamos pensando em)\b.{0,55}\b(?:trocar|mudar|substituir|outro|outra)|(?:trocar|mudar|substituir)\b.{0,40}\b(?:sistema|fornecedor|agencia|site)/
const sinalComercial = (t: string) => !recusa.test(t) && !negacaoTruncada.test(t) && (positivo.test(t) || troca.test(t))
const timing = /estou (?:no transito|ocupad|apertad)|essa semana estou|vou (?:ver|conversar|avaliar|verificar)|nao (?:decido|resolvo) sozinh/
const pedidoDeConversa = /\b(?:agende|agenda|marque)\b.{0,70}\bcomigo\b.{0,45}\b(?:bate-papo|conversa|reuniao|demonstracao)|\b(?:quero|gostaria de|podemos) (?:agendar|marcar)\b.{0,65}\b(?:conversa|reuniao|bate-papo|demonstracao)/

/** Classifica só evidência recebida, usando a pergunta anterior e preservando o rótulo original. */
export function classificarResposta(lead: Entrada, mensagens?: readonly Mensagem[], agora = Infinity): ClassificacaoDaResposta {
  const fonte = lead.respostaFonte ?? lead.resposta
  const enviado = Date.parse(lead.marcos.enviado ?? '')
  const inicio = Number.isFinite(enviado) ? enviado : -Infinity
  const resumo = lead.conversa
  const ctx = [...(mensagens ?? resumo?.recentes ?? (resumo?.ultima ? [resumo.ultima] : []))]
    .filter(m => Number.isFinite(Date.parse(m.em)) && Date.parse(m.em) <= agora)
    .sort((a,b) => Date.parse(a.em) - Date.parse(b.em))
  const entradas = ctx.filter(m => m.direcao === 'entrada' && Date.parse(m.em) >= inicio)
  const emFonte = Date.parse(fonte?.em ?? lead.marcos.respondeu ?? '')
  const dataHumanaValida = Number.isFinite(emFonte) && emFonte >= inicio && emFonte <= agora
  const indicacaoHumana = fonte ? fonte.tipo !== 'bot' && (!fonte.em || dataHumanaValida) : dataHumanaValida
  const papelHumano = entradas.some(m => (m.papel === 'recepcao' || m.papel === 'gente') && !automatico(m))
  const ultima = entradas.at(-1)
  const marcada = ultimoQue(entradas, m => Number.isFinite(emFonte) && Math.abs(Date.parse(m.em)-emFonte) < 2000)
    ?? ultimoQue(entradas, m => Boolean(fonte?.trecho && normalizar(textoDe(m)).includes(normalizar(fonte.trecho))))
  const fonteHumana = indicacaoHumana && !(marcada && automatico(marcada))
  // Saudação automática posterior não apaga uma resposta humana anterior.
  let candidata = fonteHumana && ultima && automatico(ultima) ? marcada : ultima ?? marcada
  // Um agradecimento posterior não desfaz a recusa explícita do cliente.
  const recusou = ultimoQue(entradas,m=>!automatico(m)&&(recusa.test(normalizarResposta(textoDe(m)))||exclusaoExplicita.test(normalizarResposta(textoDe(m)))))
  if(candidata&&recusou&&Date.parse(recusou.em)<Date.parse(candidata.em)&&cortesia.test(normalizarResposta(textoDe(candidata))))candidata=recusou
  const encaminhou=ultimoQue(entradas,m=>!automatico(m)&&acesso.test(normalizarResposta(textoDe(m))))
  if(candidata&&encaminhou&&Date.parse(encaminhou.em)<Date.parse(candidata.em)&&cortesia.test(normalizarResposta(textoDe(candidata))))candidata=encaminhou
  const divergencia=ultimoQue(entradas,m=>!automatico(m)&&numeroErrado.test(normalizarResposta(textoDe(m))))
  if(divergencia)candidata=divergencia
  // Cartão de contato complementa o encaminhamento no mesmo lote; não substitui a fala.
  if (candidata && /^\[(?:contato|cartao de contato)\]$/.test(normalizar(textoDe(candidata)))) {
    const cartao = candidata
    candidata = ultimoQue(entradas, m => m !== cartao && Date.parse(m.em) <= Date.parse(cartao.em)
      && Date.parse(cartao.em) - Date.parse(m.em) <= 120_000 && acesso.test(normalizar(textoDe(m)))) ?? candidata
  }
  const posteriorAoBot = fonte?.tipo === 'bot' && candidata && Number.isFinite(emFonte) && Date.parse(candidata.em) > emFonte + 2000 && !automatico(candidata)
  const ehRobo = candidata ? automatico(candidata) || (fonte?.tipo === 'bot' && !posteriorAoBot && candidata.papel !== 'recepcao') : fonte?.tipo === 'bot'
  const houveRespostaHumana = fonteHumana || papelHumano
  const trecho = candidata ? textoDe(candidata) : fonte?.trecho ?? ''
  const t = normalizarResposta(trecho)
  const index = candidata ? ctx.indexOf(candidata) : -1
  const pergunta = ultimoQue(index >= 0 ? ctx.slice(0,index) : ctx.filter(m => Date.parse(m.em) <= emFonte), m => m.direcao === 'saida')
  const q = normalizar(pergunta ? textoDe(pergunta) : '')
  const contatoIndicado=/(?:\b(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}\b|\b[^\s@]+@[^\s@]+\.[^\s@]+\b)/.test(t)
    &&(/\b(?:terreo|piso|loja \d|fone|telefone|ramal|contato)\b/.test(t)||perguntaDeAcesso.test(q)||entradas.some(m=>m!==candidata&&/\bshopping\b/.test(normalizar(textoDe(m)))))
  const historica = ultimoQue(entradas, m => m !== candidata && !automatico(m)
    && (m.papel === 'recepcao' || m.papel === 'gente' || fonteHumana)
    && sinalComercial(normalizar(textoDe(m))))
  const interesseHistorico = historica ? { trecho: textoDe(historica).slice(0,280), em: historica.em }
    : fonteHumana && fonte?.trecho && candidata && fonte.em && Date.parse(fonte.em) < Date.parse(candidata.em)
      && sinalComercial(normalizar(fonte.trecho)) ? { trecho: fonte.trecho.slice(0,280), em: fonte.em } : undefined
  const base = { versao: VERSAO_CLASSIFICACAO_RESPOSTA, houveRespostaHumana, leituraConfirmada: Boolean(lead.marcos.visto) || lead.leitura === 'viu',
    ...(interesseHistorico ? { interesseHistorico } : {}),
    ...(trecho ? { evidencia: { trecho: trecho.slice(0,280), ...(candidata?.em || fonte?.em ? { em: candidata?.em ?? fonte?.em } : {}), ...(pergunta ? { perguntaAnterior: textoDe(pergunta).slice(0,280) } : {}) } } : {}) }
  const sair = (classe: ClasseDaResposta, motivo: string, materialSolicitado = false, revisar = false): ClassificacaoDaResposta => ({ ...base, classe, motivo, materialSolicitado, revisar })
  const pediuExcluirMaterial=fonte?.tipo==='negativa'&&/\b(?:se puder|por favor|por gentileza) (?:excluir|apagar|remover) (?:esse |este |o |meu |meus )?(?:conteudo|material|numero|dados|contato)\b/.test(t)
  if (fonte?.tipo === 'exclusao'||pediuExcluirMaterial) return sair('exclusao', 'Há pedido de exclusão de conteúdo ou contato; conferir o escopo com uma pessoa e preservar a restrição e o histórico.')
  if(divergencia)return sair('pendente','O interlocutor informou que o número não pertence ao contato procurado. Conferir a identidade e não abordar outro número automaticamente.',false,true)
  if (ehRobo && !fonteHumana && !papelHumano) return sair('robo', 'Há resposta automática; isso não comprova leitura por uma pessoa.')
  if (!fonte && lead.marcos.respondeu && !dataHumanaValida) return sair('pendente', 'O marco de resposta tem data incompatível com o envio ou a observação; conferir a fonte.', false, true)
  if (!fonte && !entradas.length && !houveRespostaHumana) return Number.isFinite(enviado)
    ? sair('silencio', base.leituraConfirmada ? 'Há recibo de leitura, sem resposta registrada; a intenção é desconhecida.' : 'Sem resposta nem leitura confirmada; não significa que ignorou.')
    : sair('nao-contatado', 'Sem envio registrado; fora do denominador de respostas.')
  if (posteriorAoBot && !papelHumano) return sair('pendente', 'Há entrada posterior ao robô ainda sem classificação confirmada; conferir o encaminhamento ou a resposta.', false, true)
  if (negacaoTruncada.test(t)) return sair('recusa', 'Negação truncada após mas/mais: leitura contextual de provável recusa, sem interesse confirmado. Preservar a fala e revisar a interpretação antes de qualquer retomada.', false, true)
  if (recusa.test(t)) return sair('recusa', 'A fala contém recusa explícita; permissão anterior não confirma interesse atual.')
  if (fornecedorAtual.test(t) && !sinalComercial(t)) return sair('recusa', 'A pessoa informou que já tem uma solução, sem abertura comercial registrada.')
  if (fonte?.tipo === 'negativa' && sinalComercial(t)) return sair('interesse', 'Há intenção comercial explícita apesar da negativa registrada; conferir a divergência sem reabrir a conversa automaticamente.', pedirMaterial.test(t), true)
  if(fonte?.tipo==='negativa'&&!positivo.test(t)&&(acesso.test(t)||contatoIndicado||cortesia.test(t)||/^(?:agradeco|agradecemos|obrigad[oa]) (?:o |pelo |seu )?contato[.!\s]*$/.test(t)))
    return sair('pendente','A fonte registra recusa, mas a evidência é agradecimento ou encaminhamento. Conferir a classificação sem reabrir o contato automaticamente.',false,true)
  if (fonte?.tipo === 'negativa') return timing.test(t)
    ? sair('pendente', 'Há indicação de timing ou avaliação; revisar a negativa sem reabrir o contato automaticamente.', false, true)
    : sair('recusa', 'Recusa registrada na fonte; preservar a restrição de contato.')
  if (!houveRespostaHumana) return sair('pendente', 'Existe entrada sem autoria/classificação suficiente; ausência de papel não comprova humanidade.', false, true)
  if (exclusaoExplicita.test(t)) return sair('exclusao', 'A pessoa pediu explicitamente remover contato ou dados; preservar a restrição e conferir o escopo, sem afirmar exclusão executada.')
  if (/^\[audio(?: \d+s)?\](?:\s*)$|^\[audio nao transcrito\]$/.test(t)) return sair('pendente', 'Áudio sem transcrição: conteúdo desconhecido.', false, true)
  if (sinalComercial(t)) return sair('interesse', 'Há pergunta comercial ou intenção explícita sobre a oferta; ainda não confirma qualificação, aceite ou pagamento.', pedirMaterial.test(t))
  if (pedidoDeConversa.test(t)) return sair('conversa', 'A pessoa pediu uma conversa; conferir retomadas posteriores antes de sugerir horário. Não há reunião aceita nem compra confirmada.')
  if (acesso.test(t) || contatoIndicado || (perguntaDeAcesso.test(q) && afirmacao.test(t))) return sair('acesso', 'A fala confirma identidade, acesso ou encaminhamento; não confirma interesse na oferta.')
  if (fonte?.tipo === 'licenca' || permissao.test(t) || (perguntaDePermissao.test(q) && afirmacao.test(t))) return sair('permissao', 'Autorizou receber o material; isso não confirma necessidade ou intenção de compra.', true)
  if (pedirMaterial.test(t) || /\b(?:gostei|interessante|achei (?:bem )?legal)\b/.test(t)) return sair('curiosidade', 'Há curiosidade ou apreciação; necessidade e intenção comercial não estão confirmadas.', pedirMaterial.test(t))
  if (interesseHistorico && afirmacao.test(t)) return sair('neutra', 'A confirmação atual não apaga o interesse comercial anterior; conservar o próximo passo e as condições registradas.')
  if (fonte?.tipo === 'interesse' && (!t || afirmacao.test(t))) return sair('pendente', 'Rótulo antigo de interesse sem pergunta ou conteúdo suficiente para distinguir acesso de permissão.', false, true)
  return sair('neutra', 'Resposta humana sem sinal comercial explícito; manter o contexto e o combinado.')
}

/** Corrige a leitura operacional; a origem continua preservada e recusa/exclusão nunca são reabertas. */
export function respostaParaAcompanhamento(fonte: CrmResposta | undefined, leitura: ClassificacaoDaResposta): CrmResposta | undefined {
  if (leitura.classe === 'exclusao' && leitura.houveRespostaHumana && leitura.evidencia && exclusaoExplicita.test(normalizarResposta(leitura.evidencia.trecho)) && fonte?.tipo !== 'exclusao') return {
    ...fonte, tipo: 'exclusao', trecho: leitura.evidencia.trecho, em: leitura.evidencia.em ?? fonte?.em,
  }
  if(fonte&&['interesse','licenca','neutra'].includes(fonte.tipo)&&leitura.classe==='recusa')return {...fonte,tipo:'negativa',trecho:leitura.evidencia?.trecho??fonte.trecho,em:leitura.evidencia?.em??fonte.em}
  if(fonte&&['interesse','licenca','neutra'].includes(fonte.tipo)&&leitura.classe==='robo')return {...fonte,tipo:'bot',trecho:''}
  if (!fonte || !['interesse','licenca'].includes(fonte.tipo)) return fonte
  const tipo = leitura.classe === 'interesse' ? 'interesse' : leitura.materialSolicitado ? 'licenca' : 'neutra'
  return tipo === fonte.tipo ? fonte : { ...fonte, tipo }
}

export function resumoDasRespostas(leads: readonly (Entrada & { classificacaoResposta?: ClassificacaoDaResposta })[], agora: number) {
  const enviados = leads.filter(l => Number.isFinite(Date.parse(l.marcos.enviado ?? '')) && Date.parse(l.marcos.enviado!) <= agora)
  const classes = Object.fromEntries(Object.keys(ROTULOS_DA_CLASSIFICACAO).map(k => [k,0])) as Record<ClasseDaResposta,number>
  let leituraSemResposta = 0, semLeituraSemResposta = 0, revisar = 0, humanas = 0
  for (const l of enviados) {
    const c = l.classificacaoResposta ?? classificarResposta(l,undefined,agora)
    classes[c.classe]++; if (c.revisar) revisar++; if (c.houveRespostaHumana) humanas++
    if (c.classe === 'silencio') c.leituraConfirmada ? leituraSemResposta++ : semLeituraSemResposta++
  }
  return { enviados: enviados.length, classes, leituraSemResposta, semLeituraSemResposta, revisar, humanas }
}
