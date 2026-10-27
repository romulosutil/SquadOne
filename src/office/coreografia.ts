import type { SquadView } from '../types'
import type { OfficePessoa } from './modelo'
import type { Vec2 } from './rooms'
import type { PassagemDaProducao } from './linha-de-producao'
import type { FaseDoEscritorio } from './jornada-do-escritorio'
import { pontoDaEsteiraNoMundo, pontoProjetadoNoMundo, trajetoDaEsteira } from './caminhos-da-cena'

export interface TransporteVisual {
  passagem: PassagemDaProducao
  pessoaId: string
  nome: string
  etapa: 'buscar' | 'levar' | 'voltar'
}
export interface PortaDaCoreografia {
  squad(): SquadView | null | undefined
  pessoas(): readonly OfficePessoa[]
  pontos(): Record<FaseDoEscritorio, Vec2>
  postoDaPessoa(id: string): Vec2 | null
  percorrer(id: string, pontos: Vec2[], chegou: (concluiu: boolean) => void): boolean
  cancelarPercurso(id: string): void
  seguirPercurso(id: string | null): void
  acompanhar(): boolean
  estado(valor: TransporteVisual | null): void
  texto(valor: string): void
  terminou(id: string): void
}

/** Exibe um fato recebido. Concluir a coreografia nunca conclui trabalho ou escreve no CRM. */
export function criarCoreografia(porta: PortaDaCoreografia) {
  let atual: TransporteVisual | null = null
  let geracao = 0
  let destruida = false
  function publicar(estado: TransporteVisual | null) { atual = estado; porta.estado(estado) }
  function cancelar(notificar: boolean) {
    const anterior = atual
    ++geracao // callbacks de rotas antigas deixam de ter autoridade antes do cancelamento
    publicar(null)
    if (!anterior) return
    porta.cancelarPercurso(anterior.pessoaId)
    porta.seguirPercurso(null)
    porta.texto('')
    if (notificar) porta.terminou(anterior.passagem.id)
  }
  function iniciar(passagem: PassagemDaProducao | null, permitido: boolean) {
    if (destruida) return
    cancelar(true)
    if (!passagem) { porta.texto(''); return }
    const token = geracao
    let encerrada = false
    const valido = () => !destruida && token === geracao && !encerrada
    function terminar() {
      if (!valido()) return
      encerrada = true
      publicar(null)
      porta.seguirPercurso(null)
      porta.texto('')
      porta.terminou(passagem!.id)
    }
    if (!permitido) { terminar(); return }
    const salas = porta.squad()?.dominios
    const sala = salas?.find(d => d.id === passagem.salaPortadora) ?? salas?.find(d => d.id === 'prumo--geral')
    const pessoa = passagem.responsavel
      ? porta.pessoas().find(p => passagem.responsavel!.toLocaleLowerCase('pt-BR').includes(p.nome.toLocaleLowerCase('pt-BR')))
      : sala?.po
    const posto = pessoa && porta.postoDaPessoa(pessoa.id)
    if (!pessoa || !posto) { terminar(); return }
    const base = { passagem, pessoaId: pessoa.id, nome: pessoa.nome }
    publicar({ ...base, etapa: 'buscar' })
    if (porta.acompanhar()) porta.seguirPercurso(pessoa.id)
    porta.texto(`${passagem.tipo === 'trabalho' ? 'Encaminhamento registrado' : 'Avanço confirmado'}: ${passagem.motivo} · ${passagem.empresa}.`)
    const iniciou = porta.percorrer(pessoa.id, [pontoDaEsteiraNoMundo(passagem.de, porta.pontos())], ok => {
      if (!valido()) return
      if (!ok) { terminar(); return }
      publicar({ ...base, etapa: 'levar' })
      const percurso = trajetoDaEsteira(passagem.de, passagem.para, porta.pontos()).slice(1).map(pontoProjetadoNoMundo)
      const levando = porta.percorrer(pessoa.id, percurso.length ? percurso : [pontoDaEsteiraNoMundo(passagem.para, porta.pontos())], entregue => {
        if (!valido()) return
        if (!entregue) { terminar(); return }
        publicar({ ...base, etapa: 'voltar' })
        porta.texto(`Passagem registrada: ${passagem.empresa} · ${passagem.motivo}`)
        if (!porta.percorrer(pessoa.id, [posto], () => terminar())) terminar()
      })
      if (!levando) terminar()
    })
    if (!iniciou) terminar()
  }
  return {
    iniciar,
    destruir() { destruida = true; cancelar(false) },
  }
}
