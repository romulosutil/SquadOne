#!/usr/bin/env python3
"""Foto mensal do uso das skills do Hermes (09/10/2026).

O Hermes já conta o uso em ~/.hermes/skills/.usage.json, mas o histórico das
sessões cobre só algumas semanas. Uma foto datada por mês mostra a tendência
(skill que parou de ser usada, skill que cresceu) sem instrumentar nada.

SOMENTE LEITURA sobre o Hermes: lê o .usage.json e grava um arquivo novo em
~/.local/share/hermes-uso-skills/AAAA-MM-DD.json (modo 600). Nunca altera,
move ou apaga skill, e não chama modelo nem rede.
"""
import datetime
import json
import os
import sys

CAMPOS = ("use_count", "view_count", "patch_count", "last_used_at",
          "last_viewed_at", "state", "created_by", "created_at")


def foto(usage, hoje):
    """PURO: o conteúdo da foto a partir do .usage.json e da data."""
    skills = {}
    for nome, d in sorted(usage.items()):
        if not isinstance(d, dict):
            continue
        skills[nome] = {c: d.get(c) for c in CAMPOS}
    return {
        "data": hoje.isoformat(),
        "total": len(skills),
        "nunca_usadas": sorted(n for n, d in skills.items()
                               if not d["use_count"] and not d["view_count"]),
        "skills": skills,
    }


def principal(skills_dir, saida_dir, hoje):
    with open(os.path.join(skills_dir, ".usage.json"), encoding="utf-8") as f:
        usage = json.load(f)
    os.makedirs(saida_dir, mode=0o700, exist_ok=True)
    destino = os.path.join(saida_dir, hoje.isoformat() + ".json")
    tmp = destino + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(foto(usage, hoje), f, ensure_ascii=False, indent=1)
    os.replace(tmp, destino)
    return destino


if __name__ == "__main__":
    home = os.path.expanduser("~")
    try:
        print(principal(os.path.join(home, ".hermes/skills"),
                        os.path.join(home, ".local/share/hermes-uso-skills"),
                        datetime.date.today()))
    except (OSError, ValueError) as e:
        print("hermes-uso-skills: falhou:", e, file=sys.stderr)
        sys.exit(1)
