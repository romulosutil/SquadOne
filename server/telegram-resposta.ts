import { linhasDosEventosCriados, type FormatoDeData } from "../src/contribuicao.ts";
import { ModeloOcupado, type ErroTarefa, type TurnoResult } from "./orchestrator.ts";
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
  '📋 Passos não criados: falta autorizar o Google Tasks. Abra o SquadOne e clique em "Autorizar Google Tasks" (não use Desconectar).';
/** O card de aprovação só existe na aba, e o turno não é gravado em lugar nenhum. */
const APROVAR_NO_APP = "Para aprovar, peça de novo pelo app.";

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

  const avisos = turno.avisos ?? [];
  // Um gesto por turno, não um por compromisso: três passos sem escopo não são três pedidos.
  if (avisos.some((a) => a.motivo === "ampliarAcesso")) linhas.push(AMPLIAR);
  for (const a of avisos) if (a.motivo !== "ampliarAcesso") linhas.push(`⚠️ ${a.titulo}: ${a.aviso}`);

  // Descartados não são falha: o turno sugeriu outra squad, e a proposta abaixo explica.
  const erros = (turno.erros ?? []).filter((e) => !e.descartado);
  linhas.push(...erros.map(linhaDoErro));
  if ([...erros, ...avisos].some((x) => x.motivo === "precisaConectar")) linhas.push(CONECTAR);

  for (const s of turno.sugestoes ?? []) {
    if (s.kind === "dominio") linhas.push(`💡 Proposta: abrir a sala "${s.dominio}" (${s.papel_po}). ${APROVAR_NO_APP}`);
    else if (s.kind === "integrante") linhas.push(`💡 Proposta: contratar ${s.papel} em ${s.dominio_nome}. ${APROVAR_NO_APP}`);
    else linhas.push(`🔀 Parece da squad ${s.destino_nome}: ${s.justificativa}. Reenvie dizendo de qual squad é.`);
  }

  return linhas.length ? linhas.join("\n") : "Nada foi agendado.";
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
