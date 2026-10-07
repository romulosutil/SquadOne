import express from "express";
import { guardaDeIdentidade, guardaDeOrigem, veioPeloServe } from "../acesso.ts";
import { FUSO } from "../alocador.ts";
import { abrirBanco, FinancasIndisponiveis, type BancoDeFinancas } from "./banco.ts";
import { ehMes, mesDe } from "./comum.ts";
import { jaExisteEmOutraFonte } from "./dedupe.ts";
import { conferir, faturaDoPdf, lerFaturaSantander, transacoesDoPdf } from "./fatura-santander.ts";
import { linhasDoPdf } from "./pdf-texto.ts";
import { criarClienteDaPluggy, lerConfigDaPluggy, PluggyMalConfigurado } from "./pluggy.ts";
import { contextoDas } from "./processar.ts";
import { resumir } from "./resumo.ts";
import { criarSincronizador, leituraDiariaDevida, reprocessar, type Sincronizador } from "./sync.ts";
import { NATUREZAS, type Natureza } from "./tipos.ts";
import { mesDaFatura, type Visao } from "./visoes.ts";

/**
 * `/api/financas/*`, só no perfil `operations` (Dell). Leitura do banco local
 * e dois gestos do Rômulo: "Atualizar agora" (cópia da fonte, RULES 10) e a
 * importação da fatura em PDF do Santander (escrita de domínio por gesto,
 * com conferência antes).
 *
 * Travas (RULES 7), além do porteiro de IP que já vem antes:
 * - quem chega pelo Tailscale Serve precisa de um `Tailscale-User-Login` da
 *   lista `SQUADONE_LOGINS_TAILSCALE`; lista vazia FECHA aqui, e é de
 *   propósito: finanças não abrem para a tailnet inteira por esquecimento;
 *   Funnel nunca passa (`guardaDeIdentidade`);
 * - toda escrita exige a mesma origem (`guardaDeOrigem`: `Origin` com host e
 *   porta do `Host`, e `Sec-Fetch-Site: same-origin` quando vem).
 *
 * Privacidade (RULES 24): as respostas levam R$ porque são a TELA do app;
 * nada daqui vai a log (só contagens e status), push, Telegram, Hermes ou ao
 * modelo. `Cache-Control: no-store`: o celular não guarda extrato em cache.
 */

export const LIMITE_PDF = "10mb";
const MAX_LANCAMENTOS_POR_PAGINA = 200;

function hojeEm(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

function horaEm(agora: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", hourCycle: "h23" }).format(agora));
}

export interface EstadoDasFinancas {
  banco: BancoDeFinancas | null;
  sincronizador: Sincronizador | null;
  /** Por que o banco ou a Pluggy não estão disponíveis (texto para a tela, sem segredo). */
  problema: string | null;
}

export async function prepararFinancas(dataDir: string, env: NodeJS.ProcessEnv = process.env): Promise<EstadoDasFinancas> {
  let banco: BancoDeFinancas;
  try {
    banco = await abrirBanco(dataDir);
  } catch (erro) {
    const mensagem = erro instanceof FinancasIndisponiveis ? erro.message : `Não foi possível abrir o financas.db (${(erro as Error)?.name ?? "erro"}).`;
    console.error(`[financas] desligadas: ${mensagem}`);
    return { banco: null, sincronizador: null, problema: mensagem };
  }
  let problema: string | null = null;
  let config: ReturnType<typeof lerConfigDaPluggy> = null;
  try {
    config = lerConfigDaPluggy(env);
  } catch (erro) {
    problema = erro instanceof PluggyMalConfigurado ? `Pluggy mal configurada: ${erro.message}` : "Pluggy mal configurada.";
    console.error(`[financas] ${problema}`);
  }
  if (!config && !problema) problema = "Pluggy não configurada (financas.env sem PLUGGY_*).";
  const sincronizador = criarSincronizador({
    banco,
    cliente: config ? criarClienteDaPluggy(config) : null,
    itemIds: config?.itemIds ?? [],
  });
  console.log(`[financas] banco aberto; Pluggy ${config ? `com ${config.itemIds.length} conexão(ões)` : "desligada"}.`);
  return { banco, sincronizador, problema };
}

/** Polling diário (o webhook da Pluggy exigiria URL pública). Confere a cada 30 min; roda depois das 7h. */
export function iniciarLeituraDiaria(estado: EstadoDasFinancas, agora: () => Date = () => new Date()) {
  const { banco, sincronizador } = estado;
  if (!banco || !sincronizador?.configurado()) return null;
  const conferir = () => {
    const t = agora();
    if (sincronizador.emAndamento()) return;
    if (!leituraDiariaDevida(t, banco.ultimaSincronizacaoOk(), banco.ultimaSincronizacao()?.fim ?? null, horaEm(t))) return;
    sincronizador.sincronizar("diaria").catch(() => {
      // O sincronizador já logou e gravou a falha; a tela mostra.
    });
  };
  const primeira = setTimeout(conferir, 60_000);
  const laco = setInterval(conferir, 30 * 60_000);
  primeira.unref();
  laco.unref();
  return () => {
    clearTimeout(primeira);
    clearInterval(laco);
  };
}

export function criarRotasDeFinancas(estado: EstadoDasFinancas, opcoes: { logins: ReadonlySet<string>; agora?: () => Date }): express.Router {
  const router = express.Router();
  const agora = opcoes.agora ?? (() => new Date());

  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (veioPeloServe(req) && opcoes.logins.size === 0) {
      res.status(403).json({ error: "Finanças fechadas pela tailnet: falta SQUADONE_LOGINS_TAILSCALE no operations.env.", configuracao: true });
      return;
    }
    next();
  });
  // A mesma guarda que o server.ts liga para o processo inteiro quando a
  // agenda está aqui ou a lista existe: repetida aqui para as finanças nunca
  // dependerem dessa decisão.
  router.use(guardaDeIdentidade(opcoes.logins));
  router.use(guardaDeOrigem());
  router.use((_req, res, next) => {
    if (estado.banco) return next();
    res.status(503).json({ error: estado.problema ?? "Finanças indisponíveis.", financasIndisponiveis: true });
  });

  const banco = () => estado.banco!;

  function situacao() {
    const ultima = banco().ultimaSincronizacao();
    return {
      pluggyConfigurada: estado.sincronizador?.configurado() ?? false,
      problema: estado.problema,
      sincronizando: estado.sincronizador?.emAndamento() ?? false,
      ultimaSincronizacao: ultima,
    };
  }

  router.get("/visao", (req, res) => {
    const hoje = hojeEm(agora());
    const mes = ehMes(req.query.mes) ? req.query.mes : mesDe(hoje);
    const visao: Visao = req.query.visao === "caixa" ? "caixa" : "competencia";
    const b = banco();
    try {
      const resumo = resumir({ contas: b.contas(), faturas: b.faturas(), transacoes: b.transacoes(), conexoes: b.conexoes() }, hoje, mes, visao);
      res.json({ ...resumo, ...situacao() });
    } catch (erro) {
      console.error(`[financas] falha ao montar a visão (${(erro as Error)?.name ?? "erro"})`);
      res.status(500).json({ error: "Não foi possível montar a visão agora." });
    }
  });

  router.get("/lancamentos", (req, res) => {
    const b = banco();
    const contas = b.contas();
    const faturas = b.faturas();
    const ctx = contextoDas(contas, faturas);
    const nomes = new Map(contas.map((c) => [c.id, c.final ? `${c.nome} ·${c.final}` : c.nome]));
    const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const conta = texto(req.query.conta);
    const categoria = texto(req.query.categoria);
    const mes = ehMes(req.query.mes) ? req.query.mes : "";
    const natureza = NATUREZAS.includes(texto(req.query.natureza) as Natureza) ? texto(req.query.natureza) : "";
    const offset = Math.max(0, Number.parseInt(texto(req.query.offset), 10) || 0);
    const todas = b.transacoes();
    const filtradas = todas.filter((t) => {
      if (conta && t.contaId !== conta) return false;
      if (categoria && t.categoria !== categoria) return false;
      if (natureza && t.natureza !== natureza) return false;
      // No cartão, o mês é o da fatura (o mesmo do "gastei"); na conta, o do lançamento.
      if (mes && (ctx.tipoDaConta(t.contaId) === "cartao" ? mesDaFatura(t, ctx) : mesDe(t.dataLancamento)) !== mes) return false;
      return true;
    });
    res.json({
      total: filtradas.length,
      somaCentavos: filtradas.reduce((s, t) => s + t.centavos, 0),
      offset,
      lancamentos: filtradas.slice(offset, offset + MAX_LANCAMENTOS_POR_PAGINA).map((t) => ({
        id: t.id,
        data: t.dataLancamento,
        dataCompra: t.dataCompra,
        descricao: t.descricao,
        centavos: t.centavos,
        natureza: t.natureza,
        categoria: t.categoria,
        contaId: t.contaId,
        conta: nomes.get(t.contaId) ?? "",
        parcela: t.parcelaTotal ? `${t.parcelaN}/${t.parcelaTotal}` : null,
        pendente: t.status === "pendente",
        fonte: t.fonte,
        cartaoFinal: t.cartaoFinal,
      })),
      contas: contas.map((c) => ({ id: c.id, nome: nomes.get(c.id), tipo: c.tipo })),
      categorias: [...new Set(todas.map((t) => t.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
      ...situacao(),
    });
  });

  router.post("/sincronizar", async (_req, res) => {
    if (!estado.sincronizador?.configurado()) {
      res.status(409).json({ error: estado.problema ?? "Pluggy não configurada.", pluggyDesligada: true });
      return;
    }
    try {
      const r = await estado.sincronizador.sincronizar("botao");
      res.json({ ok: r.ok, fim: r.fim, conexoes: r.conexoes.map(({ nome, status, erro }) => ({ nome, status, erro })) });
    } catch (erro) {
      console.error(`[financas] sincronização pelo botão falhou (${(erro as Error)?.name ?? "erro"})`);
      res.status(502).json({ error: "A leitura da Pluggy falhou agora." });
    }
  });

  // Fatura do Santander em PDF. Sem `confirmar`: só lê e confere (nada é
  // gravado). Com `confirmar=1`: grava os lançamentos novos — e só se a
  // conferência bateu, ou se o Rômulo aceitou a diferença (`aceitarDiferenca=1`).
  router.post("/importar/santander", express.raw({ type: "application/pdf", limit: LIMITE_PDF }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Envie o PDF da fatura (application/pdf)." });
      return;
    }
    let linhas: string[];
    try {
      linhas = await linhasDoPdf(new Uint8Array(req.body));
    } catch (erro) {
      if (erro instanceof FinancasIndisponiveis) {
        res.status(503).json({ error: erro.message });
        return;
      }
      res.status(422).json({ error: "Não consegui ler este PDF." });
      return;
    }
    const pdf = lerFaturaSantander(linhas);
    if (pdf.lancamentos.length === 0 && pdf.totalAPagar === null) {
      res.status(422).json({ error: "Não reconheci uma fatura do Santander neste PDF." });
      return;
    }
    const b = banco();
    const cartoes = b.contas().filter((c) => c.tipo === "cartao");
    const doSantander = cartoes.filter((c) => (c.final && pdf.cartoes.includes(c.final)) || /santander/i.test(`${c.instituicao} ${c.nome}`));
    const faturas = b.faturas().filter((f) => doSantander.some((c) => c.id === f.cartaoId));
    const escolhida = typeof req.query.fatura === "string" ? faturas.find((f) => f.id === req.query.fatura) : faturaDoPdf(pdf, faturas);
    if (!escolhida) {
      res.status(409).json({
        error: "Não achei a fatura da Pluggy que corresponde a este PDF. Escolha qual é.",
        escolherFatura: true,
        faturas: faturas.map((f) => ({ id: f.id, vencimento: f.vencimento, totalBanco: f.totalBanco })),
        pdf: { vencimento: pdf.vencimento, totalAPagar: pdf.totalAPagar },
      });
      return;
    }
    const conferencia = conferir(pdf, escolhida);
    const candidatas = transacoesDoPdf(pdf, escolhida);
    const existentes = b.transacoesDasContas([escolhida.cartaoId]);
    const chaves = new Set(existentes.map((t) => t.chaveDedupe));
    const novas = candidatas.filter((t) => !chaves.has(t.chaveDedupe) && !jaExisteEmOutraFonte(t, existentes));
    const previa = {
      fatura: { id: escolhida.id, vencimento: escolhida.vencimento, totalBanco: escolhida.totalBanco },
      conferencia,
      lidos: candidatas.length,
      novos: novas.length,
      lancamentos: candidatas.map((t) => ({
        dataCompra: t.dataCompra,
        descricao: t.descricao,
        centavos: t.centavos,
        parcela: t.parcelaTotal ? `${t.parcelaN}/${t.parcelaTotal}` : null,
        cartaoFinal: t.cartaoFinal,
        novo: novas.includes(t),
      })),
    };
    if (req.query.confirmar !== "1") {
      res.json({ ...previa, gravado: false });
      return;
    }
    if (!conferencia.bate && req.query.aceitarDiferenca !== "1") {
      res.status(409).json({ ...previa, gravado: false, error: "A conferência não bateu com o total do banco.", conferenciaNaoBate: true });
      return;
    }
    try {
      b.inserirTransacoes(novas);
      reprocessar(b);
      b.copiaDeSeguranca();
      console.log(`[financas] fatura em PDF importada: ${novas.length} lançamento(s) novo(s), conferência ${conferencia.bate ? "ok" : "aceita com diferença"}.`);
      res.status(201).json({ ...previa, gravado: true });
    } catch (erro) {
      console.error(`[financas] falha ao gravar a fatura em PDF (${(erro as Error)?.name ?? "erro"})`);
      res.status(500).json({ error: "Não foi possível gravar agora." });
    }
  });

  router.use((_req, res) => {
    res.status(404).json({ error: "Rota de finanças inexistente." });
  });

  return router;
}
