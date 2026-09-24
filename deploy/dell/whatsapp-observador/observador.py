#!/usr/bin/env python3
"""Resposta de lead no WhatsApp marca a planilha sozinha (Dell).

O Rômulo aborda os leads direto no WhatsApp e não tem tempo de voltar à
planilha. O Hermes já está vinculado ao número dele (modo self-chat) e a bridge
registra, para TODA mensagem recebida de outra pessoa, uma linha
`{"event":"ignored","reason":"self_chat_mode_rejects_non_self","chatId":...}`
no `~/.hermes/whatsapp/bridge.log` — sem o conteúdo. Este leitor acompanha esse
log e, quando quem escreveu é um número das planilhas, avisa o n8n
(`claude-ops/whatsapp-conversa.py`), que marca o lead.

Por que ler o log e não parear outro aparelho nem mexer na bridge: um segundo
dispositivo exigia pareamento (e falhou), e a bridge muda a cada `hermes update`.
Ler um log que ela já escreve não depende de nenhuma das duas coisas.

Limite conhecido: mensagens ENVIADAS pelo Rômulo não aparecem no log com o
número (só mascarado, em modo debug). Então o que marca é a RESPOSTA do lead —
e resposta prova que o contato aconteceu. Os links rastreados continuam
marcando o envio.

Privacidade: o log não tem conteúdo e este leitor não guarda nada; só o número
de quem é lead sai daqui (DDD + 8 últimos dígitos). Grupos, canais e status são
ignorados. O log do serviço mostra só DDD + 2 últimos dígitos.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

HOME = Path.home()
LOG_DA_BRIDGE = Path(os.environ.get("OBSERVADOR_LOG", HOME / ".hermes/whatsapp/bridge.log"))
SESSAO_HERMES = Path(os.environ.get("OBSERVADOR_SESSAO", HOME / ".hermes/whatsapp/session"))
N8N = os.environ.get("OBSERVADOR_N8N", "http://127.0.0.1:5679/webhook")
SEGREDO = (HOME / ".config/claude-ops/whatsapp-observador-segredo").read_text().strip()
FILA_DE_AVISOS = HOME / ".local/share/avisos/fila"

RELER_NUMEROS_S = 10 * 60
# Uma conversa de 30 mensagens não vira 30 leituras da planilha.
JANELA_DEDUPE_S = 6 * 3600
# Log parado por mais que isto com o Hermes no ar = algo mudou na bridge.
SILENCIO_SUSPEITO_S = 6 * 3600
MOTIVO = "self_chat_mode_rejects_non_self"


def log(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%S"), *a, flush=True)


def chave_do_numero(bruto: str) -> str:
    """DDD + últimos 8 dígitos: o WhatsApp guarda celular antigo sem o 9, a planilha às vezes com."""
    d = re.sub(r"\D", "", str(bruto or ""))
    if len(d) >= 12 and d.startswith("55"):
        d = d[2:]
    if len(d) < 10 or len(d) > 11:
        return ""
    return d[:2] + d[-8:]


def mascarar(chave: str) -> str:
    return f"{chave[:2]}******{chave[-2:]}"


def telefone_do_chat(chat_id: str) -> str:
    usuario, _, dominio = chat_id.partition("@")
    usuario = usuario.split(":")[0]
    if dominio == "s.whatsapp.net":
        return usuario
    if dominio == "lid":
        # Mapa que a própria sessão do Hermes mantém (só leitura).
        reverso = SESSAO_HERMES / f"lid-mapping-{usuario}_reverse.json"
        try:
            return str(json.loads(reverso.read_text()))
        except (OSError, ValueError):
            return ""
    return ""  # g.us, newsletter, broadcast: não é conversa 1:1


def http(metodo: str, caminho: str, corpo: dict | None = None) -> dict:
    req = urllib.request.Request(
        f"{N8N}/{caminho}", method=metodo,
        headers={"X-Observador": SEGREDO, "Content-Type": "application/json"},
        data=json.dumps(corpo).encode() if corpo is not None else None,
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def avisar_pelo_hermes(texto: str) -> None:
    try:
        FILA_DE_AVISOS.mkdir(parents=True, exist_ok=True)
        (FILA_DE_AVISOS / f"observador-{int(time.time())}.json").write_text(
            json.dumps({"titulo": "📱 Observador do WhatsApp", "texto": texto}, ensure_ascii=False))
    except OSError as e:
        log("aviso não gravado:", e)


def seguir(caminho: Path):
    """tail -F: começa no FIM (o passado não marca nada) e aguenta arquivo truncado ou recriado."""
    arq, inode = None, None
    while True:
        if arq is None:
            try:
                arq = open(caminho, "rb")
                inode = os.fstat(arq.fileno()).st_ino
                arq.seek(0, os.SEEK_END)
            except OSError:
                time.sleep(5)
                continue
        linha = arq.readline()
        if linha:
            yield linha.decode("utf-8", "replace")
            continue
        try:
            st = os.stat(caminho)
            if st.st_ino != inode or st.st_size < arq.tell():
                arq.close()
                arq = open(caminho, "rb")  # recriado ou truncado: lê desde o começo do novo
                inode = os.fstat(arq.fileno()).st_ino
                continue
        except OSError:
            pass
        yield None  # nada novo: dá a vez ao laço principal
        time.sleep(1)


def main() -> int:
    chaves: set[str] = set()
    relido_em = 0.0
    vistos: dict[str, float] = {}
    ultima_linha = time.time()
    silencio_avisado = False
    log(f"acompanhando {LOG_DA_BRIDGE}")
    for linha in seguir(LOG_DA_BRIDGE):
        agora = time.time()
        if agora - relido_em > RELER_NUMEROS_S:
            try:
                chaves = set(filter(None, http("GET", "whatsapp-telefones").get("chaves", [])))
                log(f"{len(chaves)} número(s) de lead no filtro")
            except Exception as e:  # noqa: BLE001 — mantém a lista anterior
                log("não consegui reler os números dos leads:", e)
            relido_em = agora
        if linha is None:
            if agora - ultima_linha > SILENCIO_SUSPEITO_S and not silencio_avisado:
                avisar_pelo_hermes("O log da bridge do WhatsApp está parado há 6 h: as respostas de leads podem não "
                                   "estar marcando a planilha (Hermes fora do ar ou mudança na bridge).")
                silencio_avisado = True
            continue
        ultima_linha, silencio_avisado = agora, False
        if MOTIVO not in linha:
            continue
        try:
            ev = json.loads(linha[linha.index("{"):])
        except ValueError:
            continue
        if ev.get("reason") != MOTIVO:
            continue
        chave = chave_do_numero(telefone_do_chat(str(ev.get("chatId") or "")))
        if not chave or chave not in chaves:
            continue
        if agora - vistos.get(chave, 0) < JANELA_DEDUPE_S:
            continue
        vistos[chave] = agora
        try:
            http("POST", "whatsapp-conversa", {"chave": chave, "direcao": "entrada",
                                               "em": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
            log(f"lead respondeu: {mascarar(chave)}")
        except Exception as e:  # noqa: BLE001 — a próxima mensagem do lead tenta de novo
            vistos.pop(chave, None)
            log(f"n8n não recebeu ({mascarar(chave)}):", e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
