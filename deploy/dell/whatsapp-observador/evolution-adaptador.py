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
- `respostas.jsonl`: {"chave","ts","texto","id"?,"audio"?} do que um lead escreveu (a mesma convenção do remendo
  `squadone:respostas`: mídia vira "[imagem] legenda"...; áudio, desde 17/10/2026, "[áudio 27s]" com a duração e,
  até MAX_AUDIO_S, `audio: {seg, msg}` para o observador baixar da Evolution e transcrever);
- `enviadas.jsonl` (16/10/2026): {"chave","ts","texto","id"?} do que o PRUMO escreveu a um lead, só para a
  conversa do lead em disco (o observador grava em WHATSAPP_CONVERSAS_DIR e apaga este arquivo). O
  `owner_sent` do log ganha o `id` da mensagem, nunca o texto.

Uma SEGUNDA instância do observador (`whatsapp-observador-prumo.service`, o mesmo `observador.py`
com `OBSERVADOR_LOG`/`OBSERVADOR_POSICAO` apontando para esta pasta) lê esses arquivos e fala com o
n8n. Nada em `observador.py`, em `whatsapp-conversa.py` ou no n8n muda de contrato, e o número
pessoal e o Hermes não são tocados.

Só leitura: este serviço NUNCA envia, marca como lido, muda presença nem chama a Evolution API. Ele
só escuta (loopback) o que a Evolution já empurra.

Privacidade, no mesmo espírito da bridge:
- só entra no log e nas capturas quem está na fonte fresca `leads.json`. Com fonte indisponível ou
  LID ainda sem correlação, só o evento mínimo 1:1 fica em entrada-pendente.json (600/atômico),
  antes do ACK. Sem QR, nomes, tokens ou payload bruto; grupos/ruído nunca entram. Backpressure
  de 2000 itens/2 MiB, 24 KiB por item: cheio/falha retorna503 e não apaga pendências;
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

LID: pares validados de leads persistem em lid-telefone.json (600/atômico). Um hint posterior
resolve a pendência, preservando a hora original; a fonte fresca descarta quem não é lead.
O loop interno drena a cada5s, sem novo serviço. _adaptador_id é só a confirmação local das
capturas/observador, nunca segue ao n8n/modelo ou journal. Não se adivinha número.
As entregas duráveis usam capturas-adaptador/<sha256>.json, imutáveis e publicadas com
fsync+rename. Não fazem append nos arquivos da bridge. O observador confirma sua fila
em disco antes de removê-las; os limites de quantidade e bytes também valem nessa passagem.

Desconexão: `CONNECTION_UPDATE` com estado `close` vira UM aviso (o número deixou de
ser acompanhado e ninguém veria), até a conexão voltar. Só depois de o número ter conectado ao
menos uma vez (marca `conectou` na pasta): o `close` de uma instância cujo QR nunca foi lido não é
queda.
"""
from __future__ import annotations

import hmac
import hashlib
import importlib.util
import json
import os
import re
import signal
import sys
import threading
import tempfile
import time
from collections import deque
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, NamedTuple

try:
    import fcntl
except ImportError:  # Windows: a trava de threads permanece; produção usa flock.
    fcntl = None

HOME = Path.home()
PASTA_IDENTIDADES = HOME / '.local/share/whatsapp-identidades'
_IDENTIDADE_CAPTURA = None


def identidade_captura():
    """Helper irmão instalado junto; sem rede ou acesso ao texto de outros coletores."""
    global _IDENTIDADE_CAPTURA
    if _IDENTIDADE_CAPTURA is None:
        spec = importlib.util.spec_from_file_location('identidade_captura_evolution', Path(__file__).with_name('identidade_captura.py'))
        modulo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modulo)
        _IDENTIDADE_CAPTURA = modulo
    return _IDENTIDADE_CAPTURA


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
RESUMOS_MAX = 60  # linhas "evento: ..." no journal por execução (só fromMe, estado e domínios; ver resumo_seguro)
# Mensagem recebida mais velha que isto não vira a linha "ignored" (que o observador lê como "agora").
ATRASO_MAX_S = 10 * 60
# O observador regrava leads.json a cada 10 min; mais velho que isto, ele parou: falha fechada outra vez.
LEADS_VELHOS_S = 30 * 60
LIMITE_RESPOSTAS = 2 * 1024 * 1024  # respostas.jsonl que ninguém consome não cresce sem fim
MAX_CONEXOES = 32
TEMPO_DA_CONEXAO_S = 10
SPOOL_MAX = 2 * 1024 * 1024
PENDENTES_MAX = 2000
ITEM_MAX = 24 * 1024
DRENAR_MAX = 100
_TRAVAS: dict[str, threading.RLock] = {}
_TRAVAS_GUARDA = threading.Lock()


def salvar_privado(arquivo: Path, valor) -> None:
    """Sem janela de arquivo parcial; retorno só depois do fsync e rename confirmados."""
    arquivo.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, nome = tempfile.mkstemp(prefix='.' + arquivo.name + '-', dir=arquivo.parent)
    try:
        os.fchmod(fd, 0o600) if hasattr(os, 'fchmod') else os.chmod(nome, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(json.dumps(valor, ensure_ascii=True, separators=(',', ':')).encode())
            f.flush(); os.fsync(f.fileno())
        os.replace(nome, arquivo)
        if os.name != 'nt':
            pasta = os.open(arquivo.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(pasta)
            finally: os.close(pasta)
    finally:
        try: os.unlink(nome)
        except FileNotFoundError: pass


@contextmanager
def trava_privada(arquivo: Path):
    with _TRAVAS_GUARDA:
        trava = _TRAVAS.setdefault(str(arquivo.resolve()), threading.RLock())
    with trava:
        fd = os.open(arquivo, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            if fcntl: fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)


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
    if not re.fullmatch(r'\d{10,15}(?::\d{1,5})?', usuario):
        return ""
    digitos = usuario.split(":")[0]
    if not 10 <= len(digitos) <= 15:
        return ""
    return f"{digitos}@s.whatsapp.net"


def _usuario_lid(jid) -> str:
    return jid.partition("@")[0].split(":")[0] if isinstance(jid, str) and re.fullmatch(r'\d{5,30}(?::\d{1,5})?@lid', jid) else ""


def id_valido(valor) -> bool:
    """IDs da Evolution são opacos: nunca viram nomes de arquivo."""
    return isinstance(valor, str) and 0 < len(valor) <= 200 and not re.search(r'[\x00-\x1f\x7f]', valor)


class Mapas:
    """O que um evento ensina para o seguinte, só de LEAD:

    - `lid`: usuário do @lid -> jid com telefone (durável quando arquivo foi configurado). A Evolution manda o recibo de leitura
      (MESSAGES_UPDATE) só com o @lid, sem o telefone; o mesmo @lid já veio com `remoteJidAlt`
      numa mensagem antes.
    - `msg`: id da mensagem -> jid com telefone, também durável. O recibo traz o `keyId` da mensagem que foi lida.
    Teto de entradas: as mais antigas saem primeiro."""

    def __init__(self, maximo: int = 5000, todos: bool = False, arquivo: Path | None = None,
                 sessao_hermes: Path | None = None):
        self.lid: dict[str, str] = {}
        self.msg: dict[str, str] = {}
        self.maximo = maximo
        # Modo ensaio (EVOLUTION_ENSAIO=1, só para provar a resolução com um telefone que não é lead):
        # também lembra de quem não é lead. Em memória, com o mesmo teto. Desligado por padrão.
        self.todos = todos
        self.arquivo = arquivo
        self.sessao_hermes = sessao_hermes
        self.carregar()

    def da_sessao(self, lid: str) -> str:
        """Só lê a correlação confirmada deste LID; o filtro de leads continua obrigatório."""
        if self.sessao_hermes is None or not re.fullmatch(r'\d{5,30}', lid): return ''
        try:
            numero = str(json.loads((self.sessao_hermes / f'lid-mapping-{lid}_reverse.json').read_text(encoding='utf-8'))).split('@')[0]
        except (OSError, ValueError, TypeError): return ''
        return f'{numero}@s.whatsapp.net' if re.fullmatch(r'55\d{10,11}', numero) else ''

    def carregar(self):
        if self.arquivo is None: return
        if not self.arquivo.exists():
            self.lid, self.msg = {}, {}
            return
        valor = json.loads(self.arquivo.read_text(encoding='utf-8'))
        if not isinstance(valor, dict) or valor.get('versao') != 1 or not isinstance(valor.get('lid'), dict):
            raise ValueError('mapa LID inválido')
        self.lid = {k: v for k, v in valor['lid'].items() if isinstance(k, str) and re.fullmatch(r'\d{5,30}', k) and jid_de_telefone(v) == v}
        self.lid = dict(list(self.lid.items())[-self.maximo:])
        msgs = valor.get('msg', {})
        if not isinstance(msgs, dict): raise ValueError('mapa de mensagens inválido')
        self.msg = dict(list((k, v) for k, v in msgs.items() if id_valido(k) and jid_de_telefone(v) == v)[-self.maximo:])

    def guardar(self, lid: str, id_msg: str, jid: str) -> None:
        if jid_de_telefone(jid) != jid: return
        lid = lid if isinstance(lid, str) and re.fullmatch(r'\d{5,30}', lid) else ''
        id_msg = id_msg if id_valido(id_msg) else ''
        anterior, mensagens_antes = dict(self.lid), dict(self.msg)
        for mapa, k in ((self.lid, lid), (self.msg, id_msg)):
            if not k:
                continue
            mapa.pop(k, None)
            mapa[k] = jid
            while len(mapa) > self.maximo:
                mapa.pop(next(iter(mapa)))
        if self.arquivo is not None and (self.lid != anterior or self.msg != mensagens_antes):
            try: salvar_privado(self.arquivo, {'versao': 1, 'lid': self.lid, 'msg': self.msg})
            except Exception:
                self.lid, self.msg = anterior, mensagens_antes
                raise


def _id_da_mensagem(item: dict) -> str:
    chave = item.get("key") if isinstance(item.get("key"), dict) else {}
    bruto = item.get("keyId") or chave.get("id") or item.get("messageId") or item.get("id") or ""
    return bruto if isinstance(bruto, str) else ""


def jid_da_conversa(item: dict, mapas: "Mapas | None" = None) -> tuple[str, str, str]:
    """(jid com telefone, motivo do descarte, usuário @lid visto). O telefone sai do remoteJid ou, nos
    campos alternativos, de remoteJidAlt/senderPn/participantAlt; um @lid sozinho (recibo de leitura)
    só vale se `mapas` já aprendeu o telefone dele ou da mensagem."""
    chave = item.get("key") if isinstance(item.get("key"), dict) else {}
    principal = chave.get("remoteJid") or item.get("remoteJid") or ""
    if not isinstance(principal, str) or not principal:
        return "", "sem_chat", ""
    # Os campos alternativos só valem para conversa 1:1. Em grupo ou status o participantAlt é o REMETENTE,
    # e a mensagem não foi escrita a nós: sem esta trava, o lead que fala num grupo viraria "respondeu".
    if principal.partition("@")[2] not in ("lid", "s.whatsapp.net", "c.us"):
        return "", "nao_e_conversa_1a1", ""
    candidatos = [principal] + [onde.get(c) for onde in (chave, item)
                                for c in ("remoteJidAlt", "senderPn", "participantAlt")]
    lid = next((u for c in candidatos if (u := _usuario_lid(c))), "")
    jid = next((j for c in candidatos if (j := jid_de_telefone(c))), "")
    if jid:
        return jid, "", lid
    dominio = principal.partition("@")[2]
    if dominio == "lid":
        if mapas is not None:
            achado = mapas.lid.get(lid) or mapas.msg.get(_id_da_mensagem(item)) or mapas.da_sessao(lid)
            if achado:
                return achado, "", lid
        return "", "lid_sem_telefone", lid
    return "", "nao_e_conversa_1a1", lid


def resumo_seguro(evento: str, item: dict) -> str:
    """Uma linha para o journal com só o que não identifica ninguém: fromMe, o estado do recibo, o
    DOMÍNIO dos ids (s.whatsapp.net, lid, g.us) e se há id de mensagem. Nenhum número, nome ou texto."""
    chave = item.get("key") if isinstance(item.get("key"), dict) else {}

    def dominio(j) -> str:
        return j.partition("@")[2][:20] if isinstance(j, str) and "@" in j else "-"
    alt = next((c for onde in (chave, item) for k in ("remoteJidAlt", "senderPn", "participantAlt")
                if (c := onde.get(k))), "")
    status = re.sub(r"[^A-Z0-9_]", "", str(item.get("status", chave.get("status", "")) or "").upper())[:16] or "-"
    de_mim = chave.get("fromMe", item.get("fromMe"))
    return (f"{evento} fromMe={de_mim} status={status} chat={dominio(chave.get('remoteJid') or item.get('remoteJid'))} "
            f"alt={dominio(alt)} id={'sim' if _id_da_mensagem(item) else 'nao'}")


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


def sem_conversa(mensagem, profundidade: int = 0) -> bool:
    """True quando a mensagem não é conversa: ausente, ruído (reação, apagar, edição, voto) ou só
    metadado. Abre os embrulhos (mensagem temporária, visualização única): uma reação dentro de uma
    ephemeralMessage continua sendo reação."""
    if not isinstance(mensagem, dict) or profundidade > 3:
        return True
    if any(k in mensagem for k in RUIDO):
        return True
    for embrulho in EMBRULHOS:
        interno = mensagem.get(embrulho)
        if isinstance(interno, dict):
            return sem_conversa(interno.get("message"), profundidade + 1)
    return not (set(mensagem) - {"messageContextInfo", "senderKeyDistributionMessage"})


# Mensagens de empresa (16/10/2026): clínicas e lojas com a API oficial da Meta mandam menu de botões, texto
# com rodapé (a assinatura do atendente) e listas em formatos que não são "conversation". Sem ler esses, o
# observador sabia que "alguém respondeu" e nunca o quê: a Conecta Kids (Iris) mandou o menu, o "você será
# transferido" e a recepcionista pedindo "nome e idade do paciente", e só o do meio virou texto.
FORMATOS_DE_EMPRESA = ("buttonsMessage", "templateMessage", "interactiveMessage", "listMessage",
                       "highlyStructuredMessage", "interactiveResponseMessage", "richResponseMessage")
# Os campos de texto desses formatos, na ordem em que viram texto (o corpo antes do rodapé e das opções).
CAMPOS_DE_CORPO = ("hydratedTitleText", "title", "text", "contentText", "hydratedContentText", "description", "body")
CAMPOS_DE_RODAPE = ("footerText", "hydratedFooterText", "footer")
CAMPOS_DE_OPCAO = ("displayText", "buttonText")


def _textos(no, campos, profundidade: int = 0, pular=()) -> list[str]:
    """Os textos dos `campos` em qualquer ponto de `no` (até 6 níveis), na ordem do documento, sem repetir.
    `pular`: campos em que não se entra (o rodapé não é corpo)."""
    achados: list[str] = []
    if profundidade > 6:
        return achados
    if isinstance(no, dict):
        for k, v in no.items():
            if k in pular:
                continue
            if k in campos and isinstance(v, str) and v.strip():
                achados.append(v.strip())
            elif k in campos and isinstance(v, dict) and isinstance(v.get("text"), str) and v["text"].strip():
                achados.append(v["text"].strip())  # interactiveMessage: {"body": {"text": ...}}
            elif isinstance(v, (dict, list)):
                achados.extend(_textos(v, campos, profundidade + 1, pular))
    elif isinstance(no, list):
        for v in no[:20]:
            achados.extend(_textos(v, campos, profundidade + 1, pular))
    vistos: list[str] = []
    for t in achados:
        if t not in vistos:
            vistos.append(t)
    return vistos


def texto_de_empresa(mensagem) -> str:
    """O texto de uma mensagem de empresa: o corpo, o rodapé (a assinatura) e as opções de botão/lista.
    '' quando não é um desses formatos ou não traz texto."""
    blocos = [mensagem.get(k) for k in FORMATOS_DE_EMPRESA if isinstance(mensagem.get(k), dict)]
    if not blocos:
        return ""
    corpo, rodape, opcoes = [], [], []
    for b in blocos:
        corpo += [t for t in _textos(b, CAMPOS_DE_CORPO, pular=CAMPOS_DE_RODAPE + CAMPOS_DE_OPCAO) if t not in corpo]
        rodape += [t for t in _textos(b, CAMPOS_DE_RODAPE) if t not in rodape]
        opcoes += [t for t in _textos(b, CAMPOS_DE_OPCAO) if t not in opcoes]
    partes = ["\n".join(corpo)] if corpo else []
    if rodape:
        partes.append("— " + " · ".join(rodape))
    if opcoes:
        partes.append("[opções: " + " | ".join(opcoes[:10]) + "]")
    return "\n".join(partes).strip()


# Áudio de lead (17/10/2026): um áudio de recusa virava "[áudio]" e o classificador nunca o ouvia. O texto
# passa a levar a duração ("[áudio 27s]", o contrato que a Central lê) e, para áudio de LEAD de até
# MAX_AUDIO_S, a linha do respostas.jsonl leva também `audio: {seg, msg}`: o bastante para o observador pedir
# o arquivo à Evolution (POST /chat/getBase64FromMediaMessage) e transcrever. Este adaptador continua sem rede.
# O `msg` vai inteiro (chave + audioMessage) porque a Evolution roda com DATABASE_SAVE_DATA_NEW_MESSAGE=false:
# ela não guarda a mensagem, então pedir só pelo id não acharia nada.
MAX_AUDIO_S = 120
# O que o download precisa (url/directPath, a chave de mídia e os hashes) e nada além: sem jpegThumbnail,
# waveform, contextInfo nem bytes do arquivo (a Evolution com WEBHOOK_BASE64 poria o áudio no corpo).
CAMPOS_DO_AUDIO = ("url", "directPath", "mimetype", "mediaKey", "fileSha256", "fileEncSha256", "fileLength",
                   "seconds", "ptt", "mediaKeyTimestamp")
# Campos que o Baileys serializa como objeto (Uint8Array -> {"0": n, ...}; Long -> {low, high, unsigned})
# em vez de texto base64/número. Aceitos só pequenos: nada de arquivo inteiro escondido num deles.
CAMPOS_DO_AUDIO_EM_OBJETO = ("mediaKey", "fileSha256", "fileEncSha256", "fileLength", "mediaKeyTimestamp")
MAX_CAMPO_DO_AUDIO = 2000


def segundos_do_audio(audio) -> int | None:
    """A duração declarada do áudio (audioMessage.seconds), ou None quando ausente/absurda."""
    if not isinstance(audio, dict):
        return None
    s = audio.get("seconds")
    if isinstance(s, bool):
        return None
    try:
        n = int(s)
    except (TypeError, ValueError, OverflowError):
        return None
    return n if 0 <= n <= 86400 else None


def marcador_de_audio(seg: int | None) -> str:
    """'[áudio 27s]' (contrato da conversa em disco); sem duração conhecida, o '[áudio]' de sempre."""
    return f"[áudio {seg}s]" if seg is not None else "[áudio]"


def audio_da_mensagem(mensagem, profundidade: int = 0) -> dict | None:
    """O audioMessage, abrindo os embrulhos (mensagem temporária, visualização única). Edição não conta."""
    if not isinstance(mensagem, dict) or profundidade > 3:
        return None
    for embrulho in EMBRULHOS:
        interno = mensagem.get(embrulho)
        if isinstance(interno, dict):
            return None if embrulho == "editedMessage" else audio_da_mensagem(interno.get("message"), profundidade + 1)
    audio = mensagem.get("audioMessage")
    return audio if isinstance(audio, dict) else None


def pedido_do_audio(item: dict, audio: dict) -> dict | None:
    """{key, message: {audioMessage}} só com os campos do download; None quando falta o que baixar."""
    chave = item.get("key") if isinstance(item.get("key"), dict) else {}
    id_msg = chave.get("id") or item.get("id") or item.get("messageId")
    if not isinstance(id_msg, str) or not id_msg:
        return None
    limpo: dict = {}
    for campo in CAMPOS_DO_AUDIO:
        v = audio.get(campo)
        if isinstance(v, (str, int, float, bool)) and not (isinstance(v, str) and len(v) > MAX_CAMPO_DO_AUDIO):
            limpo[campo] = v
        elif isinstance(v, dict) and campo in CAMPOS_DO_AUDIO_EM_OBJETO \
                and len(json.dumps(v)) <= MAX_CAMPO_DO_AUDIO and all(isinstance(x, (int, bool)) for x in v.values()):
            limpo[campo] = v
    if not limpo.get("mediaKey") or not (limpo.get("url") or limpo.get("directPath")):
        return None
    remoto = chave.get("remoteJid") or item.get("remoteJid") or ""
    return {"key": {"id": id_msg, "fromMe": False, "remoteJid": remoto if isinstance(remoto, str) else ""},
            "message": {"audioMessage": limpo}}


def audio_para_transcrever(item: dict) -> dict | None:
    """{seg, msg} de um áudio de lead que cabe no teto de duração; None no resto (sem áudio, longo, sem duração,
    sem o que baixar). Quem decide se transcreve (teto por dia, chave, tamanho) é o observador."""
    audio = audio_da_mensagem(item.get("message"))
    seg = segundos_do_audio(audio)
    if audio is None or seg is None or seg > MAX_AUDIO_S:
        return None
    msg = pedido_do_audio(item, audio)
    return {"seg": seg, "msg": msg} if msg else None


def audio_do_lead(item: dict) -> dict | None:
    """O `audio` da linha do respostas.jsonl para TODO áudio de lead (revisão de 17/10/2026): {seg, msg} quando dá
    para baixar; senão só {seg} (ou {} sem duração), e o observador registra o motivo (longo, sem_dados). A marca diz
    "esta instância recebeu o áudio e responde por ele": o observador da bridge do Hermes (que só tem o "[áudio]")
    não manda lote só de áudio ao n8n, e é esta instância que manda, uma vez, o marcador que não foi transcrito.
    Sem a marca, um áudio longo não chegaria ao n8n por nenhuma das duas."""
    audio = audio_da_mensagem(item.get("message"))
    if audio is None:
        return None
    para_baixar = audio_para_transcrever(item)
    if para_baixar:
        return para_baixar
    seg = segundos_do_audio(audio)
    return {"seg": seg} if seg is not None else {}


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
    de_empresa = texto_de_empresa(mensagem)
    if de_empresa:
        return de_empresa[:MAX_TEXTO]
    if "imageMessage" in mensagem:
        texto = f"[imagem] {_legenda(mensagem['imageMessage'])}"
    elif "videoMessage" in mensagem:
        texto = f"[vídeo] {_legenda(mensagem['videoMessage'])}"
    elif "audioMessage" in mensagem:
        texto = marcador_de_audio(segundos_do_audio(mensagem["audioMessage"]))
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
        try:
            return {3: "entregue", 4: "lido", 5: "lido"}.get(int(valor), "")
        except (ValueError, OverflowError):  # NaN e infinito de um payload malformado
            return ""
    nome = re.sub(r"[^A-Z_]", "", str(valor or "").upper())
    if nome in ("READ", "PLAYED"):
        return "lido"
    if nome in ("DELIVERY_ACK", "DELIVERED"):
        return "entregue"
    return ""


def _nome_seguro(nome) -> str:
    """Nome de campo que pode ir ao journal: o que parece id (tem @, 6 dígitos seguidos ou é longo) vira <chave>."""
    s = str(nome)
    return "<chave>" if "@" in s or re.search(r"\d{6,}", s) or len(s) > 48 else s


def forma(valor, profundidade: int = 0):
    """A estrutura de um JSON sem nenhum valor: só nomes de campo e tipos. Vai ao journal para
    descobrir o formato real de um evento sem registrar conteúdo de conversa."""
    if profundidade > 5:
        return "..."
    if isinstance(valor, dict):
        # Há eventos cujo dict é indexado por JID (presences): o NOME do campo seria um telefone.
        return {_nome_seguro(k): forma(valor[k], profundidade + 1) for k in sorted(valor, key=str)[:40]}
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
    resumos: tuple = ()  # resumo_seguro() de cada item de mensagem, para o journal
    # dicts para o enviadas.jsonl (16/10/2026): o texto que o PRUMO escreveu a um LEAD, para a conversa do
    # lead em disco (observador, WHATSAPP_CONVERSAS_DIR). O evolution.log segue sem texto.
    enviadas: tuple = ()


def traduzir(corpo, leads, agora: float, vistos: Recentes | None = None, instancia: str = "",
             mapas: Mapas | None = None) -> Traducao:
    """Um webhook da Evolution -> o que escrever. PURO: sem arquivo, rede nem relógio.

    `leads` é o conjunto de chaves (DDD + 8 dígitos) de leads, ou None quando a lista não existe:
    sem ela, nada é gravado."""
    linhas: list = []
    respostas: list = []
    enviadas: list = []
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

    resumos: list = []
    for item in itens_de(data):
        resumos.append(resumo_seguro(evento, item))
        jid, motivo, lid = jid_da_conversa(item, mapas)
        if not jid:
            pular(motivo)
            continue
        chave = chave_do_numero(jid.partition("@")[0])
        e_lead = bool(chave and chave in leads)
        chave_msg = item.get("key") if isinstance(item.get("key"), dict) else {}
        de_mim = chave_msg.get("fromMe", item.get("fromMe"))
        if mapas is not None and (e_lead or mapas.todos):
            # Só de lead: o @lid -> telefone, e o id de cada mensagem NOSSA (é o que o recibo de leitura cita).
            mapas.guardar(lid, _id_da_mensagem(item) if evento != "MESSAGES_UPDATE" and de_mim is True else "", jid)
        if not e_lead:
            pular("nao_e_lead")
            continue

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
        identidade = (jid, de_mim, id_msg)
        if id_msg and identidade in vistos:
            pular("reentrega")
            continue
        mensagem = item.get("message")
        texto = texto_da_mensagem(mensagem)
        vazia = sem_conversa(mensagem)
        if de_mim is True:
            if vazia:
                pular("envio_sem_conteudo")
                continue
            ts = hora_do_evento(item.get("messageTimestamp"), agora)
            # O id (16/10/2026) diz ao observador que o texto vem no enviadas.jsonl; não é conteúdo.
            linhas.append({"event": "owner_sent", "chatId": jid, "ts": int(ts), **({"id": str(id_msg)} if id_msg else {})})
            enviadas.append({"chave": chave, "ts": int(ts), "texto": texto, **({"id": str(id_msg)} if id_msg else {})})
        elif de_mim is False:
            if vazia:
                pular("recebida_sem_conteudo")
                continue
            ts = hora_do_evento(item.get("messageTimestamp"), agora)
            if agora - ts <= ATRASO_MAX_S:
                linhas.append({"event": "ignored", "reason": MOTIVO, "chatId": jid, "senderId": jid})
            else:
                # A linha da bridge não leva hora: o observador a leria como "agora". Uma saudação automática que
                # a Evolution entrega horas depois (reconexão) viraria resposta de gente. O texto segue, com a hora certa.
                pular("entrada_atrasada")
            if texto:
                # id (16/10/2026): a conversa do lead em disco deduplica por ele (o mesmo chip chega pela bridge).
                # audio (17/10/2026): o que o observador precisa para baixar e transcrever (ver MAX_AUDIO_S), e a marca
                # de que esta instância responde pelo áudio mesmo quando não dá para baixar (audio_do_lead).
                audio = audio_do_lead(item)
                respostas.append({"chave": chave, "ts": int(ts), "texto": texto, **({"id": str(id_msg)} if id_msg else {}),
                                  **({"audio": audio} if audio is not None else {})})
        else:
            pular("sem_fromMe")
            continue
        # O id só é lembrado quando algo foi produzido: um placeholder sem conteúdo (ainda cifrado) que chega
        # antes da mensagem decifrada, com o mesmo id, não pode engolir a resposta de verdade.
        if id_msg:
            vistos.add(identidade)
    return Traducao(linhas, respostas, ignorados, conexao, tuple(resumos), tuple(enviadas))


# ------------------------------------------------------------------ arquivos

class Gravador:
    """A pasta do PRUMO: lê leads.json (do observador) e escreve evolution.log e respostas.jsonl."""

    def __init__(self, pasta: Path = PASTA, limite_log: int = LIMITE_LOG, relogio=time.time,
                 limite_respostas: int = LIMITE_RESPOSTAS):
        self.pasta = pasta
        self.limite_log = limite_log
        self.limite_respostas = limite_respostas
        self.relogio = relogio
        self.respostas_descartadas = 0
        self.trava = threading.Lock()
        self._leads: set[str] | None = None
        self._leads_mtime: float | None = None
        self.pasta.mkdir(parents=True, exist_ok=True)
        self.pasta.chmod(0o700)
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
        """leads.json relido só quando muda; ausente, ilegível ou VELHO = None (falha fechada).

        Velho = o observador do PRUMO parou de regravar (ele o faz a cada 10 min): sem ele ninguém consome o
        texto, e a lista deixada para trás não pode seguir autorizando a gravação de conversa de gente."""
        arquivo = self.pasta / "leads.json"
        try:
            mtime = arquivo.stat().st_mtime
            if self.relogio() - mtime > LEADS_VELHOS_S:
                self._leads, self._leads_mtime = None, None
                return None
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
                dados = texto.encode('utf-8')
                while dados:
                    n = os.write(fd, dados)
                    if n <= 0: raise OSError('escrita incompleta')
                    dados = dados[n:]
                os.fsync(fd)
        finally:
            os.close(fd)

    def escrever(self, t: Traducao, duravel: bool = False) -> None:
        with self.trava:
            if duravel:
                # Publicação imutável: o consumidor nunca renomeia um arquivo aberto pelo produtor.
                # Separada da bridge Node, que continua dona dos arquivos legados compartilhados.
                if not (t.linhas or t.respostas or t.enviadas): return
                pasta = self.pasta / 'capturas-adaptador'
                pasta.mkdir(mode=0o700, exist_ok=True)
                ids = {i.get('_adaptador_id') for i in (*t.linhas, *t.respostas, *t.enviadas)}
                if len(ids) != 1 or not re.fullmatch(r'[a-f0-9]{64}', str(next(iter(ids)))):
                    raise ValueError('identidade de captura inválida')
                arquivo = pasta / (next(iter(ids)) + '.json')
                if arquivo.exists(): return
                arquivos = list(pasta.glob('*.json'))
                valor = {'ordem': time.time_ns(), 'linhas': t.linhas, 'respostas': t.respostas, 'enviadas': t.enviadas}
                tamanho = len(json.dumps(valor, ensure_ascii=True).encode())
                if len(arquivos) >= PENDENTES_MAX or tamanho > ITEM_MAX or tamanho + sum(p.stat().st_size for p in arquivos) > self.limite_respostas:
                    raise OSError('captura cheia: aguardando consumidor')
                salvar_privado(arquivo, valor)
                return
            if t.linhas:
                caminho = self.pasta / "evolution.log"
                try:
                    if caminho.stat().st_size > self.limite_log:
                        caminho.replace(self.pasta / "evolution.log.1")  # o observador vê o arquivo novo e lê dele
                except OSError:
                    pass
                # ensure_ascii: U+2028, U+2029 e NEL passariam crus pelo json.dumps e o splitlines() do observador
                # quebraria a linha ao meio (o texto do lead se perderia).
                self._anexar(caminho, "".join(json.dumps(l, ensure_ascii=True) + "\n" for l in t.linhas))
            for nome, itens in (("respostas.jsonl", t.respostas), ("enviadas.jsonl", t.enviadas)):
                if not itens:
                    continue
                arquivo = self.pasta / nome
                try:
                    cheio = arquivo.stat().st_size > self.limite_respostas
                except OSError:
                    cheio = False
                if cheio:
                    # Ninguém está consumindo: texto de lead não fica acumulando em disco.
                    self.respostas_descartadas += len(itens)
                    continue
                # O observador troca o nome do arquivo para ler; abrir a cada escrita recria sem perder linha.
                self._anexar(arquivo, "".join(json.dumps(r, ensure_ascii=True) + "\n" for r in itens))


# ------------------------------------------------------------------ aviso

PASTAS_DA_LIB = [Path(__file__).resolve().parent.parent / "lib", HOME / ".local/lib/mel"]


def lib_de_aviso():
    """O módulo da lib (a mesma do observador), ou None quando nenhuma cópia existe ou carrega."""
    for pasta in PASTAS_DA_LIB:
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", pasta / "aviso.py")
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception:  # noqa: BLE001 — ausente ou quebrada: tenta a próxima
            continue
    return None


def avisar(texto: str) -> None:
    """Aviso na fila do dell-status (sai pelo Telegram, WhatsApp de reserva). Nunca derruba o adaptador."""
    aviso = {"titulo": "📱 Número do PRUMO no WhatsApp", "texto": texto, "origem": "evolution-adaptador"}
    lib = lib_de_aviso()
    if lib is None:  # sem a lib não há validação: não grava na fila, só registra e segue
        print(f"lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: {aviso['titulo']}", file=sys.stderr, flush=True)
        return
    r = lib.gravar(aviso, fila=FILA_DE_AVISOS, prefixo="evolution")
    if not r.gravado:
        log("aviso não gravado:", r.estado, r.motivo)


TEXTO_DESCONECTOU = ("O número do PRUMO no WhatsApp desconectou da Evolution API: as respostas dos leads deste número "
                     "deixaram de marcar a planilha. Reconecte lendo o QR de novo no painel da Evolution.")


# ------------------------------------------------------------------ o serviço

class Adaptador:
    """Junta tradução, arquivos e contadores. `relogio` e `avisar` entram de fora nos testes."""

    def __init__(self, gravador: Gravador, relogio=time.time, avisar: Callable[[str], None] = avisar,
                 instancia: str = INSTANCIA, sessao_hermes: Path | None = None,
                 pasta_identidades: Path = PASTA_IDENTIDADES):
        self.gravador, self.relogio, self.avisar, self.instancia = gravador, relogio, avisar, instancia
        self.pasta_identidades = pasta_identidades
        self.vistos = Recentes()
        self.mapas = Mapas(todos=os.environ.get("EVOLUTION_ENSAIO") == "1", arquivo=gravador.pasta / 'lid-telefone.json', sessao_hermes=sessao_hermes)
        self.spool = gravador.pasta / 'entrada-pendente.json'
        self.formas: dict[str, int] = {}
        self.resumos_logados = 0
        self.contadores: dict = {"eventos": {}, "linhas": 0, "respostas": 0, "ignorados": {}, "recibos": {}}
        self.ultimo_evento: float | None = None
        self.desconectado_avisado = False
        # Cada pedido roda numa thread; Recentes, Mapas e os contadores não são seguros para duas ao mesmo tempo.
        self.trava = threading.Lock()
        self.rejeitados: dict[str, int] = {}
        self._rejeicao_logada = 0.0
        self.erro_entrada = None

    def rejeitar(self, codigo: int) -> None:
        """Conta um pedido recusado (401, 400, 413). Um segredo trocado só de um lado zera o pipeline sem
        nenhum outro sinal, então o contador vai ao /saude e uma linha ao journal, no máximo uma por minuto."""
        with self.trava:
            self.rejeitados[str(codigo)] = self.rejeitados.get(str(codigo), 0) + 1
            agora = self.relogio()
            if agora - self._rejeicao_logada >= 60:
                self._rejeicao_logada = agora
                log(f"pedido recusado ({codigo}); total por código: {self.rejeitados}")

    def receber(self, corpo, *, autenticado: bool = False) -> Traducao:
        with self.trava:
            with trava_privada(self.gravador.pasta / '.entrada-trava'):
                try:
                    t = self._receber(corpo, autenticado=autenticado); self.erro_entrada = None
                    return t
                except Exception:
                    self.erro_entrada = 'persistencia_indisponivel'
                    raise

    def _estado(self):
        if not self.spool.exists(): return {'versao': 1, 'pendentes': {}, 'concluidos': []}
        s = json.loads(self.spool.read_text(encoding='utf-8'))
        if not isinstance(s, dict) or s.get('versao') != 1 or not isinstance(s.get('pendentes'), dict) or not isinstance(s.get('concluidos'), list):
            raise ValueError('spool inválido')
        return s

    def _salvar(self, estado):
        if len(json.dumps(estado, ensure_ascii=True).encode()) > SPOOL_MAX:
            raise OSError('spool cheio: reentrega necessária')
        salvar_privado(self.spool, estado)

    def _minimo(self, evento, item, instancia, agora):
        if not isinstance(instancia, str) or len(instancia) > 100 or re.search(r'[\x00-\x1f]', instancia): return None
        key = item.get('key') if isinstance(item.get('key'), dict) else {}
        jid = key.get('remoteJid') or item.get('remoteJid')
        if not isinstance(jid, str) or (not jid_de_telefone(jid) and not _usuario_lid(jid)): return None
        de_mim = key.get('fromMe', item.get('fromMe'))
        if not isinstance(de_mim, bool): return None
        status = estado_do_recibo(item.get('status', key.get('status')))
        if evento == 'MESSAGES_UPDATE':
            if status != 'lido' or not de_mim: return None
        elif sem_conversa(item.get('message')): return None
        id_msg = _id_da_mensagem(item)
        if id_msg and not id_valido(id_msg): raise ValueError('id de mensagem inválido')
        limpo = {'key': {'remoteJid': jid, 'fromMe': de_mim, 'id': id_msg},
                 'messageTimestamp': hora_do_evento(item.get('messageTimestamp'), agora)}
        for campo in ('remoteJidAlt', 'senderPn', 'participantAlt'):
            valor = key.get(campo) or item.get(campo)
            if jid_de_telefone(valor) or _usuario_lid(valor): limpo['key'][campo] = valor
        if evento == 'MESSAGES_UPDATE': limpo['status'] = 'READ'
        else:
            limpo['message'] = {'conversation': texto_da_mensagem(item.get('message'))}
            audio = audio_do_lead(item) if not de_mim else None
            if audio is not None: limpo['_audio'] = audio
        # IDs separam direção/recibo; UPSERT e SEND_MESSAGE da mesma saída são uma só captura.
        identidade = [instancia, 'lido' if evento == 'MESSAGES_UPDATE' else 'saida' if de_mim else 'entrada',
                      id_msg or hashlib.sha256(json.dumps(limpo, sort_keys=True).encode()).hexdigest()]
        chave = hashlib.sha256(json.dumps(identidade).encode()).hexdigest()
        return chave, {'event': evento, 'instance': instancia, 'data': limpo}

    def _capturar(self, corpo, agora, contexto_identidade=None):
        evento = normalizar_evento(corpo.get('event')) if isinstance(corpo, dict) else ''
        if evento not in ('MESSAGES_UPSERT','MESSAGES_UPDATE','SEND_MESSAGE') or (self.instancia and corpo.get('instance') != self.instancia):
            t = traduzir(corpo, self.gravador.leads(), agora, self.vistos, self.instancia, self.mapas)
            if contexto_identidade is not None:
                identidade_captura().registrar_provas(contexto_identidade, t, pasta=self.pasta_identidades)
            return t
        estado = self._estado(); self.mapas.carregar()
        leads = self.gravador.leads()
        ignorados = {}
        itens = list(itens_de(corpo.get('data')))
        minimos = [(item, self._minimo(evento, item, corpo.get('instance', ''), agora)) for item in itens]
        # Duas versões contraditórias no mesmo webhook não elegem uma prova.
        versoes, ambiguos = {}, set()
        for _, minimo in minimos:
            if minimo is None: continue
            _, compacto = minimo
            key = compacto['data']['key']; ident = (key.get('id'), key.get('fromMe'))
            valor = json.dumps(compacto, ensure_ascii=True, sort_keys=True)
            if ident in versoes and versoes[ident] != valor: ambiguos.add(ident)
            versoes[ident] = valor
        for item, minimo in minimos:
            if minimo is None:
                t = traduzir({**corpo, 'data': item}, leads, agora, Recentes(), self.instancia, self.mapas)
                if t.linhas or t.respostas or t.enviadas:
                    raise ValueError('evento útil sem representação durável')
                for motivo, n in t.ignorados.items(): ignorados[motivo] = ignorados.get(motivo, 0) + n
                continue
            chave, compacto = minimo
            jid, _, lid = jid_da_conversa(compacto['data'], self.mapas)
            if contexto_identidade is not None:
                key = compacto['data']['key']
                contexto_item = dict(contexto_identidade)
                contexto_item['horarioOriginalValido'] = identidade_captura().timestamp_original_valido(item.get('messageTimestamp'), contexto_item['capturadoEm'])
                contexto_item['ambigua'] = (key.get('id'), key.get('fromMe')) in ambiguos
                contexto_item.update(idOriginal=key.get('id'), direcao='saida' if key['fromMe'] else 'entrada',
                    ocorridoEm=identidade_captura().iso_utc(compacto['data']['messageTimestamp']),
                    conversaBR10=identidade_captura().chave_br10_do_evento(item))
                compacto['_identidade_captura'] = contexto_item
            if leads is not None and jid and chave_do_numero(jid.split('@')[0]) not in leads:
                ignorados['nao_e_lead'] = ignorados.get('nao_e_lead', 0) + 1
                if chave in estado['pendentes']:
                    del estado['pendentes'][chave]
                    estado['concluidos'] = (estado['concluidos'] + [chave])[-20000:]
                # O PN novo confirma que este LID pendente é de quem não está na fonte fresca.
                if lid:
                    for antiga, r in list(estado['pendentes'].items()):
                        if _usuario_lid(r['corpo']['data']['key'].get('remoteJid')) == lid:
                            del estado['pendentes'][antiga]
                            estado['concluidos'] = (estado['concluidos'] + [antiga])[-20000:]
                continue
            if chave in estado['concluidos'] or chave in estado['pendentes']:
                if contexto_identidade is not None:
                    # Dedupe do raw não apaga evidência de uma conta diferente.
                    # Deriva novamente as rows do MESMO gerador, sem escrever raw.
                    prova_t = traduzir(compacto, leads, agora, Recentes(), self.instancia, self.mapas)
                    if prova_t.respostas or prova_t.enviadas:
                        identidade_captura().registrar_provas(compacto['_identidade_captura'], prova_t, pasta=self.pasta_identidades)
                if chave in estado['pendentes']:
                    if contexto_identidade is not None:
                        registro_antigo = estado['pendentes'][chave]['corpo']
                        contextos = registro_antigo.setdefault('_identidades_captura', [registro_antigo['_identidade_captura']] if '_identidade_captura' in registro_antigo else [])
                        novo_contexto = compacto['_identidade_captura']
                        vinculos = ('contaHash', 'estado', 'horarioOriginalValido', 'ambigua', 'conversaBR10', 'idOriginal', 'direcao', 'ocorridoEm')
                        if not any(all(c.get(k) == novo_contexto.get(k) for k in vinculos) for c in contextos):
                            if len(contextos) >= 8: raise OSError('limite de identidades da captura')
                            contextos.append(novo_contexto)
                    antiga = estado['pendentes'][chave]['corpo']['data']['key']
                    for campo in ('remoteJidAlt','senderPn','participantAlt'):
                        if campo in compacto['data']['key']: antiga[campo] = compacto['data']['key'][campo]
                    if jid_de_telefone(compacto['data']['key']['remoteJid']) and not jid_de_telefone(antiga['remoteJid']):
                        antiga['remoteJidAlt'] = compacto['data']['key']['remoteJid']
                ignorados['reentrega'] = ignorados.get('reentrega', 0) + 1
                continue
            if len(estado['pendentes']) >= PENDENTES_MAX or len(json.dumps(compacto, ensure_ascii=True).encode()) > ITEM_MAX:
                raise OSError('limite de entrada pendente')
            estado['pendentes'][chave] = {'recebido': agora, 'corpo': compacto}
        # O ACK nunca precede a posse durável do evento mínimo; não guarda pushName, apikey ou corpo bruto.
        self._salvar(estado)
        t = self._drenar(estado, agora, ignorados)
        return t._replace(resumos=tuple(resumo_seguro(evento, i) for i in itens_de(corpo.get('data'))))

    def _drenar(self, estado, agora, ignorados=None):
        leads = self.gravador.leads()
        linhas, respostas, enviadas = [], [], []
        ignorados = dict(ignorados or {})
        if leads is None:
            return Traducao([], [], {**ignorados, 'aguardando_lista': len(estado['pendentes'])}, '')
        # Primeiro aprende hints de TODA a rodada. Um LID antigo não bloqueia seu hint posterior;
        # a entrega depois respeita a hora original, não a hora da correlação.
        for registro in estado['pendentes'].values():
            corpo = registro['corpo']; item = corpo['data']
            if self.instancia and corpo.get('instance') != self.instancia: continue
            jid, _, lid = jid_da_conversa(item, self.mapas)
            if jid and chave_do_numero(jid.split('@')[0]) in leads:
                self.mapas.guardar(lid, _id_da_mensagem(item) if item['key']['fromMe'] else '', jid)
        ordem = sorted(estado['pendentes'].items(), key=lambda p: (p[1]['corpo']['data']['messageTimestamp'], p[1]['recebido']))
        entregues = 0
        for chave, registro in ordem:
            if entregues >= DRENAR_MAX: break
            corpo = registro['corpo']; item = corpo['data']
            if self.instancia and corpo.get('instance') != self.instancia: continue
            jid, _, _ = jid_da_conversa(item, self.mapas)
            if not jid:
                continue  # Sem correlação confirmada, mantém mínimo privado; cheio aplica backpressure.
            else:
                t = traduzir(corpo, leads, agora, Recentes(), self.instancia, self.mapas)
            t = t._replace(linhas=[{**i, '_adaptador_id': chave, **({'ts': item['messageTimestamp']} if i.get('event') == 'ignored' else {})} for i in t.linhas],
                           respostas=[{**i, '_adaptador_id': chave, **({'audio': item['_audio']} if '_audio' in item else {})} for i in t.respostas],
                           enviadas=tuple({**i, '_adaptador_id': chave} for i in t.enviadas))
            # O spool só é consumido depois da prova derivada das MESMAS rows do gerador.
            # O contexto guardado pertence à captura autenticada, nunca à identidade atual.
            for contexto in corpo.get('_identidades_captura', [corpo['_identidade_captura']] if '_identidade_captura' in corpo else []):
                contagens = identidade_captura().registrar_provas(contexto, t, pasta=self.pasta_identidades)
                if contagens:
                    log('identidade de captura:', json.dumps(contagens, sort_keys=True))
            self.gravador.escrever(t, duravel=True)
            del estado['pendentes'][chave]
            estado['concluidos'] = (estado['concluidos'] + [chave])[-20000:]
            self._salvar(estado)
            entregues += 1
            linhas.extend(t.linhas); respostas.extend(t.respostas); enviadas.extend(t.enviadas)
            for motivo, n in t.ignorados.items(): ignorados[motivo] = ignorados.get(motivo, 0) + n
        return Traducao(linhas, respostas, ignorados, '', (), tuple(enviadas))

    def drenar(self):
        with self.trava:
            with trava_privada(self.gravador.pasta / '.entrada-trava'):
                try:
                    self.mapas.carregar()
                    t = self._drenar(self._estado(), self.relogio()); self.erro_entrada = None
                    self.contadores['linhas'] += len(t.linhas); self.contadores['respostas'] += len(t.respostas)
                    for motivo, n in t.ignorados.items(): self.contadores['ignorados'][motivo] = self.contadores['ignorados'].get(motivo, 0) + n
                    return t
                except Exception:
                    self.erro_entrada = 'persistencia_indisponivel'
                    raise

    def _receber(self, corpo, *, autenticado: bool = False) -> Traducao:
        agora = self.relogio()
        evento = normalizar_evento(corpo.get("event")) if isinstance(corpo, dict) else "?"
        self.contadores["eventos"][evento] = self.contadores["eventos"].get(evento, 0) + 1
        self.ultimo_evento = agora
        self._registrar_forma(corpo, evento)
        contexto_identidade = None
        if evento in ('MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE') and (self.pasta_identidades / 'config.json').exists():
            lib_identidade = identidade_captura()
            contexto_identidade = lib_identidade.contexto_captura(corpo, lib_identidade.iso_captura(agora), lib_identidade.carregar_config(self.pasta_identidades), autenticado=autenticado)
        t = self._capturar(corpo, agora, contexto_identidade)
        for resumo in t.resumos:
            # Os primeiros ficam no journal (ensaio do formato real); depois só o contador de recibos.
            if self.resumos_logados < RESUMOS_MAX:
                self.resumos_logados += 1
                log("evento:", resumo)
            m = re.search(r" status=([A-Z0-9_]+) ", resumo)
            if resumo.startswith("MESSAGES_UPDATE") and m:
                self.contadores["recibos"][m.group(1)] = self.contadores["recibos"].get(m.group(1), 0) + 1
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
        with self.trava:
            try:
                pendentes = list(self._estado()['pendentes'].values())
                espera = {'pendentes': len(pendentes), 'idade_pendente_s': max((int(self.relogio() - p['recebido']) for p in pendentes), default=0)}
            except Exception:
                espera = {'pendentes': None, 'erro_entrada': 'estado_indisponivel'}
            return {"ok": True, "instancia": self.instancia or None, "ultimo_evento": self.ultimo_evento,
                    "desconectado": self.desconectado_avisado, "lista_de_leads": self.gravador.leads() is not None,
                    "rejeitados": dict(self.rejeitados), "respostas_descartadas": self.gravador.respostas_descartadas,
                    **self.contadores, 'erro_entrada': self.erro_entrada, **espera}


def fazer_handler(adaptador: Adaptador, segredo: str):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        # Cabeçalho ou corpo que não termina de chegar não pode prender a thread para sempre.
        timeout = TEMPO_DA_CONEXAO_S

        def log_message(self, *a):  # o journal já tem o que importa; nada de caminho nem IP
            pass

        def _responder(self, codigo: int, corpo: dict) -> None:
            if codigo in (400, 401, 413):
                adaptador.rejeitar(codigo)
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

        def _descartar_corpo(self) -> None:
            """Esvazia um corpo pequeno sem olhar o conteúdo, para o fechamento da conexão não virar um
            reset TCP que o cliente lê como erro em vez de 401/404. Corpo grande não é lido."""
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return
            if 0 < n <= 65536:
                try:
                    self.rfile.read(n)
                except OSError:  # tempo esgotado: o cliente prometeu um corpo e não mandou
                    self.close_connection = True

        def do_POST(self):
            # O segredo vem antes de tratar o corpo (um corpo pequeno só é descartado).
            if not self._autorizado():
                self._descartar_corpo()
                return self._responder(401, {"erro": "segredo"})
            if not self.path.split("?")[0].startswith("/evolution"):
                self._descartar_corpo()
                return self._responder(404, {"erro": "rota"})
            try:
                tamanho = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return self._responder(400, {"erro": "tamanho"})
            if tamanho < 0:
                # rfile.read(-1) leria até o cliente fechar: prenderia a thread.
                self.close_connection = True
                return self._responder(400, {"erro": "tamanho"})
            if tamanho > LIMITE_CORPO:
                self.close_connection = True
                return self._responder(413, {"erro": "grande"})
            try:
                corpo = json.loads(self.rfile.read(tamanho) or b"null")
            except (ValueError, OSError):
                self.close_connection = True
                return self._responder(400, {"erro": "json"})
            try:
                t = adaptador.receber(corpo, autenticado=True)
            except Exception as e:  # Sem confirmação de persistência/entrega: o remetente deve reentregar.
                log("erro ao tratar o webhook:", type(e).__name__)
                return self._responder(503, {"ok": False, "erro": "persistencia_indisponivel"})
            self._responder(200, {"ok": True, "linhas": len(t.linhas), "respostas": len(t.respostas)})

    return Handler


class ServidorLimitado(ThreadingHTTPServer):
    """ThreadingHTTPServer com teto de conexões simultâneas: passou do teto, a conexão é fechada na hora.
    Sem isso, um cliente da rede do compose abriria threads até o MemoryMax matar o serviço."""
    daemon_threads = True

    def __init__(self, *args, maximo: int = MAX_CONEXOES, **kwargs):
        self._vagas = threading.BoundedSemaphore(maximo)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self._vagas.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._vagas.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._vagas.release()

    def handle_error(self, request, client_address):
        # O padrão imprime o traceback inteiro de cada conexão cortada (reset, tempo esgotado): uma linha basta.
        log("conexão encerrada com erro:", type(sys.exc_info()[1]).__name__)


def criar_servidor(adaptador: Adaptador, segredo: str, porta: int = PORTA, endereco: str = ENDERECO,
                   maximo: int = MAX_CONEXOES) -> ThreadingHTTPServer:
    return ServidorLimitado((endereco, porta), fazer_handler(adaptador, segredo), maximo=maximo)


def main() -> int:
    try:
        segredo = ARQUIVO_SEGREDO.read_text().strip()
    except OSError:
        segredo = ""
    if not segredo:
        print(f"Sem segredo em {ARQUIVO_SEGREDO}: crie com `openssl rand -hex 24 > {ARQUIVO_SEGREDO}; chmod 600 ...`.",
              file=sys.stderr)
        return 2
    adaptador = Adaptador(Gravador(), sessao_hermes=Path.home() / '.hermes/whatsapp/session')
    servidor = criar_servidor(adaptador, segredo)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=servidor.shutdown, daemon=True).start())
    log(f"ouvindo {ENDERECO}:{PORTA}; pasta {PASTA}" + (f"; instância {INSTANCIA}" if INSTANCIA else ""))
    parar = threading.Event()
    def drenar():
        while not parar.wait(5):
            try: adaptador.drenar()
            except Exception as e: log('entrada pendente preservada:', type(e).__name__)
    thread = threading.Thread(target=drenar, daemon=True); thread.start()
    try:
        servidor.serve_forever()
    finally:
        parar.set(); thread.join(timeout=6)
        servidor.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
