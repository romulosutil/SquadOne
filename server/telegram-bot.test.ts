import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarBotDoTelegram, TEXTO_PROPOSTA_EXPIRADA, VALIDADE_PROPOSTA_MS, type DepsDoBot } from "./telegram-bot.ts";
import { ModeloOcupado, type TurnoResult } from "./orchestrator.ts";
import { AudioSemFala } from "./transcricao.ts";

const SEGREDO = "s".repeat(40);
const FMT = { locale: "pt-BR", timeZone: "America/Sao_Paulo" };
const TURNO_VAZIO: TurnoResult = { eventos_criados: [], tarefas_criadas: [], sugestoes: [], avisos: [], erros: [] };

function res() {
  const r: any = { statusCode: 0, finalizado: false };
  r.status = (n: number) => { r.statusCode = n; return r; };
  r.end = () => { r.finalizado = true; return r; };
  r.sendStatus = (n: number) => { r.statusCode = n; r.finalizado = true; return r; };
  return r;
}
const req = (corpo: unknown, segredo: string | null = SEGREDO): any => ({
  body: corpo,
  get: (h: string) => (h.toLowerCase() === "x-telegram-bot-api-secret-token" ? (segredo ?? undefined) : undefined),
});
const AGORA = new Date("2026-09-15T12:00:00Z");
/** `date` em segundos, como o Telegram manda; padrão = mensagem recém-enviada. */
const update = (id: number, text: string, chat = 111, idadeS = 5) => ({
  update_id: id,
  message: { message_id: id * 10, chat: { id: chat, type: "private" }, text, date: AGORA.getTime() / 1000 - idadeS },
});

function montar(x: Partial<DepsDoBot> = {}) {
  const enviadas: { chatId: number; texto: string; responderA?: number; botoes?: { texto: string; dados: string }[] }[] = [];
  const rodadas: { demanda: string; modo: string; squadId?: string }[] = [];
  const contratadas: string[] = [];
  const respostasDeBotao: string[] = [];
  const edicoes: { mensagemId: number; texto: string }[] = [];
  const deps: DepsDoBot = {
    segredo: SEGREDO,
    chatsPermitidos: new Set([111]),
    rodar: async (demanda, modo, squadId) => { rodadas.push({ demanda, modo, ...(squadId ? { squadId } : {}) }); return TURNO_VAZIO; },
    enviar: async (chatId, texto, responderA, botoes) => { enviadas.push({ chatId, texto, responderA, ...(botoes ? { botoes } : {}) }); },
    digitando: async () => {},
    transcrever: async () => "reunião amanhã",
    contratar: async (p) => { contratadas.push(p.id); return "✅ contratado"; },
    responderBotao: async (_id, texto) => { respostasDeBotao.push(texto); },
    editar: async (_chat, mensagemId, texto) => { edicoes.push({ mensagemId, texto }); },
    fmt: FMT,
    agora: () => AGORA,
    ...x,
  };
  return { bot: criarBotDoTelegram(deps), enviadas, rodadas, contratadas, respostasDeBotao, edicoes };
}

const voz = (id: number, fileId = "F1") => ({
  update_id: id,
  message: { message_id: id * 10, chat: { id: 111, type: "private" }, voice: { file_id: fileId, duration: 8, mime_type: "audio/ogg" }, date: AGORA.getTime() / 1000 - 5 },
});
const toque = (id: number, dados: string, chat = 111) => ({
  update_id: id,
  callback_query: { id: `cb${id}`, from: { id: chat }, data: dados, message: { message_id: 500, chat: { id: chat, type: "private" } } },
});

describe("portao", () => {
  it("segredo errado ou ausente = 401, next não roda", () => {
    const { bot } = montar();
    for (const s of ["errado", null]) {
      const r = res();
      let seguiu = false;
      bot.portao(req({}, s), r, () => { seguiu = true; });
      assert.equal(r.statusCode, 401);
      assert.equal(seguiu, false);
    }
  });

  it("segredo certo chama next", () => {
    const { bot } = montar();
    let seguiu = false;
    bot.portao(req({}), res(), () => { seguiu = true; });
    assert.equal(seguiu, true);
  });
});

describe("processar", () => {
  it("responde 200 ANTES do turno terminar e depois manda o texto em resposta à mensagem", async () => {
    let liberar!: () => void;
    const { bot, enviadas } = montar({ rodar: () => new Promise((ok) => { liberar = () => ok(TURNO_VAZIO); }) });
    const r = res();
    bot.processar(req(update(1, "reunião amanhã")), r, () => {});
    assert.equal(r.statusCode, 200);
    assert.equal(enviadas.length, 0);
    await new Promise((ok) => setImmediate(ok));
    liberar();
    await bot.ocioso();
    assert.deepEqual(enviadas, [{ chatId: 111, texto: "Nada foi agendado.", responderA: 10 }]);
  });

  it("chat não autorizado: 200, sem turno e sem resposta", async () => {
    const { bot, enviadas, rodadas } = montar();
    const r = res();
    bot.processar(req(update(1, "/start", 999)), r, () => {});
    await bot.ocioso();
    assert.equal(r.statusCode, 200);
    assert.equal(rodadas.length + enviadas.length, 0);
  });

  it("update_id repetido roda uma vez só", async () => {
    const { bot, rodadas } = montar();
    bot.processar(req(update(7, "x")), res(), () => {});
    bot.processar(req(update(7, "x")), res(), () => {});
    await bot.ocioso();
    assert.equal(rodadas.length, 1);
  });

  it("/foco passa o modo; /start responde ajuda sem turno", async () => {
    const { bot, rodadas, enviadas } = montar();
    bot.processar(req(update(1, "/foco revisar contrato")), res(), () => {});
    bot.processar(req(update(2, "/start")), res(), () => {});
    await bot.ocioso();
    assert.deepEqual(rodadas, [{ demanda: "revisar contrato", modo: "foco" }]);
    assert.ok(enviadas.some((e) => e.texto.includes("/foco")));
  });

  it("/p leva a squad do prefixo ao turno, no texto e na legenda do áudio; sem prefixo, nenhuma", async () => {
    const { bot, rodadas } = montar({ transcrever: async () => "ajustar o demo" });
    bot.processar(req(update(1, "/p /foco revisar o Mapa")), res(), () => {});
    bot.processar(req(update(2, "reunião amanhã")), res(), () => {});
    const audio = voz(3);
    bot.processar(req({ ...audio, message: { ...audio.message, caption: "/p" } }), res(), () => {});
    await bot.ocioso();
    assert.deepEqual(rodadas, [
      { demanda: "revisar o Mapa", modo: "foco", squadId: "prumo" },
      { demanda: "reunião amanhã", modo: "auto" },
      { demanda: "ajustar o demo", modo: "auto", squadId: "prumo" },
    ]);
  });

  it("falha do turno vira texto classificado", async () => {
    const { bot, enviadas } = montar({ rodar: async () => { throw new ModeloOcupado("ocupado"); } });
    bot.processar(req(update(1, "x")), res(), () => {});
    await bot.ocioso();
    assert.match(enviadas.at(-1)!.texto, /Gemini sobrecarregado/);
  });

  it("fila serial: o segundo turno só começa depois do primeiro, e avisa a posição", async () => {
    const ordem: string[] = [];
    let liberar!: () => void;
    const { bot, enviadas } = montar({
      rodar: async (demanda) => {
        ordem.push(`inicio ${demanda}`);
        if (demanda === "a") await new Promise<void>((ok) => { liberar = ok; });
        ordem.push(`fim ${demanda}`);
        return TURNO_VAZIO;
      },
    });
    bot.processar(req(update(1, "a")), res(), () => {});
    bot.processar(req(update(2, "b")), res(), () => {});
    await new Promise((ok) => setImmediate(ok));
    assert.deepEqual(ordem, ["inicio a"]);
    assert.ok(enviadas.some((e) => /Na fila \(1 antes desta\)/.test(e.texto)));
    liberar();
    await bot.ocioso();
    assert.deepEqual(ordem, ["inicio a", "fim a", "inicio b", "fim b"]);
  });

  it("ocupado enquanto há turno rodando ou esperando na fila (o atualizar-central do Dell espera)", async () => {
    let liberar!: () => void;
    const { bot } = montar({
      rodar: async (demanda) => {
        if (demanda === "a") await new Promise<void>((ok) => { liberar = ok; });
        return TURNO_VAZIO;
      },
    });
    assert.equal(bot.ocupado(), false);
    bot.processar(req(update(1, "a")), res(), () => {});
    bot.processar(req(update(2, "b")), res(), () => {});
    await new Promise((ok) => setImmediate(ok));
    assert.equal(bot.ocupado(), true);
    liberar();
    await bot.ocioso();
    assert.equal(bot.ocupado(), false);
  });

  it("resumo que falha depois do turno rodar não vira 'erro ao processar' (o compromisso já pode ter nascido no Google)", async () => {
    // Formato malformado propositalmente: o que importa é que textoDoTurno
    // lance DEPOIS de rodar() ter terminado com sucesso, não a causa real.
    const turnoQuebrado = { eventos_criados: [null], sugestoes: [], avisos: [], erros: [] } as unknown as TurnoResult;
    const { bot, enviadas } = montar({ rodar: async () => turnoQuebrado });
    bot.processar(req(update(1, "reunião amanhã")), res(), () => {});
    await bot.ocioso();
    const texto = enviadas.at(-1)!.texto;
    assert.match(texto, /processada/);
    assert.doesNotMatch(texto, /Erro ao processar/);
  });

  it("demanda atrasada (backlog depois de o servidor voltar): sem turno, pede reenvio", async () => {
    const { bot, rodadas, enviadas } = montar();
    const r = res();
    bot.processar(req(update(1, "/foco ligar pro banco", 111, 6 * 3600)), r, () => {});
    await bot.ocioso();
    assert.equal(r.statusCode, 200);
    assert.equal(rodadas.length, 0);
    assert.equal(enviadas.length, 1);
    assert.match(enviadas[0].texto, /360 min de atraso/);
    assert.equal(enviadas[0].responderA, 10);
  });

  it("enviar que falha não derruba a fila", async () => {
    let n = 0;
    const { bot, rodadas } = montar({ enviar: async () => { n++; throw new Error("403 blocked"); } });
    bot.processar(req(update(1, "a")), res(), () => {});
    bot.processar(req(update(2, "b")), res(), () => {});
    await bot.ocioso();
    assert.equal(rodadas.length, 2);
    assert.ok(n >= 2);
  });
});

describe("áudio", () => {
  it("transcreve, roda a transcrição como demanda e ecoa o que entendeu", async () => {
    const { bot, rodadas, enviadas } = montar();
    bot.processar(req(voz(1)), res(), () => {});
    await bot.ocioso();
    assert.deepEqual(rodadas, [{ demanda: "reunião amanhã", modo: "auto" }]);
    assert.match(enviadas.at(-1)!.texto, /^🎙️ “reunião amanhã”\n\nNada foi agendado\.$/);
  });

  it("áudio sem fala: não roda turno e diz que não entendeu", async () => {
    const { bot, rodadas, enviadas } = montar({ transcrever: async () => { throw new AudioSemFala(); } });
    bot.processar(req(voz(1)), res(), () => {});
    await bot.ocioso();
    assert.equal(rodadas.length, 0);
    assert.match(enviadas.at(-1)!.texto, /Não entendi o áudio/);
  });

  it("entra na mesma fila serial dos textos", async () => {
    const ordem: string[] = [];
    let liberar!: () => void;
    const { bot } = montar({
      rodar: async (demanda) => {
        ordem.push(demanda);
        if (demanda === "a") await new Promise<void>((ok) => { liberar = ok; });
        return TURNO_VAZIO;
      },
    });
    bot.processar(req(update(1, "a")), res(), () => {});
    bot.processar(req(voz(2)), res(), () => {});
    await new Promise((ok) => setImmediate(ok));
    assert.deepEqual(ordem, ["a"]);
    liberar();
    await bot.ocioso();
    assert.deepEqual(ordem, ["a", "reunião amanhã"]);
  });
});

describe("propostas de contratação com botões", () => {
  const proposta = { id: "p1", kind: "integrante" as const, squad_id: "pessoal", dominio_id: "d", dominio_nome: "Finanças", papel: "Contador", justificativa: "", escopo: "" };
  const turnoComProposta: TurnoResult = { ...TURNO_VAZIO, sugestoes: [proposta] };

  async function comProposta(x: Partial<DepsDoBot> = {}) {
    const m = montar({ rodar: async () => turnoComProposta, ...x });
    m.bot.processar(req(update(1, "contrate um contador")), res(), () => {});
    await m.bot.ocioso();
    return m;
  }

  it("depois do resumo, uma mensagem por proposta com Aprovar e Descartar", async () => {
    const { enviadas } = await comProposta();
    assert.match(enviadas[0].texto, /1 proposta\(s\) de contratação abaixo/);
    assert.equal(enviadas[1].texto, "💡 Contratar Contador em Finanças.");
    assert.deepEqual(enviadas[1].botoes, [
      { texto: "✅ Aprovar", dados: "h:p1:a" },
      { texto: "🗑️ Descartar", dados: "h:p1:d" },
    ]);
  });

  it("Aprovar contrata UMA vez: o segundo toque encontra a proposta expirada", async () => {
    const { bot, contratadas, edicoes, respostasDeBotao } = await comProposta();
    bot.processar(req(toque(2, "h:p1:a")), res(), () => {});
    bot.processar(req(toque(3, "h:p1:a")), res(), () => {});
    await new Promise((ok) => setTimeout(ok, 10));
    assert.deepEqual(contratadas, ["p1"]);
    assert.ok(edicoes.some((e) => e.mensagemId === 500 && /✅ contratado/.test(e.texto)));
    assert.ok(edicoes.some((e) => e.texto === TEXTO_PROPOSTA_EXPIRADA));
    assert.ok(respostasDeBotao.includes("Contratando…"));
  });

  it("Descartar não contrata e tira os botões", async () => {
    const { bot, contratadas, edicoes } = await comProposta();
    bot.processar(req(toque(2, "h:p1:d")), res(), () => {});
    await new Promise((ok) => setTimeout(ok, 10));
    assert.equal(contratadas.length, 0);
    assert.match(edicoes[0].texto, /🗑️ Descartada\.$/);
  });

  it("contratação que falha vira texto na mensagem, sem deixar botão para repetir", async () => {
    const { bot, edicoes } = await comProposta({ contratar: async () => { throw new Error("A squad 'Pessoal' já tem 9 domínios."); } });
    bot.processar(req(toque(2, "h:p1:a")), res(), () => {});
    await new Promise((ok) => setTimeout(ok, 10));
    assert.match(edicoes[0].texto, /❌ Não contratei: A squad 'Pessoal' já tem 9 domínios\./);
  });

  it("proposta desconhecida (redeploy) ou vencida responde expirada", async () => {
    let agora = AGORA;
    const { bot, contratadas, edicoes } = await comProposta({ agora: () => agora });
    bot.processar(req(toque(2, "h:nao-existe:a")), res(), () => {});
    agora = new Date(AGORA.getTime() + VALIDADE_PROPOSTA_MS + 1);
    bot.processar(req(toque(3, "h:p1:a")), res(), () => {});
    await new Promise((ok) => setTimeout(ok, 10));
    assert.equal(contratadas.length, 0);
    assert.equal(edicoes.filter((e) => e.texto === TEXTO_PROPOSTA_EXPIRADA).length, 2);
  });

  it("toque de chat fora da allowlist não contrata nem responde", async () => {
    const { bot, contratadas, respostasDeBotao } = await comProposta();
    bot.processar(req(toque(2, "h:p1:a", 999)), res(), () => {});
    await new Promise((ok) => setTimeout(ok, 10));
    assert.equal(contratadas.length, 0);
    assert.equal(respostasDeBotao.length, 0);
  });
});
