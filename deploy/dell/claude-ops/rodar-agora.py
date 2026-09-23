"""Roda um workflow do n8n do Dell agora, de verdade, e mostra o resultado de
cada nó. A API pública não executa workflows: o script cria uma cópia
temporária com um Webhook no lugar do gatilho, chama, lê a execução e apaga a
cópia. Efeitos são reais (planilha, arquivos, avisos).

Uso: python3 rodar-agora.py <workflow_id> [nó_inicial]
"""
import copy
import sys
import time
import urllib.request

from n8n import api

GATILHOS = ("scheduleTrigger", "manualTrigger")


def main(wf_id, inicio=None):
    wf = api("GET", f"/workflows/{wf_id}")
    nos = [copy.deepcopy(n) for n in wf["nodes"] if n["type"].split(".")[-1] not in GATILHOS]
    gatilhos = {n["name"] for n in wf["nodes"] if n["type"].split(".")[-1] in GATILHOS}
    if not inicio:
        primeiro = next(iter(gatilhos))
        inicio = wf["connections"][primeiro]["main"][0][0]["node"]
    caminho = f"rodar-agora-{wf_id.lower()}"
    nos.append({"id": "rodar-agora", "name": "Rodar agora", "type": "n8n-nodes-base.webhook", "typeVersion": 2,
                "position": [-300, 0], "webhookId": f"00000000-0000-4000-8000-{wf_id.lower()[:12].ljust(12, '0')}",
                "parameters": {"httpMethod": "POST", "path": caminho, "responseMode": "onReceived"}})
    con = {k: v for k, v in wf["connections"].items() if k not in gatilhos}
    con["Rodar agora"] = {"main": [[{"node": inicio, "type": "main", "index": 0}]]}
    t = api("POST", "/workflows", {"name": f"ZZ rodar agora: {wf['name']} (apagar)", "nodes": nos, "connections": con,
                                   "settings": {k: v for k, v in (wf.get("settings") or {}).items() if k in ("executionOrder", "timezone")}})
    try:
        api("POST", f"/workflows/{t['id']}/activate")
        time.sleep(2)
        urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:5679/webhook/{caminho}", data=b"{}", method="POST",
                                                      headers={"Content-Type": "application/json"}), timeout=30).read()
        for _ in range(180):
            ex = api("GET", f"/executions?workflowId={t['id']}&limit=1")["data"]
            if ex and ex[0]["status"] not in ("running", "new", "waiting"):
                break
            time.sleep(5)
        e = api("GET", f"/executions/{ex[0]['id']}?includeData=true")
        print("status:", e["status"])
        rd = e["data"]["resultData"]
        for nome, runs in rd["runData"].items():
            itens = sum(len(((r.get("data") or {}).get("main") or [[]])[0] or []) for r in runs)
            erro = next(((r.get("error") or {}).get("message") for r in runs if r.get("error")), "")
            print(f"  {nome}: {runs[-1].get('executionStatus')} itens={itens} {erro}")
        return e["status"] == "success"
    finally:
        api("POST", f"/workflows/{t['id']}/deactivate")
        api("DELETE", f"/workflows/{t['id']}")


if __name__ == "__main__":
    sys.exit(0 if main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None) else 1)
