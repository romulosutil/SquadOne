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
 * O `scope` que o Google devolve é uma string separada por espaço. Comparação
 * por item inteiro: `tasks.readonly` contém "tasks" como substring e não serve
 * para escrever.
 */
export function escopoConcedido(scope: string | null | undefined, escopo: string): boolean {
  return (scope ?? "").split(/\s+/).filter(Boolean).includes(escopo);
}
