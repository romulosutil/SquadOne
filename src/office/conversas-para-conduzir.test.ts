import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversasParaConduzir } from '../operations/conversas-para-conduzir.ts';
import type { CrmLead } from '../operations/types.ts';
const agora = Date.parse('2026-10-18T20:00:00-03:00');
const lead = (id: string, campos = {}) => ({ id, etapa: 'contato', marcos: {}, links: {}, ...campos } as CrmLead);
test('lacuna de histórico não vira prioridade; compromisso de hoje aparece primeiro', () => {
  const desconhecido = lead('sem-historico');
  const combinado = lead('combinado', { proximoPasso: { texto: 'Entregar o material pedido', data: '2026-10-18' } });
  assert.deepEqual(conversasParaConduzir([desconhecido, combinado], agora).map(x => x.lead.id), ['combinado']);
});
test('resposta humana recente vem antes de tarefa; robô e recusa não geram nova abordagem', () => {
  const humano = lead('humano', { conversa: { ultima: { direcao: 'entrada', em: '2026-10-18T12:00:00Z' } } });
  const robo = lead('robo', { conversa: { ultima: { direcao: 'entrada', em: '2026-10-18T12:00:00Z', papel: 'robo' } } });
  const recusa = { ...humano, id: 'recusa', resposta: { tipo: 'negativa', trecho: 'Não tenho interesse' } } as CrmLead;
  const tarefa = lead('tarefa', { proximoPasso: { texto: 'Enviar link pedido', data: '2026-10-18' } });
  assert.deepEqual(conversasParaConduzir([tarefa, robo, recusa, humano], agora).map(x => x.lead.id), ['humano', 'tarefa']);
});
test('espera combinada e compromisso futuro ficam com o time, sem cobrar uma ação do operador', () => {
  const espera = lead('espera', { proximoPasso: { texto: 'Esperar a decisão, sem nova cobrança', data: '2026-10-18' } });
  const futuro = lead('futuro', { proximoPasso: { texto: 'Entregar material', data: '2026-10-19' } });
  assert.equal(conversasParaConduzir([espera, futuro], agora).length, 0);
  assert.equal(conversasParaConduzir([lead('data-invalida', { proximoPasso: { texto: 'Enviar material', data: '2026-02-30' } })], agora).length, 0);
});
