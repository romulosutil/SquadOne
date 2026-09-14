/**
 * Postos de uma sala com N pessoas: ninguém em cima de ninguém, nem de prop,
 * nem no caminho da porta.
 *
 * Roda com `npm test` (node:test via tsx). Percorre TODOS os templates de
 * propósito: a regra tem que valer para o que `rooms.ts` tiver, não para um
 * template escolhido a dedo.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOOR_EAST, DOOR_SOUTH, ROOM_H, ROOM_TEMPLATES, ROOM_W, parseRoom, type RoomId } from "./rooms.ts";
import { distanciaTela, postoLocal, postosDaSala, tilesLivres } from "./postos.ts";

const SALAS = Object.keys(ROOM_TEMPLATES) as RoomId[];

/**
 * Dois tiles vizinhos ficam a ~36px de tela — era o espaçamento do miolo
 * antigo, que sobrepunha os sprites. Até 8 pessoas tem que sobrar folga.
 */
const MIN_PX_ATE_8 = 40;

/** Tiles que um ponto (possivelmente fracionário) encosta. */
function tilesTocados([x, y]: [number, number]): string[] {
  const out: string[] = [];
  for (const tx of new Set([Math.floor(x), Math.ceil(x)]))
    for (const ty of new Set([Math.floor(y), Math.ceil(y)])) out.push(`${tx},${ty}`);
  return out;
}

const PASSAGEM = new Set([
  `${DOOR_EAST[0]},${DOOR_EAST[1]}`,
  `${DOOR_SOUTH[0]},${DOOR_SOUTH[1]}`,
  `${DOOR_EAST[0] - 1},${DOOR_EAST[1]}`,
  `${DOOR_SOUTH[0]},${DOOR_SOUTH[1] - 1}`,
  `1,${DOOR_EAST[1]}`,
  `${DOOR_SOUTH[0]},1`,
]);

describe("postosDaSala", () => {
  for (const sala of SALAS) {
    describe(sala, () => {
      const { stations, props } = parseRoom(sala);
      const ocupados = new Set(props.map((p) => `${p.local[0]},${p.local[1]}`));

      it(`nenhum par a menos de ${MIN_PX_ATE_8}px de tela com até 8 pessoas`, () => {
        for (let n = 2; n <= 8; n++) {
          const ps = postosDaSala(sala, n);
          for (let i = 0; i < n; i++)
            for (let j = i + 1; j < n; j++) {
              const d = distanciaTela(ps[i], ps[j]);
              assert.ok(d >= MIN_PX_ATE_8, `N=${n}: postos ${i} ${JSON.stringify(ps[i])} e ${j} ${JSON.stringify(ps[j])} a ${d.toFixed(1)}px`);
            }
        }
      });

      it("cadeiras do template primeiro, na ordem", () => {
        const ps = postosDaSala(sala, stations.length);
        assert.deepEqual(ps, stations);
      });

      it("excedente fora de prop, porta e tile de passagem, e dentro do interior", () => {
        const ps = postosDaSala(sala, 12);
        ps.slice(stations.length).forEach((p, k) => {
          const [x, y] = p;
          assert.ok(x >= 1 && x <= ROOM_W - 2 && y >= 1 && y <= ROOM_H - 2, `posto ${k} fora do interior: ${p}`);
          const tocados = tilesTocados(p);
          // Em cima do prop, nunca: no centro de um tile, o tile é só dele.
          if (tocados.length === 1) assert.ok(!ocupados.has(tocados[0]), `posto ${JSON.stringify(p)} em cima do prop`);
          // Encostar na mobília vale; ficar no meio dela (maioria dos tiles tocados), não.
          const emProp = tocados.filter((t) => ocupados.has(t)).length;
          assert.ok(emProp * 2 <= tocados.length, `posto ${JSON.stringify(p)} no meio da mobília`);
          for (const t of tocados) assert.ok(!PASSAGEM.has(t), `posto ${JSON.stringify(p)} encosta na passagem ${t}`);
        });
      });

      it("de 9 a 16 pessoas encolhe o espaçamento, mas ninguém coincide", () => {
        const ps = postosDaSala(sala, 16);
        for (let i = 0; i < ps.length; i++)
          for (let j = i + 1; j < ps.length; j++)
            assert.ok(distanciaTela(ps[i], ps[j]) > 1, `postos ${i} e ${j} coincidem: ${ps[i]}`);
      });

      it("prefixo estável: contratar não reassenta quem já estava", () => {
        const cinco = postosDaSala(sala, 5);
        const dez = postosDaSala(sala, 10);
        assert.deepEqual(dez.slice(0, 5), cinco);
        for (let i = 0; i < 5; i++) assert.deepEqual(postoLocal(sala, i, 5), postoLocal(sala, i, 11));
      });

      it("tilesLivres não devolve prop nem passagem", () => {
        for (const [x, y] of tilesLivres(sala)) {
          assert.ok(!ocupados.has(`${x},${y}`), `tile livre em prop: ${x},${y}`);
          assert.ok(!PASSAGEM.has(`${x},${y}`), `tile livre em passagem: ${x},${y}`);
        }
      });
    });
  }

  it("determinístico: mesma entrada, mesmo resultado (inclusive fora da ordem)", async () => {
    const antes = SALAS.map((s) => postosDaSala(s, 12));
    // Um módulo novo (cache vazio) e pedidos em ordem diferente não mudam nada.
    const fresco = await import(`./postos.ts?fresco=${Date.now()}`);
    for (const s of [...SALAS].reverse()) fresco.postoLocal(s, 11, 12);
    assert.deepEqual(SALAS.map((s) => fresco.postosDaSala(s, 12)), antes);
  });

  it("idx além do total recebe o próximo posto, não undefined", () => {
    for (const sala of SALAS) assert.ok(Array.isArray(postoLocal(sala, 3, 1)));
  });
});
