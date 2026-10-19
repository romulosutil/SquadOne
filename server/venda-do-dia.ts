import { promises as fs } from "node:fs";
import path from "node:path";
import { criarEmSerie } from "./em-serie.ts";

/**
 * O que já se resolveu hoje na fila de venda (16/10/2026, OT-01 do blueprint): "Enviei", "Pular" ou a
 * recusa marcada, por chave de ação (`leadId|tipo`). Uma memória só para a Próxima venda (Hoje e
 * Vendas, em qualquer navegador) e o vendedor do Telegram. Antes cada um lembrava num lugar
 * (localStorage do dia, memória da folha "Enviar um por um", vendedor.json), e o que se pulou numa
 * tela voltava na outra.
 *
 * 17/10/2026 (AC-06): o servidor virou a fonte única do dia, não só da ordem. Guarda também por onde
 * cada ação se resolveu (Central, Telegram ou o aviso que expirou), que anotação no CRM já saiu por
 * ela (o toque atrasado no Telegram não anota de novo o que a Central anotou no link) e os primeiros
 * contatos do dia, venham de onde vierem: a trava de ritmo contava dois montes separados
 * (localStorage da Central e vendedor.json) e dava para passar do teto somando os dois.
 *
 * 17/10/2026 (AC-21): também os leads liberados fora do expediente (o "Liberar" da trava de
 * horário). Eram três estados de tela (a Próxima venda, a Triagem e a Ficha, só em memória): liberar
 * num lugar não valia no outro, e recarregar a página travava de novo o que já se tinha decidido.
 * Vale até a meia-noite de SP, como o resto: liberar é uma decisão do dia, não do lead. O vendedor
 * do Telegram não lê daqui: fora do expediente ele não avisa nada, liberado ou não.
 *
 * Não é estado do funil (RULES 11: a planilha é a verdade): é só quem está trabalhando a fila hoje.
 * Vira o dia (São Paulo), zera. Arquivo 600 no diretório de dados do operations.
 */

export type ComoResolveu = "enviada" | "pulada" | "recusa";
export type Superficie = "central" | "telegram";
/** "expirou": o aviso do Telegram ficou 30 min sem toque e vale como pular. */
export type PorOnde = Superficie | "expirou";

export interface Resolvida {
  em: number;
  /** Mantido para quem lê o formato de 16/10 (as telas e o filtro da fila): pulada = true. */
  pulou: boolean;
  como: ComoResolveu;
  /** Ausente no que foi gravado antes de 17/10/2026 (o formato antigo não dizia). */
  por?: PorOnde;
}

/** Uma anotação na aba CRM feita por uma ação do dia (o tipo do registro: segunda_enviada, proposta...). */
export interface Anotada {
  tipo: string;
  em: number;
  por: Superficie;
}

/**
 * De onde veio o primeiro contato: as duas superfícies do Rômulo ou, desde 19/10/2026, o time
 * comercial (deploy/dell/frente-comercial.py), que reserva o dele pela rota /crm/frente/reservar.
 */
export type OrigemDoPrimeiro = Superficie | "time";

export interface PrimeiroDoDia {
  em: number;
  por: OrigemDoPrimeiro;
}

export interface VendaDoDia {
  /** AAAA-MM-DD de São Paulo. */
  dia: string;
  resolvidas: Record<string, Resolvida>;
  /** chave da ação -> as anotações que ela já fez hoje (uma por tipo). */
  anotadas: Record<string, Anotada[]>;
  /** leadId -> o primeiro contato de hoje: o primeiro toque vale, repetir não conta de novo. */
  primeiros: Record<string, PrimeiroDoDia>;
  /** leadId -> o instante do "Liberar" fora do expediente; o primeiro toque vale. */
  liberados: Record<string, number>;
}

export const MAX_CHAVE = 300;
export const MAX_RESOLVIDAS = 500;
const COMOS: readonly ComoResolveu[] = ["enviada", "pulada", "recusa"];
const PORES: readonly PorOnde[] = ["central", "telegram", "expirou"];
const SUPERFICIES: readonly Superficie[] = ["central", "telegram"];
const ORIGENS: readonly OrigemDoPrimeiro[] = [...SUPERFICIES, "time"];

export const diaSP = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);

const chaveBoa = (c: unknown): c is string => typeof c === "string" && c.length > 0 && c.length <= MAX_CHAVE;
const objeto = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x);

/**
 * PURO: o lido, se é de hoje e legível; senão um dia novo e vazio. Tolerante ao formato de 16/10
 * (`{ dia, resolvidas: { k: { em, pulou } } }`, que pode estar na Mel hoje): sem `como`, sai do
 * `pulou`; sem `anotadas`/`primeiros`/`liberados` (o de antes de 17/10), vazios. Item ilegível sai
 * sozinho, sem derrubar o resto.
 */
export function vendaDoDia(lido: unknown, agora: number): VendaDoDia {
  const hoje = diaSP(agora);
  const vazio: VendaDoDia = { dia: hoje, resolvidas: {}, anotadas: {}, primeiros: {}, liberados: {} };
  if (!objeto(lido) || lido.dia !== hoje || !objeto(lido.resolvidas)) return vazio;
  for (const [chave, r] of Object.entries(lido.resolvidas)) {
    if (!chaveBoa(chave) || !objeto(r) || !Number.isFinite(r.em)) continue;
    const como: ComoResolveu | null = COMOS.includes(r.como as ComoResolveu) ? (r.como as ComoResolveu)
      : typeof r.pulou === "boolean" ? (r.pulou ? "pulada" : "enviada") : null;
    if (!como) continue;
    vazio.resolvidas[chave] = { em: Number(r.em), pulou: como === "pulada", como, ...(PORES.includes(r.por as PorOnde) ? { por: r.por as PorOnde } : {}) };
  }
  if (objeto(lido.anotadas)) {
    for (const [chave, lista] of Object.entries(lido.anotadas)) {
      if (!chaveBoa(chave) || !Array.isArray(lista)) continue;
      const boas = lista.filter((a): a is Anotada => objeto(a) && typeof a.tipo === "string" && a.tipo.length > 0 && a.tipo.length <= 40
        && Number.isFinite(a.em) && SUPERFICIES.includes(a.por as Superficie)).map((a) => ({ tipo: a.tipo, em: a.em, por: a.por }));
      if (boas.length) vazio.anotadas[chave] = boas;
    }
  }
  if (objeto(lido.primeiros)) {
    for (const [leadId, p] of Object.entries(lido.primeiros)) {
      if (chaveBoa(leadId) && objeto(p) && Number.isFinite(p.em) && ORIGENS.includes(p.por as OrigemDoPrimeiro)) {
        vazio.primeiros[leadId] = { em: Number(p.em), por: p.por as OrigemDoPrimeiro };
      }
    }
  }
  if (objeto(lido.liberados)) {
    for (const [leadId, em] of Object.entries(lido.liberados)) {
      if (chaveBoa(leadId) && typeof em === "number" && Number.isFinite(em)) vazio.liberados[leadId] = em;
    }
  }
  return vazio;
}

/** Teto para um registro que só cresce no dia: os mais antigos saem primeiro. */
function podar<T>(registro: Record<string, T>, instante: (v: T) => number): Record<string, T> {
  const entradas = Object.entries(registro);
  if (entradas.length <= MAX_RESOLVIDAS) return registro;
  return Object.fromEntries(entradas.sort((a, b) => instante(b[1]) - instante(a[1])).slice(0, MAX_RESOLVIDAS));
}

/** PURO: marca uma chave; a última decisão vale (pular e depois enviar = enviada). */
export function resolver(v: VendaDoDia, chave: string, como: ComoResolveu, por: PorOnde, agora: number): VendaDoDia {
  if (!chaveBoa(chave)) throw new Error("chave inválida");
  const resolvidas = podar({ ...v.resolvidas, [chave]: { em: agora, pulou: como === "pulada", como, por } }, (r) => r.em);
  return { ...v, resolvidas };
}

/** PURO: esta ação já anotou este tipo hoje? (por qualquer superfície) */
export function jaAnotada(v: VendaDoDia, chave: string, tipo: string): boolean {
  return (v.anotadas[chave] ?? []).some((a) => a.tipo === tipo);
}

/** PURO: idempotente por chave + tipo. A segunda vez devolve o mesmo dia, sem mudar nada. */
export function anotar(v: VendaDoDia, chave: string, tipo: string, por: Superficie, agora: number): VendaDoDia {
  if (!chaveBoa(chave) || !tipo) throw new Error("chave inválida");
  if (jaAnotada(v, chave, tipo)) return v;
  const anotadas = podar({ ...v.anotadas, [chave]: [...(v.anotadas[chave] ?? []), { tipo, em: agora, por }] },
    (l) => Math.max(...l.map((a) => a.em)));
  return { ...v, anotadas };
}

/** PURO: o primeiro toque num link de primeiro contato do lead hoje; repetir não conta de novo. */
export function marcarPrimeiroDoDia(v: VendaDoDia, leadId: string, por: OrigemDoPrimeiro, agora: number): VendaDoDia {
  if (!chaveBoa(leadId)) throw new Error("lead inválido");
  if (v.primeiros[leadId]) return v;
  return { ...v, primeiros: podar({ ...v.primeiros, [leadId]: { em: agora, por } }, (p) => p.em) };
}

/**
 * PURO: o "Liberar" fora do expediente de um lead, hoje. Idempotente: liberar de novo (outra aba,
 * a Ficha depois da Próxima venda) devolve o mesmo dia, com o instante do primeiro toque.
 */
export function liberar(v: VendaDoDia, leadId: string, agora: number): VendaDoDia {
  if (!chaveBoa(leadId)) throw new Error("lead inválido");
  if (v.liberados[leadId] !== undefined) return v;
  return { ...v, liberados: podar({ ...v.liberados, [leadId]: agora }, (em) => em) };
}

export type ResultadoDaAnotacao = { anotou: true; dia: VendaDoDia } | { anotou: false; jaEstava: true; dia: VendaDoDia };

export interface MemoriaDaVenda {
  ler(): Promise<VendaDoDia>;
  resolver(chave: string, como: ComoResolveu, por: PorOnde): Promise<VendaDoDia>;
  primeiroContato(leadId: string, por: Superficie): Promise<VendaDoDia>;
  /**
   * O primeiro contato do time comercial (19/10/2026): `decidir` lê o dia (os primeiros de todas as
   * superfícies) e diz se pode; podendo, a marca `por: "time"` grava no mesmo passo da fila. Fora
   * dela, o toque da Central e o pedido do time juntos passariam os dois pelo ritmo.
   */
  reservarPrimeiro<R extends { ok: boolean }>(leadId: string, decidir: (dia: VendaDoDia) => R): Promise<R>;
  /** O "Liberar" fora do expediente (só a Central: o Telegram não avisa fora dele). */
  liberar(leadId: string): Promise<VendaDoDia>;
  /**
   * A anotação no CRM de uma ação, uma vez por chave + tipo no dia. `registrar` (o POST à aba CRM)
   * só roda se ainda não saiu; falhou, nada é marcado e o erro sobe para quem tocou.
   */
  anotarUmaVez(chave: string, tipo: string, por: Superficie, registrar: () => Promise<unknown>): Promise<ResultadoDaAnotacao>;
}

/** O arquivo, com uma escrita por vez (a tela e o Telegram podem tocar juntos). */
export function criarMemoriaDaVenda(arquivo: string, agora: () => number = Date.now): MemoriaDaVenda {
  const emSerie = criarEmSerie();
  async function ler(): Promise<VendaDoDia> {
    let bruto: string;
    try {
      bruto = await fs.readFile(arquivo, "utf8");
    } catch (erro: any) {
      // Só o arquivo que ainda não existe é "dia vazio". Qualquer outro erro (permissão, disco, JSON
      // cortado) sobe: engolido, a próxima gravação sobrescrevia o dia com um vazio, zerava os
      // primeiros contatos (a trava de ritmo) e fazia o vendedor reavisar a fila inteira.
      if (erro?.code === "ENOENT") return vendaDoDia(null, agora());
      throw erro;
    }
    // A virada de dia não precisa de tratamento: `vendaDoDia` devolve o dia novo e vazio.
    return vendaDoDia(JSON.parse(bruto), agora());
  }
  async function gravar(v: VendaDoDia): Promise<VendaDoDia> {
    await fs.mkdir(path.dirname(arquivo), { recursive: true });
    const tmp = `${arquivo}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(v), { mode: 0o600 });
    await fs.rename(tmp, arquivo);
    return v;
  }
  return {
    ler,
    resolver: (chave, como, por) => emSerie(async () => gravar(resolver(await ler(), chave, como, por, agora()))),
    primeiroContato: (leadId, por) => emSerie(async () => {
      const antes = await ler();
      const depois = marcarPrimeiroDoDia(antes, leadId, por, agora());
      return depois === antes ? antes : gravar(depois);
    }),
    reservarPrimeiro: (leadId, decidir) => emSerie(async () => {
      const antes = await ler();
      const r = decidir(antes);
      if (r.ok) await gravar(marcarPrimeiroDoDia(antes, leadId, "time", agora()));
      return r;
    }),
    liberar: (leadId) => emSerie(async () => {
      const antes = await ler();
      const depois = liberar(antes, leadId, agora());
      return depois === antes ? antes : gravar(depois);
    }),
    // Dentro da fila: o "ainda não saiu?", o POST e a marca são um passo só. Fora dela, a Central e o
    // Telegram tocando juntos leriam os dois "não saiu" e anotariam duas vezes.
    anotarUmaVez: (chave, tipo, por, registrar) => emSerie(async (): Promise<ResultadoDaAnotacao> => {
      const antes = await ler();
      if (jaAnotada(antes, chave, tipo)) return { anotou: false, jaEstava: true, dia: antes };
      await registrar();
      return { anotou: true, dia: await gravar(anotar(await ler(), chave, tipo, por, agora())) };
    }),
  };
}
