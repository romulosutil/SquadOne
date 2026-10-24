import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CrmLead, CrmVisao } from '../src/operations/types.ts';
import { criarProtecaoProspeccao, lerPausaAutomatica, pausaPorRespostas, RetomadaRecusada, type SinalDaConta } from './protecao-prospeccao.ts';

const AGORA = Date.parse('2026-10-21T14:00:00Z');
const HORA = 3_600_000;
function leads(total = 5, humanos = 0, idade = 2 * HORA): CrmLead[] {
  return Array.from({ length: total }, (_, i) => ({ id: `site:${i}`, links: {},
    marcos: { enviado: new Date(AGORA - idade).toISOString(), ...(i < humanos ? { respondeu: new Date(AGORA - HORA / 2).toISOString() } : {}) },
    ...(i >= humanos && i % 2 ? { resposta: { tipo: 'bot', em: new Date(AGORA - HORA).toISOString(), trecho: 'Atendimento automático' } } : {}),
  } as CrmLead));
}
const visao = (ls: CrmLead[]) => ({ estado: 'ok', leads: ls }) as Pick<CrmVisao, 'estado' | 'leads'>;

test('mínimo 5, espera de 1h, 80% sem humana e robô não melhora a taxa', () => {
  assert.equal(pausaPorRespostas(visao(leads(4)), AGORA), null);
  assert.equal(pausaPorRespostas(visao(leads(5, 0, HORA - 1)), AGORA), null);
  assert.equal(pausaPorRespostas(visao(leads(5, 2)), AGORA), null);
  const p = pausaPorRespostas(visao(leads(5, 1)), AGORA)!;
  assert.equal(p.motivo, 'sem-resposta-humana'); assert.equal(p.amostra?.enviados, 5); assert.equal(p.amostra?.humanas, 1);
  assert.equal(pausaPorRespostas(visao(leads(5, 0, 24 * HORA + 1)), AGORA), null);
  assert.equal(pausaPorRespostas({ estado: 'sem-retrato', leads: leads() }, AGORA), null);
});

test('janela móvel cruza a meia-noite e soma ofertas, sem duplicar destinatário', () => {
  const ls = leads(5, 0, 12 * HORA); ls[0].links.whatsapp = 'https://wa.me/5511998887766';
  assert.ok(pausaPorRespostas(visao(ls), AGORA));
  ls[1].links.whatsapp = 'https://wa.me/551198887766';
  assert.equal(pausaPorRespostas(visao(ls), AGORA), null, '4 destinatários, apesar de 5 fichas');
});

async function montar() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'protecao-prospeccao-'));
  const estado = { agora: AGORA, visao: visao(leads()), saude: 'open' as 'open' | SinalDaConta | null };
  await fs.writeFile(path.join(dir, 'frente-comercial-config.json'), JSON.stringify({ ativo: true, origem: 'preservar' }));
  const criar = () => criarProtecaoProspeccao({ dir, agora: () => estado.agora, visao: async () => estado.visao, saude: async () => estado.saude });
  return { dir, estado, criar, protecao: criar(), fechar: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('pausa persistente desliga executor, sobrevive reinício/virada do dia e não retoma com novos retornos', async () => {
  const m = await montar();
  try {
    const p = await m.protecao.verificar(); assert.equal(p?.motivo, 'sem-resposta-humana');
    const config = JSON.parse(await fs.readFile(path.join(m.dir, 'frente-comercial-config.json'), 'utf8'));
    assert.equal(config.ativo, false); assert.equal(config.origem, 'preservar');
    m.estado.agora += 25 * HORA; m.estado.visao = visao([]);
    assert.deepEqual(await m.criar().verificar(), p);
    assert.deepEqual(await m.protecao.configurar(true), { ativo: true });
    assert.equal(await lerPausaAutomatica(m.dir), null);
  } finally { await m.fechar(); }
});

test('retomada é recusada com taxa ruim, conta desconectada ou cooldown de restrição', async () => {
  const m = await montar();
  try {
    await m.protecao.verificar();
    await assert.rejects(m.protecao.configurar(true), RetomadaRecusada);
    m.estado.visao = visao([]); m.estado.saude = 'desconectado';
    await assert.rejects(m.protecao.configurar(true), RetomadaRecusada);
    await m.protecao.verificar(null, 'restricao'); m.estado.saude = 'open';
    await assert.rejects(m.protecao.configurar(true), /24 horas/);
    m.estado.agora += 24 * HORA;
    await m.protecao.configurar(true); assert.equal(await lerPausaAutomatica(m.dir), null);
  } finally { await m.fechar(); }
});

test('sinal durável é consumido sem painel e só a retomada manual reconhece o sinal antigo', async () => {
  const m = await montar();
  try {
    m.estado.visao = visao([]);
    await fs.writeFile(path.join(m.dir, 'prospeccao-sinal.json'), JSON.stringify({ sinal: 'recusa', em: new Date(AGORA).toISOString() }));
    assert.equal((await m.protecao.verificar())?.motivo, 'recusa');
    await m.protecao.configurar(true);
    assert.equal(await m.protecao.verificar(), null, 'sinal revisado não recria a pausa');
    m.estado.agora += HORA;
    await fs.writeFile(path.join(m.dir, 'prospeccao-sinal.json'), JSON.stringify({ sinal: 'restricao', em: new Date(m.estado.agora).toISOString() }));
    assert.equal((await m.criar().verificar())?.motivo, 'restricao');
  } finally { await m.fechar(); }
});

test('arquivo de proteção ilegível falha fechado e uma reconexão não apaga a restrição', async () => {
  const m = await montar();
  try {
    await fs.writeFile(path.join(m.dir, 'prospeccao-pausa.json'), 'json inválido');
    await assert.rejects(m.protecao.verificar());
    await assert.rejects(m.protecao.configurar(true));
  } finally { await m.fechar(); }
});

test('rodada substitui só a pausa proporcional; desconexão continua bloqueando', async () => {
 const m = await montar();
 try {
  const p = criarProtecaoProspeccao({ dir:m.dir, agora:() => m.estado.agora, visao:async () => m.estado.visao, saude:async () => m.estado.saude, avaliarSilencio:false });
  assert.equal(await p.verificar(),null);
  m.estado.saude='desconectado';
  assert.equal((await p.verificar())?.motivo,'desconectado');
 } finally { await m.fechar(); }
});
