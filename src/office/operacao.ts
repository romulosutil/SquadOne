/**
 * O Escritório como mapa da operação (15/10/2026). PURO: sem Vue, sem fetch,
 * sem relógio (o `agora` vem de fora). O Rômulo achou Entrada, Escritório e
 * Finanças distantes, e o Escritório só editava o roster: cada sala da squad
 * PRUMO passa a mostrar quantos leads dela há em cada passo da jornada
 * (`painelDaJornada`, com o filtro do produto do CRM), quantos estão parados com
 * ele e o estado de cada robô pelo status.json do Dell.
 *
 * Só a contagem (OT-07, 16/10/2026): a sala também listava os parados, nome a
 * nome, o mesmo `painelDaJornada` da vista "por passo da jornada" do Funil. Duas
 * listas dos mesmos leads em duas telas; ficou a do Funil, e "Ver no Funil" leva a ela.
 *
 * Estado só com fonte (RULES 2, 19 e 26): sem retrato do CRM a sala diz que não
 * leu, nunca "0 leads"; sem retrato recente do Dell, ou sem verificação do robô
 * nele, o robô diz "Sem sinal". Nada daqui grava, e nada daqui entra no prompt:
 * o servidor não importa este arquivo (o teste de trabalhadores confere).
 */
import { PASSOS, painelDaJornada, type IdDoPasso, type QuemFaz } from "../operations/jornada";
import { PRODUTOS, ROTULO_DO_PRODUTO } from "../operations/crm-formato";
import type { CrmLead, CrmProduto, CrmVisao, DellCheck, DellStatus } from "../operations/types";
import { linkDoComoFunciona, trabalhadoresDaSala, type TrabalhadorAutomatico } from "./trabalhadores";

// ------------------------------------------------------------------ que pedaço da jornada cada sala mostra

/** Um pedaço da jornada: uma oferta do CRM (ou todas) e, se for o caso, só alguns passos. */
export interface RecorteDaSala {
  /** O filtro de produto do CRM; null = todas as ofertas. */
  produto: CrmProduto | null;
  /** Só estes passos. Ausente = todos os abertos, e Fechou/Perdido numa linha. */
  passos?: IdDoPasso[];
}

export interface JornadaDaSala {
  titulo: string;
  recortes: RecorteDaSala[];
}

/** O estoque antes do primeiro contato (o mesmo NA_FILA de jornada.ts). */
const ESTOQUE: IdDoPasso[] = ["achado", "raio-x"];
/** Da primeira mensagem à proposta: as conversas em andamento. */
const EM_ANDAMENTO: IdDoPasso[] = PASSOS.map((p) => p.id).filter((id) => !ESTOQUE.includes(id) && id !== "ganho" && id !== "perdido");

/**
 * As salas são quem trabalha (RULES 26), e a jornada de cada uma é a do trabalho
 * dela: a Prospecção enche o estoque de todas as ofertas (o Plus entra aqui, que é
 * de onde ele vem); o Atendimento conduz as conversas de todas; as salas de
 * oferta mostram a jornada inteira do produto delas. Ids da squad `prumo` de
 * produção; sala que não está aqui não mostra jornada.
 */
export const JORNADA_DAS_SALAS: Readonly<Record<string, JornadaDaSala>> = {
  "prumo--prospeccao": { titulo: "Na fila do primeiro contato", recortes: PRODUTOS.map((produto) => ({ produto, passos: ESTOQUE })) },
  "prumo--geral": { titulo: "Conversas em andamento, todas as ofertas", recortes: [{ produto: null, passos: EM_ANDAMENTO }] },
  "prumo--site-antes-da-venda": { titulo: "Leads desta oferta", recortes: [{ produto: "site" }] },
  "prumo--organizar": { titulo: "Leads desta oferta", recortes: [{ produto: "prumo" }] },
  "prumo--iris": { titulo: "Leads desta oferta", recortes: [{ produto: "iris" }] },
  "prumo--estamparias": { titulo: "Leads desta oferta", recortes: [{ produto: "estampa" }] },
};

// ------------------------------------------------------------------ as fontes

/** Cinco minutos sem retrato novo é o próprio monitor parado (RETRATO_VENCIDO_MS em server/dell-status.ts). */
export const RETRATO_DO_DELL_VENCE_EM_MS = 5 * 60_000;

export type FonteDoCrm =
  | { estado: "ok"; leads: CrmLead[]; geradoEm?: string; velho: boolean; idadeMin: number | null }
  | { estado: "sem-sinal"; motivo: string };

/** O retrato do CRM como fonte das salas: o que não foi lido é "sem sinal", nunca lista vazia. */
export function fonteDoCrm(visao: CrmVisao | null, erro: string, agora: number): FonteDoCrm {
  if (!visao) return { estado: "sem-sinal", motivo: erro ? `o CRM não foi lido (${erro})` : "o CRM ainda não foi lido" };
  if (visao.estado !== "ok") return { estado: "sem-sinal", motivo: visao.mensagem ?? "sem retrato das planilhas" };
  const idadeMin = visao.geradoEm ? Math.max(0, Math.round((agora - Date.parse(visao.geradoEm)) / 60_000)) : null;
  return {
    estado: "ok",
    leads: visao.leads,
    ...(visao.geradoEm ? { geradoEm: visao.geradoEm } : {}),
    idadeMin,
    velho: idadeMin === null || idadeMin > visao.minutosAteVelho,
  };
}

// ------------------------------------------------------------------ jornada lida

export interface ContagemDoPasso {
  passo: IdDoPasso;
  nome: string;
  quem: QuemFaz;
  leads: number;
  parados: number;
}

export interface RecorteLido {
  produto: CrmProduto | null;
  rotulo: string;
  /** "Ver no Funil": /crm?ver=jornada&produto=… (sem produto quando são todas), onde está a lista. */
  href: string;
  total: number;
  /** Os passos do recorte que têm lead, na ordem da jornada. */
  passos: ContagemDoPasso[];
  /** Fechou e Perdido, só no recorte sem `passos` (a jornada inteira da oferta). */
  fechados?: { ganho: number; perdido: number };
  /** Em andamento esperando o Rômulo (o estoque antes do primeiro contato não conta, como na vista Jornada). */
  comVoce: number;
  parados: number;
}

/** A vista "por passo da jornada" do Funil, no filtro da oferta: é lá que os leads são listados. */
export function hrefDaJornada(produto: CrmProduto | null): string {
  const q = new URLSearchParams({ ver: "jornada" });
  if (produto) q.set("produto", produto);
  return `/crm?${q.toString()}`;
}

export function lerRecorte(recorte: RecorteDaSala, leads: readonly CrmLead[]): RecorteLido {
  const doProduto = recorte.produto ? leads.filter((l) => l.produto === recorte.produto) : [...leads];
  const painel = painelDaJornada(doProduto);
  const abertos = (id: IdDoPasso) => (recorte.passos ? recorte.passos.includes(id) : id !== "ganho" && id !== "perdido");
  const doRecorte = painel.passos.filter((p) => abertos(p.passo.id));
  const contar = (id: IdDoPasso) => painel.passos.find((p) => p.passo.id === id)?.leads.length ?? 0;
  return {
    produto: recorte.produto,
    rotulo: recorte.produto ? ROTULO_DO_PRODUTO[recorte.produto] : "Todas as ofertas",
    href: hrefDaJornada(recorte.produto),
    total: doRecorte.reduce((n, p) => n + p.leads.length, 0),
    passos: doRecorte
      .filter((p) => p.leads.length)
      .map((p) => ({ passo: p.passo.id, nome: p.passo.nome, quem: p.passo.quem, leads: p.leads.length, parados: p.parados })),
    ...(recorte.passos ? {} : { fechados: { ganho: contar("ganho"), perdido: contar("perdido") } }),
    comVoce: doRecorte.filter((p) => !p.fila).reduce((n, p) => n + p.leads.filter((l) => l.proximo.quem === "você").length, 0),
    parados: doRecorte.reduce((n, p) => n + p.parados, 0),
  };
}

// ------------------------------------------------------------------ robôs

export type TomDoRobo = "ok" | "atencao" | "sozinho" | "falha" | "sem_sinal";

export interface EstadoDoRobo {
  tom: TomDoRobo;
  texto: string;
}

/** O estado de um robô, só pelo status.json; sem retrato recente ou sem verificação, "Sem sinal". */
export function estadoDoRobo(verificacao: string | undefined, dell: DellStatus | null, agora: number): EstadoDoRobo {
  const semSinal = (porque: string): EstadoDoRobo => ({ tom: "sem_sinal", texto: `Sem sinal: ${porque}` });
  if (!dell) return semSinal("o retrato do Dell não foi lido");
  if (!dell.geradoEm) return semSinal("o monitor do Dell ainda não gravou o retrato");
  const idade = agora - Date.parse(dell.geradoEm);
  if (!(idade <= RETRATO_DO_DELL_VENCE_EM_MS)) return semSinal(`o retrato do Dell tem ${Math.round(idade / 60_000)} min`);
  if (!verificacao) return semSinal("o monitor do Dell não confere este robô");
  const c: DellCheck | undefined = dell.verificacoes.find((v) => v.id === verificacao);
  if (!c) return semSinal("o retrato do Dell não traz este robô");
  if (c.estado === "falha") return { tom: "falha", texto: `Falhou: ${c.detalhe}` };
  if (c.estado === "atencao") return c.sozinho ? { tom: "sozinho", texto: `Resolve sozinho: ${c.detalhe}` } : { tom: "atencao", texto: `Vale olhar: ${c.detalhe}` };
  return { tom: "ok", texto: `Em dia: ${c.detalhe}` };
}

export interface RoboNaSala extends EstadoDoRobo {
  id: string;
  nome: string;
  quando: string;
  faz: string;
  onde: string;
  /** O "Como funciona" dele, em Mais. */
  href: string;
}

// ------------------------------------------------------------------ a sala inteira

export interface OperacaoDaSala {
  /** null quando a sala não tem jornada (só robôs). */
  jornada:
    | null
    | { titulo: string; estado: "sem-sinal"; motivo: string }
    | { titulo: string; estado: "ok"; recortes: RecorteLido[]; velho: boolean; idadeMin: number | null };
  robos: RoboNaSala[];
}

/** O que a sala mostra da operação; null quando ela não tem jornada nem robô (as salas de fora do PRUMO). */
export function operacaoDaSala(
  salaId: string,
  fontes: { crm: FonteDoCrm; dell: DellStatus | null; agora: number },
  catalogo: (sala: string) => TrabalhadorAutomatico[] = trabalhadoresDaSala
): OperacaoDaSala | null {
  const def = JORNADA_DAS_SALAS[salaId];
  const robos = catalogo(salaId).map((t) => ({
    id: t.id,
    nome: t.nome,
    quando: t.quando,
    faz: t.faz,
    onde: t.onde,
    href: linkDoComoFunciona(t),
    ...estadoDoRobo(t.verificacao, fontes.dell, fontes.agora),
  }));
  if (!def && !robos.length) return null;
  const { crm } = fontes;
  const jornada: OperacaoDaSala["jornada"] = !def
    ? null
    : crm.estado !== "ok"
      ? { titulo: def.titulo, estado: "sem-sinal", motivo: crm.motivo }
      : { titulo: def.titulo, estado: "ok", recortes: def.recortes.map((r) => lerRecorte(r, crm.leads)), velho: crm.velho, idadeMin: crm.idadeMin };
  return { jornada, robos };
}

/** Alguma sala desta lista mostra a operação? Decide se o Escritório lê o CRM e o Dell. */
export function temOperacao(salaIds: readonly string[], catalogo: (sala: string) => TrabalhadorAutomatico[] = trabalhadoresDaSala): boolean {
  return salaIds.some((id) => id in JORNADA_DAS_SALAS || catalogo(id).length > 0);
}
