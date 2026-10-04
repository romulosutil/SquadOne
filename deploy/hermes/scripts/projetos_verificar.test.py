#!/usr/bin/env python3
"""Testes do verificador do registro de projetos. Tudo numa home temporária e
com o `origin` do Git injetado: nada do Dell é lido nem escrito.

  python3 deploy/hermes/scripts/projetos_verificar.test.py
"""
import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("projetos_verificar", AQUI / "projetos_verificar.py")
pv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)


def proj(nome, caminho, **extra):
    base = {"nome": nome, "caminho": caminho, "repositorio": "", "tipo": "pasta", "dono": "Rômulo",
            "estado": "existe", "grafo": False, "papel": "teste"}
    base.update(extra)
    return base


class Registro(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        for d in ("a", "b", "Documentos", ".oculta", "Mel/Repos"):
            (self.home / d).mkdir(parents=True)
        (self.home / "git").mkdir()
        (self.home / "git/.git").mkdir()

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    def valida(self, projetos, **kw):
        reg = {"geral": {"home_ignorar": ["Documentos"]}, "projeto": projetos}
        return pv.validar(reg, self.home, origin=kw.pop("origin", lambda c: ""), **kw)

    def erros(self, *a, **kw):
        return [m for n, m in self.valida(*a, **kw) if n == "erro"]

    def avisos(self, *a, **kw):
        return [m for n, m in self.valida(*a, **kw) if n == "aviso"]

    def test_registro_sem_problema(self):
        achados = self.valida([proj("a", "~/a"), proj("b", "~/b"), proj("git", "~/git", tipo="clone-vivo", repositorio="o/git")],
                              origin=lambda c: "o/git")
        self.assertEqual([m for n, m in achados if n == "erro"], [])

    def test_caminho_e_nome_repetidos(self):
        e = self.erros([proj("a", "~/a"), proj("a", "~/b"), proj("c", "~/a")])
        self.assertTrue(any("nome repetido" in m for m in e))
        self.assertTrue(any("caminho repetido" in m for m in e))

    def test_caminho_repetido_com_barra_ou_ponto(self):
        e = self.erros([proj("a", "~/a"), proj("x", "~/a/")])
        self.assertTrue(any("caminho repetido" in m for m in e))

    def test_mesmo_repositorio_em_dois_caminhos(self):
        e = self.erros([proj("a", "~/a", repositorio="o/x"), proj("b", "~/b", repositorio="o/x")])
        self.assertTrue(any("o/x" in m and "um só caminho" in m for m in e))

    def test_repositorio_vazio_e_curinga_nao_contam_como_repetidos(self):
        e = self.erros([proj("a", "~/a"), proj("b", "~/b"),
                        proj("m1", "~/Mel/Repos", repositorio="o/*", tipo="espelho", estado="a-criar"),
                        proj("m2", "~/Mel/Repos2", repositorio="o/*", tipo="espelho", estado="a-criar")])
        self.assertFalse(any("repositório" in m for m in e))

    def test_existe_mas_nao_existe(self):
        e = self.erros([proj("z", "~/z")])
        self.assertTrue(any("não existe" in m for m in e))

    def test_a_criar_que_ja_existe_e_so_aviso(self):
        reg = [proj("a", "~/a", estado="a-criar"), proj("b", "~/b")]
        self.assertEqual(self.erros(reg), [])
        self.assertTrue(any("já existe" in m for m in self.avisos(reg)))

    def test_a_criar_que_nao_existe_passa(self):
        self.assertEqual(self.erros([proj("n", "~/nova", estado="a-criar"), proj("a", "~/a"), proj("b", "~/b"), proj("g", "~/git")]), [])

    def test_clone_vivo_com_origin_diferente(self):
        e = self.erros([proj("git", "~/git", tipo="clone-vivo", repositorio="o/certo")], origin=lambda c: "o/errado")
        self.assertTrue(any("o/errado" in m and "o/certo" in m for m in e))

    def test_clone_vivo_sem_git(self):
        e = self.erros([proj("a", "~/a", tipo="clone-vivo", repositorio="o/a")])
        self.assertTrue(any("sem .git" in m for m in e))

    def test_clone_vivo_e_espelho_exigem_repositorio(self):
        e = self.erros([proj("a", "~/a", tipo="clone-vivo"), proj("b", "~/b", tipo="espelho")], checar_disco=False)
        self.assertEqual(sum("precisa de repositorio" in m for m in e), 2)

    def test_pasta_dentro_de_outra_precisa_declarar(self):
        (self.home / "a/filha").mkdir()
        sem = self.erros([proj("a", "~/a"), proj("f", "~/a/filha"), proj("b", "~/b")])
        self.assertTrue(any("não declara dentro_de" in m for m in sem))
        com = self.erros([proj("a", "~/a"), proj("f", "~/a/filha", dentro_de="a"), proj("b", "~/b")])
        self.assertEqual(com, [])

    def test_dentro_de_que_nao_e_pai(self):
        e = self.erros([proj("a", "~/a"), proj("b", "~/b", dentro_de="a")])
        self.assertTrue(any("não está dentro de a" in m for m in e))

    def test_dentro_de_inexistente(self):
        e = self.erros([proj("a", "~/a", dentro_de="fantasma"), proj("b", "~/b")])
        self.assertTrue(any("fantasma" in m for m in e))

    def test_pasta_de_topo_fora_do_registro_avisa(self):
        av = self.avisos([proj("a", "~/a")])
        self.assertTrue(any("~/b" in m for m in av))
        self.assertFalse(any("Documentos" in m or ".oculta" in m for m in av))  # ignorada / oculta

    def test_pai_de_um_projeto_conta_como_registrado(self):
        # ~/Mel não é projeto, mas ~/Mel/Repos é: o topo está coberto.
        av = self.avisos([proj("a", "~/a"), proj("b", "~/b"), proj("git", "~/git"),
                          proj("r", "~/Mel/Repos", estado="a-criar")])
        self.assertFalse(any("fora do registro" in m and "~/Mel" in m for m in av))

    def test_worktree_declarado_cobre_a_pasta_onde_mora(self):
        (self.home / "wt/ramo").mkdir(parents=True)
        reg = [proj("a", "~/a", worktrees=["~/wt/ramo"]), proj("b", "~/b"), proj("git", "~/git"), proj("m", "~/Mel/Repos")]
        self.assertFalse(any("~/wt" in m for m in self.avisos(reg)))
        reg[0]["worktrees"] = []
        self.assertTrue(any("~/wt" in m for m in self.avisos(reg)))

    def test_campos_e_valores_invalidos(self):
        e = self.erros([{"nome": "x", "caminho": "~/a"}], checar_disco=False)
        self.assertTrue(any("faltam campos" in m for m in e))
        e = self.erros([proj("a", "~/a", tipo="outro", dono="Fulano", estado="talvez", grafo="sim")], checar_disco=False)
        for trecho in ("tipo", "dono", "estado", "grafo"):
            self.assertTrue(any(trecho in m for m in e), trecho)

    def test_caminho_precisa_de_til(self):
        self.assertTrue(any("'~/'" in m for m in self.erros([proj("a", "/tmp/a")], checar_disco=False)))

    def test_registro_vazio(self):
        self.assertTrue(self.erros([]))

    def test_url_do_origin(self):
        f = pv.repositorio_de_url
        self.assertEqual(f("https://github.com/romulosutil/SquadOne.git\n"), "romulosutil/SquadOne")
        self.assertEqual(f("git@github.com:romulosutil/prumo.git"), "romulosutil/prumo")
        self.assertEqual(f("https://x-access-token:SEGREDO@github.com/o/n.git"), "o/n")
        self.assertEqual(f("https://gitlab.com/o/n.git"), "")
        self.assertEqual(f(""), "")


class Documento(unittest.TestCase):
    def test_md_agrupa_por_tipo_e_marca_a_criar(self):
        reg = {"geral": {"home_ignorar": ["Downloads"]}, "projeto": [
            proj("viva", "~/viva", tipo="clone-vivo", repositorio="o/viva", grafo=True, observacao="cuidado"),
            proj("nova", "~/Mel/Repos", tipo="espelho", repositorio="o/*", estado="a-criar", dono="Hermes", cobertura_github="98%"),
            proj("pipe", "~/p", papel="a | b"),
        ]}
        md = pv.renderizar_md(reg)
        self.assertIn("## Clones vivos", md)
        self.assertIn("## Espelhos", md)
        self.assertIn("`~/Mel/Repos` *(a criar)*", md)
        self.assertIn("a \\| b", md)  # pipe não quebra a tabela
        self.assertIn("- **viva**: cuidado", md)
        self.assertIn("o GitHub cobre 98%", md)
        self.assertIn("`Downloads`", md)
        self.assertNotIn("## Congelados", md)  # grupo vazio não aparece

    def test_registro_real_tem_estrutura_valida(self):
        """O projetos.toml versionado: campos, valores, unicidade e aninhamento.
        Sem olhar o disco (o Dell é que sabe se as pastas existem)."""
        reg = pv.carregar()
        erros = [m for n, m in pv.validar(reg, Path("/home/x"), checar_disco=False) if n == "erro"]
        self.assertEqual(erros, [])
        self.assertTrue(pv.renderizar_md(reg).startswith("# Projetos da Mel"))


if __name__ == "__main__":
    unittest.main()
