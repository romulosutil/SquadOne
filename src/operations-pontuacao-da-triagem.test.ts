import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'
import {
  ENVIOS_MINIMOS_DO_NICHO, JANELA_DA_ADERENCIA_DIAS, SINAL_DE_EQUIPE, TETO, aderenciaDosNichos, chaveDoNicho, notaDoGoogle,
  pontuacaoDaTriagem, type AderenciaDoNicho, type EntradaDaPontuacao,
} from './operations/pontuacao-da-triagem.ts'
import { textoDasPartes } from './operations/triagem.ts'
import type { CrmLead } from './operations/types.ts'

// A pontuação da Triagem (29/10/2026, "Triagem (soma 100)" do PM). Tudo fixture: nenhum lead real.

const CELULAR = 'https://wa.me/5527999990001'
const FIXO = 'https://wa.me/552733330001'
const prumo = (e: Partial<EntradaDaPontuacao> = {}): EntradaDaPontuacao => ({ ofertaPropria: false, ...e })
const oferta = (e: Partial<EntradaDaPontuacao> = {}): EntradaDaPontuacao => ({ ofertaPropria: true, ...e })
const nicho = (enviados: number, quisVer: number, taxaDaOferta: number | null): AderenciaDoNicho => ({ enviados, quisVer, taxaDaOferta })
const partes = (e: EntradaDaPontuacao) => {
  const p = pontuacaoDaTriagem(e)
  return [p.dor, p.decisor, p.nicho, p.porte, p.total]
}

describe('pontuacaoDaTriagem: dor dos serviços PRUMO (até 50)', () => {
  // [nome, entrada, dor esperada]; decisor, nicho e porte ficam fixos (sem WhatsApp, sem amostra, sem porte).
  const casos: Array<[string, EntradaDaPontuacao, number]> = [
    ['nada sabido: 0, nunca presumido', prumo(), 0],
    ['site próprio, nota boa e muitas avaliações: 0', prumo({ temSiteProprio: true, nota: '4,8 (300)' }), 0],
    ['sem site no cadastro: 15', prumo({ temSiteProprio: false }), 15],
    ['site próprio ainda não sabido não é "sem site"', prumo({ nota: '4,8 (300)' }), 0],
    ['Raio-X achou sem-site: 15', prumo({ achados: [{ id: 'sem-site' }] }), 15],
    ['botão "Site" levando para rede social: 15', prumo({ temSiteProprio: true, achados: [{ id: 'site-e-rede-social' }] }), 15],
    ['site fora do ar: 15', prumo({ temSiteProprio: true, achados: [{ id: 'site-fora-do-ar' }] }), 15],
    ['domínio vencido: 15', prumo({ temSiteProprio: true, achados: [{ id: 'dominio-vencido' }] }), 15],
    ['fora do ar e vencido não somam duas vezes: 15', prumo({ temSiteProprio: true, achados: [{ id: 'site-fora-do-ar' }, { id: 'dominio-vencido' }] }), 15],
    ['sem site + domínio antigo vencido: 30', prumo({ temSiteProprio: false, achados: [{ id: 'dominio-vencido' }] }), 30],
    ['nota 4,2: 8', prumo({ temSiteProprio: true, nota: '4,2 (80)' }), 8],
    ['nota 4,3 não é abaixo de 4,3: 0', prumo({ temSiteProprio: true, nota: '4,3 (80)' }), 0],
    ['sem nota na planilha, a do Raio-X: 8', prumo({ temSiteProprio: true, achados: [{ id: 'nota-baixa', nota: 3.9 }] }), 8],
    ['achado nota-baixa sem número não pontua (a régua é 4,3)', prumo({ temSiteProprio: true, achados: [{ id: 'nota-baixa' }] }), 0],
    ['19 avaliações: 5', prumo({ temSiteProprio: true, nota: '4,8 (19)' }), 5],
    ['20 avaliações: 0', prumo({ temSiteProprio: true, nota: '4,8 (20)' }), 0],
    ['nota sem contagem não inventa poucas avaliações', prumo({ temSiteProprio: true, nota: '4,8' }), 0],
    ['contagem do Raio-X quando a planilha não tem', prumo({ temSiteProprio: true, nota: '4,8', achados: [{ id: 'poucas-avaliacoes', avaliacoes: 6 }] }), 5],
    ['zero avaliações explícitas: 5', prumo({ temSiteProprio: true, nota: '0 (0)' }), 5],
    ['11º na busca: 7', prumo({ temSiteProprio: true, achados: [{ id: 'posicao-na-busca', posicao: 11, lidos: 20 }] }), 7],
    ['10º na busca está no top 10: 0', prumo({ temSiteProprio: true, achados: [{ id: 'posicao-na-busca', posicao: 10, lidos: 20 }] }), 0],
    ['fora dos 20 lidos: 7', prumo({ temSiteProprio: true, achados: [{ id: 'posicao-na-busca', lidos: 20 }] }), 7],
    ['fora dos 5 lidos não prova fora do top 10: 0', prumo({ temSiteProprio: true, achados: [{ id: 'posicao-na-busca', lidos: 5 }] }), 0],
    ['tudo junto bate os 50 exatos', prumo({ temSiteProprio: false, nota: '3,1 (4)',
      achados: [{ id: 'dominio-vencido' }, { id: 'posicao-na-busca', posicao: 40, lidos: 60 }] }), 50],
  ]
  for (const [nome, entrada, dor] of casos) {
    it(`${nome}`, () => {
      const p = pontuacaoDaTriagem(entrada)
      assert.equal(p.dor, dor)
      assert.equal(p.total, dor + 0 + 10 + 0)
    })
  }

  it('o porquê da dor diz o que pontuou, na ordem da decisão', () => {
    const p = pontuacaoDaTriagem(prumo({ temSiteProprio: false, nota: '4,1 (12)' }))
    assert.deepEqual(p.porque.dor, ['sem site', 'nota abaixo de 4,3', 'menos de 20 avaliações'])
  })
})

describe('pontuacaoDaTriagem: Iris e estamparias (a dor sai dos sinais da oferta)', () => {
  const casos: Array<[string, EntradaDaPontuacao, number, number]> = [
    // [nome, entrada, dor, porte]
    ['sem sinal', oferta({ sinais: 'nenhum sinal no site' }), 0, 0],
    ['dois sinais do Iris: 20', oferta({ sinais: 'convênio · ABA' }), 20, 0],
    ['seis sinais param em 50', oferta({ sinais: 'a · b · c · d · e · f' }), 50, 0],
    ['as marcas do caçador não são sinal', oferta({ sinais: 'perfil não confirmado (sem site) · profissional que atende sozinho? · TEA' }), 10, 0],
    ['a equipe no site vai para o porte, não para a dor', oferta({ sinais: `TEA · ${SINAL_DE_EQUIPE}` }), 10, 10],
    ['estamparia: silk, DTF e pede orçamento', oferta({ sinais: 'silk · DTF · pede orçamento' }), 30, 0],
    ['nota baixa, sem site e domínio vencido não entram na oferta própria',
      oferta({ sinais: 'silk', nota: '3 (2)', temSiteProprio: false, achados: [{ id: 'dominio-vencido' }] }), 10, 0],
  ]
  for (const [nome, entrada, dor, porte] of casos) {
    it(nome, () => {
      const p = pontuacaoDaTriagem(entrada)
      assert.equal(p.dor, dor)
      assert.equal(p.porte, porte)
    })
  }

  it('o sinal de equipe existe com esse rótulo nas ofertas do caçador (prumo-ofertas.json)', () => {
    const json = JSON.parse(fs.readFileSync(new URL('../deploy/dell/claude-ops/prumo-ofertas.json', import.meta.url), 'utf8'))
    const rotulos = (json.ofertas.iris.sinais as Array<[string, string]>).map(([r]) => r)
    assert.ok(rotulos.includes(SINAL_DE_EQUIPE), rotulos.join(', '))
  })
})

describe('pontuacaoDaTriagem: acesso ao decisor (até 20)', () => {
  const casos: Array<[string, Partial<EntradaDaPontuacao>, number]> = [
    ['sem WhatsApp', {}, 0],
    ['celular publicado (Prospects, sem a coluna de origem)', { whatsapp: CELULAR }, 15],
    ['celular com link no site', { whatsapp: CELULAR, origemWhatsapp: 'link no site' }, 15],
    ['fixo com link no site (recepção)', { whatsapp: FIXO, origemWhatsapp: 'link no site (fixo)' }, 8],
    ['número que não se lê como celular fica com o menor dos publicados', { whatsapp: 'https://wa.me/0' }, 8],
    ['não confirmado: celular do Google', { whatsapp: CELULAR, origemWhatsapp: 'não confirmado: celular do Google' }, 5],
    ['decisor confirmado na qualificação', { whatsapp: FIXO, decisorConfirmado: true }, 20],
  ]
  for (const [nome, extra, decisor] of casos) {
    it(`${nome}: ${decisor}`, () => {
      assert.equal(pontuacaoDaTriagem(prumo(extra)).decisor, decisor)
      assert.equal(pontuacaoDaTriagem(oferta(extra)).decisor, decisor, 'a mesma régua nas ofertas próprias')
    })
  }
})

describe('pontuacaoDaTriagem: aderência do nicho (até 20) e porte (até 10)', () => {
  const casos: Array<[string, AderenciaDoNicho | undefined, number]> = [
    ['nicho sem envio na janela: 10', undefined, 10],
    [`menos de ${ENVIOS_MINIMOS_DO_NICHO} envios: 10, mesmo com taxa alta`, nicho(29, 20, 0.1), 10],
    ['oferta sem nenhum "quero ver" para comparar: 10', nicho(40, 0, 0), 10],
    ['na média da oferta: 10', nicho(40, 4, 0.1), 10],
    ['metade da média: 5', nicho(40, 2, 0.1), 5],
    ['o dobro da média: 20', nicho(40, 8, 0.1), 20],
    ['o triplo para em 20', nicho(40, 12, 0.1), 20],
    ['nenhum "quero ver" com amostra: 0', nicho(40, 0, 0.1), 0],
  ]
  for (const [nome, aderencia, pontos] of casos) {
    it(nome, () => assert.equal(pontuacaoDaTriagem(prumo(aderencia ? { aderencia } : {})).nicho, pontos))
  }

  it('porte: EPP ou DEMAIS pelo CNPJ vale 10; sem porte, 0', () => {
    assert.equal(pontuacaoDaTriagem(prumo({ porte: 'EPP' })).porte, 10)
    assert.equal(pontuacaoDaTriagem(prumo({ porte: 'DEMAIS' })).porte, 10)
    assert.equal(pontuacaoDaTriagem(prumo()).porte, 0)
    assert.equal(pontuacaoDaTriagem(prumo({ sinais: SINAL_DE_EQUIPE })).porte, 0, 'a equipe no site só vale nas ofertas próprias')
  })
})

describe('pontuacaoDaTriagem: limites', () => {
  // Combinações de todos os sinais: nenhuma passa do teto de cada parte nem de 100, e o total é a soma.
  const achados = [[], [{ id: 'site-fora-do-ar' }], [{ id: 'dominio-vencido' }, { id: 'sem-site' }, { id: 'posicao-na-busca', lidos: 30 }]]
  const entradas: EntradaDaPontuacao[] = []
  for (const ofertaPropria of [false, true])
    for (const temSiteProprio of [undefined, true, false])
      for (const nota of [undefined, '1 (0)', '4,9 (900)', 'ilegível'])
        for (const a of achados)
          for (const whatsapp of [undefined, CELULAR, FIXO])
            for (const decisorConfirmado of [false, true])
              for (const aderencia of [undefined, nicho(100, 100, 0.01), nicho(31, 0, 0.5)])
                for (const porte of [undefined, 'EPP' as const])
                  entradas.push({ ofertaPropria, temSiteProprio, nota, achados: a, whatsapp, decisorConfirmado, aderencia, porte,
                    sinais: `a · b · c · d · e · f · ${SINAL_DE_EQUIPE}` })
  it(`${entradas.length} combinações: cada parte no seu teto, soma = total, total de 0 a 100`, () => {
    for (const e of entradas) {
      const p = pontuacaoDaTriagem(e)
      const msg = JSON.stringify(e)
      for (const parte of ['dor', 'decisor', 'nicho', 'porte'] as const) {
        assert.ok(Number.isInteger(p[parte]) && p[parte] >= 0 && p[parte] <= TETO[parte], `${parte} ${p[parte]}: ${msg}`)
      }
      assert.equal(p.total, p.dor + p.decisor + p.nicho + p.porte, msg)
      assert.ok(p.total >= 0 && p.total <= 100, msg)
    }
  })
  it('o máximo é 100 exatos, nos dois caminhos da dor', () => {
    const topo = { decisorConfirmado: true, aderencia: nicho(40, 40, 0.1), porte: 'EPP' as const }
    assert.deepEqual(partes(prumo({ ...topo, temSiteProprio: false, nota: '2 (3)',
      achados: [{ id: 'site-fora-do-ar' }, { id: 'posicao-na-busca', posicao: 15, lidos: 20 }] })), [50, 20, 20, 10, 100])
    assert.deepEqual(partes(oferta({ ...topo, sinais: 'a · b · c · d · e' })), [50, 20, 20, 10, 100])
  })
  it('o mínimo é 0: sem dor, sem WhatsApp, nicho que nunca quis ver, sem porte', () => {
    assert.deepEqual(partes(prumo({ temSiteProprio: true, nota: '4,9 (900)', aderencia: nicho(50, 0, 0.2) })), [0, 0, 0, 0, 0])
  })
})

describe('aderenciaDosNichos: a regra única de Números (quisVer e enviadoNosUltimos)', () => {
  const AGORA = Date.parse('2026-10-29T13:00:00Z')
  const dias = (n: number) => new Date(AGORA - n * 86_400_000).toISOString()
  type L = Parameters<typeof aderenciaDosNichos>[0][number]
  const l = (produto: CrmLead['produto'], nichoDoLead: string, extra: Partial<L> = {}): L =>
    ({ produto, nicho: nichoDoLead, etapa: 'contato', marcos: { enviado: dias(5) }, ...extra })
  const quis = (produto: CrmLead['produto'], n: string, tipo: 'interesse' | 'licenca' = 'interesse'): L =>
    l(produto, n, { marcos: { enviado: dias(5), respondeu: dias(4) }, resposta: { tipo, trecho: 'Pode mandar', em: dias(4) } as L['resposta'] })

  it('conta por oferta e nicho, com a taxa da oferta inteira para comparar', () => {
    const leads = [
      ...Array.from({ length: 6 }, () => quis('iris', 'Psicólogo')), ...Array.from({ length: 24 }, () => l('iris', 'Psicólogo')),
      ...Array.from({ length: 30 }, () => l('iris', 'Fonoaudiólogo')),
      // Fora: outra oferta (o Site não é da Triagem), fora da janela, nunca enviado.
      ...Array.from({ length: 30 }, () => quis('site', 'Psicólogo')),
      l('iris', 'Psicólogo', { marcos: { enviado: dias(JANELA_DA_ADERENCIA_DIAS + 1) } }),
      l('iris', 'Psicólogo', { marcos: {} }),
    ]
    const a = aderenciaDosNichos(leads, ['prumo', 'iris', 'estampa'], AGORA)
    assert.deepEqual(a.get('iris:psicologo'), { enviados: 30, quisVer: 6, taxaDaOferta: 0.1 })
    assert.deepEqual(a.get('iris:fonoaudiologo'), { enviados: 30, quisVer: 0, taxaDaOferta: 0.1 })
    assert.equal(a.has('site:psicologo'), false)
    assert.equal(pontuacaoDaTriagem(oferta({ aderencia: a.get('iris:psicologo') })).nicho, 20, 'o dobro da média')
    assert.equal(pontuacaoDaTriagem(oferta({ aderencia: a.get('iris:fonoaudiologo') })).nicho, 0)
  })

  it('robô, saudação automática, negativa e exclusão não são "quero ver"; a licença é', () => {
    const conversaDoRobo = { desde: dias(6), mensagens: 1, entradas: { gente: 0, recepcao: 0, robo: 1 },
      ultima: { direcao: 'entrada' as const, em: dias(4), trecho: 'Atendimento automático', papel: 'robo' as const } }
    const leads: L[] = [
      quis('prumo', 'Odonto', 'licenca'),
      l('prumo', 'Odonto', { marcos: { enviado: dias(5), respondeu: dias(4) }, resposta: { tipo: 'bot', trecho: 'Olá!', em: dias(4) } as L['resposta'] }),
      l('prumo', 'Odonto', { marcos: { enviado: dias(5), respondeu: dias(4) }, resposta: { tipo: 'negativa', trecho: 'Não', em: dias(4) } as L['resposta'] }),
      l('prumo', 'Odonto', { marcos: { enviado: dias(5), respondeu: dias(4) }, resposta: { tipo: 'exclusao', trecho: 'Apague', em: dias(4) } as L['resposta'] }),
      { ...quis('prumo', 'Odonto'), conversa: conversaDoRobo } as L,
    ]
    assert.deepEqual(aderenciaDosNichos(leads, ['prumo'], AGORA).get('prumo:odonto'), { enviados: 5, quisVer: 1, taxaDaOferta: 0.2 })
  })

  it('sem envio não há grupo; nicho vazio conta na média da oferta e não forma grupo', () => {
    assert.equal(aderenciaDosNichos([], ['prumo'], AGORA).size, 0)
    const a = aderenciaDosNichos([quis('prumo', ''), l('prumo', 'Odonto')], ['prumo'], AGORA)
    assert.deepEqual([...a], [['prumo:odonto', { enviados: 1, quisVer: 0, taxaDaOferta: 0.5 }]])
  })

  it('a chave ignora acento, caixa e espaço sobrando', () => {
    assert.equal(chaveDoNicho({ produto: 'prumo', nicho: '  Clínica   Odontológica ' }), 'prumo:clinica odontologica')
  })
})

describe('a tela: o selo e as partes', () => {
  it('as quatro partes com o teto, e a dor com o porquê', () => {
    const p = pontuacaoDaTriagem(prumo({ temSiteProprio: false, nota: '4,1 (50)', whatsapp: CELULAR, porte: 'EPP' }))
    assert.equal(textoDasPartes(p), 'Dor 23/50 (sem site, nota abaixo de 4,3) · Decisor 15/20 · Nicho 10/20 · Porte 10/10')
    assert.equal(p.total, 58)
  })
  it('sem dor, nada entre parênteses', () => {
    assert.equal(textoDasPartes(pontuacaoDaTriagem(prumo())), 'Dor 0/50 · Decisor 0/20 · Nicho 10/20 · Porte 0/10')
  })
  it('notaDoGoogle lê vírgula, ponto e a contagem (a mesma do servidor)', () => {
    assert.deepEqual(notaDoGoogle('4,5 (10)'), { nota: 4.5, avaliacoes: 10 })
    assert.deepEqual(notaDoGoogle('sem nota'), {})
  })
})
