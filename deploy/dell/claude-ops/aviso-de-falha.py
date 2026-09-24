"""Cria/atualiza o workflow "00 · Avisar falha pelo Hermes", liga-o como Error
Workflow de todos os outros e, com --testar, prova o caminho inteiro com um
fluxo descartável que falha de propósito.
"""
import glob
import os
import sys
import time
import urllib.request

from n8n import aviso_nodes, api, put

NOME = "00 · Avisar falha pelo Hermes"
TEXTO = (
    "'Fluxo \"' + (item.json.workflow?.name ?? '?') + '\" falhou no nó ' + (item.json.execution?.lastNodeExecuted ?? '?')"
    " + ': ' + String(item.json.execution?.error?.message ?? item.json.trigger?.error?.message ?? 'sem mensagem').slice(0, 300)"
    " + NL + 'Abrir: ' + (item.json.execution?.url ?? 'http://127.0.0.1:5679/home/executions')"
)


def garantir_workflow():
    montar, gravar = aviso_nodes("Falha", 240, 0, TEXTO, "⚠️ n8n do Dell")
    gatilho = {"id": "falha-trigger", "name": "Algum fluxo falhou", "type": "n8n-nodes-base.errorTrigger",
               "typeVersion": 1, "position": [0, 0], "parameters": {}}
    conexoes = {
        gatilho["name"]: {"main": [[{"node": montar["name"], "type": "main", "index": 0}]]},
        montar["name"]: {"main": [[{"node": gravar["name"], "type": "main", "index": 0}]]},
    }
    existentes = [w for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == NOME]
    if existentes:
        wf = api("GET", f"/workflows/{existentes[0]['id']}")
        wf["nodes"], wf["connections"] = [gatilho, montar, gravar], conexoes
        put(wf)
    else:
        wf = api("POST", "/workflows", {"name": NOME, "nodes": [gatilho, montar, gravar], "connections": conexoes,
                                        "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo"}})
    # No n8n 2.x o Error Workflow só executa publicado.
    api("POST", f"/workflows/{wf['id']}/activate")
    return wf["id"]


def ligar_em_todos(erro_id):
    for resumo in api("GET", "/workflows?limit=200")["data"]:
        if resumo["id"] == erro_id:
            continue
        wf = api("GET", f"/workflows/{resumo['id']}")
        if (wf.get("settings") or {}).get("errorWorkflow") == erro_id:
            continue
        wf.setdefault("settings", {})["errorWorkflow"] = erro_id
        put(wf)
        if resumo.get("active"):
            api("POST", f"/workflows/{resumo['id']}/activate")  # republica com a configuração nova
        print("Error Workflow ligado em:", wf["name"])


def testar(erro_id):
    teste = api("POST", "/workflows", {
        "name": "ZZ teste de aviso (apagar)", "settings": {"executionOrder": "v1", "errorWorkflow": erro_id},
        "nodes": [
            {"id": "w", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
             "parameters": {"httpMethod": "POST", "path": "teste-aviso-claude", "responseMode": "onReceived"},
             "webhookId": "7b9f0c1e-0000-4000-8000-teste0aviso"},
            {"id": "c", "name": "Falhar de propósito", "type": "n8n-nodes-base.code", "typeVersion": 2,
             "position": [240, 0], "parameters": {"jsCode": "throw new Error('Teste do canal de avisos: pode ignorar.');"}},
        ],
        "connections": {"Webhook": {"main": [[{"node": "Falhar de propósito", "type": "main", "index": 0}]]}},
    })
    try:
        api("POST", f"/workflows/{teste['id']}/activate")
        time.sleep(2)
        urllib.request.urlopen(urllib.request.Request(
            "http://127.0.0.1:5679/webhook/teste-aviso-claude", data=b"{}", method="POST",
            headers={"Content-Type": "application/json"}), timeout=15).read()
        fila = os.path.expanduser("~/.local/share/avisos/fila")
        for _ in range(25):
            arquivos = glob.glob(fila + "/*.json")
            if arquivos:
                print("na fila:", open(arquivos[0], encoding="utf-8").read()[:300])
                return True
            time.sleep(1)
        for e in api("GET", f"/executions?workflowId={erro_id}&limit=1&includeData=true")["data"]:
            for nome, runs in e["data"]["resultData"]["runData"].items():
                print(nome, runs[0].get("executionStatus"), (runs[0].get("error") or {}).get("message"))
        return False
    finally:
        api("POST", f"/workflows/{teste['id']}/deactivate")
        api("DELETE", f"/workflows/{teste['id']}")


if __name__ == "__main__":
    erro_id = garantir_workflow()
    print("Error Workflow:", erro_id)
    ligar_em_todos(erro_id)
    if "--testar" in sys.argv:
        sys.exit(0 if testar(erro_id) else 1)
