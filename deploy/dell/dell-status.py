#!/usr/bin/env python3
"""Retrato do Dell worker a cada minuto: grava o estado para a Central e avisa
o Rômulo pelo Hermes (WhatsApp) quando algo quebra e quando volta.

Uma verificação é {id, grupo, nome, estado, detalhe, link?, o_que_fazer?,
acao?, sozinho?}. `estado` é `ok`, `atencao` ou `falha`. Só `falha` vira
WhatsApp: `atencao` aparece na Central e não interrompe ninguém. Vermelho quer
dizer "você precisa agir, ou está quebrado agora"; amarelo, "vale olhar".
`o_que_fazer` diz, em uma ou duas frases, o que aquilo significa e o que o
Rômulo faz (ou "nada — resolve sozinho quando…", com `sozinho: true`); `acao`
({rotulo, url}) é o link que resolve, quando existe (URL http(s) ou rota da
Central, como /crm). Os três campos são opcionais: quem lê status.json sem
eles continua funcionando.

Também esvazia a fila de avisos (~/.local/share/avisos/fila/*.json) que os
containers (n8n, collector) e os scripts do Dell gravam, para que um fluxo
sempre "responda a alguém" sem abrir rede nem firewall entre container e host.
Formato, teto, silêncio e deduplicação: ver "fila de avisos" abaixo.

Somente biblioteca padrão. Uso:
  dell-status                 # verifica, grava status.json, avisa e drena a fila
  dell-status --stdout        # só imprime o JSON; não grava nem avisa
  dell-status --drenar        # só drena a fila (com flock), sem verificar nada
  dell-status --visto-recusados todos|ARQUIVO...   # dá o visto em aviso recusado (apaga o vermelho)
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from datetime import time as horario
from pathlib import Path
from zoneinfo import ZoneInfo

HOME = Path.home()
SAIDA = HOME / ".local/share/squadone-operations/status.json"
ESTADO = HOME / ".local/state/dell-status/estado.json"
FILA = HOME / ".local/share/avisos/fila"
HERMES = HOME / ".local/bin/hermes"
# "whatsapp" = WHATSAPP_HOME_CHANNEL do .env do Hermes. Era "whatsapp:Rômulo Sutil", um nome do
# diretório de canais preso ao chat da conta pareada: no chip novo (09/10/2026) mandaria do número
# novo para o antigo. Trocar de chip agora é só o canal principal.
DESTINO = os.environ.get("AVISOS_DESTINO", "whatsapp")
N8N = "http://127.0.0.1:5679"
N8N_EDITOR = "http://127.0.0.1:5679"
PNCP_RUN = HOME / "licitacoes-automation/data/latest-run.json"
# Marca de "radar pausado de propósito" (11/10/2026): sem ela, a última coleta ficaria velha e o
# Radar PNCP viraria amarelo para sempre. O conteúdo do arquivo é só a data/nota da pausa.
PNCP_PAUSA = HOME / ".local/state/dell-status/pausa-pncp"
CRON_JOBS = HOME / ".hermes/cron/jobs.json"
LEMBRETE_FALHA_H = 12  # falha que continua é relembrada, não repetida a cada minuto
# O aviso do WhatsApp é lido no celular: o link é o da tailnet, não o loopback.
CENTRAL = "https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net:8443/"
N8N_CONTAINER = "licitacoes-automation-n8n-1"


def agora() -> datetime:
    return datetime.now(timezone.utc)


def iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def check(id_: str, grupo: str, nome: str, estado: str, detalhe: str, link: str | None = None,
          o_que_fazer: str | None = None, acao: tuple[str, str] | None = None, sozinho: bool = False) -> dict:
    c = {"id": id_, "grupo": grupo, "nome": nome, "estado": estado, "detalhe": detalhe}
    if link:
        c["link"] = link
    if o_que_fazer:
        c["o_que_fazer"] = o_que_fazer
    if acao:
        c["acao"] = {"rotulo": acao[0], "url": acao[1]}
    if sozinho:
        c["sozinho"] = True
    return c


def _hm(d: datetime, t: datetime | None = None) -> str:
    """HH:MM se for hoje (hora do Dell); senão HH:MM de dd/mm."""
    local = d.astimezone()
    return f"{local:%H:%M}" if local.date() == (t or agora()).astimezone().date() else f"{local:%H:%M de %d/%m}"


def ligado_desde() -> datetime | None:
    """Quando o Dell ligou (btime do kernel)."""
    try:
        for linha in Path("/proc/stat").read_text().splitlines():
            if linha.startswith("btime "):
                return datetime.fromtimestamp(int(linha.split()[1]), timezone.utc)
    except (OSError, ValueError):
        pass
    return None


def n8n_no_ar_desde() -> datetime | None:
    """Quando o container do n8n subiu pela última vez."""
    try:
        r = subprocess.run(["docker", "inspect", "-f", "{{.State.StartedAt}}", N8N_CONTAINER],
                           capture_output=True, text=True, timeout=10)
        txt = re.sub(r"\.\d+", "", r.stdout.strip())
        return datetime.fromisoformat(txt.replace("Z", "+00:00")) if r.returncode == 0 and txt else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def _parado_em(previsto: datetime, ligado: datetime | None, n8n: datetime | None) -> str | None:
    """Se o horário previsto caiu com o Dell (ou o n8n) fora do ar, diz isso."""
    if ligado and previsto < ligado:
        return f"o Dell estava desligado (ligou às {_hm(ligado)})"
    if n8n and previsto < n8n:
        return f"o n8n estava fora do ar (voltou às {_hm(n8n)})"
    return None


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
    out.append(whatsapp_sessao())
    return out


WHATSAPP_HEALTH = "http://127.0.0.1:3000/health"


def avaliar_whatsapp(resposta, erro: str | None = None) -> dict:
    """`status` do /health da bridge do Hermes. Gateway "active" não basta: em
    06/10/2026 a sessão caiu (Logged out) e a bridge morria em laço com o
    gateway de pé; os avisos ficavam na fila sem ninguém saber.

    A bridge do Hermes diz `connected`/`disconnected` (bridge.js, connectionState);
    `open` é o nome cru do Baileys e vale também, caso uma versão o repasse."""
    status = resposta.get("status") if isinstance(resposta, dict) else None
    if status in ("connected", "open"):
        return check("whatsapp-sessao", "servicos", "Sessão do WhatsApp", "ok", "Conectada (bridge do Hermes)")
    detalhe = (f"Bridge responde, mas a sessão está '{status}'" if status
               else f"Bridge do WhatsApp sem resposta em :3000 ({(erro or 'resposta sem status')[:80]})")
    return check("whatsapp-sessao", "servicos", "Sessão do WhatsApp", "falha", detalhe,
                 o_que_fazer=("Nenhum aviso chega pelo WhatsApp (ficam na fila e saem quando voltar) — inclusive "
                              "este. Se ~/.hermes/whatsapp/bridge.log diz 'Logged out', a sessão foi desconectada "
                              "no celular: refaça o pareamento do WhatsApp do Hermes no Dell (QR code no celular). "
                              "Se não, peça ao Claude: \"o WhatsApp do Hermes caiu\"."))


def whatsapp_sessao() -> dict:
    try:
        return avaliar_whatsapp(http_json(WHATSAPP_HEALTH, timeout=5))
    except Exception as e:  # noqa: BLE001 — qualquer erro vira "sem resposta"
        return avaliar_whatsapp(None, str(getattr(e, "reason", e)))


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

FLUXOS_VISTOS = HOME / ".local/state/dell-status/fluxos.json"
ERRO_N8N = ("error", "crashed")
FOLGA_FLUXO = timedelta(minutes=15)  # startedAt é a hora do disparo; 15 min cobre fila e relógio
SEM_REGISTRO_OK = timedelta(minutes=30)
# Gatilhos que só rodam quando alguém chama: não rodar não é problema.
ESPERA = {"webhook": "um clique ou uma chamada (webhook)", "formTrigger": "uma resposta do formulário",
          "errorTrigger": "a falha de outro fluxo", "manualTrigger": "alguém rodar à mão",
          "executeWorkflowTrigger": "outro fluxo chamar"}
# O que cada fluxo muda para o Rômulo quando falha (pelo começo do nome no n8n).
DICAS_DO_FLUXO = {
    "00 · Avisar falha": "É ele que avisa as falhas dos outros fluxos: parado, as falhas ficam caladas.",
    "01 · Caçador": "Sem ele não entram leads novos no dia; a fila do gerador segue.",
    "03 · Balcão": "Sem ele os sites novos não viram \"pronto\" nem ganham o link de envio.",
    "04 · Clique no wa_link": "O clique que falhou não marcou o lead como enviado: confira no CRM.",
    "05 · Acompanhamento": "Sem ele não chegam os follow-ups do 3º dia nem a expiração do 10º.",
    "07 · Lead": "Sem ele a página do lead (Recusou, Fechou, Desfazer) não abre.",
    "08 · CRM": "O CRM mostra o último retrato bom e diz que está velho.",
    "PRUMO — Clique em Enviar convite": "O clique que falhou não marcou o convite: confira no CRM (PRUMO).",
    "PRUMO — Diagnóstico": "Formulário respondido fica sem Índice e sem rascunho do Mapa até rodar.",
    "PRUMO — Lead Scout": "Sem ele não entram prospects novos no dia.",
    "Radar PNCP": "A repescagem das 08:00 (pncp-catchup) refaz a coleta perdida: veja \"Radar PNCP\" em Dados.",
    "WhatsApp —": "O observador repete sozinho (1, 4 e 16 min, depois de hora em hora): corrigida a causa, nada se perde.",
}
fluxos_vistos: dict = {}  # preenchido por fluxos(); main() grava (fora do --stdout)


def _dica_do_fluxo(nome: str) -> str:
    return next((d for prefixo, d in DICAS_DO_FLUXO.items() if nome.startswith(prefixo)), "")


def regra_para_cron(r: dict) -> str | None:
    """Uma regra do Schedule Trigger do n8n em cron de 5 campos. None = não cabe
    num cron (ex.: "a cada 2 semanas") e o horário não é cobrado."""
    campo = r.get("field") or "days"
    h, m = int(r.get("triggerAtHour") or 0), int(r.get("triggerAtMinute") or 0)
    if campo == "cronExpression":
        partes = str(r.get("expression") or "").split()
        if len(partes) == 6:
            partes = partes[1:]  # o n8n aceita os segundos na frente
        return " ".join(partes) if len(partes) == 5 else None
    if campo == "seconds":
        return "* * * * *"
    if campo == "minutes":
        return f"*/{int(r.get('minutesInterval') or 5)} * * * *"
    if campo == "hours":
        return f"{m} */{int(r.get('hoursInterval') or 1)} * * *"
    if campo == "days":
        n = int(r.get("daysInterval") or 1)
        return f"{m} {h} {'*' if n == 1 else f'*/{n}'} * *"
    if campo == "weeks":
        if int(r.get("weeksInterval") or 1) != 1:
            return None
        dias = r.get("triggerAtDay") or [0]
        return f"{m} {h} * * {','.join(str(int(d)) for d in dias)}"
    if campo == "months":
        n = int(r.get("monthsInterval") or 1)
        return f"{m} {h} {int(r.get('triggerAtDayOfMonth') or 1)} {'*' if n == 1 else f'*/{n}'} *"
    return None


def gatilhos(w: dict) -> tuple[list[str], list[str]]:
    """(agendas em cron, o que o fluxo espera) dos gatilhos ligados do fluxo."""
    agendas, espera = [], []
    for n in w.get("nodes") or []:
        if n.get("disabled"):
            continue
        tipo = str(n.get("type", "")).rsplit(".", 1)[-1]
        if tipo == "scheduleTrigger":
            for r in ((n.get("parameters") or {}).get("rule") or {}).get("interval") or [{}]:
                try:
                    expr = regra_para_cron(r)
                    if expr:
                        ultimo_disparo(expr, agora())  # valida
                        agendas.append(expr)
                except (ValueError, TypeError):
                    continue
        elif tipo in ESPERA and ESPERA[tipo] not in espera:
            espera.append(ESPERA[tipo])
    return agendas, espera


def classificar_erro(msg: str, descricao: str = "", no: str | None = None) -> dict:
    """Causa de uma execução que falhou, em português e sem números longos
    (a mensagem de um nó pode trazer telefone ou linha da planilha)."""
    tudo = f"{msg} {descricao}".lower()
    cred = re.search(r'credential "([^"]+)"', msg)
    if any(x in tudo for x in ("reconnect", "invalid_grant", "refresh token", "revoked", "access token",
                               "unauthorized", "invalid credentials")):
        causa = {"tipo": "credencial", "texto": "a credencial do Google precisa ser reconectada"}
        if cred:
            causa["credencial"] = cred.group(1)
    elif any(x in tudo for x in ("econnrefused", "etimedout", "enotfound", "eai_again", "timeout", "socket hang up", "503", "502")):
        causa = {"tipo": "rede", "texto": "um serviço não respondeu"}
    elif any(x in tudo for x in ("429", "quota", "rate limit", "too many requests")):
        causa = {"tipo": "cota", "texto": "o Google limitou o uso da API"}
    else:
        causa = {"tipo": "outro", "texto": re.sub(r"\d{8,}", "…", msg.strip())[:100] or "erro sem mensagem"}
    if no:
        causa["no"] = str(no)[:60]
    return causa


def _causa_da_falha(h: dict, eid, w: dict) -> dict:
    try:
        e = http_json(f"{N8N}/api/v1/executions/{eid}?includeData=true", h, timeout=15)
    except Exception:  # noqa: BLE001 — sem a causa, o alerta sai sem ela
        return {}
    rd = (e.get("data") or {}).get("resultData") or {}
    err = rd.get("error") or {}
    causa = classificar_erro(str(err.get("message") or ""), str(err.get("description") or ""),
                             rd.get("lastNodeExecuted") or (err.get("node") or {}).get("name"))
    if causa["tipo"] == "credencial" and "credencial" not in causa:
        # A mensagem nem sempre diz qual credencial: o nó que falhou diz.
        no = next((n for n in w.get("nodes") or [] if n.get("name") == causa.get("no")), {})
        nomes = [c.get("name") for c in (no.get("credentials") or {}).values() if isinstance(c, dict) and c.get("name")]
        if nomes:
            causa["credencial"] = nomes[0]
    return causa


def _o_que_fazer_na_falha(causa: dict | None, agendado: bool, proxima: datetime | None, dica: str, t: datetime) -> str:
    depois = (f"a próxima rodada, às {_hm(proxima, t)}, volta sozinha (ou rode o fluxo agora no n8n)" if agendado and proxima
              else "abra esta execução no n8n e clique em Retry para refazer o que ficou sem marcar")
    tipo = (causa or {}).get("tipo")
    if tipo == "credencial":
        txt = (f"Reconecte a credencial \"{causa.get('credencial', 'Google')}\" no n8n (Credentials › abrir › "
               f"Reconnect, com a conta do Google). Depois disso, {depois}.")
    elif tipo in ("rede", "cota"):
        txt = (f"Costuma passar sozinho: {depois}. Se falhar de novo, peça ao Claude."
               if agendado else f"Quando o serviço voltar, {depois}.")
    elif agendado:
        txt = (f"Abra a execução e veja o erro. A próxima rodada{f', às {_hm(proxima, t)},' if proxima else ''} "
               "tenta de novo; se falhar outra vez, peça ao Claude.")
    else:
        txt = "Abra a execução e veja o erro; corrigida a causa, clique em Retry. Sem saber a causa, peça ao Claude."
    return f"{txt} {dica}".strip()


def avaliar_fluxo(w: dict, execucoes: list[dict], mem: dict, t: datetime, ligado: datetime | None = None,
                  n8n: datetime | None = None, primeira_leitura: bool = False) -> tuple[dict, dict]:
    """PURO: um fluxo ativo do n8n + execuções (mais recente primeiro) + memória
    do monitor → (verificação, memória nova). A memória guarda a última execução
    vista, porque o n8n apaga as antigas (EXECUTIONS_DATA_MAX_AGE, em horas).

    - Só webhook/clique/formulário/erro: não rodar é normal ("espera um clique").
    - Agendado: cobrado pelo último horário da agenda (+15 min), só a partir da
      versão atual do fluxo; horário que caiu com o Dell ou o n8n fora do ar é
      atenção que resolve sozinha (o n8n não repete rodada perdida).
    - Fluxo que não guarda as execuções boas (saveDataSuccessExecution=none):
      a última falha só é "falha agora" por 30 min; depois, atenção sozinha."""
    wid, nome = w["id"], w["name"]
    link = f"{N8N_EDITOR}/workflow/{wid}"
    so_erros = (w.get("settings") or {}).get("saveDataSuccessExecution") == "none"
    agendas, espera = gatilhos(w)
    mem = dict(mem)
    exs = [e for e in execucoes if _quando(e.get("startedAt"))]
    if exs:
        e0, ant = exs[0], mem.get("ultima") or {}
        if not ant or _quando(e0["startedAt"]) >= (_quando(ant.get("em")) or t - timedelta(days=3650)):
            mem["ultima"] = {"id": e0.get("id"), "status": e0.get("status"), "em": e0["startedAt"]}
    if "visto_desde" not in mem:
        # Primeira leitura do monitor: vale a versão atual do fluxo. Fluxo que
        # aparece depois (acabou de ser ativado) só é cobrado dali em diante.
        mem["visto_desde"] = (w.get("updatedAt") or w.get("createdAt") or iso(t)) if primeira_leitura else iso(t)
    ultima = mem.get("ultima")
    quando_ult = _quando(ultima["em"]) if ultima else None
    base = max(filter(None, (_quando(w.get("createdAt")), _quando(w.get("updatedAt")), _quando(mem["visto_desde"]))),
               default=t)
    proxima = min(filter(None, (proximo_disparo(a, t) for a in agendas)), default=None)
    dica = _dica_do_fluxo(nome)
    erros24 = [_quando(e["startedAt"]) for e in exs
               if e.get("status") in ERRO_N8N and _quando(e["startedAt"]) >= t - timedelta(hours=24)]

    def saida(estado, detalhe, link_=link, o=None, sozinho=False):
        return check(f"fluxo:{wid}", "fluxos", nome, estado, detalhe, link_, o, sozinho=sozinho), mem

    # 1) A última execução falhou.
    if ultima and ultima.get("status") in ERRO_N8N and not (so_erros and t - quando_ult > timedelta(hours=24)):
        causa = mem.get("causa") if (mem.get("causa") or {}).get("id") == ultima.get("id") else None
        motivo = f" ({causa['no']}: {causa['texto']})" if causa and causa.get("no") else (f" ({causa['texto']})" if causa else "")
        link_ex = f"{link}/executions/{ultima['id']}"
        n = max(len(erros24), 1)
        if so_erros and t - quando_ult > SEM_REGISTRO_OK:
            primeira = min(erros24, default=quando_ult)
            det = (f"{n} falhas entre {_hm(primeira, t)} e {_hm(quando_ult, t)}{motivo}; nenhuma desde então" if n > 1
                   else f"Falhou às {_hm(quando_ult, t)}{motivo}; nenhuma falha desde então")
            o = ("Nada, se a causa já passou: este fluxo não guarda as execuções que dão certo e não falhou mais. "
                 "Sai daqui 24 h depois da última falha.")
            return saida("atencao", det, link_ex, f"{o} {dica}".strip(), True)
        det = f"Última execução falhou às {_hm(quando_ult, t)}{motivo}" + (f" · {n} falhas em 24 h" if n > 1 else "")
        return saida("falha", det, link_ex, _o_que_fazer_na_falha(causa, bool(agendas), proxima, dica, t))

    # 2) Agendado e não rodou no horário (quem não guarda as boas não dá para cobrar).
    if agendas and not so_erros:
        previstos = [p for p in (ultimo_disparo(a, (t - FOLGA_FLUXO).astimezone()) for a in agendas) if p]
        previsto = max(previstos, default=None)
        if previsto and previsto >= base and (not quando_ult or quando_ult < previsto):
            prox = f"às {_hm(proxima, t)}" if proxima else "no próximo horário"
            parado = _parado_em(previsto, ligado, n8n)
            if parado:
                o = (f"Nada: o n8n não repete rodada perdida; a próxima é {prox}. Se precisar antes, abra o fluxo "
                     "no n8n e clique em Execute workflow.")
                return saida("atencao", f"Não rodou às {_hm(previsto, t)}: {parado}", link, f"{o} {dica}".strip(), True)
            ult_txt = _hm(quando_ult, t) if quando_ult else "nenhuma registrada"
            o = ("O gatilho não disparou com o n8n no ar. Confira no n8n se o fluxo está ativo; se estiver, peça ao "
                 f"Claude: \"o fluxo {nome} não rodou no horário\".")
            return saida("falha", f"Não rodou às {_hm(previsto, t)} (última execução: {ult_txt})", link, o)

    # 3) Falhou nas últimas 24 h, mas a execução seguinte deu certo.
    if erros24:
        o = "Nada: já voltou a funcionar. Sai daqui 24 h depois da última falha."
        return saida("atencao", f"{len(erros24)} falha(s) em 24 h, a última às {_hm(max(erros24), t)}; "
                     f"depois deu certo ({_hm(quando_ult, t)})", link, o, True)

    # 4) Tudo certo.
    prox_txt = f"; próxima às {_hm(proxima, t)}" if proxima else ""
    quem = " ou ".join(espera) or "ser chamado"
    if so_erros:
        det = "Sem falha registrada em 24 h (este fluxo não guarda as execuções que dão certo)"
    elif ultima and ultima.get("status") in ("running", "new", "waiting"):
        det = f"Rodando desde {_hm(quando_ult, t)}"
    elif ultima and not agendas:
        det = f"Última chamada ok às {_hm(quando_ult, t)} · espera {quem}"
    elif ultima:
        det = f"Última execução ok às {_hm(quando_ult, t)}{prox_txt}"
    elif agendas:
        det = f"Ainda não rodou; a primeira rodada é às {_hm(proxima, t)}" if proxima else "Ainda não rodou"
    else:
        det = f"Espera {quem}: ainda não foi chamado"
    return saida("ok", det)


def fluxos() -> list[dict]:
    key = ler_env(HOME / ".hermes/.env", "N8N_API_KEY")
    if not key:
        return [check("n8n-api", "fluxos", "Fluxos do n8n", "atencao", "Sem chave de API para ler execuções",
                      o_que_fazer="O monitor não consegue ler os fluxos (falta N8N_API_KEY em ~/.hermes/.env). "
                                  "Peça ao Claude recolocar a chave.")]
    h = {"X-N8N-API-KEY": key}
    try:
        wfs = http_json(f"{N8N}/api/v1/workflows?active=true&limit=100", h)["data"]
    except Exception as e:  # noqa: BLE001
        return [check("n8n-api", "fluxos", "Fluxos do n8n", "falha", f"API sem resposta: {str(e)[:100]}",
                      o_que_fazer="O n8n não respondeu: nenhum fluxo está sendo conferido. Veja \"n8n\" em Serviços; "
                                  "o healthwatch reinicia sozinho, e se continuar, peça ao Claude.")]
    try:
        memoria = json.loads(FLUXOS_VISTOS.read_text())
    except (OSError, ValueError):
        memoria = {}
    t, ligado, n8n = agora(), ligado_desde(), n8n_no_ar_desde()
    fluxos_vistos.clear()
    out = []
    for w in wfs:
        try:
            ex = http_json(f"{N8N}/api/v1/executions?workflowId={w['id']}&limit=50", h)["data"]
        except Exception:  # noqa: BLE001 — sem a lista, vale a memória
            ex = []
        mem = dict(memoria.get(w["id"]) or {})
        e0 = next((e for e in ex if e.get("startedAt")), None)
        if e0 and e0.get("status") in ERRO_N8N and (mem.get("causa") or {}).get("id") != e0.get("id"):
            mem["causa"] = {"id": e0.get("id"), **_causa_da_falha(h, e0.get("id"), w)}
        c, fluxos_vistos[w["id"]] = avaliar_fluxo(w, ex, mem, t, ligado, n8n, primeira_leitura=not memoria)
        out.append(c)
    return out


# ---------------------------------------------------------------- dados

def pncp() -> dict:
    if PNCP_PAUSA.exists():
        nota = PNCP_PAUSA.read_text().strip()[:60]
        return check("pncp", "dados", "Radar PNCP", "ok", f"Pausado de propósito{f' ({nota})' if nota else ''}")
    try:
        d = json.loads(PNCP_RUN.read_text())
    except OSError:
        return check("pncp", "dados", "Radar PNCP", "atencao", "Nenhuma coleta registrada",
                     o_que_fazer="O radar ainda não gravou nenhuma coleta. Se passar de um dia, peça ao Claude.")
    run_at = datetime.fromisoformat(d["run_at"].replace("Z", "+00:00"))
    t = agora().astimezone()
    hoje = t.date()
    if d.get("status", "completed") == "completed":
        contagem = f"{d['counts']['fetched']} registros, {d['counts']['qualified']} qualificado(s)"
        if run_at.astimezone().date() == hoje:
            return check("pncp", "dados", "Radar PNCP", "ok", f"Coletado hoje: {contagem}")
        # A de hoje é às 07:30, com repescagem às 08:00: até as 09:00 a de ontem ainda é a mais nova.
        if run_at.astimezone().date() == hoje - timedelta(days=1) and t.time() < horario(9, 0):
            return check("pncp", "dados", "Radar PNCP", "ok", f"Coletado ontem: {contagem}; a de hoje roda às 07:30")
        return check("pncp", "dados", "Radar PNCP", "atencao", f"Última coleta em {run_at.astimezone():%d/%m}",
                     o_que_fazer="A coleta de hoje não aconteceu. Se o Dell estava desligado, a repescagem "
                                 "(pncp-catchup) roda quando ele volta; veja também \"Radar PNCP — coleta diária\" "
                                 "em Fluxos. Se amanhã continuar assim, peça ao Claude.")
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
    detalhe = f"Fonte do governo indisponível ({d.get('error', '')[:60]}); {desde}"
    # O portal fora do ar não é defeito nosso e volta sozinho; três dias sem dados já pede alguém olhar.
    if dias is not None and dias < 3:
        return check("pncp", "dados", "Radar PNCP", "atencao", detalhe, sozinho=True,
                     o_que_fazer="Nada: o portal do governo (PNCP) estava fora do ar. A próxima coleta (07:30) "
                                 "tenta de novo sozinha.")
    return check("pncp", "dados", "Radar PNCP", "falha", detalhe,
                 o_que_fazer="O PNCP não responde há dias. Abra pncp.gov.br para ver se o portal mudou e peça ao "
                             "Claude conferir o collector do radar.")


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


def _disparos(expr: str, t: datetime, para_tras: bool):
    """Horários em que a expressão cron de 5 campos dispara, a partir do dia de
    t, para trás ou para a frente, até um ano. Na hora local de t."""
    campos = MACROS_CRON.get(expr.strip(), expr).split()
    if len(campos) != 5:
        raise ValueError(f"esperava 5 campos: {expr!r}")
    minutos, horas, dias, meses = (_campo_cron(c, a, b) for c, (a, b)
                                   in zip(campos, ((0, 59), (0, 23), (1, 31), (1, 12))))
    semana = {d % 7 for d in _campo_cron(campos[4], 0, 7)}  # 0 e 7 = domingo
    # Regra do cron: com dia do mês E da semana restritos, basta um dos dois.
    um_basta = not campos[2].startswith("*") and not campos[4].startswith("*")
    sentido = -1 if para_tras else 1
    for passo in range(367):
        d = (t + timedelta(days=sentido * passo)).date()
        no_dia, na_semana = d.day in dias, d.isoweekday() % 7 in semana
        if d.month not in meses or not ((no_dia or na_semana) if um_basta else (no_dia and na_semana)):
            continue
        for h in sorted(horas, reverse=para_tras):
            for m in sorted(minutos, reverse=para_tras):
                yield datetime.combine(d, horario(h, m), tzinfo=t.tzinfo)


def ultimo_disparo(expr: str, t: datetime) -> datetime | None:
    """Último horário <= t em que a expressão cron de 5 campos dispara, na hora
    local de t (a do Dell, que é a do Hermes e a do n8n). Aceita números, `*`,
    `,`, `-`, `/` e macros @daily etc.; nome de mês/dia levanta ValueError."""
    t = t.replace(second=0, microsecond=0)
    return next((q for q in _disparos(expr, t, True) if q <= t), None)


def proximo_disparo(expr: str, t: datetime) -> datetime | None:
    """Primeiro horário > t em que a expressão dispara; None se não entender."""
    try:
        t = t.astimezone()
        return next((q for q in _disparos(expr, t, False) if q > t), None)
    except ValueError:
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
    ligado = ligado_desde()
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
                             f"{str(j.get('last_error') or j.get('last_status'))[:100]}",
                             o_que_fazer="A rotina do Hermes deu erro e a mensagem dela não saiu. Se o erro acima "
                                         f"não disser o motivo, peça ao Claude: \"a rotina {j.get('name') or jid} "
                                         "do Hermes falhou\". A próxima rodada tenta de novo."))
            continue
        atraso = parado = None
        try:
            if ag["kind"] == "cron":
                previsto = ultimo_disparo(ag["expr"], t - FOLGA_CRON)
                if previsto and previsto >= base and (not ultima or ultima < previsto):
                    atraso = f"Não rodou às {previsto:%H:%M de %d/%m} (última rodada: {ultima_txt})"
                    parado = _parado_em(previsto, ligado, None)
            else:
                passo = timedelta(minutes=float(ag.get("minutes") or 0))
                # O intervalo conta também desde que o Dell ligou: desligado não é atraso.
                referencia = max(filter(None, (ultima, base, ligado)))
                if passo and t - referencia > 3 * passo:
                    horas = (t - referencia).total_seconds() / 3600
                    atraso = f"Sem rodar há {horas:.0f} h ({agenda_txt}; última rodada: {ultima_txt})"
        except (KeyError, ValueError, TypeError) as e:
            out.append(check(f"cron:{jid}", "dados", nome, "atencao", f"Agenda não entendida ({agenda_txt}): {e}",
                             o_que_fazer="O monitor não entendeu o horário desta rotina e não a confere. "
                                         "Peça ao Claude ajustar o dell-status."))
            continue
        if atraso and parado:
            proxima = proximo_disparo(ag["expr"], t)
            out.append(check(f"cron:{jid}", "dados", nome, "atencao", f"{atraso.split(' (')[0]}: {parado}",
                             o_que_fazer="Nada: roda de novo no próximo horário"
                                         + (f" ({_hm(proxima, t)})." if proxima else "."), sozinho=True))
        elif atraso:
            out.append(check(f"cron:{jid}", "dados", nome, "falha", atraso,
                             o_que_fazer="O Hermes não rodou a rotina no horário. Veja se \"Hermes (WhatsApp)\" está "
                                         "ok em Serviços; se estiver, peça ao Claude conferir o agendador do Hermes."))
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


# ---------------------------------------------------------------- lições do funil

FUNIL_APRENDIZADO = HOME / ".local/share/funil-aprendizado"
FUNIL_APRENDIZADO_TIMER = HOME / ".config/systemd/user/funil-aprendizado.timer"


def avaliar_funil_aprendizado(st: dict | None, resultado: str, saiu: datetime | None, t: datetime) -> dict:
    """A coleta diária (funil-aprendizado.py, 08/10/2026) pelo status.json dela.
    Falha: `erro` da rodada (Claude sem login, retrato do CRM velho) ou o systemd
    registrando falha depois do último status; atenção: sem rodada há mais de 36 h.
    Limite de uso não é falha: a rodada retoma no dia seguinte."""
    nome, diario = "Lições do funil", "journalctl --user -u funil-aprendizado"
    if not isinstance(st, dict):
        return check("funil-aprendizado", "dados", nome, "atencao", "Ainda não rodou (sem status.json)")
    fim = _quando(st.get("fim"))
    quando = f"{fim.astimezone(FUSO_BR):%d/%m %H:%M}" if fim else "data desconhecida"
    if resultado not in ("", "success") and saiu and (not fim or saiu - fim > timedelta(minutes=1)):
        return check("funil-aprendizado", "dados", nome, "falha",
                     f"A coleta caiu às {saiu.astimezone(FUSO_BR):%d/%m %H:%M} sem gravar status (systemd: {resultado}). "
                     f"Veja {diario}")
    if st.get("erro"):
        return check("funil-aprendizado", "dados", nome, "falha", f"Rodada de {quando} parou: {st['erro']}"[:300])
    if not fim or t - fim > timedelta(hours=36):
        return check("funil-aprendizado", "dados", nome, "atencao", f"A coleta não roda desde {quando}. Veja {diario}")
    resumo = (f"{st.get('licoes_novas', 0)} lição(ões) nova(s), {st.get('pendentes', 0)} pendente(s)"
              + (", parou no limite de uso (retoma amanhã)" if st.get("limite") else "")
              + (f", {st['desistidas']} saída(s) recusada(s) duas vezes" if st.get("desistidas") else ""))
    return check("funil-aprendizado", "dados", nome, "ok", f"Rodada de {quando}: {resumo}")


def funil_aprendizado() -> list[dict]:
    if not FUNIL_APRENDIZADO_TIMER.exists():
        return []  # ainda não instalado: nada a vigiar
    try:
        st = json.loads((FUNIL_APRENDIZADO / "status.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        st = None
    try:
        resultado, saiu = _unit_resultado("funil-aprendizado.service")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        resultado, saiu = "", None
    return [avaliar_funil_aprendizado(st, resultado, saiu, agora())]


# ---------------------------------------------------------------- rascunho do Mapa (PRUMO)

MAPA_FILA = HOME / ".local/share/n8n-estado/mapa-fila"
MAPA_ERRO = HOME / ".local/share/prumo-mapa-erro"
MAPA_ENTREGAS = HOME / "prumo-entregas"
# A unit tem 20 min de teto (TimeoutStartSec): pacote mais velho que isto na
# fila não está sendo gerado, está esquecido.
MAPA_PARADO = timedelta(minutes=30)


def avaliar_prumo_mapa(gatilho: bool, fila: list[datetime], erros: list[datetime], entregas: list[date],
                       resultado: str, saiu: datetime | None, t: datetime) -> dict:
    """O rascunho do Mapa não grava resumo próprio: a evidência é o rastro em
    disco. O n8n põe um pacote em mapa-fila, o prumo-mapa.path dispara o
    gerador e ele apaga o pacote ao terminar (ou o move para a pasta de erro,
    avisando com o motivo). Gatilho parado ou pacote além de MAPA_PARADO =
    falha: nenhum Mapa sai até alguém mexer. Pacote na pasta de erro =
    atenção: o próprio prumo-mapa já avisou pelo WhatsApp, e repetir a cada
    12 h não ajuda. Nome de empresa nunca entra no detalhe."""
    nome = "Rascunho do Mapa (PRUMO)"
    diario = "journalctl --user -u prumo-mapa"
    if not gatilho:
        return check("prumo-mapa", "dados", nome, "falha",
                     "O gatilho prumo-mapa.path está parado: diagnóstico novo não vira rascunho do Mapa"
                     + (f"; {len(fila)} pacote(s) esperando" if fila else "") + ".",
                     o_que_fazer="Peça ao Claude: \"o prumo-mapa.path parou no Dell\". Os pacotes esperam na fila "
                                 "e viram Mapa quando o gatilho voltar.")
    parados = sorted(m for m in fila if t - m > MAPA_PARADO)
    if parados:
        caiu = (f" A última execução caiu às {_hm(saiu, t)} (systemd: {resultado})."
                if resultado not in ("", "success") and saiu else "")
        return check("prumo-mapa", "dados", nome, "falha",
                     f"{len(parados)} pacote(s) na fila desde {_hm(parados[0], t)} sem virar Mapa.{caiu}",
                     o_que_fazer=f"Peça ao Claude: \"o prumo-mapa travou\" (log: {diario}). O pacote continua na "
                                 "fila e vira Mapa assim que o gerador voltar.")
    if erros:
        return check("prumo-mapa", "dados", nome, "atencao",
                     f"{len(erros)} pacote(s) com erro desde {_hm(min(erros), t)} em ~/.local/share/prumo-mapa-erro.",
                     o_que_fazer="Um diagnóstico ficou sem rascunho do Mapa (o motivo veio no aviso do WhatsApp). "
                                 "Peça ao Claude: \"o prumo-mapa falhou\": ele corrige, devolve o pacote à fila e "
                                 "tira da pasta de erro o que não servir.")
    if fila:
        return check("prumo-mapa", "dados", nome, "ok", f"Gerando: {len(fila)} pacote(s) na fila.")
    if not entregas:
        return check("prumo-mapa", "dados", nome, "ok", "Fila vazia; nenhum rascunho ainda.")
    return check("prumo-mapa", "dados", nome, "ok",
                 f"Fila vazia; {len(entregas)} rascunho(s) gerado(s), o último em {max(entregas):%d/%m}.")


def prumo_mapa() -> list[dict]:
    """Rascunho do Mapa (deploy/dell/prumo-mapa), pelo rastro em disco e pelo
    systemd. Pastas de teste (`-teste-` no nome) não contam como entrega."""
    def instantes(pasta: Path) -> list[datetime]:
        if not pasta.is_dir():
            return []
        return [datetime.fromtimestamp(p.stat().st_mtime, timezone.utc) for p in pasta.glob("*.json")]

    entregas = []
    for dj in MAPA_ENTREGAS.glob("*/dados.json") if MAPA_ENTREGAS.is_dir() else []:
        if "-teste-" in dj.parent.name:
            continue
        try:
            entregas.append(date.fromisoformat(dj.parent.name[:10]))
        except ValueError:
            continue
    try:
        resultado, saiu = _unit_resultado("prumo-mapa.service")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        resultado, saiu = "", None
    return [avaliar_prumo_mapa(unit_ativa("prumo-mapa.path"), instantes(MAPA_FILA), instantes(MAPA_ERRO),
                               entregas, resultado, saiu, agora())]


# ---------------------------------------------------------------- pendências (o que depende do Rômulo)

ESTADO_N8N = HOME / ".local/share/n8n-estado"
AUTO = HOME / "auto-site"


# O que o Rômulo faz com cada fila e onde (rota da Central). sozinho = a fila anda sem ele.
FILAS = {
    "sites-fila": ("Nada: o gerador faz até 4 sites por dia às 08:00. Para adiantar um lead, rode /lead-novo "
                   "numa sessão do Claude em ~/auto-site.", ("Ver no CRM", "/crm?ver=funil&produto=site"), True),
    # 08/10/2026: o link abre direto a fila "Enviar um por um" do CRM (um site por vez, a mensagem antes do toque).
    "site-enviar": ("Abra a fila Enviar um por um: um site por vez, com o demo e a mensagem; o toque abre o WhatsApp "
                    "e marca o envio. Escrever direto ao número do lead também conta como envio.",
                    ("Enviar um por um", "/crm?produto=site&fila=envio"), False),
    "site-resposta": ("Nada por enquanto: a resposta no WhatsApp marca sozinha. Sem resposta, o follow-up pronto "
                      "chega no 3º dia (09:00) e o lead expira no 10º.", ("Ver no CRM", "/crm?ver=funil&produto=site"), True),
    "prumo-revisar": ("Abra o CRM em Hoje › Prospects para revisar: veja o site e, se fizer sentido, clique em "
                      "Enviar convite.", ("Abrir no CRM", "/crm?produto=prumo"), False),
    "prumo-aguardando": ("Vale um lembrete no WhatsApp do dono; o CRM mostra há quantos dias cada convite espera.",
                         ("Abrir no CRM", "/crm?produto=prumo"), False),
    "prumo-diagnostico": ("Leia o diagnóstico e o rascunho do Mapa (~/prumo-entregas) e marque o workshop com o dono.",
                          ("Abrir no CRM", "/crm?produto=prumo"), False),
}


def _fila(id_: str, nome: str, qtd: int, detalhe: str, link: str | None = None) -> dict:
    o, acao, sozinho = FILAS.get(id_, (None, None, False))
    return check(f"pend:{id_}", "pendencias", nome, "atencao" if qtd else "ok", detalhe, link,
                 o if qtd else None, acao if qtd else None, sozinho=bool(qtd and sozinho))


def pendencias() -> list[dict]:
    """Não é saúde: é fila de trabalho humano. `atencao` quando há algo esperando,
    e nunca vira WhatsApp (só `falha` vira)."""
    out = []
    fila = [d for d in AUTO.iterdir() if d.is_dir() and not d.name.startswith(("_", "."))
            and (d / "content.md").is_file() and not (d / "publicado.json").is_file()] if AUTO.is_dir() else []
    out.append(_fila("sites-fila", "Sites na fila do gerador", len(fila),
                     f"{len(fila)} lead(s) com pasta e sem site publicado"))
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
            out.append(_fila(str(item["id"]), str(item["nome"]), qtd, detalhe, item.get("link")))
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
        out.append(_fonte_do_backup(fid, f, t))
    return out


# O Google recusou o token do rclone: não passa sozinho, alguém precisa reconectar.
TOKEN_RECUSADO = re.compile(r"invalid_grant|couldn't fetch token|token (has been )?(expired|revoked)|reconnect", re.I)


def _fonte_do_backup(fid: str, f: dict, t: datetime) -> dict:
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
    o, sozinho = None, False
    if estado == "ok":
        pass
    elif f.get("estado") in ("falha", "atencao") and TOKEN_RECUSADO.search(detalhe):
        estado = "falha"
        o = ("O Google desconectou o backup. No terminal do Dell rode: rclone config reconnect gdrive: "
             "(abre o navegador para entrar com a conta do Google). A próxima rodada volta sozinha.")
    elif "restic check falhou" in detalhe:
        o = "O cofre pode ter partes estragadas. Peça ao Claude agora: \"o restic check do cofre falhou\"."
    elif f.get("estado") == "adiado":
        o, sozinho = "Nada: o espelho espera o gerador terminar de escrever e roda na hora seguinte.", True
    elif "não puderam ser lidos" in detalhe:
        o = ("O cofre foi feito, mas alguns arquivos ficaram de fora (sem permissão de leitura). Se forem "
             "importantes, peça ao Claude; se não, peça para entrarem no \"excluir\" do fontes.toml.")
    elif "faltando:" in detalhe:
        o = "Um arquivo que refaz o Dell sumiu do cofre (veja o detalhe). Peça ao Claude conferir."
    elif "MB novos numa rodada" in detalhe:
        o = "Entrou uma pasta grande nova no cofre. Se ela não precisa de backup, peça ao Claude pô-la no \"excluir\"."
    elif estado == "falha":
        o = "O backup está parado além do limite. Veja o detalhe e peça ao Claude: \"o backup do Dell parou\"."
    elif f.get("tipo") == "ensaio" and estado == "atencao":
        o, sozinho = "Nada: o ensaio de restauração é mensal e roda junto com o próximo cofre (03:30).", True
    elif estado == "atencao":
        o, sozinho = ("Uma rodada não deu certo; a próxima tenta de novo sozinha. Se passar do limite, vira "
                      "falha e o Hermes avisa."), True
    return check(f"backup:{fid}", "dados", nome, estado, detalhe, o_que_fazer=o, sozinho=sozinho)


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


# ---------------------------------------------------------------- o que fazer

# Para quem a verificação não trouxe o próprio texto: (o que fazer, resolve sozinho?).
O_QUE_FAZER = {
    "hermes": ("O Hermes parou: os avisos do WhatsApp não chegam. O healthwatch religa sozinho em até 1 min; se "
               "continuar, peça ao Claude: \"o Hermes parou no Dell\".", False),
    "hermes-navegador": ("O Chromium do Hermes não responde: as coletas pelo navegador (ASMR, radar) param. Se "
                         "passar de 10 min, peça ao Claude religar o hermes-google-browser.", False),
    "n8n": ("O n8n não responde: nenhum fluxo roda (leads, cliques, CRM). O healthwatch reinicia sozinho; se "
            "continuar, peça ao Claude.", False),
    "terminal": ("O terminal do navegador (code-server) não responde. Só afeta o Terminal; peça ao Claude se "
                 "precisar dele.", False),
    "syncthing": ("Sem o PC, o Syncthing não tem com quem sincronizar. Abra-o para ver qual pasta tem erro; se não "
                  "souber o que é, pode esperar o PC novo.", False),
    "squadone-app": ("O SquadOne de agendas (Easypanel) não responde: demandas e lembretes param. Peça ao Claude "
                     "conferir o app no Easypanel.", False),
    "docker": ("O Docker não responde: o n8n e os projetos param. Peça ao Claude.", False),
    "containers": ("Veja na lista qual container parou.", False),
    "disco": ("O disco está enchendo. Peça ao Claude liberar espaço (caches, vídeos, imagens do Docker).", False),
    "memoria": ("Pouca memória livre. Se durar mais de uma hora, algum processo travou: peça ao Claude olhar.", False),
    "crons": ("O monitor não conseguiu ler as rotinas do Hermes. Peça ao Claude conferir ~/.hermes/cron/jobs.json.",
              False),
    "backup": ("O backup no Drive ainda não registrou nenhuma rodada. Se passar de um dia, peça ao Claude.", False),
    "funil-aprendizado": ("A coleta das lições do funil parou: nada se perde (ela retoma de onde parou), mas a revisão "
                          "de segunda fica sem lições novas. Se o erro fala em login, rode claude no terminal do Dell; "
                          "se fala em retrato do CRM velho, o n8n parou de gravar o crm.json. Senão peça ao Claude: "
                          "\"a coleta de lições do funil falhou\" (journalctl --user -u funil-aprendizado).", False),
}


def explicar(c: dict) -> dict:
    """Completa `o_que_fazer` de quem não está ok e não trouxe o próprio texto."""
    if c["estado"] == "ok" or c.get("o_que_fazer"):
        return c
    cid, det = c["id"], c["detalhe"]
    texto, sozinho = O_QUE_FAZER.get(cid, (None, False))
    if cid == "dns":
        texto, sozinho = (("Algumas consultas de nome falharam: costuma ser a rede oscilando e passa sozinho.", True)
                          if c["estado"] == "atencao" else
                          ("O Dell está sem internet: nada que depende da rede funciona. Confira o Wi-Fi e o "
                           "roteador.", False))
    elif cid.startswith("container:"):
        texto = (f"O container {c['nome']} parou ou está sem saúde. Se for do n8n ou do radar, peça ao Claude já; os "
                 "outros são projetos e só afetam o próprio projeto.")
    elif cid == "gerador":
        if "sem login" in det.lower() or "login" in det.lower():
            texto = "O Claude do gerador está sem login. No terminal do Dell rode claude e faça /login."
        elif "Ainda não rodou" in det:
            texto = "O gerador de sites ainda não gravou nenhuma execução. Se passar das 10:00, peça ao Claude."
        elif c["estado"] == "atencao":
            texto, sozinho = ("Alguns leads falharam e tentam de novo amanhã às 08:00 (duas falhas tiram o lead da "
                              "fila). Nada a fazer, a não ser que queira adiantar."), True
        else:
            texto = ("O gerador não fez nenhum site nesta rodada. Os leads voltam amanhã às 08:00; se repetir, peça "
                     "ao Claude: \"o gerador de sites falhou\" (log: journalctl --user -u gerador-de-sites).")
    elif cid == "monitor":
        texto = ("O monitor do Dell parou ou o Dell está desligado: o que aparece aqui pode estar velho. Se o Dell "
                 "está ligado, peça ao Claude: \"o dell-status parou\".")
    elif cid.startswith("erro:"):
        texto = "Uma verificação do monitor quebrou; as outras seguem. Peça ao Claude olhar o dell-status."
    elif not texto:
        texto = ("Veja o detalhe; se não souber o que fazer, peça ao Claude."
                 if c["estado"] == "falha" else "Vale olhar o detalhe; nada quebrou.")
    c["o_que_fazer"] = texto
    if sozinho:
        c["sozinho"] = True
    return c


# ---------------------------------------------------------------- avisos

def enviar(msg: str) -> bool:
    try:
        r = subprocess.run([str(HERMES), "send", "--to", DESTINO, "-q", msg], capture_output=True, text=True, timeout=120)
        return r.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


# ---------------------------------------------------------------- fila de avisos
#
# Formato (06/10/2026): {titulo, texto, origem, chave?, prioridade?, expira_em?, link?}.
# Antes era {texto, titulo?} sem teto nenhum: um fluxo com defeito podia mandar
# centenas de WhatsApp, e o mesmo aviso repetido a cada rodada chegava a cada
# rodada. Agora:
# - fora do formato é RECUSADO (não vai ao WhatsApp): o arquivo e o motivo ficam
#   em FILA_RECUSADOS e a verificação "Fila de avisos" fica vermelha até alguém
#   olhar. Recusar calado perderia aviso; mandar como antes manteria o defeito;
# - `prioridade` 0 (urgente) a 3 (baixa), padrão 2. Das 22h às 7h (São Paulo) só
#   P0 sai; o resto espera na fila e sai às 7h;
# - `chave` já enviada nas últimas 24 h é descartada (estado em FILA_ESTADO);
# - `expira_em` (ISO 8601) vencido é descartado sem enviar;
# - até TETO_POR_HORA envios por hora; o excedente vai junto num resumo só.
# A drenagem roda sob flock: o dell-status de cada minuto e um `--drenar` avulso
# nunca mandam o mesmo arquivo duas vezes.

FILA_TRAVA = HOME / ".local/state/dell-status/fila.lock"
FILA_ESTADO = HOME / ".local/state/dell-status/fila.json"
FILA_RECUSADOS = HOME / ".local/state/dell-status/avisos-recusados"
FUSO_BR = ZoneInfo("America/Sao_Paulo")
TETO_POR_HORA = 20
JANELA_DA_CHAVE = timedelta(hours=24)
SILENCIO_DE, SILENCIO_ATE = 22, 7  # horas cheias, hora de São Paulo
PRIORIDADE_PADRAO = 2
MAX_BYTES_AVISO = 16 * 1024
# Arquivo mais novo que isto espera a rodada seguinte: o nó do n8n grava direto
# no .json (sem .tmp + rename) e podia ser lido pela metade.
FRESCOR_S = 5.0
CAMPOS_DO_AVISO = {"titulo", "texto", "origem", "chave", "prioridade", "expira_em", "link"}
MAX_CARACTERES = {"titulo": 120, "texto": 4000, "origem": 80, "chave": 200, "link": 500}
MAX_LINHAS_RESUMO = 25


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _instante(txt) -> datetime | None:
    """ISO 8601; sem fuso vale a hora de São Paulo (é como o Rômulo escreve)."""
    if not isinstance(txt, str):
        return None
    try:
        d = datetime.fromisoformat(txt.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=FUSO_BR)


def validar_aviso(d) -> dict:
    """O aviso normalizado, ou ValueError com o motivo da recusa."""
    if not isinstance(d, dict):
        raise ValueError("não é um objeto JSON")
    sobra = sorted(set(d) - CAMPOS_DO_AVISO)
    if sobra:
        raise ValueError("campo(s) fora do formato: " + ", ".join(sobra))
    for campo in ("titulo", "texto", "origem"):
        if not isinstance(d.get(campo), str) or not d[campo].strip():
            raise ValueError(f"'{campo}' é obrigatório (texto não vazio)")
    for campo, teto in MAX_CARACTERES.items():
        v = d.get(campo)
        if v is None:
            continue
        if not isinstance(v, str):
            raise ValueError(f"'{campo}' deve ser texto")
        if len(v) > teto:
            raise ValueError(f"'{campo}' passa de {teto} caracteres ({len(v)})")
        if campo != "texto" and ("\n" in v or "\r" in v):
            raise ValueError(f"'{campo}' não pode ter quebra de linha")
    p = d.get("prioridade")
    p = PRIORIDADE_PADRAO if p is None else p
    if isinstance(p, bool) or not isinstance(p, int) or not 0 <= p <= 3:
        raise ValueError("'prioridade' deve ser inteiro de 0 a 3")
    expira = None
    if d.get("expira_em") is not None:
        expira = _instante(d["expira_em"])
        if not expira:
            raise ValueError("'expira_em' deve ser data/hora ISO 8601")
    link = d.get("link")
    if link is not None and not re.match(r"https?://\S+$", link):
        raise ValueError("'link' deve ser URL http(s) sem espaços")
    chave = d.get("chave")
    return {"titulo": d["titulo"].strip(), "texto": d["texto"].strip(), "origem": d["origem"].strip(),
            "chave": chave.strip() if chave and chave.strip() else None, "prioridade": p,
            "expira_em": expira, "link": link}


def em_silencio(t: datetime) -> bool:
    h = t.astimezone(FUSO_BR).hour
    return h >= SILENCIO_DE or h < SILENCIO_ATE


def mensagem_do_aviso(a: dict) -> str:
    return f"{a['titulo']}\n{a['texto']}" + (f"\n{a['link']}" if a["link"] else "")


def mensagem_do_resumo(avisos: list[dict]) -> str:
    linhas = [f"📦 {len(avisos)} avisos agrupados",
              f"Passou de {TETO_POR_HORA} avisos na última hora; estes vieram juntos (só o título):"]
    for a in avisos[:MAX_LINHAS_RESUMO]:
        p = f"[P{a['prioridade']}] " if a["prioridade"] < PRIORIDADE_PADRAO else ""
        linhas.append(f"• {p}{a['titulo'][:90]} ({a['origem'][:40]})")
    if len(avisos) > MAX_LINHAS_RESUMO:
        linhas.append(f"• e mais {len(avisos) - MAX_LINHAS_RESUMO}")
    return "\n".join(linhas)


def _ler_estado_fila(t: datetime) -> dict:
    try:
        e = json.loads(FILA_ESTADO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        e = {}
    envios = [x for x in e.get("envios", []) if (q := _instante(x)) and t - q < timedelta(hours=1)]
    chaves = {k: v for k, v in (e.get("chaves") or {}).items() if (q := _instante(v)) and t - q < JANELA_DA_CHAVE}
    return {"envios": envios, "chaves": chaves, "resumo_em": e.get("resumo_em")}


def _recusar(f: Path, motivo: str, t: datetime) -> None:
    FILA_RECUSADOS.mkdir(parents=True, exist_ok=True, mode=0o700)
    destino = FILA_RECUSADOS / f"{t.astimezone(FUSO_BR):%Y%m%d-%H%M%S}-{f.name}"
    try:
        shutil.move(str(f), destino)
        destino.with_name(destino.name + ".motivo.txt").write_text(motivo + "\n", encoding="utf-8")
    except OSError as e:
        log(f"fila: não consegui mover {f.name} para os recusados: {e}")
        return
    log(f"fila: RECUSADO {f.name}: {motivo}")


def _descartar(f: Path, motivo: str) -> None:
    f.unlink(missing_ok=True)
    log(f"fila: descartado {f.name}: {motivo}")


def drenar_fila(t: datetime | None = None) -> dict:
    """Esvazia a fila sob flock. Outra drenagem em andamento = sai sem fazer nada."""
    FILA_TRAVA.parent.mkdir(parents=True, exist_ok=True)
    with open(FILA_TRAVA, "a") as trava:
        try:
            fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("fila: outra drenagem em andamento; esta sai sem enviar")
            return {"ocupada": True}
        return _drenar(t or agora())


def _drenar(t: datetime) -> dict:
    r = {"enviados": 0, "agrupados": 0, "descartados": 0, "recusados": 0, "esperando": 0}
    if not FILA.is_dir():
        return r
    estado = _ler_estado_fila(t)
    silencio = em_silencio(t)
    vistas: set[str] = set()
    prontos: list[tuple[Path, dict, float]] = []
    for f in sorted(FILA.glob("*.json")):
        try:
            st = f.stat()
            if time.time() - st.st_mtime < FRESCOR_S:
                r["esperando"] += 1
                continue
            if st.st_size > MAX_BYTES_AVISO:
                raise ValueError(f"arquivo passa de {MAX_BYTES_AVISO} bytes ({st.st_size})")
            a = validar_aviso(json.loads(f.read_text(encoding="utf-8")))
        except FileNotFoundError:
            continue
        except (OSError, ValueError) as e:  # JSON e UTF-8 inválidos também são ValueError
            _recusar(f, str(e)[:300], t)
            r["recusados"] += 1
            continue
        if a["expira_em"] and a["expira_em"] <= t:
            _descartar(f, f"expirou em {iso(a['expira_em'])}")
            r["descartados"] += 1
            continue
        if a["chave"] and (a["chave"] in estado["chaves"] or a["chave"] in vistas):
            _descartar(f, f"chave '{a['chave']}' já enviada nas últimas 24 h")
            r["descartados"] += 1
            continue
        if silencio and a["prioridade"] != 0:
            r["esperando"] += 1  # sai às 7h; a chave só conta quando sair
            continue
        if a["chave"]:
            vistas.add(a["chave"])
        prontos.append((f, a, st.st_mtime))
    prontos.sort(key=lambda x: (x[1]["prioridade"], x[2], x[0].name))

    vagas = TETO_POR_HORA - len(estado["envios"])
    if len(prontos) <= vagas:
        individuais, excedente = prontos, []
    else:
        # Uma vaga fica para o resumo. Sem vaga nenhuma, o resumo ainda sai uma
        # vez por hora (o "~" do teto); fora disso o excedente espera na fila.
        individuais, excedente = prontos[:max(vagas - 1, 0)], prontos[max(vagas - 1, 0):]
        ultimo = _instante(estado["resumo_em"]) if estado["resumo_em"] else None
        if vagas < 1 and ultimo and t - ultimo < timedelta(hours=1):
            r["esperando"] += len(excedente)
            excedente = []

    def entregue(arquivos: list[tuple[Path, dict, float]]) -> None:
        estado["envios"].append(iso(t))
        for f, a, _ in arquivos:
            if a["chave"]:
                estado["chaves"][a["chave"]] = iso(t)
            f.unlink(missing_ok=True)

    falhou = False
    for item in individuais:
        if not enviar(mensagem_do_aviso(item[1])):
            falhou = True  # Hermes fora: cada tentativa leva até 2 min; tenta de novo no próximo minuto
            break
        entregue([item])
        r["enviados"] += 1
    if excedente and not falhou:
        if enviar(mensagem_do_resumo([a for _, a, _ in excedente])):
            entregue(excedente)
            estado["resumo_em"] = iso(t)
            r["agrupados"] += len(excedente)
            log(f"fila: {len(excedente)} aviso(s) agrupados num resumo (teto de {TETO_POR_HORA}/h)")
    gravar(FILA_ESTADO, estado)
    return r


def visto_recusados(nomes: list[str]) -> dict:
    """Dá o 'visto' em aviso recusado: o arquivo e o `.motivo.txt` vão para
    FILA_RECUSADOS/vistos/ e a verificação "Fila de avisos" volta a ficar verde.

    Sem isto o vermelho só apagava com `rm` à mão, e quem corrigia o fluxo
    (06/10/2026) deixava o alerta aceso por dias, o que ensina a ignorar o
    vermelho. Mover em vez de apagar guarda a prova do que foi recusado. `nomes`
    são nomes de arquivo `.json` de FILA_RECUSADOS, ou ["todos"]; nome que não
    está lá (inclusive caminho com barra) vai em `inexistentes` e nada é tocado
    fora da pasta. Rodar de novo com o mesmo nome é inofensivo."""
    existentes = {f.name: f for f in FILA_RECUSADOS.glob("*.json")} if FILA_RECUSADOS.is_dir() else {}
    alvo = sorted(existentes) if nomes == ["todos"] else [n for n in nomes if n in existentes]
    r: dict = {"vistos": [], "inexistentes": [] if nomes == ["todos"] else [n for n in nomes if n not in existentes]}
    if not alvo:
        return r
    pasta = FILA_RECUSADOS / "vistos"
    pasta.mkdir(parents=True, exist_ok=True, mode=0o700)
    for nome in alvo:
        f = existentes[nome]
        motivo = f.with_name(f.name + ".motivo.txt")
        destino = pasta / nome
        n = 1
        while destino.exists() or destino.with_name(destino.name + ".motivo.txt").exists():
            destino = pasta / f"{nome}.{n}"  # nunca sobrescreve um visto anterior
            n += 1
        try:
            shutil.move(str(f), destino)
            if motivo.exists():
                shutil.move(str(motivo), destino.with_name(destino.name + ".motivo.txt"))
        except OSError as e:
            log(f"fila: não consegui dar o visto em {nome}: {e}")
            r["inexistentes"].append(nome)
            continue
        r["vistos"].append(nome)
        log(f"fila: visto {nome}")
    return r


def fila_de_avisos() -> list[dict]:
    """Recusado não foi ao WhatsApp: vermelho até alguém ler o motivo e dar o
    visto (`dell-status --visto-recusados`). Visto não reacende: a pasta
    `vistos/` não entra na contagem."""
    recusados = sorted(FILA_RECUSADOS.glob("*.json")) if FILA_RECUSADOS.is_dir() else []
    pendentes = len(list(FILA.glob("*.json"))) if FILA.is_dir() else 0
    if recusados:
        nomes = ", ".join(f.name for f in recusados[:3]) + ("…" if len(recusados) > 3 else "")
        return [check("fila-avisos", "servicos", "Fila de avisos", "falha",
                      f"{len(recusados)} aviso(s) recusado(s), fora do formato: {nomes}",
                      o_que_fazer=("Algum script ou fluxo gravou um aviso fora do formato {titulo, texto, origem, …} "
                                   "e ele NÃO chegou no WhatsApp. O motivo está ao lado de cada arquivo em "
                                   "~/.local/state/dell-status/avisos-recusados/. Peça ao Claude: \"aviso recusado na "
                                   "fila do dell-status\". Depois de corrigir quem gravou (ou se já estava corrigido), "
                                   "dê o visto: `dell-status --visto-recusados todos` (ou o nome do arquivo); "
                                   "ele vai para vistos/ e o vermelho apaga."))]
    vistos = len(list((FILA_RECUSADOS / "vistos").glob("*.json"))) if (FILA_RECUSADOS / "vistos").is_dir() else 0
    return [check("fila-avisos", "servicos", "Fila de avisos", "ok",
                  f"{pendentes} esperando" + (" (silêncio até as 7h; só P0 sai)" if em_silencio(agora()) and pendentes
                                              else "") + (f"; {vistos} recusado(s) já visto(s)" if vistos else ""))]


# ---------------------------------------------------------------- arquivos instalados

REPO = HOME / "SquadOne"
INSTALADOS = REPO / "deploy/dell/instalados.json"
APLICAR_HERMES = "~/.hermes/hermes-agent/venv/bin/python ~/SquadOne/deploy/hermes/scripts/aplicar-hermes.py"


def _til(p: Path, home: Path) -> str:
    try:
        return "~/" + p.relative_to(home).as_posix()
    except ValueError:
        return p.as_posix()


def comparar_instalados(entradas: list[dict], repo: Path, home: Path) -> list[dict]:
    """Cada cópia do instalados.json comparada byte a byte com o arquivo do
    repo. Entrada com curinga vale só para o que está instalado (os testes e os
    scripts de uso único ficam no repo); sem curinga, a cópia é obrigatória.
    `mais_novo`: a cópia foi gravada depois de a versão do repo chegar ao
    clone, então pode ter mudança feita direto no Dell que falta no repo."""
    itens = []
    for e in entradas:
        padrao, alvo = e["repo"], e["instalado"]
        destino = home / alvo[2:] if alvo.startswith("~/") else Path(alvo)
        if any(c in padrao for c in "*?["):
            pares = [(o, destino / o.name, False) for o in sorted(repo.glob(padrao)) if o.is_file()]
        else:
            origem = repo / padrao
            pares = [(origem, destino / origem.name if alvo.endswith("/") else destino, True)]
        for origem, copia, obrigatoria in pares:
            item = {"repo": origem.relative_to(repo).as_posix(), "instalado": _til(copia, home), "entrada": e}
            if not origem.is_file():
                item["estado"] = "sem origem"
            elif not copia.is_file():
                if not obrigatoria:
                    continue
                item["estado"] = "faltando"
            elif origem.read_bytes() == copia.read_bytes():
                item["estado"] = "igual"
            else:
                item["estado"] = "diferente"
                item["mais_novo"] = copia.stat().st_mtime > origem.stat().st_mtime
            itens.append(item)
    return itens


def comando_instalar(item: dict) -> str | None:
    """O comando que põe a versão do repo no lugar da cópia."""
    e = item["entrada"]
    if item["estado"] == "sem origem":
        return None
    if e.get("via") == "aplicar-hermes":
        return APLICAR_HERMES
    destino = item["instalado"]
    modo = e.get("modo") or ("755" if destino.startswith("~/.local/bin/") else "644")
    cmd = f"install -D -m {modo} ~/SquadOne/{item['repo']} {destino}"
    if destino.startswith("~/.config/systemd/user/"):
        cmd += " && systemctl --user daemon-reload"
    if e.get("reiniciar"):
        cmd += f" && systemctl --user restart {e['reiniciar']}"
    return cmd


def avaliar_instalados(itens: list[dict]) -> dict:
    """Cópia diferente do repo é atenção, não falha: muitas vezes não muda nada
    hoje, mas foi assim que os avisos do observador do WhatsApp sumiram em
    07/10/2026 (o fix estava mergeado; a cópia era de antes)."""
    nome = "Arquivos instalados"
    fora = [i for i in itens if i["estado"] != "igual"]
    if not fora:
        return check("instalados", "servicos", nome, "ok", f"{len(itens)} arquivo(s) iguais ao repositório")
    nomes = [i["instalado"].rsplit("/", 1)[-1] for i in fora]
    detalhe = (f"{len(fora)} de {len(itens)} diferente(s) do repositório: " + ", ".join(nomes[:3])
               + (f" e mais {len(nomes) - 3}" if len(nomes) > 3 else ""))
    partes = ["O ~/SquadOne tem versão que não está instalada (ou a cópia mudou no Dell). "
              "`dell-status --instalados` lista cada um com o comando que instala. "
              "Peça ao Claude: \"arquivos instalados fora do repo\"."]
    novos = [n for n, i in zip(nomes, fora) if i.get("mais_novo")]
    if novos:
        partes.append(f"Cuidado: {', '.join(novos)} foi gravado no Dell depois da versão do repo; compare antes "
                      "de reinstalar, pode ser mudança que falta levar ao repo por PR.")
    sem = [i["repo"] for i in fora if i["estado"] == "sem origem"]
    if sem:
        partes.append(f"O instalados.json cita o que não existe mais no repo ({', '.join(sem)}): tire de lá.")
    return check("instalados", "servicos", nome, "atencao", detalhe, o_que_fazer=" ".join(partes))


def ler_instalados() -> list[dict] | None:
    if not INSTALADOS.is_file():
        return None  # clone sem o manifesto (antes do merge): não há o que comparar
    return comparar_instalados(json.loads(INSTALADOS.read_text())["arquivos"], REPO, HOME)


def instalados() -> list[dict]:
    itens = ler_instalados()
    return [] if itens is None else [avaliar_instalados(itens)]


def listar_instalados() -> None:
    """`dell-status --instalados`: o que está fora do repo, com o comando."""
    itens = ler_instalados() or []
    fora = [i for i in itens if i["estado"] != "igual"]
    print(f"{len(itens) - len(fora)} de {len(itens)} iguais ao repositório.")
    vistos = set()
    for i in fora:
        marca = " (a cópia é mais nova que o repo: compare antes)" if i.get("mais_novo") else ""
        print(f"\n{i['estado']}: {i['instalado']}{marca}\n  repo: ~/SquadOne/{i['repo']}")
        cmd = comando_instalar(i)
        if cmd and cmd not in vistos:
            print(f"  instalar: {cmd}")
            vistos.add(cmd)
        elif cmd:
            print("  instalar: o mesmo comando acima")


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
    def item(c: dict) -> str:
        return f"• {c['nome']}: {c['detalhe']}" + (f"\n  O que fazer: {c['o_que_fazer']}" if c.get("o_que_fazer") else "")

    linhas = []
    if quebrou:
        linhas += ["Quebrou:"] + [item(c) for c in quebrou]
    if lembrar:
        linhas += ["Continua fora:"] + [item(c) for c in lembrar]
    if voltou:
        linhas += ["Voltou ao normal:"] + [f"• {c['nome']}" for c in voltou]
    if linhas:
        titulo = "⚠️ Dell worker" if (quebrou or lembrar) else "✅ Dell worker"
        if not enviar(titulo + "\n" + "\n".join(linhas) + f"\nNa Central: {CENTRAL}"):
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
    p.add_argument("--drenar", action="store_true", help="só drena a fila de avisos (com flock)")
    p.add_argument("--instalados", action="store_true", help="lista as cópias diferentes do repo, com o comando")
    p.add_argument("--visto-recusados", nargs="+", metavar="ARQUIVO|todos",
                   help="dá o visto em aviso recusado (vai para avisos-recusados/vistos/): o vermelho apaga")
    a = p.parse_args()
    if a.visto_recusados:
        r = visto_recusados(a.visto_recusados)
        print(json.dumps(r, ensure_ascii=False))
        sys.exit(1 if r["inexistentes"] else 0)
    if a.drenar:
        print(json.dumps(drenar_fila(), ensure_ascii=False))
        return
    if a.instalados:
        listar_instalados()
        return
    t = agora()
    checks = []
    for fn in (servicos, containers, fluxos, maquina, crons_hermes, gerador, funil_aprendizado, prumo_mapa, pendencias,
               easypanel, backup, fila_de_avisos, instalados):
        try:
            checks += fn()
        except Exception as e:  # noqa: BLE001 — uma verificação quebrada não cala as outras
            checks.append(check(f"erro:{fn.__name__}", "maquina", f"Verificação {fn.__name__}", "atencao", str(e)[:120]))
    try:
        checks.append(pncp())
    except Exception as e:  # noqa: BLE001
        checks.append(check("pncp", "dados", "Radar PNCP", "atencao", str(e)[:120]))
    checks = [explicar(c) for c in checks]
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
    if fluxos_vistos:
        gravar(FLUXOS_VISTOS, fluxos_vistos)
    drenar_fila()


if __name__ == "__main__":
    main()
