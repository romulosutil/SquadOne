/** Cadência percebida pelo navegador, não tempo de GPU. Mesma instrumentação nos dois modos. */
export function medirCadencia(duracao = 5000): Promise<{ amostras: number; medianaMs: number; p95Ms: number; acimaDe25Ms: number }> {
  return new Promise(resolve => {
    const valores: number[] = []
    let inicio = 0, anterior = 0
    function frame(agora: number) {
      if (!inicio) inicio = agora
      if (anterior) valores.push(agora - anterior)
      anterior = agora
      if (agora - inicio < duracao) { requestAnimationFrame(frame); return }
      valores.sort((a, b) => a - b)
      resolve({ amostras: valores.length, medianaMs: +valores[Math.floor(valores.length / 2)].toFixed(2),
        p95Ms: +valores[Math.floor(valores.length * .95)].toFixed(2), acimaDe25Ms: valores.filter(v => v > 25).length })
    }
    requestAnimationFrame(frame)
  })
}
