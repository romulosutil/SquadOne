#!/usr/bin/env python3
"""Empacota as sequências PNG do CraftPix em strips horizontais para o escritório.

    assets/craftpix/PNG/<Char>/PNG Sequences/<Anim>/*.png   (520x420, vetorial)
        -> public/sprites/<char>_<anim>.png                 (strip 1 linha)
        -> public/sprites/craftpix.manifest.json

Duas regras que não são detalhe:

1. O recorte usa o bbox de UNIÃO de todos os frames do personagem (idle + walk).
   Recortar cada frame no seu próprio bbox faria o personagem pular de posição a
   cada troca de frame.
2. Downscale com LANCZOS e alpha preservado. A arte é vetorial com contorno
   grosso, não pixel art — BOX + alpha binário + quantização (spec §5.2) é o
   pipeline do caso oposto e destruiria o contorno.

Uso:  python scripts/craftpix-sheets.py [--src DIR] [--out DIR] [--height 96]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

# nome do diretório da animação no pacote -> chave usada no runtime
ANIMS = {
    "Idle": "idle",
    "Walking": "walk",
}

CHARS = ["Wraith_01", "Wraith_02", "Wraith_03"]


def frame_paths(char_dir: Path, anim: str) -> list[Path]:
    d = char_dir / "PNG Sequences" / anim
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if p.suffix.lower() == ".png")


def union_bbox(paths: list[Path]) -> tuple[int, int, int, int]:
    box: tuple[int, int, int, int] | None = None
    for p in paths:
        with Image.open(p) as im:
            b = im.convert("RGBA").getbbox()
        if b is None:
            continue
        box = b if box is None else (
            min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])
        )
    if box is None:
        raise SystemExit("todos os frames estão vazios")
    return box


def build_char(char_dir: Path, out_dir: Path, height: int) -> dict | None:
    anims = {key: frame_paths(char_dir, name) for name, key in ANIMS.items()}
    anims = {k: v for k, v in anims.items() if v}
    if not anims:
        return None

    every = [p for paths in anims.values() for p in paths]
    x0, y0, x1, y1 = union_bbox(every)
    src_w, src_h = x1 - x0, y1 - y0

    scale = height / src_h
    frame_w = max(2, round(src_w * scale / 2) * 2)  # par, pra o flip cair no pixel
    frame_h = height

    slug = char_dir.name.lower()
    entry: dict = {"frameW": frame_w, "frameH": frame_h, "anims": {}}

    for key, paths in anims.items():
        strip = Image.new("RGBA", (frame_w * len(paths), frame_h), (0, 0, 0, 0))
        for i, p in enumerate(paths):
            with Image.open(p) as im:
                cell = im.convert("RGBA").crop((x0, y0, x1, y1))
            cell = cell.resize((frame_w, frame_h), Image.LANCZOS)
            strip.paste(cell, (i * frame_w, 0))
        name = f"{slug}_{key}.png"
        strip.save(out_dir / name, optimize=True)
        entry["anims"][key] = {"file": f"/sprites/{name}", "frames": len(paths)}
        print(f"  {name}: {len(paths)} frames  {strip.width}x{strip.height}")

    return entry


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="assets/craftpix/PNG")
    ap.add_argument("--out", default="public/sprites")
    ap.add_argument("--height", type=int, default=96, help="altura do frame em px")
    args = ap.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    if not src.is_dir():
        print(f"fonte não encontrada: {src}", file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)

    manifest: dict = {"version": 1, "source": "craftpix free wraith tiny style", "chars": {}}
    for name in CHARS:
        char_dir = src / name
        if not char_dir.is_dir():
            print(f"pulando {name}: não encontrado", file=sys.stderr)
            continue
        print(f"{name}:")
        entry = build_char(char_dir, out, args.height)
        if entry:
            manifest["chars"][name.lower()] = entry

    if not manifest["chars"]:
        print("nenhum personagem empacotado", file=sys.stderr)
        return 1

    (out / "craftpix.manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"manifest -> {out / 'craftpix.manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
