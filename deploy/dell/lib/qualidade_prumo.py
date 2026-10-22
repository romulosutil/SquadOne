"""Trava da publicação: a Prumo decide; o executor confere os bytes finais."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import sys


def motor():
    raiz = Path(os.environ.get("PRUMO_REPO", str(Path.home() / "prumo"))).resolve()
    pasta = raiz / "06-qualidade"
    if not (pasta / "publicacao.py").is_file():
        raise ValueError("Fonte canônica da qualidade indisponível; publicação bloqueada")
    sys.path.insert(0, str(pasta)) if str(pasta) not in sys.path else None
    import publicacao
    import qualidade
    return raiz, qualidade, publicacao


def chave_da_entrega(pasta):
    pasta = Path(pasta)
    try:
        texto = (pasta / "content.md").read_text(encoding="utf-8")
        m = re.search(r"(?i)place_id[:* \t]+([a-zA-Z0-9_-]+)", texto)
        if m:
            return m[1]
    except OSError:
        pass
    try:
        r = json.loads((pasta / "publicado.json").read_text(encoding="utf-8"))
        if r.get("place_id"):
            return r["place_id"]
    except (OSError, ValueError):
        pass
    return str(pasta.resolve())


def arquivos_site(pasta):
    pasta = Path(pasta)
    nomes = ("index.html", "og.jpg", "robots.txt", "sitemap.xml", "llms.txt")
    return {n: (pasta / n).read_bytes() for n in nomes if (pasta / n).is_file()}


def proteger(produto, pasta, arquivos, alvos=None, chave=None):
    raiz, q, p = motor()
    pasta = Path(pasta)
    ref = p.referencia(chave or chave_da_entrega(pasta))
    # O gerador escreve na pasta do lead; o aceite fica fora de seu escopo de escrita.
    avaliacoes = Path(os.environ.get("PRUMO_QUALIDADE_AVALIACOES_DIR", str(Path.home() / ".config/prumo-qualidade/entregas")))
    cfg_path = avaliacoes / ref.replace(":", "-") / f"{produto}.json"
    cfg = q.ler(cfg_path) if cfg_path.exists() else None
    c = q.ler(raiz / "06-qualidade/catalogo.json")
    if cfg is None or cfg.get("fase") == "homologacao":
        candidato = pasta / f".prumo-candidato-{produto}.json"
        candidato.write_text(json.dumps(p.preparar(c, produto, ref, arquivos), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    recibo = p.decidir(c, produto, ref, arquivos, cfg,
                       raiz=raiz, squadone=raiz.parent / "SquadOne")
    finais = dict(arquivos) if recibo["profissional"] else p.marcar_homologacao(arquivos, alvos)
    recibo["versao"] = p.versao(finais)
    recibo["organizacao_sha256"] = q.digest(raiz / "00-contexto/organizacao.md")
    # Recibo só confirma qualidade; a URL só será gravada depois do deploy e do GET.
    destino = pasta / f".prumo-qualidade-{produto}.json"
    tmp = destino.with_suffix(".tmp")
    tmp.write_text(json.dumps(recibo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(destino)
    return finais, recibo


def recibo(produto, pasta):
    return json.loads((Path(pasta) / f".prumo-qualidade-{produto}.json").read_text(encoding="utf-8"))


def preparar(produto, pasta):
    raiz, q, p = motor()
    arquivos = arquivos_site(pasta)
    c = q.ler(raiz / "06-qualidade/catalogo.json")
    return p.preparar(c, produto, p.referencia(chave_da_entrega(pasta)), arquivos)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--preparar", type=Path, required=True)
    ap.add_argument("--produto", default="site")
    args = ap.parse_args()
    print(json.dumps(preparar(args.produto, args.preparar), ensure_ascii=False, indent=2))
