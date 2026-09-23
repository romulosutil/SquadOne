import { dataLocal } from "./alocador.ts";

/**
 * Regras PURAS dos passos de um compromisso no Google Tasks. Sem fetch,
 * relógio, env ou import de I/O — só `alocador.ts`, que também é puro. É o que
 * dá para fixar em tabela de casos; o fluxo com rede mora em
 * `passos-no-google.ts`.
 */

/**
 * Teto de subtarefas por compromisso. O prompt pede 2–8; o servidor garante
 * 10 porque prompt é pedido, não garantia, e uma resposta fora do esperado não
 * pode virar uma checklist de 40 itens no celular do usuário.
 */
export const MAX_PASSOS = 10;

/** Um passo é lido de relance na lista do Tasks; o limite da API (1024) é bem maior. */
export const MAX_TITULO_PASSO = 200;

/** Última linha das notas da tarefa-mãe. Informativa: o usuário edita as notas à vontade. */
export const PREFIXO_VINCULO = "squadone_evento=";

/**
 * O que o modelo mandou em `passos`, do jeito que pode ir para o Google.
 * Deduplica sem diferenciar maiúsculas porque "Ensaiar" e "ensaiar" na mesma
 * checklist são o mesmo passo repetido, não dois. `cortados` volta para o
 * handler avisar: cortar calado faria o usuário procurar um passo que não existe.
 * Um item só CRIA: se o usuário pediu, a checklist de um item é dele.
 */
export function normalizarPassos(valor: unknown): { passos: string[]; cortados: number } {
  if (!Array.isArray(valor)) return { passos: [], cortados: 0 };
  const vistos = new Set<string>();
  const unicos: string[] = [];
  for (const item of valor) {
    // A declaração é ARRAY de STRING: número ou objeto aqui é resposta torta, e
    // String({}) viraria "[object Object]" na lista do usuário.
    if (typeof item !== "string") continue;
    const texto = item.replace(/\s+/g, " ").trim();
    if (!texto) continue;
    const chave = texto.toLocaleLowerCase("pt-BR");
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    unicos.push(texto.length <= MAX_TITULO_PASSO ? texto : texto.slice(0, MAX_TITULO_PASSO - 1) + "…");
  }
  return { passos: unicos.slice(0, MAX_PASSOS), cortados: Math.max(0, unicos.length - MAX_PASSOS) };
}

/** A squad é a fronteira de contexto do app: no celular vira uma lista por squad. */
export function tituloDaLista(squadNome: string): string {
  return `SquadOne · ${squadNome}`;
}

/**
 * O Tasks não tem extendedProperties e `links` é somente leitura: o único lugar
 * da tarefa que aceita o vínculo é o texto das notas. O link vem primeiro
 * porque é o que o usuário toca no celular.
 */
export function notasDaTarefaMae(htmlLink: string | undefined, eventId: string): string {
  const vinculo = `${PREFIXO_VINCULO}${eventId}`;
  return htmlLink ? `${htmlLink}\n${vinculo}` : vinculo;
}

/** O que `dueDaTarefa` precisa do `EventoCriado` principal. */
export interface EventoPrincipal {
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  papel: "foco" | "marco" | "bloco";
}

const dois = (n: number) => String(n).padStart(2, "0");

/**
 * `due` da tarefa-mãe: a DATA LOCAL do evento principal, meia-noite em UTC. O
 * Tasks descarta a hora e guarda só a parte de data do timestamp — então a
 * data tem que ser a de São Paulo escrita à mão. Converter o instante para UTC
 * trocaria o dia de todo evento depois das 21h.
 * - foco: o dia em que o bloco começa;
 * - marco com hora: o dia do PRAZO, que é o `fim` (o marco vai de prazo − 15 min
 *   até o prazo, e um prazo às 00:05 começaria no dia anterior);
 * - dia inteiro: a própria data de `inicio` (o `fim` do Google é exclusivo).
 */
export function dueDaTarefa(evento: EventoPrincipal, fuso: string): string {
  if (evento.dia_inteiro) return `${evento.inicio.slice(0, 10)}T00:00:00.000Z`;
  const referencia = Date.parse(evento.papel === "marco" ? evento.fim : evento.inicio);
  const d = dataLocal(referencia, fuso);
  return `${d.ano}-${dois(d.mes)}-${dois(d.dia)}T00:00:00.000Z`;
}

/**
 * Título de uma tarefa avulsa. Mais folga que o passo (é o item inteiro, não
 * uma linha de checklist), bem abaixo do limite da API (1024).
 */
export const MAX_TITULO_TAREFA = 300;

/** Notas da tarefa avulsa: lidas no celular, não um documento. A API aceita 8192. */
export const MAX_NOTAS_TAREFA = 2000;

function cortar(texto: string, max: number): string {
  return texto.length <= max ? texto : texto.slice(0, max - 1) + "…";
}

/** Título da tarefa avulsa, ou "" quando não há o que gravar. */
export function normalizarTituloDaTarefa(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return cortar(valor.replace(/\s+/g, " ").trim(), MAX_TITULO_TAREFA);
}

/**
 * `due` de uma tarefa avulsa a partir da `data` que o modelo mandou. O Tasks
 * guarda só a data, então vale a parte AAAA-MM-DD escrita pelo modelo, que já
 * é a data LOCAL (o prompt pede o offset de São Paulo quando há hora) — pelo
 * mesmo motivo de `dueDaTarefa`, converter para UTC trocaria o dia à noite.
 * Ausente/vazia = `null` sem aviso (tarefa sem data é válida); presente e
 * ilegível = `invalida`, para o handler avisar em vez de gravar um dia errado.
 */
export function dueDaData(valor: unknown): { due: string | null; invalida: boolean } {
  if (valor === undefined || valor === null || (typeof valor === "string" && !valor.trim())) {
    return { due: null, invalida: false };
  }
  if (typeof valor !== "string") return { due: null, invalida: true };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(valor.trim());
  if (!m) return { due: null, invalida: true };
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Date.UTC normaliza 31/02 para 03/03: conferir de volta é o que recusa o dia inexistente.
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return { due: null, invalida: true };
  }
  return { due: `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`, invalida: false };
}

/**
 * Notas da tarefa avulsa: o texto do modelo e, por último, quem responde por
 * ela. A assinatura fica no fim pelo mesmo motivo da descrição do evento: o
 * que o usuário lê primeiro no celular é o conteúdo, não a origem.
 */
export function notasDaTarefaAvulsa(nota: unknown, responsavel: string): string {
  const texto = typeof nota === "string" ? nota.replace(/\r\n?/g, "\n").trim() : "";
  const assinatura = `SquadOne · ${responsavel}`;
  if (!texto) return assinatura;
  return `${cortar(texto, MAX_NOTAS_TAREFA - assinatura.length - 2)}\n\n${assinatura}`;
}

/**
 * O `scope` que o Google devolve é uma string separada por espaço. Comparação
 * por item inteiro: `tasks.readonly` contém "tasks" como substring e não serve
 * para escrever.
 */
export function escopoConcedido(scope: string | null | undefined, escopo: string): boolean {
  return (scope ?? "").split(/\s+/).filter(Boolean).includes(escopo);
}
