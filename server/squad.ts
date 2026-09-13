import fs from "node:fs/promises";
import path from "node:path";

/**
 * Roster em ÁRVORE de três níveis (spec Fase 1 §1).
 *
 *   roster (data/squad.json, version 3)
 *     └── squad              ← contexto (Pessoal, Pay4Fun...); um escritório 3x3
 *           └── domínio      ← dono de um tema; ocupa UMA sala
 *                 ├── po     ← dono do domínio; pode propor novos domínios
 *                 └── integrantes ← designer, tech lead, QA... contratados PELO po
 *
 * Uma sala = um domínio inteiro, com várias pessoas dentro. O slot pertence ao
 * domínio, nunca à pessoa: contratar um QA não abre sala nova, criar um domínio
 * abre. Ids de domínio e de pessoa são únicos entre TODAS as squads: vão para o
 * Google Calendar no mesmo calendário principal, e um id repetido em duas
 * squads misturaria os eventos das duas.
 */

/** Qualquer pessoa de uma squad — o PO de um domínio ou um integrante dele. */
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
  /**
   * Arquivado sai do prompt, do mapa e da vista, mas NÃO sai da árvore: o id
   * continua reservado e o registro volta intacto ao reativar. Reativar apaga
   * esta chave e `arquivadoEm`.
   */
  arquivado?: boolean;
  /** ISO do arquivamento; só para ordenar e exibir no Arquivo. */
  arquivadoEm?: string;
}

export interface Dominio {
  /** Único entre todas as squads: é o valor de `squadone_dominio` no Calendar. */
  id: string;
  nome: string;
  escopo: string;
  slot: [number, number];
  room: string;
  criadoEm: string;
  po: Pessoa;
  integrantes: Pessoa[];
  /**
   * Arquivado sai do prompt, do mapa e da vista, mas NÃO sai da árvore: o id
   * continua reservado e o registro volta intacto ao reativar. Reativar apaga
   * esta chave e `arquivadoEm`.
   */
  arquivado?: boolean;
  /** ISO do arquivamento; só para ordenar e exibir no Arquivo. */
  arquivadoEm?: string;
}

export interface Squad {
  /** slug ≤40, único entre squads; valor de `squadone_squad` no Calendar. */
  id: string;
  nome: string;
  /** Vai literal para o prompt: é o que faz o modelo sugerir troca de squad. */
  escopo: string;
  /**
   * Onde os eventos desta squad moram. Hoje sempre "primary"; guardado por
   * squad para um calendário secundário não exigir migração de formato.
   */
  calendarId: string;
  /** Reservado: conta Google dona do calendário. Ausente = a conta conectada. */
  conta?: string;
  unlockOrder: [number, number][];
  /** ≥1. `dominios[0].po` é o PO raiz que circula pelo escritório. */
  dominios: Dominio[];
  /**
   * Arquivado sai do prompt, do mapa e da vista, mas NÃO sai da árvore: o id
   * continua reservado e o registro volta intacto ao reativar. Reativar apaga
   * esta chave e `arquivadoEm`.
   */
  arquivado?: boolean;
  /** ISO do arquivamento; só para ordenar e exibir no Arquivo. */
  arquivadoEm?: string;
}

export interface Roster {
  version: 3;
  /** ≥1. `squads[0]` é a padrão quando o pedido não diz qual. */
  squads: Squad[];
  /**
   * Ids que já existiram e não voltam. GLOBAL porque a unicidade que protege é
   * global; dois namespaces porque pessoa e domínio podem ter o mesmo id legado
   * (produção tem domínio "po" e pessoa "po"). Só acréscimo (aposentarIds).
   */
  idsAposentados: { pessoas: string[]; dominios: string[] };
}

/** Forma do pedido errada: nenhum estado do roster tornaria o pedido válido (400). */
export class PedidoInvalido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PedidoInvalido";
  }
}

/** Pedido bem formado que não cabe no roster ATUAL (409, não 400). */
export class ConflitoDeRoster extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConflitoDeRoster";
  }
}

/**
 * `squadId` que não existe neste volume. É conflito, não pedido malformado: o
 * caso típico é a squad guardada no localStorage de outra instalação. A
 * classificação diz à UI o gesto certo — recarregar o roster e cair na primeira.
 */
export class SquadInexistente extends ConflitoDeRoster {
  readonly squadId: string;
  constructor(squadId: string, existentes: string[]) {
    super(`A squad '${squadId}' não existe. Squads: ${existentes.join(", ")}.`);
    this.name = "SquadInexistente";
    this.squadId = squadId;
  }
}

/**
 * Squad arquivada pedida por id. Herda de SquadInexistente de propósito: para a
 * UI o gesto é o mesmo (recarregar o roster e cair na primeira ativa), e a rota
 * já mapeia a classe mãe para 409 com `squadInexistente: true`.
 */
export class SquadArquivada extends SquadInexistente {
  constructor(squad: Squad, ativas: string[]) {
    super(squad.id, ativas);
    this.message = `A squad '${squad.nome}' está arquivada. Squads ativas: ${ativas.join(", ")}.`;
    this.name = "SquadArquivada";
  }
}

/** squad.json com forma desconhecida ou quebrada. Nunca é sobrescrito. */
export class RosterIlegivel extends Error {
  constructor(mensagem: string) {
    super(`squad.json ilegível: ${mensagem}`);
    this.name = "RosterIlegivel";
  }
}

const DATA_DIR = path.join(process.cwd(), "data");
const SQUAD_PATH = path.join(DATA_DIR, "squad.json");

/**
 * A seed NAO pode morar em `data/`. Em producao `data/` e um volume Docker
 * montado por cima do diretorio da imagem: um volume novo sobe vazio e
 * sombreia tudo que a imagem tinha ali, inclusive a seed. O primeiro boot
 * entao nao acha de onde semear e todo `/api/squad` vira 500.
 *
 * `seed/` fica fora do mount, e por isso sobrevive. O caminho antigo segue na
 * lista para nao quebrar checkout velho nem container que ja subiu com o
 * arquivo no lugar anterior.
 */
const SEED_PATHS = [
  path.join(process.cwd(), "seed", "squad.seed.json"),
  path.join(DATA_DIR, "squad.seed.json"),
];

/** Salas de um escritório: grade 3x3. Passou disso, não há slot para alocar. */
export const MAX_DOMINIOS = 9;

/** Ordem de desbloqueio de salas de uma squad nova — a mesma da seed. */
export const UNLOCK_ORDER_PADRAO: [number, number][] = [
  [0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1], [0, 2], [1, 2], [2, 2],
];

export const ESCOPO_PESSOAL_PADRAO = "vida pessoal e tudo que não pertence a outra squad";

/**
 * Limites de texto do roster (spec Fase 2 §5.4). Um lugar só, espelhado em
 * src/types.ts: o formulário corta antes de enviar e o servidor recusa ou
 * trunca com o mesmo número. Escopo de pessoa é o "treino" do agente, por isso
 * bem maior que os demais, que são linhas de roteamento.
 */
export const LIMITES = {
  squadNome: 40,
  squadEscopo: 200,
  dominioNome: 60,
  dominioEscopo: 200,
  pessoaNome: 40,
  papel: 60,
  escopoPessoa: 1500,
  frase: 300,
} as const;

/** Nome, papel, escopo de domínio/squad: uma linha só, espaços colapsados. */
export function textoDeUmaLinha(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/**
 * Escopo de pessoa: várias linhas (as cinco seções do treino), sem lixo de
 * colagem. Caractere de controle e linha em branco em excesso só gastam prompt.
 */
export function normalizarEscopo(texto: string): string {
  return texto
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .split("\n")
    .map((linha) => linha.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Corta no limite preferindo uma quebra de linha, para não deixar uma seção
 * do treino pela metade. Só para texto que veio do modelo ou de card: texto
 * que o usuário revisou é recusado (400), não cortado.
 */
export function limitar(texto: string, max: number): { texto: string; truncado: boolean } {
  if (texto.length <= max) return { texto, truncado: false };
  const quebra = texto.lastIndexOf("\n", max);
  const corte = quebra > max * 0.6 ? quebra : max;
  return { texto: texto.slice(0, corte).trimEnd(), truncado: true };
}

/**
 * Grava num `.tmp` no mesmo diretório e renomeia por cima. Um crash no meio
 * deixa o `.tmp` pela metade, nunca o destino. O contador entra no nome porque
 * duas escritas concorrentes no mesmo destino (dois requests semeando um volume
 * vazio) dividiriam um `.tmp` só por pid, e o segundo rename falharia.
 */
let seqTmp = 0;
async function gravarAtomico(destino: string, conteudo: string): Promise<void> {
  const dir = path.dirname(destino);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${destino}.${process.pid}.${++seqTmp}.tmp`;
  try {
    // fsync ANTES do rename. Sem ele o rename pode chegar ao disco antes dos
    // dados: queda de energia logo depois deixa `squad.json` apontando para um
    // arquivo vazio. O caso que importa é a primeira migração em produção, que
    // grava o backup do v2 e em seguida troca o squad.json por v3 — perder
    // os dois ao mesmo tempo seria perder o roster inteiro.
    const arquivo = await fs.open(tmp, "w");
    try {
      await arquivo.writeFile(conteudo, "utf8");
      await arquivo.sync();
    } finally {
      await arquivo.close();
    }
    await fs.rename(tmp, destino);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  await sincronizarDiretorio(dir);
}

/**
 * fsync do diretório torna o próprio rename durável (a entrada nova do
 * diretório). Linux deixa; Windows recusa abrir diretório (EISDIR) ou dar
 * sync nele (EPERM), e lá o rename já é gravado pelo NTFS — ignorar é seguro.
 */
async function sincronizarDiretorio(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch (err: any) {
    if (!["EPERM", "EISDIR", "EINVAL", "EBADF"].includes(err?.code)) throw err;
  } finally {
    await handle?.close();
  }
}

export async function writeRoster(roster: Roster): Promise<void> {
  await gravarAtomico(SQUAD_PATH, JSON.stringify(roster, null, 2) + "\n");
}

/**
 * Fila de escrita: toda mutação do roster passa por aqui. Um arquivo só para
 * todas as squads, então uma fila só — duas aprovações quase simultâneas, mesmo
 * em squads diferentes, leriam o mesmo squad.json e a segunda apagaria a
 * primeira. Read-modify-write serializado elimina a corrida sem lock em disco,
 * porque o processo do servidor é o único escritor.
 */
let fila: Promise<unknown> = Promise.resolve();

export function atualizarRoster<T>(mutador: (roster: Roster) => T): Promise<T> {
  const proximo = fila.then(async () => {
    const roster = await readRoster();
    // Se o mutador lançar, nada é gravado: o roster em disco fica intacto.
    const saida = mutador(roster);
    await writeRoster(roster);
    return saida;
  });
  // A fila não pode morrer num erro: o próximo escritor ainda precisa rodar.
  fila = proximo.catch(() => undefined);
  return proximo;
}

/**
 * Template da sala em função de quantas pessoas o domínio tem. Só PROMOVE:
 * um domínio que já escolheu ROOM_STUDIO não volta para ROOM_SOLO ao crescer.
 * Acima de 2 pessoas não há template maior — o excedente cai em
 * EXTRA_STATIONS, no miolo da sala (src/office/rooms.ts).
 */
export function salaPara(qtdPessoas: number, atual?: string): string {
  if (qtdPessoas >= 2 && (!atual || atual === "ROOM_SOLO")) return "ROOM_DEV";
  return atual ?? "ROOM_SOLO";
}

/**
 * Texto cru da seed do primeiro caminho que existir. Sem nenhum deles nao ha
 * como semear: falhar com a lista tentada e mais util que um ENOENT solto,
 * porque o motivo provavel e um volume montado sobre o diretorio errado.
 */
async function lerSeed(): Promise<string> {
  for (const caminho of SEED_PATHS) {
    try {
      return await fs.readFile(caminho, "utf8");
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
  }
  throw new Error(
    `Seed do roster nao encontrada. Procurei em: ${SEED_PATHS.join(", ")}.`,
  );
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
 * Uma semeadura por vez. Volume novo + boot com /api/squad e /api/mochila
 * juntos = dois renames concorrentes sobre o mesmo squad.json; no Windows o
 * segundo falha com EPERM mesmo com `.tmp` distintos. A promessa de migração
 * não cobre este caso porque roda depois dele.
 */
let semeadura: Promise<void> | null = null;

/**
 * Copia a seed se `data/squad.json` ainda não existir. Grava o texto como veio:
 * uma seed antiga v2 (caminho legado) é migrada pela leitura seguinte, com backup.
 */
async function ensureRoster(): Promise<void> {
  if (await existe(SQUAD_PATH)) return;
  if (!semeadura) {
    semeadura = (async () => {
      // Relê: outra semeadura pode ter terminado entre o `existe` de fora e aqui.
      if (await existe(SQUAD_PATH)) return;
      await gravarAtomico(SQUAD_PATH, await lerSeed());
    })().finally(() => {
      semeadura = null;
    });
  }
  await semeadura;
}

/** Roster v2: uma squad implícita, domínios na raiz. */
interface RosterV2 {
  version: number;
  unlockOrder: [number, number][];
  dominios: Dominio[];
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
function migrarV1(antigo: { version: number; unlockOrder: [number, number][]; members: MembroV1[] }): RosterV2 {
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

/**
 * Versão pela FORMA, nunca pelo campo `version`: arquivos antigos foram
 * escritos à mão e o campo não é confiável. A ordem dos testes importa.
 */
export function detectarVersao(bruto: unknown): 1 | 2 | 3 {
  const b = bruto as any;
  if (Array.isArray(b?.squads)) return 3;
  if (Array.isArray(b?.dominios)) return 2;
  if (Array.isArray(b?.members)) return 1;
  throw new RosterIlegivel("forma desconhecida (sem 'squads', 'dominios' nem 'members').");
}

/**
 * v2 → v3. O roster inteiro vira a squad "pessoal" e os domínios passam
 * INTACTOS: `squadone_dominio` dos eventos já gravados no Google continua
 * batendo com os ids, sem backfill. Pura e determinística — nada de relógio
 * ou id aleatório — para que refazer a migração dê o mesmo arquivo.
 */
export function migrarV2(v2: RosterV2): Roster {
  return {
    version: 3,
    squads: [
      {
        id: "pessoal",
        nome: "Pessoal",
        escopo: ESCOPO_PESSOAL_PADRAO,
        calendarId: "primary",
        unlockOrder: v2.unlockOrder,
        dominios: v2.dominios,
      },
    ],
    idsAposentados: { pessoas: [], dominios: [] },
  };
}

/** Forma mínima que o resto do código assume. Não checa unicidade: isso é da escrita. */
function validarV3(bruto: any): Roster {
  const falha = (mensagem: string): never => {
    throw new RosterIlegivel(mensagem);
  };
  if (!Array.isArray(bruto?.squads) || bruto.squads.length === 0) falha("'squads' vazio.");
  for (const s of bruto.squads) {
    if (typeof s?.id !== "string" || !s.id) falha("squad sem 'id'.");
    if (!Array.isArray(s.unlockOrder)) falha(`squad '${s.id}' sem 'unlockOrder'.`);
    if (!Array.isArray(s.dominios) || s.dominios.length === 0) falha(`squad '${s.id}' sem domínios.`);
    for (const d of s.dominios) {
      if (typeof d?.id !== "string") falha(`domínio sem 'id' na squad '${s.id}'.`);
      const slotOk =
        Array.isArray(d.slot) && d.slot.length === 2 && d.slot.every((n: unknown) => typeof n === "number");
      if (!slotOk) falha(`domínio '${d.id}' com 'slot' inválido.`);
      if (typeof d.po?.id !== "string") falha(`domínio '${d.id}' sem PO.`);
      if (!Array.isArray(d.integrantes)) falha(`domínio '${d.id}' sem 'integrantes'.`);
    }
  }
  // Tolerado na leitura e normalizado só em memória: não força escrita.
  const ap = bruto.idsAposentados;
  bruto.idsAposentados = {
    pessoas: Array.isArray(ap?.pessoas) ? ap.pessoas : [],
    dominios: Array.isArray(ap?.dominios) ? ap.dominios : [],
  };
  bruto.version = 3;
  return bruto as Roster;
}

function interpretar(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch (err: any) {
    throw new RosterIlegivel(`JSON inválido (${err?.message ?? err}).`);
  }
}

/**
 * Uma migração por processo por vez. No boot, /api/squad e /api/mochila chegam
 * juntos; sem isto cada um faria backup, conversão e escrita por conta própria,
 * e os chamadores receberiam objetos de migrações diferentes.
 */
let migracao: Promise<Roster> | null = null;

async function migrarNoDisco(): Promise<Roster> {
  // Relê aqui dentro: quem disparou pode ter lido v2 logo antes de outra
  // migração terminar. Nesse caso o arquivo já é v3 e não há o que fazer.
  const texto = await fs.readFile(SQUAD_PATH, "utf8");
  const bruto = interpretar(texto);
  const versao = detectarVersao(bruto);
  if (versao === 3) return validarV3(bruto);

  // Backup do texto CRU antes de qualquer escrita, e nunca por cima de um
  // backup existente: o primeiro é o único que garantidamente é o original.
  const backup = path.join(DATA_DIR, `squad.v${versao}.bak.json`);
  if (!(await existe(backup))) await gravarAtomico(backup, texto);

  const v2 = versao === 1 ? migrarV1(bruto as any) : (bruto as RosterV2);
  // Valida ANTES de gravar: um v2 torto lança aqui e squad.json fica como estava.
  const v3 = validarV3(migrarV2(v2));
  await writeRoster(v3);
  return v3;
}

export async function readRoster(): Promise<Roster> {
  await ensureRoster();
  const bruto = interpretar(await fs.readFile(SQUAD_PATH, "utf8"));
  if (detectarVersao(bruto) === 3) return validarV3(bruto);

  if (!migracao) {
    migracao = migrarNoDisco().finally(() => {
      migracao = null;
    });
  }
  // Clone por chamador: um mutador de atualizarRoster não pode alterar o objeto
  // que outra leitura concorrente recebeu.
  return structuredClone(await migracao);
}

/**
 * Ativo = não arquivado NESTE nível. Quem precisa da regra completa (pessoa
 * ativa exige domínio e squad ativos) compõe pelos helpers abaixo, que sempre
 * descem a partir de uma squad já resolvida como ativa.
 */
export function ativo(x: { arquivado?: boolean }): boolean {
  return x.arquivado !== true;
}

export function squadsAtivas(roster: Roster): Squad[] {
  return roster.squads.filter(ativo);
}

export function dominiosAtivos(squad: Squad): Dominio[] {
  return squad.dominios.filter(ativo);
}

export function integrantesAtivos(dominio: Dominio): Pessoa[] {
  return dominio.integrantes.filter(ativo);
}

/** Pessoas que podem receber compromisso: de domínios ativos, PO primeiro. */
export function pessoasAtivas(squad: Squad): { pessoa: Pessoa; dominio: Dominio }[] {
  return dominiosAtivos(squad).flatMap((d) =>
    [d.po, ...integrantesAtivos(d)].map((pessoa) => ({ pessoa, dominio: d })),
  );
}

/**
 * Slots OCUPADOS, só por domínios ativos. Derivar de `dominios.length`
 * quebrava quando um domínio sai do meio da ordem: o próximo slot já estaria
 * em uso. Guardar "salas desbloqueadas" à parte seria estado duplicado.
 */
export function unlockedSlots(squad: Squad): [number, number][] {
  return dominiosAtivos(squad).map((d) => d.slot);
}

/** Primeiro slot da ordem de desbloqueio que ninguém ocupa; null com as 9 cheias. */
export function proximoSlot(squad: Squad): [number, number] | null {
  // Domínio arquivado libera o slot: quem ocupa é só quem aparece no mapa.
  const ocupados = new Set(dominiosAtivos(squad).map((d) => d.slot.join(",")));
  return squad.unlockOrder.find((s) => !ocupados.has(s.join(","))) ?? null;
}

export interface IntegranteArquivadoView {
  pessoa: Pessoa;
  dominioId: string;
  dominioNome: string;
}

/**
 * O que sai pela API. `dominios` e `integrantes` só com ativos: GameMap,
 * seletor e Mochila leem estes campos sem saber que arquivamento existe. O que
 * foi arquivado vai à parte, em `arquivo`, para a tela de reativar.
 */
export type SquadView = Omit<Squad, "dominios"> & {
  dominios: Dominio[];
  unlockedSlots: [number, number][];
  proximoSlot: [number, number] | null;
  arquivo: { dominios: Dominio[]; integrantes: IntegranteArquivadoView[] };
};

export type RosterView = Omit<Roster, "squads"> & {
  squads: SquadView[];
  squadsArquivadas: SquadView[];
};

function vistaDaSquad(squad: Squad): SquadView {
  const ativos = dominiosAtivos(squad);
  return {
    ...squad,
    dominios: ativos.map((d) => ({ ...d, integrantes: integrantesAtivos(d) })),
    unlockedSlots: unlockedSlots(squad),
    proximoSlot: proximoSlot(squad),
    arquivo: {
      dominios: squad.dominios.filter((d) => !ativo(d)),
      // Integrante de domínio arquivado aparece junto do domínio, não aqui:
      // reativá-lo sozinho seria recusado (pai arquivado).
      integrantes: ativos.flatMap((d) =>
        d.integrantes
          .filter((i) => !ativo(i))
          .map((pessoa) => ({ pessoa, dominioId: d.id, dominioNome: d.nome })),
      ),
    },
  };
}

/** O que sai pela API: squads ativas com os slots calculados; arquivadas à parte. */
export function paraVista(roster: Roster): RosterView {
  return {
    ...roster,
    squads: squadsAtivas(roster).map(vistaDaSquad),
    squadsArquivadas: roster.squads.filter((s) => !ativo(s)).map(vistaDaSquad),
  };
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

/**
 * Todas as pessoas da squad, cada uma com o domínio a que pertence. TODAS,
 * arquivadas inclusive: é a base da unicidade de id (idsEmUso). Para turno,
 * prompt e Mochila use pessoasAtivas.
 */
export function pessoas(squad: Squad): { pessoa: Pessoa; dominio: Dominio }[] {
  return squad.dominios.flatMap((d) =>
    [d.po, ...d.integrantes].map((pessoa) => ({ pessoa, dominio: d })),
  );
}

export function acharDominio(squad: Squad, id: unknown): Dominio | null {
  // Só ativos: domínio arquivado não recebe integrante nem compromisso.
  return dominiosAtivos(squad).find((d) => d.id === id) ?? null;
}

/**
 * Pessoa ATIVA + o domínio dela. O domínio nunca é passado pelo modelo: é
 * derivado. Arquivada não recebe compromisso, então não é achada.
 */
export function acharPessoa(
  squad: Squad,
  id: unknown,
): { pessoa: Pessoa; dominio: Dominio } | null {
  return pessoasAtivas(squad).find((p) => p.pessoa.id === id) ?? null;
}

/** Ids válidos para `responsavel_id` (só ativos), na ordem em que aparecem na árvore. */
export function idsDePessoas(squad: Squad): string[] {
  return pessoasAtivas(squad).map((p) => p.pessoa.id);
}

/**
 * Domínios que a Mochila lê, um `events.list` por domínio: só ativos. Domínio
 * arquivado sai da Mochila (spec Fase 2 §7.11); os eventos ficam no Google e
 * voltam ao reativar.
 */
export function dominiosDoSquad(squad: Squad): string[] {
  return dominiosAtivos(squad).map((d) => d.id);
}

/** Recuo de bloco: escopo de pessoa tem várias linhas e não cabe entre parênteses. */
function emBloco(texto: string, recuo: string): string {
  return texto.split("\n").map((linha) => recuo + linha).join("\n");
}

/**
 * A ÁRVORE da squad injetada no systemInstruction (§6), só com o que está
 * ATIVO. Uma lista plana de pessoas esconde a hierarquia: o modelo precisa ver
 * a qual domínio cada pessoa pertence para escolher o responsável certo e para
 * saber se falta um domínio inteiro (criar_po_dominio) ou só um papel dentro
 * de um existente (contratar_integrante). O escopo de pessoa (até 1500
 * caracteres, cinco seções) vai como bloco recuado abaixo dela; o de domínio é
 * uma linha e segue inline.
 */
export function rosterTree(squad: Squad): string {
  return dominiosAtivos(squad)
    .map((d) => {
      const linhas = [
        `- domínio '${d.id}' — ${d.nome} (escopo: ${d.escopo})`,
        `    PO: '${d.po.id}' ${d.po.nome} (${d.po.papel})`,
        emBloco(d.po.escopo, "      "),
      ];
      for (const i of integrantesAtivos(d)) {
        linhas.push(`    integrante: '${i.id}' ${i.nome} (${i.papel})`, emBloco(i.escopo, "      "));
      }
      return linhas.join("\n");
    })
    .join("\n");
}

/**
 * Squad do pedido. Ausente = a primeira ATIVA: cliente antigo e chamada sem
 * seletor continuam funcionando. Validação garante ≥1 squad e o ciclo de vida
 * garante ≥1 ativa (não se arquiva a última).
 */
export function resolverSquad(roster: Roster, squadId: unknown): Squad {
  const ativas = squadsAtivas(roster);
  if (squadId === undefined || squadId === null || squadId === "") return ativas[0];
  if (typeof squadId !== "string") throw new PedidoInvalido("Campo 'squadId' deve ser texto.");
  const achada = roster.squads.find((s) => s.id === squadId);
  if (!achada) throw new SquadInexistente(squadId, ativas.map((s) => s.id));
  if (!ativo(achada)) throw new SquadArquivada(achada, ativas.map((s) => s.id));
  return achada;
}

export function todasAsPessoas(roster: Roster): Pessoa[] {
  return roster.squads.flatMap((s) => pessoas(s).map((p) => p.pessoa));
}

/** Tudo que não pode ser reusado: ids vivos de todas as squads + aposentados. */
export function idsEmUso(roster: Roster): {
  pessoas: Set<string>;
  dominios: Set<string>;
  squads: Set<string>;
} {
  const idsPessoas = new Set(roster.idsAposentados.pessoas);
  const idsDominios = new Set(roster.idsAposentados.dominios);
  for (const s of roster.squads) {
    for (const d of s.dominios) idsDominios.add(d.id);
  }
  for (const p of todasAsPessoas(roster)) idsPessoas.add(p.id);
  return { pessoas: idsPessoas, dominios: idsDominios, squads: new Set(roster.squads.map((s) => s.id)) };
}

function slugCurto(texto: string, max: number): string {
  return slug(texto).slice(0, max).replace(/-+$/g, "") || "geral";
}

/**
 * id de pessoa: é o `responsavel_id` do modelo e o `squadone_membro` do
 * Calendar. Único entre TODAS as squads e aposentados; colisão ganha sufixo
 * numérico em vez de sobrescrever alguém.
 */
export function novoIdDePessoa(roster: Roster, nome: string): string {
  const usados = idsEmUso(roster).pessoas;
  const base = slug(nome);
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) {
    const tentativa = `${base}-${i}`;
    if (!usados.has(tentativa)) return tentativa;
  }
}

/**
 * id de domínio criado a partir da Fase 1: `<squad>--<slug>`. `slug()` colapsa
 * separadores num único `-`, então nenhum id legado contém `--` e o prefixo não
 * colide com eles. Duplicata é conflito, não sufixo: dois domínios com o mesmo
 * nome na mesma squad são engano, não dois temas.
 */
export function novoIdDeDominio(roster: Roster, squad: Squad, nome: string): string {
  const id = `${squad.id}--${slugCurto(nome, 60)}`;
  // Pelo nome também: o legado 'financeiro' e um novo 'pessoal--financeiro'
  // teriam ids diferentes e seriam o mesmo tema duas vezes na mesma squad.
  const mesmoNome = squad.dominios.find((d) => slug(d.nome) === slug(nome));
  if (mesmoNome) {
    throw new ConflitoDeRoster(
      ativo(mesmoNome)
        ? `O domínio '${mesmoNome.nome}' (id '${mesmoNome.id}') já existe na squad '${squad.nome}'.`
        : `O domínio '${mesmoNome.nome}' existe arquivado na squad '${squad.nome}': reative-o no Arquivo.`,
    );
  }
  if (idsEmUso(roster).dominios.has(id)) {
    throw new ConflitoDeRoster(`O id de domínio '${id}' já existe ou já existiu.`);
  }
  return id;
}

export function novoIdDeSquad(roster: Roster, nome: string): string {
  const id = slugCurto(nome, 40);
  const existente = roster.squads.find((s) => s.id === id);
  if (existente) {
    throw new ConflitoDeRoster(
      ativo(existente)
        ? `A squad '${existente.nome}' (id '${id}') já existe.`
        : `A squad '${existente.nome}' existe arquivada: reative-a.`,
    );
  }
  return id;
}

/**
 * As OUTRAS squads ATIVAS para o prompt: só id, nome e escopo. O modelo precisa
 * saber que existem para sugerir troca, e não pode ver domínios nem pessoas
 * delas para não agendar fora da squad ativa. Arquivada não é destino.
 */
export function outrasSquads(roster: Roster, ativaId: string): string {
  const linhas = squadsAtivas(roster)
    .filter((s) => s.id !== ativaId)
    .map((s) => `- squad '${s.id}' — ${s.nome} (escopo: ${s.escopo})`);
  return linhas.length ? linhas.join("\n") : "(nenhuma)";
}

export interface PessoaLocalizada {
  squad: Squad;
  dominio: Dominio;
  pessoa: Pessoa;
  posicao: "po" | "integrante";
}

/**
 * Busca por id GLOBAL, arquivados inclusive. Ids de pessoa e domínio são únicos
 * entre todas as squads, então as rotas de ciclo de vida não precisam de squadId.
 */
export function localizarPessoa(roster: Roster, id: unknown): PessoaLocalizada | null {
  for (const squad of roster.squads) {
    for (const dominio of squad.dominios) {
      if (dominio.po.id === id) return { squad, dominio, pessoa: dominio.po, posicao: "po" };
      const pessoa = dominio.integrantes.find((p) => p.id === id);
      if (pessoa) return { squad, dominio, pessoa, posicao: "integrante" };
    }
  }
  return null;
}

export function localizarDominio(roster: Roster, id: unknown): { squad: Squad; dominio: Dominio } | null {
  for (const squad of roster.squads) {
    const dominio = squad.dominios.find((d) => d.id === id);
    if (dominio) return { squad, dominio };
  }
  return null;
}

export function localizarSquad(roster: Roster, id: unknown): Squad | null {
  return roster.squads.find((s) => s.id === id) ?? null;
}

/**
 * Só acréscimo, sem duplicata. Reativar NÃO remove: o id volta para o próprio
 * dono e segue proibido para ids novos. Hoje o arquivado nunca sai da árvore;
 * a lista mantém a garantia se um dia uma poda remover subárvores arquivadas.
 */
export function aposentarIds(roster: Roster, ids: { pessoas?: string[]; dominios?: string[] }): void {
  for (const id of ids.pessoas ?? []) {
    if (!roster.idsAposentados.pessoas.includes(id)) roster.idsAposentados.pessoas.push(id);
  }
  for (const id of ids.dominios ?? []) {
    if (!roster.idsAposentados.dominios.includes(id)) roster.idsAposentados.dominios.push(id);
  }
}
