import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { bloqueioAquisicao } from './aquisicao-comercial.ts';
import { montarFrenteComercial, lerFrente } from './frente-comercial.ts';
import type { MemoriaDaVenda } from './venda-do-dia.ts';

test('bloqueio não publica previsão de envio conservada no estado legado', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aquisicao-previsao-'));
  try {
    await fs.writeFile(path.join(dir, 'frente-comercial-config.json'), JSON.stringify({ ativo: true }));
    const semEstado = await lerFrente(dir, Date.now(), undefined, path.resolve('src/testes/aquisicao-bloqueada.json'));
    assert.equal(semEstado.proximoEnvioEm, null);
    await fs.writeFile(path.join(dir, 'frente-comercial.json'), JSON.stringify({ estado: 'pronto', atualizadoEm: new Date().toISOString(), proximoEnvioEm: '2099-01-01T12:00:00Z' }));
    const frente = await lerFrente(dir, Date.now(), undefined, path.resolve('src/testes/aquisicao-bloqueada.json'));
    assert.equal(frente.estado, 'bloqueado');
    assert.equal(frente.proximoEnvioEm, null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('política permanece bloqueada com configuração ausente, inválida ou supostamente liberada', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aquisicao-'));
  const arquivo = path.join(dir, 'politica.json');
  try {
    for (const valor of [null, '{', JSON.stringify({ versao: 1, estado: 'liberado' }), JSON.stringify({ versao: 1, estado: 'bloqueado', motivo: 'restricao-apos-envios-em-massa-2026-11-13' })]) {
      if (valor !== null) await fs.writeFile(arquivo, valor);
      assert.equal((await bloqueioAquisicao(arquivo)).bloqueado, true);
    }
    assert.deepEqual(await bloqueioAquisicao(), { bloqueado: true, motivo: 'operacao-preparada-aguardando-retomada' });
    await fs.writeFile(arquivo, JSON.stringify({ versao: 2, estado: 'primeiro-contato', respostasAutomaticas: false }));
    assert.deepEqual(await bloqueioAquisicao(arquivo), { bloqueado: false, motivo: 'primeiro-contato-depois-romulo' });
    for (const respostasAutomaticas of [true, null, 'false']) {
      await fs.writeFile(arquivo, JSON.stringify({ versao: 2, estado: 'primeiro-contato', respostasAutomaticas }));
      assert.equal((await bloqueioAquisicao(arquivo)).bloqueado, true);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('rota real não reserva nem consulta CRM mesmo após ativação e reinício da aplicação', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aquisicao-rota-'));
  let consultas = 0;
  let reservas = 0;
  const memoria = { reservarPrimeiro: async () => { reservas++; return { ok: true }; } } as unknown as MemoriaDaVenda;
  try {
    for (let reinicio = 0; reinicio < 2; reinicio++) {
      await fs.writeFile(path.join(dir, 'frente-comercial-config.json'), JSON.stringify({ ativo: true }));
      const app = express();
      const router = express.Router();
      montarFrenteComercial(router, { dataDir: dir, politicaAquisicao: path.resolve('src/testes/aquisicao-bloqueada.json'), memoriaDaVenda: memoria, visao: async () => { consultas++; return { estado: 'ok', leads: [] }; } });
      app.use(router);
      const server = app.listen(0, '127.0.0.1');
      try {
        await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('endereço inválido');
        const origin = `http://127.0.0.1:${addr.port}`;
        const consultasAntesDaReserva = consultas;
        const response = await fetch(`${origin}/crm/frente/reservar`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ leadId: 'site:teste' }) });
        assert.deepEqual(await response.json(), { reservado: false, motivo: 'aquisicao-bloqueada', detalhe: 'restricao-apos-envios-em-massa-2026-11-13', ate: null });
        assert.equal(consultas, consultasAntesDaReserva, 'bloqueio recusa antes de consultar a carteira');
        const status = await (await fetch(`${origin}/crm/frente`)).json() as { estado: string; aquisicao: { estado: string; primeirosContatosAutomaticos: boolean } };
        assert.equal(status.estado, 'bloqueado');
        assert.equal(status.aquisicao.estado, 'bloqueada');
        assert.equal(status.aquisicao.primeirosContatosAutomaticos, false);
        const config = async (ativo: boolean) => fetch(`${origin}/crm/frente/config`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ ativo }) });
        assert.equal((await config(true)).status, 409);
        assert.equal((await config(false)).status, 200);
      } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
    }
    assert.ok(consultas > 0, 'a leitura do painel conserva a coorte do CRM no Dell');
    assert.equal(reservas, 0);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
