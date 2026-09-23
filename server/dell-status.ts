import fs from "node:fs/promises";
import path from "node:path";

// Retrato do Dell gravado a cada minuto por deploy/dell/dell-status.py.
// A Central só lê este arquivo: nenhuma verificação roda a partir do navegador
// e o SquadOne não recebe chave de nenhum serviço (RULES 8 e 10).

export type EstadoDaVerificacao = "ok" | "atencao" | "falha";
export type GrupoDaVerificacao = "servicos" | "fluxos" | "dados" | "containers" | "maquina" | "pendencias";

export interface Verificacao {
  id: string;
  grupo: GrupoDaVerificacao;
  nome: string;
  estado: EstadoDaVerificacao;
  detalhe: string;
  desde?: string;
  link?: string;
}

export interface StatusDoDell {
  geradoEm: string | null;
  verificacoes: Verificacao[];
}

export const ARQUIVO_STATUS = "status.json";
// O script roda a cada minuto; cinco minutos sem retrato novo é o próprio monitor parado.
export const RETRATO_VENCIDO_MS = 5 * 60_000;

const ESTADOS = new Set<EstadoDaVerificacao>(["ok", "atencao", "falha"]);
const GRUPOS = new Set<GrupoDaVerificacao>(["servicos", "fluxos", "dados", "containers", "maquina", "pendencias"]);

function lerLink(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  try {
    const url = new URL(valor);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** PURO: JSON cru + relógio -> retrato válido. Item ilegível é descartado, não derruba o resto. */
export function interpretarStatusDoDell(bruto: unknown, agora: Date): StatusDoDell {
  const monitor = (estado: EstadoDaVerificacao, detalhe: string): Verificacao => ({
    id: "monitor", grupo: "servicos", nome: "Monitor do Dell", estado, detalhe,
  });
  if (!bruto || typeof bruto !== "object") {
    return { geradoEm: null, verificacoes: [monitor("atencao", "Monitor do Dell ainda não gravou nenhum retrato.")] };
  }
  const fonte = bruto as Record<string, unknown>;
  const geradoEm = typeof fonte.geradoEm === "string" && !Number.isNaN(Date.parse(fonte.geradoEm)) ? fonte.geradoEm : null;
  const verificacoes: Verificacao[] = [];
  for (const item of Array.isArray(fonte.verificacoes) ? fonte.verificacoes : []) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.id !== "string" || typeof v.nome !== "string" || typeof v.detalhe !== "string") continue;
    if (!ESTADOS.has(v.estado as EstadoDaVerificacao) || !GRUPOS.has(v.grupo as GrupoDaVerificacao)) continue;
    verificacoes.push({
      id: v.id,
      grupo: v.grupo as GrupoDaVerificacao,
      nome: v.nome.slice(0, 120),
      estado: v.estado as EstadoDaVerificacao,
      detalhe: v.detalhe.slice(0, 300),
      ...(typeof v.desde === "string" && !Number.isNaN(Date.parse(v.desde)) ? { desde: v.desde } : {}),
      ...(lerLink(v.link) ? { link: lerLink(v.link) } : {}),
    });
  }
  if (!geradoEm) {
    verificacoes.unshift(monitor("atencao", "Retrato sem horário: não dá para saber se está atualizado."));
  } else if (agora.getTime() - Date.parse(geradoEm) > RETRATO_VENCIDO_MS) {
    const minutos = Math.round((agora.getTime() - Date.parse(geradoEm)) / 60_000);
    verificacoes.unshift(monitor("falha", `Sem retrato novo há ${minutos} min: o que aparece abaixo pode estar velho.`));
  }
  return { geradoEm, verificacoes };
}

export async function lerStatusDoDell(dataDir: string, agora = new Date()): Promise<StatusDoDell> {
  try {
    const texto = await fs.readFile(path.join(dataDir, ARQUIVO_STATUS), "utf8");
    return interpretarStatusDoDell(JSON.parse(texto), agora);
  } catch (error: any) {
    if (error?.code === "ENOENT") return interpretarStatusDoDell(null, agora);
    return interpretarStatusDoDell({ geradoEm: null, verificacoes: [] }, agora);
  }
}
