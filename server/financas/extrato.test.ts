import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeDaLeitura, parearEntreFontes } from "./dedupe.ts";
import {
  centavosDoValor,
  dataDoExtrato,
  ExtratoIlegivel,
  formatoDoTexto,
  lerCsv,
  lerExtrato,
  lerOfx,
  sugereInverter,
  transacoesDoExtrato,
} from "./extrato.ts";
import { tx } from "./teste-apoio.ts";

// Arquivos sintéticos, no formato que os bancos daqui exportam; valores inventados.

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0033<ACCTID>12345678
<BANKTRANLIST>
<DTSTART>20261001
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261003120000[-3:BRT]
<TRNAMT>-45.90
<FITID>ABC001
<MEMO>COMPRA CARTAO PADARIA X
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261005
<TRNAMT>1500,00
<FITID>ABC002
<NAME>PIX RECEBIDO
<MEMO>FULANO
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>ilegivel
<TRNAMT>-1.00
<FITID>ABC003
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const CSV_CONTA = `Extrato conta corrente
Data;Histórico;Valor (R$);Saldo
03/10/2026;"PAGAMENTO; BOLETO X";-1.234,56;100,00
03/10/2026;CAFE;-5,00;95,00
03/10/2026;CAFE;-5,00;90,00
04/10/2026;SALARIO;5.000,00;5.090,00
total;;;`;

const CSV_CARTAO_NUBANK = `date,title,amount
2026-10-01,Loja A,120.50
2026-10-02,Loja B,30
2026-10-03,Pagamento recebido,-500`;

describe("valores e datas", () => {
  const valores: [string, number | null][] = [
    ["-1.234,56", -123456],
    ["1234.56", 123456],
    ["1.200", 120000],
    ["R$ 30,00", 3000],
    ["(12,30)", -1230],
    ["45,90-", -4590],
    ["+7", 700],
    ["abc", null],
    ["", null],
  ];
  for (const [t, c] of valores) it(`valor ${JSON.stringify(t)}`, () => assert.equal(centavosDoValor(t), c));

  const datas: [string, string | null][] = [
    ["03/10/2026", "2026-10-03"],
    ["3/10/26", "2026-10-03"],
    ["2026-10-03", "2026-10-03"],
    ["20261003120000[-3:BRT]", "2026-10-03"],
    ["31/02/2026", null],
    ["ontem", null],
  ];
  for (const [t, d] of datas) it(`data ${JSON.stringify(t)}`, () => assert.equal(dataDoExtrato(t), d));
});

describe("OFX", () => {
  it("lê o SGML dos bancos, com vírgula decimal e NAME + MEMO; linha ilegível é contada", () => {
    assert.equal(formatoDoTexto(OFX_SGML), "ofx");
    const e = lerOfx(OFX_SGML);
    assert.deepEqual(e.linhas, [
      { data: "2026-10-03", descricao: "COMPRA CARTAO PADARIA X", centavos: -4590, idOrigem: "ABC001" },
      { data: "2026-10-05", descricao: "PIX RECEBIDO FULANO", centavos: 150000, idOrigem: "ABC002" },
    ]);
    assert.equal(e.ignoradas, 1);
  });

  it("chave pelo FITID: o mesmo arquivo duas vezes dá as mesmas chaves", () => {
    const a = transacoesDoExtrato(lerOfx(OFX_SGML), "cc", false).map((t) => t.chaveDedupe);
    const b = transacoesDoExtrato(lerOfx(OFX_SGML), "cc", false).map((t) => t.chaveDedupe);
    assert.deepEqual(a, ["ofx:cc:ABC001", "ofx:cc:ABC002"]);
    assert.deepEqual(a, b);
  });

  it("arquivo sem lançamento nenhum é ilegível", () => {
    assert.throws(() => lerOfx("<OFX></OFX>"), ExtratoIlegivel);
  });
});

describe("CSV", () => {
  it("acha o cabeçalho depois do título, aceita ';' e aspas, pula a linha de total", () => {
    const e = lerExtrato(CSV_CONTA);
    assert.equal(e.formato, "csv");
    assert.deepEqual(
      e.linhas.map((l) => [l.data, l.descricao, l.centavos]),
      [
        ["2026-10-03", "PAGAMENTO; BOLETO X", -123456],
        ["2026-10-03", "CAFE", -500],
        ["2026-10-03", "CAFE", -500],
        ["2026-10-04", "SALARIO", 500000],
      ],
    );
    assert.equal(e.ignoradas, 1);
  });

  it("dois cafés iguais no mesmo dia viram duas chaves; reimportar dá as mesmas", () => {
    const chaves = transacoesDoExtrato(lerCsv(CSV_CONTA), "cc", false).map((t) => t.chaveDedupe);
    assert.equal(new Set(chaves).size, 4);
    assert.deepEqual(chaves, transacoesDoExtrato(lerCsv(CSV_CONTA), "cc", false).map((t) => t.chaveDedupe));
  });

  it("CSV de cartão com a compra positiva: sugere inverter, e invertido a compra sai negativa", () => {
    const e = lerCsv(CSV_CARTAO_NUBANK);
    assert.equal(sugereInverter(e.linhas), true);
    assert.equal(sugereInverter(lerCsv(CSV_CONTA).linhas), false);
    assert.deepEqual(transacoesDoExtrato(e, "cartao", true).map((t) => t.centavos), [-12050, -3000, 50000]);
  });

  it("sem coluna de data ou de valor é ilegível", () => {
    assert.throws(() => lerCsv("nome;idade\nfulano;30"), ExtratoIlegivel);
  });
});

describe("contra a Pluggy (o mesmo gasto nunca conta duas vezes)", () => {
  const extrato = (data: string, centavos: number, descricao: string, id: string) =>
    tx("cc", data, centavos, descricao, { id, fonte: "ofx", chaveDedupe: `ofx:cc:${id}`, idOrigem: id });

  it("um a um: duas compras iguais no mesmo dia nos dois lados viram dois pares", () => {
    const pluggy = [tx("cc", "2026-10-03", -500, "CAFE DA ESQUINA"), tx("cc", "2026-10-03", -500, "CAFE DA ESQUINA")];
    const doArquivo = [extrato("2026-10-03", -500, "CAFE", "a"), extrato("2026-10-03", -500, "CAFE", "b"), extrato("2026-10-03", -500, "CAFE", "c")];
    const pares = parearEntreFontes(doArquivo, pluggy);
    assert.equal(pares.size, 2);
    assert.equal(new Set(pares.values()).size, 2);
  });

  it("descrição diferente casa só quando há um candidato; data a até 2 dias; conta e valor iguais", () => {
    const pluggy = [tx("cc", "2026-10-03", -4590, "PIX TRANSF FULANO")];
    assert.equal(parearEntreFontes([extrato("2026-10-05", -4590, "TRANSFERENCIA ENVIADA", "x")], pluggy).size, 1);
    assert.equal(parearEntreFontes([extrato("2026-10-06", -4590, "TRANSFERENCIA ENVIADA", "x")], pluggy).size, 0);
    assert.equal(parearEntreFontes([extrato("2026-10-03", -4591, "PIX TRANSF FULANO", "x")], pluggy).size, 0);
    const doisNaPluggy = [...pluggy, tx("cc", "2026-10-04", -4590, "BOLETO Y")];
    assert.equal(parearEntreFontes([extrato("2026-10-03", -4590, "OUTRA COISA", "x")], doisNaPluggy).size, 0);
  });

  it("a conexão voltou: a Pluggy vence e a linha do extrato sai", () => {
    const existentes = [extrato("2026-10-03", -4590, "COMPRA CARTAO PADARIA X", "ABC001"), extrato("2026-10-04", -100, "SO NO ARQUIVO", "ABC009")];
    const novas = [tx("cc", "2026-10-03", -4590, "PADARIA X", { id: "pluggy:p1", chaveDedupe: "pluggy:p1" })];
    const { remover } = dedupeDaLeitura(novas, existentes, new Set(["cc"]));
    assert.deepEqual(remover, ["ABC001"]);
  });
});
