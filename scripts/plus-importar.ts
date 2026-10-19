/**
 * Catálogo de Negócios Maçônicos (PDF) -> leads.json do filtro Plus do CRM.
 *
 *   npx tsx scripts/plus-importar.ts "<catalogo.pdf>" <saida/leads.json> [--relatorio]
 *
 * Só lê o PDF e grava o arquivo pedido: não fala com planilha, n8n ou WhatsApp. O arquivo vai para
 * `<entregas>/plus/leads.json` no Dell (`~/prumo-entregas/plus/leads.json`, lido por server/crm.ts) e
 * fica FORA do repositório: são nomes e telefones de terceiros.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { lerCatalogo, prepararPlus, type ItemDoPdf } from "../server/plus-catalogo.ts";

const [, , pdf, saida, ...resto] = process.argv;
if (!pdf || !saida) {
  console.error('Uso: npx tsx scripts/plus-importar.ts "<catalogo.pdf>" <saida/leads.json> [--relatorio]');
  process.exit(2);
}

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const documento = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(pdf)), useSystemFonts: false, verbosity: 0 }).promise;
const paginas: ItemDoPdf[][] = [];
for (let n = 1; n <= documento.numPages; n++) {
  const texto = await (await documento.getPage(n)).getTextContent();
  paginas.push(texto.items.flatMap((i) => ("str" in i && i.str.trim() ? [{ s: i.str, x: i.transform[4], y: i.transform[5], h: i.transform[3] }] : [])));
}

const cartoes = lerCatalogo(paginas);
const { leads, excluidos, semTelefone } = prepararPlus(cartoes);

await fs.mkdir(path.dirname(path.resolve(saida)), { recursive: true });
await fs.writeFile(saida, JSON.stringify({ versao: 1, origem: "Catálogo de Negócios Maçônicos (macons.org)", geradoEm: new Date().toISOString(), leads, semTelefone }, null, 1), { mode: 0o600 });

const porOferta = leads.reduce<Record<string, number>>((m, l) => ({ ...m, [l.oferta]: (m[l.oferta] ?? 0) + 1 }), {});
console.log(`${cartoes.length} cartões lidos · ${leads.length} leads Plus · ${semTelefone.length} sem telefone legível (guardados à parte) · ${excluidos.length} fora`);
console.log("Por oferta:", porOferta);
console.log(`Fixos para conferir: ${leads.filter((l) => l.fixo).length}`);
if (resto.includes("--relatorio")) {
  console.log("\nFora do Plus:");
  for (const e of excluidos) console.log(`- ${e.nome} (${e.cidade}) — ${e.motivo}`);
  console.log("\nLeads:");
  for (const l of leads) console.log(`${l.uf} · ${l.cidade} · ${l.empresa} · ${l.oferta} · ${l.nicho} · ${l.whatsapp}${l.fixo ? " (fixo)" : ""}${l.site ? ` · ${l.site}` : ""}${l.tambem ? ` · também: ${l.tambem.join("; ")}` : ""}`);
}
