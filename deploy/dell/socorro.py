#!/usr/bin/env python3
"""Socorro do Dell: uma verificação do dell-status que acabou de ficar vermelha tenta se resolver (Mel).

Pedido do Rômulo (16/10/2026): "as falhas têm que disparar o Hermes para resolver". Até aqui uma
falha só virava o WhatsApp "Quebrou" e ficava esperando alguém pedir ao Claude; o único conserto
automático era o religamento do `dell-worker-healthwatch` (Hermes, painel, Central, code-server, n8n).
Este script é a exceção LIMITADA que RULES 10 e o SOUL do Hermes passaram a prever:

1. **Remédio determinístico, só de lista branca.** `REMEDIOS` é a lista FECHADA do que pode mudar
   estado: `systemctl --user restart` das units que o dell-status confere e `docker restart/start`
   dos containers que o healthwatch e a verificação do PRUMO já mandam religar. Nada de apagar,
   editar, reconfigurar, `docker compose up`, rodar fluxo, mexer em credencial ou em dado de negócio.
   No máximo 2 tentativas por verificação a cada 6 h (`~/.local/state/socorro/estado.json`).
2. **Sem remédio, ou o remédio não resolveu: o Hermes diagnostica.** O script junta o que é de LEITURA
   (journal das units, `systemctl status`, `docker ps/logs`, o detalhe da verificação), mascara número
   de telefone e token, e chama `hermes -z` com o toolset `todo` (sem terminal, arquivo, navegador
   nem mensagens: o -z aprova tudo sozinho, então a trava é não dar a ferramenta). O Hermes responde
   em JSON: diagnóstico, um remédio OPCIONAL que só vale se estiver na lista branca (quem executa é
   este script, com o mesmo teto de tentativas) e o pedido pronto para o Rômulo colar no Claude Code.
   Teto: 1 Hermes por verificação a cada 6 h e 6 por dia no total; 5 min de tempo. Verificação sem remédio
   nem leitura própria (fluxo, cron, pncp, idade...) não chama o Hermes: o aviso leva o "o que fazer" da Central.
3. **Um aviso** pela fila (lib/aviso.py) com o que aconteceu: "resolvido sozinho com X" ou "continua
   fora; o Hermes acha que...; peça ao Claude: ...". O "Quebrou" do dell-status sai do mesmo jeito,
   na hora: o socorro nunca segura nem substitui o alerta de falha. Desde 16/10/2026 (OT-14) a
   drenagem do dell-status manda o aviso de `origem` "socorro" pelo bot do Telegram (sem som das 22h
   às 7h) e só pelo WhatsApp, que é o número de vendas, se o bot falhar. Por isso a origem é fixa.

Antes de qualquer coisa o script espera 60 s e reconfere (`dell-status --stdout`): o healthwatch
religa em até 1 min, e o que voltou sozinho não ganha remédio nem aviso (o "Voltou ao normal" do
dell-status já conta).

Como é disparado: o dell-status grava um pedido em `~/.local/state/socorro/pedidos/` quando uma
verificação ENTRA em falha e volta ao seu minuto; o `socorro.path` (DirectoryNotEmpty) sobe o
`socorro.service`, que trata todos os pedidos de uma vez. O laço de 1 min nunca espera por isto.

Chave de desligar: `~/.config/socorro/desligado` (arquivo; `socorro --desligar`) ou SOCORRO_DESLIGADO=1.
Desligado, o dell-status não grava pedido e este script descarta os que houver sem agir.

Uso:
  socorro                       trata os pedidos da pasta (o que o socorro.service roda)
  socorro --estado              ligado ou não, tentativas nas últimas 6 h, Hermes no dia
  socorro --simular ID [--detalhe TEXTO]   que remédio seria usado e se o teto deixa (não age)
  socorro --desligar [MOTIVO] | --ligar

Somente biblioteca padrão.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover — Windows (testes no PC)
    fcntl = None

HOME = Path.home()
PASTA_ESTADO = Path(os.environ.get("SOCORRO_ESTADO") or HOME / ".local/state/socorro")
PEDIDOS = PASTA_ESTADO / "pedidos"
ESTADO = PASTA_ESTADO / "estado.json"
TRAVA = PASTA_ESTADO / "trava"
MARCA_DESLIGADO = Path(os.environ.get("SOCORRO_MARCA") or HOME / ".config/socorro/desligado")
DELL_STATUS = HOME / ".local/bin/dell-status"
HERMES = HOME / ".local/bin/hermes"
FILA_DE_AVISOS = HOME / ".local/share/avisos/fila"
BRIDGE_LOG = HOME / ".hermes/whatsapp/bridge.log"

ESPERA_INICIAL_S = 60       # o healthwatch religa em até 1 min: dá a vez a ele
ESPERA_DEPOIS_DO_REMEDIO_S = 90
JANELA_S = 6 * 3600
MAX_REMEDIOS_POR_JANELA = 2  # por verificação
MAX_HERMES_POR_JANELA = 1    # por verificação
MAX_HERMES_POR_DIA = 6       # no total (24 h corridas)
TEMPO_DO_HERMES_S = 300
TEMPO_DO_COMANDO_S = 120
TEMPO_DA_RECONFERENCIA_S = 150
# -t todo: o Hermes no -z aprova qualquer ferramenta sozinho; sem terminal/arquivo/navegador ele não muda nada.
TOOLSETS_DO_HERMES = os.environ.get("SOCORRO_HERMES_TOOLSETS", "todo")
SKILLS_DO_HERMES = os.environ.get("SOCORRO_HERMES_SKILLS", "mapa-do-ecossistema")
MAX_SAIDA_POR_COMANDO = 3000
MAX_PROMPT = 40000


def log(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%S"), *a, flush=True)


# ------------------------------------------------------------------ a lista branca (o ÚNICO que muda estado)

def _reiniciar(unit: str) -> list[str]:
    return ["systemctl", "--user", "restart", unit]


N8N_CONTAINER = "licitacoes-automation-n8n-1"
EVOLUTION_CONTAINERS = ["evolution-api-1", "evolution-postgres-1", "evolution-redis-1"]

# id -> (comando, descrição para o aviso). Tudo idempotente: religar o que já está de pé só o religa.
REMEDIOS: dict[str, tuple[list[str], str]] = {
    "reiniciar:hermes-gateway": (_reiniciar("hermes-gateway.service"), "religuei o gateway do Hermes"),
    "reiniciar:hermes-dashboard": (_reiniciar("hermes-dashboard.service"), "religuei o painel do Hermes"),
    "reiniciar:hermes-google-browser": (_reiniciar("hermes-google-browser.service"), "religuei o navegador do Hermes"),
    "reiniciar:code-server": (_reiniciar("code-server.service"), "religuei o code-server"),
    "reiniciar:evolution-adaptador": (_reiniciar("evolution-adaptador.service"), "religuei o adaptador da Evolution"),
    "reiniciar:whatsapp-observador": (_reiniciar("whatsapp-observador.service"), "religuei o observador do WhatsApp"),
    "reiniciar:whatsapp-observador-prumo": (_reiniciar("whatsapp-observador-prumo.service"),
                                            "religuei o observador do número do PRUMO"),
    # O mesmo que o healthwatch faz com o n8n de pé e sem resposta.
    "docker-reiniciar:n8n": (["docker", "restart", N8N_CONTAINER], "reiniciei o container do n8n"),
    # `start` de container parado (não recria nada; o que já roda fica como está).
    "docker-iniciar:evolution": (["docker", "start", *EVOLUTION_CONTAINERS], "subi os containers da Evolution"),
}


def remedios_para(c: dict) -> list[str]:
    """PURO. Os remédios da lista branca para uma verificação em falha, pelo id e pelo detalhe.
    Vazio = nenhum remédio seguro conhecido (o Hermes diagnostica)."""
    cid, det = str(c.get("id") or ""), str(c.get("detalhe") or "")
    if cid == "hermes":
        return ["reiniciar:hermes-gateway"] if "Gateway parado" in det else ["reiniciar:hermes-dashboard"]
    if cid == "hermes-navegador":
        return ["reiniciar:hermes-google-browser"]
    if cid == "terminal":
        return ["reiniciar:code-server"]
    if cid == "n8n" or cid == f"container:{N8N_CONTAINER}":
        return ["docker-reiniciar:n8n"]
    if cid == "whatsapp-sessao":
        # Bridge sem resposta = o gateway (que a sobe) caiu ou travou. Sessão "disconnected"/Logged out pede
        # QR no celular: religar não resolve e não é remédio.
        return ["reiniciar:hermes-gateway"] if "sem resposta" in det else []
    if cid == "whatsapp-prumo":
        if "caiu" in det:  # número desconectado: QR no celular, não remédio
            return []
        r = []
        if "container" in det:
            r.append("docker-iniciar:evolution")
        for unit in ("evolution-adaptador", "whatsapp-observador-prumo"):
            if re.search(rf"fora do ar: [^;]*\b{re.escape(unit)}\b", det):
                r.append(f"reiniciar:{unit}")
        return r
    if cid.startswith("container:evolution-"):
        return ["docker-iniciar:evolution"]
    return []


# ------------------------------------------------------------------ tetos e chave (PURO sobre o estado)

def desligado(env=None, marca: Path | None = None) -> bool:
    env = os.environ if env is None else env
    if str(env.get("SOCORRO_DESLIGADO", "")).strip() not in ("", "0"):
        return True
    return (marca or MARCA_DESLIGADO).exists()


def _recentes(instantes, agora: float, janela: float) -> list[float]:
    # Folga de 5 min para o relógio que volta um pouco (NTP): a tentativa não some e o teto não se perde.
    return [t for t in (instantes or []) if isinstance(t, (int, float)) and -300 <= agora - t < janela]


def pode_remediar(estado: dict, cid: str, agora: float) -> bool:
    return len(_recentes(estado.get("remedios", {}).get(cid), agora, JANELA_S)) < MAX_REMEDIOS_POR_JANELA


def pode_hermes(estado: dict, cid: str, agora: float) -> tuple[bool, str]:
    """(pode, motivo de não poder)."""
    if len(_recentes(estado.get("hermes_dia"), agora, 86400)) >= MAX_HERMES_POR_DIA:
        return False, f"teto de {MAX_HERMES_POR_DIA} diagnósticos do Hermes por dia"
    if len(_recentes(estado.get("hermes", {}).get(cid), agora, JANELA_S)) >= MAX_HERMES_POR_JANELA:
        return False, "o Hermes já olhou esta falha nas últimas 6 h"
    return True, ""


def registrar(estado: dict, tipo: str, cid: str | None, agora: float) -> None:
    if tipo == "hermes_dia":
        estado["hermes_dia"] = _recentes(estado.get("hermes_dia"), agora, 86400) + [agora]
        return
    por = estado.setdefault(tipo, {})
    por[cid] = _recentes(por.get(cid), agora, 86400) + [agora]


def podar(estado: dict, agora: float) -> dict:
    """Só o que ainda conta para algum teto (24 h)."""
    out = {"hermes_dia": _recentes(estado.get("hermes_dia"), agora, 86400)}
    for tipo in ("remedios", "hermes"):
        out[tipo] = {k: v for k, v in ((k, _recentes(v, agora, 86400)) for k, v in (estado.get(tipo) or {}).items()) if v}
    return out


def ler_estado() -> dict:
    try:
        d = json.loads(ESTADO.read_text())
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def gravar_estado(estado: dict, agora: float) -> None:
    try:
        ESTADO.parent.mkdir(parents=True, exist_ok=True)
        tmp = ESTADO.with_suffix(".tmp")
        tmp.write_text(json.dumps(podar(estado, agora)))
        tmp.replace(ESTADO)
    except OSError as e:
        log("estado não gravado:", e)


# ------------------------------------------------------------------ o que o Hermes pode ler (coletado AQUI)

def _journal(unit: str, n: int = 50) -> list[str]:
    return ["journalctl", "--user", "-u", unit, "-n", str(n), "--no-pager", "-o", "short-iso"]


def _status(unit: str) -> list[str]:
    return ["systemctl", "--user", "status", unit, "--no-pager", "-n", "0"]


UNITS_DO_CHECK = {
    "hermes": ["hermes-gateway.service", "hermes-dashboard.service"],
    "whatsapp-sessao": ["hermes-gateway.service"],
    "hermes-navegador": ["hermes-google-browser.service"],
    "terminal": ["code-server.service"],
    "whatsapp-prumo": ["evolution-adaptador.service", "whatsapp-observador-prumo.service"],
    "gerador": ["gerador-de-sites.service"],
    "funil-aprendizado": ["funil-aprendizado.service"],
    "prumo-mapa": ["prumo-mapa.service", "prumo-mapa.path"],
    "healthwatch": ["dell-worker-healthwatch.service"],
}


# O backup-dell.service nunca existiu: são os dois timers do backup (cofre e espelho) e a coleta da estrutura.
# O id é "backup" (status.json ausente) ou "backup:<fonte>" (HC-9, auditoria de 19/10/2026).
UNITS_DO_BACKUP = ["backup-dell-cofre.service", "backup-dell-espelho.service", "estrutura-coletar.service"]

# Ids cuja única leitura útil é a lista geral de units falhas (a verificação é justamente essa lista).
SO_A_LISTA_GERAL = {"units"}


def units_do_check(cid: str) -> list[str]:
    if cid == "backup" or cid.startswith("backup:"):
        return UNITS_DO_BACKUP
    return UNITS_DO_CHECK.get(cid, [])


def ha_o_que_ler(c: dict) -> bool:
    """PURO. Há leitura própria desta falha (units, containers, disco) além do `systemctl --failed` genérico?
    Sem leitura e sem remédio o Hermes receberia só o detalhe que o aviso já traz: gastar o teto de
    diagnósticos por dia com isso (HC-8) esconderia as falhas que ele poderia mesmo explicar."""
    return str(c.get("id") or "") in SO_A_LISTA_GERAL or len(comandos_de_leitura(c)) > 1


def comandos_de_leitura(c: dict) -> list[list[str]]:
    """PURO. Só leitura: journal, status, docker ps/logs. Nome de container só de [A-Za-z0-9_.-]."""
    cid = str(c.get("id") or "")
    cmds: list[list[str]] = [["systemctl", "--user", "--failed", "--no-pager", "--plain"]]
    for unit in units_do_check(cid):
        cmds += [_status(unit), _journal(unit)]
    containers = []
    if cid in ("n8n", "docker", "containers"):
        containers = [N8N_CONTAINER]
    elif cid == "whatsapp-prumo":
        containers = EVOLUTION_CONTAINERS[:1]
    elif cid.startswith("container:") and re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", cid.split(":", 1)[1]):
        containers = [cid.split(":", 1)[1]]
    if containers or cid in ("docker", "containers"):
        cmds.append(["docker", "ps", "-a", "--format", "{{.Names}}\t{{.State}}\t{{.Status}}"])
    for nome in containers:
        cmds.append(["docker", "logs", "--tail", "60", nome])
    if cid == "disco":
        cmds.append(["df", "-h", "/", str(HOME)])
    return cmds


SEQUENCIA = re.compile(r"\+?\d[\d ()./-]{8,}\d")
DATA = re.compile(r"\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4}")
TOKEN = re.compile(r"\b[A-Za-z0-9_\-]{32,}\b")
SEGREDO_EM_LINHA = re.compile(r"(?i)(api[_-]?key|token|secret|senha|password|authorization|apikey)\s*[:=]\s*\S+")


def _numero(m: re.Match) -> str:
    s = m.group(0)
    if DATA.search(s):  # data e hora do journal ficam
        return s
    return "[número]" if len(re.sub(r"\D", "", s)) >= 10 else s


def mascarar(texto: str) -> str:
    """PURO. Nada de telefone (lead!) nem token sai para o modelo ou para o aviso."""
    texto = SEGREDO_EM_LINHA.sub(lambda m: m.group(1) + "=[…]", texto)
    texto = TOKEN.sub("[…]", texto)
    return SEQUENCIA.sub(_numero, texto)


def _cortar(texto: str, teto: int) -> str:
    return texto if len(texto) <= teto else "…" + texto[-(teto - 1):]


# ------------------------------------------------------------------ o pedido ao Hermes

def montar_prompt(itens: list[dict], diagnostico: str) -> str:
    """PURO. `itens`: [{check, tentou: [(remedio, ok)], pulou}]."""
    linhas = []
    for i in itens:
        c = i["check"]
        tentou = "; ".join(f"{r} ({'rodou' if ok else 'o comando falhou'}) e a falha continuou" for r, ok in i["tentou"]) or "nada"
        linhas.append(f"- id `{c.get('id')}` ({c.get('nome')}): {c.get('detalhe')}\n"
                      f"  o que a Central diz: {c.get('o_que_fazer') or '-'}\n  já tentado: {tentou}"
                      + (f" ({i['pulou']})" if i.get("pulou") else ""))
    remedios = "\n".join(f"- `{k}`: {' '.join(v[0])}" for k, v in REMEDIOS.items())
    return f"""Você é o Hermes, no Dell (a Mel), chamado pelo socorro automático do dell-status (pedido do Rômulo em 16/10/2026: as falhas disparam você para resolver).

Verificações que entraram em FALHA e não voltaram sozinhas:
{chr(10).join(linhas)}

Leitura já coletada para você (journal, systemctl, docker; números e tokens mascarados):
{diagnostico}

Regras desta chamada (valem acima de qualquer outra):
- Você NÃO executa nada. Não tem terminal nem arquivo nesta chamada; não peça para ter.
- A ÚNICA mudança de estado permitida é UM remédio desta lista fechada, que o socorro executa por você se você o escolher (com teto de 2 tentativas por falha a cada 6 h):
{remedios}
  Só escolha um remédio se a leitura indicar que ele resolve (ex.: unit morta ou travada). Não escolha o que já foi tentado e não resolveu. Na dúvida, "nenhum".
- Qualquer outra correção (código, configuração, credencial, QR do WhatsApp, fluxo do n8n, disco, rede) é para o Claude Code: escreva o pedido pronto para o Rômulo colar, com sintoma, evidência (comando e trecho do log) e o que você já descartou.
- Nunca mande mensagem a ninguém, nunca cite número de telefone, token ou segredo, e não invente: o que a leitura não mostra é "não verifiquei".

Responda SÓ com um objeto JSON, sem texto antes ou depois:
{{"checks": [{{"id": "<id da verificação>", "diagnostico": "<1 a 3 frases, português do Brasil>", "remedio": "<um id da lista ou nenhum>", "pedido_para_o_claude": "<pedido pronto, ou vazio se o remédio resolve>"}}]}}
"""


def ler_resposta(texto: str | None, ids: list[str]) -> dict[str, dict]:
    """PURO. A resposta do Hermes -> {id: {diagnostico, remedio|None, pedido}}. Remédio fora da lista
    branca vira None (nunca é executado); id que não foi pedido é ignorado. Texto que não é JSON vira
    o diagnóstico de todos (cortado), sem remédio."""
    out: dict[str, dict] = {}
    bruto = (texto or "").strip()
    dados = None
    if "{" in bruto and "}" in bruto:
        try:
            dados = json.loads(bruto[bruto.index("{"): bruto.rindex("}") + 1])
        except ValueError:
            dados = None
    itens = dados.get("checks") if isinstance(dados, dict) else None
    if isinstance(itens, list):
        for it in itens:
            if not isinstance(it, dict) or str(it.get("id")) not in ids:
                continue
            rem = str(it.get("remedio") or "").strip()
            out[str(it["id"])] = {"diagnostico": str(it.get("diagnostico") or "").strip()[:600],
                                  "remedio": rem if rem in REMEDIOS else None,
                                  "pedido": str(it.get("pedido_para_o_claude") or "").strip()[:1200]}
    if dados is None and bruto:  # não veio JSON: o texto inteiro é o diagnóstico (sem remédio)
        for cid in ids:
            out[cid] = {"diagnostico": _cortar(bruto, 600), "remedio": None, "pedido": ""}
    return out


# ------------------------------------------------------------------ o atendimento

class Socorro:
    """Um atendimento: pedidos -> remédio -> Hermes -> aviso. Tudo de fora entra pelo construtor (testes)."""

    def __init__(self, rodar=None, reconferir=None, hermes=None, avisar=None, relogio=time.time, dormir=time.sleep,
                 estado: dict | None = None, esta_desligado=None):
        self.rodar = rodar or rodar_comando
        self.reconferir = reconferir or reconferir_pelo_dell_status
        self.hermes = hermes or chamar_hermes
        self.avisar = avisar or avisar_pela_fila
        self.relogio, self.dormir = relogio, dormir
        self.estado = estado if estado is not None else {}
        self.esta_desligado = esta_desligado or desligado

    def _ainda_falha(self, itens: list[dict]) -> None:
        atuais = self.reconferir()
        for i in itens:
            if atuais is None:  # não deu para reconferir: trata como ainda em falha (o aviso diz)
                continue
            atual = atuais.get(i["check"]["id"])
            if atual is None or atual.get("estado") != "falha":
                i["resolvido"] = True
            else:
                i["check"] = {**i["check"], **{k: atual[k] for k in ("detalhe", "o_que_fazer", "nome") if atual.get(k)}}

    def _aplicar(self, i: dict, remedios: list[str], rodados: dict[str, tuple[int, str]] | None = None) -> bool:
        """`rodados`: remédio -> (rc, saída) já executado neste atendimento. Duas verificações da mesma queda
        (gateway: hermes + whatsapp-sessao; n8n: n8n + container) mapeiam para o mesmo remédio: roda uma vez
        e o resultado vale para as duas (HC-3), em vez de reiniciar o serviço duas vezes seguidas."""
        cid = i["check"]["id"]
        if not pode_remediar(self.estado, cid, self.relogio()):
            i["pulou"] = f"remédio já usado {MAX_REMEDIOS_POR_JANELA} vezes nas últimas 6 h; não tentei de novo"
            return False
        registrar(self.estado, "remedios", cid, self.relogio())
        rodados = rodados if rodados is not None else {}
        for r in remedios:
            if self.esta_desligado():
                i["pulou"] = "socorro desligado no meio"
                return False
            if r in rodados:
                rc, saida = rodados[r]
                log(f"remédio {r} para {cid}: já rodado neste atendimento ({'ok' if rc == 0 else f'saiu {rc}'})")
            else:
                cmd, _ = REMEDIOS[r]
                rc, saida = self.rodar(cmd, TEMPO_DO_COMANDO_S)
                rodados[r] = (rc, saida)
                log(f"remédio {r} para {cid}: {'ok' if rc == 0 else f'saiu {rc}'} {mascarar(saida)[:200]}")
            i["tentou"].append((r, rc == 0))
        return True

    def atender(self, checks: list[dict]) -> dict:
        """Devolve o relatório {itens, aviso} (o aviso já foi gravado, se houve)."""
        if self.esta_desligado():
            log("socorro desligado: nada a fazer")
            return {"itens": [], "aviso": None}
        vistos: dict[str, dict] = {}
        for c in checks:
            if isinstance(c, dict) and c.get("id"):
                vistos[str(c["id"])] = c
        itens = [{"check": c, "tentou": [], "resolvido": False, "pulou": "", "hermes": None} for c in vistos.values()]
        if not itens:
            return {"itens": [], "aviso": None}
        self.dormir(ESPERA_INICIAL_S)
        self._ainda_falha(itens)
        voltaram = [i for i in itens if i["resolvido"]]
        if voltaram:
            log("voltaram sozinhos (healthwatch ou passageiro):", ", ".join(i["check"]["id"] for i in voltaram))
        itens = [i for i in itens if not i["resolvido"]]
        if not itens:
            return {"itens": [], "aviso": None}

        # 1. Remédio da lista branca.
        rodados: dict[str, tuple[int, str]] = {}
        aplicou = []
        for i in itens:
            rs = remedios_para(i["check"])
            if rs and self._aplicar(i, rs, rodados):
                aplicou.append(i)
        if aplicou:
            self.dormir(ESPERA_DEPOIS_DO_REMEDIO_S)
            self._ainda_falha(aplicou)

        # 2. O Hermes diagnostica o que continua fora.
        restantes = [i for i in itens if not i["resolvido"]]
        # Uma chamada só para todas as que continuam fora (conta 1 no teto do dia), cada uma com o seu teto de 6 h.
        para_hermes = []
        for i in restantes:
            pode, motivo = pode_hermes(self.estado, i["check"]["id"], self.relogio())
            if not remedios_para(i["check"]) and not ha_o_que_ler(i["check"]):
                # Nada a ler e nada a religar: o Hermes só repetiria o detalhe. Registra e deixa o aviso
                # levar o "o que fazer" da Central, sem gastar o teto do dia (HC-8).
                log("sem remédio nem leitura, Hermes não chamado:", i["check"]["id"])
                i["sem_hermes"] = "não há remédio nem leitura própria para esta falha"
            elif pode:
                para_hermes.append(i)
            else:
                i["sem_hermes"] = motivo
        if para_hermes and not self.esta_desligado():
            self._perguntar_ao_hermes(para_hermes, rodados)

        aviso = montar_aviso(itens, self.relogio())
        if aviso:
            self.avisar(*aviso)
        return {"itens": itens, "aviso": aviso}

    def _perguntar_ao_hermes(self, itens: list[dict], rodados: dict[str, tuple[int, str]]) -> None:
        agora = self.relogio()
        registrar(self.estado, "hermes_dia", None, agora)
        for i in itens:
            registrar(self.estado, "hermes", i["check"]["id"], agora)
        leitura = []
        vistos = set()
        for i in itens:
            for cmd in comandos_de_leitura(i["check"]):
                if tuple(cmd) in vistos:
                    continue
                vistos.add(tuple(cmd))
                rc, saida = self.rodar(cmd, 30)
                leitura.append(f"$ {' '.join(cmd)}  (saiu {rc})\n{_cortar(mascarar(saida), MAX_SAIDA_POR_COMANDO)}")
        if any(i["check"]["id"] == "whatsapp-sessao" for i in itens):
            leitura.append("$ fim do bridge.log, sem as linhas de conversa\n" + fim_do_bridge_log())
        diagnostico = _cortar("\n\n".join(leitura), MAX_PROMPT - 6000)
        resposta = self.hermes(montar_prompt(itens, diagnostico))
        lido = ler_resposta(resposta, [i["check"]["id"] for i in itens])
        if resposta is None:
            for i in itens:
                i["sem_hermes"] = "o Hermes não respondeu a tempo"
            return
        a_reconferir = []
        for i in itens:
            h = lido.get(i["check"]["id"])
            i["hermes"] = h
            if not h or not h.get("diagnostico"):
                i["sem_hermes"] = "o Hermes não trouxe diagnóstico desta falha"
            if h and h["remedio"] and h["remedio"] not in [r for r, _ in i["tentou"]]:
                if self._aplicar(i, [h["remedio"]], rodados):
                    i["remedio_do_hermes"] = h["remedio"]
                    a_reconferir.append(i)
        if a_reconferir:
            self.dormir(ESPERA_DEPOIS_DO_REMEDIO_S)
            self._ainda_falha(a_reconferir)


def montar_aviso(itens: list[dict], agora: float) -> tuple[str, str, int] | None:
    """PURO. (título, texto, prioridade) do aviso do socorro, ou None quando não há o que contar."""
    if not itens:
        return None
    hora = datetime.fromtimestamp(agora).strftime("%H:%M")
    partes = []
    for i in itens:
        c = i["check"]
        feitos = [REMEDIOS[r][1] for r, ok in i["tentou"] if ok]
        falhos = [REMEDIOS[r][1] for r, ok in i["tentou"] if not ok]
        if i["resolvido"]:
            como = " e ".join(feitos) or "nada"
            quem = " (remédio escolhido pelo Hermes)" if i.get("remedio_do_hermes") else ""
            partes.append(f"• {c.get('nome')}: resolvido sozinho, {como}{quem}; voltou no teste das {hora}.")
            continue
        linha = f"• {c.get('nome')}: continua fora ({c.get('detalhe')})."
        if feitos:
            linha += f" Tentei: {' e '.join(feitos)}, sem efeito."
        if falhos:
            linha += f" O comando falhou: {' e '.join(falhos)}."
        if i.get("pulou"):
            linha += f" {i['pulou'][0].upper()}{i['pulou'][1:]}."
        h = i.get("hermes")
        if h and h.get("diagnostico"):
            linha += f"\n  Hermes: {h['diagnostico']}"
        elif i.get("sem_hermes"):
            linha += f"\n  Sem diagnóstico do Hermes ({i['sem_hermes']})."
        if h and h.get("pedido"):
            linha += f"\n  Peça ao Claude: \"{h['pedido']}\""
        elif not (h and h.get("remedio")):
            linha += f"\n  O que fazer: {c.get('o_que_fazer') or 'peça ao Claude olhar o detalhe na Central.'}"
        partes.append(linha)
    resolvidos = all(i["resolvido"] for i in itens)
    return ("🛟 Socorro do Dell", mascarar("\n".join(partes)), 2 if resolvidos else 1)


# ------------------------------------------------------------------ o mundo de verdade

def rodar_comando(cmd: list[str], tempo: int) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=tempo, stdin=subprocess.DEVNULL)
        return r.returncode, (r.stdout + ("\n" + r.stderr if r.stderr.strip() else "")).strip()
    except subprocess.TimeoutExpired:
        return 124, f"passou de {tempo} s"
    except OSError as e:
        return 127, str(e)


def reconferir_pelo_dell_status() -> dict[str, dict] | None:
    """O retrato de agora (`dell-status --stdout`, que não grava nem avisa), por id. None = não deu."""
    rc, saida = rodar_comando([str(DELL_STATUS), "--stdout"], TEMPO_DA_RECONFERENCIA_S)
    if rc != 0:
        log("reconferência falhou:", rc, saida[:200])
        return None
    try:
        return {c["id"]: c for c in json.loads(saida[saida.index("{"):])["verificacoes"]}
    except (ValueError, KeyError, TypeError):
        log("reconferência ilegível")
        return None


def fim_do_bridge_log(n: int = 30) -> str:
    """As últimas linhas do bridge.log que não são de conversa (sem chatId/sender), mascaradas."""
    try:
        linhas = BRIDGE_LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-2000:]
    except OSError as e:
        return f"(não li: {e})"
    boas = [l for l in linhas if "chatId" not in l and "senderId" not in l and "@lid" not in l and "@s.whatsapp" not in l]
    return mascarar("\n".join(boas[-n:]))[-MAX_SAIDA_POR_COMANDO:]


def chamar_hermes(prompt: str) -> str | None:
    """`hermes -z` com toolset mínimo; 5 min, mata o grupo do processo se passar. None = sem resposta."""
    cmd = [str(HERMES), "-z", prompt, "-t", TOOLSETS_DO_HERMES]
    if SKILLS_DO_HERMES:
        cmd += ["-s", SKILLS_DO_HERMES]
    PASTA_ESTADO.mkdir(parents=True, exist_ok=True)
    cmd += ["--usage-file", str(PASTA_ESTADO / "ultimo-uso-do-hermes.json")]
    try:
        p = subprocess.Popen(cmd, cwd=PASTA_ESTADO, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, start_new_session=True)
    except OSError as e:
        log("Hermes não subiu:", e)
        return None
    try:
        saida, erro = p.communicate(timeout=TEMPO_DO_HERMES_S)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except (OSError, AttributeError):
            p.kill()
        p.communicate()
        log(f"Hermes passou de {TEMPO_DO_HERMES_S} s: interrompido")
        return None
    if p.returncode != 0:
        log("Hermes saiu com", p.returncode, mascarar(erro or "")[:300])
        return None
    return saida


PASTAS_DA_LIB = [Path(__file__).resolve().parent / "lib", HOME / ".local/lib/mel"]
# O dell-status escolhe o canal por ela (ORIGENS_PELO_TELEGRAM): trocar aqui devolve o aviso ao WhatsApp.
ORIGEM_DO_AVISO = "socorro"


def avisar_pela_fila(titulo: str, texto: str, prioridade: int) -> bool:
    for pasta in PASTAS_DA_LIB:
        arquivo = pasta / "aviso.py"
        if not arquivo.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", arquivo)
            lib = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(lib)
        except Exception:  # noqa: BLE001 — cópia quebrada: tenta a próxima
            continue
        if lib.VALOR_EM_REAIS.search(texto):
            texto = lib.sem_valores(texto)
        r = lib.avisar(titulo, texto, ORIGEM_DO_AVISO, prioridade=prioridade, fila=FILA_DE_AVISOS, prefixo="socorro")
        if not r.gravado:
            log("aviso não gravado:", r.estado, r.motivo)
        return r.gravado
    print(f"lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: {titulo}", file=sys.stderr, flush=True)
    return False


class _Trava:
    def __enter__(self):
        PASTA_ESTADO.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(TRAVA, os.O_WRONLY | os.O_CREAT, 0o600)
        if fcntl is not None:
            fcntl.flock(self.fd, fcntl.LOCK_EX)
        return self

    def __exit__(self, *a):
        os.close(self.fd)


def tirar_pedidos() -> list[dict]:
    """Lê e apaga os pedidos (o path unit sobe o serviço de novo enquanto a pasta não estiver vazia)."""
    checks = []
    for f in sorted(PEDIDOS.glob("*.json")) if PEDIDOS.is_dir() else []:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            checks += [c for c in d.get("checks") or [] if isinstance(c, dict)]
        except (OSError, ValueError, AttributeError) as e:
            log("pedido ilegível descartado:", f.name, e)
        try:
            f.unlink()
        except OSError:
            pass
    for f in PEDIDOS.iterdir() if PEDIDOS.is_dir() else []:  # sobra que não é pedido não prende o path unit
        if f.is_file() and f.suffix != ".json":
            f.unlink(missing_ok=True)
    return checks


def processar() -> int:
    with _Trava():
        checks = tirar_pedidos()
        if not checks:
            return 0
        if desligado():
            log(f"socorro desligado ({MARCA_DESLIGADO}): {len(checks)} pedido(s) descartado(s) sem agir")
            return 0
        log("pedido de socorro:", ", ".join(str(c.get("id")) for c in checks))
        estado = ler_estado()
        s = Socorro(estado=estado)
        try:
            r = s.atender(checks)
        finally:
            gravar_estado(estado, time.time())
        log("fim:", "; ".join(f"{i['check']['id']}={'resolvido' if i['resolvido'] else 'fora'}" for i in r["itens"]) or "nada")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--estado", action="store_true")
    p.add_argument("--simular", metavar="ID")
    p.add_argument("--detalhe", default="")
    p.add_argument("--desligar", nargs="?", const="", metavar="MOTIVO")
    p.add_argument("--ligar", action="store_true")
    a = p.parse_args()
    if a.desligar is not None:
        MARCA_DESLIGADO.parent.mkdir(parents=True, exist_ok=True)
        MARCA_DESLIGADO.write_text(f"{time.strftime('%Y-%m-%d %H:%M')} {a.desligar}".strip() + "\n")
        print(f"desligado ({MARCA_DESLIGADO})")
        return 0
    if a.ligar:
        MARCA_DESLIGADO.unlink(missing_ok=True)
        print("ligado" + (" (mas SOCORRO_DESLIGADO está no ambiente)" if desligado() else ""))
        return 0
    agora = time.time()
    estado = podar(ler_estado(), agora)
    if a.simular:
        c = {"id": a.simular, "detalhe": a.detalhe}
        rs = remedios_para(c)
        print(json.dumps({"remedios": {r: " ".join(REMEDIOS[r][0]) for r in rs}, "pode_remediar": pode_remediar(estado, a.simular, agora),
                          "hermes": pode_hermes(estado, a.simular, agora), "desligado": desligado(),
                          "leitura": [" ".join(x) for x in comandos_de_leitura(c)]}, ensure_ascii=False, indent=1))
        return 0
    if a.estado:
        print(json.dumps({"desligado": desligado(), "marca": str(MARCA_DESLIGADO), "estado": estado,
                          "lista_branca": {k: " ".join(v[0]) for k, v in REMEDIOS.items()}}, ensure_ascii=False, indent=1))
        return 0
    return processar()


if __name__ == "__main__":
    sys.exit(main())
