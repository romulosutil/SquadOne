#!/usr/bin/env python3
"""spritify.py — bruto da IA (1024px, fundo magenta) -> os 7 PNGs do dia 1 (spec §5).

A ordem do pipeline é obrigatória (spec §5.2) e está implementada nesta ordem:

    chroma key magenta (na resolucao ALTA)
      -> despill da franja anti-aliased
      -> downscale BOX (nao NEAREST, nao LANCZOS)
      -> alpha binario (threshold 128)
      -> quantize contra a paleta CC0 fixa, dither=NONE

Quantizar antes de tirar o fundo mapearia o magenta para a paleta e destruiria a
chave de cor; dither em 32x32 vira ruido; alpha parcial + image-rendering:pixelated
a 2x mostra pixels fantasmas na borda.

Frames de caminhada (colunas 1 e 2 de char_po.png) sao DERIVADOS aqui, nao
gerados (spec §5.3 item 3).

Uso:
    python scripts/spritify.py palette          # escreve scripts/palette.png (paleta CC0 travada)
    python scripts/spritify.py build            # assets/raw/*.png -> public/sprites/*.png
    python scripts/spritify.py build --only char_po.png
    python scripts/spritify.py selftest         # valida o pipeline com fixtures sinteticas
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "scripts" / "sprites.manifest.json"

# --- parametros do chroma key -------------------------------------------------
KEY_RGB = np.array([255.0, 0.0, 255.0])
KEY_IN = 70.0    # distancia <= IN  => fundo puro (alpha 0)
KEY_OUT = 190.0  # distancia >= OUT => sujeito solido (alpha 1)
ALPHA_THRESHOLD = 128  # spec §5.2: alpha binario

# --- leitura do manifesto -----------------------------------------------------


def load_manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def palette_rgb(manifest: dict) -> np.ndarray:
    hexes = manifest["palette"]["colors"]
    return np.array([[int(h[i : i + 2], 16) for i in (1, 3, 5)] for h in hexes], dtype=np.uint8)


# --- 1. chroma key ------------------------------------------------------------


def chroma_key(rgb: np.ndarray) -> np.ndarray:
    """Alpha 0..1 na resolucao ALTA, a partir da distancia ao magenta puro."""
    dist = np.sqrt(((rgb - KEY_RGB) ** 2).sum(axis=2))
    alpha = (dist - KEY_IN) / (KEY_OUT - KEY_IN)
    return np.clip(alpha, 0.0, 1.0)


# --- 2. despill ---------------------------------------------------------------


def despill(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Tira o magenta que vazou na franja anti-aliased.

    So age onde alpha e' parcial (0 < a < 1): la' o pixel e' mistura de sujeito com
    fundo. Dentro do sujeito solido nada e' tocado, entao roxo/rosa legitimo (se
    houvesse) sobrevive.
    """
    out = rgb.copy()
    fringe = (alpha > 0.0) & (alpha < 1.0)
    if not fringe.any():
        return out
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    spill = np.maximum(np.minimum(r, b) - g, 0.0)  # magenta = R e B acima do G
    mask = fringe & (spill > 0)
    out[..., 0] = np.where(mask, r - spill, r)
    out[..., 2] = np.where(mask, b - spill, b)
    return np.clip(out, 0.0, 255.0)


def keyed_rgba(path: Path, cutout: bool) -> np.ndarray:
    """Passos 1 e 2 na resolucao original. Devolve float RGBA (alpha 0..255)."""
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    if cutout:
        alpha = chroma_key(rgb)
        rgb = despill(rgb, alpha)
    else:
        # tile seamless: a arte cobre o quadro inteiro, nada a recortar
        alpha = np.ones(rgb.shape[:2], dtype=np.float32)
    return np.dstack([rgb, alpha * 255.0])


# --- 3. downscale BOX ---------------------------------------------------------


def downscale_box(rgba: np.ndarray, size: tuple[int, int]) -> Image.Image:
    """BOX (media de area). Premultiplica antes para o fundo nao sangrar na borda."""
    rgb = rgba[..., :3]
    a = rgba[..., 3:4] / 255.0
    pre = np.dstack([rgb * a, rgba[..., 3:4]]).astype(np.uint8)
    small = Image.fromarray(pre, "RGBA").resize(size, Image.Resampling.BOX)
    arr = np.asarray(small, dtype=np.float32)
    a_small = arr[..., 3:4] / 255.0
    with np.errstate(divide="ignore", invalid="ignore"):
        un = np.where(a_small > 0, arr[..., :3] / a_small, 0.0)
    return Image.fromarray(
        np.dstack([np.clip(un, 0, 255), arr[..., 3:4]]).astype(np.uint8), "RGBA"
    )


# --- 4. alpha binario ---------------------------------------------------------


def binarize_alpha(img: Image.Image) -> Image.Image:
    arr = np.asarray(img, dtype=np.uint8).copy()
    arr[..., 3] = np.where(arr[..., 3] >= ALPHA_THRESHOLD, 255, 0)
    return Image.fromarray(arr, "RGBA")


# --- 5. quantize --------------------------------------------------------------


def quantize(img: Image.Image, palette: np.ndarray) -> Image.Image:
    """Mapeia para a paleta CC0 travada, dither=NONE. Alpha preservado."""
    pal_img = Image.new("P", (1, 1))
    flat = list(palette.reshape(-1)) + [0] * (768 - palette.size)
    pal_img.putpalette(flat)
    rgb = img.convert("RGB").quantize(palette=pal_img, dither=Image.Dither.NONE).convert("RGB")
    out = np.dstack([np.asarray(rgb, dtype=np.uint8), np.asarray(img, dtype=np.uint8)[..., 3]])
    return Image.fromarray(out, "RGBA")


# --- composicao de celulas ----------------------------------------------------


def cell_tile(raw: Path, size: tuple[int, int]) -> Image.Image:
    """Tile seamless: o quadro inteiro vira a celula, opaco de borda a borda."""
    img = downscale_box(keyed_rgba(raw, cutout=False), size)
    arr = np.asarray(img, dtype=np.uint8).copy()
    arr[..., 3] = 255
    return Image.fromarray(arr, "RGBA")


def cell_cutout(raw: Path, size: tuple[int, int], bottom: int) -> Image.Image:
    """Recorta o sujeito, encaixa na celula e ancora pelo pe' (bottom exclusivo)."""
    rgba = keyed_rgba(raw, cutout=True)
    solid = rgba[..., 3] >= ALPHA_THRESHOLD
    if not solid.any():
        raise ValueError(f"{raw.name}: nada sobrou depois do chroma key (fundo magenta ausente?)")
    ys, xs = np.where(solid)
    crop = rgba[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]

    cw, ch = size
    src_h, src_w = crop.shape[:2]
    scale = min(cw / src_w, bottom / src_h)
    tw = max(1, min(cw, round(src_w * scale)))
    th = max(1, min(bottom, round(src_h * scale)))
    small = downscale_box(crop, (tw, th))

    cell = Image.new("RGBA", size, (0, 0, 0, 0))
    cell.paste(small, ((cw - tw) // 2, bottom - th))
    return cell


def derive_step(cell: Image.Image, phase: int) -> Image.Image:
    """Frame de caminhada derivado do idle (spec §5.3 item 3).

    Desloca a faixa das pernas 1px na horizontal; `phase` +1/-1 da' os dois frames
    de contato do ciclo (PINGPONG = idle, contato A, idle, contato B). A cabeca e o
    tronco nao se mexem e a linha do pe' (y=30) nao muda, entao o personagem nao
    flutua nem muda de altura entre frames.
    """
    arr = np.asarray(cell, dtype=np.uint8).copy()
    solid = arr[..., 3] > 0
    if not solid.any():
        return cell
    ys = np.where(solid)[0]
    legs_top = max(ys.min(), ys.max() - 5)

    band = np.roll(arr[legs_top : ys.max() + 1], phase, axis=1)
    band[:, 0 if phase > 0 else -1] = 0  # a coluna que o roll trouxe do outro lado
    arr[legs_top : ys.max() + 1] = band
    return Image.fromarray(arr, "RGBA")


# --- build --------------------------------------------------------------------


def build_sheet(sheet: dict, manifest: dict, raw_dir: Path, out_dir: Path, pal: np.ndarray) -> Path:
    sw, sh = sheet["size"]
    canvas = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    placed: dict[tuple[int, int], Image.Image] = {}

    for cellspec in sheet["cells"]:
        size = tuple(cellspec["size"])
        at = tuple(cellspec["at"])
        if "derive" in cellspec:
            src = placed[tuple(cellspec["from"])]
            phase = 1 if cellspec["derive"] == "step_a" else -1
            cell = derive_step(src, phase)
        else:
            raw = raw_dir / f"{cellspec['piece']}.png"
            if not raw.exists():
                raise FileNotFoundError(f"{raw} nao existe — rode antes: npx tsx scripts/gen-sprites.ts")
            mode = cellspec["mode"]
            if mode == "tile":
                cell = cell_tile(raw, size)
            else:
                bottom = cellspec.get("feetY", size[1] - 1) + 1 if mode == "char" else size[1]
                cell = cell_cutout(raw, size, bottom)
        placed[at] = cell
        canvas.paste(cell, at)

    final = quantize(binarize_alpha(canvas), pal)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / sheet["file"]
    final.save(out, "PNG", optimize=True)
    report(out, final, pal)
    return out


def report(path: Path, img: Image.Image, pal: np.ndarray) -> None:
    arr = np.asarray(img, dtype=np.uint8)
    alphas = set(np.unique(arr[..., 3]).tolist())
    opaque = arr[..., 3] == 255
    colors = np.unique(arr[opaque][:, :3], axis=0) if opaque.any() else np.empty((0, 3), np.uint8)
    off = [tuple(c) for c in colors if not (pal == c).all(axis=1).any()]
    flags = []
    if not alphas <= {0, 255}:
        flags.append(f"ALPHA PARCIAL {sorted(alphas)}")
    if off:
        flags.append(f"FORA DA PALETA {off[:3]}")
    status = "  ".join(flags) if flags else "ok"
    print(f"  {path.name:16} {img.size[0]}x{img.size[1]}  {len(colors):2} cores  {status}")


def cmd_build(args: argparse.Namespace) -> int:
    manifest = load_manifest()
    pal = palette_rgb(manifest)
    raw_dir = Path(args.raw) if args.raw else ROOT / manifest["rawDir"]
    out_dir = Path(args.out) if args.out else ROOT / manifest["outDir"]
    sheets = [s for s in manifest["sheets"] if not args.only or s["file"] == args.only]
    if not sheets:
        print(f"nenhuma folha chamada {args.only}", file=sys.stderr)
        return 1

    print(f"raw: {raw_dir}  ->  out: {out_dir}   paleta: {manifest['palette']['name']}")
    failures = 0
    for sheet in sheets:
        try:
            build_sheet(sheet, manifest, raw_dir, out_dir, pal)
        except (FileNotFoundError, ValueError) as exc:
            failures += 1
            print(f"  {sheet['file']:16} FALHOU — {exc}")
    return 1 if failures else 0


def cmd_palette(args: argparse.Namespace) -> int:
    """Escreve scripts/palette.png — a paleta CC0 travada (spec §10 item 5)."""
    manifest = load_manifest()
    pal = palette_rgb(manifest)
    swatch, cols = 16, 8
    rows = (len(pal) + cols - 1) // cols
    img = Image.new("RGB", (cols * swatch, rows * swatch))
    draw = ImageDraw.Draw(img)
    for i, color in enumerate(pal):
        x, y = (i % cols) * swatch, (i // cols) * swatch
        draw.rectangle([x, y, x + swatch - 1, y + swatch - 1], fill=tuple(int(c) for c in color))
    out = ROOT / "scripts" / "palette.png"
    img.save(out, "PNG")
    print(f"{out}  {img.size[0]}x{img.size[1]}  {len(pal)} cores  ({manifest['palette']['name']})")
    return 0


# --- selftest -----------------------------------------------------------------


def _fixture(piece: dict, path: Path) -> None:
    """Bruto sintetico: mesma forma de entrada que a IA produz (1024, fundo magenta)."""
    n = 512
    if piece["kind"] == "seamless":
        img = Image.new("RGB", (n, n), (90, 105, 136))
        d = ImageDraw.Draw(img)
        for i in range(0, n, 64):
            d.line([(i, 0), (i, n)], fill=(58, 68, 102), width=8)
        img.save(path)
        return
    img = Image.new("RGB", (n, n), (255, 0, 255))
    d = ImageDraw.Draw(img)
    d.ellipse([200, 60, 312, 172], fill=(232, 183, 150))   # cabeca
    d.rectangle([190, 172, 322, 330], fill=(0, 153, 219))  # tronco
    d.rectangle([200, 330, 248, 450], fill=(58, 68, 102))  # perna esq
    d.rectangle([264, 330, 312, 450], fill=(58, 68, 102))  # perna dir
    img.save(path)


def cmd_selftest(args: argparse.Namespace) -> int:
    manifest = load_manifest()
    pal = palette_rgb(manifest)
    with tempfile.TemporaryDirectory() as tmp:
        raw_dir, out_dir = Path(tmp) / "raw", Path(tmp) / "out"
        raw_dir.mkdir()
        for piece in manifest["pieces"]:
            _fixture(piece, raw_dir / f"{piece['id']}.png")
        print("selftest — fixtures sinteticas, so valida o pipeline (nao e' arte):")
        failures = 0
        for sheet in manifest["sheets"]:
            out = build_sheet(sheet, manifest, raw_dir, out_dir, pal)
            img = Image.open(out)
            arr = np.asarray(img.convert("RGBA"), dtype=np.uint8)
            if tuple(img.size) != tuple(sheet["size"]):
                print(f"    FALHA: {out.name} tem {img.size}, esperado {tuple(sheet['size'])}")
                failures += 1
            if not set(np.unique(arr[..., 3]).tolist()) <= {0, 255}:
                print(f"    FALHA: {out.name} tem alpha parcial")
                failures += 1
            opaque = arr[..., 3] == 255
            for color in np.unique(arr[opaque][:, :3], axis=0):
                if not (pal == color).all(axis=1).any():
                    print(f"    FALHA: {out.name} tem cor fora da paleta {tuple(color)}")
                    failures += 1
                    break
        if args.keep:
            keep = ROOT / "assets" / "selftest"
            keep.mkdir(parents=True, exist_ok=True)
            for f in out_dir.iterdir():
                (keep / f.name).write_bytes(f.read_bytes())
            print(f"  saida copiada para {keep}")
        print("selftest OK" if not failures else f"selftest FALHOU ({failures})")
        return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="monta as folhas finais a partir de assets/raw")
    b.add_argument("--only", help="uma folha so (ex.: char_po.png)")
    b.add_argument("--raw", help="diretorio dos brutos")
    b.add_argument("--out", help="diretorio de saida")
    b.set_defaults(func=cmd_build)

    p = sub.add_parser("palette", help="escreve scripts/palette.png")
    p.set_defaults(func=cmd_palette)

    s = sub.add_parser("selftest", help="valida o pipeline com fixtures sinteticas")
    s.add_argument("--keep", action="store_true", help="copia a saida para assets/selftest")
    s.set_defaults(func=cmd_selftest)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
