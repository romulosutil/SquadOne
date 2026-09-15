import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cortarParaTelegram, MAX_MENSAGEM_TELEGRAM, textoDaFalha, textoDoTurno } from "./telegram-resposta.ts";
import { ModeloOcupado, type TurnoResult } from "./orchestrator.ts";
import { JanelaMalConfigurada } from "./alocador.ts";
import { RosterIlegivel } from "./squad.ts";
import type { EventoCriado } from "./capabilities.ts";

const FMT = { locale: "pt-BR", timeZone: "America/Sao_Paulo" };
const vazio = (x: Partial<TurnoResult> = {}): TurnoResult => ({ eventos_criados: [], sugestoes: [], avisos: [], erros: [], ...x });
const evento = (x: Partial<EventoCriado> = {}): EventoCriado => ({
  kind: "evento", titulo: "Ligar pro banco", responsavel_id: "ana", tipo: "time_blocking", dominio: "pessoal--financas",
  inicio: "2026-09-15T14:00:00-03:00", fim: "2026-09-15T14:30:00-03:00", dia_inteiro: false, papel: "foco", eventId: "e1", ...x,
});

describe("textoDoTurno", () => {
  it("turno sem nada", () => {
    assert.equal(textoDoTurno(vazio(), FMT), "Nada foi agendado.");
  });

  it("um evento por linha com ✅", () => {
    const t = textoDoTurno(vazio({ eventos_criados: [evento(), evento({ titulo: "Academia", eventId: "e2" })] }), FMT);
    const linhas = t.split("\n");
    assert.equal(linhas.length, 2);
    assert.match(linhas[0], /^✅ Ligar pro banco: 30 min, /);
    assert.match(linhas[1], /^✅ Academia: /);
  });

  it("redirecionado vem primeiro", () => {
    const t = textoDoTurno(vazio({
      eventos_criados: [evento()],
      redirecionado: { de_id: "pessoal", de_nome: "Pessoal", para_id: "p4f", para_nome: "Pay4Fun", justificativa: "trabalho" },
    }), FMT);
    assert.match(t.split("\n")[0], /^🔀 Squad Pay4Fun \(a demanda não era de Pessoal\)\.$/);
  });

  it("precisaConectar: linha do erro + um pedido de conectar só", () => {
    const erro = { capacidade: "agendar_evento", args: { titulo: "A" }, erro: "sem credencial", motivo: "precisaConectar" as const };
    const t = textoDoTurno(vazio({ erros: [erro, { ...erro, args: { titulo: "B" } }] }), FMT);
    assert.equal(t.match(/Conectar/g)?.length, 1);
    assert.match(t, /❌ A: /);
    assert.match(t, /❌ B: /);
  });

  it("semHorarioLivre usa a mensagem do servidor; agendaIndisponivel e configuracao têm texto próprio", () => {
    const t = textoDoTurno(vazio({ erros: [
      { capacidade: "agendar_evento", args: { titulo: "A" }, erro: "Nenhum horário livre de 2h até 28/09.", motivo: "semHorarioLivre" },
      { capacidade: "agendar_evento", args: { titulo: "B" }, erro: "timeout", motivo: "agendaIndisponivel" },
      { capacidade: "agendar_evento", args: {}, erro: "JANELA_TRABALHO inválida", motivo: "configuracao" },
    ] }), FMT);
    assert.match(t, /❌ A: Nenhum horário livre de 2h até 28\/09\./);
    assert.match(t, /❌ B: não consegui ler sua agenda no Google agora/);
    assert.match(t, /❌ agendar_evento: configuração do servidor — JANELA_TRABALHO inválida/);
  });

  it("descartados somem; troca de squad vira pedido de reenviar", () => {
    const t = textoDoTurno(vazio({
      erros: [{ capacidade: "agendar_evento", args: {}, erro: "descartado: ...", descartado: true }],
      sugestoes: [{ id: "s1", kind: "troca_squad", squad_id: "pessoal", destino_id: "p4f", destino_nome: "Pay4Fun", justificativa: "é do trabalho", demanda: "x" }],
    }), FMT);
    assert.equal(t.includes("descartado"), false);
    assert.match(t, /^🔀 Parece da squad Pay4Fun: é do trabalho\. Reenvie dizendo de qual squad é\.$/);
  });

  it("ampliarAcesso: uma linha, nunca sugere Desconectar como gesto", () => {
    const aviso = { capacidade: "agendar_evento", titulo: "A", aviso: "sem escopo", motivo: "ampliarAcesso" as const };
    const t = textoDoTurno(vazio({ eventos_criados: [evento()], avisos: [aviso, { ...aviso, titulo: "B" }] }), FMT);
    assert.equal(t.match(/Autorizar Google Tasks/g)?.length, 1);
    assert.match(t, /não use Desconectar/);
  });

  it("aviso comum e propostas de contratação", () => {
    const t = textoDoTurno(vazio({
      avisos: [{ capacidade: "agendar_evento", titulo: "Relatório", aviso: "faltaram 60 min antes do prazo" }],
      sugestoes: [
        { id: "s1", kind: "dominio", squad_id: "pessoal", dominio: "Saúde", papel_po: "Coach", justificativa: "", escopo: "", slot: null },
        { id: "s2", kind: "integrante", squad_id: "pessoal", dominio_id: "d", dominio_nome: "Finanças", papel: "Contador", justificativa: "", escopo: "" },
      ],
    }), FMT);
    assert.match(t, /⚠️ Relatório: faltaram 60 min antes do prazo/);
    assert.match(t, /💡 Proposta: abrir a sala "Saúde" \(Coach\)\. Para aprovar, peça de novo pelo app\./);
    assert.match(t, /💡 Proposta: contratar Contador em Finanças\. Para aprovar, peça de novo pelo app\./);
  });
});

describe("textoDaFalha", () => {
  it("classifica", () => {
    assert.match(textoDaFalha(new ModeloOcupado("x")), /Gemini sobrecarregado/);
    assert.match(textoDaFalha(new JanelaMalConfigurada("JANELA_TRABALHO ilegível")), /^⚙️ .*JANELA_TRABALHO ilegível/);
    assert.match(textoDaFalha(new RosterIlegivel("forma desconhecida")), /^⚙️ squad\.json ilegível no servidor/);
    assert.match(textoDaFalha(new Error("boom")), /^❌ Erro ao processar a demanda: boom$/);
    assert.match(textoDaFalha("string solta"), /^❌ Erro ao processar a demanda: string solta$/);
  });
});

describe("cortarParaTelegram", () => {
  it("curto passa igual; longo corta com aviso dentro do limite", () => {
    assert.equal(cortarParaTelegram("oi"), "oi");
    const cortado = cortarParaTelegram("x".repeat(5000));
    assert.ok(cortado.length <= MAX_MENSAGEM_TELEGRAM);
    assert.ok(cortado.endsWith("…(cortado)"));
  });
});
