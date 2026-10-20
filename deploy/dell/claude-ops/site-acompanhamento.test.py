#!/usr/bin/env python3
"""Testes do `--resumo-backlog --enviar` do site-acompanhamento.py: python3 deploy/dell/claude-ops/site-acompanhamento.test.py

Só a gravação do aviso pela lib de aviso (11/10/2026): o aviso gravado tem o
conteúdo do dict que `resumo_backlog()` devolve, o dell-status aceita o arquivo,
sem a lib o `--enviar` não grava nada (linha no stderr, saída 1), e a fila ausente
vira uma mensagem (e a saída 1), não um traceback. O resto do script (n8n, planilha, fluxos) tem os testes
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
from datetime import datetime, timezone
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

    def gravado_pela_lib(self, aviso: dict) -> bytes:
        shutil.rmtree(sa.FILA, ignore_errors=True)
        sa.FILA.mkdir()
        sa.PASTAS_DA_LIB = self.lib_do_repo
        ok, _ = self.enviar(aviso)
        self.assertTrue(ok)
        arquivos = self.fila()
        self.assertEqual(len(arquivos), 1, arquivos)
        return arquivos[0].read_bytes()


class ExpiracaoSemFollowup(unittest.TestCase):
    """19/10/2026: o 05 · Acompanhamento só expira (no 7º dia) e avisa os expirados. O follow-up do 3º dia é da Central
    (server/crm.ts): o ramo `followup`, a coluna `followup_em` e o `leu` saíram daqui. O nó "Montar avisos" e o "Decidir"
    rodam no node com entradas de mentira; nada vai ao n8n."""

    def montar_avisos(self, itens: list[dict]) -> list[dict]:
        node = shutil.which("node")
        if not node:
            self.skipTest("sem node")
        js = ("const $workflow = { name: '05 · Acompanhamento (Site antes da venda)' };\n"
              f"const $ = () => ({{ all: () => {json.dumps([{'json': i} for i in itens], ensure_ascii=False)} }});\n"
              "const r = (() => {\n" + sa.AVISOS + "\n})();\n"
              "console.log(JSON.stringify(r.map((x) => JSON.parse(Buffer.from(x.binary.data.data, 'base64').toString('utf8')))));")
        import subprocess
        p = subprocess.run([node, "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout)

    def decidir(self, linhas: list[dict], recibos: list[tuple[str, dict]]) -> list[dict]:
        """O código do nó Decidir, com o corte recuado para 01/09 (o real deixaria tudo como acervo)."""
        if not shutil.which("node"):
            self.skipTest("sem node")
        codigo = sa.DECIDIR.replace(sa.CORTE, "2026-09-01T00:00:00-03:00")
        nos = sa.sv.nos_de_arquivos("Ler recibos da pasta auto", "Ler o JSON do recibo", "recibo", recibos)
        nos["Ler aba CRM"] = []
        nos["Ler a planilha"] = [{"json": l} for l in linhas]
        return [i["json"] for i in sa.sv.rodar_js(codigo, nos, [{"json": l} for l in linhas])]

    def test_expirado_avisa_com_o_prazo_certo_e_so_ele(self):
        avisos = self.montar_avisos([
            {"acao": "expirar", "nome": "Oficina", "cidade": "", "site_url": "", "raio_x_url": "https://r.app/o", "dias": 7},
        ])
        self.assertEqual([a["titulo"] for a in avisos], ["⏳ Site antes da venda: expirados"])
        self.assertIn("Oficina: https://r.app/o", avisos[0]["texto"])
        self.assertIn(f"sem resposta em {sa.EXPIRA_DIAS} dias", avisos[0]["texto"])
        self.assertEqual(sa.EXPIRA_DIAS, 7)  # o DIAS_SEM_RESPOSTA da Central (server/crm.ts)
        self.assertTrue(avisos[0]["origem"].startswith("n8n:05"))

    def test_sem_expirado_nao_sai_aviso_nenhum(self):
        self.assertEqual(self.montar_avisos([]), [])

    def test_o_05_nao_decide_mais_o_follow_up(self):
        wf = sa.acompanhamento("erro")
        marcar = next(n for n in wf["nodes"] if n["name"] == "Marcar na planilha")
        self.assertEqual(set(marcar["parameters"]["columns"]["value"]), {"place_id", "status"})
        decidir = next(n for n in wf["nodes"] if n["name"] == "Decidir")["parameters"]["jsCode"]
        for resto in ("followup", "visto_em", "lido_em", "FOLLOWUP"):
            self.assertNotIn(resto, decidir)
        self.assertNotIn("followupDe", decidir)  # o texto do follow-up é da Central

    def test_decidir_expira_no_setimo_dia_e_nao_faz_mais_nada(self):
        agora = datetime.now(timezone.utc)
        dia = lambda d: datetime.fromtimestamp(agora.timestamp() - d * 86400, timezone.utc).isoformat()
        def lead(pid, **k):
            return {"place_id": pid, "nome": pid, "status": "enviado", "respondeu_em": "", "enviado_em": dia(1), **k}
        recibos = [("a", {"place_id": "a"}), ("b", {"place_id": "b"}), ("c", {"place_id": "c"}), ("d", {"place_id": "d"}),
                   ("_recusados/e", {"place_id": "e"}), ("_em-conversa/f", {"place_id": "f"})]
        saida = self.decidir([
            lead("a", enviado_em=dia(3.2), visto_em=dia(3)),   # 3º dia e leu: nada (follow-up é da Central)
            lead("b", enviado_em=dia(5)),                      # ainda cedo
            lead("c", enviado_em=dia(7.5)),                    # expira
            lead("d", enviado_em=dia(9), respondeu_em=dia(8)),  # respondeu: nada
            lead("e", enviado_em=dia(9)),                      # _recusados: o Rômulo já decidiu
            lead("f", enviado_em=dia(9)),                      # _em-conversa: idem
            lead("sem-pasta", enviado_em=dia(8)),              # sem recibo (A sem demo): expira também
            lead("sem-pasta-novo", enviado_em=dia(2)),         # sem recibo, cedo: nada
            lead("g", enviado_em=dia(9), resposta_tipo="interesse"),  # resposta de gente protege
        ], recibos)
        self.assertEqual(sorted((s["place_id"], s["acao"], s["status"]) for s in saida),
                         [("c", "expirar", "expirado"), ("sem-pasta", "expirar", "expirado")])

    def test_sem_nenhum_recibo_lido_nada_expira(self):
        # A leitura da pasta que falhou não pode expirar ninguém por falta de informação.
        agora = datetime.now(timezone.utc)
        velho = datetime.fromtimestamp(agora.timestamp() - 9 * 86400, timezone.utc).isoformat()
        self.assertEqual(self.decidir([{"place_id": "x", "nome": "x", "status": "enviado", "respondeu_em": "", "enviado_em": velho}], []), [])


class TrocaPelaLib(Base):
    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(sa.lib_de_aviso().__file__).resolve(), LIB_DO_REPO)

    def test_aviso_gravado_le_de_volta_igual(self):
        for texto in (RESUMO, "curto", "aspas \"duplas\", barra \\ e acento: ação", "duas\nlinhas e emoji 🌐"):
            with self.subTest(texto=texto[:30]):
                self.assertEqual(json.loads(self.gravado_pela_lib(aviso_de(texto))), aviso_de(texto))

    def test_conteudo_fixado(self):
        esperado = json.dumps(aviso_de("duas\nlinhas"), ensure_ascii=False).encode("utf-8")
        self.assertEqual(self.gravado_pela_lib(aviso_de("duas\nlinhas")), esperado)
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
    def sem_gravar(self):
        sa.FILA.mkdir()
        ok, saida = self.enviar(aviso_de("x"))
        self.assertFalse(ok)
        self.assertIn("lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: " + aviso_de("x")["titulo"], saida)
        self.assertEqual(self.fila(), [], "sem a lib nada é gravado na fila")

    def test_sem_copia_registra_no_stderr_e_nao_grava(self):
        sa.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        self.assertIsNone(sa.lib_de_aviso())
        self.sem_gravar()

    def test_copia_quebrada_registra_no_stderr_e_nao_grava(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("def x(:\n", encoding="utf-8")
        sa.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(sa.lib_de_aviso())
        self.sem_gravar()

    def test_copia_quebrada_cai_na_seguinte(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
        sa.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(sa.lib_de_aviso().__file__).resolve(), LIB_DO_REPO)

    def test_sem_a_lib_o_valor_em_reais_nao_chega_a_fila(self):
        # Sem a lib não há a regra do R$ (RULES 24): nada é gravado, nem o valor.
        sa.PASTAS_DA_LIB = [self.raiz / "sem-lib"]
        sa.FILA.mkdir()
        self.enviar(aviso_de("custa R$ 5"))
        self.assertEqual(self.fila(), [])


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




# Fase 3: regra pura do 05, preservando o teste do aviso acima.
"""Regras puras do 05: só fixtures e JavaScript local, sem importar n8n nem publicar fluxos."""
import ast
import json
from pathlib import Path
import subprocess
import types
import unittest

tree = ast.parse(Path(__file__).with_name('site-acompanhamento.py').read_text(encoding='utf-8'))
ctx = {'FOLLOWUP_DIAS': 3, 'EXPIRA_DIAS': 7,
       'sv': types.SimpleNamespace(PASTA_DO_LEAD_JS="const naRaiz = id => id !== 'fora';"),
       'DIAS_JS': 'const DIA=86400000;const diaSP=ms=>Math.floor((ms-10800000)/DIA);', 'CORTE': '2026-09-29T00:00:00-03:00'}
expr = next(n.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'DECIDIR' for t in n.targets))
JS = eval(compile(ast.Expression(expr), '<DECIDIR puro>', 'eval'), ctx)


def rodar(leads, registros=None):
    dados = {'leads': leads, 'registros': registros or []}
    code = """const d=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const $=n=>({all:()=> (n==='Ler a planilha'?d.leads:d.registros).map(json=>({json}))});
const BaseDate=globalThis.Date;const Date=class extends BaseDate{constructor(...a){super(...(a.length?a:['2026-10-19T15:00:00Z']))}static now(){return BaseDate.parse('2026-10-19T15:00:00Z')}};
console.log(JSON.stringify(new Function('$','Date',CODE)($,Date).map(x=>x.json)));
""".replace('CODE', json.dumps(JS))
    result = subprocess.run(['node', '-e', code], input=json.dumps(dados), text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


class RelogioDoAcompanhamento(unittest.TestCase):
    def test_sete_dias_e_followup_permanece_dono_central(self):
        leads = [{'place_id': 'expira', 'status': 'enviado', 'enviado_em': '2026-10-12T12:00:00-03:00'},
                 {'place_id': 'espera', 'status': 'enviado', 'enviado_em': '2026-10-13T12:00:00-03:00', 'followup_em': 'marcado'},
                 {'place_id': 'toque', 'status': 'enviado', 'enviado_em': '2026-10-16T12:00:00-03:00', 'visto_em': ''},
                 {'place_id': 'sexto', 'status': 'enviado', 'enviado_em': '2026-10-13T12:00:00-03:00'},
                 {'place_id': 'segundo', 'status': 'enviado', 'enviado_em': '2026-10-17T12:00:00-03:00'}]
        self.assertEqual([(r['place_id'], r['acao']) for r in rodar(leads)], [('expira', 'expirar')])

    def test_proposta_compromisso_resposta_e_pasta_protegida_nao_expiram(self):
        ids = ['proposta', 'combinado', 'humano', 'fora', 'pausa']
        leads = [{'place_id': id_, 'status': 'enviado', 'enviado_em': '2026-10-01T12:00:00-03:00'} for id_ in ids]
        leads[2]['resposta_tipo'] = 'neutra'
        registros = [{'produto': 'site', 'id': 'proposta', 'tipo': 'proposta', 'em': '2026-10-02T12:00:00Z'},
                     {'produto': 'site', 'id': 'combinado', 'tipo': 'proximo_passo', 'texto': 'retomar em novembro'},
                     {'produto': 'site', 'id': 'pausa', 'tipo': 'nota', 'texto': '[aprendizado-v1] {"pausarAteResposta":true}'}]
        self.assertEqual(rodar(leads, registros), [])

    def test_falha_na_fonte_crm_interrompe_expiracao(self):
        with self.assertRaises(subprocess.CalledProcessError): rodar([], [{'error': 'indisponível'}])

    def test_publicacao_padrao_nao_altera_o_06(self):
        calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'publicar']
        self.assertEqual([n.args[0].func.id for n in calls if isinstance(n.args[0], ast.Call)], ['acompanhamento'])



if __name__ == "__main__":
    unittest.main(verbosity=2)
