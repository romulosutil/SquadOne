/**
 * Aplicar uma proposta de crescimento ao roster — spec §4.4.
 *
 * `capabilities.ts` PROPÕE (o modelo não escreve no disco); este módulo é o
 * único lugar que EXECUTA a proposta depois do [APROVAR] do usuário. Os dois
 * eixos da árvore (§3.1) têm efeitos diferentes no escritório:
 *
 *   dominio    → sala NOVA: consome o próximo slot de `unlockOrder`.
 *   integrante → MESMA sala: entra na lista do domínio que já existe.
 *
 * Nenhuma escrita passa por aqui sem `atualizarSquad`: duas aprovações quase
 * simultâneas leriam o mesmo `squad.json` e a segunda apagaria a primeira.
 */

import {
  acharDominio,
  atualizarSquad,
  MAX_DOMINIOS,
  pessoas,
  proximoSlot,
  salaPara,
  slug,
  unlockedSlots,
  type Dominio,
  type Pessoa,
  type Squad,
} from "./squad.ts";

/** Estado do roster incompatível com a proposta (409, não 400). */
export class ConflitoDeRoster extends Error {}

export interface HireResult {
  kind: "dominio" | "integrante";
  squad: Squad & { unlockedSlots: [number, number][] };
  dominio: Dominio;
  pessoa: Pessoa;
}

/**
 * O modelo propõe papel e escopo, nunca o nome — quem é contratado é decisão
 * do usuário. Sem nome digitado, pega o primeiro livre desta lista.
 */
const NOMES = [
  "Ana", "Bruno", "Carla", "Diego", "Elisa", "Felipe", "Gabi", "Heitor",
  "Iara", "João", "Kátia", "Lucas", "Marina", "Nando", "Olívia", "Pedro",
];

function nomeEscolhido(squad: Squad, nome: unknown): string {
  const pedido = String(nome ?? "").trim();
  if (pedido) return pedido.slice(0, 40);
  const usados = new Set(pessoas(squad).map((p) => p.pessoa.nome));
  return NOMES.find((n) => !usados.has(n)) ?? `Pessoa ${pessoas(squad).length + 1}`;
}

/**
 * id de pessoa é o que o modelo escreve em `responsavel_id` e o que vai para
 * `squadone_membro` no Calendar: precisa ser único e legível. Colisão ganha
 * sufixo numérico em vez de sobrescrever alguém.
 */
function novoIdDePessoa(squad: Squad, nome: string): string {
  const usados = new Set(pessoas(squad).map((p) => p.pessoa.id));
  const base = slug(nome);
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) {
    const tentativa = `${base}-${i}`;
    if (!usados.has(tentativa)) return tentativa;
  }
}

function novaPessoa(
  squad: Squad,
  dados: { nome: string; papel: string; escopo: string },
  agora: string,
): Pessoa {
  return {
    id: novoIdDePessoa(squad, dados.nome),
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
  if (!v) throw new Error(`Campo '${campo}' é obrigatório.`);
  return v.slice(0, max);
}

/**
 * Executa a proposta aprovada. `sugestao` vem do turno (`/api/orquestrar`) e
 * chega de volta pelo body — é entrada não confiável, então tudo é revalidado
 * contra o roster atual, não contra o que a proposta afirma.
 */
export async function aplicarContratacao(
  sugestao: any,
  nome?: unknown,
): Promise<HireResult> {
  const kind = sugestao?.kind;
  if (kind !== "dominio" && kind !== "integrante") {
    throw new Error("Campo 'sugestao.kind' deve ser 'dominio' ou 'integrante'.");
  }

  return atualizarSquad((squad) => {
    const agora = new Date().toISOString();
    const nomePessoa = nomeEscolhido(squad, nome);

    if (kind === "dominio") {
      const nomeDominio = texto(sugestao.dominio, "sugestao.dominio", 60);
      const id = slug(nomeDominio);
      const existente = acharDominio(squad, id);
      if (existente) {
        throw new ConflitoDeRoster(
          `O domínio '${existente.nome}' (id '${id}') já existe.`,
        );
      }
      // O slot sai de `proximoSlot` AGORA, não do que a proposta carregava: a
      // proposta pode ter sido feita antes de outro domínio ocupar aquele slot.
      const slot = proximoSlot(squad);
      if (!slot || squad.dominios.length >= MAX_DOMINIOS) {
        throw new ConflitoDeRoster(
          `O escritório já tem ${MAX_DOMINIOS} domínios — não há sala livre.`,
        );
      }
      const escopo = texto(sugestao.escopo, "sugestao.escopo", 200);
      const dominio: Dominio = {
        id,
        nome: nomeDominio,
        escopo,
        slot,
        room: salaPara(1),
        criadoEm: agora,
        po: novaPessoa(
          squad,
          { nome: nomePessoa, papel: texto(sugestao.papel_po, "sugestao.papel_po", 60), escopo },
          agora,
        ),
        integrantes: [],
      };
      squad.dominios.push(dominio);
      return {
        kind,
        squad: { ...squad, unlockedSlots: unlockedSlots(squad) },
        dominio,
        pessoa: dominio.po,
      } satisfies HireResult;
    }

    const dominio = acharDominio(squad, sugestao.dominio_id);
    if (!dominio) {
      const ids = squad.dominios.map((d) => d.id).join(", ");
      throw new ConflitoDeRoster(
        `dominio_id '${String(sugestao.dominio_id)}' não existe. Domínios: ${ids}.`,
      );
    }
    const pessoa = novaPessoa(
      squad,
      {
        nome: nomePessoa,
        papel: texto(sugestao.papel, "sugestao.papel", 60),
        escopo: texto(sugestao.escopo, "sugestao.escopo", 200),
      },
      agora,
    );
    dominio.integrantes.push(pessoa);
    // Sala com duas pessoas precisa de duas cadeiras, senão o segundo ator cai
    // num posto improvisado do miolo (EXTRA_STATIONS).
    dominio.room = salaPara(1 + dominio.integrantes.length, dominio.room);

    return {
      kind,
      squad: { ...squad, unlockedSlots: unlockedSlots(squad) },
      dominio,
      pessoa,
    } satisfies HireResult;
  });
}
