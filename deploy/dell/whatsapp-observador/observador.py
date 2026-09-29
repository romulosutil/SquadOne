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

Saudação automática (29/09/2026): WhatsApp Business responde sozinho segundos
depois do envio, e isso não é resposta de gente. O n8n só conta como resposta
(respondeu_em) mensagem a 5 min ou mais do envio. Para isso, quando o lead volta
a escrever 5 min ou mais depois do primeiro aviso, sai um segundo aviso
("seguinte": true); depois, silêncio até fechar a janela de 6 h.

Reinício (29/09/2026): a posição no log fica em ~/.local/state/whatsapp-observador
(só inode e byte, nenhum número), e o leitor continua de onde parou; e só começa
a ler depois de conseguir a lista de números do n8n (antes, um boot com o n8n
ainda subindo perdia as respostas dos 10 primeiros minutos).

Privacidade: o log não tem conteúdo e este leitor não guarda nada além da
posição no log; só o número de quem é lead sai daqui (DDD + 8 últimos dígitos).
Grupos, canais e status são ignorados. O log do serviço mostra só DDD + 2
últimos dígitos.
"""
from __future__ import annotations

import json
import os
import re
import signal
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
POSICAO = Path(os.environ.get("OBSERVADOR_POSICAO", HOME / ".local/state/whatsapp-observador/posicao.json"))

RELER_NUMEROS_S = 10 * 60
# Sem lista (n8n fora ou subindo): tenta de novo logo.
RELER_SE_FALHOU_S = 30
# Uma conversa de 30 mensagens não vira 30 leituras da planilha.
JANELA_DEDUPE_S = 6 * 3600
# A saudação automática chega em segundos; escrever de novo depois disto é gente (ver n8n).
JANELA_SAUDACAO_S = 5 * 60
GRAVAR_POSICAO_S = 10
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


def posicao_salva() -> tuple[int, int] | None:
    try:
        d = json.loads(POSICAO.read_text())
        return int(d["inode"]), int(d["posicao"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def salvar_posicao(inode: int, posicao: int) -> None:
    try:
        POSICAO.parent.mkdir(parents=True, exist_ok=True)
        tmp = POSICAO.with_suffix(".tmp")
        tmp.write_text(json.dumps({"inode": inode, "posicao": posicao}))
        tmp.replace(POSICAO)
    except OSError as e:
        log("posição não gravada:", e)


def seguir(caminho: Path, onde: dict):
    """tail -F: continua da posição salva se o arquivo é o mesmo; senão começa no FIM
    (o passado não marca nada). Aguenta arquivo truncado ou recriado. `onde` recebe
    inode e byte do que já foi lido."""
    arq, inode = None, None
    while True:
        if arq is None:
            try:
                arq = open(caminho, "rb")
                inode = os.fstat(arq.fileno()).st_ino
                salvo = posicao_salva()
                tamanho = os.fstat(arq.fileno()).st_size
                if salvo and salvo[0] == inode and salvo[1] <= tamanho:
                    arq.seek(salvo[1])
                    log(f"continuando do byte {salvo[1]} ({tamanho - salvo[1]} bytes novos)")
                else:
                    arq.seek(0, os.SEEK_END)
                onde.update(inode=inode, posicao=arq.tell())
            except OSError:
                time.sleep(5)
                continue
        linha = arq.readline()
        if linha:
            yield linha.decode("utf-8", "replace")
            onde.update(inode=inode, posicao=arq.tell())  # só depois de a linha ser tratada
            continue
        try:
            st = os.stat(caminho)
            if st.st_ino != inode or st.st_size < arq.tell():
                arq.close()
                arq = open(caminho, "rb")  # recriado ou truncado: lê desde o começo do novo
                inode = os.fstat(arq.fileno()).st_ino
                onde.update(inode=inode, posicao=0)
                continue
        except OSError:
            pass
        yield None  # nada novo: dá a vez ao laço principal
        time.sleep(1)


def numeros_dos_leads() -> set[str] | None:
    try:
        chaves = set(filter(None, http("GET", "whatsapp-telefones").get("chaves", [])))
        log(f"{len(chaves)} número(s) de lead no filtro")
        return chaves
    except Exception as e:  # noqa: BLE001 — quem chama decide o que fazer sem a lista
        log("não consegui reler os números dos leads:", e)
        return None


def main() -> int:
    # Sem a lista, toda resposta seria descartada: espera o n8n antes de ler o log.
    while (chaves := numeros_dos_leads()) is None:
        time.sleep(RELER_SE_FALHOU_S)
    onde: dict = {}
    log(f"acompanhando {LOG_DA_BRIDGE}")
    try:
        return acompanhar(chaves, onde)
    finally:
        if onde:
            salvar_posicao(onde["inode"], onde["posicao"])


def acompanhar(chaves: set[str], onde: dict) -> int:
    proxima_leitura = time.time() + RELER_NUMEROS_S
    # número -> (instante do primeiro aviso da janela, avisos mandados nela)
    vistos: dict[str, tuple[float, int]] = {}
    gravado, gravado_em = None, 0.0
    ultima_linha = time.time()
    silencio_avisado = False
    for linha in seguir(LOG_DA_BRIDGE, onde):
        agora = time.time()
        if agora >= proxima_leitura:
            novas = numeros_dos_leads()
            if novas is not None:
                chaves = novas  # falhou: mantém a lista anterior
            proxima_leitura = agora + (RELER_NUMEROS_S if novas is not None else RELER_SE_FALHOU_S)
        if onde and (onde["inode"], onde["posicao"]) != gravado and agora - gravado_em >= GRAVAR_POSICAO_S:
            gravado, gravado_em = (onde["inode"], onde["posicao"]), agora
            salvar_posicao(*gravado)
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
        antes = vistos.get(chave)
        seguinte = False
        if antes and agora - antes[0] < JANELA_DEDUPE_S:
            # Mesma janela: só um segundo aviso, e só depois do tempo da saudação automática.
            if antes[1] >= 2 or agora - antes[0] < JANELA_SAUDACAO_S:
                continue
            seguinte = True
            vistos[chave] = (antes[0], 2)
        else:
            vistos[chave] = (agora, 1)
        evento = {"chave": chave, "direcao": "entrada", "em": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
        if seguinte:
            evento["seguinte"] = True
        try:
            http("POST", "whatsapp-conversa", evento)
            log(f"lead {'escreveu de novo' if seguinte else 'respondeu'}: {mascarar(chave)}")
        except Exception as e:  # noqa: BLE001 — a próxima mensagem do lead tenta de novo
            if antes:
                vistos[chave] = antes
            else:
                vistos.pop(chave, None)
            log(f"n8n não recebeu ({mascarar(chave)}):", e)
    return 0


if __name__ == "__main__":
    # systemctl stop manda SIGTERM: sai pelo finally e grava a posição.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    sys.exit(main())
