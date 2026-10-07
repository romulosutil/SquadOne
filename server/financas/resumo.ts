import { diasEntre, mesDe, somarMeses } from "./comum.ts";
import { DIAS_PAGAMENTO_REGISTRADO } from "./natureza.ts";
import {
  fimDoMes,
  orcamentoDoMes,
  porcentagem,
  recorrentesAte,
  semaforoDe,
  type OrcamentoDoMes,
  type Recorrente,
  type Recorrentes,
  type Semaforo,
} from "./organizacao.ts";
import { projetarParcelas, type ParcelamentoProjetado } from "./parcelas.ts";
import { contextoDas } from "./processar.ts";
import type { Conexao, Conta, Fatura, SaudeDaConexao, TipoDeConta, Transacao } from "./tipos.ts";
import { fechamentoDa, gastoNaVisao, mesDaFatura, receitaDoMes, vencimentoPrevisto, type Visao } from "./visoes.ts";

/**
 * O resumo da tela "Visão": quanto tenho, quanto devo, quanto gastei, o
 * orçamento e o que se repete. PURO: recebe os lançamentos JÁ processados
 * (`processar.ts`), o dia de hoje (AAAA-MM-DD, São Paulo) e o mês pedido.
 *
 * "Devo" por cartão é a soma de três pedaços que não se sobrepõem:
 * - faturas FECHADAS com vencimento de hoje em diante (total − o que foi
 *   pago depois do fechamento: `pagoDasFaturas`);
 * - a fatura ABERTA (o ciclo que ainda não fechou): os lançamentos do cartão
 *   sem fatura fechada que caem no próximo vencimento, mais as parcelas dela
 *   que a fonte ainda não listou (projetadas, `parcelas.ts`);
 * - as PARCELAS FUTURAS depois da fatura aberta (`parcelas.ts`).
 *
 * Quando o banco dá o limite usado (limite − disponível), é ELE o total do
 * cartão: é o número do banco e inclui o que não detalhamos. A diferença para
 * a soma dos pedaços vira "sem detalhe" na tela, em vez de sumir.
 */

export const TIPOS_DE_PATRIMONIO: readonly TipoDeConta[] = ["corrente", "poupanca", "investimento", "dinheiro", "beneficio"];

/**
 * A conta dos gastos anotados à mão ("gastei 30 no mercado" no Telegram).
 * Não tem saldo (ninguém conta o dinheiro da carteira): fica fora do "tenho",
 * e os lançamentos dela entram no "gastei" como os de qualquer conta.
 */
export const CONTA_MANUAL = "manual:dinheiro";

export interface ContaResumida {
  id: string;
  nome: string;
  instituicao: string;
  tipo: TipoDeConta;
  saldoCentavos: number;
}

export interface CartaoResumido {
  id: string;
  nome: string;
  instituicao: string;
  final: string | null;
  limiteCentavos: number | null;
  /** Limite usado segundo o banco; null quando a fonte não dá o disponível. */
  usadoBancoCentavos: number | null;
  /** % do limite usado (0–100+, arredondado para baixo), para o semáforo; null sem limite. */
  usoPct: number | null;
  semaforo: Semaforo | null;
  fechada: { vencimento: string; centavos: number; pagoCentavos: number } | null;
  aberta: { vencimento: string; centavos: number; semLancamentos: boolean };
  futurasCentavos: number;
  detalhadoCentavos: number;
  semDetalheCentavos: number;
  totalCentavos: number;
}

export interface ResumoFinanceiro {
  hoje: string;
  mes: string;
  visao: Visao;
  tenho: { totalCentavos: number; contas: ContaResumida[] };
  devo: {
    totalCentavos: number;
    cartoes: CartaoResumido[];
    porMes: { mes: string; centavos: number }[];
    parcelamentos: (ParcelamentoProjetado & { cartao: string })[];
    /** Mês da última parcela conhecida (AAAA-MM), ou null. */
    parcelasAcabamEm: string | null;
  };
  gastei: {
    totalCentavos: number;
    anteriorCentavos: number;
    categorias: { categoria: string; centavos: number; anteriorCentavos: number }[];
  };
  recebi: { totalCentavos: number; anteriorCentavos: number };
  /** Sempre em competência (ver `orcamentoDoMes`); null sem orçamento nenhum. */
  orcamento: OrcamentoDoMes | null;
  recorrentes: Recorrente[];
  recorrentesDesmarcados: Recorrentes["desmarcados"];
  saude: { conexoes: (Conexao & { saude: SaudeDaConexao })[]; dadosAte: string | null };
}

/** O que o Rômulo organizou e o resumo usa: orçamento por categoria e marcas de recorrente. */
export interface OrganizacaoDoResumo {
  orcamentos: ReadonlyMap<string, number>;
  marcasDeRecorrente: ReadonlyMap<string, boolean>;
}

const SEM_ORGANIZACAO: OrganizacaoDoResumo = { orcamentos: new Map(), marcasDeRecorrente: new Map() };

/** Status da Pluggy → semáforo. Desconhecido conta como erro: na dúvida, não dizer que está tudo bem (RULES 2). */
export function saudeDa(c: Pick<Conexao, "status" | "erroLeitura">): SaudeDaConexao {
  if (c.erroLeitura) return "erro";
  switch (c.status) {
    case "UPDATED":
      return "ok";
    case "UPDATING":
      return "atualizando";
    case "OUTDATED":
    case "WAITING_USER_ACTION":
      return "atencao";
    default:
      return "erro";
  }
}

/**
 * Quanto já foi pago de cada fatura do cartão (id → centavos), pela DATA do
 * pagamento: um pagamento quita a última fatura que já tinha fechado quando
 * ele foi feito. O que foi pago antes de a fatura fechar não é dela: quitou a
 * anterior, ou o banco já o abateu do total com que ela fechou.
 *
 * O "pago" que a fonte põe em cada fatura não serve como está, porque cada
 * banco o informa de um jeito. O Mercado Pago e o Nubank põem na fatura o
 * pagamento DELA, feito depois do fechamento. O Santander (Meu Pluggy) põe os
 * pagamentos feitos DENTRO do ciclo, que são os da fatura ANTERIOR: lido ao pé
 * da letra, a fatura fechada aparecia paga com o dinheiro do mês anterior e
 * sumia do "devo". Pela data, os três bancos caem na mesma regra.
 *
 * Os pagamentos vêm de duas listas que se repetem: os registrados nas faturas
 * e os créditos de pagamento no próprio cartão. O crédito chega antes (o
 * Santander só registra o pagamento quando a fatura SEGUINTE fecha); um
 * registrado do mesmo valor a até `DIAS_PAGAMENTO_REGISTRADO` dias de um
 * crédito é o mesmo pagamento e conta uma vez.
 */
export function pagoDasFaturas(faturasDoCartao: Fatura[], lancamentosDoCartao: Transacao[]): Map<string, number> {
  const creditos = lancamentosDoCartao
    .filter((t) => t.natureza === "pagamento_fatura" && t.centavos > 0 && t.status === "lancada")
    .map((t) => ({ data: t.dataLancamento, centavos: t.centavos }));
  const pagamentos = [...creditos];
  const casados = new Set<number>();
  for (const p of faturasDoCartao.flatMap((f) => f.pagamentos)) {
    if (p.centavos <= 0) continue;
    const i = creditos.findIndex(
      (c, k) => !casados.has(k) && c.centavos === p.centavos && Math.abs(diasEntre(c.data, p.data)) <= DIAS_PAGAMENTO_REGISTRADO,
    );
    if (i >= 0) casados.add(i);
    else pagamentos.push(p);
  }
  const porFechamento = [...faturasDoCartao].sort((a, b) => fechamentoDa(a).localeCompare(fechamentoDa(b)));
  const pago = new Map(faturasDoCartao.map((f) => [f.id, 0]));
  for (const p of pagamentos) {
    // No dia do fechamento é ambíguo (o Santander já conta o dia na fatura seguinte; o Mercado
    // Pago, na que fecha). Na dúvida, não quita a que fecha: mostrar uma dívida já paga é melhor
    // do que esconder uma a pagar (RULES 2).
    const fatura = porFechamento.filter((f) => fechamentoDa(f) < p.data).at(-1);
    if (fatura) pago.set(fatura.id, pago.get(fatura.id)! + p.centavos);
  }
  return pago;
}

function somarPorChave(mapa: Map<string, number>, chave: string, centavos: number) {
  mapa.set(chave, (mapa.get(chave) ?? 0) + centavos);
}

export function resumir(
  entrada: { contas: Conta[]; faturas: Fatura[]; transacoes: Transacao[]; conexoes: Conexao[] },
  hoje: string,
  mes: string,
  visao: Visao,
  org: OrganizacaoDoResumo = SEM_ORGANIZACAO,
): ResumoFinanceiro {
  const { contas, faturas, transacoes } = entrada;
  const ctx = contextoDas(contas, faturas);
  const mesAnterior = somarMeses(mes, -1);

  // --- Tenho ----------------------------------------------------------
  const patrimonio = contas.filter((c) => TIPOS_DE_PATRIMONIO.includes(c.tipo) && c.id !== CONTA_MANUAL);
  const tenho = {
    totalCentavos: patrimonio.reduce((s, c) => s + c.saldoCentavos, 0),
    contas: patrimonio
      .map(({ id, nome, instituicao, tipo, saldoCentavos }) => ({ id, nome, instituicao, tipo, saldoCentavos }))
      .sort((a, b) => b.saldoCentavos - a.saldoCentavos),
  };

  // --- Devo -----------------------------------------------------------
  const cartoes = contas.filter((c) => c.tipo === "cartao");
  const mesAbertoDe = new Map(cartoes.map((c) => [c.id, mesDe(vencimentoPrevisto(hoje, ctx.faturasDoCartao(c.id)))]));
  const parcelas = transacoes
    .filter((t) => t.grupoParcela && ctx.tipoDaConta(t.contaId) === "cartao" && t.centavos < 0)
    .map((t) => ({ ...t, grupo: t.grupoParcela!, mes: mesDaFatura(t, ctx) }));
  const projecao = projetarParcelas(parcelas, (contaId) => mesAbertoDe.get(contaId) ?? mesDe(hoje)).filter((p) => p.restantes > 0);

  const porMesTotal = new Map<string, number>();
  const resumoDosCartoes: CartaoResumido[] = cartoes.map((c) => {
    const proprias = ctx.faturasDoCartao(c.id);
    const doCartao = transacoes.filter((t) => t.contaId === c.id);
    const pago = pagoDasFaturas(proprias, doCartao);
    const devidoDa = (f: Fatura) => f.totalBanco - (pago.get(f.id) ?? 0);
    const aPagar = proprias.filter((f) => f.vencimento >= hoje && devidoDa(f) > 0).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    let fechadaCentavos = 0;
    for (const f of aPagar) {
      fechadaCentavos += devidoDa(f);
      somarPorChave(porMesTotal, mesDe(f.vencimento), devidoDa(f));
    }
    const mesAberto = mesAbertoDe.get(c.id)!;
    let abertaCentavos = 0;
    for (const t of doCartao) {
      if (t.faturaId || !["despesa", "encargo", "estorno"].includes(t.natureza)) continue;
      if (mesDaFatura(t, ctx) === mesAberto) abertaCentavos -= t.centavos;
    }
    abertaCentavos = Math.max(0, abertaCentavos);
    somarPorChave(porMesTotal, mesAberto, abertaCentavos);
    let futurasCentavos = 0;
    for (const p of projecao.filter((p) => p.contaId === c.id)) {
      for (const [m, centavos] of Object.entries(p.porMes)) {
        // No mês da aberta a projeção só traz parcela que a fonte ainda não listou: é da aberta.
        if (m === mesAberto) abertaCentavos += centavos;
        else futurasCentavos += centavos;
        somarPorChave(porMesTotal, m, centavos);
      }
    }
    const detalhado = fechadaCentavos + abertaCentavos + futurasCentavos;
    const usado = c.limiteCentavos !== null && c.limiteDisponivelCentavos !== null ? Math.max(0, c.limiteCentavos - c.limiteDisponivelCentavos) : null;
    const total = usado ?? detalhado;
    const primeira = aPagar[0];
    const usoPct = usado !== null && c.limiteCentavos ? porcentagem(usado, c.limiteCentavos) : null;
    return {
      id: c.id,
      nome: c.nome,
      instituicao: c.instituicao,
      final: c.final,
      limiteCentavos: c.limiteCentavos,
      usadoBancoCentavos: usado,
      usoPct,
      semaforo: usoPct === null ? null : semaforoDe(usoPct),
      fechada: primeira ? { vencimento: primeira.vencimento, centavos: fechadaCentavos, pagoCentavos: aPagar.reduce((s, f) => s + (pago.get(f.id) ?? 0), 0) } : null,
      aberta: {
        vencimento: vencimentoPrevisto(hoje, proprias),
        centavos: abertaCentavos,
        // Cartão sem nenhum lançamento lido (o Santander na Pluggy): a fatura aberta é desconhecida, não zero.
        semLancamentos: doCartao.length === 0,
      },
      futurasCentavos,
      detalhadoCentavos: detalhado,
      semDetalheCentavos: usado !== null ? Math.max(0, usado - detalhado) : 0,
      totalCentavos: total,
    };
  });
  const nomeDoCartao = new Map(cartoes.map((c) => [c.id, c.final ? `${c.nome} ·${c.final}` : c.nome]));
  const devo = {
    totalCentavos: resumoDosCartoes.reduce((s, c) => s + c.totalCentavos, 0),
    cartoes: resumoDosCartoes,
    porMes: [...porMesTotal].filter(([, c]) => c > 0).sort(([a], [b]) => a.localeCompare(b)).map(([m, centavos]) => ({ mes: m, centavos })),
    parcelamentos: projecao.map((p) => ({ ...p, cartao: nomeDoCartao.get(p.contaId) ?? "" })),
    parcelasAcabamEm: projecao.reduce<string | null>((max, p) => (max === null || p.acabaEm > max ? p.acabaEm : max), null),
  };

  // --- Gastei e recebi ------------------------------------------------
  const atual = new Map<string, number>();
  const anterior = new Map<string, number>();
  // O orçamento é sempre em competência, qualquer que seja a visão da tela.
  const competencia = new Map<string, number>();
  let recebi = 0;
  let recebiAntes = 0;
  for (const t of transacoes) {
    const g = gastoNaVisao(t, visao, ctx);
    if (g?.mes === mes) somarPorChave(atual, t.categoria, g.centavos);
    else if (g?.mes === mesAnterior) somarPorChave(anterior, t.categoria, g.centavos);
    const c = visao === "competencia" ? g : gastoNaVisao(t, "competencia", ctx);
    if (c?.mes === mes) somarPorChave(competencia, t.categoria, c.centavos);
    const r = receitaDoMes(t, ctx);
    if (r?.mes === mes) recebi += r.centavos;
    else if (r?.mes === mesAnterior) recebiAntes += r.centavos;
  }
  const categorias = [...new Set([...atual.keys(), ...anterior.keys()])]
    .map((categoria) => ({ categoria, centavos: atual.get(categoria) ?? 0, anteriorCentavos: anterior.get(categoria) ?? 0 }))
    .filter((c) => c.centavos !== 0 || c.anteriorCentavos !== 0)
    .sort((a, b) => b.centavos - a.centavos || b.anteriorCentavos - a.anteriorCentavos);
  const gastei = {
    totalCentavos: [...atual.values()].reduce((s, c) => s + c, 0),
    anteriorCentavos: [...anterior.values()].reduce((s, c) => s + c, 0),
    categorias,
  };

  // --- Recorrentes ----------------------------------------------------
  const { lista, desmarcados } = recorrentesAte(transacoes, fimDoMes(mes), org.marcasDeRecorrente, (t) => gastoNaVisao(t, "competencia", ctx)?.centavos ?? null);

  // --- Saúde ----------------------------------------------------------
  const conexoes = entrada.conexoes.map((c) => ({ ...c, saude: saudeDa(c) }));
  // A data que vale é a da conexão mais atrasada: "dados até" promete que TUDO está até ali.
  const dadosAte = conexoes.map((c) => c.dadosAte).filter((d): d is string => !!d).sort()[0] ?? null;

  return {
    hoje,
    mes,
    visao,
    tenho,
    devo,
    gastei,
    recebi: { totalCentavos: recebi, anteriorCentavos: recebiAntes },
    orcamento: orcamentoDoMes(org.orcamentos, competencia),
    recorrentes: lista,
    recorrentesDesmarcados: desmarcados,
    saude: { conexoes, dadosAte },
  };
}
