import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ENVIOS_MINIMOS_POR_BRACO, ganhadorDoPar, leituraDoAbMensagem, textoDoFaltam } from './operations/ab-mensagem.ts'
import { fisherExato } from './operations/ab-video.ts'
import type { CrmLead } from './operations/types.ts'

const AGORA = Date.parse('2026-11-01T15:00:00Z')
const DIA = 864e5
const dias = (n: number) => new Date(AGORA - n * DIA).toISOString()

let seq = 0
/** Um lead do Site enviado há `envio` dias, com a letra e o conjunto do sorteio. */
function lead(letra: string, elegiveis: string | undefined, extra: { nicho?: string; responde?: 'gente' | 'bot'; envio?: number } = {}): CrmLead {
  const chave = `ChIJ${seq++}`
  const { nicho = 'advocacia', responde, envio = 10 } = extra
  return {
    id: `site:${chave}`, produto: 'site', chave, empresa: chave, nicho, cidade: '', etapa: 'contato', sinal: 'enviado',
    subEtapa: '', estadoNaPlanilha: 'enviado', leitura: 'desconhecida',
    marcos: { enviado: dias(envio), ...(responde ? { respondeu: dias(envio - 1) } : {}) },
    ...(responde === 'bot' ? { resposta: { tipo: 'bot' as const, trecho: '' } } : {}),
    followupHoje: false, respostaNova: false, acervo: false, notas: 0, eventos: [], links: {}, divergencias: [],
    abordagem: { mensagem: letra, ...(elegiveis ? { elegiveis } : {}) },
  }
}
/** `n` leads de uma letra; os `resp` primeiros respondem (gente). */
const varios = (n: number, letra: string, elegiveis: string, resp = 0, nicho = 'advocacia') =>
  Array.from({ length: n }, (_, i) => lead(letra, elegiveis, { nicho, ...(i < resp ? { responde: 'gente' as const } : {}) }))

describe('A/B estratificado da 1ª mensagem', () => {
  it('sem a coluna ab_elegiveis: bloco vazio (só a explicação), e o histórico é contado como fora', () => {
    const l = leituraDoAbMensagem([lead('A', undefined), lead('B', undefined), lead('manual', undefined)], AGORA)
    assert.deepEqual(l, { inicio: null, pares: [], semColuna: 3, letraFora: 0 })
  })

  it('29 × 31 envios: só a contagem e "faltam"; taxa, p e veredito nem existem', () => {
    const l = leituraDoAbMensagem([...varios(29, 'A', 'AB', 20), ...varios(31, 'B', 'AB', 0)], AGORA)
    const ab = l.pares.find(p => p.par === 'AB')!
    assert.equal(ab.estado, 'faltam')
    assert.deepEqual([ab.x.enviados, ab.y.enviados], [29, 31])
    assert.deepEqual(ab.faltam, { x: 1, y: 0 })
    assert.equal(ab.numeros, undefined)
    assert.equal(ab.x.linha, undefined, 'sem espiar: nem as respostas do braço saem antes dos 30')
    assert.ok(ab.porNicho.every(n => !n.x.linha && !n.y.linha))
    assert.equal(textoDoFaltam(ab), 'Faltam 1 envio de A para ler.')
    assert.equal(l.inicio, dias(10))
  })

  it('30 × 30: taxa, Fisher exato bilateral e veredito', () => {
    const ab = leituraDoAbMensagem([...varios(30, 'A', 'AB', 12), ...varios(30, 'B', 'AB', 3)], AGORA).pares[0]
    assert.equal(ab.estado, 'lido')
    const n = ab.numeros!
    assert.deepEqual([n.taxaX, n.taxaY, n.diferencaPp], [0.4, 0.1, 30])
    assert.equal(n.p, fisherExato(12, 18, 3, 27))
    assert.ok(n.p < 0.1)
    assert.equal(n.ganhou, 'A')
    assert.equal(ab.x.linha?.responderam, 12)
    // Diferença de 20 pontos com p alto (ou p baixo com diferença pequena): não provado.
    const empate = leituraDoAbMensagem([...varios(30, 'A', 'AB', 7), ...varios(30, 'B', 'AB', 4)], AGORA).pares[0]
    assert.equal(empate.numeros!.ganhou, null)
  })

  it('a regra do ganhador: 20 pontos E p < 0,10, nos dois sentidos', () => {
    assert.equal(ganhadorDoPar('A', 'B', 20, 0.05), 'A')
    assert.equal(ganhadorDoPar('A', 'B', -25, 0.05), 'B')
    assert.equal(ganhadorDoPar('A', 'B', 19.9, 0.01), null)
    assert.equal(ganhadorDoPar('A', 'B', 40, 0.1), null)
  })

  it('robô não conta como resposta', () => {
    const leads = [...varios(30, 'A', 'AB', 0), ...varios(30, 'B', 'AB', 0)]
    for (const l of leads.slice(0, 10)) Object.assign(l, lead('A', 'AB', { responde: 'bot' }), { id: l.id })
    const ab = leituraDoAbMensagem(leads, AGORA).pares[0]
    assert.equal(ab.x.linha?.responderam, 0)
    assert.equal(ab.numeros!.diferencaPp, 0)
  })

  it('só compara entre quem podia receber as duas letras', () => {
    const l = leituraDoAbMensagem([
      ...varios(5, 'A', 'A'), // só A: não diz nada sobre a B
      ...varios(3, 'A', 'AC'), ...varios(2, 'C', 'AC'), // entram no A×C, não no A×B
      ...varios(4, 'A', 'ABC'), ...varios(4, 'B', 'ABC'), ...varios(4, 'C', 'ABC'),
      lead('manual', 'AB'), // a letra saiu sem o clique: fora
      lead('A', undefined), // histórico
    ], AGORA)
    const par = (p: string) => l.pares.find(x => x.par === p)
    assert.deepEqual([par('AB')!.x.enviados, par('AB')!.y.enviados], [4, 4])
    assert.deepEqual([par('AC')!.x.enviados, par('AC')!.y.enviados], [7, 6])
    assert.deepEqual([par('BC')!.x.enviados, par('BC')!.y.enviados], [4, 4])
    assert.deepEqual([l.semColuna, l.letraFora], [1, 1])
    // Sem C sorteado em lugar nenhum, A×C e B×C não aparecem; A×B aparece mesmo vazio.
    const soAB = leituraDoAbMensagem(varios(3, 'A', 'A'), AGORA)
    assert.deepEqual(soAB.pares.map(p => [p.par, p.x.enviados, p.y.enviados]), [['AB', 0, 0]])
  })

  it('estrato por nicho: cada nicho com os seus braços, do maior para o menor', () => {
    const l = leituraDoAbMensagem([
      ...varios(20, 'A', 'AB', 4, 'advocacia'), ...varios(20, 'B', 'AB', 2, 'advocacia'),
      ...varios(10, 'A', 'AB', 1, 'contabilidade'), ...varios(10, 'B', 'AB', 5, 'contabilidade'),
      ...varios(1, 'A', 'AB', 0, ''),
    ], AGORA)
    const ab = l.pares[0]
    assert.deepEqual(ab.porNicho.map(n => [n.nicho, n.x.enviados, n.y.enviados]),
      [['advocacia', 20, 20], ['contabilidade', 10, 10], ['Sem nicho', 1, 0]])
    assert.equal(ab.estado, 'lido') // 31 × 30
    assert.deepEqual(ab.porNicho.map(n => [n.x.linha?.responderam, n.y.linha?.responderam]), [[4, 2], [1, 5], [0, 0]])
    assert.equal(ENVIOS_MINIMOS_POR_BRACO, 30)
  })
})
