import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { FOLLOWUP, FOLLOWUP_COM_LINK, FOLLOWUP_RAIO_X, SEGUNDA, SEGUNDA_RAIO_X, artigoDe } from '../server/site-mensagem.ts'
import {
  CARDAPIO, CDL, ETAPAS_DA_OFERTA, FRASE_MAPA_E_GRATIS, FRASE_SOB_PROPOSTA, OBJECOES, PRECOS_DO_CARDAPIO, ROTEIRO, SEM_LINK, SOB_PROPOSTA,
  colinhaDoLead, linkDoWhatsApp, objecao, objecaoDaOferta, objecoesNoTexto, passo, precoDaTabela, precoParaOCliente, precosNoTexto, preencher, textoDasFaixasIris,
  type LeadDaColinha, type Momento, type Trecho,
} from './operations/colinha.ts'
import type { CrmEtapa, CrmProduto, CrmTipoDeResposta } from './operations/types.ts'

const PRODUTOS: CrmProduto[] = ['site', 'prumo']
const MOMENTOS: Momento[] = ['primeiro-contato', 'pode-mandar', 'followup', 'convite-mapa', 'mapa', 'conversa', 'proposta', 'fechamento']

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
  { nome: 'novo: nenhuma sugestão de primeiro contato', etapa: 'novo', site: [], prumo: [] },
  { nome: 'contato sem resposta: sem envio sugerido', etapa: 'contato', site: [], prumo: [] },
  { nome: 'contato só com o robô: sem envio sugerido', etapa: 'contato', tipo: 'bot', trecho: 'Mensagem automática: em breve retornaremos.', site: [], prumo: [] },
  { nome: 'contato com interesse: material pedido e conversa', etapa: 'contato', tipo: 'interesse', trecho: 'pode mandar', site: ['pode-mandar', 'conversa'], prumo: ['pode-mandar', 'conversa'] },
  { nome: 'contato neutro: seguir a conversa', etapa: 'contato', tipo: 'neutra', trecho: 'quem é você?', site: ['conversa'], prumo: ['conversa'] },
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

  // 14/10/2026: lead do Site que recebeu a C (o raio-x) respondeu "sim" e a colinha oferecia só o site.
  it('o site que recebeu a C ganha o raio-x e o demo, nunca só o site', () => {
    const c = { ...lead('site', 'contato', 'interesse', 'Sim'), empresa: 'Jéssica Barbosa Advocacia', abordagem: { mensagem: 'C' },
      links: { site: 'https://demo-x.vercel.app', raioX: 'https://demo-x.vercel.app/raio-x' } }
    const ids = idsDosTrechos(c)
    assert.ok(ids.includes('segunda-raio-x'))
    assert.ok(!ids.includes('segunda'))
    const texto = preencher(colinhaDoLead(c).momentos[0].trechos[0].texto, c)
    assert.ok(texto.startsWith('Aqui está o raio-x da Jéssica Barbosa Advocacia:\nhttps://demo-x.vercel.app/raio-x\n'), texto)
    assert.ok(texto.includes('https://demo-x.vercel.app\n'), 'o demo vai junto')
    // Sem o link do raio-x na planilha, o marcador aparece em vez de cair no texto do site.
    const semLink = { ...c, links: { site: c.links.site } }
    assert.ok(preencher(colinhaDoLead(semLink).momentos[0].trechos[0].texto, semLink).includes('[link do Raio-X]'))
  })

  // 14/10/2026 (demo sob pedido): o Raio-X avulso vai sozinho; o demo, só depois do botão "Gerar demo".
  it('Raio-X avulso: sem demo, só o raio-x (sem preço); com o demo pedido, a mensagem do demo', () => {
    const c = { ...lead('site', 'contato', 'interesse', 'Sim'), empresa: 'Clínica Nova', abordagem: { mensagem: 'C' },
      links: { raioX: 'https://raio-x-prumo.vercel.app/clinica-nova' } }
    assert.deepEqual(idsDosTrechos(c).filter((id) => id.startsWith('segunda') || id.startsWith('demo')), ['segunda-raio-x-sem-demo', 'segunda-preco'])
    const sem = preencher(colinhaDoLead(c).momentos[0].trechos[0].texto, c)
    assert.ok(sem.startsWith('Aqui está o raio-x da Clínica Nova:\nhttps://raio-x-prumo.vercel.app/clinica-nova\n'), sem)
    assert.ok(!sem.includes('[link do demo]') && !sem.includes('R$'), sem)
    const comDemo = { ...c, links: { ...c.links, site: 'https://demo-nova.vercel.app' } }
    assert.ok(idsDosTrechos(comDemo).includes('demo-depois-do-raio-x'))
    assert.ok(!idsDosTrechos(comDemo).includes('segunda-raio-x'))
  })

  it('follow-ups históricos permanecem consultáveis sem sugerir envio por silêncio', () => {
    const c = { ...lead('site', 'contato'), empresa: 'Jéssica Barbosa Advocacia', abordagem: { mensagem: 'C' } }
    assert.deepEqual(idsDosTrechos(c), [])
    assert.ok(preencher(FOLLOWUP_RAIO_X, c).includes('como a Jéssica Barbosa Advocacia aparece'))
    assert.deepEqual(idsDosTrechos({ ...c, abordagem: { mensagem: 'A' } }), [])
    assert.match(passo('followup').titulo, /histórica/)
    assert.match(passo('primeiro-contato').objetivo, /não autoriza nova abordagem/)
  })

  it('a primeira mensagem C não promete 3 pontos', () => {
    const t = ROTEIRO.flatMap((p) => p.trechos).find((x) => x.id === 'primeira-c')!
    assert.ok(!/\b3 pontos/.test(t.texto), t.texto)
  })

  it('o prumo com interesse recebe o Raio-X, com o link quando ele existe e o marcador quando não', () => {
    const sem = lead('prumo', 'contato', 'interesse', 'pode me enviar o link sim')
    assert.equal(idsDosTrechos(sem)[0], 'segunda-prumo')
    const trecho = colinhaDoLead(sem).momentos[0].trechos[0]
    assert.match(preencher(trecho.texto, sem), /^Aqui está o raio-x d[oa] .+:\n\[link do Raio-X\]\n/)
    const com = { ...sem, links: { raioX: 'https://raio-x-prumo.vercel.app/x' } }
    assert.match(preencher(trecho.texto, com), /^Aqui está o raio-x d[oa] .+:\nhttps:\/\/raio-x-prumo\.vercel\.app\/x\n/)
    assert.deepEqual(precosNoTexto(preencher(trecho.texto, com)), [], 'sem preço no frio')
  })

  it('recusa não gera novo pitch nem troca automática de oferta', () => {
    for (const texto of ['Obrigado, mas já temos site', 'trabalhamos com uma agência', 'não, obrigado']) {
      assert.deepEqual(idsDasObjecoes(lead('site', 'contato', 'negativa', texto)), [])
      assert.deepEqual(idsDasObjecoes(lead('prumo', 'contato', 'negativa', texto)), [])
    }
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
  for (const [id, texto] of [['segunda', SEGUNDA], ['segunda-raio-x', SEGUNDA_RAIO_X], ['followup-sem-link', FOLLOWUP],
    ['followup-com-link', FOLLOWUP_COM_LINK], ['followup-raio-x', FOLLOWUP_RAIO_X]] as const) {
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
  SOB_PROPOSTA,
  FRASE_SOB_PROPOSTA,
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
    assert.deepEqual(precosNoTexto('Fica R$ 690. Depois, R$ 39/mês.'), ['R$ 690', 'R$ 39'])
  })

  it('o preço de cada serviço está na lista do cardápio', () => {
    for (const s of CARDAPIO) {
      for (const p of precosNoTexto(s.preco)) assert.ok(PRECOS_DO_CARDAPIO.includes(p), `${s.id}: ${p}`)
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

// Decisão de 08/10/2026, com a hierarquia de 09/10: Respondido, Fonte e Fonte em
// dia são "sob proposta" para o cliente (o valor só na proposta por escrito); os
// diagnósticos são grátis; não há cliente fundador.
describe('sob proposta e sem cliente fundador', () => {
  const servico = (id: string) => CARDAPIO.find((s) => s.id === id)!

  it('Respondido, Fonte e Fonte em dia são sob proposta; Raio-X, Mapa e Encontrado, não', () => {
    assert.deepEqual(CARDAPIO.filter((s) => s.sobProposta).map((s) => s.id), ['respondido', 'fonte', 'fonte-em-dia'])
  })

  it('o que se diz ao cliente de um serviço sob proposta não tem valor', () => {
    assert.deepEqual(precosNoTexto(FRASE_SOB_PROPOSTA), [])
    for (const s of CARDAPIO.filter((x) => x.sobProposta)) {
      assert.equal(precoParaOCliente(s), SOB_PROPOSTA)
      assert.deepEqual(precosNoTexto(precoParaOCliente(s)), [], s.id)
    }
  })

  it('a base interna da proposta continua com o valor da tabela', () => {
    assert.equal(precoDaTabela(servico('respondido')), 'R$ 2.400 + R$ 290/mês (só depois de uma conversa, nunca no WhatsApp frio)')
    assert.equal(precoDaTabela(servico('fonte')), 'R$ 1.500 (a partir de, 50/50, escopo confirmado)')
    assert.equal(precoDaTabela(servico('fonte-em-dia')), 'R$ 190/mês (opcional, até 10 mudanças por mês, depois dos 30 dias de ajustes)')
  })

  it('o Encontrado diz o preço ao cliente; os dois diagnósticos, "grátis"', () => {
    assert.equal(precoParaOCliente(servico('encontrado')), 'R$ 690 + R$ 39/mês (paga só depois de ver no ar)')
    assert.equal(precoParaOCliente(servico('raio-x')), 'grátis')
    assert.equal(precoParaOCliente(servico('mapa')), 'grátis')
  })

  it('fora da proposta, nenhuma mensagem ao cliente cita o valor de um serviço sob proposta', () => {
    const sobProposta = new Set(CARDAPIO.filter((s) => s.sobProposta).flatMap((s) => precosNoTexto(`${s.preco} ${s.mensal ?? ''}`)))
    const mensagens = [
      ...ROTEIRO.filter((p) => p.momento !== 'proposta').flatMap((p) => p.trechos),
      ...OBJECOES.map((o) => o.resposta),
      ...CDL,
    ]
    for (const t of mensagens) {
      for (const p of precosNoTexto(t.texto)) assert.ok(!sobProposta.has(p), `${t.id} cita ${p}`)
    }
  })

  it('não há cliente fundador nem desconto em troca de depoimento', () => {
    for (const texto of TODOS_OS_TEXTOS) {
      assert.ok(!/cliente fundador|fundadores|vaga de fundador/i.test(texto), texto)
    }
    // Nenhuma mensagem ao cliente fala de depoimento (a dica pode dizer que não há).
    const mensagens = [...ROTEIRO.flatMap((p) => p.trechos), ...OBJECOES.map((o) => o.resposta), ...CDL]
    for (const t of mensagens) assert.ok(!/depoimento/i.test(t.texto), t.id)
  })

  it('"tá caro" não oferece desconto: valor, só pagar depois de ver no ar, menor ou mais tarde', () => {
    const texto = OBJECOES.find((o) => o.id === 'ta-caro')!.resposta.texto
    assert.deepEqual(precosNoTexto(texto), [])
    assert.ok(!/desconto|pagam menos/i.test(texto))
    assert.match(texto, /só pagam depois de ver/)
    assert.match(texto, /parte menor/)
    assert.match(texto, /mais para frente/)
  })
})

// Hierarquia de serviços de 09/10/2026 (prumo, 00-contexto/decisoes.md): ver →
// arrumar → manter, o Mapa grátis só para empresa com equipe, a Fonte só depois dele.
describe('hierarquia: ver, arrumar, manter', () => {
  const servico = (id: string) => CARDAPIO.find((s) => s.id === id)!

  it('o cardápio vem na ordem do caminho, cada oferta com o seu tipo', () => {
    assert.deepEqual(CARDAPIO.map((s) => [s.id, s.etapa, s.tipo]), [
      ['raio-x', 'ver', 'diagnostico'],
      ['mapa', 'ver', 'diagnostico'],
      ['encontrado', 'arrumar', 'produto'],
      ['respondido', 'arrumar', 'produto'],
      ['anuncios', 'arrumar', 'produto'],
      ['redes', 'arrumar', 'produto'],
      ['fonte', 'arrumar', 'projeto'],
      ['fonte-em-dia', 'manter', 'mensalidade'],
    ])
    const ordem = CARDAPIO.map((s) => ETAPAS_DA_OFERTA.indexOf(s.etapa))
    assert.deepEqual(ordem, [...ordem].sort((a, b) => a - b))
  })

  it('os preços são os da tabela', () => {
    assert.deepEqual(CARDAPIO.map((s) => [s.id, s.preco, s.mensal ?? '']), [
      ['raio-x', 'grátis', ''],
      ['mapa', 'grátis', ''],
      ['encontrado', 'R$ 690', 'R$ 39/mês'],
      ['respondido', 'R$ 2.400', 'R$ 290/mês'],
      ['anuncios', 'R$ 590/mês', ''],
      ['redes', 'R$ 790/mês', ''],
      ['fonte', 'R$ 1.500', ''],
      ['fonte-em-dia', 'R$ 190/mês', ''],
    ])
    assert.match(servico('encontrado').condicao ?? '', /depois de ver no ar/)
    assert.match(servico('respondido').condicao ?? '', /depois de uma conversa/)
    assert.match(servico('fonte').condicao ?? '', /50\/50.*escopo confirmado/)
  })

  it('o Respondido tem antes e depois medidos', () => {
    assert.match(servico('respondido').entrega, /Antes e depois medidos/)
  })

  it('o Mapa é só para empresa com equipe e não tem preço', () => {
    const mapa = servico('mapa')
    assert.match(mapa.paraQuem, /equipe/)
    assert.match(mapa.entrega, /16 perguntas/)
    assert.match(mapa.entrega, /45 minutos/)
    assert.ok(!mapa.sobProposta && !mapa.mensal && !mapa.condicao)
    assert.deepEqual(precosNoTexto(Object.values(mapa).join(' ')), [])
  })

  it('nada do Mapa cita valor: o convite, a devolutiva e as objeções dele', () => {
    const doMapa = [
      ...passo('convite-mapa').trechos, ...passo('mapa').trechos,
      objecao('mapa-e-pago').resposta, objecao('sem-tempo').resposta,
    ]
    for (const t of doMapa) for (const x of textosDoTrecho(t)) assert.deepEqual(precosNoTexto(x), [], `${t.id}: ${x}`)
    for (const p of passo('mapa').perguntas ?? []) assert.deepEqual(precosNoTexto(p), [], p)
  })

  it('"isso é pago?" responde com a frase da decisão', () => {
    assert.equal(FRASE_MAPA_E_GRATIS, 'Não cobramos pelo Mapa. Cobramos se vocês quiserem construir a Fonte depois.')
    assert.ok(objecao('mapa-e-pago').resposta.texto.startsWith(FRASE_MAPA_E_GRATIS))
  })

  // O R$ 1.500 do Mapa do Cliente saiu, mas voltou em 14/10/2026 como o preço de entrada da Fonte.
  it('saíram o Mapa do Cliente, o abatimento, o Organizado e o Manter vivo', () => {
    for (const texto of TODOS_OS_TEXTOS) {
      assert.ok(!/Mapa do Cliente|abatid|abatimento|organizado|Manter vivo/i.test(texto), texto)
    }
  })
})

describe('Mapa opcional, sem inferir necessidade pelo porte ou material', () => {
  const RAIO_X = 'https://raio-x-prumo.vercel.app/sorriso'
  const comRaioX = (produto: CrmProduto, tipo: CrmTipoDeResposta, equipe?: boolean): LeadDaColinha =>
    ({ ...lead(produto, 'contato', tipo, 'gostei, pode mandar'), links: { raioX: RAIO_X }, ...(equipe === undefined ? {} : { equipe }) })

  it('equipe e interesse não impõem convite ou proposta', () => {
    assert.deepEqual(idsDosMomentos(comRaioX('prumo', 'interesse', true)), ['pode-mandar', 'conversa'])
    assert.ok(!idsDosTrechos(comRaioX('prumo', 'interesse', true)).includes('mapa-convite'))
  })

  it('resposta neutra após material permanece conversa', () => {
    assert.deepEqual(idsDosMomentos(comRaioX('prumo', 'neutra', true)), ['conversa'])
  })

  it('não introduz objeções de Mapa antes de haver pedido', () => {
    const ids = idsDasObjecoes(comRaioX('prumo', 'interesse', true))
    assert.ok(!ids.includes('mapa-e-pago') && !ids.includes('sem-tempo'), ids.join(', '))
  })

  it('a objeção reconhecida no texto vem primeiro', () => {
    const l = { ...comRaioX('prumo', 'neutra', true), resposta: { tipo: 'neutra' as const, trecho: 'Legal. Isso é pago?' } }
    assert.equal(idsDasObjecoes(l)[0], 'mapa-e-pago')
    const corrido = { ...l, resposta: { tipo: 'neutra' as const, trecho: 'Agora não dá, tô sem tempo' } }
    assert.equal(idsDasObjecoes(corrido)[0], 'sem-tempo')
  })

  it('empresa pequena (sem equipe) não recebe o convite', () => {
    assert.ok(!idsDosMomentos(comRaioX('prumo', 'interesse', false)).includes('convite-mapa'))
    assert.ok(!idsDasObjecoes(comRaioX('prumo', 'interesse', false)).includes('mapa-e-pago'))
  })

  it('porte desconhecido não gera convite; dica exige problema e aceite', () => {
    assert.ok(!idsDosMomentos(comRaioX('prumo', 'interesse')).includes('convite-mapa'))
    assert.match(passo('convite-mapa').trechos[0].dica ?? '', /equipe/)
  })

  it('antes do Raio-X não há convite', () => {
    assert.ok(!idsDosMomentos({ ...lead('prumo', 'contato', 'interesse', 'pode mandar'), equipe: true }).includes('convite-mapa'))
  })

  it('o Site antes da venda nunca recebe o convite', () => {
    assert.ok(!idsDosMomentos(comRaioX('site', 'interesse', true)).includes('convite-mapa'))
    assert.ok(!idsDasObjecoes(comRaioX('site', 'interesse', true)).includes('mapa-e-pago'))
  })

  it('a mensagem: 3 a 5 linhas, o Rômulo do Prumo, o raio-x, o link numa linha só, uma pergunta no fim, sem emoji nem preço', () => {
    const texto = passo('convite-mapa').trechos.find((t) => t.id === 'mapa-convite')!.texto
    const linhas = texto.split('\n').filter((l) => l.trim())
    assert.ok(linhas.length >= 3 && linhas.length <= 5, `${linhas.length} linhas`)
    assert.match(linhas[0], /Aqui é o Rômulo, do Prumo/)
    assert.match(texto, /se essa investigação ajudar/)
    assert.match(texto, /16 perguntas/)
    assert.ok(linhas.includes('[link das 16 perguntas]'), 'o link sozinho numa linha')
    assert.ok(linhas[linhas.length - 1].trim().endsWith('?'))
    assert.equal(texto.split('?').length - 1, 1, 'uma pergunta só')
    assert.ok(!/\p{Extended_Pictographic}/u.test(texto), 'sem emoji')
    assert.deepEqual(precosNoTexto(texto), [])
    const preenchido = preencher(texto, { empresa: 'Clínica Sorriso', links: { raioX: RAIO_X } })
    assert.match(preenchido, /Para entender a rotina da Clínica Sorriso,/)
  })

  it('quem respondeu as 16 perguntas recebe a devolutiva do Mapa', () => {
    const respondeu: LeadDaColinha = { ...lead('prumo', 'contato'), sinal: 'diagnostico' }
    assert.deepEqual(idsDosMomentos(respondeu), ['mapa'])
    assert.ok(!idsDosTrechos(respondeu).includes('proposta-fonte'))
    assert.ok(!idsDosMomentos({ ...lead('site', 'contato'), sinal: 'diagnostico' }).includes('mapa'))
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

  it('placeholder só {NOME}, {ARTIGO}, {O_A}, {URL} e {RAIO_X}; o resto é [colchete]', () => {
    const permitidos = new Set(['{NOME}', '{ARTIGO}', '{O_A}', '{URL}', '{RAIO_X}'])
    for (const texto of TODOS_OS_TEXTOS) {
      for (const m of texto.match(/\{[A-Za-z_]+\}/g) ?? []) assert.ok(permitidos.has(m), `${m} em: ${texto}`)
    }
  })
})


it('preço de implantação e Fonte responde com bases vigentes, sem gate de diagnóstico', () => {
  const resposta = colinhaDoLead(lead('prumo', 'contato', 'licenca', 'Quanto custa?')).objecoes.find(o => o.id === 'quanto-custa')!.resposta.texto
  assert.ok(resposta.includes(precoDaTabela(CARDAPIO.find(s => s.id === 'respondido')!)))
  assert.ok(resposta.includes(precoDaTabela(CARDAPIO.find(s => s.id === 'fonte')!)))
  assert.match(resposta, /sem exigir diagnóstico ou reunião/)
})

it('exclusão e recusa interrompem sugestões mesmo em proposta e encerramento', () => {
  for (const etapa of ['novo', 'contato', 'proposta', 'ganho', 'perdido'] as const) {
    assert.deepEqual(colinhaDoLead(lead('site', etapa, 'exclusao', 'Pode apagar')).momentos, [])
    assert.deepEqual(colinhaDoLead(lead('site', etapa, 'negativa', 'Não, obrigado')).momentos, [])
  }
})

// A objeção de preço é da oferta que o lead discute (Plus: a oferta dele), e o valor só sai da tabela dela. Sem este teste,
// um "quanto custa" da Iris ou da estamparia podia voltar a responder com o R$ 690 do Site sem nada falhar.
describe('objecaoDaOferta: o preço da objeção é o da oferta do lead', () => {
  const PRECO_DO_SITE = ['R$ 690', 'R$ 39']
  const quanto = objecao('quanto-custa')
  const caro = objecao('ta-caro')
  const doProduto = (produto: CrmProduto, oferta?: 'site' | 'prumo' | 'iris' | 'estampa') =>
    ({ produto, ...(oferta ? { plus: { oferta } } : {}) })

  it('Site mantém a objeção intacta, com o R$ 690 e o R$ 39 do cardápio', () => {
    for (const o of [quanto, caro]) assert.deepEqual(objecaoDaOferta(o, doProduto('site')), o)
    for (const valor of PRECO_DO_SITE) assert.ok(quanto.resposta.texto.includes(valor), valor)
  })

  it('Iris usa as faixas por ficha ativa e pede a quantidade, nunca o preço do Site', () => {
    const r = objecaoDaOferta(quanto, doProduto('iris'))
    assert.ok(r.resposta.texto.includes(textoDasFaixasIris()))
    assert.match(r.resposta.texto, /Quantas vocês têm hoje\?/)
    assert.ok(!r.resposta.texto.includes('R$ 690'), 'a implantação do Site não entra na Iris (o R$ 39 é a 1ª faixa dela)')
    assert.ok(!objecaoDaOferta(caro, doProduto('iris')).resposta.texto.includes('R$ 690'))
  })

  it('PRUMO informa bases vigentes sem exigir diagnóstico ou reunião', () => {
    const r = objecaoDaOferta(quanto, doProduto('prumo'))
    assert.match(r.resposta.texto, /Raio-X e Mapa são gratuitos/)
    assert.ok(r.resposta.texto.includes(precoDaTabela(CARDAPIO.find(s => s.id === 'respondido')!)))
    assert.ok(r.resposta.texto.includes(precoDaTabela(CARDAPIO.find(s => s.id === 'fonte')!)))
    assert.match(r.resposta.texto, /sem exigir diagnóstico ou reunião/)
    assert.ok(!r.resposta.texto.includes('R$ 690'))
  })

  it('Estamparia não tem preço definido: nenhum R$ em nenhuma das duas objeções', () => {
    for (const o of [quanto, caro]) assert.ok(!objecaoDaOferta(o, doProduto('estampa')).resposta.texto.includes('R$'), o.id)
    assert.match(objecaoDaOferta(quanto, doProduto('estampa')).resposta.texto, /ainda precisa ser definido/)
  })

  it('Plus segue a oferta do lead, não o Site; oferta ausente pergunta qual solução', () => {
    assert.ok(objecaoDaOferta(quanto, doProduto('plus', 'iris')).resposta.texto.includes(textoDasFaixasIris()))
    assert.ok(!objecaoDaOferta(quanto, doProduto('plus', 'estampa')).resposta.texto.includes('R$'))
    assert.deepEqual(objecaoDaOferta(quanto, doProduto('plus', 'site')), quanto)
    const semOferta = objecaoDaOferta(quanto, doProduto('plus'))
    assert.match(semOferta.resposta.texto, /Qual solução vocês estão considerando/)
    assert.ok(!semOferta.resposta.texto.includes('R$'))
  })

  it('só "quanto-custa" e "tá caro" mudam por oferta; as outras objeções passam intactas', () => {
    for (const o of OBJECOES.filter((x) => x.id !== 'quanto-custa' && x.id !== 'ta-caro')) {
      for (const produto of ['site', 'prumo', 'iris', 'estampa'] as const) assert.equal(objecaoDaOferta(o, doProduto(produto)), o, `${o.id} (${produto})`)
    }
  })
})
