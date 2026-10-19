import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { lerFrente, lerPrimeirosDoTime, montarFrenteComercial } from './frente-comercial.ts';
import { criarMemoriaDaVenda } from './venda-do-dia.ts';
import type { CrmLead, CrmVisao } from '../src/operations/types.ts';

// O time comercial na Central (19/10/2026). Diretório temporário, retrato inventado: nada toca
// data/, o CRM, o n8n ou o WhatsApp.

const AGORA = Date.parse('2026-10-19T14:00:00Z'); // segunda, 11:00 em São Paulo
const MSG = 'Olá! Vi que a empresa ainda não tem site. Fiz uma prévia, posso mandar?';

function lead(id: string, extra: Partial<CrmLead> = {}): CrmLead {
  return {
    id, chave: id.split(':')[1], empresa: `Empresa ${id}`, produto: 'site', nicho: 'pilates', cidade: 'Vitória', etapa: 'novo', sinal: 'pronto',
    mensagemPronta: MSG, links: { enviar: 'https://dell.test/webhook/enviar', whatsapp: 'https://wa.me/5511998887766' }, marcos: {}, ...extra,
  } as unknown as CrmLead;
}

async function montar(leads: CrmLead[], fila: Array<{ id: string; estado: string }>, ativo = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frente-'));
  await fs.writeFile(path.join(dir, 'frente-comercial-config.json'), JSON.stringify({ ativo }));
  await fs.writeFile(path.join(dir, 'frente-comercial.json'), JSON.stringify({ atualizadoEm: new Date(AGORA).toISOString(), estado: 'pronto', fila }));
  const relogio = { agora: AGORA };
  const memoriaDaVenda = criarMemoriaDaVenda(path.join(dir, 'venda-do-dia.json'), () => relogio.agora);
  const visao = { estado: 'ok', leads, hoje: [] } as unknown as CrmVisao;
  const app = express(); const router = express.Router();
  montarFrenteComercial(router, { dataDir: dir, memoriaDaVenda, visao: async () => visao, agora: () => relogio.agora }); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const reservar = async (leadId: string, origin: string | null = base) => {
    const r = await fetch(`${base}/crm/frente/reservar`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ leadId }) });
    return { status: r.status, corpo: await r.json() as Record<string, unknown> };
  };
  const fechar = async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await fs.rm(dir, { recursive: true, force: true }); };
  return { dir, base, relogio, memoriaDaVenda, reservar, fechar };
}

test('reserva: o lead do time sai com o texto do Balcão e entra no ritmo de todos como "time"', async () => {
  const m = await montar([lead('site:a'), lead('site:b')], [{ id: 'site:a', estado: 'pronto' }, { id: 'site:b', estado: 'pronto' }]);
  try {
    assert.deepEqual((await m.reservar('site:a')).corpo, { reservado: true, texto: MSG });
    assert.deepEqual((await m.memoriaDaVenda.ler()).primeiros['site:a'], { em: AGORA, por: 'time' });
    // O segundo, logo depois: o intervalo de 4 min da Central vale para o time também.
    assert.deepEqual((await m.reservar('site:b')).corpo, { reservado: false, motivo: 'intervalo', ate: new Date(AGORA + 4 * 60_000).toISOString() });
    m.relogio.agora = AGORA + 4 * 60_000;
    assert.equal((await m.reservar('site:b')).corpo.reservado, true);
    // O mesmo lead de novo: já tem o primeiro do dia.
    m.relogio.agora = AGORA + 9 * 60_000;
    assert.equal((await m.reservar('site:a')).corpo.motivo, 'ja-tocado');
  } finally { await m.fechar(); }
});

test('reserva: o toque da Central conta no ritmo do time e tira o lead dele', async () => {
  const m = await montar([lead('site:a'), lead('site:b')], [{ id: 'site:a', estado: 'pronto' }, { id: 'site:b', estado: 'pronto' }]);
  try {
    await m.memoriaDaVenda.primeiroContato('site:b', 'central');
    assert.equal((await m.reservar('site:a')).corpo.motivo, 'intervalo');
    m.relogio.agora = AGORA + 5 * 60_000;
    assert.equal((await m.reservar('site:b')).corpo.motivo, 'ja-tocado');
  } finally { await m.fechar(); }
});

test('reserva: dois pedidos juntos não passam os dois pelo ritmo', async () => {
  const m = await montar([lead('site:a'), lead('site:b')], [{ id: 'site:a', estado: 'pronto' }, { id: 'site:b', estado: 'pronto' }]);
  try {
    const [a, b] = await Promise.all([m.reservar('site:a'), m.reservar('site:b')]);
    assert.equal([a, b].filter((r) => r.corpo.reservado === true).length, 1);
  } finally { await m.fechar(); }
});

test('reserva: Triagem, fora da fila, time pausado, gate e fora do expediente recusam', async () => {
  const m = await montar(
    [lead('site:a'), lead('estampa:r', { produto: 'estampa', sinal: 'revisar' } as Partial<CrmLead>), lead('site:fora'), lead('site:marca', { mensagemPronta: 'Olá {{nome}}, tudo bem?' })],
    [{ id: 'site:a', estado: 'pronto' }, { id: 'estampa:r', estado: 'pronto' }, { id: 'site:marca', estado: 'pronto' }],
  );
  try {
    assert.equal((await m.reservar('estampa:r')).corpo.motivo, 'nao-elegivel');
    assert.equal((await m.reservar('site:fora')).corpo.motivo, 'nao-e-do-time');
    assert.equal((await m.reservar('site:marca')).corpo.motivo, 'mensagem-barrada');
    assert.equal((await m.reservar('site:a', null)).status, 403);
    assert.equal((await m.reservar('site:a', 'https://outro.test')).status, 403);
    assert.equal((await m.reservar('../x')).status, 400);
    m.relogio.agora = Date.parse('2026-10-19T21:00:00Z'); // 18:00 em São Paulo
    assert.deepEqual((await m.reservar('site:a')).corpo, { reservado: false, motivo: 'fora-do-expediente', ate: null });
    assert.deepEqual((await m.memoriaDaVenda.ler()).primeiros, {});
    await fs.writeFile(path.join(m.dir, 'frente-comercial-config.json'), JSON.stringify({ ativo: false }));
    m.relogio.agora = AGORA;
    assert.equal((await m.reservar('site:a')).corpo.motivo, 'nao-e-do-time');
  } finally { await m.fechar(); }
});

test('quem faz o primeiro contato, do disco: a fila do time com ele ligado, e o que ele já começou sempre', async () => {
  const m = await montar([], [{ id: 'site:a', estado: 'pronto' }, { id: 'site:b', estado: 'enviado' }, { id: 'site:c', estado: 'lixo' }]);
  try {
    assert.deepEqual([...await lerPrimeirosDoTime(m.dir)].sort(), ['site:a', 'site:b']);
    await fs.writeFile(path.join(m.dir, 'frente-comercial-config.json'), JSON.stringify({ ativo: false }));
    assert.deepEqual([...await lerPrimeirosDoTime(m.dir)], ['site:b']);
    await fs.rm(path.join(m.dir, 'frente-comercial.json'));
    assert.deepEqual([...await lerPrimeirosDoTime(m.dir)], []);
  } finally { await m.fechar(); }
});

test('sem retrato não inventa avaliações nem envios; snapshot não expõe campos de integração', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frente-'));
  try {
    const vazio = await lerFrente(dir, AGORA); assert.equal(vazio.atualizadoEm, null); assert.equal(vazio.estado, 'iniciando');
    await fs.writeFile(path.join(dir, 'frente-comercial-config.json'), JSON.stringify({ ativo: true }));
    await fs.writeFile(path.join(dir, 'frente-comercial.json'), JSON.stringify({ atualizadoEm: new Date(AGORA).toISOString(), estado: 'pronto', fila: [{ id: 'site:1', numero: 'segredo', recibo: 'privado', nota: 80 }], apikey: 'nao-sai' }));
    const v = await lerFrente(dir, AGORA); assert.equal(v.estado, 'pronto');
    // O teto mostrado é o da trava de ritmo da Central (1ª semana do número: 10), não uma cota do time.
    assert.equal(v.limite, 10);
    assert.doesNotMatch(JSON.stringify(v), /segredo|privado|nao-sai/);
    await fs.writeFile(path.join(dir, 'frente-comercial.json'), JSON.stringify({ atualizadoEm: '2020-01-01T00:00:00Z', estado: 'pronto' }));
    assert.equal((await lerFrente(dir, AGORA)).estado, 'sem-sinal');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('pausa é configuração de negócio da mesma origem, sem ampliar limites ou apagar a pausa existente', async () => {
  const m = await montar([], []);
  const post = (body: unknown, origin?: string) => fetch(`${m.base}/crm/frente/config`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ ativo: true })).status, 403);
    assert.equal((await post({ ativo: true }, 'https://outro.test')).status, 403);
    assert.equal((await post({ ativo: true, limite: 1000 }, m.base)).status, 400);
    const arquivo = path.join(m.dir, 'frente-comercial-config.json'); await fs.writeFile(arquivo, JSON.stringify({ ativo: true, pausadoAte: '2030-01-01' }));
    assert.equal((await post({ ativo: false }, m.base)).status, 200);
    const config = JSON.parse(await fs.readFile(arquivo, 'utf8')); assert.equal(config.ativo, false); assert.equal(config.limite, undefined); assert.equal(config.pausadoAte, '2030-01-01');
  } finally { await m.fechar(); }
});
