import type { Aviso } from "../avisos.ts";
import { FUSO } from "../alocador.ts";
import { alertasDevidos, type AlertaDevido } from "./alertas.ts";
import type { BancoDeFinancas, Organizacao } from "./banco.ts";
import { SEM_CATEGORIA } from "./categoria.ts";
import { mesDe } from "./comum.ts";
import { categoriaDoGasto, type GastoFalado } from "./gasto-falado.ts";
import { categoriasExistentes } from "./organizacao.ts";
import { CONTA_MANUAL, resumir, type ResumoFinanceiro } from "./resumo.ts";
import { reprocessar } from "./sync.ts";
import type { Transacao } from "./tipos.ts";
import type { Visao } from "./visoes.ts";

/**
 * A cola entre o banco e as partes puras da organização (07/10/2026): o
 * resumo com o que o Rômulo decidiu, o que fazer depois de cada escrita, os
 * alertas de 70/90/100% e o gasto anotado pelo Telegram.
 *
 * Log só com contagens e o tipo do erro: nenhum valor, descrição ou
 * estabelecimento (RULES 24).
 */

export function hojeEm(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export function horaEm(agora: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", hourCycle: "h23" }).format(agora));
}

export function resumoDoBanco(b: BancoDeFinancas, hoje: string, mes: string, visao: Visao, org: Organizacao = b.organizacao()): ResumoFinanceiro {
  return resumir({ contas: b.contas(), faturas: b.faturas(), transacoes: b.transacoes(), conexoes: b.conexoes() }, hoje, mes, visao, org);
}

export function categoriasDoBanco(b: BancoDeFinancas, org: Organizacao = b.organizacao(), transacoes: Transacao[] = b.transacoes()): string[] {
  return categoriasExistentes({ ...org, emUso: [...new Set(transacoes.map((t) => t.categoria))] });
}

export interface Avisador {
  /** Publica os alertas devidos e marca como avisados os que entraram na fila. Serializado. */
  avisar(): Promise<number>;
  /** O que sairia agora, sem publicar nem marcar (a rota de simulação). */
  simular(): AlertaDevido[];
}

/**
 * `publicar` ausente = sem fila (dev, teste): `avisar` não faz nada. Alerta
 * que não entra na fila não é marcado e é tentado na próxima escrita ou
 * sincronização. Em série: a sincronização e um gasto anotado ao mesmo tempo
 * não mandam o mesmo alerta duas vezes.
 */
export function criarAvisador(deps: { banco: BancoDeFinancas; publicar?: (a: Aviso) => Promise<unknown>; agora?: () => Date }): Avisador {
  const agora = deps.agora ?? (() => new Date());
  let cadeia: Promise<number> = Promise.resolve(0);

  function simular(): AlertaDevido[] {
    const t = agora();
    const hoje = hojeEm(t);
    return alertasDevidos(resumoDoBanco(deps.banco, hoje, mesDe(hoje), "competencia"), deps.banco.alertasEnviados(), t);
  }

  async function rodar(): Promise<number> {
    if (!deps.publicar) return 0;
    let enviados = 0;
    for (const a of simular()) {
      try {
        await deps.publicar(a.aviso);
        deps.banco.registrarAlertas(a.marcar, agora().toISOString());
        enviados++;
      } catch (erro) {
        console.error(`[financas] alerta não entrou na fila (${(erro as Error)?.name ?? "erro"}); tento de novo na próxima leitura.`);
      }
    }
    if (enviados) console.log(`[financas] ${enviados} alerta(s) de limite ou orçamento na fila de avisos.`);
    return enviados;
  }

  return {
    simular,
    avisar: () => (cadeia = cadeia.then(rodar, rodar)),
  };
}

/**
 * Depois de toda escrita de domínio (categoria, regra, orçamento, extrato,
 * gasto anotado): o passe puro de novo, a cópia para o cofre e os alertas
 * (sem esperar: o gesto não fica preso na fila de avisos).
 */
export function depoisDeEscrever(b: BancoDeFinancas, avisador: Avisador | null) {
  reprocessar(b);
  b.copiaDeSeguranca();
  avisador?.avisar().catch(() => {
    // `rodar` já logou cada falha.
  });
}

/**
 * Grava o gasto anotado na conta manual. `origem` identifica a mensagem
 * (`tg:<chat>:<mensagem>`): a mesma mensagem entregue de novo não duplica, e
 * devolve a categoria que já tinha.
 */
export function anotarGasto(b: BancoDeFinancas, g: GastoFalado, origem: string, quando: Date): { categoria: string; novo: boolean } {
  const chave = `manual:${origem}`;
  const existente = b.transacao(chave);
  if (existente) return { categoria: existente.categoria, novo: false };
  b.garantirContaManual(CONTA_MANUAL, quando.toISOString());
  const org = b.organizacao();
  const categoria = categoriaDoGasto(g.onde, categoriasDoBanco(b, org), org.renomes);
  const data = hojeEm(quando);
  const onde = g.onde.charAt(0).toUpperCase() + g.onde.slice(1);
  b.inserirTransacoes([
    {
      id: chave,
      contaId: CONTA_MANUAL,
      fonte: "manual",
      idOrigem: origem,
      chaveDedupe: chave,
      dataCompra: data,
      dataLancamento: data,
      descricao: onde,
      centavos: -g.centavos,
      natureza: "despesa",
      categoria,
      // "Outros" fica aberto para uma regra do Rômulo; a categoria que a frase disse é dele.
      origemCategoria: categoria === SEM_CATEGORIA ? "nenhuma" : "usuario",
      categoriaFonte: "",
      faturaId: null,
      mesFaturaFonte: null,
      parcelaN: null,
      parcelaTotal: null,
      grupoParcela: null,
      parId: null,
      status: "lancada",
      cartaoFinal: null,
    },
  ]);
  return { categoria, novo: true };
}
