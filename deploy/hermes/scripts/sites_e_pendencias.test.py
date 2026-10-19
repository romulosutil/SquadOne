#!/usr/bin/env python3
"""Testes do sites_e_pendencias.py: python3 deploy/hermes/scripts/sites_e_pendencias.test.py

O que importa aqui é a troca do job do Hermes pelo timer do systemd (11/10/2026):
com `--fila` a mensagem do dia vira UM aviso que o dell-status aceita, com o
conteúdo que o job antigo imprimia (chave do dia, P1, vale até as 22h, cortado
acima de 4000 com marca); `--teste` nunca grava na fila; erro e SIGTERM viram
aviso; sem a lib de aviso nada é gravado (uma linha no stderr, a rodada sai 1); sem `--fila` nada muda.

Nada toca o Dell: o HOME vira um temporário ANTES do import e cada teste aponta
as fontes (auto-site, n8n-estado, status.json), a contagem e a fila para a
própria raiz.
"""
import atexit
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import signal
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

_HOME = tempfile.mkdtemp(prefix="sites-pendencias-teste-home-")
os.environ["HOME"] = _HOME
os.environ.pop("SQUADONE_AVISOS_FILA", None)
atexit.register(shutil.rmtree, _HOME, True)

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent.parent
_spec = importlib.util.spec_from_file_location("sites_e_pendencias", AQUI / "sites_e_pendencias.py")
sep = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sep)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_sites", RAIZ / "deploy/dell/dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — sem fcntl (Windows)
    ds = None

BR = timezone(timedelta(hours=-3))
AGORA = datetime(2026, 10, 11, 10, 30, 5, tzinfo=BR)
NOMES = ("AUTO", "GERADOR", "N8N", "STATUS", "CONTAGENS", "RETRATO", "FILA", "PASTAS_DA_LIB", "agora", "hoje")


def calado(f, *a, **k):
    """(resultado, stdout, stderr) sem sujar a saída do teste."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        r = f(*a, **k)
    return r, out.getvalue(), err.getvalue()


class Base(unittest.TestCase):
    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="sites-pendencias-teste-"))
        self.addCleanup(shutil.rmtree, self.raiz, True)
        self.antes = {k: getattr(sep, k) for k in NOMES}
        self.addCleanup(lambda: [setattr(sep, k, v) for k, v in self.antes.items()])
        self.lib_do_repo = list(self.antes["PASTAS_DA_LIB"])
        sep.AUTO = self.raiz / "auto-site"
        sep.GERADOR = sep.AUTO / ".logs/status.json"
        sep.N8N = self.raiz / "n8n-estado"
        sep.STATUS = self.raiz / "status.json"
        sep.CONTAGENS = self.raiz / "contagens.json"
        sep.RETRATO = sep.N8N / "site-leads.json"
        sep.FILA = self.raiz / "fila"
        sep.FILA.mkdir()  # a pasta é do dell-status (2770): existe no Dell e a lib não a cria
        self.relogio(AGORA)
        self.cenario()

    def relogio(self, quando):
        sep.agora, sep.hoje = quando, quando.date()

    def cenario(self, leads=3, itens=None):
        """Um dia comum: um site publicado hoje, um na fila, o gerador terminou, pendências do n8n."""
        (sep.AUTO / ".logs").mkdir(parents=True)
        pub = sep.AUTO / "padaria-do-ze"
        pub.mkdir()
        (pub / "content.md").write_text("x", encoding="utf-8")
        (pub / "publicado.json").write_text("{}", encoding="utf-8")
        t = AGORA.timestamp() - 3600
        os.utime(pub / "publicado.json", (t, t))
        fila = sep.AUTO / "oficina-aurora"
        fila.mkdir()
        (fila / "content.md").write_text("x", encoding="utf-8")
        sep.GERADOR.write_text(json.dumps({"estado": "ocioso", "ultimo_resumo": {
            "fim": "2026-10-11T09:47:00-03:00", "concluidos": ["padaria-do-ze"], "falhas": []}}), encoding="utf-8")
        sep.N8N.mkdir()
        itens = itens if itens is not None else [
            {"id": "site-resposta", "nome": "Enviados esperando resposta", "quantidade": leads,
             "detalhe": "toque no link do lead", "link": "https://docs.google.com/spreadsheets/d/x"}]
        (sep.N8N / "site-antes-da-venda.json").write_text(json.dumps(
            {"geradoEm": "2026-10-11T10:00:00-03:00", "itens": itens}), encoding="utf-8")
        (sep.RETRATO).write_text(json.dumps({"geradoEm": "2026-10-11T10:00:00-03:00", "leads": [
            {"grupo": "resposta", "nome": f"Lead {i} “aspas” & acento", "link": f"https://x.ts.net/l/{i}",
             "enviado_em": f"2026-10-0{i % 9 + 1}"} for i in range(leads)]}), encoding="utf-8")
        sep.STATUS.write_text(json.dumps({"geradoEm": "2026-10-11T10:29:00-03:00", "verificacoes": []}), encoding="utf-8")

    def fila(self):
        return sorted(sep.FILA.glob("*.json")) if sep.FILA.is_dir() else []

    def aviso(self):
        arquivos = self.fila()
        self.assertEqual(len(arquivos), 1, arquivos)
        return json.loads(arquivos[0].read_text(encoding="utf-8"))

    def antigo(self) -> str:
        """O que o job do Hermes imprimia (sem --fila), sem deixar contagem."""
        guardado = sep.CONTAGENS.read_bytes() if sep.CONTAGENS.exists() else None
        r, out, _ = calado(sep.main, [])
        self.assertEqual(r, 0)
        if guardado is None:
            sep.CONTAGENS.unlink(missing_ok=True)
        else:
            sep.CONTAGENS.write_bytes(guardado)
        return out.strip()


class PelaFila(Base):
    def test_um_aviso_com_o_conteudo_do_job_antigo(self):
        impresso = self.antigo()
        self.assertEqual(self.fila(), [])  # o modo antigo não grava na fila
        r, out, _ = calado(sep.main, ["--fila"])
        self.assertEqual(r, 0)
        d = self.aviso()
        self.assertEqual(d["titulo"], "🌐 *Sites e pendências — 11/10*")
        self.assertEqual(d["origem"], "sites-e-pendencias")
        self.assertEqual(d["chave"], "sites-e-pendencias:2026-10-11")
        self.assertEqual(d["prioridade"], 1)
        self.assertEqual(d["expira_em"], "2026-10-11T22:00:00-03:00")
        # O que chega ao WhatsApp é o que o job imprimia, sem a linha em branco depois do título.
        self.assertEqual(f"{d['titulo']}\n{d['texto']}", impresso.replace("\n\n", "\n", 1))
        self.assertIn("Lead 1", d["texto"])
        self.assertIn("aviso gravado na fila", out)  # o stdout é log
        if ds is not None:
            self.assertEqual(ds.mensagem_do_aviso(ds.validar_aviso(d)), impresso.replace("\n\n", "\n", 1))

    def test_guarda_a_contagem_do_dia(self):
        calado(sep.main, ["--fila"])
        self.assertIn("2026-10-11", json.loads(sep.CONTAGENS.read_text(encoding="utf-8")))

    def test_teste_nunca_grava_na_fila_nem_a_contagem(self):
        for args in (["--teste"], ["--teste", "--fila"], ["--fila", "--teste"]):
            with self.subTest(args=args):
                r, out, _ = calado(sep.main, args)
                self.assertEqual(r, 0)
                self.assertTrue(out.startswith("[teste] 🌐"))
                self.assertEqual(self.fila(), [])
                self.assertFalse(sep.CONTAGENS.exists())

    def test_sem_fila_imprime_como_sempre(self):
        r, out, _ = calado(sep.main, [])
        self.assertEqual(r, 0)
        self.assertTrue(out.startswith("🌐 *Sites e pendências — 11/10*\n\n"))
        self.assertEqual(self.fila(), [])
        self.assertTrue(sep.CONTAGENS.exists())

    def test_texto_longo_e_cortado_com_marca_pela_lib(self):
        itens = [{"id": f"p{i}", "nome": f"Pendência {i}", "quantidade": i + 1,
                  "detalhe": "um detalhe comprido o bastante para a mensagem passar de quatro mil caracteres " * 2,
                  "link": f"https://docs.google.com/spreadsheets/d/{i}"} for i in range(40)]
        (sep.N8N / "site-antes-da-venda.json").write_text(json.dumps(
            {"geradoEm": "2026-10-11T10:00:00-03:00", "itens": itens}), encoding="utf-8")
        sep.PASTAS_DA_LIB = self.lib_do_repo
        self.assertGreater(len(self.antigo()), 4000)
        r, _, _ = calado(sep.main, ["--fila"])
        self.assertEqual(r, 0)
        d = self.aviso()
        self.assertLessEqual(len(d["texto"]), 4000)
        self.assertTrue(d["texto"].endswith("… (cortado)"))
        self.assertTrue(d["texto"].startswith("*Gerador:* terminou às 09:47"))
        if ds is not None:
            ds.validar_aviso(d)

    def test_valor_em_reais_vira_marcador_em_vez_de_perder_a_mensagem(self):
        (sep.N8N / "prumo.json").write_text(json.dumps({"geradoEm": "2026-10-11T10:00:00-03:00", "itens": [
            {"id": "prumo-proposta", "nome": "PRUMO: propostas", "quantidade": 1, "detalhe": "de R$ 1.200"}]}),
            encoding="utf-8")
        calado(sep.main, ["--fila"])
        d = self.aviso()
        self.assertNotRegex(d["texto"], r"R\s*\$")
        self.assertIn("[valor]", d["texto"])

    def test_depois_das_22h_nao_manda_a_do_dia(self):
        self.relogio(datetime(2026, 10, 11, 22, 5, tzinfo=BR))
        r, out, _ = calado(sep.main, ["--fila"])
        self.assertEqual(r, 0)
        self.assertEqual(self.fila(), [])
        self.assertIn("depois das 22h", out)

    def test_dell_status_entrega_como_prioridade_1(self):
        if ds is None:
            self.skipTest("dell-status não carrega aqui (sem fcntl)")
        calado(sep.main, ["--fila"])
        a = ds.validar_aviso(self.aviso())
        self.assertEqual(a["prioridade"], 1)
        self.assertEqual(a["chave"], "sites-e-pendencias:2026-10-11")
        self.assertEqual(a["expira_em"], datetime(2026, 10, 11, 22, 0, tzinfo=BR))


class Falhas(Base):
    def test_erro_inesperado_vira_aviso_e_a_unit_falha(self):
        def quebra(*a, **k):
            raise RuntimeError("status.json travado")
        sep.bloco_gerador, original = quebra, sep.bloco_gerador
        self.addCleanup(setattr, sep, "bloco_gerador", original)
        r, _, err = calado(sep.main, ["--fila"])
        self.assertEqual(r, 1)
        d = self.aviso()
        self.assertEqual(d["titulo"], "🌐 Sites e pendências — 11/10")
        self.assertIn("A mensagem de hoje não saiu: a rodada caiu com erro: RuntimeError: status.json travado", d["texto"])
        self.assertIn("journalctl --user -u sites-e-pendencias", d["texto"])
        self.assertEqual(d["chave"], "sites-e-pendencias:falha:2026-10-11")  # não tampa a do dia, se uma rodada à mão der certo
        self.assertIn("Traceback", err)
        if ds is not None:
            ds.validar_aviso(d)

    def test_sigterm_vira_aviso(self):
        antes = signal.getsignal(signal.SIGTERM)

        def termina(*a, **k):
            os.kill(os.getpid(), signal.SIGTERM)  # o que o systemd manda ao passar do TimeoutStartSec
            return []
        sep.bloco_gerador, original = termina, sep.bloco_gerador
        self.addCleanup(setattr, sep, "bloco_gerador", original)
        r, _, _ = calado(sep.main, ["--fila"])
        self.assertEqual(r, 1)
        self.assertIn("a rodada foi interrompida (SIGTERM)", self.aviso()["texto"])
        self.assertIs(signal.getsignal(signal.SIGTERM), antes)

    def test_fila_ausente_faz_a_unit_falhar_e_o_texto_fica_no_journal(self):
        shutil.rmtree(sep.FILA)
        r, out, err = calado(sep.main, ["--fila"])
        self.assertEqual(r, 1)
        self.assertIn("🌐 *Sites e pendências — 11/10*", out)
        self.assertIn("fila_ausente", err)
        self.assertFalse(sep.FILA.exists())  # a lib não cria a pasta do dell-status


class SemLib(Base):
    def test_sem_copia_nada_e_gravado_e_a_rodada_sai_1(self):
        sep.FILA.mkdir(exist_ok=True)
        sep.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        self.assertIsNone(sep.lib_de_aviso())
        r, out, err = calado(sep.main, ["--fila"])
        self.assertEqual(r, 1)
        self.assertIn("🌐 *Sites e pendências — 11/10*", out)  # o texto fica no journal
        self.assertIn("lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: 🌐 *Sites e pendências — 11/10*", err)
        self.assertEqual(self.fila(), [])

    def test_copia_quebrada_cai_na_seguinte(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
        sep.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(sep.lib_de_aviso().__file__).resolve(), (RAIZ / "deploy/dell/lib/aviso.py").resolve())
        sep.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(sep.lib_de_aviso())

    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(sep.lib_de_aviso().__file__).resolve(), (RAIZ / "deploy/dell/lib/aviso.py").resolve())


class Units(unittest.TestCase):
    def test_o_validador_do_dell_status_carrega_no_linux(self):
        # Sem isto, os testes que conferem o aviso contra o dell-status passariam calados.
        if importlib.util.find_spec("fcntl") is not None:
            self.assertIsNotNone(ds)

    def ler(self, nome):
        return (RAIZ / "deploy/dell" / nome).read_text(encoding="utf-8")

    def test_service_roda_a_copia_instalada_com_fila(self):
        s = self.ler("sites-e-pendencias.service")
        self.assertIn("ExecStart=/usr/bin/python3 %h/.local/bin/sites-e-pendencias --fila\n", s)
        self.assertIn("Type=oneshot", s)

    def test_timer_as_10h30_persistente(self):
        t = self.ler("sites-e-pendencias.timer")
        self.assertRegex(t, r"(?m)^OnCalendar=\*-\*-\* 10:30:00$")
        self.assertIn("Persistent=true", t)
        self.assertIn("WantedBy=timers.target", t)

    def test_instalados_json_leva_o_script_e_as_units(self):
        inst = json.loads((RAIZ / "deploy/dell/instalados.json").read_text(encoding="utf-8"))["arquivos"]
        self.assertIn(("deploy/hermes/scripts/sites_e_pendencias.py", "~/.local/bin/sites-e-pendencias"),
                      {(e["repo"], e["instalado"]) for e in inst})
        # As units entram pelo curinga, do mesmo jeito que o dell-status o lê (comparar_instalados).
        for unit in ("sites-e-pendencias.service", "sites-e-pendencias.timer"):
            cobertas = [e for e in inst if any(c in e["repo"] for c in "*?[")
                        and RAIZ / "deploy/dell" / unit in set(RAIZ.glob(e["repo"]))
                        and e["instalado"] == "~/.config/systemd/user/"]
            self.assertTrue(cobertas, unit)


if __name__ == "__main__":
    unittest.main(verbosity=1)
