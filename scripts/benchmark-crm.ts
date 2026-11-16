/** Dados sintéticos, sem rede ou disco de produção. Rodar com: npx tsx scripts/benchmark-crm.ts */
import { performance } from 'node:perf_hooks'
import { montarCrm, validarRetrato } from '../server/crm.ts'
import { pendenciasDaJornada } from '../src/office/jornada-do-escritorio.ts'
import { conversasParaConduzir } from '../src/operations/conversas-para-conduzir.ts'
import { filaDaTela } from '../src/operations/proxima-venda.ts'

const agora = new Date('2026-10-26T15:00:00Z')
const linhas = Array.from({ length: 1000 }, (_, i) => ({
  place_id: `sintetico-${i}`, nome: `Empresa sintética ${i}`, vertical: 'serviços', cidade: 'São Paulo',
  status: i % 3 ? 'enviado' : 'pronto', criado_em: '2026-10-01T15:00:00Z',
  enviado_em: i % 3 ? '2026-10-23T15:00:00Z' : '', site_url: `https://example.com/${i}`,
  wa_me: `https://wa.me/55119888${String(i).padStart(4, '0')}`,
}))
const retrato = validarRetrato({ versao: 1, geradoEm: agora.toISOString(), fontes: {
  site: { planilha: 'Sintética', aba: 'Leads', colunas: Object.keys(linhas[0]), linhas },
  prumo: { planilha: 'Sintética', aba: 'Prospects', colunas: [], linhas: [] },
  registros: { planilha: 'Sintética', aba: 'CRM', colunas: [], linhas: [] },
}})

for (const etapa of ['servidor', 'escritorio'] as const) {
  const visao = montarCrm(retrato, { agora })
  const tempos: number[] = []
  for (let i = 0; i < 6; i++) {
    const inicio = performance.now()
    if (etapa === 'servidor') montarCrm(retrato, { agora })
    else {
      const fila = filaDaTela(visao, { agora: agora.getTime() }, {})
      conversasParaConduzir(visao.leads, agora.getTime())
      pendenciasDaJornada(visao.leads, fila.filter(a => !a.primeiroContato), agora.getTime())
    }
    if (i) tempos.push(performance.now() - inicio)
  }
  tempos.sort((a, b) => a - b)
  console.log(`${etapa}: ${visao.leads.length} leads, mediana ${tempos[2].toFixed(1)} ms (5 amostras após aquecimento)`)
}
