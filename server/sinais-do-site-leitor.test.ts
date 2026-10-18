import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  MAX_CORPO_BYTES, MAX_REQUISICOES, SiteBloqueado, USER_AGENT, VALIDADE_DO_CACHE_DIAS, buscadorComTravaDeIp, conferirEndereco,
  criarLeitorDeSinais, entradaValida, ipEhPublico, type Buscador, type Resolvedor,
} from "./sinais-do-site-leitor.ts";
import { SEM_FONTE } from "./sinais-do-site.ts";

// Nada aqui toca a rede nem o data/ de verdade: o buscador é um dublê, o DNS é uma tabela, o cache vai para
// uma pasta temporária. O único servidor é um http em 127.0.0.1 que o teste do buscador de verdade espera
// que NUNCA seja alcançado.

const MIOLO = "<main><h1>Clínica Exemplo</h1><p>Atendemos adultos e crianças com horário marcado, em um consultório novo no centro da cidade, com estacionamento e acessibilidade para todos os pacientes.</p></main>";
const HOME_COM_TUDO = `<!doctype html><html><head><title>x</title><script async src="https://www.googletagmanager.com/gtag/js?id=AW-1234567890"></script></head><body>${MIOLO}<footer>Desenvolvido por <a href="https://agenciaalfa.com.br">Agência Alfa</a></footer></body></html>`;
const MAPA_PARADO = '<urlset><url><loc>https://clinicaexemplo.com.br/blog/a</loc><lastmod>2024-01-01</lastmod></url></urlset>';

const PUBLICOS: Record<string, string[]> = { "clinicaexemplo.com.br": ["93.184.216.9"], "www.clinicaexemplo.com.br": ["93.184.216.10"], "outro.com.br": ["93.184.216.11"] };
const resolver: Resolvedor = async (host) => {
  if (host === "interno.exemplo.com.br") return ["10.0.0.5"];
  if (host === "meio.exemplo.com.br") return ["93.184.216.12", "127.0.0.1"];
  if (host === "sumido.exemplo.com.br") throw new Error("ENOTFOUND");
  return PUBLICOS[host] ?? ["93.184.216.99"];
};

const resposta = (status: number, corpo: string | Uint8Array | null, tipo = "text/html; charset=utf-8", extra: Record<string, string> = {}) =>
  new Response(corpo as BodyInit | null, { status, headers: { "content-type": tipo, ...extra } });

interface Chamada { url: string; headers: Record<string, string> }
function dubleDoSite(roteiro: Record<string, () => Response>) {
  const chamadas: Chamada[] = [];
  const buscador: Buscador = async (url, pedido) => {
    chamadas.push({ url, headers: pedido.headers });
    assert.ok(pedido.signal instanceof AbortSignal, "toda requisição leva o tempo limite");
    const faz = roteiro[url];
    if (!faz) return resposta(404, "não achei");
    return faz();
  };
  return { buscador, chamadas };
}

const pastas: string[] = [];
async function pastaTemporaria() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sinais-do-site-"));
  pastas.push(dir);
  return dir;
}
afterEach(async () => {
  while (pastas.length) await fs.rm(pastas.pop()!, { recursive: true, force: true });
});

describe("ipEhPublico", () => {
  const casos: Array<[string, boolean]> = [
    ["93.184.216.34", true], ["8.8.8.8", true], ["2606:2800:220:1:248:1893:25c8:1946", true], ["2001:4860:4860::8888", true],
    ["127.0.0.1", false], ["127.8.8.8", false], ["10.1.2.3", false], ["172.16.0.1", false], ["172.31.255.255", false], ["172.32.0.1", true],
    ["192.168.1.1", false], ["169.254.169.254", false], ["169.254.0.1", false], ["0.0.0.0", false], ["255.255.255.255", false], ["224.0.0.1", false],
    ["100.64.0.1", false], ["100.127.255.255", false], ["100.128.0.1", true], ["100.100.100.100", false], // CGNAT: a tailnet
    ["198.18.0.1", false], ["192.0.2.1", false], ["203.0.113.5", false],
    ["::1", false], ["::", false], ["fe80::1", false], ["fc00::1", false], ["fd7a:115c:a1e0::1", false], ["ff02::1", false],
    ["::ffff:127.0.0.1", false], ["::ffff:7f00:1", false], ["::ffff:10.0.0.1", false], ["::ffff:169.254.169.254", false], ["::ffff:93.184.216.34", true],
    ["64:ff9b::7f00:1", false], ["2002:7f00:1::1", false], ["2001:db8::1", false],
    ["[::1]", false], ["999.1.1.1", false], ["isto não é ip", false], ["", false],
  ];
  for (const [ip, esperado] of casos) it(`${ip || "(vazio)"} -> ${esperado ? "público" : "recusado"}`, () => assert.equal(ipEhPublico(ip), esperado));
});

describe("conferirEndereco: SSRF", () => {
  const bloqueados: Array<[string, string]> = [
    ["loopback por IP", "http://127.0.0.1/"],
    ["loopback com porta permitida", "http://127.0.0.1:80/admin"],
    ["localhost", "http://localhost/"],
    ["localhost com ponto no fim e maiúsculas", "http://LocalHost./"],
    ["IP privado 10.x", "http://10.0.0.5/"],
    ["IP privado 192.168.x", "https://192.168.0.1/"],
    ["metadata de nuvem", "http://169.254.169.254/latest/meta-data/"],
    ["IP da tailnet (CGNAT)", "http://100.64.12.34/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["IPv6 da tailnet", "http://[fd7a:115c:a1e0::1]/"],
    ["IPv4 dentro de IPv6", "http://[::ffff:127.0.0.1]/"],
    ["IP em decimal (o parser da URL normaliza para 127.0.0.1)", "http://2130706433/"],
    ["nome da tailnet", "https://mel.tail1234.ts.net/"],
    ["nome .local", "http://impressora.local/"],
    ["nome .internal", "http://api.internal/"],
    ["nome sem ponto", "http://mel/"],
    ["nome que resolve para rede privada", "https://interno.exemplo.com.br/"],
    ["nome com um endereço público e outro privado (rebinding por registro duplo)", "https://meio.exemplo.com.br/"],
    ["porta fora de 80 e 443", "http://clinicaexemplo.com.br:8080/"],
    ["porta de banco", "https://clinicaexemplo.com.br:5432/"],
    ["usuário e senha na URL", "https://admin:senha@clinicaexemplo.com.br/"],
    ["esquema file", "file:///etc/passwd"],
    ["esquema ftp", "ftp://clinicaexemplo.com.br/"],
    ["lixo", "isto não é uma url"],
  ];
  for (const [nome, url] of bloqueados) {
    it(`recusa: ${nome}`, async () => {
      await assert.rejects(conferirEndereco(url, resolver), SiteBloqueado);
    });
  }

  it("aceita site público, em http e https, nas portas 80 e 443", async () => {
    for (const url of ["https://www.clinicaexemplo.com.br/", "http://clinicaexemplo.com.br/", "https://clinicaexemplo.com.br:443/x", "http://clinicaexemplo.com.br:80/"]) {
      assert.equal((await conferirEndereco(url, resolver)).hostname.endsWith("clinicaexemplo.com.br"), true, url);
    }
  });

  it("nome que não resolve não é ataque: o erro do DNS passa, e não é SiteBloqueado", async () => {
    await assert.rejects(conferirEndereco("https://sumido.exemplo.com.br/", resolver), (e) => !(e instanceof SiteBloqueado));
  });
});

describe("leitor: uma leitura", () => {
  it("lê a página inicial e o mapa do site: 2 requisições, User-Agent que diz quem somos", async () => {
    const dir = await pastaTemporaria();
    const { buscador, chamadas } = dubleDoSite({
      "https://www.clinicaexemplo.com.br/": () => resposta(200, HOME_COM_TUDO),
      "https://www.clinicaexemplo.com.br/sitemap.xml": () => resposta(200, MAPA_PARADO, "application/xml"),
    });
    const leitor = criarLeitorDeSinais({ dir, buscador, resolver, agora: () => new Date("2026-10-17T12:00:00Z") });
    const r = await leitor.ler("prumo:abc", "https://www.clinicaexemplo.com.br/");
    assert.equal(r.estado, "ok");
    assert.equal(r.origem, "site");
    assert.equal(r.requisicoes, 2);
    assert.deepEqual(chamadas.map((c) => c.url), ["https://www.clinicaexemplo.com.br/", "https://www.clinicaexemplo.com.br/sitemap.xml"]);
    assert.ok(chamadas.every((c) => c.headers["User-Agent"] === USER_AGENT));
    assert.match(USER_AGENT, /SquadOne/);
    assert.equal(r.sinais.rodandoGoogleAds, true);
    assert.equal(r.sinais.temAgencia, true);
    assert.equal(r.sinais.blogParado, true);
    assert.equal(r.sinais.semSite, false);
  });

  it("sem mapa do site (404), o resto vale e só o blog fica sem fonte", async () => {
    const { buscador } = dubleDoSite({ "https://clinicaexemplo.com.br/": () => resposta(200, HOME_COM_TUDO) });
    const leitor = criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador, resolver });
    const r = await leitor.ler("prumo:abc", "https://clinicaexemplo.com.br/");
    assert.equal(r.estado, "ok");
    assert.equal(r.sinais.blogParado, null);
    assert.equal(r.sinais.rodandoGoogleAds, true);
  });

  it("decodifica ISO-8859-1 declarado no cabeçalho", async () => {
    const html = new TextEncoder().encode(HOME_COM_TUDO.replace("Clínica Exemplo", "CLÍNICA").replace("adultos e crianças", "adultos e crianças"));
    const latin1 = Uint8Array.from(Buffer.from(Buffer.from(html).toString("utf8"), "latin1"));
    const { buscador } = dubleDoSite({ "https://clinicaexemplo.com.br/": () => resposta(200, latin1, "text/html; charset=iso-8859-1") });
    const r = await criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador, resolver }).ler("prumo:a", "https://clinicaexemplo.com.br/");
    assert.equal(r.estado, "ok");
    assert.equal(r.sinais.temAgencia, true);
  });

  it("segue um redirecionamento http -> https -> www, contando cada salto: 3 requisições, sem mapa do site", async () => {
    const { buscador, chamadas } = dubleDoSite({
      "http://clinicaexemplo.com.br/": () => resposta(301, null, "text/html", { location: "https://clinicaexemplo.com.br/" }),
      "https://clinicaexemplo.com.br/": () => resposta(301, null, "text/html", { location: "https://www.clinicaexemplo.com.br/" }),
      "https://www.clinicaexemplo.com.br/": () => resposta(200, HOME_COM_TUDO),
    });
    const r = await criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador, resolver }).ler("prumo:a", "http://clinicaexemplo.com.br/");
    assert.equal(r.estado, "ok");
    assert.equal(chamadas.length, 3);
    assert.ok(chamadas.length <= MAX_REQUISICOES);
    assert.equal(r.requisicoes, 3);
  });

  it("nunca passa de 3 requisições, mesmo com laço de redirecionamento", async () => {
    const { buscador, chamadas } = dubleDoSite({
      "https://clinicaexemplo.com.br/": () => resposta(302, null, "text/html", { location: "https://clinicaexemplo.com.br/outra" }),
      "https://clinicaexemplo.com.br/outra": () => resposta(302, null, "text/html", { location: "https://clinicaexemplo.com.br/" }),
    });
    const r = await criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador, resolver }).ler("prumo:a", "https://clinicaexemplo.com.br/");
    assert.equal(r.estado, "inacessivel");
    assert.equal(chamadas.length, MAX_REQUISICOES);
    assert.deepEqual(r.sinais, SEM_FONTE);
  });

  it("redirecionamento para o loopback é recusado SEM fazer a requisição", async () => {
    const { buscador, chamadas } = dubleDoSite({
      "https://clinicaexemplo.com.br/": () => resposta(302, null, "text/html", { location: "http://127.0.0.1:80/admin" }),
      "http://127.0.0.1/admin": () => resposta(200, "SEGREDO"),
    });
    const r = await criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador, resolver }).ler("prumo:a", "https://clinicaexemplo.com.br/");
    assert.equal(r.estado, "bloqueado");
    assert.deepEqual(chamadas.map((c) => c.url), ["https://clinicaexemplo.com.br/"]);
    assert.deepEqual(r.sinais, SEM_FONTE);
  });

  for (const destino of ["http://169.254.169.254/latest/meta-data/", "http://100.100.100.100/", "http://interno.exemplo.com.br/", "http://[::1]/", "file:///etc/passwd"]) {
    it(`redirecionamento para ${destino} é recusado`, async () => {
      const { buscador, chamadas } = dubleDoSite({ "https://clinicaexemplo.com.br/": () => resposta(307, null, "text/html", { location: destino }) });
      const r = await criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador, resolver }).ler("prumo:a", "https://clinicaexemplo.com.br/");
      assert.equal(r.estado, "bloqueado");
      assert.equal(chamadas.length, 1);
    });
  }

  it("endereço do lead que já é perigoso: joga SiteBloqueado, não pede nada e não grava nada", async () => {
    const dir = await pastaTemporaria();
    const { buscador, chamadas } = dubleDoSite({});
    const leitor = criarLeitorDeSinais({ dir, buscador, resolver });
    for (const url of ["http://127.0.0.1/", "http://169.254.169.254/", "http://localhost/", "https://interno.exemplo.com.br/"]) {
      await assert.rejects(leitor.ler("prumo:a", url), SiteBloqueado, url);
    }
    assert.equal(chamadas.length, 0);
    assert.equal(leitor.doCache().size, 0);
    await assert.rejects(fs.stat(path.join(dir, "sinais.json")));
  });

  it("id de lead com cara de caminho é recusado", async () => {
    const leitor = criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador: dubleDoSite({}).buscador, resolver });
    await assert.rejects(leitor.ler("../../etc/passwd", "https://clinicaexemplo.com.br/"), SiteBloqueado);
  });

  const inacessiveis: Array<[string, () => Response]> = [
    ["404", () => resposta(404, "não achei")],
    ["500", () => resposta(500, "erro")],
    ["não é HTML", () => resposta(200, "%PDF-1.4", "application/pdf")],
    ["maior que o limite (cortar a página esconderia o rodapé)", () => resposta(200, new Uint8Array(MAX_CORPO_BYTES + 1024).fill(97))],
  ];
  for (const [nome, faz] of inacessiveis) {
    it(`${nome}: inacessível, tudo sem fonte`, async () => {
      const { buscador } = dubleDoSite({ "https://clinicaexemplo.com.br/": faz });
      const r = await criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador, resolver }).ler("prumo:a", "https://clinicaexemplo.com.br/");
      assert.equal(r.estado, "inacessivel");
      assert.deepEqual(r.sinais, SEM_FONTE);
    });
  }

  it("falha de rede e nome que não resolve: inacessível, sem derrubar nada", async () => {
    const quebra: Buscador = async () => { throw new Error("ECONNRESET"); };
    const leitor = criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador: quebra, resolver });
    assert.equal((await leitor.ler("prumo:a", "https://clinicaexemplo.com.br/")).estado, "inacessivel");
    assert.equal((await leitor.ler("prumo:b", "https://sumido.exemplo.com.br/")).estado, "inacessivel");
  });
});

describe("leitor: cache em disco", () => {
  const agoraEm = (iso: string) => ({ valor: new Date(iso) });

  it("a segunda leitura vem do cache, sem requisição; o endereço novo invalida; forcar relê", async () => {
    const dir = await pastaTemporaria();
    const { buscador, chamadas } = dubleDoSite({
      "https://clinicaexemplo.com.br/": () => resposta(200, HOME_COM_TUDO),
      "https://outro.com.br/": () => resposta(200, HOME_COM_TUDO),
    });
    const leitor = criarLeitorDeSinais({ dir, buscador, resolver });
    await leitor.ler("prumo:a", "https://clinicaexemplo.com.br/");
    const antes = chamadas.length;
    const segunda = await leitor.ler("prumo:a", "https://clinicaexemplo.com.br/");
    assert.equal(segunda.origem, "cache");
    assert.equal(segunda.requisicoes, 0);
    assert.equal(chamadas.length, antes);
    assert.equal((await leitor.ler("prumo:a", "https://outro.com.br/")).origem, "site");
    const forcada = await leitor.ler("prumo:a", "https://outro.com.br/", { forcar: true });
    assert.equal(forcada.origem, "site");
  });

  it("dois toques juntos viram uma rodada só de requisições", async () => {
    let soltar!: () => void;
    const porta = new Promise<void>((r) => { soltar = r; });
    const chamadas: string[] = [];
    const buscador: Buscador = async (url) => { chamadas.push(url); await porta; return url.endsWith("sitemap.xml") ? resposta(404, "") : resposta(200, HOME_COM_TUDO); };
    const leitor = criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador, resolver });
    const a = leitor.ler("prumo:a", "https://clinicaexemplo.com.br/");
    const b = leitor.ler("prumo:a", "https://clinicaexemplo.com.br/");
    soltar();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, rb);
    assert.equal(chamadas.length, 2); // a página inicial e o mapa, uma vez só
  });

  it("grava um arquivo legível por quem reinicia, com permissão 600 onde o sistema dá", async () => {
    const dir = await pastaTemporaria();
    const { buscador } = dubleDoSite({ "https://clinicaexemplo.com.br/": () => resposta(200, HOME_COM_TUDO) });
    await criarLeitorDeSinais({ dir, buscador, resolver }).ler("prumo:a", "https://clinicaexemplo.com.br/");
    const arquivo = path.join(dir, "sinais.json");
    const dados = JSON.parse(await fs.readFile(arquivo, "utf8"));
    assert.equal(dados.versao, 1);
    assert.equal(dados.entradas["prumo:a"].url, "https://clinicaexemplo.com.br/");
    if (process.platform !== "win32") assert.equal((await fs.stat(arquivo)).mode & 0o777, 0o600);

    // Um processo novo lê o que o antigo guardou, sem tocar a rede.
    const novo = criarLeitorDeSinais({ dir, buscador: dubleDoSite({}).buscador, resolver });
    await novo.iniciar();
    const guardada = novo.doCache().get("prumo:a");
    assert.equal(guardada?.url, "https://clinicaexemplo.com.br/");
    assert.equal(guardada?.sinais.rodandoGoogleAds, true);
  });

  it("dados de cache ilegíveis ou com forma errada são descartados, sem derrubar o leitor", async () => {
    const dir = await pastaTemporaria();
    await fs.writeFile(path.join(dir, "sinais.json"), JSON.stringify({ versao: 1, entradas: {
      "prumo:ok": { url: "https://a.com.br/", lidoEm: "2026-10-17T12:00:00Z", estado: "ok", sinais: SEM_FONTE },
      "prumo:ruim": { url: "https://b.com.br/", lidoEm: "ontem", estado: "ok", sinais: SEM_FONTE },
      "prumo:forma": { url: "https://c.com.br/", lidoEm: "2026-10-17T12:00:00Z", estado: "ok", sinais: { temAgencia: "sim" } },
      "../fora": { url: "https://d.com.br/", lidoEm: "2026-10-17T12:00:00Z", estado: "ok", sinais: SEM_FONTE },
    } }));
    const leitor = criarLeitorDeSinais({ dir, buscador: dubleDoSite({}).buscador, resolver, agora: () => new Date("2026-10-17T13:00:00Z") });
    await leitor.iniciar();
    assert.deepEqual([...leitor.doCache().keys()], ["prumo:ok"]);
    await fs.writeFile(path.join(dir, "sinais.json"), "{ não é json");
    const vazio = criarLeitorDeSinais({ dir, buscador: dubleDoSite({}).buscador, resolver });
    await vazio.iniciar();
    assert.equal(vazio.doCache().size, 0);
    assert.equal(entradaValida(null), null);
  });

  it(`a leitura vale ${VALIDADE_DO_CACHE_DIAS} dias; depois, relê`, async () => {
    const relogio = agoraEm("2026-10-17T12:00:00Z");
    const { buscador, chamadas } = dubleDoSite({ "https://clinicaexemplo.com.br/": () => resposta(200, HOME_COM_TUDO) });
    const leitor = criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador, resolver, agora: () => relogio.valor });
    await leitor.ler("prumo:a", "https://clinicaexemplo.com.br/");
    const n = chamadas.length;
    relogio.valor = new Date("2026-10-23T12:00:00Z");
    assert.equal((await leitor.ler("prumo:a", "https://clinicaexemplo.com.br/")).origem, "cache");
    assert.equal(leitor.doCache().size, 1);
    relogio.valor = new Date("2026-10-25T12:00:00Z");
    assert.equal(leitor.doCache().size, 0, "vencida, a visão do CRM não a usa mais");
    assert.equal((await leitor.ler("prumo:a", "https://clinicaexemplo.com.br/")).origem, "site");
    assert.ok(chamadas.length > n);
  });

  it("site que não respondeu não alimenta a visão do CRM e é tentado de novo em algumas horas", async () => {
    const relogio = agoraEm("2026-10-17T12:00:00Z");
    let no_ar = false;
    const buscador: Buscador = async (url) => (no_ar && !url.endsWith("sitemap.xml") ? resposta(200, HOME_COM_TUDO) : resposta(503, "fora"));
    const leitor = criarLeitorDeSinais({ dir: await pastaTemporaria(), buscador, resolver, agora: () => relogio.valor });
    assert.equal((await leitor.ler("prumo:a", "https://clinicaexemplo.com.br/")).estado, "inacessivel");
    assert.equal(leitor.doCache().size, 0);
    relogio.valor = new Date("2026-10-17T13:00:00Z");
    assert.equal((await leitor.ler("prumo:a", "https://clinicaexemplo.com.br/")).origem, "cache");
    no_ar = true;
    relogio.valor = new Date("2026-10-17T19:00:00Z");
    assert.equal((await leitor.ler("prumo:a", "https://clinicaexemplo.com.br/")).estado, "ok");
  });
});

describe("buscadorComTravaDeIp: o buscador de verdade não conecta em rede privada", () => {
  it("o nome 'localhost' vira 127.0.0.1/::1 e o lookup recusa ANTES de conectar: o servidor local não vê nada", async () => {
    let pedidos = 0;
    const servidor = http.createServer((_req, res) => { pedidos += 1; res.end("segredo"); });
    await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
    try {
      const { port } = servidor.address() as { port: number };
      await assert.rejects(
        buscadorComTravaDeIp(`http://localhost:${port}/`, { signal: AbortSignal.timeout(5000), headers: {} }),
        (e: unknown) => e instanceof SiteBloqueado,
      );
      assert.equal(pedidos, 0);
    } finally {
      await new Promise<void>((ok) => servidor.close(() => ok()));
    }
  });
});
