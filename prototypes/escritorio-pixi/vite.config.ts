import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const baseline = fileURLToPath(new URL('../../output/escritorio-camadas-2026-10-26/baseline/src/components/GameMap.vue', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: '../../public',
  plugins: [{
    name: 'comparacao-mesma-arte', enforce: 'pre',
    resolveId(source, importer) {
      // Este componente visual recebeu tokens em outro trabalho após o snapshot.
      // Ambos os runtimes usam a versão atual; a referência original fica intacta.
      if (importer?.replaceAll('\\', '/').includes('/baseline/') && source.endsWith('/EsteiraNoEscritorio.vue')) {
        return fileURLToPath(new URL('../../src/office/EsteiraNoEscritorio.vue', import.meta.url))
      }
      if (importer?.replaceAll('\\', '/').includes('/baseline/') && /\/linha-de-producao(?:\.ts)?$/.test(source)) {
        // A esteira histórica seleciona corredores pela identidade do objeto de pontos.
        return fileURLToPath(new URL('../../src/office/linha-de-producao.ts', import.meta.url))
      }
    },
  }, vue(), tailwindcss()],
  resolve: { dedupe: ['vue', 'pixi.js'] },
  optimizeDeps: { include: ['vue', 'pixi.js'], entries: ['index.html'] },
  define: { __OFFICE_BASELINE__: JSON.stringify(existsSync(baseline) ? '/@fs/' + baseline.replaceAll('\\', '/') : '') },
  server: { host: '127.0.0.1', port: 4178, strictPort: true, fs: { allow: ['../..'] } },
  build: { outDir: '../../output/escritorio-pixi/build', emptyOutDir: false },
})
