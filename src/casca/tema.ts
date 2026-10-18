/**
 * PURO (o storage e o documento entram por parâmetro): o tema claro/escuro do app (17/10/2026).
 *
 * Até aqui o tema seguia o `prefers-color-scheme` sem perguntar, e o app abria escuro no
 * Windows escuro do Rômulo, que não tinha pedido isso (e o vermelho de erro gritava no escuro).
 * Agora o padrão é CLARO; o escuro e o "Automático" (seguir o sistema) são escolha explícita,
 * em Mais › Aparência e no /design-system.
 *
 * O tokens.css já sabe as três coisas: `html[data-theme="light"]` força o claro (vence a media
 * query), `html[data-theme="dark"]` força o escuro e, sem atributo, vale o sistema. Por isso
 * "automático" REMOVE o atributo em vez de calcular o tema aqui: a media query reage sozinha
 * quando o sistema troca, sem listener.
 *
 * O `localStorage` pode lançar (modo privado, storage bloqueado): try/catch, e a escolha só
 * não sobrevive ao reload. O index.html repete a leitura num <script> curto antes do primeiro
 * quadro (sem ele o fundo piscaria escuro); o teste confere que a chave e os valores batem.
 */

export type PreferenciaDeTema = 'automatico' | 'claro' | 'escuro'

export const CHAVE_DO_TEMA = 'squadone:tema'

/** Sem escolha guardada (ou ilegível), claro: o sistema só manda se o usuário pedir. */
export const TEMA_PADRAO: PreferenciaDeTema = 'claro'

export const PREFERENCIAS_DE_TEMA: ReadonlyArray<{ id: PreferenciaDeTema; rotulo: string }> = [
  { id: 'claro', rotulo: 'Claro' },
  { id: 'escuro', rotulo: 'Escuro' },
  { id: 'automatico', rotulo: 'Automático' },
]

/** Só o necessário de `Storage`: os testes passam um objeto qualquer. */
export interface GuardadorDeTema {
  getItem(chave: string): string | null
  setItem(chave: string, valor: string): void
}

/** Só o necessário do `document`: o `<html>` e o seu dataset. */
export interface DocumentoComTema {
  documentElement: { dataset: Record<string, string | undefined> }
}

export function ehPreferenciaDeTema(v: unknown): v is PreferenciaDeTema {
  return v === 'automatico' || v === 'claro' || v === 'escuro'
}

export function lerPreferenciaDeTema(storage: GuardadorDeTema | null | undefined): PreferenciaDeTema {
  try {
    const v = storage?.getItem(CHAVE_DO_TEMA)
    return ehPreferenciaDeTema(v) ? v : TEMA_PADRAO
  } catch {
    return TEMA_PADRAO
  }
}

export function gravarPreferenciaDeTema(storage: GuardadorDeTema | null | undefined, pref: PreferenciaDeTema): void {
  try {
    storage?.setItem(CHAVE_DO_TEMA, pref)
  } catch {
    // Sem storage: a escolha vale até o próximo reload.
  }
}

/** O valor de `html[data-theme]` para a preferência; `null` = sem atributo (vale o sistema). */
export function atributoDoTema(pref: PreferenciaDeTema): 'light' | 'dark' | null {
  return pref === 'claro' ? 'light' : pref === 'escuro' ? 'dark' : null
}

export function aplicarTema(pref: PreferenciaDeTema, documento: DocumentoComTema): void {
  const valor = atributoDoTema(pref)
  const dataset = documento.documentElement.dataset
  if (valor === null) delete dataset.theme
  else dataset.theme = valor
}

/** O tema que de fato aparece: o automático depende do sistema. */
export function temaVisto(pref: PreferenciaDeTema, sistemaEscuro: boolean): 'claro' | 'escuro' {
  return pref === 'automatico' ? (sistemaEscuro ? 'escuro' : 'claro') : pref
}
