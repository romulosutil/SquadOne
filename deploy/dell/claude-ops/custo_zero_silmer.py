"""Silmer está fora da política de custo zero de pesquisa de leads.

Compatibilidade com importadores anteriores: não altera o workflow.
IA e transcrição restauradas por instrução explícita do operador.
"""
import copy


def preparar(w):
    return copy.deepcopy(w)
