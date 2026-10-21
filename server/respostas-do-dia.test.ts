import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CrmLead } from '../src/operations/types.ts';
import { respostasDoDia } from './respostas-do-dia.ts';

const AGORA = Date.parse('2026-10-21T14:00:00Z');
const ENVIO = '2026-10-21T11:00:00Z';
const RESPOSTA = '2026-10-21T11:10:00Z';
const lead = (id: string, extra: Partial<CrmLead> = {}) => ({ id, marcos: { enviado: ENVIO }, links: {}, ...extra }) as CrmLead;

test('28 disparos do dia: 4 humanos, 9 robôs e 15 sem resposta; ontem com resposta hoje fica fora', () => {
  const ls = Array.from({ length: 28 }, (_, i) => lead(String(i), i < 4
    ? { resposta: { tipo: 'interesse', trecho: 'Pode mandar', em: RESPOSTA } }
    : i < 13 ? { resposta: { tipo: 'bot', trecho: 'Atendimento automático', em: RESPOSTA } } : {}));
  ls.push(lead('ontem', { marcos: { enviado: '2026-10-20T11:00:00Z', respondeu: RESPOSTA } }));
  ls.push(lead('reserva', { marcos: {} }));
  assert.deepEqual(respostasDoDia(ls, AGORA), { dia: '2026-10-21', enviados: 28, humanas: 4, robos: 9, semResposta: 15 });
});

test('dia de São Paulo, virada da meia-noite, datas inválidas e futuras', () => {
  const ls = ['2026-10-21T02:59:59Z', '2026-10-21T03:00:00Z', '2026-10-21T14:00:01Z', 'inválido']
    .map((em, i) => lead(String(i), { marcos: { enviado: em } }));
  assert.equal(respostasDoDia(ls, AGORA).enviados, 1);
  assert.deepEqual(respostasDoDia(ls, Date.parse('2026-10-22T03:00:00Z')), { dia: '2026-10-22', enviados: 0, humanas: 0, robos: 0, semResposta: 0 });
});

test('não conta resposta anterior ao disparo nem mensagem futura', () => {
  const ls = [lead('antiga', { marcos: { enviado: ENVIO, respondeu: '2026-10-20T12:00:00Z' } }),
    lead('futura', { resposta: { tipo: 'interesse', trecho: 'Sim', em: '2026-10-22T12:00:00Z' } })];
  assert.equal(respostasDoDia(ls, AGORA).semResposta, 2);
});

test('robô não vira humano por ultimaEntrada antiga; recepção posterior substitui o robô', () => {
  const bot = lead('bot', { resposta: { tipo: 'bot', trecho: 'Bem-vindo', em: RESPOSTA },
    conversa: { desde: ENVIO, mensagens: 2, ultimaEntrada: RESPOSTA,
      ultima: { direcao: 'entrada', em: RESPOSTA, trecho: 'Bem-vindo' } } });
  assert.equal(respostasDoDia([bot], AGORA).robos, 1);
  assert.equal(respostasDoDia([{ ...bot, marcos: { enviado: ENVIO, respondeu: RESPOSTA } }], AGORA).humanas, 1,
    'marco humano confirmado não desaparece se a classificação mais recente é de um robô');
  const recepcao = { direcao: 'entrada' as const, em: '2026-10-21T12:00:00Z', trecho: 'Vou chamar a responsável', papel: 'recepcao' as const };
  assert.deepEqual(respostasDoDia([{ ...bot, conversa: { ...bot.conversa!, recentes: [recepcao], ultima: recepcao } }], AGORA),
    { dia: '2026-10-21', enviados: 1, humanas: 1, robos: 0, semResposta: 0 });
});

test('um destinatário em ofertas diferentes conta uma vez; resposta humana tem prioridade', () => {
  const a = lead('site:a', { links: { whatsapp: 'https://wa.me/5511998887766' }, resposta: { tipo: 'bot', trecho: 'Olá', em: RESPOSTA } });
  const b = lead('iris:a', { links: { whatsapp: 'https://wa.me/551198887766' }, marcos: { enviado: ENVIO, respondeu: RESPOSTA } });
  assert.deepEqual(respostasDoDia([a, b], AGORA), { dia: '2026-10-21', enviados: 1, humanas: 1, robos: 0, semResposta: 0 });
});
