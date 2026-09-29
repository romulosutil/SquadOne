#!/usr/bin/env python3
"""Testes do gerador-de-sites sem Claude, Vercel nem rede: numa pasta
temporária, com `rodar_claude` e `validar` trocados por falsos.

  python3 deploy/dell/gerador-de-sites.test.py
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent


def carregar(auto: Path):
    os.environ["AUTO_DIR"] = str(auto)
    spec = importlib.util.spec_from_file_location("gerador", AQUI / "gerador-de-sites.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.shutil.which = lambda _: "/bin/true"
    m.avisar = lambda texto: None  # nunca grava na fila de avisos real (viraria WhatsApp)
    m.validar = lambda pasta, log_lead: (pasta / "publicado.json").is_file()
    return m


class Gerador(unittest.TestCase):
    def setUp(self):
        self.auto = Path(tempfile.mkdtemp(prefix="gerador-teste-"))
        self.addCleanup(shutil.rmtree, self.auto)
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = "teste"
        self.m = carregar(self.auto)
        for i, slug in enumerate(["a-duplicado", "b-bom", "c-quebra", "d-bom"]):
            (self.auto / slug).mkdir()
            (self.auto / slug / "content.md").write_text(f"# {slug}\nplace_id: x{i}\n")
            os.utime(self.auto / slug / "content.md", (1000 + i, 1000 + i))

    def rodar(self, claude, *args):
        self.m.rodar_claude = claude
        sys.argv = ["gerador-de-sites", "--timeout-min", "1", *args]
        codigo = self.m.main()
        return codigo, json.loads((self.auto / ".logs/status.json").read_text())["ultimo_resumo"]

    def claude_padrao(self, slug, log_lead, timeout_min):
        pasta = self.auto / slug
        if slug == "a-duplicado":  # o Claude acha site e move o lead (caso de 29/09/2026)
            (self.auto / "_descartados").mkdir(exist_ok=True)
            pasta.rename(self.auto / "_descartados" / slug)
        elif slug == "c-quebra":
            raise RuntimeError("erro inesperado")
        else:
            (pasta / "index.html").write_text("<html></html>")
            (pasta / "publicado.json").write_text('{"site_url": "https://x"}')
        return {"codigo": 0, "estourou": False, "limite": False, "minutos": 0}

    def test_descartado_nao_derruba_o_lote(self):
        codigo, r = self.rodar(self.claude_padrao)
        self.assertEqual(codigo, 0)
        self.assertEqual(r["descartados"], ["a-duplicado → _descartados"])
        self.assertEqual(r["concluidos"], ["b-bom", "d-bom"])
        # Lead que falha continua o mais antigo da fila: tenta de novo na hora e,
        # com 2 falhas no falha.log, sai da fila (regra de sempre).
        self.assertEqual(len(r["falhas"]), 2)
        self.assertTrue(all(f.startswith("c-quebra: erro no runner") for f in r["falhas"]))
        self.assertEqual(r["tentativas"], 5)
        self.assertNotIn("erro", r)
        self.assertEqual(self.m.falhas_registradas(self.auto / "c-quebra"), 2)
        self.assertNotIn("c-quebra", [p.name for p in self.m.fila()])
        self.assertFalse((self.auto / ".logs/gerador.lock").exists())
        log = (self.auto / ".logs/execucao-fila.log").read_text()
        self.assertIn("a-duplicado foi para _descartados/", log)

    def test_pasta_sumida_segue_e_nao_vira_falha(self):
        def claude(slug, log_lead, timeout_min):
            if slug == "a-duplicado":
                shutil.rmtree(self.auto / slug)
                return {"codigo": 0, "estourou": False, "limite": False, "minutos": 0}
            return self.claude_padrao(slug, log_lead, timeout_min)
        codigo, r = self.rodar(claude, "--quantidade", "2")
        self.assertEqual(codigo, 0)
        self.assertEqual(r["sumidos"], ["a-duplicado"])
        self.assertEqual(r["concluidos"], ["b-bom"])
        self.assertEqual(len(r["falhas"]), 1)  # c-quebra; o sumido não é falha

    def test_duas_falhas_tiram_o_lead_da_fila(self):
        (self.auto / "c-quebra/falha.log").write_text("[x] um\n")
        self.rodar(self.claude_padrao)
        self.assertNotIn("c-quebra", [p.name for p in self.m.fila()])

    def test_registrar_falha_sem_pasta_nao_levanta(self):
        self.m.registrar_falha(self.auto / "nao-existe", "motivo", self.auto / ".logs/x.log")

    def test_so_falhas_viram_codigo_1(self):
        def claude(slug, log_lead, timeout_min):
            return {"codigo": 1, "estourou": False, "limite": False, "minutos": 0}
        codigo, r = self.rodar(claude, "--quantidade", "2")
        self.assertEqual(codigo, 1)
        self.assertEqual(len(r["falhas"]), 2)
        self.assertEqual(r["concluidos"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
