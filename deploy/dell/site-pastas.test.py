#!/usr/bin/env python3
"""Testes do site-pastas.py: python3 deploy/dell/site-pastas.test.py

O que importa aqui é o avisar() pela lib de aviso (11/10/2026): o aviso gravado
é o do formato da fila, o dell-status aceita o arquivo, sem a lib (cópia ausente
ou quebrada) nada é gravado (uma linha no stderr) e a fila ausente não derruba a
rodada dos botões.

Nada toca o Dell: o HOME vira um temporário ANTES do import, cada teste aponta
AUTO, ACOES, ERRO, PILHA, REGISTRO e FILA_AVISOS para a própria raiz
`site-pastas-teste-*`, e o `systemctl` que o script chama é dublê.
"""
import atexit
import contextlib
import importlib.util
import io
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

_HOME = tempfile.mkdtemp(prefix="site-pastas-teste-home-")
os.environ["HOME"] = os.environ["USERPROFILE"] = _HOME
os.environ.pop("SQUADONE_AVISOS_FILA", None)


def _apagar_se_meu(p: str) -> None:
    if Path(p).name.startswith("site-pastas-teste-") and Path(p).parent == Path(tempfile.gettempdir()):
        shutil.rmtree(p, ignore_errors=True)


atexit.register(_apagar_se_meu, _HOME)

AQUI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("site_pastas", AQUI / "site-pastas.py")
sp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sp)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_site_pastas", AQUI / "dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — sem fcntl (Windows)
    ds = None

TEXTOS = [
    "Botão da página do lead não moveu a pasta (1-x.json): pacote sem place_id ou com ação desconhecida: 'xyz'. "
    "A planilha já mudou; confira a pasta em ~/auto-site.",
    "aspas \"duplas\", barra \\ e acento: ação, coração",
    "duas\nlinhas e emoji 🌐",
    "destino já existe: _recusados/fulano",
    "dois  espaços  e  nada de moeda",
]


class Base(unittest.TestCase):
    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="site-pastas-teste-"))
        self.addCleanup(_apagar_se_meu, str(self.raiz))
        nomes = ("AUTO", "REGISTRO", "ACOES", "ERRO", "PILHA", "FILA_AVISOS", "PASTAS_DA_LIB")
        self.antes = {k: getattr(sp, k) for k in nomes}
        self.addCleanup(lambda: [setattr(sp, k, v) for k, v in self.antes.items()])
        sp.AUTO = self.raiz / "auto-site"
        sp.REGISTRO = sp.AUTO / "registro.md"
        sp.ACOES = self.raiz / "site-acoes"
        sp.ERRO = self.raiz / "site-acoes-erro"
        sp.PILHA = self.raiz / "estado" / "acoes.json"
        sp.FILA_AVISOS = self.raiz / "fila"
        sp.AUTO.mkdir()
        self.lib_do_repo = list(self.antes["PASTAS_DA_LIB"])

    def fila(self):
        return sorted(sp.FILA_AVISOS.glob("*.json")) if sp.FILA_AVISOS.is_dir() else []

    def avisar(self, texto):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            sp.avisar(texto)
        return err.getvalue()

    def gravado_pela_lib(self, texto: str) -> bytes:
        """O aviso gravado pela lib do repo, numa fila limpa."""
        shutil.rmtree(sp.FILA_AVISOS, ignore_errors=True)
        sp.FILA_AVISOS.mkdir()
        sp.PASTAS_DA_LIB = self.lib_do_repo
        self.avisar(texto)
        arquivos = self.fila()
        self.assertEqual(len(arquivos), 1, arquivos)
        return arquivos[0].read_bytes()


class TrocaPelaLib(Base):
    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(sp.lib_de_aviso().__file__).resolve(), (AQUI / "lib/aviso.py").resolve())

    def test_aviso_gravado_le_de_volta_igual(self):
        for texto in TEXTOS:
            with self.subTest(texto=texto):
                d = json.loads(self.gravado_pela_lib(texto).decode("utf-8"))
                self.assertEqual(d, {"titulo": "🌐 Sites", "texto": texto, "origem": "site-pastas"})

    def test_conteudo_fixado(self):
        esperado = '{"titulo": "🌐 Sites", "texto": "duas\\nlinhas e emoji 🌐", "origem": "site-pastas"}'
        self.assertEqual(self.gravado_pela_lib("duas\nlinhas e emoji 🌐"), esperado.encode("utf-8"))

    def test_nome_e_atomicidade(self):
        sp.FILA_AVISOS.mkdir()
        self.avisar("x")
        self.assertRegex(self.fila()[0].name, r"^site-pastas-\d+-[0-9a-f]{6}\.json$")
        self.assertEqual([p for p in sp.FILA_AVISOS.iterdir() if not p.name.endswith(".json")], [])

    def test_dois_avisos_seguidos_nao_se_sobrescrevem(self):
        sp.FILA_AVISOS.mkdir()
        for i in range(5):
            self.avisar(f"aviso {i}")
        self.assertEqual(len(self.fila()), 5)

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        sp.FILA_AVISOS.mkdir()
        for texto in TEXTOS:
            self.avisar(texto)
        self.assertEqual(len(self.fila()), len(TEXTOS))
        for arq in self.fila():
            ds.validar_aviso(json.loads(arq.read_text(encoding="utf-8")))

    def test_com_a_lib_a_fila_ausente_nao_e_criada_e_nao_levanta(self):
        err = self.avisar("x")
        self.assertFalse(sp.FILA_AVISOS.exists())
        self.assertIn("fila_ausente", err)

    def test_texto_longo_e_cortado_em_vez_de_recusado_pelo_dell_status(self):
        sp.FILA_AVISOS.mkdir()
        self.avisar("início importante " + "y" * 5000)
        d = json.loads(self.fila()[0].read_text(encoding="utf-8"))
        self.assertTrue(d["texto"].startswith("início importante "))
        self.assertTrue(d["texto"].endswith("… (cortado)"))
        self.assertLessEqual(len(d["texto"]), 4000)

    def test_valor_em_reais_na_excecao_nao_perde_o_aviso(self):
        # A lib recusa "R$" (RULES 24). O texto leva a mensagem da exceção, então
        # o aviso sai com "[valor]" no lugar, em vez de se perder.
        sp.FILA_AVISOS.mkdir()
        self.avisar("Botão não moveu (1-x.json): destino de R$ 1.234,50 recusado. Confira a pasta.")
        d = json.loads(self.fila()[0].read_text(encoding="utf-8"))
        self.assertNotRegex(d["texto"], r"R\s*\$")
        self.assertIn("[valor]", d["texto"])
        self.assertIn("Botão não moveu (1-x.json)", d["texto"])
        self.assertIn("recusado. Confira a pasta.", d["texto"])

    def test_texto_sem_valor_nao_e_mexido(self):
        # sem_valores() também junta espaços duplos e apara: só pode rodar quando há R$.
        sp.FILA_AVISOS.mkdir()
        self.avisar("  dois  espaços  ")
        self.assertEqual(json.loads(self.fila()[0].read_text(encoding="utf-8"))["texto"], "  dois  espaços  ")


class SemLib(Base):
    def sem_gravar(self, err):
        self.assertIn("lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: 🌐 Sites", err)
        self.assertFalse(sp.FILA_AVISOS.exists(), "sem a lib nada é criado nem gravado na fila")

    def test_sem_copia_registra_no_stderr_e_nao_grava(self):
        sp.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        self.assertIsNone(sp.lib_de_aviso())
        self.sem_gravar(self.avisar("x"))

    def test_copia_quebrada_registra_no_stderr_e_nao_grava(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("def x(:\n", encoding="utf-8")
        sp.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(sp.lib_de_aviso())
        self.sem_gravar(self.avisar("x"))

    def test_copia_quebrada_cai_na_seguinte(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
        sp.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(sp.lib_de_aviso().__file__).resolve(), (AQUI / "lib/aviso.py").resolve())


class BotoesDaPagina(Base):
    """A rodada dos botões da página do lead, com o aviso de pacote ruim."""

    def setUp(self):
        super().setUp()
        sp.ACOES.mkdir()
        self.systemctl = []
        self.run_original = sp.subprocess.run
        sp.subprocess.run = lambda *a, **k: self.systemctl.append(a[0]) or None
        self.addCleanup(lambda: setattr(sp.subprocess, "run", self.run_original))
        pasta = sp.AUTO / "fulano"
        pasta.mkdir()
        (pasta / "publicado.json").write_text(json.dumps({"place_id": "P1", "nome": "Fulano", "site_url": "https://x"}),
                                              encoding="utf-8")

    def pacote(self, nome, d):
        (sp.ACOES / nome).write_text(json.dumps(d), encoding="utf-8")

    def rodar(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return sp.botoes_da_pagina(False)

    def test_pacote_ruim_gera_aviso_e_o_bom_segue(self):
        sp.FILA_AVISOS.mkdir()
        self.pacote("1-ruim.json", {"place_id": "P1", "acao": "xyz"})
        self.pacote("2-bom.json", {"place_id": "P1", "acao": "recusou", "nome": "Fulano"})
        self.assertEqual(self.rodar(), 1)
        self.assertTrue((sp.AUTO / "_recusados/fulano").is_dir())
        self.assertTrue((sp.ERRO / "1-ruim.json").is_file())
        self.assertEqual(list(sp.ACOES.iterdir()), [])
        avisos = [json.loads(p.read_text(encoding="utf-8")) for p in self.fila()]
        self.assertEqual(len(avisos), 1)
        self.assertEqual((avisos[0]["titulo"], avisos[0]["origem"]), ("🌐 Sites", "site-pastas"))
        self.assertIn("1-ruim.json", avisos[0]["texto"])
        self.assertIn("ação desconhecida", avisos[0]["texto"])
        self.assertIn("confira a pasta em ~/auto-site", avisos[0]["texto"])
        self.assertEqual(self.systemctl, [])  # o site-demos-pausa foi aposentado: mover pasta não acorda mais nada

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita_o_aviso_da_rodada(self):
        sp.FILA_AVISOS.mkdir()
        self.pacote("1-ruim.json", {"place_id": "P1", "acao": "xyz"})
        self.rodar()
        ds.validar_aviso(json.loads(self.fila()[0].read_text(encoding="utf-8")))

    def test_fila_ausente_nao_para_a_rodada(self):
        # Com a lib a pasta da fila (do dell-status, 2770) não é criada, nada
        # levanta dentro do except e o pacote seguinte é aplicado.
        self.pacote("1-ruim.json", {"place_id": "P1", "acao": "xyz"})
        self.pacote("2-bom.json", {"place_id": "P1", "acao": "fechou", "nome": "Fulano"})
        self.assertEqual(self.rodar(), 1)
        self.assertTrue((sp.AUTO / "_fechados/fulano").is_dir())
        self.assertTrue((sp.ERRO / "1-ruim.json").is_file())
        self.assertFalse(sp.FILA_AVISOS.exists())

    def test_sem_a_lib_o_pacote_ruim_vai_para_erro_e_o_aviso_nao_vai(self):
        sp.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        sp.FILA_AVISOS.mkdir()
        self.pacote("1-ruim.json", {"place_id": "P1", "acao": "xyz"})
        self.rodar()
        self.assertTrue((sp.ERRO / "1-ruim.json").is_file())
        self.assertEqual(self.fila(), [])


class PedirDemo(BotoesDaPagina):
    """O toque "Gerar demo" (14/10/2026): grava o pedido na pasta, onde ela estiver, e acorda o gerador."""

    def setUp(self):
        super().setUp()
        self.so_raio_x = sp.AUTO / "_em-conversa" / "ciclano"
        self.so_raio_x.mkdir(parents=True)
        (self.so_raio_x / "publicado.json").write_text(json.dumps(
            {"place_id": "P2", "nome": "Ciclano", "raio_x_url": "https://raio-x-prumo.vercel.app/ciclano"}), encoding="utf-8")

    def test_pedido_gravado_na_pasta_sem_mover(self):
        self.pacote("1.json", {"place_id": "P2", "acao": "gerar_demo", "nome": "Ciclano", "em": "2026-10-14T15:00:00-03:00"})
        self.assertEqual(self.rodar(), 0)  # nada movido
        pedido = json.loads((self.so_raio_x / sp.PEDIDO_DEMO).read_text(encoding="utf-8"))
        self.assertEqual((pedido["place_id"], pedido["em"]), ("P2", "2026-10-14T15:00:00-03:00"))
        self.assertTrue(self.so_raio_x.is_dir())
        self.assertIn(["systemctl", "--user", "start", "--no-block", "gerador-de-sites-pedido.service"], self.systemctl)
        self.assertIn("**Demo pedido.**", sp.REGISTRO.read_text(encoding="utf-8"))
        self.assertEqual(list(sp.ACOES.iterdir()), [])

    def test_repetir_o_toque_nao_pede_de_novo(self):
        self.pacote("1.json", {"place_id": "P2", "acao": "gerar_demo"})
        self.rodar()
        self.systemctl.clear()
        self.pacote("2.json", {"place_id": "P2", "acao": "gerar_demo"})
        self.rodar()
        self.assertEqual(self.systemctl, [])
        self.assertEqual(sp.REGISTRO.read_text(encoding="utf-8").count("**Demo pedido.**"), 1)

    def test_lead_com_demo_ou_recusado_nao_pede(self):
        self.pacote("1.json", {"place_id": "P1", "acao": "gerar_demo"})  # fulano já tem site_url
        self.rodar()
        self.assertFalse((sp.AUTO / "fulano" / sp.PEDIDO_DEMO).exists())
        recusado = sp.AUTO / "_recusados" / "beltrano"
        recusado.mkdir(parents=True)
        (recusado / "publicado.json").write_text(json.dumps({"place_id": "P3"}), encoding="utf-8")
        self.pacote("2.json", {"place_id": "P3", "acao": "gerar_demo"})
        self.rodar()
        self.assertFalse((recusado / sp.PEDIDO_DEMO).exists())
        self.assertEqual(self.systemctl, [])

    def test_lead_sem_recibo_acha_a_pasta_pelo_content_md(self):
        # 15/10/2026: recebeu a A sem demo e nunca teve publicado.json (o gerador falhou).
        falhou = sp.AUTO / "sarah-advocacia"
        falhou.mkdir(parents=True)
        (falhou / "content.md").write_text("# Sarah Advocacia\n\n- **place_id:** P9\n", encoding="utf-8")
        outro = sp.AUTO / "outro"
        outro.mkdir()
        (outro / "content.md").write_text("# Outro\n- **place_id:** P99\n", encoding="utf-8")
        self.pacote("1.json", {"place_id": "P9", "acao": "gerar_demo", "nome": "Sarah"})
        self.rodar()
        self.assertTrue((falhou / sp.PEDIDO_DEMO).is_file())
        self.assertFalse((outro / sp.PEDIDO_DEMO).exists())
        self.assertIn(["systemctl", "--user", "start", "--no-block", "gerador-de-sites-pedido.service"], self.systemctl)

    def test_sem_recibo_so_vale_para_o_gerar_demo(self):
        pasta = sp.AUTO / "sem-recibo"
        pasta.mkdir(parents=True)
        (pasta / "content.md").write_text("- **place_id:** P8\n", encoding="utf-8")
        self.pacote("1.json", {"place_id": "P8", "acao": "recusou"})
        self.rodar()
        self.assertTrue(pasta.is_dir())
        self.assertFalse((sp.AUTO / "_recusados" / "sem-recibo").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
