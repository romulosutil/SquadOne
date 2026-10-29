import json
import os
import shutil
import subprocess
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import prumo_contexto
from prumo_contexto import carregar, ler_da_prumo, preparar

GIT = shutil.which("git")
CATALOGO_NOVO = {"familias": [{"id": "produtos"}], "produtos": [
    {"id": "iris", "nome": "Iris", "receita": "assinatura", "funil": True},
    {"id": "pdv", "nome": "PDV", "receita": "assinatura", "funil": False},
    {"id": "sgp", "nome": "SGP", "receita": "incubacao", "funil": False},
    {"id": "velho", "nome": "Sem os campos"}]}


def escrever_prumo(raiz, organizacao, catalogo):
    (raiz / "00-contexto").mkdir(parents=True, exist_ok=True)
    (raiz / "06-qualidade").mkdir(parents=True, exist_ok=True)
    (raiz / "00-contexto/organizacao.md").write_text(organizacao, encoding="utf-8", newline="")
    (raiz / "06-qualidade/catalogo.json").write_text(json.dumps(catalogo, ensure_ascii=False), encoding="utf-8")


def git(raiz, *args):
    # Repositório de teste: identidade e assinatura locais, para não depender da configuração de quem roda.
    return subprocess.run([GIT, "-c", "user.name=Teste", "-c", "user.email=teste@exemplo.invalid", "-c", "commit.gpgsign=false",
                           "-C", str(raiz), *args], check=True, capture_output=True, text=True).stdout.strip()


class ContextoTest(unittest.TestCase):
    def setUp(self):
        self.ctx = {"versao": 1, "organizacao_sha256": "a" * 64, "origem": "fonte", "organizacao": "guia"}
        self.wf = {"name": "PRUMO — teste", "active": False,
                   "nodes": [{"id": "inicio", "name": "Início", "type": "n8n-nodes-base.webhook", "position": [0, 0], "parameters": {}},
                             {"id": "fim", "name": "Fim", "type": "n8n-nodes-base.code", "parameters": {"jsCode": "return $input.all();"}}],
                   "connections": {"Início": {"main": [[{"node": "Fim", "type": "main", "index": 0}]]}}}

    def test_preserva_dados_e_estado_e_nao_muta_original(self):
        antes = deepcopy(self.wf)
        out = preparar(self.wf, self.ctx)
        self.assertEqual(antes, self.wf)
        self.assertFalse(out["active"])
        self.assertEqual(len(out["nodes"]), 3)
        self.assertIn("return $input.all();", out["nodes"][-1]["parameters"]["jsCode"])

    def test_idempotente(self):
        out = preparar(self.wf, self.ctx)
        self.assertEqual(preparar(out, self.ctx), out)

    def test_muda_contexto_sem_perder_conexoes(self):
        out = preparar(self.wf, self.ctx)
        novo = preparar(out, {**self.ctx, "organizacao_sha256": "b" * 64})
        self.assertEqual(out["connections"], novo["connections"])
        self.assertIn("b" * 64, novo["nodes"][-1]["parameters"]["jsCode"])

    def test_fluxo_fora_do_escopo_preservado(self):
        self.wf["name"] = "Radar PNCP"
        self.assertEqual(preparar(self.wf, self.ctx), self.wf)

    def test_fluxo_de_falha_tambem_recebe_contexto(self):
        self.wf["name"] = "00 · Avisar falha pelo Hermes"
        self.wf["nodes"][0]["type"] = "n8n-nodes-base.errorTrigger"
        self.assertEqual(len(preparar(self.wf, self.ctx)["nodes"]), 3)

    def test_multiplas_saidas_preservam_seus_destinos(self):
        self.wf["connections"]["Início"]["main"].append([{"node": "Fim", "type": "main", "index": 1}])
        out = preparar(self.wf, self.ctx)
        self.assertEqual(len(out["nodes"]), 4)
        self.assertEqual(preparar(out, self.ctx), out)

    def test_subworkflow_inline_recebe_mesmo_contexto(self):
        self.wf["nodes"][1]["parameters"]["workflowJson"] = json.dumps(deepcopy(self.wf))
        out = preparar(self.wf, self.ctx)
        filho = json.loads(out["nodes"][1]["parameters"]["workflowJson"])
        self.assertEqual(len(filho["nodes"]), 3)



class CarregarTest(unittest.TestCase):
    """Nada aqui toca o ~/prumo real: raiz temporária explícita e HOME/PRUMO_REPO apontados para ela."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {"PRUMO_REPO": str(self.dir / "nao-existe"), "HOME": str(self.dir)})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_sem_git_le_do_disco_e_marca_o_comercial(self):
        raiz = self.dir / "prumo"
        escrever_prumo(raiz, "guia\r\nlinha", CATALOGO_NOVO)
        c = carregar(raiz)
        self.assertEqual((c["versao"], c["lido_de"], c["organizacao"]), (1, "disco", "guia\nlinha"))
        self.assertEqual(c["produtos"], {"iris": "Iris", "pdv": "PDV", "sgp": "SGP", "velho": "Sem os campos"})
        self.assertEqual(c["comercial"], {"iris": {"receita": "assinatura", "funil": True},
                                          "pdv": {"receita": "assinatura", "funil": False},
                                          "sgp": {"receita": "incubacao", "funil": False}})
        self.assertIn("funil false ou receita incubacao", c["regra"])
        self.assertIn("não é oferecido a lead", c["regra"])

    def test_catalogo_antigo_sem_os_campos_nao_quebra(self):
        raiz = self.dir / "prumo"
        escrever_prumo(raiz, "guia", {"familias": [], "produtos": [{"id": "iris", "nome": "Iris"}]})
        c = carregar(raiz)
        self.assertEqual((c["produtos"], c["comercial"]), ({"iris": "Iris"}, {}))

    def test_subpasta_de_outro_repo_nao_le_o_git_do_pai(self):
        raiz = self.dir / "prumo"
        escrever_prumo(raiz, "guia", CATALOGO_NOVO)
        with patch.object(prumo_contexto, "_git", side_effect=AssertionError("não devia chamar o git")):
            self.assertEqual(ler_da_prumo(raiz, "06-qualidade/catalogo.json")[1], "disco")

    @unittest.skipUnless(GIT, "sem git")
    def test_le_a_origin_main_e_nao_toca_a_arvore_divergente(self):
        remoto, raiz, outro = self.dir / "remoto.git", self.dir / "prumo", self.dir / "outro"
        subprocess.run([GIT, "init", "-q", "--bare", "-b", "main", str(remoto)], check=True)
        subprocess.run([GIT, "clone", "-q", str(remoto), str(raiz)], check=True, capture_output=True)
        escrever_prumo(raiz, "guia v1", {"familias": [], "produtos": [{"id": "iris", "nome": "Iris"}]})
        git(raiz, "add", "-A"); git(raiz, "commit", "-q", "-m", "v1"); git(raiz, "push", "-q", "origin", "HEAD:main")
        # A main anda por outro clone (46 commits na Mel); a árvore da raiz fica atrás e mexida à mão.
        subprocess.run([GIT, "clone", "-q", str(remoto), str(outro)], check=True, capture_output=True)
        escrever_prumo(outro, "guia v2", CATALOGO_NOVO)
        git(outro, "add", "-A"); git(outro, "commit", "-q", "-m", "v2")
        (outro / "LEIA.md").write_text("commit alheio ao contexto", encoding="utf-8")
        git(outro, "add", "-A"); git(outro, "commit", "-q", "-m", "outro arquivo"); git(outro, "push", "-q", "origin", "HEAD:main")
        v2 = git(outro, "log", "-1", "--format=%h", "--", "06-qualidade/catalogo.json")
        escrever_prumo(raiz, "guia mexido à mão", {"familias": [], "produtos": [{"id": "local", "nome": "Local"}]})
        head, status = git(raiz, "rev-parse", "HEAD"), git(raiz, "status", "--porcelain")

        c = carregar(raiz)
        self.assertEqual(c["organizacao"], "guia v2")
        self.assertIn("pdv", c["produtos"]); self.assertNotIn("local", c["produtos"])
        self.assertEqual(c["comercial"]["sgp"], {"receita": "incubacao", "funil": False})
        # O commit é o último que mexeu nos arquivos: o "outro arquivo" não muda o contexto.
        self.assertEqual(c["lido_de"], "origin/main@" + v2)
        self.assertEqual((git(raiz, "rev-parse", "HEAD"), git(raiz, "status", "--porcelain")), (head, status))
        self.assertIn("mexido", (raiz / "00-contexto/organizacao.md").read_text(encoding="utf-8"))

        # Remoto fora do ar: usa a origin/main já conhecida, sem erro.
        git(raiz, "remote", "set-url", "origin", str(self.dir / "sumiu.git"))
        self.assertEqual(carregar(raiz)["lido_de"], "origin/main@" + v2)
        # Arquivo que a origin/main não tem: cai no disco.
        (raiz / "so-local.txt").write_text("local", encoding="utf-8")
        self.assertEqual(ler_da_prumo(raiz, "so-local.txt"), ("local", "disco"))


if __name__ == "__main__":
    unittest.main()
