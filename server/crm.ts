import fs from "node:fs/promises";
import { PREFIXO_QUALIFICACAO_COMERCIAL, lerNotaQualificacaoComercial, textoDaQualificacaoComercial, projetarQualificacaoComercial, qualificacaoComercialAtual, temQualificacaoComercial, type QualificacaoComercial } from '../src/operations/qualificacao-comercial.ts';
import { PREFIXO_CICLO, lerEventoCiclo, textoEventoCiclo, cicloDoLead } from '../src/operations/ciclo-comercial.ts';
import { RegistroComercialDuravel, hashCanonicoComercial, type ChaveComercial, type FatoComercialNaFonte } from './registro-comercial-duravel.ts';
import { validarTransicaoDoCicloComercial } from './ciclo-comercial.ts';
import { qualificadoParaProposta } from '../src/operations/spiced.ts';
import { lerRegistroSpiced, type Spiced } from '../src/operations/spiced.ts';
import { cadenciaDoLead, cadenciaJaConfirmada, lerRegistroCadencia } from '../src/operations/cadencia.ts';
import { lerRegistroFollowup } from '../src/operations/followup-experimento.ts';
import { alocarAberturasPrumo } from '../src/operations/abertura-prumo.ts';
import { TIPOS_AARR, aarrDoLead, chaveDoPagamento, contratosMensais, ehTipoAarr, indicacaoPendente, lerRegistroAarr, registroCompativelComLead, resumoDoRegistroAarr, type ReceitaDoLead, type ReceitaDesfeita, type RegistroReceita, type RegistroRetencao, type RegistroIndicacao } from '../src/operations/aarr.ts';
import { contatoPausado } from '../src/operations/aprendizado-comercial.ts';
import { protecaoDaDemo, revisaoComercialDoLead } from "./protecao-comercial.ts";
import { revisaoDaClassificacao, ultimoConviteConfirmado, PREFIXO_CONVITE_TIME } from '../src/operations/decisoes-comerciais.ts';
import { mensagemDoConvite } from './convite-mensagem.ts';
import os from "node:os";
import path from "node:path";
import { chaveDoNumero, enviosComAConversa, lerConversas, pastaDasConversas, resumirConversa, saidasDaConversa, type MensagemDaConversa, type ResumoDaConversa } from "./conversa-do-lead.ts";
import { pedeMaterial, textoParaATela } from "../src/operations/marcadores-da-conversa.ts";
import { quemRespondeu } from '../src/operations/resultados.ts';
import { classificarResposta, respostaParaAcompanhamento, ROTULOS_DA_CLASSIFICACAO, type ClassificacaoDaResposta } from '../src/operations/classificacao-resposta.ts';
import { achadosDoRecibo, lerPastasDosLeads, type AchadoDoRaioX, type GeradorDeSites, type LugarDaPasta, type PastaDoLead } from "./auto-production.ts";
import { followupDoPlus, primeiraDoPlus } from "./plus-mensagem.ts";
import type { LeadPlus, OfertaDoPlus } from "./plus-catalogo.ts";
import { reenvioDoPrumo, segundaDoPrumo } from "./prumo-mensagem.ts";
import { ROTULO_DO_FOLLOWUP, ROTULO_DO_REENVIO, followupDe, raioXAvulso, reenvioDoRoboDe, segundaDe } from "./site-mensagem.ts";
import { bracoDoRecibo, entraNoTesteDoRecibo, type BracoDoRecibo } from "../src/operations/ab-recibo.ts";
import { ajusteDaPrioridade, ehSiteProprio, extrairSinais, type SinaisDoSite } from "./sinais-do-site.ts";

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
//
// PRUMO como holding (14/10/2026, decisão do Rômulo): o PRUMO fica sob o SquadOne
// e tudo o que ele prospecta fica sob o PRUMO, no mesmo funil: Site antes da
// venda (auto-site), os serviços do PRUMO, o Iris (clínicas) e o CRM de
// estamparia. As duas ofertas novas usam o contrato de colunas do Prospects
// (COLUNAS_DO_PRUMO), cada uma na sua aba da planilha do PRUMO (Clínicas,
// Estamparias), e a mesma regra de etapa (etapaDoPrumo).

// "Em contato" (08/10/2026) juntou Contatado e Conversando: a coluna de
// Conversando passava dias vazia e a de Contatado acumulava quem não respondia
// havia uma semana. Uma coluna, um critério: DIAS_SEM_RESPOSTA.
export const ETAPAS = ["novo", "contato", "proposta", "ganho", "perdido"] as const;
export type CrmEtapa = (typeof ETAPAS)[number];
// "plus" (15/10/2026): os leads do Catálogo de Negócios Maçônicos, abordados com a saudação da Ordem. Não é
// uma quinta oferta: cada um carrega a oferta que recebe (site, prumo, iris, estampa) em `plus.oferta`. Vem de
// um arquivo (plus/leads.json), não de planilha; o estado dele sai só dos registros da aba CRM.
export const PRODUTOS = ["site", "prumo", "iris", "estampa", "plus"] as const;
export type CrmProduto = (typeof PRODUTOS)[number];
/** As ofertas que saem de uma aba no formato do Prospects (Etapa, convite, WhatsApp publicado no site). */
export const PRODUTOS_DE_PROSPECCAO = ["prumo", "iris", "estampa"] as const;
export type CrmProdutoDeProspeccao = (typeof PRODUTOS_DE_PROSPECCAO)[number];
export const ehProduto = (valor: unknown): valor is CrmProduto => (PRODUTOS as readonly unknown[]).includes(valor);

export const ROTULO_DA_ETAPA: Record<CrmEtapa, string> = {
  novo: "Novo",
  contato: "Em contato",
  proposta: "Proposta",
  ganho: "Ganho",
  perdido: "Perdido",
};

export const ROTULO_DO_PRODUTO: Record<CrmProduto, string> = {
  site: "Site antes da venda",
  prumo: "Serviços PRUMO",
  iris: "Iris · Clínicas",
  estampa: "CRM de estamparia",
  plus: "Plus",
};

/** De onde vem cada oferta de prospecção: aba, quem encontrou e qual link da planilha ela usa. */
export const OFERTA_DE_PROSPECCAO: Record<CrmProdutoDeProspeccao, {
  aba: string; cacador: string; link: "planilhaPrumo" | "planilhaIris" | "planilhaEstampa";
}> = {
  prumo: { aba: "Prospects", cacador: "Encontrado pelo Lead Scout", link: "planilhaPrumo" },
  iris: { aba: "Clínicas", cacador: "Encontrado pelo Caçador do Iris", link: "planilhaIris" },
  estampa: { aba: "Estamparias", cacador: "Encontrado pelo Caçador de estamparias", link: "planilhaEstampa" },
};

/** Follow-up, expiração e mudança automática de pasta só valem para envio a partir daqui (site-antes-da-venda.py). */
export const CORTE_DO_ACOMPANHAMENTO = "2026-09-29T00:00:00-03:00";
export const DIAS_ATE_FOLLOWUP = 3;
/**
 * A regra do CRM (08/10/2026, pedido do Rômulo: "7 ou 8 dias sem falar, é claro que não funcionou"):
 * Em contato sem mensagem do lead há tantos dias — da última resposta, ou do envio se ele nunca
 * respondeu — vai para Perdido. Vale para Site (acervo incluído) e PRUMO.
 */
export const DIAS_SEM_RESPOSTA = 7;
/**
 * A regra da PLANILHA: o 05 · Acompanhamento marca "expirado" e o site-pastas move a pasta. Desde 19/10/2026 é
 * o mesmo 7º dia do CRM (era o 10º, e as duas contas se desencontravam); a constante só serve para mostrar a
 * data estimada e a folga da divergência de pasta.
 */
export const DIAS_ATE_EXPIRAR = DIAS_SEM_RESPOSTA;
/** Resposta "nova" para a lista Hoje quando não há colunas de última entrada/saída. */
export const HORAS_DE_RESPOSTA_NOVA = 48;
/** Retrato mais velho que isto aparece como desatualizado (o fluxo roda a cada 10 min). */
export const MINUTOS_ATE_RETRATO_VELHO = 30;
/** Pastas mudam de lugar pelo site-pastas depois do Balcão (de hora em hora): folga antes de chamar de divergência. */
const FOLGA_DAS_PASTAS_MS = 2 * 60 * 60 * 1000;

const ehNotaComercial = (v: unknown): v is string => typeof v === 'string' && (v.startsWith(PREFIXO_CICLO) || v.startsWith(PREFIXO_QUALIFICACAO_COMERCIAL));
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
  // O link do Raio-X (Balcão, 08/10/2026): a segunda mensagem de quem recebeu a variação C o manda.
  // Sem a coluna, a segunda sai a do site, como antes: não é aviso na tela.
  raioXUrl: { nomes: ["raio_x_url"] },
  // O braço do A/B do vídeo no envio (11/10/2026, src/operations/ab-video.ts): "video" = mande o
  // vídeo à mão depois da mensagem; vazia = sem vídeo. Preenchida à mão; sem a coluna, nada muda.
  bracoVideo: { nomes: ["braco_video"] },
  // As letras que o lead podia receber no sorteio (Balcão, 14/10/2026: "A", "AB", "AC", "ABC"; a D entrou depois: "AD", "ACD", "ABCD"). É o
  // que diz com quem a letra pode ser comparada (src/operations/ab-mensagem.ts). Não é esperada:
  // ausente, o lead fica fora do A/B estratificado e nada mais muda.
  abElegiveis: { nomes: ["ab_elegiveis"] },
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
  // Caçadores do Iris e das estamparias (14/10/2026): ordenam e explicam a revisão. Ausentes no
  // Prospects, que não as tem: nada muda para o PRUMO.
  prioridade: { nomes: ["prioridade"] },
  sinais: { nomes: ["sinais"] },
  origemWhatsapp: { nomes: ["origem_do_whatsapp"] },
  nota: { nomes: ["nota_google"] },
  maps: { nomes: ["google_maps"] },
  indice: { nomes: ["indice_prumo"] },
  respostaTipo: { nomes: ["tipo_da_resposta"] },
  respostaTrecho: { nomes: ["resposta"] },
  respostaEm: { nomes: ["resposta_em"] },
  // Porte pelo CNPJ (15/10/2026): o 08 · CRM tira "EPP" ou "DEMAIS" do Briefing que o filtro de porte do
  // Lead Scout grava (claude-ops/prumo-porte-cnpj.js) e manda só isso (o Briefing inteiro fica fora do
  // retrato). Vazia = porte não conferido. Retrato antigo, sem a coluna: igual a vazia.
  porte: { nomes: ["porte"] },
  linha: { nomes: ["row_number"] },
} satisfies Record<string, Coluna>;

/**
 * As classes da Receita que o filtro de porte deixa passar (claude-ops/prumo-porte-cnpj.js: "Alvo: PME
 * de 8 a 40 pessoas, que já fatura (EPP ou DEMAIS)"; MEI e microempresa vão para Descartados).
 */
export type PorteDoCnpj = "EPP" | "DEMAIS";

export function porteDaColuna(valor: string): PorteDoCnpj | undefined {
  const v = valor.trim().toUpperCase();
  return v === "EPP" || v === "DEMAIS" ? v : undefined;
}

/**
 * "exclusao" (07/10/2026): pediu para apagar o demo ou o conteúdo; para o funil é uma negativa.
 * "licenca" (17/10/2026, a Baobá): o "pode enviar sim" a "posso mandar o vídeo?" é permissão para mandar
 * o material, não um "quero ver" dito. Fica na vez de responder até o material sair (como o interesse
 * parado) e, nas métricas, conta como o interesse contava (pedeMaterial): até 17/10 o mesmo "pode mandar"
 * era gravado como interesse, e separar o tipo não pode encolher o "quero ver". A diferença fica só na
 * frase e na tática do cartão (não promete demonstração).
 */
export const TIPOS_DE_RESPOSTA = ["negativa", "exclusao", "interesse", "licenca", "neutra", "bot"] as const;
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
  licenca: "Deixou mandar",
  neutra: "Sem sim nem não",
  bot: "Só resposta automática",
};

/** A resposta pede que algo saia daqui (o link, o Raio-X, o material): a regra única mora com a tela. */
export { pedeMaterial };

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

/**
 * `segunda_enviada` e `followup_enviado` (14/10/2026): o toque em "Mandar o link" e em "Mandar o
 * follow-up" anota o envio. Sem isso o CRM não sabia se a 2ª mensagem saiu (o interesse sumia da Hoje
 * em 48 h, com ou sem o link) nem se o follow-up do 3º dia foi mandado (não dava para medir se funciona).
 */
export const TIPOS_DE_REGISTRO = ["nota", "proximo_passo", "proposta", "proposta_desfeita", "sem_contato", "sem_contato_desfeito",
  ...TIPOS_AARR,
  "spiced", "cadencia_enviada",
  "segunda_enviada", "followup_enviado", "plus_enviado", "plus_respondeu", "recusou", "recusou_desfeito",
  "ganhou", "ganhou_desfeito", "dispensado", "dispensado_desfeito"] as const;
/**
 * `recusou` (16/10/2026, OT-06 do blueprint): o desfecho marcado na Central. Antes o "Recusou" do Site
 * só existia na página do lead (fluxo 07) e no PRUMO só na Etapa da planilha; com a conversa guardada e
 * a resposta classificada como negativa ou exclusão, a Próxima venda oferece marcar em um toque.
 *
 * `ganhou` (17/10/2026, AC-08): o "Fechou" marcado na Central, para todas as ofertas. Antes só o Site
 * tinha como fechar (a página do lead, fluxo 07) e o PRUMO só pela Etapa "Concluído" na planilha; o Plus,
 * sem planilha, não tinha caminho nenhum, e quem fechava ficava na fila recebendo follow-up.
 * `dispensado` (AC-10): o "Dispensar" da Triagem. Sem ele, o prospect que não serve só saía mudando a
 * Etapa na planilha à mão, e a Triagem (1.423 itens em 17/10) não diminuía.
 * Os dois têm o `_desfeito` do par: o último registro vale, como no sem_contato e no recusou.
 */
export const TIPOS_DE_DESFECHO_DATADO: ReadonlySet<CrmTipoDeRegistro> = new Set(["ganhou", "ganhou_desfeito", "dispensado", "dispensado_desfeito"]);
export type CrmTipoDeRegistro = (typeof TIPOS_DE_REGISTRO)[number];
/** Os registros que o toque num link de envio faz sozinho: um clique duplo não pode virar dois envios. */
export const TIPOS_DE_ENVIO: ReadonlySet<CrmTipoDeRegistro> = new Set(["segunda_enviada", "followup_enviado", "plus_enviado"]);
/** O mesmo envio anotado de novo dentro disto é o mesmo toque (clique duplo, aba duplicada), não um envio novo. */
export const JANELA_DE_REPETICAO_MS = 2 * 60 * 1000;
/** Passado isto do "quero ver", a 2ª mensagem que não saiu vira urgência na Hoje. */
export const HORAS_ATE_URGENTE = 2;

/**
 * O texto da 1ª mensagem pela data do envio, a mesma regra de `regime_da_mensagem` em
 * deploy/dell/funil-aprendizado.py (site-mensagem.js no git): até 29/09 a curta com link,
 * de 30/09 a 04/10 a do PRUMO com link, desde 05/10 o pedido de licença sem link (o link vai na 2ª).
 * Datas de São Paulo. Envios sem `mensagem_variante` (150 de 221 em 14/10/2026) só têm isto.
 */
export const REGIMES_DA_MENSAGEM = ["curta_com_link", "prumo_com_link", "duas_mensagens"] as const;
export type CrmRegimeDaMensagem = (typeof REGIMES_DA_MENSAGEM)[number];
const CORTE_PRUMO_COM_LINK = Date.parse("2026-09-30T00:00:00-03:00");
const CORTE_DUAS_MENSAGENS = Date.parse("2026-10-05T00:00:00-03:00");

export function regimeDaMensagem(enviado: number | undefined): CrmRegimeDaMensagem | undefined {
  if (enviado === undefined) return undefined;
  if (enviado >= CORTE_DUAS_MENSAGENS) return "duas_mensagens";
  if (enviado >= CORTE_PRUMO_COM_LINK) return "prumo_com_link";
  return "curta_com_link";
}

export function normalizarCabecalho(nome: string): string {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

type Linha = Record<string, string>;

export type BracoVideo = "video" | "sem-video";

/**
 * A coluna `braco_video` como a planilha a tiver: "video", "vídeo", "com vídeo" = braço com vídeo;
 * qualquer outro texto ("sem-video", "não") = braço sem vídeo marcado; vazia = ausente, que conta
 * como sem vídeo (quem entra no teste: src/operations/ab-video.ts).
 */
export function bracoDaColuna(valor: string): BracoVideo | undefined {
  const normalizado = normalizarCabecalho(valor);
  if (!normalizado) return undefined;
  return normalizado === "video" || normalizado === "com_video" ? "video" : "sem-video";
}

/**
 * A coluna `ab_elegiveis` como o Balcão a grava ("AB"), tolerante a caixa, espaço e ordem ("b a").
 * O mesmo critério de `normalizarElegiveis` em site-mensagem.js: letra fora de A/B/C invalida a
 * célula inteira (undefined), porque um conjunto adivinhado poria o lead no estrato errado.
 */
export function elegiveisDaColuna(valor: string): string | undefined {
  const t = valor.toUpperCase().replace(/[^A-Z]/g, "");
  if (!t || [...t].some((l) => !"ABCD".includes(l))) return undefined;
  return ["A", "B", "C", "D"].filter((l) => t.includes(l)).join("");
}

/** Acesso tolerante: cabeçalho renomeado, com acento ou ausente não derruba nada. */
function leitor<T extends Record<string, Coluna>>(colunas: T, linha: Record<string, unknown>) {
  const porNome = new Map<string, string>();
  for (const [chave, valor] of Object.entries(linha)) porNome.set(normalizarCabecalho(chave), normalizarCabecalho(chave) === 'texto' && ehNotaComercial(valor) ? valor : texto(valor));
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
  links: { webhook?: string; planilhaSite?: string; planilhaPrumo?: string; planilhaIris?: string; planilhaEstampa?: string; planilhaCrm?: string };
  /** `iris` e `estampa` (14/10/2026): ausentes num retrato antigo, viram fonte vazia com o aviso. */
  fontes: { site: CrmFonte; prumo: CrmFonte; iris: CrmFonte; estampa: CrmFonte; registros: CrmFonte };
}

const LINKS_DO_RETRATO = ["webhook", "planilhaSite", "planilhaPrumo", "planilhaIris", "planilhaEstampa", "planilhaCrm"] as const;

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
    .map((linha) => {
      const spiced = Object.entries(linha).some(([k, v]) => normalizarCabecalho(k) === 'tipo' && v === 'spiced');
      return Object.fromEntries(Object.entries(linha).slice(0, 80).map(([k, v]) => [texto(k, 80),
        normalizarCabecalho(k) === 'texto' && ehNotaComercial(v) ? v : spiced && normalizarCabecalho(k) === 'texto' && !lerRegistroSpiced(v) ? '' : texto(v)]));
    });
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
    links: Object.fromEntries(LINKS_DO_RETRATO
      .map((nome) => [nome, linkLimpo(nome)]).filter(([, v]) => v)) as CrmRetrato["links"],
    fontes: {
      site: lerFonte(fontes.site, "site"),
      prumo: lerFonte(fontes.prumo, "prumo"),
      iris: lerFonte(fontes.iris, "iris"),
      estampa: lerFonte(fontes.estampa, "estampa"),
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

/** Limite do texto que a fila de envio mostra: a primeira mensagem tem ~300 caracteres. */
export const MAX_MENSAGEM_PRONTA = 1000;

/** Quanto tempo a visão do CrmStore vale antes de ser montada de novo (as leituras são pesadas e o retrato muda a cada ~10 min). */
export const TTL_DA_VISAO_MS = 20_000;

/**
 * O texto que o `wa_me` do Balcão põe no WhatsApp (`?text=`). A fila de envio da
 * Central mostra a mensagem antes do toque: o link abre o WhatsApp com o texto já preenchido, e
 * quem confere precisa vê-lo antes de enviar. (O clique no `wa_link` só grava `clique_em`; o envio
 * é marcado pelo observador quando a mensagem aparece na conversa.)
 */
export function textoDoWaMe(valor: string): string | undefined {
  try {
    const url = new URL(valor);
    if (url.hostname !== "wa.me" && url.hostname !== "api.whatsapp.com") return undefined;
    const t = (url.searchParams.get("text") ?? "").trim();
    return t ? t.slice(0, MAX_MENSAGEM_PRONTA) : undefined;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------ modelo

export type CrmOrigemDoEvento = "automático" | "manual";

export interface CrmEvento {
  registroTexto?: string;
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
  aarr?: ReceitaDoLead;
  revisaoComercial?: string;
  demoProtegida?: string;
  id: string;
  produto: CrmProduto;
  chave: string;
  empresa: string;
  nicho: string;
  cidade: string;
  etapa: CrmEtapa;
  sinal: CrmSinal;
  subEtapa: string;
  /** `expirou`: nunca respondeu em DIAS_SEM_RESPOSTA; `esfriou`: respondeu e parou de responder. */
  motivoPerda?: "recusou" | "expirou" | "esfriou" | "descartado" | "sem-interesse" | "sem-contato" | "proposta-sem-retorno";
  /** A perda marcada na Central (aba CRM), que dá para desfazer de lá: "sem contato fácil", "recusou" ou o "Dispensar" da Triagem. */
  perdaManual?: "sem-contato" | "recusou" | "dispensado";
  /** O ganho marcado na Central (registro `ganhou`, AC-08), que dá para desfazer de lá; o da planilha não entra. */
  ganhoManual?: boolean;
  /** Teste do follow-up sem recibo (OT-10): o braço do lead do Site enviado desde 17/10/2026 sem recibo. */
  testeDoRecibo?: BracoDoRecibo;
  /** Só em Em contato sem próximo passo: em quantos dias vai para Perdido se o lead não escrever (1 = amanhã). */
  diasParaSair?: number;
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
  /** `segundaEnviada`/`followupEnviado`: o último envio anotado na aba CRM (o toque no link da Central). */
  marcos: { enviado?: string; visto?: string; respondeu?: string; segundaEnviada?: string; followupEnviado?: string };
  followupHoje: boolean;
  /**
   * O follow-up de hoje é o reenvio único do só-robô (14/10/2026): `links.followup` leva o pedido da
   * pessoa certa, não o follow-up do 3º dia, e fora do expediente fica travado como um primeiro contato.
   */
  reenvioDoRobo?: true;
  respostaNova: boolean;
  /**
   * Disse que quer ver e a 2ª mensagem ainda não saiu (14/10/2026): fica em `respostaNova` sem o
   * limite de 48 h. `desde` é a resposta de interesse (ausente quando a planilha não dá a data).
   */
  interesseParado?: { desde?: string };
  /**
   * A conversa guardada pelo observador (16/10/2026), resumida: quem falou por último, o quê, e se o
   * link já saiu. Ausente = nenhuma mensagem guardada (antes de 16/10, ou ninguém escreveu desde então).
   */
  conversa?: ResumoDaConversa;
  classificacaoResposta?: ClassificacaoDaResposta;
  respostaFonte?: CrmResposta;
  acervo: boolean;
  proximoPasso?: { texto: string; data: string; registradoEm: string };
  proposta?: { em: string; data: string };
  spiced?: Spiced;
  qualificacaoComercial?: QualificacaoComercial;
  /** Site: o `site-demos-limpeza` apagou o projeto na Vercel; sem link de demo nem segunda mensagem até republicar. */
  demoApagadoEm?: string;
  /** Site, demo sob pedido (14/10/2026): o botão "Gerar demo" foi tocado e o gerador ainda não publicou. */
  demoPedidoEm?: string;
  /**
   * Caçadores do Iris e das estamparias (14/10/2026): Prioridade (0 a 100, ordena a revisão), os sinais
   * achados no site, a nota do Google e de onde veio o WhatsApp ("não confirmado: celular do Google" pede
   * conferência antes do convite). Ausentes nos outros produtos.
   */
  triagem?: { prioridade?: number; sinais?: string; nota?: string; origemWhatsapp?: string };
  /**
   * Os sinais do site do lead (17/10/2026, server/sinais-do-site.ts): lidos sob demanda pela Ficha, com
   * validade em disco. Cada um é `true`, `false` ou `null` (sem fonte). Ausente = o site ainda não foi
   * lido (ou o lead não tem site próprio para ler); no lead sem site no cadastro vem só `semSite: true`.
   */
  sinais?: SinaisDoSite;
  /** Plus (15/10/2026): a oferta que o lead recebe e o que o catálogo diz dele. O site, quando há, vai em `links.site`. */
  plus?: { oferta: OfertaDoPlus; fixo: boolean; descricao: string; instagram?: string; tambem?: string[] };
  /**
   * O que o Raio-X publicado achou (15/10/2026), na ordem de peso da página: Site, do `raio_x_achados`
   * do publicado.json; PRUMO, do leads.json do Raio-X à mão, quando ele traz `achados`. Raio-X mais
   * antigo não tem: ausente, a oferta segue a regra geral (src/operations/jornada.ts).
   */
  achados?: AchadoDoRaioX[];
  /** PRUMO: a classe da Receita pelo CNPJ do site (coluna `porte` do retrato). Ausente = não conferido. */
  porte?: PorteDoCnpj;
  /**
   * PRUMO: a empresa tem equipe (o alvo do Mapa)? `true` só com o porte conferido pelo CNPJ (EPP ou
   * DEMAIS, o alvo do filtro de porte). Nunca `false` por falta de dado: sem porte, ausente.
   */
  equipe?: boolean;
  notas: number;
  /** A última resposta classificada (só com o fluxo de 05/10/2026; antes disso, ausente). */
  resposta?: CrmResposta;
  /**
   * Site antes da venda, desde 07/10/2026: a variação da primeira mensagem (`mensagem_variante`:
   * A/B/C, EN, ou "manual") e a versão do site (`site_versao`). Ausente quando a planilha não diz.
   * `elegiveis` (14/10/2026): as letras do sorteio (`ab_elegiveis`: "A", "AB", "AC", "ABC").
   */
  abordagem?: { mensagem?: string; site?: string; video?: BracoVideo; regime?: CrmRegimeDaMensagem; elegiveis?: string };
  /** Só em `pronto` com link de envio: a primeira mensagem, como vai sair no WhatsApp (do `wa_me`). */
  mensagemPronta?: string;
  eventos: CrmEvento[];
  /** `segunda`: a mensagem depois do "sim" (Site: o link do site; PRUMO: o Raio-X, só quando ele existe). */
  /** `followup`: Site, só no dia do follow-up, o wa.me com o texto do aviso do 05 · Acompanhamento; no só-robô (Site e PRUMO), o reenvio (`reenvioDoRobo`). */
  /** `raioX`: PRUMO, a página do Raio-X do lead (índice em ~/prumo-entregas/prumo-raio-x/leads.json); Site, o `<demo>/raio-x` da coluna raio_x_url, ou o avulso (raio-x-prumo.vercel.app) de quem ainda não tem demo. */
  /** `gerarDemo`: Site sem demo (demo sob pedido), o toque que pede o demo (07 · Lead, acao=gerar_demo). */
  links: { site?: string; enviar?: string; whatsapp?: string; acoes?: string; convite?: string; segunda?: string; followup?: string; planilha?: string; raioX?: string; gerarDemo?: string; maps?: string };
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
  /** Interesse parado há mais de HORAS_ATE_URGENTE: a tela destaca. */
  urgente?: boolean;
}

export interface CrmGrupoHoje {
  id: CrmGrupoHojeId;
  titulo: string;
  explicacao: string;
  itens: CrmItemHoje[];
}

export type CrmContagem = { total: number } & Record<CrmProduto, number>;

export type CrmFonteId = CrmProduto | "registros";

/**
 * Sem instante da leitura de propósito: a resposta só muda quando o retrato, as
 * pastas ou o dia mudam (e, com interesse parado na Hoje, a hora do "há N h"), e o
 * ETag do Express devolve 304 ao celular no resto.
 * A idade do retrato é calculada na tela a partir de geradoEm.
 */
export interface CrmVisao {
  estado: "ok" | "sem-retrato" | "retrato-invalido";
  mensagem?: string;
  geradoEm?: string;
  minutosAteVelho: number;
  fontes: Array<{ id: CrmFonteId; nome: string; linhas: number; erro?: string }>;
  colunasAusentes: string[];
  contagens: Record<CrmEtapa, CrmContagem>;
  perdas: { recusou: number; expirou: number; esfriou: number; descartado: number; semInteresse: number };
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

/** Raio-X feito à mão para um lead do PRUMO (sem demo de site), publicado no projeto prumo-raio-x. */
export interface RaioXDoPrumo {
  prospectId: string;
  url: string;
  feitoEm: string;
  /** `achados` do leads.json, no formato do recibo do raio-x.py (`raio_x_achados`), quando quem fez à mão os anotou. */
  achados?: AchadoDoRaioX[];
}

/** Os leads Plus como o arquivo os traz, mais a data em que o catálogo foi importado. */
export interface PlusLido {
  geradoEm?: string;
  leads: LeadPlus[];
}

export interface ContextoDoCrm {
  agora: Date;
  pastas?: PastaDoLead[];
  gerador?: GeradorDeSites;
  mapas?: MapaDoPrumo[];
  raioX?: RaioXDoPrumo[];
  plus?: PlusLido;
  registroDisponivel?: { disponivel: boolean; motivo?: string };
  ultimaFalha?: { em: string; erro: string };
  /** As conversas guardadas pelo observador, pela chave do número (conversa-do-lead.ts). */
  conversas?: Map<string, MensagemDaConversa[]>;
  /** Os sinais do site já lidos, por id do lead, com o endereço lido (a leitura só vale para ele). */
  sinaisDoSite?: ReadonlyMap<string, { url: string; sinais: SinaisDoSite }>;
}

/**
 * A conversa de um lead e o que ela muda nos envios anotados (16/10/2026). `links`: o que conta como
 * "mandou o link". Sem conversa guardada, tudo fica como a planilha e a aba CRM dizem.
 */
function conversaDoLead(conversas: ContextoDoCrm["conversas"], numero: string | undefined, links: ReadonlyArray<string | undefined>,
  segundasAnotadas: number[], agora: number) {
  const mensagens = numero ? conversas?.get(chaveDoNumero(numero)) : undefined;
  const resumo = resumirConversa(mensagens, links);
  const saidas = saidasDaConversa(mensagens, links);
  return {
    resumo,
    segundas: enviosComAConversa(segundasAnotadas, resumo, saidas, agora),
    ultimaEntrada: instante(resumo?.ultimaEntrada ?? ""),
    ultimaSaida: instante(resumo?.ultimaSaida ?? ""),
  };
}

const maior = (...xs: Array<number | undefined>) => {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? Math.max(...v) : undefined;
};

function registrosPorLead(retrato: CrmRetrato): Map<string, Registro[]> {
  const mapa = new Map<string, Registro[]>();
  for (const linha of retrato.fontes.registros.linhas) {
    const c = leitor(COLUNAS_DO_REGISTRO, linha);
    const produto = c("produto");
    const tipo = c("tipo") as CrmTipoDeRegistro;
    const em = instante(c("em"));
    if (!ehProduto(produto) || !c("id") || !TIPOS_DE_REGISTRO.includes(tipo) || em === undefined) continue;
    const chave = `${produto}:${c("id")}`;
    const lista = mapa.get(chave) ?? [];
    // JSON qualificado nunca pode ser truncado até parecer outro registro válido.
    if (tipo === 'spiced' && !lerRegistroSpiced(c("texto"))) continue;
    if (tipo === 'cadencia_enviada' && !lerRegistroCadencia(c("texto"))) continue;
    if (ehTipoAarr(tipo) && !lerRegistroAarr(tipo, c("texto"))) continue;
    lista.push({ em, tipo, texto: tipo === 'spiced' || ehNotaComercial(c("texto")) ? c("texto") : texto(c("texto"), 1000), data: c("data") });
    mapa.set(chave, lista);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => a.em - b.em);
  return mapa;
}

/** Proposta vale até ser desfeita; próximo passo é o último registrado (texto vazio limpa). */
function manuais(registros: Registro[]) {
  let proposta: Registro | undefined;
  let proximo: Registro | undefined;
  // A perda marcada na Central: a última vale, e o "desfeito" do mesmo tipo a apaga.
  let semContato: Registro | undefined;
  // O ganho marcado na Central (AC-08) corre à parte da perda: os dois podem existir (dispensado e depois
  // fechou por fora), e quem decide qual vale é o mais novo (comDesfechoManual).
  let ganho: Registro | undefined;
  for (const r of registros) {
    if (r.tipo === "sem_contato" || r.tipo === "recusou" || r.tipo === "dispensado") semContato = r;
    if ((r.tipo === "sem_contato_desfeito" && semContato?.tipo === "sem_contato") || (r.tipo === "recusou_desfeito" && semContato?.tipo === "recusou")
      || (r.tipo === "dispensado_desfeito" && semContato?.tipo === "dispensado")) semContato = undefined;
    if (r.tipo === "ganhou") ganho = r;
    if (r.tipo === "ganhou_desfeito") ganho = undefined;
    if (r.tipo === "proposta") proposta = r;
    if (r.tipo === "proposta_desfeita") proposta = undefined;
    if (r.tipo === "proximo_passo") proximo = r.texto ? r : undefined;
  }
  return {
    proposta, proximo, semContato, ganho, notas: registros.filter((r) => r.tipo === "nota").length,
    // Instantes dos envios anotados, em ordem: quem decide se valem é a regra de cada um (depois de quê).
    segundas: registros.filter((r) => r.tipo === "segunda_enviada").map((r) => r.em),
    followups: registros.filter((r) => r.tipo === "followup_enviado").map((r) => r.em),
    // Plus: a planilha não conhece esses leads, então o envio e a resposta só existem aqui (aba CRM).
    enviadoPlus: registros.find((r) => r.tipo === "plus_enviado")?.em,
    respondeuPlus: registros.filter((r) => r.tipo === "plus_respondeu").map((r) => r.em),
  };
}

/**
 * "Interesse parado nunca some" (14/10/2026). Com 48 h de janela, "Manda aí" e "Pode sim" de 08–09/10
 * saíram da Hoje sem o CRM saber se o link foi mandado. Quem disse que quer ver fica até a 2ª mensagem
 * sair DEPOIS da resposta: anotada na Central (`segunda_enviada`) ou, quando a planilha trouxer a coluna,
 * `ultima_saida_em`. A saída normal da etapa (recusa, proposta, ganho, Perdido pelos 7 dias) também
 * tira, porque `conversa` só vale em Em contato. `null` = não está parado; `{ desde }` = parado desde.
 */
export function interesseParado(entrada: {
  conversa: boolean;
  resposta?: CrmResposta;
  respondeu?: number;
  segundas: number[];
  ultimaSaida?: number;
}): { desde?: number } | null {
  // A licença (17/10/2026) também espera o que foi autorizado sair: a vez é nossa até o material.
  if (!entrada.conversa || !pedeMaterial(entrada.resposta)) return null;
  const resposta = entrada.resposta!;
  const desde = instante(resposta.em ?? "") ?? entrada.respondeu;
  // Sem a data da resposta, qualquer 2ª mensagem anotada vale: é melhor sumir com o link mandado
  // do que ficar para sempre por falta de data.
  const depois = (t: number) => desde === undefined || t > desde;
  if (entrada.segundas.some(depois)) return null;
  if (entrada.ultimaSaida !== undefined && desde !== undefined && entrada.ultimaSaida > desde) return null;
  return desde === undefined ? {} : { desde };
}

/** O follow-up anotado depois do envio (ou do convite) apaga o "follow-up hoje": já foi. */
export function followupJaEnviado(followups: number[], enviado: number | undefined): boolean {
  return followups.some((t) => enviado === undefined || t > enviado);
}

/**
 * O follow-up do 3º dia, uma regra para todas as ofertas (16/10/2026, OT-15 do blueprint: "uma esteira
 * de venda, a oferta como parâmetro"). Site, PRUMO, Iris, estamparias e Plus tinham cada um a sua cópia
 * desta conta, e cada oferta nova copiava a esteira. O que muda por oferta entra como parâmetro:
 * - `leu` (legado, ignorado): até a Fase 3 o follow-up exigia o recibo de leitura; hoje ele não decide e os
 *   chamadores não o passam mais. Fica opcional só para o teste de tabela que fixa justamente isso;
 * - `ultimaSaida`: mensagem nossa depois do 2º dia já é um follow-up à mão (só a planilha do Site a tem).
 * Fica de fora o reenvio do só-robô, que tem regra própria (reenvioDoRoboHoje).
 */
export function followupDoTerceiroDia(e: {
  etapa: CrmEtapa;
  emConversa: boolean;
  acervo?: boolean;
  enviado: number | undefined;
  leu?: boolean;
  followups: number[];
  agora: number;
  ultimaSaida?: number;
}): boolean {
  const d = dias(e.enviado, e.agora);
  return e.etapa === "contato" && !e.emConversa && !e.acervo && d !== undefined
    && d >= DIAS_ATE_FOLLOWUP && d < DIAS_SEM_RESPOSTA
    && (e.ultimaSaida === undefined || e.enviado === undefined || e.ultimaSaida <= e.enviado + DIAS_ATE_FOLLOWUP * DIA_MS - DIA_MS)
    && !followupJaEnviado(e.followups, e.enviado);
}

/**
 * O reenvio do só-robô entra hoje no "Follow-up para mandar"? (14/10/2026)
 *
 * Medido em 14/10/2026: 19 leads em Em contato em que só a resposta automática do WhatsApp
 * Business respondeu. A 1ª mensagem chegou a um robô e ninguém de verdade a viu, e o único caminho
 * até eles era o follow-up do 3º dia, que só aparecia no DIA em que o n8n gravou `followup_em`
 * (quem passou do dia sumia e expirava sem nunca ter sido recontatado) e perguntava "quer que eu
 * mande o link?" a um robô. Aqui o lead ganha UM reenvio, pedindo a pessoa certa:
 * - a partir do dia seguinte ao envio, pelo calendário de São Paulo (enviado 14/10 às 12h26 ->
 *   15/10), sem esperar os 3 dias: não há conversa a respeitar, só um recado que não chegou;
 * - até o último dia antes de sair pelo prazo, sem depender do `followup_em` do n8n;
 * - uma vez só: o `followup_enviado` anotado depois do envio o tira (e recomeça o prazo,
 *   comPrazoDoContato); saída nossa em outro dia que não o do envio (`ultima_saida_em`) também,
 *   porque alguém já escreveu de novo à mão. A do próprio dia é a 1ª mensagem: o `enviado_em`
 *   é marcado pelo observador quando ela aparece na conversa, e a saída do próprio dia é essa.
 * Acervo (envio antes do corte) fica de fora, como no follow-up de sempre.
 */
export function reenvioDoRoboHoje(entrada: {
  etapa: CrmEtapa;
  sinal: CrmSinal;
  acervo: boolean;
  enviado?: number;
  followups: number[];
  ultimaSaida?: number;
  agora: number;
}): boolean {
  const { enviado } = entrada;
  if (entrada.etapa !== "contato" || entrada.sinal !== "so-robo" || entrada.acervo || enviado === undefined) return false;
  const passados = diaSP(entrada.agora) - diaSP(enviado);
  if (passados < 1 || passados >= DIAS_SEM_RESPOSTA) return false;
  if (entrada.ultimaSaida !== undefined && diaSP(entrada.ultimaSaida) > diaSP(enviado)) return false;
  return !followupJaEnviado(entrada.followups, enviado);
}

// As subetapas dos desfechos marcados na Central. São elas que dizem qual desfecho está valendo (o
// "desfazer" da Ficha): o sinal sozinho não basta, porque "recusou" e "fechou" também vêm da planilha.
const SUB_RECUSOU_NA_CENTRAL = "Recusou (marcado na Central)";
const SUB_GANHOU_NA_CENTRAL = "Fechou (marcado na Central)";
const SUB_DISPENSADO_NA_TRIAGEM = "Dispensado na Triagem";

/** O dia do registro, quando o Rômulo deu outro dia que não o do toque (fechou ontem, anotou hoje); senão, o toque. */
function desdeDoRegistro(r: Registro): number {
  const dia = dataDoDia(r.data);
  return dia !== undefined && diaSP(dia) !== diaSP(r.em) ? dia : r.em;
}

/**
 * Os desfechos marcados na Central. Ganho (AC-08) vale sobre qualquer etapa, até sobre Perdido: quem
 * expirou e fechou por telefone fechou, e é o Rômulo dizendo. Só não troca o ganho que a planilha já
 * deu (aí o "Fechou" da planilha manda). Com ganho e perda marcados, vale o mais novo: é o "último
 * registro vale" dos pares, estendido aos dois. A perda (sem contato, recusou, dispensado) encerra como
 * Perdido, salvo se o lead já estiver ganho ou perdido pela planilha.
 */
function comDesfechoManual(calculada: EtapaCalculada, semContato: Registro | undefined, ganho: Registro | undefined): EtapaCalculada {
  if (ganho && (!semContato || ganho.em >= semContato.em)) {
    return calculada.etapa === "ganho" ? calculada : { etapa: "ganho", sinal: "fechou", subEtapa: SUB_GANHOU_NA_CENTRAL, desde: desdeDoRegistro(ganho) };
  }
  if (!semContato || calculada.etapa === "ganho" || calculada.etapa === "perdido") return calculada;
  if (semContato.tipo === "recusou") {
    return { etapa: "perdido", sinal: "recusou", subEtapa: SUB_RECUSOU_NA_CENTRAL, desde: semContato.em, motivoPerda: "recusou" };
  }
  // AC-10: o prospect que não serve sai da Triagem como Descartado, o mesmo motivo do Site descartado
  // antes do contato; a subetapa diz de onde veio.
  if (semContato.tipo === "dispensado") {
    return { etapa: "perdido", sinal: "descartado", subEtapa: SUB_DISPENSADO_NA_TRIAGEM, desde: desdeDoRegistro(semContato), motivoPerda: "descartado" };
  }
  return { etapa: "perdido", sinal: "sem-contato", subEtapa: "Perdido: sem contato fácil", desde: semContato.em, motivoPerda: "sem-contato" };
}

/** Qual perda marcada na Central está valendo neste lead (para o "desfazer" da Ficha). */
const perdaManualDo = (calculada: EtapaCalculada, semContato: Registro | undefined): CrmLead["perdaManual"] =>
  !semContato ? undefined
    : calculada.subEtapa === SUB_RECUSOU_NA_CENTRAL ? "recusou"
      : calculada.subEtapa === SUB_DISPENSADO_NA_TRIAGEM ? "dispensado"
        : calculada.sinal === "sem-contato" ? "sem-contato" : undefined;

/** Os dois campos do desfecho manual na ficha; ausentes quando o que vale é a planilha ou a regra. */
function desfechoManualDo(calculada: EtapaCalculada, semContato: Registro | undefined, ganho: Registro | undefined): Pick<CrmLead, "perdaManual" | "ganhoManual"> {
  const perda = perdaManualDo(calculada, semContato);
  return {
    ...(perda ? { perdaManual: perda } : {}),
    ...(ganho && calculada.subEtapa === SUB_GANHOU_NA_CENTRAL ? { ganhoManual: true } : {}),
  };
}

/** Quem já falou com a gente: a classificação do n8n e a pasta em _em-conversa/ contam como conversa. */
const SINAIS_DE_CONVERSA: ReadonlySet<CrmSinal> = new Set(["respondeu", "em-conversa", "respondeu-prumo", "diagnostico"]);

/**
 * O prazo de Em contato (DIAS_SEM_RESPOSTA). `ultimoDoLead` é a última mensagem DELE (robô não conta);
 * sem nenhuma, conta do envio. Um próximo passo registrado segura o lead: é o Rômulo dizendo que ainda
 * vale. O lead que escreve de novo volta sozinho, porque a conta recomeça na mensagem nova.
 *
 * Só-robô com o reenvio anotado (`followups` depois do envio, 14/10/2026): a conta recomeça no
 * reenvio. A 1ª mensagem não chegou a ninguém, então o prazo de resposta de gente só começa quando
 * o pedido da pessoa certa sai; contado do envio, um reenvio no 6º dia deixaria 1 dia para alguém
 * responder. Só para o só-robô: o follow-up de quem viu e não respondeu não muda a expiração.
 */
function comPrazoDoContato(calculada: EtapaCalculada, ultimoDoLead: number | undefined, enviado: number | undefined,
  proximo: Registro | undefined, agora: number, followups: number[] = []): EtapaCalculada & { diasParaSair?: number } {
  const reenvios = calculada.sinal === "so-robo" && enviado !== undefined ? followups.filter((t) => t > enviado) : [];
  const desde = reenvios.length ? Math.max(ultimoDoLead ?? enviado ?? 0, ...reenvios) : ultimoDoLead ?? enviado;
  if (calculada.etapa !== "contato" || proximo || desde === undefined) return calculada;
  const passados = dias(desde, agora) ?? 0;
  if (passados < DIAS_SEM_RESPOSTA) return { ...calculada, diasParaSair: DIAS_SEM_RESPOSTA - passados };
  // Silêncio em conversa humana exige revisão, não perda nem autorização de apagar demo.
  if (ultimoDoLead !== undefined || SINAIS_DE_CONVERSA.has(calculada.sinal)) {
    return { ...calculada, subEtapa: 'Conversa sem retorno: revisar o próximo passo antes de encerrar' };
  }
  const saiu = desde + DIAS_SEM_RESPOSTA * DIA_MS;
  return ultimoDoLead === undefined && !SINAIS_DE_CONVERSA.has(calculada.sinal)
    ? { etapa: "perdido", sinal: "expirou", subEtapa: `Sem resposta em ${DIAS_SEM_RESPOSTA} dias`, desde: saiu, motivoPerda: "expirou" }
    : { etapa: "perdido", sinal: "esfriou", subEtapa: `Parou de responder: ${DIAS_SEM_RESPOSTA} dias sem mensagem`, desde: saiu, motivoPerda: "esfriou" };
}

/**
 * Perdido pelo tempo, sem desfecho de ninguém: volta com mensagem do lead, próximo passo ou proposta.
 * `proposta-sem-retorno` (a cadência da proposta, que perde o lead sozinha) é o mesmo caso: sem ele a
 * proposta nova, que é justamente o que o traz de volta, era recusada como "desfaça o desfecho".
 */
export const saiuPeloPrazo = (lead: Pick<CrmLead, "motivoPerda">) =>
  lead.motivoPerda === "expirou" || lead.motivoPerda === "esfriou" || lead.motivoPerda === "proposta-sem-retorno";

/** A saída pelo prazo na linha do tempo da ficha: data calculada pela regra, não lida da planilha. */
function eventoDoPrazo(calculada: EtapaCalculada): CrmEvento[] {
  const rotulo = calculada.sinal === "expirou" ? `Saiu do funil: ${DIAS_SEM_RESPOSTA} dias sem resposta`
    : calculada.sinal === "esfriou" ? `Saiu do funil: ${DIAS_SEM_RESPOSTA} dias sem mensagem depois de responder` : "";
  return rotulo ? evento(calculada.sinal, rotulo, calculada.desde, `regra do CRM (${DIAS_SEM_RESPOSTA} dias sem mensagem do lead)`, { estimado: true }) : [];
}

/** A última mensagem do lead entre as datas da planilha; a classificação "bot" não é ele falando. */
function ultimaDoLead(datas: Array<number | undefined>, resposta: CrmResposta | undefined): number | undefined {
  const todas = [...datas, resposta && resposta.tipo !== "bot" ? instante(resposta.em ?? "") : undefined]
    .filter((t): t is number => t !== undefined);
  return todas.length ? Math.max(...todas) : undefined;
}

function eventosManuais(registros: Registro[]): CrmEvento[] {
  const rotulo: Record<CrmTipoDeRegistro, string> = {
    valor_proposta: 'Valor de proposta registrado', pagamento_confirmado: 'Pagamento confirmado', receita_desfeita: 'Registro comercial desfeito',
    origem: 'Origem confirmada', motivo_perda: 'Motivo da perda confirmado', retencao_3m: 'Mensalidade no terceiro mês conferida',
    indicacao_pedida: 'Indicação pedida', indicacao_recebida: 'Indicação recebida',
    spiced: 'Qualificação SPICED confirmada',
    cadencia_enviada: 'Toque de acompanhamento confirmado',
    nota: "Nota",
    proximo_passo: "Próximo passo",
    proposta: "Proposta enviada",
    proposta_desfeita: "Proposta desfeita",
    sem_contato: "Perdido: sem contato fácil",
    sem_contato_desfeito: "Perda por falta de contato desfeita",
    recusou: "Recusou (marcado na Central)",
    recusou_desfeito: "Recusa desfeita",
    ganhou: SUB_GANHOU_NA_CENTRAL,
    ganhou_desfeito: "Ganho desfeito",
    dispensado: SUB_DISPENSADO_NA_TRIAGEM,
    dispensado_desfeito: "Dispensa desfeita",
    segunda_enviada: "2ª mensagem enviada",
    followup_enviado: "Follow-up enviado",
    plus_enviado: "Primeira mensagem enviada",
    plus_respondeu: "Respondeu no WhatsApp (anotado à mão)",
  };
  return registros.map((r) => ({
    tipo: r.tipo,
    rotulo: rotulo[r.tipo],
    em: new Date(r.em).toISOString(),
    origem: "manual" as const,
    fonte: TIPOS_DE_ENVIO.has(r.tipo) ? "aba CRM (anotado ao tocar no link na Central)" : "aba CRM (registrado na Central)",
    ...((r.tipo === 'nota' && (r.texto.startsWith(PREFIXO_CICLO) || r.texto.startsWith(PREFIXO_QUALIFICACAO_COMERCIAL))) || ['spiced', 'cadencia_enviada'].includes(r.tipo) || ehTipoAarr(r.tipo) || (r.tipo === 'followup_enviado' && lerRegistroFollowup(r.texto)) ? { registroTexto: r.texto } : {}),
    ...(ehTipoAarr(r.tipo) ? { texto: resumoDoRegistroAarr(r.tipo, lerRegistroAarr(r.tipo, r.texto)!) }
      : r.tipo === 'nota' && r.texto.startsWith(PREFIXO_CICLO) ? { texto: `Ciclo comercial: ${lerEventoCiclo(r.texto)?.tipo ?? 'registro inválido'}` }
      : r.tipo === 'nota' && r.texto.startsWith(PREFIXO_QUALIFICACAO_COMERCIAL) ? { texto: 'Revisão humana da qualificação comercial.' }
      : r.tipo === 'spiced' ? { texto: 'Qualificação comercial confirmada pelo Rômulo.' }
      : r.tipo === 'cadencia_enviada' ? { texto: lerRegistroCadencia(r.texto)?.tipo === 'conversa' ? 'Retomada da conversa confirmada.' : lerRegistroCadencia(r.texto)?.degrau === 'dia-3' ? 'Último retorno da proposta confirmado.' : 'Primeiro retorno da proposta confirmado.' }
      : r.tipo === 'followup_enviado' && lerRegistroFollowup(r.texto) ? { texto: 'Follow-up confirmado pelo Rômulo.' }
      : r.tipo === "proximo_passo"
      ? { texto: r.texto ? `${r.texto}${r.data ? ` (para ${formatarDia(r.data)})` : ""}` : r.data ? `Próximo passo concluído em ${formatarDia(r.data)}` : "Próximo passo limpo" }
      : r.tipo === "proposta" && r.data
        ? { texto: `Data da proposta: ${formatarDia(r.data)}${r.texto ? ` · ${r.texto}` : ""}` }
        // O ganho anotado noutro dia que não o do fechamento: a ficha diz o dia que ele deu.
        : r.tipo === "ganhou" && desdeDoRegistro(r) !== r.em
          ? { texto: `Fechou em ${formatarDia(r.data)}${r.texto ? ` · ${r.texto}` : ""}` }
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

/** Marcos do cartão e dos Resultados; os envios anotados entram pelo último de cada tipo. */
function marcosDoLead(enviado: number | undefined, visto: number | undefined, respondeu: number | undefined,
  segundas: number[], followups: number[]): CrmLead["marcos"] {
  const ultimo = (lista: number[]) => (lista.length ? lista[lista.length - 1] : undefined);
  const pares: Array<[keyof CrmLead["marcos"], number | undefined]> = [
    ["enviado", enviado], ["visto", visto], ["respondeu", respondeu],
    ["segundaEnviada", ultimo(segundas)], ["followupEnviado", ultimo(followups)],
  ];
  return Object.fromEntries(pares.filter(([, t]) => t !== undefined).map(([chave, t]) => [chave, iso(t)]));
}

const dias = (desde: number | undefined, agora: number) => (desde === undefined ? undefined : Math.max(0, diaSP(agora) - diaSP(desde)));

// ------------------------------------------------------------------ etapa do Site antes da venda

/** Subetapa em forma de código: a tela e a lista Hoje decidem por ele, não pelo texto. */
export type CrmSinal =
  | "na-fila" | "publicado" | "pronto" | "enviado" | "viu" | "respondeu" | "em-conversa"
  | "revisar" | "sem-etapa" | "convite" | "convite-visto" | "respondeu-prumo" | "diagnostico"
  | "proposta" | "fechou" | "concluido" | "recusou" | "recusou-pasta" | "expirou" | "esfriou" | "descartado" | "sem-interesse" | "sem-contato" | "so-robo";

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
  if (resposta?.tipo === "licenca") return `${base}: deixou mandar o material (licença, não é "quero ver")`;
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
  /** Ainda sem demo (demo sob pedido, ou a mensagem A sem demo de 15/10/2026): "publicado" é o Raio-X, não um site. */
  semDemo?: boolean;
}): EtapaCalculada {
  const { status, lugar, resposta } = entrada;
  if (status === "fechado") return { etapa: "ganho", sinal: "fechou", subEtapa: "Fechou", desde: entrada.fechado };
  if (status === "recusado") {
    const noWhatsapp = resposta?.tipo === "exclusao" ? " no WhatsApp (pediu para apagar o demo)"
      : resposta?.tipo === "negativa" ? " no WhatsApp (resposta negativa)" : "";
    return { etapa: "perdido", sinal: "recusou", subEtapa: `Recusou${noWhatsapp}`, desde: entrada.recusado, motivoPerda: "recusou" };
  }
  if (lugar === "_recusados") return { etapa: "perdido", sinal: "recusou-pasta", subEtapa: "Recusou (anotado na pasta _recusados/)", motivoPerda: "recusou" };
  // A planilha expira no mesmo 7º dia do CRM (até 19/10/2026 era o 10º): mesma saída e mesma data, para o
  // "desde" (e a folga da limpeza dos demos) não recomeçar quando o status chega.
  if (status === "expirado" && entrada.respondeu === undefined) {
    return {
      etapa: "perdido",
      sinal: "expirou",
      subEtapa: `Sem resposta em ${DIAS_SEM_RESPOSTA} dias`,
      desde: entrada.enviado === undefined ? undefined : entrada.enviado + DIAS_SEM_RESPOSTA * DIA_MS,
      motivoPerda: "expirou",
    };
  }
  if (status === "descartado") return { etapa: "perdido", sinal: "descartado", subEtapa: "Descartado antes do contato", motivoPerda: "descartado" };
  // O gerador (ou uma sessão do Claude) descarta movendo a pasta, sem tocar na planilha: a divergência aparece na ficha.
  if (lugar === "_descartados") return { etapa: "perdido", sinal: "descartado", subEtapa: "Descartado (pasta _descartados/)", motivoPerda: "descartado" };
  if (entrada.proposta) return { etapa: "proposta", sinal: "proposta", subEtapa: "Proposta enviada", desde: dataDoDia(entrada.proposta.data) ?? entrada.proposta.em };
  if (entrada.respondeu !== undefined) return { etapa: "contato", sinal: "respondeu", subEtapa: subEtapaDaResposta(resposta), desde: entrada.respondeu };
  // Só robô respondeu (o n8n já apagou o respondeu_em): é contato sem conversa, mesmo com a pasta em _em-conversa/.
  if (resposta?.tipo === "bot" && (status === "enviado" || status === "expirado")) {
    return { etapa: "contato", sinal: "so-robo", subEtapa: "Só resposta automática (robô), ninguém respondeu ainda", desde: entrada.enviado };
  }
  if (lugar === "_em-conversa") return { etapa: "contato", sinal: "em-conversa", subEtapa: "Em conversa (pasta _em-conversa/)", desde: entrada.enviado };
  if (status === "enviado" || status === "expirado" || entrada.enviado !== undefined) {
    return entrada.visto !== undefined
      ? { etapa: "contato", sinal: "viu", subEtapa: "Viu, sem resposta", desde: entrada.enviado ?? entrada.visto }
      : { etapa: "contato", sinal: "enviado", subEtapa: "Enviado · leitura desconhecida", desde: entrada.enviado };
  }
  if (status === "pronto") {
    return { etapa: "novo", sinal: "pronto", subEtapa: entrada.semDemo ? "Pronto, não enviado · sem demo (gere quando ele pedir)" : "Pronto, não enviado",
      desde: entrada.publicadoEm ?? entrada.criado };
  }
  if (entrada.publicado) {
    return { etapa: "novo", sinal: "publicado", subEtapa: `${entrada.semDemo ? "Raio-X" : "Site"} publicado, falta o Balcão marcar pronto`,
      desde: entrada.publicadoEm ?? entrada.criado };
  }
  return { etapa: "novo", sinal: "na-fila", subEtapa: lugar === "" ? "Na fila do gerador" : "Sem site e sem pasta em ~/auto-site", desde: entrada.criado };
}

function leadDoSite(linha: Linha, contexto: {
  agora: number;
  pastaPorId: Map<string, PastaDoLead>;
  registros: Map<string, Registro[]>;
  links: CrmRetrato["links"];
  pastasLidas: boolean;
  conversas?: ContextoDoCrm["conversas"];
}): CrmLead | null {
  const c = leitor(COLUNAS_DO_SITE, linha);
  const chave = c("id");
  if (!chave || /^TESTE/i.test(chave)) return null;
  const { agora } = contexto;
  const status = c("status").toLowerCase();
  const pasta = contexto.pastaPorId.get(chave);
  const registros = contexto.registros.get(`site:${chave}`) ?? [];
  const { proposta, proximo, semContato, ganho, notas, segundas: segundasAnotadas, followups } = manuais(registros);
  // A conversa de verdade (16/10/2026): o link visto numa mensagem nossa é a 2ª mensagem, mesmo
  // mandado à mão; o toque que abriu o WhatsApp e não virou mensagem não é.
  const conv = conversaDoLead(contexto.conversas, numeroDoWhatsapp(c("waMe")), [urlHttps(c("site")), pasta?.siteUrl, urlHttps(c("raioXUrl"))],
    segundasAnotadas, agora);
  const segundas = conv.segundas;
  const t = {
    criado: instante(c("criadoEm")),
    enviado: instante(c("enviadoEm")),
    visto: instante(c("vistoEm")),
    respondeu: instante(c("respondeuEm")),
    followup: instante(c("followupEm")),
    recusado: instante(c("recusadoEm")),
    fechado: instante(c("fechadoEm")),
    publicadoEm: instante(pasta?.publicadoEm ?? ""),
    apagadoEm: instante(pasta?.apagadoEm ?? ""),
    raioXEm: instante(pasta?.raioXEm ?? ""),
    demoPedido: instante(pasta?.demoPedidoEm ?? ""),
    ultimaEntrada: maior(instante(c("ultimaEntradaEm")), conv.ultimaEntrada),
    ultimaSaida: maior(instante(c("ultimaSaidaEm")), conv.ultimaSaida),
  };
  // Para o interesse parado só vale a coluna da planilha (ou o link visto, já em `segundas`): um
  // "vou pedir o link ao time" na conversa é mensagem nossa, mas o link continua por mandar.
  const saidaDaPlanilha = instante(c("ultimaSaidaEm"));
  const resposta = respostaDaLinha(c);
  // "expirado" é a regra de tempo da planilha, não decisão de ninguém: próximo passo ou proposta
  // registrados na Central a suspendem, como suspendem a regra do CRM (comPrazoDoContato). O reenvio
  // do só-robô anotado também: o prazo recomeça nele, e a planilha, que conta 7 dias do ENVIO,
  // cortaria antes (um reenvio no 6º dia ficaria com 1 dia em vez de 7).
  const reenviado = resposta?.tipo === "bot" && t.respondeu === undefined && t.enviado !== undefined && followupJaEnviado(followups, t.enviado);
  const statusDaEtapa = status === "expirado" && (proximo || proposta || reenviado) ? "enviado" : status;
  const calculada = comPrazoDoContato(
    comDesfechoManual(etapaDoSite({ status: statusDaEtapa, lugar: pasta?.lugar, publicado: Boolean(pasta?.artefatos.publicado), ...t, proposta, resposta,
      publicadoEm: t.publicadoEm ?? t.raioXEm, semDemo: !urlHttps(c("site")) && !pasta?.siteUrl }), semContato, ganho),
    ultimaDoLead([t.respondeu, t.ultimaEntrada], resposta), t.enviado, proximo, agora, followups);
  const emConversa = calculada.etapa === "contato" && SINAIS_DE_CONVERSA.has(calculada.sinal);
  const corte = Date.parse(CORTE_DO_ACOMPANHAMENTO);
  const acervo = t.enviado !== undefined && t.enviado < corte;
  const parado = interesseParado({ conversa: emConversa && !ehRecusa(resposta), resposta, respondeu: t.respondeu, segundas, ultimaSaida: saidaDaPlanilha });
  // Achado da simulação das jornadas (16/10/2026): depois da 2ª mensagem anotada, quem escreveu por
  // último foi o Rômulo, mas o "respondeu há menos de 48 h" mantinha o lead em "Respostas para
  // responder", e a Hoje pedia de novo o que já tinha saído. A 2ª anotada depois da resposta encerra a vez.
  // Com a conversa guardada, qualquer mensagem nossa depois da última dele também (menos no interesse
  // parado: aí só o link encerra).
  const ultimaSegunda = segundas.length ? Math.max(...segundas) : undefined;
  const ultimaDele = Math.max(t.respondeu ?? 0, instante(resposta?.em ?? "") ?? 0, conv.ultimaEntrada ?? 0);
  const falouPorUltimo = (ultimaSegunda !== undefined && ultimaSegunda > ultimaDele)
    || (parado === null && conv.ultimaSaida !== undefined && conv.ultimaSaida > ultimaDele);
  // Ele escreveu de novo depois da nossa última (a conversa sabe): é resposta nova, sem o limite de 48 h.
  const escreveuDepois = conv.ultimaEntrada !== undefined && conv.ultimaEntrada > (conv.ultimaSaida ?? 0)
    && conv.ultimaEntrada > (t.enviado ?? 0) + 5 * 60_000;
  const respostaNova = emConversa && !falouPorUltimo && (parado !== null || escreveuDepois || (
    t.ultimaEntrada !== undefined && t.ultimaSaida !== undefined
      ? t.ultimaEntrada > t.ultimaSaida
      : t.respondeu !== undefined && agora - t.respondeu <= HORAS_DE_RESPOSTA_NOVA * 60 * 60 * 1000));

  const eventos: CrmEvento[] = [
    ...evento("encontrado", "Lead encontrado pelo Caçador", t.criado, "planilha · criado_em"),
    ...evento("site", "Site publicado", t.publicadoEm, "pasta · publicado.json"),
    // Demo sob pedido (14/10/2026): o Raio-X avulso sai antes do contato; o demo, só depois do botão.
    ...(pasta?.raioXUrl && raioXAvulso(pasta.raioXUrl) ? evento("raio-x", "Raio-X publicado", t.raioXEm, "pasta · publicado.json raio_x_em") : []),
    ...evento("demo-pedido", "Demo pedido (botão Gerar demo)", t.demoPedido, "pasta · PEDIDO-DEMO.json"),
    ...evento("apagado", "Demo removida da Vercel pela limpeza", t.apagadoEm, "pasta · publicado.json apagado_em"),
    ...evento("enviado", "Enviado pelo WhatsApp", t.enviado, "planilha · enviado_em"),
    ...evento("visto", "Viu a mensagem", t.visto, "planilha · visto_em"),
    ...evento("respondeu", "Respondeu", t.respondeu, "planilha · respondeu_em"),
    ...eventoDaResposta(resposta, "planilha · resposta_tipo"),
    ...evento("followup", "Lembrete de follow-up (05 · Acompanhamento)", t.followup, "planilha · followup_em"),
    ...eventoDoPrazo(calculada),
    ...(status === "expirado" && t.enviado !== undefined
      ? evento("expirou", "Planilha marcou expirado", t.enviado + DIAS_ATE_EXPIRAR * DIA_MS, "status expirado · data pela regra dos 7 dias", { estimado: true })
      : []),
    ...evento("recusou", "Recusou", t.recusado, "planilha · recusado_em"),
    ...evento("fechou", "Fechou", t.fechado, "planilha · fechado_em"),
    ...eventosManuais(registros),
  ].sort((a, b) => Date.parse(a.em) - Date.parse(b.em));

  const webhook = contexto.links.webhook;
  const whatsapp = numeroDoWhatsapp(c("waMe"));
  const waLink = urlHttps(c("waLink"));
  const mensagemPronta = status === "pronto" && waLink ? textoDoWaMe(c("waMe")) : undefined;
  const planilha = contexto.links.planilhaSite && c("linha") ? `${contexto.links.planilhaSite}&range=A${encodeURIComponent(c("linha"))}` : contexto.links.planilhaSite;
  // Demo apagado pelo site-demos-limpeza: o link dá 404 na Vercel. Sem ele, nem "Ver o demo" nem a
  // segunda mensagem (o link do site) são oferecidos; a ficha diz o que aconteceu e como trazer de volta.
  const site = t.apagadoEm !== undefined ? undefined : urlHttps(c("site")) ?? pasta?.siteUrl;
  const acoes = urlHttps(c("acoesLink")) ?? (webhook && (pasta || c("site")) ? `${webhook}/lead?id=${encodeURIComponent(chave)}` : undefined);
  // Depois do "sim": a primeira mensagem (desde 05/10/2026) pede licença e não leva o link.
  // Os textos são os do n8n (server/site-mensagem.ts espelha site-mensagem.js), em inglês nos EUA.
  const waMe = /wa\.me\/\d+/.test(c("waMe")) ? c("waMe") : whatsapp ? `https://wa.me/${whatsapp}` : "";
  const mensagem = { nome: c("empresa"), siteUrl: site ?? "", waMe, variante: c("mensagemVariante"), raioXUrl: c("raioXUrl") };
  // Demo sob pedido (14/10/2026): o Raio-X avulso não depende do demo (outro projeto da Vercel), então vale sem site.
  const avulso = raioXAvulso(c("raioXUrl")) ? urlHttps(c("raioXUrl")) : undefined;
  const segunda = emConversa && !ehRecusa(resposta) && (site || avulso) && whatsapp ? segundaDe(mensagem).link || undefined : undefined;
  // O Raio-X do demo (<site>/raio-x): quem recebeu a C pediu ele; a ficha o mostra e a colinha o preenche.
  const raioX = site ? urlHttps(c("raioXUrl")) : avulso;
  // Só-robô com número do Brasil e demo no ar: o follow-up vira o reenvio único (reenvioDoRoboHoje),
  // com o pedido da pessoa certa. Sem demo, o texto ofereceria um link que não existe; nos EUA não há
  // texto em inglês: os dois seguem o follow-up de sempre. O Raio-X avulso (demo sob pedido) vale como
  // o "link": quem o recebeu ganha o reenvio do raio-x, que não promete demo. Quem recebeu a A sem demo
  // (15/10/2026) também: a primeira mensagem já disse que a demonstração existe, e o reenvio só a repete.
  const recebeuA = c("mensagemVariante") === "A";
  const reenvioLink = calculada.sinal === "so-robo" && (site || avulso || recebeuA) ? reenvioDoRoboDe(mensagem)?.link : undefined;
  // O follow-up do 3º dia NÃO depende mais de leitura (Fase 3, 19/10/2026): antes (15/10) só quem LEU o
  // recebia, por medo de denúncia de spam; o ritmo e o 3º dia valem para todos. O reenvio do só-robô tem regra própria.
  // `testeDoRecibo` (OT-10, src/operations/ab-recibo.ts) segue só como MEDIDA: marca quem não manda recibo
  // para comparar resposta e exclusão, e já não muda quem entra no follow-up.
  const testeDoRecibo = entraNoTesteDoRecibo({ produto: "site", enviado: t.enviado, visto: t.visto }) ? bracoDoRecibo(chave) : undefined;
  const followupHoje = reenvioLink
    ? reenvioDoRoboHoje({ etapa: calculada.etapa, sinal: calculada.sinal, acervo, enviado: t.enviado, followups, ultimaSaida: t.ultimaSaida, agora })
    : followupDoTerceiroDia({ etapa: calculada.etapa, emConversa, acervo, enviado: t.enviado, followups, agora,
      ultimaSaida: t.ultimaSaida });
  const reenvioDoRobo = followupHoje && Boolean(reenvioLink);
  // O toque que pede o demo: lead que nunca teve demo, com pasta, que não recusou nem fechou, e sem pedido aberto.
  // 15/10/2026: sem exigir o Raio-X avulso nem o publicado.json: quem recebeu a A sem demo (gerador que falhou,
  // fila antiga) também pede por aqui; o site-pastas acha a pasta pelo content.md. Demo apagado não entra
  // (o caminho é republicar, não gerar outro).
  const demoPedido = pasta?.demoPedidoEm;
  const nuncaTeveDemo = !urlHttps(c("site")) && !pasta?.siteUrl && t.apagadoEm === undefined;
  const gerarDemo = nuncaTeveDemo && pasta && !demoPedido && webhook
    && !["recusado", "fechado", "descartado"].includes(status) && pasta.lugar !== "_recusados" && !ehRecusa(resposta)
    ? `${webhook}/lead-acao?id=${encodeURIComponent(chave)}&acao=gerar_demo` : undefined;
  // O follow-up do dia, com o texto do aviso do 05 · Acompanhamento: antes a lista Hoje abria a conversa vazia.
  const followup = !followupHoje ? undefined : reenvioDoRobo ? reenvioLink : waMe ? followupDe(mensagem).link || undefined : undefined;

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
    if ((emConversa || calculada.sinal === "esfriou") && t.respondeu !== undefined && t.respondeu >= corte && lugar === "" && !recente(t.respondeu)) {
      divergencias.push("Respondeu, mas a pasta continua na raiz (deveria estar em _em-conversa/).");
    }
    if (status === "expirado" && !acervo && t.respondeu === undefined && lugar === "" && t.enviado !== undefined
      && !recente(t.enviado + DIAS_ATE_EXPIRAR * DIA_MS)) {
      divergencias.push("Expirou, mas a pasta continua na raiz (deveria estar em _concluidos/).");
    }
    if ((status === "pronto" || status === "enviado") && !pasta) divergencias.push("Sem pasta em ~/auto-site para este lead.");
  }

  const desde = calculada.desde;
  const video = bracoDaColuna(c("bracoVideo"));
  const regime = regimeDaMensagem(t.enviado);
  const elegiveis = elegiveisDaColuna(c("abElegiveis"));
  const abordagem = {
    ...(c("mensagemVariante") ? { mensagem: c("mensagemVariante") } : {}),
    ...(c("siteVersao") ? { site: c("siteVersao") } : {}),
    ...(video ? { video } : {}),
    ...(elegiveis ? { elegiveis } : {}),
    // À parte da letra: a letra (desde 07/10) diz qual texto; o regime diz se o link ia na 1ª.
    ...(regime ? { regime } : {}),
  };
  const marcos = marcosDoLead(t.enviado, t.visto, t.respondeu, segundas, followups);
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
    ...desfechoManualDo(calculada, semContato, ganho),
    ...(calculada.diasParaSair !== undefined ? { diasParaSair: calculada.diasParaSair } : {}),
    estadoNaPlanilha: status || "(vazio)",
    ...(desde !== undefined ? { desde: iso(desde), diasNaEtapa: dias(desde, agora) } : {}),
    ...(ultimo !== undefined ? { ultimoEvento: iso(ultimo), diasDesdeUltimoEvento: dias(ultimo, agora) } : {}),
    leitura: leituraDe(t.enviado, t.visto, t.respondeu ?? (calculada.sinal === "em-conversa" ? agora : undefined), calculada.etapa === "contato"),
    marcos,
    followupHoje,
    ...(testeDoRecibo ? { testeDoRecibo } : {}),
    ...(reenvioDoRobo ? { reenvioDoRobo: true as const } : {}),
    respostaNova,
    ...(parado ? { interesseParado: parado.desde !== undefined ? { desde: iso(parado.desde) } : {} } : {}),
    ...(conv.resumo ? { conversa: conv.resumo } : {}),
    acervo,
    ...(proximo ? { proximoPasso: { texto: proximo.texto, data: proximo.data, registradoEm: new Date(proximo.em).toISOString() } } : {}),
    ...(proposta ? { proposta: { em: new Date(proposta.em).toISOString(), data: proposta.data } } : {}),
    ...(t.apagadoEm !== undefined ? { demoApagadoEm: iso(t.apagadoEm) } : {}),
    ...(demoPedido ? { demoPedidoEm: demoPedido } : {}),
    ...(pasta?.raioXAchados ? { achados: pasta.raioXAchados } : {}),
    notas,
    ...(resposta ? { resposta } : {}),
    ...(Object.keys(abordagem).length ? { abordagem } : {}),
    ...(mensagemPronta ? { mensagemPronta } : {}),
    eventos,
    links: {
      ...(site ? { site } : {}),
      ...(status === "pronto" && waLink ? { enviar: waLink } : {}),
      ...(whatsapp ? { whatsapp: `https://wa.me/${whatsapp}` } : {}),
      ...(acoes ? { acoes } : {}),
      ...(segunda ? { segunda } : {}),
      ...(followup ? { followup } : {}),
      ...(planilha ? { planilha } : {}),
      ...(raioX ? { raioX } : {}),
      ...(gerarDemo ? { gerarDemo } : {}),
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

/** PRUMO: a coluna Etapa manda; convite, resposta no WhatsApp e diagnóstico ficam Em contato. */
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
    return { etapa: "contato", sinal: "diagnostico", subEtapa: "Formulário respondido · diagnóstico pronto", desde: entrada.diagnostico };
  }
  if (entrada.respondeu !== undefined) {
    return { etapa: "contato", sinal: "respondeu-prumo", subEtapa: subEtapaDaResposta(resposta, "Respondeu no WhatsApp"), desde: entrada.respondeu };
  }
  // "Em conversa" (14/10/2026): nas abas do Iris e das estamparias, quem responde de gente vai a esta
  // Etapa (pela classificação do WhatsApp, whatsapp-conversa.py, ou à mão) e conta como conversa.
  if (etapa === "em_conversa") {
    return { etapa: "contato", sinal: "respondeu-prumo", subEtapa: subEtapaDaResposta(resposta, "Em conversa (Etapa na planilha)"), desde: entrada.convite };
  }
  if (resposta?.tipo === "bot" && (etapa === "convite_enviado" || entrada.convite !== undefined)) {
    return { etapa: "contato", sinal: "so-robo", subEtapa: "Só resposta automática (robô), ninguém respondeu ainda", desde: entrada.convite };
  }
  if (etapa === "convite_enviado" || entrada.convite !== undefined) {
    return entrada.visto !== undefined
      ? { etapa: "contato", sinal: "convite-visto", subEtapa: "Viu o convite, sem resposta", desde: entrada.convite ?? entrada.visto }
      : { etapa: "contato", sinal: "convite", subEtapa: "Convite enviado · leitura desconhecida", desde: entrada.convite };
  }
  if (etapa === "revisar") return { etapa: "novo", sinal: "revisar", subEtapa: "Revisar", desde: entrada.encontrado };
  return { etapa: "novo", sinal: "sem-etapa", subEtapa: entrada.etapa ? `Etapa "${entrada.etapa}"` : "Sem etapa na planilha", desde: entrada.encontrado };
}

/**
 * Lead de uma aba no formato do Prospects: os serviços do PRUMO, o Iris e as estamparias. Mapa, Raio-X,
 * a 2ª mensagem e o reenvio do só-robô têm texto aprovado só no PRUMO; nas ofertas novas a conversa
 * segue à mão até existir texto delas (nada de inventar mensagem).
 */
function leadDoPrumo(linha: Linha, contexto: {
  agora: number;
  registros: Map<string, Registro[]>;
  links: CrmRetrato["links"];
  mapas: Map<string, MapaDoPrumo>;
  raioX?: Map<string, RaioXDoPrumo>;
  conversas?: ContextoDoCrm["conversas"];
}, produto: CrmProdutoDeProspeccao = "prumo"): CrmLead | null {
  const c = leitor(COLUNAS_DO_PRUMO, linha);
  const chave = c("id");
  if (!chave) return null;
  const { agora } = contexto;
  const oferta = OFERTA_DE_PROSPECCAO[produto];
  const ehPrumo = produto === "prumo";
  const registros = contexto.registros.get(`${produto}:${chave}`) ?? [];
  const { proposta, proximo, semContato, ganho, notas, segundas: segundasAnotadas, followups } = manuais(registros);
  const confirmado = ultimoConviteConfirmado(eventosManuais(registros));
  const confirmadoPeloTime = registros.some((r) => r.tipo === 'nota' && r.texto?.startsWith(PREFIXO_CONVITE_TIME));
  const convite = instante(c("conviteEm")) ?? instante(confirmado?.enviadoEm ?? '');
  const t = {
    encontrado: instante(c("encontradoEm")),
    convite,
    visto: instante(c("vistoEm")) ?? dataNaProximaAcao(c("proximaAcao"), "leu", convite, agora),
    respondeu: instante(c("respondeuEm")) ?? dataNaProximaAcao(c("proximaAcao"), "respondeu", convite, agora),
    diagnostico: instante(c("diagnosticoEm")),
  };
  const mapa = ehPrumo ? contexto.mapas.get(chave) : undefined;
  const raioX = ehPrumo ? contexto.raioX?.get(chave) : undefined;
  // A conversa de verdade (16/10/2026), como no Site: o Raio-X visto numa mensagem nossa é a 2ª mensagem.
  const conv = conversaDoLead(contexto.conversas, numeroDoWhatsapp(c("whatsapp")), [raioX?.url], segundasAnotadas, agora);
  const segundas = conv.segundas;
  const resposta = respostaDaLinha(c);
  const calculada = comPrazoDoContato(comDesfechoManual(etapaDoPrumo({ etapa: c("etapa"), ...t, proposta, resposta }), semContato, ganho),
    ultimaDoLead([t.respondeu, t.diagnostico, conv.ultimaEntrada], resposta), t.convite, proximo, agora, followups);
  const emConversa = calculada.etapa === "contato" && SINAIS_DE_CONVERSA.has(calculada.sinal);
  const whatsapp = numeroDoWhatsapp(c("whatsapp"));
  // Só-robô com número do Brasil: o follow-up vira o reenvio único, com o texto que pede quem cuida do
  // marketing (antes o follow-up do PRUMO só abria a conversa vazia). A planilha do PRUMO não tem a
  // última saída: o reenvio anotado é o que o tira.
  const reenvioLink = ehPrumo && calculada.sinal === "so-robo" && whatsapp ? reenvioDoPrumo(whatsapp, c("empresa") || chave) || undefined : undefined;
  const followupHoje = reenvioLink
    ? reenvioDoRoboHoje({ etapa: calculada.etapa, sinal: calculada.sinal, acervo: false, enviado: t.convite, followups, agora })
    : followupDoTerceiroDia({ etapa: calculada.etapa, emConversa, enviado: t.convite, followups, agora });
  const reenvioDoRobo = followupHoje && Boolean(reenvioLink);
  // Com o formulário respondido (diagnóstico) a conversa já andou: não há mais 2ª mensagem a esperar.
  const parado = interesseParado({ conversa: emConversa && t.diagnostico === undefined, resposta, respondeu: t.respondeu, segundas });
  // Como no Site (16/10/2026): o Raio-X anotado depois da última resposta é a vez dele, não a sua.
  const ultimaSegunda = segundas.length ? Math.max(...segundas) : undefined;
  const ultimaDele = Math.max(t.respondeu ?? 0, instante(resposta?.em ?? "") ?? 0, conv.ultimaEntrada ?? 0);
  const falouPorUltimo = (ultimaSegunda !== undefined && ultimaSegunda > ultimaDele)
    || (parado === null && conv.ultimaSaida !== undefined && conv.ultimaSaida > ultimaDele);
  // Ele escreveu de novo depois da nossa última (a conversa sabe): é resposta nova, sem o limite de 48 h.
  const escreveuDepois = conv.ultimaEntrada !== undefined && conv.ultimaEntrada > (conv.ultimaSaida ?? 0)
    && conv.ultimaEntrada > (t.convite ?? 0) + 5 * 60_000;
  const respostaNova = emConversa && t.diagnostico === undefined && !falouPorUltimo && (parado !== null || escreveuDepois
    || (t.respondeu !== undefined && agora - t.respondeu <= HORAS_DE_RESPOSTA_NOVA * 60 * 60 * 1000));
  const eventos: CrmEvento[] = [
    ...evento("encontrado", oferta.cacador, t.encontrado, "planilha · Encontrado em"),
    ...evento("convite", "Convite enviado", t.convite,
      instante(c('conviteEm')) !== undefined ? 'planilha · Convite enviado em' : confirmadoPeloTime ? 'CRM · integração do time' : 'CRM · envio confirmado pelo operador',
      instante(c('conviteEm')) === undefined && confirmado ? { origem: 'manual' } : {}),
    ...evento("visto", "Leu o convite", t.visto, instante(c("vistoEm")) !== undefined ? "planilha · visto_em" : "planilha · Próxima ação"),
    ...evento("respondeu", "Respondeu no WhatsApp", t.respondeu, instante(c("respondeuEm")) !== undefined ? "planilha · respondeu_em" : "planilha · Próxima ação"),
    ...eventoDaResposta(resposta, "planilha · Tipo da resposta"),
    ...evento("diagnostico", `Formulário respondido · diagnóstico pronto${c("indice") ? ` (Índice ${c("indice")})` : ""}`, t.diagnostico, "planilha · Diagnóstico em"),
    ...evento("mapa", "Mapa gerado (rascunho em ~/prumo-entregas)", instante(mapa?.geradoEm ?? ""), `pasta · ${mapa?.pasta ?? ""}`),
    ...evento("raio-x", "Raio-X publicado", instante(raioX?.feitoEm ?? ""), "pasta · ~/prumo-entregas/prumo-raio-x/leads.json"),
    ...eventoDoPrazo(calculada),
    ...eventosManuais(registros),
  ].sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
  const segunda = emConversa && t.diagnostico === undefined && !ehRecusa(resposta) && raioX && whatsapp
    ? segundaDoPrumo(whatsapp, c("empresa") || chave, raioX.url) || undefined : undefined;
  const webhook = contexto.links.webhook;
  const prioridade = Number.parseInt(c("prioridade"), 10);
  const triagemBruta = {
    ...(Number.isFinite(prioridade) ? { prioridade } : {}),
    ...(c("sinais") ? { sinais: c("sinais") } : {}),
    ...(c("nota") ? { nota: c("nota") } : {}),
    ...(c("origemWhatsapp") ? { origemWhatsapp: c("origemWhatsapp") } : {}),
  };
  const triagem = Object.keys(triagemBruta).length ? triagemBruta : undefined;
  const porte = ehPrumo ? porteDaColuna(c("porte")) : undefined;
  const daAba = contexto.links[oferta.link];
  const planilha = daAba && c("linha") ? `${daAba}&range=A${encodeURIComponent(c("linha"))}` : daAba;
  const desde = calculada.desde;
  const ultimo = eventos.length ? Date.parse(eventos[eventos.length - 1].em) : undefined;
  return {
    id: `${produto}:${chave}`,
    produto,
    chave,
    empresa: c("empresa") || chave,
    nicho: c("nicho"),
    cidade: c("cidade"),
    etapa: calculada.etapa,
    sinal: calculada.sinal,
    subEtapa: calculada.subEtapa,
    ...(calculada.motivoPerda ? { motivoPerda: calculada.motivoPerda } : {}),
    ...desfechoManualDo(calculada, semContato, ganho),
    ...(calculada.diasParaSair !== undefined ? { diasParaSair: calculada.diasParaSair } : {}),
    estadoNaPlanilha: c("etapa") || "(vazio)",
    ...(desde !== undefined ? { desde: iso(desde), diasNaEtapa: dias(desde, agora) } : {}),
    ...(ultimo !== undefined ? { ultimoEvento: iso(ultimo), diasDesdeUltimoEvento: dias(ultimo, agora) } : {}),
    leitura: leituraDe(t.convite, t.visto, t.respondeu ?? t.diagnostico, calculada.etapa === "contato"),
    marcos: marcosDoLead(t.convite, t.visto, t.respondeu, segundas, followups),
    followupHoje,
    ...(reenvioDoRobo ? { reenvioDoRobo: true as const } : {}),
    respostaNova,
    ...(parado ? { interesseParado: parado.desde !== undefined ? { desde: iso(parado.desde) } : {} } : {}),
    ...(conv.resumo ? { conversa: conv.resumo } : {}),
    acervo: false,
    ...(proximo ? { proximoPasso: { texto: proximo.texto, data: proximo.data, registradoEm: new Date(proximo.em).toISOString() } } : {}),
    ...(proposta ? { proposta: { em: new Date(proposta.em).toISOString(), data: proposta.data } } : {}),
    notas,
    ...(resposta ? { resposta } : {}),
    // O regime é a regra do Site pela data; no PRUMO vai pelo convite só como dado (a tela de
    // Resultados por mensagem é do Site, e a ficha do PRUMO não o mostra).
    ...(regimeDaMensagem(t.convite) ? { abordagem: { regime: regimeDaMensagem(t.convite) } } : {}),
    ...(triagem ? { triagem } : {}),
    ...(raioX?.achados ? { achados: raioX.achados } : {}),
    ...(porte ? { porte, equipe: true } : {}),
    eventos,
    links: {
      ...(urlHttps(c("site")) ? { site: urlHttps(c("site")) } : {}),
      ...(urlHttps(c("maps")) ? { maps: urlHttps(c("maps")) } : {}),
      // Abrir é apenas navegar. O envio só entra pelos registros confirmados ou pela fonte.
      ...(calculada.sinal === "revisar" && whatsapp ? { convite: `https://wa.me/${whatsapp}?text=${encodeURIComponent(mensagemDoConvite(produto, c('empresa') || chave, c('nicho'), new Date(agora)))}` } : {}),
      ...(raioX ? { raioX: raioX.url } : {}),
      // Desde 08/10/2026 o "sim" recebe o Raio-X, não o formulário de 16 perguntas (passo=diagnostico):
      // sem Raio-X feito, não há segunda mensagem pronta, e a Hoje pede para fazê-lo.
      ...(segunda ? { segunda } : {}),
      // Só o reenvio do só-robô tem texto pronto no PRUMO; o follow-up de quem viu segue na conversa vazia.
      ...(reenvioDoRobo && reenvioLink ? { followup: reenvioLink } : {}),
      ...(whatsapp ? { whatsapp: `https://wa.me/${whatsapp}` } : {}),
      ...(planilha ? { planilha } : {}),
    },
    divergencias: [],
  };
}

// ------------------------------------------------------------------ Plus

/** Quantos Plus novos a Hoje mostra de uma vez: o ritmo do WhatsApp (RULES) é de poucos por dia, e 300 itens escondem o resto. */
export const LIMITE_DO_PLUS_NA_HOJE = 10;
export const ROTULO_DA_OFERTA: Record<OfertaDoPlus, string> = { site: "Site", prumo: "Serviços PRUMO", iris: "Iris", estampa: "Estamparia" };

/**
 * Lead Plus (15/10/2026). Sem planilha: o catálogo é um arquivo, e o estado sai só dos registros da aba CRM.
 * Novo = "pronto" (entra em "Primeiro contato para enviar"); `plus_enviado` o leva a Em contato e
 * `plus_respondeu` a "respondeu"; dali valem as regras de sempre (follow-up no 3º dia, 7 dias sem mensagem vira
 * Perdido, proposta, próximo passo, sem contato). O toque no link de envio anota o `plus_enviado` sozinho.
 */
function leadDoPlus(plus: LeadPlus, contexto: { agora: number; registros: Map<string, Registro[]>; geradoEm?: number; conversas?: ContextoDoCrm["conversas"] }): CrmLead {
  const { agora } = contexto;
  const registros = contexto.registros.get(`plus:${plus.id}`) ?? [];
  const { proposta, proximo, semContato, ganho, notas, segundas: segundasAnotadas, followups, enviadoPlus, respondeuPlus } = manuais(registros);
  // Plus: o site do lead conta como link. Desde 17/10/2026 (OT-13) o observador grava a conversa do Plus,
  // então a mensagem dele depois da primeira também vale como resposta (e recomeça os 7 dias) sem o
  // "Respondeu no WhatsApp" à mão, que continua valendo para o que veio por fora (ligação, outro número).
  const conv = conversaDoLead(contexto.conversas, plus.whatsapp, [plus.site], segundasAnotadas, agora);
  const segundas = conv.segundas;
  const convite = enviadoPlus;
  const daConversa = convite !== undefined && conv.ultimaEntrada !== undefined && conv.ultimaEntrada > convite ? conv.ultimaEntrada : undefined;
  const respondeu = maior(respondeuPlus.length ? respondeuPlus[respondeuPlus.length - 1] : undefined, daConversa);
  const base: EtapaCalculada = proposta || convite !== undefined || respondeu !== undefined
    ? etapaDoPrumo({ etapa: convite !== undefined ? "convite_enviado" : "", convite, respondeu, proposta })
    : { etapa: "novo", sinal: "pronto", subEtapa: "Pronto para enviar", desde: contexto.geradoEm };
  const calculada = comPrazoDoContato(comDesfechoManual(base, semContato, ganho), respondeu, convite, proximo, agora, followups);
  const emConversa = calculada.etapa === "contato" && SINAIS_DE_CONVERSA.has(calculada.sinal);
  // O Plus não tem recibo de leitura (não passa pelo observador da planilha): conta como lido.
  const followupHoje = followupDoTerceiroDia({ etapa: calculada.etapa, emConversa, enviado: convite, followups, agora });
  const respostaNova = emConversa && respondeu !== undefined && agora - respondeu <= HORAS_DE_RESPOSTA_NOVA * 60 * 60 * 1000;
  const primeira = primeiraDoPlus(plus);
  const lembrete = followupDoPlus(plus);
  const desde = calculada.desde;
  const eventos: CrmEvento[] = [
    ...evento("encontrado", "No Catálogo de Negócios Maçônicos", contexto.geradoEm, "arquivo plus/leads.json"),
    ...eventoDoPrazo(calculada),
    ...eventosManuais(registros),
  ].sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
  const ultimo = eventos.length ? Date.parse(eventos[eventos.length - 1].em) : undefined;
  const pronto = calculada.sinal === "pronto";
  return {
    id: `plus:${plus.id}`,
    produto: "plus",
    chave: plus.id,
    empresa: plus.empresa,
    nicho: plus.nicho,
    cidade: plus.uf ? `${plus.cidade} - ${plus.uf}` : plus.cidade,
    etapa: calculada.etapa,
    sinal: calculada.sinal,
    subEtapa: calculada.subEtapa,
    ...(calculada.motivoPerda ? { motivoPerda: calculada.motivoPerda } : {}),
    ...desfechoManualDo(calculada, semContato, ganho),
    ...(calculada.diasParaSair !== undefined ? { diasParaSair: calculada.diasParaSair } : {}),
    estadoNaPlanilha: "(Plus: sem planilha)",
    ...(desde !== undefined ? { desde: iso(desde), diasNaEtapa: dias(desde, agora) } : {}),
    ...(ultimo !== undefined ? { ultimoEvento: iso(ultimo), diasDesdeUltimoEvento: dias(ultimo, agora) } : {}),
    leitura: leituraDe(convite, undefined, respondeu, calculada.etapa === "contato"),
    marcos: marcosDoLead(convite, undefined, respondeu, segundas, followups),
    followupHoje,
    respostaNova,
    ...(conv.resumo ? { conversa: conv.resumo } : {}),
    acervo: false,
    ...(proximo ? { proximoPasso: { texto: proximo.texto, data: proximo.data, registradoEm: new Date(proximo.em).toISOString() } } : {}),
    ...(proposta ? { proposta: { em: new Date(proposta.em).toISOString(), data: proposta.data } } : {}),
    notas,
    plus: {
      oferta: plus.oferta,
      fixo: plus.fixo,
      descricao: plus.descricao,
      ...(plus.instagram ? { instagram: plus.instagram } : {}),
      ...(plus.tambem?.length ? { tambem: plus.tambem } : {}),
    },
    ...(pronto && primeira.link ? { mensagemPronta: primeira.texto } : {}),
    eventos,
    links: {
      ...(pronto && primeira.link ? { enviar: primeira.link } : {}),
      ...(followupHoje && lembrete.link ? { followup: lembrete.link } : {}),
      ...(plus.site ? { site: plus.site } : {}),
      ...(plus.whatsapp ? { whatsapp: `https://wa.me/${plus.whatsapp}` } : {}),
      maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${plus.empresa} ${plus.cidade} ${plus.uf}`.trim())}`,
    },
    divergencias: [],
  };
}

// ------------------------------------------------------------------ Triagem: a prioridade

/** "4,5 (10)" ou "4.5 (10)", como o caçador e o Lead Scout gravam a Nota Google; o que não ler fica ausente. */
export function notaDoGoogle(valor: string | undefined): { nota?: number; avaliacoes?: number } {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:\((\d+)\))?/.exec(valor ?? "");
  if (!m) return {};
  const nota = Number(m[1].replace(",", "."));
  const avaliacoes = m[2] !== undefined ? Number(m[2]) : undefined;
  return {
    ...(nota > 0 && nota <= 5 ? { nota } : {}),
    ...(avaliacoes !== undefined && Number.isFinite(avaliacoes) ? { avaliacoes } : {}),
  };
}

// As marcas que o caçador põe na coluna Sinais junto com os sinais do segmento (prumo-ofertas-triar.js):
// não são sinal de nada a favor, então não contam como sinal.
const MARCAS_DO_CACADOR = ["perfil não confirmado", "profissional que atende sozinho", "nenhum sinal no site"];

export interface EntradaDaPrioridade {
  /** A Nota Google crua ("4,5 (10)"). */
  nota?: string;
  /** A coluna Sinais do caçador, " · " entre os itens. */
  sinais?: string;
  origemWhatsapp?: string;
  temSite: boolean;
  temWhatsapp: boolean;
  porte?: PorteDoCnpj;
  /** Pedidos humanos de material / convites do mesmo nicho e oferta, só com amostra mínima. */
  taxaDoNicho?: number;
  /** Os sinais do site já lidos (server/sinais-do-site.ts): só o que tem fonte pesa, e pouco. */
  sinaisDoSite?: SinaisDoSite;
}

/** Nota média que se supõe para quem tem poucas avaliações, e quantas avaliações "valem" essa suposição. */
const NOTA_A_PRIORI = 4.3;
const PESO_DA_NOTA_A_PRIORI = 10;
/** Avaliações que dão o volume inteiro (escala log): 500 é negócio estabelecido no bairro. */
const AVALIACOES_DO_TETO = 500;
/** Convites no nicho para a taxa de resposta valer, e a taxa que já dá os pontos todos. */
export const AMOSTRA_MINIMA_DO_NICHO = 10;
const TAXA_DO_TETO = 0.3;

/**
 * PURA. A Prioridade da Triagem (17/10/2026): de 0 a 100, ordena a revisão humana, não diagnostica a
 * empresa. A do caçador (prumo-ofertas-triar.js) satura: sinais do segmento valiam até 50, e com
 * contato, avaliações e nota o teto de 100 chegava para quase todos (os 1.423 da Triagem ao vivo
 * mostravam "Prioridade 100", e a ordem virava a da data). Esta pesa o que diferencia, com o que o
 * retrato já tem, e cada parte é contínua para quase não empatar:
 *
 * - Dor verificável no Google, até 35: nota baixa até 15 (média bayesiana com prior 4,3/10),
 *   poucas avaliações até 20 em log invertido. Só uma contagem explícita gera pontos de volume;
 *   dado ausente não equivale a zero avaliações. É prioridade de revisão, não diagnóstico.
 * - Contato, até 25: WhatsApp publicado pela empresa (site, link do Google) 25; "não confirmado" (o
 *   celular do Google) 8, porque é quem mais denuncia (trava de ritmo, 15/10); sem WhatsApp, 0.
 * - Site, 10: é onde a revisão confere o perfil; sem site o caçador já marca "perfil não confirmado".
 * - Sinais do segmento, 5 cada, até 15 (eram 10 cada até 50: é aqui que saturava).
 * - Porte conferido pelo CNPJ (EPP ou DEMAIS, só PRUMO), 5.
 * - Nicho, até 10: pedidos humanos de material / convites do mesmo nicho na mesma oferta, com pelo menos
 *   AMOSTRA_MINIMA_DO_NICHO convites (10 × taxa / 30%, teto 10); sem amostra, 5 (neutro: nem prêmio
 *   nem castigo por não saber).
 * - "Profissional que atende sozinho?" (marca do caçador do Iris, que é para clínica com equipe), -20.
 * - Sinais do site (17/10/2026, só quando a Ficha já leu o site do lead; ajusteDaPrioridade): anúncio no ar
 *   +4, sem agendamento online +2, agência já creditada no rodapé -4. Pouco de propósito: o site só é lido
 *   sob demanda, e o sinal desempata, não decide.
 *
 * Arredondada e presa entre 0 e 100. O "não confirmado" continua indo depois de todo confirmado na
 * Hoje (montarHoje): a regra da trava de ritmo vem antes desta conta.
 */
export function prioridadeDaTriagem(e: EntradaDaPrioridade): number {
  const { nota, avaliacoes } = notaDoGoogle(e.nota);
  const n = avaliacoes ?? 1;
  const media = nota === undefined ? undefined : (nota * n + NOTA_A_PRIORI * PESO_DA_NOTA_A_PRIORI) / (n + PESO_DA_NOTA_A_PRIORI);
  const pontosDaNota = media === undefined ? 0 : 15 * Math.min(1, Math.max(0, (4.5 - media) / 1.5));
  const pontosDoVolume = avaliacoes === undefined ? 0 : 20 * (1 - Math.min(1, Math.log10(1 + avaliacoes) / Math.log10(1 + AVALIACOES_DO_TETO)));
  const naoConfirmado = (e.origemWhatsapp ?? "").startsWith("não confirmado");
  const pontosDoContato = !e.temWhatsapp ? 0 : naoConfirmado ? 8 : 25;
  const itens = (e.sinais ?? "").split("·").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const sinais = itens.filter((s) => !MARCAS_DO_CACADOR.some((m) => s.startsWith(m))).length;
  const solo = itens.some((s) => s.startsWith("profissional que atende sozinho"));
  const pontosDoNicho = e.taxaDoNicho === undefined ? 5 : 10 * Math.min(1, Math.max(0, e.taxaDoNicho / TAXA_DO_TETO));
  const total = pontosDaNota + pontosDoVolume + pontosDoContato + (e.temSite ? 10 : 0) + Math.min(15, sinais * 5)
    + (e.porte ? 5 : 0) + pontosDoNicho - (solo ? 20 : 0) + ajusteDaPrioridade(e.sinaisDoSite).pontos;
  return Math.round(Math.min(100, Math.max(0, total)));
}

const chaveDoNicho = (lead: Pick<CrmLead, "produto" | "nicho">) => `${lead.produto}:${normalizarCabecalho(lead.nicho)}`;

/**
 * PURA. Pedidos humanos de material por convite, separados por oferta e nicho. Respostas negativas,
 * exclusões, robôs e um marco de resposta isolado não são interesse. Menos de 10 envios ou nenhum
 * envio não produz taxa: amostra ausente permanece neutra na prioridade.
 */
export function taxasDeInteressePorNicho(leads: ReadonlyArray<Pick<CrmLead, "produto" | "nicho" | "marcos" | "resposta"> & Partial<Pick<CrmLead, 'conversa'>>>, agora = Date.now()): Map<string, number> {
  const contas = new Map<string, { enviados: number; responderam: number }>();
  for (const lead of leads) {
    const enviado = Date.parse(lead.marcos.enviado ?? '');
    if (!(PRODUTOS_DE_PROSPECCAO as readonly string[]).includes(lead.produto) || !lead.nicho || !Number.isFinite(enviado) || enviado > agora) continue;
    const chave = chaveDoNicho(lead);
    const conta = contas.get(chave) ?? { enviados: 0, responderam: 0 };
    conta.enviados += 1;
    const em = lead.resposta?.em ?? lead.marcos.respondeu;
    const soRobo = lead.conversa?.ultima?.direcao === 'entrada' && lead.conversa.ultima.papel === 'robo' && !lead.conversa.ultimaEntrada;
    if (pedeMaterial(lead.resposta) && !soRobo && quemRespondeu(lead) !== 'robo' && (!em || (Date.parse(em) >= enviado && Date.parse(em) <= agora))) conta.responderam += 1;
    contas.set(chave, conta);
  }
  return new Map([...contas].filter(([, c]) => c.enviados >= AMOSTRA_MINIMA_DO_NICHO).map(([chave, c]) => [chave, c.responderam / c.enviados]));
}

/** Compatibilidade dos consumidores existentes; agora mede interesse, nunca resposta bruta. */
export const taxasDeRespostaPorNicho = taxasDeInteressePorNicho;

/** A Prioridade de um lead de prospecção pelo que ele traz no retrato. */
function prioridadeDoLead(lead: CrmLead, taxas: Map<string, number>): number {
  return prioridadeDaTriagem({
    ...(lead.triagem?.nota ? { nota: lead.triagem.nota } : {}),
    ...(lead.triagem?.sinais ? { sinais: lead.triagem.sinais } : {}),
    ...(lead.triagem?.origemWhatsapp ? { origemWhatsapp: lead.triagem.origemWhatsapp } : {}),
    temSite: Boolean(lead.links.site),
    temWhatsapp: Boolean(lead.links.whatsapp),
    ...(lead.porte ? { porte: lead.porte } : {}),
    ...(taxas.has(chaveDoNicho(lead)) ? { taxaDoNicho: taxas.get(chaveDoNicho(lead)) } : {}),
    ...(lead.sinais ? { sinaisDoSite: lead.sinais } : {}),
  });
}

/**
 * PURA. O endereço do site DO LEAD, para os sinais: `undefined` = não se sabe (no Site antes da venda o
 * `links.site` é o demo, e um perfil de rede social no lugar do site também não diz nada do negócio);
 * `null` = o cadastro não traz site; senão o endereço.
 */
export function siteProprioDoLead(lead: Pick<CrmLead, "produto" | "links">): string | null | undefined {
  if (lead.produto === "site") return undefined;
  const site = lead.links.site;
  if (!site) return null;
  return ehSiteProprio(site) ? site : undefined;
}

// ------------------------------------------------------------------ Hoje

const GRUPOS_DE_HOJE: Array<Omit<CrmGrupoHoje, "itens">> = [
  { id: "proximo", titulo: "Próximo passo para hoje", explicacao: "Combinados que você marcou para hoje ou que já passaram da data." },
  { id: "followup", titulo: "Follow-up para mandar", explicacao: `Em contato há ${DIAS_ATE_FOLLOWUP} a ${DIAS_SEM_RESPOSTA - 1} dias e sem resposta (o recibo de leitura não decide mais desde a Fase 3); quem só ouviu o robô, já no dia seguinte, com um reenvio pedindo o responsável. Quem sai do funil antes vem primeiro.` },
  { id: "resposta", titulo: "Respostas para responder", explicacao: "Quem quer ver e ainda não recebeu a 2ª mensagem vem primeiro e fica até ela sair; depois, quem escreveu por último." },
  { id: "revisar", titulo: "Prospects para revisar", explicacao: "Serviços PRUMO, Iris e estamparias na Etapa Revisar: veja o site e decida o convite." },
  { id: "proposta", titulo: "Propostas esperando retorno", explicacao: "Propostas enviadas, do mais antigo para o mais novo." },
  { id: "enviar", titulo: "Primeiro contato para enviar", explicacao: "O botão abre o WhatsApp com a primeira mensagem; o envio é marcado quando ela aparece na conversa. Sem demo, você gera quando o lead pedir." },
];

/** A ação da Hoje para o reenvio do só-robô (o rótulo do link é ROTULO_DO_REENVIO, de site-mensagem.ts). */
export const ACAO_DO_REENVIO = "Só o robô respondeu: pedir quem cuida disso";

function textoDeDias(n: number | undefined, prefixo: string): string {
  if (n === undefined) return "";
  if (n === 0) return `${prefixo} hoje`;
  if (n === 1) return `${prefixo} ontem`;
  return `${prefixo} há ${n} dias`;
}

/** "3 h", "1 dia", "5 dias": quanto o interesse está esperando, pelo relógio (não pelo calendário). */
export function tempoEsperando(ms: number): string {
  const horas = Math.floor(ms / (60 * 60 * 1000));
  if (horas < 24) return `${Math.max(1, horas)} h`;
  const n = Math.floor(ms / DIA_MS);
  return n === 1 ? "1 dia" : `${n} dias`;
}

/**
 * O que a segunda mensagem do Site leva, para o rótulo: o link do site, o raio-x e o demo (Raio-X dentro do demo), ou,
 * com o Raio-X avulso (demo sob pedido, 14/10/2026), só o raio-x antes do demo e só o demo depois do botão "Gerar demo".
 */
export function oQueASegundaLeva(lead: Pick<CrmLead, "links" | "abordagem">): "site" | "raio-x e demo" | "raio-x" | "demo" | "sem demo" {
  // 15/10/2026: recebeu a A sem demo (ou o raio-x avulso sem ser a C): primeiro o "Gerar demo".
  if (lead.abordagem?.mensagem !== "C" || !lead.links.raioX) return lead.links.site || lead.links.segunda ? "site" : "sem demo";
  if (!raioXAvulso(lead.links.raioX)) return "raio-x e demo";
  return lead.links.site ? "demo" : "raio-x";
}

/** A ação do interesse parado há mais de HORAS_ATE_URGENTE: diz há quanto tempo e o que falta mandar. */
export function acaoDoInteresseParado(lead: Pick<CrmLead, "produto" | "links" | "abordagem" | "demoApagadoEm" | "resposta">, esperandoMs: number): string {
  const ha = `há ${tempoEsperando(esperandoMs)}`;
  // A licença não é "quer ver": ele deixou mandar o que foi oferecido, e é só isso que falta.
  if (lead.resposta?.tipo === "licenca") return `Deixou mandar ${ha} — o que ele autorizou ainda não foi mandado`;
  if (lead.produto === "iris" || lead.produto === "estampa") return `Quer saber mais ${ha} — combinar a demonstração`;
  if (lead.produto === "prumo") {
    return lead.links.segunda ? `Quer saber mais ${ha} — o Raio-X ainda não foi mandado`
      : `Quer saber mais ${ha} — o Raio-X ainda não foi feito nem mandado`;
  }
  if (lead.demoApagadoEm) return `Quer ver ${ha}, mas o demo foi apagado: republicar e mandar o link`;
  const leva = oQueASegundaLeva(lead);
  if (leva === "raio-x e demo") return `Quer ver o raio-x ${ha} — o raio-x e o demo ainda não foram mandados`;
  if (leva === "raio-x") return `Quer ver o raio-x ${ha} — o raio-x ainda não foi mandado`;
  if (leva === "demo") return `Pediu o site ${ha} — o demo está pronto e ainda não foi mandado`;
  if (leva === "sem demo") return `Quer ver ${ha} — o demo ainda não foi gerado`;
  return `Quer ver ${ha} — o link ainda não foi mandado`;
}

const ROTULO_DA_SEGUNDA = { site: "Mandar o link do site", "raio-x e demo": "Mandar o raio-x e o demo", "raio-x": "Mandar o raio-x", demo: "Mandar o demo",
  "sem demo": "Mandar o link do site" };
const ACAO_DO_INTERESSE = { site: "Quer ver: mandar o link do site", "raio-x e demo": "Quer ver o raio-x: mandar o raio-x e o demo",
  "raio-x": "Quer ver o raio-x: mandar o raio-x", demo: "Quer o site: mandar o demo",
  "sem demo": "Quer ver: gerar o demo (o link sai quando ele ficar pronto)" };

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
      const enviado = textoDeDias(lead.diasNaEtapa, lead.produto === "site" ? "Enviado" : "Convite enviado");
      // O prazo dito no reenvio: é o que põe os de amanhã na frente (a ordem abaixo) e o que se perde sem ele.
      const prazo = lead.diasParaSair === undefined ? ""
        : ` Sem ele, vai para Perdido ${lead.diasParaSair <= 1 ? "amanhã" : `em ${lead.diasParaSair} dias`}.`;
      itens.followup.push({
        leadId: lead.id,
        acao: lead.reenvioDoRobo ? ACAO_DO_REENVIO : "Mandar follow-up",
        detalhe: lead.reenvioDoRobo
          ? `${enviado}; só a resposta automática respondeu.${prazo} Reenvio único: depois dele, o prazo de ${DIAS_SEM_RESPOSTA} dias recomeça.`
          : `${enviado}, sem resposta · ${leitura(lead)}${lead.testeDoRecibo === "teste" ? " (teste do follow-up sem recibo)" : ""}.`,
        // Com o texto pronto primeiro (o mesmo do aviso do 05, ou o reenvio); a conversa vazia fica de reserva.
        links: lead.links.followup
          ? [{ rotulo: lead.reenvioDoRobo ? ROTULO_DO_REENVIO : ROTULO_DO_FOLLOWUP, url: lead.links.followup }, ...conversa] : conversa,
        // Quem sai do funil antes vem primeiro (os só-robô de 08/10 que expiram amanhã na frente); no
        // mesmo prazo, o envio mais antigo. Sem prazo (segurado por próximo passo), por último.
        ordem: (lead.diasParaSair ?? DIAS_SEM_RESPOSTA) * 1e13 + (Date.parse(lead.marcos.enviado ?? "") || 0),
      });
    }
    if (lead.respostaNova) {
      // "Respondeu ontem" é a ÚLTIMA mensagem de gente (17/10/2026): o marco `respondeu` é a primeira
      // resposta (o funil conta por ele) e, na Baobá, dizia "há 3 dias" de quem tinha escrito ontem.
      const t = maior(...[lead.conversa?.ultimaEntrada, lead.resposta?.tipo !== "bot" ? lead.resposta?.em : undefined, lead.marcos.respondeu]
        .map((v) => instante(v ?? ""))) ?? NaN;
      const r = lead.resposta && lead.resposta.tipo !== "bot" ? lead.resposta : undefined;
      // A última mensagem da conversa é nossa: o cartão nunca afirma o "sim" dele como se fosse agora,
      // diz que você já respondeu e o que ainda falta (o link, o material).
      const jaRespondeu = lead.conversa?.ultima.direcao === "saida";
      const segunda = [
        ...(lead.links.segunda ? [{ rotulo: lead.produto === "prumo" ? "Mandar o Raio-X" : ROTULO_DA_SEGUNDA[oQueASegundaLeva(lead)],
          url: lead.links.segunda }] : []),
        // Demo sob pedido: quem viu o raio-x e quer o site ganha o demo com um toque (sai em ~20 a 40 min).
        ...(lead.links.gerarDemo ? [{ rotulo: "Gerar demo", url: lead.links.gerarDemo }] : []),
      ];
      const parado = lead.interesseParado;
      const desde = Date.parse(parado?.desde ?? "");
      const urgente = parado !== undefined && Number.isFinite(desde) && agora - desde >= HORAS_ATE_URGENTE * 60 * 60 * 1000;
      const base = urgente ? acaoDoInteresseParado(lead, agora - desde)
        : r?.tipo === "licenca" ? "Deixou mandar: mandar o que ele autorizou"
        : r?.tipo === "interesse" ? (lead.produto === "iris" || lead.produto === "estampa" ? "Quer saber mais: combinar a demonstração"
          : lead.produto === "prumo"
          ? (lead.links.segunda ? "Quer saber mais: mandar o Raio-X" : "Quer saber mais: fazer o Raio-X e mandar")
          : lead.demoApagadoEm ? "Quer ver, mas o demo foi apagado: republicar antes de mandar o link"
          : ACAO_DO_INTERESSE[oQueASegundaLeva(lead)])
          : "Responder no WhatsApp";
      itens.resposta.push({
        leadId: lead.id,
        acao: jaRespondeu && !urgente && pedeMaterial(r) ? `Você já respondeu; falta ${base.replace(/^[^:]*:\s*/, "")}` : base,
        detalhe: [
          Number.isFinite(t) ? `${textoDeDias(dias(t, agora), "Respondeu")}.` : "Escreveu por último.",
          ...(r?.trecho ? [`“${textoParaATela(r.trecho)}”`] : []),
          ...(jaRespondeu ? ["A última mensagem da conversa é sua."] : []),
          // A regra dos 7 dias continua valendo para o interesse parado: dizer quanto falta é o empurrão.
          ...(parado && lead.diasParaSair !== undefined
            ? [`Sem mensagem dele, vai para Perdido ${lead.diasParaSair <= 1 ? "amanhã" : `em ${lead.diasParaSair} dias`}.`] : []),
        ].join(" "),
        links: pedeMaterial(r) ? [...segunda, ...conversa] : [...conversa, ...segunda],
        // Interesse parado na frente, o que espera há mais tempo primeiro; depois as demais respostas.
        ordem: (parado ? 0 : 1e13) + (parado && Number.isFinite(desde) ? desde : Number.isFinite(t) ? t : 0),
        ...(urgente ? { urgente: true } : {}),
      });
    }
    if (lead.sinal === "revisar") {
      const tr = lead.triagem;
      const naoConfirmado = (tr?.origemWhatsapp ?? "").startsWith("não confirmado");
      itens.revisar.push({
        leadId: lead.id,
        acao: naoConfirmado ? "Conferir o WhatsApp e decidir o convite" : "Ver o site e decidir o convite",
        detalhe: [
          `${lead.nicho || "Sem segmento"}${lead.cidade ? ` · ${lead.cidade}` : ""} · ${textoDeDias(lead.diasNaEtapa, "encontrado") || "sem data"}.`,
          // A triagem: quão na frente ela vem (prioridadeDaTriagem) e o que o caçador achou (Iris, estamparias).
          ...(tr?.prioridade !== undefined ? [`Prioridade ${tr.prioridade}${tr.nota ? ` · nota ${tr.nota}` : ""}${tr.sinais ? ` · ${tr.sinais}` : ""}.`] : []),
          ...(naoConfirmado ? ["WhatsApp não confirmado (é o celular do Google): confira no Instagram ou no Maps antes do convite."] : []),
        ].join(" "),
        links: [
          ...(lead.links.site ? [{ rotulo: "Ver o site da empresa", url: lead.links.site }] : []),
          ...(lead.links.maps ? [{ rotulo: "Ver no Google Maps", url: lead.links.maps }] : []),
          ...(lead.links.convite ? [{ rotulo: "Abrir convite no WhatsApp (não registra envio)", url: lead.links.convite }] : []),
        ],
        // Maior Prioridade primeiro (14/10/2026); desde 17/10 todo prospect em Revisar tem a da Central
        // (prioridadeDaTriagem), e o PRUMO entra na mesma ordem. Sem Prioridade, depois, pela data como antes.
        // 15/10/2026 (trava de ritmo): o WhatsApp publicado pela empresa vem antes de qualquer "não
        // confirmado" (o celular do Google, muitas vezes o pessoal do dono, que é quem mais denuncia).
        // Com o teto do dia baixo, os convites vão primeiro para quem escolheu o WhatsApp como canal.
        ordem: (tr?.prioridade === undefined ? 1000 : (naoConfirmado ? 200 : 100) - tr.prioridade) * 1e13 + (Date.parse(lead.desde ?? "") || 0),
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
      // Plus: saudação maçônica, sem demo a gerar. O fixo pede conferir o número antes (o WhatsApp Business roda em fixo, mas não é certo).
      const ehPlus = lead.produto === "plus" && lead.plus;
      itens.enviar.push({
        leadId: lead.id,
        acao: lead.links.enviar ? (ehPlus ? "Plus: mandar a primeira mensagem" : "Mandar a primeira mensagem") : "Sem WhatsApp válido na planilha",
        detalhe: `${lead.nicho || "Sem nicho"}${lead.cidade ? ` · ${lead.cidade}` : ""} · ${textoDeDias(lead.diasNaEtapa, "pronto") || "sem data"}.`
          + (ehPlus
            ? ` Oferta: ${ROTULO_DA_OFERTA[lead.plus!.oferta]}.${lead.plus!.fixo ? " Telefone fixo: confira se tem WhatsApp." : ""}`
            : lead.links.site ? "" : " Ainda sem demo: gere quando ele pedir."),
        links: [
          ...(lead.links.enviar ? [{ rotulo: "Enviar pelo WhatsApp", url: lead.links.enviar }] : []),
          ...(lead.links.site ? [{ rotulo: "Ver o demo", url: lead.links.site }] : []),
        ],
        // Quem dá para enviar com um toque vem antes; dentro de cada parte, o mais antigo primeiro.
        // O Plus vem na frente (são os melhores leads); dentro dele, o fixo por último.
        ordem: lead.produto === "plus" ? (lead.plus?.fixo ? -5e12 : -1e13) + (Date.parse(lead.desde ?? "") || 0)
          : (lead.links.enviar ? 0 : 1e13) + (Date.parse(lead.desde ?? "") || 0),
      });
    }
  }
  // Só os primeiros Plus: o resto está no filtro Plus e no Funil.
  const ehDoPlus = new Set(leads.filter((l) => l.produto === "plus").map((l) => l.id));
  let plusNaHoje = 0;
  itens.enviar = itens.enviar.sort((a, b) => a.ordem - b.ordem).filter((i) => !ehDoPlus.has(i.leadId) || ++plusNaHoje <= LIMITE_DO_PLUS_NA_HOJE);
  return GRUPOS_DE_HOJE.map((grupo) => ({
    ...grupo,
    itens: itens[grupo.id].sort((a, b) => a.ordem - b.ordem),
  }));
}

// ------------------------------------------------------------------ visão

function contagemVazia(): Record<CrmEtapa, CrmContagem> {
  return Object.fromEntries(ETAPAS.map((etapa) => [etapa, { total: 0, ...Object.fromEntries(PRODUTOS.map((p) => [p, 0])) }])) as Record<CrmEtapa, CrmContagem>;
}

const NOME_DA_FONTE: Record<CrmFonteId, string> = {
  site: "Leads — Site antes da venda",
  prumo: "PRUMO — Prospects",
  iris: "PRUMO — Clínicas (Iris)",
  estampa: "PRUMO — Estamparias (CRM de estamparia)",
  plus: "Plus — Catálogo de Negócios Maçônicos",
  registros: "Aba CRM (notas e próximos passos)",
};

export function visaoSemRetrato(agora: Date, estado: "sem-retrato" | "retrato-invalido", mensagem: string, contexto: Partial<ContextoDoCrm> = {}): CrmVisao {
  return {
    estado,
    mensagem,
    minutosAteVelho: MINUTOS_ATE_RETRATO_VELHO,
    fontes: [],
    colunasAusentes: [],
    contagens: contagemVazia(),
    perdas: { recusou: 0, expirou: 0, esfriou: 0, descartado: 0, semInteresse: 0 },
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
  const raioX = new Map((contexto.raioX ?? []).map((r) => [r.prospectId, r]));
  const idsDoSite = new Set<string>();
  const leads: CrmLead[] = [];
  for (const linha of retrato.fontes.site.linhas) {
    const lead = leadDoSite(linha, { agora, pastaPorId, registros, links: retrato.links, pastasLidas, conversas: contexto.conversas });
    if (!lead || idsDoSite.has(lead.chave)) continue;
    idsDoSite.add(lead.chave);
    leads.push(lead);
  }
  const idsDoPlus = new Set<string>();
  const geradoPlus = instante(contexto.plus?.geradoEm ?? "");
  for (const plus of contexto.plus?.leads ?? []) {
    if (idsDoPlus.has(plus.id)) continue;
    idsDoPlus.add(plus.id);
    leads.push(leadDoPlus(plus, { agora, registros, conversas: contexto.conversas, ...(geradoPlus !== undefined ? { geradoEm: geradoPlus } : {}) }));
  }
  for (const produto of PRODUTOS_DE_PROSPECCAO) {
    const ids = new Set<string>();
    for (const linha of retrato.fontes[produto].linhas) {
      const lead = leadDoPrumo(linha, { agora, registros, links: retrato.links, mapas, raioX, conversas: contexto.conversas }, produto);
      if (!lead || ids.has(lead.chave)) continue;
      ids.add(lead.chave);
      leads.push(lead);
    }
  }
  // A Prioridade da Triagem (17/10/2026) troca a do caçador, que saturava em 100: depende da taxa do
  // nicho, que só se sabe com todos os leads lidos. Só onde ela serve (Novo, a revisão) ou onde a
  // planilha já trazia uma, para a ficha não mostrar dois números.
  const taxas = taxasDeInteressePorNicho(leads, agora);
  for (const lead of leads) {
    lead.qualificacaoComercial = projetarQualificacaoComercial(lead, agora);
    const confirmados = (registros.get(lead.id) ?? []).filter(r => r.tipo === 'spiced' && r.em <= agora);
    for (const r of confirmados) {
      const s = lerRegistroSpiced(r.texto);
      if (s) lead.spiced = s;
    }
  }
  // Os sinais do site (17/10/2026) entram antes da Prioridade: só a leitura já guardada, que vale para o
  // endereço de agora (se o site do lead mudou, a leitura velha não conta). Nada aqui chama a rede.
  for (const lead of leads) {
    const site = siteProprioDoLead(lead);
    if (site === null) lead.sinais = extrairSinais({ url: null });
    else if (site) {
      const lido = contexto.sinaisDoSite?.get(lead.id);
      if (lido && lido.url === site) lead.sinais = lido.sinais;
    }
  }
  for (const lead of leads) {
    if (!(PRODUTOS_DE_PROSPECCAO as readonly string[]).includes(lead.produto)) continue;
    if (lead.etapa !== "novo" && lead.triagem?.prioridade === undefined) continue;
    lead.triagem = { ...lead.triagem, prioridade: prioridadeDoLead(lead, taxas) };
  }
  const aberturasPrumo = alocarAberturasPrumo(leads.filter(l => l.produto === 'prumo').map(l => {
    const confirmado = ultimoConviteConfirmado(l.eventos);
    let controle = confirmado?.mensagem ?? '';
    try { controle = new URL(l.links.convite ?? '').searchParams.get('text') ?? controle } catch { /* sem convite: sem rascunho */ }
    return { id: l.id, empresa: l.empresa, nicho: l.nicho, enviado: l.etapa !== 'novo' || Boolean(l.marcos.enviado), controle,
      raio_x_url: l.links.raioX, raio_x_achados: l.achados,
      ...(confirmado?.abertura ? { salva: { ...confirmado.abertura, mensagem: confirmado.mensagem } } : {}) };
  }));
  for (const l of leads) {
    const abertura = l.produto === 'prumo' ? aberturasPrumo.get(l.id) : undefined;
    if (!abertura) continue;
    l.abordagem = { ...l.abordagem, mensagem: abertura.mensagem_variante, elegiveis: abertura.ab_elegiveis };
    if (l.etapa === 'novo' && l.links.convite) {
      const url = new URL(l.links.convite); url.searchParams.set('text', abertura.mensagem); l.links.convite = url.href;
    }
  }
  const contagens = contagemVazia();
  for (const lead of leads) {
    const mensagens = contexto.conversas?.get(chaveDoNumero(lead.links.whatsapp));
    const leitura = classificarResposta(lead, mensagens, agora);
    lead.classificacaoResposta = leitura;
    // Sem conversa, não reescrever a interpretação legada: a insuficiência fica explícita na leitura.
    const efetiva = mensagens?.length ? respostaParaAcompanhamento(lead.resposta, leitura) : lead.resposta;
    if (efetiva !== lead.resposta) {
      lead.respostaFonte = lead.resposta;
      lead.resposta = efetiva;
      if (lead.etapa === 'contato' && !lead.subEtapa.startsWith('Conversa sem retorno') && ['respondeu', 'respondeu-prumo', 'em-conversa'].includes(lead.sinal)) {
        lead.subEtapa = `Respondeu no WhatsApp: ${ROTULOS_DA_CLASSIFICACAO[leitura.classe]}`;
      }
    }
    if (mensagens?.length && !leitura.materialSolicitado && leitura.classe !== 'interesse') delete lead.interesseParado;
    const revisao = revisaoDaClassificacao(lead);
    lead.aarr = aarrDoLead(lead, agora);
    const proximoFuturo = lead.proximoPasso?.data && lead.proximoPasso.data > new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);
    if (proximoFuturo || contatoPausado(lead)) lead.followupHoje = false;
    if (revisao?.decisao === 'reabrir') {
      lead.etapa = 'contato';
      lead.sinal = lead.marcos.respondeu ? (lead.produto === 'site' ? 'em-conversa' : 'respondeu-prumo') : (lead.produto === 'site' ? 'enviado' : 'convite');
      lead.subEtapa = 'Acompanhamento reaberto por você';
      delete lead.motivoPerda; delete lead.perdaManual; delete lead.ganhoManual; delete lead.diasParaSair;
      lead.followupHoje = false; lead.respostaNova = false; delete lead.interesseParado;
    }
    const ciclo = cicloDoLead(lead, agora);
    const cadencia = ciclo.historico.length ? undefined : cadenciaDoLead(lead, agora);
    if (cadencia?.estado === 'expirar') {
      lead.etapa = 'perdido'; lead.sinal = 'esfriou'; lead.motivoPerda = 'proposta-sem-retorno';
      lead.subEtapa = 'Proposta sem retorno'; lead.desde = new Date(cadencia.base + 10 * DIA_MS).toISOString();
      lead.diasNaEtapa = dias(Date.parse(lead.desde), agora); lead.respostaNova = false; lead.followupHoje = false;
    }
    lead.revisaoComercial = revisao ? undefined : revisaoComercialDoLead(lead, agora);
    lead.demoProtegida = protecaoDaDemo(lead);
    if (lead.revisaoComercial) {
      lead.respostaNova = false;
      lead.followupHoje = false;
      delete lead.interesseParado;
    }
    if (ciclo.envios.length && !lead.perdaManual && !['recusou','recusou-pasta','sem-interesse','descartado'].includes(lead.sinal) && !['negativa','exclusao'].includes(lead.resposta?.tipo ?? '')) {
      const envio = ciclo.envios.at(-1)!;
      const em = lead.eventos.find(e => lerEventoCiclo(e.registroTexto ?? e.texto ?? '', agora)?.id === envio.id)?.em ?? `${envio.data}T12:00:00-03:00`;
      lead.proposta = { em, data: envio.data };
      if (lead.etapa !== 'ganho') {
        lead.etapa = 'proposta'; lead.sinal = 'proposta';
        lead.subEtapa = ciclo.recebido ? 'Recebimento confirmado · confira saldo e entrega' : ciclo.aceites.length ? 'Aceite registrado · conferir cobrança e pagamento' : 'Proposta enviada · aguardando decisão';
        delete lead.motivoPerda; delete lead.diasParaSair;
      }
      lead.followupHoje = false;
    }
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
    fontes: ([...PRODUTOS, "registros"] as const).map((id) => ({
      id,
      nome: NOME_DA_FONTE[id],
      linhas: id === "plus" ? idsDoPlus.size : retrato.fontes[id].linhas.length,
      ...(id !== "plus" && retrato.fontes[id].erro ? { erro: retrato.fontes[id].erro } : {}),
    })),
    colunasAusentes: [
      ...colunasAusentes(COLUNAS_DO_SITE, retrato.fontes.site.colunas, "Leads"),
      ...colunasAusentes(COLUNAS_DO_PRUMO, retrato.fontes.prumo.colunas, "Prospects"),
    ],
    contagens,
    perdas: {
      recusou: leads.filter((l) => l.motivoPerda === "recusou").length,
      expirou: leads.filter((l) => l.motivoPerda === "expirou").length,
      esfriou: leads.filter((l) => l.motivoPerda === "esfriou" || l.motivoPerda === "proposta-sem-retorno").length,
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
  constructor(message: string, readonly naoEnviado = true) {
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
  if (!ehProduto(produto)) throw new RegistroInvalido("Produto inválido.");
  const id = typeof corpo.id === "string" ? corpo.id.trim() : "";
  if (!/^[A-Za-z0-9_-]{3,200}$/.test(id)) throw new RegistroInvalido("Lead inválido.");
  const tipo = corpo.tipo as CrmTipoDeRegistro;
  if (!TIPOS_DE_REGISTRO.includes(tipo)) throw new RegistroInvalido("Tipo de registro inválido.");
  const bruto = typeof corpo.texto === "string" ? corpo.texto.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim() : "";
  if (bruto.length > 1000) throw new RegistroInvalido("O texto deve ter no máximo 1000 caracteres.");
  if (tipo === 'spiced' && (typeof corpo.texto !== 'string' || !lerRegistroSpiced(corpo.texto))) {
    throw new RegistroInvalido('SPICED inválido: confira os campos, limites e a data real do evento crítico.');
  }
  if (tipo === 'cadencia_enviada' && !lerRegistroCadencia(corpo.texto)) throw new RegistroInvalido('Confirmação de acompanhamento inválida.');
  const aarr = ehTipoAarr(tipo) ? lerRegistroAarr(tipo, corpo.texto, agora.getTime()) : undefined;
  if (ehTipoAarr(tipo) && (!aarr || !registroCompativelComLead({ produto, ...(produto === 'plus' ? { plus: undefined } : {}) }, aarr) && produto !== 'plus')) throw new RegistroInvalido('Registro comercial inválido: confira catálogo, referência e datas reais até hoje.');
  // Texto vai como está: o n8n grava com cellFormat RAW, então "=..." fica texto e nunca vira fórmula.
  let estruturada: string | undefined;
  if (tipo === 'nota' && typeof corpo.texto === 'string' && (corpo.texto.trim().startsWith('[ciclo-comercial-v1]') || corpo.texto.trim().startsWith('[qualificacao-comercial-v1]'))) {
    const ciclo = lerEventoCiclo(corpo.texto, agora.getTime());
    const q = lerNotaQualificacaoComercial(corpo.texto, agora.getTime());
    if (!ciclo && !q) throw new RegistroInvalido('Nota comercial inválida: confira campos, confirmação humana e datas reais.');
    estruturada = ciclo ? textoEventoCiclo(ciclo, agora.getTime()) : textoDaQualificacaoComercial(q!, agora.getTime());
  }
  const textoSeguro = estruturada ?? (aarr ? JSON.stringify(aarr) : tipo === 'spiced' ? JSON.stringify(lerRegistroSpiced(corpo.texto)) : tipo === 'cadencia_enviada' ? JSON.stringify(lerRegistroCadencia(corpo.texto)) : bruto);
  if (tipo === "nota" && !textoSeguro) throw new RegistroInvalido("Escreva a nota.");
  let data = typeof corpo.data === "string" ? corpo.data.trim() : "";
  if (aarr) data = 'data' in aarr ? aarr.data : '';
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new RegistroInvalido("Data inválida (use AAAA-MM-DD).");
  if (data && !Number.isFinite(Date.parse(`${data}T12:00:00-03:00`))) throw new RegistroInvalido("Data inválida.");
  if (tipo === "proximo_passo" && textoSeguro && !data) throw new RegistroInvalido("Informe a data do próximo passo.");
  if (tipo === "proposta" && !data) data = hojeEmSP(agora);
  // Ganho e dispensa (AC-08, AC-10) levam o dia, como a proposta: "fechou ontem" anotado hoje conta de ontem.
  if (TIPOS_DE_DESFECHO_DATADO.has(tipo) && !data) data = hojeEmSP(agora);
  if (tipo === "spiced" || tipo === "nota" || tipo === "proposta_desfeita" || tipo === "sem_contato" || tipo === "sem_contato_desfeito" || TIPOS_DE_ENVIO.has(tipo)) data = "";
  return { produto, id, tipo, texto: textoSeguro, data };
}

export interface ConfigDoCrm {
  retrato: string;
  registroUrl?: string;
  segredoArquivo?: string;
  autoDirectory?: string;
  entregasPrumo?: string;
  /** A pasta das conversas que o observador grava (WHATSAPP_CONVERSAS_DIR); ausente = a visão sem conversa. */
  conversas?: string;
  journalComercial?: string;
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
    conversas: caminho(entrada.conversas, pastaDasConversas(process.env, home)),
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

/**
 * Os Raio-X do PRUMO feitos à mão (09/10/2026, primeiro: Roda Mais): `<entregas>/prumo-raio-x/leads.json`
 * = { "<ID do prospect>": { "url": "https://...", "feito_em": "AAAA-MM-DD", "achados"?: [...] } } (`achados`, opcional,
 * no formato do `raio_x_achados` do raio-x.py: a Ficha usa para a oferta). O arquivo fica fora do
 * deploy (.vercelignore): os IDs não vão para a página pública. Ilegível ou ausente = nenhum Raio-X.
 */
async function lerRaioX(diretorio: string | undefined): Promise<RaioXDoPrumo[]> {
  if (!diretorio) return [];
  let dados: unknown;
  try {
    dados = JSON.parse(await fs.readFile(path.join(diretorio, "prumo-raio-x", "leads.json"), "utf8"));
  } catch {
    return [];
  }
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return [];
  const saida: RaioXDoPrumo[] = [];
  for (const [prospectId, valor] of Object.entries(dados as Record<string, unknown>).slice(0, 500)) {
    const v = (valor && typeof valor === "object" ? valor : {}) as Record<string, unknown>;
    const url = texto(v.url, 300);
    const feitoEm = texto(v.feito_em, 64);
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(prospectId) || !urlHttps(url)) continue;
    const achados = achadosDoRecibo(v.achados);
    saida.push({ prospectId, url, feitoEm, ...(achados ? { achados } : {}) });
  }
  return saida;
}

/**
 * Os leads Plus (15/10/2026): `<entregas>/plus/leads.json`, gerado por scripts/plus-importar.ts a partir do
 * catálogo em PDF. Fica fora do repositório (nomes e telefones de terceiros). Ausente ou ilegível = filtro Plus vazio.
 */
export async function lerPlus(diretorio: string | undefined): Promise<PlusLido> {
  if (!diretorio) return { leads: [] };
  let dados: unknown;
  let modificado: string | undefined;
  const arquivo = path.join(diretorio, "plus", "leads.json");
  try {
    dados = JSON.parse(await fs.readFile(arquivo, "utf8"));
    modificado = (await fs.stat(arquivo)).mtime.toISOString();
  } catch {
    return { leads: [] };
  }
  const bruto = (dados && typeof dados === "object" ? dados : {}) as Record<string, unknown>;
  const importado = texto(bruto.geradoEm, 64);
  const lista = Array.isArray(bruto.leads) ? bruto.leads : [];
  const ofertas: readonly string[] = ["site", "prumo", "iris", "estampa"];
  const leads: LeadPlus[] = [];
  for (const item of lista.slice(0, 2000)) {
    const v = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const id = texto(v.id, 200);
    const whatsapp = texto(v.whatsapp, 20).replace(/\D/g, "");
    const oferta = texto(v.oferta, 20);
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(id) || !/^55\d{10,11}$/.test(whatsapp) || !ofertas.includes(oferta)) continue;
    const site = urlHttps(v.site);
    const instagram = texto(v.instagram, 60).replace(/[^A-Za-z0-9._]/g, "");
    const tambem = Array.isArray(v.tambem) ? v.tambem.map((n) => texto(n, 120)).filter(Boolean).slice(0, 5) : [];
    leads.push({
      id,
      empresa: texto(v.empresa, 160) || id,
      nicho: texto(v.nicho, 60),
      cidade: texto(v.cidade, 80),
      uf: texto(v.uf, 2).toUpperCase(),
      whatsapp,
      fixo: v.fixo === true,
      ...(site ? { site } : {}),
      ...(instagram ? { instagram } : {}),
      oferta: oferta as OfertaDoPlus,
      descricao: texto(v.descricao, 300),
      ...(tambem.length ? { tambem } : {}),
    });
  }
  return { geradoEm: Number.isFinite(Date.parse(importado)) ? new Date(importado).toISOString() : modificado, leads };
}

export interface RespostaDoRegistro {
  ok: true;
  em: string;
  /** O mesmo envio já tinha sido anotado há menos de JANELA_DE_REPETICAO_MS: nada foi gravado de novo. */
  repetido?: true;
  estado?: 'aguardando_projecao' | 'projetado';
}

/** Em contato e já falou com a gente: onde a 2ª mensagem faz sentido (o mesmo critério do cálculo). */
const emConversaNoLead = (lead: Pick<CrmLead, "etapa" | "sinal">) => lead.etapa === "contato" && SINAIS_DE_CONVERSA.has(lead.sinal);

/**
 * Regras de quando cada envio pode ser anotado. PURA: lança RegistroInvalido com o motivo.
 * A 2ª mensagem só existe depois de uma resposta (Em contato, em conversa); o follow-up só para
 * quem está Em contato e nunca respondeu. Lead encerrado não recebe nenhum dos dois.
 */
export function conferirEnvio(tipo: CrmTipoDeRegistro, lead: Pick<CrmLead, "etapa" | "sinal">): void {
  if (!TIPOS_DE_ENVIO.has(tipo)) return;
  if (lead.etapa === "ganho" || lead.etapa === "perdido") throw new RegistroInvalido("Este lead já está encerrado.");
  if (tipo === "plus_enviado" && lead.sinal !== "pronto") throw new RegistroInvalido("Este lead Plus já recebeu a primeira mensagem.");
  if (tipo === "segunda_enviada" && !emConversaNoLead(lead)) throw new RegistroInvalido("A 2ª mensagem só vale para quem já respondeu (Em contato, em conversa).");
  if (tipo === "followup_enviado" && (lead.etapa !== "contato" || emConversaNoLead(lead))) {
    throw new RegistroInvalido("O follow-up só vale para quem está Em contato e ainda não respondeu.");
  }
}

/**
 * Quando o ganho e a dispensa podem ser marcados (AC-08, AC-10). PURA: lança RegistroInvalido com o
 * motivo. Ganhar vale de qualquer etapa menos Ganho (quem saiu e fechou por fora fechou); dispensar
 * só quem ainda está em Novo, porque é a decisão da Triagem antes do primeiro contato: quem já
 * conversou sai pela recusa ou pelo "sem contato fácil", que dizem o que aconteceu. O desfazer só
 * vale para o que a Central marcou (o da planilha se desfaz na planilha).
 */
export function conferirDesfecho(tipo: CrmTipoDeRegistro, lead: Pick<CrmLead, "etapa" | "perdaManual" | "ganhoManual">): void {
  if (tipo === "ganhou" && lead.etapa === "ganho") throw new RegistroInvalido("Este lead já está em Ganho.");
  if (tipo === "ganhou_desfeito" && lead.ganhoManual !== true) throw new RegistroInvalido("O ganho deste lead não foi marcado na Central.");
  if (tipo === "dispensado" && lead.etapa !== "novo") {
    throw new RegistroInvalido(lead.etapa === "ganho" || lead.etapa === "perdido" ? "Este lead já está encerrado."
      : "Só quem ainda não recebeu contato sai pela Triagem; marque a recusa ou o sem contato fácil.");
  }
  if (tipo === "dispensado_desfeito" && lead.perdaManual !== "dispensado") throw new RegistroInvalido("Este lead não foi dispensado na Triagem.");
}

/** O mesmo envio no retrato há pouco (o n8n já refez o retrato depois do primeiro toque)? */
export function envioRecenteNoLead(lead: Pick<CrmLead, "eventos">, tipo: CrmTipoDeRegistro, agora: number): string | undefined {
  if (!TIPOS_DE_ENVIO.has(tipo)) return undefined;
  return lead.eventos.find((e) => e.tipo === tipo && e.origem === "manual" && Math.abs(agora - Date.parse(e.em)) < JANELA_DE_REPETICAO_MS)?.em;
}

function chaveComercialDoRegistro(registro: { tipo: string; texto: string }, oportunidade: string, agora: number, ocorrencia = 0): ChaveComercial | undefined {
  const ciclo = registro.tipo === 'nota' ? lerEventoCiclo(registro.texto, agora) : null;
  const q = registro.tipo === 'nota' ? lerNotaQualificacaoComercial(registro.texto, agora) : null;
  const aarr = ehTipoAarr(registro.tipo) ? lerRegistroAarr(registro.tipo, registro.texto, agora) : null;
  if (!ciclo && !q && !aarr) return undefined;
  const hash = hashCanonicoComercial(ciclo ?? q ?? { tipo: registro.tipo, registro: aarr });
  return { oportunidade, id: ciclo?.id ?? q?.id ?? `legado-${hash}-${ocorrencia}`, hash };
}

export class CrmStore {
  private readonly aarrEmCurso = new Map<string, Promise<RespostaDoRegistro>>();
  private readonly journalComercial: RegistroComercialDuravel;
  private readonly cadenciasConfirmadas = new Map<string, Promise<RespostaDoRegistro>>();
  /**
   * Envios anotados por este processo há pouco, por produto:id:tipo. O retrato leva segundos para
   * refletir o registro e um clique duplo chega antes: sem isto, um toque viraria dois envios na
   * planilha e o Resultados contaria follow-up em dobro. Só memória: depois de reiniciar, vale o retrato.
   */
  private readonly enviosRecentes = new Map<string, { em: number; resposta: Promise<RespostaDoRegistro> }>();

  /**
   * As leituras de sinais do site já feitas (server/sinais-do-site-leitor.ts), só do cache em memória:
   * a visão nunca vai à rede por causa delas. Ligado pelo server.ts, só no operations.
   */
  sinaisDoSite?: () => ReadonlyMap<string, { url: string; sinais: SinaisDoSite }>;

  constructor(readonly config: ConfigDoCrm, private readonly fetcher: typeof fetch = fetch) {
    this.journalComercial = new RegistroComercialDuravel(config.journalComercial ?? path.join(path.dirname(config.retrato), 'crm-registro-comercial-journal.json'));
  }

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

  /**
   * A visão guardada por `ttlDaVisaoMs` (19/10/2026). Cada chamada relê as pastas, os mapas, o Raio-X, o
   * Plus e até 3000 JSONL de conversa, e o copiloto, o vendedor, o lead quente, as abas e o Assistente a
   * pediam, cada um, a cada minuto. A promessa em voo é compartilhada (duas chamadas juntas montam uma
   * visão só) e toda escrita que passa por aqui a descarta. Quem passa `agora` (os testes, a validação
   * de um registro) quer a leitura daquele instante e não usa o cache.
   */
  ttlDaVisaoMs = TTL_DA_VISAO_MS;
  private visaoGuardada: { em: number; promessa: Promise<CrmVisao> } | null = null;

  visao(agora?: Date): Promise<CrmVisao> {
    if (agora) return this.montarVisao(agora);
    const hoje = Date.now();
    if (this.visaoGuardada && hoje - this.visaoGuardada.em < this.ttlDaVisaoMs) return this.visaoGuardada.promessa;
    const entrada = { em: hoje, promessa: this.montarVisao(new Date(hoje)) };
    this.visaoGuardada = entrada;
    // Leitura que falhou não fica guardada: a próxima tenta de novo.
    entrada.promessa.catch(() => { if (this.visaoGuardada === entrada) this.visaoGuardada = null; });
    return entrada.promessa;
  }

  /** Descarta a visão guardada: a próxima chamada relê tudo. */
  invalidarVisao(): void {
    this.visaoGuardada = null;
  }

  private async montarVisao(agora: Date): Promise<CrmVisao> {
    const [leitura, mapas, raioX, plus, registroDisponivel, ultimaFalha, conversas] = await Promise.all([
      this.config.autoDirectory ? lerPastasDosLeads(this.config.autoDirectory).catch((error) => {
        console.error("[crm] Falha ao ler ~/auto-site:", error);
        return undefined;
      }) : Promise.resolve(undefined),
      lerMapas(this.config.entregasPrumo).catch(() => []),
      lerRaioX(this.config.entregasPrumo),
      lerPlus(this.config.entregasPrumo),
      this.disponibilidade(),
      this.ultimaFalha(),
      // A conversa dos leads (16/10/2026): sem ela, a visão segue só com a planilha.
      (this.config.conversas ? lerConversas(this.config.conversas) : Promise.resolve(undefined)).catch((error) => {
        console.error("[crm] Falha ao ler as conversas do WhatsApp:", error);
        return undefined;
      }),
    ]);
    const contexto: ContextoDoCrm = {
      agora,
      ...(leitura ? { pastas: leitura.pastas, gerador: leitura.gerador } : {}),
      mapas,
      raioX,
      plus,
      registroDisponivel,
      ...(ultimaFalha ? { ultimaFalha } : {}),
      ...(conversas ? { conversas } : {}),
      ...(this.sinaisDoSite ? { sinaisDoSite: this.sinaisDoSite() } : {}),
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

  /**
   * Nota, próximo passo, proposta ou envio anotado: vai para a aba CRM da planilha pelo n8n. A Central
   * não guarda nada além da memória curta de envios recentes (idempotência do clique duplo).
   */
  async registrar(entrada: unknown, agora = new Date()): Promise<RespostaDoRegistro> {
    const registro = validarRegistro(entrada, agora);
    if (ehTipoAarr(registro.tipo) || registro.tipo === 'nota' && ehNotaComercial(registro.texto)) {
      // Serializar por lead protege dois cliques/abas, inclusive desfazer e corrigir em sequência.
      const chave = `${registro.produto}:${registro.id}`;
      const anterior = this.aarrEmCurso.get(chave);
      if (anterior) { await anterior.catch(() => undefined); return this.registrar(entrada, agora) }
      const resposta = this.gravar(registro, agora);
      this.aarrEmCurso.set(chave, resposta);
      try { return await resposta } finally { if (this.aarrEmCurso.get(chave) === resposta) this.aarrEmCurso.delete(chave) }
    }
    if (registro.tipo === 'cadencia_enviada') {
      const chave = `${registro.produto}:${registro.id}:${registro.texto}`;
      const anterior = this.cadenciasConfirmadas.get(chave);
      if (anterior) return { ...await anterior, repetido: true };
      const resposta = this.gravar(registro, agora);
      this.cadenciasConfirmadas.set(chave, resposta);
      try { return await resposta } catch (e) { this.cadenciasConfirmadas.delete(chave); throw e }
    }
    if (!TIPOS_DE_ENVIO.has(registro.tipo)) return this.gravar(registro, agora);
    const chave = `${registro.produto}:${registro.id}:${registro.tipo}`;
    for (const [k, v] of this.enviosRecentes) if (agora.getTime() - v.em >= JANELA_DE_REPETICAO_MS) this.enviosRecentes.delete(k);
    const recente = this.enviosRecentes.get(chave);
    // O segundo toque espera o primeiro: se ele falhar, falha igual (é o mesmo envio) e sai da memória.
    if (recente) return { ...(await recente.resposta), repetido: true };
    const resposta = this.gravar(registro, agora);
    this.enviosRecentes.set(chave, { em: agora.getTime(), resposta });
    try {
      return await resposta;
    } catch (error) {
      this.enviosRecentes.delete(chave);
      throw error;
    }
  }

  private async gravar(registro: CrmRegistroEntrada, agora: Date): Promise<RespostaDoRegistro> {
    try {
      return await this.gravarNoN8n(registro, agora);
    } finally {
      // O retrato leva segundos para refletir, mas o que o CRM calcula de fora dele (eventos manuais,
      // marcas) muda assim que o registro entra: ninguém deve ler a visão de antes da escrita.
      this.invalidarVisao();
    }
  }

  private async gravarNoN8n(registro: CrmRegistroEntrada, agora: Date): Promise<RespostaDoRegistro> {
    const visao = await this.visao(agora);
    const lead = visao.leads.find((item) => item.id === `${registro.produto}:${registro.id}`);
    if (!lead) throw new RegistroInvalido("Lead não encontrado no retrato atual do CRM.");
    const cicloNovo = registro.tipo === 'nota' ? lerEventoCiclo(registro.texto, agora.getTime()) : null;
    if (cicloNovo) {
      try {
        const transicao = validarTransicaoDoCicloComercial(lead, cicloNovo, agora);
        if (transicao !== 'duplicado' && ['proposta_enviada', 'aceite'].includes(cicloNovo.tipo)) {
          if (!qualificadoParaProposta(lead, agora.getTime())) throw new Error('Complete a qualificação confirmada antes do envio final ou aceite.');
          const proposta = cicloDoLead(lead, agora.getTime()).propostas.find(p => p.id === cicloNovo.vinculo);
          const q = qualificacaoComercialAtual(lead, agora.getTime());
          if (temQualificacaoComercial(lead, agora.getTime()) && q?.adequacao.oferta !== proposta?.ofertaId) throw new Error('A oferta da proposta deve corresponder à qualificação aprovada.');
        }
      } catch (erro) { throw new RegistroInvalido(erro instanceof Error ? erro.message : 'Transição comercial inválida.'); }
    }
    if (ehTipoAarr(registro.tipo)) {
      if (['valor_proposta','pagamento_confirmado','receita_desfeita'].includes(registro.tipo) && cicloDoLead(lead, agora.getTime()).historico.length) throw new RegistroInvalido('Esta negociação usa o ciclo comercial: registre recebimento ou correção no painel correspondente.');
      const meta = lerRegistroAarr(registro.tipo, registro.texto, agora.getTime())!;
      if (!registroCompativelComLead(lead, meta)) throw new RegistroInvalido('Essa condição não pertence à oferta deste lead.');
      const atual = aarrDoLead(lead, agora.getTime());
      if ('oferta' in meta) {
        const lista = registro.tipo === 'pagamento_confirmado' ? atual.pagamentos : atual.propostas;
        const repetido = lista.find(p => chaveDoPagamento(p) === chaveDoPagamento(meta));
        if (repetido) {
          if (repetido.valor_centavos !== meta.valor_centavos || repetido.quantidade !== meta.quantidade) throw new RegistroInvalido('Desfaça o registro anterior antes de corrigir seu valor.');
          return { ok: true, em: repetido.em, repetido: true };
        }
        if (meta.oferta === 'fonte' && lista.some(p => p.oferta === 'fonte' && p.referencia.toLocaleLowerCase('pt-BR') === meta.referencia.toLocaleLowerCase('pt-BR') && (p.componente === 'implantacao') !== (meta.componente === 'implantacao'))) throw new RegistroInvalido('Não misture o total da Fonte com suas duas parcelas.');
      }
      if (registro.tipo === 'receita_desfeita') {
        const m = meta as ReceitaDesfeita;
        const lista = m.tipo === 'pagamento_confirmado' ? atual.pagamentos : atual.propostas;
        if (!lista.some(p => chaveDoPagamento(p) === m.referencia)) throw new RegistroInvalido('O registro comercial já foi desfeito ou não pertence a este lead.');
      }
      if (registro.tipo === 'retencao_3m') {
        const m = meta as RegistroRetencao;
        if (!contratosMensais(lead, agora.getTime()).some(c => c.referencia === m.referencia && c.inicio === m.inicio)) throw new RegistroInvalido('Confirme o primeiro pagamento mensal desta oferta antes de registrar sua retenção.');
      }
      if (registro.tipo === 'indicacao_pedida') {
        const m = meta as RegistroIndicacao;
        if (!atual.pagamentos.some(p => p.chave === m.referencia)) throw new RegistroInvalido('Vincule a indicação a um pagamento confirmado ativo.');
        if (atual.indicacoes.pedidas.length) return { ok: true, em: atual.indicacoes.pedidas[0]!.em, repetido: true };
      }
    }
    if (registro.tipo === 'cadencia_enviada') {
      const meta = lerRegistroCadencia(registro.texto)!;
      if (cadenciaJaConfirmada(lead, meta)) return { ok: true, em: agora.toISOString(), repetido: true };
      const atual = cadenciaDoLead(lead, agora.getTime());
      if (atual?.estado !== 'tocar' || JSON.stringify(atual.registro) !== JSON.stringify(meta)) {
        throw new RegistroInvalido('A conversa ou o degrau mudou. Confira a Ficha antes de confirmar o toque.');
      }
    }
    const jaNoRetrato = envioRecenteNoLead(lead, registro.tipo, agora.getTime());
    if (jaNoRetrato) return { ok: true, em: jaNoRetrato, repetido: true };
    if ((registro.tipo === "plus_enviado" || registro.tipo === "plus_respondeu") && lead.produto !== "plus") {
      throw new RegistroInvalido("Este registro é só dos leads do Plus.");
    }
    if (registro.tipo === "plus_respondeu" && lead.etapa !== "contato") throw new RegistroInvalido("Só quem está Em contato pode ter respondido.");
    conferirEnvio(registro.tipo, lead);
    if (['proposta','proposta_desfeita'].includes(registro.tipo) && (temQualificacaoComercial(lead, agora.getTime()) || cicloDoLead(lead, agora.getTime()).historico.length)) throw new RegistroInvalido('Esta negociação usa a proposta versionada: confirme envio ou correção no caminho comercial.');
    if (registro.tipo === "proposta" && lead.etapa === "proposta") throw new RegistroInvalido("Este lead já está em Proposta.");
    if (registro.tipo === "proposta_desfeita" && lead.etapa !== "proposta") throw new RegistroInvalido("Este lead não está em Proposta.");
    if (registro.tipo === "sem_contato" && (lead.etapa === "ganho" || lead.etapa === "perdido")) throw new RegistroInvalido("Este lead já está encerrado.");
    if (registro.tipo === "sem_contato_desfeito" && lead.perdaManual !== "sem-contato") throw new RegistroInvalido("Este lead não foi perdido por falta de contato.");
    if (registro.tipo === "recusou" && (lead.etapa === "ganho" || lead.etapa === "perdido")) throw new RegistroInvalido("Este lead já está encerrado.");
    if (registro.tipo === "recusou_desfeito" && lead.perdaManual !== "recusou") throw new RegistroInvalido("A recusa deste lead não foi marcada na Central.");
    conferirDesfecho(registro.tipo, lead);
    // Quem saiu pelo prazo (expirou/esfriou/proposta-sem-retorno) não teve desfecho: uma proposta o traz de volta.
    if (registro.tipo === "proposta" && (lead.etapa === "ganho" || lead.etapa === "perdido") && !saiuPeloPrazo(lead)) {
      throw new RegistroInvalido("Lead já encerrado: desfaça o desfecho na página do lead antes.");
    }
    const segredo = await this.segredo();
    if (!this.config.registroUrl || !segredo) throw new RegistroIndisponivel((await this.disponibilidade()).motivo ?? "Registro indisponível.");
    let chaveComercial = chaveComercialDoRegistro(registro, lead.id, agora.getTime());
    if (chaveComercial && ehTipoAarr(registro.tipo)) {
      const ocorrencias = lead.eventos.filter(e => e.origem === 'manual' && chaveComercialDoRegistro({tipo:e.tipo,texto:e.registroTexto ?? e.texto ?? ''},lead.id,agora.getTime())?.hash === chaveComercial!.hash).length;
      chaveComercial = chaveComercialDoRegistro(registro, lead.id, agora.getTime(), ocorrencias);
    }
    if (chaveComercial) {
      const contagensLegadas = new Map<string, number>();
      const fonte: FatoComercialNaFonte[] = [...lead.eventos].sort((a,b) => Date.parse(a.em) - Date.parse(b.em)).flatMap(e => {
        if (e.origem !== 'manual' || !Number.isFinite(Date.parse(e.em)) || Date.parse(e.em) > agora.getTime()) return [];
        let c = chaveComercialDoRegistro({ tipo: e.tipo, texto: e.registroTexto ?? e.texto ?? '' }, lead.id, agora.getTime());
        if (c && ehTipoAarr(e.tipo)) { const n = contagensLegadas.get(c.hash) ?? 0; contagensLegadas.set(c.hash, n + 1); c = chaveComercialDoRegistro({ tipo:e.tipo, texto:e.registroTexto ?? e.texto ?? '' },lead.id,agora.getTime(),n); }
        return c ? [{ ...c, em: e.em }] : [];
      });
      try {
        await this.journalComercial.reconciliar({ origem: 'aba-crm', registros: fonte }, agora);
        const reserva = await this.journalComercial.reservar({ ...chaveComercial, tentativaEm: agora.toISOString() });
        if (!reserva.criada) {
          if (reserva.registro.estado === 'pendente' || reserva.registro.estado === 'ambiguo') throw new Error('Gravação anterior sem confirmação. Aguarde a projeção na fonte antes de repetir.');
          if (reserva.registro.estado === 'projetado' && !fonte.some(f => f.id === chaveComercial.id && f.hash === chaveComercial.hash)) throw new Error('O registro anterior está ausente da fonte atual. Confira o retrato antes de continuar.');
          return { ok: true, em: reserva.registro.fonteEm ?? reserva.registro.ackEm ?? agora.toISOString(), repetido: true, estado: reserva.registro.estado };
        }
      } catch (erro) { throw new RegistroInvalido(erro instanceof Error ? erro.message : 'Gravação comercial bloqueada.', false); }
    }
    let resposta: Response;
    try {
      resposta = await this.fetcher(this.config.registroUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CRM": segredo },
        body: JSON.stringify({ ...registro, empresa: lead.empresa }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      if (chaveComercial) await this.journalComercial.marcarAmbiguo(chaveComercial);
      throw new RegistroFalhou(chaveComercial ? 'O n8n não confirmou o resultado. Aguarde a fonte; não repita a operação.' : 'O n8n não respondeu. Nada foi confirmado na planilha.', null);
    }
    const corpo = await resposta.json().catch(() => ({})) as Record<string, unknown>;
    if (chaveComercial && (!resposta.ok || corpo.ok !== true)) await this.journalComercial.marcarAmbiguo(chaveComercial);
    if (resposta.status === 401 || resposta.status === 403) throw new RegistroFalhou("O n8n recusou o segredo do registro.", resposta.status);
    if (resposta.status === 404) throw new RegistroFalhou("O fluxo 08 · CRM não está ativo no n8n.", resposta.status);
    if (!resposta.ok || corpo.ok !== true) {
      throw new RegistroFalhou(typeof corpo.erro === "string" ? corpo.erro.slice(0, 200) : `O n8n não gravou (HTTP ${resposta.status}).`, resposta.status);
    }
    if (chaveComercial && (typeof corpo.em !== 'string' || !Number.isFinite(Date.parse(corpo.em)) || Date.parse(corpo.em) > agora.getTime() + 60_000)) {
      await this.journalComercial.marcarAmbiguo(chaveComercial);
      throw new RegistroFalhou('O retorno não trouxe uma confirmação datada válida. Aguarde a fonte antes de continuar.', resposta.status);
    }
    const em = typeof corpo.em === "string" ? corpo.em : agora.toISOString();
    if (chaveComercial) {
      await this.journalComercial.confirmar({ ...chaveComercial, em });
      return { ok: true, em, estado: 'aguardando_projecao' };
    }
    return { ok: true, em };
  }
}
