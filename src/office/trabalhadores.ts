/**
 * Os trabalhadores automáticos do Dell (fluxos do n8n e timers) ligados à sala
 * que responde pelo trabalho deles. Desde 15/10/2026 a lista NASCE de
 * `src/operations/fluxos.ts` (o campo `trabalhador` de cada passo): um catálogo
 * só, o mesmo do "Como funciona" de Mais, com o `quando` e a `verificacao` do
 * passo. Antes eram duas listas à mão, e os caçadores do Iris e das
 * Estamparias tinham entrado numa e não na outra.
 *
 * FORA DO PROMPT, de propósito (RULES 26). O roster vai inteiro em toda
 * chamada ao Gemini; isto não. Um agente que lesse "o Caçador busca leads às
 * 06:00" acharia que pode acionar, reagendar ou consertar o Caçador, e a
 * infraestrutura é somente leitura para o SquadOne (RULES 10): quem conserta é
 * o Claude pela máquina de controle. Por isso o catálogo mora no frontend, e
 * nenhum módulo do servidor que monta o prompt o importa (nem este, nem fluxos.ts).
 *
 * A sala é pelo ID do domínio, que nunca muda; o nome muda no ✎. Os ids são os
 * da squad `prumo` de produção, criada em 07/10/2026 pelo fluxo de Nova squad:
 * por isso a sala Atendimento e proposta é `prumo--geral` (a squad nasce com a
 * sala "Geral", que foi renomeada). Sala arquivada ou inexistente neste roster
 * não mostra ninguém: o catálogo não cria sala nem pessoa.
 */
import { FLUXOS, type FluxoDaOperacao, type TrabalhadorDoPasso } from "../operations/fluxos";

export interface TrabalhadorAutomatico extends TrabalhadorDoPasso {
  quando: string;
  /**
   * Verificação viva do status.json do Dell (a do passo). Ausente = o monitor do
   * Dell não confere este trabalhador: nenhuma tela pode dizer se ele rodou ou
   * falhou, e não se inventa um estado (RULES 2).
   */
  verificacao?: string;
  /** O fluxo e o índice do passo em "Como funciona", para o link do Escritório. */
  fluxo: string;
  passo: number;
}

/** Os trabalhadores de uma lista de fluxos, na ordem dos fluxos e dos passos. */
export function trabalhadoresDosFluxos(fluxos: readonly FluxoDaOperacao[]): TrabalhadorAutomatico[] {
  return fluxos.flatMap((f) =>
    f.passos.flatMap((p, i) =>
      p.trabalhador
        ? [{ ...p.trabalhador, quando: p.quando, ...(p.verificacao ? { verificacao: p.verificacao } : {}), fluxo: f.id, passo: i }]
        : []
    )
  );
}

export const TRABALHADORES: readonly TrabalhadorAutomatico[] = trabalhadoresDosFluxos(FLUXOS);

/** Os trabalhadores de uma sala, na ordem do catálogo. */
export function trabalhadoresDaSala(dominioId: string): TrabalhadorAutomatico[] {
  return TRABALHADORES.filter((t) => t.sala === dominioId);
}

/** O "Como funciona" do trabalhador, em Mais, com o passo dele em destaque. */
export function linkDoComoFunciona(t: Pick<TrabalhadorAutomatico, "fluxo" | "passo">): string {
  return `/mais?fluxo=${encodeURIComponent(t.fluxo)}&passo=${t.passo}#como-title`;
}
