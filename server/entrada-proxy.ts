import http from "node:http";
import express from "express";

/**
 * A Entrada da Mel, vista pela Central (menu "Entrada", /entrada/).
 *
 * A página e a API da Entrada rodam em outro processo (deploy/dell/entrada, 127.0.0.1:9130). Esta rota só
 * REPASSA, para um destino FIXO de configuração (regra 8: o navegador nunca escolhe URL), um conjunto
 * fechado de rotas, para a página abrir no mesmo endereço da Central (127.0.0.1:9120 no Dell, :8443 pela
 * tailnet) sem abrir mais uma porta na tailnet.
 *
 * Fica ANTES do `express.json()`: o corpo de um envio é um arquivo de até 200 MB e passa em fluxo, nunca
 * inteiro na memória. O porteiro de IP da Central já rodou antes. Quem decide o que é segredo, o tamanho e
 * a origem é o servidor da Entrada: o repasse não interpreta nada do conteúdo.
 *
 * Não é uma ação de parar, reiniciar ou reconfigurar infraestrutura (regra 10): é só a ponte de uma página.
 *
 * O repasse é BURRO DE PROPÓSITO: `Host`, `Origin` e `X-Forwarded-For` seguem como o cliente mandou, porque
 * quem os confere (nome da tailnet, porta, IP da tailnet, `Sec-Fetch-Site`) é o servidor da Entrada. Se esses
 * portões saírem de lá, esta ponte não os substitui.
 *
 * Consequência a ter em mente (revisão de 04/10/2026): a `Origin` que a Entrada aceita é a da CENTRAL INTEIRA
 * (:8443 pela tailnet, :9120 no Dell), não a de uma página só. Um XSS em qualquer rota da Central passaria a
 * ser same-origin com `POST /entrada/api/enviar`. Um token na página não ajudaria (o mesmo script leria a
 * página e pegaria o token); só uma origem própria resolveria, e isso foi trocado pelo menu na Central, de
 * propósito (regra 23). O que limita o estrago: `src/` não usa `v-html` nem `innerHTML` (busca de 04/10/2026; o Vue
 * escapa o resto), e a Entrada só guarda e organiza (não apaga, não sobrescreve, não manda nada para fora).
 */
export const ENTRADA_PREFIXO = "/entrada";
export const ENTRADA_PADRAO = { host: "127.0.0.1", porta: 9130 } as const;

// (método, caminho dentro de /entrada) que passam. Qualquer outra coisa é 404/405 aqui, sem chegar lá.
const ROTAS: ReadonlyArray<readonly [string, string]> = [
  ["GET", "/"],
  ["GET", "/api/estado"],
  ["POST", "/api/enviar"],
  // A Inter que a página usa (16/10/2026): a CSP da Entrada só aceita fonte da mesma origem.
  ["GET", "/inter.woff2"],
];

// Só estes cabeçalhos do navegador seguem (lista de permissão: Cookie, Authorization etc. nunca vão).
const CABECALHOS_QUE_SEGUEM = new Set([
  "host", "origin", "content-length", "content-type", "accept", "user-agent",
  "x-acao", "x-rotulo", "x-nome", "x-com-cofre",
  "sec-fetch-site", "x-forwarded-for", "tailscale-funnel-request",
]);
// Estes da resposta não se copiam (o Node monta os seus).
const CABECALHOS_QUE_NAO_VOLTAM = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authenticate"]);

export function cabecalhosParaAEntrada(entrada: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const saida: http.OutgoingHttpHeaders = {};
  for (const [nome, valor] of Object.entries(entrada)) {
    if (CABECALHOS_QUE_SEGUEM.has(nome) && valor !== undefined) saida[nome] = valor;
  }
  return saida;
}

export function cabecalhosDaResposta(upstream: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const saida: http.OutgoingHttpHeaders = {};
  for (const [nome, valor] of Object.entries(upstream)) {
    if (!CABECALHOS_QUE_NAO_VOLTAM.has(nome) && valor !== undefined) saida[nome] = valor;
  }
  return saida;
}

export function rotaPermitida(metodo: string, caminho: string): "ok" | "metodo" | "nao" {
  const conhecida = ROTAS.filter(([, c]) => c === caminho);
  if (conhecida.length === 0) return "nao";
  return conhecida.some(([m]) => m === metodo) ? "ok" : "metodo";
}

export function criarRepasseDaEntrada(destino: { host: string; porta: number } = ENTRADA_PADRAO): express.Router {
  const router = express.Router();

  router.use((req, res) => {
    // O Express tira o prefixo: req.path é "/", "/api/estado"... (sem a query, que não segue).
    const caminho = req.path;
    // "/entrada" sem a barra final: as URLs relativas da página (api/enviar) cairiam na API da PRÓPRIA Central.
    if (caminho === "/" && !req.originalUrl.split("?")[0].endsWith("/")) {
      return void res.redirect(301, `${ENTRADA_PREFIXO}/`);
    }
    const permitido = rotaPermitida(req.method, caminho);
    if (permitido === "nao") return void res.status(404).json({ ok: false, mensagem: "Não existe." });
    if (permitido === "metodo") return void res.status(405).json({ ok: false, mensagem: "Método não permitido." });
    // Método sem corpo que traz corpo é recusado aqui também (a Entrada recusa de novo): um GET com corpo
    // é o jeito clássico de contrabandear um segundo pedido.
    if (req.method === "GET" && (req.headers["transfer-encoding"] || (req.headers["content-length"] ?? "0") !== "0")) {
      return void res.status(400).json({ ok: false, mensagem: "Pedido sem corpo não pode ter corpo." });
    }
    if (req.method === "POST") {
      if (req.headers["transfer-encoding"]) {
        return void res.status(501).json({ ok: false, mensagem: "Envio em partes não é aceito: mande com Content-Length." });
      }
      if (!/^\d{1,12}$/.test(String(req.headers["content-length"] ?? ""))) {
        return void res.status(411).json({ ok: false, mensagem: "Falta o Content-Length." });
      }
    }

    const upstream = http.request(
      { host: destino.host, port: destino.porta, method: req.method, path: caminho, headers: cabecalhosParaAEntrada(req.headers) },
      (resposta) => {
        res.writeHead(resposta.statusCode ?? 502, cabecalhosDaResposta(resposta.headers));
        resposta.pipe(res);
      },
    );
    upstream.on("error", () => {
      // Nada do erro vai para a resposta (pode ter caminho); só o fato.
      if (!res.headersSent) res.status(502).json({ ok: false, mensagem: "A Entrada não respondeu. Ela está ligada?" });
      else res.destroy();
    });
    // O navegador desistiu no meio de um envio: fecha o lado de lá (o servidor da Entrada descarta o que recebeu).
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  });

  return router;
}
