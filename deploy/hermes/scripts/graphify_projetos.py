#!/usr/bin/env python3
"""Mantém os grafos do graphify de todos os projetos e o diário do que mudou.

É o único lugar que roda `graphify update`: o Windows nunca roda (regra do
workspace), o crontab antigo saiu e o pre-push só pede ao Hermes que rode este
job agora. Roda como job `no_agent` do cron do Hermes: stdout vazio = silêncio,
qualquer texto vira mensagem no WhatsApp. Por isso só imprime falha.

Para cada projeto em ~/Pessoal-dev (réplica Syncthing de dev/PESSOAL/apps):

1. conta os arquivos de código alterados desde a última rodada;
2. sem alteração e com grafo: não roda nada (a rodada noturna custa segundos);
3. com alteração, ou sem grafo: `graphify update <projeto>` (AST, sem LLM);
4. junta o grafo no global (`graphify global add`), que é o que o Hermes
   consulta para perguntas que cruzam projetos.

O diário (`diario.jsonl`) e o `RESUMO.md` são o contexto do Hermes sobre o que
o Rômulo anda fazendo: projeto, quando, quais arquivos.

Uso manual: graphify_projetos.py [projeto ...]
"""

import fcntl
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

HOME = Path.home()
RAIZES = [HOME / "Pessoal-dev"]
ESTADO_DIR = HOME / ".local/share/graphify-hermes"
GRAPHIFY = next(
    (str(p) for p in (HOME / ".local/bin/graphify", HOME / "workspace/agents/venv-hermes/bin/graphify") if p.exists()),
    "graphify",
)
# Cópias de publicação e pastas-sombra não são projetos de verdade.
IGNORAR = re.compile(r"-publish-|\+$")
CODIGO = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".py", ".go",
          ".rs", ".java", ".kt", ".swift", ".php", ".rb", ".cs", ".sql"}
PASTAS_FORA = {"node_modules", ".git", "graphify-out", "dist", "build", ".next", ".nuxt",
               ".venv", "venv", "__pycache__", ".cache", ".turbo", "coverage", ".svelte-kit"}
TIMEOUT_S = 20 * 60
DIAS_DIARIO = 90
DIAS_SNAPSHOT = 7  # pastas AAAA-MM-DD que o graphify deixa em graphify-out
# Grafo maior que isto fica só no projeto: no global, tornaria toda consulta do
# Hermes lenta (o do espectro tinha 157 MB em 23/09/2026).
LIMITE_GLOBAL_MB = 40


def arquivos_de_codigo(projeto: Path):
    for raiz, pastas, arquivos in os.walk(projeto):
        pastas[:] = [p for p in pastas if p not in PASTAS_FORA and not p.startswith(".")]
        for a in arquivos:
            if Path(a).suffix in CODIGO:
                yield Path(raiz) / a


def tamanho_do_grafo(grafo: Path):
    mb = grafo.stat().st_size / 1e6
    if mb > LIMITE_GLOBAL_MB:
        return {"mb": round(mb)}  # não carrega: um JSON desse tamanho come GB de RAM
    try:
        d = json.loads(grafo.read_text())
    except (OSError, ValueError):
        return None
    arestas = d.get("links", d.get("edges", []))
    return {"nos": len(d.get("nodes", [])), "arestas": len(arestas)}


def rodar(args, cwd: Path, timeout=TIMEOUT_S):
    env = dict(os.environ, GRAPHIFY_NO_TIPS="1")
    r = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    return r.returncode, (r.stdout + r.stderr).strip()


def podar_snapshots(saida: Path) -> None:
    limite = datetime.now() - timedelta(days=DIAS_SNAPSHOT)
    for p in saida.glob("20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]"):
        try:
            if p.is_dir() and datetime.strptime(p.name, "%Y-%m-%d") < limite:
                subprocess.run(["rm", "-rf", str(p)], check=False)
        except ValueError:
            pass


def projetos(nomes):
    for raiz in RAIZES:
        if not raiz.is_dir():
            continue
        for p in sorted(raiz.iterdir()):
            if p.is_dir() and not p.name.startswith(".") and not IGNORAR.search(p.name):
                if not nomes or p.name in nomes:
                    yield p


def main() -> int:
    nomes = set(sys.argv[1:])
    ESTADO_DIR.mkdir(parents=True, exist_ok=True)
    trava = open(ESTADO_DIR / ".lock", "w")
    try:
        fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return 0  # outra rodada em andamento (noturna + pre-push juntos); ela cobre esta

    estado_p = ESTADO_DIR / "estado.json"
    estado = json.loads(estado_p.read_text()) if estado_p.exists() else {"projetos": {}}
    agora = time.time()
    falhas = []
    mudancas = {}

    for proj in projetos(nomes):
        anterior = estado["projetos"].get(proj.name, {})
        desde = anterior.get("verificado_em", agora - 86400)
        codigo = list(arquivos_de_codigo(proj))
        if not codigo:
            continue
        alterados = sorted((f for f in codigo if f.stat().st_mtime > desde),
                           key=lambda f: f.stat().st_mtime, reverse=True)
        saida = proj / "graphify-out"
        grafo = saida / "graph.json"
        info = dict(anterior, arquivos_de_codigo=len(codigo), verificado_em=agora)
        # Pelo arquivo mais recente, não pelo que mudou nesta rodada: projeto parado
        # também precisa dizer desde quando está parado.
        recente = max(f.stat().st_mtime for f in codigo)
        info["ultima_atividade"] = datetime.fromtimestamp(recente).isoformat(timespec="minutes")

        # Sem mudança só pula se o grafo já foi medido e entrou no global; senão um
        # projeto parado nunca apareceria para o Hermes.
        if grafo.exists() and not alterados and anterior.get("no_global"):
            estado["projetos"][proj.name] = info
            continue

        rc, log = 0, ""
        if alterados or not grafo.exists():
            try:
                rc, log = rodar([GRAPHIFY, "update", str(proj)], cwd=proj)
            except subprocess.TimeoutExpired:
                rc, log = 124, f"passou de {TIMEOUT_S // 60} min"
        if rc != 0 or not grafo.exists():
            falhas.append(f"{proj.name}: {log.splitlines()[-1] if log else f'saiu com {rc}'}")
            info["erro"] = log[-500:]
            info.pop("verificado_em")  # tenta de novo na próxima rodada
            estado["projetos"][proj.name] = info
            continue

        tam = tamanho_do_grafo(grafo) or {}
        antes = anterior.get("grafo") or {}
        if "mb" in tam:
            rc_g, log_g = 0, ""  # grande demais para o global; consulta vai no grafo do projeto
        else:
            rc_g, log_g = rodar([GRAPHIFY, "global", "add", str(grafo), "--as", proj.name], cwd=proj, timeout=300)
        if rc_g != 0:
            falhas.append(f"{proj.name} (grafo global): {log_g.splitlines()[-1] if log_g else rc_g}")
        podar_snapshots(saida)

        info.update(grafo=tam, atualizado_em=agora, erro=None, no_global=rc_g == 0)
        estado["projetos"][proj.name] = info
        if not alterados:
            continue  # só entrou no global; não é atividade para o diário
        mudancas[proj.name] = {
            "arquivos": len(alterados),
            "exemplos": [str(f.relative_to(proj)) for f in alterados[:15]],
            "nos": tam.get("nos"),
            "delta_nos": (tam.get("nos") or 0) - (antes.get("nos") or 0) if antes else None,
        }

    if not nomes:
        limpar_global(set(estado["projetos"]))

    estado["rodado_em"] = datetime.fromtimestamp(agora).isoformat(timespec="minutes")
    tmp = estado_p.with_suffix(".tmp")
    tmp.write_text(json.dumps(estado, ensure_ascii=False, indent=1))
    tmp.replace(estado_p)

    if mudancas:
        diario = ESTADO_DIR / "diario.jsonl"
        linhas = diario.read_text().splitlines() if diario.exists() else []
        corte = (datetime.fromtimestamp(agora) - timedelta(days=DIAS_DIARIO)).isoformat()
        linhas = [l for l in linhas if json.loads(l).get("em", "") >= corte]
        linhas.append(json.dumps({"em": estado["rodado_em"], "projetos": mudancas}, ensure_ascii=False))
        diario.write_text("\n".join(linhas) + "\n")

    escrever_resumo(estado)

    if falhas:
        print("🧭 Operação — graphify\n\nNão consegui atualizar o grafo de:\n"
              + "\n".join(f"• {f}" for f in falhas)
              + "\n\nOs outros projetos estão em dia. Detalhe em ~/.local/share/graphify-hermes/estado.json.")
    return 0


def limpar_global(projetos_vivos) -> None:
    """O grafo global é deste script: tira o que não é mais projeto (ex.: o
    `workspace` que o crontab antigo grafava, ou um projeto apagado)."""
    rc, log = rodar([GRAPHIFY, "global", "list"], cwd=HOME, timeout=60)
    if rc != 0:
        return
    for linha in log.splitlines():
        m = re.match(r"\s+(\S+): \d+ nodes", linha)
        if m and m.group(1) not in projetos_vivos:
            rodar([GRAPHIFY, "global", "remove", m.group(1)], cwd=HOME, timeout=60)


def escrever_resumo(estado) -> None:
    """Tabela curta que o Hermes lê para saber em que o Rômulo anda mexendo."""
    diario = ESTADO_DIR / "diario.jsonl"
    semana = (datetime.now() - timedelta(days=7)).isoformat()
    na_semana = {}
    if diario.exists():
        for l in diario.read_text().splitlines():
            e = json.loads(l)
            if e["em"] >= semana:
                for nome, m in e["projetos"].items():
                    na_semana[nome] = na_semana.get(nome, 0) + m["arquivos"]
    linhas = [
        "# Projetos do Rômulo (gerado por graphify_projetos.py)",
        "",
        f"Atualizado em {estado['rodado_em']}. Diário completo: diario.jsonl.",
        "Perguntas sobre um projeto: `graphify query \"<pergunta>\" --graph ~/Pessoal-dev/<projeto>/graphify-out/graph.json`.",
        "Entre projetos: `graphify query \"<pergunta>\" --graph ~/.graphify/global-graph.json`.",
        "",
        "| Projeto | Última atividade | Arquivos mudados em 7 dias | Nós no grafo |",
        "|---|---|---|---|",
    ]
    ordem = sorted(estado["projetos"].items(), key=lambda kv: kv[1].get("ultima_atividade") or "", reverse=True)
    for nome, info in ordem:
        g = info.get("grafo") or {}
        tamanho = g.get("nos", f"{g['mb']} MB, fora do global" if "mb" in g else "—")
        linhas.append(f"| {nome} | {info.get('ultima_atividade') or '—'} | {na_semana.get(nome, 0)} | "
                      f"{tamanho}{' ⚠️ erro' if info.get('erro') else ''} |")
    (ESTADO_DIR / "RESUMO.md").write_text("\n".join(linhas) + "\n")


if __name__ == "__main__":
    sys.exit(main())
