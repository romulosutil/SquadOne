/** Consome a API por stdin e emite apenas agregados; não persiste conversas ou contatos. */
import { projetarCarteiraCrm } from '../src/operations/carteira-crm.ts'
import type { CrmVisao } from '../src/operations/types.ts'

let corpo = ''
for await (const chunk of process.stdin) {
  corpo += chunk
  if (Buffer.byteLength(corpo) > 64 * 1024 * 1024) throw new Error('Retrato excede o limite da auditoria.')
}
let visao: CrmVisao
try { visao = JSON.parse(corpo) } catch { throw new Error('A consulta não retornou um retrato JSON válido.') }
if (visao.estado !== 'ok' || !Array.isArray(visao.leads)) throw new Error('Fonte indisponível; nenhuma contagem foi afirmada.')
const agora = Date.now(), gerado = Date.parse(visao.geradoEm ?? '')
if (!Number.isFinite(gerado) || agora - gerado > 60 * 60_000 || gerado > agora) throw new Error('Retrato fora da janela da auditoria.')
const carteira = projetarCarteiraCrm(visao.leads, agora)
console.log(JSON.stringify({ consultadoEm: new Date(agora).toISOString(), retratoEm: visao.geradoEm,
  fonte: 'GET somente leitura da API local do Dell, projetado pelo módulo novo no PC; sem persistência de dados de contato.',
  contagens: carteira.contagens, cobertura: carteira.cobertura,
  limites: ['Projeção em memória no PC; não comprova publicação do módulo no Dell.',
    'Contas provisórias não são empresas únicas.', 'Marcos são registros confirmados, não auditoria de vendas externas nem taxa causal de conversão.'],
}, null, 2))
