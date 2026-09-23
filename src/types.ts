/**
 * Espelho dos tipos do servidor. O roster é uma ÁRVORE (spec Fase 1 §3):
 * roster -> squad -> domínio -> { po, integrantes }. Uma squad = um escritório;
 * uma sala do escritório = um domínio.
 */

export interface Pessoa {
  id: string;
  nome: string;
  papel: string;
  escopo: string;
  sprite: string;
  hue?: number;
  horario?: { inicio: string; fim: string };
  hiredAt: string;
  /** Arquivado: fora do mapa e do prompt; vem só em SquadView.arquivo. */
  arquivado?: boolean;
  arquivadoEm?: string;
}

export interface Dominio {
  /** slug estável; é o valor de `squadone_dominio` no Google Calendar. */
  id: string;
  nome: string;
  escopo: string;
  /** O slot é do DOMÍNIO, não das pessoas: todas elas dividem esta sala. */
  slot: [number, number];
  room: string;
  criadoEm: string;
  po: Pessoa;
  integrantes: Pessoa[];
  /** Arquivado: fora do mapa e do prompt; vem só em SquadView.arquivo. */
  arquivado?: boolean;
  arquivadoEm?: string;
}

export interface Squad {
  /** valor de `squadone_squad` no Google Calendar. */
  id: string;
  nome: string;
  escopo: string;
  calendarId: string;
  conta?: string;
  unlockOrder: [number, number][];
  /** `dominios[0].po` é o PO raiz do escritório. */
  dominios: Dominio[];
  arquivado?: boolean;
  arquivadoEm?: string;
}

export interface IntegranteArquivadoView {
  pessoa: Pessoa;
  dominioId: string;
  dominioNome: string;
}

/**
 * `dominios` e `integrantes` só com ATIVOS: GameMap, seletor e Mochila leem
 * estes campos sem saber que arquivamento existe. O arquivado vem à parte.
 */
export type SquadView = Squad & {
  unlockedSlots: [number, number][];
  proximoSlot: [number, number] | null;
  arquivo: { dominios: Dominio[]; integrantes: IntegranteArquivadoView[] };
};

/** `GET /api/squad`: squads ativas + arquivadas. A ativa é escolha da aba. */
export interface RosterView {
  version: 3;
  squads: SquadView[];
  squadsArquivadas: SquadView[];
  idsAposentados: { pessoas: string[]; dominios: string[] };
}

/** Toggle da CommandBar; espelho de `Modo` em server/capabilities.ts. */
export type Modo = "auto" | "foco" | "baixa_prioridade";

export interface EventoCriado {
  kind: "evento";
  titulo: string;
  /** id da pessoa (PO ou integrante). O domínio é derivado dela. */
  responsavel_id: string;
  tipo: "time_blocking" | "deadline";
  dominio: string;
  /** ISO; "AAAA-MM-DD" quando `dia_inteiro`. */
  inicio: string;
  /** ISO; "AAAA-MM-DD" exclusivo quando `dia_inteiro`. */
  fim: string;
  dia_inteiro: boolean;
  /** foco = bloco avulso; marco = o prazo; bloco = trabalho antes de um marco. */
  papel: "foco" | "marco" | "bloco";
  /** eventId do marco, só em `papel: "bloco"`. */
  prazo_ref?: string;
  eventId: string;
  htmlLink?: string;
  /** Subtarefas criadas no Google Tasks; só no evento principal e só quando > 0. */
  passos?: number;
}

/** Tarefa avulsa no Google Tasks (`criar_tarefa`): sem evento nem horário. */
export interface TarefaCriada {
  kind: "tarefa";
  titulo: string;
  responsavel_id: string;
  dominio: string;
  /** "AAAA-MM-DD"; ausente = sem data. */
  data?: string;
  /** Subtarefas criadas; ausente quando 0. */
  passos?: number;
  tarefaId: string;
  listaId: string;
}

/** Proposta de abrir um domínio novo — sala nova no escritório. */
export interface PropostaDominio {
  kind: "dominio";
  /** Squad em que o turno rodou; a aprovação aplica nela. */
  squad_id: string;
  dominio: string;
  papel_po: string;
  justificativa: string;
  escopo: string;
  slot: [number, number] | null;
}

/** Proposta de contratar dentro de um domínio existente — mesma sala. */
export interface PropostaIntegrante {
  kind: "integrante";
  /** Squad em que o turno rodou; a aprovação aplica nela. */
  squad_id: string;
  dominio_id: string;
  dominio_nome: string;
  papel: string;
  justificativa: string;
  escopo: string;
}

/** A demanda parece de outra squad. Só proposta: trocar é clique do usuário. */
export interface PropostaTrocaSquad {
  kind: "troca_squad";
  squad_id: string;
  destino_id: string;
  destino_nome: string;
  justificativa: string;
  demanda: string;
}

/** `id` gerado pelo servidor a cada turno: identidade do card na tela. */
export type Sugestao = (PropostaDominio | PropostaIntegrante | PropostaTrocaSquad) & { id: string };

/** Corpo de `POST /api/squad/nova`. `nome_po` vazio = o servidor escolhe. */
export interface DadosNovaSquad {
  nome: string;
  escopo: string;
  papel_po: string;
  nome_po: string;
}

export interface ErroTarefa {
  capacidade: string;
  args: Record<string, unknown>;
  erro: string;
  /** Não rodou: o turno sugeriu trocar de squad e o servidor descartou o resto. */
  descartado?: true;
  /**
   * Por que falhou, quando há um gesto certo (ex.: reconectar). `ampliarAcesso`:
   * tarefa avulsa sem o escopo do Google Tasks.
   */
  motivo?: "precisaConectar" | "configuracao" | "semHorarioLivre" | "agendaIndisponivel" | "ampliarAcesso";
}

/** Feito, mas não como pedido (conflito, esforço parcial...). Não é erro. */
export interface AvisoTarefa {
  capacidade: string;
  titulo: string;
  aviso: string;
  /**
   * `precisaConectar`: bloco de prazo recusado por credencial. `ampliarAcesso`:
   * passos não criados por falta do escopo do Google Tasks (o Calendar segue ok).
   */
  motivo?: "precisaConectar" | "configuracao" | "semHorarioLivre" | "agendaIndisponivel" | "ampliarAcesso";
}

/**
 * O servidor trocou de squad sozinho e reprocessou a demanda lá: já aconteceu,
 * não é proposta. A aba adota a squad de destino e avisa onde a demanda caiu.
 */
export interface Redirecionamento {
  de_id: string;
  de_nome: string;
  para_id: string;
  para_nome: string;
  justificativa: string;
}

export interface TurnoResponse {
  eventos_criados: EventoCriado[];
  /** Ausente em servidor anterior à tarefa avulsa. */
  tarefas_criadas?: TarefaCriada[];
  sugestoes: Sugestao[];
  avisos: AvisoTarefa[];
  erros: ErroTarefa[];
  /** Ausente quando o turno rodou na squad que o usuário escolheu. */
  redirecionado?: Redirecionamento;
}

/**
 * Item da Mochila. Vem de `GET /api/mochila`, que lê o Google Calendar — não
 * existe lista local de quests no frontend.
 */
export interface QuestCalendario {
  eventId: string;
  titulo: string;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  tipo: "time_blocking" | "deadline";
  /** `extendedProperties.private.squadone_dominio` — eixo de filtro. */
  dominio: string;
  /** `extendedProperties.private.squadone_membro` — eixo de atribuição. */
  membro: string;
  /** `squadone_squad`; vazio em eventos anteriores à Fase 1. */
  squad: string;
  /** `squadone_prazo_ref`: eventId do marco quando a quest é bloco de um prazo; "" senão. */
  prazoRef: string;
  htmlLink?: string;
  /**
   * Checklist no Google Tasks: subtarefas concluídas / total. Ausente = quest
   * sem passos, ou o servidor não conseguiu ler o Tasks (o selo só some).
   */
  passos?: { feitos: number; total: number };
}

export interface MochilaResponse {
  quests: QuestCalendario[];
  /** `incompleto`: mais eventos que o teto de páginas; o domínio volta sem quests. */
  erros: { dominio: string; erro: string; credencial: boolean; incompleto?: true }[];
}

/** Espelho de LIMITES em server/squad.ts: o formulário corta antes de o servidor recusar. */
export const LIMITES = {
  squadNome: 40,
  squadEscopo: 200,
  dominioNome: 60,
  dominioEscopo: 200,
  pessoaNome: 40,
  papel: 60,
  escopoPessoa: 1500,
  frase: 300,
} as const;

/** Corpo de `POST /api/squad/redigir`. */
export type PedidoDeRedacao =
  | { alvo: "integrante" | "po"; squadId: string; dominioId: string; frase: string }
  | { alvo: "pessoa"; pessoaId: string; frase: string }
  | { alvo: "dominio"; squadId: string; frase: string };

export interface RedacaoDePessoa {
  alvo: "integrante" | "po" | "pessoa";
  papel: string;
  escopo: string;
  truncado: boolean;
}

export interface RedacaoDeDominio {
  alvo: "dominio";
  nome: string;
  escopo_dominio: string;
  papel_po: string;
  escopo_po: string;
  truncado: boolean;
}

export type Redacao = RedacaoDePessoa | RedacaoDeDominio;

export interface HireResponse {
  kind: "dominio" | "integrante";
  squadId: string;
  roster: RosterView;
  dominio: Dominio;
  pessoa: Pessoa;
}

export interface SubstituicaoResponse {
  roster: RosterView;
  po: Pessoa;
  anterior: Pessoa;
}

/** De onde o modal de contratação foi aberto. */
export type AlvoDeContratacao =
  | { alvo: "integrante"; squadId: string; dominio: Dominio }
  | { alvo: "dominio"; squadId: string; slot: [number, number] }
  | { alvo: "po"; squadId: string; dominio: Dominio };

/** Texto inicial do modal quando vem do "Ajustar" de um card do modelo. */
export interface PreenchimentoDeContratacao {
  papel?: string;
  escopo?: string;
  nomeDominio?: string;
  escopoDominio?: string;
}

/** O que o modal entrega ao App. No alvo `dominio`, papel/escopo/nome são do PO. */
export type DadosDeContratacao =
  | { alvo: "integrante"; nome: string; papel: string; escopo: string }
  | { alvo: "dominio"; nome: string; nomeDominio: string; escopoDominio: string; papelPo: string; escopoPo: string }
  | { alvo: "po"; integranteId: string }
  | { alvo: "po"; nome: string; papel: string; escopo: string };

/** De onde o modal de edição foi aberto. Ids nunca são editáveis. */
export type AlvoDeEdicao =
  | { tipo: "pessoa"; pessoa: Pessoa }
  | { tipo: "dominio"; dominio: Dominio }
  | { tipo: "squad"; squad: SquadView };

/** Proposta de ajuste de tempo. Vira card; só muda o Google se aprovada. */
export interface PropostaDeAjuste {
  id: string;
  kind: "ajuste";
  /**
   * Quem abriu o card. `usuario` é o gesto da Mochila: o card nasce editável e
   * o tempo proposto é escolha de quem clicou, não sugestão de agente. A rota
   * `/ajustar` é a mesma nos dois casos — muda só a origem da proposta.
   */
  origem: "agente" | "usuario";
  squad_id: string;
  eventId: string;
  titulo: string;
  pessoa_id: string;
  pessoa_nome: string;
  papel: string;
  alvo: "duracao" | "esforco";
  atual_min: number;
  proposto_min: number;
  motivo: string;
}

/**
 * Espelho dos limites de `interpretarPedidoDeAjuste` (server/ajuste.ts, sobre
 * DURACAO_MAX_MIN/ESFORCO_MAX_MIN do alocador): o card corta antes de o
 * servidor recusar com 400.
 */
export const LIMITES_DE_AJUSTE = {
  duracao: { min: 15, max: 720 },
  esforco: { min: 30, max: 2400 },
  /** Todo slot cai na grade de 15 min; `proposto_min` fora dela é 400. */
  grade: 15,
} as const;

export interface EventoAjustado {
  eventId: string;
  inicio: string;
  fim: string;
  acao: "encurtado" | "estendido" | "movido" | "criado";
}

/** Espelho de server/ajuste.ts. */
export interface RespostaDeAjuste {
  alvo: "duracao" | "esforco";
  eventos: EventoAjustado[];
  avisos: string[];
  faltou_min: number;
  sobra_min: number;
}
