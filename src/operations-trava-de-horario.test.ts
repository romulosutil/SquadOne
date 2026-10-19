import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { avisoDeHorario } from './operations/resultados.ts'
import { rotuloDoFollowup } from './operations/crm-formato.ts'
import { aindaSemPrimeiroContato, ehPrimeiroContato, envioTravado, linksDePrimeiroContato, noExpedienteDeVenda, podeMandarPrimeiroContato } from './operations/trava-de-horario.ts'
import { noExpedienteDeVenda as daFila } from './operations/proxima-venda.ts'
import type { CrmLead } from './operations/types.ts'

const AVISO = 'Agora é fora do expediente de quem recebe.'

describe('trava de horário do envio', () => {
  it('só trava com aviso, e só até liberar aquele lead', () => {
    const nenhum = new Set<string>()
    assert.equal(envioTravado(null, nenhum, 'a'), false, 'no expediente (sem aviso) nada trava')
    assert.equal(envioTravado(undefined, nenhum, 'a'), false)
    assert.equal(envioTravado('', nenhum, 'a'), false, 'aviso vazio não é aviso')
    assert.equal(envioTravado(AVISO, nenhum, 'a'), true)
    assert.equal(envioTravado(AVISO, new Set(['a']), 'a'), false)
    assert.equal(envioTravado(AVISO, new Set(['a']), 'b'), true, 'liberar um lead não libera os outros')
  })

  // 14/10/2026: o reenvio do só-robô é uma primeira abordagem (a anterior só chegou ao robô) e
  // trava como o envio e o convite; o follow-up de quem viu e não respondeu, a 2ª mensagem e a conversa, não.
  it('o que trava: envio, convite e o reenvio do só-robô; o follow-up de sempre, não', () => {
    const links = { enviar: 'https://x/enviar', convite: 'https://x/convite', followup: 'https://wa.me/1?text=fu', segunda: 'https://wa.me/1?text=2', whatsapp: 'https://wa.me/1' }
    const casos: Array<[string, Pick<CrmLead, 'links' | 'reenvioDoRobo'>, string[]]> = [
      ['pronto do Site', { links: { enviar: links.enviar, site: 'https://demo' } }, [links.enviar]],
      ['prospect a convidar', { links: { convite: links.convite } }, [links.convite]],
      ['follow-up de quem viu e não respondeu', { links: { followup: links.followup, whatsapp: links.whatsapp } }, []],
      ['reenvio do só-robô', { links: { followup: links.followup, whatsapp: links.whatsapp }, reenvioDoRobo: true }, [links.followup]],
      ['2ª mensagem', { links: { segunda: links.segunda, whatsapp: links.whatsapp } }, []],
    ]
    for (const [nome, lead, esperado] of casos) {
      assert.deepEqual(linksDePrimeiroContato(lead), esperado, nome)
      for (const url of Object.values(links)) assert.equal(ehPrimeiroContato(lead, url), esperado.includes(url), `${nome}: ${url}`)
    }
    assert.equal(ehPrimeiroContato(undefined, links.enviar), false, 'lead que sumiu do retrato não trava nada')
    assert.equal(ehPrimeiroContato({ links: {} }, ''), false)
    // Fora do expediente: trava o reenvio, não o follow-up de sempre, para o mesmo lead.
    const fora = (lead: Pick<CrmLead, 'links' | 'reenvioDoRobo'>) => envioTravado(AVISO, new Set(), 'a') && ehPrimeiroContato(lead, links.followup)
    assert.equal(fora({ links: { followup: links.followup }, reenvioDoRobo: true }), true)
    assert.equal(fora({ links: { followup: links.followup } }), false)
  })

  it('o rótulo do link de follow-up: "Pedir o responsável" só no reenvio do só-robô', () => {
    assert.equal(rotuloDoFollowup({ reenvioDoRobo: true }), 'Pedir o responsável')
    assert.equal(rotuloDoFollowup({}), 'Mandar o follow-up')
  })

  it('acompanha o relógio de São Paulo: 19h trava, 10h de quarta não', () => {
    const leads: CrmLead[] = []
    const as19h = Date.parse('2026-10-14T22:00:00Z') // quarta, 19h em São Paulo
    const as10h = Date.parse('2026-10-14T13:00:00Z') // quarta, 10h em São Paulo
    const domingo = Date.parse('2026-10-18T15:00:00Z') // domingo, 12h
    assert.equal(envioTravado(avisoDeHorario(leads, as19h), new Set(), 'a'), true)
    assert.equal(envioTravado(avisoDeHorario(leads, as10h), new Set(), 'a'), false)
    assert.equal(envioTravado(avisoDeHorario(leads, domingo), new Set(), 'a'), true)
  })
})

// OT-02 (16/10/2026): uma janela só para o aviso das telas do CRM, a Próxima venda e o Telegram.
describe('uma regra de horário em todo envio', () => {
  const sp = (iso: string) => Date.parse(iso)
  it('a janela é a do vendedor: seg a sex, 8h às 17h30 de São Paulo', () => {
    const casos: Array<[string, boolean, string]> = [
      ['2026-10-14T11:00:00Z', true, 'quarta 8h'],
      ['2026-10-14T20:29:00Z', true, 'quarta 17h29'],
      ['2026-10-14T20:30:00Z', false, 'quarta 17h30'],
      ['2026-10-14T20:45:00Z', false, 'quarta 17h45: antes travava só às 18h'],
      ['2026-10-17T13:00:00Z', false, 'sábado 10h: antes o sábado de manhã passava'],
      ['2026-10-18T13:00:00Z', false, 'domingo'],
    ]
    for (const [iso, esperado, nome] of casos) assert.equal(noExpedienteDeVenda(sp(iso)), esperado, nome)
    assert.equal(daFila, noExpedienteDeVenda, 'a Próxima venda e o vendedor usam a mesma função')
    assert.equal(noExpedienteDeVenda(Number.NaN), false, 'data ilegível não é expediente')
  })

  it('o aviso das telas do CRM aparece exatamente fora da janela', () => {
    assert.equal(avisoDeHorario([], sp('2026-10-14T20:29:00Z')), null)
    assert.match(avisoDeHorario([], sp('2026-10-14T20:45:00Z')) ?? '', /segunda a sexta, das 8h às 17h30/)
    assert.notEqual(avisoDeHorario([], sp('2026-10-17T13:00:00Z')), null, 'sábado trava')
  })

  it('pode mandar: expediente ou liberado, e sempre com o ritmo livre', () => {
    const casos: Array<[boolean, boolean, boolean, boolean]> = [
      // noExpediente, liberado, ritmoLivre -> pode
      [true, false, true, true],
      [false, true, true, true],
      [false, false, true, false],
      [true, true, false, false],
      [false, true, false, false],
    ]
    for (const [noExpediente, liberado, ritmoLivre, pode] of casos) {
      assert.equal(podeMandarPrimeiroContato({ noExpediente, liberado, ritmoLivre }), pode, JSON.stringify({ noExpediente, liberado, ritmoLivre }))
    }
  })

  it('o trecho do Roteiro não abre o WhatsApp de quem ainda espera a primeira mensagem', () => {
    assert.equal(aindaSemPrimeiroContato(undefined), false, 'sem lead (a página do Roteiro) não há o que travar')
    assert.equal(aindaSemPrimeiroContato({ links: { whatsapp: 'https://wa.me/55', enviar: 'https://x/enviar' } }), true)
    assert.equal(aindaSemPrimeiroContato({ links: { whatsapp: 'https://wa.me/55', convite: 'https://x/convite' } }), true)
    assert.equal(aindaSemPrimeiroContato({ links: { whatsapp: 'https://wa.me/55', followup: 'https://x/f' }, reenvioDoRobo: true }), true, 'o reenvio do só-robô é primeira abordagem')
    assert.equal(aindaSemPrimeiroContato({ links: { whatsapp: 'https://wa.me/55', followup: 'https://x/f' } }), false, 'em conversa: o trecho é resposta')
  })
})
