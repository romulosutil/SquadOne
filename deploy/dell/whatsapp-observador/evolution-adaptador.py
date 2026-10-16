#!/usr/bin/env python3
"""Webhook da Evolution API vira o log que o observador do WhatsApp já sabe ler (Dell).

Para que serve (16/10/2026, plano `docs/superpowers/plans/2026-10-15-envio-whatsapp-sem-bloqueio.md`,
Fase 2): a prospecção sai do número pessoal, onde mora o Hermes, para um número só do PRUMO no
WhatsApp Business. O observador (`observador.py`) lê o `bridge.log` do Hermes; para o número do
PRUMO não há bridge. Este adaptador recebe o webhook da Evolution API e escreve, no MESMO formato
da bridge, o que o observador espera, numa pasta só do PRUMO:

- `evolution.log`: uma linha por evento, sem conteúdo (a mesma gramática da bridge);
    {"event":"ignored","reason":"self_chat_mode_rejects_non_self","chatId":"<tel>@s.whatsapp.net"}   o lead escreveu
    {"event":"owner_sent","chatId":...,"ts":...}                                                      o PRUMO escreveu
    {"event":"owner_receipt","chatId":...,"status":"lido","ts":...}                                   o lead leu
- `respostas.jsonl`: {"chave","ts","texto"} do que um lead escreveu (a mesma convenção do remendo
  `squadone:respostas`: mídia vira "[áudio]", "[imagem] legenda"...).

Uma SEGUNDA instância do observador (`whatsapp-observador-prumo.service`, o mesmo `observador.py`
com `OBSERVADOR_LOG`/`OBSERVADOR_POSICAO` apontando para esta pasta) lê esses arquivos e fala com o
n8n. Nada em `observador.py`, em `whatsapp-conversa.py` ou no n8n muda de contrato, e o número
pessoal e o Hermes não são tocados.

Só leitura: este serviço NUNCA envia, marca como lido, muda presença nem chama a Evolution API. Ele
só escuta (loopback) o que a Evolution já empurra.

Privacidade, no mesmo espírito da bridge:
- só entra no log e no respostas.jsonl quem está em `leads.json` (a lista que o observador grava
  a partir das planilhas, na mesma pasta). Sem a lista, nada é gravado (falha fechada);
- o log tem o número e a hora, nunca o texto; o texto só vai para quem é lead;
- o journal mostra DDD + 2 últimos dígitos, nunca o texto;
- o webhook exige o segredo no header `X-Adaptador` (comparação em tempo constante, antes de
  ler o corpo).

O que a Evolution entrega (e o que ainda não está confirmado): os exemplos publicados mostram
`MESSAGES_UPSERT` com `data.key.{remoteJid,fromMe,id}`, `data.message` e `data.messageTimestamp`.
Para `MESSAGES_UPDATE` (recibo de entrega/leitura) não achei payload publicado. O parser aceita as
formas prováveis (`data.status` em texto, `READ`/`DELIVERY_ACK`/`PLAYED`, ou número 3/4/5; `fromMe`
em `data` ou em `data.key`) e, para a primeira vez que ver cada FORMA de evento, registra no journal
só a estrutura (nomes de campos e tipos, nenhum valor). É por ali que o ensaio de um dia confirma o
recibo de leitura antes de contar com ele. `GET /saude` (com o segredo) mostra os contadores.

LID: se o `remoteJid` vem como `@lid`, o telefone sai de `remoteJidAlt`/`senderPn` (a Evolution os
preenche só às vezes); sem nenhum dos dois o evento é contado em `lid_sem_telefone` e descartado.
Nada de "adivinhar" número.

Desconexão: `CONNECTION_UPDATE` com estado `close` vira UM aviso pelo Hermes (o número deixou de
ser acompanhado e ninguém veria), até a conexão voltar. Só depois de o número ter conectado ao
menos uma vez (marca `conectou` na pasta): o `close` de uma instância cujo QR nunca foi lido não é
queda.
"""
from __future__ import annotations

import hmac
import importlib.util
import json
import os
import re
import signal
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, NamedTuple

HOME = Path.home()
PASTA = Path(os.environ.get("EVOLUTION_PASTA", HOME / ".local/state/whatsapp-observador-prumo"))
ARQUIVO_SEGREDO = Path(os.environ.get("EVOLUTION_SEGREDO", HOME / ".config/claude-ops/evolution-adaptador-segredo"))
PORTA = int(os.environ.get("EVOLUTION_PORTA", "9131"))
# Loopback por padrão. Se a Evolution roda em container, o endereço do host na rede do Docker
# (a ponte, 172.17.0.1 no padrão) é o que ela alcança: ponha-o aqui, nunca 0.0.0.0.
ENDERECO = os.environ.get("EVOLUTION_ENDERECO", "127.0.0.1")
# Vazio = aceita qualquer instância; preenchido = só esta (o nome que se deu na Evolution).
INSTANCIA = os.environ.get("EVOLUTION_INSTANCIA", "").strip()
FILA_DE_AVISOS = HOME / ".local/share/avisos/fila"

MOTIVO = "self_chat_mode_rejects_non_self"  # a mesma palavra da bridge: o observador procura por ela
LIMITE_CORPO = 1_000_000
LIMITE_LOG = 5 * 1024 * 1024
MAX_TEXTO = 1000
VISTOS_MAX = 2000
FORMAS_MAX = 200


def log(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%S"), *a, flush=True)


# ------------------------------------------------------------------ puro: nomes, números, tempo

def chave_do_numero(bruto: str) -> str:
    """DDD + últimos 8 dígitos (a mesma regra do observador e da planilha: o WhatsApp antigo não tem o 9)."""
    d = re.sub(r"\D", "", str(bruto or ""))
    if len(d) >= 12 and d.startswith("55"):
        d = d[2:]
    if len(d) < 10 or len(d) > 11:
        return ""
    return d[:2] + d[-8:]


def mascarar(chave: str) -> str:
    return f"{chave[:2]}******{chave[-2:]}"


def normalizar_evento(nome) -> str:
    """'messages.upsert', 'messages-upsert' e 'MESSAGES_UPSERT' são o mesmo evento."""
    return re.sub(r"[.\-\s]+", "_", str(nome or "")).strip("_").upper()


def jid_de_telefone(jid) -> str:
    """'5527...:12@s.whatsapp.net' -> '5527...@s.whatsapp.net'; só conversa 1:1 com telefone. Senão ''."""
    if not isinstance(jid, str) or "@" not in jid:
        return ""
    usuario, _, dominio = jid.partition("@")
    if dominio not in ("s.whatsapp.net", "c.us"):
        return ""  # @lid, grupo, canal, lista de transmissão, status
    digitos = re.sub(r"\D", "", usuario.split(":")[0])
    if not 10 <= len(digitos) <= 15:
        return ""
    return f"{digitos}@s.whatsapp.net"


def jid_da_conversa(item: dict) -> tuple[str, str]:
    """(jid com telefone, motivo do descarte). O remoteJid manda; o @lid só vale se vier um alternativo."""
    chave = item.get("key") if isinstance(item.get("key"), dict) else {}
    principal = chave.get("remoteJid") or item.get("remoteJid") or ""
    if not isinstance(principal, str) or not principal:
        return "", "sem_chat"
    jid = jid_de_telefone(principal)
    if jid:
        return jid, ""
    dominio = principal.partition("@")[2]
    if dominio == "lid":
        for onde in (chave, item):
            for campo in ("remoteJidAlt", "senderPn", "participantAlt"):
                jid = jid_de_telefone(onde.get(campo))
                if jid:
                    return jid, ""
        return "", "lid_sem_telefone"
    return "", "nao_e_conversa_1a1"


def hora_do_evento(ts, agora: float) -> float:
    """messageTimestamp (s, ms ou texto) -> instante; ausente ou absurdo vira agora."""
    try:
        t = float(ts)
    except (TypeError, ValueError):
        return agora
    if t > 1e12:
        t /= 1000
    return t if 1e9 < t < agora + 300 else agora


# ------------------------------------------------------------------ puro: o texto das mensagens

# Embrulhos que a Evolution/Baileys põem em volta do conteúdo de verdade.
EMBRULHOS = ("ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "documentWithCaptionMessage", "editedMessage")
# Mensagens que não são conversa: reação, apagar/protocolo, edição e voto em enquete (a bridge também não as conta).
RUIDO = ("reactionMessage", "protocolMessage", "editedMessage", "pollUpdateMessage")


def _legenda(m) -> str:
    return str(m.get("caption") or "").strip() if isinstance(m, dict) else ""


def texto_da_mensagem(mensagem, profundidade: int = 0) -> str:
    """O texto como a bridge do Hermes grava (mesma convenção de mídia). '' = nada a guardar
    (reação, edição, protocolo, mensagem sem conteúdo)."""
    if not isinstance(mensagem, dict) or profundidade > 3:
        return ""
    for embrulho in EMBRULHOS:
        interno = mensagem.get(embrulho)
        if isinstance(interno, dict):
            if embrulho == "editedMessage":
                return ""  # edição repete uma mensagem já contada
            return texto_da_mensagem(interno.get("message"), profundidade + 1)
    if any(k in mensagem for k in RUIDO):
        return ""
    ext = mensagem.get("extendedTextMessage")
    for bruto in (
        mensagem.get("conversation"),
        ext.get("text") if isinstance(ext, dict) else None,
        (mensagem.get("buttonsResponseMessage") or {}).get("selectedDisplayText"),
        (mensagem.get("templateButtonReplyMessage") or {}).get("selectedDisplayText"),
        (mensagem.get("listResponseMessage") or {}).get("title"),
    ):
        if isinstance(bruto, str) and bruto.strip():
            return bruto.strip()[:MAX_TEXTO]
    if "imageMessage" in mensagem:
        texto = f"[imagem] {_legenda(mensagem['imageMessage'])}"
    elif "videoMessage" in mensagem:
        texto = f"[vídeo] {_legenda(mensagem['videoMessage'])}"
    elif "audioMessage" in mensagem:
        texto = "[áudio]"
    elif "documentMessage" in mensagem:
        doc = mensagem["documentMessage"]
        texto = f"[documento] {str(doc.get('fileName') or '') if isinstance(doc, dict) else ''}"
    elif "stickerMessage" in mensagem:
        texto = "[figurinha]"
    elif "contactMessage" in mensagem or "contactsArrayMessage" in mensagem:
        texto = "[contato]"
    elif "locationMessage" in mensagem:
        texto = "[localização]"
    else:
        texto = ""
    return texto.strip()[:MAX_TEXTO]


def estado_do_recibo(valor) -> str:
    """'lido' | 'entregue' | ''. Texto do Baileys (READ, PLAYED, DELIVERY_ACK) ou o número do proto (3, 4, 5)."""
    if isinstance(valor, bool):
        return ""
    if isinstance(valor, (int, float)):
        return {3: "entregue", 4: "lido", 5: "lido"}.get(int(valor), "")
    nome = re.sub(r"[^A-Z_]", "", str(valor or "").upper())
    if nome in ("READ", "PLAYED"):
        return "lido"
    if nome in ("DELIVERY_ACK", "DELIVERED"):
        return "entregue"
    return ""


def forma(valor, profundidade: int = 0):
    """A estrutura de um JSON sem nenhum valor: só nomes de campo e tipos. Vai ao journal para
    descobrir o formato real de um evento sem registrar conteúdo de conversa."""
    if profundidade > 5:
        return "..."
    if isinstance(valor, dict):
        return {k: forma(valor[k], profundidade + 1) for k in sorted(valor)[:40]}
    if isinstance(valor, list):
        return [forma(valor[0], profundidade + 1)] if valor else []
    return type(valor).__name__ if valor is not None else "null"


def itens_de(data) -> list[dict]:
    """`data` do webhook: um objeto, uma lista deles, ou {"messages": [...]}."""
    if isinstance(data, list):
        return [d for d in data if isinstance(d, dict)]
    if isinstance(data, dict):
        if isinstance(data.get("messages"), list):
            return [d for d in data["messages"] if isinstance(d, dict)]
        return [data]
    return []


class Recentes:
    """Os últimos ids de mensagem vistos: a Evolution reentrega webhook, e uma resposta não vale duas vezes."""

    def __init__(self, maximo: int = VISTOS_MAX):
        self.ordem: deque = deque()
        self.conjunto: set = set()
        self.maximo = maximo

    def __contains__(self, x) -> bool:
        return x in self.conjunto

    def add(self, x) -> None:
        if x in self.conjunto:
            return
        self.conjunto.add(x)
        self.ordem.append(x)
        while len(self.ordem) > self.maximo:
            self.conjunto.discard(self.ordem.popleft())


class Traducao(NamedTuple):
    linhas: list      # dicts para o evolution.log
    respostas: list   # dicts para o respostas.jsonl
    ignorados: dict   # motivo -> quantos
    conexao: str      # 'open' | 'close' | 'connecting' | ''


def traduzir(corpo, leads, agora: float, vistos: Recentes | None = None, instancia: str = "") -> Traducao:
    """Um webhook da Evolution -> o que escrever. PURO: sem arquivo, rede nem relógio.

    `leads` é o conjunto de chaves (DDD + 8 dígitos) de leads, ou None quando a lista não existe:
    sem ela, nada é gravado."""
    linhas: list = []
    respostas: list = []
    ignorados: dict = {}
    conexao = ""
    vistos = vistos if vistos is not None else Recentes()

    def pular(motivo: str) -> None:
        ignorados[motivo] = ignorados.get(motivo, 0) + 1

    if not isinstance(corpo, dict):
        pular("corpo_invalido")
        return Traducao(linhas, respostas, ignorados, conexao)
    if instancia and corpo.get("instance") != instancia:
        pular("outra_instancia")
        return Traducao(linhas, respostas, ignorados, conexao)
    evento = normalizar_evento(corpo.get("event"))
    data = corpo.get("data")

    if evento == "CONNECTION_UPDATE":
        estado = data.get("state") if isinstance(data, dict) else ""
        if estado in ("open", "close", "connecting"):
            conexao = estado
        return Traducao(linhas, respostas, ignorados, conexao)

    if evento not in ("MESSAGES_UPSERT", "MESSAGES_UPDATE", "SEND_MESSAGE"):
        pular("evento_sem_uso")
        return Traducao(linhas, respostas, ignorados, conexao)
    if leads is None:
        pular("sem_lista_de_leads")
        return Traducao(linhas, respostas, ignorados, conexao)

    for item in itens_de(data):
        jid, motivo = jid_da_conversa(item)
        if not jid:
            pular(motivo)
            continue
        chave = chave_do_numero(jid.partition("@")[0])
        if not chave or chave not in leads:
            pular("nao_e_lead")
            continue
        chave_msg = item.get("key") if isinstance(item.get("key"), dict) else {}
        de_mim = chave_msg.get("fromMe", item.get("fromMe"))

        if evento == "MESSAGES_UPDATE":
            estado = estado_do_recibo(item.get("status", chave_msg.get("status")))
            if estado != "lido":
                pular("recibo_" + (estado or "sem_estado"))  # 'entregue' fica só nos contadores, como na bridge
                continue
            if de_mim is not True:
                # Sem fromMe não dá para separar "o lead leu o que o PRUMO mandou" de "o PRUMO leu o do lead".
                pular("recibo_de_entrada" if de_mim is False else "recibo_sem_fromMe")
                continue
            linhas.append({"event": "owner_receipt", "chatId": jid, "status": "lido", "ts": int(agora)})
            continue

        # MESSAGES_UPSERT / SEND_MESSAGE
        id_msg = chave_msg.get("id") or item.get("id") or item.get("messageId")
        if id_msg:
            if id_msg in vistos:
                pular("reentrega")
                continue
            vistos.add(id_msg)
        mensagem = item.get("message")
        texto = texto_da_mensagem(mensagem)
        sem_conversa = not isinstance(mensagem, dict) or any(k in mensagem for k in RUIDO)
        if de_mim is True:
            if sem_conversa:
                pular("envio_sem_conteudo")
                continue
            ts = hora_do_evento(item.get("messageTimestamp"), agora)
            linhas.append({"event": "owner_sent", "chatId": jid, "ts": int(ts)})
        elif de_mim is False:
            if sem_conversa:
                pular("recebida_sem_conteudo")
                continue
            linhas.append({"event": "ignored", "reason": MOTIVO, "chatId": jid, "senderId": jid})
            if texto:
                respostas.append({"chave": chave, "ts": int(hora_do_evento(item.get("messageTimestamp"), agora)),
                                  "texto": texto})
        else:
            pular("sem_fromMe")
    return Traducao(linhas, respostas, ignorados, conexao)


# ------------------------------------------------------------------ arquivos

class Gravador:
    """A pasta do PRUMO: lê leads.json (do observador) e escreve evolution.log e respostas.jsonl."""

    def __init__(self, pasta: Path = PASTA, limite_log: int = LIMITE_LOG):
        self.pasta = pasta
        self.limite_log = limite_log
        self.trava = threading.Lock()
        self._leads: set[str] | None = None
        self._leads_mtime: float | None = None
        self.pasta.mkdir(parents=True, exist_ok=True)
        # O observador espera o log existir; um arquivo vazio basta.
        self._anexar(self.pasta / "evolution.log", "")

    def marcar_conectou(self) -> None:
        """Lembra, em disco, que o número já chegou a conectar: só então uma queda merece aviso."""
        try:
            self._anexar(self.pasta / "conectou", "")
        except OSError as e:
            log("marca 'conectou' não gravada:", e)

    def ja_conectou(self) -> bool:
        return (self.pasta / "conectou").exists()

    def leads(self) -> set[str] | None:
        """leads.json relido só quando muda; ausente ou ilegível = None (falha fechada)."""
        arquivo = self.pasta / "leads.json"
        try:
            mtime = arquivo.stat().st_mtime
            if mtime != self._leads_mtime:
                lista = json.loads(arquivo.read_text(encoding="utf-8"))
                if not isinstance(lista, list):
                    raise ValueError("leads.json não é uma lista")
                self._leads, self._leads_mtime = {str(x) for x in lista}, mtime
            return self._leads
        except (OSError, ValueError):
            self._leads, self._leads_mtime = None, None
            return None

    def _anexar(self, caminho: Path, texto: str) -> None:
        fd = os.open(caminho, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            if texto:
                os.write(fd, texto.encode("utf-8"))
        finally:
            os.close(fd)

    def escrever(self, t: Traducao) -> None:
        with self.trava:
            if t.linhas:
                caminho = self.pasta / "evolution.log"
                try:
                    if caminho.stat().st_size > self.limite_log:
                        caminho.replace(self.pasta / "evolution.log.1")  # o observador vê o arquivo novo e lê dele
                except OSError:
                    pass
                self._anexar(caminho, "".join(json.dumps(l, ensure_ascii=False) + "\n" for l in t.linhas))
            if t.respostas:
                # O observador troca o nome do arquivo para ler; abrir a cada escrita recria sem perder linha.
                self._anexar(self.pasta / "respostas.jsonl",
                             "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in t.respostas))


# ------------------------------------------------------------------ aviso

PASTAS_DA_LIB = [Path(__file__).resolve().parent.parent / "lib", HOME / ".local/lib/mel"]


def avisar_pelo_hermes(texto: str) -> None:
    """A fila de avisos do Dell (a mesma lib do observador); sem a lib, o arquivo no formato antigo."""
    aviso = {"titulo": "📱 Número do PRUMO no WhatsApp", "texto": texto, "origem": "evolution-adaptador"}
    for pasta in PASTAS_DA_LIB:
        arquivo = pasta / "aviso.py"
        if not arquivo.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", arquivo)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            r = mod.gravar(aviso, fila=FILA_DE_AVISOS, prefixo="evolution")
            if not r.gravado:
                log("aviso não gravado:", r.estado, r.motivo)
            return
        except Exception:  # noqa: BLE001 — cópia quebrada: tenta a próxima, depois o jeito antigo
            continue
    try:
        FILA_DE_AVISOS.mkdir(parents=True, exist_ok=True)
        (FILA_DE_AVISOS / f"evolution-{time.time_ns()}.json").write_text(json.dumps(aviso, ensure_ascii=False), encoding="utf-8")
    except OSError as e:
        log("aviso não gravado:", e)


TEXTO_DESCONECTOU = ("O número do PRUMO no WhatsApp desconectou da Evolution API: as respostas dos leads deste número "
                     "deixaram de marcar a planilha. Reconecte lendo o QR de novo no painel da Evolution.")


# ------------------------------------------------------------------ o serviço

class Adaptador:
    """Junta tradução, arquivos e contadores. `relogio` e `avisar` entram de fora nos testes."""

    def __init__(self, gravador: Gravador, relogio=time.time, avisar: Callable[[str], None] = avisar_pelo_hermes,
                 instancia: str = INSTANCIA):
        self.gravador, self.relogio, self.avisar, self.instancia = gravador, relogio, avisar, instancia
        self.vistos = Recentes()
        self.formas: dict[str, int] = {}
        self.contadores: dict = {"eventos": {}, "linhas": 0, "respostas": 0, "ignorados": {}}
        self.ultimo_evento: float | None = None
        self.desconectado_avisado = False

    def receber(self, corpo) -> Traducao:
        agora = self.relogio()
        evento = normalizar_evento(corpo.get("event")) if isinstance(corpo, dict) else "?"
        self.contadores["eventos"][evento] = self.contadores["eventos"].get(evento, 0) + 1
        self.ultimo_evento = agora
        self._registrar_forma(corpo, evento)
        t = traduzir(corpo, self.gravador.leads(), agora, self.vistos, self.instancia)
        self.gravador.escrever(t)
        self.contadores["linhas"] += len(t.linhas)
        self.contadores["respostas"] += len(t.respostas)
        for motivo, n in t.ignorados.items():
            self.contadores["ignorados"][motivo] = self.contadores["ignorados"].get(motivo, 0) + n
        for l in t.linhas:
            chave = chave_do_numero(l["chatId"].partition("@")[0])
            log(f"{l['event']}{'/' + l['status'] if l.get('status') else ''}: {mascarar(chave)}")
        if t.conexao == "open":
            self.gravador.marcar_conectou()
            if self.desconectado_avisado:
                self.desconectado_avisado = False
                log("conexão do número voltou")
        elif t.conexao == "close" and not self.desconectado_avisado:
            # Sem ter conectado nunca (QR ainda não lido, ou o limite de QRs estourou), "close" não é queda.
            if self.gravador.ja_conectou():
                self.desconectado_avisado = True
                log("conexão do número caiu")
                self.avisar(TEXTO_DESCONECTOU)
            else:
                log("instância fechada antes de conectar (QR não lido): sem aviso")
        return t

    def _registrar_forma(self, corpo, evento: str) -> None:
        """Cada FORMA nova de evento vai ao journal uma vez (só estrutura, nenhum valor)."""
        if len(self.formas) >= FORMAS_MAX or not isinstance(corpo, dict):
            return
        estrutura = json.dumps(forma(corpo.get("data")), ensure_ascii=False, sort_keys=True)
        assinatura = f"{evento}:{estrutura}"
        if assinatura in self.formas:
            return
        self.formas[assinatura] = 1
        log(f"forma nova de {evento}: {estrutura[:900]}")

    def saude(self) -> dict:
        return {"ok": True, "instancia": self.instancia or None, "ultimo_evento": self.ultimo_evento,
                "desconectado": self.desconectado_avisado, "lista_de_leads": self.gravador.leads() is not None,
                **self.contadores}


def fazer_handler(adaptador: Adaptador, segredo: str):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):  # o journal já tem o que importa; nada de caminho nem IP
            pass

        def _responder(self, codigo: int, corpo: dict) -> None:
            dados = json.dumps(corpo).encode()
            self.send_response(codigo)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(dados)))
            self.end_headers()
            self.wfile.write(dados)

        def _autorizado(self) -> bool:
            enviado = self.headers.get("X-Adaptador", "")
            return bool(segredo) and hmac.compare_digest(enviado.encode(), segredo.encode())

        def do_GET(self):
            if not self._autorizado():
                return self._responder(401, {"erro": "segredo"})
            if self.path.split("?")[0] == "/saude":
                return self._responder(200, adaptador.saude())
            self._responder(404, {"erro": "rota"})

        def do_POST(self):
            # O segredo vem antes de ler o corpo.
            if not self._autorizado():
                return self._responder(401, {"erro": "segredo"})
            if not self.path.split("?")[0].startswith("/evolution"):
                return self._responder(404, {"erro": "rota"})
            try:
                tamanho = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return self._responder(400, {"erro": "tamanho"})
            if tamanho > LIMITE_CORPO:
                self.close_connection = True
                return self._responder(413, {"erro": "grande"})
            try:
                corpo = json.loads(self.rfile.read(tamanho) or b"null")
            except ValueError:
                return self._responder(400, {"erro": "json"})
            try:
                t = adaptador.receber(corpo)
            except Exception as e:  # noqa: BLE001 — a Evolution não precisa reentregar o que falhou aqui
                log("erro ao tratar o webhook:", type(e).__name__, e)
                return self._responder(200, {"ok": False})
            self._responder(200, {"ok": True, "linhas": len(t.linhas), "respostas": len(t.respostas)})

    return Handler


def criar_servidor(adaptador: Adaptador, segredo: str, porta: int = PORTA, endereco: str = ENDERECO) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((endereco, porta), fazer_handler(adaptador, segredo))


def main() -> int:
    try:
        segredo = ARQUIVO_SEGREDO.read_text().strip()
    except OSError:
        segredo = ""
    if not segredo:
        print(f"Sem segredo em {ARQUIVO_SEGREDO}: crie com `openssl rand -hex 24 > {ARQUIVO_SEGREDO}; chmod 600 ...`.",
              file=sys.stderr)
        return 2
    adaptador = Adaptador(Gravador())
    servidor = criar_servidor(adaptador, segredo)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=servidor.shutdown, daemon=True).start())
    log(f"ouvindo {ENDERECO}:{PORTA}; pasta {PASTA}" + (f"; instância {INSTANCIA}" if INSTANCIA else ""))
    try:
        servidor.serve_forever()
    finally:
        servidor.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
