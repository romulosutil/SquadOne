import { Type, type FunctionDeclaration } from "@google/genai";
import { montarDossie, type LeadDoCopiloto, type MensagemParaODossie } from "../src/operations/copiloto.ts";
import { acharLead, mapearTextos, prepararTexto, semValores, sugestaoParaOModelo, type LeituraFeita, type ReferenciaDaSugestao, type SugestaoLida } from "../src/operations/assistente.ts";
import { passoAtual, passoDaJornada } from "../src/operations/jornada.ts";
import { filaDeVenda } from "../src/operations/proxima-venda.ts";
import { resumoDoDell } from "../src/operations/alertas.ts";
import { pareceFinancas } from "./financas/parece-financas.ts";
import { FUSO } from "./alocador.ts";
import type { CrmLead, CrmVisao, DellStatus } from "../src/operations/types.ts";
import type { StatusDoDell } from "./dell-status.ts";
import type { AgendaSummary } from "./operations.ts";
import type { ConsultaAoHermes } from "./hermes-consulta.ts";

/**
 * As ferramentas do Assistente da Central (RULES 28). Dois grupos, e só dois:
 *  - LEITURA, sobre o que as telas já mostram (a visão do CRM, a fila de venda, o dossiê do copiloto,
 *    a sugestão que o copiloto já guardou, a agenda do dia, o status.json do Dell) e a consulta ao Hermes. Nenhuma escreve: nem disco, nem
 *    planilha, nem Google. Tudo o que devolvem ao modelo sai mascarado e sem R$.
 *  - PROPOSTA (propor_*): não executam nada; a cola (server/assistente.ts) as lê com
 *    `lerCartaoProposto` e elas viram cartões "propostos". Quem escreve é o toque do Rômulo, pela
 *    rota que já existe (RULES 10). Por isso este módulo não importa o CrmStore nem as capacidades
 *    do turno: não há caminho daqui até uma escrita.
 */

// --- As declarações ------------------------------------------------------------

export const LER_SUGESTAO_DO_COPILOTO = "ler_sugestao_do_copiloto";
export const LEITURAS = [
  "ler_hoje", "ler_funil", "ler_proxima_venda", "buscar_lead", "ler_lead", "ler_agenda_do_dia", "ler_estado_do_dell", LER_SUGESTAO_DO_COPILOTO,
] as const;
export type NomeDaLeitura = (typeof LEITURAS)[number];
export const CONSULTAR_HERMES = "consultar_hermes";

const PRODUTO = { type: Type.STRING, enum: ["site", "prumo", "iris", "estampa", "plus"], description: "O produto do lead, como buscar_lead devolve." };
const ID = { type: Type.STRING, description: "O id do lead, como buscar_lead devolve. Nunca invente." };

const DECLARACOES_DE_LEITURA: FunctionDeclaration[] = [
  { name: "ler_hoje", description: "O que precisa do Rômulo hoje em Vendas: os grupos da Hoje do CRM (responder, follow-up, combinados, propostas), com os primeiros de cada." },
  { name: "ler_funil", description: "Quantos leads há em cada etapa do funil (novo, contato, proposta, ganho, perdido), por oferta, e as perdas." },
  { name: "ler_proxima_venda", description: "As 5 primeiras ações da fila de venda, na ordem de quem está mais perto de comprar, com o porquê e a tática." },
  {
    name: "buscar_lead",
    description: "Acha leads pelo nome da empresa (até 5). Devolve produto, id, empresa, etapa e passo da jornada; nunca telefone.",
    parameters: { type: Type.OBJECT, properties: { nome: { type: Type.STRING, description: "Parte do nome da empresa." } }, required: ["nome"] },
  },
  {
    name: "ler_lead",
    description: "O dossiê de um lead (jornada, oferta, resposta, conversa recente, histórico com as notas, Raio-X), já mascarado.",
    parameters: { type: Type.OBJECT, properties: { produto: PRODUTO, id: ID }, required: ["produto", "id"] },
  },
  { name: "ler_agenda_do_dia", description: "Os compromissos de hoje na agenda do Rômulo: só títulos e horários." },
  { name: "ler_estado_do_dell", description: "O estado do Dell (servidor da operação) pelo último retrato do monitor: o que precisa do Rômulo e o que resolve sozinho." },
];

/**
 * Fase 2 (17/10/2026): o copiloto da Ficha passou para o painel. Só LÊ a sugestão guardada para a
 * conversa de agora (copiloto.ler), nunca gera: quem gera é o automático, que segue alimentando a
 * Próxima venda e o Telegram. Achando, a cola cria o cartão (não o modelo).
 */
const DECLARACAO_DO_COPILOTO: FunctionDeclaration = {
  name: LER_SUGESTAO_DO_COPILOTO,
  description: "A sugestão que o copiloto já guardou para a conversa de agora com um lead (a próxima mensagem, o que oferecer, os itens da proposta sem preço). Não gera outra. Achando, vira um cartão na tela.",
  parameters: { type: Type.OBJECT, properties: { produto: PRODUTO, id: ID }, required: ["produto", "id"] },
};

const DECLARACAO_DO_HERMES: FunctionDeclaration = {
  name: CONSULTAR_HERMES,
  description: "Pergunta de estratégia ao Hermes, um especialista consultado. Ele recebe só o que você já leu nesta mensagem; a resposta dele vai direto ao Rômulo.",
  parameters: { type: Type.OBJECT, properties: { pergunta: { type: Type.STRING, description: "A pergunta, curta, sem dado pessoal." } }, required: ["pergunta"] },
};

const DECLARACOES_DE_PROPOSTA: FunctionDeclaration[] = [
  {
    name: "propor_pedido_ao_time",
    description: "Propõe um pedido ao time do SquadOne (agendar, lembrar, uma tarefa). Vira um cartão; só roda se o Rômulo tocar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        demanda: { type: Type.STRING, description: "O pedido em uma frase, como o Rômulo diria ao time." },
        modo: { type: Type.STRING, enum: ["auto", "foco", "baixa"], description: "auto (padrão), foco (bloco de foco) ou baixa (baixa prioridade)." },
      },
      required: ["demanda"],
    },
  },
  {
    name: "propor_anotacao_no_crm",
    description: "Propõe uma nota ou um próximo passo (com data) na Ficha de um lead. Vira um cartão; só grava se o Rômulo tocar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        produto: PRODUTO,
        id: ID,
        tipo: { type: Type.STRING, enum: ["nota", "proximo_passo"] },
        texto: { type: Type.STRING, description: "Até 1000 caracteres, sem R$." },
        data: { type: Type.STRING, description: "AAAA-MM-DD; obrigatória no próximo passo." },
      },
      required: ["produto", "id", "tipo", "texto"],
    },
  },
  {
    name: "propor_mensagem_ao_lead",
    description: "Propõe o texto de uma mensagem para o Rômulo copiar e mandar ele mesmo. Nada é enviado por aqui.",
    parameters: {
      type: Type.OBJECT,
      properties: { produto: PRODUTO, id: ID, texto: { type: Type.STRING, description: "A mensagem pronta para o WhatsApp, sem R$." } },
      required: ["produto", "id", "texto"],
    },
  },
];

/** As declarações que o Gemini vê. O Hermes só entra com a consulta ligada; o copiloto, com ele ligado. */
export function declaracoesDoAssistente(opcoes: { hermes: boolean; copiloto?: boolean }): FunctionDeclaration[] {
  return [
    ...DECLARACOES_DE_LEITURA,
    ...(opcoes.copiloto ? [DECLARACAO_DO_COPILOTO] : []),
    ...(opcoes.hermes ? [DECLARACAO_DO_HERMES] : []),
    ...DECLARACOES_DE_PROPOSTA,
  ];
}

// --- As fontes -----------------------------------------------------------------

export interface FontesDoAssistente {
  /** A visão do CRM (CrmStore.visao); ausente = CRM não configurado nesta Central. */
  visao?: () => Promise<CrmVisao>;
  /** A conversa guardada do lead (server/conversa-do-lead.ts); null = sem. */
  conversa?: (lead: CrmLead) => Promise<MensagemParaODossie[] | null>;
  /** A agenda do dia, a mesma do /overview. */
  agenda?: () => Promise<AgendaSummary>;
  /** O status.json do Dell (lerStatusDoDell). */
  dell?: () => Promise<StatusDoDell>;
  /**
   * A sugestão guardada do copiloto para a conversa de agora (Copiloto.ler: nunca chama o modelo);
   * null = nenhuma. Ausente = copiloto desligado nesta Central (a leitura nem é declarada).
   */
  sugestao?: (lead: CrmLead) => Promise<SugestaoLida | null>;
}

/** O que voltou de uma ferramenta: o objeto que vai ao modelo como functionResponse. */
export type ResultadoDaLeitura = Record<string, unknown>;

const MAX_POR_GRUPO = 5;
const MAX_LEADS_NA_BUSCA = 5;
const MAX_ACOES_DA_FILA = 5;
const MAX_PERGUNTA_AO_HERMES = 1000;
/** A leitura da agenda inteira (token + Google), no caminho do Assistente. */
export const PRAZO_DA_AGENDA_MS = 20_000;

/**
 * O que nunca sai daqui sem passar: máscara de identificador e nenhum valor. `semValores` tira o
 * número com cara de dinheiro mesmo sem "R$" ("proposta 1.200" numa nota, "500 reais tá bom?" na
 * conversa, "fechou 900"), em toda string que volta ao modelo, títulos da agenda inclusive.
 */
const CHAVES_INTACTAS: ReadonlySet<string> = new Set(["id", "produto"]);
const limpar = <T>(valor: T): T => mapearTextos(valor, (t) => semValores(prepararTexto(t)), CHAVES_INTACTAS);

const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function horaLocal(iso: string | undefined): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

/**
 * Uma sessão de leitura por mensagem: a visão do CRM lida uma vez só, as fontes que de fato
 * rodaram (para o "de onde veio", RULES 14) e o que foi lido (o pacote do Hermes, que só vê isso).
 */
export class LeiturasDaMensagem {
  readonly feitas: LeituraFeita[] = [];
  /** O que cada leitura devolveu ao modelo, já limpo: é o pacote do Hermes. */
  readonly lidas: Array<{ ferramenta: string; resultado: ResultadoDaLeitura }> = [];
  /** Alguma leitura do CRM ficou sem sinal (não configurado, sem retrato, erro). */
  crmSemSinal = false;
  /** As sugestões do copiloto achadas nesta mensagem: a cola cria um cartão para cada (cartaoDaSugestao). */
  readonly sugestoes: ReferenciaDaSugestao[] = [];
  private visaoLida: Promise<CrmVisao | null> | null = null;

  constructor(private readonly fontes: FontesDoAssistente, private readonly agora: () => Date, private readonly log: Pick<Console, "warn"> = console) {}

  private anotar(l: LeituraFeita) {
    this.feitas.push(l);
  }

  /** A visão do CRM desta mensagem, ou null (sem sinal). Anota a fonte na primeira leitura boa. */
  async visao(): Promise<CrmVisao | null> {
    if (!this.visaoLida) {
      this.visaoLida = (async () => {
        if (!this.fontes.visao) return null;
        try {
          const v = await this.fontes.visao();
          if (v.estado !== "ok") return null;
          this.anotar({ tipo: "crm", ...(v.geradoEm ? { geradoEm: v.geradoEm } : {}) });
          return v;
        } catch (error) {
          this.log.warn(`[assistente] CRM ilegível: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      })();
    }
    const v = await this.visaoLida;
    if (!v) this.crmSemSinal = true;
    return v;
  }

  private semSinalDoCrm(): ResultadoDaLeitura {
    return { semSinal: true, motivo: this.fontes.visao ? "O CRM não foi lido agora (sem retrato ou retrato ilegível)." : "O CRM não está configurado nesta Central." };
  }

  /** Roda uma leitura pelo nome. Nome desconhecido ou argumento torto voltam como erro ao modelo, nunca lançam. */
  async executar(nome: string, args: Record<string, unknown>): Promise<ResultadoDaLeitura> {
    let resultado: ResultadoDaLeitura;
    try {
      resultado = limpar(await this.rodar(nome, args ?? {}));
    } catch (error) {
      this.log.warn(`[assistente] leitura ${nome} falhou: ${error instanceof Error ? error.message : String(error)}`);
      resultado = { semSinal: true, motivo: "A leitura falhou agora." };
    }
    if (!resultado.semSinal && !resultado.erro) this.lidas.push({ ferramenta: nome, resultado });
    return resultado;
  }

  private async rodar(nome: string, args: Record<string, unknown>): Promise<ResultadoDaLeitura> {
    switch (nome) {
      case "ler_hoje": {
        const v = await this.visao();
        if (!v) return this.semSinalDoCrm();
        const porId = new Map(v.leads.map((l) => [l.id, l]));
        return {
          grupos: v.hoje.map((g) => ({
            titulo: g.titulo,
            quantos: g.itens.length,
            primeiros: g.itens.slice(0, MAX_POR_GRUPO).map((i) => ({
              empresa: porId.get(i.leadId)?.empresa ?? "",
              produto: porId.get(i.leadId)?.produto ?? "",
              id: i.leadId,
              acao: i.acao,
              detalhe: i.detalhe,
              ...(i.urgente ? { urgente: true } : {}),
            })),
          })),
        };
      }
      case "ler_funil": {
        const v = await this.visao();
        if (!v) return this.semSinalDoCrm();
        return { porEtapa: v.contagens, perdas: v.perdas, divergencias: v.divergencias };
      }
      case "ler_proxima_venda": {
        const v = await this.visao();
        if (!v) return this.semSinalDoCrm();
        // Sem a trava de ritmo aqui (ela é da tela): o primeiro contato fica fora, de propósito.
        const fila = filaDeVenda(v, { primeiroLiberado: false, agora: this.agora().getTime() });
        return {
          quantas: fila.length,
          primeiroContatoFora: true,
          acoes: fila.slice(0, MAX_ACOES_DA_FILA).map((a) => ({
            titulo: a.titulo, produto: a.produto, id: a.leadId, contexto: a.contexto, porque: a.porque, tatica: a.tatica,
            ...(a.quente ? { quente: true } : {}),
          })),
        };
      }
      case "buscar_lead": {
        const termo = semAcento(typeof args.nome === "string" ? args.nome.trim() : "");
        if (termo.length < 2) return { erro: "Diga ao menos 2 letras do nome da empresa." };
        const v = await this.visao();
        if (!v) return this.semSinalDoCrm();
        const achados = v.leads.filter((l) => semAcento(l.empresa).includes(termo)).slice(0, MAX_LEADS_NA_BUSCA);
        return {
          leads: achados.map((l) => ({ produto: l.produto, id: l.id, empresa: l.empresa, etapa: l.subEtapa || l.etapa, passo: passoDaJornada(passoAtual(l)).nome })),
          ...(achados.length ? {} : { nenhum: true }),
        };
      }
      case "ler_lead": {
        const produto = typeof args.produto === "string" ? args.produto : "";
        const id = typeof args.id === "string" ? args.id.trim() : "";
        const v = await this.visao();
        if (!v) return this.semSinalDoCrm();
        // O id inteiro (o que buscar_lead devolve) ou só a chave da planilha: as duas acham o lead.
        const lead = acharLead(v.leads, produto, id);
        if (!lead) return { erro: "Lead fora do CRM: use buscar_lead para achar o produto e o id." };
        let conversa: MensagemParaODossie[] | null = null;
        try {
          conversa = (await this.fontes.conversa?.(lead)) ?? null;
        } catch (error) {
          this.log.warn(`[assistente] conversa ilegível: ${error instanceof Error ? error.message : String(error)}`);
        }
        const dossie = montarDossie(lead as LeadDoCopiloto, conversa?.length ? { conversa } : {});
        const ultima = dossie.conversa?.[dossie.conversa.length - 1]?.em;
        if (ultima) this.anotar({ tipo: "conversa", ate: ultima });
        // O cardápio leva preço: fica de fora (o R$ de proposta é finanças para a RULES 28). Os links
        // (demo, Raio-X) também: o modelo não precisa deles para conversar, e mascarados não servem.
        const { cardapio: _cardapio, demo: _demo, raioX, ...resto } = dossie;
        return { ...resto, raioX: { situacao: raioX.situacao, ...(raioX.texto ? { texto: raioX.texto } : {}), ...(raioX.achados ? { achados: raioX.achados } : {}) } };
      }
      case LER_SUGESTAO_DO_COPILOTO: {
        if (!this.fontes.sugestao) return { semSinal: true, motivo: "O copiloto está desligado nesta Central." };
        const produto = typeof args.produto === "string" ? args.produto : "";
        const id = typeof args.id === "string" ? args.id.trim() : "";
        const v = await this.visao();
        if (!v) return this.semSinalDoCrm();
        const lead = acharLead(v.leads, produto, id);
        if (!lead) return { erro: "Lead fora do CRM: use buscar_lead para achar o produto e o id." };
        let s: SugestaoLida | null;
        try {
          s = await this.fontes.sugestao(lead);
        } catch (error: any) {
          // Pelo nome, sem importar as classes do copiloto: este módulo não chega a quem gera.
          if (error?.name === "PassoSemCopiloto") return { foraDoTrecho: true, motivo: "O copiloto só acompanha do \"respondeu\" até a proposta; este lead está fora desse trecho." };
          if (error?.name === "LeadForaDoCrm") return { erro: "Lead fora do CRM agora." };
          throw error;
        }
        if (!s) {
          return { nenhuma: true, motivo: "O copiloto não tem sugestão guardada para a conversa de agora (ele sugere sozinho quando a última mensagem é do lead)." };
        }
        // A saída primeiro: um registro antigo e torto que fizesse ela lançar não pode deixar cartão e
        // fonte de uma leitura que o modelo recebeu como falha.
        const saida = sugestaoParaOModelo(s);
        this.anotar({ tipo: "copiloto", quando: s.quando });
        if (!this.sugestoes.some((r) => r.produto === lead.produto && r.id === lead.id)) {
          this.sugestoes.push({ produto: lead.produto, id: lead.id, empresa: lead.empresa, hashDoDossie: s.hashDoDossie });
        }
        return saida;
      }
      case "ler_agenda_do_dia": {
        if (!this.fontes.agenda) return { semSinal: true, motivo: "A agenda não mora nesta Central." };
        // O fetch do Google já leva AbortSignal.timeout (listarAgendaDoDia, server/calendar.ts), mas o
        // token pode estar renovando: o prazo aqui é da leitura inteira, para a fila não ficar presa.
        let relogio: ReturnType<typeof setTimeout> | undefined;
        const lida = this.fontes.agenda();
        lida.catch(() => {});
        const a = await Promise.race([
          lida,
          new Promise<"estourou">((r) => { relogio = setTimeout(() => r("estourou"), PRAZO_DA_AGENDA_MS); }),
        ]).finally(() => clearTimeout(relogio));
        if (a === "estourou") return { semSinal: true, motivo: "A agenda não respondeu a tempo." };
        if (a.state === "disconnected") return { semSinal: true, motivo: "A agenda do Google está desconectada." };
        if (a.state === "unavailable") return { semSinal: true, motivo: "A agenda não respondeu agora." };
        this.anotar({ tipo: "agenda" });
        return {
          compromissos: a.events.map((e) => ({
            // Título que parece finanças ("pagar a fatura") não vai ao modelo (RULES 24).
            titulo: pareceFinancas(e.title) ? "[compromisso pessoal]" : e.title,
            ...(e.allDay ? { diaInteiro: true } : { inicio: horaLocal(e.start), fim: horaLocal(e.end) }),
          })),
        };
      }
      case "ler_estado_do_dell": {
        if (!this.fontes.dell) return { semSinal: true, motivo: "O retrato do Dell não mora nesta Central." };
        const status = await this.fontes.dell();
        this.anotar({ tipo: "dell", geradoEm: status.geradoEm });
        const r = resumoDoDell(status as DellStatus, this.agora().getTime(), FUSO);
        // Retrato velho é "sem notícia", nunca "tudo certo" (RULES 19).
        if (r.semNoticia) return { semNoticia: true, texto: r.textoPrecisam, aviso: "As contagens abaixo são do último retrato, não de agora.", noUltimoRetrato: r.textoDoMais };
        return {
          texto: r.textoPrecisam,
          ...(r.textoSozinhas ? { sozinhas: r.textoSozinhas } : {}),
          precisam: r.precisam.slice(0, MAX_POR_GRUPO).map((c) => ({ nome: c.nome, estado: c.estado, detalhe: c.detalhe, ...(c.oQueFazer ? { oQueFazer: c.oQueFazer } : {}) })),
          contagem: r.textoDoMais,
        };
      }
      default:
        return { erro: `Ferramenta desconhecida: ${nome.slice(0, 60)}.` };
    }
  }

  /**
   * O pacote do Hermes: só o que as leituras DESTA mensagem devolveram, já limpo. Nada de finanças
   * chega aqui (o texto de finanças nem passa do rotearLocal), e mesmo assim confere outra vez.
   */
  pacoteParaOHermes(): string {
    const pacote = JSON.stringify(this.lidas, null, 1);
    return pareceFinancas(pacote) ? JSON.stringify(this.lidas.filter((l) => !pareceFinancas(JSON.stringify(l))), null, 1) : pacote;
  }
}

// --- O Hermes --------------------------------------------------------------------

export type ResultadoDoHermes =
  | { ok: true; texto: string; ms: number }
  | { ok: false; motivo: "timeout" | "ocupado" | "saida" | "desligado" | "teto" | "financas" | "vazia" | "outro" };

/**
 * A consulta ao Hermes, na forma da exceção da regra 20: a pergunta mascarada, o pacote do que já
 * foi lido e nada mais. A falha volta classificada (pelo `motivo` do HermesFalhou, sem depender da
 * classe: só o tipo é importado, a instância vem por injeção).
 */
export async function consultarOHermes(hermes: ConsultaAoHermes, perguntaCrua: unknown, leituras: LeiturasDaMensagem): Promise<ResultadoDoHermes> {
  const pergunta = semValores(prepararTexto(typeof perguntaCrua === "string" ? perguntaCrua.trim() : "")).slice(0, MAX_PERGUNTA_AO_HERMES);
  if (!pergunta) return { ok: false, motivo: "vazia" };
  if (pareceFinancas(pergunta)) return { ok: false, motivo: "financas" };
  try {
    const r = await hermes.consultar(pergunta, leituras.pacoteParaOHermes());
    const texto = semValores(prepararTexto(String(r?.texto ?? ""))).trim();
    if (!texto) return { ok: false, motivo: "saida" };
    return { ok: true, texto, ms: Number.isFinite(r.ms) ? r.ms : 0 };
  } catch (error: any) {
    const motivo = error?.name === "HermesFalhou" ? error.motivo : undefined;
    return { ok: false, motivo: motivo === "timeout" || motivo === "ocupado" || motivo === "saida" || motivo === "desligado" || motivo === "teto" ? motivo : "outro" };
  }
}
