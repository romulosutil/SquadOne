import { ErroDeConfig, PrecisaConectar } from "./auth-store.ts";
import { ErroCalendario, lerOcupacao } from "./calendar.ts";
import { HORIZONTE_DIAS, type Intervalo, type Janela } from "./alocador.ts";

/**
 * A agenda não pôde ser lida. `credencial` diz se reconectar resolve — mesma
 * distinção do `ErroDeDominio` da Mochila.
 */
export class AgendaIndisponivel extends Error {
  readonly credencial: boolean;
  constructor(mensagem: string, credencial: boolean) {
    super(mensagem);
    this.name = "AgendaIndisponivel";
    this.credencial = credencial;
  }
}

/**
 * A ocupação da agenda durante UM turno. Lê o calendário principal uma vez
 * (na primeira pergunta, não no construtor: turno sem agendar_evento não gasta
 * chamada ao Google) e acumula as reservas do próprio turno, para que dois
 * compromissos da mesma demanda não caiam no mesmo horário.
 */
export class AgendaDoTurno {
  readonly token: string | null;
  readonly janela: Janela;
  readonly agora: Date;
  private readonly falhaDoToken: unknown;
  private leitura: Promise<Intervalo[]> | null = null;
  private readonly reservas: Intervalo[] = [];

  constructor(p: { token: string | null; falhaDoToken?: unknown; janela: Janela; agora: Date }) {
    this.token = p.token;
    this.falhaDoToken = p.falhaDoToken ?? null;
    this.janela = p.janela;
    this.agora = p.agora;
  }

  /**
   * Eventos que ocupam + reservas do turno. Lança o erro CLASSIFICADO de por
   * que não há agenda: `PrecisaConectar`, `ErroDeConfig` ou `AgendaIndisponivel`.
   * Uma leitura que falhou continua falhada no resto do turno: reler a cada
   * compromisso multiplicaria chamadas contra um Google que acabou de recusar.
   */
  async ocupacao(): Promise<Intervalo[]> {
    if (!this.token) {
      const falha = this.falhaDoToken;
      if (falha instanceof PrecisaConectar || falha instanceof ErroDeConfig) throw falha;
      if (falha) {
        throw new AgendaIndisponivel(
          `Não deu para obter a credencial do Google: ${(falha as Error)?.message ?? String(falha)}`,
          false,
        );
      }
      throw new PrecisaConectar(
        "Conecte o Google Calendar para agendar: sem ler a agenda não há horário livre para escolher.",
      );
    }
    this.leitura ??= lerOcupacao(
      this.token,
      this.agora,
      new Date(this.agora.getTime() + HORIZONTE_DIAS * 24 * 3600_000),
    ).catch((err: any) => {
      throw new AgendaIndisponivel(
        `Não deu para ler a agenda: ${err?.message ?? String(err)}`,
        err instanceof ErroCalendario && err.ehCredencial,
      );
    });
    const lidos = await this.leitura;
    return [...lidos, ...this.reservas.map((r) => ({ ...r }))];
  }

  /** Desconta um horário recém-gravado para os próximos compromissos do turno. */
  reservar(intervalo: Intervalo): void {
    this.reservas.push({ ...intervalo });
  }
}
