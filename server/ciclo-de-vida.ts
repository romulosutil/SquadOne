/**
 * Ciclo de vida do roster (spec Fase 2 §4.4–§4.7): editar, arquivar e reativar
 * pessoa, domínio e squad.
 *
 * Nada aqui apaga. Arquivar marca e tira do prompt, do mapa e da vista; o
 * registro fica na árvore com o id reservado, e reativar devolve tudo como era.
 * Nada aqui toca o Google: os eventos continuam onde estão, com as marcas
 * originais — é isso que permite reativar sem migrar nada.
 *
 * Toda mutação dentro de `atualizarRoster`. Validação de FORMA roda antes da
 * fila (400 sem esperar escritor nenhum); validação de ESTADO roda dentro,
 * contra o roster lido na vez dela (409).
 */

import {
  aposentarIds,
  atualizarRoster,
  ativo,
  ConflitoDeRoster,
  dominiosAtivos,
  integrantesAtivos,
  LIMITES,
  localizarDominio,
  localizarPessoa,
  localizarSquad,
  normalizarEscopo,
  paraVista,
  PedidoInvalido,
  proximoSlot,
  salaPara,
  slug,
  squadsAtivas,
  textoDeUmaLinha,
  type Roster,
  type RosterView,
} from "./squad.ts";

export interface ResultadoDoRoster {
  roster: RosterView;
}

function objeto(corpo: unknown): Record<string, unknown> {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    throw new PedidoInvalido("O corpo deve ser um objeto JSON.");
  }
  return corpo as Record<string, unknown>;
}

/**
 * Só os campos editáveis, todos texto. Chave desconhecida é 400, não ignorada:
 * um `id` no corpo é alguém achando que dá para renomear o id, e ignorar calado
 * deixaria achar que deu.
 */
function camposEditaveis(corpo: unknown, permitidos: readonly string[]): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(objeto(corpo))) {
    if (!permitidos.includes(chave)) {
      throw new PedidoInvalido(
        chave === "id"
          ? "Ids nunca mudam: 'id' não é editável."
          : `Campo '${chave}' não é editável aqui. Editáveis: ${permitidos.join(", ")}.`,
      );
    }
    if (typeof valor !== "string") throw new PedidoInvalido(`Campo '${chave}' deve ser texto.`);
    saida[chave] = valor;
  }
  if (Object.keys(saida).length === 0) {
    throw new PedidoInvalido(`Nada para editar. Editáveis: ${permitidos.join(", ")}.`);
  }
  return saida;
}

/**
 * Texto que o usuário revisou: acima do limite é 400, não corte. Cortar calado
 * perderia justamente o fim do treino que ele acabou de escrever.
 */
export function textoRevisado(valor: string, campo: string, max: number, multilinha = false): string {
  const v = multilinha ? normalizarEscopo(valor) : textoDeUmaLinha(valor);
  if (!v) throw new PedidoInvalido(`Campo '${campo}' não pode ficar vazio.`);
  if (v.length > max) {
    throw new PedidoInvalido(`Campo '${campo}' tem ${v.length} caracteres; o máximo é ${max}.`);
  }
  return v;
}

function exigirPessoa(roster: Roster, id: string) {
  const achada = localizarPessoa(roster, id);
  if (!achada) throw new ConflitoDeRoster(`A pessoa '${id}' não existe.`);
  return achada;
}

function exigirDominio(roster: Roster, id: string) {
  const achado = localizarDominio(roster, id);
  if (!achado) throw new ConflitoDeRoster(`O domínio '${id}' não existe.`);
  return achado;
}

function exigirSquad(roster: Roster, id: string) {
  const achada = localizarSquad(roster, id);
  if (!achada) throw new ConflitoDeRoster(`A squad '${id}' não existe.`);
  return achada;
}

function marcarArquivado(x: { arquivado?: boolean; arquivadoEm?: string }): void {
  x.arquivado = true;
  x.arquivadoEm = new Date().toISOString();
}

/** Apaga as chaves em vez de gravar `false`: o JSON do ativo fica igual ao de antes da Fase 2. */
function desmarcarArquivado(x: { arquivado?: boolean; arquivadoEm?: string }): void {
  delete x.arquivado;
  delete x.arquivadoEm;
}

const vista = (roster: Roster): ResultadoDoRoster => ({ roster: paraVista(roster) });

// --- Editar -----------------------------------------------------------------

/** Papel e escopo de PO ou integrante, ativo ou arquivado. O nome não é editável nesta fase. */
export async function editarPessoa(pessoaId: string, corpo: unknown): Promise<ResultadoDoRoster> {
  const c = camposEditaveis(corpo, ["papel", "escopo"]);
  const papel = c.papel === undefined ? undefined : textoRevisado(c.papel, "papel", LIMITES.papel);
  const escopo = c.escopo === undefined ? undefined : textoRevisado(c.escopo, "escopo", LIMITES.escopoPessoa, true);
  return atualizarRoster((roster) => {
    const { pessoa } = exigirPessoa(roster, pessoaId);
    if (papel !== undefined) pessoa.papel = papel;
    if (escopo !== undefined) pessoa.escopo = escopo;
    return vista(roster);
  });
}

export async function editarDominio(dominioId: string, corpo: unknown): Promise<ResultadoDoRoster> {
  const c = camposEditaveis(corpo, ["nome", "escopo"]);
  const nome = c.nome === undefined ? undefined : textoRevisado(c.nome, "nome", LIMITES.dominioNome);
  const escopo = c.escopo === undefined ? undefined : textoRevisado(c.escopo, "escopo", LIMITES.dominioEscopo);
  return atualizarRoster((roster) => {
    const { squad, dominio } = exigirDominio(roster, dominioId);
    if (nome !== undefined) {
      // Mesma regra da criação (novoIdDeDominio): dois domínios com o mesmo nome
      // na mesma squad são engano. Arquivado conta, senão reativá-lo depois
      // criaria a duplicata.
      const outro = squad.dominios.find((d) => d !== dominio && slug(d.nome) === slug(nome));
      if (outro) {
        throw new ConflitoDeRoster(
          ativo(outro)
            ? `Já existe o domínio '${outro.nome}' na squad '${squad.nome}'.`
            : `O domínio '${outro.nome}' existe arquivado na squad '${squad.nome}': reative-o ou escolha outro nome.`,
        );
      }
      dominio.nome = nome;
    }
    if (escopo !== undefined) dominio.escopo = escopo;
    return vista(roster);
  });
}

/** Vale também para a squad `pessoal`, cujo escopo a migração fixou. O id nunca muda. */
export async function editarSquad(squadId: string, corpo: unknown): Promise<ResultadoDoRoster> {
  const c = camposEditaveis(corpo, ["nome", "escopo"]);
  const nome = c.nome === undefined ? undefined : textoRevisado(c.nome, "nome", LIMITES.squadNome);
  const escopo = c.escopo === undefined ? undefined : textoRevisado(c.escopo, "escopo", LIMITES.squadEscopo);
  return atualizarRoster((roster) => {
    const squad = exigirSquad(roster, squadId);
    if (nome !== undefined) {
      // O id de uma squad nasce do slug do nome. Renomear para o slug de OUTRA
      // deixaria duas entradas indistinguíveis no seletor.
      const alvo = slug(nome);
      const outra = roster.squads.find((s) => s !== squad && (s.id === alvo || slug(s.nome) === alvo));
      if (outra) {
        throw new ConflitoDeRoster(
          ativo(outra)
            ? `Já existe a squad '${outra.nome}'.`
            : `A squad '${outra.nome}' existe arquivada: reative-a ou escolha outro nome.`,
        );
      }
      squad.nome = nome;
    }
    if (escopo !== undefined) squad.escopo = escopo;
    return vista(roster);
  });
}

// --- Pessoa -----------------------------------------------------------------

export async function arquivarPessoa(pessoaId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const { pessoa, dominio, posicao } = exigirPessoa(roster, pessoaId);
    // Toda sala precisa de dono: o PO raiz circula pelo escritório e um domínio
    // sem PO não tem a quem rotear. Por isso PO se substitui (hire.substituirPo).
    if (posicao === "po") {
      throw new ConflitoDeRoster(
        `'${pessoa.nome}' é o PO do domínio '${dominio.nome}': PO não se arquiva, substitua-o.`,
      );
    }
    if (!ativo(pessoa)) return vista(roster); // duplo clique não é erro
    marcarArquivado(pessoa);
    aposentarIds(roster, { pessoas: [pessoa.id] });
    return vista(roster);
  });
}

export async function reativarPessoa(pessoaId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const { pessoa, dominio, squad, posicao } = exigirPessoa(roster, pessoaId);
    if (posicao === "po") {
      throw new ConflitoDeRoster(`'${pessoa.nome}' é PO e nunca é arquivado: não há o que reativar.`);
    }
    // Pai arquivado: a pessoa continuaria fora do escritório mesmo sem a marca,
    // e o botão pareceria não ter feito nada.
    if (!ativo(squad)) {
      throw new ConflitoDeRoster(`A squad '${squad.nome}' está arquivada: reative a squad antes.`);
    }
    if (!ativo(dominio)) {
      throw new ConflitoDeRoster(`O domínio '${dominio.nome}' está arquivado: reative o domínio antes.`);
    }
    if (ativo(pessoa)) return vista(roster);
    desmarcarArquivado(pessoa);
    // A sala só promove, e só por quem está ativo: arquivado não ocupa cadeira.
    dominio.room = salaPara(1 + integrantesAtivos(dominio).length, dominio.room);
    return vista(roster);
  });
}

// --- Domínio ----------------------------------------------------------------

export async function arquivarDominio(dominioId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const { squad, dominio } = exigirDominio(roster, dominioId);
    // dominios[0] é o domínio raiz: o PO dele é quem circula pelo escritório
    // (GameMap) e a squad precisa de ≥1 domínio ativo. Nunca arquivando a raiz,
    // não é preciso regra de sucessão.
    if (squad.dominios[0] === dominio) {
      throw new ConflitoDeRoster(
        `'${dominio.nome}' é o domínio raiz da squad '${squad.nome}': não pode ser arquivado. ` +
          `Arquive a squad inteira ou substitua o PO dele.`,
      );
    }
    if (!ativo(dominio)) return vista(roster);
    marcarArquivado(dominio);
    aposentarIds(roster, {
      dominios: [dominio.id],
      pessoas: [dominio.po.id, ...dominio.integrantes.map((p) => p.id)],
    });
    return vista(roster);
  });
}

export async function reativarDominio(dominioId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const { squad, dominio } = exigirDominio(roster, dominioId);
    if (!ativo(squad)) {
      throw new ConflitoDeRoster(`A squad '${squad.nome}' está arquivada: reative a squad antes.`);
    }
    if (ativo(dominio)) return vista(roster);
    // O slot antigo, se livre, devolve a sala ao lugar onde o usuário a
    // conhecia. Ocupado por quem entrou depois, vai para o primeiro livre.
    const ocupados = new Set(dominiosAtivos(squad).map((d) => d.slot.join(",")));
    const slot = ocupados.has(dominio.slot.join(",")) ? proximoSlot(squad) : dominio.slot;
    if (!slot) {
      throw new ConflitoDeRoster(
        `A squad '${squad.nome}' não tem sala livre: arquive outro domínio antes de reativar '${dominio.nome}'.`,
      );
    }
    dominio.slot = [slot[0], slot[1]];
    desmarcarArquivado(dominio);
    return vista(roster);
  });
}

// --- Squad ------------------------------------------------------------------

export async function arquivarSquad(squadId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const squad = exigirSquad(roster, squadId);
    if (!ativo(squad)) return vista(roster);
    // Sem squad ativa não há escritório para abrir nem para onde mandar demanda.
    if (squadsAtivas(roster).length <= 1) {
      throw new ConflitoDeRoster(`'${squad.nome}' é a última squad ativa: não pode ser arquivada.`);
    }
    // Domínios e pessoas NÃO são marcados: ao reativar, a squad volta como estava.
    marcarArquivado(squad);
    return vista(roster);
  });
}

export async function reativarSquad(squadId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const squad = exigirSquad(roster, squadId);
    if (ativo(squad)) return vista(roster);
    desmarcarArquivado(squad);
    return vista(roster);
  });
}
