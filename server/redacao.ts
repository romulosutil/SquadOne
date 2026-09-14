/**
 * Redação do treino de um agente (spec Fase 2 §5.5). O usuário escreve uma
 * frase, uma chamada curta ao Gemini devolve papel + escopo, e o usuário edita
 * e aprova. Esta rota NÃO escreve no roster: contratar é outro gesto, e falhar
 * aqui nunca impede contratar escrevendo à mão.
 *
 * Function calling restrito (mode ANY + allowedFunctionNames com um nome só),
 * não resposta estruturada. gerarComRetry troca de gemini-3.7-flash para
 * gemini-3.5-flash no meio da tentativa; function calling é o que os dois já
 * servem em todo turno, e responseMimeType foi medido como campo minado nessa
 * troca (ver executarTurno). A objeção do turno a ANY, forçar proposta
 * espúria, não vale aqui: a chamada É a resposta.
 */

import { FunctionCallingConfigMode, Type, type FunctionDeclaration, type GoogleGenAI } from "@google/genai";
import { gerarComRetry, MODEL, ModeloOcupado } from "./orchestrator.ts";
import {
  acharDominio,
  ativo,
  ConflitoDeRoster,
  dominiosAtivos,
  integrantesAtivos,
  LIMITES,
  limitar,
  localizarPessoa,
  normalizarEscopo,
  PedidoInvalido,
  resolverSquad,
  textoDeUmaLinha,
  type Dominio,
  type Pessoa,
  type Roster,
  type Squad,
} from "./squad.ts";

/** O modelo respondeu, mas não com o que dá para usar. 502: não é culpa do pedido nem passa sozinho. */
export class RedacaoInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "RedacaoInvalida";
  }
}

export type PedidoDeRedacao =
  | { alvo: "integrante" | "po"; squad: Squad; dominio: Dominio; frase: string }
  | { alvo: "pessoa"; squad: Squad; dominio: Dominio; pessoa: Pessoa; frase: string }
  | { alvo: "dominio"; squad: Squad; frase: string };

export interface RedacaoDePessoa {
  alvo: "integrante" | "po" | "pessoa";
  papel: string;
  escopo: string;
  /** Algum campo passou do limite e foi cortado: a UI avisa. */
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

/**
 * Forma e estado ANTES de chamar o Gemini: domínio, pessoa ou squad arquivados
 * e ids velhos falham sem gastar chamada ao modelo.
 */
export function interpretarPedidoDeRedacao(roster: Roster, corpo: unknown): PedidoDeRedacao {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    throw new PedidoInvalido("O corpo deve ser um objeto JSON.");
  }
  const b = corpo as Record<string, unknown>;
  const frase = typeof b.frase === "string" ? textoDeUmaLinha(b.frase) : "";
  if (!frase) throw new PedidoInvalido("Campo 'frase' é obrigatório.");
  if (frase.length > LIMITES.frase) {
    throw new PedidoInvalido(`Campo 'frase' tem ${frase.length} caracteres; o máximo é ${LIMITES.frase}.`);
  }

  switch (b.alvo) {
    case "integrante":
    case "po": {
      if (typeof b.dominioId !== "string" || !b.dominioId) {
        throw new PedidoInvalido("Campo 'dominioId' é obrigatório.");
      }
      const squad = resolverSquad(roster, b.squadId);
      const dominio = acharDominio(squad, b.dominioId);
      if (!dominio) {
        throw new ConflitoDeRoster(`O domínio '${b.dominioId}' não está ativo na squad '${squad.nome}'.`);
      }
      return { alvo: b.alvo, squad, dominio, frase };
    }
    case "pessoa": {
      if (typeof b.pessoaId !== "string" || !b.pessoaId) {
        throw new PedidoInvalido("Campo 'pessoaId' é obrigatório.");
      }
      const achada = localizarPessoa(roster, b.pessoaId);
      if (!achada || !ativo(achada.squad) || !ativo(achada.dominio) || !ativo(achada.pessoa)) {
        throw new ConflitoDeRoster(`A pessoa '${b.pessoaId}' não existe ou não está ativa.`);
      }
      return { alvo: "pessoa", squad: achada.squad, dominio: achada.dominio, pessoa: achada.pessoa, frase };
    }
    case "dominio":
      return { alvo: "dominio", squad: resolverSquad(roster, b.squadId), frase };
    default:
      throw new PedidoInvalido("Campo 'alvo' deve ser 'integrante', 'po', 'pessoa' ou 'dominio'.");
  }
}

/**
 * Formato do escopo (spec Fase 2 §5.3). As três primeiras linhas servem ao
 * orquestrador para escolher responsavel_id; "Ao opinar" e "Sinais de alerta"
 * são a rubrica da nota_de_execucao que nasce com o evento.
 */
const FORMATO_ESCOPO = `O escopo tem EXATAMENTE cinco linhas, nesta ordem, cada uma começando pelo rótulo:
Missão: uma ou duas frases sobre para que este agente existe.
Cuida de: itens concretos separados por "; ".
Não cuida de: itens separados por "; " — principalmente o que é de outros papéis listados.
Ao opinar sobre um compromisso: o que este agente verifica num evento do calendário (prazo realista, preparação, dependências, riscos).
Sinais de alerta: situações em que deve avisar o usuário.`;

export function promptDeRedacao(p: PedidoDeRedacao): string {
  const cabecalho = `Você redige o TREINO de um agente do SquadOne. O treino é papel + escopo: vai
literal para o prompt do orquestrador, que escolhe quem recebe cada compromisso,
e numa fase seguinte para o próprio agente opinar sobre compromissos do
calendário. Escreva em português, concreto ao tema, sem inventar ferramentas,
pessoas ou fatos que o pedido não sugere.

Squad: '${p.squad.nome}' (escopo: ${p.squad.escopo})`;

  if (p.alvo === "dominio") {
    const existentes = dominiosAtivos(p.squad).map((d) => `- ${d.nome}: ${d.escopo}`).join("\n");
    return `${cabecalho}
Domínios ativos desta squad (o novo não pode repetir o tema deles):
${existentes}

Tarefa: a partir do pedido do usuário, proponha um DOMÍNIO novo e o PO dono
dele. Chame redigir_dominio uma vez; não responda em texto.
- nome: 1 a 3 palavras, até 60 caracteres (ex.: "Financeiro").
- escopo_dominio: UMA frase de até 200 caracteres dizendo que demandas pertencem
  a este domínio.
- papel_po: até 60 caracteres (ex.: "PO Financeiro").
- escopo_po: até 1400 caracteres.
${FORMATO_ESCOPO}`;
  }

  // Só ativos: quem saiu não deve moldar o "Não cuida de" do recém-chegado.
  const pessoasDoDominio = [p.dominio.po, ...integrantesAtivos(p.dominio)]
    .map((x) => `- ${x.papel} (${x.nome})`)
    .join("\n");
  // `if` em vez de ternário: o TS só estreita a união pelo `alvo` assim.
  let alvo: string;
  if (p.alvo === "pessoa") {
    alvo = `o treino REESCRITO de ${p.pessoa.nome}, que hoje é:\n${p.pessoa.papel}\n${p.pessoa.escopo}`;
  } else if (p.alvo === "po") {
    alvo = "o NOVO PO deste domínio, que substitui o atual";
  } else {
    alvo = "um INTEGRANTE novo deste domínio";
  }

  return `${cabecalho}
Domínio: '${p.dominio.nome}' (escopo: ${p.dominio.escopo})
Pessoas ativas neste domínio:
${pessoasDoDominio}

Tarefa: a partir do pedido do usuário, redija ${alvo}. Chame redigir_pessoa uma
vez; não responda em texto.
- papel: 1 a 4 palavras, sem nome próprio, até 60 caracteres.
- escopo: até 1400 caracteres.
${FORMATO_ESCOPO}`;
}

const REDIGIR_PESSOA: FunctionDeclaration = {
  name: "redigir_pessoa",
  description: "Entrega o papel e o escopo redigidos para um agente.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      papel: { type: Type.STRING, description: "Papel, até 60 caracteres, sem nome próprio." },
      escopo: { type: Type.STRING, description: "Escopo nas cinco linhas rotuladas, até 1400 caracteres." },
    },
    required: ["papel", "escopo"],
  },
};

const REDIGIR_DOMINIO: FunctionDeclaration = {
  name: "redigir_dominio",
  description: "Entrega o domínio novo e o treino do PO dele.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      nome: { type: Type.STRING, description: "Nome do domínio, até 60 caracteres." },
      escopo_dominio: { type: Type.STRING, description: "Uma frase, até 200 caracteres." },
      papel_po: { type: Type.STRING, description: "Papel do PO, até 60 caracteres." },
      escopo_po: { type: Type.STRING, description: "Escopo do PO nas cinco linhas rotuladas, até 1400 caracteres." },
    },
    required: ["nome", "escopo_dominio", "papel_po", "escopo_po"],
  },
};

function campoRedigido(
  args: Record<string, unknown>,
  nome: string,
  max: number,
  multilinha = false,
): { texto: string; truncado: boolean } {
  const bruto = typeof args[nome] === "string" ? (args[nome] as string) : "";
  const limpo = multilinha ? normalizarEscopo(bruto) : textoDeUmaLinha(bruto);
  if (!limpo) throw new RedacaoInvalida(`O modelo devolveu '${nome}' vazio. Escreva à mão ou tente de novo.`);
  return limitar(limpo, max);
}

export async function redigirTreino(ai: GoogleGenAI, pedido: PedidoDeRedacao): Promise<Redacao> {
  const declaracao = pedido.alvo === "dominio" ? REDIGIR_DOMINIO : REDIGIR_PESSOA;
  const nome = declaracao.name as string;

  let response: Awaited<ReturnType<typeof gerarComRetry>>;
  try {
    response = await gerarComRetry(ai, {
      model: MODEL,
      contents: pedido.frase,
      config: {
        systemInstruction: promptDeRedacao(pedido),
        tools: [{ functionDeclarations: [declaracao] }],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [nome] },
        },
      },
    });
  } catch (err: any) {
    // Sobrecarga passa sozinha e já tem classificação própria (503). O resto
    // (chave inválida, argumento recusado) não passa: vira 502 com o motivo.
    if (err instanceof ModeloOcupado) throw err;
    throw new RedacaoInvalida(`O Gemini recusou a redação: ${String(err?.message ?? err).slice(0, 300)}`);
  }

  const call = response.functionCalls?.find((c) => c.name === nome);
  if (!call) throw new RedacaoInvalida("O modelo não devolveu a redação. Escreva à mão ou tente de novo.");
  const args = (call.args ?? {}) as Record<string, unknown>;

  if (pedido.alvo === "dominio") {
    const nomeDominio = campoRedigido(args, "nome", LIMITES.dominioNome);
    const escopoDominio = campoRedigido(args, "escopo_dominio", LIMITES.dominioEscopo);
    const papelPo = campoRedigido(args, "papel_po", LIMITES.papel);
    const escopoPo = campoRedigido(args, "escopo_po", LIMITES.escopoPessoa, true);
    return {
      alvo: "dominio",
      nome: nomeDominio.texto,
      escopo_dominio: escopoDominio.texto,
      papel_po: papelPo.texto,
      escopo_po: escopoPo.texto,
      truncado: nomeDominio.truncado || escopoDominio.truncado || papelPo.truncado || escopoPo.truncado,
    };
  }

  const papel = campoRedigido(args, "papel", LIMITES.papel);
  const escopo = campoRedigido(args, "escopo", LIMITES.escopoPessoa, true);
  return { alvo: pedido.alvo, papel: papel.texto, escopo: escopo.texto, truncado: papel.truncado || escopo.truncado };
}
