import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  CrmStore,
  LIMITE_DO_PLUS_NA_HOJE,
  conferirEnvio,
  lerPlus,
  montarCrm,
  validarRegistro,
  validarRetrato,
  type CrmLead,
  type PlusLido,
} from "./crm.ts";
import { lerCatalogo, normalizarTelefone, prepararPlus, type CartaoDoCatalogo, type ItemDoPdf, type LeadPlus } from "./plus-catalogo.ts";
import { PRIMEIRA_PLUS, followupDoPlus, primeiraDoPlus, referenciasDaEmpresa } from "./plus-mensagem.ts";
import { chaveDoNumero } from "./conversa-do-lead.ts";

// Tudo fixture: nenhum PDF, planilha ou n8n real; o que grava usa diretório temporário (nunca data/).
const AGORA = new Date("2026-10-15T15:00:00Z"); // 12:00 em São Paulo
const dias = (n: number) => new Date(AGORA.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe("Plus: telefone do catálogo", () => {
  const casos: Array<[string, { whatsapp: string; fixo: boolean } | null]> = [
    ["(81) 99985-1586", { whatsapp: "5581999851586", fixo: false }],
    ["68992465611", { whatsapp: "5568992465611", fixo: false }],
    ["3832131533", { whatsapp: "553832131533", fixo: true }],
    ["(38)3821-4449", { whatsapp: "553838214449", fixo: true }],
    ["(081)9.8147.8194", { whatsapp: "5581981478194", fixo: false }], // zero de operadora
    ["55 41 999755873", { whatsapp: "5541999755873", fixo: false }], // 55 na frente
    ["210993405288", { whatsapp: "5521993405288", fixo: false }], // zero perdido depois do DDD
    ["(48) 966-05785", null], // 10 dígitos começando em 9: não adivinha o nono dígito
    ["12345", null],
    ["", null],
  ];
  for (const [bruto, esperado] of casos) {
    it(`"${bruto}" -> ${esperado ? esperado.whatsapp + (esperado.fixo ? " (fixo)" : "") : "ilegível"}`, () => {
      assert.deepEqual(normalizarTelefone(bruto), esperado);
    });
  }
});

describe("Plus: leitura do PDF em três colunas", () => {
  const nome = (s: string, x: number, y: number): ItemDoPdf => ({ s, x, y, h: 9.5 });
  const fone = (s: string, x: number, y: number): ItemDoPdf => ({ s, x, y, h: 7.8 });
  const desc = (s: string, x: number, y: number): ItemDoPdf => ({ s, x, y, h: 7.3 });
  const cab = (s: string, y: number): ItemDoPdf => ({ s, x: 34, y, h: 10.5 });

  const pagina1: ItemDoPdf[] = [
    { s: "Catálogo de Negócios Maçonicos", x: 100, y: 800, h: 16 },
    cab("CIDADE: Vitória - ES", 700),
    nome("Corrêa Registro de Marcas e", 29, 660), nome("Patentes", 29, 648.6), fone("(27) 99767-1803", 29, 636), desc("Registro de marcas no INPI.", 29, 625),
    nome("Padaria Pão Quente", 215, 660), fone("https://padariapao.com.br", 215, 648), desc("Pães e doces.", 215, 637),
    nome("Barbearia Navalha", 401, 660), fone("27995153447", 401, 648), fone("https://www.instagram.com/navalha", 401, 640), fone("barbearia_oficial?igsh=abc", 401, 632),
    cab("CIDADE: Serra - ES", 560),
    nome("Alan Motos", 29, 520), desc("Compro | Vendo | Troco", 29, 509),
    { s: "Página 1 de 2", x: 516, y: 36.6, h: 8 },
  ];
  const pagina2: ItemDoPdf[] = [
    nome("Mineirão Mudanças", 29, 740), fone("(27) 98831-0851", 29, 728), desc("Transportes e mudanças", 29, 717),
    cab("CIDADE: Cariacica - ES", 640),
    nome("Soluções em Viagens", 215, 600), fone("(27) 99767-1803", 215, 588), desc("Agência de viagens", 215, 577),
  ];
  const cartoes = lerCatalogo([pagina1, pagina2]);
  const por = (n: string) => cartoes.find((c) => c.nome === n);

  it("a capa não vira empresa e o nome de duas linhas vira um só", () => {
    assert.equal(cartoes.length, 6);
    assert.ok(por("Corrêa Registro de Marcas e Patentes"));
    assert.ok(!cartoes.some((c) => /Catálogo/.test(c.nome)));
  });

  it("cada cartão fica com a cidade do cabeçalho mais próximo acima dele", () => {
    assert.deepEqual([por("Padaria Pão Quente")?.cidade, por("Padaria Pão Quente")?.uf], ["Vitória", "ES"]);
    assert.equal(por("Alan Motos")?.cidade, "Serra");
    assert.equal(por("Soluções em Viagens")?.cidade, "Cariacica");
  });

  it("a cidade da página anterior vale no topo da seguinte", () => {
    assert.equal(por("Mineirão Mudanças")?.cidade, "Serra", "o último cabeçalho da página 1 era Serra");
  });

  it("telefone, descrição e o link quebrado em duas linhas", () => {
    assert.deepEqual(por("Corrêa Registro de Marcas e Patentes")?.telefones, ["(27) 99767-1803"]);
    assert.equal(por("Corrêa Registro de Marcas e Patentes")?.descricao, "Registro de marcas no INPI.");
    assert.deepEqual(por("Barbearia Navalha")?.links, ["https://www.instagram.com/navalhabarbearia_oficial?igsh=abc"]);
    assert.deepEqual(por("Padaria Pão Quente")?.links, ["https://padariapao.com.br"]);
  });

  it("rodapé e cabeçalho de página ficam de fora", () => {
    assert.ok(!cartoes.some((c) => /Página/.test(c.nome) || /Página/.test(c.descricao)));
  });
});

describe("Plus: do cartão ao lead", () => {
  const cartao = (nome: string, extra: Partial<CartaoDoCatalogo> = {}): CartaoDoCatalogo =>
    ({ nome, cidade: "Vitória", uf: "ES", telefones: ["(27) 99999-0001"], links: [], descricao: "", ...extra });

  it("a oferta sai do que a empresa é e do que ela tem", () => {
    const { leads } = prepararPlus([
      cartao("Camisas personalizadas", { telefones: ["(24) 99262-5454"], descricao: "Camisas personalizadas, fazemos qualquer estampa" }),
      cartao("Ateliê dos afetos", { telefones: ["(81) 99855-3683"], descricao: "Atendimento em psicanálise e psicologia." }),
      cartao("Viaconta Contabilidade", { telefones: ["(92) 99109-2227"], links: ["Viaconta.com.br"], descricao: "Serviços de Contabilidade" }),
      cartao("Padaria sem site", { telefones: ["(27) 99999-0003"], links: ["https://www.instagram.com/padaria_sem_site"] }),
      cartao("Caneca do Irmão", { telefones: ["(31) 99620-0050"], descricao: "Canecas e azulejos personalizados" }),
    ]);
    const oferta = (n: string) => leads.find((l) => l.empresa === n)?.oferta;
    assert.equal(oferta("Camisas personalizadas"), "estampa");
    assert.equal(oferta("Ateliê dos afetos"), "iris");
    assert.equal(oferta("Viaconta Contabilidade"), "prumo", "tem site: serviços do PRUMO");
    assert.equal(oferta("Padaria sem site"), "site", "só Instagram não é site");
    assert.equal(oferta("Caneca do Irmão"), "site", "caneca não é estamparia de roupa");
    assert.equal(leads.find((l) => l.empresa === "Padaria sem site")?.instagram, "padaria_sem_site");
    assert.equal(leads.find((l) => l.empresa === "Viaconta Contabilidade")?.site, "https://Viaconta.com.br");
  });

  it("o mesmo WhatsApp é um lead só, com os outros nomes em `tambem`", () => {
    const { leads } = prepararPlus([
      cartao("Agrosumma Serviços Ltda", { telefones: ["61984013531"], descricao: "Comercialização de commodities (soja, milho)" }),
      cartao("GOAT CIGAR", { telefones: ["61984013531"], descricao: "O Charuto Goat Reserva é mais do que um charuto" }),
      cartao("Viaconta Contabilidade", { telefones: ["92991092227"], links: ["viaconta.com.br"] }),
      cartao("Viaconta Contabilidade", { telefones: ["92991092227"], links: ["https://viaconta.com.br"], descricao: "Serviços de Contabilidade, abertura de empresas, Regularização" }),
    ]);
    assert.equal(leads.length, 2);
    const agro = leads.find((l) => l.whatsapp === "5561984013531");
    assert.deepEqual(agro?.tambem, ["GOAT CIGAR"].filter(() => agro?.empresa !== "GOAT CIGAR").concat(agro?.empresa === "GOAT CIGAR" ? ["Agrosumma Serviços Ltda"] : []));
    const via = leads.find((l) => l.whatsapp === "5592991092227");
    assert.equal(via?.tambem, undefined, "a repetição do mesmo nome não é outra empresa");
    assert.match(via?.descricao ?? "", /abertura de empresas/, "vale a entrada mais completa");
  });

  it("marca de montadora, banco, token e livro ficam fora; sem telefone legível vai à parte", () => {
    const { leads, excluidos, semTelefone } = prepararPlus([
      cartao("Itaú Unibanco", { telefones: ["(22) 99882-6890"] }),
      cartao("VENDAS DIRETAS TOYOTA", { telefones: ["66999018878"], descricao: "Responsável pelas Vendas Diretas da Toyota Canopus" }),
      cartao("Aureum Token", { telefones: ["(22) 99881-3405"], descricao: "Aureum é um token inspirado no ouro" }),
      cartao("livro coletânea da iniciação", { telefones: ["95984268049"] }),
      cartao("Arte Real Seguros", { telefones: [] }),
      cartao("TELEMEDICINA VaiCard-", { telefones: ["(48) 966-05785"] }),
      cartao("Padaria Boa", { telefones: ["(27) 99999-0004"] }),
    ]);
    assert.deepEqual(leads.map((l) => l.empresa), ["Padaria Boa"]);
    assert.equal(excluidos.length, 4);
    assert.deepEqual(semTelefone.map((s) => s.nome), ["Arte Real Seguros", "TELEMEDICINA VaiCard-"]);
  });

  it("o id vem do WhatsApp, sem expô-lo, e é estável", () => {
    const um = prepararPlus([cartao("A", { telefones: ["27999990001"] })]).leads[0];
    const dois = prepararPlus([cartao("Outro nome", { telefones: ["(27) 99999-0001"] })]).leads[0];
    assert.equal(um.id, dois.id);
    assert.match(um.id, /^p[0-9a-f]{10}$/);
    assert.ok(!um.id.includes("99999"));
  });

  it("o nicho vem do nome antes da descrição e palavra curta não casa dentro de outra", () => {
    const { leads } = prepararPlus([
      cartao("Liberty T.I.", { telefones: ["75998042372"], descricao: "Serviço de tratamento de dados e auditoria para promoção da saúde" }),
      cartao("Emílio Matos Leilões", { telefones: ["77999601900"], descricao: "Ajudo você a encontrar bens de leilão" }),
      cartao("Camisetas Personalizadas", { telefones: ["68992465611"] }),
    ]);
    const nicho = (n: string) => leads.find((l) => l.empresa === n)?.nicho;
    assert.equal(nicho("Liberty T.I."), "Tecnologia");
    assert.equal(nicho("Emílio Matos Leilões"), "Outros", "\"Ajudo\" não é judô");
    assert.equal(nicho("Camisetas Personalizadas"), "Estamparia e personalizados", "\"personalizadas\" não é personal trainer");
  });
});

describe("Plus: a mensagem com a saudação da Ordem", () => {
  const lead = (empresa: string, oferta: LeadPlus["oferta"] = "site", whatsapp = "5527999990001") => ({ empresa, oferta, whatsapp });

  it("toda primeira mensagem abre com a saudação maçônica e diz de onde veio o contato", () => {
    for (const oferta of ["site", "prumo", "iris", "estampa"] as const) {
      const { texto } = primeiraDoPlus(lead("Viaconta Contabilidade", oferta));
      assert.ok(texto.startsWith("Meu Ir.'., tudo bem? Me chamo Rômulo"), oferta);
      assert.match(texto, /encontrei a Viaconta Contabilidade no Catálogo de Negócios Maçônicos/);
      assert.match(texto, /T\.F\.A\.$/);
    }
  });

  it("segue o guia dos outros textos: sem preço, sem link, sem inventar trabalho pronto, uma saída fácil", () => {
    for (const oferta of ["site", "prumo", "iris", "estampa"] as const) {
      for (const texto of [primeiraDoPlus(lead("Padaria", oferta)).texto, followupDoPlus(lead("Padaria", oferta)).texto]) {
        assert.ok(!/R\$|https?:|www\./.test(texto), `${oferta}: sem preço nem link`);
        assert.ok(!/montei uma demonstra|já montei|está pronto|estava pronto/i.test(texto), `${oferta}: nada é dado como pronto`);
        assert.match(texto, /é só dizer/);
      }
    }
    assert.notEqual(PRIMEIRA_PLUS.site, PRIMEIRA_PLUS.prumo);
  });

  it("o artigo acompanha o nome; nome longo ou com título vira \"o seu negócio\"", () => {
    assert.deepEqual(referenciasDaEmpresa("Viaconta Contabilidade"), {
      origem: "encontrei a Viaconta Contabilidade no Catálogo de Negócios Maçônicos", ref: "a Viaconta Contabilidade",
      de: "da Viaconta Contabilidade", por: "pela Viaconta Contabilidade",
    });
    assert.equal(referenciasDaEmpresa("Padaria Pão Quente").de, "da Padaria Pão Quente");
    assert.equal(referenciasDaEmpresa("Rossi Vino Per Te").de, "do Rossi Vino Per Te");
    assert.equal(referenciasDaEmpresa("Advogado - Regularização de Imóveis - Inventário e Partilha").de, "do seu negócio");
    assert.equal(referenciasDaEmpresa("RIBEIRO SANTOS CONSTRUÇÃO LTDA").origem.includes("Ltda"), false);
  });

  it("a frase fecha com o artigo certo em cada oferta, no feminino, no masculino e sem nome que se diga", () => {
    const frases = (empresa: string, o: LeadPlus["oferta"]) => [primeiraDoPlus(lead(empresa, o)).texto, followupDoPlus(lead(empresa, o)).texto];
    const [siteF] = frases("Viaconta Contabilidade", "site");
    assert.match(siteF, /Vi que a Viaconta Contabilidade ainda não tem um site próprio/);
    assert.match(frases("Viaconta Contabilidade", "site")[1], /demonstração de site da Viaconta Contabilidade:/);
    assert.match(frases("Rossi Vino Per Te", "prumo")[0], /Olhei como o Rossi Vino Per Te aparece no Google/);
    assert.match(frases("Rossi Vino Per Te", "prumo")[1], /raio-x de como o Rossi Vino Per Te aparece/);
    assert.match(frases("Viaconta Contabilidade", "iris")[0], /quem coordena a Viaconta Contabilidade\?/);
    assert.match(frases("Rossi Vino Per Te", "iris")[1], /quem coordena o Rossi Vino Per Te\?/);
    assert.match(frases("Viaconta Contabilidade", "estampa")[0], /o responsável pela Viaconta Contabilidade\?/);
    assert.match(frases("Rossi Vino Per Te", "estampa")[1], /o responsável pelo Rossi Vino Per Te\?/);
    assert.match(frases("Advogado - Regularização de Imóveis - Inventário e Partilha", "site")[0], /Vi que o seu negócio ainda não tem/);
    for (const empresa of ["Viaconta Contabilidade", "Rossi Vino Per Te", "Advogado - Regularização de Imóveis - Inventário e Partilha"]) {
      for (const oferta of ["site", "prumo", "iris", "estampa"] as const) {
        for (const texto of frases(empresa, oferta)) {
          assert.doesNotMatch(texto, /\b(Vi que|como|coordena|responsável|por) (do|da|de) /, `${empresa} · ${oferta}: "${texto}"`);
          assert.doesNotMatch(texto, /[{}]/, "nenhum molde ficou sem preencher");
        }
      }
    }
  });

  it("o link é um wa.me com o texto codificado; sem número do Brasil, sem link", () => {
    const { link, texto } = primeiraDoPlus(lead("Padaria"));
    assert.ok(link.startsWith("https://wa.me/5527999990001?text="));
    assert.equal(decodeURIComponent(link.split("?text=")[1]), texto);
    assert.equal(primeiraDoPlus(lead("Padaria", "site", "14155550100")).link, "");
    assert.equal(followupDoPlus(lead("Padaria", "iris", "")).link, "");
  });
});

// ------------------------------------------------------------------ no CRM

function plus(i: number, extra: Partial<LeadPlus> = {}): LeadPlus {
  return { id: `p${String(i).padStart(10, "0")}`, empresa: `Empresa ${i}`, nicho: "Contabilidade", cidade: "Vitória", uf: "ES",
    whatsapp: `5527999${String(i).padStart(6, "0")}`, fixo: false, oferta: "site", descricao: "Contabilidade em geral", ...extra };
}

function retratoComRegistros(registros: Array<{ id: string; tipo: string; em: string; produto?: string; texto?: string }>) {
  return validarRetrato({
    versao: 1,
    geradoEm: new Date(AGORA.getTime() - 5 * 60_000).toISOString(),
    links: {},
    fontes: {
      site: { linhas: [] }, prumo: { linhas: [] }, iris: { linhas: [] }, estampa: { linhas: [] },
      registros: { linhas: registros.map((r) => ({ em: r.em, produto: r.produto ?? "plus", id: r.id, tipo: r.tipo, texto: r.texto ?? "", data: "" })) },
    },
  });
}

function leadPlus(leads: LeadPlusParaTeste[], registros: Parameters<typeof retratoComRegistros>[0] = [], id = leads[0].id): CrmLead {
  const v = montarCrm(retratoComRegistros(registros), { agora: AGORA, plus: { geradoEm: dias(1), leads } });
  const achado = v.leads.find((l) => l.id === `plus:${id}`);
  assert.ok(achado, "o lead Plus entra no CRM");
  return achado;
}
type LeadPlusParaTeste = LeadPlus;

describe("Plus no CRM: o funil sai só dos registros", () => {
  it("novo: pronto para enviar, com a saudação no link e na mensagem", () => {
    const l = leadPlus([plus(1)]);
    assert.equal(l.produto, "plus");
    assert.equal(l.etapa, "novo");
    assert.equal(l.sinal, "pronto");
    assert.equal(l.cidade, "Vitória - ES");
    assert.ok(l.links.enviar?.startsWith("https://wa.me/5527999000001?text=Meu%20Ir."));
    assert.ok(l.mensagemPronta?.startsWith("Meu Ir.'., tudo bem?"));
    assert.equal(l.plus?.oferta, "site");
    assert.match(l.links.maps ?? "", /google\.com\/maps\/search/);
  });

  it("o envio anotado leva a Em contato, e no 3º dia pede o follow-up com a saudação", () => {
    const enviado = leadPlus([plus(1)], [{ id: plus(1).id, tipo: "plus_enviado", em: dias(3) }]);
    assert.equal(enviado.etapa, "contato");
    assert.equal(enviado.sinal, "convite");
    assert.equal(enviado.links.enviar, undefined, "o link de primeiro contato some depois do envio");
    assert.equal(enviado.followupHoje, true);
    assert.ok(enviado.links.followup?.includes("Meu%20Ir."));
    const cedo = leadPlus([plus(1)], [{ id: plus(1).id, tipo: "plus_enviado", em: dias(1) }]);
    assert.equal(cedo.followupHoje, false);
    assert.equal(cedo.diasParaSair, 6);
  });

  it("sem resposta em 7 dias vai para Perdido; a resposta anotada segura a conversa", () => {
    const parado = leadPlus([plus(1)], [{ id: plus(1).id, tipo: "plus_enviado", em: dias(8) }]);
    assert.equal(parado.etapa, "perdido");
    assert.equal(parado.motivoPerda, "expirou");
    const respondeu = leadPlus([plus(1)], [
      { id: plus(1).id, tipo: "plus_enviado", em: dias(8) }, { id: plus(1).id, tipo: "plus_respondeu", em: dias(1) },
    ]);
    assert.equal(respondeu.etapa, "contato");
    assert.equal(respondeu.sinal, "respondeu-prumo");
    assert.equal(respondeu.respostaNova, true);
    assert.equal(respondeu.followupHoje, false);
    const esfriou = leadPlus([plus(1)], [
      { id: plus(1).id, tipo: "plus_enviado", em: dias(12) }, { id: plus(1).id, tipo: "plus_respondeu", em: dias(8) },
    ]);
    assert.equal(esfriou.motivoPerda, "esfriou");
  });

  it("proposta e \"sem contato\" valem como nos outros funis", () => {
    const proposta = leadPlus([plus(1)], [{ id: plus(1).id, tipo: "plus_enviado", em: dias(5) }, { id: plus(1).id, tipo: "proposta", em: dias(1) }]);
    assert.equal(proposta.etapa, "proposta");
    const sem = leadPlus([plus(1)], [{ id: plus(1).id, tipo: "sem_contato", em: dias(1) }]);
    assert.equal(sem.motivoPerda, "sem-contato");
  });

  it("registro de outro produto com o mesmo id não mexe no Plus", () => {
    const l = leadPlus([plus(1)], [{ id: plus(1).id, produto: "site", tipo: "plus_enviado", em: dias(3) }]);
    assert.equal(l.etapa, "novo");
  });

  it("a Hoje põe o Plus na frente, o fixo por último e mostra só os primeiros", () => {
    const leads = Array.from({ length: LIMITE_DO_PLUS_NA_HOJE + 5 }, (_, i) => plus(i + 1, i === 0 ? { fixo: true } : {}));
    const v = montarCrm(retratoComRegistros([]), { agora: AGORA, plus: { geradoEm: dias(1), leads } });
    const enviar = v.hoje.find((g) => g.id === "enviar")!;
    assert.equal(enviar.itens.length, LIMITE_DO_PLUS_NA_HOJE);
    assert.ok(!enviar.itens.some((i) => i.leadId === `plus:${leads[0].id}`), "o fixo é o último e não cabe nos 10 primeiros");
    assert.match(enviar.itens[0].acao, /^Plus: mandar a primeira mensagem/);
    assert.equal(v.leads.filter((l) => l.produto === "plus").length, LIMITE_DO_PLUS_NA_HOJE + 5, "o resto continua no Funil e no filtro");
    assert.equal(v.contagens.novo.plus, LIMITE_DO_PLUS_NA_HOJE + 5);
  });

  it("o fixo avisa para conferir o WhatsApp", () => {
    const v = montarCrm(retratoComRegistros([]), { agora: AGORA, plus: { geradoEm: dias(1), leads: [plus(1, { fixo: true })] } });
    assert.match(v.hoje.find((g) => g.id === "enviar")!.itens[0].detalhe, /Telefone fixo: confira se tem WhatsApp/);
  });

  it("a fonte Plus aparece na lista de fontes, sem erro de planilha", () => {
    const v = montarCrm(retratoComRegistros([]), { agora: AGORA, plus: { geradoEm: dias(1), leads: [plus(1), plus(2)] } });
    assert.deepEqual(v.fontes.find((f) => f.id === "plus"), { id: "plus", nome: "Plus — Catálogo de Negócios Maçônicos", linhas: 2 });
  });
});

describe("Plus: registro e arquivo", () => {
  it("o registro aceita o produto e os dois tipos novos", () => {
    assert.deepEqual(validarRegistro({ produto: "plus", id: "p0123456789", tipo: "plus_enviado", texto: "", data: "" }, AGORA),
      { produto: "plus", id: "p0123456789", tipo: "plus_enviado", texto: "", data: "" });
    assert.equal(validarRegistro({ produto: "plus", id: "p0123456789", tipo: "plus_respondeu" }, AGORA).tipo, "plus_respondeu");
  });

  it("a primeira mensagem só vale para quem ainda não a recebeu", () => {
    conferirEnvio("plus_enviado", { etapa: "novo", sinal: "pronto" });
    assert.throws(() => conferirEnvio("plus_enviado", { etapa: "contato", sinal: "convite" }), /já recebeu a primeira mensagem/);
    assert.throws(() => conferirEnvio("plus_enviado", { etapa: "perdido", sinal: "expirou" }), /encerrado/);
  });

  describe("arquivo e gravação", () => {
    let pasta: string | undefined;
    afterEach(async () => { if (pasta) await fs.rm(pasta, { recursive: true, force: true }); pasta = undefined; });

    async function ambiente(leads: unknown[], registros: Parameters<typeof retratoComRegistros>[0] = []) {
      pasta = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-plus-"));
      await fs.mkdir(path.join(pasta, "plus"), { recursive: true });
      await fs.writeFile(path.join(pasta, "plus", "leads.json"), JSON.stringify({ versao: 1, leads }));
      await fs.writeFile(path.join(pasta, "crm.json"), JSON.stringify(retratoComRegistros(registros)));
      await fs.writeFile(path.join(pasta, "segredo"), "segredo-de-teste");
      return pasta;
    }
    const loja = (dir: string, fetcher: typeof fetch) =>
      new CrmStore({ retrato: path.join(dir, "crm.json"), registroUrl: "http://127.0.0.1:5679/webhook/crm-registro", segredoArquivo: path.join(dir, "segredo"), entregasPrumo: dir }, fetcher);

    it("lê só o que é lead de verdade: id, WhatsApp do Brasil e oferta conhecida", async () => {
      const dir = await ambiente([
        plus(1), { ...plus(2), whatsapp: "14155550100" }, { ...plus(3), oferta: "outra" }, { ...plus(4), id: "x" }, "lixo", null,
        { ...plus(5), site: "javascript:alert(1)", instagram: "ok_user/x" },
      ]);
      const lido: PlusLido = await lerPlus(dir);
      assert.deepEqual(lido.leads.map((l) => l.id), [plus(1).id, plus(5).id]);
      assert.equal(lido.leads[1].site, undefined, "esquema que não é http(s) é descartado");
      assert.equal(lido.leads[1].instagram, "ok_userx");
      assert.ok(lido.geradoEm, "sem geradoEm no arquivo, vale a data do arquivo");
    });

    it("arquivo ausente ou quebrado = filtro Plus vazio, nunca erro", async () => {
      assert.deepEqual(await lerPlus(undefined), { leads: [] });
      assert.deepEqual(await lerPlus(path.join(os.tmpdir(), "squadone-nao-existe")), { leads: [] });
      const dir = await ambiente([]);
      await fs.writeFile(path.join(dir, "plus", "leads.json"), "{ quebrado");
      assert.deepEqual(await lerPlus(dir), { leads: [] });
    });

    it("anotar o envio grava uma vez só (clique duplo) e depois não deixa anotar de novo", async () => {
      const dir = await ambiente([plus(1)]);
      let chamadas = 0;
      const fetcher = (async () => { chamadas++; return new Response(JSON.stringify({ ok: true, em: AGORA.toISOString() }), { status: 200 }); }) as unknown as typeof fetch;
      const store = loja(dir, fetcher);
      const entrada = { produto: "plus", id: plus(1).id, tipo: "plus_enviado" };
      await store.registrar(entrada, AGORA);
      const segunda = await store.registrar(entrada, AGORA);
      assert.equal(segunda.repetido, true);
      assert.equal(chamadas, 1);
    });

    it("resposta só de quem está Em contato; os tipos do Plus só valem para o Plus", async () => {
      const dir = await ambiente([plus(1), plus(2)], [{ id: plus(2).id, tipo: "plus_enviado", em: dias(2) }]);
      const fetcher = (async () => new Response(JSON.stringify({ ok: true, em: AGORA.toISOString() }), { status: 200 })) as unknown as typeof fetch;
      const store = loja(dir, fetcher);
      await assert.rejects(store.registrar({ produto: "plus", id: plus(1).id, tipo: "plus_respondeu" }, AGORA), /Em contato/);
      assert.equal((await store.registrar({ produto: "plus", id: plus(2).id, tipo: "plus_respondeu" }, AGORA)).ok, true);
      await assert.rejects(store.registrar({ produto: "plus", id: plus(2).id, tipo: "plus_enviado" }, AGORA), /já recebeu a primeira mensagem/);
    });
  });
});

// OT-13 (17/10/2026): o observador grava a conversa do Plus; a mensagem dele depois da primeira vale
// como resposta, sem o "Respondeu no WhatsApp" à mão.
describe("Plus: a resposta sai da conversa guardada", () => {
  it("mensagem dele depois do envio leva a Em contato respondido; antes do envio não conta", () => {
    const lead = plus(7);
    const enviado = new Date(AGORA.getTime() - 2 * 86_400_000).toISOString();
    const depois = new Date(AGORA.getTime() - 86_400_000).toISOString();
    const montar = (em: string) => montarCrm(retratoComRegistros([{ id: lead.id, tipo: "plus_enviado", em: enviado }]), {
      agora: AGORA, plus: { geradoEm: dias(1), leads: [lead] },
      conversas: new Map([[chaveDoNumero(lead.whatsapp), [{ em, direcao: "entrada" as const, texto: "Opa, me conta mais" }]]]),
    }).leads.find((l) => l.id === `plus:${lead.id}`)!;
    const respondeu = montar(depois);
    assert.equal(respondeu.etapa, "contato");
    assert.equal(respondeu.marcos.respondeu, depois);
    const antes = montar(new Date(AGORA.getTime() - 3 * 86_400_000).toISOString());
    assert.equal(antes.marcos.respondeu, undefined);
  });
});
