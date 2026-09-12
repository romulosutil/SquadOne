import { ref } from "vue";

/**
 * §3.4 — GIS token client. Escopo mínimo: cria e lê eventos, não mexe em
 * configuração de calendário.
 *
 * O token vive em memória e só em memória: sem refresh token, sem sessão no
 * backend, sem credencial em disco. Custo aceito no spec: reconectar a cada
 * ~1h. Por isso nada de localStorage aqui — persistir o access_token trocaria
 * a propriedade que justifica esse desenho.
 */
export const SCOPE = "https://www.googleapis.com/auth/calendar.events";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
/**
 * O valor é embutido no bundle no `vite build`, não lido em runtime: um deploy
 * que buildou sem a variável — ou com o placeholder do .env.example — carrega
 * uma string qualquer, e uma string qualquer passa por `if (!CLIENT_ID)`. O
 * Google então recusa o `initTokenClient` sem erro legível pro usuário. Exigir
 * o formato aqui transforma esse silêncio numa mensagem que diz onde arrumar.
 */
export function clientIdValido(valor: string | undefined): boolean {
  return /^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$/.test(valor ?? "");
}
/** Renova antes do fim: um token que expira em voo vira 401 no meio do turno. */
const MARGEM_MS = 60_000;
/** Reconexão silenciosa é instantânea quando funciona; parar de esperar é barato. */
const TIMEOUT_SILENCIOSO_MS = 10_000;
/** O popup depende do usuário ler e clicar: aqui a paciência tem que ser outra. */
const TIMEOUT_POPUP_MS = 5 * 60_000;

export const conectado = ref(false);
export const conectando = ref(false);

let token: string | null = null;
let expiraEm = 0;
let pendente: Promise<string> | null = null;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface ErroGis {
  type?: string;
  message?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
  callback: (resp: TokenResponse) => void;
  error_callback?: (err: ErroGis) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: TokenResponse) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

let scriptCarregado: Promise<void> | null = null;

function carregarGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptCarregado) return scriptCarregado;
  scriptCarregado = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = GIS_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptCarregado = null;
      reject(new Error(`Não foi possível carregar ${GIS_SRC}`));
    };
    document.head.appendChild(el);
  });
  return scriptCarregado;
}

let cliente: TokenClient | null = null;

async function obterCliente(): Promise<TokenClient> {
  if (!clientIdValido(CLIENT_ID)) {
    throw new Error(
      `VITE_GOOGLE_CLIENT_ID inválido (${CLIENT_ID ?? "ausente"}): precisa ser o ` +
        "OAuth Client ID (tipo Web) do projeto Google, terminando em " +
        ".apps.googleusercontent.com. Em produção ele é embutido no build — " +
        "defina a variável ANTES do `vite build` e rebuilde.",
    );
  }
  await carregarGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("GIS carregou mas não expôs google.accounts.oauth2.");
  if (!cliente) {
    cliente = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      // Reatribuídos a cada pedido: a lib chama estes callbacks, não a Promise.
      callback: () => {},
      // Sem este, uma recusa do GIS (popup bloqueado, consentimento negado)
      // não chega em lugar nenhum e a Promise fica pendurada pra sempre.
      error_callback: () => {},
    });
  }
  return cliente;
}

function guardar(resp: TokenResponse): string {
  if (!resp.access_token) {
    throw new Error(
      resp.error_description ?? resp.error ?? "Google não devolveu access_token.",
    );
  }
  token = resp.access_token;
  // expires_in vem em segundos; sem ele, assume a hora padrão do Google.
  expiraEm = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
  conectado.value = true;
  return token;
}

function limpar(): void {
  token = null;
  expiraEm = 0;
  conectado.value = false;
}

/** Token ainda válido, ou null. Não dispara popup. */
export function tokenAtual(): string | null {
  if (!token || Date.now() > expiraEm - MARGEM_MS) {
    // Expirado: descarta local. Revogar não faz sentido num token morto.
    if (token) limpar();
    return null;
  }
  return token;
}

/**
 * Pede um access_token. `silencioso` usa prompt:'' — só funciona se o usuário
 * já consentiu neste browser; senão o Google recusa sem abrir nada, e aí a
 * chamada com gesto do usuário (botão Conectar) é que abre o popup.
 */
export function conectar(silencioso = false): Promise<string> {
  const valido = tokenAtual();
  if (valido) return Promise.resolve(valido);
  if (pendente) return pendente;

  pendente = (async () => {
    const c = await obterCliente();
    return await new Promise<string>((resolve, reject) => {
      // O GIS pode simplesmente não responder: no fluxo silencioso, quando o
      // browser bloqueia o iframe de sessão, ele não chama callback NEM
      // error_callback. Sem este relógio a Promise nunca liquida, `pendente`
      // nunca zera e toda chamada seguinte — inclusive a do botão — herda a
      // mesma Promise morta, com `conectando` travado em true e o botão
      // desabilitado. O sintoma vira "o calendário não conecta".
      let vivo = true;
      const relogio = setTimeout(() => {
        if (!vivo) return;
        vivo = false;
        reject(
          new Error(
            silencioso
              ? "Google não respondeu à reconexão silenciosa."
              : "Google não respondeu ao pedido de autorização.",
          ),
        );
      }, silencioso ? TIMEOUT_SILENCIOSO_MS : TIMEOUT_POPUP_MS);

      const encerrar = (fn: () => void) => {
        if (!vivo) return;
        vivo = false;
        clearTimeout(relogio);
        fn();
      };

      c.callback = (resp) =>
        encerrar(() => {
          try {
            resolve(guardar(resp));
          } catch (err) {
            reject(err);
          }
        });
      c.error_callback = (err) =>
        encerrar(() =>
          reject(new Error(err?.message ?? err?.type ?? "GIS recusou o pedido.")),
        );

      try {
        c.requestAccessToken(silencioso ? { prompt: "" } : {});
      } catch (err) {
        encerrar(() => reject(err));
      }
    });
  })();

  conectando.value = true;
  return pendente.finally(() => {
    pendente = null;
    conectando.value = false;
  });
}

/** Token válido pra uma chamada; abre o popup se não houver. */
export function garantirToken(): Promise<string> {
  return conectar(false);
}

/** Cabeçalhos de uma chamada autenticada. */
export async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await garantirToken()}` };
}

export function desconectar(): void {
  const antigo = token;
  limpar();
  if (antigo) window.google?.accounts?.oauth2?.revoke?.(antigo);
}
