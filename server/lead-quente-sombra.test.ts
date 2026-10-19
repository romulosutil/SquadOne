import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { CrmLead } from "../src/operations/types.ts";
import type { MensagemDaConversa } from "./conversa-do-lead.ts";
import { resumoDoLeadQuente, type SugestaoParaOLeadQuente } from "./lead-quente.ts";
import {
  criarLeadQuenteSombra,
  ehMadrugada,
  lerConfigDoLeadQuente,
  lerRegistrosDoLeadQuente,
  LeadQuenteMalConfigurado,
  prepararLeadQuenteSombra,
  type DepsDoLeadQuente,
} from "./lead-quente-sombra.ts";

// A cola da sombra com TUDO dublê: o CRM, a conversa, o copiloto e o Telegram. O JSONL vai para um diretório
// temporário (nunca data/), o relógio é injetado e nada toca o Google nem o WhatsApp.

const T0 = Date.parse("2026-10-14T15:00:00Z"); // 12:00 em São Paulo: aviso com som
const min = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const SILENCIO = { log() {}, warn() {}, error() {} };
const SUGESTAO: SugestaoParaOLeadQuente = { mensagem: "Que bom que gostou! Qual parte chamou mais a sua atenção?", momento: { quem: "decisor" } };

interface Cenario {
  mensagens: Record<string, MensagemDaConversa[]>;
  sugestoes: Record<string, SugestaoParaOLeadQuente>;
  leads: CrmLead[];
  avisos: Array<{ texto: string; botoes: unknown; silencioso: boolean }>;
  agora: number;
  estado: "ok" | "sem-retrato";
  falhaOAviso: boolean;
}

/** Um lead cujo link saiu há 2 h e que escreveu `quando` minutos atrás. */
function lead(id: string, texto: string, quandoMin = -2, extra: Partial<CrmLead> = {}): { lead: CrmLead; mensagens: MensagemDaConversa[] } {
  const link = iso(T0 - 120 * min);
  const entrada = iso(T0 + quandoMin * min);
  const mensagens: MensagemDaConversa[] = [
    { em: iso(T0 - 130 * min), direcao: "entrada", texto: "Sim, quero ver" },
    { em: link, direcao: "saida", texto: "Segue https://demo-x.vercel.app/" },
    { em: entrada, direcao: "entrada", texto },
  ];
  return {
    mensagens,
    lead: {
      id, empresa: `Empresa ${id}`, produto: "site", etapa: "contato", resposta: { tipo: "interesse", trecho: "" },
      conversa: { desde: iso(T0 - 130 * min), mensagens: 3, ultima: { direcao: "entrada", em: entrada, trecho: texto }, ultimaEntrada: entrada, ultimaSaida: link, linkEm: link },
      links: { whatsapp: `https://wa.me/55279${id.replace(/\D/g, "").padStart(8, "0")}` },
      ...extra,
    } as unknown as CrmLead,
  };
}

let dir: string;
let c: Cenario;

function deps(extra: Partial<DepsDoLeadQuente> = {}): DepsDoLeadQuente {
  return {
    dir,
    tetoDia: 30,
    horasDeCalar: 6,
    agora: () => c.agora,
    log: SILENCIO,
    lerVisao: async () => ({ estado: c.estado, leads: c.leads }),
    lerConversa: async (l) => c.mensagens[l.id] ?? null,
    sugestoes: async (leads) => new Map(leads.flatMap((l) => (c.sugestoes[l.id] ? [[l.id, c.sugestoes[l.id]] as const] : []))),
    avisar: async (texto, botoes, opcoes) => {
      if (c.falhaOAviso) throw new Error("Telegram fora do ar");
      c.avisos.push({ texto, botoes, silencioso: opcoes.silencioso });
    },
    ...extra,
  };
}

function poe(id: string, texto: string, quandoMin = -2, extra: Partial<CrmLead> = {}, sugestao: SugestaoParaOLeadQuente | null = SUGESTAO): void {
  const l = lead(id, texto, quandoMin, extra);
  c.leads.push(l.lead);
  c.mensagens[id] = l.mensagens;
  if (sugestao) c.sugestoes[id] = sugestao;
}

const lerTudo = () => lerRegistrosDoLeadQuente(dir, c.agora);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "lead-quente-"));
  c = { mensagens: {}, sugestoes: {}, leads: [], avisos: [], agora: T0, estado: "ok", falhaOAviso: false };
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("lead quente (cola): a flag e o boot", () => {
  const fontes = { lerVisao: async () => ({ estado: "ok" as const, leads: [] }), lerConversa: async () => null, sugestoes: async () => new Map(), avisar: async () => {} };
  const ctx = { dataDir: "/x", operations: true, telegramLigado: true, copilotoLigado: true };
  it("desligada por padrão: nada nasce", () => {
    assert.equal(prepararLeadQuenteSombra({}, ctx, fontes, { log: SILENCIO }), null);
    assert.equal(prepararLeadQuenteSombra({ SQUADONE_LEAD_QUENTE_SOMBRA: "false" }, ctx, fontes, { log: SILENCIO }), null);
    assert.equal(prepararLeadQuenteSombra({ SQUADONE_LEAD_QUENTE_SOMBRA: "1" }, ctx, fontes, { log: SILENCIO }), null);
  });
  it("ligada só no operations, com o bot e com o copiloto", () => {
    const env = { SQUADONE_LEAD_QUENTE_SOMBRA: "true" };
    assert.ok(prepararLeadQuenteSombra(env, ctx, fontes, { log: SILENCIO }));
    assert.equal(prepararLeadQuenteSombra(env, { ...ctx, operations: false }, fontes, { log: SILENCIO }), null);
    assert.equal(prepararLeadQuenteSombra(env, { ...ctx, telegramLigado: false }, fontes, { log: SILENCIO }), null);
    assert.equal(prepararLeadQuenteSombra(env, { ...ctx, copilotoLigado: false }, fontes, { log: SILENCIO }), null);
  });
  it("teto e janela: padrão, valor próprio e ilegível", () => {
    assert.deepEqual(lerConfigDoLeadQuente({ SQUADONE_LEAD_QUENTE_SOMBRA: "true" }), { ligada: true, tetoDia: 30, horasDeCalar: 6 });
    assert.deepEqual(lerConfigDoLeadQuente({ SQUADONE_LEAD_QUENTE_SOMBRA: "true", SQUADONE_LEAD_QUENTE_TETO_DIA: "10", SQUADONE_LEAD_QUENTE_CALAR_HORAS: "2" }), { ligada: true, tetoDia: 10, horasDeCalar: 2 });
    assert.throws(() => lerConfigDoLeadQuente({ SQUADONE_LEAD_QUENTE_SOMBRA: "true", SQUADONE_LEAD_QUENTE_TETO_DIA: "muitos" }), LeadQuenteMalConfigurado);
    assert.throws(() => lerConfigDoLeadQuente({ SQUADONE_LEAD_QUENTE_SOMBRA: "true", SQUADONE_LEAD_QUENTE_TETO_DIA: "0" }), LeadQuenteMalConfigurado);
    // desligada, a env torta nem é lida
    assert.equal(lerConfigDoLeadQuente({ SQUADONE_LEAD_QUENTE_TETO_DIA: "muitos" }).ligada, false);
  });
  it("config ilegível desliga só a sombra, com log de erro", () => {
    const erros: unknown[] = [];
    const r = prepararLeadQuenteSombra({ SQUADONE_LEAD_QUENTE_SOMBRA: "true", SQUADONE_LEAD_QUENTE_TETO_DIA: "x" }, ctx, fontes, { log: { ...SILENCIO, error: (m: unknown) => erros.push(m) } });
    assert.equal(r, null);
    assert.equal(erros.length, 1);
  });
});

describe("lead quente (cola): uma volta", () => {
  it("responder: grava a decisão e avisa uma vez, com 👍/👎 e sem enviar nada ao lead", async () => {
    poe("site:A", "Gostei, ficou bom!");
    const s = criarLeadQuenteSombra(deps());
    const r = await s.volta();
    assert.deepEqual(r, { avaliados: 1, gravadas: 1, avisadas: 1, aguardando: 0 });
    assert.equal(c.avisos.length, 1);
    assert.match(c.avisos[0].texto, /eu teria respondido a Empresa site:A/);
    assert.match(c.avisos[0].texto, /Que bom que gostou!/);
    assert.equal(c.avisos[0].silencioso, false);
    const botoes = (c.avisos[0].botoes as Array<Array<{ texto: string; dados: string }>>)[0];
    assert.deepEqual(botoes.map((b) => b.texto), ["👍 Concordo", "👎 Discordo"]);
    const [d] = await lerTudo();
    assert.equal(d.tipo, "decisao");
    if (d.tipo === "decisao") {
      assert.equal(d.acao, "responder");
      assert.equal(d.avisado, true);
      assert.equal(d.chave, `site:A|responder|${iso(T0 - 2 * min)}`);
      assert.equal(d.texto, SUGESTAO.mensagem);
    }
  });

  it("o JSONL é 600 e a pasta 700, inclusive se já existem (POSIX)", { skip: process.platform === "win32" }, async () => {
    poe("site:A", "Gostei!");
    await criarLeadQuenteSombra(deps()).volta();
    const [arq] = await fs.readdir(dir);
    assert.equal((await fs.stat(path.join(dir, arq))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    // Arquivo restaurado ou pasta antiga podem ter permissões mais abertas.
    await fs.chmod(path.join(dir, arq), 0o644);
    await fs.chmod(dir, 0o755);
    poe("site:B", "Gostei também!");
    await criarLeadQuenteSombra(deps()).volta();
    assert.equal((await fs.stat(path.join(dir, arq))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    assert.equal((await lerTudo()).filter((r) => r.tipo === "decisao").length, 2);
  });

  it("a mesma mensagem não é decidida duas vezes, nem depois de reiniciar", async () => {
    poe("site:A", "Gostei!");
    await criarLeadQuenteSombra(deps()).volta();
    const r = await criarLeadQuenteSombra(deps()).volta();
    assert.equal(r.avaliados, 0);
    assert.equal(c.avisos.length, 1);
    assert.equal((await lerTudo()).length, 1);
  });

  it("mensagem nova do mesmo lead é outra decisão", async () => {
    poe("site:A", "Gostei!");
    const s = criarLeadQuenteSombra(deps());
    await s.volta();
    c.agora = T0 + 30 * min;
    const novo = lead("site:A", "Pode me mostrar mais?", 28);
    c.leads = [novo.lead];
    c.mensagens["site:A"] = novo.mensagens;
    await s.volta();
    assert.equal(c.avisos.length, 2);
  });

  it("escalar: avisa o motivo e nunca repete a mensagem do lead", async () => {
    poe("site:B", "Quanto custa?");
    await criarLeadQuenteSombra(deps()).volta();
    assert.match(c.avisos[0].texto, /eu teria escalado Empresa site:B \(pediu preço\): assuma/);
    assert.doesNotMatch(c.avisos[0].texto, /Quanto custa/);
    const [d] = await lerTudo();
    assert.equal(d.tipo === "decisao" ? d.motivo : "", "preco");
  });

  it("calar por 'Rômulo assumiu' é gravado, mas não avisa", async () => {
    poe("site:C", "Gostei!");
    c.mensagens["site:C"].splice(2, 0, { em: iso(T0 - 20 * min), direcao: "saida", texto: "Qualquer dúvida me chama" });
    await criarLeadQuenteSombra(deps()).volta();
    assert.equal(c.avisos.length, 0);
    const [d] = await lerTudo();
    assert.equal(d.tipo === "decisao" ? `${d.acao}:${d.motivo}:${d.avisado}` : "", "calar:romulo-assumiu:false");
  });

  it("antes do link, lead novo e mensagem de ontem: nada é gravado", async () => {
    poe("site:D", "Quero ver", -2, { conversa: { desde: iso(T0 - 5 * min), mensagens: 1, ultima: { direcao: "entrada", em: iso(T0 - 2 * min), trecho: "" }, ultimaEntrada: iso(T0 - 2 * min) } as any });
    c.mensagens["site:D"] = [{ em: iso(T0 - 2 * min), direcao: "entrada", texto: "Quero ver" }];
    poe("site:E", "Gostei!", -2, { etapa: "novo" });
    poe("site:F", "Gostei!", -25 * 60);
    const r = await criarLeadQuenteSombra(deps()).volta();
    assert.equal(r.gravadas, 0);
    assert.equal((await lerTudo()).length, 0);
  });

  it("sem sugestão ainda: aguarda; passados 5 min, escala 'sem-sugestao'", async () => {
    poe("site:G", "Gostei!", -2, {}, null);
    const s = criarLeadQuenteSombra(deps());
    assert.equal((await s.volta()).aguardando, 1);
    assert.equal((await lerTudo()).length, 0);
    c.agora = T0 + 4 * min;
    await s.volta();
    const [d] = await lerTudo();
    assert.equal(d.tipo === "decisao" ? d.motivo : "", "sem-sugestao");
  });

  it("teto do dia: a decisão fica gravada, mas o aviso não sai", async () => {
    poe("site:H", "Gostei!");
    poe("site:I", "Quanto custa?");
    await criarLeadQuenteSombra(deps({ tetoDia: 1 })).volta();
    assert.equal(c.avisos.length, 1);
    const ds = await lerTudo();
    assert.equal(ds.length, 2);
    assert.deepEqual(ds.map((d) => (d.tipo === "decisao" ? [d.avisado, d.semAviso ?? null] : null)), [[true, null], [false, "teto"]]);
    assert.equal(resumoDoLeadQuente(ds, c.agora).semAvisoPorTeto, 1);
  });

  it("o teto do dia sobrevive a reinício e zera no dia seguinte", async () => {
    poe("site:H", "Gostei!");
    await criarLeadQuenteSombra(deps({ tetoDia: 1 })).volta();
    poe("site:I", "Quanto custa?");
    await criarLeadQuenteSombra(deps({ tetoDia: 1 })).volta();
    assert.equal(c.avisos.length, 1);
    c.agora = T0 + 24 * 60 * min;
    c.leads = [];
    const novo = lead("site:J", "Quanto custa?", 24 * 60 - 3);
    c.leads.push(novo.lead);
    c.mensagens["site:J"] = novo.mensagens;
    await criarLeadQuenteSombra(deps({ tetoDia: 1 })).volta();
    assert.equal(c.avisos.length, 2);
  });

  it("o Telegram fora do ar não derruba a volta: grava 'falhou' e segue", async () => {
    poe("site:K", "Gostei!");
    c.falhaOAviso = true;
    await criarLeadQuenteSombra(deps()).volta();
    const [d] = await lerTudo();
    assert.equal(d.tipo === "decisao" ? `${d.avisado}:${d.semAviso}` : "", "false:falhou");
  });

  it("de madrugada o aviso chega sem som", async () => {
    c.agora = Date.parse("2026-10-15T03:30:00Z"); // 00:30 em São Paulo
    const l = lead("site:L", "Gostei!", -2);
    // reposiciona a conversa no novo "agora"
    const base = c.agora;
    const link = iso(base - 120 * min);
    const entrada = iso(base - 2 * min);
    l.lead.conversa = { ...l.lead.conversa!, ultimaEntrada: entrada, ultimaSaida: link, linkEm: link, ultima: { direcao: "entrada", em: entrada, trecho: "" } } as any;
    c.leads.push(l.lead);
    c.mensagens["site:L"] = [
      { em: iso(base - 130 * min), direcao: "entrada", texto: "Sim" },
      { em: link, direcao: "saida", texto: "https://demo-x.vercel.app/" },
      { em: entrada, direcao: "entrada", texto: "Gostei!" },
    ];
    c.sugestoes["site:L"] = SUGESTAO;
    await criarLeadQuenteSombra(deps()).volta();
    assert.equal(c.avisos[0].silencioso, true);
    assert.equal(ehMadrugada(Date.parse("2026-10-15T03:30:00Z")), true);
    assert.equal(ehMadrugada(Date.parse("2026-10-15T15:00:00Z")), false);
  });

  it("CRM sem retrato: nem lê a conversa", async () => {
    poe("site:M", "Gostei!");
    c.estado = "sem-retrato";
    let leu = 0;
    const r = await criarLeadQuenteSombra(deps({ lerConversa: async () => { leu++; return null; } })).volta();
    assert.equal(r.avaliados, 0);
    assert.equal(leu, 0);
  });

  it("a flag desligada não deixa rastro: a sombra nem nasce, então nada é lido nem gravado", async () => {
    poe("site:N", "Gostei!");
    const s = prepararLeadQuenteSombra({}, { dataDir: dir, operations: true, telegramLigado: true, copilotoLigado: true },
      { lerVisao: async () => ({ estado: "ok", leads: c.leads }), lerConversa: async () => null, sugestoes: async () => new Map(), avisar: async () => { c.avisos.push({ texto: "x", botoes: [], silencioso: false }); } },
      { log: SILENCIO });
    assert.equal(s, null);
    assert.equal(c.avisos.length, 0);
    assert.deepEqual(await fs.readdir(dir), []);
  });
});

describe("lead quente (cola): voto e resposta humana", () => {
  it("👎 num 'responder' vira falso positivo no resumo e fecha o aviso", async () => {
    poe("site:A", "Gostei!");
    const s = criarLeadQuenteSombra(deps());
    await s.volta();
    const [d] = await lerTudo();
    const token = d.tipo === "decisao" ? d.token : "";
    const r = await s.votar(token, false);
    assert.equal(r.curto, "Anotado: discordou.");
    assert.match(r.texto ?? "", /eu teria respondido a Empresa site:A/);
    assert.match(r.texto ?? "", /Você discordou/);
    const resumo = resumoDoLeadQuente(await lerTudo(), c.agora);
    assert.deepEqual(resumo.falsosPositivosDeInteresse, { votados: 1, discordam: 1, taxa: 1 });
  });

  it("token desconhecido ou de um 'calar'", async () => {
    poe("site:C", "Gostei!");
    c.mensagens["site:C"].splice(2, 0, { em: iso(T0 - 20 * min), direcao: "saida", texto: "Oi" });
    const s = criarLeadQuenteSombra(deps());
    await s.volta();
    assert.equal((await s.votar("naoexiste", true)).curto, "Este aviso não existe mais.");
    const [d] = await lerTudo();
    assert.equal((await s.votar(d.tipo === "decisao" ? d.token : "", true)).curto, "Este aviso não existe mais.");
  });

  it("a resposta humana é conferida depois e mede quanto o lead esperou", async () => {
    poe("site:A", "Gostei!");
    const s = criarLeadQuenteSombra(deps());
    await s.volta();
    // o Rômulo responde 25 min depois da mensagem dele
    c.mensagens["site:A"].push({ em: iso(T0 - 2 * min + 25 * min), direcao: "saida", texto: "Que bom! Qual parte?" });
    c.agora = T0 + 11 * min; // passou o intervalo da conferência
    await s.volta();
    const registros = await lerTudo();
    const humano = registros.find((r) => r.tipo === "humano");
    assert.ok(humano && humano.tipo === "humano");
    assert.equal(humano.esperaMs, 25 * min);
    // e não repete
    c.agora = T0 + 30 * min;
    await s.volta();
    assert.equal((await lerTudo()).filter((r) => r.tipo === "humano").length, 1);
    assert.equal(resumoDoLeadQuente(await lerTudo(), c.agora).humano.medianaMin, 25);
  });

  it("sem resposta humana ainda, nada é gravado", async () => {
    poe("site:A", "Gostei!");
    const s = criarLeadQuenteSombra(deps());
    await s.volta();
    c.agora = T0 + 11 * min;
    await s.volta();
    assert.equal((await lerTudo()).filter((r) => r.tipo === "humano").length, 0);
  });
});

describe("lead quente (cola): o que NÃO está no registro", () => {
  it("nem telefone nem a mensagem do lead vão ao JSONL", async () => {
    poe("site:A", "Meu número é 27 99999-1234, gostei!");
    c.sugestoes["site:A"] = SUGESTAO;
    await criarLeadQuenteSombra(deps()).volta();
    const [arq] = await fs.readdir(dir);
    const bruto = await fs.readFile(path.join(dir, arq), "utf8");
    assert.doesNotMatch(bruto, /99999-1234|wa\.me|\b5527\d+/);
    assert.doesNotMatch(bruto, /Meu número/);
  });
});

// MSG-6 (19/10/2026): o aviso vai ao Telegram ANTES de a decisão ser gravada. Gravação que falha não pode
// reenviar o aviso a cada minuto.
describe("lead quente (cola): a gravação falha depois do aviso", () => {
  it("não reenvia o mesmo aviso, e depois de 3 falhas seguidas o laço para com erro no log", async () => {
    // O arquivo do mês é uma pasta: abrir para anexar falha, e a leitura não acha linha nenhuma.
    await fs.mkdir(path.join(dir, "2026-10.jsonl"), { recursive: true });
    const erros: string[] = [];
    const s = criarLeadQuenteSombra(deps({ log: { ...SILENCIO, error: (m: unknown) => erros.push(String(m)) } }));
    poe("site:A", "Gostei!");
    await assert.rejects(() => s.volta());
    assert.equal(c.avisos.length, 1);
    // A mesma mensagem: já avisada, nada de segundo aviso.
    const r = await s.volta();
    assert.equal(r.avaliados, 0);
    assert.equal(c.avisos.length, 1);
    // Mais duas decisões que também não gravam: a terceira falha seguida para o laço.
    poe("site:B", "Gostei!");
    await assert.rejects(() => s.volta());
    assert.deepEqual(erros, []);
    poe("site:C", "Gostei!");
    await assert.rejects(() => s.volta());
    assert.equal(c.avisos.length, 3);
    assert.ok(erros.some((m) => /3 gravações seguidas falharam/.test(m)), erros.join("|"));
  });
});

// MSG-17: o laço de 1 min não relê o JSONL inteiro a cada volta.
describe("lead quente (cola): o registro fica em memória", () => {
  it("lê o arquivo uma vez, acrescenta o que grava e relê só quando alguém mexe por fora", async () => {
    poe("site:A", "Gostei!");
    const s = criarLeadQuenteSombra(deps());
    await s.volta();
    const arquivo = path.join(dir, (await fs.readdir(dir))[0]);
    // Alguém apaga a linha por fora (tamanho muda): a volta seguinte enxerga o arquivo de verdade, e decide de novo.
    await fs.writeFile(arquivo, "");
    c.agora = T0 + 1 * min;
    const r = await s.volta();
    assert.equal(r.avaliados, 1, "releu o arquivo esvaziado");
    // Sem mexer por fora, o que ela mesma gravou está na memória: a mesma mensagem não é decidida duas vezes.
    c.agora = T0 + 2 * min;
    assert.equal((await s.volta()).avaliados, 0);
    assert.equal((await lerTudo()).filter((x) => x.tipo === "decisao").length, 1);
  });
});
