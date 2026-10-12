/**
 * Sorteio do A/B do vídeo no envio (src/operations/ab-video.ts). Só calcula:
 * não lê nem grava planilha, não envia nada.
 *
 *   npx tsx scripts/ab-video-bracos.ts < place_ids.txt
 *   npx tsx scripts/ab-video-bracos.ts place_ids.txt [sal]
 *
 * Entrada: um place_id por linha (a coluna `place_id` da aba Leads copiada).
 * Saída: `place_id<TAB>braco_video`, na mesma ordem, com "video" ou "sem-video",
 * pronta para colar ao lado na coluna `braco_video`; no fim (stderr), quantos
 * caíram em cada braço. O sal padrão é o do teste (SAL_DO_AB_VIDEO): o CRM
 * confere a coluna contra ele e avisa braço trocado.
 */
import fs from "node:fs/promises";
import { SAL_DO_AB_VIDEO, bracoDoLead } from "../src/operations/ab-video.ts";

const [arquivo, sal = SAL_DO_AB_VIDEO] = process.argv.slice(2);
const texto = arquivo && arquivo !== "-" ? await fs.readFile(arquivo, "utf8") : await new Promise<string>((resolve, reject) => {
  let dados = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (pedaco) => { dados += pedaco; });
  process.stdin.on("end", () => resolve(dados));
  process.stdin.on("error", reject);
});

const ids = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
if (!ids.length) {
  console.error("Uso: npx tsx scripts/ab-video-bracos.ts [arquivo com um place_id por linha | -] [sal]");
  process.exit(2);
}
const contagem = { video: 0, "sem-video": 0 };
for (const id of ids) {
  const braco = bracoDoLead(id, sal);
  contagem[braco]++;
  console.log(`${id}\t${braco}`);
}
console.error(`${ids.length} leads: ${contagem.video} com vídeo, ${contagem["sem-video"]} sem (sal "${sal}").`);
