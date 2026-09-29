import { readFile } from 'node:fs/promises';
import { runCollector, writeCollectorFailure } from './collect-pncp.mjs';

const reportPath = '/data/latest-run.json';
const timeZone = 'America/Sao_Paulo';

function localDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

try {
  const latest = JSON.parse(await readFile(reportPath, 'utf8'));
  // Só uma coleta que DEU CERTO hoje dispensa a repescagem. Antes, a falha das
  // 07:30 (status source_unavailable) também contava como "já coletou" e o
  // radar ficava dias sem dados sem ninguém tentar de novo.
  const completed = (latest.status ?? 'completed') === 'completed';
  if (completed && latest.run_at && localDate(new Date(latest.run_at)) === localDate()) {
    console.log('PNCP catch-up skipped: a collection already completed today.');
    process.exit(0);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

try {
  const report = await runCollector();
  console.log(JSON.stringify({
    run_at: report.run_at,
    fetched: report.counts.fetched,
    qualified: report.counts.qualified,
    new_or_updated: report.counts.new_or_updated,
  }));
} catch (error) {
  await writeCollectorFailure(error);
  console.error(`PNCP catch-up failed: ${error instanceof Error ? error.message : error}`);
  // Código ≠ 0 faz o systemd (Restart=on-failure, 15 min) tentar de novo.
  process.exit(1);
}
