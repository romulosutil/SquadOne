import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PastaDoLead } from "./auto-production.ts";
import { followupDoTerceiroDia, montarCrm, validarRetrato, type CrmVisao } from "./crm.ts";
import { bracoDoRecibo } from "../src/operations/ab-recibo.ts";
import {
  decidir, estadoNovo, textoDoAviso, botoesDoAviso, criarVendedor, ESPERA_DO_AVISO_MS, fechadosNaVolta, lerHistoricoDoVendedor,
  resumoDoVendedor, RODAPE_DO_EXPIRADO, type AvisoAberto,
} from "./vendedor.ts";
import { criarMemoriaDaVenda } from "./venda-do-dia.ts";
import type { Botao } from "./telegram.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  // OT-02 (16/10/2026): fora do expediente, o "Liberar" daquele lead vale também na fila; o ritmo, não.
  it("fora do expediente: só o lead liberado entra, e só com o ritmo livre", () => {
    const v = visaoCom({ status: "pronto", wa_link: `${WEBHOOK}/enviar?place_id=L` });
    const id = v.leads[0].id;
    assert.deepEqual(filaDeVenda(v, { primeiroLiberado: false, ritmoLivre: true, liberados: new Set(["outro"]) }), []);
    assert.equal(filaDeVenda(v, { primeiroLiberado: false, ritmoLivre: true, liberados: new Set([id]) })[0]?.tipo, "primeiro");
    assert.deepEqual(filaDeVenda(v, { primeiroLiberado: false, ritmoLivre: false, liberados: new Set([id]) }), [], "o ritmo não se libera");
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

  it("uma licença nova (menos de 2 h) também fura o aviso aberto de outro lead, que segue na fila", () => {
    // Revisão de 17/10/2026: o "pode mandar" gravado como licença é quente como o interesse (pedeMaterial).
    const licenca = visaoCom({ status: "enviado", enviado_em: dias(1), respondeu_em: horas(1), resposta_tipo: "licenca", resposta_trecho: "pode mandar", resposta_em: horas(1) });
    const outro = visaoCom({ place_id: "F", nome: "Studio F", status: "enviado", enviado_em: dias(3), visto_em: dias(2.8) });
    const grupos = new Map<string, CrmVisao["hoje"][number]>();
    for (const g of [...licenca.hoje, ...outro.hoje]) {
      const ja = grupos.get(g.id);
      grupos.set(g.id, ja ? { ...ja, itens: [...ja.itens, ...g.itens] } : g);
    }
    const v = { ...licenca, leads: [...licenca.leads, ...outro.leads], hoje: [...grupos.values()] } as CrmVisao;
    const [aberta] = filaDeVenda(outro, LIVRE);
    assert.equal(aberta?.tipo, "followup");
    const estado = { ...estadoNovo(t), avisados: [aberta.chave],
      abertos: [{ chave: aberta.chave, token: "abc", em: t, leadId: aberta.leadId, primeiroContato: false, produto: "site" as const, texto: "x" }] };
    const r = decidir(v, estado, t + 60_000);
    assert.equal(r.estado.abertos.length, 1, "o aviso do outro lead continua aberto");
    assert.equal(r.decisao.tipo, "avisar");
    assert.equal(r.decisao.tipo === "avisar" && r.decisao.acao.leadId, "site:L");
    assert.equal(r.decisao.tipo === "avisar" && r.decisao.acao.quente, true);
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

// AC-06 (17/10/2026): a Central e o Telegram numa fila só, pelo venda-do-dia.json. Fixture e
// diretório temporário: nenhum Telegram, n8n ou arquivo de dados real é tocado.
describe("vendedor e Central: o servidor é a fonte do dia", () => {
  const vFollowup = visaoCom({ status: "enviado", enviado_em: dias(3), visto_em: dias(2.8) });
  const CHAVE = "site:L|followup";

  async function montar(visao: CrmVisao = vFollowup) {
    const dir = await mkdtemp(join(tmpdir(), "squadone-vendedor-"));
    const relogio = { agora: AGORA.getTime() };
    const memoria = criarMemoriaDaVenda(join(dir, "venda-do-dia.json"), () => relogio.agora);
    const enviados: Array<{ texto: string; botoes: Botao[][] }> = [];
    const editados: Array<{ mensagemId: number; texto: string }> = [];
    const registros: string[] = [];
    const vendedor = criarVendedor({
      lerVisao: async () => visao,
      enviar: async (texto, botoes) => { enviados.push({ texto, botoes }); return [{ chatId: 1, mensagemId: 100 + enviados.length }]; },
      editar: async (_chat, mensagemId, texto) => { editados.push({ mensagemId, texto }); },
      registrar: async (corpo) => { registros.push(`${corpo.id}:${corpo.tipo}`); },
      arquivoDeEstado: join(dir, "vendedor.json"),
      vendaDoDia: memoria,
      agora: () => relogio.agora,
    });
    const token = () => {
      const b = enviados.at(-1)?.botoes.flat().find((x): x is { texto: string; dados: string } => "dados" in x);
      return b ? b.dados.split(":")[1] : "";
    };
    const fim = async () => { vendedor.parar(); await rm(dir, { recursive: true, force: true }); };
    return { relogio, memoria, enviados, editados, registros, vendedor, token, fim };
  }

  // O gate de envio (17/10/2026): o link do aviso é de outro número que o do registro do lead.
  it("link para outro número que o do registro: o aviso não sai com botão, o motivo vai ao Telegram e não repete", async () => {
    const visao = structuredClone(vFollowup);
    assert.match(visao.leads[0].links.whatsapp ?? "", /wa\.me\/\d+/, "o fixture precisa de um wa.me para o teste valer");
    visao.leads[0].links.whatsapp = "https://wa.me/5511900000999";
    const m = await montar(visao);
    try {
      const d = await m.vendedor.volta();
      assert.deepEqual(d, { tipo: "nada", motivo: "mensagem-barrada" });
      assert.equal(m.enviados.length, 1);
      assert.match(m.enviados[0].texto, /^⛔ Não mandei o aviso de .*número do link não é o do registro/);
      assert.deepEqual(m.enviados[0].botoes, []);
      // Não repete na volta seguinte.
      m.relogio.agora += 60_000;
      await m.vendedor.volta();
      assert.equal(m.enviados.length, 1);
    } finally {
      await m.fim();
    }
  });

  it("resolvido na Central: a próxima volta tira os botões do aviso e diz onde foi feito", async () => {
    const m = await montar();
    try {
      assert.equal((await m.vendedor.volta()).tipo, "avisar");
      assert.match(m.enviados[0].texto, /follow-up|Follow-up|Studio L/);
      m.relogio.agora += 60_000;
      await m.memoria.resolver(CHAVE, "enviada", "central");
      m.relogio.agora += 60_000;
      await m.vendedor.volta();
      assert.deepEqual(m.editados.map((e) => e.mensagemId), [101]);
      assert.match(m.editados[0].texto, /✅ Feito na Central\.$/);
      // Feito lá não volta aqui: nenhum aviso novo da mesma ação.
      assert.equal(m.enviados.length, 1);
      assert.equal(m.registros.length, 0, "fechar por fora não anota nada");
    } finally {
      await m.fim();
    }
  });

  it("toque atrasado: 'Enviei' depois de a Central fazer responde 'Já estava feito.' e não anota de novo", async () => {
    const m = await montar();
    try {
      await m.vendedor.volta();
      m.relogio.agora += 60_000;
      // A Central anotou no toque do link e depois deu "Enviei, próxima".
      await m.memoria.anotarUmaVez(CHAVE, "followup_enviado", "central", async () => { m.registros.push("central"); });
      await m.memoria.resolver(CHAVE, "enviada", "central");
      const r = await m.vendedor.tocar(m.token(), "enviei");
      assert.equal(r.curto, "Já estava feito.");
      assert.match(r.texto ?? "", /✅ Feito na Central\.$/);
      assert.deepEqual(m.registros, ["central"], "o Telegram não chamou registrar");
    } finally {
      await m.fim();
    }
  });

  it("a Central só anotou o link: o 'Enviei' do Telegram resolve sem anotar de novo", async () => {
    const m = await montar();
    try {
      await m.vendedor.volta();
      await m.memoria.anotarUmaVez(CHAVE, "followup_enviado", "central", async () => { m.registros.push("central"); });
      const r = await m.vendedor.tocar(m.token(), "enviei");
      assert.match(r.texto ?? "", /já estava anotado no CRM/);
      assert.deepEqual(m.registros, ["central"]);
      const doDia = await m.memoria.ler();
      assert.deepEqual([doDia.resolvidas[CHAVE].como, doDia.resolvidas[CHAVE].por], ["enviada", "telegram"]);
    } finally {
      await m.fim();
    }
  });

  it("'Enviei' sem nada da Central anota uma vez e conta para a Central", async () => {
    const m = await montar();
    try {
      await m.vendedor.volta();
      const r = await m.vendedor.tocar(m.token(), "enviei");
      assert.match(r.texto ?? "", /anotado no CRM\.$/);
      assert.deepEqual(m.registros, ["L:followup_enviado"]);
      // A Central tentando anotar a mesma ação depois: já estava.
      const deNovo = await m.memoria.anotarUmaVez(CHAVE, "followup_enviado", "central", async () => { m.registros.push("central"); });
      assert.equal(deNovo.anotou, false);
      assert.equal(m.registros.length, 1);
    } finally {
      await m.fim();
    }
  });

  it("expirou no Telegram: a Central também manda para o fim (pulada, por 'expirou') e a mensagem perde os botões", async () => {
    const m = await montar();
    try {
      await m.vendedor.volta();
      m.relogio.agora += ESPERA_DO_AVISO_MS + 1;
      await m.vendedor.volta();
      const r = (await m.memoria.ler()).resolvidas[CHAVE];
      assert.deepEqual([r.como, r.pulou, r.por], ["pulada", true, "expirou"]);
      assert.equal(m.editados.length, 1);
      assert.ok(m.editados[0].texto.endsWith(RODAPE_DO_EXPIRADO));
      // O toque depois de expirar não faz nada.
      assert.equal((await m.vendedor.tocar(m.token(), "enviei")).curto, "Este aviso já fechou.");
      assert.equal(m.registros.length, 0);
    } finally {
      await m.fim();
    }
  });

  it("o primeiro contato do 'Enviei' vai ao servidor, e a Central conta na trava", async () => {
    const m = await montar(visaoCom({ status: "pronto", wa_link: `${WEBHOOK}/enviar?place_id=L` }));
    try {
      await m.vendedor.volta();
      await m.vendedor.tocar(m.token(), "enviei");
      assert.deepEqual((await m.memoria.ler()).primeiros["site:L"], { em: AGORA.getTime(), por: "telegram" });
    } finally {
      await m.fim();
    }
  });

  it("decidir: aviso de outra ação resolvido na Central fecha e a próxima sai na mesma volta", () => {
    const vPronto = visaoCom({ status: "pronto", wa_link: `${WEBHOOK}/enviar?place_id=L` });
    const t = AGORA.getTime();
    const estado = { ...estadoNovo(t), avisados: ["outro|followup"], abertos: [{ chave: "outro|followup", token: "abc", em: t - 60_000, leadId: "outro", primeiroContato: false, produto: "site" as const, texto: "x" }] };
    const doDia = { resolvidas: { "outro|followup": { em: t - 30_000, pulou: false, como: "enviada" as const, por: "central" as const } }, primeiros: {} };
    const r = decidir(vPronto, estado, t, undefined, doDia);
    assert.equal(r.fechados.fora.length, 1);
    assert.equal(r.decisao.tipo, "avisar");
    // E a trava conta o primeiro contato que a Central fez há 1 min: o próximo espera.
    const comPrimeiro = decidir(vPronto, estadoNovo(t), t, undefined, { resolvidas: {}, primeiros: { "site:outro": { em: t - 60_000, por: "central" as const } } });
    assert.deepEqual(comPrimeiro.decisao, { tipo: "nada", motivo: "fila-vazia" });
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

// OT-09 (16/10/2026): o histórico do vendedor, para medir se a proatividade acelerou.
describe("histórico do vendedor", () => {
  const T = AGORA.getTime();
  const aberto = (chave: string, em: number, extra: Partial<AvisoAberto> = {}): AvisoAberto =>
    ({ chave, token: `t-${chave}`, em, leadId: "site:L", primeiroContato: false, produto: "site", texto: "", ...extra });

  it("aviso que fecha sem toque: 30 min vira 'expirou', sumir da fila vira 'saiu', a Central vira 'central'", () => {
    const fechados = {
      fora: [{ aberto: aberto("c|followup", T - 2 * 60_000), resolvida: { em: T - 60_000, pulou: false, como: "enviada" as const, por: "central" as const } }],
      expirados: [aberto("a|responder", T - 31 * 60_000, { tipo: "responder", quente: true })],
      sairam: [aberto("b|followup", T - 5 * 60_000)],
    };
    const ev = fechadosNaVolta(fechados, T);
    assert.deepEqual(ev.map((e) => [e.chave, e.evento]), [["c|followup", "central"], ["a|responder", "expirou"], ["b|followup", "saiu"]]);
    assert.equal(ev[1].quente, true);
    assert.equal(ev[1].esperaMs, 31 * 60_000);
    // Nos Resultados, o resolvido na Central conta como "resolvido por fora".
    assert.equal(resumoDoVendedor(ev, T).saiu, 2);
  });

  it("resumo dos 30 dias: avisos, 'Enviei' e a mediana até o toque, e os 'quero ver' à parte", () => {
    const min = 60_000;
    const r = resumoDoVendedor([
      { em: T - 40 * 86_400_000, evento: "avisado", chave: "velho" },
      { em: T - 3 * 3600_000, evento: "avisado", chave: "a", quente: true },
      { em: T - 3 * 3600_000 + 4 * min, evento: "enviei", chave: "a", quente: true, esperaMs: 4 * min },
      { em: T - 2 * 3600_000, evento: "avisado", chave: "b" },
      { em: T - 2 * 3600_000 + 20 * min, evento: "enviei", chave: "b", esperaMs: 20 * min },
      { em: T - 3600_000, evento: "avisado", chave: "c" },
      { em: T - 3600_000 + 30 * min, evento: "expirou", chave: "c", esperaMs: 30 * min },
    ], T);
    assert.equal(r.avisos, 3, "o de 40 dias fica fora");
    assert.equal(r.enviei, 2);
    assert.equal(r.expirou, 1);
    assert.equal(r.medianaAteEnvieiMin, 12);
    assert.deepEqual(r.quentes, { avisos: 1, enviei: 1, medianaAteEnvieiMin: 4 });
  });

  it("lê o histórico pulando linha cortada; arquivo ausente é lista vazia", async () => {
    const dir = await mkdtemp(join(tmpdir(), "squadone-vendedor-"));
    const arquivo = join(dir, "vendedor-historico.jsonl");
    assert.deepEqual(await lerHistoricoDoVendedor(arquivo), []);
    await writeFile(arquivo, `${JSON.stringify({ em: T, evento: "avisado", chave: "a" })}\n{"em":\n`);
    assert.deepEqual((await lerHistoricoDoVendedor(arquivo)).map((e) => e.chave), ["a"]);
    await rm(dir, { recursive: true, force: true });
  });
});

// OT-06 (16/10/2026): quem disse não ganha o desfecho na fila, e o registro "recusou" o tira do funil.
describe("desfecho: quem disse não", () => {
  const negativa = { status: "enviado", enviado_em: dias(2), respondeu_em: horas(5), resposta_tipo: "negativa", resposta_trecho: "não tenho interesse", resposta_em: horas(5) };

  it("a fila oferece marcar a recusa no lugar de responder, com o agradecimento opcional", () => {
    const v = visaoCom(negativa);
    const fila = filaDeVenda(v, LIVRE);
    assert.equal(fila.some((a) => a.tipo === "responder"), false);
    const d = fila.find((a) => a.tipo === "desfecho");
    assert.ok(d);
    assert.equal(d.anota, "recusou");
    assert.match(d.rascunho ?? "", /Obrigado pelo retorno/);
  });

  it("exclusão: marcar, sem escrever nada", () => {
    const v = visaoCom({ ...negativa, resposta_tipo: "exclusao", resposta_trecho: "pode apagar meu número" });
    const d = filaDeVenda(v, LIVRE).find((a) => a.tipo === "desfecho");
    assert.ok(d);
    assert.equal(d.link, undefined);
    assert.equal(d.rascunho, undefined);
  });

  it("o registro recusou encerra como Perdido (recusou) e o desfeito volta", () => {
    const reg = (tipo: string, em: string) => ({ em, produto: "site", id: "L", tipo, texto: "", data: "" });
    const recusado = visaoCom(negativa, [reg("recusou", horas(1))]);
    const lead = recusado.leads[0];
    assert.equal(lead.etapa, "perdido");
    assert.equal(lead.motivoPerda, "recusou");
    assert.equal(lead.perdaManual, "recusou");
    assert.equal(filaDeVenda(recusado, LIVRE).some((a) => a.leadId === lead.id), false);
    const desfeito = visaoCom(negativa, [reg("recusou", horas(2)), reg("recusou_desfeito", horas(1))]);
    assert.equal(desfeito.leads[0].etapa, "contato");
    assert.equal(desfeito.leads[0].perdaManual, undefined);
  });
});

// OT-10 (16/10/2026): metade dos sem recibo, enviados desde 17/10, recebe o follow-up do 3º dia.
describe("teste do follow-up sem recibo", () => {
  const depois = new Date("2026-10-21T13:00:00Z");
  const site = { status: "enviado", enviado_em: "2026-10-17T13:00:00.000Z" };

  it("o braço sai da chave, e só o teste recebe o follow-up sem ter lido", () => {
    const lead = visaoCom(site, [], depois).leads[0];
    assert.equal(lead.testeDoRecibo, bracoDoRecibo("L"));
    assert.equal(lead.followupHoje, bracoDoRecibo("L") === "teste");
  });

  it("enviado antes do início segue a regra antiga, e quem leu recebe como sempre", () => {
    const antigo = visaoCom({ status: "enviado", enviado_em: "2026-10-16T13:00:00.000Z" }, [], new Date("2026-10-20T13:00:00Z")).leads[0];
    assert.equal(antigo.testeDoRecibo, undefined);
    assert.equal(antigo.followupHoje, false);
    const leu = visaoCom({ ...site, visto_em: "2026-10-17T14:00:00.000Z" }, [], depois).leads[0];
    assert.equal(leu.testeDoRecibo, undefined);
    assert.equal(leu.followupHoje, true);
  });
});

// OT-15 (16/10/2026): uma regra do 3º dia para todas as ofertas, com o que muda como parâmetro.
describe("follow-up do 3º dia, uma regra só", () => {
  const T = AGORA.getTime();
  const base = { etapa: "contato" as const, emConversa: false, enviado: T - 3 * 86_400_000, leu: true, followups: [] as number[], agora: T };
  it("tabela", () => {
    assert.equal(followupDoTerceiroDia(base), true);
    assert.equal(followupDoTerceiroDia({ ...base, enviado: T - 2 * 86_400_000 }), false, "antes do 3º dia");
    assert.equal(followupDoTerceiroDia({ ...base, enviado: T - 7 * 86_400_000 }), false, "no 7º dia já é Perdido");
    assert.equal(followupDoTerceiroDia({ ...base, leu: false }), false, "sem recibo");
    assert.equal(followupDoTerceiroDia({ ...base, emConversa: true }), false);
    assert.equal(followupDoTerceiroDia({ ...base, acervo: true }), false);
    assert.equal(followupDoTerceiroDia({ ...base, followups: [T - 3600_000] }), false, "já foi");
    assert.equal(followupDoTerceiroDia({ ...base, marcadoPeloN8n: T - 86_400_000 }), false, "o 05 marcou ontem");
    assert.equal(followupDoTerceiroDia({ ...base, ultimaSaida: T - 3600_000 }), false, "já escrevemos à mão depois");
  });
});
