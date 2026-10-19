#!/usr/bin/env python3
"""Testes do site-demos-limpeza: as regras puras `escolher` e `escolher_exclusao` e o `main`
com dublês no lugar da Central, do disco e da Vercel (nada aqui toca ~/auto-site nem a rede).

Desde 11/10/2026 também a troca do avisar() pela lib de aviso: o aviso gravado
pela lib é IDÊNTICO, byte a byte, ao do jeito antigo, o dell-status o aceita, sem
a lib o script volta ao antigo, e a fila ausente não derruba a rodada.

  python3 deploy/dell/site-demos-limpeza.test.py

O HOME vira um temporário ANTES do import e cada teste que grava aponta AUTO,
ESTADO e FILA_AVISOS para a própria raiz `limpeza-teste-*`.
"""
import atexit
import contextlib
import importlib.util
import io
import json
from datetime import datetime
import os
import shutil
import tempfile
import unittest
from pathlib import Path

_HOME = tempfile.mkdtemp(prefix="limpeza-teste-home-")
os.environ["HOME"] = os.environ["USERPROFILE"] = _HOME
os.environ.pop("SQUADONE_AVISOS_FILA", None)


def _apagar_se_meu(p: str) -> None:
    if Path(p).name.startswith("limpeza-teste-") and Path(p).parent == Path(tempfile.gettempdir()):
        shutil.rmtree(p, ignore_errors=True)


atexit.register(_apagar_se_meu, _HOME)

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("limpeza", AQUI / "site-demos-limpeza.py")
limpeza = importlib.util.module_from_spec(spec)
spec.loader.exec_module(limpeza)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_limpeza", AQUI / "dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — sem fcntl (Windows)
    ds = None


def perdido(**kw):
    """Um lead como o GET /api/operations/crm devolve (só os campos que o script lê)."""
    base = {"produto": "site", "chave": "ChIJfulano", "empresa": "Fulano", "etapa": "perdido", "motivoPerda": "expirou",
            "desde": "2026-10-01T15:00:00.000Z", "diasNaEtapa": 3, "pasta": {"lugar": "raiz", "slug": "fulano"},
            "conversa": {"mensagens": 1, "ultimaSaida": "2026-10-01T12:00:00Z"}}
    base.update(kw)
    return base


DEMOS = {"fulano": "demo-fulano", "_recusados/fulano": "demo-fulano", "_concluidos/fulano": "demo-fulano",
         "_em-conversa/fulano": "demo-fulano", "_descartados/fulano": "demo-fulano", "_fechados/fulano": "demo-fulano"}


def entra(projetos=DEMOS, **kw):
    eleitos, guardados = limpeza.escolher([perdido(**kw)], projetos.get)
    return bool(eleitos), (guardados[0][1] if guardados else "")


class Escolher(unittest.TestCase):
    def test_perdido_com_demo_no_ar_entra_com_a_pasta_certa(self):
        eleitos, _ = limpeza.escolher([perdido()], DEMOS.get)
        self.assertEqual([(e["projeto"], e["pasta"], e["motivo"]) for e in eleitos], [("demo-fulano", "fulano", "expirou")])

    def test_todo_motivo_de_perda_entra(self):
        for motivo in ("recusou", "expirou", "esfriou", "sem-contato", "descartado"):
            self.assertEqual(entra(motivoPerda=motivo)[0], motivo != "recusou", motivo)

    def test_so_perdido_do_site(self):
        for kw in ({"etapa": "contato"}, {"etapa": "proposta"}, {"etapa": "ganho"}, {"produto": "prumo"}):
            ok, motivo = entra(**kw)
            self.assertFalse(ok, kw)
            self.assertEqual(motivo, "", "o que não está perdido nem aparece entre os guardados")

    def test_folga_de_dois_dias_em_perdido(self):
        ok, motivo = entra(diasNaEtapa=1)
        self.assertFalse(ok)
        self.assertIn("entra em 1", motivo)
        self.assertTrue(entra(diasNaEtapa=2)[0])
        self.assertTrue(entra(diasNaEtapa=None)[0], "sem data (acervo recusado à mão) é antigo")

    def test_lugares_de_quem_perdeu_entram_e_fechados_nunca(self):
        for lugar in ("raiz", "_recusados/", "_concluidos/", "_em-conversa/", "_descartados/"):
            self.assertTrue(entra(pasta={"lugar": lugar, "slug": "fulano"})[0], lugar)
        ok, motivo = entra(pasta={"lugar": "_fechados/", "slug": "fulano"})
        self.assertFalse(ok)
        self.assertIn("_fechados/", motivo)

    def test_sem_pasta_sem_demo_ou_ja_apagado_nao_entra_nem_aparece(self):
        for kw in ({"pasta": None}, {"pasta": {"lugar": "raiz", "slug": "../fulano"}}, {"demoApagadoEm": "2026-10-07T10:00:00Z"}):
            self.assertEqual(entra(**kw), (False, ""), kw)
        self.assertEqual(entra(projetos={}), (False, ""), "nunca publicado (ou o publicado.json já tem apagado_em)")
        self.assertEqual(entra(projetos={"fulano": "squadone-app"}), (False, ""), "só projeto demo-*")

    def test_mais_antigo_em_perdido_primeiro_e_sem_data_antes_de_todos(self):
        leads = [perdido(empresa="Novo", desde="2026-10-05T12:00:00Z", pasta={"lugar": "raiz", "slug": "novo"}),
                 perdido(empresa="Velho", desde="2026-09-30T12:00:00Z", pasta={"lugar": "raiz", "slug": "velho"}),
                 perdido(empresa="Acervo", desde=None, diasNaEtapa=None, pasta={"lugar": "_recusados/", "slug": "acervo"})]
        eleitos, _ = limpeza.escolher(leads, lambda p: "demo-" + p.rsplit("/", 1)[-1])
        self.assertEqual([e["nome"] for e in eleitos], ["Acervo", "Velho", "Novo"])


class ProtecaoComercial(unittest.TestCase):
    def test_preserva_conversa_proposta_proximo_passo_pausa_e_classificacao_duvidosa(self):
        casos = [
            {"conversa": None},
            {"conversa": {"ultimaEntrada": "2026-10-15T20:11:00Z"}},
            {"marcos": {"respondeu": "2026-10-15T20:11:00Z"}},
            {"proposta": {"em": "2026-10-15T20:11:00Z"}},
            {"proximoPasso": {"texto": "Aguardar a comparação", "data": "2026-10-19"}},
            {"resposta": {"tipo": "negativa", "trecho": "Não clico em link nenhum"}},
            {"revisaoComercial": "A conversa continuou depois da classificação"},
            {"eventos": [{"tipo": "nota", "origem": "manual", "em": "2026-10-18T03:00:00Z", "texto": '[aprendizado-v1] {"pausarAteResposta":true}'}]},
        ]
        for caso in casos:
            with self.subTest(caso=caso): self.assertFalse(entra(**caso)[0])

    def test_encerramento_manual_so_libera_se_posterior_ao_contexto(self):
        conversa = {"ultimaEntrada": "2026-10-15T20:11:00Z"}
        encerramento = {"tipo": "recusou", "origem": "manual", "em": "2026-10-16T12:00:00Z"}
        self.assertTrue(entra(conversa=conversa, eventos=[encerramento])[0])
        self.assertFalse(entra(conversa={"ultimaEntrada": "2026-10-17T12:00:00Z"}, eventos=[encerramento])[0])
        self.assertFalse(entra(conversa=conversa, eventos=[encerramento, {"tipo": "recusou_desfeito", "origem": "manual", "em": "2026-10-17T12:00:00Z"}])[0])
        self.assertFalse(entra(conversa=conversa, eventos=[encerramento], proposta={"em": "2026-10-17T12:00:00Z"})[0])


class FolgaAposRevisao(unittest.TestCase):
    def test_encerramento_resolve_compromisso_antigo_e_reinicia_folga(self):
        l = perdido(motivoPerda='recusou', diasNaEtapa=30,
            proximoPasso={'texto': 'Aguardar comparação', 'registradoEm': '2026-10-17T12:00:00Z'},
            eventos=[{'tipo': 'recusou', 'origem': 'manual', 'em': '2026-10-18T12:00:00Z'}])
        self.assertEqual(limpeza.motivo_protecao(l), '')
        self.assertEqual(limpeza.escolher([l], DEMOS.get, agora=datetime.fromisoformat('2026-10-18T13:00:00+00:00'))[0], [])
        self.assertEqual(len(limpeza.escolher([l], DEMOS.get, agora=datetime.fromisoformat('2026-10-20T13:00:00+00:00'))[0]), 1)
        l['proximoPasso']['registradoEm'] = '2026-10-18T12:01:00Z'
        self.assertTrue(limpeza.motivo_protecao(l))


class ComandoApagar(unittest.TestCase):
    """main(['--apagar', ...]) com a Central, o disco e a Vercel dublados."""

    def setUp(self):
        self.originais = {n: getattr(limpeza, n) for n in ("ler_crm", "projeto_da_pasta", "apagar", "MAX_POR_RODADA")}
        self.apagou = []
        self.leads = [perdido(empresa=f"L{i}", desde=f"2026-09-{10 + i:02d}T12:00:00Z", pasta={"lugar": "raiz", "slug": f"l{i}"})
                      for i in range(5)]
        limpeza.ler_crm = lambda: self.leads
        limpeza.projeto_da_pasta = lambda pasta: f"demo-{pasta}"
        limpeza.apagar = lambda alvos, a_pedido=False: self.apagou.append([a["projeto"] for a in alvos]) or 0

    def tearDown(self):
        for n, f in self.originais.items():
            setattr(limpeza, n, f)

    def test_apaga_todos_os_que_entram(self):
        self.assertEqual(limpeza.main(["--apagar"]), 0)
        self.assertEqual(self.apagou, [[f"demo-l{i}" for i in range(5)]])

    def test_teto_por_rodada_leva_os_mais_antigos(self):
        limpeza.MAX_POR_RODADA = 2
        limpeza.main(["--apagar"])
        self.assertEqual(self.apagou, [["demo-l0", "demo-l1"]])

    def test_so_os_nomeados_e_nada_se_um_nao_entra(self):
        limpeza.main(["--apagar", "demo-l3"])
        self.assertEqual(self.apagou, [["demo-l3"]])
        self.assertEqual(limpeza.main(["--apagar", "demo-l3", "demo-outro"]), 2)
        self.assertEqual(len(self.apagou), 1)

    def test_simular_e_listar_nao_apagam(self):
        limpeza.main(["--simular"])
        self.assertEqual(limpeza.main(["--simular", "--apagar"]), 2)
        self.assertEqual(limpeza.main(["demo-l1"]), 2)
        self.assertEqual(self.apagou, [])

    def test_central_fora_do_ar_nao_apaga(self):
        def fora():
            raise RuntimeError("não consegui ler o CRM da Central")
        limpeza.ler_crm = fora
        with self.assertRaises(RuntimeError):
            limpeza.main(["--apagar"])
        self.assertEqual(self.apagou, [])


def lead(**kw):
    """Uma linha do retrato da planilha (site-leads.json): é o que o --exclusao lê."""
    base = {"nome": "Fulano", "status": "enviado", "pasta": "fulano", "vercel_project": "demo-fulano",
            "enviado_em": "2026-09-25T16:15:53.000Z", "respondeu_em": "", "fechado_em": "", "recusado_em": ""}
    base.update(kw)
    return base


def pedido(**kw):
    return lead(**{"status": "recusado", "pasta": "_recusados/fulano", "recusado_em": "2026-10-07T10:00:00Z",
                   "respondeu_em": "2026-10-07T10:00:00Z", "resposta_tipo": "exclusao", **kw})


class EscolherExclusao(unittest.TestCase):
    def test_quem_pediu_entra_pelo_nome(self):
        eleitos, recusas = limpeza.escolher_exclusao([pedido(), lead(nome="Outro", vercel_project="demo-outro")], ["demo-fulano"])
        self.assertEqual(recusas, [])
        self.assertEqual([(e["projeto"], e["pasta"]) for e in eleitos], [("demo-fulano", "_recusados/fulano")])

    def test_pasta_na_raiz_tambem_entra(self):
        # O site-pastas ainda não moveu (ou o lead estava pronto): o pedido vale do mesmo jeito.
        eleitos, _ = limpeza.escolher_exclusao([pedido(pasta="fulano", status="recusado")], ["demo-fulano"])
        self.assertEqual(len(eleitos), 1)

    def test_sem_pedido_no_retrato_nao_apaga(self):
        for tipo in ("negativa", "", "interesse"):
            eleitos, recusas = limpeza.escolher_exclusao([pedido(resposta_tipo=tipo)], ["demo-fulano"])
            self.assertEqual(eleitos, [], tipo)
            self.assertIn("não pediu exclusão", recusas[0])

    def test_fechado_nunca(self):
        for kw in ({"status": "fechado"}, {"pasta": "_fechados/fulano"}):
            eleitos, recusas = limpeza.escolher_exclusao([pedido(**kw)], ["demo-fulano"])
            self.assertEqual(eleitos, [])
            self.assertIn("fechado", recusas[0])

    def test_projeto_desconhecido_repetido_ou_nao_demo(self):
        self.assertIn("nenhum lead", limpeza.escolher_exclusao([pedido()], ["demo-outro"])[1][0])
        self.assertIn("mais de um lead", limpeza.escolher_exclusao([pedido(), pedido(nome="Gêmeo")], ["demo-fulano"])[1][0])
        self.assertIn("nenhum lead", limpeza.escolher_exclusao([pedido(vercel_project="squadone-app")], ["squadone-app"])[1][0])

    def test_pasta_estranha(self):
        self.assertEqual(limpeza.escolher_exclusao([pedido(pasta="a/b/fulano")], ["demo-fulano"])[0], [])
        self.assertEqual(limpeza.escolher_exclusao([pedido(pasta="../fulano")], ["demo-fulano"])[0], [])


class ComandoExclusao(unittest.TestCase):
    """main(['--exclusao', ...]) sem disco, Vercel nem aviso: o retrato e o apagar são dublês."""

    def setUp(self):
        from datetime import datetime, timezone
        self.originais = {n: getattr(limpeza, n) for n in ("ler_retrato_com_hora", "ja_apagado", "apagar")}
        self.apagou = []
        self.leads = [pedido(), lead(nome="Outro", vercel_project="demo-outro", pasta="outro")]
        limpeza.ler_retrato_com_hora = lambda: (self.leads, datetime(2026, 10, 7, 15, 20, tzinfo=timezone.utc))
        limpeza.ja_apagado = lambda pasta: pasta == "outro"
        limpeza.apagar = lambda alvos, a_pedido=False: self.apagou.append((alvos, a_pedido)) or 0

    def tearDown(self):
        for n, f in self.originais.items():
            setattr(limpeza, n, f)

    def test_apaga_so_o_pedido_e_marca_a_pedido(self):
        self.assertEqual(limpeza.main(["--exclusao", "demo-fulano"]), 0)
        self.assertEqual([([a["projeto"] for a in alvos], ap) for alvos, ap in self.apagou], [(["demo-fulano"], True)])

    def test_um_nome_que_nao_entra_e_nada_e_apagado(self):
        self.assertEqual(limpeza.main(["--exclusao", "demo-fulano", "demo-outro"]), 2)  # demo-outro já foi apagado
        self.assertEqual(self.apagou, [])

    def test_sem_nomes_so_lista(self):
        self.assertEqual(limpeza.main(["--exclusao"]), 0)
        self.assertEqual(self.apagou, [])

    def test_nao_mistura_com_as_outras_opcoes(self):
        self.assertEqual(limpeza.main(["--exclusao", "--apagar"]), 2)
        self.assertEqual(limpeza.main(["--apagar", "--exclusao", "demo-fulano"]), 2)
        self.assertEqual(self.apagou, [])


class BaseDoAviso(unittest.TestCase):
    """Raiz temporária própria: AUTO, ESTADO (e o histórico), FILA_AVISOS e a lib."""

    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="limpeza-teste-"))
        self.addCleanup(_apagar_se_meu, str(self.raiz))
        nomes = ("AUTO", "ESTADO", "HISTORICO", "FILA_AVISOS", "PASTAS_DA_LIB", "token", "projeto_na_vercel", "vercel",
                 "ler_crm", "projeto_da_pasta")
        antes = {k: getattr(limpeza, k) for k in nomes}
        self.addCleanup(lambda: [setattr(limpeza, k, v) for k, v in antes.items()])
        limpeza.AUTO = self.raiz / "auto-site"
        limpeza.ESTADO = self.raiz / "estado" / "avisados.json"
        limpeza.HISTORICO = limpeza.ESTADO.with_name("historico.jsonl")
        limpeza.FILA_AVISOS = self.raiz / "fila"
        limpeza.AUTO.mkdir()
        self.lib_do_repo = list(antes["PASTAS_DA_LIB"])

    def fila(self):
        return sorted(limpeza.FILA_AVISOS.glob("*.json")) if limpeza.FILA_AVISOS.is_dir() else []

    def avisos(self):
        return [json.loads(p.read_text(encoding="utf-8")) for p in self.fila()]

    def sem_lib(self):
        limpeza.PASTAS_DA_LIB = [self.raiz / "sem-lib"]

    def quieto(self, f, *a, **k):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return f(*a, **k)

    def avisar(self, texto):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            limpeza.avisar(texto)
        return err.getvalue()

    def gravado_pelo(self, jeito: str, texto: str) -> bytes:
        """O aviso gravado com a lib ('lib') ou sem ela ('antigo'), numa fila limpa."""
        shutil.rmtree(limpeza.FILA_AVISOS, ignore_errors=True)
        limpeza.FILA_AVISOS.mkdir()
        limpeza.PASTAS_DA_LIB = self.lib_do_repo if jeito == "lib" else [self.raiz / "sem-lib"]
        self.avisar(texto)
        self.assertEqual(len(self.fila()), 1, self.fila())
        return self.fila()[0].read_bytes()


TEXTOS = [
    "Apaguei 2 demo(s) na Vercel de leads em Perdido no CRM (há 2+ dias). A pasta continua em ~/auto-site: para mandar de novo, é republicar.\n"
    "• Padaria Açaí & Cia (recusou)\n• \"Bar do Zé\" (sem resposta em 7 dias)",
    "aspas \"duplas\", barra \\ e acento: ação, coração",
    "duas\nlinhas e emoji 🧹",
    "dois  espaços  e  nada de moeda",
]


class AvisoPelaLib(BaseDoAviso):
    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(limpeza.lib_de_aviso().__file__).resolve(), (AQUI / "lib/aviso.py").resolve())

    def test_aviso_identico_ao_jeito_antigo(self):
        for texto in TEXTOS:
            with self.subTest(texto=texto):
                self.assertEqual(self.gravado_pelo("lib", texto), self.gravado_pelo("antigo", texto))

    def test_conteudo_fixado(self):
        esperado = ('{"titulo": "🧹 Site antes da venda: demos de leads perdidos", "texto": "uma\\nduas", '
                    '"origem": "site-demos-limpeza"}')
        self.assertEqual(self.gravado_pelo("lib", "uma\nduas"), esperado.encode("utf-8"))

    def test_nome_e_atomicidade(self):
        limpeza.FILA_AVISOS.mkdir()
        self.avisar("x")
        self.assertRegex(self.fila()[0].name, r"^site-demos-limpeza-\d+-[0-9a-f]{6}\.json$")
        self.assertEqual([p for p in limpeza.FILA_AVISOS.iterdir() if not p.name.endswith(".json")], [])

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        limpeza.FILA_AVISOS.mkdir()
        for texto in TEXTOS:
            self.avisar(texto)
        self.assertEqual(len(self.fila()), len(TEXTOS))
        for aviso in self.avisos():
            ds.validar_aviso(aviso)

    def test_avisar_devolve_se_ficou_na_fila(self):
        self.assertFalse(limpeza.avisar("x"))  # fila ausente: não grava, não cria, não levanta
        self.assertFalse(limpeza.FILA_AVISOS.exists())
        limpeza.FILA_AVISOS.mkdir()
        self.assertTrue(limpeza.avisar("x"))

    def test_com_a_lib_a_fila_ausente_nao_e_criada_e_nao_levanta(self):
        err = self.avisar("x")
        self.assertFalse(limpeza.FILA_AVISOS.exists())
        self.assertIn("fila_ausente", err)

    def test_valor_em_reais_no_nome_nao_perde_o_aviso(self):
        limpeza.FILA_AVISOS.mkdir()
        self.avisar("Apaguei 1 demo(s).\n• Loja R$ 9,99 Todo Dia (recusou)")
        texto = self.avisos()[0]["texto"]
        self.assertNotRegex(texto, r"R\s*\$")
        self.assertIn("Loja [valor] Todo Dia (recusou)", texto)
        self.assertIn("Apaguei 1 demo(s).", texto)

    def test_texto_sem_valor_nao_e_mexido(self):
        limpeza.FILA_AVISOS.mkdir()
        self.avisar("  dois  espaços  ")
        self.assertEqual(self.avisos()[0]["texto"], "  dois  espaços  ")


class SemLib(BaseDoAviso):
    def test_sem_copia_volta_ao_jeito_antigo(self):
        self.sem_lib()
        self.assertIsNone(limpeza.lib_de_aviso())
        self.assertTrue(limpeza.avisar("x"))  # o antigo cria a pasta da fila
        self.assertEqual(len(self.fila()), 1)
        self.assertRegex(self.fila()[0].name, r"^site-demos-limpeza-\d+\.json$")

    def test_copia_quebrada_volta_ao_jeito_antigo(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("def x(:\n", encoding="utf-8")
        limpeza.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(limpeza.lib_de_aviso())
        limpeza.FILA_AVISOS.mkdir()
        limpeza.avisar("x")
        self.assertEqual(len(self.fila()), 1)

    def test_copia_quebrada_cai_na_seguinte(self):
        quebrada = self.raiz / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
        limpeza.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(limpeza.lib_de_aviso().__file__).resolve(), (AQUI / "lib/aviso.py").resolve())

    def test_sem_a_lib_o_texto_com_valor_vai_como_sempre(self):
        self.sem_lib()
        limpeza.avisar("custa R$ 5")
        self.assertEqual(self.avisos()[0]["texto"], "custa R$ 5")


def texto_antigo(apagados, falhas, a_pedido=False):
    """O texto do aviso como o `apagar` montava antes da lib (cópia do código de 07/10/2026)."""
    linhas = []
    if apagados and a_pedido:
        linhas += [f"Apaguei {len(apagados)} demo(s) na Vercel a pedido do lead (pediu exclusão no WhatsApp). "
                   "A pasta continua em ~/auto-site; se o pedido for de apagar tudo, apague a pasta à mão."]
        linhas += [f"• {e['nome']}" for e in apagados[:limpeza.MAX_NOMES]]
    elif apagados:
        linhas += [f"Apaguei {len(apagados)} demo(s) na Vercel de leads em Perdido no CRM (há {limpeza.FOLGA_DIAS}+ dias). "
                   "A pasta continua em ~/auto-site: para mandar de novo, é republicar."]
        linhas += [f"• {e['nome']} ({limpeza.ROTULO_DA_PERDA.get(e.get('motivo', ''), 'perdido')})"
                   for e in apagados[:limpeza.MAX_NOMES]]
        if len(apagados) > limpeza.MAX_NOMES:
            linhas.append(f"• e mais {len(apagados) - limpeza.MAX_NOMES} (lista em {limpeza.HISTORICO})")
    if falhas:
        linhas += ([""] if linhas else []) + [f"Não consegui ({len(falhas)}):"] + [f"• {f}" for f in falhas]
    return "\n".join(linhas)


def demos(n, prefixo="Demo"):
    return [{"nome": f"{prefixo} {i} da Silva Comércio de Alimentos", "projeto": f"demo-{i}", "pasta": f"d{i}",
             "motivo": ("recusou", "expirou", "esfriou")[i % 3], "desde": ""} for i in range(n)]


class TextoDoAviso(BaseDoAviso):
    def test_dentro_dos_tetos_e_igual_ao_de_antes(self):
        casos = [(demos(1), [], False), (demos(3), [], True), (demos(25), [], False), (demos(26), [], False),
                 (demos(2), ["Fulano: GET /v9/projects/demo-x -> 500: boom"], False), ([], ["Z: o publicado.json não confirma"], False),
                 (demos(2), ["a: x", "b: y"], True)]
        for apagados, falhas, a_pedido in casos:
            with self.subTest(apagados=len(apagados), falhas=len(falhas), a_pedido=a_pedido):
                self.assertEqual(limpeza.texto_do_aviso(apagados, falhas, a_pedido), texto_antigo(apagados, falhas, a_pedido))

    def test_acervo_inteiro_com_muitas_falhas_cabe_e_nao_perde_o_que_importa(self):
        # Em 10/10/2026 o acervo inteiro (73) saiu de uma vez; se a Vercel falhar em todos, o
        # texto de antes passava de 4000 e o dell-status recusava o aviso (ou a lib o cortava
        # no meio da lista de falhas).
        apagados = demos(73)
        falhas = [f"{e['nome']}: DELETE /v9/projects -> 500: " + "erro interno do servidor " * 8 for e in demos(40, "Falho")]
        texto = limpeza.texto_do_aviso(apagados, falhas)
        self.assertGreater(len(texto_antigo(apagados, falhas)), 4000)
        self.assertLessEqual(len(texto), 4000)
        for trecho in ("Apaguei 73 demo(s)", "• e mais 48 (lista em", "Não consegui (40):", "• e mais 30 (todas no journal"):
            self.assertIn(trecho, texto)
        self.assertEqual(texto.count("• Falho "), 10)
        limpeza.FILA_AVISOS.mkdir()
        self.avisar(texto)
        gravado = self.avisos()[0]["texto"]
        self.assertEqual(gravado, texto)  # nada foi cortado pela lib
        self.assertNotIn("(cortado)", gravado)

    def test_nomes_e_falhas_no_maximo_encolhem_ate_caber(self):
        # 25 nomes de 100 caracteres com o motivo mais longo + 10 falhas de 200: só os tetos fixos passariam de 4000.
        apagados = [{"nome": f"{i:02d} " + "N" * 97, "projeto": f"demo-{i}", "pasta": f"d{i}", "motivo": "expirou", "desde": ""}
                    for i in range(73)]
        falhas = [f"{i:02d} " + "F" * 400 for i in range(40)]
        texto = limpeza.texto_do_aviso(apagados, falhas)
        self.assertLessEqual(len(texto), 3900)
        for trecho in ("Apaguei 73 demo(s)", "Não consegui (40):"):
            self.assertIn(trecho, texto)
        self.assertIn("• 00 NNN", texto)
        self.assertIn("• 00 FFF", texto)
        self.assertRegex(texto, r"• e mais \d+ \(lista em ")
        self.assertRegex(texto, r"• e mais \d+ \(todas no journal")

    def test_linha_de_falha_muito_longa_e_encurtada_com_reticencias(self):
        texto = limpeza.texto_do_aviso([], ["Fulano: " + "x" * 1000])
        linha = texto.splitlines()[1]
        self.assertEqual(len(linha), len("• ") + limpeza.MAX_LINHA_FALHA)
        self.assertTrue(linha.endswith("…"))

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita_o_aviso_do_acervo_inteiro(self):
        limpeza.FILA_AVISOS.mkdir()
        self.avisar(limpeza.texto_do_aviso(demos(73), [f"F{i}: " + "y" * 600 for i in range(40)]))
        ds.validar_aviso(self.avisos()[0])


class ApagarGravaOAviso(BaseDoAviso):
    """`apagar` de ponta a ponta com a Vercel dublada: o que muda no disco e o aviso."""

    def setUp(self):
        super().setUp()
        self.vercel_chamadas = []
        self.leads = []
        limpeza.ler_crm = lambda: self.leads
        limpeza.token = lambda: "token-de-teste"
        limpeza.projeto_na_vercel = lambda nome, chave: {"id": "prj_" + nome}
        limpeza.vercel = lambda metodo, caminho, chave: self.vercel_chamadas.append((metodo, caminho)) or {}

    def alvo(self, slug, nome=None, com_recibo=True):
        if com_recibo:
            (limpeza.AUTO / slug).mkdir()
            (limpeza.AUTO / slug / "publicado.json").write_text(
                json.dumps({"vercel_project": f"demo-{slug}", "place_id": slug}), encoding="utf-8")
        self.leads.append(perdido(empresa=nome or slug.title(), pasta={"lugar": "raiz", "slug": slug}))
        return {"nome": nome or slug.title(), "projeto": f"demo-{slug}", "pasta": slug, "motivo": "expirou", "desde": ""}

    def test_resposta_entre_selecao_e_exclusao_preserva_demo(self):
        limpeza.FILA_AVISOS.mkdir()
        alvo = self.alvo("fulano")
        self.leads[0]["conversa"] = {"ultimaEntrada": "2026-10-17T12:00:00Z"}
        self.assertEqual(self.quieto(limpeza.apagar, [alvo]), 1)
        self.assertEqual(self.vercel_chamadas, [])
        self.assertNotIn("apagado_em", limpeza.ler_json(limpeza.AUTO / "fulano/publicado.json"))

    def test_crm_indisponivel_na_revalidacao_preserva_demo(self):
        limpeza.FILA_AVISOS.mkdir()
        alvo = self.alvo("fulano")
        def falha(): raise RuntimeError("CRM indisponível")
        limpeza.ler_crm = falha
        self.assertEqual(self.quieto(limpeza.apagar, [alvo]), 1)
        self.assertEqual(self.vercel_chamadas, [])

    def test_apaga_marca_a_pasta_e_avisa(self):
        limpeza.FILA_AVISOS.mkdir()
        self.assertEqual(self.quieto(limpeza.apagar, [self.alvo("fulano", "Fulano & Cia")]), 0)
        self.assertEqual(self.vercel_chamadas, [("DELETE", "/v9/projects/prj_demo-fulano")])
        self.assertIn("apagado_em", json.loads((limpeza.AUTO / "fulano/publicado.json").read_text(encoding="utf-8")))
        avisos = self.avisos()
        self.assertEqual(len(avisos), 1)
        self.assertEqual((avisos[0]["titulo"], avisos[0]["origem"]),
                         ("🧹 Site antes da venda: demos de leads perdidos", "site-demos-limpeza"))
        self.assertIn("Apaguei 1 demo(s)", avisos[0]["texto"])
        self.assertIn("• Fulano & Cia (sem resposta em 7 dias)", avisos[0]["texto"])

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        limpeza.FILA_AVISOS.mkdir()
        self.quieto(limpeza.apagar, [self.alvo("fulano")], True)
        ds.validar_aviso(self.avisos()[0])

    def test_falha_de_um_nao_impede_o_outro_e_entra_no_aviso(self):
        limpeza.FILA_AVISOS.mkdir()
        bom, ruim = self.alvo("bom"), self.alvo("ruim", com_recibo=False)
        self.assertEqual(self.quieto(limpeza.apagar, [ruim, bom]), 1)
        texto = self.avisos()[0]["texto"]
        self.assertIn("Apaguei 1 demo(s)", texto)
        self.assertIn("Não consegui (1):", texto)
        self.assertIn("Ruim: o publicado.json da pasta não confirma o projeto demo-ruim", texto)

    def test_fila_ausente_nao_desfaz_nem_derruba_o_que_ja_foi_apagado(self):
        # O jeito antigo criava a pasta da fila (do dell-status, 2770) e um OSError ali
        # levantava depois de a Vercel já ter apagado. Com a lib: nada levanta, a pasta
        # não é criada e o recibo já está marcado.
        self.assertEqual(self.quieto(limpeza.apagar, [self.alvo("fulano")]), 0)
        self.assertIn("apagado_em", json.loads((limpeza.AUTO / "fulano/publicado.json").read_text(encoding="utf-8")))
        self.assertFalse(limpeza.FILA_AVISOS.exists())

    def test_sem_a_lib_o_aviso_sai_como_antes(self):
        self.sem_lib()
        self.assertEqual(self.quieto(limpeza.apagar, [self.alvo("fulano")]), 0)
        self.assertEqual(len(self.fila()), 1)
        self.assertRegex(self.fila()[0].name, r"^site-demos-limpeza-\d+\.json$")


class AvisoDosQueEntram(BaseDoAviso):
    """`main([])`: um aviso do que vai sair, e só marca como avisado o que ficou na fila."""

    def setUp(self):
        super().setUp()
        self.leads = [perdido(empresa=f"L{i}", desde=f"2026-09-{10 + i:02d}T12:00:00Z", pasta={"lugar": "raiz", "slug": f"l{i}"})
                      for i in range(3)]
        limpeza.ler_crm = lambda: self.leads
        limpeza.projeto_da_pasta = lambda pasta: f"demo-{pasta}"

    def rodar(self):
        return self.quieto(limpeza.main, [])

    def test_avisa_uma_vez_e_grava_o_estado(self):
        limpeza.FILA_AVISOS.mkdir()
        self.assertEqual(self.rodar(), 0)
        self.assertEqual(len(self.avisos()), 1)
        self.assertIn("3 demo(s) de leads em Perdido no CRM ainda no ar", self.avisos()[0]["texto"])
        self.assertIn("• L0", self.avisos()[0]["texto"])
        self.assertEqual(json.loads(limpeza.ESTADO.read_text(encoding="utf-8")), {"projetos": ["demo-l0", "demo-l1", "demo-l2"]})
        self.rodar()
        self.assertEqual(len(self.avisos()), 1, "o mesmo conjunto não é avisado de novo")

    def test_fila_ausente_nao_marca_como_avisado(self):
        # Sem a lib, o aviso que não gravava levantava e o estado não era escrito:
        # a próxima rodada avisava. Com a lib (que não levanta) tem de ser igual.
        self.assertEqual(self.rodar(), 0)
        self.assertFalse(limpeza.ESTADO.exists())
        self.assertFalse(limpeza.FILA_AVISOS.exists())
        limpeza.FILA_AVISOS.mkdir()  # a fila volta: o próximo timer avisa
        self.rodar()
        self.assertEqual(len(self.avisos()), 1)
        self.assertTrue(limpeza.ESTADO.exists())

    def test_sem_a_lib_tudo_como_antes(self):
        self.sem_lib()
        self.assertEqual(self.rodar(), 0)
        self.assertEqual(len(self.fila()), 1)
        self.assertTrue(limpeza.ESTADO.exists())


if __name__ == "__main__":
    unittest.main()
