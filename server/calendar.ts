import type { Pessoa } from "./squad.ts";

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/**
 * Marcação de propriedade. TRÊS chaves, cada uma um eixo:
 *
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
export const PROP_DOMINIO = "squadone_dominio";
export const PROP_MEMBRO = "squadone_membro";
export const PROP_TIPO = "squadone_tipo";

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
  htmlLink?: string;
}

/** Prefixo do summary de um deadline; usado na ida e na volta. */
export const PREFIXO_DEADLINE = "⏰ DEADLINE:";

/**
 * As duas marcas de uma pessoa, prontas pra `extendedProperties.private`.
 * `dominio` é o id do DOMÍNIO a que ela pertence, não um campo dela: quem
 * decide o eixo de filtro é a hierarquia, não a pessoa.
 */
export function marcasDoMembro(
  pessoa: Pessoa,
  dominio: string,
): Record<string, string> {
  return { [PROP_DOMINIO]: dominio, [PROP_MEMBRO]: pessoa.id };
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
  dominios: string[],
  agora: Date,
): Promise<{ quests: QuestCalendario[]; erros: ErroDeDominio[] }> {
  const timeMin = new Date(agora.getTime() - 7 * 24 * 3600_000).toISOString();
  const timeMax = new Date(agora.getTime() + 90 * 24 * 3600_000).toISOString();

  const lotes = await Promise.all(
    dominios.map(async (dominio) => {
      const url =
        `${API}?` +
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
