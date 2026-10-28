#!/usr/bin/env python3
"""Marina: revisão diária derivada do CRM; sem credenciais ou ferramenta de envio."""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import sys
import urllib.request
from collections import Counter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from filtro_leads import SP, VERSAO, aprender, avaliar, instante, resultado


def atomico(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_name(path.name + '.tmp')
    with open(tmp, 'w', encoding='utf-8', opener=lambda p, flags: os.open(p, flags, 0o600)) as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.flush(); os.fsync(f.fileno())
    tmp.chmod(0o600)
    os.replace(tmp, path)


def texto(l):
    from urllib.parse import urlparse, parse_qs
    if l.get('produto') in ('site', 'plus'):
        return l.get('mensagemPronta') or ''
    return parse_qs(urlparse((l.get('links') or {}).get('convite') or '').query).get('text', [''])[0]


def revisar(crm, contatos, now, memoria=None):
    if crm.get('estado') != 'ok' or not isinstance(crm.get('leads'), list) or not crm['leads']:
        raise ValueError('CRM indisponível ou vazio; preservar a última curadoria')
    em = instante(crm.get('geradoEm'))
    if em is None or not -60 <= now.timestamp()-em < 1800:
        raise ValueError('Retrato comercial desatualizado; preservar a última curadoria')
    fontes = crm.get('fontes') or []
    if any(f.get('erro') for f in fontes):
        raise ValueError('Fonte comercial incompleta; preservar a última curadoria')
    modelo, memoria = aprender(crm['leads'], now, contatos, memoria)
    dia = now.astimezone(SP).date().isoformat()
    def hoje(v):
        em = instante(v)
        return em is not None and dt.datetime.fromtimestamp(em, SP).date().isoformat() == dia
    contactados = [l for l in crm['leads'] if hoje((l.get('marcos') or {}).get('enviado'))
                   or hoje((l.get('conversa') or {}).get('ultimaSaida'))]
    motivos = Counter(); detalhes = []
    for l in crm['leads']:
        p = avaliar(l, modelo, texto(l))
        if l.get('etapa') == 'novo':
            motivos.update(p['motivos'])
        if l in contactados:
            detalhes.append({'id': l['id'], 'empresa': l['empresa'], 'oferta': l['produto'],
                             'resultado': resultado(l, now), 'curadoria': p})
    tentativas = [r for r in contatos if hoje(r.get('em')) and r.get('estado') == 'sem_whatsapp']
    resumo = {'versao': VERSAO, 'agente': 'Marina', 'dia': dia, 'geradoEm': now.isoformat(),
              'estado': 'ok', 'fonteGeradaEm': crm['geradoEm'], 'leadsNaFonte': len(crm['leads']), 'contatadosHoje': len(contactados),
              'ofertasHoje': dict(Counter(l['produto'] for l in contactados)),
              'resultadosHoje': dict(Counter(r['resultado'] for r in detalhes)),
              'tentativasSemWhatsappHoje': len(tentativas), 'casosMaduros': modelo['maduros'],
              'casosRotulados': modelo['rotulados'], 'ambiguosExcluidos': modelo['ambiguosExcluidos'],
              'padroesAtivos': modelo['padroes'], 'coortes': modelo['coortes'],
              'motivosDeRevisaoNaBase': dict(motivos), 'modeloHash': modelo['hash'],
              'criterio': 'Só avanço confirmado ou recusa rotulam aprendizado. Robô, silêncio e acesso ficam inconclusivos. Janela de 90 dias; maturação de 48h; mínimo de 10 casos rotulados no grupo e na comparação; ajuste de prioridade até 5, sem veto por setor.',
              'limiteDaConclusao': 'Os contatos de hoje ainda não têm 48h; observações do dia não elegem um nicho vencedor. Sem proposta/pagamento não afirmar venda.'}
    return modelo, memoria, resumo, detalhes


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--simular', action='store_true')
    args = parser.parse_args()
    h = Path.home(); base = h/'.local/share/curadoria-leads'
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (base/'curadoria.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with urllib.request.urlopen('http://127.0.0.1:9120/api/operations/crm', timeout=90) as r:
            crm = json.load(r)
        db = sqlite3.connect((h/'.local/share/frente-comercial/registro.sqlite').as_uri()+'?mode=ro', uri=True)
        try:
            db.row_factory = sqlite3.Row
            contatos = [dict(r) for r in db.execute('SELECT chave,id,estado,em FROM contatos')]
        finally:
            db.close()
        try: memoria = json.loads((base/'memoria.json').read_text())
        except FileNotFoundError: memoria = None
        modelo, memoria, resumo, detalhes = revisar(crm, contatos, dt.datetime.now(dt.timezone.utc), memoria)
        if not args.simular:
            atomico(base/'memoria.json', memoria)
            atomico(base/'modelo.json', modelo)
            atomico(base/'historico'/(resumo['dia']+'.json'), {'resumo': resumo, 'leads': detalhes})
            atomico(h/'.local/share/squadone-operations/filtro-leads.json', resumo)
        print(json.dumps({k:v for k,v in resumo.items() if k not in ('coortes',)}, ensure_ascii=False))


if __name__ == '__main__':
    try: main()
    except Exception as e:
        print('curadoria-leads: revisão interrompida: '+type(e).__name__, file=sys.stderr)
        sys.exit(1)
