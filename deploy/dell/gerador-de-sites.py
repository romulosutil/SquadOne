#!/usr/bin/env python3
"""Esteira "Site antes da venda" no Dell: gera os sites da fila sem o PC ligado.

Porte do `executar-fila-leads.ps1` (G:\\Meu Drive\\auto), que só rodava com o PC
ligado às 08h e não gerava nada automático desde 17/09/2026. A pasta é a mesma
(`~/auto-site`; o espelho no Drive, pelo PC, parou em 25/09/2026), e o contrato
também:

- fila = pasta sem `.`/`_` no começo, com `content.md` e sem `publicado.json`,
  mais antiga primeiro pela data do `content.md`;
- o Claude roda `/lead-novo <slug>` com contexto limpo e publica sozinho; se ele
  deixou um `index.html` completo (fecha em `</html>`) sem recibo, este runner
  publica na Vercel e escreve o `publicado.json` com a URL REAL da linha
  "Aliased:" — URL montada à mão poderia não existir e o n8n mandaria link morto;
- sucesso = `publicado.json` com `site_url` que responde HTTP 200.

Diferenças de propósito em relação ao PS1:
- lead com 2 falhas registradas em `falha.log` sai da fila (o PS1 insistia todo
  dia nos mesmos leads quebrados); apagar o `falha.log` devolve o lead;
- `index.html` truncado não é apagado: é renomeado para `index.truncado.html`,
  para o próximo Claude recomeçar sem perder a evidência;
- trava em `.logs/gerador.lock` (com host e pid): se o PC ainda rodar a tarefa
  antiga, os dois não pegam o mesmo lead ao mesmo tempo;
- lead que o Claude tira da raiz no meio da geração (duplicado ou que já tem
  site vai para `_descartados/`) é resultado legítimo, não falha: fica no log
  e no resumo, e a fila segue. Nenhum erro de um lead derruba o lote (29/09/2026:
  um `falha.log` na pasta que o Claude tinha movido matou a execução inteira).

Sinais na raiz da pasta, como no PS1: `.parar` encerra a execução no fim do
lead atual. O `.logs/status.json` continua sendo o que a Central lê.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
from pathlib import Path

AUTO = Path(os.environ.get("AUTO_DIR", str(Path.home() / "auto-site")))
LOGS = AUTO / ".logs"
LOG_FILA = LOGS / "execucao-fila.log"
STATUS = LOGS / "status.json"
TRAVA = LOGS / "gerador.lock"
SINAL_PARAR = AUTO / ".parar"
VERCEL_SCOPE = os.environ.get("VERCEL_SCOPE", "romulodesigns")
MAX_FALHAS = 2
# TimeoutStartSec=4h no .service: não começa lead que pode estourar o teto (com
# folga para o deploy do último), senão o systemd mata a execução no meio.
TETO_MIN = 4 * 60 - 20
PROMPT = (
    "/lead-novo {slug} com mais movimento, usando as fotos e recursos extras; cumpra o passo 1.6.1: "
    "selecione uma referencia em styles.refero.design, copie o DESIGN.md para a pasta do lead e registre a referencia"
)
LIMITE_DE_USO = re.compile(r"(?i)(rate limit|usage limit|\b429\b)")


def agora() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(msg: str, nivel: str = "INFO", arquivo: Path | None = None) -> None:
    linha = f"[{agora()}] [{nivel}] {msg}"
    print(linha, flush=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    for alvo in {LOG_FILA, arquivo} - {None}:
        with open(alvo, "a", encoding="utf-8") as f:
            f.write(linha + "\n")


def avisar(texto: str) -> None:
    """Aviso pelo WhatsApp: a fila que o dell-status repassa ao Hermes."""
    try:
        fila_de_avisos = Path.home() / ".local/share/avisos/fila"
        fila_de_avisos.mkdir(parents=True, exist_ok=True)
        (fila_de_avisos / f"gerador-{int(time.time())}.json").write_text(
            json.dumps({"titulo": "🌐 Gerador de sites", "texto": texto}, ensure_ascii=False), encoding="utf-8")
    except OSError as e:
        log(f"Aviso não gravado: {e}", "ERRO")


def gravar_status(estado: dict) -> None:
    # Informativo (a Central lê); nunca derruba a execução.
    try:
        tmp = STATUS.with_suffix(".tmp")
        tmp.write_text(json.dumps(estado, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(STATUS)
    except OSError:
        pass


def falhas_registradas(pasta: Path) -> int:
    try:
        texto = (pasta / "falha.log").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0
    return sum(1 for linha in texto.splitlines() if linha.strip())


def fila() -> list[Path]:
    leads = []
    for p in AUTO.iterdir():
        if not p.is_dir() or p.name.startswith((".", "_")):
            continue
        try:
            if not (p / "content.md").is_file() or (p / "publicado.json").exists():
                continue
            if falhas_registradas(p) >= MAX_FALHAS:
                continue
            leads.append(((p / "content.md").stat().st_mtime, p.name, p))
        except OSError:
            continue  # a pasta mudou de lugar durante a listagem (o Claude move leads)
    return [p for _, _, p in sorted(leads)]


def paradeiro(pasta: Path) -> Path | None:
    """Onde foi parar um lead que saiu da raiz durante a geração: o Claude move
    duplicados e leads que já têm site para `_descartados/` (regras do CLAUDE.md
    da pasta). None = sumiu (renomeado ou apagado)."""
    candidatos = [AUTO / "_descartados" / pasta.name] + sorted(AUTO.glob(f"_*/{pasta.name}"))
    return next((d for d in candidatos if d.is_dir()), None)


def html_completo(caminho: Path) -> bool:
    if not caminho.is_file():
        return False
    return bool(re.search(r"(?is)</html>\s*$", caminho.read_text(encoding="utf-8", errors="replace")))


def registrar_falha(pasta: Path, motivo: str, log_lead: Path) -> None:
    # Nunca derruba o lote: sem a pasta (ou sem disco), a falha fica só no log.
    try:
        with open(pasta / "falha.log", "a", encoding="utf-8") as f:
            f.write(f"[{agora()}] {motivo} Consulte: {log_lead}\n")
    except OSError as e:
        log(f"Falha de {pasta.name} não registrada em falha.log ({e}); só neste log.", "ERRO", log_lead)
        return
    log(f"Falha registrada em {pasta / 'falha.log'} ({falhas_registradas(pasta)}/{MAX_FALHAS})", "ERRO")


def rodar_claude(slug: str, log_lead: Path, timeout_min: int) -> dict:
    cmd = ["claude", "-p", PROMPT.format(slug=slug), "--dangerously-skip-permissions"]
    log(f"Iniciando processo novo do Claude para {slug} (contexto limpo).", arquivo=log_lead)
    inicio = time.monotonic()
    with open(log_lead, "a", encoding="utf-8") as saida:
        # Grupo próprio: no timeout mata o Claude E os filhos (vercel, node...).
        proc = subprocess.Popen(cmd, cwd=AUTO, stdout=saida, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            codigo = proc.wait(timeout=timeout_min * 60)
            estourou = False
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
            codigo, estourou = 124, True
        except BaseException:
            # Runner interrompido (SIGTERM, Ctrl+C): não deixa o Claude órfão no grupo dele.
            os.killpg(proc.pid, signal.SIGTERM)
            raise
    texto = log_lead.read_text(encoding="utf-8", errors="replace")[-4000:]
    return {
        "codigo": codigo,
        "estourou": estourou,
        "limite": bool(LIMITE_DE_USO.search(texto)) and codigo != 0,
        "minutos": round((time.monotonic() - inicio) / 60, 1),
    }


def publicar_na_vercel(pasta: Path, log_lead: Path) -> bool:
    slug = pasta.name
    with tempfile.TemporaryDirectory(prefix=f"demo-{slug}-") as palco:
        shutil.copy2(pasta / "index.html", Path(palco) / "index.html")
        log(f"Publicando demo-{slug} na Vercel...", arquivo=log_lead)
        with open(log_lead, "a", encoding="utf-8") as saida:
            subprocess.run(["vercel", "link", "--yes", "--project", f"demo-{slug}", "--scope", VERCEL_SCOPE],
                           cwd=palco, stdout=saida, stderr=subprocess.STDOUT, timeout=300)
        r = subprocess.run(["vercel", "deploy", "--prod", "--yes", "--scope", VERCEL_SCOPE],
                           cwd=palco, capture_output=True, text=True, timeout=600)
    saida = (r.stdout or "") + (r.stderr or "")
    with open(log_lead, "a", encoding="utf-8") as f:
        f.write(saida)
    m = re.search(r"(?i)aliased:\s*(https://\S+)", saida)
    if not m:
        log(f"Deploy sem linha 'Aliased:' na saída; recibo não escrito para {slug}.", "ERRO", log_lead)
        return False
    url = m.group(1).rstrip(".,)")
    conteudo = (pasta / "content.md").read_text(encoding="utf-8", errors="replace")
    pid = re.search(r"(?i)place_id[:* \t]+([a-zA-Z0-9_-]+)", conteudo)
    if not pid:
        log(f"place_id não encontrado no content.md de {slug}; sem ele o n8n não acha a linha. Recibo não escrito.", "ERRO", log_lead)
        return False
    recibo = {
        "place_id": pid.group(1).strip(),
        "slug": slug,
        "nome": conteudo.splitlines()[0].replace("#", "").strip() if conteudo else slug,
        "site_url": url,
        "vercel_project": f"demo-{slug}",
        "publicado_em": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    (pasta / "publicado.json").write_text(json.dumps(recibo, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"Recibo escrito com a URL real: {url}", arquivo=log_lead)
    return True


def validar(pasta: Path, log_lead: Path) -> bool:
    recibo = pasta / "publicado.json"
    if not recibo.is_file():
        log(f"Recibo não gerado: {recibo}", "ERRO", log_lead)
        return False
    try:
        url = json.loads(recibo.read_text(encoding="utf-8-sig"))["site_url"]
        assert isinstance(url, str) and url.startswith(("http://", "https://"))
    except Exception as e:  # noqa: BLE001 — qualquer recibo ilegível é falha do lead
        log(f"publicado.json inválido: {e}", "ERRO", log_lead)
        return False
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=30) as r:
            codigo = r.status
    except Exception as e:  # noqa: BLE001
        codigo = getattr(e, "code", str(e))
    log(f"Validação HTTP: {url} -> {codigo}", arquivo=log_lead)
    return codigo == 200


def processar(pasta: Path, timeout_min: int) -> tuple[bool, str]:
    slug = pasta.name
    log_lead = LOGS / f"execucao-{slug}.log"
    indice = pasta / "index.html"
    resultado = {"codigo": 0, "estourou": False, "limite": False}
    if html_completo(indice):
        log(f"Checkpoint: index.html completo para {slug}. Pulando o Claude e indo direto ao deploy.", arquivo=log_lead)
    else:
        if indice.exists():
            indice.replace(pasta / "index.truncado.html")
            log(f"index.html anterior estava truncado; guardado como index.truncado.html.", "ERRO", log_lead)
        resultado = rodar_claude(slug, log_lead, timeout_min)
        log(f"Claude Code finalizado com exit code {resultado['codigo']} em {resultado.get('minutos')} min.", arquivo=log_lead)
        if not pasta.is_dir():
            return False, "a pasta do lead saiu da raiz durante a geração"
        if indice.exists() and not html_completo(indice):
            indice.replace(pasta / "index.truncado.html")
            log("index.html ficou truncado (sem </html>): guardado como index.truncado.html, não publicado.", "ERRO", log_lead)
    if html_completo(indice) and not (pasta / "publicado.json").exists():
        publicar_na_vercel(pasta, log_lead)
    if validar(pasta, log_lead):
        falha = pasta / "falha.log"
        if falha.exists():
            falha.unlink()
        return True, ""
    if resultado["estourou"]:
        return False, f"Claude Code excedeu o timeout de {timeout_min} min"
    if resultado["limite"]:
        return False, "limite de uso do Claude atingido"
    if resultado["codigo"] != 0:
        return False, f"Claude Code retornou exit code {resultado['codigo']}"
    return False, "index.html não foi gerado; publicado.json ou validação HTTP 200 falhou"


def tomar_trava() -> bool:
    LOGS.mkdir(parents=True, exist_ok=True)
    if TRAVA.exists():
        try:
            dono = json.loads(TRAVA.read_text(encoding="utf-8"))
            idade_h = (time.time() - dono.get("desde", 0)) / 3600
            mesmo_host_morto = dono.get("host") == socket.gethostname() and not Path(f"/proc/{dono.get('pid')}").exists()
            # Trava de outro host (o PC) só vale por 6 h: runner que morreu sem apagar não bloqueia para sempre.
            if not mesmo_host_morto and idade_h < 6:
                log(f"Outra execução em andamento ({dono.get('host')}, pid {dono.get('pid')}); saindo.", "ERRO")
                return False
        except (OSError, ValueError):
            pass
    TRAVA.write_text(json.dumps({"host": socket.gethostname(), "pid": os.getpid(), "desde": time.time()}), encoding="utf-8")
    return True


def resumo_de_erro(erro: str) -> dict:
    """Execução que não chegou a gerar nada (sem login, sem binário): o
    dell-status lê o `erro` e avisa."""
    try:
        pendentes = len(fila())
    except OSError:
        pendentes = -1
    return {"host": socket.gethostname(), "estado": "ocioso", "ultimo_resumo": {
        "concluidos": [], "falhas": [], "descartados": [], "sumidos": [], "tentativas": 0,
        "pendentes": pendentes, "erro": erro,
        "fim": dt.datetime.now().astimezone().isoformat(timespec="seconds")}}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--quantidade", type=int, default=4)
    ap.add_argument("--timeout-min", type=int, default=45)
    ap.add_argument("--listar", action="store_true", help="só mostra a fila, sem gerar nada")
    a = ap.parse_args()

    if a.listar:
        for p in fila():
            print(p.name)
        return 0
    for binario in ("claude", "vercel"):
        if not shutil.which(binario):
            log(f"'{binario}' não encontrado no PATH; nada gerado.", "ERRO")
            gravar_status(resumo_de_erro(f"'{binario}' não encontrado no PATH"))
            return 2
    # Sem login o Claude falharia em todo lead, e 2 falhas tiram o lead da fila:
    # checar ANTES, sem tocar em nenhum lead, e avisar quem pode resolver.
    if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") and not (Path.home() / ".claude/.credentials.json").exists():
        log("Claude sem login no Dell (sem CLAUDE_CODE_OAUTH_TOKEN nem ~/.claude/.credentials.json); nada gerado.", "ERRO")
        avisar("O gerador de sites não rodou: o Claude não está logado no Dell. Grave o token em "
               "~/.config/claude-ops/gerador.env (CLAUDE_CODE_OAUTH_TOKEN=...) e ele volta amanhã às 08h.")
        gravar_status(resumo_de_erro("Claude sem login no Dell"))
        return 2
    if not tomar_trava():
        return 0
    # systemctl stop / teto do systemd: sair pelo finally, que grava o resumo e solta a trava.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    inicio = time.monotonic()
    inicio_iso = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    concluidos, falhas, descartados, sumidos = [], [], [], []
    erro = None
    try:
        log("Execução da fila iniciada (Dell).")
        # Descartado/sumido não conta como site do dia, mas também tem teto.
        while len(concluidos) + len(falhas) < a.quantidade and len(descartados) + len(sumidos) < a.quantidade:
            if SINAL_PARAR.exists():
                SINAL_PARAR.unlink()
                log("Sinal .parar recebido; encerrando a fila.", "ERRO")
                break
            if (time.monotonic() - inicio) / 60 + a.timeout_min > TETO_MIN:
                log("Sem tempo para mais um lead antes do teto de 4 h do systemd; o resto fica para a próxima execução.")
                break
            pendentes = fila()
            if not pendentes:
                log("Fila vazia.")
                break
            lead = pendentes[0]
            log_lead = LOGS / f"execucao-{lead.name}.log"
            log(f"{len(pendentes)} lead(s) pendente(s). Próximo: {lead.name}.")
            # "processando"/"ocioso": os estados que server/auto-production.ts reconhece.
            gravar_status({"host": socket.gethostname(), "estado": "processando", "lead": lead.name,
                           "inicio": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
                           "timeout_min": a.timeout_min, "pendentes": len(pendentes)})
            try:
                ok, motivo = processar(lead, a.timeout_min)
            except Exception as e:  # noqa: BLE001 — um lead quebrado não derruba o lote
                ok, motivo = False, f"erro no runner: {type(e).__name__}: {e}"
                log(f"{lead.name}: {motivo}\n{traceback.format_exc().rstrip()}", "ERRO", log_lead)
            if ok:
                concluidos.append(lead.name)
                log(f"Lead concluído: {lead.name}", "SUCESSO")
            elif not lead.is_dir():
                destino = paradeiro(lead)
                if destino:
                    descartados.append(f"{lead.name} → {destino.parent.name}")
                    log(f"Lead saiu da fila pelo Claude: {lead.name} foi para {destino.parent.name}/ "
                        "(motivo no registro.md da pasta). Não é falha; seguindo.", arquivo=log_lead)
                else:
                    sumidos.append(lead.name)
                    log(f"A pasta de {lead.name} sumiu durante a geração e não está em nenhuma _*/ "
                        f"(renomeada ou apagada?). Veja {log_lead}. Seguindo.", "ERRO", log_lead)
            else:
                falhas.append(f"{lead.name}: {motivo}")
                registrar_falha(lead, motivo, log_lead)
                if motivo.startswith("limite de uso"):
                    log("Limite de uso do Claude: parando a execução para não queimar a fila.", "ERRO")
                    break
    except Exception as e:  # noqa: BLE001 — erro fora de um lead: registra no resumo em vez de sumir
        erro = f"{type(e).__name__}: {e}"
        log(f"Execução interrompida por erro do runner: {erro}\n{traceback.format_exc().rstrip()}", "ERRO")
    except SystemExit:
        erro = "execução interrompida (SIGTERM: systemctl stop ou teto do systemd)"
        log(erro, "ERRO")
        raise
    finally:
        try:
            restantes = len(fila())
        except OSError:
            restantes = -1
        duracao = dt.timedelta(seconds=int(time.monotonic() - inicio))
        nivel = "ERRO" if falhas or sumidos or erro else "SUCESSO"
        tentativas = len(concluidos) + len(falhas) + len(descartados) + len(sumidos)
        log(f"Resumo: {tentativas} tentativa(s); {len(concluidos)} concluído(s); "
            f"{len(falhas)} falha(s); {len(descartados)} descartado(s); {len(sumidos)} sumido(s); "
            f"{restantes} pendente(s); duração {duracao}."
            + (f" Falhas: {'; '.join(falhas)}" if falhas else "")
            + (f" Descartados: {'; '.join(descartados)}" if descartados else "")
            + (f" Sumidos: {'; '.join(sumidos)}" if sumidos else "")
            + (f" Erro: {erro}" if erro else ""), nivel)
        # O dell-status lê este resumo (falha sem nenhum concluído ou `erro` vira WhatsApp).
        gravar_status({"host": socket.gethostname(), "estado": "ocioso", "ultimo_resumo": {
            "concluidos": concluidos, "falhas": falhas, "descartados": descartados, "sumidos": sumidos,
            "tentativas": tentativas, "pendentes": restantes, "inicio": inicio_iso,
            **({"erro": erro} if erro else {}),
            "fim": dt.datetime.now().astimezone().isoformat(timespec="seconds")}})
        TRAVA.unlink(missing_ok=True)
    return 1 if erro or (falhas and not concluidos) else 0


if __name__ == "__main__":
    sys.exit(main())
