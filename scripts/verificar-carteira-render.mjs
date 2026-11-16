// Verificação de integração do componente real com a projeção, sem rede de clientes.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { default: Carteira } = await server.ssrLoadModule('/src/operations/CarteiraComercial.vue');
  const { default: Aquisicao } = await server.ssrLoadModule('/src/operations/FrenteComercial.vue');
  const { projetarCarteiraCrm } = await server.ssrLoadModule('/src/operations/carteira-crm.ts');
  const em = '2026-11-13T19:00:00Z', agora = Date.parse('2026-11-16T12:00:00Z');
  const lead = (id, empresa, extra = {}) => ({ id: 'site:' + id, produto: 'site', chave: id, empresa,
    links: {}, eventos: [], etapa: 'proposta', marcos: { enviado: em }, proposta: { em }, ...extra });
  const carteira = projetarCarteiraCrm([
    lead('sintetica-aberta', 'Empresa Sintética Aberta', { proximoPasso: { texto: 'Conferir escopo.', data: '2026-11-17', registradoEm: em } }),
    lead('sintetica-encerrada', 'Empresa Sintética Encerrada', { etapa: 'perdido', motivoPerda: 'recusou' }),
  ], agora);
  const html = await renderToString(createSSRApp(Carteira, { carteira, disponivel: true }));
  assert.match(html, /Empresa Sintética Aberta/);
  assert.doesNotMatch(html, /Empresa Sintética Encerrada/);
  assert.match(html, /17\/11/);
  assert.doesNotMatch(html, /16\/11.*21:00/);
  assert.match(html, /Revisar contexto e pendências/);
  const semFonte = await renderToString(createSSRApp(Carteira, { carteira: projetarCarteiraCrm([], agora, false), disponivel: false }));
  assert.match(semFonte, /fonte da carteira está indisponível/);
  assert.doesNotMatch(semFonte, /Nenhuma oportunidade comprovada|carteira-comercial__balanco/);
  const vazia = await renderToString(createSSRApp(Carteira, { carteira: projetarCarteiraCrm([], agora, true), disponivel: true }));
  assert.match(vazia, /Nenhuma oportunidade comprovada/);
  const aquisicao = await renderToString(createSSRApp(Aquisicao, { configurar: true }));
  assert.match(aquisicao, /Primeiros contatos automáticos bloqueados/);
  assert.doesNotMatch(aquisicao, /Ativar primeiros contatos/);
  console.log('Renderização real: carteira, encerradas, data civil, fonte ausente, vazio e aquisição bloqueada aprovados.');
} finally { await server.close(); }
