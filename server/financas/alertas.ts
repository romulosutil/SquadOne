import { semValores, umaLinha, type Aviso, type PrioridadeDoAviso } from "../avisos.ts";
import { hashCurto, mesDe } from "./comum.ts";
import { chaveDoNome, EMOJI_DO_SEMAFORO, FAIXAS, faixaDe, SEMAFORO_DA_FAIXA, type Faixa, type Semaforo } from "./organizacao.ts";
import type { ResumoFinanceiro } from "./resumo.ts";

/**
 * Alertas de 70, 90 e 100% (do limite do cartão e do orçamento de cada
 * categoria) pelo Telegram do dono, sem som das 22h às 7h (OT-14); a fila de
 * avisos do Dell, que vai ao WhatsApp, só de reserva quando o bot falha. PURO:
 * recebe o resumo do mês corrente e as chaves já avisadas, devolve o que sair agora.
 *
 * Privacidade (RULES 24): o aviso leva semáforo e %, NUNCA R$ nem
 * estabelecimento. A categoria pode ("Mercado"), e o nome do cartão também
 * (é o banco, não onde se gastou); os dois passam por `semValores`, e o
 * `validarAviso` da fila ainda recusa qualquer "R$" que sobrar.
 *
 * - **Uma vez por faixa e período.** A chave é `cartao:<id>:<mês da fatura
 *   aberta>:<faixa>` e `orcamento:<hash da categoria>:<mês>:<faixa>`, guardada no
 *   banco depois de publicada (a deduplicação de 24 h do aviso, na fila ou no
 *   registro de enviados, não basta: o uso fica acima de 70% o mês inteiro).
 * - **Só a faixa mais alta.** Pulou de 60 para 95%: sai só o de 90, e o de 70
 *   fica marcado como avisado junto, para não chegar atrasado depois.
 * - **Nenhum é P0.** P0 fura o silêncio das 22h às 7h e vai aos dois canais; um
 *   orçamento estourado não merece isso (pelo Telegram chega sem som de noite).
 *   70% é P2; 90 e 100%, P1.
 */

export const ORIGEM_DOS_ALERTAS = "squadone:financas";
/** Alerta preso na fila de reserva (teto, silêncio, Hermes fora) por mais que isto não serve: a próxima leitura diz o estado novo. */
export const VALIDADE_DO_ALERTA_MS = 24 * 3600_000;

const PRIORIDADE: Record<Exclude<Faixa, 0>, PrioridadeDoAviso> = { 70: 2, 90: 1, 100: 1 };

export interface AlertaDevido {
  /** A chave da faixa enviada (é também a `chave` do aviso). */
  chave: string;
  /** Todas as chaves que este envio cobre (a faixa e as de baixo). */
  marcar: string[];
  aviso: Aviso;
}

function faixasAte(faixa: Exclude<Faixa, 0>): Exclude<Faixa, 0>[] {
  return FAIXAS.filter((f) => f <= faixa);
}

function textoDaFaixa(faixa: Exclude<Faixa, 0>, de: string): string {
  return faixa === 100 ? `Chegou a 100% ${de}.` : `Passou de ${faixa}% ${de}.`;
}

/**
 * O estado do agente da Sala Finanças no escritório: o cartão mais usado (%
 * do limite) e o orçamento do mês (% do total orçado). Só % e semáforo, como
 * os avisos: o escritório aparece na tela do celular e em print de tela.
 */
export interface EstadoDaSala {
  cartao: { pct: number; semaforo: Semaforo; nome: string } | null;
  orcamento: { pct: number; semaforo: Semaforo } | null;
}

export function estadoDaSala(resumo: Pick<ResumoFinanceiro, "devo" | "orcamento">): EstadoDaSala {
  const maisUsado = resumo.devo.cartoes
    .filter((c): c is typeof c & { usoPct: number; semaforo: Semaforo } => c.usoPct !== null && c.semaforo !== null)
    .sort((a, b) => b.usoPct - a.usoPct)[0];
  return {
    cartao: maisUsado ? { pct: maisUsado.usoPct, semaforo: maisUsado.semaforo, nome: maisUsado.nome } : null,
    orcamento: resumo.orcamento ? { pct: resumo.orcamento.pct, semaforo: resumo.orcamento.semaforo } : null,
  };
}

export function alertasDevidos(resumo: Pick<ResumoFinanceiro, "mes" | "devo" | "orcamento">, jaAvisados: ReadonlySet<string>, agora: Date): AlertaDevido[] {
  const expiraEm = new Date(agora.getTime() + VALIDADE_DO_ALERTA_MS).toISOString();
  const saida: AlertaDevido[] = [];
  const avaliar = (base: string, pct: number, titulo: (emoji: string) => string, de: string) => {
    const faixa = faixaDe(pct);
    if (faixa === 0) return;
    const chave = `${base}:${faixa}`;
    if (jaAvisados.has(chave)) return;
    const emoji = EMOJI_DO_SEMAFORO[SEMAFORO_DA_FAIXA[faixa]];
    saida.push({
      chave,
      marcar: faixasAte(faixa).map((f) => `${base}:${f}`),
      aviso: {
        titulo: umaLinha(titulo(emoji), 120),
        texto: `${textoDaFaixa(faixa, de)} Os valores ficam só no app, em Finanças.`,
        origem: ORIGEM_DOS_ALERTAS,
        chave: `financas:${chave}`.slice(0, 200),
        prioridade: PRIORIDADE[faixa],
        expiraEm,
      },
    });
  };

  for (const c of resumo.devo.cartoes) {
    if (c.usoPct === null) continue;
    const nome = umaLinha(semValores(c.nome || c.instituicao || "Cartão"), 60);
    avaliar(`cartao:${c.id}:${mesDe(c.aberta.vencimento)}`, c.usoPct, (e) => `${e} Cartão ${nome}: ${c.usoPct}% do limite`, "do limite do cartão");
  }
  for (const o of resumo.orcamento?.categorias ?? []) {
    const categoria = umaLinha(semValores(o.categoria), 60);
    // Hash e não o nome na chave: a chave vai ao arquivo da fila e ao estado do dell-status.
    avaliar(`orcamento:${hashCurto(chaveDoNome(o.categoria))}:${resumo.mes}`, o.pct, (e) => `${e} Orçamento de ${categoria}: ${o.pct}%`, `do orçamento do mês em ${categoria}`);
  }
  return saida;
}
