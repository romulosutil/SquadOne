#!/usr/bin/env python3
"""Jornada de revisão do dia anterior. Leitura local; não reserva nem envia."""
from __future__ import annotations

import argparse
from collections import Counter
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

SP = ZoneInfo('America/Sao_Paulo')
BASE = 'http://127.0.0.1:9120/api/operations/'


def instante(value):
    try:
        v = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return v if v.tzinfo else None
    except (TypeError, ValueError):
        return None


def no_dia(value, dia):
    v = instante(value)
    return bool(v and v.astimezone(SP).date().isoformat() == dia)


def get(route):
    with urllib.request.urlopen(BASE + route, timeout=90) as r:
        return json.load(r)


def salvar(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix('.tmp')
    with open(tmp, 'w', encoding='utf-8', opener=lambda p, f: os.open(p, f, 0o600)) as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    tmp.chmod(0o600)
    os.replace(tmp, path)


def analisar(crm, registros, conversas, dia, agora):
    gerado = instante(crm.get('geradoEm'))
    if crm.get('estado') != 'ok' or not gerado or not -60 <= (agora-gerado).total_seconds() <= 1800:
        raise ValueError('CRM indisponível ou antigo; revisão não concluída')
    leads = {l['id']: l for l in crm['leads']}
    tentativas = [r for r in registros if no_dia(r.get('em'), dia)]
    ids = {r['id'] for r in tentativas} | set(conversas)
    ids.update(l['id'] for l in crm['leads'] if any(no_dia(v, dia) for v in [
        (l.get('marcos') or {}).get('enviado'),
        (l.get('conversa') or {}).get('ultimaEntrada'),
        (l.get('conversa') or {}).get('ultimaSaida'),
        *[m.get('em') for m in (l.get('conversa') or {}).get('recentes', [])]]))
    casos = []
    for ident in sorted(ids):
        lead = leads.get(ident)
        if not lead or ident not in conversas or not isinstance(conversas[ident].get('mensagens'), list):
            raise ValueError('Cobertura incompleta de conversas; conferir antes de concluir')
        msgs = sorted(conversas[ident]['mensagens'], key=lambda m: m.get('em', ''))
        do_dia = [m for m in msgs if no_dia(m.get('em'), dia)]
        if not do_dia and not any(r['id'] == ident for r in tentativas):
            continue
        primeiro = next((m for m in msgs if m.get('direcao') == 'saida'), None)
        novo = no_dia((lead.get('marcos') or {}).get('enviado'), dia)
        classificacao = lead.get('classificacaoResposta') or {}
        evidencia = classificacao.get('evidencia') or {}
        permissao = instante(evidencia.get('em')) if classificacao.get('classe') == 'permissao' else None
        entrega = next((m for m in msgs if permissao and instante(m.get('em')) and
                        instante(m['em']) > permissao and m.get('direcao') == 'saida' and
                        'https://' in m.get('texto', '')), None)
        atraso = round((instante(entrega['em'])-permissao).total_seconds()/60) if entrega else None
        texto = (primeiro or {}).get('texto', '')
        casos.append({'id': ident, 'empresa': lead.get('empresa'), 'oferta': lead.get('produto'),
                      'nicho': lead.get('nicho'), 'primeiroContatoNoDia': novo,
                      'classeAtual': classificacao.get('classe', 'revisar'),
                      'revisarClassificacao': classificacao.get('revisar', True),
                      'humanaConfirmada': classificacao.get('houveRespostaHumana', False),
                      'textoEnviadoHash': hashlib.sha256(texto.encode()).hexdigest() if texto else None,
                      'textoEnviado': texto, 'mensagensDoDia': do_dia,
                      'minutosPermissaoAteLink': atraso,
                      'permissaoSemLink': bool(permissao and not entrega),
                      'registroComRecibo': any(r['id'] == ident and r.get('estado') == 'enviado' and r.get('recibo') for r in tentativas)})
    novos = [c for c in casos if c['primeiroContatoNoDia']]
    melhorias = [
        {'responsavel': 'Marina', 'acao': 'Atualizar a curadoria antes de selecionar; manter ajustes estatísticos zerados sem amostra madura suficiente.',
         'evidencia': 'Resultados do dia anterior têm menos de 48h; silêncio e robô são inconclusivos.'},
        {'responsavel': 'Carla', 'acao': 'Comparar o texto efetivamente enviado e sua versão, com a pergunta anterior; registrar hipótese e resultado antes de alterar mensagens.',
         'evidencia': f'{len(set(c["textoEnviadoHash"] for c in novos))} textos distintos nos primeiros contatos; versões e nichos não são um experimento controlado.'},
    ]
    lentos = [c for c in casos if c['minutosPermissaoAteLink'] is not None and c['minutosPermissaoAteLink'] > 30]
    pendentes = [c for c in casos if c['permissaoSemLink']]
    if lentos or pendentes:
        melhorias.append({'responsavel': 'Elisa', 'acao': 'Priorizar material autorizado pendente e revisar a demora de entrega antes de ampliar a prospecção; não enviar automaticamente pela revisão.',
                           'evidencia': f'{len(lentos)} entregas acima de 30 min e {len(pendentes)} permissões sem link observado. É sinal operacional, não promessa de SLA.'})
    nichos = Counter(c['nicho'] or 'não informado' for c in novos)
    if novos and max(nichos.values())/len(novos) >= .7:
        melhorias.append({'responsavel': 'Diego', 'acao': 'Conferir diversidade entre candidatos já aprovados e a evidência específica de cada empresa; manter três notas mínimas de 65.',
                           'evidencia': f'O maior nicho reúne {max(nichos.values())}/{len(novos)} primeiros contatos. Isso não prova qualidade inferior do nicho.'})
    resumo = {'versao': 1, 'diaAnalisado': dia, 'geradoEm': agora.isoformat(), 'fonteGeradaEm': crm['geradoEm'],
              'estado': 'ok', 'conversasRevisadas': len(casos), 'primeirosContatos': len(novos),
              'resultadosPrimeiros': dict(Counter(c['classeAtual'] for c in novos)),
              'tentativas': dict(Counter(r['estado'] for r in tentativas)),
              'enviosComRecibo': sum(bool(r.get('recibo')) and r.get('estado') == 'enviado' for r in tentativas),
              'nichosPrimeiros': dict(nichos), 'entregasAcimaDe30Min': len(lentos),
              'permissoesSemLink': len(pendentes), 'melhorias': melhorias,
              'limites': 'Observação descritiva até agora, não resultado final de D+1. Permissão não confirma compra. Nenhuma rodada, recusa, preço, nota mínima ou envio é alterado por este relatório.'}
    return resumo, casos


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dia')
    args = parser.parse_args()
    agora = dt.datetime.now(dt.timezone.utc)
    dia = args.dia or (agora.astimezone(SP).date()-dt.timedelta(days=1)).isoformat()
    dt.date.fromisoformat(dia)
    h = Path.home()
    crm = get('crm')
    with sqlite3.connect((h/'.local/share/frente-comercial/registro.sqlite').as_uri()+'?mode=ro', uri=True) as banco:
        banco.row_factory = sqlite3.Row
        registros = [dict(r) for r in banco.execute('SELECT id,estado,em,recibo FROM contatos')]
    # Ler conversas completas dos contatos e de toda atividade recente do dia.
    ids = {r['id'] for r in registros if no_dia(r.get('em'), dia)}
    for l in crm.get('leads', []):
        c = l.get('conversa') or {}
        if any(no_dia(v, dia) for v in [(l.get('marcos') or {}).get('enviado'), c.get('ultimaEntrada'), c.get('ultimaSaida'),
                                        *[m.get('em') for m in c.get('recentes', [])]]):
            ids.add(l['id'])
        # O resumo recente da API pode omitir atividade de ontem numa conversa longa.
        # A pasta do observador contém somente conversas comerciais já capturadas.
        numero = urllib.parse.urlparse((l.get('links') or {}).get('whatsapp') or '').path.strip('/')
        if numero.isdigit():
            if len(numero) >= 12 and numero.startswith('55'):
                numero = numero[2:]
            if 10 <= len(numero) <= 11:
                arquivo = h/'.local/share/whatsapp-conversas'/(numero[:2]+numero[-8:]+'.jsonl')
                if arquivo.exists():
                    rows = [json.loads(row) for row in arquivo.read_text().splitlines() if row.strip()]
                    if any(no_dia(row.get('em'), dia) for row in rows):
                        ids.add(l['id'])
    conversas = {i: get('crm/conversa?id='+urllib.parse.quote(i.partition(':')[2], safe='')) for i in sorted(ids)}
    resumo, casos = analisar(crm, registros, conversas, dia, agora)
    base = h/'.local/share/revisao-comercial-diaria'
    # Evidência privada, fora de modelos de inferência e do journal.
    salvar(base/'historico'/f'{dia}.json', {'resumo': resumo, 'casos': casos})
    salvar(base/'ultima.json', resumo)
    print(json.dumps(resumo, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'estado': 'falhou', 'tipo': type(exc).__name__}))
        raise SystemExit(1)
