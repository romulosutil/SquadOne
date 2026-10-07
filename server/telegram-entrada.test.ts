import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  criarMemoriaDeUpdates,
  dadosDoBotao,
  IDADE_MAXIMA_DEMANDA_MIN,
  MAX_BYTES_AUDIO,
  MAX_DURACAO_AUDIO_S,
  interpretarUpdate as interpretarComRelogio,
  PREFIXOS_DE_SQUAD,
  TEXTO_DE_AJUDA,
  textoDeDemandaAtrasada,
} from "./telegram-entrada.ts";

const PERMITIDOS = new Set([111]);
/** `message.date` do Telegram é em SEGUNDOS desde a época. */
const AGORA = new Date("2026-09-15T12:00:00Z");
const AGORA_S = AGORA.getTime() / 1000;
const msg = (x: Record<string, unknown>, chat: Record<string, unknown> = { id: 111, type: "private" }) => ({
  update_id: 9,
  message: { message_id: 5, chat, date: AGORA_S - 30, ...x },
});
const interpretarUpdate = (u: unknown, permitidos: ReadonlySet<number>) => interpretarComRelogio(u, permitidos, AGORA);

describe("interpretarUpdate", () => {
  it("texto comum = demanda auto, aparado", () => {
    assert.deepEqual(interpretarUpdate(msg({ text: "  reunião com o João amanhã 15h " }), PERMITIDOS), {
      tipo: "demanda", updateId: 9, chatId: 111, mensagemId: 5, demanda: "reunião com o João amanhã 15h", modo: "auto",
    });
  });

  const comandos: [string, string, string | null][] = [
    ["/foco revisar contrato", "foco", "revisar contrato"],
    ["/baixa trocar lâmpada", "baixa_prioridade", "trocar lâmpada"],
    ["/foco@SquadOneBot revisar contrato", "foco", "revisar contrato"],
    ["/foco\nlinha 1\nlinha 2", "foco", "linha 1\nlinha 2"],
  ];
  for (const [texto, modo, demanda] of comandos) {
    it(`comando de modo: ${JSON.stringify(texto)}`, () => {
      const e = interpretarUpdate(msg({ text: texto }), PERMITIDOS);
      assert.equal(e.tipo, "demanda");
      assert.equal((e as any).modo, modo);
      assert.equal((e as any).demanda, demanda);
    });
  }

  for (const texto of ["/start", "/ajuda", "/help", "/foco", "/baixa   ", "/qualquer coisa", "/constructor x", "/toString x"]) {
    it(`ajuda: ${JSON.stringify(texto)}`, () => {
      assert.equal(interpretarUpdate(msg({ text: texto }), PERMITIDOS).tipo, "ajuda");
    });
  }

  describe("prefixo de squad /p (sem estado, sem chamada ao modelo)", () => {
    it("o prefixo aponta para o id da squad prumo", () => {
      assert.equal(PREFIXOS_DE_SQUAD.p, "prumo");
    });

    it("/p <texto> = demanda auto na squad prumo", () => {
      assert.deepEqual(interpretarUpdate(msg({ text: "/p revisar o Mapa da padaria" }), PERMITIDOS), {
        tipo: "demanda", updateId: 9, chatId: 111, mensagemId: 5, demanda: "revisar o Mapa da padaria", modo: "auto", squadId: "prumo",
      });
    });

    const combinados: [string, string, string][] = [
      ["/p /foco revisar o Mapa", "foco", "revisar o Mapa"],
      ["/foco /p revisar o Mapa", "foco", "revisar o Mapa"],
      ["/P /baixa trocar o logo do demo", "baixa_prioridade", "trocar o logo do demo"],
      ["/p@SquadOneBot ligar para o dono", "auto", "ligar para o dono"],
      ["/p\nlinha 1\nlinha 2", "auto", "linha 1\nlinha 2"],
    ];
    for (const [texto, modo, demanda] of combinados) {
      it(`com modo, em qualquer ordem: ${JSON.stringify(texto)}`, () => {
        const e = interpretarUpdate(msg({ text: texto }), PERMITIDOS) as any;
        assert.equal(e.tipo, "demanda");
        assert.equal(e.squadId, "prumo");
        assert.equal(e.modo, modo);
        assert.equal(e.demanda, demanda);
      });
    }

    it("sem prefixo não fixa squad (primeira ativa + redirecionamento)", () => {
      assert.equal("squadId" in interpretarUpdate(msg({ text: "/foco revisar contrato" }), PERMITIDOS), false);
      assert.equal("squadId" in interpretarUpdate(msg({ text: "proposta da padaria /p" }), PERMITIDOS), false);
    });

    it("barra no meio da demanda é texto", () => {
      const e = interpretarUpdate(msg({ text: "/p proposta 2/3 com /foco no prazo" }), PERMITIDOS) as any;
      assert.equal(e.demanda, "proposta 2/3 com /foco no prazo");
      assert.equal(e.modo, "auto");
    });

    for (const texto of ["/p", "/p   ", "/p /foco", "/p /p x", "/foco /baixa x", "/p /start", "/p /qualquer x"]) {
      it(`ajuda: ${JSON.stringify(texto)}`, () => {
        assert.equal(interpretarUpdate(msg({ text: texto }), PERMITIDOS).tipo, "ajuda");
      });
    }

    it("legenda /p no áudio fixa a squad; /p /foco também o modo", () => {
      const voz = (caption?: string) => msg({ voice: { file_id: "F9", duration: 10 }, ...(caption ? { caption } : {}) });
      assert.deepEqual(interpretarUpdate(voz("/p"), PERMITIDOS), {
        tipo: "audio", updateId: 9, chatId: 111, mensagemId: 5, fileId: "F9", mime: "audio/ogg", modo: "auto", squadId: "prumo",
      });
      const comFoco = interpretarUpdate(voz("/p /foco"), PERMITIDOS) as any;
      assert.equal(comFoco.squadId, "prumo");
      assert.equal(comFoco.modo, "foco");
      assert.equal("squadId" in interpretarUpdate(voz(), PERMITIDOS), false);
      // Legenda que não se lê continua auto, sem squad, como antes do prefixo.
      const estranha = interpretarUpdate(voz("/qualquer"), PERMITIDOS) as any;
      assert.equal(estranha.modo, "auto");
      assert.equal("squadId" in estranha, false);
    });

    it("demanda /p atrasada também não roda", () => {
      assert.equal(interpretarUpdate(msg({ text: "/p revisar", date: AGORA_S - 3600 }), PERMITIDOS).tipo, "atrasada");
    });

    it("a ajuda ensina o prefixo", () => {
      assert.match(TEXTO_DE_AJUDA, /^\/p <demanda> — direto na squad PRUMO/m);
    });
  });

  it("foto ou documento que não é áudio = semTexto", () => {
    assert.equal(interpretarUpdate(msg({ photo: [{}] }), PERMITIDOS).tipo, "semTexto");
    assert.equal(interpretarUpdate(msg({ audio: { file_id: "f", mime_type: "application/pdf" } }), PERMITIDOS).tipo, "semTexto");
  });

  it("voz = audio em modo auto, com o file_id e o mime", () => {
    assert.deepEqual(interpretarUpdate(msg({ voice: { file_id: "F1", duration: 12, mime_type: "audio/ogg", file_size: 20000 } }), PERMITIDOS), {
      tipo: "audio", updateId: 9, chatId: 111, mensagemId: 5, fileId: "F1", mime: "audio/ogg", modo: "auto",
    });
  });

  it("arquivo de áudio conta; legenda /foco força o modo; mime ausente vira audio/ogg", () => {
    const e = interpretarUpdate(msg({ audio: { file_id: "F2", mime_type: "audio/mpeg", duration: 30 }, caption: "/foco" }), PERMITIDOS);
    assert.equal(e.tipo, "audio");
    assert.equal((e as any).modo, "foco");
    assert.equal((e as any).mime, "audio/mpeg");
    assert.equal((interpretarUpdate(msg({ voice: { file_id: "F3" } }), PERMITIDOS) as any).mime, "audio/ogg");
  });

  it("áudio acima do teto (duração ou tamanho) = audioLongo, sem baixar", () => {
    assert.equal(interpretarUpdate(msg({ voice: { file_id: "F", duration: MAX_DURACAO_AUDIO_S + 1 } }), PERMITIDOS).tipo, "audioLongo");
    assert.equal(interpretarUpdate(msg({ voice: { file_id: "F", duration: 5, file_size: MAX_BYTES_AUDIO + 1 } }), PERMITIDOS).tipo, "audioLongo");
  });

  it("áudio atrasado não roda, como a demanda em texto", () => {
    assert.equal(interpretarUpdate(msg({ voice: { file_id: "F", duration: 5 }, date: AGORA_S - 3600 }), PERMITIDOS).tipo, "atrasada");
  });

  it("chat fora da allowlist = naoAutorizado, ANTES de olhar o comando", () => {
    assert.deepEqual(interpretarUpdate(msg({ text: "/start" }, { id: 222, type: "private" }), PERMITIDOS), {
      tipo: "naoAutorizado", updateId: 9, chatId: 222,
    });
  });

  it("grupo é ignorado mesmo com o id na lista", () => {
    const e = interpretarUpdate(msg({ text: "oi" }, { id: 111, type: "group" }), PERMITIDOS);
    assert.equal(e.tipo, "ignorar");
  });

  it("edited_message, channel_post e lixo são ignorados", () => {
    assert.deepEqual(interpretarUpdate({ update_id: 3, edited_message: {} }, PERMITIDOS), { tipo: "ignorar", updateId: 3 });
    assert.deepEqual(interpretarUpdate({ update_id: 4, channel_post: {} }, PERMITIDOS), { tipo: "ignorar", updateId: 4 });
    assert.deepEqual(interpretarUpdate(null, PERMITIDOS), { tipo: "ignorar", updateId: null });
    assert.deepEqual(interpretarUpdate({ message: {} }, PERMITIDOS), { tipo: "ignorar", updateId: null });
  });

  describe("demanda atrasada (backlog reentregue depois de o servidor voltar)", () => {
    const comIdade = (text: string, idadeS: number) => msg({ text, date: AGORA_S - idadeS });
    const limiteS = IDADE_MAXIMA_DEMANDA_MIN * 60;

    it("no limite ainda é demanda; um segundo além vira atrasada, sem a demanda", () => {
      assert.equal(interpretarUpdate(comIdade("/foco revisar", limiteS), PERMITIDOS).tipo, "demanda");
      assert.deepEqual(interpretarUpdate(comIdade("/foco revisar", limiteS + 1), PERMITIDOS), {
        tipo: "atrasada", updateId: 9, chatId: 111, mensagemId: 5, atrasoMin: IDADE_MAXIMA_DEMANDA_MIN,
      });
    });

    it("atraso arredonda para baixo em minutos", () => {
      const e = interpretarUpdate(comIdade("ligar pro banco", 6 * 3600 + 59), PERMITIDOS);
      assert.equal(e.tipo, "atrasada");
      assert.equal((e as any).atrasoMin, 360);
    });

    it("ajuda e sem texto antigos continuam respondendo: não criam compromisso", () => {
      assert.equal(interpretarUpdate(comIdade("/start", 3600), PERMITIDOS).tipo, "ajuda");
      assert.equal(interpretarUpdate(msg({ photo: [{}], date: AGORA_S - 3600 }), PERMITIDOS).tipo, "semTexto");
    });

    it("chat não autorizado antigo continua naoAutorizado", () => {
      const e = interpretarUpdate(msg({ text: "oi", date: AGORA_S - 3600 }, { id: 222, type: "private" }), PERMITIDOS);
      assert.equal(e.tipo, "naoAutorizado");
    });

    it("date no futuro (relógio adiantado) ou ausente não bloqueia", () => {
      assert.equal(interpretarUpdate(comIdade("x", -120), PERMITIDOS).tipo, "demanda");
      assert.equal(interpretarUpdate(msg({ text: "x", date: undefined }), PERMITIDOS).tipo, "demanda");
    });

    it("texto diz o atraso e pede reenvio", () => {
      assert.match(textoDeDemandaAtrasada(42), /42 min de atraso/);
      assert.match(textoDeDemandaAtrasada(42), /Reenvie/);
    });
  });
});

describe("criarMemoriaDeUpdates", () => {
  it("primeira vez false, repetida true", () => {
    const m = criarMemoriaDeUpdates();
    assert.equal(m.jaVisto(1), false);
    assert.equal(m.jaVisto(1), true);
    assert.equal(m.jaVisto(2), false);
  });

  it("esquece o mais antigo acima da capacidade", () => {
    const m = criarMemoriaDeUpdates(2);
    m.jaVisto(1); m.jaVisto(2); m.jaVisto(3);
    assert.equal(m.jaVisto(1), false);
    assert.equal(m.jaVisto(3), true);
  });
});

describe("botões de proposta (callback_query)", () => {
  const toque = (data: string, chat: Record<string, unknown> = { id: 111, type: "private" }) => ({
    update_id: 20,
    callback_query: { id: "cb1", from: { id: 111 }, data, message: { message_id: 77, chat } },
  });

  it("aprovar e descartar, com o id da proposta", () => {
    assert.deepEqual(interpretarUpdate(toque(dadosDoBotao("abc-123", "aprovar")), PERMITIDOS), {
      tipo: "botao", updateId: 20, chatId: 111, mensagemId: 77, callbackId: "cb1", acao: "aprovar", propostaId: "abc-123",
    });
    assert.equal((interpretarUpdate(toque(dadosDoBotao("abc-123", "descartar")), PERMITIDOS) as any).acao, "descartar");
  });

  it("id de proposta em UUID cabe nos 64 bytes do callback_data", () => {
    const dados = dadosDoBotao("9f1c2a4e-1b2c-4d5e-8f90-a1b2c3d4e5f6", "aprovar");
    assert.ok(Buffer.byteLength(dados) <= 64);
    assert.equal(interpretarUpdate(toque(dados), PERMITIDOS).tipo, "botao");
  });

  it("chat fora da allowlist = naoAutorizado; grupo e dado estranho = ignorar", () => {
    assert.equal(interpretarUpdate(toque("h:x:a", { id: 222, type: "private" }), PERMITIDOS).tipo, "naoAutorizado");
    assert.equal(interpretarUpdate(toque("h:x:a", { id: 111, type: "group" }), PERMITIDOS).tipo, "ignorar");
    assert.equal(interpretarUpdate(toque("rm -rf"), PERMITIDOS).tipo, "ignorar");
    assert.equal(interpretarUpdate(toque("h:x:z"), PERMITIDOS).tipo, "ignorar");
  });
});
