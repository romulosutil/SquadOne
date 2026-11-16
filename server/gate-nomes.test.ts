import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conferirMensagem } from './gate-de-envio.ts';

const texto = 'Oi! Vocês já têm um site para apresentar os serviços e receber pedidos?';
for (const nome of [
  'Isolda Dantas | Advogada em Natal',
  'Advogado do Consumidor | Matheus Vasconcelos Advocacia',
  'Dra. Sandra Regina | Advogado em Salvador | Direito do Consumidor - EQUIPE ESPECIALIZADA ATENDEMOS TODAS AS ÁREAS',
  'Franco e Franco Sociedade de Advogados',
  'Souza & Souza',
]) {
  test(`aceita o nome comercial legítimo: ${nome}`, () => {
    assert.equal(conferirMensagem(texto, { modo: 'bloquear', tipo: 'primeiro', nome }).bloqueia, false);
  });
}

for (const nome of ['Clínica Clínica Sorriso', 'Franco e Franco Franco', 'Empresa | <script>', 'Empresa | [NOME]', 'Empresa\nContato', 'https://empresa.test', '--- 12']) {
  test(`continua barrando nome inválido: ${JSON.stringify(nome)}`, () => {
    assert.ok(conferirMensagem(texto, { modo: 'bloquear', tipo: 'primeiro', nome }).problemas.some(p => p.codigo === 'nome_invalido'));
  });
}

test('nome legítimo não libera destinatário divergente', () => {
  const r = conferirMensagem(texto, { modo: 'bloquear', tipo: 'primeiro', nome: 'Franco e Franco',
    destino: { registro: 'https://wa.me/5511988880001', link: 'https://wa.me/5511988880002' } });
  assert.equal(r.bloqueia, true);
  assert.ok(r.problemas.some(p => p.codigo === 'destinatario_diferente'));
});
