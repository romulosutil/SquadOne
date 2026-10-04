#!/usr/bin/env python3
"""Testes do graphify_projetos: o planejamento (quais repositórios viram
espelho), a sincronização dos espelhos, a rodada inteira (silêncio, falha,
GitHub fora do ar, orçamento de tempo), a exportação para o PC e a varredura de
duplicatas. Tudo numa home temporária e com `rodar` falso: sem rede, sem
graphify e sem tocar no Dell.

  python3 deploy/hermes/scripts/graphify_projetos.test.py
"""
import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("graphify_projetos", AQUI / "graphify_projetos.py")
gp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gp)


def proj(nome, caminho, **extra):
    base = {"nome": nome, "caminho": caminho, "repositorio": "", "tipo": "pasta", "dono": "Rômulo",
            "estado": "existe", "grafo": False, "papel": "teste"}
    base.update(extra)
    return base


def repo(nome, mb=1, arquivado=False, fork=False, branch="main"):
    return {"name": nome, "isArchived": arquivado, "isFork": fork, "diskUsage": mb * 1024,
            "defaultBranchRef": {"name": branch} if branch else None}


class Falso:
    """Faz o papel de gh, git e graphify. Anota cada chamada."""

    def __init__(self, repos=(), gh_falha=False, graphify_falha=(), commit="c1"):
        self.repos, self.gh_falha, self.commit = list(repos), gh_falha, commit
        self.graphify_falha, self.vazios = set(graphify_falha), set()
        self.urls, self.chamadas = {}, []
        self.diff = "src/novo.js\nREADME.md\n"
        self.global_list = "Global graph\n  SquadOne: 10 nodes\n  fantasma: 3 nodes\n"

    def __call__(self, args, cwd, timeout=0):
        a = [str(x) for x in args]
        self.chamadas.append(a)
        if a[0] == "gh":
            return (1, "", "gh: could not connect") if self.gh_falha else (0, json.dumps(self.repos), "")
        if a[0] == "git":
            if a[1] == "clone":
                destino = Path(a[-1])
                if destino.name in self.vazios:
                    return 128, "", "warning: You appear to have cloned an empty repository."
                (destino / ".git").mkdir(parents=True)
                (destino / "src").mkdir()
                (destino / "src/app.js").write_text("function a() {}\n")
                self.urls[str(destino)] = a[-2]
                return 0, "", ""
            if a[1] == "config":
                url = self.urls.get(str(cwd))
                return (0, url + "\n", "") if url else (1, "", "")
            if a[1] in ("fetch", "reset"):
                return 0, "", ""
            if a[1] == "rev-parse":
                return 0, self.commit + "\n", ""
            if a[1] == "diff":
                return 0, self.diff, ""
        if a[1] == "update":
            if Path(a[2]).name in self.graphify_falha:
                return 1, "", "erro de AST em x.js"
            saida = Path(a[2]) / "graphify-out"
            saida.mkdir(exist_ok=True)
            (saida / "graph.json").write_text(json.dumps({"nodes": [1, 2, 3], "links": [1, 2]}))
            (saida / "GRAPH_REPORT.md").write_text("# relatório")
            return 0, "", ""
        if a[1:3] == ["global", "add"] or a[1:3] == ["global", "remove"]:
            return 0, "", ""
        if a[1:3] == ["global", "list"]:
            return 0, self.global_list, ""
        raise AssertionError(f"comando inesperado: {a}")

    def chamou(self, *inicio):
        return [c for c in self.chamadas if c[:len(inicio)] == list(inicio)]


class Base(unittest.TestCase):
    def setUp(self):
        self.h = Path(tempfile.mkdtemp())
        sq = self.h / "SquadOne"
        (sq / "src").mkdir(parents=True)
        (sq / "src/main.ts").write_text("export const a = 1\n")
        subprocess.run(["git", "init", "-q", str(sq)], check=True)
        subprocess.run(["git", "-C", str(sq), "remote", "add", "origin", "https://github.com/o/SquadOne.git"], check=True)
        (self.h / "auto-site").mkdir()
        (self.h / "auto-site/site.js").write_text("var x\n")
        (self.h / "dados").mkdir()
        (self.h / "Mel").mkdir()
        self.reg = {"geral": {"graphify_limite_repo_mb": 300, "home_ignorar": []}, "projeto": [
            proj("SquadOne", "~/SquadOne", tipo="clone-vivo", repositorio="o/SquadOne", grafo=True),
            proj("auto-site", "~/auto-site", grafo=True),
            proj("dados", "~/dados"),
            proj("Mel/Repos", "~/Mel/Repos", tipo="espelho", repositorio="o/*", dono="Hermes", estado="a-criar", grafo=True),
            proj("fora", "~/Mel/Repos/fora", tipo="espelho", repositorio="o/fora", dono="Hermes",
                 estado="a-criar", dentro_de="Mel/Repos"),
        ]}
        self.fake = Falso(repos=[repo("SquadOne"), repo("novo"), repo("antigo", arquivado=True), repo("fork", fork=True),
                                 repo("fora"), repo("Grande", mb=400), repo("vazio", branch=None)])
        self.fake.urls[str(sq)] = "https://github.com/o/SquadOne.git"
        self.ctx = gp.Contexto(home=self.h, registro=self.reg, estado_dir=self.h / ".estado", fila=self.h / ".fila",
                               graphify="graphify", rodar=self.fake, verificador=AQUI / "projetos_verificar.py",
                               grafos_dir=self.h / "Mel/Grafos", espelhos_dir=self.h / "Mel/Repos")

    def tearDown(self):
        shutil.rmtree(self.h, ignore_errors=True)

    def estado(self):
        return json.loads((self.h / ".estado/estado.json").read_text())

    def fila(self):
        return sorted((self.h / ".fila").glob("*.json")) if (self.h / ".fila").exists() else []


class Planejamento(Base):
    def test_vivos_pastas_e_espelhos(self):
        alvos, avisos = gp.planejar(self.reg, self.h, self.fake.repos)
        por_tipo = {t: {a.nome for a in alvos if a.tipo == t} for t in ("viva", "pasta", "espelho")}
        self.assertEqual(por_tipo["viva"], {"SquadOne"})
        self.assertEqual(por_tipo["pasta"], {"auto-site"})  # "dados" tem grafo = false
        # fora: arquivado, fork, o que já é clone vivo, o que o registro tirou, o grande e o vazio.
        self.assertEqual(por_tipo["espelho"], {"novo"})
        self.assertTrue(any("Grande" in a and "300" in a for a in avisos))

    def test_limite_vem_do_registro(self):
        self.reg["geral"]["graphify_limite_repo_mb"] = 500
        alvos, avisos = gp.planejar(self.reg, self.h, self.fake.repos)
        self.assertIn("Grande", {a.nome for a in alvos})
        self.assertEqual(avisos, [])

    def test_nome_que_colide_nao_entra(self):
        alvos, avisos = gp.planejar(self.reg, self.h, [repo("Auto-Site")])
        self.assertNotIn("Auto-Site", {a.nome for a in alvos})
        self.assertTrue(any("colide" in a for a in avisos))

    def test_espelho_vai_para_a_area_do_registro_e_guarda_a_branch(self):
        alvos, _ = gp.planejar(self.reg, self.h, [repo("novo", branch="master")])
        a = next(x for x in alvos if x.nome == "novo")
        self.assertEqual((a.pasta, a.branch, a.repo), (self.h / "Mel/Repos/novo", "master", "o/novo"))

    def test_github_com_erro(self):
        self.fake.gh_falha = True
        with self.assertRaises(gp.ErroGitHub):
            gp.descobrir_repos("o", self.fake, self.h)

    def test_resposta_ilegivel(self):
        def ruim(args, cwd, timeout=0):
            return 0, "<html>", ""
        with self.assertRaises(gp.ErroGitHub):
            gp.descobrir_repos("o", ruim, self.h)

    def test_registro_real(self):
        """O projetos.toml versionado alimenta o planejamento sem tropeçar."""
        reg = gp.carregar_registro(AQUI.parent / "projetos.toml")
        repos = [repo(n) for n in ("SquadOne", "prumo", "crm-silmer", "Silmer", "silmer-web", "ds_auditor", "ds4fun")]
        alvos, avisos = gp.planejar(reg, Path("/home/x"), repos)
        nomes = {t: {a.nome for a in alvos if a.tipo == t} for t in ("viva", "pasta", "espelho")}
        self.assertEqual(nomes["viva"], {"SquadOne", "prumo", "crm-silmer"})
        self.assertIn("auto-site", nomes["pasta"])
        self.assertIn("corp-ds4fun", nomes["pasta"])
        self.assertNotIn("silmer-calendario-mobile", nomes["pasta"])  # grafo = false
        self.assertEqual(nomes["espelho"], {"silmer-web", "ds_auditor", "ds4fun"})  # "Silmer" legado fica de fora
        self.assertEqual(avisos, [])


class Espelhos(Base):
    def alvo(self, nome="novo"):
        return gp.Alvo(nome, self.h / "Mel/Repos" / nome, "espelho", f"o/{nome}", "main")

    def test_clone_novo_e_raso_e_so_da_branch(self):
        situacao, msg, commit = gp.sincronizar_espelho(self.ctx, self.alvo())
        self.assertEqual((situacao, commit), ("ok", "c1"))
        clone = self.fake.chamou("git", "clone")[0]
        for trecho in (["--depth", "1"], ["--single-branch"], ["--branch", "main"]):
            self.assertIn(trecho[0], clone)
        self.assertEqual(clone[-2], "https://github.com/o/novo.git")
        exclude = (self.h / "Mel/Repos/novo/.git/info/exclude").read_text().splitlines()
        self.assertIn("graphify-out/", exclude)

    def test_atualiza_com_fetch_e_reset_nunca_merge_nem_clean(self):
        gp.sincronizar_espelho(self.ctx, self.alvo())
        self.fake.chamadas.clear()
        situacao, _, _ = gp.sincronizar_espelho(self.ctx, self.alvo())
        self.assertEqual(situacao, "ok")
        self.assertEqual(len(self.fake.chamou("git", "fetch")), 1)
        reset = self.fake.chamou("git", "reset")[0]
        self.assertIn("--hard", reset)
        self.assertIn("FETCH_HEAD", reset)
        for c in self.fake.chamadas:
            self.assertNotIn(c[1:2], (["pull"], ["merge"], ["clean"], ["checkout"]))

    def test_recusa_pasta_que_nao_e_clone(self):
        destino = self.h / "Mel/Repos/novo"
        destino.mkdir(parents=True)
        (destino / "meu-arquivo.txt").write_text("de alguém")
        situacao, msg, _ = gp.sincronizar_espelho(self.ctx, self.alvo())
        self.assertEqual(situacao, "erro")
        self.assertIn("não mexi", msg)
        self.assertEqual(self.fake.chamou("git", "clone"), [])
        self.assertTrue((destino / "meu-arquivo.txt").exists())

    def test_recusa_clone_com_origin_de_outro_repositorio(self):
        gp.sincronizar_espelho(self.ctx, self.alvo())
        self.fake.urls[str(self.h / "Mel/Repos/novo")] = "https://github.com/o/outro.git"
        self.fake.chamadas.clear()
        situacao, msg, _ = gp.sincronizar_espelho(self.ctx, self.alvo())
        self.assertEqual(situacao, "erro")
        self.assertEqual(self.fake.chamou("git", "fetch") + self.fake.chamou("git", "reset"), [])

    def test_repositorio_vazio_nao_e_falha(self):
        self.fake.vazios = {"novo"}
        situacao, _, _ = gp.sincronizar_espelho(self.ctx, self.alvo())
        self.assertEqual(situacao, "vazio")

    def test_exclude_nao_repete_a_linha(self):
        pasta = self.h / "x"
        (pasta / ".git").mkdir(parents=True)
        gp.excluir_graphify_out(pasta)
        gp.excluir_graphify_out(pasta)
        self.assertEqual((pasta / ".git/info/exclude").read_text().count("graphify-out/"), 1)


class Rodada(Base):
    def test_repositorio_grande_avisa_na_fila_e_nao_no_whatsapp(self):
        texto = gp.executar(self.ctx)  # o cenário tem o "Grande", com 400 MB
        self.assertEqual(texto, "")  # aviso não é falha: nada no stdout do job
        arquivos = self.fila()
        self.assertEqual(len(arquivos), 1)
        self.assertIn("Grande", json.loads(arquivos[0].read_text())["texto"])
        self.assertNotIn("Grande", self.estado()["projetos"])  # e ficou de fora

    def test_tudo_certo_e_silencio(self):
        self.fake.repos = [r for r in self.fake.repos if r["name"] != "Grande"]
        texto = gp.executar(self.ctx)
        self.assertEqual(texto, "")
        est = self.estado()["projetos"]
        self.assertEqual(set(est), {"SquadOne", "auto-site", "novo"})
        self.assertTrue(all(est[n]["no_global"] for n in est))
        self.assertEqual(len(self.fake.chamou("graphify", "global", "add")), 3)
        self.assertEqual(self.fila(), [])  # nenhum aviso: o registro bate com o disco

    def test_limpa_o_global_so_do_que_nao_e_projeto(self):
        gp.executar(self.ctx)
        removidos = [c[-1] for c in self.fake.chamou("graphify", "global", "remove")]
        self.assertEqual(removidos, ["fantasma"])

    def test_exporta_para_o_pc_no_layout_dos_repositorios(self):
        (self.h / ".graphify").mkdir()
        (self.h / ".graphify/global-graph.json").write_text("{}")
        gp.executar(self.ctx)
        g = self.h / "Mel/Grafos"
        for nome in ("novo", "SquadOne", "auto-site"):
            self.assertTrue((g / nome / "graphify-out/graph.json").exists(), nome)
            self.assertTrue((g / nome / "graphify-out/GRAPH_REPORT.md").exists(), nome)
        self.assertTrue((g / "global-graph.json").exists())
        self.assertTrue((g / "RESUMO.md").exists())
        indice = json.loads((g / "indice.json").read_text())
        self.assertEqual(indice["novo"]["nos"], 3)
        self.assertFalse(any(p.is_symlink() for p in g.rglob("*")))  # cópias, não links

    def test_segunda_rodada_sem_mudanca_nao_roda_o_graphify(self):
        gp.executar(self.ctx)
        self.fake.chamadas.clear()
        self.assertEqual(gp.executar(self.ctx), "")
        self.assertEqual(self.fake.chamou("graphify", "update"), [])
        self.assertEqual(self.fake.chamou("graphify", "global", "add"), [])
        self.assertEqual(len(self.fake.chamou("git", "fetch")), 1)  # o espelho é atualizado, o resto fica

    def test_commit_novo_atualiza_o_grafo_e_vai_para_o_diario(self):
        gp.executar(self.ctx)
        self.fake.chamadas.clear()
        self.fake.commit = "c2"
        gp.executar(self.ctx)
        self.assertEqual([c[2] for c in self.fake.chamou("graphify", "update")], [str(self.h / "Mel/Repos/novo")])
        linhas = (self.h / ".estado/diario.jsonl").read_text().splitlines()
        ultima = json.loads(linhas[-1])["projetos"]["novo"]
        self.assertEqual(ultima["exemplos"], ["src/novo.js"])  # README.md não é código

    def test_primeiro_clone_nao_vira_atividade_no_diario(self):
        gp.executar(self.ctx)
        diario = (self.h / ".estado/diario.jsonl").read_text()
        self.assertNotIn('"novo"', diario)  # clone recém-feito tem todos os arquivos com a data de hoje

    def test_falha_de_um_projeto_vira_mensagem_e_o_resto_segue(self):
        self.fake.graphify_falha = {"novo"}
        texto = gp.executar(self.ctx)
        self.assertIn("novo", texto)
        self.assertIn("erro de AST", texto)
        self.assertIn("O resto seguiu", texto)
        est = self.estado()["projetos"]
        self.assertTrue(est["novo"]["erro"])
        self.assertTrue(est["SquadOne"]["no_global"])

    def test_github_fora_do_ar_nao_apaga_nada(self):
        gp.executar(self.ctx)  # cria o estado e o global
        self.fake.chamadas.clear()
        self.fake.gh_falha = True
        texto = gp.executar(self.ctx)
        self.assertIn("GitHub", texto)
        self.assertEqual(self.fake.chamou("git", "fetch"), [])  # sem a lista não se mexe nos espelhos
        self.assertEqual(self.fake.chamou("graphify", "global", "list") + self.fake.chamou("graphify", "global", "remove"), [])
        self.assertIn("novo", self.estado()["projetos"])  # e o espelho não sai do estado

    def test_orcamento_de_tempo_esgotado_avisa_e_nao_limpa(self):
        self.ctx.orcamento_s = -1
        texto = gp.executar(self.ctx)
        self.assertIn("acabou o tempo", texto)
        self.assertIn("faltam 3", texto)
        self.assertEqual(self.fake.chamou("graphify", "update"), [])
        self.assertEqual(self.fake.chamou("graphify", "global", "remove"), [])

    def test_rodada_manual_com_nome_so_faz_aquele_projeto(self):
        texto = gp.executar(self.ctx, ["novo"])
        self.assertEqual(texto, "")
        self.assertEqual(set(self.estado()["projetos"]), {"novo"})
        self.assertEqual(self.fake.chamou("graphify", "global", "list"), [])  # não limpa o global
        self.assertEqual(self.fila(), [])  # nem varre duplicatas

    def test_outra_rodada_em_andamento_cede(self):
        import fcntl
        self.ctx.estado_dir.mkdir(parents=True)
        f = open(self.ctx.estado_dir / ".lock", "w")
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            self.assertEqual(gp.executar(self.ctx), "")
            self.assertEqual(self.fake.chamadas, [])
        finally:
            f.close()

    def test_diario_e_resumo_tem_teto(self):
        self.ctx.estado_dir.mkdir(parents=True)
        antigas = [json.dumps({"em": "2999-01-01T00:00", "projetos": {"p": {"arquivos": 1}}}) for _ in range(gp.MAX_LINHAS_DIARIO + 50)]
        (self.ctx.estado_dir / "diario.jsonl").write_text("\n".join(antigas) + "\n")
        gp.executar(self.ctx)
        self.assertLessEqual(len((self.ctx.estado_dir / "diario.jsonl").read_text().splitlines()), gp.MAX_LINHAS_DIARIO)
        estado = {"rodado_em": "2026-10-04T03:00", "projetos": {
            f"p{i:03d}": {"arquivos_de_codigo": 1, "ultima_atividade": f"2026-10-{(i % 28) + 1:02d}T10:00"} for i in range(gp.MAX_LINHAS_RESUMO + 15)}}
        gp.escrever_resumo(self.ctx, estado)
        resumo = (self.ctx.estado_dir / "RESUMO.md").read_text()
        self.assertEqual(sum(1 for l in resumo.splitlines() if l.startswith("| p")), gp.MAX_LINHAS_RESUMO)
        self.assertIn("e mais 15 projetos", resumo)


class Duplicatas(Base):
    def test_avisa_uma_vez_por_conjunto_de_avisos(self):
        copia = self.h / "copia"
        (copia / ".git").mkdir(parents=True)
        self.fake.urls[str(copia)] = "https://github.com/o/SquadOne.git"
        gp.executar(self.ctx)
        arquivos = self.fila()
        self.assertEqual(len(arquivos), 1)
        msg = json.loads(arquivos[0].read_text())
        self.assertIn("fora do registro", msg["texto"])
        self.assertIn("o/squadone está em 2 pastas", msg["texto"])
        self.assertIn("Nada foi mexido", msg["texto"])
        gp.executar(self.ctx)  # mesma situação, mesma mensagem: não repete
        self.assertEqual(len(self.fila()), 1)

    def test_resolvido_e_de_novo_volta_a_avisar(self):
        copia = self.h / "copia"
        (copia / ".git").mkdir(parents=True)
        self.fake.urls[str(copia)] = "https://github.com/o/SquadOne.git"
        gp.executar(self.ctx)
        shutil.rmtree(copia)
        gp.executar(self.ctx)
        self.assertEqual(len(self.fila()), 1)  # resolvido: nada novo
        (copia / ".git").mkdir(parents=True)
        gp.executar(self.ctx)
        self.assertEqual(len(self.fila()), 2)  # voltou: avisa de novo

    def test_replica_congelada_convive_com_o_espelho(self):
        self.reg["projeto"].append(proj("Pessoal-dev", "~/Pessoal-dev", tipo="congelado"))
        gp.executar(self.ctx)
        replica = self.h / "Pessoal-dev/novo"
        (replica / ".git").mkdir(parents=True)
        self.fake.urls[str(replica)] = "https://github.com/o/novo.git"
        gp.executar(self.ctx)
        for arq in self.fila():
            self.assertNotIn("está em 2 pastas", json.loads(arq.read_text())["texto"])

    def test_worktree_nao_conta_como_repositorio_repetido(self):
        wt = self.h / "SquadOne-wt"
        wt.mkdir()
        (wt / ".git").write_text("gitdir: /algum/lugar\n")  # worktree: .git é arquivo
        self.fake.urls[str(wt)] = "https://github.com/o/SquadOne.git"
        gp.executar(self.ctx)
        for arq in self.fila():
            self.assertNotIn("está em 2 pastas", json.loads(arq.read_text())["texto"])


if __name__ == "__main__":
    unittest.main()
