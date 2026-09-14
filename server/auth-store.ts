import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { escopoConcedido } from "./passos.ts";

/**
 * Credencial do Google que SOBREVIVE a reinicio — persistência V1.
 *
 * O desenho antigo (§3.4) usava o token client do GIS no browser: access_token
 * na memória da aba, sem refresh token, reconexão a cada ~1h e nada no
 * servidor. Isso caiu. O fluxo agora é o authorization code no backend, que é
 * o único jeito de o Google emitir refresh_token — o que torna a conexão
 * persistente de verdade.
 *
 * ATENÇÃO ao prazo: enquanto a tela de consentimento estiver como "Externo +
 * Testando", o Google expira o refresh_token em 7 DIAS. Publicar o app remove
 * esse prazo. O código aqui não muda em nenhum dos dois casos; o que muda é
 * quantas vezes o usuário reconecta.
 *
 * Usuário único: o app é pessoal e fica atrás do porteiro de IP
 * (server/acesso.ts), então não há sessão, cookie nem tabela de usuários. O
 * servidor guarda UMA credencial e pronto.
 */

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";

/**
 * Dois escopos, pedidos juntos no MESMO consentimento (autorização
 * incremental). Ampliar o acesso para o Google Tasks é refazer
 * /api/auth/google — nunca logout: `desconectar` REVOGA o refresh_token no
 * Google e derrubaria o Calendar junto. Com `include_granted_scopes` e
 * `prompt=consent` o callback recebe um refresh_token novo que cobre os dois,
 * e `gravar` substitui o antigo.
 */
export const ESCOPO_CALENDAR = "https://www.googleapis.com/auth/calendar.events";
/** Leitura e escrita: `tasks.readonly` não cria a checklist. */
export const ESCOPO_TASKS = "https://www.googleapis.com/auth/tasks";
export const ESCOPOS: readonly string[] = [ESCOPO_CALENDAR, ESCOPO_TASKS];

const ARQUIVO = path.join(process.cwd(), "data", "google-auth.json");

/** Renova antes do fim: token que expira em voo vira 401 no meio do turno. */
const MARGEM_MS = 60_000;

interface Credencial {
  refresh_token: string;
  scope: string;
  obtidoEm: string;
}

/** Falta configuração no ambiente — não adianta o usuário reconectar. */
export class ErroDeConfig extends Error {}
/** Não há credencial guardada, ou o Google recusou a que havia (revogada/expirada). */
export class PrecisaConectar extends Error {}
/**
 * Google inacessível ao renovar (rede, timeout, 5xx) ou recusou por um motivo
 * que não é a credencial (client OAuth mal configurado). Diferente de
 * `PrecisaConectar`: não apaga nada, e a vigia (que renova ~1x/h, 24/7) só
 * loga e tenta de novo na próxima varredura em vez de exigir reconexão.
 */
export class GoogleIndisponivel extends Error {}
/**
 * O usuário desmarcou o Google Calendar na tela de consentimento granular.
 * Nada é gravado: sem o Calendar o app não agenda nada, e sobrescrever uma
 * credencial que funcionava por uma que não serve seria perder a conexão por
 * um clique de teste.
 */
export class EscopoNegado extends Error {}

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new ErroDeConfig(`${nome} não está definida no ambiente.`);
  return valor;
}

function clientId(): string {
  // Mesmo valor que o frontend já usava: não vale inventar uma segunda var
  // para o servidor e arriscar as duas divergirem.
  return exigir("VITE_GOOGLE_CLIENT_ID");
}

export function redirectUri(): string {
  const base = process.env.APP_URL || "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/api/auth/callback`;
}

/* ---------------------------------------------------------------- cifra --- */

/**
 * O refresh_token é acesso permanente ao calendário e fica num volume que
 * qualquer backup carrega junto. Cifrar custa dez linhas; o formato é
 * `iv.tag.dados`, tudo base64, porque assim o arquivo continua legível a olho
 * e não precisa de metadado separado.
 */
function chave(): Buffer {
  const bruta = Buffer.from(exigir("TOKEN_ENC_KEY"), "base64");
  if (bruta.length !== 32) {
    throw new ErroDeConfig(
      `TOKEN_ENC_KEY precisa ter 32 bytes em base64 (tem ${bruta.length}).`,
    );
  }
  return bruta;
}

function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), dados].map((b) => b.toString("base64")).join(".");
}

function decifrar(blob: string): string {
  const [iv, tag, dados] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !dados) throw new Error("Arquivo de credencial corrompido.");
  const d = crypto.createDecipheriv("aes-256-gcm", chave(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]).toString("utf8");
}

/* ---------------------------------------------------------------- disco --- */

async function ler(): Promise<Credencial | null> {
  try {
    return JSON.parse(decifrar(await fs.readFile(ARQUIVO, "utf8"))) as Credencial;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    // Chave trocada ou arquivo corrompido: tratar como "não conectado" em vez
    // de derrubar o servidor. Reconectar regrava o arquivo por cima.
    console.error("[auth] credencial ilegível, ignorando:", err.message);
    return null;
  }
}

async function gravar(cred: Credencial): Promise<void> {
  await fs.mkdir(path.dirname(ARQUIVO), { recursive: true });
  const tmp = `${ARQUIVO}.${process.pid}.tmp`;
  await fs.writeFile(tmp, cifrar(JSON.stringify(cred)), "utf8");
  await fs.rename(tmp, ARQUIVO);
}

async function apagar(): Promise<void> {
  await fs.rm(ARQUIVO, { force: true });
}

/* --------------------------------------------------------------- fluxo ---- */

/** `state` do OAuth: vive só entre o redirect e o callback. */
const pendentes = new Set<string>();

export function urlDeConsentimento(): string {
  const state = crypto.randomBytes(16).toString("hex");
  pendentes.add(state);
  // Um state órfão (usuário fechou a aba) não pode vazar memória para sempre.
  setTimeout(() => pendentes.delete(state), 10 * 60_000).unref?.();

  const q = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: ESCOPOS.join(" "),
    // offline + consent é o que faz o Google devolver refresh_token. Sem
    // `prompt=consent` ele omite o refresh quando já houve consentimento antes,
    // e a credencial nasceria sem como se renovar.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH}?${q}`;
}

/**
 * Erro do POST ao Google com status HTTP + `error` do corpo, para
 * `tokenValido` decidir (via `refreshRecusado`) se é credencial morta ou
 * falha transitória. `status` null = nem houve resposta (fetch que lançou).
 */
class ErroDoGoogle extends Error {
  readonly status: number | null;
  readonly codigo: string | undefined;
  constructor(mensagem: string, status: number | null, codigo: string | undefined) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

async function pedirAoGoogle(corpo: Record<string, string>): Promise<any> {
  const resp = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(corpo),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new ErroDoGoogle(
      dados.error_description || dados.error || `Google respondeu ${resp.status}.`,
      resp.status,
      dados.error,
    );
  }
  return dados;
}

/**
 * Só refresh_token revogado ou expirado é credencial morta: o Google devolve
 * `invalid_grant` em 400 ou 401 nesse caso. `invalid_client`/`unauthorized_client`
 * são o client OAuth mal configurado (ambiente, não a credencial do usuário) e
 * qualquer outro status (rede sem resposta, 5xx) é falha transitória — nenhum
 * dos dois apaga o arquivo. Pura, para testar sem rede nem disco.
 */
export function refreshRecusado(status: number | null, codigo: string | undefined): boolean {
  return (status === 400 || status === 401) && codigo === "invalid_grant";
}

/**
 * O `scope` que vai para o disco. Resposta sem `scope` (legado) vale só o
 * Calendar: com dois escopos pedidos, cair em "o que pedimos" declararia um
 * Tasks que ninguém concedeu e o fluxo dos passos bateria num 403.
 */
export function escopoDaCredencial(scopeDoGoogle: unknown): string {
  const texto = typeof scopeDoGoogle === "string" ? scopeDoGoogle.trim() : "";
  return texto || ESCOPO_CALENDAR;
}

/** O que um `scope` gravado concede, por escopo. Pura, para testar sem disco. */
export function concessoesDoScope(scope: string | null | undefined): { calendar: boolean; tasks: boolean } {
  return { calendar: escopoConcedido(scope, ESCOPO_CALENDAR), tasks: escopoConcedido(scope, ESCOPO_TASKS) };
}

/** Troca o `code` do callback pela credencial e grava. */
export async function trocarCodigo(code: string, state: string): Promise<void> {
  // State desconhecido = callback que não saiu daqui. Recusar.
  if (!pendentes.delete(state)) {
    throw new PrecisaConectar("State inválido ou expirado; refaça a conexão.");
  }
  const dados = await pedirAoGoogle({
    code,
    client_id: clientId(),
    client_secret: exigir("GOOGLE_CLIENT_SECRET"),
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  if (!dados.refresh_token) {
    throw new Error(
      "Google não devolveu refresh_token. Sem ele a conexão não persiste.",
    );
  }
  const scope = escopoDaCredencial(dados.scope);
  // Consentimento granular: Calendar desmarcado recusa ANTES de gravar e antes
  // de mexer no cache — a credencial anterior, se houver, continua valendo.
  if (!concessoesDoScope(scope).calendar) {
    throw new EscopoNegado("O acesso ao Google Calendar foi desmarcado no consentimento: nada foi gravado.");
  }
  await gravar({
    refresh_token: dados.refresh_token,
    scope,
    obtidoEm: new Date().toISOString(),
  });
  cache = {
    token: dados.access_token,
    expiraEm: Date.now() + (Number(dados.expires_in) || 3600) * 1000,
  };
}

/** access_token vive só em memória: é descartável e o refresh o refaz. */
let cache: { token: string; expiraEm: number } | null = null;

/**
 * Devolve um access_token válido, renovando se preciso. Lança
 * `PrecisaConectar` quando não há credencial ou o Google recusou a que havia
 * de fato (`invalid_grant`) — o único caso em que a interface deve pedir o
 * gesto do usuário. Rede fora do ar ou 5xx do Google vira `GoogleIndisponivel`
 * sem tocar no arquivo: a vigia roda ~1x/h, 24/7, e uma oscilação às 3h não
 * pode forçar reconectar (F1 da revisão final).
 */
export async function tokenValido(): Promise<string> {
  if (cache && Date.now() < cache.expiraEm - MARGEM_MS) return cache.token;

  const cred = await ler();
  if (!cred) throw new PrecisaConectar("Nenhuma credencial do Google guardada.");

  // Config ausente é ambiente, não credencial: fora do try, para sair como
  // `ErroDeConfig` em vez de virar `GoogleIndisponivel` ou apagar o arquivo.
  const id = clientId();
  const secret = exigir("GOOGLE_CLIENT_SECRET");

  let dados;
  try {
    dados = await pedirAoGoogle({
      client_id: id,
      client_secret: secret,
      refresh_token: cred.refresh_token,
      grant_type: "refresh_token",
    });
  } catch (err: any) {
    if (err instanceof ErroDoGoogle && refreshRecusado(err.status, err.codigo)) {
      // invalid_grant: credencial morta de verdade. Apagar evita ficar
      // batendo num token que nunca mais vai valer.
      await apagar();
      cache = null;
      throw new PrecisaConectar(`Google recusou a credencial: ${err.message}`);
    }
    // Rede (fetch lançou, sem resposta), 5xx, ou client OAuth mal configurado
    // (invalid_client/unauthorized_client): transitório ou de ambiente, mas
    // não prova que o refresh_token morreu. Não apaga nada.
    throw new GoogleIndisponivel(`Google indisponível ao renovar: ${err.message}`);
  }
  cache = {
    token: dados.access_token,
    expiraEm: Date.now() + (Number(dados.expires_in) || 3600) * 1000,
  };
  return cache.token;
}

export async function estaConectado(): Promise<boolean> {
  return (await ler()) !== null;
}

/**
 * O que a credencial em disco concede. Sem credencial (ou ilegível): os dois
 * false. A rota lê UMA vez por turno — o scope só muda num callback, e o turno
 * não precisa reler o disco a cada compromisso.
 */
export async function escoposConcedidos(): Promise<{ calendar: boolean; tasks: boolean }> {
  const cred = await ler();
  return cred ? concessoesDoScope(cred.scope) : { calendar: false, tasks: false };
}

export async function desconectar(): Promise<void> {
  const cred = await ler();
  cache = null;
  await apagar();
  if (!cred) return;
  // Revogar é cortesia com o Google, não requisito: se falhar, o arquivo já
  // foi embora e o app aqui já está desconectado.
  await fetch(REVOKE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: cred.refresh_token }),
  }).catch(() => undefined);
}
