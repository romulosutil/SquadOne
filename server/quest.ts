import { FORMATO_ID_DE_EVENTO } from "./calendar.ts";
import { acharDominio, PedidoInvalido, type Dominio, type Squad } from "./squad.ts";

/**
 * O que contribuir e ajustar compartilham: por que uma quest não aceita o
 * pedido. A flag vai no corpo do 409 e diz à UI o gesto certo.
 */
export type FlagDeRecusa =
  | "pessoaForaDaSquad"
  | "eventoSemMarca"
  | "eventoDeOutraSquad"
  | "dominioInativo"
  | "descricaoCheia"
  | "conflitoDeEdicao"
  | "alvoIncompativel"
  | "naoCabe";

export class QuestRecusada extends Error {
  readonly flag: FlagDeRecusa;
  constructor(flag: FlagDeRecusa, mensagem: string) {
    super(mensagem);
    this.name = "QuestRecusada";
    this.flag = flag;
  }
}

/** Eventos anteriores à Fase 1 não têm `squadone_squad`; todos eram da squad pessoal. */
export const SQUAD_DE_EVENTO_SEM_MARCA = "pessoal";

/**
 * Id de evento vindo do caminho da rota. Validado ANTES de montar qualquer URL:
 * `..` virava `calendars/primary/`. Fora do formato do Google = 400.
 */
export function lerIdDoEvento(valor: unknown): string {
  if (typeof valor !== "string" || !FORMATO_ID_DE_EVENTO.test(valor)) {
    throw new PedidoInvalido("Id de evento inválido: esperado o id do Google Calendar (letras, dígitos e _, de 5 a 1024).");
  }
  return valor;
}

/**
 * O evento pertence à squad do pedido e a um domínio ativo dela. Sem isso um
 * agente de uma squad escreveria em compromisso de outra, ou num evento que o
 * app nem criou.
 */
export function validarQuestDaSquad(evento: { dominio: string; squad: string }, squad: Squad): Dominio {
  if (!evento.dominio) {
    throw new QuestRecusada(
      "eventoSemMarca",
      "Este evento não foi criado pelo SquadOne (não tem squadone_dominio): agentes só escrevem em quests do app.",
    );
  }
  const daSquad = evento.squad || SQUAD_DE_EVENTO_SEM_MARCA;
  if (daSquad !== squad.id) {
    throw new QuestRecusada("eventoDeOutraSquad", `O evento é da squad '${daSquad}', não de '${squad.id}'.`);
  }
  const dominio = acharDominio(squad, evento.dominio);
  if (!dominio) {
    throw new QuestRecusada(
      "dominioInativo",
      `O domínio '${evento.dominio}' do evento não está ativo na squad '${squad.nome}'.`,
    );
  }
  return dominio;
}
