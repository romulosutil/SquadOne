import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { advance } from './simulacao'
import { clampAxis, avancarCamera } from './camera'
import { quadroDoAtor } from './renderizador'
import { projetarSala } from './geometria-da-cena'
import { dominiosDoEscritorio, trabalhosPorPessoa } from './projecao'
import { criarCoreografia, type PortaDaCoreografia, type TransporteVisual } from './coreografia'
import { PONTOS_DA_ESTEIRA } from './caminhos-da-cena'
import type { Actor, CharSheet, OfficeDominio } from './modelo'
import type { SquadView } from '../types'
import type { PassagemDaProducao } from './linha-de-producao'

const ator = (): Actor => ({ id: 'carla', dominioId: 'prumo--geral', x: 0, y: 0, slot: [0, 0], route: [[96, 0], [96, 96]],
  dist: 0, facing: 1, walking: true, hidden: false, comando: true, comandoAcabaAoChegar: false, passeio: null, timerPasseio: null })
const sheet: CharSheet = { frameW: 46, frameH: 64, anims: { walk: { file: '/walk.png', frames: 12 } } }
const pessoa = { id: 'carla', nome: 'Carla', papel: 'Atendimento', escopo: '', sprite: 'antigo', hiredAt: '' }
const squad: SquadView = { id: 's', nome: 'Time', escopo: '', calendarId: '', unlockOrder: [], unlockedSlots: [], proximoSlot: null,
  arquivo: { dominios: [], integrantes: [] }, dominios: [{ id: 'prumo--geral', nome: 'Atendimento', escopo: '', slot: [2, 1], room: 'inexistente', criadoEm: '', po: pessoa, integrantes: [] }] }

describe('simulação e câmera independentes da renderização', () => {
  it('percorre a mesma distância em 30, 60 e 120 fps sem pular curvas', () => {
    for (const fps of [30, 60, 120]) {
      const a = ator()
      for (let i = 0; i < fps * 1.5; i++) advance(a, 1 / fps)
      assert.ok(Math.abs(a.x - 96) < 1e-8)
      assert.ok(Math.abs(a.y - 48) < 1e-8)
      assert.ok(Math.abs(a.dist - 144) < 1e-8)
      assert.equal(a.facing, -1)
    }
  })
  it('encerra no destino sem ultrapassar nem repetir conclusão', () => {
    const a = ator(); advance(a, 3)
    assert.deepEqual([a.x, a.y], [96, 96]); assert.equal(a.walking, false); assert.equal(a.dist, 0)
    const antes = structuredClone(a); advance(a, .1); assert.deepEqual(a, antes)
  })
  it('tolera waypoint igual à posição e pausa com dt zero', () => {
    const a = ator(); a.route.unshift([0, 0]); advance(a, 0)
    assert.equal(a.route.length, 3); advance(a, .5); assert.equal(a.x, 48)
  })
  it('projeta pés, espelhamento, profundidade e frame pela distância', () => {
    const a = ator(); a.x = 96; a.y = 48; a.dist = 78; a.facing = -1
    const q = quadroDoAtor(a, sheet, a.id)
    assert.deepEqual([q.esquerda, q.topo, q.profundidade, q.coluna], [25, 8, 144, 1])
    assert.equal(q.espelhado, true); assert.equal(q.foco, true)
    assert.equal(quadroDoAtor(a, null, null).largura, 32)
  })
  it('centraliza mapa pequeno, limita bordas e preserva movimento reduzido', () => {
    assert.equal(clampAxis(20, -100, 100, 400), -200)
    assert.equal(clampAxis(500, -100, 100, 50), 50)
    const cam = { x: 0, y: 0 }
    assert.equal(avancarCamera(cam, [100, 50], 1 / 60, true), false)
    assert.deepEqual(cam, { x: 100, y: 50 })
    const outro = { x: 0, y: 0 }; assert.equal(avancarCamera(outro, [100, 50], 1 / 60, false), true)
    assert.ok(outro.x > 0 && outro.x < 100)
  })
})

describe('projeção da operação e geometria da cena', () => {
  it('mantém identidade, ordem, cor e planta sem modificar o roster', () => {
    const antes = structuredClone(squad)
    const [d] = dominiosDoEscritorio(squad, true, {})
    assert.deepEqual(d.slot, [0, 0]); assert.equal(d.room, 'ROOM_EMPTY')
    assert.equal(d.pessoas[0].id, pessoa.id); assert.equal(d.pessoas[0].sprite, 'wraith_01')
    assert.deepEqual(dominiosDoEscritorio(squad, false, {})[0].slot, [2, 1])
    assert.deepEqual(squad, antes)
    assert.deepEqual(dominiosDoEscritorio(null, true, null), [])
  })
  it('abre as mesmas portas quando uma sala vizinha aparece', () => {
    const d: OfficeDominio = { id: 'a', nome: 'Sala A', slot: [1, 1], room: 'ROOM_EMPTY', pessoas: [] }
    const fechada = projetarSala(d, null, new Set(['1,1']))
    const aberta = projetarSala(d, 'building', new Set(['1,1', '1,0', '0,1']))
    assert.equal(aberta.walls.length, fechada.walls.length - 2)
    assert.equal(aberta.phase, 'building'); assert.equal(aberta.label.text, 'Sala A · 0')
    assert.deepEqual(aberta.base, fechada.base)
  })
  it('fonte indisponível nunca associa trabalho a um personagem', () => {
    const p = dominiosDoEscritorio(squad, true, {})[0].pessoas
    const estacoes = [{ id: 1 as const, nome: 'Contato', setor: 'Contato', comVoce: 0, fichas: [{ id: 'l', empresa: 'Teste', responsavel: 'Carla', acao: 'Preparar', situacao: 'time' as const, rotulo: 'Time' }] }]
    assert.equal(trabalhosPorPessoa(p, estacoes, false).get(p[0].id), undefined)
    assert.equal(trabalhosPorPessoa(p, estacoes, true).get(p[0].id)?.id, 'l')
  })
})

function ambiente() {
  const callbacks: ((ok: boolean) => void)[] = [], terminos: string[] = [], textos: string[] = [], estados: (TransporteVisual | null)[] = []
  const rotas: [number, number][][] = []
  let cancelamentos = 0, aceita = true
  const porta: PortaDaCoreografia = {
    squad: () => squad, pessoas: () => [{ ...pessoa, sprite: 'wraith_01' }], pontos: () => PONTOS_DA_ESTEIRA,
    postoDaPessoa: () => [80, 80], seguirPercurso() {}, acompanhar: () => true,
    percorrer(_, pontos, callback) { rotas.push(pontos); callbacks.push(callback); return aceita },
    cancelarPercurso() { cancelamentos++; callbacks.at(-1)?.(false) },
    estado: e => estados.push(e), texto: t => textos.push(t), terminou: id => terminos.push(id),
  }
  const coreografia = criarCoreografia(porta)
  const passagem: PassagemDaProducao = { id: 'p1', leadId: 'l', empresa: 'Exemplo', de: 1, para: 4, em: '', motivo: 'Material registrado', salaPortadora: 'prumo--geral' }
  return { coreografia, passagem, callbacks, terminos, textos, estados, rotas, porta,
    rejeitar: () => { aceita = false }, cancelamentos: () => cancelamentos }
}

describe('coreografia somente de apresentação', () => {
  it('busca, leva, volta e emite conclusão uma única vez', () => {
    const e = ambiente(); e.coreografia.iniciar(e.passagem, true)
    assert.equal(e.estados.at(-1)?.etapa, 'buscar')
    e.callbacks[0](true); assert.equal(e.estados.at(-1)?.etapa, 'levar')
    e.callbacks[1](true); assert.equal(e.estados.at(-1)?.etapa, 'voltar')
    assert.deepEqual(e.rotas[2], [[80, 80]])
    e.callbacks[2](true); e.callbacks[2](true)
    assert.deepEqual(e.terminos, ['p1']); assert.equal(e.estados.at(-1), null)
  })
  it('callback de percurso antigo não cancela nem conclui uma passagem nova', () => {
    const e = ambiente(); e.coreografia.iniciar(e.passagem, true)
    const antigo = e.callbacks[0]
    e.coreografia.iniciar({ ...e.passagem, id: 'p2' }, true)
    antigo(true); antigo(false)
    assert.deepEqual(e.terminos, ['p1']); assert.equal(e.estados.at(-1)?.passagem.id, 'p2')
    assert.equal(e.cancelamentos(), 1)
  })
  it('movimento reduzido, pessoa ausente e rota rejeitada liberam só a apresentação', () => {
    for (const variante of ['reduzido', 'pessoa', 'rota']) {
      const e = ambiente()
      if (variante === 'pessoa') e.porta.pessoas = () => []
      if (variante === 'rota') e.rejeitar()
      e.coreografia.iniciar({ ...e.passagem, responsavel: variante === 'pessoa' ? 'Ausente' : undefined }, variante !== 'reduzido')
      assert.deepEqual(e.terminos, ['p1']); assert.equal(e.estados.at(-1), null)
    }
  })
  it('desmontagem cancela o percurso sem novos eventos para o componente pai', () => {
    const e = ambiente(); e.coreografia.iniciar(e.passagem, true)
    e.coreografia.destruir(); e.callbacks[0](true)
    e.coreografia.iniciar({ ...e.passagem, id: 'p2' }, true)
    assert.deepEqual(e.terminos, []); assert.equal(e.cancelamentos(), 1)
  })
  it('interromper o transporte não registra entrega de negócio', () => {
    const e = ambiente(); e.coreografia.iniciar(e.passagem, true); e.callbacks[0](false)
    assert.deepEqual(e.terminos, ['p1'])
    assert.ok(!e.textos.some(t => t.startsWith('Passagem registrada:')))
  })
})
