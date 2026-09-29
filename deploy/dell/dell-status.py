#!/usr/bin/env python3
"""Retrato do Dell worker a cada minuto: grava o estado para a Central e avisa
o Rômulo pelo Hermes (WhatsApp) quando algo quebra e quando volta.

Uma verificação é {id, grupo, nome, estado, detalhe, link?}. `estado` é
`ok`, `atencao` ou `falha`. Só `falha` vira WhatsApp: `atencao` aparece na
Central e não interrompe ninguém.

Também esvazia a fila de avisos (~/.local/share/avisos/fila/*.json) que os
containers (n8n, collector) gravam, para que um fluxo sempre "responda a
alguém" sem abrir rede nem firewall entre container e host.

Somente biblioteca padrão. Uso:
  dell-status                 # verifica, grava status.json e avisa
  dell-status --stdout        # só imprime o JSON; não grava nem avisa
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import ssl
import subprocess
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from datetime import time as horario
from pathlib import Path

HOME = Path.home()
SAIDA = HOME / ".local/share/squadone-operations/status.json"
ESTADO = HOME / ".local/state/dell-status/estado.json"
FILA = HOME / ".local/share/avisos/fila"
HERMES = HOME / ".local/bin/hermes"
DESTINO = os.environ.get("AVISOS_DESTINO", "whatsapp:Rômulo Sutil")
N8N = "http://127.0.0.1:5679"
N8N_EDITOR = "http://127.0.0.1:5679"
PNCP_RUN = HOME / "licitacoes-automation/data/latest-run.json"
CRON_JOBS = HOME / ".hermes/cron/jobs.json"
LEMBRETE_FALHA_H = 12  # falha que continua é relembrada, não repetida a cada minuto


def agora() -> datetime:
    return datetime.now(timezone.utc)


def iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def check(id_: str, grupo: str, nome: str, estado: str, detalhe: str, link: str | None = None) -> dict:
    c = {"id": id_, "grupo": grupo, "nome": nome, "estado": estado, "detalhe": detalhe}
    if link:
        c["link"] = link
    return c


def http_ok(url: str, timeout: float = 5, headers: dict | None = None) -> tuple[bool, str]:
    try:
        ctx = ssl._create_unverified_context() if url.startswith("https://127.0.0.1") else None
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return r.status < 400, f"HTTP {r.status}"
    except Exception as e:  # noqa: BLE001 — qualquer erro vira "não respondeu"
        return False, str(getattr(e, "reason", e))[:120]


def http_json(url: str, headers: dict | None = None, timeout: float = 8):
    ctx = ssl._create_unverified_context() if url.startswith("https://127.0.0.1") else None
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.load(r)


def unit_ativa(unit: str) -> bool:
    r = subprocess.run(["systemctl", "--user", "is-active", unit], capture_output=True, text=True)
    return r.stdout.strip() == "active"


def ler_env(path: Path, chave: str) -> str | None:
    try:
        for linha in path.read_text().splitlines():
            if linha.startswith(chave + "="):
                return linha.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        return None
    return None


# ---------------------------------------------------------------- serviços

def servicos() -> list[dict]:
    out = []
    ok_gw = unit_ativa("hermes-gateway.service")
    ok_dash, det = http_ok("http://127.0.0.1:9119/api/status")
    out.append(check("hermes", "servicos", "Hermes (WhatsApp)",
                     "ok" if ok_gw and ok_dash else "falha",
                     "Gateway e painel respondendo" if ok_gw and ok_dash else
                     ("Gateway parado" if not ok_gw else f"Painel sem resposta: {det}"),
                     "http://127.0.0.1:9119/"))
    ok, det = http_ok("http://127.0.0.1:9222/json/version")
    out.append(check("hermes-navegador", "servicos", "Navegador do Hermes",
                     "ok" if ok else "falha",
                     "Chromium respondendo" if ok else f"CDP 9222 sem resposta ({det}). Coletas pelo navegador param."))
    ok, det = http_ok(f"{N8N}/healthz")
    out.append(check("n8n", "servicos", "n8n", "ok" if ok else "falha",
                     "Respondendo" if ok else f"Sem resposta: {det}", f"{N8N_EDITOR}/home/workflows"))
    ok, det = http_ok("http://127.0.0.1:8080/healthz")
    out.append(check("terminal", "servicos", "Terminal e IDE (code-server)", "ok" if ok else "falha",
                     "Respondendo" if ok else f"Sem resposta: {det}", "http://127.0.0.1:8080/"))
    out.append(syncthing())
    return out


def syncthing() -> dict:
    cfg = HOME / ".local/state/syncthing/config.xml"
    try:
        txt = cfg.read_text()
        key = txt.split("<apikey>", 1)[1].split("</apikey>", 1)[0].strip()
        h = {"X-API-Key": key}
        pastas = http_json("https://127.0.0.1:8384/rest/config/folders", h)
        ruins = []
        for p in pastas:
            s = http_json(f"https://127.0.0.1:8384/rest/db/status?folder={p['id']}", h)
            if s.get("state") == "error" or s.get("errors", 0) or s.get("pullErrors", 0):
                ruins.append(p.get("label") or p["id"])
        if ruins:
            return check("syncthing", "servicos", "Syncthing", "falha",
                         "Erro em: " + ", ".join(ruins), "http://127.0.0.1:8384/")
        return check("syncthing", "servicos", "Syncthing", "ok",
                     f"{len(pastas)} pastas sem erro", "http://127.0.0.1:8384/")
    except Exception as e:  # noqa: BLE001
        return check("syncthing", "servicos", "Syncthing", "falha", f"Sem resposta: {str(e)[:100]}",
                     "http://127.0.0.1:8384/")


# ---------------------------------------------------------------- containers

def containers() -> list[dict]:
    r = subprocess.run(["docker", "ps", "-a", "--format", "{{json .}}"], capture_output=True, text=True)
    if r.returncode != 0:
        return [check("docker", "containers", "Docker", "falha", r.stderr.strip()[:120] or "docker ps falhou")]
    problemas, rodando = [], 0
    for linha in r.stdout.splitlines():
        c = json.loads(linha)
        nome, estado, status = c["Names"], c["State"], c["Status"]
        if estado == "running" and "unhealthy" not in status:
            rodando += 1
            continue
        if estado == "exited":
            pol = subprocess.run(["docker", "inspect", "-f", "{{.HostConfig.RestartPolicy.Name}}", nome],
                                 capture_output=True, text=True).stdout.strip()
            if pol in ("", "no"):
                continue  # parado de propósito: não é problema
        problemas.append(check(f"container:{nome}", "containers", nome, "falha", status))
    return problemas + [check("containers", "containers", "Containers", "ok" if not problemas else "atencao",
                              f"{rodando} rodando" + (f", {len(problemas)} com problema" if problemas else ""))]


# ---------------------------------------------------------------- fluxos (n8n)

def fluxos() -> list[dict]:
    key = ler_env(HOME / ".hermes/.env", "N8N_API_KEY")
    if not key:
        return [check("n8n-api", "fluxos", "Fluxos do n8n", "atencao", "Sem chave de API para ler execuções")]
    h = {"X-N8N-API-KEY": key}
    try:
        wfs = http_json(f"{N8N}/api/v1/workflows?active=true&limit=100", h)["data"]
    except Exception as e:  # noqa: BLE001
        return [check("n8n-api", "fluxos", "Fluxos do n8n", "falha", f"API sem resposta: {str(e)[:100]}")]
    desde = agora() - timedelta(hours=24)
    out = []
    for w in wfs:
        try:
            ex = http_json(f"{N8N}/api/v1/executions?workflowId={w['id']}&limit=50", h)["data"]
        except Exception:  # noqa: BLE001
            ex = []
        recentes = [e for e in ex if e.get("startedAt") and datetime.fromisoformat(e["startedAt"].replace("Z", "+00:00")) >= desde]
        erros = [e for e in recentes if e.get("status") in ("error", "crashed")]
        ultima = ex[0] if ex else None
        link = f"{N8N_EDITOR}/workflow/{w['id']}"
        if not ultima:
            estado, det = "atencao", "Ainda não rodou"
        elif ultima.get("status") in ("error", "crashed"):
            estado, det = "falha", f"Última execução falhou ({len(erros)} falha(s) em 24 h)"
            link = f"{N8N_EDITOR}/workflow/{w['id']}/executions/{ultima['id']}"
        elif erros:
            estado, det = "atencao", f"{len(erros)} falha(s) em 24 h; a última deu certo"
        else:
            quando = datetime.fromisoformat(ultima["startedAt"].replace("Z", "+00:00"))
            det = f"Última execução ok às {quando.astimezone().strftime('%H:%M de %d/%m')}"
            estado = "ok"
        out.append(check(f"fluxo:{w['id']}", "fluxos", w["name"], estado, det, link))
    return out


# ---------------------------------------------------------------- dados

def pncp() -> dict:
    try:
        d = json.loads(PNCP_RUN.read_text())
    except OSError:
        return check("pncp", "dados", "Radar PNCP", "atencao", "Nenhuma coleta registrada")
    run_at = datetime.fromisoformat(d["run_at"].replace("Z", "+00:00"))
    hoje = agora().astimezone().date()
    if d.get("status", "completed") == "completed":
        if run_at.astimezone().date() == hoje:
            return check("pncp", "dados", "Radar PNCP", "ok",
                         f"Coletado hoje: {d['counts']['fetched']} registros, {d['counts']['qualified']} qualificado(s)")
        return check("pncp", "dados", "Radar PNCP", "atencao", f"Última coleta em {run_at.astimezone():%d/%m}")
    # Procura a última coleta completa no histórico para dizer há quanto tempo está parado.
    ultima_ok = None
    for f in sorted((PNCP_RUN.parent / "history").glob("*.json"), reverse=True):
        try:
            h = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        if h.get("status", "completed") == "completed":
            ultima_ok = datetime.fromisoformat(h["run_at"].replace("Z", "+00:00"))
            break
    dias = (agora() - ultima_ok).days if ultima_ok else None
    desde = f"sem dados há {dias} dia(s)" if dias is not None else "nunca coletou com sucesso"
    return check("pncp", "dados", "Radar PNCP", "falha", f"Fonte do governo indisponível ({d.get('error', '')[:60]}); {desde}")


# ---------------------------------------------------------------- rotinas do Hermes

AGENDAS = HOME / ".local/state/dell-status/agendas.json"
# O Hermes grava last_run_at no FIM da rodada; as rodadas levam até ~7 min.
FOLGA_CRON = timedelta(minutes=30)
MACROS_CRON = {"@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *",
               "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *"}
agendas_vistas: dict = {}  # preenchido por crons_hermes(); main() grava (fora do --stdout)


def _quando(txt) -> datetime | None:
    try:
        d = datetime.fromisoformat(str(txt).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.astimezone()


def _campo_cron(txt: str, menor: int, maior: int) -> set[int]:
    vals: set[int] = set()
    for parte in txt.split(","):
        faixa, _, passo = parte.partition("/")
        if faixa == "*":
            ini, fim = menor, maior
        elif "-" in faixa:
            ini, fim = (int(x) for x in faixa.split("-", 1))
        else:
            ini = int(faixa)
            fim = maior if passo else ini  # "5/15" = de 5 até o fim, de 15 em 15
        if not menor <= ini <= fim <= maior:
            raise ValueError(f"fora da faixa: {parte}")
        vals.update(range(ini, fim + 1, int(passo or 1)))
    return vals


def ultimo_disparo(expr: str, t: datetime) -> datetime | None:
    """Último horário <= t em que a expressão cron de 5 campos dispara, na hora
    local de t (a do Dell, que é a do Hermes). Aceita números, `*`, `,`, `-`,
    `/` e macros @daily etc.; nome de mês/dia levanta ValueError."""
    campos = MACROS_CRON.get(expr.strip(), expr).split()
    if len(campos) != 5:
        raise ValueError(f"esperava 5 campos: {expr!r}")
    minutos, horas, dias, meses = (_campo_cron(c, a, b) for c, (a, b)
                                   in zip(campos, ((0, 59), (0, 23), (1, 31), (1, 12))))
    semana = {d % 7 for d in _campo_cron(campos[4], 0, 7)}  # 0 e 7 = domingo
    # Regra do cron: com dia do mês E da semana restritos, basta um dos dois.
    um_basta = not campos[2].startswith("*") and not campos[4].startswith("*")
    t = t.replace(second=0, microsecond=0)
    for atras in range(367):
        d = (t - timedelta(days=atras)).date()
        no_dia, na_semana = d.day in dias, d.isoweekday() % 7 in semana
        if d.month not in meses or not ((no_dia or na_semana) if um_basta else (no_dia and na_semana)):
            continue
        for h in sorted(horas, reverse=True):
            for m in sorted(minutos, reverse=True):
                quando = datetime.combine(d, horario(h, m), tzinfo=t.tzinfo)
                if quando <= t:
                    return quando
    return None


def _agenda_coerente(j: dict) -> bool:
    """O último disparo registrado bate com a agenda atual? Se não bate, a
    agenda mudou depois dele e o horário antigo não pode ser cobrado."""
    ag = j.get("schedule") or {}
    marcado = _quando((j.get("last_dispatch") or {}).get("scheduled_at"))
    if ag.get("kind") != "cron" or not marcado:
        return True
    try:
        return ultimo_disparo(ag["expr"], marcado) == marcado.replace(second=0, microsecond=0)
    except (KeyError, ValueError):
        return True


def crons_hermes() -> list[dict]:
    """Um check por rotina ativa do Hermes (~/.hermes/cron/jobs.json, lido a cada
    minuto: rotina nova ou horário mudado no Hermes não exige mexer aqui).
    Falha quando a última rodada deu erro ou quando a rotina não rodou: cron sem
    rodada depois do último horário previsto + 30 min (em 29/09/2026 o gateway
    parou às 09:04 e o briefing das 09:00 sumiu calado); intervalo sem rodada há
    mais de 3 intervalos. Pausadas ficam de fora. Horário que mudou (ou rotina
    que voltou da pausa) só é cobrado a partir do disparo seguinte."""
    try:
        d = json.loads(CRON_JOBS.read_text())
    except (OSError, ValueError):
        return [check("crons", "dados", "Rotinas do Hermes", "atencao", "jobs.json ilegível")]
    jobs = d.get("jobs", d) if isinstance(d, dict) else d
    jobs = jobs.values() if isinstance(jobs, dict) else jobs
    try:
        vistas = json.loads(AGENDAS.read_text())
    except (OSError, ValueError):
        vistas = {}
    t = agora().astimezone()
    agendas_vistas.clear()
    out = []
    for j in jobs:
        jid = str(j.get("id") or j.get("name"))
        ag = j.get("schedule") or {}
        ativa = bool(j.get("enabled", True)) and j.get("state") not in ("paused", "completed")
        assinatura = json.dumps({"agenda": ag, "ativa": ativa}, sort_keys=True)
        ant = vistas.get(jid) or {}
        if ant.get("assinatura") == assinatura:
            desde = ant.get("desde") or iso(t)
        elif ant or not _agenda_coerente(j):
            desde = iso(t)
        else:  # primeira vez que o monitor vê a rotina, com a agenda de sempre
            desde = j.get("created_at") or iso(t)
        agendas_vistas[jid] = {"assinatura": assinatura, "desde": desde}
        if not ativa or ag.get("kind") not in ("cron", "interval"):
            continue
        nome = f"Rotina · {j.get('name') or jid}"
        agenda_txt = j.get("schedule_display") or ag.get("display") or ag.get("expr") or ""
        base = max(filter(None, (_quando(desde), _quando(j.get("created_at")))), default=t)
        ultima = _quando(j.get("last_run_at"))
        ultima_txt = f"{ultima.astimezone():%d/%m %H:%M}" if ultima else "nunca"
        if j.get("last_status") not in (None, "ok") or j.get("state") == "error":
            out.append(check(f"cron:{jid}", "dados", nome, "falha",
                             f"Última rodada ({ultima_txt}) deu erro: "
                             f"{str(j.get('last_error') or j.get('last_status'))[:100]}"))
            continue
        atraso = None
        try:
            if ag["kind"] == "cron":
                previsto = ultimo_disparo(ag["expr"], t - FOLGA_CRON)
                if previsto and previsto >= base and (not ultima or ultima < previsto):
                    atraso = f"Não rodou às {previsto:%H:%M de %d/%m} (última rodada: {ultima_txt})"
            else:
                passo = timedelta(minutes=float(ag.get("minutes") or 0))
                referencia = max(ultima, base) if ultima else base
                if passo and t - referencia > 3 * passo:
                    horas = (t - referencia).total_seconds() / 3600
                    atraso = f"Sem rodar há {horas:.0f} h ({agenda_txt}; última rodada: {ultima_txt})"
        except (KeyError, ValueError, TypeError) as e:
            out.append(check(f"cron:{jid}", "dados", nome, "atencao", f"Agenda não entendida ({agenda_txt}): {e}"))
            continue
        if atraso:
            out.append(check(f"cron:{jid}", "dados", nome, "falha", atraso))
        else:
            out.append(check(f"cron:{jid}", "dados", nome, "ok", f"Última rodada ok em {ultima_txt} · {agenda_txt}"))
    return out


# ---------------------------------------------------------------- gerador de sites

GERADOR_LOGS = HOME / "auto-site/.logs"


def _unit_resultado(unit: str) -> tuple[str, datetime | None]:
    """(Result, fim da última execução) do systemd para a unit."""
    r = subprocess.run(["systemctl", "--user", "show", unit, "-p", "Result", "-p", "ExecMainExitTimestamp",
                        "--timestamp=unix"], capture_output=True, text=True, timeout=10)
    campos = dict(l.split("=", 1) for l in r.stdout.splitlines() if "=" in l)
    fim = campos.get("ExecMainExitTimestamp", "").lstrip("@")
    return campos.get("Result", ""), datetime.fromtimestamp(float(fim), timezone.utc) if fim else None


def gerador() -> list[dict]:
    """Gerador de sites (gerador-de-sites.py), pelo resumo que o próprio runner
    grava em ~/auto-site/.logs/status.json. Falha: execução com falha e nenhum
    site, `erro` do runner (sem login, SIGTERM, bug), runner morto no meio de um
    lead, ou o systemd registrando falha depois do último resumo (runner que
    nem chegou a gravar). Lead descartado pelo Claude não é falha."""
    nome = "Gerador de sites"
    try:
        st = json.loads((GERADOR_LOGS / "status.json").read_text(encoding="utf-8"))
    except OSError:
        return [check("gerador", "dados", nome, "atencao", "Ainda não rodou (sem ~/auto-site/.logs/status.json)")]
    except ValueError:
        return [check("gerador", "dados", nome, "atencao", "status.json do gerador ilegível")]
    diario = "journalctl --user -u gerador-de-sites"
    if st.get("estado") == "processando":
        lead, inicio = st.get("lead", "?"), _quando(st.get("inicio"))
        desde = f"{inicio.astimezone():%H:%M}" if inicio else "?"
        try:
            dono = json.loads((GERADOR_LOGS / "gerador.lock").read_text(encoding="utf-8"))
            vivo = dono.get("host") != socket.gethostname() or Path(f"/proc/{dono.get('pid')}").exists()
        except (OSError, ValueError):
            vivo = False
        if vivo:
            return [check("gerador", "dados", nome, "ok", f"Gerando {lead} desde {desde}")]
        return [check("gerador", "dados", nome, "falha",
                      f"O runner morreu no meio de {lead} (começou {desde}) sem gravar resumo. Veja {diario}")]
    r = st.get("ultimo_resumo") or {}
    fim = _quando(r.get("fim"))
    quando = f"{fim.astimezone():%d/%m %H:%M}" if fim else "data desconhecida"
    concluidos, falhas = r.get("concluidos") or [], r.get("falhas") or []
    descartados, sumidos = r.get("descartados") or [], r.get("sumidos") or []
    resumo = (f"{len(concluidos)} site(s) publicado(s), {len(falhas)} falha(s)"
              + (f", {len(descartados)} descartado(s) pelo Claude" if descartados else "")
              + (f", {len(sumidos)} pasta(s) sumida(s)" if sumidos else "")
              + f"; {r.get('pendentes', '?')} na fila")
    try:
        resultado, saiu = _unit_resultado("gerador-de-sites.service")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        resultado, saiu = "", None
    if resultado not in ("", "success") and saiu and (not fim or saiu - fim > timedelta(minutes=1)):
        return [check("gerador", "dados", nome, "falha",
                      f"O runner caiu às {saiu.astimezone():%d/%m %H:%M} sem gravar resumo (systemd: {resultado}). "
                      f"Veja {diario}")]
    if r.get("erro"):
        return [check("gerador", "dados", nome, "falha", f"Execução de {quando} parou: {r['erro']}"[:300])]
    if falhas and not concluidos:
        return [check("gerador", "dados", nome, "falha",
                      f"Execução de {quando} sem nenhum site: {resumo}. {falhas[0]}"[:300])]
    if falhas or sumidos:
        return [check("gerador", "dados", nome, "atencao", f"Execução de {quando}: {resumo}. Veja ~/auto-site/.logs")]
    return [check("gerador", "dados", nome, "ok", f"Execução de {quando}: {resumo}")]


# ---------------------------------------------------------------- pendências (o que depende do Rômulo)

ESTADO_N8N = HOME / ".local/share/n8n-estado"
AUTO = HOME / "auto-site"


def pendencias() -> list[dict]:
    """Não é saúde: é fila de trabalho humano. `atencao` quando há algo esperando,
    e nunca vira WhatsApp (só `falha` vira)."""
    out = []
    fila = [d for d in AUTO.iterdir() if d.is_dir() and not d.name.startswith(("_", "."))
            and (d / "content.md").is_file() and not (d / "publicado.json").is_file()] if AUTO.is_dir() else []
    out.append(check("pend:sites-fila", "pendencias", "Sites na fila do gerador", "atencao" if fila else "ok",
                     f"{len(fila)} lead(s) com pasta e sem site publicado. O gerador do Dell faz até 4 por dia "
                     "às 08h; para adiantar, rode /lead-novo numa sessão do Claude em ~/auto-site."))
    for arq in sorted(ESTADO_N8N.glob("*.json")) if ESTADO_N8N.is_dir() else []:
        try:
            d = json.loads(arq.read_text())
            gerado = datetime.fromisoformat(d["geradoEm"].replace("Z", "+00:00"))
        except (OSError, ValueError, KeyError):
            continue
        velho = agora() - gerado > timedelta(hours=26)
        for item in d.get("itens", []):
            qtd = int(item.get("quantidade") or 0)
            detalhe = (f"{qtd} · " if qtd else "") + str(item.get("detalhe", ""))
            if velho:
                detalhe += f" (contagem de {gerado.astimezone():%d/%m %H:%M})"
            out.append(check(f"pend:{item['id']}", "pendencias", str(item["nome"]), "atencao" if qtd else "ok",
                             detalhe, item.get("link")))
    return out


# ---------------------------------------------------------------- backup (Dell → Drive)

BACKUP_STATUS = HOME / ".local/state/backup-dell/status.json"


def backup() -> list[dict]:
    """Um check por fonte do backup-dell (deploy/dell/backup), pela idade do
    último sucesso: uma rodada ruim isolada é só atenção na Central; o que fica
    sem sucesso além do limite da fonte vira falha e, portanto, WhatsApp."""
    try:
        d = json.loads(BACKUP_STATUS.read_text(encoding="utf-8"))
    except OSError:
        return [check("backup", "dados", "Backup no Drive", "atencao", "Ainda não rodou (backup-dell)")]
    except ValueError:
        return [check("backup", "dados", "Backup no Drive", "atencao", "status.json do backup ilegível")]
    out = []
    t = agora()
    for fid, f in sorted(d.get("fontes", {}).items()):
        nome = f"Backup · {f.get('nome', fid)}"
        detalhe = str(f.get("detalhe") or "")
        ok_em = f.get("ultimo_sucesso")
        idade = (t - datetime.fromisoformat(ok_em)).total_seconds() / 3600 if ok_em else None
        if f.get("tipo") == "ensaio":
            if idade is None:
                estado = "atencao" if f.get("estado") != "falha" else "falha"
                detalhe = detalhe or "Ensaio de restauração ainda não rodou"
            elif idade > 35 * 24:
                estado, detalhe = "atencao", f"Último ensaio ok em {datetime.fromisoformat(ok_em):%d/%m}; o próximo cofre roda outro"
            else:
                estado = "ok"
        elif idade is None:
            estado, detalhe = "atencao", f"Ainda sem sucesso. {detalhe}".strip()
        elif idade > f.get("falha_h", 24):
            estado, detalhe = "falha", f"Sem backup há {idade:.0f} h. {detalhe}".strip()
        elif idade > f.get("atencao_h", 3) or f.get("estado") in ("falha", "atencao"):
            estado = "atencao"
        else:
            estado = "ok"
        if f.get("tipo") == "cofre" and f.get("check") == "falha":
            estado, detalhe = "falha", f"restic check falhou: {f.get('check_detalhe', '')}"
        out.append(check(f"backup:{fid}", "dados", nome, estado, detalhe))
    return out


# ---------------------------------------------------------------- fora do Dell (Easypanel)

def easypanel() -> list[dict]:
    """Do Easypanel, só o SquadOne (agendas) é do ecossistema do Dell. O n8n de
    lá (Silmer, Food Helper) não é conferido: não é do Dell, e cair ou falhar
    não deve virar aviso "Dell worker" no WhatsApp (decisão de 24/09/2026)."""
    out = []
    # SquadOne (agendas) público: 403 é o porteiro de IP respondendo, ou seja, no ar.
    try:
        req = urllib.request.Request("https://aladdin-squadone-app.jicnzg.easypanel.host/")
        with urllib.request.urlopen(req, timeout=10) as r:
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
    except Exception:  # noqa: BLE001
        status = 0
    out.append(check("squadone-app", "servicos", "SquadOne (agendas, Easypanel)", "ok" if 0 < status < 500 else "falha",
                     "No ar" if 0 < status < 500 else f"Sem resposta (HTTP {status or 'nenhum'})",
                     "https://aladdin-squadone-app.jicnzg.easypanel.host/"))
    return out


# ---------------------------------------------------------------- máquina

def maquina() -> list[dict]:
    out = []
    uso = shutil.disk_usage(HOME)
    pct = round(100 * uso.used / uso.total)
    out.append(check("disco", "maquina", "Disco", "falha" if pct >= 95 else "atencao" if pct >= 85 else "ok", f"{pct}% usado"))
    mem = {l.split(":")[0]: int(l.split()[1]) for l in Path("/proc/meminfo").read_text().splitlines() if l.split()[1:]}
    livre = round(100 * mem["MemAvailable"] / mem["MemTotal"])
    out.append(check("memoria", "maquina", "Memória", "atencao" if livre < 10 else "ok", f"{livre}% livre"))
    falhas = 0
    for _ in range(3):
        try:
            socket.getaddrinfo("oauth2.googleapis.com", 443)
        except OSError:
            falhas += 1
    out.append(check("dns", "maquina", "Internet e DNS", "falha" if falhas == 3 else "atencao" if falhas else "ok",
                     "Resolvendo nomes normalmente" if not falhas else f"{falhas}/3 consultas de DNS falharam"))
    return out


# ---------------------------------------------------------------- avisos

def enviar(msg: str) -> bool:
    try:
        r = subprocess.run([str(HERMES), "send", "--to", DESTINO, "-q", msg], capture_output=True, text=True, timeout=120)
        return r.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def drenar_fila() -> None:
    """Avisos gravados por containers: {"texto", "titulo"?}. Ilegível também avisa."""
    if not FILA.is_dir():
        return
    for f in sorted(FILA.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            msg = f"{d.get('titulo') or '🧭 Operação'}\n{str(d['texto']).strip()}"
        except (OSError, ValueError, KeyError) as e:
            msg = f"🧭 Operação\nAviso ilegível na fila ({f.name}): {e}"
        if enviar(msg):
            f.unlink(missing_ok=True)


def avisar_transicoes(checks: list[dict], estado_ant: dict, t: datetime) -> dict:
    novo, quebrou, voltou, lembrar = {}, [], [], []
    for c in checks:
        ant = estado_ant.get(c["id"], {})
        desde = ant.get("desde", iso(t)) if ant.get("estado") == c["estado"] else iso(t)
        avisado = ant.get("avisado") if ant.get("estado") == c["estado"] else None
        if c["estado"] == "falha":
            if ant.get("estado") != "falha" or ant.get("pendente"):
                quebrou.append(c)
                avisado = iso(t)
            elif not avisado or t - datetime.fromisoformat(avisado.replace("Z", "+00:00")) > timedelta(hours=LEMBRETE_FALHA_H):
                lembrar.append(c)
                avisado = iso(t)
        elif ant.get("estado") == "falha":
            voltou.append(c)
        novo[c["id"]] = {"estado": c["estado"], "desde": desde, **({"avisado": avisado} if avisado else {})}
    # Itens que sumiram (ex.: container removido) não geram aviso.
    linhas = []
    if quebrou:
        linhas += ["Quebrou:"] + [f"• {c['nome']}: {c['detalhe']}" for c in quebrou]
    if lembrar:
        linhas += ["Continua fora:"] + [f"• {c['nome']}: {c['detalhe']}" for c in lembrar]
    if voltou:
        linhas += ["Voltou ao normal:"] + [f"• {c['nome']}" for c in voltou]
    if linhas:
        titulo = "⚠️ Dell worker" if (quebrou or lembrar) else "✅ Dell worker"
        if not enviar(titulo + "\n" + "\n".join(linhas) + "\nDetalhes: http://127.0.0.1:9120/"):
            # WhatsApp fora: nada fica marcado como avisado e o próximo minuto tenta de novo.
            for c in quebrou + lembrar:
                novo[c["id"]].pop("avisado", None)
                novo[c["id"]]["pendente"] = True
    return novo


def gravar(path: Path, dados: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False, indent=1))
    tmp.replace(path)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--stdout", action="store_true", help="só imprime; não grava nem avisa")
    a = p.parse_args()
    t = agora()
    checks = []
    for fn in (servicos, containers, fluxos, maquina, crons_hermes, gerador, pendencias, easypanel, backup):
        try:
            checks += fn()
        except Exception as e:  # noqa: BLE001 — uma verificação quebrada não cala as outras
            checks.append(check(f"erro:{fn.__name__}", "maquina", f"Verificação {fn.__name__}", "atencao", str(e)[:120]))
    try:
        checks.append(pncp())
    except Exception as e:  # noqa: BLE001
        checks.append(check("pncp", "dados", "Radar PNCP", "atencao", str(e)[:120]))
    snapshot = {"geradoEm": iso(t), "verificacoes": checks}
    if a.stdout:
        print(json.dumps(snapshot, ensure_ascii=False, indent=1))
        return
    try:
        estado_ant = json.loads(ESTADO.read_text())
    except (OSError, ValueError):
        estado_ant = {}
    estado = avisar_transicoes(checks, estado_ant, t)
    for c in checks:
        c["desde"] = estado[c["id"]]["desde"]
    gravar(ESTADO, estado)
    gravar(SAIDA, snapshot)
    if agendas_vistas:
        gravar(AGENDAS, agendas_vistas)
    drenar_fila()


if __name__ == "__main__":
    main()
