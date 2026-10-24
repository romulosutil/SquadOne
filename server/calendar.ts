import type { Intervalo } from "./alocador.ts";

/**
 * Marcação de propriedade. QUATRO chaves, cada uma um eixo (contrato do evento,
 * spec Fase 1 §5), mais a ligação bloco→prazo da Fase 3:
 *
 * - `squadone_squad` é INFORMATIVA: diz de qual squad o evento veio. Não é
 *   filtro — eventos criados antes da Fase 1 não a têm, e o filtro por
 *   domínio já separa as squads porque ids de domínio são globais.
 * - `squadone_dominio` é o eixo de FILTRO. `events.list` só aceita
 *   `privateExtendedProperty=chave=valor` com match exato — não existe
 *   wildcard `squadone=*`. Com um valor de domínio estável dá pra listar
 *   tudo de um domínio numa chamada.
 * - `squadone_membro` é o eixo de ATRIBUIÇÃO: quem executa. Muda quando a
 *   tarefa troca de dono sem mudar de domínio.
 * - `squadone_tipo` é o eixo de SEMÂNTICA: `time_blocking` ou `deadline`.
 *   Antes o tipo era inferido do prefixo do título, que o usuário edita no
 *   Google à vontade — renomear um deadline o transformava em bloco.
 *
 * Com uma chave só, os eixos colidiriam: filtrar por domínio perderia o
 * responsável, filtrar por responsável perderia a visão do domínio.
 */
export const PROP_SQUAD = "squadone_squad";
export const PROP_DOMINIO = "squadone_dominio";
export const PROP_MEMBRO = "squadone_membro";
export const PROP_TIPO = "squadone_tipo";
/**
 * - `squadone_prazo_ref` LIGA um bloco de trabalho ao marco do prazo: valor é o
 *   eventId do marco (gravado antes dos blocos, então o id já existe). Só em
 *   blocos. Posição "2/3" não é gravada — a Mochila deriva da lista lida, e um
 *   bloco apagado no Google sai da contagem sozinho.
 */
export const PROP_PRAZO_REF = "squadone_prazo_ref";

/**
 * Vínculo com o Google Tasks (passos de um compromisso), só no evento
 * PRINCIPAL — o foco, ou o marco de um prazo; blocos não levam. O Tasks não
 * tem extendedProperties e `links` lá é somente leitura, então a ponta
 * AUTORITATIVA do vínculo mora aqui:
 * - `squadone_tasks_lista`: id da lista da squad no Tasks;
 * - `squadone_tasks_pai`: id da tarefa-mãe.
 * Não entram em `marcasDoEvento`: só existem depois de as tarefas nascerem, e
 * chegam por PATCH (atualizarPreservandoMarcas). O prefixo `squadone_` é o que
 * faz o PATCH do Ajuste preservá-las sem mudança (calendar.test.ts trava).
 * `QuestCalendario`/`EventoLido` não as leem na V1: a Mochila não usa.
 */
export const PROP_TASKS_LISTA = "squadone_tasks_lista";
export const PROP_TASKS_PAI = "squadone_tasks_pai";

/**
 * Falha de um domínio. `credencial` diz se reconectar resolve — o frontend
 * precisa dessa distincao para nao pedir reconexao contra um problema que
 * mora na configuracao do projeto Google.
 */
export interface ErroDeDominio {
  dominio: string;
  erro: string;
  credencial: boolean;
  /**
   * O domínio tem mais eventos que o teto de páginas: nenhuma quest dele volta.
   * Lista cortada calada pareceria completa, e a Mochila é onde o usuário
   * confere o que existe.
   */
  incompleto?: true;
}

export interface QuestCalendario {
  eventId: string;
  titulo: string;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  tipo: "time_blocking" | "deadline";
  dominio: string;
  membro: string;
  /** `squadone_squad`; "" em eventos anteriores à Fase 1. Informativo. */
  squad: string;
  /** `squadone_prazo_ref`: eventId do marco quando a quest é bloco de um prazo; "" senão. */
  prazoRef: string;
  htmlLink?: string;
  /** `squadone_tasks_lista`/`_pai`: a checklist do compromisso no Google Tasks; "" sem passos. */
  tasksLista?: string;
  tasksPai?: string;
  /**
   * Progresso da checklist (subtarefas concluídas / total), anexado pela rota da
   * Mochila quando a leitura do Tasks deu certo. Ausente = sem passos ou
   * leitura falhou: o card simplesmente não mostra o selo.
   */
  passos?: { feitos: number; total: number };
  /**
   * ETag do evento na leitura. Só o servidor usa: o ajuste de esforço confere
   * se o bloco listado ainda é a mesma versão antes de encurtá-lo.
   */
  etag?: string;
}

/** Prefixo do summary de um deadline; usado na ida e na volta. */
export const PREFIXO_DEADLINE = "⏰ DEADLINE:";

/**
 * As quatro marcas de todo evento criado pelo app (contrato da Fase 1, spec §5).
 * Uma função só para que nenhum ponto de escrita esqueça uma delas: um evento
 * sem `squadone_dominio` simplesmente some da Mochila. `dominioId` é o id do
 * DOMÍNIO da pessoa, não um campo dela: quem decide o eixo de filtro é a
 * hierarquia, não a pessoa.
 */
export function marcasDoEvento(m: {
  squadId: string;
  dominioId: string;
  pessoaId: string;
  tipo: "time_blocking" | "deadline";
  /** eventId do marco; só em blocos de trabalho de um prazo. */
  prazoRef?: string;
}): Record<string, string> {
  return {
    [PROP_SQUAD]: m.squadId,
    [PROP_DOMINIO]: m.dominioId,
    [PROP_MEMBRO]: m.pessoaId,
    [PROP_TIPO]: m.tipo,
    ...(m.prazoRef ? { [PROP_PRAZO_REF]: m.prazoRef } : {}),
  };
}

/** Coleção de eventos de um calendário. `calendarId` vem da squad (hoje o principal). */
export function urlDeEventos(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}

interface GoogleEvent {
  id: string;
  etag?: string;
  summary?: string;
  colorId?: string;
  description?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export interface EventoDaAgendaDoDia {
  id: string;
  titulo: string;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  htmlLink?: string;
  local?: string;
}

/**
 * A marca manda. O prefixo só vale para eventos criados antes dela existir —
 * sem migração, eles continuam lidos como sempre foram.
 */
function tipoDoEvento(priv: Record<string, string>, titulo: string): "time_blocking" | "deadline" {
  const marca = priv[PROP_TIPO];
  if (marca === "deadline" || marca === "time_blocking") return marca;
  return titulo.startsWith(PREFIXO_DEADLINE) ? "deadline" : "time_blocking";
}

export function paraQuest(ev: GoogleEvent): QuestCalendario | null {
  const priv = ev.extendedProperties?.private ?? {};
  const inicio = ev.start?.dateTime ?? ev.start?.date;
  const fim = ev.end?.dateTime ?? ev.end?.date;
  if (!inicio || !fim) return null; // evento sem horário: não é quest.

  const titulo = ev.summary ?? "(sem título)";
  return {
    eventId: ev.id,
    titulo,
    inicio,
    fim,
    diaInteiro: !ev.start?.dateTime,
    tipo: tipoDoEvento(priv, titulo),
    dominio: priv[PROP_DOMINIO] ?? "",
    membro: priv[PROP_MEMBRO] ?? "",
    squad: priv[PROP_SQUAD] ?? "",
    prazoRef: priv[PROP_PRAZO_REF] ?? "",
    tasksLista: priv[PROP_TASKS_LISTA] ?? "",
    tasksPai: priv[PROP_TASKS_PAI] ?? "",
    htmlLink: ev.htmlLink,
    etag: ev.etag,
  };
}

/**
 * Erro do Google carregando o que separa "credencial ruim" de "projeto mal
 * configurado". Os dois chegam como 403, e tratar os dois como credencial
 * manda o usuário reconectar para sempre: o 403 de `accessNotConfigured` (API
 * do Calendar desligada no projeto) não melhora com token novo nenhum.
 */
export class ErroCalendario extends Error {
  readonly status: number;
  /** `reason` do primeiro erro do corpo do Google; "" quando não vem. */
  readonly motivo: string;

  constructor(status: number, corpo: string) {
    let motivo = "";
    let detalhe = corpo.slice(0, 300);
    try {
      const json = JSON.parse(corpo) as {
        error?: { message?: string; errors?: { reason?: string }[] };
      };
      motivo = json.error?.errors?.[0]?.reason ?? "";
      detalhe = json.error?.message ?? detalhe;
    } catch {
      // Corpo não-JSON (HTML de proxy, texto vazio): fica o recorte cru.
    }
    super(`Google Calendar respondeu ${status}: ${detalhe}`);
    this.name = "ErroCalendario";
    this.status = status;
    this.motivo = motivo;
  }

  /** Só o que reconectar resolve: token expirado, revogado ou sem escopo. */
  get ehCredencial(): boolean {
    if (this.status === 401) return true;
    return (
      this.status === 403 &&
      ["authError", "insufficientPermissions", "forbidden"].includes(this.motivo)
    );
  }
}

/** Teto de páginas de um events.list. Mochila: 10 x 250; ocupação: 10 x 2500. */
const PAGINAS_MAX = 10;

/**
 * A leitura tinha mais páginas que o teto. Classificada, não mensagem solta:
 * quem lê decide o que fazer com dado incompleto (a Mochila marca o domínio, a
 * ocupação recusa alocar), mas ninguém usa a lista cortada como se fosse inteira.
 */
export class LeituraIncompleta extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "LeituraIncompleta";
  }
}

/**
 * events.list seguindo `nextPageToken` até PAGINAS_MAX. Sem paginar, o que
 * passasse de `maxResults` sumia sem aviso.
 */
async function listarPaginado<T>(
  calendarId: string,
  params: Record<string, string>,
  token: string,
  /** Só a agenda do dia da Central passa um (ver listarAgendaDoDia); o turno segue sem prazo aqui. */
  sinal?: AbortSignal,
): Promise<T[]> {
  const itens: T[] = [];
  let pageToken: string | undefined;
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const busca = new URLSearchParams(params);
    if (pageToken) busca.set("pageToken", pageToken);
    const resp = await fetch(`${urlDeEventos(calendarId)}?${busca}`, {
      headers: { Authorization: `Bearer ${token}` },
      ...(sinal ? { signal: sinal } : {}),
    });
    if (!resp.ok) {
      throw new ErroCalendario(resp.status, await resp.text().catch(() => ""));
    }
    const json = (await resp.json()) as { items?: T[]; nextPageToken?: string };
    itens.push(...(json.items ?? []));
    if (!json.nextPageToken) return itens;
    pageToken = json.nextPageToken;
  }
  throw new LeituraIncompleta(
    `O Google Calendar devolveu mais de ${PAGINAS_MAX} páginas de eventos: a leitura ficaria incompleta.`,
  );
}

/**
 * Visão resumida do dia para a Central de Operações. Diferente da Mochila,
 * lê o calendário principal sem filtrar marcas do SquadOne: a agenda do dia
 * precisa refletir também compromissos criados fora do produto.
 *
 * Com prazo de 20 s (17/10/2026): esta leitura só serve à Central (o /overview e o Assistente, RULES
 * 28), nunca ao turno, e o Assistente a chama de dentro da fila serial dele; um Google que não
 * respondesse prenderia todas as mensagens seguintes. O abort vira erro, que o /overview já mostra
 * como "unavailable" e o Assistente como "sem sinal".
 */
export const PRAZO_DA_AGENDA_DO_DIA_MS = 20_000;
export async function listarAgendaDoDia(
  token: string,
  de: Date,
  ate: Date,
  sinal: AbortSignal = AbortSignal.timeout(PRAZO_DA_AGENDA_DO_DIA_MS),
): Promise<EventoDaAgendaDoDia[]> {
  const eventos = await listarPaginado<GoogleEvent & { location?: string }>(
    CALENDARIO_DE_OCUPACAO,
    {
      timeMin: de.toISOString(),
      timeMax: ate.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "false",
      maxResults: "250",
      fields: "nextPageToken,items(id,status,summary,start,end,htmlLink,location)",
    },
    token,
    sinal,
  );
  return eventos.flatMap((evento) => {
    if (evento.status === "cancelled") return [];
    const inicio = evento.start?.dateTime ?? evento.start?.date;
    const fim = evento.end?.dateTime ?? evento.end?.date;
    if (!inicio || !fim) return [];
    return [{
      id: evento.id,
      titulo: evento.summary?.trim() || "(sem título)",
      inicio,
      fim,
      diaInteiro: !evento.start?.dateTime,
      ...(evento.htmlLink ? { htmlLink: evento.htmlLink } : {}),
      ...(evento.location ? { local: evento.location } : {}),
    }];
  });
}

/**
 * Lê as quests do Google Calendar — a fonte de verdade. Uma chamada por
 * domínio: `privateExtendedProperty` repetido no mesmo request seria AND,
 * não OR, então domínios diferentes não cabem numa query só.
 *
 * Um domínio quebrado não pode derrubar os outros: cada um no seu try, e os
 * erros voltam nomeados junto com o que deu certo.
 */
export async function listarQuests(
  token: string,
  calendarId: string,
  dominios: string[],
  agora: Date,
): Promise<{ quests: QuestCalendario[]; erros: ErroDeDominio[] }> {
  const timeMin = new Date(agora.getTime() - 7 * 24 * 3600_000).toISOString();
  const timeMax = new Date(agora.getTime() + 90 * 24 * 3600_000).toISOString();

  const lotes = await Promise.all(
    dominios.map(async (dominio) => {
      const params = {
        privateExtendedProperty: `${PROP_DOMINIO}=${dominio}`,
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        showDeleted: "false",
        maxResults: "250",
      };
      try {
        const eventos = await listarPaginado<GoogleEvent>(calendarId, params, token);
        return { dominio, eventos, erro: null as ErroDeDominio | null };
      } catch (err: any) {
        return {
          dominio,
          eventos: [] as GoogleEvent[],
          erro: {
            dominio,
            erro: err?.message ?? String(err),
            credencial: err instanceof ErroCalendario && err.ehCredencial,
            ...(err instanceof LeituraIncompleta ? { incompleto: true as const } : {}),
          },
        };
      }
    }),
  );

  const porId = new Map<string, QuestCalendario>();
  const erros: ErroDeDominio[] = [];
  for (const lote of lotes) {
    if (lote.erro) erros.push(lote.erro);
    for (const ev of lote.eventos) {
      if (ev.status === "cancelled") continue;
      const quest = paraQuest(ev);
      if (quest) porId.set(quest.eventId, quest);
    }
  }

  const quests = [...porId.values()].sort(
    (a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime(),
  );
  return { quests, erros };
}

/**
 * Eventos do SquadOne numa janela CURTA, para os lembretes (vigia.ts). Uma
 * chamada por calendário e sem `privateExtendedProperty`: o filtro por marca
 * exige uma chamada por domínio (match exato, sem wildcard), e numa janela de
 * minutos o payload sem filtro é pequeno. A marca é conferida aqui, e o
 * domínio ativo em `disparosDevidos`.
 */
export async function listarQuestsDaJanela(
  token: string,
  calendarId: string,
  de: Date,
  ate: Date,
  /** A vigia passa um prazo: sem ele uma resposta parada prendia a varredura por minutos. */
  sinal?: AbortSignal,
): Promise<QuestCalendario[]> {
  const eventos = await listarPaginado<GoogleEvent>(
    calendarId,
    {
      timeMin: de.toISOString(),
      timeMax: ate.toISOString(),
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "250",
    },
    token,
    sinal,
  );
  const quests: QuestCalendario[] = [];
  for (const ev of eventos) {
    if (ev.status === "cancelled") continue;
    if (!ev.extendedProperties?.private?.[PROP_DOMINIO]) continue;
    const quest = paraQuest(ev);
    if (quest) quests.push(quest);
  }
  return quests;
}

/**
 * Ocupação da agenda para o alocador (Fase 3). GLOBAL: sempre o calendário
 * principal inteiro, qualquer que seja o calendarId da squad, sem filtro de
 * marca — conflito é com tudo que o usuário tem, inclusive o que o app não criou.
 */
export const CALENDARIO_DE_OCUPACAO = "primary";
const CAMPOS_OCUPACAO =
  "nextPageToken,items(status,transparency,eventType,start,end,attendees(self,responseStatus))";

export interface EventoDeOcupacao {
  status?: string;
  transparency?: string;
  eventType?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/**
 * Um evento ocupa a agenda? Não ocupa: cancelado; transparente (o Google diz
 * que não bloqueia — inclui os marcos do app); dia inteiro (feriado,
 * aniversário, lembrete); workingLocation/birthday; recusado pelo próprio
 * usuário. Todo o resto ocupa, inclusive tentativo e sem resposta: na dúvida,
 * não marcar por cima.
 */
export function eventoOcupa(ev: EventoDeOcupacao): Intervalo | null {
  if (ev.status === "cancelled") return null;
  if (ev.transparency === "transparent") return null;
  if (ev.eventType === "workingLocation" || ev.eventType === "birthday") return null;
  if (!ev.start?.dateTime || !ev.end?.dateTime) return null;
  if (ev.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  const inicio = Date.parse(ev.start.dateTime);
  const fim = Date.parse(ev.end.dateTime);
  if (!(fim > inicio)) return null;
  return { inicio, fim };
}

/**
 * Lê a ocupação entre `de` e `ate`. `singleEvents` expande recorrentes;
 * `maxAttendees=1` faz o Google devolver só o próprio usuário em eventos com
 * muitos convidados (é dele que sai o "recusado"); `fields` corta o payload.
 * Mais de 10 páginas é erro, não leitura parcial: alocar sobre ocupação
 * incompleta marcaria por cima de compromissos.
 */
export async function lerOcupacao(token: string, de: Date, ate: Date, sinal?: AbortSignal): Promise<Intervalo[]> {
  const eventos = await listarPaginado<EventoDeOcupacao>(
    CALENDARIO_DE_OCUPACAO,
    {
      timeMin: de.toISOString(),
      timeMax: ate.toISOString(),
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "2500",
      maxAttendees: "1",
      fields: CAMPOS_OCUPACAO,
    },
    token,
    sinal,
  );
  const ocupado: Intervalo[] = [];
  for (const ev of eventos) {
    const intervalo = eventoOcupa(ev);
    if (intervalo) ocupado.push(intervalo);
  }
  return ocupado;
}

// --- Token por chamada -----------------------------------------------------

/**
 * Quem pede o access token a cada chamada (na rota, `tokenValido`). Um ajuste
 * de esforço faz dezenas de escritas em série: um token lido uma vez no começo
 * podia vencer no meio, o PATCH voltava 401 e a UI desconectava à toa. O cache
 * do auth-store torna pedir de novo barato.
 */
export type ObterToken = () => Promise<string>;

/**
 * Pede o token IMEDIATAMENTE antes da chamada. Se o Google recusar a
 * credencial, pede de novo e, vindo um token diferente, repete uma vez: 401
 * só vira `precisaConectar` se persistir com o token recém-obtido. Repetir é
 * seguro: 401 é recusa antes de aplicar, nada foi gravado.
 *
 * `ehCredencial` existe para o Google Tasks (server/tasks.ts) reusar o mesmo
 * retry: lá só 401 é credencial — 403 de escopo insuficiente é "ampliar
 * acesso", e repetir com token novo não o conserta.
 */
export async function comToken<T>(
  obter: ObterToken,
  fn: (token: string) => Promise<T>,
  ehCredencial: (err: unknown) => boolean = (err) => err instanceof ErroCalendario && err.ehCredencial,
): Promise<T> {
  const token = await obter();
  try {
    return await fn(token);
  } catch (err) {
    if (!ehCredencial(err)) throw err;
    const novo = await obter();
    if (novo === token) throw err;
    return fn(novo);
  }
}

// --- Um evento: ler, atualizar com If-Match, inserir -----------------------

/** O evento foi apagado no Google (404/410 ou `status: cancelled`). */
export class QuestSumiu extends Error {
  readonly eventId: string;
  constructor(eventId: string) {
    super(`O evento '${eventId}' não existe mais no Google Calendar.`);
    this.name = "QuestSumiu";
    this.eventId = eventId;
  }
}

/** 412: o evento mudou entre a leitura e a escrita. Quem chama decide se relê. */
export class PreCondicaoFalhou extends Error {
  constructor() {
    super("O evento mudou no Google entre a leitura e a escrita (412).");
    this.name = "PreCondicaoFalhou";
  }
}

/**
 * O Google devolveu o evento sem as marcas squadone_*, e a restauração também
 * falhou. Sem `squadone_dominio` a quest some da Mochila: o erro nomeia o
 * evento para o usuário conferir no Google.
 */
export class MarcasPerdidas extends Error {
  constructor(eventId: string) {
    super(
      `O Google devolveu o evento '${eventId}' sem as marcas do SquadOne: ele pode ter sumido da Mochila. Confira no Google Calendar.`,
    );
    this.name = "MarcasPerdidas";
  }
}

export interface EventoLido {
  id: string;
  etag: string;
  summary: string;
  colorId?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  description: string;
  privado: Record<string, string>;
  tipo: "time_blocking" | "deadline";
  dominio: string;
  membro: string;
  squad: string;
  prazoRef: string;
  diaInteiro: boolean;
}

export const CAMPOS_EVENTO = "id,etag,status,summary,colorId,start,end,description,extendedProperties";

/**
 * Formato de id de evento aceito. A doc do recurso Event: ids têm de 5 a 1024
 * caracteres em base32hex (a-v, 0-9). Instâncias de evento recorrente, que o
 * Google gera, acrescentam "_" e um carimbo com maiúsculas
 * (`abc_20260915T130000Z`, `abc_R20260915T130000`): por isso letras, dígitos
 * e "_". Barra `.`, `..`, `/`, `%`, `?` e `#`: com `..` a URL virava
 * `calendars/primary/` e o PATCH iria para outro recurso.
 */
export const FORMATO_ID_DE_EVENTO = /^[A-Za-z0-9_]{5,1024}$/;

export function urlDoEvento(calendarId: string, eventId: string): string {
  // Id que vem de fora é validado antes pelo formato (400 em lerIdDoEvento). Ids
  // lidos do próprio Google passam direto; a trava final só barra o que nem
  // encodeURIComponent protege: segmento vazio, "." e "..".
  if (!eventId || eventId === "." || eventId === "..") throw new Error(`Id de evento inválido: '${eventId}'.`);
  return `${urlDeEventos(calendarId)}/${encodeURIComponent(eventId)}`;
}

function paraEventoLido(ev: GoogleEvent): EventoLido {
  const privado = { ...(ev.extendedProperties?.private ?? {}) };
  const summary = ev.summary ?? "(sem título)";
  return {
    id: ev.id,
    etag: ev.etag ?? "",
    summary,
    colorId: ev.colorId,
    start: ev.start ?? {},
    end: ev.end ?? {},
    description: ev.description ?? "",
    privado,
    tipo: tipoDoEvento(privado, summary),
    dominio: privado[PROP_DOMINIO] ?? "",
    membro: privado[PROP_MEMBRO] ?? "",
    squad: privado[PROP_SQUAD] ?? "",
    prazoRef: privado[PROP_PRAZO_REF] ?? "",
    diaInteiro: !ev.start?.dateTime,
  };
}

export async function lerEvento(token: string, calendarId: string, eventId: string): Promise<EventoLido> {
  const resp = await fetch(
    `${urlDoEvento(calendarId, eventId)}?${new URLSearchParams({ fields: CAMPOS_EVENTO })}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (resp.status === 404 || resp.status === 410) throw new QuestSumiu(eventId);
  if (!resp.ok) throw new ErroCalendario(resp.status, await resp.text().catch(() => ""));
  const ev = (await resp.json()) as GoogleEvent;
  if (ev.status === "cancelled") throw new QuestSumiu(eventId);
  return paraEventoLido(ev);
}

/**
 * PATCH com If-Match. `sendUpdates=none`: nota de agente ou ajuste de horário
 * não pode disparar e-mail para convidados que o usuário tenha posto no Google.
 * Pela doc do events.patch, campo fora do corpo fica intocado. Prefira
 * `atualizarPreservandoMarcas`: esta não confere as marcas da resposta.
 */
export async function atualizarEvento(
  token: string,
  calendarId: string,
  eventId: string,
  etag: string,
  corpo: Record<string, unknown>,
): Promise<EventoLido> {
  const resp = await fetch(
    `${urlDoEvento(calendarId, eventId)}?${new URLSearchParams({ sendUpdates: "none", fields: CAMPOS_EVENTO })}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "If-Match": etag,
      },
      body: JSON.stringify(corpo),
    },
  );
  if (resp.status === 412) throw new PreCondicaoFalhou();
  if (resp.status === 404 || resp.status === 410) throw new QuestSumiu(eventId);
  if (!resp.ok) throw new ErroCalendario(resp.status, await resp.text().catch(() => ""));
  return paraEventoLido((await resp.json()) as GoogleEvent);
}

/**
 * Toda marca squadone_* lida continua com o mesmo valor. Hashes de bloco
 * (`squadone_h_*`) ficam de fora: são justamente o que o PATCH troca.
 */
export function marcasPreservadas(
  lido: Record<string, string>,
  resposta: Record<string, string> | undefined,
): boolean {
  if (!resposta) return false;
  return Object.entries(lido)
    .filter(([k]) => k.startsWith("squadone_") && !k.startsWith("squadone_h_"))
    .every(([k, v]) => resposta[k] === v);
}

/**
 * O ÚNICO PATCH de evento que as rotas usam: não pode apagar as marcas. O guia
 * de extended properties diz que patch mexe em algumas chaves e deixa as
 * outras, mas não é explícito o bastante para apostar a Mochila nisso. Então:
 * 1. o corpo leva SEMPRE o `private` completo (tudo que foi lido + o que o
 *    chamador acrescenta) — sob fusão por chave nada muda, sob substituição do
 *    objeto as marcas continuam lá;
 * 2. a resposta é conferida; marca sumida → uma restauração com If-Match da
 *    resposta; ainda sumida (ou a restauração falhou) → `MarcasPerdidas`.
 * `PreCondicaoFalhou` do PATCH principal sobe: reler ou desistir é do chamador.
 */
export async function atualizarPreservandoMarcas(
  token: string | ObterToken,
  calendarId: string,
  lido: EventoLido,
  corpo: Record<string, unknown> & { extendedProperties?: { private?: Record<string, string> } },
): Promise<EventoLido> {
  const obter: ObterToken = typeof token === "string" ? async () => token : token;
  const privado = { ...lido.privado, ...(corpo.extendedProperties?.private ?? {}) };
  const completo = { ...corpo, extendedProperties: { private: privado } };
  const resposta = await comToken(obter, (t) => atualizarEvento(t, calendarId, lido.id, lido.etag, completo));
  if (marcasPreservadas(lido.privado, resposta.privado)) return resposta;
  try {
    const restaurado = await comToken(obter, (t) =>
      atualizarEvento(t, calendarId, lido.id, resposta.etag, { extendedProperties: { private: privado } }),
    );
    if (marcasPreservadas(lido.privado, restaurado.privado)) return restaurado;
  } catch (err) {
    console.error(`[calendar] restauração das marcas de '${lido.id}' falhou:`, err);
  }
  throw new MarcasPerdidas(lido.id);
}

export async function inserirEvento(
  token: string,
  calendarId: string,
  corpo: Record<string, unknown>,
): Promise<{ id: string; htmlLink?: string }> {
  const resp = await fetch(`${urlDeEventos(calendarId)}?${new URLSearchParams({ sendUpdates: "none" })}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok) throw new ErroCalendario(resp.status, await resp.text().catch(() => ""));
  return (await resp.json()) as { id: string; htmlLink?: string };
}
