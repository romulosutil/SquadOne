import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCollector, scoreItem } from './collect-pncp.mjs';

// Item real da coleta de 29/09/2026 07:30: qualificado com prazo às 07:59,
// chegou vencido no WhatsApp das 08:00.
const itaqui = {
  numeroControlePNCP: '88120662000146-1-000348/2026',
  objetoCompra: '[Portal de Compras Públicas] - AQUISIÇÃO DE MATERIAIS DE COMUNICAÇÃO VISUAL E APOIO DESTINADOS AOS EVENTOS, CAMPANHAS E AÇÕES DE CONSCIENTIZAÇÃO E COMBATE AO HIV/AIDS',
  dataEncerramentoProposta: '2026-09-29T07:59:00',
  valorTotalEstimado: 5879.17,
  modalidadeNome: 'Pregão - Eletrônico',
  orgaoEntidade: { cnpj: '88120662000146', razaoSocial: 'MUNICIPIO DE ITAQUI' },
  unidadeOrgao: { ufSigla: 'RS', municipioNome: 'Itaqui' },
  anoCompra: 2026,
  sequencialCompra: 348,
  dataAtualizacao: '2026-09-20T10:00:00',
};
const coleta = new Date('2026-09-29T10:30:00.043Z'); // 07:30 em Brasília

test('prazo antes de coleta + 3 h não é qualificado', () => {
  const vencendo = scoreItem(itaqui, coleta);
  assert.equal(vencendo.keep, false);
  assert.equal(vencendo.too_close, true);
  assert.equal(vencendo.score, 72);

  const semana = scoreItem({ ...itaqui, dataEncerramentoProposta: '2026-10-06T10:00:00' }, coleta);
  assert.equal(semana.keep, true);
  assert.equal(semana.too_close, false);

  const dezDaManha = scoreItem({ ...itaqui, dataEncerramentoProposta: '2026-09-29T10:29:00' }, coleta);
  assert.equal(dezDaManha.keep, false);
  const depoisDoCorte = scoreItem({ ...itaqui, dataEncerramentoProposta: '2026-09-29T10:31:00' }, coleta);
  assert.equal(depoisDoCorte.keep, true);
});

test('relatório separa o descartado por prazo, sem rede', async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'pncp-prazo-'));
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    totalPaginas: 1,
    data: [itaqui, { ...itaqui, numeroControlePNCP: 'x-2', sequencialCompra: 349, dataEncerramentoProposta: '2026-10-06T10:00:00' }],
  }));
  context.after(async () => {
    globalThis.fetch = fetchOriginal;
    await rm(dataDir, { recursive: true, force: true });
  });

  const report = await runCollector({ dataDir, now: coleta });
  assert.equal(report.counts.qualified, 1);
  assert.equal(report.qualified[0].id, 'x-2');
  assert.equal(report.counts.deadline_dropped, 1);
  assert.equal(report.deadline_dropped[0].id, itaqui.numeroControlePNCP);

  const md = await readFile(path.join(dataDir, 'latest-report.md'), 'utf8');
  assert.match(md, /Descartados por prazo curto \(encerram antes de 29\/09\/2026,? 10:30\): 1/);
  assert.doesNotMatch(md, /2026-09-29T07:59/);
});
