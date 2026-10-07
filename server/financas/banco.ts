import fs from "node:fs";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import type { Conexao, Conta, Fatura, Transacao } from "./tipos.ts";

/**
 * `financas.db`: o banco SÓ das finanças (o roster continua em JSON). Um
 * arquivo SQLite em `SQUADONE_OPERATIONS_DATA_DIR`, permissão 600 (RULES 24),
 * com migrações numeradas em `PRAGMA user_version`.
 *
 * - **600 antes de abrir:** o SQLite cria o `-wal` e o `-shm` com a mesma
 *   permissão do banco, então basta o banco nascer 600. O serviço também roda
 *   com `UMask=0077` (`deploy/dell/squadone-operations.service`).
 * - **Cópia depois de cada sync:** `VACUUM INTO financas.copia.db`, uma foto
 *   consistente que o cofre restic pega; copiar o `.db` vivo no meio de uma
 *   escrita em WAL daria um arquivo corrompido. Nunca cópia em claro no Drive.
 * - **better-sqlite3 é carregado sob demanda** (dependência opcional): o perfil
 *   `app` do Easypanel nunca abre finanças e não precisa do binário nativo.
 */

export const ARQUIVO_DO_BANCO = "financas.db";
export const ARQUIVO_DA_COPIA = "financas.copia.db";

const TIPOS = "'corrente','poupanca','cartao','investimento','dinheiro','beneficio'";
const NATUREZAS = "'despesa','receita','transferencia','pagamento_fatura','estorno','rendimento','encargo'";
const FONTES = "'pluggy','ofx','csv','manual','pdf'";

/** Migrações numeradas: a de índice i leva o banco à versão i + 1. Só acrescentar, nunca editar uma que já rodou. */
export const MIGRACOES: string[] = [
  `CREATE TABLE conexao (
     item_id TEXT PRIMARY KEY,
     nome TEXT NOT NULL,
     status TEXT NOT NULL,
     execution_status TEXT NOT NULL DEFAULT '',
     dados_ate TEXT,
     consentimento_ate TEXT,
     lido_em TEXT,
     erro_leitura TEXT
   );
   CREATE TABLE conta (
     id TEXT PRIMARY KEY,
     item_id TEXT NOT NULL DEFAULT '',
     nome TEXT NOT NULL,
     instituicao TEXT NOT NULL DEFAULT '',
     tipo TEXT NOT NULL CHECK (tipo IN (${TIPOS})),
     saldo_centavos INTEGER NOT NULL,
     limite_centavos INTEGER,
     limite_disponivel_centavos INTEGER,
     final TEXT,
     atualizado_em TEXT NOT NULL,
     ativa INTEGER NOT NULL DEFAULT 1
   );
   CREATE TABLE fatura (
     id TEXT PRIMARY KEY,
     cartao_id TEXT NOT NULL,
     fechamento TEXT,
     vencimento TEXT NOT NULL,
     total_banco INTEGER NOT NULL,
     pago_centavos INTEGER NOT NULL DEFAULT 0,
     encargos_centavos INTEGER NOT NULL DEFAULT 0,
     minimo_centavos INTEGER,
     pagamentos TEXT NOT NULL DEFAULT '[]'
   );
   CREATE INDEX fatura_cartao ON fatura (cartao_id, vencimento);
   CREATE TABLE transacao (
     id TEXT PRIMARY KEY,
     conta_id TEXT NOT NULL,
     fonte TEXT NOT NULL CHECK (fonte IN (${FONTES})),
     id_origem TEXT NOT NULL DEFAULT '',
     chave_dedupe TEXT NOT NULL UNIQUE,
     data_compra TEXT NOT NULL,
     data_lancamento TEXT NOT NULL,
     descricao TEXT NOT NULL,
     centavos INTEGER NOT NULL,
     natureza TEXT NOT NULL CHECK (natureza IN (${NATUREZAS})),
     categoria TEXT NOT NULL DEFAULT '',
     origem_categoria TEXT NOT NULL DEFAULT 'nenhuma',
     categoria_fonte TEXT NOT NULL DEFAULT '',
     fatura_id TEXT,
     mes_fatura_fonte TEXT,
     parcela_n INTEGER,
     parcela_total INTEGER,
     grupo_parcela TEXT,
     par_id TEXT,
     status TEXT NOT NULL CHECK (status IN ('pendente','lancada')),
     cartao_final TEXT
   );
   CREATE INDEX transacao_conta_data ON transacao (conta_id, data_lancamento);
   CREATE TABLE sincronizacao (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     inicio TEXT NOT NULL,
     fim TEXT,
     ok INTEGER,
     origem TEXT NOT NULL,
     resumo TEXT
   );`,
];

export class FinancasIndisponiveis extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancasIndisponiveis";
  }
}

/** Cria o arquivo vazio com 600 se não existe, e garante 600 se existe. */
function arquivoPrivado(caminho: string) {
  fs.closeSync(fs.openSync(caminho, "a", 0o600));
  fs.chmodSync(caminho, 0o600);
}

export function migrar(db: BetterSqlite3.Database): number {
  const versao = db.pragma("user_version", { simple: true }) as number;
  for (let i = versao; i < MIGRACOES.length; i++) {
    db.transaction(() => {
      db.exec(MIGRACOES[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  return MIGRACOES.length;
}

type Linha = Record<string, any>;

const contaDaLinha = (r: Linha): Conta => ({
  id: r.id,
  itemId: r.item_id,
  nome: r.nome,
  instituicao: r.instituicao,
  tipo: r.tipo,
  saldoCentavos: r.saldo_centavos,
  limiteCentavos: r.limite_centavos,
  limiteDisponivelCentavos: r.limite_disponivel_centavos,
  final: r.final,
  atualizadoEm: r.atualizado_em,
});

const faturaDaLinha = (r: Linha): Fatura => ({
  id: r.id,
  cartaoId: r.cartao_id,
  fechamento: r.fechamento,
  vencimento: r.vencimento,
  totalBanco: r.total_banco,
  pagoCentavos: r.pago_centavos,
  encargosCentavos: r.encargos_centavos,
  minimoCentavos: r.minimo_centavos,
  pagamentos: JSON.parse(r.pagamentos || "[]"),
});

const transacaoDaLinha = (r: Linha): Transacao => ({
  id: r.id,
  contaId: r.conta_id,
  fonte: r.fonte,
  idOrigem: r.id_origem,
  chaveDedupe: r.chave_dedupe,
  dataCompra: r.data_compra,
  dataLancamento: r.data_lancamento,
  descricao: r.descricao,
  centavos: r.centavos,
  natureza: r.natureza,
  categoria: r.categoria,
  origemCategoria: r.origem_categoria,
  categoriaFonte: r.categoria_fonte,
  faturaId: r.fatura_id,
  mesFaturaFonte: r.mes_fatura_fonte,
  parcelaN: r.parcela_n,
  parcelaTotal: r.parcela_total,
  grupoParcela: r.grupo_parcela,
  parId: r.par_id,
  status: r.status,
  cartaoFinal: r.cartao_final,
});

const conexaoDaLinha = (r: Linha): Conexao => ({
  itemId: r.item_id,
  nome: r.nome,
  status: r.status,
  executionStatus: r.execution_status,
  dadosAte: r.dados_ate,
  consentimentoAte: r.consentimento_ate,
  lidoEm: r.lido_em,
  erroLeitura: r.erro_leitura,
});

export interface LeituraDeUmaConexao {
  conexao: Conexao;
  /** Contas e investimentos lidos agora; os desta conexão que não vieram ficam inativos. */
  contas: Conta[];
  faturas: Fatura[];
  transacoes: Transacao[];
  removerTransacoes: string[];
}

export class BancoDeFinancas {
  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly dir: string,
  ) {}

  contas(): Conta[] {
    return this.db.prepare("SELECT * FROM conta WHERE ativa = 1 ORDER BY tipo, nome").all().map((r) => contaDaLinha(r as Linha));
  }

  faturas(): Fatura[] {
    return this.db.prepare("SELECT * FROM fatura ORDER BY vencimento").all().map((r) => faturaDaLinha(r as Linha));
  }

  /** Lançamentos das contas ativas. Poucos milhares por ano: cabem em memória para o passe puro. */
  transacoes(): Transacao[] {
    return this.db
      .prepare("SELECT t.* FROM transacao t JOIN conta c ON c.id = t.conta_id AND c.ativa = 1 ORDER BY t.data_lancamento DESC, t.id")
      .all()
      .map((r) => transacaoDaLinha(r as Linha));
  }

  transacoesDasContas(ids: string[]): Transacao[] {
    if (ids.length === 0) return [];
    return this.db
      .prepare(`SELECT * FROM transacao WHERE conta_id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids)
      .map((r) => transacaoDaLinha(r as Linha));
  }

  conexoes(): Conexao[] {
    return this.db.prepare("SELECT * FROM conexao ORDER BY nome").all().map((r) => conexaoDaLinha(r as Linha));
  }

  /** Só a conexão (status, falha), sem tocar contas: a leitura falhou no meio. */
  gravarConexao(c: Conexao) {
    this.db
      .prepare(
        `INSERT INTO conexao (item_id, nome, status, execution_status, dados_ate, consentimento_ate, lido_em, erro_leitura)
         VALUES (@itemId, @nome, @status, @executionStatus, @dadosAte, @consentimentoAte, @lidoEm, @erroLeitura)
         ON CONFLICT(item_id) DO UPDATE SET nome = excluded.nome, status = excluded.status, execution_status = excluded.execution_status,
           dados_ate = COALESCE(excluded.dados_ate, conexao.dados_ate), consentimento_ate = COALESCE(excluded.consentimento_ate, conexao.consentimento_ate),
           lido_em = excluded.lido_em, erro_leitura = excluded.erro_leitura`,
      )
      .run(c);
  }

  /** Grava uma conexão lida por inteiro, numa transação: ou entra tudo, ou nada. */
  gravarLeitura(l: LeituraDeUmaConexao) {
    const upsertConta = this.db.prepare(
      `INSERT INTO conta (id, item_id, nome, instituicao, tipo, saldo_centavos, limite_centavos, limite_disponivel_centavos, final, atualizado_em, ativa)
       VALUES (@id, @itemId, @nome, @instituicao, @tipo, @saldoCentavos, @limiteCentavos, @limiteDisponivelCentavos, @final, @atualizadoEm, 1)
       ON CONFLICT(id) DO UPDATE SET item_id = excluded.item_id, nome = excluded.nome, instituicao = excluded.instituicao, tipo = excluded.tipo,
         saldo_centavos = excluded.saldo_centavos, limite_centavos = excluded.limite_centavos,
         limite_disponivel_centavos = excluded.limite_disponivel_centavos, final = excluded.final, atualizado_em = excluded.atualizado_em, ativa = 1`,
    );
    const upsertFatura = this.db.prepare(
      `INSERT INTO fatura (id, cartao_id, fechamento, vencimento, total_banco, pago_centavos, encargos_centavos, minimo_centavos, pagamentos)
       VALUES (@id, @cartaoId, @fechamento, @vencimento, @totalBanco, @pagoCentavos, @encargosCentavos, @minimoCentavos, @pagamentos)
       ON CONFLICT(id) DO UPDATE SET cartao_id = excluded.cartao_id, fechamento = excluded.fechamento, vencimento = excluded.vencimento,
         total_banco = excluded.total_banco, pago_centavos = excluded.pago_centavos, encargos_centavos = excluded.encargos_centavos,
         minimo_centavos = excluded.minimo_centavos, pagamentos = excluded.pagamentos`,
    );
    const remover = this.db.prepare("DELETE FROM transacao WHERE id = ?");
    this.db.transaction(() => {
      this.gravarConexao(l.conexao);
      const lidas = new Set(l.contas.map((c) => c.id));
      for (const c of l.contas) upsertConta.run(c);
      // Conta que a conexão deixou de listar sai do "tenho", mas o histórico fica.
      for (const r of this.db.prepare("SELECT id FROM conta WHERE item_id = ? AND ativa = 1").all(l.conexao.itemId) as Linha[]) {
        if (!lidas.has(r.id)) this.db.prepare("UPDATE conta SET ativa = 0 WHERE id = ?").run(r.id);
      }
      for (const f of l.faturas) upsertFatura.run({ ...f, pagamentos: JSON.stringify(f.pagamentos) });
      for (const id of l.removerTransacoes) remover.run(id);
      this.upsertTransacoes(l.transacoes);
    })();
  }

  private upsertTransacoes(transacoes: Transacao[]) {
    const upsert = this.db.prepare(
      `INSERT INTO transacao (id, conta_id, fonte, id_origem, chave_dedupe, data_compra, data_lancamento, descricao, centavos, natureza,
         categoria, origem_categoria, categoria_fonte, fatura_id, mes_fatura_fonte, parcela_n, parcela_total, grupo_parcela, par_id, status, cartao_final)
       VALUES (@id, @contaId, @fonte, @idOrigem, @chaveDedupe, @dataCompra, @dataLancamento, @descricao, @centavos, @natureza,
         @categoria, @origemCategoria, @categoriaFonte, @faturaId, @mesFaturaFonte, @parcelaN, @parcelaTotal, @grupoParcela, @parId, @status, @cartaoFinal)
       ON CONFLICT(chave_dedupe) DO UPDATE SET conta_id = excluded.conta_id, data_compra = excluded.data_compra,
         data_lancamento = excluded.data_lancamento, descricao = excluded.descricao, centavos = excluded.centavos,
         categoria_fonte = excluded.categoria_fonte, fatura_id = COALESCE(excluded.fatura_id, transacao.fatura_id),
         mes_fatura_fonte = excluded.mes_fatura_fonte, parcela_n = excluded.parcela_n, parcela_total = excluded.parcela_total,
         status = excluded.status, cartao_final = excluded.cartao_final`,
    );
    for (const t of transacoes) upsert.run(t);
  }

  /** Lançamentos de fonte secundária (PDF), já deduplicados por quem chama. */
  inserirTransacoes(transacoes: Transacao[]) {
    this.db.transaction(() => this.upsertTransacoes(transacoes))();
  }

  /** Grava o que o passe puro derivou (natureza, categoria, fatura, parcela, par). */
  gravarDerivados(transacoes: Transacao[]) {
    const atualizar = this.db.prepare(
      `UPDATE transacao SET natureza = @natureza, categoria = @categoria, origem_categoria = @origemCategoria,
         fatura_id = @faturaId, grupo_parcela = @grupoParcela, par_id = @parId WHERE id = @id`,
    );
    this.db.transaction(() => {
      for (const t of transacoes) atualizar.run(t);
    })();
  }

  iniciarSincronizacao(origem: string, agora: string): number {
    return Number(this.db.prepare("INSERT INTO sincronizacao (inicio, origem) VALUES (?, ?)").run(agora, origem).lastInsertRowid);
  }

  /** `resumo` só com contagens e status: nenhum valor nem descrição (RULES 24). */
  terminarSincronizacao(id: number, agora: string, ok: boolean, resumo: string) {
    this.db.prepare("UPDATE sincronizacao SET fim = ?, ok = ?, resumo = ? WHERE id = ?").run(agora, ok ? 1 : 0, resumo, id);
  }

  ultimaSincronizacao(): { inicio: string; fim: string | null; ok: boolean | null; origem: string } | null {
    const r = this.db.prepare("SELECT * FROM sincronizacao WHERE fim IS NOT NULL ORDER BY id DESC LIMIT 1").get() as Linha | undefined;
    return r ? { inicio: r.inicio, fim: r.fim, ok: r.ok === null ? null : r.ok === 1, origem: r.origem } : null;
  }

  ultimaSincronizacaoOk(): string | null {
    const r = this.db.prepare("SELECT fim FROM sincronizacao WHERE ok = 1 ORDER BY id DESC LIMIT 1").get() as Linha | undefined;
    return r?.fim ?? null;
  }

  /** Foto consistente para o cofre: VACUUM INTO num arquivo 600 novo, trocado por rename. */
  copiaDeSeguranca() {
    const destino = path.join(this.dir, ARQUIVO_DA_COPIA);
    const temporario = `${destino}.tmp`;
    fs.rmSync(temporario, { force: true });
    // VACUUM INTO aceita arquivo vazio: nascer 600 aqui é o que garante a permissão da cópia.
    arquivoPrivado(temporario);
    this.db.prepare("VACUUM INTO ?").run(temporario);
    fs.renameSync(temporario, destino);
  }

  fechar() {
    this.db.close();
  }
}

export async function abrirBanco(dir: string): Promise<BancoDeFinancas> {
  let Database: typeof BetterSqlite3;
  try {
    Database = (await import("better-sqlite3")).default;
  } catch {
    throw new FinancasIndisponiveis("better-sqlite3 não está instalado (dependência opcional).");
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const caminho = path.join(dir, ARQUIVO_DO_BANCO);
  arquivoPrivado(caminho);
  const db = new Database(caminho);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  for (const extra of ["-wal", "-shm"]) if (fs.existsSync(caminho + extra)) fs.chmodSync(caminho + extra, 0o600);
  migrar(db);
  return new BancoDeFinancas(db, dir);
}
