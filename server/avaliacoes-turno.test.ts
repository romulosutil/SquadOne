import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  AvaliacaoInvalida,
  AvaliacoesIlegiveis,
  AvaliacoesDeTurnoStore,
  CacheDeTurnosParaAvaliacao,
  TurnoJaAvaliado,
  avaliacoesHabilitadas,
  interpretarPedidoDeAvaliacao,
  resumirResultadoDoTurno,
} from "./avaliacoes-turno.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("pedido de avaliação de turno", () => {
  it("normaliza comentário e aceita nota alta sem motivo", () => {
    assert.deepEqual(
      interpretarPedidoDeAvaliacao({
        nota: 5,
        motivos: [],
        comentario: "  Resposta clara\r\ne utilizável.  ",
      }),
      {
        nota: 5,
        motivos: [],
        comentario: "Resposta clara\ne utilizável.",
      },
    );
  });

  it("exige motivo conhecido quando a nota é baixa", () => {
    assert.throws(
      () => interpretarPedidoDeAvaliacao({ nota: 2, motivos: [] }),
      AvaliacaoInvalida,
    );
    assert.deepEqual(
      interpretarPedidoDeAvaliacao({ nota: 2, motivos: ["papel"] }),
      { nota: 2, motivos: ["papel"] },
    );
  });

  it("recusa dados ambíguos que não servem para melhoria", () => {
    for (const body of [
      { nota: 3, motivos: ["papel", "papel"] },
      { nota: 4, motivos: ["modelo_inventado"] },
      { nota: 1, motivos: ["papel"], comentario: "x".repeat(1001) },
      { nota: 4, motivos: [], inesperado: true },
    ]) {
      assert.throws(() => interpretarPedidoDeAvaliacao(body), AvaliacaoInvalida);
    }
  });
});

describe("cache de turnos para avaliação", () => {
  it("emite identificador opaco e expira evidência sem guardar demanda", () => {
    let agora = 1_000;
    const cache = new CacheDeTurnosParaAvaliacao({
      agora: () => agora,
      gerarId: () => "turno-opaco",
      ttlMs: 100,
      limite: 2,
    });
    const turnoId = cache.registrar({
      origem: "app",
      concluidoEm: "2026-09-16T20:00:00.000Z",
      modo: "auto",
      resultado: { eventos: 1, sugestoes: 0, avisos: 0, erros: 0, redirecionado: false },
    });

    assert.equal(turnoId, "turno-opaco");
    assert.deepEqual(cache.obter(turnoId), {
      origem: "app",
      concluidoEm: "2026-09-16T20:00:00.000Z",
      modo: "auto",
      resultado: { eventos: 1, sugestoes: 0, avisos: 0, erros: 0, redirecionado: false },
    });

    agora += 101;
    assert.equal(cache.obter(turnoId), undefined);
  });
});

describe("armazenamento de avaliações", () => {
  it("recusa arquivo com registros internos ilegíveis", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-avaliacoes-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(path.join(directory, "avaliacoes-turno.json"), '{"version":1,"avaliacoes":[null]}\n', "utf8");
    const store = new AvaliacoesDeTurnoStore(directory);
    const evidencia = {
      origem: "app" as const,
      concluidoEm: "2026-09-16T19:59:00.000Z",
      modo: "auto" as const,
      resultado: { eventos: 0, sugestoes: 0, avisos: 0, erros: 0, redirecionado: false },
    };

    await assert.rejects(
      () => store.registrar({ turnoId: "turno-opaco", avaliacao: { nota: 5, motivos: [] }, evidencia }),
      AvaliacoesIlegiveis,
    );
  });

  it("persiste uma avaliação local e bloqueia segunda avaliação do mesmo turno", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-avaliacoes-"));
    temporaryDirectories.push(directory);
    const store = new AvaliacoesDeTurnoStore(directory, {
      agora: () => new Date("2026-09-16T20:00:00.000Z"),
      gerarId: () => "avaliacao-opaca",
    });
    const evidencia = {
      origem: "app" as const,
      concluidoEm: "2026-09-16T19:59:00.000Z",
      modo: "foco" as const,
      resultado: { eventos: 2, sugestoes: 1, avisos: 0, erros: 0, redirecionado: false },
    };

    const registro = await store.registrar({
      turnoId: "turno-opaco",
      avaliacao: { nota: 4, motivos: ["prompt"], comentario: "Faltou detalhar o próximo passo." },
      evidencia,
    });

    assert.equal(registro.id, "avaliacao-opaca");
    assert.equal(registro.turnoId, "turno-opaco");
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(directory, "avaliacoes-turno.json"), "utf8")),
      { version: 1, avaliacoes: [registro] },
    );
    await assert.rejects(
      () => store.registrar({ turnoId: "turno-opaco", avaliacao: { nota: 5, motivos: [] }, evidencia }),
      TurnoJaAvaliado,
    );
  });
});

describe("evidência do resultado", () => {
  it("só habilita avaliação com flag explícita e reduz resultado a contagens", () => {
    assert.equal(avaliacoesHabilitadas({}), false);
    assert.equal(avaliacoesHabilitadas({ SQUADONE_AVALIACOES: "false" }), false);
    assert.equal(avaliacoesHabilitadas({ SQUADONE_AVALIACOES: "true" }), true);
    assert.deepEqual(
      resumirResultadoDoTurno("baixa_prioridade", {
        eventos_criados: [{ titulo: "Privado" }, { titulo: "Também privado" }],
        sugestoes: [{}],
        avisos: [{ aviso: "Privado" }],
        erros: [{ erro: "Privado" }],
        redirecionado: { de_id: "origem", para_id: "destino" },
      }, "2026-09-16T20:00:00.000Z"),
      {
        origem: "app",
        concluidoEm: "2026-09-16T20:00:00.000Z",
        modo: "baixa_prioridade",
        resultado: { eventos: 2, sugestoes: 1, avisos: 1, erros: 1, redirecionado: true },
      },
    );
  });
});
