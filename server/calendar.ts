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
 * Falha de um domínio. `credencial` diz se reconectar resolve — o frontend
 * precisa dessa distincao para nao pedir reconexao contra um problema que
 * mora na configuracao do projeto Google.
 */
export interface ErroDeDominio {
  dominio: string;
  erro: string;
  credencial: boolean;
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
  summary?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export function paraQuest(ev: GoogleEvent): QuestCalendario | null {
  const priv = ev.extendedProperties?.private ?? {};
  const inicio = ev.start?.dateTime ?? ev.start?.date;
  const fim = ev.end?.dateTime ?? ev.end?.date;
  if (!inicio || !fim) return null; // evento sem horário: não é quest.

  const titulo = ev.summary ?? "(sem título)";
  const marca = priv[PROP_TIPO];
  return {
    eventId: ev.id,
    titulo,
    inicio,
    fim,
    diaInteiro: !ev.start?.dateTime,
    // A marca manda. O prefixo só vale para eventos criados antes dela
    // existir — sem migração, eles continuam lidos como sempre foram.
    tipo:
      marca === "deadline" || marca === "time_blocking"
        ? marca
        : titulo.startsWith(PREFIXO_DEADLINE)
          ? "deadline"
          : "time_blocking",
    dominio: priv[PROP_DOMINIO] ?? "",
    membro: priv[PROP_MEMBRO] ?? "",
    squad: priv[PROP_SQUAD] ?? "",
    prazoRef: priv[PROP_PRAZO_REF] ?? "",
    htmlLink: ev.htmlLink,
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

async function chamar(url: string, token: string): Promise<GoogleEvent[]> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => "");
    throw new ErroCalendario(resp.status, corpo);
  }
  const json = (await resp.json()) as { items?: GoogleEvent[] };
  return json.items ?? [];
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
      const url =
        `${urlDeEventos(calendarId)}?` +
        new URLSearchParams({
          privateExtendedProperty: `${PROP_DOMINIO}=${dominio}`,
          timeMin,
          timeMax,
          singleEvents: "true",
          orderBy: "startTime",
          showDeleted: "false",
          maxResults: "250",
        }).toString();
      try {
        return { dominio, eventos: await chamar(url, token), erro: null as ErroDeDominio | null };
      } catch (err: any) {
        return {
          dominio,
          eventos: [] as GoogleEvent[],
          erro: {
            dominio,
            erro: err?.message ?? String(err),
            credencial: err instanceof ErroCalendario && err.ehCredencial,
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
 * Ocupação da agenda para o alocador (Fase 3). GLOBAL: sempre o calendário
 * principal inteiro, qualquer que seja o calendarId da squad, sem filtro de
 * marca — conflito é com tudo que o usuário tem, inclusive o que o app não criou.
 */
export const CALENDARIO_DE_OCUPACAO = "primary";
const CAMPOS_OCUPACAO =
  "nextPageToken,items(status,transparency,eventType,start,end,attendees(self,responseStatus))";
const PAGINAS_MAX = 10;

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
export async function lerOcupacao(token: string, de: Date, ate: Date): Promise<Intervalo[]> {
  const ocupado: Intervalo[] = [];
  let pageToken: string | undefined;
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const params = new URLSearchParams({
      timeMin: de.toISOString(),
      timeMax: ate.toISOString(),
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "2500",
      maxAttendees: "1",
      fields: CAMPOS_OCUPACAO,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const resp = await fetch(`${urlDeEventos(CALENDARIO_DE_OCUPACAO)}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      throw new ErroCalendario(resp.status, await resp.text().catch(() => ""));
    }
    const json = (await resp.json()) as { items?: EventoDeOcupacao[]; nextPageToken?: string };
    for (const ev of json.items ?? []) {
      const intervalo = eventoOcupa(ev);
      if (intervalo) ocupado.push(intervalo);
    }
    if (!json.nextPageToken) return ocupado;
    pageToken = json.nextPageToken;
  }
  throw new Error(
    `A agenda tem mais de ${PAGINAS_MAX} páginas de eventos nos próximos dias: ` +
      "a ocupação ficaria incompleta, então nada foi alocado.",
  );
}
