/**
 * A vigia dos lembretes: a cada VARREDURA_MS relê a agenda numa janela curta e
 * publica no ntfy o que ficou devido. Nada é agendado para o futuro e nada vai
 * para o disco: o Google é a verdade (editar, apagar ou ajustar lá reflete na
 * varredura seguinte) e um redeploy não deixa timer órfão.
 *
 * Roda separada do turno: falha do ntfy ou da leitura nunca chega em
 * agendamento.ts nem em ajuste.ts.
 */
import type { Janela } from "./alocador.ts";
import { PrecisaConectar } from "./auth-store.ts";
import type { QuestCalendario } from "./calendar.ts";
import {
  alvosDoRoster,
  ANTECEDENCIA_PUSH_MIN,
  disparosDevidos,
  mensagemDoDisparo,
  VARREDURA_MS,
} from "./lembretes.ts";
import type { MensagemDePush } from "./push.ts";
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
  enviar: (m: MensagemDePush) => Promise<void>;
  log?: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

export interface ResultadoDaVarredura {
  /** Na ordem dos eventos. `enviada` false = só montada (enviar=false) ou o ntfy falhou (ver erros). */
  mensagens: (MensagemDePush & { eventId: string; enviada: boolean })[];
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
 * descobrir: o próprio push avisa, uma vez por perda.
 */
export const AVISO_DESCONECTADO: MensagemDePush = {
  titulo: "SquadOne sem acesso ao Google",
  corpo: "Os lembretes pararam. Abra o SquadOne e reconecte o calendário.",
  prioridade: 4,
  tags: ["warning"],
};

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
          await dep.enviar(AVISO_DESCONECTADO);
          avisouDesconexao = true;
        } catch (e) {
          resultado.erros.push(`aviso de desconexão não saiu: ${mensagemDe(e)}`);
        }
      }
      return resultado;
    }
    if (opcoes.registrar) avisouDesconexao = false;

    // Margem de 2 varreduras: um tick atrasado (Google lento) não perde evento na borda.
    const ate = new Date(agora.getTime() + ANTECEDENCIA_PUSH_MIN * MIN_MS + 2 * VARREDURA_MS);
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
          resultado.erros.push(`push de '${d.titulo}' não saiu: ${mensagemDe(err)}`);
        }
      }
      resultado.mensagens.push({ ...m, eventId: d.eventId, enviada });
    }

    if (opcoes.registrar) {
      for (const [chave, referencia] of enviados) {
        if (referencia < agora.getTime() - RETENCAO_MS) enviados.delete(chave);
      }
    }
    return resultado;
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
          log.error("[push] varredura voltou a funcionar");
          falhaAntes = null;
        }
        if (r.semCredencial !== semCredencialAntes) {
          log.error(
            r.semCredencial
              ? "[push] sem credencial do Google: lembretes parados até reconectar"
              : "[push] credencial de volta: lembretes retomados",
          );
          semCredencialAntes = r.semCredencial;
        }
        for (const m of r.mensagens) if (m.enviada) log.log(`[push] ${m.titulo}`);
        for (const e of r.erros) log.error(`[push] ${e}`);
      } catch (err) {
        const mensagem = mensagemDe(err);
        if (mensagem !== falhaAntes) {
          log.error(`[push] varredura falhou: ${mensagem}`);
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
