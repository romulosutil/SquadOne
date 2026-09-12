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

export function porteiroDeIp() {
  const permitidos = new Set(listaDoEnv());
  if (permitidos.size === 0) {
    console.log("[acesso] IPS_PERMITIDOS vazio: porteiro de IP desligado.");
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  console.log(`[acesso] porteiro de IP ligado para ${permitidos.size} IP(s).`);

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = ipDoCliente(req);
    if (permitidos.has(ip) || LOCAIS.has(ip)) return next();
    // Sem detalhe na resposta: quem nao passa nao precisa saber por que.
    console.warn(`[acesso] bloqueado ${ip} em ${req.method} ${req.path}`);
    res.status(403).type("text/plain").send("403");
  };
}
