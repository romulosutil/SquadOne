/**
 * Fábricas para os testes de finanças (não é teste: o glob do `npm test` pega
 * só `*.test.ts`). Valores e nomes são inventados; nada aqui vem das contas
 * do Rômulo.
 */
import type { Conta, Fatura, Transacao } from "./tipos.ts";

export function conta(id: string, tipo: Conta["tipo"], extra: Partial<Conta> = {}): Conta {
  return {
    id,
    itemId: "item",
    nome: id,
    instituicao: "Banco",
    tipo,
    saldoCentavos: 0,
    limiteCentavos: null,
    limiteDisponivelCentavos: null,
    final: null,
    atualizadoEm: "2026-10-06T10:00:00Z",
    ...extra,
  };
}

export function fatura(id: string, cartaoId: string, vencimento: string, totalBanco: number, extra: Partial<Fatura> = {}): Fatura {
  return {
    id,
    cartaoId,
    fechamento: null,
    vencimento,
    totalBanco,
    pagoCentavos: 0,
    encargosCentavos: 0,
    minimoCentavos: null,
    pagamentos: [],
    ...extra,
  };
}

let seq = 0;
export function tx(contaId: string, data: string, centavos: number, descricao: string, extra: Partial<Transacao> = {}): Transacao {
  const id = extra.id ?? `t${++seq}`;
  return {
    id,
    contaId,
    fonte: "pluggy",
    idOrigem: id,
    chaveDedupe: `pluggy:${id}`,
    dataCompra: data,
    dataLancamento: data,
    descricao,
    centavos,
    natureza: centavos < 0 ? "despesa" : "receita",
    categoria: "",
    origemCategoria: "nenhuma",
    categoriaFonte: "",
    faturaId: null,
    mesFaturaFonte: null,
    parcelaN: null,
    parcelaTotal: null,
    grupoParcela: null,
    parId: null,
    status: "lancada",
    cartaoFinal: null,
    ...extra,
  };
}
