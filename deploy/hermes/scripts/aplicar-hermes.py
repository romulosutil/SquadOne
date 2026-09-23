#!/usr/bin/env python3
"""Aplica no ~/.hermes do Dell o que está versionado aqui: SOUL.md, a skill de
leitura do Dell e os ajustes de config.yaml e da memória do secretário.

Rodar pelo Python do Hermes (tem ruamel, que preserva os comentários do YAML):

    ~/.hermes/hermes-agent/venv/bin/python ~/Pessoal-dev/SquadOne/deploy/hermes/scripts/aplicar-hermes.py

Idempotente. Guarda backup datado de cada arquivo que muda e reinicia o
hermes-gateway no fim, porque o gateway só relê config.yaml no boot.
"""

import shutil
import subprocess
import time
from pathlib import Path

from ruamel.yaml import YAML

HERMES = Path.home() / ".hermes"
AQUI = Path(__file__).resolve().parent.parent  # deploy/hermes
CARIMBO = time.strftime("%Y%m%d-%H%M%S")


def backup(p: Path) -> None:
    if p.exists():
        shutil.copy2(p, p.with_name(f"{p.name}.bak-{CARIMBO}"))


def copiar(origem: Path, destino: Path) -> None:
    if destino.exists() and destino.read_bytes() == origem.read_bytes():
        print(f"igual     {destino}")
        return
    backup(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(origem, destino)
    print(f"copiado   {destino}")


def ajustar_config() -> None:
    p = HERMES / "config.yaml"
    y = YAML()
    y.preserve_quotes = True
    y.width = 4096
    y.indent(mapping=2, sequence=4, offset=2)  # o mesmo estilo que o Hermes grava
    c = y.load(p.read_text())

    # Áudio do WhatsApp é em português; "en" forçava o Whisper a transcrever em inglês.
    c["stt"]["language"] = "pt"

    # O estilo do WhatsApp mora no SOUL.md: uma fonte só, sem instruções que se contradizem.
    c["agent"]["system_prompt"] = ""

    # Secretário não opera: sem pré-aprovação para apagar na raiz nem derrubar containers.
    tirar = {"delete in root path", "docker compose restart/stop/kill/down (container lifecycle)"}
    c["command_allowlist"] = [x for x in c.get("command_allowlist") or [] if x not in tirar]

    # MCPs de documentação de código, sem uso em 30 dias: custo por turno sem retorno.
    for nome in ("context7", "deepwiki"):
        if nome in (c.get("mcp_servers") or {}):
            c["mcp_servers"][nome]["enabled"] = False

    # Reserva quando a cota do Codex acabar, para rotinas e respostas não ficarem mudas.
    # gemini-3.5-flash respondeu 200 em 23/09/2026; o 3.7 estava dando 503.
    c["fallback_providers"] = [{"provider": "gemini", "model": "gemini-3.5-flash"}]

    # Skills de revisão de código (mantis-*) não servem ao secretário e pesam no índice.
    mantis = {d.name for d in (HERMES / "skills").iterdir() if d.name.startswith("mantis-")}
    c["skills"]["disabled"] = sorted(set(c["skills"].get("disabled") or []) | mantis)

    # Plataformas sem toolset válido: só geravam WARNING a cada boot.
    for plat in ("teams", "google_chat"):
        (c.get("platform_toolsets") or {}).pop(plat, None)

    backup(p)
    with p.open("w") as f:
        y.dump(c, f)
    print(f"ajustado  {p} ({len(mantis)} skills mantis-* desligadas)")


# Memórias que contradiziam o papel de secretário. Troca por prefixo da entrada.
TROCAS_USER = {
    "User prefers Caveman full": (
        "User prefers a low-token workflow (RTK, headroom/compression, Graphify); "
        "Caveman full is for coding sessions, never for WhatsApp messages."
    ),
    "User delegates broad operational discretion": (
        "Since 2026-09-23 Hermes only informs: any change needs Rômulo's explicit "
        "request for that specific change."
    ),
}
MEMORY_NOVA = (
    "A rotina `SquadOne — aprender e evoluir` (cron eb9282f96df6) está desligada "
    "desde 23/09/2026: editar repositório não é papel do secretário. Não reativar "
    "sem pedido explícito do Rômulo."
)


def ajustar_memoria() -> None:
    user = HERMES / "memories/USER.md"
    entradas = user.read_text().split("\n§\n")
    novas = []
    for e in entradas:
        for prefixo, texto in TROCAS_USER.items():
            if e.strip().startswith(prefixo):
                e = texto
        novas.append(e)
    texto = "\n§\n".join(novas)
    if texto != user.read_text():
        backup(user)
        user.write_text(texto)
        print(f"ajustado  {user} ({len(texto)} chars)")
    else:
        print(f"igual     {user}")

    mem = HERMES / "memories/MEMORY.md"
    if mem.read_text().strip() != MEMORY_NOVA:
        backup(mem)
        mem.write_text(MEMORY_NOVA)
        print(f"ajustado  {mem}")
    else:
        print(f"igual     {mem}")


def main() -> None:
    copiar(AQUI / "SOUL.md", HERMES / "SOUL.md")
    skill = "skills/dell-operations-manager/SKILL.md"
    copiar(AQUI / skill, HERMES / skill)
    ajustar_config()
    ajustar_memoria()
    subprocess.run(["systemctl", "--user", "restart", "hermes-gateway"], check=True)
    time.sleep(5)
    subprocess.run(["systemctl", "--user", "is-active", "hermes-gateway"], check=False)


if __name__ == "__main__":
    main()
