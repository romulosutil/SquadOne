/**
 * Só o necessário de `Storage` para as marcas locais (o ritmo, a Triagem, o filtro por motivo): os
 * testes passam um objeto qualquer, e `localStorage` pode lançar (modo privado, storage bloqueado),
 * então quem usa isto envolve cada leitura e gravação em try/catch.
 */
export interface Guardador {
  getItem(chave: string): string | null
  setItem(chave: string, valor: string): void
}
