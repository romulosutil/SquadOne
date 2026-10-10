#!/usr/bin/env python3
"""Testes de hermes-uso-skills.py. Gravam só num diretório temporário."""
import datetime
import importlib.util
import json
import os
import stat
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "uso", os.path.join(os.path.dirname(os.path.abspath(__file__)), "hermes-uso-skills.py"))
uso = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uso)

HOJE = datetime.date(2026, 11, 1)
USAGE = {
    "usada": {"use_count": 3, "view_count": 2, "patch_count": 1, "state": "active",
              "created_by": "agent", "last_used_at": "2026-10-30", "extra": "ignorado"},
    "zerada": {"use_count": 0, "view_count": 0, "state": "stale"},
    "so_vista": {"use_count": 0, "view_count": 1},
    "lixo": "não é dict",
}


class Foto(unittest.TestCase):
    def test_conta_e_lista_as_nunca_usadas(self):
        f = uso.foto(USAGE, HOJE)
        self.assertEqual(f["data"], "2026-11-01")
        self.assertEqual(f["total"], 3)
        self.assertEqual(f["nunca_usadas"], ["zerada"])

    def test_so_guarda_os_campos_conhecidos(self):
        f = uso.foto(USAGE, HOJE)
        self.assertNotIn("extra", f["skills"]["usada"])
        self.assertEqual(f["skills"]["usada"]["use_count"], 3)
        self.assertIsNone(f["skills"]["zerada"]["created_by"])


class Gravacao(unittest.TestCase):
    def test_grava_600_e_nao_mexe_nas_skills(self):
        with tempfile.TemporaryDirectory() as raiz:
            skills = os.path.join(raiz, "skills")
            os.makedirs(skills)
            origem = os.path.join(skills, ".usage.json")
            with open(origem, "w", encoding="utf-8") as f:
                json.dump(USAGE, f)
            with open(origem, "rb") as f:
                antes = f.read()
            destino = uso.principal(skills, os.path.join(raiz, "fotos"), HOJE)
            self.assertTrue(destino.endswith("2026-11-01.json"))
            if sys.platform != "win32":  # o Windows não tem modo de arquivo
                self.assertEqual(stat.S_IMODE(os.stat(destino).st_mode), 0o600)
            with open(destino, encoding="utf-8") as f:
                self.assertEqual(json.load(f)["total"], 3)
            with open(origem, "rb") as f:
                self.assertEqual(f.read(), antes)
            self.assertEqual(sorted(os.listdir(skills)), [".usage.json"])

    def test_sem_usage_json_falha_sem_criar_foto(self):
        with tempfile.TemporaryDirectory() as raiz:
            with self.assertRaises(OSError):
                uso.principal(raiz, os.path.join(raiz, "fotos"), HOJE)
            self.assertFalse(os.path.exists(os.path.join(raiz, "fotos", "2026-11-01.json")))


if __name__ == "__main__":
    unittest.main()
