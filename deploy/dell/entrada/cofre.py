#!/usr/bin/env python3
"""Cofre da Mel: segredos cifrados com age, sempre para todos os destinatários.

  ~/Mel/Cofre/
    recipients.txt   chaves PÚBLICAS age1... (a da Mel e a do Rômulo)
    indice.json      id, rótulo, tipo, nome do arquivo, tamanho, data. NUNCA o valor.
    c-AAAAMMDD-HHMMSS-xxxx.age   o segredo cifrado

Regras:
- O texto claro nunca vai para o disco: entra pelo stdin do `age`, que grava só o
  cifrado (arquivo temporário .age.tmp, renomeado no fim).
- Cifra para todos os destinatários de recipients.txt. Lista vazia ou com linha
  inválida = erro (falha fechada): um cofre que só a Mel abre morre com a Mel.
- O índice é texto claro, então o rótulo e o nome do arquivo passam pelo filtro de
  segredos: rótulo que parece segredo é recusado.
- Quem lê é por linha de comando (cofre_cli), com confirmação. A página nunca lê.
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import secrets as _secrets
import subprocess
import threading
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable

import segredos

ID_RE = re.compile(r"^c-\d{8}-\d{6}-[0-9a-f]{4}$")
CHAVE_PUBLICA = re.compile(r"^age1[a-z0-9]{58}$")
MAX_ROTULO = 120

_trava_processo = threading.Lock()
_ids_lock = threading.Lock()
_ids_em_uso: set[str] = set()


class CofreErro(Exception):
    pass


def identidade_padrao(home: Path | None = None) -> Path:
    """A identidade da Mel: a protegida por senha (identity.txt.age) se existir; senão a em claro."""
    base = (home or Path.home()) / ".config/mel/age"
    protegida = base / "identity.txt.age"
    return protegida if protegida.exists() else base / "identity.txt"


class Cofre:
    def __init__(self, raiz: Path, identidade: Path, age: str = "age", agora: Callable[[], datetime] = datetime.now):
        self.raiz = Path(raiz)
        self.identidade = Path(identidade)
        self.age = age
        self.agora = agora
        self.recipients = self.raiz / "recipients.txt"
        self.indice = self.raiz / "indice.json"

    # ------------------------------------------------------------ destinatários
    def destinatarios(self) -> list[str]:
        """As chaves públicas de recipients.txt. Só \\n separa linhas (como no `age`): Python e age
        leem o mesmo arquivo do mesmo jeito, e caractere de controle ou separador exótico (U+2028,
        \\x0c, \\x85) é recusado em vez de interpretado. A cifra usa estas chaves, uma a uma (-r)."""
        try:
            bruto = self.recipients.read_bytes().decode("utf-8").lstrip("\ufeff")
        except OSError:
            raise CofreErro("recipients.txt ilegível") from None
        except UnicodeDecodeError:
            raise CofreErro("recipients.txt não é UTF-8") from None
        chaves = []
        for n, linha in enumerate(bruto.split("\n"), 1):
            linha = linha.rstrip("\r")
            if any(ord(c) < 32 or ord(c) == 127 or c in "\x85\u2028\u2029" for c in linha):
                raise CofreErro(f"recipients.txt, linha {n}: caractere de controle")
            linha = linha.strip()
            if not linha or linha.startswith("#"):
                continue
            if not CHAVE_PUBLICA.fullmatch(linha):
                raise CofreErro(f"recipients.txt, linha {n}: não é uma chave pública age1...")
            chaves.append(linha)
        if not chaves:
            raise CofreErro("recipients.txt sem nenhuma chave pública")
        return chaves

    # ------------------------------------------------------------------- índice
    def _ler_indice(self) -> dict:
        try:
            d = json.loads(self.indice.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {"versao": 1, "itens": []}
        except (OSError, ValueError):
            raise CofreErro("indice.json ilegível") from None
        if not isinstance(d, dict) or not isinstance(d.get("itens"), list):
            raise CofreErro("indice.json com formato inesperado")
        return d

    def _gravar_indice(self, d: dict) -> None:
        tmp = self.raiz / ".indice.json.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.indice)

    def _com_trava(self, fn):
        with _trava_processo:
            fd = os.open(self.raiz / ".indice.lock", os.O_WRONLY | os.O_CREAT, 0o600)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX)
                return fn()
            finally:
                os.close(fd)

    def listar(self) -> list[dict]:
        return list(self._ler_indice()["itens"])

    def status(self) -> dict:
        return {"destinatarios": len(self.destinatarios()), "itens": len(self.listar())}

    # ------------------------------------------------------------------- guardar
    def _validar_texto(self, campo: str, valor: str, obrigatorio: bool) -> str:
        valor = (valor or "").strip()
        if obrigatorio and not valor:
            raise CofreErro(f"{campo} obrigatório")
        if len(valor) > MAX_ROTULO:
            raise CofreErro(f"{campo} com mais de {MAX_ROTULO} caracteres")
        if any(ord(c) < 32 or ord(c) == 127 for c in valor):
            raise CofreErro(f"{campo} com caractere de controle")
        if valor and segredos.tem_segredo(valor, estrito=True):      # texto curto: sem os afrouxamentos
            raise CofreErro(f"o {campo} parece um segredo: o índice é texto claro, escreva uma descrição")
        return valor

    def _novo_id(self) -> str:
        """Id novo e reservado (dois envios ao mesmo tempo não repartem o mesmo temporário)."""
        with _ids_lock:
            while True:
                i = f"c-{self.agora():%Y%m%d-%H%M%S}-{_secrets.token_hex(2)}"
                chave = f"{self.raiz}:{i}"
                if chave not in _ids_em_uso and not (self.raiz / f"{i}.age").exists():
                    _ids_em_uso.add(chave)
                    return i

    def _liberar_id(self, i: str) -> None:
        with _ids_lock:
            _ids_em_uso.discard(f"{self.raiz}:{i}")

    def guardar(self, rotulo: str, pedacos: Iterable[bytes] | bytes, tipo: str = "texto", nome: str | None = None) -> dict:
        """Cifra e indexa. Devolve a entrada do índice (sem o valor)."""
        rotulo = self._validar_texto("rótulo", rotulo, True)
        nome = self._validar_texto("nome do arquivo", nome or "", False) or None
        if tipo not in ("texto", "arquivo"):
            raise CofreErro("tipo inválido")
        destinatarios = self.destinatarios()                 # falha antes de ler qualquer coisa
        if isinstance(pedacos, (bytes, bytearray)):
            pedacos = [bytes(pedacos)]
        i = self._novo_id()
        try:
            return self._guardar_com_id(i, rotulo, pedacos, tipo, nome, destinatarios)
        finally:
            self._liberar_id(i)

    def _args_destinatarios(self, destinatarios: list[str]) -> list[str]:
        return [a for k in destinatarios for a in ("-r", k)]

    def _guardar_com_id(self, i, rotulo, pedacos, tipo, nome, destinatarios) -> dict:
        tmp = self.raiz / f".{i}.age.tmp"
        final = self.raiz / f"{i}.age"
        total = 0
        with subprocess.Popen([self.age, *self._args_destinatarios(destinatarios), "-o", str(tmp)],
                              stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE) as proc:
            try:
                try:
                    for p in pedacos:
                        if p:
                            proc.stdin.write(p)
                            total += len(p)
                finally:
                    try:
                        proc.stdin.close()
                    except OSError:
                        pass
                rc = proc.wait()
                erro = (proc.stderr.read() or b"").decode("utf-8", "replace").strip()[:200]
            except BaseException:
                proc.kill()
                self._limpar(tmp)
                raise
        if rc != 0 or total == 0:
            self._limpar(tmp)
            raise CofreErro("nada para guardar" if total == 0 and rc == 0 else f"age falhou ({rc}): {erro}")
        os.chmod(tmp, 0o600)
        os.replace(tmp, final)
        entrada = {"id": i, "rotulo": rotulo, "tipo": tipo, "nome": nome, "bytes": total,
                   "data": self.agora().isoformat(timespec="seconds")}

        def indexar():
            d = self._ler_indice()
            d["itens"].append(entrada)
            self._gravar_indice(d)
        try:
            self._com_trava(indexar)
        except BaseException:
            # sem índice o item seria um arquivo órfão ilegível: desfaz
            self._limpar(final)
            raise
        return entrada

    @staticmethod
    def _limpar(caminho: Path) -> None:
        """Apaga só o arquivo temporário ou órfão que o próprio cofre criou."""
        try:
            os.unlink(caminho)
        except FileNotFoundError:
            pass

    # ---------------------------------------------------------------------- ler
    def _arquivo(self, i: str) -> Path:
        if not isinstance(i, str) or not ID_RE.fullmatch(i):
            raise CofreErro("id inválido")
        p = self.raiz / f"{i}.age"
        if not p.is_file():
            raise CofreErro("id não encontrado")
        return p

    def ler(self, i: str) -> bytes:
        p = self._arquivo(i)
        r = subprocess.run([self.age, "-d", "-i", str(self.identidade), str(p)], capture_output=True)
        if r.returncode != 0:
            raise CofreErro("age não conseguiu decifrar (identidade errada, ou protegida por senha: rode `cofre ler` num terminal)")
        return r.stdout

    def ler_para_arquivo(self, i: str, destino: Path) -> int:
        """Decifra direto para um arquivo novo (600). Recusa sobrescrever."""
        p = self._arquivo(i)
        fd = os.open(destino, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            r = subprocess.run([self.age, "-d", "-i", str(self.identidade), str(p)], stdout=f, stderr=subprocess.PIPE)
        if r.returncode != 0:
            self._limpar(Path(destino))
            raise CofreErro("age não conseguiu decifrar (identidade errada, ou protegida por senha: rode `cofre ler` num terminal)")
        return os.path.getsize(destino)

    # ------------------------------------------------------------------ recifrar
    def recifrar(self) -> int:
        """Cifra de novo todos os itens para os destinatários de agora (depois de entrar
        a chave do Rômulo). O texto claro passa por um pipe entre dois `age`, nunca por disco."""
        destinatarios = self.destinatarios()
        n = 0
        for item in self.listar():
            p = self._arquivo(item["id"])
            tmp = self.raiz / f".{item['id']}.recifra.tmp"
            with subprocess.Popen([self.age, "-d", "-i", str(self.identidade), str(p)],
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as dec, \
                    subprocess.Popen([self.age, *self._args_destinatarios(destinatarios), "-o", str(tmp)],
                                     stdin=dec.stdout, stderr=subprocess.DEVNULL) as enc:
                dec.stdout.close()
                rc_enc = enc.wait()
                rc_dec = dec.wait()
            if rc_dec != 0 or rc_enc != 0:
                self._limpar(tmp)
                raise CofreErro(f"não consegui recifrar {item['id']}")
            os.chmod(tmp, 0o600)
            os.replace(tmp, p)
            n += 1
        return n
