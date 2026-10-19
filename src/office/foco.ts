/** Move só o painel no desktop; no celular acompanha a página, sem duas rolagens. */
export function focarNaSala(el: HTMLElement | null) {
  if (!el) return
  el.focus({ preventScroll: true })
  const sala = el.closest<HTMLElement>('.sala-comando')
  const alvo = el.getBoundingClientRect()
  if (sala && getComputedStyle(sala).overflowY === 'auto') {
    const caixa = sala.getBoundingClientRect()
    if (alvo.top < caixa.top + 12 || alvo.bottom > caixa.bottom - 12) sala.scrollTop += alvo.top - caixa.top - 12
    return
  }
  if (alvo.top < 12 || alvo.top > window.innerHeight / 3) el.scrollIntoView({ block: 'start' })
}
