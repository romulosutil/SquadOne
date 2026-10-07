import { categorizar } from "./categoria.ts";
import { mesDe } from "./comum.ts";
import { naturezaDaLinha, pagamentosDeFaturaPeloValor } from "./natureza.ts";
import { agruparParcelas } from "./parcelas.ts";
import { parearTransferencias } from "./transferencias.ts";
import type { Conta, Fatura, Transacao } from "./tipos.ts";
import { faturaDoLancamento, mesDaFatura, type ContextoDasVisoes } from "./visoes.ts";

/**
 * O passe que deriva tudo o que não vem pronto da fonte. PURO e refeito do
 * zero a cada sincronização, sobre TODOS os lançamentos gravados: o par de uma
 * transferência pode estar em outra conexão, e a fatura de um lançamento só
 * existe depois de lida. Nesta ordem:
 *
 * 1. natureza pela linha (`natureza.ts`);
 * 2. fatura de cada lançamento do cartão (a da fonte, se ela deu; senão pelo
 *    fechamento);
 * 3. pagamento de fatura pelo valor (o débito de descrição muda);
 * 4. pares entre contas próprias (transferência ou pagamento);
 * 5. grupos de parcela;
 * 6. categoria (a do Rômulo nunca muda), com as regras dele por
 *    estabelecimento e os renomes de categoria por cima.
 */

/** O que o Rômulo organizou e o passe precisa saber (tabelas do banco, migração 2). */
export interface OrganizacaoDoPasse {
  /** Estabelecimento (`estabelecimentoDe`) → categoria. */
  regras: ReadonlyMap<string, string>;
  /**
   * Categoria antiga → nome novo. A regra embutida continua produzindo
   * "Mercado"; depois de renomeada para "Supermercado", é este mapa que
   * mantém o nome novo a cada sincronização.
   */
  renomes: ReadonlyMap<string, string>;
}

const SEM_ORGANIZACAO: OrganizacaoDoPasse = { regras: new Map(), renomes: new Map() };

export function contextoDas(contas: Conta[], faturas: Fatura[]): ContextoDasVisoes {
  const tipos = new Map(contas.map((c) => [c.id, c.tipo]));
  const porId = new Map(faturas.map((f) => [f.id, f]));
  const porCartao = new Map<string, Fatura[]>();
  for (const f of faturas) {
    if (!porCartao.has(f.cartaoId)) porCartao.set(f.cartaoId, []);
    porCartao.get(f.cartaoId)!.push(f);
  }
  return {
    tipoDaConta: (id) => tipos.get(id),
    faturaPorId: (id) => porId.get(id),
    faturasDoCartao: (id) => porCartao.get(id) ?? [],
  };
}

export function processar(contas: Conta[], faturas: Fatura[], transacoes: Transacao[], org: OrganizacaoDoPasse = SEM_ORGANIZACAO): Transacao[] {
  const ctx = contextoDas(contas, faturas);
  const saida = transacoes.map((t): Transacao => {
    const tipo = ctx.tipoDaConta(t.contaId) ?? "corrente";
    let faturaId = t.faturaId && ctx.faturaPorId(t.faturaId)?.cartaoId === t.contaId ? t.faturaId : null;
    if (tipo === "cartao" && !faturaId) faturaId = faturaDoLancamento(t.dataLancamento, ctx.faturasDoCartao(t.contaId))?.id ?? null;
    return {
      ...t,
      natureza: naturezaDaLinha(t, tipo, { categoriaFonte: t.categoriaFonte }),
      faturaId: tipo === "cartao" ? faturaId : null,
      parId: null,
      grupoParcela: null,
    };
  });
  const porId = new Map(saida.map((t) => [t.id, t]));

  for (const id of pagamentosDeFaturaPeloValor(saida, faturas, ctx.tipoDaConta)) porId.get(id)!.natureza = "pagamento_fatura";

  for (const par of parearTransferencias(saida, ctx.tipoDaConta)) {
    const saidaT = porId.get(par.saidaId)!;
    const entrada = porId.get(par.entradaId)!;
    saidaT.natureza = entrada.natureza = par.natureza;
    saidaT.parId = entrada.id;
    entrada.parId = saidaT.id;
  }

  const grupos = agruparParcelas(
    saida.map((t) => ({
      ...t,
      mes: ctx.tipoDaConta(t.contaId) === "cartao" ? mesDaFatura(t, ctx) : mesDe(t.dataLancamento),
    })),
  );
  for (const t of saida) {
    t.grupoParcela = grupos.get(t.id) ?? null;
    const c = categorizar(t, org.regras);
    Object.assign(t, { ...c, categoria: org.renomes.get(c.categoria) ?? c.categoria });
  }
  return saida;
}
