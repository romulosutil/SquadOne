# Sprites do escritório (spec §5)

Um único passo, determinístico: a arte já vem pronta e consistente do CraftPix, o
script só recorta, redimensiona e empacota em strips. Não há geração por IA, não
há custo por execução, o resultado é reprodutível.

```
assets/craftpix/PNG/<Char>/PNG Sequences/{Idle,Walking}/*.png   (520x420, vetorial)
    -> scripts/craftpix-sheets.py
    -> public/sprites/<char>_{idle,walk}.png + public/sprites/craftpix.manifest.json
```

## Pré-requisitos

- `pip install -r requirements.txt` (Pillow).
- O pacote CraftPix descompactado em `assets/craftpix/PNG/` (git-ignored).

## Uso

```bash
python scripts/craftpix-sheets.py                 # padrão: --height 96
python scripts/craftpix-sheets.py --height 64
python scripts/craftpix-sheets.py --src assets/craftpix/PNG --out public/sprites
```

## Duas regras que não são detalhe

- **Recorte pelo bbox de UNIÃO** de todos os frames do personagem (idle + walk),
  nunca o bbox de cada frame — senão o personagem pula de posição a cada troca de
  frame.
- **LANCZOS com alpha preservado.** A arte é vetorial com contorno grosso, não
  pixel art: quantizar contra paleta, forçar alpha binário ou aplicar dither
  destruiria o contorno.

A largura do frame é arredondada para número par, para o `scaleX(-1)` do billboard
cair no pixel.

## Saída

| Arquivo | Conteúdo |
|---|---|
| `public/sprites/<char>_idle.png` | strip horizontal de 1 linha, N frames de idle |
| `public/sprites/<char>_walk.png` | strip horizontal de 1 linha, N frames de caminhada |
| `public/sprites/craftpix.manifest.json` | `frameW`, `frameH` e `{file, frames}` por animação — lido pelo frontend |

Personagens empacotados: `Wraith_01`, `Wraith_02`, `Wraith_03`. Crédito e licença
da arte ficam em `public/sprites/CREDITS.md`.

## Histórico

O pipeline anterior — geração de pixel art por IA (`gen-sprites.ts`) mais
pós-processamento determinístico (`spritify.py`, `palette.png`,
`sprites.manifest.json`) — foi abandonado em 11/09/2026 e os arquivos removidos em
12/09/2026. O motivo está registrado na spec §5.4
(`docs/superpowers/specs/2026-09-11-squadone-escritorio-po-design.md`).
