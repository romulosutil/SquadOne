#!/usr/bin/env python3
"""Pré-check da coleta de métricas do ASMR FULLBRINGER: decide se vale acordar o agente.

A coleta abre o YouTube Studio no navegador e custa uma rodada inteira do
modelo. Rodava a cada 2 h, mesmo sem Short novo no ar — 12 rodadas por dia
para registrar que 4 views viraram 5. Agora roda a cada hora, mas só acorda o
agente quando um Short de até 72 h cruzou um marco de idade: são os pontos
que a revisão 24/48 h compara entre Shorts, e comparar por idade é o que o
briefing exige. Sem Short novo, custo zero.

O que está no ar vem do feed público do canal (sem login, sem chave). A última
idade coletada vem de shorts-metrics.json, que só a coleta escreve.

Última linha do stdout é o portão do cron: {"wakeAgent": false} pula a rodada.
"""

import json
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

CANAL = "UCQC-Jf-noqrZgYErYzE_HEQ"
FEED = f"https://www.youtube.com/feeds/videos.xml?channel_id={CANAL}"
METRICAS = Path.home() / ".local/share/asmr-fullbringer/shorts-metrics.json"
MARCOS_H = (2, 6, 12, 24, 48, 72)
IDADE_MAX_H = 72
# Feed fora do ar: não dá para saber se há Short novo. Acorda só se a última
# coleta ficou velha, para não trocar a economia por um buraco nos dados.
SEM_FEED_ACORDA_APOS_H = 6

NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015",
      "media": "http://search.yahoo.com/mrss/"}


def portao(acordar: bool, contexto=None) -> None:
    print(json.dumps({"wakeAgent": acordar, **({"context": contexto} if contexto else {})}, ensure_ascii=False))


def no_ar():
    with urllib.request.urlopen(FEED, timeout=15) as r:
        raiz = ET.fromstring(r.read())
    agora = datetime.now(timezone.utc)
    for e in raiz.findall("a:entry", NS):
        pub = datetime.fromisoformat(e.findtext("a:published", namespaces=NS))
        stats = e.find("media:group/media:community/media:statistics", NS)
        yield {
            "video_id": e.findtext("yt:videoId", namespaces=NS),
            "titulo": e.findtext("a:title", namespaces=NS),
            "idade_h": round((agora - pub).total_seconds() / 3600, 1),
            "views_publicas": int(stats.get("views")) if stats is not None else None,
        }


def ultima_idade_coletada():
    try:
        d = json.loads(METRICAS.read_text())
    except (OSError, ValueError):
        return {}
    out = {}
    for s in d.get("shorts", []):
        snaps = s.get("snapshots") or []
        if s.get("video_id") and snaps:
            out[s["video_id"]] = snaps[-1].get("age_approx_hours")
    return out


def main() -> None:
    try:
        videos = [v for v in no_ar() if v["idade_h"] <= IDADE_MAX_H]
    except Exception as erro:  # rede, XML: qualquer falha do feed cai na regra de segurança
        idade_arquivo_h = (time.time() - METRICAS.stat().st_mtime) / 3600 if METRICAS.exists() else 999
        print(f"Feed público indisponível ({type(erro).__name__}); última coleta há {idade_arquivo_h:.0f} h.")
        portao(idade_arquivo_h >= SEM_FEED_ACORDA_APOS_H)
        return

    if not videos:
        portao(False)
        return

    coletado = ultima_idade_coletada()
    devidos = []
    for v in videos:
        ultima = coletado.get(v["video_id"])
        if ultima is None:
            devidos.append({**v, "marco_h": "primeira coleta"})
            continue
        marco = next((m for m in MARCOS_H if ultima < m <= v["idade_h"]), None)
        if marco:
            devidos.append({**v, "marco_h": marco})

    if not devidos:
        portao(False)
        return

    print("Shorts que cruzaram um marco de idade desde a última coleta:")
    for v in devidos:
        print(f"- {v['video_id']} “{v['titulo']}”: {v['idade_h']} h (marco {v['marco_h']}), "
              f"{v['views_publicas']} views públicas")
    portao(True, {"shorts": [v["video_id"] for v in devidos]})


if __name__ == "__main__":
    main()
    sys.exit(0)
