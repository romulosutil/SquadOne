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
