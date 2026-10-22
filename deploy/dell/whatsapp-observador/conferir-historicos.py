#!/usr/bin/env python3
"""Leitura finita das tentativas reais pela sessão do Hermes. Não envia a leads.

Solicita até 50 mensagens por contato distinto já abordado. Mede retorno, erro e
ausência separadamente. Não cria automação recorrente nem classifica retroativos.
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HOME = Path.home()
CRM = 'http://127.0.0.1:9120/api/operations/crm'
URL = 'http://127.0.0.1:3000/squadone/historico'


def ler(url):
    return json.load(urllib.request.urlopen(url, timeout=20))


def main():
    crm = ler(CRM)
    segredo = (HOME / '.config/claude-ops/whatsapp-observador-segredo').read_text().strip()
    pasta = HOME / '.local/share/squadone-operations'
    destino = pasta / ('leitura-historicos-' + time.strftime('%Y%m%d-%H%M%S') + '.json')
    alvos = {}
    for lead in crm['leads']:
        if not lead.get('marcos', {}).get('enviado'):
            continue
        numero = urllib.parse.urlparse(lead.get('links', {}).get('whatsapp', '')).path.strip('/')
        if not re.fullmatch(r'55\d{10,11}', numero):
            continue
        d = numero[2:]
        chave = d[:2] + d[-8:]
        if chave not in alvos:
            alvos[chave] = {'numero': numero, 'leads': [], 'antes': (lead.get('conversa') or {}).get('mensagens', 0)}
        alvos[chave]['leads'].append({'id': lead['id'], 'empresa': lead['empresa']})
    relatorio = {'iniciadoEm': time.time(), 'contatosDistintos': len(alvos), 'limitePorContato': 50, 'resultados': []}
    pasta.mkdir(parents=True, exist_ok=True)
    escopo = pasta / 'historico-leads.json'
    escopo.write_text(json.dumps({'geradoEm': time.time() * 1000, 'chaves': list(alvos)}))
    escopo.chmod(0o600)

    def salvar():
        tmp = destino.with_suffix('.tmp')
        tmp.write_text(json.dumps(relatorio, ensure_ascii=False))
        tmp.chmod(0o600)
        tmp.replace(destino)

    def consultar(chave, numero, somente_consultar=False):
        req = urllib.request.Request(URL, data=json.dumps({'chave': chave, 'numero': numero, 'somenteConsultar': somente_consultar}).encode(), headers={'Content-Type': 'application/json', 'X-Observador': segredo})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    salvar()
    print('Leitura iniciada:', len(alvos), 'contatos distintos; relatório:', destino, flush=True)
    def conferir(chave, alvo):
        resultado = {'chave': chave, 'leads': alvo['leads'], 'antes': alvo['antes']}
        try:
            codigo, dados = consultar(chave, alvo['numero'])
            if codigo in (200, 202) and not dados.get('recebidas'):
                time.sleep(3)
                codigo, dados = consultar(chave, alvo['numero'], somente_consultar=True)
            resultado.update({'http': codigo, 'consulta': dados, 'estado': 'recebido' if dados.get('recebidas', 0) > 0 else 'sem-retorno' if codigo in (200, 202) else 'erro'})
        except Exception as e:
            resultado.update({'estado': 'erro', 'erro': type(e).__name__})
        time.sleep(1)
        return resultado

    with ThreadPoolExecutor(max_workers=2) as executor:
      futuros = [executor.submit(conferir, chave, alvo) for chave, alvo in alvos.items()]
      for i, futuro in enumerate(as_completed(futuros), 1):
        relatorio['resultados'].append(futuro.result())
        salvar()
        if i % 10 == 0 or i == len(alvos):
            print(i, '/', len(alvos), 'consultados;', sum(r['estado'] == 'recebido' for r in relatorio['resultados']), 'com retorno', flush=True)
    relatorio['concluidoEm'] = time.time()
    salvar()
    print('Concluído:', destino, flush=True)


if __name__ == '__main__':
    main()
