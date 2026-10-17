/**
 * A vigia dos lembretes: a cada VARREDURA_MS relê a agenda numa janela curta e
 * publica o que ficou devido como `Aviso` (no Dell, a fila de avisos que o
 * Hermes entrega no WhatsApp). Nada é agendado para o futuro e nada vai
 * para o disco: o Google é a verdade (editar, apagar ou ajustar lá reflete na
 * varredura seguinte) e um redeploy não deixa timer órfão.
 *
 * Roda separada do turno: falha do transporte ou da leitura nunca chega em
 * agendamento.ts nem em ajuste.ts.
 */
import type { Janela } from "./alocador.ts";
import { PrecisaConectar } from "./auth-store.ts";
import type { Aviso } from "./avisos.ts";
import type { QuestCalendario } from "./calendar.ts";
import {
  alvosDoRoster,
  ANTECEDENCIA_LEMBRETE_MIN,
  disparosDevidos,
  mensagemDoDisparo,
  ORIGEM_DOS_LEMBRETES,
  VARREDURA_MS,
} from "./lembretes.ts";
import { limitesDoDia, montarResumo, resumoDevido } from "./resumo-matinal.ts";
import type { Roster } from "./squad.ts";

const MIN_MS = 60_000;

/** Chaves enviadas somem depois disto: o evento já começou há muito. */
const RETENCAO_MS = 60 * MIN_MS;

export interface DependenciasDaVigia {
  /** Lida a cada varredura: JANELA_TRABALHO ilegível vira erro da varredura, não do boot. */
  lerJanela: () => Janela;
  lerRoster: () => Promise<Roster>;
  obterToken: () => Promise<string>;
  listar: (token: string, calendarId: string, de: Date, ate: Date) => Promise<QuestCalendario[]>;
  /** Publica o aviso (a fila de avisos do Dell). */
  enviar: (a: Aviso) => Promise<void>;
  /**
   * Resumo matinal (17/10/2026). Ausente = desligado. `ultimoEnviado` guarda o dia (AAAA-MM-DD)
   * fora da memória, para um redeploy entre 7h30 e 11h não repetir o "bom dia"; falha de
   * leitura ou gravação cai para a memória do processo, nunca derruba a varredura.
   */
  resumoMatinal?: {
    ler: () => Promise<string | null>;
    gravar: (dia: string) => Promise<void>;
  };
  log?: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

export interface ResultadoDaVarredura {
  /** Na ordem dos eventos. `enviada` false = só montada (enviar=false) ou o transporte falhou (ver erros). */
  mensagens: (Aviso & { eventId: string; enviada: boolean })[];
  erros: string[];
  semCredencial: boolean;
}

export interface Vigia {
  /**
   * Uma varredura com o relógio dado. `registrar` false (rota de teste) consulta
   * a deduplicação mas não grava nada nela nem no aviso de desconexão: um teste
   * não pode engolir o aviso real.
   */
  varrer(agora: Date, opcoes: { enviar: boolean; registrar: boolean }): Promise<ResultadoDaVarredura>;
  /** Liga o laço. Devolve a função que desliga. */
  iniciar(relogio?: () => Date): () => void;
}

/**
 * Sem credencial a vigia fica cega e o usuário não abriria o app para
 * descobrir: o próprio canal avisa, uma vez por perda. A chave leva o instante
 * da perda: duas perdas no mesmo dia são dois avisos, e a fila não confunde.
 * P1, não P0: não acorda ninguém de madrugada, sai às 7h.
 */
export function avisoDeDesconexao(agora: Date): Aviso {
  return {
    titulo: "⚠️ SquadOne sem acesso ao Google",
    texto: "Os lembretes pararam até o Google ser reconectado no SquadOne.",
    origem: ORIGEM_DOS_LEMBRETES,
    chave: `google-desconectado:${agora.toISOString()}`,
    prioridade: 1,
    expiraEm: new Date(agora.getTime() + 24 * 3600_000).toISOString(),
  };
}

const mensagemDe = (err: unknown) => (err as Error)?.message ?? String(err);

export function criarVigia(dep: DependenciasDaVigia): Vigia {
  const log = dep.log ?? console;
  /** chave → referência. Só memória: redeploy na janela de 10 min reenvia uma vez (custo aceito). */
  const enviados = new Map<string, number>();
  let avisouDesconexao = false;
  let emAndamento = false;

  async function varrer(agora: Date, opcoes: { enviar: boolean; registrar: boolean }): Promise<ResultadoDaVarredura> {
    const resultado: ResultadoDaVarredura = { mensagens: [], erros: [], semCredencial: false };
    const janela = dep.lerJanela();
    const alvos = alvosDoRoster(await dep.lerRoster());

    let token: string;
    try {
      token = await dep.obterToken();
    } catch (err) {
      // ErroDeConfig e o resto sobem: é ambiente, e quem chama loga ou responde 500.
      if (!(err instanceof PrecisaConectar)) throw err;
      resultado.semCredencial = true;
      if (opcoes.enviar && opcoes.registrar && !avisouDesconexao) {
        try {
          await dep.enviar(avisoDeDesconexao(agora));
          avisouDesconexao = true;
        } catch (e) {
          resultado.erros.push(`aviso de desconexão não saiu: ${mensagemDe(e)}`);
        }
      }
      return resultado;
    }
    if (opcoes.registrar) avisouDesconexao = false;

    // Margem de 2 varreduras: um tick atrasado (Google lento) não perde evento na borda.
    const ate = new Date(agora.getTime() + ANTECEDENCIA_LEMBRETE_MIN * MIN_MS + 2 * VARREDURA_MS);
    const quests: QuestCalendario[] = [];
    for (const calendarId of alvos.calendarios) {
      // Um calendário quebrado não cala os outros.
      try {
        quests.push(...(await dep.listar(token, calendarId, agora, ate)));
      } catch (err) {
        resultado.erros.push(`calendário '${calendarId}': ${mensagemDe(err)}`);
      }
    }

    // Duas squads podem apontar o mesmo calendarId (ex.: as duas usam
    // "primary"): sem isto o mesmo evento sairia duas vezes na mesma
    // varredura, uma por calendário lido.
    const questsUnicas = [...new Map(quests.map((q) => [q.eventId, q])).values()];

    for (const d of disparosDevidos(questsUnicas, agora.getTime(), janela, alvos.dominios, enviados)) {
      const m = mensagemDoDisparo(d, agora.getTime(), janela.fuso, alvos.dominios.get(d.dominio) ?? d.dominio);
      let enviada = false;
      if (opcoes.enviar) {
        try {
          await dep.enviar(m);
          enviada = true;
          if (opcoes.registrar) enviados.set(d.chave, d.referencia);
        } catch (err) {
          // Fora da deduplicação: a próxima varredura tenta de novo enquanto o evento não começar.
          resultado.erros.push(`aviso de '${d.titulo}' não saiu: ${mensagemDe(err)}`);
        }
      }
      resultado.mensagens.push({ ...m, eventId: d.eventId, enviada });
    }

    if (opcoes.registrar) {
      for (const [chave, referencia] of enviados) {
        if (referencia < agora.getTime() - RETENCAO_MS) enviados.delete(chave);
      }
    }

    // Depois dos lembretes: o resumo nunca atrasa um aviso de bloco. Falha dele vira erro da
    // varredura e é tentada de novo no minuto seguinte (até as 11h).
    if (dep.resumoMatinal) await resumir(agora, janela, alvos.calendarios, alvos.dominios, token, opcoes, resultado);
    return resultado;
  }

  /** Dia (AAAA-MM-DD) do último resumo enviado. null = ainda não lido do disco neste processo. */
  let ultimoResumo: string | null | undefined;

  async function resumir(
    agora: Date,
    janela: Janela,
    calendarios: string[],
    dominios: Map<string, string>,
    token: string,
    opcoes: { enviar: boolean; registrar: boolean },
    resultado: ResultadoDaVarredura,
  ): Promise<void> {
    const lugar = dep.resumoMatinal!;
    try {
      if (ultimoResumo === undefined) {
        ultimoResumo = await lugar.ler().catch((e) => {
          resultado.erros.push(`resumo: dia do último envio não lido: ${mensagemDe(e)}`);
          return null;
        });
      }
      const dia = resumoDevido(agora.getTime(), janela.fuso, ultimoResumo);
      if (dia === null) return;
      const { de, ate } = limitesDoDia(agora.getTime(), janela.fuso);
      const quests: QuestCalendario[] = [];
      let leituraCompleta = true;
      for (const calendarId of calendarios) {
        try {
          quests.push(...(await dep.listar(token, calendarId, de, ate)));
        } catch (err) {
          // Resumo com um calendário faltando mentiria ("dia livre"): tenta de novo no minuto seguinte.
          leituraCompleta = false;
          resultado.erros.push(`resumo, calendário '${calendarId}': ${mensagemDe(err)}`);
        }
      }
      if (!leituraCompleta) return;
      const aviso = montarResumo(quests, agora.getTime(), janela, dominios);
      if (aviso === null) {
        // Dia vazio: nada a mandar e nada a repetir a cada minuto até as 11h.
        if (opcoes.registrar) await marcarResumo(dia, resultado);
        return;
      }
      let enviada = false;
      if (opcoes.enviar) {
        try {
          await dep.enviar(aviso);
          enviada = true;
          if (opcoes.registrar) await marcarResumo(dia, resultado);
        } catch (err) {
          resultado.erros.push(`resumo matinal não saiu: ${mensagemDe(err)}`);
        }
      }
      resultado.mensagens.push({ ...aviso, eventId: "resumo-matinal", enviada });
    } catch (err) {
      resultado.erros.push(`resumo matinal: ${mensagemDe(err)}`);
    }
  }

  async function marcarResumo(dia: string, resultado: ResultadoDaVarredura): Promise<void> {
    ultimoResumo = dia;
    try {
      await dep.resumoMatinal!.gravar(dia);
    } catch (e) {
      resultado.erros.push(`resumo: dia do envio não gravado (vale só até o próximo redeploy): ${mensagemDe(e)}`);
    }
  }

  function iniciar(relogio: () => Date = () => new Date()): () => void {
    let semCredencialAntes = false;
    // Última mensagem de falha da própria varredura (JANELA_TRABALHO ilegível,
    // RosterIlegivel, Google fora do ar); null = a varredura está ok. Só loga
    // quando ela muda — senão uma falha permanente logaria 1440x/dia (F2).
    let falhaAntes: string | null = null;
    const tick = async () => {
      // Google lento: não empilha varreduras nem manda o mesmo aviso duas vezes em paralelo.
      if (emAndamento) return;
      emAndamento = true;
      try {
        const r = await varrer(relogio(), { enviar: true, registrar: true });
        if (falhaAntes !== null) {
          log.error("[vigia] varredura voltou a funcionar");
          falhaAntes = null;
        }
        if (r.semCredencial !== semCredencialAntes) {
          log.error(
            r.semCredencial
              ? "[vigia] sem credencial do Google: lembretes parados até reconectar"
              : "[vigia] credencial de volta: lembretes retomados",
          );
          semCredencialAntes = r.semCredencial;
        }
        for (const m of r.mensagens) if (m.enviada) log.log(`[vigia] ${m.titulo}`);
        for (const e of r.erros) log.error(`[vigia] ${e}`);
      } catch (err) {
        const mensagem = mensagemDe(err);
        if (mensagem !== falhaAntes) {
          log.error(`[vigia] varredura falhou: ${mensagem}`);
          falhaAntes = mensagem;
        }
      } finally {
        emAndamento = false;
      }
    };
    const id = setInterval(tick, VARREDURA_MS);
    void tick();
    return () => clearInterval(id);
  }

  return { varrer, iniciar };
}
