#!/usr/bin/env python3
"""Testes da linha de comando do cofre. python3 cofre_cli.test.py  (precisa do age)

`cofre ler` é testado de verdade: sem terminal tem que RECUSAR, e num pseudo-terminal
(pty) tem que pedir o id e só então mostrar. Segredos falsos.
"""
import os
import pty
import select
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
import cofre as cofre_mod  # noqa: E402

TEM_AGE = bool(shutil.which("age") and shutil.which("age-keygen"))
SEGREDO = "valor-bem-secreto-do-teste-0042"


def chave_nova(caminho: Path) -> str:
    subprocess.run(["age-keygen", "-o", str(caminho)], check=True, capture_output=True)
    return subprocess.run(["age-keygen", "-y", str(caminho)], check=True, capture_output=True, text=True).stdout.strip()


@unittest.skipUnless(TEM_AGE, "age não instalado")
class Cli(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cofre-cli-teste-"))
        raiz = self.tmp / "Cofre"
        raiz.mkdir(mode=0o700)
        self.ident = self.tmp / "mel.txt"
        (raiz / "recipients.txt").write_text(chave_nova(self.ident) + "\n")
        self.cofre = cofre_mod.Cofre(raiz, self.ident)
        self.item = self.cofre.guardar("senha do banco X", SEGREDO.encode(), nome=None)
        self.env = dict(os.environ, COFRE_RAIZ=str(raiz), ENTRADA_IDENTIDADE=str(self.ident),
                        ENTRADA_RAIZ=str(self.tmp / "Entrada"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def cli(self, *args, entrada=None):
        return subprocess.run([sys.executable, str(AQUI / "cofre_cli.py"), *args], env=self.env, capture_output=True,
                              text=True, input=entrada if entrada is not None else "", timeout=60)

    def cli_em_terminal(self, *args, digitar):
        """Roda num pseudo-terminal: devolve (saida_completa, codigo_de_saida)."""
        pid, fd = pty.fork()
        if pid == 0:
            os.execve(sys.executable, [sys.executable, str(AQUI / "cofre_cli.py"), *args], self.env)
        saida = b""
        enviado = False
        fim = time.time() + 30
        while time.time() < fim:
            r, _, _ = select.select([fd], [], [], 0.5)
            if r:
                try:
                    dado = os.read(fd, 4096)
                except OSError:
                    break
                if not dado:
                    break
                saida += dado
                if not enviado and b"confirmar" in saida:
                    os.write(fd, (digitar + "\n").encode())
                    enviado = True
            else:
                done, status = os.waitpid(pid, os.WNOHANG)
                if done:
                    return saida.decode(errors="replace"), os.waitstatus_to_exitcode(status)
        _, status = os.waitpid(pid, 0)
        return saida.decode(errors="replace"), os.waitstatus_to_exitcode(status)

    def test_listar_mostra_rotulo_e_nunca_o_valor(self):
        r = self.cli("listar")
        self.assertEqual(r.returncode, 0)
        self.assertIn("senha do banco X", r.stdout)
        self.assertIn(self.item["id"], r.stdout)
        self.assertNotIn(SEGREDO, r.stdout + r.stderr)

    def test_listar_vazio(self):
        for p in (self.tmp / "Cofre").glob("*.age"):
            p.unlink()
        (self.tmp / "Cofre/indice.json").unlink()
        self.assertIn("vazio", self.cli("listar").stdout)

    def test_ler_sem_terminal_recusa_e_nao_mostra_nada(self):
        r = self.cli("ler", self.item["id"], entrada=self.item["id"] + "\n")
        self.assertEqual(r.returncode, 2)
        self.assertNotIn(SEGREDO, r.stdout + r.stderr)
        self.assertIn("terminal", r.stderr)

    def test_ler_no_terminal_pede_o_id_e_mostra(self):
        saida, codigo = self.cli_em_terminal("ler", self.item["id"], digitar=self.item["id"])
        self.assertEqual(codigo, 0, saida)
        self.assertIn(SEGREDO, saida)
        self.assertIn("senha do banco X", saida)
        diario = (self.tmp / "Entrada/diario.jsonl").read_text()
        self.assertIn("cofre-lido", diario)
        self.assertNotIn(SEGREDO, diario)

    def test_ler_com_id_errado_na_confirmacao_cancela(self):
        saida, codigo = self.cli_em_terminal("ler", self.item["id"], digitar="nao-e-o-id")
        self.assertEqual(codigo, 1)
        self.assertNotIn(SEGREDO, saida)

    def test_ler_para_arquivo_nao_mostra_na_tela_e_nao_sobrescreve(self):
        destino = self.tmp / "saida.txt"
        saida, codigo = self.cli_em_terminal("ler", self.item["id"], "-o", str(destino), digitar=self.item["id"])
        self.assertEqual(codigo, 0, saida)
        self.assertNotIn(SEGREDO, saida)
        self.assertEqual(destino.read_text(), SEGREDO)
        self.assertEqual(oct(destino.stat().st_mode & 0o777), "0o600")
        saida, codigo = self.cli_em_terminal("ler", self.item["id"], "-o", str(destino), digitar=self.item["id"])
        self.assertEqual(codigo, 1)

    def test_adicionar_destinatario_valida_e_nao_duplica(self):
        outra = self.tmp / "romulo.txt"
        pub = chave_nova(outra)
        for ruim in ("AGE-SECRET" + "-KEY-1" + "Q" * 40, "age1curta", "ssh-ed25519 AAAA", ""):
            r = self.cli("adicionar-destinatario", ruim)
            self.assertEqual(r.returncode, 1, ruim)
            self.assertNotIn("Q" * 40, r.stdout + r.stderr)
        self.assertEqual(len(self.cofre.destinatarios()), 1)
        r = self.cli("adicionar-destinatario", pub)
        self.assertEqual(r.returncode, 0)
        self.assertIn("cofre recifrar", r.stdout)
        self.assertEqual(len(self.cofre.destinatarios()), 2)
        self.assertIn("já está", self.cli("adicionar-destinatario", pub).stdout)
        self.assertEqual(len(self.cofre.destinatarios()), 2)
        self.assertEqual(oct((self.tmp / "Cofre/recipients.txt").stat().st_mode & 0o777), "0o600")

    def test_adicionar_com_recifrar_abre_o_cofre_para_a_chave_nova(self):
        outra = self.tmp / "romulo.txt"
        pub = chave_nova(outra)
        r = self.cli("adicionar-destinatario", pub, "--recifrar")
        self.assertEqual(r.returncode, 0, r.stderr)
        dec = subprocess.run(["age", "-d", "-i", str(outra), str(self.tmp / "Cofre" / f"{self.item['id']}.age")],
                             capture_output=True, check=True).stdout.decode()
        self.assertEqual(dec, SEGREDO)

    def test_destinatarios_lista_so_chaves_publicas(self):
        r = self.cli("destinatarios")
        self.assertTrue(all(l.startswith("age1") for l in r.stdout.split()))
        self.assertNotIn("AGE-SECRET", r.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
