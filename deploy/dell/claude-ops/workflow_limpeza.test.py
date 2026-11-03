import copy
import unittest

from workflow_limpeza import CLASSIFICADOR, JEV_NOS, preparar


def workflow():
    return {"name": CLASSIFICADOR, "active": True, "settings": {"errorWorkflow": "erro"},
            "nodes": [{"name": "Entrada", "type": "webhook"},
                      *({"name": n, "disabled": True} for n in sorted(JEV_NOS))],
            "connections": {}, "staticData": {"preservar": True}}


def ligar(w, origem, destino):
    w["connections"][origem] = {"main": [[{"node": destino, "type": "main", "index": 0}]]}


class Limpeza(unittest.TestCase):
    def test_retira_so_residuo_sem_alterar_entrada_ou_metadados(self):
        w = workflow()
        nomes = sorted(JEV_NOS); ligar(w, nomes[0], nomes[1]); original = copy.deepcopy(w)
        out = preparar(w)
        esperado = copy.deepcopy(w); esperado["nodes"] = [w["nodes"][0]]; esperado["connections"] = {}
        self.assertEqual(out, esperado)
        self.assertEqual(w, original)
        self.assertEqual(preparar(out), out)

    def test_preserva_no_habilitado_ramo_incompleto_e_nome_duplicado(self):
        for modo in ["habilitado", "incompleto", "duplicado"]:
            with self.subTest(modo=modo):
                w = workflow()
                if modo == "habilitado": w["nodes"][1]["disabled"] = False
                elif modo == "incompleto": w["nodes"].pop()
                else: w["nodes"].append(copy.deepcopy(w["nodes"][1]))
                self.assertEqual(preparar(w), w)

    def test_preserva_dependencia_por_aresta_em_qualquer_direcao(self):
        nome = sorted(JEV_NOS)[0]
        for origem, destino in [("Entrada", nome), (nome, "Entrada")]:
            w = workflow(); ligar(w, origem, destino)
            self.assertEqual(preparar(w), w)

    def test_preserva_dependencia_por_expressao(self):
        w = workflow(); w["nodes"][0]["parameters"] = {"value": "={{ $('Jev: montar registro').first().json }}"}
        self.assertEqual(preparar(w), w)

    def test_outros_fluxos_pausados_e_tabelas_nao_sao_alterados(self):
        for nome in ["05 · Acompanhamento (Site antes da venda)", "06 · Funil semanal (Site antes da venda)",
                     "PRUMO · Fonte com IA (Luna do Hermes)", "01 · Caçador", "Radar PNCP — coleta diária"]:
            w = workflow(); w.update(name=nome, active=False, isArchived=True)
            self.assertEqual(preparar(w), w)
        w = workflow(); w["active"] = False
        self.assertFalse(preparar(w)["active"])


if __name__ == "__main__":
    unittest.main()
