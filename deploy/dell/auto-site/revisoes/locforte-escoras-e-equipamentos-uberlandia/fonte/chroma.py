"""Tira o fundo verde chapado (#00FF00) por chroma key e grava PNG com alfa; tira o reflexo verde."""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
a = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
verde = g - np.maximum(r, b)          # ~255 no fundo, ~0 no metal
alfa = np.clip(1 - (verde - 40) / (150 - 40), 0, 1)
# Só o objeto principal: componentes pequenos (respingos) saem.
rot, n = ndimage.label(alfa > 0.5)
if n:
    tam = ndimage.sum(np.ones_like(rot), rot, np.arange(1, n + 1))
    alfa = alfa * np.isin(rot, 1 + np.where(tam > 1500)[0]) if False else alfa * ndimage.binary_dilation(np.isin(rot, 1 + np.where(tam > 1500)[0]), iterations=2)
g2 = np.minimum(g, np.maximum(r, b) + 6)  # despill
rgb = np.stack([r, g2, b], -1).clip(0, 255).astype(np.uint8)
img = Image.fromarray(rgb)
img.putalpha(Image.fromarray((alfa * 255).astype(np.uint8)))
bbox = img.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox()
img = img.crop(bbox)
img.save(out)
print("fundo verde médio:", a[verde > 200].mean(0).round(1), "bbox", bbox, "size", img.size)
