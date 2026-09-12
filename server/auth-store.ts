import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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

export const SCOPE = "https://www.googleapis.com/auth/calendar.events";

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
/** Não há credencial guardada, ou o Google recusou a que havia. */
export class PrecisaConectar extends Error {}

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
    scope: SCOPE,
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

async function pedirAoGoogle(corpo: Record<string, string>): Promise<any> {
  const resp = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(corpo),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      dados.error_description || dados.error || `Google respondeu ${resp.status}.`,
    );
  }
  return dados;
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
  await gravar({
    refresh_token: dados.refresh_token,
    scope: dados.scope ?? SCOPE,
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
 * `PrecisaConectar` quando não há credencial ou o Google recusou a que havia —
 * o único caso em que a interface deve pedir o gesto do usuário.
 */
export async function tokenValido(): Promise<string> {
  if (cache && Date.now() < cache.expiraEm - MARGEM_MS) return cache.token;

  const cred = await ler();
  if (!cred) throw new PrecisaConectar("Nenhuma credencial do Google guardada.");

  let dados;
  try {
    dados = await pedirAoGoogle({
      client_id: clientId(),
      client_secret: exigir("GOOGLE_CLIENT_SECRET"),
      refresh_token: cred.refresh_token,
      grant_type: "refresh_token",
    });
  } catch (err: any) {
    // Refresh recusado = credencial morta (revogada, ou os 7 dias do modo
    // Testando). Apagar evita ficar batendo num token que nunca mais vai valer.
    await apagar();
    cache = null;
    throw new PrecisaConectar(`Google recusou a credencial: ${err.message}`);
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
