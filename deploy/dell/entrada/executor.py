#!/usr/bin/env python3
"""Executor determinístico da Entrada: valida o plano que o modelo PROPÕE e só então age.

O modelo nunca toca em arquivo. Ele devolve um JSON por item; este módulo confere cada campo contra
uma lista de permissão e executa, ou recusa. Prompt nenhum é barreira: a barreira é este código.

Plano (campos que valem; qualquer outro é ignorado):
  id       o id do item da fila
  acao     mover | resumir | registrar-projeto
  destino  pasta relativa. Sob organizado/ ou, se começar com "arquivo/", sob ~/Arquivo/<hoje>/
  nome     nome final do arquivo (um só componente; a extensão tem que ser a do original)
  rotulo   texto curto (até 80)
  resumo   até 2000; obrigatório em `resumir`

O que o executor garante:
- só duas raízes: ~/Mel/Entrada/organizado/ e ~/Arquivo/<hoje>/ (nada fora delas);
- sem `..`, caminho absoluto ou link simbólico: as pastas são abertas UMA A UMA por descritor com
  O_NOFOLLOW e tudo o que se cria usa `dir_fd`, então não há janela entre checar e usar;
- sem sobrescrever (nome repetido ganha " (2)", " (3)"...);
- sem apagar: o item sai de chegou/ por mover, nunca por remoção;
- nome de pasta curto e sem espaço, nome de arquivo sem nome reservado do Windows e com a mesma
  extensão do original (uma injeção não troca o tipo do arquivo);
- nenhum texto do plano (nem o resumo) pode parecer segredo nem ter caractere de controle, invisível,
  de direção ou substituto solto;
- só os 3 verbos acima. Qualquer outro é recusado.
"""
from __future__ import annotations

import errno
import os
import re
import stat
from datetime import date
from pathlib import Path
from typing import Callable

import segredos
from entrada import Entrada, tem_controle

ACOES = ("mover", "resumir", "registrar-projeto")
_PASTA = re.compile(r"[0-9A-Za-zÀ-ÿ][0-9A-Za-zÀ-ÿ._\-]{0,29}")
_NOME = re.compile(r"[0-9A-Za-zÀ-ÿ][0-9A-Za-zÀ-ÿ ._()+\-]{0,99}")
_RESERVADO = re.compile(r"(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?", re.I)
MAX_PROFUNDIDADE = 4
MAX_ROTULO = 80
MAX_RESUMO = 2000
_FLAGS_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


class PlanoInvalido(Exception):
    pass


def _componente_ok(c: str, regex: re.Pattern) -> bool:
    return bool(regex.fullmatch(c)) and c not in (".", "..") and not _RESERVADO.fullmatch(c) and c[-1] not in ". "


class Executor:
    def __init__(self, entrada: Entrada, arquivo: Path, hoje: Callable[[], date] = date.today):
        self.entrada = entrada
        self.arquivo = Path(arquivo)           # ~/Arquivo
        self.hoje = hoje

    # ---------------------------------------------------------------- validação
    @staticmethod
    def _texto(plano: dict, campo: str, maximo: int, obrigatorio: bool = True, quebra: bool = False,
               por_partes: bool = False) -> str:
        v = plano.get(campo)
        if v is None or v == "":
            if obrigatorio:
                raise PlanoInvalido(f"{campo} ausente")
            return ""
        if not isinstance(v, str):
            raise PlanoInvalido(f"{campo} não é texto")
        v = v.strip()
        if len(v) > maximo:
            raise PlanoInvalido(f"{campo} com mais de {maximo} caracteres")
        if tem_controle(v, permite_quebra=quebra):
            raise PlanoInvalido(f"{campo} com caractere de controle ou invisível")
        # caminho: a barra junta as partes numa "cadeia longa" que não existe; cada pasta é conferida sozinha
        # campo de uma linha (destino, nome, rótulo): modo estrito; só o resumo, que é prosa, usa o filtro normal
        if any(segredos.tem_segredo(p, estrito=not quebra) for p in (v.split("/") if por_partes else [v])):
            raise PlanoInvalido(f"{campo} parece um segredo")
        return v

    @staticmethod
    def _extensoes_permitidas(item: dict) -> set[str]:
        original = item.get("nome_original") or item.get("arquivo") or ""
        ext = Path(original).suffix.lower() if isinstance(original, str) else ""
        return {ext} | ({".txt", ".md"} if ext == "" else set())

    def validar(self, plano: object, item: dict) -> dict:
        if not isinstance(plano, dict):
            raise PlanoInvalido("o plano não é um objeto")
        if plano.get("id") != item["id"]:
            raise PlanoInvalido("id do plano não é o do item")
        acao = plano.get("acao")
        if acao not in ACOES:
            raise PlanoInvalido("ação fora da lista permitida")
        destino = self._texto(plano, "destino", 200, por_partes=True)
        if destino.startswith("/") or "\\" in destino or "//" in destino or destino.endswith("/"):
            raise PlanoInvalido("destino com forma inválida")
        partes = destino.split("/")
        raiz_arquivo = partes[0] == "arquivo"
        sub = partes[1:] if raiz_arquivo else partes
        if len(sub) > MAX_PROFUNDIDADE:
            raise PlanoInvalido("destino fundo demais")
        if not all(_componente_ok(p, _PASTA) for p in sub):
            raise PlanoInvalido("componente de destino inválido")
        nome = self._texto(plano, "nome", 100)
        if "/" in nome or not _componente_ok(nome, _NOME):
            raise PlanoInvalido("nome inválido")
        if Path(nome).suffix.lower() not in self._extensoes_permitidas(item):
            raise PlanoInvalido("a extensão do nome tem que ser a do arquivo original")
        rotulo = self._texto(plano, "rotulo", MAX_ROTULO, obrigatorio=False)
        resumo = self._texto(plano, "resumo", MAX_RESUMO, obrigatorio=(acao == "resumir"), quebra=True)
        return {"id": item["id"], "acao": acao, "arquivo_raiz": raiz_arquivo, "sub": sub,
                "nome": nome, "rotulo": rotulo, "resumo": resumo}

    # ------------------------------------------------- operações por descritor de pasta
    @staticmethod
    def _abrir_raiz(caminho: Path, criar: bool = False) -> int:
        try:
            return os.open(caminho, _FLAGS_DIR)
        except FileNotFoundError:
            if not criar:
                raise PlanoInvalido("a raiz do destino não existe") from None
            os.mkdir(caminho, 0o700)
            return os.open(caminho, _FLAGS_DIR)
        except OSError as e:
            if e.errno in (errno.ELOOP, errno.ENOTDIR):
                raise PlanoInvalido("a raiz do destino não é uma pasta comum") from None
            raise

    @staticmethod
    def _descer(fd_raiz: int, partes: list[str]) -> int:
        """Abre raiz/partes... uma pasta por vez (criando as que faltam), recusando link em qualquer degrau.
        Devolve um descritor novo da pasta final; o chamador fecha."""
        fd = os.dup(fd_raiz)
        try:
            for p in partes:
                try:
                    novo = os.open(p, _FLAGS_DIR, dir_fd=fd)
                except FileNotFoundError:
                    os.mkdir(p, 0o700, dir_fd=fd)
                    novo = os.open(p, _FLAGS_DIR, dir_fd=fd)
                except OSError as e:
                    if e.errno in (errno.ELOOP, errno.ENOTDIR):
                        raise PlanoInvalido("degrau do destino é link ou arquivo") from None
                    raise
                os.close(fd)
                fd = novo
            return fd
        except BaseException:
            os.close(fd)
            raise

    @staticmethod
    def _existe(fd: int, nome: str) -> bool:
        try:
            os.stat(nome, dir_fd=fd, follow_symlinks=False)
            return True
        except FileNotFoundError:
            return False

    def _livre(self, fd: int, nome: str) -> str:
        base, ponto, ext = nome.rpartition(".")
        if not ponto or not base:
            base, ext = nome, ""
        for n in range(1, 100):
            cand = nome if n == 1 else (f"{base} ({n}).{ext}" if ext else f"{base} ({n})")
            if not self._existe(fd, cand):
                return cand
        raise PlanoInvalido("nome repetido demais")

    def _mover(self, fd_origem: int, nome_origem: str, fd_dest: int, nome: str) -> str:
        for _ in range(5):
            cand = self._livre(fd_dest, nome)
            try:
                os.link(nome_origem, cand, src_dir_fd=fd_origem, dst_dir_fd=fd_dest, follow_symlinks=False)
            except FileExistsError:
                continue
            except OSError as e:                             # outro disco (ou sem hardlink): cópia exclusiva
                if e.errno not in (errno.EXDEV, errno.EPERM, errno.EMLINK, errno.ENOTSUP):
                    raise
                try:
                    dst = os.open(cand, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd_dest)
                except FileExistsError:
                    continue
                try:
                    src = os.open(nome_origem, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd_origem)
                    try:
                        while True:
                            p = os.read(src, 1 << 20)
                            if not p:
                                break
                            os.write(dst, p)
                    finally:
                        os.close(src)
                except BaseException:
                    os.close(dst)
                    os.unlink(cand, dir_fd=fd_dest)          # só a cópia parcial que acabamos de criar
                    raise
                os.close(dst)
            fd = os.open(cand, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd_dest)
            try:
                os.fchmod(fd, 0o600)
            finally:
                os.close(fd)
            os.unlink(nome_origem, dir_fd=fd_origem)         # mover: sai de chegou/, nada é apagado
            return cand
        raise PlanoInvalido("não achei nome livre")

    def _escrever_texto(self, fd_dir: int, nome: str, texto: str) -> str:
        dados = texto.encode("utf-8")
        for _ in range(5):
            cand = self._livre(fd_dir, nome)
            try:
                fd = os.open(cand, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd_dir)
            except FileExistsError:
                continue
            try:
                os.write(fd, dados)
            finally:
                os.close(fd)
            return cand
        raise PlanoInvalido("não achei nome livre")

    def _nome_origem(self, item: dict, fd_chegou: int) -> str:
        nome = item.get("arquivo")
        if not isinstance(nome, str) or not nome or nome != os.path.basename(nome) or nome.startswith("."):
            raise PlanoInvalido("origem inválida")
        try:
            modo = os.stat(nome, dir_fd=fd_chegou, follow_symlinks=False).st_mode
        except FileNotFoundError:
            raise PlanoInvalido("o arquivo do item não está mais em chegou/") from None
        if not stat.S_ISREG(modo):
            raise PlanoInvalido("origem não é arquivo comum")
        return nome

    # ----------------------------------------------------------------- texto gerado
    @staticmethod
    def _md(pv: dict, item: dict, titulo: str) -> str:
        linhas = [f"# {pv['rotulo'] or item.get('nome_original') or item['id']}", "",
                  f"_{titulo}, gerado pelo agente da Entrada a partir de conteúdo externo (não confiável). Item {item['id']}._", ""]
        if pv["resumo"]:
            linhas += [pv["resumo"], ""]
        return "\n".join(linhas)

    @staticmethod
    def _conferir_texto(texto: str) -> str:
        if segredos.tem_segredo(texto):
            raise PlanoInvalido("o texto gerado parece segredo")
        try:
            texto.encode("utf-8")
        except UnicodeEncodeError:
            raise PlanoInvalido("o texto gerado não é UTF-8 válido") from None
        return texto

    # ---------------------------------------------------------------- execução
    def executar(self, pv: dict, item: dict) -> dict:
        # tudo que pode falhar por causa do TEXTO é conferido antes de mover qualquer coisa
        md = self._conferir_texto(self._md(pv, item, {"resumir": "Resumo", "registrar-projeto": "Proposta de projeto"}.get(pv["acao"], ""))) \
            if pv["acao"] in ("resumir", "registrar-projeto") else None
        fd_chegou = self._abrir_raiz(self.entrada.chegou)
        fd_dest = fd_org = fd_prop = fd_raiz = -1
        try:
            nome_origem = self._nome_origem(item, fd_chegou)
            if pv["arquivo_raiz"]:
                dia = self.hoje().isoformat()                # uma leitura só: perto da meia-noite não troca no meio
                fd_raiz = self._abrir_raiz(self.arquivo, criar=True)
                fd_dest = self._descer(fd_raiz, [dia, *pv["sub"]])
                rotulo_raiz = f"Arquivo/{dia}"
            else:
                fd_raiz = self._abrir_raiz(self.entrada.organizado)
                fd_dest = self._descer(fd_raiz, pv["sub"])
                rotulo_raiz = "organizado"
            if pv["acao"] == "registrar-projeto":              # antes de mover: se faltar permissão, nada se move
                fd_org = self._abrir_raiz(self.entrada.organizado)
                fd_prop = self._descer(fd_org, ["_propostas"])
            nome_final = self._mover(fd_chegou, nome_origem, fd_dest, pv["nome"])
            rel = "/".join([rotulo_raiz, *pv["sub"], nome_final])
            res = {"id": pv["id"], "acao": pv["acao"], "para": rel}
            item["estado"] = "organizado"
            item["destino"] = rel
            self.entrada.salvar_item(item)
            self.entrada.diario("organizado", id=pv["id"], acao=pv["acao"], destino=rel, rotulo=pv["rotulo"] or None)
            try:                                                # o arquivo já está no lugar; o texto extra é um bônus
                if pv["acao"] == "resumir":
                    res["resumo_em"] = self._escrever_texto(fd_dest, f"{Path(nome_final).stem}.resumo.md", md)
                elif pv["acao"] == "registrar-projeto":
                    res["proposta_em"] = self._escrever_texto(fd_prop, f"projeto-{pv['id']}.md", md)
            except (OSError, PlanoInvalido) as e:
                self.entrada.diario("texto-extra-falhou", id=pv["id"], erro=type(e).__name__)
            return res
        finally:
            for fd in (fd_chegou, fd_dest, fd_org, fd_prop, fd_raiz):
                if fd >= 0:
                    os.close(fd)

    def aplicar(self, plano: object, item: dict) -> dict:
        """validar + executar. Levanta PlanoInvalido; a validação não deixa nada pela metade."""
        return self.executar(self.validar(plano, item), item)
