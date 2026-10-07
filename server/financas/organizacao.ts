import { CATEGORIAS_FIXAS, CATEGORIAS_PADRAO, SEM_CATEGORIA } from "./categoria.ts";
import { diasEntre, estabelecimentoDe, somarDias } from "./comum.ts";
import type { Transacao } from "./tipos.ts";

/**
 * A organização que o Rômulo faz por cima do que a fonte diz (07/10/2026):
 * nomes de categoria, semáforo de orçamento e cartão, recorrentes. PURO.
 *
 * O que se guarda no banco (migração 2) é só o que ele decidiu: categorias
 * criadas, renomes, regras por estabelecimento, orçamento e as marcas de
 * recorrente. Tudo o mais é derivado aqui a cada leitura.
 */

// --- Nomes de categoria -------------------------------------------------

export const MAX_NOME_CATEGORIA = 40;

export class NomeDeCategoriaInvalido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "NomeDeCategoriaInvalido";
  }
}

/** Para comparar nomes: sem acento, minúsculo, espaços colapsados. */
export function chaveDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Nome limpo (uma linha, até 40) ou `NomeDeCategoriaInvalido`. */
export function nomeDeCategoria(valor: unknown): string {
  if (typeof valor !== "string") throw new NomeDeCategoriaInvalido("Nome da categoria é obrigatório.");
  const nome = valor.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!nome) throw new NomeDeCategoriaInvalido("Nome da categoria é obrigatório.");
  if (nome.length > MAX_NOME_CATEGORIA) throw new NomeDeCategoriaInvalido(`Nome da categoria passa de ${MAX_NOME_CATEGORIA} caracteres.`);
  return nome;
}

export const ehFixa = (nome: string) => CATEGORIAS_FIXAS.some((f) => chaveDoNome(f) === chaveDoNome(nome));

/**
 * As categorias que existem hoje: as padrão (pelo nome atual, depois dos
 * renomes), as criadas, as em uso e as que têm regra ou orçamento. Ordem
 * alfabética, com "Outros" no fim.
 */
export function categoriasExistentes(entrada: {
  renomes: ReadonlyMap<string, string>;
  criadas: readonly string[];
  emUso: readonly string[];
  regras: ReadonlyMap<string, string>;
  orcamentos: ReadonlyMap<string, number>;
}): string[] {
  const nomes = new Map<string, string>();
  const juntar = (n: string) => {
    if (n && !nomes.has(chaveDoNome(n))) nomes.set(chaveDoNome(n), n);
  };
  for (const c of CATEGORIAS_PADRAO) juntar(entrada.renomes.get(c) ?? c);
  for (const c of entrada.criadas) juntar(c);
  for (const c of entrada.emUso) juntar(c);
  for (const c of entrada.regras.values()) juntar(c);
  for (const c of entrada.orcamentos.keys()) juntar(c);
  return [...nomes.values()].sort((a, b) => (a === SEM_CATEGORIA ? 1 : b === SEM_CATEGORIA ? -1 : a.localeCompare(b, "pt-BR")));
}

/** O nome já existente com a mesma chave (para juntar em vez de duplicar "mercado" e "Mercado"). */
export function nomeExistente(nome: string, existentes: readonly string[]): string | null {
  return existentes.find((e) => chaveDoNome(e) === chaveDoNome(nome)) ?? null;
}

/**
 * Novo mapa de renomes depois de `de → para`. Encadeia (A→B e depois B→C
 * deixa A→C e B→C) e desfaz o ciclo (A→B e depois B→A não deixa A→A).
 */
export function renomesDepois(renomes: ReadonlyMap<string, string>, de: string, para: string): Map<string, string> {
  const saida = new Map<string, string>();
  for (const [a, b] of renomes) saida.set(a, b === de ? para : b);
  saida.set(de, para);
  for (const [a, b] of [...saida]) if (a === b) saida.delete(a);
  return saida;
}

// --- Semáforo -----------------------------------------------------------

/** As faixas que avisam (RULES 24): 70, 90 e 100% do limite do cartão ou do orçamento. */
export const FAIXAS = [70, 90, 100] as const;
export type Faixa = 0 | (typeof FAIXAS)[number];
export type Semaforo = "verde" | "amarelo" | "laranja" | "vermelho";

export function faixaDe(pct: number): Faixa {
  if (pct >= 100) return 100;
  if (pct >= 90) return 90;
  if (pct >= 70) return 70;
  return 0;
}

export const SEMAFORO_DA_FAIXA: Record<Faixa, Semaforo> = { 0: "verde", 70: "amarelo", 90: "laranja", 100: "vermelho" };
export const EMOJI_DO_SEMAFORO: Record<Semaforo, string> = { verde: "🟢", amarelo: "🟡", laranja: "🟠", vermelho: "🔴" };

export const semaforoDe = (pct: number): Semaforo => SEMAFORO_DA_FAIXA[faixaDe(pct)];

/** Inteiro, arredondado para BAIXO: 89,6% não pode aparecer como "90%" sem ter passado de 90. */
export function porcentagem(parte: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((Math.max(0, parte) / total) * 100);
}

// --- Orçamento ----------------------------------------------------------

export interface OrcamentoDaCategoria {
  categoria: string;
  limiteCentavos: number;
  gastoCentavos: number;
  pct: number;
  semaforo: Semaforo;
}

export interface OrcamentoDoMes {
  limiteCentavos: number;
  gastoCentavos: number;
  pct: number;
  semaforo: Semaforo;
  categorias: OrcamentoDaCategoria[];
}

/**
 * Orçamento do mês: `gastoPorCategoria` é o "gastei" em COMPETÊNCIA (a compra
 * no mês da fatura), sempre, mesmo com a tela em caixa: o orçamento é sobre o
 * que se comprou, e na visão de caixa a fatura inteira cairia numa linha só.
 * O total soma só as categorias com orçamento.
 */
export function orcamentoDoMes(orcamentos: ReadonlyMap<string, number>, gastoPorCategoria: ReadonlyMap<string, number>): OrcamentoDoMes | null {
  if (orcamentos.size === 0) return null;
  const categorias = [...orcamentos]
    .map(([categoria, limiteCentavos]): OrcamentoDaCategoria => {
      const gastoCentavos = Math.max(0, gastoPorCategoria.get(categoria) ?? 0);
      const pct = porcentagem(gastoCentavos, limiteCentavos);
      return { categoria, limiteCentavos, gastoCentavos, pct, semaforo: semaforoDe(pct) };
    })
    .sort((a, b) => b.pct - a.pct || a.categoria.localeCompare(b.categoria, "pt-BR"));
  const limiteCentavos = categorias.reduce((s, c) => s + c.limiteCentavos, 0);
  const gastoCentavos = categorias.reduce((s, c) => s + c.gastoCentavos, 0);
  const pct = porcentagem(gastoCentavos, limiteCentavos);
  return { limiteCentavos, gastoCentavos, pct, semaforo: semaforoDe(pct), categorias };
}

// --- Recorrentes --------------------------------------------------------

/** Quantos dias para trás, a partir do fim do mês olhado, procurar repetição. */
export const DIAS_JANELA_RECORRENTE = 120;
/** Vezes mínimas na janela para dizer que se repete. */
export const MINIMO_RECORRENTE = 3;
/** Folga em torno de 30 dias (e de 60, um mês pulado) entre duas vezes. */
export const FOLGA_RECORRENTE_DIAS = 10;
/** A última vez tem de ser recente: assinatura cancelada some sozinha. */
export const RECORRENTE_ATIVO_DIAS = 45;

export interface Recorrente {
  estabelecimento: string;
  descricao: string;
  categoria: string;
  mediaCentavos: number;
  vezes: number;
  ultimaData: string;
  /** `detectado` pela regra; `marcado` pelo Rômulo sem a regra ter visto. */
  origem: "detectado" | "marcado";
}

export interface Recorrentes {
  lista: Recorrente[];
  /** O que o Rômulo disse que não é recorrente: some da lista, fica para desfazer. */
  desmarcados: { estabelecimento: string; descricao: string }[];
}

/** Intervalo de ~30 dias, ou de ~60 (um mês sem a cobrança, que acontece). */
function intervaloMensal(dias: number): boolean {
  return Math.abs(dias - 30) <= FOLGA_RECORRENTE_DIAS || Math.abs(dias - 60) <= FOLGA_RECORRENTE_DIAS;
}

/**
 * Recorrentes até o fim de `fimDoMes` (AAAA-MM-DD). Detectado = mesmo
 * estabelecimento, pelo menos 3 vezes nos últimos 120 dias, cada vez a ~30
 * dias da anterior (aceita um mês pulado), a última há no máximo 45 dias, e
 * valor estável (o maior até o dobro do menor: a conta de luz varia, o
 * mercado da semana não chega aqui pelo intervalo). Fora parcela (já está no
 * "devo"), pendente e o que não é despesa.
 *
 * `marcas` (estabelecimento → sim/não) vence a detecção nos dois sentidos.
 * `gastoDe` diz quanto o lançamento pesa como gasto (positivo), ou null.
 */
export function recorrentesAte(
  transacoes: readonly Transacao[],
  fimDoMes: string,
  marcas: ReadonlyMap<string, boolean>,
  gastoDe: (t: Transacao) => number | null,
): Recorrentes {
  const inicio = somarDias(fimDoMes, -DIAS_JANELA_RECORRENTE);
  const porEstabelecimento = new Map<string, { descricao: string; categoria: string; dias: Map<string, number> }>();
  for (const t of transacoes) {
    if (t.natureza !== "despesa" || (t.parcelaTotal ?? 1) > 1 || t.status === "pendente" || t.dataCompra > fimDoMes) continue;
    const g = gastoDe(t);
    if (g === null || g <= 0) continue;
    const chave = estabelecimentoDe(t.descricao);
    if (!chave) continue;
    let e = porEstabelecimento.get(chave);
    if (!e) porEstabelecimento.set(chave, (e = { descricao: t.descricao, categoria: t.categoria, dias: new Map() }));
    // A descrição e a categoria mostradas são as da vez mais recente.
    const maisRecente = [...e.dias.keys()].every((d) => d <= t.dataCompra);
    if (maisRecente) Object.assign(e, { descricao: t.descricao, categoria: t.categoria });
    e.dias.set(t.dataCompra, (e.dias.get(t.dataCompra) ?? 0) + g);
  }

  const lista: Recorrente[] = [];
  const desmarcados: Recorrentes["desmarcados"] = [];
  for (const [estabelecimento, e] of porEstabelecimento) {
    const marca = marcas.get(estabelecimento);
    if (marca === false) {
      desmarcados.push({ estabelecimento, descricao: e.descricao });
      continue;
    }
    const todas = [...e.dias.keys()].sort();
    const naJanela = todas.filter((d) => d >= inicio);
    const ultimaData = todas.at(-1)!;
    let detectado = false;
    if (naJanela.length >= MINIMO_RECORRENTE && diasEntre(ultimaData, fimDoMes) <= RECORRENTE_ATIVO_DIAS) {
      const intervalosOk = naJanela.slice(1).every((d, i) => intervaloMensal(diasEntre(naJanela[i], d)));
      const valores = naJanela.map((d) => e.dias.get(d)!);
      detectado = intervalosOk && Math.max(...valores) <= 2 * Math.min(...valores);
    }
    if (!detectado && marca !== true) continue;
    // Marcado sem a regra ver: a média é das últimas 3 vezes, onde quer que estejam.
    const base = detectado ? naJanela : todas.slice(-MINIMO_RECORRENTE);
    const valores = base.map((d) => e.dias.get(d)!);
    lista.push({
      estabelecimento,
      descricao: e.descricao,
      categoria: e.categoria,
      mediaCentavos: Math.round(valores.reduce((s, v) => s + v, 0) / valores.length),
      vezes: base.length,
      ultimaData,
      origem: detectado ? "detectado" : "marcado",
    });
  }
  // Marca de quem não aparece mais nos lançamentos: nada a mostrar, nada a desfazer.
  return {
    lista: lista.sort((a, b) => b.mediaCentavos - a.mediaCentavos || a.descricao.localeCompare(b.descricao, "pt-BR")).slice(0, 30),
    desmarcados: desmarcados.sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR")),
  };
}

/** Último dia do mês AAAA-MM, como AAAA-MM-DD. */
export function fimDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
