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

const DIA_MS = 24 * 3600_000;

/**
 * A ocupação da agenda durante UM turno. Lê o calendário principal na primeira
 * pergunta (não no construtor: turno sem agendar_evento não gasta chamada ao
 * Google) e acumula as reservas do próprio turno, para que dois compromissos
 * da mesma demanda não caiam no mesmo horário.
 *
 * A leitura padrão cobre HORIZONTE_DIAS a partir de agora e serve a quase todo
 * pedido. Pedido que começa longe ("depois de 15/01/2027") passa o trecho
 * dele (`horizonteDaBusca`) e ganha uma leitura só daquele trecho — ler de
 * agora até lá seria meses de agenda para usar duas semanas.
 */
export class AgendaDoTurno {
  readonly token: string | null;
  readonly janela: Janela;
  readonly agora: Date;
  private readonly falhaDoToken: unknown;
  /** Por trecho lido (`inicio-fim`); a padrão é a primeira a entrar. */
  private readonly leituras = new Map<string, Promise<Intervalo[]>>();
  private falhaDeLeitura: AgendaIndisponivel | null = null;
  private readonly reservas: Intervalo[] = [];

  constructor(p: { token: string | null; falhaDoToken?: unknown; janela: Janela; agora: Date }) {
    this.token = p.token;
    this.falhaDoToken = p.falhaDoToken ?? null;
    this.janela = p.janela;
    this.agora = p.agora;
  }

  /**
   * Lança o erro CLASSIFICADO de por que não há agenda: `PrecisaConectar`,
   * `ErroDeConfig` ou `AgendaIndisponivel`. Sem ler nada: é o que o
   * agendamento confere antes de validar o resto do pedido.
   */
  exigirAcesso(): void {
    if (this.token) return;
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

  /**
   * Eventos que ocupam `trecho` + reservas do turno. Sem trecho, ou com um
   * trecho dentro dos HORIZONTE_DIAS de agora, usa a leitura padrão; fora dela,
   * lê o trecho (uma vez por turno). Trecho vazio não chama o Google.
   * Uma leitura que falhou deixa a agenda falhada no resto do turno: reler a
   * cada compromisso multiplicaria chamadas contra um Google que acabou de recusar.
   */
  async ocupacao(trecho?: Intervalo): Promise<Intervalo[]> {
    this.exigirAcesso();
    if (this.falhaDeLeitura) throw this.falhaDeLeitura;
    const reservas = () => this.reservas.map((r) => ({ ...r }));
    if (trecho && trecho.fim <= trecho.inicio) return reservas();

    const agora = this.agora.getTime();
    const fimPadrao = agora + HORIZONTE_DIAS * DIA_MS;
    const lido =
      !trecho || (trecho.inicio >= agora && trecho.fim <= fimPadrao)
        ? { inicio: agora, fim: fimPadrao }
        : trecho;
    const chave = `${lido.inicio}-${lido.fim}`;
    let leitura = this.leituras.get(chave);
    if (!leitura) {
      leitura = lerOcupacao(this.token!, new Date(lido.inicio), new Date(lido.fim)).catch((err: any) => {
        this.falhaDeLeitura ??= new AgendaIndisponivel(
          `Não deu para ler a agenda: ${err?.message ?? String(err)}`,
          err instanceof ErroCalendario && err.ehCredencial,
        );
        throw this.falhaDeLeitura;
      });
      this.leituras.set(chave, leitura);
    }
    const lidos = await leitura;
    return [...lidos, ...reservas()];
  }

  /** Desconta um horário recém-gravado para os próximos compromissos do turno. */
  reservar(intervalo: Intervalo): void {
    this.reservas.push({ ...intervalo });
  }
}
