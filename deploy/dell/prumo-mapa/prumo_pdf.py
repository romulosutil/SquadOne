#!/usr/bin/env python3
"""HTML do PRUMO -> PDF, sem abrir o Chrome e sem Ctrl+P.

Uso:
    prumo-pdf <arquivo.html> [saida.pdf] [--param chave=valor ...]

Sem saída, grava <arquivo>.pdf ao lado do HTML. --param vira query string
(a apresentação lê ?empresa=&pessoa=&nota=), como o antigo gerar-pdf.ps1.
O tamanho da página vem do @page de cada peça (A4 no Mapa, 1600x900 nos slides).

Roda um Chrome headless próprio, com perfil descartável: não encosta no
Chrome do Hermes (CDP :9222, perfil real). Binário: $PRUMO_CHROME ou o
primeiro que existir entre google-chrome, chromium-browser e chromium.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

CANDIDATOS = ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium")


def achar_chrome() -> str:
    escolhido = os.environ.get("PRUMO_CHROME")
    if escolhido:
        return escolhido
    for nome in CANDIDATOS:
        caminho = shutil.which(nome)
        if caminho:
            return caminho
    raise RuntimeError("nenhum Chrome/Chromium encontrado (defina PRUMO_CHROME)")


def html_para_pdf(html: Path, pdf: Path | None = None, params: dict | None = None, espera_ms: int = 10000) -> Path:
    """Imprime `html` em `pdf` e devolve o caminho. Levanta RuntimeError se falhar."""
    html = Path(html).resolve()
    if not html.is_file():
        raise RuntimeError(f"arquivo não encontrado: {html}")
    pdf = Path(pdf).resolve() if pdf else html.with_suffix(".pdf")
    url = html.as_uri()
    if params:
        url += "?" + "&".join(f"{quote(str(k))}={quote(str(v))}" for k, v in params.items())
    parcial = pdf.with_name(pdf.name + ".parcial")
    with tempfile.TemporaryDirectory(prefix="prumo-pdf-") as perfil:
        cmd = [achar_chrome(), "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
               "--disable-extensions", f"--user-data-dir={perfil}", "--no-pdf-header-footer",
               "--run-all-compositor-stages-before-draw", f"--virtual-time-budget={espera_ms}",
               f"--print-to-pdf={parcial}", url]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        except subprocess.TimeoutExpired:
            parcial.unlink(missing_ok=True)
            raise RuntimeError("o Chrome não terminou em 3 minutos")
    if r.returncode != 0 or not parcial.exists() or parcial.stat().st_size < 1000:
        parcial.unlink(missing_ok=True)
        erro = (r.stderr or r.stdout).strip().splitlines()[-1:] or ["sem mensagem"]
        raise RuntimeError(f"o Chrome não gerou o PDF (código {r.returncode}): {erro[0][:300]}")
    parcial.replace(pdf)
    return pdf


def paginas(pdf: Path) -> int:
    """Conta páginas pelo dicionário /Type /Page (suficiente para PDF do Chrome)."""
    dados = Path(pdf).read_bytes()
    return dados.count(b"/Type /Page") - dados.count(b"/Type /Pages")


def main(argv: list[str]) -> int:
    args, params = [], {}
    it = iter(argv)
    for a in it:
        if a == "--param":
            chave, _, valor = next(it, "").partition("=")
            if not chave:
                print("--param precisa de chave=valor", file=sys.stderr)
                return 2
            params[chave] = valor
        elif a in ("-h", "--help"):
            print(__doc__.strip())
            return 0
        else:
            args.append(a)
    if not 1 <= len(args) <= 2:
        print("uso: prumo-pdf <arquivo.html> [saida.pdf] [--param chave=valor ...]", file=sys.stderr)
        return 2
    try:
        pdf = html_para_pdf(Path(args[0]), Path(args[1]) if len(args) == 2 else None, params)
    except RuntimeError as e:
        print(f"prumo-pdf: {e}", file=sys.stderr)
        return 1
    print(f"{pdf} ({paginas(pdf)} páginas, {pdf.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
