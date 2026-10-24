"""Política comercial reversível de modelos; puro, sem inferência ou API."""
import copy

NOME = 'WhatsApp — resposta de lead (classifica)'
SOMBRA = ('Jev: mascarar e montar pedido', 'Jev: classificar (sombra)',
          'Jev: montar registro', 'Jev: gravar na sombra')
MARCA = '[jev-coleta-pausada-2026-10-24]'


def pausar_sombra(workflow):
    wf = copy.deepcopy(workflow)
    if wf.get('name') != NOME or wf.get('id') not in (None, 'IiuekGDVnjFaZpD1'):
        return wf
    nos = {n['name']: n for n in wf.get('nodes', [])}
    presentes = set(SOMBRA) & set(nos)
    if not presentes:
        return wf
    if presentes != set(SOMBRA):
        raise ValueError('Ramo Jev parcial; não alterar sem revisão.')
    # Sem aresta de entrada no experimento. Nós, credencial e tabela preservados.
    for origem, tipos in wf.get('connections', {}).items():
        if origem in SOMBRA:
            continue
        for saidas in tipos.values():
            for destinos in saidas:
                destinos[:] = [d for d in destinos if d['node'] not in SOMBRA]
    for nome in SOMBRA:
        n = nos[nome]
        n['disabled'] = True
        if MARCA not in n.get('notes', ''):
            n['notes'] = (n.get('notes', '') + '\n' + MARCA + ' Coleta suspensa; revisar a amostra existente antes de autorizar nova coleta.').strip()
    return wf
