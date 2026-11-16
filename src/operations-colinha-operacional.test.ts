import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { CARDAPIO, FRASE_SOB_PROPOSTA, ROTEIRO } from './operations/colinha.ts'

const manutencao = () => CARDAPIO.find(s => s.id === 'fonte-em-dia')!
const mapa = () => CARDAPIO.find(s => s.id === 'mapa')!

test('manutenção reflete o escopo aprovado sem adicionar consultoria', () => {
  const canonico = JSON.parse(readFileSync(new URL('../deploy/dell/prumo-mapa/precos.json', import.meta.url), 'utf8'))
  assert.match(canonico.fonte.manutencao.texto, /10 mudanças por mês/)
  assert.match(canonico.fonte.manutencao.texto, /2 dias úteis/)
  const servico = manutencao()
  assert.match(servico.entrega, /até 10 mudanças por mês/)
  assert.match(servico.entrega, /até 2 dias úteis/)
  assert.match(servico.entrega, /depois dos 30 dias de ajustes/)
  assert.match(servico.entrega, /cancela quando quiser/)
  assert.doesNotMatch(servico.entrega, /leitura dos números|conversa de 45|reunião/i)
  assert.equal(servico.preco, 'R$ 190/mês')
  assert.match(servico.condicao!, /opcional/)
})

test('Mapa permite estimativas informadas pelo dono e conserva a privacidade do método', () => {
  const convite = ROTEIRO.find(p => p.momento === 'convite-mapa')!
  assert.match(mapa().entrega, /números aproximados informados pelo dono/)
  assert.match(mapa().entrega, /sem extratos nem senhas/)
  assert.match(mapa().entrega, /45 minutos/)
  assert.match(convite.trechos[0].texto, /números aproximados informados pelo dono/)
  assert.doesNotMatch([mapa().entrega, convite.objetivo, ...convite.trechos.map(t => t.texto)].join(' '), /sem (nenhum )?dado financeiro/)
  assert.equal(mapa().preco, 'grátis')
})

test('prazo de cliente é combinado após contexto suficiente, sem promessa automática de 24 h', () => {
  const mensagens = [FRASE_SOB_PROPOSTA, ...ROTEIRO.flatMap(p => p.trechos.map(t => t.texto))].join('\n')
  assert.doesNotMatch(mensagens, /proposta[^.\n]*(?:24\s*h|até amanhã)/i)
  assert.match(FRASE_SOB_PROPOSTA, /Combinamos o prazo de envio depois de conferir/)
  const proposta = ROTEIRO.find(p => p.momento === 'proposta')!
  assert.match(proposta.objetivo, /necessidade, processo de decisão e escopo forem suficientes/)
  assert.match(proposta.objetivo, /Combinar a data/)
  assert.match(proposta.objetivo, /gostei isolado não basta/)
  const perguntas = ROTEIRO.flatMap(p => p.perguntas ?? []).join('\n')
  assert.doesNotMatch(perguntas, /proposta[^.\n]*até amanhã/i)
})

test('ajuste de escopo não altera os IDs, preços ou gatilho do Site', () => {
  assert.deepEqual(CARDAPIO.map(s => [s.id, s.preco, s.mensal ?? null]), [
    ['raio-x', 'grátis', null], ['mapa', 'grátis', null], ['encontrado', 'R$ 690', 'R$ 39/mês'],
    ['respondido', 'R$ 2.400', 'R$ 290/mês'], ['anuncios', 'R$ 590/mês', null],
    ['redes', 'R$ 790/mês', null], ['fonte', 'R$ 1.500', null], ['fonte-em-dia', 'R$ 190/mês', null],
  ])
  assert.equal(CARDAPIO.find(s => s.id === 'encontrado')!.condicao, 'paga só depois de ver no ar')
})
