import { buildSync } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
// O sandbox do n8n não preserva os exports com getters de __toCommonJS.
// Publicar o contrato como propriedade simples, sem introspecção do objeto.
const result = buildSync({absWorkingDir:root, stdin:{contents:'import { classificarResposta } from "./src/operations/classificacao-resposta.ts"; PrumoClassificacaoGratuita = { classificarResposta };',resolveDir:root,sourcefile:'classificador-n8n.js'}, bundle:true, write:false, format:'iife', banner:{js:'var PrumoClassificacaoGratuita;'}, target:'es2022', legalComments:'none'})
writeFileSync(new URL('../deploy/dell/claude-ops/classificador-gratuito.bundle.js',import.meta.url),result.outputFiles[0].text)
