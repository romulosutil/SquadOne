import copy
import importlib.util
import sys
import types
import unittest
from pathlib import Path

stub = types.ModuleType("n8n")
stub.api = lambda *a, **k: (_ for _ in ()).throw(AssertionError("API real proibida"))
stub.put = stub.api
sys.modules["n8n"] = stub
spec = importlib.util.spec_from_file_location("balcao_restrito", Path(__file__).with_name("site-antes-da-venda.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class PublicacaoRestrita(unittest.TestCase):
    def test_somente_codigo_do_03_e_estado_original(self):
        for ativo in (True, False):
            with self.subTest(ativo=ativo):
                original = {"id": "03-id", "name": "03 · Balcão (Site antes da venda)", "active": ativo,
                    "nodes": [{"id": "custom-id", "name": "Cruzar recibos e montar abordagem", "type": "n8n-nodes-base.code", "parameters": {"jsCode": "antes", "mode": "custom"}}, {"id": "outro", "name": "Outro nó"}], "connections": {"custom": True}, "settings": {"saveManualExecutions": True}}
                antes = copy.deepcopy(original)
                chamadas, escritos = [], []
                def api(method, url):
                    chamadas.append((method, url))
                    if method == "GET" and "?" in url:
                        return {"data": [{"id": "01", "name": "01 · Caçador"}, {"id": "03-id", "name": original["name"]}, {"id": "06", "name": "06 · Funil semanal"}]}
                    if method == "GET": return original
                    self.assertEqual((method, url), ("POST", "/workflows/03-id/activate"))
                r = mod.publicar_balcao_restrito(api, escritos.append)
                self.assertEqual(r, {"id": "03-id", "active": ativo})
                self.assertEqual(original, antes)
                novo = escritos[0]
                self.assertIn("PRIMEIRA_EVENTO_CRITICO", novo["nodes"][0]["parameters"]["jsCode"])
                novo["nodes"][0]["parameters"]["jsCode"] = "antes"
                self.assertEqual(novo, original)
                self.assertEqual(sum(m == "POST" for m, _ in chamadas), 1 if ativo else 0)
    def test_ausente_nao_cria_nem_altera_fluxo(self):
        with self.assertRaises(ValueError):
            mod.publicar_balcao_restrito(lambda *a: {"data": []}, lambda _: self.fail("não publicar"))

if __name__ == "__main__": unittest.main()
