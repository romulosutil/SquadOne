#!/usr/bin/env python3
"""Notify the Hermes WhatsApp home channel when a lead is published."""
from __future__ import annotations

import argparse
import ctypes
import fcntl
import json
import os
import re
import select
import subprocess
import unicodedata
import sys
import time
from pathlib import Path
from typing import Any

IN_CREATE = 0x00000100
IN_CLOSE_WRITE = 0x00000008
IN_MOVED_TO = 0x00000080
IN_ATTRIB = 0x00000004
WATCH_MASK = IN_CREATE | IN_CLOSE_WRITE | IN_MOVED_TO | IN_ATTRIB
libc = ctypes.CDLL("libc.so.6", use_errno=True)


def field(text: str, names: tuple[str, ...]) -> str:
    for name in names:
        match = re.search(rf"(?im)^[ \t]*(?:[-*][ \t]*)?{re.escape(name)}[ \t]*[:=-][ \t]*(.+?)[ \t]*$", text)
        if match:
            return match.group(1).strip().strip('"\'`')
    return ""


def phone_from_content(text: str) -> str:
    candidate = field(text, ("telefone", "phone", "whatsapp", "contato", "celular"))
    if not candidate:
        match = re.search(r"(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}(?!\d)", text)
        candidate = match.group(0) if match else ""
    digits = re.sub(r"\D", "", candidate)
    if len(digits) in (10, 11):
        digits = "55" + digits
    return digits


def lead_context(content: str) -> tuple[str, str, str]:
    phone = phone_from_content(content)
    ramo = field(content, ("ramo", "segmento", "categoria", "nicho", "atividade")) or "este negócio"
    cidade = field(content, ("cidade", "city", "localidade", "município", "municipio")) or "sua cidade"
    return phone, ramo, cidade


def load_state(path: Path) -> set[str]:
    if not path.exists():
        return set()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    if isinstance(raw, list):
        return {str(x) for x in raw}
    if isinstance(raw, dict):
        return {str(x) for x in raw.get("slugs", [])}
    return set()


def save_state(path: Path, slugs: set[str]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps({"slugs": sorted(slugs)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(temp, 0o600)
    os.replace(temp, path)


# Mesmo texto da variação A do Balcão (deploy/dell/claude-ops/site-mensagem.js),
# sem o detalhe do briefing. Até 29/09/2026 este aviso sugeria outro texto
# ("Olá! Preparei uma demonstração…"), e o Rômulo, que envia assim que o aviso
# chega, abordava com um tom diferente do da planilha e do follow-up.
FEMININOS = {"clinica", "academia", "casa", "barbearia", "pizzaria", "padaria", "oficina", "loja", "escola",
             "pousada", "sorveteria", "confeitaria", "lavanderia", "farmacia", "marcenaria", "vidracaria"}


def abordagem(nome: str, url: str, phone: str) -> str:
    # 05/10/2026: a primeira mensagem pede licença e não leva o link (ver site-mensagem.js);
    # o link vai depois do "pode mandar", pelo aviso de resposta. `url` fica no aviso, para o Rômulo.
    if phone.startswith("1") and len(phone) == 11:  # EUA, como no Balcão
        return (f"Hi! This is Rômulo. I found {nome} on Google and put together a demo website for you, on my own "
                f"initiative. Can I send you the link so you can take a look? No strings attached.")
    primeira = unicodedata.normalize("NFD", nome.split(" ")[0] if nome else "")
    primeira = "".join(ch for ch in primeira if ch.isalnum()).lower()
    artigo = "da" if primeira in FEMININOS else "do"
    return (f"Oi, tudo bem? Aqui é o Rômulo. Encontrei vocês no Google e montei, por conta própria, uma demonstração "
            f"de site {artigo} {nome}. Posso te mandar o link para dar uma olhada? É sem compromisso.")


def notify(lead_dir: Path, state_path: Path, dry_run: bool) -> bool:
    published = lead_dir / "publicado.json"
    content_file = lead_dir / "content.md"
    try:
        data: dict[str, Any] = json.loads(published.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Waiting for valid JSON: {published}: {exc}", file=sys.stderr)
        return False
    nome = str(data.get("nome", "")).strip()
    slug = str(data.get("slug", lead_dir.name)).strip()
    site_url = str(data.get("site_url", "")).strip()
    if not nome or not slug or not site_url:
        print(f"Ignoring incomplete publication record: {published}", file=sys.stderr)
        return False
    try:
        content = content_file.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"Waiting for content.md: {content_file}: {exc}", file=sys.stderr)
        return False
    phone, ramo, cidade = lead_context(content)
    wa_link = f"https://wa.me/{phone}" if phone else "indisponível"
    message = (
        "*Site publicado*\n"
        f"*Empresa:* {nome}\n"
        f"*Demo:* {site_url}\n"
        f"*WhatsApp:* {wa_link}\n\n"
        "*Mensagem para copiar:*\n"
        + "\n".join(f"> {linha}" if linha else "" for linha in abordagem(nome, site_url, phone).split("\n"))
    )
    state_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with state_path.open("a+", encoding="utf-8") as lockfile:
        fcntl.flock(lockfile.fileno(), fcntl.LOCK_EX)
        seen = load_state(state_path)
        if slug in seen:
            return True
        if dry_run:
            print(message)
            return True
        hermes_bin = Path.home() / ".local/bin/hermes"
        result = subprocess.run(
            # O canal principal (WHATSAPP_HOME_CHANNEL), não um nome preso ao chat da conta pareada.
            [str(hermes_bin), "send", "--to", "whatsapp", message],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            print(f"WhatsApp delivery failed for {slug}: {result.stderr.strip() or result.stdout.strip()}", file=sys.stderr)
            return False
        seen.add(slug)
        save_state(state_path, seen)
        print(f"Notified: {slug}")
    return True


def published_paths(root: Path) -> set[Path]:
    if not root.is_dir():
        return set()
    return {path for path in root.glob("*/publicado.json") if path.is_file()}


def scan(root: Path, state_path: Path, dry_run: bool) -> None:
    for published in sorted(published_paths(root)):
        notify(published.parent, state_path, dry_run)


def add_watch(fd: int, path: Path, watched: set[str]) -> None:
    try:
        key = str(path.resolve())
    except OSError:
        return
    if key in watched:
        return
    wd = libc.inotify_add_watch(fd, os.fsencode(path), WATCH_MASK)
    if wd < 0:
        err = ctypes.get_errno()
        print(f"Cannot watch {path}: {os.strerror(err)}", file=sys.stderr)
        return
    watched.add(key)


def sync_watches(fd: int, root: Path, watched: set[str]) -> None:
    if not root.is_dir():
        return
    add_watch(fd, root, watched)
    for path in root.iterdir():
        if path.is_dir():
            add_watch(fd, path, watched)


def run(root: Path, state_path: Path, dry_run: bool) -> None:
    fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
    if fd < 0:
        raise OSError(ctypes.get_errno(), "inotify_init1 failed")
    watched: set[str] = set()
    known: set[Path] = set()
    attempts: dict[Path, float] = {}
    bootstrapped = False
    while True:
        if root.is_dir() and not bootstrapped:
            # Existing publications predate this watcher and must never cause a notification flood.
            known = published_paths(root)
            bootstrapped = True
        sync_watches(fd, root, watched)
        ready, _, _ = select.select([fd], [], [], 1)
        if ready:
            try:
                os.read(fd, 65536)
            except BlockingIOError:
                pass
        current = published_paths(root)
        now = time.monotonic()
        for published in sorted(current - known):
            if now - attempts.get(published, 0) < 300:
                continue
            attempts[published] = now
            if notify(published.parent, state_path, dry_run):
                known.add(published)
                attempts.pop(published, None)
        known.intersection_update(current)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.home() / "workspace/auto")
    parser.add_argument("--state", type=Path, default=Path.home() / ".hermes/leads-notificados.json")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.once:
        args.root.mkdir(mode=0o750, parents=True, exist_ok=True)
        scan(args.root, args.state, args.dry_run)
    else:
        run(args.root, args.state, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
