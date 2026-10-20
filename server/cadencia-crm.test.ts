import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { it } from 'node:test'
import { CrmStore, RegistroInvalido, type CrmVisao } from './crm.ts'
import { cadenciaDoLead, textoDoRegistroCadencia } from '../src/operations/cadencia.ts'
import { decidir, estadoNovo } from './vendedor.ts'
import type { CrmLead } from '../src/operations/types.ts'

const agora = Date.parse('2026-10-19T15:00:00Z')
const lead = (): CrmLead => ({ id: 'site:CAD-001', produto: 'site', empresa: 'Empresa exemplo', etapa: 'proposta', sinal: 'proposta',
  proposta: { em: '2026-10-16T15:00:00Z', data: '2026-10-16' }, eventos: [], marcos: {}, links: { whatsapp: 'https://wa.me/5511999990000' },
} as CrmLead)

it('Enviei é durável no CRM entre dias e reinícios; contexto alterado não grava novo toque', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cadencia-store-'))
  try {
    const segredoArquivo = path.join(dir, 'segredo')
    await fs.writeFile(segredoArquivo, 'fixture-sem-credencial-real')
    const l = lead()
    let chamadas = 0
    const criar = () => {
      const store = new CrmStore({ retrato: path.join(dir, 'nao-usado'), registroUrl: 'http://127.0.0.1:5679/webhook/crm-registro', segredoArquivo }, async (_url, opts) => {
        chamadas++
        const corpo = JSON.parse(String(opts?.body))
        l.eventos.push({ tipo: 'cadencia_enviada', texto: corpo.texto, em: new Date(agora).toISOString(), rotulo: '', fonte: '', origem: 'manual' })
        return new Response(JSON.stringify({ ok: true, em: new Date(agora).toISOString() }))
      })
      store.visao = async () => ({ leads: [l] }) as unknown as CrmVisao
      return store
    }
    const texto = textoDoRegistroCadencia(cadenciaDoLead(l, agora)!.registro!)
    const entrada = { produto: 'site', id: 'CAD-001', tipo: 'cadencia_enviada', texto, data: '' }
    assert.equal((await criar().registrar(entrada, new Date(agora))).ok, true)
    assert.equal((await criar().registrar(entrada, new Date(agora + 86_400_000))).repetido, true)
    assert.equal(chamadas, 1)
    const proximo = cadenciaDoLead(l, agora + 2 * 86_400_000)!.registro!
    l.resposta = { tipo: 'neutra', trecho: 'vamos conversar amanhã', em: new Date(agora + 2 * 86_400_000).toISOString() }
    await assert.rejects(() => criar().registrar({ ...entrada, texto: textoDoRegistroCadencia(proximo) }, new Date(agora + 2 * 86_400_000)), RegistroInvalido)
    assert.equal(chamadas, 1)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

it('vendedor avisa conversa humana fora do expediente, respeitando somente o silêncio 22h–7h', () => {
  const l = { ...lead(), etapa: 'contato', proposta: undefined, sinal: 'respondeu', resposta: { tipo: 'neutra', trecho: 'pode me explicar?', em: '2026-10-19T21:00:00Z' } } as CrmLead
  const v = { leads: [l], hoje: [{ id: 'resposta', titulo: '', explicacao: '', itens: [{ leadId: l.id, acao: 'Responder', detalhe: '', ordem: 1, links: [{ rotulo: 'Conversa', url: l.links.whatsapp! }] }] }] } as CrmVisao
  for (const [hora, avisa] of [['18:00', true], ['21:59', true], ['22:00', false], ['06:59', false], ['07:00', true]] as const) {
    const t = Date.parse(`2026-10-19T${hora}:00-03:00`)
    assert.equal(decidir(v, estadoNovo(t), t).decisao.tipo === 'avisar', avisa, hora)
  }
})
