import { linhasDasTarefasCriadas, linhasDosEventosCriados, type FormatoDeData } from "../src/contribuicao.ts";
import { ModeloOcupado, type ErroTarefa, type TurnoResult } from "./orchestrator.ts";
import type { Sugestao } from "./capabilities.ts";
import { AudioSemFala } from "./transcricao.ts";
import { JanelaMalConfigurada } from "./alocador.ts";
import { RosterIlegivel } from "./squad.ts";

/**
 * PURO: o `TurnoResult` em texto de chat. É o `handleDelegation` do App.vue sem
 * Vue: toast, alert e cards viram linhas. Texto puro (sem Markdown) — ver
 * `enviarMensagem`. O resumo dos eventos é o MESMO da UI (`src/contribuicao.ts`),
 * com o fuso fixado por quem chama: o container roda em UTC.
 */

export const MAX_MENSAGEM_TELEGRAM = 4096;
const CORTE = "\n…(cortado)";

const CONECTAR = "🔌 Google desconectado: abra o SquadOne e clique em Conectar.";
const AMPLIAR =
  '📋 Falta autorizar o Google Tasks (passos e tarefas ficaram de fora). Abra o SquadOne e clique em "Autorizar Google Tasks" (não use Desconectar).';

function tituloDoErro(e: ErroTarefa): string {
  const t = e.args?.titulo;
  return typeof t === "string" && t.trim() ? t.trim() : e.capacidade;
}

function linhaDoErro(e: ErroTarefa): string {
  switch (e.motivo) {
    case "agendaIndisponivel":
      return `❌ ${tituloDoErro(e)}: não consegui ler sua agenda no Google agora. Tente de novo.`;
    case "configuracao":
      return `❌ ${tituloDoErro(e)}: configuração do servidor — ${e.erro}`;
    case "precisaConectar":
    case "semHorarioLivre":
    case "ampliarAcesso":
      return `❌ ${tituloDoErro(e)}: ${e.erro}`;
    default:
      return `❌ ${e.capacidade}: ${e.erro}`;
  }
}

export function textoDoTurno(turno: TurnoResult, fmt: FormatoDeData): string {
  const linhas: string[] = [];
  const r = turno.redirecionado;
  if (r) linhas.push(`🔀 Squad ${r.para_nome} (a demanda não era de ${r.de_nome}).`);

  linhas.push(...linhasDosEventosCriados(turno.eventos_criados ?? [], fmt).map((l) => `✅ ${l}`));
  linhas.push(...linhasDasTarefasCriadas(turno.tarefas_criadas ?? [], fmt).map((l) => `📋 ${l}`));

  const avisos = turno.avisos ?? [];
  // Descartados não são falha: o turno sugeriu outra squad, e a proposta abaixo explica.
  const erros = (turno.erros ?? []).filter((e) => !e.descartado);
  // Um gesto por turno, não um por compromisso: três passos sem escopo não são
  // três pedidos. Tarefa avulsa sem escopo chega como erro (com o título) e
  // soma no mesmo gesto.
  if ([...avisos, ...erros].some((x) => x.motivo === "ampliarAcesso")) linhas.push(AMPLIAR);
  for (const a of avisos) if (a.motivo !== "ampliarAcesso") linhas.push(`⚠️ ${a.titulo}: ${a.aviso}`);

  linhas.push(...erros.map(linhaDoErro));
  if ([...erros, ...avisos].some((x) => x.motivo === "precisaConectar")) linhas.push(CONECTAR);

  // Contratação vai em mensagem própria, com os botões (ver `propostasDeContratacao`);
  // aqui só a contagem, para o resumo não parecer vazio.
  const contratacoes = propostasDeContratacao(turno).length;
  if (contratacoes) linhas.push(`💡 ${contratacoes} proposta(s) de contratação abaixo.`);
  for (const s of turno.sugestoes ?? []) {
    if (s.kind === "troca_squad") linhas.push(`🔀 Parece da squad ${s.destino_nome}: ${s.justificativa}. Reenvie dizendo de qual squad é.`);
  }

  return linhas.length ? linhas.join("\n") : "Nada foi agendado.";
}

export type PropostaDeContratacao = Extract<Sugestao, { kind: "dominio" | "integrante" }>;

export function propostasDeContratacao(turno: TurnoResult): PropostaDeContratacao[] {
  return (turno.sugestoes ?? []).filter((s): s is PropostaDeContratacao => s.kind === "dominio" || s.kind === "integrante");
}

/**
 * A mensagem de uma proposta, que leva os botões Aprovar/Descartar. O nome da
 * pessoa sai do servidor na aprovação, como no card sem nome digitado.
 */
export function textoDaProposta(s: PropostaDeContratacao): string {
  const cabeca = s.kind === "dominio"
    ? `💡 Abrir a sala "${s.dominio}", com um ${s.papel_po} como PO.`
    : `💡 Contratar ${s.papel} em ${s.dominio_nome}.`;
  return s.justificativa.trim() ? `${cabeca}\n${s.justificativa.trim()}` : cabeca;
}

/** Resultado de `aplicarContratacao`, só o que o chat mostra. */
export function textoDaContratacao(r: { kind: "dominio" | "integrante"; dominio: { nome: string }; pessoa: { nome: string; papel: string } }): string {
  return r.kind === "dominio"
    ? `✅ Sala "${r.dominio.nome}" aberta: ${r.pessoa.nome} (${r.pessoa.papel}) é o PO.`
    : `✅ ${r.pessoa.nome} (${r.pessoa.papel}) contratado em ${r.dominio.nome}.`;
}

/** O áudio não virou demanda. */
export function textoDaFalhaDeTranscricao(err: unknown): string {
  if (err instanceof AudioSemFala) return "🎙️ Não entendi o áudio. Tente de novo ou escreva a demanda.";
  if (err instanceof ModeloOcupado) return textoDaFalha(err);
  return `🎙️ Não consegui ouvir o áudio: ${err instanceof Error ? err.message : String(err)}`;
}

/** O turno inteiro falhou antes de devolver resultado (mesmas classes que a rota traduz em status). */
export function textoDaFalha(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof ModeloOcupado) return "⏳ Gemini sobrecarregado agora. Reenvie a mensagem em alguns segundos.";
  if (err instanceof JanelaMalConfigurada) return `⚙️ JANELA_TRABALHO/DIAS_TRABALHO inválida no servidor: ${msg}`;
  if (err instanceof RosterIlegivel) return "⚙️ squad.json ilegível no servidor. Veja o log do Easypanel.";
  return `❌ Erro ao processar a demanda: ${msg}`;
}

export function cortarParaTelegram(texto: string): string {
  if (texto.length <= MAX_MENSAGEM_TELEGRAM) return texto;
  return texto.slice(0, MAX_MENSAGEM_TELEGRAM - CORTE.length) + CORTE;
}
