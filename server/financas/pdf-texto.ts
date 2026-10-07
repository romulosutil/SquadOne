import { FinancasIndisponiveis } from "./banco.ts";

/**
 * Texto de um PDF em LINHAS, na ordem de leitura (de cima para baixo, da
 * esquerda para a direita), com o pdfjs-dist. Os itens de texto de uma página
 * são agrupados pela altura (y, com tolerância de 2 pontos) e cada linha é a
 * junção dos itens por x. É só extração: quem entende a fatura é o
 * `fatura-santander.ts`, que é puro e testado.
 *
 * O PDF é lido em memória e descartado: não é gravado em disco nem em log.
 */

const TOLERANCIA_Y = 2;
export const MAX_PAGINAS_PDF = 40;

interface ItemDeTexto {
  str: string;
  transform: number[];
}

export function linhasDosItens(itens: ItemDeTexto[]): string[] {
  const linhas: { y: number; itens: { x: number; str: string }[] }[] = [];
  for (const item of itens) {
    if (!item.str?.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    let linha = linhas.find((l) => Math.abs(l.y - y) <= TOLERANCIA_Y);
    if (!linha) {
      linha = { y, itens: [] };
      linhas.push(linha);
    }
    linha.itens.push({ x, str: item.str });
  }
  // PDF conta y de baixo para cima: a linha de cima tem o maior y.
  return linhas
    .sort((a, b) => b.y - a.y)
    .map((l) =>
      l.itens
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str.trim())
        .join(" "),
    );
}

export async function linhasDoPdf(conteudo: Uint8Array): Promise<string[]> {
  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    throw new FinancasIndisponiveis("pdfjs-dist não está instalado (dependência opcional).");
  }
  const tarefa = pdfjs.getDocument({ data: conteudo, useSystemFonts: false, verbosity: 0 });
  const documento = await tarefa.promise;
  try {
    const linhas: string[] = [];
    for (let n = 1; n <= Math.min(documento.numPages, MAX_PAGINAS_PDF); n++) {
      const pagina = await documento.getPage(n);
      const texto = await pagina.getTextContent();
      linhas.push(...linhasDosItens(texto.items.flatMap((i) => ("str" in i ? [{ str: i.str, transform: i.transform }] : []))));
    }
    return linhas;
  } finally {
    await tarefa.destroy();
  }
}
