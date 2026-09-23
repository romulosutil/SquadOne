export const MOTIVOS_DE_AVALIACAO = [
  { valor: 'prompt', rotulo: 'Entendimento do pedido' },
  { valor: 'papel', rotulo: 'Responsável escolhido' },
  { valor: 'roteamento', rotulo: 'Squad escolhida' },
  { valor: 'agendamento', rotulo: 'Agendamento' },
  { valor: 'outro', rotulo: 'Outro' },
] as const

export type MotivoDeAvaliacao = (typeof MOTIVOS_DE_AVALIACAO)[number]['valor']

/** Nota baixa precisa de um sinal classificável; nota alta pode ser só confirmação. */
export const motivosObrigatorios = (nota: number | null): boolean => nota !== null && nota <= 3

/** Espelha a regra do servidor antes de habilitar o envio, sem substituir a validação dele. */
export const podeEnviarAvaliacao = (nota: number | null, motivos: readonly MotivoDeAvaliacao[]): boolean =>
  nota !== null && motivos.length <= 3 && (!motivosObrigatorios(nota) || motivos.length > 0)
