// PURO: as ofertas próprias do PRUMO (Iris, CRM de estamparia, as próximas) como o resto do código as usa
// (28/10/2026). Os dados vêm de server/ofertas.gerado.ts, gerado de deploy/dell/claude-ops/prumo-ofertas.json;
// importável do servidor e da SPA (sem fs, sem env). Oferta nova: bloco no JSON, `npx tsx scripts/ofertas-gerar.ts`,
// e o vue-tsc aponta o que ainda é específico (ops/n8n/NOVA-OFERTA.md).
//
// O que é de UMA oferta só (faixas de preço do Iris, ficha e atendimento da estamparia, textos maçônicos do
// Plus) continua escrito para aquela oferta: não generalize por aqui.
import { OFERTA, OFERTAS_PROPRIAS, type DadosDaOferta, type OfertaPropria } from './ofertas.gerado.ts'

export { OFERTA, OFERTAS_PROPRIAS }
export type { DadosDaOferta, OfertaPropria }

/** A chave do link da aba de cada oferta própria em CrmRetrato.links (planilhaIris, planilhaEstampa, …). */
export type LinkDaOfertaPropria = (typeof OFERTA)[OfertaPropria]['linkRetrato']

/**
 * Oferta própria = caminho curto: sem Raio-X nem Mapa, sem cardápio do PRUMO, o interesse vira "combinar a
 * demonstração". Era `produto === 'iris' || produto === 'estampa'` em uma dúzia de lugares.
 */
export const ehOfertaPropria = (produto: unknown): produto is OfertaPropria =>
  (OFERTAS_PROPRIAS as readonly unknown[]).includes(produto)

// "plus" (15/10/2026): os leads do Catálogo de Negócios Maçônicos, abordados com a saudação da Ordem. Não é
// uma oferta: cada um carrega a oferta que recebe em `plus.oferta`. Vem de um arquivo (plus/leads.json), não de
// planilha; o estado dele sai só dos registros da aba CRM.
/** Os produtos do CRM. A união continua literal, e o TS cobra todo Record<CrmProduto, …> sem a oferta nova. */
export const PRODUTOS = ['site', 'prumo', ...OFERTAS_PROPRIAS, 'plus'] as const
export type CrmProduto = (typeof PRODUTOS)[number]
/** As ofertas que saem de uma aba no formato do Prospects (Etapa, convite, WhatsApp publicado no site). */
export const PRODUTOS_DE_PROSPECCAO = ['prumo', ...OFERTAS_PROPRIAS] as const
export type CrmProdutoDeProspeccao = (typeof PRODUTOS_DE_PROSPECCAO)[number]
/** A validação de `produto` em toda rota e leitura: era uma lista copiada em dez lugares. */
export const ehProduto = (valor: unknown): valor is CrmProduto => (PRODUTOS as readonly unknown[]).includes(valor)
export const ehProdutoDeProspeccao = (valor: unknown): valor is CrmProdutoDeProspeccao =>
  (PRODUTOS_DE_PROSPECCAO as readonly unknown[]).includes(valor)

/** Um valor por oferta própria, na ordem do JSON: `{ iris: f('iris'), estampa: f('estampa') }`. */
export function porOferta<T>(f: (id: OfertaPropria, oferta: (typeof OFERTA)[OfertaPropria]) => T): Record<OfertaPropria, T> {
  return Object.fromEntries(OFERTAS_PROPRIAS.map((id) => [id, f(id, OFERTA[id])])) as Record<OfertaPropria, T>
}
