import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { PastaDoLead } from "./auto-production.ts";
import { chaveDoNumero, enviosComAConversa, resumirConversa, saidasDaConversa, type MensagemDaConversa } from "./conversa-do-lead.ts";
import { leadsDoAutomatico } from "./copiloto.ts";
import { montarCrm, validarRetrato, type CrmVisao } from "./crm.ts";
import { criarVendedor, ESPERA_DO_COPILOTO_MS } from "./vendedor.ts";
import { filaDeVenda, linhaDaConversa } from "../src/operations/proxima-venda.ts";
import type { CrmLead } from "../src/operations/types.ts";

// A Próxima venda "consciente do que está acontecendo" (16/10/2026). O caso que motivou: a Kulniski
// disse "pode sim" em 14/10, o Rômulo mandou o link e o preço à mão minutos depois, e dois dias
// depois o cartão ainda dizia "o link ainda não foi mandado" e oferecia a mesma mensagem de novo.
// Tudo fixture: nenhuma planilha, pasta, conversa, n8n ou Telegram real é tocado.

const AGORA = new Date("2026-10-16T16:00:00Z"); // sexta, 13:00 em São Paulo
const WEBHOOK = "https://dell.exemplo.ts.net/webhook";
const horas = (n: number) => new Date(AGORA.getTime() - n * 3600_000).toISOString();
const COLUNAS = ["row_number", "place_id", "nome", "vertical", "cidade", "status", "site_url", "criado_em", "enviado_em",
  "visto_em", "respondeu_em", "followup_em", "recusado_em", "fechado_em", "acoes_link", "wa_link", "wa_me",
  "resposta_tipo", "resposta_trecho", "resposta_em", "mensagem_variante"];
const DEMO = "https://demo-kulniski.vercel.app/";
const NUMERO = "5516981000093";
const CHAVE = "1681000093";
const SIM = { status: "enviado", enviado_em: horas(51), respondeu_em: horas(50.9), resposta_tipo: "interesse", resposta_trecho: "pode sim", resposta_em: horas(50.9) };

function linha(extra: Record<string, string>): Record<string, string> {
  return { ...Object.fromEntries(COLUNAS.map((c) => [c, ""])), row_number: "3", place_id: "K", nome: "Kulniski Advocacia",
    vertical: "advocacia", cidade: "Ribeirão Preto", criado_em: horas(200), site_url: DEMO,
    wa_me: `https://wa.me/${NUMERO}`, mensagem_variante: "A", ...extra };
}

function visaoCom(site: Record<string, string>, conversa?: MensagemDaConversa[], registros: Array<Record<string, string>> = []): CrmVisao {
  const retrato = validarRetrato({
    versao: 1,
    geradoEm: new Date(AGORA.getTime() - 60_000).toISOString(),
    links: { webhook: WEBHOOK },
    fontes: {
      site: { planilha: "Leads", aba: "Leads", colunas: COLUNAS, linhas: [linha(site)] },
      registros: { aba: "CRM", colunas: ["em", "produto", "id", "tipo", "texto", "data"], linhas: registros },
    },
  });
  const pasta: PastaDoLead = {
    slug: "kulniski", lugar: "_em-conversa", placeId: "K",
    artefatos: { conteudo: true, fotos: 0, capa: false, gerado: true, publicado: true, falha: false },
    alteradaEm: horas(60), publicadoEm: horas(100), siteUrl: DEMO,
  };
  return montarCrm(retrato, { agora: AGORA, pastas: [pasta], ...(conversa ? { conversas: new Map([[CHAVE, conversa]]) } : {}) }) as unknown as CrmVisao;
}

const msg = (h: number, direcao: "entrada" | "saida", texto: string): MensagemDaConversa => ({ em: horas(h), direcao, texto });
/** A conversa da Kulniski como o print de 16/10/2026 mostra (horas antes de AGORA). */
const KULNISKI = [
  msg(51, "saida", "Oi, tudo bem? Aqui é o Rômulo. Montei uma demonstração de site. Posso te mandar o link?"),
  msg(50.9, "entrada", "pode sim"),
  msg(50.85, "saida", "Boa tarde, vou solicitar agora o link ao time"),
  msg(50.5, "saida", `Aqui está a demonstração: ${DEMO}`),
  msg(50.49, "saida", "Se gostarem, coloco o site no ar com o endereço de vocês. O que acharam?"),
];
const CTX = { primeiroLiberado: true, agora: AGORA.getTime() };

describe("a conversa no disco é achada pelo número", () => {
  it("DDD + últimos 8 dígitos, com ou sem 55 e com ou sem o 9: o mesmo nome do observador", () => {
    assert.equal(chaveDoNumero("https://wa.me/5516981000093"), CHAVE);
    assert.equal(chaveDoNumero("16981000093"), CHAVE);
    assert.equal(chaveDoNumero("1681000093"), CHAVE);
    assert.equal(chaveDoNumero("ChIJ6-CIM7W9uZQRKrX2gl5w24I"), "");
    assert.equal(chaveDoNumero(undefined), "");
  });
});

describe("o resumo da conversa", () => {
  it("o link do demo numa mensagem nossa é a 2ª mensagem; a última mensagem diz quem falou", () => {
    const r = resumirConversa(KULNISKI, [DEMO]);
    assert.equal(r?.linkEm, horas(50.5));
    assert.equal(r?.ultima.direcao, "saida");
    assert.equal(r?.ultimaEntrada, horas(50.9));
    assert.equal(r?.desde, horas(51));
  });

  it("saída sem texto (bridge antiga) conta como mensagem nossa, nunca como link", () => {
    const r = resumirConversa([msg(2, "entrada", "pode sim"), msg(1, "saida", "")], [DEMO]);
    assert.equal(r?.ultimaSaida, horas(1));
    assert.equal(r?.linkEm, undefined);
  });

  it("toque no link que não virou mensagem não vale; o link visto na conversa entra; o toque recente espera o observador", () => {
    const r = resumirConversa(KULNISKI, [DEMO])!;
    const saidas = saidasDaConversa(KULNISKI, [DEMO]);
    const toqueDeHoje = Date.parse(horas(1));
    assert.deepEqual(enviosComAConversa([toqueDeHoje], r, saidas, AGORA.getTime()), [Date.parse(horas(50.5))]);
    // O caso de 16/10: depois do toque saiu um "Boa tarde", sem o link. Não é a 2ª mensagem.
    const comBoaTarde = [...KULNISKI, msg(0.9, "saida", "Boa tarde")];
    assert.deepEqual(enviosComAConversa([toqueDeHoje], resumirConversa(comBoaTarde, [DEMO]), saidasDaConversa(comBoaTarde, [DEMO]), AGORA.getTime()),
      [Date.parse(horas(50.5))]);
    // Texto não guardado (bridge antiga) perto do toque: não dá para dizer que não foi o link, o toque vale.
    const semTexto = [...KULNISKI, msg(0.9, "saida", "")];
    assert.ok(enviosComAConversa([toqueDeHoje], resumirConversa(semTexto, [DEMO]), saidasDaConversa(semTexto, [DEMO]), AGORA.getTime()).includes(toqueDeHoje));
    const toqueAgora = Date.parse(horas(0.1));
    assert.ok(enviosComAConversa([toqueAgora], r, saidas, AGORA.getTime()).includes(toqueAgora));
    // Antes da conversa guardada a Central não sabe: o toque vale como era.
    const antes = Date.parse(horas(60));
    assert.ok(enviosComAConversa([antes], r, saidas, AGORA.getTime()).includes(antes));
  });
});

describe("Próxima venda com a conversa", () => {
  it("a Kulniski de 16/10: o link saiu à mão, então a vez é do 'o que achou?', não de mandar o link de novo", () => {
    const v = visaoCom(SIM, KULNISKI, [{ em: horas(1), produto: "site", id: "K", tipo: "segunda_enviada", texto: "", data: "" }]);
    const lead = v.leads[0] as unknown as CrmLead;
    assert.equal(lead.interesseParado, undefined);
    assert.equal(lead.marcos.segundaEnviada, horas(50.5));
    const fila = filaDeVenda(v, CTX);
    assert.equal(fila.some((a) => a.tipo === "responder"), false, fila.map((a) => a.titulo).join(" | "));
    const depois = fila.find((a) => a.tipo === "depois-do-link");
    assert.ok(depois, "sem o 'o que achou?'");
    assert.match(depois.conversa ?? "", /^Última mensagem: você, há 2 dias: “Se gostarem/);
  });

  it("'vou pedir o link ao time' não é o link: o 'quero ver' segue na fila, com a última mensagem à vista", () => {
    const v = visaoCom(SIM, KULNISKI.slice(0, 3));
    const [a] = filaDeVenda(v, CTX);
    assert.equal(a?.tipo, "responder");
    assert.equal(a.quente, true);
    assert.match(a.conversa ?? "", /você, há 2 dias: “Boa tarde, vou solicitar agora o link ao time”/);
  });

  it("sem a conversa guardada, o cartão pede para conferir no WhatsApp antes de mandar", () => {
    const [a] = filaDeVenda(visaoCom(SIM), CTX);
    assert.equal(a?.tipo, "responder");
    assert.match(a.conversa ?? "", /não tem esta conversa guardada/);
  });

  it("ele escreveu de novo depois do link: é a vez de responder, e cada mensagem nova é uma vez nova", () => {
    const conversa = [...KULNISKI, msg(1, "entrada", "gostei, mas tenho uma dúvida")];
    const [a] = filaDeVenda(visaoCom(SIM, conversa), CTX);
    assert.equal(a?.tipo, "responder");
    assert.equal(a.chave, `site:K|responder|${horas(1)}`);
    assert.match(a.conversa ?? "", /ele, há 1 h: “gostei, mas tenho uma dúvida”/);
  });

  it("a sugestão do copiloto entra no lugar do texto pronto, sem anotar envio, e o texto padrão fica guardado", () => {
    const v = visaoCom(SIM, KULNISKI.slice(0, 3));
    const sugestoes = new Map([["site:K", { mensagem: `Segue a demonstração: ${DEMO}`, porque: "ele já esperou demais", quando: horas(0.1) }]]);
    const [a] = filaDeVenda(v, { ...CTX, sugestoes });
    assert.equal(a.rascunho, `Segue a demonstração: ${DEMO}`);
    assert.equal(a.anota, undefined);
    assert.equal(a.copiloto?.porque, "ele já esperou demais");
    assert.match(a.copiloto?.padrao ?? "", /demo-kulniski/);
    assert.equal(a.link?.url, `https://wa.me/${NUMERO}?text=${encodeURIComponent(`Segue a demonstração: ${DEMO}`)}`);
  });

  it("a linha da conversa fora de Em contato não pede conferência", () => {
    assert.equal(linhaDaConversa({ etapa: "novo" }, AGORA.getTime()), undefined);
  });
});

describe("o copiloto sozinho", () => {
  it("lê quem está com a vez, a conversa mais nova primeiro", () => {
    const vez = visaoCom(SIM, KULNISKI.slice(0, 3)).leads[0] as unknown as CrmLead;
    const novo = { ...vez, id: "site:N", conversa: { ...vez.conversa!, ultimaEntrada: horas(0.5) } };
    const semVez = { ...vez, id: "site:X", respostaNova: false, conversa: { ...vez.conversa!, ultima: { ...vez.conversa!.ultima, direcao: "saida" as const } } };
    assert.deepEqual(leadsDoAutomatico([vez, semVez, novo]).map((l) => l.id), ["site:N", "site:K"]);
  });

  it("o vendedor segura o aviso enquanto o copiloto escreve, e sai com o texto pronto depois da espera", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vendedor-"));
    try {
      let agora = AGORA.getTime();
      const enviados: string[] = [];
      const v = visaoCom(SIM, KULNISKI.slice(0, 3));
      const vendedor = criarVendedor({
        lerVisao: async () => v,
        enviar: async (texto) => { enviados.push(texto); },
        registrar: async () => {},
        arquivoDeEstado: path.join(dir, "vendedor.json"),
        agora: () => agora,
        copiloto: { prontas: async () => new Map(), pedir: async () => true },
      });
      assert.deepEqual(await vendedor.volta(), { tipo: "nada", motivo: "esperando-copiloto" });
      assert.equal(enviados.length, 0);
      agora += ESPERA_DO_COPILOTO_MS;
      assert.equal((await vendedor.volta()).tipo, "avisar");
      assert.match(enviados[0], /💬 Última mensagem: você/);
      assert.match(enviados[0], /Mensagem pronta/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("com a sugestão pronta, o aviso sai na hora com a mensagem do copiloto", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vendedor-"));
    try {
      const enviados: string[] = [];
      const vendedor = criarVendedor({
        lerVisao: async () => visaoCom(SIM, KULNISKI.slice(0, 3)),
        enviar: async (texto) => { enviados.push(texto); },
        registrar: async () => {},
        arquivoDeEstado: path.join(dir, "vendedor.json"),
        agora: () => AGORA.getTime(),
        copiloto: {
          prontas: async () => new Map([["site:K", { mensagem: "Segue o link, desculpe a demora!", porque: "pediu há 2 dias", quando: horas(0.1) }]]),
          pedir: async () => { throw new Error("não devia pedir"); },
        },
      });
      assert.equal((await vendedor.volta()).tipo, "avisar");
      assert.match(enviados[0], /Sugestão do copiloto, que leu a conversa/);
      assert.match(enviados[0], /Segue o link, desculpe a demora!/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
