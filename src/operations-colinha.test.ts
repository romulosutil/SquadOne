import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { FOLLOWUP, FOLLOWUP_COM_LINK, SEGUNDA, artigoDe } from '../server/site-mensagem.ts'
import {
  CARDAPIO, CDL, CLIENTE_FUNDADOR, OBJECOES, PRECOS_DO_CARDAPIO, ROTEIRO, SEM_LINK, colinhaDoLead, linkDoWhatsApp, objecoesNoTexto,
  passo, precosNoTexto, preencher, type LeadDaColinha, type Momento, type Trecho,
} from './operations/colinha.ts'
import type { CrmEtapa, CrmProduto, CrmTipoDeResposta } from './operations/types.ts'

const PRODUTOS: CrmProduto[] = ['site', 'prumo']
const MOMENTOS: Momento[] = ['primeiro-contato', 'pode-mandar', 'followup', 'mapa', 'proposta', 'fechamento']

const lead = (produto: CrmProduto, etapa: CrmEtapa, tipo?: CrmTipoDeResposta, trecho = ''): LeadDaColinha => ({
  produto, etapa, empresa: 'Clínica Sorriso', links: {}, resposta: tipo ? { tipo, trecho } : undefined,
})

const idsDosMomentos = (l: LeadDaColinha) => colinhaDoLead(l).momentos.map((p) => p.momento)
const idsDasObjecoes = (l: LeadDaColinha) => colinhaDoLead(l).objecoes.map((o) => o.id)
const idsDosTrechos = (l: LeadDaColinha) => colinhaDoLead(l).momentos.flatMap((p) => p.trechos.map((t) => t.id))

// colinhaDoLead esconde momento sem conteúdo para o produto (melhor nada que um título vazio).
// A regra de QUAL momento vale é testada aqui, independente do texto já escrito; que cada um
// desses momentos tem conteúdo para o produto é conferido em "integridade do conteúdo".
const temConteudoPara = (m: Momento, produto: CrmProduto) => {
  const p = passo(m)
  return p.trechos.some((t) => t.produtos.includes(produto)) || (p.perguntas?.length ?? 0) > 0
}
const comConteudo = (ms: Momento[], produto: CrmProduto) => ms.filter((m) => temConteudoPara(m, produto))

/** Etapa + resposta -> momentos esperados para site e prumo. */
const CASOS: { nome: string, etapa: CrmEtapa, tipo?: CrmTipoDeResposta, trecho?: string, site: Momento[], prumo: Momento[] }[] = [
  { nome: 'novo: a primeira mensagem', etapa: 'novo', site: ['primeiro-contato'], prumo: ['primeiro-contato'] },
  { nome: 'contato sem resposta: o follow-up', etapa: 'contato', site: ['followup'], prumo: ['followup'] },
  { nome: 'contato só com o robô: o follow-up', etapa: 'contato', tipo: 'bot', trecho: 'Mensagem automática: em breve retornaremos.', site: ['followup'], prumo: ['followup'] },
  { nome: 'contato com interesse: o próximo passo e a proposta', etapa: 'contato', tipo: 'interesse', trecho: 'pode mandar', site: ['pode-mandar', 'proposta'], prumo: ['mapa', 'proposta'] },
  { nome: 'contato neutro: seguir a conversa', etapa: 'contato', tipo: 'neutra', trecho: 'quem é você?', site: ['pode-mandar'], prumo: ['mapa'] },
  { nome: 'contato negativo: nenhum momento, só objeção', etapa: 'contato', tipo: 'negativa', trecho: 'Obrigado, mas já temos site', site: [], prumo: [] },
  { nome: 'contato com pedido de exclusão: nenhum momento', etapa: 'contato', tipo: 'exclusao', trecho: 'por favor não me mande mais', site: [], prumo: [] },
  { nome: 'proposta: proposta e fechamento', etapa: 'proposta', site: ['proposta', 'fechamento'], prumo: ['proposta', 'fechamento'] },
  { nome: 'ganho: o fechamento', etapa: 'ganho', site: ['fechamento'], prumo: ['fechamento'] },
  { nome: 'perdido: nada a mandar', etapa: 'perdido', tipo: 'negativa', trecho: 'não, obrigado', site: [], prumo: [] },
  { nome: 'perdido por exclusão: nada a mandar', etapa: 'perdido', tipo: 'exclusao', trecho: 'pode apagar', site: [], prumo: [] },
]

describe('o trecho de cada etapa e resposta', () => {
  for (const c of CASOS) {
    for (const produto of PRODUTOS) {
      it(`${c.nome} (${produto})`, () => {
        const l = lead(produto, c.etapa, c.tipo, c.trecho)
        assert.deepEqual(idsDosMomentos(l), comConteudo(c[produto], produto))
        assert.ok(colinhaDoLead(l).motivo.trim(), 'todo caso diz por quê')
      })
    }
  }

  it('os trechos devolvidos são só do produto do lead', () => {
    for (const c of CASOS) {
      for (const produto of PRODUTOS) {
        for (const p of colinhaDoLead(lead(produto, c.etapa, c.tipo, c.trecho)).momentos) {
          for (const t of p.trechos) assert.ok(t.produtos.includes(produto), `${c.nome}: ${t.id} não serve para ${produto}`)
        }
      }
    }
  })

  it('a segunda mensagem da esteira aparece para o site com interesse e nunca para o prumo', () => {
    assert.ok(idsDosTrechos(lead('site', 'contato', 'interesse', 'pode mandar')).includes('segunda'))
    for (const c of CASOS) assert.ok(!idsDosTrechos(lead('prumo', c.etapa, c.tipo, c.trecho)).includes('segunda'), c.nome)
  })

  it('negativa com objeção reconhecida mostra ela primeiro', () => {
    assert.equal(idsDasObjecoes(lead('site', 'contato', 'negativa', 'Obrigado, mas já temos site'))[0], 'ja-tem-site')
    assert.equal(idsDasObjecoes(lead('site', 'contato', 'negativa', 'trabalhamos com uma agência'))[0], 'ja-tem-agencia')
  })

  it('negativa sem objeção reconhecida mostra todas, para o Rômulo escolher', () => {
    assert.deepEqual(idsDasObjecoes(lead('site', 'contato', 'negativa', 'não, obrigado')), OBJECOES.map((o) => o.id))
  })

  it('exclusão traz "pode apagar" primeiro, em contato e em perdido', () => {
    assert.equal(idsDasObjecoes(lead('site', 'contato', 'exclusao', 'por favor não me mande mais'))[0], 'pode-apagar')
    assert.equal(idsDasObjecoes(lead('prumo', 'perdido', 'exclusao', 'pode apagar'))[0], 'pode-apagar')
    assert.deepEqual(idsDasObjecoes(lead('prumo', 'perdido', 'exclusao', 'pode apagar')), ['pode-apagar'], 'sem repetir')
  })

  it('perdido sem exclusão não traz objeção', () => {
    assert.deepEqual(idsDasObjecoes(lead('site', 'perdido', 'negativa', 'não, obrigado')), [])
    assert.deepEqual(idsDasObjecoes(lead('site', 'perdido')), [])
  })

  it('proposta traz preço e decisão; "achei caro" não duplica o "tá caro"', () => {
    const semResposta = idsDasObjecoes(lead('site', 'proposta'))
    assert.ok(semResposta.includes('ta-caro') && semResposta.includes('ver-com-socio'))
    const caro = idsDasObjecoes(lead('prumo', 'proposta', 'negativa', 'achei caro'))
    assert.equal(caro.filter((id) => id === 'ta-caro').length, 1)
    assert.equal(caro[0], 'ta-caro')
  })
})

describe('objeção reconhecida no texto', () => {
  const ids = (texto: string | undefined) => objecoesNoTexto(texto).map((o) => o.id)

  it('acento e maiúscula não importam', () => {
    assert.ok(ids('JÁ TEMOS SITE').includes('ja-tem-site'))
    assert.ok(ids('Vou ver com meu SÓCIO').includes('ver-com-socio'))
    assert.ok(ids('Quanto custa?').includes('quanto-custa'))
  })

  it('texto vazio ou ausente não reconhece nada', () => {
    assert.deepEqual(ids(''), [])
    assert.deepEqual(ids('   '), [])
    assert.deepEqual(ids(undefined), [])
  })

  for (const texto of ['quanto ele demora?', 'carona amanhã', 'Caro Rômulo, obrigado']) {
    it(`"${texto}" não é objeção`, () => assert.deepEqual(ids(texto), []))
  }
})

describe('preenchimento', () => {
  it('troca {ARTIGO}, {NOME} e {URL}; sem demo fica o marcador', () => {
    const molde = 'site {ARTIGO} {NOME}: {URL}'
    assert.equal(preencher(molde, { empresa: 'Clínica X', links: {} }), `site da Clínica X: ${SEM_LINK}`)
    assert.equal(preencher(molde, { empresa: 'Escritório Y', links: { site: 'https://y.vercel.app' } }), 'site do Escritório Y: https://y.vercel.app')
    assert.equal(artigoDe('Clínica X'), 'da')
    assert.equal(artigoDe('Escritório Y'), 'do')
  })

  it('sem lead o texto volta intacto (a página mostra os marcadores)', () => {
    assert.equal(preencher('site {ARTIGO} {NOME}: {URL}'), 'site {ARTIGO} {NOME}: {URL}')
  })

  it('o link do WhatsApp leva o texto codificado; sem número, vazio', () => {
    assert.equal(linkDoWhatsApp('https://wa.me/5527999990000', 'Oi & tchau'), 'https://wa.me/5527999990000?text=Oi%20%26%20tchau')
    assert.equal(linkDoWhatsApp(undefined, 'Oi'), '')
    assert.equal(linkDoWhatsApp('', 'Oi'), '')
  })
})

describe('a esteira vem de site-mensagem', () => {
  const trechos = ROTEIRO.flatMap((p) => p.trechos)
  for (const [id, texto] of [['segunda', SEGUNDA], ['followup-sem-link', FOLLOWUP], ['followup-com-link', FOLLOWUP_COM_LINK]] as const) {
    it(`${id} é o mesmo texto que o n8n manda`, () => {
      const t = trechos.find((x) => x.id === id)
      assert.ok(t, `falta o trecho ${id}`)
      assert.equal(t.texto, texto)
      assert.equal(t.esteira, true)
    })
  }
})

// Todo texto que a colinha pode mostrar, para as varreduras abaixo.
const textosDoTrecho = (t: Trecho) => [t.titulo, t.texto, t.dica ?? '']
const TODOS_OS_TEXTOS: string[] = [
  ...CARDAPIO.flatMap((s) => Object.values(s).filter((v): v is string => typeof v === 'string')),
  CLIENTE_FUNDADOR,
  ...ROTEIRO.flatMap((p) => [p.titulo, p.objetivo, ...(p.perguntas ?? []), ...p.trechos.flatMap(textosDoTrecho)]),
  ...OBJECOES.flatMap((o) => [o.fala, ...textosDoTrecho(o.resposta)]),
  ...CDL.flatMap(textosDoTrecho),
]

describe('nenhum R$ fora do cardápio', () => {
  it('reconhece valor com espaço, sem espaço e com centavos', () => {
    assert.deepEqual(precosNoTexto('R$ 2.400'), ['R$ 2.400'])
    assert.deepEqual(precosNoTexto('R$990'), ['R$990'])
    assert.deepEqual(precosNoTexto('R$ 1.234,56'), ['R$ 1.234,56'])
  })

  it('o ponto final da frase não entra no valor', () => {
    assert.deepEqual(precosNoTexto('Fica R$ 990. Depois, R$ 69/mês.'), ['R$ 990', 'R$ 69'])
  })

  it('o preço de cada serviço está na lista do cardápio', () => {
    for (const s of CARDAPIO) {
      if (s.preco.startsWith('R$')) assert.ok(PRECOS_DO_CARDAPIO.includes(s.preco), `${s.id}: ${s.preco}`)
      for (const p of precosNoTexto(s.mensal ?? '')) assert.ok(PRECOS_DO_CARDAPIO.includes(p), `${s.id}: ${p}`)
    }
  })

  it('todo R$ da colinha é um preço do cardápio', () => {
    for (const texto of TODOS_OS_TEXTOS) {
      for (const p of precosNoTexto(texto)) assert.ok(PRECOS_DO_CARDAPIO.includes(p), `"${p}" fora do cardápio em: ${texto}`)
    }
  })

  it('a colinha não importa nada de finanças', () => {
    const fonte = readFileSync(new URL('./operations/colinha.ts', import.meta.url), 'utf8')
    const imports = fonte.split('\n').filter((l) => /^\s*import\b|\bimport\(|\brequire\(/.test(l))
    assert.ok(imports.length > 0)
    for (const l of imports) assert.ok(!/financas/i.test(l), l)
  })
})

describe('integridade do conteúdo', () => {
  it('ids de trecho únicos em roteiro, objeções e CDL', () => {
    const ids = [...ROTEIRO.flatMap((p) => p.trechos), ...OBJECOES.map((o) => o.resposta), ...CDL].map((t) => t.id)
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [])
  })

  it('todo serviço diz o que entrega e para quem', () => {
    for (const s of CARDAPIO) {
      assert.ok(s.entrega.trim(), `${s.id} sem entrega`)
      assert.ok(s.paraQuem.trim(), `${s.id} sem paraQuem`)
    }
  })

  it('toda objeção tem resposta e pelo menos um sinal', () => {
    for (const o of OBJECOES) {
      assert.ok(o.resposta.texto.trim(), `${o.id} sem resposta`)
      assert.ok(o.sinais.length > 0, `${o.id} sem sinal`)
    }
  })

  it('cada momento aparece uma vez no roteiro', () => {
    assert.deepEqual([...ROTEIRO.map((p) => p.momento)].sort(), [...MOMENTOS].sort())
  })

  it('os momentos que a ficha pede têm conteúdo para o produto', () => {
    const faltam = PRODUTOS.flatMap((produto) => [...new Set(CASOS.flatMap((c) => c[produto]))]
      .filter((m) => !temConteudoPara(m, produto)).map((m) => `${m} (${produto})`))
    assert.deepEqual(faltam, [])
  })

  it('placeholder só {NOME}, {ARTIGO} e {URL}; o resto é [colchete]', () => {
    const permitidos = new Set(['{NOME}', '{ARTIGO}', '{URL}'])
    for (const texto of TODOS_OS_TEXTOS) {
      for (const m of texto.match(/\{[A-Za-z_]+\}/g) ?? []) assert.ok(permitidos.has(m), `${m} em: ${texto}`)
    }
  })
})
