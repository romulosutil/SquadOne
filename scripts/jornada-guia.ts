// Refaz docs/referencia/jornada-do-cliente.md a partir de src/operations/jornada.ts.
// Rode depois de mudar a jornada, a oferta ou o cardápio: npx tsx scripts/jornada-guia.ts
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { guiaDaJornada } from '../src/operations/jornada.ts'

const destino = fileURLToPath(new URL('../docs/referencia/jornada-do-cliente.md', import.meta.url))
writeFileSync(destino, guiaDaJornada(), 'utf8')
console.log(`Guia gravado em ${destino}`)
