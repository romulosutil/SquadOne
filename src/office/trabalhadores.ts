/**
 * Os trabalhadores automáticos do Dell (fluxos do n8n e timers) ligados à sala
 * que responde pelo trabalho deles. Catálogo estático e versionado, como
 * `src/operations/fluxos.ts`: mudou um fluxo, muda aqui e lá (o teste confere
 * que cada `verificacao` existe nos fluxos).
 *
 * FORA DO PROMPT, de propósito (RULES 26). O roster vai inteiro em toda
 * chamada ao Gemini; isto não. Um agente que lesse "o Caçador busca leads às
 * 06:00" acharia que pode acionar, reagendar ou consertar o Caçador, e a
 * infraestrutura é somente leitura para o SquadOne (RULES 10): quem conserta é
 * o Claude pela máquina de controle. Por isso o catálogo mora no frontend, e
 * nenhum módulo do servidor que monta o prompt o importa.
 *
 * A sala é pelo ID do domínio, que nunca muda; o nome muda no ✎. Os ids são os
 * da squad `prumo` de produção, criada em 07/10/2026 pelo fluxo de Nova squad:
 * por isso a sala Atendimento e proposta é `prumo--geral` (a squad nasce com a
 * sala "Geral", que foi renomeada). Sala arquivada ou inexistente neste roster
 * não mostra ninguém: o catálogo não cria sala nem pessoa.
 */

export interface TrabalhadorAutomatico {
  id: string;
  nome: string;
  /** Id do domínio que responde pelo trabalho dele. */
  sala: string;
  /** O que ele faz, numa linha. */
  faz: string;
  /** Onde roda, para quem for conferir. */
  onde: string;
  quando: string;
  /** Verificação viva do status.json do Dell (a mesma do passo em fluxos.ts). */
  verificacao: string;
}

export const TRABALHADORES: readonly TrabalhadorAutomatico[] = [
  {
    id: "cacador",
    nome: "Caçador",
    sala: "prumo--prospeccao",
    faz: "acha negócios no Google Places e põe na planilha do Site antes da venda os de nota 60 ou mais com WhatsApp",
    onde: "n8n 01, no Dell",
    quando: "06:00",
    verificacao: "fluxo:oow8TkxrAf4fVvTj",
  },
  {
    id: "lead-scout",
    nome: "Lead Scout",
    sala: "prumo--prospeccao",
    faz: "rodízio de buscas no Places; o CNPJ descarta MEI, micro e redes; o resto vira linha em Prospects",
    onde: "n8n, no Dell",
    quando: "09:00",
    verificacao: "fluxo:e02c6f43-17ce-430b-9238-0b997a7656ce",
  },
  {
    id: "gerador",
    nome: "Gerador",
    sala: "prumo--site-antes-da-venda",
    faz: "faz e publica na Vercel o site demo de cada lead, até 4 por dia",
    onde: "gerador-de-sites (timer), no Dell",
    quando: "08:00",
    verificacao: "gerador",
  },
  {
    id: "balcao",
    nome: "Balcão",
    sala: "prumo--geral",
    faz: "lê os sites publicados, monta a mensagem e o link de envio e marca o lead como pronto para abordar",
    onde: "n8n 03, no Dell",
    quando: "de hora em hora (:10)",
    verificacao: "fluxo:wjuoIknp2qlWo0QI",
  },
  {
    id: "diagnostico",
    nome: "Diagnóstico",
    sala: "prumo--organizar",
    faz: "fecha o Índice PRUMO com a resposta do dono, grava índice e briefing e avisa",
    onde: "n8n, no Dell",
    quando: "de hora em hora",
    verificacao: "fluxo:b091d18b-106b-4f4d-ad4e-f77cdeaa7a5f",
  },
];

/** Os trabalhadores de uma sala, na ordem do catálogo. */
export function trabalhadoresDaSala(dominioId: string): TrabalhadorAutomatico[] {
  return TRABALHADORES.filter((t) => t.sala === dominioId);
}
