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
 *
 *   npx tsx scripts/conferir-roster.ts --historico <SQUADONE_DATA_DIR> [--diff <a> <b>]
 *
 * Lista as cópias datadas que o servidor guarda em `<dados>/historico/` (uma por
 * gravação do roster: a versão ANTERIOR), com a data e as contagens de ativos e
 * arquivados. Com `--diff`, mostra o que existe só de um lado, o que mudou de
 * estado (arquivado/reativado) e o que teve o texto alterado, sem imprimir o
 * treino. `<a>` e `<b>` são nomes de cópia, caminhos ou `atual` (o squad.json).
 * Nunca grava: voltar atrás é do RESTAURAR.md.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDoNome, nomesDasCopias, PASTA_HISTORICO } from "../server/roster-historico.ts";
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

const USO =
  "uso: npx tsx scripts/conferir-roster.ts <squad.json de produção> [<squad.json arquivado do Dell>]\n" +
  "     npx tsx scripts/conferir-roster.ts --historico <SQUADONE_DATA_DIR> [--diff <a> <b>]";

/** Estado e conteúdo de cada id, para o diff do histórico: nada do texto sai daqui. */
interface Fichas {
  squads: Map<string, { ativo: boolean; marca: string }>;
  dominios: Map<string, { ativo: boolean; marca: string }>;
  pessoas: Map<string, { ativo: boolean; marca: string }>;
}

/** Impressão digital do registro (sem filhos e sem as chaves de arquivamento): mudou o texto ou não. */
const marcaDe = (x: object, filhos: string[]): string => {
  const { arquivado, arquivadoEm, ...resto } = x as Record<string, unknown>;
  for (const f of filhos) delete resto[f];
  return createHash("sha256").update(JSON.stringify(resto)).digest("hex").slice(0, 12);
};

function fichas(roster: Roster): Fichas {
  const f: Fichas = { squads: new Map(), dominios: new Map(), pessoas: new Map() };
  for (const s of roster.squads) {
    f.squads.set(s.id, { ativo: ativo(s), marca: marcaDe(s, ["dominios"]) });
    for (const d of s.dominios) {
      f.dominios.set(d.id, { ativo: ativo(d), marca: marcaDe(d, ["po", "integrantes"]) });
      for (const p of [d.po, ...d.integrantes]) f.pessoas.set(p.id, { ativo: ativo(p), marca: marcaDe(p, []) });
    }
  }
  return f;
}

/** Contagens de uma cópia, por nível: ativos e arquivados. */
function contagens(roster: Roster): string {
  const f = fichas(roster);
  const c = (m: Map<string, { ativo: boolean }>) => {
    const a = [...m.values()].filter((x) => x.ativo).length;
    return `${a} ativ. + ${m.size - a} arquiv.`;
  };
  return `squads ${c(f.squads)} | domínios ${c(f.dominios)} | pessoas ${c(f.pessoas)}`;
}

/** Um dos dois lados do diff: nome de cópia (`squad.<ISO>.json`), "atual" ou um caminho. */
function resolverCopia(dados: string, ref: string): string {
  if (ref === "atual") return path.join(dados, "squad.json");
  return path.isAbsolute(ref) || ref.includes("/") || ref.includes("\\") ? ref : path.join(dados, PASTA_HISTORICO, ref);
}

async function historico(dados: string, diff: [string, string] | null): Promise<number> {
  const nomes = await nomesDasCopias(dados);
  console.log(`Histórico: ${path.join(dados, PASTA_HISTORICO)} — ${nomes.length} cópia(s)`);
  for (const nome of nomes) {
    const r = await ler(path.join(dados, PASTA_HISTORICO, nome));
    const quando = (dataDoNome(nome) as Date).toISOString();
    console.log(`  ${nome}  ${quando}  ${r.roster ? contagens(r.roster) : `✖ ilegível: ${r.erro}`}`);
  }
  if (!diff) return 0;

  const [ra, rb] = [resolverCopia(dados, diff[0]), resolverCopia(dados, diff[1])];
  const [a, b] = await Promise.all([ler(ra), ler(rb)]);
  console.log(`\nDiff: ${diff[0]} → ${diff[1]}`);
  for (const [lado, x] of [[diff[0], a], [diff[1], b]] as const) {
    if (!x.roster) {
      console.log(`  ✖ ${lado} não serve como v3: ${x.erro}`);
      return 1;
    }
  }
  const [ia, ib] = [ids(a.roster!), ids(b.roster!)];
  const [fa, fb] = [fichas(a.roster!), fichas(b.roster!)];
  let diferencas = 0;
  for (const tipo of ["squads", "dominios", "pessoas"] as const) {
    const soA = soNoPrimeiro(ia[tipo], ib[tipo]);
    const soB = soNoPrimeiro(ib[tipo], ia[tipo]);
    // Os dois lados têm o id: mudou de estado (arquivou/reativou) ou de texto?
    const arquivados: string[] = [];
    const editados: string[] = [];
    for (const [id, antes] of fa[tipo]) {
      const depois = fb[tipo].get(id);
      if (!depois) continue;
      if (antes.ativo !== depois.ativo) arquivados.push(`${id} (${depois.ativo ? "reativado" : "arquivado"})`);
      else if (antes.marca !== depois.marca) editados.push(id);
    }
    for (const [titulo, lista] of [
      [`só em ${diff[0]}`, soA],
      [`só em ${diff[1]}`, soB],
      ["estado mudou", arquivados],
      ["texto mudou (conteúdo não é mostrado)", editados],
    ] as const) {
      if (!lista.length) continue;
      diferencas += lista.length;
      console.log(`  ${tipo} ${titulo}: ${lista.join(", ")}`);
    }
  }
  if (diferencas === 0) console.log("  Sem diferença em squads, domínios e pessoas.");
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const i = args.indexOf("--historico");
  if (i >= 0) {
    const dados = args[i + 1];
    if (!dados || dados.startsWith("--")) {
      console.error(USO);
      return 2;
    }
    const d = args.indexOf("--diff");
    if (d >= 0 && (!args[d + 1] || !args[d + 2])) {
      console.error(USO);
      return 2;
    }
    try {
      return await historico(dados, d >= 0 ? [args[d + 1], args[d + 2]] : null);
    } catch (err: any) {
      console.error(`✖ ${err?.code === "ENOENT" ? `não achei ${err.path}` : (err?.message ?? err)}`);
      return 1;
    }
  }

  const [producao, arquivado] = args;
  if (!producao) {
    console.error(USO);
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
