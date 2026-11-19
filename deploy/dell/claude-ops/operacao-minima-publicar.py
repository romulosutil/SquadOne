"""Compara fontes da Prumo com as versões publicadas na Mel e publica por ID revisado."""

import argparse
import datetime as dt
import hashlib
from importlib import import_module
import json
from pathlib import Path

from prumo_contexto import carregar, preparar
from workflow_minimo import compor, FALHAS, PESQUISA


WHATSAPP = 'TunkKi3HnYLXJati'
LINKEDIN = 'Sk4A9PMCD35y6rrJ'
DIARIO = 'OhFg51gIIWnmIF6r'
MEDICAO = 'qA5R9UXZj4UgIjFi'


def candidatos():
    base = Path.home() / '.local/share/operacao-minima'
    manifesto = json.loads((base / 'fontes-manifesto.json').read_text(encoding='utf-8'))
    fontes = {}
    for wid, digest in manifesto.items():
        bruto = (base / 'fontes' / (wid + '.json')).read_bytes()
        if hashlib.sha256(bruto).hexdigest() != digest:
            raise ValueError('Fonte privada alterada: ' + wid)
        fontes[wid] = json.loads(bruto)
    mensagem = json.loads((Path.home() / '.local/bin/mensagem-inicial.json').read_text(encoding='utf-8'))
    return compor(fontes, mensagem)


def todos(os_core, vivo):
    from pesquisa_whatsapp_n8n import workflow as pesquisa_diaria
    revisao = next(n for n in os_core[PESQUISA]['nodes']
                   if n['parameters'].get('path') == 'prumo-pesquisa-google')
    credencial = (Path.home() / '.config/claude-ops/prumo-publico-cred').read_text().strip()
    medicao = import_module('prumo-publico').metricas(credencial)
    medicao['settings']['errorWorkflow'] = vivo(MEDICAO)['settings']['errorWorkflow']
    return {
        **os_core,
        WHATSAPP: import_module('whatsapp-n8n').workflow(),
        LINKEDIN: import_module('linkedin-n8n').workflow(),
        DIARIO: pesquisa_diaria(revisao['credentials'], FALHAS),
        MEDICAO: medicao,
    }


def assinatura(grafo):
    # Os links mantêm a ordem dos ramos. O n8n pode reordenar a lista de nós
    # ao salvar, sem mudar os IDs, as posições ou a topologia.
    grafo = {**grafo, 'nodes': sorted(grafo['nodes'], key=lambda n: n['id'])}
    return hashlib.sha256(json.dumps(grafo, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False).encode()).hexdigest()


def publicado(w):
    ativo = w.get('activeVersion') or {}
    if not w['active'] or w.get('isArchived') or ativo.get('versionId') != w.get('activeVersionId') or not ativo:
        raise ValueError('Versão publicada indisponível: ' + w['id'])
    return {**w, **ativo, 'name': ativo.get('name') or w['name'], 'settings': w['settings']}


def publicar(ler, escrever, ativar, corpo, candidato, anterior, revisado):
    wid = anterior['id']
    if anterior['versionId'] != anterior['activeVersionId']:
        raise ValueError('Existe um rascunho para revisão: ' + wid)
    if candidato['settings'] != corpo(anterior)['settings']:
        raise ValueError('Configurações operacionais divergentes: ' + wid)
    atual = ler(wid)
    if (atual['versionId'] != anterior['versionId']
            or atual['activeVersionId'] != anterior['activeVersionId']
            or assinatura(corpo(publicado(atual))) != assinatura(corpo(publicado(anterior)))):
        raise RuntimeError('Alteração concorrente: ' + wid)
    pasta = Path.home() / '.local/share/operacao-minima/backups' / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    pasta.mkdir(parents=True, mode=0o700)
    backup = pasta / (wid + '.json')
    backup.touch(mode=0o600, exist_ok=False)
    backup.write_text(json.dumps(anterior, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'backup': str(backup)}), flush=True)
    salvo = escrever({**candidato, 'id': wid})
    rascunho = ler(wid)
    if (rascunho['versionId'] != salvo['versionId'] or assinatura(corpo(rascunho)) != revisado
            or rascunho['activeVersionId'] != anterior['activeVersionId'] or not rascunho['active']):
        raise RuntimeError('Rascunho divergiu da revisão: ' + wid)
    ativar(wid, rascunho['versionId'])
    final = ler(wid)
    if final['activeVersionId'] != rascunho['versionId'] or assinatura(corpo(publicado(final))) != revisado:
        raise RuntimeError('Versão publicada divergiu da revisão: ' + wid)
    return final


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--aplicar', metavar='ID')
    p.add_argument('--anterior', metavar='SHA256')
    p.add_argument('--revisado', metavar='SHA256')
    a = p.parse_args()
    if a.aplicar and not (a.anterior and a.revisado):
        p.error('--aplicar exige os hashes --anterior e --revisado')

    from n8n import api, corpo_workflow, put

    def vivo(wid):
        return api('GET', '/workflows/' + wid)

    def gravar(grafo):
        return put(grafo, somente_rascunho=True)

    def ativar(wid, versao):
        return api('POST', '/workflows/' + wid + '/activate', {'versionId': versao})

    contexto = carregar(buscar=False)
    os_fluxos = todos(candidatos(), vivo)
    if a.aplicar and a.aplicar not in os_fluxos:
        p.error('ID fora do inventário ativo')
    comparacao = {}
    aplicado = False
    for wid, fonte in os_fluxos.items():
        anterior = vivo(wid)
        atual = corpo_workflow(publicado(anterior))
        proposta = corpo_workflow(preparar(fonte, contexto))
        hash_atual, hash_proposta = assinatura(atual), assinatura(proposta)
        if a.aplicar == wid:
            if (hash_atual, hash_proposta) != (a.anterior, a.revisado):
                raise SystemExit('A publicação ou a fonte mudou desde a revisão: ' + wid)
            if hash_atual != hash_proposta:
                anterior = publicar(vivo, gravar, ativar, corpo_workflow, proposta, anterior, a.revisado)
                atual = corpo_workflow(publicado(anterior))
                hash_atual = assinatura(atual)
                aplicado = True
        nos_atuais = {n['id']: n for n in atual['nodes']}
        nos_fonte = {n['id']: n for n in proposta['nodes']}
        mudancas = sorted(
            (nos_fonte.get(k) or nos_atuais[k])['name']
            for k in nos_atuais.keys() | nos_fonte.keys()
            if nos_atuais.get(k) != nos_fonte.get(k)
        )
        comparacao[wid] = {'publicado': anterior['activeVersionId'], 'atual': hash_atual,
                           'fonte': hash_proposta, 'corresponde': hash_atual == hash_proposta,
                           'nosDiferentes': mudancas, 'conexoesDiferentes': atual['connections'] != proposta['connections'],
                           'configuracoesDiferentes': atual['settings'] != proposta['settings']}
    print(json.dumps({'aplicado': aplicado, 'workflows': {wid: len(w['nodes']) for wid, w in os_fluxos.items()},
                      'comparacao': comparacao}, ensure_ascii=False))


if __name__ == '__main__':
    main()
