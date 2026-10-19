import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Uma fila de uma tarefa por vez (19/10/2026): o vendedor, a memória do dia da venda e a sombra do
 * lead quente tinham cada um a sua cópia idêntica. Uma que falha não trava as seguintes (o erro sobe
 * só para quem a pediu).
 */
export function criarEmSerie(): <T>(f: () => Promise<T>) => Promise<T> {
  let fila: Promise<unknown> = Promise.resolve();
  return <T>(f: () => Promise<T>): Promise<T> => {
    const p = fila.then(f, f);
    fila = p.catch(() => undefined);
    return p;
  };
}

/**
 * Acrescenta uma linha a um JSONL 600 numa pasta 700. O `mode` de mkdir/open só vale na criação, e a
 * pasta pode vir de uma restauração com permissão aberta: por isso o chmod a cada gravação. Quem chama
 * decide o que fazer com a falha (aqui ela sobe).
 */
export async function anexarJsonl(arquivo: string, registro: unknown): Promise<void> {
  const pasta = path.dirname(arquivo);
  await fs.mkdir(pasta, { recursive: true, mode: 0o700 });
  await fs.chmod(pasta, 0o700);
  const aberto = await fs.open(arquivo, "a", 0o600);
  try {
    await aberto.chmod(0o600);
    await aberto.writeFile(`${JSON.stringify(registro)}\n`, "utf8");
  } finally {
    await aberto.close();
  }
}
