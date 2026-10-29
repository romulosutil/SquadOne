import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { REGRAS_DO_RITMO } from './operations/trava-de-ritmo.ts'
import { LIMITE_DA_RODADA } from '../server/rodada-comercial.ts'

// Fonte única das travas (29/10/2026): em 22–23/10 o ritmo caiu para 15/dia, 2/h, 30 min e dez
// pendentes por rodada, e o CLAUDE.md e as decisões do PM seguiram dizendo 30/dia, 12/h e 5 min
// por uma semana; o mix do PM somava 30 contra um teto de 15. Estes documentos não têm número
// próprio: citam REGRAS_DO_RITMO, e este teste falha quando um deles fica para trás.
//
// O que já não vale (a história de cada mudança) fica entre <!-- ritmo-histórico --> e
// <!-- /ritmo-histórico -->: o leitor vê o texto, o teste não o confere.

const DOCUMENTOS = ['CLAUDE.md', 'docs/referencia/perfis-e-experimentos.md', 'docs/PRUMO-DECISOES-PM-2026-10-28.md']

const ler = (caminho: string) => readFileSync(new URL(`../${caminho}`, import.meta.url), 'utf8')

const semHistorico = (texto: string) => texto.replace(/<!-- ritmo-histórico -->[\s\S]*?<!-- \/ritmo-histórico -->/g, ' ')

const paragrafos = (texto: string) => semHistorico(texto).split(/\n\s*\n/)

/**
 * Uma citação só conta perto de quem fala do primeiro contato: os "20 por dia" dos áudios ou o
 * resumo matinal "1 por dia" não são trava. Olha os 200 caracteres antes dela, no mesmo parágrafo.
 */
const VOCABULARIO_DO_RITMO = /primeir[oa]s? contatos?|ritmo|REGRAS_DO_RITMO|teto (?:único|compartilhado|do dia|de primeiros)|rodada/i
const falaDoRitmo = (paragrafo: string, indice = 0) => VOCABULARIO_DO_RITMO.test(paragrafo.slice(Math.max(0, indice - 200), indice))

const NUMERO_POR_EXTENSO: Record<string, number> = { dois: 2, dez: 10, quinze: 15, trinta: 30 }
const numero = (s: string) => NUMERO_POR_EXTENSO[s.toLowerCase()] ?? Number(s)
const N = String.raw`(\d+|dois|dez|quinze|trinta)`

const CITACOES: { nome: string; esperado: number; padrao: RegExp }[] = [
  { nome: 'teto do dia', esperado: Math.max(...REGRAS_DO_RITMO.tetosPorSemana),
    padrao: new RegExp(String.raw`\b${N}\s*(?:primeiros contatos\s*)?(?:compartilhados\s*)?(?:\/dia\b|por dia\b)`, 'gi') },
  { nome: 'teto por hora', esperado: REGRAS_DO_RITMO.porHora,
    padrao: new RegExp(String.raw`\b${N}\s*(?:\/h\b|por hora\b)`, 'gi') },
  { nome: 'intervalo', esperado: REGRAS_DO_RITMO.intervaloMs / 60_000,
    padrao: new RegExp(String.raw`(?:\b1 a cada|intervalo(?: mínimo)?(?: de)?)\s*${N}\s*min\b|\b${N}\s*min(?:utos)?\s+entre\b`, 'gi') },
  { nome: 'pendentes por rodada', esperado: LIMITE_DA_RODADA,
    padrao: new RegExp(String.raw`\b${N}\s+pendentes(?: sem resposta humana)? por rodada`, 'gi') },
]

describe('ritmo nos documentos', () => {
  it('a rampa é um teto só, para "o teto do dia" ser um número', () => {
    assert.equal(new Set(REGRAS_DO_RITMO.tetosPorSemana).size, 1)
  })

  for (const caminho of DOCUMENTOS) {
    it(`${caminho} cita os números de REGRAS_DO_RITMO`, () => {
      const erradas: string[] = []
      let citacoes = 0
      for (const p of paragrafos(ler(caminho))) {
        for (const { nome, esperado, padrao } of CITACOES) {
          for (const m of p.matchAll(padrao)) {
            if (!falaDoRitmo(p, m.index)) continue
            citacoes++
            const valor = numero(m[1] ?? m[2])
            if (valor !== esperado) erradas.push(`${nome}: "${m[0].trim()}" (vale ${esperado})`)
          }
        }
      }
      assert.deepEqual(erradas, [], `${caminho} cita números de ritmo que não são os de REGRAS_DO_RITMO`)
      assert.ok(citacoes > 0, `${caminho} não cita o ritmo; o teste deixou de olhar para ele?`)
    })
  }
})
