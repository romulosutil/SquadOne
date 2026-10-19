/**
 * Avisos: o formato da fila do dell-status, a gravação atômica, o espelho P0 no
 * Telegram (dublê), o registro de 24 h dos avisos pessoais e nenhum valor em R$.
 * Grava num diretório temporário, nunca em ~/.local/share/avisos nem em data/.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  avisoParaArquivo,
  AvisoInvalido,
  avisosPessoaisPeloTelegram,
  criarRegistroDeEnviados,
  gravarAvisoNaFila,
  noSilencio,
  publicarAviso,
  publicarAvisoPessoal,
  RETENCAO_DOS_ENVIADOS_MS,
  semValores,
  validarAviso,
  type Aviso,
} from "./avisos.ts";

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

// Auditoria de 19/10/2026 (MSG-2): o lembrete e o alerta de finanças saíram da fila e perderam a chave de 24 h
// do dell-status; a memória da vigia some a cada reinício da Central. O registro devolve a regra em disco.
describe("criarRegistroDeEnviados", () => {
  const T0 = new Date("2026-10-19T12:00:00Z");
  const h = (horas: number) => new Date(T0.getTime() + horas * 3600_000);
  const arquivo = async () => path.join(await fila(), "avisos-enviados.json");

  it("marca, persiste e sobrevive a um 'reinício' (outra instância sobre o mesmo arquivo)", async () => {
    const f = await arquivo();
    const antes = criarRegistroDeEnviados(f, { log: silencio });
    assert.equal(await antes.jaEnviado("lembrete:ev1@1", T0), false);
    await antes.marcar("lembrete:ev1@1", T0);
    assert.equal(await antes.jaEnviado("lembrete:ev1@1", h(1)), true);

    const depois = criarRegistroDeEnviados(f, { log: silencio });
    assert.equal(await depois.jaEnviado("lembrete:ev1@1", h(1)), true);
    assert.equal(await depois.jaEnviado("outra", h(1)), false);
    assert.deepEqual(await fs.readdir(path.dirname(f)), ["avisos-enviados.json"], "sem .tmp esquecido");
  });

  it("vale 24 h: passou disso, o aviso pode sair de novo; a gravação seguinte poda o velho", async () => {
    const f = await arquivo();
    const r = criarRegistroDeEnviados(f, { log: silencio });
    await r.marcar("velha", T0);
    assert.equal(await r.jaEnviado("velha", new Date(T0.getTime() + RETENCAO_DOS_ENVIADOS_MS - 1)), true);
    assert.equal(await r.jaEnviado("velha", new Date(T0.getTime() + RETENCAO_DOS_ENVIADOS_MS)), false);
    await r.marcar("nova", h(25));
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(f, "utf8"))), ["nova"]);
  });

  it("esquecer tira a chave (e grava); chave que não existe não toca o disco", async () => {
    const f = await arquivo();
    const r = criarRegistroDeEnviados(f, { log: silencio });
    await r.esquecer("nada");
    await assert.rejects(fs.access(f), "nada a esquecer, nada gravado");
    await r.marcar("a", T0);
    await r.esquecer("a");
    assert.equal(await criarRegistroDeEnviados(f, { log: silencio }).jaEnviado("a", T0), false);
  });

  it("arquivo torto ou com lixo: recomeça vazio e não lança", async () => {
    const f = await arquivo();
    await fs.writeFile(f, "{isto não é json");
    const erros: string[] = [];
    const r = criarRegistroDeEnviados(f, { log: { error: (m: unknown) => erros.push(String(m)) } });
    assert.equal(await r.jaEnviado("a", T0), false);
    assert.equal(erros.length, 1);
    await r.marcar("a", T0);
    await fs.writeFile(f, JSON.stringify({ boa: T0.getTime(), ruim: "x", lista: [1] }));
    assert.equal(await criarRegistroDeEnviados(f, { log: silencio }).jaEnviado("boa", T0), true);
    assert.equal(await criarRegistroDeEnviados(f, { log: silencio }).jaEnviado("ruim", T0), false);
  });

  it("não conseguir gravar não lança (a mensagem já saiu) e a memória segue valendo", async () => {
    const dir = await fila();
    const f = path.join(dir, "avisos-enviados.json");
    await fs.mkdir(f); // o destino é uma pasta: o rename falha
    const erros: string[] = [];
    const r = criarRegistroDeEnviados(f, { log: { error: (m: unknown) => erros.push(String(m)) } });
    await r.marcar("a", T0);
    assert.equal(await r.jaEnviado("a", T0), true);
    assert.equal(erros.length >= 1, true);
    assert.deepEqual((await fs.readdir(dir)).sort(), ["avisos-enviados.json"], "o .tmp não fica");
  });
});

describe("publicarAvisoPessoal com o registro de 24 h", () => {
  const T0 = new Date("2026-10-19T18:00:00Z");
  const telegram = (enviados: string[]) => async (texto: string) => { enviados.push(texto); };

  it("a mesma chave não sai duas vezes, nem depois de reiniciar", async () => {
    const dir = await fila();
    const f = path.join(dir, "enviados.json");
    const enviados: string[] = [];
    const deps = (r = criarRegistroDeEnviados(f, { log: silencio })) => ({ fila: dir, telegram: telegram(enviados), agora: () => T0, log: silencio, enviados: r });

    assert.equal((await publicarAvisoPessoal(base, deps())).canal, "telegram");
    const reinicio = await publicarAvisoPessoal(base, deps()); // registro novo sobre o mesmo arquivo
    assert.equal(reinicio.canal, "repetido");
    assert.equal(enviados.length, 1);
    assert.equal((await fs.readdir(dir)).filter((n) => n.endsWith(".json") && n !== "enviados.json").length, 0, "nada na fila de reserva");

    const outra = await publicarAvisoPessoal({ ...base, chave: "lembrete:ev2@2" }, deps());
    assert.equal(outra.canal, "telegram");
    assert.equal(enviados.length, 2);
  });

  it("24 h depois a chave volta a valer", async () => {
    const dir = await fila();
    const enviados: string[] = [];
    let agora = T0;
    const r = criarRegistroDeEnviados(path.join(dir, "enviados.json"), { log: silencio });
    const deps = { fila: dir, telegram: telegram(enviados), agora: () => agora, log: silencio, enviados: r };
    await publicarAvisoPessoal(base, deps);
    agora = new Date(T0.getTime() + RETENCAO_DOS_ENVIADOS_MS);
    assert.equal((await publicarAvisoPessoal(base, deps)).canal, "telegram");
    assert.equal(enviados.length, 2);
  });

  it("aviso que NÃO saiu (Telegram e fila falharam) não é marcado: a próxima tentativa envia", async () => {
    const dir = path.join(await fila(), "nao-existe");
    const f = path.join(await fila(), "enviados.json");
    const r = criarRegistroDeEnviados(f, { log: silencio });
    await assert.rejects(publicarAvisoPessoal(base, { fila: dir, telegram: async () => { throw new Error("fora"); }, agora: () => T0, log: silencio, enviados: r }));
    assert.equal(await r.jaEnviado(base.chave, T0), false);
  });

  it("caiu na fila de reserva: também marca (o dell-status dedupa igual)", async () => {
    const dir = await fila();
    const r = criarRegistroDeEnviados(path.join(await fila(), "enviados.json"), { log: silencio });
    const resultado = await publicarAvisoPessoal(base, { fila: dir, agora: () => T0, log: silencio, enviados: r });
    assert.equal(resultado.canal, "fila");
    assert.equal(await r.jaEnviado(base.chave, T0), true);
  });

  it("sem registro nas dependências, nada muda (testes antigos e o modo sem disco)", async () => {
    const enviados: string[] = [];
    const deps = { fila: await fila(), telegram: telegram(enviados), agora: () => T0, log: silencio };
    await publicarAvisoPessoal(base, deps);
    await publicarAvisoPessoal(base, deps);
    assert.equal(enviados.length, 2);
  });
});
