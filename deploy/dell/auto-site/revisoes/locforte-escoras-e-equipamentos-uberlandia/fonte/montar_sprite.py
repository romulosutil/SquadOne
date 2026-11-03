"""Sprite dos recortes dos cartões: seis quadros lado a lado (escoras, laje, torre, aprumador,
ancoragem, elevador), cada um com o equipamento centrado sobre transparência (o fundo cinza
liso das imagens sai por flood fill a partir da borda, e a sombra vira escurecimento), para o
mesmo arquivo servir na placa cinza dos cartões e no fecho, sobre o marinho.

Uso: python montar_sprite.py escoras.jpg laje.jpg torre.jpg aprumador.jpg ancoragem.jpg elevador.jpg
     [--quadro 400x300] [--q 70]
Grava img/sprite.webp e qa/sprite-sobre-cinza.jpg / qa/sprite-sobre-marinho.jpg para conferir."""
import argparse, io
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

R = Path(__file__).parent
CINZA = (0xE5, 0xE9, 0xEA)  # --placa: o fundo do recorte das escoras


def recortar(caminho: Path) -> Image.Image:
    im = Image.open(caminho).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    h, w, _ = a.shape
    lum, croma = a.mean(2), a.max(2) - a.min(2)
    ok = (lum > 120) & (croma < 18)
    fundo = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if ok[y, x] and not fundo[y, x]:
                fundo[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if ok[y, x] and not fundo[y, x]:
                fundo[y, x] = True; q.append((y, x))
    soma = a.sum(2)
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not fundo[ny, nx] and ok[ny, nx] and abs(int(soma[ny, nx]) - int(soma[y, x])) <= 9:
                fundo[ny, nx] = True; q.append((ny, nx))
    ref = np.median(a[fundo], axis=0) if fundo.any() else np.array(CINZA)
    escuro = np.clip((ref.mean() - lum) / ref.mean(), 0, 1)
    obj = np.asarray(Image.fromarray((~fundo * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))) > 127
    alfa = np.where(obj, 1.0, np.where(fundo, np.clip(escuro * 2.2, 0, 1) * .55, 0.0))
    cor = np.where(fundo[..., None], 0, a).astype(np.uint8)
    out = Image.fromarray(cor); out.putalpha(Image.fromarray((alfa * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(.6)))
    caixa = out.getchannel('A').point(lambda v: 255 if v > 60 else 0).getbbox() or (0, 0, w, h)
    return out.crop(caixa)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('imagens', nargs=6, type=Path)
    ap.add_argument('--quadro', default='400x300')
    ap.add_argument('--q', type=int, default=70)
    ap.add_argument('--margem', type=float, default=.1)
    a = ap.parse_args()
    qw, qh = map(int, a.quadro.split('x'))
    sprite = Image.new('RGBA', (qw * 6, qh), (0, 0, 0, 0))
    for i, c in enumerate(a.imagens):
        r = recortar(c)
        m = a.margem
        esc = min(qw * (1 - 2 * m) / r.width, qh * (1 - 2 * m) / r.height)
        r = r.resize((max(1, round(r.width * esc)), max(1, round(r.height * esc))), Image.LANCZOS)
        sprite.alpha_composite(r, (i * qw + (qw - r.width) // 2, (qh - r.height) // 2))
    # achatado sobre o cinza da placa: o fundo de todos os quadros fica exatamente #E5E9EA (sem emenda)
    plano = Image.new('RGBA', sprite.size, CINZA + (255,)); plano.alpha_composite(sprite)
    b = io.BytesIO(); plano.convert('RGB').save(b, 'WEBP', quality=a.q, method=6)
    (R / 'img' / 'sprite.webp').write_bytes(b.getvalue())
    print('sprite.webp', sprite.size, len(b.getvalue()), 'bytes;', len(b.getvalue()) * 4 // 3, 'em base64')
    for cor, n in ((CINZA, 'cinza'), ((16, 32, 56), 'marinho')):
        f = Image.new('RGBA', sprite.size, cor + (255,)); f.alpha_composite(sprite); f.convert('RGB').save(R / 'qa' / f'sprite-sobre-{n}.jpg', quality=85)


if __name__ == '__main__':
    main()
