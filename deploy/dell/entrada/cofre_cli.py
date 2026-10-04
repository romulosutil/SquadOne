#!/usr/bin/env python3
"""cofre: a única forma de LER o cofre da Mel (a página nunca lê).

  cofre listar                       id, data, tipo, tamanho e rótulo (nunca o valor)
  cofre ler <id> [-o ARQUIVO]        decifra; pede confirmação e SÓ funciona com terminal
  cofre destinatarios                as chaves públicas (age1...) que abrem o cofre
  cofre adicionar-destinatario KEY   acrescenta uma chave pública (ex.: a do Rômulo, gerada no PC)
  cofre recifrar                     cifra de novo os itens já guardados para todos os destinatários

`ler` exige terminal de propósito: um agente (ou um script) que rodasse `cofre ler` sem
ninguém olhando receberia o segredo. Com -o o valor vai para um arquivo novo (600),
nunca sobrescreve, e nada aparece na tela.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cofre as cofre_mod  # noqa: E402
import entrada as entrada_mod  # noqa: E402


def _cofre() -> cofre_mod.Cofre:
    home = Path.home()
    return cofre_mod.Cofre(Path(os.environ.get("COFRE_RAIZ", home / "Mel/Cofre")),
                           Path(os.environ.get("ENTRADA_IDENTIDADE") or cofre_mod.identidade_padrao(home)))


def _diario(evento: str, **campos) -> None:
    try:
        entrada_mod.Entrada(Path(os.environ.get("ENTRADA_RAIZ", Path.home() / "Mel/Entrada")), None).diario(evento, **campos)
    except OSError:
        pass


def _listar(c: cofre_mod.Cofre, args) -> int:
    itens = c.listar()
    if not itens:
        print("(cofre vazio)")
        return 0
    for i in itens:
        nome = f"  [{i['nome']}]" if i.get("nome") else ""
        print(f"{i['id']}  {i['data'][:16].replace('T', ' ')}  {i['tipo']:7} {i['bytes']:>9} B  {i['rotulo']}{nome}")
    return 0


def _ler(c: cofre_mod.Cofre, args) -> int:
    if not sys.stdin.isatty():
        print("cofre ler só funciona num terminal, com você olhando (de propósito).", file=sys.stderr)
        return 2
    item = next((i for i in c.listar() if i["id"] == args.id), None)
    if item is None:
        print("id não encontrado.", file=sys.stderr)
        return 1
    print(f"Vai decifrar: {item['rotulo']}" + (f" [{item['nome']}]" if item.get("nome") else "") + f" ({item['bytes']} bytes).")
    if input("Digite o id para confirmar: ").strip() != args.id:
        print("Id diferente: cancelado.", file=sys.stderr)
        return 1
    try:
        if args.saida:
            n = c.ler_para_arquivo(args.id, Path(args.saida))
            print(f"Gravado em {args.saida} ({n} bytes, 600). Apague quando acabar.")
        else:
            dados = c.ler(args.id)
            if sys.stdout.isatty() and b"\x00" in dados[:8192]:
                print("É binário: use -o ARQUIVO.", file=sys.stderr)
                return 1
            sys.stdout.buffer.write(dados)
            if not dados.endswith(b"\n"):
                sys.stdout.buffer.write(b"\n")
            sys.stdout.buffer.flush()
    except (cofre_mod.CofreErro, FileExistsError) as ex:
        print(f"Não deu: {ex}", file=sys.stderr)
        return 1
    _diario("cofre-lido", id=args.id, em_arquivo=bool(args.saida))
    return 0


def _destinatarios(c: cofre_mod.Cofre, args) -> int:
    for k in c.destinatarios():
        print(k)
    return 0


def _adicionar(c: cofre_mod.Cofre, args) -> int:
    chave = args.chave.strip()
    if not cofre_mod.CHAVE_PUBLICA.fullmatch(chave):
        print("Isso não é uma chave pública age1... (a privada, AGE-SECRET-KEY, nunca vai para cá).", file=sys.stderr)
        return 1
    atuais = c.destinatarios()
    if chave in atuais:
        print("Essa chave já está na lista.")
        return 0
    tmp = c.raiz / ".recipients.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(c.recipients.read_text(encoding="utf-8").rstrip("\n") + f"\n{chave}\n")
    os.replace(tmp, c.recipients)
    print(f"Acrescentada. Agora são {len(atuais) + 1} destinatários.")
    _diario("cofre-destinatario-adicionado", total=len(atuais) + 1)
    if args.recifrar:
        return _recifrar(c, args)
    if c.listar():
        print("Os itens que já estão no cofre só abrem para os destinatários antigos até você rodar: cofre recifrar")
    return 0


def _recifrar(c: cofre_mod.Cofre, args) -> int:
    try:
        n = c.recifrar()
    except cofre_mod.CofreErro as ex:
        print(f"Não deu: {ex}", file=sys.stderr)
        return 1
    print(f"{n} item(ns) recifrado(s) para {len(c.destinatarios())} destinatário(s).")
    _diario("cofre-recifrado", itens=n)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="cofre", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("listar").set_defaults(fn=_listar)
    p = sub.add_parser("ler")
    p.add_argument("id")
    p.add_argument("-o", "--saida")
    p.set_defaults(fn=_ler)
    sub.add_parser("destinatarios").set_defaults(fn=_destinatarios)
    p = sub.add_parser("adicionar-destinatario")
    p.add_argument("chave")
    p.add_argument("--recifrar", action="store_true", help="já recifra os itens existentes")
    p.set_defaults(fn=_adicionar)
    sub.add_parser("recifrar").set_defaults(fn=_recifrar)
    args = ap.parse_args(argv)
    try:
        return args.fn(_cofre(), args)
    except cofre_mod.CofreErro as ex:
        print(f"Cofre: {ex}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
