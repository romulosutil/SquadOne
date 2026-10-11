#!/usr/bin/env python3
"""Coletor de referências do Refero para o modo premium do gerador de sites (Dell, 08/10/2026).

Pedido do Rômulo: "o exemplo são todos os exemplos, aprenda com ele a cada lead". O Refero
(refero.design) é uma galeria de milhares de produtos reais bem desenhados. A lista de
`/web-apps` e a busca `/search?q=` são montadas no navegador, então o curl não as vê: este
script abre cada página no Chrome headless (`--dump-dom`), extrai os prints públicos
(`images.refero.design/screenshots/<site>/desktop/<id>_thumb.jpg`, 800 px de largura) e baixa
os que ainda não estão na pasta. Quem LÊ as imagens é o Claude do lead (Read em imagem), que
escolhe o que serve ao negócio, compara com o próprio site e escreve o que aprendeu.

Só leitura da rede pública; escreve apenas na pasta `--saida` (o rascunho do lead).

Uso: refero-aprender.py --saida DIR --consulta "plumber" --consulta "local service" [--max 24]
     refero-aprender.py --testar     (funções puras, sem rede)
Saída: DIR/NN-<site>.jpg e DIR/indice.txt (uma linha por imagem: arquivo, site, consulta).
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

CHROME = ("google-chrome", "chromium", "/snap/bin/chromium")
PADRAO = re.compile(r"https://images\.refero\.design/screenshots/([a-z0-9.-]+)/desktop/([0-9a-f-]{36})_thumb\.jpg")
# Páginas gerais: o que está no topo do /web-apps muda toda semana e serve de "gosto do momento".
GERAIS = ("https://refero.design/web-apps",)


def extrair(dom: str) -> list[tuple[str, str]]:
    """PURO: (site, url do print) únicos, na ordem em que aparecem."""
    vistos, saida = set(), []
    for m in PADRAO.finditer(dom):
        url = m.group(0)
        if url not in vistos:
            vistos.add(url)
            saida.append((m.group(1), url))
    return saida


def url_da_busca(consulta: str) -> str:
    return "https://refero.design/search?q=" + urllib.parse.quote(consulta.strip())


def nome_do_arquivo(indice: int, site: str) -> str:
    return f"{indice:02d}-{re.sub(r'[^a-z0-9.-]', '', site)[:40]}.jpg"


def abrir(url: str, espera_ms: int = 15000) -> str:
    for binario in CHROME:
        try:
            # Perfil próprio e descartável: sem ele o Chrome usa ~/.cache/google-chrome-headless e, morto
            # pelo timeout, deixa o perfil lá para sempre. O TMPDIR do gerador é o rascunho do lead.
            with tempfile.TemporaryDirectory(prefix="refero-chrome-") as perfil:
                r = subprocess.run([binario, "--headless=new", "--no-sandbox", "--disable-gpu",
                                    f"--user-data-dir={perfil}",
                                    f"--virtual-time-budget={espera_ms}", "--dump-dom", url],
                                   capture_output=True, text=True, timeout=120)
            if r.stdout:
                return r.stdout
        except (OSError, subprocess.TimeoutExpired):
            continue
    return ""


def baixar(url: str, destino: Path) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            dados = r.read()
        if len(dados) < 5000:
            return False
        destino.write_bytes(dados)
        return True
    except OSError:
        return False


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", required=True)
    ap.add_argument("--consulta", action="append", default=[])
    ap.add_argument("--max", type=int, default=24)
    ap.add_argument("--testar", action="store_true")
    a = ap.parse_args(argv)
    saida = Path(a.saida)
    saida.mkdir(parents=True, exist_ok=True)
    fontes = [(c, url_da_busca(c)) for c in a.consulta] + [("geral", u) for u in GERAIS]
    indice, usados = [], set()
    # Intercala as fontes: uma imagem de cada por vez, para o conjunto não ser só da primeira consulta.
    listas = []
    for rotulo, url in fontes:
        listas.append((rotulo, extrair(abrir(url))))
    posicao = 0
    while len(indice) < a.max and any(posicao < len(l) for _, l in listas):
        for rotulo, itens in listas:
            if posicao < len(itens) and len(indice) < a.max:
                site, url = itens[posicao]
                if url in usados:
                    continue
                usados.add(url)
                nome = nome_do_arquivo(len(indice) + 1, site)
                if baixar(url, saida / nome):
                    indice.append((nome, site, rotulo))
        posicao += 1
    (saida / "indice.txt").write_text("\n".join(f"{n}\t{s}\t{c}" for n, s, c in indice) + "\n", encoding="utf-8")
    print(f"{len(indice)} referência(s) em {saida}")
    for n, s, c in indice:
        print(f"  {n}  {s}  [{c}]")
    return 0 if indice else 1


def testar() -> int:
    import unittest

    class Casos(unittest.TestCase):
        def test_extrai_prints_unicos_na_ordem(self):
            id1, id2 = "0e9d859b-a90b-4b5b-ade8-b8ecbb7c64fb", "6b405189-f7f6-498e-919b-4abc61d9ee4b"
            dom = (f'<img src="https://images.refero.design/screenshots/calendly.com/desktop/{id2}_thumb.jpg">'
                   f'<img src="https://images.refero.design/screenshots/acuityscheduling.com/desktop/{id1}_thumb.jpg">'
                   f'<img src="https://images.refero.design/screenshots/calendly.com/desktop/{id2}_thumb.jpg">'
                   '<img src="https://images.refero.design/favicon/x.com/abc.jpg">')
            r = extrair(dom)
            self.assertEqual([s for s, _ in r], ["calendly.com", "acuityscheduling.com"])

        def test_busca_e_nome_de_arquivo(self):
            self.assertEqual(url_da_busca("local service"), "https://refero.design/search?q=local%20service")
            self.assertEqual(nome_do_arquivo(3, "cosmos.so"), "03-cosmos.so.jpg")
            self.assertEqual(nome_do_arquivo(1, "a/../b"), "01-a..b.jpg")

    r = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Casos))
    return 0 if r.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(testar() if "--testar" in sys.argv[1:] else main(sys.argv[1:]))
