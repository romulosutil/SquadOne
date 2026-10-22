import json
import unittest
from copy import deepcopy
from prumo_contexto import preparar


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


if __name__ == "__main__":
    unittest.main()
