import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  FOLLOWUP_NOVO, VERSAO_DO_FOLLOWUP, VERSOES_ANTERIORES_DO_FOLLOWUP, fatoDoFollowup, leituraDoFollowup, lerRegistroFollowup,
  metadataDoFollowup, textoDoFollowup, textoDoRegistroFollowup,
} from './operations/followup-experimento.ts'
import { FOLLOWUP_PLUS } from '../server/plus-mensagem.ts'
import type { CrmLead } from './operations/types'

// O B de 29/10/2026 (decisão do PM): uma pergunta, sem preço nem link, com e sem o fato do Raio-X, por
// oferta. Só fixtures: nenhum lead, planilha ou WhatsApp real.
const OFERTAS = ['site', 'prumo', 'iris', 'estampa'] as const
const RAIO_X = 'https://exemplo-de-teste.vercel.app/raio-x'
const SEM_LINK = /https?:|www\.|wa\.me|\.vercel\.app/i
const perguntas = (t: string) => (t.match(/\?/g) ?? []).length

const fatos = {
  dominio: { links: { raioX: RAIO_X }, achados: [{ id: 'dominio-vencido', dominio: 'empresa.com.br', data: '2026-08-29' }] },
  fora: { links: { raioX: RAIO_X }, achados: [{ id: 'site-fora-do-ar', dominio: 'empresa.com.br' }] },
  busca: { links: { raioX: RAIO_X }, achados: [{ id: 'posicao-na-busca', consulta: 'dentista em vitória', posicao: 7, lidos: 20 }] },
}

describe('follow-up B de 29/10: os textos', () => {
  it('a versão subiu e a de 19/10 ficou como anterior', () => {
    assert.equal(VERSAO_DO_FOLLOWUP, 'followup-2026-10-29')
    assert.deepEqual([...VERSOES_ANTERIORES_DO_FOLLOWUP], ['followup-2026-10-19'])
  })

  for (const oferta of OFERTAS) for (const versao of ['semFato', 'comFato'] as const) {
    it(`${oferta} ${versao}: uma pergunta, sem R$, sem link, abre como o follow-up`, () => {
      const molde = FOLLOWUP_NOVO[oferta][versao]
      assert.equal(perguntas(molde), 1)
      assert.doesNotMatch(molde, /R\$|\d{3}/)
      assert.doesNotMatch(molde, SEM_LINK)
      assert.doesNotMatch(molde, /\bdemo\b/i, 'o guia diz "demonstração de site", nunca "demo"')
      assert.match(molde, /^Oi, é o Rômulo de novo[.,]/)
      assert.equal(molde.includes('{FATO}'), versao === 'comFato')
      if (oferta === 'site') assert.doesNotMatch(molde, /PRUMO/, 'o guia: sem "do PRUMO" no Site')
    })
  }

  for (const produto of [...OFERTAS, 'plus'] as const) for (const [nome, lead] of [['sem fato', {}], ...Object.entries(fatos)] as const) {
    it(`${produto} ${nome}: o texto pronto segue com uma pergunta, sem R$ e sem link`, () => {
      const fato = fatoDoFollowup(lead)
      const t = textoDoFollowup(produto, 'Empresa de teste', 'B', produto === 'plus' ? 'site' : undefined, 'CONTROLE', fato)
      assert.notEqual(t, 'CONTROLE')
      assert.equal(perguntas(t), 1, t)
      assert.doesNotMatch(t, /R\$|\{|\}/)
      assert.doesNotMatch(t, SEM_LINK)
    })
  }
})

describe('follow-up B de 29/10: a variante com fato só aparece com fato', () => {
  it('cada fato do Raio-X entra literal no texto com fato', () => {
    for (const lead of Object.values(fatos)) {
      const fato = fatoDoFollowup(lead)!
      assert.ok(fato, 'fato verificável presente')
      const t = textoDoFollowup('site', 'Empresa', 'B', undefined, 'CONTROLE', fato)
      assert.equal(t, FOLLOWUP_NOVO.site.comFato.replace('{FATO}', fato))
      assert.ok(t.includes(fato))
    }
  })

  it('sem Raio-X publicado, sem achado verificável ou sem fato passado: o texto sem fato', () => {
    const semFato = [
      {}, { links: {} }, { links: { raioX: RAIO_X } }, { links: { raioX: RAIO_X }, achados: [] },
      { links: { raioX: RAIO_X }, achados: [{ id: 'nota-baixa', nota: 3.1 }] },
      { links: { raioX: 'http://inseguro.com/raio-x' }, achados: fatos.fora.achados },
      { achados: fatos.fora.achados },
      { links: { raioX: RAIO_X }, achados: [{ id: 'posicao-na-busca', consulta: 'x', posicao: 2, lidos: 10 }] },
    ]
    for (const lead of semFato) assert.equal(fatoDoFollowup(lead as any), null, JSON.stringify(lead))
    for (const oferta of OFERTAS) {
      for (const fato of [undefined, null, '']) {
        assert.equal(textoDoFollowup(oferta, 'Empresa', 'B', undefined, 'CONTROLE', fato), FOLLOWUP_NOVO[oferta].semFato.split('{EMPRESA}').join('Empresa'))
      }
    }
  })

  it('consulta com "?" não vira uma segunda pergunta: cai no texto sem fato', () => {
    const lead = { links: { raioX: RAIO_X }, achados: [{ id: 'posicao-na-busca', consulta: 'dentista perto?', posicao: 7, lidos: 20 }] }
    assert.equal(fatoDoFollowup(lead), null)
    assert.equal(textoDoFollowup('site', 'E', 'B', undefined, '', 'Fato com pergunta?'), FOLLOWUP_NOVO.site.semFato)
    assert.equal(textoDoFollowup('site', 'E', 'B', undefined, '', 'Veja https://x.com'), FOLLOWUP_NOVO.site.semFato)
  })

  it('o braço A não muda: devolve o controle, com ou sem fato', () => {
    const fato = fatoDoFollowup(fatos.busca)
    for (const produto of [...OFERTAS, 'plus'] as const) {
      assert.equal(textoDoFollowup(produto, 'Empresa', 'A', 'site', 'CONTROLE INTACTO', fato), 'CONTROLE INTACTO')
    }
  })

  it('Plus: a saudação da Ordem e o T.F.A. do FOLLOWUP_PLUS, nas duas variantes', () => {
    const abertura = FOLLOWUP_PLUS.site.slice(0, FOLLOWUP_PLUS.site.indexOf(' é o Rômulo'))
    for (const fato of [null, fatoDoFollowup(fatos.fora)]) {
      for (const oferta of OFERTAS) {
        const t = textoDoFollowup('plus', 'Empresa', 'B', oferta, '', fato)
        assert.ok(t.startsWith(`${abertura} é o Rômulo de novo`), t)
        assert.ok(t.endsWith('\n\nT.F.A.'))
        assert.doesNotMatch(t, /^Oi/)
      }
    }
  })
})

describe('follow-up: a versão de 19/10 continua lida e medida à parte', () => {
  const dia = 864e5
  const inicio = Date.parse('2026-10-20T12:00:00Z')
  const iso = (d: number) => new Date(inicio + d * dia).toISOString()
  const ANTIGA = VERSOES_ANTERIORES_DO_FOLLOWUP[0]
  const registroAntigo = (braco: 'A' | 'B') => `[${ANTIGA}] ${JSON.stringify({ braco, versao: ANTIGA })}`
  function lead(id: string, registro: string, respondeu: boolean): CrmLead {
    return {
      id: `site:${id}`, chave: id, produto: 'site', empresa: `Empresa ${id}`, nicho: 'teste', cidade: '', etapa: 'contato', sinal: 'enviado', subEtapa: '',
      estadoNaPlanilha: 'enviado', leitura: 'desconhecida', marcos: { enviado: iso(1), ...(respondeu ? { respondeu: iso(4) } : {}) },
      ...(respondeu ? { resposta: { tipo: 'interesse', trecho: 'Quero ver', em: iso(4) } } : {}),
      followupHoje: false, respostaNova: false, acervo: false, notas: 0, links: {}, divergencias: [],
      eventos: [{ tipo: 'followup_enviado', em: iso(3), origem: 'manual', fonte: 'teste', rotulo: 'Envio confirmado', texto: registro }],
    } as CrmLead
  }

  it('o registro de 19/10 já gravado continua sendo lido, sem inventar o campo novo', () => {
    assert.deepEqual(lerRegistroFollowup(registroAntigo('B')), { braco: 'B', versao: ANTIGA })
    assert.deepEqual(lerRegistroFollowup(registroAntigo('A')), { braco: 'A', versao: ANTIGA })
    // Versão desconhecida, prefixo e corpo que não batem, ou JSON quebrado: nada.
    assert.equal(lerRegistroFollowup(`[followup-2026-10-01] ${JSON.stringify({ braco: 'A', versao: 'followup-2026-10-01' })}`), null)
    assert.equal(lerRegistroFollowup(`[${ANTIGA}] ${JSON.stringify({ braco: 'A', versao: VERSAO_DO_FOLLOWUP })}`), null)
    assert.equal(lerRegistroFollowup(`[${VERSAO_DO_FOLLOWUP}] {quebrado`), null)
  })

  it('hoje só se grava a versão nova; o B pode levar se saiu com fato', () => {
    assert.throws(() => textoDoRegistroFollowup({ braco: 'A', versao: ANTIGA }))
    const meta = metadataDoFollowup('site', 'qualquer')
    assert.equal(meta.versao, VERSAO_DO_FOLLOWUP)
    assert.deepEqual(lerRegistroFollowup(textoDoRegistroFollowup({ braco: 'B', versao: VERSAO_DO_FOLLOWUP, fato: true })), { braco: 'B', versao: VERSAO_DO_FOLLOWUP, fato: true })
    assert.deepEqual(lerRegistroFollowup(textoDoRegistroFollowup({ braco: 'B', versao: VERSAO_DO_FOLLOWUP })), { braco: 'B', versao: VERSAO_DO_FOLLOWUP })
    assert.doesNotMatch(textoDoRegistroFollowup({ braco: 'A', versao: VERSAO_DO_FOLLOWUP, fato: true }), /fato/, 'o A não tem variante')
  })

  it('uma taxa por versão: 30/30 da antiga não abre a taxa da nova, nem se soma a ela', () => {
    const antigos = [...Array.from({ length: 30 }, (_, i) => lead(`a${i}`, registroAntigo('A'), i % 2 === 0)), ...Array.from({ length: 30 }, (_, i) => lead(`b${i}`, registroAntigo('B'), i % 3 === 0))]
    const novos = [lead('n1', textoDoRegistroFollowup({ braco: 'A', versao: VERSAO_DO_FOLLOWUP }), true), lead('n2', textoDoRegistroFollowup({ braco: 'B', versao: VERSAO_DO_FOLLOWUP, fato: false }), false)]
    const nova = leituraDoFollowup([...antigos, ...novos])
    assert.equal(nova.versao, VERSAO_DO_FOLLOWUP)
    assert.deepEqual(nova.bracos, { A: { enviados: 1, responderam: 1 }, B: { enviados: 1, responderam: 0 } })
    assert.equal(nova.lido, false, 'a regra de 30 por braço vale para a versão nova sozinha')
    assert.equal(nova.numeros, undefined)
    const antiga = leituraDoFollowup([...antigos, ...novos], ANTIGA)
    assert.deepEqual(antiga.bracos, { A: { enviados: 30, responderam: 15 }, B: { enviados: 30, responderam: 10 } })
    assert.equal(antiga.lido, true)
    assert.ok(Number.isFinite(antiga.numeros?.p))
  })

  it('o lead medido na versão antiga não entra na nova, mesmo com uma confirmação nova depois', () => {
    const l = lead('duas', registroAntigo('B'), true)
    l.eventos.push({ tipo: 'followup_enviado', em: iso(5), origem: 'manual', fonte: 'teste', rotulo: 'Envio confirmado', texto: textoDoRegistroFollowup({ braco: 'A', versao: VERSAO_DO_FOLLOWUP }) })
    assert.equal(leituraDoFollowup([l]).bracos.A.enviados, 0)
    assert.equal(leituraDoFollowup([l], ANTIGA).bracos.B.enviados, 1)
  })
})
