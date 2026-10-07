import net from "node:net";
import type { NextFunction, Request, Response } from "express";

/**
 * Porteiro por IP — spec de uso pessoal.
 *
 * O app e de um usuario so e fica numa URL publica adivinhavel. Em vez de
 * login, sessao e papeis, a trava e a mais simples que existe: so o IP de casa
 * entra. Quem chega de fora leva 403 antes de qualquer rota rodar.
 *
 * `IPS_PERMITIDOS` vazio DESLIGA o porteiro. Isso e o default de propósito:
 * em dev nao ha proxy na frente e travar por IP so atrapalharia.
 *
 * Cada item e um IP exato ou uma faixa CIDR (30/09/2026). A faixa existe para
 * a Central do Dell: ela escuta so em loopback e o Tailscale Serve a publica
 * na tailnet; o Serve repassa o IP do aparelho da tailnet (100.64.0.0/10 ou
 * fd7a:115c:a1e0::/48) no X-Forwarded-For, que ele mesmo reescreve.
 */
const LOCAIS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function listaDoEnv(): string[] {
  return (process.env.IPS_PERMITIDOS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}

/**
 * Atras do Traefik do Easypanel o socket vem do proxy, nunca do usuario: o IP
 * real so existe no X-Forwarded-For, e o primeiro item da lista e o cliente
 * original. Confiar nesse header so e seguro porque o container nao e
 * alcancavel direto de fora — quem chega, chega pelo proxy.
 */
function ipDoCliente(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  const bruto = Array.isArray(xff) ? xff[0] : xff;
  const primeiro = bruto?.split(",")[0]?.trim();
  const ip = primeiro || req.socket.remoteAddress || "";
  // Express normaliza IPv4 em IPv6 (::ffff:1.2.3.4); comparar sem o prefixo.
  return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}

/** Lista de IPs e faixas CIDR; item ilegivel derruba o boot (porteiro errado nao pode abrir calado). */
export function listaDePermitidos(itens: string[]): (ip: string) => boolean {
  const exatos = new Set<string>();
  const faixas = new net.BlockList();
  for (const item of itens) {
    const [endereco, prefixo] = item.split("/");
    const tipo = net.isIPv4(endereco) ? "ipv4" : net.isIPv6(endereco) ? "ipv6" : null;
    if (!tipo) throw new Error(`IPS_PERMITIDOS: "${item}" nao e IP nem faixa CIDR.`);
    if (prefixo === undefined) {
      exatos.add(endereco);
      continue;
    }
    const bits = Number(prefixo);
    if (!/^\d{1,3}$/.test(prefixo) || bits > (tipo === "ipv4" ? 32 : 128)) throw new Error(`IPS_PERMITIDOS: prefixo invalido em "${item}".`);
    faixas.addSubnet(endereco, bits, tipo);
  }
  return (ip: string) => {
    if (exatos.has(ip)) return true;
    if (net.isIPv4(ip)) return faixas.check(ip, "ipv4");
    if (net.isIPv6(ip)) return faixas.check(ip, "ipv6");
    return false;
  };
}

export function porteiroDeIp() {
  const itens = listaDoEnv();
  if (itens.length === 0) {
    console.log("[acesso] IPS_PERMITIDOS vazio: porteiro de IP desligado.");
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  const permitido = listaDePermitidos(itens);
  console.log(`[acesso] porteiro de IP ligado para ${itens.length} IP(s)/faixa(s).`);

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = ipDoCliente(req);
    if (permitido(ip) || LOCAIS.has(ip)) return next();
    // Sem detalhe na resposta: quem nao passa nao precisa saber por que.
    console.warn(`[acesso] bloqueado ${ip} em ${req.method} ${req.path}`);
    res.status(403).type("text/plain").send("403");
  };
}

/* ------------------------------------------------- identidade e origem --- */

/**
 * Pedido que chegou pelo Tailscale Serve (a 8443 da tailnet). O Serve reescreve
 * o X-Forwarded-For com o IP do aparelho e põe os headers `Tailscale-User-*`;
 * pedido local direto (processos do Dell, túnel SSH do PC no callback do OAuth)
 * não traz nenhum dos dois. Confiar nisso só vale porque o processo escuta só
 * em loopback: quem põe o header é o Serve, não o navegador (ver "Confiança no
 * loopback" no ARCHITECTURE.md).
 */
export function veioPeloServe(req: Request): boolean {
  return Boolean(req.headers["x-forwarded-for"] || req.headers["tailscale-user-login"] || req.headers["tailscale-funnel-request"]);
}

/** `SQUADONE_LOGINS_TAILSCALE`: logins da tailnet (e-mail do Tailscale), por vírgula, sem diferenciar maiúsculas. */
export function lerLoginsPermitidos(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set(
    (env.SQUADONE_LOGINS_TAILSCALE ?? "")
      .split(",")
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Segunda trava da regra 7, atrás da ACL do Tailscale: todo pedido que chega
 * pelo Serve precisa do `Tailscale-User-Login` de um dos logins da lista. Vale
 * para leitura também (a agenda é dado pessoal). Ausente ou fora da lista é
 * 403; nó com tag não tem usuário e fica de fora, de propósito. Funnel nunca
 * passa, mesmo com login: Funnel é proibido.
 *
 * Lista vazia FECHA: nenhum pedido pelo Serve entra. Quem decide se a trava
 * está ligada é o server.ts (ligada sempre que a agenda está no processo).
 */
export function guardaDeIdentidade(logins: ReadonlySet<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!veioPeloServe(req)) return next();
    if (req.headers["tailscale-funnel-request"]) {
      console.warn(`[acesso] pedido pelo Funnel recusado em ${req.method} ${req.path}`);
      return res.status(403).type("text/plain").send("403");
    }
    const login = String(req.get("Tailscale-User-Login") ?? "").trim().toLowerCase();
    if (login && logins.has(login)) return next();
    // Sem o login no log: com a lista certa, quem não passa é tag ou outro usuário.
    console.warn(`[acesso] identidade do Serve recusada em ${req.method} ${req.path}${login ? "" : " (sem login)"}`);
    res.status(403).type("text/plain").send("403");
  };
}

const METODOS_SEM_ESCRITA = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * PURO: o pedido de escrita veio de uma página da mesma origem. O header de
 * identidade não protege de CSRF — uma página qualquer aberta no celular do
 * Rômulo, que está na tailnet, faria o POST com a identidade dele. Por isso:
 * `Origin` obrigatório, com host E porta iguais aos do `Host` (o Serve repassa
 * o Host da tailnet; no loopback é 127.0.0.1:9120), e `Sec-Fetch-Site`, quando
 * o navegador manda, `same-origin`. Mesmo critério da Entrada (servidor.py).
 */
export function origemConfere(headers: { origin?: string; host?: string; secFetchSite?: string }): boolean {
  if (headers.secFetchSite !== undefined && headers.secFetchSite !== "same-origin") return false;
  if (!headers.origin || !headers.host) return false;
  try {
    const origem = new URL(headers.origin);
    if (origem.protocol !== "http:" && origem.protocol !== "https:") return false;
    const padrao = origem.protocol === "https:" ? "443" : "80";
    const [hostDoPedido, portaDoPedido] = splitHost(headers.host.toLowerCase());
    return origem.hostname.toLowerCase() === hostDoPedido && (origem.port || padrao) === (portaDoPedido || padrao);
  } catch {
    return false;
  }
}

function splitHost(host: string): [string, string] {
  // [::1]:9120 → ["[::1]", "9120"]; exemplo.ts.net:8443 → [..., "8443"]
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host);
  return m ? [m[1], m[2] ?? ""] : [host, ""];
}

/**
 * Terceira trava das escritas (regra 7): POST/PUT/PATCH/DELETE só da mesma
 * origem. Leitura passa: `GET` nunca escreve (regra 10), então o link de um
 * cartão no WhatsApp só abre a tela, e quem confirma é um POST daqui.
 */
export function guardaDeOrigem() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (METODOS_SEM_ESCRITA.has(req.method)) return next();
    const ok = origemConfere({
      origin: req.get("Origin") ?? undefined,
      host: req.get("Host") ?? undefined,
      secFetchSite: req.get("Sec-Fetch-Site") ?? undefined,
    });
    if (ok) return next();
    console.warn(`[acesso] escrita de outra origem recusada em ${req.method} ${req.path}`);
    res.status(403).json({ error: "Escrita só pela própria página do SquadOne (mesma origem).", origemRecusada: true });
  };
}
