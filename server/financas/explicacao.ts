import { createHash } from "node:crypto";
import { semValores, umaLinha } from "../avisos.ts";
import { estabelecimentoDe, somarMeses } from "./comum.ts";
import type { Semaforo } from "./organizacao.ts";
import type { ResumoFinanceiro } from "./resumo.ts";
import type { SaudeDaConexao, TipoDeConta, Transacao } from "./tipos.ts";
import { gastoNaVisao, type ContextoDasVisoes, type Visao } from "./visoes.ts";

/**
 * "Explicar este mês" (fase 8d): o texto que vai ao Gemini quando o Rômulo
 * pede, e SÓ ele. PURO e determinístico: o mesmo resumo com as mesmas opções
 * dá o mesmo texto, byte a byte. É o que deixa a tela mostrar antes,
 * literalmente, o que vai sair (RULES 24), e a rota de envio remontar e
 * conferir pelo hash que nada mudou entre a prévia e o clique.
 *
 * O padrão é o mínimo: categorias, % de variação, % do orçamento e do limite,
 * contagens e meses. Nenhum R$ e nenhum estabelecimento — o estabelecimento
 * diz onde o Rômulo esteve (farmácia, clínica), mais do que o valor. Os dois
 * só entram por toggle explícito na folha:
 * - `comValores` acrescenta os R$;
 * - `comEstabelecimentos` acrescenta até `MAX_ESTABELECIMENTOS_POR_CATEGORIA`
 *   por categoria, de uma lista montada à parte (`estabelecimentosDoMes`). Sem
 *   a opção a função nem recebe essa lista (o tipo não deixa), e as descrições
 *   que o resumo já traz (recorrentes, parcelamentos) não são escritas.
 *
 * Os números vêm prontos do resumo (`resumo.ts` → `visoes.ts`): nada aqui
 * recalcula visão, e "o mesmo gasto nunca conta duas vezes" continua sendo
 * regra de lá.
 */

export const MAX_ESTABELECIMENTOS_POR_CATEGORIA = 10;
/** Teto da resposta do modelo na tela. */
export const MAX_EXPLICACAO = 4000;

/** Categoria → estabelecimentos do mês, do maior gasto para o menor. */
export type EstabelecimentosDoMes = ReadonlyMap<string, readonly { estabelecimento: string; centavos: number }[]>;

export type OpcoesDoPacote =
  | { comValores: boolean; comEstabelecimentos: false }
  | { comValores: boolean; comEstabelecimentos: true; estabelecimentos: EstabelecimentosDoMes };

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const ROTULO_DO_TIPO: Record<TipoDeConta, string> = {
  corrente: "conta corrente",
  poupanca: "poupança",
  cartao: "cartão",
  investimento: "investimento",
  dinheiro: "dinheiro",
  beneficio: "benefício",
};

const ROTULO_DO_SEMAFORO: Record<Semaforo, string> = {
  verde: "tranquilo",
  amarelo: "passou de 70%",
  laranja: "passou de 90%",
  vermelho: "chegou a 100%",
};

const ROTULO_DA_SAUDE: Record<SaudeDaConexao, string> = {
  ok: "atualizada",
  atualizando: "atualizando",
  atencao: "precisa de ação no app do banco",
  erro: "falhou",
};

function reais(centavos: number): string {
  // Espaço comum no lugar do não separável do Intl: o texto é lido pelo Rômulo na prévia e pelo modelo.
  return BRL.format(centavos / 100).replace(/\s/g, " ");
}

function mesLongo(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${MESES[Number(m) - 1]} de ${ano}`;
}

function mesCurto(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${MESES_CURTOS[Number(m) - 1]}/${ano.slice(2)}`;
}

function diaMes(data: string | null): string {
  if (!data) return "sem data";
  const d = data.slice(0, 10);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/**
 * Nome que vem do usuário ou da fonte (categoria, cartão, conexão): uma linha
 * e sem "R$" — uma categoria chamada "Aluguel R$ 2000" não pode furar o
 * padrão sem valores.
 */
function nome(texto: string, teto = 60): string {
  return umaLinha(semValores(texto), teto) || "sem nome";
}

/** Variação contra o mês anterior em texto (mesma regra da tela, `formato.ts`). */
export function variacaoEmTexto(atual: number, anterior: number): string {
  if (anterior === 0) return atual === 0 ? "igual" : "novo (não havia no mês anterior)";
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  if (pct === 0) return "igual";
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export function montarPacote(resumo: ResumoFinanceiro, opcoes: OpcoesDoPacote): string {
  const { comValores } = opcoes;
  const estabelecimentos = opcoes.comEstabelecimentos ? opcoes.estabelecimentos : null;
  const linhas: string[] = [];
  const anterior = somarMeses(resumo.mes, -1);

  linhas.push(`Finanças pessoais de ${mesLongo(resumo.mes)}, visão de ${resumo.visao === "caixa" ? "caixa" : "competência"}. Hoje é ${diaMes(resumo.hoje)}.`);
  linhas.push(
    resumo.visao === "caixa"
      ? "Caixa: o que saiu das contas no mês; a fatura do cartão paga conta numa linha só."
      : "Competência: compras no cartão contam no mês da fatura; o pagamento da fatura não conta de novo.",
  );
  linhas.push(
    `Este texto ${comValores ? "inclui valores em R$" : "não tem valores em dinheiro (só porcentagens, contagens e meses)"} e ${estabelecimentos ? "inclui nomes de estabelecimentos" : "não tem nomes de estabelecimentos"}.`,
  );

  // --- Tenho ----------------------------------------------------------
  linhas.push("", "## Tenho");
  const contas = resumo.tenho.contas;
  if (!contas.length) {
    linhas.push("Nenhuma conta lida.");
  } else {
    const porTipo = new Map<string, number>();
    for (const c of contas) porTipo.set(ROTULO_DO_TIPO[c.tipo] ?? c.tipo, (porTipo.get(ROTULO_DO_TIPO[c.tipo] ?? c.tipo) ?? 0) + 1);
    linhas.push(`${plural(contas.length, "conta", "contas")}: ${[...porTipo].map(([tipo, n]) => `${n} ${tipo}`).join(", ")}.`);
    if (comValores) {
      linhas.push(`Total: ${reais(resumo.tenho.totalCentavos)}.`);
      for (const c of contas) linhas.push(`- ${nome(c.instituicao)} (${ROTULO_DO_TIPO[c.tipo] ?? c.tipo}): ${reais(c.saldoCentavos)}`);
    }
  }

  // --- Devo -----------------------------------------------------------
  linhas.push("", "## Devo por cartão");
  const { cartoes } = resumo.devo;
  if (!cartoes.length) linhas.push("Nenhum cartão lido.");
  if (comValores && cartoes.length) linhas.push(`Total: ${reais(resumo.devo.totalCentavos)}.`);
  const parcelamentosPorCartao = new Map<string, number>();
  for (const p of resumo.devo.parcelamentos) parcelamentosPorCartao.set(p.contaId, (parcelamentosPorCartao.get(p.contaId) ?? 0) + 1);
  for (const c of cartoes) {
    const partes: string[] = [];
    if (c.usoPct !== null) partes.push(`${c.usoPct}% do limite usado (${ROTULO_DO_SEMAFORO[c.semaforo ?? "verde"]})`);
    else partes.push("limite usado desconhecido");
    if (c.fechada) partes.push(`fatura fechada vence ${diaMes(c.fechada.vencimento)}${comValores ? `: ${reais(c.fechada.centavos)}${c.fechada.pagoCentavos ? ` (já pago ${reais(c.fechada.pagoCentavos)})` : ""}` : ""}`);
    partes.push(
      c.aberta.semLancamentos
        ? `fatura aberta vence ${diaMes(c.aberta.vencimento)}, sem lançamentos lidos deste cartão`
        : `fatura aberta vence ${diaMes(c.aberta.vencimento)}${comValores ? `: ${reais(c.aberta.centavos)}` : ""}`,
    );
    const n = parcelamentosPorCartao.get(c.id) ?? 0;
    if (n) partes.push(plural(n, "parcelamento em andamento", "parcelamentos em andamento"));
    if (comValores) {
      if (c.futurasCentavos) partes.push(`parcelas depois da fatura aberta: ${reais(c.futurasCentavos)}`);
      if (c.semDetalheCentavos) partes.push(`sem detalhe: ${reais(c.semDetalheCentavos)}`);
      if (c.limiteCentavos !== null) partes.push(`limite ${reais(c.limiteCentavos)}`);
      partes.push(`total do cartão ${reais(c.totalCentavos)}`);
    }
    linhas.push(`- Cartão ${nome(c.nome || c.instituicao)}: ${partes.join("; ")}.`);
  }
  const { porMes } = resumo.devo;
  if (porMes.length) {
    linhas.push(`Há o que pagar no cartão em ${plural(porMes.length, "mês", "meses")}, de ${mesCurto(porMes[0].mes)} a ${mesCurto(porMes.at(-1)!.mes)}.`);
    if (comValores) for (const m of porMes) linhas.push(`- ${mesCurto(m.mes)}: ${reais(m.centavos)}`);
  }

  // --- Gastei ---------------------------------------------------------
  linhas.push("", "## Gastei por categoria");
  const { gastei, recebi } = resumo;
  linhas.push(
    `Total do mês: ${variacaoEmTexto(gastei.totalCentavos, gastei.anteriorCentavos)} contra ${mesLongo(anterior)}${comValores ? ` (${reais(gastei.totalCentavos)}; antes ${reais(gastei.anteriorCentavos)})` : ""}.`,
  );
  linhas.push(`Entradas: ${variacaoEmTexto(recebi.totalCentavos, recebi.anteriorCentavos)} contra ${mesLongo(anterior)}${comValores ? ` (${reais(recebi.totalCentavos)}; antes ${reais(recebi.anteriorCentavos)})` : ""}.`);
  if (!gastei.categorias.length) linhas.push("Nenhum gasto lido neste mês nem no anterior.");
  const total = Math.max(0, gastei.totalCentavos);
  for (const c of gastei.categorias) {
    const fatia = total > 0 && c.centavos > 0 ? `${Math.round((c.centavos / total) * 100)}% do total` : "sem gasto este mês";
    const valores = comValores ? `; ${reais(c.centavos)}, antes ${reais(c.anteriorCentavos)}` : "";
    linhas.push(`- ${nome(c.categoria)}: ${fatia}; ${variacaoEmTexto(c.centavos, c.anteriorCentavos)} contra o mês anterior${valores}.`);
    const daCategoria = estabelecimentos?.get(c.categoria)?.slice(0, MAX_ESTABELECIMENTOS_POR_CATEGORIA) ?? [];
    if (daCategoria.length) {
      linhas.push(`  Estabelecimentos: ${daCategoria.map((e) => (comValores ? `${nome(e.estabelecimento)} (${reais(e.centavos)})` : nome(e.estabelecimento))).join("; ")}.`);
    }
  }

  // --- Orçamento ------------------------------------------------------
  linhas.push("", "## Orçamento");
  const { orcamento } = resumo;
  if (!orcamento) {
    linhas.push("Nenhum orçamento definido.");
  } else {
    linhas.push(
      `${orcamento.pct}% do orçado nas categorias com orçamento (${ROTULO_DO_SEMAFORO[orcamento.semaforo]}), contando as compras no mês da fatura${comValores ? `: ${reais(orcamento.gastoCentavos)} de ${reais(orcamento.limiteCentavos)}` : ""}.`,
    );
    for (const o of orcamento.categorias) {
      linhas.push(`- ${nome(o.categoria)}: ${o.pct}% (${ROTULO_DO_SEMAFORO[o.semaforo]})${comValores ? `; ${reais(o.gastoCentavos)} de ${reais(o.limiteCentavos)}` : ""}.`);
    }
  }

  // --- Recorrentes ----------------------------------------------------
  linhas.push("", "## Recorrentes");
  const { recorrentes } = resumo;
  if (!recorrentes.length) {
    linhas.push("Nenhum gasto recorrente detectado.");
  } else {
    const porCategoria = new Map<string, number>();
    for (const r of recorrentes) porCategoria.set(r.categoria, (porCategoria.get(r.categoria) ?? 0) + 1);
    linhas.push(`${plural(recorrentes.length, "gasto se repete", "gastos se repetem")} todo mês: ${[...porCategoria].map(([c, n]) => `${nome(c)} (${n})`).join(", ")}.`);
    if (comValores) linhas.push(`Soma das médias: ${reais(recorrentes.reduce((s, r) => s + r.mediaCentavos, 0))} por mês.`);
    if (estabelecimentos) {
      for (const r of recorrentes) {
        linhas.push(`- ${nome(r.descricao)} (${nome(r.categoria)}; ${r.origem === "marcado" ? "marcado como recorrente" : `${r.vezes} vezes`})${comValores ? `: média ${reais(r.mediaCentavos)}` : ""}.`);
      }
    }
  }

  // --- Parcelamentos --------------------------------------------------
  linhas.push("", "## Parcelamentos");
  const { parcelamentos, parcelasAcabamEm } = resumo.devo;
  if (!parcelamentos.length) {
    linhas.push("Nenhum parcelamento em andamento.");
  } else {
    const restantes = parcelamentos.reduce((s, p) => s + p.restantes, 0);
    linhas.push(
      `${plural(parcelamentos.length, "parcelamento", "parcelamentos")} em andamento, ${plural(restantes, "parcela", "parcelas")} a cobrar${parcelasAcabamEm ? `; a última acaba em ${mesCurto(parcelasAcabamEm)}` : ""}${comValores ? `; ${reais(parcelamentos.reduce((s, p) => s + p.valorParcela, 0))} por mês somando as parcelas` : ""}.`,
    );
    const porMesFinal = new Map<string, number>();
    for (const p of parcelamentos) porMesFinal.set(p.acabaEm, (porMesFinal.get(p.acabaEm) ?? 0) + 1);
    linhas.push(`Quando acabam: ${[...porMesFinal].sort(([a], [b]) => a.localeCompare(b)).map(([m, n]) => `${n} em ${mesCurto(m)}`).join(", ")}.`);
    if (estabelecimentos) {
      for (const p of parcelamentos) {
        linhas.push(`- ${nome(p.descricao)} (cartão ${nome(p.cartao)}): ${p.ultimaVista} de ${p.total}, faltam ${p.restantes}, acaba em ${mesCurto(p.acabaEm)}${comValores ? `; ${reais(p.valorParcela)} por mês` : ""}.`);
      }
    }
  }

  // --- Saúde ----------------------------------------------------------
  linhas.push("", "## Saúde das conexões");
  const { conexoes, dadosAte } = resumo.saude;
  linhas.push(dadosAte ? `Os dados valem até ${diaMes(dadosAte)} (a conexão mais atrasada).` : "Sem data de atualização das conexões.");
  if (!conexoes.length) linhas.push("Nenhuma conexão com banco.");
  for (const c of conexoes) linhas.push(`- ${nome(c.nome)}: ${ROTULO_DA_SAUDE[c.saude]}; dados até ${diaMes(c.dadosAte)}.`);

  return linhas.join("\n");
}

/** Identidade da prévia: sha256 do texto, 16 caracteres em hex. */
export function hashDoPacote(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex").slice(0, 16);
}

/** O `systemInstruction` da explicação. Fixo: nada do pacote entra aqui, e nada do roster. */
export function promptDaExplicacao(): string {
  return [
    "Você recebe um resumo das finanças pessoais de um mês, em português.",
    "Explique em até 15 linhas o que mudou em relação ao mês anterior e o que merece atenção.",
    "Não invente números que não estejam no texto; se uma informação não está lá, não a suponha.",
    "Sem conselho de investimento.",
    "Responda em português, em texto simples, sem tabelas.",
  ].join("\n");
}

/**
 * Os estabelecimentos de cada categoria no mês, pelo gasto na visão pedida
 * (`gastoNaVisao`, a mesma conta do "gastei"), até
 * `MAX_ESTABELECIMENTOS_POR_CATEGORIA` por categoria. Só é chamado com o
 * toggle ligado.
 */
export function estabelecimentosDoMes(transacoes: readonly Transacao[], ctx: ContextoDasVisoes, mes: string, visao: Visao): EstabelecimentosDoMes {
  const porCategoria = new Map<string, Map<string, number>>();
  for (const t of transacoes) {
    const g = gastoNaVisao(t, visao, ctx);
    if (g?.mes !== mes) continue;
    const e = estabelecimentoDe(t.descricao);
    if (!e) continue;
    const mapa = porCategoria.get(t.categoria) ?? new Map<string, number>();
    mapa.set(e, (mapa.get(e) ?? 0) + g.centavos);
    porCategoria.set(t.categoria, mapa);
  }
  const saida = new Map<string, { estabelecimento: string; centavos: number }[]>();
  for (const [categoria, mapa] of porCategoria) {
    const lista = [...mapa]
      .filter(([, centavos]) => centavos > 0)
      .map(([estabelecimento, centavos]) => ({ estabelecimento, centavos }))
      .sort((a, b) => b.centavos - a.centavos || a.estabelecimento.localeCompare(b.estabelecimento, "pt-BR"))
      .slice(0, MAX_ESTABELECIMENTOS_POR_CATEGORIA);
    if (lista.length) saida.set(categoria, lista);
  }
  return saida;
}

/** A resposta do modelo para a tela: sem espaço sobrando, cortada em `MAX_EXPLICACAO`. */
export function explicacaoParaTela(texto: string): string {
  const limpo = texto.trim();
  return limpo.length <= MAX_EXPLICACAO ? limpo : `${limpo.slice(0, MAX_EXPLICACAO - 1).trimEnd()}…`;
}
