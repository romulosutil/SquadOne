/**
 * Aplicar uma proposta de crescimento ao roster — spec §4.4 — dentro da squad
 * da proposta, e criar squads novas (spec Fase 1 §7.2).
 *
 * `capabilities.ts` PROPÕE (o modelo não escreve no disco); este módulo é o
 * único lugar que EXECUTA a proposta depois do [APROVAR] do usuário. Os dois
 * eixos da árvore (§3.1) têm efeitos diferentes no escritório:
 *
 *   dominio    → sala NOVA: ocupa o primeiro slot livre de `unlockOrder`.
 *   integrante → MESMA sala: entra na lista do domínio que já existe.
 *
 * Nenhuma escrita passa por aqui sem `atualizarRoster`: duas aprovações quase
 * simultâneas leriam o mesmo `squad.json` e a segunda apagaria a primeira.
 */

import {
  acharDominio,
  atualizarRoster,
  ConflitoDeRoster,
  MAX_DOMINIOS,
  novoIdDeDominio,
  novoIdDePessoa,
  novoIdDeSquad,
  paraVista,
  PedidoInvalido,
  proximoSlot,
  resolverSquad,
  salaPara,
  todasAsPessoas,
  UNLOCK_ORDER_PADRAO,
  type Dominio,
  type Pessoa,
  type Roster,
  type RosterView,
  type Squad,
  type SquadView,
} from "./squad.ts";

/** Mora em squad.ts agora; reexportado para quem ainda importa daqui. */
export { ConflitoDeRoster } from "./squad.ts";

export interface HireResult {
  kind: "dominio" | "integrante";
  /** Squad onde a contratação entrou — pode não ser a que a tela mostra agora. */
  squadId: string;
  roster: RosterView;
  dominio: Dominio;
  pessoa: Pessoa;
}

export interface NovaSquadResult {
  roster: RosterView;
  squad: SquadView;
}

/**
 * O modelo propõe papel e escopo, nunca o nome — quem é contratado é decisão
 * do usuário. Sem nome digitado, pega o primeiro livre desta lista.
 */
const NOMES = [
  "Ana", "Bruno", "Carla", "Diego", "Elisa", "Felipe", "Gabi", "Heitor",
  "Iara", "João", "Kátia", "Lucas", "Marina", "Nando", "Olívia", "Pedro",
];

/** Nome livre olhando TODAS as squads: duas "Ana" viram ids ana e ana-2, e confundem. */
function nomeEscolhido(roster: Roster, nome: unknown): string {
  const pedido = String(nome ?? "").trim();
  if (pedido) return pedido.slice(0, 40);
  const todas = todasAsPessoas(roster);
  const usados = new Set(todas.map((p) => p.nome));
  return NOMES.find((n) => !usados.has(n)) ?? `Pessoa ${todas.length + 1}`;
}

function novaPessoa(
  roster: Roster,
  dados: { nome: string; papel: string; escopo: string },
  agora: string,
): Pessoa {
  return {
    id: novoIdDePessoa(roster, dados.nome),
    nome: dados.nome,
    papel: dados.papel,
    escopo: dados.escopo,
    // Vazio de propósito: quem distribui sprite e hue entre os papéis é o
    // GameMap (§5.3), com um pool só. Fixar aqui duplicaria esse pool.
    sprite: "",
    hiredAt: agora,
  };
}

function texto(valor: unknown, campo: string, max = 120): string {
  const v = String(valor ?? "").trim();
  if (!v) throw new PedidoInvalido(`Campo '${campo}' é obrigatório.`);
  return v.slice(0, max);
}

/**
 * Executa a proposta aprovada, NA SQUAD DA PROPOSTA (`sugestao.squad_id`), não
 * na que a tela mostra: o usuário pode ter trocado de squad entre o turno e o
 * clique. `sugestao` volta pelo body e é entrada não confiável — tudo é
 * revalidado contra o roster atual, não contra o que a proposta afirma.
 */
export async function aplicarContratacao(
  sugestao: any,
  nome?: unknown,
): Promise<HireResult> {
  const kind = sugestao?.kind;
  if (kind !== "dominio" && kind !== "integrante") {
    throw new PedidoInvalido("Campo 'sugestao.kind' deve ser 'dominio' ou 'integrante'.");
  }

  return atualizarRoster((roster) => {
    const squad = resolverSquad(roster, sugestao.squad_id);
    const agora = new Date().toISOString();

    if (kind === "dominio") {
      const nomeDominio = texto(sugestao.dominio, "sugestao.dominio", 60);
      const escopo = texto(sugestao.escopo, "sugestao.escopo", 200);
      const papelPo = texto(sugestao.papel_po, "sugestao.papel_po", 60);
      // O slot sai do roster AGORA, não do que a proposta carregava: outro
      // domínio pode ter ocupado aquele slot depois do turno.
      const slot = proximoSlot(squad);
      if (!slot) {
        throw new ConflitoDeRoster(
          `A squad '${squad.nome}' já tem ${MAX_DOMINIOS} domínios — não há sala livre.`,
        );
      }
      const dominio: Dominio = {
        id: novoIdDeDominio(roster, squad, nomeDominio),
        nome: nomeDominio,
        escopo,
        slot,
        room: salaPara(1),
        criadoEm: agora,
        po: novaPessoa(roster, { nome: nomeEscolhido(roster, nome), papel: papelPo, escopo }, agora),
        integrantes: [],
      };
      squad.dominios.push(dominio);
      return { kind, squadId: squad.id, roster: paraVista(roster), dominio, pessoa: dominio.po } satisfies HireResult;
    }

    const papel = texto(sugestao.papel, "sugestao.papel", 60);
    const escopo = texto(sugestao.escopo, "sugestao.escopo", 200);
    const dominio = acharDominio(squad, sugestao.dominio_id);
    if (!dominio) {
      const ids = squad.dominios.map((d) => d.id).join(", ");
      throw new ConflitoDeRoster(
        `dominio_id '${String(sugestao.dominio_id)}' não existe na squad '${squad.nome}'. Domínios: ${ids}.`,
      );
    }
    const pessoa = novaPessoa(roster, { nome: nomeEscolhido(roster, nome), papel, escopo }, agora);
    dominio.integrantes.push(pessoa);
    // Sala com duas pessoas precisa de duas cadeiras, senão o segundo ator cai
    // num posto improvisado do miolo (EXTRA_STATIONS).
    dominio.room = salaPara(1 + dominio.integrantes.length, dominio.room);
    return { kind, squadId: squad.id, roster: paraVista(roster), dominio, pessoa } satisfies HireResult;
  });
}

/**
 * Gesto "Nova squad". A squad nasce com UM domínio e o PO dele: o escritório
 * não tem como desenhar uma squad vazia (o PO raiz é `dominios[0].po`).
 */
export async function criarSquad(dados: any): Promise<NovaSquadResult> {
  const nome = texto(dados?.nome, "nome", 40);
  const escopo = texto(dados?.escopo, "escopo", 200);
  const papelPo = texto(dados?.papel_po, "papel_po", 60);

  return atualizarRoster((roster) => {
    const agora = new Date().toISOString();
    const squad: Squad = {
      id: novoIdDeSquad(roster, nome),
      nome,
      escopo,
      calendarId: "primary",
      unlockOrder: UNLOCK_ORDER_PADRAO.map(([x, y]) => [x, y] as [number, number]),
      dominios: [],
    };
    const dominio: Dominio = {
      id: novoIdDeDominio(roster, squad, "Geral"),
      nome: "Geral",
      escopo,
      slot: squad.unlockOrder[0],
      room: salaPara(1),
      criadoEm: agora,
      po: novaPessoa(roster, { nome: nomeEscolhido(roster, dados?.nome_po), papel: papelPo, escopo }, agora),
      integrantes: [],
    };
    squad.dominios.push(dominio);
    roster.squads.push(squad);
    const vista = paraVista(roster);
    return { roster: vista, squad: vista.squads[vista.squads.length - 1] };
  });
}
