import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import express, { type Router } from 'express';
import type { CrmVisao } from '../src/operations/types.ts';
import { frenteDosArquivos, primeirosDoTime, reservaDoTime, type FrenteDoPrimeiro, type ReservaDoTime } from '../src/operations/primeiro-contato.ts';
import { tetoDoDia } from '../src/operations/trava-de-ritmo.ts';
import { conferirMensagem } from './gate-de-envio.ts';
import type { MemoriaDaVenda } from './venda-do-dia.ts';

/**
 * O time comercial na Central (19/10/2026). O time em si roda no Dell (deploy/dell/frente-comercial.py,
 * timer desligado por padrão): avalia os leads `pronto` com três agentes e manda o primeiro contato pelo
 * número do PRUMO. Daqui saem só leitura e a reserva:
 *
 *  - GET /crm/frente: o estado que o time grava, sem segredo nem número (para a tela).
 *  - POST /crm/frente/config: ligar ou pausar o time ({ ativo }), só da mesma origem.
 *  - POST /crm/frente/reservar: o time pede para fazer o primeiro contato de UM lead. A Central decide
 *    com a mesma janela e o mesmo ritmo das telas e do Telegram (src/operations/primeiro-contato.ts),
 *    confere a mensagem do Balcão no gate de envio em modo "bloquear" e, podendo, grava o primeiro
 *    do dia `por: "time"` no mesmo passo. Sem reserva, o time não envia.
 *
 * O registro no CRM (enviado_em, a letra e o ab_elegiveis congelados) é o clique no link rastreado
 * do n8n, o mesmo da Central: quem o faz é o time, antes de enviar. Aqui nada fala com o WhatsApp.
 */
const CONFIG = 'frente-comercial-config.json';
const ESTADO = 'frente-comercial.json';

const lerJson = (arquivo: string) => fs.readFile(arquivo, 'utf8').then(JSON.parse).catch(() => null);

/** A fila do time do disco, para o predicado de quem faz o primeiro contato. Ilegível = sem time. */
export async function lerFrenteDoPrimeiro(dataDir: string): Promise<FrenteDoPrimeiro> {
  return frenteDosArquivos(await lerJson(path.join(dataDir, CONFIG)), await lerJson(path.join(dataDir, ESTADO)));
}

/** Os leads cujo primeiro contato é do time agora (a Próxima venda e o vendedor do Telegram os tiram da fila). */
export async function lerPrimeirosDoTime(dataDir: string): Promise<Set<string>> {
  return primeirosDoTime(await lerFrenteDoPrimeiro(dataDir));
}

/** Estado derivado do serviço de domínio. Nenhum segredo ou comando chega ao navegador. */
export async function lerFrente(dataDir: string, agora = Date.now()) {
  const config = (await lerJson(path.join(dataDir, CONFIG))) ?? { ativo: false };
  const bruto = await lerJson(path.join(dataDir, ESTADO));
  // O teto é o da trava de ritmo da Central, dividido com as telas e o Telegram: não é uma cota do time.
  const limite = tetoDoDia(agora);
  if (!bruto) return { ativo: config.ativo === true, estado: 'iniciando', limite, fila: [], atualizadoEm: null };
  const stale = !Number.isFinite(Date.parse(bruto.atualizadoEm)) || agora - Date.parse(bruto.atualizadoEm) > 10 * 60_000;
  return {
    ativo: config.ativo === true, estado: stale ? 'sem-sinal' : config.ativo === false ? 'pausado' : bruto.estado,
    limite, dia: bruto.dia, atualizadoEm: bruto.atualizadoEm,
    avaliados: bruto.avaliados ?? 0, selecionados: bruto.selecionados ?? 0,
    enviados: bruto.enviados ?? 0, respondidos: bruto.respondidos ?? 0,
    proximoEnvioEm: bruto.proximoEnvioEm ?? null,
    detalhe: typeof bruto.detalhe === 'string' ? bruto.detalhe.slice(0, 400) : '',
    fila: (Array.isArray(bruto.fila) ? bruto.fila : []).slice(0, 100).map((l: Record<string, unknown>) => ({
      id: l.id, empresa: l.empresa, produto: l.produto, nota: l.nota, estado: l.estado, motivo: l.motivo,
      avaliacoes: l.avaliacoes, enviadoEm: l.enviadoEm, mensagem: l.mensagem,
    })),
  };
}

export interface DepsDaFrente {
  dataDir: string;
  memoriaDaVenda: MemoriaDaVenda;
  /** O retrato do CRM. Ausente (CRM não configurado): o time não reserva nada. */
  visao?: () => Promise<Pick<CrmVisao, 'estado' | 'leads'>>;
  agora?: () => number;
}

function mesmaOrigem(req: express.Request): boolean {
  const origin = req.get('Origin');
  try {
    return !!origin && ['http:', 'https:'].includes(new URL(origin).protocol) && new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

export function montarFrenteComercial(router: Router, deps: DepsDaFrente) {
  const { dataDir } = deps;
  const agora = deps.agora ?? Date.now;
  router.get('/crm/frente', async (_req, res, next) => {
    try { res.set('Cache-Control', 'no-store').json(await lerFrente(dataDir, agora())); } catch (e) { next(e); }
  });
  router.post('/crm/frente/config', express.json({ limit: '4kb' }), async (req, res, next) => {
    try {
      if (!mesmaOrigem(req)) return res.status(403).json({ error: 'Confirme a configuração na própria Central.' });
      if (Object.keys(req.body ?? {}).length !== 1 || typeof req.body.ativo !== 'boolean') return res.status(400).json({ error: 'Informe se o time deve iniciar primeiros contatos.' });
      await fs.mkdir(dataDir, { recursive: true });
      const arq = path.join(dataDir, CONFIG);
      const tmp = `${arq}.${randomUUID()}.tmp`;
      const anterior = (await lerJson(arq)) ?? {};
      await fs.writeFile(tmp, JSON.stringify({ ...anterior, ativo: req.body.ativo, atualizadoEm: new Date(agora()).toISOString() }), { mode: 0o600 });
      await fs.rename(tmp, arq);
      return res.json({ ativo: req.body.ativo });
    } catch (e) { return next(e); }
  });
  router.post('/crm/frente/reservar', express.json({ limit: '4kb' }), async (req, res) => {
    const { leadId } = (req.body ?? {}) as { leadId?: unknown };
    if (typeof leadId !== 'string' || !/^[A-Za-z0-9_:.-]{1,200}$/.test(leadId)) {
      return void res.status(400).json({ reservado: false, error: 'Diga o lead do primeiro contato.' });
    }
    if (!mesmaOrigem(req)) return void res.status(403).json({ reservado: false, error: 'Só da mesma origem.' });
    try {
      const visao = deps.visao ? await deps.visao() : null;
      if (!visao || visao.estado !== 'ok') return void res.status(503).json({ reservado: false, motivo: 'sem-retrato', ate: null });
      const frente = await lerFrenteDoPrimeiro(dataDir);
      const lead = visao.leads.find((l) => l.id === leadId);
      // Automático, a mensagem do Balcão só sai com o gate limpo (o Balcão a gera em "avisar"; aqui é "bloquear").
      const gate = lead?.mensagemPronta
        ? conferirMensagem(lead.mensagemPronta, { modo: 'bloquear', tipo: 'primeiro', nome: lead.empresa, destino: { registro: lead.links.whatsapp } })
        : null;
      const r: ReservaDoTime = await deps.memoriaDaVenda.reservarPrimeiro(leadId, (dia) => reservaDoTime({
        leadId, lead, frente, leads: visao.leads, primeiros: dia.primeiros, mensagemAprovada: Boolean(gate && !gate.bloqueia), agora: agora(),
      }));
      if (r.ok === false) return void res.json({ reservado: false, motivo: r.motivo, ate: r.ate === null ? null : new Date(r.ate).toISOString() });
      res.json({ reservado: true, texto: lead!.mensagemPronta });
    } catch (error) {
      console.error('[frente] reserva não gravou:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ reservado: false, error: 'Não deu para reservar agora.' });
    }
  });
}
