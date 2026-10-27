import type { SquadView } from '../types'
import type { CharSheet, OfficeDominio, OfficePessoa } from './modelo'
import { ROOM_TEMPLATES, type RoomId } from './rooms'
import { resolverSprite } from './catalogoSprites'
import type { EstacaoDaProducao, FichaNaEsteira } from './linha-de-producao'

/** Roster observado -> identidade e planta visual. Não modifica nem duplica o estado operacional. */
export function dominiosDoEscritorio(squad: SquadView | null | undefined, imersivo: boolean, chars: Record<string, CharSheet> | null): OfficeDominio[] {
  let ordem = 0
  return (squad?.dominios ?? []).map((d, indice) => ({
    id: d.id, nome: d.nome,
    slot: imersivo ? [indice % 2, Math.floor(indice / 2)] : d.slot,
    room: (d.room in ROOM_TEMPLATES ? d.room : 'ROOM_EMPTY') as RoomId,
    pessoas: [d.po, ...d.integrantes].map(p => ({
      id: p.id, nome: p.nome, papel: p.papel, ...resolverSprite(p.sprite, p.hue, ordem++, chars),
    })),
  }))
}

/** Mantém a associação nominal existente; ausência de leitura não produz tarefa. */
export function trabalhosPorPessoa(pessoas: readonly OfficePessoa[], estacoes: readonly EstacaoDaProducao[] | undefined, disponivel: boolean): Map<string, FichaNaEsteira | undefined> {
  const fichas = disponivel ? estacoes?.flatMap(e => e.fichas).filter(f => f.situacao === 'time') ?? [] : []
  return new Map(pessoas.map(p => [p.id, fichas.find(f => f.responsavel.toLocaleLowerCase('pt-BR').includes(p.nome.toLocaleLowerCase('pt-BR')))]))
}
