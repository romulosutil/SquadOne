import fs from "node:fs/promises";
import path from "node:path";

/**
 * Roster em ÁRVORE, não em lista (spec §3.1).
 *
 *   squad
 *     └── domínio            ← dono de um tema; ocupa UMA sala do escritório
 *           ├── po           ← dono do domínio; pode propor novos domínios
 *           └── integrantes  ← designer, tech lead, QA... contratados PELO po
 *
 * Uma sala = um domínio inteiro, com várias pessoas dentro. O slot pertence ao
 * domínio, nunca à pessoa: contratar um QA não abre sala nova, criar um domínio
 * abre.
 */

/** Qualquer pessoa do squad — o PO de um domínio ou um integrante dele. */
export interface Pessoa {
  id: string;
  nome: string;
  papel: string;
  escopo: string;
  /** chave no craftpix.manifest.json */
  sprite: string;
  /** graus de hue-rotate, para diferenciar papéis que reusam o mesmo sprite */
  hue?: number;
  horario?: { inicio: string; fim: string };
  hiredAt: string;
}

export interface Dominio {
  /** slug estável: é o valor de `squadone_dominio` no Google Calendar. */
  id: string;
  nome: string;
  escopo: string;
  slot: [number, number];
  room: string;
  criadoEm: string;
  po: Pessoa;
  integrantes: Pessoa[];
}

export interface Squad {
  version: number;
  unlockOrder: [number, number][];
  dominios: Dominio[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const SQUAD_PATH = path.join(DATA_DIR, "squad.json");
const SEED_PATH = path.join(DATA_DIR, "squad.seed.json");

/** Salas do escritório: grade 3x3. Passou disso, não há slot para alocar. */
export const MAX_DOMINIOS = 9;

/**
 * Escreve o roster de forma atômica: grava num `.tmp` no mesmo diretório e
 * renomeia por cima. Um crash no meio da escrita deixa o `.tmp` pela metade,
 * nunca o `squad.json`.
 */
export async function writeSquad(squad: Squad): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${SQUAD_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(squad, null, 2) + "\n", "utf8");
  try {
    await fs.rename(tmp, SQUAD_PATH);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Copia a seed versionada se `data/squad.json` ainda não existir. */
async function ensureSquad(): Promise<void> {
  try {
    await fs.access(SQUAD_PATH);
    return;
  } catch {
    // não existe: semeia
  }
  const seed = JSON.parse(await fs.readFile(SEED_PATH, "utf8")) as Squad;
  await writeSquad(seed);
}

/** Roster v1: lista plana de `members`, um membro por sala. */
interface MembroV1 {
  id: string;
  nome: string;
  papel: string;
  escopo: string;
  dominio?: string;
  sprite: string;
  slot: [number, number];
  room: string;
  horario?: { inicio: string; fim: string };
  hiredAt: string;
}

/**
 * v1 → v2. No modelo antigo cada membro tinha o seu próprio slot, ou seja, já
 * era de fato um domínio de uma pessoa só: cada membro vira um domínio com ele
 * como PO e nenhum integrante. Nada se move na tela — o slot é o mesmo.
 */
function migrarV1(antigo: { version: number; unlockOrder: [number, number][]; members: MembroV1[] }): Squad {
  return {
    version: 2,
    unlockOrder: antigo.unlockOrder,
    dominios: antigo.members.map((m) => ({
      id: slug(m.dominio ?? m.papel),
      nome: m.dominio ?? m.papel,
      escopo: m.escopo,
      slot: m.slot,
      room: m.room,
      criadoEm: m.hiredAt,
      po: {
        id: m.id,
        nome: m.nome,
        papel: m.papel,
        escopo: m.escopo,
        sprite: m.sprite,
        horario: m.horario,
        hiredAt: m.hiredAt,
      },
      integrantes: [],
    })),
  };
}

export async function readSquad(): Promise<Squad> {
  await ensureSquad();
  const bruto = JSON.parse(await fs.readFile(SQUAD_PATH, "utf8"));
  if (Array.isArray(bruto?.members) && !Array.isArray(bruto?.dominios)) {
    const migrado = migrarV1(bruto);
    // Persistir a migração: o arquivo é a verdade do roster, e converter a
    // cada leitura esconderia um formato morto vivo no disco.
    await writeSquad(migrado);
    return migrado;
  }
  return bruto as Squad;
}

/**
 * Fonte de verdade dos slots desbloqueados: `dominios.length`.
 * Guardar "salas desbloqueadas" em separado seria estado duplicado — e contar
 * PESSOAS abriria sala ao contratar um QA, que mora na sala do próprio PO.
 */
export function unlockedSlots(squad: Squad): [number, number][] {
  return squad.unlockOrder.slice(0, squad.dominios.length);
}

/** Próximo slot livre, ou null quando as 9 salas já estão ocupadas. */
export function proximoSlot(squad: Squad): [number, number] | null {
  return squad.unlockOrder[squad.dominios.length] ?? null;
}

/**
 * Slug estável usado como id de domínio e valor de `squadone_dominio` no
 * Google Calendar. Precisa ser determinístico: é a chave de filtro do
 * `events.list`, e um valor que mude quebra a leitura dos eventos já criados.
 */
export function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "geral";
}

/** Todas as pessoas do squad, cada uma com o domínio a que pertence. */
export function pessoas(squad: Squad): { pessoa: Pessoa; dominio: Dominio }[] {
  return squad.dominios.flatMap((d) =>
    [d.po, ...d.integrantes].map((pessoa) => ({ pessoa, dominio: d })),
  );
}

export function acharDominio(squad: Squad, id: unknown): Dominio | null {
  return squad.dominios.find((d) => d.id === id) ?? null;
}

/** Pessoa + o domínio dela. O domínio nunca é passado pelo modelo: é derivado. */
export function acharPessoa(
  squad: Squad,
  id: unknown,
): { pessoa: Pessoa; dominio: Dominio } | null {
  return pessoas(squad).find((p) => p.pessoa.id === id) ?? null;
}

/** Ids válidos para `responsavel_id`, na ordem em que aparecem na árvore. */
export function idsDePessoas(squad: Squad): string[] {
  return pessoas(squad).map((p) => p.pessoa.id);
}

/** Domínios distintos do squad — um `events.list` por domínio na Mochila. */
export function dominiosDoSquad(squad: Squad): string[] {
  return squad.dominios.map((d) => d.id);
}

/**
 * A ÁRVORE do roster injetada no systemInstruction (§6). Uma lista plana de
 * pessoas esconde a hierarquia: o modelo precisa ver a qual domínio cada pessoa
 * pertence para escolher o responsável certo e para saber se falta um domínio
 * inteiro (criar_po_dominio) ou só um papel dentro de um existente
 * (contratar_integrante).
 */
export function rosterTree(squad: Squad): string {
  return squad.dominios
    .map((d) => {
      const linhas = [
        `- domínio '${d.id}' — ${d.nome} (escopo: ${d.escopo})`,
        `    PO: '${d.po.id}' ${d.po.nome} (${d.po.papel}: ${d.po.escopo})`,
      ];
      for (const i of d.integrantes) {
        linhas.push(`    integrante: '${i.id}' ${i.nome} (${i.papel}: ${i.escopo})`);
      }
      return linhas.join("\n");
    })
    .join("\n");
}
