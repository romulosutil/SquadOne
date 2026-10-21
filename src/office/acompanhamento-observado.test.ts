import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acompanhamentoObservado } from '../operations/acompanhamento-observado.ts';
import type { CrmLead } from '../operations/types.ts';
test('sem histórico não presume conclusão ou envio', () => {
  const e = acompanhamentoObservado({} as CrmLead);
  assert.equal(e.tom, 'atencao'); assert.match(e.detalhe, /não considera a tarefa concluída/);
});
test('envio observado dispensa confirmação manual, sem afirmar conclusão de tarefa', () => {
  const e = acompanhamentoObservado({ conversa: { ultima: { direcao: 'saida', em: new Date().toISOString() } } } as CrmLead);
  assert.equal(e.titulo, 'Mensagem observada'); assert.doesNotMatch(e.titulo, /conclu/);
});
test('resposta de robô não vira resposta humana', () => {
  const e = acompanhamentoObservado({ conversa: { ultima: { direcao: 'entrada', papel: 'robo' } } } as CrmLead);
  assert.equal(e.titulo, 'Time acompanhando');
});

test('abrir WhatsApp não confirma envio nem reutiliza uma saída antiga', () => {
  const em = '2026-10-21T12:00:00Z';
  const lead = { conversa: { ultimaSaida: em, ultima: { direcao: 'saida', em } } } as CrmLead;
  assert.equal(acompanhamentoObservado(lead, em).titulo, 'Aguardando sincronização do envio');
  assert.equal(acompanhamentoObservado({} as CrmLead, null).titulo, 'Aguardando sincronização do envio');
  assert.equal(acompanhamentoObservado(lead, '2026-10-21T11:00:00Z').titulo, 'Mensagem observada');
  assert.equal(acompanhamentoObservado(lead, null).titulo, 'Mensagem observada');
});

test('retorno depois da saída observada aparece automaticamente, sem pedir outro registro', () => {
  const lead = { conversa: { ultimaSaida: '2026-10-21T12:00:00Z', ultima: { direcao: 'entrada', em: '2026-10-21T12:01:00Z' } } } as CrmLead;
  const estado = acompanhamentoObservado(lead, '2026-10-21T11:00:00Z');
  assert.equal(estado.titulo, 'Resposta recebida');
  assert.match(estado.detalhe, /não é preciso registrá-la de novo/);
});
