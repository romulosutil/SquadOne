import fs from "node:fs/promises";
import path from "node:path";

// Retrato do Dell gravado a cada minuto por deploy/dell/dell-status.py.
// A Central só lê este arquivo: nenhuma verificação roda a partir do navegador
// e o SquadOne não recebe chave de nenhum serviço (RULES 8 e 10).

export type EstadoDaVerificacao = "ok" | "atencao" | "falha";
export type GrupoDaVerificacao = "servicos" | "fluxos" | "dados" | "containers" | "maquina" | "pendencias";

export interface AcaoDaVerificacao {
  rotulo: string;
  /** URL http(s) ou rota da própria Central (começa com "/", ex.: "/crm?produto=site"). */
  url: string;
}

export interface Verificacao {
  id: string;
  grupo: GrupoDaVerificacao;
  nome: string;
  estado: EstadoDaVerificacao;
  detalhe: string;
  desde?: string;
  link?: string;
  /** O que isso quer dizer e o que o Rômulo faz ("o_que_fazer" no status.json). */
  oQueFazer?: string;
  /** O link que resolve, quando existe. */
  acao?: AcaoDaVerificacao;
  /** Resolve sozinho: não precisa do Rômulo, só aparece para ele saber. */
  sozinho?: boolean;
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

// Rota da Central: "/" + caminho, sem "//" (outro host) nem esquema.
const ROTA_DA_CENTRAL = /^\/(?!\/)[\w\-./?=&%]*$/;

function lerAcao(valor: unknown): AcaoDaVerificacao | undefined {
  if (!valor || typeof valor !== "object") return undefined;
  const { rotulo, url } = valor as Record<string, unknown>;
  if (typeof rotulo !== "string" || !rotulo.trim() || typeof url !== "string") return undefined;
  const destino = ROTA_DA_CENTRAL.test(url) ? url : lerLink(url);
  return destino ? { rotulo: rotulo.trim().slice(0, 60), url: destino } : undefined;
}

/** PURO: JSON cru + relógio -> retrato válido. Item ilegível é descartado, não derruba o resto. */
export function interpretarStatusDoDell(bruto: unknown, agora: Date): StatusDoDell {
  const monitor = (estado: EstadoDaVerificacao, detalhe: string): Verificacao => ({
    id: "monitor", grupo: "servicos", nome: "Monitor do Dell", estado, detalhe,
    oQueFazer: estado === "falha"
      ? "O monitor parou ou o Dell está desligado: o resto desta página pode estar velho. Se o Dell está ligado, peça ao Claude: \"o dell-status parou\"."
      : "O monitor do Dell ainda não gravou o retrato. Se continuar assim por mais de 5 minutos, peça ao Claude conferir o dell-status.",
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
      ...(typeof v.o_que_fazer === "string" && v.o_que_fazer.trim() ? { oQueFazer: v.o_que_fazer.trim().slice(0, 400) } : {}),
      ...(lerAcao(v.acao) ? { acao: lerAcao(v.acao) } : {}),
      ...(v.sozinho === true ? { sozinho: true } : {}),
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
