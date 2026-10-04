#!/usr/bin/env python3
"""Testes do executor determinístico. python3 executor.test.py

O executor é a barreira entre o que o MODELO propõe e o disco: aqui se tenta,
de todas as formas, fazê-lo sair da lista de permissão.
"""
import os
import shutil
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import entrada as e  # noqa: E402
import executor as x  # noqa: E402

GHP = "gh" + "p_" + "A1b2C3d4" * 5
AGE_FALSA = "AGE-SECRET" + "-KEY-1" + "Q" * 40


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="executor-teste-"))
        self.ent = e.Entrada(self.tmp / "Entrada", None, agora=lambda: datetime(2026, 10, 4, 19, 0, 0))
        self.arq = self.tmp / "Arquivo"
        self.arq.mkdir()
        self.ex = x.Executor(self.ent, self.arq, hoje=lambda: date(2026, 10, 4))
        self.fora = self.tmp / "fora"
        self.fora.mkdir()
        (self.fora / "intocado.txt").write_text("não mexa")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def item(self, nome="relatorio.txt", conteudo="conteúdo do relatório", i="e-20261004-190000-aaaa"):
        arquivo = f"{i}-{nome}"
        (self.ent.chegou / arquivo).write_text(conteudo)
        it = {"id": i, "arquivo": arquivo, "nome_original": nome, "estado": "pendente", "rotulo": None}
        self.ent.salvar_item(it)
        return it

    def plano(self, it, **kw):
        p = {"id": it["id"], "acao": "mover", "destino": "financeiro/2026", "nome": "relatorio.txt", "rotulo": "Relatório"}
        p.update(kw)
        return p

    def snapshot_fora(self):
        """Tudo que não é raiz permitida: tem que ficar idêntico."""
        out = {}
        for p in sorted(self.fora.rglob("*")):
            out[str(p.relative_to(self.fora))] = p.read_bytes() if p.is_file() else None
        return out


class Caminho_feliz(Base):
    def test_mover_para_organizado(self):
        it = self.item()
        r = self.ex.aplicar(self.plano(it), it)
        destino = self.ent.organizado / "financeiro/2026/relatorio.txt"
        self.assertEqual(destino.read_text(), "conteúdo do relatório")
        self.assertFalse((self.ent.chegou / it["arquivo"]).exists(), "mover tira de chegou/")
        self.assertEqual(r["para"], "organizado/financeiro/2026/relatorio.txt")
        salvo = self.ent.itens()[0]
        self.assertEqual((salvo["estado"], salvo["destino"]), ("organizado", r["para"]))
        self.assertEqual(self.ent.pendentes(), [])
        self.assertEqual(oct(destino.stat().st_mode & 0o777), "0o600")

    def test_arquivo_de_hoje(self):
        it = self.item()
        r = self.ex.aplicar(self.plano(it, destino="arquivo/contratos"), it)
        self.assertTrue((self.arq / "2026-10-04/contratos/relatorio.txt").is_file())
        self.assertEqual(r["para"], "Arquivo/2026-10-04/contratos/relatorio.txt")

    def test_destino_arquivo_sem_subpasta(self):
        it = self.item()
        self.ex.aplicar(self.plano(it, destino="arquivo"), it)
        self.assertTrue((self.arq / "2026-10-04/relatorio.txt").is_file())

    def test_resumir_escreve_o_resumo_ao_lado(self):
        it = self.item()
        r = self.ex.aplicar(self.plano(it, acao="resumir", resumo="Fala do contrato de outubro."), it)
        md = self.ent.organizado / "financeiro/2026" / r["resumo_em"]
        self.assertTrue(md.read_text().startswith("# Relatório"))
        self.assertIn("Fala do contrato de outubro.", md.read_text())
        self.assertTrue((self.ent.organizado / "financeiro/2026/relatorio.txt").is_file())

    def test_registrar_projeto_move_e_deixa_uma_proposta(self):
        it = self.item()
        r = self.ex.aplicar(self.plano(it, acao="registrar-projeto", resumo="Parece um projeto novo de landing page."), it)
        prop = self.ent.organizado / "_propostas" / r["proposta_em"]
        self.assertIn("landing page", prop.read_text())
        self.assertTrue((self.ent.organizado / "financeiro/2026/relatorio.txt").is_file())

    def test_campos_desconhecidos_sao_ignorados_nao_executados(self):
        it = self.item()
        self.ex.aplicar(self.plano(it, comando="rm -rf /", apagar=True, caminho="/etc"), it)
        self.assertTrue((self.ent.organizado / "financeiro/2026/relatorio.txt").is_file())


class Recusas(Base):
    def recusa(self, it, **kw):
        antes = self.snapshot_fora()
        with self.assertRaises(x.PlanoInvalido):
            self.ex.aplicar(self.plano(it, **kw), it)
        self.assertEqual(self.snapshot_fora(), antes)
        self.assertTrue((self.ent.chegou / it["arquivo"]).exists(), "plano recusado não mexe no item")
        self.assertEqual(self.ent.pendentes()[0]["id"], it["id"])

    def test_destinos_que_tentam_escapar(self):
        it = self.item()
        for destino in ["../fora", "../../etc", "a/../../fora", "/etc/cron.d", "/tmp", "~/x", "a//b", "a/", "a\\b",
                        "..", ".", "a/./b", ".oculto", "a/.oculto", "_propostas", "financeiro/_x",
                        "a/b/c/d/e", "x" * 80, "a\x00b", "a\nb", "$(id)", "a;b", "a b/../c"]:
            with self.subTest(destino=destino):
                self.recusa(it, destino=destino)

    def test_nomes_invalidos(self):
        it = self.item()
        for nome in ["../x", "a/b", "/etc/passwd", ".bashrc", "..", ".", "", "x" * 120, "a\x00b", "nome;rm", "a\nb"]:
            with self.subTest(nome=nome):
                self.recusa(it, nome=nome)

    def test_acoes_fora_da_lista(self):
        it = self.item()
        for acao in ["apagar", "delete", "rm", "executar", "copiar", "renomear", "", None, 7, ["mover"], "MOVER", "mover "]:
            with self.subTest(acao=acao):
                self.recusa(it, acao=acao)

    def test_plano_de_outro_item_ou_forma_errada(self):
        it = self.item()
        self.recusa(it, id="e-20261004-190000-ffff")
        for ruim in ([], "mover", None, 7, [self.plano(it)]):
            with self.assertRaises(x.PlanoInvalido):
                self.ex.aplicar(ruim, it)

    def test_campos_com_tipo_errado(self):
        it = self.item()
        for kw in ({"destino": 5}, {"destino": ["a"]}, {"nome": None}, {"nome": {"a": 1}}, {"rotulo": 3}, {"resumo": [1]}):
            with self.subTest(kw=kw):
                self.recusa(it, **kw)

    def test_resumir_exige_resumo(self):
        it = self.item()
        self.recusa(it, acao="resumir")

    def test_texto_do_plano_que_parece_segredo_e_recusado_sem_mexer_em_nada(self):
        it = self.item()
        for kw in ({"rotulo": f"chave {GHP}"}, {"nome": f"{GHP}.txt"}, {"destino": f"a/{GHP}"},
                   {"acao": "resumir", "resumo": f"o token é {GHP}"}, {"acao": "resumir", "resumo": AGE_FALSA},
                   {"acao": "resumir", "resumo": "senha: abc12345"}):
            with self.subTest(kw=list(kw)):
                self.recusa(it, **kw)
        self.assertFalse((self.ent.organizado / "financeiro").exists())

    def test_resumo_enorme(self):
        it = self.item()
        self.recusa(it, acao="resumir", resumo="palavra " * 400)


class Links_e_origem(Base):
    def test_pasta_de_destino_que_e_link_simbolico(self):
        os.symlink(self.fora, self.ent.organizado / "link")
        it = self.item()
        antes = self.snapshot_fora()
        with self.assertRaises(x.PlanoInvalido):
            self.ex.aplicar(self.plano(it, destino="link/sub"), it)
        self.assertEqual(self.snapshot_fora(), antes)
        self.assertTrue((self.ent.chegou / it["arquivo"]).exists())

    def test_link_simbolico_para_dentro_da_propria_raiz_tambem_e_recusado(self):
        # "sem links" vale mesmo quando o link não escapa da raiz
        (self.ent.organizado / "real").mkdir()
        os.symlink(self.ent.organizado / "real", self.ent.organizado / "atalho")
        it = self.item()
        with self.assertRaises(x.PlanoInvalido):
            self.ex.aplicar(self.plano(it, destino="atalho"), it)
        self.assertEqual(list((self.ent.organizado / "real").iterdir()), [])
        self.assertTrue((self.ent.chegou / it["arquivo"]).exists())

    def test_degrau_do_meio_que_e_link(self):
        (self.ent.organizado / "ok").mkdir()
        os.symlink(self.fora, self.ent.organizado / "ok" / "meio")
        it = self.item()
        with self.assertRaises(x.PlanoInvalido):
            self.ex.aplicar(self.plano(it, destino="ok/meio/fim"), it)
        self.assertEqual(self.snapshot_fora(), {"intocado.txt": b"n\xc3\xa3o mexa"})

    def test_pasta_de_hoje_em_arquivo_que_e_link(self):
        os.symlink(self.fora, self.arq / "2026-10-04")
        it = self.item()
        with self.assertRaises(x.PlanoInvalido):
            self.ex.aplicar(self.plano(it, destino="arquivo/x"), it)
        self.assertEqual(sorted(p.name for p in self.fora.iterdir()), ["intocado.txt"])

    def test_origem_que_e_link_simbolico_nao_e_seguida(self):
        alvo = self.fora / "segredo-do-sistema.txt"
        alvo.write_text("conteúdo de fora")
        i = "e-20261004-190000-bbbb"
        os.symlink(alvo, self.ent.chegou / f"{i}-x.txt")
        it = {"id": i, "arquivo": f"{i}-x.txt", "estado": "pendente"}
        self.ent.salvar_item(it)
        with self.assertRaises(x.PlanoInvalido):
            self.ex.aplicar(self.plano(it), it)
        self.assertEqual(alvo.read_text(), "conteúdo de fora")
        self.assertFalse((self.ent.organizado / "financeiro").exists())

    def test_item_com_nome_de_arquivo_malicioso(self):
        (self.fora / "alvo.txt").write_text("fora")
        for arq in ["../../fora/alvo.txt", "/etc/passwd", "../x", ".oculto", "a/b", None, 3, ""]:
            with self.subTest(arq=arq):
                it = {"id": "e-20261004-190000-cccc", "arquivo": arq, "estado": "pendente"}
                with self.assertRaises(x.PlanoInvalido):
                    self.ex.aplicar(self.plano(it), it)
        self.assertEqual((self.fora / "alvo.txt").read_text(), "fora")

    def test_arquivo_do_item_sumiu(self):
        it = self.item()
        os.unlink(self.ent.chegou / it["arquivo"])
        with self.assertRaises(x.PlanoInvalido):
            self.ex.aplicar(self.plano(it), it)


class Sem_sobrescrever(Base):
    def test_nome_repetido_ganha_sufixo_e_o_primeiro_fica_intacto(self):
        a = self.item(conteudo="primeiro", i="e-20261004-190000-0001")
        b = self.item(conteudo="segundo", i="e-20261004-190000-0002")
        ra = self.ex.aplicar(self.plano(a), a)
        rb = self.ex.aplicar(self.plano(b), b)
        pasta = self.ent.organizado / "financeiro/2026"
        self.assertEqual((pasta / "relatorio.txt").read_text(), "primeiro")
        self.assertEqual((pasta / "relatorio (2).txt").read_text(), "segundo")
        self.assertTrue(rb["para"].endswith("relatorio (2).txt"))
        self.assertNotEqual(ra["para"], rb["para"])

    def test_nao_sobrescreve_nem_o_que_o_rômulo_colocou_la(self):
        pasta = self.ent.organizado / "financeiro/2026"
        pasta.mkdir(parents=True)
        (pasta / "relatorio.txt").write_text("do Rômulo")
        it = self.item()
        self.ex.aplicar(self.plano(it), it)
        self.assertEqual((pasta / "relatorio.txt").read_text(), "do Rômulo")
        self.assertEqual((pasta / "relatorio (2).txt").read_text(), "conteúdo do relatório")

    def test_sem_extensao(self):
        pasta = self.ent.organizado / "a"
        pasta.mkdir()
        (pasta / "nota").write_text("x")
        it = self.item(nome="nota")
        self.ex.aplicar(self.plano(it, destino="a", nome="nota"), it)
        self.assertTrue((pasta / "nota (2)").is_file())

    def test_nenhuma_acao_apaga_o_que_ja_estava(self):
        pasta = self.ent.organizado / "financeiro/2026"
        pasta.mkdir(parents=True)
        for n in range(5):
            (pasta / f"velho{n}.txt").write_text(str(n))
        it = self.item()
        self.ex.aplicar(self.plano(it), it)
        self.assertEqual([p.name for p in sorted(pasta.glob("velho*"))], [f"velho{n}.txt" for n in range(5)])


class Diario_e_estado(Base):
    def test_diario_registra_sem_conteudo(self):
        it = self.item(conteudo=f"texto qualquer {AGE_FALSA}")           # chegou aqui só por acidente do teste
        self.ex.aplicar(self.plano(it), it)
        d = self.ent.arq_diario.read_text()
        self.assertIn('"evento": "organizado"', d)
        self.assertNotIn(AGE_FALSA, d)
        self.assertNotIn("texto qualquer", d)

    def test_so_a_pasta_organizado_e_arquivo_de_hoje_foram_tocadas(self):
        antes = {p for p in self.tmp.rglob("*")}
        it = self.item()
        self.ex.aplicar(self.plano(it), it)
        novos = {p for p in self.tmp.rglob("*")} - antes
        permitidos = (self.ent.organizado, self.ent.fila, self.ent.chegou, self.ent.arq_diario)
        for p in novos:
            self.assertTrue(any(p == r or r in p.parents for r in permitidos), f"fora da lista: {p}")


class Revisao_de_seguranca(Base):
    """O que a revisão adversarial de 04/10 conseguiu quebrar no executor, agora como teste."""

    def recusa(self, it, **kw):
        antes = self.snapshot_fora()
        with self.assertRaises(x.PlanoInvalido):
            self.ex.aplicar(self.plano(it, **kw), it)
        self.assertEqual(self.snapshot_fora(), antes)
        self.assertTrue((self.ent.chegou / it["arquivo"]).exists())
        self.assertEqual(self.ent.pendentes()[0]["id"], it["id"])

    def test_extensao_tem_que_ser_a_do_original(self):
        it = self.item(nome="contrato.pdf")
        for nome in ["contrato.sh", "contrato.exe", "contrato", "contrato.PDF.txt", "contrato.pdf.sh"]:
            with self.subTest(nome=nome):
                self.recusa(it, nome=nome)
        self.ex.aplicar(self.plano(it, nome="Contrato final.PDF"), it)          # maiúscula na extensão não muda o tipo
        self.assertTrue((self.ent.organizado / "financeiro/2026/Contrato final.PDF").exists())

    def test_original_sem_extensao_aceita_so_txt_ou_md(self):
        for nome, ok in [("nota", True), ("nota.txt", True), ("nota.md", True), ("nota.sh", False)]:
            it = self.item(nome="LICENSE", i=f"e-20261004-190000-{abs(hash(nome)) % 0xffff:04x}")
            if ok:
                self.ex.aplicar(self.plano(it, nome=nome), it)
            else:
                with self.assertRaises(x.PlanoInvalido):
                    self.ex.aplicar(self.plano(it, nome=nome), it)

    def test_nomes_reservados_do_windows_e_ponto_ou_espaco_no_fim(self):
        it = self.item(nome="a.txt")
        for nome in ["CON.txt", "nul.txt", "COM1.txt", "lpt9.txt", "aux.txt", "a.", "a ", "a..txt.", "PRN.txt"]:
            with self.subTest(nome=nome):
                self.recusa(it, nome=nome)
        for destino in ["con", "NUL", "aux", "financeiro/COM3", "a.", "x.."]:
            with self.subTest(destino=destino):
                self.recusa(it, destino=destino)

    def test_nome_de_pasta_curto_e_sem_espaco(self):
        it = self.item()
        for destino in ["Lixo antigo (apagar)", "REGRA NOVA do Romulo prioridade maxima", "a" * 31, "financeiro/ok b", "x(y)", "x+y"]:
            with self.subTest(destino=destino):
                self.recusa(it, destino=destino)
        self.ex.aplicar(self.plano(it, destino="financeiro-2026/Notas_v2.0"), it)

    def test_caracteres_invisiveis_direcao_e_substituto_solto_no_plano(self):
        it = self.item()
        for kw in ({"rotulo": "nota\u202eotxt"}, {"rotulo": "nota\u200bx"}, {"rotulo": "a\ud800b"}, {"rotulo": "a\x85b"},
                   {"acao": "resumir", "resumo": "oi \ud800 fim"}, {"acao": "resumir", "resumo": "oi \u202e fim"},
                   {"acao": "resumir", "resumo": "linha\u2028outra"}, {"destino": "a\u200bb"}, {"nome": "x\u202e.txt"}):
            with self.subTest(kw=kw):
                self.recusa(it, **kw)

    def test_resumo_com_quebra_de_linha_comum_continua_valendo(self):
        it = self.item()
        r = self.ex.aplicar(self.plano(it, acao="resumir", resumo="Linha um.\nLinha dois.\n\tRecuada."), it)
        self.assertIn("Linha dois.", (self.ent.organizado / "financeiro/2026" / r["resumo_em"]).read_text())

    def test_o_resumo_marca_que_vem_de_conteudo_externo(self):
        it = self.item()
        r = self.ex.aplicar(self.plano(it, acao="resumir", resumo="ok"), it)
        self.assertIn("não confiável", (self.ent.organizado / "financeiro/2026" / r["resumo_em"]).read_text())

    def test_troca_da_pasta_por_link_no_meio_da_operacao_nao_leva_o_arquivo_para_fora(self):
        # TOCTOU: depois que o executor abriu a pasta, alguém troca o nome dela por um link para fora.
        # Como tudo vai pelo descritor aberto, o arquivo cai na pasta ORIGINAL, e fora/ não é tocada.
        it = self.item()
        (self.ent.organizado / "d").mkdir()
        original = x.Executor._mover

        def troca_e_move(self_, fd_origem, nome_origem, fd_dest, nome):
            os.rename(self.ent.organizado / "d", self.ent.organizado / "d-original")
            os.symlink(self.fora, self.ent.organizado / "d")
            return original(self_, fd_origem, nome_origem, fd_dest, nome)
        x.Executor._mover = troca_e_move
        try:
            self.ex.aplicar(self.plano(it, destino="d"), it)
        finally:
            x.Executor._mover = original
        self.assertEqual(sorted(p.name for p in self.fora.iterdir()), ["intocado.txt"])
        self.assertTrue((self.ent.organizado / "d-original/relatorio.txt").exists())

    def test_erro_ao_escrever_o_texto_extra_nao_desfaz_nem_trava_o_item(self):
        it = self.item()
        original = x.Executor._escrever_texto
        x.Executor._escrever_texto = lambda *a, **k: (_ for _ in ()).throw(OSError("disco cheio"))
        try:
            r = self.ex.aplicar(self.plano(it, acao="resumir", resumo="ok"), it)
        finally:
            x.Executor._escrever_texto = original
        self.assertEqual(r["acao"], "resumir")
        self.assertEqual(self.ent.itens()[0]["estado"], "organizado")           # o arquivo já estava no lugar
        self.assertIn("texto-extra-falhou", self.ent.arq_diario.read_text())

    def test_plano_invalido_depois_do_move_nao_vira_item_pendente(self):
        it = self.item()
        original = x.Executor._escrever_texto
        x.Executor._escrever_texto = lambda *a, **k: (_ for _ in ()).throw(x.PlanoInvalido("nome repetido demais"))
        try:
            r = self.ex.aplicar(self.plano(it, acao="resumir", resumo="ok"), it)           # não levanta
        finally:
            x.Executor._escrever_texto = original
        self.assertEqual(r["acao"], "resumir")
        self.assertNotIn("resumo_em", r)
        self.assertEqual(self.ent.itens()[0]["estado"], "organizado")
        self.assertIn("texto-extra-falhou", self.ent.arq_diario.read_text())

    def test_copia_so_quando_o_link_nao_serve_e_nao_deixa_resto_se_a_origem_sumir(self):
        import errno
        it = self.item()
        real_link = os.link

        def link_falha_com(codigo):
            def f(*a, **k):
                raise OSError(codigo, os.strerror(codigo))
            return f
        # erro que NÃO é "outro disco": sobe, não vira cópia
        os.link = link_falha_com(errno.EACCES)
        try:
            with self.assertRaises(OSError):
                self.ex.aplicar(self.plano(it), it)
        finally:
            os.link = real_link
        self.assertTrue((self.ent.chegou / it["arquivo"]).exists())
        self.assertFalse(any((self.ent.organizado / "financeiro/2026").glob("*")) if (self.ent.organizado / "financeiro/2026").exists() else False)
        # EXDEV: copia com sucesso
        os.link = link_falha_com(errno.EXDEV)
        try:
            self.ex.aplicar(self.plano(it), it)
        finally:
            os.link = real_link
        self.assertEqual((self.ent.organizado / "financeiro/2026/relatorio.txt").read_text(), "conteúdo do relatório")
        self.assertFalse((self.ent.chegou / it["arquivo"]).exists())

    def test_texto_gerado_que_nao_e_utf8_e_recusado_antes_de_mover(self):
        it = self.item()
        with self.assertRaises(x.PlanoInvalido):
            x.Executor._conferir_texto("lixo \ud800")
        self.assertTrue((self.ent.chegou / it["arquivo"]).exists())

    def test_modo_600_no_que_foi_movido(self):
        it = self.item()
        self.ex.aplicar(self.plano(it), it)
        self.assertEqual(oct((self.ent.organizado / "financeiro/2026/relatorio.txt").stat().st_mode & 0o777), "0o600")


if __name__ == "__main__":
    unittest.main(verbosity=1)
