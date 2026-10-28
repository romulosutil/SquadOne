import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { gerarOfertas, lerOfertas, OfertaInvalida } from "./ofertas-gerador.ts";
import { OFERTA, OFERTAS_PROPRIAS, PRODUTOS, PRODUTOS_DE_PROSPECCAO, ehOfertaPropria, ehProduto, ehProdutoDeProspeccao } from "./ofertas.ts";
import { NOME_DA_FONTE, OFERTA_DE_PROSPECCAO, ROTULO_DO_PRODUTO, validarRetrato } from "./crm.ts";
import { ConviteDesconhecido, mensagemDoConvite } from "./convite-mensagem.ts";
import {
  ABAS_DAS_OFERTAS_PROPRIAS, ROTULO_DA_OFERTA_DO_PLUS, ROTULO_DO_PRODUTO as ROTULO_NA_TELA, SIGLA_DO_PRODUTO,
} from "../src/operations/crm-formato.ts";
import { JORNADA_DAS_SALAS } from "../src/office/operacao.ts";
import { nomesDasOfertas } from "../src/office/decisoes.ts";

// O registro único das ofertas próprias (28/10/2026): deploy/dell/claude-ops/prumo-ofertas.json gera
// server/ofertas.gerado.ts (scripts/ofertas-gerar.ts), e o resto do TS deriva dele.
const ARQUIVO_JSON = new URL("../deploy/dell/claude-ops/prumo-ofertas.json", import.meta.url);
const CONFIG = JSON.parse(fs.readFileSync(ARQUIVO_JSON, "utf8")) as { ofertas: Record<string, Record<string, unknown>> };
const lf = (s: string) => s.replace(/\r\n/g, "\n");

describe("ofertas.gerado.ts × prumo-ofertas.json", () => {
  it("o arquivo gerado está em dia com o JSON (rode npx tsx scripts/ofertas-gerar.ts)", () => {
    const noDisco = lf(fs.readFileSync(new URL("./ofertas.gerado.ts", import.meta.url), "utf8"));
    assert.equal(noDisco, gerarOfertas(CONFIG), "server/ofertas.gerado.ts está atrás do JSON: npx tsx scripts/ofertas-gerar.ts");
  });

  it("as listas derivam do JSON, na ordem dele", () => {
    assert.deepEqual([...OFERTAS_PROPRIAS], Object.keys(CONFIG.ofertas));
    assert.deepEqual([...PRODUTOS], ["site", "prumo", ...Object.keys(CONFIG.ofertas), "plus"]);
    assert.deepEqual([...PRODUTOS_DE_PROSPECCAO], ["prumo", ...Object.keys(CONFIG.ofertas)]);
    for (const id of Object.keys(CONFIG.ofertas)) {
      assert.ok(ehOfertaPropria(id) && ehProduto(id) && ehProdutoDeProspeccao(id), id);
      assert.equal(OFERTA[id as keyof typeof OFERTA].mensagem, CONFIG.ofertas[id].mensagem, id);
    }
    for (const outro of ["site", "prumo", "plus", "registros", "", "silmer", null, undefined, 1]) assert.equal(ehOfertaPropria(outro), false, String(outro));
    assert.equal(ehProduto("silmer"), false);
    assert.equal(ehProdutoDeProspeccao("site"), false);
  });
});

// Os literais de antes do registro único (27/10/2026), copiados do código como estava. Uma oferta nova não
// mexe nestes; mudar um deles é mudar o que o Rômulo vê (e precisa de decisão, não de refatoração).
describe("não-regressão: Iris e estamparia dizem o mesmo que antes de 28/10/2026", () => {
  const HOJE = ["site", "prumo", "iris", "estampa", "plus"];

  it("ids e a ordem dos filtros", () => {
    assert.deepEqual(PRODUTOS.filter((p) => HOJE.includes(p)), HOJE);
    assert.deepEqual(PRODUTOS_DE_PROSPECCAO.filter((p) => HOJE.includes(p)), ["prumo", "iris", "estampa"]);
  });

  it("rótulos, siglas e nomes de fonte", () => {
    const rotulos = { site: "Site antes da venda", prumo: "Serviços PRUMO", iris: "Iris · Clínicas", estampa: "CRM de estamparia", plus: "Plus" };
    for (const [id, rotulo] of Object.entries(rotulos)) {
      assert.equal(ROTULO_DO_PRODUTO[id as keyof typeof rotulos], rotulo, id);
      assert.equal(ROTULO_NA_TELA[id as keyof typeof rotulos], rotulo, id);
    }
    const siglas = { site: "Site", prumo: "PRUMO", iris: "Iris", estampa: "Estamparia", plus: "Plus" };
    for (const [id, sigla] of Object.entries(siglas)) {
      assert.equal(SIGLA_DO_PRODUTO[id as keyof typeof siglas], sigla, id);
      assert.equal(nomesDasOfertas[id as keyof typeof siglas], sigla, id);
    }
    assert.deepEqual({ ...ROTULO_DA_OFERTA_DO_PLUS }, { site: "Site", prumo: "PRUMO", iris: "Iris", estampa: "Estamparia" });
    assert.equal(NOME_DA_FONTE.iris, "PRUMO — Clínicas (Iris)");
    assert.equal(NOME_DA_FONTE.estampa, "PRUMO — Estamparias (CRM de estamparia)");
    assert.equal(NOME_DA_FONTE.prumo, "PRUMO — Prospects");
  });

  it("aba, caçador e link do retrato", () => {
    assert.deepEqual(OFERTA_DE_PROSPECCAO.prumo, { aba: "Prospects", cacador: "Encontrado pelo Lead Scout", link: "planilhaPrumo" });
    assert.deepEqual(OFERTA_DE_PROSPECCAO.iris, { aba: "Clínicas", cacador: "Encontrado pelo Caçador do Iris", link: "planilhaIris" });
    assert.deepEqual(OFERTA_DE_PROSPECCAO.estampa, { aba: "Estamparias", cacador: "Encontrado pelo Caçador de estamparias", link: "planilhaEstampa" });
    assert.deepEqual(ABAS_DAS_OFERTAS_PROPRIAS.filter((a) => ["planilhaIris", "planilhaEstampa"].includes(a.chave)), [
      { chave: "planilhaIris", rotulo: "Aba Clínicas (Iris)" },
      { chave: "planilhaEstampa", rotulo: "Aba Estamparias" },
    ]);
  });

  it("o retrato de hoje é lido igual: links nas mesmas chaves e fonte ausente vira aviso", () => {
    const r = validarRetrato({
      versao: 1, geradoEm: "2026-10-27T12:00:00Z",
      links: { webhook: "https://n8n/x", planilhaSite: "https://s/1", planilhaPrumo: "https://s/2", planilhaIris: "https://s/3", planilhaEstampa: "https://s/4", planilhaCrm: "https://s/5", planilhaOutra: "https://s/6" },
      fontes: { site: { linhas: [] }, prumo: { linhas: [] }, iris: { linhas: [{ ID: "1" }] }, registros: { linhas: [] } },
    });
    assert.deepEqual(Object.keys(r.links), ["webhook", "planilhaSite", "planilhaPrumo", "planilhaIris", "planilhaEstampa", "planilhaCrm"], "chave desconhecida fica de fora");
    assert.equal(r.links.planilhaIris, "https://s/3");
    assert.equal(r.links.planilhaEstampa, "https://s/4");
    assert.deepEqual(Object.keys(r.fontes).filter((k) => !ehOfertaPropria(k) || k === "iris" || k === "estampa"), ["site", "prumo", "iris", "estampa", "registros"]);
    assert.equal(r.fontes.iris.linhas.length, 1);
    assert.equal(r.fontes.estampa.erro, "estampa ausente no retrato.");
  });

  it("sala de cada oferta no Escritório", () => {
    assert.equal(OFERTA.iris.sala, "prumo--iris");
    assert.equal(OFERTA.estampa.sala, "prumo--estamparias");
    assert.deepEqual(JORNADA_DAS_SALAS["prumo--iris"], { titulo: "Leads desta oferta", recortes: [{ produto: "iris" }] });
    assert.deepEqual(JORNADA_DAS_SALAS["prumo--estamparias"], { titulo: "Leads desta oferta", recortes: [{ produto: "estampa" }] });
  });

  it("o convite é o mesmo texto, com saudação e nome", () => {
    const tarde = new Date("2026-10-18T15:00:00Z");
    assert.equal(mensagemDoConvite("iris", "Clínica Aurora LTDA", "", tarde),
      "Boa tarde! Sou o Rômulo, do Prumo. O Iris organiza as anotações das sessões para apoiar a preparação dos relatórios de reavaliação.\n\nPosso te mostrar um exemplo com dados fictícios para a equipe da Clínica Aurora?");
    assert.equal(mensagemDoConvite("estampa", "ESTAMPARIA DO PORTO", "", new Date("2026-10-18T11:00:00Z")),
      "Bom dia! Sou o Rômulo, do Prumo. Trabalho com um sistema de pedidos para estamparias que reúne arte, tamanhos e prazo em uma ficha para a produção.\n\nPosso te mostrar uma ficha de exemplo para a equipe da Estamparia do Porto, sem dados de clientes?");
    // "$&" no nome não vira padrão de substituição.
    assert.match(mensagemDoConvite("iris", "Clínica $& Cia", "", tarde), /equipe da Clínica \$& Cia\?$/);
    assert.match(mensagemDoConvite("prumo", "Empresa", "", tarde), /^Boa tarde! Sou o Rômulo, do Prumo\. Ajudo empresas a organizar regras/);
  });

  it("produto sem convite aprovado lança, em vez de cair no texto da consultoria", () => {
    for (const p of ["site", "plus", "oferta-inexistente", ""]) assert.throws(() => mensagemDoConvite(p, "Empresa", "", new Date()), ConviteDesconhecido, p);
  });
});

describe("oferta sintética: o que o gerador faz com uma terceira oferta", () => {
  const PDV = {
    ...CONFIG.ofertas.estampa,
    rotulo: "PDV de padaria", sigla: "PDV", sala: "prumo--pdv", cacador_rotulo: "Encontrado pelo Caçador de padarias",
    fonte: "PRUMO — Padarias (PDV)", link_retrato: "planilhaPdv", aba: "Padarias",
    mensagem: "{OLA}! Sou o Rômulo, do Prumo. Posso te mostrar um exemplo para a equipe da {NOME}?",
  };
  const comPdv = { ...CONFIG, ofertas: { ...CONFIG.ofertas, pdv: PDV } };

  it("entra na lista e no OFERTA, sem tocar no JSON real", async () => {
    const texto = gerarOfertas(comPdv);
    assert.match(texto, new RegExp(`export const OFERTAS_PROPRIAS = \\[${[...Object.keys(CONFIG.ofertas), "pdv"].map((id) => `"${id}"`).join(", ")}\\] as const;`));
    // O texto gerado é TS válido e carrega: importa de um diretório temporário.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ofertas-sinteticas-"));
    try {
      const arquivo = path.join(dir, "ofertas.gerado.ts");
      fs.writeFileSync(arquivo, texto, "utf8");
      const m = await import(pathToFileURL(arquivo).href) as { OFERTAS_PROPRIAS: readonly string[]; OFERTA: Record<string, Record<string, string>> };
      assert.deepEqual([...m.OFERTAS_PROPRIAS], [...Object.keys(CONFIG.ofertas), "pdv"]);
      assert.deepEqual(m.OFERTA.pdv, {
        rotulo: "PDV de padaria", sigla: "PDV", tipo: "propria", aba: "Padarias", sala: "prumo--pdv",
        cacadorRotulo: "Encontrado pelo Caçador de padarias", fonte: "PRUMO — Padarias (PDV)", linkRetrato: "planilhaPdv", mensagem: PDV.mensagem,
      });
      for (const id of Object.keys(CONFIG.ofertas)) assert.deepEqual(m.OFERTA[id], { ...OFERTA[id as keyof typeof OFERTA] }, id);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("o gerador recusa o bloco que quebraria o CRM calado", () => {
    const com = (o: Record<string, unknown>, id = "pdv") => ({ ...CONFIG, ofertas: { ...CONFIG.ofertas, [id]: { ...PDV, ...o } } });
    const casos: Array<[string, unknown]> = [
      ["sem mensagem", com({ mensagem: undefined })],
      ["mensagem sem {NOME}", com({ mensagem: "{OLA}! Oi." })],
      ["sem sigla", com({ sigla: "" })],
      ["sem sala", com({ sala: undefined })],
      ["sala fora da squad PRUMO", com({ sala: "pessoal--pdv" })],
      ["sala repetida", com({ sala: OFERTA.iris.sala })],
      ["sigla repetida", com({ sigla: "iris" })],
      ["link de outra fonte", com({ link_retrato: "planilhaPrumo" })],
      ["link fora do formato", com({ link_retrato: "pdv" })],
      ["tipo desconhecido", com({ tipo: "revenda" })],
      ["id reservado", com({}, "plus")],
      ["id com maiúscula", com({}, "Pdv")],
      ["id com hífen", com({}, "pdv-padaria")],
      ["sem ofertas", { ...CONFIG, ofertas: {} }],
      ["sem o objeto", {}],
    ];
    for (const [nome, config] of casos) assert.throws(() => lerOfertas(config), OfertaInvalida, nome);
  });
});
