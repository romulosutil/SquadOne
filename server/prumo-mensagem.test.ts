import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REENVIO_ROBO_PRUMO, reenvioDoPrumo } from "./prumo-mensagem.ts";

// O reenvio do só-robô do PRUMO (14/10/2026): só do CRM, o n8n não manda este texto.
const texto = (link: string) => new URL(link).searchParams.get("text") ?? "";

describe("prumo-mensagem: reenvio do só-robô", () => {
  it("pede quem cuida do marketing e do comercial, com o nome como o dono escreve e o artigo certo", () => {
    assert.equal(texto(reenvioDoPrumo("5511900000000", "RODA MAIS DISTRIBUIDORA LTDA")),
      "Oi, tudo bem? Aqui é o Rômulo, do PRUMO. Mandei uma mensagem por aqui, mas acho que só chegou o atendimento automático. " +
      "Pode me indicar quem cuida do marketing e do comercial da Roda Mais Distribuidora? É coisa rápida.");
    assert.match(texto(reenvioDoPrumo("5511900000000", "Escritório Lima")), /comercial do Escritório Lima\? É coisa rápida\.$/);
    assert.ok(reenvioDoPrumo("551190000000", "X").startsWith("https://wa.me/551190000000?text="), "fixo de 10 dígitos com 55");
  });

  it("sem preço, saudação de hora, 'ontem' nem placeholder", () => {
    const t = texto(reenvioDoPrumo("5511900000000", "Empresa Boa"));
    assert.doesNotMatch(t, /R\$|bom dia|boa tarde|boa noite|ontem|\{/i);
    assert.doesNotMatch(REENVIO_ROBO_PRUMO, /R\$|\{RAIO_X\}/);
  });

  it("só número do Brasil: EUA, vazio ou sem DDI não recebem", () => {
    for (const numero of ["13055550100", "", "11900000000", "5511", "551190000000000"]) {
      assert.equal(reenvioDoPrumo(numero, "Empresa Boa"), "", numero);
    }
  });
});
