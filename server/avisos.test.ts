/**
 * Avisos: o formato da fila do dell-status, a gravação atômica, o espelho P0 no
 * Telegram (dublê), o registro de 24 h dos avisos pessoais e nenhum valor em R$.
 * Grava num diretório temporário, nunca em ~/.local/share/avisos nem em data/.
 */
import assert from "node:assert/strict";
import { ErroDeTelegram } from "./telegram.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  avisoExigeTelegram,
  avisoParaArquivo,
  AvisoInvalido,
  avisosPessoaisPeloTelegram,
  criarRegistroDeEnviados,
  enviarAvisoPessoalAosDestinos,
  gravarAvisoNaFila,
  noSilencio,
  ORIGENS_QUE_EXIGEM_TELEGRAM,
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
const registroIsolado = async () => criarRegistroDeEnviados(path.join(await fila(), "enviados.json"), { log: silencio });
const arquivosDaFila = async (dir: string) => (await fs.readdir(dir)).filter(n => /-squadone-[0-9a-f]{8}\.json$/.test(n));

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
    const r = await publicarAvisoPessoal(base, { fila: dir, telegram: telegram(enviados), enviados: await registroIsolado(), agora: as15h, log: silencio });
    assert.equal(r.canal, "telegram");
    assert.deepEqual(enviados, [{ texto: `${base.titulo}\n${base.texto}`, silencioso: false }]);
    assert.equal((await fs.readdir(dir)).length, 0);
  });

  it("das 22h às 7h chega sem som", async () => {
    const enviados: Envio[] = [];
    await publicarAvisoPessoal(base, { fila: await fila(), telegram: telegram(enviados), enviados: await registroIsolado(), agora: as23h, log: silencio });
    assert.equal(enviados[0].silencioso, true);
    assert.equal(noSilencio(new Date("2026-10-16T09:59:00Z")), true, "06:59");
    assert.equal(noSilencio(new Date("2026-10-16T10:00:00Z")), false, "07:00");
    assert.equal(noSilencio(new Date("2026-10-17T00:59:00Z")), false, "21:59");
  });

  it("Telegram desligado: publica a fila pessoal sem tentativa direta", async () => {
    const dir = await fila();
    const r = await publicarAvisoPessoal(base, { fila: dir, enviados: await registroIsolado(), agora: as15h, log: silencio });
    assert.equal(r.canal, "fila");
    assert.equal((await arquivosDaFila(dir)).length, 1);
  });

  it("P0 segue na outbox exclusiva do Telegram; R$ continua recusado antes de sair", async () => {
    const dir = await fila();
    const enviados: Envio[] = [];
    await publicarAvisoPessoal({ ...base, prioridade: 0 }, { fila: dir, telegram: telegram(enviados), enviados: await registroIsolado(), agora: as15h, log: silencio });
    assert.equal(enviados.length, 0);
    assert.equal((await fs.readdir(dir)).length, 1);
    await assert.rejects(publicarAvisoPessoal({ ...base, texto: "Pagar R$ 300" }, { fila: dir, telegram: telegram(enviados), log: silencio }), AvisoInvalido);
    assert.equal(enviados.length, 0);
  });

  it("a variável só desliga com false", () => {
    assert.equal(avisosPessoaisPeloTelegram({}), true);
    assert.equal(avisosPessoaisPeloTelegram({ SQUADONE_LEMBRETES_PELO_TELEGRAM: "FALSE" }), false);
    assert.equal(avisosPessoaisPeloTelegram({ SQUADONE_LEMBRETES_PELO_TELEGRAM: "true" }), true);
  });
});

// Fase 5.3 da auditoria de 19/10/2026: três listas de "origens que só saem pelo Telegram" divergiam (5, 2 e 2).
// TS e Python não se importam, então o teste lê o texto das constantes dos dois .py e compara com a deste módulo.
describe("origens que exigem Telegram: paridade com o Python", () => {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const lerLista = async (arquivo: string, constante: string): Promise<string[]> => {
    const texto = await fs.readFile(path.join(raiz, arquivo), "utf8");
    const m = new RegExp(String.raw`^${constante}\s*=\s*\{([^}]*)\}`, "m").exec(texto);
    assert.ok(m, `${constante} sumiu de ${arquivo}`);
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  };
  const daqui = [...ORIGENS_QUE_EXIGEM_TELEGRAM].sort();

  it("a lista do servidor é a do dell-status.py", async () => {
    assert.deepEqual(await lerLista("deploy/dell/dell-status.py", "ORIGENS_PELO_TELEGRAM"), daqui);
  });

  it("a lista do servidor é a da lib aviso.py", async () => {
    assert.deepEqual(await lerLista("deploy/dell/lib/aviso.py", "ORIGENS_TELEGRAM_EXCLUSIVO"), daqui);
  });

  it("cada origem da lista e todo P0 exigem Telegram; o prefixo n8n: e as origens comuns, não", () => {
    for (const origem of ORIGENS_QUE_EXIGEM_TELEGRAM) assert.equal(avisoExigeTelegram({ prioridade: 2, origem }), true, origem);
    assert.equal(avisoExigeTelegram({ prioridade: 0, origem: "qualquer" }), true);
    // Decisão de produto aberta: falha de fluxo do n8n prefere o Telegram no dell-status, mas não é exclusiva.
    for (const origem of ["n8n:03 · Balcão", "squadone:vigia", "teste"]) assert.equal(avisoExigeTelegram({ prioridade: 2, origem }), false, origem);
  });

  it("origem exclusiva vai sem expira_em ao arquivo, a comum mantém", () => {
    assert.equal("expira_em" in avisoParaArquivo({ ...base, origem: "backup-dell" }), false);
    assert.equal("expira_em" in avisoParaArquivo(base), true);
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

  it("P0: outbox durável, sem emissor concorrente e sem expiração", async () => {
    const dir = await fila();
    const enviados: string[] = [];
    const r = await publicarAviso({ ...base, prioridade: 0, link: "https://x.y/z" }, { fila: dir, telegram: async (t) => { enviados.push(t); }, log: silencio });
    assert.equal(r.telegram, "pendente");
    assert.deepEqual(enviados, []);
    const dados = JSON.parse(await fs.readFile(r.arquivo!, 'utf8'));
    assert.deepEqual([dados.titulo, dados.texto, dados.link], [base.titulo, base.texto, 'https://x.y/z']);
    assert.equal('expira_em' in dados, false);
    assert.equal((await fs.readdir(dir)).length, 1);
  });

  it("P0 com a outbox quebrada: falha sem confirmar nem disparar transporte alternativo", async () => {
    const enviados: string[] = [];
    await assert.rejects(
      publicarAviso({ ...base, prioridade: 0 }, { fila: path.join(os.tmpdir(), "squadone-sem-fila-xyz"), telegram: async (t) => { enviados.push(t); }, log: silencio }),
      /instale o dell-status/,
    );
    assert.equal(enviados.length, 0);
  });

  it("P0 com o Telegram fora permanece publicado para o emissor único tentar", async () => {
    const dir = await fila();
    const r = await publicarAviso({ ...base, prioridade: 0 }, { fila: dir, telegram: async () => { throw new Error("fora"); }, log: silencio });
    assert.equal(r.telegram, "pendente");
    assert.equal((await fs.readdir(dir)).length, 1);
  });

  it("P0 sem bot permanece pendente no Telegram, nunca marcado entregue", async () => {
    const dir = await fila();
    assert.equal((await publicarAviso({ ...base, prioridade: 0 }, { fila: dir })).telegram, "pendente");
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
    assert.deepEqual((await fs.readdir(path.dirname(f))).sort(), ["avisos-enviados.json", "avisos-enviados.json.tentativas.json"], "sem .tmp esquecido");
  });

  it("dedupe vale 24 h; historico numerico antigo permanece preservado", async () => {
    const f = await arquivo();
    const r = criarRegistroDeEnviados(f, { log: silencio });
    await r.marcar("velha", T0);
    assert.equal(await r.jaEnviado("velha", new Date(T0.getTime() + RETENCAO_DOS_ENVIADOS_MS - 1)), true);
    assert.equal(await r.jaEnviado("velha", new Date(T0.getTime() + RETENCAO_DOS_ENVIADOS_MS)), false);
    await r.marcar("nova", h(25));
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(f, "utf8"))), ["velha", "nova"]);
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

  it("legado ilegivel preserva evidencia e bloqueia antes de qualquer envio", async () => {
    const f = await arquivo(), original = "{isto nao e json";
    await fs.writeFile(f, original);
    const r = criarRegistroDeEnviados(f, { log: silencio });
    await assert.rejects(r.jaEnviado("a", T0), /legado ilegivel/);
    await assert.rejects(r.reservar("a", T0), /legado ilegivel/);
    assert.equal(await fs.readFile(f, "utf8"), original);
  });

  it("falha do espelho legado nao perde confirmacao ja persistida no journal", async () => {
    const f = await arquivo(), r = criarRegistroDeEnviados(f, { log: silencio });
    const reserva = await r.reservar("a", T0);
    assert.equal(reserva.estado, "reservado");
    if (reserva.estado !== "reservado") throw new Error("reserva ausente");
    await r.concluir(reserva.token, "telegram", T0);
    await fs.mkdir(f);
    await r.marcar("a", T0); // Nao lanca; journal conservado, legado torto bloqueia nova tentativa.
    const j = JSON.parse(await fs.readFile(f + ".tentativas.json", "utf8"));
    assert.equal(j.tentativas[0].estado, "telegram");
    await assert.rejects(criarRegistroDeEnviados(f).reservar("a", T0), /legado ilegivel/);
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
    assert.equal((await arquivosDaFila(dir)).length, 0, "nada na fila de reserva");

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

  it("fila ausente antes de publicar libera tentativa apos corrigir a pasta", async () => {
    const dir = path.join(await fila(), "nao-existe");
    const f = path.join(await fila(), "enviados.json");
    const r = criarRegistroDeEnviados(f, { log: silencio });
    await assert.rejects(publicarAvisoPessoal(base, { fila: dir, agora: () => T0, log: silencio, enviados: r }));
    assert.equal(await r.jaEnviado(base.chave, T0), false);
    await fs.mkdir(dir);
    assert.equal((await publicarAvisoPessoal(base, { fila: dir, agora: () => T0, log: silencio, enviados: r })).canal, "fila");
  });

  it("caiu na fila de reserva: também marca (o dell-status dedupa igual)", async () => {
    const dir = await fila();
    const r = criarRegistroDeEnviados(path.join(await fila(), "enviados.json"), { log: silencio });
    const resultado = await publicarAvisoPessoal(base, { fila: dir, agora: () => T0, log: silencio, enviados: r });
    assert.equal(resultado.canal, "fila");
    assert.equal(await r.jaEnviado(base.chave, T0), true);
  });

  it("sem registro duravel nao inicia Telegram e conserva emissor da fila", async () => {
    const enviados: string[] = [], dir = await fila();
    const deps = { fila: dir, telegram: telegram(enviados), agora: () => T0, log: silencio };
    assert.equal((await publicarAvisoPessoal(base, deps)).canal, "fila");
    assert.equal(enviados.length, 0);
    assert.equal((await arquivosDaFila(dir)).length, 1);
  });
});

describe("reserva pessoal duravel e resultados por destino", () => {
  const T0 = new Date("2026-10-25T15:00:00Z");
  const preparar = async () => {
    const dir = await fila(), f = path.join(await fila(), "enviados.json");
    const registro = () => criarRegistroDeEnviados(f, { log: silencio });
    const deps = (telegram?: Parameters<typeof publicarAvisoPessoal>[1]["telegram"]) => ({ fila: dir, telegram, enviados: registro(), agora: () => T0, log: silencio });
    const ler = async () => JSON.parse(await fs.readFile(f + ".tentativas.json", "utf8"));
    return { dir, f, registro, deps, ler };
  };

  it("reserva existe em disco antes de iniciar o transporte", async () => {
    const p = await preparar();
    assert.equal((await publicarAvisoPessoal(base, p.deps(async () => {
      const j = await p.ler();
      assert.equal(j.tentativas.length, 1);
      assert.equal(j.tentativas[0].estado, "reservado");
      assert.equal(await p.registro().jaEnviado(base.chave, T0), false);
    }))).canal, "telegram");
  });

  it("timeout depois de efeito externo fica incerto apos reinicio e 48 h, sem fallback ou marca enviado", async () => {
    const p = await preparar();
    let entregas = 0;
    const telegram = async () => { entregas++; throw new ErroDeTelegram("timeout simulado", null); };
    assert.equal((await publicarAvisoPessoal(base, p.deps(telegram))).canal, "incerto");
    assert.equal(await p.registro().jaEnviado(base.chave, T0), false);
    await p.registro().esquecer(base.chave); // Google voltou: nao libera uma entrega sem comprovacao.
    assert.equal((await publicarAvisoPessoal(base, { ...p.deps(telegram), agora: () => new Date(T0.getTime() + 48 * 3600_000) })).canal, "incerto");
    assert.equal(entregas, 1);
    assert.equal((await arquivosDaFila(p.dir)).length, 0);
    await assert.rejects(fs.access(p.f));
    assert.equal((await p.ler()).tentativas[0].estado, "incerto");
  });

  it("duas instancias concorrentes compartilham uma unica reserva", async () => {
    const p = await preparar();
    let tentativas = 0;
    const telegram = async () => { tentativas++; await new Promise(r => setTimeout(r, 25)); };
    const resultados = await Promise.all([publicarAvisoPessoal(base, p.deps(telegram)), publicarAvisoPessoal(base, p.deps(telegram))]);
    assert.equal(tentativas, 1);
    assert.equal(resultados.filter(r => r.canal === "telegram").length, 1);
    assert.ok(resultados.some(r => ["repetido", "incerto"].includes(r.canal)));
  });

  it("reserva interrompida sem resultado bloqueia reinicio sem usar TTL", async () => {
    const p = await preparar();
    await p.registro().reservar(base.chave, T0); // Simula morte antes de concluir.
    let chamadas = 0;
    assert.equal((await publicarAvisoPessoal(base, p.deps(async () => { chamadas++; }))).canal, "incerto");
    assert.equal(chamadas, 0);
    assert.equal((await arquivosDaFila(p.dir)).length, 0);
    assert.equal((await p.ler()).tentativas[0].estado, "reservado");
  });

  it("journal corrompido e preservado; nada chega a Telegram ou fila", async () => {
    const p = await preparar(), original = "{journal incompleto";
    await fs.writeFile(p.f + ".tentativas.json", original);
    let chamadas = 0;
    await assert.rejects(publicarAvisoPessoal(base, p.deps(async () => { chamadas++; })), /ileg.vel/);
    assert.equal(chamadas, 0);
    assert.equal((await arquivosDaFila(p.dir)).length, 0);
    assert.equal(await fs.readFile(p.f + ".tentativas.json", "utf8"), original);
  });

  it("falha ao reservar bloqueia antes de qualquer tentativa", async () => {
    const p = await preparar();
    await fs.mkdir(p.f + ".tentativas.json");
    let chamadas = 0;
    await assert.rejects(publicarAvisoPessoal(base, p.deps(async () => { chamadas++; })));
    assert.equal(chamadas, 0);
    assert.equal((await arquivosDaFila(p.dir)).length, 0);
  });

  it("entrega parcial persiste todos os destinos sem IDs/texto e nao repete quem recebeu apos reinicio", async () => {
    const p = await preparar(), contagens = [0, 0];
    const telegram = async (_texto: string, _opcoes: unknown, registrar?: Parameters<typeof enviarAvisoPessoalAosDestinos>[1]) =>
      enviarAvisoPessoalAosDestinos([
        { identidade: "destino-sintetico-a", enviar: async () => { contagens[0]++; } },
        { identidade: "destino-sintetico-b", enviar: async () => { contagens[1]++; throw new ErroDeTelegram("timeout", null); } },
      ], registrar);
    assert.equal((await publicarAvisoPessoal(base, p.deps(telegram))).canal, "incerto");
    assert.equal((await publicarAvisoPessoal(base, p.deps(telegram))).canal, "incerto");
    assert.deepEqual(contagens, [1, 1]);
    assert.equal((await arquivosDaFila(p.dir)).length, 0);
    const j = await p.ler();
    assert.equal(j.tentativas[0].estado, "incerto");
    assert.deepEqual(j.tentativas[0].destinos.map((d: { estado: string }) => d.estado), ["entregue", "incerto"]);
    const bytes = JSON.stringify(j);
    for (const privado of ["destino-sintetico-a", "destino-sintetico-b", base.texto, base.titulo, base.chave]) assert.equal(bytes.includes(privado), false);
    assert.equal(await p.registro().jaEnviado(base.chave, T0), false);
  });

  it("primeira recusa HTTP nao mascara incerteza em outro destino", async () => {
    const p = await preparar();
    const telegram = async (_t: string, _o: unknown, registrar?: Parameters<typeof enviarAvisoPessoalAosDestinos>[1]) =>
      enviarAvisoPessoalAosDestinos([
        { identidade: "recusado", enviar: async () => { throw new ErroDeTelegram("proibido", 403); } },
        { identidade: "incerto", enviar: async () => { throw new ErroDeTelegram("timeout", null); } },
      ], registrar);
    assert.equal((await publicarAvisoPessoal(base, p.deps(telegram))).canal, "incerto");
    assert.equal((await arquivosDaFila(p.dir)).length, 0);
    assert.deepEqual((await p.ler()).tentativas[0].destinos.map((d: { estado: string }) => d.estado), ["recusado", "incerto"]);
  });

  it("todos recusados explicitamente permitem fila pessoal, sem afirmar Telegram entregue", async () => {
    const p = await preparar();
    const telegram = async (_t: string, _o: unknown, registrar?: Parameters<typeof enviarAvisoPessoalAosDestinos>[1]) =>
      enviarAvisoPessoalAosDestinos([
        { identidade: "recusado-a", enviar: async () => { throw new ErroDeTelegram("proibido", 403); } },
        { identidade: "recusado-b", enviar: async () => { throw new ErroDeTelegram("limite", 429); } },
      ], registrar);
    assert.equal((await publicarAvisoPessoal(base, p.deps(telegram))).canal, "fila");
    assert.equal((await publicarAvisoPessoal(base, p.deps(telegram))).canal, "repetido");
    const t = (await p.ler()).tentativas[0];
    assert.equal(t.estado, "fila");
    assert.deepEqual(t.destinos.map((d: { estado: string }) => d.estado), ["recusado", "recusado"]);
    assert.equal((await arquivosDaFila(p.dir)).length, 1);
  });

  it("entrega mais recusa permanece revisavel sem duplicar no outro canal", async () => {
    const p = await preparar();
    const telegram = async (_t: string, _o: unknown, registrar?: Parameters<typeof enviarAvisoPessoalAosDestinos>[1]) =>
      enviarAvisoPessoalAosDestinos([
        { identidade: "a", enviar: async () => undefined },
        { identidade: "b", enviar: async () => { throw new ErroDeTelegram("recusado", 400); } },
      ], registrar);
    assert.equal((await publicarAvisoPessoal(base, p.deps(telegram))).canal, "incerto");
    assert.equal((await arquivosDaFila(p.dir)).length, 0);
    assert.deepEqual((await p.ler()).tentativas[0].destinos.map((d: { estado: string }) => d.estado), ["entregue", "recusado"]);
  });

  it("resultado por destino e persistido antes de tentar o proximo", async () => {
    const p = await preparar();
    const telegram = async (_t: string, _o: unknown, registrar?: Parameters<typeof enviarAvisoPessoalAosDestinos>[1]) =>
      enviarAvisoPessoalAosDestinos([
        { identidade: "a", enviar: async () => undefined },
        { identidade: "b", enviar: async () => {
          assert.deepEqual((await p.ler()).tentativas[0].destinos.map((d: { estado: string }) => d.estado), ["entregue", "tentando"]);
        } },
      ], registrar);
    assert.equal((await publicarAvisoPessoal(base, p.deps(telegram))).canal, "telegram");
  });

  it("falha ao persistir destino impede iniciar esse destino", async () => {
    let chamadas = 0;
    await assert.rejects(enviarAvisoPessoalAosDestinos([{ identidade: "a", enviar: async () => { chamadas++; } }], async destinos => {
      if (destinos[0].estado === "tentando") throw new Error("disco indisponivel");
    }));
    assert.equal(chamadas, 0);
  });

  it("HTTP 5xx e timeout HTTP nunca sao tratados como recusa comprovada", async () => {
    const r = await enviarAvisoPessoalAosDestinos([500, 408].map(status => ({ identidade: String(status), enviar: async () => { throw new ErroDeTelegram("simulado", status); } })));
    assert.deepEqual(r.destinos.map(d => d.estado), ["incerto", "incerto"]);
  });

  it("mapa legado existente e respeitado sem reescrever suas evidencias", async () => {
    const p = await preparar(), original = JSON.stringify({ [base.chave]: T0.getTime() });
    await fs.writeFile(p.f, original);
    let chamadas = 0;
    assert.equal((await publicarAvisoPessoal(base, p.deps(async () => { chamadas++; }))).canal, "repetido");
    assert.equal(chamadas, 0);
    assert.equal(await fs.readFile(p.f, "utf8"), original);
  });
});

it("resposta sem recibo do transporte nao comprova entrega pessoal", async () => {
  const r = await enviarAvisoPessoalAosDestinos([{ identidade: "sintetico", enviar: async () => null }]);
  assert.equal(r.destinos[0].estado, "incerto");
});


it("erro ambiguo apos rename da fila nao libera nova publicacao", async (t) => {
  const dir = await fila(), f = path.join(await fila(), "enviados.json");
  const rename = fs.rename;
  let simulou = false;
  fs.rename = async (antes, depois) => {
    await rename(antes, depois);
    if (String(depois).includes("-squadone-")) { simulou = true; throw Object.assign(new Error("falha apos publicar"), { code: "ENOENT" }); }
  };
  t.after(() => { fs.rename = rename; });
  const deps = () => ({ fila: dir, enviados: criarRegistroDeEnviados(f, { log: silencio }), log: silencio });
  await assert.rejects(publicarAvisoPessoal(base, deps()), /falha apos publicar/);
  assert.equal(simulou, true);
  assert.equal((await publicarAvisoPessoal(base, deps())).canal, "incerto");
  assert.equal((await arquivosDaFila(dir)).length, 1);
  assert.equal(JSON.parse(await fs.readFile(f + ".tentativas.json", "utf8")).tentativas[0].estado, "incerto");
});
