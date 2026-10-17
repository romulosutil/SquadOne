/**
 * PURO: "por que não está vendendo" (16/10/2026). O funil dos últimos 30 dias, de quem recebeu a
 * primeira mensagem até quem fechou, com o degrau que mais perde em destaque e o que fazer nele.
 *
 * As referências são de prospecção a frio por mensagem para pequena empresa, usadas só para dizer
 * qual degrau está mais longe do razoável (não são meta nem promessa): ler 60 %, responder 15 %,
 * dizer "quero ver" em 30 % das respostas, receber o próximo passo em 100 % dos "quero ver" (no
 * mesmo dia), virar proposta em 40 % e fechar em 25 % das propostas.
 *
 * Só conta o que o retrato afirma: lead sem marco de envio não entra; leitura desconhecida não é
 * "não leu" (o recibo pode estar desligado), por isso a leitura não escolhe gargalo.
 */
import { enviadoNosUltimos, leu, quisVer, respondeuDeGente } from './resultados'
import type { CrmLead } from './types'

export interface DegrauDoFunil {
  id: 'enviados' | 'leram' | 'responderam' | 'interesse' | 'segunda' | 'proposta' | 'ganho'
  rotulo: string
  n: number
  /** Do degrau anterior (0..1); ausente no primeiro ou com o anterior em 0. */
  taxa?: number
  referencia?: number
}

export interface Gargalo {
  degrau: DegrauDoFunil['id']
  titulo: string
  texto: string
  acao: string
}

export interface DiagnosticoDeVenda {
  dias: number
  degraus: DegrauDoFunil[]
  gargalo: Gargalo | null
  /** Disseram "quero ver" e o próximo passo não saiu. */
  interessadosParados: number
}

const REFERENCIAS: Partial<Record<DegrauDoFunil['id'], number>> = {
  leram: 0.6, responderam: 0.15, interesse: 0.3, segunda: 1, proposta: 0.4, ganho: 0.25,
}

const TEXTO_DO_GARGALO: Record<Exclude<DegrauDoFunil['id'], 'enviados' | 'leram'>, (d: DegrauDoFunil, antes: DegrauDoFunil) => Omit<Gargalo, 'degrau'>> = {
  responderam: (d, a) => ({
    titulo: 'Pouca gente responde a primeira mensagem',
    texto: `${d.n} de ${a.n} responderam. O texto ou o público não estão puxando conversa.`,
    acao: 'Mande para quem tem WhatsApp no site e nota boa no Google, e termine a primeira mensagem com uma pergunta de sim ou não.',
  }),
  interesse: (d, a) => ({
    titulo: 'Respondem, mas não dizem "quero ver"',
    texto: `${d.n} de ${a.n} respostas viraram interesse. A conversa morre na segunda frase.`,
    acao: 'Responda no mesmo dia, curto, e ofereça uma coisa concreta para ver (o demo ou o Raio-X), não uma reunião.',
  }),
  segunda: (d, a) => ({
    titulo: 'Quem disse "quero ver" ficou esperando',
    texto: `${a.n - d.n} de ${a.n} que disseram sim ainda não receberam a 2ª mensagem. É a venda mais fácil de perder.`,
    acao: 'Mande o link ou o Raio-X no mesmo dia do "sim". A Próxima venda põe esses na frente de tudo.',
  }),
  proposta: (d, a) => ({
    titulo: 'Ninguém chega na proposta',
    texto: `${a.n} receberam a 2ª mensagem (o demo ou o Raio-X) e ${d.n === 0 ? 'nenhuma' : `só ${d.n}`} proposta saiu. O funil quebra depois do "gostei".`,
    acao: 'Depois do link, pergunte o que achou em 24 h e, no primeiro "gostei", mande o preço e o próximo passo com data. Marque a proposta na ficha.',
  }),
  ganho: (d, a) => ({
    titulo: 'Propostas não viram ganho',
    texto: `${d.n} de ${a.n} propostas viraram ganho.`,
    acao: 'Pergunte qual dúvida ficou e ofereça 10 minutos de ligação; dê um prazo real para a condição.',
  }),
}

export function diagnosticoDeVenda(leads: readonly CrmLead[], agora: number, dias = 30): DiagnosticoDeVenda {
  // A janela, "leram", "responderam" e "quero ver" são as mesmas regras do placar de Números
  // (resultados.ts, AC-03): na mesma tela, a barra e o resumo davam 70/41 e 68/42.
  const enviados = leads.filter((l) => enviadoNosUltimos(l, dias, agora))
  const leram = enviados.filter(leu)
  const responderam = enviados.filter(respondeuDeGente)
  // quisVer conta o interesse E a licença (pedeMaterial, 17/10/2026): o "pode mandar" que até então era
  // gravado como interesse não sai do degrau "quero ver" nem do subconjunto "segunda" só por ter tipo novo.
  const interesse = responderam.filter(quisVer)
  const segunda = interesse.filter((l) => Boolean(l.marcos?.segundaEnviada) || l.etapa === 'proposta' || l.etapa === 'ganho' || l.sinal === 'diagnostico')
  const proposta = enviados.filter((l) => l.etapa === 'proposta' || l.etapa === 'ganho' || Boolean(l.proposta))
  const ganho = enviados.filter((l) => l.etapa === 'ganho')

  const crus: Array<[DegrauDoFunil['id'], string, number]> = [
    ['enviados', 'Receberam a 1ª mensagem', enviados.length],
    ['leram', 'Leram (recibo ou resposta)', leram.length],
    ['responderam', 'Responderam (gente, não robô)', responderam.length],
    ['interesse', 'Disseram "quero ver"', interesse.length],
    ['segunda', 'Receberam a 2ª mensagem', segunda.length],
    ['proposta', 'Receberam proposta', proposta.length],
    ['ganho', 'Ganharam', ganho.length],
  ]
  // A taxa de "responderam" é sobre os enviados, não sobre quem leu: a leitura é parcial.
  const base = (id: DegrauDoFunil['id'], i: number) => (id === 'responderam' ? 0 : id === 'proposta' ? 4 : i - 1)
  const degraus: DegrauDoFunil[] = crus.map(([id, rotulo, n], i) => {
    if (i === 0) return { id, rotulo, n }
    const anterior = crus[base(id, i)][2]
    return { id, rotulo, n, ...(anterior > 0 ? { taxa: n / anterior } : {}), ...(REFERENCIAS[id] !== undefined ? { referencia: REFERENCIAS[id] } : {}) }
  })

  // O gargalo: o degrau mais abaixo da referência, com pelo menos 3 na base (menos é sorte).
  let gargalo: Gargalo | null = null
  let pior = 1
  degraus.forEach((d, i) => {
    if (d.id === 'enviados' || d.id === 'leram' || d.taxa === undefined || d.referencia === undefined) return
    const antes = degraus[base(d.id, i)]
    if (antes.n < 3) return
    const razao = d.taxa / d.referencia
    if (razao < pior) {
      pior = razao
      gargalo = { degrau: d.id, ...TEXTO_DO_GARGALO[d.id as keyof typeof TEXTO_DO_GARGALO](d, antes) }
    }
  })

  return {
    dias,
    degraus,
    gargalo,
    interessadosParados: interesse.filter((l) => l.etapa === 'contato' && !l.marcos?.segundaEnviada && l.sinal !== 'diagnostico').length,
  }
}
