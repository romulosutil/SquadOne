import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import express from "express";
import type { Content, GenerateContentParameters } from "@google/genai";
import { guardaDeOrigem } from "./acesso.ts";
import { criarAssistente, type RespostaDoGemini } from "./assistente.ts";
import type { FontesDoAssistente } from "./assistente-ferramentas.ts";
import { montarCrm, validarRetrato, validarRegistro, type CrmStore } from "./crm.ts";
import { createOperationsRouter, HermesReadingsStore, OperationsProjectStore, type OperationsConfig } from "./operations.ts";
import {
  acompanhar,
  chaveParaRegistro,
  contextoDoEndereco,
  ErroDoAssistente,
  enviar,
  falhaDaResposta,
  lerConversa,
  registrarDesfecho,
} from "../src/casca/assistente.ts";
import { RESPOSTA_NA_TELA_DE_FINANCAS } from "../src/operations/assistente.ts";
import type { CartaoDoAssistente, ConversaDoAssistente } from "../src/operations/assistente-contrato.ts";
import type { CrmVisao } from "../src/operations/types.ts";

// O Assistente de ponta a ponta (RULES 28): o Express de verdade com o router de operations e a
// guarda de mesma origem, o painel de verdade (as funções de src/casca/assistente.ts montam cada
// pedido, com o `fetch` apontado para este servidor), um Gemini dublê que lê e propõe, e o CRM de
// fixture. O que se prova: o corpo que o painel manda é o que o servidor aceita, as fontes são as
// leituras que rodaram, e o cartão de anotação, enviado como o AssistenteCartao.vue envia, passa
// pelo validarRegistro do POST /crm/registro. O n8n não é chamado: o `registrar` é dublê.

const AGORA = new Date("2026-10-17T14:00:00Z"); // sábado, 11:00 em SP
const COLUNAS = ["row_number", "place_id", "nome", "vertical", "cidade", "status", "site_url", "criado_em", "enviado_em",
  "visto_em", "respondeu_em", "followup_em", "recusado_em", "fechado_em", "acoes_link", "wa_link", "wa_me",
  "resposta_tipo", "resposta_trecho", "resposta_em", "mensagem_variante"];
const horas = (n: number) => new Date(AGORA.getTime() - n * 3600_000).toISOString();

function visaoDoCrm(): CrmVisao {
  const linha = {
    ...Object.fromEntries(COLUNAS.map((c) => [c, ""])), row_number: "3", place_id: "ChIJkulniski", nome: "Kulniski Advocacia",
    vertical: "advocacia", cidade: "Ribeirão Preto", criado_em: horas(200), status: "enviado", enviado_em: horas(30),
    respondeu_em: horas(2), resposta_tipo: "interesse", resposta_trecho: "pode sim, meu número é (16) 98100-0093", resposta_em: horas(2),
    wa_me: "https://wa.me/5516981000093", mensagem_variante: "A",
  };
  const retrato = validarRetrato({
    versao: 1,
    geradoEm: new Date(AGORA.getTime() - 60_000).toISOString(),
    links: { webhook: "https://dell.exemplo.ts.net/webhook" },
    fontes: {
      site: { planilha: "Leads", aba: "Leads", colunas: COLUNAS, linhas: [linha] },
      registros: { aba: "CRM", colunas: ["em", "produto", "id", "tipo", "texto", "data"], linhas: [] },
    },
  });
  return montarCrm(retrato, { agora: AGORA, pastas: [] }) as unknown as CrmVisao;
}

const dirs: string[] = [];
const servidores: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servidores.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const silencio = { log() {}, warn() {}, error() {} };

/** Quantas vezes cada fonte foi lida: a página de Finanças tem de deixar tudo em zero. */
function fontesContadas(visao: CrmVisao) {
  const lidas = { visao: 0, conversa: 0, agenda: 0, dell: 0 };
  const fontes: FontesDoAssistente = {
    visao: async () => { lidas.visao++; return visao; },
    conversa: async () => { lidas.conversa++; return null; },
    agenda: async () => { lidas.agenda++; return { state: "connected", events: [] }; },
    dell: async () => { lidas.dell++; return { geradoEm: new Date(AGORA.getTime() - 60_000).toISOString(), verificacoes: [] }; },
  };
  return { fontes, lidas };
}

/** A resposta de uma ferramenta na última vez do usuário (o que o servidor devolveu ao modelo). */
function respostaDaFerramenta(contents: Content[], nome: string): Record<string, any> | undefined {
  const ultima = contents[contents.length - 1];
  return ultima?.parts?.find((p) => p.functionResponse?.name === nome)?.functionResponse?.response as Record<string, any> | undefined;
}

async function montar(gerar: (p: GenerateContentParameters) => Promise<RespostaDoGemini>) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "squadone-assistente-ponta-"));
  dirs.push(dataDir);
  const visao = visaoDoCrm();
  const { fontes, lidas } = fontesContadas(visao);
  let n = 0;
  const assistente = await criarAssistente({
    dir: path.join(dataDir, "assistente"), tetoDia: 60, gerar, fontes, agora: () => AGORA, log: silencio,
    novoId: () => `id-${String(++n).padStart(3, "0")}-abcdef`,
  });
  // O CRM da rota: a mesma visão, e o registrar dublê que valida como o CrmStore valida
  // (validarRegistro é a primeira linha de CrmStore.registrar) e guarda em vez de ir ao n8n.
  const registrados: unknown[] = [];
  const crm = {
    config: {},
    visao: async () => visao,
    registrar: async (corpo: unknown) => {
      registrados.push(validarRegistro(corpo, AGORA));
      return { ok: true, em: AGORA.toISOString() };
    },
  } as unknown as CrmStore;

  const app = express();
  app.use("/api", guardaDeOrigem());
  app.use(express.json());
  app.use("/api/operations", createOperationsRouter({
    config: { displayName: "", tools: {} } as unknown as OperationsConfig,
    store: new OperationsProjectStore(dataDir),
    readings: new HermesReadingsStore(dataDir),
    readAgenda: async () => ({ state: "disconnected", events: [] }),
    dataDir,
    crm,
    assistente,
  }));
  const s = http.createServer(app);
  servidores.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

  /** O `fetch` do painel neste servidor: o caminho relativo da SPA e o Origin que o navegador põe. */
  const buscar = (url: string, init?: RequestInit) =>
    fetch(`${base}${url}`, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Origin: base } });
  return { assistente, buscar, lidas, registrados };
}

/** O acompanhamento do painel até a resposta chegar (relógio curto; aba sempre visível). */
function esperarResposta(buscar: (url: string, init?: RequestInit) => Promise<Response>, conversaId: string): Promise<ConversaDoAssistente> {
  return new Promise((resolver, rejeitar) => {
    let ultima: ConversaDoAssistente | null = null;
    acompanhar(conversaId, undefined, (c) => {
      ultima = { ...c, mensagens: [...(ultima?.mensagens ?? []).filter((m) => !c.mensagens.some((x) => x.n === m.n)), ...c.mensagens] };
    }, {
      buscar: (id, desde) => lerConversa(id, desde, buscar),
      agendar: (fn) => { const t = setTimeout(fn, 5); return () => clearTimeout(t); },
      visivel: () => true,
      ouvirVisibilidade: () => () => {},
      aoFalhar: rejeitar,
      aoTerminar: () => { if (ultima && !ultima.pendente) resolver(ultima); },
    });
  });
}

describe("o Assistente de ponta a ponta", () => {
  it("da Ficha: busca, lê e propõe; o cartão de anotação passa no registro de Vendas", async () => {
    const pedidos: GenerateContentParameters[] = [];
    const gerar = async (p: GenerateContentParameters): Promise<RespostaDoGemini> => {
      pedidos.push(p);
      const contents = p.contents as Content[];
      if (pedidos.length === 1) return { functionCalls: [{ name: "buscar_lead", args: { nome: "kulni" } }] };
      if (pedidos.length === 2) {
        // O id que o modelo usa é o que buscar_lead devolveu: nada inventado.
        const achado = respostaDaFerramenta(contents, "buscar_lead")!.leads[0] as { produto: string; id: string };
        return {
          functionCalls: [
            { name: "ler_lead", args: { produto: achado.produto, id: achado.id } },
            { name: "propor_anotacao_no_crm", args: { produto: achado.produto, id: achado.id, tipo: "proximo_passo", texto: "Mandar o link do site", data: "2026-10-20" } },
          ],
        };
      }
      return { text: "Ela disse que pode: deixei o próximo passo para você confirmar." };
    };
    const { buscar, lidas, registrados } = await montar(gerar);

    // O contexto exatamente como o painel monta do endereço da Ficha (CrmPanel escreve ?lead=<id inteiro>).
    const contexto = contextoDoEndereco("/crm", `?lead=${encodeURIComponent("site:ChIJkulniski")}`);
    assert.deepEqual(contexto, { pagina: "ficha", lead: { produto: "site", id: "site:ChIJkulniski" } });

    const recebido = await enviar({ texto: "o que faço com a Kulniski?", contexto }, buscar);
    assert.match(recebido.conversaId, /^id-/);
    const conversa = await esperarResposta(buscar, recebido.conversaId);

    // O servidor achou o lead da Ficha na visão do CRM pelo id que o painel mandou.
    assert.match(String(pedidos[0].config?.systemInstruction), /Kulniski Advocacia \(produto site, id site:ChIJkulniski\)/);
    assert.match(String(pedidos[0].config?.systemInstruction), /página ficha/);
    // ler_lead recebeu o dossiê, não o erro de lead fora do CRM.
    const dossie = respostaDaFerramenta(pedidos[2].contents as Content[], "ler_lead")!;
    assert.equal(dossie.erro, undefined);
    assert.match(JSON.stringify(dossie), /pode sim/);
    assert.equal(lidas.conversa, 1, "ler_lead pediu a conversa do lead");

    assert.deepEqual(conversa.mensagens.map((m) => m.autor), ["romulo", "assistente"]);
    const resposta = conversa.mensagens[1];
    assert.equal(resposta.id, recebido.respostaId);
    assert.equal(resposta.cerebro, "gemini");
    assert.equal(resposta.falha, undefined);
    // Fontes reais: só o retrato de Vendas rodou (sem conversa guardada não há "conversa até").
    assert.deepEqual(resposta.fontes, [{ rotulo: "Vendas às 10:59" }]);
    assert.equal(resposta.cartoes.length, 1);
    const cartao = resposta.cartoes[0] as Extract<CartaoDoAssistente, { tipo: "anotacao_no_crm" }>;
    assert.equal(cartao.tipo, "anotacao_no_crm");
    assert.equal(cartao.estado, "proposto");
    assert.deepEqual(cartao.dados, { produto: "site", id: "site:ChIJkulniski", empresa: "Kulniski Advocacia", tipo: "proximo_passo", texto: "Mandar o link do site", data: "2026-10-20" });
    assert.equal(registrados.length, 0, "propor não escreve nada");

    // O toque em "Anotar": o corpo de AssistenteCartao.vue (`anotar`), com a data do campo.
    const corpoDoCartao = (id: string) => JSON.stringify({
      produto: cartao.dados.produto,
      id,
      tipo: cartao.dados.tipo,
      texto: cartao.dados.texto,
      data: cartao.dados.tipo === "proximo_passo" ? cartao.dados.data : "",
    });
    const registro = (id: string) => buscar("/api/operations/crm/registro", { method: "POST", headers: { "Content-Type": "application/json" }, body: corpoDoCartao(id) });
    // O id inteiro o registro recusa (a chave da planilha não tem ':'): por isso o painel tira o prefixo.
    assert.equal((await registro(cartao.dados.id)).status, 400);
    const aceito = await registro(chaveParaRegistro(cartao.dados.produto, cartao.dados.id));
    assert.equal(aceito.status, 201);
    assert.deepEqual(registrados, [{ produto: "site", id: "ChIJkulniski", tipo: "proximo_passo", texto: "Mandar o link do site", data: "2026-10-20" }]);

    // Depois do toque o painel avisa o servidor, que só conta; o outro desfecho depois é 409.
    await registrarDesfecho(cartao.id, "confirmado", buscar);
    await registrarDesfecho(cartao.id, "confirmado", buscar);
    await assert.rejects(registrarDesfecho(cartao.id, "descartado", buscar), (e: unknown) => e instanceof ErroDoAssistente && e.status === 409);
  });

  it("o modelo que traz só a chave da planilha acha o lead, e o cartão sai com o id inteiro", async () => {
    let rodada = 0;
    const gerar = async (): Promise<RespostaDoGemini> => {
      rodada++;
      if (rodada === 1) return { functionCalls: [{ name: "propor_mensagem_ao_lead", args: { produto: "site", id: "ChIJkulniski", texto: "Oi, tudo bem?" } }] };
      return { text: "Deixei a mensagem para copiar." };
    };
    const { buscar } = await montar(gerar);
    const recebido = await enviar({ texto: "escreve para a Kulniski", contexto: contextoDoEndereco("/crm", "") }, buscar);
    const conversa = await esperarResposta(buscar, recebido.conversaId);
    const cartao = conversa.mensagens[1].cartoes[0];
    assert.equal(cartao.tipo, "mensagem_ao_lead");
    assert.equal(cartao.tipo === "mensagem_ao_lead" && cartao.dados.id, "site:ChIJkulniski");
  });

  it("da tela de Finanças: nada lido, nenhum modelo, nada no teto", async () => {
    let chamadas = 0;
    const { assistente, buscar, lidas } = await montar(async () => { chamadas++; return { text: "não devia" }; });
    const contexto = contextoDoEndereco("/financas", "");
    assert.deepEqual(contexto, { pagina: "financas" });
    // Uma pergunta que não tem cara de finanças: o que barra é a página.
    const recebido = await enviar({ texto: "como está o Dell?", contexto }, buscar);
    const conversa = await esperarResposta(buscar, recebido.conversaId);
    assert.equal(chamadas, 0);
    assert.deepEqual(lidas, { visao: 0, conversa: 0, agenda: 0, dell: 0 });
    assert.deepEqual(conversa.mensagens.map((m) => [m.autor, m.texto, m.cerebro ?? null, m.fontes.length]), [
      ["romulo", "[assunto de finanças]", null, 0],
      ["assistente", RESPOSTA_NA_TELA_DE_FINANCAS, "regra", 0],
    ]);
    assert.equal((await assistente.estado()).usadosHoje, 0);
  });

  it("os desvios do contrato chegam ao painel classificados: pendente, 404", async () => {
    let soltar!: () => void;
    const segura = new Promise<void>((r) => { soltar = r; });
    const { assistente, buscar } = await montar(async () => { await segura; return { text: "pronto" }; });
    const contexto = contextoDoEndereco("/", "");
    const primeiro = await enviar({ texto: "oi", contexto }, buscar);
    // Outra aba manda na mesma conversa enquanto a resposta prepara: 400 com `pendente`.
    const r = await buscar("/api/operations/assistente/mensagens", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversaId: primeiro.conversaId, texto: "e aí?", contexto }),
    });
    assert.equal(r.status, 400);
    const corpo = await r.json();
    assert.equal(corpo.pendente, true);
    assert.equal(falhaDaResposta(r.status, corpo).tipo, "pendente");
    await assert.rejects(enviar({ conversaId: primeiro.conversaId, texto: "e aí?", contexto }, buscar), (e: unknown) => e instanceof ErroDoAssistente && e.tipo === "pendente");
    soltar();
    await assistente.ocioso();
    // Conversa que o servidor não tem: 404, que o acompanhamento trata como fim.
    await assert.rejects(lerConversa("nao-existe-123", undefined, buscar), (e: unknown) => e instanceof ErroDoAssistente && e.status === 404);
    // E mandar nela abre outra conversa, com outro id (o painel zera a lista).
    const outra = await enviar({ conversaId: "nao-existe-123", texto: "oi de novo", contexto }, buscar);
    assert.notEqual(outra.conversaId, "nao-existe-123");
    await assistente.ocioso();
  });
});
