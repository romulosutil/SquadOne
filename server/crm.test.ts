import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { PastaDoLead } from "./auto-production.ts";
import {
  CrmStore,
  RegistroFalhou,
  RegistroIndisponivel,
  RegistroInvalido,
  configDoCrm,
  montarCrm,
  dataNaProximaAcao,
  validarRegistro,
  validarRetrato,
  type CrmLead,
  type CrmRetrato,
} from "./crm.ts";

// Tudo aqui é fixture: nenhuma planilha, pasta ou n8n real é tocado.
const AGORA = new Date("2026-10-02T15:00:00Z"); // 12:00 em São Paulo
const WEBHOOK = "https://dell.exemplo.ts.net/webhook";
const dias = (n: number) => new Date(AGORA.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const COLUNAS_SITE = ["row_number", "place_id", "nome", "vertical", "cidade", "status", "site_url", "criado_em", "enviado_em",
  "visto_em", "respondeu_em", "followup_em", "recusado_em", "fechado_em", "acoes_link", "wa_link", "wa_me"];

function linhaSite(placeId: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...Object.fromEntries(COLUNAS_SITE.map((c) => [c, ""])), row_number: "7", place_id: placeId, nome: `Empresa ${placeId}`,
    vertical: "pilates", cidade: "Guarapari", criado_em: dias(20), ...extra };
}

function linhaPrumo(id: string, extra: Record<string, string> = {}): Record<string, string> {
  return { row_number: "2", ID: id, Empresa: `Prospect ${id}`, Cidade: "Osasco/SP", Segmento: "distribuidora", WhatsApp: "(11) 90000-0000",
    Site: "https://prospect.example", Etapa: "Revisar", "Próxima ação": "", "Encontrado em": dias(5), "Convite enviado em": "",
    "Diagnóstico em": "", "Índice PRUMO": "", ...extra };
}

function pasta(slug: string, lugar: PastaDoLead["lugar"], placeId: string, publicado = true, extra: Partial<PastaDoLead> = {}): PastaDoLead {
  return {
    slug, lugar, placeId,
    artefatos: { conteudo: true, fotos: publicado ? 0 : 3, capa: !publicado, gerado: publicado, publicado, falha: false },
    alteradaEm: dias(1),
    ...(publicado ? { publicadoEm: dias(6), siteUrl: `https://demo-${slug}.vercel.app/` } : {}),
    ...extra,
  };
}

function retrato(): CrmRetrato {
  return validarRetrato({
    versao: 1,
    geradoEm: new Date(AGORA.getTime() - 5 * 60_000).toISOString(),
    links: { webhook: WEBHOOK, planilhaSite: "https://docs.google.com/spreadsheets/d/site/edit#gid=1", planilhaPrumo: "https://docs.google.com/spreadsheets/d/prumo/edit#gid=2" },
    fontes: {
      site: {
        planilha: "Leads — Site antes da venda", aba: "Leads", colunas: COLUNAS_SITE,
        linhas: [
          linhaSite("TESTE", { status: "descartado" }),
          linhaSite("fila", { status: "novo" }),
          linhaSite("pronto", { status: "pronto", site_url: "https://demo-pronto.vercel.app", wa_link: `${WEBHOOK}/enviar?place_id=pronto`, wa_me: "https://wa.me/5527999990000?text=oi" }),
          linhaSite("pronto-sem-pasta", { status: "pronto", site_url: "https://demo-x.vercel.app" }),
          linhaSite("followup", { status: "enviado", enviado_em: dias(3), wa_me: "https://wa.me/5527999990001?text=oi" }),
          linhaSite("followup-ontem", { status: "enviado", enviado_em: dias(4), followup_em: dias(1) }),
          linhaSite("viu", { status: "enviado", enviado_em: dias(1), visto_em: dias(0.9) }),
          linhaSite("respondeu", { status: "enviado", enviado_em: dias(2), respondeu_em: dias(1) }),
          linhaSite("respondeu-na-raiz", { status: "enviado", enviado_em: dias(3), respondeu_em: dias(2.5) }),
          linhaSite("recusou-pasta", { status: "enviado", enviado_em: "2026-09-20T12:00:00Z" }),
          linhaSite("recusou", { status: "recusado", enviado_em: dias(5), recusado_em: dias(1) }),
          linhaSite("expirou", { status: "expirado", enviado_em: dias(11) }),
          linhaSite("descartado", { status: "descartado" }),
          linhaSite("descartado-pela-pasta", { status: "novo" }),
          linhaSite("fechou-na-raiz", { status: "fechado", enviado_em: dias(8), respondeu_em: dias(7), fechado_em: dias(1) }),
          linhaSite("acervo", { status: "enviado", enviado_em: "2026-09-20T12:00:00Z" }),
          linhaSite("com-proposta", { status: "enviado", enviado_em: dias(6), respondeu_em: dias(5) }),
          linhaSite("proposta-desfeita", { status: "enviado", enviado_em: dias(6), respondeu_em: dias(5) }),
        ],
      },
      prumo: {
        planilha: "PRUMO — Fila de revisão", aba: "Prospects",
        linhas: [
          linhaPrumo("revisar"),
          linhaPrumo("convite", { Etapa: "Convite enviado", "Convite enviado em": dias(3) }),
          linhaPrumo("leu", { Etapa: "Convite enviado", "Convite enviado em": dias(1), "Próxima ação": "Leu o convite em 02/10, 08:00. Sem resposta em 3 dias, ofereça fazer por telefone." }),
          linhaPrumo("respondeu", { Etapa: "Convite enviado", "Convite enviado em": dias(2), "Próxima ação": "Respondeu no WhatsApp em 01/10, 16:30. Continue a conversa." }),
          linhaPrumo("diagnostico", { Etapa: "Diagnóstico pronto", "Convite enviado em": dias(4), "Diagnóstico em": dias(1), "Índice PRUMO": "62" }),
          linhaPrumo("sem-interesse", { Etapa: "Sem interesse" }),
          linhaPrumo("concluido", { Etapa: "Concluído" }),
        ],
      },
      registros: {
        aba: "CRM", colunas: ["em", "produto", "id", "empresa", "tipo", "texto", "data"],
        linhas: [
          { em: dias(3), produto: "site", id: "com-proposta", tipo: "proposta", texto: "", data: "2026-09-29" },
          { em: dias(4), produto: "site", id: "proposta-desfeita", tipo: "proposta", texto: "", data: "2026-09-28" },
          { em: dias(3.5), produto: "site", id: "proposta-desfeita", tipo: "proposta_desfeita", texto: "", data: "" },
          { em: dias(2), produto: "site", id: "respondeu", tipo: "nota", texto: "Pediu preço do plano mensal", data: "" },
          { em: dias(1), produto: "prumo", id: "diagnostico", tipo: "proximo_passo", texto: "Ligar para marcar a conversa", data: "2026-10-02" },
          { em: dias(1), produto: "site", id: "fila", tipo: "proximo_passo", texto: "", data: "" },
          { em: "sem data", produto: "site", id: "respondeu", tipo: "nota", texto: "ignorada", data: "" },
          { em: dias(1), produto: "outro", id: "x", tipo: "nota", texto: "ignorada", data: "" },
        ],
      },
    },
  });
}

const PASTAS: PastaDoLead[] = [
  pasta("fila", "", "fila", false),
  pasta("pronto", "", "pronto"),
  pasta("followup", "", "followup"),
  pasta("followup-ontem", "", "followup-ontem"),
  pasta("viu", "", "viu"),
  pasta("respondeu", "_em-conversa", "respondeu"),
  pasta("respondeu-na-raiz", "", "respondeu-na-raiz"),
  pasta("recusou-pasta", "_recusados", "recusou-pasta"),
  pasta("recusou", "_recusados", "recusou"),
  pasta("expirou", "_concluidos", "expirou"),
  pasta("fechou-na-raiz", "", "fechou-na-raiz"),
  pasta("acervo", "", "acervo"),
  pasta("com-proposta", "_em-conversa", "com-proposta"),
  pasta("proposta-desfeita", "_em-conversa", "proposta-desfeita"),
  pasta("orfa", "", "sem-linha"),
  pasta("descartado-pela-pasta", "_descartados", "descartado-pela-pasta", false),
];

function visao() {
  return montarCrm(retrato(), { agora: AGORA, pastas: PASTAS, mapas: [{ prospectId: "diagnostico", geradoEm: dias(0.5), pasta: "~/prumo-entregas/x" }] });
}

const lead = (leads: CrmLead[], id: string) => {
  const achado = leads.find((item) => item.id === id);
  assert.ok(achado, `lead ${id} ausente`);
  return achado;
};

describe("CRM: etapas do Site antes da venda", () => {
  it("põe cada lead numa das 6 etapas pela planilha e usa a pasta só onde a esteira já usa", () => {
    const { leads } = visao();
    const etapa = (id: string) => { const l = lead(leads, `site:${id}`); return `${l.etapa}/${l.sinal}`; };
    assert.equal(leads.some((l) => l.chave === "TESTE"), false);
    assert.equal(etapa("fila"), "novo/na-fila");
    assert.equal(etapa("pronto"), "novo/pronto");
    assert.equal(etapa("followup"), "contatado/enviado");
    assert.equal(etapa("viu"), "contatado/viu");
    assert.equal(etapa("respondeu"), "conversando/respondeu");
    assert.equal(etapa("recusou-pasta"), "perdido/recusou-pasta");
    assert.equal(etapa("recusou"), "perdido/recusou");
    assert.equal(etapa("expirou"), "perdido/expirou");
    assert.equal(etapa("descartado"), "perdido/descartado");
    assert.equal(etapa("descartado-pela-pasta"), "perdido/descartado");
    assert.equal(etapa("fechou-na-raiz"), "ganho/fechou");
    assert.equal(etapa("com-proposta"), "proposta/proposta");
    assert.equal(etapa("proposta-desfeita"), "conversando/respondeu");
  });

  it("diz leitura desconhecida quando não há visto_em, nunca 'não viu'", () => {
    const { leads } = visao();
    assert.equal(lead(leads, "site:followup").leitura, "desconhecida");
    assert.equal(lead(leads, "site:followup").subEtapa, "Enviado · leitura desconhecida");
    assert.equal(lead(leads, "site:viu").leitura, "viu");
    assert.equal(lead(leads, "site:pronto").leitura, "nao-se-aplica");
    assert.deepEqual(Object.keys(lead(leads, "site:viu").marcos), ["enviado", "visto"]);
    assert.equal(lead(leads, "site:respondeu").leitura, "pela-resposta", "quem respondeu leu");
    assert.equal(lead(leads, "prumo:diagnostico").leitura, "pela-resposta");
  });

  it("marca follow-up no 3º dia só para envio depois do corte e uma vez por lembrete", () => {
    const { leads } = visao();
    assert.equal(lead(leads, "site:followup").followupHoje, true);
    assert.equal(lead(leads, "site:followup").diasNaEtapa, 3);
    assert.equal(lead(leads, "site:followup-ontem").followupHoje, false, "o lembrete do 05 foi ontem");
    assert.equal(lead(leads, "site:acervo").followupHoje, false);
    assert.equal(lead(leads, "site:acervo").acervo, true);
    assert.equal(lead(leads, "site:viu").followupHoje, false);
  });

  it("links: wa_link só para quem está pronto, página do lead pela tailnet e conversa sem o texto", () => {
    const { leads } = visao();
    const pronto = lead(leads, "site:pronto");
    assert.equal(pronto.links.enviar, `${WEBHOOK}/enviar?place_id=pronto`);
    assert.equal(pronto.links.whatsapp, "https://wa.me/5527999990000");
    assert.equal(pronto.links.acoes, `${WEBHOOK}/lead?id=pronto`);
    assert.equal(lead(leads, "site:followup").links.enviar, undefined);
    assert.match(lead(leads, "site:fila").links.planilha ?? "", /&range=A\d+$/);
  });

  it("aponta divergência entre planilha e pasta sem corrigir nada", () => {
    const v = visao();
    assert.deepEqual(lead(v.leads, "site:fechou-na-raiz").divergencias, ["Planilha diz fechado, mas a pasta na raiz."]);
    assert.deepEqual(lead(v.leads, "site:respondeu-na-raiz").divergencias, ["Respondeu, mas a pasta continua na raiz (deveria estar em _em-conversa/)."]);
    assert.deepEqual(lead(v.leads, "site:pronto-sem-pasta").divergencias, ["Sem pasta em ~/auto-site para este lead."]);
    assert.deepEqual(lead(v.leads, "site:recusou-pasta").divergencias, [], "recusa anotada na pasta é estado, não divergência");
    assert.equal(lead(v.leads, "site:fechou-na-raiz").etapa, "ganho", "a planilha continua mandando");
    assert.deepEqual(lead(v.leads, "site:descartado-pela-pasta").divergencias, ['Pasta em _descartados/, mas a planilha diz "novo".']);
    assert.deepEqual(v.pastasSemLinha, ["orfa"]);
    assert.equal(v.divergencias, 4);
  });

  it("sem leitura das pastas não inventa divergência", () => {
    const v = montarCrm(retrato(), { agora: AGORA });
    assert.equal(v.pastasLidas, false);
    assert.equal(v.divergencias, 0);
    assert.equal(lead(v.leads, "site:recusou-pasta").etapa, "contatado");
  });

  it("mostra os artefatos da pasta só para quem está na fila do gerador", () => {
    const { leads } = visao();
    assert.equal(lead(leads, "site:fila").pasta?.artefatos?.fotos, 3);
    assert.equal(lead(leads, "site:pronto").pasta?.artefatos, undefined);
  });
});

describe("CRM: etapas do PRUMO", () => {
  it("usa a Etapa da planilha e a resposta anotada em Próxima ação", () => {
    const { leads } = visao();
    const etapa = (id: string) => { const l = lead(leads, `prumo:${id}`); return `${l.etapa}/${l.sinal}`; };
    assert.equal(etapa("revisar"), "novo/revisar");
    assert.equal(etapa("convite"), "contatado/convite");
    assert.equal(etapa("leu"), "contatado/convite-visto");
    assert.equal(lead(leads, "prumo:leu").leitura, "viu");
    assert.equal(etapa("respondeu"), "conversando/respondeu-prumo");
    assert.equal(etapa("diagnostico"), "conversando/diagnostico");
    assert.equal(etapa("sem-interesse"), "perdido/sem-interesse");
    assert.equal(etapa("concluido"), "ganho/concluido");
    assert.equal(lead(leads, "prumo:revisar").links.convite, `${WEBHOOK}/convite?id=revisar`);
    assert.equal(lead(leads, "prumo:revisar").links.whatsapp, "https://wa.me/5511900000000");
  });

  it("põe o Mapa e os registros manuais na linha do tempo, com origem", () => {
    const { leads } = visao();
    const diagnostico = lead(leads, "prumo:diagnostico");
    assert.deepEqual(diagnostico.eventos.map((e) => `${e.tipo}:${e.origem}`), [
      "encontrado:automático", "convite:automático", "diagnostico:automático", "proximo_passo:manual", "mapa:automático",
    ]);
    assert.equal(diagnostico.proximoPasso?.texto, "Ligar para marcar a conversa");
    assert.equal(lead(leads, "site:respondeu").notas, 1);
  });

  it("lê a data da resposta do texto do fluxo, no fuso de São Paulo", () => {
    const t = dataNaProximaAcao("Respondeu no WhatsApp em 24/09, 11:50. Continue a conversa.", "respondeu", Date.parse("2026-09-24T14:00:00Z"), AGORA.getTime());
    assert.equal(new Date(t!).toISOString(), "2026-09-24T14:50:00.000Z");
    const leu = dataNaProximaAcao("Leu o convite em 01/10, 09:05. Sem resposta em 3 dias, ofereça fazer por telefone.", "leu", undefined, AGORA.getTime());
    assert.equal(new Date(leu!).toISOString(), "2026-10-01T12:05:00.000Z");
    assert.equal(dataNaProximaAcao("Aguarde o dono responder", "respondeu", undefined, AGORA.getTime()), undefined);
  });
});

describe("CRM: lista Hoje e contagens", () => {
  it("ordena os grupos pelo que precisa do Rômulo hoje", () => {
    const { hoje } = visao();
    const ids = (grupo: string) => hoje.find((g) => g.id === grupo)!.itens.map((i) => i.leadId);
    assert.deepEqual(hoje.map((g) => g.id), ["proximo", "followup", "resposta", "revisar", "proposta", "enviar"]);
    assert.deepEqual(ids("proximo"), ["prumo:diagnostico"]);
    assert.deepEqual(ids("followup"), ["site:followup", "prumo:convite"]);
    assert.deepEqual(ids("resposta"), ["site:respondeu", "prumo:respondeu"]);
    assert.deepEqual(ids("revisar"), ["prumo:revisar"]);
    assert.deepEqual(ids("proposta"), ["site:com-proposta"]);
    assert.deepEqual(ids("enviar"), ["site:pronto", "site:pronto-sem-pasta"]);
    const enviar = hoje.find((g) => g.id === "enviar")!.itens;
    assert.equal(enviar[0].links[0].url, `${WEBHOOK}/enviar?place_id=pronto`);
    assert.equal(enviar[1].acao, "Sem WhatsApp válido na planilha");
  });

  it("conta por etapa e produto e separa os motivos de perda", () => {
    const v = visao();
    assert.deepEqual(v.contagens.novo, { total: 4, site: 3, prumo: 1 });
    assert.deepEqual(v.contagens.contatado, { total: 6, site: 4, prumo: 2 });
    assert.deepEqual(v.contagens.perdido, { total: 6, site: 5, prumo: 1 });
    assert.deepEqual(v.perdas, { recusou: 2, expirou: 1, descartado: 2, semInteresse: 1 });
    assert.equal(v.geradoEm, "2026-10-02T14:55:00.000Z");
    assert.equal(JSON.stringify(v), JSON.stringify(visao()), "mesma entrada, mesma resposta (ETag estável)");
  });

  it("avisa coluna esperada que ainda não existe na planilha", () => {
    const base = retrato();
    base.fontes.site.colunas = base.fontes.site.colunas.filter((c) => c !== "visto_em" && c !== "fechado_em");
    assert.deepEqual(montarCrm(base, { agora: AGORA }).colunasAusentes, ["Leads: visto_em", "Leads: fechado_em"]);
  });
});

describe("CRM: retrato e registro", () => {
  const temporarios: string[] = [];
  afterEach(async () => {
    await Promise.all(temporarios.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  async function loja(conteudo?: unknown, segredo = true, fetcher?: typeof fetch) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-crm-"));
    temporarios.push(dir);
    const arquivo = path.join(dir, "crm.json");
    if (conteudo !== undefined) await fs.writeFile(arquivo, typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo));
    if (segredo) await fs.writeFile(path.join(dir, "segredo"), "s3gredo\n");
    const config = configDoCrm({ retrato: arquivo, segredoArquivo: path.join(dir, "segredo"), entregasPrumo: path.join(dir, "entregas") }, undefined, dir);
    return new CrmStore(config, fetcher);
  }

  it("retrato ausente é estado vazio, e ilegível é dito como ilegível", async () => {
    const vazia = await (await loja()).visao(AGORA);
    assert.equal(vazia.estado, "sem-retrato");
    assert.equal(vazia.leads.length, 0);
    const ruim = await (await loja("{ nao é json")).visao(AGORA);
    assert.equal(ruim.estado, "retrato-invalido");
    const store = await loja(retrato());
    await fs.writeFile(path.join(path.dirname(store.config.retrato), "crm-falha.json"),
      JSON.stringify({ falhouEm: "2026-10-02T14:58:00Z", erro: "Leads: credencial caída" }));
    const comFalha = await store.visao(AGORA);
    assert.equal(comFalha.estado, "ok", "o retrato anterior continua valendo");
    assert.deepEqual(comFalha.ultimaFalha, { em: "2026-10-02T14:58:00.000Z", erro: "Leads: credencial caída" });
    assert.throws(() => validarRetrato({ versao: 2, geradoEm: AGORA.toISOString() }), /Versão/);
  });

  it("recusa registro ruim antes de chamar o n8n", () => {
    assert.throws(() => validarRegistro({ produto: "site", id: "x y", tipo: "nota", texto: "a" }, AGORA), RegistroInvalido);
    assert.throws(() => validarRegistro({ produto: "site", id: "abc", tipo: "nota", texto: " " }, AGORA), /Escreva/);
    assert.throws(() => validarRegistro({ produto: "site", id: "abc", tipo: "proximo_passo", texto: "Ligar" }, AGORA), /data/);
    assert.throws(() => validarRegistro({ produto: "site", id: "abc", tipo: "apagar", texto: "" }, AGORA), /Tipo/);
    assert.equal(validarRegistro({ produto: "site", id: "abc", tipo: "nota", texto: " linha 1\r\nlinha 2 " }, AGORA).texto, "linha 1\nlinha 2");
    assert.equal(validarRegistro({ produto: "prumo", id: "abc", tipo: "proposta", texto: "" }, AGORA).data, "2026-10-02");
    assert.throws(() => configDoCrm({ registroUrl: "https://dell.exemplo.ts.net/webhook/crm-registro" }), /loopback/);
  });

  it("manda o registro ao n8n com o segredo no header e só confirma com ok", async () => {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return new Response(JSON.stringify({ ok: true, em: "2026-10-02T15:00:01Z" }), { status: 200 });
    }) as unknown as typeof fetch;
    const store = await loja(retrato(), true, fetcher);
    const resposta = await store.registrar({ produto: "site", id: "respondeu", tipo: "nota", texto: "Quer começar em novembro" }, AGORA);
    assert.deepEqual(resposta, { ok: true, em: "2026-10-02T15:00:01Z" });
    assert.equal(chamadas[0].url, "http://127.0.0.1:5679/webhook/crm-registro");
    assert.equal((chamadas[0].init.headers as Record<string, string>)["X-CRM"], "s3gredo");
    assert.deepEqual(JSON.parse(String(chamadas[0].init.body)), {
      produto: "site", id: "respondeu", tipo: "nota", texto: "Quer começar em novembro", data: "", empresa: "Empresa respondeu",
    });
  });

  it("classifica as falhas do registro", async () => {
    const recusa = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    await assert.rejects((await loja(retrato(), true, recusa)).registrar({ produto: "site", id: "respondeu", tipo: "nota", texto: "a" }, AGORA),
      (e: unknown) => e instanceof RegistroFalhou && e.status === 403);
    await assert.rejects((await loja(retrato(), false)).registrar({ produto: "site", id: "respondeu", tipo: "nota", texto: "a" }, AGORA), RegistroIndisponivel);
    await assert.rejects((await loja(retrato())).registrar({ produto: "site", id: "nao-existe", tipo: "nota", texto: "a" }, AGORA), /não encontrado/);
    await assert.rejects((await loja(retrato())).registrar({ produto: "site", id: "com-proposta", tipo: "proposta", texto: "" }, AGORA), /já está em Proposta/);
    await assert.rejects((await loja(retrato())).registrar({ produto: "site", id: "respondeu", tipo: "proposta_desfeita", texto: "" }, AGORA), /não está em Proposta/);
  });
});
