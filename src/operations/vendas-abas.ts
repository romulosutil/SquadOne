/**
 * PURO (17/10/2026, hierarquia de Vendas): as abas de Vendas na ordem do trabalho e o endereço delas.
 *
 * Eram quatro abas iguais, cada uma com a sua linha de dica e o seu balanço, e o dono não sabia "o que
 * fazer e em que ordem". Ficaram três, na ordem em que se trabalha: Conversas para você (id `afazer`),
 * Primeiros contatos (id `triagem`) e Entender, que junta o que é consulta em três seções com um
 * segmentado: Funil, Diagnóstico (id `numeros`) e Resultados. Os nomes da tela estão em NOME_DAS_ABAS.
 *
 * O endereço não mudou de forma: ?ver=funil, ?ver=numeros, ?ver=resultados e ?ver=triagem abrem a
 * mesma coisa de antes; ?ver=jornada cai no Funil (com ?passo=); ?ver=roteiro e ?ver=colinha vão para
 * o Roteiro no Mais. Links do Hermes, do Telegram, do Escritório e do Ctrl+K seguem valendo.
 */

/** O que está aberto: a aba Fazer, a Triar, ou uma das três seções de Entender. */
export type VistaDeVendas = 'afazer' | 'triagem' | 'funil' | 'numeros' | 'resultados' | 'bi'
export type AbaDeVendas = 'afazer' | 'triagem' | 'entender'
export type DetalheDoCliente = 'orientacao' | 'ficha'

/**
 * O nome de cada aba e seção de Vendas na tela, um só (19/10/2026, auditoria dos fluxos). Os ids
 * (`afazer`, `triagem`, `numeros`) são os do endereço e do código e não mudam; o que a pessoa lê é isto.
 * A barra, o Ctrl+K, o Como funciona, a jornada e o glossário leem daqui: o CrmPanel mostrava
 * "Conversas para você", "Primeiros contatos" e "Diagnóstico" enquanto os textos mandavam o Rômulo
 * para "A fazer", "Triagem" e "Números", abas que não existem mais com esses nomes.
 */
export const NOME_DAS_ABAS: Readonly<Record<VistaDeVendas | AbaDeVendas, string>> = {
  bi: 'BI da operação',
  afazer: 'Conversas para você',
  triagem: 'Primeiros contatos',
  entender: 'Entender',
  funil: 'Funil',
  numeros: 'Diagnóstico',
  resultados: 'Resultados',
}

/** "Vendas › Conversas para você": o caminho de uma aba, para os textos que mandam a pessoa até ela. */
export const caminhoDaAba = (aba: VistaDeVendas | AbaDeVendas): string => `Vendas › ${NOME_DAS_ABAS[aba]}`

/** O Roteiro inteiro mora no Mais (AC-20); o botão "Roteiro de venda" de Entender abre lá. */
export const ENDERECO_DO_ROTEIRO = '/mais?abrir=roteiro'

export const SECOES_DE_ENTENDER: ReadonlyArray<{ id: Extract<VistaDeVendas, 'funil' | 'numeros' | 'resultados' | 'bi'>; rotulo: string; dica: string }> = [
  { id: 'bi', rotulo: NOME_DAS_ABAS.bi, dica: 'Decisões, público, mensagens, quebras e escolhas dos agentes por cliente.' },
  { id: 'funil', rotulo: NOME_DAS_ABAS.funil, dica: 'Todos os leads por etapa, no Quadro ou na Lista; o filtro Passo mostra um passo da jornada.' },
  { id: 'numeros', rotulo: NOME_DAS_ABAS.numeros, dica: 'Onde o funil perde e quanto a venda espera depois do "sim"; os testes A/B ficam em Experimentos.' },
  { id: 'resultados', rotulo: NOME_DAS_ABAS.resultados, dica: 'Os enviados do período por nicho, mensagem, versão do site e horário.' },
]

/** As abas, na ordem do trabalho: Fazer → Triar → Entender. A dica vai no title, não na frente. */
export const ABAS_DE_VENDAS: ReadonlyArray<{ id: AbaDeVendas; rotulo: string; href: string; dica: string }> = [
  { id: 'afazer', rotulo: NOME_DAS_ABAS.afazer, href: '/crm', dica: 'Respostas humanas e combinados que precisam de você, em ordem de prioridade.' },
  { id: 'triagem', rotulo: NOME_DAS_ABAS.triagem, href: '/crm?ver=triagem', dica: 'O time avalia, seleciona, prepara e envia os primeiros contatos. Acompanhe as escolhas e os resultados.' },
  { id: 'entender', rotulo: NOME_DAS_ABAS.entender, href: '/crm?ver=funil', dica: 'Entender: o Funil, o Diagnóstico e os Resultados, e o Roteiro de venda.' },
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
  | { tipo: 'vendas'; vista: VistaDeVendas; produto: string | null; passo: string | null; lead: string | null; detalhe?: DetalheDoCliente }

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
    : ver === 'bi' ? 'bi'
    : ver === 'triagem' ? 'triagem'
    : ver === 'numeros' ? 'numeros'
    : ver === 'resultados' ? 'resultados'
    : 'afazer'
  const detalhe = q.get('detalhe')
  return { tipo: 'vendas', vista, produto: q.get('produto'), passo: vista === 'funil' ? q.get('passo') : null, lead: q.get('lead'), ...(q.get('lead') && (detalhe === 'ficha' || detalhe === 'orientacao') ? { detalhe } : {}) }
}

/** PURO. O endereço canônico de uma vista (o que a tela escreve de volta). */
export function enderecoDeVendas(e: { vista: VistaDeVendas; produto?: string | null; passo?: string | null; lead?: string | null; detalhe?: DetalheDoCliente }): string {
  const q = new URLSearchParams()
  if (e.vista !== 'afazer') q.set('ver', e.vista)
  if (e.produto && e.produto !== 'todos') q.set('produto', e.produto)
  if (e.vista === 'funil' && e.passo) q.set('passo', e.passo)
  if (e.lead) q.set('lead', e.lead)
  if (e.lead && e.detalhe) q.set('detalhe', e.detalhe)
  const busca = q.toString()
  return `/crm${busca ? `?${busca}` : ''}`
}
