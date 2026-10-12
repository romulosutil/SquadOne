import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DIAS_ATE_A_LEITURA, SAL_DO_AB_VIDEO, bracoDoLead, fisherExato, hashDoLead, leituraDoAbVideo, textoDaDiferenca, textoDoP, veredito,
} from './operations/ab-video.ts'
import { chaveDe, resultados } from './operations/resultados.ts'
import type { CrmLead } from './operations/types.ts'

const AGORA = Date.parse('2026-11-01T15:00:00Z')
const DIA = 864e5
const dias = (n: number) => new Date(AGORA - n * DIA).toISOString()

const lead = (chave: string, extra: Partial<CrmLead> = {}): CrmLead => ({
  id: `site:${chave}`, produto: 'site', chave, empresa: chave, nicho: 'advocacia', cidade: '', etapa: 'contato', sinal: 'enviado',
  subEtapa: '', estadoNaPlanilha: 'enviado', leitura: 'desconhecida', marcos: { enviado: dias(10) }, followupHoje: false,
  respostaNova: false, acervo: false, notas: 0, eventos: [], links: {}, divergencias: [], ...extra,
})

/** Os primeiros `n` place_ids (fictícios) de cada braço pelo sorteio do teste. */
function idsPorBraco(n: number): { video: string[]; semVideo: string[] } {
  const video: string[] = []
  const semVideo: string[] = []
  for (let i = 0; video.length < n || semVideo.length < n; i++) {
    const id = `ChIJteste${i}`
    const lista = bracoDoLead(id) === 'video' ? video : semVideo
    if (lista.length < n) lista.push(id)
  }
  return { video, semVideo }
}

/**
 * Um teste completo: `respCom` respostas de gente no braço com vídeo, `respSem` no sem, todos
 * marcados como o sorteio manda, mensagem A, enviados há `diasDoUltimo` dias (o primeiro, 2 dias antes).
 */
function teste(opcoes: { com?: number; sem?: number; respCom: number; respSem: number; diasDoUltimo?: number }): CrmLead[] {
  const { com = 20, sem = 20, respCom, respSem, diasDoUltimo = 8 } = opcoes
  const ids = idsPorBraco(Math.max(com, sem))
  const fazer = (id: string, i: number, braco: 'video' | 'sem-video', responde: boolean) => lead(id, {
    marcos: { enviado: dias(diasDoUltimo + (i === 0 ? 2 : 0)), ...(responde ? { respondeu: dias(diasDoUltimo - 1) } : {}) },
    abordagem: { mensagem: 'A', video: braco },
  })
  return [
    ...ids.video.slice(0, com).map((id, i) => fazer(id, i, 'video', i < respCom)),
    ...ids.semVideo.slice(0, sem).map((id, i) => fazer(id, i, 'sem-video', i < respSem)),
  ]
}

describe('sorteio do braço', () => {
  it('hash estável: a mesma tabela em qualquer máquina (FNV-1a + fmix32 sobre "<sal>:<place_id>")', () => {
    const casos: Array<[string, number, 'video' | 'sem-video']> = [
      ['ChIJN1t_tDeuEmsRUsoyG83frY4', 2600612550, 'video'],
      ['ChIJ2eUgeAK6j4ARbn5u_wAGqWA', 2928160444, 'video'],
      ['ChIJabc', 394500709, 'sem-video'],
      ['site-teste', 2911801242, 'video'],
    ]
    for (const [id, hash, braco] of casos) {
      assert.equal(hashDoLead(id, SAL_DO_AB_VIDEO), hash, id)
      assert.equal(bracoDoLead(id), braco, id)
      assert.equal(bracoDoLead(`  ${id}\n`), braco, 'espaço em volta não troca o braço')
    }
    assert.equal(bracoDoLead('site-teste', 'outro'), 'sem-video', 'outro sal, outro sorteio')
  })

  it('1000 place_ids: perto de 50/50, e trocar o sal sorteia de novo (não inverte tudo)', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `ChIJ${(i * 7919 + 13).toString(36)}x${i}`)
    const comVideo = ids.filter(id => bracoDoLead(id) === 'video').length
    assert.ok(comVideo >= 450 && comVideo <= 550, `com vídeo: ${comVideo}`)
    const iguais = ids.filter(id => bracoDoLead(id) === bracoDoLead(id, 'outro-teste')).length
    assert.ok(iguais >= 400 && iguais <= 600, `mesmo braço com outro sal: ${iguais}`)
  })
})

describe('Fisher exato bilateral', () => {
  it('bate com o fisher.test do R e com a conta exata em frações', () => {
    const casos: Array<[[number, number, number, number], number]> = [
      [[3, 1, 1, 3], 0.485714],
      [[1, 9, 11, 3], 0.002759],
      [[0, 5, 5, 0], 0.007937],
      [[10, 10, 2, 18], 0.013814],
      [[9, 11, 5, 15], 0.320266],
      [[8, 12, 3, 17], 0.155187],
      [[5, 15, 5, 15], 1],
      [[0, 0, 0, 0], 1],
    ]
    for (const [[a, b, c, d], p] of casos) assert.ok(Math.abs(fisherExato(a, b, c, d) - p) < 1e-6, `${[a, b, c, d]}: ${fisherExato(a, b, c, d)}`)
  })

  it('simétrico nos braços e recusa contagem que não é contagem', () => {
    assert.ok(Math.abs(fisherExato(10, 10, 2, 18) - fisherExato(2, 18, 10, 10)) < 1e-12)
    assert.throws(() => fisherExato(-1, 2, 3, 4), RangeError)
    assert.throws(() => fisherExato(1.5, 2, 3, 4), RangeError)
  })
})

describe('veredito', () => {
  it('só +20 pontos E p < 0,10; a borda dos 20 vale, a do p não', () => {
    assert.equal(veredito(20, 0.0999), 'video-ganhou')
    assert.equal(veredito(19.99, 0.01), 'nao-provado')
    assert.equal(veredito(40, 0.1), 'nao-provado')
    assert.equal(veredito(-30, 0.001), 'nao-provado', 'vídeo pior nunca "ganha"')
  })

  it('texto: diferença com sinal e p com vírgula', () => {
    assert.equal(textoDaDiferenca(20.0000001), '+20 pontos')
    assert.equal(textoDaDiferenca(-5), '−5 pontos')
    assert.equal(textoDaDiferenca(1), '+1 ponto')
    assert.equal(textoDoP(0.0138), 'p = 0,014')
    assert.equal(textoDoP(0.32), 'p = 0,32')
    assert.equal(textoDoP(0.0004), 'p < 0,001')
  })
})

describe('critério "video" no placar', () => {
  it('coluna vazia é "Sem vídeo"; "video" é "Com vídeo"', () => {
    assert.equal(chaveDe(lead('a', { abordagem: { video: 'video' } }), 'video'), 'Com vídeo')
    assert.equal(chaveDe(lead('b', { abordagem: { video: 'sem-video' } }), 'video'), 'Sem vídeo')
    assert.equal(chaveDe(lead('c'), 'video'), 'Sem vídeo')
    const linhas = resultados([lead('a', { abordagem: { video: 'video' } }), lead('c'), lead('d')], 'video', 'tudo', AGORA).linhas
    assert.deepEqual(linhas.map(l => [l.chave, l.enviados]), [['Sem vídeo', 2], ['Com vídeo', 1]])
  })
})

describe('leitura do A/B', () => {
  it('sem a coluna preenchida, não existe teste (a tela não muda)', () => {
    assert.equal(leituraDoAbVideo([lead('a'), lead('b', { abordagem: { mensagem: 'A' } })], AGORA), null)
    assert.equal(leituraDoAbVideo([lead('p', { produto: 'prumo', abordagem: { video: 'video' } })], AGORA), null, 'só o Site')
  })

  it('menos de 20 em um braço: amostra insuficiente, sem taxa nem veredito', () => {
    const l = leituraDoAbVideo(teste({ sem: 19, respCom: 10, respSem: 0 }), AGORA)
    assert.equal(l?.estado, 'amostra-insuficiente')
    assert.equal(l?.comVideo.enviados, 20)
    assert.equal(l?.semVideo.enviados, 19)
    assert.equal(l?.numeros, undefined)
  })

  it('amostra completa antes dos 7 dias do último envio: espera a leitura, sem taxa', () => {
    const l = leituraDoAbVideo(teste({ respCom: 10, respSem: 2, diasDoUltimo: 3 }), AGORA)
    assert.equal(l?.estado, 'aguardando-leitura')
    assert.equal(l?.leituraEm, new Date(AGORA - 3 * DIA + DIAS_ATE_A_LEITURA * DIA).toISOString())
    assert.equal(l?.numeros, undefined)
  })

  it('lido: 10 de 20 contra 2 de 20 é +40 pontos com p = 0,014: vídeo ganhou', () => {
    const l = leituraDoAbVideo(teste({ respCom: 10, respSem: 2 }), AGORA)
    assert.equal(l?.estado, 'lido')
    assert.equal(l?.nicho, 'advocacia')
    assert.equal(l?.mensagem, 'A')
    assert.equal(l?.foraDoSorteio, 0)
    assert.equal(l?.numeros?.diferencaPp, 40)
    assert.ok(Math.abs((l?.numeros?.p ?? 1) - 0.013814) < 1e-6)
    assert.equal(l?.numeros?.veredito, 'video-ganhou')
  })

  it('lido: 9 de 20 contra 5 de 20 dá os 20 pontos, mas p = 0,32: não provado', () => {
    const l = leituraDoAbVideo(teste({ respCom: 9, respSem: 5 }), AGORA)
    assert.equal(l?.numeros?.diferencaPp, 20)
    assert.equal(l?.numeros?.veredito, 'nao-provado')
  })

  it('o robô não é resposta: só "respondeu de gente" conta', () => {
    const leads = teste({ respCom: 10, respSem: 2 }).map((l, i) => (l.abordagem?.video === 'video' && i < 6 ? { ...l, resposta: { tipo: 'bot' as const, trecho: '' } } : l))
    const l = leituraDoAbVideo(leads, AGORA)
    assert.equal(l?.comVideo.responderam, 4)
    assert.equal(l?.numeros?.veredito, 'nao-provado')
  })

  it('quem está no teste: nicho e letra do braço com vídeo, desde o primeiro envio marcado; vazia conta como sem vídeo', () => {
    const base = teste({ respCom: 0, respSem: 0 })
    const inicio = Math.min(...base.map(l => Date.parse(l.marcos.enviado ?? '')))
    const extras = [
      // sem a coluna, mesmo nicho e letra, depois do início: braço sem vídeo
      lead('vazia', { marcos: { enviado: dias(8) }, abordagem: { mensagem: 'A' } }),
      // antes do início: fora
      lead('antes', { marcos: { enviado: new Date(inicio - DIA).toISOString() }, abordagem: { mensagem: 'A' } }),
      // outra letra ou outro nicho, marcados: fora do desenho
      lead('letra-b', { marcos: { enviado: dias(8) }, abordagem: { mensagem: 'B', video: 'video' } }),
      lead('outro-nicho', { nicho: 'dedetizadora', marcos: { enviado: dias(8) }, abordagem: { mensagem: 'A', video: 'sem-video' } }),
      // marcado e não enviado: ainda não conta
      lead('pronto', { etapa: 'novo', sinal: 'pronto', marcos: {}, abordagem: { mensagem: 'A', video: 'video' } }),
    ]
    const l = leituraDoAbVideo([...base, ...extras], AGORA)
    assert.equal(l?.semVideo.enviados, 21)
    assert.equal(l?.comVideo.enviados, 20)
    assert.equal(l?.foraDoDesenho, 2)
    assert.equal(l?.inicio, new Date(inicio).toISOString())
    // "vazia" foi sorteada para vídeo? então é braço trocado; senão, está no lugar.
    assert.equal(l?.foraDoSorteio, bracoDoLead('vazia') === 'video' ? 1 : 0)
  })

  it('coluna diferente do sorteio é contada para conferir antes de ler', () => {
    const leads = teste({ respCom: 0, respSem: 0 })
    const trocado = leads.find(l => l.abordagem?.video === 'sem-video')!
    trocado.abordagem = { ...trocado.abordagem, video: 'video' }
    assert.equal(leituraDoAbVideo(leads, AGORA)?.foraDoSorteio, 1)
  })
})
