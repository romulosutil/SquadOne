import { test } from 'node:test'
import assert from 'node:assert/strict'
import { elegivelParaOTime } from './operations/primeiro-contato.ts'
import { autoridadeDaConversa, projetarResponsavelConversa, textoResponsavelConversa, identidadeDaConversa } from './operations/responsavel-conversa.ts'

test('tomada humana v2 impede autoridade do time mesmo se a fila anterior ainda diz pronto', () => {
  const agora=Date.parse('2026-11-16T15:00:00Z')
  const l = { id:'site:fixture', produto: 'site', etapa: 'novo', sinal: 'pronto', empresa: 'Empresa', marcos: {}, eventos: [] as any[],
    mensagemPronta: 'Olá, posso apresentar?', links: { whatsapp: 'https://wa.me/5511998887766', enviar: 'https://mel.test/webhook/enviar' } } as const
  assert.equal(elegivelParaOTime(l), true, 'elegibilidade da oferta não é autorização para enviar')
  const identidade=identidadeDaConversa(l)!
  const nota={v:2,id:'owner-humano',...identidade,responsavel:'romulo',data:'2026-11-16T14:00:00Z',motivo:'Negociação conduzida por Rômulo',humano:true,anterior:null}
  l.eventos.push({tipo:'nota',origem:'manual',em:nota.data,texto:textoResponsavelConversa(nota,agora)})
  const contexto={pausado:false,recusado:false,contextoAtual:true,envioAmbiguo:false,bloqueioOperacional:false}
  const dono=projetarResponsavelConversa(l,[l],agora)
  assert.equal(autoridadeDaConversa(dono,contexto).permitido,false)
  const liberacao={...nota,id:'owner-time',anterior:nota.id,responsavel:'time',data:'2026-11-16T14:01:00Z'}
  l.eventos.push({tipo:'nota',origem:'manual',em:liberacao.data,texto:textoResponsavelConversa(liberacao,agora)})
  assert.equal(autoridadeDaConversa(projetarResponsavelConversa(l,[l],agora),contexto).permitido,true)
  assert.equal(autoridadeDaConversa(projetarResponsavelConversa(l,[l],agora),{...contexto,recusado:true}).permitido,false)
})
