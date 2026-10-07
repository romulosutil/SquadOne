/**
 * Sinal de vida do healthchecks.io: ping a cada minuto e `/fail` com o
 * WhatsApp fora de "aberto" por mais de 15 min, pelo status.json. Dublês:
 * nada sai para a rede.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpretarStatusDoDell, type StatusDoDell } from "./dell-status.ts";
import {
  criarSinalDeVida,
  decidirSinal,
  LIMITE_WHATSAPP_FORA_MS,
  lerUrlDoSinal,
  SinalMalConfigurado,
  whatsappAberto,
} from "./sinal-de-vida.ts";

const URL_HC = "https://hc-ping.com/00000000-0000-0000-0000-000000000000";
const T0 = new Date("2026-10-07T12:00:00Z");
const MIN = 60_000;

function retrato(estado: "ok" | "falha" | null, geradoEm: Date): StatusDoDell {
  const verificacoes = estado
    ? [{ id: "whatsapp-sessao", grupo: "servicos", nome: "Sessão do WhatsApp", estado, detalhe: "x" }]
    : [];
  return interpretarStatusDoDell({ geradoEm: geradoEm.toISOString(), verificacoes }, geradoEm);
}

describe("lerUrlDoSinal", () => {
  it("vazia = desligado; https sem query passa", () => {
    assert.equal(lerUrlDoSinal({}), null);
    assert.equal(lerUrlDoSinal({ DEADMAN_URL: " " }), null);
    assert.equal(lerUrlDoSinal({ DEADMAN_URL: URL_HC + "/" }), URL_HC);
  });

  for (const v of ["hc-ping.com/x", "http://hc-ping.com/x", "https://hc-ping.com/x?a=1", "https://u:p@hc-ping.com/x"]) {
    it(`recusa ${v} sem repetir a URL`, () => {
      assert.throws(() => lerUrlDoSinal({ DEADMAN_URL: v }), (e: unknown) => e instanceof SinalMalConfigurado && !(e as Error).message.includes(v));
    });
  }
});

describe("whatsappAberto", () => {
  it("ok = aberto; falha = fechado", () => {
    assert.equal(whatsappAberto(retrato("ok", T0)), true);
    assert.equal(whatsappAberto(retrato("falha", T0)), false);
  });

  it("retrato velho, sem horário ou sem a verificação = não sei", () => {
    const velho = interpretarStatusDoDell(
      { geradoEm: new Date(T0.getTime() - 10 * MIN).toISOString(), verificacoes: [{ id: "whatsapp-sessao", grupo: "servicos", nome: "W", estado: "ok", detalhe: "x" }] },
      T0,
    );
    assert.equal(whatsappAberto(velho), null);
    assert.equal(whatsappAberto(retrato(null, T0)), null);
    assert.equal(whatsappAberto(interpretarStatusDoDell(null, T0)), null);
  });
});

describe("decidirSinal", () => {
  it("aberto zera o relógio", () => {
    assert.deepEqual(decidirSinal(true, T0.getTime() - 60 * MIN, T0.getTime()), { foraDesde: null, falha: false });
  });

  it("fora há 15 min ainda é ok; passou disso, falha", () => {
    const inicio = T0.getTime();
    assert.deepEqual(decidirSinal(false, null, inicio), { foraDesde: inicio, falha: false });
    assert.equal(decidirSinal(false, inicio, inicio + LIMITE_WHATSAPP_FORA_MS).falha, false);
    assert.equal(decidirSinal(false, inicio, inicio + LIMITE_WHATSAPP_FORA_MS + 1).falha, true);
  });

  it("'não sei' conta como fora (sem retrato a fila também não drena)", () => {
    const inicio = T0.getTime();
    assert.equal(decidirSinal(null, inicio, inicio + 16 * MIN).falha, true);
  });
});

describe("criarSinalDeVida", () => {
  it("ping normal; 16 min de WhatsApp fora vira /fail; volta vira ping normal", async () => {
    let agora = T0;
    let estado: "ok" | "falha" = "ok";
    const pings: string[] = [];
    const sinal = criarSinalDeVida({
      url: URL_HC,
      lerStatus: async (t) => retrato(estado, t),
      pingar: async (u) => { pings.push(u); },
      agora: () => agora,
      log: { log() {}, error() {} },
    });
    assert.equal(await sinal.enviar(), "ok");
    estado = "falha";
    assert.equal(await sinal.enviar(), "ok");
    agora = new Date(T0.getTime() + 16 * MIN);
    assert.equal(await sinal.enviar(), "fail");
    estado = "ok";
    agora = new Date(T0.getTime() + 17 * MIN);
    assert.equal(await sinal.enviar(), "ok");
    assert.deepEqual(pings, [URL_HC, URL_HC, `${URL_HC}/fail`, URL_HC]);
  });

  it("status.json ilegível ou healthchecks fora: não lança", async () => {
    const sinal = criarSinalDeVida({
      url: URL_HC,
      lerStatus: async () => { throw new Error("EACCES"); },
      pingar: async () => { throw new Error("rede"); },
      agora: () => T0,
      log: { log() {}, error() {} },
    });
    assert.equal(await sinal.enviar(), "ok");
  });
});
