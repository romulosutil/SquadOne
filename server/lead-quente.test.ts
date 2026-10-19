import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { MensagemDaConversa } from "./conversa-do-lead.ts";
import {
  CALAR_SEM_REGISTRO,
  chaveDoLeadQuente,
  decidirLeadQuente,
  esperaDaRespostaHumana,
  ESPERA_DA_SUGESTAO_MS,
  pendenteDaConversa,
  podeTocar,
  resumoDoLeadQuente,
  sinalNoTexto,
  textoDoAvisoLeadQuente,
  type DecisaoDoLeadQuente,
  type EntradaDoLeadQuente,
  type RegistroDeDecisao,
  type RegistroDoLeadQuente,
  type SugestaoParaOLeadQuente,
  type ToqueDoAgente,
} from "./lead-quente.ts";

// O agente que mantém o lead quente, em sombra (17/10/2026). Regras puras, em tabela: nada de Vue, de
// disco, do Google nem do WhatsApp. A cola (lead-quente-sombra.test.ts) usa diretório temporário.

const T = Date.parse("2026-10-14T15:00:00Z");
const min = 60_000;
const iso = (m: number) => new Date(T + m * min).toISOString();
const msg = (m: number, direcao: "entrada" | "saida", texto: string, papel?: "recepcao" | "robo"): MensagemDaConversa =>
  ({ em: iso(m), direcao, texto, ...(papel ? { papel } : {}) });

const LINK = msg(-120, "saida", "Oi! Segue o link: https://demo-x.vercel.app/");
const SUGESTAO: SugestaoParaOLeadQuente = { mensagem: "Que bom que gostou! Qual parte chamou mais a sua atenção?", momento: { quem: "decisor" } };

type Resposta = { tipo: string };
function entrada(extra: {
  mensagens?: MensagemDaConversa[] | null;
  resposta?: Resposta | null;
  etapa?: string;
  sugestao?: SugestaoParaOLeadQuente | null;
  agora?: number;
  jaDecididas?: string[];
  toques?: ToqueDoAgente[];
  horasDeCalar?: number;
  linkEm?: string | null;
  perdaManual?: string;
} = {}): EntradaDoLeadQuente {
  const mensagens = extra.mensagens === undefined ? [msg(-130, "entrada", "Sim, quero ver"), LINK, msg(-2, "entrada", "Gostei, ficou bom!")] : extra.mensagens;
  const linkEm = extra.linkEm === undefined ? iso(-120) : extra.linkEm;
  return {
    lead: {
      id: "site:L1",
      etapa: (extra.etapa ?? "contato") as any,
      ...(extra.perdaManual ? { perdaManual: extra.perdaManual as any } : {}),
      resposta: extra.resposta === null ? undefined : ({ tipo: extra.resposta?.tipo ?? "interesse", trecho: "" } as any),
      conversa: mensagens
        ? ({ desde: iso(-130), mensagens: mensagens.length, ultima: { direcao: "entrada", em: iso(-2), trecho: "" }, ...(linkEm ? { linkEm } : {}) } as any)
        : undefined,
    },
    mensagens,
    sugestao: extra.sugestao === undefined ? SUGESTAO : extra.sugestao,
    agora: extra.agora ?? T,
    jaDecididas: new Set(extra.jaDecididas ?? []),
    ...(extra.toques ? { toques: extra.toques } : {}),
    ...(extra.horasDeCalar !== undefined ? { horasDeCalar: extra.horasDeCalar } : {}),
  };
}

/** A conversa padrão trocando só o que o lead acabou de escrever. */
const comMensagem = (texto: string, papel?: "recepcao" | "robo") =>
  [msg(-130, "entrada", "Sim, quero ver"), LINK, msg(-2, "entrada", texto, papel)];

const resumo = (d: DecisaoDoLeadQuente) => (d.acao === "calar" || d.acao === "escalar" ? `${d.acao}:${d.motivo}` : d.acao);

describe("lead quente: a mensagem pendente e a chave", () => {
  it("a pendente é a rajada de gente depois da última saída; o robô não conta", () => {
    const p = pendenteDaConversa([msg(-10, "saida", "link"), msg(-8, "entrada", "oi"), msg(-6, "entrada", "[Atendimento] menu", "robo"), msg(-5, "entrada", "gostei")]);
    assert.deepEqual(p?.rajada.map((m) => m.texto), ["oi", "gostei"]);
    assert.equal(p?.ultimaEntrada, iso(-5));
  });
  for (const [nome, mensagens] of [
    ["sem conversa", null],
    ["conversa vazia", []],
    ["a última coisa dita foi nossa", [msg(-8, "entrada", "oi"), msg(-5, "saida", "oi!")]],
    ["só o robô falou depois de nós", [msg(-8, "saida", "oi"), msg(-5, "entrada", "[Bot] menu", "robo")]],
  ] as Array<[string, MensagemDaConversa[] | null]>) {
    it(`sem pendente: ${nome}`, () => assert.equal(pendenteDaConversa(mensagens), null));
  }
  it("a chave é a do vendedor: lead|responder|ultimaEntrada", () => {
    const d = decidirLeadQuente(entrada());
    assert.equal(d.acao === "calar" ? null : d.chave, `site:L1|responder|${iso(-2)}`);
    assert.equal(chaveDoLeadQuente("site:L1", iso(-2)), `site:L1|responder|${iso(-2)}`);
  });
});

describe("lead quente: responder (o gate estrito)", () => {
  it("interesse, curta, depois do link, com sugestão limpa: responde com o texto do copiloto", () => {
    const d = decidirLeadQuente(entrada());
    assert.equal(d.acao, "responder");
    assert.equal(d.acao === "responder" ? d.texto : "", SUGESTAO.mensagem);
  });
  it("o texto é aparado mas nunca reescrito", () => {
    const d = decidirLeadQuente(entrada({ sugestao: { mensagem: "  Bom saber!  ", momento: { quem: "decisor" } } }));
    assert.equal(d.acao === "responder" ? d.texto : "", "Bom saber!");
  });
  it("sem o campo momento (sugestão antiga) ainda responde", () => {
    assert.equal(decidirLeadQuente(entrada({ sugestao: { mensagem: "Que bom!" } })).acao, "responder");
  });
});

describe("lead quente: calar", () => {
  const casos: Array<{ nome: string; e: EntradaDoLeadQuente; esperado: string }> = [
    { nome: "sem conversa guardada", e: entrada({ mensagens: null }), esperado: "calar:sem-novidade" },
    { nome: "a última mensagem é nossa", e: entrada({ mensagens: [...comMensagem("Gostei!"), msg(-1, "saida", "Que bom!")] }), esperado: "calar:sem-novidade" },
    { nome: "só o robô falou", e: entrada({ mensagens: [msg(-130, "entrada", "Sim"), LINK, msg(-2, "entrada", "[Bot] Olá", "robo")] }), esperado: "calar:sem-novidade" },
    { nome: "já decidida (a chave está no JSONL)", e: entrada({ jaDecididas: [`site:L1|responder|${iso(-2)}`] }), esperado: "calar:ja-decidida" },
    { nome: "outra mensagem do mesmo lead não é a já decidida", e: entrada({ jaDecididas: [`site:L1|responder|${iso(-30)}`] }), esperado: "responder" },
    { nome: "lead novo", e: entrada({ etapa: "novo" }), esperado: "calar:etapa" },
    { nome: "lead ganho", e: entrada({ etapa: "ganho" }), esperado: "calar:etapa" },
    { nome: "lead perdido", e: entrada({ etapa: "perdido" }), esperado: "calar:etapa" },
    { nome: "perda marcada à mão", e: entrada({ perdaManual: "recusou" }), esperado: "calar:etapa" },
    { nome: "mensagem de ontem: não é nova", e: entrada({ agora: T + 25 * 60 * min }), esperado: "calar:sem-novidade" },
    { nome: "o lead escreveu antes de o link sair: passo do Rômulo", e: entrada({ mensagens: [msg(-130, "saida", "Oi!"), msg(-125, "entrada", "Quero ver")], linkEm: null }), esperado: "calar:antes-do-link" },
    { nome: "sem link nenhum na conversa", e: entrada({ linkEm: null }), esperado: "calar:antes-do-link" },
    { nome: "recusa", e: entrada({ resposta: { tipo: "negativa" } }), esperado: "calar:negativa" },
    { nome: "exclusão", e: entrada({ resposta: { tipo: "exclusao" } }), esperado: "calar:negativa" },
    { nome: "resposta automática", e: entrada({ resposta: { tipo: "bot" } }), esperado: "calar:robo" },
    { nome: "neutra", e: entrada({ resposta: { tipo: "neutra" } }), esperado: "calar:sem-interesse" },
    { nome: "sem classificação", e: entrada({ resposta: null }), esperado: "calar:sem-interesse" },
    { nome: "o copiloto leu um robô", e: entrada({ sugestao: { mensagem: "oi", momento: { quem: "robo" } } }), esperado: "calar:robo" },
  ];
  for (const c of casos) it(c.nome, () => assert.equal(resumo(decidirLeadQuente(c.e)), c.esperado));

  it("o calar sem novidade não é gravado; o calar que é decisão, sim", () => {
    for (const m of ["sem-novidade", "etapa", "ja-decidida", "antes-do-link"] as const) assert.ok(CALAR_SEM_REGISTRO.has(m));
    for (const m of ["romulo-assumiu", "negativa", "robo", "sem-interesse"] as const) assert.ok(!CALAR_SEM_REGISTRO.has(m));
  });
});

describe("lead quente: o Rômulo assumiu", () => {
  const depoisDoLink = (m: number) => [msg(-130, "entrada", "Sim"), LINK, msg(m, "saida", "Qualquer dúvida me chama"), msg(-2, "entrada", "Gostei!")];
  it("escreveu à mão há 1 h (depois do link): o agente cala", () => {
    assert.equal(resumo(decidirLeadQuente(entrada({ mensagens: depoisDoLink(-60) }))), "calar:romulo-assumiu");
  });
  it("escreveu à mão há 7 h: passou a janela de 6 h, o agente volta", () => {
    const mensagens = [msg(-600, "saida", "Oi!"), msg(-590, "entrada", "Sim"), msg(-580, "saida", "Segue https://demo-x.vercel.app/"), msg(-430, "saida", "Viu?"), msg(-2, "entrada", "Gostei!")];
    assert.equal(decidirLeadQuente(entrada({ mensagens, linkEm: iso(-580) })).acao, "responder");
  });
  it("a janela é configurável", () => {
    assert.equal(decidirLeadQuente(entrada({ mensagens: depoisDoLink(-60), horasDeCalar: 0.5 })).acao, "responder");
  });
  it("o próprio envio do link não é 'assumir'", () => {
    assert.equal(decidirLeadQuente(entrada()).acao, "responder");
  });
  it("saída sem texto guardado (bridge antiga) conta como escrita à mão", () => {
    const mensagens = [msg(-130, "entrada", "Sim"), LINK, msg(-30, "saida", ""), msg(-2, "entrada", "Gostei!")];
    assert.equal(resumo(decidirLeadQuente(entrada({ mensagens }))), "calar:romulo-assumiu");
  });
});

describe("lead quente: escalar pelo que ele escreveu", () => {
  const casos: Array<[string, string, string]> = [
    // [nome, mensagem do lead, motivo]
    ["pediu preço", "Quanto custa?", "preco"],
    ["pediu preço, sem acento e em maiúsculas", "QUAL O PRECO DISSO", "preco"],
    ["falou em reais", "uns 500 reais eu pagaria", "preco"],
    ["pediu valores", "Pode passar os valores?", "preco"],
    ["escreveu R$", "R$ 300 fica bom", "preco"],
    ["pediu proposta", "Me manda a proposta", "proposta"],
    ["pediu orçamento", "Faz um orçamento pra mim?", "proposta"],
    ["quer fechar", "Vamos fechar!", "fechar"],
    ["quer contratar", "Quero contratar", "fechar"],
    ["como pagar", "Como pago?", "fechar"],
    ["pix", "aceita pix?", "fechar"],
    ["pediu ligação", "Me liga amanhã?", "humano"],
    ["quer reunião", "Podemos marcar uma reunião", "humano"],
    ["quer falar com uma pessoa", "Posso falar com um humano?", "humano"],
    ["objeção de preço", "Achei caro", "objecao"],
    ["já tem", "Já tenho um site", "objecao"],
    ["vai pensar", "Vou pensar e te falo", "objecao"],
    ["desconfiança", "Isso funciona mesmo?", "objecao"],
    ["irritação", "Para de me mandar mensagem!", "irritacao"],
    ["irritação: de onde veio o número", "Como você conseguiu meu número?", "irritacao"],
    ["xingamento", "Que merda é essa", "irritacao"],
    ["recusa dita", "Não tenho interesse", "sinal-negativo"],
    ["desistiu", "Desisti dessa ideia", "sinal-negativo"],
    ["não mande mais", "não mande mais isso", "sinal-negativo"],
  ];
  for (const [nome, texto, motivo] of casos) {
    it(nome, () => {
      const d = decidirLeadQuente(entrada({ mensagens: comMensagem(texto) }));
      assert.equal(resumo(d), `escalar:${motivo}`);
    });
  }
  it("áudio, com ou sem transcrição", () => {
    assert.equal(resumo(decidirLeadQuente(entrada({ mensagens: comMensagem("[áudio 12s]") }))), "escalar:audio");
    assert.equal(resumo(decidirLeadQuente(entrada({ mensagens: comMensagem("[áudio 12s] gostei muito") }))), "escalar:audio");
    assert.equal(resumo(decidirLeadQuente(entrada({ mensagens: comMensagem("[áudio]") }))), "escalar:audio");
  });
  it("a recepção respondeu", () => {
    assert.equal(resumo(decidirLeadQuente(entrada({ mensagens: comMensagem("*[Patricia]* Pode enviar sim", "recepcao") }))), "escalar:recepcao");
  });
  it("licença: o 'pode mandar' é permissão para o material, o passo é do Rômulo", () => {
    assert.equal(resumo(decidirLeadQuente(entrada({ resposta: { tipo: "licenca" } }))), "escalar:licenca");
  });
  it("mensagem longa", () => {
    assert.equal(resumo(decidirLeadQuente(entrada({ mensagens: comMensagem("gostei ".repeat(40)) }))), "escalar:mensagem-longa");
  });
  it("rajada com mais de 3 mensagens é longa", () => {
    const mensagens = [msg(-130, "entrada", "Sim"), LINK, msg(-6, "entrada", "a"), msg(-5, "entrada", "b"), msg(-4, "entrada", "c"), msg(-3, "entrada", "d")];
    assert.equal(resumo(decidirLeadQuente(entrada({ mensagens }))), "escalar:mensagem-longa");
  });
  it("o sinal em qualquer mensagem da rajada, não só na última", () => {
    const mensagens = [msg(-130, "entrada", "Sim"), LINK, msg(-6, "entrada", "Quanto custa?"), msg(-3, "entrada", "gostei")];
    assert.equal(resumo(decidirLeadQuente(entrada({ mensagens }))), "escalar:preco");
  });
  it("negativa dita antes, já respondida, ainda pesa nas 3 últimas de gente", () => {
    const mensagens = [msg(-400, "saida", "Oi"), msg(-390, "entrada", "não quero"), msg(-380, "saida", "Tudo bem!"), msg(-300, "saida", "https://demo-x.vercel.app/"), msg(-2, "entrada", "ok gostei")];
    assert.equal(resumo(decidirLeadQuente(entrada({ mensagens, linkEm: iso(-300) }))), "escalar:sinal-negativo");
  });
  it("lead na etapa proposta que escreve é do Rômulo", () => {
    assert.equal(resumo(decidirLeadQuente(entrada({ etapa: "proposta" }))), "escalar:na-proposta");
  });
  it("o que não é sinal passa pelo gate", () => {
    for (const texto of ["Gostei, ficou bom!", "Pode me mostrar mais?", "Show, adorei o layout", "legal"]) {
      assert.equal(decidirLeadQuente(entrada({ mensagens: comMensagem(texto) })).acao, "responder", texto);
    }
  });
});

describe("lead quente: escalar pelo que o copiloto devolveu", () => {
  const casos: Array<[string, SugestaoParaOLeadQuente | null, string]> = [
    ["recepção segundo o copiloto", { mensagem: "Oi!", momento: { quem: "recepcao" } }, "escalar:recepcao"],
    ["copiloto não sabe quem é", { mensagem: "Oi!", momento: { quem: "nao_sei" } }, "escalar:fora-do-dossie"],
    ["o copiloto montou itens de proposta", { mensagem: "Oi!", itensDeProposta: 2 }, "escalar:proposta"],
    ["valor em dinheiro na resposta, mesmo o aberto do cardápio", { mensagem: "O Encontrado sai por R$ 290 por mês", momento: { quem: "decisor" } }, "escalar:preco-na-mensagem"],
    ["valor por extenso", { mensagem: "Fica 2.400 reais", momento: { quem: "decisor" } }, "escalar:preco-na-mensagem"],
    ["valor com mil", { mensagem: "Sai por 2 mil reais", momento: { quem: "decisor" } }, "escalar:preco-na-mensagem"],
    ["aviso do copiloto (número fora do dossiê)", { mensagem: "Faz 14 anos!", avisos: ["Confira antes de mandar: 14 não aparece no dossiê."], momento: { quem: "decisor" } }, "escalar:fora-do-dossie"],
    ["resposta vazia", { mensagem: "   " }, "escalar:sem-sugestao"],
  ];
  for (const [nome, sugestao, esperado] of casos) it(nome, () => assert.equal(resumo(decidirLeadQuente(entrada({ sugestao }))), esperado));

  it("sem sugestão ainda: aguarda o copiloto até 5 min; depois escala", () => {
    assert.equal(resumo(decidirLeadQuente(entrada({ sugestao: null, agora: T }))), "aguardar");
    assert.equal(resumo(decidirLeadQuente(entrada({ sugestao: null, agora: T + ESPERA_DA_SUGESTAO_MS }))), "escalar:sem-sugestao");
  });
  it("a mensagem 'R$' da sugestão nunca chega ao aviso de responder", () => {
    const d = decidirLeadQuente(entrada({ sugestao: { mensagem: "Sai por R$ 290", momento: { quem: "decisor" } } }));
    assert.equal(d.acao, "escalar");
  });
});

describe("lead quente: teto de toques", () => {
  const toque = (m: number, tipo: ToqueDoAgente["tipo"] = "resposta"): ToqueDoAgente => ({ em: T + m * min, tipo });
  it("duas respostas seguidas do agente sem o Rômulo: a terceira é dele", () => {
    assert.equal(resumo(decidirLeadQuente(entrada({ toques: [toque(-100), toque(-50)] }))), "escalar:teto-de-toques");
  });
  it("uma resposta seguida ainda deixa responder", () => {
    assert.equal(decidirLeadQuente(entrada({ toques: [toque(-50)] })).acao, "responder");
  });
  it("o Rômulo escreveu no meio: a contagem recomeça", () => {
    const mensagens = [msg(-400, "entrada", "Sim"), msg(-390, "saida", "link https://demo-x.vercel.app/"), msg(-350, "saida", "alô"), msg(-2, "entrada", "Gostei!")];
    const d = decidirLeadQuente(entrada({ mensagens, linkEm: iso(-390), horasDeCalar: 1, toques: [toque(-380), toque(-360)] }));
    assert.equal(d.acao, "responder");
  });
  const base: MensagemDaConversa[] = [msg(-300, "saida", "link"), msg(-200, "entrada", "oi")];
  it("podeTocar: duas respostas depois da última saída do Rômulo fecham; uma deixa", () => {
    assert.equal(podeTocar([toque(-100), toque(-50)], base).pode, false);
    assert.equal(podeTocar([toque(-100)], base).pode, true);
    assert.equal(podeTocar([toque(-500), toque(-400)], base).pode, true, "as de antes da saída dele não contam");
  });
});

describe("lead quente: sinais no texto", () => {
  const casos: Array<[string, string | null]> = [
    ["Gostei muito!", null],
    ["Pode me mostrar mais detalhes", null],
    ["ok", null],
    ["Obrigado", null],
    ["PREÇO", "preco"],
    ["qual o preço?", "preco"],
    ["Valores?", "preco"],
    ["Quero fechar", "fechar"],
    ["me chama no zap", null],
    ["Para de me mandar proposta", "irritacao"],
    ["Pode ligar amanhã", "humano"],
    ["O orçamento ficou apertado", "proposta"],
    ["Sem tempo agora", "objecao"],
  ];
  for (const [texto, motivo] of casos) it(`${JSON.stringify(texto)} -> ${motivo}`, () => assert.equal(sinalNoTexto(texto), motivo));
});

describe("lead quente: o aviso do Telegram", () => {
  const responder: Extract<DecisaoDoLeadQuente, { acao: "responder" }> = { acao: "responder", chave: "k", texto: "Que bom que gostou!", avisos: [] };
  it("responder mostra a resposta inteira e diz que nada foi enviado", () => {
    const t = textoDoAvisoLeadQuente("Clínica Sol", responder);
    assert.match(t, /eu teria respondido a Clínica Sol/);
    assert.match(t, /Que bom que gostou!/);
    assert.match(t, /Nada foi enviado/);
  });
  it("escalar leva o motivo e nunca a mensagem do lead", () => {
    const t = textoDoAvisoLeadQuente("Clínica Sol", { acao: "escalar", chave: "k", motivo: "preco" });
    assert.match(t, /eu teria escalado Clínica Sol \(pediu preço\): assuma/);
    assert.doesNotMatch(t, /R\$/);
  });
  it("valor no nome da empresa sai do aviso", () => {
    const t = textoDoAvisoLeadQuente("Loja R$ 500 Baratinho", { acao: "escalar", chave: "k", motivo: "fechar" });
    assert.doesNotMatch(t, /500/);
  });
});

describe("lead quente: tempo até a resposta humana", () => {
  it("a primeira saída depois da mensagem dele", () => {
    const r = esperaDaRespostaHumana([msg(-10, "entrada", "oi"), msg(-4, "saida", "olá"), msg(-1, "saida", "tudo bem?")], iso(-10));
    assert.deepEqual(r, { respondeuEm: iso(-4), esperaMs: 6 * min });
  });
  it("ainda sem resposta: null", () => assert.equal(esperaDaRespostaHumana([msg(-10, "entrada", "oi")], iso(-10)), null));
});

describe("lead quente: o resumo da medida", () => {
  const dec = (n: number, acao: RegistroDeDecisao["acao"], extra: Partial<RegistroDeDecisao> = {}): RegistroDeDecisao =>
    ({ tipo: "decisao", quando: iso(-n), lead: `site:L${n}`, empresa: `E${n}`, chave: `site:L${n}|responder|${iso(-n)}`, token: `t${n}`, acao, ultimaEntrada: iso(-n), avisado: true, ...extra });
  const voto = (n: number, concorda: boolean): RegistroDoLeadQuente => ({ tipo: "voto", quando: iso(-n + 1), chave: `site:L${n}|responder|${iso(-n)}`, concorda });
  const humano = (n: number, minutos: number): RegistroDoLeadQuente =>
    ({ tipo: "humano", quando: iso(-n + 5), chave: `site:L${n}|responder|${iso(-n)}`, respondeuEm: iso(-n + minutos), esperaMs: minutos * min });

  it("conta, soma motivos, falso positivo e tempo humano", () => {
    const registros: RegistroDoLeadQuente[] = [
      dec(10, "responder"), dec(20, "responder"), dec(30, "responder"), dec(40, "escalar", { motivo: "preco" }), dec(50, "escalar", { motivo: "preco" }),
      dec(60, "escalar", { motivo: "audio", avisado: false, semAviso: "teto" }), dec(70, "calar", { motivo: "romulo-assumiu", avisado: false }),
      voto(10, true), voto(20, false), voto(40, true),
      humano(10, 30), humano(20, 90), humano(40, 10),
    ];
    const r = resumoDoLeadQuente(registros, T);
    assert.equal(r.decisoes, 7);
    assert.deepEqual([r.responder, r.escalar, r.calar], [3, 3, 1]);
    assert.deepEqual(r.escalarPorMotivo, { preco: 2, audio: 1 });
    assert.deepEqual(r.calarPorMotivo, { "romulo-assumiu": 1 });
    assert.equal(r.avisados, 5);
    assert.equal(r.semAvisoPorTeto, 1);
    assert.deepEqual(r.votos.responder, { concorda: 1, discorda: 1, semVoto: 1 });
    assert.deepEqual(r.votos.escalar, { concorda: 1, discorda: 0, semVoto: 2 });
    assert.deepEqual(r.falsosPositivosDeInteresse, { votados: 2, discordam: 1, taxa: 0.5 });
    assert.deepEqual(r.humano, { responderam: 3, semResposta: 3, medianaMin: 30, medianaMinNosResponder: 60 });
  });
  it("sem voto não há taxa de falso positivo", () => {
    const r = resumoDoLeadQuente([dec(10, "responder")], T);
    assert.equal(r.falsosPositivosDeInteresse.taxa, null);
    assert.equal(r.humano.medianaMin, null);
  });
  it("o último voto de cada decisão vale", () => {
    const r = resumoDoLeadQuente([dec(10, "responder"), voto(10, true), { ...voto(10, false), quando: iso(-5) }], T);
    assert.deepEqual(r.votos.responder, { concorda: 0, discorda: 1, semVoto: 0 });
  });
  it("só os últimos N dias", () => {
    const velha = { ...dec(10, "responder"), quando: iso(-40 * 24 * 60) };
    assert.equal(resumoDoLeadQuente([velha, dec(10, "escalar", { motivo: "preco" })], T, 30).decisoes, 1);
  });
  it("sem registro nenhum, tudo zero", () => {
    const r = resumoDoLeadQuente([], T);
    assert.deepEqual([r.decisoes, r.responder, r.escalar, r.calar], [0, 0, 0, 0]);
  });
});

describe("lead quente: nada envia ao lead", () => {
  // O agente desta fase só decide. Se algum dia um destes arquivos importar o transporte do WhatsApp ou
  // chamar o envio, este teste cai e a mudança vira decisão do Rômulo (RULES: "nunca envia ao lead").
  const SEM_COMENTARIO = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  for (const arquivo of ["lead-quente.ts", "lead-quente-sombra.ts"]) {
    it(`${arquivo} não toca o WhatsApp`, async () => {
      let fonte: string;
      try {
        fonte = await fs.readFile(path.join(import.meta.dirname, arquivo), "utf8");
      } catch {
        return; // a cola pode ainda não existir
      }
      assert.doesNotMatch(SEM_COMENTARIO(fonte), /sendText|evolution|wa\.me|api\.whatsapp|sendMedia|\/message\/send/i);
    });
  }
});
