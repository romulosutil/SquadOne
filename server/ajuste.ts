import { AgendaIndisponivel } from "./agenda.ts";
import {
  DURACAO_MAX_MIN,
  ESFORCO_MAX_MIN,
  HORIZONTE_DIAS,
  instanteLocal,
  lerInstante,
  type Janela,
} from "./alocador.ts";
import { formatarMinutos } from "./agendamento.ts";
import {
  atualizarPreservandoMarcas,
  comToken,
  inserirEvento,
  lerEvento,
  lerOcupacao,
  listarQuests,
  marcasDoEvento,
  MarcasPerdidas,
  PREFIXO_DEADLINE,
  PreCondicaoFalhou,
  QuestSumiu,
  type EventoLido,
  type ObterToken,
} from "./calendar.ts";
import { planejarDuracao, planejarEsforco } from "./plano-de-ajuste.ts";
import { lerIdDoEvento, QuestRecusada, validarQuestDaSquad } from "./quest.ts";
import { PedidoInvalido, resolverSquad, type Roster, type Squad } from "./squad.ts";

/**
 * Aplica uma proposta de ajuste que o usuário APROVOU. Relê o evento e
 * recalcula tudo: a proposta pode ser velha. Horário só muda aqui, e mover
 * exige `permitirMover`. Todo PATCH passa por atualizarPreservandoMarcas.
 */

const MIN_MS = 60_000;
const DIA_MS = 24 * 60 * MIN_MS;

export interface PedidoDeAjuste {
  squad: Squad;
  eventId: string;
  alvo: "duracao" | "esforco";
  propostoMin: number;
  permitirMover: boolean;
}

export interface EventoAjustado {
  eventId: string;
  inicio: string;
  fim: string;
  acao: "encurtado" | "estendido" | "movido" | "criado";
}

export interface RespostaDeAjuste {
  alvo: "duracao" | "esforco";
  eventos: EventoAjustado[];
  avisos: string[];
  /** Esforço que não coube (ou não foi criado) antes do prazo. */
  faltou_min: number;
  /** Redução que não aconteceu: blocos já no mínimo, no passado ou que mudaram no Google. */
  sobra_min: number;
}

const iso = (t: number) => new Date(t).toISOString();
/** Via lerInstante e nunca Date.parse: texto sem offset seria lido no fuso do container. */
const instante = (valor: string | undefined, fuso: string) => (valor ? lerInstante(valor, fuso)?.instante : undefined);

export function interpretarPedidoDeAjuste(roster: Roster, eventId: unknown, corpo: unknown): PedidoDeAjuste {
  const id = lerIdDoEvento(eventId);
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    throw new PedidoInvalido("O corpo deve ser um objeto.");
  }
  const { squadId, alvo, proposto_min, permitirMover } = corpo as Record<string, unknown>;
  if (alvo !== "duracao" && alvo !== "esforco") {
    throw new PedidoInvalido("'alvo' deve ser 'duracao' ou 'esforco'.");
  }
  const [minimo, maximo] = alvo === "duracao" ? [15, DURACAO_MAX_MIN] : [30, ESFORCO_MAX_MIN];
  if (
    typeof proposto_min !== "number" || !Number.isInteger(proposto_min) || proposto_min % 15 !== 0 ||
    proposto_min < minimo || proposto_min > maximo
  ) {
    throw new PedidoInvalido(`'proposto_min' deve ser múltiplo de 15 entre ${minimo} e ${maximo}.`);
  }
  if (permitirMover !== undefined && typeof permitirMover !== "boolean") {
    throw new PedidoInvalido("'permitirMover' deve ser booleano.");
  }
  return { squad: resolverSquad(roster, squadId), eventId: id, alvo, propostoMin: proposto_min, permitirMover: permitirMover === true };
}

/** Até quando pode haver trabalho para o prazo: com hora, o prazo; dia inteiro, o fim da janela naquele dia. */
function limiteDoMarco(marco: EventoLido, janela: Janela): number | undefined {
  if (marco.end.dateTime) return instante(marco.end.dateTime, janela.fuso);
  const dia = marco.start.date ? lerInstante(marco.start.date, janela.fuso) : null;
  return dia?.data ? instanteLocal(dia.data, janela.fimMin, janela.fuso) : undefined;
}

const alvoIncompativel = (mensagem: string) => new QuestRecusada("alvoIncompativel", mensagem);
const conflitoDeEdicao = () =>
  new QuestRecusada("conflitoDeEdicao", "O evento mudou no Google depois da proposta. Peça a contribuição de novo.");

export async function aplicarAjuste(
  // `obterToken` antes de CADA chamada ao Google: um ajuste de esforço faz até
  // dezenas de escritas em série, e um token lido no começo podia vencer no meio.
  x: PedidoDeAjuste & { obterToken: ObterToken; janela: Janela; agora: Date },
): Promise<RespostaDeAjuste> {
  const { squad, eventId, alvo, propostoMin, permitirMover, obterToken, janela, agora } = x;
  const cal = squad.calendarId;
  const fuso = janela.fuso;
  const agoraMs = agora.getTime();
  const ev = await comToken(obterToken, (t) => lerEvento(t, cal, eventId));
  const dominio = validarQuestDaSquad(ev, squad);
  const horizonte = new Date(agoraMs + HORIZONTE_DIAS * DIA_MS);

  if (alvo === "duracao") {
    const inicio = instante(ev.start.dateTime, fuso);
    const fim = instante(ev.end.dateTime, fuso);
    if (ev.tipo !== "time_blocking" || inicio === undefined || fim === undefined) {
      throw alvoIncompativel("Duração só se ajusta num bloco com horário (não em prazo nem em dia inteiro).");
    }
    const atual = { inicio, fim };
    if (atual.fim <= agoraMs) throw alvoIncompativel("Este bloco já terminou.");
    const lidos = await comToken(obterToken, (t) => lerOcupacao(t, agora, horizonte));
    // O próprio evento não pode colidir consigo mesmo: sai UM intervalo igual.
    const i = lidos.findIndex((o) => o.inicio === atual.inicio && o.fim === atual.fim);
    const ocupacao = i === -1 ? lidos : [...lidos.slice(0, i), ...lidos.slice(i + 1)];
    let limite: number | undefined;
    if (ev.prazoRef) {
      try {
        const prazoRef = ev.prazoRef;
        limite = limiteDoMarco(await comToken(obterToken, (t) => lerEvento(t, cal, prazoRef)), janela);
      } catch (err) {
        // Marco apagado: o bloco segue valendo, só sem limite.
        if (!(err instanceof QuestSumiu)) throw err;
      }
    }
    const plano = planejarDuracao({ atual, novoMin: propostoMin, ocupacao, janela, agora: agoraMs, limite, permitirMover });
    if (plano.acao === "nada") {
      return { alvo, eventos: [], avisos: ["A duração proposta é a atual: nada mudou."], faltou_min: 0, sobra_min: 0 };
    }
    if (plano.acao === "naoCabe") {
      throw new QuestRecusada(
        "naoCabe",
        `Estender para ${formatarMinutos(propostoMin)} no mesmo horário colide com a agenda, sai da janela de trabalho ou passa do prazo.`,
      );
    }
    if (plano.slot.fim <= agoraMs) {
      // Bloco em andamento: encurtar para um fim que já passou reescreveria o passado.
      throw alvoIncompativel(`Com ${formatarMinutos(propostoMin)} o bloco já teria terminado.`);
    }
    const corpo =
      plano.acao === "movido"
        ? { start: { dateTime: iso(plano.slot.inicio) }, end: { dateTime: iso(plano.slot.fim) } }
        : { end: { dateTime: iso(plano.slot.fim) } };
    try {
      await atualizarPreservandoMarcas(obterToken, cal, ev, corpo);
    } catch (err) {
      // Sem retentativa: o ajuste foi calculado sobre um horário que mudou.
      if (err instanceof PreCondicaoFalhou) throw conflitoDeEdicao();
      throw err;
    }
    return {
      alvo,
      eventos: [{ eventId: ev.id, inicio: iso(plano.slot.inicio), fim: iso(plano.slot.fim), acao: plano.acao }],
      avisos: [],
      faltou_min: 0,
      sobra_min: 0,
    };
  }

  if (ev.tipo !== "deadline") throw alvoIncompativel("Esforço só se ajusta no marco de um prazo.");
  const fimDoMarco = instante(ev.end.dateTime ?? ev.end.date, fuso);
  if (fimDoMarco === undefined || fimDoMarco <= agoraMs) throw alvoIncompativel("O prazo já passou.");
  const limite = limiteDoMarco(ev, janela);
  if (limite === undefined) throw alvoIncompativel("O marco não tem data legível.");

  // listarQuests não lança: devolve o erro por domínio. Credencial recusada
  // repete uma vez se vier token novo, como comToken.
  const tokenDaLista = await obterToken();
  let lida = await listarQuests(tokenDaLista, cal, [dominio.id], agora);
  if (lida.erros.some((e) => e.credencial)) {
    const novo = await obterToken();
    if (novo !== tokenDaLista) lida = await listarQuests(novo, cal, [dominio.id], agora);
  }
  if (lida.erros.length) {
    // Sem saber quais blocos existem, ajustar esforço seria cego.
    throw new AgendaIndisponivel(`Não deu para ler os blocos do prazo: ${lida.erros[0].erro}`, lida.erros[0].credencial);
  }
  const blocos = lida.quests
    .filter((q) => q.prazoRef === ev.id && !q.diaInteiro)
    .map((q) => ({ eventId: q.eventId, etag: q.etag ?? "", inicio: instante(q.inicio, fuso)!, fim: instante(q.fim, fuso)! }))
    .filter((b) => Number.isFinite(b.inicio) && Number.isFinite(b.fim));
  const ocupacao = await comToken(obterToken, (t) => lerOcupacao(t, agora, horizonte));
  const plano = planejarEsforco({ blocos, novoTotalMin: propostoMin, ocupacao, janela, agora: agoraMs, limite });

  const eventos: EventoAjustado[] = [];
  const avisos: string[] = [];
  let faltou = plano.faltouMin;
  let sobra = plano.sobraMin;
  if (!plano.criar.length && !plano.encurtar.length && !plano.faltouMin && !plano.sobraMin) {
    avisos.push("O esforço proposto é praticamente o reservado: nada mudou.");
  }

  for (let i = 0; i < plano.encurtar.length; i++) {
    const b = plano.encurtar[i];
    const original = blocos.find((x) => x.eventId === b.eventId)!;
    const corteMin = (original.fim - b.fim) / MIN_MS;
    try {
      // Lê o bloco para ter o private completo (a listagem não o traz) e confere
      // que é a MESMA versão que o plano considerou: etag diferente = o bloco
      // mudou desde a listagem, e o corte calculado não vale mais.
      const lido = await comToken(obterToken, (t) => lerEvento(t, cal, b.eventId));
      if (lido.etag !== b.etag) throw new PreCondicaoFalhou();
      await atualizarPreservandoMarcas(obterToken, cal, lido, { end: { dateTime: iso(b.fim) } });
      eventos.push({ eventId: b.eventId, inicio: iso(b.inicio), fim: iso(b.fim), acao: "encurtado" });
    } catch (err: any) {
      if (err instanceof MarcasPerdidas) throw err;
      sobra += corteMin;
      if (err instanceof PreCondicaoFalhou || err instanceof QuestSumiu) {
        // Outro evento: os demais blocos continuam válidos.
        avisos.push(`O bloco ${b.eventId} mudou no Google e não foi encurtado.`);
        continue;
      }
      // Rede, credencial, quota: a série para, o que foi feito fica.
      const resto = plano.encurtar.slice(i + 1).reduce((t, x) => {
        const o = blocos.find((y) => y.eventId === x.eventId)!;
        return t + (o.fim - x.fim) / MIN_MS;
      }, 0);
      sobra += resto;
      avisos.push(`Parei de encurtar blocos: ${err?.message ?? String(err)}.`);
      break;
    }
  }
  if (sobra > 0) {
    avisos.push(
      `Sobraram ${formatarMinutos(sobra)} reservados: os blocos futuros já estão no mínimo de 30 min ou mudaram. Apague ou encurte blocos no Google se quiser.`,
    );
  }

  const tituloBase = ev.summary.startsWith(PREFIXO_DEADLINE)
    ? ev.summary.slice(PREFIXO_DEADLINE.length).trim()
    : ev.summary.trim();
  const n = plano.criar.length;
  for (let i = 0; i < n; i++) {
    const s = plano.criar[i];
    try {
      const criado = await comToken(obterToken, (t) => inserirEvento(t, cal, {
        summary: `${tituloBase} (bloco extra ${i + 1}/${n})`,
        description: "Criado pelo SquadOne. Trabalho extra aprovado para o prazo.",
        ...(ev.colorId ? { colorId: ev.colorId } : {}),
        start: { dateTime: iso(s.inicio) },
        end: { dateTime: iso(s.fim) },
        extendedProperties: {
          private: marcasDoEvento({
            squadId: squad.id, dominioId: dominio.id, pessoaId: ev.membro, tipo: "time_blocking", prazoRef: ev.id,
          }),
        },
      }));
      eventos.push({ eventId: criado.id, inicio: iso(s.inicio), fim: iso(s.fim), acao: "criado" });
    } catch (err: any) {
      // Como a Fase 3: o que foi criado fica; a série para para não abrir buracos.
      const resto = plano.criar.slice(i).reduce((t, y) => t + (y.fim - y.inicio) / MIN_MS, 0);
      faltou += resto;
      avisos.push(`O bloco extra ${i + 1}/${n} não foi criado (${err?.message ?? String(err)}); ${formatarMinutos(resto)} ficaram sem reserva.`);
      break;
    }
  }
  if (plano.faltouMin > 0) {
    avisos.push(`Faltaram ${formatarMinutos(plano.faltouMin)} de trabalho antes do prazo: não coube em horário livre.`);
  }
  return { alvo, eventos, avisos, faltou_min: faltou, sobra_min: sobra };
}
