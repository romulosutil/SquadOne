#!/usr/bin/env python3
"""Move as pastas do Site antes da venda conforme a planilha (Dell).

O n8n não move diretórios (mesmo motivo do auto-entrada). Dois pedidos chegam
aqui, e o site-pastas.path dispara este script quando qualquer um aparece:

1. A cada hora o Balcão grava em ~/.local/share/n8n-estado/site-pastas.json o
   que mudou de lugar:
   - respondeu no WhatsApp (respondeu_em a partir de 29/09/2026) -> _em-conversa/;
   - expirado (10 dias sem resposta, enviados a partir de 29/09/2026) -> _concluidos/.
   Só tira pasta da raiz (ou de _concluidos/ para _em-conversa/, quando um
   expirado responde).

2. Desde 30/09/2026, os botões da página do lead (fluxo "07 · Lead", link
   /webhook/lead?id=) gravam um pacote por toque em
   ~/.local/share/n8n-estado/site-acoes/*.json:
       {"place_id", "acao": "recusou"|"fechou"|"desfazer", "nome", "em", "status"}
   - recusou -> _recusados/; fechou -> _fechados/ (de onde a pasta estiver:
     raiz, _em-conversa, _concluidos, _recusados ou _fechados);
   - desfazer -> volta para onde estava antes do último recusou/fechou (pilha
     em ~/.local/state/site-pastas/acoes.json); sem histórico (recusa anotada à
     mão antes do link), vai para _em-conversa/: quem recusou tinha respondido.
   Cada mudança feita por pacote ganha uma linha no registro.md ("**Recusou.**",
   "**Fechou.**", "**Recusa desfeita.**"...) e acorda o site-demos-pausa, que
   põe de volta no ar o demo de quem voltou. Pacote lido é apagado (o gatilho é
   "diretório não vazio"); pacote ilegível vai para ~/.local/share/site-acoes-erro/.
   - gerar_demo (14/10/2026, demo sob pedido): o lead recebeu só o Raio-X e o
     Rômulo pediu o demo. Não move nada: grava PEDIDO-DEMO.json na pasta (onde ela
     estiver) e acorda o gerador-de-sites-pedido.service. Lead que já tem demo
     (site_url no publicado.json) ou pedido aberto: nada muda.

Sempre: só mexe na pasta se o publicado.json dela tem o mesmo place_id e nunca
sobrescreve destino. _descartados/ nunca entra.

Uso: site-pastas [--listar]   (--listar mostra o que faria, sem mover nem apagar pacote)
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

HOME = Path.home()
AUTO = HOME / "auto-site"
REGISTRO = AUTO / "registro.md"
PEDIDO = HOME / ".local/share/n8n-estado/site-pastas.json"
ACOES = HOME / ".local/share/n8n-estado/site-acoes"
# Fora da pasta de pacotes: o gatilho é "diretório não vazio", e um erro/ ali
# dentro o dispararia em loop (mesmo motivo do auto-entrada).
ERRO = HOME / ".local/share/site-acoes-erro"
PILHA = HOME / ".local/state/site-pastas/acoes.json"
FILA_AVISOS = HOME / ".local/share/avisos/fila"
SLUG = re.compile(r"^[a-z0-9][a-z0-9._-]{0,179}$")
# Pedido do Balcão (respondeu, expirado).
ORIGENS = {"", "_concluidos"}
DESTINOS = {"_em-conversa", "_concluidos"}
# Botões da página do lead: onde uma pasta de lead publicado pode morar.
LUGARES = ["", "_em-conversa", "_concluidos", "_recusados", "_fechados"]
DESTINO_DA_ACAO = {"recusou": "_recusados", "fechou": "_fechados"}
REGISTRO_DA_ACAO = {"recusou": "**Recusou.**", "fechou": "**Fechou.**"}
DESFEITO = {"_recusados": "**Recusa desfeita.**", "_fechados": "**Fechamento desfeito.**"}
# Demo sob pedido (14/10/2026): o gerador-de-sites --pedidos lê este arquivo na pasta do lead.
PEDIDO_DEMO = "PEDIDO-DEMO.json"
# Recusado ou fechado não pede demo: quem recusou não quer, quem fechou já está no projeto.
SEM_PEDIDO = {"_recusados", "_fechados"}


def separar(relativo: str) -> tuple[str, str] | None:
    """"slug" -> ("", slug); "_concluidos/slug" -> ("_concluidos", slug); o resto não vale."""
    partes = str(relativo or "").split("/")
    if len(partes) == 1:
        partes = ["", partes[0]]
    if len(partes) != 2 or not SLUG.match(partes[1]):
        return None
    return partes[0], partes[1]


def recibo(pasta: Path) -> dict:
    try:
        d = json.loads((pasta / "publicado.json").read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def place_id_de(pasta: Path) -> str:
    return str(recibo(pasta).get("place_id") or "")


def rotulo(topo: str) -> str:
    return f"`{topo}/`" if topo else "raiz"


# A lib de aviso (deploy/dell/lib/aviso.py, 11/10/2026): no repo, em lib/ ao
# lado deste arquivo; no Dell, instalada em ~/.local/lib/mel/ (instalados.json).
# Primeiro a do repo, para o teste nunca pegar uma cópia instalada.
PASTAS_DA_LIB = [Path(__file__).resolve().parent / "lib", HOME / ".local/lib/mel"]


def lib_de_aviso():
    """O módulo da lib, ou None quando nenhuma cópia existe ou carrega: aí o
    avisar() volta ao jeito antigo e o aviso sai do mesmo modo que antes."""
    for pasta in PASTAS_DA_LIB:
        arquivo = pasta / "aviso.py"
        if not arquivo.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", arquivo)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception:  # noqa: BLE001 — cópia quebrada não derruba a rodada: tenta a próxima
            continue
    return None


def avisar(texto: str) -> None:
    aviso = {"titulo": "🌐 Sites", "texto": texto, "origem": "site-pastas"}
    lib = lib_de_aviso()
    if lib is not None:
        # Valida, grava atômico, não cria a pasta da fila e nunca levanta (quem
        # chama está dentro de um `except`): o que não foi gravado vai ao journal.
        # O texto leva a mensagem da exceção; se ela trouxer "R$" a lib recusaria
        # o aviso inteiro, e perder o aviso é pior que mandá-lo sem o valor.
        if lib.VALOR_EM_REAIS.search(texto):
            aviso["texto"] = lib.sem_valores(texto)
        lib.gravar(aviso, fila=FILA_AVISOS, prefixo="site-pastas")
        return
    # Sem a lib instalada: o jeito de antes, sem mudar nada.
    FILA_AVISOS.mkdir(parents=True, exist_ok=True)
    (FILA_AVISOS / f"site-pastas-{time.time_ns()}.json").write_text(json.dumps(aviso, ensure_ascii=False), encoding="utf-8")


def pedido_do_balcao(listar: bool) -> int | None:
    """Pastas movidas; None quando o pedido está ilegível."""
    try:
        pedido = json.loads(PEDIDO.read_text(encoding="utf-8"))
    except OSError:
        print(f"sem pedido em {PEDIDO}")
        return 0
    except ValueError as e:
        print(f"{PEDIDO} ilegível: {e}")
        return None
    movidas = 0
    for m in pedido.get("mover", []):
        de, para = separar(m.get("de")), separar(m.get("para"))
        nome = m.get("nome") or m.get("place_id")
        if not de or not para or de[0] not in ORIGENS or para[0] not in DESTINOS or de[1] != para[1] or de[0] == para[0]:
            print(f"ignorado (caminho fora da regra): {m.get('de')} -> {m.get('para')}")
            continue
        origem, destino = AUTO / de[0] / de[1], AUTO / para[0] / para[1]
        if not origem.is_dir():
            continue  # já foi movida (o pedido se repete a cada hora até a planilha mudar)
        if place_id_de(origem) != m.get("place_id"):
            print(f"ignorado (place_id não bate com o publicado.json): {origem.relative_to(AUTO)}")
            continue
        if destino.exists():
            print(f"ignorado (destino já existe): {destino.relative_to(AUTO)}")
            continue
        if listar:
            print(f"moveria {origem.relative_to(AUTO)} -> {destino.relative_to(AUTO)} ({nome}: {m.get('motivo')})")
            continue
        destino.parent.mkdir(exist_ok=True)
        origem.rename(destino)
        movidas += 1
        print(f"movida {origem.relative_to(AUTO)} -> {destino.relative_to(AUTO)} ({nome}: {m.get('motivo')})")
    return movidas


# ---------------------------------------------------------------- botões da página do lead

def achar_pasta(place_id: str) -> tuple[str, Path] | None:
    """(topo, pasta) do lead publicado com este place_id, fora de _descartados/."""
    for topo in LUGARES:
        for recibo_ in sorted((AUTO / topo).glob("*/publicado.json")) if (AUTO / topo).is_dir() else []:
            pasta = recibo_.parent
            if pasta.name.startswith((".", "_")) or not SLUG.match(pasta.name):
                continue
            if place_id_de(pasta) == place_id:
                return topo, pasta
    return None


def ler_pilha() -> dict:
    try:
        d = json.loads(PILHA.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def gravar_pilha(pilha: dict) -> None:
    PILHA.parent.mkdir(parents=True, exist_ok=True)
    tmp = PILHA.with_suffix(".tmp")
    tmp.write_text(json.dumps(pilha, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(PILHA)


def anotar_registro(pasta: Path, nome: str, texto: str) -> None:
    """Uma linha na tabela do registro.md, no formato das outras (Data | Lead | Slug | URL | Decisão)."""
    r = recibo(pasta)
    celula = lambda t: str(t or "—").replace("|", "/").replace("\n", " ").strip()
    linha = (f"| {datetime.now():%d/%m/%Y} | {celula(r.get('nome') or nome)} | {pasta.name} | "
             f"{celula(r.get('site_url'))} | {celula(texto)} |\n")
    atual = REGISTRO.read_text(encoding="utf-8") if REGISTRO.exists() else ""
    with REGISTRO.open("a", encoding="utf-8") as f:
        f.write(("" if not atual or atual.endswith("\n") else "\n") + linha)


def uma_acao(pacote: dict, pilha: dict, listar: bool) -> str:
    """Aplica um pacote. Devolve o que aconteceu (para o log); levanta ValueError se o pacote não vale."""
    pid, acao = str(pacote.get("place_id") or ""), str(pacote.get("acao") or "")
    nome = str(pacote.get("nome") or pid)
    if not pid or acao not in ("recusou", "fechou", "desfazer", "gerar_demo"):
        raise ValueError(f"pacote sem place_id ou com ação desconhecida: {acao!r}")
    achada = achar_pasta(pid)
    if not achada:
        return f"{nome}: sem pasta publicada (nada a mover)"
    topo, origem = achada
    if acao == "gerar_demo":
        return pedir_demo(topo, origem, nome, pacote, listar)
    historico = pilha.get(pid) or []
    if acao == "desfazer":
        if historico:
            para, desfeita = historico[-1]["de"], historico[-1]["acao"]
        elif topo in ("_recusados", "_fechados"):
            para, desfeita = "_em-conversa", "recusou" if topo == "_recusados" else "fechou"
        else:
            return f"{nome}: nada a desfazer na pasta ({rotulo(topo)})"
        texto = (DESFEITO.get(DESTINO_DA_ACAO[desfeita], "**Desfeito.**")
                 + f" Pelo link do lead em {datetime.now():%d/%m %H:%M}: pasta de {rotulo(topo)} para {rotulo(para)}"
                 + (f"; na planilha, status \"{pacote['status']}\"." if pacote.get("status") else "."))
    else:
        para = DESTINO_DA_ACAO[acao]
        texto = (REGISTRO_DA_ACAO[acao] + f" Rômulo marcou pelo link do lead em {datetime.now():%d/%m %H:%M}; "
                 f"pasta de {rotulo(topo)} para {rotulo(para)}. Nada foi enviado ao lead.")
    if para == topo:
        if acao == "desfazer" and historico and not listar:
            historico.pop()  # alguém já devolveu a pasta à mão: o histórico acompanha
            pilha[pid] = historico
            if not historico:
                pilha.pop(pid, None)
        return f"{nome}: já está em {rotulo(topo)}"
    destino = AUTO / para / origem.name
    if destino.exists():
        raise ValueError(f"destino já existe: {destino.relative_to(AUTO)}")
    if listar:
        return f"moveria {origem.relative_to(AUTO)} -> {destino.relative_to(AUTO)} ({nome}: {acao})"
    destino.parent.mkdir(exist_ok=True)
    origem.rename(destino)
    if acao == "desfazer":
        if historico:
            historico.pop()
    else:
        historico.append({"acao": acao, "de": topo, "para": para, "em": pacote.get("em") or datetime.now().astimezone().isoformat()})
    if historico:
        pilha[pid] = historico
    else:
        pilha.pop(pid, None)
    anotar_registro(destino, nome, texto)
    return f"movida {origem.relative_to(AUTO)} -> {destino.relative_to(AUTO)} ({nome}: {acao})"


def pedir_demo(topo: str, pasta: Path, nome: str, pacote: dict, listar: bool) -> str:
    """O toque "Gerar demo": grava o pedido na pasta, sem movê-la. O resultado começa com
    "pedido" só quando um pedido novo foi gravado (é o que acorda o gerador)."""
    if str(recibo(pasta).get("site_url") or "").startswith("https://"):
        return f"{nome}: já tem demo ({recibo(pasta)['site_url']}); nada pedido"
    if topo in SEM_PEDIDO:
        return f"{nome}: pasta em {rotulo(topo)}; demo não é pedido para quem recusou ou fechou"
    if (pasta / PEDIDO_DEMO).exists():
        return f"{nome}: o demo já foi pedido ({rotulo(topo)}); o gerador está nele"
    if listar:
        return f"pediria o demo de {pasta.relative_to(AUTO)} ({nome})"
    em = str(pacote.get("em") or datetime.now().astimezone().isoformat())
    tmp = pasta / f".{PEDIDO_DEMO}.tmp"
    tmp.write_text(json.dumps({"place_id": pacote.get("place_id"), "em": em, "origem": "botão Gerar demo"},
                              ensure_ascii=False), encoding="utf-8")
    tmp.replace(pasta / PEDIDO_DEMO)
    anotar_registro(pasta, nome, f"**Demo pedido.** Rômulo pediu pelo link do lead em {datetime.now():%d/%m %H:%M}; "
                                 "o gerador faz o site agora. Nada foi enviado ao lead.")
    return f"pedido o demo de {pasta.relative_to(AUTO)} ({nome})"


def ler_pacote(arq: Path):
    """O gatilho pode chegar entre o n8n criar o arquivo e terminar de gravar: pacote novo e ilegível ganha 3 s."""
    for _ in range(3):
        try:
            return json.loads(arq.read_text(encoding="utf-8"))
        except ValueError:
            if time.time() - arq.stat().st_mtime > 10:
                raise
            time.sleep(1)
    return json.loads(arq.read_text(encoding="utf-8"))


def botoes_da_pagina(listar: bool) -> int:
    if not ACOES.is_dir():
        return 0
    pilha, movidas, pedidos = ler_pilha(), 0, 0
    for arq in sorted(ACOES.glob("*.json")):
        try:
            pacote = ler_pacote(arq)
            if not isinstance(pacote, dict):
                raise ValueError("não é um objeto JSON")
            resultado = uma_acao(pacote, pilha, listar)
            print(resultado)
            if listar:
                continue
            gravar_pilha(pilha)
            movidas += resultado.startswith("movida")
            pedidos += resultado.startswith("pedido")
            arq.unlink()
        except (OSError, ValueError, KeyError) as e:
            print(f"pacote {arq.name} recusado: {e}")
            if listar:
                continue
            ERRO.mkdir(parents=True, exist_ok=True)
            arq.replace(ERRO / arq.name)
            avisar(f"Botão da página do lead não moveu a pasta ({arq.name}): {e}. "
                   "A planilha já mudou; confira a pasta em ~/auto-site.")
    if movidas:
        # Quem voltou (Desfazer) tem o demo de volta no ar sem esperar a rodada diária.
        subprocess.run(["systemctl", "--user", "start", "--no-block", "site-demos-pausa.service"],
                       capture_output=True, timeout=30, check=False)
    if pedidos:
        # O gerador espera a trava de uma execução em andamento; --no-block: o n8n não fica preso nisto.
        subprocess.run(["systemctl", "--user", "start", "--no-block", "gerador-de-sites-pedido.service"],
                       capture_output=True, timeout=30, check=False)
    return movidas


def main() -> int:
    listar = "--listar" in sys.argv
    do_balcao = pedido_do_balcao(listar)
    movidas = (do_balcao or 0) + botoes_da_pagina(listar)
    if movidas:
        print(f"{movidas} pasta(s) movida(s)")
    return 1 if do_balcao is None else 0


if __name__ == "__main__":
    sys.exit(main())
