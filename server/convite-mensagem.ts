import { primeiraComEventoCriticoDoPrumo } from './prumo-mensagem.ts'
import type { eventoCriticoDe } from './site-mensagem.ts'
import { OFERTA, ehOfertaPropria } from './ofertas.ts'

export class ConviteDesconhecido extends Error {
  constructor(produto: string) {
    super(`Sem convite aprovado para o produto "${produto}" (prumo-ofertas.json ou prumo-simples.py).`)
    this.name = 'ConviteDesconhecido'
  }
}

/**
 * Textos aprovados em prumo-simples.py (PRUMO) e prumo-ofertas.json (ofertas próprias, pelo server/ofertas.gerado.ts).
 * Só monta o rascunho. Produto sem convite conhecido LANÇA: cair calado no texto da consultoria mandaria a
 * oferta errada pelo wa.me (era o caso de uma oferta nova antes de 28/10/2026).
 */
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
  // Função na troca: um "$&" no nome da empresa não pode virar padrão de substituição.
  if (ehOfertaPropria(produto)) return OFERTA[produto].mensagem.replaceAll('{OLA}', () => ola).replaceAll('{NOME}', () => nome)
  if (produto !== 'prumo') throw new ConviteDesconhecido(produto)
  const seg = segmento.trim().toLowerCase()
  const distribuidora = /^distribuidoras? /.test(seg)
  const areas = !distribuidora ? 'de preço, prazo e atendimento' : /autope/.test(seg) ? 'de orçamento, preço e compras' : /constru/.test(seg) ? 'de preço, desconto e crédito' : /aliment|bebida/.test(seg) ? 'de preço, prazo e cobrança' : 'de preço, crédito e entregas'
  return `${ola}! Sou o Rômulo, do Prumo. Ajudo empresas a organizar regras ${areas} para a equipe consultar no dia a dia.\n\nPosso te mostrar um exemplo ilustrativo de como essas regras ficam organizadas?`
}
