import express from "express";
import { guardaDeIdentidade, guardaDeOrigem, veioPeloServe } from "../acesso.ts";
import type { Aviso } from "../avisos.ts";
import { estadoDaSala } from "./alertas.ts";
import { abrirBanco, FinancasIndisponiveis, type BancoDeFinancas } from "./banco.ts";
import { SEM_CATEGORIA } from "./categoria.ts";
import { ehMes, estabelecimentoDe, mesDe } from "./comum.ts";
import { jaExisteEmOutraFonte, parearEntreFontes } from "./dedupe.ts";
import { ExtratoIlegivel, lerExtrato, sugereInverter, transacoesDoExtrato, type FormatoDoExtrato } from "./extrato.ts";
import { conferir, faturaDoPdf, lerFaturaSantander, transacoesDoPdf } from "./fatura-santander.ts";
import {
  ehFixa,
  fimDoMes,
  nomeDeCategoria,
  NomeDeCategoriaInvalido,
  nomeExistente,
  recorrentesAte,
  renomesDepois,
} from "./organizacao.ts";
import { linhasDoPdf } from "./pdf-texto.ts";
import { criarClienteDaPluggy, lerConfigDaPluggy, PluggyMalConfigurado } from "./pluggy.ts";
import { contextoDas } from "./processar.ts";
import { CONTA_MANUAL } from "./resumo.ts";
import { categoriasDoBanco, criarAvisador, depoisDeEscrever, hojeEm, horaEm, resumoDoBanco, type Avisador } from "./servico.ts";
import { criarSincronizador, leituraDiariaDevida, reprocessar, type Sincronizador } from "./sync.ts";
import { NATUREZAS, type Natureza } from "./tipos.ts";
import { gastoNaVisao, mesDaFatura, type Visao } from "./visoes.ts";

/**
 * `/api/financas/*`, só no perfil `operations` (Dell). Leitura do banco local
 * e os gestos do Rômulo: "Atualizar agora" (cópia da fonte, RULES 10), as
 * importações (fatura do Santander em PDF, extrato OFX/CSV de reserva, as duas
 * com prévia antes de gravar) e a organização (categoria, regra por
 * estabelecimento, orçamento, recorrente).
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
 * nada daqui vai a log (só contagens e status), Telegram, Hermes ou ao modelo.
 * Os alertas de 70/90/100% vão à fila de avisos só com semáforo e %
 * (`alertas.ts`). `Cache-Control: no-store`: o celular não guarda extrato em
 * cache.
 */

export const LIMITE_PDF = "10mb";
export const LIMITE_EXTRATO = "5mb";
const MAX_LANCAMENTOS_POR_PAGINA = 200;
const MAX_PREVIA_EXTRATO = 500;
/** Orçamento acima disto por categoria é erro de digitação (centavos digitados como reais). */
const MAX_ORCAMENTO_CENTAVOS = 100_000_000;

export interface EstadoDasFinancas {
  banco: BancoDeFinancas | null;
  sincronizador: Sincronizador | null;
  /** Alertas de 70/90/100% na fila de avisos; null sem banco. */
  avisador: Avisador | null;
  /** Por que o banco ou a Pluggy não estão disponíveis (texto para a tela, sem segredo). */
  problema: string | null;
}

export async function prepararFinancas(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  opcoes: { publicar?: (a: Aviso) => Promise<unknown> } = {},
): Promise<EstadoDasFinancas> {
  let banco: BancoDeFinancas;
  try {
    banco = await abrirBanco(dataDir);
  } catch (erro) {
    const mensagem = erro instanceof FinancasIndisponiveis ? erro.message : `Não foi possível abrir o financas.db (${(erro as Error)?.name ?? "erro"}).`;
    console.error(`[financas] desligadas: ${mensagem}`);
    return { banco: null, sincronizador: null, avisador: null, problema: mensagem };
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
  const avisador = criarAvisador({ banco, publicar: opcoes.publicar });
  const sincronizador = criarSincronizador({
    banco,
    cliente: config ? criarClienteDaPluggy(config) : null,
    itemIds: config?.itemIds ?? [],
    depois: () => avisador.avisar(),
  });
  // O que o código novo deriva (regras, renomes) vale já, sem esperar a leitura diária.
  try {
    reprocessar(banco);
  } catch (erro) {
    console.error(`[financas] falha ao reprocessar no boot (${(erro as Error)?.name ?? "erro"})`);
  }
  console.log(`[financas] banco aberto; Pluggy ${config ? `com ${config.itemIds.length} conexão(ões)` : "desligada"}; alertas ${opcoes.publicar ? "pela fila de avisos" : "desligados"}.`);
  return { banco, sincronizador, avisador, problema };
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

/** Pedido que não faz sentido: 400 com a mensagem. */
class PedidoFinanceiroInvalido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PedidoFinanceiroInvalido";
  }
}

/** O texto do arquivo: UTF-8, ou Latin-1 quando o UTF-8 não lê (o OFX dos bancos daqui costuma vir em 1252). */
function textoDoArquivo(b: Buffer): string {
  const utf8 = b.toString("utf8");
  return utf8.includes("�") ? b.toString("latin1") : utf8;
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
  // As escritas de organização mandam JSON pequeno. O server.ts já lê JSON
  // antes; aqui é para as rotas funcionarem sozinhas (teste) — o body-parser
  // não lê duas vezes.
  router.use(express.json({ limit: "64kb" }));

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

  /** Uma escrita de organização: valida, grava, reprocessa, copia e confere os alertas. */
  function escrever(res: express.Response, gravar: () => Record<string, unknown> | void) {
    try {
      const corpo = gravar() ?? {};
      depoisDeEscrever(banco(), estado.avisador);
      res.json({ ok: true, ...corpo });
    } catch (erro) {
      if (erro instanceof PedidoFinanceiroInvalido || erro instanceof NomeDeCategoriaInvalido) {
        res.status(400).json({ error: erro.message });
        return;
      }
      console.error(`[financas] falha ao gravar a organização (${(erro as Error)?.name ?? "erro"})`);
      res.status(500).json({ error: "Não foi possível gravar agora." });
    }
  }

  /** Nome de categoria que um lançamento, regra ou orçamento pode receber: nem fixa, e com a grafia que já existe. */
  function categoriaEscolhivel(valor: unknown, existentes: readonly string[]): string {
    const nome = nomeDeCategoria(valor);
    if (ehFixa(nome) && nome !== SEM_CATEGORIA) throw new PedidoFinanceiroInvalido(`"${nome}" vem da natureza do lançamento e não se escolhe à mão.`);
    return nomeExistente(nome, existentes) ?? nome;
  }

  router.get("/visao", (req, res) => {
    const hoje = hojeEm(agora());
    const mes = ehMes(req.query.mes) ? req.query.mes : mesDe(hoje);
    const visao: Visao = req.query.visao === "caixa" ? "caixa" : "competencia";
    try {
      res.json({ ...resumoDoBanco(banco(), hoje, mes, visao), ...situacao() });
    } catch (erro) {
      console.error(`[financas] falha ao montar a visão (${(erro as Error)?.name ?? "erro"})`);
      res.status(500).json({ error: "Não foi possível montar a visão agora." });
    }
  });

  // O estado do agente da Sala Finanças no escritório: só % e semáforo.
  router.get("/estado", (_req, res) => {
    const hoje = hojeEm(agora());
    try {
      const r = resumoDoBanco(banco(), hoje, mesDe(hoje), "competencia");
      res.json({ ...estadoDaSala(r), dadosAte: r.saude.dadosAte });
    } catch (erro) {
      console.error(`[financas] falha ao montar o estado da sala (${(erro as Error)?.name ?? "erro"})`);
      res.status(500).json({ error: "Não foi possível montar o estado agora." });
    }
  });

  router.get("/lancamentos", (req, res) => {
    const b = banco();
    const contas = b.contas();
    const faturas = b.faturas();
    const ctx = contextoDas(contas, faturas);
    const org = b.organizacao();
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
    const hoje = hojeEm(agora());
    const recorrentes = new Set(
      recorrentesAte(todas, fimDoMes(mesDe(hoje)), org.marcasDeRecorrente, (t) => gastoNaVisao(t, "competencia", ctx)?.centavos ?? null).lista.map((r) => r.estabelecimento),
    );
    const categorias = categoriasDoBanco(b, org, todas);
    res.json({
      total: filtradas.length,
      somaCentavos: filtradas.reduce((s, t) => s + t.centavos, 0),
      offset,
      lancamentos: filtradas.slice(offset, offset + MAX_LANCAMENTOS_POR_PAGINA).map((t) => {
        const estabelecimento = estabelecimentoDe(t.descricao);
        return {
          id: t.id,
          data: t.dataLancamento,
          dataCompra: t.dataCompra,
          descricao: t.descricao,
          centavos: t.centavos,
          natureza: t.natureza,
          categoria: t.categoria,
          origemCategoria: t.origemCategoria,
          estabelecimento,
          temRegra: org.regras.has(estabelecimento),
          recorrente: recorrentes.has(estabelecimento),
          marcaDeRecorrente: org.marcasDeRecorrente.get(estabelecimento) ?? null,
          contaId: t.contaId,
          conta: nomes.get(t.contaId) ?? "",
          parcela: t.parcelaTotal ? `${t.parcelaN}/${t.parcelaTotal}` : null,
          pendente: t.status === "pendente",
          fonte: t.fonte,
          cartaoFinal: t.cartaoFinal,
        };
      }),
      contas: contas.map((c) => ({ id: c.id, nome: nomes.get(c.id), tipo: c.tipo })),
      categorias,
      categoriasEscolhiveis: categorias.filter((c) => !ehFixa(c) || c === SEM_CATEGORIA),
      ...situacao(),
    });
  });

  // --- Organização --------------------------------------------------

  router.get("/organizacao", (_req, res) => {
    const b = banco();
    const org = b.organizacao();
    const todas = b.transacoes();
    const uso = new Map<string, number>();
    for (const t of todas) uso.set(t.categoria, (uso.get(t.categoria) ?? 0) + 1);
    const porEstabelecimento = new Map<string, number>();
    for (const t of todas) {
      const e = estabelecimentoDe(t.descricao);
      if (org.regras.has(e)) porEstabelecimento.set(e, (porEstabelecimento.get(e) ?? 0) + 1);
    }
    res.json({
      categorias: categoriasDoBanco(b, org, todas).map((nome) => ({
        nome,
        lancamentos: uso.get(nome) ?? 0,
        orcamentoCentavos: org.orcamentos.get(nome) ?? null,
        fixa: ehFixa(nome),
      })),
      regras: [...org.regras]
        .map(([estabelecimento, categoria]) => ({ estabelecimento, categoria, lancamentos: porEstabelecimento.get(estabelecimento) ?? 0 }))
        .sort((a, b) => a.estabelecimento.localeCompare(b.estabelecimento, "pt-BR")),
      ...situacao(),
    });
  });

  router.post("/categorias", (req, res) => {
    escrever(res, () => {
      const existentes = categoriasDoBanco(banco());
      const nome = categoriaEscolhivel(req.body?.nome, existentes);
      if (nomeExistente(nome, existentes)) throw new PedidoFinanceiroInvalido(`Já existe a categoria "${nomeExistente(nome, existentes)}".`);
      banco().criarCategoria(nome, agora().toISOString());
      return { categoria: nome };
    });
  });

  // Renomear para um nome que já existe JUNTA as duas.
  router.post("/categorias/renomear", (req, res) => {
    escrever(res, () => {
      const b = banco();
      const org = b.organizacao();
      const existentes = categoriasDoBanco(b, org);
      const de = nomeExistente(nomeDeCategoria(req.body?.de), existentes);
      if (!de) throw new PedidoFinanceiroInvalido("Essa categoria não existe mais. Recarregue a tela.");
      if (ehFixa(de)) throw new PedidoFinanceiroInvalido(`"${de}" é fixa: não se renomeia.`);
      const para = categoriaEscolhivel(req.body?.para, existentes.filter((c) => c !== de));
      if (para === de) return { categoria: de };
      b.renomearCategoria(de, para, renomesDepois(org.renomes, de, para), agora().toISOString());
      console.log("[financas] categoria renomeada.");
      return { categoria: para, juntou: existentes.includes(para) };
    });
  });

  // Remover = juntar em "Outros": nenhum lançamento fica sem categoria.
  router.post("/categorias/remover", (req, res) => {
    escrever(res, () => {
      const b = banco();
      const org = b.organizacao();
      const de = nomeExistente(nomeDeCategoria(req.body?.nome), categoriasDoBanco(b, org));
      if (!de) throw new PedidoFinanceiroInvalido("Essa categoria não existe mais. Recarregue a tela.");
      if (ehFixa(de)) throw new PedidoFinanceiroInvalido(`"${de}" é fixa: não se remove.`);
      b.renomearCategoria(de, SEM_CATEGORIA, renomesDepois(org.renomes, de, SEM_CATEGORIA), agora().toISOString());
      return { categoria: SEM_CATEGORIA };
    });
  });

  // Corrigir a categoria de um lançamento; `aplicarSempre` vira regra do estabelecimento.
  router.patch("/lancamentos/:id", (req, res) => {
    escrever(res, () => {
      const b = banco();
      const t = b.transacao(req.params.id);
      if (!t) throw new PedidoFinanceiroInvalido("Esse lançamento não existe mais. Recarregue a tela.");
      const categoria = categoriaEscolhivel(req.body?.categoria, categoriasDoBanco(b));
      b.definirCategoria(t.id, categoria);
      const estabelecimento = estabelecimentoDe(t.descricao);
      const regra = req.body?.aplicarSempre === true && estabelecimento !== "";
      if (regra) b.gravarRegra(estabelecimento, categoria, agora().toISOString());
      return { categoria, regra: regra ? estabelecimento : null };
    });
  });

  router.post("/regras/remover", (req, res) => {
    escrever(res, () => {
      const estabelecimento = typeof req.body?.estabelecimento === "string" ? req.body.estabelecimento : "";
      if (!banco().removerRegra(estabelecimento)) throw new PedidoFinanceiroInvalido("Essa regra não existe mais. Recarregue a tela.");
    });
  });

  // Orçamento mensal de uma categoria; `centavos: null` tira.
  router.put("/orcamento", (req, res) => {
    escrever(res, () => {
      const b = banco();
      const categoria = categoriaEscolhivel(req.body?.categoria, categoriasDoBanco(b));
      const valor = req.body?.centavos;
      if (valor === null) {
        b.definirOrcamento(categoria, null);
        return { categoria, centavos: null };
      }
      if (!Number.isInteger(valor) || valor <= 0 || valor > MAX_ORCAMENTO_CENTAVOS) {
        throw new PedidoFinanceiroInvalido("Orçamento é um valor positivo em centavos.");
      }
      b.definirOrcamento(categoria, valor);
      return { categoria, centavos: valor };
    });
  });

  // Marcar ou desmarcar como recorrente; `recorrente: null` volta para a detecção.
  router.put("/recorrentes", (req, res) => {
    escrever(res, () => {
      const estabelecimento = typeof req.body?.estabelecimento === "string" ? req.body.estabelecimento.trim() : "";
      const valor = req.body?.recorrente;
      if (!estabelecimento || estabelecimento.length > 120) throw new PedidoFinanceiroInvalido("Estabelecimento inválido.");
      if (valor !== true && valor !== false && valor !== null) throw new PedidoFinanceiroInvalido("'recorrente' é true, false ou null.");
      banco().marcarRecorrente(estabelecimento, valor, agora().toISOString());
      return { estabelecimento, recorrente: valor };
    });
  });

  // O que os alertas de 70/90/100% mandariam agora, sem gravar na fila nem marcar como avisado.
  router.post("/alertas/simular", (_req, res) => {
    try {
      res.json({ alertas: estado.avisador?.simular().map((a) => ({ ...a.aviso })) ?? [] });
    } catch (erro) {
      console.error(`[financas] falha ao simular os alertas (${(erro as Error)?.name ?? "erro"})`);
      res.status(500).json({ error: "Não foi possível simular agora." });
    }
  });

  // --- Leitura e importação -----------------------------------------

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

  // Extrato OFX ou CSV de RESERVA, para quando uma conexão da Pluggy parar.
  // Sem `confirmar`: lê e mostra o que é novo (nada é gravado). Com
  // `confirmar=1`: grava só o que não está nem na própria fonte (chave) nem na
  // Pluggy ou em outro extrato (`parearEntreFontes`).
  router.post("/importar/extrato", express.raw({ type: () => true, limit: LIMITE_EXTRATO }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Envie o arquivo do extrato (OFX ou CSV)." });
      return;
    }
    const b = banco();
    const contas = b.contas().filter((c) => c.id !== CONTA_MANUAL && c.tipo !== "investimento");
    const conta = contas.find((c) => c.id === req.query.conta);
    if (!conta) {
      res.status(400).json({
        error: "Escolha de que conta é o extrato.",
        escolherConta: true,
        contas: contas.map((c) => ({ id: c.id, nome: c.final ? `${c.nome} ·${c.final}` : c.nome, tipo: c.tipo })),
      });
      return;
    }
    const formato: FormatoDoExtrato | undefined = req.query.formato === "ofx" || req.query.formato === "csv" ? req.query.formato : undefined;
    let extrato: ReturnType<typeof lerExtrato>;
    try {
      extrato = lerExtrato(textoDoArquivo(req.body), formato);
    } catch (erro) {
      res.status(422).json({ error: erro instanceof ExtratoIlegivel ? erro.message : "Não consegui ler este arquivo." });
      return;
    }
    if (extrato.linhas.length === 0) {
      res.status(422).json({ error: "Nenhum lançamento lido neste arquivo." });
      return;
    }
    const sugere = conta.tipo === "cartao" && sugereInverter(extrato.linhas);
    const inverter = req.query.inverter === "1" ? true : req.query.inverter === "0" ? false : sugere;
    const candidatas = transacoesDoExtrato(extrato, conta.id, inverter);
    const existentes = b.transacoesDasContas([conta.id]);
    const chaves = new Set(existentes.map((t) => t.chaveDedupe));
    const foraDaFonte = candidatas.filter((t) => !chaves.has(t.chaveDedupe));
    const emOutraFonte = parearEntreFontes(foraDaFonte, existentes);
    const novas = foraDaFonte.filter((t) => !emOutraFonte.has(t.id));
    const idsNovos = new Set(novas.map((t) => t.id));
    const datas = candidatas.map((t) => t.dataCompra).sort();
    const previa = {
      conta: { id: conta.id, nome: conta.final ? `${conta.nome} ·${conta.final}` : conta.nome, tipo: conta.tipo },
      formato: extrato.formato,
      lidos: candidatas.length,
      novos: novas.length,
      jaEstavam: candidatas.length - novas.length,
      ignoradas: extrato.ignoradas,
      invertido: inverter,
      sugereInverter: sugere,
      periodo: { de: datas[0], ate: datas.at(-1) },
      lancamentos: candidatas.slice(0, MAX_PREVIA_EXTRATO).map((t) => ({ data: t.dataCompra, descricao: t.descricao, centavos: t.centavos, novo: idsNovos.has(t.id) })),
    };
    if (req.query.confirmar !== "1") {
      res.json({ ...previa, gravado: false });
      return;
    }
    try {
      b.inserirTransacoes(novas);
      depoisDeEscrever(b, estado.avisador);
      console.log(`[financas] extrato ${extrato.formato} importado: ${novas.length} novo(s), ${previa.jaEstavam} já estava(m).`);
      res.status(201).json({ ...previa, gravado: true });
    } catch (erro) {
      console.error(`[financas] falha ao gravar o extrato (${(erro as Error)?.name ?? "erro"})`);
      res.status(500).json({ error: "Não foi possível gravar agora." });
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
      depoisDeEscrever(b, estado.avisador);
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
