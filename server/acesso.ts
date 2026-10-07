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

/**
 * Segunda e terceira travas da RULES 7 (06/10/2026), para o que o app guarda
 * no Dell (finanças agora; agenda e roster na mudança).
 *
 * "Veio pelo Serve" = trouxe `X-Forwarded-For` ou `Tailscale-User-Login`: o
 * processo escuta só em loopback, então quem chega com eles é o Tailscale
 * Serve (que reescreve os dois) ou um processo do próprio Dell (risco aceito
 * em ARCHITECTURE "Confiança no loopback"). Requisição local direta, sem
 * nenhum dos dois, segue valendo: o atualizar-central e o túnel SSH do PC.
 */
export function veioPeloServe(headers: Request["headers"]): boolean {
  return Boolean(headers["x-forwarded-for"] || headers["tailscale-user-login"]);
}

function cabecalho(headers: Request["headers"], nome: string): string | undefined {
  const v = headers[nome];
  return Array.isArray(v) ? v[0] : v;
}

/** PURO: o login do Serve está na lista? Lista vazia FECHA (ao contrário de IPS_PERMITIDOS). */
export function identidadeAceita(headers: Request["headers"], logins: readonly string[]): boolean {
  if (!veioPeloServe(headers)) return true;
  const login = cabecalho(headers, "tailscale-user-login")?.trim().toLowerCase();
  return Boolean(login) && logins.some((l) => l.trim().toLowerCase() === login);
}

/**
 * Confere o `Tailscale-User-Login` contra a lista da configuração. Nó com tag
 * não tem usuário e fica de fora, de propósito. Sem detalhe na resposta,
 * igual ao porteiro.
 */
export function porteiroDeIdentidade(logins: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (identidadeAceita(req.headers, logins)) return next();
    console.warn(`[acesso] identidade do Tailscale recusada em ${req.method} ${req.path}`);
    res.status(403).type("text/plain").send("403");
  };
}

/**
 * PURO: a escrita vem de uma página da MESMA origem? O header de identidade
 * não protege de CSRF: uma página qualquer aberta no celular do Rômulo, que
 * está na tailnet, faria o POST com a identidade dele.
 *
 * `Sec-Fetch-Site` (todo navegador atual manda) decide quando existe; sem ele,
 * o `Origin` tem de ter o mesmo host da requisição; sem os dois, não é
 * navegador, e só a requisição local direta passa.
 */
export function origemAceita(headers: Request["headers"]): boolean {
  const site = cabecalho(headers, "sec-fetch-site");
  if (site !== undefined) return site === "same-origin";
  const origin = cabecalho(headers, "origin");
  if (origin !== undefined) {
    const host = cabecalho(headers, "x-forwarded-host") ?? cabecalho(headers, "host");
    try {
      return Boolean(host) && new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return !veioPeloServe(headers);
}

export function exigeMesmaOrigem(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || origemAceita(req.headers)) return next();
  console.warn(`[acesso] escrita de outra origem recusada em ${req.method} ${req.path}`);
  res.status(403).json({ error: "Escrita só pela própria página do SquadOne.", origemRecusada: true });
}
