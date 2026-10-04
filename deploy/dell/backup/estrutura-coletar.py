#!/usr/bin/env python3
"""Coleta o mapa e as configurações da Mel para a pasta Estrutura do Drive.

A Estrutura é o destino final de tudo que descreve a operação (decisão de
04/10/2026): o Rômulo a lê pelo PC e a Mel só a mantém em dia. Este script
monta a área de preparo, ~/.local/share/mel/estrutura/{dell,pc}, que o bloco
`estrutura` do backup-dell espelha para o Drive (remote gdrive-estrutura).

Só entra o que está numa LISTA DE PERMISSÃO, escrita aqui; nada é varrido.
Nunca entram: .env, auth.json, rclone.conf, chaves privadas, ~/.ssh (só o que
o PC manda), bancos, sessão do WhatsApp.

Segredo é a parte séria. Cada arquivo passa por um filtro antes de ir para a
área de preparo:

- estrito (configs, compose, units, saída de comandos): `CHAVE=valor`,
  `senha: valor`, `"password": "valor"`, URL com senha, Authorization/Bearer,
  prefixos conhecidos (ghp_, sk-, AKIA, JWT...) e cadeias de alta entropia
  viram `<oculto>`. Chave privada (PEM, OpenSSH, AGE-SECRET-KEY) exclui o
  arquivo inteiro.
- docs (Markdown nosso): só os padrões inequívocos, para a prosa ("token",
  "PasswordAuthentication no") não ser mutilada.
- n8n: o fluxo com qualquer padrão de segredo é EXCLUÍDO e listado, nunca
  redigido (um fluxo remendado seria um fluxo diferente).

E uma prova que não depende das regras: os valores de verdade (dos .env, do
rclone.conf e do que foi redigido nesta rodada) são carregados em memória, e o
job FALHA se qualquer um aparecer no que vai para o Drive. O relatório
(dell/COLETA.md) lista arquivos e regras, nunca valores.

Falhou: a área de preparo anterior fica como está e o backup-dell não
sincroniza (o Drive velho vale mais que um espelho pela metade).

Uso:
  estrutura-coletar            monta a área de preparo
  estrutura-coletar --seco     faz tudo em memória e só imprime o relatório
  estrutura-coletar --raiz DIR monta em outra pasta (testes)
"""
import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import tomllib
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

HOME = Path.home()
RAIZ = HOME / ".local/share/mel/estrutura"
REGISTRO = HOME / "SquadOne/deploy/hermes/projetos.toml"
OCULTO = "<oculto>"
MAX_PC_BYTES = 2_000_000
SENTINELA = "MANIFESTO.md"   # dell/MANIFESTO.md: sem ele o backup-dell não sincroniza

# --------------------------------------------------------------------- filtro

# (?![a-z]): a palavra tem de acabar ali. "credentials", "maxOutputTokens" e "passo"
# (etapa, em português) não são credential, token nem pass.
_PALAVRAS = r"(?:pass(?:word|wd)?|senha|secret|token|api[_-]?key|private[_-]?key|credential|encryption[_-]?key|auth[_-]?key|access[_-]?key|client[_-]?secret)(?![a-z])"
RE_CHAVE_VALOR = re.compile(
    rf"""(?ix)
    (?P<chave>[\w.\-]*{_PALAVRAS}[\w.\-]*)      # nome com uma palavra de segredo
    (?P<sep>["']?\s*[:=]\s*)
    (?P<aspas>["']?)
    (?P<valor>[^\s"',}}#]+)
    """)
RE_FLAG = re.compile(r"(?i)(--?(?:requirepass|password|passwd|secret|token|api-key)[ =])(?!<oculto>)(\S+)")
RE_URL = re.compile(r"(?P<pre>\b[a-z][a-z0-9+.\-]*://[^\s:/@'\"<]+:)(?P<senha>[^\s@/'\"<]+)(?P<pos>@)")
RE_BEARER = re.compile(r"(?i)\b((?:bearer|basic)\s+)([A-Za-z0-9._~+/=\-]{12,})")
RE_PADRAO_COM_DEFAULT = re.compile(r"\$\{[A-Za-z_][A-Za-z0-9_]*:-(?P<padrao>[^}]+)\}")   # só a forma do compose: ${VAR:-padrão}
PREFIXOS = [
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}"),   # JWT
]
RE_EXCLUIR = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|AGE-SECRET-KEY-1[0-9A-Z]{20,}|PuTTY-User-Key-File")
# O "=" só vale no fim (padding do base64): no meio ele separa CHAVE=/caminho, que não é segredo.
RE_LONGO = re.compile(r"(?<![A-Za-z0-9+/_\-=])[A-Za-z0-9+/_\-]{32,}={0,2}(?![A-Za-z0-9+/_\-=])")
VALORES_NEUTROS = {"true", "false", "null", "none", "yes", "no", "on", "off", "~", ""}


def _entropia(s: str) -> float:
    return -sum(n / len(s) * math.log2(n / len(s)) for n in Counter(s).values())


def _parece_caminho(v: str) -> bool:
    return bool(re.fullmatch(r"~?/[\w.\-/]*", v)) or v.endswith((".env", ".txt", ".conf", ".toml", ".json"))


META = re.compile(r"(?i)(?:^|[_\-.])(?:type|name|id|url|uri|path|file|ref|label|mode|scope|endpoint|host|source|prefix|header|enabled|required)$|[a-z](?:Type|Name|Id|Url|Uri|Path|File|Ref|Label|Mode|Scope|Endpoint|Host|Source|Prefix|Header|Enabled|Required)$")
LIMITES = re.compile(r"(?i)max|min|count|limit|ttl|expir|lifetime|timeout|size|length")


def _valor_inofensivo(chave: str, valor: str) -> bool:
    v = valor.strip("\"'")
    # "=" é a expressão do n8n (={{ $env.X }}); { [ ( abrem objeto, lista ou chamada: referência, não valor.
    return (v.lower() in VALORES_NEUTROS or v.startswith(("$", "<", "{", "[", "(", "=")) or _parece_caminho(v)
            or not re.search(r"[A-Za-z0-9]", v)                  # "..." ou "***": nada a esconder
            or chave.lower().endswith(("_file", "-file")) or OCULTO in v
            or bool(META.search(chave))                          # tokenUrl, secretName, credentialType: metadado do segredo
            or (v.isdigit() and bool(LIMITES.search(chave))))    # maxTokens: 8192


def redigir(texto: str, modo: str = "estrito"):
    """(texto novo, contagem por regra, excluir). Nunca devolve nem imprime valor."""
    if RE_EXCLUIR.search(texto):
        return None, Counter({"chave-privada": 1}), True
    regras, valores = Counter(), []

    def sub(regex, grupo, nome, texto_, guarda=None):
        def troca(m):
            v = m.group(grupo)
            if guarda and guarda(m):
                return m.group(0)
            regras[nome] += 1
            valores.append(v)
            ini, fim = m.span(grupo)
            base = m.start()
            return m.group(0)[: ini - base] + OCULTO + m.group(0)[fim - base:]
        return regex.sub(troca, texto_)

    t = texto
    for p in PREFIXOS:
        t = sub(p, 0, "prefixo-conhecido", t)
    t = sub(RE_URL, "senha", "url-com-senha", t, guarda=lambda m: m.group("senha") == OCULTO or m.group("senha").startswith("$"))
    t = sub(RE_BEARER, 2, "bearer", t, guarda=lambda m: m.group(2) == OCULTO)
    if modo != "docs":
        t = sub(RE_CHAVE_VALOR, "valor", "chave-valor", t,
                guarda=lambda m: _valor_inofensivo(m.group("chave"), m.group("valor")))
    if modo == "estrito":
        t = sub(RE_PADRAO_COM_DEFAULT, "padrao", "padrao-literal", t, guarda=lambda m: m.group("padrao") == OCULTO or _parece_caminho(m.group("padrao")))
        t = sub(RE_FLAG, 2, "flag-de-senha", t, guarda=lambda m: m.group(2).startswith(("$", "<")))

        # Entropia só no modo estrito: num fluxo do n8n pegaria ID de planilha do Google e pedaço
        # de URL. Lá o que protege são as regras inequívocas e a prova com os valores de verdade.
        def longo(m):
            s = m.group(0)
            if re.fullmatch(r"[0-9a-fA-F\-]+", s) or _parece_caminho(s) or sum(map(bool, (re.search("[a-z]", s), re.search("[A-Z]", s), re.search("[0-9]", s)))) < 2:
                return s
            if _entropia(s) < 4.3:
                return s
            regras["alta-entropia"] += 1
            valores.append(s)
            return OCULTO
        t = RE_LONGO.sub(longo, t)
    sub_valores.extend(valores)
    return t, regras, False


sub_valores: list = []   # tudo que foi redigido nesta rodada: entra na prova final


def valores_conhecidos(home: Path) -> set:
    """Valores de verdade que NUNCA podem aparecer no que vai para o Drive: dos
    .env, do rclone.conf e do auth.json do Hermes. Só em memória."""
    achados = set()

    def guardar(v: str, minimo: int = 10):
        v = v.strip().strip("\"'")
        if len(v) >= minimo and not v.lower() in VALORES_NEUTROS and not _parece_caminho(v) and not v.startswith(("$", "<", "http://127", "http://localhost")):
            achados.add(v)

    arquivos = [home / ".hermes/.env", home / "licitacoes-automation/.env", home / "SquadOne/.env",
                home / "prumo-automation/.env", home / "workspace/moneyprinterturbo/.env"]
    arquivos += sorted((home / "workspace/infra-docker").glob("*/.env"))
    for p in arquivos:
        try:
            for linha in p.read_text(encoding="utf-8", errors="replace").splitlines():
                m = re.match(r"\s*(?:export\s+)?([\w.\-]+)\s*=\s*(.+)", linha)
                if not m:
                    continue
                if re.search(_PALAVRAS, m.group(1), re.I):
                    guardar(m.group(2))
                else:
                    # Chave sem cara de segredo (ex.: WHATSAPP_HOME_CHANNEL, o id do chat do Rômulo):
                    # nada de .env vai para o Drive, então a prova confere todos os valores. Mais
                    # exigente (12) e sem URL pura, que aparece de propósito nos documentos.
                    v = m.group(2).strip().strip("\"'")
                    if not re.fullmatch(r"https?://[^@\s]*", v):
                        guardar(v, 12)
        except OSError:
            continue
    try:
        for linha in (home / ".config/rclone/rclone.conf").read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"\s*(client_secret|token|refresh_token|access_token)\s*=\s*(.+)", linha)
            if m:
                if m.group(1) == "token":
                    try:
                        for k, v in json.loads(m.group(2)).items():
                            if isinstance(v, str) and k in ("access_token", "refresh_token"):
                                guardar(v, 16)
                    except ValueError:
                        pass
                else:
                    guardar(m.group(2), 16)
    except OSError:
        pass
    try:
        def percorre(o):
            if isinstance(o, dict):
                for k, v in o.items():
                    if isinstance(v, str) and re.search(_PALAVRAS, k, re.I):
                        guardar(v, 16)
                    else:
                        percorre(v)
            elif isinstance(o, list):
                for v in o:
                    percorre(v)
        percorre(json.loads((home / ".hermes/auth.json").read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    return achados


# -------------------------------------------------------------------- contexto

def rodar(args, timeout=120, cwd=None):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        return r.returncode, r.stdout, r.stderr
    except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError) as e:
        return 127, "", f"{type(e).__name__}: {e}"


@dataclass
class Item:
    destino: str        # relativo a dell/ ou pc/ ("dell/compose/aladdin.yml")
    texto: str
    modo: str           # estrito | docs | n8n
    origem: str


@dataclass
class Contexto:
    home: Path = HOME
    raiz: Path = RAIZ
    registro: Path = REGISTRO
    rodar: Callable = rodar
    agora: Callable = datetime.now


@dataclass
class Relatorio:
    redigidos: dict = field(default_factory=dict)    # destino -> {regra: n}
    excluidos: dict = field(default_factory=dict)    # destino -> motivo
    ausentes: list = field(default_factory=list)
    avisos: list = field(default_factory=list)
    escritos: int = 0
    conhecidos: int = 0


def ler(p: Path):
    try:
        return p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


# --------------------------------------------------------------------- fontes

def fonte_docs(ctx: Contexto, rel: Relatorio):
    h, itens = ctx.home, []
    for nome in ("MANIFESTO.md", "LEIA-ME.md", "PROJETOS.md", "SILMER.md", "PC-COMECAR.md", "PROMPT-MEL.md"):
        t = ler(h / "PRUMO" / nome)
        if t is None:
            rel.ausentes.append(f"~/PRUMO/{nome}")
        else:
            itens.append(Item(f"dell/{nome}", t, "docs", f"~/PRUMO/{nome}"))
    t = ler(h / "AGENTS.md")
    if t is None:
        rel.ausentes.append("~/AGENTS.md")
    else:
        itens.append(Item("dell/AGENTS.md", t, "docs", "~/AGENTS.md"))
    for nome in ("mel-progresso.md", "relatorio-saida-do-dell.md"):
        for p in sorted((h / "Arquivo").glob(f"*/{nome}")):
            t = ler(p)
            if t is not None:
                itens.append(Item(f"dell/arquivo/{p.parent.name}/{nome}", t, "docs", f"~/Arquivo/{p.parent.name}/{nome}"))
    return itens


def fonte_systemd(ctx: Contexto, rel: Relatorio):
    itens = []
    for p in sorted((ctx.home / ".config/systemd/user").glob("*")):
        if p.is_file() and p.suffix in (".service", ".timer", ".path", ".socket") and ".bak" not in p.name:
            t = ler(p)
            if t is not None:
                itens.append(Item(f"dell/systemd-user/{p.name}", t, "estrito", f"~/.config/systemd/user/{p.name}"))
    fontes = ler(ctx.home / ".config/backup-dell/fontes.toml")
    if fontes is None:
        rel.ausentes.append("~/.config/backup-dell/fontes.toml")
    else:
        itens.append(Item("dell/backup-dell/fontes.toml", fontes, "estrito", "~/.config/backup-dell/fontes.toml"))
    return itens


def fonte_compose(ctx: Contexto, rel: Relatorio):
    h = ctx.home
    achados = sorted((h / "workspace/infra-docker").glob("*/docker-compose.yml"))
    achados += [h / "workspace/moneyprinterturbo/docker-compose.yml", h / "licitacoes-automation/docker-compose.yml"]
    itens = []
    for p in achados:
        t = ler(p)
        if t is None:
            rel.ausentes.append(str(p).replace(str(h), "~"))
        else:
            itens.append(Item(f"dell/compose/{p.parent.name}.yml", t, "estrito", str(p).replace(str(h), "~")))
    return itens


ESTADO = [
    ("tailscale-status.txt", ["tailscale", "status"]),
    ("tailscale-serve.txt", ["tailscale", "serve", "status"]),
    ("docker-ps.txt", ["docker", "ps", "--format", "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"]),
    ("ufw.txt", ["sudo", "-n", "ufw", "status", "numbered"]),
    ("timers-do-usuario.txt", ["systemctl", "--user", "list-timers", "--all", "--no-pager"]),
    ("pacotes-instalados-a-mao.txt", ["apt-mark", "showmanual"]),
]


def fonte_estado(ctx: Contexto, rel: Relatorio):
    itens = []
    for nome, cmd in ESTADO:
        rc, out, err = ctx.rodar(cmd, timeout=60)
        if rc != 0 or not out.strip():
            rel.avisos.append(f"{nome}: comando falhou (rc={rc}): {(err or out).strip().splitlines()[-1][:100] if (err or out).strip() else 'sem saída'}")
            continue
        itens.append(Item(f"dell/estado/{nome}", out, "estrito", " ".join(cmd[:3])))
    return itens


def fonte_repos(ctx: Contexto, rel: Relatorio):
    itens, linhas = [], ["# Repositórios e clones vivos da Mel", f"Gerado em {ctx.agora():%d/%m/%Y %H:%M}.", ""]
    try:
        reg = tomllib.loads(ler(ctx.registro) or "")
    except ValueError:
        reg = {}
    dono = next((p["repositorio"].split("/")[0] for p in reg.get("projeto", []) if p["repositorio"].endswith("/*")), "romulosutil")
    rc, out, err = ctx.rodar(["gh", "repo", "list", dono, "--limit", "200", "--json",
                              "name,visibility,isArchived,isFork,pushedAt,diskUsage"], timeout=120)
    if rc == 0:
        try:
            repos = sorted(json.loads(out), key=lambda r: r["name"].lower())
            linhas += [f"## GitHub ({dono}): {len(repos)} repositórios", "", "| Repositório | Visibilidade | Último push | MB | Obs |", "|---|---|---|---|---|"]
            for r in repos:
                obs = ", ".join(x for x, f in (("arquivado", r["isArchived"]), ("fork", r["isFork"])) if f)
                linhas.append(f"| {r['name']} | {r['visibility'].lower()} | {r['pushedAt'][:10]} | {round(r['diskUsage'] / 1024)} | {obs} |")
        except (ValueError, KeyError):
            rel.avisos.append("gh repo list: resposta ilegível")
    else:
        rel.avisos.append(f"gh repo list falhou (rc={rc})")
    linhas += ["", "## Clones vivos (branch, origin, arquivos sujos)", ""]
    for p in reg.get("projeto", []):
        if p["tipo"] != "clone-vivo":
            continue
        pasta = ctx.home / p["caminho"][2:]
        rc_b, ramo, _ = ctx.rodar(["git", "-C", str(pasta), "rev-parse", "--abbrev-ref", "HEAD"], timeout=30)
        rc_r, remoto, _ = ctx.rodar(["git", "-C", str(pasta), "remote", "-v"], timeout=30)
        rc_s, sujos, _ = ctx.rodar(["git", "-C", str(pasta), "status", "--porcelain"], timeout=30)
        linhas.append(f"- **{p['nome']}** (`{p['caminho']}`): branch `{ramo.strip() if rc_b == 0 else '?'}`, "
                      f"{len(sujos.splitlines()) if rc_s == 0 else '?'} arquivo(s) sujo(s)")
        for l in (remoto.splitlines() if rc_r == 0 else []):
            linhas.append(f"  - `{l.strip()}`")
    itens.append(Item("dell/repos.md", "\n".join(linhas) + "\n", "estrito", "gh repo list + git remote -v"))
    return itens


def fonte_hermes_cron(ctx: Contexto, rel: Relatorio):
    t = ler(ctx.home / ".hermes/cron/jobs.json")
    if t is None:
        rel.ausentes.append("~/.hermes/cron/jobs.json")
        return []
    try:
        jobs = json.loads(t)["jobs"]
    except (ValueError, KeyError):
        rel.avisos.append("jobs.json do Hermes ilegível")
        return []
    linhas = ["# Rotinas do Hermes (só nome, agenda e script: os prompts ficam de fora)", "",
              "| Nome | Agenda | Script | Ativa | Entrega |", "|---|---|---|---|---|"]
    for j in jobs:
        agenda = j.get("schedule_display") or (j.get("schedule") or {}).get("display") or ""
        # "whatsapp:<id do chat>@lid": o id é do Rômulo (e igual ao WHATSAPP_HOME_CHANNEL do .env do
        # Hermes), não é para o Drive. Só a plataforma.
        entrega = (j.get("deliver") or "").split(":", 1)[0]
        linhas.append(f"| {j.get('name', '?')} | {agenda} | {j.get('script') or '(com agente)'} | "
                      f"{'sim' if j.get('enabled') else 'não'} | {entrega} |")
    return [Item("dell/hermes-cron.md", "\n".join(linhas) + "\n", "estrito", "~/.hermes/cron/jobs.json (campos escolhidos)")]


def fonte_n8n(ctx: Contexto, rel: Relatorio):
    compose = str(ctx.home / "licitacoes-automation/docker-compose.yml")
    rc, out, err = ctx.rodar(["docker", "compose", "-f", compose, "exec", "-T", "n8n", "n8n", "export:workflow", "--all"], timeout=300)
    if rc != 0:
        rel.avisos.append(f"n8n export:workflow falhou (rc={rc}): {(err.strip().splitlines() or ['sem saída'])[-1][:100]}")
        return []
    i = out.find("[{")
    try:
        fluxos = json.JSONDecoder().raw_decode(out[i:])[0] if i >= 0 else []
    except ValueError:
        rel.avisos.append("n8n export:workflow: saída que não é JSON")
        return []
    itens = []
    for w in fluxos:
        slug = re.sub(r"[^a-z0-9]+", "-", str(w.get("name", "sem-nome")).lower()).strip("-")[:50] or "fluxo"
        itens.append(Item(f"dell/n8n/{slug}-{w.get('id', 'x')}.json", json.dumps(w, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
                          "n8n", f"n8n: {w.get('name', '?')}"))
    return itens


NEGADOS_NO_PC = re.compile(r"(^id_(?!.*\.pub$))|\.pem$|\.key$|known_hosts|^\.env|\.kdbx$|^key\.txt$|\.pfx$|\.p12$", re.I)


def fonte_pc(ctx: Contexto, rel: Relatorio):
    base = ctx.raiz / "pc-incoming/latest"
    if not base.is_dir():
        return []
    itens = []
    for p in sorted(base.rglob("*")):
        if not p.is_file():
            continue
        rel_p = p.relative_to(base).as_posix()
        if NEGADOS_NO_PC.search(p.name):
            rel.excluidos[f"pc/{rel_p}"] = "nome de arquivo sensível: o PC não devia ter mandado"
            continue
        if p.stat().st_size > MAX_PC_BYTES:
            rel.excluidos[f"pc/{rel_p}"] = "grande demais"
            continue
        t = ler(p)
        if t is None:
            rel.excluidos[f"pc/{rel_p}"] = "não é texto"
            continue
        itens.append(Item(f"pc/{rel_p}", t, "estrito", f"pc-incoming/latest/{rel_p}"))
    return itens


FONTES = [fonte_docs, fonte_systemd, fonte_compose, fonte_estado, fonte_repos, fonte_hermes_cron, fonte_n8n, fonte_pc]


# ------------------------------------------------------------------ montagem

class Vazamento(Exception):
    pass


def tratar(it: Item, rel: Relatorio):
    """Texto final do item, ou None se foi excluído."""
    novo, regras, excluir = redigir(it.texto, it.modo)
    if excluir:
        rel.excluidos[it.destino] = "chave privada no conteúdo"
        return None
    if it.modo == "n8n" and regras:
        rel.excluidos[it.destino] = "fluxo com padrão de segredo (" + ", ".join(sorted(regras)) + "): excluído, não remendado"
        return None
    if regras:
        rel.redigidos[it.destino] = dict(regras)
    return novo


def prova_final(finais: dict, conhecidos: set, rel: Relatorio) -> list:
    """Nenhum valor conhecido pode estar no que vai para o Drive."""
    vazou = []
    for destino, texto in finais.items():
        for v in conhecidos:
            if v in texto:
                vazou.append(destino)
                break
        else:
            if RE_EXCLUIR.search(texto) or any(p.search(texto) for p in PREFIXOS):
                vazou.append(destino)
    return vazou


def relatorio_md(ctx: Contexto, rel: Relatorio, destinos: list) -> str:
    l = ["# Coleta da Estrutura (gerado por estrutura-coletar)", "",
         f"Gerado em {ctx.agora():%d/%m/%Y %H:%M}. **{len(destinos)} arquivos** nesta coleta.",
         f"Prova contra vazamento: {rel.conhecidos} valores conhecidos de segredo conferidos; nenhum apareceu aqui.", "",
         "Nunca entram: `.env`, `auth.json`, `rclone.conf`, chaves privadas, bancos, sessão do WhatsApp. "
         "Este relatório lista arquivos e regras, nunca valores.", ""]
    if rel.redigidos:
        l += ["## Valores trocados por `<oculto>`", ""] + [f"- `{d}`: " + ", ".join(f"{r} ×{n}" for r, n in sorted(c.items())) for d, c in sorted(rel.redigidos.items())] + [""]
    if rel.excluidos:
        l += ["## Arquivos que ficaram de fora", ""] + [f"- `{d}`: {m}" for d, m in sorted(rel.excluidos.items())] + [""]
    if rel.ausentes:
        l += ["## Fontes que não existem", ""] + [f"- {a}" for a in rel.ausentes] + [""]
    if rel.avisos:
        l += ["## Avisos", ""] + [f"- {a}" for a in rel.avisos] + [""]
    return "\n".join(l)


def coletar(ctx: Contexto, escrever: bool = True):
    """(relatório, destinos). Levanta Vazamento ou RuntimeError sem tocar na área de preparo."""
    sub_valores.clear()
    rel = Relatorio()
    itens = []
    for fonte in FONTES:
        try:
            itens += fonte(ctx, rel)
        except Exception as e:  # noqa: BLE001 — uma fonte ruim não derruba as outras
            rel.avisos.append(f"{fonte.__name__}: {type(e).__name__}: {str(e)[:100]}")
    finais = {}
    for it in itens:
        texto = tratar(it, rel)
        if texto is not None:
            finais[it.destino] = texto
    if f"dell/{SENTINELA}" not in finais:
        raise RuntimeError(f"faltou dell/{SENTINELA}: sem ele o backup-dell não sincroniza (e a coleta seria só um pedaço)")
    # Valor curto ("root") apareceria em qualquer prosa: na prova só entra o que é longo o bastante
    # para ser inconfundível. Os curtos já foram trocados pelas regras de chave=valor.
    conhecidos = valores_conhecidos(ctx.home) | {v for v in sub_valores if len(v) >= 12}
    rel.conhecidos = len(conhecidos)
    finais["dell/COLETA.md"] = relatorio_md(ctx, rel, sorted(finais) + ["dell/COLETA.md"])
    vazou = prova_final(finais, conhecidos, rel)
    if vazou:
        raise Vazamento("valor conhecido ou padrão de segredo em: " + ", ".join(sorted(set(vazou))))
    rel.escritos = len(finais)
    if escrever:
        novo = ctx.raiz / ".novo"
        if novo.exists():
            shutil.rmtree(novo)
        for destino, texto in finais.items():
            p = novo / destino
            p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            p.write_text(texto, encoding="utf-8")
            p.chmod(0o600)
        for d in novo.rglob("*"):
            if d.is_dir():
                d.chmod(0o700)
        novo.chmod(0o700)
        for sub in ("dell", "pc"):
            if not (novo / sub).exists():
                continue   # sem pc-incoming/latest, o pc/ que já estava continua
            if (ctx.raiz / sub).exists():
                shutil.rmtree(ctx.raiz / sub)
            (novo / sub).rename(ctx.raiz / sub)
        shutil.rmtree(novo, ignore_errors=True)
    return rel, sorted(finais)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--seco", action="store_true", help="faz tudo em memória e só imprime o relatório")
    ap.add_argument("--raiz", type=Path, default=RAIZ)
    a = ap.parse_args()
    ctx = Contexto(raiz=a.raiz)
    ctx.raiz.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        rel, destinos = coletar(ctx, escrever=not a.seco)
    except (Vazamento, RuntimeError) as e:
        print(f"FALHOU: {e}", file=sys.stderr)
        return 1
    print(f"{'(seco) ' if a.seco else ''}{rel.escritos} arquivos | {sum(sum(c.values()) for c in rel.redigidos.values())} valores ocultados em "
          f"{len(rel.redigidos)} arquivos | {len(rel.excluidos)} excluídos | {rel.conhecidos} valores conhecidos conferidos")
    for d, c in sorted(rel.redigidos.items()):
        print(f"  oculto   {d}: " + ", ".join(f"{r} x{n}" for r, n in sorted(c.items())))
    for d, m in sorted(rel.excluidos.items()):
        print(f"  excluído {d}: {m}")
    for av in rel.avisos:
        print(f"  aviso    {av}")
    for au in rel.ausentes:
        print(f"  ausente  {au}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
