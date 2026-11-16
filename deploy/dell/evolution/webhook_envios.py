"""Configuração explícita de observação de envios; não envia ou reentrega mensagens."""
from copy import deepcopy


def incluir_envios(atual):
    if atual.get('enabled') is not True or not atual.get('url') or not isinstance(atual.get('events'), list):
        raise ValueError('Webhook ativo precisa de conferência')
    eventos = list(dict.fromkeys([*atual['events'], 'SEND_MESSAGE']))
    return {'webhook': {'enabled': True, 'url': atual['url'],
                        'headers': deepcopy(atual.get('headers') or {}),
                        'base64': atual.get('webhookBase64', False),
                        'byEvents': atual.get('webhookByEvents', False), 'events': eventos}}
