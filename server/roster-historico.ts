import fs from "node:fs/promises";
import path from "node:path";

/**
 * Histórico do roster: antes de cada gravação do `squad.json`, a versão
 * ANTERIOR vira uma cópia datada em `<dados>/historico/`. É o que permite
 * voltar atrás de uma edição ou arquivamento que não se queria.
 *
 * Por que arquivos e não um SQLite com Litestream (a ideia original da fase 8):
 * o Easypanel é a reserva fria (regra 25) e lê o `squad.json`. Trocar o formato
 * quebraria a volta ensaiada se o Dell morresse. Aqui nenhum formato muda: a
 * cópia é o próprio `squad.json` de antes, byte a byte, e restaurar é um
 * `install` (deploy/dell/backup/RESTAURAR.md).
 *
 * Este módulo não sabe quando o histórico liga: quem chama (`writeRoster`)
 * decide, porque só ele enxerga `SQUADONE_DATA_DIR` e o congelamento. As
 * funções de nome e de poda são puras; o resto é I/O que nunca derruba a
 * gravação do roster (`registrarHistorico`).
 */

/** Quantas cópias recentes sempre ficam, e por quantos dias as demais ficam. */
export const MANTER_COPIAS = 30;
export const MANTER_DIAS = 90;

export const PASTA_HISTORICO = "historico";

const PADRAO_NOME = /^squad\.(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z\.json$/;

/** `squad.2026-10-07T143015Z.json`: sem `:` (Windows recusa) e ordenável como texto. */
export function nomeDaCopia(agora: Date): string {
  const iso = agora.toISOString().slice(0, 19).replace(/:/g, "");
  return `squad.${iso}Z.json`;
}

/** Data gravada no nome, ou null se o nome não é de uma cópia nossa. */
export function dataDoNome(nome: string): Date | null {
  const m = PADRAO_NOME.exec(nome);
  if (!m) return null;
  const [, a, mes, d, h, mi, s] = m;
  const data = new Date(Date.UTC(+a, +mes - 1, +d, +h, +mi, +s));
  // Mês 13 ou dia 31 de fevereiro "rolam" no Date; o nome nunca foi gerado por nós.
  return data.toISOString().slice(0, 19).replace(/[-:]/g, "") === `${a}${mes}${d}T${h}${mi}${s}` ? data : null;
}

/** Só os nomes que são cópias, da mais antiga para a mais recente. */
export function soCopias(nomes: string[]): string[] {
  return nomes.filter((n) => dataDoNome(n) !== null).sort();
}

/**
 * Quais nomes apagar: fica quem está entre as `manter` mais recentes OU dentro
 * dos últimos `dias` dias — vale o critério que guardar MAIS arquivos. Assim
 * uma rajada de edições não empurra para fora uma cópia de ontem, e um mês
 * parado não deixa o histórico vazio. Nome que não é de cópia nunca entra.
 */
export function quaisPodar(
  nomes: string[],
  agora: Date,
  { manter, dias }: { manter: number; dias: number },
): string[] {
  const copias = soCopias(nomes);
  const corte = agora.getTime() - dias * 24 * 60 * 60 * 1000;
  const recentes = new Set(copias.slice(Math.max(0, copias.length - manter)));
  return copias.filter((n) => !recentes.has(n) && (dataDoNome(n) as Date).getTime() < corte);
}

export async function nomesDasCopias(dados: string): Promise<string[]> {
  try {
    return soCopias(await fs.readdir(path.join(dados, PASTA_HISTORICO)));
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await fs.access(caminho);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copia o `squad.json` ATUAL para `historico/`, modo 600 (tem o treino de todos
 * os agentes). Devolve o nome criado, ou null se ainda não há `squad.json`
 * (primeira gravação: nada anterior para guardar).
 *
 * Duas gravações no mesmo segundo cairiam no mesmo nome e a segunda apagaria a
 * primeira cópia; o nome sobe de segundo em segundo até achar um livre. Só há
 * um escritor (a fila de `atualizarRoster`), então o "existe, depois renomeia"
 * não disputa com ninguém. Grava num `.tmp` e renomeia: cópia pela metade
 * nunca tem o nome de uma cópia.
 */
export async function guardarCopia(dados: string, agora: Date): Promise<string | null> {
  let conteudo: Buffer;
  try {
    conteudo = await fs.readFile(path.join(dados, "squad.json"));
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  const pasta = path.join(dados, PASTA_HISTORICO);
  await fs.mkdir(pasta, { recursive: true, mode: 0o700 });
  // mkdir não restringe uma pasta já existente ou restaurada com outro modo.
  await fs.chmod(pasta, 0o700);

  let quando = agora;
  while (await existe(path.join(pasta, nomeDaCopia(quando)))) quando = new Date(quando.getTime() + 1000);
  const nome = nomeDaCopia(quando);

  const tmp = path.join(pasta, `.${nome}.${process.pid}.tmp`);
  try {
    await fs.writeFile(tmp, conteudo, { mode: 0o600 });
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, path.join(pasta, nome));
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return nome;
}

/** Apaga o que `quaisPodar` aponta; devolve quantas cópias saíram. */
export async function podarHistorico(dados: string, agora: Date): Promise<number> {
  const pasta = path.join(dados, PASTA_HISTORICO);
  const fora = quaisPodar(await nomesDasCopias(dados), agora, { manter: MANTER_COPIAS, dias: MANTER_DIAS });
  for (const nome of fora) await fs.rm(path.join(pasta, nome), { force: true });
  return fora.length;
}

/**
 * Cada tipo de falha vai ao log uma vez por processo: disco cheio ou pasta sem
 * permissão repetiria o mesmo erro a cada edição do roster, e o log do Dell
 * é onde o dono lê o resto.
 */
const falhasLogadas = new Set<string>();

export function reiniciarLogDeFalhas(): void {
  falhasLogadas.clear();
}

function registrarFalha(etapa: "copiar" | "podar", err: any): void {
  const chave = `${etapa}:${err?.code ?? err?.name ?? "?"}`;
  if (falhasLogadas.has(chave)) return;
  falhasLogadas.add(chave);
  console.error(`[roster-historico] falha ao ${etapa} (${err?.code ?? err?.name ?? "erro"}): o roster foi gravado mesmo assim. ${err?.message ?? err}`);
}

/**
 * O que `writeRoster` chama ANTES de trocar o arquivo: copia a versão atual e
 * NUNCA lança. O histórico é uma rede de segurança; uma falha dele não pode
 * impedir contratar, editar ou arquivar.
 */
export async function copiarParaHistorico(dados: string, agora: Date = new Date()): Promise<void> {
  try {
    await guardarCopia(dados, agora);
  } catch (err) {
    registrarFalha("copiar", err);
  }
}

/** O que `writeRoster` chama DEPOIS de gravar o roster novo; também nunca lança. */
export async function podarDoHistorico(dados: string, agora: Date = new Date()): Promise<void> {
  try {
    await podarHistorico(dados, agora);
  } catch (err) {
    registrarFalha("podar", err);
  }
}

/** Linha do boot: quantas cópias há e de quando é a mais recente. Sem conteúdo. */
export async function descreverHistorico(dados: string): Promise<string> {
  try {
    const nomes = await nomesDasCopias(dados);
    if (nomes.length === 0) return "histórico do roster: nenhuma cópia ainda";
    const recente = dataDoNome(nomes[nomes.length - 1]) as Date;
    return `histórico do roster: ${nomes.length} cópia(s), a mais recente de ${recente.toISOString()}`;
  } catch (err: any) {
    return `histórico do roster: ilegível (${err?.code ?? err?.name ?? "erro"})`;
  }
}
