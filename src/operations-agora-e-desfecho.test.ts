import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  acaoDoLead, agoraDaFicha, desfechosDoLead, filaDeVenda, fraseDaAcao, linkDoPasso,
  type ContextoDaVenda, type TipoDeVenda,
} from './operations/proxima-venda.ts'
import type { CrmGrupoHojeId, CrmItemHoje, CrmLead, CrmVisao } from './operations/types.ts'

// A Ficha de 17/10/2026 (auditoria da Central): uma frase por passo, a mesma no cartão da Próxima
// venda e no "Agora" da Ficha (AC-12); o link do passo escolhido pelo tipo (AC-05); o desfecho em um
// toque com o desfazer certo (AC-08); e a 2ª mensagem e o follow-up anotados à mão (AC-09).
// Tudo fixture: nenhum retrato real.

const AGORA = Date.parse('2026-10-14T13:00:00Z') // quarta, 10:00 em São Paulo
const LIVRE: ContextoDaVenda = { primeiroLiberado: true, agora: AGORA }
const WA = 'https://wa.me/5527999990000'
const N8N = 'https://n8n.exemplo/webhook'

function lead(id: string, extra: Partial<CrmLead> = {}): CrmLead {
  return {
    id, chave: id, empresa: `Empresa ${id}`, produto: 'site', nicho: 'pilates', cidade: 'Vitória', etapa: 'novo', sinal: 'pronto',
    subEtapa: '', estadoNaPlanilha: '', leitura: 'desconhecida', followupHoje: false, respostaNova: false, acervo: false,
    notas: 0, eventos: [], divergencias: [], links: {}, marcos: {}, ...extra,
  } as CrmLead
}

type Itens = Partial<Record<CrmGrupoHojeId, Array<Pick<CrmItemHoje, 'leadId'> & Partial<CrmItemHoje>>>>
function visao(itens: Itens, leads: CrmLead[]): CrmVisao {
  return {
    estado: 'ok', leads,
    hoje: Object.entries(itens).map(([id, lista]) => ({
      id, titulo: id, explicacao: '',
      itens: (lista ?? []).map((i, ordem) => ({ acao: 'Fazer', detalhe: '', ordem, links: [], ...i })),
    })),
  } as unknown as CrmVisao
}

describe('fraseDaAcao: uma frase por tipo de ação (AC-12)', () => {
  const base = lead('a', { empresa: 'Studio L' })
  const casos: Array<[string, TipoDeVenda, Partial<CrmLead>, string]> = [
    ['responder, resposta aberta', 'responder', { resposta: { tipo: 'neutra' } as CrmLead['resposta'] }, 'Responda a Studio L'],
    ['responder, disse sim com o link pronto', 'responder', { resposta: { tipo: 'interesse' } as CrmLead['resposta'], links: { segunda: `${WA}?text=oi` } }, 'Studio L disse sim: mande o link'],
    ['responder, disse sim sem demo', 'responder', { resposta: { tipo: 'interesse' } as CrmLead['resposta'], links: { gerarDemo: `${N8N}/gerar_demo` } }, 'Studio L disse sim: gere o demo e avise que já vai'],
    ['responder, disse sim no PRUMO', 'responder', { produto: 'prumo', resposta: { tipo: 'interesse' } as CrmLead['resposta'] }, 'Studio L disse sim: mande o Raio-X'],
    ['responder, quer saber mais no Iris', 'responder', { produto: 'iris', resposta: { tipo: 'interesse' } as CrmLead['resposta'] }, 'Studio L disse sim: combine a demonstração'],
    // 17/10/2026 (a Baobá): a licença não é "disse sim", e com a última mensagem nossa nunca se afirma o sim.
    ['responder, licença para mandar o material', 'responder', { produto: 'iris', resposta: { tipo: 'licenca' } as CrmLead['resposta'] }, 'Mande para Studio L o que ele autorizou'],
    ['responder, licença e a última mensagem é sua', 'responder', { produto: 'iris', resposta: { tipo: 'licenca' } as CrmLead['resposta'],
      conversa: { desde: '', mensagens: 3, ultima: { direcao: 'saida', em: '', trecho: 'já já mando' } } }, 'Você já respondeu a Studio L; falta mandar o que ele autorizou'],
    ['responder, disse sim e a última mensagem é sua', 'responder', { produto: 'iris', resposta: { tipo: 'interesse' } as CrmLead['resposta'],
      conversa: { desde: '', mensagens: 3, ultima: { direcao: 'saida', em: '', trecho: 'vou pedir ao time' } } }, 'Você já respondeu a Studio L; falta: combine a demonstração'],
    ['responder, resposta aberta e a última mensagem é sua', 'responder', { resposta: { tipo: 'neutra' } as CrmLead['resposta'],
      conversa: { desde: '', mensagens: 3, ultima: { direcao: 'saida', em: '', trecho: 'oi' } } }, 'Você já respondeu a Studio L: confira a conversa antes de escrever de novo'],
    ['mandar a proposta', 'mandar-proposta', {}, 'Studio L gostou: mande a proposta'],
    ['combinado', 'combinado', {}, 'Combinado com Studio L'],
    ['depois do link', 'depois-do-link', {}, 'Pergunte a Studio L o que achou'],
    ['proposta sem retorno', 'proposta', {}, 'Pergunte a Studio L o que faltou na proposta'],
    ['follow-up', 'followup', {}, 'Follow-up para Studio L'],
    ['reenvio do só-robô', 'followup', { reenvioDoRobo: true }, 'Peça o responsável na Studio L'],
    ['desfecho', 'desfecho', {}, 'Studio L disse não: marque a recusa'],
    ['primeiro contato', 'primeiro', {}, 'Envie a primeira mensagem para Studio L'],
  ]
  for (const [nome, tipo, extra, esperado] of casos) {
    it(nome, () => assert.equal(fraseDaAcao(tipo, { ...base, ...extra }), esperado))
  }

  it('a leitura do copiloto (recepção) manda na frase; no primeiro contato, não', () => {
    assert.match(fraseDaAcao('responder', base, { quem: 'recepcao' }), /quem respondeu foi a recepção/)
    assert.equal(fraseDaAcao('primeiro', base, { quem: 'recepcao' }), 'Envie a primeira mensagem para Studio L')
    assert.equal(fraseDaAcao('responder', base, { quem: 'decisor' }), 'Responda a Studio L')
  })
})

describe('o cartão da Próxima venda e o "Agora" da Ficha dizem a mesma frase (AC-12)', () => {
  const quente = lead('r1', { etapa: 'contato', sinal: 'respondeu', respostaNova: true,
    eventos: [{ tipo: 'nota', rotulo: 'Nota', texto: '[historico-conferido-v1] Conferi a conversa deste lead no WhatsApp.', em: new Date(AGORA).toISOString(), origem: 'manual', fonte: 'CRM' }],
    resposta: { tipo: 'interesse', trecho: 'pode sim', em: '2026-10-14T12:00:00Z' } as CrmLead['resposta'],
    links: { whatsapp: WA, segunda: `${WA}?text=${encodeURIComponent('Segue o link')}` } })
  const v = visao({ resposta: [{ leadId: 'r1', links: [{ rotulo: 'Mandar o link do site', url: quente.links.segunda! }, { rotulo: 'Abrir conversa no WhatsApp', url: WA }] }] }, [quente])

  it('sem copiloto', () => {
    const cartao = filaDeVenda(v, LIVRE)[0]
    const daFicha = acaoDoLead(v, 'r1', AGORA)
    assert.equal(cartao.titulo, fraseDaAcao('responder', quente))
    assert.equal(daFicha?.titulo, cartao.titulo)
    assert.equal(agoraDaFicha(quente, daFicha).frase, cartao.titulo)
    assert.equal(agoraDaFicha(quente, daFicha).como, cartao.tatica)
  })

  it('com a leitura do copiloto (recepção), nos dois lugares', () => {
    const sugestao = { mensagem: 'Oi! Quem cuida disso aí?', porque: '', quando: '', momento: { quem: 'recepcao' as const, leitura: 'É a recepção', passo: 'Peça quem decide' } }
    const cartao = filaDeVenda(v, { ...LIVRE, sugestoes: new Map([['r1', sugestao]]) })[0]
    const daFicha = acaoDoLead(v, 'r1', AGORA, sugestao)
    assert.match(cartao.titulo, /recepção/)
    assert.equal(agoraDaFicha(quente, daFicha).frase, cartao.titulo)
  })

  it('a Ficha do segundo lead "pronto" também tem ação (a fila só dá um primeiro contato por vez)', () => {
    const a = lead('p1', { links: { enviar: `${N8N}/enviar?place_id=p1` } })
    const b = lead('p2', { links: { enviar: `${N8N}/enviar?place_id=p2` } })
    const vp = visao({ enviar: [
      { leadId: 'p1', links: [{ rotulo: 'Enviar pelo WhatsApp', url: a.links.enviar! }] },
      { leadId: 'p2', links: [{ rotulo: 'Enviar pelo WhatsApp', url: b.links.enviar! }] },
    ] }, [a, b])
    assert.deepEqual(filaDeVenda(vp, LIVRE).map((x) => x.leadId), ['p1'])
    assert.equal(acaoDoLead(vp, 'p2', AGORA)?.titulo, 'Envie a primeira mensagem para Empresa p2')
  })
})

describe('agoraDaFicha sem ação na fila: diz que não há nada e por quê', () => {
  const casos: Array<[string, Partial<CrmLead>, RegExp]> = [
    ['ganho', { etapa: 'ganho' }, /^Ganho: nada a vender agora/],
    ['perdido', { etapa: 'perdido' }, /^Fora do funil/],
    ['próximo passo salvo para depois', { etapa: 'contato', sinal: 'respondeu', proximoPasso: { texto: 'Ligar às 10h', data: '2026-10-20', registradoEm: '' } },
      /^Nada para fazer com ele agora; o próximo passo salvo é “Ligar às 10h”, para ter 20\/10\.$/],
    ['esperando desde o último envio', { etapa: 'contato', sinal: 'enviado', marcos: { enviado: '2026-10-12T15:00:00Z' } }, /^Esperando a resposta dele desde seg 12\/10\.$/],
    ['a vez é do robô', { etapa: 'novo', sinal: 'na-fila' }, /^Nada para fazer com ele agora: esperar o Raio-X/],
  ]
  for (const [nome, extra, esperado] of casos) {
    it(nome, () => assert.match(agoraDaFicha(lead('x', extra), null).frase, esperado))
  }
  it('o próximo passo citado na frase não se repete embaixo', () => {
    const l = lead('x', { etapa: 'contato', sinal: 'respondeu', proximoPasso: { texto: 'Ligar', data: '2026-10-20', registradoEm: '' } })
    assert.equal(agoraDaFicha(l, null).citaOProximo, true)
    assert.equal(agoraDaFicha(l, { titulo: 'Responda a X', tatica: 'curto' }).citaOProximo, false)
  })
})

describe('linkDoPasso: o link pelo tipo, não pela posição (AC-05)', () => {
  const gerar = `${N8N}/gerar_demo?place_id=s1`
  const comTexto = `${WA}?text=${encodeURIComponent('Segue o link')}`
  const casos: Array<[string, Partial<CrmLead['links']>, CrmItemHoje['links'], string | undefined]> = [
    // O caso de 17/10: o "quer ver" sem 2ª mensagem vem [gerarDemo, conversa] do servidor.
    ['"quer ver" sem demo: a conversa, nunca o webhook gerar_demo', { gerarDemo: gerar, whatsapp: WA },
      [{ rotulo: 'Gerar demo', url: gerar }, { rotulo: 'Abrir conversa no WhatsApp', url: WA }], WA],
    ['a mensagem pronta vence o "Gerar demo" e a conversa', { gerarDemo: gerar, whatsapp: WA, segunda: comTexto },
      [{ rotulo: 'Gerar demo', url: gerar }, { rotulo: 'Abrir conversa no WhatsApp', url: WA }, { rotulo: 'Mandar o link', url: comTexto }], comTexto],
    ['primeiro contato: o link do n8n que marca o envio, não o demo', { enviar: `${N8N}/enviar?place_id=s1`, site: 'https://demo.exemplo' },
      [{ rotulo: 'Ver o demo', url: 'https://demo.exemplo' }, { rotulo: 'Enviar pelo WhatsApp', url: `${N8N}/enviar?place_id=s1` }], `${N8N}/enviar?place_id=s1`],
    ['só o demo e o "Gerar demo": nenhum link (o botão diria WhatsApp e abriria outra coisa)', { gerarDemo: gerar },
      [{ rotulo: 'Gerar demo', url: gerar }, { rotulo: 'Ver o demo', url: 'https://demo.exemplo' }], undefined],
  ]
  for (const [nome, links, doItem, esperado] of casos) {
    it(nome, () => assert.equal(linkDoPasso({ links: doItem }, { links })?.url, esperado))
  }

  it('na fila, o "quer ver" sem demo abre a conversa e o botão diz isso (sem texto pronto)', () => {
    const l = lead('s1', { etapa: 'contato', sinal: 'respondeu', respostaNova: true,
      resposta: { tipo: 'interesse', trecho: 'quero ver' } as CrmLead['resposta'], links: { gerarDemo: gerar, whatsapp: WA } })
    const v = visao({ resposta: [{ leadId: 's1', links: [{ rotulo: 'Gerar demo', url: gerar }, { rotulo: 'Abrir conversa no WhatsApp', url: WA }] }] }, [l])
    const a = filaDeVenda(v, LIVRE)[0]
    assert.equal(a.link?.url, WA)
    assert.equal(a.rascunho, undefined)
    assert.equal(a.titulo, 'Empresa s1 disse sim: gere o demo e avise que já vai')
  })
})

describe('desfechosDoLead: o que a faixa "Desfecho" mostra (AC-08)', () => {
  const casos: Array<{ nome: string; lead: Partial<CrmLead>; marcados: string[]; desfazer: string[]; ganhar: boolean; perder: boolean; proposta: boolean }> = [
    { nome: 'em contato, nada marcado: os três toques', lead: { etapa: 'contato' }, marcados: [], desfazer: [], ganhar: true, perder: true, proposta: true },
    { nome: 'na proposta: a proposta marcada com o desfazer; ganhar e perder ainda cabem', lead: { etapa: 'proposta', proposta: { em: '2026-10-13T15:00:00Z', data: '2026-10-13' } },
      marcados: ['proposta'], desfazer: ['proposta_desfeita'], ganhar: true, perder: true, proposta: false },
    { nome: 'ganho marcado na Central (o Plus inclusive): desfazer o ganho', lead: { etapa: 'ganho', produto: 'plus', ganhoManual: true },
      marcados: ['ganhou'], desfazer: ['ganhou_desfeito'], ganhar: false, perder: false, proposta: false },
    { nome: 'ganho pela planilha: estado sem desfazer daqui', lead: { etapa: 'ganho' }, marcados: ['ganho'], desfazer: [], ganhar: false, perder: false, proposta: false },
    { nome: 'recusa marcada', lead: { etapa: 'perdido', perdaManual: 'recusou', motivoPerda: 'recusou' }, marcados: ['recusou'], desfazer: ['recusou_desfeito'], ganhar: false, perder: false, proposta: false },
    { nome: 'sem contato fácil', lead: { etapa: 'perdido', perdaManual: 'sem-contato', motivoPerda: 'sem-contato' }, marcados: ['sem-contato'], desfazer: ['sem_contato_desfeito'], ganhar: false, perder: false, proposta: false },
    { nome: 'dispensado na Triagem', lead: { etapa: 'perdido', perdaManual: 'dispensado', motivoPerda: 'descartado' }, marcados: ['dispensado'], desfazer: ['dispensado_desfeito'], ganhar: false, perder: false, proposta: false },
    { nome: 'perdido pelo prazo: sem desfecho; ganhar e a proposta o trazem de volta', lead: { etapa: 'perdido', motivoPerda: 'expirou' }, marcados: [], desfazer: [], ganhar: true, perder: false, proposta: true },
    { nome: 'recusou pela página do n8n: estado sem desfazer daqui', lead: { etapa: 'perdido', motivoPerda: 'recusou' }, marcados: ['perdido'], desfazer: [], ganhar: false, perder: false, proposta: false },
  ]
  for (const c of casos) {
    it(c.nome, () => {
      const d = desfechosDoLead(lead('d', c.lead))
      assert.deepEqual(d.marcados.map((m) => m.id), c.marcados)
      assert.deepEqual(d.marcados.flatMap((m) => (m.desfazer ? [m.desfazer.tipo] : [])), c.desfazer)
      assert.deepEqual([d.ganhar, d.perder, d.proposta], [c.ganhar, c.perder, c.proposta])
    })
  }
  it('a proposta diz o dia', () => {
    assert.equal(desfechosDoLead(lead('d', { etapa: 'proposta', proposta: { em: '2026-10-13T15:00:00Z', data: '2026-10-13' } })).marcados[0].texto, 'Proposta enviada ter 13/10.')
  })
})
