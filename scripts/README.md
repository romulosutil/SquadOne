# Sprites do escritório (spec §5)

Dois passos separados de propósito: a IA só produz **bruto**, o pipeline determinístico
produz os **7 arquivos finais**. Regerar arte nunca muda a geometria; mexer na geometria
nunca custa dólar.

```
scripts/gen-sprites.ts   15 gerações 1024px, fundo magenta   ->  assets/raw/*.png   (git-ignored)
scripts/spritify.py      chroma -> despill -> BOX -> alpha -> quantize  ->  public/sprites/*.png
```

## Pré-requisitos

- `GEMINI_API_KEY` no ambiente ou em `.env` (ver `.env.example`).
- **Billing ativo** no projeto da chave: geração de imagem não tem free tier. Sem isso a
  API responde `429 ... limit: 0` para `gemini-3.1-flash-lite-image`.
- `pip install -r requirements.txt` (Pillow + numpy).

## Fluxo

```bash
python scripts/spritify.py palette            # escreve scripts/palette.png (Endesga 32, CC0)
npx tsx scripts/gen-sprites.ts --list         # ordem ancorada e estado de cada peça
npx tsx scripts/gen-sprites.ts                # gera até o PORTÃO (char_po_down)
# olhe assets/raw/char_po_down.png:
#   ruim -> npx tsx scripts/gen-sprites.ts --only char_po_down --force
#   bom  -> npx tsx scripts/gen-sprites.ts --approve char_po_down
npx tsx scripts/gen-sprites.ts                # gera o resto usando a frente como referência
python scripts/spritify.py build              # monta public/sprites/*.png
```

`python scripts/spritify.py selftest` roda o pipeline inteiro sobre fixtures sintéticas
(sem chamar a API): valida dimensões, alpha binário e aderência à paleta.

## Por que nesta ordem

- **Ordem ancorada (§5.3):** `tile_floor` → parede → `char_po_down` (portão) → demais
  direções com a frente como imagem de referência → props. Cada peça manda as anteriores
  como `inlineData`; consistência vale mais que qualquer outro critério no prompt.
- **Paleta travada:** citada no prompt *e* aplicada no quantizador. Deriva de matiz
  deixa de existir.
- **Pipeline (§5.2):** quantizar antes do chroma key mapearia o magenta para a paleta e
  destruiria a chave; dither em 32x32 vira ruído; alpha parcial + `pixelated` a 2x mostra
  pixels fantasmas na borda.
- **Frames de caminhada derivados, não gerados:** as colunas 1 e 2 de `char_po.png` saem
  do idle por deslocamento de 1px da faixa das pernas — cabeça, tronco e linha do pé
  (y=30) ficam parados entre frames.
- **Não gerar:** sombra (pseudo-elemento CSS), highlight e nameplate (DOM + Tailwind).

## Saída

| Arquivo | Dim | Conteúdo |
|---|---|---|
| `char_po.png` | 96x128 | col 0 parado, 1 passo-A, 2 passo-B; row 0 baixo, 1 esq, 2 dir, 3 cima; pés em y=30 |
| `tile_floor.png` | 32x32 | piso seamless |
| `tile_wall.png` | 160x32 | canto-SE, borda-sup, canto-SD, lateral, borda-inf |
| `tile_door.png` | 64x32 | fechada, aberta |
| `prop_desk.png` | 64x48 | mesa + monitor (16px estourando pra cima) |
| `prop_chair.png` | 32x32 | cadeira |
| `prop_plant.png` | 32x48 | planta |
