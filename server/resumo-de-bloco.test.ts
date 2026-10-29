import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ATRASO_MAXIMO_MIN, BLOCOS, MAX_NOMES, blocoDaAcao, blocoDevido, montarResumoDeBloco, resumoDeBlocoLigado,
} from "./resumo-de-bloco.ts";
import { validarAviso, textoDoAviso } from "./avisos.ts";
import { MAX_AVISOS_POR_DIA, criarVendedor, estadoNovo } from "./vendedor.ts";
import { criarMemoriaDaVenda } from "./venda-do-dia.ts";
import { filaDeVenda, type AcaoDeVenda } from "../src/operations/proxima-venda.ts";
import type { CrmLead, CrmVisao } from "../src/operations/types.ts";

// Resumo de bloco (29/10/2026, Rotina de docs/PRUMO-DECISOES-PM-2026-10-28.md): regras puras em tabela e
// a cola no vendedor com arquivo temporário (nunca data/).

/** Horário de São Paulo (UTC−3) num dia dado. 14/10/2026 é quarta; 17/10/2026, sábado. */
const sp = (dia: string, hora: string) => Date.parse(`${dia}T${hora}:00-03:00`);
const QUARTA = "2026-10-14";
const min = 60_000;

describe("resumo de bloco: quando sai", () => {
  const casos: Array<{ nome: string; agora: number; enviados?: string[]; esperado: string | null }> = [
    { nome: "08:54 não", agora: sp(QUARTA, "08:54"), esperado: null },
    { nome: "08:55 sim, bloco 1", agora: sp(QUARTA, "08:55"), esperado: `${QUARTA}|fechar` },
    { nome: "09:15 ainda sai (20 min de atraso)", agora: sp(QUARTA, "09:15"), esperado: `${QUARTA}|fechar` },
    { nome: "09:16 não (a janela passou há mais de 20 min)", agora: sp(QUARTA, "09:16"), esperado: null },
    { nome: "13:54 não", agora: sp(QUARTA, "13:54"), esperado: null },
    { nome: "13:55 sim, bloco 2", agora: sp(QUARTA, "13:55"), esperado: `${QUARTA}|conversar` },
    { nome: "14:16 não", agora: sp(QUARTA, "14:16"), esperado: null },
    { nome: "sábado 08:55 não", agora: sp("2026-10-17", "08:55"), esperado: null },
    { nome: "domingo 13:55 não", agora: sp("2026-10-18", "13:55"), esperado: null },
    { nome: "sexta 13:55 sim", agora: sp("2026-10-16", "13:55"), esperado: "2026-10-16|conversar" },
    { nome: "já enviado hoje não", agora: sp(QUARTA, "09:00"), enviados: [`${QUARTA}|fechar`], esperado: null },
    { nome: "o de ontem não segura o de hoje", agora: sp(QUARTA, "08:55"), enviados: ["2026-10-13|fechar"], esperado: `${QUARTA}|fechar` },
    { nome: "o bloco 1 enviado não segura o bloco 2", agora: sp(QUARTA, "13:56"), enviados: [`${QUARTA}|fechar`], esperado: `${QUARTA}|conversar` },
    { nome: "relógio ilegível não", agora: Number.NaN, esperado: null },
  ];
  for (const c of casos) {
    it(c.nome, () => assert.equal(blocoDevido(c.agora, c.enviados ?? [])?.chave ?? null, c.esperado));
  }

  it("os horários da Rotina", () => {
    assert.deepEqual(BLOCOS.map((b) => [b.id, b.resumoMin, b.inicioMin, b.fimMin]), [
      ["fechar", 8 * 60 + 55, 9 * 60, 10 * 60 + 30],
      ["conversar", 13 * 60 + 55, 14 * 60, 15 * 60 + 30],
    ]);
    assert.equal(ATRASO_MAXIMO_MIN, 20);
  });

  it("nasce ligado; só 'false' desliga", () => {
    assert.equal(resumoDeBlocoLigado({}), true);
    assert.equal(resumoDeBlocoLigado({ SQUADONE_RESUMO_DE_BLOCO: "true" }), true);
    assert.equal(resumoDeBlocoLigado({ SQUADONE_RESUMO_DE_BLOCO: " FALSE " }), false);
  });
});

const acao = (sufixo: string, tipo: AcaoDeVenda["tipo"], extra: Partial<AcaoDeVenda> = {}, lead = "L"): AcaoDeVenda => ({
  chave: `site:${lead}|${sufixo}`, leadId: `site:${lead}`, empresa: `Empresa ${lead}`, produto: "site", tipo, titulo: "t", contexto: "c",
  porque: "p", tatica: "x", primeiroContato: false, quente: false, ...extra,
});

describe("resumo de bloco: em que bloco cada ação da fila se faz", () => {
  const casos: Array<[string, AcaoDeVenda, Pick<CrmLead, "etapa"> | undefined, boolean, ReturnType<typeof blocoDaAcao>]> = [
    ["mandar a proposta: fechar", acao("mandar-proposta", "mandar-proposta", { quente: true }), undefined, false, "fechar"],
    ["toque da cadência da proposta: fechar", acao("cadencia|proposta|x|dia-1", "proposta"), undefined, false, "fechar"],
    ["'quanto custa': fechar", acao("negociacao-humana", "combinado"), undefined, false, "fechar"],
    ["qualificação comercial: fechar", acao("qualificacao-comercial", "combinado", { quente: true }), undefined, false, "fechar"],
    ["ciclo comercial (aceite, cobrança): fechar", acao("ciclo-comercial", "combinado"), undefined, false, "fechar"],
    ["interno urgente (Pix): fechar", acao("preparo-x|atendimento-comercial", "combinado", { interna: true, quente: true }), undefined, false, "fechar"],
    ["interno sem urgência: Central", acao("preparo-x|atendimento-comercial", "combinado", { interna: true }), undefined, false, null],
    ["'quero ver' (responder quente): fechar", acao("responder", "responder", { quente: true }), { etapa: "contato" }, false, "fechar"],
    ["resposta de quem está em proposta: fechar", acao("responder", "responder"), { etapa: "proposta" }, false, "fechar"],
    ["resposta comum: conversar", acao("responder", "responder"), { etapa: "contato" }, false, "conversar"],
    ["resposta do robô: Central", acao("responder", "responder", { quente: true }), { etapa: "contato" }, true, null],
    ["'o que achou?' depois do link: conversar", acao("depois-do-link", "depois-do-link", { quente: true }), undefined, false, "conversar"],
    ["retomada da cadência da conversa: conversar", acao("cadencia|conversa|x|dia-2", "depois-do-link"), undefined, false, "conversar"],
    ["marque 10 minutos: conversar", acao("qualificar", "combinado", { quente: true }), undefined, false, "conversar"],
    ["combinado salvo: conversar", acao("combinado", "combinado"), undefined, false, "conversar"],
    ["revisão: Central", acao("revisao", "combinado", { revisao: true, conferirHistorico: true }), undefined, false, null],
    ["revisão de 7 dias: Central", acao("revisao-conversa|x", "combinado", { revisao: true }), undefined, false, null],
    ["indicação: Central", acao("indicacao|p1", "combinado"), undefined, false, null],
    ["follow-up: Central", acao("followup", "followup"), undefined, false, null],
    ["recusa para marcar: Central", acao("desfecho", "desfecho"), undefined, false, null],
    ["primeiro contato: Central", acao("primeiro", "primeiro", { primeiroContato: true }), undefined, false, null],
  ];
  for (const [nome, a, lead, robo, esperado] of casos) it(nome, () => assert.equal(blocoDaAcao(a, lead, robo), esperado));
});

describe("resumo de bloco: o texto", () => {
  const [fechar, conversar] = BLOCOS;
  const agora = sp(QUARTA, "08:55");
  const leads = new Map<string, Pick<CrmLead, "etapa">>([["site:B", { etapa: "proposta" }]]);

  it("bloco 1 nomeia quem está perto de pagar, conta o resto sem nomes e fecha com o link da Central", () => {
    const fila = [
      acao("negociacao-humana", "combinado", {}, "A"),
      acao("responder", "responder", {}, "B"),
      acao("mandar-proposta", "mandar-proposta", { quente: true }, "C"),
      acao("followup", "followup", {}, "D"),
      acao("responder", "responder", {}, "E"),
    ];
    const aviso = montarResumoDeBloco(fechar, `${QUARTA}|fechar`, fila, leads, agora, { origemCentral: "https://central.test/" });
    validarAviso(aviso);
    assert.equal(textoDoAviso(aviso), [
      "🗓 Bloco 1 · fechar · 09h00–10h30",
      "3 perto de pagar:",
      "• Empresa A: perguntou o preço",
      "• Empresa B: respondeu à proposta",
      "• Empresa C: mandar a proposta",
      "Na Central, fora deste bloco: 1 follow-up · 1 resposta.",
      "https://central.test/crm",
    ].join("\n"));
    assert.equal(aviso.chave, `resumo-de-bloco:${QUARTA}|fechar`);
    assert.equal(aviso.expiraEm, new Date(sp(QUARTA, "10:30")).toISOString());
  });

  it("bloco 2 com as respostas e retomadas", () => {
    const fila = [acao("responder", "responder", {}, "E"), acao("depois-do-link", "depois-do-link", { quente: true }, "F"), acao("cadencia|conversa|x|dia-2", "depois-do-link", {}, "G")];
    const aviso = montarResumoDeBloco(conversar, `${QUARTA}|conversar`, fila, leads, sp(QUARTA, "13:55"));
    assert.equal(textoDoAviso(aviso), [
      "🗓 Bloco 2 · conversar · 14h00–15h30",
      "3 respostas e retomadas pendentes:",
      "• Empresa E: respondeu",
      "• Empresa F: \"o que achou?\" depois do link",
      "• Empresa G: retomar a conversa",
    ].join("\n"));
  });

  it("fila do bloco vazia: mensagem curta 'nada pendente'", () => {
    const aviso = montarResumoDeBloco(fechar, `${QUARTA}|fechar`, [], leads, agora);
    assert.equal(textoDoAviso(aviso), "🗓 Bloco 1 · fechar · 09h00–10h30\nNada perto de pagar na fila agora.");
    const vazio2 = montarResumoDeBloco(conversar, `${QUARTA}|conversar`, [acao("followup", "followup")], leads, agora);
    assert.equal(vazio2.texto, "Nenhuma resposta ou retomada pendente agora.\nNa Central, fora deste bloco: 1 follow-up.");
  });

  it("corta em MAX_NOMES e fica em ~12 linhas", () => {
    const fila = Array.from({ length: 12 }, (_, i) => acao("responder", "responder", {}, `N${i}`));
    const texto = textoDoAviso(montarResumoDeBloco(conversar, `${QUARTA}|conversar`, fila, leads, agora, { origemCentral: "https://central.test" }));
    assert.ok(texto.includes(`…e mais ${12 - MAX_NOMES}`));
    assert.ok(texto.split("\n").length <= 12, texto);
  });

  it("nunca R$, telefone nem id: o porquê da fila (com saldo) não entra e o R$ do nome vira [valor]", () => {
    const fila = [acao("ciclo-comercial", "combinado", { porque: "Saldo: R$ 1.200,00.", empresa: "Loja R$ 10", link: { rotulo: "x", url: "https://wa.me/5511999990000" } })];
    const aviso = montarResumoDeBloco(fechar, `${QUARTA}|fechar`, fila, leads, agora);
    validarAviso(aviso);
    const texto = textoDoAviso(aviso);
    assert.doesNotMatch(texto, /R\s*\$|wa\.me|5511|site:L/);
    assert.match(texto, /Loja \[valor\]: aceite, contrato ou pagamento/);
  });
});

describe("resumo de bloco: a cola no vendedor", () => {
  const conferido = { tipo: "nota", rotulo: "Nota", texto: "[historico-conferido-v1] Conferi a conversa deste lead no WhatsApp.", em: new Date(sp(QUARTA, "08:00")).toISOString(), origem: "manual", fonte: "CRM" } as CrmLead["eventos"][number];
  const respondeu = (id: string): CrmLead => ({
    id: `site:${id}`, chave: id, produto: "site", empresa: `Estúdio ${id}`, etapa: "contato", sinal: "em-conversa", subEtapa: "Respondeu",
    marcos: { enviado: new Date(sp(QUARTA, "08:00") - 86_400_000).toISOString(), respondeu: new Date(sp(QUARTA, "07:30")).toISOString() },
    links: { whatsapp: "https://wa.me/5511999990000" }, eventos: [conferido],
    resposta: { tipo: "neutra", trecho: "Me explica melhor?", em: new Date(sp(QUARTA, "07:30")).toISOString() },
  } as CrmLead);
  const visao = (...leads: CrmLead[]): CrmVisao => ({
    estado: "ok", leads,
    hoje: [{ id: "resposta", titulo: "Responder", explicacao: "", itens: leads.map((l) => ({ leadId: l.id, acao: "Responder", detalhe: "", ordem: 1, links: [] })) }],
  } as unknown as CrmVisao);

  async function montar(agora: { t: number }, ligado = true) {
    const dir = await mkdtemp(join(tmpdir(), "resumo-de-bloco-"));
    const textos: string[] = [];
    const v = visao(respondeu("A"));
    assert.equal(filaDeVenda(v, { primeiroLiberado: false, agora: agora.t })[0]?.tipo, "responder", "o fixture precisa de uma resposta comum");
    const deps = {
      arquivoDeEstado: join(dir, "vendedor.json"), agora: () => agora.t, vendaDoDia: criarMemoriaDaVenda(join(dir, "dia.json"), () => agora.t),
      lerVisao: async () => v, enviar: async (texto: string) => { textos.push(texto); }, registrar: async () => {},
      origemCentral: "https://central.test", resumoDeBloco: ligado,
    };
    return { dir, textos, deps };
  }

  it("às 08h55 o resumo sai antes do aviso, conta no teto, e um reinício não o repete", async () => {
    const agora = { t: sp(QUARTA, "08:55") };
    const { dir, textos, deps } = await montar(agora);
    const vendedor = criarVendedor(deps);
    let reiniciado: ReturnType<typeof criarVendedor> | undefined;
    try {
      await vendedor.volta();
      assert.equal(textos[0], [
        "🗓 Bloco 1 · fechar · 09h00–10h30",
        "Nada perto de pagar na fila agora.",
        "Na Central, fora deste bloco: 1 resposta.",
        "https://central.test/crm",
      ].join("\n"));
      assert.match(textos[1] ?? "", /Estúdio A/, "o aviso da resposta sai depois do resumo");
      const estado = JSON.parse(await readFile(deps.arquivoDeEstado, "utf8"));
      assert.deepEqual(estado.blocosResumidos, [`${QUARTA}|fechar`]);
      assert.equal(estado.avisosHoje, 2, "o resumo conta 1 no teto, o aviso outro");
      agora.t += 3 * min;
      reiniciado = criarVendedor(deps);
      await reiniciado.volta();
      assert.equal(textos.filter((t) => t.startsWith("🗓")).length, 1);
    } finally { vendedor.parar(); reiniciado?.parar(); await rm(dir, { recursive: true, force: true }); }
  });

  it("às 13h55 o bloco 2 nomeia a resposta pendente", async () => {
    const agora = { t: sp(QUARTA, "13:55") };
    const { dir, textos, deps } = await montar(agora);
    const vendedor = criarVendedor(deps);
    try {
      await vendedor.volta();
      assert.equal(textos[0], "🗓 Bloco 2 · conversar · 14h00–15h30\n1 resposta ou retomada pendente:\n• Estúdio A: respondeu\nhttps://central.test/crm");
    } finally { vendedor.parar(); await rm(dir, { recursive: true, force: true }); }
  });

  for (const [nome, antes] of [
    ["o resumo leva o último lugar do teto: o aviso de rotina da mesma volta fica para a Central", MAX_AVISOS_POR_DIA - 1],
    ["com o teto já cheio o resumo sai assim mesmo (2 por dia, em hora marcada)", MAX_AVISOS_POR_DIA],
  ] as const) {
    it(nome, async () => {
      const agora = { t: sp(QUARTA, "08:56") };
      const { dir, textos, deps } = await montar(agora);
      await writeFile(deps.arquivoDeEstado, JSON.stringify({ ...estadoNovo(agora.t), avisosHoje: antes }));
      const vendedor = criarVendedor(deps);
      try {
        const d = await vendedor.volta();
        assert.equal(textos.length, 1);
        assert.match(textos[0], /^🗓 Bloco 1/);
        assert.deepEqual(d, { tipo: "nada", motivo: "teto-do-dia" });
        assert.equal(JSON.parse(await readFile(deps.arquivoDeEstado, "utf8")).avisosHoje, antes + 1);
      } finally { vendedor.parar(); await rm(dir, { recursive: true, force: true }); }
    });
  }

  it("falha do Telegram não marca: a volta seguinte tenta de novo", async () => {
    const agora = { t: sp(QUARTA, "08:55") };
    const { dir, textos, deps } = await montar(agora);
    let falhar = true;
    const vendedor = criarVendedor({ ...deps, enviar: async (texto: string) => { if (falhar && texto.startsWith("🗓")) throw new Error("rede"); textos.push(texto); } });
    try {
      await vendedor.volta();
      assert.equal(textos.filter((t) => t.startsWith("🗓")).length, 0);
      falhar = false;
      agora.t += min;
      await vendedor.volta();
      assert.equal(textos.filter((t) => t.startsWith("🗓")).length, 1);
    } finally { vendedor.parar(); await rm(dir, { recursive: true, force: true }); }
  });

  it("desligado (SQUADONE_RESUMO_DE_BLOCO=false) não manda resumo", async () => {
    const agora = { t: sp(QUARTA, "08:55") };
    const { dir, textos, deps } = await montar(agora, false);
    const vendedor = criarVendedor(deps);
    try {
      await vendedor.volta();
      assert.ok(textos.length >= 1);
      assert.ok(!textos.some((t) => t.startsWith("🗓")));
    } finally { vendedor.parar(); await rm(dir, { recursive: true, force: true }); }
  });
});
