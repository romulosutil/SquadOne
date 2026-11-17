import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { montarFrenteComercial, lerFrente } from './frente-comercial.ts';
import { criarMemoriaDaVenda } from './venda-do-dia.ts';
import { criarRodadaComercial } from './rodada-comercial.ts';
import type { CrmLead } from '../src/operations/types.ts';

// Executa o handler real sem socket ou qualquer acesso a WhatsApp/CRM externo.
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'primeiro-humano-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const agora = Date.parse('2026-11-16T18:00:00Z');
  const texto = 'Olá! Posso falar com a pessoa responsável pelo site da empresa?';
  const lead = { id: 'site:ficticio', empresa: 'Empresa fictícia', produto: 'site', etapa: 'novo', sinal: 'pronto',
    mensagemPronta: texto, marcos: {}, links: { whatsapp: 'https://wa.me/5527999998888', enviar: 'https://ficticio.test/enviar' }, eventos: [] } as unknown as CrmLead;
  const visao = { estado: 'ok' as const, leads: [lead] };
  await fs.writeFile(path.join(dir, 'frente-comercial-config.json'), JSON.stringify({ ativo: true }));
  const politicaAquisicao = path.join(dir, 'politica.json');
  await fs.writeFile(politicaAquisicao, JSON.stringify({versao:2,estado:'primeiro-contato',respostasAutomaticas:false}));
  await fs.writeFile(path.join(dir, 'frente-comercial.json'), JSON.stringify({ atualizadoEm: new Date(agora).toISOString(), estado: 'pronto', fila: [{ id: lead.id, estado: 'pronto' }] }));
  function montar(saude: 'open' | 'restricao' = 'open') {
    const router = express.Router();
    montarFrenteComercial(router, { dataDir: dir, politicaAquisicao, agora: () => agora, visao: async () => visao,
      saude: async () => saude, memoriaDaVenda: criarMemoriaDaVenda(path.join(dir, 'venda.json'), () => agora),
      rodada: criarRodadaComercial(path.join(dir, 'rodada.json'), () => agora) });
    return async (url: string, body: unknown, origin = 'http://central.test') => {
      const handler = router.stack.find((l: any) => l.route?.path === url && l.route.methods.post)!.route.stack.at(-1)!.handle;
      let status = 200, resultado: any;
      const req = { body, get: (name: string) => name === 'Origin' ? origin : name === 'host' ? 'central.test' : undefined };
      const res = { status(codigo: number) { status = codigo; return this; }, json(corpo: unknown) { resultado = corpo; return this; } };
      await handler(req as express.Request, res as unknown as express.Response, (erro: unknown) => { throw erro; });
      return { status, corpo: resultado };
    };
  }
  return { dir, agora, texto, lead, visao, montar };
}

test('primeiro contato usa o texto atual e não repete após concorrência ou reinício', async t => {
  const f = await fixture(t), post = f.montar();
  const resultados = await Promise.all([post('/crm/frente/reservar', { leadId: f.lead.id }), post('/crm/frente/reservar', { leadId: f.lead.id })]);
  assert.equal(resultados.filter(r => r.corpo.reservado).length, 1);
  assert.equal(resultados.find(r => r.corpo.reservado)!.corpo.texto, f.texto);
  assert.equal((await f.montar()('/crm/frente/reservar', { leadId: f.lead.id })).corpo.reservado, false);
});

test('uma resposta já recebida impede nova abertura e o painel declara atendimento humano', async t => {
  const f = await fixture(t);
  f.lead.resposta = { tipo: 'interesse', trecho: 'Pode falar comigo.' };
  const r = await f.montar()('/crm/frente/reservar', { leadId: f.lead.id });
  assert.equal(r.corpo.reservado, false);
  const estado = await lerFrente(f.dir, f.agora, f.visao);
  assert.equal(estado.aquisicao.estado, 'bloqueada');
  assert.equal(estado.aquisicao.respostasAutomaticas, false);
});

test('recusa, destino inválido, pausa manual e restrição do provedor continuam impedindo envio', async t => {
  const f = await fixture(t);
  f.lead.etapa = 'perdido';
  assert.equal((await f.montar()('/crm/frente/reservar', { leadId: f.lead.id })).corpo.reservado, false);
  f.lead.etapa = 'novo';
  const destino = f.lead.links.whatsapp;
  f.lead.links.whatsapp = 'https://outro.test/numero';
  assert.equal((await f.montar()('/crm/frente/reservar', { leadId: f.lead.id })).corpo.reservado, false);
  f.lead.links.whatsapp = destino;
  const post = f.montar();
  assert.equal((await post('/crm/frente/config', { ativo: false })).corpo.ativo, false);
  assert.equal((await post('/crm/frente/reservar', { leadId: f.lead.id })).corpo.reservado, false);
  assert.equal((await post('/crm/frente/config', { ativo: true })).corpo.ativo, true);
  assert.equal((await f.montar('restricao')('/crm/frente/reservar', { leadId: f.lead.id })).corpo.motivo, 'pausa');
});
