#!/usr/bin/env python3
"""Aplica no ~/.hermes do Dell o que está versionado aqui: SOUL.md, as skills de
leitura do Dell e do mapa do ecossistema, o pré-check da coleta do ASMR, os ajustes
de config.yaml e da memória do secretário, as ferramentas que as skills do ASMR chamam
no terminal (yt-dlp, agent-reach, mcporter) e os remendos da bridge do WhatsApp
(envios/recibos/respostas e a leitura dirigida do histórico, com a marca conferida no fim).

Não mexe mais em jobs do cron do Hermes: o graphify dos projetos, "Sites e pendências"
e a Entrada viraram timers do systemd (deploy/dell), e o job do ASMR está pausado.

Rodar pelo Python do Hermes (tem ruamel, que preserva os comentários do YAML):

    ~/.hermes/hermes-agent/venv/bin/python ~/SquadOne/deploy/hermes/scripts/aplicar-hermes.py

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

    # Mensagens seguidas no WhatsApp: "interrupt" reiniciava o turno a cada uma e,
    # depois de 3, empilhava numa fila que às vezes ficava órfã. "steer" entrega a
    # mensagem nova ao turno em andamento no próximo passo, sem reiniciar nada.
    c["display"]["busy_input_mode"] = "steer"

    # Plataformas sem toolset válido: só geravam WARNING a cada boot.
    for plat in ("teams", "google_chat"):
        (c.get("platform_toolsets") or {}).pop(plat, None)

    # agent-log é só do app desktop (desktop/plugin.js, sem parte Python) e o app
    # rodava no PC perdido: habilitado, falhava ao carregar em toda rodada ("No
    # __init__.py"). No PC novo, `hermes plugins enable agent-log` se quiser o visor.
    habilitados = (c.get("plugins") or {}).get("enabled")
    if habilitados and "agent-log" in habilitados:
        habilitados.remove("agent-log")

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
# Entradas que MEMORY.md tem de ter. As outras, que o Hermes ou o Claude
# gravaram depois, ficam: até 29/09/2026 o arquivo era sobrescrito inteiro e a
# entrada da perda do PC (28/09) sumiu numa aplicação.
MEMORIAS = [
    "A rotina `SquadOne — aprender e evoluir` (cron eb9282f96df6) está desligada "
    "desde 23/09/2026: editar repositório não é papel do secretário. Não reativar "
    "sem pedido explícito do Rômulo.",
    "O PC Windows do Rômulo queimou (NVMe); o Dell o viu pela última vez em 25/09/2026. "
    "O que não sincronizou foi perdido e não se recupera. Desde 04/10/2026 o PC novo (Jarvis, "
    "Windows, `paiduben` na tailnet) é a máquina de controle; o Dell (Mel) segue sempre ligado "
    "e roda a operação. A pasta auto do Drive parou em 25/09 (a esteira não depende dela). "
    "Detalhes: skill mapa-do-ecossistema.",
]


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
    atuais = [e.strip() for e in mem.read_text().split("\n§\n") if e.strip()] if mem.exists() else []
    faltam = [m for m in MEMORIAS if m not in atuais]
    if faltam:
        backup(mem)
        mem.write_text("\n§\n".join(atuais + faltam) + "\n")
        print(f"ajustado  {mem} (+{len(faltam)} entrada(s))")
    else:
        print(f"igual     {mem}")


# Ferramentas que as skills do ASMR chamam no terminal (youtube-channel-analysis,
# agent-reach). Tudo no espaço do usuário, em ~/.local/bin, que está no PATH do gateway.
BIN = Path.home() / ".local/bin"
UV = str(HERMES / "bin/uv")
FERRAMENTAS = {
    "yt-dlp": [UV, "tool", "install", "yt-dlp[default]"],
    "agent-reach": [UV, "tool", "install",
                    "agent-reach @ https://github.com/Panniantong/agent-reach/archive/refs/tags/v1.5.0.zip"],
    # Busca Exa do agent-reach. Pede node >= 24: o do Hermes vem antes no PATH do gateway.
    "mcporter": ["npm", "install", "-g", "--prefix", str(Path.home() / ".local"), "mcporter@0.14.1"],
}


def instalar_ferramentas() -> None:
    for nome, instalar in FERRAMENTAS.items():
        if (BIN / nome).exists():
            print(f"igual     {BIN / nome}")
            continue
        subprocess.run(instalar, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"instalado {BIN / nome}")

    # O YouTube exige runtime JS; o yt-dlp só liga o deno sozinho, e o Dell tem node.
    conf = Path.home() / ".config/yt-dlp/config"
    atual = conf.read_text() if conf.exists() else ""
    if "--js-runtimes node" not in atual.split("\n"):
        backup(conf)
        conf.parent.mkdir(parents=True, exist_ok=True)
        conf.write_text(atual + ("" if atual.endswith("\n") or not atual else "\n") + "--js-runtimes node\n")
        print(f"ajustado  {conf}")
    else:
        print(f"igual     {conf}")

    # Exa sem chave, no config de usuário do mcporter (o `config add` sem --scope grava na pasta atual).
    import json
    mcp = Path.home() / ".mcporter/mcporter.json"
    d = json.loads(mcp.read_text()) if mcp.exists() else {}
    if "exa" not in d.get("mcpServers", {}):
        backup(mcp)
        d.setdefault("mcpServers", {})["exa"] = {"baseUrl": "https://mcp.exa.ai/mcp"}
        mcp.parent.mkdir(parents=True, exist_ok=True)
        mcp.write_text(json.dumps(d, indent=2) + "\n")
        print(f"ajustado  {mcp}")
    else:
        print(f"igual     {mcp}")


BRIDGE_JS = HERMES / "hermes-agent/scripts/whatsapp-bridge/bridge.js"
# Marcas que cada remendo deixa no bridge.js; um `hermes update` troca o arquivo e leva todas.
MARCAS_DA_BRIDGE = {
    "patch_bridge_envios.py": ("squadone:envios", "squadone:recibos", "squadone:respostas"),
    # A rota POST /squadone/historico, que a Central chama em /api/operations/crm/historico.
    "patch_bridge_historico.py": ("squadone:historico",),
}


def remendar_a_bridge() -> None:
    """Reaplica os remendos da bridge e confere as marcas no bridge.js: sem isto, um `hermes update` quebrava o
    histórico da Ficha (503 na Central) sem nenhum aviso."""
    # Envios/recibos/respostas do dono no bridge.log; falha vira aviso pelo Hermes.
    subprocess.run(["python3", str(AQUI / "scripts/patch_bridge_envios.py"), "--avisar"], check=False)
    subprocess.run(["python3", str(AQUI / "scripts/patch_bridge_historico.py")], check=False)
    try:
        texto = BRIDGE_JS.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        print(f"ATENÇÃO   bridge.js ilegível ({e}): remendos não conferidos")
        return
    for script, marcas in MARCAS_DA_BRIDGE.items():
        faltam = [m for m in marcas if m not in texto]
        print(f"ATENÇÃO   {script}: faltam {', '.join(faltam)} no bridge.js (bridge incompatível?)" if faltam
              else f"igual     {script}: marcas no bridge.js")


def main() -> None:
    copiar(AQUI / "SOUL.md", HERMES / "SOUL.md")
    # conversa-do-lead (16/10/2026): ler a conversa gravada pelo observador e dizer o passo da jornada.
    for nome in ("dell-operations-manager", "mapa-do-ecossistema", "conversa-do-lead"):
        skill = f"skills/{nome}/SKILL.md"
        copiar(AQUI / skill, HERMES / skill)
    # Só o gate do ASMR ainda é script do Hermes (job pausado): graphify_projetos.py e sites_e_pendencias.py viraram
    # timers do systemd, instalados em ~/.local/bin (deploy/dell/instalados.json), e o watcher de sites foi aposentado.
    copiar(AQUI / "scripts/asmr_coleta_gate.py", HERMES / "scripts/asmr_coleta_gate.py")
    ajustar_config()
    ajustar_memoria()
    instalar_ferramentas()
    remendar_a_bridge()
    subprocess.run(["systemctl", "--user", "restart", "hermes-gateway"], check=True)
    time.sleep(5)
    subprocess.run(["systemctl", "--user", "is-active", "hermes-gateway"], check=False)


if __name__ == "__main__":
    main()
