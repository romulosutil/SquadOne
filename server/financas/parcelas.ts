import { descricaoNormalizada, hashCurto, mesesEntre, somarMeses } from "./comum.ts";
import type { Transacao } from "./tipos.ts";

/**
 * Parcelas. PURO.
 *
 * A Pluggy dá `installmentNumber`/`totalInstallments` em cada parcela, mas não
 * um id da compra: a parcela 3/10 de setembro e a 4/10 de outubro chegam como
 * lançamentos soltos. O grupo é heurístico — mesmo cartão, mesma descrição
 * normalizada, mesmo total de parcelas, mesmo valor de parcela (±1 centavo,
 * o arredondamento da última) e o mesmo MÊS DE ORIGEM (o mês da fatura menos
 * n−1, com folga de 1 mês para o fechamento que caiu num ciclo vizinho).
 *
 * Duas compras iguais no mesmo mês na mesma loja e mesmo parcelamento: a
 * segunda parcela "3/10" não cabe no grupo que já tem a 3, e abre outro. As
 * duas sequências ficam separadas e a projeção conta as duas.
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
}

interface GrupoInterno {
  id: string;
  contaId: string;
  desc: string;
  total: number;
  valor: number;
  origem: string;
  numeros: Set<number>;
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
    const candidatos = grupos.filter(
      (g) =>
        g.contaId === p.contaId &&
        g.desc === desc &&
        g.total === p.parcelaTotal &&
        Math.abs(g.valor - valor) <= 1 &&
        Math.abs(mesesEntre(g.origem, origem)) <= 1,
    );
    // O grupo que ainda não tem este número; se todos têm, é outra compra igual (grupo novo).
    const grupo = candidatos.find((g) => !g.numeros.has(p.parcelaN!));
    if (grupo) {
      grupo.numeros.add(p.parcelaN!);
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
  /** Parcelas que ainda vão ser cobradas DEPOIS de `aPartirDe` (vistas ou projetadas). */
  restantes: number;
  /** Mês (AAAA-MM) da última parcela. */
  acabaEm: string;
  /** Mês → centavos ainda a cobrar (só meses depois de `aPartirDe`). */
  porMes: Record<string, number>;
}

/**
 * Projeção das parcelas que faltam. `aPartirDe` é o último mês que já está
 * contado em outro lugar (a fatura aberta): só o que vem DEPOIS dele entra,
 * para a parcela deste mês não somar duas vezes no "devo" — uma na fatura,
 * outra na projeção. Parcela futura que a fonte já listou conta pelo próprio
 * lançamento; a que não listou é projetada a partir da última vista.
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
    // Projetadas: n+1..total depois da última vista, um mês cada.
    for (let k = ultima.parcelaN! + 1; k <= total; k++) {
      const mes = somarMeses(ultima.mes, k - ultima.parcelaN!);
      if (mes > limite) porMes[mes] = (porMes[mes] ?? 0) + valor;
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
