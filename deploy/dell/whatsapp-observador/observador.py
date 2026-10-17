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
apagado depois de processado (desde 17/10/2026, só com a conversa em disco gravada e o
lote montado: ver ler_respostas); o texto fica só na memória até o n8n confirmar. Custo
aceito: reiniciar o serviço com uma conversa ainda juntando perde a
classificação dela (o SIGTERM tenta mandar antes de sair), e a marcação de
"respondeu" pelo log continua valendo.

Conversa do lead em disco (16/10/2026, pedido do Rômulo: "o 'em contato' não tem
visão clara do que tá acontecendo"; o Jev ou o Hermes precisam LER a conversa para
decidir a próxima mensagem, em vez de adivinhar a etapa pelo trecho de 200
caracteres da planilha). Além do que vai ao n8n, cada mensagem de LEAD vira uma
linha em WHATSAPP_CONVERSAS_DIR/<chave>.jsonl (pasta 700, arquivo 600):
{"em" (UTC), "direcao": "entrada"|"saida", "texto" (até 2000), "origem", "id"?, "papel"?}
("papel": "recepcao"|"robo" desde 17/10/2026; ausente = gente).
"entrada" vem do respostas.jsonl (o texto que o lead escreveu); "saida", do
enviadas.jsonl (o texto que o Rômulo escreveu a um lead: remendo `squadone:envios`
da bridge e o evolution-adaptador) ou, com a bridge antiga (owner_sent sem id),
uma linha com texto vazio. Recibo de leitura não é linha. Deduplica pelo id da
mensagem lendo o arquivo (os dois observadores veem o MESMO chip desde 16/10, e
um reinício relê o log), poda o que passou de 120 dias uma vez por dia por
arquivo e nunca derruba o fluxo: falha de gravação vai ao journal e segue.
A Central lê esses arquivos (/crm, Ficha) e o Hermes também (skill
`conversa-do-lead`); ninguém envia nada a lead a partir deles (RULES 17).

Leads do Plus (17/10/2026, OT-13 do blueprint): os do Catálogo de Negócios Maçônicos não estão em
planilha nenhuma (vêm de ~/prumo-entregas/plus/leads.json, só no Dell), então o n8n não devolvia os
números deles e a resposta de um Plus nem era vista; o Rômulo anotava à mão na Ficha. Agora o leitor
lê também esse arquivo (só a chave de cada número; nome e telefone não ficam na memória) e junta as
chaves ao filtro: a bridge e o evolution-adaptador gravam o texto, e a conversa vai para
WHATSAPP_CONVERSAS_DIR como a dos outros leads, onde a Central a lê pelo número. Ao n8n nada vai de
quem é SÓ Plus: lá não há linha para marcar e cada conversa custaria uma classificação do Gemini à
toa. O "plus_respondeu" da aba CRM continua sendo o toque na Ficha (a Central já mostra a conversa).

Áudio e contexto (17/10/2026): um ÁUDIO de recusa virava "[áudio]" e nunca era ouvido, e o "Claro, pode
enviar sim" a "posso mandar o vídeo? Sem compromisso" virou "interesse" porque o classificador só via as
mensagens do lead. Agora:
- áudio de lead que o evolution-adaptador marcou com `audio: {seg, msg}` (até 120 s) é baixado da Evolution
  (POST /chat/getBase64FromMediaMessage, a apikey lida a cada vez do .env 600 do compose, nunca em log),
  transcrito pelo Gemini (a chave do SquadOne, como o raio-x-ia.py) e gravado como "[áudio 27s] <transcrição>"
  na conversa e no lote do n8n. O áudio fica só em memória. Teto de 20 por dia de São Paulo
  (transcricoes.json, 600), 5 MB, 25 s por pedido. Qualquer falha grava só "[áudio 27s]" e o motivo vai ao
  journal (sem texto); nada derruba o laço. OBSERVADOR_TRANSCREVER=0 desliga. A bridge do Hermes não tem o
  que baixar: a instância do número pessoal grava "[áudio]" e, se ela chegar antes, a do PRUMO SUBSTITUI a
  linha pela transcrita (mesmo id; ver melhora_o_audio). Revisão de 17/10/2026: um aviso por áudio (a instância
  sem `audio` no registro não manda ao n8n lote só de marcador; a que o recebeu manda a transcrição ou, sem ela,
  o marcador uma vez), a cota só se gasta depois do download, conta ilegível recomeça o dia (contador_ilegivel) e
  um reinício no meio da transcrição não perde o lote (o .lendo só sai no fim);
- `papel` na linha da conversa e na mensagem do lote: "*[Nome]* ..." = recepcao, "[Atendimento] ..." /
  "[Bot ...]" = robo, ausente = gente (só pela marca no texto, sem modelo);
- o lote leva `contexto`: as últimas 3 mensagens do Rômulo e as últimas 3 do lead antes do lote (com o papel),
  lidas da conversa em disco, para o n8n saber a pergunta que o "sim" responde e uma recusa anterior.

Privacidade: o bridge.log não tem conteúdo; texto só de quem é lead. Só o número
de quem é lead sai daqui (DDD + 8 últimos dígitos), e a linha da conversa não
leva número nenhum (a chave é o nome do arquivo). Grupos, canais, listas de
transmissão e status são ignorados. O log do serviço mostra só DDD + 2 últimos
dígitos, nunca o texto.
"""
from __future__ import annotations

import base64
import binascii
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
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

try:  # no Dell sempre existe; no PC (testes) não: a trava vira no-op
    import fcntl
except ImportError:  # pragma: no cover — Windows
    fcntl = None

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
SILENCIO_SUSPEITO_S = int(os.environ.get("OBSERVADOR_SILENCIO_S", 6 * 3600))  # 0 desliga (número do PRUMO, ver abaixo)
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
# iris/estampa (14/10/2026): as abas Clínicas e Estamparias do PRUMO (whatsapp-conversa.py, OFERTAS).
ROTULO = {"site": "Site antes da venda", "prumo": "PRUMO", "iris": "Iris · Clínicas", "estampa": "CRM de estamparia"}
FEITO = {"entrada": "respondeu", "saida": "recebeu mensagem sua", "lido": "leu"}
COMANDO_REMENDO = "python3 ~/SquadOne/deploy/hermes/scripts/patch_bridge_envios.py --reiniciar"
# Conversa do lead em disco (contrato lido pela Central: não mude sem mudar o server).
CONVERSAS = Path(os.environ.get("WHATSAPP_CONVERSAS_DIR") or HOME / ".local/share/whatsapp-conversas")
# Quem gravou a linha: o número pessoal (bridge do Hermes) ou o do PRUMO (Evolution).
ORIGEM = (os.environ.get("OBSERVADOR_ORIGEM") or "").strip() or ("prumo" if "prumo" in str(LOG_DA_BRIDGE) else "pessoal")
# Os leads do Plus (OT-13): o arquivo que server/crm.ts lê (lerPlus), fora do repositório.
PLUS = Path(os.environ.get("OBSERVADOR_PLUS") or HOME / "prumo-entregas/plus/leads.json")
GUARDAR_CONVERSA_S = 120 * 86400
PODAR_A_CADA_S = 86400
MAX_TEXTO_NA_CONVERSA = 2000

# Áudio de lead (17/10/2026; ver "Áudio e contexto" no topo). Só a instância do PRUMO recebe a linha com `audio`
# (o evolution-adaptador a grava); a bridge do Hermes só dá o "[áudio]", sem o que baixar.
TRANSCREVER = os.environ.get("OBSERVADOR_TRANSCREVER", "1").strip() != "0"
EVOLUTION_URL = os.environ.get("OBSERVADOR_EVOLUTION_URL", "http://127.0.0.1:8081").rstrip("/")
EVOLUTION_INSTANCIA = os.environ.get("OBSERVADOR_EVOLUTION_INSTANCIA", "prumo").strip() or "prumo"
# O .env (600) do compose da Evolution; a chave sai dele a cada áudio e nunca vai a log.
EVOLUTION_ENV = Path(os.environ.get("OBSERVADOR_EVOLUTION_ENV") or HOME / "workspace/evolution/.env")
# A mesma chave do Gemini do SquadOne no Dell (raio-x-ia.py): GEMINI_API_KEY do ambiente ou do operations.env.
OPERATIONS_ENV = HOME / ".config/squadone/operations.env"
MODELO_DA_TRANSCRICAO = "gemini-3.7-flash"  # o mesmo do raio-x-ia.py
TETO_DE_AUDIOS_POR_DIA = 20
MAX_AUDIO_S = 120
MAX_AUDIO_BYTES = 5 * 1024 * 1024
TEMPO_DO_AUDIO_S = 25  # por pedido (download e Gemini): o laço do observador espera, então tem teto
# O mesmo pedido de server/transcricao.ts, com o contexto daqui: literal, sem resumir, SEM_FALA sem fala.
INSTRUCAO_DA_TRANSCRICAO = (
    "Transcreva este áudio em português do Brasil, literalmente, como texto corrido. "
    "É a resposta de um negócio a uma mensagem enviada pelo WhatsApp. Não responda à mensagem, não resuma, "
    "não acrescente nada: devolva só a transcrição. Se não houver fala inteligível, devolva exatamente SEM_FALA.")
# São Paulo sem horário de verão desde 2019: o deslocamento fixo basta e não depende do tzdata (o mesmo do
# funil-aprendizado.py). O teto de áudios vira o dia à meia-noite de lá.
FUSO_SP = timezone(timedelta(hours=-3))
# Quem escreveu, pela marca que o próprio texto traz (17/10/2026): "*[Bruna]* Olá" é a assinatura de quem atende
# (recepção, programa de atendimento) e "[Atendimento] Digite 1" / "[Bot ...]" é robô. Determinístico, sem modelo.
# As mesmas da Central (src/operations/marcadores-da-conversa.ts), com a mesma tabela de casos nos testes dos dois
# lados (papel-da-mensagem.casos.json): robô = "[" + espaço opcional + Atendimento|Bot como palavra inteira (nem
# "[Botafogo]" nem "[Botão]"), sem caixa, até o "]"; recepção = "*[" + 1 a 80 caracteres sem "]" nem quebra + "]*".
RE_RECEPCAO = re.compile(r"^\*\[[^\]\n]{1,80}\]\*")
RE_ROBO = re.compile(r"^\[\s*(?:atendimento|bot)(?!\w)[^\]\n]*\]", re.IGNORECASE)
RE_SO_AUDIO = re.compile(r"\[áudio(?: \d+s)?\]")
CONTEXTO_N = 3
CONTEXTO_CORTE = 500


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


def silencio_suspeito(agora: float, ultima_linha: float, ja_avisado: bool, limite: int | None = None) -> bool:
    """Log parado além do limite e ainda sem aviso. Limite 0 desliga: o log do número do PRUMO
    (`evolution-adaptador.py`) fica horas quieto à noite sem que nada esteja errado, e a
    desconexão dele é avisada pelo próprio adaptador."""
    limite = SILENCIO_SUSPEITO_S if limite is None else limite
    return limite > 0 and not ja_avisado and agora - ultima_linha > limite


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


def ler_chaves_do_plus(arquivo: Path = PLUS) -> set[str]:
    """As chaves (DDD + 8) dos leads do Plus, do mesmo jeito que o lerPlus da Central: {"leads": [{"whatsapp"}]}.
    Ausente ou ilegível = nenhum (o filtro Plus da Central também fica vazio); nunca levanta."""
    try:
        dados = json.loads(Path(arquivo).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    lista = dados.get("leads") if isinstance(dados, dict) else None
    if not isinstance(lista, list):
        return set()
    return {c for item in lista[:2000] if isinstance(item, dict) and (c := chave_do_numero(item.get("whatsapp")))}


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


# ------------------------------------------------------------------ papel e áudio (puro)

def papel_da_mensagem(texto) -> str | None:
    """'recepcao' | 'robo' pela marca no começo do texto; None = gente (o padrão do contrato)."""
    t = str(texto or "").lstrip()
    if RE_RECEPCAO.match(t):
        return "recepcao"
    if RE_ROBO.match(t):
        return "robo"
    return None


def so_marcador_de_audio(texto) -> bool:
    """'[áudio]' ou '[áudio 27s]' sem nada depois: um áudio que ninguém ouviu."""
    return bool(RE_SO_AUDIO.fullmatch(str(texto or "").strip()))


def texto_com_transcricao(marcador: str, transcricao: str) -> str:
    """'[áudio 27s] <transcrição>', no teto da linha da conversa."""
    return f"{marcador.strip()} {transcricao.strip()}"[:MAX_TEXTO_NA_CONVERSA]


def melhora_o_audio(velho, novo) -> bool:
    """A linha nova traz mais do mesmo áudio que a antiga (só o marcador): a transcrição, ou a duração que
    faltava ao '[áudio]' da bridge. É a corrida das duas instâncias do observador sobre o mesmo chip."""
    velho, novo = str(velho or "").strip(), str(novo or "").strip()
    if not so_marcador_de_audio(velho) or not novo.startswith("[áudio") or novo == velho:
        return False
    return not so_marcador_de_audio(novo) or velho == "[áudio]"


def ler_transcricao(bruto) -> str | None:
    """A resposta do modelo -> a transcrição em uma linha, ou None quando não houve fala (SEM_FALA ou vazio)."""
    t = re.sub(r"\s+", " ", str(bruto or "")).strip()
    if not t or t.strip(" .\"'").upper() == "SEM_FALA":
        return None
    return t[:MAX_TEXTO_NA_CONVERSA]


def texto_da_resposta_gemini(r) -> str:
    """O texto do generateContent (as partes do primeiro candidato), sem as de raciocínio."""
    try:
        partes = r["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError):
        return ""
    return "".join(str(p.get("text") or "") for p in partes if isinstance(p, dict) and not p.get("thought"))


def dia_de_sao_paulo(instante: float) -> str:
    return datetime.fromtimestamp(instante, FUSO_SP).strftime("%Y-%m-%d")


def motivo_para_nao_transcrever(audio) -> str:
    """'' quando a linha pode ir ao download; senão o motivo (vai ao journal, nunca o conteúdo)."""
    if not isinstance(audio, dict):
        return "sem_dados"
    seg = audio.get("seg")
    # O adaptador marca também o áudio longo, sem `msg` (revisão de 17/10/2026): o journal diz "longo", não "sem_dados".
    if isinstance(seg, (int, float)) and not isinstance(seg, bool) and seg > MAX_AUDIO_S:
        return "longo"
    if not isinstance(audio.get("msg"), dict):
        return "sem_dados"
    if isinstance(seg, bool) or not isinstance(seg, (int, float)) or seg < 0:
        return "sem_duracao"
    if seg > MAX_AUDIO_S:
        return "longo"
    msg = audio["msg"]
    am = (msg.get("message") or {}).get("audioMessage") if isinstance(msg.get("message"), dict) else None
    if not isinstance(msg.get("key"), dict) or not msg["key"].get("id") or not isinstance(am, dict):
        return "sem_dados"
    tamanho = am.get("fileLength")
    if isinstance(tamanho, dict):  # Long do Baileys
        tamanho = tamanho.get("low")
    try:
        if tamanho is not None and int(tamanho) > MAX_AUDIO_BYTES:
            return "grande"
    except (TypeError, ValueError):
        pass
    return ""


def contexto_da_conversa(linhas: list[dict], ids_do_lote, desde: float, ate: float,
                         n: int = CONTEXTO_N, corte: int = CONTEXTO_CORTE) -> dict:
    """O que o classificador do n8n precisa para ler a resposta: as últimas `n` mensagens do Rômulo até a
    última do lote (a pergunta que o "sim" responde) e as últimas `n` do lead ANTES do lote (uma recusa
    anterior, por exemplo), com o papel de cada uma. Saída vazia sem texto (a bridge antiga grava a saída
    sem texto) não ajuda e fica de fora. {} quando não há nada."""
    ids = {str(i) for i in ids_do_lote if i}
    com_hora = []
    for k, l in enumerate(linhas):
        t = _instante_iso(l.get("em"))
        texto = str(l.get("texto") or "").strip()
        if t is None or not texto:
            continue
        com_hora.append((t, k, l, texto))
    com_hora.sort(key=lambda x: (x[0], x[1]))
    saidas = [{"em": l["em"], "texto": texto[:corte]} for t, _, l, texto in com_hora
              if l.get("direcao") == "saida" and t <= ate + 1][-n:]
    anteriores = [{"em": l["em"], "texto": texto[:corte], **({"papel": l["papel"]} if l.get("papel") in ("recepcao", "robo") else {})}
                  for t, _, l, texto in com_hora
                  if l.get("direcao") == "entrada" and t < desde and str(l.get("id") or "") not in ids][-n:]
    return {k: v for k, v in (("saidas", saidas), ("anteriores", anteriores)) if v}


# ------------------------------------------------------------------ áudio: teto, download e transcrição

class TetoDiario:
    """Quantos áudios já foram transcritos hoje (dia de São Paulo), num JSON 600 na pasta do observador.

    Revisão de 17/10/2026: conta ilegível (JSON quebrado, `usadas` que não é número, arquivo que não abre)
    RECOMEÇA a conta do dia, com o motivo próprio no journal (contador_ilegivel): antes ela virava
    "teto_do_dia" calado e nenhum áudio era ouvido até alguém apagar o arquivo. Sem conseguir GRAVAR a conta,
    não gasta (falha fechada, contador_sem_gravar): o teto é o que segura o custo. O consumo só acontece depois
    do download dar certo (Transcritor): Evolution fora do ar ou mídia vencida não gasta cota."""

    def __init__(self, arquivo: Path, teto: int = TETO_DE_AUDIOS_POR_DIA, relogio=time.time):
        self.arquivo, self.teto, self.relogio = Path(arquivo), teto, relogio

    def _usadas_hoje(self, hoje: str) -> int:
        try:
            bruto = self.arquivo.read_text(encoding="utf-8")
        except FileNotFoundError:
            return 0
        except (OSError, ValueError) as e:  # ValueError: UnicodeDecodeError
            log(f"contador de transcrições ilegível (contador_ilegivel, {type(e).__name__}): recomeço a conta do dia")
            return 0
        try:
            d = json.loads(bruto)
            if not isinstance(d, dict):
                raise ValueError("conta")
            if d.get("dia") != hoje:
                return 0  # a conta de outro dia: o dia virou
            usadas = d.get("usadas", 0)
            if isinstance(usadas, bool) or not isinstance(usadas, (int, float)) or usadas != usadas or usadas < 0:
                raise ValueError("usadas")
            return int(usadas)
        except (ValueError, TypeError, OverflowError):
            log("contador de transcrições ilegível (contador_ilegivel): recomeço a conta do dia")
            return 0

    def tem_cota(self) -> bool:
        """Ainda cabe um áudio hoje? Só lê (o download vem antes do consumo)."""
        return self._usadas_hoje(dia_de_sao_paulo(self.relogio())) < self.teto

    def consumir(self) -> str:
        """'' quando gastou um; senão o motivo: 'teto_do_dia' ou 'contador_sem_gravar'."""
        hoje = dia_de_sao_paulo(self.relogio())
        usadas = self._usadas_hoje(hoje)
        if usadas >= self.teto:
            return "teto_do_dia"
        try:
            self.arquivo.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.arquivo.with_name(f".{self.arquivo.name}.tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps({"dia": hoje, "usadas": usadas + 1}))
            os.replace(tmp, self.arquivo)
        except OSError:
            return "contador_sem_gravar"
        return ""


class AudioGrande(Exception):
    """O arquivo que a Evolution devolveu passa de MAX_AUDIO_BYTES."""


class SemAudio(Exception):
    """A Evolution respondeu sem o arquivo (base64 ausente ou ilegível)."""


def ler_do_env(arquivo: Path, nome: str) -> str | None:
    """NOME=valor de um .env, sem aspas; None ausente. O valor nunca é impresso."""
    try:
        for linha in Path(arquivo).read_text(encoding="utf-8").splitlines():
            if linha.startswith(nome + "="):
                return linha.split("=", 1)[1].strip().strip('"').strip("'") or None
    except OSError:
        pass
    return None


def chave_do_gemini() -> str | None:
    return (os.environ.get("GEMINI_API_KEY") or "").strip() or ler_do_env(OPERATIONS_ENV, "GEMINI_API_KEY")


def apikey_da_evolution() -> str | None:
    return ler_do_env(EVOLUTION_ENV, "EVOLUTION_APIKEY")


def _ler_limitado(resposta, limite: int) -> bytes:
    bruto = resposta.read(limite + 1)
    if len(bruto) > limite:
        raise AudioGrande()
    return bruto


def baixar_da_evolution(msg: dict, apikey: str, url: str = EVOLUTION_URL, instancia: str = EVOLUTION_INSTANCIA,
                        timeout: float = TEMPO_DO_AUDIO_S) -> tuple[bytes, str]:
    """O áudio, em memória, pelo POST /chat/getBase64FromMediaMessage da Evolution (a mensagem inteira vai no
    corpo: com DATABASE_SAVE_DATA_NEW_MESSAGE=false ela não acharia pelo id). Nada é gravado em disco."""
    req = urllib.request.Request(
        f"{url}/chat/getBase64FromMediaMessage/{quote(instancia, safe='')}", method="POST",
        headers={"apikey": apikey, "Content-Type": "application/json"},
        data=json.dumps({"message": msg, "convertToMp4": False}).encode())
    with urllib.request.urlopen(req, timeout=timeout) as r:
        # base64 de 5 MB tem ~6,7 MB; o resto é folga para o JSON em volta.
        bruto = _ler_limitado(r, MAX_AUDIO_BYTES * 4 // 3 + 64 * 1024)
    d = json.loads(bruto)
    b64 = d.get("base64") if isinstance(d, dict) else None
    if not isinstance(b64, str) or not b64:
        raise SemAudio()
    if "," in b64[:100] and b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        dados = base64.b64decode(re.sub(r"\s+", "", b64), validate=True)
    except (binascii.Error, ValueError) as e:
        raise SemAudio() from e
    if not dados:
        raise SemAudio()
    if len(dados) > MAX_AUDIO_BYTES:
        raise AudioGrande()
    mime = d.get("mimetype") or ((msg.get("message") or {}).get("audioMessage") or {}).get("mimetype") or "audio/ogg"
    return dados, str(mime)


def transcrever_no_gemini(dados: bytes, mime: str, chave: str, modelo: str = MODELO_DA_TRANSCRICAO,
                          timeout: float = TEMPO_DO_AUDIO_S) -> str:
    """Uma chamada ao generateContent com o áudio inline; devolve o texto cru do modelo."""
    corpo = {"contents": [{"role": "user", "parts": [
        {"inlineData": {"mimeType": (str(mime).split(";")[0].strip() or "audio/ogg"), "data": base64.b64encode(dados).decode()}},
        {"text": INSTRUCAO_DA_TRANSCRICAO}]}],
        "generationConfig": {"temperature": 0}}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent", method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": chave}, data=json.dumps(corpo).encode())
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return texto_da_resposta_gemini(json.loads(_ler_limitado(r, 1024 * 1024)))


def motivo_do_erro(e: BaseException) -> str:
    """A classe do erro para o journal: nunca a mensagem (um corpo de erro pode ecoar o pedido)."""
    if isinstance(e, urllib.error.HTTPError):
        return f"http_{e.code}"
    if isinstance(e, AudioGrande):
        return "grande"
    if isinstance(e, SemAudio):
        return "sem_audio_na_resposta"
    if isinstance(e, TimeoutError) or (isinstance(e, urllib.error.URLError) and isinstance(e.reason, TimeoutError)):
        return "tempo_esgotado"
    if isinstance(e, urllib.error.URLError):
        return "sem_conexao"
    if isinstance(e, ValueError):
        return "resposta_ilegivel"
    return type(e).__name__


class Transcritor:
    """Áudio de lead -> transcrição, com o teto do dia. `baixar`, `gemini` e as chaves entram de fora nos testes.
    `transcrever` nunca levanta: devolve (texto, '') ou (None, motivo)."""

    def __init__(self, pasta: Path, relogio=time.time, ligado: bool = TRANSCREVER, teto: int = TETO_DE_AUDIOS_POR_DIA,
                 baixar=baixar_da_evolution, gemini=transcrever_no_gemini, chave_gemini=chave_do_gemini,
                 apikey=apikey_da_evolution):
        self.ligado, self.baixar, self.gemini = ligado, baixar, gemini
        self.chave_gemini, self.apikey = chave_gemini, apikey
        self.teto = TetoDiario(Path(pasta) / "transcricoes.json", teto, relogio)

    def transcrever(self, audio) -> tuple[str | None, str]:
        if not self.ligado:
            return None, "desligado"
        motivo = motivo_para_nao_transcrever(audio)
        if motivo:
            return None, motivo
        try:
            chave = self.chave_gemini()
            if not chave:
                return None, "sem_chave_gemini"
            apikey = self.apikey()
            if not apikey:
                return None, "sem_apikey_evolution"
            if not self.teto.tem_cota():
                return None, "teto_do_dia"
            dados, mime = self.baixar(audio["msg"], apikey)
            if len(dados) > MAX_AUDIO_BYTES:
                return None, "grande"
            # A cota só é gasta com o áudio em mãos: falha da Evolution ou mídia vencida não consome o dia.
            sem_cota = self.teto.consumir()
            if sem_cota:
                return None, sem_cota
            texto = ler_transcricao(self.gemini(dados, mime, chave))
        except Exception as e:  # noqa: BLE001 — um áudio não derruba o laço
            return None, motivo_do_erro(e)
        return (texto, "") if texto else (None, "sem_fala")


# ------------------------------------------------------------------ conversa do lead em disco

def nome_da_conversa(chave) -> str:
    """O nome do arquivo (sem .jsonl): a chave com só [A-Za-z0-9_:.-], até 200. '' = não grava."""
    nome = re.sub(r"[^A-Za-z0-9_:.-]", "_", str(chave or ""))[:200]
    return "" if nome.strip(".") == "" else nome


def iso_utc(instante: float) -> str:
    return datetime.fromtimestamp(instante, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _instante_iso(txt) -> float | None:
    try:
        return datetime.fromisoformat(str(txt).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


class Conversas:
    """WHATSAPP_CONVERSAS_DIR/<chave>.jsonl: uma linha por mensagem de lead, nas duas direções.

    Os dois observadores (número pessoal e PRUMO) gravam na mesma pasta e, desde 16/10/2026,
    veem o mesmo chip: a mesma mensagem chega pelos dois, com o mesmo id. Por isso a deduplicação
    lê o ARQUIVO (sob flock numa trava da pasta), e não uma memória do processo; o arquivo de um
    lead é pequeno (120 dias de conversa). Linha sem id (bridge antiga) deduplica por direção,
    hora e texto. `anexar` nunca levanta: a conversa é um extra, a marcação da planilha não pode
    parar por ela."""

    def __init__(self, pasta: Path = CONVERSAS, origem: str = ORIGEM, relogio=time.time):
        self.pasta, self.origem, self.relogio = Path(pasta), origem, relogio
        self.podado: dict[str, float] = {}  # nome -> quando foi podado (uma vez por dia por arquivo)

    def anexar(self, chave: str, direcao: str, quando: float, texto: str = "", id_msg=None, papel=None) -> bool:
        """True se a linha foi gravada (ou melhorou a que estava: ver melhora_o_audio); False se já estava lá,
        se a chave/direção não serve ou se falhou. `papel`: 'recepcao' | 'robo' (ausente = gente)."""
        try:
            return self._anexar(chave, direcao, quando, texto, id_msg, papel)
        except Exception as e:  # noqa: BLE001 — nunca derruba o laço do observador
            log(f"conversa não gravada ({mascarar(str(chave))}): {type(e).__name__}: {e}"[:300])
            return False

    @contextmanager
    def _trava(self):
        if fcntl is None:
            yield
            return
        fd = os.open(self.pasta / ".trava", os.O_WRONLY | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)  # fechar solta o flock

    def _anexar(self, chave, direcao, quando, texto, id_msg, papel=None) -> bool:
        nome = nome_da_conversa(chave)
        if not nome or direcao not in ("entrada", "saida"):
            return False
        self.pasta.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            os.chmod(self.pasta, 0o700)
        except OSError:
            pass
        linha = {"em": iso_utc(quando), "direcao": direcao, "texto": str(texto or "")[:MAX_TEXTO_NA_CONVERSA],
                 "origem": self.origem}
        if id_msg:
            linha["id"] = str(id_msg)[:200]
        if papel in ("recepcao", "robo"):
            linha["papel"] = papel
        arquivo = self.pasta / f"{nome}.jsonl"
        with self._trava():
            existentes = self._ler(arquivo)
            igual = next((k for k, e in enumerate(existentes) if self._mesma(linha, e)), None)
            if igual is not None:
                velha = existentes[igual]
                # Corrida das duas instâncias (17/10/2026): a do número pessoal grava o "[áudio]" da bridge e a do
                # PRUMO chega depois com a transcrição, com o MESMO id. Sem isto a segunda era descartada e a
                # conversa ficava com o áudio mudo. Só melhora: texto de gente nunca é trocado.
                if not (linha.get("id") and velha.get("id") == linha["id"] and melhora_o_audio(velha.get("texto"), linha["texto"])):
                    return False
                existentes[igual] = {**velha, "texto": linha["texto"], "origem": linha["origem"]}
                self._regravar(arquivo, existentes)
                return True
            if self.relogio() - self.podado.get(nome, 0.0) >= PODAR_A_CADA_S:
                self.podado[nome] = self.relogio()
                self._podar(arquivo, existentes)
            # ensure_ascii: U+2028/U+2029 no texto do lead não quebram a linha para quem lê com splitlines().
            dados = (json.dumps(linha, ensure_ascii=True) + "\n").encode("utf-8")
            fd = os.open(arquivo, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            try:
                os.write(fd, dados)  # uma escrita por linha, com O_APPEND
            finally:
                os.close(fd)
        return True

    def linhas_de(self, chave) -> list[dict]:
        """A conversa gravada de um lead (para o contexto do classificador); [] sem arquivo ou com erro."""
        nome = nome_da_conversa(chave)
        if not nome:
            return []
        try:
            return self._ler(self.pasta / f"{nome}.jsonl")
        except OSError:
            return []

    def texto_de(self, chave, id_msg) -> str | None:
        """O texto gravado da mensagem com este id (None sem id, sem arquivo ou sem a linha). Na releitura do
        .lendo depois de um reinício, a transcrição que já entrou na conversa não é paga de novo."""
        if not id_msg:
            return None
        return next((str(l.get("texto") or "") for l in self.linhas_de(chave) if l.get("id") == str(id_msg)[:200]), None)

    @staticmethod
    def _ler(arquivo: Path) -> list[dict]:
        try:
            bruto = arquivo.read_text(encoding="utf-8", errors="replace")
        except FileNotFoundError:
            return []
        linhas = []
        for texto in bruto.splitlines():
            try:
                d = json.loads(texto)
            except ValueError:
                continue
            if isinstance(d, dict):
                linhas.append(d)
        return linhas

    @staticmethod
    def _mesma(nova: dict, velha: dict) -> bool:
        if nova.get("id") and velha.get("id"):
            return nova["id"] == velha["id"]
        # Um dos lados sem id (bridge antiga, ou a mesma mensagem por outro caminho): direção, hora e texto.
        return all(nova.get(k) == velha.get(k) for k in ("direcao", "em", "texto"))

    def _podar(self, arquivo: Path, existentes: list[dict]) -> None:
        """Tira o que passou de 120 dias (e linha ilegível); troca atômica, 600. Nada a tirar = não regrava."""
        if not existentes and not arquivo.exists():
            return
        limite = self.relogio() - GUARDAR_CONVERSA_S
        ficam = [e for e in existentes if (t := _instante_iso(e.get("em"))) is not None and t >= limite]
        try:
            total = sum(1 for l in arquivo.read_text(encoding="utf-8", errors="replace").splitlines() if l.strip())
        except FileNotFoundError:
            return
        if len(ficam) == total:
            return
        self._regravar(arquivo, ficam)
        existentes[:] = ficam

    @staticmethod
    def _regravar(arquivo: Path, linhas: list[dict]) -> None:
        """Troca atômica do arquivo inteiro, 600 (poda e áudio que ganhou a transcrição)."""
        tmp = arquivo.with_name(f".{arquivo.name}.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write("".join(json.dumps(e, ensure_ascii=True) + "\n" for e in linhas).encode("utf-8"))
        os.replace(tmp, arquivo)


class Observador:
    """O que o leitor lembra entre linhas. `chamar`, `avisar` e `relogio` entram de fora nos testes."""

    def __init__(self, chaves: set[str], chamar=http, avisar=avisar_pelo_hermes, relogio=time.time,
                 telefone=telefone_do_chat, bridge_js: Path = BRIDGE_JS, pasta: Path | None = None,
                 conversas: "Conversas | Path | None" = None, ler_plus=None, transcritor: "Transcritor | None" = None):
        agora = relogio()
        self.chaves = chaves
        # Os do Plus (OT-13): só conversa em disco, nunca n8n. `ler_plus` None = sem Plus (os testes não leem
        # o arquivo de verdade); o main passa ler_chaves_do_plus.
        self.ler_plus = ler_plus
        self.chaves_plus: set[str] = set()
        self.reler_plus()
        # A conversa de cada lead em disco (ver o topo); os testes passam uma pasta temporária.
        self.conversa = conversas if isinstance(conversas, Conversas) else Conversas(conversas or CONVERSAS, relogio=relogio)
        # leads.json (para a bridge) e respostas.jsonl (da bridge) moram junto da posição.
        self.pasta = pasta or POSICAO.parent
        # Áudio de lead -> texto (17/10/2026); o teto do dia mora na mesma pasta (transcricoes.json).
        self.transcritor = transcritor or Transcritor(self.pasta, relogio=relogio)
        # chave -> {"mensagens": [{"em", "texto", "papel"?}], "ultima": instante, "ids", "desde", "ate"}:
        # juntando até a conversa parar (ids/desde/ate só servem ao contexto e não vão ao n8n).
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
        if not chave or chave not in self.todas:
            return
        if tipo == "saida" and not ev.get("id"):
            # Bridge sem o remendo de 16/10 (owner_sent sem id, e nenhum enviadas.jsonl): a conversa ganha a
            # linha sem texto. Com o id, quem grava a saída é ler_enviadas(), com o texto.
            self.conversa.anexar(chave, "saida", quando, "")
        if chave not in self.chaves:
            return  # só Plus: a conversa basta, o n8n não tem planilha onde marcar
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

    @property
    def todas(self) -> set[str]:
        """O filtro da bridge e da conversa em disco: os números das planilhas mais os do Plus."""
        return self.chaves | self.chaves_plus

    def reler_plus(self) -> None:
        if self.ler_plus is None:
            return
        try:
            novas = set(self.ler_plus())
        except Exception as e:  # noqa: BLE001 — mantém a lista anterior
            log("não consegui reler os números do Plus:", e)
            return
        if len(novas) != len(self.chaves_plus):
            log(f"{len(novas)} número(s) do Plus no filtro")
        self.chaves_plus = novas

    def reler_numeros(self) -> None:
        agora = self.relogio()
        self.reler_plus()
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
            tmp.write_text(json.dumps(sorted(self.todas)))
            tmp.chmod(0o600)
            tmp.replace(self.pasta / "leads.json")
        except OSError as e:
            log("lista de leads não gravada para a bridge:", e)

    def _abrir(self, nome: str) -> tuple[list[str], Path | None]:
        """Tira <nome>.jsonl do caminho (a bridge abre o arquivo a cada linha e cria outro) e lê, SEM apagar:
        o <nome>.lendo.jsonl só sai em _concluir, depois que o lote foi processado (revisão de 17/10/2026; antes
        ele era apagado antes da transcrição, que leva até ~50 s por áudio, e um reinício nesse meio perdia o
        resto do lote). Um <nome>.lendo.jsonl que sobrou de uma parada no meio é lido primeiro."""
        arquivo, lendo = self.pasta / f"{nome}.jsonl", self.pasta / f"{nome}.lendo.jsonl"
        try:
            if not lendo.exists():
                if not arquivo.exists() or arquivo.stat().st_size == 0:
                    return [], None
                arquivo.replace(lendo)
            return lendo.read_text(encoding="utf-8", errors="replace").splitlines(), lendo
        except OSError as e:
            log(f"{nome} não lidas:", e)
            return [], None

    @staticmethod
    def _concluir(lendo: Path | None) -> None:
        if lendo is None:
            return
        try:
            lendo.unlink()
        except FileNotFoundError:
            pass
        except OSError as e:
            log(f"{lendo.name} não apagado:", e)

    def _tirar_e_ler(self, nome: str) -> list[str]:
        """_abrir + _concluir de uma vez: para o que é processado sem espera (enviadas.jsonl)."""
        linhas, lendo = self._abrir(nome)
        self._concluir(lendo)
        return linhas

    def ler_enviadas(self) -> None:
        """enviadas.jsonl ({chave, ts, texto, id}: o que o Rômulo escreveu a um lead, do remendo da bridge
        ou do evolution-adaptador) vira a linha "saida" da conversa. Não vai ao n8n: o envio já foi
        marcado pela linha owner_sent do log."""
        agora = self.relogio()
        for texto in self._tirar_e_ler("enviadas"):
            try:
                r = json.loads(texto)
                chave, msg = str(r["chave"]), str(r.get("texto") or "").strip()
            except (ValueError, KeyError, TypeError, AttributeError):
                continue
            if chave not in self.todas:
                continue
            self.conversa.anexar(chave, "saida", self._hora_vista(r.get("ts"), agora), msg, r.get("id"))

    def ler_respostas(self, ouvir: bool = True) -> None:
        """Lê o respostas.jsonl da bridge e junta as mensagens de cada lead, em três passos (revisão de 17/10/2026):
        1. a conversa em disco recebe TODAS as linhas primeiro, texto e marcador de áudio como chegaram;
        2. só então os áudios são transcritos (a linha do marcador é trocada pela transcrita, mesmo id);
        3. o lote do n8n é montado e o .lendo é apagado (_concluir).
        Um reinício no meio da transcrição relê o .lendo no próximo início: o passo 1 não duplica (id, ou direção,
        hora e texto) e a transcrição já gravada é reaproveitada, sem gastar cota. `ouvir=False` (saída do serviço):
        com áudio por transcrever, faz só o passo 1 e deixa o .lendo para o próximo início, que monta o lote uma vez.

        Áudio sem `audio` no registro (a bridge do Hermes, que só tem o "[áudio]"): a conversa grava o marcador,
        mas lote SÓ de marcadores assim não vai ao n8n (fechar_conversas). Quem responde pelo áudio é a instância
        que o recebeu da Evolution: com a transcrição, ou, se ela não sair, com o marcador, uma vez. Assim cada
        áudio dá no máximo um aviso ("ouça no WhatsApp" gastava um dos 2 avisos de 6 h antes do lote transcrito)."""
        linhas, lendo = self._abrir("respostas")
        if not linhas:
            self._concluir(lendo)
            return
        agora = self.relogio()
        registros: list[list] = []  # [chave, texto, registro, quando]
        for texto in linhas:
            try:
                r = json.loads(texto)
                chave, msg = str(r["chave"]), str(r["texto"]).strip()
            except (ValueError, KeyError, TypeError):
                continue
            # A lista pode ter mudado entre a bridge gravar e agora; quem saiu dela fica de fora.
            if chave not in self.todas or not msg:
                continue
            registros.append([chave, msg, r, self._hora_vista(r.get("ts"), agora)])
        # 1. Conversa em disco primeiro: uma parada durante a transcrição não perde o que veio junto.
        for chave, msg, r, quando in registros:
            self.conversa.anexar(chave, "entrada", quando, msg, r.get("id"), papel_da_mensagem(msg))
        por_ouvir = [x for x in registros if isinstance(x[2].get("audio"), dict) and so_marcador_de_audio(x[1])]
        if por_ouvir and not ouvir:
            log(f"{len(por_ouvir)} áudio(s) por transcrever: o lote fica para o próximo início")
            return  # o .lendo fica
        # 2. Transcrição (até ~50 s por áudio): troca o marcador pela transcrita na conversa.
        for x in por_ouvir:
            chave, msg, r, quando = x
            ja = self.conversa.texto_de(chave, r.get("id"))
            novo = ja if ja and melhora_o_audio(msg, ja) and not so_marcador_de_audio(ja) else self._ouvir(chave, msg, r["audio"])
            if novo != msg:
                self.conversa.anexar(chave, "entrada", quando, novo, r.get("id"), papel_da_mensagem(novo))
            x[1] = novo
        # 3. O lote do n8n (só de quem está numa planilha; o Plus fica só na conversa, ver o topo).
        for chave, msg, r, quando in registros:
            if chave not in self.chaves:
                continue
            papel = papel_da_mensagem(msg)
            sem_ouvinte = so_marcador_de_audio(msg) and not isinstance(r.get("audio"), dict)
            c = self.conversas.setdefault(chave, {"mensagens": [], "ultima": agora, "ids": [], "desde": quando, "ate": quando,
                                                  "so_audio_sem_ouvinte": True})
            if len(c["mensagens"]) < MAX_MENSAGENS_POR_CONVERSA:
                c["mensagens"].append({"em": iso(quando), "texto": msg[:1000], **({"papel": papel} if papel else {})})
                c["so_audio_sem_ouvinte"] = c.get("so_audio_sem_ouvinte", True) and sem_ouvinte
            if r.get("id"):
                c["ids"].append(str(r["id"]))
            c["desde"], c["ate"] = min(c["desde"], quando), max(c["ate"], quando)
            c["ultima"] = agora
        self._concluir(lendo)

    def _ouvir(self, chave: str, marcador: str, audio: dict) -> str:
        """O marcador com a transcrição, ou só o marcador. O journal leva o motivo, nunca o texto."""
        try:
            texto, motivo = self.transcritor.transcrever(audio)
        except Exception as e:  # noqa: BLE001 — um transcritor quebrado não derruba o laço
            texto, motivo = None, motivo_do_erro(e)
        if texto:
            log(f"áudio de {mascarar(chave)} transcrito ({len(texto)} caracteres)")
            return texto_com_transcricao(marcador, texto)
        log(f"áudio de {mascarar(chave)} sem transcrição: {motivo}")
        return marcador

    def fechar_conversas(self, todas: bool = False) -> None:
        agora = self.relogio()
        for chave in [k for k, c in self.conversas.items() if todas or agora - c["ultima"] >= ESPERA_DA_CONVERSA_S]:
            c = self.conversas.pop(chave)
            if c["mensagens"] and c.get("so_audio_sem_ouvinte"):
                # Só "[áudio]" que esta instância não tem como ouvir (bridge do Hermes): quem manda ao n8n é a
                # instância do PRUMO, transcrito ou, se não sair, o marcador uma vez (ver ler_respostas).
                log(f"lote só de áudio sem ouvinte de {mascarar(chave)}: fica com a instância que o recebeu")
                continue
            pronta = {"chave": chave, "mensagens": c["mensagens"]}
            # Contexto (17/10/2026): sem a pergunta do Rômulo, o "sim" a "posso mandar o vídeo?" virava interesse.
            try:
                contexto = contexto_da_conversa(self.conversa.linhas_de(chave), c.get("ids", []),
                                                c.get("desde", agora), c.get("ate", agora))
            except Exception as e:  # noqa: BLE001 — sem contexto a conversa vai como antes
                log(f"contexto de {mascarar(chave)} não lido: {type(e).__name__}")
                contexto = {}
            if contexto:
                pronta["contexto"] = contexto
            self.conversas_prontas.append(pronta)

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
        self.ler_enviadas()
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
    obs = Observador(chaves, ler_plus=ler_chaves_do_plus)
    log(f"acompanhando {LOG_DA_BRIDGE}; conversas dos leads em {obs.conversa.pasta} (origem {obs.conversa.origem})")
    try:
        return acompanhar(obs, onde)
    finally:
        obs.avisar_lote()  # parar o serviço não engole o aviso
        # Nem a conversa que ainda estava juntando; sem transcrever (o systemd não espera ~50 s por áudio): com
        # áudio pendente, a conversa em disco recebe o marcador e o .lendo fica para o próximo início.
        obs.ler_respostas(ouvir=False)
        obs.ler_enviadas()
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
            if silencio_suspeito(agora, ultima_linha, silencio_avisado):
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
