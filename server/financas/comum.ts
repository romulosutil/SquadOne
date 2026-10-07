/**
 * Utilitários PUROS de finanças: datas como texto AAAA-MM-DD (sem fuso: um
 * lançamento é de um DIA, e converter para instante trocaria o dia depois das
 * 21h em São Paulo, o mesmo problema do `due` do Tasks), meses AAAA-MM e
 * descrição normalizada para comparar lançamentos.
 */

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-07T03:00:00.000Z" ou "2026-10-07" → "2026-10-07". Ilegível = null. */
export function dataDoTexto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const dia = valor.slice(0, 10);
  return DATA.test(dia) ? dia : null;
}

/** Dias inteiros entre duas datas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function somarDias(data: string, dias: number): string {
  const d = new Date(Date.parse(`${data}T00:00:00Z`) + dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function mesDe(data: string): string {
  return data.slice(0, 7);
}

/** "2026-11" + 3 → "2027-02". */
export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function mesesEntre(a: string, b: string): number {
  const [aa, am] = a.split("-").map(Number);
  const [ba, bm] = b.split("-").map(Number);
  return ba * 12 + bm - (aa * 12 + am);
}

export function ehMes(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(valor);
}

/** Reais (número da fonte) → centavos inteiros, sem o erro de 0,1 + 0,2. */
export function centavosDe(reais: unknown): number {
  const n = typeof reais === "number" ? reais : Number(reais);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Descrição comparável: maiúsculas, sem acento, sem a marca de parcela
 * ("PARC 03/10", "3/10", "PARCELA 3 DE 10"), sem dígitos soltos de
 * autorização e com espaços colapsados. É o que liga as parcelas de uma mesma
 * compra e o PENDENTE ao LANÇADO.
 */
export function descricaoNormalizada(descricao: string): string {
  return descricao
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\bPARC(?:ELA)?\.?\s*\d{1,2}\s*(?:\/|DE)\s*\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, " ")
    .replace(/\bPARC(ELA|ELADO)?\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hash curto e estável (FNV-1a, 32 bits) para chaves derivadas; não é segurança. */
export function hashCurto(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
