#!/usr/bin/env python3
"""Mantém os grafos do graphify de todos os projetos e o diário do que mudou.

É o único lugar que roda `graphify update` fora das sessões de código (o
crontab antigo e o `run-graphify.sh` saíram; não há mais job do Hermes).

Dois jeitos de rodar:

- `--fila` (o graphify-projetos.service, pelo .timer das 03:00): a falha vira
  UM aviso na fila do dell-status (`deploy/dell/lib/aviso.py`), com o silêncio
  das 22h às 7h, a chave de um dia (`graphify:falha:<data>`) e o teto por
  hora; o stdout é só log (journal). Erro inesperado e SIGTERM (o
  TimeoutStartSec de 1 h do service) também viram aviso, no lugar do
  `failure_deliver` do Hermes, e a unit sai com erro.
- sem `--fila` (rodada manual, no terminal): a falha sai só no stdout, sem
  aviso na fila, para a rodada que o Rômulo conduz à mão não acordar o
  Telegram. O systemd sempre passa `--fila`; não há mais job do Hermes.

O que ele cobre vem do registro de projetos (deploy/hermes/projetos.toml, lido
do clone ~/SquadOne, que o atualizar-central mantém em dia):

- clones vivos e pastas sem Git com `grafo = true`: ficam onde estão;
- todos os outros repositórios do GitHub do Rômulo (menos arquivados, forks,
  os que o registro marca `grafo = false` e os maiores que o limite): um clone
  raso em ~/Mel/Repos/<nome>, só do Hermes, que ninguém edita. Repositório
  novo entra sozinho na noite seguinte.

Para cada um:

1. espelho: `git fetch --depth 1` + `reset --hard`. Nunca merge e nunca
   `clean -x`, que apagaria o graphify-out;
2. sem alteração e com grafo: não roda nada (a rodada noturna custa segundos);
3. com alteração, ou sem grafo: `graphify update <projeto>` (AST, sem LLM);
4. junta o grafo no global (`graphify global add`), que é o que o Hermes
   consulta para perguntas que cruzam projetos;
5. copia graph.json, GRAPH_REPORT.md e graph.html para
   ~/Mel/Grafos/<nome>/graphify-out: é de lá que o PC puxa por SSH, com o
   mesmo layout que os CLAUDE.md dos repositórios mandam ler.

O diário (`diario.jsonl`) e o `RESUMO.md` são o contexto do Hermes sobre o que
o Rômulo anda fazendo: projeto, quando, quais arquivos. Os dois têm teto.

Varredura de duplicatas (só avisa, nunca age): pasta de topo da home fora do
registro, repositório em duas pastas, clone vivo com o origin errado. Cada
conjunto de avisos vira UMA mensagem na fila do dell-status; o mesmo conjunto
não se repete na noite seguinte.

Tempo: o service tem teto de 1 h (TimeoutStartSec=1h). Por isso há um orçamento (ORCAMENTO_S): passado dele
o script para de abrir projeto novo, avisa quantos faltaram e continua na noite
seguinte. A primeira rodada grande é manual.

Uso manual:
  graphify_projetos.py                rodada completa à mão (falha só no stdout)
  graphify_projetos.py --fila         rodada completa (falha na fila de avisos)
  graphify_projetos.py <projeto> ...  só estes (não limpa o global nem varre duplicatas)
  graphify_projetos.py --planejar     mostra o que faria, sem clonar nem gravar nada
"""

import fcntl
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import tomllib
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

HOME = Path.home()
REGISTRO = HOME / "SquadOne/deploy/hermes/projetos.toml"
VERIFICADOR = HOME / "SquadOne/deploy/hermes/scripts/projetos_verificar.py"
ESTADO_DIR = HOME / ".local/share/graphify-hermes"
FILA = HOME / ".local/share/avisos/fila"
GRAFOS_PADRAO = HOME / "Mel/Grafos"
ESPELHOS_PADRAO = HOME / "Mel/Repos"
GRAPHIFY = next(
    (str(p) for p in (HOME / ".local/bin/graphify", HOME / "workspace/agents/venv-hermes/bin/graphify") if p.exists()),
    "graphify",
)
CODIGO = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".py", ".go",
          ".rs", ".java", ".kt", ".swift", ".php", ".rb", ".cs", ".sql"}
PASTAS_FORA = {"node_modules", ".git", "graphify-out", "dist", "build", ".next", ".nuxt",
               ".venv", "venv", "__pycache__", ".cache", ".turbo", "coverage", ".svelte-kit"}
TIMEOUT_S = 20 * 60          # por `graphify update`
TIMEOUT_CLONE_S = 15 * 60
TIMEOUT_FETCH_S = 5 * 60
ORCAMENTO_S = 50 * 60        # o Hermes mata o script em 1 h
DIAS_DIARIO = 90
MAX_LINHAS_DIARIO = 500
EXEMPLOS_NO_DIARIO = 8
MAX_LINHAS_RESUMO = 60
DIAS_SNAPSHOT = 7            # pastas AAAA-MM-DD que o graphify deixa em graphify-out
# Grafo maior que isto fica só no projeto: no global, tornaria toda consulta do
# Hermes lenta (o do espectro tinha 157 MB em 23/09/2026).
LIMITE_GLOBAL_MB = 40
LIMITE_REPO_MB_PADRAO = 300  # o registro manda (geral.graphify_limite_repo_mb)
AVISO_GLOBAL_TOTAL_MB = 300  # global-graph.json maior que isto vira falha
EXPORTAR = ("graph.json", "GRAPH_REPORT.md", "graph.html")
# Repositórios onde nem se procura Git: cache, lixeira, arquivo morto, pacotes.
PULAR_NA_VARREDURA = {"node_modules", "snap", "Arquivo", "__pycache__"}

# Fila de avisos do dell-status (formato em deploy/dell/README.md, "Fila de avisos").
ORIGEM = "hermes:graphify-projetos"
TITULO_FALHA = "🧭 Operação — graphify"
HORA_DA_RODADA = 3           # o .timer (e o job antigo do Hermes): a falha expira na rodada seguinte

# A lib de aviso (deploy/dell/lib/aviso.py, 11/10/2026): no repo, em
# deploy/dell/lib; no Dell, instalada em ~/.local/lib/mel/ (instalados.json).
# Primeiro a do repo, para o teste nunca pegar uma cópia instalada. Instalado em
# ~/.local/bin ou ~/.hermes/scripts, a primeira não existe e vale a segunda.
PASTAS_DA_LIB = [Path(__file__).resolve().parent.parent.parent / "dell/lib", HOME / ".local/lib/mel"]


def lib_de_aviso():
    """O módulo da lib, ou None quando nenhuma cópia existe ou carrega."""
    for pasta in PASTAS_DA_LIB:
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", pasta / "aviso.py")
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception:  # noqa: BLE001 — ausente ou quebrada: tenta a próxima
            continue
    return None


class ErroGitHub(Exception):
    pass


@dataclass
class Alvo:
    nome: str
    pasta: Path
    tipo: str            # "viva" (clone), "pasta" (sem Git) ou "espelho" (clone raso do Hermes)
    repo: str = ""       # "dono/nome" no GitHub
    branch: str = ""


def rodar(args, cwd: Path, timeout=TIMEOUT_S):
    """(código, stdout, stderr). O graphify põe dicas na saída: só falha vira texto."""
    env = dict(os.environ, GRAPHIFY_NO_TIPS="1", GIT_TERMINAL_PROMPT="0")
    r = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


@dataclass
class Contexto:
    """Tudo que a rodada toca fora dela, para os testes não dependerem do Dell."""
    home: Path = HOME
    registro: dict = field(default_factory=dict)
    estado_dir: Path = ESTADO_DIR
    fila: Path = FILA
    graphify: str = GRAPHIFY
    rodar: Callable = rodar
    orcamento_s: int = ORCAMENTO_S
    verificador: Path = VERIFICADOR
    grafos_dir: Path = GRAFOS_PADRAO
    espelhos_dir: Path = ESPELHOS_PADRAO


def ultima_linha(*textos) -> str:
    linhas = [l for t in textos for l in (t or "").strip().splitlines() if l.strip()]
    return linhas[-1][:200] if linhas else ""


def expandir(caminho: str, home: Path) -> Path:
    if caminho == "~":
        return home
    return home / caminho[2:] if caminho.startswith("~/") else Path(caminho)


def carregar_registro(caminho: Path = REGISTRO) -> dict:
    with open(caminho, "rb") as f:
        return tomllib.load(f)


# ---------------------------------------------------------------- planejamento

def dono_e_raiz(reg: dict, home: Path):
    """A área de espelhos do registro (`repositorio = "dono/*"`) diz o dono do
    GitHub e onde os clones moram."""
    for p in reg.get("projeto", []):
        if p["tipo"] == "espelho" and p["repositorio"].endswith("/*"):
            return p["repositorio"].split("/")[0], expandir(p["caminho"], home)
    return "romulosutil", home / "Mel/Repos"


def descobrir_repos(dono: str, ctx_rodar=rodar, cwd: Path = HOME) -> list:
    rc, saida, erro = ctx_rodar(
        ["gh", "repo", "list", dono, "--limit", "200", "--json",
         "name,isArchived,isFork,defaultBranchRef,diskUsage"], cwd=cwd, timeout=120)
    if rc != 0:
        raise ErroGitHub(ultima_linha(erro, saida) or f"gh saiu com {rc}")
    try:
        lista = json.loads(saida)
    except ValueError as e:
        raise ErroGitHub(f"resposta ilegível do gh: {e}")
    return lista


def planejar(reg: dict, home: Path, repos: list):
    """(alvos, avisos). Os alvos vêm do registro (clones vivos e pastas com
    grafo = true) e do GitHub (o resto, como espelho). Nada é criado aqui."""
    geral = reg.get("geral", {})
    projetos = reg.get("projeto", [])
    dono, raiz = dono_e_raiz(reg, home)
    limite_mb = geral.get("graphify_limite_repo_mb", LIMITE_REPO_MB_PADRAO)
    fora, alvos, avisos = set(), [], []
    for p in projetos:
        repo = p["repositorio"]
        if p["tipo"] == "clone-vivo":
            fora.add(repo)   # já tem pasta viva: não ganha espelho
        elif p["tipo"] == "espelho" and not repo.endswith("/*") and not p["grafo"]:
            fora.add(repo)   # o registro tirou do grafo
        if p["grafo"] and p["tipo"] in ("clone-vivo", "pasta"):
            alvos.append(Alvo(p["nome"], expandir(p["caminho"], home),
                              "viva" if p["tipo"] == "clone-vivo" else "pasta", repo))
    usados = {a.nome.lower() for a in alvos}
    for r in sorted(repos, key=lambda r: r["name"].lower()):
        completo = f"{dono}/{r['name']}"
        if r.get("isArchived") or r.get("isFork") or completo in fora:
            continue
        if not r.get("defaultBranchRef"):
            continue  # repositório vazio: não há o que clonar
        mb = round((r.get("diskUsage") or 0) / 1024)
        if mb > limite_mb:
            avisos.append(f"{r['name']}: {mb} MB, acima do limite de {limite_mb} MB; ficou fora do grafo "
                          f"(geral.graphify_limite_repo_mb no projetos.toml)")
            continue
        if r["name"].lower() in usados:
            avisos.append(f"{r['name']}: o nome colide com outro projeto do grafo; ficou de fora")
            continue
        usados.add(r["name"].lower())
        alvos.append(Alvo(r["name"], raiz / r["name"], "espelho", completo, r["defaultBranchRef"]["name"]))
    return alvos, avisos


# --------------------------------------------------------------------- espelhos

def excluir_graphify_out(pasta: Path) -> None:
    """graphify-out/ não é do repositório: fica fora do `git status` do espelho."""
    arq = pasta / ".git/info/exclude"
    arq.parent.mkdir(parents=True, exist_ok=True)
    atual = arq.read_text() if arq.exists() else ""
    if "graphify-out/" not in atual.splitlines():
        arq.write_text(atual + ("" if atual.endswith("\n") or not atual else "\n") + "graphify-out/\n")


def sincronizar_espelho(ctx: Contexto, a: Alvo):
    """Devolve (situação, mensagem, commit). situação: ok, vazio ou erro.
    Só mexe em pasta que ele mesmo clonou: se existe e não é o clone esperado,
    para sem tocar (nunca apaga)."""
    url = f"https://github.com/{a.repo}.git"
    pasta = a.pasta
    if (pasta / ".git").is_dir():
        rc, out, err = ctx.rodar(["git", "config", "--get", "remote.origin.url"], cwd=pasta, timeout=30)
        atual = out.strip()
        if rc != 0 or atual.rstrip("/").removesuffix(".git") != url.removesuffix(".git"):
            return "erro", f"o clone em {pasta} aponta para '{atual or '?'}', não para {url}; não mexi", ""
        rc, out, err = ctx.rodar(["git", "fetch", "-q", "--depth", "1", "origin", a.branch], cwd=pasta, timeout=TIMEOUT_FETCH_S)
        if rc != 0:
            return "erro", f"git fetch: {ultima_linha(err, out) or rc}", ""
        # reset --hard, nunca merge: o espelho é cópia de leitura. E nunca clean -x.
        rc, out, err = ctx.rodar(["git", "reset", "-q", "--hard", "FETCH_HEAD"], cwd=pasta, timeout=120)
        if rc != 0:
            return "erro", f"git reset: {ultima_linha(err, out) or rc}", ""
    else:
        if pasta.exists() and any(pasta.iterdir()):
            return "erro", f"{pasta} existe e não é um clone do Hermes; não mexi", ""
        pasta.parent.mkdir(parents=True, exist_ok=True)
        rc, out, err = ctx.rodar(["git", "clone", "-q", "--depth", "1", "--single-branch", "--branch", a.branch,
                                  url, str(pasta)], cwd=ctx.home, timeout=TIMEOUT_CLONE_S)
        if rc != 0:
            texto = (err + out).lower()
            if "empty repository" in texto or "remote branch" in texto and "not found" in texto:
                return "vazio", "repositório vazio", ""
            return "erro", f"git clone: {ultima_linha(err, out) or rc}", ""
    excluir_graphify_out(pasta)
    rc, out, err = ctx.rodar(["git", "rev-parse", "HEAD"], cwd=pasta, timeout=30)
    return "ok", "", out.strip() if rc == 0 else ""


def arquivos_alterados(ctx: Contexto, a: Alvo, antes: str, depois: str):
    """Arquivos de código que mudaram entre dois commits do espelho; None se o
    commit antigo não está mais no clone raso."""
    rc, out, err = ctx.rodar(["git", "diff", "--name-only", antes, depois], cwd=a.pasta, timeout=60)
    if rc != 0:
        return None
    return sorted(Path(l) for l in out.splitlines() if Path(l).suffix in CODIGO)


# ---------------------------------------------------------------------- grafos

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


def podar_snapshots(saida: Path) -> None:
    limite = datetime.now() - timedelta(days=DIAS_SNAPSHOT)
    for p in saida.glob("20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]"):
        try:
            if p.is_dir() and datetime.strptime(p.name, "%Y-%m-%d") < limite:
                shutil.rmtree(p, ignore_errors=True)  # retrato do graphify com mais de 7 dias: regenerável
        except ValueError:
            pass


def copiar_atomico(origem: Path, destino: Path) -> None:
    tmp = destino.with_name(destino.name + ".parcial")
    shutil.copy2(origem, tmp)
    tmp.replace(destino)


def exportar(ctx: Contexto, a: Alvo, saida: Path) -> None:
    """Cópia (não link) para o PC puxar por SSH, no layout <projeto>/graphify-out."""
    destino = ctx.grafos_dir / a.nome / "graphify-out"
    destino.mkdir(parents=True, exist_ok=True)
    for nome in EXPORTAR:
        if (saida / nome).exists():
            copiar_atomico(saida / nome, destino / nome)


def limpar_global(ctx: Contexto, projetos_vivos) -> None:
    """O grafo global é deste script: tira o que não é projeto do registro
    (ex.: um projeto apagado ou que saiu do grafo)."""
    rc, out, err = ctx.rodar([ctx.graphify, "global", "list"], cwd=ctx.home, timeout=60)
    if rc != 0:
        return
    for linha in (out + err).splitlines():
        m = re.match(r"\s+(\S+): \d+ nodes", linha)
        if m and m.group(1) not in projetos_vivos:
            ctx.rodar([ctx.graphify, "global", "remove", m.group(1)], cwd=ctx.home, timeout=60)


# ------------------------------------------------------------------ duplicatas

def carregar_verificador(caminho: Path):
    spec = importlib.util.spec_from_file_location("projetos_verificar", caminho)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def varrer_duplicatas(ctx: Contexto, reg: dict) -> list:
    """Avisos (texto), nunca ação. Barata: a validação do registro mais uma
    olhada nos .git até 3 níveis da home."""
    avisos = []
    try:
        pv = carregar_verificador(ctx.verificador)
        for nivel, msg in pv.validar(reg, ctx.home):
            # "a-criar que já existe" é lembrete de atualizar o registro, não duplicata.
            if "já existe; mude o estado" in msg:
                continue
            avisos.append(msg)
    except (OSError, SyntaxError, ImportError) as e:
        avisos.append(f"não consegui rodar o verificador do registro: {e}")
    congelados = [expandir(p["caminho"], ctx.home) for p in reg.get("projeto", []) if p["tipo"] == "congelado"]
    origens = {}
    base = ctx.home
    for raiz, pastas, _ in os.walk(base):
        prof = len(Path(raiz).relative_to(base).parts)
        pastas[:] = [p for p in pastas if not p.startswith(".") and p not in PULAR_NA_VARREDURA] if prof < 3 else []
        if (Path(raiz) / ".git").is_dir():  # worktree tem .git arquivo: fora de propósito
            pasta = Path(raiz)
            if any(pasta == c or c in pasta.parents for c in congelados):
                continue  # réplica congelada convive de propósito com o espelho
            rc, out, err = ctx.rodar(["git", "config", "--get", "remote.origin.url"], cwd=pasta, timeout=30)
            if rc == 0 and out.strip():
                m = re.search(r"github\.com[:/]+([^/]+/[^/]+?)(?:\.git)?/?$", re.sub(r"https?://[^@/]*@", "https://", out.strip()))
                if m:
                    origens.setdefault(m.group(1).lower(), []).append(pasta)
    for repo, pastas in sorted(origens.items()):
        if len(pastas) > 1:
            avisos.append(f"o repositório {repo} está em {len(pastas)} pastas: "
                          + ", ".join("~/" + str(p.relative_to(base)) for p in pastas))
    return avisos


def avisar_na_fila(ctx: Contexto, estado: dict, avisos: list, agora: float) -> None:
    """Só o que é NOVO vira mensagem (uma só, com todos os novos): o que já foi
    avisado não se repete toda noite. O que sumiu sai da lista, então se voltar
    conta como novo."""
    vistos = set(estado.get("avisos_vistos", []))
    novos = [a for a in avisos if a not in vistos]
    if novos:
        texto = "Conferi as pastas do Dell contra o registro de projetos e achei:\n" + "\n".join(f"• {a}" for a in novos) \
            + "\n\nNada foi mexido. Veja ~/PRUMO/PROJETOS.md; quem decide é você."
        aviso = {"titulo": "Mel: pastas fora do registro ou repetidas", "texto": texto, "origem": ORIGEM}
        # Valida, corta a lista longa com marca, grava atômico, não cria a pasta da fila e nunca
        # levanta. Não gravou (nem sem a lib): os avisos não contam como vistos e voltam amanhã.
        if not gravar_aviso(ctx.fila, aviso, "graphify-duplicatas"):
            return
    estado["avisos_vistos"] = sorted(avisos)


# --------------------------------------------------------------------- rodada

def executar(ctx: Contexto, nomes=()) -> str:
    """Uma rodada. Devolve o texto para o WhatsApp ('' = silêncio)."""
    ctx.estado_dir.mkdir(parents=True, exist_ok=True)
    with open(ctx.estado_dir / ".lock", "w") as trava:
        try:
            fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return ""  # outra rodada em andamento (noturna + manual juntas); ela cobre esta
        return rodada(ctx, set(nomes))


def rodada(ctx: Contexto, nomes: set) -> str:
    reg = ctx.registro
    falhas, mudancas = [], {}
    if not reg:
        try:
            reg = carregar_registro()
        except (OSError, ValueError) as e:
            return f"🧭 Operação — graphify\n\nNão li o registro de projetos ({REGISTRO}): {e}"
    dono, _ = dono_e_raiz(reg, ctx.home)
    descoberta_ok = True
    try:
        repos = descobrir_repos(dono, ctx.rodar, ctx.home)
    except ErroGitHub as e:
        repos, descoberta_ok = [], False
        falhas.append(f"GitHub ({dono}): {e}; os espelhos não foram atualizados nesta rodada")
    alvos, avisos_plano = planejar(reg, ctx.home, repos)
    if not descoberta_ok:
        alvos = [a for a in alvos if a.tipo != "espelho"]

    estado_p = ctx.estado_dir / "estado.json"
    estado = json.loads(estado_p.read_text()) if estado_p.exists() else {"projetos": {}}
    agora = time.time()
    inicio = time.monotonic()
    esgotou = False

    escolhidos = [a for a in alvos if not nomes or a.nome in nomes]
    for i, a in enumerate(escolhidos):
        if time.monotonic() - inicio > ctx.orcamento_s:
            resto = [x.nome for x in escolhidos[i:]]
            falhas.append(f"acabou o tempo da rodada ({ctx.orcamento_s // 60} min); faltam {len(resto)}: "
                          + ", ".join(resto[:8]) + ("…" if len(resto) > 8 else "") + " (continuam na próxima)")
            esgotou = True
            break
        processar(ctx, a, estado, agora, falhas, mudancas)

    completa = not nomes
    if completa:
        if descoberta_ok and not esgotou:
            vivos = {a.nome for a in alvos}
            # Sai do estado e do global o que não é mais projeto do registro.
            estado["projetos"] = {k: v for k, v in estado["projetos"].items() if k in vivos}
            limpar_global(ctx, vivos)
        avisos = list(avisos_plano) + varrer_duplicatas(ctx, reg)
        avisar_na_fila(ctx, estado, avisos, agora)
        falhas += verificar_global(ctx)
        estado["avisos"] = avisos

    estado["rodado_em"] = datetime.fromtimestamp(agora).isoformat(timespec="minutes")
    tmp = estado_p.with_suffix(".tmp")
    tmp.write_text(json.dumps(estado, ensure_ascii=False, indent=1))
    tmp.replace(estado_p)

    if mudancas:
        diario = ctx.estado_dir / "diario.jsonl"
        linhas = diario.read_text().splitlines() if diario.exists() else []
        corte = (datetime.fromtimestamp(agora) - timedelta(days=DIAS_DIARIO)).isoformat()
        linhas = [l for l in linhas if json.loads(l).get("em", "") >= corte]
        linhas.append(json.dumps({"em": estado["rodado_em"], "projetos": mudancas}, ensure_ascii=False))
        diario.write_text("\n".join(linhas[-MAX_LINHAS_DIARIO:]) + "\n")

    escrever_resumo(ctx, estado)
    exportar_global(ctx)

    if falhas:
        return ("🧭 Operação — graphify\n\nNão consegui atualizar o grafo de:\n"
                + "\n".join(f"• {f}" for f in falhas)
                + "\n\nO resto seguiu normalmente. Detalhe em ~/.local/share/graphify-hermes/estado.json.")
    return ""


def processar(ctx: Contexto, a: Alvo, estado: dict, agora: float, falhas: list, mudancas: dict) -> None:
    anterior = estado["projetos"].get(a.nome, {})
    if anterior.get("pasta") != str(a.pasta):
        anterior = {}  # mudou de lugar (ex.: até 28/09/2026 o nome era a cópia em ~/Pessoal-dev)
    info = dict(anterior, pasta=str(a.pasta), tipo=a.tipo)
    commit_novo = ""
    if a.tipo == "espelho":
        situacao, msg, commit_novo = sincronizar_espelho(ctx, a)
        if situacao == "vazio":
            info["vazio"] = True
            estado["projetos"][a.nome] = info
            return
        if situacao == "erro":
            falhas.append(f"{a.nome}: {msg}")
            info["erro"] = msg
            estado["projetos"][a.nome] = info
            return
        info.pop("vazio", None)
    elif not a.pasta.is_dir():
        falhas.append(f"{a.nome}: a pasta {a.pasta} não existe")
        return

    desde = anterior.get("verificado_em", agora - 86400)
    codigo = list(arquivos_de_codigo(a.pasta))
    if not codigo:
        info["arquivos_de_codigo"] = 0
        estado["projetos"][a.nome] = info
        return
    info.update(arquivos_de_codigo=len(codigo), verificado_em=agora)
    # Pelo arquivo mais recente, não pelo que mudou nesta rodada: projeto parado
    # também precisa dizer desde quando está parado.
    info["ultima_atividade"] = datetime.fromtimestamp(max(f.stat().st_mtime for f in codigo)).isoformat(timespec="minutes")

    saida = a.pasta / "graphify-out"
    grafo = saida / "graph.json"
    if a.tipo == "espelho":
        # Clone recém-feito tem todos os arquivos com a data de hoje: o que mudou
        # vem do commit, não da data do arquivo.
        antes = anterior.get("commit", "")
        mudou = bool(antes) and antes != commit_novo
        alterados = (arquivos_alterados(ctx, a, antes, commit_novo) or []) if mudou else []
        info["commit"] = commit_novo
        precisa = mudou or not grafo.exists() or not anterior.get("no_global")
    else:
        alterados = sorted((f for f in codigo if f.stat().st_mtime > desde),
                           key=lambda f: f.stat().st_mtime, reverse=True)
        precisa = bool(alterados) or not grafo.exists() or not anterior.get("no_global")
        alterados = [f.relative_to(a.pasta) for f in alterados]
        mudou = bool(alterados)

    # Sem mudança só pula se o grafo já foi medido e entrou no global; senão um
    # projeto parado nunca apareceria para o Hermes.
    if not precisa:
        estado["projetos"][a.nome] = info
        if not (ctx.grafos_dir / a.nome / "graphify-out/graph.json").exists() and grafo.exists():
            exportar(ctx, a, saida)
        return

    rc, log = 0, ""
    if mudou or not grafo.exists() or not anterior:
        try:
            rc, out, err = ctx.rodar([ctx.graphify, "update", str(a.pasta)], cwd=a.pasta)
            log = (out + err).strip()
        except subprocess.TimeoutExpired:
            rc, log = 124, f"passou de {TIMEOUT_S // 60} min"
    if rc != 0 or not grafo.exists():
        falhas.append(f"{a.nome}: {log.splitlines()[-1][:200] if log else f'saiu com {rc}'}")
        info["erro"] = log[-500:]
        info.pop("verificado_em", None)  # tenta de novo na próxima rodada
        estado["projetos"][a.nome] = info
        return

    tam = tamanho_do_grafo(grafo) or {}
    antes_g = anterior.get("grafo") or {}
    if "mb" in tam:
        rc_g, log_g = 0, ""  # grande demais para o global; consulta vai no grafo do projeto
    else:
        rc_g, out_g, err_g = ctx.rodar([ctx.graphify, "global", "add", str(grafo), "--as", a.nome], cwd=a.pasta, timeout=300)
        log_g = (out_g + err_g).strip()
    if rc_g != 0:
        falhas.append(f"{a.nome} (grafo global): {ultima_linha(log_g) or rc_g}")
    podar_snapshots(saida)
    exportar(ctx, a, saida)

    info.update(grafo=tam, atualizado_em=agora, erro=None, no_global=rc_g == 0)
    estado["projetos"][a.nome] = info
    if not alterados:
        return  # só entrou no global (ou é a primeira vez); não é atividade para o diário
    mudancas[a.nome] = {
        "arquivos": len(alterados),
        "exemplos": [str(f) for f in alterados[:EXEMPLOS_NO_DIARIO]],
        "nos": tam.get("nos"),
        "delta_nos": (tam.get("nos") or 0) - (antes_g.get("nos") or 0) if antes_g else None,
    }


def verificar_global(ctx: Contexto) -> list:
    g = ctx.home / ".graphify/global-graph.json"
    if g.exists() and g.stat().st_size / 1e6 > AVISO_GLOBAL_TOTAL_MB:
        return [f"o grafo global está com {round(g.stat().st_size / 1e6)} MB (limite de aviso {AVISO_GLOBAL_TOTAL_MB} MB): "
                "consultas do Hermes ficam lentas"]
    return []


def exportar_global(ctx: Contexto) -> None:
    """O que o PC puxa além dos grafos de cada projeto: o global, o RESUMO e um índice."""
    if not ctx.grafos_dir.exists():
        return
    g = ctx.home / ".graphify/global-graph.json"
    if g.exists():
        copiar_atomico(g, ctx.grafos_dir / "global-graph.json")
    r = ctx.estado_dir / "RESUMO.md"
    if r.exists():
        copiar_atomico(r, ctx.grafos_dir / "RESUMO.md")
    est = ctx.estado_dir / "estado.json"
    if est.exists():
        projetos = json.loads(est.read_text()).get("projetos", {})
        indice = {n: {"tipo": i.get("tipo"), "nos": (i.get("grafo") or {}).get("nos"),
                      "atualizado_em": datetime.fromtimestamp(i["atualizado_em"]).isoformat(timespec="minutes") if i.get("atualizado_em") else None}
                  for n, i in sorted(projetos.items()) if (ctx.grafos_dir / n).exists()}
        (ctx.grafos_dir / "indice.json").write_text(json.dumps(indice, ensure_ascii=False, indent=1) + "\n")


def escrever_resumo(ctx: Contexto, estado: dict) -> None:
    """Tabela curta que o Hermes lê para saber em que o Rômulo anda mexendo."""
    diario = ctx.estado_dir / "diario.jsonl"
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
        "Perguntas sobre um projeto: `graphify query \"<pergunta>\" --graph <pasta do projeto>/graphify-out/graph.json`",
        "(clones vivos em ~/<projeto>, espelhos do GitHub em ~/Mel/Repos/<projeto>).",
        "Entre projetos: `graphify query \"<pergunta>\" --graph ~/.graphify/global-graph.json`.",
        "Cópias para o PC puxar: ~/Mel/Grafos/<projeto>/graphify-out e ~/Mel/Grafos/global-graph.json.",
        "",
        "| Projeto | Última atividade | Arquivos mudados em 7 dias | Nós no grafo |",
        "|---|---|---|---|",
    ]
    ordem = sorted(((n, i) for n, i in estado["projetos"].items() if i.get("arquivos_de_codigo")),
                   key=lambda kv: kv[1].get("ultima_atividade") or "", reverse=True)
    for nome, info in ordem[:MAX_LINHAS_RESUMO]:
        g = info.get("grafo") or {}
        tamanho = g.get("nos", f"{g['mb']} MB, fora do global" if "mb" in g else "—")
        linhas.append(f"| {nome} | {info.get('ultima_atividade') or '—'} | {na_semana.get(nome, 0)} | "
                      f"{tamanho}{' ⚠️ erro' if info.get('erro') else ''} |")
    if len(ordem) > MAX_LINHAS_RESUMO:
        linhas.append(f"\n… e mais {len(ordem) - MAX_LINHAS_RESUMO} projetos (ver estado.json).")
    sem_codigo = sorted(n for n, i in estado["projetos"].items() if i.get("arquivos_de_codigo") == 0 and not i.get("vazio"))
    if sem_codigo:
        linhas += ["", "Sem código para o grafo (só texto ou dados): " + ", ".join(sem_codigo[:30]) + "."]
    (ctx.estado_dir / "RESUMO.md").write_text("\n".join(linhas) + "\n")


def mostrar_plano(ctx: Contexto) -> int:
    reg = ctx.registro or carregar_registro()
    dono, raiz = dono_e_raiz(reg, ctx.home)
    try:
        repos = descobrir_repos(dono, ctx.rodar, ctx.home)
    except ErroGitHub as e:
        print(f"GitHub ({dono}) não respondeu: {e}")
        return 1
    alvos, avisos = planejar(reg, ctx.home, repos)
    por_tipo = {}
    for a in alvos:
        por_tipo.setdefault(a.tipo, []).append(a)
    print(f"{len(repos)} repositórios no GitHub ({dono}); espelhos em {raiz}")
    for tipo, titulo in (("viva", "clones vivos"), ("pasta", "pastas sem Git"), ("espelho", "espelhos (clone raso)")):
        print(f"\n{titulo}: {len(por_tipo.get(tipo, []))}")
        for a in por_tipo.get(tipo, []):
            marca = "" if a.pasta.exists() else "  (a criar)"
            print(f"  {a.nome:<28} {str(a.pasta).replace(str(ctx.home), '~'):<44}{marca}")
    if avisos:
        print("\navisos:")
        for av in avisos:
            print(f"  {av}")
    return 0


# ------------------------------------------------------- falha na fila de avisos

class Interrompido(BaseException):
    """SIGTERM no meio da rodada (o TimeoutStartSec do service, ou um `stop`).
    BaseException, como o KeyboardInterrupt: atravessa os `except Exception` do
    caminho e chega ao de topo, que avisa. O subprocess em andamento é morto
    pelo próprio subprocess.run ao ver a exceção."""


def _interromper(signum, _frame):
    raise Interrompido(signal.Signals(signum).name)


def titulo_e_texto(mensagem: str, titulo_padrao: str = TITULO_FALHA) -> tuple[str, str]:
    """A primeira linha da mensagem vira o título quando cabe e sobra texto. O
    dell-status entrega "titulo\\ntexto": chega o que o job antigo imprimia, só
    sem a linha em branco depois do título."""
    primeira, _, resto = mensagem.strip().partition("\n")
    if resto.strip() and len(primeira.strip()) <= 120:
        return primeira.strip(), resto.strip()
    return titulo_padrao, mensagem.strip()


def proxima_rodada(agora: datetime) -> datetime:
    """As 03:00 seguintes: a falha que não saiu até lá perde a vez para a nova."""
    hoje = agora.replace(hour=HORA_DA_RODADA, minute=0, second=0, microsecond=0)
    return hoje if agora < hoje else hoje + timedelta(days=1)


def aviso_de_falha(mensagem: str, agora: datetime) -> dict:
    titulo, texto = titulo_e_texto(mensagem)
    return {"titulo": titulo, "texto": texto, "origem": ORIGEM,
            # Uma por dia: a rodada manual que falha de novo no mesmo dia não repete.
            "chave": f"graphify:falha:{agora:%Y-%m-%d}", "prioridade": 2,
            "expira_em": proxima_rodada(agora).isoformat(timespec="seconds")}


def gravar_aviso(fila: Path, aviso: dict, prefixo: str) -> bool:
    """Pela lib (valida, corta com marca o texto longo, grava atômico). Sem a lib nada é gravado: uma
    linha no stderr e False (a rodada sai 1 e o texto fica no journal)."""
    lib = lib_de_aviso()
    if lib is None:
        print(f"lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: {aviso['titulo']}", file=sys.stderr, flush=True)
        return False
    if lib.VALOR_EM_REAIS.search(aviso["texto"]):
        # O texto leva mensagens de erro de fora; "R$" faria a lib recusar o aviso inteiro.
        aviso = dict(aviso, texto=lib.sem_valores(aviso["texto"]))
    return lib.gravar(aviso, fila=fila, prefixo=prefixo).gravado


def rodar_pela_fila(ctx: Contexto, nomes=(), agora: Callable[[], datetime] = lambda: datetime.now().astimezone()) -> int:
    """A rodada do service: a falha vai para a fila; o stdout é log. 0 = rodada
    inteira (mesmo com falha de algum projeto, que já foi avisada); 1 = a rodada
    caiu, foi interrompida ou o aviso não chegou à fila (a unit fica `failed`)."""
    anterior = signal.signal(signal.SIGTERM, _interromper)
    codigo = 0
    try:
        texto = executar(ctx, nomes)
    except Interrompido as e:
        codigo = 1
        texto = (f"{TITULO_FALHA}\n\nA rodada foi interrompida ({e}): passou de 1 h ou o serviço foi parado. "
                 "O que já tinha sido feito ficou; o resto vai na próxima rodada. "
                 "Detalhe: journalctl --user -u graphify-projetos.")
    except Exception as e:  # noqa: BLE001 — era o failure_deliver do Hermes: o erro tem de chegar
        codigo = 1
        traceback.print_exc()
        texto = (f"{TITULO_FALHA}\n\nA rodada caiu com erro: {type(e).__name__}: {str(e)[:300]}\n\n"
                 "Detalhe: journalctl --user -u graphify-projetos.")
    finally:
        signal.signal(signal.SIGTERM, anterior)
    if not texto:
        print("graphify: rodada sem falha; nada para avisar", flush=True)
        return codigo
    print(texto, flush=True)
    if not gravar_aviso(ctx.fila, aviso_de_falha(texto, agora()), "graphify-falha"):
        print("graphify: o aviso da falha NÃO foi para a fila (motivo acima)", file=sys.stderr, flush=True)
        return 1
    print("graphify: aviso da falha gravado na fila", flush=True)
    return codigo


def main(argv=None, ctx: Contexto | None = None) -> int:
    args = sys.argv[1:] if argv is None else list(argv)
    try:
        os.nice(10)  # a rodada é de madrugada, mas a primeira (manual) não pode atrapalhar o resto
    except OSError:
        pass
    ctx = ctx or Contexto()
    if "--planejar" in args:
        return mostrar_plano(ctx)
    nomes = [a for a in args if not a.startswith("--")]
    if "--fila" in args:
        return rodar_pela_fila(ctx, nomes)
    texto = executar(ctx, nomes)
    if texto:
        print(texto)
    return 0


if __name__ == "__main__":
    sys.exit(main())
