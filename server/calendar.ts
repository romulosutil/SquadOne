import type { Pessoa } from "./squad.ts";

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/**
 * Marcação de propriedade. DUAS chaves, não uma:
 *
 * - `squadone_dominio` é o eixo de FILTRO. `events.list` só aceita
 *   `privateExtendedProperty=chave=valor` com match exato — não existe
 *   wildcard `squadone=*`. Com um valor de domínio estável dá pra listar
 *   tudo de um domínio numa chamada.
 * - `squadone_membro` é o eixo de ATRIBUIÇÃO: quem executa. Muda quando a
 *   tarefa troca de dono sem mudar de domínio.
 *
 * Com uma chave só, os dois eixos colidiriam: filtrar por domínio perderia o
 * responsável, filtrar por responsável perderia a visão do domínio.
 */
export const PROP_DOMINIO = "squadone_dominio";
export const PROP_MEMBRO = "squadone_membro";

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

function paraQuest(ev: GoogleEvent): QuestCalendario | null {
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
    tipo: titulo.startsWith(PREFIXO_DEADLINE) ? "deadline" : "time_blocking",
    dominio: priv[PROP_DOMINIO] ?? "",
    membro: priv[PROP_MEMBRO] ?? "",
    htmlLink: ev.htmlLink,
  };
}

async function chamar(url: string, token: string): Promise<GoogleEvent[]> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => "");
    throw new Error(
      `Google Calendar respondeu ${resp.status}: ${corpo.slice(0, 300)}`,
    );
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
): Promise<{ quests: QuestCalendario[]; erros: { dominio: string; erro: string }[] }> {
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
        return { dominio, eventos: await chamar(url, token), erro: null as string | null };
      } catch (err: any) {
        return { dominio, eventos: [] as GoogleEvent[], erro: err?.message ?? String(err) };
      }
    }),
  );

  const porId = new Map<string, QuestCalendario>();
  const erros: { dominio: string; erro: string }[] = [];
  for (const lote of lotes) {
    if (lote.erro) erros.push({ dominio: lote.dominio, erro: lote.erro });
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
