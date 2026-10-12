#!/usr/bin/env python3
"""Testes do graphify_projetos: o planejamento (quais repositórios viram
espelho), a sincronização dos espelhos, a rodada inteira (silêncio, falha,
GitHub fora do ar, orçamento de tempo), a exportação para o PC e a varredura de
duplicatas. Tudo numa home temporária e com `rodar` falso: sem rede, sem
graphify e sem tocar no Dell.

Desde 11/10/2026 também o modo `--fila` (o graphify-projetos.service): a falha
vira aviso na fila que o dell-status aceita, com o conteúdo que o job antigo
imprimia; erro inesperado e SIGTERM também avisam; sem a lib de aviso o script
volta ao jeito antigo. O HOME vira um temporário ANTES do import, para nada
cair na fila de verdade.

  python3 deploy/hermes/scripts/graphify_projetos.test.py
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
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

_HOME = tempfile.mkdtemp(prefix="graphify-teste-home-")
os.environ["HOME"] = _HOME
os.environ.pop("SQUADONE_AVISOS_FILA", None)
atexit.register(shutil.rmtree, _HOME, True)

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent.parent
spec = importlib.util.spec_from_file_location("graphify_projetos", AQUI / "graphify_projetos.py")
gp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gp)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_graphify", RAIZ / "deploy/dell/dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — sem fcntl (Windows)
    ds = None

BR = timezone(timedelta(hours=-3))


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
        # A pasta da fila é do dell-status (2770): existe no Dell e a lib não a cria.
        (self.h / ".fila").mkdir()
        self.lib_do_repo = list(gp.PASTAS_DA_LIB)
        self.addCleanup(setattr, gp, "PASTAS_DA_LIB", self.lib_do_repo)

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


def calado(f, *a, **k):
    """(resultado, stdout, stderr) sem sujar a saída do teste."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        r = f(*a, **k)
    return r, out.getvalue(), err.getvalue()


class AvisoDeDuplicatasPelaLib(Base):
    """A avisar_na_fila copiada virou a lib, com o mesmo aviso."""

    def duplicata(self):
        copia = self.h / "copia"
        (copia / ".git").mkdir(parents=True, exist_ok=True)
        self.fake.urls[str(copia)] = "https://github.com/o/SquadOne.git"

    def gravado_pelo(self, jeito: str) -> tuple[str, bytes]:
        """(nome, conteúdo) do aviso gravado com a lib ('lib') ou sem ela ('antigo'), do zero."""
        shutil.rmtree(self.ctx.estado_dir, ignore_errors=True)
        shutil.rmtree(self.ctx.fila, ignore_errors=True)
        self.ctx.fila.mkdir()
        gp.PASTAS_DA_LIB = self.lib_do_repo if jeito == "lib" else [self.h / "sem-lib"]
        calado(gp.executar, self.ctx)
        arquivos = self.fila()
        self.assertEqual(len(arquivos), 1, arquivos)
        return arquivos[0].name, arquivos[0].read_bytes()

    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(gp.lib_de_aviso().__file__).resolve(), (RAIZ / "deploy/dell/lib/aviso.py").resolve())

    def test_identico_ao_jeito_antigo_menos_a_quebra_de_linha_do_fim(self):
        self.duplicata()
        nome_antigo, antigo = self.gravado_pelo("antigo")
        nome_novo, novo = self.gravado_pelo("lib")
        self.assertEqual(novo + b"\n", antigo)
        self.assertRegex(nome_antigo, r"^graphify-duplicatas-\d{14}-\d{6}\.json$")
        self.assertRegex(nome_novo, r"^graphify-duplicatas-\d+-[0-9a-f]{6}\.json$")
        d = json.loads(novo.decode("utf-8"))
        self.assertEqual((d["titulo"], d["origem"]), ("Mel: pastas fora do registro ou repetidas", "hermes:graphify-projetos"))

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        self.duplicata()
        ds.validar_aviso(json.loads(self.gravado_pelo("lib")[1].decode("utf-8")))

    def test_lista_longa_e_cortada_em_vez_de_recusada(self):
        avisos = [f"pasta-{i:03d} fora do registro, com uma explicação comprida o bastante" for i in range(120)]
        estado = {}
        gp.avisar_na_fila(self.ctx, estado, avisos, 0)
        d = json.loads(self.fila()[0].read_text(encoding="utf-8"))
        self.assertLessEqual(len(d["texto"]), 4000)
        self.assertTrue(d["texto"].endswith("… (cortado)"))
        if ds is not None:
            ds.validar_aviso(d)

    def test_fila_ausente_nao_levanta_e_avisa_na_noite_seguinte(self):
        self.duplicata()
        shutil.rmtree(self.ctx.fila)
        texto, _, err = calado(gp.executar, self.ctx)
        self.assertEqual(texto, "")
        self.assertIn("fila_ausente", err)
        self.assertFalse(self.ctx.fila.exists())  # a pasta é do dell-status: a lib não a cria
        self.assertEqual(self.estado().get("avisos_vistos", []), [])  # não foi gravado: não conta como visto
        self.ctx.fila.mkdir()
        calado(gp.executar, self.ctx)
        self.assertEqual(len(self.fila()), 1)

    def test_sem_a_lib_cria_a_pasta_como_antes(self):
        self.duplicata()
        shutil.rmtree(self.ctx.fila)
        gp.PASTAS_DA_LIB = [self.h / "sem-lib"]
        calado(gp.executar, self.ctx)
        self.assertEqual(len(self.fila()), 1)

    def test_copia_quebrada_cai_na_seguinte(self):
        quebrada = self.h / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
        gp.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(gp.lib_de_aviso().__file__).resolve(), (RAIZ / "deploy/dell/lib/aviso.py").resolve())
        gp.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(gp.lib_de_aviso())


class FalhaNaFila(Base):
    """O modo --fila do graphify-projetos.service."""

    AGORA = datetime(2026, 10, 11, 3, 40, tzinfo=BR)

    def setUp(self):
        super().setUp()
        self.fake.repos = [r for r in self.fake.repos if r["name"] != "Grande"]  # sem aviso de duplicata

    def falhas(self):
        return sorted(self.ctx.fila.glob("graphify-falha-*.json"))

    def pela_fila(self, agora=None):
        return calado(gp.rodar_pela_fila, self.ctx, (), agora=lambda: agora or self.AGORA)

    def zerar(self):
        shutil.rmtree(self.ctx.estado_dir, ignore_errors=True)
        for f in self.ctx.fila.glob("*.json"):
            f.unlink()

    def test_rodada_sem_falha_nao_avisa(self):
        codigo, out, _ = self.pela_fila()
        self.assertEqual(codigo, 0)
        self.assertEqual(list(self.ctx.fila.iterdir()), [])
        self.assertIn("nada para avisar", out)

    def test_falha_vai_para_a_fila_com_o_conteudo_do_job_antigo(self):
        self.fake.graphify_falha = {"novo"}
        antigo, impresso, _ = calado(gp.main, [], self.ctx)  # o job do Hermes: stdout
        self.assertEqual(antigo, 0)
        self.assertEqual(self.falhas(), [])  # o modo antigo não grava a falha na fila
        self.assertIn("erro de AST", impresso)
        self.zerar()
        codigo, out, _ = self.pela_fila()
        self.assertEqual(codigo, 0)  # a rodada foi inteira; a falha de um projeto já está avisada
        self.assertEqual(len(self.falhas()), 1)
        d = json.loads(self.falhas()[0].read_text(encoding="utf-8"))
        self.assertEqual(d["titulo"], "🧭 Operação — graphify")
        self.assertEqual(d["origem"], "hermes:graphify-projetos")
        self.assertEqual(d["chave"], "graphify:falha:2026-10-11")
        self.assertEqual(d["prioridade"], 2)
        self.assertEqual(d["expira_em"], "2026-10-12T03:00:00-03:00")  # a rodada seguinte
        # O que chega ao WhatsApp é o que o job imprimia, sem a linha em branco depois do título.
        self.assertEqual(f"{d['titulo']}\n{d['texto']}", impresso.strip().replace("\n\n", "\n", 1))
        self.assertIn("erro de AST", out)  # o stdout é log
        if ds is not None:
            self.assertEqual(ds.mensagem_do_aviso(ds.validar_aviso(d)), impresso.strip().replace("\n\n", "\n", 1))

    def test_main_com_fila(self):
        self.fake.graphify_falha = {"novo"}
        codigo, _, _ = calado(gp.main, ["--fila"], self.ctx)
        self.assertEqual(codigo, 0)
        self.assertEqual(len(self.falhas()), 1)

    def test_erro_inesperado_vira_aviso_e_a_unit_falha(self):
        def quebra(args, cwd, timeout=0):
            raise RuntimeError("disco sumiu")
        self.ctx.rodar = quebra
        codigo, _, err = self.pela_fila()
        self.assertEqual(codigo, 1)
        d = json.loads(self.falhas()[0].read_text(encoding="utf-8"))
        self.assertIn("RuntimeError: disco sumiu", d["texto"])
        self.assertIn("journalctl --user -u graphify-projetos", d["texto"])
        self.assertIn("Traceback", err)  # o detalhe fica no journal
        if ds is not None:
            ds.validar_aviso(d)

    def test_sigterm_do_timeout_vira_aviso(self):
        antes = signal.getsignal(signal.SIGTERM)

        def termina(args, cwd, timeout=0):
            os.kill(os.getpid(), signal.SIGTERM)  # o que o systemd manda ao passar do TimeoutStartSec
            return self.fake(args, cwd, timeout)
        self.ctx.rodar = termina
        codigo, _, _ = self.pela_fila()
        self.assertEqual(codigo, 1)
        d = json.loads(self.falhas()[0].read_text(encoding="utf-8"))
        self.assertIn("interrompida (SIGTERM)", d["texto"])
        self.assertIs(signal.getsignal(signal.SIGTERM), antes)  # o tratador some com a rodada

    def test_aviso_que_nao_chega_a_fila_faz_a_unit_falhar(self):
        self.fake.graphify_falha = {"novo"}
        shutil.rmtree(self.ctx.fila)
        codigo, out, err = self.pela_fila()
        self.assertEqual(codigo, 1)
        self.assertIn("erro de AST", out)  # o texto fica no journal
        self.assertIn("fila_ausente", err)

    def test_sem_a_lib_grava_do_jeito_antigo_e_o_dell_status_aceita(self):
        self.fake.graphify_falha = {"novo"}
        gp.PASTAS_DA_LIB = [self.h / "sem-lib"]
        codigo, _, _ = self.pela_fila()
        self.assertEqual(codigo, 0)
        arquivos = self.falhas()
        self.assertEqual(len(arquivos), 1)
        self.assertRegex(arquivos[0].name, r"^graphify-falha-\d+\.json$")
        if ds is not None:
            ds.validar_aviso(json.loads(arquivos[0].read_text(encoding="utf-8")))

    def test_texto_longo_cortado_com_e_sem_a_lib(self):
        msg = "🧭 Operação — graphify\n\nNão consegui atualizar o grafo de:\n" + "\n".join(
            f"• projeto-{i:03d}: erro comprido de AST num arquivo qualquer" for i in range(200))
        for jeito in ("lib", "antigo"):
            with self.subTest(jeito=jeito):
                for f in self.ctx.fila.glob("*.json"):
                    f.unlink()
                gp.PASTAS_DA_LIB = self.lib_do_repo if jeito == "lib" else [self.h / "sem-lib"]
                self.assertTrue(calado(gp.gravar_aviso, self.ctx.fila, gp.aviso_de_falha(msg, self.AGORA), "graphify-falha")[0])
                d = json.loads(self.falhas()[0].read_text(encoding="utf-8"))
                self.assertLessEqual(len(d["texto"]), 4000)
                self.assertTrue(d["texto"].endswith("… (cortado)"))
                self.assertTrue(d["texto"].startswith("Não consegui atualizar o grafo de:"))
                if ds is not None:
                    ds.validar_aviso(d)

    def test_valor_em_reais_vira_marcador_em_vez_de_perder_o_aviso(self):
        aviso = gp.aviso_de_falha("🧭 Operação — graphify\n\nerro: custa R$ 10", self.AGORA)
        self.assertTrue(calado(gp.gravar_aviso, self.ctx.fila, aviso, "graphify-falha")[0])
        self.assertNotRegex(json.loads(self.falhas()[0].read_text(encoding="utf-8"))["texto"], r"R\s*\$")

    def test_proxima_rodada(self):
        self.assertEqual(gp.proxima_rodada(datetime(2026, 10, 11, 1, 0, tzinfo=BR)), datetime(2026, 10, 11, 3, 0, tzinfo=BR))
        self.assertEqual(gp.proxima_rodada(datetime(2026, 10, 11, 3, 0, tzinfo=BR)), datetime(2026, 10, 12, 3, 0, tzinfo=BR))
        self.assertEqual(gp.proxima_rodada(datetime(2026, 10, 31, 22, 0, tzinfo=BR)), datetime(2026, 11, 1, 3, 0, tzinfo=BR))

    def test_titulo_e_texto(self):
        self.assertEqual(gp.titulo_e_texto("A\n\nb\nc"), ("A", "b\nc"))
        self.assertEqual(gp.titulo_e_texto("só uma linha"), ("🧭 Operação — graphify", "só uma linha"))
        longa = "x" * 130
        self.assertEqual(gp.titulo_e_texto(longa + "\nresto"), ("🧭 Operação — graphify", longa + "\nresto"))


class Units(unittest.TestCase):
    """O service e o timer que substituem o job do Hermes."""

    def ler(self, nome):
        return (RAIZ / "deploy/dell" / nome).read_text(encoding="utf-8")

    def test_service_roda_a_copia_instalada_com_fila(self):
        s = self.ler("graphify-projetos.service")
        self.assertIn("ExecStart=/usr/bin/python3 %h/.local/bin/graphify-projetos --fila\n", s)
        self.assertIn("Environment=PATH=%h/.local/bin:", s)  # gh e graphify moram em ~/.local/bin
        self.assertIn("TimeoutStartSec=1h", s)
        self.assertIn("Type=oneshot", s)

    def test_timer_na_hora_que_o_aviso_expira(self):
        t = self.ler("graphify-projetos.timer")
        m = re.search(r"^OnCalendar=\*-\*-\* (\d\d):00:00$", t, re.M)
        self.assertEqual(int(m.group(1)), gp.HORA_DA_RODADA)
        self.assertIn("Persistent=true", t)
        self.assertIn("WantedBy=timers.target", t)

    def test_instalados_json_leva_o_script_e_as_units(self):
        inst = json.loads((RAIZ / "deploy/dell/instalados.json").read_text(encoding="utf-8"))["arquivos"]
        pares = {(e["repo"], e["instalado"]) for e in inst}
        self.assertIn(("deploy/hermes/scripts/graphify_projetos.py", "~/.local/bin/graphify-projetos"), pares)
        self.assertIn(("deploy/hermes/scripts/run-graphify.sh", "~/workspace/scripts/run-graphify.sh"), pares)
        # As units entram pelo curinga, do mesmo jeito que o dell-status o lê (comparar_instalados).
        for unit in ("graphify-projetos.service", "graphify-projetos.timer"):
            cobertas = [e for e in inst if any(c in e["repo"] for c in "*?[")
                        and RAIZ / "deploy/dell" / unit in set(RAIZ.glob(e["repo"]))
                        and e["instalado"] == "~/.config/systemd/user/"]
            self.assertTrue(cobertas, unit)


if __name__ == "__main__":
    unittest.main()
