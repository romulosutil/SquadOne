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

test('captura pendente aparece para conferência antes da classificação e sai após resposta do operador', () => {
  const campos = { atendimentoComercial: { id: 'entrada', tipo: 'handoff', alvo: 'operador', titulo: 'Sua vez', motivo: 'Resposta recebida', estado: 'pendente', ocorridoEm: '2026-10-18T12:00:00Z' } };
  const pendente = lead('capturada', campos);
  const fila = conversasParaConduzir([pendente], agora);
  assert.equal(fila.length, 1);
  assert.equal(fila[0].rotulo, 'Conferir resposta recebida');
  assert.equal(fila[0].resposta, false, 'não inventa classificação humana');
  const recepcao = lead('recepcao', { ...campos, resposta: {tipo:'bot',trecho:'Recebemos sua mensagem'} });
  assert.equal(conversasParaConduzir([recepcao], agora)[0].rotulo, 'Recepção automática — conferir');
  const atendida = lead('atendida', { ...campos, conversa: { ultima: { direcao: 'saida', em: '2026-10-18T12:10:00Z' }, ultimaSaida: '2026-10-18T12:10:00Z' } });
  assert.equal(conversasParaConduzir([atendida], agora).length, 0);
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

test('nova resposta supera a resolução ou pulo do passo anterior sem apagar o histórico', () => {
  const recebida = (em: string) => ({ desde: '2026-10-13T12:00:00Z', mensagens: 4, ultimaEntrada: em, ultimaSaida: '2026-10-18T20:00:00Z', ultima: { direcao: 'entrada', em, trecho: 'Quero esclarecer uma dúvida' } });
  const a = base('a', { followupHoje: true, conversa: recebida('2026-10-18T21:00:00Z'), links: { whatsapp: 'https://wa.me/551', followup: 'https://wa.me/551?text=oi' } });
  const v = comRetrato([a], [{ id: 'followup', ids: ['a'] }]);
  const chave = conversasParaVoce(v, agora)[0].acao!.chave;
  const em = Date.parse('2026-10-18T21:30:00Z');
  const feita = { [chave]: { em, pulou: false } };
  assert.equal(conversasParaVoce(v, agora, feita).length, 0);
  const b = base('b', { conversa: recebida('2026-10-18T21:50:00Z') });
  const nova = { ...a, conversa: recebida('2026-10-18T22:00:00Z') } as CrmLead;
  const atualizada = comRetrato([b, nova], [{ id: 'followup', ids: ['a'] }]);
  for (const pulou of [false, true]) {
    const lista = conversasParaVoce(atualizada, agora, { [chave]: { em, pulou } });
    assert.deepEqual(lista.map(c => c.lead.id), ['a', 'b']);
    assert.equal(lista[0].prioridade, 0);
    assert.equal(lista.filter(c => c.lead.id === 'a').length, 1);
  }
  assert.deepEqual(feita, { [chave]: { em, pulou: false } });
});

test('mensagem humana posterior supera classificação antiga de robô; menu automático continua fora', () => {
  const conversa = { ultima: { direcao: 'entrada', em: '2026-10-18T22:00:00Z', trecho: '*[Ana]* Pode me explicar?' } };
  const pessoa = base('humano', { conversa, resposta: { tipo: 'bot', em: '2026-10-17T12:00:00Z', trecho: '[Bot] Aguarde' } });
  const robo = base('robo', { conversa: { ultima: { ...conversa.ultima, trecho: '[Bot] Aguarde na fila' } } });
  assert.deepEqual(conversasParaConduzir([robo, pessoa], agora).map(c => c.lead.id), ['humano']);
});

// Auditoria da Fase 3 (20/10/2026): a revisão do contexto (`conferirHistorico`, tipo 'combinado') ganhava a
// prioridade do combinado e passava na frente do "o que achou?" e da proposta sem retorno. A ordem agora
// é a da fila de venda, de uma tabela só (PRIORIDADE_DA_FILA).
import { PRIORIDADE_DA_FILA, PRIORIDADE_DA_REVISAO, prioridadeDaAcao } from '../operations/proxima-venda.ts';
test('a ordem da fila de venda, completa e fixa: responder, proposta, combinado, o que achou, proposta sem retorno, revisão, follow-up, recusa, primeiro contato', () => {
  const ordem = [
    ['responder', { tipo: 'responder' }], ['mandar-proposta', { tipo: 'mandar-proposta' }], ['combinado', { tipo: 'combinado' }],
    ['depois-do-link', { tipo: 'depois-do-link' }], ['proposta sem retorno', { tipo: 'proposta' }],
    ['revisão', { tipo: 'combinado', revisao: true }], ['followup', { tipo: 'followup' }], ['desfecho', { tipo: 'desfecho' }], ['primeiro', { tipo: 'primeiro' }],
  ] as const;
  const prioridades = ordem.map(([, a]) => prioridadeDaAcao(a));
  assert.deepEqual(prioridades, [...prioridades].sort((x, y) => x - y), ordem.map(([nome]) => nome).join(' > '));
  assert.equal(new Set(prioridades).size, ordem.length, 'cada passo tem a sua posição');
  assert.equal(PRIORIDADE_DA_REVISAO, PRIORIDADE_DA_FILA.proposta + 1);
  assert.equal(PRIORIDADE_DA_FILA.followup, PRIORIDADE_DA_REVISAO + 1);
});
test('na lista, a revisão do contexto vem depois do "o que achou?" e antes do follow-up', () => {
  const conv = { desde: '2026-10-13T12:00:00Z', mensagens: 3, ultima: { direcao: 'saida', em: '2026-10-15T12:00:00Z', trecho: 'oi' }, ultimaSaida: '2026-10-15T12:00:00Z' };
  const link = (id: string) => ({ whatsapp: `https://wa.me/55${id}` });
  const convDoLink = { ...conv, ultima: { direcao: 'saida', em: new Date(agora - 30 * 3600_000).toISOString(), trecho: 'o link' }, ultimaSaida: new Date(agora - 30 * 3600_000).toISOString() };
  const achou = base('achou', { conversa: convDoLink, links: link('1'), marcos: { enviado: '2026-10-13T12:00:00Z', segundaEnviada: new Date(agora - 30 * 3600_000).toISOString() } });
  const revisao = base('revisao', { revisaoComercial: 'Conferir o último combinado antes de encerrar.', conversa: conv, links: link('2'), marcos: { enviado: '2026-10-13T12:00:00Z' } });
  const follow = base('follow', { followupHoje: true, conversa: conv, links: { ...link('3'), followup: 'https://wa.me/553?text=oi' }, marcos: { enviado: '2026-10-13T12:00:00Z' } });
  const lista = conversasParaVoce(comRetrato([follow, revisao, achou], [{ id: 'followup', ids: ['follow'] }]), agora);
  assert.deepEqual(lista.map((x) => [x.lead.id, x.rotulo]), [['achou', 'O que achou?'], ['revisao', 'Revisar o contexto'], ['follow', 'Follow-up']]);
});
