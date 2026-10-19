import type { Router } from 'express'
import type { CrmVisao } from '../src/operations/types.ts'
import { hashDoContexto } from '../src/operations/revisao-resposta.ts'
import { ajusteDoPasso } from '../src/operations/ajuste-do-passo.ts'

/** Conferência de contexto e ajuste humano do plano; nunca gera ou envia mensagens. */
export function montarRevisaoDeResposta(router: Router, crm?: { visao(): Promise<CrmVisao>; registrar?(entrada: unknown): Promise<unknown> }) {
  // Bloqueia concorrência e repetição enquanto a planilha ainda publica o retrato anterior.
  const consumidos = new Map<string, number>()
  router.post('/crm/proximo-passo/ajustar', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const { produto, id, contextoHash, acao, texto, data } = req.body ?? {}
    if (typeof id !== 'string' || id.length > 300 || !['site', 'prumo', 'iris', 'estampa', 'plus'].includes(produto) || typeof contextoHash !== 'string' || !/^[a-f0-9]{64}$/.test(contextoHash)) { res.status(400).json({ error: 'Confira o lead e atualize o contexto.' }); return }
    if (!crm?.registrar) { res.status(503).json({ error: 'Registro indisponível.' }); return }
    let ajuste
    try { ajuste = ajusteDoPasso(acao, texto, data) } catch (e) { res.status(400).json({ error: (e as Error).message }); return }
    for (const [chave, em] of consumidos) if (Date.now() - em > 15 * 60_000) consumidos.delete(chave)
    const chave = JSON.stringify([produto, id, contextoHash])
    if (consumidos.has(chave)) { res.status(409).json({ error: 'Este contexto já foi confirmado ou está em conferência. Atualize a leitura e confira o histórico antes de repetir.' }); return }
    consumidos.set(chave, Date.now())
    let iniciouGravacao = false
    try {
      const visao = await crm.visao()
      const lead = visao.leads.find(l => l.id === id && l.produto === produto)
      if (visao.estado !== 'ok' || !lead?.proximoPasso?.texto.trim() || lead.etapa === 'ganho' || lead.etapa === 'perdido' || await hashDoContexto(lead) !== contextoHash) {
        consumidos.delete(chave); res.status(409).json({ error: 'O contexto mudou ou o passo não está mais ativo. Atualize a leitura e revise novamente.' }); return
      }
      iniciouGravacao = true
      const resultado = await crm.registrar({ ...ajuste, produto, id: lead.chave, empresa: lead.empresa })
      res.status(201).json({ ok: true, resultado })
    } catch {
      if (!iniciouGravacao) consumidos.delete(chave)
      res.status(503).json({ error: iniciouGravacao ? 'Não foi possível confirmar o resultado. Confira o histórico antes de repetir.' : 'Não foi possível conferir Vendas agora.' })
    }
  })
  router.get('/crm/resposta/contexto', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const produto = typeof req.query.produto === 'string' ? req.query.produto : ''
    const id = typeof req.query.id === 'string' ? req.query.id : ''
    if (!['site', 'prumo', 'iris', 'estampa', 'plus'].includes(produto) || !id || id.length > 300) { res.status(400).json({ error: 'Lead inválido.' }); return }
    if (!crm) { res.status(503).json({ error: 'Vendas não está disponível.' }); return }
    try {
      const visao = await crm.visao()
      if (visao.estado !== 'ok') { res.status(503).json({ error: 'Sem leitura atual de Vendas.' }); return }
      const lead = visao.leads.find(l => l.id === id && l.produto === produto)
      if (!lead) { res.status(404).json({ error: 'Lead indisponível na leitura atual.' }); return }
      res.json({ contextoHash: await hashDoContexto(lead), whatsapp: lead.links.whatsapp ?? null, geradoEm: visao.geradoEm ?? null })
    } catch { res.status(503).json({ error: 'Não foi possível conferir o contexto agora.' }) }
  })
}
