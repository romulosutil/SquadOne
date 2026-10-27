import { primeiraComEventoCriticoDoPrumo } from './prumo-mensagem.ts'
import type { eventoCriticoDe } from './site-mensagem.ts'
/** Textos aprovados em prumo-simples.py e prumo-ofertas.json. Só monta o rascunho. */
export function mensagemDoConvite(produto: string, empresa: string, segmento: string, agora: Date, abertura?: { variante: 'A' | 'D'; raioX: Parameters<typeof eventoCriticoDe>[0]; aprovado: boolean }): string {
  if (produto === 'prumo' && abertura?.variante === 'D') {
    const candidata = primeiraComEventoCriticoDoPrumo(empresa, abertura.raioX, abertura.aprovado)
    if (candidata) return candidata
  }
  let nome = empresa.trim()
  for (let i = 0; i < 2; i++) nome = nome.replace(/[\s,.-]+(ltda|me|epp|eireli|s\.?\/?a\.?)\.?$/i, '').trim()
  if (nome === nome.toUpperCase() && /\p{Lu}{4}/u.test(nome)) nome = nome.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/ (D[aeo]s?|E|Para|Em) /g, m => m.toLowerCase())
  nome ||= 'empresa'
  const hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(agora))
  const ola = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
  if (produto === 'iris') return `${ola}! Sou o Rômulo, do Prumo. O Iris organiza as anotações das sessões para apoiar a preparação dos relatórios de reavaliação.\n\nPosso te mostrar um exemplo com dados fictícios para a equipe da ${nome}?`
  if (produto === 'estampa') return `${ola}! Sou o Rômulo, do Prumo. Trabalho com um sistema de pedidos para estamparias que reúne arte, tamanhos e prazo em uma ficha para a produção.\n\nPosso te mostrar uma ficha de exemplo para a equipe da ${nome}, sem dados de clientes?`
  const seg = segmento.trim().toLowerCase()
  const distribuidora = /^distribuidoras? /.test(seg)
  const publico = distribuidora ? seg.replace(/^distribuidoras? /, 'distribuidoras ') : 'empresas como a de vocês'
  const areas = !distribuidora ? 'de preço, prazo e atendimento' : /autope/.test(seg) ? 'de orçamento, preço e compras' : /constru/.test(seg) ? 'de preço, desconto e crédito' : /aliment|bebida/.test(seg) ? 'de preço, prazo e cobrança' : 'de preço, crédito e entregas'
  return `${ola}! Sou o Rômulo, do Prumo. Ajudo empresas a organizar regras ${areas} para a equipe consultar no dia a dia.\n\nPosso te mostrar um exemplo ilustrativo de como essas regras ficam organizadas?`
}
