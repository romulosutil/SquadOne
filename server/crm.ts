import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lerPastasDosLeads, type GeradorDeSites, type LugarDaPasta, type PastaDoLead } from "./auto-production.ts";

// CRM da Central: Site antes da venda + PRUMO num modelo só (30/09/2026).
//
// Fonte da verdade = as planilhas. O fluxo "08 · CRM" do n8n lê a aba Leads
// (Site antes da venda), a aba Prospects (PRUMO — Fila de revisão) e a aba CRM
// (notas, próximo passo e proposta, gravadas pela Central através do próprio
// n8n) e grava ~/.local/share/n8n-estado/crm.json. Este módulo só LÊ esse
// retrato, cruza com as pastas de ~/auto-site e com os Mapas em
// ~/prumo-entregas e devolve etapas, a lista "Hoje" e a ficha de cada lead.
// A Central não tem etapa própria: divergência entre planilha e pasta vira
// nota, nunca correção.
//
// Todas as regras de etapa moram aqui, em etapaDoSite e etapaDoPrumo, e os
// nomes de coluna em COLUNAS_DO_SITE / COLUNAS_DO_PRUMO / COLUNAS_DO_REGISTRO.

export const ETAPAS = ["novo", "contatado", "conversando", "proposta", "ganho", "perdido"] as const;
export type CrmEtapa = (typeof ETAPAS)[number];
export type CrmProduto = "site" | "prumo";

export const ROTULO_DA_ETAPA: Record<CrmEtapa, string> = {
  novo: "Novo",
  contatado: "Contatado",
  conversando: "Conversando",
  proposta: "Proposta",
  ganho: "Ganho",
  perdido: "Perdido",
};

export const ROTULO_DO_PRODUTO: Record<CrmProduto, string> = { site: "Site antes da venda", prumo: "PRUMO" };

/** Follow-up, expiração e mudança automática de pasta só valem para envio a partir daqui (site-antes-da-venda.py). */
export const CORTE_DO_ACOMPANHAMENTO = "2026-09-29T00:00:00-03:00";
export const DIAS_ATE_FOLLOWUP = 3;
export const DIAS_ATE_EXPIRAR = 10;
/** Resposta "nova" para a lista Hoje quando não há colunas de última entrada/saída. */
export const HORAS_DE_RESPOSTA_NOVA = 48;
/** Retrato mais velho que isto aparece como desatualizado (o fluxo roda a cada 10 min). */
export const MINUTOS_ATE_RETRATO_VELHO = 30;
/** Pastas mudam de lugar pelo site-pastas depois do Balcão (de hora em hora): folga antes de chamar de divergência. */
const FOLGA_DAS_PASTAS_MS = 2 * 60 * 60 * 1000;

const DIA_MS = 24 * 60 * 60 * 1000;
const FUSO_SP_MS = 3 * 60 * 60 * 1000; // São Paulo sem horário de verão desde 2019

// ------------------------------------------------------------------ colunas

interface Coluna {
  /** Cabeçalhos aceitos, já normalizados (sem acento, minúsculas, "_" no lugar de espaço). */
  nomes: string[];
  /** Coluna que outro fluxo está criando: ausência é informada na tela, não é erro. */
  esperada?: boolean;
}

export const COLUNAS_DO_SITE = {
  id: { nomes: ["place_id"] },
  empresa: { nomes: ["nome"] },
  nicho: { nomes: ["vertical"] },
  cidade: { nomes: ["cidade"] },
  status: { nomes: ["status"] },
  site: { nomes: ["site_url"] },
  criadoEm: { nomes: ["criado_em"] },
  enviadoEm: { nomes: ["enviado_em"] },
  // Confirmação de leitura do WhatsApp (observador, 30/09/2026).
  vistoEm: { nomes: ["visto_em", "lido_em"], esperada: true },
  respondeuEm: { nomes: ["respondeu_em"] },
  followupEm: { nomes: ["followup_em"] },
  // Página do lead (fluxo "07 · Lead", 30/09/2026).
  recusadoEm: { nomes: ["recusado_em"], esperada: true },
  fechadoEm: { nomes: ["fechado_em"], esperada: true },
  acoesLink: { nomes: ["acoes_link"], esperada: true },
  waLink: { nomes: ["wa_link"] },
  waMe: { nomes: ["wa_me"] },
  // Se o observador passar a gravar a última mensagem de cada lado, "responder" fica exato.
  ultimaEntradaEm: { nomes: ["ultima_entrada_em", "ultima_resposta_em", "ultima_mensagem_do_lead_em"] },
  ultimaSaidaEm: { nomes: ["ultima_saida_em", "ultimo_envio_em", "ultima_mensagem_minha_em"] },
  // O que o lead escreveu, classificado pelo n8n (fluxo "WhatsApp — resposta de lead", 05/10/2026).
  respostaTipo: { nomes: ["resposta_tipo"] },
  respostaTrecho: { nomes: ["resposta_trecho"] },
  respostaEm: { nomes: ["resposta_em"] },
  // O que o lead recebeu (Balcão, 07/10/2026): a variação da primeira mensagem (A/B/C, EN, ou
  // "manual" quando saiu sem o clique no wa_link) e a versão do site ("padrão", "personalizado-v2"...).
  mensagemVariante: { nomes: ["mensagem_variante"] },
  siteVersao: { nomes: ["site_versao"] },
  linha: { nomes: ["row_number"] },
} satisfies Record<string, Coluna>;

export const COLUNAS_DO_PRUMO = {
  id: { nomes: ["id"] },
  empresa: { nomes: ["empresa"] },
  nicho: { nomes: ["segmento"] },
  cidade: { nomes: ["cidade"] },
  etapa: { nomes: ["etapa"] },
  site: { nomes: ["site"] },
  whatsapp: { nomes: ["whatsapp"] },
  proximaAcao: { nomes: ["proxima_acao"] },
  encontradoEm: { nomes: ["encontrado_em"] },
  conviteEm: { nomes: ["convite_enviado_em"] },
  vistoEm: { nomes: ["visto_em", "lido_em"] },
  respondeuEm: { nomes: ["respondeu_em"] },
  diagnosticoEm: { nomes: ["diagnostico_em"] },
  indice: { nomes: ["indice_prumo"] },
  respostaTipo: { nomes: ["tipo_da_resposta"] },
  respostaTrecho: { nomes: ["resposta"] },
  respostaEm: { nomes: ["resposta_em"] },
  linha: { nomes: ["row_number"] },
} satisfies Record<string, Coluna>;

/**
 * Segunda mensagem do Site antes da venda: o link, para quem respondeu à primeira (que pede
 * licença, sem link). Espelho de SEGUNDA em deploy/dell/claude-ops/site-mensagem.js; o aviso do
 * Hermes usa aquele, a ficha usa este. Mudou lá, mude aqui.
 */
export const SEGUNDA_MENSAGEM_DO_SITE = "Aqui está: {URL}\n\nFiz com as fotos e as avaliações de vocês no Google. Se gostarem, coloco no ar com o endereço de vocês; se não, eu apago, sem problema. O que acharam?";

/** "exclusao" (07/10/2026): pediu para apagar o demo ou o conteúdo; para o funil é uma negativa. */
export const TIPOS_DE_RESPOSTA = ["negativa", "exclusao", "interesse", "neutra", "bot"] as const;
export type CrmTipoDeResposta = (typeof TIPOS_DE_RESPOSTA)[number];
const ehRecusa = (resposta: CrmResposta | undefined) => resposta?.tipo === "negativa" || resposta?.tipo === "exclusao";

export interface CrmResposta {
  tipo: CrmTipoDeResposta;
  /** Frase da pessoa que decidiu a classificação (até 200 caracteres); vazia quando é robô. */
  trecho: string;
  em?: string;
}

export const ROTULO_DA_RESPOSTA: Record<CrmTipoDeResposta, string> = {
  negativa: "Negativa",
  exclusao: "Pediu para apagar",
  interesse: "Interesse",
  neutra: "Sem sim nem não",
  bot: "Só resposta automática",
};

function respostaDaLinha(c: (campo: "respostaTipo" | "respostaTrecho" | "respostaEm") => string): CrmResposta | undefined {
  const tipo = c("respostaTipo").toLowerCase() as CrmTipoDeResposta;
  if (!TIPOS_DE_RESPOSTA.includes(tipo)) return undefined;
  const em = instante(c("respostaEm"));
  return { tipo, trecho: c("respostaTrecho"), ...(em !== undefined ? { em: new Date(em).toISOString() } : {}) };
}

/** Aba "CRM" da planilha do Site antes da venda: uma linha por registro feito na Central (só acrescenta). */
export const COLUNAS_DO_REGISTRO = {
  em: { nomes: ["em"] },
  produto: { nomes: ["produto"] },
  id: { nomes: ["id"] },
  tipo: { nomes: ["tipo"] },
  texto: { nomes: ["texto"] },
  data: { nomes: ["data"] },
} satisfies Record<string, Coluna>;

export const TIPOS_DE_REGISTRO = ["nota", "proximo_passo", "proposta", "proposta_desfeita", "sem_contato", "sem_contato_desfeito"] as const;
export type CrmTipoDeRegistro = (typeof TIPOS_DE_REGISTRO)[number];

export function normalizarCabecalho(nome: string): string {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

type Linha = Record<string, string>;

/** Acesso tolerante: cabeçalho renomeado, com acento ou ausente não derruba nada. */
function leitor<T extends Record<string, Coluna>>(colunas: T, linha: Record<string, unknown>) {
  const porNome = new Map<string, string>();
  for (const [chave, valor] of Object.entries(linha)) porNome.set(normalizarCabecalho(chave), texto(valor));
  return (campo: keyof T): string => {
    for (const nome of colunas[campo].nomes) {
      const valor = porNome.get(nome);
      if (valor) return valor;
    }
    return "";
  };
}

function colunasAusentes<T extends Record<string, Coluna>>(colunas: T, presentes: string[], planilha: string): string[] {
  const normalizadas = new Set(presentes.map(normalizarCabecalho));
  return Object.values(colunas)
    .filter((coluna: Coluna) => coluna.esperada && !coluna.nomes.some((nome) => normalizadas.has(nome)))
    .map((coluna: Coluna) => `${planilha}: ${coluna.nomes[0]}`);
}

// ------------------------------------------------------------------ retrato do n8n

export interface CrmFonte {
  planilha?: string;
  aba?: string;
  colunas: string[];
  linhas: Linha[];
  erro?: string;
}

export interface CrmRetrato {
  versao: 1;
  geradoEm: string;
  links: { webhook?: string; planilhaSite?: string; planilhaPrumo?: string; planilhaCrm?: string };
  fontes: { site: CrmFonte; prumo: CrmFonte; registros: CrmFonte };
}

export class RetratoInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetratoInvalido";
  }
}

function texto(valor: unknown, maximo = 1000): string {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, maximo);
}

function lerFonte(valor: unknown, nome: string): CrmFonte {
  if (valor === undefined || valor === null) return { colunas: [], linhas: [], erro: `${nome} ausente no retrato.` };
  if (typeof valor !== "object") throw new RetratoInvalido(`fontes.${nome} inválida.`);
  const bruto = valor as Record<string, unknown>;
  if (!Array.isArray(bruto.linhas)) throw new RetratoInvalido(`fontes.${nome}.linhas deve ser uma lista.`);
  const linhas = bruto.linhas
    .filter((linha): linha is Record<string, unknown> => Boolean(linha) && typeof linha === "object" && !Array.isArray(linha))
    .slice(0, 5000)
    .map((linha) => Object.fromEntries(Object.entries(linha).slice(0, 80).map(([k, v]) => [texto(k, 80), texto(v)])));
  const colunas = Array.isArray(bruto.colunas)
    ? bruto.colunas.filter((c): c is string => typeof c === "string").map((c) => texto(c, 80))
    : [...new Set(linhas.flatMap((linha) => Object.keys(linha)))];
  return {
    ...(texto(bruto.planilha, 120) ? { planilha: texto(bruto.planilha, 120) } : {}),
    ...(texto(bruto.aba, 60) ? { aba: texto(bruto.aba, 60) } : {}),
    colunas,
    linhas,
    ...(texto(bruto.erro, 300) ? { erro: texto(bruto.erro, 300) } : {}),
  };
}

function urlHttps(valor: unknown): string | undefined {
  const bruto = texto(valor, 2000);
  if (!bruto) return undefined;
  try {
    const url = new URL(bruto);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function validarRetrato(valor: unknown): CrmRetrato {
  if (!valor || typeof valor !== "object") throw new RetratoInvalido("O retrato não é um objeto.");
  const bruto = valor as Record<string, unknown>;
  if (bruto.versao !== 1) throw new RetratoInvalido("Versão do retrato desconhecida.");
  const geradoEm = texto(bruto.geradoEm, 64);
  if (!Number.isFinite(Date.parse(geradoEm))) throw new RetratoInvalido("Retrato sem geradoEm válido.");
  const fontes = (bruto.fontes && typeof bruto.fontes === "object" ? bruto.fontes : {}) as Record<string, unknown>;
  const links = (bruto.links && typeof bruto.links === "object" ? bruto.links : {}) as Record<string, unknown>;
  const linkLimpo = (nome: string) => urlHttps(links[nome]);
  return {
    versao: 1,
    geradoEm: new Date(geradoEm).toISOString(),
    links: Object.fromEntries(["webhook", "planilhaSite", "planilhaPrumo", "planilhaCrm"]
      .map((nome) => [nome, linkLimpo(nome)]).filter(([, v]) => v)) as CrmRetrato["links"],
    fontes: {
      site: lerFonte(fontes.site, "site"),
      prumo: lerFonte(fontes.prumo, "prumo"),
      registros: lerFonte(fontes.registros, "registros"),
    },
  };
}

// ------------------------------------------------------------------ datas

function instante(valor: string): number | undefined {
  if (!valor) return undefined;
  const t = Date.parse(valor);
  return Number.isFinite(t) ? t : undefined;
}

const iso = (t: number | undefined) => (t === undefined ? undefined : new Date(t).toISOString());
export const diaSP = (ms: number) => Math.floor((ms - FUSO_SP_MS) / DIA_MS);
/** "2026-10-02" (data escolhida na Central) como o meio-dia daquele dia em São Paulo. */
function dataDoDia(valor: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return instante(valor);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], 15, 0, 0);
}

/**
 * Data escrita pelo fluxo da conversa na Próxima ação do PRUMO (whatsapp-conversa.py):
 * "Respondeu no WhatsApp em 24/09, 11:50." ou "Leu o convite em 24/09, 11:50.".
 */
export function dataNaProximaAcao(proximaAcao: string, qual: "respondeu" | "leu", referencia: number | undefined, agora: number): number | undefined {
  const prefixo = qual === "respondeu" ? "respondeu no whatsapp em" : "leu o convite em";
  const m = new RegExp(`${prefixo} (\\d{2})\\/(\\d{2}),? (\\d{2}):(\\d{2})`, "i").exec(proximaAcao);
  if (!m) return undefined;
  let ano = new Date(referencia ?? agora).getUTCFullYear();
  let t = Date.UTC(ano, +m[2] - 1, +m[1], +m[3], +m[4]) + FUSO_SP_MS;
  if (t > agora + DIA_MS) t = Date.UTC(--ano, +m[2] - 1, +m[1], +m[3], +m[4]) + FUSO_SP_MS;
  return t;
}

function numeroDoWhatsapp(...fontes: string[]): string | undefined {
  for (const fonte of fontes) {
    const doLink = /wa\.me\/(\d{10,15})/.exec(fonte)?.[1];
    let digitos = doLink ?? fonte.replace(/\D/g, "");
    if (!digitos) continue;
    if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
    if (digitos.length >= 12 && digitos.length <= 15) return digitos;
  }
  return undefined;
}

// ------------------------------------------------------------------ modelo

export type CrmOrigemDoEvento = "automático" | "manual";

export interface CrmEvento {
  tipo: string;
  rotulo: string;
  em: string;
  origem: CrmOrigemDoEvento;
  fonte: string;
  texto?: string;
  estimado?: boolean;
}

export interface CrmLink {
  rotulo: string;
  url: string;
}

export interface CrmLead {
  id: string;
  produto: CrmProduto;
  chave: string;
  empresa: string;
  nicho: string;
  cidade: string;
  etapa: CrmEtapa;
  sinal: CrmSinal;
  subEtapa: string;
  motivoPerda?: "recusou" | "expirou" | "descartado" | "sem-interesse" | "sem-contato";
  /** Valor cru da planilha (status do Site, Etapa do PRUMO), para conferência. */
  estadoNaPlanilha: string;
  desde?: string;
  diasNaEtapa?: number;
  ultimoEvento?: string;
  diasDesdeUltimoEvento?: number;
  /**
   * Leitura só é afirmada com evidência: visto_em (recibo de leitura) ou a própria resposta.
   * Sem nenhuma das duas é "desconhecida", nunca "não viu" (RULES 2 e 15).
   */
  leitura: "viu" | "pela-resposta" | "desconhecida" | "nao-se-aplica";
  marcos: { enviado?: string; visto?: string; respondeu?: string };
  followupHoje: boolean;
  respostaNova: boolean;
  acervo: boolean;
  proximoPasso?: { texto: string; data: string; registradoEm: string };
  proposta?: { em: string; data: string };
  notas: number;
  /** A última resposta classificada (só com o fluxo de 05/10/2026; antes disso, ausente). */
  resposta?: CrmResposta;
  /**
   * Site antes da venda, desde 07/10/2026: a variação da primeira mensagem (`mensagem_variante`:
   * A/B/C, EN, ou "manual") e a versão do site (`site_versao`). Ausente quando a planilha não diz.
   */
  abordagem?: { mensagem?: string; site?: string };
  eventos: CrmEvento[];
  /** `segunda`: a mensagem depois do "sim" (Site: o link do site; PRUMO: o diagnóstico). */
  links: { site?: string; enviar?: string; whatsapp?: string; acoes?: string; convite?: string; segunda?: string; planilha?: string };
  pasta?: { lugar: string; slug: string; artefatos?: PastaDoLead["artefatos"]; falha?: string };
  divergencias: string[];
}

export type CrmGrupoHojeId = "proximo" | "followup" | "resposta" | "revisar" | "proposta" | "enviar";

export interface CrmItemHoje {
  leadId: string;
  acao: string;
  detalhe: string;
  links: CrmLink[];
  ordem: number;
}

export interface CrmGrupoHoje {
  id: CrmGrupoHojeId;
  titulo: string;
  explicacao: string;
  itens: CrmItemHoje[];
}

export interface CrmContagem {
  total: number;
  site: number;
  prumo: number;
}

/**
 * Sem instante da leitura de propósito: a resposta só muda quando o retrato, as
 * pastas ou o dia mudam, e o ETag do Express devolve 304 ao celular no resto.
 * A idade do retrato é calculada na tela a partir de geradoEm.
 */
export interface CrmVisao {
  estado: "ok" | "sem-retrato" | "retrato-invalido";
  mensagem?: string;
  geradoEm?: string;
  minutosAteVelho: number;
  fontes: Array<{ id: "site" | "prumo" | "registros"; nome: string; linhas: number; erro?: string }>;
  colunasAusentes: string[];
  contagens: Record<CrmEtapa, CrmContagem>;
  perdas: { recusou: number; expirou: number; descartado: number; semInteresse: number };
  hoje: CrmGrupoHoje[];
  leads: CrmLead[];
  divergencias: number;
  pastasSemLinha: string[];
  pastasLidas: boolean;
  gerador?: GeradorDeSites;
  registro: { disponivel: boolean; motivo?: string };
  links: CrmRetrato["links"];
  /** Última rodada do n8n que não conseguiu ler as planilhas (crm-falha.json), se for mais nova que o retrato. */
  ultimaFalha?: { em: string; erro: string };
}

interface Registro {
  em: number;
  tipo: CrmTipoDeRegistro;
  texto: string;
  data: string;
}

export interface MapaDoPrumo {
  prospectId: string;
  geradoEm: string;
  pasta: string;
}

export interface ContextoDoCrm {
  agora: Date;
  pastas?: PastaDoLead[];
  gerador?: GeradorDeSites;
  mapas?: MapaDoPrumo[];
  registroDisponivel?: { disponivel: boolean; motivo?: string };
  ultimaFalha?: { em: string; erro: string };
}

function registrosPorLead(retrato: CrmRetrato): Map<string, Registro[]> {
  const mapa = new Map<string, Registro[]>();
  for (const linha of retrato.fontes.registros.linhas) {
    const c = leitor(COLUNAS_DO_REGISTRO, linha);
    const produto = c("produto");
    const tipo = c("tipo") as CrmTipoDeRegistro;
    const em = instante(c("em"));
    if ((produto !== "site" && produto !== "prumo") || !c("id") || !TIPOS_DE_REGISTRO.includes(tipo) || em === undefined) continue;
    const chave = `${produto}:${c("id")}`;
    const lista = mapa.get(chave) ?? [];
    lista.push({ em, tipo, texto: texto(c("texto"), 1000), data: c("data") });
    mapa.set(chave, lista);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => a.em - b.em);
  return mapa;
}

/** Proposta vale até ser desfeita; próximo passo é o último registrado (texto vazio limpa). */
function manuais(registros: Registro[]) {
  let proposta: Registro | undefined;
  let proximo: Registro | undefined;
  let semContato: Registro | undefined;
  for (const r of registros) {
    if (r.tipo === "sem_contato") semContato = r;
    if (r.tipo === "sem_contato_desfeito") semContato = undefined;
    if (r.tipo === "proposta") proposta = r;
    if (r.tipo === "proposta_desfeita") proposta = undefined;
    if (r.tipo === "proximo_passo") proximo = r.texto ? r : undefined;
  }
  return { proposta, proximo, semContato, notas: registros.filter((r) => r.tipo === "nota").length };
}

/** "Sem contato fácil" marcado à mão: encerra o lead como perdido, salvo se já estiver ganho ou perdido. */
function comPerdaManual(calculada: EtapaCalculada, semContato: Registro | undefined): EtapaCalculada {
  if (!semContato || calculada.etapa === "ganho" || calculada.etapa === "perdido") return calculada;
  return { etapa: "perdido", sinal: "sem-contato", subEtapa: "Perdido: sem contato fácil", desde: semContato.em, motivoPerda: "sem-contato" };
}

function eventosManuais(registros: Registro[]): CrmEvento[] {
  const rotulo: Record<CrmTipoDeRegistro, string> = {
    nota: "Nota",
    proximo_passo: "Próximo passo",
    proposta: "Proposta enviada",
    proposta_desfeita: "Proposta desfeita",
    sem_contato: "Perdido: sem contato fácil",
    sem_contato_desfeito: "Perda por falta de contato desfeita",
  };
  return registros.map((r) => ({
    tipo: r.tipo,
    rotulo: rotulo[r.tipo],
    em: new Date(r.em).toISOString(),
    origem: "manual" as const,
    fonte: "aba CRM (registrado na Central)",
    ...(r.tipo === "proximo_passo"
      ? { texto: r.texto ? `${r.texto}${r.data ? ` (para ${formatarDia(r.data)})` : ""}` : "Próximo passo limpo" }
      : r.tipo === "proposta" && r.data
        ? { texto: `Data da proposta: ${formatarDia(r.data)}${r.texto ? ` · ${r.texto}` : ""}` }
        : r.texto ? { texto: r.texto } : {}),
  }));
}

function formatarDia(valor: string): string {
  const t = dataDoDia(valor);
  if (t === undefined) return valor;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(t));
}

function eventoDaResposta(resposta: CrmResposta | undefined, fonte: string): CrmEvento[] {
  if (!resposta?.em) return [];
  return [{ tipo: "resposta", rotulo: `Resposta classificada: ${ROTULO_DA_RESPOSTA[resposta.tipo]}`, em: resposta.em,
    origem: "automático", fonte, ...(resposta.trecho ? { texto: resposta.trecho } : {}) }];
}

function evento(tipo: string, rotulo: string, t: number | undefined, fonte: string, extra: Partial<CrmEvento> = {}): CrmEvento[] {
  return t === undefined ? [] : [{ tipo, rotulo, em: new Date(t).toISOString(), origem: "automático", fonte, ...extra }];
}

function leituraDe(enviado: number | undefined, visto: number | undefined, resposta: number | undefined, contatado: boolean): CrmLead["leitura"] {
  if (visto !== undefined) return "viu";
  if (resposta !== undefined) return "pela-resposta";
  return enviado !== undefined || contatado ? "desconhecida" : "nao-se-aplica";
}

const dias = (desde: number | undefined, agora: number) => (desde === undefined ? undefined : Math.max(0, diaSP(agora) - diaSP(desde)));

// ------------------------------------------------------------------ etapa do Site antes da venda

/** Subetapa em forma de código: a tela e a lista Hoje decidem por ele, não pelo texto. */
export type CrmSinal =
  | "na-fila" | "publicado" | "pronto" | "enviado" | "viu" | "respondeu" | "em-conversa"
  | "revisar" | "sem-etapa" | "convite" | "convite-visto" | "respondeu-prumo" | "diagnostico"
  | "proposta" | "fechou" | "concluido" | "recusou" | "recusou-pasta" | "expirou" | "descartado" | "sem-interesse" | "sem-contato" | "so-robo";

interface EtapaCalculada {
  etapa: CrmEtapa;
  sinal: CrmSinal;
  subEtapa: string;
  desde?: number;
  motivoPerda?: CrmLead["motivoPerda"];
}

/**
 * Site antes da venda: status da planilha primeiro; a pasta só decide o que a
 * planilha ainda não sabe e o resto da esteira já trata como estado (recusa
 * anotada à mão em _recusados/, conversa movida para _em-conversa/).
 */
/** "Respondeu" diz o que a pessoa disse, quando o n8n classificou; sem classificação, como antes. */
function subEtapaDaResposta(resposta: CrmResposta | undefined, base = "Respondeu"): string {
  if (resposta?.tipo === "interesse") return `${base}: quer ver (interesse)`;
  if (resposta?.tipo === "neutra") return `${base}: sem sim nem não`;
  return base;
}

export function etapaDoSite(entrada: {
  status: string;
  lugar?: LugarDaPasta;
  publicado: boolean;
  enviado?: number;
  visto?: number;
  respondeu?: number;
  recusado?: number;
  fechado?: number;
  criado?: number;
  publicadoEm?: number;
  proposta?: Registro;
  resposta?: CrmResposta;
}): EtapaCalculada {
  const { status, lugar, resposta } = entrada;
  if (status === "fechado") return { etapa: "ganho", sinal: "fechou", subEtapa: "Fechou", desde: entrada.fechado };
  if (status === "recusado") {
    const noWhatsapp = resposta?.tipo === "exclusao" ? " no WhatsApp (pediu para apagar o demo)"
      : resposta?.tipo === "negativa" ? " no WhatsApp (resposta negativa)" : "";
    return { etapa: "perdido", sinal: "recusou", subEtapa: `Recusou${noWhatsapp}`, desde: entrada.recusado, motivoPerda: "recusou" };
  }
  if (lugar === "_recusados") return { etapa: "perdido", sinal: "recusou-pasta", subEtapa: "Recusou (anotado na pasta _recusados/)", motivoPerda: "recusou" };
  if (status === "expirado" && entrada.respondeu === undefined) {
    return {
      etapa: "perdido",
      sinal: "expirou",
      subEtapa: `Expirou: ${DIAS_ATE_EXPIRAR} dias sem resposta`,
      desde: entrada.enviado === undefined ? undefined : entrada.enviado + DIAS_ATE_EXPIRAR * DIA_MS,
      motivoPerda: "expirou",
    };
  }
  if (status === "descartado") return { etapa: "perdido", sinal: "descartado", subEtapa: "Descartado antes do contato", motivoPerda: "descartado" };
  // O gerador (ou uma sessão do Claude) descarta movendo a pasta, sem tocar na planilha: a divergência aparece na ficha.
  if (lugar === "_descartados") return { etapa: "perdido", sinal: "descartado", subEtapa: "Descartado (pasta _descartados/)", motivoPerda: "descartado" };
  if (entrada.proposta) return { etapa: "proposta", sinal: "proposta", subEtapa: "Proposta enviada", desde: dataDoDia(entrada.proposta.data) ?? entrada.proposta.em };
  if (entrada.respondeu !== undefined) return { etapa: "conversando", sinal: "respondeu", subEtapa: subEtapaDaResposta(resposta), desde: entrada.respondeu };
  // Só robô respondeu (o n8n já apagou o respondeu_em): é contato sem conversa, mesmo com a pasta em _em-conversa/.
  if (resposta?.tipo === "bot" && (status === "enviado" || status === "expirado")) {
    return { etapa: "contatado", sinal: "so-robo", subEtapa: "Só resposta automática (robô), ninguém respondeu ainda", desde: entrada.enviado };
  }
  if (lugar === "_em-conversa") return { etapa: "conversando", sinal: "em-conversa", subEtapa: "Em conversa (pasta _em-conversa/)", desde: entrada.enviado };
  if (status === "enviado" || status === "expirado" || entrada.enviado !== undefined) {
    return entrada.visto !== undefined
      ? { etapa: "contatado", sinal: "viu", subEtapa: "Viu, sem resposta", desde: entrada.enviado ?? entrada.visto }
      : { etapa: "contatado", sinal: "enviado", subEtapa: "Enviado · leitura desconhecida", desde: entrada.enviado };
  }
  if (status === "pronto") return { etapa: "novo", sinal: "pronto", subEtapa: "Pronto, não enviado", desde: entrada.publicadoEm ?? entrada.criado };
  if (entrada.publicado) return { etapa: "novo", sinal: "publicado", subEtapa: "Site publicado, falta o Balcão marcar pronto", desde: entrada.publicadoEm ?? entrada.criado };
  return { etapa: "novo", sinal: "na-fila", subEtapa: lugar === "" ? "Na fila do gerador" : "Sem site e sem pasta em ~/auto-site", desde: entrada.criado };
}

function leadDoSite(linha: Linha, contexto: {
  agora: number;
  pastaPorId: Map<string, PastaDoLead>;
  registros: Map<string, Registro[]>;
  links: CrmRetrato["links"];
  pastasLidas: boolean;
}): CrmLead | null {
  const c = leitor(COLUNAS_DO_SITE, linha);
  const chave = c("id");
  if (!chave || /^TESTE/i.test(chave)) return null;
  const { agora } = contexto;
  const status = c("status").toLowerCase();
  const pasta = contexto.pastaPorId.get(chave);
  const registros = contexto.registros.get(`site:${chave}`) ?? [];
  const { proposta, proximo, semContato, notas } = manuais(registros);
  const t = {
    criado: instante(c("criadoEm")),
    enviado: instante(c("enviadoEm")),
    visto: instante(c("vistoEm")),
    respondeu: instante(c("respondeuEm")),
    followup: instante(c("followupEm")),
    recusado: instante(c("recusadoEm")),
    fechado: instante(c("fechadoEm")),
    publicadoEm: instante(pasta?.publicadoEm ?? ""),
    ultimaEntrada: instante(c("ultimaEntradaEm")),
    ultimaSaida: instante(c("ultimaSaidaEm")),
  };
  const resposta = respostaDaLinha(c);
  const calculada = comPerdaManual(etapaDoSite({ status, lugar: pasta?.lugar, publicado: Boolean(pasta?.artefatos.publicado), ...t, proposta, resposta }), semContato);
  const corte = Date.parse(CORTE_DO_ACOMPANHAMENTO);
  const acervo = t.enviado !== undefined && t.enviado < corte;
  const diasDesdeEnvio = dias(t.enviado, agora);
  const followupHoje = calculada.etapa === "contatado" && !acervo && diasDesdeEnvio !== undefined
    && diasDesdeEnvio >= DIAS_ATE_FOLLOWUP && diasDesdeEnvio < DIAS_ATE_EXPIRAR
    && (t.followup === undefined || diaSP(t.followup) === diaSP(agora))
    && (t.ultimaSaida === undefined || t.enviado === undefined || t.ultimaSaida <= t.enviado + DIAS_ATE_FOLLOWUP * DIA_MS - DIA_MS);
  const respostaNova = calculada.etapa === "conversando" && (
    t.ultimaEntrada !== undefined && t.ultimaSaida !== undefined
      ? t.ultimaEntrada > t.ultimaSaida
      : t.respondeu !== undefined && agora - t.respondeu <= HORAS_DE_RESPOSTA_NOVA * 60 * 60 * 1000);

  const eventos: CrmEvento[] = [
    ...evento("encontrado", "Lead encontrado pelo Caçador", t.criado, "planilha · criado_em"),
    ...evento("site", "Site publicado", t.publicadoEm, "pasta · publicado.json"),
    ...evento("enviado", "Enviado pelo WhatsApp", t.enviado, "planilha · enviado_em"),
    ...evento("visto", "Viu a mensagem", t.visto, "planilha · visto_em"),
    ...evento("respondeu", "Respondeu", t.respondeu, "planilha · respondeu_em"),
    ...eventoDaResposta(resposta, "planilha · resposta_tipo"),
    ...evento("followup", "Lembrete de follow-up (05 · Acompanhamento)", t.followup, "planilha · followup_em"),
    ...(status === "expirado" && t.enviado !== undefined
      ? evento("expirou", "Expirou sem resposta", t.enviado + DIAS_ATE_EXPIRAR * DIA_MS, "status expirado · data pela regra dos 10 dias", { estimado: true })
      : []),
    ...evento("recusou", "Recusou", t.recusado, "planilha · recusado_em"),
    ...evento("fechou", "Fechou", t.fechado, "planilha · fechado_em"),
    ...eventosManuais(registros),
  ].sort((a, b) => Date.parse(a.em) - Date.parse(b.em));

  const webhook = contexto.links.webhook;
  const whatsapp = numeroDoWhatsapp(c("waMe"));
  const waLink = urlHttps(c("waLink"));
  const planilha = contexto.links.planilhaSite && c("linha") ? `${contexto.links.planilhaSite}&range=A${encodeURIComponent(c("linha"))}` : contexto.links.planilhaSite;
  const site = urlHttps(c("site")) ?? pasta?.siteUrl;
  const acoes = urlHttps(c("acoesLink")) ?? (webhook && (pasta || c("site")) ? `${webhook}/lead?id=${encodeURIComponent(chave)}` : undefined);
  // Depois do "sim": a primeira mensagem (desde 05/10/2026) pede licença e não leva o link.
  const segunda = calculada.etapa === "conversando" && !ehRecusa(resposta) && site && whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(SEGUNDA_MENSAGEM_DO_SITE.replace("{URL}", site))}` : undefined;

  const divergencias: string[] = [];
  if (contexto.pastasLidas) {
    const lugar = pasta?.lugar;
    const nomeDoLugar = (l: LugarDaPasta | undefined) => (l === undefined ? "sem pasta" : l === "" ? "pasta na raiz" : `pasta em ${l}/`);
    const recente = (x: number | undefined) => x !== undefined && agora - x < FOLGA_DAS_PASTAS_MS;
    if (status === "recusado" && lugar !== undefined && lugar !== "_recusados" && !recente(t.recusado)) {
      divergencias.push(`Planilha diz recusado, mas a ${nomeDoLugar(lugar)}.`);
    }
    if (status === "fechado" && lugar !== undefined && lugar !== "_fechados" && !recente(t.fechado)) {
      divergencias.push(`Planilha diz fechado, mas a ${nomeDoLugar(lugar)}.`);
    }
    if (lugar === "_fechados" && status !== "fechado") divergencias.push(`Pasta em _fechados/, mas a planilha diz "${status || "sem status"}".`);
    if (lugar === "_descartados" && status !== "descartado") divergencias.push(`Pasta em _descartados/, mas a planilha diz "${status || "sem status"}".`);
    if (status === "descartado" && pasta?.artefatos.publicado && (lugar === "" || lugar === "_em-conversa")) {
      divergencias.push(`Planilha diz descartado, mas há site publicado (${nomeDoLugar(lugar)}).`);
    }
    if (calculada.etapa === "conversando" && t.respondeu !== undefined && t.respondeu >= corte && lugar === "" && !recente(t.respondeu)) {
      divergencias.push("Respondeu, mas a pasta continua na raiz (deveria estar em _em-conversa/).");
    }
    if (status === "expirado" && !acervo && t.respondeu === undefined && lugar === "" && t.enviado !== undefined
      && !recente(t.enviado + DIAS_ATE_EXPIRAR * DIA_MS)) {
      divergencias.push("Expirou, mas a pasta continua na raiz (deveria estar em _concluidos/).");
    }
    if ((status === "pronto" || status === "enviado") && !pasta) divergencias.push("Sem pasta em ~/auto-site para este lead.");
  }

  const desde = calculada.desde;
  const abordagem = { ...(c("mensagemVariante") ? { mensagem: c("mensagemVariante") } : {}), ...(c("siteVersao") ? { site: c("siteVersao") } : {}) };
  const marcos = { ...(iso(t.enviado) ? { enviado: iso(t.enviado) } : {}), ...(iso(t.visto) ? { visto: iso(t.visto) } : {}), ...(iso(t.respondeu) ? { respondeu: iso(t.respondeu) } : {}) };
  const ultimo = eventos.length ? Date.parse(eventos[eventos.length - 1].em) : undefined;
  return {
    id: `site:${chave}`,
    produto: "site",
    chave,
    empresa: c("empresa") || pasta?.nome || chave,
    nicho: c("nicho"),
    cidade: c("cidade"),
    etapa: calculada.etapa,
    sinal: calculada.sinal,
    subEtapa: calculada.subEtapa,
    ...(calculada.motivoPerda ? { motivoPerda: calculada.motivoPerda } : {}),
    estadoNaPlanilha: status || "(vazio)",
    ...(desde !== undefined ? { desde: iso(desde), diasNaEtapa: dias(desde, agora) } : {}),
    ...(ultimo !== undefined ? { ultimoEvento: iso(ultimo), diasDesdeUltimoEvento: dias(ultimo, agora) } : {}),
    leitura: leituraDe(t.enviado, t.visto, t.respondeu ?? (calculada.sinal === "em-conversa" ? agora : undefined), calculada.etapa === "contatado"),
    marcos,
    followupHoje,
    respostaNova,
    acervo,
    ...(proximo ? { proximoPasso: { texto: proximo.texto, data: proximo.data, registradoEm: new Date(proximo.em).toISOString() } } : {}),
    ...(proposta ? { proposta: { em: new Date(proposta.em).toISOString(), data: proposta.data } } : {}),
    notas,
    ...(resposta ? { resposta } : {}),
    ...(Object.keys(abordagem).length ? { abordagem } : {}),
    eventos,
    links: {
      ...(site ? { site } : {}),
      ...(status === "pronto" && waLink ? { enviar: waLink } : {}),
      ...(whatsapp ? { whatsapp: `https://wa.me/${whatsapp}` } : {}),
      ...(acoes ? { acoes } : {}),
      ...(segunda ? { segunda } : {}),
      ...(planilha ? { planilha } : {}),
    },
    ...(pasta ? {
      pasta: {
        lugar: pasta.lugar === "" ? "raiz" : `${pasta.lugar}/`,
        slug: pasta.slug,
        ...(!pasta.artefatos.publicado ? { artefatos: pasta.artefatos } : {}),
        ...(pasta.falhaMensagem ? { falha: pasta.falhaMensagem } : {}),
      },
    } : {}),
    divergencias,
  };
}

// ------------------------------------------------------------------ etapa do PRUMO

/** PRUMO: a coluna Etapa manda; resposta no WhatsApp e diagnóstico levam a Conversando. */
export function etapaDoPrumo(entrada: {
  etapa: string;
  encontrado?: number;
  convite?: number;
  visto?: number;
  respondeu?: number;
  diagnostico?: number;
  proposta?: Registro;
  resposta?: CrmResposta;
}): EtapaCalculada {
  const etapa = normalizarCabecalho(entrada.etapa);
  const { resposta } = entrada;
  if (etapa === "concluido") return { etapa: "ganho", sinal: "concluido", subEtapa: "Concluído (Etapa na planilha)" };
  if (etapa === "sem_interesse") {
    const noWhatsapp = resposta?.tipo === "exclusao" ? " (pediu exclusão no WhatsApp)"
      : resposta?.tipo === "negativa" ? " (resposta negativa no WhatsApp)" : "";
    return { etapa: "perdido", sinal: "sem-interesse", subEtapa: `Sem interesse${noWhatsapp}`, motivoPerda: "sem-interesse" };
  }
  if (entrada.proposta) return { etapa: "proposta", sinal: "proposta", subEtapa: "Proposta enviada", desde: dataDoDia(entrada.proposta.data) ?? entrada.proposta.em };
  if (etapa === "diagnostico_pronto" || entrada.diagnostico !== undefined) {
    return { etapa: "conversando", sinal: "diagnostico", subEtapa: "Formulário respondido · diagnóstico pronto", desde: entrada.diagnostico };
  }
  if (entrada.respondeu !== undefined) {
    return { etapa: "conversando", sinal: "respondeu-prumo", subEtapa: subEtapaDaResposta(resposta, "Respondeu no WhatsApp"), desde: entrada.respondeu };
  }
  if (resposta?.tipo === "bot" && (etapa === "convite_enviado" || entrada.convite !== undefined)) {
    return { etapa: "contatado", sinal: "so-robo", subEtapa: "Só resposta automática (robô), ninguém respondeu ainda", desde: entrada.convite };
  }
  if (etapa === "convite_enviado" || entrada.convite !== undefined) {
    return entrada.visto !== undefined
      ? { etapa: "contatado", sinal: "convite-visto", subEtapa: "Viu o convite, sem resposta", desde: entrada.convite ?? entrada.visto }
      : { etapa: "contatado", sinal: "convite", subEtapa: "Convite enviado · leitura desconhecida", desde: entrada.convite };
  }
  if (etapa === "revisar") return { etapa: "novo", sinal: "revisar", subEtapa: "Revisar", desde: entrada.encontrado };
  return { etapa: "novo", sinal: "sem-etapa", subEtapa: entrada.etapa ? `Etapa "${entrada.etapa}"` : "Sem etapa na planilha", desde: entrada.encontrado };
}

function leadDoPrumo(linha: Linha, contexto: {
  agora: number;
  registros: Map<string, Registro[]>;
  links: CrmRetrato["links"];
  mapas: Map<string, MapaDoPrumo>;
}): CrmLead | null {
  const c = leitor(COLUNAS_DO_PRUMO, linha);
  const chave = c("id");
  if (!chave) return null;
  const { agora } = contexto;
  const registros = contexto.registros.get(`prumo:${chave}`) ?? [];
  const { proposta, proximo, semContato, notas } = manuais(registros);
  const convite = instante(c("conviteEm"));
  const t = {
    encontrado: instante(c("encontradoEm")),
    convite,
    visto: instante(c("vistoEm")) ?? dataNaProximaAcao(c("proximaAcao"), "leu", convite, agora),
    respondeu: instante(c("respondeuEm")) ?? dataNaProximaAcao(c("proximaAcao"), "respondeu", convite, agora),
    diagnostico: instante(c("diagnosticoEm")),
  };
  const mapa = contexto.mapas.get(chave);
  const resposta = respostaDaLinha(c);
  const calculada = comPerdaManual(etapaDoPrumo({ etapa: c("etapa"), ...t, proposta, resposta }), semContato);
  const diasDesdeConvite = dias(t.convite, agora);
  const followupHoje = calculada.etapa === "contatado" && diasDesdeConvite !== undefined
    && diasDesdeConvite >= DIAS_ATE_FOLLOWUP && diasDesdeConvite < DIAS_ATE_EXPIRAR;
  const respostaNova = calculada.etapa === "conversando" && t.respondeu !== undefined && t.diagnostico === undefined
    && agora - t.respondeu <= HORAS_DE_RESPOSTA_NOVA * 60 * 60 * 1000;
  const eventos: CrmEvento[] = [
    ...evento("encontrado", "Encontrado pelo Lead Scout", t.encontrado, "planilha · Encontrado em"),
    ...evento("convite", "Convite enviado", t.convite, "planilha · Convite enviado em"),
    ...evento("visto", "Leu o convite", t.visto, instante(c("vistoEm")) !== undefined ? "planilha · visto_em" : "planilha · Próxima ação"),
    ...evento("respondeu", "Respondeu no WhatsApp", t.respondeu, instante(c("respondeuEm")) !== undefined ? "planilha · respondeu_em" : "planilha · Próxima ação"),
    ...eventoDaResposta(resposta, "planilha · Tipo da resposta"),
    ...evento("diagnostico", `Formulário respondido · diagnóstico pronto${c("indice") ? ` (Índice ${c("indice")})` : ""}`, t.diagnostico, "planilha · Diagnóstico em"),
    ...evento("mapa", "Mapa gerado (rascunho em ~/prumo-entregas)", instante(mapa?.geradoEm ?? ""), `pasta · ${mapa?.pasta ?? ""}`),
    ...eventosManuais(registros),
  ].sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
  const whatsapp = numeroDoWhatsapp(c("whatsapp"));
  const webhook = contexto.links.webhook;
  const planilha = contexto.links.planilhaPrumo && c("linha") ? `${contexto.links.planilhaPrumo}&range=A${encodeURIComponent(c("linha"))}` : contexto.links.planilhaPrumo;
  const desde = calculada.desde;
  const ultimo = eventos.length ? Date.parse(eventos[eventos.length - 1].em) : undefined;
  return {
    id: `prumo:${chave}`,
    produto: "prumo",
    chave,
    empresa: c("empresa") || chave,
    nicho: c("nicho"),
    cidade: c("cidade"),
    etapa: calculada.etapa,
    sinal: calculada.sinal,
    subEtapa: calculada.subEtapa,
    ...(calculada.motivoPerda ? { motivoPerda: calculada.motivoPerda } : {}),
    estadoNaPlanilha: c("etapa") || "(vazio)",
    ...(desde !== undefined ? { desde: iso(desde), diasNaEtapa: dias(desde, agora) } : {}),
    ...(ultimo !== undefined ? { ultimoEvento: iso(ultimo), diasDesdeUltimoEvento: dias(ultimo, agora) } : {}),
    leitura: leituraDe(t.convite, t.visto, t.respondeu ?? t.diagnostico, calculada.etapa === "contatado"),
    marcos: { ...(iso(t.convite) ? { enviado: iso(t.convite) } : {}), ...(iso(t.visto) ? { visto: iso(t.visto) } : {}), ...(iso(t.respondeu) ? { respondeu: iso(t.respondeu) } : {}) },
    followupHoje,
    respostaNova,
    acervo: false,
    ...(proximo ? { proximoPasso: { texto: proximo.texto, data: proximo.data, registradoEm: new Date(proximo.em).toISOString() } } : {}),
    ...(proposta ? { proposta: { em: new Date(proposta.em).toISOString(), data: proposta.data } } : {}),
    notas,
    ...(resposta ? { resposta } : {}),
    eventos,
    links: {
      ...(urlHttps(c("site")) ? { site: urlHttps(c("site")) } : {}),
      ...(calculada.sinal === "revisar" && webhook ? { convite: `${webhook}/convite?id=${encodeURIComponent(chave)}` } : {}),
      ...(calculada.etapa === "conversando" && t.diagnostico === undefined && webhook
        ? { segunda: `${webhook}/convite?id=${encodeURIComponent(chave)}&passo=diagnostico` } : {}),
      ...(whatsapp ? { whatsapp: `https://wa.me/${whatsapp}` } : {}),
      ...(planilha ? { planilha } : {}),
    },
    divergencias: [],
  };
}

// ------------------------------------------------------------------ Hoje

const GRUPOS_DE_HOJE: Array<Omit<CrmGrupoHoje, "itens">> = [
  { id: "proximo", titulo: "Próximo passo para hoje", explicacao: "Combinados que você marcou para hoje ou que já passaram da data." },
  { id: "followup", titulo: "Follow-up para mandar", explicacao: `Contatados há ${DIAS_ATE_FOLLOWUP} dias ou mais sem resposta.` },
  { id: "resposta", titulo: "Respostas para responder", explicacao: "Leads que escreveram por último." },
  { id: "revisar", titulo: "Prospects para revisar", explicacao: "PRUMO na Etapa Revisar: veja o site e decida o convite." },
  { id: "proposta", titulo: "Propostas esperando retorno", explicacao: "Propostas enviadas, do mais antigo para o mais novo." },
  { id: "enviar", titulo: "Sites prontos para enviar", explicacao: "O link marca o envio e abre o WhatsApp com a mensagem." },
];

function textoDeDias(n: number | undefined, prefixo: string): string {
  if (n === undefined) return "";
  if (n === 0) return `${prefixo} hoje`;
  if (n === 1) return `${prefixo} ontem`;
  return `${prefixo} há ${n} dias`;
}

function montarHoje(leads: CrmLead[], agora: number): CrmGrupoHoje[] {
  const itens: Record<CrmGrupoHojeId, CrmItemHoje[]> = { proximo: [], followup: [], resposta: [], revisar: [], proposta: [], enviar: [] };
  const hoje = diaSP(agora);
  const leitura = (lead: CrmLead) => (lead.leitura === "viu" ? "viu a mensagem" : "leitura desconhecida");
  for (const lead of leads) {
    const aberto = lead.etapa !== "ganho" && lead.etapa !== "perdido";
    const conversa = lead.links.whatsapp ? [{ rotulo: "Abrir conversa no WhatsApp", url: lead.links.whatsapp }] : [];
    if (aberto && lead.proximoPasso?.data) {
      const dia = dataDoDia(lead.proximoPasso.data);
      if (dia !== undefined && diaSP(dia) <= hoje) {
        const atraso = hoje - diaSP(dia);
        itens.proximo.push({
          leadId: lead.id,
          acao: lead.proximoPasso.texto,
          detalhe: atraso === 0 ? "Marcado para hoje." : `Marcado para ${formatarDia(lead.proximoPasso.data)}, ${atraso} dia${atraso === 1 ? "" : "s"} de atraso.`,
          links: conversa,
          ordem: diaSP(dia),
        });
      }
    }
    if (lead.followupHoje) {
      itens.followup.push({
        leadId: lead.id,
        acao: "Mandar follow-up",
        detalhe: `${textoDeDias(lead.diasNaEtapa, lead.produto === "prumo" ? "Convite enviado" : "Enviado")}, sem resposta · ${leitura(lead)}.`,
        links: conversa,
        ordem: Date.parse(lead.marcos.enviado ?? "") || 0,
      });
    }
    if (lead.respostaNova) {
      const t = Date.parse(lead.marcos.respondeu ?? "");
      const r = lead.resposta && lead.resposta.tipo !== "bot" ? lead.resposta : undefined;
      const segunda = lead.links.segunda
        ? [{ rotulo: lead.produto === "prumo" ? "Mandar o diagnóstico" : "Mandar o link do site", url: lead.links.segunda }] : [];
      itens.resposta.push({
        leadId: lead.id,
        acao: r?.tipo === "interesse" ? (lead.produto === "prumo" ? "Quer saber mais: mandar o diagnóstico" : "Quer ver: mandar o link do site")
          : "Responder no WhatsApp",
        detalhe: [
          Number.isFinite(t) ? `${textoDeDias(dias(t, agora), "Respondeu")}.` : "Escreveu por último.",
          ...(r?.trecho ? [`“${r.trecho}”`] : []),
        ].join(" "),
        links: r?.tipo === "interesse" ? [...segunda, ...conversa] : [...conversa, ...segunda],
        ordem: Number.isFinite(t) ? t : 0,
      });
    }
    if (lead.sinal === "revisar") {
      itens.revisar.push({
        leadId: lead.id,
        acao: "Ver o site e decidir o convite",
        detalhe: `${lead.nicho || "Sem segmento"}${lead.cidade ? ` · ${lead.cidade}` : ""} · ${textoDeDias(lead.diasNaEtapa, "encontrado") || "sem data"}.`,
        links: [
          ...(lead.links.site ? [{ rotulo: "Ver o site da empresa", url: lead.links.site }] : []),
          ...(lead.links.convite ? [{ rotulo: "Enviar convite (marca como enviado)", url: lead.links.convite }] : []),
        ],
        ordem: Date.parse(lead.desde ?? "") || 0,
      });
    }
    if (lead.etapa === "proposta") {
      const n = lead.diasNaEtapa ?? 0;
      itens.proposta.push({
        leadId: lead.id,
        acao: n >= DIAS_ATE_FOLLOWUP ? "Cobrar retorno da proposta" : "Aguardar retorno da proposta",
        detalhe: `${textoDeDias(lead.diasNaEtapa, "Proposta enviada") || "Proposta enviada"}.`,
        links: conversa,
        ordem: Date.parse(lead.desde ?? "") || 0,
      });
    }
    if (lead.sinal === "pronto") {
      itens.enviar.push({
        leadId: lead.id,
        acao: lead.links.enviar ? "Enviar o site pelo WhatsApp" : "Sem WhatsApp válido na planilha",
        detalhe: `${lead.nicho || "Sem nicho"}${lead.cidade ? ` · ${lead.cidade}` : ""} · ${textoDeDias(lead.diasNaEtapa, "pronto") || "sem data"}.`,
        links: [
          ...(lead.links.enviar ? [{ rotulo: "Enviar pelo WhatsApp (marca como enviado)", url: lead.links.enviar }] : []),
          ...(lead.links.site ? [{ rotulo: "Ver o demo", url: lead.links.site }] : []),
        ],
        // Quem dá para enviar com um toque vem antes; dentro de cada parte, o mais antigo primeiro.
        ordem: (lead.links.enviar ? 0 : 1e13) + (Date.parse(lead.desde ?? "") || 0),
      });
    }
  }
  return GRUPOS_DE_HOJE.map((grupo) => ({
    ...grupo,
    itens: itens[grupo.id].sort((a, b) => a.ordem - b.ordem),
  }));
}

// ------------------------------------------------------------------ visão

function contagemVazia(): Record<CrmEtapa, CrmContagem> {
  return Object.fromEntries(ETAPAS.map((etapa) => [etapa, { total: 0, site: 0, prumo: 0 }])) as Record<CrmEtapa, CrmContagem>;
}

export function visaoSemRetrato(agora: Date, estado: "sem-retrato" | "retrato-invalido", mensagem: string, contexto: Partial<ContextoDoCrm> = {}): CrmVisao {
  return {
    estado,
    mensagem,
    minutosAteVelho: MINUTOS_ATE_RETRATO_VELHO,
    fontes: [],
    colunasAusentes: [],
    contagens: contagemVazia(),
    perdas: { recusou: 0, expirou: 0, descartado: 0, semInteresse: 0 },
    hoje: montarHoje([], agora.getTime()),
    leads: [],
    divergencias: 0,
    pastasSemLinha: [],
    pastasLidas: Boolean(contexto.pastas),
    ...(contexto.gerador ? { gerador: contexto.gerador } : {}),
    registro: contexto.registroDisponivel ?? { disponivel: false, motivo: "Registro não configurado." },
    links: {},
    ...(contexto.ultimaFalha ? { ultimaFalha: contexto.ultimaFalha } : {}),
  };
}

/** Função pura: retrato + pastas + Mapas -> visão do CRM. Os testes chamam só esta. */
export function montarCrm(retrato: CrmRetrato, contexto: ContextoDoCrm): CrmVisao {
  const agora = contexto.agora.getTime();
  const pastasLidas = Array.isArray(contexto.pastas);
  const pastaPorId = new Map<string, PastaDoLead>();
  for (const pasta of contexto.pastas ?? []) {
    if (!pasta.placeId) continue;
    const atual = pastaPorId.get(pasta.placeId);
    // Lead com duas pastas: vale a que tem site publicado.
    if (!atual || (!atual.artefatos.publicado && pasta.artefatos.publicado)) pastaPorId.set(pasta.placeId, pasta);
  }
  const registros = registrosPorLead(retrato);
  const mapas = new Map((contexto.mapas ?? []).map((mapa) => [mapa.prospectId, mapa]));
  const idsDoSite = new Set<string>();
  const leads: CrmLead[] = [];
  for (const linha of retrato.fontes.site.linhas) {
    const lead = leadDoSite(linha, { agora, pastaPorId, registros, links: retrato.links, pastasLidas });
    if (!lead || idsDoSite.has(lead.chave)) continue;
    idsDoSite.add(lead.chave);
    leads.push(lead);
  }
  const idsDoPrumo = new Set<string>();
  for (const linha of retrato.fontes.prumo.linhas) {
    const lead = leadDoPrumo(linha, { agora, registros, links: retrato.links, mapas });
    if (!lead || idsDoPrumo.has(lead.chave)) continue;
    idsDoPrumo.add(lead.chave);
    leads.push(lead);
  }
  const contagens = contagemVazia();
  for (const lead of leads) {
    contagens[lead.etapa].total += 1;
    contagens[lead.etapa][lead.produto] += 1;
  }
  const pastasSemLinha = (contexto.pastas ?? [])
    .filter((pasta) => pasta.placeId && !idsDoSite.has(pasta.placeId) && pasta.lugar !== "_descartados")
    .map((pasta) => `${pasta.lugar ? `${pasta.lugar}/` : ""}${pasta.slug}`)
    .sort();
  return {
    estado: "ok",
    geradoEm: retrato.geradoEm,
    minutosAteVelho: MINUTOS_ATE_RETRATO_VELHO,
    fontes: (["site", "prumo", "registros"] as const).map((id) => ({
      id,
      nome: id === "site" ? "Leads — Site antes da venda" : id === "prumo" ? "PRUMO — Prospects" : "Aba CRM (notas e próximos passos)",
      linhas: retrato.fontes[id].linhas.length,
      ...(retrato.fontes[id].erro ? { erro: retrato.fontes[id].erro } : {}),
    })),
    colunasAusentes: [
      ...colunasAusentes(COLUNAS_DO_SITE, retrato.fontes.site.colunas, "Leads"),
      ...colunasAusentes(COLUNAS_DO_PRUMO, retrato.fontes.prumo.colunas, "Prospects"),
    ],
    contagens,
    perdas: {
      recusou: leads.filter((l) => l.motivoPerda === "recusou").length,
      expirou: leads.filter((l) => l.motivoPerda === "expirou").length,
      descartado: leads.filter((l) => l.motivoPerda === "descartado").length,
      semInteresse: leads.filter((l) => l.motivoPerda === "sem-interesse").length,
    },
    hoje: montarHoje(leads, agora),
    leads,
    divergencias: leads.filter((lead) => lead.divergencias.length).length,
    pastasSemLinha,
    pastasLidas,
    ...(contexto.gerador ? { gerador: contexto.gerador } : {}),
    registro: contexto.registroDisponivel ?? { disponivel: false, motivo: "Registro não configurado." },
    links: retrato.links,
    ...(contexto.ultimaFalha && Date.parse(contexto.ultimaFalha.em) > Date.parse(retrato.geradoEm) ? { ultimaFalha: contexto.ultimaFalha } : {}),
  };
}

// ------------------------------------------------------------------ registro (nota, próximo passo, proposta)

export interface CrmRegistroEntrada {
  produto: CrmProduto;
  id: string;
  tipo: CrmTipoDeRegistro;
  texto: string;
  data: string;
}

export class RegistroInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistroInvalido";
  }
}

export class RegistroIndisponivel extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistroIndisponivel";
  }
}

export class RegistroFalhou extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "RegistroFalhou";
  }
}

function hojeEmSP(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export function validarRegistro(entrada: unknown, agora: Date): CrmRegistroEntrada {
  const corpo = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, unknown>;
  const produto = corpo.produto;
  if (produto !== "site" && produto !== "prumo") throw new RegistroInvalido("Produto inválido.");
  const id = typeof corpo.id === "string" ? corpo.id.trim() : "";
  if (!/^[A-Za-z0-9_-]{3,200}$/.test(id)) throw new RegistroInvalido("Lead inválido.");
  const tipo = corpo.tipo as CrmTipoDeRegistro;
  if (!TIPOS_DE_REGISTRO.includes(tipo)) throw new RegistroInvalido("Tipo de registro inválido.");
  const bruto = typeof corpo.texto === "string" ? corpo.texto.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim() : "";
  if (bruto.length > 1000) throw new RegistroInvalido("O texto deve ter no máximo 1000 caracteres.");
  // Texto vai como está: o n8n grava com cellFormat RAW, então "=..." fica texto e nunca vira fórmula.
  const textoSeguro = bruto;
  if (tipo === "nota" && !textoSeguro) throw new RegistroInvalido("Escreva a nota.");
  let data = typeof corpo.data === "string" ? corpo.data.trim() : "";
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new RegistroInvalido("Data inválida (use AAAA-MM-DD).");
  if (data && !Number.isFinite(Date.parse(`${data}T12:00:00-03:00`))) throw new RegistroInvalido("Data inválida.");
  if (tipo === "proximo_passo" && textoSeguro && !data) throw new RegistroInvalido("Informe a data do próximo passo.");
  if (tipo === "proposta" && !data) data = hojeEmSP(agora);
  if (tipo === "nota" || tipo === "proposta_desfeita" || tipo === "sem_contato" || tipo === "sem_contato_desfeito") data = "";
  return { produto, id, tipo, texto: textoSeguro, data };
}

export interface ConfigDoCrm {
  retrato: string;
  registroUrl?: string;
  segredoArquivo?: string;
  autoDirectory?: string;
  entregasPrumo?: string;
}

function ehLoopback(url: URL): boolean {
  return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}

export function configDoCrm(bruto: unknown, autoDirectory?: string, home = os.homedir()): ConfigDoCrm {
  const entrada = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const caminho = (valor: unknown, padrao: string) => path.resolve(typeof valor === "string" && valor.trim() ? valor.trim() : padrao);
  let registroUrl: string | undefined = typeof entrada.registroUrl === "string" && entrada.registroUrl.trim()
    ? entrada.registroUrl.trim()
    : "http://127.0.0.1:5679/webhook/crm-registro";
  const url = new URL(registroUrl);
  // A Central só fala com o n8n local; a tailnet é para o navegador, não para o servidor.
  if (url.protocol !== "http:" || !ehLoopback(url)) throw new Error("crm.registroUrl deve apontar para o n8n em loopback (http://127.0.0.1:...).");
  registroUrl = url.href;
  return {
    retrato: caminho(entrada.retrato, path.join(home, ".local/share/n8n-estado/crm.json")),
    registroUrl,
    segredoArquivo: caminho(entrada.segredoArquivo, path.join(home, ".config/claude-ops/crm-segredo")),
    ...(autoDirectory ? { autoDirectory } : {}),
    entregasPrumo: caminho(entrada.entregasPrumo, path.join(home, "prumo-entregas")),
  };
}

async function lerMapas(diretorio: string | undefined): Promise<MapaDoPrumo[]> {
  if (!diretorio) return [];
  let pastas: string[];
  try {
    pastas = (await fs.readdir(diretorio, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const mapas: MapaDoPrumo[] = [];
  for (const pasta of pastas.slice(0, 500)) {
    try {
      const dados = JSON.parse(await fs.readFile(path.join(diretorio, pasta, "dados.json"), "utf8")) as Record<string, unknown>;
      const prospectId = texto(dados.prospect_id, 200);
      const geradoEm = texto(dados.gerado_em, 64);
      // Ensaios (teste: true) não são de lead nenhum.
      if (!prospectId || dados.teste === true || !Number.isFinite(Date.parse(geradoEm))) continue;
      mapas.push({ prospectId, geradoEm, pasta: `~/prumo-entregas/${pasta}` });
    } catch {
      continue;
    }
  }
  return mapas;
}

export class CrmStore {
  constructor(readonly config: ConfigDoCrm, private readonly fetcher: typeof fetch = fetch) {}

  private async segredo(): Promise<string | undefined> {
    if (!this.config.segredoArquivo) return undefined;
    try {
      const valor = (await fs.readFile(this.config.segredoArquivo, "utf8")).trim();
      return valor || undefined;
    } catch (error: any) {
      if (error?.code === "ENOENT" || error?.code === "EACCES") return undefined;
      throw error;
    }
  }

  private async disponibilidade(): Promise<{ disponivel: boolean; motivo?: string }> {
    if (!this.config.registroUrl) return { disponivel: false, motivo: "Registro não configurado." };
    return (await this.segredo())
      ? { disponivel: true }
      : { disponivel: false, motivo: "Falta o segredo do registro (~/.config/claude-ops/crm-segredo): rode claude-ops/crm.py." };
  }

  /** crm-falha.json, ao lado do retrato: o fluxo grava quando não consegue ler Leads ou Prospects. */
  private async ultimaFalha(): Promise<{ em: string; erro: string } | undefined> {
    try {
      const dados = JSON.parse(await fs.readFile(path.join(path.dirname(this.config.retrato), "crm-falha.json"), "utf8")) as Record<string, unknown>;
      const em = texto(dados.falhouEm, 64);
      return Number.isFinite(Date.parse(em)) ? { em: new Date(em).toISOString(), erro: texto(dados.erro, 300) || "sem detalhe" } : undefined;
    } catch {
      return undefined;
    }
  }

  private async lerRetrato(): Promise<string | null> {
    try {
      return await fs.readFile(this.config.retrato, "utf8");
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async visao(agora = new Date()): Promise<CrmVisao> {
    const [leitura, mapas, registroDisponivel, ultimaFalha] = await Promise.all([
      this.config.autoDirectory ? lerPastasDosLeads(this.config.autoDirectory).catch((error) => {
        console.error("[crm] Falha ao ler ~/auto-site:", error);
        return undefined;
      }) : Promise.resolve(undefined),
      lerMapas(this.config.entregasPrumo).catch(() => []),
      this.disponibilidade(),
      this.ultimaFalha(),
    ]);
    const contexto: ContextoDoCrm = {
      agora,
      ...(leitura ? { pastas: leitura.pastas, gerador: leitura.gerador } : {}),
      mapas,
      registroDisponivel,
      ...(ultimaFalha ? { ultimaFalha } : {}),
    };
    let bruto = await this.lerRetrato();
    if (bruto === null) {
      return visaoSemRetrato(agora, "sem-retrato", "O fluxo 08 · CRM do n8n ainda não gravou o retrato (crm.json).", contexto);
    }
    try {
      let dados: unknown;
      try {
        dados = JSON.parse(bruto);
      } catch {
        // O n8n grava por cima (sem rename): uma leitura no meio da escrita vem cortada. Tenta mais uma vez.
        await new Promise((resolve) => setTimeout(resolve, 250));
        bruto = (await this.lerRetrato()) ?? "";
        dados = JSON.parse(bruto);
      }
      return montarCrm(validarRetrato(dados), contexto);
    } catch (error) {
      if (error instanceof RetratoInvalido || error instanceof SyntaxError) {
        return visaoSemRetrato(agora, "retrato-invalido", `crm.json ilegível: ${error.message}`, contexto);
      }
      throw error;
    }
  }

  /** Nota, próximo passo ou proposta: vai para a aba CRM da planilha pelo n8n. A Central não guarda nada. */
  async registrar(entrada: unknown, agora = new Date()): Promise<{ ok: true; em: string }> {
    const registro = validarRegistro(entrada, agora);
    const visao = await this.visao(agora);
    const lead = visao.leads.find((item) => item.id === `${registro.produto}:${registro.id}`);
    if (!lead) throw new RegistroInvalido("Lead não encontrado no retrato atual do CRM.");
    if (registro.tipo === "proposta" && lead.etapa === "proposta") throw new RegistroInvalido("Este lead já está em Proposta.");
    if (registro.tipo === "proposta_desfeita" && lead.etapa !== "proposta") throw new RegistroInvalido("Este lead não está em Proposta.");
    if (registro.tipo === "sem_contato" && (lead.etapa === "ganho" || lead.etapa === "perdido")) throw new RegistroInvalido("Este lead já está encerrado.");
    if (registro.tipo === "sem_contato_desfeito" && lead.motivoPerda !== "sem-contato") throw new RegistroInvalido("Este lead não foi perdido por falta de contato.");
    if (registro.tipo === "proposta" && (lead.etapa === "ganho" || lead.etapa === "perdido")) {
      throw new RegistroInvalido("Lead já encerrado: desfaça o desfecho na página do lead antes.");
    }
    const segredo = await this.segredo();
    if (!this.config.registroUrl || !segredo) throw new RegistroIndisponivel((await this.disponibilidade()).motivo ?? "Registro indisponível.");
    let resposta: Response;
    try {
      resposta = await this.fetcher(this.config.registroUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CRM": segredo },
        body: JSON.stringify({ ...registro, empresa: lead.empresa }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new RegistroFalhou("O n8n não respondeu. Nada foi confirmado na planilha.", null);
    }
    const corpo = await resposta.json().catch(() => ({})) as Record<string, unknown>;
    if (resposta.status === 401 || resposta.status === 403) throw new RegistroFalhou("O n8n recusou o segredo do registro.", resposta.status);
    if (resposta.status === 404) throw new RegistroFalhou("O fluxo 08 · CRM não está ativo no n8n.", resposta.status);
    if (!resposta.ok || corpo.ok !== true) {
      throw new RegistroFalhou(typeof corpo.erro === "string" ? corpo.erro.slice(0, 200) : `O n8n não gravou (HTTP ${resposta.status}).`, resposta.status);
    }
    return { ok: true, em: typeof corpo.em === "string" ? corpo.em : agora.toISOString() };
  }
}
