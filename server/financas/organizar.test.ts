import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import type { Aviso } from "../avisos.ts";
import { abrirBanco, type BancoDeFinancas } from "./banco.ts";
import { criarRotasDeFinancas, type EstadoDasFinancas } from "./rotas.ts";
import { CONTA_MANUAL } from "./resumo.ts";
import { anotarGasto, criarAvisador, depoisDeEscrever, resumoDoBanco } from "./servico.ts";
import { reprocessar } from "./sync.ts";
import { conta, tx } from "./teste-apoio.ts";

// A organização de ponta a ponta, com o SQLite num diretório temporário (nunca
// data/) e as rotas de verdade. Pedido local direto (sem Serve); escrita com a
// mesma origem. Valores e estabelecimentos inventados.

const AGORA = new Date("2026-10-20T15:00:00Z");
const LOCAL = { host: "127.0.0.1:9120" };
const ESCRITA = { ...LOCAL, origin: "http://127.0.0.1:9120", "content-type": "application/json" };

let dir: string;
let banco: BancoDeFinancas;
let servidor: http.Server;
let porta = 0;
const publicados: Aviso[] = [];

function pedir(metodo: string, caminho: string, corpo?: unknown, headers: Record<string, string> = metodo === "GET" ? LOCAL : ESCRITA) {
  return new Promise<{ status: number; corpo: any }>((resolve, reject) => {
    const dados = corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo);
    const req = http.request({ host: "127.0.0.1", port: porta, path: `/api/financas${caminho}`, method: metodo, headers }, (res) => {
      let texto = "";
      res.on("data", (c) => (texto += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: texto ? JSON.parse(texto) : null }));
    });
    req.on("error", reject);
    if (dados) req.write(dados);
    req.end();
  });
}

const esperar = async () => {
  for (let i = 0; i < 5; i++) await new Promise((ok) => setImmediate(ok));
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "financas-org-"));
  banco = await abrirBanco(dir);
  banco.gravarLeitura({
    conexao: { itemId: "item", nome: "Banco Teste", status: "UPDATED", executionStatus: "SUCCESS", dadosAte: "2026-10-20T09:00:00Z", consentimentoAte: null, lidoEm: null, erroLeitura: null },
    contas: [
      conta("cc", "corrente", { saldoCentavos: 300_000 }),
      conta("cartao", "cartao", { nome: "Cartão Teste", limiteCentavos: 1_000_000, limiteDisponivelCentavos: 250_000 }),
    ],
    faturas: [],
    transacoes: [
      tx("cc", "2026-10-02", -1_500, "PADARIA DO BAIRRO", { id: "pluggy:p1", chaveDedupe: "pluggy:p1" }),
      tx("cc", "2026-10-09", -1_800, "PADARIA DO BAIRRO", { id: "pluggy:p2", chaveDedupe: "pluggy:p2" }),
      tx("cc", "2026-10-05", -20_000, "SUPERMERCADO X", { id: "pluggy:m1", chaveDedupe: "pluggy:m1" }),
      tx("cc", "2026-10-06", -4_590, "COMPRA CARTAO FARMACIA", { id: "pluggy:f1", chaveDedupe: "pluggy:f1" }),
    ],
    removerTransacoes: [],
  });
  reprocessar(banco);
  const estado: EstadoDasFinancas = {
    banco,
    sincronizador: null,
    avisador: criarAvisador({ banco, publicar: async (a) => void publicados.push(a), agora: () => AGORA }),
    problema: null,
  };
  const app = express();
  app.use("/api/financas", criarRotasDeFinancas(estado, { logins: new Set(), agora: () => AGORA }));
  servidor = http.createServer(app);
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  porta = (servidor.address() as AddressInfo).port;
});

after(() => {
  servidor.close();
  banco.fechar();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("categoria e regra por estabelecimento", () => {
  it("corrigir com 'aplicar sempre' vira regra e pega os outros do mesmo estabelecimento", async () => {
    const r = await pedir("PATCH", "/lancamentos/pluggy%3Ap1", { categoria: "Café da manhã", aplicarSempre: true });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.regra, "PADARIA DO BAIRRO");
    const p2 = banco.transacao("pluggy:p2")!;
    assert.deepEqual([p2.categoria, p2.origemCategoria], ["Café da manhã", "regra_usuario"]);
    const org = await pedir("GET", "/organizacao");
    assert.deepEqual(org.corpo.regras, [{ estabelecimento: "PADARIA DO BAIRRO", categoria: "Café da manhã", lancamentos: 2 }]);
    assert.ok(org.corpo.categorias.some((c: any) => c.nome === "Café da manhã" && c.lancamentos === 2));
  });

  it("sem 'aplicar sempre' muda só aquele lançamento", async () => {
    await pedir("PATCH", "/lancamentos/pluggy%3Ap2", { categoria: "Lazer" });
    assert.equal(banco.transacao("pluggy:p2")!.categoria, "Lazer");
    assert.equal(banco.transacao("pluggy:p1")!.categoria, "Café da manhã");
  });

  it("categoria fixa não se escolhe à mão; nome vazio é 400", async () => {
    assert.equal((await pedir("PATCH", "/lancamentos/pluggy%3Ap1", { categoria: "Pagamento de fatura" })).status, 400);
    assert.equal((await pedir("PATCH", "/lancamentos/pluggy%3Ap1", { categoria: " " })).status, 400);
  });

  it("escrita sem a mesma origem é recusada", async () => {
    const r = await pedir("PATCH", "/lancamentos/pluggy%3Ap1", { categoria: "Lazer" }, { ...LOCAL, "content-type": "application/json" });
    assert.equal(r.status, 403);
  });

  it("renomear sobrevive ao passe seguinte; remover junta em Outros", async () => {
    assert.equal(banco.transacao("pluggy:m1")!.categoria, "Mercado");
    assert.equal((await pedir("POST", "/categorias/renomear", { de: "Mercado", para: "Supermercado" })).status, 200);
    reprocessar(banco);
    assert.equal(banco.transacao("pluggy:m1")!.categoria, "Supermercado");
    assert.equal((await pedir("POST", "/categorias/remover", { nome: "Supermercado" })).status, 200);
    reprocessar(banco);
    assert.equal(banco.transacao("pluggy:m1")!.categoria, "Outros");
    assert.equal((await pedir("POST", "/categorias/remover", { nome: "Outros" })).status, 400);
  });

  it("criar categoria que já existe (com outra grafia) é 400", async () => {
    assert.equal((await pedir("POST", "/categorias", { nome: "Pet" })).status, 200);
    assert.equal((await pedir("POST", "/categorias", { nome: "pet" })).status, 400);
  });
});

describe("orçamento e alertas", () => {
  it("orçamento aparece na visão com a %, e o alerta sai uma vez, sem R$", async () => {
    assert.equal((await pedir("PUT", "/orcamento", { categoria: "Farmácia", centavos: 5_000 })).status, 200);
    await esperar();
    const v = await pedir("GET", "/visao");
    assert.deepEqual(
      v.corpo.orcamento.categorias.map((c: any) => [c.categoria, c.pct, c.semaforo]),
      [["Farmácia", 91, "laranja"]],
    );
    // Cartão em 75% do limite (avisado já na primeira escrita lá em cima) e Farmácia em 91%.
    assert.deepEqual(publicados.map((a) => a.titulo).sort(), ["🟠 Orçamento de Farmácia: 91%", "🟡 Cartão Cartão Teste: 75% do limite"]);
    for (const a of publicados) assert.ok(!/R\s*\$|45,90|4590/.test(`${a.titulo} ${a.texto}`));
    await pedir("PUT", "/orcamento", { categoria: "Farmácia", centavos: 5_000 });
    await esperar();
    assert.equal(publicados.length, 2, "a mesma faixa não avisa de novo");
  });

  it("simular devolve o que sairia, sem publicar nem marcar", async () => {
    // Direto no banco, sem a rota: nada foi publicado para este orçamento ainda.
    banco.definirOrcamento("Café da manhã", 1_000);
    const antes = publicados.length;
    const s1 = await pedir("POST", "/alertas/simular");
    const s2 = await pedir("POST", "/alertas/simular");
    assert.deepEqual(s1.corpo.alertas.map((a: Aviso) => a.titulo), ["🔴 Orçamento de Café da manhã: 150%"]);
    assert.deepEqual(s2.corpo, s1.corpo);
    assert.equal(publicados.length, antes);
    assert.equal((await pedir("PUT", "/orcamento", { categoria: "Lazer", centavos: -1 })).status, 400);
  });

  it("estado da sala: só % e semáforo", async () => {
    const r = await pedir("GET", "/estado");
    assert.deepEqual(r.corpo.cartao, { pct: 75, semaforo: "amarelo", nome: "Cartão Teste" });
    assert.equal(typeof r.corpo.orcamento.pct, "number");
    assert.ok(!JSON.stringify(r.corpo).includes("Centavos"));
  });
});

describe("recorrentes", () => {
  it("marcar e desmarcar; null volta para a detecção", async () => {
    assert.equal((await pedir("PUT", "/recorrentes", { estabelecimento: "SUPERMERCADO X", recorrente: true })).status, 200);
    let v = await pedir("GET", "/visao");
    assert.deepEqual(v.corpo.recorrentes.map((r: any) => [r.estabelecimento, r.origem]), [["SUPERMERCADO X", "marcado"]]);
    const l = await pedir("GET", "/lancamentos");
    assert.equal(l.corpo.lancamentos.find((x: any) => x.id === "pluggy:m1").recorrente, true);
    await pedir("PUT", "/recorrentes", { estabelecimento: "SUPERMERCADO X", recorrente: false });
    v = await pedir("GET", "/visao");
    assert.equal(v.corpo.recorrentes.length, 0);
    assert.equal(v.corpo.recorrentesDesmarcados[0].estabelecimento, "SUPERMERCADO X");
    assert.equal((await pedir("PUT", "/recorrentes", { estabelecimento: "SUPERMERCADO X", recorrente: "sim" })).status, 400);
    await pedir("PUT", "/recorrentes", { estabelecimento: "SUPERMERCADO X", recorrente: null });
    assert.equal((await pedir("GET", "/visao")).corpo.recorrentesDesmarcados.length, 0);
  });
});

describe("extrato OFX de reserva", () => {
  const ofx = (linhas: [string, string, string, string][]) =>
    `OFXHEADER:100\n<OFX><BANKTRANLIST>${linhas.map(([d, v, id, memo]) => `<STMTTRN><DTPOSTED>${d}<TRNAMT>${v}<FITID>${id}<MEMO>${memo}</STMTTRN>`).join("")}</BANKTRANLIST></OFX>`;
  const arquivo = ofx([
    ["20261005", "-200.00", "F1", "SUPERMERCADO X LTDA"],
    ["20261011", "-77.00", "F2", "LOJA SO NO EXTRATO"],
  ]);
  const enviar = (q: string) => pedir("POST", `/importar/extrato?${q}`, arquivo, { ...LOCAL, origin: "http://127.0.0.1:9120", "content-type": "application/octet-stream" });

  it("sem conta pede a conta", async () => {
    const r = await enviar("");
    assert.equal(r.status, 400);
    assert.equal(r.corpo.escolherConta, true);
    assert.ok(!r.corpo.contas.some((c: any) => c.id === CONTA_MANUAL));
  });

  it("prévia não grava; o que a Pluggy já tem não entra; reimportar não duplica", async () => {
    const previa = await enviar("conta=cc");
    assert.equal(previa.status, 200);
    assert.deepEqual([previa.corpo.lidos, previa.corpo.novos, previa.corpo.jaEstavam, previa.corpo.gravado], [2, 1, 1, false]);
    assert.equal(banco.transacoesDasContas(["cc"]).length, 4);
    const gravado = await enviar("conta=cc&confirmar=1");
    assert.equal(gravado.status, 201);
    assert.equal(banco.transacoesDasContas(["cc"]).length, 5);
    const de_novo = await enviar("conta=cc&confirmar=1");
    assert.equal(de_novo.corpo.novos, 0);
    assert.equal(banco.transacoesDasContas(["cc"]).length, 5);
  });
});

describe("gasto anotado pelo Telegram", () => {
  it("entra na conta manual uma vez só, conta no gastei e fica fora do tenho", () => {
    const antes = resumoDoBanco(banco, "2026-10-20", "2026-10", "competencia");
    const a = anotarGasto(banco, { centavos: 3_000, onde: "farmácia" }, "tg:111:50", AGORA);
    const b = anotarGasto(banco, { centavos: 3_000, onde: "farmácia" }, "tg:111:50", AGORA);
    depoisDeEscrever(banco, null);
    assert.equal(a.novo, true);
    assert.equal(b.novo, false);
    assert.equal(a.categoria, "Farmácia");
    assert.equal(banco.transacoesDasContas([CONTA_MANUAL]).length, 1);
    const depois = resumoDoBanco(banco, "2026-10-20", "2026-10", "competencia");
    assert.equal(depois.gastei.totalCentavos - antes.gastei.totalCentavos, 3_000);
    assert.equal(depois.tenho.totalCentavos, antes.tenho.totalCentavos);
    assert.ok(!depois.tenho.contas.some((c) => c.id === CONTA_MANUAL));
    assert.equal(banco.transacao("manual:tg:111:50")!.dataCompra, "2026-10-20");
  });
});
