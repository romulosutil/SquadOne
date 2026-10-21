import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { criarSinalDoCrm } from './crm-ao-vivo.ts';

const esperar = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function ate(condicao: () => boolean) {
  const limite = Date.now() + 3_000;
  while (!condicao() && Date.now() < limite) await esperar(25);
  assert.ok(condicao(), 'mudança deve ser avisada sem esperar a consulta periódica');
}

test('conversa e retrato avisam todos os clientes; arquivos alheios e cliente fechado não recebem sinais', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'crm-vivo-'));
  const conversas = path.join(pasta, 'conversas');
  await fs.mkdir(conversas);
  const observar = criarSinalDoCrm({ retrato: path.join(pasta, 'crm.json'), conversas });
  let a = 0, b = 0;
  const pararA = observar(() => a++), pararB = observar(() => b++);
  try {
    await ate(() => a > 0 && b > 0);
    const antes = a;
    await fs.writeFile(path.join(conversas, 'lead.jsonl'), 'mensagem privada');
    await ate(() => a > antes);
    assert.equal(a, b);
    pararA();
    const fechado = a, aberto = b;
    await fs.writeFile(path.join(pasta, 'crm.json.tmp'), '{}');
    await fs.rename(path.join(pasta, 'crm.json.tmp'), path.join(pasta, 'crm.json'));
    await ate(() => b > aberto);
    assert.equal(a, fechado);
    const semMudanca = b;
    await fs.writeFile(path.join(pasta, 'outro.txt'), 'sem relação');
    await esperar(350);
    assert.equal(b, semMudanca);
    pararB();
    await fs.appendFile(path.join(conversas, 'lead.jsonl'), '\noutra mensagem');
    await esperar(350);
    assert.equal(b, semMudanca);
  } finally { pararA(); pararB(); await fs.rm(pasta, { recursive: true, force: true }); }
});

test('reconectar observa novas gravações e pastas ausentes não derrubam a conexão', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'crm-vivo-'));
  const observar = criarSinalDoCrm({ retrato: path.join(pasta, 'crm.json'), conversas: path.join(pasta, 'ausente') });
  let sinais = 0;
  const parar = observar(() => sinais++);
  await ate(() => sinais > 0);
  parar();
  const reconectar = observar(() => sinais++);
  try {
    const antes = sinais;
    await fs.writeFile(path.join(pasta, 'crm.json'), '{}');
    await ate(() => sinais > antes);
  } finally { reconectar(); await fs.rm(pasta, { recursive: true, force: true }); }
});
