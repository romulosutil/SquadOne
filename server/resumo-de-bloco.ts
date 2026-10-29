/**
 * Resumo de bloco (29/10/2026, a "entrega seguinte" da Rotina em docs/PRUMO-DECISOES-PM-2026-10-28.md):
 * às 08h55 e às 13h55 de São Paulo, seg–sex, uma mensagem no Telegram com o que o bloco que começa em
 * 5 minutos tem para fazer. Bloco 1 (fechar, 09h00–10h30): o que está mais perto de pagar. Bloco 2
 * (conversar, 14h00–15h30): as respostas e retomadas pendentes.
 *
 * PURO, como o resumo matinal (resumo-matinal.ts): sem fetch, relógio, env ou estado. Quem chama é o
 * vendedor (vendedor.ts), não a vigia: o resumo precisa da MESMA fila de venda que o vendedor e a
 * Central já leem (filaDeVenda, src/operations/proxima-venda.ts), do dia do servidor (o que a Central
 * já resolveu) e do teto de 8 avisos por dia, que mora no estado do vendedor. A vigia só vê a agenda e
 * para inteira quando o Google desconecta, o que calaria um resumo que não depende do Google.
 *
 * Nenhum critério novo: cada ação da fila cai num bloco pelo tipo e pela chave que a fila já dá
 * (blocoDaAcao). Nome da empresa sim; telefone, id e R$ nunca (o texto passa por `semValores` e o
 * aviso inteiro por `validarAviso`, a trava de R$ de avisos.ts, antes de sair).
 */
import type { AcaoDeVenda } from "../src/operations/proxima-venda.ts";
import { resumoDaFila } from "../src/operations/proxima-venda.ts";
import type { CrmLead } from "../src/operations/types.ts";
import { LIMITES_DO_AVISO, semValores, umaLinha, type Aviso } from "./avisos.ts";

export type IdDoBloco = "fechar" | "conversar";

export interface Bloco {
  id: IdDoBloco;
  numero: 1 | 2;
  /** Minutos desde a meia-noite de São Paulo. */
  inicioMin: number;
  fimMin: number;
  /** Quando o resumo sai: 5 min antes do bloco, para dar tempo de abrir a Central. */
  resumoMin: number;
}

export const BLOCOS: readonly Bloco[] = [
  { id: "fechar", numero: 1, inicioMin: 9 * 60, fimMin: 10 * 60 + 30, resumoMin: 8 * 60 + 55 },
  { id: "conversar", numero: 2, inicioMin: 14 * 60, fimMin: 15 * 60 + 30, resumoMin: 13 * 60 + 55 },
];

/**
 * Até quantos minutos depois do horário o resumo ainda sai. Um reinício da Central às 09h05 ainda
 * manda o do bloco 1 (o bloco está no começo); às 09h16 o bloco já andou e o resumo vira ruído.
 */
export const ATRASO_MAXIMO_MIN = 20;

/** Seg a sex (getUTCDay do relógio de São Paulo), os dias da Rotina. */
export const DIAS_DOS_BLOCOS: readonly number[] = [1, 2, 3, 4, 5];

/** Quantas empresas o texto nomeia; o resto vira "…e mais N". Mantém o aviso em ~12 linhas. */
export const MAX_NOMES = 7;

export const ORIGEM_DO_RESUMO_DE_BLOCO = "squadone:vendedor";

/** Nasce ligado, como o resumo matinal; `SQUADONE_RESUMO_DE_BLOCO=false` desliga. */
export function resumoDeBlocoLigado(env: NodeJS.ProcessEnv): boolean {
  return (env.SQUADONE_RESUMO_DE_BLOCO ?? "").trim().toLowerCase() !== "false";
}

/** São Paulo é UTC−3 o ano todo desde 2019 (o mesmo atalho de trava-de-horario.ts e do vendedor). */
function relogioSP(agora: number): { data: string; dia: number; minutos: number } {
  const d = new Date(agora - 3 * 3600_000);
  return { data: d.toISOString().slice(0, 10), dia: d.getUTCDay(), minutos: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}h${String(min % 60).padStart(2, "0")}`;

/**
 * O bloco cujo resumo está devido agora, com a chave que o deduplica (`AAAA-MM-DD|fechar`), ou null.
 * Devido = seg–sex, entre o horário do resumo e ATRASO_MAXIMO_MIN depois (inclusive), e a chave ainda
 * não em `jaEnviados`. A data na chave faz o resumo de ontem nunca bloquear o de hoje, mesmo que o
 * estado não tenha virado o dia.
 */
export function blocoDevido(agora: number, jaEnviados: readonly string[]): { bloco: Bloco; chave: string } | null {
  if (!Number.isFinite(agora)) return null;
  const { data, dia, minutos } = relogioSP(agora);
  if (!DIAS_DOS_BLOCOS.includes(dia)) return null;
  for (const bloco of BLOCOS) {
    if (minutos < bloco.resumoMin || minutos - bloco.resumoMin > ATRASO_MAXIMO_MIN) continue;
    const chave = `${data}|${bloco.id}`;
    return jaEnviados.includes(chave) ? null : { bloco, chave };
  }
  return null;
}

/**
 * PURO: em que bloco uma ação da fila se faz, ou null (fica só na Central). Lê só o tipo e a chave
 * que a fila já dá, mais a etapa do lead:
 * - fechar: mandar a proposta, os degraus da cadência da proposta (os toques de proposta do dia), o
 *   "quanto custa" (`|negociacao-humana`), a qualificação comercial e o ciclo comercial (aceite,
 *   contrato, cobrança), o encaminhamento interno urgente (pagamento, Pix), e a resposta de gente
 *   quente ("quero ver", "pode mandar") ou de quem já está em proposta.
 * - conversar: as outras respostas de gente, o "o que achou?" depois do link e a retomada da
 *   cadência da conversa (os dois são `depois-do-link`), o "marque 10 minutos" (`|qualificar`) e o
 *   combinado salvo.
 * - fora: primeiro contato, follow-up, recusa para marcar, revisões, indicação e o interno sem
 *   urgência; também a resposta do robô ou da recepção (`roboOuRecepcao`), que a Rotina tirou do
 *   Telegram. Seguem na Central e entram só na contagem do fim do texto.
 */
export function blocoDaAcao(a: AcaoDeVenda, lead: Pick<CrmLead, "etapa"> | undefined, roboOuRecepcao = false): IdDoBloco | null {
  if (a.primeiroContato) return null;
  switch (a.tipo) {
    case "mandar-proposta":
    case "proposta":
      return "fechar";
    case "responder":
      if (roboOuRecepcao) return null;
      return a.quente || lead?.etapa === "proposta" ? "fechar" : "conversar";
    case "depois-do-link":
      return "conversar";
    case "combinado": {
      if (a.revisao || a.chave.endsWith("|revisao") || a.chave.includes("|revisao-conversa|") || a.chave.includes("|indicacao|")) return null;
      if (["|negociacao-humana", "|qualificacao-comercial", "|ciclo-comercial"].some((s) => a.chave.endsWith(s))) return "fechar";
      if (a.chave.endsWith("|atendimento-comercial")) return a.quente ? "fechar" : null;
      if (a.interna) return null;
      return "conversar";
    }
    default:
      return null;
  }
}

/** O que fazer com a empresa, em poucas palavras; nunca o `porque` da fila, que pode trazer saldo em R$. */
export function rotuloDaAcao(a: AcaoDeVenda, lead: Pick<CrmLead, "etapa"> | undefined): string {
  switch (a.tipo) {
    case "mandar-proposta": return "mandar a proposta";
    case "proposta": return "toque da proposta";
    case "responder": return a.quente ? "pediu para ver" : lead?.etapa === "proposta" ? "respondeu à proposta" : "respondeu";
    case "depois-do-link": return a.chave.endsWith("|depois-do-link") ? "\"o que achou?\" depois do link" : "retomar a conversa";
    default: break;
  }
  if (a.chave.endsWith("|negociacao-humana")) return "perguntou o preço";
  if (a.chave.endsWith("|qualificacao-comercial")) return "conduzir a negociação";
  if (a.chave.endsWith("|ciclo-comercial")) return "aceite, contrato ou pagamento";
  if (a.chave.endsWith("|atendimento-comercial")) return "pedido comercial a conferir";
  if (a.chave.endsWith("|qualificar")) return "marcar 10 minutos";
  return "combinado para hoje";
}

const CABECALHO: Record<IdDoBloco, { nome: string; um: string; varios: string; vazio: string }> = {
  fechar: { nome: "fechar", um: "1 perto de pagar:", varios: "perto de pagar:", vazio: "Nada perto de pagar na fila agora." },
  conversar: { nome: "conversar", um: "1 resposta ou retomada pendente:", varios: "respostas e retomadas pendentes:", vazio: "Nenhuma resposta ou retomada pendente agora." },
};

/**
 * PURO: o aviso do bloco. `fila`: a fila de venda pendente (sem o que já se resolveu hoje), na ordem
 * da fila, que já é a ordem de venda. `leads`: para a etapa (resposta de quem está em proposta).
 * `roboOuRecepcao`: a mesma regra que tira essas respostas do aviso individual (vendedor.ts).
 *
 * Fila do bloco vazia ainda manda uma mensagem curta ("nada pendente"): o bloco é um horário marcado e
 * o resumo diz se vale segurá-lo; o silêncio às 08h55 não se distingue de o vendedor estar parado. São
 * no máximo 2 por dia, longe do ruído do "nada hoje" diário que o resumo matinal evita.
 */
export function montarResumoDeBloco(
  bloco: Bloco,
  chave: string,
  fila: readonly AcaoDeVenda[],
  leads: ReadonlyMap<string, Pick<CrmLead, "etapa">>,
  agora: number,
  opcoes: { roboOuRecepcao?: (a: AcaoDeVenda) => boolean; origemCentral?: string } = {},
): Aviso {
  const robo = opcoes.roboOuRecepcao ?? (() => false);
  const doBloco: AcaoDeVenda[] = [];
  const resto: AcaoDeVenda[] = [];
  const vistos = new Set<string>();
  for (const a of fila) {
    const lead = leads.get(a.leadId);
    // A fila já é uma ação por lead; o Set só protege o texto de um lead repetido.
    if (blocoDaAcao(a, lead, robo(a)) === bloco.id && !vistos.has(a.leadId)) {
      vistos.add(a.leadId);
      doBloco.push(a);
    } else resto.push(a);
  }
  const c = CABECALHO[bloco.id];
  const linhas: string[] = [];
  if (!doBloco.length) linhas.push(c.vazio);
  else {
    linhas.push(doBloco.length === 1 ? c.um : `${doBloco.length} ${c.varios}`);
    for (const a of doBloco.slice(0, MAX_NOMES)) {
      linhas.push(`• ${umaLinha(semValores(a.empresa), 60)}: ${rotuloDaAcao(a, leads.get(a.leadId))}`);
    }
    if (doBloco.length > MAX_NOMES) linhas.push(`…e mais ${doBloco.length - MAX_NOMES}`);
  }
  const fora = resumoDaFila(resto);
  if (fora) linhas.push(`Na Central, fora deste bloco: ${fora}.`);

  const origem = opcoes.origemCentral?.trim().replace(/\/$/, "");
  // Vale até o fim do bloco: depois dele o resumo não diz mais nada.
  const { data } = relogioSP(agora);
  const fim = Date.parse(`${data}T${hhmm(bloco.fimMin).replace("h", ":")}:00-03:00`);
  return {
    titulo: umaLinha(`🗓 Bloco ${bloco.numero} · ${c.nome} · ${hhmm(bloco.inicioMin)}–${hhmm(bloco.fimMin)}`, LIMITES_DO_AVISO.titulo),
    texto: linhas.join("\n").slice(0, LIMITES_DO_AVISO.texto),
    origem: ORIGEM_DO_RESUMO_DE_BLOCO,
    chave: `resumo-de-bloco:${chave}`,
    prioridade: 2,
    expiraEm: new Date(Number.isFinite(fim) ? fim : agora + 90 * 60_000).toISOString(),
    ...(origem ? { link: `${origem}/crm` } : {}),
  };
}
