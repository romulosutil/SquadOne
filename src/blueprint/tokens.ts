/**
 * PURO (16/10/2026): o blueprint do design lido do próprio tokens.css.
 *
 * O design system (/design-system) não tem lista de tokens própria: importa o tokens.css
 * cru e lê daqui, então um token novo aparece nele sem ninguém lembrar de
 * cadastrar. O mesmo arquivo dá ao teste as regras que mantêm o app homogêneo
 * (nada de rem solto em espaço, de tamanho de fonte fora da escala, de peso
 * numérico) e ao blueprint o contraste e o "pedido de mudança" que se cola na
 * conversa com o Claude.
 *
 * Sem Vue, sem `window`, sem `document`: o teste roda isto no node.
 */

export type GrupoDeToken =
  | 'paleta' | 'semanticos' | 'etapas' | 'forma' | 'toque' | 'layout' | 'espaco' | 'fonte' | 'peso' | 'tamanho'

export interface Token {
  nome: string
  /** Valor no tema claro (o :root). */
  valor: string
  /** Valor no tema escuro, quando ele muda (o :root[data-theme="dark"]). */
  escuro?: string
  grupo: GrupoDeToken
  /** O comentário logo acima da declaração, sem as marcas de comentário. */
  nota?: string
}

export const GRUPOS: ReadonlyArray<{ id: GrupoDeToken; titulo: string; uso: string }> = [
  { id: 'semanticos', titulo: 'Cores semânticas', uso: 'O que as telas usam. O modo escuro troca só estas.' },
  { id: 'paleta', titulo: 'Paleta', uso: 'A matéria-prima. Tela nenhuma usa direto, só pelos semânticos.' },
  { id: 'etapas', titulo: 'Etapas do funil', uso: 'Pastéis fixos nos dois temas; o texto sobre eles é sempre a tinta.' },
  { id: 'tamanho', titulo: 'Tamanhos de texto', uso: 'Seis degraus. Nada de rem solto em font-size.' },
  { id: 'peso', titulo: 'Pesos', uso: 'A hierarquia sai daqui. Nada de número solto em font-weight.' },
  { id: 'espaco', titulo: 'Espaço', uso: 'Oito degraus. Nada de rem solto em padding, margin ou gap.' },
  { id: 'forma', titulo: 'Forma', uso: 'Linha, divisor, faixa, sombra e o único raio.' },
  { id: 'toque', titulo: 'Toque', uso: 'Altura mínima do que se toca.' },
  { id: 'layout', titulo: 'Layout, camadas e movimento', uso: 'Larguras, ordem de empilhamento e duração.' },
  { id: 'fonte', titulo: 'Fonte', uso: 'Inter variável, hospedada no app.' },
]

export function grupoDoToken(nome: string): GrupoDeToken {
  if (nome.startsWith('--cor-')) return 'paleta'
  if (nome.startsWith('--etapa-') || nome === '--sobre-pastel') return 'etapas'
  if (nome.startsWith('--esp-')) return 'espaco'
  if (nome.startsWith('--tam-')) return 'tamanho'
  if (nome.startsWith('--peso-')) return 'peso'
  if (nome === '--fonte') return 'fonte'
  if (nome.startsWith('--toque')) return 'toque'
  if (/^--(linha|divisor|faixa|sombra|raio)/.test(nome)) return 'forma'
  if (/^--(largura|camada|duracao|tamanho-barra)/.test(nome)) return 'layout'
  return 'semanticos'
}

/** O corpo (entre as chaves) do primeiro bloco cujo seletor é exatamente `seletor`. */
export function corpoDoBloco(css: string, seletor: string): string {
  const re = new RegExp(`(^|[}\\s])${seletor.replace(/[[\]().*+?^$|\\]/g, '\\$&')}\\s*\\{`, 'm')
  const achado = re.exec(css)
  if (!achado) return ''
  let i = achado.index + achado[0].length
  let profundidade = 1
  const inicio = i
  while (i < css.length && profundidade > 0) {
    if (css[i] === '{') profundidade++
    else if (css[i] === '}') profundidade--
    i++
  }
  return css.slice(inicio, i - 1)
}

// Comentário ou declaração, um de cada vez: assim um "--x:" escrito dentro de um comentário
// nunca vira token, e a nota só gruda na declaração que vem logo depois dele.
const PECA = /\/\*([\s\S]*?)\*\/|(--[\w-]+)\s*:\s*([^;]+);/g

function limparNota(bruta: string | undefined): string | undefined {
  if (!bruta) return undefined
  const nota = bruta.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim()
  return nota || undefined
}

function declaracoes(corpo: string): Array<{ nome: string; valor: string; nota?: string }> {
  const out: Array<{ nome: string; valor: string; nota?: string }> = []
  let nota: string | undefined
  let fimDaNota = -1
  for (const m of corpo.matchAll(PECA)) {
    if (m[1] !== undefined) {
      nota = limparNota(m[1])
      fimDaNota = m.index + m[0].length
      continue
    }
    // Colada = só espaço entre o comentário e a declaração, sem linha em branco (que separa seção).
    const entre = corpo.slice(fimDaNota, m.index)
    const colada = nota !== undefined && entre.trim() === '' && !/\n\s*\n/.test(entre)
    out.push({ nome: m[2], valor: m[3].replace(/\s+/g, ' ').trim(), ...(colada ? { nota } : {}) })
    nota = undefined
  }
  return out
}

/** Os tokens do tokens.css, na ordem do arquivo, com o valor do tema escuro quando muda. */
export function lerTokens(css: string): Token[] {
  const claros = declaracoes(corpoDoBloco(css, ':root'))
  const escuros = new Map(declaracoes(corpoDoBloco(css, ':root[data-theme="dark"]')).map((d) => [d.nome, d.valor]))
  return claros.map((d) => {
    const escuro = escuros.get(d.nome)
    return {
      nome: d.nome,
      valor: d.valor,
      ...(escuro !== undefined && escuro !== d.valor ? { escuro } : {}),
      grupo: grupoDoToken(d.nome),
      ...(d.nota ? { nota: d.nota } : {}),
    }
  })
}

// ------------------------------------------------------------ contraste (WCAG 2.1)

export type Rgb = [number, number, number]

/** "rgb(17, 19, 15)", "rgb(17 19 15 / 0.5)", "#11130f" ou "#fff". Transparência é ignorada. */
export function lerRgb(cor: string): Rgb | null {
  const s = cor.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

function canal(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

export function luminancia([r, g, b]: Rgb): number {
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

/** Razão de contraste, de 1 a 21, com duas casas. */
export function contraste(a: Rgb, b: Rgb): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return Math.round(((claro + 0.05) / (escuro + 0.05)) * 100) / 100
}

export type NivelWcag = 'AAA' | 'AA' | 'AA grande' | 'falha'

/** Texto normal: AA a 4,5 e AAA a 7. Abaixo de 4,5 só serve texto grande ou negrito de 18,7 px (3). */
export function nivelWcag(razao: number): NivelWcag {
  if (razao >= 7) return 'AAA'
  if (razao >= 4.5) return 'AA'
  if (razao >= 3) return 'AA grande'
  return 'falha'
}

export interface ParDeContraste {
  texto: string
  fundo: string
  uso: string
  /** O mínimo que este par precisa: 4,5 para texto, 3 para anel de foco e texto grande. */
  minimo: 3 | 4.5
}

/** Os pares que de fato aparecem nas telas. O blueprint mede cada um no tema da hora. */
export const PARES_DE_CONTRASTE: readonly ParDeContraste[] = [
  { texto: '--texto', fundo: '--fundo', uso: 'texto direto na página', minimo: 4.5 },
  { texto: '--texto', fundo: '--superficie', uso: 'texto em cartão e bloco', minimo: 4.5 },
  { texto: '--texto-2', fundo: '--superficie', uso: 'data, fonte, explicação', minimo: 4.5 },
  { texto: '--texto-2', fundo: '--superficie-2', uso: 'apoio dentro de faixa', minimo: 4.5 },
  { texto: '--destaque-texto', fundo: '--destaque', uso: 'ação primária, escolhido', minimo: 4.5 },
  { texto: '--texto', fundo: '--ok-fundo', uso: 'recado e selo de OK', minimo: 4.5 },
  { texto: '--texto', fundo: '--atencao-fundo', uso: 'recado e selo de atenção', minimo: 4.5 },
  { texto: '--texto', fundo: '--erro-fundo', uso: 'recado e selo de erro', minimo: 4.5 },
  { texto: '--positivo', fundo: '--superficie', uso: 'valor de entrada', minimo: 4.5 },
  { texto: '--negativo', fundo: '--superficie', uso: 'valor de saída', minimo: 4.5 },
  { texto: '--barra-texto', fundo: '--barra-fundo', uso: 'barra inferior e trilho', minimo: 4.5 },
  { texto: '--sobre-pastel', fundo: '--etapa-contato', uso: 'cabeça de coluna do funil', minimo: 4.5 },
  { texto: '--sobre-pastel', fundo: '--etapa-perdido', uso: 'cabeça de coluna do funil', minimo: 4.5 },
  { texto: '--foco', fundo: '--superficie', uso: 'anel de foco', minimo: 3 },
  { texto: '--borda', fundo: '--superficie', uso: 'contorno de campo e botão', minimo: 3 },
]

// ------------------------------------------------------------ pedido de mudança

export interface Mudanca {
  nome: string
  de: string
  para: string
}

/**
 * O texto que o botão "Copiar pedido" põe na área de transferência: um bloco de CSS
 * pronto para o tokens.css e, em cima, o contexto que o Claude precisa para aplicar.
 */
export function pedidoDeMudanca(mudancas: readonly Mudanca[], tema: 'claro' | 'escuro', observacao = ''): string {
  if (!mudancas.length) return ''
  const seletor = tema === 'escuro' ? ':root[data-theme="dark"] (e o bloco do prefers-color-scheme)' : ':root'
  const linhas = mudancas.map((m) => `  ${m.nome}: ${m.para}; /* era ${m.de} */`)
  return [
    `Blueprint do SquadOne: mudar ${mudancas.length} token${mudancas.length === 1 ? '' : 's'} em src/estilos/tokens.css (${seletor}), visto no tema ${tema}.`,
    ...(observacao.trim() ? [`Por quê: ${observacao.trim()}`] : []),
    '',
    '```css',
    `${tema === 'escuro' ? ':root[data-theme="dark"]' : ':root'} {`,
    ...linhas,
    '}',
    '```',
  ].join('\n')
}

// ------------------------------------------------------------ regras de homogeneidade

/** Os <style> de um .vue, ou o próprio texto de um .css. */
export function cssDoArquivo(nome: string, conteudo: string): string {
  if (!nome.endsWith('.vue')) return conteudo
  return [...conteudo.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
}

function semComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

export interface Desvio {
  regra: 'espaco' | 'tamanho' | 'peso'
  declaracao: string
}

/**
 * O que foge da escala: rem ou px solto em padding, margin e gap; rem ou px em font-size;
 * número em font-weight. `0`, `auto`, `em`, `%`, `vw`, `env()` e os tokens passam.
 */
export function desviosDaEscala(css: string): Desvio[] {
  const out: Desvio[] = []
  const limpo = semComentarios(css)
  for (const m of limpo.matchAll(/(?<![\w-])((?:padding|margin)(?:-[a-z-]+)?|gap|row-gap|column-gap)\s*:\s*([^;}]+)/g)) {
    if (/(?<![\w.-])\d*\.?\d+(rem|px)\b/.test(m[2].replace(/env\([^)]*\)/g, '').replace(/clamp\([^)]*\)/g, ''))) {
      out.push({ regra: 'espaco', declaracao: `${m[1]}: ${m[2].trim()}` })
    }
  }
  for (const m of limpo.matchAll(/(?<![\w-])font-size\s*:\s*([^;}]+)/g)) {
    if (/(?<![\w.-])\d*\.?\d+(rem|px)\b/.test(m[1])) out.push({ regra: 'tamanho', declaracao: `font-size: ${m[1].trim()}` })
  }
  for (const m of limpo.matchAll(/(?<![\w-])font-weight\s*:\s*([^;}]+)/g)) {
    if (/^\s*\d+\s*$/.test(m[1])) out.push({ regra: 'peso', declaracao: `font-weight: ${m[1].trim()}` })
  }
  return out
}

/** As variáveis lidas com var(--x) e as definidas com --x: no mesmo texto. */
export function variaveisUsadas(css: string): Set<string> {
  return new Set([...semComentarios(css).matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))
}

export function variaveisDefinidas(css: string): Set<string> {
  return new Set([...semComentarios(css).matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((m) => m[1]))
}
