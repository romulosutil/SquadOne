"""Retira apenas o ramo Jev já desabilitado e isolado do classificador.

Não muda pausas, credenciais, tabelas, histórico nem o experimento Jev da agenda.
Aplicado depois dos demais ganchos para não recriar resíduos na regeneração.
"""
import copy
import json


CLASSIFICADOR = "WhatsApp — resposta de lead (classifica)"
JEV_NOS = frozenset({
    "Jev: mascarar e montar pedido", "Jev: classificar (sombra)",
    "Jev: montar registro", "Jev: gravar na sombra",
})


def preparar(workflow):
    if workflow.get("name") != CLASSIFICADOR:
        return workflow
    nodes = workflow.get("nodes", [])
    candidatos = [n for n in nodes if n.get("name") in JEV_NOS]
    # Sem adivinhar o estado de um ramo incompleto, duplicado ou ainda habilitado.
    if (len(candidatos) != len(JEV_NOS)
            or {n["name"] for n in candidatos} != JEV_NOS
            or not all(n.get("disabled") is True for n in candidatos)):
        return workflow
    conexoes = workflow.get("connections", {})
    for origem, tipos in conexoes.items():
        for saidas in tipos.values():
            for saida in saidas:
                for destino in saida:
                    if (origem in JEV_NOS) != (destino.get("node") in JEV_NOS):
                        return workflow
    outros = [n for n in nodes if n.get("name") not in JEV_NOS]
    # Referências por expressão também são dependências, mesmo sem uma aresta.
    if any(nome in json.dumps(outros, ensure_ascii=False) for nome in JEV_NOS):
        return workflow
    resultado = copy.deepcopy(workflow)
    resultado["nodes"] = copy.deepcopy(outros)
    resultado["connections"] = {
        nome: copy.deepcopy(tipos) for nome, tipos in conexoes.items() if nome not in JEV_NOS
    }
    return resultado
