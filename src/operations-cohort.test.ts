import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHAVE_DO_COHORT, adicionarCriterio, alternarCriterio, aplicarCohort, avaliarCriterio, chaveDoCriterio, cohortVazio, descreverCohort,
  gravarCohort, lerCohort, motivosDoLead, opcoesDoCohort, removerCriterio, rotuloDoCriterio, type ChaveDeSinal, type Cohort, type Criterio,
  type LeadDoCohort, type SinaisDoLead,
} from './operations/cohort.ts'
import type { CrmLead } from './operations/types.ts'

// Leads inventados: nenhum nome, telefone ou link real.
const lead = (id: string, extra: Partial<CrmLead> & { sinais?: SinaisDoLead } = {}): LeadDoCohort & { id: string } => ({
  id, produto: 'iris', nicho: 'Dentista', cidade: 'Vitória', etapa: 'novo', sinal: 'revisar', marcos: {}, followupHoje: false, links: {}, ...extra,
})
const ids = (ls: ReadonlyArray<{ id: string }>) => ls.map((l) => l.id)
const sinal = (chave: ChaveDeSinal): Criterio => ({ tipo: 'sinal', chave })
const cohort = (deve: Criterio[], naoPode: Criterio[] = []): Cohort => ({ deve, naoPode })

// a: roda Google Ads, sem agendamento, sem agência | b: roda Google Ads, COM agendamento | c: roda Google Ads, sem leitura do agendamento
// d: não roda Google Ads | e: nenhuma leitura de sinal | f: roda Google Ads, sem agendamento, TEM agência
const base = [
  lead('a', { sinais: { rodandoGoogleAds: true, semAgendamentoOnline: true, temAgencia: false } }),
  lead('b', { sinais: { rodandoGoogleAds: true, semAgendamentoOnline: false, temAgencia: false } }),
  lead('c', { sinais: { rodandoGoogleAds: true, semAgendamentoOnline: null, temAgencia: false } }),
  lead('d', { sinais: { rodandoGoogleAds: false, semAgendamentoOnline: true, temAgencia: false } }),
  lead('e'),
  lead('f', { sinais: { rodandoGoogleAds: true, semAgendamentoOnline: true, temAgencia: true } }),
]

describe('aplicarCohort: o "deve" e o "não pode" sobre os sinais', () => {
  const casos: Array<[string, Cohort, string[], string[]]> = [
    ['cohort vazio: todos batem e ninguém fica sem leitura', cohortVazio(), ['a', 'b', 'c', 'd', 'e', 'f'], []],
    ['um "deve": roda Google Ads', cohort([sinal('rodandoGoogleAds')]), ['a', 'b', 'c', 'f'], ['e']],
    ['E: roda anúncios e não tem agendamento online', cohort([sinal('rodandoGoogleAds'), sinal('semAgendamentoOnline')]), ['a', 'f'], ['c', 'e']],
    ['E NÃO: ... e não pode ter agência', cohort([sinal('rodandoGoogleAds'), sinal('semAgendamentoOnline')], [sinal('temAgencia')]), ['a'], ['c', 'e']],
    ['só "não pode": quem tem agência sai; quem não tem leitura fica à parte', cohort([], [sinal('temAgencia')]), ['a', 'b', 'c', 'd'], ['e']],
    // d não roda Google Ads (lido): reprova ali e não vira "sem leitura" por causa de outro critério.
    ['quem reprova num critério lido não vira "sem leitura" pelo outro', cohort([sinal('rodandoGoogleAds'), sinal('rodandoMetaAds')]), [], ['a', 'b', 'c', 'e', 'f']],
  ]
  for (const [nome, c, batem, semLeitura] of casos) {
    it(nome, () => {
      const r = aplicarCohort(base, c)
      assert.deepEqual(ids(r.batem), batem)
      assert.deepEqual(ids(r.semLeitura), semLeitura)
      assert.equal(r.total, base.length)
    })
  }

  it('sem leitura nunca bate nem desqualifica: o null de um sinal não é "falso"', () => {
    const so = [lead('c', { sinais: { semAgendamentoOnline: null } }), lead('x', { sinais: {} })]
    // "não pode ter agendamento ausente" também não pode tirar quem não foi lido.
    const r = aplicarCohort(so, cohort([], [sinal('semAgendamentoOnline')]))
    assert.deepEqual(ids(r.batem), [])
    assert.deepEqual(ids(r.semLeitura), ['c', 'x'])
  })

  it('o resultado guarda a ordem da entrada', () => {
    const r = aplicarCohort([...base].reverse(), cohort([sinal('rodandoGoogleAds')]))
    assert.deepEqual(ids(r.batem), ['f', 'c', 'b', 'a'])
  })
})

describe('aplicarCohort: os campos que o lead já tem', () => {
  const l = (id: string, extra: Partial<CrmLead> = {}) => lead(id, extra)
  const grupo = [
    l('1', { produto: 'iris', nicho: 'Dentista', cidade: 'Vitória', links: { site: 'https://exemplo.invalid', whatsapp: 'https://wa.me/0' }, triagem: { prioridade: 90 } }),
    l('2', { produto: 'iris', nicho: 'Clínica Médica', cidade: 'Vila Velha', links: { whatsapp: 'https://wa.me/0' }, triagem: { prioridade: 40, origemWhatsapp: 'não confirmado (só no Maps)' } }),
    l('3', { produto: 'estampa', nicho: 'clinica  medica', cidade: '', links: {}, triagem: {} }),
    l('4', { produto: 'site', nicho: '', cidade: 'Serra', links: { site: 'https://exemplo.invalid' } }),
  ]
  const casos: Array<[string, Cohort, string[], string[]]> = [
    ['oferta', cohort([{ tipo: 'oferta', valor: 'iris' }]), ['1', '2'], []],
    ['nicho ignora caixa, acento e espaço', cohort([{ tipo: 'nicho', valor: 'CLÍNICA médica' }]), ['2', '3'], ['4']],
    ['cidade vazia é sem leitura, não "outra cidade"', cohort([{ tipo: 'cidade', valor: 'vitoria' }]), ['1'], ['3']],
    ['tem site cadastrado', cohort([{ tipo: 'temSite' }]), ['1', '4'], []],
    ['não pode ter site cadastrado', cohort([], [{ tipo: 'temSite' }]), ['2', '3'], []],
    ['WhatsApp publicado exclui o "não confirmado"', cohort([{ tipo: 'whatsappPublicado' }]), ['1'], []],
    ['pontuação de 70 para cima; sem pontuação fica à parte', cohort([{ tipo: 'pontuacao', minimo: 70 }]), ['1'], ['3', '4']],
    ['não pode ter pontuação de 70 para cima', cohort([], [{ tipo: 'pontuacao', minimo: 70 }]), ['2'], ['3', '4']],
    ['passo da jornada', cohort([{ tipo: 'passo', valor: 'achado' }]), ['1', '2', '3', '4'], []],
    ['oferta E nicho E sem site', cohort([{ tipo: 'oferta', valor: 'iris' }, { tipo: 'nicho', valor: 'clinica medica' }], [{ tipo: 'temSite' }]), ['2'], []],
  ]
  for (const [nome, c, batem, semLeitura] of casos) {
    it(nome, () => {
      const r = aplicarCohort(grupo, c)
      assert.deepEqual(ids(r.batem), batem)
      assert.deepEqual(ids(r.semLeitura), semLeitura)
    })
  }

  it('avaliarCriterio devolve null só onde não há leitura', () => {
    assert.equal(avaliarCriterio(grupo[2], { tipo: 'cidade', valor: 'Vitória' }), null)
    assert.equal(avaliarCriterio(grupo[2], { tipo: 'temSite' }), false)
    assert.equal(avaliarCriterio(grupo[0], sinal('semSite')), null)
  })
})

describe('descreverCohort e motivosDoLead: o texto em português', () => {
  const casos: Array<[string, Cohort, string]> = [
    ['vazio', cohortVazio(), 'Todos os prospects, sem filtro'],
    ['um "deve"', cohort([sinal('rodandoGoogleAds')]), 'Roda Google Ads'],
    ['E entre os "deve" e "não" no sinal negativo', cohort([sinal('rodandoGoogleAds'), sinal('semAgendamentoOnline')]), 'Roda Google Ads E não tem agendamento online'],
    ['"deve" e "não pode"', cohort([sinal('rodandoGoogleAds')], [sinal('temAgencia'), sinal('rodandoMetaAds')]), 'Roda Google Ads · não pode: tem agência ou roda anúncios no Meta'],
    ['só "não pode"', cohort([], [sinal('temAgencia')]), 'Não pode: tem agência'],
    ['campos do lead', cohort([{ tipo: 'oferta', valor: 'iris' }, { tipo: 'cidade', valor: 'Vitória' }, { tipo: 'pontuacao', minimo: 70 }], [{ tipo: 'temSite' }]),
      'Oferta Iris E em Vitória E pontuação 70 ou mais · não pode: tem site cadastrado'],
  ]
  for (const [nome, c, texto] of casos) it(nome, () => assert.equal(descreverCohort(c), texto))

  it('os motivos do lead dizem o que ele tem e o que ele não tem', () => {
    const c = cohort([sinal('rodandoGoogleAds'), sinal('semAgendamentoOnline')], [sinal('temAgencia')])
    assert.deepEqual(motivosDoLead(base[0], c), ['roda Google Ads', 'não tem agendamento online', 'não tem agência'])
    // Quem não tem leitura do agendamento só mostra o que foi lido.
    assert.deepEqual(motivosDoLead(base[2], c), ['roda Google Ads', 'não tem agência'])
    assert.deepEqual(motivosDoLead(base[0], cohortVazio()), [])
  })

  it('o rótulo do chip afirma o critério com inicial maiúscula', () => {
    assert.equal(rotuloDoCriterio(sinal('temAgencia')), 'Tem agência')
    assert.equal(rotuloDoCriterio({ tipo: 'whatsappPublicado' }), 'WhatsApp publicado no site')
  })
})

describe('opcoesDoCohort: só oferece o que escolhe alguém', () => {
  it('sem nenhum sinal lido, nenhum critério de sinal é oferecido', () => {
    const o = opcoesDoCohort([lead('1'), lead('2', { sinais: { temAgencia: null } }), lead('3', { sinais: {} })])
    assert.deepEqual(o.sinais, [])
  })

  it('com leitura em ao menos um lead, só aquele sinal aparece', () => {
    assert.deepEqual(opcoesDoCohort(base).sinais, ['temAgencia', 'rodandoGoogleAds', 'semAgendamentoOnline'])
  })

  it('valores iguais em todo o grupo não viram opção; nicho e cidade contam sem caixa nem acento', () => {
    const o = opcoesDoCohort([
      lead('1', { nicho: 'Dentista', cidade: 'Vitória', links: { site: 'x' } }),
      lead('2', { nicho: 'dentista', cidade: 'vitoria', links: { site: 'x' } }),
      lead('3', { nicho: 'Clínica', cidade: 'Serra', links: { site: 'x' } }),
    ])
    assert.deepEqual(o.ofertas, [])
    assert.deepEqual(o.nichos.map((n) => [n.valor, n.quantos]), [['Dentista', 2], ['Clínica', 1]])
    assert.deepEqual(o.cidades.map((n) => [n.valor, n.quantos]), [['Vitória', 2], ['Serra', 1]])
    assert.equal(o.temSite, false)
    assert.equal(o.whatsappPublicado, false)
  })

  it('a pontuação só oferece os limites que separam alguém', () => {
    const com = (p?: number) => lead(`p${p}`, { triagem: p === undefined ? {} : { prioridade: p } })
    assert.deepEqual(opcoesDoCohort([com(40), com(75), com(95), com()]).pontuacoes, [50, 70, 90])
    assert.deepEqual(opcoesDoCohort([com(100), com(100)]).pontuacoes, [])
    assert.deepEqual(opcoesDoCohort([com()]).pontuacoes, [])
  })
})

describe('editar o cohort', () => {
  it('alternar liga e desliga; o mesmo critério não fica nas duas colunas', () => {
    let c = alternarCriterio(cohortVazio(), 'deve', sinal('temAgencia'))
    assert.deepEqual(c, cohort([sinal('temAgencia')]))
    c = alternarCriterio(c, 'naoPode', sinal('temAgencia'))
    assert.deepEqual(c, cohort([], [sinal('temAgencia')]))
    c = alternarCriterio(c, 'naoPode', sinal('temAgencia'))
    assert.deepEqual(c, cohortVazio())
  })

  it('no "deve", nicho, cidade, oferta, passo e pontuação trocam o anterior; no "não pode" somam', () => {
    let c = adicionarCriterio(cohortVazio(), 'deve', { tipo: 'nicho', valor: 'Dentista' })
    c = adicionarCriterio(c, 'deve', { tipo: 'nicho', valor: 'Clínica' })
    assert.deepEqual(c.deve, [{ tipo: 'nicho', valor: 'Clínica' }])
    c = adicionarCriterio(c, 'naoPode', { tipo: 'nicho', valor: 'Dentista' })
    c = adicionarCriterio(c, 'naoPode', { tipo: 'nicho', valor: 'Médico' })
    assert.equal(c.naoPode.length, 2)
    c = adicionarCriterio(c, 'deve', { tipo: 'pontuacao', minimo: 50 })
    c = adicionarCriterio(c, 'deve', { tipo: 'pontuacao', minimo: 90 })
    assert.deepEqual(c.deve.filter((x) => x.tipo === 'pontuacao'), [{ tipo: 'pontuacao', minimo: 90 }])
  })

  it('remover tira só da coluna pedida e a chave ignora caixa e acento', () => {
    const c = cohort([{ tipo: 'cidade', valor: 'Vitória' }], [{ tipo: 'cidade', valor: 'Serra' }])
    assert.equal(chaveDoCriterio({ tipo: 'cidade', valor: 'VITORIA ' }), chaveDoCriterio({ tipo: 'cidade', valor: 'Vitória' }))
    assert.deepEqual(removerCriterio(c, 'deve', { tipo: 'cidade', valor: 'vitoria' }), cohort([], [{ tipo: 'cidade', valor: 'Serra' }]))
  })
})

describe('guardar o cohort no navegador', () => {
  const memoria = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
  }

  it('grava e lê de volta o mesmo cohort', () => {
    const s = memoria()
    const c = cohort([sinal('rodandoGoogleAds'), { tipo: 'cidade', valor: 'Vitória' }], [sinal('temAgencia'), { tipo: 'pontuacao', minimo: 70 }])
    gravarCohort(s, c)
    assert.ok(s.m.has(CHAVE_DO_COHORT))
    assert.deepEqual(lerCohort(s), c)
  })

  it('sem storage, com lixo ou com storage que lança: cohort vazio, sem exceção', () => {
    assert.deepEqual(lerCohort(null), cohortVazio())
    assert.deepEqual(lerCohort(undefined), cohortVazio())
    const s = memoria()
    for (const lixo of ['', '{', 'null', '[]', '42', '{"deve":"x","naoPode":7}']) {
      s.m.set(CHAVE_DO_COHORT, lixo)
      assert.deepEqual(lerCohort(s), cohortVazio(), lixo)
    }
    const quebrado = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    assert.deepEqual(lerCohort(quebrado), cohortVazio())
    assert.doesNotThrow(() => gravarCohort(quebrado, cohort([sinal('temAgencia')])))
    assert.doesNotThrow(() => gravarCohort(null, cohortVazio()))
  })

  it('descarta critério inventado e desfaz contradição', () => {
    const s = memoria()
    s.m.set(CHAVE_DO_COHORT, JSON.stringify({
      deve: [{ tipo: 'sinal', chave: 'inventado' }, { tipo: 'oferta', valor: 'xpto' }, { tipo: 'nicho', valor: '  ' }, { tipo: 'temSite' }, { tipo: 'sinal', chave: 'temAgencia' }],
      naoPode: [{ tipo: 'sinal', chave: 'temAgencia' }, { tipo: 'whatsappPublicado' }, 'texto'],
    }))
    assert.deepEqual(lerCohort(s), cohort([{ tipo: 'temSite' }, sinal('temAgencia')], [{ tipo: 'whatsappPublicado' }]))
  })
})
