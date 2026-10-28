// PURO: o texto de server/ofertas.gerado.ts a partir de deploy/dell/claude-ops/prumo-ofertas.json (28/10/2026).
// O JSON é o registro único das ofertas próprias do PRUMO (Iris, CRM de estamparia, as próximas); o lado TS
// lia a mesma coisa escrita à mão em ~35 arquivos e uma oferta nova sumia calada do funil. Gera-se um arquivo
// .ts, em vez de importar o JSON, para manter a união literal (`as const`): assim o vue-tsc aponta todo
// Record<CrmProduto, …> que ficou sem a oferta nova. Quem grava é scripts/ofertas-gerar.ts; o teste
// server/ofertas.test.ts falha se o arquivo gravado ficar atrás do JSON.

/** Os campos que o TS usa, com o nome do JSON ao lado. Campo novo no JSON que o TS não lê não entra aqui. */
const CAMPOS = [
  ['rotulo', 'rotulo', 'Rótulo longo (Ficha, filtro do desktop, ROTULO_DO_PRODUTO).'],
  ['sigla', 'sigla', 'Rótulo curto, o mesmo no celular e no desktop (SIGLA_DO_PRODUTO).'],
  ['tipo', 'tipo', 'Só "propria" por enquanto: caminho curto, sem Raio-X nem Mapa, "combinar a demonstração".'],
  ['aba', 'aba', 'A aba da planilha do PRUMO de onde o CRM lê a oferta.'],
  ['sala', 'sala', 'O domínio (sala) da squad PRUMO no Escritório.'],
  ['cacadorRotulo', 'cacador_rotulo', 'Quem encontrou o lead, como a Ficha diz.'],
  ['fonte', 'fonte', 'O nome da fonte na tela (NOME_DA_FONTE).'],
  ['linkRetrato', 'link_retrato', 'A chave do link da aba em CrmRetrato.links (o n8n 08 · CRM grava assim).'],
  ['mensagem', 'mensagem', 'O convite aprovado, com {OLA} e {NOME}.'],
] as const

const RESERVADOS = new Set(['site', 'prumo', 'plus', 'registros'])
const TIPOS = new Set(['propria'])

export class OfertaInvalida extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OfertaInvalida'
  }
}

/** Lê e confere o bloco `ofertas` do JSON. Falta ou erro derruba a geração: nunca vira lista vazia. */
export function lerOfertas(config: unknown): Array<{ id: string } & Record<(typeof CAMPOS)[number][0], string>> {
  const ofertas = (config as { ofertas?: unknown } | null)?.ofertas
  if (!ofertas || typeof ofertas !== 'object' || Array.isArray(ofertas)) throw new OfertaInvalida('prumo-ofertas.json sem o objeto "ofertas".')
  const lidas: Array<{ id: string } & Record<(typeof CAMPOS)[number][0], string>> = []
  for (const [id, bruto] of Object.entries(ofertas as Record<string, unknown>)) {
    // O id vira chave de objeto, parte do tipo CrmProduto e da coluna do CRM: só minúsculas e dígitos.
    if (!/^[a-z][a-z0-9]*$/.test(id)) throw new OfertaInvalida(`Oferta "${id}": o id é só minúsculas e dígitos, começando por letra.`)
    if (RESERVADOS.has(id)) throw new OfertaInvalida(`Oferta "${id}": id reservado (${[...RESERVADOS].join(', ')}).`)
    const o = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
    const lida = { id } as { id: string } & Record<(typeof CAMPOS)[number][0], string>
    for (const [ts, json] of CAMPOS) {
      const valor = o[json]
      if (typeof valor !== 'string' || !valor.trim()) throw new OfertaInvalida(`Oferta "${id}": falta "${json}".`)
      lida[ts] = valor
    }
    if (!TIPOS.has(lida.tipo)) throw new OfertaInvalida(`Oferta "${id}": tipo "${lida.tipo}" desconhecido (o TS só sabe tratar ${[...TIPOS].join(', ')}).`)
    if (!/^prumo--[a-z0-9-]+$/.test(lida.sala)) throw new OfertaInvalida(`Oferta "${id}": a sala é um domínio da squad PRUMO ("prumo--<slug>").`)
    if (!/^planilha[A-Z][A-Za-z0-9]*$/.test(lida.linkRetrato)) throw new OfertaInvalida(`Oferta "${id}": link_retrato é "planilha<Nome>".`)
    if (lida.linkRetrato === 'planilhaSite' || lida.linkRetrato === 'planilhaPrumo' || lida.linkRetrato === 'planilhaCrm') {
      throw new OfertaInvalida(`Oferta "${id}": link_retrato "${lida.linkRetrato}" já é de outra fonte.`)
    }
    if (!lida.mensagem.includes('{OLA}') || !lida.mensagem.includes('{NOME}')) throw new OfertaInvalida(`Oferta "${id}": a mensagem precisa de {OLA} e {NOME}.`)
    lidas.push(lida)
  }
  if (!lidas.length) throw new OfertaInvalida('prumo-ofertas.json sem nenhuma oferta.')
  for (const campo of ['sigla', 'rotulo', 'aba', 'sala', 'fonte', 'linkRetrato'] as const) {
    const vistos = new Map<string, string>()
    for (const o of lidas) {
      const chave = o[campo].trim().toLowerCase()
      const outro = vistos.get(chave)
      if (outro) throw new OfertaInvalida(`Ofertas "${outro}" e "${o.id}" com o mesmo ${campo} ("${o[campo]}").`)
      vistos.set(chave, o.id)
    }
  }
  return lidas
}

/** O conteúdo de server/ofertas.gerado.ts. Determinístico: mesma entrada, mesmo texto (o teste compara byte a byte). */
export function gerarOfertas(config: unknown): string {
  const ofertas = lerOfertas(config)
  const s = (v: string) => JSON.stringify(v)
  const linhas: string[] = [
    '// GERADO de deploy/dell/claude-ops/prumo-ofertas.json. Não editar.',
    '// Mudou o JSON: npx tsx scripts/ofertas-gerar.ts (server/ofertas.test.ts falha se este arquivo ficar para trás).',
    '// O que a oferta faz além destes campos (preço, ficha, textos do Plus) continua no código; ver server/ofertas.ts.',
    '',
    '/** As ofertas próprias do PRUMO, na ordem do JSON. */',
    `export const OFERTAS_PROPRIAS = [${ofertas.map((o) => s(o.id)).join(', ')}] as const;`,
    'export type OfertaPropria = (typeof OFERTAS_PROPRIAS)[number];',
    '',
    'export interface DadosDaOferta {',
  ]
  for (const [ts, json, doc] of CAMPOS) {
    const tipo = ts === 'tipo' ? '"propria"' : ts === 'sala' ? '`prumo--${string}`' : ts === 'linkRetrato' ? '`planilha${string}`' : 'string'
    linhas.push(`  /** ${doc} JSON: \`${json}\`. */`, `  readonly ${ts}: ${tipo};`)
  }
  linhas.push('}', '', 'export const OFERTA = {')
  for (const o of ofertas) {
    linhas.push(`  ${o.id}: {`)
    for (const [ts] of CAMPOS) linhas.push(`    ${ts}: ${s(o[ts])},`)
    linhas.push('  },')
  }
  linhas.push('} as const satisfies Record<OfertaPropria, DadosDaOferta>;', '')
  return linhas.join('\n')
}
