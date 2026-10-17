import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ESPERA_DO_AVISO_MS, limparAbertos, rodapeDeFora, toqueNoAviso, type AvisoAberto, type DoDia } from "./vendedor.ts";
import type { Resolvida } from "./venda-do-dia.ts";

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
