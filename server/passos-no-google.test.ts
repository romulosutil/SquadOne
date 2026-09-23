/**
 * Fluxo dos passos (D6 do spec): ordem das chamadas, single-flight da lista,
 * lista apagada, e cada falha virando aviso sem derrubar o compromisso.
 * Dependências são dublês — nada toca o Google nem o disco.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrecisaConectar } from "./auth-store.ts";
import type { CompromissoAgendado, EventoCriado } from "./agendamento.ts";
import { ErroCalendario, PROP_TASKS_LISTA, PROP_TASKS_PAI, type EventoLido, type QuestCalendario } from "./calendar.ts";
import {
  AVISO_SEM_ESCOPO,
  anexarProgressoDosPassos,
  renomearListaDaSquad,
  criarPassosNoGoogle,
  motivoDoErroTasks,
  TasksNaoAutorizado,
  type DependenciasDosPassos,
  type PedidoDePassos,
} from "./passos-no-google.ts";
import type { Roster, Squad } from "./squad.ts";
import { ErroTasks, ListaSumiu, type CorpoDeTarefa } from "./tasks.ts";

const FUSO = "America/Sao_Paulo";
const ESCOPO_403 = JSON.stringify({ error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } });
const DESLIGADA_403 = JSON.stringify({ error: { code: 403, message: "Google Tasks API has not been used in project 123 before or it is disabled.", errors: [{ reason: "accessNotConfigured" }] } });
const INVALIDA_401 = JSON.stringify({ error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } });

const pessoa = { id: "po", nome: "Ana", papel: "PO", escopo: "", sprite: "x", hiredAt: "2026-09-01" };
function squadCom(tasksListaId?: string): Squad {
  return {
    id: "pessoal", nome: "Pessoal", escopo: "", calendarId: "primary", unlockOrder: [[0, 0]],
    dominios: [{ id: "geral", nome: "Geral", escopo: "", slot: [0, 0], room: "r", criadoEm: "2026-09-01", po: pessoa, integrantes: [] }],
    ...(tasksListaId ? { tasksListaId } : {}),
  };
}
const rosterCom = (tasksListaId?: string): Roster => ({
  version: 3, idsAposentados: { pessoas: [], dominios: [] }, squads: [squadCom(tasksListaId)],
});

function compromisso(evento: Partial<EventoCriado> = {}): CompromissoAgendado {
  const principal: EventoCriado = {
    kind: "evento", titulo: "Preparar apresentação", responsavel_id: "po", tipo: "time_blocking", dominio: "geral",
    inicio: "2026-09-18T22:30:00-03:00", fim: "2026-09-18T23:30:00-03:00", dia_inteiro: false, papel: "foco",
    eventId: "ev1", htmlLink: "https://www.google.com/calendar/event?eid=ev1", ...evento,
  };
  return { kind: "compromisso", titulo: principal.titulo, responsavel_id: "po", tipo: principal.tipo, dominio: "geral", eventos: [principal], avisos: [], faltou_min: 0 };
}

function eventoLido(id: string): EventoLido {
  return {
    id, etag: '"e1"', summary: "x", start: {}, end: {}, description: "", privado: { squadone_dominio: "geral" },
    tipo: "time_blocking", dominio: "geral", membro: "po", squad: "pessoal", prazoRef: "", diaInteiro: false,
  };
}

function montar(sobre: Partial<DependenciasDosPassos> = {}, listaInicial?: string) {
  const log: string[] = [];
  const tarefas: { listaId: string; corpo: CorpoDeTarefa; posicao?: { parent?: string; previous?: string } }[] = [];
  const patches: { eventId: string; corpo: any }[] = [];
  let roster = rosterCom(listaInicial);
  let seqLista = 0;
  const dep: DependenciasDosPassos = {
    lerRoster: async () => roster,
    gravarListaId: async (squadId, listaId) => {
      log.push(`gravar:${squadId}:${listaId}`);
      roster = rosterCom(listaId);
      return true;
    },
    inserirLista: async (_t, titulo) => {
      log.push(`inserirLista:${titulo}`);
      return { id: `L${++seqLista}` };
    },
    lerLista: async (_t, id) => {
      log.push(`lerLista:${id}`);
      return { id };
    },
    inserirTarefa: async (_t, listaId, corpo, posicao) => {
      tarefas.push({ listaId, corpo, posicao });
      return { id: `T${tarefas.length}` };
    },
    lerEvento: async (_t, _cal, eventId) => eventoLido(eventId),
    atualizarPreservandoMarcas: async (_o, _cal, lido, corpo) => {
      patches.push({ eventId: lido.id, corpo });
      return lido;
    },
    ...sobre,
  };
  return { fluxo: criarPassosNoGoogle(dep), log, tarefas, patches };
}

const pedido = (p: Partial<PedidoDePassos> = {}): PedidoDePassos => ({
  compromisso: compromisso(), squad: squadCom(), passos: ["Montar slides", "Revisar dados", "Ensaiar"],
  obterToken: async () => "tk", liberado: true, fuso: FUSO, ...p,
});

describe("criarPassosDoCompromisso", () => {
  it("sem passos: nada acontece", async () => {
    const { fluxo, log, tarefas } = montar();
    assert.deepEqual(await fluxo.criarPassosDoCompromisso(pedido({ passos: [] })), { criados: 0, avisos: [] });
    assert.deepEqual([log, tarefas], [[], []]);
  });

  it("sem escopo: aviso ampliarAcesso e ZERO chamadas (nem token)", async () => {
    let pediuToken = false;
    const { fluxo, log, tarefas } = montar();
    const r = await fluxo.criarPassosDoCompromisso(pedido({ liberado: false, obterToken: async () => { pediuToken = true; return "tk"; } }));
    assert.deepEqual(r, { criados: 0, avisos: [{ aviso: AVISO_SEM_ESCOPO, motivo: "ampliarAcesso" }] });
    assert.deepEqual([log, tarefas, pediuToken], [[], [], false]);
  });

  it("squad sem lista: cria lista, grava id, mãe com due local, subtarefas em ordem com previous, PATCH do vínculo", async () => {
    const { fluxo, log, tarefas, patches } = montar();
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.deepEqual(log, ["inserirLista:SquadOne · Pessoal", "gravar:pessoal:L1"]);
    assert.deepEqual(tarefas[0], {
      listaId: "L1",
      corpo: {
        title: "Preparar apresentação",
        notes: "https://www.google.com/calendar/event?eid=ev1\nsquadone_evento=ev1",
        // 22:30 em SP é 01:30 UTC do dia 19: o due tem que ficar no dia 18.
        due: "2026-09-18T00:00:00.000Z",
      },
      posicao: undefined,
    });
    assert.deepEqual(tarefas.slice(1).map((t) => [t.corpo, t.posicao]), [
      [{ title: "Montar slides" }, { parent: "T1", previous: undefined }],
      [{ title: "Revisar dados" }, { parent: "T1", previous: "T2" }],
      [{ title: "Ensaiar" }, { parent: "T1", previous: "T3" }],
    ]);
    assert.deepEqual(patches, [{ eventId: "ev1", corpo: { extendedProperties: { private: { [PROP_TASKS_LISTA]: "L1", [PROP_TASKS_PAI]: "T1" } } } }]);
    assert.deepEqual(r, { criados: 3, avisos: [], listaId: "L1", tarefaMaeId: "T1" });
  });

  it("marco com hora: due é o dia do prazo (fim)", async () => {
    const { fluxo, tarefas } = montar();
    await fluxo.criarPassosDoCompromisso(pedido({
      compromisso: compromisso({ papel: "marco", tipo: "deadline", inicio: "2026-09-17T23:50:00-03:00", fim: "2026-09-18T00:05:00-03:00" }),
    }));
    assert.equal(tarefas[0].corpo.due, "2026-09-18T00:00:00.000Z");
  });

  it("lista gravada que existe: confere e usa, sem criar nem gravar", async () => {
    const { fluxo, log, tarefas } = montar({}, "L-EXISTE");
    await fluxo.criarPassosDoCompromisso(pedido({ squad: squadCom("L-EXISTE") }));
    assert.deepEqual(log, ["lerLista:L-EXISTE"]);
    assert.equal(tarefas[0].listaId, "L-EXISTE");
  });

  it("lista gravada apagada no Google: cria outra e sobrescreve o id", async () => {
    const { fluxo, log, tarefas } = montar({
      lerLista: async (_t, id) => {
        throw new ListaSumiu(id);
      },
    }, "L-VELHA");
    const r = await fluxo.criarPassosDoCompromisso(pedido({ squad: squadCom("L-VELHA") }));
    assert.deepEqual(log, ["inserirLista:SquadOne · Pessoal", "gravar:pessoal:L1"]);
    assert.equal(tarefas[0].listaId, "L1");
    assert.equal(r.criados, 3);
  });

  it("single-flight: dois compromissos em paralelo numa squad sem lista criam UMA lista", async () => {
    let soltar!: () => void;
    const segura = new Promise<void>((r) => (soltar = r));
    let criadas = 0;
    const { fluxo, tarefas } = montar({
      inserirLista: async () => {
        criadas++;
        await segura;
        return { id: "L-UNICA" };
      },
    });
    const a = fluxo.criarPassosDoCompromisso(pedido());
    const b = fluxo.criarPassosDoCompromisso(pedido({ compromisso: compromisso({ eventId: "ev2" }) }));
    await new Promise((r) => setImmediate(r));
    soltar();
    await Promise.all([a, b]);
    assert.equal(criadas, 1);
    assert.equal(new Set(tarefas.map((t) => t.listaId)).size, 1);
  });

  it("403 de escopo antes da mãe: aviso ampliarAcesso, nenhuma tarefa nem PATCH", async () => {
    const { fluxo, tarefas, patches } = montar({
      inserirLista: async () => {
        throw new ErroTasks(403, ESCOPO_403);
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(r.criados, 0);
    assert.equal(r.avisos.length, 1);
    assert.equal(r.avisos[0].motivo, "ampliarAcesso");
    assert.deepEqual([tarefas, patches], [[], []]);
  });

  it("API desligada: aviso SEM motivo, com a mensagem do Google", async () => {
    const { fluxo } = montar({
      inserirLista: async () => {
        throw new ErroTasks(403, DESLIGADA_403);
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(r.avisos[0].motivo, undefined);
    assert.match(r.avisos[0].aviso, /has not been used in project 123/);
  });

  it("401 persistente (mesmo token): aviso precisaConectar", async () => {
    const { fluxo } = montar({
      inserirLista: async () => {
        throw new ErroTasks(401, INVALIDA_401);
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(r.avisos[0].motivo, "precisaConectar");
  });

  it("401 com token novo disponível: repete uma vez e segue sem aviso", async () => {
    let n = 0;
    const tokens: string[] = [];
    const { fluxo } = montar({
      inserirLista: async (t) => {
        tokens.push(t);
        if (t === "tk1") throw new ErroTasks(401, INVALIDA_401);
        return { id: "L1" };
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido({ obterToken: async () => `tk${++n}` }));
    assert.deepEqual(tokens, ["tk1", "tk2"]);
    assert.deepEqual([r.criados, r.avisos], [3, []]);
  });

  it("sem credencial ao pedir o token: aviso precisaConectar", async () => {
    const { fluxo } = montar();
    const r = await fluxo.criarPassosDoCompromisso(pedido({
      obterToken: async () => {
        throw new PrecisaConectar("Nenhuma credencial do Google guardada.");
      },
    }));
    assert.equal(r.criados, 0);
    assert.equal(r.avisos[0].motivo, "precisaConectar");
  });

  it("2ª subtarefa falha: para a série, não apaga nada, avisa quantas faltaram e ainda grava o vínculo", async () => {
    let n = 0;
    const { fluxo, patches } = montar({
      inserirTarefa: async (_t, _l, corpo) => {
        n++;
        if (corpo.title === "Revisar dados") throw new Error("rede caiu");
        return { id: `T${n}` };
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(n, 3, "mãe + 1ª + 2ª (que falhou); a 3ª não é tentada");
    assert.equal(r.criados, 1);
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0].aviso, /^2 de 3 passo\(s\) não criado\(s\) no Google Tasks/);
    assert.equal(patches.length, 1);
  });

  it("PATCH do vínculo falha: passos ficam, aviso do vínculo", async () => {
    const { fluxo } = montar({
      atualizarPreservandoMarcas: async () => {
        throw new ErroCalendario(500, "{}");
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(r.criados, 3);
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0].aviso, /^Passos criados no Google Tasks, mas o vínculo no evento não foi gravado/);
  });

  it("gravar o id da lista falha: segue com a lista criada (só loga)", async () => {
    const { fluxo, tarefas } = montar({
      gravarListaId: async () => {
        throw new Error("disco cheio");
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(r.criados, 3);
    assert.equal(tarefas[0].listaId, "L1");
  });
});

describe("criarTarefaAvulsa", () => {
  const avulsa = (p: Record<string, unknown> = {}) => ({
    squad: squadCom(), titulo: "Comprar leite", notas: "SquadOne · Ana (Geral)", passos: [] as string[],
    obterToken: async () => "tk", liberado: true, ...p,
  });

  it("sem o escopo lança TasksNaoAutorizado (gesto ampliar) e não chama o Google", async () => {
    const { fluxo, log, tarefas } = montar();
    await assert.rejects(fluxo.criarTarefaAvulsa(avulsa({ liberado: false })), TasksNaoAutorizado);
    assert.equal(motivoDoErroTasks(new TasksNaoAutorizado()), "ampliarAcesso");
    assert.deepEqual(log, []);
    assert.equal(tarefas.length, 0);
  });

  it("cria a lista da squad na primeira vez e a tarefa com due, sem PATCH em evento", async () => {
    const { fluxo, log, tarefas, patches } = montar();
    const r = await fluxo.criarTarefaAvulsa(avulsa({ due: "2026-09-30T00:00:00.000Z" }));
    assert.deepEqual(log, ["inserirLista:SquadOne · Pessoal", "gravar:pessoal:L1"]);
    assert.deepEqual(tarefas, [
      { listaId: "L1", corpo: { title: "Comprar leite", notes: "SquadOne · Ana (Geral)", due: "2026-09-30T00:00:00.000Z" }, posicao: undefined },
    ]);
    assert.deepEqual(r, { tarefaId: "T1", listaId: "L1", criados: 0, avisos: [] });
    assert.equal(patches.length, 0);
  });

  it("sem data não manda due", async () => {
    const { fluxo, tarefas } = montar({}, "L9");
    await fluxo.criarTarefaAvulsa(avulsa());
    assert.equal("due" in tarefas[0].corpo, false);
    assert.equal(tarefas[0].listaId, "L9");
  });

  it("passos viram subtarefas em ordem sob a tarefa", async () => {
    const { fluxo, tarefas } = montar({}, "L9");
    const r = await fluxo.criarTarefaAvulsa(avulsa({ passos: ["Leite", "Pão"] }));
    assert.equal(r.criados, 2);
    assert.deepEqual(tarefas.slice(1).map((t) => [t.corpo.title, t.posicao]), [
      ["Leite", { parent: "T1", previous: undefined }],
      ["Pão", { parent: "T1", previous: "T2" }],
    ]);
  });

  it("falha na tarefa principal LANÇA com o erro classificado (é o resultado inteiro)", async () => {
    const { fluxo } = montar({ inserirTarefa: async () => { throw new ErroTasks(403, ESCOPO_403); } }, "L9");
    await assert.rejects(fluxo.criarTarefaAvulsa(avulsa()), (err) => motivoDoErroTasks(err) === "ampliarAcesso");
  });

  it("subtarefa que falha vira aviso e a tarefa fica", async () => {
    let n = 0;
    const { fluxo } = montar({
      inserirTarefa: async () => {
        n++;
        if (n === 3) throw new ErroTasks(500, "{}");
        return { id: `T${n}` };
      },
    }, "L9");
    const r = await fluxo.criarTarefaAvulsa(avulsa({ passos: ["a", "b", "c"] }));
    assert.equal(r.tarefaId, "T1");
    assert.equal(r.criados, 1);
    assert.match(r.avisos[0].aviso, /2 de 3 passo/);
  });
});

describe("anexarProgressoDosPassos", () => {
  const quest = (x: Partial<QuestCalendario>): QuestCalendario => ({
    eventId: "e", titulo: "t", inicio: "", fim: "", diaInteiro: false, tipo: "time_blocking", dominio: "geral",
    membro: "po", squad: "pessoal", prazoRef: "", tasksLista: "", tasksPai: "", ...x,
  });

  it("uma listagem por LISTA; conta só filhas das mães pedidas, concluídas e escondidas inclusive", async () => {
    const quests = [
      quest({ eventId: "a", tasksLista: "L1", tasksPai: "M1" }),
      quest({ eventId: "b", tasksLista: "L1", tasksPai: "M2" }),
      quest({ eventId: "c" }),
    ];
    const chamadas: string[] = [];
    await anexarProgressoDosPassos(quests, {
      liberado: true,
      obterToken: async () => "tk",
      listar: async (_t, listaId) => {
        chamadas.push(listaId);
        return [
          { id: "M1" },
          { id: "s1", parent: "M1", status: "completed" },
          { id: "s2", parent: "M1", status: "needsAction" },
          { id: "s3", parent: "M1", status: "completed", deleted: true },
          { id: "s4", parent: "M2", status: "completed" },
          { id: "x", parent: "OUTRA", status: "completed" },
          { id: "avulsa" },
        ];
      },
    });
    assert.deepEqual(chamadas, ["L1"]);
    assert.deepEqual(quests.map((q) => q.passos), [{ feitos: 1, total: 2 }, { feitos: 1, total: 1 }, undefined]);
  });

  it("sem escopo não chama o Google; falha na leitura deixa as quests sem selo", async () => {
    const quests = [quest({ tasksLista: "L1", tasksPai: "M1" })];
    let chamou = false;
    await anexarProgressoDosPassos(quests, { liberado: false, obterToken: async () => "tk", listar: async () => { chamou = true; return []; } });
    assert.equal(chamou, false);
    await anexarProgressoDosPassos(quests, {
      liberado: true, obterToken: async () => "tk", listar: async () => { throw new ErroTasks(404, "{}"); },
    });
    assert.equal(quests[0].passos, undefined);
  });
});

describe("renomearListaDaSquad", () => {
  const base = { listaId: "L1", nomeAntigo: "Pessoal", nomeNovo: "Casa", liberado: true, obterToken: async () => "tk" };

  it("título ainda é o gerado: renomeia para o nome novo", async () => {
    const escritas: [string, string][] = [];
    const r = await renomearListaDaSquad({
      ...base,
      ler: async (_t, id) => ({ id, title: "SquadOne · Pessoal" }),
      renomear: async (_t, id, titulo) => { escritas.push([id, titulo]); return {}; },
    });
    assert.equal(r, "renomeada");
    assert.deepEqual(escritas, [["L1", "SquadOne · Casa"]]);
  });

  it("usuário renomeou no celular: o nome dele vence, nenhuma escrita", async () => {
    let escreveu = false;
    const r = await renomearListaDaSquad({
      ...base,
      ler: async (_t, id) => ({ id, title: "Minhas coisas" }),
      renomear: async () => { escreveu = true; return {}; },
    });
    assert.equal(r, "personalizada");
    assert.equal(escreveu, false);
  });

  it("sem lista, sem escopo ou nome igual: nem lê o Google", async () => {
    const ler = async () => { throw new Error("não deveria ler"); };
    assert.equal(await renomearListaDaSquad({ ...base, listaId: undefined, ler }), "semLista");
    assert.equal(await renomearListaDaSquad({ ...base, liberado: false, ler }), "semEscopo");
    assert.equal(await renomearListaDaSquad({ ...base, nomeNovo: "Pessoal", ler }), "igual");
  });

  it("lista apagada no celular: 'sumiu', sem erro", async () => {
    const r = await renomearListaDaSquad({ ...base, ler: async (_t, id) => { throw new ListaSumiu(id); } });
    assert.equal(r, "sumiu");
  });
});
