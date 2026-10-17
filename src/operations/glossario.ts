/**
 * Um nome por coisa (AC-13, 17/10/2026). A auditoria de 17/10 achou a mesma coisa com dois ou três
 * nomes na tela: "Vendas", "CRM" e "Vendas (o CRM do PRUMO)"; "Ganho", "Fechou" e "Fecharam";
 * "Roteiro" e "Colinha"; "Leram" e "Viu"; três recargas com três rótulos. Quem lê uma tela e depois
 * outra não sabe se é a mesma coisa, e o Rômulo pergunta. Aqui fica o nome certo de cada uma e os
 * nomes que não podem voltar; src/operations-glossario.test.ts varre os .vue e os .ts de src/ e falha
 * se um deles aparecer em texto visível.
 *
 * PURO: sem import, sem fs. O teste lê os arquivos e passa o conteúdo cru (o mesmo estilo de
 * src/blueprint/tokens.ts). A lista é curta de propósito: cada padrão é um nome errado que já esteve
 * na tela, com as exceções escritas (a aba "CRM" da planilha e o produto "CRM de estamparia" são
 * nomes reais de outra coisa). O glossário do service blueprint (docs/blueprint/servico.json) diz o
 * mesmo para as telas; este é o que o código confere.
 *
 * Identificadores, chaves de registro (`ganhou`, `segunda_enviada`), nomes de etapa no código e o
 * texto que o servidor manda ficam como estão: só o que chega à tela muda (o servidor diz "Fechou
 * (marcado na Central)" e crm-formato.ts traduz para "Ganho (marcado na Central)").
 */

export interface NomeDaUi {
  /** O nome que vale na tela. */
  certo: string
  /** Onde ele aparece e por quê, numa linha. */
  nota: string
  /** Os nomes errados, como padrões sobre o texto visível (sensíveis a caixa). */
  proibidos: readonly RegExp[]
}

export const GLOSSARIO: readonly NomeDaUi[] = [
  {
    certo: 'Vendas',
    nota: 'A barra, o título, os avisos e o Como funciona. "CRM" fica só para a aba CRM da planilha, o fluxo "08 · CRM" do n8n e os produtos CRM de estamparia e CRM da Silmer.',
    proibidos: [/(?<!aba |· )\bCRM\b(?! de estamparia| da Silmer)/],
  },
  {
    certo: 'Ganho (o estado) e Ganhou (o desfecho)',
    nota: 'A etapa, a sub-etapa da Ficha, a linha do tempo, Números ("Ganharam") e o Escritório.',
    // Minúsculo só depois de um número ("0 fecharam"): numa mensagem ao lead, "quem fechou" é o verbo dele.
    proibidos: [/\bFech(ou|aram)\b/, /\b\d+ fech(ou|aram)\b/],
  },
  {
    certo: 'Roteiro',
    nota: 'O que dizer em cada momento, em Mais › Entender e na Ficha. "colinha" ficou só no código (colinha.ts).',
    proibidos: [/(?<![\w/.=-])[Cc]olinha(?![\w-]|\.ts)/],
  },
  {
    certo: '2ª mensagem',
    nota: 'O passo da jornada ("Recebeu a 2ª mensagem"), o degrau de Números, o sinal do Funil e os títulos do Roteiro. Os botões dizem o que mandam ("Mandar o link do site").',
    proibidos: [/Viu o Raio-X/, /Receberam o próximo passo/, /[Ss]egunda mensagem/],
  },
  {
    certo: 'Leram / Leu',
    nota: 'A leitura do lead: "Leram" em Números, "Leu dd/mm" no cartão do Funil.',
    proibidos: [/\bVi(u|ram)\b/],
  },
  {
    certo: 'Atualizar',
    nota: 'As recargas de Vendas, do Dell (topo), das Finanças e da Agenda; o nome acessível diz o quê.',
    proibidos: [/Ler de novo/, /Atualizar agora/],
  },
  {
    certo: 'Escritório',
    nota: 'O mapa das squads e das salas; o link é "Ver o escritório".',
    proibidos: [/Agentes do SquadOne/, /Ver salas/],
  },
  {
    certo: 'A fazer',
    // 17/10/2026 (hierarquia de Vendas): as abas são três, na ordem do trabalho, e mantêm os nomes de
    // antes; "Entender" é o mesmo nome da seção do Mais, porque é a mesma intenção (consulta, não tarefa).
    nota: 'A aba de Vendas com a Próxima venda (Fazer); depois vêm Triagem (Triar) e Entender (Funil, Números e Resultados). "Hoje" é a tela inicial, onde o mesmo cartão também aparece.',
    proibidos: [/aparece na Hoje/, /Nada esperando você hoje/],
  },
  {
    certo: 'A oferta: ROTULO_DO_PRODUTO (longo) e SIGLA_DO_PRODUTO (curto)',
    nota: 'Os dois mapas de crm-formato.ts. "Estampa" e "PRUMO · Organizar" eram terceiros nomes.',
    proibidos: [/\bEstampa\b/, /PRUMO · Organizar/],
  },
]

export interface NomeProibido {
  certo: string
  achado: string
  trecho: string
}

/** PURO. Os nomes proibidos que aparecem num texto visível, com o nome certo de cada um. */
export function nomesProibidos(texto: string): NomeProibido[] {
  const achados: NomeProibido[] = []
  for (const g of GLOSSARIO) {
    for (const p of g.proibidos) {
      const m = new RegExp(p.source, p.flags.replace('g', '') + 'g')
      for (const r of texto.matchAll(m)) {
        const ini = Math.max(0, (r.index ?? 0) - 30)
        achados.push({ certo: g.certo, achado: r[0], trecho: texto.slice(ini, (r.index ?? 0) + r[0].length + 30).replace(/\s+/g, ' ') })
      }
    }
  }
  return achados
}

// ------------------------------------------------------------------ o que é texto visível

/**
 * Um literal do código parece texto de tela quando tem espaço ou começa por maiúscula. Assim
 * 'colinha' (o import, o nome de um evento) e 'segunda_enviada' (a chave) passam, e 'Ler de novo'
 * ou `Viu ${dia}` não.
 */
const pareceTexto = (s: string) => /\s/.test(s.trim()) || /^\p{Lu}/u.test(s.trim())

/**
 * PURO. As strings de um trecho de TS/JS: aspas simples e duplas e os pedaços de template (o que
 * está fora do `${}`; o que está dentro é código e é lido também). Comentários e expressões
 * regulares ficam de fora: é lá que o nome antigo pode ficar, contando a história.
 */
export function literaisDoCodigo(fonte: string): string[] {
  const out: string[] = []
  let i = 0
  const n = fonte.length
  // O último caractere significativo decide se "/" abre uma expressão regular ou é divisão.
  let anterior = ''

  function lerString(aspa: string) {
    let s = ''
    i++
    while (i < n && fonte[i] !== aspa && fonte[i] !== '\n') {
      if (fonte[i] === '\\') { s += fonte[i + 1] ?? ''; i += 2; continue }
      s += fonte[i++]
    }
    i++
    out.push(s)
  }

  function lerRegex() {
    i++
    let classe = false
    while (i < n && fonte[i] !== '\n') {
      const c = fonte[i]
      if (c === '\\') { i += 2; continue }
      if (c === '[') classe = true
      else if (c === ']') classe = false
      else if (c === '/' && !classe) break
      i++
    }
    i++
    while (i < n && /[a-z]/i.test(fonte[i])) i++
  }

  function lerTemplate() {
    let s = ''
    i++
    while (i < n && fonte[i] !== '`') {
      if (fonte[i] === '\\') { s += fonte[i + 1] ?? ''; i += 2; continue }
      if (fonte[i] === '$' && fonte[i + 1] === '{') {
        out.push(s); s = ''
        i += 2
        lerCodigo(true)
        continue
      }
      s += fonte[i++]
    }
    i++
    out.push(s)
  }

  function lerCodigo(ateFecharChave: boolean) {
    let profundidade = 0
    while (i < n) {
      const c = fonte[i]
      if (c === '/' && fonte[i + 1] === '/') { while (i < n && fonte[i] !== '\n') i++; continue }
      if (c === '/' && fonte[i + 1] === '*') { const f = fonte.indexOf('*/', i + 2); i = f < 0 ? n : f + 2; continue }
      if (c === "'" || c === '"') { lerString(c); anterior = 'a'; continue }
      if (c === '`') { lerTemplate(); anterior = 'a'; continue }
      if (c === '/' && (anterior === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(anterior))) { lerRegex(); anterior = 'a'; continue }
      if (c === '{') profundidade++
      if (c === '}') {
        if (ateFecharChave && profundidade === 0) { i++; anterior = 'a'; return }
        profundidade--
      }
      if (!/\s/.test(c)) anterior = c
      i++
    }
  }

  lerCodigo(false)
  return out
}

/** Atributos cujo valor estático é lido pela pessoa (ou pelo leitor de tela). */
const ATRIBUTOS_VISIVEIS = new Set(['aria-label', 'aria-description', 'title', 'placeholder', 'alt', 'label', 'summary'])

/** PURO. O texto visível de um <template> do Vue: nós de texto, mustaches e atributos que se leem. */
export function textosDoTemplate(template: string): string[] {
  const out: string[] = []
  const doCodigo = (expr: string) => { for (const s of literaisDoCodigo(expr)) if (pareceTexto(s)) out.push(s) }
  const doTexto = (texto: string) => {
    let resto = texto
    for (;;) {
      const a = resto.indexOf('{{')
      if (a < 0) break
      const f = resto.indexOf('}}', a + 2)
      if (f < 0) break
      out.push(resto.slice(0, a))
      doCodigo(resto.slice(a + 2, f))
      resto = resto.slice(f + 2)
    }
    out.push(resto)
  }
  let i = 0
  const n = template.length
  while (i < n) {
    if (template.startsWith('<!--', i)) { const f = template.indexOf('-->', i + 4); i = f < 0 ? n : f + 3; continue }
    if (template[i] === '<' && /[a-zA-Z/]/.test(template[i + 1] ?? '')) {
      i++
      while (i < n && !/[\s/>]/.test(template[i])) i++
      // Atributos até o ">" que não está entre aspas.
      while (i < n && template[i] !== '>') {
        if (/[\s/]/.test(template[i])) { i++; continue }
        const ini = i
        while (i < n && !/[\s=>/]/.test(template[i])) i++
        const nome = template.slice(ini, i)
        if (template[i] !== '=') continue
        i++
        const aspa = template[i]
        let valor = ''
        if (aspa === '"' || aspa === "'") {
          const f = template.indexOf(aspa, i + 1)
          valor = template.slice(i + 1, f < 0 ? n : f)
          i = f < 0 ? n : f + 1
        } else {
          const ini2 = i
          while (i < n && !/[\s>]/.test(template[i])) i++
          valor = template.slice(ini2, i)
        }
        if (/^(:|@|#|v-)/.test(nome)) doCodigo(valor)
        else if (ATRIBUTOS_VISIVEIS.has(nome)) out.push(valor)
      }
      i++
      continue
    }
    const ini = i
    i++
    while (i < n && !(template[i] === '<' && /[a-zA-Z/!]/.test(template[i + 1] ?? ''))) i++
    doTexto(template.slice(ini, i))
  }
  return out.filter((s) => s.trim())
}

/**
 * PURO. Todo texto visível de um arquivo de src/: num .vue, o <template> e os literais do
 * <script> que parecem texto; num .ts, os literais que parecem texto.
 */
export function textosVisiveis(nomeDoArquivo: string, conteudo: string): string[] {
  if (!nomeDoArquivo.endsWith('.vue')) return literaisDoCodigo(conteudo).filter(pareceTexto)
  const out: string[] = []
  for (const m of conteudo.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) out.push(...literaisDoCodigo(m[1]).filter(pareceTexto))
  // Sem o script e o style (um comentário do script pode citar "<template>"), o <template> de fora:
  // do primeiro "<template" ao último "</template>" (os de dentro são slots e v-if).
  const resto = conteudo.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
  const a = resto.indexOf('<template')
  const f = resto.lastIndexOf('</template>')
  if (a >= 0 && f > a) out.push(...textosDoTemplate(resto.slice(resto.indexOf('>', a) + 1, f)))
  return out
}
