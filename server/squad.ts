import fs from "node:fs/promises";
import path from "node:path";

export interface SquadMember {
  id: string;
  nome: string;
  papel: string;
  escopo: string;
  sprite: string;
  slot: [number, number];
  room: string;
  horario: { inicio: string; fim: string };
  hiredAt: string;
}

export interface Squad {
  version: number;
  unlockOrder: [number, number][];
  members: SquadMember[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const SQUAD_PATH = path.join(DATA_DIR, "squad.json");
const SEED_PATH = path.join(DATA_DIR, "squad.seed.json");

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

export async function readSquad(): Promise<Squad> {
  await ensureSquad();
  return JSON.parse(await fs.readFile(SQUAD_PATH, "utf8")) as Squad;
}

/**
 * Fonte de verdade dos slots desbloqueados: `members.length`.
 * Guardar "salas desbloqueadas" em separado seria estado duplicado.
 */
export function unlockedSlots(squad: Squad): [number, number][] {
  return squad.unlockOrder.slice(0, squad.members.length);
}

/** Linha do roster injetada no systemInstruction (§6). */
export function rosterLine(squad: Squad): string {
  return squad.members
    .map((m) => `'${m.id}' (${m.papel}: ${m.escopo})`)
    .join(", ");
}
