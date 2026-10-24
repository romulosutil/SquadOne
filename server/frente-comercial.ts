import fs from 'node:fs/promises';
import path from 'node:path';
import express, { type Router } from 'express';
import type { CrmVisao } from '../src/operations/types.ts';
import { frenteDosArquivos, primeirosDoTime, mensagemDoPrimeiroContato, reservaDoTime, type FrenteDoPrimeiro, type ReservaDoTime } from '../src/operations/primeiro-contato.ts';
import { tetoDoDia, REGRAS_DO_RITMO } from '../src/operations/trava-de-ritmo.ts';
import { respostasDoDia } from './respostas-do-dia.ts';
import { criarProtecaoProspeccao, lerPausaAutomatica, RetomadaRecusada, type SinalDaConta } from './protecao-prospeccao.ts';
import { noExpedienteDeVenda } from '../src/operations/trava-de-horario.ts';
import { conferirMensagem } from './gate-de-envio.ts';
import type { MemoriaDaVenda } from './venda-do-dia.ts';
import type { RodadaComercial } from './rodada-comercial.ts';

/**
 * O time comercial na Central (19/10/2026). O time em si roda no Dell (deploy/dell/frente-comercial.py,
 * timer desligado por padrão): avalia leads novos de Site, PRUMO, Iris e Estamparia com três agentes e manda o primeiro contato pelo
 * número do PRUMO. Daqui saem só leitura e a reserva:
 *
 *  - GET /crm/frente: o estado que o time grava, sem segredo nem número (para a tela).
 *  - POST /crm/frente/config: ligar ou pausar o time ({ ativo }), só da mesma origem.
 *  - POST /crm/frente/reservar: o time pede para fazer o primeiro contato de UM lead. A Central decide
 *    com a mesma janela e o mesmo ritmo das telas e do Telegram (src/operations/primeiro-contato.ts),
 *    confere a mensagem da fonte no gate de envio em modo "bloquear" e, podendo, grava o primeiro
 *    do dia `por: "time"` no mesmo passo. Sem reserva, o time não envia.
 *
 * Plus é enviado pelo Rômulo, no teste de rede quente da Fase 0. Site usa o clique rastreado do n8n antes do envio. Os convites são anotados após o recibo
 * do WhatsApp. Esta rota não fala com a integração de mensagens.
 */
const CONFIG = 'frente-comercial-config.json';
const ESTADO = 'frente-comercial.json';

const lerJson = (arquivo: string) => fs.readFile(arquivo, 'utf8').then(JSON.parse).catch(() => null);

/**
 * O time tem dois interruptores: `ativo` na config (o que a tela liga e pausa) e o frente-comercial.timer
 * do systemd (que roda o script a cada minuto). Com `ativo: true` e o timer parado a tela dizia "ativo"
 * e nada rodava (19/10/2026). A prova de que o ciclo anda é a hora que o próprio script grava a cada
 * rodada: sem rodada há mais que isto, dentro do expediente, o ciclo está parado.
 */
export const CICLO_PARADO_APOS_MS = 5 * 60_000;

/** A fila do time do disco, para o predicado de quem faz o primeiro contato. Ilegível = sem time. */
export async function lerFrenteDoPrimeiro(dataDir: string): Promise<FrenteDoPrimeiro> {
  return frenteDosArquivos(await lerJson(path.join(dataDir, CONFIG)), await lerJson(path.join(dataDir, ESTADO)));
}

/** Os leads cujo primeiro contato é do time agora (a Próxima venda e o vendedor do Telegram os tiram da fila). */
export async function lerPrimeirosDoTime(dataDir: string): Promise<Set<string>> {
  return primeirosDoTime(await lerFrenteDoPrimeiro(dataDir));
}

/** Estado derivado do serviço de domínio. Nenhum segredo ou comando chega ao navegador. */
export async function lerFrente(dataDir: string, agora = Date.now(), visao?: Pick<CrmVisao, 'estado' | 'leads'> | null) {
  const config = (await lerJson(path.join(dataDir, CONFIG))) ?? { ativo: false };
  const bruto = await lerJson(path.join(dataDir, ESTADO));
  const pausaAutomatica = await lerPausaAutomatica(dataDir);
  // O teto é o da trava de ritmo da Central, dividido com as telas e o Telegram: não é uma cota do time.
  const limite = tetoDoDia(agora);
  const respostasHoje = visao?.estado === 'ok' ? respostasDoDia(visao.leads, agora) : null;
  const metricas = { respostasHoje, pausaAutomatica, intervaloMinutos: REGRAS_DO_RITMO.intervaloMs / 60_000, porHora: REGRAS_DO_RITMO.porHora };
  const ativo = config.ativo === true && !pausaAutomatica;
  // A última rodada: a hora gravada pelo script (`atualizadoEm`); sem ela legível, o mtime do arquivo de estado.
  const gravada = bruto ? Date.parse(bruto.atualizadoEm) : NaN;
  const ultimaRodada = Number.isFinite(gravada) ? gravada : bruto ? await fs.stat(path.join(dataDir, ESTADO)).then((st) => st.mtimeMs).catch(() => null) : null;
  const ultimaRodadaEm = ultimaRodada === null ? null : new Date(ultimaRodada).toISOString();
  const cicloParado = ativo && noExpedienteDeVenda(agora) && (ultimaRodada === null || agora - ultimaRodada > CICLO_PARADO_APOS_MS);
  if (!bruto) return { ...metricas, ativo, estado: pausaAutomatica ? 'pausado' : 'iniciando', detalhe: pausaAutomatica?.detalhe ?? '', limite, fila: [], setores: [], funil: [], atualizadoEm: null, ultimaRodadaEm, cicloParado };
  const stale = !Number.isFinite(Date.parse(bruto.atualizadoEm)) || agora - Date.parse(bruto.atualizadoEm) > 10 * 60_000;
  return {
    ...metricas,
    ativo, estado: pausaAutomatica ? 'pausado' : stale ? 'sem-sinal' : config.ativo === false ? 'pausado' : bruto.estado,
    cicloParado, ultimaRodadaEm,
    limite, dia: bruto.dia, atualizadoEm: bruto.atualizadoEm,
    avaliados: bruto.avaliados ?? 0, selecionados: bruto.selecionados ?? 0,
    enviados: bruto.enviados ?? 0, respondidos: respostasHoje?.humanas ?? null,
    funil: (Array.isArray(bruto.funil) ? bruto.funil : []).slice(0, 5).map((m: Record<string, unknown>) => ({
      produto: ['site', 'prumo', 'iris', 'estampa', 'plus'].includes(String(m.produto)) ? m.produto : 'desconhecido',
      ...Object.fromEntries(['novo', 'contato', 'proposta', 'ganho', 'perdido', 'elegiveis', 'contatosObservados', 'respostasWhatsapp'].map(k => [k, typeof m[k] === 'number' ? m[k] : 0])),
      taxaResposta: typeof m.taxaResposta === 'number' ? m.taxaResposta : null,
    })),
    setores: (Array.isArray(bruto.setores) ? bruto.setores : []).slice(0, 30).map((s: Record<string, unknown>) => ({
      setor: typeof s.setor === 'string' ? s.setor.slice(0, 60) : 'Nicho não informado',
      avaliados: typeof s.avaliados === 'number' ? s.avaliados : 0,
      selecionados: typeof s.selecionados === 'number' ? s.selecionados : 0,
      enviados: typeof s.enviados === 'number' ? s.enviados : 0,
    })),
    proximoEnvioEm: pausaAutomatica ? null : bruto.proximoEnvioEm ?? null,
    detalhe: pausaAutomatica?.detalhe ?? (typeof bruto.detalhe === 'string' ? bruto.detalhe.slice(0, 400) : ''),
    fila: (Array.isArray(bruto.fila) ? bruto.fila : []).slice(0, 100).map((l: Record<string, unknown>) => ({
      id: l.id, empresa: l.empresa, produto: l.produto, setor: l.setor, nota: l.nota, estado: l.estado, motivo: l.motivo,
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
  rodada?: RodadaComercial;
  saude?: () => Promise<'open' | SinalDaConta | null>;
  vigiar?: boolean;
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
  const protecao = criarProtecaoProspeccao({ dir: dataDir, agora, visao: deps.visao, saude: deps.saude, avaliarSilencio: !deps.rodada });
  const relogios: ReturnType<typeof setTimeout>[] = [];
  if (deps.vigiar) {
    const conferir = () => { void protecao.verificar().catch(() => console.error('[frente] proteção não pôde ser conferida; envios exigem nova verificação.')); };
    relogios.push(setTimeout(conferir, 0), setInterval(conferir, 60_000));
    relogios.forEach(r => r.unref());
  }
  router.get('/crm/frente', async (_req, res, next) => {
    try {
      const visao = deps.visao ? await deps.visao().catch(() => null) : null;
      await protecao.verificar(visao);
      const rodada = deps.rodada && visao?.estado === 'ok' ? await deps.rodada.status(visao.leads) : null;
      res.set('Cache-Control', 'no-store').json({ ...await lerFrente(dataDir, agora(), visao), ...(deps.rodada ? { rodada, rodadaIndisponivel: !rodada } : {}) });
    } catch (e) { next(e); }
  });
  router.post('/crm/frente/rodada/revisar', express.json({ limit:'4kb' }), async (req,res) => {
    if (!mesmaOrigem(req)) return void res.status(403).json({ error:'Revise na própria Central.' });
    const { motivo, inicioAnterior } = req.body ?? {};
    if (!deps.rodada || !deps.visao) return void res.status(503).json({ error:'Controle da rodada indisponível.' });
    if (typeof motivo !== 'string' || !motivo.trim() || motivo.length > 400 || !(inicioAnterior === null || typeof inicioAnterior === 'string')) return void res.status(400).json({ error:'Registre o motivo e confira a rodada atual.' });
    try {
      const visao = await deps.visao();
      if (visao.estado !== 'ok') return void res.status(503).json({ error:'CRM indisponível; não foi iniciada uma nova rodada.' });
      res.json(await deps.rodada.revisar(motivo,inicioAnterior,visao.leads));
    } catch (e) { res.status(409).json({ error:e instanceof Error ? e.message : 'Não foi possível revisar a rodada.' }); }
  });
  router.post('/crm/frente/config', express.json({ limit: '4kb' }), async (req, res, next) => {
    try {
      if (!mesmaOrigem(req)) return res.status(403).json({ error: 'Confirme a configuração na própria Central.' });
      if (Object.keys(req.body ?? {}).length !== 1 || typeof req.body.ativo !== 'boolean') return res.status(400).json({ error: 'Informe se o time deve iniciar primeiros contatos.' });
      return res.json(await protecao.configurar(req.body.ativo));
    } catch (e) {
      if (e instanceof RetomadaRecusada) return res.status(409).json({ error: e.message });
      return next(e);
    }
  });
  // O executor só relata sinais limitados da própria integração; nenhum payload bruto é persistido.
  router.post('/crm/frente/sinal', express.json({ limit: '1kb' }), async (req, res, next) => {
    try {
      if (!mesmaOrigem(req) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return res.status(403).json({ error: 'Sinal disponível somente na integração local.' });
      if (Object.keys(req.body ?? {}).length !== 1 || !['restricao', 'recusa', 'desconectado'].includes(req.body?.sinal)) return res.status(400).json({ error: 'Sinal inválido.' });
      return res.json({ pausaAutomatica: await protecao.verificar(null, req.body.sinal) });
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
      const pausa = await protecao.verificar(visao);
      if (pausa) return void res.json({ reservado: false, motivo: 'pausa', ate: pausa.revisarApos, detalhe: pausa.detalhe });
      const frente = await lerFrenteDoPrimeiro(dataDir);
      const lead = visao.leads.find((l) => l.id === leadId);
      const texto = mensagemDoPrimeiroContato(lead);
      // O texto da fonte é conferido na reserva, junto com o destino e o retrato atual.
      const gate = lead && texto
        ? conferirMensagem(texto, { modo: 'bloquear', tipo: 'primeiro', nome: lead.empresa, destino: { link: lead.produto === 'site' ? undefined : lead.produto === 'plus' ? lead.links.enviar : lead.links.convite, registro: lead.links.whatsapp } })
        : null;
      const reservar = () => deps.memoriaDaVenda.reservarPrimeiro(leadId, (dia) => reservaDoTime({
        leadId, lead, frente, leads: visao.leads, primeiros: dia.primeiros, mensagemAprovada: Boolean(gate && !gate.bloqueia), agora: agora(),
      }));
      const r = deps.rodada && lead ? await deps.rodada.reservar(lead,visao.leads,reservar) : await reservar();
      if (r.ok === false) return void res.json({ reservado: false, motivo: r.motivo, ate: r.ate === null ? null : new Date(r.ate).toISOString() });
      res.json({ reservado: true, texto });
    } catch (error) {
      console.error('[frente] reserva não gravou:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ reservado: false, error: 'Não deu para reservar agora.' });
    }
  });
  return { pararProtecao: () => relogios.forEach(r => clearTimeout(r)) };
}
