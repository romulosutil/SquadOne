#!/usr/bin/env python3
"""Conversa com lead no WhatsApp marca a planilha sozinha (Dell).

O Rômulo aborda os leads direto no WhatsApp e não tem tempo de voltar à
planilha. O Hermes já está vinculado ao número dele (modo self-chat) e a bridge
escreve no `~/.hermes/whatsapp/bridge.log`, sem conteúdo:

- para TODA mensagem recebida de outra pessoa, uma linha
  `{"event":"ignored","reason":"self_chat_mode_rejects_non_self","chatId":...}`
  (é da própria bridge);
- desde 30/09/2026, com o remendo `deploy/hermes/scripts/patch_bridge_envios.py`:
  `{"event":"owner_sent","chatId","ts"}` quando o Rômulo escreve a alguém numa
  conversa 1:1, e `{"event":"owner_receipt","chatId","status":"entregue"|"lido","ts"}`
  quando a mensagem dele chega ou é lida.

Este leitor acompanha o log e, quando o número é das planilhas, avisa o n8n
(`claude-ops/whatsapp-conversa.py`) com a direção: "entrada" (o lead escreveu),
"saida" (o Rômulo escreveu) ou "lido" (o lead leu). "entregue" fica só no log.
O n8n responde o que vai marcar; abordagem nova ("abordou"/"retomou") vira um
aviso pelo Hermes, juntando o que acontecer em 5 min: "Registrado: você abordou
<Nome> (Site antes da venda) às HH:MM". Mensagem a quem já estava "enviado"
(conversa normal) e leitura não avisam.

Por que ler o log e não parear outro aparelho: um segundo dispositivo exigia
pareamento (e falhou). Ler um log não depende disso; o remendo da bridge some
com `hermes update` às vezes, e este leitor avisa quando ele falta no bridge.js.

Saudação automática (29/09/2026): WhatsApp Business responde sozinho segundos
depois do envio, e isso não é resposta de gente. O n8n só conta como resposta
(respondeu_em) mensagem a 5 min ou mais do envio. Para isso, quando o lead volta
a escrever 5 min ou mais depois do primeiro aviso, sai um segundo aviso
("seguinte": true); depois, silêncio até fechar a janela de 6 h. Escritas do
Rômulo: um aviso por lead a cada 30 min; leituras: um a cada 6 h.

Reinício (29/09/2026): a posição no log fica em ~/.local/state/whatsapp-observador
(inode, byte e a hora em que foi gravada, nenhum número), e o leitor continua de
onde parou; e só começa a ler depois de conseguir a lista de números do n8n.
O que foi escrito enquanto ele estava parado é "atrasado": envio e leitura têm
a hora na linha; mensagem recebida não tem, então ganha a última hora conhecida
do log (ou a da posição gravada). Assim uma saudação relida horas depois não
vira resposta; no pior caso, uma resposta de verdade fica para o follow-up.

n8n com erro (30/09/2026): o evento não se perde. Fica numa fila em memória, na
ordem, e o leitor tenta de novo depois de 1 min, 4, 16 e então de hora em hora
(cada tentativa que falha dentro do n8n vira aviso de falha pelo Hermes; n8n
fora do ar, conexão recusada, tenta a cada 30 s sem aviso). A posição gravada
nunca passa do primeiro evento da fila: se o serviço reinicia, relê dali.

Texto das respostas (05/10/2026): o CRM precisa separar resposta negativa, robô
(saudação automática, menu do WhatsApp Business) e interesse, e isso só se sabe
lendo. O remendo `squadone:respostas` da bridge grava o texto do que um lead
escreveu em respostas.jsonl, e só para número que está em `leads.json` — a
lista que este leitor grava, na mesma pasta, a cada leitura dos números do n8n.
Este leitor junta as mensagens de cada lead até ficar ESPERA_DA_CONVERSA_S sem
mensagem nova (quem escreve "Oi" e depois "não temos interesse" vira um envio
só) e manda ao n8n (POST /webhook/whatsapp-resposta), que classifica com o
Gemini e marca a planilha (`claude-ops/whatsapp-conversa.py`). O n8n devolve o
aviso que vai ao Rômulo pelo Hermes ("<Nome> respondeu: ..."). O arquivo é
apagado assim que lido; o texto fica só na memória até o n8n confirmar. Custo
aceito: reiniciar o serviço com uma conversa ainda juntando perde a
classificação dela (o SIGTERM tenta mandar antes de sair), e a marcação de
"respondeu" pelo log continua valendo.

Privacidade: o bridge.log não tem conteúdo; texto só de quem é lead, e só até
o n8n receber. Só o número de quem é lead sai daqui (DDD + 8 últimos dígitos).
Grupos, canais, listas de transmissão e status são ignorados. O log do serviço
mostra só DDD + 2 últimos dígitos, nunca o texto.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path

HOME = Path.home()
LOG_DA_BRIDGE = Path(os.environ.get("OBSERVADOR_LOG", HOME / ".hermes/whatsapp/bridge.log"))
SESSAO_HERMES = Path(os.environ.get("OBSERVADOR_SESSAO", HOME / ".hermes/whatsapp/session"))
BRIDGE_JS = Path(os.environ.get("OBSERVADOR_BRIDGE", HOME / ".hermes/hermes-agent/scripts/whatsapp-bridge/bridge.js"))
N8N = os.environ.get("OBSERVADOR_N8N", "http://127.0.0.1:5679/webhook")
ARQUIVO_SEGREDO = HOME / ".config/claude-ops/whatsapp-observador-segredo"
FILA_DE_AVISOS = HOME / ".local/share/avisos/fila"
POSICAO = Path(os.environ.get("OBSERVADOR_POSICAO", HOME / ".local/state/whatsapp-observador/posicao.json"))

RELER_NUMEROS_S = 10 * 60
# Uma conversa de 30 mensagens não vira 30 leituras da planilha.
JANELA_DEDUPE_S = 6 * 3600
# A saudação automática chega em segundos; escrever de novo depois disto é gente (ver n8n).
JANELA_SAUDACAO_S = 5 * 60
JANELA_ENVIO_S = 30 * 60
JANELA_LIDO_S = 6 * 3600
# Abordagens que chegam juntas viram um aviso só.
LOTE_AVISO_S = 5 * 60
GRAVAR_POSICAO_S = 10
# Log parado por mais que isto com o Hermes no ar = algo mudou na bridge.
SILENCIO_SUSPEITO_S = 6 * 3600
# n8n fora do ar: tenta logo. Fluxo que roda e falha vira aviso a cada tentativa: espera cada vez mais.
RETENTAR_CONEXAO_S = 30
ESPERAS_FALHA_S = (60, 240, 960, 3600)
MAX_PENDENTES = 500
# Sem mensagem nova do lead por este tempo, a conversa vai ao n8n para classificar.
# 08/10/2026: era 90 s; medido, o aviso de um "sim" levava ~2 min 20 s do primeiro "Sim" ao WhatsApp,
# 90 s deles só de espera. A saudação do WhatsApp Business e o "sim" de gente chegam em rajada de
# poucos segundos; 45 s ainda junta as duas e a pessoa que escreve devagar vira, no máximo, dois avisos.
ESPERA_DA_CONVERSA_S = 45
# O dell-status só esvazia a fila de avisos a cada minuto; quem grava um aviso o manda esvaziar logo
# (a fila ignora arquivo com menos de FRESCOR_S = 5 s, por isso a espera).
DELL_STATUS = HOME / ".local/bin/dell-status"
ESPERA_ANTES_DE_DRENAR_S = 6
MAX_MENSAGENS_POR_CONVERSA = 20
MOTIVO = "self_chat_mode_rejects_non_self"
MARCAS_DO_REMENDO = ("squadone:envios", "squadone:recibos", "squadone:respostas")
ROTULO = {"site": "Site antes da venda", "prumo": "PRUMO"}
FEITO = {"entrada": "respondeu", "saida": "recebeu mensagem sua", "lido": "leu"}
COMANDO_REMENDO = "python3 ~/SquadOne/deploy/hermes/scripts/patch_bridge_envios.py --reiniciar"


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


def iso(instante: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(instante))


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
        headers={"X-Observador": ARQUIVO_SEGREDO.read_text().strip(), "Content-Type": "application/json"},
        data=json.dumps(corpo).encode() if corpo is not None else None,
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def espera_da_falha(erro: Exception, seguidas: int) -> int:
    """Erro HTTP = o fluxo rodou e falhou (e já avisou): espera crescente. Sem conexão: logo."""
    if isinstance(erro, urllib.error.HTTPError):
        return ESPERAS_FALHA_S[min(seguidas, len(ESPERAS_FALHA_S)) - 1]
    return RETENTAR_CONEXAO_S


# A lib de aviso (deploy/dell/lib/aviso.py, 11/10/2026): no repo, em lib/ no nível
# acima desta pasta; no Dell, instalada em ~/.local/lib/mel/ (instalados.json). Primeiro
# a do repo, para o teste nunca pegar uma cópia instalada. Carregada a cada aviso (são
# raros): uma cópia nova ou quebrada vale na hora, sem reiniciar o serviço.
PASTAS_DA_LIB = [Path(__file__).resolve().parent.parent / "lib", HOME / ".local/lib/mel"]


def lib_de_aviso():
    """O módulo da lib, ou None quando nenhuma cópia existe ou carrega: aí o
    avisar_pelo_hermes() volta ao jeito antigo e o aviso sai do mesmo modo que antes."""
    for pasta in PASTAS_DA_LIB:
        arquivo = pasta / "aviso.py"
        if not arquivo.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", arquivo)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception:  # noqa: BLE001 — cópia quebrada não derruba o serviço: tenta a próxima
            continue
    return None


def avisar_pelo_hermes(texto: str) -> None:
    aviso = {"titulo": "📱 Observador do WhatsApp", "texto": texto, "origem": "whatsapp-observador"}
    lib = lib_de_aviso()
    if lib is not None:
        # O texto traz trecho do que o lead escreveu (e nome de empresa): "R$" aí é
        # comum ("quanto custa? R$ 50 ?") e a lib recusaria o aviso inteiro, perdendo
        # a resposta do lead. Melhor mandar sem o valor (RULES 24) do que não mandar.
        if lib.VALOR_EM_REAIS.search(texto):
            aviso["texto"] = lib.sem_valores(texto)
        r = lib.gravar(aviso, fila=FILA_DE_AVISOS, prefixo="observador")
        if not r.gravado:
            log("aviso não gravado:", r.estado, r.motivo)
            return
        entregar_ja()
        return
    # Sem a lib instalada: o jeito de antes, sem mudar nada.
    try:
        FILA_DE_AVISOS.mkdir(parents=True, exist_ok=True)
        (FILA_DE_AVISOS / f"observador-{time.time_ns()}.json").write_text(json.dumps(aviso, ensure_ascii=False), encoding="utf-8")
    except OSError as e:
        log("aviso não gravado:", e)
        return
    entregar_ja()


def entregar_ja() -> None:
    """Pede ao dell-status para esvaziar a fila já, em vez de esperar o próximo minuto (até 60 s).

    Só adianta: o timer de 1 min continua esvaziando a fila, então falha aqui não perde aviso. A
    drenagem tem flock (outra em andamento sai sem enviar), o silêncio das 22h às 7h, o teto por
    hora e a chave de 24 h valem igual, e o subshell solta o processo para o laço não esperar.
    """
    if not DELL_STATUS.exists():
        return
    try:
        subprocess.run(
            ["/bin/sh", "-c", f'(sleep {ESPERA_ANTES_DE_DRENAR_S}; "$0" --drenar) >/dev/null 2>&1 &', str(DELL_STATUS)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, check=False)
    except (OSError, subprocess.SubprocessError) as e:
        log("não consegui pedir a entrega imediata (o timer entrega no próximo minuto):", e)


def posicao_salva() -> tuple[int, int, float] | None:
    try:
        d = json.loads(POSICAO.read_text())
        # Arquivo de antes de 30/09 não tem salvo_em: vale a hora em que foi gravado.
        return int(d["inode"]), int(d["posicao"]), float(d.get("salvo_em") or POSICAO.stat().st_mtime)
    except (OSError, ValueError, KeyError, TypeError):
        return None


def salvar_posicao(inode: int, posicao: int) -> None:
    try:
        POSICAO.parent.mkdir(parents=True, exist_ok=True)
        tmp = POSICAO.with_suffix(".tmp")
        tmp.write_text(json.dumps({"inode": inode, "posicao": posicao, "salvo_em": int(time.time())}))
        tmp.replace(POSICAO)
    except OSError as e:
        log("posição não gravada:", e)


def seguir(caminho: Path, onde: dict):
    """tail -F: continua da posição salva se o arquivo é o mesmo; senão começa no FIM
    (o passado não marca nada). Aguenta arquivo truncado ou recriado. `onde` recebe
    inode e byte do começo da linha entregue (o fim, depois de tratada) e, ao
    continuar, até que byte o log é "atrasado" e desde quando."""
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
                    onde.update(atraso_ate=tamanho, salvo_em=salvo[2])
                    log(f"continuando do byte {salvo[1]} ({tamanho - salvo[1]} bytes novos)")
                else:
                    arq.seek(0, os.SEEK_END)
                    onde.update(atraso_ate=0, salvo_em=None)
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
                onde.update(inode=inode, posicao=0, atraso_ate=0)
                continue
        except OSError:
            pass
        yield None  # nada novo: dá a vez ao laço principal
        time.sleep(1)


def ler_numeros(chamar=http) -> set[str]:
    chaves = set(filter(None, chamar("GET", "whatsapp-telefones").get("chaves", [])))
    log(f"{len(chaves)} número(s) de lead no filtro")
    return chaves


def texto_do_lote(lote: list[dict]) -> str:
    def item(a):
        rotulo = ROTULO.get(a["planilha"], a["planilha"])
        if a["acao"] == "retomou":
            return f"{a['nome']} ({rotulo}; retomou a conversa, estava {a['antes']}) às {a['hora']}"
        return f"{a['nome']} ({rotulo}) às {a['hora']}"
    if len(lote) == 1:
        a = lote[0]
        if a["acao"] == "retomou":
            rotulo = ROTULO.get(a["planilha"], a["planilha"])
            return f"Registrado: você retomou a conversa com {a['nome']} ({rotulo}, estava {a['antes']}) às {a['hora']}."
        return f"Registrado: você abordou {item(a)}."
    return f"Registrado: você abordou {len(lote)} leads:\n" + "\n".join(f"• {item(a)}" for a in lote)


class Observador:
    """O que o leitor lembra entre linhas. `chamar`, `avisar` e `relogio` entram de fora nos testes."""

    def __init__(self, chaves: set[str], chamar=http, avisar=avisar_pelo_hermes, relogio=time.time,
                 telefone=telefone_do_chat, bridge_js: Path = BRIDGE_JS, pasta: Path | None = None):
        agora = relogio()
        self.chaves = chaves
        # leads.json (para a bridge) e respostas.jsonl (da bridge) moram junto da posição.
        self.pasta = pasta or POSICAO.parent
        # chave -> {"mensagens": [{"em", "texto"}], "ultima": instante}: juntando até a conversa parar.
        self.conversas: dict[str, dict] = {}
        # Conversas prontas que o n8n ainda não recebeu, na ordem.
        self.conversas_prontas: deque = deque()
        self.falhas_conversa = 0
        self.conversa_tentar_em = 0.0
        self.chamar, self.avisar, self.relogio, self.telefone, self.bridge_js = chamar, avisar, relogio, telefone, bridge_js
        self.proxima_leitura = agora + RELER_NUMEROS_S
        self.falhas_numeros = 0
        # número -> (instante do primeiro aviso da janela, avisos mandados nela)
        self.respostas: dict[str, tuple[float, int]] = {}
        self.envios: dict[str, float] = {}
        self.lidos: dict[str, float] = {}
        # (evento, instante, (inode, byte do começo da linha)) que o n8n ainda não recebeu, na ordem.
        self.pendentes: deque = deque()
        self.falhas_envio = 0
        self.tentar_em = 0.0
        self.lote: list[dict] = []
        self.lote_desde: float | None = None
        # Hora mais recente vista no log (linhas com ts): data a mensagem recebida lida com atraso.
        self.hora_do_log: float | None = None
        self.proxima_conferencia = agora
        self.remendo_avisado = False
        self.gravar_lista()

    # ------------------------------------------------------------ linhas do log

    def linha(self, texto: str, origem: tuple[int, int] | None = None, atrasada: bool = False,
              desde: float | None = None) -> None:
        if MOTIVO not in texto and '"owner_' not in texto and '"time"' not in texto:
            return
        try:
            ev = json.loads(texto[texto.index("{"):])
        except ValueError:
            return
        if not isinstance(ev, dict):
            return
        agora = self.relogio()
        if isinstance(ev.get("time"), (int, float)) and ev.get("level") is not None:
            self._hora_vista(ev["time"] / 1000, agora)  # linha do pino (aviso/erro do Baileys)
            return
        if ev.get("reason") == MOTIVO:
            tipo = "entrada"
            # Mensagem recebida não traz hora: ao vivo é agora; atrasada, a última hora conhecida.
            quando = agora if not atrasada else max(filter(None, (self.hora_do_log, desde)), default=agora)
        elif ev.get("event") == "owner_sent":
            tipo, quando = "saida", self._hora_vista(ev.get("ts"), agora)
        elif ev.get("event") == "owner_receipt":
            quando = self._hora_vista(ev.get("ts"), agora)
            if ev.get("status") != "lido":
                return  # "entregue" fica só no log
            tipo = "lido"
        else:
            return
        chave = chave_do_numero(self.telefone(str(ev.get("chatId") or "")))
        if not chave or chave not in self.chaves:
            return
        evento = {"chave": chave, "direcao": tipo, "em": iso(quando)}
        if tipo == "entrada":
            antes = self.respostas.get(chave)
            if antes and quando - antes[0] < JANELA_DEDUPE_S:
                # Mesma janela: só um segundo aviso, e só depois do tempo da saudação automática.
                if antes[1] >= 2 or quando - antes[0] < JANELA_SAUDACAO_S:
                    return
                evento["seguinte"] = True
                self.respostas[chave] = (antes[0], 2)
            else:
                self.respostas[chave] = (quando, 1)
        else:
            vistos, janela = (self.envios, JANELA_ENVIO_S) if tipo == "saida" else (self.lidos, JANELA_LIDO_S)
            if chave in vistos and abs(quando - vistos[chave]) < janela:
                return
            vistos[chave] = quando
        self.pendentes.append((evento, quando, origem))
        while len(self.pendentes) > MAX_PENDENTES:
            perdido = self.pendentes.popleft()[0]
            log(f"fila cheia: descartado {perdido['direcao']} de {mascarar(perdido['chave'])}")
        self.esvaziar()

    def _hora_vista(self, ts, agora: float) -> float:
        """ts da linha (s; ms também serve) -> instante; hora absurda vira agora."""
        try:
            t = float(ts)
        except (TypeError, ValueError):
            return agora
        if t > 1e12:
            t /= 1000
        if not 1e9 < t < agora + 300:
            return agora
        self.hora_do_log = max(self.hora_do_log or t, t)
        return t

    # ------------------------------------------------------------ n8n

    def esvaziar(self) -> None:
        if self.relogio() < self.tentar_em:
            return
        while self.pendentes:
            evento, quando, _ = self.pendentes[0]
            try:
                resposta = self.chamar("POST", "whatsapp-conversa", evento)
            except Exception as e:  # noqa: BLE001 — fica na fila e tenta de novo
                self.falhas_envio += 1
                espera = espera_da_falha(e, self.falhas_envio)
                self.tentar_em = self.relogio() + espera
                log(f"n8n não recebeu ({len(self.pendentes)} na fila), tento de novo em {espera} s:", e)
                return
            self.pendentes.popleft()
            self.falhas_envio = 0
            seguinte = " (de novo)" if evento.get("seguinte") else ""
            log(f"lead {FEITO[evento['direcao']]}{seguinte}: {mascarar(evento['chave'])}")
            if evento["direcao"] == "saida" and isinstance(resposta, dict):
                for m in resposta.get("marcados") or []:
                    if isinstance(m, dict) and m.get("acao") in ("abordou", "retomou"):
                        self.lote.append({"planilha": str(m.get("planilha") or ""), "nome": str(m.get("nome") or "lead"),
                                          "acao": m["acao"], "antes": str(m.get("antes") or ""),
                                          "hora": time.strftime("%H:%M", time.localtime(quando))})
                        self.lote_desde = self.lote_desde or self.relogio()

    def reler_numeros(self) -> None:
        agora = self.relogio()
        try:
            self.chaves = ler_numeros(self.chamar)
            self.falhas_numeros = 0
            self.proxima_leitura = agora + RELER_NUMEROS_S
            self.gravar_lista()
        except Exception as e:  # noqa: BLE001 — mantém a lista anterior
            self.falhas_numeros += 1
            espera = espera_da_falha(e, self.falhas_numeros)
            self.proxima_leitura = agora + espera
            log(f"não consegui reler os números dos leads (tento em {espera} s):", e)

    # ------------------------------------------------------------ texto das respostas

    def gravar_lista(self) -> None:
        """leads.json: o filtro da bridge para gravar texto. Escrita atômica, 600."""
        try:
            self.pasta.mkdir(parents=True, exist_ok=True)
            tmp = self.pasta / "leads.json.tmp"
            tmp.write_text(json.dumps(sorted(self.chaves)))
            tmp.chmod(0o600)
            tmp.replace(self.pasta / "leads.json")
        except OSError as e:
            log("lista de leads não gravada para a bridge:", e)

    def ler_respostas(self) -> None:
        """Tira o respostas.jsonl do caminho (a bridge abre o arquivo a cada linha e cria outro),
        lê e apaga. Um .lendo que sobrou de uma parada no meio é lido primeiro."""
        arquivo, lendo = self.pasta / "respostas.jsonl", self.pasta / "respostas.lendo.jsonl"
        try:
            if not lendo.exists():
                if not arquivo.exists() or arquivo.stat().st_size == 0:
                    return
                arquivo.replace(lendo)
            linhas = lendo.read_text(encoding="utf-8", errors="replace").splitlines()
            lendo.unlink()
        except OSError as e:
            log("respostas não lidas:", e)
            return
        agora = self.relogio()
        for texto in linhas:
            try:
                r = json.loads(texto)
                chave, msg = str(r["chave"]), str(r["texto"]).strip()
            except (ValueError, KeyError, TypeError):
                continue
            # A lista pode ter mudado entre a bridge gravar e agora; quem saiu dela fica de fora.
            if chave not in self.chaves or not msg:
                continue
            quando = self._hora_vista(r.get("ts"), agora)
            c = self.conversas.setdefault(chave, {"mensagens": [], "ultima": agora})
            if len(c["mensagens"]) < MAX_MENSAGENS_POR_CONVERSA:
                c["mensagens"].append({"em": iso(quando), "texto": msg[:1000]})
            c["ultima"] = agora

    def fechar_conversas(self, todas: bool = False) -> None:
        agora = self.relogio()
        for chave in [k for k, c in self.conversas.items() if todas or agora - c["ultima"] >= ESPERA_DA_CONVERSA_S]:
            self.conversas_prontas.append({"chave": chave, "mensagens": self.conversas.pop(chave)["mensagens"]})

    def mandar_conversas(self) -> None:
        if self.relogio() < self.conversa_tentar_em:
            return
        while self.conversas_prontas:
            conversa = self.conversas_prontas[0]
            try:
                resposta = self.chamar("POST", "whatsapp-resposta", conversa)
            except Exception as e:  # noqa: BLE001 — fica na fila e tenta de novo
                self.falhas_conversa += 1
                espera = espera_da_falha(e, self.falhas_conversa)
                self.conversa_tentar_em = self.relogio() + espera
                log(f"n8n não recebeu a resposta de {mascarar(conversa['chave'])}, tento de novo em {espera} s:", e)
                return
            self.conversas_prontas.popleft()
            self.falhas_conversa = 0
            marcados = (resposta.get("marcados") or []) if isinstance(resposta, dict) else []
            tipos = ", ".join(str(m.get("tipo")) for m in marcados if isinstance(m, dict)) or "nenhum lead"
            log(f"resposta classificada: {mascarar(conversa['chave'])} ({len(conversa['mensagens'])} msg) -> {tipos}")
            for m in marcados:
                if isinstance(m, dict) and m.get("aviso"):
                    self.avisar(str(m["aviso"]))

    # ------------------------------------------------------------ rotina

    def tick(self) -> None:
        agora = self.relogio()
        if agora >= self.proxima_leitura:
            self.reler_numeros()
        if self.pendentes:
            self.esvaziar()
        self.ler_respostas()
        self.fechar_conversas()
        if self.conversas_prontas:
            self.mandar_conversas()
        if self.lote and agora - (self.lote_desde or agora) >= LOTE_AVISO_S:
            self.avisar_lote()
        if agora >= self.proxima_conferencia:
            self.proxima_conferencia = agora + RELER_NUMEROS_S
            self.conferir_remendo()

    def avisar_lote(self) -> None:
        if self.lote:
            unicos = list({(a["planilha"], a["nome"]): a for a in self.lote}.values())
            self.avisar(texto_do_lote(unicos))
        self.lote, self.lote_desde = [], None

    def conferir_remendo(self) -> None:
        """Remendo sumiu do bridge.js (hermes update): avisa uma vez até voltar."""
        try:
            texto = self.bridge_js.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        if all(m in texto for m in MARCAS_DO_REMENDO):
            self.remendo_avisado = False
        elif not self.remendo_avisado:
            self.remendo_avisado = True
            self.avisar("A bridge do WhatsApp perdeu o remendo (provável `hermes update`): o que você manda aos "
                        "leads, os recibos de leitura e o texto das respostas (negativa, robô, interesse) não estão "
                        "chegando à planilha; que o lead respondeu continua marcando. "
                        f"Para pôr de volta: {COMANDO_REMENDO}")

    def posicao_segura(self, onde: dict) -> tuple[int, int] | None:
        """Nunca grava além do primeiro evento que o n8n ainda não recebeu."""
        if not onde:
            return None
        pos = onde["posicao"]
        for _, _, origem in self.pendentes:
            if origem and origem[0] == onde["inode"]:
                pos = min(pos, origem[1])
        return onde["inode"], pos


def main() -> int:
    # Sem a lista, toda resposta seria descartada: espera o n8n antes de ler o log.
    falhas = 0
    while True:
        try:
            chaves = ler_numeros()
            break
        except Exception as e:  # noqa: BLE001
            falhas += 1
            espera = espera_da_falha(e, falhas)
            log(f"não consegui ler os números dos leads (tento em {espera} s):", e)
            time.sleep(espera)
    onde: dict = {}
    obs = Observador(chaves)
    log(f"acompanhando {LOG_DA_BRIDGE}")
    try:
        return acompanhar(obs, onde)
    finally:
        obs.avisar_lote()  # parar o serviço não engole o aviso
        obs.ler_respostas()  # nem a conversa que ainda estava juntando
        obs.fechar_conversas(todas=True)
        obs.mandar_conversas()
        if pos := obs.posicao_segura(onde):
            salvar_posicao(*pos)


def acompanhar(obs: Observador, onde: dict) -> int:
    gravado, gravado_em = None, 0.0
    ultima_linha = time.time()
    silencio_avisado = False
    for linha in seguir(LOG_DA_BRIDGE, onde):
        agora = time.time()
        obs.tick()
        pos = obs.posicao_segura(onde)
        if pos and pos != gravado and agora - gravado_em >= GRAVAR_POSICAO_S:
            gravado, gravado_em = pos, agora
            salvar_posicao(*pos)
        if linha is None:
            if agora - ultima_linha > SILENCIO_SUSPEITO_S and not silencio_avisado:
                obs.avisar("O log da bridge do WhatsApp está parado há 6 h: as conversas com leads podem não "
                           "estar marcando a planilha (Hermes fora do ar ou mudança na bridge).")
                silencio_avisado = True
            continue
        ultima_linha, silencio_avisado = agora, False
        origem = (onde["inode"], onde["posicao"])
        obs.linha(linha, origem, atrasada=onde["posicao"] < onde.get("atraso_ate", 0), desde=onde.get("salvo_em"))
    return 0


if __name__ == "__main__":
    # systemctl stop manda SIGTERM: sai pelo finally e grava a posição.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    sys.exit(main())
