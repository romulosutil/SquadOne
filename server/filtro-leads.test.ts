import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lerFiltroLeads } from './filtro-leads.ts';
import { LeiturasDaMensagem } from './assistente-ferramentas.ts';

test('curadoria só expõe agregados conhecidos e recusa retrato vencido', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'curadoria-'));
  const agora = Date.parse('2026-10-26T22:00:00Z');
  try {
    assert.equal((await lerFiltroLeads(dir, agora)).semSinal, true);
    await fs.writeFile(path.join(dir, 'filtro-leads.json'), JSON.stringify({ versao: 'marina-curadoria-v1-20261026',
      geradoEm: new Date(agora).toISOString(), contatadosHoje: 11, resultadosHoje: { recusa: 2, silencio: 4, telefone: '5511999999999' },
      memoria: 'segredo', conversas: 'conteúdo privado', padroesAtivos: [{ oferta: 'site', dimensao: 'setor', valor: 'advocacia', ajuste: 5, casosRotulados: 2, comparacaoRotulada: 20 }] }));
    const r = await lerFiltroLeads(dir, agora);
    assert.equal(r.contatadosHoje, 11); assert.deepEqual(r.padroesAtivos, []);
    assert.doesNotMatch(JSON.stringify(r), /segredo|5511999999999|conteúdo privado/);
    assert.equal((await lerFiltroLeads(dir, agora + 31 * 3600_000)).semSinal, true);
    const leituras = new LeiturasDaMensagem({ filtroLeads: () => lerFiltroLeads(dir, agora) }, () => new Date(agora), { warn() {} });
    assert.equal((await leituras.executar('ler_filtro_leads', {})).contatadosHoje, 11);
    assert.equal(leituras.feitas.length, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
