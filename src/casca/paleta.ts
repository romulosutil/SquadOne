/**
 * PURO (17/10/2026, AC-23): os leads no Ctrl+K e o que a casca faz depois de navegar para a
 * mesma tela. Sem Vue, `window` nem `fetch`: o Paleta.vue lê o CRM e entrega aqui só o que pode
 * aparecer.
 *
 * Por que só o nome da empresa: a paleta é uma lista na tela, e quem está ao lado vê. Telefone,
 * e-mail e o id do lead nunca entram no texto da opção; o id vai só no destino (`/crm?lead=`),
 * que é como a Ficha se abre por link.
 */
import type { Comando, Perfil } from './destinos'

/** O lead como a paleta o vê: o Paleta.vue já traduziu oferta e etapa para palavras. */
export interface LeadDaPaleta {
  id: string
  empresa: string
  oferta: string
  etapa: string
}

/**
 * Mais que isso vira uma segunda tela de Funil dentro da paleta; quem não achou nos 8 primeiros
 * digita mais uma letra.
 */
export const LIMITE_DE_LEADS = 8

/** Quanto a lista de leads lida vale antes de ler de novo (abrir e fechar a paleta não relê). */
export const VALIDADE_DOS_LEADS_MS = 60_000

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const palavrasDe = (t: string) => semAcento(t).split(/[^a-z0-9]+/).filter(Boolean)

/**
 * Os leads cujo nome tem, para cada palavra digitada, uma palavra que começa com ela ("pad ze"
 * acha "Padaria do Zé"). Prefixo de palavra, e não "contém" como os destinos: com centenas de
 * leads, "ar" no meio de qualquer nome encheria a lista. Quem começa pelo termo inteiro vem
 * primeiro; o resto fica na ordem do CRM. Termo vazio não lista ninguém: a paleta aberta mostra
 * os destinos, não 8 leads ao acaso. No perfil `app` não há CRM, e nada sai daqui.
 */
export function comandosDeLeads(
  leads: LeadDaPaleta[],
  termo: string,
  perfil: Perfil,
  limite = LIMITE_DE_LEADS
): Comando[] {
  if (perfil !== 'operations') return []
  const busca = palavrasDe(termo)
  if (!busca.length) return []
  const inteiro = busca.join(' ')
  const achados = leads
    .map((lead, ordem) => ({ lead, ordem, nome: palavrasDe(lead.empresa) }))
    .filter(({ nome }) => busca.every((p) => nome.some((w) => w.startsWith(p))))
    .map((a) => ({ ...a, primeiro: a.nome.join(' ').startsWith(inteiro) ? 0 : 1 }))
    .sort((a, b) => a.primeiro - b.primeiro || a.ordem - b.ordem)
  return achados.slice(0, Math.max(0, limite)).map<Comando>(({ lead }) => ({
    id: `lead:${lead.id}`,
    rotulo: lead.empresa,
    dica: [lead.oferta, lead.etapa].filter(Boolean).join(' · '),
    acao: { tipo: 'ir', href: `/crm?lead=${encodeURIComponent(lead.id)}` },
  }))
}

/**
 * O que fazer depois de `navegar(href)` saindo de `atual` (caminho + busca de agora), quando só a
 * busca muda:
 *  - `popstate`: o CrmPanel lê `?ver=&lead=` ao montar e no `popstate`, e a casca não o remonta
 *    quando o caminho continua /crm (o `navegar` só faz pushState). Sem o aviso, escolher um lead
 *    ou a Triagem estando em Vendas mudaria a URL e deixaria a tela igual. O `popstate` sintético
 *    é o mesmo sinal do Voltar do navegador, que o CrmPanel já trata, e preserva o retrato lido.
 *  - `remontar`: o Mais lê `?abrir=` só ao montar e não escuta o history; trocar a chave dele
 *    na casca é o único jeito de reabrir sem mexer na tela.
 *  - `nada`: outro caminho (a casca já desenha a tela nova) ou o mesmo endereço.
 */
export type Reabertura = 'nada' | 'popstate' | 'remontar'

export function reaberturaDepoisDeIr(atual: string, href: string): Reabertura {
  let de: URL
  let para: URL
  try {
    de = new URL(atual, 'http://casca.invalid')
    para = new URL(href, de)
  } catch {
    return 'nada'
  }
  const caminho = (u: URL) => u.pathname.replace(/\/+$/, '') || '/'
  if (caminho(de) !== caminho(para) || de.search === para.search) return 'nada'
  return ['/', '/crm'].includes(caminho(para)) ? 'popstate' : 'remontar'
}
