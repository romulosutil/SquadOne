import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MOTIVOS_DE_AVALIACAO = [
  "prompt",
  "papel",
  "roteamento",
  "agendamento",
  "outro",
] as const;

export type MotivoDeAvaliacao = (typeof MOTIVOS_DE_AVALIACAO)[number];

export interface PedidoDeAvaliacao {
  nota: 1 | 2 | 3 | 4 | 5;
  motivos: MotivoDeAvaliacao[];
  comentario?: string;
}

const MAX_MOTIVOS = 3;
const MAX_COMENTARIO = 1000;
const CAMPOS = new Set(["nota", "motivos", "comentario"]);
const MOTIVOS = new Set<string>(MOTIVOS_DE_AVALIACAO);

export class AvaliacaoInvalida extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvaliacaoInvalida";
  }
}

function comoRegistro(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AvaliacaoInvalida("Avaliação deve ser um objeto.");
  }
  return value as Record<string, unknown>;
}

function normalizarComentario(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new AvaliacaoInvalida("Comentário deve ser texto.");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    throw new AvaliacaoInvalida("Comentário contém caracteres de controle.");
  }
  const comentario = value.replace(/\r\n?/g, "\n").trim();
  if (comentario.length > MAX_COMENTARIO) {
    throw new AvaliacaoInvalida(`Comentário deve ter no máximo ${MAX_COMENTARIO} caracteres.`);
  }
  return comentario || undefined;
}

function interpretarMotivos(value: unknown): MotivoDeAvaliacao[] {
  if (!Array.isArray(value) || value.length > MAX_MOTIVOS) {
    throw new AvaliacaoInvalida(`Motivos devem ser uma lista com até ${MAX_MOTIVOS} itens.`);
  }
  const motivos: MotivoDeAvaliacao[] = [];
  for (const motivo of value) {
    if (typeof motivo !== "string" || !MOTIVOS.has(motivo) || motivos.includes(motivo as MotivoDeAvaliacao)) {
      throw new AvaliacaoInvalida("Motivo de avaliação inválido ou repetido.");
    }
    motivos.push(motivo as MotivoDeAvaliacao);
  }
  return motivos;
}

/** Normaliza apenas sinais voluntários do usuário; o servidor cria toda evidência do turno. */
export function interpretarPedidoDeAvaliacao(value: unknown): PedidoDeAvaliacao {
  const body = comoRegistro(value);
  if (Object.keys(body).some((campo) => !CAMPOS.has(campo))) {
    throw new AvaliacaoInvalida("Avaliação contém campos desconhecidos.");
  }
  if (typeof body.nota !== "number" || !Number.isInteger(body.nota) || body.nota < 1 || body.nota > 5) {
    throw new AvaliacaoInvalida("Nota deve ser um número inteiro de 1 a 5.");
  }
  const nota = body.nota as PedidoDeAvaliacao["nota"];
  const motivos = interpretarMotivos(body.motivos);
  if (nota <= 3 && motivos.length === 0) {
    throw new AvaliacaoInvalida("Notas de 1 a 3 exigem ao menos um motivo.");
  }
  const comentario = normalizarComentario(body.comentario);
  return { nota, motivos, ...(comentario ? { comentario } : {}) };
}

export type ModoAvaliado = "auto" | "foco" | "baixa_prioridade";

/** Resumo sem demanda, prompt, roster, nomes, argumentos ou IDs externos. */
export interface EvidenciaDeTurno {
  origem: "app";
  concluidoEm: string;
  modo: ModoAvaliado;
  resultado: {
    eventos: number;
    sugestoes: number;
    avisos: number;
    erros: number;
    redirecionado: boolean;
  };
}

export interface ResultadoResumivel {
  eventos_criados: readonly unknown[];
  sugestoes: readonly unknown[];
  avisos: readonly unknown[];
  erros: readonly unknown[];
  redirecionado?: unknown;
}

/** Feature opt-in: sem a flag não há cache, arquivo ou superfície de feedback. */
export function avaliacoesHabilitadas(env: Record<string, string | undefined>): boolean {
  return env.SQUADONE_AVALIACOES === "true";
}

/** Remove detalhes de usuário e provedores externos antes de qualquer persistência local. */
export function resumirResultadoDoTurno(
  modo: ModoAvaliado,
  resultado: ResultadoResumivel,
  concluidoEm: string,
): EvidenciaDeTurno {
  return {
    origem: "app",
    concluidoEm,
    modo,
    resultado: {
      eventos: resultado.eventos_criados.length,
      sugestoes: resultado.sugestoes.length,
      avisos: resultado.avisos.length,
      erros: resultado.erros.length,
      redirecionado: Boolean(resultado.redirecionado),
    },
  };
}

interface RegistroPendente {
  criadaEmMs: number;
  evidencia: EvidenciaDeTurno;
}

export interface OpcoesDoCacheDeTurnos {
  agora?: () => number;
  gerarId?: () => string;
  ttlMs?: number;
  limite?: number;
}

/** Memória curta: só liga avaliação ao resultado que este processo acabou de produzir. */
export class CacheDeTurnosParaAvaliacao {
  private readonly agora: () => number;
  private readonly gerarId: () => string;
  private readonly ttlMs: number;
  private readonly limite: number;
  private readonly registros = new Map<string, RegistroPendente>();

  constructor(opcoes: OpcoesDoCacheDeTurnos = {}) {
    this.agora = opcoes.agora ?? Date.now;
    this.gerarId = opcoes.gerarId ?? randomUUID;
    this.ttlMs = opcoes.ttlMs ?? 30 * 60 * 1000;
    this.limite = opcoes.limite ?? 100;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0 || !Number.isSafeInteger(this.limite) || this.limite <= 0) {
      throw new Error("Configuração inválida do cache de avaliações.");
    }
  }

  registrar(evidencia: EvidenciaDeTurno): string {
    this.removerExpirados();
    while (this.registros.size >= this.limite) {
      const maisAntigo = this.registros.keys().next().value as string | undefined;
      if (!maisAntigo) break;
      this.registros.delete(maisAntigo);
    }
    const id = this.gerarId();
    this.registros.set(id, { criadaEmMs: this.agora(), evidencia });
    return id;
  }

  obter(id: string): EvidenciaDeTurno | undefined {
    this.removerExpirados();
    return this.registros.get(id)?.evidencia;
  }

  remover(id: string): void {
    this.registros.delete(id);
  }

  private removerExpirados(): void {
    const agora = this.agora();
    for (const [id, registro] of this.registros) {
      if (agora - registro.criadaEmMs > this.ttlMs) this.registros.delete(id);
    }
  }
}

export interface RegistroDeAvaliacaoDeTurno {
  version: 1;
  id: string;
  turnoId: string;
  criadaEm: string;
  avaliacao: PedidoDeAvaliacao;
  evidencia: EvidenciaDeTurno;
}

export class TurnoJaAvaliado extends Error {
  constructor() {
    super("Este turno já recebeu uma avaliação.");
    this.name = "TurnoJaAvaliado";
  }
}

export class AvaliacoesIlegiveis extends Error {
  constructor() {
    super("Arquivo local de avaliações ilegível.");
    this.name = "AvaliacoesIlegiveis";
  }
}

function ehRegistroDeAvaliacaoDeTurno(value: unknown): value is RegistroDeAvaliacaoDeTurno {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const registro = value as Record<string, unknown>;
  if (
    registro.version !== 1 ||
    typeof registro.id !== "string" ||
    !registro.id ||
    typeof registro.turnoId !== "string" ||
    !registro.turnoId ||
    typeof registro.criadaEm !== "string" ||
    Number.isNaN(Date.parse(registro.criadaEm))
  ) return false;
  try {
    interpretarPedidoDeAvaliacao(registro.avaliacao);
  } catch {
    return false;
  }
  const evidencia = registro.evidencia as Record<string, unknown> | null;
  if (!evidencia || typeof evidencia !== "object" || Array.isArray(evidencia)) return false;
  const resultado = evidencia.resultado as Record<string, unknown> | null;
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) return false;
  return (
    evidencia.origem === "app" &&
    typeof evidencia.concluidoEm === "string" &&
    !Number.isNaN(Date.parse(evidencia.concluidoEm)) &&
    (evidencia.modo === "auto" || evidencia.modo === "foco" || evidencia.modo === "baixa_prioridade") &&
    [resultado.eventos, resultado.sugestoes, resultado.avisos, resultado.erros].every(
      (contagem) => Number.isSafeInteger(contagem) && (contagem as number) >= 0,
    ) &&
    typeof resultado.redirecionado === "boolean"
  );
}

async function sincronizarDiretorio(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch (error: any) {
    if (!["EPERM", "EISDIR", "EINVAL", "EBADF"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

export interface OpcoesDoStoreDeAvaliacoes {
  agora?: () => Date;
  gerarId?: () => string;
}

/** Armazenamento privado, separado do roster e de qualquer fonte de prompt. */
export class AvaliacoesDeTurnoStore {
  readonly filePath: string;
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  private fila: Promise<unknown> = Promise.resolve();

  constructor(dataDirectory: string, opcoes: OpcoesDoStoreDeAvaliacoes = {}) {
    this.filePath = path.join(dataDirectory, "avaliacoes-turno.json");
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? randomUUID;
  }

  registrar(input: { turnoId: string; avaliacao: PedidoDeAvaliacao; evidencia: EvidenciaDeTurno }): Promise<RegistroDeAvaliacaoDeTurno> {
    const proximo = this.fila.then(async () => {
      const avaliacoes = await this.lerUnsafe();
      if (avaliacoes.some((avaliacao) => avaliacao.turnoId === input.turnoId)) throw new TurnoJaAvaliado();
      const registro: RegistroDeAvaliacaoDeTurno = {
        version: 1,
        id: this.gerarId(),
        turnoId: input.turnoId,
        criadaEm: this.agora().toISOString(),
        avaliacao: input.avaliacao,
        evidencia: input.evidencia,
      };
      await this.gravar([...avaliacoes, registro]);
      return registro;
    });
    this.fila = proximo.then(() => undefined, () => undefined);
    return proximo;
  }

  private async lerUnsafe(): Promise<RegistroDeAvaliacaoDeTurno[]> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AvaliacoesIlegiveis();
      const envelope = parsed as { version?: unknown; avaliacoes?: unknown };
      if (envelope.version !== 1 || !Array.isArray(envelope.avaliacoes) || !envelope.avaliacoes.every(ehRegistroDeAvaliacaoDeTurno)) {
        throw new AvaliacoesIlegiveis();
      }
      return envelope.avaliacoes;
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      if (error instanceof AvaliacoesIlegiveis) throw error;
      throw new AvaliacoesIlegiveis();
    }
  }

  private async gravar(avaliacoes: RegistroDeAvaliacaoDeTurno[]): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const arquivo = await fs.open(temporary, "w", 0o600);
      try {
        await arquivo.writeFile(`${JSON.stringify({ version: 1, avaliacoes }, null, 2)}\n`, "utf8");
        await arquivo.sync();
      } finally {
        await arquivo.close();
      }
      await fs.rename(temporary, this.filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    await sincronizarDiretorio(dir);
  }
}
