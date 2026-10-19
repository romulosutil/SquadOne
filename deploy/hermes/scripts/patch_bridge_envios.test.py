#!/usr/bin/env python3
"""Testes do avisar() do patch_bridge_envios.py: python3 deploy/hermes/scripts/patch_bridge_envios.test.py

O remendo em si (âncoras, blocos JS, sintaxe) tem os testes embutidos no script
(`patch_bridge_envios.py --testar`, precisa do bridge.js do Hermes). Este arquivo
cobre só o avisar() pela lib de aviso (11/10/2026): o dell-status aceita o que a
lib grava, sem a lib (cópia ausente ou quebrada) nada vai à fila (uma linha no
stderr e avisar() devolve False), a fila ausente não derruba o remendo (o main sai com 2 do mesmo jeito) e "R$" na
mensagem da exceção não faz o aviso se perder.

Nada toca o Hermes nem o Dell: o HOME vira um temporário ANTES do import e cada
teste aponta FILA_DE_AVISOS para a própria raiz `bridge-teste-*`.
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

_HOME = tempfile.mkdtemp(prefix="bridge-teste-home-")
os.environ["HOME"] = os.environ["USERPROFILE"] = _HOME
os.environ.pop("SQUADONE_AVISOS_FILA", None)


def _apagar_se_meu(p: str) -> None:
    if Path(p).name.startswith("bridge-teste-") and Path(p).parent == Path(tempfile.gettempdir()):
        shutil.rmtree(p, ignore_errors=True)


atexit.register(_apagar_se_meu, _HOME)

AQUI = Path(__file__).resolve().parent
SCRIPT = AQUI / "patch_bridge_envios.py"
LIB_DO_REPO = (AQUI.parents[1] / "dell" / "lib" / "aviso.py").resolve()
_spec = importlib.util.spec_from_file_location("patch_bridge_envios", SCRIPT)
patch = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(patch)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_bridge", AQUI.parents[1] / "dell" / "dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — sem fcntl (Windows)
    ds = None

TEXTOS = [
    "O remendo da bridge do WhatsApp não entrou (âncora não encontrada). Enquanto isso, as mensagens que "
    "você manda aos leads e os recibos de leitura não marcam a planilha; as respostas dos leads "
    "continuam marcando. Precisa ajustar deploy/hermes/scripts/patch_bridge_envios.py.",
    "aspas \"duplas\", barra \\ e acento: ação, coração",
    "duas\nlinhas e emoji ⚠️",
    "dois  espaços  e  nada de moeda",
    "node --check falhou: SyntaxError: Unexpected token '}' em /home/x/bridge.js:812",
]


class Base(unittest.TestCase):
    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="bridge-teste-"))
        self.addCleanup(_apagar_se_meu, str(self.raiz))
        antes = {k: getattr(patch, k) for k in ("FILA_DE_AVISOS", "PASTAS_DA_LIB")}
        self.addCleanup(lambda: [setattr(patch, k, v) for k, v in antes.items()])
        patch.FILA_DE_AVISOS = self.raiz / "fila"
        self.lib_do_repo = list(antes["PASTAS_DA_LIB"])

    def fila(self):
        return sorted(patch.FILA_DE_AVISOS.glob("*.json")) if patch.FILA_DE_AVISOS.is_dir() else []

    def avisos(self):
        return [json.loads(p.read_text(encoding="utf-8")) for p in self.fila()]

    def sem_lib(self):
        patch.PASTAS_DA_LIB = [self.raiz / "sem-lib"]

    def avisar(self, texto):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            patch.avisar(texto)
        return err.getvalue()

    def gravado_pela_lib(self, texto: str) -> bytes:
        """O aviso gravado pela lib do repo, numa fila limpa."""
        shutil.rmtree(patch.FILA_DE_AVISOS, ignore_errors=True)
        patch.FILA_DE_AVISOS.mkdir()
        patch.PASTAS_DA_LIB = self.lib_do_repo
        self.avisar(texto)
        self.assertEqual(len(self.fila()), 1, self.fila())
        return self.fila()[0].read_bytes()

    def main(self, *args):
        """patch.main() com a linha de comando dada; devolve (código, stderr)."""
        err, antes = io.StringIO(), sys.argv
        sys.argv = [str(SCRIPT), *args]
        try:
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                codigo = patch.main()
        finally:
            sys.argv = antes
        return codigo, err.getvalue()


class AvisoPelaLib(Base):
    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(patch.lib_de_aviso().__file__).resolve(), LIB_DO_REPO)

    def test_sem_a_do_repo_a_instalada_serve(self):
        instalada = self.raiz / "mel"
        instalada.mkdir()
        shutil.copy(LIB_DO_REPO, instalada / "aviso.py")
        patch.PASTAS_DA_LIB = [self.raiz / "sem-lib", instalada]
        self.assertEqual(Path(patch.lib_de_aviso().__file__).resolve(), (instalada / "aviso.py").resolve())

    def test_aviso_gravado_le_de_volta_igual(self):
        for texto in TEXTOS:
            with self.subTest(texto=texto):
                d = json.loads(self.gravado_pela_lib(texto).decode("utf-8"))
                self.assertEqual(d, {"titulo": "⚠️ Hermes (WhatsApp)", "texto": texto, "origem": "hermes:patch-bridge-envios"})

    def test_conteudo_fixado(self):
        esperado = '{"titulo": "⚠️ Hermes (WhatsApp)", "texto": "uma\\nduas", "origem": "hermes:patch-bridge-envios"}'
        self.assertEqual(self.gravado_pela_lib("uma\nduas"), esperado.encode("utf-8"))

    def test_nome_unico_e_atomicidade(self):
        patch.FILA_DE_AVISOS.mkdir()
        for _ in range(5):  # o nome leva nanossegundos: no mesmo segundo nada se sobrescreve
            self.avisar("x")
        self.assertEqual(len(self.fila()), 5)
        self.assertRegex(self.fila()[0].name, r"^bridge-envios-\d+-[0-9a-f]{6}\.json$")
        self.assertEqual([p for p in patch.FILA_DE_AVISOS.iterdir() if not p.name.endswith(".json")], [])

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        patch.FILA_DE_AVISOS.mkdir()
        for texto in TEXTOS:
            self.avisar(texto)
        self.assertEqual(len(self.fila()), len(TEXTOS))
        for aviso in self.avisos():
            ds.validar_aviso(aviso)

    def test_avisar_devolve_se_ficou_na_fila(self):
        self.assertFalse(patch.avisar("x"))  # fila ausente: não grava, não cria, não levanta
        self.assertFalse(patch.FILA_DE_AVISOS.exists())
        patch.FILA_DE_AVISOS.mkdir()
        self.assertTrue(patch.avisar("x"))

    def test_com_a_lib_a_fila_ausente_nao_e_criada_e_nao_levanta(self):
        err = self.avisar("x")
        self.assertFalse(patch.FILA_DE_AVISOS.exists())
        self.assertIn("fila_ausente", err)

    def test_valor_em_reais_na_excecao_nao_perde_o_aviso(self):
        patch.FILA_DE_AVISOS.mkdir()
        self.avisar("O remendo da bridge do WhatsApp não entrou (erro: custa R$ 9,99). Precisa ajustar.")
        texto = self.avisos()[0]["texto"]
        self.assertNotRegex(texto, r"R\s*\$")
        self.assertIn("custa [valor]", texto)
        self.assertIn("Precisa ajustar.", texto)

    def test_texto_sem_valor_nao_e_mexido(self):
        patch.FILA_DE_AVISOS.mkdir()
        self.avisar("  dois  espaços  ")
        self.assertEqual(self.avisos()[0]["texto"], "  dois  espaços  ")


class SemLib(Base):
    TITULO = "⚠️ Hermes (WhatsApp)"

    def sem_gravar(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertFalse(patch.avisar("x"))
        self.assertIn("lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: " + self.TITULO, err.getvalue())
        self.assertFalse(patch.FILA_DE_AVISOS.exists(), "sem a lib nada é criado nem gravado na fila")

    def test_sem_copia_registra_no_stderr_e_nao_grava(self):
        self.sem_lib()
        self.assertIsNone(patch.lib_de_aviso())
        self.sem_gravar()

    def test_copia_quebrada_registra_no_stderr_e_nao_grava(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("def x(:\n", encoding="utf-8")
        patch.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(patch.lib_de_aviso())
        self.sem_gravar()

    def test_copia_quebrada_cai_na_seguinte(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
        patch.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(patch.lib_de_aviso().__file__).resolve(), LIB_DO_REPO)


class NoMain(Base):
    """O main inteiro, com a bridge que não existe: o remendo falha, avisa e sai com 2."""

    def test_falha_do_remendo_vira_aviso_e_sai_com_2(self):
        patch.FILA_DE_AVISOS.mkdir()
        codigo, err = self.main("--bridge", str(self.raiz / "nao-existe.js"), "--avisar")
        self.assertEqual(codigo, 2)
        self.assertIn("remendo da bridge não aplicado", err)
        avisos = self.avisos()
        self.assertEqual(len(avisos), 1)
        self.assertEqual((avisos[0]["titulo"], avisos[0]["origem"]), ("⚠️ Hermes (WhatsApp)", "hermes:patch-bridge-envios"))
        self.assertIn("O remendo da bridge do WhatsApp não entrou (", avisos[0]["texto"])
        self.assertIn("nao-existe.js não existe", avisos[0]["texto"])

    def test_sem_avisar_nada_e_gravado(self):
        patch.FILA_DE_AVISOS.mkdir()
        codigo, _ = self.main("--bridge", str(self.raiz / "nao-existe.js"))
        self.assertEqual(codigo, 2)
        self.assertEqual(self.fila(), [])

    def test_fila_ausente_nao_muda_o_codigo_de_saida(self):
        codigo, err = self.main("--bridge", str(self.raiz / "nao-existe.js"), "--avisar")
        self.assertEqual(codigo, 2)
        self.assertFalse(patch.FILA_DE_AVISOS.exists())
        self.assertIn("fila_ausente", err)

    def test_sem_a_lib_o_main_sai_com_2_e_registra_no_stderr(self):
        self.sem_lib()
        patch.FILA_DE_AVISOS.mkdir()
        codigo, err = self.main("--bridge", str(self.raiz / "nao-existe.js"), "--avisar")
        self.assertEqual(codigo, 2)
        self.assertIn("lib de aviso ausente em ~/.local/lib/mel: aviso não gravado:", err)
        self.assertEqual(self.fila(), [])


@unittest.skipIf(patch.node() is None, "sem node: o bloco JS só roda no `--testar` do Dell")
class TextoDoQueODonoEscreve(unittest.TestCase):
    """16/10/2026: o bloco `squadone:envios` grava o texto do que o dono escreve a um LEAD em
    enviadas.jsonl (para a conversa do lead em disco) e põe o id no owner_sent. Roda o bloco de
    verdade no node, com a bridge de mentira; pasta própria `bridge-teste-*` no HOME do teste."""

    def test_so_lead_so_fora_do_log_e_com_id(self):
        casa = Path(tempfile.mkdtemp(prefix="bridge-teste-envios-"))
        self.addCleanup(shutil.rmtree, casa, ignore_errors=True)
        pasta = casa / ".local/state/whatsapp-observador"
        sessao = casa / "sessao"
        pasta.mkdir(parents=True)
        sessao.mkdir()
        (pasta / "leads.json").write_text(json.dumps(["2788887777", "1144445555"]))
        (sessao / "lid-mapping-999_reverse.json").write_text(json.dumps("5511944445555"))
        lead, amigo = "5527988887777@s.whatsapp.net", "5521911112222@s.whatsapp.net"
        casos = [  # [chatId, senderAltId, id, message, ts]
            [lead, "", "A", {"conversation": "Oi! Vi o seu anúncio"}, 1790770000],
            [amigo, "", "B", {"conversation": "conversa pessoal"}, 1790770001],          # fora da lista
            ["999@lid", "", "C", {"extendedTextMessage": {"text": "segue o link"}}, 1790770002],  # lid -> mapa
            ["555@lid", lead, "D", {"imageMessage": {"caption": "o Raio-X"}}, 1790770003],  # lid -> senderAltId
            [lead, "", "ECO1", {"conversation": "eco do Hermes"}, 1790770004],             # eco: nada
            [lead, "", "E", {"reactionMessage": {"text": "x"}}, 1790770005],               # reação: nada
        ]
        bloco = "\n".join("    " + l for l in patch.ENVIOS.split("\n"))
        prog = ("import path from 'path';\nconst saida = [];\nconst writeJsonLine = (p) => saida.push(p);\n"
                f"process.env.HOME = {json.dumps(str(casa))};\nconst SESSION_DIR = {json.dumps(str(sessao))};\n"
                "const getMessageContent = (m) => m.message;\n"
                "const jidNormalizedUser = (j) => String(j).replace(/:\\d+@/, '@');\n"
                "const recentlySentIds = new Set(['ECO1']);\n"
                f"for (const [chatId, senderAltId, id, message, ts] of {json.dumps(casos)}) {{\n"
                "  const msg = { key: { id }, message, messageTimestamp: ts };\n  (() => {\n" + bloco + "\n  })();\n}\n"
                "console.log(JSON.stringify(saida));\n")
        log = patch.rodar_js(prog)
        # O log ganha o id, nunca o texto (o amigo também aparece no log, como sempre: o observador filtra).
        self.assertEqual([l["id"] for l in log], ["A", "B", "C", "D"])
        self.assertTrue(all(set(l) == {"event", "chatId", "ts", "id"} for l in log))
        self.assertNotIn("anúncio", json.dumps(log, ensure_ascii=False))
        linhas = [json.loads(l) for l in (pasta / "enviadas.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual(linhas, [
            {"chave": "2788887777", "ts": 1790770000, "texto": "Oi! Vi o seu anúncio", "id": "A"},
            {"chave": "1144445555", "ts": 1790770002, "texto": "segue o link", "id": "C"},
            {"chave": "2788887777", "ts": 1790770003, "texto": "[imagem] o Raio-X", "id": "D"},
        ])
        # Sem leads.json: nada é gravado (falha fechada).
        (pasta / "enviadas.jsonl").unlink()
        (pasta / "leads.json").unlink()
        patch.rodar_js(prog.replace("globalThis.squadoneLeads", "globalThis.squadoneLeads2"))
        self.assertFalse((pasta / "enviadas.jsonl").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
