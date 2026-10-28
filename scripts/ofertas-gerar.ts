// Refaz server/ofertas.gerado.ts a partir de deploy/dell/claude-ops/prumo-ofertas.json.
// Rode depois de criar ou mudar uma oferta no JSON: npx tsx scripts/ofertas-gerar.ts
// Em seguida, npx vue-tsc --noEmit aponta o que a oferta nova ainda exige à mão (ops/n8n/NOVA-OFERTA.md).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gerarOfertas } from '../server/ofertas-gerador.ts'

const origem = fileURLToPath(new URL('../deploy/dell/claude-ops/prumo-ofertas.json', import.meta.url))
const destino = fileURLToPath(new URL('../server/ofertas.gerado.ts', import.meta.url))
writeFileSync(destino, gerarOfertas(JSON.parse(readFileSync(origem, 'utf8'))), 'utf8')
console.log(`Ofertas gravadas em ${destino}`)
