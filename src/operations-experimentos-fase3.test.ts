import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { leituraDoFollowup, metadataDoFollowup, textoDoFollowup, textoDoRegistroFollowup, lerRegistroFollowup } from './operations/followup-experimento.ts'
import { leituraDoTestePlus, INICIO_DO_TESTE_PLUS } from './operations/plus-experimento.ts'
import { leituraDoAbMensagem } from './operations/ab-mensagem.ts'
import { colinhaDoLead } from './operations/colinha.ts'
import { montarDossie } from './operations/copiloto.ts'
import { alocarAberturasPrumo } from './operations/abertura-prumo.ts'
import { aberturaConfirmadaDoLead, ultimoConviteConfirmado, PREFIXO_CONVITE } from './operations/decisoes-comerciais.ts'
import type { CrmLead } from './operations/types'

const dia = 864e5
const agora = INICIO_DO_TESTE_PLUS + 30 * dia
const iso = (dias: number) => new Date(INICIO_DO_TESTE_PLUS + dias * dia).toISOString()
function lead(id: string, produto: CrmLead['produto'] = 'site', extra: Partial<CrmLead> = {}): CrmLead {
  return { id: `${produto}:${id}`, chave: id, produto, empresa: `Empresa ${id}`, nicho: 'teste', cidade: '', etapa: 'contato', sinal: 'enviado', subEtapa: '', estadoNaPlanilha: 'enviado', leitura: 'desconhecida', marcos: { enviado: iso(1) }, followupHoje: false, respostaNova: false, acervo: false, notas: 0, eventos: [], links: {}, divergencias: [], ...extra }
}
describe('follow-up: braço enviado e versão duráveis', () => {
  it('novo texto desativado por padrão; sorteio estável só após aprovação', () => {
    const sorteios = Array.from({ length: 40 }, (_, i) => metadataDoFollowup('site', `teste${i}`, undefined, true))
    assert.ok(sorteios.some(m => m.braco === 'B'))
    assert.ok(sorteios.some(m => m.braco === 'A'))
    assert.equal(metadataDoFollowup('site', 'teste').braco, 'A')
    assert.deepEqual(metadataDoFollowup('site', 'teste', undefined, true), metadataDoFollowup('site', 'teste', undefined, true))
    assert.equal(textoDoFollowup('site', 'Empresa', 'A', undefined, 'CONTROLE'), 'CONTROLE')
  })
  for (const produto of ['site', 'prumo', 'iris', 'estampa', 'plus'] as const) it(`texto útil sem preço, ${produto}`, () => {
    const t = textoDoFollowup(produto, 'Empresa de teste', 'B', produto === 'plus' ? 'iris' : undefined)
    assert.match(t, /\?/)
    assert.match(t, /Se.*não for prioridade|Se esse assunto não for prioridade/)
    assert.doesNotMatch(t, /R\$|690|https?:/)
  })
  it('metadados legíveis e invalidez sem atribuição retroativa', () => {
    const meta = metadataDoFollowup('site', 'teste', undefined, true)
    assert.deepEqual(lerRegistroFollowup(textoDoRegistroFollowup(meta)), meta)
    assert.equal(lerRegistroFollowup('follow-up antigo'), null)
    assert.throws(() => textoDoRegistroFollowup({ ...meta, braco: 'C' as any }))
    assert.equal(leituraDoFollowup([lead('sem-registro', 'site', { eventos: [{ tipo: 'followup_enviado', em: iso(2), origem: 'manual', fonte: 'teste', rotulo: 'Envio confirmado' }] })]).bracos.A.enviados, 0)
  })
  const enviados = (n: number, braco: 'A' | 'B') => Array.from({ length: n }, (_, i) => lead(`${braco}${i}`, 'site', { marcos: { enviado: iso(1), ...(i % 2 ? {} : { respondeu: iso(4) }) }, resposta: { tipo: i % 2 ? 'bot' : 'interesse', trecho: 'Quero ver', em: iso(4) }, eventos: [{ tipo: 'followup_enviado', em: iso(3), origem: 'manual', fonte: 'teste', rotulo: 'Envio confirmado', texto: textoDoRegistroFollowup({ braco, versao: 'followup-2026-10-19' }) }] }))
  it('29/31: nenhuma taxa ou p; 30/30 mede resposta posterior de gente', () => {
    const cedo = leituraDoFollowup([...enviados(29, 'A'), ...enviados(31, 'B')])
    assert.equal(cedo.lido, false); assert.equal(cedo.numeros, undefined)
    const lido = leituraDoFollowup([...enviados(30, 'A'), ...enviados(30, 'B')])
    assert.equal(lido.lido, true); assert.equal(lido.bracos.A.responderam, 15)
    assert.ok(Number.isFinite(lido.numeros?.p))
  })
  it('humano após follow-up continua contado se um robô escreveu depois', () => {
    const l = enviados(1, 'A')[0]
    l.resposta = { tipo: 'bot', trecho: 'Atendimento automático', em: iso(5) }
    l.conversa = { desde: iso(1), mensagens: 4, ultimaEntrada: iso(4), ultimaEntradaRobo: iso(5), entradas: { gente: 1, recepcao: 0, robo: 1 }, ultima: { direcao: 'entrada', em: iso(5), trecho: 'Atendimento automático', papel: 'robo' } }
    assert.equal(leituraDoFollowup([l]).bracos.A.responderam, 1)
  })
})
describe('Plus: os primeiros 20 envios confirmados e o mesmo período do Site', () => {
  const plus = (id: string, d: number) => lead(id, 'plus', { eventos: [{ tipo: 'plus_enviado', origem: 'manual', fonte: 'teste', rotulo: 'Envio confirmado', em: iso(d) }], marcos: { enviado: iso(d), respondeu: iso(d + 1) }, resposta: { tipo: 'interesse', trecho: 'Quero ver', em: iso(d + 1) } })
  it('ignora envios anteriores à decisão e não inclui mais de 20', () => {
    const ls = [plus('antigo', -1), ...Array.from({ length: 21 }, (_, i) => plus(String(i), i + 1)), lead('site-dentro'), lead('site-depois', 'site', { marcos: { enviado: iso(21) } })]
    const a = leituraDoTestePlus(ls, agora)
    assert.equal(a.plus.enviados, 20); assert.equal(a.site.enviados, 1); assert.equal(a.fim, Date.parse(iso(20)))
    assert.deepEqual(leituraDoTestePlus([...ls].reverse(), agora + dia).ids, a.ids)
  })
  it('proposta e robô não viram quero ver nem pagamento', () => {
    const p = plus('robo', 1); p.resposta!.tipo = 'bot'; p.proposta = { em: iso(2), data: iso(2).slice(0, 10) }
    const r = leituraDoTestePlus([p], agora)
    assert.deepEqual(r.plus, { enviados: 1, respostas: 0, queroVer: 0, propostas: 1 })
    assert.equal('pagamento' in r, false)
  })
  it('reenvio não inclui lead antigo; proposta conserva interesse após resposta neutra', () => {
    const antigo = plus('antigo', -4)
    antigo.eventos.push({ tipo: 'plus_enviado', origem: 'manual', fonte: 'teste', rotulo: 'Reenvio', em: iso(2) })
    const avancou = plus('avancou', 1)
    avancou.etapa = 'proposta'; avancou.resposta!.tipo = 'neutra'; avancou.proposta = { em: iso(2), data: iso(2).slice(0, 10) }
    const r = leituraDoTestePlus([antigo, avancou], agora)
    assert.deepEqual(r.ids, [avancou.id])
    assert.equal(r.plus.queroVer, 1)
  })
})
describe('D na régua e objeções por oferta', () => {
  it('PRUMO equilibra A/D separadamente e congela só envios com metadados reais', () => {
    const entrada = Array.from({ length: 60 }, (_, i) => ({ id: `prumo-${i}`, empresa: 'Empresa', nicho: 'advocacia', enviado: false, controle: 'CONTROLE', raio_x_url: 'https://raio-x-prumo.vercel.app/teste', raio_x_achados: [{ id: 'site-fora-do-ar', dominio: 'empresa.com.br' }] }))
    assert.ok([...alocarAberturasPrumo(entrada).values()].every(r => r.mensagem_variante === 'A'))
    const rodada = [...alocarAberturasPrumo(entrada, true).values()]
    assert.equal(rodada.filter(r => r.mensagem_variante === 'D').length, 30)
    const antigo = { ...entrada[0], enviado: true, salva: { mensagem_variante: 'A', ab_elegiveis: 'A', mensagem: 'CONTROLE ANTIGO' } }
    assert.equal(alocarAberturasPrumo([antigo], true).get(antigo.id)?.mensagem, 'CONTROLE ANTIGO')
    assert.equal(alocarAberturasPrumo([{ ...antigo, salva: undefined }], true).size, 0)
    const l = lead('confirmado', 'prumo', { abordagem: { mensagem: 'D', elegiveis: 'AD' }, links: { convite: 'https://wa.me/5527999990001?text=TEXTO' } })
    assert.deepEqual(aberturaConfirmadaDoLead(l, 'TEXTO'), { mensagem_variante: 'D', ab_elegiveis: 'AD' })
    assert.equal(aberturaConfirmadaDoLead(l, 'TEXTO EDITADO'), undefined)
    const evento = { tipo: 'nota', origem: 'manual' as const, fonte: 'teste', rotulo: 'Confirmação', em: iso(1), texto: PREFIXO_CONVITE + JSON.stringify({ enviadoEm: iso(1), mensagem: 'TEXTO', abertura: { mensagem_variante: 'D', ab_elegiveis: 'AD' } }) }
    assert.equal(ultimoConviteConfirmado([evento])?.abertura?.mensagem_variante, 'D')
    const a = Array.from({ length: 30 }, (_, i) => lead(`A${i}`, 'prumo', { abordagem: { mensagem: 'A', elegiveis: 'AD' } }))
    const d = Array.from({ length: 30 }, (_, i) => lead(`D${i}`, 'prumo', { abordagem: { mensagem: 'D', elegiveis: 'AD' } }))
    assert.equal(leituraDoAbMensagem([...a, ...d, lead('Site')], agora, 'prumo').pares[0].estado, 'lido')
    assert.equal(leituraDoAbMensagem([...a, ...d], agora).inicio, null)
  })
  it('D não mostra taxa antes de 30 em cada braço', () => {
    const a = Array.from({ length: 29 }, (_, i) => lead(`A${i}`, 'site', { abordagem: { mensagem: 'A', elegiveis: 'AD' } }))
    const d = Array.from({ length: 31 }, (_, i) => lead(`D${i}`, 'site', { abordagem: { mensagem: 'D', elegiveis: 'AD' } }))
    const par = leituraDoAbMensagem([...a, ...d], agora).pares.find(p => p.par === 'AD')!
    assert.equal(par.estado, 'faltam'); assert.equal(par.numeros, undefined); assert.equal(par.y.linha, undefined)
  })
  for (const produto of ['prumo', 'iris', 'estampa', 'plus'] as const) it(`preço ${produto} não herda Site`, () => {
    const l = lead('objecao', produto, { resposta: { tipo: 'neutra', trecho: 'Quanto custa?' }, ...(produto === 'plus' ? { plus: { oferta: 'iris', fixo: false, descricao: '' } } : {}) })
    const texto = colinhaDoLead(l).objecoes.find(o => o.id === 'quanto-custa')!.resposta.texto
    assert.doesNotMatch(texto, /690|colocar o site no ar/)
    if (produto === 'estampa') assert.doesNotMatch(texto, /R\$/)
    assert.doesNotMatch(montarDossie(l).objecoes.find(o => o.fala === 'quanto custa?')?.respostaPronta ?? '', /690|colocar o site no ar/)
  })
})
