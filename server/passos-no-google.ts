import { PrecisaConectar } from "./auth-store.ts";
import type { AvisoDoCompromisso, CompromissoAgendado } from "./agendamento.ts";
import {
  atualizarPreservandoMarcas,
  comToken,
  ErroCalendario,
  lerEvento,
  PROP_TASKS_LISTA,
  PROP_TASKS_PAI,
  type EventoLido,
  type ObterToken,
  type QuestCalendario,
} from "./calendar.ts";
import { dueDaTarefa, notasDaTarefaMae, progressoDosPassos, tituloDaLista } from "./passos.ts";
import { gravarTasksListaId, localizarSquad, readRoster, type Roster, type Squad } from "./squad.ts";
import {
  comTokenTasks,
  ErroTasks,
  inserirLista,
  inserirTarefa,
  lerLista,
  ListaSumiu,
  listarTarefas,
  type CorpoDeTarefa,
  type TarefaLida,
} from "./tasks.ts";

/**
 * Passos de um compromisso viram tarefa-mãe + subtarefas no Google Tasks,
 * ligadas ao evento principal. Roda DEPOIS de os eventos existirem, e nada
 * aqui desfaz ou falha o compromisso: os eventos já estão certos no Google, e
 * a checklist é acessório. Toda falha volta como aviso classificado.
 *
 * capabilities.ts escreve por aqui; a rota da Mochila só LÊ o selo de progresso
 * (`anexarProgressoDosPassos`). agendamento.ts não sabe que o Tasks existe.
 * Escrita única: nada reescreve as tarefas depois (o Ajuste não mexe no `due`,
 * apagar o evento deixa as tarefas órfãs, a vigia não sabe do Tasks).
 */

export interface DependenciasDosPassos {
  lerRoster: () => Promise<Roster>;
  gravarListaId: (squadId: string, listaId: string) => Promise<boolean>;
  inserirLista: (token: string, titulo: string) => Promise<{ id: string }>;
  lerLista: (token: string, listaId: string) => Promise<{ id: string }>;
  inserirTarefa: (
    token: string,
    listaId: string,
    corpo: CorpoDeTarefa,
    posicao?: { parent?: string; previous?: string },
  ) => Promise<{ id: string }>;
  lerEvento: (token: string, calendarId: string, eventId: string) => Promise<EventoLido>;
  atualizarPreservandoMarcas: (
    obter: ObterToken,
    calendarId: string,
    lido: EventoLido,
    corpo: { extendedProperties: { private: Record<string, string> } },
  ) => Promise<EventoLido>;
}

export interface PedidoDePassos {
  compromisso: CompromissoAgendado;
  /** A squad ATIVA do turno: a lista é dela (no redirecionamento, a de destino). */
  squad: Squad;
  /** Já normalizados (`normalizarPassos`). */
  passos: string[];
  obterToken: ObterToken;
  /** A credencial tem o escopo do Tasks? Lido uma vez pela rota. */
  liberado: boolean;
  fuso: string;
}

export interface ResultadoDosPassos {
  /** Subtarefas criadas (a mãe não conta). */
  criados: number;
  avisos: AvisoDoCompromisso[];
  listaId?: string;
  tarefaMaeId?: string;
}

export interface PedidoDeTarefaAvulsa {
  /** A squad ATIVA do turno: a tarefa vai para a lista dela. */
  squad: Squad;
  /** Já normalizado (`normalizarTituloDaTarefa`), não vazio. */
  titulo: string;
  notas: string;
  /** `dueDaData`; ausente = tarefa sem data. */
  due?: string;
  /** Já normalizados (`normalizarPassos`); vazio = tarefa sem subtarefas. */
  passos: string[];
  obterToken: ObterToken;
  liberado: boolean;
}

export interface ResultadoDaTarefaAvulsa {
  tarefaId: string;
  listaId: string;
  /** Subtarefas criadas. */
  criados: number;
  avisos: AvisoDoCompromisso[];
}

export const AVISO_SEM_ESCOPO = "Passos não criados: falta autorizar o Google Tasks.";

/**
 * Tarefa avulsa sem o escopo do Tasks. Não é falha de credencial: o Calendar
 * funciona, e o gesto é AMPLIAR o acesso (`motivoDoErro` → `ampliarAcesso`).
 */
export class TasksNaoAutorizado extends Error {
  constructor() {
    super("Tarefa não criada: falta autorizar o Google Tasks.");
    this.name = "TasksNaoAutorizado";
  }
}

/**
 * Gesto de uma falha do Tasks. Escopo insuficiente é AMPLIAR, não reconectar:
 * o Calendar acabou de funcionar neste mesmo compromisso. Só 401 que persistiu
 * com token novo (ou credencial ausente) é `precisaConectar`. API desligada no
 * projeto não tem gesto: a mensagem do Google diz o que fazer.
 */
export function motivoDoErroTasks(err: unknown): AvisoDoCompromisso["motivo"] {
  if (err instanceof TasksNaoAutorizado) return "ampliarAcesso";
  if (err instanceof ErroTasks && err.escopoInsuficiente) return "ampliarAcesso";
  if ((err instanceof ErroTasks && err.ehCredencial) || err instanceof PrecisaConectar) return "precisaConectar";
  return undefined;
}

const mensagem = (err: unknown) => (err as Error)?.message ?? String(err);

function aviso(texto: string, motivo: AvisoDoCompromisso["motivo"]): AvisoDoCompromisso {
  return motivo ? { aviso: texto, motivo } : { aviso: texto };
}

export function criarPassosNoGoogle(dep: DependenciasDosPassos) {
  /**
   * Single-flight por squad. Processo único, então memória basta: dois turnos
   * com passos na mesma squad sem lista criariam duas listas iguais no celular.
   */
  const emCriacao = new Map<string, Promise<string>>();

  /**
   * Id da lista da squad, criando se preciso. A chamada ao Google fica FORA da
   * fila do roster (segurar a fila durante rede travaria todas as escritas);
   * só a gravação do id entra nela. Id gravado que sumiu no Google (404/410):
   * cria outra e sobrescreve, uma vez só por chamada.
   */
  function garantirListaDaSquad(squad: Squad, obterToken: ObterToken): Promise<string> {
    const emCurso = emCriacao.get(squad.id);
    if (emCurso) return emCurso;
    const promessa = (async () => {
      // Relê: o `squad` do turno foi lido no começo, e outro turno pode ter
      // gravado a lista depois.
      const atual = localizarSquad(await dep.lerRoster(), squad.id) ?? squad;
      const gravada = atual.tasksListaId;
      if (gravada) {
        try {
          await comTokenTasks(obterToken, (t) => dep.lerLista(t, gravada));
          return gravada;
        } catch (err) {
          if (!(err instanceof ListaSumiu)) throw err;
        }
      }
      const lista = await comTokenTasks(obterToken, (t) => dep.inserirLista(t, tituloDaLista(atual.nome)));
      try {
        await dep.gravarListaId(squad.id, lista.id);
      } catch (err) {
        // A lista existe e serve para ESTE compromisso. Sem o id gravado o
        // próximo turno cria outra — custo aceito contra perder os passos agora.
        console.error(`[tasks] lista '${lista.id}' criada, mas o id não foi gravado no roster:`, err);
      }
      return lista.id;
    })().finally(() => emCriacao.delete(squad.id));
    emCriacao.set(squad.id, promessa);
    return promessa;
  }

  /** Subtarefas em ordem sob `maeId`. Não lança: falha para a série e vira aviso. */
  async function criarSubtarefas(
    listaId: string,
    maeId: string,
    passos: string[],
    obterToken: ObterToken,
  ): Promise<{ criados: number; avisos: AvisoDoCompromisso[] }> {
    const avisos: AvisoDoCompromisso[] = [];
    let criados = 0;
    let anterior: string | undefined;
    for (let i = 0; i < passos.length; i++) {
      try {
        // Sem `due`: com data, cada subtarefa viraria um chip no Google Calendar.
        // `previous` mantém a ordem da demanda (sem ele, cada uma iria ao topo).
        const sub = await comTokenTasks(obterToken, (t) =>
          dep.inserirTarefa(t, listaId, { title: passos[i] }, { parent: maeId, previous: anterior }),
        );
        anterior = sub.id;
        criados++;
      } catch (err) {
        // Para a série como os blocos de prazo: não apaga nada, não abre buraco
        // no meio da checklist.
        const faltaram = passos.length - i;
        avisos.push(
          aviso(
            `${faltaram} de ${passos.length} passo(s) não criado(s) no Google Tasks: ${mensagem(err)}`,
            motivoDoErroTasks(err),
          ),
        );
        break;
      }
    }
    return { criados, avisos };
  }

  /**
   * Tarefa AVULSA: sem evento, sem horário, só o Google Tasks. Diferente dos
   * passos de um compromisso, aqui a tarefa É o resultado — então a falha antes
   * de ela existir LANÇA (o turno a mostra como erro, com o gesto de
   * `motivoDoErroTasks`), e só o que vem depois (subtarefas) vira aviso.
   */
  async function criarTarefaAvulsa(p: PedidoDeTarefaAvulsa): Promise<ResultadoDaTarefaAvulsa> {
    if (!p.liberado) throw new TasksNaoAutorizado();
    const listaId = await garantirListaDaSquad(p.squad, p.obterToken);
    const tarefa = await comTokenTasks(p.obterToken, (t) =>
      dep.inserirTarefa(t, listaId, {
        title: p.titulo,
        notes: p.notas,
        ...(p.due ? { due: p.due } : {}),
      }),
    );
    if (p.passos.length === 0) return { tarefaId: tarefa.id, listaId, criados: 0, avisos: [] };
    const { criados, avisos } = await criarSubtarefas(listaId, tarefa.id, p.passos, p.obterToken);
    return { tarefaId: tarefa.id, listaId, criados, avisos };
  }

  async function criarPassosDoCompromisso(p: PedidoDePassos): Promise<ResultadoDosPassos> {
    const principal = p.compromisso.eventos[0];
    if (p.passos.length === 0 || !principal) return { criados: 0, avisos: [] };
    // Sem o escopo nem tenta: o 403 seria certo, e cada chamada inútil custa
    // tempo dentro da série de agendamentos do turno.
    if (!p.liberado) return { criados: 0, avisos: [aviso(AVISO_SEM_ESCOPO, "ampliarAcesso")] };

    let listaId: string;
    let maeId: string;
    try {
      listaId = await garantirListaDaSquad(p.squad, p.obterToken);
      const mae = await comTokenTasks(p.obterToken, (t) =>
        dep.inserirTarefa(t, listaId, {
          title: p.compromisso.titulo,
          notes: notasDaTarefaMae(principal.htmlLink, principal.eventId),
          due: dueDaTarefa(principal, p.fuso),
        }),
      );
      maeId = mae.id;
    } catch (err) {
      return {
        criados: 0,
        avisos: [aviso(`Passos não criados no Google Tasks: ${mensagem(err)}`, motivoDoErroTasks(err))],
      };
    }

    const { criados, avisos } = await criarSubtarefas(listaId, maeId, p.passos, p.obterToken);

    try {
      const lido = await comToken(p.obterToken, (t) => dep.lerEvento(t, p.squad.calendarId, principal.eventId));
      await dep.atualizarPreservandoMarcas(p.obterToken, p.squad.calendarId, lido, {
        extendedProperties: { private: { [PROP_TASKS_LISTA]: listaId, [PROP_TASKS_PAI]: maeId } },
      });
    } catch (err) {
      // As tarefas ficam, com o vínculo só nas notas da mãe.
      avisos.push(
        aviso(
          `Passos criados no Google Tasks, mas o vínculo no evento não foi gravado: ${mensagem(err)}`,
          err instanceof ErroCalendario && err.ehCredencial ? "precisaConectar" : undefined,
        ),
      );
    }

    return { criados, avisos, listaId, tarefaMaeId: maeId };
  }

  return { garantirListaDaSquad, criarPassosDoCompromisso, criarTarefaAvulsa };
}

/**
 * Selo "passos 2/5" da Mochila: lê a checklist de cada quest com
 * `squadone_tasks_pai` e anexa `quest.passos`. Só LEITURA, e nunca estraga a
 * Mochila: sem escopo, sem quest com passos ou com o Tasks fora do ar, as
 * quests voltam como vieram, sem selo (o erro vai só para o log). Uma
 * `tasks.list` por LISTA distinta, não por quest — hoje uma por squad.
 */
export async function anexarProgressoDosPassos(
  quests: QuestCalendario[],
  opcoes: {
    liberado: boolean;
    obterToken: ObterToken;
    listar?: (token: string, listaId: string) => Promise<TarefaLida[]>;
  },
): Promise<void> {
  if (!opcoes.liberado) return;
  const listar = opcoes.listar ?? listarTarefas;
  const porLista = new Map<string, QuestCalendario[]>();
  for (const q of quests) {
    if (!q.tasksLista || !q.tasksPai) continue;
    porLista.set(q.tasksLista, [...(porLista.get(q.tasksLista) ?? []), q]);
  }
  await Promise.all(
    [...porLista].map(async ([listaId, daLista]) => {
      try {
        const tarefas = await comTokenTasks(opcoes.obterToken, (t) => listar(t, listaId));
        const progresso = progressoDosPassos(tarefas, daLista.map((q) => q.tasksPai));
        for (const q of daLista) {
          const p = progresso.get(q.tasksPai);
          if (p) q.passos = p;
        }
      } catch (err) {
        // Lista apagada no celular, escopo revogado, Tasks lento: o selo some,
        // a Mochila não. Nada de 401 aqui — a credencial do Calendar acabou de
        // funcionar nesta mesma rota.
        console.warn(`[tasks] progresso da lista '${listaId}' não lido:`, mensagem(err));
      }
    }),
  );
}

/** A instância do servidor: um Map de single-flight para o processo inteiro. */
export const passosNoGoogle = criarPassosNoGoogle({
  lerRoster: readRoster,
  gravarListaId: gravarTasksListaId,
  inserirLista,
  lerLista,
  inserirTarefa,
  lerEvento,
  atualizarPreservandoMarcas,
});
