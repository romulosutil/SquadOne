import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ESPERA_DO_AVISO_MS, MAX_AVISOS_POR_DIA, decidir, estadoNovo, botoesDoAviso, criarVendedor, conferirDoAviso, limparAbertos, rodapeDeFora, textoDoAviso, toqueNoAviso, type AvisoAberto, type DoDia } from "./vendedor.ts";
import type { Resolvida } from "./venda-do-dia.ts";
import { filaDeVenda, type AcaoDeVenda } from "../src/operations/proxima-venda.ts";
import type { CrmLead, CrmVisao } from "../src/operations/types.ts";
import { acaoInternaComercial } from "../src/operations/acao-interna-comercial.ts";
import { criarMemoriaDaVenda, type MemoriaDaVenda } from "./venda-do-dia.ts";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// AC-06 (17/10/2026): a Central e o Telegram numa fila só. Regras puras, em tabela; a cola com o
// arquivo do dia e o Telegram é exercitada em jornadas-de-venda.test.ts (com o retrato de verdade).

const T = Date.parse("2026-10-14T13:00:00Z");
const min = 60_000;
const aberto = (chave: string, em: number, extra: Partial<AvisoAberto> = {}): AvisoAberto =>
  ({ chave, token: `t-${chave}`, em, leadId: chave.split("|")[0], primeiroContato: false, produto: "site", texto: "aviso", ...extra });
const resolvida = (em: number, como: Resolvida["como"], por?: Resolvida["por"]): Resolvida => ({ em, pulou: como === "pulada", como, ...(por ? { por } : {}) });
const dia = (resolvidas: Record<string, Resolvida> = {}, anotadas: DoDia["anotadas"] = {}): DoDia => ({ resolvidas, anotadas, primeiros: {} });

describe("vendedor: fechar o aviso aberto que se resolveu fora", () => {
  const casos: Array<{ nome: string; a: AvisoAberto; naFila: boolean; r?: Resolvida; agora: number; onde: "ficam" | "fora" | "expirados" | "sairam" }> = [
    { nome: "aberto, na fila, sem nada: fica", a: aberto("site:L|followup", T), naFila: true, agora: T + 5 * min, onde: "ficam" },
    { nome: "a Central fez depois do aviso: fecha por fora", a: aberto("site:L|followup", T), naFila: true, r: resolvida(T + min, "enviada", "central"), agora: T + 2 * min, onde: "fora" },
    { nome: "a Central pulou depois do aviso: fecha por fora", a: aberto("site:L|followup", T), naFila: true, r: resolvida(T + min, "pulada", "central"), agora: T + 2 * min, onde: "fora" },
    { nome: "formato antigo, sem por, depois do aviso: fecha por fora", a: aberto("site:L|followup", T), naFila: true, r: resolvida(T + min, "enviada"), agora: T + 2 * min, onde: "fora" },
    { nome: "pulado na Central ANTES do aviso: a ação voltou do fim, fica", a: aberto("site:L|followup", T), naFila: true, r: resolvida(T - 10 * min, "pulada", "central"), agora: T + 2 * min, onde: "ficam" },
    { nome: "resolvido por fora vence o 'saiu da fila'", a: aberto("site:L|followup", T), naFila: false, r: resolvida(T + min, "enviada", "central"), agora: T + 2 * min, onde: "fora" },
    { nome: "resolvido por fora vence o 'expirou'", a: aberto("site:L|followup", T), naFila: true, r: resolvida(T + min, "enviada", "central"), agora: T + ESPERA_DO_AVISO_MS + 1, onde: "fora" },
    { nome: "saiu da fila (o retrato confirmou)", a: aberto("site:L|followup", T), naFila: false, agora: T + 2 * min, onde: "sairam" },
    { nome: "30 min sem toque: expirou", a: aberto("site:L|followup", T), naFila: true, agora: T + ESPERA_DO_AVISO_MS, onde: "expirados" },
    { nome: "a marca do próprio 'expirou' não fecha por fora", a: aberto("site:L|followup", T), naFila: true, r: resolvida(T + min, "pulada", "expirou"), agora: T + 2 * min, onde: "ficam" },
  ];
  for (const c of casos) {
    it(c.nome, () => {
      const { ficam, fechados } = limparAbertos([c.a], new Set(c.naFila ? [c.a.chave] : []), c.r ? { [c.a.chave]: c.r } : {}, c.agora);
      const onde = ficam.length ? "ficam" : fechados.fora.length ? "fora" : fechados.expirados.length ? "expirados" : "sairam";
      assert.equal(onde, c.onde);
      assert.equal(ficam.length + fechados.fora.length + fechados.expirados.length + fechados.sairam.length, 1);
    });
  }

  it("o rodapé diz onde e como", () => {
    const casos: Array<[Pick<Resolvida, "como" | "por">, string]> = [
      [{ como: "enviada", por: "central" }, "✅ Feito na Central."],
      [{ como: "pulada", por: "central" }, "⏭ Pulado na Central."],
      [{ como: "recusa", por: "central" }, "✅ Recusa marcada na Central."],
      [{ como: "enviada" }, "✅ Feito na Central."],
      [{ como: "enviada", por: "telegram" }, "✅ Feito."],
    ];
    for (const [r, texto] of casos) assert.equal(rodapeDeFora(r), texto, JSON.stringify(r));
  });
});

describe("vendedor: o toque atrasado e a anotação uma vez só", () => {
  const chave = "site:L|followup";
  const a = aberto(chave, T, { anota: "followup_enviado", tipo: "followup" });
  const casos: Array<{ nome: string; acao: "enviei" | "pular"; doDia: DoDia | null; esperado: ReturnType<typeof toqueNoAviso>; aviso?: AvisoAberto }> = [
    { nome: "nada por fora: Enviei anota", acao: "enviei", doDia: dia(), esperado: { tipo: "seguir", como: "enviada", anotar: true } },
    { nome: "sem o servidor do dia: Enviei anota (como antes)", acao: "enviei", doDia: null, esperado: { tipo: "seguir", como: "enviada", anotar: true } },
    { nome: "nada por fora: Pular não anota", acao: "pular", doDia: dia(), esperado: { tipo: "seguir", como: "pulada", anotar: false } },
    {
      nome: "a Central fez depois do aviso: Já estava feito, sem anotar", acao: "enviei",
      doDia: dia({ [chave]: resolvida(T + min, "enviada", "central") }, { [chave]: [{ tipo: "followup_enviado", em: T + min, por: "central" }] }),
      esperado: { tipo: "ja-feito", curto: "Já estava feito.", rodape: "✅ Feito na Central." },
    },
    {
      nome: "a Central fez e o toque é Pular: também já estava feito", acao: "pular",
      doDia: dia({ [chave]: resolvida(T + min, "enviada", "central") }),
      esperado: { tipo: "ja-feito", curto: "Já estava feito.", rodape: "✅ Feito na Central." },
    },
    {
      nome: "a Central pulou e o toque é Pular: já estava pulado", acao: "pular",
      doDia: dia({ [chave]: resolvida(T + min, "pulada", "central") }),
      esperado: { tipo: "ja-feito", curto: "Já estava pulado.", rodape: "⏭ Pulado na Central." },
    },
    {
      nome: "a Central pulou e ele mandou mesmo: vale o Enviei, e anota", acao: "enviei",
      doDia: dia({ [chave]: resolvida(T + min, "pulada", "central") }),
      esperado: { tipo: "seguir", como: "enviada", anotar: true },
    },
    {
      nome: "a Central só anotou no toque do link (sem 'Enviei, próxima'): Enviei não anota de novo", acao: "enviei",
      doDia: dia({}, { [chave]: [{ tipo: "followup_enviado", em: T + min, por: "central" }] }),
      esperado: { tipo: "seguir", como: "enviada", anotar: false },
    },
    {
      nome: "outra anotação na mesma ação não segura esta", acao: "enviei",
      doDia: dia({}, { [chave]: [{ tipo: "proposta", em: T + min, por: "central" }] }),
      esperado: { tipo: "seguir", como: "enviada", anotar: true },
    },
    {
      nome: "resolvida antes do aviso não conta como feita por fora", acao: "enviei",
      doDia: dia({ [chave]: resolvida(T - min, "enviada", "central") }),
      esperado: { tipo: "seguir", como: "enviada", anotar: true },
    },
    {
      nome: "o desfecho vira recusa", acao: "enviei", aviso: aberto("site:L|desfecho", T, { anota: "recusou", tipo: "desfecho" }), doDia: dia(),
      esperado: { tipo: "seguir", como: "recusa", anotar: true },
    },
  ];
  for (const c of casos) it(c.nome, () => assert.deepEqual(toqueNoAviso(c.aviso ?? a, c.acao, c.doDia), c.esperado));
});

// O gate de envio sobre o rascunho do aviso (17/10/2026): copiloto bloqueia, esteira avisa, o número errado bloqueia sempre.
describe("vendedor: o gate de envio sobre o rascunho", () => {
  const acao = (extra: Partial<AcaoDeVenda> = {}): AcaoDeVenda => ({
    chave: "site:L|followup", leadId: "site:L", empresa: "Clínica Alfa", produto: "site", tipo: "followup", titulo: "Follow-up para Clínica Alfa",
    contexto: "Site · clínica · Vitória", porque: "Leu e não respondeu.", tatica: "Uma linha só.", primeiroContato: false, quente: false,
    rascunho: "Oi, é o Rômulo de novo. Deu para ver a demonstração de site da Clínica Alfa?", ...extra,
  });
  const copiloto = { porque: "leu a conversa", quando: "agora" };

  it("sem rascunho não há o que conferir", () => assert.equal(conferirDoAviso(acao({ rascunho: undefined })), null));
  it("texto da esteira limpo: ok", () => assert.equal(conferirDoAviso(acao())?.ok, true));
  it("texto da esteira com marca sem preencher: avisa, não bloqueia", () => {
    const r = conferirDoAviso(acao({ rascunho: "Oi, é o Rômulo de novo. Deu para ver a demonstração de site da {NOME}?" }))!;
    assert.equal(r.ok, false);
    assert.equal(r.bloqueia, false);
    assert.equal(r.modo, "avisar");
  });
  it("mensagem do copiloto com problema: bloqueia", () => {
    const r = conferirDoAviso(acao({ copiloto, rascunho: "Espero que esteja bem! Posso mandar o link?" }))!;
    assert.equal(r.bloqueia, true);
    assert.equal(r.modo, "bloquear");
  });
  it("o link para outro número que o do registro bloqueia até a esteira", () => {
    const link = { rotulo: "Abrir", url: "https://wa.me/5511988880001?text=oi" };
    assert.equal(conferirDoAviso(acao({ link }), "https://wa.me/5511988880002")?.bloqueia, true);
    assert.equal(conferirDoAviso(acao({ link }), "https://wa.me/5511988880001")?.ok, true);
    assert.equal(conferirDoAviso(acao({ link }), undefined)?.ok, true);
  });
  it("o reenvio do só-robô é conferido como reenvio (sem link no texto)", () => {
    const r = conferirDoAviso(acao({ primeiroContato: true, rascunho: "Oi, tudo bem? Veja https://demo.vercel.app" }))!;
    assert.ok(r.problemas.some((p) => p.codigo === "links_demais"));
  });
  it("o texto do Telegram leva a linha Confira só quando o gate achou algo", () => {
    assert.ok(!textoDoAviso(acao(), []).includes("Confira antes de enviar"));
    assert.ok(textoDoAviso(acao(), [], "marca sem preencher: {NOME}").includes("⚠ Confira antes de enviar: marca sem preencher: {NOME}."));
  });
});


describe("vendedor: passagem comercial interna sem confirmação de envio", () => {
  const interna = (sufixo = "negociacao-humana"): AcaoDeVenda => ({
    chave: `site:qa|${sufixo}`, leadId: "site:qa", empresa: "Empresa QA", produto: "site", tipo: "combinado", titulo: "Rômulo: conduza a conversa",
    contexto: "Conferência comercial", porque: "Pedido de preço", tatica: "Abra a ficha para conferir", primeiroContato: false, quente: true,
    rascunho: "RASCUNHO_ANTIGO_PRIVADO", link: { rotulo: "Mensagem antiga", url: "https://wa.me/5511999999999?text=antigo" }, anota: "proposta",
  })
  const cliente = (id: string, preco = true): CrmLead => ({
    id: `site:${id}`, chave: id, produto: "site", empresa: id, etapa: "contato", sinal: "em-conversa", subEtapa: "Respondeu",
    marcos: { enviado: "2026-10-13T13:00:00Z", respondeu: new Date(T).toISOString() }, eventos: [], links: { whatsapp: "https://wa.me/5511999999999" },
    resposta: { tipo: "neutra", trecho: preco ? "Quanto custa?" : "Obrigado", em: new Date(T).toISOString() },
  } as CrmLead)
  const visao = (...leads: CrmLead[]): CrmVisao => ({ estado: "ok", leads, hoje: [{ id: "resposta", titulo: "Responder", explicacao: "", itens: leads.map(l => ({ leadId: l.id, acao: "Responder", detalhe: "", ordem: 1, links: [] })) }] } as unknown as CrmVisao)

  it("negociação, qualificação, ciclo e revisão oferecem só Central/Pular, mesmo com rascunho antigo", () => {
    for (const sufixo of ["negociacao-humana", "qualificacao-comercial", "ciclo-comercial", "revisao", "atendimento-comercial"]) {
      const a = { ...interna(sufixo), ...(sufixo === "revisao" ? { revisao: true } : {}), ...(sufixo === "atendimento-comercial" ? { interna: true } : {}) }
      const botoes = botoesDoAviso(a, "token-qa", "https://central.test/")
      assert.deepEqual(botoes.map(l => l.map(b => b.texto)), [["Abrir Central"], ["Pular"]])
      assert.doesNotMatch(JSON.stringify(botoes), /wa\.me|enviei/)
      assert.match(JSON.stringify(botoes), /central\.test\/crm/)
      assert.equal(conferirDoAviso(a, "https://wa.me/5511999990000"), null)
      const texto = textoDoAviso(a, [])
      assert.doesNotMatch(texto, /RASCUNHO_ANTIGO_PRIVADO|Mensagem pronta|Sem texto pronto: escreva à mão/)
      assert.match(texto, /Encaminhamento interno/)
    }
    assert.deepEqual(botoesDoAviso(interna(), "token-qa").map(l => l.map(b => b.texto)), [["Pular"]])
  })
  it("combinado legítimo mantém abertura do WhatsApp e confirmação explícita de envio", () => {
    const a = { ...interna(), chave: "site:qa|proximo-passo|2026-10-14" }
    assert.equal(acaoInternaComercial(a), false)
    const botoes = botoesDoAviso(a, "token-qa", "https://central.test")
    assert.ok(botoes.flat().some(b => b.texto === "✓ Enviei"))
    assert.match(JSON.stringify(botoes), /wa\.me/)
  })
  it("toque puro rejeita Enviei atrasado sem converter tarefa interna em envio", () => {
    for (const tipo of [undefined, "combinado"] as const) {
      const a = aberto("site:qa|ciclo-comercial", T, { tipo, anota: "proposta" })
      assert.equal(toqueNoAviso(a, "enviei", dia()).tipo, "bloqueado")
      assert.deepEqual(toqueNoAviso(a, "pular", dia()), { tipo: "seguir", como: "pulada", anotar: false })
    }
    assert.equal(toqueNoAviso(aberto("site:qa|atendimento-comercial", T, { tipo: "combinado", interna: true }), "enviei", dia()).tipo, "bloqueado")
  })
  it("pedido comercial quente ultrapassa aviso aberto e teto sem reavisar a mesma chave", () => {
    const v = visao(cliente("primeiro"), cliente("segundo")), f = filaDeVenda(v, { primeiroLiberado: false, agora: T })
    assert.equal(f.filter(a => acaoInternaComercial(a) && a.quente).length, 2)
    const chave = f[0].chave, e = { ...estadoNovo(T), avisosHoje: MAX_AVISOS_POR_DIA, avisados: [chave], abertos: [aberto(chave, T, { tipo: "combinado", interna: true })] }
    const r = decidir(v, e, T, undefined, dia())
    assert.equal(r.decisao.tipo, "avisar")
    if (r.decisao.tipo !== "avisar") return
    assert.equal(r.decisao.acao.leadId, "site:segundo")
    const vistos = { ...r.estado, avisados: [...r.estado.avisados, r.decisao.acao.chave] }
    assert.notEqual(decidir(v, vistos, T + min, undefined, dia()).decisao.tipo, "avisar")
  })
  it("passagem quente tem prioridade sobre uma resposta comum sem relaxar o silêncio noturno", () => {
    const v = visao(cliente("comum", false), cliente("comercial"))
    const r = decidir(v, estadoNovo(T), T, undefined, dia())
    assert.equal(r.decisao.tipo, "avisar")
    if (r.decisao.tipo === "avisar") assert.equal(r.decisao.acao.leadId, "site:comercial")
    const noite = Date.parse("2026-10-15T02:00:00Z")
    assert.equal(decidir(v, estadoNovo(noite), noite, undefined, dia()).decisao.tipo, "nada")
  })
  it("callback persistido Enviei interno não altera arquivo, contadores, CRM ou memória do dia", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vendedor-interno-"))
    const arquivo = join(dir, "vendedor.json"), e = { ...estadoNovo(T), enviadosHoje: 7, avisados: ["site:qa|atendimento-comercial"], abertos: [aberto("site:qa|atendimento-comercial", T, { token: "antigo", tipo: "combinado", interna: true, anota: "proposta" })] }
    await writeFile(arquivo, JSON.stringify(e))
    let registros = 0, leituraDia = 0, resolucoes = 0, avisos = 0
    const memoria = { ler: async () => { leituraDia++; throw new Error("Não deve ler") }, resolver: async () => { resolucoes++ } } as unknown as MemoriaDaVenda
    const vendedor = criarVendedor({ arquivoDeEstado: arquivo, agora: () => T, vendaDoDia: memoria, lerVisao: async () => visao(cliente("qa")), enviar: async () => { avisos++ }, registrar: async () => { registros++ } })
    try {
      const antes = await readFile(arquivo, "utf8"), resposta = await vendedor.tocar("antigo", "enviei")
      assert.match(resposta.curto, /interno/)
      assert.equal(await readFile(arquivo, "utf8"), antes)
      assert.equal(registros, 0); assert.equal(leituraDia, 0); assert.equal(resolucoes, 0); assert.equal(avisos, 0)
    } finally { vendedor.parar(); await rm(dir, { recursive: true, force: true }) }
  })
  it("voltas sucessivas anunciam o encaminhamento uma só vez e conservam a flag após reiniciar", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vendedor-handoff-")), arquivo = join(dir, "vendedor.json"), v = visao(cliente("qa"))
    const memoria = criarMemoriaDaVenda(join(dir, "dia.json"), () => T)
    let avisos = 0, registros = 0
    const deps = { arquivoDeEstado: arquivo, agora: () => T, vendaDoDia: memoria, lerVisao: async () => v, enviar: async (_texto: string, botoes: import("./telegram.ts").Botao[][]) => { avisos++; assert.doesNotMatch(JSON.stringify(botoes), /wa\.me|enviei/) }, registrar: async () => { registros++ }, origemCentral: "https://central.test" }
    const vendedor = criarVendedor(deps)
    let reiniciado: ReturnType<typeof criarVendedor> | undefined
    try {
      assert.equal((await vendedor.volta()).tipo, "avisar")
      await vendedor.volta()
      const estado = JSON.parse(await readFile(arquivo, "utf8"))
      assert.equal(estado.abertos[0].interna, true)
      assert.equal(estado.abertos[0].anota, undefined)
      reiniciado = criarVendedor(deps); await reiniciado.volta()
      assert.equal(avisos, 1); assert.equal(registros, 0); assert.equal(estado.enviadosHoje, 0)
    } finally { vendedor.parar(); reiniciado?.parar(); await rm(dir, { recursive: true, force: true }) }
  })
})
