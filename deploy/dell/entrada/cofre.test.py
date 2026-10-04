#!/usr/bin/env python3
"""Testes do cofre. python3 cofre.test.py  (precisa do `age`; sem ele, pula)

Usa o age de verdade com identidades temporárias. Segredos falsos.
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cofre as c  # noqa: E402

TEM_AGE = bool(shutil.which("age") and shutil.which("age-keygen"))
SEGREDO = "valor-bem-secreto-do-teste-0042"
AGE_FALSA = "AGE-SECRET" + "-KEY-1" + "Q" * 40


def nova_identidade(caminho: Path) -> str:
    subprocess.run(["age-keygen", "-o", str(caminho)], check=True, capture_output=True)
    return subprocess.run(["age-keygen", "-y", str(caminho)], check=True, capture_output=True, text=True).stdout.strip()


@unittest.skipUnless(TEM_AGE, "age não instalado")
class CofreTeste(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cofre-teste-"))
        self.raiz = self.tmp / "Cofre"
        self.raiz.mkdir(mode=0o700)
        self.id_mel = self.tmp / "mel.txt"
        self.id_rom = self.tmp / "romulo.txt"
        pub_mel = nova_identidade(self.id_mel)
        pub_rom = nova_identidade(self.id_rom)
        (self.raiz / "recipients.txt").write_text(f"# destinatários\n{pub_mel}\n\n{pub_rom}\n")
        self.cofre = c.Cofre(self.raiz, self.id_mel, agora=lambda: datetime(2026, 10, 4, 18, 40, 0))

    def tearDown(self):
        # só apaga a pasta temporária que este teste criou
        shutil.rmtree(self.tmp, ignore_errors=True)

    def decifrar_com(self, identidade: Path, i: str) -> bytes:
        return subprocess.run(["age", "-d", "-i", str(identidade), str(self.raiz / f"{i}.age")],
                              check=True, capture_output=True).stdout

    # ------------------------------------------------------------------ guardar
    def test_guardar_cifra_para_todos_os_destinatarios(self):
        e = self.cofre.guardar("senha do banco X", SEGREDO.encode())
        self.assertRegex(e["id"], c.ID_RE)
        self.assertEqual(self.decifrar_com(self.id_mel, e["id"]), SEGREDO.encode())
        self.assertEqual(self.decifrar_com(self.id_rom, e["id"]), SEGREDO.encode())     # o do Rômulo também abre
        self.assertEqual(self.cofre.ler(e["id"]), SEGREDO.encode())

    def test_o_valor_nunca_aparece_em_disco_nem_no_indice(self):
        e = self.cofre.guardar("chave de teste", AGE_FALSA.encode(), nome="chave-teste.txt", tipo="arquivo")
        for p in self.tmp.rglob("*"):
            if p.is_file() and p not in (self.id_mel, self.id_rom):
                self.assertNotIn(AGE_FALSA.encode(), p.read_bytes(), f"valor em {p}")
        idx = json.loads((self.raiz / "indice.json").read_text())
        self.assertEqual(idx["itens"][0], {"id": e["id"], "rotulo": "chave de teste", "tipo": "arquivo",
                                           "nome": "chave-teste.txt", "bytes": len(AGE_FALSA),
                                           "data": "2026-10-04T18:40:00"})
        self.assertEqual(sorted(idx["itens"][0]), ["bytes", "data", "id", "nome", "rotulo", "tipo"])

    def test_aceita_fluxo_de_pedacos_e_conta_os_bytes(self):
        e = self.cofre.guardar("grande", (bytes([i % 256]) * 100_000 for i in range(30)), tipo="arquivo")
        self.assertEqual(e["bytes"], 3_000_000)
        self.assertEqual(len(self.cofre.ler(e["id"])), 3_000_000)

    def test_permissoes_600(self):
        e = self.cofre.guardar("x", b"abc")
        for nome in (f"{e['id']}.age", "indice.json"):
            self.assertEqual(stat.S_IMODE((self.raiz / nome).stat().st_mode), 0o600, nome)

    def test_nao_deixa_temporarios(self):
        self.cofre.guardar("x", b"abc")
        sobras = [p.name for p in self.raiz.iterdir() if p.name.startswith(".") and not p.name.endswith(".lock")]
        self.assertEqual(sobras, [])

    def test_rotulo_obrigatorio_sem_controle_e_sem_segredo(self):
        for rotulo, trecho in [("", "obrigatório"), ("a\nb", "controle"), ("x" * 200, "mais de"),
                               (f"minha chave {AGE_FALSA}", "parece um segredo"), ("senha: abc12345", "parece um segredo")]:
            with self.assertRaises(c.CofreErro) as e:
                self.cofre.guardar(rotulo, b"v")
            self.assertIn(trecho, str(e.exception))
        self.assertEqual(self.cofre.listar(), [])
        with self.assertRaises(c.CofreErro):
            self.cofre.guardar("ok", b"v", nome=f"ghp_{'A1b2C3d4' * 5}.txt", tipo="arquivo")

    def test_vazio_nao_vira_item(self):
        with self.assertRaises(c.CofreErro):
            self.cofre.guardar("vazio", b"")
        self.assertEqual(self.cofre.listar(), [])
        self.assertEqual([p.name for p in self.raiz.glob("*.age")], [])

    # ------------------------------------------------------------- destinatários
    def test_falha_fechada_sem_destinatarios_ou_com_linha_ruim(self):
        (self.raiz / "recipients.txt").write_text("# só comentário\n")
        with self.assertRaises(c.CofreErro):
            self.cofre.guardar("x", b"v")
        (self.raiz / "recipients.txt").write_text("age1curta\n")
        with self.assertRaises(c.CofreErro) as e:
            self.cofre.guardar("x", b"v")
        self.assertIn("linha 1", str(e.exception))
        (self.raiz / "recipients.txt").unlink()
        with self.assertRaises(c.CofreErro):
            self.cofre.guardar("x", b"v")
        self.assertEqual(self.cofre.listar(), [])

    def test_age_quebrado_nao_deixa_rastro(self):
        cofre = c.Cofre(self.raiz, self.id_mel, age=str(self.tmp / "nao-existe"))
        with self.assertRaises(OSError):
            cofre.guardar("x", b"v")
        self.assertEqual(self.cofre.listar(), [])
        self.assertEqual([p.name for p in self.raiz.iterdir() if p.suffix in (".age", ".tmp")], [])

    # ---------------------------------------------------------------------- ler
    def test_ler_recusa_id_malicioso_ou_inexistente(self):
        for i in ["../x", "../../etc/passwd", "c-1", "", "c-20261004-184000-zzzz", "c-20261004-184000-abcd", None, 7]:
            with self.assertRaises(c.CofreErro):
                self.cofre.ler(i)

    def test_ler_com_identidade_errada_falha_sem_vazar(self):
        e = self.cofre.guardar("x", SEGREDO.encode())
        outra = self.tmp / "outra.txt"
        nova_identidade(outra)
        with self.assertRaises(c.CofreErro) as ex:
            c.Cofre(self.raiz, outra).ler(e["id"])
        self.assertNotIn(SEGREDO, str(ex.exception))

    def test_ler_para_arquivo_cria_600_e_nao_sobrescreve(self):
        e = self.cofre.guardar("x", SEGREDO.encode())
        destino = self.tmp / "saida.txt"
        self.assertEqual(self.cofre.ler_para_arquivo(e["id"], destino), len(SEGREDO))
        self.assertEqual(destino.read_text(), SEGREDO)
        self.assertEqual(stat.S_IMODE(destino.stat().st_mode), 0o600)
        with self.assertRaises(FileExistsError):
            self.cofre.ler_para_arquivo(e["id"], destino)

    # ---------------------------------------------------------------- recifrar
    def test_recifrar_abre_o_cofre_para_quem_entrou_depois(self):
        e = self.cofre.guardar("antigo", SEGREDO.encode())
        id_novo = self.tmp / "novo.txt"
        pub = nova_identidade(id_novo)
        with self.assertRaises(subprocess.CalledProcessError):
            self.decifrar_com(id_novo, e["id"])
        with open(self.raiz / "recipients.txt", "a") as f:
            f.write(pub + "\n")
        self.assertEqual(self.cofre.recifrar(), 1)
        self.assertEqual(self.decifrar_com(id_novo, e["id"]), SEGREDO.encode())
        self.assertEqual(self.decifrar_com(self.id_mel, e["id"]), SEGREDO.encode())

    # -------------------------------------------------------------- concorrência
    def test_duas_escritas_ao_mesmo_tempo_ficam_as_duas_no_indice(self):
        erros = []

        def tarefa(n):
            try:
                self.cofre.guardar(f"item {n}", f"v{n}".encode())
            except Exception as ex:  # noqa: BLE001
                erros.append(ex)
        ts = [threading.Thread(target=tarefa, args=(n,)) for n in range(8)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertEqual(erros, [])
        self.assertEqual(len(self.cofre.listar()), 8)
        self.assertEqual(len({i["id"] for i in self.cofre.listar()}), 8)

    def test_identidade_padrao_prefere_a_protegida_por_senha(self):
        casa = self.tmp / "casa"
        (casa / ".config/mel/age").mkdir(parents=True)
        self.assertEqual(c.identidade_padrao(casa), casa / ".config/mel/age/identity.txt")
        (casa / ".config/mel/age/identity.txt.age").write_bytes(b"x")
        self.assertEqual(c.identidade_padrao(casa), casa / ".config/mel/age/identity.txt.age")

    def test_status(self):
        self.cofre.guardar("x", b"v")
        self.assertEqual(self.cofre.status(), {"destinatarios": 2, "itens": 1})


if __name__ == "__main__":
    unittest.main(verbosity=1)
