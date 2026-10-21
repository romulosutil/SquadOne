import type { Router } from 'express'
import type { CrmVisao } from '../src/operations/types.ts'
import { procedimentoDaDecisao } from '../src/office/procedimento-da-decisao.ts'
import { acaoDoLead } from '../src/operations/proxima-venda.ts'
import { hashDoContexto, impedimentoDaMensagem, linkDoRaioXParaMensagem } from '../src/operations/revisao-resposta.ts'
import { copilotoServe } from '../src/operations/copiloto.ts'
import type { Copiloto } from './copiloto.ts'

export function montarMensagemDaDecisao(router: Router, op: { crm?: { visao(): Promise<CrmVisao> }; copiloto?: Pick<Copiloto, 'ler' | 'sugerir'> | null }) {
  router.post('/crm/decisao/mensagem', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const { produto, id, contextoHash } = req.body ?? {}
    if (!['site', 'prumo', 'iris', 'plus', 'estampa'].includes(produto) || typeof id !== 'string' || !id || id.length > 300 || typeof contextoHash !== 'string' || !/^[a-f0-9]{64}$/.test(contextoHash)) return void res.status(400).json({ error: 'Confira o cliente e atualize a leitura.' })
    if (!op.crm) return void res.status(503).json({ error: 'Vendas está indisponível.' })
    try {
      const visao = await op.crm.visao()
      const lead = visao.leads.find(l => l.id === id && l.produto === produto)
      if (visao.estado !== 'ok' || !lead) return void res.status(503).json({ error: 'Não há leitura atual deste cliente.' })
      if (await hashDoContexto(lead) !== contextoHash) return void res.status(409).json({ error: 'A conversa mudou. Atualize o contexto antes de preparar a mensagem.' })
      const procedimento = procedimentoDaDecisao(lead)
      const base = { contextoHash, procedimento, mensagem: procedimento.mensagem ?? null, origem: procedimento.mensagem ? 'procedimento' : null, podeAbrir: false, acao: null }
      // Robô, espera, áudio desconhecido e desfecho não são oportunidades para inventar uma oferta.
      if (!['humano', 'recepcao'].includes(procedimento.tipo)) return void res.json(base)
      let sugestao = op.copiloto && copilotoServe(lead) ? await op.copiloto.ler(produto, id) : null
      const paraFila = () => sugestao ? { mensagem: sugestao.sugestao.mensagem, porque: sugestao.sugestao.porque, quando: sugestao.quando, momento: sugestao.sugestao.momento } : undefined
      let acao = acaoDoLead(visao, id, Date.now(), paraFila())
      if (acao?.conferirHistorico || acao?.primeiroContato || acao?.tipo === 'desfecho') return void res.json({ ...base, acao, motivo: acao.tatica })
      if (!acao && lead.conversa?.ultima.direcao !== 'entrada') return void res.json({ ...base, motivo: 'Aguarde a resposta ou a data do próximo passo. Não há uma ação de contato pendente nesta leitura.' })
      // Um texto padrão preenchido não substitui uma leitura da conversa atual.
      if (!sugestao && op.copiloto && copilotoServe(lead)) {
        sugestao = await op.copiloto.sugerir(produto, id)
        acao = acaoDoLead(visao, id, Date.now(), paraFila())
      }
      let mensagem = sugestao?.sugestao.mensagem ?? acao?.rascunho ?? ''
      if (sugestao && acao?.anota) {
        const { anota: _anota, ...semConfirmacaoPadrao } = acao
        acao = semConfirmacaoPadrao
      }
      const material = linkDoRaioXParaMensagem(lead.links.raioX)
      if (material) mensagem = mensagem.replace(/\[link(?: do raio-x)?\]/gi, material)
      const motivo = impedimentoDaMensagem(mensagem)
      // Revalida depois de aguardar o modelo: nenhuma sugestão atravessa uma mensagem nova.
      const releitura = await op.crm.visao()
      const atual = releitura.leads.find(l => l.id === id && l.produto === produto)
      if (releitura.estado !== 'ok' || !atual || await hashDoContexto(atual) !== contextoHash) return void res.status(409).json({ error: 'Chegou um novo contexto durante o preparo. Atualize para preparar novamente.' })
      res.json({ ...base, acao, leitura: sugestao?.sugestao.momento?.leitura, porque: sugestao?.sugestao.porque, proximaAcao: sugestao?.sugestao.momento?.passo, mensagem: motivo ? null : mensagem, origem: motivo ? null : sugestao ? 'copiloto' : 'fila', podeAbrir: !motivo, ...(motivo ? { motivo: 'O contexto ainda não permite preparar uma mensagem completa. Confira os dados ou o material na ficha.' } : {}) })
    } catch { res.status(503).json({ error: 'Não foi possível preparar a mensagem com o contexto atual. Tente novamente ou confira a ficha.' }) }
  })
}
