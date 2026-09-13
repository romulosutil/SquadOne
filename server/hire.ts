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
  aposentarIds,
  atualizarRoster,
  ativo,
  ConflitoDeRoster,
  dominiosAtivos,
  integrantesAtivos,
  LIMITES,
  limitar,
  localizarDominio,
  MAX_DOMINIOS,
  normalizarEscopo,
  novoIdDeDominio,
  novoIdDePessoa,
  novoIdDeSquad,
  paraVista,
  PedidoInvalido,
  proximoSlot,
  resolverSquad,
  salaPara,
  textoDeUmaLinha,
  todasAsPessoas,
  UNLOCK_ORDER_PADRAO,
  type Dominio,
  type Pessoa,
  type Roster,
  type RosterView,
  type Squad,
  type SquadView,
} from "./squad.ts";
// ciclo-de-vida.ts não importa hire.ts: sem ciclo de módulos.
import { textoRevisado } from "./ciclo-de-vida.ts";

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

/** Linha que veio de card do modelo ou do formulário: uma linha, cortada no limite. */
function linha(valor: unknown, campo: string, max: number): string {
  const v = textoDeUmaLinha(String(valor ?? ""));
  if (!v) throw new PedidoInvalido(`Campo '${campo}' é obrigatório.`);
  return v.slice(0, max);
}

/**
 * Treino (escopo de pessoa) de card ou formulário: normalizado e cortado em
 * 1500. Corta em vez de recusar porque o texto dos cards vem do modelo e pode
 * passar; o formulário já respeita o limite antes de enviar.
 */
function treino(valor: unknown, campo: string): string {
  const v = normalizarEscopo(String(valor ?? ""));
  if (!v) throw new PedidoInvalido(`Campo '${campo}' é obrigatório.`);
  return limitar(v, LIMITES.escopoPessoa).texto;
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
      const nomeDominio = linha(sugestao.dominio, "sugestao.dominio", LIMITES.dominioNome);
      // Escopo do DOMÍNIO é uma linha de roteamento (vai inline na árvore).
      const escopo = linha(sugestao.escopo, "sugestao.escopo", LIMITES.dominioEscopo);
      const papelPo = linha(sugestao.papel_po, "sugestao.papel_po", LIMITES.papel);
      // escopo_po é o treino do PO. Ausente = o escopo do domínio, que é o que
      // os cards do modelo mandam: eles continuam funcionando sem mudança.
      const semEscopoPo =
        sugestao.escopo_po === undefined || sugestao.escopo_po === null || sugestao.escopo_po === "";
      const escopoPo = semEscopoPo ? escopo : treino(sugestao.escopo_po, "sugestao.escopo_po");
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
        po: novaPessoa(roster, { nome: nomeEscolhido(roster, nome), papel: papelPo, escopo: escopoPo }, agora),
        integrantes: [],
      };
      squad.dominios.push(dominio);
      return { kind, squadId: squad.id, roster: paraVista(roster), dominio, pessoa: dominio.po } satisfies HireResult;
    }

    const papel = linha(sugestao.papel, "sugestao.papel", LIMITES.papel);
    const escopo = treino(sugestao.escopo, "sugestao.escopo");
    const dominio = acharDominio(squad, sugestao.dominio_id);
    if (!dominio) {
      // acharDominio só vê ativos. Distinguir o arquivado diz ao usuário o gesto
      // certo (reativar) em vez de "não existe", que parece bug.
      const arquivado = squad.dominios.find((d) => d.id === sugestao.dominio_id);
      if (arquivado) {
        throw new ConflitoDeRoster(
          `O domínio '${arquivado.nome}' está arquivado: reative-o no Arquivo antes de contratar.`,
        );
      }
      const ids = dominiosAtivos(squad).map((d) => d.id).join(", ");
      throw new ConflitoDeRoster(
        `dominio_id '${String(sugestao.dominio_id)}' não existe na squad '${squad.nome}'. Domínios: ${ids}.`,
      );
    }
    const pessoa = novaPessoa(roster, { nome: nomeEscolhido(roster, nome), papel, escopo }, agora);
    dominio.integrantes.push(pessoa);
    // Sala com duas pessoas precisa de duas cadeiras, senão o segundo ator cai
    // num posto improvisado do miolo (EXTRA_STATIONS). Arquivado não ocupa cadeira.
    dominio.room = salaPara(1 + integrantesAtivos(dominio).length, dominio.room);
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

export interface SubstituicaoResult {
  roster: RosterView;
  po: Pessoa;
  anterior: Pessoa;
}

/**
 * PO não é demitido, é substituído (spec Fase 2 §4.8): o domínio nunca fica sem
 * dono. O anterior vira integrante ARQUIVADO do mesmo domínio — continua na
 * árvore, com o id reservado, os eventos dele seguem com o mesmo
 * `squadone_membro`, e ele pode voltar como integrante pelo Arquivo.
 */
export async function substituirPo(dominioId: string, corpo: unknown): Promise<SubstituicaoResult> {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    throw new PedidoInvalido("O corpo deve ser um objeto JSON.");
  }
  const b = corpo as Record<string, unknown>;
  const promover = "integranteId" in b;
  const pessoaNova = ["nome", "papel", "escopo"].some((k) => k in b);
  if (promover === pessoaNova) {
    throw new PedidoInvalido(
      "Mande 'integranteId' (promover integrante) OU 'papel' e 'escopo' (pessoa nova): exatamente uma das formas.",
    );
  }

  let integranteId = "";
  let nova: { nome: unknown; papel: string; escopo: string } | null = null;
  if (promover) {
    if (typeof b.integranteId !== "string" || !b.integranteId) {
      throw new PedidoInvalido("Campo 'integranteId' deve ser texto.");
    }
    integranteId = b.integranteId;
  } else {
    if (typeof b.papel !== "string" || typeof b.escopo !== "string") {
      throw new PedidoInvalido("Campos 'papel' e 'escopo' são obrigatórios e devem ser texto.");
    }
    if (b.nome !== undefined && typeof b.nome !== "string") {
      throw new PedidoInvalido("Campo 'nome' deve ser texto.");
    }
    nova = {
      nome: b.nome,
      papel: textoRevisado(b.papel, "papel", LIMITES.papel),
      escopo: textoRevisado(b.escopo, "escopo", LIMITES.escopoPessoa, true),
    };
  }

  return atualizarRoster((roster) => {
    const achado = localizarDominio(roster, dominioId);
    if (!achado) throw new ConflitoDeRoster(`O domínio '${dominioId}' não existe.`);
    const { squad, dominio } = achado;
    if (!ativo(squad) || !ativo(dominio)) {
      throw new ConflitoDeRoster(
        `O domínio '${dominio.nome}' ou a squad '${squad.nome}' está arquivado: reative antes de substituir o PO.`,
      );
    }
    const agora = new Date().toISOString();
    const anterior = dominio.po;

    let po: Pessoa;
    if (nova) {
      // Id calculado com o anterior ainda na árvore: não há como colidir com ele.
      po = novaPessoa(roster, { nome: nomeEscolhido(roster, nova.nome), papel: nova.papel, escopo: nova.escopo }, agora);
    } else {
      const indice = dominio.integrantes.findIndex((p) => p.id === integranteId && ativo(p));
      if (indice < 0) {
        throw new ConflitoDeRoster(`'${integranteId}' não é integrante ativo do domínio '${dominio.nome}'.`);
      }
      [po] = dominio.integrantes.splice(indice, 1);
    }

    anterior.arquivado = true;
    anterior.arquivadoEm = agora;
    dominio.integrantes.push(anterior);
    dominio.po = po;
    aposentarIds(roster, { pessoas: [anterior.id] });
    dominio.room = salaPara(1 + integrantesAtivos(dominio).length, dominio.room);
    return { roster: paraVista(roster), po, anterior };
  });
}
