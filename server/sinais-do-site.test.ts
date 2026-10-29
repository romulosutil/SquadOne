import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { siteProprioDoLead } from "./crm.ts";
import {
  DIAS_DO_BLOG_PARADO, SEM_FONTE, agenciaDoRodape, blogParadoNoMapa, ehSiteProprio, extrairSinais, linhasDosSinais,
  sinaisValidos, type PaginasDoSite, type SinaisDoSite,
} from "./sinais-do-site.ts";

// HTML sintético, em português, sem rede e sem dado real de lead. O miolo tem texto de sobra para a página
// não parecer a casca vazia de um site montado no navegador.
const MIOLO = "<main><h1>Clínica Exemplo</h1><p>Atendemos adultos e crianças com horário marcado, em um consultório novo no centro da cidade, com estacionamento e acessibilidade para todos os pacientes.</p></main>";
const pagina = (cabeca: string, rodape = "", corpo = MIOLO) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Clínica Exemplo</title>${cabeca}</head><body>${corpo}${rodape}</body></html>`;
const SITE = "https://www.clinicaexemplo.com.br/";
const AGORA = new Date("2026-10-17T12:00:00Z");
const ler = (home: string | null, extra: Partial<PaginasDoSite> = {}) => extrairSinais({ url: SITE, home, ...extra }, AGORA);

describe("extrairSinais: contrato e tri-estado", () => {
  it("as chaves são as do contrato e começam sem fonte", () => {
    assert.deepEqual(Object.keys(SEM_FONTE).sort(), ["blogParado", "rodandoGoogleAds", "rodandoMetaAds", "semAgendamentoOnline", "semSchema", "semSite", "temAgencia"]);
    assert.ok(Object.values(SEM_FONTE).every((v) => v === null));
  });

  it("url indefinida (não se sabe qual é o site): tudo sem fonte, até semSite", () => {
    assert.deepEqual(extrairSinais({ url: undefined, home: pagina("") }, AGORA), SEM_FONTE);
  });

  it("cadastro sem site: semSite verdadeiro e nada mais", () => {
    assert.deepEqual(extrairSinais({ url: null }, AGORA), { ...SEM_FONTE, semSite: true });
    assert.deepEqual(extrairSinais({ url: "" }, AGORA), { ...SEM_FONTE, semSite: true });
  });

  it("site que não abriu: tudo sem fonte, inclusive semSite (fora do ar não é sem site)", () => {
    assert.deepEqual(ler(null), SEM_FONTE);
  });

  it("página lida: semSite falso", () => {
    assert.equal(ler(pagina("")).semSite, false);
  });

  it("casca vazia de site montado no navegador: o que depende do conteúdo fica sem fonte", () => {
    const casca = "<html><head></head><body><div id=\"root\"></div><script src=\"/app.js\"></script></body></html>";
    const s = ler(casca);
    assert.equal(s.semSite, false);
    for (const k of ["temAgencia", "rodandoGoogleAds", "rodandoMetaAds", "semAgendamentoOnline", "semSchema"] as const) assert.equal(s[k], null, k);
  });

  it("a casca vazia com a tag do Google no código ainda prova o anúncio", () => {
    const casca = "<html><head><script async src=\"https://www.googletagmanager.com/gtag/js?id=AW-123456789\"></script></head><body><div id=\"root\"></div></body></html>";
    assert.equal(ler(casca).rodandoGoogleAds, true);
  });
});

describe("extrairSinais: anúncios", () => {
  const casos: Array<[string, string, SinaisDoSite["rodandoGoogleAds"], SinaisDoSite["rodandoMetaAds"]]> = [
    ["gtag AW- no script", '<script async src="https://www.googletagmanager.com/gtag/js?id=AW-1234567890"></script>', true, false],
    ["config AW- inline", "<script>gtag('config', 'AW-1234567890');</script>", true, false],
    ["googleadservices (conversão)", '<script src="https://www.googleadservices.com/pagead/conversion.js"></script>', true, false],
    ["pixel do Meta pelo fbevents", '<script src="https://connect.facebook.net/pt_BR/fbevents.js"></script>', false, true],
    ["pixel do Meta pelo fbq init", "<script>fbq('init', '123456789012345'); fbq('track', 'PageView');</script>", false, true],
    ["os dois", "<script>fbq('init','1');</script><script src=\"https://www.googleadservices.com/pagead/conversion.js\"></script>", true, true],
    ["só Analytics: não é anúncio", '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script>', false, false],
    ["nenhuma tag", "", false, false],
    ["contêiner GTM sem tag à vista: pode haver anúncio lá dentro, sem fonte", '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCDE12"></script>', null, null],
    ["contêiner GTM com a tag à vista: a tag prova o que prova", '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCDE12"></script><script>fbq(\'init\',\'1\')</script>', null, true],
  ];
  for (const [nome, cabeca, google, meta] of casos) {
    it(nome, () => {
      const s = ler(pagina(cabeca));
      assert.equal(s.rodandoGoogleAds, google, "google");
      assert.equal(s.rodandoMetaAds, meta, "meta");
    });
  }
});

describe("extrairSinais: agendamento online", () => {
  const casos: Array<[string, string, boolean]> = [
    ["Calendly", '<a href="https://calendly.com/clinica/consulta">Agende</a>', false],
    ["Doctoralia", '<a href="https://www.doctoralia.com.br/maria-silva">Agenda</a>', false],
    ["Booksy", '<a href="https://booksy.com/pt-br/123">Marcar</a>', false],
    ["Trinks", '<iframe src="https://www.trinks.com/clinica/agendar"></iframe>', false],
    ["frase: agende online", "<p>Agende online a sua consulta em poucos cliques.</p>", false],
    ["frase: agendamento online", "<p>Fazemos agendamento online todos os dias.</p>", false],
    ["link interno de agenda", '<a href="/agendar-consulta">Quero agendar</a>', false],
    ["agende pelo WhatsApp não é agendamento online", '<a href="https://wa.me/5527999990000?text=agende">Agende pelo WhatsApp</a><p>Agende sua consulta pelo telefone.</p>', true],
    ["sem nada de agenda", '<a href="/contato">Contato</a>', true],
  ];
  for (const [nome, extra, semAgenda] of casos) {
    it(nome, () => assert.equal(ler(pagina("", extra)).semAgendamentoOnline, semAgenda));
  }
});

describe("extrairSinais: schema", () => {
  it("JSON-LD com @type: tem schema", () => {
    const ld = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Clínica Exemplo"}</script>';
    assert.equal(ler(pagina(ld)).semSchema, false);
  });
  it("microdados do schema.org: tem schema", () => {
    assert.equal(ler(pagina("", "", `<div itemscope itemtype="https://schema.org/LocalBusiness">${MIOLO}</div>`)).semSchema, false);
  });
  it("JSON-LD sem @type não conta", () => {
    assert.equal(ler(pagina('<script type="application/ld+json">{"nome":"x"}</script>')).semSchema, true);
  });
  it("sem nada: sem schema", () => {
    assert.equal(ler(pagina("")).semSchema, true);
  });
});

describe("agência no rodapé: confiança e o que NÃO se registra", () => {
  const casos: Array<[string, string, { nome: string; confianca: number } | null]> = [
    ["Desenvolvido por com link (0,9)", '<footer><p>© 2026 Clínica. Desenvolvido por <a href="https://agenciaalfa.com.br">Agência Alfa</a></p></footer>', { nome: "Agência Alfa", confianca: 0.9 }],
    ["Criado por", '<footer>Criado por <a href="https://betaweb.com.br/">Beta Web</a></footer>', { nome: "Beta Web", confianca: 0.9 }],
    ["Site por", '<footer>Site por <a href="https://gama.digital">Gama Digital</a></footer>', { nome: "Gama Digital", confianca: 0.9 }],
    ["Feito por", '<footer>Feito por <a href="https://deltacriativa.com.br">Delta Criativa</a></footer>', { nome: "Delta Criativa", confianca: 0.9 }],
    ["Powered by", '<footer>Powered by <a href="https://epsilon.io">Epsilon</a></footer>', { nome: "Epsilon", confianca: 0.9 }],
    ["a frase dentro do próprio link", '<footer><a href="https://zeta.com.br">Desenvolvido por Zeta Marketing</a></footer>', { nome: "Zeta Marketing", confianca: 0.9 }],
    ["logotipo no link: o alt é o nome", '<footer>Desenvolvido por <a href="https://eta.com.br"><img src="/eta.png" alt="Eta Digital"></a></footer>', { nome: "Eta Digital", confianca: 0.9 }],
    ["link descritivo sem frase de crédito (0,75)", '<footer><a href="https://teta.com.br">Agência de marketing digital Teta</a></footer>', { nome: "Agência de marketing digital Teta", confianca: 0.75 }],
    ["crédito em texto puro com nome próprio (0,75)", "<footer><p>Desenvolvido por Iota Sistemas Web</p></footer>", { nome: "Iota Sistemas Web", confianca: 0.75 }],
    // O que não se registra: agência errada num e-mail é pior que nenhuma.
    ["link solto de domínio estranho, sem rótulo (0,35): NÃO registra", '<footer><p>© 2026</p><a href="https://qualquercoisa.com.br">clique aqui</a></footer>', null],
    ["link solto com nome de empresa, sem frase de crédito: NÃO registra", '<footer><a href="https://parceiro-do-bairro.com.br">Parceiro do Bairro</a></footer>', null],
    ["Instagram da própria clínica no rodapé não é agência", '<footer>Desenvolvido por nós <a href="https://instagram.com/clinicaexemplo">@clinicaexemplo</a></footer>', null],
    ["WhatsApp e Maps não são agência", '<footer><a href="https://wa.me/5527999990000">Fale conosco</a> <a href="https://maps.app.goo.gl/abc">Como chegar</a></footer>', null],
    ["link para o próprio domínio não é agência", '<footer>Site por <a href="https://www.clinicaexemplo.com.br/blog">Blog</a></footer>', null],
    ["plataforma de site (Wix) não é agência", '<footer>Criado por <a href="https://www.wix.com">Wix.com</a></footer>', null],
    ["texto puro sem nome próprio", "<footer><p>Desenvolvido por nossa equipe interna.</p></footer>", null],
    ["hospedagem não é agência", '<footer>Hospedado por <a href="https://hostexemplo.com.br">Host Exemplo</a></footer>', null],
    ["sem rodapé nem crédito", "", null],
  ];
  for (const [nome, rodape, esperado] of casos) {
    it(nome, () => assert.deepEqual(agenciaDoRodape(pagina("", rodape), SITE), esperado));
  }

  it("agência com rótulo fraco: temAgencia fica sem fonte e nenhuma agência é registrada", () => {
    const s = ler(pagina("", '<footer><a href="https://qualquercoisa.com.br">clique aqui</a></footer>'));
    assert.equal(s.temAgencia, null);
    assert.equal(s.agencia, undefined);
  });

  it("agência registrada: temAgencia verdadeiro, com nome e confiança ≥ 0,75", () => {
    const s = ler(pagina("", '<footer>Desenvolvido por <a href="https://agenciaalfa.com.br">Agência Alfa</a></footer>'));
    assert.equal(s.temAgencia, true);
    assert.deepEqual(s.agencia, { nome: "Agência Alfa", confianca: 0.9 });
  });

  it("crédito escondido em script ou comentário não conta", () => {
    const rodape = '<footer><script>var x = "Desenvolvido por Agência Fantasma";</script><!-- Desenvolvido por <a href="https://fantasma.com">Fantasma</a> --></footer>';
    assert.equal(agenciaDoRodape(pagina("", rodape), SITE), null);
  });
});

describe("blog parado pelo mapa do site", () => {
  const mapa = (...itens: Array<[string, string?]>) =>
    `<?xml version="1.0"?><urlset>${itens.map(([loc, data]) => `<url><loc>${loc}</loc>${data ? `<lastmod>${data}</lastmod>` : ""}</url>`).join("")}</urlset>`;
  const casos: Array<[string, string, boolean | null]> = [
    ["última publicação há mais de 180 dias: parado", mapa(["https://x.com.br/blog/post-1", "2025-12-01"], ["https://x.com.br/blog/post-2", "2026-03-01"]), true],
    ["publicou no mês passado: em dia", mapa(["https://x.com.br/blog/post-1", "2026-09-20"]), false],
    ["a página Contato atualizada ontem não põe o blog em dia", mapa(["https://x.com.br/contato", "2026-10-16"], ["https://x.com.br/blog/post-1", "2025-01-10"]), true],
    ["notícias também são blog", mapa(["https://x.com.br/noticias/abertura", "2024-05-05"]), true],
    ["sem endereço de blog no mapa: sem fonte", mapa(["https://x.com.br/", "2026-10-01"], ["https://x.com.br/contato", "2026-10-01"]), null],
    ["blog sem datas no mapa: sem fonte", mapa(["https://x.com.br/blog/post-1"]), null],
    ["mapa de mapas: sem fonte", '<sitemapindex><sitemap><loc>https://x.com.br/post-sitemap.xml</loc><lastmod>2020-01-01</lastmod></sitemap></sitemapindex>', null],
    ["lixo: sem fonte", "<html>404</html>", null],
  ];
  for (const [nome, xml, esperado] of casos) {
    it(nome, () => assert.equal(blogParadoNoMapa(xml, AGORA), esperado));
  }

  it("o limite é DIAS_DO_BLOG_PARADO", () => {
    const quando = (dias: number) => new Date(AGORA.getTime() - dias * 86_400_000).toISOString().slice(0, 10);
    assert.equal(blogParadoNoMapa(mapa(["https://x.com.br/blog/a", quando(DIAS_DO_BLOG_PARADO - 3)]), AGORA), false);
    assert.equal(blogParadoNoMapa(mapa(["https://x.com.br/blog/a", quando(DIAS_DO_BLOG_PARADO + 3)]), AGORA), true);
  });

  it("extrairSinais usa o mapa; sem a data de hoje o blog fica sem fonte (a função não lê relógio)", () => {
    const xml = mapa(["https://x.com.br/blog/a", "2024-01-01"]);
    assert.equal(extrairSinais({ url: SITE, home: pagina(""), sitemap: xml }, AGORA).blogParado, true);
    assert.equal(extrairSinais({ url: SITE, home: pagina(""), sitemap: xml }).blogParado, null);
    assert.equal(ler(pagina("")).blogParado, null);
  });
});

describe("ehSiteProprio e siteProprioDoLead", () => {
  const casos: Array<[string, boolean]> = [
    ["https://www.clinicaexemplo.com.br/", true],
    ["https://clinicaexemplo.wixsite.com/inicio", true],
    ["https://www.instagram.com/clinicaexemplo", false],
    ["https://pt-br.facebook.com/clinicaexemplo", false],
    ["https://linktr.ee/clinicaexemplo", false],
    ["https://wa.me/5527999990000", false],
    ["https://maps.app.goo.gl/abc123", false],
    ["https://www.google.com/maps/place/x", false],
    ["isto não é uma url", false],
  ];
  for (const [url, esperado] of casos) it(`${url} -> ${esperado}`, () => assert.equal(ehSiteProprio(url), esperado));

  it("o site do lead: o do Site antes da venda é o demo (não se sabe); os outros leem links.site", () => {
    assert.equal(siteProprioDoLead({ produto: "site", links: { site: "https://demo.vercel.app" } }), undefined);
    assert.equal(siteProprioDoLead({ produto: "prumo", links: { site: SITE } }), SITE);
    assert.equal(siteProprioDoLead({ produto: "iris", links: {} }), null);
    assert.equal(siteProprioDoLead({ produto: "estampa", links: { site: "https://www.instagram.com/loja" } }), undefined);
    assert.equal(siteProprioDoLead({ produto: "plus", links: { site: SITE } }), SITE);
  });
});

// 29/10/2026: os sinais do site saíram da Prioridade da Triagem (a soma 100 não tem parte para eles);
// a pontuação se testa em src/operations-pontuacao-da-triagem.test.ts.
describe("Ficha", () => {
  const com = (s: Partial<SinaisDoSite>): SinaisDoSite => ({ ...SEM_FONTE, ...s });

  it("a Ficha mostra só o que tem fonte", () => {
    assert.deepEqual(linhasDosSinais(SEM_FONTE), []);
    assert.deepEqual(linhasDosSinais(undefined), []);
    const linhas = linhasDosSinais(com({ semSite: false, rodandoGoogleAds: true, rodandoMetaAds: false, semAgendamentoOnline: true, temAgencia: true, agencia: { nome: "Agência Alfa", confianca: 0.9 } }));
    assert.deepEqual(linhas.map((l) => l.rotulo), ["Já tem agência", "Anúncios do Google", "Sem agendamento online"]);
    assert.match(linhas[0].motivo, /Agência Alfa/);
    assert.deepEqual(linhasDosSinais(com({ semSite: true })).map((l) => l.rotulo), ["Sem site"]);
    assert.deepEqual(linhasDosSinais(com({ rodandoGoogleAds: false, rodandoMetaAds: false })).map((l) => l.rotulo), ["Sem anúncios no site"]);
  });
});

describe("sinaisValidos: o que vem do disco", () => {
  const bom: SinaisDoSite = { ...SEM_FONTE, semSite: false, rodandoMetaAds: true, temAgencia: true, agencia: { nome: "Agência Alfa", confianca: 0.9 } };
  it("aceita o que a extração produz, inclusive depois de ir e voltar por JSON", () => {
    assert.deepEqual(sinaisValidos(JSON.parse(JSON.stringify(bom))), bom);
    assert.deepEqual(sinaisValidos(JSON.parse(JSON.stringify(SEM_FONTE))), SEM_FONTE);
  });
  const ruins: Array<[string, unknown]> = [
    ["não é objeto", "texto"],
    ["falta chave", { temAgencia: null }],
    ["valor que não é tri-estado", { ...SEM_FONTE, semSite: "sim" }],
    ["agência com confiança abaixo do piso", { ...SEM_FONTE, temAgencia: true, agencia: { nome: "X", confianca: 0.35 } }],
    ["temAgencia sem a agência", { ...SEM_FONTE, temAgencia: true }],
    ["agência sem temAgencia", { ...SEM_FONTE, agencia: { nome: "X", confianca: 0.9 } }],
    ["agência com nome vazio", { ...SEM_FONTE, temAgencia: true, agencia: { nome: " ", confianca: 0.9 } }],
  ];
  for (const [nome, valor] of ruins) it(`recusa: ${nome}`, () => assert.equal(sinaisValidos(valor), null));
});
