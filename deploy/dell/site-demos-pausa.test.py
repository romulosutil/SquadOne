#!/usr/bin/env python3
"""Testes do site-demos-pausa.py: python3 deploy/dell/site-demos-pausa.test.py

O que importa aqui é a troca do avisar() pela lib de aviso (11/10/2026): o
aviso gravado pela lib é IDÊNTICO, byte a byte, ao que o jeito antigo gravava,
o dell-status o aceita, sem a lib (cópia ausente ou quebrada) o script volta ao
jeito antigo, a fila ausente não derruba a rodada e o texto do acervo inteiro
cabe no teto de 4000 caracteres sem perder o que importa.

Nada toca o Dell nem a Vercel: o HOME vira um temporário ANTES do import, cada
teste aponta AUTO, RETRATO, ESTADO e FILA_AVISOS para a própria raiz
`pausa-teste-*`, e token/projeto/vercel são dublês.
"""
import atexit
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

_HOME = tempfile.mkdtemp(prefix="pausa-teste-home-")
os.environ["HOME"] = os.environ["USERPROFILE"] = _HOME
os.environ.pop("SQUADONE_AVISOS_FILA", None)


def _apagar_se_meu(p: str) -> None:
    if Path(p).name.startswith("pausa-teste-") and Path(p).parent == Path(tempfile.gettempdir()):
        shutil.rmtree(p, ignore_errors=True)


atexit.register(_apagar_se_meu, _HOME)

AQUI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("site_demos_pausa", AQUI / "site-demos-pausa.py")
pausa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pausa)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_pausa", AQUI / "dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — sem fcntl (Windows)
    ds = None

TEXTOS = [
    "Pausei 2 demo(s) na Vercel (recusado ou expirado há 15+ dias). Nada foi apagado; a pasta continua em ~/auto-site.\n"
    "• Padaria Açaí & Cia (recusado desde 20/09)\n• \"Bar do Zé\" (expirado desde 21/09)",
    "aspas \"duplas\", barra \\ e acento: ação, coração",
    "duas\nlinhas e emoji ⏸️",
    "dois  espaços  e  nada de moeda",
    "A pausa dos demos não rodou: token da Vercel CLI vencido e não renovou (rode `vercel login` no Dell)",
]


class Base(unittest.TestCase):
    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="pausa-teste-"))
        self.addCleanup(_apagar_se_meu, str(self.raiz))
        nomes = ("AUTO", "REGISTRO", "RETRATO", "ESTADO", "HISTORICO", "FILA_AVISOS", "PASTAS_DA_LIB",
                 "token", "projeto", "vercel", "protecoes_do_crm")
        antes = {k: getattr(pausa, k) for k in nomes}
        self.addCleanup(lambda: [setattr(pausa, k, v) for k, v in antes.items()])
        pausa.AUTO = self.raiz / "auto-site"
        pausa.REGISTRO = pausa.AUTO / "registro.md"
        pausa.RETRATO = self.raiz / "site-leads.json"
        pausa.ESTADO = self.raiz / "estado" / "estado.json"
        pausa.HISTORICO = pausa.ESTADO.with_name("historico.jsonl")
        pausa.FILA_AVISOS = self.raiz / "fila"
        pausa.AUTO.mkdir()
        self.lib_do_repo = list(antes["PASTAS_DA_LIB"])

    def fila(self):
        return sorted(pausa.FILA_AVISOS.glob("*.json")) if pausa.FILA_AVISOS.is_dir() else []

    def avisos(self):
        return [json.loads(p.read_text(encoding="utf-8")) for p in self.fila()]

    def sem_lib(self):
        pausa.PASTAS_DA_LIB = [self.raiz / "sem-lib"]

    def avisar(self, texto):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            pausa.avisar(texto)
        return err.getvalue()

    def gravado_pelo(self, jeito: str, texto: str) -> bytes:
        """O aviso gravado com a lib ('lib') ou sem ela ('antigo'), numa fila limpa."""
        shutil.rmtree(pausa.FILA_AVISOS, ignore_errors=True)
        pausa.FILA_AVISOS.mkdir()
        pausa.PASTAS_DA_LIB = self.lib_do_repo if jeito == "lib" else [self.raiz / "sem-lib"]
        self.avisar(texto)
        self.assertEqual(len(self.fila()), 1, self.fila())
        return self.fila()[0].read_bytes()


class AvisoPelaLib(Base):
    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(pausa.lib_de_aviso().__file__).resolve(), (AQUI / "lib/aviso.py").resolve())

    def test_aviso_identico_ao_jeito_antigo(self):
        for texto in TEXTOS:
            with self.subTest(texto=texto):
                self.assertEqual(self.gravado_pelo("lib", texto), self.gravado_pelo("antigo", texto))

    def test_conteudo_fixado(self):
        esperado = '{"titulo": "⏸️ Site antes da venda: demos", "texto": "uma\\nduas", "origem": "site-demos-pausa"}'
        self.assertEqual(self.gravado_pelo("lib", "uma\nduas"), esperado.encode("utf-8"))

    def test_nome_e_atomicidade(self):
        pausa.FILA_AVISOS.mkdir()
        self.avisar("x")
        self.assertRegex(self.fila()[0].name, r"^site-demos-pausa-\d+-[0-9a-f]{6}\.json$")
        self.assertEqual([p for p in pausa.FILA_AVISOS.iterdir() if not p.name.endswith(".json")], [])

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        pausa.FILA_AVISOS.mkdir()
        for texto in TEXTOS:
            self.avisar(texto)
        self.assertEqual(len(self.fila()), len(TEXTOS))
        for aviso in self.avisos():
            ds.validar_aviso(aviso)

    def test_avisar_devolve_se_ficou_na_fila(self):
        self.assertFalse(pausa.avisar("x"))  # fila ausente: não grava, não cria, não levanta
        self.assertFalse(pausa.FILA_AVISOS.exists())
        pausa.FILA_AVISOS.mkdir()
        self.assertTrue(pausa.avisar("x"))

    def test_com_a_lib_a_fila_ausente_nao_e_criada_e_nao_levanta(self):
        err = self.avisar("x")
        self.assertFalse(pausa.FILA_AVISOS.exists())
        self.assertIn("fila_ausente", err)

    def test_valor_em_reais_no_nome_nao_perde_o_aviso(self):
        pausa.FILA_AVISOS.mkdir()
        self.avisar("Pausei 1 demo(s).\n• Loja R$ 9,99 Todo Dia (recusado desde 20/09)")
        texto = self.avisos()[0]["texto"]
        self.assertNotRegex(texto, r"R\s*\$")
        self.assertIn("Loja [valor] Todo Dia (recusado desde 20/09)", texto)
        self.assertIn("Pausei 1 demo(s).", texto)

    def test_texto_sem_valor_nao_e_mexido(self):
        pausa.FILA_AVISOS.mkdir()
        self.avisar("  dois  espaços  ")
        self.assertEqual(self.avisos()[0]["texto"], "  dois  espaços  ")


class SemLib(Base):
    def test_sem_copia_volta_ao_jeito_antigo(self):
        self.sem_lib()
        self.assertIsNone(pausa.lib_de_aviso())
        self.assertTrue(pausa.avisar("x"))  # o antigo cria a pasta da fila
        self.assertEqual(len(self.fila()), 1)
        self.assertRegex(self.fila()[0].name, r"^site-demos-pausa-\d+\.json$")

    def test_copia_quebrada_volta_ao_jeito_antigo(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("def x(:\n", encoding="utf-8")
        pausa.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(pausa.lib_de_aviso())
        pausa.FILA_AVISOS.mkdir()
        pausa.avisar("x")
        self.assertEqual(len(self.fila()), 1)

    def test_copia_quebrada_cai_na_seguinte(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
        pausa.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(pausa.lib_de_aviso().__file__).resolve(), (AQUI / "lib/aviso.py").resolve())

    def test_sem_a_lib_o_texto_com_valor_vai_como_sempre(self):
        self.sem_lib()
        pausa.avisar("custa R$ 5")
        self.assertEqual(self.avisos()[0]["texto"], "custa R$ 5")


def texto_antigo(pausados, voltaram, falhas):
    """O texto do aviso como o `main` montava antes da lib (cópia do código de 30/09/2026)."""
    from datetime import date
    linhas = []
    if pausados:
        linhas += [f"Pausei {len(pausados)} demo(s) na Vercel (recusado ou expirado há {pausa.DIAS_ATE_PAUSAR}+ dias). "
                   "Nada foi apagado; a pasta continua em ~/auto-site."]
        linhas += [f"• {i['nome']} ({i['motivo']} desde {date.fromisoformat(i['desde']):%d/%m})" for i in pausados[:pausa.MAX_NOMES]]
        if len(pausados) > pausa.MAX_NOMES:
            linhas.append(f"• e mais {len(pausados) - pausa.MAX_NOMES} (lista em {pausa.HISTORICO})")
    if voltaram:
        linhas += ([""] if linhas else []) + [f"De volta ao ar ({len(voltaram)}), o lead voltou:"]
        linhas += [f"• {d.get('nome')}" for d in voltaram]
    if falhas:
        linhas += ([""] if linhas else []) + [f"Não consegui ({len(falhas)}):"] + [f"• {f}" for f in falhas]
    return "\n".join(linhas)


def pausados(n, prefixo="Demo"):
    return [{"nome": f"{prefixo} {i} da Silva Comércio de Alimentos", "motivo": ("recusado", "expirado")[i % 2],
             "desde": f"2026-09-{1 + i % 28:02d}"} for i in range(n)]


def voltaram(n):
    return [{"nome": f"Voltou {i}", "projeto": f"demo-v{i}", "voltou_para": "raiz"} for i in range(n)]


class TextoDoAviso(Base):
    def test_dentro_dos_tetos_e_igual_ao_de_antes(self):
        casos = [(pausados(1), [], []), (pausados(25), [], []), (pausados(26), [], []), ([], voltaram(3), []),
                 (pausados(2), voltaram(2), []), ([], [], ["Fulano: projeto demo-x não existe na Vercel"]),
                 (pausados(3), voltaram(1), ["a: x", "b: y"])]
        for p, v, f in casos:
            with self.subTest(pausados=len(p), voltaram=len(v), falhas=len(f)):
                self.assertEqual(pausa.texto_do_aviso(p, v, f), texto_antigo(p, v, f))

    def test_acervo_inteiro_com_muitas_falhas_cabe_e_nao_perde_o_que_importa(self):
        # Em 10/10/2026 o acervo inteiro (73) pausa de uma vez; com a Vercel falhando
        # o texto de antes passava de 4000 e o dell-status recusava o aviso.
        p, v = pausados(73), voltaram(40)
        f = [f"Falho {i} da Silva: GET /v9/projects/demo-x -> 500: " + "erro interno do servidor " * 8 for i in range(40)]
        texto = pausa.texto_do_aviso(p, v, f)
        self.assertGreater(len(texto_antigo(p, v, f)), 4000)
        self.assertLessEqual(len(texto), 4000)
        # Os três blocos, com a contagem inteira, e o "e mais N" de cada um; os nomes
        # mostrados encolhem até caber (a lista toda fica no historico.jsonl e no estado).
        for trecho in ("Pausei 73 demo(s)", "De volta ao ar (40), o lead voltou:", "Não consegui (40):"):
            self.assertIn(trecho, texto)
        self.assertEqual(len(re.findall(r"• e mais \d+ \(lista em ", texto)), 2)
        self.assertEqual(len(re.findall(r"• e mais \d+ \(cada uma em `falha`", texto)), 1)
        self.assertGreaterEqual(texto.count("• Falho "), 1)
        pausa.FILA_AVISOS.mkdir()
        self.avisar(texto)
        gravado = self.avisos()[0]["texto"]
        self.assertEqual(gravado, texto)  # nada foi cortado pela lib
        self.assertNotIn("(cortado)", gravado)

    def test_nomes_e_falhas_no_maximo_encolhem_ate_caber(self):
        # 25 pausados e 25 que voltaram com nomes de 100 caracteres + 10 falhas de 200:
        # só os tetos fixos passariam de 4000.
        p = [{"nome": f"{i:02d} " + "N" * 97, "motivo": "recusado", "desde": "2026-09-20"} for i in range(73)]
        v = [{"nome": f"{i:02d} " + "V" * 97} for i in range(40)]
        f = [f"{i:02d} " + "F" * 400 for i in range(40)]
        texto = pausa.texto_do_aviso(p, v, f)
        self.assertLessEqual(len(texto), 3900)
        for trecho in ("Pausei 73 demo(s)", "De volta ao ar (40), o lead voltou:", "Não consegui (40):", "• 00 NNN", "• 00 VVV", "• 00 FFF"):
            self.assertIn(trecho, texto)

    def test_linha_de_falha_muito_longa_e_encurtada_com_reticencias(self):
        linha = pausa.texto_do_aviso([], [], ["Fulano: " + "x" * 1000]).splitlines()[1]
        self.assertEqual(len(linha), len("• ") + pausa.MAX_LINHA_FALHA)
        self.assertTrue(linha.endswith("…"))

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita_o_aviso_do_acervo_inteiro(self):
        pausa.FILA_AVISOS.mkdir()
        self.avisar(pausa.texto_do_aviso(pausados(73), voltaram(40), [f"F{i}: " + "y" * 600 for i in range(40)]))
        ds.validar_aviso(self.avisos()[0])


class Rodada(Base):
    """`main()` de ponta a ponta: pastas e retrato em temporário, Vercel dublada."""

    def setUp(self):
        super().setUp()
        self.chamadas = []
        self.protecoes = {}
        pausa.protecoes_do_crm = lambda: self.protecoes.copy()
        self.projetos = {}  # nome -> resposta de projeto(); RuntimeError = a Vercel falhou
        pausa.token = lambda: "token-de-teste"
        pausa.projeto = self.projeto
        pausa.vercel = lambda metodo, caminho, chave: self.chamadas.append((metodo, caminho)) or {}

    def test_conversa_protegida_no_crm_nao_e_pausada_pela_pasta_antiga(self):
        self.lead("fulano")
        self.retrato(self.recusado_ha("fulano", 20))
        self.protecoes["P-fulano"] = "Há conversa humana posterior"
        self.assertEqual(self.rodar(), 0)
        self.assertEqual(self.chamadas, [])

    def test_protecao_que_chega_entre_selecao_e_pausa_preserva_demo(self):
        self.lead("fulano")
        self.retrato(self.recusado_ha("fulano", 20))
        def durante(nome, chave):
            self.protecoes["P-fulano"] = "Próximo passo salvo agora"
            return {"id": "prj_fulano", "paused": False}
        pausa.projeto = durante
        self.rodar()
        self.assertEqual(self.chamadas, [])

    def test_sem_crm_atual_nao_pausa_nada(self):
        self.lead("fulano")
        def falha(): raise RuntimeError("CRM indisponível")
        pausa.protecoes_do_crm = falha
        with self.assertRaises(RuntimeError): self.rodar()
        self.assertEqual(self.chamadas, [])

    def projeto(self, nome, chave):
        r = self.projetos.get(nome, {"id": "prj_" + nome, "paused": False})
        if isinstance(r, Exception):
            raise r
        return r

    def lead(self, slug, topo="_recusados", place_id=None, nome=None):
        self.protecoes[place_id or f"P-{slug}"] = ""
        pasta = pausa.AUTO / topo / slug
        pasta.mkdir(parents=True)
        (pasta / "publicado.json").write_text(json.dumps({
            "vercel_project": f"demo-{slug}", "place_id": place_id or f"P-{slug}", "nome": nome or slug.title()}), encoding="utf-8")

    def retrato(self, *leads, gerado_em=None):
        pausa.RETRATO.write_text(json.dumps({"geradoEm": (gerado_em or datetime.now(timezone.utc)).isoformat(),
                                             "leads": list(leads)}), encoding="utf-8")

    def recusado_ha(self, slug, dias):
        return {"place_id": f"P-{slug}", "status": "recusado",
                "recusado_em": (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()}

    def rodar(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return pausa.main()

    def test_pausa_quem_passou_de_15_dias_e_avisa(self):
        pausa.FILA_AVISOS.mkdir()
        self.lead("fulano", nome="Fulano & Cia")
        self.retrato(self.recusado_ha("fulano", 30))
        self.assertEqual(self.rodar(), 0)
        self.assertEqual(self.chamadas, [("POST", "/v1/projects/prj_demo-fulano/pause")])
        estado = json.loads(pausa.ESTADO.read_text(encoding="utf-8"))
        self.assertTrue(estado["projetos"]["demo-fulano"]["pausado_em"])
        avisos = self.avisos()
        self.assertEqual(len(avisos), 1)
        self.assertEqual((avisos[0]["titulo"], avisos[0]["origem"]), ("⏸️ Site antes da venda: demos", "site-demos-pausa"))
        self.assertIn("Pausei 1 demo(s) na Vercel", avisos[0]["texto"])
        self.assertIn("• Fulano & Cia (recusado desde ", avisos[0]["texto"])
        self.rodar()
        self.assertEqual(len(self.avisos()), 1, "já pausado: a rodada seguinte não avisa de novo")

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita_o_aviso_da_rodada(self):
        pausa.FILA_AVISOS.mkdir()
        self.lead("fulano")
        self.retrato(self.recusado_ha("fulano", 30))
        self.rodar()
        ds.validar_aviso(self.avisos()[0])

    def test_fila_ausente_nao_derruba_a_rodada_nem_o_estado(self):
        # O jeito antigo criava a pasta da fila (do dell-status, 2770) e um OSError ali
        # levantava depois de a Vercel já ter pausado. Com a lib: nada levanta, a pasta
        # não é criada e o estado (que impede pausar de novo) está salvo.
        self.lead("fulano")
        self.retrato(self.recusado_ha("fulano", 30))
        self.assertEqual(self.rodar(), 0)
        self.assertFalse(pausa.FILA_AVISOS.exists())
        self.assertTrue(json.loads(pausa.ESTADO.read_text(encoding="utf-8"))["projetos"]["demo-fulano"]["pausado_em"])

    def test_falha_da_vercel_vira_aviso_e_codigo_1(self):
        pausa.FILA_AVISOS.mkdir()
        self.lead("fulano")
        self.lead("sicrano")
        self.retrato(self.recusado_ha("fulano", 30), self.recusado_ha("sicrano", 30))
        self.projetos["demo-fulano"] = RuntimeError("GET /v9/projects/demo-fulano -> 500: boom")
        self.assertEqual(self.rodar(), 1)
        texto = self.avisos()[0]["texto"]
        self.assertIn("Pausei 1 demo(s)", texto)
        self.assertIn("Não consegui (1):", texto)
        self.assertIn("Fulano: GET /v9/projects/demo-fulano -> 500: boom", texto)
        self.rodar()  # a mesma falha amanhã não é novidade: sem aviso novo
        self.assertEqual(len(self.avisos()), 1)

    def test_lead_que_voltou_e_despausado_e_avisado(self):
        pausa.FILA_AVISOS.mkdir()
        self.lead("fulano")
        self.retrato(self.recusado_ha("fulano", 30))
        self.rodar()
        (pausa.AUTO / "_recusados/fulano").rename(pausa.AUTO / "fulano")  # Desfazer: voltou para a raiz
        self.projetos["demo-fulano"] = {"id": "prj_demo-fulano", "paused": True}
        self.chamadas.clear()
        self.assertEqual(self.rodar(), 0)
        self.assertEqual(self.chamadas, [("POST", "/v1/projects/prj_demo-fulano/unpause")])
        self.assertIn("De volta ao ar (1), o lead voltou:\n• Fulano", self.avisos()[-1]["texto"])

    def test_sem_nada_a_fazer_nao_avisa(self):
        pausa.FILA_AVISOS.mkdir()
        self.lead("fulano", topo="_em-conversa")
        self.retrato()
        self.assertEqual(self.rodar(), 0)
        self.assertEqual(self.fila(), [])

    def test_sem_a_lib_o_aviso_da_rodada_sai_como_antes(self):
        self.sem_lib()
        self.lead("fulano")
        self.retrato(self.recusado_ha("fulano", 30))
        self.assertEqual(self.rodar(), 0)
        self.assertEqual(len(self.fila()), 1)
        self.assertRegex(self.fila()[0].name, r"^site-demos-pausa-\d+\.json$")


if __name__ == "__main__":
    unittest.main(verbosity=2)
