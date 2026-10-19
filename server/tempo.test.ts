/**
 * O relógio de São Paulo (server/tempo.ts): dia, hora e a madrugada, com a virada de dia perto da
 * meia-noite UTC, que é onde a conta de "menos 3 horas" e a de UTC divergem.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diaDeSP, ehMadrugada, horaDeSP } from "./tempo.ts";

describe("diaDeSP", () => {
  it("vira o dia às 03:00 UTC, não à meia-noite UTC", () => {
    assert.equal(diaDeSP(new Date("2026-10-19T02:59:59Z")), "2026-10-18");
    assert.equal(diaDeSP(new Date("2026-10-19T03:00:00Z")), "2026-10-19");
    assert.equal(diaDeSP(new Date("2026-10-19T23:59:59Z")), "2026-10-19");
  });

  it("aceita milissegundos e Date, com o mesmo resultado", () => {
    const t = Date.parse("2026-01-01T02:00:00Z");
    assert.equal(diaDeSP(t), "2025-12-31");
    assert.equal(diaDeSP(new Date(t)), "2025-12-31");
  });
});

describe("horaDeSP", () => {
  it("0 a 23, no fuso de São Paulo", () => {
    assert.equal(horaDeSP(new Date("2026-10-19T03:00:00Z")), 0);
    assert.equal(horaDeSP(new Date("2026-10-19T14:30:00Z")), 11);
    assert.equal(horaDeSP(new Date("2026-10-20T02:59:00Z")), 23);
  });
});

describe("ehMadrugada", () => {
  it("das 22h (inclusive) às 7h (exclusive)", () => {
    assert.equal(ehMadrugada(new Date("2026-10-19T00:59:00Z")), false, "21:59");
    assert.equal(ehMadrugada(new Date("2026-10-19T01:00:00Z")), true, "22:00");
    assert.equal(ehMadrugada(new Date("2026-10-19T09:59:00Z")), true, "06:59");
    assert.equal(ehMadrugada(new Date("2026-10-19T10:00:00Z")), false, "07:00");
  });

  it("a janela atravessa a meia-noite; os limites são parâmetros", () => {
    assert.equal(ehMadrugada(new Date("2026-10-19T01:00:00Z"), 23, 5), false, "22:00 com silêncio 23–5");
    assert.equal(ehMadrugada(new Date("2026-10-19T02:00:00Z"), 23, 5), true, "23:00 com silêncio 23–5");
    assert.equal(ehMadrugada(new Date("2026-10-19T08:00:00Z"), 23, 5), false, "05:00 com silêncio 23–5");
  });
});
