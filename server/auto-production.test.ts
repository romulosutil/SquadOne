import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { lerPastasDosLeads } from "./auto-production.ts";

const temporarios: string[] = [];

async function escrever(arquivo: string, conteudo: string): Promise<void> {
  await fs.mkdir(path.dirname(arquivo), { recursive: true });
  await fs.writeFile(arquivo, conteudo);
}

async function fixture(): Promise<string> {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-auto-"));
  temporarios.push(raiz);
  // Na fila: pasta com content.md (place_id no texto), fotos e capa, sem site.
  await escrever(path.join(raiz, "na-fila", "content.md"), "# Na Fila\n\n- **place_id:** ChIJfila000001\n");
  await escrever(path.join(raiz, "na-fila", "Fotos", "a.jpg"), "x");
  await escrever(path.join(raiz, "na-fila", "Fotos", "b.webp"), "x");
  await escrever(path.join(raiz, "na-fila", "Logotipo", "capa.jpg"), "x");
  await escrever(path.join(raiz, "na-fila", "falha.log"), "\nTimeout do Claude\nsegunda linha\n");
  // Publicado na raiz e recusado na subpasta.
  await escrever(path.join(raiz, "publicado", "index.html"), "<!doctype html>");
  await escrever(path.join(raiz, "publicado", "publicado.json"), JSON.stringify({
    place_id: "ChIJpub000001", nome: "Publicado", site_url: "https://demo-publicado.vercel.app", publicado_em: "2026-09-28T10:00:00-03:00",
  }));
  await escrever(path.join(raiz, "_recusados", "recusou", "publicado.json"), JSON.stringify({ place_id: "ChIJrec000001", site_url: "javascript:alert(1)",
    apagado_em: "2026-10-07T22:47:31-03:00" }));
  await escrever(path.join(raiz, "_descartados", "descartado", "content.md"), "place_id:** ChIJdesc00001\n");
  // Pastas técnicas ficam de fora.
  await escrever(path.join(raiz, ".logs", "status.json"), JSON.stringify({ estado: "processando", lead: "na-fila", pendentes: 3 }));
  await fs.mkdir(path.join(raiz, "_build", "x"), { recursive: true });
  return raiz;
}

afterEach(async () => {
  await Promise.all(temporarios.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("Pastas do Site antes da venda", () => {
  it("acha o place_id no recibo ou no content.md e diz onde cada pasta mora", async () => {
    const { pastas } = await lerPastasDosLeads(await fixture());
    const resumo = pastas.map((p) => `${p.lugar || "raiz"}/${p.slug}:${p.placeId}`).sort();
    assert.deepEqual(resumo, [
      "_descartados/descartado:ChIJdesc00001",
      "_recusados/recusou:ChIJrec000001",
      "raiz/na-fila:ChIJfila000001",
      "raiz/publicado:ChIJpub000001",
    ]);
  });

  it("conta artefatos só de quem ainda não tem site e lê a primeira linha do falha.log", async () => {
    const { pastas } = await lerPastasDosLeads(await fixture());
    const fila = pastas.find((p) => p.slug === "na-fila")!;
    assert.deepEqual(fila.artefatos, { conteudo: true, fotos: 2, capa: true, gerado: false, publicado: false, falha: true });
    assert.equal(fila.falhaMensagem, "Timeout do Claude");
    const publicado = pastas.find((p) => p.slug === "publicado")!;
    assert.equal(publicado.artefatos.publicado, true);
    assert.equal(publicado.nome, "Publicado");
    assert.equal(publicado.publicadoEm, "2026-09-28T13:00:00.000Z");
    assert.equal(pastas.find((p) => p.slug === "recusou")!.siteUrl, undefined, "URL fora de http/https é descartada");
    assert.equal(pastas.find((p) => p.slug === "recusou")!.apagadoEm, "2026-10-08T01:47:31.000Z", "site-demos-limpeza apagou o demo");
    assert.equal(publicado.apagadoEm, undefined);
  });

  it("lê o estado do gerador pelo resumo que ele mesmo grava", async () => {
    const { gerador } = await lerPastasDosLeads(await fixture());
    assert.equal(gerador.estado, "processando");
    assert.equal(gerador.pendentes, 3);
    const vazio = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-auto-"));
    temporarios.push(vazio);
    const semNada = await lerPastasDosLeads(vazio);
    assert.deepEqual(semNada.pastas, []);
    assert.equal(semNada.gerador.estado, "desconhecido");
  });
});
