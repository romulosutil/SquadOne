#!/usr/bin/env python3
"""Aplica no ~/.hermes do Dell o que está versionado aqui: SOUL.md, a skill de
leitura do Dell, os scripts do cron, os ajustes de config.yaml e da memória do
secretário, e os jobs que dependem deles (graphify dos projetos e o pré-check
da coleta do ASMR).

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

    # Mensagens seguidas no WhatsApp: "interrupt" reiniciava o turno a cada uma e,
    # depois de 3, empilhava numa fila que às vezes ficava órfã. "steer" entrega a
    # mensagem nova ao turno em andamento no próximo passo, sem reiniciar nada.
    c["display"]["busy_input_mode"] = "steer"

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


HERMES_CLI = str(Path.home() / ".local/bin/hermes")
JOB_GRAPHIFY = "Graphify — projetos"
JOB_ASMR = "79a04dbf2d81"  # ASMR FULLBRINGER — coleta de métricas
AVISO_ASMR = (
    "O pré-check acima lista os Shorts que cruzaram um marco de idade (2, 6, 12, 24, 48 ou 72 h) "
    "desde a última coleta. Colete esses Shorts e registre `age_approx_hours` exato.\n\n"
)


def jobs():
    import json
    return json.loads((HERMES / "cron/jobs.json").read_text())["jobs"]


def hermes(*args) -> None:
    subprocess.run([HERMES_CLI, *args], check=True, stdout=subprocess.DEVNULL)


def ajustar_cron() -> None:
    # graphify: um job só, sem modelo; stdout vazio = silêncio, falha vira WhatsApp.
    if not any(j["name"] == JOB_GRAPHIFY for j in jobs()):
        hermes("cron", "create", "0 3 * * *", "--no-agent", "--script", "graphify_projetos.py",
               "--deliver", "whatsapp", "--name", JOB_GRAPHIFY)
        print(f"criado    job {JOB_GRAPHIFY} (03:00)")
    else:
        print(f"igual     job {JOB_GRAPHIFY}")

    # ASMR: pré-check de hora em hora; o agente só acorda em marco de idade.
    asmr = next(j for j in jobs() if j["id"] == JOB_ASMR)
    prompt = asmr["prompt"] if asmr["prompt"].startswith(AVISO_ASMR) else AVISO_ASMR + asmr["prompt"]
    hermes("cron", "edit", JOB_ASMR, "--schedule", "every 60m", "--script", "asmr_coleta_gate.py",
           "--reasoning-effort", "medium", "--prompt", prompt)
    # Só navegador e arquivo: sem terminal nem execute_code, que ele tentava e eram bloqueados.
    import sys
    sys.path.insert(0, str(HERMES / "hermes-agent"))
    from cron.jobs import update_job
    update_job(JOB_ASMR, {"enabled_toolsets": ["browser", "file"]})
    print("ajustado  job ASMR coleta (pré-check de hora em hora, browser+file, esforço medium)")


def ajustar_graphify_fora_do_hermes() -> None:
    # O pre-push do Windows chama este caminho; agora ele só pede ao Hermes.
    gatilho = Path.home() / "workspace/scripts/run-graphify.sh"
    copiar(AQUI / "scripts/run-graphify.sh", gatilho)
    gatilho.chmod(0o755)
    # O crontab das 03:00 vira o job do Hermes: tira a linha antiga.
    atual = subprocess.run(["crontab", "-l"], capture_output=True, text=True).stdout
    novo = "".join(l for l in atual.splitlines(True) if "run-graphify.sh" not in l)
    if novo != atual:
        (Path.home() / f"crontab.bak-{CARIMBO}").write_text(atual)
        subprocess.run(["crontab", "-"], input=novo, text=True, check=True)
        print("ajustado  crontab (linha do run-graphify.sh removida)")
    # Skill do graphify no Hermes, para ele consultar os grafos ao responder.
    subprocess.run([str(Path.home() / ".local/bin/graphify"), "install", "--platform", "hermes"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("instalado skill graphify no Hermes")


def main() -> None:
    copiar(AQUI / "SOUL.md", HERMES / "SOUL.md")
    skill = "skills/dell-operations-manager/SKILL.md"
    copiar(AQUI / skill, HERMES / skill)
    for script in ("graphify_projetos.py", "asmr_coleta_gate.py"):
        copiar(AQUI / "scripts" / script, HERMES / "scripts" / script)
    ajustar_config()
    ajustar_memoria()
    ajustar_graphify_fora_do_hermes()
    ajustar_cron()
    subprocess.run(["systemctl", "--user", "restart", "hermes-gateway"], check=True)
    time.sleep(5)
    subprocess.run(["systemctl", "--user", "is-active", "hermes-gateway"], check=False)


if __name__ == "__main__":
    main()
