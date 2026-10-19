import type { CrmLead } from '../operations/types'
import { agoraDaFicha, type AcaoDeVenda } from '../operations/proxima-venda'

export interface MovimentoDaMissao {
  /** O que fazer, numa frase: o combinado, quando é a vez dele. */
  titulo: string
  /** Por que agora, quando há data: "Combinado para hoje", "Combinado para 18/10 · 1 dia de atraso". */
  quando?: string
  atrasado: boolean
  /** Do primeiro toque ao registro; vazio quando a ação já traz a mensagem pronta. */
  passos: string[]
  /** O "Como" da ação, quando não há passos. */
  como?: string
  /** O combinado é o movimento: "Já resolvi" e "Remarcar" moram no bloco, e a caixa separada some. */
  doCombinado: boolean
  /** O botão de destaque: abrir o WhatsApp, ou "Já resolvi" quando a mensagem já saiu depois do combinado. */
  primario: 'whatsapp' | 'resolvi'
  /** O combinado, quando ele deixou de ser o título (já escreveu): fica à vista para conferir. */
  lembrete?: string
}

const LER_A_CONVERSA = 'Abra a conversa no WhatsApp e leia até a última mensagem: o histórico ainda não chegou aqui.'
const diaEMes = (d: string) => d.split('-').reverse().slice(0, 2).join('/')
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000)
const emSP = (iso: string, campos: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', ...campos }).format(new Date(iso))
const instante = (s?: string) => Date.parse(s ?? '') || 0

/**
 * A nossa última mensagem saiu no dia do combinado ou depois, depois de ele ser anotado, e o lead não
 * respondeu ainda: o combinado provavelmente foi cumprido e falta só dizer isso aqui (19/10/2026, a
 * Jéssica: o Rômulo escreveu às 10:54 e o painel seguia mandando "abrir a conversa").
 */
function escreveuDepois(lead: CrmLead, combinado: { data: string; registradoEm?: string }): string | null {
  const saida = lead.conversa?.ultimaSaida
  if (!saida || !instante(saida)) return null
  if (emSP(saida, { year: 'numeric', month: '2-digit', day: '2-digit' }) < combinado.data) return null
  if (instante(saida) <= instante(combinado.registradoEm)) return null
  if (instante(lead.conversa?.ultimaEntrada) > instante(saida)) return null
  return saida
}

/**
 * PURO. O bloco "Seu próximo movimento" das Minhas decisões. Antes (19/10/2026, a Jéssica) ele dizia só
 * "Conferir a conversa de <nome cortado>" com a tática genérica, e o que fazer de fato estava na caixa
 * do combinado mais abaixo, como informação; o Rômulo não sabia qual era a ação. Quando há combinado
 * vencido e a ação é conferir o histórico (ou é o próprio combinado), o combinado vira o título e a
 * conferência vira o primeiro passo.
 */
export function movimentoDaMissao(lead: CrmLead, acao: AcaoDeVenda | null | undefined, hoje: string): MovimentoDaMissao {
  const p = lead.proximoPasso
  const combinado = p?.texto.trim() && p.data && p.data <= hoje ? p : null
  const conferir = !!acao?.conferirHistorico
  const ler = lead.links?.whatsapp ? (conferir ? LER_A_CONVERSA : 'Abra a conversa no WhatsApp e veja onde ela parou.') : 'Leia a conversa em “Ver contexto completo”.'
  if (combinado && (!acao || conferir || acao.tipo === 'combinado')) {
    const atraso = diasEntre(combinado.data, hoje)
    const quando = atraso <= 0 ? 'Combinado para hoje' : `Combinado para ${diaEMes(combinado.data)} · ${atraso} ${atraso === 1 ? 'dia' : 'dias'} de atraso`
    const saida = escreveuDepois(lead, combinado)
    if (saida) {
      const dia = emSP(saida, { year: 'numeric', month: '2-digit', day: '2-digit' })
      const hora = emSP(saida, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      return {
        titulo: `Você já escreveu ${dia === hoje ? 'hoje' : `em ${diaEMes(dia)}`} às ${hora}. Se cumpriu o combinado, marque como resolvido.`,
        quando, atrasado: false, lembrete: combinado.texto.trim(),
        passos: ['Compare o que você mandou com o combinado abaixo.', 'Cobriu: toque em “Já resolvi”. A vez passa a ser do cliente.', 'Faltou algo: complete pelo WhatsApp e depois toque em “Já resolvi”.'],
        doCombinado: true, primario: 'resolvi',
      }
    }
    return {
      titulo: combinado.texto.trim(), quando, atrasado: atraso > 0,
      passos: [ler, 'Faça o combinado acima, se ainda couber no que a conversa mostra.', 'Volte aqui: “Já resolvi” se fez, “Remarcar” se ficou para outro dia.'],
      doCombinado: true, primario: 'whatsapp',
    }
  }
  if (conferir) return {
    titulo: 'Ler a conversa antes de mandar qualquer coisa',
    atrasado: false,
    passos: [ler, 'Decida a próxima mensagem com o que leu e mande pelo WhatsApp.', 'Se combinou algo, conte em “Informar algo ao time”.'],
    doCombinado: false, primario: 'whatsapp',
  }
  const agora = acao ? agoraDaFicha(lead, acao) : null
  if (agora) return { titulo: agora.frase, como: agora.como, atrasado: false, passos: [], doCombinado: false, primario: 'whatsapp' }
  return { titulo: p?.texto || 'Leia a resposta e continue a conversa com o cliente.', atrasado: false, passos: [], doCombinado: false, primario: 'whatsapp' }
}

export interface MarcoDaMissao {
  id: 'contato' | 'conversa' | 'material' | 'proposta' | 'venda'
  nome: string
  observado: boolean
  /** De onde veio o avanço, quando não é o registro óbvio (o cartão mostra embaixo do nome). */
  detalhe?: string
}

/**
 * A 2ª mensagem do lead (o `text` do link wa.me) leva preço? No Site a SEGUNDA e a SEGUNDA_RAIO_X já
 * dizem "R$ 690 ... R$ 39 por mês" (server/site-mensagem.ts): mandada, a proposta foi junto. A versão
 * em inglês e a do Raio-X avulso sem demo não têm preço, e então a proposta segue por avançar.
 */
function segundaTemPreco(lead: Pick<CrmLead, 'links'>): boolean {
  const url = lead.links?.segunda
  if (!url) return false
  try {
    return (new URL(url).searchParams.get('text') ?? '').includes('R$')
  } catch {
    return false
  }
}

/** PURO. Avanços registrados; abrir um link ou ter material pronto não comprova envio. */
export function marcosDaMissao(lead: CrmLead): MarcoDaMissao[] {
  const material = !!lead.marcos.segundaEnviada || !!lead.conversa?.linkEm
  const propostaRegistrada = !!lead.proposta?.em || lead.etapa === 'proposta' || lead.etapa === 'ganho'
  const precoNaSegunda = !propostaRegistrada && material && segundaTemPreco(lead)
  return [
    { id: 'contato', nome: 'Contato', observado: !!lead.marcos.enviado || (lead.conversa?.mensagens ?? 0) > 0 },
    { id: 'conversa', nome: 'Conversa', observado: !!lead.conversa?.ultimaEntrada || !!lead.resposta && !['bot'].includes(lead.resposta.tipo) },
    { id: 'material', nome: 'Material', observado: material },
    { id: 'proposta', nome: 'Proposta', observado: propostaRegistrada || precoNaSegunda, ...(precoNaSegunda ? { detalhe: 'Preço na 2ª mensagem' } : {}) },
    { id: 'venda', nome: 'Venda', observado: lead.etapa === 'ganho' },
  ]
}
