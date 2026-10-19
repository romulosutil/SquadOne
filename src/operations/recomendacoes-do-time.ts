export interface SetorDoTime {
  setor: string
  avaliados: number
  selecionados: number
  enviados: number
}

export interface RetratoDoTime {
  avaliados: number
  selecionados: number
  enviados: number
  setores: SetorDoTime[]
}

export interface RecomendacaoDoTime {
  id: string
  titulo: string
  evidencia: string
  proximoPasso: string
}

/** Recomendações de carteira baseadas somente em contagens observadas, sem extrapolar taxa de resposta. */
export function recomendacoesDoTime(frente: RetratoDoTime | null): RecomendacaoDoTime[] {
  if (!frente || !Array.isArray(frente.setores)) return []
  const r: RecomendacaoDoTime[] = []
  const restante = Math.max(0, frente.selecionados - frente.enviados)
  if (frente.avaliados >= 30 && frente.selecionados / frente.avaliados < 0.15) {
    r.push({
      id: 'carteira', titulo: 'Revisar a carteira de primeiros contatos',
      evidencia: `${frente.selecionados} selecionados entre ${frente.avaliados} avaliados (${Math.round(100 * frente.selecionados / frente.avaliados)}%). Restam até ${restante} contatos desta fila.`,
      proximoPasso: 'Conferir por que os demais foram adiados e abastecer novos candidatos adequados antes de esperar mais envios.',
    })
  }
  const lider = [...frente.setores].sort((a,b) => b.enviados - a.enviados)[0]
  if (frente.enviados >= 5 && lider && lider.enviados / frente.enviados >= 0.8) {
    const outros = frente.setores.filter(s => s.setor !== lider.setor)
    r.push({
      id: 'concentracao', titulo: 'Conferir a concentração dos contatos',
      evidencia: `${lider.enviados} de ${frente.enviados} contatos enviados são de ${lider.setor.toLowerCase()}; ${outros.reduce((n,s) => n + s.selecionados,0)} selecionados são de outros setores.`,
      proximoPasso: outros.some(s => s.selecionados > 0)
        ? 'Acompanhar os próximos contatos alternados entre setores e comparar as respostas quando houver amostra.'
        : 'Revisar a origem dos leads de outros setores antes de ampliar o volume.',
    })
  }
  return r
}
