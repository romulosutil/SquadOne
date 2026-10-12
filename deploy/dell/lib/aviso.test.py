#!/usr/bin/env python3
"""Testes da lib de aviso: python3 deploy/dell/lib/aviso.test.py

Nada aqui toca a fila de verdade: o HOME vira um temporário ANTES do import
(e a SQUADONE_AVISOS_FILA sai do ambiente), cada teste grava numa pasta
`aviso-teste-*` própria, passada por parâmetro, e só apaga o que criou.

O dell-status do repo é carregado (só no teste, nunca na lib) para provar duas
coisas: as constantes do formato são as mesmas, e todo arquivo que a lib grava
passa no `validar_aviso` dele. Sem fcntl (Windows) essa parte é pulada.
"""
import atexit
import contextlib
import importlib.util
import io
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

_HOME = tempfile.mkdtemp(prefix="aviso-teste-home-")
os.environ["HOME"] = os.environ["USERPROFILE"] = _HOME
os.environ.pop("SQUADONE_AVISOS_FILA", None)


def _apagar_se_meu(p: str) -> None:
    if Path(p).name.startswith("aviso-teste-") and Path(p).parent == Path(tempfile.gettempdir()):
        shutil.rmtree(p, ignore_errors=True)


atexit.register(_apagar_se_meu, _HOME)

AQUI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("mel_aviso", AQUI / "aviso.py")
av = importlib.util.module_from_spec(_spec)
sys.modules["mel_aviso"] = av
_spec.loader.exec_module(av)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_aviso", AQUI.parent / "dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — sem fcntl/zoneinfo (Windows): pula só a comparação
    ds = None

POSIX = os.name == "posix"


def calado(f, *a, **kw):
    """Chama sem deixar o stderr da lib sujar a saída do teste; devolve (resultado, stderr)."""
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        r = f(*a, **kw)
    return r, err.getvalue()


class ComFila(unittest.TestCase):
    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="aviso-teste-"))
        self.addCleanup(_apagar_se_meu, str(self.raiz))
        self.fila = self.raiz / "fila"
        self.fila.mkdir()

    def arquivos(self):
        return sorted(self.fila.iterdir())

    def lido(self, r):
        self.assertTrue(r.gravado, r)
        return json.loads(r.arquivo.read_bytes().decode("utf-8"))

    def aceito_pelo_dell_status(self, r):
        if ds is None:
            return
        self.assertLessEqual(r.arquivo.stat().st_size, ds.MAX_BYTES_AVISO)
        ds.validar_aviso(json.loads(r.arquivo.read_text(encoding="utf-8")))


class Formato(unittest.TestCase):
    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_constantes_iguais_as_do_dell_status(self):
        self.assertEqual(av.CAMPOS_DO_AVISO, ds.CAMPOS_DO_AVISO)
        self.assertEqual(av.MAX_CARACTERES, ds.MAX_CARACTERES)
        self.assertEqual(av.MAX_BYTES_AVISO, ds.MAX_BYTES_AVISO)
        self.assertEqual(set(av.ORDEM_DOS_CAMPOS), av.CAMPOS_DO_AVISO)

    def test_o_tmp_nao_casa_com_o_glob_do_dell_status(self):
        # O dell-status drena FILA.glob("*.json"): o .tmp oculto nunca é lido pela metade.
        self.assertFalse(Path(".x-1.json.tmp").match("*.json"))


class Gravar(ComFila):
    def test_minimo_byte_a_byte_como_os_scripts_gravavam(self):
        r, err = calado(av.avisar, "🌐 Sites", "Pacote ruim (x.json): ação \"y\"", "auto-entrada", fila=self.fila)
        self.assertEqual(r.estado, av.GRAVADO)
        self.assertEqual(err, "")
        esperado = json.dumps({"titulo": "🌐 Sites", "texto": "Pacote ruim (x.json): ação \"y\"",
                               "origem": "auto-entrada"}, ensure_ascii=False).encode("utf-8")
        self.assertEqual(r.arquivo.read_bytes(), esperado)
        self.assertEqual(self.arquivos(), [r.arquivo])
        self.assertRegex(r.arquivo.name, r"^auto-entrada-\d+-[0-9a-f]{6}\.json$")
        self.aceito_pelo_dell_status(r)

    def test_todos_os_campos_na_ordem_do_formato(self):
        exp = datetime(2026, 10, 12, 18, 0, tzinfo=timezone(timedelta(hours=-3)))
        r, _ = calado(av.avisar, "T", "corpo\nem duas linhas", "backup-dell", chave="backup:2026-10-12",
                      prioridade=0, expira_em=exp, link="https://exemplo.ts.net:8443/crm", fila=self.fila)
        d = self.lido(r)
        self.assertEqual(list(d), ["titulo", "texto", "origem", "chave", "prioridade", "expira_em", "link"])
        self.assertEqual(d["expira_em"], "2026-10-12T18:00:00-03:00")
        self.assertEqual(d["texto"], "corpo\nem duas linhas")
        self.aceito_pelo_dell_status(r)

    def test_gravar_dict_pronto_e_prefixo(self):
        r, _ = calado(av.gravar, {"titulo": "A", "texto": "b", "origem": "hermes:graphify-projetos"}, fila=self.fila)
        self.assertRegex(r.arquivo.name, r"^hermes-graphify-projetos-\d+-[0-9a-f]{6}\.json$")
        r2, _ = calado(av.gravar, {"titulo": "A", "texto": "b", "origem": "x"}, fila=self.fila, prefixo="Backup Dell!")
        self.assertTrue(r2.arquivo.name.startswith("backup-dell-"))

    def test_nome_unico_mesmo_no_mesmo_nanossegundo(self):
        original = av.time.time_ns
        av.time.time_ns = lambda: 1
        try:
            a, _ = calado(av.avisar, "A", "b", "o", fila=self.fila)
            b, _ = calado(av.avisar, "A", "b", "o", fila=self.fila)
        finally:
            av.time.time_ns = original
        self.assertNotEqual(a.arquivo, b.arquivo)
        self.assertEqual(len(self.arquivos()), 2)

    def test_sem_tmp_sobrando(self):
        for i in range(5):
            calado(av.avisar, "A", f"b{i}", "o", fila=self.fila)
        self.assertEqual([p for p in self.arquivos() if not p.name.endswith(".json")], [])

    @unittest.skipUnless(POSIX, "permissão só no POSIX")
    def test_arquivo_sem_permissao_para_outros(self):
        r, _ = calado(av.avisar, "A", "b", "o", fila=self.fila)
        self.assertEqual(stat.S_IMODE(r.arquivo.stat().st_mode) & 0o007, 0)

    def test_fila_padrao_vem_do_home_ou_da_variavel(self):
        self.assertEqual(av.fila_padrao(), Path(_HOME) / ".local/share/avisos/fila")
        os.environ["SQUADONE_AVISOS_FILA"] = str(self.fila)
        try:
            r, _ = calado(av.avisar, "A", "b", "o")
        finally:
            os.environ.pop("SQUADONE_AVISOS_FILA")
        self.assertEqual(r.arquivo.parent, self.fila)


class Cortes(ComFila):
    def test_titulo_com_quebra_e_longo_vira_uma_linha(self):
        r, _ = calado(av.avisar, "linha 1\nlinha 2", "b", "o", fila=self.fila)
        self.assertEqual(self.lido(r)["titulo"], "linha 1 linha 2")
        r, _ = calado(av.avisar, "x" * 300, "b", "o", fila=self.fila)
        t = self.lido(r)["titulo"]
        self.assertEqual(len(t), 120)
        self.assertTrue(t.endswith("…"))
        self.aceito_pelo_dell_status(r)

    def test_origem_longa(self):
        r, _ = calado(av.avisar, "A", "b", "n8n:" + "fluxo " * 40, fila=self.fila)
        self.assertLessEqual(len(self.lido(r)["origem"]), 80)
        self.aceito_pelo_dell_status(r)

    def test_texto_longo_avisa_que_cortou(self):
        r, _ = calado(av.avisar, "A", "y" * 9000, "o", fila=self.fila)
        t = self.lido(r)["texto"]
        self.assertLessEqual(len(t), 4000)
        self.assertTrue(t.endswith("… (cortado)"))
        self.aceito_pelo_dell_status(r)

    def test_texto_que_passa_de_16_kb_encurta_ate_caber(self):
        # 4000 caracteres de controle viram 24000 bytes no JSON (\\u0007).
        r, _ = calado(av.avisar, "A", "\x07" * 4000, "o", fila=self.fila)
        self.assertLessEqual(r.arquivo.stat().st_size, av.MAX_BYTES_AVISO)
        self.assertTrue(self.lido(r)["texto"].endswith("… (cortado)"))
        self.aceito_pelo_dell_status(r)
        r, _ = calado(av.avisar, "A", "🌐" * 4000 + "\"" * 10, "o", fila=self.fila)
        self.assertLessEqual(r.arquivo.stat().st_size, av.MAX_BYTES_AVISO)
        self.aceito_pelo_dell_status(r)

    def test_chave_longa_vira_hash_estavel_e_distinta(self):
        a = av.chave_curta("k" * 250 + "A")
        b = av.chave_curta("k" * 250 + "B")
        self.assertEqual(len(a), 200)
        self.assertNotEqual(a, b)
        self.assertEqual(a, av.chave_curta("k" * 250 + "A"))
        r, _ = calado(av.avisar, "A", "b", "o", chave="k" * 250, fila=self.fila)
        self.assertEqual(len(self.lido(r)["chave"]), 200)
        self.aceito_pelo_dell_status(r)

    def test_no_formato_passa_intacto(self):
        d = {"titulo": "  com espaço  ", "texto": "  t  ", "origem": "o"}
        self.assertEqual(av._cortar(d), d)

    def test_cortar_false_recusa_em_vez_de_cortar(self):
        r, _ = calado(av.avisar, "x" * 121, "b", "o", fila=self.fila, cortar=False)
        self.assertEqual(r.estado, av.RECUSADO)
        self.assertIn("'titulo' passa de 120", r.motivo)
        self.assertEqual(self.arquivos(), [])


class Recusas(ComFila):
    CASOS = [
        ({"titulo": "A", "texto": "b"}, "'origem' é obrigatório"),
        ({"titulo": "A", "texto": "   ", "origem": "o"}, "'texto' é obrigatório"),
        ({"titulo": "", "texto": "b", "origem": "o"}, "'titulo' é obrigatório"),
        ({"titulo": "A", "texto": "b", "origem": "o", "extra": 1}, "campo(s) fora do formato: extra"),
        ({"titulo": "A", "texto": "b", "origem": "o", "prioridade": 4}, "'prioridade'"),
        ({"titulo": "A", "texto": "b", "origem": "o", "prioridade": -1}, "'prioridade'"),
        ({"titulo": "A", "texto": "b", "origem": "o", "prioridade": True}, "'prioridade'"),
        ({"titulo": "A", "texto": "b", "origem": "o", "prioridade": "2"}, "'prioridade'"),
        ({"titulo": "A", "texto": "b", "origem": "o", "prioridade": 2.0}, "'prioridade'"),
        ({"titulo": "A", "texto": "b", "origem": "o", "expira_em": "amanhã"}, "'expira_em'"),
        ({"titulo": "A", "texto": "b", "origem": "o", "expira_em": 1760000000}, "'expira_em'"),
        ({"titulo": "A", "texto": "b", "origem": "o", "link": "ftp://x"}, "'link'"),
        ({"titulo": "A", "texto": "b", "origem": "o", "link": "https://x y"}, "'link'"),
        ({"titulo": "A", "texto": "b", "origem": "o", "link": "https://x/" + "a" * 500}, "'link' passa de 500"),
        ({"titulo": 7, "texto": "b", "origem": "o"}, "'titulo' é obrigatório"),
        ({"titulo": "A", "texto": "b", "origem": "o", "chave": 3}, "'chave' deve ser texto"),
    ]

    def test_tabela_de_recusas(self):
        for d, trecho in self.CASOS:
            with self.subTest(d=d):
                r, err = calado(av.gravar, d, fila=self.fila)
                self.assertEqual(r.estado, av.RECUSADO)
                self.assertIn(trecho, r.motivo)
                self.assertIsNone(r.arquivo)
                self.assertIn("aviso não gravado (recusado", err)
        self.assertEqual(self.arquivos(), [])

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_o_dell_status_tambem_recusa_cada_caso(self):
        # Paridade: o que a lib recusa (fora o R$, regra só dela) o dell-status também recusaria.
        for d, _ in self.CASOS:
            with self.subTest(d=d), self.assertRaises(ValueError):
                ds.validar_aviso(d)

    def test_nada_de_r_cifrao_em_titulo_texto_ou_link(self):
        for campos in ({"titulo": "Paguei R$ 30"}, {"texto": "custou r$30"}, {"texto": "R $ 10"},
                       {"link": "https://x/?v=R$1"}):
            with self.subTest(campos=campos):
                d = {"titulo": "A", "texto": "b", "origem": "o", **campos}
                r, _ = calado(av.gravar, d, fila=self.fila)
                self.assertEqual(r.estado, av.RECUSADO)
                self.assertIn("R$", r.motivo)
        self.assertEqual(self.arquivos(), [])

    def test_sem_valores_limpa_antes(self):
        self.assertEqual(av.sem_valores("Pagar boleto R$ 300,50 hoje"), "Pagar boleto [valor] hoje")
        r, _ = calado(av.avisar, "A", av.sem_valores("custou R$30"), "o", fila=self.fila)
        self.assertTrue(r.gravado)

    def test_nao_e_dict(self):
        r, _ = calado(av.gravar, ["titulo"], fila=self.fila)
        self.assertEqual((r.estado, r.motivo), (av.RECUSADO, "não é um objeto JSON"))


class NuncaLevanta(ComFila):
    def test_fila_ausente_nao_e_criada(self):
        ausente = self.raiz / "nao-existe"
        r, err = calado(av.avisar, "A", "b", "o", fila=ausente)
        self.assertEqual(r.estado, av.FILA_AUSENTE)
        self.assertFalse(ausente.exists())
        self.assertIn("fila_ausente", err)

    def test_fila_que_e_arquivo(self):
        arq = self.raiz / "arquivo"
        arq.write_text("não é pasta")
        r, _ = calado(av.avisar, "A", "b", "o", fila=arq)
        self.assertEqual(r.estado, av.FILA_AUSENTE)
        self.assertEqual(arq.read_text(), "não é pasta")

    def test_rename_que_falha_vira_falhou_sem_tmp(self):
        original = av.os.replace

        def quebra(*_a, **_kw):
            raise OSError(28, "No space left on device")
        av.os.replace = quebra
        try:
            r, err = calado(av.avisar, "A", "b", "o", fila=self.fila)
        finally:
            av.os.replace = original
        self.assertEqual(r.estado, av.FALHOU)
        self.assertIn("No space left", r.motivo)
        self.assertEqual(self.arquivos(), [])
        self.assertIn("aviso não gravado (falhou, o)", err)

    @unittest.skipUnless(POSIX and os.geteuid() != 0, "permissão só no POSIX e sem root")
    def test_fila_sem_permissao(self):
        self.fila.chmod(0o500)
        self.addCleanup(self.fila.chmod, 0o700)
        r, _ = calado(av.avisar, "A", "b", "o", fila=self.fila)
        self.assertEqual(r.estado, av.FALHOU)
        self.assertIn("PermissionError", r.motivo)

    def test_erro_inesperado_vira_falhou(self):
        original = av._serializar

        def quebra(_d):
            raise RuntimeError("bug")
        av._serializar = quebra
        try:
            r, _ = calado(av.avisar, "A", "b", "o", fila=self.fila)
        finally:
            av._serializar = original
        self.assertEqual((r.estado, r.motivo), (av.FALHOU, "RuntimeError: bug"))

    def test_argumento_estranho_nao_levanta(self):
        r, _ = calado(av.avisar, None, object(), 3, fila=self.fila)
        self.assertEqual(r.estado, av.RECUSADO)
        r, _ = calado(av.gravar, None, fila=self.fila)
        self.assertEqual(r.estado, av.RECUSADO)

    def test_stderr_fechado_nao_levanta(self):
        antigo = sys.stderr
        sys.stderr = None
        try:
            r = av.avisar("A", "b", "o", fila=self.raiz / "nao-existe")
        finally:
            sys.stderr = antigo
        self.assertEqual(r.estado, av.FILA_AUSENTE)


if __name__ == "__main__":
    unittest.main(verbosity=2)
