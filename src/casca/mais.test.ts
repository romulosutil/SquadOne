import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ferramentasDoMais, secaoDoMais } from './mais.ts'
import type { OperationTool } from '../operations/types.ts'

// Mais (17/10/2026, auditoria da Central): o endereço que abre uma seção e as ferramentas da
// Manutenção. Regras puras, em tabela.

describe('secaoDoMais: o endereço abre a seção certa', () => {
  const casos: Array<[string, ReturnType<typeof secaoDoMais>]> = [
    ['', { fluxo: false, abrir: null }],
    ['?abrir=manutencao', { fluxo: false, abrir: 'manutencao' }],
    // O antigo /crm?ver=roteiro manda para cá (AC-20).
    ['?abrir=roteiro', { fluxo: false, abrir: 'roteiro' }],
    ['?fluxo=site&passo=2', { fluxo: true, abrir: null }],
    // O endereço é digitável: valor desconhecido não abre nada.
    ['?abrir=tudo', { fluxo: false, abrir: null }],
    ['?abrir=', { fluxo: false, abrir: null }],
  ]
  for (const [busca, esperado] of casos) it(busca || '(vazio)', () => assert.deepEqual(secaoDoMais(busca), esperado))
})

const tool = (id: OperationTool['id'], state: OperationTool['state'], launchUrl = `https://mel.ts.net/${id}`): OperationTool => ({
  id, label: id.toUpperCase(), description: `descrição de ${id}`, launchUrl, state, detail: '',
})

describe('ferramentasDoMais: só as ferramentas de verdade (AC-24)', () => {
  it('ordem do uso; o Syncthing aposentado não aparece nem vindo na configuração', () => {
    const lista = ferramentasDoMais([tool('remote', 'healthy'), tool('syncthing', 'healthy'), tool('hermes', 'healthy'), tool('n8n', 'healthy'), tool('ide', 'healthy')])
    assert.deepEqual(lista.map((f) => f.id), ['ide', 'n8n', 'hermes', 'remote'])
    assert.equal(lista[0].nome, 'Terminal')
    assert.equal(lista[3].nome, 'SquadOne na nuvem')
  })

  it('não traz atalhos que repetem a barra (CRM, Agentes do SquadOne)', () => {
    const nomes = ferramentasDoMais([tool('ide', 'healthy')]).map((f) => f.nome)
    assert.ok(!nomes.some((n) => /CRM|Agentes/.test(n)))
  })

  it('a reserva fria sem resposta é neutra, com a palavra; o resto fora é falha', () => {
    const [ide, remote] = ferramentasDoMais([tool('ide', 'unavailable'), tool('remote', 'unavailable')])
    assert.deepEqual([ide.ponto, ide.dica], ['is-falha', 'Sem resposta agora'])
    assert.deepEqual([remote.ponto, remote.dica], ['is-neutro', 'Reserva fria (desligada de propósito)'])
  })

  it('respondendo: sem ponto, com a dica; loopback avisa que só abre no Dell', () => {
    const [ide] = ferramentasDoMais([tool('ide', 'healthy', 'http://127.0.0.1:8080/')])
    assert.equal(ide.ponto, '')
    assert.equal(ide.dica, 'Terminal e arquivos do Dell · só no Dell')
  })

  it('sem ferramentas no retrato: lista vazia (o painel some)', () => {
    assert.deepEqual(ferramentasDoMais([]), [])
  })
})
