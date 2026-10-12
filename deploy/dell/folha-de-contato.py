#!/usr/bin/env python3
"""Folha de contato do QA do gerador de sites (Dell, 11/10/2026): junta as capturas de uma rodada
numa imagem só, cada uma com rótulo (número, Ato, viewport, modo).

Por quê: o Claude do lead lia cada captura com um Read separado. Na média dos 97 leads premium de
08-10/10/2026 foram 44 capturas por lead, em 18 chamadas ao modelo, e cada chamada relê o
contexto inteiro (~300 mil tokens de cache por chamada); a imagem lida fica no contexto até o fim.
Com a folha, cada rodada de QA é UMA leitura. Ideia emprestada do contact_sheet.py do
extreme-motion-design (MIT), escrita do zero.

Escala: todas as capturas de desktop saem na mesma escala, e as de celular no dobro dela (sem
passar do tamanho real), para o texto de 390 px continuar julgável. A folha cabe no que o Read do
Claude Code entrega sem reduzir (lado longo 2000 px; a API dos modelos atuais vai a 2576 px e
3,75 MP, ~w*h/750 tokens): acima disso a imagem chega reduzida e o texto some. Modelos até o
Opus 4.6 reduzem para 1568 px; use --max-lado 1568 --max-pixels 1150000 neles.

Nome da captura = rótulo: `<viewport>-ato<N>[-<modo>...].png`, viewport `d` (desktop) ou `m`
(celular), modo `rm` (reduced-motion), `semjs` (sem JavaScript), `p0.3` (progresso da narrativa).
Ex.: m-ato1-rm.png -> "Ato I · celular 390×844 · reduced-motion". Sem o padrão, o rótulo é o nome.

Uso: folha-de-contato --saida RASCUNHO/qa/folha-1.jpg --pasta RASCUNHO/qa [--refs r1.jpg r2.jpg ...]
     folha-de-contato --saida folha.jpg m-ato1.png d-ato3-p0.3.png ...
Código: 0 = folha gravada; 2 = nada para juntar, imagem ilegível ou erro de uso.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# O Read de imagem do Claude Code entrega no máximo 2000 px no lado longo (medido em 11/10/2026: uma
# folha de 1266x2575 chegou como 983x2000); a API aceita até 2576 px e 3,75 MP nos modelos atuais.
MAX_LADO = 2000
MAX_PIXELS = 3_750_000
FATOR_CELULAR = 2.0          # celular no dobro da escala do desktop (até 100%)
LARGURA_REF = 0.6            # referência do Refero com 60% da largura de uma captura de desktop
LARGURA_DESKTOP = 1440
MARGEM = 12
VAO = 10
FAIXA_ROTULO = 26            # altura fixa do rótulo: legível mesmo com a captura bem reduzida
FAIXA_TITULO = 34
EXTENSOES = (".png", ".jpg", ".jpeg", ".webp")
ROMANOS = {"1": "I", "2": "II", "3": "III", "4": "IV", "5": "V", "0": "0"}
ORDEM_TIPO = {"celular": 0, "desktop": 1, "ref": 2}


def ordem_natural(nome: str) -> list:
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", nome.lower())]


def descrever(nome: str, largura: int, altura: int, ref: bool = False) -> tuple[str, str]:
    """(tipo, rótulo) a partir do nome do arquivo e do tamanho. PURA."""
    stem = Path(nome).stem
    if ref:
        return "ref", f"REF · {stem}"
    base = stem.lower()
    for de, para in (("reduced-motion", "rm"), ("reduced_motion", "rm"), ("sem-js", "semjs"), ("sem_js", "semjs"),
                     ("no-js", "semjs"), ("no_js", "semjs")):
        base = base.replace(de, para)
    viewport, ato, modos, resto = None, None, [], []
    for p in (x for x in re.split(r"[-_ ]+", base) if x):
        m = re.fullmatch(r"ato(\d|i{1,3}|iv|v)", p)
        if p in ("d", "desk", "desktop"):
            viewport = "desktop"
        elif p in ("m", "cel", "celular", "mobile"):
            viewport = "celular"
        elif m:
            ato = ROMANOS.get(m.group(1), m.group(1).upper())
        elif p in ("rm", "reduced", "reduzido"):
            modos.append("reduced-motion")
        elif p in ("semjs", "nojs"):
            modos.append("sem JS")
        elif re.fullmatch(r"p[01](\.\d+)?", p):
            modos.append(f"p={p[1:]}")
        elif p != "qa":
            resto.append(p)
    tipo = viewport or ("celular" if largura < 700 else "desktop")
    partes = ([f"Ato {ato}"] if ato else []) + [f"{tipo} {largura}×{altura}"] + modos + resto
    return tipo, " · ".join(partes)


def escala_do_item(tipo: str, largura: int, s: float) -> float:
    if tipo == "celular":
        return min(1.0, s * FATOR_CELULAR)
    if tipo == "ref":
        return min(1.0, s * LARGURA_DESKTOP * LARGURA_REF / max(1, largura))
    return min(1.0, s)


def empacotar(itens: list[tuple[str, int, int]], s: float, largura_folha: int):
    """Prateleiras: cada tipo começa uma linha nova, na ordem celular, desktop, ref. Devolve
    (largura usada, altura, [(x, y, w, h)] na ordem de `itens`) ou None se algo não cabe. PURA."""
    caixas: list = [None] * len(itens)
    y, usada = FAIXA_TITULO, 0
    tipo_atual, x, altura_linha = None, MARGEM, 0
    for i in sorted(range(len(itens)), key=lambda k: ORDEM_TIPO.get(itens[k][0], 9)):
        tipo, w0, h0 = itens[i]
        e = escala_do_item(tipo, w0, s)
        w, h = max(1, round(w0 * e)), max(1, round(h0 * e))
        if w > largura_folha - 2 * MARGEM:
            return None
        if tipo != tipo_atual or x + w > largura_folha - MARGEM:
            if altura_linha:
                y += altura_linha + VAO
            tipo_atual, x, altura_linha = tipo, MARGEM, 0
        caixas[i] = (x, y + FAIXA_ROTULO, w, h)
        x += w + VAO
        usada = max(usada, x - VAO + MARGEM)
        altura_linha = max(altura_linha, FAIXA_ROTULO + h)
    return usada, y + altura_linha + MARGEM, caixas


def planejar(itens: list[tuple[str, int, int]], max_lado: int = MAX_LADO, max_pixels: int = MAX_PIXELS):
    """Maior escala `s` (do desktop) com que todas cabem numa folha de lado <= max_lado e área <=
    max_pixels. Devolve (s, largura, altura, caixas). PURA."""
    if not itens:
        raise ValueError("nenhuma imagem")
    melhor = None
    for largura in range(640, max_lado + 1, 32):
        def cabe(s):
            r = empacotar(itens, s, largura)
            return r if r and r[1] <= max_lado and r[0] * r[1] <= max_pixels else None
        baixo, alto = 0.0, 1.0
        if cabe(alto):
            baixo = alto
        else:
            for _ in range(22):
                meio = (baixo + alto) / 2
                baixo, alto = (meio, alto) if cabe(meio) else (baixo, meio)
        r = cabe(baixo) if baixo > 0 else None
        if r and (melhor is None or baixo > melhor[0] + 1e-6
                  or (abs(baixo - melhor[0]) <= 1e-6 and r[0] * r[1] < melhor[1] * melhor[2])):
            melhor = (baixo, r[0], r[1], r[2])
    if melhor is None:
        raise ValueError("as imagens não cabem numa folha nem com escala mínima")
    return melhor


def tokens_estimados(largura: int, altura: int) -> int:
    return round(min(largura * altura, MAX_PIXELS) / 750)


def fonte(tamanho: int):
    from PIL import ImageFont
    for caminho in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(caminho, tamanho)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=tamanho)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def montar(capturas: list[Path], saida: Path, refs: list[Path] | None = None, titulo: str | None = None,
           max_lado: int = MAX_LADO, max_pixels: int = MAX_PIXELS) -> list[str]:
    """Grava a folha em `saida` e devolve as linhas da legenda."""
    from PIL import Image, ImageDraw
    entradas = [(p, False) for p in capturas] + [(p, True) for p in (refs or [])]
    imagens, itens, rotulos = [], [], []
    for caminho, ref in entradas:
        with Image.open(caminho) as im:
            im.load()
            imagens.append(im.convert("RGB"))
        tipo, rotulo = descrever(caminho.name, imagens[-1].width, imagens[-1].height, ref)
        itens.append((tipo, imagens[-1].width, imagens[-1].height))
        rotulos.append(rotulo)
    s, largura, altura, caixas = planejar(itens, max_lado, max_pixels)
    folha = Image.new("RGB", (largura, altura), (46, 46, 50))
    desenho = ImageDraw.Draw(folha)
    f_rotulo, f_titulo = fonte(15), fonte(18)
    cab = titulo or f"Folha de contato · {len(capturas)} captura(s)" + (f" + {len(refs)} referência(s)" if refs else "")
    escala_cel = escala_do_item("celular", 390, s)
    desenho.text((MARGEM, 8), f"{cab} · desktop a {s:.0%}, celular a {escala_cel:.0%}", fill=(240, 240, 240), font=f_titulo)
    legenda = []
    for n, (im, (x, y, w, h), rotulo, (tipo, w0, _)) in enumerate(zip(imagens, caixas, rotulos, itens), 1):
        folha.paste(im.resize((w, h), Image.LANCZOS) if (w, h) != im.size else im, (x, y))
        desenho.rectangle((x - 1, y - 1, x + w, y + h), outline=(120, 120, 128))
        texto = f"#{n} {rotulo}"
        caixa = desenho.textbbox((0, 0), texto, font=f_rotulo)
        while caixa[2] > w and len(texto) > 6:  # rótulo maior que a captura: corta no fim
            texto = texto[:-2] + "…"
            caixa = desenho.textbbox((0, 0), texto, font=f_rotulo)
        desenho.text((x, y - FAIXA_ROTULO + 5), texto, fill=(255, 214, 102) if tipo == "ref" else (255, 255, 255), font=f_rotulo)
        legenda.append(f"#{n} {rotulo} ({escala_do_item(tipo, w0, s):.0%}) em x={x} y={y}")
    saida.parent.mkdir(parents=True, exist_ok=True)
    if saida.suffix.lower() in (".jpg", ".jpeg"):
        folha.save(saida, "JPEG", quality=88, optimize=True)
    else:
        folha.save(saida)
    legenda.append(f"Folha: {saida} ({largura}x{altura} px, ~{tokens_estimados(largura, altura)} tokens). "
                   "Leia só esta imagem nesta rodada.")
    if s < 0.3:
        legenda.append(f"Aviso: folha densa (desktop a {s:.0%}). Para julgar texto, tire menos capturas por rodada "
                       "(as que respondem às perguntas da crítica), não leia as capturas uma a uma.")
    return legenda


def capturas_da_pasta(pasta: Path) -> list[Path]:
    """Imagens da pasta, sem as folhas anteriores, em ordem natural."""
    return sorted((p for p in pasta.iterdir() if p.is_file() and p.suffix.lower() in EXTENSOES
                   and not p.name.lower().startswith(("folha", "."))), key=lambda p: ordem_natural(p.name))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("capturas", nargs="*", type=Path)
    ap.add_argument("--pasta", type=Path, help="junta todas as imagens da pasta (menos folha*)")
    ap.add_argument("--saida", type=Path, required=True, help="arquivo da folha (.jpg recomendado)")
    ap.add_argument("--refs", nargs="*", type=Path, default=[], help="referências (Refero) numa linha à parte")
    ap.add_argument("--titulo")
    ap.add_argument("--max-lado", type=int, default=MAX_LADO)
    ap.add_argument("--max-pixels", type=int, default=MAX_PIXELS)
    a = ap.parse_args(argv)
    capturas = list(a.capturas)
    if a.pasta:
        if not a.pasta.is_dir():
            print(f"Pasta não existe: {a.pasta}", file=sys.stderr)
            return 2
        capturas += capturas_da_pasta(a.pasta)
    if not capturas:
        print("Nenhuma captura para juntar (passe arquivos ou --pasta).", file=sys.stderr)
        return 2
    try:
        legenda = montar(capturas, a.saida, a.refs, a.titulo, a.max_lado, a.max_pixels)
    except (OSError, ValueError) as e:
        print(f"Folha não gerada: {e}", file=sys.stderr)
        return 2
    print("\n".join(legenda))
    return 0


if __name__ == "__main__":
    sys.exit(main())
