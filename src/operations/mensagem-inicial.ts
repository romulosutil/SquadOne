import mensagem from '../../config/mensagem-inicial.json'

/** Só a abertura de cadastro novo; nunca reescreve o que já saiu. */
export function aberturaPrumo(criado: number | undefined, jaHouveContato: boolean): string | undefined {
  return !jaHouveContato && criado !== undefined && criado >= Date.parse(mensagem.desde)
    ? mensagem.texto : undefined
}
