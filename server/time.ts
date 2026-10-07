/**
 * Time vivo (07/10/2026): o que cada squad ativa tem na agenda agora, para a
 * Hoje dar estado a TODAS as squads, não só à ativa da aba. Antes as outras
 * ficavam `Sem sinal`, porque a única leitura era a Mochila da squad ativa.
 *
 * Duas partes:
 * - `agruparTimePorSquad`, PURA: quests já lidas + roster + agora → por squad.
 * - `criarLeitorDoTime`: um `listarQuestsDaJanela` por calendário distinto
 *   (os mesmos alvos da vigia), com cache em memória de 60 s. O Google é a
 *   verdade (invariante 3): nada vai para o disco, e o cache só existe para a
 *   Hoje aberta em duas abas não dobrar as leituras.
 *
 * Só leitura: nada aqui escreve no Google nem no roster (RULES 10).
 */
import { FUSO, lerInstante } from "./alocador.ts";
import { PrecisaConectar } from "./auth-store.ts";
import { ErroCalendario, type QuestCalendario } from "./calendar.ts";
import { alvosDoRoster } from "./lembretes.ts";
import { dominiosAtivos, squadsAtivas, type Roster } from "./squad.ts";

const DIA_MS = 24 * 3600_000;

/**
 * Janela lida: um dia para trás pega o bloco que começou ontem e ainda corre
 * (e o marco de dia inteiro de hoje); sete à frente bastam para "o próximo".
 * Mais que isso é payload sem filtro de marca (uma chamada por calendário, não
 * por domínio) para nada que a Hoje mostre.
 */
export const JANELA_DO_TIME = { antesMs: DIA_MS, depoisMs: 7 * DIA_MS } as const;

/** Uma leitura vale por isto: a Hoje relê a cada 5 min, e duas abas não pagam duas vezes. */
export const CACHE_DO_TIME_MS = 60_000;

export interface BlocoAgora {
  pessoaId: string;
  titulo: string;
}

export interface ProximaDoTime {
  titulo: string;
  /** O instante que ordena: o prazo (`fim`) num marco, o início no resto. */
  inicio: string;
  pessoaId: string;
}

export interface TimeDaSquad {
  id: string;
  emBlocoAgora: BlocoAgora[];
  proxima: ProximaDoTime | null;
}

export interface ErroDoTime {
  squadId: string;
  erro: string;
}

export interface RespostaDoTime {
  /** Só as squads cujo calendário foi lido: squad fora daqui é "sem sinal", nunca "livre". */
  squads: TimeDaSquad[];
  lidoEm: string;
  erros: ErroDoTime[];
}

const instante = (valor: string) => lerInstante(valor, FUSO)?.instante ?? null;

/**
 * Agrupa as quests lidas por squad ativa. Quem decide a squad é o DOMÍNIO
 * (`squadone_dominio`), não a marca `squadone_squad`, que é só informativa e
 * falta nos eventos anteriores à Fase 1. Evento sem marca de domínio, de
 * domínio arquivado ou de squad arquivada fica fora — mesmo critério da
 * Mochila e da vigia. Duas squads no mesmo calendário devolvem o mesmo evento
 * duas vezes: dedupe por `eventId`.
 *
 * - **Em bloco agora:** bloco com horário (não marco, não dia inteiro) com
 *   início ≤ agora < fim.
 * - **Próxima:** a primeira que ainda não terminou e não está em bloco agora,
 *   ordenada como na Hoje (marco pelo prazo, o resto pelo início).
 *
 * Squad ativa sem quest nenhuma volta com `emBlocoAgora: []` e `proxima: null`:
 * lida e livre, não "sem sinal".
 */
export function agruparTimePorSquad(roster: Roster, quests: QuestCalendario[], agora: number): TimeDaSquad[] {
  const squadDoDominio = new Map<string, string>();
  const squads = squadsAtivas(roster);
  for (const s of squads) for (const d of dominiosAtivos(s)) squadDoDominio.set(d.id, s.id);

  const unicas = [...new Map(quests.map((q) => [q.eventId, q])).values()];
  const blocos = new Map<string, { bloco: BlocoAgora; inicio: number }[]>();
  const candidatas = new Map<string, { q: QuestCalendario; referencia: number }[]>();

  for (const q of unicas) {
    const squadId = q.dominio ? squadDoDominio.get(q.dominio) : undefined;
    if (!squadId) continue;
    const inicio = instante(q.inicio);
    const fim = instante(q.fim);
    if (inicio === null || fim === null) continue;
    // Fim exclusivo, também no dia inteiro (meia-noite do dia seguinte, no fuso).
    if (fim <= agora) continue;
    if (q.tipo === "time_blocking" && !q.diaInteiro && inicio <= agora) {
      const lista = blocos.get(squadId) ?? [];
      lista.push({ bloco: { pessoaId: q.membro, titulo: q.titulo }, inicio });
      blocos.set(squadId, lista);
      continue;
    }
    const lista = candidatas.get(squadId) ?? [];
    lista.push({ q, referencia: q.tipo === "deadline" ? fim : inicio });
    candidatas.set(squadId, lista);
  }

  return squads.map((s) => {
    const emBlocoAgora = (blocos.get(s.id) ?? [])
      .sort((a, b) => a.inicio - b.inicio || a.bloco.titulo.localeCompare(b.bloco.titulo, "pt-BR"))
      .map((b) => b.bloco);
    const primeira = (candidatas.get(s.id) ?? []).sort(
      (a, b) => a.referencia - b.referencia || a.q.titulo.localeCompare(b.q.titulo, "pt-BR"),
    )[0];
    const proxima = primeira
      ? { titulo: primeira.q.titulo, inicio: primeira.q.tipo === "deadline" ? primeira.q.fim : primeira.q.inicio, pessoaId: primeira.q.membro }
      : null;
    return { id: s.id, emBlocoAgora, proxima };
  });
}

export interface DependenciasDoTime {
  lerRoster: () => Promise<Roster>;
  obterToken: () => Promise<string>;
  listar: (token: string, calendarId: string, de: Date, ate: Date) => Promise<QuestCalendario[]>;
  relogio?: () => Date;
  cacheMs?: number;
}

const mensagemDe = (err: unknown) => (err as Error)?.message ?? String(err);

/**
 * Leitor com cache de processo. Lança `PrecisaConectar` sem credencial — e
 * também quando TODO calendário recusou o token, como a Mochila: devolver as
 * squads vazias faria a Hoje dizer "sem sinal" quando o gesto é reconectar.
 * Falha parcial vira `erros` por squad, e a squad sai de `squads`.
 */
export function criarLeitorDoTime(dep: DependenciasDoTime) {
  const relogio = dep.relogio ?? (() => new Date());
  const validadeMs = dep.cacheMs ?? CACHE_DO_TIME_MS;
  let guardado: { resposta: RespostaDoTime; ate: number } | null = null;
  // Single-flight: duas abas no mesmo segundo fazem UMA leitura.
  let emCurso: Promise<RespostaDoTime> | null = null;

  async function lerAgora(): Promise<RespostaDoTime> {
    const roster = await dep.lerRoster();
    const token = await dep.obterToken();
    const agora = relogio();
    const de = new Date(agora.getTime() - JANELA_DO_TIME.antesMs);
    const ate = new Date(agora.getTime() + JANELA_DO_TIME.depoisMs);
    const { calendarios } = alvosDoRoster(roster);

    const quests: QuestCalendario[] = [];
    const falhas = new Map<string, unknown>();
    for (const calendarId of calendarios) {
      // Um calendário quebrado não cala os outros (o mesmo da vigia).
      try {
        quests.push(...(await dep.listar(token, calendarId, de, ate)));
      } catch (err) {
        falhas.set(calendarId, err);
      }
    }
    if (calendarios.length && falhas.size === calendarios.length) {
      const todas = [...falhas.values()];
      if (todas.every((e) => e instanceof ErroCalendario && e.ehCredencial)) {
        throw new PrecisaConectar("Google recusou o access_token: reconecte o calendário.");
      }
    }

    const ativas = squadsAtivas(roster);
    const lidas = new Set(ativas.filter((s) => !falhas.has(s.calendarId)).map((s) => s.id));
    const erros: ErroDoTime[] = ativas
      .filter((s) => falhas.has(s.calendarId))
      .map((s) => ({ squadId: s.id, erro: mensagemDe(falhas.get(s.calendarId)) }));
    return {
      squads: agruparTimePorSquad(roster, quests, agora.getTime()).filter((t) => lidas.has(t.id)),
      lidoEm: agora.toISOString(),
      erros,
    };
  }

  return async function lerTime(): Promise<RespostaDoTime> {
    const agora = relogio().getTime();
    if (guardado && agora < guardado.ate) return guardado.resposta;
    if (!emCurso) {
      emCurso = lerAgora()
        .then((resposta) => {
          guardado = { resposta, ate: relogio().getTime() + validadeMs };
          return resposta;
        })
        .finally(() => {
          emCurso = null;
        });
    }
    return emCurso;
  };
}
