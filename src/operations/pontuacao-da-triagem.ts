/**
 * PURO: a pontuação da Triagem (29/10/2026, decisão do PM de 28/10 em docs/PRUMO-DECISOES-PM-2026-10-28.md,
 * "Triagem (soma 100)"). Ordena a revisão humana dos prospects (PRUMO, Iris, estamparias), maior primeiro;
 * não diagnostica a empresa. Importável do servidor (server/crm.ts monta a entrada a partir do retrato) e
 * da tela (a Triagem mostra o total e as quatro partes).
 *
 *   Dor 50 · Acesso ao decisor 20 · Aderência do nicho 20 · Porte 10 = 100.
 *
 * Cada parte é um inteiro dentro do seu teto e o total é a soma delas: o que a tela mostra fecha com o
 * número, e o total nunca passa de 100 por construção (não há bônus nem desconto por fora, nem o "preso
 * entre 0 e 100" da regra de 17/10, que escondia quanto passava). Sinal que o retrato não tem vale 0
 * naquele item, nunca é presumido; a única ausência que não vale 0 é a do nicho (abaixo), por decisão.
 *
 * Dor, serviços PRUMO (até 50, os cinco itens somam exatamente 50):
 *  - sem site 15: o cadastro não traz site próprio (sem link, ou o link é rede social), ou o Raio-X achou
 *    `sem-site` / `site-e-rede-social`;
 *  - site fora do ar ou domínio vencido 15: achados `site-fora-do-ar` ou `dominio-vencido` do Raio-X. Pode
 *    somar com o "sem site": o Google sem site e o domínio antigo vencido são dois fatos ("Site antigo, fora
 *    do ar" no raio-x.py). O `dominio-vencido` ainda não sai do raio-x.py nem passa pelo leitor dos achados
 *    (IDS_DOS_ACHADOS); fica aceito aqui para o dia em que sair, e até lá vale 0;
 *  - nota abaixo de 4,3 = 8: a Nota Google da planilha; sem ela, a nota que o Raio-X leu. A régua é a da
 *    decisão (4,3), não a do `nota-baixa` do Raio-X: o achado sem número não pontua;
 *  - fora do top 10 do nicho 7: o achado `posicao-na-busca` com posição acima de 10, ou sem posição tendo
 *    lido ao menos 10 (ausente = fora dos lidos). Sem o achado, ou lidos menos de 10 sem posição: 0;
 *  - avaliações sem resposta ou menos de 20 = 5: só a contagem (planilha, senão Raio-X) abaixo de 20. Se o
 *    dono responde às avaliações o Places não entrega (raio-x.py), então essa metade do item não tem fonte.
 *
 * Dor, Iris e estamparias (até 50): sai dos sinais da oferta, os que o caçador acha no site e no nome
 * (`sinais` de cada oferta em deploy/dell/claude-ops/prumo-ofertas.json, coluna Sinais): 10 por sinal. As
 * marcas do caçador ("perfil não confirmado", "atende sozinho?", "nenhum sinal") não são sinal, e o sinal
 * de equipe (SINAL_DE_EQUIPE) conta no porte, não aqui, para não pesar duas vezes. Nota, avaliações e site
 * não entram: a decisão troca a dor do Google pela da oferta (o Iris e o CRM não vendem site).
 *
 * Acesso ao decisor (até 20), do canal que o retrato prova, antes de qualquer conversa:
 *  - 20: decisor confirmado na qualificação (SPICED `decisor_confirmado: sim`, só com confirmação humana);
 *  - 15: WhatsApp de celular publicado pela empresa (link ou botão no site, link no Google). Sem a coluna
 *    de origem (o Prospects do PRUMO não tem), o WhatsApp é o do Lead Scout, que só aceita o link no site;
 *  - 8: WhatsApp publicado num fixo (WhatsApp Business no fixo costuma cair na recepção);
 *  - 5: "não confirmado: celular do Google" (pode ser o dono, mas nem se sabe se é WhatsApp, e é quem mais
 *    denuncia: a ordem da Triagem ainda o põe depois de todo confirmado, em server/crm.ts);
 *  - 0: sem WhatsApp.
 *
 * Aderência do nicho (até 20): a taxa de "quero ver" do nicho relativa à média da mesma oferta, contada
 * sobre os enviados dos últimos JANELA_DA_ADERENCIA_DIAS com a regra única de Números (quisVer e
 * enviadoNosUltimos, src/operations/resultados.ts). 10 × taxa do nicho / taxa da oferta, preso entre 0 e
 * 20: na média, 10; o dobro, 20; nenhum "quero ver", 0. Com menos de ENVIOS_MINIMOS_DO_NICHO envios no
 * nicho, ou a oferta sem nenhum "quero ver" para comparar, 10 (a decisão: nem prêmio nem castigo por não
 * saber; é o mesmo valor da média).
 *
 * Porte (até 10): o porte conferido pelo CNPJ (EPP ou DEMAIS, só o Prospects do PRUMO tem a coluna) ou,
 * nas ofertas próprias, o sinal de equipe no site do caçador do Iris. Sem nenhum dos dois, 0: a marca
 * "profissional que atende sozinho?" (palpite pelo nome) também fica em 0, como o desconhecido.
 */
import { enviadoNosUltimos, quisVer } from './resultados'
import type { CrmLead } from './types'

export const TETO = { dor: 50, decisor: 20, nicho: 20, porte: 10 } as const
export const PONTOS_DA_DOR = { semSite: 15, foraDoAr: 15, notaBaixa: 8, foraDoTopo: 7, poucasAvaliacoes: 5 } as const
export const NOTA_DA_DOR = 4.3
export const AVALIACOES_DA_DOR = 20
export const TOPO_DO_NICHO = 10
export const PONTOS_POR_SINAL_DA_OFERTA = 10
/** Envios do nicho para a taxa valer (a decisão: "menos de 30 envios = 10"). */
export const ENVIOS_MINIMOS_DO_NICHO = 30
/**
 * Três meses de envios: com o teto de 15 primeiros contatos por dia repartido entre ofertas e nichos, 30
 * envios num nicho só em 30 dias quase nunca acontecem, e a aderência ficaria 10 para todo mundo.
 */
export const JANELA_DA_ADERENCIA_DIAS = 90
/** O rótulo do sinal de equipe do Iris em prumo-ofertas.json (src/operations-pontuacao-da-triagem.test.ts confere que existe). */
export const SINAL_DE_EQUIPE = 'equipe no site'

// As marcas que o caçador põe na coluna Sinais junto com os sinais do segmento (prumo-ofertas-triar.js):
// não são sinal de nada a favor, então não contam como sinal.
const MARCAS_DO_CACADOR = ['perfil não confirmado', 'profissional que atende sozinho', 'nenhum sinal no site']

export interface PontuacaoDaTriagem {
  /** Soma das quatro partes, de 0 a 100. */
  total: number
  dor: number
  decisor: number
  nicho: number
  porte: number
  /** O porquê de cada parte em poucas palavras, para a tela (vazio = não pontuou por falta de sinal). */
  porque: { dor: string[]; decisor: string; nicho: string; porte: string }
}

/** O nicho na mesma oferta: enviados na janela, quantos disseram "quero ver" e a taxa da oferta inteira. */
export interface AderenciaDoNicho {
  enviados: number
  quisVer: number
  /** "Quero ver" / enviados da oferta inteira na janela; null sem envio. */
  taxaDaOferta: number | null
}

/** Um ponto do Raio-X, só os campos que a dor lê; `id` é texto para aceitar o `dominio-vencido` (acima). */
export interface AchadoDaDor {
  id: string
  posicao?: number
  lidos?: number
  nota?: number
  avaliacoes?: number
}

export interface EntradaDaPontuacao {
  /** Oferta própria (Iris, estamparias): a dor vem dos sinais da oferta. */
  ofertaPropria: boolean
  /** A Nota Google crua ("4,5 (10)"). */
  nota?: string
  /** A coluna Sinais do caçador, " · " entre os itens. */
  sinais?: string
  /** Coluna Origem do WhatsApp; ausente no Prospects do PRUMO. */
  origemWhatsapp?: string
  /** O número ou o link wa.me do WhatsApp do retrato; ausente = sem WhatsApp. */
  whatsapp?: string
  /** true: site próprio; false: sem site ou só rede social; ausente: não se sabe (vale 0). */
  temSiteProprio?: boolean
  achados?: readonly AchadoDaDor[]
  porte?: 'EPP' | 'DEMAIS'
  decisorConfirmado?: boolean
  /** Ausente = o nicho não teve envio na janela (vale 10, como a amostra pequena). */
  aderencia?: AderenciaDoNicho
}

/** "4,5 (10)" ou "4.5 (10)", como o caçador e o Lead Scout gravam a Nota Google; o que não ler fica ausente. */
export function notaDoGoogle(valor: string | undefined): { nota?: number; avaliacoes?: number } {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:\((\d+)\))?/.exec(valor ?? '')
  if (!m) return {}
  const nota = Number(m[1].replace(',', '.'))
  const avaliacoes = m[2] !== undefined ? Number(m[2]) : undefined
  return {
    ...(nota > 0 && nota <= 5 ? { nota } : {}),
    ...(avaliacoes !== undefined && Number.isFinite(avaliacoes) ? { avaliacoes } : {}),
  }
}

/** Os itens da coluna Sinais, em minúsculas, sem as marcas do caçador. */
export function sinaisDaOferta(sinais: string | undefined): string[] {
  return (sinais ?? '').split('·').map((s) => s.trim().toLowerCase()).filter(Boolean)
    .filter((s) => !MARCAS_DO_CACADOR.some((m) => s.startsWith(m)))
}

const numero = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined

function dorDoPrumo(e: EntradaDaPontuacao): { pontos: number; porque: string[] } {
  const achados = e.achados ?? []
  const tem = (id: string) => achados.some((a) => a.id === id)
  const google = notaDoGoogle(e.nota)
  const nota = google.nota ?? achados.map((a) => numero(a.nota)).find((n) => n !== undefined)
  const avaliacoes = google.avaliacoes ?? achados.map((a) => numero(a.avaliacoes)).find((n) => n !== undefined)
  const busca = achados.find((a) => a.id === 'posicao-na-busca')
  const posicao = numero(busca?.posicao)
  const lidos = numero(busca?.lidos)
  const itens: Array<[boolean, number, string]> = [
    [e.temSiteProprio === false || tem('sem-site') || tem('site-e-rede-social'), PONTOS_DA_DOR.semSite, 'sem site'],
    [tem('site-fora-do-ar') || tem('dominio-vencido'), PONTOS_DA_DOR.foraDoAr, 'site fora do ar ou domínio vencido'],
    [nota !== undefined && nota < NOTA_DA_DOR, PONTOS_DA_DOR.notaBaixa, 'nota abaixo de 4,3'],
    [busca !== undefined && (posicao !== undefined ? posicao > TOPO_DO_NICHO : lidos !== undefined && lidos >= TOPO_DO_NICHO),
      PONTOS_DA_DOR.foraDoTopo, 'fora do top 10 da busca'],
    [avaliacoes !== undefined && avaliacoes < AVALIACOES_DA_DOR, PONTOS_DA_DOR.poucasAvaliacoes, 'menos de 20 avaliações'],
  ]
  const valem = itens.filter(([vale]) => vale)
  return { pontos: valem.reduce((s, [, p]) => s + p, 0), porque: valem.map(([, , texto]) => texto) }
}

function dorDaOferta(e: EntradaDaPontuacao): { pontos: number; porque: string[] } {
  const sinais = sinaisDaOferta(e.sinais).filter((s) => s !== SINAL_DE_EQUIPE)
  return { pontos: Math.min(TETO.dor, sinais.length * PONTOS_POR_SINAL_DA_OFERTA), porque: sinais }
}

/** Só os dígitos; 55 + DDD + 9 + 8 dígitos é celular, 55 + DDD + 8 dígitos é fixo. */
function tipoDoNumero(whatsapp: string): 'celular' | 'fixo' | undefined {
  const d = whatsapp.replace(/\D/g, '')
  if (/^55[1-9]{2}9\d{8}$/.test(d)) return 'celular'
  if (/^55[1-9]{2}[2-5]\d{7}$/.test(d)) return 'fixo'
  return undefined
}

function acessoAoDecisor(e: EntradaDaPontuacao): { pontos: number; porque: string } {
  if (e.decisorConfirmado) return { pontos: 20, porque: 'decisor confirmado' }
  if (!e.whatsapp) return { pontos: 0, porque: 'sem WhatsApp' }
  if ((e.origemWhatsapp ?? '').startsWith('não confirmado')) return { pontos: 5, porque: 'WhatsApp não confirmado' }
  // O número que não dá para dizer se é celular ou fixo fica com o menor dos publicados: não se presume o celular.
  return tipoDoNumero(e.whatsapp) === 'celular' ? { pontos: 15, porque: 'celular publicado' } : { pontos: 8, porque: 'WhatsApp fixo publicado' }
}

function aderenciaDoNicho(a: AderenciaDoNicho | undefined): { pontos: number; porque: string } {
  if (!a || a.enviados < ENVIOS_MINIMOS_DO_NICHO) return { pontos: 10, porque: `menos de ${ENVIOS_MINIMOS_DO_NICHO} envios` }
  if (!a.taxaDaOferta) return { pontos: 10, porque: 'oferta sem “quero ver” para comparar' }
  const relativa = (a.quisVer / a.enviados) / a.taxaDaOferta
  const pontos = Math.round(Math.min(TETO.nicho, Math.max(0, 10 * relativa)))
  return { pontos, porque: `${a.quisVer} “quero ver” em ${a.enviados} envios` }
}

function porteDoLead(e: EntradaDaPontuacao): { pontos: number; porque: string } {
  if (e.porte) return { pontos: TETO.porte, porque: `${e.porte} pelo CNPJ` }
  if (e.ofertaPropria && sinaisDaOferta(e.sinais).includes(SINAL_DE_EQUIPE)) return { pontos: TETO.porte, porque: 'equipe no site' }
  return { pontos: 0, porque: 'não conferido' }
}

/** PURA. A pontuação de um prospect da Triagem, com as quatro partes (ver o comentário do arquivo). */
export function pontuacaoDaTriagem(e: EntradaDaPontuacao): PontuacaoDaTriagem {
  const dor = e.ofertaPropria ? dorDaOferta(e) : dorDoPrumo(e)
  const decisor = acessoAoDecisor(e)
  const nicho = aderenciaDoNicho(e.aderencia)
  const porte = porteDoLead(e)
  const partes = { dor: Math.min(TETO.dor, dor.pontos), decisor: decisor.pontos, nicho: nicho.pontos, porte: porte.pontos }
  return {
    total: partes.dor + partes.decisor + partes.nicho + partes.porte,
    ...partes,
    porque: { dor: dor.porque, decisor: decisor.porque, nicho: nicho.porque, porte: porte.porque },
  }
}

/** A chave do nicho: a oferta e o nicho sem acento nem caixa ("prumo:clinica odontologica"). */
export const chaveDoNicho = (lead: Pick<CrmLead, 'produto' | 'nicho'>) =>
  `${lead.produto}:${lead.nicho.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()}`

type LeadDaAderencia = Pick<CrmLead, 'produto' | 'nicho' | 'marcos' | 'resposta' | 'etapa'> & Partial<Pick<CrmLead, 'conversa' | 'classificacaoResposta'>>

/**
 * PURA. A aderência de cada nicho, por oferta, dos enviados na janela: a mesma conta de Números (quisVer
 * e enviadoNosUltimos), não outra definição de interesse. Só os produtos pedidos (os da Triagem); nicho
 * vazio não forma grupo, mas o envio conta na média da oferta.
 */
export function aderenciaDosNichos(
  leads: readonly LeadDaAderencia[], produtos: readonly string[], agora: number, dias = JANELA_DA_ADERENCIA_DIAS,
): Map<string, AderenciaDoNicho> {
  const porNicho = new Map<string, { enviados: number; quisVer: number }>()
  const porOferta = new Map<string, { enviados: number; quisVer: number }>()
  const somar = (mapa: Map<string, { enviados: number; quisVer: number }>, chave: string, quis: boolean) => {
    const c = mapa.get(chave) ?? { enviados: 0, quisVer: 0 }
    c.enviados += 1
    if (quis) c.quisVer += 1
    mapa.set(chave, c)
  }
  for (const lead of leads) {
    if (!produtos.includes(lead.produto) || !enviadoNosUltimos(lead, dias, agora)) continue
    const quis = quisVer(lead)
    somar(porOferta, lead.produto, quis)
    if (lead.nicho.trim()) somar(porNicho, chaveDoNicho(lead), quis)
  }
  return new Map([...porNicho].map(([chave, c]) => {
    const oferta = porOferta.get(chave.slice(0, chave.indexOf(':')))
    return [chave, { ...c, taxaDaOferta: oferta && oferta.enviados > 0 ? oferta.quisVer / oferta.enviados : null }]
  }))
}
