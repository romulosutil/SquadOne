/**
 * Resumo do Jev em sombra (perfis-e-experimentos.md, "Jev em sombra"). Só lê:
 * nunca grava, nunca chama modelo nenhum, nunca lê a chave.
 *
 *   npx tsx scripts/jev-sombra-resumo.ts ~/.local/share/squadone/jev-sombra
 *
 * Lê todos os `*.jsonl` do diretório e imprime: chamadas, puladas por
 * finanças, falhas por motivo, concordância com o Gemini por pergunta (e a da
 * squad separada entre squad explícita e não), discordâncias confiantes
 * (p ≥ 0,90), % de redirecionamentos, latência p50/p95, custo acumulado, o
 * viés da primeira opção e os critérios de promoção do roteamento de squad.
 * Linha torta é contada e pulada. Sai com código 2 sem diretório ou sem linhas.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { ItemDaComparacao, LinhaDoJev, NomeDaPergunta, RegistroDoJev } from "../server/jev-sombra.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("Uso: npx tsx scripts/jev-sombra-resumo.ts <diretório com os *.jsonl do Jev>");
  process.exit(2);
}

/** Critérios de promoção do roteamento de squad (perfis-e-experimentos.md). */
const PROMOCAO = { demandas: 100, redirecionamentos: 15, concordancia: 0.97, pConfiante: 0.9, p95Ms: 1500, falhas: 0.02, taxaRedirecionamento: 0.1 };

async function lerLinhas(pasta: string): Promise<{ linhas: LinhaDoJev[]; tortas: number; arquivos: number }> {
  const nomes = (await fs.readdir(pasta)).filter((n) => n.endsWith(".jsonl")).sort();
  const linhas: LinhaDoJev[] = [];
  let tortas = 0;
  for (const nome of nomes) {
    for (const l of (await fs.readFile(path.join(pasta, nome), "utf8")).split("\n")) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l) as LinhaDoJev;
        if (typeof r.quando !== "string") throw new Error("sem quando");
        linhas.push(r);
      } catch {
        tortas++;
      }
    }
  }
  linhas.sort((a, b) => a.quando.localeCompare(b.quando));
  return { linhas, tortas, arquivos: nomes.length };
}

const pct = (parte: number, total: number) => (total === 0 ? "—" : `${((parte / total) * 100).toFixed(1)}%`);
const quando = (iso: string) => iso.replace("T", " ").slice(0, 16);

function percentil(valores: number[], q: number): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
}

interface Placar {
  comparaveis: number;
  concordam: number;
  discordanciasConfiantes: number;
}

function placar(registros: RegistroDoJev[], pergunta: NomeDaPergunta): Placar {
  const p: Placar = { comparaveis: 0, concordam: 0, discordanciasConfiantes: 0 };
  for (const r of registros) {
    const item = r.comparacao?.[pergunta] as ItemDaComparacao | undefined;
    if (!item || item.concorda === null) continue;
    p.comparaveis++;
    if (item.concorda) p.concordam++;
    else if (item.p >= PROMOCAO.pConfiante) p.discordanciasConfiantes++;
  }
  return p;
}

const { linhas, tortas, arquivos } = await lerLinhas(dir).catch((err: any) => {
  console.error(`Não deu para ler ${dir}: ${err?.message ?? err}`);
  process.exit(2);
});

const puladas = linhas.filter((l) => "pulada" in l).length;
const registros = linhas.filter((l): l is RegistroDoJev => !("pulada" in l));
if (registros.length === 0) {
  console.log(`Nenhuma chamada em ${dir} (${arquivos} arquivo(s), ${puladas} pulada(s) por finanças${tortas ? `, ${tortas} linha(s) torta(s)` : ""}).`);
  process.exit(2);
}

const total = registros.length;
console.log(
  `Jev em sombra — ${total} chamada(s) de ${quando(registros[0].quando)} a ${quando(registros[total - 1].quando)} (${arquivos} arquivo(s); ${puladas} demanda(s) puladas por finanças${tortas ? `; ${tortas} linha(s) torta(s) ignorada(s)` : ""})`,
);

const falhas = registros.filter((r) => r.falha);
const porMotivo = new Map<string, number>();
for (const r of falhas) porMotivo.set(r.falha!.motivo, (porMotivo.get(r.falha!.motivo) ?? 0) + 1);
console.log(`\nFalhas: ${falhas.length} (${pct(falhas.length, total)})${porMotivo.size ? ` — ${[...porMotivo].map(([m, n]) => `${m} ${n}`).join(", ")}` : ""}`);
const modelos = new Set(registros.map((r) => r.modeloRespondeu).filter(Boolean));
if (modelos.size) console.log(`Modelo(s) que responderam: ${[...modelos].join(", ")}`);

const respondidas = registros.filter((r) => r.comparacao);
console.log("\nConcordância com o Gemini (só onde o Gemini decidiu):");
for (const pergunta of ["squad", "dominio", "natureza", "pede_contratacao"] as const) {
  const p = placar(respondidas, pergunta);
  console.log(
    `  ${pergunta.padEnd(17)} ${String(p.concordam).padStart(4)}/${String(p.comparaveis).padEnd(4)} ${pct(p.concordam, p.comparaveis).padStart(6)} · discordâncias com p ≥ 0,90: ${p.discordanciasConfiantes}`,
  );
}
// A pergunta de domínio usa as salas da squad FINAL DO GEMINI: se o Jev escolheu outra squad, comparar a sala
// é comparar duas coisas diferentes. Só conta onde as duas squads são a mesma.
{
  const p = placar(respondidas.filter((r) => r.comparacao?.squad?.concorda === true), "dominio");
  console.log(`    domínio, só onde a squad concordou: ${p.concordam}/${p.comparaveis} ${pct(p.concordam, p.comparaveis)}`);
}
for (const [rotulo, filtro] of [["squad escolhida pelo usuário", true], ["squad não escolhida (bot sem prefixo)", false]] as const) {
  const p = placar(respondidas.filter((r) => r.squadExplicita === filtro), "squad");
  console.log(`    squad, ${rotulo}: ${p.concordam}/${p.comparaveis} ${pct(p.concordam, p.comparaveis)}`);
}

const redirecionadas = registros.filter((r) => r.redirecionado).length;
console.log(`\nRedirecionamentos de squad (o Gemini mudou de squad): ${redirecionadas}/${total} (${pct(redirecionadas, total)})`);
const pRedir = placar(respondidas.filter((r) => r.redirecionado), "squad");
console.log(`  Jev concordou com o destino em ${pRedir.concordam}/${pRedir.comparaveis} (${pct(pRedir.concordam, pRedir.comparaveis)})`);

// Ganho líquido: o Gemini também erra o palpite inicial, então "concordar com ele" não é acertar. Aqui o gabarito
// é a squad onde o turno terminou. Antecipou = o Gemini precisou redirecionar e o Jev já tinha apontado o destino;
// induzido = não houve redirecionamento e o Jev apontou outra squad (levaria a um erro). Sem texto guardado não dá
// para dizer quem tinha razão: é a melhor medida possível só com os campos gravados.
{
  const comSquad = respondidas.filter((r) => r.respostas?.squad && !r.gemini?.trocaSugerida);
  const antecipados = comSquad.filter((r) => r.redirecionado && r.respostas!.squad!.c === r.squadFinal).length;
  const ficouNaInicial = comSquad.filter((r) => r.redirecionado && r.respostas!.squad!.c === r.squadInicial).length;
  const induzidos = comSquad.filter((r) => !r.redirecionado && r.respostas!.squad!.c !== r.squadFinal).length;
  const saldo = antecipados - induzidos;
  console.log(
    `  Ganho líquido de squad (${comSquad.length} demandas sem troca sugerida): ${antecipados} redirecionamento(s) antecipado(s), ${ficouNaInicial} em que o Jev ficou na squad inicial, ${induzidos} erro(s) induzido(s) → saldo ${saldo > 0 ? "+" : ""}${saldo}`,
  );
}

const latencias = registros.map((r) => r.latenciaMs).filter((n) => Number.isFinite(n));
const p50 = percentil(latencias, 0.5);
const p95 = percentil(latencias, 0.95);
console.log(`\nLatência: p50 ${p50 ?? "—"} ms · p95 ${p95 ?? "—"} ms · máxima ${latencias.length ? Math.max(...latencias) : "—"} ms`);
const custo = registros.reduce((s, r) => s + (Number.isFinite(r.cost) ? r.cost : 0), 0);
const tokens = registros.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
console.log(`Custo acumulado: US$ ${custo.toFixed(6)} (${respondidas.length} respondidas, média US$ ${(custo / Math.max(1, respondidas.length)).toFixed(6)}; ${tokens} tokens de entrada)`);

console.log("\nViés da primeira opção (opções embaralhadas a cada chamada):");
for (const pergunta of ["squad", "dominio", "natureza"] as const) {
  let n = 0;
  let jevPrimeira = 0;
  let geminiPrimeira = 0;
  let esperado = 0;
  for (const r of respondidas) {
    const ordem = r.ordem?.[pergunta];
    const escolha = r.respostas?.[pergunta]?.c;
    if (!ordem || ordem.length < 2 || !escolha) continue;
    n++;
    esperado += 1 / ordem.length;
    if (ordem[0] === escolha) jevPrimeira++;
    const doGemini = r.comparacao?.[pergunta]?.gemini;
    if (doGemini && ordem[0] === doGemini) geminiPrimeira++;
  }
  if (n === 0) {
    console.log(`  ${pergunta.padEnd(9)} (sem dados)`);
    continue;
  }
  console.log(
    `  ${pergunta.padEnd(9)} Jev escolheu a 1ª opção em ${pct(jevPrimeira, n)} · o Gemini estava na 1ª em ${pct(geminiPrimeira, n)} · ao acaso seria ${pct(esperado, n)} (${n} chamadas)`,
  );
}

const sq = placar(respondidas, "squad");
const criterios: [string, boolean][] = [
  [`≥ ${PROMOCAO.demandas} demandas reais (${total})`, total >= PROMOCAO.demandas],
  [`≥ ${PROMOCAO.redirecionamentos} redirecionamentos (${redirecionadas})`, redirecionadas >= PROMOCAO.redirecionamentos],
  [`concordância de squad ≥ 97% (${pct(sq.concordam, sq.comparaveis)})`, sq.comparaveis > 0 && sq.concordam / sq.comparaveis >= PROMOCAO.concordancia],
  [`zero discordância de squad com p ≥ 0,90 (${sq.discordanciasConfiantes})`, sq.discordanciasConfiantes === 0],
  [`p95 < 1,5 s (${p95 ?? "—"} ms)`, p95 !== null && p95 < PROMOCAO.p95Ms],
  [`falhas < 2% (${pct(falhas.length, total)})`, falhas.length / total < PROMOCAO.falhas],
  [`redirecionamento ≥ 10% das demandas (${pct(redirecionadas, total)})`, redirecionadas / total >= PROMOCAO.taxaRedirecionamento],
];
console.log("\nCritérios de promoção do roteamento de squad (todos precisam passar; promover é decisão do Rômulo):");
for (const [texto, ok] of criterios) console.log(`  [${ok ? "x" : " "}] ${texto}`);

const discordancias = respondidas
  .filter((r) => Object.values(r.comparacao ?? {}).some((i) => i && i.concorda === false))
  .slice(-10)
  .reverse();
console.log(`\nDiscordâncias mais recentes (${discordancias.length}):`);
for (const r of discordancias) {
  const itens = Object.entries(r.comparacao ?? {})
    .filter(([, i]) => i && i.concorda === false)
    .map(([k, i]) => `${k}: Jev ${i!.jev} (p ${i!.p}) × Gemini ${i!.gemini}`);
  const demanda = r.demanda !== undefined ? JSON.stringify(r.demanda) : `sha256 ${r.hashDaDemanda.slice(0, 12)}…, ${r.tamanhoDaDemanda} caracteres`;
  console.log(`  ${quando(r.quando)} · ${r.squadInicial}→${r.squadFinal}${r.squadExplicita ? " (explícita)" : ""} · ${demanda}\n    ${itens.join("; ")}`);
}
