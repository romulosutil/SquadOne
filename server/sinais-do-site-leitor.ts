import dns from "node:dns";
import { promises as fs } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { SEM_FONTE, extrairSinais, sinaisValidos, type SinaisDoSite } from "./sinais-do-site.ts";

/**
 * O leitor dos sinais do site (17/10/2026): traz o HTML de UM lead, sob demanda, e entrega a
 * `extrairSinais` (PURO). Nunca varre: quem chama é a Ficha de um lead (POST /api/operations/crm/sinais).
 *
 * O endereço vem de planilha e o Dell está dentro da tailnet, então o leitor é um ponto de SSRF e se
 * defende em camadas: só http/https nas portas 80 e 443, sem usuário na URL; nome de máquina (localhost,
 * .local, .ts.net, .internal, sem ponto) recusado; IP privado, loopback, link-local (inclui o metadata
 * 169.254.x), CGNAT/tailnet (100.64/10), multicast e reservados recusados, em v4 e v6 (inclusive v4
 * embutido em v6); cada redirecionamento é conferido de novo (`redirect: "manual"`); e o buscador de
 * verdade só conecta depois de conferir o IP que o DNS devolveu NA HORA da conexão (`lookup`), o que fecha
 * a troca de DNS entre a conferência e o uso.
 *
 * No máximo 3 requisições por lead, contando cada salto de redirecionamento: a página inicial (e os
 * saltos dela) e, se sobrar, o /sitemap.xml. Tempo de 10 s por requisição, corpo de até 2 MB (a página
 * cortada vale como não lida: o rodapé, onde mora o crédito da agência, seria o que falta), User-Agent
 * que diz quem somos. Cache em disco no diretório de dados (arquivo 600, só no operations), com validade.
 */

export const MAX_REQUISICOES = 3;
export const TEMPO_POR_REQUISICAO_MS = 10_000;
export const MAX_CORPO_BYTES = 2 * 1024 * 1024;
export const MAX_SALTOS = 3;
export const VALIDADE_DO_CACHE_DIAS = 7;
/** Site que não respondeu: tenta de novo mais cedo, que pode ter sido um soluço. */
export const VALIDADE_DO_FALHADO_HORAS = 6;
export const MAX_ENTRADAS_NO_CACHE = 3000;
export const USER_AGENT = "SquadOne-sinais-do-site/1.0 (leitura unica da pagina inicial; contato: sutil.romulo@gmail.com)";

export class SiteBloqueado extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteBloqueado";
  }
}

// ------------------------------------------------------------------ IP

function v4(ip: string): number[] | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  const n = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}

function v4Privado([a, b, c]: number[]): boolean {
  return a === 0 // "esta rede"
    || a === 10
    || a === 127 // loopback
    || (a === 100 && b >= 64 && b <= 127) // CGNAT, onde a tailnet mora (100.64/10)
    || (a === 169 && b === 254) // link-local, inclusive o metadata de nuvem
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) // protocolo e documentação
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19)) // benchmark
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) // documentação
    || a >= 224; // multicast, reservado e broadcast
}

/** As 8 palavras de 16 bits de um IPv6, ou null se não for um. */
function v6Palavras(ip: string): number[] | null {
  let texto = ip.toLowerCase().split("%")[0];
  const ponto = texto.lastIndexOf(".");
  if (ponto !== -1) {
    const dois = texto.lastIndexOf(":");
    const q = v4(texto.slice(dois + 1));
    if (!q) return null;
    texto = `${texto.slice(0, dois + 1)}${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
  }
  const partes = texto.split("::");
  if (partes.length > 2) return null;
  const lado = (s: string) => (s === "" ? [] : s.split(":"));
  const a = lado(partes[0]);
  const b = partes.length === 2 ? lado(partes[1]) : [];
  const falta = 8 - a.length - b.length;
  if (partes.length === 1 ? a.length !== 8 : falta < 1) return null;
  const todas = [...a, ...Array(partes.length === 2 ? falta : 0).fill("0"), ...b];
  const n = todas.map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? Number.parseInt(x, 16) : NaN));
  return n.length === 8 && n.every((x) => x >= 0) ? n : null;
}

/**
 * PURA. O IP é público e roteável? Em dúvida (não é IP, formato estranho) diz que não. Recusa o que
 * é privado, loopback, link-local, CGNAT/tailnet, multicast e reservado; no v6, também ::1, fc00::/7
 * (a tailnet usa fd7a:115c:a1e0::/48), fe80::/10, o v4 embutido (::ffff:a.b.c.d, NAT64, 6to4) e a
 * faixa de documentação.
 */
export function ipEhPublico(ip: string): boolean {
  const limpo = ip.trim().replace(/^\[|\]$/g, "");
  if (net.isIPv4(limpo)) {
    const q = v4(limpo);
    return q !== null && !v4Privado(q);
  }
  if (!net.isIPv6(limpo)) return false;
  const w = v6Palavras(limpo);
  if (!w) return false;
  const [p0, p1, p2, p3, p4, p5, p6, p7] = w;
  const embutido = (alto: number, baixo: number) => v4Privado([alto >> 8, alto & 255, baixo >> 8, baixo & 255]);
  if (w.every((x) => x === 0)) return false; // ::
  if (w.slice(0, 7).every((x) => x === 0) && p7 === 1) return false; // ::1
  if (p0 === 0 && p1 === 0 && p2 === 0 && p3 === 0 && p4 === 0 && p5 === 0xffff) return !embutido(p6, p7); // ::ffff:a.b.c.d
  if (p0 === 0 && p1 === 0 && p2 === 0 && p3 === 0 && p4 === 0 && p5 === 0) return false; // ::a.b.c.d (compatível, em desuso)
  if (p0 === 0x64 && p1 === 0xff9b) return false; // NAT64: o v4 de destino não se confere daqui
  if (p0 === 0x2002) return false; // 6to4
  if ((p0 & 0xfe00) === 0xfc00) return false; // fc00::/7
  if ((p0 & 0xffc0) === 0xfe80 || (p0 & 0xffc0) === 0xfec0) return false; // link-local e site-local
  if ((p0 & 0xff00) === 0xff00) return false; // multicast
  if (p0 === 0x2001 && p1 === 0x0db8) return false; // documentação
  if (p0 === 0x2001 && p1 === 0) return false; // Teredo
  return true;
}

// ------------------------------------------------------------------ endereço

const NOMES_DE_MAQUINA = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa|ts\.net|onion)$/i;

export type Resolvedor = (host: string) => Promise<string[]>;

const resolvedorDoSistema: Resolvedor = async (host) =>
  (await dns.promises.lookup(host, { all: true, verbatim: true })).map((e) => e.address);

/**
 * Confere uma URL ANTES de conectar. Devolve a URL já normalizada; joga `SiteBloqueado` com o motivo.
 * Um nome que não resolve joga o erro do DNS (o site está fora do ar, não é ataque).
 */
export async function conferirEndereco(bruto: string, resolver: Resolvedor = resolvedorDoSistema): Promise<URL> {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new SiteBloqueado("Endereço ilegível.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SiteBloqueado("Só http e https.");
  if (url.username || url.password) throw new SiteBloqueado("Endereço com usuário e senha.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new SiteBloqueado("Porta fora de 80 e 443.");
  // "localhost." (ponto final) é o mesmo nome: sem tirá-lo, passaria pelas regras de nome de máquina.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (net.isIP(host)) {
    if (!ipEhPublico(host)) throw new SiteBloqueado("IP que não é público.");
    return url;
  }
  if (!host.includes(".") || NOMES_DE_MAQUINA.test(host)) throw new SiteBloqueado("Nome de máquina, não de site.");
  const enderecos = await resolver(host);
  if (!enderecos.length) throw new Error(`Sem endereço para ${host}.`);
  const ruim = enderecos.find((e) => !ipEhPublico(e));
  if (ruim) throw new SiteBloqueado("O nome aponta para uma rede que não é pública.");
  return url;
}

// ------------------------------------------------------------------ transporte

export interface RespostaMinima {
  status: number;
  headers: { get(nome: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}
export interface PedidoMinimo {
  signal: AbortSignal;
  headers: Record<string, string>;
}
/** `fetch` com `redirect: "manual"` cabe aqui; os testes passam um dublê. */
export type Buscador = (url: string, pedido: PedidoMinimo) => Promise<RespostaMinima>;

/**
 * O buscador de verdade: node:http(s) com um `lookup` que recusa IP não público NA CONEXÃO. Um `fetch`
 * confere o nome antes e resolve de novo ao conectar; aqui o IP conferido é o IP usado. IP literal na
 * URL não passa por `lookup`, e é conferido por `conferirEndereco` antes.
 */
export const buscadorComTravaDeIp: Buscador = (urlBruta, pedido) => new Promise((resolve, reject) => {
  const url = new URL(urlBruta);
  const cliente = url.protocol === "https:" ? https : http;
  const lookup: net.LookupFunction = (host, opcoes, cb) => {
    dns.lookup(host, { all: true, verbatim: true }, (erro, enderecos) => {
      if (erro) return (cb as any)(erro);
      const ruim = enderecos.find((e) => !ipEhPublico(e.address));
      if (ruim || !enderecos.length) return (cb as any)(new SiteBloqueado("O nome aponta para uma rede que não é pública."));
      if (opcoes.all) return (cb as any)(null, enderecos);
      return (cb as any)(null, enderecos[0].address, enderecos[0].family);
    });
  };
  const req = cliente.request(url, { method: "GET", headers: pedido.headers, lookup, signal: pedido.signal }, (res) => {
    resolve({
      status: res.statusCode ?? 0,
      headers: { get: (nome) => { const v = res.headers[nome.toLowerCase()]; return Array.isArray(v) ? v[0] ?? null : v ?? null; } },
      body: Readable.toWeb(res) as ReadableStream<Uint8Array>,
    });
  });
  req.on("error", reject);
  req.end();
});

/** Lê o corpo até o limite; `null` se passou dele (o corte seria enganoso). */
async function lerCorpo(resposta: RespostaMinima, limite: number): Promise<Uint8Array | null> {
  if (!resposta.body) return new Uint8Array();
  const declarado = Number(resposta.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > limite) {
    await resposta.body.cancel().catch(() => undefined);
    return null;
  }
  const leitor = resposta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  const inteiro = new Uint8Array(total);
  let em = 0;
  for (const p of partes) { inteiro.set(p, em); em += p.byteLength; }
  return inteiro;
}

/** UTF-8, ou o charset do cabeçalho / do <meta> (muito site brasileiro antigo é ISO-8859-1). */
function decodificar(bytes: Uint8Array, tipo: string): string {
  const cabeca = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const nome = /charset\s*=\s*["']?([\w-]+)/i.exec(tipo)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(cabeca)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(nome.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ------------------------------------------------------------------ o leitor

export type EstadoDaLeitura = "ok" | "inacessivel" | "bloqueado";

export interface EntradaDeSinais {
  /** O endereço lido: se o do lead mudar, a entrada não vale. */
  url: string;
  lidoEm: string;
  estado: EstadoDaLeitura;
  sinais: SinaisDoSite;
}

export interface ResultadoDaLeitura extends EntradaDeSinais {
  /** `cache`: nada foi pedido ao site. */
  origem: "cache" | "site";
  requisicoes: number;
}

export interface OpcoesDoLeitor {
  /** `<SQUADONE_OPERATIONS_DATA_DIR>/sinais-do-site`. */
  dir: string;
  buscador?: Buscador;
  resolver?: Resolvedor;
  agora?: () => Date;
}

export interface LeitorDeSinais {
  iniciar(): Promise<void>;
  /** As leituras com validade, por id do lead e já com o endereço que foram lidas. Síncrono: a visão do CRM chama toda hora. */
  doCache(): Map<string, EntradaDeSinais>;
  ler(leadId: string, url: string, opcoes?: { forcar?: boolean }): Promise<ResultadoDaLeitura>;
}

const NOME_DO_ARQUIVO = "sinais.json";
const idBom = (id: string) => /^[A-Za-z0-9_:.-]{1,200}$/.test(id);

function validade(entrada: EntradaDeSinais): number {
  return (entrada.estado === "ok" ? VALIDADE_DO_CACHE_DIAS * 24 : VALIDADE_DO_FALHADO_HORAS) * 3600_000;
}

/** PURA. A entrada do disco, se tem a forma certa; senão null (o cache ruim some sozinho). */
export function entradaValida(bruto: unknown): EntradaDeSinais | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const sinais = sinaisValidos(o.sinais);
  if (!sinais || typeof o.url !== "string" || typeof o.lidoEm !== "string" || !Number.isFinite(Date.parse(o.lidoEm))) return null;
  if (o.estado !== "ok" && o.estado !== "inacessivel" && o.estado !== "bloqueado") return null;
  return { url: o.url.slice(0, 2000), lidoEm: o.lidoEm, estado: o.estado, sinais };
}

export function criarLeitorDeSinais(opcoes: OpcoesDoLeitor): LeitorDeSinais {
  const buscador = opcoes.buscador ?? buscadorComTravaDeIp;
  const resolver = opcoes.resolver ?? resolvedorDoSistema;
  const agora = opcoes.agora ?? (() => new Date());
  const arquivo = path.join(opcoes.dir, NOME_DO_ARQUIVO);
  const memoria = new Map<string, EntradaDeSinais>();
  const emVoo = new Map<string, Promise<ResultadoDaLeitura>>();
  let fila: Promise<void> = Promise.resolve();

  const vale = (e: EntradaDeSinais) => agora().getTime() - Date.parse(e.lidoEm) < validade(e);

  function gravar(): Promise<void> {
    // Fila única: duas leituras acabando juntas não pisam no arquivo uma da outra.
    fila = fila.then(async () => {
      const entradas = [...memoria].sort((a, b) => Date.parse(b[1].lidoEm) - Date.parse(a[1].lidoEm)).slice(0, MAX_ENTRADAS_NO_CACHE);
      await fs.mkdir(opcoes.dir, { recursive: true, mode: 0o700 });
      const tmp = `${arquivo}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ versao: 1, entradas: Object.fromEntries(entradas) }), { mode: 0o600 });
      await fs.rename(tmp, arquivo);
    }).catch((erro) => {
      console.error("[sinais-do-site] cache não gravado:", erro instanceof Error ? erro.message : erro);
    });
    return fila;
  }

  /** Uma requisição com o tempo de 10 s; cada uma conta no orçamento. */
  async function pedir(url: string, orcamento: { restam: number }): Promise<RespostaMinima> {
    orcamento.restam -= 1;
    return buscador(url, {
      signal: AbortSignal.timeout(TEMPO_POR_REQUISICAO_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5", "Accept-Language": "pt-BR,pt;q=0.9" },
    });
  }

  /**
   * Segue os redirecionamentos à mão, conferindo cada destino. Devolve a resposta final (200) e a URL
   * dela, ou null se acabou o orçamento, passou de MAX_SALTOS ou a resposta não é 200.
   */
  async function seguir(inicial: URL, orcamento: { restam: number }): Promise<{ resposta: RespostaMinima; url: URL } | null> {
    let url = inicial;
    for (let salto = 0; salto <= MAX_SALTOS; salto += 1) {
      if (orcamento.restam <= 0) return null;
      const resposta = await pedir(url.href, orcamento);
      if (resposta.status >= 300 && resposta.status < 400) {
        await resposta.body?.cancel().catch(() => undefined);
        const destino = resposta.headers.get("location");
        if (!destino) return null;
        // O destino passa pela mesma conferência: um redirecionamento para 127.0.0.1 ou 169.254.x morre aqui.
        url = await conferirEndereco(new URL(destino, url).href, resolver);
        continue;
      }
      if (resposta.status !== 200) {
        await resposta.body?.cancel().catch(() => undefined);
        return null;
      }
      return { resposta, url };
    }
    return null;
  }

  async function lerDoSite(bruto: string): Promise<ResultadoDaLeitura> {
    const orcamento = { restam: MAX_REQUISICOES };
    const lidoEm = agora().toISOString();
    const montar = (estado: EstadoDaLeitura, sinais: SinaisDoSite): ResultadoDaLeitura => ({
      url: bruto, lidoEm, estado, sinais, origem: "site", requisicoes: MAX_REQUISICOES - orcamento.restam,
    });
    let inicial: URL;
    try {
      inicial = await conferirEndereco(bruto, resolver);
    } catch (erro) {
      // O endereço do lead é que é perigoso: o chamador recebe SiteBloqueado e nada é gravado. Nome que
      // não resolve é só um site fora do ar.
      if (erro instanceof SiteBloqueado) throw erro;
      return montar("inacessivel", { ...SEM_FONTE });
    }
    let home: string | null = null;
    let sitemap: string | null = null;
    let origem: URL = inicial;
    try {
      const chegada = await seguir(inicial, orcamento);
      const tipo = chegada?.resposta.headers.get("content-type") ?? "";
      if (chegada && /html|xhtml/i.test(tipo)) {
        const corpo = await lerCorpo(chegada.resposta, MAX_CORPO_BYTES);
        home = corpo ? decodificar(corpo, tipo) : null;
        origem = chegada.url;
      } else if (chegada) {
        await chegada.resposta.body?.cancel().catch(() => undefined);
      }
      if (home && orcamento.restam > 0) {
        try {
          // O mapa do site fica na raiz da origem final; um salto para outro nome é conferido como qualquer outro.
          const mapa = await seguir(await conferirEndereco(new URL("/sitemap.xml", origem).href, resolver), orcamento);
          const tipoDoMapa = mapa?.resposta.headers.get("content-type") ?? "";
          if (mapa && /xml|text/i.test(tipoDoMapa)) {
            const corpo = await lerCorpo(mapa.resposta, MAX_CORPO_BYTES);
            sitemap = corpo ? decodificar(corpo, tipoDoMapa) : null;
          } else if (mapa) {
            await mapa.resposta.body?.cancel().catch(() => undefined);
          }
        } catch {
          // O mapa é um extra: sem ele, só o blog fica sem fonte.
        }
      }
    } catch (erro) {
      if (erro instanceof SiteBloqueado) return montar("bloqueado", { ...SEM_FONTE });
      return montar("inacessivel", { ...SEM_FONTE });
    }
    if (!home) return montar("inacessivel", { ...SEM_FONTE });
    return montar("ok", extrairSinais({ url: bruto, home, sitemap }, agora()));
  }

  return {
    async iniciar() {
      try {
        const dados = JSON.parse(await fs.readFile(arquivo, "utf8")) as { entradas?: Record<string, unknown> };
        for (const [id, bruta] of Object.entries(dados.entradas ?? {})) {
          const entrada = entradaValida(bruta);
          if (entrada && idBom(id)) memoria.set(id, entrada);
        }
      } catch (erro: any) {
        if (erro?.code !== "ENOENT") console.error("[sinais-do-site] cache ilegível, começando vazio:", erro instanceof Error ? erro.message : erro);
      }
    },

    doCache() {
      return new Map([...memoria].filter(([, e]) => e.estado === "ok" && vale(e)));
    },

    ler(leadId, url, { forcar = false } = {}) {
      if (!idBom(leadId)) return Promise.reject(new SiteBloqueado("Id de lead inválido."));
      const guardada = memoria.get(leadId);
      if (!forcar && guardada && guardada.url === url && vale(guardada)) {
        return Promise.resolve({ ...guardada, origem: "cache", requisicoes: 0 });
      }
      // Um toque duplo na Ficha não vira duas rodadas de requisições ao mesmo site.
      const andando = emVoo.get(leadId);
      if (andando) return andando;
      const rodada = lerDoSite(url).then(async (r) => {
        memoria.set(leadId, { url: r.url, lidoEm: r.lidoEm, estado: r.estado, sinais: r.sinais });
        await gravar();
        return r;
      }).finally(() => emVoo.delete(leadId));
      emVoo.set(leadId, rodada);
      return rodada;
    },
  };
}
