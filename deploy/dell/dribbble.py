#!/usr/bin/env python3
"""Referência do Dribbble para cada site da esteira (Dell, 14/10/2026).

Pedido do Rômulo: "toda vez que for fazer um site, vai entrar no dribbble e encontrar um design
para seguir". Substitui a biblioteca fixa de 13/10 (REFERENCIAS.md, só primeiras telas de celular
de sites de bairro) e o Refero (acervo de SaaS). O Dribbble mostra composição de desktop de
verdade, que é o que faltava: os demos estavam "focados demais em mobile".

O Dribbble recusa curl (202 sem corpo: desafio anti-robô), mas o Chrome headless passa, sem login.
Este script abre a busca e o shot no `google-chrome --dump-dom`, extrai as imagens públicas do
CDN (`cdn.dribbble.com/userupload/...`) e baixa para a pasta do rascunho. Quem OLHA é o Claude do
lead: lê a folha da busca, escolhe UM shot e estuda os quadros dele antes do `/design`.

Só leitura da rede pública; escreve apenas na pasta `--saida`.

Uso: dribbble.py buscar --saida DIR --consulta "law firm website" [--consulta "lawyer landing page"] [--max 24]
       → DIR/NN-<id>.<ext> (miniaturas) e DIR/indice.txt (arquivo, id, título, url, consulta)
     dribbble.py shot <id ou url> --saida DIR [--quadros 6]
       → DIR/shot-NN.<ext> (imagens do shot) e, se for vídeo e houver ffmpeg, DIR/quadro-NN.jpg
     dribbble.py --testar     (funções puras, sem rede)
Depois: folha-de-contato --saida DIR/folha.jpg --pasta DIR, e Read só na folha.
"""
from __future__ import annotations

import argparse
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

# CHROME_BIN: outro Chrome (teste fora do Dell); no Dell vale a lista.
CHROME = tuple(filter(None, (os.environ.get("CHROME_BIN"),))) + ("google-chrome", "chromium", "/snap/bin/chromium")
# Com o user agent padrão do headless ("HeadlessChrome") a página pode vir vazia; com o de um
# Chrome comum ela vem inteira (conferido em 14/10/2026).
NAVEGADOR = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
             "Chrome/141.0.0.0 Safari/537.36")
BASE = "https://dribbble.com"
CDN = re.compile(r"https://cdn\.dribbble\.com/userupload/\d+/file/[A-Za-z0-9_.-]+?\.(?:png|jpe?g|webp|gif|mp4)")
ITEM = re.compile(r'id="screenshot-(\d+)"')


def url_da_busca(consulta: str) -> str:
    """A busca por popularidade, como no navegador: /search/shots/popular?q=<consulta>."""
    return f"{BASE}/search/shots/popular?q=" + urllib.parse.quote(consulta.strip())


def url_do_shot(id_ou_url: str) -> str:
    m = re.search(r"(\d{5,})", id_ou_url)
    if not m:
        raise ValueError(f"não achei o número do shot em {id_ou_url!r}")
    return f"{BASE}/shots/{m.group(1)}"


def extrair_busca(dom: str) -> list[dict]:
    """PURO: os shots da página de busca, na ordem: {'id', 'titulo', 'url', 'imagem'}. A imagem é a
    miniatura do CDN em 640 px (o padrão vem com ?resize=420x)."""
    marcas = list(ITEM.finditer(dom))
    saida, vistos = [], set()
    for i, m in enumerate(marcas):
        sid = m.group(1)
        if sid in vistos:
            continue
        trecho = dom[m.end(): marcas[i + 1].start() if i + 1 < len(marcas) else len(dom)]
        tag = re.search(r"<img\b[^>]*>", trecho)
        src = re.search(r'\ssrc="([^"]+)"', tag.group(0)) if tag else None
        if not src:
            continue
        alt = re.search(r'\salt="([^"]*)"', tag.group(0))
        alt, src = (alt.group(1) if alt else ""), html.unescape(src.group(1))
        if "cdn.dribbble.com/userupload/" not in src:
            continue
        # Anúncio (Framer, "Advertise") vem sem o link /shots/<id>-<título>: fica de fora.
        link = re.search(r'href="(/shots/' + sid + r'-[^"]*)"', trecho)
        if not link:
            continue
        vistos.add(sid)
        saida.append({"id": sid, "titulo": html.unescape(alt).strip(), "url": BASE + link.group(1),
                      "imagem": src.split("?")[0] + "?resize=640x&vertical=center"})
    return saida


def extrair_shot(dom: str) -> dict:
    """PURO: as mídias de um shot: {'imagens': [...], 'videos': [...]}, únicas e na ordem. A página
    também traz o avatar e os shots de "More by" e "You might also like": é do shot só o upload
    (`userupload/<n>/`) que aparece antes do primeiro "more-by"; esse mesmo upload pode voltar
    depois, no JSON da galeria, e aí vale (é lá que está o vídeo original)."""
    marcas = [i for i in (dom.find("more-by"), dom.find("More by")) if i >= 0]
    corte = min(marcas) if marcas else len(dom)
    proprios = {m.group(1) for m in re.finditer(r"cdn\.dribbble\.com/userupload/(\d+)/", dom[:corte])}
    imagens, videos, vistos = [], [], set()
    for m in CDN.finditer(dom):
        url = m.group(0)
        if url in vistos or re.search(r"/userupload/(\d+)/", url).group(1) not in proprios:
            continue
        vistos.add(url)
        (videos if url.endswith(".mp4") else imagens).append(url)
    # Vídeo "large-" é a versão menor do mesmo arquivo; fica o original quando os dois aparecem.
    if len(videos) > 1:
        originais = [v for v in videos if "/large-" not in v and "/small-" not in v]
        videos = originais or videos
    return {"imagens": imagens, "videos": videos}


def nome_do_arquivo(prefixo: str, indice: int, url: str, extra: str = "") -> str:
    ext = Path(urllib.parse.urlparse(url).path).suffix.lower() or ".jpg"
    extra = re.sub(r"[^0-9a-z-]", "", extra.lower())[:20]
    return f"{prefixo}{indice:02d}{'-' + extra if extra else ''}{ext}"


def abrir(url: str, espera_ms: int = 12000) -> str:
    for binario in CHROME:
        try:
            # Perfil descartável: morto pelo timeout, o Chrome não deixa perfil para trás.
            with tempfile.TemporaryDirectory(prefix="dribbble-chrome-") as perfil:
                r = subprocess.run([binario, "--headless=new", "--no-sandbox", "--disable-gpu",
                                    f"--user-data-dir={perfil}", f"--user-agent={NAVEGADOR}",
                                    f"--virtual-time-budget={espera_ms}", "--dump-dom", url],
                                   capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
            if r.stdout and ("screenshot-" in r.stdout or "userupload" in r.stdout):
                return r.stdout
        except (OSError, subprocess.TimeoutExpired):
            continue
    return ""


def baixar(url: str, destino: Path, minimo: int = 3000) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": NAVEGADOR})
        with urllib.request.urlopen(req, timeout=60) as r:
            dados = r.read(60_000_000)
        if len(dados) < minimo:
            return False
        destino.write_bytes(dados)
        return True
    except OSError:
        return False


def quadros_do_video(video: Path, saida: Path, n: int) -> list[Path]:
    """N quadros espalhados pelo vídeo (sem o primeiro e o último segundo), com o ffmpeg."""
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        return []
    try:
        dur = float(subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of",
                                    "default=nw=1:nk=1", str(video)], capture_output=True, text=True,
                                   timeout=60).stdout.strip() or 0)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return []
    if dur <= 0:
        return []
    feitos = []
    for i in range(n):
        t = 1 + (dur - 2) * (i + 0.5) / n if dur > 3 else dur * (i + 0.5) / n
        destino = saida / f"quadro-{i + 1:02d}.jpg"
        r = subprocess.run([ffmpeg, "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1",
                            "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", str(destino)], capture_output=True, timeout=60)
        if r.returncode == 0 and destino.is_file():
            feitos.append(destino)
    return feitos


def buscar(consultas: list[str], saida: Path, maximo: int) -> int:
    saida.mkdir(parents=True, exist_ok=True)
    listas = [(c, extrair_busca(abrir(url_da_busca(c)))) for c in consultas]
    indice, usados, posicao = [], set(), 0
    # Intercala as consultas: uma miniatura de cada por vez, para a folha não ser só da primeira.
    while len(indice) < maximo and any(posicao < len(l) for _, l in listas):
        for consulta, itens in listas:
            if posicao < len(itens) and len(indice) < maximo:
                s = itens[posicao]
                if s["id"] in usados:
                    continue
                usados.add(s["id"])
                nome = nome_do_arquivo("", len(indice) + 1, s["imagem"], s["id"])
                if baixar(s["imagem"], saida / nome):
                    indice.append((nome, s, consulta))
        posicao += 1
    (saida / "indice.txt").write_text(
        "".join(f"{n}\t{s['id']}\t{s['titulo']}\t{s['url']}\t{c}\n" for n, s, c in indice), encoding="utf-8")
    print(f"{len(indice)} shot(s) em {saida}")
    for n, s, c in indice:
        print(f"  {n}  {s['titulo'][:70]}  {s['url']}  [{c}]")
    if not indice:
        print("Nada veio: troque a consulta (em inglês, o ramo + 'website' ou 'landing page').", file=sys.stderr)
    return 0 if indice else 1


def shot(id_ou_url: str, saida: Path, quadros: int) -> int:
    saida.mkdir(parents=True, exist_ok=True)
    url = url_do_shot(id_ou_url)
    midias = extrair_shot(abrir(url))
    feitos = []
    for i, img in enumerate(midias["imagens"][:8], 1):
        nome = nome_do_arquivo("shot-", i, img)
        if baixar(img, saida / nome, minimo=8000):
            feitos.append(saida / nome)
    if midias["videos"]:
        video = saida / "shot.mp4"
        if baixar(midias["videos"][0], video, minimo=50_000):
            feitos += quadros_do_video(video, saida, quadros)
            video.unlink(missing_ok=True)
    print(f"{url}: {len(feitos)} arquivo(s) em {saida}")
    for f in feitos:
        print(f"  {f.name}")
    return 0 if feitos else 1


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("buscar")
    b.add_argument("--saida", required=True, type=Path)
    b.add_argument("--consulta", action="append", required=True)
    b.add_argument("--max", type=int, default=24)
    s = sub.add_parser("shot")
    s.add_argument("alvo")
    s.add_argument("--saida", required=True, type=Path)
    s.add_argument("--quadros", type=int, default=6)
    a = ap.parse_args(argv)
    if a.cmd == "buscar":
        return buscar(a.consulta, a.saida, a.max)
    return shot(a.alvo, a.saida, a.quadros)


def testar() -> int:
    import unittest

    class Casos(unittest.TestCase):
        def test_busca_extrai_id_titulo_link_e_miniatura_640(self):
            dom = ('<div class="shot2-item" id="screenshot-27806443" data-id="27806443"><img alt="Alden &amp; Vale — Law Firm" '
                   'width="320" src="https://cdn.dribbble.com/userupload/49305823/file/still-4b89.png?resize=420x&amp;vertical=center">'
                   '<a href="/shots/27806443-Alden-Vale-Law-Firm">ver</a></div>'
                   '<div class="shot2-item" id="screenshot-26219101"><img src="https://cdn.dribbble.com/userupload/1/file/a.jpg?resize=420x" '
                   'alt="Law Firm Website"><a href="/shots/26219101-Law-Firm-Website">ver</a></div>'
                   '<div id="screenshot-27476119"><img alt="Build stunning sites with Framer" '
                   'src="https://cdn.dribbble.com/userupload/2/file/ad.png"><a href="https://framer.com">ad</a></div>'
                   '<div id="screenshot-26219101"><img alt="repetido" src="https://cdn.dribbble.com/userupload/1/file/a.jpg"></div>'
                   '<div id="screenshot-999999"><img alt="anúncio" src="https://ads.example/x.png"></div>')
            r = extrair_busca(dom)
            self.assertEqual([s["id"] for s in r], ["27806443", "26219101"])
            self.assertEqual(r[0]["titulo"], "Alden & Vale — Law Firm")
            self.assertEqual(r[0]["url"], "https://dribbble.com/shots/27806443-Alden-Vale-Law-Firm")
            self.assertEqual(r[0]["imagem"], "https://cdn.dribbble.com/userupload/49305823/file/still-4b89.png?resize=640x&vertical=center")
            self.assertEqual(r[1]["url"], "https://dribbble.com/shots/26219101-Law-Firm-Website")

        def test_shot_separa_imagens_e_videos_e_prefere_o_video_original(self):
            dom = ('<img src="https://cdn.dribbble.com/userupload/49305823/file/still-4b89.png?resize=1600x">'
                   '<video src="https://cdn.dribbble.com/userupload/49305824/file/large-10f5.mp4"></video>'
                   '<img src="https://cdn.dribbble.com/userupload/49305823/file/still-4b89.png">'
                   '<section class="more-by">More by Usman'
                   '<img src="https://cdn.dribbble.com/userupload/49060225/file/outro-shot.jpg"></section>'
                   '<script>{"v":"https://cdn.dribbble.com/userupload/49305824/file/c785.mp4",'
                   '"s":"https://cdn.dribbble.com/userupload/49305824/file/small-aa.mp4"}</script>')
            r = extrair_shot(dom)
            self.assertEqual(r["videos"], ["https://cdn.dribbble.com/userupload/49305824/file/c785.mp4"])
            self.assertEqual(r["imagens"], ["https://cdn.dribbble.com/userupload/49305823/file/still-4b89.png"])

        def test_urls_e_nomes(self):
            self.assertEqual(url_da_busca("law firm website"),
                             "https://dribbble.com/search/shots/popular?q=law%20firm%20website")
            self.assertEqual(url_do_shot("https://dribbble.com/shots/27806443-Alden-Vale"),
                             "https://dribbble.com/shots/27806443")
            self.assertEqual(url_do_shot("18889326"), "https://dribbble.com/shots/18889326")
            with self.assertRaises(ValueError):
                url_do_shot("alden")
            self.assertEqual(nome_do_arquivo("", 3, "https://cdn.dribbble.com/u/1/file/a.PNG?x=1", "27806443"),
                             "03-27806443.png")
            self.assertEqual(nome_do_arquivo("shot-", 1, "https://cdn.dribbble.com/u/1/file/b.webp"), "shot-01.webp")

    r = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Casos))
    return 0 if r.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(testar() if "--testar" in sys.argv[1:] else main(sys.argv[1:]))
