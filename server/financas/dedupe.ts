import { descricaoNormalizada, diasEntre, hashCurto } from "./comum.ts";
import type { Fonte, Transacao } from "./tipos.ts";

/**
 * Deduplicação. PURO.
 *
 * Três jeitos de o mesmo gasto entrar duas vezes, e o que fazer com cada um:
 *
 * 1. **PENDENTE → LANÇADO.** A compra autorizada chega `PENDING` e, dias
 *    depois, `POSTED` — às vezes com outro id na Pluggy. O lançado substitui o
 *    pendente correspondente (mesma conta, mesmo valor, descrição parecida, a
 *    até `DIAS_PENDENTE` dias). Pendente que a fonte deixou de listar sem
 *    lançado correspondente também sai: a autorização caiu.
 * 2. **Id trocado na fonte.** Lançado no banco que sumiu da leitura, mas tem
 *    um lançado novo idêntico (conta, valor, data, descrição): é o mesmo, sai
 *    o antigo. Lançado que sumiu SEM gêmeo fica: a Pluggy guarda uns 12
 *    meses, e apagar o histórico mais velho seria perder o que já se sabia.
 * 3. **Duas fontes.** A fatura em PDF do Santander cobre o que a Pluggy não
 *    traz; se um dia a Pluggy passar a trazer, o lançamento dela vence e o do
 *    PDF sai (mesma conta, valor, data da compra a ±1 dia, mesma parcela).
 *
 * A `chaveDedupe` (UNIQUE no banco) garante a idempotência de cada fonte:
 * ler a Pluggy ou reimportar o mesmo PDF duas vezes não duplica nada.
 */

export const DIAS_PENDENTE = 5;

export function chaveDedupe(
  fonte: Fonte,
  t: { contaId: string; idOrigem?: string; dataCompra: string; centavos: number; descricao: string; parcelaN?: number | null; parcelaTotal?: number | null; faturaId?: string | null },
  ocorrencia = 0,
): string {
  if (fonte === "pluggy" && t.idOrigem) return `pluggy:${t.idOrigem}`;
  if (fonte === "ofx" && t.idOrigem) return `ofx:${t.contaId}:${t.idOrigem}`;
  // Sem id na fonte: o conteúdo + a ordem entre linhas idênticas do mesmo arquivo.
  const parcela = t.parcelaTotal ? `${t.parcelaN}/${t.parcelaTotal}` : "";
  const corpo = [t.contaId, t.faturaId ?? "", t.dataCompra, t.centavos, hashCurto(descricaoNormalizada(t.descricao)), parcela].join(":");
  return `${fonte}:${corpo}#${ocorrencia}`;
}

/**
 * Descrições do mesmo lançamento: iguais, uma contém a outra, ou a mesma
 * primeira palavra (de 4 letras ou mais: o banco abrevia o resto, "AMAZON
 * MKTPLACE"). Frouxo de propósito: só é usado junto com mesma conta, mesmo
 * valor no centavo e datas próximas.
 */
export function descricoesParecidas(a: string, b: string): boolean {
  const x = descricaoNormalizada(a);
  const y = descricaoNormalizada(b);
  if (!x || !y) return x === y;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const px = x.split(" ")[0];
  return px.length >= 4 && px === y.split(" ")[0];
}

function mesmoLancamento(a: Transacao, b: Transacao, dias: number): boolean {
  return (
    a.contaId === b.contaId &&
    a.centavos === b.centavos &&
    (a.parcelaN ?? null) === (b.parcelaN ?? null) &&
    Math.abs(diasEntre(a.dataCompra, b.dataCompra)) <= dias &&
    descricoesParecidas(a.descricao, b.descricao)
  );
}

export interface ResultadoDaDedupe {
  /** O que gravar (upsert pela chave). */
  manter: Transacao[];
  /** Ids já gravados que saem. */
  remover: string[];
}

/**
 * Junta a leitura nova de UMA fonte, para as contas lidas, com o que já está
 * gravado. `existentes` pode ter outras fontes e outras contas: só é tocado o
 * que os casos 1–3 acima mandam.
 */
export function dedupeDaLeitura(novas: Transacao[], existentes: Transacao[], contasLidas: ReadonlySet<string>): ResultadoDaDedupe {
  // Caso 1 dentro da própria leitura: a fonte às vezes lista o pendente e o lançado juntos.
  const lancadas = novas.filter((t) => t.status === "lancada");
  const consumidos = new Set<string>();
  const manter = novas.filter((t) => {
    if (t.status !== "pendente") return true;
    const gemeo = lancadas.find((l) => !consumidos.has(l.id) && mesmoLancamento({ ...l, parcelaN: t.parcelaN }, t, DIAS_PENDENTE));
    if (!gemeo) return true;
    consumidos.add(gemeo.id);
    return false;
  });

  const chavesNovas = new Set(manter.map((t) => t.chaveDedupe));
  const fonte = novas[0]?.fonte;
  const remover: string[] = [];
  for (const e of existentes) {
    if (!contasLidas.has(e.contaId) || chavesNovas.has(e.chaveDedupe)) continue;
    if (fonte && e.fonte === fonte) {
      // Casos 1 e 2: o que a mesma fonte deixou de listar.
      if (e.status === "pendente") remover.push(e.id);
      else if (manter.some((n) => n.status === "lancada" && mesmoLancamento(n, e, 0))) remover.push(e.id);
    } else if (fonte === "pluggy" && e.fonte === "pdf") {
      // Caso 3: a Pluggy vence o PDF.
      if (manter.some((n) => n.status === "lancada" && mesmoLancamento(n, e, 1))) remover.push(e.id);
    }
  }
  return { manter, remover };
}

/** Linhas de uma fonte secundária (PDF) que a Pluggy já tem: não entram. */
export function jaExisteEmOutraFonte(t: Transacao, existentes: Transacao[]): boolean {
  return existentes.some((e) => e.fonte !== t.fonte && e.status === "lancada" && mesmoLancamento(e, t, 1));
}
