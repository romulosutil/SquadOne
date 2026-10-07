import { descricaoNormalizada, hashCurto, mesesEntre, somarMeses } from "./comum.ts";
import type { Transacao } from "./tipos.ts";

/**
 * Parcelas. PURO.
 *
 * A Pluggy dá `installmentNumber`/`totalInstallments` em cada parcela, mas não
 * um id da compra: a parcela 3/10 de setembro e a 4/10 de outubro chegam como
 * lançamentos soltos. O grupo é heurístico: mesmo cartão, mesma descrição
 * normalizada, mesmo total de parcelas e, para dizer que é a MESMA compra:
 *
 * - **a data da compra**, quando a fonte dá (`purchaseDate` da Pluggy, a data
 *   da linha no PDF do Santander). Datas diferentes são compras diferentes,
 *   mesmo com o mesmo valor (a mesma compra repetida todo mês na mesma loja,
 *   que pelo mês de origem se misturava). Na mesma data, o valor da parcela
 *   pode variar uns centavos: o Santander e o Mercado Pago cobram as primeiras
 *   um pouco acima das outras (visto até 9 centavos em 10/2026), e com a
 *   tolerância de 1 centavo a compra virava dois grupos e a projeção contava
 *   as parcelas que faltam duas vezes. Por isso aqui a tolerância é 1% do
 *   valor;
 * - **sem a data**, o valor da parcela (±1 centavo, o arredondamento da
 *   última) e o MÊS DE ORIGEM (o mês da fatura menos n−1, com folga de 1 mês
 *   para o fechamento que caiu num ciclo vizinho).
 *
 * Com mais de um grupo possível, vale o de valor mais próximo. Duas compras
 * iguais no mesmo dia na mesma loja e mesmo parcelamento: a segunda parcela
 * "3/10" não cabe no grupo que já tem a 3, e abre outro. As duas sequências
 * ficam separadas e a projeção conta as duas.
 */

export interface ParcelaDeEntrada {
  id: string;
  contaId: string;
  descricao: string;
  centavos: number;
  parcelaN: number | null;
  parcelaTotal: number | null;
  /** Mês (AAAA-MM) em que a parcela é cobrada: o da fatura. */
  mes: string;
  /** Data da compra original (AAAA-MM-DD) e a do lançamento; sem elas, só a heurística do mês de origem. */
  dataCompra?: string | null;
  dataLancamento?: string | null;
}

interface GrupoInterno {
  id: string;
  contaId: string;
  desc: string;
  total: number;
  valor: number;
  origem: string;
  /** Data da compra, quando alguma parcela do grupo a trouxe. */
  compra: string | null;
  numeros: Set<number>;
}

/** Diferença de valor aceita entre parcelas da mesma compra com a mesma data: 1% (mínimo 1 centavo). */
export function toleranciaDoValor(valor: number): number {
  return Math.max(1, Math.round(valor / 100));
}

/**
 * A data da compra, quando dá para confiar nela. Sem `purchaseDate`, a Pluggy
 * repete nela a data do lançamento (`pluggy-mapa.ts`), e da parcela 2 em
 * diante isso não é a compra: a parcela 4/10 lançada em setembro diria que a
 * compra foi em setembro.
 */
export function dataDaCompra(p: Pick<ParcelaDeEntrada, "parcelaN" | "dataCompra" | "dataLancamento">): string | null {
  if (!p.dataCompra) return null;
  if (p.parcelaN === 1) return p.dataCompra;
  return p.dataLancamento && p.dataCompra !== p.dataLancamento ? p.dataCompra : null;
}

/** Id do grupo de cada parcela (só as que têm n/total com total > 1). */
export function agruparParcelas(parcelas: ParcelaDeEntrada[]): Map<string, string> {
  const resultado = new Map<string, string>();
  const grupos: GrupoInterno[] = [];
  const ordenadas = parcelas
    .filter((p) => p.parcelaN && p.parcelaTotal && p.parcelaTotal > 1 && p.parcelaN <= p.parcelaTotal)
    .sort((a, b) => a.mes.localeCompare(b.mes) || a.parcelaN! - b.parcelaN! || a.id.localeCompare(b.id));

  for (const p of ordenadas) {
    const desc = descricaoNormalizada(p.descricao);
    const valor = Math.abs(p.centavos);
    const origem = somarMeses(p.mes, -(p.parcelaN! - 1));
    const compra = dataDaCompra(p);
    const candidatos = grupos.filter((g) => {
      if (g.contaId !== p.contaId || g.desc !== desc || g.total !== p.parcelaTotal) return false;
      // O grupo que ainda não tem este número; se todos têm, é outra compra igual (grupo novo).
      if (g.numeros.has(p.parcelaN!)) return false;
      if (g.compra && compra) return g.compra === compra && Math.abs(g.valor - valor) <= toleranciaDoValor(Math.max(g.valor, valor));
      return Math.abs(g.valor - valor) <= 1 && Math.abs(mesesEntre(g.origem, origem)) <= 1;
    });
    const grupo = candidatos.reduce<GrupoInterno | undefined>(
      (melhor, g) => (melhor === undefined || Math.abs(g.valor - valor) < Math.abs(melhor.valor - valor) ? g : melhor),
      undefined,
    );
    if (grupo) {
      grupo.numeros.add(p.parcelaN!);
      grupo.compra ??= compra;
      resultado.set(p.id, grupo.id);
      continue;
    }
    const novo: GrupoInterno = {
      id: `g${hashCurto([p.contaId, desc, p.parcelaTotal, valor, origem, grupos.length].join("|"))}`,
      contaId: p.contaId,
      desc,
      total: p.parcelaTotal!,
      valor,
      origem,
      compra,
      numeros: new Set([p.parcelaN!]),
    };
    grupos.push(novo);
    resultado.set(p.id, novo.id);
  }
  return resultado;
}

export interface ParcelamentoProjetado {
  grupo: string;
  contaId: string;
  descricao: string;
  valorParcela: number;
  total: number;
  /** Última parcela já vista (n) e o mês dela. */
  ultimaVista: number;
  /** Parcelas que ainda vão ser cobradas: as vistas depois de `aPartirDe` e as projetadas desde ele. */
  restantes: number;
  /** Mês (AAAA-MM) da última parcela. */
  acabaEm: string;
  /** Mês → centavos ainda a cobrar (o próprio `aPartirDe` só com parcela projetada). */
  porMes: Record<string, number>;
}

/**
 * Projeção das parcelas que faltam. `aPartirDe` é o mês da fatura aberta.
 *
 * - Parcela que a fonte já LISTOU conta pelo próprio lançamento, e só depois
 *   desse mês: até ele, o lançamento já está na fatura fechada ou na aberta, e
 *   contá-lo aqui somaria duas vezes no "devo".
 * - Parcela que a fonte ainda NÃO listou é projetada a partir da última vista
 *   e conta DESDE o mês da fatura aberta. O banco só lista a parcela quando a
 *   lança, e o Santander e o Mercado Pago lançam no dia do fechamento: até lá
 *   a parcela da fatura aberta não está em lançamento nenhum, e pulá-la a
 *   deixava fora do "devo" (o mês inteiro de parcelas virava "sem detalhe").
 */
export function projetarParcelas(
  parcelas: (ParcelaDeEntrada & { grupo: string })[],
  aPartirDe: (contaId: string) => string,
): ParcelamentoProjetado[] {
  const porGrupo = new Map<string, (ParcelaDeEntrada & { grupo: string })[]>();
  for (const p of parcelas) {
    if (!porGrupo.has(p.grupo)) porGrupo.set(p.grupo, []);
    porGrupo.get(p.grupo)!.push(p);
  }
  const saida: ParcelamentoProjetado[] = [];
  for (const [grupo, lista] of porGrupo) {
    lista.sort((a, b) => a.parcelaN! - b.parcelaN! || a.mes.localeCompare(b.mes));
    const ultima = lista[lista.length - 1];
    const total = ultima.parcelaTotal!;
    const valor = Math.abs(ultima.centavos);
    const limite = aPartirDe(ultima.contaId);
    const porMes: Record<string, number> = {};
    // Vistas, depois do limite.
    for (const p of lista) if (p.mes > limite) porMes[p.mes] = (porMes[p.mes] ?? 0) + Math.abs(p.centavos);
    // Projetadas: n+1..total depois da última vista, um mês cada, a partir do limite.
    for (let k = ultima.parcelaN! + 1; k <= total; k++) {
      const mes = somarMeses(ultima.mes, k - ultima.parcelaN!);
      if (mes >= limite) porMes[mes] = (porMes[mes] ?? 0) + valor;
    }
    const acabaEm = somarMeses(ultima.mes, total - ultima.parcelaN!);
    const restantes = Object.values(porMes).reduce((s, c) => s + c, 0);
    saida.push({
      grupo,
      contaId: ultima.contaId,
      descricao: ultima.descricao,
      valorParcela: valor,
      total,
      ultimaVista: ultima.parcelaN!,
      restantes: valor > 0 ? Math.round(restantes / valor) : 0,
      acabaEm,
      porMes,
    });
  }
  return saida.sort((a, b) => a.acabaEm.localeCompare(b.acabaEm) || a.descricao.localeCompare(b.descricao));
}
