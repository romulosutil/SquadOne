#!/usr/bin/env python3
"""Esteira "Site antes da venda" no Dell: gera os sites da fila sem o PC ligado.

Porte do `executar-fila-leads.ps1` (G:\\Meu Drive\\auto), que só rodava com o PC
ligado às 08h e não gerava nada automático desde 17/09/2026. A pasta é a mesma
(`~/auto-site`, a `auto` do Drive, sincronizada pelo Syncthing), e o contrato
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
  antiga, os dois não pegam o mesmo lead ao mesmo tempo.

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
    f = pasta / "falha.log"
    if not f.exists():
        return 0
    return sum(1 for linha in f.read_text(encoding="utf-8", errors="replace").splitlines() if linha.strip())


def fila() -> list[Path]:
    leads = []
    for p in AUTO.iterdir():
        if not p.is_dir() or p.name.startswith((".", "_")):
            continue
        if not (p / "content.md").is_file() or (p / "publicado.json").exists():
            continue
        if falhas_registradas(p) >= MAX_FALHAS:
            continue
        leads.append(p)
    return sorted(leads, key=lambda p: ((p / "content.md").stat().st_mtime, p.name))


def html_completo(caminho: Path) -> bool:
    if not caminho.is_file():
        return False
    return bool(re.search(r"(?is)</html>\s*$", caminho.read_text(encoding="utf-8", errors="replace")))


def registrar_falha(pasta: Path, motivo: str, log_lead: Path) -> None:
    with open(pasta / "falha.log", "a", encoding="utf-8") as f:
        f.write(f"[{agora()}] {motivo} Consulte: {log_lead}\n")
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
            return 2
    # Sem login o Claude falharia em todo lead, e 2 falhas tiram o lead da fila:
    # checar ANTES, sem tocar em nenhum lead, e avisar quem pode resolver.
    if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") and not (Path.home() / ".claude/.credentials.json").exists():
        log("Claude sem login no Dell (sem CLAUDE_CODE_OAUTH_TOKEN nem ~/.claude/.credentials.json); nada gerado.", "ERRO")
        avisar("O gerador de sites não rodou: o Claude não está logado no Dell. Grave o token em "
               "~/.config/claude-ops/gerador.env (CLAUDE_CODE_OAUTH_TOKEN=...) e ele volta amanhã às 08h.")
        return 2
    if not tomar_trava():
        return 0
    inicio = time.monotonic()
    concluidos, falhas = [], []
    try:
        log("Execução da fila iniciada (Dell).")
        while len(concluidos) + len(falhas) < a.quantidade:
            if SINAL_PARAR.exists():
                SINAL_PARAR.unlink()
                log("Sinal .parar recebido; encerrando a fila.", "ERRO")
                break
            pendentes = fila()
            if not pendentes:
                log("Fila vazia.")
                break
            lead = pendentes[0]
            log(f"{len(pendentes)} lead(s) pendente(s). Próximo: {lead.name}.")
            # "processando"/"ocioso": os estados que server/auto-production.ts reconhece.
            gravar_status({"host": socket.gethostname(), "estado": "processando", "lead": lead.name,
                           "inicio": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
                           "timeout_min": a.timeout_min, "pendentes": len(pendentes)})
            ok, motivo = processar(lead, a.timeout_min)
            if ok:
                concluidos.append(lead.name)
                log(f"Lead concluído: {lead.name}", "SUCESSO")
            else:
                falhas.append(f"{lead.name}: {motivo}")
                registrar_falha(lead, motivo, LOGS / f"execucao-{lead.name}.log")
                if motivo.startswith("limite de uso"):
                    log("Limite de uso do Claude: parando a execução para não queimar a fila.", "ERRO")
                    break
    finally:
        restantes = len(fila())
        duracao = dt.timedelta(seconds=int(time.monotonic() - inicio))
        nivel = "ERRO" if falhas else "SUCESSO"
        log(f"Resumo: {len(concluidos) + len(falhas)} tentativa(s); {len(concluidos)} concluído(s); "
            f"{len(falhas)} falha(s); {restantes} pendente(s); duração {duracao}."
            + (f" Falhas: {'; '.join(falhas)}" if falhas else ""), nivel)
        gravar_status({"host": socket.gethostname(), "estado": "ocioso", "ultimo_resumo": {
            "concluidos": concluidos, "falhas": falhas, "pendentes": restantes,
            "fim": dt.datetime.now().astimezone().isoformat(timespec="seconds")}})
        TRAVA.unlink(missing_ok=True)
    return 1 if falhas and not concluidos else 0


if __name__ == "__main__":
    sys.exit(main())
