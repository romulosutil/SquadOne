#!/usr/bin/env python3
"""A Entrada da Mel: recebe texto e arquivos do Rômulo e decide, ANTES de qualquer
modelo, o que pode seguir.

  ~/Mel/Entrada/
    chegou/        o que chegou (arquivos já sem segredo, ou guardados sem IA)
    fila/          um JSON por item para o agente organizar (só metadados e um trecho mascarado)
    organizado/    o que o executor arrumou (por destino)
    requisicoes/   o texto exato que foi ao modelo, uma vez por rodada (a prova)
    .tmp/          só a pasta onde nascem os arquivos temporários (que não têm nome em disco)
    diario.jsonl   o que aconteceu; nunca conteúdo

Três ações, todas explícitas (a página tem um botão para cada):

- `cofre`: cifra com age na hora e indexa pelo rótulo. O valor nunca é gravado em claro
  nem vai ao modelo.
- `organizar`: o conteúdo passa pelo filtro de segredos. Achou: BLOQUEIA (nada fica em disco)
  e diz para usar o cofre. Não achou: entra na fila do agente, que só vê um trecho já
  MASCARADO. Com `com_cofre=True` (um segundo clique, depois do bloqueio) cada segredo vai
  para o cofre e vira `{{SEGREDO:id}}` no texto que segue.
- `guardar`: vai para chegou/ sem IA. Também bloqueia se achar segredo (o cofre é o lugar dele).

O que vale para as três: limite de tamanho, rótulo e nome de arquivo também passam pelo filtro,
nada do conteúdo vai para log, e o recebimento é feito num arquivo temporário SEM NOME em disco
(O_TMPFILE): se o processo morrer no meio, nenhum texto claro sobra.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import secrets as _secrets
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import BinaryIO, Callable, Iterator

import segredos
from cofre import Cofre, CofreErro

LIMITE_BYTES = 200 * 1024 * 1024        # por envio
TEXTO_MAX = 5 * 1024 * 1024             # acima disso o arquivo é tratado como binário (só varredura de bytes)
TRECHO_MODELO = 8000                    # quanto de um texto pode ir (mascarado) ao agente
PEDACO = 1024 * 1024
ACOES = ("cofre", "organizar", "guardar")
MAX_ROTULO = 120
MAX_NOME_BYTES = 150                    # o nome em chegou/ ganha o id na frente e o disco limita em 255 bytes
MAX_SEGREDOS_REDIGIR = 20               # acima disso o segundo clique recusa (um item de cofre por achado)


class Recusado(Exception):
    """Pedido que não segue. `codigo` é o status HTTP; `extra` vai junto na resposta."""

    def __init__(self, codigo: int, mensagem: str, **extra):
        super().__init__(mensagem)
        self.codigo = codigo
        self.mensagem = mensagem
        self.extra = extra


def tem_controle(v: str, permite_quebra: bool = False) -> bool:
    """Caractere de controle, invisível, de direção (U+202E), substituto solto ou separador de linha."""
    for c in v:
        if permite_quebra and c in "\n\t":
            continue
        if ord(c) < 32 or 0x7F <= ord(c) <= 0x9F or unicodedata.category(c) in ("Cs", "Cf", "Co", "Cn", "Zl", "Zp"):
            return True
    return False


def _cortar_bytes(n: str, limite: int) -> str:
    if len(n.encode()) <= limite:
        return n
    base, ponto, ext = n.rpartition(".")
    if not ponto or not base or len(ext.encode()) > 10:
        base, ext = n, ""
    else:
        ext = "." + ext
    while base and len((base + ext).encode()) > limite:
        base = base[:-1]
    return (base.rstrip(" .") + ext) or "arquivo"


def nome_seguro(nome: str | None) -> str:
    """Só o último componente, sem controle nem caracteres estranhos, sem ponto na frente, em até
    MAX_NOME_BYTES (caracteres de 3 e 4 bytes não estouram o limite do disco)."""
    n = unicodedata.normalize("NFC", (nome or "").replace("\\", "/").split("/")[-1])
    n = re.sub(r"[^\w .()+\-]", "_", n, flags=re.UNICODE).strip(" .")
    return _cortar_bytes(n, MAX_NOME_BYTES) if n else "arquivo"


class _Anonimo:
    """Arquivo temporário sem nome em disco. Se o processo morrer (SIGTERM, SIGKILL, queda de energia)
    ele some junto: nenhum texto claro fica para trás. Ganha nome só no fim, com `materializar`."""

    def __init__(self, pasta: Path):
        self.pasta = Path(pasta)
        self.tamanho = 0
        self._aberto = True
        try:
            self.fd = os.open(self.pasta, os.O_TMPFILE | os.O_RDWR, 0o600)
            self.linkavel = True
        except OSError:                                    # sistema de arquivos sem O_TMPFILE: nome e unlink na hora
            nome = self.pasta / f".{_secrets.token_hex(8)}.parte"
            self.fd = os.open(nome, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
            os.unlink(nome)
            self.linkavel = False

    def escrever(self, dados: bytes) -> None:
        v = memoryview(dados)
        while v:
            n = os.write(self.fd, v)
            v = v[n:]
            self.tamanho += n

    def ler_tudo(self) -> bytes:
        partes, pos = [], 0
        while True:
            p = os.pread(self.fd, PEDACO, pos)
            if not p:
                return b"".join(partes)
            partes.append(p)
            pos += len(p)

    def materializar(self, destino: Path) -> None:
        """Dá nome ao arquivo (sem sobrescrever: FileExistsError se já existe)."""
        if self.linkavel:
            try:
                os.link(f"/proc/self/fd/{self.fd}", destino, follow_symlinks=True)
                os.chmod(destino, 0o600)
                return
            except FileExistsError:
                raise
            except OSError:
                pass
        fd = os.open(destino, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            pos = 0
            while True:
                p = os.pread(self.fd, PEDACO, pos)
                if not p:
                    break
                os.write(fd, p)
                pos += len(p)
        finally:
            os.close(fd)

    def fechar(self) -> None:
        if self._aberto:
            self._aberto = False
            os.close(self.fd)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.fechar()


class Entrada:
    def __init__(self, raiz: Path, cofre: Cofre | None, agora: Callable[[], datetime] = datetime.now,
                 limite: int = LIMITE_BYTES):
        self.raiz = Path(raiz)
        self.cofre = cofre
        self.agora = agora
        self.limite = limite
        self.chegou = self.raiz / "chegou"
        self.fila = self.raiz / "fila"
        self.organizado = self.raiz / "organizado"
        self.requisicoes = self.raiz / "requisicoes"
        self.tmp = self.raiz / ".tmp"
        self.arq_diario = self.raiz / "diario.jsonl"
        for p in (self.raiz, self.chegou, self.fila, self.organizado, self.requisicoes, self.tmp):
            p.mkdir(mode=0o700, parents=True, exist_ok=True)
        for velho in self.tmp.glob("*.parte"):             # sobra de versões antigas (que gravavam temporário com nome)
            try:
                os.unlink(velho)
            except OSError:
                pass

    # ------------------------------------------------------------------- diário
    def diario(self, evento: str, **campos) -> None:
        """Uma linha por evento. Texto que o filtro reconhece como segredo é trocado por <oculto>."""
        reg = {"ts": self.agora().isoformat(timespec="seconds"), "evento": evento}
        for k, v in campos.items():
            reg[k] = "<oculto>" if isinstance(v, str) and segredos.tem_segredo(v) else v
        linha = (json.dumps(reg, ensure_ascii=False) + "\n").encode("utf-8", "backslashreplace")
        fd = os.open(self.arq_diario, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(fd, linha)
        finally:
            os.close(fd)

    # ----------------------------------------------------------------- recebimento
    def novo_id(self) -> str:
        while True:
            i = f"e-{self.agora():%Y%m%d-%H%M%S}-{_secrets.token_hex(4)}"
            if not (self.fila / f"{i}.json").exists() and not any(self.chegou.glob(f"{i}*")):
                return i

    @staticmethod
    def _pedacos(corpo: BinaryIO, tamanho: int) -> Iterator[bytes]:
        falta = tamanho
        while falta > 0:
            p = corpo.read(min(PEDACO, falta))
            if not p:
                raise Recusado(400, "O envio terminou antes do tamanho anunciado.")
            falta -= len(p)
            yield p

    def _texto_curto(self, campo: str, valor: str | None, maximo: int) -> str:
        valor = (valor or "").strip()
        if len(valor) > maximo:
            raise Recusado(400, f"{campo} com mais de {maximo} caracteres.")
        if tem_controle(valor):
            raise Recusado(400, f"{campo} com caractere de controle ou invisível.")
        if valor and segredos.tem_segredo(valor):
            raise Recusado(422, f"O {campo} parece um segredo. Escreva uma descrição, não o valor.",
                           bloqueado=True, onde=campo)
        return valor

    def receber(self, acao: str, corpo: BinaryIO, tamanho: int, rotulo: str = "", nome: str | None = None,
                com_cofre: bool = False) -> dict:
        if acao not in ACOES:
            raise Recusado(400, "Ação desconhecida.")
        if tamanho <= 0:
            raise Recusado(400, "Nada para enviar.")
        if tamanho > self.limite:
            raise Recusado(413, f"Grande demais (limite de {self.limite // (1024 * 1024)} MB por envio).")
        rotulo = self._texto_curto("rótulo", rotulo, MAX_ROTULO)
        nome_orig = self._texto_curto("nome do arquivo", nome, 200) or None
        limpo = nome_seguro(nome_orig) if nome_orig else None
        if acao == "cofre":
            return self._cofre(corpo, tamanho, rotulo, limpo)
        return self._guardar_ou_organizar(acao, corpo, tamanho, rotulo, limpo, com_cofre)

    # --------------------------------------------------------------------- cofre
    def _cofre(self, corpo, tamanho, rotulo, nome) -> dict:
        if self.cofre is None:
            raise Recusado(503, "O cofre não está configurado.")
        if not rotulo:
            raise Recusado(400, "Dê um rótulo ao que vai para o cofre (o que é isso?).")
        try:
            e = self.cofre.guardar(rotulo, self._pedacos(corpo, tamanho), tipo="arquivo" if nome else "texto", nome=nome)
        except CofreErro as ex:
            raise Recusado(500, f"O cofre recusou: {ex}") from None
        self.diario("cofre", id=e["id"], tipo=e["tipo"], bytes=e["bytes"])
        return {"ok": True, "id": e["id"], "acao": "cofre",
                "mensagem": f"Guardado no cofre ({e['id']}). O valor não é mostrado de volta."}

    # ------------------------------------------------------ organizar / só guardar
    def _bloqueio(self, i: str, acao: str, regras, linhas, tamanho: int, total: int = 1,
                  pode_redigir: bool | None = None) -> Recusado:
        regras = sorted(set(regras))
        if pode_redigir is None:
            pode_redigir = (tamanho <= TEXTO_MAX and total <= MAX_SEGREDOS_REDIGIR
                            and "segredo-partido-em-linhas" not in regras)
        self.diario("bloqueado", id=i, acao=acao, regras=regras, bytes=tamanho)
        return Recusado(
            422, 'Achei algo que parece segredo. Use "Guardar no cofre" para ele'
            + (", ou o botão para guardar os segredos no cofre e seguir só com o resto." if pode_redigir else "."),
            bloqueado=True, pode_redigir=pode_redigir, total=total, regras=regras, linhas=sorted(set(linhas))[:5])

    def _para_tmp(self, corpo, tamanho) -> tuple[_Anonimo | None, set[str]]:
        """Grava o envio num arquivo SEM nome, varrendo os bytes à procura de segredo. Achou: fecha o
        arquivo (ele some), ainda lê o resto (para o navegador receber a resposta) e devolve (None, regras)."""
        anon = _Anonimo(self.tmp)
        v = segredos.Varredor()
        achou = False
        try:
            for p in self._pedacos(corpo, tamanho):
                if achou:
                    continue
                if v.alimentar(p):
                    achou = True
                    anon.fechar()
                    continue
                anon.escrever(p)
        except BaseException:
            anon.fechar()
            raise
        return (None, set(v.regras)) if achou else (anon, set())

    @staticmethod
    def _decodificar(dados: bytes) -> str | None:
        """O texto do arquivo, ou None se for binário. Entende UTF-8 e UTF-16/32 com BOM."""
        for bom, codec in ((b"\xff\xfe\x00\x00", "utf-32"), (b"\x00\x00\xfe\xff", "utf-32"),
                           (b"\xff\xfe", "utf-16"), (b"\xfe\xff", "utf-16")):
            if dados.startswith(bom):
                try:
                    return dados.decode(codec)
                except UnicodeDecodeError:
                    return None
        if b"\x00" in dados[:8192]:
            return None
        try:
            return dados.decode("utf-8")
        except UnicodeDecodeError:
            return None

    def _guardar_ou_organizar(self, acao, corpo, tamanho, rotulo, nome, com_cofre) -> dict:
        i = self.novo_id()
        if tamanho <= TEXTO_MAX:
            return self._pequeno(i, acao, corpo, tamanho, rotulo, nome, com_cofre)
        # grande: em fluxo, só a varredura de bytes; o segundo clique não existe (não se redige binário nem texto enorme)
        anon, regras = self._para_tmp(corpo, tamanho)
        if anon is None:
            raise self._bloqueio(i, acao, regras, [], tamanho, pode_redigir=False)
        with anon:
            return self._finalizar(i, acao, anon, rotulo, nome, None, [])

    def _pequeno(self, i, acao, corpo, tamanho, rotulo, nome, com_cofre) -> dict:
        """Até 5 MB: o conteúdo fica SÓ em memória até passar pelo filtro (nada vai a disco antes), o que
        também dá a contagem exata de segredos. No segundo clique cada segredo vai para o cofre."""
        dados = b"".join(self._pedacos(corpo, tamanho))
        texto = self._decodificar(dados)
        ids: list[str] = []
        if texto is None:                                   # binário: não se redige, só se confere
            v = segredos.Varredor()
            if v.alimentar(dados):
                raise self._bloqueio(i, acao, v.regras, [], tamanho, pode_redigir=False)
            conteudo = dados
        else:
            achados = segredos.procurar(texto)
            conteudo = dados
            if achados:
                redigivel = all(a.redigivel for a in achados) and len(achados) <= MAX_SEGREDOS_REDIGIR
                if not (com_cofre and redigivel):
                    raise self._bloqueio(i, acao, [a.regra for a in achados], [a.linha for a in achados], tamanho,
                                         len(achados), pode_redigir=redigivel)
                texto, ids = self._redigir_no_cofre(texto, rotulo or nome or "texto enviado")
                conteudo = texto.encode("utf-8")
        with _Anonimo(self.tmp) as anon:
            anon.escrever(conteudo)
            return self._finalizar(i, acao, anon, rotulo, nome, texto, ids)

    def _redigir_no_cofre(self, texto: str, rotulo: str) -> tuple[str, list[str]]:
        if self.cofre is None:
            raise Recusado(503, "O cofre não está configurado.")
        ids: list[str] = []

        def armazenar(valor: str, regra: str) -> str:
            e = self.cofre.guardar(f"{rotulo[:80]} · {regra}", [valor.encode("utf-8")], tipo="texto")
            ids.append(e["id"])
            return e["id"]
        try:
            novo, _ = segredos.redigir(texto, armazenar)
        except CofreErro as ex:
            raise Recusado(500, f"O cofre recusou: {ex}") from None
        except segredos.NaoRedigivel:
            raise Recusado(422, "Não consegui separar o segredo do resto. Use o cofre para o texto todo.",
                           bloqueado=True, pode_redigir=False) from None
        if segredos.tem_segredo(novo):
            raise Recusado(422, "Sobrou algo que parece segredo depois de redigir. Use o cofre para o texto todo.",
                           bloqueado=True, pode_redigir=False)
        self.diario("redigido", segredos_no_cofre=ids)
        return novo, ids

    def _finalizar(self, i, acao, anon: _Anonimo, rotulo, nome, texto, ids_cofre) -> dict:
        arquivo = f"{i}-{nome}" if nome else f"{i}.txt"
        anon.materializar(self.chegou / arquivo)           # não sobrescreve
        resposta = {"ok": True, "id": i, "acao": acao}
        if acao == "guardar":
            self.diario("guardado", id=i, arquivo=arquivo, bytes=anon.tamanho)
            resposta["mensagem"] = f"Guardado em chegou/ ({arquivo}), sem IA." + (
                f" {len(ids_cofre)} segredo(s) foram para o cofre." if ids_cofre else "")
            resposta["segredos_no_cofre"] = ids_cofre
            return resposta
        tipo = "texto" if texto is not None else (mimetypes.guess_type(nome or "")[0] or "application/octet-stream")
        trecho, cortado, retido = None, False, False
        if texto is not None:
            corte, cortado = segredos.cortar_em_linha(texto, TRECHO_MODELO)
            trecho = segredos.mascarar_para_o_modelo(corte)      # a visão do agente: agressivamente mascarada
            retido = trecho is None
        item = {"id": i, "recebido": self.agora().isoformat(timespec="seconds"), "rotulo": rotulo or None,
                "nome_original": nome, "arquivo": arquivo, "bytes": anon.tamanho, "tipo": tipo,
                "texto": trecho, "texto_truncado": cortado, "texto_retido": retido,
                "segredos_no_cofre": ids_cofre, "estado": "pendente", "tentativas": 0}
        self.salvar_item(item)
        self.diario("na-fila", id=i, arquivo=arquivo, bytes=anon.tamanho, tipo=tipo, segredos_no_cofre=ids_cofre)
        resposta["mensagem"] = ("Na fila para organizar. O Hermes arruma em até 5 minutos e avisa no WhatsApp."
                                + (f" {len(ids_cofre)} segredo(s) foram para o cofre." if ids_cofre else ""))
        resposta["segredos_no_cofre"] = ids_cofre
        return resposta

    # --------------------------------------------------------------------- fila
    def salvar_item(self, item: dict) -> None:
        caminho = self.fila / f"{item['id']}.json"
        tmp = self.fila / f".{item['id']}.json.tmp"
        dados = (json.dumps(item, ensure_ascii=False, indent=1) + "\n").encode("utf-8", "backslashreplace")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, dados)
        finally:
            os.close(fd)
        os.replace(tmp, caminho)

    def itens(self) -> list[dict]:
        out = []
        for p in sorted(self.fila.glob("e-*.json")):
            try:
                out.append(json.loads(p.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                continue
        return out

    def pendentes(self) -> list[dict]:
        return [i for i in self.itens() if i.get("estado") == "pendente"]
