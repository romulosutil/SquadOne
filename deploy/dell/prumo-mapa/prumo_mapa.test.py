#!/usr/bin/env python3
"""Testes do prumo_mapa.py: python3 deploy/dell/prumo-mapa/prumo_mapa.test.py

O que importa aqui é o avisar() pela lib de aviso (11/10/2026): o aviso gravado
é o do formato da fila (com e sem o "[teste] "), o dell-status aceita o arquivo,
sem a lib (cópia ausente ou quebrada) nada é gravado (uma linha no stderr) e a
fila ausente não derruba a rodada. O aviso é de entrega ao Rômulo (rascunho do Mapa de um
cliente): "R$" no texto NÃO é escondido com [valor], o aviso é recusado e a
linha fica no journal (stderr).

Nada toca o Dell: o HOME vira um temporário ANTES do import, cada teste aponta
FILA, ERRO, ENTREGAS e FILA_AVISOS para a própria raiz `prumo-mapa-teste-*`, e
o que gera o Mapa (preparar/gerar, que pedem Chromium) é dublê.
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

_HOME = tempfile.mkdtemp(prefix="prumo-mapa-teste-home-")
os.environ["HOME"] = os.environ["USERPROFILE"] = _HOME
os.environ.pop("SQUADONE_AVISOS_FILA", None)


def _apagar_se_meu(p: str) -> None:
    if Path(p).name.startswith("prumo-mapa-teste-") and Path(p).parent == Path(tempfile.gettempdir()):
        shutil.rmtree(p, ignore_errors=True)


atexit.register(_apagar_se_meu, _HOME)

AQUI = Path(__file__).resolve().parent
LIB_DO_REPO = (AQUI.parent / "lib" / "aviso.py").resolve()
_spec = importlib.util.spec_from_file_location("prumo_mapa_sob_teste", AQUI / "prumo_mapa.py")
pm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pm)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_prumo_mapa", AQUI.parent / "dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — sem fcntl (Windows)
    ds = None

TEXTOS = [
    "Rascunho do Mapa pronto: Vale Norte · Índice do Prumo 5,0/18.\nPDF: /home/x/prumo-entregas/2026-10-11-vale-norte/prumo-mapa-vale-norte.pdf\n"
    "12 campos [PREENCHER] (entrevistas, coleta, travas, recomendação). Complete o dados.json da pasta e rode: "
    "prumo-mapa /home/x/prumo-entregas/2026-10-11-vale-norte/dados.json\nNada foi enviado ao cliente.",
    "Mapa do PRUMO não pôde ser gerado (1-x.json): pacote sem sessões de resposta. Pacote em /home/x/erro.",
    "aspas \"duplas\", barra \\ e acento: ação, coração",
    "emoji 🌐 e empresa D'Ávila & Filhos Ltda.",
]


class Base(unittest.TestCase):
    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="prumo-mapa-teste-"))
        self.addCleanup(_apagar_se_meu, str(self.raiz))
        nomes = ("FILA", "ERRO", "ENTREGAS", "FILA_AVISOS", "PASTAS_DA_LIB", "preparar", "gerar")
        self.antes = {k: getattr(pm, k) for k in nomes}
        self.addCleanup(lambda: [setattr(pm, k, v) for k, v in self.antes.items()])
        pm.FILA = self.raiz / "mapa-fila"
        pm.ERRO = self.raiz / "prumo-mapa-erro"
        pm.ENTREGAS = self.raiz / "prumo-entregas"
        pm.FILA_AVISOS = self.raiz / "fila"
        self.lib_do_repo = list(self.antes["PASTAS_DA_LIB"])

    def fila(self):
        return sorted(pm.FILA_AVISOS.glob("*.json")) if pm.FILA_AVISOS.is_dir() else []

    def avisar(self, texto, teste=False):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            pm.avisar(texto, teste)
        return err.getvalue()

    def gravado_pela_lib(self, texto: str, teste: bool = False) -> bytes:
        """O aviso gravado pela lib do repo, numa fila limpa."""
        shutil.rmtree(pm.FILA_AVISOS, ignore_errors=True)
        pm.FILA_AVISOS.mkdir()
        pm.PASTAS_DA_LIB = self.lib_do_repo
        self.avisar(texto, teste)
        arquivos = self.fila()
        self.assertEqual(len(arquivos), 1, arquivos)
        return arquivos[0].read_bytes()


class TrocaPelaLib(Base):
    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(pm.lib_de_aviso().__file__).resolve(), LIB_DO_REPO)

    def test_aviso_gravado_le_de_volta_igual(self):
        for teste in (False, True):
            for texto in TEXTOS:
                with self.subTest(texto=texto[:30], teste=teste):
                    d = json.loads(self.gravado_pela_lib(texto, teste).decode("utf-8"))
                    self.assertEqual(d, {"titulo": "📊 PRUMO", "texto": ("[teste] " if teste else "") + texto, "origem": "prumo-mapa"})

    def test_conteudo_fixado(self):
        esperado = '{"titulo": "📊 PRUMO", "texto": "[teste] Mapa de Fulano\\nok", "origem": "prumo-mapa"}'
        self.assertEqual(self.gravado_pela_lib("Mapa de Fulano\nok", True), esperado.encode("utf-8"))
        esperado = '{"titulo": "📊 PRUMO", "texto": "Mapa de Fulano", "origem": "prumo-mapa"}'
        self.assertEqual(self.gravado_pela_lib("Mapa de Fulano"), esperado.encode("utf-8"))

    def test_nome_e_atomicidade(self):
        pm.FILA_AVISOS.mkdir()
        self.avisar("x")
        self.assertRegex(self.fila()[0].name, r"^prumo-mapa-\d+-[0-9a-f]{6}\.json$")
        self.assertEqual([p for p in pm.FILA_AVISOS.iterdir() if not p.name.endswith(".json")], [])

    def test_dois_avisos_seguidos_nao_se_sobrescrevem(self):
        pm.FILA_AVISOS.mkdir()
        for i in range(5):
            self.avisar(f"aviso {i}")
        self.assertEqual(len(self.fila()), 5)

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        pm.FILA_AVISOS.mkdir()
        for texto in TEXTOS:
            self.avisar(texto)
        self.avisar("com teste", True)
        self.assertEqual(len(self.fila()), len(TEXTOS) + 1)
        for arq in self.fila():
            ds.validar_aviso(json.loads(arq.read_text(encoding="utf-8")))

    def test_com_a_lib_a_fila_ausente_nao_e_criada_e_nao_levanta(self):
        err = self.avisar("Mapa de Fulano")
        self.assertFalse(pm.FILA_AVISOS.exists())
        self.assertIn("fila_ausente", err)
        self.assertIn("aviso não entregue", err)

    def test_valor_em_reais_e_recusado_e_vai_ao_journal(self):
        # Aviso de entrega: não se esconde o valor, recusa-se. O journal diz de
        # qual Mapa era (o começo do texto), sem o resto.
        pm.FILA_AVISOS.mkdir()
        err = self.avisar("Rascunho do Mapa pronto: Loja R$ 5 Ltda · Índice do Prumo 5,0/18.\nPDF: /x.pdf")
        self.assertEqual(self.fila(), [])
        self.assertIn("recusado", err)
        self.assertIn("RULES 24", err)
        self.assertIn("Loja R$ 5 Ltda", err)
        self.assertNotIn("PDF: /x.pdf", err)

    def test_texto_longo_e_cortado_em_vez_de_recusado_pelo_dell_status(self):
        pm.FILA_AVISOS.mkdir()
        self.avisar("início importante " + "y" * 5000)
        d = json.loads(self.fila()[0].read_text(encoding="utf-8"))
        self.assertTrue(d["texto"].startswith("início importante "))
        self.assertTrue(d["texto"].endswith("… (cortado)"))
        self.assertLessEqual(len(d["texto"]), 4000)


class SemLib(Base):
    def sem_gravar(self, err):
        self.assertIn("lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: 📊 PRUMO: x", err)
        self.assertFalse(pm.FILA_AVISOS.exists(), "sem a lib nada é criado nem gravado na fila")

    def test_sem_copia_registra_no_stderr_e_nao_grava(self):
        pm.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        self.assertIsNone(pm.lib_de_aviso())
        self.sem_gravar(self.avisar("x"))

    def test_copia_quebrada_registra_no_stderr_e_nao_grava(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("def x(:\n", encoding="utf-8")
        pm.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(pm.lib_de_aviso())
        self.sem_gravar(self.avisar("x"))

    def test_copia_quebrada_cai_na_seguinte(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
        pm.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(pm.lib_de_aviso().__file__).resolve(), LIB_DO_REPO)


class RodadaDaFila(Base):
    """processar_fila com o gerador dublê: o aviso de sucesso e o de erro."""

    def setUp(self):
        super().setUp()
        pm.FILA.mkdir()
        self.gerou = []

        def preparar(pacote, hoje=None):
            if not isinstance(pacote, dict) or not pacote.get("empresa"):
                raise ValueError("pacote sem sessões de resposta")
            return dict(pacote)

        def gerar(dados, pasta, com_pdf=True):
            self.gerou.append(dados["empresa"])
            return {"pasta": pasta, "html": pasta / "m.html", "pdf": pasta / "m.pdf", "preencher": 7,
                    "indice": 5.0, "erro_pdf": None}

        pm.preparar, pm.gerar = preparar, gerar

    def pacote(self, nome, d):
        (pm.FILA / nome).write_text(json.dumps(d), encoding="utf-8")

    def rodar(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return pm.processar_fila()

    def avisos(self):
        return [json.loads(p.read_text(encoding="utf-8")) for p in self.fila()]

    def test_pacote_ruim_gera_aviso_e_o_bom_segue(self):
        pm.FILA_AVISOS.mkdir()
        self.pacote("1-ruim.json", ["não é objeto"])
        self.pacote("2-bom.json", {"empresa": "Fulano", "teste": True})
        self.assertEqual(self.rodar(), 1)
        self.assertEqual(self.gerou, ["Fulano"])
        self.assertEqual(list(pm.FILA.iterdir()), [])
        self.assertEqual(len(list(pm.ERRO.iterdir())), 1)
        avisos = self.avisos()
        self.assertEqual(len(avisos), 2)
        for a in avisos:
            self.assertEqual((a["titulo"], a["origem"]), ("📊 PRUMO", "prumo-mapa"))
        erro = next(a for a in avisos if "não pôde ser gerado" in a["texto"])
        self.assertIn("1-ruim.json", erro["texto"])
        pronto = next(a for a in avisos if "Rascunho do Mapa pronto: Fulano" in a["texto"])
        self.assertTrue(pronto["texto"].startswith("[teste] "))  # o pacote 2 era de teste

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita_os_avisos_da_rodada(self):
        pm.FILA_AVISOS.mkdir()
        self.pacote("1-ruim.json", ["não é objeto"])
        self.pacote("2-bom.json", {"empresa": "Fulano"})
        self.rodar()
        self.assertEqual(len(self.fila()), 2)
        for arq in self.fila():
            ds.validar_aviso(json.loads(arq.read_text(encoding="utf-8")))

    def test_fila_ausente_nao_derruba_a_rodada(self):
        # Com a lib a pasta da fila (do dell-status, 2770) não é criada, nada
        # levanta dentro do except e o pacote seguinte é feito.
        self.pacote("1-ruim.json", ["não é objeto"])
        self.pacote("2-bom.json", {"empresa": "Fulano"})
        self.assertEqual(self.rodar(), 1)
        self.assertEqual(self.gerou, ["Fulano"])
        self.assertEqual(list(pm.FILA.iterdir()), [])
        self.assertFalse(pm.FILA_AVISOS.exists())

    def test_valor_em_reais_na_empresa_nao_derruba_nem_apaga_o_pacote_feito(self):
        pm.FILA_AVISOS.mkdir()
        self.pacote("1-bom.json", {"empresa": "Loja R$ 1 Ltda"})
        self.pacote("2-bom.json", {"empresa": "Fulano"})
        self.assertEqual(self.rodar(), 2)
        self.assertEqual(sorted(self.gerou), ["Fulano", "Loja R$ 1 Ltda"])
        textos = [a["texto"] for a in self.avisos()]
        self.assertEqual(len(textos), 1)  # o da Loja R$ foi recusado; o outro saiu
        self.assertIn("Fulano", textos[0])

    def test_sem_a_lib_o_mapa_sai_e_so_o_aviso_nao_vai(self):
        pm.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        self.pacote("1-bom.json", {"empresa": "Fulano"})
        self.rodar()
        self.assertEqual(self.gerou, ["Fulano"])
        self.assertEqual(self.fila(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
