/**
 * O Escritório como mapa da operação: o recorte da jornada de cada sala, o
 * estado de cada robô só pelo status.json e "Sem sinal" sempre que falta a fonte.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CrmLead, CrmVisao, DellCheck, DellStatus } from "../operations/types.ts";
import {
  JORNADA_DAS_SALAS, LIMITE_DE_PARADOS, estadoDoRobo, fonteDoCrm, hrefDaJornada, lerRecorte, operacaoDaSala, temOperacao,
} from "./operacao.ts";

const AGORA = Date.parse("2026-10-15T15:00:00Z");
let seq = 0;
const lead = (extra: Partial<CrmLead> = {}): CrmLead =>
  ({ id: `l${++seq}`, empresa: `Empresa ${seq}`, nicho: "advocacia", produto: "site", etapa: "novo", sinal: "na-fila", marcos: {}, links: {}, followupHoje: false, diasNaEtapa: 0, ...extra }) as unknown as CrmLead;

const respondeu = (dias: number, extra: Partial<CrmLead> = {}) =>
  lead({ etapa: "contato", sinal: "respondeu", resposta: { tipo: "interesse", trecho: "manda" }, diasNaEtapa: dias, ...extra } as Partial<CrmLead>);

const visao = (leads: CrmLead[], geradoEm = "2026-10-15T14:55:00Z"): CrmVisao =>
  ({ estado: "ok", geradoEm, minutosAteVelho: 30, leads }) as unknown as CrmVisao;

const check = (id: string, extra: Partial<DellCheck> = {}): DellCheck => ({ id, grupo: "fluxos", nome: id, estado: "ok", detalhe: "Última execução ok às 06:00", ...extra });
const dell = (verificacoes: DellCheck[], geradoEm: string | null = "2026-10-15T14:59:00Z"): DellStatus => ({ geradoEm, verificacoes });

describe("operação das salas: que pedaço da jornada cada sala mostra", () => {
  it("as seis salas do PRUMO, cada oferta na sala dela", () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(JORNADA_DAS_SALAS).map(([id, j]) => [id, j.recortes.map((r) => r.produto)])),
      {
        "prumo--prospeccao": ["site", "prumo", "iris", "estampa", "plus"],
        "prumo--geral": [null],
        "prumo--site-antes-da-venda": ["site"],
        "prumo--organizar": ["prumo"],
        "prumo--iris": ["iris"],
        "prumo--estamparias": ["estampa"],
      }
    );
  });

  it("a Prospecção vê só o estoque; o Atendimento, só as conversas", () => {
    assert.deepEqual(JORNADA_DAS_SALAS["prumo--prospeccao"].recortes[0].passos, ["achado", "raio-x"]);
    const atendimento = JORNADA_DAS_SALAS["prumo--geral"].recortes[0].passos!;
    assert.ok(atendimento.includes("primeiro-contato") && atendimento.includes("proposta"));
    assert.ok(!atendimento.includes("achado") && !atendimento.includes("ganho") && !atendimento.includes("perdido"));
  });

  it("temOperacao: só as salas do catálogo ou com jornada", () => {
    assert.equal(temOperacao(["geral", "pessoal--financeiro"]), false);
    assert.equal(temOperacao(["geral", "prumo--iris"]), true);
  });
});

describe("operação das salas: o recorte lido", () => {
  const leads = [
    lead(), lead(), lead({ sinal: "pronto" }),
    respondeu(3), respondeu(0), respondeu(5, { produto: "iris" } as Partial<CrmLead>),
    lead({ etapa: "contato", sinal: "enviado", diasNaEtapa: 6 }),
    lead({ etapa: "ganho", sinal: "fechou" }), lead({ etapa: "perdido", sinal: "expirou" }),
    lead({ produto: "plus", plus: { oferta: "site", fixo: false, descricao: "" } } as Partial<CrmLead>),
  ];

  it("a oferta inteira: passos com lead, fechados à parte, só o filtro do produto (Plus fica no filtro dele)", () => {
    const r = lerRecorte({ produto: "site" }, leads);
    assert.equal(r.href, "/crm?ver=jornada&produto=site");
    assert.equal(r.rotulo, "Site antes da venda");
    assert.deepEqual(r.passos.map((p) => [p.passo, p.leads]), [["achado", 2], ["raio-x", 1], ["primeiro-contato", 1], ["resposta", 2]]);
    assert.equal(r.total, 6);
    assert.deepEqual(r.fechados, { ganho: 1, perdido: 1 });
  });

  it("com você e parados: o estoque não conta, esperar o dono não é parado", () => {
    const r = lerRecorte({ produto: "site" }, leads);
    assert.equal(r.comVoce, 2);
    assert.equal(r.parados, 1);
    assert.equal(r.maisParados[0].href, `/crm?ver=jornada&produto=site&lead=${r.maisParados[0].id}`);
    assert.equal(r.maisParados[0].dias, 3);
  });

  it("todas as ofertas, só as conversas (Atendimento)", () => {
    const r = lerRecorte(JORNADA_DAS_SALAS["prumo--geral"].recortes[0], leads);
    assert.equal(r.href, "/crm?ver=jornada");
    assert.equal(r.rotulo, "Todas as ofertas");
    assert.equal(r.total, 4);
    assert.equal(r.fechados, undefined);
    // O mais parado primeiro (a clínica há 5 dias), e não mais que o limite.
    assert.equal(r.parados, 2);
    assert.equal(r.maisParados[0].dias, 5);
    assert.ok(r.maisParados.length <= LIMITE_DE_PARADOS);
  });

  it("o estoque da Prospecção por oferta", () => {
    const [site, , iris, , plus] = JORNADA_DAS_SALAS["prumo--prospeccao"].recortes.map((r) => lerRecorte(r, leads));
    assert.deepEqual([site.total, iris.total, plus.total], [3, 0, 1]);
    assert.equal(site.comVoce, 0);
    assert.equal(iris.passos.length, 0);
  });

  it("hrefDaJornada sem produto e com lead", () => {
    assert.equal(hrefDaJornada(null), "/crm?ver=jornada");
    assert.equal(hrefDaJornada("estampa", "ab c"), "/crm?ver=jornada&produto=estampa&lead=ab+c");
  });
});

describe("operação das salas: a fonte do CRM", () => {
  it("não lido, sem retrato ou com erro: sem sinal (nunca zero leads)", () => {
    assert.equal(fonteDoCrm(null, "", AGORA).estado, "sem-sinal");
    assert.match((fonteDoCrm(null, "HTTP 404", AGORA) as { motivo: string }).motivo, /HTTP 404/);
    const sem = fonteDoCrm({ estado: "sem-retrato", mensagem: "O n8n ainda não gravou o retrato.", minutosAteVelho: 30 } as unknown as CrmVisao, "", AGORA);
    assert.deepEqual(sem, { estado: "sem-sinal", motivo: "O n8n ainda não gravou o retrato." });
  });

  it("retrato velho continua mostrando, marcado como velho", () => {
    const novo = fonteDoCrm(visao([]), "", AGORA);
    assert.ok(novo.estado === "ok" && !novo.velho && novo.idadeMin === 5);
    const velho = fonteDoCrm(visao([], "2026-10-15T14:00:00Z"), "", AGORA);
    assert.ok(velho.estado === "ok" && velho.velho);
  });
});

describe("operação das salas: o estado de cada robô", () => {
  const CASOS: { nome: string; verificacao?: string; dell: DellStatus | null; tom: string; texto: RegExp }[] = [
    { nome: "sem retrato do Dell", verificacao: "fluxo:a", dell: null, tom: "sem_sinal", texto: /^Sem sinal: o retrato do Dell não foi lido/ },
    { nome: "monitor nunca gravou", verificacao: "fluxo:a", dell: dell([check("fluxo:a")], null), tom: "sem_sinal", texto: /ainda não gravou/ },
    { nome: "retrato vencido (mais de 5 min)", verificacao: "fluxo:a", dell: dell([check("fluxo:a")], "2026-10-15T14:40:00Z"), tom: "sem_sinal", texto: /tem 20 min/ },
    { nome: "robô sem verificação", dell: dell([]), tom: "sem_sinal", texto: /não confere este robô/ },
    { nome: "verificação ausente do retrato (fluxo desligado)", verificacao: "fluxo:b", dell: dell([check("fluxo:a")]), tom: "sem_sinal", texto: /não traz este robô/ },
    { nome: "ok", verificacao: "fluxo:a", dell: dell([check("fluxo:a")]), tom: "ok", texto: /^Em dia: Última execução ok às 06:00$/ },
    { nome: "falha", verificacao: "fluxo:a", dell: dell([check("fluxo:a", { estado: "falha", detalhe: "Erro às 06:00" })]), tom: "falha", texto: /^Falhou: Erro às 06:00$/ },
    { nome: "atenção", verificacao: "fluxo:a", dell: dell([check("fluxo:a", { estado: "atencao", detalhe: "1 falha em 24 h" })]), tom: "atencao", texto: /^Vale olhar/ },
    { nome: "resolve sozinho", verificacao: "fluxo:a", dell: dell([check("fluxo:a", { estado: "atencao", sozinho: true, detalhe: "roda quando ligar" })]), tom: "sozinho", texto: /^Resolve sozinho/ },
  ];
  for (const c of CASOS) {
    it(c.nome, () => {
      const e = estadoDoRobo(c.verificacao, c.dell, AGORA);
      assert.equal(e.tom, c.tom);
      assert.match(e.texto, c.texto);
    });
  }
});

describe("operação das salas: a sala inteira", () => {
  const fontes = { crm: fonteDoCrm(visao([respondeu(4, { produto: "iris" } as Partial<CrmLead>)]), "", AGORA), dell: dell([]), agora: AGORA };

  it("sala de fora do PRUMO não mostra nada", () => {
    assert.equal(operacaoDaSala("pessoal--financeiro", fontes), null);
  });

  it("Iris: a jornada da oferta e o caçador, que o monitor não confere (nasceu desligado) = Sem sinal", () => {
    const op = operacaoDaSala("prumo--iris", fontes)!;
    assert.ok(op.jornada?.estado === "ok");
    assert.equal(op.jornada.recortes[0].total, 1);
    assert.deepEqual(op.robos.map((r) => [r.nome, r.tom]), [["Caçador de clínicas", "sem_sinal"]]);
    assert.match(op.robos[0].href, /^\/mais\?fluxo=iris&passo=\d+#como-title$/);
  });

  it("sem o CRM, a jornada diz sem sinal e os robôs seguem", () => {
    const op = operacaoDaSala("prumo--geral", { ...fontes, crm: fonteDoCrm(null, "HTTP 404", AGORA) })!;
    assert.equal(op.jornada?.estado, "sem-sinal");
    assert.ok(op.robos.length >= 1);
  });

  it("sala só com robôs (catálogo de teste) não inventa jornada", () => {
    const op = operacaoDaSala("x--y", fontes, () => [{ id: "r", nome: "R", sala: "x--y", faz: "f", onde: "o", quando: "q", fluxo: "site", passo: 0 }])!;
    assert.equal(op.jornada, null);
    assert.equal(op.robos[0].texto, "Sem sinal: o monitor do Dell não confere este robô");
  });
});
