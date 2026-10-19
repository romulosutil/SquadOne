import { FUSO } from "./alocador.ts";

/**
 * O relógio de São Paulo num lugar só (auditoria de 19/10/2026, MSG-14): o dia (`AAAA-MM-DD`) e a hora
 * local eram refeitos em cada módulo, a maioria subtraindo 3 h do UTC. O Brasil não tem horário de
 * verão desde 2019, então a conta dava certo, mas deixava a regra espalhada: se ele voltar, cada cópia
 * erra por conta própria. Aqui vai pelo `Intl` com o fuso do projeto (`FUSO`, o mesmo da janela de
 * trabalho): quem muda o fuso muda este arquivo.
 *
 * PURO: recebe o instante, não lê o relógio.
 */

type Instante = number | Date;

const paraData = (t: Instante) => (t instanceof Date ? t : new Date(t));

/** `AAAA-MM-DD` em São Paulo: o dia dos tetos, da venda do dia e do resumo zera à meia-noite local, não em UTC. */
export function diaDeSP(t: Instante): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(paraData(t));
}

/** Hora cheia local (0 a 23). */
export function horaDeSP(t: Instante): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", hourCycle: "h23" }).format(paraData(t)));
}

/**
 * Dentro do silêncio da noite: das 22h (inclusive) às 7h (exclusive) de São Paulo por padrão. É o
 * mesmo recorte que a fila do WhatsApp aplicava e que o Telegram passou a honrar mandando sem som.
 * A janela atravessa a meia-noite (`desdeHora` > `ateHora`); uma janela dentro do mesmo dia não é suportada.
 */
export function ehMadrugada(t: Instante, desdeHora = 22, ateHora = 7): boolean {
  const h = horaDeSP(t);
  return h >= desdeHora || h < ateHora;
}
