/**
 * Decisão pura "refresh recusado = credencial morta?" (F1 da revisão final).
 * Só invalid_grant em 400/401 apaga a credencial; o resto (rede, 5xx,
 * invalid_client/unauthorized_client) é falha transitória do Google ou do
 * ambiente, não da credencial. Puro: sem rede nem disco.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concessoesDoScope, ESCOPO_CALENDAR, ESCOPO_TASKS, escopoDaCredencial, refreshRecusado } from "./auth-store.ts";

describe("refreshRecusado", () => {
  const casos: Array<[string, number | null, string | undefined, boolean]> = [
    ["400 invalid_grant: revogado", 400, "invalid_grant", true],
    ["401 invalid_grant: expirado (7 dias do modo Testando)", 401, "invalid_grant", true],
    ["400 invalid_client: client OAuth, não credencial", 400, "invalid_client", false],
    ["401 unauthorized_client: client OAuth, não credencial", 401, "unauthorized_client", false],
    ["500 com invalid_grant no corpo: status não bate, transitório", 500, "invalid_grant", false],
    ["503 sem código: transitório", 503, undefined, false],
    ["sem resposta (rede/DNS/timeout): transitório", null, undefined, false],
    ["400 sem código no corpo: transitório", 400, undefined, false],
  ];

  for (const [nome, status, codigo, esperado] of casos) {
    it(nome, () => {
      assert.equal(refreshRecusado(status, codigo), esperado);
    });
  }
});

/**
 * Escopos (autorização incremental do Google Tasks). O fallback de uma resposta
 * sem `scope` é SÓ o Calendar: com dois escopos no pedido, cair em "o que
 * pedimos" declararia um Tasks que ninguém concedeu.
 */
describe("escopoDaCredencial", () => {
  const DOIS = `${ESCOPO_CALENDAR} ${ESCOPO_TASKS}`;
  const casos: Array<[string, unknown, string]> = [
    ["scope devolvido é gravado como veio", DOIS, DOIS],
    ["espaços nas pontas saem", `  ${DOIS} `, DOIS],
    ["ausente: só Calendar", undefined, ESCOPO_CALENDAR],
    ["vazio: só Calendar", "", ESCOPO_CALENDAR],
    ["não-string: só Calendar", 42, ESCOPO_CALENDAR],
  ];
  for (const [nome, entrada, esperado] of casos) {
    it(nome, () => {
      assert.equal(escopoDaCredencial(entrada), esperado);
    });
  }
});

describe("concessoesDoScope", () => {
  const casos: Array<[string, string | null | undefined, { calendar: boolean; tasks: boolean }]> = [
    ["os dois", `${ESCOPO_CALENDAR} ${ESCOPO_TASKS}`, { calendar: true, tasks: true }],
    ["credencial antiga, só Calendar", ESCOPO_CALENDAR, { calendar: true, tasks: false }],
    ["Calendar desmarcado no consentimento granular", ESCOPO_TASKS, { calendar: false, tasks: true }],
    ["com escopos extras (include_granted_scopes)", `openid ${ESCOPO_TASKS} ${ESCOPO_CALENDAR}`, { calendar: true, tasks: true }],
    ["sem scope", undefined, { calendar: false, tasks: false }],
  ];
  for (const [nome, scope, esperado] of casos) {
    it(nome, () => {
      assert.deepEqual(concessoesDoScope(scope), esperado);
    });
  }
});
