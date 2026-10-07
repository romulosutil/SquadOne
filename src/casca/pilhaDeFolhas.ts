/**
 * Folhas abertas, de baixo para cima. Só a de cima responde ao Esc e prende o
 * foco, e o `#app` só sai de `inert` quando a última fecha.
 */
export const pilhaDeFolhas: symbol[] = []
