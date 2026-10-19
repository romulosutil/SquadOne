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

// 19/10/2026: a lista também traz os passos da fila de venda (follow-up, "o que achou?"...), sem primeiro contato.
import { conversasParaVoce } from '../operations/conversas-para-conduzir.ts';
import type { CrmVisao } from '../operations/types.ts';
const comRetrato = (leads: CrmLead[], hoje: Array<{ id: string; ids: string[] }>) => ({
  estado: 'ok', leads,
  hoje: hoje.map((g) => ({ id: g.id, titulo: g.id, explicacao: '', itens: g.ids.map((leadId, ordem) => ({ leadId, acao: 'Fazer', detalhe: '', ordem, links: [] })) })),
}) as unknown as CrmVisao;
const base = (id: string, campos = {}) => ({ ...lead(id), produto: 'site', empresa: `Empresa ${id}`, nicho: 'pilates', cidade: 'Vitória', sinal: 'enviado', links: { whatsapp: `https://wa.me/55${id}` }, ...campos }) as CrmLead;
test('o follow-up do 3º dia aparece mesmo sem a conversa recente; o primeiro contato não entra; um lead por linha', () => {
  const fu = base('fu', { followupHoje: true, marcos: { enviado: '2026-10-13T12:00:00Z' }, conversa: { desde: '2026-10-13T12:00:00Z', mensagens: 3, ultima: { direcao: 'saida', em: '2026-10-15T12:00:00Z', trecho: 'oi' }, ultimaSaida: '2026-10-15T12:00:00Z' }, links: { whatsapp: 'https://wa.me/551', followup: 'https://wa.me/551?text=oi' } });
  const novo = base('novo', { etapa: 'novo', sinal: 'pronto', links: { enviar: 'https://x/enviar', whatsapp: 'https://wa.me/552' }, mensagemPronta: 'Olá' });
  const v = comRetrato([fu, novo], [{ id: 'followup', ids: ['fu'] }, { id: 'enviar', ids: ['novo'] }]);
  const lista = conversasParaVoce(v, agora);
  assert.deepEqual(lista.map((x) => x.lead.id), ['fu']);
  assert.equal(lista[0].rotulo, 'Follow-up');
  assert.equal(lista[0].acao?.tipo, 'followup');
});
test('o "Enviei" do dia tira o passo da lista; o "Pular" manda para o fim', () => {
  const conv = { desde: '2026-10-13T12:00:00Z', mensagens: 3, ultima: { direcao: 'saida', em: '2026-10-15T12:00:00Z', trecho: 'oi' }, ultimaSaida: '2026-10-15T12:00:00Z' };
  const a = base('a', { followupHoje: true, conversa: conv, marcos: { enviado: '2026-10-13T12:00:00Z' }, links: { whatsapp: 'https://wa.me/551', followup: 'https://wa.me/551?text=oi' } });
  const b = base('b', { followupHoje: true, conversa: conv, marcos: { enviado: '2026-10-13T12:00:00Z' }, links: { whatsapp: 'https://wa.me/552', followup: 'https://wa.me/552?text=oi' } });
  const v = comRetrato([a, b], [{ id: 'followup', ids: ['a', 'b'] }]);
  const [primeiro] = conversasParaVoce(v, agora);
  const chave = primeiro.acao!.chave;
  assert.deepEqual(conversasParaVoce(v, agora, { [chave]: { em: agora, pulou: false } }).map((x) => x.lead.id), [primeiro.lead.id === 'a' ? 'b' : 'a']);
  assert.equal(conversasParaVoce(v, agora, { [chave]: { em: agora, pulou: true } }).at(-1)?.lead.id, primeiro.lead.id);
});
test('sem retrato legível, lista vazia', () => {
  assert.deepEqual(conversasParaVoce(null, agora), []);
  assert.deepEqual(conversasParaVoce({ ...comRetrato([], []), estado: 'sem-retrato' } as CrmVisao, agora), []);
});
