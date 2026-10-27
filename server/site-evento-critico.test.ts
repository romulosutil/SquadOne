import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { describe, it } from 'node:test'
import { eventoCriticoDe, primeiraComEventoCritico, PRIMEIRA_EVENTO_CRITICO, EVENTO_CRITICO_APROVADO, segundaDe, followupDe } from './site-mensagem.ts'
import { primeiraComEventoCriticoDoPrumo } from './prumo-mensagem.ts'

const codigo = fs.readFileSync(new URL('../deploy/dell/claude-ops/site-mensagem.js', import.meta.url), 'utf8')
const js = vm.runInNewContext(`${codigo}\n;({eventoCriticoDe,alocarRodada,elegiveisDe,PRIMEIRA_EVENTO_CRITICO,EVENTO_CRITICO_APROVADO})`) as any
const raio = (achado: unknown) => ({ raio_x_url: 'https://raio-x-prumo.vercel.app/teste', raio_x_achados: [achado], sem_demo: true })
const casos = [
  { id: 'dominio-vencido', dominio: 'empresa.com.br', data: '2026-08-29' },
  { id: 'site-fora-do-ar', dominio: 'empresa.com.br' },
  { id: 'posicao-na-busca', consulta: 'clínica em Vitória', posicao: 11, lidos: 20 },
]
describe('variante D: fato verificável, aprovação e congelamento', () => {
  for (const achado of casos) it(`espelho JS/TS ${achado.id}`, () => {
    assert.equal(eventoCriticoDe(raio(achado)), js.eventoCriticoDe(raio(achado)))
    assert.equal(PRIMEIRA_EVENTO_CRITICO, js.PRIMEIRA_EVENTO_CRITICO)
    const texto = primeiraComEventoCritico('Clínica Teste', raio(achado), true)
    assert.match(texto, /^Oi! Sou o Rômulo, do Prumo, e trabalho com sites para empresas\./)
    assert.doesNotMatch(texto, /nota|defeito|R\$|https?:|\{FATO\}/)
    assert.ok(texto.split('Preparei uma análise')[0].includes(eventoCriticoDe(raio(achado))!))
  })
  it('aprovação humana ativa o padrão e false explícito mantém rollback sem D', () => {
    const l = raio(casos[1])
    assert.equal(EVENTO_CRITICO_APROVADO, true)
    assert.equal(js.EVENTO_CRITICO_APROVADO, true)
    assert.notEqual(primeiraComEventoCritico('Teste', l), '')
    assert.equal(primeiraComEventoCritico('Teste', l, false), '')
    assert.equal(primeiraComEventoCriticoDoPrumo('Teste', l, false), '')
    assert.equal(js.elegiveisDe(l).includes('D'), true)
    assert.equal(js.elegiveisDe(l, false).includes('D'), false)
    assert.equal(js.elegiveisDe(l, true).includes('D'), true)
    assert.match(primeiraComEventoCriticoDoPrumo('Teste', l, true), /do Prumo/)
    const rodada = js.alocarRodada([], Array.from({ length: 40 }, (_, i) => ({ placeId: `rollback${i}`, lead: l, eventoCriticoAprovado: false })))
    assert.ok(Object.values(rodada).every((r: any) => r.letra === 'A' && r.elegiveis === 'A'))
  })
  const invalidos = [null, {}, { id: 'nota-baixa', nota: 2 }, { id: 'site-fora-do-ar', dominio: '<script>' }, { id: 'dominio-vencido', dominio: 'empresa.com.br', data: '2026-02-30' }, { id: 'posicao-na-busca', consulta: 'x', posicao: 2, lidos: 10 }, { id: 'posicao-na-busca', consulta: 'x', posicao: 11, lidos: 5 }]
  for (const achado of invalidos) it(`sem fato válido ${JSON.stringify(achado)}`, () => {
    assert.equal(eventoCriticoDe(raio(achado)), null)
    assert.equal(js.elegiveisDe(raio(achado), true).includes('D'), false)
  })
  it('sem Raio-X publicado não é elegível', () => assert.equal(eventoCriticoDe({ raio_x_achados: casos }), null))
  it('D entrega o raio-x oferecido, sem trocar por demonstração não pedida', () => {
    const l = { nome: 'Empresa', siteUrl: '', waMe: 'https://wa.me/5527999990001', variante: 'D', raioXUrl: 'https://raio-x-prumo.vercel.app/empresa' }
    assert.match(segundaDe(l).texto, /Aqui está o raio-x/)
    assert.match(followupDe(l).texto, /raio-x/)
  })
  it('equilibra D por estrato e conserva a letra de enviados', () => {
    const l = raio(casos[1])
    const pedidos = Array.from({ length: 60 }, (_, i) => ({ placeId: `teste${i}`, nicho: 'clínica', lead: l, eventoCriticoAprovado: true }))
    const rodada = Object.values(js.alocarRodada([], pedidos)) as any[]
    assert.equal(rodada.filter(r => r.letra === 'A').length, 30)
    assert.equal(rodada.filter(r => r.letra === 'D').length, 30)
    const antes = js.alocarRodada([], [{ placeId: 'ja-enviado', lead: { ...l, status: 'enviado' }, salva: { letra: 'A', elegiveis: 'A' }, eventoCriticoAprovado: true }])['ja-enviado']
    assert.equal(antes.letra, 'A')
    assert.equal(antes.elegiveis, 'A')
    assert.equal(antes.congelada, true)
  })
})
