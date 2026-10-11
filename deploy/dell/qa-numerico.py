#!/usr/bin/env python3
"""Gate numérico de QA do gerador de sites (Dell, 11/10/2026): o Claude do lead roda antes do deploy.

Confere o que dá para medir sem olhar: o orçamento de bytes das "Regras do arquivo" do
`auto-site-CLAUDE.md` (fim do Ato I <= 200 KB, arquivo <= 450 KB, CSS <= 35 KB e JS <= 25 KB sem
base64, fontes <= 80 KB em no máximo 2 famílias, foto do hero <= 80 KB, cada foto de conteúdo <=
60 KB e no máximo 5), `<img>` sem width/height (a página pula) ou sem alt, `prefers-reduced-motion`
no CSS (e no JS que anima), contraste AA dos pares cor/fundo declarados no CSS (tokens resolvidos)
e o Ato I visível nas capturas sem JS e com reduced-motion (variância de pixels: tela lisa = nada
apareceu). Antes cada lead escrevia o próprio script de bytes no rascunho, e o resto ficava para
os olhos, isto é, para mais capturas lidas. Ideia do qa.py do extreme-motion-design (MIT), escrita
do zero com os limites que já eram nossos.

O Ato I é a primeira `<section>` dentro de `<main>` (sem `<main>`, a primeira `<section>`).

Uso: qa-numerico <slug>/index.html --capturas RASCUNHO/qa
     qa-numerico index.html --sem-js m-ato1-semjs.png --reduzido m-ato1-rm.png
Com --capturas, o gate tira ele mesmo, do index.html de agora, as duas capturas 390x844 do Ato I
(m-ato1-semjs.png de uma cópia sem <script>, porque `--blink-settings=scriptEnabled=false` não grava
captura no Chrome do Dell; m-ato1-rm.png com --force-prefers-reduced-motion), com perfil temporário
próprio. Se o Chrome falhar, usa as da pasta; sem nenhuma, avisa (AVISO não reprova).
Código: 0 = passou; 1 = falhou (cada FALHA diz o que cortar); 2 = erro de uso (arquivo ausente
ou ilegível).
"""
from __future__ import annotations

import argparse
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import NamedTuple

KB = 1000  # as "Regras do arquivo" falam em byte 200 000 = 200 KB
LIMITES = {"ato1": 200 * KB, "total": 450 * KB, "css": 35 * KB, "js": 25 * KB, "fontes": 80 * KB,
           "familias": 2, "hero": 80 * KB, "foto": 60 * KB, "fotos": 5}
AA_NORMAL, AA_GRANDE = 4.5, 3.0
# Captura em que o Ato I apareceu tem textura: título, foto, botão. Tela lisa (só o fundo) tem
# desvio ~0 e quase nenhum pixel longe da cor dominante. Calibrado em 11/10/2026 com demos reais.
DESVIO_MIN, PARCELA_MIN = 10.0, 0.03

BASE64 = re.compile(r"data:[\w.+/-]+(?:;[\w.+=-]+)*;base64,[A-Za-z0-9+/=\s]+", re.I)
RASTER = re.compile(r"data:image/(?:webp|jpe?g|png|avif|gif)", re.I)


class Item(NamedTuple):
    estado: str   # OK, FALHA, AVISO
    nome: str
    texto: str


def kb(n: int) -> str:
    return f"{n / KB:.1f} KB"  # uma casa: 200.4 KB não pode aparecer como "200 KB (teto 200 KB)"


def teto(n: int) -> str:
    return f"{n / KB:g} KB"


def nb(s: str) -> int:
    return len(s.encode("utf-8"))


# ---------------------------------------------------------------- HTML

def esqueleto(html: str) -> str:
    """O HTML com comentários, <script> e <style> trocados por espaços (mesmo comprimento): as
    posições continuam valendo e nada dentro deles conta como tag."""
    def branco(m):
        return m.group(1) + re.sub(r"[^\n]", " ", m.group(2)) + m.group(3)
    s = re.sub(r"(<!--)(.*?)(-->)", branco, html, flags=re.S)
    return re.sub(r"(<(script|style)\b[^>]*>)(.*?)(</\2\s*>)",
                  lambda m: m.group(1) + re.sub(r"[^\n]", " ", m.group(3)) + m.group(4), s, flags=re.S | re.I)


def fim_do_ato1(html: str, sk: str | None = None) -> tuple[int, int] | None:
    """(início, fim) em caracteres da primeira <section> dentro de <main>, com aninhamento."""
    sk = sk if sk is not None else esqueleto(html)
    m = re.search(r"<main\b", sk, re.I)
    inicio = re.search(r"<section\b", sk[m.end():] if m else sk, re.I)
    if not inicio:
        return None
    pos = (m.end() if m else 0) + inicio.start()
    prof = 0
    for t in re.finditer(r"<(/?)section\b[^>]*>", sk[pos:], re.I):
        prof += -1 if t.group(1) else 1
        if prof == 0:
            return pos, pos + t.end()
    return None


def atributos(tag: str) -> dict:
    """Atributos de uma tag; os sem valor (`alt`, `hidden`) valem "". Texto entre aspas nunca vira
    atributo (um alt "foto com width" não pode contar como width)."""
    par = re.compile(r"([\w:-]+)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)")
    com_valor = {k.lower(): (v[1:-1] if v[:1] in "\"'" else v) for k, v in par.findall(tag)}
    resto = re.sub(r"^<\w+", "", par.sub(" ", tag))
    soltos = {k.lower(): "" for k in re.findall(r"([\w:-]+)", resto)}
    return {**soltos, **com_valor}


def blocos(html: str, nome: str) -> list[tuple[dict, str]]:
    return [(atributos(m.group(1)), m.group(2))
            for m in re.finditer(rf"<{nome}\b([^>]*)>(.*?)</{nome}\s*>", html, re.S | re.I)]


def sem_base64(texto: str) -> str:
    return BASE64.sub("data:…", texto)


# ---------------------------------------------------------------- CSS e cor

NOMEADAS = {"white": (255, 255, 255, 1.0), "black": (0, 0, 0, 1.0), "transparent": (0, 0, 0, 0.0)}


def cor(valor: str):
    """(r, g, b, a) de #hex, rgb()/rgba(), hsl()/hsla() e white/black; None para o resto. PURA."""
    v = valor.strip().lower()
    if v in NOMEADAS:
        return NOMEADAS[v]
    m = re.fullmatch(r"#([0-9a-f]{3,8})", v)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        if len(h) not in (6, 8):
            return None
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16) / 255 if len(h) == 8 else 1.0)
    m = re.fullmatch(r"(rgba?|hsla?)\((.*)\)", v)
    if not m:
        return None
    partes = [p for p in re.split(r"[\s,/]+", m.group(2).strip()) if p]
    if len(partes) not in (3, 4):
        return None
    try:
        alfa = 1.0
        if len(partes) == 4:
            alfa = float(partes[3][:-1]) / 100 if partes[3].endswith("%") else float(partes[3])
        if m.group(1).startswith("rgb"):
            rgb = [float(p[:-1]) * 2.55 if p.endswith("%") else float(p) for p in partes[:3]]
        else:
            h = float(partes[0].rstrip("deg")) / 360
            s, l = float(partes[1].rstrip("%")) / 100, float(partes[2].rstrip("%")) / 100
            import colorsys
            rgb = [c * 255 for c in colorsys.hls_to_rgb(h, l, s)]
    except ValueError:
        return None
    return (*(max(0, min(255, round(c))) for c in rgb), max(0.0, min(1.0, alfa)))


def luminancia(c) -> float:
    def canal(x):
        x /= 255
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return 0.2126 * canal(c[0]) + 0.7152 * canal(c[1]) + 0.0722 * canal(c[2])


def contraste(a, b) -> float:
    la, lb = sorted((luminancia(a), luminancia(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def sobre(frente, fundo):
    a = frente[3]
    return tuple(round(frente[i] * a + fundo[i] * (1 - a)) for i in range(3)) + (1.0,)


def regras_css(css: str, contexto: tuple = ()) -> list[tuple[str, dict, tuple]]:
    """(seletor, declarações, @-contexto) de um CSS sem comentários, com aninhamento simples. PURA."""
    saida, i, n = [], 0, len(css)
    while i < n:
        abre = css.find("{", i)
        if abre < 0:
            break
        prelude = css[i:abre].strip()
        prelude = prelude.rsplit(";", 1)[-1].strip()  # @import/@charset soltos antes do bloco
        prof, j = 1, abre + 1
        while j < n and prof:
            prof += {"{": 1, "}": -1}.get(css[j], 0)
            j += 1
        corpo = css[abre + 1:j - 1]
        if prelude.startswith("@"):
            if re.match(r"@(media|supports|layer|container|document)\b", prelude, re.I):
                saida += regras_css(corpo, contexto + (prelude,))
        else:
            decl = {}
            planas = re.sub(r"\{[^{}]*\}", "", corpo)  # aninhadas não entram nas declarações do pai
            for parte in planas.split(";"):
                if ":" in parte:
                    k, v = parte.split(":", 1)
                    decl[k.strip().lower()] = v.strip()
            saida.append((prelude, decl, contexto))
            for sub in re.finditer(r"([^{};]+)\{([^{}]*)\}", corpo):
                sel = sub.group(1).strip()
                sel = sel.replace("&", prelude) if "&" in sel else f"{prelude} {sel}"
                saida += [(s, d, contexto) for s, d, _ in regras_css(f"{sel}{{{sub.group(2)}}}")]
        i = j
    return saida


def resolver(valor: str, locais: dict, raiz: dict, prof: int = 0) -> str:
    if prof > 8:
        return valor
    def troca(m):
        nome, reserva = m.group(1), m.group(2)
        v = locais.get(nome, raiz.get(nome))
        if v is None:
            return reserva.strip() if reserva else m.group(0)
        return resolver(v, locais, raiz, prof + 1)
    return re.sub(r"var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)", troca, valor)


def cor_de_fundo(decl: dict, locais: dict, raiz: dict):
    for k in ("background-color", "background"):
        if k in decl:
            v = resolver(decl[k], locais, raiz).replace("!important", "").strip()
            if re.search(r"gradient|url\(|image-set", v, re.I):
                return None
            c = cor(v.split()[0]) if v else None
            if c is None and len(v.split()) > 1:
                c = next((cor(p) for p in re.findall(r"#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)", v) if cor(p)), None)
            return c
    return None


def texto_grande(decl: dict, locais: dict, raiz: dict) -> bool:
    tam = resolver(decl.get("font-size", ""), locais, raiz)
    m = re.search(r"([\d.]+)(px|rem|em)", tam)  # em clamp()/min(), o primeiro valor é o mínimo
    if not m:
        return False
    px = float(m.group(1)) * (1 if m.group(2) == "px" else 16)
    peso = resolver(decl.get("font-weight", ""), locais, raiz)
    negrito = peso.strip() in ("bold", "bolder") or (peso.strip().isdigit() and int(peso) >= 700)
    return px >= 24 or (negrito and px >= 18.66)


def pares_de_contraste(css: str) -> tuple[list[tuple[str, float, float, str, str]], int]:
    """Pares cor/fundo do CSS: ([(seletor, razão, mínimo, cor, fundo)], quantos não deu para medir).
    Mede o tema padrão: regras dentro de prefers-color-scheme ficam de fora. PURA."""
    regras = [r for r in regras_css(re.sub(r"/\*.*?\*/", "", sem_base64(css), flags=re.S))
              if not any("prefers-color-scheme" in c for c in r[2])]
    raiz = {}
    for sel, decl, _ in regras:
        if re.fullmatch(r"(:root|html)(\s*,\s*(:root|html))*", sel.strip(), re.I):
            raiz.update({k: v for k, v in decl.items() if k.startswith("--")})
    pagina_fundo = pagina_cor = None
    for sel, decl, _ in regras:
        if re.fullmatch(r"(:root|html|body)(\s*,\s*(:root|html|body))*", sel.strip(), re.I):
            locais = {k: v for k, v in decl.items() if k.startswith("--")}
            pagina_fundo = cor_de_fundo(decl, locais, raiz) or pagina_fundo
            if "color" in decl:
                pagina_cor = cor(resolver(decl["color"], locais, raiz).replace("!important", "").strip()) or pagina_cor
    pares, sem_medida = [], 0
    if pagina_fundo and pagina_cor and pagina_fundo[3] == 1:
        frente = sobre(pagina_cor, pagina_fundo)
        pares.append(("body", contraste(frente, pagina_fundo), AA_NORMAL, pagina_cor, pagina_fundo))
    for sel, decl, _ in regras:
        if "color" not in decl or not ({"background", "background-color"} & decl.keys()):
            continue
        if re.fullmatch(r"(:root|html|body)(\s*,\s*(:root|html|body))*", sel.strip(), re.I):
            continue  # já medido como o par da página
        if re.search(r":disabled|\[disabled|aria-disabled|::selection|:-webkit-autofill", sel, re.I):
            continue
        locais = {k: v for k, v in decl.items() if k.startswith("--")}
        frente = cor(resolver(decl["color"], locais, raiz).replace("!important", "").strip())
        fundo = cor_de_fundo(decl, locais, raiz)
        if frente is None or fundo is None:
            sem_medida += 1
            continue
        if fundo[3] < 1:
            # Fundo translúcido cobre o que estiver atrás, que o CSS não diz (11/10/2026: um véu de
            # 8% de branco numa barra escura foi medido sobre o papel claro da página: falso 1:1).
            sem_medida += 1
            continue
        if frente[3] == 0:
            continue
        frente = sobre(frente, fundo)
        minimo = AA_GRANDE if texto_grande(decl, locais, raiz) else AA_NORMAL
        pares.append((sel, contraste(frente, fundo), minimo, frente, fundo))
    return pares, sem_medida


def hexa(c) -> str:
    return "#%02x%02x%02x" % tuple(c[:3])


def familias_de_fonte(css: str) -> tuple[dict, int]:
    """{família: bytes em base64} das @font-face, e quantas fontes vêm de fora (url sem data:)."""
    familias, externas = {}, 0
    for corpo in re.findall(r"@font-face\s*\{([^}]*)\}", css, re.I):
        m = re.search(r"font-family\s*:\s*([^;]+)", corpo, re.I)
        nome = (m.group(1).strip().strip("'\"") if m else "?").lower()
        familias[nome] = familias.get(nome, 0) + sum(nb(x) for x in BASE64.findall(corpo))
        externas += len(re.findall(r"url\(\s*['\"]?(?!data:)", corpo, re.I))
    return familias, externas


# ---------------------------------------------------------------- capturas

def visibilidade(histograma: list[int]) -> tuple[float, float]:
    """(desvio-padrão da luminância, parcela de pixels a mais de 24 níveis da cor dominante),
    de um histograma de 256 níveis. PURA."""
    total = sum(histograma) or 1
    media = sum(i * c for i, c in enumerate(histograma)) / total
    desvio = math.sqrt(sum(c * (i - media) ** 2 for i, c in enumerate(histograma)) / total)
    dominante = max(range(256), key=lambda i: sum(histograma[max(0, i - 2):i + 3]))
    longe = sum(c for i, c in enumerate(histograma) if abs(i - dominante) > 24)
    return desvio, longe / total


def histograma_da_captura(caminho: Path) -> list[int]:
    from PIL import Image
    with Image.open(caminho) as im:
        g = im.convert("L")
        g.thumbnail((480, 1040))
        return g.histogram()


def achar_capturas(pasta: Path) -> dict:
    """As capturas do Ato I sem JS e com reduced-motion já na pasta, pelo nome (`semjs`, `rm`).
    Captura de outro Ato (m-ato3-rm.png) não serve; sem Ato no nome, vale como do topo."""
    achadas = {}
    for p in sorted(pasta.iterdir()) if pasta.is_dir() else []:
        nome = p.name.lower().replace("_", "-")
        if p.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp") or nome.startswith("folha"):
            continue
        sem_hifen = nome.replace("-", "")
        if "ato" in sem_hifen and not re.search(r"ato(1|i)(?![\dvi])", sem_hifen):
            continue
        if re.search(r"semjs|nojs", sem_hifen):
            achadas.setdefault("sem_js", p)
        elif re.search(r"(^|-)rm(-|\.)|reduced", nome):
            achadas.setdefault("reduzido", p)
    return achadas


CHROMES = tuple(c for c in os.environ.get("QA_CHROME", "google-chrome:chromium:/snap/bin/chromium").split(":") if c)
NOME_CAPTURA = {"sem_js": "m-ato1-semjs.png", "reduzido": "m-ato1-rm.png"}


def html_sem_js(html: str) -> str:
    """A página como quem está sem JavaScript a vê: sem <script> e com o <noscript> aberto. O
    `--blink-settings=scriptEnabled=false` não grava captura no Chrome do Dell (11/10/2026: cada
    lead descobria isso sozinho e fazia esta cópia à mão)."""
    s = re.sub(r"<script\b[^>]*>.*?</script\s*>", "", html, flags=re.S | re.I)
    return re.sub(r"</?noscript\b[^>]*>", "", s, flags=re.I)


def capturar(url: str, saida: Path, reduzido: bool = False) -> str | None:
    """Captura 390x844 no Chrome headless com perfil temporário próprio (apagado no fim: sem ele o
    Chrome deixa um scoped_dir* em ~/.cache a cada captura). None = gravou; texto = o que deu errado."""
    exe = next((c for c in CHROMES if shutil.which(c)), None)
    if not exe:
        return "Chrome não encontrado"
    perfil = tempfile.mkdtemp(prefix="qa-chrome-")
    nova = saida.with_name(f".nova-{saida.name}")  # a captura antiga só sai quando a nova existe
    nova.unlink(missing_ok=True)
    cmd = [exe, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={perfil}",
           "--window-size=390,844", "--virtual-time-budget=8000"] + (["--force-prefers-reduced-motion"] if reduzido else []) \
        + [f"--screenshot={nova}", url]
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                start_new_session=True)
        try:
            proc.wait(timeout=90)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            return "o Chrome passou de 90 s"
    except OSError as e:
        return str(e)
    finally:
        shutil.rmtree(perfil, ignore_errors=True)
    if not (nova.is_file() and nova.stat().st_size):
        nova.unlink(missing_ok=True)
        return "o Chrome não gravou a captura"
    nova.replace(saida)
    return None


def capturas_do_gate(index: Path, html: str, pasta: Path) -> dict:
    """Tira de novo, do index.html de AGORA, as duas capturas do Ato I (sem JS e com reduced-motion):
    captura de uma rodada anterior não prova a página que vai ao ar. Se o Chrome falhar, usa a que
    estiver na pasta; sem nenhuma, `erro_<chave>` diz por quê (vira AVISO, não FALHA: não é o site)."""
    pasta.mkdir(parents=True, exist_ok=True)
    copia = pasta / "_sem-js.html"
    copia.write_text(html_sem_js(html), encoding="utf-8")
    capturas, antigas = {}, achar_capturas(pasta)
    for chave, url, reduzido in (("sem_js", copia.resolve().as_uri(), False),
                                 ("reduzido", index.resolve().as_uri(), True)):
        destino = pasta / NOME_CAPTURA[chave]
        erro = capturar(url, destino, reduzido)
        if erro is None:
            capturas[chave] = destino
        elif antigas.get(chave) and antigas[chave].is_file():
            capturas[chave] = antigas[chave]
        else:
            capturas[f"erro_{chave}"] = erro
    return capturas


# ---------------------------------------------------------------- avaliação

def avaliar(html: str, capturas: dict | None = None, histogramas: dict | None = None,
            caminho_index: str = "index.html") -> list[Item]:
    """Todas as conferências. `capturas` = {"sem_js": Path, "reduzido": Path} (None = não medir);
    `histogramas` substitui a leitura das imagens (testes). PURA quando `histogramas` vem dado."""
    r: list[Item] = []
    total = nb(html)
    sk = esqueleto(html)
    grandes = []  # (bytes, início, descrição): o que mais pesa, para dizer o que cortar
    for m in BASE64.finditer(html):
        tipo = m.group(0)[5:m.group(0).find(";")]
        grandes.append((nb(m.group(0)), m.start(), tipo))
    grandes.sort(reverse=True)

    def cortes(ate: int | None = None, n: int = 3) -> str:
        itens = [g for g in grandes if ate is None or g[1] < ate][:n]
        if not itens:
            return "nenhum base64 grande; corte CSS/JS ou texto."
        return "; ".join(f"{t} em base64 de {kb(b)} (byte {nb(html[:p]):,})".replace(",", " ") for b, p, t in itens)

    ato = fim_do_ato1(html, sk)
    if ato is None:
        r.append(Item("FALHA", "Ato I", "não achei o Ato I: o gate mede até o fim da primeira <section> dentro de <main>. "
                      "Estruture o Ato I como essa <section>."))
    else:
        ate = nb(html[:ato[1]])
        ok = ate <= LIMITES["ato1"]
        r.append(Item("OK" if ok else "FALHA", "Bytes até o fim do Ato I",
                      f"{kb(ate)} (teto {teto(LIMITES['ato1'])})" + ("" if ok else f". Corte antes do fim do Ato I: {cortes(ato[1])}")))
    ok = total <= LIMITES["total"]
    r.append(Item("OK" if ok else "FALHA", "Arquivo inteiro", f"{kb(total)} (teto {teto(LIMITES['total'])})"
                  + ("" if ok else f". Os maiores: {cortes()}")))

    estilos = "\n".join(c for _, c in blocos(html, "style"))
    css = nb(sem_base64(estilos))
    ok = css <= LIMITES["css"]
    r.append(Item("OK" if ok else "FALHA", "CSS sem base64", f"{kb(css)} (teto {teto(LIMITES['css'])})"
                  + ("" if ok else ". Tire regras mortas e repetidas e efeitos sem linha no CONCEITO.md (sem minificar).")))
    scripts = "\n".join(c for a, c in blocos(html, "script")
                        if not re.search(r"json|importmap|template", a.get("type", ""), re.I))
    js = nb(sem_base64(scripts))
    ok = js <= LIMITES["js"]
    r.append(Item("OK" if ok else "FALHA", "JS sem base64", f"{kb(js)} (teto {teto(LIMITES['js'])})"
                  + ("" if ok else ". Corte efeitos sem linha no CONCEITO.md e código duplicado (sem minificar).")))

    familias, externas = familias_de_fonte(estilos)
    fontes = sum(familias.values())
    problemas = []
    if len(familias) > LIMITES["familias"]:
        problemas.append(f"{len(familias)} famílias (máximo {LIMITES['familias']}): {', '.join(sorted(familias))}")
    if fontes > LIMITES["fontes"]:
        maior = sorted(familias.items(), key=lambda x: -x[1])[:2]
        problemas.append(f"{kb(fontes)} em base64 (teto {teto(LIMITES['fontes'])}); subset menor com pyftsubset: "
                         + ", ".join(f"{f} {kb(b)}" for f, b in maior))
    if externas:
        problemas.append(f"{externas} fonte(s) fora do arquivo (url sem data:): embuta")
    r.append(Item("FALHA" if problemas else "OK", "Fontes",
                  "; ".join(problemas) if problemas else f"{len(familias)} família(s), {kb(fontes)} em base64"))

    sem_dim, sem_alt, alt_vazio, fotos = [], [], 0, []
    for m in re.finditer(r"<img\b[^>]*>", sk, re.I):
        tag = html[m.start():m.end()]
        a = atributos(tag)
        nome = (a.get("alt") or "")[:40] or Path((a.get("src") or "?")[:60]).name[:40]
        if "src" in a and RASTER.match(a["src"]):
            fotos.append((nb(a["src"]), m.start(), nome))
        if not a.get("width") or not a.get("height"):
            sem_dim.append(nome or f"byte {m.start()}")
        if "alt" not in a:
            sem_alt.append(nome or f"byte {m.start()}")
        elif not a["alt"].strip():
            alt_vazio += 1
    r.append(Item("FALHA" if sem_dim else "OK", "Imagens com width e height",
                  f"{len(sem_dim)} sem (a página pula ao carregar): {', '.join(sem_dim[:5])}" if sem_dim else "todas"))
    r.append(Item("FALHA" if sem_alt else ("AVISO" if alt_vazio else "OK"), "Alt das imagens",
                  f"{len(sem_alt)} sem alt: {', '.join(sem_alt[:5])}" if sem_alt else
                  (f"{alt_vazio} com alt vazio: só se for decoração; foto real diz o que se vê" if alt_vazio else "todas com alt")))

    for m in re.finditer(r"url\(\s*['\"]?(data:image/(?:webp|jpe?g|png|avif|gif)[^'\")]*)", estilos, re.I):
        fotos.append((nb(m.group(1)), -1, "fundo em CSS"))
    hero = None
    if ato:
        no_ato = [f for f in fotos if ato[0] <= f[1] < ato[1]]
        hero = max(no_ato) if no_ato else None
    problemas = []
    if hero and hero[0] > LIMITES["hero"]:
        problemas.append(f"foto do hero ({hero[2]}) {kb(hero[0])} (teto {teto(LIMITES['hero'])}): reduza para ~800 px, WebP ~72")
    conteudo = [f for f in fotos if f is not hero]
    for b, _, nome in conteudo:
        if b > LIMITES["foto"]:
            problemas.append(f"foto {nome} {kb(b)} (teto {teto(LIMITES['foto'])})")
    if len(conteudo) > LIMITES["fotos"]:
        problemas.append(f"{len(conteudo)} fotos de conteúdo (máximo {LIMITES['fotos']}): fique com as que provam algo")
    r.append(Item("FALHA" if problemas else "OK", "Fotos embutidas",
                  "; ".join(problemas) if problemas else
                  f"{len(fotos)} foto(s)" + (f", hero {kb(hero[0])}" if hero else "")))

    tem_css = "prefers-reduced-motion" in estilos
    anima = re.search(r"requestAnimationFrame|\.animate\(", scripts)
    problemas = []
    if not tem_css:
        problemas.append("nenhum @media (prefers-reduced-motion) no CSS")
    if anima and "prefers-reduced-motion" not in scripts:
        problemas.append("o JS anima (requestAnimationFrame) mas não lê matchMedia('(prefers-reduced-motion: reduce)')")
    r.append(Item("FALHA" if problemas else "OK", "prefers-reduced-motion", "; ".join(problemas) if problemas else "no CSS"
                  + (" e no JS" if anima else "")))

    pares, sem_medida = pares_de_contraste(estilos)
    ruins = sorted((p for p in pares if p[1] < p[2]), key=lambda p: p[1])
    r.append(Item("FALHA" if ruins else "OK", "Contraste AA (cor/fundo do CSS)",
                  ("; ".join(f"{sel[:60]} {hexa(fr)} sobre {hexa(fu)} = {raz:.2f}:1 (mínimo {mi:g}:1)"
                             for sel, raz, mi, fr, fu in ruins[:5])
                   + ". Escureça o texto ou o fundo (WhatsApp: verde escuro com texto branco, ou texto escuro no verde).")
                  if ruins else f"{len(pares)} par(es) conferido(s)"
                  + (f", {sem_medida} sem medir (gradiente, imagem ou cor não resolvida)" if sem_medida else "")))

    if capturas is not None:
        for chave, nome, como in (("sem_js", "Ato I visível sem JS", "de uma cópia sem <script>"),
                                  ("reduzido", "Ato I visível com reduced-motion", "com --force-prefers-reduced-motion")):
            caminho = capturas.get(chave)
            if (histogramas or {}).get(chave) is None and caminho is None:
                if capturas.get(f"erro_{chave}"):
                    r.append(Item("AVISO", nome, f"o gate não conseguiu tirar a captura ({capturas[f'erro_{chave}']}); "
                                  "confira à mão antes do deploy"))
                else:
                    r.append(Item("FALHA", nome, f"falta a captura 390x844 {como} ({NOME_CAPTURA[chave]} na pasta das capturas)"))
                continue
            try:
                hist = (histogramas or {}).get(chave) or histograma_da_captura(Path(caminho))
            except (OSError, ImportError) as e:
                r.append(Item("FALHA", nome, f"captura ilegível ({caminho}): {e}"))
                continue
            desvio, parcela = visibilidade(hist)
            ok = desvio >= DESVIO_MIN and parcela >= PARCELA_MIN
            r.append(Item("OK" if ok else "FALHA", nome,
                          f"desvio {desvio:.0f}, {parcela:.0%} de pixels com conteúdo"
                          + ("" if ok else f" (tela quase lisa: mínimo {DESVIO_MIN:g} e {PARCELA_MIN:.0%}). O título e a foto do "
                             "Ato I não podem começar com opacity: 0 nem esperar JS; estado escondido só sob html.js.")))
    return r


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("index", type=Path)
    ap.add_argument("--capturas", type=Path,
                    help="pasta das capturas: o gate tira nela, do index.html de agora, m-ato1-semjs.png e m-ato1-rm.png")
    ap.add_argument("--nao-capturar", action="store_true", help="não chama o Chrome: usa as capturas que já estão na pasta")
    ap.add_argument("--sem-js", type=Path, help="captura sem JS já tirada (dispensa a do gate)")
    ap.add_argument("--reduzido", type=Path, help="captura com reduced-motion já tirada (dispensa a do gate)")
    a = ap.parse_args(argv)
    try:
        html = a.index.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        print(f"Não consegui ler {a.index}: {e}", file=sys.stderr)
        return 2
    if "<html" not in html.lower():
        print(f"{a.index} não parece HTML.", file=sys.stderr)
        return 2
    capturas = None
    if a.capturas or a.sem_js or a.reduzido:
        capturas = {}
        if a.capturas:
            try:
                capturas = achar_capturas(a.capturas) if a.nao_capturar else capturas_do_gate(a.index, html, a.capturas)
            except OSError as e:  # pasta sem escrita: segue com o que der, sem quebrar o gate
                capturas = {"erro_sem_js": str(e), "erro_reduzido": str(e)}
        capturas.update({k: v for k, v in (("sem_js", a.sem_js), ("reduzido", a.reduzido)) if v})
    itens = avaliar(html, capturas, caminho_index=str(a.index))
    print(f"QA numérico de {a.index}")
    for i in itens:
        print(f"{i.estado:<6} {i.nome}: {i.texto}")
    falhas = sum(1 for i in itens if i.estado == "FALHA")
    if capturas is None:
        print("AVISO  Capturas: não medidas (passe --capturas com a pasta das capturas).")
    print(f"Resultado: {'passou' if not falhas else f'{falhas} falha(s); corrija e rode de novo antes do deploy'}.")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
