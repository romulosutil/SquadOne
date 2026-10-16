/**
 * Avisos: o formato da fila do dell-status, a gravação atômica, o espelho P0 no
 * Telegram (dublê), os cartões só com o link da tailnet e nenhum valor em R$.
 * Grava num diretório temporário, nunca em ~/.local/share/avisos.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  avisoDeCartao,
  avisoParaArquivo,
  AvisoInvalido,
  avisosPessoaisPeloTelegram,
  gravarAvisoNaFila,
  noSilencio,
  publicarAviso,
  publicarAvisoPessoal,
  semValores,
  validarAviso,
  type Aviso,
} from "./avisos.ts";

const TAILNET = "https://mel.tail0000.ts.net:8443";
const base: Aviso = {
  titulo: "⏳ Em 10 min: Revisar contrato",
  texto: "12:10–13:10 · Geral",
  origem: "squadone:vigia",
  chave: "lembrete:ev1@1",
  prioridade: 2,
  expiraEm: "2026-10-07T15:10:00.000Z",
};
const fila = () => fs.mkdtemp(path.join(os.tmpdir(), "squadone-fila-"));
const silencio = { error() {} };

describe("validarAviso (o schema da fase 1)", () => {
  it("o aviso padrão passa e vira o JSON da fila, com expira_em", () => {
    validarAviso(base);
    assert.deepEqual(Object.keys(avisoParaArquivo({ ...base, link: "https://x.y/z" })).sort(), [
      "chave", "expira_em", "link", "origem", "prioridade", "texto", "titulo",
    ]);
    assert.equal("link" in avisoParaArquivo(base), false);
  });

  const invalidos: [string, Partial<Aviso>][] = [
    ["título vazio", { titulo: " " }],
    ["título com quebra de linha", { titulo: "a\nb" }],
    ["título acima de 120", { titulo: "x".repeat(121) }],
    ["texto acima de 4000", { texto: "x".repeat(4001) }],
    ["origem vazia", { origem: "" }],
    ["origem acima de 80", { origem: "x".repeat(81) }],
    ["chave vazia", { chave: "" }],
    ["chave acima de 200", { chave: "x".repeat(201) }],
    ["prioridade 4", { prioridade: 4 as any }],
    ["prioridade fracionária", { prioridade: 1.5 as any }],
    ["expiraEm ilegível", { expiraEm: "amanhã" }],
    ["link sem http", { link: "javascript:alert(1)" }],
    ["link com espaço", { link: "https://x.y/a b" }],
  ];
  for (const [nome, x] of invalidos) {
    it(`recusa: ${nome}`, () => assert.throws(() => validarAviso({ ...base, ...x }), AvisoInvalido));
  }
});

describe("nenhum valor em R$ (regra 24)", () => {
  for (const [campo, valor] of [
    ["titulo", "Fatura R$ 1.234,56"],
    ["titulo", "Fatura R$30"],
    ["texto", "Gastou r$ 12 no mercado"],
    ["texto", "Limite em R $ 500"],
    ["link", "https://x.y/?v=R$10"],
  ] as const) {
    it(`recusa ${campo}: "${valor}"`, () => {
      assert.throws(() => validarAviso({ ...base, [campo]: valor }), (e: unknown) => e instanceof AvisoInvalido && /R\$/.test((e as Error).message));
    });
  }

  it("semValores troca o valor por [valor] e o aviso passa", () => {
    assert.equal(semValores("Pagar boleto R$ 1.234,56 da escola"), "Pagar boleto [valor] da escola");
    assert.equal(semValores("R$30"), "[valor]");
    validarAviso({ ...base, titulo: semValores("Pagar R$ 300 hoje") });
  });

  it("nada com R$ chega ao disco nem ao Telegram", async () => {
    const dir = await fila();
    const enviados: string[] = [];
    await assert.rejects(
      publicarAviso({ ...base, prioridade: 0, texto: "Saldo R$ 10" }, { fila: dir, telegram: async (t) => { enviados.push(t); }, log: silencio }),
      AvisoInvalido,
    );
    assert.deepEqual(await fs.readdir(dir), []);
    assert.deepEqual(enviados, []);
  });
});

describe("gravarAvisoNaFila", () => {
  it("grava um *.json legível, sem sobrar .tmp, com o formato da fila", async () => {
    const dir = await fila();
    const arquivo = await gravarAvisoNaFila(dir, { ...base, link: "https://calendar.google.com/x" }, new Date("2026-10-07T12:00:00Z"));
    const nomes = await fs.readdir(dir);
    assert.deepEqual(nomes, [path.basename(arquivo)]);
    assert.match(nomes[0], /^20261007T120000000Z-squadone-[0-9a-f]{8}\.json$/);
    const lido = JSON.parse(await fs.readFile(arquivo, "utf8"));
    assert.deepEqual(lido, { ...avisoParaArquivo(base), link: "https://calendar.google.com/x" });
    assert.ok(Buffer.byteLength(JSON.stringify(lido)) <= 16 * 1024);
  });

  it("pasta ausente: erro que diz o que fazer, e não cria a pasta (a permissão é do instalador)", async () => {
    const dir = path.join(await fila(), "nao-existe");
    await assert.rejects(gravarAvisoNaFila(dir, base), /instale o dell-status/);
    await assert.rejects(fs.access(dir));
  });

  it("dois avisos no mesmo milissegundo não se sobrescrevem", async () => {
    const dir = await fila();
    const agora = new Date("2026-10-07T12:00:00Z");
    await Promise.all([gravarAvisoNaFila(dir, base, agora), gravarAvisoNaFila(dir, base, agora)]);
    assert.equal((await fs.readdir(dir)).length, 2);
  });
});

// OT-14 (16/10/2026): lembrete e alerta de finanças pelo Telegram, fora do número de vendas.
describe("publicarAvisoPessoal", () => {
  type Envio = { texto: string; silencioso?: boolean };
  const telegram = (enviados: Envio[]) => async (texto: string, o?: { silencioso?: boolean }) => { enviados.push({ texto, silencioso: o?.silencioso }); };
  const as15h = () => new Date("2026-10-16T18:00:00Z");
  const as23h = () => new Date("2026-10-17T02:00:00Z");

  it("vai pelo Telegram e não grava na fila do WhatsApp", async () => {
    const dir = await fila();
    const enviados: Envio[] = [];
    const r = await publicarAvisoPessoal(base, { fila: dir, telegram: telegram(enviados), agora: as15h, log: silencio });
    assert.equal(r.canal, "telegram");
    assert.deepEqual(enviados, [{ texto: `${base.titulo}\n${base.texto}`, silencioso: false }]);
    assert.equal((await fs.readdir(dir)).length, 0);
  });

  it("das 22h às 7h chega sem som", async () => {
    const enviados: Envio[] = [];
    await publicarAvisoPessoal(base, { fila: await fila(), telegram: telegram(enviados), agora: as23h, log: silencio });
    assert.equal(enviados[0].silencioso, true);
    assert.equal(noSilencio(new Date("2026-10-16T09:59:00Z")), true, "06:59");
    assert.equal(noSilencio(new Date("2026-10-16T10:00:00Z")), false, "07:00");
    assert.equal(noSilencio(new Date("2026-10-17T00:59:00Z")), false, "21:59");
  });

  it("Telegram falhou ou desligado: o lembrete não se perde, vai pela fila", async () => {
    const dir = await fila();
    const r = await publicarAvisoPessoal(base, { fila: dir, telegram: async () => { throw new Error("fora"); }, agora: as15h, log: silencio });
    assert.equal(r.canal, "fila");
    assert.equal((await fs.readdir(dir)).length, 1);
    const semBot = await publicarAvisoPessoal(base, { fila: dir, agora: as15h, log: silencio });
    assert.equal(semBot.canal, "fila");
  });

  it("P0 segue nos dois canais; R$ continua recusado antes de sair", async () => {
    const dir = await fila();
    const enviados: Envio[] = [];
    await publicarAvisoPessoal({ ...base, prioridade: 0 }, { fila: dir, telegram: telegram(enviados), agora: as15h, log: silencio });
    assert.equal(enviados.length, 1);
    assert.equal((await fs.readdir(dir)).length, 1);
    await assert.rejects(publicarAvisoPessoal({ ...base, texto: "Pagar R$ 300" }, { fila: dir, telegram: telegram(enviados), log: silencio }), AvisoInvalido);
    assert.equal(enviados.length, 1);
  });

  it("a variável só desliga com false", () => {
    assert.equal(avisosPessoaisPeloTelegram({}), true);
    assert.equal(avisosPessoaisPeloTelegram({ SQUADONE_LEMBRETES_PELO_TELEGRAM: "FALSE" }), false);
    assert.equal(avisosPessoaisPeloTelegram({ SQUADONE_LEMBRETES_PELO_TELEGRAM: "true" }), true);
  });
});

describe("publicarAviso", () => {
  it("P2: só a fila, Telegram não é chamado", async () => {
    const dir = await fila();
    const enviados: string[] = [];
    const r = await publicarAviso(base, { fila: dir, telegram: async (t) => { enviados.push(t); }, log: silencio });
    assert.equal(r.telegram, "naoSeAplica");
    assert.equal(enviados.length, 0);
    assert.equal((await fs.readdir(dir)).length, 1);
  });

  it("P0: fila E Telegram, com título, texto e link", async () => {
    const dir = await fila();
    const enviados: string[] = [];
    const r = await publicarAviso({ ...base, prioridade: 0, link: "https://x.y/z" }, { fila: dir, telegram: async (t) => { enviados.push(t); }, log: silencio });
    assert.equal(r.telegram, "enviado");
    assert.deepEqual(enviados, [`${base.titulo}\n${base.texto}\nhttps://x.y/z`]);
    assert.equal((await fs.readdir(dir)).length, 1);
  });

  it("P0 com a fila quebrada: o Telegram ainda sai, e a falha da fila sobe depois", async () => {
    const enviados: string[] = [];
    await assert.rejects(
      publicarAviso({ ...base, prioridade: 0 }, { fila: path.join(os.tmpdir(), "squadone-sem-fila-xyz"), telegram: async (t) => { enviados.push(t); }, log: silencio }),
      /instale o dell-status/,
    );
    assert.equal(enviados.length, 1);
  });

  it("P0 com o Telegram fora: o aviso está na fila e nada lança", async () => {
    const dir = await fila();
    const r = await publicarAviso({ ...base, prioridade: 0 }, { fila: dir, telegram: async () => { throw new Error("fora"); }, log: silencio });
    assert.equal(r.telegram, "falhou");
    assert.equal((await fs.readdir(dir)).length, 1);
  });

  it("P0 sem bot: só a fila", async () => {
    const dir = await fila();
    assert.equal((await publicarAviso({ ...base, prioridade: 0 }, { fila: dir })).telegram, "naoSeAplica");
  });
});

describe("avisoDeCartao: só o link da tailnet, e abrir não confirma", () => {
  const pedido = { titulo: "Proposta de contratação", texto: "Um QA para Pessoal.", origem: "squadone:cartoes", chave: "cartao:c1", expiraEm: base.expiraEm, caminho: "/cartoes/c1" };

  it("o link é a origem da tailnet + o caminho da tela", () => {
    const a = avisoDeCartao(pedido, TAILNET);
    assert.equal(a.link, `${TAILNET}/cartoes/c1`);
    assert.equal(a.prioridade, 2);
  });

  for (const caminho of ["/cartoes/c1?confirmar=1", "/cartoes/c1#aprovar", "cartoes/c1", "//outro.host/x"]) {
    it(`recusa o caminho ${caminho}`, () => assert.throws(() => avisoDeCartao({ ...pedido, caminho }, TAILNET), AvisoInvalido));
  }

  for (const origem of ["http://mel.tail0000.ts.net:8443", "https://aladdin-squadone-app.jicnzg.easypanel.host", "https://mel.tail0000.ts.net:8443/sub", "https://exemplo.com"]) {
    it(`recusa a origem ${origem}`, () => assert.throws(() => avisoDeCartao(pedido, origem), AvisoInvalido));
  }

  it("recusa URL no texto: o único lugar clicável é o link", () => {
    assert.throws(() => avisoDeCartao({ ...pedido, texto: "Veja https://outro.site" }, TAILNET), AvisoInvalido);
  });
});
