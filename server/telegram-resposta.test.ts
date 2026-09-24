import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cortarParaTelegram,
  MAX_MENSAGEM_TELEGRAM,
  propostasDeContratacao,
  textoDaContratacao,
  textoDaFalha,
  textoDaFalhaDeTranscricao,
  textoDaProposta,
  textoDoTurno,
} from "./telegram-resposta.ts";
import { AudioSemFala, MAX_TRANSCRICAO, textoTranscrito } from "./transcricao.ts";
import { ModeloOcupado, type TurnoResult } from "./orchestrator.ts";
import { JanelaMalConfigurada } from "./alocador.ts";
import { RosterIlegivel } from "./squad.ts";
import type { EventoCriado } from "./capabilities.ts";

const FMT = { locale: "pt-BR", timeZone: "America/Sao_Paulo" };
const vazio = (x: Partial<TurnoResult> = {}): TurnoResult => ({ eventos_criados: [], tarefas_criadas: [], sugestoes: [], avisos: [], erros: [], ...x });
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

  it("tarefa avulsa: uma linha 📋 com o dia (sem trocar de dia pelo fuso) e os passos", () => {
    const tarefa = { kind: "tarefa" as const, titulo: "Pagar boleto", responsavel_id: "ana", dominio: "d", tarefaId: "t1", listaId: "l1", avisos: [] };
    const t = textoDoTurno(vazio({
      tarefas_criadas: [{ ...tarefa, data: "2026-09-30", passos: 2 }, { ...tarefa, titulo: "Comprar leite" }],
    }), FMT);
    assert.equal(t, "📋 Pagar boleto: tarefa no Google Tasks, para qua., 30/09 · 2 passo(s)\n📋 Comprar leite: tarefa no Google Tasks");
  });

  it("tarefa sem escopo (erro ampliarAcesso) soma no mesmo gesto dos passos", () => {
    const aviso = { capacidade: "agendar_evento", titulo: "A", aviso: "sem escopo", motivo: "ampliarAcesso" as const };
    const erro = { capacidade: "criar_tarefa", args: { titulo: "Comprar leite" }, erro: "Tarefa não criada: falta autorizar o Google Tasks.", motivo: "ampliarAcesso" as const };
    const t = textoDoTurno(vazio({ avisos: [aviso], erros: [erro] }), FMT);
    assert.equal(t.match(/Autorizar Google Tasks/g)?.length, 1);
    assert.match(t, /❌ Comprar leite: Tarefa não criada/);
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
    // As propostas vão em mensagens próprias, com botões: o resumo só conta.
    assert.match(t, /💡 2 proposta\(s\) de contratação abaixo\./);
    assert.doesNotMatch(t, /Saúde|Contador/);
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

describe("propostas de contratação no chat", () => {
  const dominio = { id: "s1", kind: "dominio" as const, squad_id: "pessoal", dominio: "Saúde", papel_po: "Coach", justificativa: "Ninguém cuida de saúde.", escopo: "", slot: null };
  const integrante = { id: "s2", kind: "integrante" as const, squad_id: "pessoal", dominio_id: "d", dominio_nome: "Finanças", papel: "Contador", justificativa: " ", escopo: "" };

  it("propostasDeContratacao ignora a troca de squad", () => {
    const troca = { id: "s3", kind: "troca_squad" as const, squad_id: "pessoal", destino_id: "p4f", destino_nome: "Pay4Fun", justificativa: "", demanda: "" };
    assert.deepEqual(propostasDeContratacao(vazio({ sugestoes: [dominio, troca, integrante] })).map((s) => s.id), ["s1", "s2"]);
  });

  it("textoDaProposta: cabeça + justificativa (quando há)", () => {
    assert.equal(textoDaProposta(dominio), '💡 Abrir a sala "Saúde", com um Coach como PO.\nNinguém cuida de saúde.');
    assert.equal(textoDaProposta(integrante), "💡 Contratar Contador em Finanças.");
  });

  it("textoDaContratacao", () => {
    assert.equal(textoDaContratacao({ kind: "dominio", dominio: { nome: "Saúde" }, pessoa: { nome: "Bia", papel: "Coach" } }), '✅ Sala "Saúde" aberta: Bia (Coach) é o PO.');
    assert.equal(textoDaContratacao({ kind: "integrante", dominio: { nome: "Finanças" }, pessoa: { nome: "Caio", papel: "Contador" } }), "✅ Caio (Contador) contratado em Finanças.");
  });

  it("textoDaFalhaDeTranscricao", () => {
    assert.match(textoDaFalhaDeTranscricao(new AudioSemFala()), /Não entendi o áudio/);
    assert.match(textoDaFalhaDeTranscricao(new ModeloOcupado("x")), /Gemini sobrecarregado/);
    assert.match(textoDaFalhaDeTranscricao(new Error("rede")), /Não consegui ouvir o áudio: rede/);
  });

  it("textoTranscrito: espaços colapsados; vazio ou SEM_FALA = AudioSemFala; teto", () => {
    assert.equal(textoTranscrito("  reunião   amanhã\n às 15h "), "reunião amanhã às 15h");
    assert.throws(() => textoTranscrito(""), AudioSemFala);
    assert.throws(() => textoTranscrito(" SEM_FALA "), AudioSemFala);
    assert.throws(() => textoTranscrito(undefined), AudioSemFala);
    assert.equal(textoTranscrito("x".repeat(MAX_TRANSCRICAO + 5)).length, MAX_TRANSCRICAO);
  });
});
