import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PastaDoLead } from "./auto-production.ts";
import { montarCrm, validarRetrato, type CrmVisao } from "./crm.ts";
import { decidir, estadoNovo, textoDoAviso, botoesDoAviso, ESPERA_DO_AVISO_MS } from "./vendedor.ts";
import { filaDeVenda, noExpedienteDeVenda } from "../src/operations/proxima-venda.ts";
import { diagnosticoDeVenda } from "../src/operations/por-que-nao-vende.ts";
import { montarDossie } from "../src/operations/copiloto.ts";
import { lerLinhasDaConversa, nomeDoArquivo } from "./conversa-do-lead.ts";

// Simulação das jornadas (16/10/2026, pedido "simule cada jornada e ajuste"): um lead por vez, do
// pronto ao "quero ver", passando pelo retrato de verdade (montarCrm) até a fila de venda e o aviso
// do vendedor. Tudo fixture: nenhuma planilha, pasta, n8n ou Telegram real é tocado.

const AGORA = new Date("2026-10-14T13:00:00Z"); // quarta, 10:00 em São Paulo
const WEBHOOK = "https://dell.exemplo.ts.net/webhook";
const horas = (n: number) => new Date(AGORA.getTime() - n * 3600_000).toISOString();
const dias = (n: number) => horas(n * 24);
const COLUNAS = ["row_number", "place_id", "nome", "vertical", "cidade", "status", "site_url", "criado_em", "enviado_em",
  "visto_em", "respondeu_em", "followup_em", "recusado_em", "fechado_em", "acoes_link", "wa_link", "wa_me",
  "resposta_tipo", "resposta_trecho", "resposta_em", "mensagem_variante"];
const PRIMEIRA = "Oi, tudo bem? Aqui é o Rômulo. Montei uma demonstração de site para a Studio L. Posso te mandar o link?";

function linha(extra: Record<string, string>): Record<string, string> {
  return { ...Object.fromEntries(COLUNAS.map((c) => [c, ""])), row_number: "3", place_id: "L", nome: "Studio L",
    vertical: "pilates", cidade: "Vitória", criado_em: dias(10), site_url: "https://demo-studio-l.vercel.app/",
    wa_me: `https://wa.me/5527999990000?text=${encodeURIComponent(PRIMEIRA)}`, mensagem_variante: "A", ...extra };
}

function visaoCom(site: Record<string, string>, registros: Array<Record<string, string>> = [], agora = AGORA): CrmVisao {
  const retrato = validarRetrato({
    versao: 1,
    geradoEm: new Date(agora.getTime() - 60_000).toISOString(),
    links: { webhook: WEBHOOK },
    fontes: {
      site: { planilha: "Leads", aba: "Leads", colunas: COLUNAS, linhas: [linha(site)] },
      registros: { aba: "CRM", colunas: ["em", "produto", "id", "tipo", "texto", "data"], linhas: registros },
    },
  });
  const pasta: PastaDoLead = {
    slug: "studio-l", lugar: "", placeId: "L",
    artefatos: { conteudo: true, fotos: 0, capa: false, gerado: true, publicado: true, falha: false },
    alteradaEm: dias(2), publicadoEm: dias(3), siteUrl: "https://demo-studio-l.vercel.app/",
  };
  return montarCrm(retrato, { agora, pastas: [pasta] }) as unknown as CrmVisao;
}

const LIVRE = { primeiroLiberado: true };

describe("jornada do Site: do pronto ao 'quero ver'", () => {
  it("pronto: a fila oferece a primeira mensagem, com o texto do Balcão para revisar", () => {
    const v = visaoCom({ status: "pronto", wa_link: `${WEBHOOK}/enviar?place_id=L` });
    const [a] = filaDeVenda(v, LIVRE);
    assert.equal(a?.tipo, "primeiro");
    assert.equal(a.primeiroContato, true);
    assert.equal(a.rascunho, PRIMEIRA);
    // O link do n8n marca o envio sozinho: nada a anotar no toque.
    assert.equal(a.anota, undefined);
    assert.equal(a.link?.url, `${WEBHOOK}/enviar?place_id=L`);
  });

  it("pronto com a trava de ritmo segurando: nenhum primeiro contato na fila", () => {
    const v = visaoCom({ status: "pronto", wa_link: `${WEBHOOK}/enviar?place_id=L` });
    assert.deepEqual(filaDeVenda(v, { primeiroLiberado: false }), []);
  });

  it("enviado ontem, sem leitura: nada a fazer (insistir com quem não abriu vira denúncia)", () => {
    const v = visaoCom({ status: "enviado", enviado_em: dias(1) });
    assert.deepEqual(filaDeVenda(v, LIVRE).map((a) => a.tipo), []);
  });

  it("enviado há 3 dias e leu: follow-up, e o toque anota o follow-up", () => {
    const v = visaoCom({ status: "enviado", enviado_em: dias(3), visto_em: dias(2.8) });
    const [a] = filaDeVenda(v, LIVRE);
    assert.equal(a?.tipo, "followup");
    assert.equal(a.anota, "followup_enviado");
    assert.equal(a.primeiroContato, false);
    assert.ok(a.rascunho && a.rascunho.length > 10, "follow-up sem texto pronto");
  });

  it("disse 'quero ver' há 1 h: vem primeiro, quente, com o link do demo no texto e anota a 2ª mensagem", () => {
    const v = visaoCom({ status: "enviado", enviado_em: dias(1), respondeu_em: horas(1), resposta_tipo: "interesse", resposta_trecho: "pode mandar", resposta_em: horas(1) });
    const [a] = filaDeVenda(v, LIVRE);
    assert.equal(a?.tipo, "responder");
    assert.equal(a.quente, true);
    assert.equal(a.anota, "segunda_enviada");
    assert.match(a.rascunho ?? "", /demo-studio-l\.vercel\.app/);
  });

  it("depois da 2ª mensagem anotada, o 'quero ver' sai da fila", () => {
    const v = visaoCom(
      { status: "enviado", enviado_em: dias(1), respondeu_em: horas(3), resposta_tipo: "interesse", resposta_trecho: "pode mandar", resposta_em: horas(3) },
      [{ em: horas(2), produto: "site", id: "L", tipo: "segunda_enviada", texto: "", data: "" }],
    );
    assert.equal(filaDeVenda(v, LIVRE).some((a) => a.tipo === "responder" && a.anota === "segunda_enviada"), false);
  });

  it("um dia depois do link, sem resposta dele: pergunte o que achou (o passo que levava à proposta)", () => {
    const registros = [{ em: horas(26), produto: "site", id: "L", tipo: "segunda_enviada", texto: "", data: "" }];
    const site = { status: "enviado", enviado_em: dias(3), respondeu_em: horas(28), resposta_tipo: "interesse", resposta_trecho: "pode mandar", resposta_em: horas(28) };
    const v = visaoCom(site, registros);
    const a = filaDeVenda(v, { ...LIVRE, agora: AGORA.getTime() }).find((x) => x.tipo === "depois-do-link");
    assert.ok(a, "sem o 'o que achou?'");
    assert.match(a.rascunho ?? "", /O que achou\?/);
    assert.match(a.link?.url ?? "", /^https:\/\/wa\.me\/\d+\?text=/);
    // Antes de 20 h não cobra; se ele escreveu depois do link, a vez é de responder, não de perguntar.
    const cedo = visaoCom(site, [{ ...registros[0], em: horas(5) }]);
    assert.equal(filaDeVenda(cedo, { ...LIVRE, agora: AGORA.getTime() }).some((x) => x.tipo === "depois-do-link"), false);
    const escreveu = visaoCom({ ...site, respondeu_em: horas(2), resposta_em: horas(2) }, registros);
    assert.equal(filaDeVenda(escreveu, { ...LIVRE, agora: AGORA.getTime() }).some((x) => x.tipo === "depois-do-link"), false);
  });

  it("proposta marcada há 3 dias: a fila pede o retorno, sem reenviar o preço", () => {
    const v = visaoCom(
      { status: "enviado", enviado_em: dias(6), respondeu_em: dias(5), resposta_tipo: "interesse", resposta_trecho: "gostei", resposta_em: dias(5) },
      [{ em: dias(3), produto: "site", id: "L", tipo: "proposta", texto: "", data: "2026-10-11" }],
    );
    const tipos = filaDeVenda(v, LIVRE).map((a) => a.tipo);
    assert.ok(tipos.includes("proposta"), tipos.join(","));
    assert.match(filaDeVenda(v, LIVRE).find((a) => a.tipo === "proposta")!.tatica, /não reenvie o preço/);
  });

  it("só o robô respondeu: no dia seguinte, o reenvio pedindo o responsável conta como primeiro contato", () => {
    // Como no retrato real: a resposta de robô não preenche respondeu_em (só resposta_tipo).
    const v = visaoCom({ status: "enviado", enviado_em: dias(1.2), resposta_tipo: "bot", resposta_em: dias(1.2) });
    const livre = filaDeVenda(v, LIVRE);
    const reenvio = livre.find((a) => a.tipo === "followup");
    assert.ok(reenvio, livre.map((a) => a.tipo).join(","));
    assert.equal(reenvio.primeiroContato, true);
    assert.equal(filaDeVenda(v, { primeiroLiberado: false }).some((a) => a.tipo === "followup"), false);
  });
});

describe("vendedor: um aviso por vez, só no expediente", () => {
  const vPronto = visaoCom({ status: "pronto", wa_link: `${WEBHOOK}/enviar?place_id=L` });
  const t = AGORA.getTime();

  it("expediente: seg a sex, 08:00 a 17:30 de São Paulo", () => {
    assert.equal(noExpedienteDeVenda(Date.parse("2026-10-14T11:00:00Z")), true); // 08:00
    assert.equal(noExpedienteDeVenda(Date.parse("2026-10-14T10:59:00Z")), false); // 07:59
    assert.equal(noExpedienteDeVenda(Date.parse("2026-10-14T20:29:00Z")), true); // 17:29
    assert.equal(noExpedienteDeVenda(Date.parse("2026-10-14T20:30:00Z")), false); // 17:30
    assert.equal(noExpedienteDeVenda(Date.parse("2026-10-17T13:00:00Z")), false); // sábado
  });

  it("avisa a primeira da fila e depois espera o toque", () => {
    const um = decidir(vPronto, estadoNovo(t), t);
    assert.equal(um.decisao.tipo, "avisar");
    const estado = { ...um.estado, avisados: ["site:L|primeiro"], abertos: [{ chave: "site:L|primeiro", token: "abc", em: t, leadId: "site:L", primeiroContato: true, produto: "site" as const, texto: "x" }] };
    assert.deepEqual(decidir(vPronto, estado, t + 60_000).decisao, { tipo: "nada", motivo: "fila-vazia" });
  });

  it("aviso sem toque por 30 min vira pulado e libera o próximo", () => {
    const estado = { ...estadoNovo(t), avisados: ["x|followup"], abertos: [{ chave: "site:L|primeiro", token: "abc", em: t, leadId: "site:L", primeiroContato: true, produto: "site" as const, texto: "x" }] };
    const depois = decidir(vPronto, estado, t + ESPERA_DO_AVISO_MS + 1);
    assert.equal(depois.estado.abertos.length, 0);
    assert.ok(depois.estado.pulados.includes("site:L|primeiro"));
  });

  it("um 'quero ver' novo fura a espera de outro aviso aberto", () => {
    const v = visaoCom({ status: "enviado", enviado_em: dias(1), respondeu_em: horas(1), resposta_tipo: "interesse", resposta_trecho: "sim", resposta_em: horas(1) });
    const estado = { ...estadoNovo(t), abertos: [{ chave: "outro|followup", token: "abc", em: t, leadId: "outro", primeiroContato: false, produto: "site" as const, texto: "x" }] };
    // O aberto de outro lead some da fila (não existe no retrato): o teste fixa só o furo.
    const r = decidir(v, estado, t + 60_000);
    assert.equal(r.decisao.tipo, "avisar");
    assert.equal(r.decisao.tipo === "avisar" && r.decisao.acao.tipo, "responder");
  });

  it("fora do expediente não avisa nada", () => {
    const sabado = Date.parse("2026-10-17T13:00:00Z");
    assert.deepEqual(decidir(vPronto, estadoNovo(sabado), sabado).decisao, { tipo: "nada", motivo: "fora-do-expediente" });
  });

  it("primeiro contato do 'Enviei' conta na trava antes de o retrato ver", () => {
    const estado = { ...estadoNovo(t), primeiros: { "site:outro": t - 60_000 } };
    // 1 min depois de outro primeiro contato: a trava de 4 min segura este.
    assert.deepEqual(decidir(vPronto, estado, t).decisao, { tipo: "nada", motivo: "fila-vazia" });
  });

  it("o texto do Telegram traz o porquê, o como e a mensagem; os botões abrem o WhatsApp e anotam", () => {
    const [a] = filaDeVenda(vPronto, LIVRE);
    const texto = textoDoAviso(a, []);
    assert.match(texto, /Envie a primeira mensagem para Studio L/);
    assert.match(texto, /Como: /);
    assert.ok(texto.includes(PRIMEIRA));
    const botoes = botoesDoAviso(a, "tok1", "https://central.exemplo.ts.net:8443/");
    assert.deepEqual(botoes.flat().map((b) => b.texto), ["Abrir no WhatsApp com a mensagem", "✓ Enviei", "Pular", "Ver a ficha"]);
    assert.ok(botoes.flat().every((b) => !("dados" in b) || b.dados.length <= 64));
  });
});

describe("a conversa guardada pelo observador", () => {
  it("lê as linhas em ordem, pula a ilegível e a repetida, e corta no teto", () => {
    const linhas = [
      JSON.stringify({ em: "2026-10-16T12:00:00Z", direcao: "saida", texto: "Oi, aqui é o Rômulo", origem: "prumo", id: "a" }),
      "lixo",
      JSON.stringify({ em: "2026-10-16T12:05:00Z", direcao: "entrada", texto: "pode mandar", origem: "prumo", id: "b" }),
      JSON.stringify({ em: "2026-10-16T12:05:00Z", direcao: "entrada", texto: "pode mandar", origem: "prumo", id: "b" }),
      JSON.stringify({ em: "2026-10-16T11:00:00Z", direcao: "lido", texto: "" }),
    ].join("\n");
    const m = lerLinhasDaConversa(linhas);
    assert.deepEqual(m.map((x) => `${x.direcao}:${x.texto}`), ["saida:Oi, aqui é o Rômulo", "entrada:pode mandar"]);
    assert.equal(lerLinhasDaConversa(linhas, 1).length, 1);
    // Sem barra e sem começar por ponto: nada sai da pasta das conversas.
    assert.equal(nomeDoArquivo("../etc/passwd"), null);
    assert.equal(nomeDoArquivo("site:ChIJ_x-1"), "site:ChIJ_x-1.jsonl");
  });

  it("vai ao dossiê do copiloto mascarada, com quem falou", () => {
    const v = visaoCom({ status: "enviado", enviado_em: dias(1), respondeu_em: horas(1), resposta_tipo: "interesse", resposta_trecho: "pode", resposta_em: horas(1) });
    const lead = v.leads[0];
    const d = montarDossie(lead as any, { conversa: [{ em: horas(2), direcao: "saida", texto: "Oi" }, { em: horas(1), direcao: "entrada", texto: "me liga no 27 99999-0000" }] });
    assert.deepEqual(d.conversa?.map((c) => c.quem), ["romulo", "lead"]);
    assert.ok(!/99999-0000/.test(JSON.stringify(d.conversa)), "telefone vazou para o dossiê");
  });
});

describe("por que não está vendendo", () => {
  it("com 'quero ver' e nenhuma proposta, o gargalo é depois do 'gostei'", () => {
    const base = { produto: "site", etapa: "contato", leitura: "viu", eventos: [], links: {}, divergencias: [], notas: 0 } as const;
    const leads = Array.from({ length: 40 }, (_, i) => ({
      ...base, id: `site:${i}`, chave: String(i), empresa: `E${i}`, nicho: "", cidade: "", sinal: "enviado", subEtapa: "",
      estadoNaPlanilha: "enviado", followupHoje: false, respostaNova: false, acervo: false,
      marcos: { enviado: dias(5), ...(i < 4 ? { segundaEnviada: dias(3) } : {}) },
      ...(i < 8 ? { resposta: { tipo: i < 4 ? "interesse" : "neutra", trecho: "", em: dias(4) } } : {}),
    })) as any[];
    const d = diagnosticoDeVenda(leads, AGORA.getTime());
    assert.equal(d.degraus.find((g) => g.id === "enviados")?.n, 40);
    assert.equal(d.degraus.find((g) => g.id === "interesse")?.n, 4);
    assert.equal(d.gargalo?.degrau, "proposta");
  });
});
