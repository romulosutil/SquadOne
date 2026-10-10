#!/usr/bin/env python3
"""Passo 4 da curadoria de skills do Hermes (09/10/2026). Roda no Dell.

Sem perda de conteúdo: o texto original da n8n-workflow-deployment passa
literalmente para references/, e o SKILL.md fica com o resumo e as regras
críticas. Na youtube-channel-analysis só a numeração é corrigida. Cópia dos
originais na quarentena.
"""
import os
import re
import shutil

SK = os.path.expanduser("~/.hermes/skills")
Q = os.path.expanduser("~/.hermes/skills-quarentena-20261009/passo4")
os.makedirs(Q, exist_ok=True)

# ---------------- n8n-workflow-deployment ----------------
n8n = os.path.join(SK, "productivity/n8n-workflow-deployment")
orig = open(os.path.join(n8n, "SKILL.md"), encoding="utf-8").read()
if "references/procedimento-detalhado.md" in orig:
    print("n8n: já dividida")
else:
    shutil.copy(os.path.join(n8n, "SKILL.md"), os.path.join(Q, "n8n-workflow-deployment.SKILL.md"))
    linhas = orig.split("\n")
    i_proc = linhas.index("## Procedure")
    i_pit = linhas.index("## Pitfalls")
    passos = [l for l in linhas[i_proc + 1:i_pit] if l.strip()]
    armadilhas = [l for l in linhas[i_pit + 1:] if l.strip()]
    assert len(passos) == 10 and passos[0].startswith("1. ") and passos[-1].startswith("10. "), len(passos)
    assert len(armadilhas) == 19, len(armadilhas)

    os.makedirs(os.path.join(n8n, "references"), exist_ok=True)
    with open(os.path.join(n8n, "references/procedimento-detalhado.md"), "w", encoding="utf-8") as f:
        f.write("# n8n Workflow Deployment: procedimento detalhado\n\n"
                "Texto integral dos 10 passos (movido do SKILL.md em 09/10/2026, sem alteração).\n\n"
                + "\n\n".join(passos) + "\n")
    with open(os.path.join(n8n, "references/armadilhas.md"), "w", encoding="utf-8") as f:
        f.write("# n8n Workflow Deployment: armadilhas\n\n"
                "Texto integral (movido do SKILL.md em 09/10/2026, sem alteração).\n\n"
                + "\n".join(armadilhas) + "\n")

    novo = """---
name: n8n-workflow-deployment
description: "Use when importing, configuring, or verifying n8n workflows."
version: 0.2.0
---

# n8n Workflow Deployment

Deploy workflow changes through the n8n instance that owns them; do not infer availability from whether an `n8n` binary exists on the host shell.

## Procedure (resumo)

1. **Discover the deployment boundary** first: health endpoint, containers, ports, Compose dir, `N8N_EDITOR_BASE_URL`; map project -> container -> loopback URL -> owner. Use the CLI inside the n8n container.
2. **First-run owner setup** only through the UI and the browser vault; never inject a password by REST, database, env or CLI.
3. **Private HTTPS origin before OAuth**; configure the credential only in the instance that owns the workflow, with the callback that instance renders.
4. **Reset only with explicit authorization**, after exporting every instance; remove only the named n8n containers and their dedicated volumes.
5. **Inspect source and target read-only** (IDs, names, active state, node counts, owning project); never print credentials.
6. **Resolve the target project** and import with explicit `--projectId`.
7. **Import inactive** (`active: false`), fresh UUIDs for cross-instance imports, no `--activeState=fromJson`.
8. **Verify the external state** by re-export before activation; import output alone is not proof.
9. **Configure and test before activation**; get explicit approval before schedules or outbound nodes.
10. **Activate with approval** (`publish:workflow`, or `update:workflow --active=true` plus restart), then re-export to confirm.

Full text of each step: `references/procedimento-detalhado.md`.

## Critical rules (read before acting)

- Never use `n8n execute --id` inside a live n8n container; it starts a second runtime. Test via the authenticated API/UI.
- Never run `docker compose down -v` on a stack that also holds application databases.
- Passwords only through the browser vault; API keys through an n8n credential (`httpHeaderAuth`), not `$env`.
- Keep n8n bound to loopback behind a private HTTPS proxy; never widen Docker to all interfaces for OAuth.
- Import inactive with an explicit `--projectId` and verify state and ownership by export.
- Keep discovery, qualification, report drafting and outbound delivery separated; discovery scores are review priority, not proof.
- Tests and fixtures never touch real data directories (use a temporary root and an isolated `HOME`).

All pitfalls with their reasons (Schedule Trigger day encoding, Google Sheets gid, credential types per node, Tailscale Serve): `references/armadilhas.md`.
"""
    with open(os.path.join(n8n, "SKILL.md"), "w", encoding="utf-8") as f:
        f.write(novo)
    print("n8n: dividida;", len(passos), "passos e", len(armadilhas), "armadilhas em references/")

# ---------------- youtube-channel-analysis: numeração ----------------
yt = os.path.join(SK, "media/youtube-channel-analysis/SKILL.md")
t = open(yt, encoding="utf-8").read()
linhas = t.split("\n")
i0 = linhas.index("## Procedure")
i1 = linhas.index("## Rules")
n = 0
mudou = False
for i in range(i0 + 1, i1):
    m = re.match(r"^(\d+)\. (\*\*.*)$", linhas[i])
    if m:
        n += 1
        if int(m.group(1)) != n:
            mudou = True
        linhas[i] = f"{n}. {m.group(2)}"
if mudou:
    shutil.copy(yt, os.path.join(Q, "youtube-channel-analysis.SKILL.md"))
    open(yt, "w", encoding="utf-8").write("\n".join(linhas))
    print("youtube: renumerada, passos 1 a", n)
else:
    print("youtube: numeração já correta")
