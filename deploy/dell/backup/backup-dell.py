#!/usr/bin/env python3
"""Backup do Dell para o Google Drive: espelho legível e cofre cifrado.

Existe porque o PC queimou em 25/09/2026 e o Dell virou a única cópia dos
sites, do PRUMO, do n8n e do Hermes. O que vai para onde está no manifesto
(~/.config/backup-dell/fontes.toml, versionado em deploy/dell/backup/); este
runner não conhece fonte nenhuma pelo nome.

- espelho: `rclone sync` Dell → Drive, um sentido só, com o que sai ou muda
  guardado na lixeira por 30 dias. Hora em hora pelo timer; cada fonte roda
  quando vence o próprio intervalo.
- cofre: restic cifrado (backend rclone) da home inteira menos o que se
  reinstala, precedido de dumps consistentes (Postgres do n8n, pasta do n8n,
  SQLite do Hermes). Diário; manutenção semanal e leitura mensal sozinhas.
- ensaio: restaura o essencial numa pasta à parte, sobe um Postgres e um n8n
  descartáveis sem rede e prova que as credenciais do n8n decifram. Roda
  sozinho depois do cofre quando o último tem mais de 30 dias.

Não manda WhatsApp: grava ~/.local/state/backup-dell/status.json, e o
dell-status transforma a idade do último sucesso em ok/atencao/falha (e o
Hermes avisa). Só o resultado do ensaio vai para a fila de avisos.

Somente biblioteca padrão. Uso:
  backup-dell iniciar                 # uma vez: pastas no Drive, repositório e kit
  backup-dell espelho [--fonte ID] [--forcar] [--dry-run] [--sem-limite]
  backup-dell cofre [--dry-run] [--sem-ensaio]
  backup-dell ensaio
  backup-dell status
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import glob
import hashlib
import json
import os
import re
import secrets
import shlex
import shutil
import sqlite3
import subprocess
import sys
import time
import tomllib
from pathlib import Path

HOME = Path.home()
CONF = HOME / ".config/backup-dell"
MANIFESTO = CONF / "fontes.toml"
KIT = CONF / "KIT-DE-RECUPERACAO.txt"
ESTADO = HOME / ".local/state/backup-dell"
STATUS = ESTADO / "status.json"
TRAVA = ESTADO / "trava"
PREPARO = ESTADO / "preparo"
ENSAIO = ESTADO / "ensaio"
FILA_AVISOS = HOME / ".local/share/avisos/fila"
HOST = "dell-worker"
DIA = 24


# ---------------------------------------------------------------- utilidades

def agora() -> dt.datetime:
    return dt.datetime.now().astimezone()


def iso(t: dt.datetime) -> str:
    return t.isoformat(timespec="seconds")


def idade_h(quando: str | None) -> float | None:
    if not quando:
        return None
    return (agora() - dt.datetime.fromisoformat(quando)).total_seconds() / 3600


def exp(p: str) -> str:
    if p == "~":
        return str(HOME)
    return str(HOME / p[2:]) if p.startswith("~/") else p


def log(msg: str) -> None:
    print(f"[{agora():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def ultima_linha(texto: str, n: int = 240) -> str:
    linhas = [l.strip() for l in texto.splitlines() if l.strip()]
    # Token do Google recusado aparece numa linha do rclone antes do "Fatal" do
    # restic: é ela que diz o que fazer (reconectar), então vem primeiro.
    token = [l for l in linhas if re.search(r"(?i)invalid_grant|couldn't fetch token", l)]
    erros = [l for l in linhas if re.search(r"(?i)error|erro|fatal|failed", l)]
    return ((token or erros or linhas or ["sem saída"])[-1])[:n]


def ilegiveis(stderr: str) -> list[str]:
    """Arquivos que o restic não conseguiu ler (saída --json ou texto)."""
    itens = []
    for linha in (stderr or "").splitlines():
        try:
            j = json.loads(linha)
        except ValueError:
            m = re.match(r"error: \w+ (/.+?): ", linha.strip())
            if m:
                itens.append(m.group(1))
            continue
        if isinstance(j, dict) and j.get("message_type") == "error" and j.get("item"):
            itens.append(str(j["item"]))
    return [str(Path(i).relative_to(HOME)) if i.startswith(str(HOME) + "/") else i for i in dict.fromkeys(itens)]


def ler_manifesto(caminho: Path) -> dict:
    with open(caminho, "rb") as f:
        return tomllib.load(f)


def ler_env(path: str) -> dict[str, str]:
    env = {}
    for linha in Path(path).read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            k, v = linha.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# ---------------------------------------------------------------- estado

@contextlib.contextmanager
def _trava_status():
    ESTADO.mkdir(parents=True, exist_ok=True)
    with open(ESTADO / "status.lock", "w") as fd:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield


def ler_status() -> dict:
    try:
        return json.loads(STATUS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"fontes": {}}


def registrar(fid: str, **campos) -> None:
    """Mescla campos no estado da fonte. Gravação atômica: o dell-status lê a
    cada minuto e nunca pode pegar o arquivo pela metade."""
    with _trava_status():
        st = ler_status()
        st.setdefault("fontes", {}).setdefault(fid, {}).update(campos)
        st["atualizado"] = iso(agora())
        tmp = STATUS.with_suffix(".tmp")
        tmp.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(STATUS)


def avisar(titulo: str, texto: str) -> None:
    """Fila do dell-status. .tmp + rename: ele lê a pasta a cada minuto.
    BACKUP_DELL_SEM_AVISO=1 cala o WhatsApp em testes com repositório local."""
    if os.environ.get("BACKUP_DELL_SEM_AVISO"):
        log(f"(aviso suprimido) {titulo}: {texto}")
        return
    FILA_AVISOS.mkdir(parents=True, exist_ok=True)
    nome = FILA_AVISOS / f"backup-dell-{time.time_ns()}.json"
    tmp = nome.with_suffix(".tmp")
    tmp.write_text(json.dumps({"titulo": titulo, "texto": texto}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(nome)


class Ocupado(Exception):
    pass


@contextlib.contextmanager
def trava(espera_s: float):
    """Uma trava para espelho, cofre e ensaio: o rclone regrava o rclone.conf
    quando renova o token, e duas rodadas juntas disputariam o arquivo."""
    ESTADO.mkdir(parents=True, exist_ok=True)
    fd = open(TRAVA, "w")
    limite = time.monotonic() + espera_s
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() >= limite:
                fd.close()
                raise Ocupado
            time.sleep(5)
    try:
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        fd.close()


def rodar(cmd: list[str], env: dict | None = None, timeout: float | None = None, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, env={**os.environ, **(env or {})}, capture_output=True, text=True,
                          timeout=timeout, **kw)


# ---------------------------------------------------------------- rclone

def flags_rclone(g: dict, nivel: str = "NOTICE") -> list[str]:
    # tpslimit: o Drive cria uns 2 arquivos/s e responde 403 rate limit acima
    # disso; retries cobrem "source file is being updated" enquanto alguém grava.
    return ["--fast-list", "--transfers", "4", "--checkers", "8", "--tpslimit", "8",
            "--drive-skip-gdocs", "--retries", "3", "--retries-sleep", "30s",
            "--low-level-retries", "10", "--bwlimit", g.get("banda", "off"),
            "--stats", "0", "--stats-one-line", "--stats-log-level", "NOTICE", "--log-level", nivel]


def remoto_do(g: dict, f: dict) -> str:
    """Remote do bloco. Sem `remoto` próprio vale o de [geral]: os blocos antigos
    não mudam."""
    return f.get("remoto", g["remoto"])


def lixeira_do(g: dict, f: dict) -> str:
    return f.get("lixeira", g["lixeira"])


def no_remoto(remoto: str, *partes: str) -> str:
    """remoto:a/b, sem barra sobrando quando o destino é a raiz do remote
    (destino = "")."""
    return f"{remoto}:" + "/".join(p.strip("/") for p in partes if p and p.strip("/"))


def dentro_da_janela(janela, t: dt.datetime) -> bool:
    """janela = ["04:00", "06:00"]: o bloco só roda quando o relógio está nela
    (o timer do espelho é de hora em hora; assim um bloco diário cai de madrugada).
    Sem janela, sempre. Janela que atravessa a meia-noite também vale."""
    if not janela:
        return True
    ini, fim = (dt.datetime.strptime(x, "%H:%M").time() for x in janela)
    agora_t = t.time()
    return ini <= agora_t <= fim if ini <= fim else (agora_t >= ini or agora_t <= fim)


def filtros(f: dict) -> list[str]:
    if f.get("incluir"):
        # Só o que casa com `incluir` é espelhado; o resto do destino fica intocado (nem
        # copia, nem apaga). É o que deixa um bloco morar na raiz de uma pasta que tem coisas
        # do dono, e a lixeira ficar dentro dela sem sobrepor o destino. Com --filter a ordem
        # é a escrita (a primeira regra que casa vale); misturar --include e --exclude o rclone
        # avisa que tem ordem indefinida, e o "- /LEIA-ME.txt" precisa ganhar.
        regras = ["- /LEIA-ME.txt", *[f"- {e}" for e in f.get("excluir", [])],
                  *[f"+ {i}" for i in f["incluir"]], "- **"]
        return [x for r in regras for x in ("--filter", r)]
    out = ["--exclude", "/LEIA-ME.txt"]  # escrito aqui, não existe na origem; excluído não é apagado
    for e in f.get("excluir", []):
        out += ["--exclude", e]
    return out


def garantir_leia_me(g: dict, f: dict) -> None:
    texto = f.get("leia_me", "").strip()
    if not texto:
        return
    h = hashlib.sha256(texto.encode()).hexdigest()[:12]
    if ler_status().get("fontes", {}).get(f["id"], {}).get("leia_me") == h:
        return
    r = rodar(["rclone", "rcat", no_remoto(remoto_do(g, f), f["destino"], "LEIA-ME.txt")], input=texto + "\n", timeout=120)
    if r.returncode == 0:
        registrar(f["id"], leia_me=h)


def limpar_lixeira(g: dict, f: dict) -> str:
    """Apaga pela data no nome da pasta: o arquivo movido para a lixeira
    mantém a data de modificação original, então --min-age apagaria na hora."""
    base = no_remoto(remoto_do(g, f), lixeira_do(g, f), f["id"])
    r = rodar(["rclone", "lsf", "--dirs-only", base], timeout=300)
    if r.returncode != 0:
        return "lixeira ainda vazia" if "not found" in (r.stderr or "").lower() else f"lixeira: {ultima_linha(r.stderr)}"
    limite = agora() - dt.timedelta(days=int(g.get("lixeira_dias", 30)))
    apagadas = 0
    for nome in r.stdout.split():
        nome = nome.rstrip("/")
        try:
            quando = dt.datetime.strptime(nome, "%Y-%m-%dT%H").astimezone()
        except ValueError:
            continue
        if quando < limite and rodar(["rclone", "purge", f"{base}/{nome}"], timeout=1800).returncode == 0:
            apagadas += 1
    return f"{apagadas} pasta(s) antiga(s) apagada(s) da lixeira"


def verificar_espelho(g: dict, f: dict) -> str:
    """Compara origem e Drive por MD5 sem baixar nada."""
    r = rodar(["rclone", "check", exp(f["origem"]), no_remoto(remoto_do(g, f), f["destino"]), "--one-way",
               "--fast-list", "--tpslimit", "8", *filtros(f), "--log-level", "NOTICE"], timeout=3600)
    if r.returncode == 0:
        return "ok"
    m = re.search(r"(\d+) differences found", r.stderr or "")
    return f"{m.group(1)} diferença(s)" if m else ultima_linha(r.stderr)


def espelho_uma(g: dict, f: dict, a: argparse.Namespace) -> bool:
    fid = f["id"]
    origem = Path(exp(f["origem"]))
    destino = no_remoto(remoto_do(g, f), f["destino"])
    base = {"tipo": "espelho", "nome": f.get("nome", fid), "destino": f["destino"] or "(raiz)",
            "atencao_h": f.get("atencao_h", 3), "falha_h": f.get("falha_h", 24)}
    st = ler_status().get("fontes", {}).get(fid, {})
    idade = idade_h(st.get("ultimo_sucesso"))
    if not (a.forcar or a.dry_run) and idade is not None and idade < f.get("intervalo_h", 1) - 0.1:
        return True
    t = agora()
    if not (a.forcar or a.dry_run) and not dentro_da_janela(f.get("janela"), t):
        return True  # vencido, mas fora da janela do bloco: a hora certa tenta
    # Preparo: comandos que deixam a origem fresca antes de sincronizar (ex.: o
    # coletor da Estrutura). Falhou, não sincroniza: melhor o Drive velho do que
    # um espelho de uma origem pela metade.
    for cmd in f.get("preparo", []):
        rp = rodar([exp(p) for p in shlex.split(cmd)], timeout=f.get("preparo_timeout_s", 900))
        if rp.returncode != 0:
            detalhe = f"Preparo falhou ({shlex.split(cmd)[-1]}): {ultima_linha((rp.stderr or '') + (rp.stdout or ''))}"
            registrar(fid, **base, estado="falha", ultima_tentativa=iso(t), detalhe=detalhe)
            log(f"{fid}: FALHA — {detalhe}")
            return False
    if not (origem / f["sentinela"]).is_file():
        # Origem sem o arquivo de sempre: pasta vazia ou desmontada. Sincronizar
        # apagaria o espelho inteiro.
        registrar(fid, **base, estado="falha", ultima_tentativa=iso(t),
                  detalhe=f"Origem sem {f['sentinela']}: não sincronizei para não apagar o espelho.")
        return False
    adiar = f.get("adiar_se_recente")
    if adiar and not a.forcar:
        marca = origem / adiar["arquivo"]
        if marca.exists() and (time.time() - marca.stat().st_mtime) / 3600 < adiar["horas"]:
            registrar(fid, **base, estado="adiado", ultima_tentativa=iso(t),
                      detalhe=f"Adiado: {adiar['arquivo']} recente (o gerador está escrevendo).")
            log(f"{fid}: adiado ({adiar['arquivo']} recente)")
            return True
    lixeira = no_remoto(remoto_do(g, f), lixeira_do(g, f), fid, f"{t:%Y-%m-%dT%H}")
    max_apagar = "-1" if a.sem_limite else str(f.get("max_apagar", 500))
    cmd = ["rclone", "sync", str(origem), destino, "--backup-dir", lixeira, "--max-delete", max_apagar,
           *flags_rclone(g, "INFO" if a.dry_run else "NOTICE"), *filtros(f)]
    if a.dry_run:
        cmd.append("--dry-run")
        log(f"{fid}: simulação — " + " ".join(cmd))
        r = rodar(cmd, timeout=6 * 3600)
        print(r.stdout + r.stderr)
        return r.returncode == 0
    log(f"{fid}: {origem} → {destino}")
    r = rodar(cmd, timeout=6 * 3600)
    saida = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0:
        if r.returncode == 7 or "max-delete" in saida.lower():
            detalhe = (f"Parou antes de apagar mais de {max_apagar} arquivos no Drive. Se foi de propósito "
                       f"(leads movidos em massa), rode: backup-dell espelho --fonte {fid} --sem-limite")
        else:
            detalhe = f"rclone saiu com {r.returncode}: {ultima_linha(saida)}"
        registrar(fid, **base, estado="falha", ultima_tentativa=iso(t), detalhe=detalhe)
        log(f"{fid}: FALHA — {detalhe}")
        return False
    # Última linha é o resumo do --stats-one-line, sem o carimbo do rclone.
    linhas = [l for l in saida.splitlines() if l.strip()]
    resumo = re.sub(r"^\S+ \S+ NOTICE: ", "", linhas[-1]).strip()[:160] if linhas else "nada mudou"
    registrar(fid, **base, estado="ok", ultima_tentativa=iso(t), ultimo_sucesso=iso(agora()),
              detalhe=f"Espelhado às {agora():%H:%M} ({resumo})")
    garantir_leia_me(g, f)
    st = ler_status().get("fontes", {}).get(fid, {})
    if (idade_h(st.get("ultima_limpeza")) or 1e9) > 20:
        registrar(fid, ultima_limpeza=iso(agora()), limpeza=limpar_lixeira(g, f))
    if (idade_h(st.get("ultima_verificacao")) or 1e9) > 7 * DIA:
        v = verificar_espelho(g, f)
        registrar(fid, ultima_verificacao=iso(agora()), verificacao=v)
        if v != "ok":
            registrar(fid, estado="atencao", detalhe=f"Espelhado, mas a conferência por MD5 achou {v}.")
    log(f"{fid}: ok ({resumo})")
    return True


def espelho(m: dict, a: argparse.Namespace) -> int:
    g = m["geral"]
    fontes = [f for f in m.get("espelho", []) if not a.fonte or f["id"] == a.fonte]
    if a.fonte and not fontes:
        sys.exit(f"Fonte desconhecida: {a.fonte}")
    try:
        with trava(60 * g.get("espera_trava_min", 5)):
            ok = [espelho_uma(g, f, a) for f in fontes]
    except Ocupado:
        # O cofre (ou outra rodada) está com a trava; a próxima hora tenta.
        for f in fontes:
            registrar(f["id"], estado="adiado", ultima_tentativa=iso(agora()),
                      detalhe="Adiado: outra rodada do backup estava em andamento.")
        log("trava ocupada; adiado")
        return 0
    return 0 if all(ok) else 1


# ---------------------------------------------------------------- cofre

def env_restic(c: dict) -> dict:
    return {"RESTIC_REPOSITORY": c["repositorio"], "RESTIC_PASSWORD_FILE": exp(c["senha"])}


def preparar(c: dict) -> list[str]:
    """Dumps consistentes para o que não se copia vivo. Devolve os problemas."""
    problemas = []
    if PREPARO.exists():
        shutil.rmtree(PREPARO)
    PREPARO.mkdir(parents=True, mode=0o700)
    resumo = {"gerado": iso(agora()), "itens": []}
    for p in c.get("preparo", []):
        nome = p["nome"]
        try:
            if p["tipo"] == "postgres":
                usuario = ler_env(exp(p["env"]))["POSTGRES_USER"]
                saida = PREPARO / f"{nome}.sql"
                with open(saida, "w", encoding="utf-8") as fh:
                    # -T: sem TTY sob systemd. Texto puro: o restic deduplica e comprime melhor.
                    r = subprocess.run(["docker", "compose", "-f", exp(p["compose"]), "exec", "-T", p["servico"],
                                        "pg_dump", "-U", usuario, "-d", p["banco"], "--no-owner", "--no-privileges"],
                                       stdout=fh, stderr=subprocess.PIPE, text=True, timeout=1800)
                if r.returncode != 0:
                    raise RuntimeError(ultima_linha(r.stderr))
                if "PostgreSQL database dump complete" not in saida.read_text(encoding="utf-8")[-400:]:
                    raise RuntimeError("dump sem o fim esperado (truncado?)")
                resumo["itens"].append({"nome": nome, "arquivo": saida.name, "bytes": saida.stat().st_size})
            elif p["tipo"] == "pasta-do-container":
                saida = PREPARO / f"{nome}.tar"
                excl = [x for e in p.get("excluir", []) for x in ("--exclude", e)]
                with open(saida, "wb") as fh:
                    r = subprocess.run(["docker", "compose", "-f", exp(p["compose"]), "exec", "-T", p["servico"],
                                        "tar", "-C", p["pasta"], *excl, "-cf", "-", "."],
                                       stdout=fh, stderr=subprocess.PIPE, timeout=1800)
                if r.returncode != 0:
                    raise RuntimeError(ultima_linha(r.stderr.decode(errors="replace")))
                resumo["itens"].append({"nome": nome, "arquivo": saida.name, "bytes": saida.stat().st_size})
            elif p["tipo"] == "sqlite":
                destino_base = PREPARO / "sqlite"
                for padrao in p["arquivos"]:
                    for src in sorted(glob.glob(exp(padrao))):
                        rel = Path(src).relative_to(HOME)
                        dst = destino_base / rel
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        # backup() lê uma fotografia consistente mesmo com o Hermes
                        # escrevendo (WAL); copiar o arquivo cru poderia pegar meia transação.
                        with contextlib.closing(sqlite3.connect(src, timeout=30)) as de, \
                                contextlib.closing(sqlite3.connect(dst)) as para:
                            de.backup(para)
                            ok = para.execute("PRAGMA integrity_check").fetchone()[0]
                        if ok != "ok":
                            raise RuntimeError(f"{rel}: integrity_check = {ok}")
                        resumo["itens"].append({"nome": f"{nome}:{rel}", "arquivo": str(dst.relative_to(PREPARO)),
                                                "bytes": dst.stat().st_size})
            else:
                raise RuntimeError(f"tipo de preparo desconhecido: {p['tipo']}")
        except Exception as e:  # noqa: BLE001 — um preparo ruim não impede o resto do cofre
            problemas.append(f"{nome}: {str(e)[:160]}")
    (PREPARO / "preparo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding="utf-8")
    for arq in PREPARO.rglob("*"):
        arq.chmod(0o700 if arq.is_dir() else 0o600)
    return problemas


def restic(args: list[str], c: dict, timeout: float = 6 * 3600) -> subprocess.CompletedProcess:
    return rodar(["restic", *args], env=env_restic(c), timeout=timeout)


def cofre(m: dict, a: argparse.Namespace) -> int:
    c = m["cofre"]
    base = {"tipo": "cofre", "nome": "Cofre do Dell (cifrado)", "atencao_h": c.get("atencao_h", 26),
            "falha_h": c.get("falha_h", 50)}
    try:
        with trava(3600):
            codigo = _cofre(m, c, a, base)
    except Ocupado:
        registrar("cofre", **base, estado="falha", ultima_tentativa=iso(agora()),
                  detalhe="Trava ocupada por mais de 1 h: alguma rodada do backup travou.")
        return 1
    if codigo == 0 and not a.dry_run and not a.sem_ensaio:
        if (idade_h(ler_status().get("fontes", {}).get("ensaio", {}).get("ultimo_sucesso")) or 1e9) > 30 * DIA:
            return ensaio(m, a)
    return codigo


def _cofre(m: dict, c: dict, a: argparse.Namespace, base: dict) -> int:
    t = agora()
    log("cofre: preparando dumps")
    problemas = preparar(c)
    faltando = [p for p in c.get("obrigatorios", []) if not Path(exp(p)).exists()]
    cmd = ["backup", exp(c.get("raiz", "~")), "--json", "--one-file-system", "--exclude-caches",
           "--host", HOST, "--tag", "diario", "--pack-size", "64"]
    for e in c.get("excluir", []):
        cmd += ["--exclude", exp(e)]
    if 8 <= t.hour < 23:
        cmd += ["--limit-upload", "2048"]  # rodada atrasada (Persistent) não toma a rede de dia
    if a.dry_run:
        cmd.append("--dry-run")
    log("cofre: restic backup")
    r = restic(cmd, c)
    resumo = {}
    for linha in (r.stdout or "").splitlines():
        with contextlib.suppress(ValueError):
            j = json.loads(linha)
            if j.get("message_type") == "summary":
                resumo = j
    if a.dry_run:
        mb = resumo.get("data_added", 0) / 1e6
        print(f"Simulação: {resumo.get('total_files_processed')} arquivos, {resumo.get('total_bytes_processed', 0) / 1e9:.2f} GB "
              f"lidos, ~{mb:.0f} MB novos. Problemas de preparo: {problemas or 'nenhum'}. Faltando: {faltando or 'nada'}")
        if r.returncode not in (0, 3):
            print(r.stderr)
        return 0 if r.returncode in (0, 3) else 1
    if r.returncode not in (0, 3):
        registrar("cofre", **base, estado="falha", ultima_tentativa=iso(t),
                  detalhe=f"restic saiu com {r.returncode}: {ultima_linha(r.stderr)}")
        log(f"cofre: FALHA {ultima_linha(r.stderr)}")
        return 1
    mb = resumo.get("data_added", 0) / 1e6
    avisos = []
    if r.returncode == 3:
        # Diz quais: sem isso a Central só sabe que "alguns" ficaram de fora.
        fora = ilegiveis(r.stderr)
        for arq in fora:
            log(f"cofre: não li ~/{arq}")
        avisos.append(f"{len(fora)} arquivo(s) não puderam ser lidos (ex.: ~/{fora[0]})" if fora
                      else "alguns arquivos não puderam ser lidos")
    if problemas:
        avisos.append("preparo: " + "; ".join(problemas))
    if faltando:
        avisos.append("faltando: " + ", ".join(faltando))
    if mb > c.get("alerta_mb", 500):
        avisos.append(f"{mb:.0f} MB novos numa rodada (pasta grande nova sem regra?)")
    detalhe = (f"Snapshot {str(resumo.get('snapshot_id', ''))[:8]} às {agora():%H:%M}: "
               f"{mb:.0f} MB novos de {resumo.get('total_bytes_processed', 0) / 1e9:.1f} GB lidos")
    # O dump do n8n é o que refaz os fluxos e as credenciais: sem ele o cofre falhou.
    critico = any(p.startswith(tuple(x["nome"] + ":" for x in c.get("preparo", []) if x["tipo"] == "postgres"))
                  for p in problemas)
    estado = "falha" if critico else "atencao" if avisos else "ok"
    campos = dict(**base, estado=estado, ultima_tentativa=iso(t),
                  detalhe=detalhe + (". Atenção: " + " · ".join(avisos) if avisos else ""),
                  snapshot=str(resumo.get("snapshot_id", ""))[:8], novos_mb=round(mb))
    if not critico:
        campos["ultimo_sucesso"] = iso(agora())
    registrar("cofre", **campos)
    st = ler_status()["fontes"]["cofre"]
    if (idade_h(st.get("ultima_manutencao")) or 1e9) > 6.5 * DIA:
        log("cofre: forget/prune + check")
        ret = c.get("reter", {})
        rf = restic(["forget", "--host", HOST, "--prune", "--pack-size", "64",
                     "--keep-daily", str(ret.get("diarios", 7)), "--keep-weekly", str(ret.get("semanais", 4)),
                     "--keep-monthly", str(ret.get("mensais", 6))], c)
        rc = restic(["check"], c)
        registrar("cofre", ultima_manutencao=iso(agora()),
                  check="ok" if rf.returncode == 0 and rc.returncode == 0 else "falha",
                  check_detalhe="ok" if rc.returncode == 0 and rf.returncode == 0
                  else ultima_linha((rf.stderr or "") + (rc.stderr or "")))
    if (idade_h(st.get("ultima_leitura")) or 1e9) > 30 * DIA:
        # Lê de verdade 1/12 dos dados por mês: em um ano o repositório inteiro.
        parte = f"{agora().month}/12"
        log(f"cofre: check --read-data-subset={parte}")
        rl = restic(["check", f"--read-data-subset={parte}"], c, timeout=12 * 3600)
        registrar("cofre", ultima_leitura=iso(agora()),
                  check="ok" if rl.returncode == 0 else "falha",
                  check_detalhe=f"leitura {parte}: " + ("ok" if rl.returncode == 0 else ultima_linha(rl.stderr)))
    log(f"cofre: {estado} — {detalhe}")
    return 1 if estado == "falha" else 0


# ---------------------------------------------------------------- ensaio

def imagem_do_servico(compose: str, servico: str) -> str:
    cid = rodar(["docker", "compose", "-f", compose, "ps", "-q", servico], timeout=60).stdout.strip()
    img = rodar(["docker", "inspect", "-f", "{{.Config.Image}}", cid], timeout=60).stdout.strip() if cid else ""
    if not img:
        raise RuntimeError(f"não achei a imagem do serviço {servico}")
    return img


def ensaio(m: dict, a: argparse.Namespace) -> int:
    c = m["cofre"]
    base = {"tipo": "ensaio", "nome": "Ensaio de restauração"}
    t = agora()
    try:
        with trava(3600):
            det = _ensaio(c)
    except Ocupado:
        registrar("ensaio", **base, estado="atencao", ultima_tentativa=iso(t), detalhe="Trava ocupada; tento no próximo cofre.")
        return 1
    except Exception as e:  # noqa: BLE001
        registrar("ensaio", **base, estado="falha", ultima_tentativa=iso(t), detalhe=f"Ensaio falhou: {str(e)[:200]}")
        avisar("🗄️ Backup do Dell", f"O ensaio de restauração falhou: {str(e)[:200]}. O cofre existe, mas não provei que ele refaz o Dell.")
        log(f"ensaio: FALHA {e}")
        return 1
    registrar("ensaio", **base, estado="ok", ultima_tentativa=iso(t), ultimo_sucesso=iso(agora()), detalhe=det)
    avisar("🗄️ Backup do Dell", f"Ensaio de restauração ok: {det}.")
    log(f"ensaio: ok — {det}")
    return 0


def _ensaio(c: dict) -> str:
    alvo = ENSAIO / f"{agora():%Y%m%d-%H%M%S}"
    alvo.mkdir(parents=True, mode=0o700)
    pg = "backup-dell-ensaio-pg"
    compose_n8n = next((exp(p["compose"]) for p in c.get("preparo", []) if p["tipo"] == "postgres"), None)
    try:
        # Só o essencial: o preparo e o .env com a chave. Nunca por cima do original.
        incluir = [str(PREPARO), exp("~/licitacoes-automation/.env")]
        r = restic(["restore", "latest", "--host", HOST, "--target", str(alvo),
                    *[x for i in incluir for x in ("--include", i)]], c, timeout=3 * 3600)
        if r.returncode != 0:
            raise RuntimeError(f"restore: {ultima_linha(r.stderr)}")
        raiz = alvo / str(HOME).lstrip("/")
        prep = raiz / PREPARO.relative_to(HOME)
        # 1. SQLite do Hermes
        bancos = sorted((prep / "sqlite").rglob("*.db"))
        for db in bancos:
            with contextlib.closing(sqlite3.connect(db)) as con:
                if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError(f"SQLite corrompido: {db.name}")
        # 2. Postgres descartável, sem rede, com o dump restaurado
        sql = next(prep.glob("*.sql"), None)
        if not sql or not compose_n8n:
            raise RuntimeError("dump do n8n ausente no snapshot")
        img_pg = imagem_do_servico(compose_n8n, "db")
        img_n8n = imagem_do_servico(compose_n8n, "n8n")
        rodar(["docker", "rm", "-f", pg], timeout=60)
        r = rodar(["docker", "run", "-d", "--rm", "--name", pg, "--network", "none",
                   "-e", "POSTGRES_PASSWORD=ensaio", "-e", "POSTGRES_USER=ensaio", "-e", "POSTGRES_DB=n8n",
                   "-v", f"{sql}:/ensaio/n8n.sql:ro", img_pg], timeout=300)
        if r.returncode != 0:
            raise RuntimeError(f"postgres do ensaio: {ultima_linha(r.stderr)}")
        for _ in range(60):
            if rodar(["docker", "exec", pg, "pg_isready", "-U", "ensaio", "-d", "n8n"], timeout=30).returncode == 0:
                break
            time.sleep(2)
        time.sleep(3)  # o entrypoint reinicia o servidor depois do initdb
        r = rodar(["docker", "exec", pg, "psql", "-U", "ensaio", "-d", "n8n", "-q", "-v", "ON_ERROR_STOP=1",
                   "-f", "/ensaio/n8n.sql"], timeout=1800)
        if r.returncode != 0:
            raise RuntimeError(f"carga do dump: {ultima_linha(r.stderr)}")

        def contar(tabela: str) -> int:
            q = rodar(["docker", "exec", pg, "psql", "-U", "ensaio", "-d", "n8n", "-Atc", f"select count(*) from {tabela}"], timeout=60)
            return int(q.stdout.strip() or 0)

        fluxos, creds = contar("workflow_entity"), contar("credentials_entity")
        # 3. A prova que importa: um n8n descartável, sem rede, com a chave
        # restaurada, decifra as credenciais. A chave vai por arquivo, não pela
        # linha de comando (que aparece no ps).
        chave = ler_env(str(raiz / "licitacoes-automation/.env")).get("N8N_ENCRYPTION_KEY")
        if not chave:
            raise RuntimeError("N8N_ENCRYPTION_KEY ausente no .env restaurado")
        envf = alvo / "n8n.env"
        envf.write_text(f"N8N_ENCRYPTION_KEY={chave}\nDB_TYPE=postgresdb\nDB_POSTGRESDB_HOST=127.0.0.1\n"
                        "DB_POSTGRESDB_DATABASE=n8n\nDB_POSTGRESDB_USER=ensaio\nDB_POSTGRESDB_PASSWORD=ensaio\n"
                        "N8N_USER_FOLDER=/tmp/n8n\nN8N_DIAGNOSTICS_ENABLED=false\n", encoding="utf-8")
        envf.chmod(0o600)
        script = ("n8n export:credentials --all --decrypted --output=/tmp/c.json >/tmp/log 2>&1 "
                  "|| { tail -3 /tmp/log; exit 1; }; "
                  "node -e 'const c=require(\"/tmp/c.json\");"
                  "const ok=c.filter(x=>x.data&&typeof x.data===\"object\"&&Object.keys(x.data).length);"
                  "console.log(c.length+\" \"+ok.length)'")
        r = rodar(["docker", "run", "--rm", "--network", f"container:{pg}", "--env-file", str(envf),
                   "--entrypoint", "sh", img_n8n, "-c", script], timeout=900)
        if r.returncode != 0:
            raise RuntimeError(f"n8n do ensaio: {ultima_linha(r.stdout + r.stderr)}")
        total, decifradas = (int(x) for x in r.stdout.split()[-2:])
        if total != creds or decifradas != total:
            raise RuntimeError(f"só {decifradas} de {creds} credenciais decifraram")
        return (f"{fluxos} fluxos e {decifradas} credenciais do n8n decifradas com a chave do cofre, "
                f"{len(bancos)} SQLite do Hermes íntegros")
    finally:
        rodar(["docker", "rm", "-f", pg], timeout=120)
        # O ensaio restaura segredos: não ficam no disco.
        shutil.rmtree(alvo, ignore_errors=True)


# ---------------------------------------------------------------- iniciar e status

def iniciar(m: dict, a: argparse.Namespace) -> int:
    g, c = m["geral"], m["cofre"]
    r = rodar(["rclone", "about", f"{g['remoto']}:", "--json"], timeout=120)
    if r.returncode != 0:
        sys.exit(f"O remote '{g['remoto']}' não responde. Configure o rclone primeiro (README.md).\n{ultima_linha(r.stderr)}")
    about = json.loads(r.stdout)
    livre = (about.get("total", 0) - about.get("used", 0)) / 1e9 if about.get("total") else None
    print(f"Drive: {about.get('used', 0) / 1e9:.1f} GB usados" + (f", {livre:.1f} GB livres" if livre is not None else ""))
    # (remote, pasta): cada bloco pode ter o seu remote; a raiz de um remote (destino = "") já existe.
    pastas = []
    for f in m.get("espelho", []):
        pastas += [(remoto_do(g, f), p) for p in (f["destino"], lixeira_do(g, f)) if p.strip("/")]
    pastas.append((g["remoto"], g["lixeira"]))
    repo_rclone = c["repositorio"].removeprefix("rclone:")
    pastas.append((g["remoto"], repo_rclone.split(":", 1)[1].rsplit("/", 1)[0]))
    for remoto, p in dict.fromkeys(pastas):
        rr = rodar(["rclone", "mkdir", no_remoto(remoto, p)], timeout=120)
        print(("ok    " if rr.returncode == 0 else "ERRO  ") + f"{remoto}:{p}")
    senha = Path(exp(c["senha"]))
    CONF.mkdir(parents=True, exist_ok=True, mode=0o700)
    if restic(["cat", "config"], c, timeout=300).returncode == 0:
        print("Repositório restic já existe; não mexi.")
        return 0
    if not senha.exists():
        senha.write_text(secrets.token_urlsafe(32) + "\n")
        senha.chmod(0o600)
    r = restic(["init"], c, timeout=600)
    if r.returncode != 0:
        sys.exit(f"restic init falhou: {ultima_linha(r.stderr)}")
    # Segunda chave: só no kit, para quem guarda fora do Dell. Se a senha do
    # Dell se perder junto com ele, esta abre o cofre.
    segunda = secrets.token_urlsafe(32)
    tmp = CONF / ".segunda.tmp"
    tmp.write_text(segunda + "\n")
    tmp.chmod(0o600)
    r = rodar(["restic", "key", "add", "--new-password-file", str(tmp)], env=env_restic(c), timeout=300)
    tmp.unlink(missing_ok=True)
    if r.returncode != 0:
        sys.exit(f"restic key add falhou: {ultima_linha(r.stderr)}")
    KIT.write_text(
        "KIT DE RECUPERAÇÃO DO COFRE DO DELL — copie para o gerenciador de senhas e para o papel,\n"
        "depois apague este arquivo (rm ~/.config/backup-dell/KIT-DE-RECUPERACAO.txt).\n"
        "Sem uma destas senhas o cofre não abre, nem para você.\n\n"
        f"Repositório (restic):   {c['repositorio']}\n"
        f"No Drive:               Meu Drive/{repo_rclone.split(':', 1)[1]}\n"
        f"Senha 1 (a do Dell):    {senha.read_text().strip()}\n"
        f"Senha 2 (só sua):       {segunda}\n\n"
        "Para restaurar sem o Dell: instale restic e rclone, configure um remote do Drive\n"
        "e siga RESTAURAR.md (SquadOne/deploy/dell/backup/RESTAURAR.md no GitHub).\n", encoding="utf-8")
    KIT.chmod(0o600)
    print(f"Repositório criado. Kit de recuperação em {KIT}: copie e apague.")
    return 0


def status(m: dict, a: argparse.Namespace) -> int:
    st = ler_status()
    if not st.get("fontes"):
        print("Nenhuma rodada registrada ainda.")
        return 0
    for fid, f in sorted(st["fontes"].items()):
        ok = f.get("ultimo_sucesso")
        idade = idade_h(ok)
        quando = f"{dt.datetime.fromisoformat(ok):%d/%m %H:%M} ({idade:.1f} h)" if ok else "nunca"
        print(f"{fid:12} {f.get('estado', '?'):8} último sucesso: {quando}\n{'':12} {f.get('detalhe', '')}")
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description="Backup do Dell para o Google Drive (espelho e cofre).")
    p.add_argument("--manifesto", type=Path, default=MANIFESTO)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("iniciar")
    e = sub.add_parser("espelho")
    e.add_argument("--fonte")
    e.add_argument("--forcar", action="store_true", help="roda mesmo antes de vencer o intervalo")
    e.add_argument("--dry-run", action="store_true")
    e.add_argument("--sem-limite", action="store_true", help="sem teto de apagamentos (movimentação em massa)")
    cf = sub.add_parser("cofre")
    cf.add_argument("--dry-run", action="store_true")
    cf.add_argument("--sem-ensaio", action="store_true")
    sub.add_parser("ensaio")
    sub.add_parser("status")
    a = p.parse_args()
    m = ler_manifesto(a.manifesto)
    acoes = {"iniciar": iniciar, "espelho": espelho, "cofre": cofre, "ensaio": ensaio, "status": status}
    sys.exit(acoes[a.cmd](m, a))


if __name__ == "__main__":
    main()
