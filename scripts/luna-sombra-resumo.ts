/**
 * Resumo da Luna em sombra (ARCHITECTURE "Luna em modo sombra"). Só lê: nunca
 * grava, nunca chama modelo nenhum.
 *
 *   npx tsx scripts/luna-sombra-resumo.ts ~/.local/share/squadone/luna-sombra
 *
 * Lê todos os `*.jsonl` do diretório e imprime o total, a contagem por
 * veredito, a concordância por capacidade e as 10 divergências mais recentes.
 * A demanda só aparece quando está gravada na linha
 * (SQUADONE_LUNA_GUARDAR_DEMANDA=true); senão, só o hash curto e o tamanho.
 * Linha torta é contada e pulada. Sai com código 2 sem diretório ou sem linhas.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DetalheDaComparacao, RegistroDaSombra } from "../server/luna-sombra.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("Uso: npx tsx scripts/luna-sombra-resumo.ts <diretório com os *.jsonl da sombra>");
  process.exit(2);
}

async function lerRegistros(pasta: string): Promise<{ registros: RegistroDaSombra[]; tortas: number; arquivos: number }> {
  const nomes = (await fs.readdir(pasta)).filter((n) => n.endsWith(".jsonl")).sort();
  const registros: RegistroDaSombra[] = [];
  let tortas = 0;
  for (const nome of nomes) {
    const texto = await fs.readFile(path.join(pasta, nome), "utf8");
    for (const linha of texto.split("\n")) {
      if (!linha.trim()) continue;
      try {
        const r = JSON.parse(linha) as RegistroDaSombra;
        if (typeof r.quando !== "string" || typeof r.veredito !== "string") throw new Error("campos");
        registros.push(r);
      } catch {
        tortas++;
      }
    }
  }
  registros.sort((a, b) => a.quando.localeCompare(b.quando));
  return { registros, tortas, arquivos: nomes.length };
}

function contar<T extends string>(valores: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function porcentagem(parte: number, total: number): string {
  return total === 0 ? "—" : `${Math.round((parte / total) * 100)}%`;
}

interface Concordancia {
  igual: number;
  divergente: number;
  so_gemini: number;
  so_luna: number;
}

function concordanciaPorCapacidade(registros: RegistroDaSombra[]): Map<string, Concordancia> {
  const m = new Map<string, Concordancia>();
  for (const r of registros) {
    for (const d of r.detalhes ?? []) {
      const c = m.get(d.nome) ?? { igual: 0, divergente: 0, so_gemini: 0, so_luna: 0 };
      c[d.resultado]++;
      m.set(d.nome, c);
    }
  }
  return m;
}

function quando(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

function linhaDaDivergencia(r: RegistroDaSombra): string[] {
  const cabeca = `${quando(r.quando)} · ${r.squad} · ${r.modo} · ${r.veredito}${r.falha ? ` (${r.falha.motivo}: ${r.falha.detalhe})` : ""}`;
  const demanda = r.demanda !== undefined ? `  demanda: ${JSON.stringify(r.demanda)}` : `  demanda: sha256 ${r.hashDaDemanda.slice(0, 12)}…, ${r.tamanhoDaDemanda} caracteres`;
  const detalhes = (r.detalhes ?? [])
    .filter((d: DetalheDaComparacao) => d.resultado !== "igual")
    .map((d) => `  ${d.nome}: ${d.resultado}${d.divergencias.length ? ` — ${d.divergencias.join("; ")}` : ""}`);
  if (r.veredito === "falhou" && r.gemini?.length) detalhes.push(`  gemini: ${r.gemini.map((g) => g.nome).join(", ")}`);
  return [cabeca, demanda, ...detalhes];
}

const { registros, tortas, arquivos } = await lerRegistros(dir).catch((err: any) => {
  console.error(`Não deu para ler ${dir}: ${err?.message ?? err}`);
  process.exit(2);
});

if (registros.length === 0) {
  console.log(`Nenhuma observação em ${dir} (${arquivos} arquivo(s)${tortas ? `, ${tortas} linha(s) torta(s)` : ""}).`);
  process.exit(2);
}

const total = registros.length;
const primeiro = registros[0].quando;
const ultimo = registros[total - 1].quando;
console.log(`Luna em sombra — ${total} turno(s) observado(s) de ${quando(primeiro)} a ${quando(ultimo)} (${arquivos} arquivo(s)${tortas ? `, ${tortas} linha(s) torta(s) ignorada(s)` : ""})`);

console.log("\nPor veredito:");
for (const v of ["igual", "parcial", "diferente", "falhou"] as const) {
  const n = contar(registros.map((r) => r.veredito)).get(v) ?? 0;
  console.log(`  ${v.padEnd(10)} ${String(n).padStart(4)}  ${porcentagem(n, total)}`);
}
const comVeredito = registros.filter((r) => r.veredito !== "falhou");
if (comVeredito.length > 0) {
  const iguais = comVeredito.filter((r) => r.veredito === "igual").length;
  console.log(`  concordância plena entre as que responderam: ${porcentagem(iguais, comVeredito.length)} (${iguais}/${comVeredito.length})`);
}
const falhas = contar(registros.filter((r) => r.falha).map((r) => r.falha!.motivo));
if (falhas.size > 0) {
  console.log(`  falhas por motivo: ${[...falhas].map(([m, n]) => `${m} ${n}`).join(", ")}`);
}
const duracoes = registros.map((r) => r.duracaoMs).filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
if (duracoes.length > 0) {
  console.log(`  duração: mediana ${Math.round(duracoes[Math.floor(duracoes.length / 2)] / 1000)} s, máxima ${Math.round(duracoes[duracoes.length - 1] / 1000)} s`);
}

console.log("\nPor capacidade (chamadas do Gemini pareadas com as da Luna):");
const porCapacidade = concordanciaPorCapacidade(comVeredito);
if (porCapacidade.size === 0) console.log("  (nenhuma chamada comparada)");
for (const [nome, c] of [...porCapacidade].sort((a, b) => a[0].localeCompare(b[0]))) {
  const doGemini = c.igual + c.divergente + c.so_gemini;
  console.log(
    `  ${nome.padEnd(22)} Gemini ${String(doGemini).padStart(3)} · iguais ${String(c.igual).padStart(3)} (${porcentagem(c.igual, doGemini)}) · divergentes ${String(c.divergente).padStart(3)} · só Gemini ${String(c.so_gemini).padStart(3)} · só Luna ${String(c.so_luna).padStart(3)}`,
  );
}

const divergencias = registros.filter((r) => r.veredito !== "igual").slice(-10).reverse();
console.log(`\nDivergências mais recentes (${divergencias.length} de ${registros.length - comVeredito.filter((r) => r.veredito === "igual").length}):`);
if (divergencias.length === 0) console.log("  (nenhuma)");
for (const r of divergencias) console.log(linhaDaDivergencia(r).join("\n"));
