import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { comHistoricoConferido, coberturaDoHistorico, precisaConferirHistorico, PREFIXO_CONFERENCIA } from './operations/historico-comercial.ts'
import { lerExportacao } from './operations/importar-conversa.ts'
import { botoesDoAviso, textoDoAviso } from '../server/vendedor.ts'
import type { CrmLead } from './operations/types.ts'
import { esperaOCopiloto, type AcaoDeVenda } from './operations/proxima-venda.ts'

const em = '2026-10-17T13:00:00Z'
const revisao = { tipo: 'nota', rotulo: 'Nota', texto: `${PREFIXO_CONFERENCIA}Conferi a conversa deste lead no WhatsApp.`, em, origem: 'manual' as const, fonte: 'CRM' }
const lead = { id: 'site:a', empresa: 'Empresa A', etapa: 'contato', marcos: { enviado: '2026-10-16T13:00:00Z' }, eventos: [], links: {} } as unknown as CrmLead
const acao = { chave: 'site:a|followup', leadId: 'site:a', empresa: 'Empresa A', produto: 'site', tipo: 'followup', titulo: 'Retomar', porque: '', tatica: '', contexto: '', primeiroContato: false, quente: true, anota: 'followup_enviado', rascunho: 'Olá', link: { url: 'https://wa.me/5511999990000', rotulo: 'Mandar' } } as AcaoDeVenda

describe('histórico: cobertura honesta e contexto antes da retomada', () => {
  it('a integração atual dispensa confirmação manual; evento ainda não observado aguarda sincronização', () => {
    const observado = { ...lead, conversa: { mensagens: 2, ultima: { em } } as CrmLead['conversa'] }
    assert.equal(precisaConferirHistorico(observado), false)
    assert.deepEqual(comHistoricoConferido(acao, observado), acao)
    assert.equal(precisaConferirHistorico({ ...observado, marcos: { ...lead.marcos, segundaEnviada: '2026-10-17T13:01:00Z' } }), true)
  })
  it('ausência e arquivo parcial exigem revisão; a planilha e o copiloto não a substituem', () => {
    assert.equal(precisaConferirHistorico(lead), true)
    assert.equal(precisaConferirHistorico({ ...lead, conversa: { mensagens: 2 } as CrmLead['conversa'] }), true)
    const preparada = comHistoricoConferido(acao, lead)
    assert.equal(preparada.conferirHistorico, true)
    assert.equal(esperaOCopiloto(preparada), false)
    for (const campo of ['rascunho', 'link', 'anota', 'copiloto']) assert.equal(campo in preparada, false)
    assert.deepEqual(botoesDoAviso(preparada, 'x', 'https://central.exemplo'), [[{ texto: 'Conferir histórico e decidir', url: 'https://central.exemplo/crm?lead=site%3Aa' }]])
    assert.doesNotMatch(textoDoAviso(preparada, []), /escreva à mão|Mensagem pronta/)
  })
  it('revisão humana libera; evento posterior invalida, automático não libera', () => {
    const conferido = { ...lead, eventos: [revisao] }
    assert.equal(precisaConferirHistorico(conferido), false)
    assert.deepEqual(comHistoricoConferido(acao, conferido), acao)
    assert.equal(precisaConferirHistorico({ ...conferido, conversa: { ultima: { em: '2026-10-17T13:01:00Z' } } as CrmLead['conversa'] }), true)
    assert.equal(precisaConferirHistorico({ ...lead, eventos: [{ ...revisao, origem: 'automático' }] }), true)
  })
  it('mantém o próximo compromisso visível enquanto pede conferência, sem liberar envio', () => {
    const preparada = comHistoricoConferido(acao, { ...lead, proximoPasso: { texto: 'Conferir a entrega aceita por Jéssica.', data: '2026-10-18' } as CrmLead['proximoPasso'] })
    assert.match(preparada.porque, /Conferir a entrega aceita por Jéssica/)
    assert.equal(preparada.link, undefined)
    assert.equal(preparada.anota, undefined)
  })
  it('não bloqueia primeiro contato nem recusa, e não chama arquivo de histórico completo', () => {
    assert.equal(precisaConferirHistorico({ ...lead, etapa: 'novo', marcos: {} }), false)
    assert.equal(comHistoricoConferido({ ...acao, primeiroContato: true }, lead).conferirHistorico, undefined)
    assert.equal(comHistoricoConferido({ ...acao, tipo: 'desfecho' }, lead).conferirHistorico, undefined)
    assert.deepEqual(coberturaDoHistorico([lead, { ...lead, id: 'b', conversa: { mensagens: 1 } as CrmLead['conversa'], eventos: [revisao] }]), { contatados: 2, comArquivo: 1, semArquivo: 1, conferidos: 1 })
  })
})

describe('exportação individual: sem adivinhar autor, data ou direção', () => {
  it('lê Android e iOS, preserva multilinha e converte a hora de São Paulo', () => {
    const lida = lerExportacao('17/10/2026 09:00 - Mensagens protegidas\n17/10/2026 09:01 - Rômulo: Oi\n[17/10/2026, 09:02:10] Jaqueline: Pode mandar\nObrigada', 'Rômulo', Date.parse(em))
    assert.equal(lida.contato, 'Jaqueline')
    assert.deepEqual(lida.mensagens, [{ em: '2026-10-17T12:01:00.000Z', direcao: 'saida', texto: 'Oi' }, { em: '2026-10-17T12:02:10.000Z', direcao: 'entrada', texto: 'Pode mandar\nObrigada' }])
  })
  it('recusa grupos, nome errado, datas inválidas ou futuras e mensagem que seria cortada', () => {
    const texto = '17/10/2026 09:01 - Rômulo: Oi\n17/10/2026 09:02 - Jaqueline: Olá'
    assert.throws(() => lerExportacao(texto, 'Outro', Date.parse(em)), /dois participantes/)
    assert.throws(() => lerExportacao(`${texto}\n17/10/2026 09:03 - Terceiro: Oi`, 'Rômulo', Date.parse(em)), /Grupos/)
    assert.throws(() => lerExportacao(texto.replace('17/10', '31/02'), 'Rômulo', Date.parse(em)), /Data/)
    assert.throws(() => lerExportacao(texto.replaceAll('2026', '2027'), 'Rômulo', Date.parse(em)), /Data/)
    assert.throws(() => lerExportacao(`${texto}${'x'.repeat(2001)}`, 'Rômulo', Date.parse(em)), /cortar conteúdo/)
  })
})
