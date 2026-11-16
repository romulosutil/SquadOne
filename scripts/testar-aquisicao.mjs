import { spawnSync } from 'node:child_process';

function executar(programa, args) {
  const r = spawnSync(programa, args, { stdio: 'inherit' });
  if (r.error) { console.error(`Não foi possível executar ${programa}: ${r.error.message}`); process.exit(1); }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

executar(process.execPath, ['--import', 'tsx', '--test',
  'server/frente-comercial.test.ts', 'server/frente-rodada.test.ts',
  'server/envios-sem-travas.test.ts', 'server/aquisicao-comercial.test.ts',
  'src/operations-primeiro-contato.test.ts']);
executar(process.platform === 'win32' ? 'python' : 'python3', ['deploy/dell/aquisicao-comercial.test.py']);
