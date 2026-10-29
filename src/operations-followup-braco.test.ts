import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FOLLOWUP_NOVO, lerRegistroFollowup, metadataDoFollowup } from './operations/followup-experimento.ts'
import { acaoDoLead, followupDoBraco, textoDaAnotacaoDeVenda, textoDoLink, trocarTextoDoLink } from './operations/proxima-venda.ts'

// Só fixtures: nenhuma planilha, WhatsApp ou servidor real. O que se fixa aqui: o texto mostrado, o texto
// do wa.me que se abre e o braço gravado saem da MESMA decisão (antes o B era o texto antigo etiquetado).
const AGORA = Date.parse('2026-10-19T15:00:00Z')
const iso = (dia: string) => dia + 'T15:00:00.000Z'
const CONTROLE = 'Oi, é o Rômulo de novo. Mensagem antiga de controle?'

/** Chave de lead do produto que cai no braço pedido (o sorteio é por hash fixo de `produto:id`). */
function chaveDoBraco(produto: 'site' | 'prumo', braco: 'A' | 'B'): string {
  for (let i = 0; i < 500; i++) {
    if (metadataDoFollowup(produto, `${produto}:k${i}`).braco === braco) return `k${i}`
  }
  throw new Error('sem chave para o braço')
}

function leadComFollowup(produto: 'site' | 'prumo', chave: string, numero = '5511999990000', empresa = 'Pousada do Mar') {
  const url = `https://wa.me/${numero}?text=${encodeURIComponent(CONTROLE)}`
  const lead = {
    id: `${produto}:${chave}`, chave, produto, empresa, nicho: 'pousada', cidade: '', etapa: 'contato', sinal: 'enviado', subEtapa: '',
    estadoNaPlanilha: 'enviado', leitura: 'desconhecida', marcos: { enviado: iso('2026-10-15') }, followupHoje: true, respostaNova: false,
    acervo: false, notas: 0, eventos: [], conversa: { desde: iso('2026-10-15'), mensagens: 1, ultima: { direcao: 'saida', em: iso('2026-10-15'), trecho: 'Primeira mensagem' } }, links: { whatsapp: `https://wa.me/${numero}`, followup: url }, divergencias: [],
  } as any
  const visao = { estado: 'ok', leads: [lead], hoje: [{ id: 'followup', titulo: '', explicacao: '', itens: [{ leadId: lead.id, acao: '', detalhe: '', ordem: 1, links: [{ rotulo: 'Follow-up', url }] }] }] } as any
  return { lead, visao }
}

describe('follow-up: o braço sorteado é o texto mostrado, aberto e gravado', () => {
  it('braço A: o controle intacto, link igual, registro A', () => {
    const { lead, visao } = leadComFollowup('site', chaveDoBraco('site', 'A'))
    const acao = acaoDoLead(visao, lead.id, AGORA)!
    assert.equal(acao.tipo, 'followup')
    assert.equal(acao.rascunho, CONTROLE)
    assert.equal(acao.link!.url, lead.links.followup)
    assert.equal(lerRegistroFollowup(acao.textoDoRegistro!)?.braco, 'A')
  })

  it('braço B: o texto novo no rascunho E no wa.me, e o registro diz B (antes o antigo saía como B)', () => {
    const { lead, visao } = leadComFollowup('site', chaveDoBraco('site', 'B'))
    const acao = acaoDoLead(visao, lead.id, AGORA)!
    const esperado = FOLLOWUP_NOVO.site.semFato.replace('{EMPRESA}', 'Pousada do Mar')
    assert.equal(acao.rascunho, esperado)
    assert.equal(textoDoLink(acao.link!.url), esperado, 'o que o WhatsApp abre é o que a tela mostra')
    assert.ok(acao.link!.url.startsWith('https://wa.me/5511999990000?text='))
    assert.equal(lerRegistroFollowup(acao.textoDoRegistro!)?.braco, 'B')
    assert.doesNotMatch(acao.rascunho!, /R\$/)
  })

  it('PRUMO no braço B usa o molde do PRUMO', () => {
    const { lead, visao } = leadComFollowup('prumo', chaveDoBraco('prumo', 'B'))
    const acao = acaoDoLead(visao, lead.id, AGORA)!
    assert.equal(acao.rascunho, FOLLOWUP_NOVO.prumo.semFato)
    assert.equal(lerRegistroFollowup(acao.textoDoRegistro!)?.braco, 'B')
  })

  it('número dos EUA fica no controle e sem versão: não entra em braço nenhum (o texto novo só existe em português)', () => {
    const { lead, visao } = leadComFollowup('site', chaveDoBraco('site', 'B'), '12125550100')
    const acao = acaoDoLead(visao, lead.id, AGORA)!
    assert.equal(acao.rascunho, CONTROLE)
    assert.equal(acao.link!.url, lead.links.followup)
    assert.equal(acao.textoDoRegistro, undefined)
  })

  it('reenvio do só-robô não vira teste: o texto e o link seguem os do servidor, sem registro de braço', () => {
    const { lead, visao } = leadComFollowup('site', chaveDoBraco('site', 'B'))
    lead.reenvioDoRobo = true
    const acao = acaoDoLead(visao, lead.id, AGORA)!
    assert.equal(acao.rascunho, CONTROLE)
    assert.equal(acao.textoDoRegistro, undefined)
  })

  it('followupDoBraco sem texto no link devolve o link e nada de registro', () => {
    const lead = { id: 'site:x', produto: 'site' as const, empresa: 'X' }
    const r = followupDoBraco(lead, { rotulo: 'Conversa', url: 'https://wa.me/5511999990000' })
    assert.deepEqual(r, { link: { rotulo: 'Conversa', url: 'https://wa.me/5511999990000' }, rascunho: '' })
  })

  it('trocarTextoDoLink troca só o text e conserva o resto; link fora do WhatsApp volta igual', () => {
    assert.equal(trocarTextoDoLink('https://wa.me/5511?text=velho&app_absent=1', 'novo texto?'), 'https://wa.me/5511?app_absent=1&text=novo%20texto%3F')
    assert.equal(trocarTextoDoLink('https://exemplo.com/?text=velho', 'novo'), 'https://exemplo.com/?text=velho')
  })
})

describe('o "Enviei" da tela de conversas manda o registro de cada tipo', () => {
  it('proposta leva o resumo; cadência, follow-up e indicação, o registro versionado; o resto, vazio', () => {
    assert.equal(textoDaAnotacaoDeVenda({ anota: 'proposta', rascunho: 'x'.repeat(1500) }).length, 1000)
    assert.equal(textoDaAnotacaoDeVenda({ anota: 'proposta' }), '')
    for (const anota of ['cadencia_enviada', 'followup_enviado', 'indicacao_pedida'] as const) {
      assert.equal(textoDaAnotacaoDeVenda({ anota, rascunho: 'mensagem', textoDoRegistro: `[registro de ${anota}]` }), `[registro de ${anota}]`, anota)
      assert.equal(textoDaAnotacaoDeVenda({ anota, rascunho: 'mensagem' }), '', `${anota} sem registro não inventa`)
    }
    assert.equal(textoDaAnotacaoDeVenda({ anota: 'segunda_enviada', rascunho: 'mensagem', textoDoRegistro: 'r' }), '')
    assert.equal(textoDaAnotacaoDeVenda({ rascunho: 'mensagem', textoDoRegistro: 'r' }), '')
  })

  it('o follow-up da fila chega com o registro do braço, e é ele que a tela de conversas manda', () => {
    const { lead, visao } = leadComFollowup('site', chaveDoBraco('site', 'B'))
    const acao = acaoDoLead(visao, lead.id, AGORA)!
    assert.equal(lerRegistroFollowup(textoDaAnotacaoDeVenda(acao))?.braco, 'B')
  })
})
