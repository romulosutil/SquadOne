#!/usr/bin/env python3
"""Página real do nicho no Land-book para cada site da esteira (Dell, 03/11/2026).

O shot do Dribbble (dribbble.py) dá a composição e o tom, mas é um conceito: quase nunca traz a
página inteira, nunca traz o celular e o texto dele é de enfeite. Faltava ver uma página
CONSTRUÍDA do mesmo ramo: a sequência inteira de seções, quanto texto cada uma tem de verdade e o
site no ar (cujo celular o Claude do lead captura com outra ferramenta). O Land-book tem isso: sites
publicados e templates construídos, com a captura da página inteira no desktop e o link do site.

O `robots.txt` do Land-book recebe os robôs de IA de braços abertos e libera `/search?q=`,
`/design/website/<categoria>?page=N` e `/websites/<id>-<nome>`; proíbe `/api/`, `/login` e os
filtros por parâmetro (`?search=`, `?sort=`, `?industry=`, `?category=`, `?style=`, `?type=`...).
Este script só pede esses três formatos (`permitido()` barra o resto), com 1 s entre pedidos, por
urllib comum (o curl leva 200, sem anti-robô; conferido em 03/11/2026). Nada atrás do PRO: só a
captura do desktop que a página pública serve; a do celular é paga e fica de fora (o celular vem do
site no ar). As URLs do CDN são assinadas (`?signature=`): saem do HTML como estão, nunca montadas.
A busca é por semelhança e sempre devolve algo, até para consulta sem sentido (03/11/2026: "law
firm" deu 434 resultados; uma palavra inventada, 1 000 aleatórios): quem julga se serve é o Claude,
pela folha. Ela mistura escritório de verdade com software do ramo e template à venda; o tipo do
Land-book ([Landing], [Template]...) vai no título do indice.txt.

Só leitura da rede pública; escreve apenas na pasta `--saida`.

Uso: landbook.py buscar --saida DIR --consulta "law firm" [--consulta "lawyer"] [--max 24]
       → DIR/NN-<id>.<ext> (miniaturas) e DIR/indice.txt (arquivo, id, título [tipo], url, consulta);
         com menos de 6 resultados, completa com a categoria "local-business"
     landbook.py pagina <id ou url> --saida DIR [--altura 900]
       → DIR/pagina.<ext> (página inteira no desktop), DIR/site.txt (site no ar e link do Land-book)
         e, se houver Pillow, DIR/tela-NN.jpg (fatias de 1366×altura, até 12)
     landbook.py --testar     (funções puras, sem rede)
Depois: folha-de-contato --saida DIR/folha.jpg --pasta DIR, e Read só na folha. Na página, junte as
telas (tela-*.jpg) e não a pagina.* inteira: alta como é, ela derruba a escala da folha (18% numa
página de 9781 px, contra 47% só com as telas).
"""
from __future__ import annotations

import argparse
import html
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

# O mesmo user agent de um Chrome comum que o dribbble.py usa; o Land-book responde 200 a ele.
NAVEGADOR = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
             "Chrome/141.0.0.0 Safari/537.36")
BASE = "https://land-book.com"
CATEGORIA = "local-business"
MINIMO_DE_RESULTADOS = 6
PAUSA = 1.0                 # segundos entre pedidos (cortesia com o site)
MAX_TELAS = 12
LARGURA_DESKTOP = 1366      # a captura inteira do desktop sai em 1366x0
# Imagem do CDN: /image/[recorte/][filtros/]<L>x<A>/website/<id>/<hash>-<nome>.<ext>[?signature=...].
# O recorte (`0x0:1366x2049/`) aparece nas miniaturas; a página inteira vem sem recorte.
CDN = re.compile(r"https://cdn\.land-book\.com/image/[^\"'\s<>]*?/website/(\d+)/[^\"'\s<>?]+(?:\?signature=[0-9a-f]+)?")
SEM_RECORTE = re.compile(r"cdn\.land-book\.com/image/(\d+)x0/website/(\d+)/([0-9a-f]+)-")
ITEM = re.compile(r'data-analytics-item-id="(\d+)"')
PAGINA = re.compile(r"(?:/websites/)?(\d+)-([a-z0-9][a-z0-9-]*)", re.I)
_ultimo_pedido = 0.0


def url_da_busca(consulta: str) -> str:
    """A busca do site, como no navegador: /search?q=<consulta> (o `?search=` é proibido)."""
    return f"{BASE}/search?q=" + urllib.parse.quote(consulta.strip())


def url_da_categoria(nome: str, pagina: int) -> str:
    return f"{BASE}/design/website/{nome}?page={int(pagina)}"


def url_da_pagina(id_ou_url: str) -> str | None:
    """/websites/<id>-<nome> a partir do link (inteiro ou só o caminho). Só o número não basta: o
    Land-book dá 404 em /websites/<id> sem o nome; aí devolve None (procure no indice.txt)."""
    m = PAGINA.search(id_ou_url.strip())
    if not m:
        return None
    return f"{BASE}/websites/{m.group(1)}-{m.group(2).lower()}"


def id_da_pagina(id_ou_url: str) -> str:
    m = re.search(r"(\d{3,})", id_ou_url)
    if not m:
        raise ValueError(f"não achei o número da página em {id_ou_url!r}")
    return m.group(1)


def permitido(url: str) -> bool:
    """PURO: só os formatos que o robots.txt libera e que este script usa. Imagem do CDN vale."""
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https":
        return False
    if u.netloc == "cdn.land-book.com":
        return u.path.startswith("/image/")
    if u.netloc != "land-book.com":
        return False
    params = urllib.parse.parse_qs(u.query, keep_blank_values=True)
    if u.path == "/search":
        return set(params) == {"q"}
    if re.fullmatch(r"/design/website/[a-z0-9-]+", u.path):
        return set(params) <= {"page"} and all(v.isdigit() for v in params.get("page", []))
    if re.fullmatch(r"/websites/\d+-[a-z0-9-]+", u.path):
        return not u.query
    return False


def sem_ref(url: str) -> str:
    """PURO: o link do site sem o `ref=land-book.com` que o Land-book acrescenta."""
    u = urllib.parse.urlsplit(url.strip())
    resto = [(k, v) for k, v in urllib.parse.parse_qsl(u.query, keep_blank_values=True) if k != "ref"]
    return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, urllib.parse.urlencode(resto), u.fragment))


def _atributo(tag: str, nome: str) -> str | None:
    m = re.search(r"\s" + re.escape(nome) + r'="([^"]*)"', tag)
    return html.unescape(m.group(1)) if m else None


def _titulo_e_tipo(alt: str, slug: str) -> tuple[str, str]:
    """"Advis Law - Landing design inspiration" -> ("Advis Law", "Landing"). Sem alt, vem do nome."""
    m = re.fullmatch(r"(.*?)\s+-\s+([A-Za-z][A-Za-z ]*?)\s+design inspiration", alt.strip())
    if m:
        return m.group(1).strip(), m.group(2).strip()
    if alt.strip():
        return alt.strip(), ""
    return slug.replace("-", " ").strip().capitalize(), ""


def extrair_busca(pagina: str) -> list[dict]:
    """PURO: os itens da busca (ou da categoria), na ordem e sem repetir o id:
    {'id', 'titulo', 'tipo', 'url', 'imagem'}. Cada cartão começa em `data-analytics-item-id`; a
    miniatura é a `<img>` do cartão cuja URL é do MESMO id (o `src`, 600 px de largura, assinado).
    Sem miniatura do id, 'imagem' fica vazia e o item continua. Template à venda ("Buy $") sai com
    tipo "Template" mesmo que o alt não diga."""
    marcas = list(ITEM.finditer(pagina))
    saida, vistos = [], set()
    for i, m in enumerate(marcas):
        pid = m.group(1)
        if pid in vistos:
            continue
        trecho = pagina[m.start(): marcas[i + 1].start() if i + 1 < len(marcas) else len(pagina)]
        # Cartão de seção ("website-item-component") liga com `?component=N`, que o robots.txt
        # proíbe: fica o caminho da página, sem o parâmetro.
        link = re.search(r'href="(/websites/' + pid + r'-[a-z0-9-]+)(?:\?[^"]*)?"', trecho, re.I)
        if not link:
            continue
        vistos.add(pid)
        imagem, alt = "", ""
        for tag in re.findall(r"<img\b[^>]*>", trecho):
            src = _atributo(tag, "src") or ""
            c = CDN.fullmatch(src)
            if c and c.group(1) == pid:
                imagem, alt = src, _atributo(tag, "alt") or ""
                break
        slug = link.group(1).split("-", 1)[1]
        titulo, tipo = _titulo_e_tipo(alt, slug)
        if tipo != "Template" and re.search(r">\s*Buy \$", trecho):
            tipo = "Template"
        saida.append({"id": pid, "titulo": titulo, "tipo": tipo, "url": BASE + link.group(1).lower(),
                      "imagem": imagem})
    return saida


def extrair_pagina(pagina: str, pid: str) -> dict:
    """PURO: da página de detalhe, {'imagem', 'site', 'titulo'}. A página também traz os sites
    "relacionados" (outros ids) e a captura do celular (outro hash, coberta pelo aviso do PRO): da
    imagem, só vale a do MESMO id, sem recorte, fora do celular; entre elas, a de 1366 px (senão a
    mais larga). Se houver a `<img data-website-img>`, só o hash dela. O site é o botão "Visit" do
    mesmo id, sem o `ref`."""
    celular, principal = set(), None
    for tag in re.findall(r"<img\b[^>]*>", pagina):
        src = _atributo(tag, "src") or ""
        h = SEM_RECORTE.search(src)
        if not h or h.group(2) != pid:
            continue
        if "data-expandable-content-img" in tag or "mobile" in (_atributo(tag, "alt") or "").lower():
            celular.add(h.group(3))
        elif "data-website-img" in tag and principal is None:
            principal = h.group(3)
    candidatas = []
    for m in CDN.finditer(pagina):
        url = html.unescape(m.group(0))
        h = SEM_RECORTE.search(url)
        if not h or h.group(2) != pid or h.group(3) in celular:
            continue
        if principal and h.group(3) != principal:
            continue
        candidatas.append((int(h.group(1)), url))
    imagem = ""
    if candidatas:
        exatas = [u for lar, u in candidatas if lar == LARGURA_DESKTOP]
        imagem = exatas[0] if exatas else max(candidatas, key=lambda c: c[0])[1]
    site = ""
    for tag in re.findall(r"<a\b[^>]*>", pagina):
        if "visit_button" not in tag:
            continue
        dono = _atributo(tag, "data-analytics-website-id")
        href = _atributo(tag, "href") or ""
        if (dono is None or dono == pid) and href.startswith("http"):
            site = sem_ref(href)
            break
    t = re.search(r"<title>\s*([^<]*?)\s*</title>", pagina)
    titulo = html.unescape(t.group(1)) if t else ""
    titulo = re.sub(r"\s+on Landbook\b.*$", "", titulo).strip()
    return {"imagem": imagem, "site": site, "titulo": titulo}


def url_no_indice(texto: str, pid: str) -> str | None:
    """PURO: o link do Land-book do id, numa cópia do indice.txt do `buscar`."""
    for linha in texto.splitlines():
        partes = linha.split("\t")
        if len(partes) >= 4 and partes[1] == pid:
            return partes[3]
    return None


def cortes(altura_total: int, altura: int, maximo: int = MAX_TELAS) -> list[tuple[int, int]]:
    """PURO: (topo, base) de cada tela, de cima para baixo; a última pode ser menor. Para em
    `maximo` telas (o resto da página fica só na imagem inteira)."""
    if altura <= 0:
        raise ValueError("altura da tela precisa ser positiva")
    return [(t, min(t + altura, altura_total)) for t in range(0, altura_total, altura)][:maximo]


def extensao(dados: bytes, url: str) -> str:
    """PURO: a extensão real, pelos primeiros bytes (há .jpg servido como webp); senão, a da URL."""
    if dados[:4] == b"RIFF" and dados[8:12] == b"WEBP":
        return ".webp"
    if dados[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if dados[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    return Path(urllib.parse.urlparse(url).path).suffix.lower() or ".jpg"


def nome_do_arquivo(prefixo: str, indice: int, ext: str, extra: str = "") -> str:
    extra = re.sub(r"[^0-9a-z-]", "", extra.lower())[:20]
    return f"{prefixo}{indice:02d}{'-' + extra if extra else ''}{ext}"


def _pedir(url: str, limite: int) -> bytes:
    global _ultimo_pedido
    if not permitido(url):
        raise ValueError(f"URL fora do que o robots.txt libera: {url}")
    espera = PAUSA - (time.monotonic() - _ultimo_pedido)
    if espera > 0:
        time.sleep(espera)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": NAVEGADOR, "Accept-Language": "en-US,en;q=0.9"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read(limite)
    finally:
        _ultimo_pedido = time.monotonic()


def abrir(url: str) -> str:
    try:
        return _pedir(url, 20_000_000).decode("utf-8", errors="replace")
    except OSError as e:
        print(f"Falha ao abrir {url}: {e}", file=sys.stderr)
        return ""


def baixar(url: str, destino_sem_ext: Path, minimo: int = 3000) -> Path | None:
    """Baixa e grava com a extensão real; devolve o arquivo ou None."""
    try:
        dados = _pedir(url, 60_000_000)
    except OSError as e:
        print(f"Falha ao baixar {url}: {e}", file=sys.stderr)
        return None
    if len(dados) < minimo:
        return None
    destino = destino_sem_ext.with_name(destino_sem_ext.name + extensao(dados, url))
    destino.write_bytes(dados)
    return destino


def limpar(saida: Path, padrao: str) -> None:
    """Apaga só o que uma rodada anterior deste script deixou (para a folha não misturar rodadas)."""
    for p in saida.iterdir():
        if p.is_file() and re.fullmatch(padrao, p.name):
            p.unlink()


def buscar(consultas: list[str], saida: Path, maximo: int) -> int:
    saida.mkdir(parents=True, exist_ok=True)
    limpar(saida, r"\d{2}-\d+\.(webp|jpg|png)")
    listas, abriu = [], False
    for c in consultas:
        pagina = abrir(url_da_busca(c))
        abriu = abriu or bool(pagina)
        listas.append((c, extrair_busca(pagina)))
    vistos = {s["id"] for _, l in listas for s in l}
    for n in (1, 2):
        if len(vistos) >= MINIMO_DE_RESULTADOS:
            break
        pagina = abrir(url_da_categoria(CATEGORIA, n))
        abriu = abriu or bool(pagina)
        extra = [s for s in extrair_busca(pagina) if s["id"] not in vistos]
        vistos |= {s["id"] for s in extra}
        listas.append((CATEGORIA, extra))
    indice, usados, posicao = [], set(), 0
    # Intercala as consultas: um item de cada por vez, para a folha não ser só da primeira.
    while len(indice) < maximo and any(posicao < len(l) for _, l in listas):
        for consulta, itens in listas:
            if posicao < len(itens) and len(indice) < maximo:
                s = itens[posicao]
                if s["id"] in usados:
                    continue
                usados.add(s["id"])
                arquivo = None
                if s["imagem"]:
                    arquivo = baixar(s["imagem"], saida / nome_do_arquivo("", len(indice) + 1, "", s["id"]))
                indice.append((arquivo.name if arquivo else "-", s, consulta))
        posicao += 1
    titulo = lambda s: s["titulo"].replace("\t", " ") + (f" [{s['tipo']}]" if s["tipo"] else "")
    (saida / "indice.txt").write_text(
        "".join(f"{n}\t{s['id']}\t{titulo(s)}\t{s['url']}\t{c}\n" for n, s, c in indice), encoding="utf-8")
    print(f"{len(indice)} página(s) em {saida} ({sum(n != '-' for n, _, _ in indice)} com miniatura)")
    for n, s, c in indice:
        print(f"  {n}  {titulo(s)[:70]}  {s['url']}  [{c}]")
    if not indice:
        motivo = "o Land-book não respondeu (rede)" if not abriu else "nenhuma página veio"
        print(f"Nada veio: {motivo}. Troque a consulta (em inglês, o ramo: 'law firm', 'dentist', "
              "'plumber'); sem resultado de novo, siga só com o shot do Dribbble (ou a composição do "
              "exemplo aprovado) e diga isso no resumo final.", file=sys.stderr)
    return 0 if indice else 1


def _url_do_alvo(alvo: str, saida: Path) -> str | None:
    url = url_da_pagina(alvo)
    if url:
        return url
    pid = id_da_pagina(alvo)
    pastas = [saida, saida.parent] + ([p for p in sorted(saida.parent.iterdir()) if p.is_dir()]
                                      if saida.parent.is_dir() else [])
    for pasta in pastas:
        indice = pasta / "indice.txt"
        if indice.is_file():
            achada = url_no_indice(indice.read_text(encoding="utf-8"), pid)
            if achada:
                return url_da_pagina(achada)
    return None


def fatiar(imagem: Path, saida: Path, altura: int) -> tuple[list[Path], int, int] | None:
    """Fatias de 1366×altura em JPEG, para ler a página tela a tela: (telas, largura, altura da
    página). None se não houver Pillow ou ele não abrir a imagem."""
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        with Image.open(imagem) as im:
            im.load()
            rgb = im.convert("RGB")
    except (OSError, ValueError) as e:
        print(f"Pillow não abriu {imagem.name} ({e}): fica só a imagem inteira.", file=sys.stderr)
        return None
    feitas = []
    for i, (topo, base) in enumerate(cortes(rgb.height, altura), 1):
        destino = saida / f"tela-{i:02d}.jpg"
        rgb.crop((0, topo, rgb.width, base)).save(destino, "JPEG", quality=80, optimize=True)
        feitas.append(destino)
    return feitas, rgb.width, rgb.height


def pagina(alvo: str, saida: Path, altura: int) -> int:
    saida.mkdir(parents=True, exist_ok=True)
    try:
        url = _url_do_alvo(alvo, saida)
    except ValueError as e:
        print(f"{e}. Passe o link do Land-book como está no indice.txt.", file=sys.stderr)
        return 1
    if not url:
        print(f"Só o número não basta (o Land-book pede /websites/<id>-<nome>) e ele não está num "
              f"indice.txt perto de {saida}. Passe o link do Land-book como está no indice.txt.", file=sys.stderr)
        return 1
    pid = id_da_pagina(url)
    dados = extrair_pagina(abrir(url), pid)
    if not dados["imagem"]:
        print(f"{url}: sem a captura do desktop (página fora do ar ou HTML mudou). Escolha outro item do "
              "indice.txt; sem nenhum que sirva, siga só com o shot do Dribbble (ou a composição do "
              "exemplo aprovado) e diga isso no resumo final.", file=sys.stderr)
        return 1
    limpar(saida, r"(tela-\d{2}\.jpg|pagina\.(webp|jpg|png))")
    inteira = baixar(dados["imagem"], saida / "pagina", minimo=20_000)
    if not inteira:
        print(f"{url}: a captura do desktop não baixou. Tente de novo ou escolha outro item do indice.txt.",
              file=sys.stderr)
        return 1
    fatiada = fatiar(inteira, saida, altura)
    telas, tamanho = (fatiada[0], f" ({fatiada[1]}x{fatiada[2]})") if fatiada else (None, "")
    linhas = [f"site: {dados['site'] or '(o Land-book não traz o link)'}", f"land-book: {url}"]
    if dados["titulo"]:
        linhas.append(f"titulo: {dados['titulo']}")
    linhas.append(f"captura: {inteira.name}{tamanho}")
    (saida / "site.txt").write_text("\n".join(linhas) + "\n", encoding="utf-8")
    print(f"{url}: {inteira.name}{tamanho} em {saida}")
    print("  " + "\n  ".join(linhas))
    if telas is None:
        print("Sem Pillow: fica só a página inteira (pagina.*), sem as telas. Leia-a pela folha-de-contato.")
    else:
        print(f"  {len(telas)} tela(s) de {LARGURA_DESKTOP}x{altura}: " + ", ".join(t.name for t in telas))
        if fatiada[2] > MAX_TELAS * altura:
            print(f"  Página maior que {MAX_TELAS} telas: o fim está só em {inteira.name}.")
    if not dados["site"]:
        print("Sem o link do site no ar: o celular fica sem captura; siga só com o desktop.", file=sys.stderr)
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("buscar")
    b.add_argument("--saida", required=True, type=Path)
    b.add_argument("--consulta", action="append", required=True)
    b.add_argument("--max", type=int, default=24)
    p = sub.add_parser("pagina")
    p.add_argument("alvo")
    p.add_argument("--saida", required=True, type=Path)
    p.add_argument("--altura", type=int, default=900)
    a = ap.parse_args(argv)
    if a.cmd == "buscar":
        return buscar(a.consulta, a.saida, a.max)
    if a.altura < 200:
        ap.error("--altura precisa ser de pelo menos 200 px")
    return pagina(a.alvo, a.saida, a.altura)


def testar() -> int:
    import unittest

    sig = "?signature=" + "ab12" * 16
    img = lambda corte, lar, pid, h, nome: f"https://cdn.land-book.com/image/{corte}{lar}x0/website/{pid}/{h}-{nome}.webp{sig}"

    class Casos(unittest.TestCase):
        def test_busca_extrai_id_titulo_tipo_link_e_miniatura_do_mesmo_id(self):
            pagina = (
                '<div class="website-item" data-analytics-thumbnail data-analytics-item-id="55618" '
                'data-analytics-item-category="website"><a href="/websites/55618-atento-webflow-html-website-template">'
                f'<img src="{img("0x0:1366x2049/", 600, 55618, "c68b", "atento")}" alt="Atento - Webflow HTML Website '
                'Template - Template design inspiration"></a><img src="https://cdn.land-book.com/image/32x0/filters:format(webp)/avatar.jpg" alt="Pablo">'
                '<a href="/websites/55618-atento-webflow-html-website-template" class="btn">Buy $49</a></div>'
                '<div class="website-item" data-analytics-item-id="80656"><a href="/websites/80656-advis-law">'
                f'<img src="{img("0x0:1366x2049/", 600, 80656, "6356", "advishawaii-com")}" '
                'srcset="x 600w" alt="Advis Law - Landing design inspiration"></a></div>'
                '<div class="website-item" data-analytics-item-id="80656"><a href="/websites/80656-advis-law">repetido</a></div>'
                '<div class="website-item" data-analytics-item-id="93238"><a href="/websites/93238-rhetorich-make-speaking">'
                f'<img src="{img("", 600, 11111, "ffff", "outro")}" alt="Rhetorich | Make speaking your firm&#039;s '
                'advantage - Landing design inspiration"></a></div>'
                '<div class="website-item" data-analytics-item-id="70000"><span>sem link</span></div>'
                '<div class="website-item" data-analytics-item-id="89111"><a href="/websites/89111-home-cicala-pllc">'
                '<img src="https://cdn.land-book.com/image/600x0/website/89111/aa-x.webp" alt=""></a></div>'
                '<div class="website-item website-item-component" data-analytics-item-id="54482">'
                '<a href="/websites/54482-fact-checking-software?component=117270">'
                f'<img src="{img("0x3891:1366x4767/", 600, 54482, "2069", "www-atticus-tech")}" '
                'alt="Fact-checking software - Landing design inspiration"></a></div>')
            r = extrair_busca(pagina)
            self.assertEqual([s["id"] for s in r], ["55618", "80656", "93238", "89111", "54482"])
            self.assertEqual(r[4]["url"], "https://land-book.com/websites/54482-fact-checking-software")
            self.assertEqual((r[0]["titulo"], r[0]["tipo"]), ("Atento - Webflow HTML Website Template", "Template"))
            self.assertEqual(r[0]["url"], "https://land-book.com/websites/55618-atento-webflow-html-website-template")
            self.assertIn("/website/55618/", r[0]["imagem"])
            self.assertTrue(r[0]["imagem"].endswith(sig))
            self.assertEqual((r[1]["titulo"], r[1]["tipo"]), ("Advis Law", "Landing"))
            # A miniatura era de outro id: fica sem ela (e sem o alt dela), mas o item fica.
            self.assertEqual((r[2]["imagem"], r[2]["titulo"]), ("", "Rhetorich make speaking"))
            self.assertEqual(r[1]["titulo"], "Advis Law")
            r2 = extrair_busca('<div data-analytics-item-id="7"><a href="/websites/7-x"><img alt="Firm&#039;s '
                               f'Site | A &amp; B - Landing design inspiration" src="{img("", 600, 7, "aa", "x")}"></a></div>')
            self.assertEqual(r2[0]["titulo"], "Firm's Site | A & B")
            self.assertEqual((r[3]["titulo"], r[3]["tipo"]), ("Home cicala pllc", ""))

        def test_template_pelo_botao_de_compra_mesmo_sem_alt(self):
            r = extrair_busca('<div data-analytics-item-id="1234"><a href="/websites/1234-firmo">x</a>'
                              '<a class="btn">\n  Buy $59\n</a></div>')
            self.assertEqual(r[0]["tipo"], "Template")

        def test_pagina_pega_o_desktop_1366_do_id_sem_celular_nem_relacionados(self):
            pagina = (
                '<title>Advis Law on Landbook - get inspired by landing design and more</title>'
                '<a href="https://advishawaii.com/?ref=land-book.com" data-analytics-website-id="80656" '
                'data-analytics-link-type="visit_button">Visit</a>'
                f'<img src="{img("0x1297:1366x2228/", 600, 80656, "6356", "advishawaii-com")}" alt="seção">'
                f'<img src="{img("", 1366, 80656, "6356", "advishawaii-com")}" '
                f'srcset="{img("", 800, 80656, "6356", "advishawaii-com")} 800w, '
                f'{img("", 1000, 80656, "6356", "advishawaii-com")} 1000w" alt="Advis Law - Landing design" data-website-img>'
                f'<img src="{img("", 500, 80656, "fe69", "advishawaii-com")}" '
                f'srcset="{img("", 2000, 80656, "fe69", "advishawaii-com")} 2000w" alt="Advis Law mobile view" '
                'data-expandable-content-img>'
                f'<img src="{img("", 1600, 74105, "0568", "peoplemademachines-com")}">'
                '<a href="https://peoplemademachines.com/?ref=land-book.com" data-analytics-website-id="74105" '
                'data-analytics-link-type="visit_button">Visit</a>')
            r = extrair_pagina(pagina, "80656")
            self.assertEqual(r["imagem"], img("", 1366, 80656, "6356", "advishawaii-com"))
            self.assertEqual(r["site"], "https://advishawaii.com/")
            self.assertEqual(r["titulo"], "Advis Law")
            self.assertEqual(extrair_pagina(pagina, "99999")["imagem"], "")

        def test_pagina_sem_1366_fica_com_a_mais_larga_e_sem_visit_fica_sem_site(self):
            pagina = (f'<img src="{img("", 800, 5, "aa", "x")}" data-website-img '
                      f'srcset="{img("", 1200, 5, "aa", "x")} 1200w">'
                      '<a href="https://outro.com/?ref=land-book.com" data-analytics-website-id="6" '
                      'data-analytics-link-type="visit_button">Visit</a>')
            r = extrair_pagina(pagina, "5")
            self.assertEqual(r["imagem"], img("", 1200, 5, "aa", "x"))
            self.assertEqual(r["site"], "")

        def test_sem_ref_e_robots(self):
            self.assertEqual(sem_ref("https://advishawaii.com/?ref=land-book.com"), "https://advishawaii.com/")
            self.assertEqual(sem_ref("https://a.com/x?lang=en&ref=land-book.com#topo"), "https://a.com/x?lang=en#topo")
            self.assertTrue(permitido(url_da_busca("law firm")))
            self.assertTrue(permitido(url_da_categoria("local-business", 2)))
            self.assertTrue(permitido("https://land-book.com/websites/80656-advis-law"))
            self.assertTrue(permitido(img("", 1366, 80656, "6356", "advishawaii-com")))
            for proibida in ("https://land-book.com/search?search=law", "https://land-book.com/search?q=law&sort=new",
                             "https://land-book.com/design/website/local-business?industry=law",
                             "https://land-book.com/design/website/local-business?page=1&type=x",
                             "https://land-book.com/api/websites", "https://land-book.com/login",
                             "https://land-book.com/websites/80656-advis-law?view=mobile",
                             "http://land-book.com/search?q=law", "https://example.com/websites/1-a"):
                self.assertFalse(permitido(proibida), proibida)

        def test_urls_indice_cortes_e_nomes(self):
            self.assertEqual(url_da_busca("law firm"), "https://land-book.com/search?q=law%20firm")
            self.assertEqual(url_da_categoria("local-business", 1),
                             "https://land-book.com/design/website/local-business?page=1")
            for alvo in ("https://land-book.com/websites/80656-advis-law", "/websites/80656-advis-law",
                         "80656-Advis-Law"):
                self.assertEqual(url_da_pagina(alvo), "https://land-book.com/websites/80656-advis-law")
            self.assertIsNone(url_da_pagina("80656"))
            self.assertEqual(id_da_pagina("80656"), "80656")
            with self.assertRaises(ValueError):
                id_da_pagina("advis")
            indice = ("01-80656.webp\t80656\tAdvis Law [Landing]\thttps://land-book.com/websites/80656-advis-law\tlaw firm\n"
                      "-\t93238\tRhetorich [Landing]\thttps://land-book.com/websites/93238-rhetorich\tlaw firm\n")
            self.assertEqual(url_no_indice(indice, "93238"), "https://land-book.com/websites/93238-rhetorich")
            self.assertIsNone(url_no_indice(indice, "1"))
            self.assertEqual(cortes(3535, 900), [(0, 900), (900, 1800), (1800, 2700), (2700, 3535)])
            self.assertEqual(cortes(900, 900), [(0, 900)])
            self.assertEqual(len(cortes(20000, 900)), 12)
            self.assertEqual(cortes(20000, 900)[-1], (9900, 10800))
            self.assertEqual(extensao(b"RIFF\x00\x00\x00\x00WEBPVP8 ", "https://c/x.jpg"), ".webp")
            self.assertEqual(extensao(b"\xff\xd8\xff\xe0", "https://c/x.webp"), ".jpg")
            self.assertEqual(extensao(b"????", "https://c/x.PNG?signature=1"), ".png")
            self.assertEqual(nome_do_arquivo("", 3, ".webp", "80656"), "03-80656.webp")

    r = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Casos))
    return 0 if r.wasSuccessful() else 1


if __name__ == "__main__":
    # Título com travessão ou acento não derruba o script num terminal que não é UTF-8.
    for fluxo in (sys.stdout, sys.stderr):
        if hasattr(fluxo, "reconfigure"):
            fluxo.reconfigure(errors="replace")
    sys.exit(testar() if "--testar" in sys.argv[1:] else main(sys.argv[1:]))
