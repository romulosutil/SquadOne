#!/usr/bin/env python3
"""Passos 2, 3 e 5 da curadoria de skills do Hermes (09/10/2026).

Roda no Dell. Nada é apagado: o que sai vai para a quarentena. Idempotente:
uma segunda execução não duplica as seções.
"""
import os
import shutil

SK = os.path.expanduser("~/.hermes/skills")
Q = os.path.expanduser("~/.hermes/skills-quarentena-20261009")
os.makedirs(Q, exist_ok=True)


def ler(rel):
    with open(os.path.join(SK, rel, "SKILL.md"), encoding="utf-8") as f:
        return f.read()


def gravar(rel, texto):
    with open(os.path.join(SK, rel, "SKILL.md"), "w", encoding="utf-8") as f:
        f.write(texto)


def acrescentar(rel, marca, bloco):
    t = ler(rel)
    if marca in t:
        print("já tinha:", rel)
        return
    gravar(rel, t.rstrip("\n") + "\n\n" + bloco.strip("\n") + "\n")
    print("acrescentado:", rel)


def quarentena(rel):
    origem = os.path.join(SK, rel)
    if not os.path.isdir(origem):
        print("já fora:", rel)
        return
    shutil.move(origem, os.path.join(Q, os.path.basename(rel)))
    print("quarentena:", rel)


# Passo 3: o que só a creator-content-intelligence dizia entra na youtube-channel-analysis.
acrescentar(
    "media/youtube-channel-analysis",
    "## Peer comparison on any platform",
    """
## Peer comparison on any platform

(Absorbs the former `creator-content-intelligence`.)

- **Two evidence sets.** Owned-channel metrics come from the native creator dashboard; peer observations come from the public platform. Confirm the owned account identity before reading private metrics; login, MFA, CAPTCHA, consent or an account mismatch is a blocked read.
- **Read peers for mechanisms, not borrowed outcomes.** Pick 2-3 recent, genuinely comparable public posts. Record link, creator, public age and metrics when visible, first-frame hook, object, material, action, payoff, loop/progression and one abstract transferable principle. Unavailable public metrics stay unavailable; an indexed snippet or a single viral post is never proof.
- **Synthesize an original middle ground.** Keep the owned channel's positioning and combine it with ONE peer-derived mechanism (immediate action, object legibility, material contrast, progression, payoff or loop). Change one creative variable per test. Never copy a peer's object, title, prompt, sequence, thumbnail, character, mark, sound or asset.
- **Decide only on a same-age owned comparison.** With private metrics still processing or a small sample, report `amostra insuficiente` and schedule the next measurement instead of inventing a conclusion.
- **Compact update:** owned-channel signal first, then the public mechanism, the original synthesis, one variable to test, the next measurement. Preserve links and verified numbers, label hypotheses, no generic motivation.
- **Never automate** publication, edits, engagement, credential or account-setting changes as part of collecting intelligence.
""",
)
quarentena("business/creator-content-intelligence")

# Passo 2
quarentena("autonomous-ai-agents/agent-quality-improvement")

# Passo 5: guardas
acrescentar(
    "devops/private-worker-access",
    "## Guardrails (added 2026-10-09)",
    """
## Guardrails (added 2026-10-09)

- `sudo tailscale serve` changes what the tailnet can reach. Describe the exact service and port to the user and wait for explicit confirmation before running it or any other `sudo` command from this skill; read-only `status` calls need no confirmation.
- Never enable Funnel or any public exposure from an autonomous run.
""",
)
acrescentar(
    "productivity/file-pipeline-monitoring",
    "## Real-data guardrail (added 2026-10-09)",
    """
## Real-data guardrail (added 2026-10-09)

Tests, fixtures and dry runs never touch the real `~/auto-site` (or any live lead folder). Use a temporary root and an isolated `HOME`; a test once wiped `~/auto-site` on this host (07/10/2026). Never write, move or delete completion markers in the real tree to prove the watcher.
""",
)
acrescentar(
    "business/site-antes-da-venda",
    "## Real-data guardrail (added 2026-10-09)",
    """
## Real-data guardrail (added 2026-10-09)

This skill only reads the status script's output. Never create, edit, move or delete anything under `~/auto-site` from it, and never run tests or fixtures against that tree.
""",
)
acrescentar(
    "software-development/repository-stewardship",
    "## Production checkout guardrail (added 2026-10-09)",
    """
## Production checkout guardrail (added 2026-10-09)

- Never run this routine in `~/SquadOne`: it is the production checkout that the Central updates every 10 minutes. Do not edit it or switch its branch. Work in a git worktree under `~/.cache/mel-work/` on its own branch.
- Run tests and builds with an isolated `HOME` and a temporary data root, never against the real data directories.
- The routine is currently disabled by decision (Hermes only informs); do not re-enable it without an explicit request from the user.
""",
)
