# Adendo — escritório isométrico com arte CraftPix

> **ABSORVIDO em 2026-09-12.** O conteúdo deste adendo foi incorporado à spec
> principal (§2, §4 e §5 de `2026-09-11-squadone-escritorio-po-design.md`), que
> agora já descreve o isométrico e a arte CraftPix. Este arquivo fica como
> registro da decisão e do diff contra a versão top-down original.

Complementa `2026-09-11-squadone-escritorio-po-design.md`. Onde os dois
divergirem, vale este. Motivo: decisão do PO em 11/09/2026 por **isométrico** e
pela arte do pacote CraftPix já disponível em `assets/craftpix/`.

## O que muda

| Spec original | Agora | Por quê |
|---|---|---|
| Vista ortogonal top-down | Isométrico 2:1 (tile 32x32 → 64x32 na tela) | pedido do PO |
| Pixel art 32x32, paleta CC0, quantização (§5.2) | Vetorial CraftPix: LANCZOS, alpha preservado, sem quantizar | a arte é vetorial com contorno grosso; downscale + alpha binário + dither destrói o contorno |
| `char_po.png` 96x128, 3 poses x 4 direções | Strips horizontais por animação, 12 frames, frente única | o pacote só tem a vista frontal |
| Frame de caminhada `PINGPONG[(dist/STEP)|0 % 4]` | `(dist/STEP) | 0 % frames`, ciclo real de 12 frames | generalização do mesmo princípio: frame vem da distância, não do relógio |
| 4 direções por linha do sheet | Billboard + `scaleX(-1)` conforme o sinal de dx **na tela** | sem arte lateral/traseira |
| ~13 nós por sala | ~18: base + chão + até 10 tiles de parede + props + placa | a profundidade de uma parede longa não cabe num único z-index |

## O que NÃO muda

- Templates de sala, `pitch = [7,5]`, `mapSize = [7N+1, 5M+1]`, ordem de desbloqueio.
- BFS sobre slots + interpolação reta + 3 waypoints na porta (§4.3). **Todo o
  pathfinding continua no mundo ortogonal.** O isométrico existe só em
  `toScreen()` e nas matrizes CSS de `rooms.ts`.
- Um único rAF que dorme sozinho, `Math.round` antes de virar px, escrita direta
  em `el.style`, idle em CSS puro (§4.2).
- Fallback de emoji quando o sheet não carrega.

## Consequência para o pipeline de sprites (§5)

`scripts/spritify.py` e `scripts/gen-sprites.ts` miram os 7 arquivos pixel art de
§5.1 — alvo morto para os **personagens**. Continuam válidos para props e tiles,
se a decisão for ter chão/mobília em pixel art. Hoje props são emoji e
chão/parede são CSS chapado, coerentes com o contorno grosso da arte.

`scripts/craftpix-sheets.py` gera os strips:

```bash
python scripts/craftpix-sheets.py --height 64
# assets/craftpix/PNG/<Char>/PNG Sequences/{Idle,Walking}
#   -> public/sprites/<char>_{idle,walk}.png + craftpix.manifest.json
```

Recorte pelo bbox de **união** de todos os frames do personagem, não o bbox de
cada frame — senão o personagem pula de posição a cada troca de frame.

## Pendências

- 3 personagens no pacote para N papéis: o excedente reusa um sheet com
  `hue-rotate`. Palette swap real seria melhor.
- Props e mobília ainda são emoji.
- Sem sombra projetada real, sem oclusão de ator atrás de parede alta.
- Animações não usadas do pacote: `Attacking`, `Casting Spells`, `Taunt`,
  `Hurt`, `Dying` — candidatas naturais a estado "trabalhando" e "erro".
