import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { COLUNAS_DO_PRUMO, OFERTA_DE_PROSPECCAO, etapaDoPrumo, normalizarCabecalho } from "./crm.ts";

// Contrato entre deploy/dell/claude-ops/prumo-ofertas.json (o que o n8n grava nas abas Clínicas e
// Estamparias) e server/crm.ts (o que o CRM lê delas). Quebrar um lado sem o outro deixaria a oferta
// muda no funil: a coluna some calada e o lead fica parado em "Novo".
const CONFIG = JSON.parse(fs.readFileSync(new URL("../deploy/dell/claude-ops/prumo-ofertas.json", import.meta.url), "utf8")) as {
  colunas: string[];
  ocultas: string[];
  etapas: string[];
  clientes: string;
  descartados: string[];
  ofertas: Record<string, {
    aba: string; convite: string; mensagem: string; nichos: string[]; cidades: string[]; sinais: [string, string][]; segmento: string; fora: string;
    perfil: string; fora_sem_perfil: string; solo?: string; instituicao?: string;
  }>;
};

describe("prumo-ofertas.json × CRM", () => {
  it("as ofertas são as do CRM, com a mesma aba", () => {
    assert.deepEqual(Object.keys(CONFIG.ofertas).sort(), ["estampa", "iris"]);
    for (const [id, o] of Object.entries(CONFIG.ofertas)) {
      const doCrm = OFERTA_DE_PROSPECCAO[id as "iris" | "estampa"];
      assert.equal(o.aba, doCrm.aba, id);
    }
  });

  it("o cabeçalho das abas tem toda coluna que o CRM usa para etapa, contato e resposta", () => {
    const cabecalho = new Set(CONFIG.colunas.map(normalizarCabecalho));
    const usadas = ["id", "empresa", "nicho", "cidade", "etapa", "site", "whatsapp", "proximaAcao", "encontradoEm", "conviteEm",
      "respondeuEm", "respostaTipo", "respostaTrecho", "respostaEm"] as const;
    for (const campo of usadas) {
      assert.ok(COLUNAS_DO_PRUMO[campo].nomes.some((n) => cabecalho.has(n)), `falta a coluna de ${campo} (${COLUNAS_DO_PRUMO[campo].nomes[0]})`);
    }
    for (const oculta of CONFIG.ocultas) assert.ok(CONFIG.colunas.includes(oculta), oculta);
  });

  it("toda etapa da lista da planilha tem lugar no funil (nenhuma cai em 'sem etapa')", () => {
    const esperado: Record<string, string> = {
      Revisar: "novo/revisar", "Convite enviado": "contato/convite", "Em conversa": "contato/respondeu-prumo",
      "Concluído": "ganho/concluido", "Sem interesse": "perdido/sem-interesse",
    };
    assert.deepEqual(CONFIG.etapas, Object.keys(esperado));
    for (const etapa of CONFIG.etapas) {
      const r = etapaDoPrumo({ etapa });
      assert.equal(`${r.etapa}/${r.sinal}`, esperado[etapa], etapa);
    }
  });

  it("o convite segue as regras do PRUMO: voz da empresa, sem nome, sem preço, sem link, uma pergunta", () => {
    for (const [id, o] of Object.entries(CONFIG.ofertas)) {
      assert.ok(o.mensagem.startsWith("{OLA}! Aqui é do Prumo."), id);
      assert.ok(o.mensagem.includes("{NOME}"), id);
      assert.doesNotMatch(o.mensagem, /R\$|r[oô]mulo|fundador|desconto|gr[aá]tis|https?:|www\./i, id);
      assert.equal((o.mensagem.match(/\?/g) ?? []).length, 1, `${id}: uma pergunta só`);
    }
  });

  it("cliente do PRUMO nunca vira prospect, e o que não é cliente final fica fora (achados da 1ª rodada, 14/10/2026)", () => {
    const clientes = new RegExp(CONFIG.clientes, "i");
    assert.ok(clientes.test("silmer camisetas"));
    assert.ok(clientes.test("silmer.com.br"));
    const fora = (id: string, nome: string) => new RegExp(CONFIG.ofertas[id].fora, "i").test(nome);
    assert.ok(fora("iris", "saude ocupacional unimed vitoria"));
    assert.ok(fora("estampa", "newtech vitoria - produtos para sublimacao, transfer e papeis"));
    assert.ok(!fora("estampa", "estamparia vitoria | uniformes personalizados"));
    assert.ok(!fora("iris", "vidah kids - clinica de neuropsiquiatria, desenvolvimento infantil e autismo"));
  });

  it("buscas e padrões são válidos", () => {
    for (const [id, o] of Object.entries(CONFIG.ofertas)) {
      assert.ok(o.nichos.length && o.cidades.length, id);
      const fontes = [o.segmento, o.fora, o.perfil, o.fora_sem_perfil, o.solo ?? "", o.instituicao ?? "", ...o.sinais.map(([, s]) => s)];
      for (const fonte of fontes) {
        assert.doesNotThrow(() => new RegExp(fonte, "i"), `${id}: ${fonte}`);
        // \b virando backspace (aconteceu ao editar pelo shell em 14/10/2026) calaria o padrão sem erro.
        assert.ok(!fonte.includes("\b"), `${id}: backspace no padrão ${fonte}`);
      }
    }
  });

  it("colunas novas só no fim: as abas já existem e os fluxos do WhatsApp gravam pelo nome", () => {
    const ate14 = ["ID", "Empresa", "Cidade", "Segmento", "WhatsApp", "Site", "Nota Google", "Etapa", "Enviar convite", "Prioridade", "Sinais",
      "Próxima ação", "Google Maps", "Encontrado em", "Convite enviado em", "Respondeu em", "Tipo da resposta", "Resposta", "Resposta em"];
    assert.deepEqual(CONFIG.colunas.slice(0, ate14.length), ate14);
    assert.deepEqual(CONFIG.descartados.slice(0, 6), ["ID", "Empresa", "Cidade", "Segmento", "Motivo", "Encontrado em"]);
    // O rodízio lê a busca de cada linha nas duas abas.
    assert.ok(CONFIG.colunas.includes("Busca") && CONFIG.descartados.includes("Busca"));
    const cabecalho = new Set(CONFIG.colunas.map(normalizarCabecalho));
    for (const campo of ["prioridade", "sinais", "origemWhatsapp", "nota", "maps"] as const) {
      assert.ok(COLUNAS_DO_PRUMO[campo].nomes.some((n) => cabecalho.has(n)), `o CRM não acha a coluna de ${campo}`);
    }
  });

  it("perfil da oferta: decide como na triagem (sem acento, sem caixa), com os casos da análise de 14/10/2026", () => {
    const sem = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const casa = (fonte: string, texto: string) => new RegExp(sem(fonte), "i").test(sem(texto));
    const iris = CONFIG.ofertas.iris;
    const estampa = CONFIG.ofertas.estampa;
    for (const bom of ["Clínica Felice - Terapias ABA- Autismo (TEA)", "Clínica Multidisciplinar Infantil", "Protea Neurodesenvolvimento"]) {
      assert.ok(casa(iris.perfil, bom), bom);
    }
    // "Multidisciplinar" sozinho não é perfil: a reabilitação de adulto também se diz assim (reavaliação de 14/10/2026).
    assert.ok(!casa(iris.perfil, "Rehabili: equipe multidisciplinar de reabilitação"));
    for (const fisio of ["Clínica da Mão & Reabilitação", "IFESP - Instituto de Fisioterapia e Especialidades"]) {
      assert.ok(!casa(iris.perfil, fisio) && casa(iris.fora_sem_perfil, fisio), fisio);
    }
    for (const fora of ["CMC Medicina, Segurança do Trabalho e Ergonomia", "UFES - Prédio do DEIS", "Centro Municipal de Especialidades de Vitória"]) {
      assert.ok(casa(iris.fora, fora), fora);
    }
    assert.ok(casa(iris.solo!, "Fonoaudióloga Mariana Nunes") && !casa(iris.instituicao!, "Fonoaudióloga Mariana Nunes"));
    assert.ok(casa(iris.solo!, "Dra. Samara Meyrelles | Terapia da Mão"));
    assert.ok(casa(iris.instituicao!, "Clínica Vitta Psicologia"), "clínica não é profissional sozinho");
    assert.ok(casa(estampa.perfil, "Rei das Camisas – Camisetas e uniformes"));
    assert.ok(!casa(estampa.perfil, "CANECANDO - Presentes Personalizados") && casa(estampa.fora_sem_perfil, "CANECANDO - Presentes Personalizados"));
    for (const fornecedor of ["Ink Paper Suprimentos", "SUBLITECH IMPRESSORAS SUBLIMAÇÃO", "VIAFLEX (ES) - Suprimentos para Comunicação Visual"]) {
      assert.ok(casa(estampa.fora, fornecedor), fornecedor);
    }
  });

  it("buscas: a frase curta que rende vem primeiro, e o que trouxe medicina do trabalho e consultório saiu", () => {
    assert.equal(CONFIG.ofertas.iris.nichos[0], "terapia ABA");
    assert.ok(!CONFIG.ofertas.iris.nichos.some((n) => /ocupacional|TCC|ABA autismo/.test(n)));
    assert.equal(CONFIG.ofertas.estampa.nichos.at(-1), "sublimação");
  });
});
