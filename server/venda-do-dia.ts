import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * O que já se resolveu hoje na fila de venda (16/10/2026, OT-01 do blueprint): "Enviei" ou "Pular",
 * por chave de ação (`leadId|tipo`). Uma memória só para a Próxima venda (Hoje e Vendas, em qualquer
 * navegador) e o vendedor do Telegram. Antes cada um lembrava num lugar (localStorage do dia, memória
 * da folha "Enviar um por um", vendedor.json), e o que se pulou numa tela voltava na outra.
 *
 * Não é estado do funil (RULES 11: a planilha é a verdade): é só a ordem de quem está trabalhando a
 * fila hoje. Vira o dia (São Paulo), zera. Arquivo 600 no diretório de dados do operations.
 */

export interface Resolvida {
  em: number;
  pulou: boolean;
}

export interface VendaDoDia {
  /** AAAA-MM-DD de São Paulo. */
  dia: string;
  resolvidas: Record<string, Resolvida>;
}

export const MAX_CHAVE = 300;
export const MAX_RESOLVIDAS = 500;

export const diaSP = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);

/** PURO: o lido, se é de hoje e legível; senão um dia novo e vazio. */
export function vendaDoDia(lido: unknown, agora: number): VendaDoDia {
  const v = lido as Partial<VendaDoDia> | null;
  const hoje = diaSP(agora);
  if (!v || v.dia !== hoje || !v.resolvidas || typeof v.resolvidas !== "object") return { dia: hoje, resolvidas: {} };
  const resolvidas: Record<string, Resolvida> = {};
  for (const [chave, r] of Object.entries(v.resolvidas)) {
    if (typeof chave === "string" && chave && chave.length <= MAX_CHAVE && r && Number.isFinite(r.em) && typeof r.pulou === "boolean") {
      resolvidas[chave] = { em: r.em, pulou: r.pulou };
    }
  }
  return { dia: hoje, resolvidas };
}

/** PURO: marca uma chave; a última decisão vale (pular e depois enviar = enviada). */
export function resolver(v: VendaDoDia, chave: string, pulou: boolean, agora: number): VendaDoDia {
  if (!chave || chave.length > MAX_CHAVE) throw new Error("chave inválida");
  const resolvidas = { ...v.resolvidas, [chave]: { em: agora, pulou } };
  // Teto para um arquivo que só cresce no dia: os mais antigos saem primeiro.
  const ordem = Object.entries(resolvidas).sort((a, b) => b[1].em - a[1].em).slice(0, MAX_RESOLVIDAS);
  return { dia: v.dia, resolvidas: Object.fromEntries(ordem) };
}

export interface MemoriaDaVenda {
  ler(): Promise<VendaDoDia>;
  resolver(chave: string, pulou: boolean): Promise<VendaDoDia>;
}

/** O arquivo, com uma escrita por vez (a tela e o Telegram podem tocar juntos). */
export function criarMemoriaDaVenda(arquivo: string, agora: () => number = Date.now): MemoriaDaVenda {
  let fila: Promise<unknown> = Promise.resolve();
  const emSerie = <T>(f: () => Promise<T>): Promise<T> => {
    const p = fila.then(f, f);
    fila = p.catch(() => undefined);
    return p;
  };
  async function ler(): Promise<VendaDoDia> {
    try {
      return vendaDoDia(JSON.parse(await fs.readFile(arquivo, "utf8")), agora());
    } catch {
      return vendaDoDia(null, agora());
    }
  }
  return {
    ler,
    resolver: (chave, pulou) => emSerie(async () => {
      const novo = resolver(await ler(), chave, pulou, agora());
      await fs.mkdir(path.dirname(arquivo), { recursive: true });
      const tmp = `${arquivo}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(novo), { mode: 0o600 });
      await fs.rename(tmp, arquivo);
      return novo;
    }),
  };
}
