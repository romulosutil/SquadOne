import { diaEmSP } from './retomadas'

export function ajusteDoPasso(acao: unknown, texto: unknown, data: unknown, agora = new Date()) {
  if (acao !== 'concluir' && acao !== 'reagendar') throw new Error('Escolha concluir ou reagendar.')
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isFinite(Date.parse(`${data}T12:00:00Z`)) || new Date(`${data}T12:00:00Z`).toISOString().slice(0, 10) !== data) throw new Error('Informe uma data válida.')
  const hoje = diaEmSP(agora)
  if (acao === 'concluir' && data > hoje) throw new Error('A conclusão precisa ter acontecido até hoje.')
  if (acao === 'reagendar' && data < hoje) throw new Error('Escolha hoje ou uma data futura.')
  if (acao === 'reagendar' && (typeof texto !== 'string' || !texto.trim() || texto.length > 900)) throw new Error('Descreva o próximo passo em até 900 caracteres.')
  return { tipo: 'proximo_passo' as const, texto: acao === 'concluir' ? '' : (texto as string).trim(), data }
}
