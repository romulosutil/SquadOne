import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AMOSTRA_MINIMA_DO_NICHO, RegistroInvalido, conferirDesfecho, montarCrm, notaDoGoogle, prioridadeDaTriagem, taxasDeRespostaPorNicho,
  validarRegistro, validarRetrato, type CrmLead, type CrmVisao, type EntradaDaPrioridade,
} from "./crm.ts";
import type { LeadPlus } from "./plus-catalogo.ts";
import { filaDeVenda } from "../src/operations/proxima-venda.ts";

// Ganho e dispensa marcados na Central (17/10/2026, AC-08 e AC-10) e a Prioridade da Triagem.
// Tudo fixture: nenhuma planilha, n8n ou conversa real é tocada.

const AGORA = new Date("2026-10-14T13:00:00Z"); // quarta, 10:00 em São Paulo
const horas = (n: number) => new Date(AGORA.getTime() - n * 3600_000).toISOString();
const dias = (n: number) => horas(n * 24);

const COLUNAS_SITE = ["row_number", "place_id", "nome", "vertical", "cidade", "status", "site_url", "criado_em", "enviado_em", "visto_em", "wa_me"];

function linhaPrumo(id: string, extra: Record<string, string> = {}): Record<string, string> {
  return { row_number: "2", ID: id, Empresa: `Prospect ${id}`, Cidade: "Vitória", Segmento: "psicologia", WhatsApp: "(27) 99999-0001",
    Site: "https://prospect.example", Etapa: "Revisar", "Encontrado em": dias(5), ...extra };
}

// Um lead por oferta, cada um numa fila de trabalho: Site e PRUMO no follow-up do 3º dia, Iris na
// Triagem, estamparia em "Respostas para responder", Plus no follow-up (com o plus_enviado).
function retrato(registros: Array<Record<string, string>>, extra: { estampa?: Record<string, string> } = {}) {
  return validarRetrato({
    versao: 1,
    geradoEm: new Date(AGORA.getTime() - 60_000).toISOString(),
    links: { webhook: "https://dell.exemplo.ts.net/webhook" },
    fontes: {
      site: { aba: "Leads", colunas: COLUNAS_SITE, linhas: [{ row_number: "3", place_id: "S", nome: "Studio S", vertical: "pilates", cidade: "Vitória",
        status: "enviado", site_url: "https://demo-s.vercel.app/", criado_em: dias(10), enviado_em: dias(4), visto_em: dias(3.9),
        wa_me: "https://wa.me/5527999990000?text=oi" }] },
      prumo: { aba: "Prospects", linhas: [linhaPrumo("P", { Etapa: "Convite enviado", "Convite enviado em": dias(4), visto_em: dias(3.9) })] },
      iris: { aba: "Clínicas", linhas: [linhaPrumo("I")] },
      estampa: { aba: "Estamparias", linhas: [linhaPrumo("E", { Etapa: "Em conversa", "Convite enviado em": dias(2), respondeu_em: horas(2), ...extra.estampa })] },
      registros: { aba: "CRM", linhas: [
        { em: dias(4), produto: "plus", id: "p0000000001", tipo: "plus_enviado", texto: "", data: "" },
        ...registros,
      ] },
    },
  });
}

const PLUS: LeadPlus = { id: "p0000000001", empresa: "Empresa 1", nicho: "Contabilidade", cidade: "Vitória", uf: "ES",
  whatsapp: "5527999000001", fixo: false, oferta: "site", descricao: "Contabilidade em geral" };
const ID = { site: "S", prumo: "P", iris: "I", estampa: "E", plus: "p0000000001" } as const;
type Produto = keyof typeof ID;

function visao(registros: Array<Record<string, string>>, extra: { estampa?: Record<string, string> } = {}): CrmVisao {
  return montarCrm(retrato(registros, extra), { agora: AGORA, plus: { geradoEm: dias(10), leads: [PLUS] } });
}
const reg = (produto: Produto, tipo: string, em: string, data = "", texto = "") => ({ em, produto, id: ID[produto], tipo, texto, data });
const leadDe = (v: CrmVisao, produto: Produto): CrmLead => v.leads.find((l) => l.id === `${produto}:${ID[produto]}`)!;
const filasCom = (v: CrmVisao, produto: Produto) => v.hoje.filter((g) => g.itens.some((i) => i.leadId === `${produto}:${ID[produto]}`)).map((g) => g.id);
const naFila = (v: CrmVisao, produto: Produto) =>
  filaDeVenda(v as unknown as Parameters<typeof filaDeVenda>[0], { primeiroLiberado: true, ritmoLivre: true, agora: AGORA.getTime() })
    .some((a) => a.leadId === `${produto}:${ID[produto]}`);

describe("desfecho marcado na Central: o ponto de partida", () => {
  it("sem registro, cada oferta está numa fila de trabalho", () => {
    const v = visao([]);
    assert.deepEqual(Object.fromEntries((Object.keys(ID) as Produto[]).map((p) => [p, filasCom(v, p)])),
      { site: ["followup"], prumo: ["followup"], iris: ["revisar"], estampa: ["resposta"], plus: ["followup"] });
  });
});

describe("ganhou e ganhou_desfeito, em todas as ofertas (AC-08)", () => {
  for (const produto of Object.keys(ID) as Produto[]) {
    it(`${produto}: ganhou vira Ganho marcado na Central e sai de todas as filas`, () => {
      const v = visao([reg(produto, "ganhou", horas(1))]);
      const lead = leadDe(v, produto);
      assert.equal(lead.etapa, "ganho");
      assert.equal(lead.sinal, "fechou");
      assert.equal(lead.subEtapa, "Fechou (marcado na Central)");
      assert.equal(lead.ganhoManual, true);
      assert.equal(lead.perdaManual, undefined);
      assert.equal(lead.followupHoje, false);
      assert.equal(lead.respostaNova, false);
      assert.deepEqual(filasCom(v, produto), []);
      assert.equal(naFila(v, produto), false, "a Próxima venda não oferece nada a quem fechou");
      assert.equal(lead.eventos.at(-1)?.rotulo, "Fechou (marcado na Central)");
    });

    it(`${produto}: ganhou_desfeito depois volta ao que o resto do retrato diz`, () => {
      const base = leadDe(visao([]), produto);
      const v = visao([reg(produto, "ganhou", horas(2)), reg(produto, "ganhou_desfeito", horas(1))]);
      const lead = leadDe(v, produto);
      assert.equal(`${lead.etapa}/${lead.sinal}`, `${base.etapa}/${base.sinal}`);
      assert.equal(lead.ganhoManual, undefined);
      assert.deepEqual(filasCom(v, produto), filasCom(visao([]), produto));
    });
  }

  const casos: Array<{ nome: string; registros: Array<Record<string, string>>; etapa: string; sub: string; ganhoManual?: true; perdaManual?: string }> = [
    { nome: "desfeito antes do ganho: o último vale", registros: [reg("prumo", "ganhou_desfeito", horas(3)), reg("prumo", "ganhou", horas(1))],
      etapa: "ganho", sub: "Fechou (marcado na Central)", ganhoManual: true },
    { nome: "ganhou duas vezes e um desfeito: desfeito", registros: [reg("prumo", "ganhou", horas(3)), reg("prumo", "ganhou", horas(2)), reg("prumo", "ganhou_desfeito", horas(1))],
      etapa: "contato", sub: "Viu o convite, sem resposta" },
    { nome: "recusou e depois ganhou: o ganho, mais novo, vale", registros: [reg("prumo", "recusou", horas(3)), reg("prumo", "ganhou", horas(1))],
      etapa: "ganho", sub: "Fechou (marcado na Central)", ganhoManual: true },
    { nome: "ganhou e depois recusou: a recusa, mais nova, vale", registros: [reg("prumo", "ganhou", horas(3)), reg("prumo", "recusou", horas(1))],
      etapa: "perdido", sub: "Recusou (marcado na Central)", perdaManual: "recusou" },
    { nome: "proposta e depois ganhou: Ganho, não Proposta", registros: [reg("prumo", "proposta", horas(3), "2026-10-13"), reg("prumo", "ganhou", horas(1))],
      etapa: "ganho", sub: "Fechou (marcado na Central)", ganhoManual: true },
  ];
  for (const c of casos) {
    it(c.nome, () => {
      const lead = leadDe(visao(c.registros), "prumo");
      assert.equal(lead.etapa, c.etapa);
      assert.equal(lead.subEtapa, c.sub);
      assert.equal(lead.ganhoManual, c.ganhoManual);
      assert.equal(lead.perdaManual, c.perdaManual);
    });
  }

  it("ganho que a planilha já deu fica o da planilha, sem ganhoManual (nada a desfazer na Central)", () => {
    const lead = leadDe(visao([reg("estampa", "ganhou", horas(1))], { estampa: { Etapa: "Concluído" } }), "estampa");
    assert.equal(lead.subEtapa, "Concluído (Etapa na planilha)");
    assert.equal(lead.ganhoManual, undefined);
  });

  it("fechou ontem, anotado hoje: desde ontem e a ficha diz o dia", () => {
    const lead = leadDe(visao([reg("plus", "ganhou", horas(1), "2026-10-13", "fechou por telefone")]), "plus");
    assert.equal(lead.diasNaEtapa, 1);
    assert.equal(lead.eventos.at(-1)?.texto, "Fechou em 13/10 · fechou por telefone");
  });
});

describe("dispensado e dispensado_desfeito, na Triagem (AC-10)", () => {
  it("dispensado: Perdido, motivo Descartado, sai dos Prospects para revisar", () => {
    const v = visao([reg("iris", "dispensado", horas(1), "2026-10-14")]);
    const lead = leadDe(v, "iris");
    assert.equal(lead.etapa, "perdido");
    assert.equal(lead.sinal, "descartado");
    assert.equal(lead.motivoPerda, "descartado");
    assert.equal(lead.perdaManual, "dispensado");
    assert.equal(lead.subEtapa, "Dispensado na Triagem");
    assert.deepEqual(filasCom(v, "iris"), []);
    assert.equal(v.perdas.descartado, 1);
  });

  it("dispensado_desfeito volta à Triagem", () => {
    const v = visao([reg("iris", "dispensado", horas(2)), reg("iris", "dispensado_desfeito", horas(1))]);
    assert.equal(`${leadDe(v, "iris").etapa}/${leadDe(v, "iris").sinal}`, "novo/revisar");
    assert.equal(leadDe(v, "iris").perdaManual, undefined);
    assert.deepEqual(filasCom(v, "iris"), ["revisar"]);
  });

  it("o desfeito de outro par não desfaz a dispensa", () => {
    const v = visao([reg("iris", "dispensado", horas(2)), reg("iris", "recusou_desfeito", horas(1))]);
    assert.equal(leadDe(v, "iris").perdaManual, "dispensado");
  });

  it("Plus ainda não enviado: dispensado sai do Primeiro contato para enviar", () => {
    const outro: LeadPlus = { ...PLUS, id: "p0000000002", empresa: "Empresa 2", whatsapp: "5527999000002" };
    const v = montarCrm(retrato([{ em: horas(1), produto: "plus", id: outro.id, tipo: "dispensado", texto: "", data: "" }]),
      { agora: AGORA, plus: { geradoEm: dias(10), leads: [PLUS, outro] } });
    const lead = v.leads.find((l) => l.id === `plus:${outro.id}`)!;
    assert.equal(lead.perdaManual, "dispensado");
    assert.equal(v.hoje.find((g) => g.id === "enviar")!.itens.some((i) => i.leadId === lead.id), false);
  });

  it("dispensado e depois ganhou: o ganho vale e a perda some", () => {
    const lead = leadDe(visao([reg("iris", "dispensado", horas(2)), reg("iris", "ganhou", horas(1))]), "iris");
    assert.equal(lead.etapa, "ganho");
    assert.equal(lead.perdaManual, undefined);
    assert.equal(lead.ganhoManual, true);
  });
});

describe("validarRegistro dos quatro tipos", () => {
  const casos: Array<{ tipo: string; texto?: string; data?: string; esperado: { texto: string; data: string } }> = [
    { tipo: "ganhou", esperado: { texto: "", data: "2026-10-14" } },
    { tipo: "ganhou", texto: "fechou o Raio-X", data: "2026-10-10", esperado: { texto: "fechou o Raio-X", data: "2026-10-10" } },
    { tipo: "ganhou_desfeito", esperado: { texto: "", data: "2026-10-14" } },
    { tipo: "dispensado", texto: "é franquia", esperado: { texto: "é franquia", data: "2026-10-14" } },
    { tipo: "dispensado_desfeito", esperado: { texto: "", data: "2026-10-14" } },
  ];
  for (const c of casos) {
    it(`${c.tipo}${c.texto ? " com texto" : ""}${c.data ? " com data" : ""}: texto opcional, dia de hoje em SP se não vier`, () => {
      // 02:00Z do dia 15 ainda é 23:00 do dia 14 em São Paulo: o dia é o de SP, não o do UTC.
      const r = validarRegistro({ produto: "plus", id: "p0000000001", tipo: c.tipo, ...(c.texto ? { texto: c.texto } : {}), ...(c.data ? { data: c.data } : {}) },
        new Date("2026-10-15T02:00:00Z"));
      assert.deepEqual({ texto: r.texto, data: r.data }, c.esperado);
    });
  }
});

describe("conferirDesfecho: quando cada um pode ser marcado", () => {
  const casos: Array<[string, Pick<CrmLead, "etapa" | "perdaManual" | "ganhoManual">, boolean]> = [
    ["ganhou", { etapa: "contato" }, true],
    ["ganhou", { etapa: "perdido" }, true],
    ["ganhou", { etapa: "novo" }, true],
    ["ganhou", { etapa: "ganho" }, false],
    ["ganhou_desfeito", { etapa: "ganho", ganhoManual: true }, true],
    ["ganhou_desfeito", { etapa: "ganho" }, false],
    ["dispensado", { etapa: "novo" }, true],
    ["dispensado", { etapa: "contato" }, false],
    ["dispensado", { etapa: "perdido" }, false],
    ["dispensado_desfeito", { etapa: "perdido", perdaManual: "dispensado" }, true],
    ["dispensado_desfeito", { etapa: "perdido", perdaManual: "recusou" }, false],
  ];
  for (const [tipo, lead, pode] of casos) {
    it(`${tipo} em ${lead.etapa}${lead.ganhoManual ? " (ganho da Central)" : ""}${lead.perdaManual ? ` (${lead.perdaManual})` : ""}: ${pode ? "pode" : "recusa"}`, () => {
      const chamar = () => conferirDesfecho(tipo as Parameters<typeof conferirDesfecho>[0], lead);
      if (pode) assert.doesNotThrow(chamar);
      else assert.throws(chamar, RegistroInvalido);
    });
  }
});

describe("Prioridade da Triagem", () => {
  it("notaDoGoogle lê vírgula, ponto e a contagem", () => {
    assert.deepEqual(notaDoGoogle("4,5 (10)"), { nota: 4.5, avaliacoes: 10 });
    assert.deepEqual(notaDoGoogle("4.8 (312)"), { nota: 4.8, avaliacoes: 312 });
    assert.deepEqual(notaDoGoogle("5"), { nota: 5 });
    assert.deepEqual(notaDoGoogle(""), {});
    assert.deepEqual(notaDoGoogle("sem nota"), {});
  });

  const base: EntradaDaPrioridade = { temSite: true, temWhatsapp: true };
  const casos: Array<[string, EntradaDaPrioridade, number]> = [
    ["só contato e site, nicho sem amostra", base, 40],
    ["4,8 com 300 avaliações tem pouca dor demonstrada", { ...base, nota: "4,8 (300)" }, 42],
    ["5,0 com 2 avaliações tem pouco volume explícito", { ...base, nota: "5 (2)" }, 57],
    ["4,8 com 20 avaliações", { ...base, nota: "4,8 (20)" }, 50],
    ["nota baixa, 3,6 com 80", { ...base, nota: "3,6 (80)" }, 54],
    ["dois sinais do segmento", { ...base, sinais: "convênio · ABA" }, 50],
    ["cinco sinais param em 15", { ...base, sinais: "a · b · c · d · e" }, 55],
    ["as marcas do caçador não são sinal", { ...base, sinais: "perfil não confirmado (sem site) · nenhum sinal no site" }, 40],
    ["quem atende sozinho perde 20", { ...base, sinais: "profissional que atende sozinho? · TEA" }, 25],
    ["WhatsApp não confirmado", { ...base, origemWhatsapp: "não confirmado: celular do Google" }, 23],
    ["sem WhatsApp e sem site", { temSite: false, temWhatsapp: false }, 5],
    ["porte conferido pelo CNPJ", { ...base, porte: "EPP" }, 45],
    ["nicho com interesse em 30% ou mais dos envios", { ...base, taxaDoNicho: 0.4 }, 45],
    ["nicho sem interesse na amostra medida", { ...base, taxaDoNicho: 0 }, 35],
  ];
  for (const [nome, entrada, esperado] of casos) {
    it(`${nome}: ${esperado}`, () => assert.equal(prioridadeDaTriagem(entrada), esperado));
  }

  it("diferencia: 20 prospects diferentes não dão um número só", () => {
    const valores = new Set(Array.from({ length: 20 }, (_, i) => prioridadeDaTriagem({ ...base, nota: `${(3.5 + (i % 6) * 0.3).toFixed(1)} (${i * 17})` })));
    // Nota saudável não diferencia por prestígio; ainda há diversidade de dor, sem saturação em 100.
    assert.ok(valores.size >= 10, `só ${valores.size} valores distintos`);
  });

  it("taxa por nicho só com a amostra mínima, por oferta", () => {
    const lead = (produto: CrmLead["produto"], nicho: string, respondeu: boolean): Pick<CrmLead, "produto" | "nicho" | "marcos" | "resposta"> =>
      ({ produto, nicho, marcos: { enviado: dias(5), ...(respondeu ? { respondeu: dias(4) } : {}) }, ...(respondeu ? { resposta: { tipo: 'licenca', trecho: 'Pode mandar', em: dias(4) } } : {}) });
    const amostra = [
      ...Array.from({ length: AMOSTRA_MINIMA_DO_NICHO }, (_, i) => lead("iris", "Psicólogo", i < 3)),
      ...Array.from({ length: AMOSTRA_MINIMA_DO_NICHO - 1 }, () => lead("iris", "Fonoaudiólogo", true)),
      ...Array.from({ length: AMOSTRA_MINIMA_DO_NICHO }, () => lead("site", "pilates", true)),
    ];
    const taxas = taxasDeRespostaPorNicho(amostra);
    assert.deepEqual([...taxas], [["iris:psicologo", 0.3]]);
  });
  it('dor sobe com nota menor ou contagem menor, mas dado ausente não inventa dor', () => {
    assert.ok(prioridadeDaTriagem({ ...base, nota: '3 (80)' }) > prioridadeDaTriagem({ ...base, nota: '4.9 (80)' }));
    assert.ok(prioridadeDaTriagem({ ...base, nota: '4.8 (2)' }) > prioridadeDaTriagem({ ...base, nota: '4.8 (300)' }));
    assert.equal(prioridadeDaTriagem({ ...base, nota: 'ilegível' }), prioridadeDaTriagem(base));
    assert.ok(prioridadeDaTriagem({ ...base, nota: '0 (0)' }) > prioridadeDaTriagem(base));
    const diferencaDaNota = (n: number) => prioridadeDaTriagem({ ...base, nota: `3 (${n})` }) - prioridadeDaTriagem({ ...base, nota: `4.9 (${n})` });
    assert.ok(diferencaDaNota(1) < diferencaDaNota(20), 'uma avaliação dá pouca evidência para nota baixa');
  });
  it('peso do nicho vem de interesse humano, sem confundir respostas negativas ou robôs', () => {
    const l = (nicho: string, tipo: CrmLead['resposta']['tipo'], produto: CrmLead['produto'] = 'prumo') => ({ produto, nicho,
      marcos: { enviado: dias(5), respondeu: dias(4) }, resposta: { tipo, trecho: tipo === 'licenca' ? 'Pode mandar' : 'Resposta fictícia', em: dias(4) } });
    const amostra = [
      ...Array.from({ length: 10 }, () => l('negativas', 'negativa')),
      ...Array.from({ length: 10 }, (_, i) => l('interesse', i < 3 ? 'interesse' : i < 5 ? 'licenca' : 'bot')),
      ...Array.from({ length: 10 }, () => l('robo', 'bot')),
      ...Array.from({ length: 9 }, () => l('insuficiente', 'interesse')),
      ...Array.from({ length: 10 }, () => l('interesse', 'exclusao', 'iris')),
      ...Array.from({ length: 10 }, () => ({ ...l('classificado-errado', 'interesse'), conversa: { desde: dias(6), mensagens: 1, entradas: { gente: 0, recepcao: 0, robo: 1 }, ultima: { direcao: 'entrada' as const, em: dias(4), trecho: 'Atendimento automático', papel: 'robo' as const } } })),
      ...Array.from({ length: 10 }, () => ({ ...l('robo-sem-contagens', 'interesse'), conversa: { desde: dias(6), mensagens: 1, ultima: { direcao: 'entrada' as const, em: dias(4), trecho: 'Atendimento automático', papel: 'robo' as const } } })),
    ];
    const taxas = taxasDeRespostaPorNicho(amostra);
    assert.equal(taxas.get('prumo:negativas'), 0);
    assert.equal(taxas.get('prumo:interesse'), 0.5);
    assert.equal(taxas.get('prumo:robo'), 0);
    assert.equal(taxas.get('iris:interesse'), 0, 'oferta Iris não recebe resultado de serviços PRUMO');
    assert.equal(taxas.get('prumo:classificado_errado'), 0);
    assert.equal(taxas.get('prumo:robo_sem_contagens'), 0);
    assert.equal(taxas.has('prumo:insuficiente'), false);
    assert.equal(taxasDeRespostaPorNicho([]).size, 0);
  });
});
