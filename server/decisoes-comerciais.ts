import type { Router } from 'express'
import type { CrmVisao } from '../src/operations/types.ts'
import { hashDoContexto } from '../src/operations/revisao-resposta.ts'
import { aberturaConfirmadaDoLead, baseDaClassificacao, PREFIXO_CLASSIFICACAO, PREFIXO_CONVITE, ultimoConviteConfirmado } from '../src/operations/decisoes-comerciais.ts'

/** Usa as notas da aba CRM existente: revisão humana, sem novo banco ou envio de mensagem. */
export function montarDecisoesComerciais(router: Router, crm?: { visao(): Promise<CrmVisao>; registrar(entrada: unknown): Promise<unknown> }) {
  const consumidos = new Map<string, number>()
  router.post('/crm/decisao/confirmar', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const { leadId, contextoHash, tipo, decisao, motivo, mensagem, enviadoEm } = req.body ?? {}
    if (typeof leadId !== 'string' || leadId.length > 300 || typeof contextoHash !== 'string' || !/^[a-f0-9]{64}$/.test(contextoHash) || !['classificacao', 'convite'].includes(tipo)) {
      res.status(400).json({ error: 'Confira o cliente e revise a decisão antes de confirmar.' }); return
    }
    if (!crm) { res.status(503).json({ error: 'Registro de Vendas indisponível.' }); return }
    for (const [k, em] of consumidos) if (Date.now() - em > 15 * 60_000) consumidos.delete(k)
    const chave = JSON.stringify([leadId, contextoHash, tipo])
    if (consumidos.has(chave)) { res.status(409).json({ error: 'Esta confirmação já foi solicitada. Atualize Vendas e confira o histórico antes de repetir.' }); return }
    consumidos.set(chave, Date.now())
    let gravando = false
    try {
      const visao = await crm.visao()
      const lead = visao.leads.find(l => l.id === leadId)
      if (visao.estado !== 'ok' || !lead || await hashDoContexto(lead) !== contextoHash) {
        consumidos.delete(chave); res.status(409).json({ error: 'O contexto mudou. Atualize Vendas e revise novamente.' }); return
      }
      let texto: string
      if (tipo === 'classificacao') {
        if ((!lead.revisaoComercial && lead.etapa !== 'perdido' && lead.etapa !== 'ganho') || !['reabrir', 'manter'].includes(decisao) || typeof motivo !== 'string' || !motivo.trim() || motivo.length > 200) {
          consumidos.delete(chave); res.status(400).json({ error: 'Escolha a classificação e descreva o motivo da revisão em até 200 caracteres.' }); return
        }
        texto = PREFIXO_CLASSIFICACAO + JSON.stringify({ base: baseDaClassificacao(lead), decisao, motivo: motivo.trim() })
      } else {
        const em = typeof enviadoEm === 'string' ? Date.parse(enviadoEm) : NaN
        if (!['prumo', 'iris', 'estampa'].includes(lead.produto) || lead.etapa !== 'novo' || lead.sinal !== 'revisar' || ultimoConviteConfirmado(lead.eventos) || typeof mensagem !== 'string' || !mensagem.trim() || mensagem.length > 600 || !Number.isFinite(em) || em > Date.now() + 60_000 || (lead.desde && em < Date.parse(lead.desde))) {
          consumidos.delete(chave); res.status(400).json({ error: 'Confirme o conteúdo e o horário real do convite enviado. O contato precisa estar na triagem.' }); return
        }
        const abertura = aberturaConfirmadaDoLead(lead, mensagem)
        texto = PREFIXO_CONVITE + JSON.stringify({ enviadoEm: new Date(em).toISOString(), mensagem: mensagem.trim(), ...(abertura ? { abertura } : {}) })
      }
      if (texto.length > 1000) { consumidos.delete(chave); res.status(400).json({ error: 'Reduza o motivo ou o conteúdo do registro.' }); return }
      gravando = true
      const resultado = await crm.registrar({ produto: lead.produto, id: lead.chave, tipo: 'nota', texto, data: '' })
      res.status(201).json({ ok: true, resultado })
    } catch {
      if (!gravando) consumidos.delete(chave)
      res.status(503).json({ error: gravando ? 'O resultado da gravação não foi confirmado. Atualize Vendas e confira o histórico antes de repetir.' : 'Não foi possível conferir Vendas agora.', incerto: gravando })
    }
  })
}
