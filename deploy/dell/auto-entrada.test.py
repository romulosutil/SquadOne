#!/usr/bin/env python3
"""Testes do auto-entrada.py: python3 deploy/dell/auto-entrada.test.py

O que importa aqui é a troca do avisar() pela lib de aviso (11/10/2026): o
aviso gravado pela lib é IDÊNTICO, byte a byte, ao que o jeito antigo gravava,
e sem a lib (cópia ausente ou quebrada) o script volta ao jeito antigo.

Nada toca o Dell: o HOME vira um temporário ANTES do import, e cada teste
aponta ENTRADA, ERRO, AUTO e FILA_AVISOS para a própria raiz `auto-entrada-teste-*`.
"""
import atexit
import base64
import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_HOME = tempfile.mkdtemp(prefix="auto-entrada-teste-home-")
os.environ["HOME"] = os.environ["USERPROFILE"] = _HOME
os.environ.pop("SQUADONE_AVISOS_FILA", None)


def _apagar_se_meu(p: str) -> None:
    if Path(p).name.startswith("auto-entrada-teste-") and Path(p).parent == Path(tempfile.gettempdir()):
        shutil.rmtree(p, ignore_errors=True)


atexit.register(_apagar_se_meu, _HOME)

AQUI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("auto_entrada", AQUI / "auto-entrada.py")
ae = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ae)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_auto_entrada", AQUI / "dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — sem fcntl (Windows)
    ds = None

TEXTOS = [
    "Pacote da pasta auto não pôde ser gravado (x.json): 'caminho'",
    "aspas \"duplas\", barra \\ e acento: ação, coração",
    "duas\nlinhas e emoji 🌐",
    "caminho recusado: '../fora'",
]


class Base(unittest.TestCase):
    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="auto-entrada-teste-"))
        self.addCleanup(_apagar_se_meu, str(self.raiz))
        self.antes = {k: getattr(ae, k) for k in ("ENTRADA", "ERRO", "AUTO", "FILA_AVISOS", "PASTAS_DA_LIB")}
        self.addCleanup(lambda: [setattr(ae, k, v) for k, v in self.antes.items()])
        ae.ENTRADA, ae.ERRO, ae.AUTO = self.raiz / "entrada", self.raiz / "erro", self.raiz / "auto-site"
        ae.FILA_AVISOS = self.raiz / "fila"
        ae.ENTRADA.mkdir()
        ae.AUTO.mkdir()
        self.lib_do_repo = list(self.antes["PASTAS_DA_LIB"])

    def fila(self):
        return sorted(ae.FILA_AVISOS.glob("*.json")) if ae.FILA_AVISOS.is_dir() else []

    def avisar(self, texto):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            ae.avisar(texto)
        return err.getvalue()

    def gravado_pelo(self, jeito: str, texto: str) -> bytes:
        """O aviso gravado com a lib ('lib') ou sem ela ('antigo'), numa fila limpa."""
        shutil.rmtree(ae.FILA_AVISOS, ignore_errors=True)
        ae.FILA_AVISOS.mkdir()
        ae.PASTAS_DA_LIB = self.lib_do_repo if jeito == "lib" else [self.raiz / "sem-lib"]
        self.avisar(texto)
        arquivos = self.fila()
        self.assertEqual(len(arquivos), 1, arquivos)
        return arquivos[0].read_bytes()


class TrocaPelaLib(Base):
    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(ae.lib_de_aviso().__file__).resolve(), (AQUI / "lib/aviso.py").resolve())

    def test_aviso_identico_ao_jeito_antigo(self):
        for texto in TEXTOS:
            with self.subTest(texto=texto):
                self.assertEqual(self.gravado_pelo("lib", texto), self.gravado_pelo("antigo", texto))

    def test_conteudo_fixado(self):
        esperado = '{"titulo": "🌐 Sites", "texto": "duas\\nlinhas e emoji 🌐", "origem": "auto-entrada"}'
        self.assertEqual(self.gravado_pelo("lib", "duas\nlinhas e emoji 🌐"), esperado.encode("utf-8"))

    def test_nome_e_atomicidade(self):
        ae.FILA_AVISOS.mkdir()
        self.avisar("x")
        self.assertRegex(self.fila()[0].name, r"^auto-entrada-\d+-[0-9a-f]{6}\.json$")
        self.assertEqual([p for p in ae.FILA_AVISOS.iterdir() if not p.name.endswith(".json")], [])

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        ae.FILA_AVISOS.mkdir()
        self.avisar(TEXTOS[0])
        ds.validar_aviso(json.loads(self.fila()[0].read_text(encoding="utf-8")))

    def test_com_a_lib_a_fila_ausente_nao_e_criada_e_nao_levanta(self):
        err = self.avisar("x")
        self.assertFalse(ae.FILA_AVISOS.exists())
        self.assertIn("fila_ausente", err)

    def test_texto_longo_e_cortado_em_vez_de_recusado_pelo_dell_status(self):
        # Diferença de propósito: o jeito antigo gravava 5000 caracteres e o
        # dell-status recusava (verificação vermelha); a lib corta e avisa.
        ae.FILA_AVISOS.mkdir()
        self.avisar("y" * 5000)
        d = json.loads(self.fila()[0].read_text(encoding="utf-8"))
        self.assertTrue(d["texto"].endswith("… (cortado)"))
        self.assertLessEqual(len(d["texto"]), 4000)


class SemLib(Base):
    def test_sem_copia_volta_ao_jeito_antigo(self):
        ae.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        self.assertIsNone(ae.lib_de_aviso())
        self.avisar("x")  # o antigo cria a pasta da fila
        self.assertEqual(len(self.fila()), 1)
        self.assertRegex(self.fila()[0].name, r"^auto-entrada-\d+\.json$")

    def test_copia_quebrada_volta_ao_jeito_antigo(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("def x(:\n", encoding="utf-8")
        ae.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(ae.lib_de_aviso())
        ae.FILA_AVISOS.mkdir()
        self.avisar("x")
        self.assertEqual(len(self.fila()), 1)

    def test_copia_quebrada_cai_na_seguinte(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
        ae.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(ae.lib_de_aviso().__file__).resolve(), (AQUI / "lib/aviso.py").resolve())


class Rodada(Base):
    def pacote(self, nome, d):
        (ae.ENTRADA / nome).write_text(json.dumps(d), encoding="utf-8")

    def test_pacote_bom_e_ruim(self):
        ae.FILA_AVISOS.mkdir()
        self.pacote("1-bom.json", {"caminho": "lead-a/content.md", "base64": base64.b64encode(b"oi").decode(),
                                   "pastas": ["Fotos", "Logotipo"]})
        self.pacote("2-ruim.json", {"caminho": "../fora", "base64": ""})
        with contextlib.redirect_stderr(io.StringIO()):
            ae.main()
        self.assertEqual((ae.AUTO / "lead-a/content.md").read_bytes(), b"oi")
        self.assertTrue((ae.AUTO / "lead-a/Fotos").is_dir())
        self.assertEqual(list(ae.ENTRADA.iterdir()), [])
        self.assertTrue((ae.ERRO / "2-ruim.json").is_file())
        avisos = [json.loads(p.read_text(encoding="utf-8")) for p in self.fila()]
        self.assertEqual(len(avisos), 1)
        self.assertEqual(avisos[0]["origem"], "auto-entrada")
        self.assertIn("2-ruim.json", avisos[0]["texto"])

    def test_fila_ausente_nao_para_a_rodada(self):
        # O jeito antigo criava a pasta da fila (que é do dell-status, 2770) e um
        # OSError ao gravar o aviso, dentro do except, derrubava a rodada. Com a
        # lib a pasta não é criada, nada levanta e o pacote seguinte é gravado.
        self.pacote("1-ruim.json", {"caminho": "../fora", "base64": ""})
        self.pacote("2-bom.json", {"caminho": "lead-b/content.md", "base64": base64.b64encode(b"ok").decode()})
        with contextlib.redirect_stderr(io.StringIO()):
            ae.main()
        self.assertEqual((ae.AUTO / "lead-b/content.md").read_bytes(), b"ok")
        self.assertFalse(ae.FILA_AVISOS.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
