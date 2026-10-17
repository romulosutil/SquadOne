import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { liberadosDoCorpo } from './operations/liberados.ts'
import { acaoDaFicha, motivoCurtoDoRitmo, primeiroContatoDaFicha, type TravasDoPrimeiro } from './operations/primeiro-da-ficha.ts'
import { agoraDaFicha, chaveDoNicho, filaDeVenda, nichosDoPrimeiro } from './operations/proxima-venda.ts'
import type { CrmGrupoHojeId, CrmItemHoje, CrmLead, CrmVisao } from './operations/types.ts'

// 17/10/2026 (auditoria da Central): o filtro de nicho sem grafias repetidas (AC-16), o "Liberar" do
// dia vindo do servidor (AC-21) e o primeiro contato de um lead Novo enviado da Ficha (AC-22).
// Tudo fixture: nenhum retrato real.

const AGORA = Date.parse('2026-10-14T13:00:00Z') // quarta, 10:00 em São Paulo
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

describe('nicho normalizado: a mesma palavra é uma opção só (AC-16)', () => {
  const casos: Array<[string, string, string]> = [
    ['caixa', 'Pilates', 'pilates'],
    ['acento', 'Estética', 'estetica'],
    ['espaços nas pontas e no meio', '  clínica   de  estética ', 'clinica de estetica'],
    ['cedilha', 'Açaí', 'acai'],
    ['vazio vira "sem nicho"', '   ', 'sem nicho'],
  ]
  for (const [nome, nicho, chave] of casos) it(nome, () => assert.equal(chaveDoNicho(nicho), chave))

  it('as grafias de um nicho somam numa opção, com a grafia mais comum como rótulo', () => {
    assert.deepEqual(nichosDoPrimeiro(['Pilates', 'pilates ', 'Pilátes', 'Pilates', 'Advocacia', 'advocacia']), [
      { chave: 'pilates', rotulo: 'Pilates', quantos: 4 },
      { chave: 'advocacia', rotulo: 'Advocacia', quantos: 2 },
    ])
  })

  it('um nicho escrito de dois jeitos é um nicho só (o select não aparece)', () => {
    assert.equal(nichosDoPrimeiro(['Estética', 'estetica', 'ESTÉTICA']).length, 1)
    assert.equal(nichosDoPrimeiro([]).length, 0)
  })

  it('empate na contagem: ordem alfabética', () => {
    assert.deepEqual(nichosDoPrimeiro(['Odonto', 'Advocacia']).map((n) => n.rotulo), ['Advocacia', 'Odonto'])
  })

  it('o filtro da fila compara pela chave: outra grafia do mesmo nicho passa', () => {
    const a = lead('p1', { nicho: 'Estética', links: { enviar: `${N8N}/enviar?place_id=p1` } })
    const b = lead('p2', { nicho: 'Advocacia', links: { enviar: `${N8N}/enviar?place_id=p2` } })
    const v = visao({ enviar: [
      { leadId: 'p2', links: [{ rotulo: 'Enviar', url: b.links.enviar! }] },
      { leadId: 'p1', links: [{ rotulo: 'Enviar', url: a.links.enviar! }] },
    ] }, [a, b])
    assert.deepEqual(filaDeVenda(v, { primeiroLiberado: true, nichoDoPrimeiro: 'estetica' }).map((x) => x.leadId), ['p1'])
    assert.deepEqual(filaDeVenda(v, { primeiroLiberado: true, nichoDoPrimeiro: 'ESTETICA ' }).map((x) => x.leadId), ['p1'])
  })
})

describe('o "Liberar" do dia como o servidor devolve (AC-21)', () => {
  const casos: Array<[string, unknown, Record<string, number> | null]> = [
    ['o dia com liberados', { dia: '2026-10-17', liberados: { 'site:L': 5 } }, { 'site:L': 5 }],
    ['formato antigo, sem a chave: vazio', { dia: '2026-10-17', resolvidas: {} }, {}],
    ['lixo sai', { liberados: { 'site:L': 5, 'site:M': 'x', '': 1 } }, { 'site:L': 5 }],
    ['corpo ilegível: não mexe no que se sabe', null, null],
    ['liberados que não é objeto: não mexe', { liberados: ['site:L'] }, null],
  ]
  for (const [nome, corpo, esperado] of casos) it(nome, () => assert.deepEqual(liberadosDoCorpo(corpo), esperado))
})

describe('a Ficha oferece o primeiro contato de um lead Novo (AC-22)', () => {
  const LIVRE: TravasDoPrimeiro = { foraDoExpediente: false, liberado: false, ritmo: { motivo: null, ate: null, enviadosHoje: 2, teto: 10 } }
  const ENVIAR = `${N8N}/enviar?place_id=n1`
  const CONVITE = `${N8N}/convite?id=n1`
  const intervalo = { motivo: 'intervalo' as const, ate: Date.parse('2026-10-14T13:04:00Z'), enviadosHoje: 3, teto: 10 }
  const casos: Array<{ nome: string; lead: Partial<CrmLead>; travas: TravasDoPrimeiro; esperado: null | { chave: string; pode: boolean; pedeLiberar: boolean; motivo?: RegExp } }> = [
    { nome: 'Novo com o envio, no expediente e no ritmo: pode', lead: { links: { enviar: ENVIAR } }, travas: LIVRE, esperado: { chave: 'enviar', pode: true, pedeLiberar: false } },
    { nome: 'Novo do PRUMO com o convite', lead: { produto: 'prumo', links: { convite: CONVITE } }, travas: LIVRE, esperado: { chave: 'convite', pode: true, pedeLiberar: false } },
    { nome: 'fora do expediente, sem liberar: desabilitado, pede o Liberar', lead: { links: { enviar: ENVIAR } }, travas: { ...LIVRE, foraDoExpediente: true },
      esperado: { chave: 'enviar', pode: false, pedeLiberar: true, motivo: /expediente/ } },
    { nome: 'fora do expediente, liberado hoje: pode', lead: { links: { enviar: ENVIAR } }, travas: { ...LIVRE, foraDoExpediente: true, liberado: true },
      esperado: { chave: 'enviar', pode: true, pedeLiberar: false } },
    { nome: 'ritmo segurando: desabilitado com a hora, sem Liberar', lead: { links: { enviar: ENVIAR } }, travas: { ...LIVRE, ritmo: intervalo },
      esperado: { chave: 'enviar', pode: false, pedeLiberar: false, motivo: /^O próximo sai às/ } },
    { nome: 'ritmo e horário juntos: o ritmo manda (o Liberar não destravaria)', lead: { links: { enviar: ENVIAR } }, travas: { foraDoExpediente: true, liberado: false, ritmo: intervalo },
      esperado: { chave: 'enviar', pode: false, pedeLiberar: false, motivo: /^O próximo sai às/ } },
    { nome: 'Novo sem link (a vez é do robô): não oferece', lead: { sinal: 'na-fila' }, travas: LIVRE, esperado: null },
    { nome: 'Em contato (o reenvio do só-robô fica no follow-up): não oferece', lead: { etapa: 'contato', sinal: 'enviado', reenvioDoRobo: true, links: { followup: `${N8N}/followup` } }, travas: LIVRE, esperado: null },
    { nome: 'Perdido com o link velho: não oferece', lead: { etapa: 'perdido', links: { enviar: ENVIAR } }, travas: LIVRE, esperado: null },
  ]
  for (const c of casos) {
    it(c.nome, () => {
      const p = primeiroContatoDaFicha(lead('n1', c.lead), c.travas)
      if (!c.esperado) return assert.equal(p, null)
      assert.ok(p)
      assert.deepEqual({ chave: p.chave, pode: p.pode, pedeLiberar: p.pedeLiberar }, { chave: c.esperado.chave, pode: c.esperado.pode, pedeLiberar: c.esperado.pedeLiberar })
      if (c.esperado.motivo) assert.match(p.motivo, c.esperado.motivo)
      else assert.equal(p.motivo, '')
    })
  }

  it('o motivo curto de cada trava do ritmo', () => {
    const ate = Date.parse('2026-10-14T15:30:00Z')
    assert.match(motivoCurtoDoRitmo({ motivo: 'pausa', ate, enviadosHoje: 0, teto: 10 }), /^Pausado até/)
    assert.equal(motivoCurtoDoRitmo({ motivo: 'dia', ate, enviadosHoje: 10, teto: 10 }), 'Teto de hoje: 10 de 10')
    assert.match(motivoCurtoDoRitmo({ motivo: 'hora', ate, enviadosHoje: 8, teto: 20 }), /^Teto da hora/)
    assert.equal(motivoCurtoDoRitmo({ motivo: null, ate: null, enviadosHoje: 0, teto: 10 }), '')
  })

  it('o "Agora" diz a frase da fila, também para o Novo fora da Hoje (o Plus depois dos 10)', () => {
    const fora = lead('plus:11', { produto: 'plus', links: { enviar: 'https://wa.me/5527999990000?text=Meu%20Ir.' } })
    const v = visao({}, [fora])
    const p = primeiroContatoDaFicha(fora, LIVRE)
    const a = acaoDaFicha(v, fora, AGORA, p)
    assert.equal(agoraDaFicha(fora, a).frase, 'Envie a primeira mensagem para Empresa plus:11')
    assert.ok(agoraDaFicha(fora, a).como)
    // Sem o primeiro contato oferecido (sem link), segue o "nada a fazer" de antes.
    const semLink = lead('x', { sinal: 'na-fila' })
    assert.equal(acaoDaFicha(visao({}, [semLink]), semLink, AGORA, primeiroContatoDaFicha(semLink, LIVRE)), null)
  })

  it('na Hoje, a ação é a da fila (a mesma do cartão), não a montada', () => {
    const l = lead('n1', { links: { enviar: ENVIAR } })
    const v = visao({ enviar: [{ leadId: 'n1', acao: 'Mandar a primeira mensagem', links: [{ rotulo: 'Enviar pelo WhatsApp', url: ENVIAR }] }] }, [l])
    const a = acaoDaFicha(v, l, AGORA, primeiroContatoDaFicha(l, LIVRE))
    assert.equal(a?.porque, 'Mandar a primeira mensagem')
    assert.equal(a?.titulo, 'Envie a primeira mensagem para Empresa n1')
  })
})
