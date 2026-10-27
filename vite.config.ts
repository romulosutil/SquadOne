import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import { validarRenderizadorPadrao } from './scripts/escritorio-renderizador-padrao';

const FORMATO_CLIENT_ID = /^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$/;

/**
 * VITE_GOOGLE_CLIENT_ID é embutido no bundle, não lido em runtime: definir a
 * variável só no ambiente do container não conserta nada depois do build. Um
 * build sem ela (ou com o placeholder do .env.example) gera um app que abre
 * normal e só falha quando o usuário clica em Conectar — longe de onde está o
 * erro. Falhar aqui deixa o problema no lugar onde ele nasce.
 */
function exigirClientId(env: Record<string, string>): Plugin {
  return {
    name: 'squadone-exigir-client-id',
    apply: 'build',
    buildStart() {
      const valor = env.VITE_GOOGLE_CLIENT_ID;
      if (FORMATO_CLIENT_ID.test(valor ?? '')) return;
      this.error(
        `VITE_GOOGLE_CLIENT_ID inválido no build (${valor ?? 'ausente'}). ` +
          'Precisa ser o OAuth Client ID (tipo Web) do Google, terminando em ' +
          '.apps.googleusercontent.com. No Easypanel defina a variável de ' +
          'ambiente do serviço e rebuilde — mudá-la sem rebuild não tem efeito.',
      );
    },
  };
}

/** Valida antes de escrever dist: uma importação experimental não substitui o build servido. */
function exigirDom(): Plugin {
  return { name: 'squadone-escritorio-dom', apply: 'build', buildEnd(erro) {
    if (!erro) validarRenderizadorPadrao(this.getModuleIds());
  } };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [vue(), tailwindcss(), exigirClientId(env), exigirDom()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: { entries: ['index.html'] },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/output/**', '**/brag-output*/**', '**/graphify-out/**', '**/data/**'],
      },
    },
  };
});
