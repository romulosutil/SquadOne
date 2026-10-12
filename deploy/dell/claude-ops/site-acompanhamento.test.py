#!/usr/bin/env python3
"""Testes do `--resumo-backlog --enviar` do site-acompanhamento.py: python3 deploy/dell/claude-ops/site-acompanhamento.test.py

Só a troca da gravação do aviso pela lib de aviso (11/10/2026): o aviso gravado
pela lib tem o MESMO conteúdo, byte a byte, que o do jeito antigo (o dict que
`resumo_backlog()` devolve), o dell-status aceita o arquivo, sem a lib o
`--enviar` volta ao jeito antigo, e a fila ausente vira uma mensagem (e a saída
1), não um traceback. O resto do script (n8n, planilha, fluxos) tem os testes
embutidos do `--testar-regra` e não é tocado aqui.

Nada toca o Dell: o HOME vira um temporário ANTES do import (o `n8n.py` lê a
chave da API na importação: aqui ela é de mentira), a fila é uma pasta
temporária e `resumo_backlog` nem roda (precisa da planilha).
"""
import atexit
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

_HOME = tempfile.mkdtemp(prefix="site-acompanhamento-teste-home-")
os.environ["HOME"] = os.environ["USERPROFILE"] = _HOME
os.environ.pop("SQUADONE_AVISOS_FILA", None)
(Path(_HOME) / ".config/claude-ops").mkdir(parents=True)
(Path(_HOME) / ".config/claude-ops/n8n-api-key").write_text("chave-de-mentira\n", encoding="utf-8")


def _apagar_se_meu(p: str) -> None:
    if Path(p).name.startswith("site-acompanhamento-teste-") and Path(p).parent == Path(tempfile.gettempdir()):
        shutil.rmtree(p, ignore_errors=True)


atexit.register(_apagar_se_meu, _HOME)

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))  # o script importa o n8n.py ao lado
_spec = importlib.util.spec_from_file_location("site_acompanhamento_sob_teste", AQUI / "site-acompanhamento.py")
sa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sa)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_site_acompanhamento", AQUI.parent / "dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — sem fcntl (Windows)
    ds = None

LIB_DO_REPO = (AQUI.parent / "lib" / "aviso.py").resolve()
TITULO = "🗂️ Site antes da venda: acervo sem automação"


def aviso_de(texto: str) -> dict:
    # A forma exata do que resumo_backlog() devolve.
    return {"titulo": TITULO, "texto": texto, "origem": "site-acompanhamento"}


RESUMO = "\n".join([
    "Enviados antes de 29/09 ficam fora do follow-up automático. Estes 2 ainda estão na raiz de ~/auto-site:",
    "", "*Sem resposta (1)*, com o follow-up pronto no link:",
    "• Padaria da Vó Çà (Joinville), 12 dia(s): https://padaria.vercel.app",
    "  follow-up: https://wa.me/5547999999999?text=Oi%20%22Vó%22%0A",
    "", "*Responderam pelo log do WhatsApp (1)*; a pasta não muda sozinha, mova para _em-conversa/ se fizer sentido:",
    "• Oficina \"Zé\" & Filhos (Blumenau), 15 dia(s): https://oficina.vercel.app",
    "", "Fora da lista (status enviado na planilha, pasta já decidida): _concluidos em 4, _recusados em 2.",
])


class Base(unittest.TestCase):
    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="site-acompanhamento-teste-"))
        self.addCleanup(_apagar_se_meu, str(self.raiz))
        nomes = ("FILA", "PASTAS_DA_LIB")
        self.antes = {k: getattr(sa, k) for k in nomes}
        self.addCleanup(lambda: [setattr(sa, k, v) for k, v in self.antes.items()])
        sa.FILA = self.raiz / "fila"
        self.lib_do_repo = list(self.antes["PASTAS_DA_LIB"])

    def fila(self):
        return sorted(sa.FILA.glob("*.json")) if sa.FILA.is_dir() else []

    def enviar(self, aviso):
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(saida):
            ok = sa.enviar_para_a_fila(aviso)
        return ok, saida.getvalue()

    def gravado_pelo(self, jeito: str, aviso: dict) -> bytes:
        shutil.rmtree(sa.FILA, ignore_errors=True)
        sa.FILA.mkdir()
        sa.PASTAS_DA_LIB = self.lib_do_repo if jeito == "lib" else [self.raiz / "sem-lib"]
        ok, _ = self.enviar(aviso)
        self.assertTrue(ok)
        arquivos = self.fila()
        self.assertEqual(len(arquivos), 1, arquivos)
        return arquivos[0].read_bytes()


class TrocaPelaLib(Base):
    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(sa.lib_de_aviso().__file__).resolve(), LIB_DO_REPO)

    def test_aviso_identico_ao_jeito_antigo(self):
        for texto in (RESUMO, "curto", "aspas \"duplas\", barra \\ e acento: ação", "duas\nlinhas e emoji 🌐"):
            with self.subTest(texto=texto[:30]):
                self.assertEqual(self.gravado_pelo("lib", aviso_de(texto)), self.gravado_pelo("antigo", aviso_de(texto)))

    def test_conteudo_fixado(self):
        esperado = json.dumps(aviso_de("duas\nlinhas"), ensure_ascii=False).encode("utf-8")
        self.assertEqual(self.gravado_pelo("lib", aviso_de("duas\nlinhas")), esperado)
        self.assertEqual(json.loads(esperado)["origem"], "site-acompanhamento")

    def test_nome_e_atomicidade(self):
        sa.FILA.mkdir()
        self.enviar(aviso_de("x"))
        self.assertRegex(self.fila()[0].name, r"^site-acervo-\d+-[0-9a-f]{6}\.json$")
        self.assertEqual([p for p in sa.FILA.iterdir() if not p.name.endswith(".json")], [])

    def test_dois_envios_no_mesmo_segundo_nao_se_sobrescrevem(self):
        sa.FILA.mkdir()
        for i in range(3):
            self.enviar(aviso_de(f"resumo {i}"))
        self.assertEqual(len(self.fila()), 3)

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        sa.FILA.mkdir()
        self.enviar(aviso_de(RESUMO))
        self.assertEqual(len(self.fila()), 1)
        ds.validar_aviso(json.loads(self.fila()[0].read_text(encoding="utf-8")))

    def test_o_dict_do_chamador_nao_e_alterado(self):
        sa.FILA.mkdir()
        aviso = aviso_de("custa R$ 5 " + "y" * 5000)
        copia = dict(aviso)
        self.enviar(aviso)
        self.assertEqual(aviso, copia)

    def test_mensagens_na_saida(self):
        sa.FILA.mkdir()
        ok, saida = self.enviar(aviso_de(RESUMO))
        self.assertTrue(ok)
        self.assertEqual(saida.strip(), "-> na fila de avisos")


class Falhas(Base):
    def test_fila_ausente_vira_mensagem_e_false_sem_criar_a_pasta(self):
        ok, saida = self.enviar(aviso_de(RESUMO))
        self.assertFalse(ok)
        self.assertFalse(sa.FILA.exists())
        self.assertIn("NÃO entrou na fila de avisos (fila_ausente)", saida)

    def test_texto_longo_e_cortado_com_aviso_na_saida(self):
        sa.FILA.mkdir()
        ok, saida = self.enviar(aviso_de("início do acervo\n" + "• lead de teste, 9 dia(s): https://x.vercel.app\n" * 200))
        self.assertTrue(ok)
        d = json.loads(self.fila()[0].read_text(encoding="utf-8"))
        self.assertTrue(d["texto"].startswith("início do acervo"))
        self.assertTrue(d["texto"].endswith("… (cortado)"))
        self.assertLessEqual(len(d["texto"]), 4000)
        self.assertIn("texto cortado em 4000 caracteres", saida)

    def test_valor_em_reais_vira_valor_com_nota(self):
        sa.FILA.mkdir()
        ok, saida = self.enviar(aviso_de("• Loja R$ 5 Ltda (Joinville), 3 dia(s): https://x.vercel.app"))
        self.assertTrue(ok)
        d = json.loads(self.fila()[0].read_text(encoding="utf-8"))
        self.assertNotRegex(d["texto"], r"R\s*\$")
        self.assertIn("[valor]", d["texto"])
        self.assertIn("virou [valor]", saida)

    def test_texto_sem_valor_nao_e_mexido(self):
        sa.FILA.mkdir()
        self.enviar(aviso_de("  dois  espaços  "))
        self.assertEqual(json.loads(self.fila()[0].read_text(encoding="utf-8"))["texto"], "  dois  espaços  ")


class SemLib(Base):
    def test_sem_copia_volta_ao_jeito_antigo(self):
        sa.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        self.assertIsNone(sa.lib_de_aviso())
        sa.FILA.mkdir()  # o antigo nunca criou a pasta
        ok, saida = self.enviar(aviso_de("x"))
        self.assertTrue(ok)
        self.assertEqual(saida.strip(), "-> na fila de avisos")
        self.assertEqual(len(self.fila()), 1)
        self.assertRegex(self.fila()[0].name, r"^site-acervo-\d+\.json$")

    def test_copia_quebrada_volta_ao_jeito_antigo(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("def x(:\n", encoding="utf-8")
        sa.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(sa.lib_de_aviso())
        sa.FILA.mkdir()
        ok, _ = self.enviar(aviso_de("x"))
        self.assertTrue(ok)
        self.assertEqual(len(self.fila()), 1)

    def test_copia_quebrada_cai_na_seguinte(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
        sa.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(sa.lib_de_aviso().__file__).resolve(), LIB_DO_REPO)

    def test_sem_a_lib_o_texto_com_valor_vai_como_sempre(self):
        sa.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        sa.FILA.mkdir()
        self.enviar(aviso_de("custa R$ 5"))
        self.assertEqual(json.loads(self.fila()[0].read_text(encoding="utf-8"))["texto"], "custa R$ 5")

    def test_sem_a_lib_a_fila_ausente_continua_levantando_como_antes(self):
        # O jeito antigo era assim (FileNotFoundError); a reserva não muda nada.
        sa.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        with self.assertRaises(OSError):
            self.enviar(aviso_de("x"))


class PontaAPonta(unittest.TestCase):
    """O __main__ de verdade (`--resumo-backlog [--enviar]`), com a API do n8n, a
    planilha e o node dublês: a fila é a do HOME de teste (~/.local/share/avisos/fila)."""

    def setUp(self):
        self.fila = Path.home() / ".local/share/avisos/fila"
        self.assertEqual(self.fila.parts[: len(Path(_HOME).parts)], Path(_HOME).parts)  # nunca a fila real
        self.addCleanup(shutil.rmtree, self.fila.parent, True)
        shutil.rmtree(self.fila.parent, ignore_errors=True)
        cabecalho = [["status", "enviado_em", "place_id", "nome", "cidade", "site_url", "respondeu_em"]]

        class Proxy:
            def __init__(self, ids): pass
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def get(self, caminho): return {"values": cabecalho}

        import types
        falso = types.ModuleType("sheets_proxy")
        falso.SheetsProxy = Proxy
        antes_proxy = sys.modules.get("sheets_proxy")
        sys.modules["sheets_proxy"] = falso
        self.addCleanup(lambda: sys.modules.__setitem__("sheets_proxy", antes_proxy) if antes_proxy else sys.modules.pop("sheets_proxy", None))
        n8n = sys.modules["n8n"]
        antes_api = n8n.api
        n8n.api = lambda metodo, caminho, corpo=None: {"data": [{"name": "00 · Avisar falha pelo Hermes", "id": "wf"}]}
        self.addCleanup(setattr, n8n, "api", antes_api)
        import subprocess
        antes_run = subprocess.run
        subprocess.run = lambda *a, **k: types.SimpleNamespace(stdout="[]", returncode=0)
        self.addCleanup(setattr, subprocess, "run", antes_run)

    def rodar(self, *args):
        import runpy
        argv_antes = sys.argv
        sys.argv = ["site-acompanhamento.py", "--resumo-backlog", *args]
        saida = io.StringIO()
        try:
            with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(saida):
                try:
                    runpy.run_path(str(AQUI / "site-acompanhamento.py"), run_name="__main__")
                    codigo = 0
                except SystemExit as e:
                    codigo = e.code or 0
        finally:
            sys.argv = argv_antes
        return codigo, saida.getvalue()

    def test_sem_enviar_so_imprime_e_nao_toca_a_fila(self):
        self.fila.mkdir(parents=True)
        codigo, saida = self.rodar()
        self.assertEqual(codigo, 0)
        self.assertIn("Site antes da venda: acervo sem automação", saida)
        self.assertEqual(list(self.fila.iterdir()), [])

    def test_enviar_poe_na_fila_pela_lib(self):
        self.fila.mkdir(parents=True)
        codigo, saida = self.rodar("--enviar")
        self.assertEqual(codigo, 0)
        self.assertIn("-> na fila de avisos", saida)
        arquivos = list(self.fila.glob("*.json"))
        self.assertEqual(len(arquivos), 1)
        self.assertRegex(arquivos[0].name, r"^site-acervo-\d+-[0-9a-f]{6}\.json$")
        d = json.loads(arquivos[0].read_text(encoding="utf-8"))
        self.assertEqual((d["titulo"], d["origem"]), (TITULO, "site-acompanhamento"))
        self.assertIn("Enviados antes de 29/09", d["texto"])

    def test_enviar_com_a_fila_ausente_sai_com_1_e_a_mensagem(self):
        codigo, saida = self.rodar("--enviar")
        self.assertEqual(codigo, 1)
        self.assertIn("NÃO entrou na fila de avisos (fila_ausente)", saida)
        self.assertFalse(self.fila.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
