import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chaveDoNumero, lerLinhasDaConversa, resumirConversa, type MensagemDaConversa } from "./conversa-do-lead.ts";
import { montarCrm, validarRetrato, type CrmLead, type CrmVisao } from "./crm.ts";
import { filaDeVenda } from "../src/operations/proxima-venda.ts";
import { quisVer } from "../src/operations/resultados.ts";

// O caso Baobá (Iris, 17/10/2026), de ponta a ponta pelo retrato de verdade (montarCrm) e pela fila de
// venda. O lead mandou um ÁUDIO; o Rômulo perguntou "posso de toda forma mandar o vídeo? Sem
// compromisso nenhum"; a recepção respondeu "*[Patricia Adriano]* CLaro, pode enviar sim."; o n8n
// leu "interesse" e o cartão disse "disse sim: combine a demonstração"; o vídeo saiu como mídia e o
// cartão seguiu em "responder". Tudo fixture: nenhuma planilha, conversa ou n8n real é tocado.

const AGORA = new Date("2026-10-17T15:00:00Z"); // sexta, 12:00 em São Paulo
const horas = (n: number, agora = AGORA) => new Date(agora.getTime() - n * 3600_000).toISOString();
const WHATSAPP = "(27) 99999-0001";
const CHAVE = chaveDoNumero("5527999990001");

const msg = (h: number, direcao: "entrada" | "saida", texto: string, agora = AGORA): MensagemDaConversa => ({ em: horas(h, agora), direcao, texto });
/** A conversa da Baobá até a licença (horas antes de AGORA). */
const ATE_A_LICENCA = [
  msg(96, "saida", "Oi! Aqui é o Rômulo, do Iris. Posso te mostrar como fica o prontuário?"),
  msg(72, "entrada", "[áudio 27s]"),
  msg(25, "saida", "Posso de toda forma mandar o vídeo? Sem compromisso nenhum"),
  msg(24, "entrada", "*[Patricia Adriano]* CLaro, pode enviar sim."),
];
const VIDEO = msg(23, "saida", "[vídeo]");

function visaoCom(tipo: "interesse" | "licenca", conversa: MensagemDaConversa[], agora = AGORA, linha: Record<string, string> = {}): CrmVisao {
  const retrato = validarRetrato({
    versao: 1,
    geradoEm: new Date(agora.getTime() - 60_000).toISOString(),
    links: { webhook: "https://dell.exemplo.ts.net/webhook" },
    fontes: {
      iris: { aba: "Clínicas", linhas: [{ row_number: "2", ID: "B", Empresa: "Baobá", Cidade: "Vitória", Segmento: "psicologia", WhatsApp: WHATSAPP,
        Etapa: "Em conversa", "Encontrado em": horas(200), "Convite enviado em": horas(96), respondeu_em: horas(72),
        "Tipo da resposta": tipo, Resposta: "*[Patricia Adriano]* CLaro, pode enviar sim.", "Resposta em": horas(24), ...linha }] },
      registros: { aba: "CRM", linhas: [] },
    },
  });
  return montarCrm(retrato, { agora, conversas: new Map([[CHAVE, conversa]]) });
}
const leadDe = (v: CrmVisao): CrmLead => v.leads.find((l) => l.id === "iris:B")!;
const fila = (v: CrmVisao, agora = AGORA) => filaDeVenda(v as unknown as Parameters<typeof filaDeVenda>[0], { primeiroLiberado: true, agora: agora.getTime() })
  .filter((a) => a.leadId === "iris:B");

describe("a leitura da conversa: papel, áudio e material", () => {
  it("o arquivo traz o papel gravado; sem ele, o texto decide; valor fora do contrato cai no texto", () => {
    const linhas = [
      { em: horas(3), direcao: "entrada", texto: "pode falar", papel: "recepcao" },
      { em: horas(2), direcao: "entrada", texto: "[Atendimento] Olá! Em breve retornaremos" },
      { em: horas(1), direcao: "entrada", texto: "*[Patricia Adriano]* CLaro, pode enviar sim.", papel: "gerente" },
      { em: horas(0.5), direcao: "saida", texto: "*[Rômulo]* obrigado", papel: "robo" },
      { em: horas(0.2), direcao: "entrada", texto: "[áudio 27s]" },
    ].map((l) => JSON.stringify(l)).join("\n");
    assert.deepEqual(lerLinhasDaConversa(linhas).map((m) => m.papel ?? "gente"), ["recepcao", "robo", "recepcao", "gente", "gente"]);
  });

  it("o resumo: o robô não é a última de gente; o vídeo nosso é o link", () => {
    const r = resumirConversa([...ATE_A_LICENCA, msg(23.5, "entrada", "[Bot] Obrigado pelo contato!"), VIDEO])!;
    assert.equal(r.ultimaEntrada, horas(24));
    assert.equal(r.ultimaEntradaRobo, horas(23.5));
    assert.deepEqual(r.entradas, { gente: 1, recepcao: 1, robo: 1 });
    assert.equal(r.linkEm, horas(23));
    assert.equal(r.ultima.direcao, "saida");
  });
});

describe("a Baobá antes do vídeo", () => {
  it("licença: a fila manda o que ele autorizou, nunca 'disse sim'; o cartão diz 'Respondeu ontem' (a última, não a primeira)", () => {
    const v = visaoCom("licenca", ATE_A_LICENCA);
    const lead = leadDe(v);
    assert.equal(lead.marcos.respondeu, horas(72), "o marco do funil segue o da primeira resposta");
    assert.ok(lead.interesseParado, "a licença espera o material como o interesse");
    const item = v.hoje.find((g) => g.id === "resposta")!.itens.find((i) => i.leadId === "iris:B")!;
    assert.match(item.detalhe, /^Respondeu ontem\./);
    assert.match(item.acao, /^Deixou mandar há 1 dia — o que ele autorizou ainda não foi mandado$/);
    const [a] = fila(v);
    assert.equal(a.tipo, "responder");
    assert.equal(a.titulo, "Mande para Baobá o que ele autorizou");
    assert.doesNotMatch(`${a.titulo} ${a.tatica}`, /disse sim|demonstração/);
    assert.equal(a.quente, true, "esperando há mais de 2 h é urgente");
    assert.equal(a.conversa, "Última mensagem: a recepção, há 24 h: “*[Patricia Adriano]* CLaro, pode enviar sim.”");
    // Revisão de 17/10/2026: a licença conta como "quero ver" nas métricas (pedeMaterial); só a frase e a tática mudam.
    assert.equal(quisVer(lead as never), true, "a licença conta no 'quero ver' como o interesse contava");
  });

  it("o 'Respondeu ontem' também vale para o interesse do n8n", () => {
    const item = visaoCom("interesse", ATE_A_LICENCA).hoje.find((g) => g.id === "resposta")!.itens.find((i) => i.leadId === "iris:B")!;
    assert.match(item.detalhe, /^Respondeu ontem\./);
  });

  it("você respondeu com texto e o vídeo ainda não saiu: 'Você já respondeu', nunca 'disse sim'", () => {
    const conversa = [...ATE_A_LICENCA, msg(23.5, "saida", "Claro! Já te mando.")];
    for (const tipo of ["interesse", "licenca"] as const) {
      const v = visaoCom(tipo, conversa);
      const [a] = fila(v);
      assert.equal(a?.tipo, "responder", tipo);
      assert.match(a.titulo, /^Você já respondeu a Baobá; falta/, tipo);
      assert.doesNotMatch(a.titulo, /disse sim/, tipo);
      assert.match(a.tatica, /^Você já respondeu/, tipo);
      const item = v.hoje.find((g) => g.id === "resposta")!.itens.find((i) => i.leadId === "iris:B")!;
      assert.match(item.detalhe, /A última mensagem da conversa é sua\./, tipo);
    }
  });
});

describe("a Baobá depois do vídeo", () => {
  for (const tipo of ["interesse", "licenca"] as const) {
    it(`${tipo}: o vídeo é a 2ª mensagem; no dia seguinte, "pergunte o que achou", sem "disse sim"`, () => {
      const v = visaoCom(tipo, [...ATE_A_LICENCA, VIDEO]);
      const lead = leadDe(v);
      assert.equal(lead.interesseParado, undefined);
      assert.equal(lead.marcos.segundaEnviada, horas(23));
      assert.equal(lead.respostaNova, false);
      assert.equal(v.hoje.find((g) => g.id === "resposta")?.itens.some((i) => i.leadId === "iris:B") ?? false, false);
      const acoes = fila(v);
      assert.deepEqual(acoes.map((a) => a.tipo), ["depois-do-link"]);
      assert.equal(acoes[0].titulo, "Pergunte a Baobá o que achou");
      assert.equal(acoes[0].rascunho, "Oi! Conseguiu dar uma olhada no que te mandei? O que achou?");
      assert.ok(acoes.every((a) => !/disse sim/.test(a.titulo)));
    });
  }

  it("logo depois do vídeo, nada a fazer (a vez é dele); o 'o que achou?' só a partir de 20 h", () => {
    const logo = new Date(Date.parse(horas(22)));
    assert.deepEqual(fila(visaoCom("licenca", [...ATE_A_LICENCA, VIDEO], logo), logo), []);
  });
});

describe("o prazo de Perdido: robô não recomeça, recepção recomeça", () => {
  const RESPOSTA_VELHA = { respondeu_em: horas(216), "Tipo da resposta": "neutra", Resposta: "do que se trata?", "Resposta em": horas(216), "Convite enviado em": horas(240) };
  const conversa = (ultima: string) => [
    msg(216, "entrada", "do que se trata?"),
    msg(215, "saida", "Aqui é o Rômulo, do Iris: um prontuário para clínicas."),
    msg(24, "entrada", ultima),
  ];
  const CASOS: Array<[string, string, string, number | undefined]> = [
    ["o robô respondeu ontem: 9 dias sem gente, Perdido", "[Atendimento] Olá! Nosso horário é das 8h às 18h.", "perdido", undefined],
    ["a recepção respondeu ontem: segue Em contato", "*[Ana]* Oi, pode falar comigo", "contato", 6],
    ["o lead respondeu ontem: segue Em contato", "Oi, pode falar", "contato", 6],
  ];
  for (const [nome, ultima, etapa, diasParaSair] of CASOS) {
    it(nome, () => {
      const lead = leadDe(visaoCom("licenca", conversa(ultima), AGORA, RESPOSTA_VELHA));
      assert.equal(lead.etapa, etapa);
      assert.equal(lead.diasParaSair, diasParaSair);
    });
  }
});
