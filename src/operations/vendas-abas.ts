/**
 * PURO (17/10/2026, hierarquia de Vendas): as abas de Vendas na ordem do trabalho e o endereço delas.
 *
 * Eram quatro abas iguais (A fazer, Triagem, Funil, Números), cada uma com a sua linha de dica e o seu
 * balanço, e o dono não sabia "o que fazer e em que ordem". Ficaram três, na ordem em que se trabalha:
 * Fazer (A fazer), Triar (Triagem) e Entender, que junta o que é consulta em três seções com um
 * segmentado: Funil, Números e Resultados (este voltou a ter casa própria: era o "?ver=resultados"
 * que caía em Números).
 *
 * O endereço não mudou de forma: ?ver=funil, ?ver=numeros, ?ver=resultados e ?ver=triagem abrem a
 * mesma coisa de antes; ?ver=jornada cai no Funil (com ?passo=); ?ver=roteiro e ?ver=colinha vão para
 * o Roteiro no Mais. Links do Hermes, do Telegram, do Escritório e do Ctrl+K seguem valendo.
 */

/** O que está aberto: a aba Fazer, a Triar, ou uma das três seções de Entender. */
export type VistaDeVendas = 'afazer' | 'triagem' | 'funil' | 'numeros' | 'resultados'
export type AbaDeVendas = 'afazer' | 'triagem' | 'entender'

/** O Roteiro inteiro mora no Mais (AC-20); o botão "Roteiro de venda" de Entender abre lá. */
export const ENDERECO_DO_ROTEIRO = '/mais?abrir=roteiro'

export const SECOES_DE_ENTENDER: ReadonlyArray<{ id: Extract<VistaDeVendas, 'funil' | 'numeros' | 'resultados'>; rotulo: string; dica: string }> = [
  { id: 'funil', rotulo: 'Funil', dica: 'Todos os leads por etapa, no Quadro ou na Lista; o filtro Passo mostra um passo da jornada.' },
  { id: 'numeros', rotulo: 'Números', dica: 'Onde o funil perde e quanto a venda espera depois do "sim"; os testes A/B ficam em Experimentos.' },
  { id: 'resultados', rotulo: 'Resultados', dica: 'Os enviados do período por nicho, mensagem, versão do site e horário.' },
]

/** As abas, na ordem do trabalho: Fazer → Triar → Entender. A dica vai no title, não na frente. */
export const ABAS_DE_VENDAS: ReadonlyArray<{ id: AbaDeVendas; rotulo: string; href: string; dica: string }> = [
  { id: 'afazer', rotulo: 'Conversas para você', href: '/crm', dica: 'Respostas humanas e combinados que precisam de você, em ordem de prioridade.' },
  { id: 'triagem', rotulo: 'Primeiros contatos', href: '/crm?ver=triagem', dica: 'O time avalia, seleciona, prepara e envia os primeiros contatos. Acompanhe as escolhas e os resultados.' },
  { id: 'entender', rotulo: 'Entender', href: '/crm?ver=funil', dica: 'Entender: o Funil, os Números e os Resultados, e o Roteiro de venda.' },
]

/** PURO. A aba de cada vista. */
export function abaDaVista(vista: VistaDeVendas): AbaDeVendas {
  return vista === 'afazer' || vista === 'triagem' ? vista : 'entender'
}

/** PURO. Ao tocar numa aba: Entender volta à última seção aberta nela (o Funil na primeira vez). */
export function vistaDaAba(aba: AbaDeVendas, ultimaDeEntender: VistaDeVendas = 'funil'): VistaDeVendas {
  if (aba !== 'entender') return aba
  return abaDaVista(ultimaDeEntender) === 'entender' ? ultimaDeEntender : 'funil'
}

export type LeituraDoEndereco =
  | { tipo: 'roteiro'; para: string }
  | { tipo: 'vendas'; vista: VistaDeVendas; produto: string | null; passo: string | null; lead: string | null }

/**
 * PURO. O que o endereço de /crm pede (`busca` é o location.search). Produto e passo voltam crus:
 * quem chama valida (PRODUTOS, lerFiltroDePasso). O passo só vale no Funil.
 */
export function lerEnderecoDeVendas(busca: string): LeituraDoEndereco {
  const q = new URLSearchParams(busca)
  const ver = q.get('ver')
  // Links antigos (Ficha aberta com Ctrl, favoritos, o Hermes): o Roteiro saiu das abas (AC-20).
  if (ver === 'roteiro' || ver === 'colinha') return { tipo: 'roteiro', para: ENDERECO_DO_ROTEIRO }
  const vista: VistaDeVendas = ver === 'funil' || ver === 'jornada' ? 'funil'
    : ver === 'triagem' ? 'triagem'
    : ver === 'numeros' ? 'numeros'
    : ver === 'resultados' ? 'resultados'
    : 'afazer'
  return { tipo: 'vendas', vista, produto: q.get('produto'), passo: vista === 'funil' ? q.get('passo') : null, lead: q.get('lead') }
}

/** PURO. O endereço canônico de uma vista (o que a tela escreve de volta). */
export function enderecoDeVendas(e: { vista: VistaDeVendas; produto?: string | null; passo?: string | null; lead?: string | null }): string {
  const q = new URLSearchParams()
  if (e.vista !== 'afazer') q.set('ver', e.vista)
  if (e.produto && e.produto !== 'todos') q.set('produto', e.produto)
  if (e.vista === 'funil' && e.passo) q.set('passo', e.passo)
  if (e.lead) q.set('lead', e.lead)
  const busca = q.toString()
  return `/crm${busca ? `?${busca}` : ''}`
}
