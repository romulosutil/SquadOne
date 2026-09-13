import {
  alocar,
  BLOCO_MIN,
  conflitos,
  dentroDaJanela,
  GRADE_MIN,
  PAUSA_MIN,
  type Intervalo,
  type Janela,
} from "./alocador.ts";

/**
 * O que um ajuste aprovado faz com a agenda. PURO pelo mesmo motivo do
 * alocador da Fase 3 (que ele reusa, sem duplicar): decidir horário tem que
 * ser verificável por tabela. Quem lê e grava no Google é server/ajuste.ts.
 */

const MIN_MS = 60_000;

export interface PedidoDeDuracao {
  atual: Intervalo;
  novoMin: number;
  /** Já SEM o intervalo do próprio evento. */
  ocupacao: Intervalo[];
  janela: Janela;
  agora: number;
  /** Bloco de prazo: o trabalho não passa do limite do marco. */
  limite?: number;
  permitirMover: boolean;
}

export type PlanoDeDuracao =
  | { acao: "encurtado" | "estendido" | "movido"; slot: Intervalo }
  | { acao: "naoCabe" }
  | { acao: "nada" };

/**
 * Mudar a duração mexe só no FIM. Mover é outro gesto, explícito
 * (`permitirMover`): o usuário aprovou "90 min", não "outro horário".
 */
export function planejarDuracao(p: PedidoDeDuracao): PlanoDeDuracao {
  const novoFim = p.atual.inicio + p.novoMin * MIN_MS;
  if (Math.abs(novoFim - p.atual.fim) < GRADE_MIN * MIN_MS) return { acao: "nada" };
  const slot = { inicio: p.atual.inicio, fim: novoFim };
  if (novoFim < p.atual.fim) return { acao: "encurtado", slot };
  const cabe =
    conflitos(p.ocupacao, slot).length === 0 &&
    // Um foco que o usuário fixou fora da janela pode continuar fora dela.
    (dentroDaJanela(slot, p.janela) || !dentroDaJanela(p.atual, p.janela)) &&
    (p.limite === undefined || slot.fim <= p.limite);
  if (cabe) return { acao: "estendido", slot };
  if (!p.permitirMover) return { acao: "naoCabe" };
  // SemHorarioLivre do alocador sobe: quem chama responde 409 semHorarioLivre.
  const { slots } = alocar(
    p.ocupacao,
    p.janela,
    { tipo: "foco", duracaoMin: p.novoMin, aPartirDe: p.agora, limite: p.limite },
    p.agora,
  );
  return { acao: "movido", slot: slots[0] };
}

export interface BlocoExistente {
  eventId: string;
  etag: string;
  inicio: number;
  fim: number;
}

export interface PedidoDeEsforco {
  blocos: BlocoExistente[];
  novoTotalMin: number;
  ocupacao: Intervalo[];
  janela: Janela;
  agora: number;
  limite: number;
}

export interface PlanoDeEsforco {
  criar: Intervalo[];
  /** Mesmo evento com o `fim` novo. */
  encurtar: BlocoExistente[];
  faltouMin: number;
  sobraMin: number;
}

/**
 * Aumentar cria blocos antes do prazo; reduzir encurta blocos FUTUROS, do mais
 * tarde para o mais cedo, até BLOCO_MIN. Nada é apagado (princípio da Fase 3):
 * o que não dá para reduzir vira `sobraMin` e o usuário decide no Google.
 */
export function planejarEsforco(p: PedidoDeEsforco): PlanoDeEsforco {
  const vazio: PlanoDeEsforco = { criar: [], encurtar: [], faltouMin: 0, sobraMin: 0 };
  const total = p.blocos.reduce((t, b) => t + (b.fim - b.inicio) / MIN_MS, 0);
  const delta = p.novoTotalMin - total;
  if (Math.abs(delta) < GRADE_MIN) return vazio;

  if (delta > 0) {
    const esforco = Math.max(BLOCO_MIN, Math.ceil(delta / GRADE_MIN) * GRADE_MIN);
    if (p.limite <= p.agora) return { ...vazio, faltouMin: esforco };
    // Pausa em volta dos blocos existentes: sem ela o bloco extra encostaria num
    // bloco do mesmo prazo e os dois virariam um bloco longo. O alocador só põe
    // pausa entre os blocos do PRÓPRIO pedido.
    const comPausa = [
      ...p.ocupacao,
      ...p.blocos.map((b) => ({ inicio: b.inicio - PAUSA_MIN * MIN_MS, fim: b.fim + PAUSA_MIN * MIN_MS })),
    ];
    const { slots, faltouMin } = alocar(comPausa, p.janela, { tipo: "blocos", esforcoMin: esforco, limite: p.limite }, p.agora);
    return { ...vazio, criar: slots, faltouMin };
  }

  let reduzir = -delta;
  const encurtar: BlocoExistente[] = [];
  // Só o que ainda não começou: bloco em andamento ou passado é o que aconteceu.
  const futuros = p.blocos.filter((b) => b.inicio > p.agora).sort((a, b) => b.inicio - a.inicio);
  for (const b of futuros) {
    if (reduzir <= 0) break;
    const pode = (b.fim - b.inicio) / MIN_MS - BLOCO_MIN;
    const corte = Math.floor(Math.min(pode, reduzir) / GRADE_MIN) * GRADE_MIN;
    if (corte > 0) {
      encurtar.push({ ...b, fim: b.fim - corte * MIN_MS });
      reduzir -= corte;
    }
  }
  return { ...vazio, encurtar, sobraMin: reduzir };
}
