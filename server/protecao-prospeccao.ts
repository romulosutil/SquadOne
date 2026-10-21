import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { CrmVisao } from '../src/operations/types.ts';
import { respostasNaJanela } from './respostas-do-dia.ts';

const HORA = 60 * 60_000;
export const REGRA_DE_RESPOSTA = { janelaHoras: 24, esperaMinutos: 60, minimo: 5, fracaoSemHumana: 0.8 };
export type SinalDaConta = 'restricao' | 'recusa' | 'desconectado';
export interface PausaAutomatica {
  motivo: SinalDaConta | 'sem-resposta-humana';
  desde: string;
  detalhe: string;
  revisarApos: string | null;
  amostra?: ReturnType<typeof respostasNaJanela>;
}
const PAUSA = 'prospeccao-pausa.json';
const CONFIG = 'frente-comercial-config.json';
async function lerJson(arquivo: string) {
  try { return JSON.parse(await fs.readFile(arquivo, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
async function gravar(arquivo: string, valor: unknown) {
  await fs.mkdir(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(valor), { mode: 0o600 });
  await fs.rename(tmp, arquivo);
}
export async function lerPausaAutomatica(dir: string): Promise<PausaAutomatica | null> {
  const valor = await lerJson(path.join(dir, PAUSA));
  if (valor === null || valor.ativa === false) return null;
  if (!['restricao', 'recusa', 'desconectado', 'sem-resposta-humana'].includes(valor.motivo) || typeof valor.detalhe !== 'string') {
    throw new Error('A proteção de primeiros contatos precisa ser conferida.');
  }
  // Só campos de negócio: não expõe dados da integração nem conteúdo de conversa.
  return { motivo: valor.motivo, desde: valor.desde, detalhe: valor.detalhe, revisarApos: valor.revisarApos, ...(valor.amostra ? { amostra: valor.amostra } : {}) };
}
export function pausaPorRespostas(visao: Pick<CrmVisao, 'estado' | 'leads'>, agora: number): PausaAutomatica | null {
  if (visao.estado !== 'ok') return null;
  const amostra = respostasNaJanela(visao.leads, agora, agora - 24 * HORA, agora - HORA);
  const semHumana = amostra.robos + amostra.semResposta;
  if (amostra.enviados < REGRA_DE_RESPOSTA.minimo || semHumana / amostra.enviados < REGRA_DE_RESPOSTA.fracaoSemHumana) return null;
  return { motivo: 'sem-resposta-humana', desde: new Date(agora).toISOString(), revisarApos: null, amostra,
    detalhe: `${semHumana} de ${amostra.enviados} contatos enviados há pelo menos 1 hora, nas últimas 24 horas, estão sem resposta humana. Robôs não contam como resposta humana. Revise a seleção e aguarde os retornos antes de reativar.` };
}
function pausaPorSinal(sinal: SinalDaConta, agora: number): PausaAutomatica {
  const detalhe = sinal === 'restricao' ? 'A integração informou bloqueio ou restrição da conta. Confira o WhatsApp antes de retomar.'
    : sinal === 'recusa' ? 'A integração recusou o envio (403 ou 429). Confira restrição, autenticação ou limite de frequência antes de retomar.'
      : 'O WhatsApp do PRUMO está desconectado. Novos primeiros contatos foram interrompidos até conferir a conta.';
  return { motivo: sinal, desde: new Date(agora).toISOString(), detalhe,
    revisarApos: sinal === 'restricao' ? new Date(agora + 24 * HORA).toISOString() : null };
}
export class RetomadaRecusada extends Error {}

/** Uma fila de escrita para pausa, ativação e reserva não apagarem a decisão uma da outra. */
export function criarProtecaoProspeccao(deps: { dir: string; agora: () => number;
  visao?: () => Promise<Pick<CrmVisao, 'estado' | 'leads'>>;
  saude?: () => Promise<'open' | SinalDaConta | null> }) {
  let fila: Promise<unknown> = Promise.resolve();
  function exclusivo<T>(f: () => Promise<T>): Promise<T> {
    const atual = fila.then(f); fila = atual.catch(() => undefined); return atual;
  }
  async function sinalPendente(): Promise<SinalDaConta | undefined> {
    const [sinal, revisao] = await Promise.all([lerJson(path.join(deps.dir, 'prospeccao-sinal.json')), lerJson(path.join(deps.dir, PAUSA))]);
    if (!sinal) return undefined;
    if (!['restricao', 'recusa', 'desconectado'].includes(sinal.sinal) || !Number.isFinite(Date.parse(sinal.em))) throw new Error('Sinal de segurança ilegível.');
    return Date.parse(sinal.em) > (Date.parse(revisao?.sinaisRevisadosAte ?? '') || 0) ? sinal.sinal : undefined;
  }
  async function candidato(visao?: Pick<CrmVisao, 'estado' | 'leads'> | null, sinal?: SinalDaConta, revisando = false) {
    const saude = sinal ?? (!revisando ? await sinalPendente() : undefined) ?? (deps.saude ? await deps.saude() : null);
    if (saude && saude !== 'open') return pausaPorSinal(saude, deps.agora());
    const v = visao ?? (deps.visao ? await deps.visao() : null);
    return v ? pausaPorRespostas(v, deps.agora()) : null;
  }
  async function pausar(pausa: PausaAutomatica) {
    // O cadeado vem primeiro: mesmo se a configuração falhar, as reservas continuam barradas.
    await gravar(path.join(deps.dir, PAUSA), { ...pausa, ativa: true });
    const config = (await lerJson(path.join(deps.dir, CONFIG))) ?? {};
    await gravar(path.join(deps.dir, CONFIG), { ...config, ativo: false, atualizadoEm: new Date(deps.agora()).toISOString() });
    return pausa;
  }
  async function verificarInterno(visao?: Pick<CrmVisao, 'estado' | 'leads'> | null, sinal?: SinalDaConta) {
    const anterior = await lerPausaAutomatica(deps.dir);
    const pendente = sinal ?? await sinalPendente();
    if (anterior && !pendente) {
      const saude = deps.saude ? await deps.saude() : null;
      if (!saude || saude === 'open' || anterior.motivo === 'restricao' || anterior.motivo === saude) return anterior;
      return pausar(pausaPorSinal(saude, deps.agora()));
    }
    const nova = await candidato(visao, pendente);
    if (!nova) return anterior;
    if (anterior && (anterior.motivo === 'restricao' || anterior.motivo === nova.motivo)) return anterior;
    return pausar(nova);
  }
  return {
    verificar: (visao?: Pick<CrmVisao, 'estado' | 'leads'> | null, sinal?: SinalDaConta) => exclusivo(() => verificarInterno(visao, sinal)),
    configurar: (ativo: boolean) => exclusivo(async () => {
      if (ativo) {
        const anterior = await verificarInterno();
        if (anterior?.revisarApos && deps.agora() < Date.parse(anterior.revisarApos)) throw new RetomadaRecusada('A pausa por restrição exige pelo menos 24 horas e conferência manual da conta.');
        // Reativar exige leitura atual; falha de integração não equivale a recuperação.
        const visao = deps.visao ? await deps.visao() : null;
        if (!visao || visao.estado !== 'ok') throw new RetomadaRecusada('Aguarde uma leitura atual de Vendas antes de reativar.');
        if (deps.saude && await deps.saude() !== 'open') throw new RetomadaRecusada('A conta ainda não está confirmada como conectada. Confira o WhatsApp.');
        const nova = await candidato(visao, undefined, true);
        if (nova) { await pausar(nova); throw new RetomadaRecusada(nova.detalhe); }
      }
      const arquivo = path.join(deps.dir, CONFIG);
      const anterior = (await lerJson(arquivo)) ?? {};
      await gravar(arquivo, { ...anterior, ativo, atualizadoEm: new Date(deps.agora()).toISOString() });
      // A liberação só ocorre nesta ação explícita e depois de todas as conferências.
      if (ativo) await gravar(path.join(deps.dir, PAUSA), { ativa: false, retomadaEm: new Date(deps.agora()).toISOString(), sinaisRevisadosAte: new Date(deps.agora()).toISOString() });
      return { ativo };
    }),
  };
}

/** Consulta somente estado, nunca manda mensagens. Credencial fica apenas no servidor. */
export async function saudeDaContaWhatsapp(): Promise<'open' | SinalDaConta | null> {
  let chave: string | undefined;
  try {
    const env = await fs.readFile(path.join(os.homedir(), 'workspace/evolution/.env'), 'utf8');
    chave = env.split(/\r?\n/).find(l => l.startsWith('EVOLUTION_APIKEY='))?.slice('EVOLUTION_APIKEY='.length).trim().replace(/^['"]|['"]$/g, '');
  } catch { return null; }
  if (!chave) return null;
  try {
    const r = await fetch('http://127.0.0.1:8081/instance/connectionState/prumo', { headers: { apikey: chave }, signal: AbortSignal.timeout(5_000) });
    if (r.status === 403 || r.status === 429) return 'recusa';
    if (!r.ok) return null;
    const j = await r.json() as { instance?: { state?: string } };
    if (j.instance?.state === 'open') return 'open';
    if (['close', 'closed', 'connecting'].includes(j.instance?.state ?? '')) return 'desconectado';
    if (['blocked', 'restricted', 'banned'].includes(j.instance?.state ?? '')) return 'restricao';
    return null;
  } catch { return null; }
}
