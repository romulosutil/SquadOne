import type { BancoDeFinancas } from "./banco.ts";
import { dedupeDaLeitura } from "./dedupe.ts";
import { ErroPluggy, type ClienteDaPluggy } from "./pluggy.ts";
import {
  contaDaPluggy,
  conexaoDaPluggy,
  faturaDaPluggy,
  investimentoAtivo,
  investimentoDaPluggy,
  transacaoDaPluggy,
} from "./pluggy-mapa.ts";
import { processar } from "./processar.ts";
import type { Conta, Fatura, Transacao } from "./tipos.ts";

/**
 * Sincronização com a Pluggy: cópia local do que a fonte já diz (RULES 10:
 * não é escrita de domínio). Por POLLING, uma vez por dia e no botão
 * "Atualizar agora": o webhook da Pluggy exigiria URL pública, e o Funnel é
 * proibido (RULES 7).
 *
 * - Uma conexão que falha não cala as outras: grava o status e a falha dela
 *   e segue (a tela mostra a saúde de cada uma).
 * - Single-flight: dois cliques (ou o clique durante o polling) esperam a
 *   mesma leitura em vez de rodar duas.
 * - Depois de gravar: o passe puro (`processar.ts`) sobre todos os
 *   lançamentos e a cópia `VACUUM INTO` para o cofre.
 * - Log só com contagens e status. Nenhum valor, descrição ou estabelecimento
 *   (RULES 24).
 */

export interface ResultadoDaSincronizacao {
  ok: boolean;
  conexoes: { itemId: string; nome: string; status: string; erro: string | null; contas: number; transacoes: number }[];
  fim: string;
}

function descreverErro(erro: unknown): string {
  if (erro instanceof ErroPluggy) return erro.message;
  // Erro nosso: só o tipo, para não arrastar dado de lançamento para o log.
  return erro instanceof Error ? `falha interna (${erro.name})` : "falha interna";
}

export async function lerUmaConexao(banco: BancoDeFinancas, cliente: ClienteDaPluggy, itemId: string, agora: () => string) {
  const item = await cliente.item(itemId);
  const instituicao = String(item?.connector?.name ?? "").trim() || "Banco";
  const brutas = await cliente.contas(itemId);
  const contas: Conta[] = brutas.map((a) => contaDaPluggy(a, instituicao, agora()));
  const faturas: Fatura[] = [];
  const novas: Transacao[] = [];
  for (let i = 0; i < brutas.length; i++) {
    const conta = contas[i];
    if (conta.tipo === "cartao") {
      for (const b of await cliente.faturas(brutas[i].id)) {
        const f = faturaDaPluggy(b, conta.id);
        if (f) faturas.push(f);
      }
    }
    for (const t of await cliente.transacoes(brutas[i].id)) {
      const tx = transacaoDaPluggy(t, conta.id);
      if (tx) novas.push(tx);
    }
  }
  for (const inv of await cliente.investimentos(itemId)) {
    if (investimentoAtivo(inv)) contas.push(investimentoDaPluggy(inv, instituicao, agora()));
  }
  const contasLidas = new Set(contas.map((c) => c.id));
  const { manter, remover } = dedupeDaLeitura(novas, banco.transacoesDasContas([...contasLidas]), contasLidas);
  banco.gravarLeitura({
    conexao: conexaoDaPluggy(item, agora()),
    contas,
    faturas,
    transacoes: manter,
    removerTransacoes: remover,
  });
  return { nome: instituicao, status: String(item?.status ?? ""), contas: contas.length, transacoes: manter.length };
}

/** Refaz natureza, pares, parcelas e categorias (com as regras e renomes do Rômulo) sobre tudo que está gravado. */
export function reprocessar(banco: BancoDeFinancas) {
  banco.gravarDerivados(processar(banco.contas(), banco.faturas(), banco.transacoes(), banco.organizacao()));
}

export function criarSincronizador(deps: {
  banco: BancoDeFinancas;
  cliente: ClienteDaPluggy | null;
  itemIds: string[];
  agora?: () => Date;
  /** Depois de gravar e reprocessar (os alertas de 70/90/100%). Falha dele não falha a sincronização. */
  depois?: () => Promise<unknown>;
}) {
  const agora = () => (deps.agora?.() ?? new Date()).toISOString();
  let emAndamento: Promise<ResultadoDaSincronizacao> | null = null;

  async function rodar(origem: string): Promise<ResultadoDaSincronizacao> {
    const { banco, cliente } = deps;
    const id = banco.iniciarSincronizacao(origem, agora());
    const conexoes: ResultadoDaSincronizacao["conexoes"] = [];
    for (const itemId of deps.itemIds) {
      try {
        const r = await lerUmaConexao(banco, cliente!, itemId, agora);
        conexoes.push({ itemId, ...r, erro: null });
      } catch (erro) {
        const mensagem = descreverErro(erro);
        const anterior = banco.conexoes().find((c) => c.itemId === itemId);
        banco.gravarConexao({
          itemId,
          nome: anterior?.nome ?? "Conexão",
          status: anterior?.status ?? "DESCONHECIDO",
          executionStatus: anterior?.executionStatus ?? "",
          dadosAte: null,
          consentimentoAte: null,
          lidoEm: agora(),
          erroLeitura: mensagem,
        });
        conexoes.push({ itemId, nome: anterior?.nome ?? "Conexão", status: anterior?.status ?? "", erro: mensagem, contas: 0, transacoes: 0 });
      }
    }
    let ok = conexoes.every((c) => c.erro === null);
    try {
      reprocessar(banco);
      banco.copiaDeSeguranca();
    } catch (erro) {
      ok = false;
      console.error(`[financas] falha depois da leitura: ${descreverErro(erro)}`);
    }
    const resumo = conexoes.map((c) => `${c.nome}: ${c.erro ?? `${c.status}, ${c.contas} conta(s), ${c.transacoes} lançamento(s)`}`).join("; ");
    const fim = agora();
    banco.terminarSincronizacao(id, fim, ok, resumo);
    console.log(`[financas] sincronização (${origem}) ${ok ? "ok" : "com falha"}: ${resumo}`);
    await deps.depois?.().catch((erro) => console.error(`[financas] falha depois da sincronização: ${descreverErro(erro)}`));
    return { ok, conexoes, fim };
  }

  return {
    configurado: () => deps.cliente !== null && deps.itemIds.length > 0,
    emAndamento: () => emAndamento !== null,
    sincronizar(origem: "botao" | "diaria"): Promise<ResultadoDaSincronizacao> {
      if (!deps.cliente) return Promise.reject(new Error("Pluggy não configurada."));
      emAndamento ??= rodar(origem).finally(() => {
        emAndamento = null;
      });
      return emAndamento;
    },
  };
}

export type Sincronizador = ReturnType<typeof criarSincronizador>;

/** Hora (São Paulo) a partir da qual a leitura diária roda: o Meu Pluggy atualiza de madrugada. */
export const HORA_DA_LEITURA_DIARIA = 7;
/** Intervalo mínimo entre leituras automáticas que deram certo. */
export const INTERVALO_DIARIO_MS = 20 * 60 * 60_000;
/** Depois de uma falha, a próxima tentativa automática espera isto (a Pluggy fora não leva uma chamada a cada 30 min). */
export const ESPERA_DEPOIS_DE_FALHA_MS = 2 * 60 * 60_000;

/** PURO: a leitura diária é devida? */
export function leituraDiariaDevida(agora: Date, ultimaOk: string | null, ultimaTentativa: string | null, horaLocal: number): boolean {
  if (horaLocal < HORA_DA_LEITURA_DIARIA) return false;
  if (ultimaOk && agora.getTime() - Date.parse(ultimaOk) < INTERVALO_DIARIO_MS) return false;
  return !ultimaTentativa || agora.getTime() - Date.parse(ultimaTentativa) >= ESPERA_DEPOIS_DE_FALHA_MS;
}
