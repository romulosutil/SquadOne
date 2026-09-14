/**
 * As chaves do vínculo com o Google Tasks começam com `squadone_`, então o
 * PATCH do Ajuste já as protege sem mudança nenhuma. Este teste é a prova:
 * se alguém estreitar o filtro de marcasPreservadas, a checklist perde o
 * vínculo em silêncio. `fetch` é dublê.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  atualizarPreservandoMarcas,
  marcasPreservadas,
  PROP_TASKS_LISTA,
  PROP_TASKS_PAI,
  type EventoLido,
} from "./calendar.ts";

const MARCAS = {
  squadone_squad: "pessoal",
  squadone_dominio: "geral",
  squadone_membro: "po",
  squadone_tipo: "time_blocking",
};
const VINCULO = { [PROP_TASKS_LISTA]: "L1", [PROP_TASKS_PAI]: "T1" };

function lido(privado: Record<string, string>): EventoLido {
  return {
    id: "ev1", etag: '"e1"', summary: "[PO] Revisar", start: { dateTime: "2026-09-15T14:00:00-03:00" },
    end: { dateTime: "2026-09-15T15:00:00-03:00" }, description: "", privado, tipo: "time_blocking",
    dominio: "geral", membro: "po", squad: "pessoal", prazoRef: "", diaInteiro: false,
  };
}

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Cada PATCH responde com o `private` da vez; guarda os corpos enviados. */
function googleResponde(...privados: Record<string, string>[]) {
  const corpos: any[] = [];
  globalThis.fetch = (async (_url: string, init: any) => {
    corpos.push(JSON.parse(init.body));
    const privado = privados[corpos.length - 1];
    return new Response(
      JSON.stringify({ id: "ev1", etag: `"e${corpos.length + 1}"`, summary: "[PO] Revisar", start: {}, end: {}, extendedProperties: { private: privado } }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return corpos;
}

describe("constantes do vínculo", () => {
  it("nomes exatos e prefixo squadone_", () => {
    assert.equal(PROP_TASKS_LISTA, "squadone_tasks_lista");
    assert.equal(PROP_TASKS_PAI, "squadone_tasks_pai");
  });
});

describe("marcasPreservadas com o vínculo", () => {
  it("resposta sem squadone_tasks_pai: não preservou", () => {
    assert.equal(marcasPreservadas({ ...MARCAS, ...VINCULO }, { ...MARCAS, [PROP_TASKS_LISTA]: "L1" }), false);
  });
  it("resposta com tudo: preservou", () => {
    assert.equal(marcasPreservadas({ ...MARCAS, ...VINCULO }, { ...MARCAS, ...VINCULO }), true);
  });
});

describe("atualizarPreservandoMarcas com o vínculo", () => {
  it("gravar o vínculo: o corpo leva as 4 marcas lidas + as 2 chaves novas", async () => {
    const corpos = googleResponde({ ...MARCAS, ...VINCULO });
    const r = await atualizarPreservandoMarcas("tk", "primary", lido(MARCAS), { extendedProperties: { private: VINCULO } });
    assert.deepEqual(corpos[0].extendedProperties.private, { ...MARCAS, ...VINCULO });
    assert.equal(r.privado[PROP_TASKS_PAI], "T1");
    assert.equal(corpos.length, 1);
  });

  it("ajuste de duração: o corpo reenvia o vínculo lido", async () => {
    const corpos = googleResponde({ ...MARCAS, ...VINCULO });
    await atualizarPreservandoMarcas("tk", "primary", lido({ ...MARCAS, ...VINCULO }), {
      end: { dateTime: "2026-09-15T15:30:00-03:00" },
    });
    assert.deepEqual(corpos[0].extendedProperties.private, { ...MARCAS, ...VINCULO });
  });

  it("Google devolve sem o vínculo: restaura uma vez com o private completo", async () => {
    const corpos = googleResponde({ ...MARCAS }, { ...MARCAS, ...VINCULO });
    const r = await atualizarPreservandoMarcas("tk", "primary", lido({ ...MARCAS, ...VINCULO }), {
      end: { dateTime: "2026-09-15T15:30:00-03:00" },
    });
    assert.equal(corpos.length, 2);
    assert.deepEqual(corpos[1], { extendedProperties: { private: { ...MARCAS, ...VINCULO } } });
    assert.equal(r.privado[PROP_TASKS_LISTA], "L1");
  });
});
