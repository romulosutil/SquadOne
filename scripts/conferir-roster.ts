/**
 * Confere o roster de PRODUÇÃO copiado do Easypanel antes de ele virar a agenda
 * do Dell (runbook do cutover, passo 2). Só lê: nunca grava, nunca mescla.
 *
 *   npx tsx scripts/conferir-roster.ts <squad.json de produção> [<squad.json arquivado do Dell>]
 *
 * Mostra o sha256 (tem de bater com o do console do Easypanel), se o arquivo
 * passa na mesma validação do servidor, e o que há nele: squads, domínios e
 * pessoas ativos e arquivados, por id e nome — nada do treino (escopo). Com o
 * segundo arquivo, lista o que existe SÓ no retrato de 14/09/2026 do Dell: é o
 * que fica de fora, de propósito, porque o de produção é a verdade e o do Dell
 * é arquivado, nunca mesclado. Sai com código 1 se o de produção não serve.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { ativo, detectarVersao, validarV3, type Roster } from "../server/squad.ts";

interface Ids {
  squads: Map<string, string>;
  dominios: Map<string, string>;
  pessoas: Map<string, string>;
}

function ids(roster: Roster): Ids {
  const r: Ids = { squads: new Map(), dominios: new Map(), pessoas: new Map() };
  for (const s of roster.squads) {
    r.squads.set(s.id, s.nome);
    for (const d of s.dominios) {
      r.dominios.set(d.id, d.nome);
      for (const p of [d.po, ...d.integrantes]) r.pessoas.set(p.id, p.nome);
    }
  }
  return r;
}

async function ler(caminho: string): Promise<{ roster: Roster | null; sha: string; versao: number | null; erro?: string }> {
  const bytes = await fs.readFile(caminho);
  const sha = createHash("sha256").update(bytes).digest("hex");
  let bruto: unknown;
  try {
    bruto = JSON.parse(bytes.toString("utf8"));
  } catch (err: any) {
    return { roster: null, sha, versao: null, erro: `JSON inválido (${err?.message ?? err})` };
  }
  let versao: number;
  try {
    versao = detectarVersao(bruto);
  } catch (err: any) {
    return { roster: null, sha, versao: null, erro: err?.message ?? String(err) };
  }
  if (versao !== 3) return { roster: null, sha, versao, erro: `roster v${versao}: o de produção é v3 desde a Fase 1` };
  try {
    return { roster: validarV3(bruto), sha, versao };
  } catch (err: any) {
    return { roster: null, sha, versao, erro: err?.message ?? String(err) };
  }
}

function resumo(roster: Roster): string[] {
  const linhas: string[] = [];
  for (const s of roster.squads) {
    const dominios = s.dominios.filter(ativo);
    const pessoas = dominios.flatMap((d) => [d.po, ...d.integrantes]).filter(ativo);
    linhas.push(
      `  ${ativo(s) ? "●" : "○ (arquivada)"} ${s.id} — ${s.nome}: ${dominios.length} domínio(s) e ${pessoas.length} pessoa(s) ativos` +
        `, ${s.dominios.length - dominios.length} domínio(s) arquivado(s)${s.tasksListaId ? ", com lista do Tasks" : ""}`,
    );
  }
  linhas.push(`  ids aposentados: ${roster.idsAposentados.pessoas.length} pessoa(s), ${roster.idsAposentados.dominios.length} domínio(s)`);
  return linhas;
}

function soNoPrimeiro(a: Map<string, string>, b: Map<string, string>): string[] {
  return [...a].filter(([id]) => !b.has(id)).map(([id, nome]) => `${id} (${nome})`);
}

async function main(): Promise<number> {
  const [producao, arquivado] = process.argv.slice(2);
  if (!producao) {
    console.error("uso: npx tsx scripts/conferir-roster.ts <squad.json de produção> [<squad.json arquivado do Dell>]");
    return 2;
  }
  const p = await ler(producao);
  console.log(`Produção: ${producao}`);
  console.log(`  sha256 ${p.sha}  (confira com o do console do Easypanel)`);
  if (!p.roster) {
    console.log(`  ✖ NÃO SERVE: ${p.erro}`);
    return 1;
  }
  console.log("  ✔ v3 válido (a mesma validação do servidor)");
  for (const l of resumo(p.roster)) console.log(l);

  if (arquivado) {
    const a = await ler(arquivado);
    console.log(`\nArquivado (retrato do Dell): ${arquivado}`);
    console.log(`  sha256 ${a.sha}`);
    if (!a.roster) {
      console.log(`  (ilegível como v3: ${a.erro}; nada a comparar)`);
      return 0;
    }
    const ip = ids(p.roster);
    const ia = ids(a.roster);
    const fora = {
      squads: soNoPrimeiro(ia.squads, ip.squads),
      dominios: soNoPrimeiro(ia.dominios, ip.dominios),
      pessoas: soNoPrimeiro(ia.pessoas, ip.pessoas),
    };
    const total = fora.squads.length + fora.dominios.length + fora.pessoas.length;
    console.log(total === 0
      ? "  Nada existe só no retrato do Dell: a produção cobre tudo."
      : "  Só no retrato do Dell (fica de fora: arquivado, nunca mesclado):");
    for (const [tipo, lista] of Object.entries(fora)) {
      if (lista.length) console.log(`    ${tipo}: ${lista.join(", ")}`);
    }
    const novos = soNoPrimeiro(ip.pessoas, ia.pessoas).length + soNoPrimeiro(ip.dominios, ia.dominios).length;
    console.log(`  Na produção e não no retrato: ${novos} pessoa(s)/domínio(s) (contratações depois de 14/09).`);
  }
  return 0;
}

process.exitCode = await main();
