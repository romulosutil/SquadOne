"""Ponto único para gravar um aviso na fila do dell-status (~/.local/share/avisos/fila).

Por que existe: em 11/10/2026 havia uma dúzia de `avisar()` copiadas pelos
scripts da Mel, cada uma com o seu jeito: umas criavam a pasta (que é 2770 com
o grupo do n8n e não deve ser criada por script), umas gravavam direto no
`.json` (o dell-status só não lê pela metade porque espera 5 s), uma usava
`int(time.time())` no nome (dois avisos no mesmo segundo se sobrescrevem),
nenhuma validava o formato e quase nenhuma tratava erro. Aviso fora do formato
é recusado pelo dell-status e deixa a verificação vermelha; erro de gravação
dentro de um `except` derrubava o script no meio do trabalho.

O contrato é o de deploy/dell/README.md ("Fila de avisos"), o mesmo que o
`validar_aviso` do dell-status aplica ao drenar, mais duas regras do
server/avisos.ts: nenhum "R$" em titulo, texto ou link (RULES 24) e o teto de
16 KB conferido antes de gravar. O dell-status NÃO é importado (é um
executável de 1500 linhas que importa fcntl e lê o Dell no import); as regras
são espelhadas e o aviso.test.py confere, contra o dell-status do repo, que as
constantes batem e que tudo o que esta lib grava ele aceita.

O que a lib faz por quem chama:
- corta com segurança o que dá para cortar sem mudar o sentido: título e origem
  viram uma linha e ganham "…" no teto; texto longo termina em "… (cortado)";
  chave longa vira prefixo + hash (cortar seco juntaria chaves diferentes, e
  a chave descarta o repetido por 24 h); texto encurta até o arquivo caber em
  16 KB. O que já está no formato é gravado sem tocar, byte a byte;
- recusa o que não dá para consertar (campo a mais, prioridade fora de 0 a 3,
  expira_em ilegível, link que não é http(s), R$), sem gravar nada;
- grava atômico: `.<nome>.tmp` oculto (o dell-status só lê `*.json`), fsync e
  rename; nome com nanossegundos + sufixo aleatório, então nunca sobrescreve;
- não cria a pasta da fila: ausente é um resultado, não um mkdir;
- NUNCA levanta exceção para quem chama. Devolve um `Resultado` com `estado`
  (GRAVADO, RECUSADO, FILA_AUSENTE ou FALHOU) e `motivo`; o que não foi gravado
  também sai numa linha no stderr, que o systemd leva ao journal, para o
  chamador que ignora o resultado não perder o rastro.

Uso (o script carrega a lib pelo caminho; sem ela NÃO grava na fila: registra no
stderr "lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: <título>" e
segue; ver docs/superpowers/plans/2026-10-11-aviso-unico.md):

    r = aviso.avisar("🌐 Sites", texto, "auto-entrada", chave="auto-entrada:x", prioridade=2)
    if not r.gravado:
        ...  # r.estado, r.motivo

    r = aviso.gravar({"titulo": ..., "texto": ..., "origem": ...}, prefixo="backup-dell")

Somente biblioteca padrão; roda no python3 da Mel e no do Hermes.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import NamedTuple

# --- o formato (espelho do dell-status.py; o aviso.test.py confere) -----------
CAMPOS_DO_AVISO = {"titulo", "texto", "origem", "chave", "prioridade", "expira_em", "link"}
ORDEM_DOS_CAMPOS = ("titulo", "texto", "origem", "chave", "prioridade", "expira_em", "link")
ORIGENS_TELEGRAM_EXCLUSIVO = {"socorro", "dell-status"}
MAX_CARACTERES = {"titulo": 120, "texto": 4000, "origem": 80, "chave": 200, "link": 500}
MAX_BYTES_AVISO = 16 * 1024
# Qualquer "R$", com ou sem número, maiúscula ou não (o mesmo do server/avisos.ts).
VALOR_EM_REAIS = re.compile(r"R\s*\$", re.IGNORECASE)
VALOR_EM_REAIS_COM_NUMERO = re.compile(r"R\s*\$\s*-?[\d.,]*", re.IGNORECASE)
CAMPOS_SEM_VALOR = ("titulo", "texto", "link")

FILA_RELATIVA = ".local/share/avisos/fila"
# A mesma variável que o funil-aprendizado já lê para apontar a fila em teste.
VARIAVEL_DA_FILA = "SQUADONE_AVISOS_FILA"

MARCA_DE_CORTE = "\n… (cortado)"
RETICENCIAS = "…"

GRAVADO, RECUSADO, FILA_AUSENTE, FALHOU = "gravado", "recusado", "fila_ausente", "falhou"


class Resultado(NamedTuple):
    """O que aconteceu com o aviso. `arquivo` só quando GRAVADO."""
    estado: str
    motivo: str = ""
    arquivo: Path | None = None

    @property
    def gravado(self) -> bool:
        return self.estado == GRAVADO


class AvisoInvalido(ValueError):
    """Fora do formato da fila e sem conserto seguro: não é gravado."""


# --- cortes seguros ------------------------------------------------------------

def uma_linha(texto: str, teto: int) -> str:
    """Uma linha só e no máximo `teto` caracteres, com reticências."""
    limpo = re.sub(r"\s+", " ", texto).strip()
    return limpo if len(limpo) <= teto else limpo[: teto - 1].rstrip() + RETICENCIAS


def cortar_texto(texto: str, teto: int) -> str:
    """Até `teto` caracteres, avisando no fim que cortou."""
    if len(texto) <= teto:
        return texto
    return texto[: teto - len(MARCA_DE_CORTE)].rstrip() + MARCA_DE_CORTE


def chave_curta(chave: str, teto: int = MAX_CARACTERES["chave"]) -> str:
    """Uma linha; passando do teto, prefixo + '#' + 16 hex do sha256 da chave
    inteira: duas chaves longas diferentes continuam diferentes, e a mesma
    chave dá sempre o mesmo resultado (a deduplicação de 24 h segue valendo)."""
    limpa = re.sub(r"\s+", " ", chave).strip()
    if len(limpa) <= teto:
        return limpa
    resumo = hashlib.sha256(limpa.encode("utf-8")).hexdigest()[:16]
    return limpa[: teto - 17] + "#" + resumo


def sem_valores(texto: str) -> str:
    """Troca valor em R$ por "[valor]" (o mesmo do server/avisos.ts). Para quem
    monta o aviso com texto que veio de fora (planilha, lead, exceção) e
    prefere mandar sem o valor a ter o aviso recusado."""
    return re.sub(r" {2,}", " ", VALOR_EM_REAIS_COM_NUMERO.sub("[valor] ", texto)).strip()


def _serializar(d: dict) -> bytes:
    # Igual ao que os scripts gravavam: json.dumps(..., ensure_ascii=False), sem
    # quebra de linha no fim. Assim a troca de um script pela lib é byte a byte.
    return json.dumps(d, ensure_ascii=False).encode("utf-8")


def _cortar(d: dict) -> dict:
    """Conserta o que dá para consertar sem mudar o sentido; o resto fica para
    o validar() recusar. Campo já no formato passa intacto."""
    d = dict(d)
    for campo in ("titulo", "origem"):
        v = d.get(campo)
        if isinstance(v, str) and (len(v) > MAX_CARACTERES[campo] or "\n" in v or "\r" in v):
            d[campo] = uma_linha(v, MAX_CARACTERES[campo])
    v = d.get("chave")
    if isinstance(v, str) and (len(v) > MAX_CARACTERES["chave"] or "\n" in v or "\r" in v):
        d["chave"] = chave_curta(v)
    v = d.get("texto")
    if isinstance(v, str):
        d["texto"] = cortar_texto(v, MAX_CARACTERES["texto"])
        # 4000 caracteres podem passar de 16 KB (emoji, caractere de controle
        # que o JSON escapa): encurta até caber.
        for _ in range(64):
            excesso = len(_serializar(d)) - MAX_BYTES_AVISO
            if excesso <= 0 or len(d["texto"]) <= len(MARCA_DE_CORTE) + 1:
                break
            base = d["texto"][:-len(MARCA_DE_CORTE)] if d["texto"].endswith(MARCA_DE_CORTE) else d["texto"]
            d["texto"] = base[: max(1, len(base) - max(1, excesso // 2))].rstrip() + MARCA_DE_CORTE
    return d


# --- validação -----------------------------------------------------------------

def _instante_valido(txt) -> bool:
    if not isinstance(txt, str):
        return False
    try:
        datetime.fromisoformat(txt.strip().replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def validar(d) -> dict:
    """O aviso como será gravado, ou AvisoInvalido com o motivo. Mesmas regras e
    mesmas mensagens do `validar_aviso` do dell-status, mais R$ e 16 KB."""
    if not isinstance(d, dict):
        raise AvisoInvalido("não é um objeto JSON")
    sobra = sorted(set(d) - CAMPOS_DO_AVISO)
    if sobra:
        raise AvisoInvalido("campo(s) fora do formato: " + ", ".join(map(str, sobra)))
    for campo in ("titulo", "texto", "origem"):
        if not isinstance(d.get(campo), str) or not d[campo].strip():
            raise AvisoInvalido(f"'{campo}' é obrigatório (texto não vazio)")
    for campo, teto in MAX_CARACTERES.items():
        v = d.get(campo)
        if v is None:
            continue
        if not isinstance(v, str):
            raise AvisoInvalido(f"'{campo}' deve ser texto")
        if len(v) > teto:
            raise AvisoInvalido(f"'{campo}' passa de {teto} caracteres ({len(v)})")
        if campo != "texto" and ("\n" in v or "\r" in v):
            raise AvisoInvalido(f"'{campo}' não pode ter quebra de linha")
    p = d.get("prioridade")
    if p is not None and (isinstance(p, bool) or not isinstance(p, int) or not 0 <= p <= 3):
        raise AvisoInvalido("'prioridade' deve ser inteiro de 0 a 3")
    if d.get("expira_em") is not None and not _instante_valido(d["expira_em"]):
        raise AvisoInvalido("'expira_em' deve ser data/hora ISO 8601")
    link = d.get("link")
    if link is not None and not re.match(r"https?://\S+$", link):
        raise AvisoInvalido("'link' deve ser URL http(s) sem espaços")
    for campo in CAMPOS_SEM_VALOR:
        v = d.get(campo)
        if isinstance(v, str) and VALOR_EM_REAIS.search(v):
            raise AvisoInvalido(f"'{campo}' tem valor em R$: os avisos levam semáforo e %, nunca valor (RULES 24)")
    tamanho = len(_serializar(d))
    if tamanho > MAX_BYTES_AVISO:
        raise AvisoInvalido(f"arquivo passa de {MAX_BYTES_AVISO} bytes ({tamanho})")
    return d


# --- gravação ------------------------------------------------------------------

def fila_padrao() -> Path:
    """$SQUADONE_AVISOS_FILA ou ~/.local/share/avisos/fila, lido a cada chamada
    (o teste troca o HOME antes; nada fica preso ao HOME do import)."""
    return Path(os.environ.get(VARIAVEL_DA_FILA) or Path.home() / FILA_RELATIVA)


def _prefixo(texto: str) -> str:
    return re.sub(r"[^a-z0-9._-]+", "-", texto.lower()).strip("-.")[:60] or "aviso"


def exige_telegram(aviso: dict) -> bool:
    """P0/falhas são outbox Telegram; o único consumidor é o dell-status, sem fallback."""
    return aviso.get("prioridade") == 0 or aviso.get("origem") in ORIGENS_TELEGRAM_EXCLUSIVO


def _registrar(r: Resultado, d) -> Resultado:
    if not r.gravado and sys.stderr is not None:
        quem = d.get("origem") if isinstance(d, dict) else None
        try:
            print(f"aviso não gravado ({r.estado}{', ' + str(quem)[:80] if quem else ''}): {r.motivo}",
                  file=sys.stderr, flush=True)
        except Exception:  # noqa: BLE001 — stderr fechado não vira exceção para quem chama
            pass
    return r


def gravar(aviso, fila: str | Path | None = None, prefixo: str | None = None, cortar: bool = True) -> Resultado:
    """Grava um aviso já montado (dict no formato da fila). Nunca levanta.

    `cortar=False` recusa em vez de cortar (para quem prefere saber)."""
    d = aviso
    tmp: Path | None = None
    try:
        d = _cortar(aviso) if cortar and isinstance(aviso, dict) else aviso
        validar(d)
        if exige_telegram(d):
            # Não perde um alerta crítico por uma indisponibilidade prolongada do bot.
            d = {k: v for k, v in d.items() if k != "expira_em"}
        pasta = Path(fila) if fila is not None else fila_padrao()
        if not pasta.is_dir():
            # A pasta é do dell-status (2770, grupo do n8n): criar aqui, com a
            # permissão errada, faria o n8n deixar de conseguir gravar.
            return _registrar(Resultado(FILA_AUSENTE, f"fila de avisos ausente ({pasta})"), d)
        dados = _serializar(d)
        nome = f"{_prefixo(prefixo or d['origem'])}-{time.time_ns()}-{secrets.token_hex(3)}.json"
        tmp = pasta / f".{nome}.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o660)
        with os.fdopen(fd, "wb") as f:
            f.write(dados)
            f.flush()
            os.fsync(f.fileno())
        destino = pasta / nome
        os.replace(tmp, destino)
        tmp = None
        return Resultado(GRAVADO, "", destino)
    except AvisoInvalido as e:
        return _registrar(Resultado(RECUSADO, str(e)[:300]), d)
    except FileNotFoundError as e:  # a pasta sumiu entre o is_dir e o open
        return _registrar(Resultado(FILA_AUSENTE, f"fila de avisos ausente ({e.filename or fila})"), d)
    except Exception as e:  # noqa: BLE001 — o contrato é nunca levantar para quem chama
        return _registrar(Resultado(FALHOU, f"{type(e).__name__}: {e}"[:300]), d)
    finally:
        if tmp is not None:
            try:
                tmp.unlink()
            except OSError:
                pass


def montar(titulo, texto, origem, *, chave=None, prioridade=None, expira_em=None, link=None) -> dict:
    """O dict na ordem do formato, só com os campos dados (None fica de fora,
    como nos scripts antigos). `expira_em` aceita datetime/date ou texto ISO."""
    if isinstance(expira_em, (datetime, date)):
        expira_em = expira_em.isoformat(timespec="seconds") if isinstance(expira_em, datetime) else expira_em.isoformat()
    valores = {"titulo": titulo, "texto": texto, "origem": origem, "chave": chave,
               "prioridade": prioridade, "expira_em": expira_em, "link": link}
    return {k: valores[k] for k in ORDEM_DOS_CAMPOS if valores[k] is not None}


def avisar(titulo, texto, origem, *, chave=None, prioridade=None, expira_em=None, link=None,
           fila: str | Path | None = None, prefixo: str | None = None, cortar: bool = True) -> Resultado:
    """Monta e grava. Nunca levanta; veja `Resultado`."""
    try:
        d = montar(titulo, texto, origem, chave=chave, prioridade=prioridade, expira_em=expira_em, link=link)
    except Exception as e:  # noqa: BLE001
        return _registrar(Resultado(FALHOU, f"{type(e).__name__}: {e}"[:300]), {"origem": origem})
    return gravar(d, fila=fila, prefixo=prefixo, cortar=cortar)
