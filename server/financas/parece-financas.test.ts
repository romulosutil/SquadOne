import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { omitirValores, pareceFinancas, temValorEmDinheiro } from "./parece-financas.ts";

// A regra que decide o que nem sai do processo (RULES 24, 27 e 28): o Assistente da Central, o Jev
// em sombra e os títulos de agenda que o Assistente lê. A tabela de "barra" é a da revisão
// adversarial de 17/10/2026 (tudo isso passava); a de "passa" é o que o painel ouve todo dia e não
// pode virar "isso fica em Finanças".

describe("pareceFinancas: barra", () => {
  const barra = [
    // plurais e derivados
    "faturas atrasadas", "boletos de outubro", "orçamentos da semana", "faturamento do PRUMO", "lucro do mês", "gastos do mês",
    "despesas de outubro", "parcelas do carro",
    // moeda escrita de outro jeito
    "R $ 500", "R＄500", "BRL 900", "US$ 30", "$ 30", "€ 40", "r$", "R$1.200",
    // dívida, contas da casa, bancos
    "quanto devo no cartão", "quanto devo no cartão do Nubank?", "devo 300 pro João", "conta de luz venceu", "pagar o condomínio",
    "aluguel", "quanto custa o aluguel", "nubank", "meu cartão Nubank fecha dia 5", "saldo no Itaú", "transferi 300 pro João",
    "transferência para a Caixa Econômica", "pix da Padaria",
    // número com cara de dinheiro, sem "R$"
    "vou pagar 1.200 do aluguel amanhã", "a proposta foi de 1.500", "cobrei 1500 da Padaria", "preço do site é 900", "fechou 900",
    "recebi 500 do cliente", "1200 reais", "900 conto", "mil e duzentos reais", "1,2k", "2 mil na conta", "12x de 49", "39 por mês",
    "quanto cobrar da Padaria?", "valor da proposta da Padaria", "quanto entrou de venda esse mês", "quanto sobrou?",
    // o que já barrava
    "gastei 30 no mercado", "paguei a fatura do cartão", "salário", "IPTU", "financeiro", "Finanças", "investimentos",
  ];
  for (const t of barra) it(t, () => assert.equal(pareceFinancas(t), true));
});

describe("pareceFinancas: passa", () => {
  const passa = [
    "o que devo responder para a Padaria?", "devo mandar a proposta hoje?", "O que respondo para Kulniski Advocacia?",
    "Em que pé está?", "Anotar o próximo passo", "como abordar a Kulniski?", "quais os 10 leads mais quentes?",
    "mil desculpas pela demora", "ligar por 30 minutos amanhã", "perfil com 10k seguidores", "tráfego pago funciona para padaria?",
    "caixa de entrada do WhatsApp", "o cartão que você propôs", "conta do Instagram", "Gastronomia em Vitória",
    "transferir a reunião para quinta", "mandei proposta para 12 leads", "fechou 3 leads", "reunião às 14:30 em 2026-10-20",
    "CPF 529.982.247-25", "cartão de visita novo", "o Dell está bem?",
  ];
  for (const t of passa) it(t, () => assert.equal(pareceFinancas(t), false));
});

describe("omitirValores e temValorEmDinheiro", () => {
  const casos: Array<[string, string]> = [
    ["R$ 1.200,00", "[valor omitido]"],
    ["R$ 1,2 mil", "[valor omitido]"],
    ["R$ mil", "[valor omitido]"],
    ["Fechou por 1.200 no boleto", "Fechou por [valor omitido] no boleto"],
    ["a parcela fica 49,90", "a parcela fica [valor omitido]"],
    ["900 USD", "[valor omitido]"],
    ["CNPJ 12.345.678/0001-90", "CNPJ 12.345.678/0001-90"],
    ["16/10/2026 às 14:05", "16/10/2026 às 14:05"],
  ];
  for (const [entrada, saida] of casos) {
    it(JSON.stringify(entrada), () => {
      assert.equal(omitirValores(entrada), saida);
      assert.equal(temValorEmDinheiro(entrada), saida !== entrada);
    });
  }
  it("o rótulo é trocável e não deixa dígito de valor para trás", () => {
    assert.equal(omitirValores("fica 690 reais", "[valor]"), "fica [valor]");
    assert.doesNotMatch(omitirValores("proposta 1.200, entrada de 300 e 12x de 49"), /\d/);
  });
});
